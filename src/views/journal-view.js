const { ItemView, MarkdownRenderer, setIcon } = require("obsidian");

import { VIEW_JOURNAL } from "../constants.js";
import { dateKey, statsForDay } from "../utils/journal-stats.js";
import { journalEntryKeys, getLastEntry, getDayEntry } from "../services/journal.js";
import { countWords } from "../utils/core.js";
import { isEditing, iconBtn, openFileActivating } from "../utils/dom.js";

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

export class JournalView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const today = new Date();
    this.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    this.viewedDate = null;
  }
  getViewType() {
    return VIEW_JOURNAL;
  }
  getDisplayText() {
    return "Journal d'écriture";
  }
  getIcon() {
    return "calendar";
  }
  async onOpen() {
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
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    container.empty();
    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

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
}
