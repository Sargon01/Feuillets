import { setIcon, Notice, Platform, TFile, TAbstractFile, type App, type WorkspaceLeaf } from "obsidian";
import JSZip from "jszip";
import { VIEW_DOCX_REVIEW } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import {
  parseDocxReview,
  resolveScenesToPaths,
  resolveOrphans,
  mergeGlobalMovePairs,
  mergeImplicitCutPastePairs,
  absorbMoveOwnedFootnoteRevisions,
  searchTextForChange,
  planApply,
  planApplyInterFile,
  findTolerant,
  findCommentAnchor,
  locateChangeMatch,
  evaluateSingleFileConfidence,
  evaluateInterFileConfidence,
  type ReviewConfidence,
  type ReviewConfidenceReason,
} from "../services/docx-review-import.js";
import { bookmarkIdFor } from "../utils/docx-bookmarks.js";
import { t, getLocale } from "../i18n/index.js";

type DocxReviewPluginBase = ConstructorParameters<typeof BaseFeuilletsView>[1];
type ReviewMode = "picker" | "results";
type ReviewChangeType = "insertion" | "deletion" | "replacement" | "move";
type SavedReviewState = { applied: boolean; dismissed: boolean };
type ReviewStateByItem = Record<string, SavedReviewState>;
type ReviewStateByDocument = Record<string, ReviewStateByItem>;
type ReviewEntryBase = {
  type?: ReviewChangeType;
  author: string;
  date: string;
  text?: string;
  contextBefore?: string;
  fromContext?: string;
  fromText?: string;
  toContext?: string;
  oldText?: string;
  newText?: string;
  fromPath?: string | null;
  toPath?: string | null;
  toContextAfter?: string;
  /** Texte réel autour de la plage annotée par UN COMMENTAIRE (voir
   * findCommentAnchor) — jamais posé pour un ReviewChange. */
  contextAfter?: string;
  destinationBoundary?: "inline" | "paragraph-start" | "paragraph-end" | "between-paragraphs" | "standalone-paragraph";
  footnoteRefs?: string[];
  anchorText?: string;
  parentId?: string;
  isFormatting?: boolean;
  markers?: string[];
  nearFiles?: string[];
  moved?: boolean;
  /** Renseigné UNIQUEMENT pour un déplacement Word NATIF (w:moveFrom/
   * w:moveTo, voir docx-review-import.ts#ChangeMetadata) — absent pour un
   * couper-coller DÉDUIT d'un w:del + w:ins séparés (mergeImplicitCutPastePairs).
   * Lu par evaluateSingleFileConfidence/evaluateInterFileConfidence (LOT 4)
   * pour distinguer les deux : jamais réévalué ici, la vue ne fait que lire
   * ce que le moteur a déjà déterminé au parsing/à la fusion. */
  moveName?: string | null;
  /** LOT 4 — posé par resolveOrphans quand ce retour était d'abord orphelin
   * et relocalisé vers un unique feuillet candidat (voir
   * docx-review-import.ts#ChangeMetadata.relocatedOrphan). */
  relocatedOrphan?: boolean;
  inFootnote?: boolean;
  resolvedInWord?: boolean;
  ord?: number | string;
  applied?: boolean;
  dismissed?: boolean;
  /** LOT 4 — statuts de confiance ("Sûr"/"À vérifier"/"Ambigu"), calculés
   * UNE FOIS à l'analyse (voir analyzeBuffer#evaluateItemConfidence) à
   * partir de preuves déjà connues du moteur (evaluateSingleFileConfidence/
   * evaluateInterFileConfidence) — jamais recalculés au rendu, jamais une
   * seconde recherche ici. Absent pour un commentaire (consultatif, hors
   * périmètre de ce lot) ou tant que l'analyse confiance n'a pas tourné. */
  confidence?: ReviewConfidence;
  confidenceReasons?: ReviewConfidenceReason[];
};
type ReviewChange = ReviewEntryBase & { type: ReviewChangeType };
type ReviewComment = ReviewEntryBase & { anchorText: string };
type ReviewBucket = { changes: ReviewChange[]; comments: ReviewComment[] };
type ReviewBuckets = Record<string, ReviewBucket>;
type ReviewResults = { byPath: ReviewBuckets; unmatched: ReviewBuckets; unclassified: ReviewBucket };
type ReviewEntry = ReviewChange | ReviewComment;
type DocxReviewSettings = FeuilletsSettings & {
  collapsed: Record<string, boolean>;
  docxReviewResolved?: ReviewStateByDocument;
};
type DocxReviewPlugin = Omit<DocxReviewPluginBase, "settings"> & {
  settings: DocxReviewSettings;
  getOutputFolder(): Promise<{ path: string; children: unknown[] } | null>;
  listCompiledFilePaths(): string[];
  snapshotFile(file: TFile, root: unknown): Promise<unknown>;
  titleFor(file: TFile): string;
};
type EditorLike = {
  getValue(): string;
  offsetToPos(offset: number): unknown;
  setSelection(from: unknown, to: unknown): void;
  scrollIntoView(range: { from: unknown; to: unknown }, center: boolean): void;
};

function hasEditor(view: object): view is { editor: EditorLike } {
  return "editor" in view;
}

function hasChildren(folder: object): folder is { children: unknown[] } {
  return "children" in folder && Array.isArray(folder.children);
}

/* Icône par type de retour — même esprit que getResearchSectionIcon
 * (base-feuillets-view.js) : un repère visuel immédiat, avant même de lire
 * le texte, pour distinguer d'un coup d'œil ajout/suppression/remplacement/
 * déplacement/commentaire/mise en forme dans une liste qui peut en
 * contenir des dizaines. */
function iconFor(entry: ReviewEntry): string {
  if (entry.type === "move" || entry.moved) return "move";
  if (entry.anchorText !== undefined) return entry.isFormatting ? "highlighter" : "message-square";
  if (entry.type === "insertion") return "plus";
  if (entry.type === "deletion") return "minus";
  return "repeat"; // replacement
}

/* Libellé discret du point d'insertion d'un déplacement (Lot 2, voir
 * docx-review-import.ts#computeDestinationBoundary) — jamais recalculé ici,
 * seulement traduit pour l'affichage. */
function boundaryLabel(boundary: ReviewChange["destinationBoundary"]): string | null {
  switch (boundary) {
    case "inline": return t("docxReview.boundary.inline");
    case "paragraph-start": return t("docxReview.boundary.paragraphStart");
    case "paragraph-end": return t("docxReview.boundary.paragraphEnd");
    case "between-paragraphs": return t("docxReview.boundary.betweenParagraphs");
    case "standalone-paragraph": return t("docxReview.boundary.standaloneParagraph");
    default: return null;
  }
}

/* LOT 4 — libellé du badge de confiance ("Sûr"/"À vérifier"/"Ambigu"),
 * jamais recalculé ici : `change.confidence` vient d'evaluateSingleFileConfidence/
 * evaluateInterFileConfidence (docx-review-import.ts), calculé une fois à
 * l'analyse (voir analyzeBuffer#evaluateItemConfidence). */
function confidenceLabel(confidence: ReviewConfidence): string {
  switch (confidence) {
    case "safe": return t("docxReview.confidence.safe");
    case "review": return t("docxReview.confidence.review");
    case "ambiguous": return t("docxReview.confidence.ambiguous");
  }
}

/* LOT 5 — libellé explicatif d'une confidenceReason ("Pourquoi À vérifier ?"/
 * "Pourquoi Ambigu ?", voir docxReview.md §4) : jamais une nouvelle preuve,
 * seulement la traduction lisible d'un fait DÉJÀ déterminé par le moteur
 * (ReviewConfidenceReason, docx-review-import.ts). */
function confidenceReasonLabel(reason: ReviewConfidenceReason): string {
  switch (reason) {
    case "exact-match": return t("docxReview.reason.exactMatch");
    case "context-degraded": return t("docxReview.reason.contextDegraded");
    case "implicit-move": return t("docxReview.reason.implicitMove");
    case "relocated-orphan": return t("docxReview.reason.relocatedOrphan");
    case "unresolved-path": return t("docxReview.reason.unresolvedPath");
    case "multiple-matches": return t("docxReview.reason.multipleMatches");
    case "missing-source": return t("docxReview.reason.missingSource");
    case "footnote-unverifiable": return t("docxReview.reason.footnoteUnverifiable");
    case "structure-unverifiable": return t("docxReview.reason.structureUnverifiable");
    default: return reason;
  }
}

/* LOT 5 — file de décisions éditoriales : un élément aplati (changement OU
 * commentaire), quel que soit son bucket d'origine (byPath/unmatched/
 * unclassified) — remplace les gros accordéons par feuillet comme structure
 * PRINCIPALE de navigation (mission §8), sans rien recalculer : `file`/
 * `containerPath` sont juste portés le long de la file pour que renderChange/
 * renderComment gardent EXACTEMENT le même comportement qu'appelés depuis
 * l'ancien regroupement par feuillet. */
type ReviewFilter = "all" | "corrections" | "moves" | "comments" | "review";
type QueueEntry = {
  kind: "change" | "comment";
  item: ReviewEntry;
  file: TFile | null;
  containerPath: string | null;
};

