import { Menu, TFile, TFolder } from "obsidian";
import { parseStoryDate } from "../utils/core.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";

export type TimelineItem = NonNullable<ReturnType<typeof parseStoryDate>> & {
  file: TFile;
  milestone?: boolean;
};

export type TimelineRenderContext = {
  settings: Pick<FeuilletsSettings, "timelineOrder" | "timelineTagFilter" | "timelineScale">;
  flattenFiles: (folder: TFolder) => TFile[];
  passesFilter: (file: TFile) => boolean;
  isFrontMatter: (file: TFile) => boolean;
  fm: (file: TFile) => SceneFrontmatter;
  getChronoFolders: () => readonly TFolder[];
  tagsOf: (file: TFile) => string[];
  shortTitleFor: (file: TFile) => string;
  setFm: (file: TFile, key: string, value: unknown) => Promise<void>;
  rerenderAfterDateEdit: () => Promise<void>;
  makeClickToEditFmArea: (parent: HTMLElement, file: TFile, key: string, placeholder: string, maxLines?: number) => HTMLElement;
  openFile: (file: TFile) => void;
};

export type TimelineOptionsContext = {
  settings: Pick<FeuilletsSettings, "timelineOrder" | "timelineTagFilter" | "timelineScale">;
  getChronoFolders: () => readonly TFolder[];
  tagsOf: (file: TFile) => string[];
  saveSettings: () => Promise<void>;
  rerender: () => void;
};

function collectTimelineItems(ctx: TimelineRenderContext, folder: TFolder): { files: TFile[]; items: TimelineItem[] } {
  const files = ctx.flattenFiles(folder).filter((file) => ctx.passesFilter(file) && !ctx.isFrontMatter(file));
  const items: TimelineItem[] = [];
  for (const file of files) {
    const dateObj = parseStoryDate(ctx.fm(file).date, file);
    if (dateObj) items.push({ file, ...dateObj });
  }

  const seenResearchFilePaths = new Set<string>();
  for (const chronoFolder of ctx.getChronoFolders()) {
    const collect = (current: TFolder): void => {
      for (const child of current.children) {
        if (child instanceof TFolder) collect(child);
        else if (child instanceof TFile && child.extension === "md") {
          if (seenResearchFilePaths.has(child.path)) continue;
          const dateObj = parseStoryDate(ctx.fm(child).date, child);
          if (!dateObj) continue;
          const filter = ctx.settings.timelineTagFilter;
          if (filter && !ctx.tagsOf(child).includes(filter)) continue;
          seenResearchFilePaths.add(child.path);
          items.push({ file: child, milestone: true, ...dateObj });
        }
      }
    };
    collect(chronoFolder);
  }
  return { files, items };
}

function sortTimelineItems(items: TimelineItem[], files: TFile[], order: FeuilletsSettings["timelineOrder"]): void {
  if (order === "narratif") {
    const orderedItems = orderTimelineItemsNarratively(items, files);
    items.splice(0, items.length, ...orderedItems);
  } else {
    items.sort(timelineChronologicalCompare);
  }
}

function orderTimelineItemsNarratively(items: TimelineItem[], files: TFile[]): TimelineItem[] {
  const itemsByPath = new Map<string, TimelineItem>();
  for (const item of items) {
    if (!item.milestone) itemsByPath.set(item.file.path, item);
  }

  const manuscriptItems: TimelineItem[] = [];
  for (const file of files) {
    const item = itemsByPath.get(file.path);
    if (item) manuscriptItems.push(item);
  }

  const manuscriptDays = new Set<number>();
  for (const item of manuscriptItems) manuscriptDays.add(item.sort);

  const anchoredMilestones = new Map<number, TimelineItem[]>();
  const unanchoredMilestones: TimelineItem[] = [];
  for (const item of items) {
    if (!item.milestone) continue;
    if (manuscriptDays.has(item.sort)) {
      const milestones = anchoredMilestones.get(item.sort) ?? [];
      milestones.push(item);
      anchoredMilestones.set(item.sort, milestones);
    } else {
      unanchoredMilestones.push(item);
    }
  }

  const result: TimelineItem[] = [];
  const seenDays = new Set<number>();
  for (const item of manuscriptItems) {
    result.push(item);
    if (!seenDays.has(item.sort)) {
      result.push(...(anchoredMilestones.get(item.sort) ?? []));
      seenDays.add(item.sort);
    }
  }
  result.push(...unanchoredMilestones);
  return result;
}

function timelineChronologicalCompare(a: TimelineItem, b: TimelineItem): number {
  const dayOrder = a.sort - b.sort;
  if (dayOrder !== 0) return dayOrder;
  if (a.hour === undefined && b.hour === undefined) return 0;
  if (a.hour === undefined) return -1;
  if (b.hour === undefined) return 1;
  const hourOrder = a.hour - b.hour;
  if (hourOrder !== 0) return hourOrder;
  return (a.minute ?? 0) - (b.minute ?? 0);
}

type TimelineScale = "siecle" | "annee" | "mois" | "jour" | "aucune";

