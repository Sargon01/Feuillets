import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber } from "../utils/text-metrics.js";

const { TFile, setIcon } = require("obsidian");

/** Onglet « Analyse » — Phase 1 : métriques narratives du feuillet actif
 * (voir la feuille de route Analyse). Socle FR-safe, sans NLP ; distinct du
 * correcteur grammatical (celui-ci corrige, l'analyse fait comprendre la
 * prose). Reprend exactement le langage visuel des autres panneaux (section
 * + liste métadonnées label/valeur, comme StatsModal / le panneau Notes).
 * Sous-vue de SidebarFeuilletsView, rafraîchie au changement de feuillet. */
export class AnalysisView extends BaseFeuilletsView {
  getViewType() {
    return "feuillets-analysis";
  }

  getDisplayText() {
    return "Analyse";
  }

  getIcon() {
    return "bar-chart-3";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-notes-container");

    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      container.createDiv({ cls: "feuillets-empty" }).setText("Ouvre un feuillet pour l'analyser.");
      return;
    }

    const raw = await this.app.vault.cachedRead(file);
    const a = analyzeProse(raw);

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });
    setIcon(head.createSpan({ cls: "feuillets-notes-section-icon" }), "bar-chart-3");
    head.createSpan({ cls: "feuillets-notes-section-title" }).setText("Analyse du feuillet");

    const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
    const addRow = (label, value, hint) => {
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: value });
      if (hint) row.setAttr("title", hint);
    };

    addRow("Mots", formatNumber(a.words));
    addRow("Phrases", formatNumber(a.sentences));
    addRow("Paragraphes", formatNumber(a.paragraphs));
    addRow("Longueur moy. des phrases", `${a.avgSentenceLength.toFixed(1)} mots`);
    addRow("Longueur moy. des mots", `${a.avgWordLength.toFixed(1)} lettres`);
    addRow(
      "Phrases longues (>40 mots)",
      formatNumber(a.longSentenceCount),
      "Phrases à envisager d'alléger"
    );
    addRow(
      "Ratio dialogue",
      `${Math.round(a.dialogueRatio * 100)} %`,
      "Part des mots dans des paragraphes de dialogue (estimation)"
    );
  }
}
