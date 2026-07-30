import { MarkdownRenderer, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_JOURNAL } from "../constants.js";
import { getDayEntry, getLastEntry, journalEntryKeys } from "../services/journal.js";
import { t, getLocale } from "../i18n/index.js";
import { dateKey, statsForDay } from "../utils/journal-stats.js";
import { formatNumber } from "../utils/text-metrics.js";
import { iconBtn, isEditing, openFileActivating } from "../utils/dom.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

type JournalViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type RenderGroupHeadResult = { section: HTMLElement; collapsed: boolean };
type JournalEntry = Awaited<ReturnType<typeof getLastEntry>>;
type JournalStats = Record<string, { start: number; latest: number }>;

function journalStatsFor(settings: FeuilletsSettings): JournalStats {
  const stats = settings.stats;
  if (typeof stats !== "object" || stats === null || Array.isArray(stats)) return {};
  const validStats: JournalStats = {};
  for (const [key, value] of Object.entries(stats)) {
    if (
      typeof value === "object" && value !== null &&
      typeof value.start === "number" && typeof value.latest === "number"
    ) {
      validStats[key] = { start: value.start, latest: value.latest };
    }
  }
  return validStats;
}

function dateLocale(): string {
  return getLocale() === "en" ? "en-US" : "fr-FR";
}

function weekdays(): string[] {
  return [
    t("journal.weekday.mon"), t("journal.weekday.tue"), t("journal.weekday.wed"),
    t("journal.weekday.thu"), t("journal.weekday.fri"), t("journal.weekday.sat"), t("journal.weekday.sun"),
  ];
}

/** Lundi = 0 … Dimanche = 6, contrairement à getDay() (Dimanche = 0). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function readableDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Panneau Journal & statistiques : Journal d'écriture en haut, Statistiques
 * en dessous — empilés dans un seul panneau plutôt qu'à onglets, pour
 * rester visibles ensemble en permanence (contrairement à Projet/Export,
 * qui se consultent rarement en même temps). */
export class JournalView extends BaseFeuilletsView {
  declare plugin: JournalViewPlugin;
  declare targetContainer?: HTMLElement;
  monthCursor: Date;
  viewedDate: Date | null;

  constructor(leaf: WorkspaceLeaf, plugin: JournalViewPlugin) {
    super(leaf, plugin);
    // Journal
    const today = new Date();
    this.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    this.viewedDate = null;
  }

  getViewType(): string {
    return VIEW_JOURNAL;
  }

  getDisplayText(): string {
    return t("journal.displayText");
  }

