import { createRewriteHistoryExtension } from "../utils/cm-rewrite-history.js";
import { Notice, TFile, TFolder, type App, type Plugin } from "obsidian";
import { flattenFiles } from "./folder-structure.js";
import { getResearchRootForProject } from "./research.js";
import { getVersionsRoot } from "./project-files.js";
import { RewriteHistory } from "./rewrite-history.js";
import { RewriteHistoryStore, type RewriteOrigin } from "./rewrite-history-store.js";
import { t } from "../i18n/index.js";

interface HistoryHost extends Plugin { settings: FeuilletsSettings; refreshRewriteHistoryViews(): void }
function inside(path: string, root: string): boolean { return path === root || path.startsWith(`${root}/`); }

/** Owns only integration and the cache of actually observed prior contents.
 * Unknown external baselines are reported; opening/priming never captures. */
export class RewriteHistoryController {
  private readonly projects = new Map<TFolder, RewriteHistory>();
  private readonly membership = new Map<TFolder, Set<TFile>>();
  private readonly observed = new Map<TFile, string>();
  private readonly reading = new WeakMap<TFile, number>();
  private disposed = false;
  private timer?: number;
  private checkpointTimer?: number;
  private warnedGap = false;
  constructor(private readonly host: HistoryHost) {}
  get app(): App { return this.host.app; }
  private roots(): TFolder[] {
    const paths = new Set([this.host.settings.projectFolder, ...(this.host.settings.projects ?? [])]);
    return [...paths].map((path) => path ? this.app.vault.getAbstractFileByPath(path) : null)
      .filter((root): root is TFolder => root instanceof TFolder).sort((a, b) => b.path.length - a.path.length);
  }
  rootFor(file: TFile): TFolder | null {
    if (file.extension !== "md") return null;
    for (const root of this.roots()) {
      if (!inside(file.path, root.path)) continue;
      const research = getResearchRootForProject(this.app, this.host.settings, root);
      const versions = getVersionsRoot(this.app, root);
      if ([research, versions].some((folder) => folder && inside(file.path, folder.path))) return null;
      let members = this.membership.get(root);
      if (!members) { members = new Set(flattenFiles(this.app, this.host.settings, root)); this.membership.set(root, members); }
      return members.has(file) ? root : null;
    }
    return null;
  }
  forRoot(root: TFolder): RewriteHistory {
    let history = this.projects.get(root);
    if (!history) {
      history = new RewriteHistory(new RewriteHistoryStore(this.app, root), {
        inactivityMs: () => this.inactivityMs(),
        onError: (error) => { console.error("Feuillets: rewrite history persistence failed", error); new Notice(t("rewriteHistory.error")); },
        onChange: () => { if (!this.disposed) this.host.refreshRewriteHistoryViews(); },
      });
      this.projects.set(root, history);
    }
    return history;
  }
  private inactivityMs(): number {
    const minutes = this.host.settings.rewriteHistoryInactivityMinutes;
    return (typeof minutes === "number" && Number.isFinite(minutes) ? Math.max(1, Math.min(1440, minutes)) : 10) * 60000;
  }
  observe = (file: TFile, before: string, after: string, origin: RewriteOrigin): void => {
    if (this.disposed || !this.host.settings.automaticRewriteHistory) return;
    const root = this.rootFor(file);
    if (!root) return;
    this.reading.set(file, (this.reading.get(file) ?? 0) + 1);
    if (this.observed.get(file) === after) return;
    this.observed.set(file, after);
    this.forRoot(root).observe(file, before, after, origin);
    // A throttle, not a debounce: continuous typing still gets checkpoints.
    if (this.checkpointTimer === undefined) this.checkpointTimer = window.setTimeout(() => {
      this.checkpointTimer = undefined; void this.tick();
    }, 2000);
  };
  private async read(file: TFile, external: boolean): Promise<void> {
    if (!this.host.settings.automaticRewriteHistory || !this.rootFor(file)) return;
    const generation = (this.reading.get(file) ?? 0) + 1;
    this.reading.set(file, generation);
    try {
      const text = await this.app.vault.read(file);
      if (this.disposed || this.reading.get(file) !== generation) return;
      const before = this.observed.get(file);
      if (external && before !== undefined && before !== text) this.observe(file, before, text, "external-or-other");
      else if (external && before === undefined && !this.warnedGap) { this.warnedGap = true; new Notice(t("rewriteHistory.missingBaseline")); }
      this.observed.set(file, text);
    } catch (error) { console.error("Feuillets: history baseline unavailable", error); }
  }
  async refresh(): Promise<void> {
    this.membership.clear();
    if (!this.host.settings.automaticRewriteHistory) { await this.close(); this.observed.clear(); return; }
    for (const root of this.roots()) {
      await this.forRoot(root).drain();
      for (const file of flattenFiles(this.app, this.host.settings, root)) if (!this.observed.has(file)) await this.read(file, false);
    }
  }
  install(): void {
    this.host.registerEditorExtension(createRewriteHistoryExtension(this.observe, (file) => { void this.close(file); }, (file) => !this.disposed && this.host.settings.automaticRewriteHistory && this.rootFor(file) !== null));
    this.host.registerEvent(this.app.vault.on("modify", (file) => { if (file instanceof TFile) void this.read(file, true); }));
    this.host.registerEvent(this.app.vault.on("create", (file) => { this.membership.clear(); if (file instanceof TFile) void this.read(file, false); }));
    this.host.registerEvent(this.app.vault.on("delete", (file) => {
      this.membership.clear();
      for (const history of this.projects.values()) history.remove(file.path);
      if (file instanceof TFile) this.observed.delete(file);
    }));
    this.host.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.membership.clear();
      for (const history of this.projects.values()) history.rename(oldPath, file.path);
    }));
    this.host.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file && !this.observed.has(file)) void this.read(file, false);
    }));
    this.app.workspace.onLayoutReady(() => { void this.refresh(); });
    this.timer = window.setInterval(() => { void this.tick(); }, 15000);
  }
  async tick(): Promise<void> { for (const history of this.projects.values()) await history.tick(); }
  async close(file?: TFile): Promise<void> { for (const history of this.projects.values()) await history.close(file?.path); }
  async dispose(): Promise<void> {
    this.disposed = true;
    window.clearInterval(this.timer);
    window.clearTimeout(this.checkpointTimer);
    await this.close();
  }
}
