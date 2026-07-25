const { setIcon, MarkdownRenderer } = require("obsidian");

import { VIEW_JOURNAL } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { formatNumber } from "../utils/text-metrics.js";
import { isEditing, iconBtn, openFileActivating } from "../utils/dom.js";
import { dateKey, statsForDay } from "../utils/journal-stats.js";
import { journalEntryKeys, getLastEntry, getDayEntry } from "../services/journal.js";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Lundi = 0 … Dimanche = 6, contrairement à getDay() (Dimanche = 0). */
function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function readableDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", {
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
  constructor(leaf, plugin) {
    super(leaf, plugin);
    // Journal
    const today = new Date();
    this.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    this.viewedDate = null;
  }
  getViewType() {
    return VIEW_JOURNAL;
  }
  getDisplayText() {
    return "Journal & statistiques";
  }
  getIcon() {
    return "calendar";
  }
  async onOpen() {
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

  changeMonth(delta) {
    this.monthCursor = new Date(
      this.monthCursor.getFullYear(),
      this.monthCursor.getMonth() + delta,
      1
    );
    this.render();
  }

  openDay(date) {
    this.viewedDate = date;
    this.render();
  }

  async compileCarnet() {
    await this.plugin.compileJournal();
    this.render();
  }

  async render(force = false) {
    const S = this.plugin.settings;
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

  async renderJournalSection(wrapper) {
    const S = this.plugin.settings;

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Configure d'abord un dossier projet dans les réglages.");
      return;
    }

    const header = wrapper.createDiv({ cls: "feuillets-journal-header" });
    const prevBtn = header.createSpan({ cls: "feuillets-journal-nav-btn clickable-icon" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => this.changeMonth(-1));
    header.createSpan({ cls: "feuillets-journal-month" }).setText(
      this.monthCursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
    );
    const nextBtn = header.createSpan({ cls: "feuillets-journal-nav-btn clickable-icon" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => this.changeMonth(1));
    const compileBtn = iconBtn(header, "refresh-cw", "Compiler le carnet", () => this.compileCarnet());
    compileBtn.addClass("feuillets-journal-compile-btn");

    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const deltas = [];
    for (let d = 1; d <= daysInMonth; d++) {
      deltas.push(statsForDay(S, dateKey(new Date(year, month, d))).delta);
    }

    const weekRow = wrapper.createDiv({ cls: "feuillets-journal-grid feuillets-journal-weekdays" });
    for (const w of WEEKDAYS) {
      weekRow.createDiv({ cls: "feuillets-journal-weekday" }).setText(w);
    }

    const grid = wrapper.createDiv({ cls: "feuillets-journal-grid" });
    const firstDay = new Date(year, month, 1);
    const leading = mondayIndex(firstDay);
    const todayKeyStr = dateKey(new Date());
    const entryKeys = journalEntryKeys(this.app, S);

    for (let i = 0; i < leading; i++) {
      grid.createDiv({ cls: "feuillets-journal-cell feuillets-journal-cell-empty" });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const key = dateKey(date);
      const delta = deltas[d - 1];
      const cell = grid.createDiv({ cls: "feuillets-journal-cell" });
      if (key === todayKeyStr) cell.addClass("feuillets-journal-cell-today");
      cell.createDiv({ cls: "feuillets-journal-daynum" }).setText(String(d));

      if (entryKeys.has(key)) {
        cell.createDiv({ cls: "feuillets-journal-dot" });
      }
      cell.setAttr("title", delta > 0 ? `${delta} mots` : "");
      cell.addEventListener("click", () => this.openDay(date));
    }

    const section = wrapper.createDiv({ cls: "feuillets-notes-section feuillets-journal-preview" });

    let entry = null;
    let viewingDay = false;
    if (this.viewedDate) {
      viewingDay = true;
      entry = await getDayEntry(this.app, S, this.viewedDate);
    }
    if (!viewingDay) {
      entry = await getLastEntry(this.app, S);
    }

    if (viewingDay) {
      const backBar = section.createDiv({ cls: "feuillets-notes-back-bar" });
      iconBtn(backBar, "arrow-left", "Retour à la dernière entrée", () => {
        this.viewedDate = null;
        this.render();
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
      .setText(viewingDay ? "Journal" : "Dernière entrée");

    if (entry) {
      const dateEl = section
        .createDiv({ cls: "feuillets-journal-last-entry-date" })
        .createSpan({
          cls: "feuillets-journal-open-date",
          text: readableDate(entry.key),
          style: "cursor: pointer; text-decoration: underline;"
        });
      dateEl.setAttr("aria-label", "Ouvrir et éditer dans un nouvel onglet");
      dateEl.setAttr("title", "Ouvrir et éditer dans un nouvel onglet");
      dateEl.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf("tab"), entry.file);
      });

      // Affichage en lecture seule : rendu Markdown
      const body = section.createDiv({ cls: "feuillets-journal-last-entry-body" });
      body.style.marginTop = "8px";
      await MarkdownRenderer.render(this.app, entry.body || "", body, entry.file.path, this);
    } else {
      if (viewingDay) {
        section
          .createDiv({ cls: "feuillets-empty" })
          .setText("Aucune entrée pour ce jour.");

        const createBtn = section.createEl("button", {
          cls: "mod-cta",
          text: "Créer et éditer l'entrée",
          style: "margin-top: 12px; width: 100%; cursor: pointer;"
        });
        createBtn.addEventListener("click", async () => {
          const file = await this.plugin.ensureJournalEntry(this.viewedDate);
          if (file) {
            openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
            this.render();
          }
        });
      } else {
        section
          .createDiv({ cls: "feuillets-empty" })
          .setText("Aucune entrée pour l'instant — clique un jour pour commencer.");
      }
    }
  }

  // ========================= Statistiques (bas) ===========================

  /** En-tête de bloc pliable de premier niveau (Historique récent) — icône
   * + titre, même patron que les sections des autres panneaux. */
  renderGroupHead(container, key, icon, title, S) {
    const collapsed = !!S.collapsed[key];
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head", style: "cursor: pointer;" });
    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, icon);
    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(title);
    head.addEventListener("click", async () => {
      if (collapsed) delete S.collapsed[key];
      else S.collapsed[key] = true;
      await this.plugin.saveSettings();
      this.render();
    });
    return { section, collapsed };
  }

  async renderProgressionSection(container) {
    const S = this.plugin.settings;
    const wrapper = container.createDiv({ cls: "feuillets-progression-compact" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Configure d'abord un dossier projet dans les réglages.");
      return;
    }

    /* Le détail par feuillet et les stats globales du projet vivent tous
       les deux dans la modale ouverte d'un clic sur la barre d'état — ce
       panneau ne garde que l'historique, pour laisser toute la place au
       calendrier du Journal juste au-dessus. */
    this.renderHistorySection(wrapper, S);
  }

  /** Petit histogramme des mots écrits par jour (14 derniers jours) —
   * complémentaire du calendrier du Journal juste au-dessus, pas un
   * doublon : un aperçu de régularité, pas une navigation par jour. */
  renderHistorySection(wrapper, S) {
    const { section, collapsed } = this.renderGroupHead(
      wrapper, "progression:history", "bar-chart-3", "Historique récent", S
    );
    if (collapsed) return;

    const days = 14;
    const today = new Date();
    const entries = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      entries.push({ date: d, delta: statsForDay(S, dateKey(d)).delta });
    }
    const max = Math.max(1, ...entries.map((e) => e.delta));

    const chart = section.createDiv({ cls: "feuillets-progression-chart", style: "margin-top: 8px;" });
    for (const e of entries) {
      const bar = chart.createDiv({ cls: "feuillets-progression-bar" });
      const fill = bar.createDiv({ cls: "feuillets-progression-bar-fill" });
      fill.style.height = `${Math.max(2, Math.round((e.delta / max) * 100))}%`;
      if (e.delta === 0) fill.addClass("is-empty");
      bar.setAttr(
        "aria-label",
        `${e.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} : ${e.delta} mot${e.delta > 1 ? "s" : ""}`
      );
      bar.setAttr("title", bar.getAttr("aria-label"));
    }

    const total = entries.reduce((s, e) => s + e.delta, 0);
    section
      .createDiv({ cls: "feuillets-progression-history-total" })
      .setText(`${formatNumber(total)} mots sur les ${days} derniers jours`);
  }

}
