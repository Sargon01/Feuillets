import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { analyzeProse } from "../utils/literary-analysis.js";
import { formatNumber, stripWritingNoise } from "../utils/text-metrics.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getChapters, flattenFiles, isFrontMatter } from "../services/folder-structure.js";
import { findRepetitions } from "../utils/repetitions.js";

const { TFile, TFolder, Platform } = require("obsidian");

/** Extrait le lemme d'une chaîne morphologique Grammalecte (`>lemme …`). */
function lemmaOfMorph(morph) {
  const m = morph.match(/>([0-9a-zà-öø-ÿ-]+)/i);
  return m ? m[1] : "";
}

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
    const re = /[\p{L}][\p{L}\p{N}'’-]*/gu;
    const freq = new Map();
    let m;
    while ((m = re.exec(clean)) !== null) {
      const key = m[0].toLowerCase();
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
      const morphs = sc.getMorph(word) || [];
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

    const top = (map, k) => [...map.entries()].sort((x, y) => y[1] - x[1]).slice(0, k);
    const hapaxCount = [...allLemmas.values()].filter((v) => v === 1).length;
    const mentTotal = [...ment.values()].reduce((s, v) => s + v, 0);
    return {
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
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const r = (fm && fm.rythme) || {};
    const out = {};
    for (const d of RYTHME_DIMS) {
      const v = Number(r[d.key]);
      out[d.key] = Number.isFinite(v) ? Math.max(0, Math.min(RYTHME_MAX, Math.round(v))) : 0;
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
    const S = this.plugin.settings;

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

    // ---- Répétitions rapprochées (feuillet actif) ----
    const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const reps = findRepetitions(raw.slice(bodyStart));

    this.tool(container, "repetitions", "copy", "Répétitions rapprochées", (section) => {
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

    this.tool(container, "vocab", "book-a", "Vocabulaire (Grammalecte)", (section) => {
      if (Platform.isMobile) {
        section.createDiv({ cls: "feuillets-empty" }).setText("Analyse morphologique : bureau uniquement.");
        return;
      }
      if (!vocab || vocab.error) {
        section.createDiv({ cls: "feuillets-empty" }).setText(
          "Analyse indisponible (moteur Grammalecte non chargé)."
        );
        return;
      }
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        `Richesse lexicale ${Math.round(vocab.richness * 100)} % · ` +
          `${formatNumber(vocab.uniqueLemmas)} lemmes / ${formatNumber(vocab.contentTotal)} mots pleins · ` +
          `${formatNumber(vocab.hapaxCount)} hapax`
      );
      const group = (label, entries) => {
        const g = section.createDiv({ cls: "feuillets-analysis-summary feuillets-vocab-group" });
        g.setText(label);
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
      group("Adjectifs favoris", vocab.adjs);
      group("Adverbes favoris", vocab.advs);
      group(
        `Adverbes en -ment : ${formatNumber(vocab.mentTotal)} (${vocab.mentPct} %)` +
          (vocab.mentPct >= 3 ? " · à surveiller" : ""),
        vocab.mentTop
      );
      section.createDiv({ cls: "feuillets-analysis-summary" }).setText(
        "Morphologie française (Grammalecte) — formes ambiguës comptées au plus large, indicatif."
      );
    });

    // ---- Équilibre des chapitres (niveau roman) ----
    // Calcul lourd (lit tout le manuscrit) : seulement si la section est
    // dépliée, pour ne rien coûter quand elle est repliée.
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

    // ---- Rythme du feuillet (tags manuels de la scène active) ----
    this.tool(container, "rythme", "sliders-horizontal", "Rythme du feuillet", (section) => {
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
            fm.rythme = fm.rythme || {};
            fm.rythme[d.key] = v;
          });
          this.render();
        });
      }
    });

    // ---- Courbe narrative (déduite des tags de rythme) ----
    this.tool(container, "curve", "activity", "Courbe narrative", (section) => {
      const scenes = this.sceneFiles();
      const tagged = scenes.filter((f) => {
        const r = this.rythmeOf(f);
        return RYTHME_DIMS.some((d) => r[d.key] > 0);
      });
      if (!tagged.length) {
        section.createDiv({ cls: "feuillets-empty" }).setText(
          "Aucune scène taguée. Renseigne le rythme des feuillets (section ci-dessus) pour tracer la courbe."
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
  }
}