  getIcon(): string {
    return "calendar";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.render())
    );
    /* Le Journal exigeait déjà un rafraîchissement inconditionnel (son
       calendrier dépend des comptes de mots de tout le projet) — les deux
       sections étant maintenant empilées dans un seul rendu, un
       changement quelconque rafraîchit l'ensemble plutôt que de ne
       cibler que la section Statistiques comme avant la fusion (effet de
       bord sans gravité : au pire quelques rendus de plus). */
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    await this.render();
  }

  changeMonth(delta: number): void {
    this.monthCursor = new Date(
      this.monthCursor.getFullYear(),
      this.monthCursor.getMonth() + delta,
      1
    );
    void this.render();
  }

  openDay(date: Date): void {
    this.viewedDate = date;
    void this.render();
  }

  async compileCarnet(): Promise<void> {
    await this.plugin.compileJournal();
    void this.render();
  }

  async render(force = false): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;
    container.empty();

    /* un seul conteneur défilant pour tout le panneau : `.feuillets-notes-
       container` fixe `height: 100%` + `overflow-y: auto`, en empiler deux
       (un par section) faisait déborder la 2e (Statistiques) hors du
       viewport sans moyen de la faire défiler jusqu'ici. */
    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });
    await this.renderJournalSection(wrapper);
    wrapper.createDiv({ cls: "feuillets-progression-divider" });
    await this.renderProgressionSection(wrapper);
  }

  // ============================ Journal (haut) ============================

  async renderJournalSection(wrapper: HTMLElement): Promise<void> {
    const settings = this.plugin.settings;

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.noProjectFolder"));
      return;
    }

    const header = wrapper.createDiv({ cls: "feuillets-journal-header" });
    const prevBtn = header.createSpan({ cls: "feuillets-journal-nav-btn clickable-icon" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => this.changeMonth(-1));
    header.createSpan({ cls: "feuillets-journal-month" }).setText(
      this.monthCursor.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" })
    );
    const nextBtn = header.createSpan({ cls: "feuillets-journal-nav-btn clickable-icon" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => this.changeMonth(1));
    const compileBtn = iconBtn(header, "refresh-cw", t("journal.compileTooltip"), () => { void this.compileCarnet(); });
    compileBtn.addClass("feuillets-journal-compile-btn");

    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const deltas: number[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      deltas.push(statsForDay({ stats: journalStatsFor(settings) }, dateKey(new Date(year, month, day))).delta);
    }

    const weekRow = wrapper.createDiv({ cls: "feuillets-journal-grid feuillets-journal-weekdays" });
    for (const weekday of weekdays()) {
      weekRow.createDiv({ cls: "feuillets-journal-weekday" }).setText(weekday);
    }

    const grid = wrapper.createDiv({ cls: "feuillets-journal-grid" });
    const firstDay = new Date(year, month, 1);
    const leading = mondayIndex(firstDay);
    const todayKeyStr = dateKey(new Date());
    const entryKeys = journalEntryKeys(this.app, settings);

    for (let index = 0; index < leading; index++) {
      grid.createDiv({ cls: "feuillets-journal-cell feuillets-journal-cell-empty" });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);
      const delta = deltas[day - 1];
      const cell = grid.createDiv({ cls: "feuillets-journal-cell" });
      if (key === todayKeyStr) cell.addClass("feuillets-journal-cell-today");
      cell.createDiv({ cls: "feuillets-journal-daynum" }).setText(String(day));

      if (entryKeys.has(key)) {
        cell.createDiv({ cls: "feuillets-journal-dot" });
      }
      cell.setAttr("title", delta > 0 ? t("journal.wordsCount", { count: String(delta) }) : "");
      cell.addEventListener("click", () => this.openDay(date));
    }

    const section = wrapper.createDiv({ cls: "feuillets-notes-section feuillets-journal-preview" });

    let entry: JournalEntry = null;
    let viewingDay = false;
    if (this.viewedDate) {
      viewingDay = true;
      entry = await getDayEntry(this.app, settings, this.viewedDate);
    }
    if (!viewingDay) {
      entry = await getLastEntry(this.app, settings);
    }

    if (viewingDay) {
      const backBar = section.createDiv({ cls: "feuillets-notes-back-bar" });
      iconBtn(backBar, "arrow-left", t("journal.backToLastEntry"), () => {
        this.viewedDate = null;
        void this.render();
      });
    }

    const head = section.createDiv({ cls: "feuillets-notes-section-head" });
    /* Icône manquante ici alors que toutes les autres en-têtes de section
       du plugin en ont une (Synopsis, Notes, Historique récent…) — sans
       elle, "Dernière entrée" jurait visuellement à côté des sections
       voisines qui suivent toutes le même patron icône + petites
       majuscules. */
    const headIcon = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(headIcon, "calendar");
    head
      .createSpan({ cls: "feuillets-notes-section-title" })
      .setText(viewingDay ? t("journal.journalTitle") : t("journal.lastEntryTitle"));

    if (entry) {
      const dateEl = section
        .createDiv({ cls: "feuillets-journal-last-entry-date" })
        .createSpan({
          cls: "feuillets-journal-open-date",
          text: readableDate(entry.key)
        });
      dateEl.setAttr("style", "cursor: pointer; text-decoration: underline;");
      dateEl.setAttr("aria-label", t("journal.openEditNewTab"));
      dateEl.setAttr("title", t("journal.openEditNewTab"));
      dateEl.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf("tab"), entry.file);
      });

      // Affichage en lecture seule : rendu Markdown
      const body = section.createDiv({ cls: "feuillets-journal-last-entry-body" });
      body.addClass("feuillets-mt-sm");
      await MarkdownRenderer.render(this.app, entry.body || "", body, entry.file.path, this);
    } else {
      if (viewingDay) {
        section
          .createDiv({ cls: "feuillets-empty" })
          .setText(t("journal.noEntryForDay"));

        const createBtn = section.createEl("button", {
          cls: "mod-cta",
          text: t("journal.createAndEditEntry")
        });
        createBtn.setAttr("style", "margin-top: 12px; width: 100%; cursor: pointer;");
        createBtn.addEventListener("click", () => {
          void (async () => {
            const file = await this.plugin.ensureJournalEntry(this.viewedDate);
            if (file) {
              openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
              void this.render();
            }
          })();
        });
      } else {
        section
          .createDiv({ cls: "feuillets-empty" })
          .setText(t("journal.noEntryYet"));
      }
    }
  }

  // ========================= Statistiques (bas) ===========================

  /** En-tête de bloc pliable de premier niveau (Historique récent) — icône
   * + titre, même patron que les sections des autres panneaux. */
  renderGroupHead(container: HTMLElement, key: string, icon: string, title: string, settings: FeuilletsSettings): RenderGroupHeadResult {
    const collapsed = !!settings.collapsed[key];
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });
    head.setAttr("style", "cursor: pointer;");
    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, icon);
    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(title);
    head.addEventListener("click", () => {
      void (async () => {
        if (collapsed) delete settings.collapsed[key];
        else settings.collapsed[key] = true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });
    return { section, collapsed };
  }

  async renderProgressionSection(container: HTMLElement): Promise<void> {
    const settings = this.plugin.settings;
    const wrapper = container.createDiv({ cls: "feuillets-progression-compact" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.noProjectFolder"));
      return;
    }

    /* Le détail par feuillet et les stats globales du projet vivent tous
       les deux dans la modale ouverte d'un clic sur la barre d'état — ce
       panneau ne garde que l'historique, pour laisser toute la place au
       calendrier du Journal juste au-dessus. */
    this.renderHistorySection(wrapper, settings);
  }

  /** Petit histogramme des mots écrits par jour (14 derniers jours) —
   * complémentaire du calendrier du Journal juste au-dessus, pas un
   * doublon : un aperçu de régularité, pas une navigation par jour. */
  renderHistorySection(wrapper: HTMLElement, settings: FeuilletsSettings): void {
    const { section, collapsed } = this.renderGroupHead(
      wrapper, "progression:history", "bar-chart-3", t("journal.recentHistory"), settings
    );
    if (collapsed) return;

    const days = 14;
    const today = new Date();
    const entries: Array<{ date: Date; delta: number }> = [];
    for (let index = days - 1; index >= 0; index--) {
      const date = new Date(today);
      date.setDate(date.getDate() - index);
      entries.push({ date, delta: statsForDay({ stats: journalStatsFor(settings) }, dateKey(date)).delta });
    }
    const max = Math.max(1, ...entries.map((entry) => entry.delta));

    const chart = section.createDiv({ cls: "feuillets-progression-chart" });
    chart.setAttr("style", "margin-top: 8px;");
    for (const entry of entries) {
      const bar = chart.createDiv({ cls: "feuillets-progression-bar" });
      const fill = bar.createDiv({ cls: "feuillets-progression-bar-fill" });
      fill.style.height = `${Math.max(2, Math.round((entry.delta / max) * 100))}%`;
      if (entry.delta === 0) fill.addClass("is-empty");
      bar.setAttr(
        "aria-label",
        t("journal.dayWordsAria", {
          date: entry.date.toLocaleDateString(dateLocale(), { weekday: "short", day: "numeric", month: "short" }),
          count: String(entry.delta),
          s: entry.delta > 1 ? "s" : "",
        })
      );
      bar.setAttr("title", bar.getAttr("aria-label"));
    }

    const total = entries.reduce((sum, entry) => sum + entry.delta, 0);
    section
      .createDiv({ cls: "feuillets-progression-history-total" })
      .setText(t("journal.historyTotal", { total: formatNumber(total), days: String(days) }));
  }
}
