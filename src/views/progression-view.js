const { ItemView } = require("obsidian");

import { VIEW_PROGRESSION } from "../constants.js";
import { countWords } from "../utils/core.js";
import { stripWritingNoise, countSentences, countParagraphs, formatNumber } from "../utils/text-metrics.js";
import { iconBtn } from "../utils/dom.js";

export class ProgressionView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentPath = null;
  }
  getViewType() {
    return VIEW_PROGRESSION;
  }
  getDisplayText() {
    return "Progression";
  }
  getIcon() {
    return "trending-up";
  }
  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.render())
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.currentPath) this.render();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path === this.currentPath) this.render();
      })
    );
    await this.render();
  }

  /** En-tête de bloc pliable de premier niveau (Statistiques globales,
   * Feuillet actif) — pas de sous-titre à l'intérieur, juste ce seul
   * niveau de titre. */
  renderGroupHead(container, key, title, S) {
    const collapsed = !!S.collapsed[key];
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head", style: "cursor: pointer;" });
    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(title);
    head.addEventListener("click", async () => {
      if (collapsed) delete S.collapsed[key];
      else S.collapsed[key] = true;
      await this.plugin.saveSettings();
      this.render();
    });
    return { section, collapsed };
  }

  async render() {
    const S = this.plugin.settings;
    const container = this.contentEl;
    container.empty();

    const wrapper = container.createDiv({ cls: "feuillets-notes-container feuillets-progression-compact" });



    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Configure d'abord un dossier projet dans les réglages.");
      this.currentPath = null;
      return;
    }

    // 1. Statistiques globales (compteurs + objectif du projet, fusionnés)
    const { section: globalSection, collapsed: globalCollapsed } = this.renderGroupHead(
      wrapper, "progression:global", "Statistiques globales", S
    );
    if (!globalCollapsed) {
      const globalContent = globalSection.createDiv({ style: "margin-top: 8px; display: flex; flex-direction: column; gap: 12px;" });
      await this.renderProjectMetadataSection(globalContent, root, S);
    }

    // Espace net entre les deux rubriques — sans lui, plus aucun sous-titre
    // ("Compteurs"/"Compteurs du projet" retirés) ne les distingue.
    wrapper.createDiv({ cls: "feuillets-progression-divider" });

    // 2. Feuillet actif (compteurs + objectif de la scène, fusionnés)
    const { section: chapterSection, collapsed: chapterCollapsed } = this.renderGroupHead(
      wrapper, "progression:chapter", "Feuillet actif", S
    );
    if (!chapterCollapsed) {
      const chapterContent = chapterSection.createDiv({ style: "margin-top: 8px; display: flex; flex-direction: column; gap: 12px;" });
      const file = this.app.workspace.getActiveFile();
      if (!file || !file.path.startsWith(root.path + "/")) {
        chapterContent
          .createDiv({ cls: "feuillets-empty", style: "margin-top: 8px;" })
          .setText("Ouvre un feuillet du projet pour voir sa progression.");
        this.currentPath = null;
      } else {
        this.currentPath = file.path;
        const fm = this.plugin.fmOf(file);
        await this.renderMetadataSection(chapterContent, file, fm, S);
      }
    }
  }

  /** Carte objectif/progression (barre de pourcentage) — partagée par la
   * scène active et le projet entier, avant la liste de compteurs. */
  renderGoalCard(container, label, wc, goal, S) {
    const wcCard = container.createDiv({ cls: "feuillets-wc-card", style: "margin-bottom: 0;" });
    const wcHeader = wcCard.createDiv({ cls: "feuillets-wc-header" });
    const wcLabel = wcHeader.createDiv({ cls: "feuillets-wc-label", text: label });
    const wcValue = wcHeader.createDiv({ cls: "feuillets-wc-value" });
    wcValue.setText(goal > 0 ? `${wc} / ${goal}` : `${wc}`);

    if (goal > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((wc / goal) * 100)));
      const bar = wcCard.createDiv({ cls: "feuillets-wc-bar" });
      const fill = bar.createDiv({ cls: "feuillets-wc-fill" });
      fill.style.width = `${pct}%`;
      wcLabel.setText(`${label} (${pct}%)`);

      const tol = S.tolerance;
      if (wc >= goal - tol && wc <= goal + tol) {
        fill.addClass("feuillets-status-hit");
      } else if (wc > goal + tol) {
        fill.addClass("feuillets-status-over");
      }
    }
  }

  async renderMetadataSection(container, file, fm, S) {
    const section = container.createDiv({ cls: "feuillets-notes-section" });

    const rawText = await this.app.vault.cachedRead(file);
    const wc = countWords(rawText);
    const g = parseInt(fm.objectif, 10);
    const goal = isNaN(g) ? S.wordGoal : g;
    this.renderGoalCard(section, "Mots", wc, goal, S);

    const list = section.createDiv({ cls: "feuillets-notes-metadata-list", style: "margin-top: 8px;" });
    let bodyText = "";
    try {
      bodyText = await this.app.vault.read(file);
    } catch (e) {}
    const cleanText = stripWritingNoise(bodyText);

    const chars = cleanText.length;
    const charsNoSpaces = cleanText.replace(/\s/g, "").length;
    const words = countWords(cleanText);
    const sentences = countSentences(cleanText);
    const wordsPerSentence = sentences > 0 ? (words / sentences).toFixed(1) : "0";
    const paragraphs = countParagraphs(cleanText);
    const estPages = Math.max(1, Math.ceil(words / 250));
    const readTime = Math.max(1, Math.ceil(words / 200));

    const addRow = (label, value) => {
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: String(value) });
    };

    addRow("Caractères", formatNumber(chars));
    addRow("Sans espaces", formatNumber(charsNoSpaces));
    addRow("Phrases", formatNumber(sentences));
    addRow("Mots/phrase", wordsPerSentence);
    addRow("Paragraphes", formatNumber(paragraphs));
    addRow("Pages", formatNumber(estPages));
    addRow("Temps de lecture", `${readTime} min`);
  }

  async renderProjectMetadataSection(container, root, S) {
    const section = container.createDiv({ cls: "feuillets-notes-section" });

    const files = this.plugin.flattenFiles(root);
    const counts = await this.plugin.getWordCounts(files);
    let chars = 0, charsNoSpaces = 0, words = 0, sentences = 0, paragraphs = 0;
    for (const f of files) {
      const c = counts.get(f.path);
      if (!c) continue;
      chars += c.chars || 0;
      charsNoSpaces += c.charsNoSpaces || 0;
      words += c.wc || 0;
      sentences += c.sentences || 0;
      paragraphs += c.paragraphs || 0;
    }
    this.renderGoalCard(section, "Mots", words, S.projectWordGoal || 0, S);

    const wordsPerSentence = sentences > 0 ? (words / sentences).toFixed(1) : "0";
    const estPages = Math.max(1, Math.ceil(words / 250));
    const readTime = Math.max(1, Math.ceil(words / 200));

    const list = section.createDiv({ cls: "feuillets-notes-metadata-list", style: "margin-top: 8px;" });
    const addRow = (label, value) => {
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: String(value) });
    };

    addRow("Caractères", formatNumber(chars));
    addRow("Sans espaces", formatNumber(charsNoSpaces));
    addRow("Phrases", formatNumber(sentences));
    addRow("Mots/phrase", wordsPerSentence);
    addRow("Paragraphes", formatNumber(paragraphs));
    addRow("Pages", formatNumber(estPages));
    addRow("Temps de lecture", `${readTime} min`);
  }

}
