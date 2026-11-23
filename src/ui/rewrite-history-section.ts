import { Notice, TFile, type App, type TFolder } from "obsidian";
import type { RewriteHistoryController } from "../services/rewrite-history-controller.js";
import type { RewriteHistory } from "../services/rewrite-history.js";
import type { RewriteEntry } from "../services/rewrite-history-store.js";
import { shortTitleFor } from "../services/frontmatter.js";
import { openFeuilletsComparison, type ComparisonPlugin } from "../views/comparison-view.js";
import { iconBtn, openFileActivating } from "../utils/dom.js";
import { getLocale, t } from "../i18n/index.js";
import { rewriteHistoryGroups, type RewriteHistoryGroup } from "./rewrite-history-groups.js";

export type HistorySectionHost = ComparisonPlugin & { rewriteHistory?: RewriteHistoryController; saveSettings(): Promise<void> };
type SectionHead = (container: HTMLElement) => { section: HTMLElement; collapsed: boolean };
const locale = (): string => getLocale() === "fr" ? "fr-FR" : "en-US";
const date = (time: number): string => new Date(time).toLocaleString(locale());
function period(start: number, end: number): string {
  const from = new Date(start);
  const to = new Date(end);
  const time = (value: Date): string => value.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (from.toDateString() !== to.toDateString()) return `${date(start)} — ${date(end)}`;
  const first = time(from);
  const last = time(to);
  return `${from.toLocaleDateString(locale())} · ${first === last ? first : `${first}–${last}`}`;
}

export function rewriteHistorySummary(count: number, last: number): string {
  return count ? t(count === 1 ? "rewriteHistory.groupOne" : "rewriteHistory.groupMany", {
    count: String(count), date: new Date(last).toLocaleDateString(locale()),
  }) : t("rewriteHistory.groupEmpty");
}

async function compare(history: RewriteHistory, plugin: HistorySectionHost, entry: RewriteEntry, current: boolean, trigger: HTMLButtonElement): Promise<void> {
  const { app } = plugin;
  try {
    if (!entry.after) throw new Error("History after-state missing");
    const after = await history.store.state(entry.after);
    if (current) {
      const path = history.currentPath(entry);
      const file = path ? app.vault.getAbstractFileByPath(path) : null;
      if (!(file instanceof TFile) || !(await history.list(file)).some((item) => item.id === entry.id)) {
        new Notice(t("rewriteHistory.sourceUnavailable"));
        return;
      }
      await openFeuilletsComparison(app, plugin, {
        kind: "snapshot", sourcePath: file.path, snapshotPath: after.path, allowRestore: false,
        historyCurrent: { date: date(entry.endedAt) },
      }, trigger);
    } else {
      const before = await history.store.state(entry.before);
      await openFeuilletsComparison(app, plugin, { kind: "snapshot", sourcePath: after.path, snapshotPath: before.path, allowRestore: false, retainedPair: true }, trigger);
    }
  } catch (error) {
    console.error("Feuillets: history comparison unavailable", error);
    new Notice(t("rewriteHistory.unavailable"));
  }
}

function renderEntry(parent: HTMLElement, history: RewriteHistory, plugin: HistorySectionHost, entry: RewriteEntry, withCurrent: boolean): HTMLElement {
  const item = parent.createDiv({ cls: "feuillets-rewrite-entry" });
  item.dataset.entryId = entry.id;
  const when = period(entry.startedAt, entry.endedAt);
  const words = t("rewriteHistory.words", {
    before: String(entry.initialWords), after: String(entry.finalWords), delta: `${entry.delta > 0 ? "+" : ""}${entry.delta}`,
  });
  const action = t("rewriteHistory.compare");
  const primary = item.createEl("button", {
    cls: "feuillets-rewrite-primary", attr: {
      type: "button",
      "aria-label": `${action} · ${when} · ${words}`,
      title: `${action}\n${date(entry.startedAt)} — ${date(entry.endedAt)}\n${entry.origins.map((origin) => t(`rewriteHistory.origin.${origin}`)).join(", ")}`,
    },
  });
  primary.createSpan({ cls: "feuillets-notes-sub", text: when });
  primary.createSpan({ cls: "feuillets-notes-metadata-value", text: words });
  if (entry.recovered) primary.createSpan({ cls: "feuillets-notes-sub", text: t("rewriteHistory.recovered") });
  primary.addEventListener("click", () => { void compare(history, plugin, entry, false, primary); });
  if (withCurrent) {
    const label = t("rewriteHistory.compareCurrent");
    const current = item.createEl("button", {
      cls: "feuillets-rewrite-current",
      attr: { type: "button", "aria-label": label, title: t("rewriteHistory.compareCurrentHint") },
    });
    current.createSpan({ cls: "feuillets-rewrite-current-full", text: label });
    current.createSpan({ cls: "feuillets-rewrite-current-short", text: t("rewriteHistory.compareCurrentShort"), attr: { "aria-hidden": "true" } });
    current.addEventListener("click", () => { void compare(history, plugin, entry, true, current); });
  }
  return item;
}

