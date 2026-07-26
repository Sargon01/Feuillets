import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber, stripWritingNoise } from "../utils/text-metrics.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getChapters, flattenFiles, isFrontMatter, resourcesFolderPath } from "../services/folder-structure.js";
import { findRepetitions } from "../utils/repetitions.js";
import { ensureFolder } from "../services/project-files.js";

const { TFile, TFolder, Platform, Notice, normalizePath } = require("obsidian");

/** Extrait le lemme d'une chaîne morphologique Grammalecte (`>lemme …`). */
function lemmaOfMorph(morph) {
  const m = morph.match(/>([0-9a-zà-öø-ÿ-]+)/i);
  return m ? m[1] : "";
}

/** Verbes « passe-partout » (ternes, à forte fréquence) dont l'abus appauvrit
 * le style : on les repère pour inviter à varier. Verbes de contenu banals,
 * pas les auxiliaires modaux (pouvoir/vouloir/devoir, grammaticaux). */
const VERBES_PASSE_PARTOUT = new Set([
  "être", "avoir", "faire", "dire", "aller", "voir", "mettre", "prendre",
  "donner", "trouver", "passer", "rendre", "tenir", "venir",
]);

/** Verbes intransitifs formant leur passé composé avec « être » : « il est
 * arrivé » n'est PAS une voix passive — à exclure de la détection. */
const ETRE_INTRANSITIFS = new Set([
  "aller", "arriver", "décéder", "demeurer", "descendre", "devenir", "entrer",
  "intervenir", "monter", "mourir", "naître", "partir", "parvenir", "passer",
  "provenir", "rentrer", "repartir", "rester", "retomber", "retourner",
  "revenir", "sortir", "survenir", "tomber", "venir",
]);

/* Courbe narrative (Phase 3) : chaque scène reçoit, DANS SON FRONTMATTER, une
   intensité 0–5 par dimension, sous la clé `rythme`. Tags MANUELS (posés par
   l'autrice) — pas de classification automatique, peu fiable. La courbe du
   roman en est déduite. */
