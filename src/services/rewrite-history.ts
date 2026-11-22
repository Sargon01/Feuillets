import { TFile, type TFolder } from "obsidian";
import { stripFrontmatter } from "./frontmatter.js";
import { countWords } from "../utils/core.js";
import { RewriteHistoryStore, type RewriteEntry, type RewriteIndex, type RewriteOrigin, type RewriteSheet } from "./rewrite-history-store.js";

interface Intervention {
  entry: RewriteEntry;
  beforeText: string;
  afterText: string;
  revision: number;
  persisted: number;
}
export interface RewriteHistoryOptions {
  now?: () => number;
  inactivityMs: () => number;
  onError: (error: unknown) => void;
  onChange?: () => void;
}

/** One project, independent interventions per sheet. Observing is synchronous:
 * the exact pre-transaction string is retained before asynchronous I/O starts.
 * Failures leave ordered jobs in memory for retry and never block manuscript I/O. */
export class RewriteHistory {
  private index?: RewriteIndex;
  private loaded = false;
  private readonly active = new Map<string, Intervention>();
  private readonly entries = new Map<string, RewriteEntry>();
  private readonly identities = new WeakMap<TFile, RewriteSheet>();
  private readonly jobs: (() => Promise<void>)[] = [];
  private draining?: Promise<void>;
  private failed = false;
  private readonly now: () => number;
  constructor(readonly store: RewriteHistoryStore, private readonly options: RewriteHistoryOptions) { this.now = options.now ?? Date.now; }
  get root(): TFolder { return this.store.root; }
  get hasError(): boolean { return this.failed; }