/** Inserts new rows next to existing ones, without detaching the focused row. */
function orderNodes(parent: HTMLElement, nodes: HTMLElement[]): void {
  let next: Element | null = parent.firstElementChild;
  for (const node of nodes) {
    if (node === next) next = next.nextElementSibling;
    else parent.insertBefore(node, next);
  }
}

export function mountRewriteHistoryEntries(host: HTMLElement, history: RewriteHistory, plugin: HistorySectionHost, contextual = false): (entries: RewriteEntry[], hasSource?: boolean) => void {
  const interventions = host.createDiv();
  const empty = host.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.empty") });
  const more = host.createEl("button", { cls: "clickable-icon feuillets-rewrite-more", text: t("rewriteHistory.more") });
  const rows = new Map<string, HTMLElement>();
  let limit = 30;
  let entries: RewriteEntry[] = [];
  let hasSource = true;
  const update = (next: RewriteEntry[], available = true): void => {
    entries = next;
    if (hasSource !== available) {
      for (const row of rows.values()) row.remove();
      rows.clear();
      hasSource = available;
    }
    const visible = entries.slice(0, limit);
    const displayed = new Set(visible.map((entry) => entry.id));
    // Keep rows the user already paged to when new interventions arrive.
    for (const entry of entries) if (rows.has(entry.id)) displayed.add(entry.id);
    for (const [id, row] of rows) if (!displayed.has(id)) { row.remove(); rows.delete(id); }
    const ordered: HTMLElement[] = [];
    for (const entry of entries) {
      if (!displayed.has(entry.id)) continue;
      let row = rows.get(entry.id);
      if (!row) { row = renderEntry(interventions, history, plugin, entry, available); rows.set(entry.id, row); }
      ordered.push(row);
    }
    orderNodes(interventions, ordered);
    empty.hidden = entries.length > 0;
    // A focused pagination control remains mounted if loading exhausts the list.
    more.hidden = ordered.length >= entries.length && more.ownerDocument?.activeElement !== more;
    more.setAttr("aria-disabled", String(ordered.length >= entries.length));
  };
  more.addEventListener("click", () => {
    if (rows.size >= entries.length) return;
    limit = rows.size + 30;
    update(entries, hasSource);
  });
  more.addEventListener("blur", () => { more.hidden = rows.size >= entries.length; });
  if (contextual) host.addClass("feuillets-rewrite-context-entries");
  return update;
}

type MountedHistory = {
  root: TFolder;
  section: HTMLElement;
  collapsed: boolean;
  list?: HTMLElement;
  error?: HTMLElement;
  empty?: HTMLElement;
  groups: Map<string, ReturnType<typeof mountGroup>>;
};
const mounted = new WeakMap<HTMLElement, MountedHistory>();

