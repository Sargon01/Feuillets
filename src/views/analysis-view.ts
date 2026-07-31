import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber, stripWritingNoise } from "../utils/text-metrics.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getChapters, flattenFiles, isFrontMatter, resourcesFolderPath } from "../services/folder-structure.js";
import { findRepetitions } from "../utils/repetitions.js";
import { ensureFolder } from "../services/project-files.js";
import { t } from "../i18n/index.js";

import { TFile, TFolder, Platform, Notice, normalizePath, type Editor } from "obsidian";

type AnalysisSettings = FeuilletsSettings & {
  analysisRepWindow?: number;
  analysisRepMinLen?: number;
};

type AnalysisViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  settings: AnalysisSettings;
  folderNoteFor(folder: TFolder): TFile | null;
  shortTitleFor(file: TFile): string;
  getProjectFolder(): TFolder | null;
  activeEditorAnywhere(): Editor | null;
  saveSettings(): Promise<void>;
};

type RythmeKey = "action" | "dialogue" | "description" | "introspection";
type RythmeValues = Record<RythmeKey, number>;

type ChapterStat = { title: string; words: number; dialogueRatio: number };


type DashboardData = {
  words: number;
  scenes: number;
  chapters: number;
  dialoguePct: number;
  repZones: number;
  outliers: number;
  uniqueSurface: number;
  tagged: number;
  taggedPct: number;
};


/* Courbe narrative (Phase 3) : chaque scène reçoit, DANS SON FRONTMATTER, une
   intensité 0–5 par dimension, sous la clé `rythme`. Tags MANUELS (posés par
   l'autrice) — pas de classification automatique, peu fiable. La courbe du
   roman en est déduite. */
function rythmeDims(): { key: RythmeKey; label: string }[] {
  return [
    { key: "action", label: t("analysis.pace.action") },
    { key: "dialogue", label: t("analysis.pace.dialogue") },
    { key: "description", label: t("analysis.pace.description") },
    { key: "introspection", label: t("analysis.pace.introspection") },
  ];
}
const RYTHME_MAX = 5;

