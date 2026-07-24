import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber } from "../utils/text-metrics.js";

const { TFile } = require("obsidian");

/** Onglet « Analyse » — Phase 1 : métriques narratives du feuillet actif
 * (voir la feuille de route Analyse). Socle FR-safe, sans NLP ; distinct du
 * correcteur grammatical (celui-ci corrige, l'analyse fait comprendre la
 * prose). Utilisé comme sous-vue de SidebarFeuilletsView : se rafraîchit au
 * changement de feuillet via renderAllSubViews. */
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
    container.addClass("feuillets-analysis-container");

    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      container.createDiv({ cls: "feuillets-empty" }).setText("Ouvre un feuillet pour l'analyser.");
      return;
    }

    const raw = await this.app.vault.cachedRead(file);
    const a = analyzeProse(raw);

    container.createEl("h4", {
      cls: "feuillets-analysis-title",
      text: `Analyse — ${this.plugin.titleFor(file)}`,
    });

    const list = container.createDiv({ cls: "feuillets-analysis-list" });
    const row = (label, value, hint) => {
      const r = list.createDiv({ cls: "feuillets-analysis-row" });
      r.createSpan({ cls: "feuillets-analysis-label" }).setText(label);
      r.createSpan({ cls: "feuillets-analysis-value" }).setText(value);
      if (hint) r.setAttr("title", hint);
    };

    row("Mots", formatNumber(a.words));
    row("Phrases", formatNumber(a.sentences));
    row("Paragraphes", formatNumber(a.paragraphs));
    row("Longueur moy. des phrases", `${a.avgSentenceLength.toFixed(1)} mots`);
    row("Longueur moy. des mots", `${a.avgWordLength.toFixed(1)} lettres`);
    row(
      "Phrases longues (>40 mots)",
      formatNumber(a.longSentenceCount),
      "Phrases à envisager d'alléger"
    );
    row(
      "Ratio dialogue",
      `${Math.round(a.dialogueRatio * 100)} %`,
      "Part des mots dans des paragraphes de dialogue (estimation)"
    );

    container.createDiv({ cls: "feuillets-analysis-note" }).setText(
      "Métriques du feuillet actif. Répétitions, équilibre des chapitres et courbe narrative arrivent dans les prochaines phases."
    );
  }
}