/** Aplatit byPath/unmatched/unclassified en une file UNIQUE, ordonnée par
 * `item.ord` (posé UNE FOIS au parse, en ordre de document — voir
 * parseDocumentXml#stamp, docx-review-import.ts) quand il est disponible.
 * Les objets créés APRÈS le parse (paires de déplacement fusionnées, voir
 * mergeGlobalMovePairs/mergeImplicitCutPastePairs) n'ont jamais cet ordinal
 * — mission §8 : "fallback déterministe sans inventer un ordre narratif
 * arbitraire". Le tri Array#sort de JS étant stable, ces objets sans `ord`
 * (traités comme +Infinity) conservent simplement leur position de
 * CONSTRUCTION ci-dessous (feuillets triés par nom, puis non-rattachés) —
 * déterministe d'un rendu à l'autre de la MÊME analyse, jamais un ordre
 * narratif inventé. */
function buildQueue(results: ReviewResults, app: App): QueueEntry[] {
  const { byPath, unmatched, unclassified } = results;
  const queue: QueueEntry[] = [];
  const paths = Object.keys(byPath).sort((a, b) => a.localeCompare(b, "fr"));
  for (const path of paths) {
    const f = app.vault.getAbstractFileByPath(path);
    const file = f instanceof TFile ? f : null;
    for (const c of byPath[path].changes) queue.push({ kind: "change", item: c, file, containerPath: path });
    for (const c of byPath[path].comments) queue.push({ kind: "comment", item: c, file, containerPath: path });
  }
  for (const id of Object.keys(unmatched).sort()) {
    for (const c of unmatched[id].changes) queue.push({ kind: "change", item: c, file: null, containerPath: null });
    for (const c of unmatched[id].comments) queue.push({ kind: "comment", item: c, file: null, containerPath: null });
  }
  for (const c of unclassified.changes) queue.push({ kind: "change", item: c, file: null, containerPath: null });
  for (const c of unclassified.comments) queue.push({ kind: "comment", item: c, file: null, containerPath: null });

  queue.sort((a, b) => {
    const oa = typeof a.item.ord === "number" ? a.item.ord : Number.POSITIVE_INFINITY;
    const ob = typeof b.item.ord === "number" ? b.item.ord : Number.POSITIVE_INFINITY;
    return oa - ob;
  });
  return queue;
}

function isQueueEntryResolved(entry: QueueEntry): boolean {
  return !!(entry.item.dismissed || entry.item.applied);
}

/** Filtres minimum de la mission §1 — "À vérifier" regroupe review ET
 * ambiguous (jamais un filtre par statut supplémentaire, mission : "Ne crée
 * pas une multitude de filtres"). */
function matchesFilter(entry: QueueEntry, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "comments") return entry.kind === "comment";
  /* FINITION UX (mission §2) — "Modifs" (ex-"Corrections") représente
   * insertion/suppression/remplacement ET mise en forme : une mise en forme
   * reste par ailleurs un ReviewComment (rendue par renderComment, jamais
   * Accepter/Refuser — voir isFormatting) et continue d'apparaître aussi
   * sous "Commentaires" ci-dessus, simplement retrouvable des deux façons. */
  if (filter === "corrections" && entry.kind === "comment") {
    return !!(entry.item as ReviewComment).isFormatting;
  }
  if (entry.kind === "comment") return false;
  const change = entry.item as ReviewChange;
  switch (filter) {
    case "moves": return change.type === "move";
    case "corrections": return change.type === "insertion" || change.type === "deletion" || change.type === "replacement";
    case "review": return change.confidence === "review" || change.confidence === "ambiguous";
    default: return true;
  }
}

/* Ligne de contexte COURTE de la carte Déplacement repliée (Lot 6, carte
 * compacte) — jamais le passage complet (voir la zone dépliable, qui garde
 * le texte intégral tel quel) : juste de quoi identifier le passage d'un
 * coup d'œil dans la pile. Coupe sur un espace quand possible (jamais un
 * mot tranché en plein milieu). */