function timelineScalePeriod(item: TimelineItem, scaleValue: string | undefined): { key: string; label: string } | null {
  const scale: TimelineScale = scaleValue === "siecle" || scaleValue === "annee" || scaleValue === "mois" || scaleValue === "jour" || scaleValue === "aucune"
    ? scaleValue
    : scaleValue === undefined || scaleValue === ""
      ? "annee"
      : "aucune";
  if (scale === "aucune") return null;
  if (scale === "annee") {
    const label = String(item.y);
    return { key: `year:${label}`, label };
  }
  if (scale === "mois") {
    if (item.mo > 0) {
      const label = `${item.y}-${String(item.mo).padStart(2, "0")}`;
      return { key: `month:${label}`, label };
    }
    const label = String(item.y);
    return { key: `year:${label}`, label };
  }
  if (scale === "jour") {
    if (item.mo === 0) {
      const label = String(item.y);
      return { key: `year:${label}`, label };
    }
    const month = `${item.y}-${String(item.mo).padStart(2, "0")}`;
    if (item.d === 0) return { key: `month:${month}`, label: month };
    const label = `${month}-${String(item.d).padStart(2, "0")}`;
    return { key: `day:${label}`, label };
  }
  if (item.y > 0) {
    const start = Math.floor((item.y - 1) / 100) * 100 + 1;
    const end = start + 99;
    const label = `${start}–${end}`;
    return { key: `century:${start}`, label };
  }
  const end = Math.ceil(item.y / 100) * 100 - 1;
  const start = end - 99;
  const label = `${start}–${end}`;
  return { key: `century:${start}`, label };
}

export function renderBoardTimeline(container: HTMLElement, folder: TFolder, ctx: TimelineRenderContext): void {
  const collected = collectTimelineItems(ctx, folder);
  sortTimelineItems(collected.items, collected.files, ctx.settings.timelineOrder);

  if (collected.items.length === 0) {
    container.createDiv({ cls: "feuillets-empty", text: t("board.timeline.empty") });
    return;
  }

  const timeline = container.createDiv({ cls: "feuillets-timeline" });
  let previousPeriodKey: string | undefined;
  for (const item of collected.items) {
    const period = timelineScalePeriod(item, ctx.settings.timelineScale);
    if (period && period.key !== previousPeriodKey) {
      timeline.createDiv({ cls: "feuillets-timeline-year", text: period.label });
      previousPeriodKey = period.key;
    }
    const row = timeline.createDiv({ cls: item.milestone ? "feuillets-timeline-item feuillets-timeline-milestone" : "feuillets-timeline-item" });
    const dateContainer = row.createDiv({ cls: "feuillets-timeline-date" });
    const dateDisplay = dateContainer.createDiv({ cls: "feuillets-timeline-date-display", text: item.display });
    dateDisplay.addEventListener("click", (event) => {
      event.stopPropagation();
      dateDisplay.hide();
      const textarea = dateContainer.createEl("textarea", { cls: "feuillets-flat-textarea feuillets-autosize" });
      textarea.value = toValue(ctx.fm(item.file).date);
      textarea.focus();
      textarea.style.removeProperty("height");
      textarea.style.height = `${textarea.scrollHeight}px`;
      const saveDateEdit = async (): Promise<void> => {
        if (textarea.parentNode) {
          const raw = textarea.value.trim();
          if (raw !== toValue(ctx.fm(item.file).date)) {
            await ctx.setFm(item.file, "date", raw);
            await ctx.rerenderAfterDateEdit();
          }
          textarea.remove();
          dateDisplay.show();
        }
      };
      textarea.addEventListener("blur", () => { void saveDateEdit(); });
      textarea.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" || (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey))) textarea.blur();
      });
    });

    row.createDiv({ cls: "feuillets-timeline-dot" });
    const body = row.createDiv({ cls: "feuillets-timeline-body" });
    const head = body.createDiv({ cls: "feuillets-timeline-head" });
    head.createSpan({ cls: "feuillets-timeline-title", text: ctx.shortTitleFor(item.file) }).addEventListener("click", () => ctx.openFile(item.file));
    const synopsisHost = body.createDiv({ cls: "feuillets-timeline-syn" });
    ctx.makeClickToEditFmArea(synopsisHost, item.file, "synopsis", "—", 6);
  }
}

export function buildBoardTimelineOptionsMenu(menu: Menu, ctx: TimelineOptionsContext): void {
  const { settings } = ctx;
  menu.addItem((item) => item.setTitle(t("board.options.timelineHeader")).setDisabled(true));
  for (const [value, label] of [["chrono", t("board.options.chronoOrder")], ["narratif", t("board.options.narrativeOrder")]]) {
    menu.addItem((item) => item.setTitle(label).setChecked(settings.timelineOrder === value).onClick(async () => {
      settings.timelineOrder = value;
      await ctx.saveSettings();
      ctx.rerender();
    }));
  }
  menu.addSeparator();
  menu.addItem((item) => item.setTitle(t("board.options.allMilestones")).setChecked(!settings.timelineTagFilter).onClick(async () => {
    settings.timelineTagFilter = "";
    await ctx.saveSettings();
    ctx.rerender();
  }));
  for (const chronoFolder of ctx.getChronoFolders()) {
    const tags = new Set<string>();
    const collect = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) collect(child);
        else if (child instanceof TFile && child.extension === "md") {
          for (const tag of ctx.tagsOf(child)) tags.add(tag);
        }
      }
    };
    collect(chronoFolder);
    const collator = new Intl.Collator("fr");
    for (const tag of [...tags].sort((a, b) => collator.compare(a, b))) {
      menu.addItem((item) => item.setTitle(`#${tag}`).setChecked(settings.timelineTagFilter === tag).onClick(async () => {
        settings.timelineTagFilter = tag;
        await ctx.saveSettings();
        ctx.rerender();
      }));
    }
  }
  menu.addSeparator();
  for (const [value, label] of [
    ["siecle", t("board.options.scaleCentury")],
    ["annee", t("board.options.scaleYear")],
    ["mois", t("board.options.scaleMonth")],
    ["jour", t("board.options.scaleDay")],
    ["aucune", t("board.options.scaleNone")],
  ]) {
    menu.addItem((item) => item.setTitle(label).setChecked((settings.timelineScale || "annee") === value).onClick(async () => {
      settings.timelineScale = value;
      await ctx.saveSettings();
      ctx.rerender();
    }));
  }
}
