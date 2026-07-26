const { setIcon, Notice, Platform, TFile } = require("obsidian");
import JSZip from "jszip";
import { VIEW_DOCX_REVIEW } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { renderCollapsibleHead } from "../utils/dom.js";
import {
  parseDocxReview,
  resolveScenesToPaths,
  resolveOrphans,
  mergeGlobalMovePairs,
  searchTextForChange,
  planApply,
  planApplyInterFile,
  findTolerant,
} from "../services/docx-review-import.js";
import { bookmarkIdFor } from "../utils/docx-bookmarks.js";
import { t, getLocale } from "../i18n/index.js";

/* Icône par type de retour — même esprit que getResearchSectionIcon
 * (base-feuillets-view.js) : un repère visuel immédiat, avant même de lire
 * le texte, pour distinguer d'un coup d'œil ajout/suppression/remplacement/
 * déplacement/commentaire/mise en forme dans une liste qui peut en
 * contenir des dizaines. */
function iconFor(entry) {
  if (entry.type === "move" || entry.moved) return "move";
  if (entry.anchorText !== undefined) return entry.isFormatting ? "highlighter" : "message-square";
  if (entry.type === "insertion") return "plus";
  if (entry.type === "deletion") return "minus";
  return "repeat"; // replacement
}

/* w:rPrChange marker -> classe CSS appliquant la VRAIE mise en forme
 * (barré/souligné/surligné/gras/italique) sur le texte d'ancrage, plutôt
 * qu'une étiquette qui se contente de la décrire (voir renderComment). */
const FORMAT_MARKER_CLASSES = {
  "w:strike": "feuillets-docx-review-format-strike",
  "w:u": "feuillets-docx-review-format-underline",
  "w:highlight": "feuillets-docx-review-format-highlight",
  "w:b": "feuillets-docx-review-format-bold",
  "w:i": "feuillets-docx-review-format-italic",
};

/** Panneau Révision : lit un .docx annoté (suivi des modifications +
 * commentaires Word) renvoyé par un directeur/éditeur et affiche chaque
 * retour classé par feuillet — remplace la première version en fenêtre
 * modale (retour utilisateur : une modale n'offre pas assez de place pour
 * naviguer commentaire par commentaire, appliquer, ouvrir le feuillet
 * correspondant, sans se refermer entre chaque action). Toute la logique de
 * lecture/parsing reste pure et testée (services/docx-review-import.js) ;
 * ce panneau ne fait que l'affichage et l'écriture réelle, jamais
 * automatique.
 *
 * Volontairement absent de la liste des vues auto-rafraîchies par
 * renderAllViews (main.js) : contrairement à Recherche/Notes/Journal, le
 * contenu de ce panneau (résultat d'UNE analyse ponctuelle) ne dérive pas
 * de l'état courant du coffre — un rafraîchissement de fond intempestif
 * effacerait l'écran de résultats en cours de consultation sans raison
 * (même classe de bug que celui corrigé sur la sélection d'extrait du
 * panneau Recherche). Seules les actions de CE panneau déclenchent son
 * propre re-rendu. */
function getItemKey(item) {
  const type = item.type || (item.isFormatting ? "formatting" : "comment");
  const author = item.author || "";
  const date = item.date || "";
  const ctx = item.contextBefore || item.fromContext || item.anchorText || "";
  const txt = item.text || item.newText || item.oldText || "";
  /* item.ord (posé au parse, voir parseDocumentXml) départage deux retours
     par ailleurs identiques — sans lui, résoudre l'un les masquait tous.
     Fallback "" pour les retours créés APRÈS le parse (paires de
     déplacement inter-feuillets fusionnées dans la vue), où une collision
     est de toute façon quasi impossible. */
  const ord = item.ord != null ? item.ord : "";
  return `${type}|${author}|${date}|${ctx}|${txt}|${ord}`;
}

function resolveVaultFile(app, path) {
  if (!path) return null;
  const direct = app.vault.getAbstractFileByPath(path);
  if (direct instanceof TFile) return direct;
  return (
    app.vault.getMarkdownFiles().find(
      (f) => f.path === path || f.name === path || f.basename === path || f.path.endsWith("/" + path)
    ) || null
  );
}