function median(nums: number[]): number {
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
  declare plugin: AnalysisViewPlugin;
  declare targetContainer?: HTMLElement;
  _chaptersCache: ChapterStat[] | null = null;
  _dashboardCache: DashboardData | null = null;

  getViewType(): string {
    return "feuillets-analysis";
  }

  getDisplayText(): string {
    return t("analysis.displayText");
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  /* Pas de onOpen() : comme GrammarView, cette vue n'est jamais ouverte
     comme sa propre feuille — SidebarFeuilletsView appelle directement
     .render() sur cette instance (voir sidebar-feuillets-view.js). Un
     onOpen() ici ne serait jamais invoqué par Obsidian : du code mort. */

  /** Une section-outil repliable, avec titre, dont l'état de repli persiste
   * (comme les autres sections du panneau). `renderBody` ne s'exécute que si
   * la section est dépliée. */
  tool(container: HTMLElement, key: string, icon: string, title: string, renderBody: (section: HTMLElement) => void): void {
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
        void this.render();
      },
    });
    if (!collapsed) renderBody(section);
  }

  /** Titre affichable d'un chapitre : note de dossier (si dossier-chapitre),
   * sinon frontmatter (fichier-chapitre), sinon le nom brut. */
  chapterTitle(ch: TFile | TFolder): string {
    if (ch instanceof TFolder) {
      const note = this.plugin.folderNoteFor(ch);
      return (note && this.plugin.shortTitleFor(note)) || ch.name;
    }
    return this.plugin.shortTitleFor(ch) || ch.basename;
  }

  /** Données chapitres avec cache : l'agrégation lit tout le manuscrit, donc
   * on ne la refait pas à chaque navigation entre feuillets. Le cache est
   * invalidé par SidebarFeuilletsView sur modification du coffre. */
  async getChaptersData(): Promise<ChapterStat[]> {
    if (!this._chaptersCache) this._chaptersCache = await this.computeChapters();
    return this._chaptersCache;
  }

  /** Agrège chaque chapitre du manuscrit : mots et ratio dialogue. Un chapitre
   * peut être un dossier (somme de ses scènes) ou un fichier unique. Lecture
   * en cache (cachedRead). Calculé seulement à la demande (section dépliée). */
  async computeChapters(): Promise<ChapterStat[]> {
    const root = this.plugin.getProjectFolder();
    if (!root) return [];
    const S = this.plugin.settings;
    const out: ChapterStat[] = [];
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





  /** Tableau de bord roman (Phase 6) : agrégats sur tout le manuscrit —
   * indicateurs BRUTS et actionnables (pas de score composite opaque). Lourd
   * (lit tout le manuscrit) : mis en cache, invalidé sur modification. */
  async computeDashboard(): Promise<DashboardData> {
    const scenes = this.sceneFiles();
    let words = 0;
    let dialogueWeighted = 0;
    let repZones = 0;
    const uniqueSurface = new Set<string>();
    for (const f of scenes) {
      const raw = await this.app.vault.cachedRead(f);
      const a = analyzeProse(raw);
      words += a.words;
      dialogueWeighted += a.dialogueRatio * a.words;
      const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      const body = raw.slice(fm ? fm[0].length : 0);
      repZones += findRepetitions(body).length;
      for (const w of (stripWritingNoise(body).toLowerCase().match(/[\p{L}][\p{L}'-]{2,}/gu) || [])) {
        uniqueSurface.add(w);
      }
    }
    const chapters = await this.getChaptersData();
    const counts = chapters.map((c) => c.words);
    const med = median(counts);
    const outliers = counts.filter((w) => med > 0 && (w > med * 1.75 || w < med * 0.4)).length;
    const tagged = scenes.filter((f) => {
      const r = this.rythmeOf(f);
      return rythmeDims().some((d) => r[d.key] > 0);
    }).length;
    return {
      words,
      scenes: scenes.length,
      chapters: chapters.length,
      dialoguePct: words ? Math.round((dialogueWeighted / words) * 100) : 0,
      repZones,
      outliers,
      uniqueSurface: uniqueSurface.size,
      tagged,
      taggedPct: scenes.length ? Math.round((tagged / scenes.length) * 100) : 0,
    };
  }

  async getDashboard(): Promise<DashboardData> {
    if (!this._dashboardCache) this._dashboardCache = await this.computeDashboard();
    return this._dashboardCache;
  }

  /** Synthèse du tableau de bord en Markdown (export presse-papier). */
  dashboardMarkdown(dash: DashboardData): string {
    const root = this.plugin.getProjectFolder();
    const name = this.plugin.settings.manuscriptTitle || (root ? root.name : t("analysis.dashboard.defaultManuscriptName"));
    return [
      `## ${t("analysis.dashboard.title")} — ${name}`,
      "",
      `- ${t("analysis.dashboard.words")} : ${formatNumber(dash.words)}`,
      `- ${t("analysis.dashboard.chapters")} : ${formatNumber(dash.chapters)}`,
      `- ${t("analysis.dashboard.scenes")} : ${formatNumber(dash.scenes)}`,
      `- ${t("analysis.dashboard.dialogueRatio")} : ${dash.dialoguePct} %`,
      `- ${t("analysis.dashboard.distinctWords")} : ${formatNumber(dash.uniqueSurface)}`,
      `- ${t("analysis.dashboard.repZones")} : ${formatNumber(dash.repZones)}`,
      `- ${t("analysis.dashboard.unbalancedChapters")} : ${formatNumber(dash.outliers)}`,
      `- ${t("analysis.dashboard.taggedScenes")} : ${dash.tagged}/${dash.scenes} (${dash.taggedPct} %)`,
      "",
    ].join("\n");
  }

  /** Enregistre la synthèse dans un fichier du coffre (Resources/Tableau de
   * bord.md), le crée ou le remplace, puis l'ouvre. */
  async exportDashboardFile(dash: DashboardData): Promise<void> {
    const root = this.plugin.getProjectFolder();
    if (!root) {
      new Notice(t("analysis.dashboard.noActiveProject"));
      return;
    }
    const dir = resourcesFolderPath(this.app, root);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/${t("analysis.dashboard.fileName")}.md`);
    const md = this.dashboardMarkdown(dash);
    // Réutilise le fichier déjà présent, quel que soit son nom (ancienne
    // langue) — jamais deux fichiers dupliqués juste parce que la langue a changé.
    const legacyPath = normalizePath(`${dir}/Tableau de bord.md`);
    const existing = this.app.vault.getAbstractFileByPath(path) || this.app.vault.getAbstractFileByPath(legacyPath);
    if (existing instanceof TFile) await this.app.vault.modify(existing, md);
    else await this.app.vault.create(path, md);
    const file = existing instanceof TFile ? existing : this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    new Notice(t("analysis.dashboard.savedNotice", { folder: dir.split("/").pop() || "" }));
  }

  /** Scènes du manuscrit dans l'ordre (fichiers md, hors Front). Lecture du
   * seul frontmatter (metadataCache) pour la courbe → pas de lecture de corps,
   * donc pas de cache nécessaire ici. */
  sceneFiles(): TFile[] {
    const root = this.plugin.getProjectFolder();
    if (!root) return [];
    const S = this.plugin.settings;
    return flattenFiles(this.app, S, root).filter(
      (f) => f instanceof TFile && f.extension === "md" && !isFrontMatter(this.app, S, f)
    );
  }

  /** Sélectionne TOUTES les occurrences d'une répétition dans l'éditeur du
   * feuillet actif (sélections multiples CodeMirror → les mots répétés sont
   * surlignés dans le texte) et fait défiler jusqu'à la première. */
  highlightAll(bodyStart: number, offsets: number[], len: number): void {
    const editor = this.plugin.activeEditorAnywhere();
    if (!editor || !offsets.length) return;
    const ranges = offsets.map((o) => ({
      anchor: editor.offsetToPos(bodyStart + o),
      head: editor.offsetToPos(bodyStart + o + len),
    }));
    editor.setSelections(ranges);
    editor.scrollIntoView({ from: ranges[0].anchor, to: ranges[0].head }, true);
  }

  /** Intensités `rythme` d'une scène, normalisées 0–RYTHME_MAX (0 si absent). */
  rythmeOf(file: TFile): RythmeValues {
    const fm = this.fm(file);
    const r = (fm && fm.pace) || {};
    const out = {} as RythmeValues;
    for (const d of rythmeDims()) {
      const v = Number(r[d.key]);
      out[d.key] = Number.isFinite(v) ? Math.max(0, Math.min(RYTHME_MAX, Math.round(v))) : 0;
    }
    return out;
  }

  /** En-tête de groupe (Ce feuillet / Le roman) : grand, avec icône et
   * repliable (masque tous les outils du groupe). État de repli persistant.
   * Retourne true si le groupe est replié. */
  group(container: HTMLElement, icon: string, title: string, key: string): boolean {
    const S = this.plugin.settings;
    const collapseKey = `analyse-group:${key}`;
    const collapsed = !!(S.collapsed && S.collapsed[collapseKey]);
    renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-analysis-grouphead",
        head: "feuillets-analysis-grouphead-inner",
        icon: "feuillets-analysis-grouphead-icon",
        title: "feuillets-analysis-grouphead-title",
      },
      title,
      icon,
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    return collapsed;
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-notes-container");

    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      container.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.openSheetToAnalyze"));
      return;
    }

    const raw = await this.app.vault.cachedRead(file);
    const a = analyzeProse(raw);
    const S = this.plugin.settings;

    // ========================= CE FEUILLET =========================
    if (!this.group(container, "file-text", t("analysis.group.thisSheet"), "feuillet")) {
    const gb = container.createDiv({ cls: "feuillets-analysis-groupbody" });

    this.tool(gb, "metrics", "bar-chart-3", t("analysis.metrics.title"), (section) => {
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const addRow = (label: string, value: string, hint?: string) => {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
        row.createDiv({ cls: "feuillets-notes-metadata-value", text: value });
        if (hint) row.setAttr("title", hint);
      };
      addRow(t("analysis.metrics.words"), formatNumber(a.words));
      addRow(t("analysis.metrics.sentences"), formatNumber(a.sentences));
      addRow(t("analysis.metrics.paragraphs"), formatNumber(a.paragraphs));
      addRow(t("analysis.metrics.avgSentenceLength"), t("analysis.metrics.wordsUnit", { count: a.avgSentenceLength.toFixed(1) }));
      addRow(t("analysis.metrics.avgWordLength"), t("analysis.metrics.lettersUnit", { count: a.avgWordLength.toFixed(1) }));
      addRow(
        t("analysis.metrics.longSentences"),
        formatNumber(a.longSentenceCount),
        t("analysis.metrics.longSentencesHint")
      );
      addRow(
        t("analysis.metrics.dialogueRatio"),
        `${Math.round(a.dialogueRatio * 100)} %`,
        t("analysis.metrics.dialogueRatioHint")
      );
    });

    // ---- Répétitions rapprochées (feuillet actif) ----
    const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const repWindow = S.analysisRepWindow ?? 50;
    const repMinLen = S.analysisRepMinLen ?? 4;
    const reps = findRepetitions(raw.slice(bodyStart), { window: repWindow, minLen: repMinLen });

    this.tool(gb, "repetitions", "copy", t("analysis.repetitions.title"), (section) => {
      // Réglages : fenêtre (distance max en mots) et longueur mini d'un mot.
      const ctrl = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const numCtrl = (label: string, value: number, set: (v: number) => void, min: number) => {
        const r = ctrl.createDiv({ cls: "feuillets-notes-metadata-row" });
        r.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
        const inp = r.createEl("input", { cls: "feuillets-rythme-input", type: "number" });
        inp.min = String(min);
        inp.value = String(value);
        inp.addEventListener("change", () => {
          void (async () => {
            set(Math.max(min, Math.round(Number(inp.value) || min)));
            await this.plugin.saveSettings();
            void this.render();
          })();
        });
      };
      numCtrl(t("analysis.repetitions.window"), repWindow, (v) => (S.analysisRepWindow = v), 5);
      numCtrl(t("analysis.repetitions.minLength"), repMinLen, (v) => (S.analysisRepMinLen = v), 2);

      if (!reps.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.repetitions.none"));
        return;
      }
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        t("analysis.repetitions.summary", { count: String(reps.length) })
      );
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const MAXROWS = 40;
      for (const rep of reps.slice(0, MAXROWS)) {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row feuillets-rep-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: rep.word });
        row.createDiv({
          cls: "feuillets-notes-metadata-value",
          text: t("analysis.repetitions.countAtGap", { count: String(rep.count), gap: String(rep.minGap) }),
        });
        row.setAttr("title", t("analysis.repetitions.rowTooltip"));
        row.addEventListener("click", () => {
          list.querySelectorAll(".is-active").forEach((el) => el.removeClass("is-active"));
          row.addClass("is-active");
          this.highlightAll(bodyStart, rep.offsets, rep.word.length);
        });
      }
      if (reps.length > MAXROWS) {
        section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
          t("analysis.repetitions.andMore", { count: String(reps.length - MAXROWS) })
        );
      }
    });

    // Rythme du feuillet (tags manuels de la scène active)
    this.tool(gb, "rythme", "sliders-horizontal", t("analysis.pace.sheetTitle"), (section) => {
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        t("analysis.pace.instructions", { max: String(RYTHME_MAX) })
      );
      const r = this.rythmeOf(file);
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      for (const d of rythmeDims()) {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: d.label });
        const input = row.createEl("input", { cls: "feuillets-rythme-input", type: "number" });
        input.min = "0";
        input.max = String(RYTHME_MAX);
        input.value = String(r[d.key]);
        input.addEventListener("change", () => {
          void (async () => {
            const v = Math.max(0, Math.min(RYTHME_MAX, Math.round(Number(input.value) || 0)));
            input.value = String(v);
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
              const pace = (typeof fm.pace === "object" && fm.pace ? fm.pace : typeof fm.rythme === "object" && fm.rythme ? fm.rythme : {}) as Record<string, unknown>;
              pace[d.key] = v;
              fm.pace = pace;
              delete fm.rythme;
            });
            void this.render();
          })();
        });
      }
    });

    } // fin du groupe « Ce feuillet »

    // ========================= LE ROMAN =========================
    if (!this.group(container, "book-open", t("analysis.group.novel"), "roman")) {
    const gb = container.createDiv({ cls: "feuillets-analysis-groupbody" });

    // Tableau de bord (synthèse du manuscrit)
    const dashCollapsed = !!(S.collapsed && S.collapsed["analyse:dashboard"]);
    const dash = dashCollapsed ? null : await this.getDashboard();
    this.tool(gb, "dashboard", "layout-dashboard", t("analysis.dashboard.title"), (section) => {
      if (!dash) return;
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const row = (label: string, value: string) => {
        const r = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        r.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
        r.createDiv({ cls: "feuillets-notes-metadata-value", text: value });
      };
      row(t("analysis.dashboard.words"), formatNumber(dash.words));
      row(t("analysis.dashboard.chapters"), formatNumber(dash.chapters));
      row(t("analysis.dashboard.scenes"), formatNumber(dash.scenes));
      row(t("analysis.dashboard.dialogueRatio"), `${dash.dialoguePct} %`);
      row(t("analysis.dashboard.distinctWords"), formatNumber(dash.uniqueSurface));
      row(t("analysis.dashboard.repZones"), formatNumber(dash.repZones));
      row(t("analysis.dashboard.unbalancedChapters"), formatNumber(dash.outliers));
      row(t("analysis.dashboard.taggedScenes"), `${dash.tagged}/${dash.scenes} (${dash.taggedPct} %)`);

      const bar = section.createDiv({ cls: "feuillets-analysis-export-bar" });
      const copyBtn = bar.createEl("button", { text: t("analysis.dashboard.copySummary") });
      copyBtn.addEventListener("click", () => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(this.dashboardMarkdown(dash));
            new Notice(t("analysis.dashboard.summaryCopied"));
          } catch {
            new Notice(t("analysis.dashboard.copyFailed"));
          }
        })();
      });
      const saveBtn = bar.createEl("button", { text: t("analysis.dashboard.saveMd") });
      saveBtn.addEventListener("click", () => { void this.exportDashboardFile(dash); });
    });

    // ---- Équilibre des chapitres (niveau roman) ----
    // Calcul lourd (lit tout le manuscrit) : seulement si la section est
    // dépliée, pour ne rien coûter quand elle est repliée.
    const chaptersCollapsed = !!(S.collapsed && S.collapsed["analyse:chapters"]);
    const chapters = chaptersCollapsed ? null : await this.getChaptersData();

    this.tool(gb, "chapters", "bar-chart-horizontal", t("analysis.chapters.title"), (section) => {
      if (!chapters || !chapters.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.chapters.none"));
        return;
      }
      const counts = chapters.map((c) => c.words);
      const med = median(counts);
      const max = Math.max(1, ...counts);
      const isOutlier = (w: number) => med > 0 && (w > med * 1.75 || w < med * 0.4);
      const outliers = counts.filter(isOutlier).length;

      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        t("analysis.chapters.summary", { count: String(chapters.length), median: formatNumber(Math.round(med)) }) +
          (outliers ? t("analysis.chapters.outliersSuffix", { count: String(outliers) }) : "")
      );

      for (const c of chapters) {
        const out = isOutlier(c.words);
        const block = section.createDiv({
          cls: "feuillets-analysis-chapter" + (out ? " is-outlier" : ""),
        });
        if (out) block.setAttr("title", t("analysis.chapters.outlierTooltip"));
        const cHead = block.createDiv({ cls: "feuillets-analysis-chapter-head" });
        cHead.createSpan({ cls: "feuillets-analysis-chapter-label", text: c.title });
        cHead.createSpan({
          cls: "feuillets-analysis-chapter-value",
          text: t("analysis.chapters.wordsAndDialogue", { words: formatNumber(c.words), pct: String(Math.round(c.dialogueRatio * 100)) }),
        });
        const bar = block.createDiv({ cls: "feuillets-analysis-bar" });
        bar.createDiv({ cls: "feuillets-analysis-bar-fill" }).style.width =
          `${Math.round((c.words / max) * 100)}%`;
      }
    });

    // ---- Courbe narrative (déduite des tags de rythme) ----
    this.tool(gb, "curve", "activity", t("analysis.curve.title"), (section) => {
      const scenes = this.sceneFiles();
      const tagged = scenes.filter((f) => {
        const r = this.rythmeOf(f);
        return rythmeDims().some((d) => r[d.key] > 0);
      });
      if (!tagged.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText(
          t("analysis.curve.noTaggedScenes")
        );
        return;
      }

      const curve = section.createDiv({ cls: "feuillets-curve" });
      for (const f of scenes) {
        const r = this.rythmeOf(f);
        const total = rythmeDims().reduce((n, d) => n + r[d.key], 0);
        const rowEl = curve.createDiv({ cls: "feuillets-curve-row" });
        rowEl.createSpan({ cls: "feuillets-curve-label", text: this.plugin.shortTitleFor(f) });
        const bar = rowEl.createDiv({ cls: "feuillets-curve-bar" + (total ? "" : " is-empty") });
        for (const d of rythmeDims()) {
          if (r[d.key] <= 0) continue;
          const seg = bar.createDiv({ cls: `feuillets-curve-seg feuillets-curve-seg-${d.key}` });
          seg.style.flexGrow = String(r[d.key]);
          seg.setAttr("title", t("analysis.curve.segTooltip", { label: d.label, value: String(r[d.key]), max: String(RYTHME_MAX) }));
        }
        rowEl.addEventListener("click", () =>
          openFileActivating(this.app, this.app.workspace.getLeaf(false), f)
        );
      }

      const legend = section.createDiv({ cls: "feuillets-curve-legend" });
      for (const d of rythmeDims()) {
        const item = legend.createSpan({ cls: "feuillets-curve-legend-item" });
        item.createSpan({ cls: `feuillets-curve-swatch feuillets-curve-seg-${d.key}` });
        item.createSpan({ text: d.label });
      }
    });

    } // fin du groupe « Le roman »
  }
}