function truncateForSummary(text: string, maxLen = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  const cut = flat.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

const PREVIEW_SNIPPET_RADIUS = 60;

/** Extrait lisible de `content` autour du point où `contextBefore`
 * (+`insertedText`, si fourni) est réellement localisé — Lot 3, aperçu
 * "Avant"/"Après" : jamais une supposition, toujours retrouvé dans le VRAI
 * contenu via findTolerant (même tolérance que planApply). `insertedText`
 * vide -> aperçu "Avant" (juste le contexte, rien d'ajouté) ; non vide ->
 * aperçu "Après" (passage inséré encadré de crochets pour le repérer d'un
 * coup d'œil, sans dépendre d'une mise en forme HTML). */
function previewSnippet(content: string, contextBefore: string, insertedText: string): string {
  const searchText = insertedText ? contextBefore + insertedText : contextBefore;
  const match = searchText ? findTolerant(content, searchText) : null;
  if (!match) return content.slice(0, PREVIEW_SNIPPET_RADIUS * 2);

  const centerEnd = match.index + match.length;
  const start = Math.max(0, match.index - PREVIEW_SNIPPET_RADIUS);
  const end = Math.min(content.length, centerEnd + PREVIEW_SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  let snippet = content.slice(start, end);

  if (insertedText) {
    const insertOffset = centerEnd - insertedText.length - start;
    if (insertOffset >= 0 && insertOffset + insertedText.length <= snippet.length) {
      snippet =
        snippet.slice(0, insertOffset) +
        "[" + snippet.slice(insertOffset, insertOffset + insertedText.length) + "]" +
        snippet.slice(insertOffset + insertedText.length);
    }
  }
  return prefix + snippet + suffix;
}

/* w:rPrChange marker -> classe CSS appliquant la VRAIE mise en forme
 * (barré/souligné/surligné/gras/italique) sur le texte d'ancrage, plutôt
 * qu'une étiquette qui se contente de la décrire (voir renderComment). */
const FORMAT_MARKER_CLASSES: Record<string, string> = {
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
function getItemKey(item: ReviewEntry): string {
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

function resolveVaultFile(app: App, path: string | null | undefined): TFile | null {
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
  declare plugin: DocxReviewPlugin;
  declare targetContainer?: HTMLElement;
  declare iconBtn: (
    parent: HTMLElement,
    icon: string,
    tooltip?: string,
    onClick?: (e: MouseEvent) => unknown
  ) => HTMLElement;
  mode: ReviewMode;
  results: ReviewResults | null;
  showResolved: boolean;
  docxName: string;
  /** LOT 5 — file de décisions éditoriales : filtre actif et position
   * courante dans la liste FILTRÉE (mission §8, "12 / 47" porte sur la liste
   * actuellement filtrée) — jamais persisté dans les settings, propre à la
   * session de consultation en cours (comme showResolved). */
  activeFilter: ReviewFilter;
  queueIndex: number;
  /** CORRECTIF — identité (getItemKey) de la carte active, source de vérité
   * pour resolveCurrentIndex : `queueIndex` seul (un simple entier) ne
   * survit pas correctement à un changement de filtre ou au traitement
   * d'une carte AUTRE que la carte active (l'array se décale, l'entier ne
   * pointe alors plus sur la même carte logique). `null` avant toute
   * résolution (première ouverture) — resolveCurrentIndex le pose alors
   * depuis `queueIndex` clampé. */
  activeItemKey: string | null;
  _snapshotted: Set<string> | undefined;
  /** Sous-ensemble de `_snapshotted` : uniquement les feuillets dont le
   * snapshot a RÉELLEMENT réussi (voir ensureSnapshot). `_snapshotted` seul
   * marque une simple TENTATIVE (jamais retentée dans la session, même en
   * échec — comportement existant et déjà couvert par un test, inchangé) ;
   * ce second Set permet à un appelant qui l'EXIGE (déplacement inter-
   * feuillets, voir LOT 3 sécurité transactionnelle) de savoir si un point
   * de retour existe vraiment avant d'écrire quoi que ce soit. */
  _snapshotOk: Set<string> | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: DocxReviewPluginBase) {
    super(leaf, plugin);
    this.mode = "picker"; // "picker" | "results"
    this.results = null; // { byPath, unmatched, unclassified }
    this.showResolved = false; // false = vider la pile des retours traités
    this.docxName = "";
    this.activeFilter = "all";
    this.queueIndex = 0;
    this.activeItemKey = null;
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

  async saveItemState(item: ReviewEntry) {
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

  /** CORRECTIF — carte active : source de vérité UNIQUE (mission §2).
   * 1. Si `activeItemKey` correspond encore à une entrée de `visible`
   *    (même filtre inchangé, ou changé mais l'ancienne carte y figure
   *    toujours), elle reste active — `queueIndex` est recalé sur sa
   *    NOUVELLE position (l'array a pu se décaler suite au traitement d'une
   *    AUTRE carte, voir mission "jamais revenir arbitrairement à la
   *    première").
   * 2. Sinon (carte disparue : filtrée par changement de filtre, ou
   *    résolue et masquée), repli sur `queueIndex` clampé dans les bornes
   *    de la NOUVELLE liste — la carte qui prend la place de l'ancienne
   *    (milieu de liste) ou la précédente (dernière carte traitée), jamais
   *    un saut arbitraire au début (mission §2, dernier point).
   * Dans tous les cas, `activeItemKey` est reposé sur la carte finalement
   * retenue : la prochaine résolution repart d'une identité à jour. */
  private resolveCurrentIndex(visible: QueueEntry[]): number {
    if (this.activeItemKey != null) {
      const idx = visible.findIndex((e) => getItemKey(e.item) === this.activeItemKey);
      if (idx !== -1) {
        this.queueIndex = idx;
        return idx;
      }
    }
    let idx = this.queueIndex;
    if (idx >= visible.length) idx = visible.length - 1;
    if (idx < 0) idx = 0;
    this.queueIndex = idx;
    this.activeItemKey = visible[idx] ? getItemKey(visible[idx].item) : null;
    return idx;
  }

  /** Snapshot du feuillet AVANT sa première modification de la session de
   * relecture (filet de sécurité : chaque application écrit directement dans
   * le coffre — un snapshot permet de revenir en arrière via "Comparer avec
   * le snapshot" / la corbeille des snapshots). Une seule fois par feuillet
   * et par session (Set réinitialisé à chaque nouvelle analyse) : appliquer
   * dix retours dans un même feuillet ne crée pas dix copies.
   *
   * Retourne `true` si un snapshot valide existe pour ce feuillet à l'issue
   * de l'appel (déjà présent ou créé à l'instant), `false` sinon — POUR UNE
   * APPLICATION SIMPLE (un seul feuillet), le snapshot reste une précaution
   * au mieux : l'appelant peut ignorer ce retour et continuer même en cas
   * d'échec (comportement historique, inchangé, voir applyBtn plus bas côté
   * feuillet unique). Un déplacement inter-feuillets (LOT 3, sécurité
   * transactionnelle), lui, EXIGE `true` pour les DEUX feuillets concernés
   * avant d'écrire quoi que ce soit — voir les deux call-sites de
   * planApplyInterFile. */
  async ensureSnapshot(file: TFile | null): Promise<boolean> {
    if (!(file instanceof TFile)) return true; // rien à snapshoter : pas un échec
    if (!this._snapshotted) this._snapshotted = new Set();
    if (!this._snapshotOk) this._snapshotOk = new Set();
    if (this._snapshotted.has(file.path)) return this._snapshotOk.has(file.path);
    const first = this._snapshotted.size === 0;
    this._snapshotted.add(file.path); // marqué avant l'await : pas de double snapshot si deux applications s'enchaînent vite
    const root = this.plugin.getProjectFolder();
    if (!root) return false;
    try {
      await this.plugin.snapshotFile(file, root);
      this._snapshotOk.add(file.path);
      /* Une seule fois par session, à la toute première écriture : l'auteur
         sait qu'un point de retour existe (via « Comparer avec le
         snapshot » / le dossier Snapshots) avant que la relecture ne touche
         son manuscrit. */
      if (first) new Notice(t("docxReview.snapshotCreatedNotice"));
      return true;
    } catch {
      /* Une application simple (feuillet unique) continue quand même — le
         snapshot y reste une précaution au mieux (comportement historique).
         `false` permet seulement à un appelant qui EXIGE un snapshot
         (déplacement inter-feuillets) de refuser d'écrire. */
      return false;
    }
  }

  async analyzeBuffer(buf: ArrayBuffer, docxName = "docx-review") {
    this.docxName = docxName;
    this._snapshotted = new Set(); // nouvelle session de relecture : repartir de zéro
    this._snapshotOk = new Set();
    this.activeFilter = "all"; // nouvelle analyse : repartir du début de la file
    this.queueIndex = 0;
    this.activeItemKey = null;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
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
    /* styles.xml : reconnaît les paragraphes de titre/sous-titre de
       feuillet injectés par compile-export.ts (voir
       docx-review-import.ts#parseHeadingStyleIds) — sans lui, leur texte
       polluait le contexte du premier changement de chaque feuillet.
       Absent (docx ancien) : dégradation silencieuse, aucun style reconnu
       comme titre. */
    const stylesFile = zip.file("word/styles.xml");
    const stylesXml = stylesFile ? await stylesFile.async("string") : "";

    const { scenes, unclassified } = parseDocxReview({
      "word/document.xml": documentXml,
      "word/comments.xml": commentsXml,
      "word/footnotes.xml": footnotesXml,
      "word/commentsExtended.xml": commentsExtendedXml,
      "word/styles.xml": stylesXml,
    });
    const currentPaths = this.plugin.listCompiledFilePaths();
    const { byPath, unmatched } = resolveScenesToPaths(scenes, currentPaths);

    const idToPath = new Map(currentPaths.map((p) => [bookmarkIdFor(p), p]));
    const readContent = async (path: string) => {
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
    /* Le corps d'une note déplacée AVEC son passage (voir
       MoveChange.originFootnoteIds/destFootnoteIds) est TOUJOURS retiré
       APRÈS mergeGlobalMovePairs (les MoveChange cross-feuillets n'existent
       qu'à partir de là) et TOUJOURS AVANT mergeImplicitCutPastePairs (qui,
       sinon, absorbe le couple w:del/w:ins du corps de note en un second
       "move" fantôme pour la SEULE note — voir
       docx-review-import.ts#absorbMoveOwnedFootnoteRevisions). */
    absorbMoveOwnedFootnoteRevisions(byPath, unmatched, unclassified);
    /* Couper-coller Word enregistré comme un w:del + un w:ins séparés
       (aucun w:name partagé) — TOUJOURS après mergeGlobalMovePairs : les
       vrais déplacements natifs sont déjà fusionnés et retirés, cette
       détection plus prudente n'agit que sur ce qui reste. Voir
       docx-review-import.ts#mergeImplicitCutPastePairs. */
    mergeImplicitCutPastePairs(byPath, unmatched, unclassified);

    // Restauration de l'état mémorisé (settings) et détection automatique des retours déjà présents dans les feuillets
    const S = this.plugin.settings;
    const savedState = S.docxReviewResolved ? S.docxReviewResolved[this.docxName] || {} : {};

    const processItem = async (item: ReviewEntry, file: TFile | TAbstractFile | null) => {
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

    /* LOT 4 — statuts de confiance ("Sûr"/"À vérifier"/"Ambigu"), UNE FOIS
       par analyse, uniquement sur les changements (jamais les commentaires,
       consultatifs — voir ReviewEntryBase.confidence). Réutilise
       evaluateSingleFileConfidence/evaluateInterFileConfidence (moteur,
       docx-review-import.ts) : la vue ne fait ici que lire le contenu déjà
       nécessaire et transmettre le verdict — AUCUNE recherche de texte
       n'est réimplémentée. Un item déjà appliqué n'affiche plus de bouton
       d'application : pas la peine de lui calculer une confiance. Un
       chemin non résolu (fromPath/toPath absent pour un déplacement, ou
       item toujours dans unmatched/unclassified) est TOUJOURS "ambiguous"
       — fait structurel déjà connu, jamais une nouvelle recherche. */
    const evaluateItemConfidence = async (item: ReviewChange, containerPath: string | null) => {
      if (item.applied) return;
      let evalResult: { confidence: ReviewConfidence; confidenceReasons: ReviewConfidenceReason[] };
      if (item.type === "move") {
        const fromFile = item.fromPath ? this.app.vault.getAbstractFileByPath(item.fromPath) : null;
        const toFile = item.toPath ? this.app.vault.getAbstractFileByPath(item.toPath) : null;
        if (!(fromFile instanceof TFile) || !(toFile instanceof TFile)) {
          item.confidence = "ambiguous";
          item.confidenceReasons = ["unresolved-path"];
          return;
        }
        const fromContent = await this.app.vault.read(fromFile);
        if (fromFile.path === toFile.path) {
          evalResult = evaluateSingleFileConfidence(fromContent, item as unknown as Parameters<typeof evaluateSingleFileConfidence>[1]);
        } else {
          const toContent = await this.app.vault.read(toFile);
          evalResult = evaluateInterFileConfidence(fromContent, toContent, item as unknown as Parameters<typeof evaluateInterFileConfidence>[2]);
        }
      } else {
        if (!containerPath) {
          item.confidence = "ambiguous";
          item.confidenceReasons = ["unresolved-path"];
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(containerPath);
        if (!(file instanceof TFile)) {
          item.confidence = "ambiguous";
          item.confidenceReasons = ["unresolved-path"];
          return;
        }
        const content = await this.app.vault.read(file);
        evalResult = evaluateSingleFileConfidence(content, item as unknown as Parameters<typeof evaluateSingleFileConfidence>[1]);
      }
      // La règle "orphelin relocalisé -> jamais 'safe'" vit dans le moteur
      // (evaluateSingleFileConfidence/evaluateInterFileConfidence lisent
      // directement item.relocatedOrphan, déjà passé dans `item`) : la vue
      // se contente ici de reporter le verdict tel quel.
      item.confidence = evalResult.confidence;
      item.confidenceReasons = evalResult.confidenceReasons;
    };

    for (const [path, bucket] of Object.entries(byPath)) {
      for (const change of bucket.changes) await evaluateItemConfidence(change, path);
    }
    for (const id of Object.keys(unmatched)) {
      for (const change of unmatched[id].changes) await evaluateItemConfidence(change, null);
    }
    for (const change of unclassified.changes) await evaluateItemConfidence(change, null);

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

  async renderPickerPanel(container: HTMLElement) {
    const outputFolder = await this.plugin.getOutputFolder();
    const docxFiles = outputFolder && hasChildren(outputFolder)
      ? outputFolder.children
          .filter((f): f is TFile => f instanceof TFile && f.extension === "docx")
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
        row.addEventListener("click", () => {
          void (async () => {
            const buf = await this.app.vault.readBinary(f);
            await this.analyzeBuffer(buf, f.name);
          })();
        });
      }
    }

    if (!Platform.isMobile) {
      const extSection = container.createDiv({ cls: "feuillets-research-section" });
      extSection.createDiv({ cls: "feuillets-docx-review-group-label" }).setText(t("docxReview.orOtherFile"));
      const row = extSection.createDiv({ cls: "feuillets-docx-review-path-row" });
      const fileInput = row.createEl("input", {
        type: "file",
        attr: { accept: ".docx" },
      });

      let droppedFile: File | null = null;

      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f) {
          droppedFile = f;
          void analyze();
        }
      });

      const analyze = async () => {
        const file = droppedFile || fileInput.files?.[0];
        if (!file) {
          new Notice(t("docxReview.enterPath"));
          return;
        }
        let buf: ArrayBuffer;
        try {
          buf = await file.arrayBuffer();
        } catch {
          new Notice(t("docxReview.fileNotFound", { path: file.name }));
          return;
        }
        const filename = file.name || "docx-review";
        await this.analyzeBuffer(buf, filename);
      };
      fileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void analyze();
      });
      const analyzeBtn = this.iconBtn(row, "search", t("docxReview.analyzeFile"));
      analyzeBtn.addEventListener("click", () => { void analyze(); });
    }
  }

  /** LOT 5 — panneau Révision refondu en file de décisions éditoriales
   * (mission docx-review-editorial-ui.md) : en-tête + compteurs + filtres
   * (§1), cartes compactes plates ordonnées par `ord` (§2/§8, voir
   * buildQueue), navigation Précédent/Suivant sur la liste FILTRÉE (§8).
   * Le rendu de CHAQUE carte reste renderChange/renderComment, inchangés
   * dans leur mécanique (recherche/application/snapshot) — seul ce qui les
   * ENTOURE change. */
  async renderResultsPanel(container: HTMLElement) {
    if (!this.results) return;
    const queue = buildQueue(this.results, this.app);

    const toProcessCount = queue.filter((e) => !e.item.applied && !e.item.dismissed && !e.item.resolvedInWord).length;
    const resolvedCount = queue.filter((e) => e.item.applied || e.item.resolvedInWord).length;
    const hiddenCount = queue.filter((e) => e.item.dismissed && !e.item.applied && !e.item.resolvedInWord).length;
    const totalActive = queue.filter((e) => !isQueueEntryResolved(e)).length;
    const totalResolved = queue.length - totalActive;

    /* FINITION UX — UN SEUL bloc de contrôle sticky (mission §1) : titre +
     * compteur, filtres, actions globales ET navigation Précédent/Suivant
     * vivent tous DANS ce même conteneur `stickyBar` (une seule règle
     * `position: sticky`, voir styles.css) — jamais un sticky concurrent
     * dans un sous-élément (l'ancien `.feuillets-docx-review-toolbar`
     * héritait silencieusement du sticky générique de
     * `.feuillets-research-toolbar`, indépendant de ce bloc : c'était la
     * cause du bug rapporté, la navigation défilant derrière). Seule la
     * pile de cartes (`list`, plus bas) défile SOUS ce bloc. */
    const stickyBar = container.createDiv({ cls: "feuillets-docx-review-sticky-bar" });
    const header = stickyBar.createDiv({ cls: "feuillets-docx-review-panel-header" });
    const titleRow = header.createDiv({ cls: "feuillets-docx-review-panel-title-row" });
    const backBtn = this.iconBtn(titleRow, "arrow-left", t("docxReview.analyzeAnother"));
    backBtn.addEventListener("click", () => {
      this.mode = "picker";
      this.results = null;
      void this.render();
    });
    titleRow.createDiv({ cls: "feuillets-notes-section-title" }).setText(t("docxReview.displayText"));

    header.createDiv({ cls: "feuillets-docx-review-file-date" }).setText(this.docxName);

    const counterParts: string[] = [
      toProcessCount === 1
        ? t("docxReview.counter.toProcessOne")
        : t("docxReview.counter.toProcessMany", { count: String(toProcessCount) }),
      resolvedCount === 1
        ? t("docxReview.counter.resolvedOne")
        : t("docxReview.counter.resolvedMany", { count: String(resolvedCount) }),
    ];
    if (hiddenCount > 0) {
      counterParts.push(
        hiddenCount === 1
          ? t("docxReview.counter.hiddenOne")
          : t("docxReview.counter.hiddenMany", { count: String(hiddenCount) })
      );
    }
    header.createDiv({ cls: "feuillets-notes-sub" }).setText(counterParts.join(" · "));

    // Filtres minimum (mission §1) — jamais recalculés depuis autre chose
    // que `queue`, qui porte déjà tout ce qu'il faut (matchesFilter).
    // CORRECTIF (largeur par défaut) : chaque bouton porte DEUX libellés
    // (compact/complet), le CSS (container query sur .feuillets-docx-review-
    // panel-header) choisit lequel afficher selon la largeur RÉELLE du
    // panneau — jamais un texte tronqué par ellipsis (illisible), jamais de
    // scroll horizontal : à largeur normale d'ouverture, les 5 tiennent sur
    // une seule ligne grâce au libellé compact ; réservé aux deux libellés
    // objectivement trop longs pour cette largeur ("Corrections",
    // "Déplacements", "Commentaires") — "Tous"/"À vérifier" sont déjà courts,
    // compact = complet pour ces deux-là.
    const filterDefs: { key: ReviewFilter; label: string; compact: string }[] = [
      { key: "all", label: t("docxReview.filter.all"), compact: t("docxReview.filter.all") },
      { key: "corrections", label: t("docxReview.filter.corrections"), compact: t("docxReview.filter.correctionsShort") },
      { key: "moves", label: t("docxReview.filter.moves"), compact: t("docxReview.filter.movesShort") },
      { key: "comments", label: t("docxReview.filter.comments"), compact: t("docxReview.filter.commentsShort") },
      { key: "review", label: t("docxReview.filter.review"), compact: t("docxReview.filter.review") },
    ];
    const filterRow = header.createDiv({ cls: "feuillets-docx-review-filters" });
    for (const def of filterDefs) {
      const btn = filterRow.createEl("button", { cls: "feuillets-docx-review-filter-btn" });
      if (this.activeFilter === def.key) btn.addClass("mod-active");
      btn.createSpan({ cls: "feuillets-docx-review-filter-compact" }).setText(def.compact);
      btn.createSpan({ cls: "feuillets-docx-review-filter-full" }).setText(def.label);
      btn.addEventListener("click", () => {
        if (this.activeFilter === def.key) return;
        this.activeFilter = def.key;
        // Repli si l'ancienne carte active n'existe pas dans ce nouveau
        // filtre — `activeItemKey`, lui, N'EST PAS effacé : resolveCurrentIndex
        // essaie D'ABORD de la retrouver dans la nouvelle liste filtrée
        // (mission §2 : "si l'ancienne carte existe encore... conserver sa
        // position") avant de retomber sur ce repli.
        this.queueIndex = 0;
        void this.render();
      });
    }

    /* Jamais "feuillets-research-toolbar" ici : cette classe partagée porte
     * son PROPRE `position: sticky` ailleurs dans l'app (voir styles.css) —
     * un second sticky concurrent, indépendant du bloc ci-dessus, est
     * exactement la cause du bug rapporté (mission §1, "pas de sticky
     * concurrent dans les sous-éléments"). */
    const toolbar = stickyBar.createDiv({ cls: "feuillets-docx-review-toolbar" });
    const toggleResolvedBtn = this.iconBtn(
      toolbar,
      this.showResolved ? "eye-off" : "eye",
      this.showResolved ? t("docxReview.hideResolved") : t("docxReview.showResolved")
    );
    toggleResolvedBtn.addClass("feuillets-docx-review-action-btn");
    toggleResolvedBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(
      this.showResolved ? t("docxReview.hideResolved") : t("docxReview.showResolved")
    );
    toggleResolvedBtn.addEventListener("click", () => {
      this.showResolved = !this.showResolved;
      void this.render();
    });
    if (totalActive > 0) {
      const dismissAllBtn = this.iconBtn(toolbar, "check-check", t("docxReview.markAllResolved"));
      dismissAllBtn.addClass("feuillets-docx-review-action-btn");
      dismissAllBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.markAllResolved"));
      dismissAllBtn.addEventListener("click", () => {
        void (async () => {
          for (const entry of queue) {
            if (isQueueEntryResolved(entry)) continue;
            entry.item.dismissed = true;
            await this.saveItemState(entry.item);
          }
          new Notice(t("docxReview.allMarkedResolved"));
          void this.render();
        })();
      });
    }

    if (totalActive === 0 && totalResolved > 0 && !this.showResolved) {
      const emptyBox = container.createDiv({ cls: "feuillets-research-section feuillets-docx-review-done-box" });
      emptyBox.createDiv({ cls: "feuillets-notes-section-title" }).setText(t("docxReview.allDoneTitle"));
      emptyBox.createDiv({ cls: "feuillets-notes-sub" }).setText(
        t("docxReview.allDoneBody", { count: String(totalResolved) })
      );
      const row = emptyBox.createDiv({ cls: "feuillets-docx-review-done-actions" });
      const viewResolvedBtn = this.iconBtn(row, "eye", t("docxReview.showResolved"));
      viewResolvedBtn.addEventListener("click", () => {
        this.showResolved = true;
        void this.render();
      });
      const pickAnotherBtn = this.iconBtn(row, "arrow-left", t("docxReview.analyzeAnother"));
      pickAnotherBtn.addEventListener("click", () => {
        this.mode = "picker";
        this.results = null;
        void this.render();
      });
      return;
    }

    const visible = queue
      .filter((e) => matchesFilter(e, this.activeFilter))
      .filter((e) => this.showResolved || !isQueueEntryResolved(e));

    if (visible.length === 0) {
      container.createDiv({ cls: "feuillets-research-empty" }).setText(t("docxReview.noItemsForFilter"));
      return;
    }

    // CORRECTIF (§2) — carte active : identité D'ABORD (survit à un
    // changement de filtre ou au traitement d'une AUTRE carte que
    // l'active), repli sur `queueIndex` clampé SEULEMENT si l'ancienne
    // carte n'existe plus dans cette liste — jamais un saut arbitraire au
    // début. Voir resolveCurrentIndex.
    const currentIdx = this.resolveCurrentIndex(visible);

    // Navigation dans le MÊME bloc sticky que le reste (mission §1) — jamais
    // un composant séparé qui pourrait défiler indépendamment.
    const nav = stickyBar.createDiv({ cls: "feuillets-docx-review-nav" });
    const prevBtn = this.iconBtn(nav, "chevron-left", t("docxReview.previousItem"));
    prevBtn.addEventListener("click", () => {
      const newIndex = Math.max(0, currentIdx - 1);
      this.queueIndex = newIndex;
      this.activeItemKey = visible[newIndex] ? getItemKey(visible[newIndex].item) : null;
      void this.render();
    });
    nav.createSpan({ cls: "feuillets-docx-review-nav-counter" }).setText(
      t("docxReview.navPosition", { current: String(currentIdx + 1), total: String(visible.length) })
    );
    const nextBtn = this.iconBtn(nav, "chevron-right", t("docxReview.nextItem"));
    nextBtn.addEventListener("click", () => {
      const newIndex = Math.min(visible.length - 1, currentIdx + 1);
      this.queueIndex = newIndex;
      this.activeItemKey = visible[newIndex] ? getItemKey(visible[newIndex].item) : null;
      void this.render();
    });
    if (currentIdx === 0) prevBtn.addClass("mod-disabled");
    if (currentIdx === visible.length - 1) nextBtn.addClass("mod-disabled");

    // Une SEULE notion de carte active (mission §2) : `mod-current` posée
    // ICI, sur la SEULE carte à l'index résolu ci-dessus — jamais recalculée
    // ailleurs, jamais deux cartes actives à la fois.
    const list = container.createDiv({ cls: "feuillets-research-list feuillets-docx-review-queue" });
    visible.forEach((entry, i) => {
      const cardWrap = list.createDiv({ cls: "feuillets-docx-review-card-wrap" });
      if (i === currentIdx) cardWrap.addClass("mod-current");
      if (entry.kind === "change") this.renderChange(cardWrap, entry.file, entry.item as ReviewChange);
      else this.renderComment(cardWrap, entry.file, entry.item as ReviewComment);
    });

    // scrollIntoView({block:"nearest"}) : défile JUSTE ASSEZ pour rendre la
    // carte visible, RIEN si elle l'est déjà — jamais un déplacement brutal
    // du panneau. Jamais .focus() : pas question de voler le clavier à un
    // éditeur ouvert à côté (mission §2, "IMPORTANT").
    const currentEl = list.children[currentIdx] as unknown as { scrollIntoView?: (opts?: unknown) => void } | undefined;
    if (currentEl && typeof currentEl.scrollIntoView === "function") {
      currentEl.scrollIntoView({ block: "nearest" });
    }
  }

  /** Ouvre `file` et sélectionne/révèle le passage correspondant à
   * `itemOrText` — réutilisé aussi bien pour l'aperçu AVANT application
   * (clic sur une carte) que pour révéler un passage APRÈS application
   * (Lot 4, voir revealMoveDestination) : même mécanisme Editor.setSelection/
   * scrollIntoView (API Obsidian/CodeMirror déjà en place), jamais un
   * second système de surlignage. Renvoie `true` si le passage a bien été
   * localisé et sélectionné, `false` sinon — à l'appelant d'informer
   * l'utilisateur plutôt que de prétendre silencieusement avoir réussi. */
  async openAndReveal(file: TFile, itemOrText: ReviewEntry | string | null | undefined, fallbackText?: string): Promise<boolean> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!leaf.view || !hasEditor(leaf.view)) return false;
    const editor = leaf.view.editor;

    const content = editor.getValue();

    /* Déplacement (origine — fromContext/fromText — OU destination via
       revealMoveDestination, qui réutilise cette branche avec fromContext=
       toContext/fromText=text) : locateChangeMatch dégrade UNIQUEMENT le
       CONTEXTE, jamais le passage lui-même — contrairement à findTolerant
       plus bas (repli vers de courts suffixes ASCII du TEXTE ENTIER, y
       compris son contexte, quand la correspondance exacte échoue).
       Régression confirmée sur un vrai retour : un déplacement de
       paragraphe entier ou multi-paragraphe (fromText contenant des "\n\n"
       internes) ne sélectionnait plus, dès que la correspondance exacte
       échouait, que les derniers caractères du DERNIER fragment — jamais
       le passage complet. */
    if (itemOrText && typeof itemOrText !== "string" && !itemOrText.anchorText && itemOrText.type === "move" && itemOrText.fromText) {
      const moveMatch = locateChangeMatch(content, itemOrText.fromContext || "", itemOrText.fromText);
      if (!moveMatch) return false;
      const selStart = moveMatch.index + (moveMatch.length - moveMatch.matchedText.length);
      const selEnd = moveMatch.index + moveMatch.length;
      const from = editor.offsetToPos(selStart);
      const to = editor.offsetToPos(selEnd);
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
      return true;
    }

    /* Commentaire (anchorText posé, jamais pour un ReviewChange — voir
       ReviewEntryBase) : findCommentAnchor cherche D'ABORD la plage RÉELLEMENT
       annotée (anchorText seul, le chemin le plus courant) et ne recourt au
       contexte avant/après QUE si elle apparaît plusieurs fois dans le
       feuillet — jamais une exigence de correspondance littérale avec tout
       le texte compilé (voir sa doc, docx-review-import.ts). Un simple
       string (clic depuis renderNearFilesHints, jamais un commentaire) reste
       sur le chemin générique plus bas. */
    if (itemOrText && typeof itemOrText !== "string" && itemOrText.anchorText) {
      const anchorMatch = findCommentAnchor(content, itemOrText);
      if (!anchorMatch) return false;
      const from = editor.offsetToPos(anchorMatch.index);
      const to = editor.offsetToPos(anchorMatch.index + anchorMatch.length);
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
      return true;
    }

    let searchText = "";
    let targetText: string | undefined = "";

    if (typeof itemOrText === "string") {
      searchText = itemOrText;
      targetText = itemOrText;
    } else if (itemOrText) {
      // itemOrText.anchorText déjà traité plus haut (findCommentAnchor) — jamais atteint ici.
      if (itemOrText.type === "replacement") {
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

    if (!match) return false;

    let selStart = match.index;
    const selEnd = match.index + match.length;

    // Si contextBefore précède la cible, restreindre la sélection aux seuls mots ciblés !
    if (targetText && searchText.length > targetText.length && searchText.endsWith(targetText)) {
      const offset = match.length - targetText.length;
      if (offset > 0) selStart = match.index + offset;
    }

    const from = editor.offsetToPos(selStart);
    const to = editor.offsetToPos(selEnd);

    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    return true;
  }

  /** Révèle EXACTEMENT la plage `range` (offsets dans le fichier tel qu'il
   * vient d'être écrit — voir ApplyResult.insertedRange, planApply/
   * planApplyMove/planApplyInterFile) dans `file` : aucune recherche
   * textuelle, le plan d'application a DÉJÀ calculé où le texte a atterri —
   * le refaire chercher risquerait justement de ne pas le retrouver quand le
   * Markdown réellement écrit diffère légèrement du texte porté par la carte
   * (voir Markdown des IDs de notes, jamais [^N] mais le vrai label +
   * définition). Couvre nativement le multi-paragraphe : `range` porte les
   * offsets du DÉBUT au bout du passage entier, quel que soit son nombre de
   * "\n\n" internes. Renvoie `false` seulement si `file` n'a pas pu être
   * ouvert dans un éditeur (jamais pour un texte "introuvable" : il n'y a
   * plus de recherche ici). */
  private async revealRangeInFile(file: TFile, range: { start: number; end: number }): Promise<boolean> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!leaf.view || !hasEditor(leaf.view)) return false;
    const editor = leaf.view.editor;
    const from = editor.offsetToPos(range.start);
    const to = editor.offsetToPos(range.end);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    return true;
  }

  /** Révèle un passage tel qu'il vient d'être COLLÉ (destination d'un
   * déplacement, Lot 4). Réutilise la branche "move" de openAndReveal
   * (locateChangeMatch, jamais findTolerant — voir sa doc) avec
   * fromContext=toContext/fromText=text : exactement la recherche qu'il
   * faut pour retrouver, EN ENTIER (même multi-paragraphe), un texte qui
   * vient d'être INSÉRÉ à `toContext` — plus seulement son dernier
   * fragment (régression corrigée, voir openAndReveal). Repli utilisé
   * UNIQUEMENT quand aucune plage exacte n'est disponible (voir
   * revealRangeInFile, désormais le chemin normal après application — voir
   * son appel dans le bouton Appliquer) : affiche une notice claire — sans
   * jamais prétendre avoir sélectionné quoi que ce soit — si le passage ne
   * peut pas être retrouvé de façon sûre après écriture. */
  private async revealMoveDestination(file: TFile, toContext: string, text: string): Promise<void> {
    const found = await this.openAndReveal(file, { type: "move", fromContext: toContext || "", fromText: text || "" } as ReviewEntry);
    if (!found) new Notice(t("docxReview.moveRevealFailedNotice"));
  }

  renderChange(container: HTMLElement, file: TFile | null, change: ReviewChange) {
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

    // LOT 5 — hiérarchie de la carte (mission §"Hiérarchie") : TYPE →
    // CONFIANCE → EMPLACEMENT → MODIFICATION → ACTIONS. Auteur/date, eux,
    // deviennent secondaires (ligne discrète sous l'emplacement).
    const metaEl = name.createDiv({ cls: "feuillets-docx-review-meta" });
    metaEl.setText(label);
    /* Statut prioritaire sur la confiance dès qu'un retour est traité —
     * "Appliqué"/"Refusé" (mission §9), jamais les deux badges à la fois.
     * `confidence` reste absent pour un item déjà appliqué (voir
     * analyzeBuffer) : le badge Sûr/À vérifier/Ambigu (LOT 4) ne s'affiche
     * donc que tant que rien n'a encore été décidé. */
    if (change.applied) {
      metaEl.createSpan({ cls: "feuillets-docx-review-section-badge mod-resolved" }).setText(t("docxReview.status.applied"));
    } else if (change.dismissed) {
      metaEl.createSpan({ cls: "feuillets-docx-review-section-badge" }).setText(t("docxReview.status.rejected"));
    } else if (change.confidence) {
      metaEl
        .createSpan({ cls: `feuillets-docx-review-section-badge mod-confidence-${change.confidence}` })
        .setText(confidenceLabel(change.confidence));
    }

    const fromFileObj = change.fromPath ? resolveVaultFile(this.app, change.fromPath) : null;
    const toFileObj = change.toPath ? resolveVaultFile(this.app, change.toPath) : null;

    // EMPLACEMENT (mission §3) — toujours visible, jamais besoin d'ouvrir
    // les détails pour savoir où la carte agit. Un déplacement affiche
    // "Origine → Destination" (même dans le même feuillet).
    const locationEl = name.createDiv({ cls: "feuillets-docx-review-location" });
    if (change.type === "move") {
      const fromTitle = fromFileObj instanceof TFile ? this.plugin.titleFor(fromFileObj) : t("docxReview.unmatchedTitle");
      const toTitle = toFileObj instanceof TFile ? this.plugin.titleFor(toFileObj) : t("docxReview.unmatchedTitle");
      locationEl.setText(`${fromTitle} → ${toTitle}`);
    } else {
      locationEl.setText(file ? this.plugin.titleFor(file) : t("docxReview.unmatchedTitle"));
    }

    // Auteur/date : secondaires (mission — "ne doivent plus dominer la
    // carte compacte"), jamais supprimés pour autant.
    if (change.author || change.date) {
      name.createDiv({ cls: "feuillets-docx-review-submeta" }).setText(
        `${change.author || ""}${change.date ? " · " + change.date : ""}`
      );
    }

    const preview = name.createDiv({ cls: "feuillets-docx-review-preview" });

    if (change.type === "replacement") {
      if (change.contextBefore) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.contextBefore + " ");
      preview.createSpan({ cls: "feuillets-docx-review-removed" }).setText(change.oldText || "");
      preview.createSpan().setText(" → ");
      preview.createSpan({ cls: "feuillets-docx-review-added" }).setText(change.newText || "");
    } else if (change.type === "move") {
      const fromLabel = fromFileObj instanceof TFile && fromFileObj !== file
        ? t("docxReview.change.cutFrom", { title: this.plugin.titleFor(fromFileObj) })
        : t("docxReview.change.cut");
      const toLabel = toFileObj instanceof TFile && toFileObj !== file
        ? t("docxReview.change.pasteInto", { title: this.plugin.titleFor(toFileObj) })
        : t("docxReview.change.paste");

      /* Carte compacte (Lot 6) — repliée par défaut : origine/destination
         restent identifiables d'un coup d'œil (fichier + court extrait,
         voir truncateForSummary) et le saut de paragraphe éventuel reste
         visible, mais jamais le texte COMPLET ici — il masquait le reste du
         panneau (retour utilisateur). Le texte intégral vit dans la zone
         dépliable "Passages complets" (voir plus bas, bouton `detailBtn`),
         fermée par défaut, jamais reconstruite depuis autre chose que
         change.fromText/change.text — mêmes valeurs, mêmes zones
         .mod-origin/.mod-destination, juste déplacées derrière un bouton. */
      const originLine = preview.createDiv({ cls: "feuillets-docx-review-move-zone mod-origin mod-compact" });
      originLine.createSpan({ cls: "feuillets-docx-review-move-label mod-cut" }).setText(fromLabel);
      originLine.createSpan({ cls: "feuillets-docx-review-context" }).setText(truncateForSummary(change.fromText || ""));

      const destLine = preview.createDiv({ cls: "feuillets-docx-review-move-zone mod-destination mod-compact" });
      destLine.createSpan({ cls: "feuillets-docx-review-move-label mod-paste" }).setText(toLabel);
      destLine.createSpan({ cls: "feuillets-docx-review-context" }).setText(truncateForSummary(change.text || ""));

      const boundary = boundaryLabel(change.destinationBoundary);
      if (boundary) preview.createDiv({ cls: "feuillets-docx-review-boundary" }).setText(boundary);
    } else {
      if (change.contextBefore) preview.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.contextBefore + " ");
      preview
        .createSpan({ cls: change.type === "insertion" ? "feuillets-docx-review-added" : "feuillets-docx-review-removed" })
        .setText(change.text || "");
    }

    const fallbackText = change.type === "move" ? change.toContext : change.contextBefore;

    /** Résout fromFile/toFile pour CE changement (retombe sur `file` quand
     * l'un des deux chemins est absent — même déplacement dans le même
     * feuillet) — factorisé, réutilisé par les boutons Origine/Destination,
     * Aperçu et Appliquer. */
    const resolveMoveFiles = (): { fromFile: TFile | TAbstractFile | null; toFile: TFile | TAbstractFile | null } => ({
      fromFile: change.fromPath ? resolveVaultFile(this.app, change.fromPath) || file : file,
      toFile: change.toPath ? resolveVaultFile(this.app, change.toPath) || file : file,
    });

    // Zone d'actions dédiée sous le contenu principal (Lot 5 responsive)
    const actions = row.createDiv({ cls: "feuillets-docx-review-card-actions" });

    if (file) {
      row.addClass("feuillets-clickable");
      row.title = t("docxReview.openAndShowTooltip");
      row.addEventListener("click", () => { void this.openAndReveal(file, change, fallbackText); });

      if (change.type === "move") {
        // Mêmes libellés que la ligne compacte (voir plus haut, `preview`) —
        // recalculés ici (portée séparée) plutôt que remontés en dehors du
        // bloc : même coût négligeable que fromFileObj/toFileObj, déjà
        // recalculés séparément avant ce chantier.
        const fromFileObjForLabel = change.fromPath ? resolveVaultFile(this.app, change.fromPath) : null;
        const toFileObjForLabel = change.toPath ? resolveVaultFile(this.app, change.toPath) : null;
        const fromLabel = fromFileObjForLabel instanceof TFile && fromFileObjForLabel !== file
          ? t("docxReview.change.cutFrom", { title: this.plugin.titleFor(fromFileObjForLabel) })
          : t("docxReview.change.cut");
        const toLabel = toFileObjForLabel instanceof TFile && toFileObjForLabel !== file
          ? t("docxReview.change.pasteInto", { title: this.plugin.titleFor(toFileObjForLabel) })
          : t("docxReview.change.paste");

        // Lot 6 — carte compacte : le texte complet origine/destination
        // (mêmes zones .mod-origin/.mod-destination qu'avant ce chantier,
        // juste déplacées ici) reste accessible d'un clic, fermé par
        // défaut — même mécanisme de repli lazy que previewBtn plus bas
        // (construit à l'ouverture, retiré à la fermeture, jamais les deux
        // en même temps).
        let detailBox: HTMLElement | null = null;
        const detailBtn = this.iconBtn(actions, "chevron-down", t("docxReview.showFullPassages"));
        detailBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (detailBox) {
            detailBox.remove();
            detailBox = null;
            setIcon(detailBtn, "chevron-down");
            return;
          }
          detailBox = preview.createDiv({ cls: "feuillets-docx-review-move-detail" });
          const originZone = detailBox.createDiv({ cls: "feuillets-docx-review-move-zone mod-origin" });
          originZone.createSpan({ cls: "feuillets-docx-review-move-label mod-cut" }).setText(fromLabel);
          if (change.fromContext) originZone.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.fromContext + " ");
          originZone.createSpan({ cls: "feuillets-docx-review-removed" }).setText(change.fromText || "");

          const destZone = detailBox.createDiv({ cls: "feuillets-docx-review-move-zone mod-destination" });
          destZone.createSpan({ cls: "feuillets-docx-review-move-label mod-paste" }).setText(toLabel);
          if (change.toContext) destZone.createSpan({ cls: "feuillets-docx-review-context" }).setText("…" + change.toContext + " ");
          destZone.createSpan({ cls: "feuillets-docx-review-added" }).setText(change.text || "");
          if (change.toContextAfter) destZone.createSpan({ cls: "feuillets-docx-review-context" }).setText(" " + change.toContextAfter + "…");
          setIcon(detailBtn, "chevron-up");
        });

        // Lot 2 — Voir l'origine / Voir la destination : deux actions
        // DISTINCTES (contrairement au clic sur la ligne, qui ne révèle que
        // l'origine, voir openAndReveal branche "move") — même pour un
        // déplacement dans le même feuillet, où les deux boutons ouvrent
        // le MÊME fichier mais sélectionnent des passages différents.
        const { fromFile: originFile, toFile: destFile } = resolveMoveFiles();
        if (originFile instanceof TFile) {
          const originBtn = this.iconBtn(actions, "arrow-up-right", t("docxReview.viewOrigin"));
          originBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.openAndReveal(originFile, change, fallbackText);
          });
        }
        if (destFile instanceof TFile) {
          const destBtn = this.iconBtn(actions, "arrow-down-right", t("docxReview.viewDestination"));
          destBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.revealMoveDestination(destFile, change.toContext || "", change.text || "");
          });
        }

        // Lot 3 — Aperçu du résultat : calcule (sans jamais écrire) ce que
        // planApply/planApplyMove produirait, à partir du contenu RÉEL
        // actuel du feuillet de destination — jamais une supposition.
        // FINITION UX (mission §7) — "search" pour Examiner, "eye" réservé
        // à Voir/Voir le passage : UNE icône = UN sens dans tout le panneau.
        const previewBtn = this.iconBtn(actions, "search", t("docxReview.previewResult"));
        if (!change.applied && (change.confidence === "review" || change.confidence === "ambiguous")) {
          previewBtn.addClass("feuillets-docx-review-action-btn");
          previewBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.action.examine"));
        }
        let previewBox: HTMLElement | null = null;
        previewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void (async () => {
            if (previewBox) {
              previewBox.remove();
              previewBox = null;
              return;
            }
            previewBox = row.createDiv({ cls: "feuillets-docx-review-preview-box" });
            // LOT 5 (mission §4) — même "Pourquoi ?" que pour un item simple
            // (voir examineBtn plus bas), ici pour un déplacement dont
            // l'action d'examen EST déjà ce bouton Aperçu (jamais un doublon,
            // voir LOT 4 correctif : eyeCountReview === eyeCountSafe).
            if (change.confidenceReasons && change.confidenceReasons.length > 0 && change.confidence !== "safe") {
              const whyBlock = previewBox.createDiv({ cls: "feuillets-docx-review-why-block" });
              whyBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(
                change.confidence === "ambiguous" ? t("docxReview.whyAmbiguousTitle") : t("docxReview.whyReviewTitle")
              );
              whyBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(
                change.confidenceReasons.map(confidenceReasonLabel).join(" · ")
              );
            }
            if (!(destFile instanceof TFile)) {
              previewBox.createDiv().setText(t("docxReview.previewUnavailable"));
              return;
            }
            const currentContent = await this.app.vault.read(destFile);
            const result = planApply(currentContent, change as unknown as Parameters<typeof planApply>[1]);
            if (!result.ok || result.newContent === undefined) {
              previewBox.setText(t("docxReview.previewUnavailable"));
              return;
            }
            const beforeBlock = previewBox.createDiv({ cls: "feuillets-docx-review-preview-block" });
            beforeBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(t("docxReview.previewBefore"));
            beforeBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(previewSnippet(currentContent, change.toContext || "", ""));
            const afterBlock = previewBox.createDiv({ cls: "feuillets-docx-review-preview-block" });
            afterBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(t("docxReview.previewAfter"));
            afterBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(previewSnippet(result.newContent, change.toContext || "", change.text || ""));
          })();
        });

        if (change.applied) {
          const viewMovedBtn = this.iconBtn(actions, "locate", t("docxReview.viewMovedPassage"));
          viewMovedBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (destFile instanceof TFile) void this.revealMoveDestination(destFile, change.toContext || "", change.text || "");
          });
        }
      }

      if (!change.applied && change.type !== "move") {
        // FINITION UX (mission §7) — "eye" = Voir dans tout le panneau,
        // jamais une icône de document générique pour ce même sens.
        const viewBtn = this.iconBtn(actions, "eye", t("docxReview.openAndShowTooltip"));
        viewBtn.addClass("feuillets-docx-review-action-btn");
        viewBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.action.view"));
        viewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.openAndReveal(file, change, fallbackText);
        });
      }

      /* LOT 4 (correctif) — un élément "À vérifier" doit présenter Examiner
       * comme ACTION PRINCIPALE, jamais une présentation identique à un
       * élément "Sûr". Un déplacement l'a déjà (originBtn/destBtn/previewBtn
       * ci-dessus, toujours rendus avant ce bloc) — seuls les types simples
       * (insertion/suppression/remplacement) n'avaient jusqu'ici AUCUNE
       * action d'examen distincte de l'application elle-même. Aperçu SANS
       * ÉCRITURE, même mécanisme que previewBtn (planApply en lecture
       * seule, jamais une seconde implémentation de la recherche).
       * LOT 5 — étendu à "ambiguous" (mission §2 : "Ambigu" -> [Examiner]
       * SEUL, jamais aucune autre action pour un item simple avant ce lot) :
       * même bouton, même mécanisme, seule la condition change. */
      if (!change.applied && (change.confidence === "review" || change.confidence === "ambiguous") && change.type !== "move") {
        const examineBtn = this.iconBtn(actions, "search", t("docxReview.examineChange"));
        examineBtn.addClass("feuillets-docx-review-action-btn");
        examineBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.action.examine"));
        let examineBox: HTMLElement | null = null;
        examineBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void (async () => {
            if (examineBox) {
              examineBox.remove();
              examineBox = null;
              return;
            }
            examineBox = row.createDiv({ cls: "feuillets-docx-review-preview-box" });
            // LOT 5 (mission §4) — "Pourquoi À vérifier ?"/"Pourquoi Ambigu ?" :
            // traduit les confidenceReasons DÉJÀ posées par le moteur (LOT 4),
            // jamais une nouvelle preuve calculée ici.
            if (change.confidenceReasons && change.confidenceReasons.length > 0) {
              const whyBlock = examineBox.createDiv({ cls: "feuillets-docx-review-why-block" });
              whyBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(
                change.confidence === "ambiguous" ? t("docxReview.whyAmbiguousTitle") : t("docxReview.whyReviewTitle")
              );
              whyBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(
                change.confidenceReasons.map(confidenceReasonLabel).join(" · ")
              );
            }
            if (!file) return;
            const currentContent = await this.app.vault.read(file);
            const result = planApply(currentContent, change as unknown as Parameters<typeof planApply>[1]);
            if (!result.ok || result.newContent === undefined) {
              examineBox.createDiv().setText(t("docxReview.previewUnavailable"));
              return;
            }
            const ctx = change.contextBefore || "";
            const insertedTxt = change.type === "insertion" ? change.text || "" : change.type === "replacement" ? change.newText || "" : "";
            const beforeBlock = examineBox.createDiv({ cls: "feuillets-docx-review-preview-block" });
            beforeBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(t("docxReview.previewBefore"));
            beforeBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(previewSnippet(currentContent, ctx, ""));
            const afterBlock = examineBox.createDiv({ cls: "feuillets-docx-review-preview-block" });
            afterBlock.createDiv({ cls: "feuillets-docx-review-preview-heading" }).setText(t("docxReview.previewAfter"));
            afterBlock.createDiv({ cls: "feuillets-docx-review-preview-text" }).setText(previewSnippet(result.newContent, ctx, insertedTxt));
          })();
        });
      }

      /* LOT 4 — un élément "Ambigu" ne propose JAMAIS d'application directe
       * (aucune écriture automatique) : les actions d'examen ci-dessus
       * (Voir l'origine/la destination, Aperçu, Examiner, ou le simple clic
       * sur la ligne pour un item simple) restent, elles, disponibles sans
       * condition — seul CE bouton disparaît. `change.confidence` absent
       * (analyse antérieure à ce lot, état restauré) n'est PAS traité comme
       * ambigu : seul un "ambiguous" explicite bloque. Le libellé diffère
       * pour "review" (« Accepter (à vérifier) », jamais « Appliquer » tel
       * quel) — un élément "safe" garde EXACTEMENT sa présentation
       * d'origine, voir confirmation du correctif. */
      if (!change.applied && change.confidence !== "ambiguous") {
        const applyBtn = this.iconBtn(
          actions,
          "check",
          change.confidence === "review" ? t("docxReview.acceptChangeReview") : t("docxReview.applyChange")
        );
        applyBtn.addClass("feuillets-docx-review-action-btn");
        applyBtn.addClass("mod-accept");
        applyBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.action.accept"));
        applyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void (async () => {
            let result: {
              ok: boolean;
              reason?: string;
              newContent?: string;
              step?: string;
              insertedRange?: { start: number; end: number };
            };
            const { fromFile, toFile } = resolveMoveFiles();

            if (change.type === "move" && fromFile instanceof TFile && toFile instanceof TFile && fromFile.path !== toFile.path) {
              /* LOT 3 (sécurité transactionnelle) : un déplacement touche
                 DEUX feuillets — le snapshot des DEUX doit avoir réussi
                 AVANT toute écriture, sans quoi rien n'est écrit ni marqué
                 appliqué (jamais le best-effort d'une application simple,
                 voir ensureSnapshot). Les deux appels restent séquentiels
                 (pas de Promise.all) : pas d'écriture tant que l'origine
                 n'est pas elle-même confirmée snapshotée. */
              const fromSnapshotOk = await this.ensureSnapshot(fromFile);
              const toSnapshotOk = await this.ensureSnapshot(toFile);
              if (!fromSnapshotOk || !toSnapshotOk) {
                result = { ok: false, reason: "snapshot-failed" };
              } else {
                result = await planApplyInterFile(this.app.vault, fromFile, toFile, change as unknown as Parameters<typeof planApplyInterFile>[3]);
              }
            } else {
              const targetFile = change.type === "move" && toFile instanceof TFile ? toFile : file;
              const content = await this.app.vault.read(targetFile);
              result = planApply(content, change as unknown as Parameters<typeof planApply>[1]);
              if (result.ok) {
                await this.ensureSnapshot(targetFile);
                await this.app.vault.modify(targetFile, result.newContent || "");
              }
            }

            if (!result.ok) {
              new Notice(
                result.reason === "rollback-failed"
                  ? t("docxReview.rollbackFailedNotice")
                  : result.reason === "snapshot-failed"
                  ? t("docxReview.snapshotFailedNotice")
                  : result.reason === "ambiguous"
                  ? t("docxReview.ambiguousPassage")
                  : t("docxReview.passageNotFound")
              );
              return;
            }
            change.applied = true;
            change.dismissed = true;
            await this.saveItemState(change);
            new Notice(t("docxReview.changeAppliedNotice"));
            if (change.type === "move" && toFile instanceof TFile) {
              if (result.insertedRange) {
                await this.revealRangeInFile(toFile, result.insertedRange);
              } else {
                await this.revealMoveDestination(toFile, change.toContext || "", change.text || "");
              }
            }
            void this.render();
          })();
        });
      }
    } else {
      this.renderNearFilesHints(actions, change, row);
    }

    const dismissBtn = this.iconBtn(
      actions,
      change.dismissed ? "rotate-ccw" : "x",
      change.dismissed ? t("docxReview.restoreInStack") : t("docxReview.hideMarkResolved")
    );
    dismissBtn.addClass("feuillets-docx-review-action-btn");
    if (!change.dismissed) dismissBtn.addClass("mod-reject");
    dismissBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(
      change.dismissed ? t("docxReview.action.restore") : t("docxReview.action.reject")
    );
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void (async () => {
        change.dismissed = !change.dismissed;
        await this.saveItemState(change);
        if (change.dismissed) {
          new Notice(t("docxReview.itemHiddenNotice"));
        } else {
          new Notice(t("docxReview.itemRestoredNotice"));
        }
        void this.render();
      })();
    });
  }

  /** Permet d'appliquer ou d'ouvrir un retour depuis ses feuillets candidats
   * (lorsqu'il est tombé dans les éléments non rattachés). */
  renderNearFilesHints(header: HTMLElement, item: ReviewEntry, row?: HTMLElement) {
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
        row.addClass("feuillets-clickable");
        row.title = t("docxReview.clickToOpen", { title: this.plugin.titleFor(fFirst) });
        row.addEventListener("click", () => { void this.openAndReveal(fFirst, item.anchorText || searchTextForChange(item as unknown as Parameters<typeof searchTextForChange>[0])); });
      }
    }

    if (!item.applied) {
      for (const path of candidates) {
        const f = resolveVaultFile(this.app, path);
        if (!(f instanceof TFile)) continue;
        const title = this.plugin.titleFor(f);

        /* LOT 4 — un ReviewChange tombé ici a, par construction, un chemin
         * non résolu (voir analyzeBuffer#evaluateItemConfidence : toujours
         * confidence "ambiguous", reason "unresolved-path") : jamais
         * d'application directe depuis un élément Ambigu — seulement
         * examiner chaque feuillet candidat (ouvrir + révéler, sans jamais
         * écrire). Un ReviewComment (item.type absent, purement
         * consultatif) garde son comportement historique inchangé — hors
         * périmètre de ce lot, voir la mission. */
        if (item.type) {
          const examineBtn = this.iconBtn(header, "search", t("docxReview.examineInto", { title }));
          examineBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.openAndReveal(f, item.anchorText || searchTextForChange(item as unknown as Parameters<typeof searchTextForChange>[0]));
          });
          continue;
        }

        const applyBtn = this.iconBtn(header, "check", t("docxReview.applyInto", { title }));
        applyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void (async () => {
            let result: { ok: boolean; reason?: string; newContent?: string; step?: string };
            if (item.type === "move") {
              const fromFile = item.fromPath ? resolveVaultFile(this.app, item.fromPath) || f : f;
              const toFile = item.toPath ? resolveVaultFile(this.app, item.toPath) || f : f;
              if (fromFile instanceof TFile && toFile instanceof TFile && fromFile.path !== toFile.path) {
                // LOT 3 (sécurité transactionnelle) : même exigence que le
                // bouton Appliquer principal, voir renderChange plus haut.
                const fromSnapshotOk = await this.ensureSnapshot(fromFile);
                const toSnapshotOk = await this.ensureSnapshot(toFile);
                if (!fromSnapshotOk || !toSnapshotOk) {
                  result = { ok: false, reason: "snapshot-failed" };
                } else {
                  result = await planApplyInterFile(this.app.vault, fromFile, toFile, item as unknown as Parameters<typeof planApplyInterFile>[3]);
                }
              } else {
                const content = await this.app.vault.read(f);
                result = planApply(content, item as unknown as Parameters<typeof planApply>[1]);
                if (result.ok) { await this.ensureSnapshot(f); await this.app.vault.modify(f, result.newContent || ""); }
              }
            } else {
              const content = await this.app.vault.read(f);
              result = planApply(content, item as unknown as Parameters<typeof planApply>[1]);
              if (result.ok) { await this.ensureSnapshot(f); await this.app.vault.modify(f, result.newContent || ""); }
            }

            if (!result.ok) {
              new Notice(
                result.reason === "rollback-failed"
                  ? t("docxReview.rollbackFailedNotice")
                  : result.reason === "snapshot-failed"
                  ? t("docxReview.snapshotFailedNotice")
                  : result.reason === "ambiguous"
                  ? t("docxReview.ambiguousPassageShort")
                  : t("docxReview.passageNotFoundInSheet")
              );
              return;
            }
            item.applied = true;
            item.dismissed = true;
            await this.saveItemState(item);
            new Notice(t("docxReview.changeAppliedInto", { title }));
            void this.render();
          })();
        });
      }
    }
  }

  renderComment(container: HTMLElement, file: TFile | null, comment: ReviewComment) {
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
    // LOT 5 — même hiérarchie que renderChange (TYPE → statut → EMPLACEMENT
    // → contenu) : un commentaire n'a jamais de confiance (consultatif,
    // voir ReviewEntryBase.confidence), seul son statut traité/résolu compte.
    const metaEl = name.createDiv({ cls: "feuillets-docx-review-meta" });
    metaEl.setText(label);
    if (comment.dismissed) {
      metaEl.createSpan({ cls: "feuillets-docx-review-section-badge" }).setText(t("docxReview.status.treated"));
    }
    if (comment.resolvedInWord) {
      metaEl.createSpan({ cls: "feuillets-docx-review-section-badge mod-resolved" }).setText(t("docxReview.comment.resolvedInWord"));
    }
    const locationEl = name.createDiv({ cls: "feuillets-docx-review-location" });
    locationEl.setText(file ? this.plugin.titleFor(file) : t("docxReview.unmatchedTitle"));
    if (comment.author || comment.date) {
      name.createDiv({ cls: "feuillets-docx-review-submeta" }).setText(
        `${comment.author || ""}${comment.date ? " · " + comment.date : ""}`
      );
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
      name.createDiv({ cls: "feuillets-docx-review-comment-text" }).setText(comment.text || "");
    }

    const actions = row.createDiv({ cls: "feuillets-docx-review-card-actions" });

    if (file) {
      row.addClass("feuillets-clickable");
      row.title = t("docxReview.openAndShowTooltip");
      row.addEventListener("click", () => { void this.openAndReveal(file, comment); });

      // FINITION UX (mission §7) — "eye" = Voir/Voir le passage, partout.
      const viewBtn = this.iconBtn(actions, "eye", t("docxReview.openAndShowTooltip"));
      viewBtn.addClass("feuillets-docx-review-action-btn");
      viewBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(t("docxReview.action.viewPassage"));
      viewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.openAndReveal(file, comment);
      });
    } else {
      this.renderNearFilesHints(actions, comment, row);
    }

    /* FINITION UX (mission §7, IMPORTANT) — "Marquer comme traité" NE PARTAGE
     * JAMAIS la même croix que "Refuser" (dismissBtn de renderChange, plus
     * haut) : `check-circle` ici, `x` là-bas — deux actions distinctes,
     * deux icônes distinctes, même si le mécanisme sous-jacent (dismissed)
     * est le même. "Rétablir" (rotate-ccw), lui, reste partagé : même sens
     * partout dans le panneau. */
    const dismissBtn = this.iconBtn(
      actions,
      comment.dismissed ? "rotate-ccw" : "check-circle",
      comment.dismissed ? t("docxReview.showInStack") : t("docxReview.hideMarkResolvedShort")
    );
    dismissBtn.addClass("feuillets-docx-review-action-btn");
    dismissBtn.createSpan({ cls: "feuillets-docx-review-btn-text" }).setText(
      comment.dismissed ? t("docxReview.action.restore") : t("docxReview.action.markResolved")
    );
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void (async () => {
        comment.dismissed = !comment.dismissed;
        await this.saveItemState(comment);
        if (comment.dismissed) {
          new Notice(t("docxReview.commentResolvedNotice"));
        } else {
          new Notice(t("docxReview.commentRestoredNotice"));
        }
        void this.render();
      })();
    });
  }
}