  private async initialize(): Promise<void> {
    if (this.loaded) return;
    this.index ??= await this.store.loadIndex();
    const entries = await this.store.entries();
    for (const entry of entries) {
      if (entry.projectId !== this.index.projectId || !this.index.sheets.some((sheet) => sheet.id === entry.sheetId)) throw new Error("History identity mismatch");
      if (entry.status === "pending") {
        if (entry.checkpoint === undefined) throw new Error("History checkpoint missing");
        await this.store.state(entry.before);
        const before = this.store.app.vault.getAbstractFileByPath(this.store.statePath(entry.before));
        if (!(before instanceof TFile)) throw new Error("History baseline missing");
        const unchanged = stripFrontmatter(await this.store.app.vault.read(before)) === stripFrontmatter(entry.checkpoint);
        const after = unchanged ? undefined : await this.store.retain(entry.checkpoint);
        const recovered: RewriteEntry = { ...entry, status: unchanged ? "unchanged" : "complete", recovered: true, after };
        delete recovered.checkpoint;
        await this.store.saveEntry(recovered);
        this.entries.set(entry.id, recovered);
      } else this.entries.set(entry.id, entry);
    }
    this.loaded = true;
  }
  private enqueue(job: () => Promise<void>): void { this.jobs.push(job); void this.drain(); }
  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      try {
        await this.initialize();
        while (this.jobs.length) { await this.jobs[0](); this.jobs.shift(); }
        this.failed = false;
      } catch (error) {
        if (!this.failed) this.options.onError(error);
        this.failed = true;
      }
    })();
    try { await this.draining; } finally { this.draining = undefined; }
  }
  private async sheet(file: TFile, path: string, ctime: number): Promise<RewriteSheet> {
    const index = this.index;
    if (!index) throw new Error("History not initialized");
    let sheet = this.identities.get(file);
    sheet ??= index.sheets.find((candidate) => !candidate.deleted && candidate.path === path && candidate.ctime === ctime);
    if (!sheet) {
      for (const stale of index.sheets) if (stale.path === path && !stale.deleted) stale.deleted = true;
      sheet = { id: crypto.randomUUID(), path, ctime, deleted: false };
      index.sheets.push(sheet);
    }
    this.identities.set(file, sheet);
    await this.store.saveIndex(index);
    return sheet;
  }
  observe(file: TFile, before: string, after: string, origin: RewriteOrigin): void {
    if (stripFrontmatter(before) === stripFrontmatter(after)) return;
    const at = this.now();
    const path = file.path;
    const ctime = file.stat.ctime ?? 0;
    let intervention = this.active.get(path);
    if (intervention && stripFrontmatter(intervention.afterText) === stripFrontmatter(after)) return;
    // A discontinuous baseline means two writers diverged. Preserve both
    // chains independently rather than inventing a shared initial state.
    if (intervention && (at - intervention.entry.endedAt >= this.options.inactivityMs()
      || stripFrontmatter(intervention.afterText) !== stripFrontmatter(before))) {
      this.active.delete(path);
      this.persist(intervention, true);
      intervention = undefined;
    }
    if (!intervention) {
      intervention = {
        entry: { version: 1, id: crypto.randomUUID(), sheetId: "pending", projectId: "pending", path,
          startedAt: at, endedAt: at, initialWords: countWords(stripFrontmatter(before)),
          finalWords: countWords(stripFrontmatter(after)), delta: 0, before: "", origins: [origin], status: "pending" },
        beforeText: before, afterText: after, revision: 1, persisted: 0,
      };
      this.active.set(path, intervention);
      const captured = intervention;
      this.enqueue(async () => {
        const sheet = await this.sheet(file, path, ctime);
        captured.entry.sheetId = sheet.id;
        captured.entry.projectId = this.index?.projectId ?? "pending";
        captured.entry.before = await this.store.retain(captured.beforeText);
      });
      this.persist(intervention, false);
    } else {
      intervention.afterText = after;
      intervention.entry.endedAt = at;
      if (!intervention.entry.origins.includes(origin)) intervention.entry.origins.push(origin);
      intervention.revision++;
    }
  }
  private persist(intervention: Intervention, close: boolean): void {
    // Capture now, not when the queue executes: a resumed intervention must
    // never rewrite the end of the preceding one.
    const revision = intervention.revision;
    const text = intervention.afterText;
    const metadata = { ...intervention.entry, finalWords: countWords(stripFrontmatter(text)), origins: [...intervention.entry.origins] };
    this.enqueue(async () => {
      const unchanged = stripFrontmatter(intervention.beforeText) === stripFrontmatter(text);
      const entry: RewriteEntry = { ...metadata, sheetId: intervention.entry.sheetId, projectId: intervention.entry.projectId,
        before: intervention.entry.before, delta: metadata.finalWords - metadata.initialWords,
        status: close ? (unchanged ? "unchanged" : "complete") : "pending" };
      if (close && !unchanged) entry.after = await this.store.retain(text);
      if (!close) entry.checkpoint = text;
      await this.store.saveEntry(entry);
      this.entries.set(entry.id, entry);
      intervention.persisted = revision;
      this.options.onChange?.();
    });
  }
  /** Called by a coarse timer: checkpoint at most once per tick, independent
   * of typing frequency. Inactivity is measured from the last real edit. */
  async tick(): Promise<void> {
    for (const [path, intervention] of this.active) {
      if (this.now() - intervention.entry.endedAt >= this.options.inactivityMs()) {
        this.active.delete(path); this.persist(intervention, true);
      } else if (intervention.persisted !== intervention.revision) this.persist(intervention, false);
    }
    await this.drain();
  }
  async close(path?: string): Promise<void> {
    for (const [key, intervention] of this.active) {
      if (path !== undefined && key !== path) continue;
      this.active.delete(key); this.persist(intervention, true);
    }
    await this.drain();
  }
  async list(file?: TFile): Promise<RewriteEntry[]> {
    await this.drain();
    const known = file ? this.index?.sheets.find((sheet) => !sheet.deleted && sheet.path === file.path && sheet.ctime === (file.stat.ctime ?? 0)) : undefined;
    if (file && !known) return [];
    return [...this.entries.values()].filter((entry) => entry.status === "complete" && (!known || entry.sheetId === known.id))
      .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
  }
  currentPath(entry: RewriteEntry): string | null {
    const sheet = this.index?.sheets.find((candidate) => candidate.id === entry.sheetId);
    return sheet && !sheet.deleted ? sheet.path : null;
  }
  rename(oldPath: string, newPath: string): void {
    this.store.remapKnownPaths(oldPath, newPath);
    for (const [path, intervention] of [...this.active]) {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
      const next = newPath + path.slice(oldPath.length);
      this.active.delete(path); this.active.set(next, intervention);
    }
    this.enqueue(async () => {
      if (!this.index) return;
      let changed = false;
      for (const sheet of this.index.sheets) {
        if (!sheet.deleted && (sheet.path === oldPath || sheet.path.startsWith(`${oldPath}/`))) {
          sheet.path = newPath + sheet.path.slice(oldPath.length); changed = true;
        }
      }
      if (changed) await this.store.saveIndex(this.index);
    });
  }
  remove(path: string): void {
    for (const key of [...this.active.keys()]) if (key === path || key.startsWith(`${path}/`)) void this.close(key);
    this.enqueue(async () => {
      if (!this.index) return;
      let changed = false;
      for (const sheet of this.index.sheets) if (!sheet.deleted && (sheet.path === path || sheet.path.startsWith(`${path}/`))) { sheet.deleted = true; changed = true; }
      if (changed) await this.store.saveIndex(this.index);
    });
  }
}
