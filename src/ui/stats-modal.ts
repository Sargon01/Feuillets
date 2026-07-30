import { Modal, type App, type TFile, type TFolder } from "obsidian";

import { countWords } from "../utils/core.js";
import { stripWritingNoise, countSentences, countParagraphs, formatNumber } from "../utils/text-metrics.js";
import { t } from "../i18n/index.js";

type StatsSettings = FeuilletsSettings & {
  /* Absent de DEFAULT_SETTINGS (voir default-settings.ts) : réglable via
     l'onglet réglages sans valeur par défaut déclarée, donc réellement
     de type inconnu tant qu'aucun projet ne l'a défini. */
  tolerance?: unknown;
  wordGoal: number;
  projectWordGoal?: number;
  deadlineDate?: string;
};

type WordCount = {
  chars?: number;
  charsNoSpaces?: number;
  wc?: number;
  sentences?: number;
  paragraphs?: number;
};

type StatsPlugin = {
  settings: StatsSettings;
  titleFor(file: TFile): string;
  fmOf(file: TFile): SceneFrontmatter;
  getProjectFolder(): TFolder | null;
  flattenFiles(folder: TFolder): TFile[];
  getWordCounts(files: TFile[]): Promise<Map<string, WordCount>>;
};

type StatsBlock = {
  list: HTMLElement;
  addRow: (label: string, value: string | number) => void;
};

/** Statistiques complètes — ouvertes d'un clic sur la barre d'état : le
 * détail du feuillet actif, puis les stats globales du projet entier.
 * Ni l'un ni l'autre n'a de section dédiée dans un panneau : à la demande
 * plutôt que d'alourdir en permanence Journal ou Projet & export. */
export class FileStatsModal extends Modal {
  plugin: StatsPlugin;
  file: TFile;

  constructor(app: App, plugin: StatsPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  /** Carte objectif/mots (barre de pourcentage) + liste de compteurs —
   * même structure pour le feuillet actif et pour le projet entier. */
  renderStatsBlock(
    container: HTMLElement,
    label: string,
    wc: number,
    goal: number,
    chars: number,
    charsNoSpaces: number,
    sentences: number,
    paragraphs: number,
  ): StatsBlock {
    const wcCard = container.createDiv({ cls: "feuillets-wc-card" });
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

      const tol = Number(this.plugin.settings.tolerance);
      if (wc >= goal - tol && wc <= goal + tol) fill.addClass("feuillets-status-hit");
      else if (wc > goal + tol) fill.addClass("feuillets-status-over");
    }

    const wordsPerSentence = sentences > 0 ? (wc / sentences).toFixed(1) : "0";
    const estPages = Math.max(1, Math.ceil(wc / 250));
    const readTime = Math.max(1, Math.ceil(wc / 200));

    const list = container.createDiv({ cls: "feuillets-notes-metadata-list feuillets-stats-metadata-list" });
    const addRow = (rLabel: string, value: string | number): void => {
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: rLabel });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: String(value) });
    };
    addRow(t("modal.stats.characters"), formatNumber(chars));
    addRow(t("modal.stats.withoutSpaces"), formatNumber(charsNoSpaces));
    addRow(t("analysis.metrics.sentences"), formatNumber(sentences));
    addRow(t("modal.stats.wordsPerSentence"), wordsPerSentence);
    addRow(t("analysis.metrics.paragraphs"), formatNumber(paragraphs));
    addRow(t("modal.stats.pages"), formatNumber(estPages));
    addRow(t("modal.stats.readingTime"), t("modal.stats.minutes", { count: String(readTime) }));
    return { list, addRow };
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    const { app, plugin, file } = this;

    // ------------------------------- Feuillet actif -------------------------
    contentEl.createEl("h3", { text: plugin.titleFor(file) });

    const rawText = await app.vault.cachedRead(file);
    const wc = countWords(rawText);
    const g = parseInt(String(plugin.fmOf(file).goal), 10);
    const goal = isNaN(g) ? plugin.settings.wordGoal : g;

    const cleanText = stripWritingNoise(rawText);
    const chars = cleanText.length;
    const charsNoSpaces = cleanText.replace(/\s/g, "").length;
    const sentences = countSentences(cleanText);
    const paragraphs = countParagraphs(cleanText);

    this.renderStatsBlock(contentEl, t("analysis.metrics.words"), wc, goal, chars, charsNoSpaces, sentences, paragraphs);

    // ------------------------------- Projet entier ---------------------------
    const root = plugin.getProjectFolder();
    if (root) {
      contentEl.createEl("h3", { text: t("modal.stats.wholeProject"), cls: "feuillets-stats-modal-section" });

      const files = plugin.flattenFiles(root);
      const counts = await plugin.getWordCounts(files);
      let pChars = 0, pCharsNoSpaces = 0, pWords = 0, pSentences = 0, pParagraphs = 0;
      for (const f of files) {
        const c = counts.get(f.path);
        if (!c) continue;
        pChars += c.chars || 0;
        pCharsNoSpaces += c.charsNoSpaces || 0;
        pWords += c.wc || 0;
        pSentences += c.sentences || 0;
        pParagraphs += c.paragraphs || 0;
      }

      const { addRow } = this.renderStatsBlock(
        contentEl, t("analysis.metrics.words"), pWords, plugin.settings.projectWordGoal || 0,
        pChars, pCharsNoSpaces, pSentences, pParagraphs
      );

      if (plugin.settings.deadlineDate) {
        const targetDate = new Date(plugin.settings.deadlineDate);
        if (!isNaN(targetDate.getTime())) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffMs = targetDate.getTime() - today.getTime();
          const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          const targetGoal = plugin.settings.projectWordGoal || 0;
          const wordsLeft = Math.max(0, targetGoal - pWords);

          addRow(t("modal.stats.deadline"), plugin.settings.deadlineDate);
          if (daysLeft > 0) {
            addRow(t("modal.stats.daysLeft"), daysLeft);
            addRow(t("modal.stats.dailyQuota"), t("modal.stats.wordsPerDay", { count: formatNumber(Math.ceil(wordsLeft / daysLeft)) }));
          } else if (daysLeft === 0) {
            addRow(t("modal.stats.daysLeft"), t("modal.stats.today"));
          } else {
            addRow(t("modal.stats.daysLeft"), t("modal.stats.overdue"));
          }
        }
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