function mountGroup(list: HTMLElement, history: RewriteHistory, plugin: HistorySectionHost, initial: RewriteHistoryGroup) {
  let group = initial;
  const wrapper = list.createDiv({ cls: "feuillets-rewrite-group" });
  wrapper.dataset.groupKey = group.key;
  const heading = wrapper.createDiv({ cls: "feuillets-rewrite-group-heading" });
  const head = heading.createDiv({ cls: "feuillets-tags-row feuillets-rewrite-group-toggle", attr: { role: "button", tabindex: "0" } });
  const chevron = head.createSpan({ cls: "feuillets-chevron", attr: { "aria-hidden": "true" } });
  const label = head.createSpan({ cls: "feuillets-rewrite-group-label" });
  const title = label.createSpan({ cls: "feuillets-tags-name feuillets-rewrite-title" });
  const summary = label.createSpan({ cls: "feuillets-tags-count feuillets-rewrite-group-summary" });
  const open = iconBtn(heading, "file-text", t("shared.research.openFile"), () => {
    const target = group.path ? plugin.app.vault.getAbstractFileByPath(group.path) : null;
    if (target instanceof TFile) void openFileActivating(plugin.app, plugin.app.workspace.getLeaf(false), target);
  });
  const details = wrapper.createDiv({ cls: "feuillets-rewrite-interventions" });
  let entries: ReturnType<typeof mountRewriteHistoryEntries> | undefined;
  const update = (next: RewriteHistoryGroup): void => {
    group = next;
    const latest = group.entries[0];
    title.setText(group.file ? shortTitleFor(plugin.app, group.file) : latest.path.split("/").pop()?.replace(/\.md$/i, "") ?? "");
    head.setAttr("title", group.path ?? latest.path);
    summary.setText(rewriteHistorySummary(group.entries.length, group.latestAt));
    open.hidden = !group.file;
    const closed = plugin.settings.collapsed[group.key] ?? true;
    head.setAttr("aria-expanded", String(!closed));
    chevron.setText(closed ? "▸" : "▾");
    details.hidden = closed;
    if (closed) {
      if (entries) details.empty();
      entries = undefined;
    } else {
      entries ??= mountRewriteHistoryEntries(details, history, plugin);
      entries(group.entries, !!group.file);
    }
  };
  const toggle = (): void => {
    plugin.settings.collapsed[group.key] = !(plugin.settings.collapsed[group.key] ?? true);
    update(group);
    void plugin.saveSettings();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  });
  return { wrapper, update };
}

/** The Journal owns the section header; background updates reconcile its groups. */
export async function renderRewriteHistorySection(container: HTMLElement, app: App, plugin: HistorySectionHost, root: TFolder, renderHead: SectionHead): Promise<void> {
  const history = plugin.rewriteHistory?.forRoot(root);
  if (!history) return;
  const entries = await history.list();
  if (container.isConnected === false || (plugin.getProjectFolder && plugin.getProjectFolder() !== root)) return;
  const scroller = container.closest?.(".feuillets-notes-container");
  const scroll = scroller?.scrollTop;
  let view = mounted.get(container);
  const closed = !!plugin.settings.collapsed["journal:rewrite-history"];
  if (view && (view.root !== root || view.collapsed !== closed || view.section.parentElement !== container)) {
    view.section.remove();
    mounted.delete(container);
    view = undefined;
  }
  if (!view && !plugin.settings.automaticRewriteHistory && !entries.length && !history.hasError) return;
  if (!view) {
    const { section, collapsed } = renderHead(container);
    section.addClass("feuillets-rewrite-history");
    view = { root, section, collapsed, groups: new Map() };
    if (!collapsed) {
      view.error = section.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.error") });
      view.empty = section.createDiv({ cls: "feuillets-notes-sub", text: t("rewriteHistory.empty") });
      view.list = section.createDiv({ cls: "feuillets-notes-metadata-list feuillets-rewrite-list" });
    }
    mounted.set(container, view);
  }
  const { list, error, empty } = view;
  if (!list || !error || !empty) return;
  error.hidden = !history.hasError;
  empty.hidden = entries.length > 0;
  const groups = rewriteHistoryGroups(app, plugin.settings, root, entries, (entry) => history.currentPath(entry));
  const keys = new Set(groups.map((group) => group.key));
  for (const [key, group] of view.groups) if (!keys.has(key)) { group.wrapper.remove(); view.groups.delete(key); }
  const ordered = groups.map((group) => {
    let existing = view.groups.get(group.key);
    if (!existing) { existing = mountGroup(list, history, plugin, group); view.groups.set(group.key, existing); }
    existing.update(group);
    return existing.wrapper;
  });
  orderNodes(list, ordered);
  if (scroller && scroll !== undefined) scroller.scrollTop = scroll;
}