const RYTHME_DIMS = [
  { key: "action", label: "Action" },
  { key: "dialogue", label: "Dialogue" },
  { key: "description", label: "Description" },
  { key: "introspection", label: "Introspection" },
];
const RYTHME_MAX = 5;

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

  /* Pas de onOpen() : comme GrammarView, cette vue n'est jamais ouverte
     comme sa propre feuille — SidebarFeuilletsView appelle directement
     .render() sur cette instance (voir sidebar-feuillets-view.js). Un
     onOpen() ici ne serait jamais invoqué par Obsidian : du code mort. */

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
      return (note && this.plugin.shortTitleFor(note)) || ch.name;
    }
    return this.plugin.shortTitleFor(ch) || ch.basename;
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

  /** Analyse morphologique du feuillet (Phase 5, via Grammalecte) : verbes/
   * adjectifs/adverbes favoris par lemme + richesse lexicale (lemmes uniques /
   * mots pleins). getMorph renvoie plusieurs analyses par mot (ambiguïté
   * verbe/nom…) : on compte au plus large, d'où un résultat indicatif. Desktop
   * uniquement (le moteur nécessite fs/vm). Synchrone — d'où le cache et le
   * calcul seulement quand la section est dépliée. */
  computeVocab(rawText) {
    const checker = this.plugin.grammalecteChecker;
    if (!checker) return null;
    checker.ensureLoaded();
    const sc = checker.spellChecker;

    const clean = stripWritingNoise(rawText || "");
    const morphCache = new Map();
    const morphsOf = (w) => {
      let mm = morphCache.get(w);
      if (mm === undefined) {
        mm = sc.getMorph(w) || [];
        morphCache.set(w, mm);
      }
      return mm;
    };

    const re = /[\p{L}][\p{L}\p{N}'’-]*/gu;
    const ordered = [];
    const freq = new Map();
    let m;
    while ((m = re.exec(clean)) !== null) {
      const key = m[0].toLowerCase();
      ordered.push(key);
      freq.set(key, (freq.get(key) || 0) + 1);
    }

    const verbs = new Map();
    const adjs = new Map();
    const advs = new Map();
    const allLemmas = new Map();
    const ment = new Map();
    let contentTotal = 0;
    const bump = (map, lemma, n) => {
      if (lemma) map.set(lemma, (map.get(lemma) || 0) + n);
    };

    for (const [word, n] of freq) {
      const morphs = morphsOf(word);
      if (!morphs.length) continue;
      let lv = "";
      let la = "";
      let lw = "";
      let lany = "";
      let content = false;
      for (const mo of morphs) {
        if (/:V/.test(mo)) lv = lv || lemmaOfMorph(mo);
        if (mo.includes(":A")) la = la || lemmaOfMorph(mo);
        if (mo.includes(":W")) lw = lw || lemmaOfMorph(mo);
        if (/:[NAVW]/.test(mo)) {
          content = true;
          lany = lany || lemmaOfMorph(mo);
        }
      }
      bump(verbs, lv, n);
      bump(adjs, la, n);
      bump(advs, lw, n);
      if (content) {
        contentTotal += n;
        if (lany) allLemmas.set(lany, (allLemmas.get(lany) || 0) + n);
      }
      // Adverbes en -ment (surface tagguée adverbe, > 5 lettres) : surveiller
      // leur profusion, tic de style fréquent.
      if (lw && word.length > 5 && word.endsWith("ment")) {
        ment.set(word, (ment.get(word) || 0) + n);
      }
    }

    // Voix passive : forme d'« être » suivie (1–2 mots) d'un participe passé
    // (tag :Q), hors verbes intransitifs à auxiliaire être. Estimation.
    const isEtre = (w) => morphsOf(w).some((mo) => /:V/.test(mo) && lemmaOfMorph(mo) === "être");
    const ppLemma = (w) => {
      for (const mo of morphsOf(w)) {
        if (/:V/.test(mo) && mo.includes(":Q")) return lemmaOfMorph(mo);
      }
      return "";
    };
    let passiveCount = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (!isEtre(ordered[i])) continue;
      const end = Math.min(i + 2, ordered.length - 1);
      for (let j = i + 1; j <= end; j++) {
        const pl = ppLemma(ordered[j]);
        if (pl && pl !== "être" && !ETRE_INTRANSITIFS.has(pl)) {
          passiveCount++;
          break;
        }
      }
    }

    const top = (map, k) => [...map.entries()].sort((x, y) => y[1] - x[1]).slice(0, k);
    const hapaxCount = [...allLemmas.values()].filter((v) => v === 1).length;
    const mentTotal = [...ment.values()].reduce((s, v) => s + v, 0);

    // Verbes passe-partout : part des occurrences verbales portée par les
    // verbes ternes (voir VERBES_PASSE_PARTOUT).
    const verbTotal = [...verbs.values()].reduce((s, v) => s + v, 0);
    const weak = [...verbs.entries()]
      .filter(([l]) => VERBES_PASSE_PARTOUT.has(l))
      .sort((x, y) => y[1] - x[1]);
    const weakTotal = weak.reduce((s, [, v]) => s + v, 0);

    return {
      passiveCount,
      weakTop: weak.slice(0, 6),
      weakTotal,
      weakPct: verbTotal ? Math.round((weakTotal / verbTotal) * 100) : 0,
      richness: contentTotal ? allLemmas.size / contentTotal : 0,
      uniqueLemmas: allLemmas.size,
      hapaxCount,
      contentTotal,
      verbs: top(verbs, 8),
      adjs: top(adjs, 8),
      advs: top(advs, 8),
      mentTotal,
      mentPct: contentTotal ? Math.round((mentTotal / contentTotal) * 1000) / 10 : 0,
      mentTop: top(ment, 6),
    };
  }

  /** Vocabulaire avec cache par fichier (le calcul morphologique bloque
   * brièvement) ; invalidé sur modification du coffre par la barre latérale. */
  getVocab(file, rawText) {
    if (this._vocabCache && this._vocabCache.path === file.path) return this._vocabCache.data;
    let data;
    try {
      data = this.computeVocab(rawText);
    } catch (e) {
      console.error("Feuillets : analyse lexicale indisponible", e);
      data = { error: true };
    }
    this._vocabCache = { path: file.path, data };
    return data;
  }

  /** Vocabulaire du roman entier (Phase « vocab roman ») : concatène toutes
   * les scènes et réutilise computeVocab. Lourd (Grammalecte sur tout le
   * manuscrit), bureau uniquement — mis en cache, invalidé sur modification. */
  async getRomanVocab() {
    if (this._romanVocabCache) return this._romanVocabCache;
    let data;
    try {
      const scenes = this.sceneFiles();
      let text = "";
      for (const f of scenes) text += "\n\n" + (await this.app.vault.cachedRead(f));
      data = this.computeVocab(text);
    } catch (e) {
      console.error("Feuillets : vocabulaire du roman indisponible", e);
      data = { error: true };
    }
    this._romanVocabCache = data;
    return data;
  }

  /** Affiche un résultat de computeVocab dans une section (réutilisé pour le
   * feuillet et pour le roman). */
  renderVocabInto(section, vocab) {
    if (Platform.isMobile) {
      section.createDiv({ cls: "feuillets-empty" }).setText("Analyse morphologique : bureau uniquement.");
      return;
    }
    if (!vocab || vocab.error) {
      section.createDiv({ cls: "feuillets-empty" }).setText("Analyse indisponible (moteur Grammalecte non chargé).");
      return;
    }
    section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
      `Richesse lexicale ${Math.round(vocab.richness * 100)} % · ` +
        `${formatNumber(vocab.uniqueLemmas)} lemmes / ${formatNumber(vocab.contentTotal)} mots pleins · ` +
        `${formatNumber(vocab.hapaxCount)} hapax`
    );
    const group = (label, entries) => {
      section.createDiv({ cls: "feuillets-analysis-summary feuillets-vocab-group" }).setText(label);
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      if (!entries.length) {
        list.createDiv({ cls: "feuillets-empty" }).setText("—");
        return;
      }
      for (const [lemma, n] of entries) {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: lemma });
        row.createDiv({ cls: "feuillets-notes-metadata-value", text: `×${n}` });
      }
    };
    group("Verbes favoris", vocab.verbs);
    group(
      `Verbes passe-partout : ${formatNumber(vocab.weakTotal)} (${vocab.weakPct} % des verbes)` +
        (vocab.weakPct >= 40 ? " · à varier" : ""),
      vocab.weakTop
    );
    group("Adjectifs favoris", vocab.adjs);
    group("Adverbes favoris", vocab.advs);
    group(
      `Adverbes en -ment : ${formatNumber(vocab.mentTotal)} (${vocab.mentPct} %)` +
        (vocab.mentPct >= 3 ? " · à surveiller" : ""),
      vocab.mentTop
    );
    section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
      `Voix passive : ${formatNumber(vocab.passiveCount)} tournure(s) (estimation)`
    );
    section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
      "Morphologie française (Grammalecte) — formes ambiguës comptées au plus large, indicatif."
    );
  }

  /** Tableau de bord roman (Phase 6) : agrégats sur tout le manuscrit —
   * indicateurs BRUTS et actionnables (pas de score composite opaque). Lourd
   * (lit tout le manuscrit) : mis en cache, invalidé sur modification. */
  async computeDashboard() {
    const scenes = this.sceneFiles();
    let words = 0;
    let dialogueWeighted = 0;
    let repZones = 0;
    const uniqueSurface = new Set();
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
      return RYTHME_DIMS.some((d) => r[d.key] > 0);
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

  async getDashboard() {
    if (!this._dashboardCache) this._dashboardCache = await this.computeDashboard();
    return this._dashboardCache;
  }

  /** Synthèse du tableau de bord en Markdown (export presse-papier). */
  dashboardMarkdown(dash) {
    const root = this.plugin.getProjectFolder();
    const name = this.plugin.settings.manuscriptTitle || (root ? root.name : "Manuscrit");
    return [
      `## Tableau de bord — ${name}`,
      "",
      `- Mots : ${formatNumber(dash.words)}`,
      `- Chapitres : ${formatNumber(dash.chapters)}`,
      `- Scènes : ${formatNumber(dash.scenes)}`,
      `- Ratio dialogue : ${dash.dialoguePct} %`,
      `- Mots différents : ${formatNumber(dash.uniqueSurface)}`,
      `- Zones de répétition : ${formatNumber(dash.repZones)}`,
      `- Chapitres déséquilibrés : ${formatNumber(dash.outliers)}`,
      `- Scènes taguées (rythme) : ${dash.tagged}/${dash.scenes} (${dash.taggedPct} %)`,
      "",
    ].join("\n");
  }

  /** Enregistre la synthèse dans un fichier du coffre (Resources/Tableau de
   * bord.md), le crée ou le remplace, puis l'ouvre. */
  async exportDashboardFile(dash) {
    const root = this.plugin.getProjectFolder();
    if (!root) {
      new Notice("Aucun projet actif.");
      return;
    }
    const dir = resourcesFolderPath(this.app, root);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/Tableau de bord.md`);
    const md = this.dashboardMarkdown(dash);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, md);
    else await this.app.vault.create(path, md);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    new Notice(`Tableau de bord enregistré dans ${dir.split("/").pop()}.`);
  }

  /** Scènes du manuscrit dans l'ordre (fichiers md, hors Front). Lecture du
   * seul frontmatter (metadataCache) pour la courbe → pas de lecture de corps,
   * donc pas de cache nécessaire ici. */
  sceneFiles() {
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
  highlightAll(bodyStart, offsets, len) {
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
  rythmeOf(file) {
    const fm = this.fm(file);
    const r = (fm && fm.pace) || {};
    const out = {};
    for (const d of RYTHME_DIMS) {
      const v = Number(r[d.key]);
      out[d.key] = Number.isFinite(v) ? Math.max(0, Math.min(RYTHME_MAX, Math.round(v))) : 0;
    }
    return out;
  }

  /** En-tête de groupe (Ce feuillet / Le roman) : grand, avec icône et
   * repliable (masque tous les outils du groupe). État de repli persistant.
   * Retourne true si le groupe est replié. */
  group(container, icon, title, key) {
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
        this.render();
      },
    });
    return collapsed;
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
    const S = this.plugin.settings;

    // ========================= CE FEUILLET =========================
    if (!this.group(container, "file-text", "Ce feuillet", "feuillet")) {
    const gb = container.createDiv({ cls: "feuillets-analysis-groupbody" });

    this.tool(gb, "metrics", "bar-chart-3", "Métriques du feuillet", (section) => {
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

    // ---- Répétitions rapprochées (feuillet actif) ----
    const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const repWindow = S.analysisRepWindow ?? 50;
    const repMinLen = S.analysisRepMinLen ?? 4;
    const reps = findRepetitions(raw.slice(bodyStart), { window: repWindow, minLen: repMinLen });

    this.tool(gb, "repetitions", "copy", "Répétitions rapprochées", (section) => {
      // Réglages : fenêtre (distance max en mots) et longueur mini d'un mot.
      const ctrl = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const numCtrl = (label, value, set, min) => {
        const r = ctrl.createDiv({ cls: "feuillets-notes-metadata-row" });
        r.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
        const inp = r.createEl("input", { cls: "feuillets-rythme-input", type: "number" });
        inp.min = String(min);
        inp.value = String(value);
        inp.addEventListener("change", async () => {
          set(Math.max(min, Math.round(Number(inp.value) || min)));
          await this.plugin.saveSettings();
          this.render();
        });
      };
      numCtrl("Fenêtre (mots)", repWindow, (v) => (S.analysisRepWindow = v), 5);
      numCtrl("Longueur mini", repMinLen, (v) => (S.analysisRepMinLen = v), 2);

      if (!reps.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText("Aucune répétition rapprochée détectée.");
        return;
      }
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        `${reps.length} mot(s) répété(s) à faible distance · clic pour parcourir les occurrences.`
      );
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const MAXROWS = 40;
      for (const rep of reps.slice(0, MAXROWS)) {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row feuillets-rep-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: rep.word });
        row.createDiv({
          cls: "feuillets-notes-metadata-value",
          text: `×${rep.count} · à ${rep.minGap} mots`,
        });
        row.setAttr("title", "Cliquer pour surligner toutes les occurrences dans le texte");
        row.addEventListener("click", () => {
          list.querySelectorAll(".is-active").forEach((el) => el.removeClass("is-active"));
          row.addClass("is-active");
          this.highlightAll(bodyStart, rep.offsets, rep.word.length);
        });
      }
      if (reps.length > MAXROWS) {
        section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
          `… et ${reps.length - MAXROWS} autres.`
        );
      }
    });

    // ---- Vocabulaire (via Grammalecte, desktop uniquement) ----
    const vocabCollapsed = !!(S.collapsed && S.collapsed["analyse:vocab"]);
    const vocab = vocabCollapsed || Platform.isMobile ? null : this.getVocab(file, raw);

    this.tool(gb, "vocab", "book-a", "Vocabulaire (Grammalecte)", (section) => {
      this.renderVocabInto(section, vocab);
    });

    // Rythme du feuillet (tags manuels de la scène active)
    this.tool(gb, "rythme", "sliders-horizontal", "Rythme du feuillet", (section) => {
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        `Note l'intensité (0–${RYTHME_MAX}) de chaque dimension pour cette scène.`
      );
      const r = this.rythmeOf(file);
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      for (const d of RYTHME_DIMS) {
        const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        row.createDiv({ cls: "feuillets-notes-metadata-label", text: d.label });
        const input = row.createEl("input", { cls: "feuillets-rythme-input", type: "number" });
        input.min = "0";
        input.max = String(RYTHME_MAX);
        input.value = String(r[d.key]);
        input.addEventListener("change", async () => {
          const v = Math.max(0, Math.min(RYTHME_MAX, Math.round(Number(input.value) || 0)));
          input.value = String(v);
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.pace = fm.pace || fm.rythme || {};
            fm.pace[d.key] = v;
            delete fm.rythme;
          });
          this.render();
        });
      }
    });

    } // fin du groupe « Ce feuillet »

    // ========================= LE ROMAN =========================
    if (!this.group(container, "book-open", "Le roman", "roman")) {
    const gb = container.createDiv({ cls: "feuillets-analysis-groupbody" });

    // Tableau de bord (synthèse du manuscrit)
    const dashCollapsed = !!(S.collapsed && S.collapsed["analyse:dashboard"]);
    const dash = dashCollapsed ? null : await this.getDashboard();
    this.tool(gb, "dashboard", "layout-dashboard", "Tableau de bord", (section) => {
      if (!dash) return;
      const list = section.createDiv({ cls: "feuillets-notes-metadata-list" });
      const row = (label, value) => {
        const r = list.createDiv({ cls: "feuillets-notes-metadata-row" });
        r.createDiv({ cls: "feuillets-notes-metadata-label", text: label });
        r.createDiv({ cls: "feuillets-notes-metadata-value", text: value });
      };
      row("Mots", formatNumber(dash.words));
      row("Chapitres", formatNumber(dash.chapters));
      row("Scènes", formatNumber(dash.scenes));
      row("Ratio dialogue", `${dash.dialoguePct} %`);
      row("Mots différents", formatNumber(dash.uniqueSurface));
      row("Zones de répétition", formatNumber(dash.repZones));
      row("Chapitres déséquilibrés", formatNumber(dash.outliers));
      row("Scènes taguées (rythme)", `${dash.tagged}/${dash.scenes} (${dash.taggedPct} %)`);

      const bar = section.createDiv({ cls: "feuillets-analysis-export-bar" });
      const copyBtn = bar.createEl("button", { text: "Copier la synthèse" });
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(this.dashboardMarkdown(dash));
          new Notice("Synthèse copiée dans le presse-papier.");
        } catch (e) {
          new Notice("Copie impossible.");
        }
      });
      const saveBtn = bar.createEl("button", { text: "Enregistrer (.md)" });
      saveBtn.addEventListener("click", () => this.exportDashboardFile(dash));
    });

    // ---- Équilibre des chapitres (niveau roman) ----
    // Calcul lourd (lit tout le manuscrit) : seulement si la section est
    // dépliée, pour ne rien coûter quand elle est repliée.
    const chaptersCollapsed = !!(S.collapsed && S.collapsed["analyse:chapters"]);
    const chapters = chaptersCollapsed ? null : await this.getChaptersData();

    this.tool(gb, "chapters", "bar-chart-horizontal", "Équilibre des chapitres", (section) => {
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

    // ---- Vocabulaire du roman (Grammalecte, desktop, calcul lourd) ----
    const romanVocabCollapsed = !!(S.collapsed && S.collapsed["analyse:vocab-roman"]);
    const romanVocab = romanVocabCollapsed || Platform.isMobile ? null : await this.getRomanVocab();

    this.tool(gb, "vocab-roman", "book-marked", "Vocabulaire du roman (Grammalecte)", (section) => {
      this.renderVocabInto(section, romanVocab);
    });

    // ---- Courbe narrative (déduite des tags de rythme) ----
    this.tool(gb, "curve", "activity", "Courbe narrative", (section) => {
      const scenes = this.sceneFiles();
      const tagged = scenes.filter((f) => {
        const r = this.rythmeOf(f);
        return RYTHME_DIMS.some((d) => r[d.key] > 0);
      });
      if (!tagged.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText(
          "Aucune scène taguée. Renseigne « Rythme du feuillet » (groupe Ce feuillet) sur tes scènes pour tracer la courbe."
        );
        return;
      }

      const curve = section.createDiv({ cls: "feuillets-curve" });
      for (const f of scenes) {
        const r = this.rythmeOf(f);
        const total = RYTHME_DIMS.reduce((n, d) => n + r[d.key], 0);
        const rowEl = curve.createDiv({ cls: "feuillets-curve-row" });
        rowEl.createSpan({ cls: "feuillets-curve-label", text: this.plugin.shortTitleFor(f) });
        const bar = rowEl.createDiv({ cls: "feuillets-curve-bar" + (total ? "" : " is-empty") });
        for (const d of RYTHME_DIMS) {
          if (r[d.key] <= 0) continue;
          const seg = bar.createDiv({ cls: `feuillets-curve-seg feuillets-curve-seg-${d.key}` });
          seg.style.flexGrow = String(r[d.key]);
          seg.setAttr("title", `${d.label} ${r[d.key]}/${RYTHME_MAX}`);
        }
        rowEl.addEventListener("click", () =>
          openFileActivating(this.app, this.app.workspace.getLeaf(false), f)
        );
      }

      const legend = section.createDiv({ cls: "feuillets-curve-legend" });
      for (const d of RYTHME_DIMS) {
        const item = legend.createSpan({ cls: "feuillets-curve-legend-item" });
        item.createSpan({ cls: `feuillets-curve-swatch feuillets-curve-seg-${d.key}` });
        item.createSpan({ text: d.label });
      }
    });

    } // fin du groupe « Le roman »
  }
}