export class DocxReviewView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.mode = "picker"; // "picker" | "results"
    this.results = null; // { byPath, unmatched, unclassified }
    this.showResolved = false; // false = vider la pile des retours traités
    this.docxName = "";
  }

  getViewType() {
    return VIEW_DOCX_REVIEW;
  }

  getDisplayText() {
    return t("docxReview.displayText");
  }

  getIcon() {
    return "file-diff";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-docx-review-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(section, "file-diff", t("docxReview.displayText"), "docxReview", "revision");
    if (collapsed) return;

    if (this.mode === "results" && this.results) {
      await this.renderResultsPanel(section);
    } else {
      await this.renderPickerPanel(section);
    }
  }

  async saveItemState(item) {
    if (!this.docxName) return;
    const S = this.plugin.settings;
    if (!S.docxReviewResolved) S.docxReviewResolved = {};
    if (!S.docxReviewResolved[this.docxName]) S.docxReviewResolved[this.docxName] = {};

    const key = getItemKey(item);
    S.docxReviewResolved[this.docxName][key] = {
      applied: !!item.applied,
      dismissed: !!item.dismissed,
    };
    await this.plugin.saveSettings();
  }

  /** Snapshot du feuillet AVANT sa première modification de la session de
   * relecture (filet de sécurité : chaque application écrit directement dans
   * le coffre — un snapshot permet de revenir en arrière via "Comparer avec
   * le snapshot" / la corbeille des snapshots). Une seule fois par feuillet
   * et par session (Set réinitialisé à chaque nouvelle analyse) : appliquer
   * dix retours dans un même feuillet ne crée pas dix copies. */
  async ensureSnapshot(file) {
    if (!(file instanceof TFile)) return;
    if (!this._snapshotted) this._snapshotted = new Set();
    if (this._snapshotted.has(file.path)) return;
    const first = this._snapshotted.size === 0;
    this._snapshotted.add(file.path); // marqué avant l'await : pas de double snapshot si deux applications s'enchaînent vite
    const root = this.plugin.getProjectFolder();
    if (!root) return;
    try {
      await this.plugin.snapshotFile(file, root);
      /* Une seule fois par session, à la toute première écriture : l'auteur
         sait qu'un point de retour existe (via « Comparer avec le
         snapshot » / le dossier Snapshots) avant que la relecture ne touche
         son manuscrit. */
      if (first) new Notice(t("docxReview.snapshotCreatedNotice"));
    } catch (e) {}
  }

  async analyzeBuffer(buf, docxName = "docx-review") {
    this.docxName = docxName;
    this._snapshotted = new Set(); // nouvelle session de relecture : repartir de zéro
    let zip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch (e) {
      new Notice(t("docxReview.unreadableFile"));
      return;
    }
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      new Notice(t("docxReview.invalidDocx"));
      return;
    }
    const documentXml = await docXmlFile.async("string");
    const commentsFile = zip.file("word/comments.xml");
    const commentsXml = commentsFile ? await commentsFile.async("string") : "";
    /* footnotes.xml : les corrections/commentaires faits DANS une note de
       bas de page y vivent (jamais dans document.xml) — sans ce fichier,
       ils étaient totalement invisibles. Absent si le manuscrit n'a aucune
       note. */
    const footnotesFile = zip.file("word/footnotes.xml");
    const footnotesXml = footnotesFile ? await footnotesFile.async("string") : "";
    /* commentsExtended.xml : état « résolu » (l'éditeur a coché la case dans
       Word) et fils de réponses. Absent des .docx anciens. */
    const commentsExtFile = zip.file("word/commentsExtended.xml");
    const commentsExtendedXml = commentsExtFile ? await commentsExtFile.async("string") : "";

    const { scenes, unclassified } = parseDocxReview({
      "word/document.xml": documentXml,
      "word/comments.xml": commentsXml,
      "word/footnotes.xml": footnotesXml,
      "word/commentsExtended.xml": commentsExtendedXml,
    });
    const currentPaths = this.plugin.listCompiledFilePaths();
    const { byPath, unmatched } = resolveScenesToPaths(scenes, currentPaths);

    const idToPath = new Map(currentPaths.map((p) => [bookmarkIdFor(p), p]));
    const readContent = async (path) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? this.app.vault.read(f) : null;
    };
    const relocated = await resolveOrphans(unclassified, idToPath, readContent);
    for (const [path, bucket] of Object.entries(relocated)) {
      if (!byPath[path]) byPath[path] = { changes: [], comments: [] };
      byPath[path].changes.push(...bucket.changes);
      byPath[path].comments.push(...bucket.comments);
    }

    mergeGlobalMovePairs(byPath, unmatched, unclassified);

    // Restauration de l'état mémorisé (settings) et détection automatique des retours déjà présents dans les feuillets
    const S = this.plugin.settings;
    const savedState = S.docxReviewResolved ? S.docxReviewResolved[this.docxName] || {} : {};

    const processItem = async (item, file) => {
      const key = getItemKey(item);
      if (savedState[key]) {
        item.applied = !!savedState[key].applied;
        item.dismissed = !!savedState[key].dismissed;
      } else if (item.resolvedInWord) {
        /* Commentaire déjà coché « résolu » dans Word (commentsExtended.xml,
           w15:done) : pré-masqué à la première analyse pour ne pas encombrer
           la pile de retours à traiter — mais restaurable (le bouton
           « Rétablir » reste actif) et non mémorisé tant que l'utilisateur
           n'a rien fait, donc réévalué à chaque réouverture selon l'état
           réel du .docx. */
        item.dismissed = true;
      }
      if (!item.applied && file instanceof TFile) {
        const content = await this.app.vault.read(file);
        if (item.type === "insertion" && item.contextBefore && item.text) {
          if (findTolerant(content, item.contextBefore + item.text)) {
            item.applied = true;
            item.dismissed = true;
          }
        } else if (item.type === "replacement" && item.contextBefore && item.newText) {
          if (findTolerant(content, item.contextBefore + item.newText)) {
            item.applied = true;
            item.dismissed = true;
          }
        } else if (item.type === "deletion" && item.contextBefore && item.text) {
          if (findTolerant(content, item.contextBefore) && !findTolerant(content, item.contextBefore + item.text)) {
            item.applied = true;
            item.dismissed = true;
          }
        } else if (item.type === "move" && item.toContext && item.text && item.fromText) {
          if (findTolerant(content, item.toContext + item.text) && !findTolerant(content, item.fromText)) {
            item.applied = true;
            item.dismissed = true;
          }
        }
      }
    };

    for (const [path, bucket] of Object.entries(byPath)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      for (const change of bucket.changes) await processItem(change, file);
      for (const comment of bucket.comments) await processItem(comment, file);
    }
    for (const id of Object.keys(unmatched)) {
      for (const change of unmatched[id].changes) await processItem(change, null);
      for (const comment of unmatched[id].comments) await processItem(comment, null);
    }
    for (const change of unclassified.changes) await processItem(change, null);
    for (const comment of unclassified.comments) await processItem(comment, null);

    const totalFound =
      Object.keys(byPath).length +
      Object.keys(unmatched).length +
      (unclassified.changes.length > 0 || unclassified.comments.length > 0 ? 1 : 0);
    if (totalFound === 0) {
      new Notice(t("docxReview.noReviewFound"));
      return;
    }
    this.results = { byPath, unmatched, unclassified };
    this.mode = "results";
    await this.render();
  }

  async renderPickerPanel(container) {
    const outputFolder = await this.plugin.getOutputFolder();
    const docxFiles = outputFolder
      ? outputFolder.children
          .filter((f) => f instanceof TFile && f.extension === "docx")
          .sort((a, b) => b.stat.mtime - a.stat.mtime)
      : [];

    const section = container.createDiv({ cls: "feuillets-research-section" });
    section.createDiv({ cls: "feuillets-docx-review-group-label" }).setText(
      t("docxReview.inOutputFolder", { path: outputFolder ? " · " + outputFolder.path : "" })
    );
    const list = section.createDiv({ cls: "feuillets-research-list" });
    if (docxFiles.length === 0) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(
          outputFolder
            ? t("docxReview.noDocxYet")
            : t("docxReview.outputFolderNotFound")
        );
    } else {
      for (const f of docxFiles) {
        const row = list.createDiv({ cls: "feuillets-research-item feuillets-docx-review-file-row" });
        const icon = row.createSpan({ cls: "feuillets-cell-icon" });
        setIcon(icon, "file-text");
        const name = row.createDiv({ cls: "feuillets-docx-review-file-name" });
        name.createSpan().setText(f.name);
        name
          .createSpan({ cls: "feuillets-docx-review-file-date" })
          .setText(new Date(f.stat.mtime).toLocaleString(getLocale() === "en" ? "en-US" : "fr-FR"));
        row.addEventListener("click", async () => {
          const buf = await this.app.vault.readBinary(f);
          await this.analyzeBuffer(buf, f.name);
        });
      }
    }

    if (!Platform.isMobile) {
      const extSection = container.createDiv({ cls: "feuillets-research-section" });
      extSection.createDiv({ cls: "feuillets-docx-review-group-label" }).setText(t("docxReview.orOtherFile"));
      const row = extSection.createDiv({ cls: "feuillets-docx-review-path-row" });
      const pathInput = row.createEl("input", {
        type: "text",
        attr: { placeholder: t("docxReview.pathPlaceholder") },
      });
      pathInput.addEventListener("dragover", (e) => e.preventDefault());
      pathInput.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && f.path) pathInput.value = f.path;
      });

      const analyze = async () => {
        const path = pathInput.value.trim();
        if (!path) {
          new Notice(t("docxReview.enterPath"));
          return;
        }
        let fs;
        try {
          fs = require("fs");
        } catch (e) {
          new Notice(t("docxReview.readUnavailable"));
          return;
        }
        let buf;
        try {
          buf = fs.readFileSync(path);
        } catch (e) {
          new Notice(t("docxReview.fileNotFound", { path }));
          return;
        }
        const filename = path.split("/").pop() || "docx-review";
        await this.analyzeBuffer(buf, filename);
      };
      pathInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") analyze();
      });
      const analyzeBtn = this.iconBtn(row, "search", t("docxReview.analyzeFile"));
      analyzeBtn.addEventListener("click", analyze);
    }
  }

  async renderResultsPanel(container) {
    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    const backBtn = this.iconBtn(toolbar, "arrow-left", t("docxReview.analyzeAnother"));
    backBtn.addEventListener("click", () => {
      this.mode = "picker";
      this.results = null;
      this.render();
    });

    const toggleResolvedBtn = this.iconBtn(
      toolbar,
      this.showResolved ? "eye-off" : "eye",
      this.showResolved ? t("docxReview.hideResolved") : t("docxReview.showResolved")
    );
    toggleResolvedBtn.addEventListener("click", () => {
      this.showResolved = !this.showResolved;
      this.render();
    });

    const { byPath, unmatched, unclassified } = this.results;
    const paths = Object.keys(byPath).sort((a, b) => a.localeCompare(b, "fr"));
    const unmatchedIds = Object.keys(unmatched);

    const isResolved = (item) => item && (item.dismissed || item.applied);

    let activeMatched = 0;
    let resolvedMatched = 0;
    for (const path of paths) {
      for (const c of byPath[path].changes) (isResolved(c) ? resolvedMatched++ : activeMatched++);
      for (const c of byPath[path].comments) (isResolved(c) ? resolvedMatched++ : activeMatched++);
    }

    let activeUnmatched = 0;
    let resolvedUnmatched = 0;
    for (const id of unmatchedIds) {
      for (const c of unmatched[id].changes) (isResolved(c) ? resolvedUnmatched++ : activeUnmatched++);
      for (const c of unmatched[id].comments) (isResolved(c) ? resolvedUnmatched++ : activeUnmatched++);
    }
    /* resolvedUnmatched, pas resolvedUnclassified (variable jamais déclarée —
       ReferenceError en module strict dès qu'UN orphelin résolu était compté,
       faisant planter tout le rendu du panneau après avoir masqué un retour
       non rattaché). Les orphelins non rattachés partagent le même compteur
       "non rattaché" que les unmatched — ils sont affichés dans la même
       section (voir plus bas). */
    for (const c of unclassified.changes) (isResolved(c) ? resolvedUnmatched++ : activeUnmatched++);
    for (const c of unclassified.comments) (isResolved(c) ? resolvedUnmatched++ : activeUnmatched++);

    const totalActive = activeMatched + activeUnmatched;
    const totalResolved = resolvedMatched + resolvedUnmatched;

    if (totalActive > 0) {
      const dismissAllBtn = this.iconBtn(toolbar, "check-check", t("docxReview.markAllResolved"));
      dismissAllBtn.addEventListener("click", async () => {
        for (const path of paths) {
          for (const c of byPath[path].changes) { c.dismissed = true; await this.saveItemState(c); }
          for (const c of byPath[path].comments) { c.dismissed = true; await this.saveItemState(c); }
        }
        for (const id of unmatchedIds) {
          for (const c of unmatched[id].changes) { c.dismissed = true; await this.saveItemState(c); }
          for (const c of unmatched[id].comments) { c.dismissed = true; await this.saveItemState(c); }
        }
        for (const c of unclassified.changes) { c.dismissed = true; await this.saveItemState(c); }
        for (const c of unclassified.comments) { c.dismissed = true; await this.saveItemState(c); }
        new Notice(t("docxReview.allMarkedResolved"));
        this.render();
      });
    }

    const summary = container.createDiv({ cls: "feuillets-research-section" });
    summary.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("docxReview.toProcess", { count: totalActive }) +
        (totalResolved > 0 ? t("docxReview.resolvedSuffix", { count: totalResolved }) : "")
    );

    if (totalActive === 0 && totalResolved > 0 && !this.showResolved) {
      const emptyBox = container.createDiv({ cls: "feuillets-research-section feuillets-docx-review-done-box" });
      emptyBox.createDiv({ cls: "feuillets-notes-section-title" }).setText(t("docxReview.allDoneTitle"));
      emptyBox.createDiv({ cls: "feuillets-notes-sub" }).setText(
        t("docxReview.allDoneBody", { count: totalResolved })
      );
      const row = emptyBox.createDiv({ cls: "feuillets-docx-review-done-actions" });
      const viewResolvedBtn = this.iconBtn(row, "eye", t("docxReview.showResolved"));
      viewResolvedBtn.addEventListener("click", () => {
        this.showResolved = true;
        this.render();
      });
      const pickAnotherBtn = this.iconBtn(row, "arrow-left", t("docxReview.analyzeAnother"));
      pickAnotherBtn.addEventListener("click", () => {
        this.mode = "picker";
        this.results = null;
        this.render();
      });
      return;
    }

    const S = this.plugin.settings;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const bucket = byPath[path];

      const visibleChanges = bucket.changes.filter((c) => this.showResolved || !isResolved(c));
      const visibleComments = bucket.comments.filter((c) => this.showResolved || !isResolved(c));

      if (visibleChanges.length === 0 && visibleComments.length === 0) continue;

      const activeCount = bucket.changes.filter((c) => !isResolved(c)).length + bucket.comments.filter((c) => !isResolved(c)).length;
      const collapseKey = `docx-review:${path}`;
      const { section, head } = renderCollapsibleHead(container, {
        classes: {
          section: "feuillets-notes-section feuillets-research-section",
          head: "feuillets-notes-section-head",
          title: "feuillets-notes-section-title",
          icon: "feuillets-notes-section-icon",
        },
        title: this.plugin.titleFor(file),
        icon: "file-text",
        collapsed: !!S.collapsed[collapseKey],
        collapseKey,
        settings: S,
        onToggle: async () => {
          await this.plugin.saveSettings();
          this.render();
        },
      });

      const titleEl = head ? head.querySelector(".feuillets-notes-section-title") : null;
      if (titleEl) {
        const badgeEl = titleEl.createSpan({ cls: "feuillets-docx-review-section-badge" });
        badgeEl.setText(activeCount > 0 ? t("docxReview.badgeToProcess", { count: activeCount }) : t("docxReview.badgeResolved"));
        if (activeCount === 0) badgeEl.addClass("mod-resolved");
      }

      if (S.collapsed[collapseKey]) continue;

      const list = section.createDiv({ cls: "feuillets-research-list" });
      for (const change of visibleChanges) this.renderChange(list, file, change);
      for (const comment of visibleComments) this.renderComment(list, file, comment);
    }

    const hasUnclassified = unclassified.changes.length > 0 || unclassified.comments.length > 0;
    if (unmatchedIds.length > 0 || hasUnclassified) {
      const allUnmatchedChanges = [
        ...unmatchedIds.flatMap((id) => unmatched[id].changes),
        ...unclassified.changes,
      ].filter((c) => this.showResolved || !isResolved(c));

      const allUnmatchedComments = [
        ...unmatchedIds.flatMap((id) => unmatched[id].comments),
        ...unclassified.comments,
      ].filter((c) => this.showResolved || !isResolved(c));

      if (allUnmatchedChanges.length > 0 || allUnmatchedComments.length > 0) {
        const collapseKey = "docx-review:unmatched";
        const { section, head } = renderCollapsibleHead(container, {
          classes: {
            section: "feuillets-notes-section feuillets-research-section",
            head: "feuillets-notes-section-head",
            title: "feuillets-notes-section-title",
            icon: "feuillets-notes-section-icon",
          },
          title: t("docxReview.unmatchedTitle"),
          icon: "help-circle",
          collapsed: !!S.collapsed[collapseKey],
          collapseKey,
          settings: S,
          onToggle: async () => {
            await this.plugin.saveSettings();
            this.render();
          },
        });
        
        const titleEl = head ? head.querySelector(".feuillets-notes-section-title") : null;
        if (titleEl) {
          const badgeEl = titleEl.createSpan({ cls: "feuillets-docx-review-section-badge" });
          badgeEl.setText(t("docxReview.badgeToProcess", { count: allUnmatchedChanges.length + allUnmatchedComments.length }));
        }

        if (!S.collapsed[collapseKey]) {
          section.createDiv({ cls: "feuillets-notes-sub" }).setText(
            t("docxReview.unmatchedExplanation")
          );
          const list = section.createDiv({ cls: "feuillets-research-list" });
          for (const change of allUnmatchedChanges) this.renderChange(list, null, change);
          for (const comment of allUnmatchedComments) this.renderComment(list, null, comment);
        }
      }
    }
  }

  async openAndReveal(file, itemOrText, fallbackText) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = leaf.view && leaf.view.editor;
    if (!editor) return;

    const content = editor.getValue();
    let searchText = "";
    let targetText = "";

    if (typeof itemOrText === "string") {
      searchText = itemOrText;
      targetText = itemOrText;
    } else if (itemOrText) {
      if (itemOrText.anchorText) {
        searchText = itemOrText.anchorText;
        targetText = itemOrText.anchorText;
      } else if (itemOrText.type === "replacement") {
        searchText = (itemOrText.contextBefore || "") + itemOrText.oldText;
        targetText = itemOrText.oldText;
      } else if (itemOrText.type === "deletion") {
        searchText = (itemOrText.contextBefore || "") + itemOrText.text;
        targetText = itemOrText.text;
      } else if (itemOrText.type === "move") {
        searchText = (itemOrText.fromContext || "") + itemOrText.fromText;
        targetText = itemOrText.fromText;
      } else if (itemOrText.type === "insertion") {
        searchText = itemOrText.contextBefore || "";
        targetText = "";
      } else {
        searchText = itemOrText.text || "";
        targetText = itemOrText.text || "";
      }
    }

    const match =
      (searchText && findTolerant(content, searchText)) ||
      (fallbackText && findTolerant(content, fallbackText));

    if (!match) return;

    let selStart = match.index;
    let selEnd = match.index + match.length;

    // Si contextBefore précède la cible, restreindre la sélection aux seuls mots ciblés !
    if (targetText && searchText.length > targetText.length && searchText.endsWith(targetText)) {
      const offset = match.length - targetText.length;
      if (offset > 0) selStart = match.index + offset;
    }

    const from = editor.offsetToPos(selStart);
    const to = editor.offsetToPos(selEnd);

    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }

  renderChange(container, file, change) {
    const row = container.createDiv({ cls: "feuillets-research-item feuillets-docx-review-row" });
    if (change.dismissed || change.applied) {
      row.addClass("feuillets-docx-review-applied");
    }

    const header = row.createDiv({ cls: "feuillets-research-item-header" });
    const icon = header.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, iconFor(change));

    const labels = {
      insertion: t("docxReview.change.insertion"),
      deletion: t("docxReview.change.deletion"),
      replacement: t("docxReview.change.replacement"),
      move: t("docxReview.change.move"),
    };
    const label =
      (change.inFootnote ? t("docxReview.change.footnotePrefix") : "") +
      (change.moved && change.type !== "move" ? t("docxReview.change.movedPrefix") : "") +
      labels[change.type];
    const name = header.createDiv({ cls: "feuillets-research-item-name" });
    name.createDiv({ cls: "feuillets-docx-review-meta" }).setText(`${label} — ${change.author}${change.date ? " · " + change.date : ""}`);
    const preview = name.createDiv({ cls: "feuillets-docx-review-preview" });

    if (change.type === "replacement") {
      if (change.contextBefore) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.contextBefore + " ");
      preview.createSpan({ cls: "feuillets-docx-review-removed" }).setText(change.oldText);
      preview.createSpan().setText(" → ");
      preview.createSpan({ cls: "feuillets-docx-review-added" }).setText(change.newText);
    } else if (change.type === "move") {
      const fromFileObj = change.fromPath ? resolveVaultFile(this.app, change.fromPath) : null;
      const toFileObj = change.toPath ? resolveVaultFile(this.app, change.toPath) : null;

      const fromLabel = fromFileObj instanceof TFile && fromFileObj !== file
        ? t("docxReview.change.cutFrom", { title: this.plugin.titleFor(fromFileObj) })
        : t("docxReview.change.cut");
      const toLabel = toFileObj instanceof TFile && toFileObj !== file
        ? t("docxReview.change.pasteInto", { title: this.plugin.titleFor(toFileObj) })
        : t("docxReview.change.paste");

      preview.createSpan({ cls: "feuillets-docx-review-move-label mod-cut" }).setText(fromLabel);
      if (change.fromContext) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.fromContext + " ");
      preview.createSpan({ cls: "feuillets-docx-review-removed" }).setText(change.fromText);
      preview.createEl("br");
      preview.createSpan({ cls: "feuillets-docx-review-move-label mod-paste" }).setText(toLabel);
      if (change.toContext) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.toContext + " ");
      preview.createSpan({ cls: "feuillets-docx-review-added" }).setText(change.text);
    } else {
      if (change.contextBefore) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.contextBefore + " ");
      preview
        .createSpan({ cls: change.type === "insertion" ? "feuillets-docx-review-added" : "feuillets-docx-review-removed" })
        .setText(change.text);
    }

    const fallbackText = change.type === "move" ? change.toContext : change.contextBefore;

    if (file) {
      row.style.cursor = "pointer";
      row.title = t("docxReview.openAndShowTooltip");
      row.addEventListener("click", () => this.openAndReveal(file, change, fallbackText));

      if (!change.applied) {
        const applyBtn = this.iconBtn(header, "check", t("docxReview.applyChange"));
        applyBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          let result;
          const fromFile = change.fromPath ? resolveVaultFile(this.app, change.fromPath) || file : file;
          const toFile = change.toPath ? resolveVaultFile(this.app, change.toPath) || file : file;

          if (change.type === "move" && fromFile instanceof TFile && toFile instanceof TFile && fromFile.path !== toFile.path) {
            await this.ensureSnapshot(fromFile);
            await this.ensureSnapshot(toFile);
            result = await planApplyInterFile(this.app.vault, fromFile, toFile, change);
          } else {
            const targetFile = change.type === "move" && toFile instanceof TFile ? toFile : file;
            const content = await this.app.vault.read(targetFile);
            result = planApply(content, change);
            if (result.ok) {
              await this.ensureSnapshot(targetFile);
              await this.app.vault.modify(targetFile, result.newContent);
            }
          }

          if (!result.ok) {
            new Notice(
              result.reason === "ambiguous"
                ? t("docxReview.ambiguousPassage")
                : t("docxReview.passageNotFound")
            );
            return;
          }
          change.applied = true;
          change.dismissed = true;
          await this.saveItemState(change);
          new Notice(t("docxReview.changeAppliedNotice"));
          this.render();
        });
      }
    } else {
      this.renderNearFilesHints(header, change, row);
    }

    const dismissBtn = this.iconBtn(
      header,
      change.dismissed ? "rotate-ccw" : "x",
      change.dismissed ? t("docxReview.restoreInStack") : t("docxReview.hideMarkResolved")
    );
    dismissBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      change.dismissed = !change.dismissed;
      await this.saveItemState(change);
      if (change.dismissed) {
        new Notice(t("docxReview.itemHiddenNotice"));
      } else {
        new Notice(t("docxReview.itemRestoredNotice"));
      }
      this.render();
    });
  }

  /** Permet d'appliquer ou d'ouvrir un retour depuis ses feuillets candidats
   * (lorsqu'il est tombé dans les éléments non rattachés). */
  renderNearFilesHints(header, item, row) {
    const candidatePaths = [
      ...(item.nearFiles || []),
      ...(item.fromPath ? [item.fromPath] : []),
      ...(item.toPath ? [item.toPath] : []),
    ];
    const candidates = [...new Set(candidatePaths.filter(Boolean))];
    if (candidates.length === 0) return;

    if (row && candidates[0]) {
      const fFirst = resolveVaultFile(this.app, candidates[0]);
      if (fFirst instanceof TFile) {
        row.style.cursor = "pointer";
        row.title = t("docxReview.clickToOpen", { title: this.plugin.titleFor(fFirst) });
        row.addEventListener("click", () => this.openAndReveal(fFirst, item.anchorText || searchTextForChange(item)));
      }
    }

    if (!item.applied) {
      for (const path of candidates) {
        const f = resolveVaultFile(this.app, path);
        if (!(f instanceof TFile)) continue;
        const title = this.plugin.titleFor(f);

        const applyBtn = this.iconBtn(header, "check", t("docxReview.applyInto", { title }));
        applyBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          let result;
          if (item.type === "move") {
            const fromFile = item.fromPath ? resolveVaultFile(this.app, item.fromPath) || f : f;
            const toFile = item.toPath ? resolveVaultFile(this.app, item.toPath) || f : f;
            if (fromFile instanceof TFile && toFile instanceof TFile && fromFile.path !== toFile.path) {
              await this.ensureSnapshot(fromFile);
              await this.ensureSnapshot(toFile);
              result = await planApplyInterFile(this.app.vault, fromFile, toFile, item);
            } else {
              const content = await this.app.vault.read(f);
              result = planApply(content, item);
              if (result.ok) { await this.ensureSnapshot(f); await this.app.vault.modify(f, result.newContent); }
            }
          } else {
            const content = await this.app.vault.read(f);
            result = planApply(content, item);
            if (result.ok) { await this.ensureSnapshot(f); await this.app.vault.modify(f, result.newContent); }
          }

          if (!result.ok) {
            new Notice(
              result.reason === "ambiguous"
                ? t("docxReview.ambiguousPassageShort")
                : t("docxReview.passageNotFoundInSheet")
            );
            return;
          }
          item.applied = true;
          item.dismissed = true;
          await this.saveItemState(item);
          new Notice(t("docxReview.changeAppliedInto", { title }));
          this.render();
        });
      }
    }
  }

  renderComment(container, file, comment) {
    const row = container.createDiv({ cls: "feuillets-research-item feuillets-docx-review-row" });
    if (comment.dismissed) {
      row.addClass("feuillets-docx-review-applied");
    }

    const header = row.createDiv({ cls: "feuillets-research-item-header" });
    const icon = header.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, iconFor(comment));

    const baseLabel = comment.isFormatting
      ? t("docxReview.comment.formatting")
      : (comment.parentId != null ? t("docxReview.comment.reply") : t("docxReview.comment.comment"));
    const label = (comment.inFootnote ? t("docxReview.change.footnotePrefix") : "") + baseLabel;
    const name = header.createDiv({ cls: "feuillets-research-item-name" });
    const metaEl = name.createDiv({ cls: "feuillets-docx-review-meta" });
    metaEl.setText(`${label} — ${comment.author}${comment.date ? " · " + comment.date : ""}`);
    if (comment.resolvedInWord) {
      metaEl.createSpan({ cls: "feuillets-docx-review-section-badge mod-resolved" }).setText(t("docxReview.comment.resolvedInWord"));
    }
    if (comment.anchorText) {
      const anchorEl = name.createDiv({ cls: "feuillets-docx-review-anchor" });
      if (comment.isFormatting && comment.markers && comment.markers.length > 0) {
        const span = anchorEl.createSpan();
        span.setText(comment.anchorText);
        for (const marker of comment.markers) {
          const cls = FORMAT_MARKER_CLASSES[marker];
          if (cls) span.addClass(cls);
        }
      } else {
        anchorEl.setText(t("docxReview.comment.anchorQuoted", { text: comment.anchorText }));
      }
    }
    if (!comment.isFormatting) {
      name.createDiv({ cls: "feuillets-docx-review-comment-text" }).setText(comment.text);
    }

    if (file) {
      row.style.cursor = "pointer";
      row.title = t("docxReview.openAndShowTooltip");
      row.addEventListener("click", () => this.openAndReveal(file, comment.anchorText));
    } else {
      this.renderNearFilesHints(header, comment, row);
    }

    const dismissBtn = this.iconBtn(
      header,
      comment.dismissed ? "rotate-ccw" : "x",
      comment.dismissed ? t("docxReview.showInStack") : t("docxReview.hideMarkResolvedShort")
    );
    dismissBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      comment.dismissed = !comment.dismissed;
      await this.saveItemState(comment);
      if (comment.dismissed) {
        new Notice(t("docxReview.commentResolvedNotice"));
      } else {
        new Notice(t("docxReview.commentRestoredNotice"));
      }
      this.render();
    });
  }
}
