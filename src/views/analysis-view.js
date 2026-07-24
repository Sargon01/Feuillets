import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber } from "../utils/text-metrics.js";
import { renderCollapsibleHead } from "../utils/dom.js";

const { TFile } = require("obsidian");

/** Onglet « Analyse » — Phase 1 : métriques narratives du feuillet actif
 * (voir la feuille de route Analyse). Socle FR-safe, sans NLP ; distinct du
 * correcteur grammatical. Chaque outil est une SECTION repliable avec son
 * titre (même langage visuel que le panneau Notes / StatsModal), pour que les
 * outils des phases suivantes (répétitions, équilibre des chapitres, courbe
 * narrative) s'y ajoutent de la même façon. Sous-vue de SidebarFeuilletsView,
 * rafraîchie au changement de feuillet. */
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

  /** Une section-outil repliable, avec titre, dont l'état de repli persiste
   * (comme les autres sections du panneau). `renderBody` ne s'exécute que si
   * la section est dépliée. */
  tool(container, key, icon, title, renderBody) {
    const S = this.plugin.settings;
    const collapseKey = `analyse:${key}`;
    const collapsed = !!(S.collapsed && S.collapsed[collapseKey]);
    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section",
        head: "feuillets-notes-section-head",
        icon: "feuillets-notes-section-icon",
        title: "feuillets-notes-section-title",
      },
      title,
      icon,
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        this.render();
      },
    });
    if (!collapsed) renderBody(section);
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

    this.tool(container, "metrics", "bar-chart-3", "Métriques du feuillet", (section) => {
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
    });
  }
}
