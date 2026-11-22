import { Notice, TFile, type App, type TFolder } from "obsidian";
import type { RewriteHistoryController } from "../services/rewrite-history-controller.js";
import type { RewriteEntry } from "../services/rewrite-history-store.js";
import { shortTitleFor } from "../services/frontmatter.js";
import { openFeuilletsComparison, type ComparisonPlugin } from "../views/comparison-view.js";
import { iconBtn, openFileActivating } from "../utils/dom.js";
import { getLocale, t } from "../i18n/index.js";
import { rewriteHistoryGroups } from "./rewrite-history-groups.js";

type HistorySectionHost = ComparisonPlugin & { rewriteHistory?: RewriteHistoryController; saveSettings(): Promise<void> };
type SectionHead = (container: HTMLElement) => { section: HTMLElement; collapsed: boolean };
function date(time: number): string { return new Date(time).toLocaleString(getLocale() === "fr" ? "fr-FR" : "en-US"); }
function period(start: number, end: number): string {
  const locale = getLocale() === "fr" ? "fr-FR" : "en-US";
  const from = new Date(start);
  const to = new Date(end);
  const time = (value: Date): string => value.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return from.toDateString() === to.toDateString()
    ? `${from.toLocaleDateString(locale)} · ${time(from)}–${time(to)}`
    : `${date(start)} — ${date(end)}`;
}

/** Journal chronology uses its existing section header and the shared
 * comparator. Selecting an intervention never compares against the live text. */
export async function renderRewriteHistorySection(container: HTMLElement, app: App, plugin: HistorySectionHost, root: TFolder, renderHead: SectionHead): Promise<void> {
  const controller = plugin.rewriteHistory;
  if (!controller) return;
  const history = controller.forRoot(root);
  const entries = await history.list();
  if (!plugin.settings.automaticRewriteHistory && !entries.length && !history.hasError) return;
  const { section, collapsed } = renderHead(container);
  section.addClass("feuillets-rewrite-history");
  if (collapsed) return;
  if (history.hasError) section.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.error") });
  if (!entries.length) section.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.empty") });
  const list = section.createDiv({ cls: "feuillets-notes-metadata-list feuillets-rewrite-list" });
  const row = (parent: HTMLElement, entry: RewriteEntry): void => {
    const item = parent.createDiv({ cls: "feuillets-rewrite-entry" });
    item.dataset.entryId = entry.id;
    const head = item.createDiv({ cls: "feuillets-notes-metadata-row" });
    const timestamp = head.createDiv({ cls: "feuillets-notes-sub", text: period(entry.startedAt, entry.endedAt) });
    timestamp.setAttr("title", `${date(entry.startedAt)} — ${date(entry.endedAt)}\n${entry.origins.map((origin) => t(`rewriteHistory.origin.${origin}`)).join(", ")}`);
    iconBtn(head, "git-compare-arrows", t("rewriteHistory.compare"), () => { void (async () => {
      try {
        if (!entry.after) throw new Error("History after-state missing");
        const before = await history.store.state(entry.before);
        const after = await history.store.state(entry.after);
        await openFeuilletsComparison(app, plugin, { kind: "snapshot", sourcePath: after.path, snapshotPath: before.path, allowRestore: false, retainedPair: true });
      } catch (error) { console.error("Feuillets: history comparison unavailable", error); new Notice(t("rewriteHistory.unavailable")); }
    })(); });
    item.createDiv({ cls: "feuillets-notes-metadata-row" })
      .createSpan({ cls: "feuillets-notes-metadata-value", text: t("rewriteHistory.words", { before: String(entry.initialWords), after: String(entry.finalWords), delta: `${entry.delta > 0 ? "+" : ""}${entry.delta}` }) });
    if (entry.recovered) item.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.recovered") });
  };
  for (const group of rewriteHistoryGroups(app, plugin.settings, root, entries, (entry) => history.currentPath(entry))) {
    const wrapper = list.createDiv({ cls: "feuillets-rewrite-group" });
    wrapper.dataset.groupKey = group.key;
    const heading = wrapper.createDiv({ cls: "feuillets-rewrite-group-heading" });
    const title = group.file ? shortTitleFor(app, group.file) : group.entries[0]?.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    const head = heading.createDiv({ cls: "feuillets-tags-row feuillets-rewrite-group-toggle", attr: { role: "button", tabindex: "0", title: group.path ?? group.entries[0]?.path ?? "" } });
    const chevron = head.createSpan({ cls: "feuillets-chevron", attr: { "aria-hidden": "true" } });
    const label = head.createSpan({ cls: "feuillets-rewrite-group-label" });
    label.createSpan({ cls: "feuillets-tags-name feuillets-rewrite-title", text: title });
    label.createSpan({ cls: "feuillets-tags-count feuillets-rewrite-group-summary", text: t(group.entries.length === 1 ? "rewriteHistory.groupOne" : "rewriteHistory.groupMany", {
      count: String(group.entries.length), date: new Date(group.latestAt).toLocaleDateString(getLocale() === "fr" ? "fr-FR" : "en-US"),
    }) });
    if (group.file) iconBtn(heading, "file-text", t("shared.research.openFile"), () => {
      const target = group.path ? app.vault.getAbstractFileByPath(group.path) : null;
      if (target instanceof TFile) void openFileActivating(app, app.workspace.getLeaf(false), target);
    });
    const details = wrapper.createDiv({ cls: "feuillets-rewrite-interventions" });
    let closed = plugin.settings.collapsed[group.key] ?? true;
    const render = (): void => {
      head.setAttr("aria-expanded", String(!closed));
      chevron.setText(closed ? "▸" : "▾");
      details.hidden = closed;
      details.empty();
      if (closed) return;
      let displayed = 0;
      const interventions = details.createDiv();
      const more = details.createEl("button", { cls: "clickable-icon feuillets-rewrite-more", text: t("rewriteHistory.more") });
      const append = (): void => {
        for (const entry of group.entries.slice(displayed, displayed + 30)) row(interventions, entry);
        displayed += 30;
        more.hidden = displayed >= group.entries.length;
      };
      more.addEventListener("click", append);
      append();
    };
    const toggle = (): void => {
      closed = !closed;
      plugin.settings.collapsed[group.key] = closed;
      render();
      void plugin.saveSettings();
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });
    render();
  }
}
