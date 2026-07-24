import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber } from "../utils/text-metrics.js";
import { renderCollapsibleHead } from "../utils/dom.js";
import { getChapters, flattenFiles, isFrontMatter } from "../services/folder-structure.js";

const { TFile, TFolder } = require("obsidian");

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

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

  /** Titre affichable d'un chapitre : note de dossier (si dossier-chapitre),
   * sinon frontmatter (fichier-chapitre), sinon le nom brut. */
  chapterTitle(ch) {
    if (ch instanceof TFolder) {
      const note = this.plugin.folderNoteFor(ch);
      return (note && this.plugin.titleFor(note)) || ch.name;
    }
    return this.plugin.titleFor(ch) || ch.basename;
  }

  /** Données chapitres avec cache : l'agrégation lit tout le manuscrit, donc
   * on ne la refait pas à chaque navigation entre feuillets. Le cache est
   * invalidé par SidebarFeuilletsView sur modification du coffre. */
  async getChaptersData() {
    if (!this._chaptersCache) this._chaptersCache = await this.computeChapters();
    return this._chaptersCache;
  }

  /** Agrège chaque chapitre du manuscrit : mots et ratio dialogue. Un chapitre
   * peut être un dossier (somme de ses scènes) ou un fichier unique. Lecture
   * en cache (cachedRead). Calculé seulement à la demande (section dépliée). */
  async computeChapters() {
    const root = this.plugin.getProjectFolder();
    if (!root) return [];
    const S = this.plugin.settings;
    const out = [];
    for (const ch of getChapters(this.app, S, root)) {
      let text = "";
      if (ch instanceof TFolder) {
        const files = flattenFiles(this.app, S, ch).filter(
          (f) => f instanceof TFile && f.extension === "md" && !isFrontMatter(this.app, S, f)
        );
        for (const f of files) text += "\n\n" + (await this.app.vault.cachedRead(f));
      } else if (ch instanceof TFile) {
        text = await this.app.vault.cachedRead(ch);
      }
      const a = analyzeProse(text);
      out.push({ title: this.chapterTitle(ch), words: a.words, dialogueRatio: a.dialogueRatio });
    }
    return out;
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

    // ---- Équilibre des chapitres (niveau roman) ----
    // Calcul lourd (lit tout le manuscrit) : seulement si la section est
    // dépliée, pour ne rien coûter quand elle est repliée.
    const S = this.plugin.settings;
    const chaptersCollapsed = !!(S.collapsed && S.collapsed["analyse:chapters"]);
    const chapters = chaptersCollapsed ? null : await this.getChaptersData();

    this.tool(container, "chapters", "bar-chart-horizontal", "Équilibre des chapitres", (section) => {
      if (!chapters || !chapters.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText("Aucun chapitre détecté.");
        return;
      }
      const counts = chapters.map((c) => c.words);
      const med = median(counts);
      const max = Math.max(1, ...counts);
      const isOutlier = (w) => med > 0 && (w > med * 1.75 || w < med * 0.4);
      const outliers = counts.filter(isOutlier).length;

      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        `${chapters.length} chapitres · médiane ${formatNumber(Math.round(med))} mots` +
          (outliers ? ` · ${outliers} hors norme` : "")
      );

      for (const c of chapters) {
        const out = isOutlier(c.words);
        const block = section.createDiv({
          cls: "feuillets-analysis-chapter" + (out ? " is-outlier" : ""),
        });
        if (out) block.setAttr("title", "Longueur nettement éloignée de la médiane");
        const cHead = block.createDiv({ cls: "feuillets-analysis-chapter-head" });
        cHead.createSpan({ cls: "feuillets-analysis-chapter-label", text: c.title });
        cHead.createSpan({
          cls: "feuillets-analysis-chapter-value",
          text: `${formatNumber(c.words)} mots · ${Math.round(c.dialogueRatio * 100)} % dial.`,
        });
        const bar = block.createDiv({ cls: "feuillets-analysis-bar" });
        bar.createDiv({ cls: "feuillets-analysis-bar-fill" }).style.width =
          `${Math.round((c.words / max) * 100)}%`;
      }
    });
  }
}
