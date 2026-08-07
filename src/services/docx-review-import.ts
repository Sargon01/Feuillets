/** Lecture d'un .docx annoté (suivi des modifications + commentaires Word)
 * renvoyé par un directeur/éditeur — fonctions pures uniquement (aucun accès
 * disque ici, voir views/docx-review-view.js pour l'ouverture réelle du
 * fichier et l'application des changements retenus dans les feuillets
 * sources). Ne passe jamais par Pandoc : `word/document.xml` et
 * `word/comments.xml` sont des XML OOXML stables et documentés depuis plus
 * de dix ans (w:ins/w:del pour le suivi des modifications, w:commentRangeStart/
 * w:commentRangeEnd/w:commentReference + word/comments.xml pour les commentaires) — un
 * parseur ciblé sur ces tags précis est un chantier borné, du même ordre
 * que le parseur RTF de l'import Scrivener (voir scrivener-import.js).
 *
 * Chaque feuillet est retrouvé par un signet Word posé à l'export (voir
 * utils/docx-bookmarks.js + services/export-docx.js) — AUCUNE recherche
 * floue de texte n'est nécessaire pour savoir de quel feuillet vient un
 * commentaire ou une modification : c'est le signet qui le dit. Un
 * commentaire/une modification trouvé hors de tout signet reconnu (ex. le
 * relecteur a supprimé le signet en retapant tout un passage à cheval sur
 * deux feuillets) tombe dans `unclassified` plutôt que d'être perdu
 * silencieusement — même principe que le panier de repli de l'import
 * Scrivener. */

import { extractAllTags, getAttr, decodeXmlEntities, walkTags } from "../utils/xml.js";
import { bookmarkIdFor } from "../utils/docx-bookmarks.js";
import { escapeRegExp } from "../utils/core.js";
import { parseFootnotes, findDefinition, findReferences, nextFootnoteNumber } from "../utils/footnotes.js";

const CONTEXT_CHARS = 40;

type ChangeType = "insertion" | "deletion" | "replacement" | "move";

type ChangeMetadata = {
  author: string;
  date: string;
  moved?: boolean;
  moveName?: string | null;
  nearFiles?: string[];
  prevScene?: string | null;
  nextScene?: string | null;
  inFootnote?: boolean;
  ord?: number | string;
  /** Identifiants w:id (numérotation INTERNE Word, voir w:footnoteReference)
   * des appels de note rencontrés dans le texte de CE changement, DANS LEUR
   * ORDRE d'apparition — jamais le vrai label Markdown source (renuméroté à
   * l'export, voir compile-export.ts#renumberFootnotesAcrossTexts) : sert à
   * comparer la présence/l'ordre des appels entre un couper (w:del) et un
   * coller (w:ins) candidats (voir mergeImplicitCutPastePairs), et à guider
   * le transfert de note lors d'un déplacement inter-fichiers (voir
   * planApplyInterFile/resolveFootnoteTransfer). Absent (jamais un tableau
   * vide) quand le changement ne contient aucun appel de note. */
  footnoteRefs?: string[];
  /** w:id (footnotes.xml) DE LA NOTE dont CE changement est le corps —
   * posé UNIQUEMENT par parseFootnotesXml, sur un changement dont l'entier
   * texte vit DANS le corps d'une note (pas un simple appel [^N] au milieu
   * d'un passage : voir footnoteRefs pour ça). Sert exclusivement à
   * l'absorption des révisions de corps de note portées par un déplacement
   * de passage (voir absorbMoveOwnedFootnoteRevisions) — jamais à
   * l'affichage ni à l'application. */
  footnoteId?: string;
};

/** Classement du point d'insertion d'une destination (voir
 * computeDestinationBoundary) — sert à l'affichage (docx-review-view.ts,
 * carte de déplacement) et à vérifier qu'aucun triple saut de ligne n'est
 * produit avant écriture (planApplyMove/planApplyInterFile) :
 * - "inline" : au milieu d'un paragraphe existant, ni avant ni après lui
 *   un saut de paragraphe n'intervient — le texte reste sur la même ligne
 *   logique.
 * - "paragraph-start" : juste après un saut de paragraphe, mais SUIVI par
 *   du texte de la MÊME phrase Word (pas de nouveau saut immédiatement
 *   après) — le passage devient le DÉBUT du paragraphe qui suit.
 * - "paragraph-end" : aucun saut avant (milieu de paragraphe), mais un
 *   saut de paragraphe suit immédiatement — le passage devient la FIN du
 *   paragraphe qui précède.
 * - "between-paragraphs" : un saut de paragraphe RÉEL de chaque côté (un
 *   paragraphe existant avant, un autre après) — le passage forme son
 *   propre paragraphe, intercalé entre deux paragraphes déjà là.
 * - "standalone-paragraph" : comme "between-paragraphs", mais en bordure
 *   du corps du feuillet (tout début ou toute fin) — rien d'existant d'un
 *   côté. */
export type DestinationBoundary =
  | "inline"
  | "paragraph-start"
  | "paragraph-end"
  | "between-paragraphs"
  | "standalone-paragraph";

type InsertionChange = ChangeMetadata & {
  type: "insertion";
  text: string;
  contextBefore: string;
  /** Un saut de paragraphe Word suit-il IMMÉDIATEMENT ce point d'insertion
   * (avant tout autre texte) ? Capturé au moment de la fermeture du
   * w:ins/w:moveTo (voir pendingAfterCapture dans parseDocumentXml) — `""`
   * en toContextAfter quand oui (rien à montrer, juste "un paragraphe
   * commence ici"), un court extrait du texte qui suit sinon. Absent pour
   * une InsertionChange qui n'est PAS le côté destination d'un déplacement
   * (une insertion ordinaire n'en a pas besoin, mais le champ reste
   * disponible : rien ne l'empêche). */
  followedByParagraphBreak?: boolean;
  toContextAfter?: string;
};

type DeletionChange = ChangeMetadata & {
  type: "deletion";
  text: string;
  contextBefore: string;
};

type ReplacementChange = ChangeMetadata & {
  type: "replacement";
  oldText: string;
  newText: string;
  contextBefore: string;
};

type MoveChange = ChangeMetadata & {
  type: "move";
  text: string;
  fromContext: string;
  fromText: string;
  toContext: string;
  fromPath?: string | null;
  toPath?: string | null;
  /** Court extrait de ce qui suit IMMÉDIATEMENT le point d'insertion dans
   * le fichier de destination (voir InsertionChange.toContextAfter) — sert
   * UNIQUEMENT à l'affichage (Lot 2/3) et au calcul de destinationBoundary,
   * jamais à la recherche/l'application elle-même (toContext+text suffisent
   * toujours, exactement comme avant ce chantier). */
  toContextAfter?: string;
  /** Calculé UNE FOIS à la fusion (mergeMovePairs/mergeGlobalMovePairs/
   * mergeImplicitCutPastePairs), voir computeDestinationBoundary — jamais
   * recalculé ni contredit ailleurs. */
  destinationBoundary?: DestinationBoundary;
  /** Identifiants w:id (footnotes.xml) des notes dont l'APPEL vit dans le
   * texte SUPPRIMÉ (origine)/INSÉRÉ (destination) de CE déplacement, DANS
   * LEUR ORDRE d'apparition — PAS le footnoteRefs hérité de InsertionChange/
   * DeletionChange (celui-là ne garde qu'UN SEUL côté, voir sa doc) : les
   * DEUX côtés sont nécessaires ici pour reconnaître, dans
   * word/footnotes.xml, LE COUPLE (id origine, id destination) de la MÊME
   * note logique — voir absorbMoveOwnedFootnoteRevisions. Jamais utilisé
   * pour l'affichage ni l'application (toContext/fromContext+text/fromText
   * suffisent toujours, exactement comme avant). */
  originFootnoteIds?: string[];
  destFootnoteIds?: string[];
};

type ReviewChange = InsertionChange | DeletionChange | ReplacementChange | MoveChange;

type ReviewComment = {
  anchorText: string;
  text: string;
  author: string;
  date: string;
  resolvedInWord?: boolean;
  parentId?: string;
  isFormatting?: boolean;
  markers?: string[];
  nearFiles?: string[];
  prevScene?: string | null;
  nextScene?: string | null;
  inFootnote?: boolean;
  ord?: number | string;
  /** Texte réel qui précède/suit la plage ANNOTÉE dans le docx (w:commentRangeStart/
   * End) — jamais posé pour un commentaire sans sélection (w:commentReference
   * isolé, voir parseDocumentXml). Sert UNIQUEMENT à désambiguïser quand
   * `anchorText` seul apparaît plusieurs fois dans le feuillet (voir
   * findCommentAnchor) : jamais exigé pour un anchorText déjà unique — un
   * mot courant commenté une seule fois dans le fichier continue de se
   * trouver aussi vite qu'avant ce correctif. */
  contextBefore?: string;
  contextAfter?: string;
};

type ReviewBucket = {
  changes: ReviewChange[];
  comments: ReviewComment[];
};

type ReviewBuckets = Record<string, ReviewBucket>;

type ExtendedCommentInfo = {
  done: boolean;
  paraIdParent: string | null;
};

type ExtendedCommentsByParaId = Record<string, ExtendedCommentInfo>;

type ParsedComment = {
  author: string;
  date: string;
  text: string;
  done?: boolean;
  parentId?: string;
};

type CommentsById = Record<string, ParsedComment>;

type TrackedChangeInfo = {
  author: string;
  date: string;
  buffer: string;
  contextBefore: string;
  moved: boolean;
  moveName: string | null;
  fmtBold?: boolean | "mixed";
  fmtItalic?: boolean | "mixed";
};

type FormatChangeInfo = {
  author: string;
  date: string;
  markers: string[];
};

type DocxFiles = Record<string, string | undefined>;

type ApplyChange = {
  type: ChangeType;
  text: string;
  oldText: string;
  newText: string;
  contextBefore: string;
  fromContext: string;
  fromText: string;
  toContext: string;
  footnoteRefs?: string[];
  /** Copié tel quel depuis MoveChange.destinationBoundary (le champ vit déjà
   * sur l'objet passé par docx-review-view.js — voir la note dans MoveChange
   * : "toujours à l'affichage", jusqu'à cette mission). Seul planApplyMove/
   * planApply(type:"insertion") le lit désormais, pour savoir si un "\n\n"
   * doit être ajouté APRÈS le texte inséré : "between-paragraphs"/
   * "standalone-paragraph" veulent dire qu'un paragraphe EXISTANT suit
   * IMMÉDIATEMENT le point d'insertion dans le docx — sans ce \n\n, le texte
   * collé se retrouve accolé à ce paragraphe suivant (voir "Constat réel",
   * bug confirmé sur un vrai retour). */
  destinationBoundary?: DestinationBoundary;
};

type ApplyResult =
  /** `insertedRange` (offsets dans `newContent`, jamais dans `content` avant
   * écriture) : la plage EXACTE du texte qui vient d'être écrit — posée par
   * planApplyMove/planApply(type:"insertion") pour permettre à la vue de
   * sélectionner le passage tel quel après application, SANS refaire une
   * recherche textuelle approximative (voir docx-review-view.js#revealRangeInFile).
   * Absente (undefined) seulement pour replacement/deletion, qui ne
   * réintroduisent rien à révéler. */
  | { ok: true; newContent: string; insertedRange?: { start: number; end: number } }
  | { ok: false; reason: "no-context" | "not-found" | "ambiguous" };

type ReviewVaultFile = { path: string };

type ReviewVault = {
  read(file: ReviewVaultFile): Promise<string>;
  modify(file: ReviewVaultFile, content: string): Promise<void>;
};

type ContentReader = (path: string) => Promise<string | null>;

type RegexMatch = { index: number; 0: string; 1?: string };

function isInsertionChange(change: ReviewChange): change is InsertionChange {
  return change.type === "insertion";
}

function isDeletionChange(change: ReviewChange): change is DeletionChange {
  return change.type === "deletion";
}

function emptyBucket(): ReviewBucket {
  return { changes: [], comments: [] };
}

/** Égalité d'ensemble (ordre indifférent) de deux listes de marqueurs de
 * mise en forme — voir la fusion des cartes "Mise en forme" adjacentes
 * (Lot 5, parseDocumentXml). */
function sameMarkerSet(a: string[] | undefined, b: string[]): boolean {
  const aa = a || [];
  if (aa.length !== b.length) return false;
  const setA = new Set(aa);
  return b.every((m) => setA.has(m));
}

/** `word/commentsExtended.xml` (Word moderne) -> { [w15:paraId]: { done,
 * paraIdParent } }. Porte l'état "résolu" (w15:done="1", posé quand
 * l'éditeur coche « Marquer comme résolu » dans Word) et le lien de réponse
 * (w15:paraIdParent -> le paraId du commentaire parent). Le lien vers un
 * commentaire concret se fait via le w14:paraId partagé avec comments.xml
 * (voir parseCommentsXml). Fichier absent des .docx anciens : dégradation
 * silencieuse (aucun état résolu, aucun fil), jamais une erreur. */
export function parseCommentsExtended(commentsExtendedXml: string): ExtendedCommentsByParaId {
  const byParaId: ExtendedCommentsByParaId = {};
  if (!commentsExtendedXml) return byParaId;
  for (const { attrs } of extractAllTags(commentsExtendedXml, "w15:commentEx")) {
    const paraId = getAttr(attrs, "w15:paraId");
    if (!paraId) continue;
    const done = getAttr(attrs, "w15:done");
    byParaId[paraId] = {
      done: done === "1" || done === "true",
      paraIdParent: getAttr(attrs, "w15:paraIdParent") || null,
    };
  }
  return byParaId;
}

/** `word/comments.xml` -> { [w:id]: { author, date, text, done?, parentId? } }.
 * `extendedByParaId` (voir parseCommentsExtended) enrichit chaque commentaire
 * de son état résolu (done) et de l'id de son commentaire parent (parentId,
 * pour un fil de réponses) — via le w14:paraId que chaque paragraphe de
 * commentaire partage avec commentsExtended.xml. `done`/`parentId` ne sont
 * posés que s'ils s'appliquent : un commentaire ordinaire garde la forme
 * exacte { author, date, text }. */
export function parseCommentsXml(
  commentsXml: string,
  extendedByParaId: ExtendedCommentsByParaId = {}
): CommentsById {
  const byId: CommentsById = {};
  if (!commentsXml) return byId;
  const paraIdToId: Record<string, string> = {}; // w14:paraId -> w:id du commentaire (pour résoudre paraIdParent -> id parent)
  const collected: Array<{ id: string; paraIds: string[] }> = []; // { id, paraIds } pour la 2e passe (parent/résolu)
  for (const { attrs, body } of extractAllTags(commentsXml, "w:comment")) {
    const id = getAttr(attrs, "w:id");
    if (!id) continue;
    const paras = extractAllTags(body, "w:p");
    const paraIds = paras.map((p) => getAttr(p.attrs, "w14:paraId")).filter(Boolean);
    const paragraphs = paras.map((p) =>
      extractAllTags(p.body, "w:t")
        .map((t) => decodeXmlEntities(t.body))
        .join("")
    );
    byId[id] = {
      author: getAttr(attrs, "w:author") || "Inconnu",
      date: getAttr(attrs, "w:date") || "",
      text: paragraphs.filter(Boolean).join("\n").trim(),
    };
    for (const pid of paraIds) paraIdToId[pid] = id;
    collected.push({ id, paraIds });
  }
  // 2e passe : maintenant que paraIdToId est complet, résoudre done + parent.
  for (const { id, paraIds } of collected) {
    for (const pid of paraIds) {
      const ext = extendedByParaId[pid];
      if (!ext) continue;
      if (ext.done) byId[id].done = true;
      if (ext.paraIdParent && paraIdToId[ext.paraIdParent] && paraIdToId[ext.paraIdParent] !== id) {
        byId[id].parentId = paraIdToId[ext.paraIdParent];
      }
    }
  }
  return byId;
}

/** Derniers caractères avant le changement — jamais tout le paragraphe
 * entier, juste de quoi resituer le changement dans le texte ET servir de
 * repère de recherche exacte pour l'appliquer dans le feuillet source (voir
 * views/docx-review-view.js) : SANS ellipse ni autre décoration ici, ce texte
 * doit rester un extrait littéral trouvable tel quel — l'ellipse cosmétique
 * ("…contexte") est un choix d'affichage, ajouté seulement à la lecture,
 * jamais mêlé à la valeur qui sert de repère de recherche. */
function trimContextBefore(text: string): string {
  return text.length > CONTEXT_CHARS ? text.slice(-CONTEXT_CHARS) : text;
}

/** Identifiants w:id (Word) des appels de note `[^N]` présents dans `text`,
 * DANS LEUR ORDRE d'apparition — réutilise parseFootnotes() (utils/
 * footnotes.ts, déjà éprouvé pour le Markdown source) plutôt qu'une regex
 * ad hoc : `text` est un simple extrait de passage, jamais un fichier avec
 * ses propres définitions `[^N]: …`, donc seules les RÉFÉRENCES comptent
 * ici. */
function footnoteIdsOf(text: string): string[] {
  if (!text) return [];
  return parseFootnotes(text).references.map((r) => r.id);
}

/** Enveloppe `text` dans les marqueurs Markdown gras/italique, en gardant
 * les espaces de tête/fin HORS des marqueurs (Markdown refuse une emphase
 * qui commence/finit par une espace : "** mot**" n'est pas du gras). Rend
 * le texte inchangé si aucun format ou si le cœur est vide. */
function wrapEmphasis(text: string, bold: boolean, italic: boolean): string {
  if (!text || (!bold && !italic)) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m) return text;
  const lead = m[1], core = m[2], trail = m[3];
  if (!core) return text;
  const open = (bold ? "**" : "") + (italic ? "*" : "");
  const close = (italic ? "*" : "") + (bold ? "**" : "");
  return lead + open + core + close + trail;
}

/** `word/styles.xml` -> l'ensemble des styleId de paragraphe dont le NOM
 * CANONIQUE (`w:name`, TOUJOURS écrit en anglais pour un style intégré
 * Word — "heading 1"…"heading 9" — quelle que soit la langue de
 * l'interface Word qui a enregistré le fichier) commence par "heading ".
 * `w:styleId`, LUI, est réécrit par Word selon sa langue d'interface dès
 * que le relecteur réenregistre le document (confirmé sur un cas réel :
 * "Heading2" à l'export Feuillets devient "Titre2" une fois le fichier
 * repassé par un Word installé en français) — seul `w:name` reste un repère
 * fiable, d'où ce passage par styles.xml plutôt qu'une liste d'identifiants
 * en dur. Sert à reconnaître, dans parseDocumentXml, les paragraphes de
 * titre/sous-titre de feuillet injectés par compile-export.ts au moment de
 * la fusion — jamais du texte du markdown source réel, voir
 * parseDocumentXml#headingStyleIds. Fichier absent (docx ancien/généré
 * autrement) : ensemble vide, dégradation silencieuse comme les autres
 * fichiers optionnels de ce parseur. */
export function parseHeadingStyleIds(stylesXml: string): Set<string> {
  const ids = new Set<string>();
  if (!stylesXml) return ids;
  for (const { attrs, body } of extractAllTags(stylesXml, "w:style")) {
    if (getAttr(attrs, "w:type") !== "paragraph") continue;
    const styleId = getAttr(attrs, "w:styleId");
    if (!styleId) continue;
    const nameMatch = /<w:name\s+w:val="([^"]*)"/.exec(body);
    const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : "";
    if (/^heading\s/i.test(name)) ids.add(styleId);
  }
  return ids;
}

/** `word/document.xml` (+ `word/comments.xml` déjà indexé par
 * parseCommentsXml) -> { scenes: { [bookmarkId]: {changes, comments} },
 * unclassified: {...} }. Marche séquentiellement dans le XML (voir
 * utils/xml.js#walkTags), en suivant : le signet de feuillet actuellement
 * ouvert, l'insertion/suppression suivie en cours (w:ins/w:del — chacune
 * avec son PROPRE accumulateur de texte, borné à sa portée exacte, pas au
 * paragraphe entier : sans ça, tout texte inchangé précédant une insertion
 * dans le même paragraphe se retrouverait à tort inclus dans le texte
 * "inséré"), et les commentaires actuellement ouverts (w:commentRangeStart
 * avant w:commentRangeEnd).
 *
 * `headingStyleIds` (voir parseHeadingStyleIds) : styleId de paragraphe des
 * titres/sous-titres de FEUILLET injectés par compile-export.ts à la
 * fusion — jamais du markdown source réel, donc jamais dans le fichier où
 * un changement sera réappliqué. Sans eux dans `runningText`, un
 * changement posé juste après l'ouverture d'un signet (donc juste après
 * ces titres, cas réel confirmé : premier paragraphe d'un chapitre) captait
 * leur texte comme `contextBefore`/`toContext` — une recherche vouée à
 * échouer ou, pire, à retomber sur une correspondance dégradée ailleurs
 * dans le fichier (voir getContextCandidates), plaçant le collage au
 * mauvais endroit sans jamais échouer franchement. */
export function parseDocumentXml(
  documentXml: string,
  commentsById: CommentsById = {},
  headingStyleIds: Set<string> = new Set()
): { scenes: ReviewBuckets; unclassified: ReviewBucket; footnoteOwners: Record<string, string | null> } {
  const scenes: ReviewBuckets = {};
  const unclassified = emptyBucket();
  const bucketFor = (bookmarkId: string | null): ReviewBucket => {
    if (!bookmarkId) return unclassified;
    if (!scenes[bookmarkId]) scenes[bookmarkId] = emptyBucket();
    return scenes[bookmarkId];
  };

  const xml = documentXml || "";
  const tags = walkTags(xml);

  let currentBookmarkId: string | null = null; // signet de feuillet en cours (nom, pas w:id)
  const bookmarkNameById = new Map<string, string>(); // w:id numérique -> nom (pour retrouver quel signet ferme un w:bookmarkEnd)
  let lastClosedBookmarkId: string | null = null; // dernier signet refermé — scène candidate "avant" pour un orphelin posé à la frontière
  let pendingOrphans: Array<ReviewChange | ReviewComment> = []; // éléments poussés dans unclassified en attendant de connaître leur scène candidate "après"
  let currentMoveName: string | null = null; // nom de déplacement en cours (partagé origine/destination)
  const moveRangeNameById = new Map<string, string>(); // w:id numérique -> nom (pour retrouver quel déplacement ferme un w:move{From,To}RangeEnd)
  let insInfo: TrackedChangeInfo | null = null; // { author, date, buffer, contextBefore } pendant un w:ins
  let delInfo: TrackedChangeInfo | null = null; // idem pour w:del
  const openComments = new Map<string, string>(); // w:id -> texte d'ancrage accumulé
  /* Un commentaire posé SANS sélectionner de texte (clic à un point, taper
     directement) n'a jamais de w:commentRangeStart/End — Word n'émet alors
     qu'un <w:commentReference> seul, jamais vu par openComments : silencieusement
     perdu jusqu'ici (aucune branche ne le traitait). Marque les w:id déjà
     résolus (par commentRangeEnd, la voie normale) pour que la voie de repli
     (w:commentReference isolé, voir plus bas) ne re-pousse jamais deux fois
     le MÊME commentaire — jamais un doublon pour un commentaire ancré
     normalement. */
  const resolvedCommentIds = new Set<string>();
  /* w:footnoteReference w:id="N" (appel de note dans le corps) -> le signet
     de feuillet où il apparaît. C'est le SEUL lien entre une note et son
     feuillet : word/footnotes.xml, lui, ne porte aucun signet — sans cette
     table, une correction faite par le relecteur À L'INTÉRIEUR d'une note
     (donc dans footnotes.xml) ne saurait pas dans quel feuillet l'appliquer.
     Voir parseFootnotesXml + parseDocxReview. */
  const footnoteOwners: Record<string, string | null> = {};

  /* Appelé juste après avoir poussé un élément dans `unclassified` (jamais
     dans une scène reconnue) : y attache les deux scènes candidates de
     part et d'autre de la frontière où il est tombé — `nextScene` reste
     null ici, rempli plus tard par bookmarkStart dès que la prochaine
     scène s'ouvre (voir plus haut). */
  const trackOrphan = (obj: ReviewChange | ReviewComment) => {
    if (currentBookmarkId != null) return;
    obj.prevScene = lastClosedBookmarkId;
    obj.nextScene = null;
    pendingOrphans.push(obj);
  };

  /* Reconstruit le texte SOURCE ACTUEL, celui qui existe réellement dans le
     feuillet TANT QUE rien n'a encore été appliqué — pas "si toutes les
     modifications précédentes étaient acceptées". Un texte supprimé
     (w:del/w:moveFrom) est donc INCLUS (il est encore là, pas encore
     retiré) ; un texte inséré (w:ins/w:moveTo) est EXCLU (il n'existe pas
     encore dans la source). Confirmé en défaut sur un vrai retour : une
     suppression du mot "steppes" juste après l'insertion (non encore
     appliquée) du mot "montagnes" calculait un contexte "…sur les
     montagnes" — alors que la source dit encore "…sur les steppes",
     "montagnes" n'y étant pas encore. planApply cherchait alors une suite
     de caractères qui n'a jamais existé dans le fichier réel. */
  let runningText = "";

  /* Un <w:p> par paragraphe markdown source (voir export-docx.js) — sans
     insérer l'équivalent d'un saut de paragraphe ("\n\n") en traversant
     cette frontière, deux paragraphes qui se suivent dans le docx se
     retrouvaient accolés SANS séparateur dans le texte reconstruit, alors
     que la source, elle, a bien une ligne vide entre eux — planApply
     cherchait alors un contexte+texte collés qui n'existaient nulle part
     tels quels dans le fichier réel (confirmé sur un vrai retour : "Soif
     de l'eau..." déplacé vers son propre paragraphe échouait à s'appliquer
     pour exactement cette raison). Différé (pendingParaBreak) plutôt
     qu'inséré immédiatement à l'ouverture du <w:p> : les paragraphes
     dédiés aux repères de feuillet (voir export-docx.js, un <w:p> ne
     contenant qu'un BookmarkStart/BookmarkEnd, sans aucun texte) n'ont pas
     d'équivalent dans la source — s'ils comptaient chacun pour un saut de
     paragraphe, une frontière de scène produirait plusieurs "\n\n"
     fantômes. En ne matérialisant le saut qu'au prochain VRAI texte
     rencontré, plusieurs <w:p> vides consécutifs ne produisent jamais
     qu'un seul "\n\n", exactement comme s'ils n'existaient pas. */
  let pendingParaBreak = false;
  let sawParagraph = false;

  /* Vrai entre l'ouverture d'un <w:p> et sa fermeture SI son <w:pPr><w:pStyle>
     désigne un style listé dans `headingStyleIds` — un titre/sous-titre de
     feuillet injecté par compile-export.ts, jamais un paragraphe du
     markdown source (voir la doc de parseDocumentXml). Réinitialisé à
     chaque <w:p> : un seul <w:pStyle> par paragraphe, jamais hérité du
     précédent. */
  let currentParaIsHeading = false;

  /* InsertionChange/MoveChange fraîchement fermés (w:ins/w:moveTo), en
     attente de savoir ce qui les SUIT immédiatement dans le document —
     résolu au tout premier événement textuel rencontré ensuite (voir
     appendText ci-dessous) : un `<w:p>` avant tout texte -> un paragraphe
     suit ; du texte réel sans `<w:p>` avant -> pas de saut, ça continue en
     ligne. Sert UNIQUEMENT à computeDestinationBoundary/l'affichage — la
     recherche/l'application (toContext+text) n'en dépend jamais. Résolu de
     force en fin de document si rien ne suit plus du tout (voir après la
     boucle principale). */
  const pendingAfterCapture: InsertionChange[] = [];

  /* w:id (commentaire OUVERT, entre w:commentRangeStart et w:commentRangeEnd)
     -> `contextBefore` capturé à l'ouverture (currentContextBefore(), même
     mécanisme que w:ins/w:moveTo) — voir ReviewComment.contextBefore. */
  const openCommentsContextBefore = new Map<string, string>();
  /** ReviewComment fraîchement poussés (w:commentRangeEnd), en attente de
   * `contextAfter` — résolu au tout premier texte réel rencontré ensuite
   * (même mécanisme que pendingAfterCapture, portée réduite aux
   * commentaires : jamais besoin de savoir si un saut de paragraphe suit,
   * juste un peu de texte pour désambiguïser, voir findCommentAnchor). */
  const pendingCommentContextAfter: ReviewComment[] = [];

  /* Une mise en forme ajoutée en suivi des modifications (barrer/souligner/
     surligner/mettre en gras un mot pour attirer l'attention, SANS le
     supprimer ni le remplacer) passe par w:rPrChange — un mécanisme
     ENTIÈREMENT différent de w:ins/w:del, jamais reconnu jusqu'ici :
     confirmé sur un vrai retour où un mot barré ainsi n'apparaissait dans
     aucun résultat. Capturé comme un commentaire informatif (pas de sens
     à "Appliquer" une mise en forme dans du markdown source) plutôt que
     silencieusement ignoré. */
  const FORMAT_MARKER_TAGS = new Set<string>(["w:b", "w:i", "w:u", "w:strike", "w:highlight"]);
  const FORMAT_LABELS: Record<string, string> = { "w:b": "gras", "w:i": "italique", "w:u": "souligné", "w:strike": "barré", "w:highlight": "surligné" };
  let formatMarkers: string[] | null = null; // accumulé pendant qu'on est DANS un <w:rPr>, hors de tout <w:rPrChange> imbriqué
  let insideRPrChange = false;
  /* Vrai entre <w:pPr> et sa fermeture — un <w:rPrChange> rencontré ICI
     porte la mise en forme du MARQUEUR DE PARAGRAPHE, pas d'un run de texte
     (voir le garde-fou sur w:rPrChange, plus bas). */
  let insidePPr = false;
  let pendingFormatChange: FormatChangeInfo | null = null; // { author, date, markers } capturé à la fermeture de w:rPrChange, consommé par le prochain w:t
  /* Format gras/italique du run EN COURS — sert à conserver la mise en forme
     d'un texte INSÉRÉ par le relecteur (w:ins) : sans ça, un mot ajouté en
     gras/italique dans Word arrivait en texte brut (audit #1). Réinitialisé
     à chaque <w:r> (un run sans <w:rPr> est du texte sans format). */
  let runBold = false;
  let runItalic = false;

  /* Compteur d'événements textuels (Lot 5, "mise en forme") — incrémenté à
     CHAQUE appel à appendText, quel que soit son contenu. Sert uniquement à
     savoir si RIEN d'autre (texte normal, appel de note, tabulation...) ne
     s'est glissé entre deux runs w:rPrChange consécutifs partageant auteur/
     date/marqueurs : Word découpe souvent UNE SEULE opération visuelle
     (« barrer tout ce paragraphe ») en plusieurs <w:r>/<w:rPrChange> (limites
     de police, langue, orthographe...), produisant sinon plusieurs cartes
     pour une seule action de l'éditeur — retour utilisateur confirmé. Une
     simple comparaison de `contextBefore` aurait pu suffire, mais celui-ci
     est tronqué à 40 caractères (trimContextBefore) : un compteur exact,
     jamais tronqué, est le seul repère fiable d'adjacence VRAIE. */
  let textEventSeq = 0;
  let lastFormatComment: ReviewComment | null = null;
  let lastFormatCommentBucket: ReviewBucket | null = null;
  let lastFormatCommentEndSeq = -1;

  /** `contextBefore` à capturer SI un changement (w:ins/w:del/w:moveTo/
   * w:moveFrom) ouvrait MAINTENANT — matérialise le saut de paragraphe en
   * ATTENTE (pendingParaBreak) dans le résultat SANS toucher `runningText`
   * ni consommer `pendingParaBreak` lui-même (appendText, plus bas, reste
   * seul maître de CETTE consommation, exactement comme avant ce chantier).
   *
   * Cause du "collé à la suite du paragraphe précédent" : `contextBefore`
   * était jusqu'ici capturé comme `runningText` tel quel, hors de tout
   * appendText — donc AVANT que le \n\n en attente (posé par un `<w:p>`
   * qui vient de s'ouvrir juste avant ce changement) ne soit matérialisé.
   * Un collage tombant PILE au début d'un nouveau paragraphe Word héritait
   * ainsi d'un `toContext` qui s'arrêtait au texte du paragraphe PRÉCÉDENT,
   * sans son \n\n final — et `planApplyMove`/`planApply` insérait alors le
   * texte directement après CE texte-là dans le fichier réel, en ligne
   * avec le paragraphe précédent au lieu d'ouvrir le nouveau.
   *
   * `runningText !== ""` : un "\n\n" en attente ne compte QUE s'il sépare
   * CE changement d'un VRAI texte déjà accumulé — sinon (`runningText`
   * encore vide : tout premier paragraphe RÉEL d'un feuillet, précédé
   * uniquement de titres/sous-titres injectés par compile-export.ts, voir
   * headingStyleIds/currentParaIsHeading) il ne séparerait rien, jamais
   * trouvable tel quel dans le fichier réel — `toContext`/`contextBefore`
   * doit rester "" pour que planApplyMove retombe sur son cas spécial
   * "début de feuillet" (getFrontmatterEndOffset), pas un "\n\n" fantôme
   * cherché en vain. */
  const currentContextBefore = (): string => runningText + (pendingParaBreak && runningText !== "" ? "\n\n" : "");

  const appendText = (raw: string) => {
    textEventSeq++;
    const isInserted = !!insInfo; // dans un w:ins/w:moveTo actif : pas encore dans la source
    if (pendingAfterCapture.length) {
      const followedByBreak = pendingParaBreak;
      for (const entry of pendingAfterCapture) {
        entry.followedByParagraphBreak = followedByBreak;
        entry.toContextAfter = followedByBreak ? "" : raw.slice(0, 40);
      }
      pendingAfterCapture.length = 0;
    }
    if (pendingCommentContextAfter.length) {
      for (const entry of pendingCommentContextAfter) entry.contextAfter = raw.slice(0, CONTEXT_CHARS);
      pendingCommentContextAfter.length = 0;
    }
    /* Un titre/sous-titre de feuillet injecté par compile-export.ts (voir
       headingStyleIds) n'existe pas dans le markdown source réel : son
       texte ne doit JAMAIS entrer dans `runningText`, ni consommer le
       "\n\n" en attente — comme s'il n'y avait ni texte ni <w:p> du tout à
       cet endroit. Le \n\n en attente reste donc posé pour le PROCHAIN vrai
       paragraphe (voir currentParaIsHeading, réinitialisé à chaque <w:p>).
       insInfo.buffer/delInfo.buffer/openComments, eux, continuent de
       recevoir le texte normalement : un changement suivi qui porterait
       malgré tout sur un de ces titres (cas non observé en pratique) garde
       son texte propre intact, seul le CONTEXTE des autres changements ne
       doit plus s'en trouver pollué. */
    if (!currentParaIsHeading) {
      if (pendingParaBreak) {
        pendingParaBreak = false;
        if (!isInserted && runningText !== "") runningText += "\n\n"; // voir currentContextBefore : jamais de "\n\n" en tête d'un runningText encore vide
        /* insInfo.buffer/delInfo.buffer ne reçoivent PLUS ce "\n\n" ici (voir
           l'ancien commentaire retiré au-dessus, et collapseSameTypeFragments
           plus bas) : le saut de paragraphe qui précède l'OUVERTURE d'un
           changement est déjà entièrement capturé dans contextBefore
           (currentContextBefore, lu AVANT tout appendText) — le rajouter ICI,
           en tête de buffer, le comptait une seconde fois. Confirmé en défaut
           sur un vrai retour (déplacement natif Word, w:moveFrom/w:moveTo) :
           change.text/fromText commençait par un "\n\n" fantôme, cassant la
           recherche fromContext+fromText (qui exigeait alors QUATRE sauts de
           ligne d'affilée dans le fichier réel, qui n'en a que deux) et
           polluant le texte réellement écrit à l'insertion. Le \n\n qui doit
           SÉPARER deux fragments d'un même déplacement multi-paragraphe
           (Word ne peut jamais faire traverser un <w:p> à un seul
           w:moveFrom/w:moveTo, voir collapseSameTypeFragments) est désormais
           ajouté EXPLICITEMENT là où les fragments sont recollés, pas ici. */
        for (const id of openComments.keys()) openComments.set(id, openComments.get(id) + "\n\n");
      }
      if (!isInserted) runningText += raw;
    }
    if (insInfo) insInfo.buffer += raw;
    if (delInfo) delInfo.buffer += raw;
    for (const id of openComments.keys()) openComments.set(id, openComments.get(id) + raw);
  };

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];

    if (t.name === "w:bookmarkStart" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      const name = getAttr(t.attrs, "w:name");
      if (id && name) bookmarkNameById.set(id, name);
      /* Un collage/déplacement posé EXACTEMENT à la frontière entre deux
         signets (entre le </w:bookmarkEnd> d'une scène et le prochain
         <w:bookmarkStart>) retombe forcément dans `unclassified` — voir
         plus bas. Plutôt que de l'y laisser sans indice, on retient les
         deux scènes candidates (celle qui vient de se fermer, celle qui
         s'ouvre ici) sur chaque orphelin en attente : la résolution
         définitive (laquelle des deux, vraiment) se fait ensuite CONTRE
         LE VRAI CONTENU des feuillets candidats (findTolerant, voir
         resolveScenesToPaths/docx-review-view.js) plutôt que par une
         supposition sur un nombre de caractères arbitraire — un texte
         qui n'existe QUE dans l'un des deux feuillets candidats est une
         vérification, pas un pari. */
      if (!currentBookmarkId && pendingOrphans.length > 0) {
        for (const orphan of pendingOrphans) orphan.nextScene = name || null;
        pendingOrphans = [];
      }
      /* Chaque signet de feuillet ouvre une scène dont le texte reconstruit
         (runningText) doit repartir de zéro : le feuillet suivant est un
         FICHIER SÉPARÉ, dont le texte réel ne contient ni la fin du
         feuillet précédent ni les titres/sous-titres injectés juste avant
         ce signet (voir headingStyleIds plus haut — déjà exclus de
         runningText, mais SEULS eux : sans cette remise à zéro, un
         changement posé tout au début d'un feuillet héritait encore de la
         fin du feuillet PRÉCÉDENT comme `toContext`, introuvable dans le
         nouveau fichier — confirmé sur un vrai déplacement natif Word dont
         la destination est le tout premier paragraphe d'un chapitre). */
      const enteringNewScene = !!name && name !== currentBookmarkId;
      currentBookmarkId = name || currentBookmarkId;
      if (enteringNewScene) {
        runningText = "";
        pendingParaBreak = false;
        /* `sawParagraph`, LUI, ne se réinitialise jamais ici : il ne sert
           qu'à savoir si un <w:p> à venir doit lever `pendingParaBreak`
           (« un paragraphe précédait celui-ci ») — un signet s'ouvre EN
           PLEIN MILIEU du <w:p> qui le porte (jamais entre deux <w:p>), le
           réinitialiser romprait ce <w:p> encore ouvert et ferait perdre le
           "\n\n" dû au VRAI paragraphe qui le suit dans le document (bug
           confirmé par un test existant : le \n\n entre deux paragraphes
           séparés par un signet disparaissait). */
      }
      continue;
    }
    if (t.name === "w:bookmarkEnd" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id && bookmarkNameById.get(id) === currentBookmarkId) {
        lastClosedBookmarkId = currentBookmarkId;
        currentBookmarkId = null;
      }
      continue;
    }
    /* w:move{From,To}RangeStart/End portent un w:name PARTAGÉ entre
       l'origine et la destination d'UN MÊME déplacement (ex.
       "move235390922" des deux côtés, confirmé sur un vrai retour) —
       c'est le seul lien fiable entre les deux moitiés : elles ne sont
       jamais adjacentes (contrairement à une réécriture, voir
       mergeAdjacentReplacements) et peuvent même tomber dans des feuillets
       différents. Capturé ici pour permettre de les réunir après coup en
       un seul retour "déplacement" plutôt que deux lignes qu'il faut
       recomposer mentalement (une pour "supprimer ici", une pour "coller
       là" — le retour utilisateur ayant motivé cette fusion). */
    if ((t.name === "w:moveFromRangeStart" || t.name === "w:moveToRangeStart") && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      const name = getAttr(t.attrs, "w:name");
      if (id && name) moveRangeNameById.set(id, name);
      currentMoveName = name || currentMoveName;
      continue;
    }
    if ((t.name === "w:moveFromRangeEnd" || t.name === "w:moveToRangeEnd") && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id && moveRangeNameById.get(id) === currentMoveName) currentMoveName = null;
      continue;
    }
    /* w:moveTo/w:moveFrom (déplacement suivi — couper un passage et le
       coller ailleurs avec le suivi des modifications actif) utilisent le
       même type OOXML que w:ins/w:del (CT_RunTrackChange) — traités ici
       comme un ajout/une suppression ordinaire (même mécanisme, `moved:
       true` en plus pour que l'affichage précise "déplacé" plutôt que de
       laisser croire à une réécriture). Sans ce cas, un passage déplacé
       n'apparaissait dans aucun retour, ni à l'origine ni à la
       destination — silencieusement absent plutôt que mal étiqueté. */
    if ((t.name === "w:ins" || t.name === "w:moveTo") && !t.isClose && !t.selfClosing) {
      insInfo = {
        author: getAttr(t.attrs, "w:author") || "Inconnu",
        date: getAttr(t.attrs, "w:date") || "",
        buffer: "",
        contextBefore: currentContextBefore(),
        moved: t.name === "w:moveTo",
        moveName: currentMoveName,
        fmtBold: undefined,
        fmtItalic: undefined,
      };
      continue;
    }
    if ((t.name === "w:ins" || t.name === "w:moveTo") && t.isClose) {
      /* .buffer non vide, jamais .trim() : un ajout/suppression d'un SEUL
         espace (fréquent quand Word découpe "mot A" -> "mot B" en
         plusieurs runs, voir la structure réelle trouvée sur un vrai
         retour : del(" ")+ins(" montagnes")+del("steppes")) doit rester
         visible ICI pour que la fusion adjacente (mergeAdjacentReplacements)
         le voie et l'intègre correctement — le filtrer ici aurait cassé
         la chaîne et laissé un ancien espace orphelin, menant à une
         reconstruction à double espace. Le filtre "que du blanc, jamais
         fusionné" intervient PLUS TARD, après la fusion (voir
         dropStandaloneWhitespace) : uniquement sur ce qui n'a vraiment
         rien à voir avec un autre changement adjacent. */
      if (insInfo && insInfo.buffer.length > 0) {
        /* Conserve le gras/italique d'une VRAIE insertion (pas d'un
           déplacement, dont le texte garde déjà sa mise en forme à
           l'origine) quand le format est uniforme et l'insertion tient sur
           un seul paragraphe — une emphase Markdown ne peut pas enjamber une
           ligne vide ("**a\n\nb**" invalide), d'où le garde-fou sur "\n\n". */
        let text = insInfo.buffer;
        if (!insInfo.moved && !text.includes("\n\n")) {
          text = wrapEmphasis(text, insInfo.fmtBold === true, insInfo.fmtItalic === true);
        }
        const entry: InsertionChange = {
          type: "insertion",
          text,
          author: insInfo.author,
          date: insInfo.date,
          contextBefore: trimContextBefore(insInfo.contextBefore),
          moved: insInfo.moved,
          moveName: insInfo.moveName,
        };
        const insFootnoteIds = footnoteIdsOf(text);
        if (insFootnoteIds.length) entry.footnoteRefs = insFootnoteIds;
        trackOrphan(entry);
        bucketFor(currentBookmarkId).changes.push(entry);
        // Ce qui suit ce point (saut de paragraphe ou texte en ligne) n'est
        // pas encore connu — résolu au prochain événement textuel, voir
        // appendText/pendingAfterCapture. Sert uniquement à l'affichage/au
        // classement de destinationBoundary, jamais à l'application.
        pendingAfterCapture.push(entry);
      }
      insInfo = null;
      continue;
    }
    if ((t.name === "w:del" || t.name === "w:moveFrom") && !t.isClose && !t.selfClosing) {
      delInfo = {
        author: getAttr(t.attrs, "w:author") || "Inconnu",
        date: getAttr(t.attrs, "w:date") || "",
        buffer: "",
        contextBefore: currentContextBefore(),
        moved: t.name === "w:moveFrom",
        moveName: currentMoveName,
      };
      continue;
    }
    if ((t.name === "w:del" || t.name === "w:moveFrom") && t.isClose) {
      if (delInfo && delInfo.buffer.length > 0) {
        const entry: DeletionChange = {
          type: "deletion",
          text: delInfo.buffer,
          author: delInfo.author,
          date: delInfo.date,
          contextBefore: trimContextBefore(delInfo.contextBefore),
          moved: delInfo.moved,
          moveName: delInfo.moveName,
        };
        const delFootnoteIds = footnoteIdsOf(delInfo.buffer);
        if (delFootnoteIds.length) entry.footnoteRefs = delFootnoteIds;
        trackOrphan(entry);
        bucketFor(currentBookmarkId).changes.push(entry);
      }
      delInfo = null;
      continue;
    }
    if (t.name === "w:pPr" && !t.isClose && !t.selfClosing) {
      insidePPr = true;
      continue;
    }
    if (t.name === "w:pPr" && t.isClose) {
      insidePPr = false;
      continue;
    }
    if (t.name === "w:pStyle" && t.selfClosing && insidePPr) {
      const styleId = getAttr(t.attrs, "w:val");
      if (styleId && headingStyleIds.has(styleId)) currentParaIsHeading = true;
      continue;
    }
    if (t.name === "w:r" && !t.isClose && !t.selfClosing) {
      runBold = false;
      runItalic = false;
      continue;
    }
    if (t.name === "w:rPr" && !t.isClose && !t.selfClosing) {
      formatMarkers = [];
      continue;
    }
    if (t.name === "w:rPr" && t.isClose) {
      formatMarkers = null;
      continue;
    }
    if (t.name === "w:rPrChange" && !t.isClose && !t.selfClosing) {
      /* Un <w:rPrChange> posé DANS <w:pPr><w:rPr> (donc insidePPr) porte la
         mise en forme du MARQUEUR DE PARAGRAPHE (le pilcrow), pas d'un run
         de texte réel — jamais une carte "Mise en forme modifiée" à lui
         seul : Word répète presque toujours le même changement sur le VRAI
         run juste après (confirmé sur un vrai retour, paragraphe barré d'un
         DOCX réel), mais rien ne le garantit dans tous les cas, donc on ne
         se fie jamais à cette coïncidence — `pendingFormatChange` reste
         `null` ici, seul un `w:rPrChange` sur un run réel (insidePPr faux)
         en pose un. */
      pendingFormatChange = insidePPr
        ? null
        : {
            author: getAttr(t.attrs, "w:author") || "Inconnu",
            date: getAttr(t.attrs, "w:date") || "",
            markers: formatMarkers ? [...formatMarkers] : [],
          };
      insideRPrChange = true;
      continue;
    }
    if (t.name === "w:rPrChange" && t.isClose) {
      insideRPrChange = false;
      continue;
    }
    if (FORMAT_MARKER_TAGS.has(t.name) && t.selfClosing && formatMarkers && !insideRPrChange) {
      formatMarkers.push(t.name);
      /* Format du run courant, pour conserver le gras/italique d'un texte
         inséré (voir runBold/runItalic + wrapEmphasis). w:val="0"/"false" =
         désactivation explicite (rare : héritage d'un style gras qu'on
         retire sur ce run). Seuls gras et italique deviennent du Markdown. */
      if (t.name === "w:b" || t.name === "w:i") {
        const val = getAttr(t.attrs, "w:val");
        const on = !(val === "0" || val === "false" || val === "off");
        if (t.name === "w:b") runBold = on;
        else runItalic = on;
      }
      continue;
    }
    if ((t.name === "w:t" || t.name === "w:delText") && !t.isClose && !t.selfClosing) {
      const nextIndex = i + 1 < tags.length ? tags[i + 1].index : xml.length;
      const raw = decodeXmlEntities(xml.slice(t.endIndex, nextIndex));
      if (pendingFormatChange && pendingFormatChange.markers.length > 0) {
        const markers = [...new Set(pendingFormatChange.markers)];
        const bucket = bucketFor(currentBookmarkId);
        /* Lot 5 — fusion des runs adjacents d'UNE SEULE opération visuelle
           (ex. "barrer tout ce paragraphe") : Word découpe souvent un seul
           geste éditorial en plusieurs <w:r>/<w:rPrChange> (frontières de
           police/langue/orthographe), produisant sinon une carte par run au
           lieu d'une carte par opération — retour utilisateur confirmé.
           `textEventSeq` (jamais tronqué, contrairement à contextBefore) est
           le seul repère fiable d'adjacence VRAIE : rien d'autre (texte
           normal, appel de note, tabulation...) ne doit s'être glissé entre
           les deux runs. */
        const canExtendPrevious =
          lastFormatComment &&
          lastFormatCommentBucket === bucket &&
          lastFormatCommentEndSeq === textEventSeq &&
          !pendingParaBreak && // jamais à travers un saut de paragraphe
          lastFormatComment.author === pendingFormatChange.author &&
          lastFormatComment.date === pendingFormatChange.date &&
          sameMarkerSet(lastFormatComment.markers, markers);

        if (canExtendPrevious && lastFormatComment) {
          // Prolonge la carte précédente — y compris pour un fragment
          // PUREMENT BLANC (l'espace entre deux mots barrés) : il n'a pas
          // de sens comme carte à lui seul, mais fait bien partie du MÊME
          // passage mis en forme, jamais une frontière.
          lastFormatComment.anchorText += raw;
          lastFormatCommentEndSeq = textEventSeq + 1;
        } else if (raw.trim()) {
          const labels = markers.map((m) => FORMAT_LABELS[m]).filter(Boolean);
          const entry: ReviewComment = {
            anchorText: raw,
            text: `Mise en forme modifiée : ${labels.length ? labels.join(", ") : "mise en forme"}`,
            author: pendingFormatChange.author,
            date: pendingFormatChange.date,
            isFormatting: true,
            /* marqueurs bruts (ex. ["w:strike"]) — pour que l'affichage
               applique la VRAIE mise en forme (barré/souligné/surligné...)
               sur le texte d'ancrage, pas seulement une étiquette qui la
               décrit (voir ui/docx-review-view.js). */
            markers,
          };
          trackOrphan(entry);
          bucket.comments.push(entry);
          lastFormatComment = entry;
          lastFormatCommentBucket = bucket;
          lastFormatCommentEndSeq = textEventSeq + 1;
        }
        // sinon : fragment blanc isolé (pas adjacent à une carte
        // existante) — jamais sa propre carte, jamais une extension non
        // plus (rien à quoi le rattacher).
      }
      pendingFormatChange = null;
      /* Uniformité du format sur toute l'insertion : on n'enveloppe en
         gras/italique QUE si tous les fragments porteurs de texte partagent
         le même format (cas courant : un mot/une phrase entière en gras).
         Un fragment purement blanc (l'espace entre deux mots gras) n'a pas
         de format propre et ne "casse" pas l'uniformité. Un format mixte ->
         "mixed" -> pas d'enveloppe (texte brut, sûr). */
      if (insInfo && raw.trim()) {
        insInfo.fmtBold = insInfo.fmtBold === undefined ? runBold : (insInfo.fmtBold === runBold ? runBold : "mixed");
        insInfo.fmtItalic = insInfo.fmtItalic === undefined ? runItalic : (insInfo.fmtItalic === runItalic ? runItalic : "mixed");
      }
      appendText(raw);
      continue;
    }
    if (t.name === "w:footnoteReference" && t.selfClosing) {
      const fnId = getAttr(t.attrs, "w:id");
      if (fnId) footnoteOwners[fnId] = currentBookmarkId;
      /* Un appel de note fait partie du passage qui le porte au même titre
         que le texte alentour : sans cet appendText, l'appel disparaissait
         purement et simplement de tout texte reconstruit (contexte,
         suppression, insertion, déplacement) — jamais perdu ni dupliqué,
         voir la mission "couper-coller Word + notes". `[^N]` réutilise
         l'identifiant NUMÉRIQUE INTERNE de Word (w:id), PAS le vrai label
         Markdown source (perdu à l'export, voir
         compile-export.ts#renumberFootnotesAcrossTexts) : un simple jeton
         stable, jamais deviné comme correspondance exacte — voir
         toleranceGroup(), qui le traite comme un JOKER ("il y a un appel de
         note ici", peu importe lequel) plutôt que comme un texte littéral à
         retrouver tel quel dans le fichier réel. */
      if (fnId) appendText(`[^${fnId}]`);
      continue;
    }
    if (t.name === "w:tab" && t.selfClosing) {
      appendText("\t");
      continue;
    }
    if (t.name === "w:br" && t.selfClosing) {
      appendText("\n");
      continue;
    }
    if (t.name === "w:p" && !t.isClose && !t.selfClosing) {
      if (sawParagraph) pendingParaBreak = true;
      sawParagraph = true;
      currentParaIsHeading = false; // un seul <w:pStyle> par paragraphe, jamais hérité du précédent (voir sa doc)
      continue;
    }
    if (t.name === "w:commentRangeStart" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id) {
        openComments.set(id, "");
        openCommentsContextBefore.set(id, currentContextBefore());
      }
      continue;
    }
    if (t.name === "w:commentRangeEnd" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id && openComments.has(id)) {
        const anchorText = (openComments.get(id) ?? "").trim();
        const contextBefore = openCommentsContextBefore.get(id);
        openComments.delete(id);
        openCommentsContextBefore.delete(id);
        resolvedCommentIds.add(id);
        const comment = commentsById[id];
        if (comment) {
          const entry: ReviewComment = {
            anchorText,
            text: comment.text,
            author: comment.author,
            date: comment.date,
          };
          /* Posés seulement s'ils s'appliquent (un commentaire ordinaire
             garde sa forme exacte) : resolvedInWord pré-classe le retour
             comme résolu à l'analyse (voir docx-review-view.js), parentId
             signale une réponse dans un fil. */
          if (comment.done) entry.resolvedInWord = true;
          if (comment.parentId != null) entry.parentId = comment.parentId;
          /* contextBefore/contextAfter (voir findCommentAnchor) : seulement
             si `anchorText` porte VRAIMENT une plage (jamais pour un
             commentaire dont l'ancre a fini vide malgré un
             commentRangeStart/End, cas déjà géré ailleurs) — trimContextBefore
             même convention que les changements (CONTEXT_CHARS). */
          if (anchorText && contextBefore) entry.contextBefore = trimContextBefore(contextBefore);
          if (anchorText) pendingCommentContextAfter.push(entry);
          trackOrphan(entry);
          bucketFor(currentBookmarkId).comments.push(entry);
        }
      }
      continue;
    }
    if (t.name === "w:commentReference" && t.selfClosing) {
      /* Repli SEULEMENT pour un commentaire JAMAIS vu via commentRangeStart/
         End (voir resolvedCommentIds/openComments ci-dessus) : un
         commentaire posé sans sélection de texte (un point, pas une plage)
         — Word n'émet alors QUE ce tag, jamais de commentRangeStart/End.
         anchorText "" (comme une InsertionChange sans contexte particulier)
         plutôt qu'un texte deviné : rien à montrer comme ancre, mais le
         commentaire lui-même ne doit plus jamais disparaître. */
      const id = getAttr(t.attrs, "w:id");
      if (id && !resolvedCommentIds.has(id) && !openComments.has(id)) {
        resolvedCommentIds.add(id);
        const comment = commentsById[id];
        if (comment) {
          const entry: ReviewComment = {
            anchorText: "",
            text: comment.text,
            author: comment.author,
            date: comment.date,
          };
          if (comment.done) entry.resolvedInWord = true;
          if (comment.parentId != null) entry.parentId = comment.parentId;
          trackOrphan(entry);
          bucketFor(currentBookmarkId).comments.push(entry);
        }
      }
      continue;
    }
  }

  // Plus rien ne suit (fin du document) : les insertions/moveTo encore en
  // attente n'ont rien à "coller" derrière elles — traité comme un saut de
  // paragraphe (rien à glisser à la suite, jamais un risque de collage).
  if (pendingAfterCapture.length) {
    for (const entry of pendingAfterCapture) {
      entry.followedByParagraphBreak = true;
      entry.toContextAfter = "";
    }
    pendingAfterCapture.length = 0;
  }
  // Même repli pour un commentaire dont l'ancre est le tout dernier texte du
  // document : contextAfter reste simplement absent (jamais un risque de
  // findCommentAnchor cherchant une suite qui n'existe pas).
  pendingCommentContextAfter.length = 0;

  for (const bucket of [...Object.values(scenes), unclassified]) {
    bucket.changes = mergeMovePairs(bucket.changes);
    bucket.changes = mergeAdjacentReplacements(bucket.changes);
    /* Filtré ICI, APRÈS la fusion — pas à la source (voir plus haut) : un
       ajout/suppression d'un seul espace resté VRAIMENT isolé (jamais
       absorbé dans un remplacement/déplacement voisin) n'a aucun intérêt
       à apparaître seul dans les retours ("Ajout proposé : ' '" ne dit
       rien à personne) — mais un qui a servi à construire un
       "replacement"/"move" a déjà disparu du tableau à ce stade, fusionné
       ailleurs, donc jamais filtré à tort. */
    bucket.changes = bucket.changes.filter(
      (c) => (c.type === "insertion" || c.type === "deletion") ? c.text.trim().length > 0 : true
    );
  }

  /* Ordinal stable par retour — DÉPARTAGE deux retours par ailleurs
     identiques (même type, auteur, date, contexte, texte : ex. la même
     coquille corrigée à deux endroits du manuscrit). getItemKey (voir
     docx-review-view.js) l'incorpore dans la clé de mémorisation "résolu" :
     sans lui, marquer l'un comme résolu masquait AUSSI l'autre (collision
     de clés), un vrai retour utilisateur. Assigné en ordre de document
     (scenes dans l'ordre d'apparition des signets, puis unclassified) et
     donc identique d'une analyse à l'autre du MÊME fichier — l'état résolu
     survit à la réouverture du .docx. */
  let ord = 0;
  /* Non-énumérable À DESSEIN : `ord` est une clé interne de départage, pas
     une donnée du retour — elle ne doit polluer ni un JSON.stringify ni un
     assert.deepEqual sur la forme du changement (les tests vérifient la
     forme exacte). getItemKey y accède directement (item.ord), l'accès
     fonctionne quelle que soit l'énumérabilité. */
  const stamp = (obj: ReviewChange | ReviewComment) => {
    Object.defineProperty(obj, "ord", { value: ord++, enumerable: false, configurable: true, writable: true });
  };
  for (const bucket of [...Object.values(scenes), unclassified]) {
    for (const c of bucket.changes) stamp(c);
    for (const c of bucket.comments) stamp(c);
  }

  return { scenes, unclassified, footnoteOwners };
}

/** Le texte d'UNE note (corps d'un <w:footnote>) reconstruit + ses
 * modifications suivies (w:ins/w:del, réécritures fusionnées) et ses
 * commentaires — même logique que parseDocumentXml mais sur la portée
 * réduite d'une note : pas de signets (une note n'en contient pas), pas de
 * déplacements (inexistants en pratique dans une note). Le w:footnoteRef
 * auto-numéro en tête n'est PAS du texte de la note (c'est le chiffre
 * d'appel) : ignoré. */
function parseFootnoteBody(body: string, commentsById: CommentsById): ReviewBucket {
  const changes: ReviewChange[] = [];
  const comments: ReviewComment[] = [];
  const tags = walkTags(body);
  let runningText = "";
  let insInfo: TrackedChangeInfo | null = null;
  let delInfo: TrackedChangeInfo | null = null;
  const openComments = new Map<string, string>();
  // Même correctif que parseDocumentXml (voir resolvedCommentIds) : un
  // commentaire posé sans sélection de texte n'a pas de commentRangeStart/
  // End, seulement un w:commentReference isolé — jamais vu autrement.
  const resolvedCommentIds = new Set<string>();
  let pendingParaBreak = false;
  let sawParagraph = false;

  // Même correctif que parseDocumentXml (voir currentContextBefore) : ne
  // pas perdre un \n\n en attente au moment où contextBefore est capturé.
  const currentContextBefore = (): string => runningText + (pendingParaBreak ? "\n\n" : "");

  const append = (raw: string) => {
    const inserted = !!insInfo;
    if (pendingParaBreak) {
      pendingParaBreak = false;
      if (!inserted) runningText += "\n\n";
      if (insInfo) insInfo.buffer += "\n\n";
      if (delInfo) delInfo.buffer += "\n\n";
      for (const id of openComments.keys()) openComments.set(id, openComments.get(id) + "\n\n");
    }
    if (!inserted) runningText += raw;
    if (insInfo) insInfo.buffer += raw;
    if (delInfo) delInfo.buffer += raw;
    for (const id of openComments.keys()) openComments.set(id, openComments.get(id) + raw);
  };

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.name === "w:footnoteRef" && t.selfClosing) continue; // chiffre d'appel, pas du contenu
    if (t.name === "w:p" && !t.isClose && !t.selfClosing) {
      if (sawParagraph) pendingParaBreak = true;
      sawParagraph = true;
      continue;
    }
    if (t.name === "w:ins" && !t.isClose && !t.selfClosing) {
      insInfo = { author: getAttr(t.attrs, "w:author") || "Inconnu", date: getAttr(t.attrs, "w:date") || "", buffer: "", contextBefore: currentContextBefore(), moved: false, moveName: null };
      continue;
    }
    if (t.name === "w:ins" && t.isClose) {
      if (insInfo && insInfo.buffer.length > 0) {
        const change: InsertionChange = { type: "insertion", text: insInfo.buffer, author: insInfo.author, date: insInfo.date, contextBefore: trimContextBefore(insInfo.contextBefore), moved: false, moveName: null };
        changes.push(change);
      }
      insInfo = null;
      continue;
    }
    if (t.name === "w:del" && !t.isClose && !t.selfClosing) {
      delInfo = { author: getAttr(t.attrs, "w:author") || "Inconnu", date: getAttr(t.attrs, "w:date") || "", buffer: "", contextBefore: currentContextBefore(), moved: false, moveName: null };
      continue;
    }
    if (t.name === "w:del" && t.isClose) {
      if (delInfo && delInfo.buffer.length > 0) {
        const change: DeletionChange = { type: "deletion", text: delInfo.buffer, author: delInfo.author, date: delInfo.date, contextBefore: trimContextBefore(delInfo.contextBefore), moved: false, moveName: null };
        changes.push(change);
      }
      delInfo = null;
      continue;
    }
    if ((t.name === "w:t" || t.name === "w:delText") && !t.isClose && !t.selfClosing) {
      const nextIndex = i + 1 < tags.length ? tags[i + 1].index : body.length;
      append(decodeXmlEntities(body.slice(t.endIndex, nextIndex)));
      continue;
    }
    if (t.name === "w:tab" && t.selfClosing) { append("\t"); continue; }
    if (t.name === "w:br" && t.selfClosing) { append("\n"); continue; }
    if (t.name === "w:commentRangeStart" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id) openComments.set(id, "");
      continue;
    }
    if (t.name === "w:commentRangeEnd" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id && openComments.has(id)) {
        const anchorText = (openComments.get(id) ?? "").trim();
        openComments.delete(id);
        resolvedCommentIds.add(id);
        const comment = commentsById[id];
        if (comment) {
          const c: ReviewComment = { anchorText, text: comment.text, author: comment.author, date: comment.date };
          if (comment.done) c.resolvedInWord = true;
          if (comment.parentId != null) c.parentId = comment.parentId;
          comments.push(c);
        }
      }
      continue;
    }
    if (t.name === "w:commentReference" && t.selfClosing) {
      // Repli pour un commentaire posé sans sélection de texte dans une
      // note — voir la même branche dans parseDocumentXml.
      const id = getAttr(t.attrs, "w:id");
      if (id && !resolvedCommentIds.has(id) && !openComments.has(id)) {
        resolvedCommentIds.add(id);
        const comment = commentsById[id];
        if (comment) {
          const c: ReviewComment = { anchorText: "", text: comment.text, author: comment.author, date: comment.date };
          if (comment.done) c.resolvedInWord = true;
          if (comment.parentId != null) c.parentId = comment.parentId;
          comments.push(c);
        }
      }
      continue;
    }
  }

  let mergedChanges = mergeAdjacentReplacements(changes);
  mergedChanges = mergedChanges.filter(
    (c) => (c.type === "insertion" || c.type === "deletion") ? c.text.trim().length > 0 : true
  );
  return { changes: mergedChanges, comments };
}

/** `word/footnotes.xml` -> { [w:id]: { changes, comments } }. Ignore les
 * deux notes techniques (séparateur/continuation, marquées w:type et d'id
 * ≤ 0) que Word place toujours en tête. */
export function parseFootnotesXml(footnotesXml: string, commentsById: CommentsById = {}): ReviewBuckets {
  const byId: ReviewBuckets = {};
  if (!footnotesXml) return byId;
  let fnOrd = 0;
  for (const { attrs, body } of extractAllTags(footnotesXml, "w:footnote")) {
    if (getAttr(attrs, "w:type")) continue; // separator / continuationSeparator
    const id = getAttr(attrs, "w:id");
    if (!id || id === "-1" || id === "0") continue;
    const { changes, comments } = parseFootnoteBody(body, commentsById);
    if (changes.length === 0 && comments.length === 0) continue;
    /* Origine "note de bas de page" marquée sur chaque retour : l'affichage
       le signale (le passage vit dans la ligne `[^label]: …` du feuillet,
       pas dans le corps), et `ord` préfixé "f" garde les clés de
       mémorisation distinctes de celles du corps. */
    for (const c of changes) {
      c.inFootnote = true;
      c.footnoteId = id;
      Object.defineProperty(c, "ord", { value: `f${fnOrd++}`, enumerable: false, configurable: true, writable: true });
    }
    for (const c of comments) {
      c.inFootnote = true;
      Object.defineProperty(c, "ord", { value: `f${fnOrd++}`, enumerable: false, configurable: true, writable: true });
    }
    byId[id] = { changes, comments };
  }
  return byId;
}

/** Classe le point d'insertion d'un déplacement — voir DestinationBoundary
 * pour la définition exacte de chaque cas. Calculé UNE FOIS, à la fusion
 * (les trois mergeMovePairs/mergeGlobalMovePairs/mergeImplicitCutPastePairs
 * l'appellent), à partir de deux signaux déjà capturés au parsing :
 * `toContext` (ce qui précède, voir currentContextBefore) et
 * `followedByParagraphBreak` (ce qui suit, voir pendingAfterCapture) —
 * jamais recalculé ni deviné ailleurs. */
export function computeDestinationBoundary(
  toContext: string,
  followedByParagraphBreak: boolean | undefined
): DestinationBoundary {
  const beforeBreak = toContext === "" || toContext.endsWith("\n\n");
  const afterBreak = !!followedByParagraphBreak;
  if (!beforeBreak && !afterBreak) return "inline";
  if (beforeBreak && !afterBreak) return "paragraph-start";
  if (!beforeBreak && afterBreak) return "paragraph-end";
  // beforeBreak && afterBreak : soit un paragraphe autonome en bordure du
  // corps du feuillet (rien avant), soit un vrai paragraphe intercalé entre
  // deux paragraphes déjà là.
  return toContext === "" ? "standalone-paragraph" : "between-paragraphs";
}

/** Un déplacement (couper un passage, le coller ailleurs) produit un
 * w:moveFrom (origine) et un w:moveTo (destination) totalement séparés
 * dans le document — jamais adjacents, contrairement à une réécriture —
 * mais reliés par le MÊME w:name porté par leurs w:move{From,To}RangeStart
 * (voir la boucle principale). Fusionnés ici, dans le même feuillet
 * seulement (une paire à cheval sur deux feuillets resterait trop
 * complexe à appliquer d'un coup — laissée en deux retours "Déplacement"
 * séparés, chacun sur son propre feuillet) — retour utilisateur : "tu
 * montres deux commentaires, un pour supprimer, un autre pour coller" au
 * lieu d'un seul retour "déplacement" cohérent. */
/** Réunit TOUS les fragments d'un même côté (suppression OU insertion) d'un
 * déplacement natif partageant un même w:name — Word fragmente parfois un
 * déplacement MULTI-PARAGRAPHE en plusieurs <w:moveFrom>/<w:moveTo>
 * consécutifs (un par paragraphe : la limite d'un déplacement suivi ne
 * traverse jamais un <w:p>), tous porteurs du MÊME w:name. Concaténés DANS
 * L'ORDRE du document (celui de `fragments`, déjà l'ordre de rencontre),
 * séparés par un "\n\n" EXPLICITE entre chaque paire — jamais un \n\n
 * hérité en tête d'un fragment (voir appendText : chaque fragment.text est
 * maintenant TOUJOURS son texte nu, sans saut de paragraphe fantôme au
 * début) : deux fragments consécutifs d'un même déplacement sont TOUJOURS
 * séparés par un <w:p> réel dans le docx (Word ne peut jamais faire
 * traverser un <w:p> à un seul w:moveFrom/w:moveTo), donc le "\n\n" entre
 * eux est une certitude structurelle, pas une supposition. `null` si
 * `fragments` est vide ; renvoie le fragment lui-même, inchangé, s'il n'y
 * en a qu'un (cas courant, un seul paragraphe déplacé). */
function collapseSameTypeFragments<T extends InsertionChange | DeletionChange>(fragments: T[]): T | null {
  if (fragments.length === 0) return null;
  if (fragments.length === 1) return fragments[0];
  const first = fragments[0];
  const merged: T = { ...first, text: fragments.map((f) => f.text).join("\n\n") };
  const footnoteRefs = fragments.flatMap((f) => f.footnoteRefs || []);
  if (footnoteRefs.length) merged.footnoteRefs = footnoteRefs;
  else delete merged.footnoteRefs;
  return merged;
}

function mergeMovePairs(changes: ReviewChange[]): ReviewChange[] {
  const byMoveName = new Map<string, ReviewChange[]>();
  for (const c of changes) {
    if (c.moved && c.moveName) {
      const group = byMoveName.get(c.moveName);
      if (group) group.push(c);
      else byMoveName.set(c.moveName, [c]);
    }
  }
  const consumed = new Set<ReviewChange>();
  const merged: ReviewChange[] = [];
  for (const c of changes) {
    if (consumed.has(c)) continue;
    if (c.moved && c.moveName) {
      const group = byMoveName.get(c.moveName);
      if (!group) continue;
      const delFragments = group.filter(isDeletionChange);
      const insFragments = group.filter(isInsertionChange);
      const del = collapseSameTypeFragments(delFragments);
      const ins = collapseSameTypeFragments(insFragments);
      if (del && ins && delFragments.length + insFragments.length === group.length) {
        for (const d of delFragments) consumed.add(d);
        for (const n of insFragments) consumed.add(n);
        const move: MoveChange = {
          type: "move",
          text: ins.text,
          author: ins.author,
          date: ins.date,
          fromContext: del.contextBefore,
          fromText: del.text,
          toContext: ins.contextBefore,
          toContextAfter: ins.toContextAfter,
          destinationBoundary: computeDestinationBoundary(ins.contextBefore, ins.followedByParagraphBreak),
        };
        const moveFootnoteIds = ins.footnoteRefs?.length ? ins.footnoteRefs : del.footnoteRefs;
        if (moveFootnoteIds?.length) move.footnoteRefs = moveFootnoteIds;
        if (del.footnoteRefs?.length) move.originFootnoteIds = del.footnoteRefs;
        if (ins.footnoteRefs?.length) move.destFootnoteIds = ins.footnoteRefs;
        merged.push(move);
        continue;
      }
    }
    merged.push(c);
  }
  return merged;
}

/** Fusionne les paires de déplacements (w:moveFrom / w:moveTo) sur L'ENSEMBLE
 * des feuillets et des éléments non rattachés (unclassified/unmatched) —
 * permettant de réunir les déplacements y compris quand l'origine et la
 * destination tombent dans des feuillets différents ou aux frontières. */
export function mergeGlobalMovePairs(
  byPath: ReviewBuckets,
  unmatched: ReviewBuckets = {},
  unclassified: ReviewBucket = emptyBucket()
): void {
  const allContainers: Array<{ path: string | null; list: ReviewChange[] }> = [];

  for (const [path, bucket] of Object.entries(byPath)) {
    if (bucket && bucket.changes) {
      allContainers.push({ path, list: bucket.changes });
    }
  }
  for (const bucket of Object.values(unmatched)) {
    if (bucket && bucket.changes) {
      allContainers.push({ path: null, list: bucket.changes });
    }
  }
  if (unclassified && unclassified.changes) {
    allContainers.push({ path: null, list: unclassified.changes });
  }

  const byMoveName = new Map<string, Array<{ container: { path: string | null; list: ReviewChange[] }; change: ReviewChange }>>();
  for (const container of allContainers) {
    for (const c of container.list) {
      if (c.moved && c.moveName && c.type !== "move") {
        const items = byMoveName.get(c.moveName);
        if (items) items.push({ container, change: c });
        else byMoveName.set(c.moveName, [{ container, change: c }]);
      }
    }
  }

  for (const [moveName, items] of byMoveName.entries()) {
    // Fragments MULTI-PARAGRAPHE (voir collapseSameTypeFragments) : Word ne
    // peut jamais faire traverser un <w:p> à un seul w:moveFrom/w:moveTo,
    // donc un déplacement qui couvre plusieurs paragraphes en produit
    // PLUSIEURS, tous porteurs du même w:name — réunis ici dans l'ordre de
    // rencontre AVANT la vérification "un seul de chaque côté".
    const delItems = items.filter((item) => isDeletionChange(item.change));
    const insItems = items.filter((item) => isInsertionChange(item.change));
    const del = collapseSameTypeFragments(delItems.map((it) => it.change as DeletionChange));
    const ins = collapseSameTypeFragments(insItems.map((it) => it.change as InsertionChange));
    if (del && ins && delItems.length + insItems.length === items.length) {
      const delItem = delItems[0];
      const insItem = insItems[insItems.length - 1];
      for (const item of delItems) {
        const idx = item.container.list.indexOf(item.change);
        if (idx !== -1) item.container.list.splice(idx, 1);
      }
      for (const item of insItems) {
        const idx = item.container.list.indexOf(item.change);
        if (idx !== -1) item.container.list.splice(idx, 1);
      }

      const mergedMove: MoveChange = {
        type: "move",
        text: ins.text,
        author: ins.author || del.author,
        date: ins.date || del.date,
        fromContext: del.contextBefore,
        fromText: del.text,
        toContext: ins.contextBefore,
        toContextAfter: ins.toContextAfter,
        destinationBoundary: computeDestinationBoundary(ins.contextBefore, ins.followedByParagraphBreak),
        fromPath: delItem.container.path || null,
        toPath: insItem.container.path || null,
        moved: true,
        moveName,
        nearFiles: [
          ...new Set([
            ...(del.nearFiles || []),
            ...(ins.nearFiles || []),
            ...delItems.map((it) => it.container.path).filter((p): p is string => !!p),
            ...insItems.map((it) => it.container.path).filter((p): p is string => !!p),
          ]),
        ],
      };
      const globalMoveFootnoteIds = ins.footnoteRefs?.length ? ins.footnoteRefs : del.footnoteRefs;
      if (globalMoveFootnoteIds?.length) mergedMove.footnoteRefs = globalMoveFootnoteIds;
      if (del.footnoteRefs?.length) mergedMove.originFootnoteIds = del.footnoteRefs;
      if (ins.footnoteRefs?.length) mergedMove.destFootnoteIds = ins.footnoteRefs;

      const targetPath = insItem.container.path || delItem.container.path;
      if (targetPath) {
        if (!byPath[targetPath]) byPath[targetPath] = { changes: [], comments: [] };
        byPath[targetPath].changes.push(mergedMove);
      } else {
        unclassified.changes.push(mergedMove);
      }
    }
  }
}

/** Normalisation LÉGÈRE d'un texte pour la comparaison couper-coller
 * implicite (mergeImplicitCutPastePairs) — UNIQUEMENT les variations que
 * Word introduit lui-même en réenregistrant un couper/coller comme deux
 * modifications séparées (retours à la ligne \r\n/\r, espace insécable,
 * suites d'espaces/tabulations, espaces parasites autour d'un saut de
 * ligne ou en bordure) : jamais la ponctuation, jamais les accents, jamais
 * de minuscule forcée, jamais de distance floue — un texte réellement
 * différent doit rester détecté comme différent. */
function normalizeCutPasteText(text: string): string {
  if (!text) return "";
  let t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/[  ]/g, " ");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/[ \t]*\n[ \t]*/g, "\n");
  return t.trim();
}

/** Égalité STRICTE (mêmes identifiants, même ordre) de deux listes d'appels
 * de note — `undefined`/tableau vide comptent comme "aucun appel", donc
 * équivalents entre eux. Volontairement strict (pas juste "même nombre") :
 * en cas de doute sur une correspondance entre deux appels de notes
 * distincts, mieux vaut refuser la fusion que mélanger deux notes
 * différentes (voir mergeImplicitCutPastePairs). */
function footnoteRefsEqual(a?: string[], b?: string[]): boolean {
  const aa = a || [];
  const bb = b || [];
  if (aa.length !== bb.length) return false;
  return aa.every((id, i) => id === bb[i]);
}

/** Détecte un couper-coller Word enregistré comme un w:del et un w:ins
 * SÉPARÉS — sans w:name partagé, donc invisibles à mergeGlobalMovePairs
 * (voir ci-dessus), qui doit impérativement s'exécuter EN PREMIER : un
 * vrai déplacement natif est toujours fusionné par son moveName avant que
 * cette détection, plus incertaine, n'ait la moindre chance de s'en
 * emparer. N'agit que sur ce qui RESTE APRÈS elle (jamais un `c.moved`,
 * qu'il s'agisse d'un déplacement déjà fusionné en "move" ou d'un
 * moveFrom/moveTo natif resté seul pour une raison quelconque).
 *
 * Fusion volontairement PRUDENTE : texte identique après normalisation
 * légère, même auteur, dates identiques ou l'une des deux absente, mêmes
 * appels de note dans le même ordre (ou aucun des deux côtés), et la
 * correspondance doit être UNIQUE dans les deux sens — un seul candidat
 * possible de chaque côté, jamais un choix parmi plusieurs. Au moindre
 * doute (deux candidats identiques, auteurs différents, notes qui ne
 * correspondent pas...), les deux retours restent séparés plutôt que
 * fusionnés à tort. Un remplacement adjacent (même feuillet, texte voisin,
 * voir mergeAdjacentReplacements) a déjà été absorbé en "replacement" AVANT
 * que le del/ins correspondant n'atteigne cette fonction : structurellement
 * jamais reconsidéré ici. */
export function mergeImplicitCutPastePairs(
  byPath: ReviewBuckets,
  unmatched: ReviewBuckets = {},
  unclassified: ReviewBucket = emptyBucket()
): void {
  const allContainers: Array<{ path: string | null; list: ReviewChange[] }> = [];

  for (const [path, bucket] of Object.entries(byPath)) {
    if (bucket && bucket.changes) allContainers.push({ path, list: bucket.changes });
  }
  for (const bucket of Object.values(unmatched)) {
    if (bucket && bucket.changes) allContainers.push({ path: null, list: bucket.changes });
  }
  if (unclassified && unclassified.changes) allContainers.push({ path: null, list: unclassified.changes });

  type Candidate = { container: { path: string | null; list: ReviewChange[] }; change: ReviewChange };
  const dels: Candidate[] = [];
  const inss: Candidate[] = [];
  for (const container of allContainers) {
    for (const c of container.list) {
      if (c.moved) continue; // déplacement natif déjà traité (ou déjà "move") — jamais reconsidéré ici
      if (isDeletionChange(c)) dels.push({ container, change: c });
      else if (isInsertionChange(c)) inss.push({ container, change: c });
    }
  }

  const matches = (del: ReviewChange, ins: ReviewChange): boolean => {
    if (!isDeletionChange(del) || !isInsertionChange(ins)) return false;
    if (normalizeCutPasteText(del.text) !== normalizeCutPasteText(ins.text)) return false;
    if (del.author !== ins.author) return false;
    if (del.date && ins.date && del.date !== ins.date) return false;
    if (!footnoteRefsEqual(del.footnoteRefs, ins.footnoteRefs)) return false;
    return true;
  };

  // Candidats de chaque côté — la fusion n'a lieu que si CHACUN n'a
  // qu'UN SEUL candidat en face (unicité dans les deux sens).
  const insCandidatesForDel = new Map<Candidate, Candidate[]>();
  const delCandidatesForIns = new Map<Candidate, Candidate[]>();
  for (const d of dels) insCandidatesForDel.set(d, inss.filter((n) => matches(d.change, n.change)));
  for (const n of inss) delCandidatesForIns.set(n, dels.filter((d) => matches(d.change, n.change)));

  const consumedDel = new Set<Candidate>();
  const consumedIns = new Set<Candidate>();

  for (const d of dels) {
    if (consumedDel.has(d)) continue;
    const insMatches = insCandidatesForDel.get(d) || [];
    if (insMatches.length !== 1) continue;
    const n = insMatches[0];
    if (consumedIns.has(n)) continue;
    const delMatches = delCandidatesForIns.get(n) || [];
    if (delMatches.length !== 1) continue; // pas réciproquement unique

    consumedDel.add(d);
    consumedIns.add(n);

    const delIndex = d.container.list.indexOf(d.change);
    if (delIndex !== -1) d.container.list.splice(delIndex, 1);
    const insIndex = n.container.list.indexOf(n.change);
    if (insIndex !== -1) n.container.list.splice(insIndex, 1);

    const del = d.change as DeletionChange;
    const ins = n.change as InsertionChange;

    /* AUCUN moveName : contrairement à mergeGlobalMovePairs, ce couper-
       coller n'a jamais été déclaré comme tel par Word — lui inventer un
       moveName ferait croire à un déplacement natif qu'il n'est pas. */
    const mergedMove: MoveChange = {
      type: "move",
      text: ins.text,
      author: del.author,
      date: del.date || ins.date,
      fromContext: del.contextBefore,
      fromText: del.text,
      toContext: ins.contextBefore,
      toContextAfter: ins.toContextAfter,
      destinationBoundary: computeDestinationBoundary(ins.contextBefore, ins.followedByParagraphBreak),
      fromPath: d.container.path || null,
      toPath: n.container.path || null,
      moved: true,
    };
    const cutPasteFootnoteIds = ins.footnoteRefs?.length ? ins.footnoteRefs : del.footnoteRefs;
    if (cutPasteFootnoteIds?.length) mergedMove.footnoteRefs = cutPasteFootnoteIds;
    if (del.footnoteRefs?.length) mergedMove.originFootnoteIds = del.footnoteRefs;
    if (ins.footnoteRefs?.length) mergedMove.destFootnoteIds = ins.footnoteRefs;

    const targetPath = n.container.path || d.container.path;
    if (targetPath) {
      if (!byPath[targetPath]) byPath[targetPath] = { changes: [], comments: [] };
      byPath[targetPath].changes.push(mergedMove);
    } else {
      unclassified.changes.push(mergedMove);
    }
  }
}

/** Un del/ins est-il adjacent au précédent élément d'une chaîne (même
 * arithmétique de contexte que déciderait planApply) ? `runningText`
 * reflète le texte SOURCE ACTUEL (voir appendText) — un texte supprimé y
 * est encore présent (inclus), un texte inséré n'y est pas encore (exclu).
 * Donc del->ins : l'insertion qui suit voit le texte supprimé s'ajouter à
 * son propre contexte. ins->del : l'insertion n'ayant rien ajouté, la
 * suppression qui suit partage le MÊME contexte.
 *
 * Les deux contextes comparés sont DÉJÀ tronqués à leurs 40 derniers
 * caractères (trimContextBefore, posé au moment du push) : une égalité
 * stricte `del.contextBefore + del.text === ins.contextBefore` n'est vraie
 * que si le texte avant le mot remplacé tient en moins de 40 caractères —
 * c.-à-d. en début de paragraphe seulement. En pleine prose (contexte long),
 * les deux fenêtres de troncature ne coïncident plus et la fusion échouait :
 * Word produit del("chat")+ins("chien"), on affichait DEUX retours au lieu
 * d'un remplacement, et appliquer la suppression rendait l'autre inapplicable
 * (contexte disparu). Le lien qui, lui, SURVIT à la troncature :
 * ins.contextBefore est toujours le suffixe de (del.contextBefore + del.text)
 * — d'où endsWith plutôt qu'égalité. */
function isChainAdjacent(
  chain: Array<InsertionChange | DeletionChange>,
  last: InsertionChange | DeletionChange,
  next: InsertionChange | DeletionChange
): boolean {
  if (last.moved || next.moved) return false;
  if (last.type === "deletion" && next.type === "insertion") return (last.contextBefore + last.text).endsWith(next.contextBefore);
  if (last.type === "insertion" && next.type === "deletion") return last.contextBefore === next.contextBefore;
  return false;
}

/** Une réécriture Word (sélectionner un passage, taper autre chose)
 * produit une CHAÎNE de w:del/w:ins adjacents — pas toujours une seule
 * paire : Word découpe parfois "steppes" -> "montagnes" en trois temps
 * (del(" ")+ins(" montagnes")+del("steppes"), confirmé sur un vrai
 * retour), chaque élément adjacent au précédent. Les traiter comme des
 * changements indépendants casse à la moindre application partielle :
 * appliquer le remplacement seul retire l'espace qui séparait "les" de
 * "steppes" (il devient "lesmontagnessteppes"), et la suppression de
 * "steppes", elle, cherche encore l'ancien espace qui n'existe plus —
 * échec en cascade. Toute la chaîne est donc fusionnée en UNE seule
 * "replacement" (oldText = concaténation, DANS L'ORDRE, du texte de
 * chaque suppression de la chaîne ; newText = idem pour les insertions),
 * appliquée en une seule opération atomique (voir planApply). */
function mergeAdjacentReplacements(changes: ReviewChange[]): ReviewChange[] {
  const merged: ReviewChange[] = [];
  let i = 0;
  while (i < changes.length) {
    const cur = changes[i];
    if ((cur.type !== "deletion" && cur.type !== "insertion") || cur.moved) {
      merged.push(cur);
      i++;
      continue;
    }
    const chain: Array<InsertionChange | DeletionChange> = [cur];
    let j = i + 1;
    while (j < changes.length) {
      const next = changes[j];
      if (!isInsertionChange(next) && !isDeletionChange(next)) break;
      if (!isChainAdjacent(chain, chain[chain.length - 1], next)) break;
      chain.push(next);
      j++;
    }
    if (chain.length > 1) {
      const replacement: ReplacementChange = {
        type: "replacement",
        oldText: chain.filter((c) => c.type === "deletion").map((c) => c.text).join(""),
        newText: chain.filter((c) => c.type === "insertion").map((c) => c.text).join(""),
        author: chain[0].author,
        date: chain[0].date,
        contextBefore: chain[0].contextBefore,
        moved: false,
      };
      merged.push(replacement);
    } else {
      merged.push(cur);
    }
    i = j; // j == i+1 si la chaîne n'a pas grandi, sinon la fin de la chaîne consommée
  }
  return merged;
}

/** Un déplacement de passage qui contient un appel de note (voir
 * MoveChange.originFootnoteIds/destFootnoteIds) déplace CETTE note avec
 * lui — le label Markdown `[^réel]` voyage tel quel dans fromText/text (voir
 * planApply), la définition `[^réel]: …` reste où elle est (même feuillet).
 * Mais Word, LUI, marque EN PLUS le corps de la note dans footnotes.xml
 * comme supprimé (w:del, à l'id d'origine) ET réinséré (w:ins, au nouvel id
 * de destination) — un changement de tracking ENTIÈREMENT séparé du
 * déplacement du passage, que rien ne relie explicitement dans l'OOXML sauf
 * la PAIRE d'ids interne (voir originFootnoteIds[i]/destFootnoteIds[i], DANS
 * L'ORDRE d'apparition, donc appariables par position). Resté tel quel, ce
 * couple del/ins produisait DEUX bugs trouvés sur un vrai retour (déplacement
 * CROISÉ entre deux feuillets — voir mergeGlobalMovePairs, d'où l'appel APRÈS
 * lui plutôt que dans parseDocxReview : avant la fusion inter-feuillets, le
 * passage principal n'est pas encore un seul MoveChange, ses ids d'origine/
 * destination ne sont donc pas encore réunis) :
 * - une fiche "Ajout"/"Suppression" de note EN PLUS de la fiche
 *   "Déplacement" (retour utilisateur : une fiche inutile) ;
 * - pire, ce couple del/ins était repris par mergeImplicitCutPastePairs
 *   (texte identique, même auteur) en un second "move" fantôme pour la SEULE
 *   définition de note — dont la suppression pouvait réussir (elle retrouve
 *   le texte, encore présent) mais dont l'insertion échouait TOUJOURS (le
 *   passage principal l'a déjà écrite en la déplaçant avec lui).
 *
 * Appelé entre mergeGlobalMovePairs et mergeImplicitCutPastePairs (voir
 * docx-review-view.ts) — DOIT suivre le premier (les MoveChange cross-
 * feuillets n'existent qu'après lui) et PRÉCÉDER le second (qui sinon
 * absorberait ce couple avant que cette fonction n'ait pu agir).
 *
 * Absorbé ici : pour chaque paire (originId, destId) d'un déplacement déjà
 * reconnu, si un del à originId ET un ins à destId (n'importe où dans
 * byPath/unmatched/unclassified, voir footnoteId — jamais scoping à un seul
 * feuillet, le déplacement peut être inter-feuillets) portent EXACTEMENT le
 * même texte (normalizeCutPasteText — aucune note dont le CONTENU a
 * réellement été corrigé n'est jamais absorbée, elle doit rester visible),
 * les deux sont retirés AVANT que mergeImplicitCutPastePairs ne les
 * considère — jamais une fiche séparée, jamais une seconde moitié de "move"
 * fantôme. Une longueur différente entre originFootnoteIds et
 * destFootnoteIds (jamais censé arriver : même passage, mêmes appels)
 * n'absorbe rien du tout plutôt que d'apparier au hasard. */
export function absorbMoveOwnedFootnoteRevisions(
  byPath: ReviewBuckets,
  unmatched: ReviewBuckets = {},
  unclassified: ReviewBucket = emptyBucket()
): void {
  const allContainers: ReviewBucket[] = [
    ...Object.values(byPath),
    ...Object.values(unmatched),
    unclassified,
  ].filter((b): b is ReviewBucket => !!b);

  const allMoves: MoveChange[] = [];
  const delByFootnoteId = new Map<string, { container: ReviewBucket; change: DeletionChange }>();
  const insByFootnoteId = new Map<string, { container: ReviewBucket; change: InsertionChange }>();
  for (const container of allContainers) {
    for (const c of container.changes) {
      if (c.type === "move" && c.originFootnoteIds?.length && c.destFootnoteIds?.length) {
        allMoves.push(c);
      } else if (c.type === "deletion" && c.inFootnote && c.footnoteId) {
        delByFootnoteId.set(c.footnoteId, { container, change: c });
      } else if (c.type === "insertion" && c.inFootnote && c.footnoteId) {
        insByFootnoteId.set(c.footnoteId, { container, change: c });
      }
    }
  }

  for (const move of allMoves) {
    const origins = move.originFootnoteIds!;
    const dests = move.destFootnoteIds!;
    if (origins.length !== dests.length) continue; // jamais d'appariement au hasard
    for (let i = 0; i < origins.length; i++) {
      const delEntry = delByFootnoteId.get(origins[i]);
      const insEntry = insByFootnoteId.get(dests[i]);
      if (!delEntry || !insEntry) continue;
      if (normalizeCutPasteText(delEntry.change.text) !== normalizeCutPasteText(insEntry.change.text)) continue; // contenu réellement corrigé : reste visible
      const delList = delEntry.container.changes;
      const delIdx = delList.indexOf(delEntry.change);
      if (delIdx !== -1) delList.splice(delIdx, 1);
      const insList = insEntry.container.changes;
      const insIdx = insList.indexOf(insEntry.change);
      if (insIdx !== -1) insList.splice(insIdx, 1);
    }
  }
}

/** Point d'entrée complet : docx déjà décompressé en { "word/document.xml":
 * string, "word/comments.xml": string|undefined, "word/footnotes.xml":
 * string|undefined, "word/styles.xml": string|undefined } (voir
 * views/docx-review-view.js pour l'appel réel via jszip — séparé ici pour
 * rester une fonction pure, testable sans dépendance à jszip ni à
 * l'environnement Obsidian). Les retours trouvés DANS une note de bas de
 * page (footnotes.xml) sont rattachés au feuillet où l'appel de note
 * apparaît (footnoteOwners, voir parseDocumentXml) — ou à unclassified si
 * l'appel n'est dans aucun signet reconnu. `word/styles.xml` (voir
 * parseHeadingStyleIds) reste optionnel — absent, aucun style n'est reconnu
 * comme titre/sous-titre de feuillet, dégradation silencieuse comme le
 * reste de ce parseur. */
export function parseDocxReview(files: DocxFiles): { scenes: ReviewBuckets; unclassified: ReviewBucket } {
  const extendedByParaId = parseCommentsExtended(files["word/commentsExtended.xml"] || "");
  const commentsById = parseCommentsXml(files["word/comments.xml"] || "", extendedByParaId);
  const headingStyleIds = parseHeadingStyleIds(files["word/styles.xml"] || "");
  const { scenes, unclassified, footnoteOwners } = parseDocumentXml(files["word/document.xml"] || "", commentsById, headingStyleIds);

  const footnoteBuckets = parseFootnotesXml(files["word/footnotes.xml"] || "", commentsById);
  for (const [fnId, bucket] of Object.entries(footnoteBuckets)) {
    const owner = footnoteOwners[fnId] || null;
    let target: ReviewBucket;
    if (owner) {
      if (!scenes[owner]) scenes[owner] = emptyBucket();
      target = scenes[owner];
    } else {
      target = unclassified;
    }
    for (const c of bucket.changes) target.changes.push(c);
    for (const c of bucket.comments) target.comments.push(c);
  }

  return { scenes, unclassified };
}

/** Résout les signets (identifiants opaques) trouvés dans le docx vers les
 * feuillets ACTUELS du projet (voir services/compile-export.js#listCompiledFilePaths
 * pour `currentPaths`) — en recalculant le même hash pour chaque chemin
 * actuel plutôt qu'en cherchant un chemin stocké quelque part (il n'y en a
 * jamais eu, voir utils/docx-bookmarks.js). Un signet qui ne correspond à
 * AUCUN chemin actuel (le feuillet a été renommé/déplacé/supprimé depuis
 * l'export) part dans `unmatched`, distinct de `unclassified`
 * (parseDocumentXml : contenu jamais rattaché à un signet du tout) — deux
 * causes différentes, deux messages différents pour l'utilisateur. */
export function resolveScenesToPaths(
  scenes: ReviewBuckets,
  currentPaths: string[]
): { byPath: ReviewBuckets; unmatched: ReviewBuckets } {
  const idToPath = new Map(currentPaths.map((p) => [bookmarkIdFor(p), p]));
  const byPath: ReviewBuckets = {};
  const unmatched: ReviewBuckets = {};
  for (const [bookmarkId, bucket] of Object.entries(scenes)) {
    const path = idToPath.get(bookmarkId);
    if (path) byPath[path] = bucket;
    else unmatched[bookmarkId] = bucket;
  }
  return { byPath, unmatched };
}

/* Équivalences construites d'après les règles RÉELLES de frenchTypography()
 * (utils/core.js), pas supposées : "..." -> "…" (3 caractères -> 1),
 * "'" -> "’" (1:1), un ou plusieurs espace/tabulation avant ;:!?» ->
 * exactement une espace insécable (N:1, donc classe "un OU PLUS" en sens
 * inverse). frenchTypography ne touche PAS aux tirets ("--" n'est converti
 * nulle part dans le pipeline d'export) : pas de tolérance inventée pour un
 * cas qui n'existe pas réellement. Un guillemet droit "..." devient
 * « ...(espaces insécables) » (espaces insécables INSÉRÉES en plus autour
 * du contenu, pas une simple substitution de caractère) : seule la marque
 * elle-même (" vs «/») est couverte ici, les espaces insécables ajoutées
 * autour restent un angle mort assumé plutôt qu'un mécanisme de tolérance
 * à longueur variable bien plus complexe pour un gain marginal. */
function toleranceGroup(text: string): string {
  let pattern = "";
  let i = 0;
  const MD = "[*_~=]*";

  while (i < text.length) {
    /* Appel de note `[^id]` reconstruit depuis le docx (voir appendText,
       w:footnoteReference) : `id` porte l'identifiant INTERNE Word, jamais
       le vrai label Markdown du fichier source (perdu à l'export, voir
       renumberFootnotesAcrossTexts) — l'exiger tel quel échouerait
       systématiquement dès que le fichier réel utilise un autre label.
       Traité comme un JOKER ("un appel de note existe ici", peu importe
       lequel) : matche n'importe quel `[^vraiLabel]` réellement présent, à
       charge pour l'appelant (planApplyMove/planApplyInterFile) de
       retrouver le VRAI texte matché plutôt que de faire confiance à ce
       texte reconstruit pour l'écriture. */
    if (text[i] === "[" && text[i + 1] === "^") {
      const closeIdx = text.indexOf("]", i + 2);
      if (closeIdx !== -1) {
        pattern += "\\[\\^[^\\]]+\\]";
        i = closeIdx + 1;
        continue;
      }
    }
    if (text.slice(i, i + 3) === "...") {
      pattern += "(?:\\.\\.\\.|…)";
      i += 3;
      continue;
    }
    const c = text[i];
    if (c === "…") {
      pattern += "(?:\\.\\.\\.|…)";
    } else if (c === "'" || c === "’") {
      pattern += "['’]";
    } else if (c === '"' || c === "«" || c === "»") {
      pattern += '["«»]';
    } else if (c === "\n" || c === "\r") {
      /* Le texte reconstruit depuis le .docx ne porte que des LF (\n, voir
         appendText), mais le feuillet lu du coffre peut etre en CRLF (\r\n)
         - coffre cree/synchronise sous Windows. Sans cette tolerance, toute
         recherche de contexte enjambant une fin de paragraphe echouait
         systematiquement sous Windows. Un \r\n ne compte que pour un saut :
         on avale le \n qui suit un \r. */
      if (c === "\r" && text[i + 1] === "\n") i++;
      pattern += "\\r?\\n";
    } else if (c === " " || c === "\t" || c === "\u00a0" || c === "\u202f") {
      pattern += MD + "[ \\t\\u00a0\\u202f]+" + MD;
    } else {
      pattern += escapeRegExp(c);
    }
    i++;
  }
  return `(${MD}${pattern}${MD})`;
}

function getFrontmatterEndOffset(content: string): number {
  if (!content) return 0;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? match[0].length : 0;
}

function countRegexMatches(re: RegExp, content: string): number {
  const bodyStart = getFrontmatterEndOffset(content);
  let count = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index >= bodyStart) count++;
  }
  return count;
}

function findSingleRegexMatch(re: RegExp, content: string): RegExpExecArray | null {
  const bodyStart = getFrontmatterEndOffset(content);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index >= bodyStart) return m;
  }
  return null;
}

function getContextCandidates(contextText: string): string[] {
  if (!contextText) return [""];
  const candidates = [contextText];
  const lengths = [30, 20, 15, 10, 8, 6];
  for (const len of lengths) {
    if (contextText.length > len) {
      candidates.push(contextText.slice(-len));
    }
  }
  return [...new Set(candidates)];
}

/** Vérification avant écriture (Lot 1, mode Révision DOCX) : un résultat
 * `ok:true` ne doit JAMAIS introduire une suite de trois sauts de ligne ou
 * plus (triple/quadruple ligne vide) là où `original` n'en avait aucune, ni
 * altérer le frontmatter YAML de tête. Une suite déjà présente dans
 * `original` (fichier pré-existant inhabituel) n'est jamais elle-même un
 * motif de refus — seule une NOUVELLE apparue est bloquante. Une structure
 * cassée renvoie `false` : à l'appelant de refuser l'écriture plutôt que
 * de laisser passer un fichier corrompu. */
function verifyNoBrokenStructure(original: string, candidate: string): boolean {
  if (!/\n{3,}/.test(original) && /\n{3,}/.test(candidate)) return false;
  const origFm = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const candFm = candidate.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if ((origFm ? origFm[0] : "") !== (candFm ? candFm[0] : "")) return false;
  return true;
}

/** Un déplacement dont la destination porte un paragraphe EXISTANT
 * immédiatement après (voir DestinationBoundary) doit être suivi d'un
 * "\n\n" écrit APRÈS le texte inséré — sans lui, ce paragraphe suivant se
 * retrouve accolé au texte collé (bug confirmé sur un vrai déplacement
 * natif Word, w:moveTo : "paragraphe précédentpassage déplacé" au lieu de
 * "paragraphe précédent\n\npassage déplacé\n\nparagraphe suivant"). Seuls
 * "between-paragraphs"/"standalone-paragraph" ont un VRAI saut de
 * paragraphe des DEUX côtés — "paragraph-start" continue directement dans
 * le paragraphe qui suit (aucun \n\n à ajouter), "paragraph-end"/"inline"
 * ne touchent jamais ce qui suit. */
function needsTrailingParagraphBreak(boundary: DestinationBoundary | undefined): boolean {
  return boundary === "between-paragraphs" || boundary === "standalone-paragraph";
}

/** Après une suppression, un `\n{3,}` qui vient d'apparaître À CHEVAL sur la
 * frontière de coupe est le collage de deux séparateurs de paragraphe
 * désormais adjacents — celui qui précédait le passage supprimé (gardé dans
 * le contexte, donc AVANT `at`) ET celui qui le suivait (resté intact dans
 * le reste du fichier, donc À PARTIR de `at`) — jamais voulu : ramené à un
 * "\n\n" unique. Les deux côtés de `at` sont examinés séparément (jamais un
 * seul `\n{3,}` d'un seul côté : c'est justement leur SOMME qui dépasse 2 à
 * cette frontière précise, chaque côté pouvant très bien n'en porter que
 * deux) — strictement localisé à `at` (jamais un scan global qui toucherait
 * un triple saut déjà présent ailleurs dans le fichier, hors de cette
 * édition). */
function collapseBoundaryBreak(text: string, at: number): string {
  const before = /\n+$/.exec(text.slice(0, at));
  const after = /^\n+/.exec(text.slice(at));
  const beforeLen = before ? before[0].length : 0;
  const afterLen = after ? after[0].length : 0;
  if (beforeLen + afterLen < 3) return text;
  return text.slice(0, at - beforeLen) + "\n\n" + text.slice(at + afterLen);
}

/* Balises invisibles (jamais produites par un docx réel) posées de part et
   d'autre du texte collé À LA DESTINATION le temps du calcul de
   planApplyMove, puis retirées avant d'écrire quoi que ce soit — permet de
   retrouver la plage EXACTE du texte une fois les DEUX édits (retrait
   origine + collage destination, appliqués en ordre décroissant de
   position — voir plus bas) posés, sans recalculer l'algèbre des décalages
   à la main (fragile : collapseBoundaryBreak peut retirer un nombre de
   caractères variable côté origine). Voir stripMoveMarkers. */
const MOVE_MARK_START = " FEUILLETS_MOVE_START ";
const MOVE_MARK_END = " FEUILLETS_MOVE_END ";

/** Retire MOVE_MARK_START/MOVE_MARK_END de `marked` et renvoie à la fois le
 * texte propre (jamais écrit avec les balises encore dedans) et la plage
 * qu'elles délimitaient, RECALCULÉE dans les coordonnées du texte propre
 * (donc directement utilisable comme `insertedRange`, voir ApplyResult).
 * `range` reste `null` seulement si les balises ont disparu (ne devrait
 * jamais arriver — aucun edit de planApplyMove ne touche la destination
 * après leur pose) : dans ce cas dégradé, le texte est quand même nettoyé,
 * juste sans plage à révéler. */
function stripMoveMarkers(marked: string): { clean: string; range: { start: number; end: number } | null } {
  const startIdx = marked.indexOf(MOVE_MARK_START);
  const endIdx = marked.indexOf(MOVE_MARK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const clean = marked.split(MOVE_MARK_START).join("").split(MOVE_MARK_END).join("");
    return { clean, range: null };
  }
  const clean = marked.slice(0, startIdx) + marked.slice(startIdx + MOVE_MARK_START.length, endIdx) + marked.slice(endIdx + MOVE_MARK_END.length);
  return { clean, range: { start: startIdx, end: endIdx - MOVE_MARK_START.length } };
}

/** Un "move" demande DEUX modifications distinctes du même feuillet —
 * retirer le texte à son origine, l'ajouter à sa destination — jamais
 * superposées. Recherche tolérante avec dégradation progressive du contexte
 * pour résister aux édits multiples dans la même phrase ou au découpage dans
 * le même paragraphe. */
function planApplyMove(content: string, change: ApplyChange): ApplyResult {

  let toMatch: RegexMatch | null = null;
  /* Vrai si le paragraphe de destination N'EXISTE PAS ENCORE, séparé, dans
     CE fichier — Word l'a créé en scindant un paragraphe déjà là pour faire
     de la place au passage déplacé (confirmé sur un vrai retour : le
     paragraphe qui suit la destination était, dans le Markdown source,
     encore la SUITE du paragraphe qui précède — le saut de paragraphe final
     de `toContext` n'a donc RIEN à retrouver ici, il reste à CRÉER). Résolu
     seulement en repli, après l'échec de la recherche normale (toContext
     tel quel) — jamais en premier : la plupart des destinations retrouvent
     un saut de paragraphe déjà réel dans le fichier, ce repli ne doit pas
     leur voler la priorité. */
  let toContextSplitNeeded = false;
  /* Vrai pour un déplacement dont la destination est le TOUT DÉBUT du
     feuillet (toContext === "", voir sa doc dans ApplyChange) : `toMatch`
     consomme ici les 0/1/2 sauts de ligne DÉJÀ présents juste après le
     frontmatter (au lieu de les laisser dans `content.slice(insertAt)`,
     jamais comptés par la suite) pour que leadingBreak/trailingBreak
     ci-dessous puissent reconstruire EXACTEMENT une ligne vide de chaque
     côté — ni collé au frontmatter, ni collé au paragraphe qui suit, ni de
     ligne vide en double. Confirmé en défaut sur un vrai déplacement
     inter-feuillets réel : sans ça, le texte collé atterrissait accolé au
     "---" de fin de frontmatter ET au paragraphe suivant, sans aucun saut
     de ligne des deux côtés. */
  /* Vrai si AUCUN saut de ligne n'existait déjà entre le frontmatter et le
     corps (frontmatter suivi immédiatement d'une vraie ligne de texte,
     sans ligne vide) — seul ce cas a besoin d'un "\n" AJOUTÉ en plus de
     celui déjà baké dans `content.slice(0, insertAt)` (voir
     bodyStartLeadingBreak plus bas) : dès qu'il en existe un (le cas
     courant, une vraie ligne vide), le saut déjà consommé par `toMatch`
     suffit, en ajouter un de plus ferait une ligne vide EN DOUBLE. */
  let toContextBodyStartNeedsBreak = false;
  if (change.toContext === "") {
    const bodyStart = getFrontmatterEndOffset(content);
    const afterBody = content.slice(bodyStart);
    const existingBreakMatch = /^\r?\n\r?\n|^\r?\n/.exec(afterBody);
    const existingBreak = existingBreakMatch ? existingBreakMatch[0] : "";
    toMatch = { index: bodyStart, 0: existingBreak };
    toContextBodyStartNeedsBreak = existingBreak === "" && bodyStart > 0;
  } else {
    const toCandidates = getContextCandidates(change.toContext);
    for (const ctx of toCandidates) {
      if (!ctx) continue;
      const re = new RegExp(toleranceGroup(ctx), "g");
      const count = countRegexMatches(re, content);
      if (count === 1) {
        toMatch = findSingleRegexMatch(re, content);
        break;
      }
    }
    if (!toMatch && needsTrailingParagraphBreak(change.destinationBoundary) && /\n\n$/.test(change.toContext)) {
      const strippedContext = change.toContext.replace(/\n\n$/, "");
      const strippedCandidates = getContextCandidates(strippedContext);
      for (const ctx of strippedCandidates) {
        if (!ctx) continue;
        const re = new RegExp(toleranceGroup(ctx), "g");
        const count = countRegexMatches(re, content);
        if (count === 1) {
          toMatch = findSingleRegexMatch(re, content);
          toContextSplitNeeded = true;
          break;
        }
      }
    }
  }
  if (!toMatch) return { ok: false, reason: "not-found" };

  const bodyStart = getFrontmatterEndOffset(content);
  const insertAt = Math.max(bodyStart, toMatch.index + toMatch[0].length);
  const leadingBreak = toContextSplitNeeded && !/\n$/.test(content.slice(0, insertAt)) ? "\n\n" : "";
  /* Un "\n" de plus est nécessaire UNIQUEMENT si aucun saut de ligne
     n'existait déjà entre le frontmatter et le corps (voir
     toContextBodyStartNeedsBreak) : `content.slice(0, insertAt)` porte déjà
     TOUT saut de ligne préexistant (celui de la ligne "---" elle-même, PLUS
     celui, éventuel, consommé par `toMatch` juste au-dessus) — en rajouter
     un systématiquement produirait une ligne vide EN DOUBLE dès qu'il y en
     avait déjà une (cas réel confirmé : "---" suivi d'une vraie ligne
     vide). */
  const bodyStartLeadingBreak = toContextBodyStartNeedsBreak ? "\n" : "";

  let fromMatch: RegExpExecArray | null = null;
  let usedFromCtx = true;
  const fromCandidates = [...getContextCandidates(change.fromContext), ""];
  for (const ctx of fromCandidates) {
    const pattern = ctx ? toleranceGroup(ctx) + toleranceGroup(change.fromText) : toleranceGroup(change.fromText);
    const re = new RegExp(pattern, "g");
    const count = countRegexMatches(re, content);
    if (count === 1) {
      fromMatch = findSingleRegexMatch(re, content);
      usedFromCtx = !!ctx;
      break;
    }
  }

  const addTrailingBreak = needsTrailingParagraphBreak(change.destinationBoundary);
  /* "\n\n" ajouté seulement si l'endroit visé n'en porte pas déjà un — le
     vrai cas réel (voir needsTrailingParagraphBreak) place TOUJOURS
     `insertAt` pile devant le texte du paragraphe suivant, sans aucun saut
     entre les deux (le \n\n qui séparait les deux paragraphes a déjà été
     consommé comme fin de `toContext`) ; ce garde-fou évite seulement un
     \n\n\n\n si jamais ce n'était pas le cas. */
  const trailingBreak = addTrailingBreak && !/^\r?\n/.test(content.slice(insertAt)) ? "\n\n" : "";

  if (fromMatch && fromMatch.index >= bodyStart) {
    const rawFromText = usedFromCtx
      ? content.slice(fromMatch.index + (fromMatch[1] ? fromMatch[1].length : 0), fromMatch.index + fromMatch[0].length)
      : fromMatch[0];
    const pastedText = rawFromText || change.text;
    /* Balises MOVE_MARK_* posées autour du SEUL texte collé (jamais dans
       leadingBreak/trailingBreak) — voir stripMoveMarkers : c'est cette
       plage, une fois les deux edits appliqués, qu'il faut renvoyer comme
       insertedRange, pas leadingBreak/trailingBreak qui ne sont que des
       sauts de paragraphe autour. */
    const textToInsert = leadingBreak + bodyStartLeadingBreak + MOVE_MARK_START + pastedText + MOVE_MARK_END + trailingBreak;

    const edits = [
      { start: insertAt, end: insertAt, replacement: textToInsert, collapse: false },
      usedFromCtx
        ? { start: fromMatch.index, end: fromMatch.index + fromMatch[0].length, replacement: fromMatch[1], collapse: true }
        : { start: fromMatch.index, end: fromMatch.index + fromMatch[0].length, replacement: "", collapse: true },
    ].sort((a, b) => b.start - a.start);

    let result = content;
    for (const e of edits) {
      result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
      /* Suppression de l'origine (voir collapseBoundaryBreak) : si le
         passage déplacé formait tout un paragraphe (un vrai saut le
         précédait ET le suivait), le retirer laisse le saut de tête (gardé
         dans le contexte) directement adjacent à celui qui le suivait déjà
         dans le fichier, intact — deux séparateurs collés plutôt qu'un
         seul. `e.start` reste une position valide dans `result` à ce point
         précis de la boucle : les edits sont appliqués en ordre DÉCROISSANT
         de position, donc rien situé à ou avant `e.start` n'a encore bougé. */
      if (e.collapse) result = collapseBoundaryBreak(result, e.start + e.replacement.length);
    }
    const { clean, range } = stripMoveMarkers(result);
    if (!verifyNoBrokenStructure(content, clean)) return { ok: false, reason: "ambiguous" };
    return { ok: true, newContent: clean, insertedRange: range || undefined };
  } else {
    // Si fromText est encore présent dans le fichier mais n'a pas pu être localisé de façon sûre (ex. ambiguïté), ne pas dupliquer sans couper !
    const rawFromRe = new RegExp(toleranceGroup(change.fromText), "g");
    const rawFromCount = countRegexMatches(rawFromRe, content);
    if (rawFromCount > 0) {
      return { ok: false, reason: rawFromCount > 1 ? "ambiguous" : "not-found" };
    }
    /* Le passage n'est plus repérable dans le fichier réel (déjà coupé par
       un edit préalable) : pour un texte ordinaire, insérer `change.text`
       tel quel reste sûr. Mais s'il porte un appel de note, `change.text`
       ne contient que l'identifiant INTERNE Word ([^N], voir appendText/
       toleranceGroup) — jamais le vrai label du fichier — et on n'a plus
       aucun VRAI texte matché à réutiliser (rawFromText, cas ci-dessus)
       pour le retrouver : mieux vaut échouer explicitement que d'écrire un
       [^N] qui ne correspond à rien dans ce feuillet. */
    if (change.footnoteRefs && change.footnoteRefs.length > 0) {
      return { ok: false, reason: "not-found" };
    }
    // Si fromText n'est plus dans le fichier (déjà coupé par un edit préalable), appliquer l'insertion seule
    const fallbackResult =
      content.slice(0, insertAt) + leadingBreak + bodyStartLeadingBreak + change.text + trailingBreak + content.slice(insertAt);
    if (!verifyNoBrokenStructure(content, fallbackResult)) return { ok: false, reason: "ambiguous" };
    const fallbackStart = insertAt + leadingBreak.length + bodyStartLeadingBreak.length;
    return { ok: true, newContent: fallbackResult, insertedRange: { start: fallbackStart, end: fallbackStart + change.text.length } };
  }
}

/** Calcule le nouveau contenu d'un feuillet SI `change` devait y être appliqué.
 * Utilise une recherche à dégradation progressive de contexte pour permettre
 * l'application successive de plusieurs modifications dans la même phrase ou
 * paragraphe sans être bloqué par la modification du contexte voisin. */
export function planApply(content: string, change: ApplyChange | null | undefined): ApplyResult {
  if (!change) return { ok: false, reason: "no-context" };
  if (change.type === "move") return planApplyMove(content, change);
  if (change.contextBefore === undefined && !change.text && !change.oldText) return { ok: false, reason: "no-context" };

  let sawAmbiguous = false;

  if (change.type === "insertion") {
    /* `destinationBoundary` n'est JAMAIS posé pour une insertion ordinaire
       (voir needsTrailingParagraphBreak/ApplyChange) — SEULEMENT par
       planApplyInterFile pour la destination d'un déplacement ENTRE deux
       feuillets. Un `contextBefore` vide y a alors exactement le même sens
       que `toContext === ""` dans planApplyMove (voir sa doc) : le passage
       déplacé devient le tout premier contenu du feuillet destination —
       jamais une raison de deviner pour une insertion QUELCONQUE (voir le
       test "pas de contexte du tout : échec explicite" juste en dessous),
       mais un cas connu et sûr pour CELLE-LÀ précisément (confirmé sur un
       vrai déplacement inter-feuillets dont la destination est le tout
       premier paragraphe du chapitre cible). */
    if (!change.contextBefore && change.destinationBoundary !== undefined) {
      const bodyStart = getFrontmatterEndOffset(content);
      /* Consomme les 0/1/2 sauts de ligne déjà présents juste après le
         frontmatter (même correctif que planApplyMove#toContextBodyStartNeedsBreak,
         même raison : sans lui, le texte collé atterrissait accolé au
         "---" de fin de frontmatter, sans aucune ligne vide — ou, si un
         "\n" était rajouté sans condition, avec une ligne vide EN DOUBLE
         dès qu'il y en avait déjà une). */
      const afterBody = content.slice(bodyStart);
      const existingBreakMatch = /^\r?\n\r?\n|^\r?\n/.exec(afterBody);
      const existingBreak = existingBreakMatch ? existingBreakMatch[0] : "";
      const insertAt = bodyStart + existingBreak.length;
      const leadingBreak = existingBreak === "" && bodyStart > 0 ? "\n" : "";
      const trailingBreak =
        needsTrailingParagraphBreak(change.destinationBoundary) && !/^\r?\n/.test(content.slice(insertAt)) ? "\n\n" : "";
      const result = content.slice(0, insertAt) + leadingBreak + change.text + trailingBreak + content.slice(insertAt);
      if (!verifyNoBrokenStructure(content, result)) return { ok: false, reason: "ambiguous" };
      const start = insertAt + leadingBreak.length;
      return { ok: true, newContent: result, insertedRange: { start, end: start + change.text.length } };
    }
    if (!change.contextBefore) return { ok: false, reason: "no-context" };
    const candidates = getContextCandidates(change.contextBefore);
    for (const ctx of candidates) {
      if (!ctx) continue;
      const re = new RegExp(toleranceGroup(ctx), "g");
      const count = countRegexMatches(re, content);
      if (count > 1) sawAmbiguous = true;
      if (count === 1) {
        const m = findSingleRegexMatch(re, content);
        if (m) {
          const insertAt = m.index + m[0].length;
          /* destinationBoundary n'est posé QUE par planApplyInterFile (voir
             ApplyChange) — pour une insertion ordinaire (jamais un
             déplacement), il reste `undefined` et ce bloc est un no-op :
             même correctif que planApplyMove, voir
             needsTrailingParagraphBreak. */
          const trailingBreak =
            needsTrailingParagraphBreak(change.destinationBoundary) && !/^\r?\n/.test(content.slice(insertAt))
              ? "\n\n"
              : "";
          return {
            ok: true,
            newContent: content.slice(0, insertAt) + change.text + trailingBreak + content.slice(insertAt),
            insertedRange: { start: insertAt, end: insertAt + change.text.length },
          };
        }
      }
    }
    return { ok: false, reason: sawAmbiguous ? "ambiguous" : "not-found" };
  }

  if (change.type === "replacement") {
    const candidates = getContextCandidates(change.contextBefore);
    for (const ctx of candidates) {
      const pattern = ctx ? toleranceGroup(ctx) + toleranceGroup(change.oldText) : toleranceGroup(change.oldText);
      const re = new RegExp(pattern, "g");
      const count = countRegexMatches(re, content);
      if (count > 1) sawAmbiguous = true;
      if (count === 1) {
        const m = findSingleRegexMatch(re, content);
        if (m) {
          if (ctx) {
            return {
              ok: true,
              newContent: content.slice(0, m.index) + m[1] + change.newText + content.slice(m.index + m[0].length),
            };
          } else {
            return {
              ok: true,
              newContent: content.slice(0, m.index) + change.newText + content.slice(m.index + m[0].length),
            };
          }
        }
      }
    }
    return { ok: false, reason: sawAmbiguous ? "ambiguous" : "not-found" };
  }

  const candidates = [...getContextCandidates(change.contextBefore), ""];
  for (const ctx of candidates) {
    const pattern = ctx ? toleranceGroup(ctx) + toleranceGroup(change.text) : toleranceGroup(change.text);
    const re = new RegExp(pattern, "g");
    const count = countRegexMatches(re, content);
    if (count > 1) sawAmbiguous = true;
    if (count === 1) {
      const m = findSingleRegexMatch(re, content);
      if (m) {
        /* collapseBoundaryBreak seulement si CE change (voir
           destinationBoundary, réutilisé ici pour l'origine du déplacement —
           planApplyInterFile) porte un vrai saut de paragraphe des deux
           côtés : une suppression ORDINAIRE (jamais un déplacement,
           destinationBoundary alors toujours undefined) garde son
           comportement exact d'avant ce chantier — aucune surprise sur les
           retours existants. */
        const collapse = needsTrailingParagraphBreak(change.destinationBoundary);
        if (ctx) {
          const cut = content.slice(0, m.index) + m[1] + content.slice(m.index + m[0].length);
          return { ok: true, newContent: collapse ? collapseBoundaryBreak(cut, m.index + m[1].length) : cut };
        } else {
          const cut = content.slice(0, m.index) + content.slice(m.index + m[0].length);
          return { ok: true, newContent: collapse ? collapseBoundaryBreak(cut, m.index) : cut };
        }
      }
    }
  }
  return { ok: false, reason: sawAmbiguous ? "ambiguous" : "not-found" };
}

/** Cherche `text` (tolérance typographique, voir toleranceGroup) dans
 * `content` avec dégradation progressive du contexte en cas de modifs
 * successives dans la même zone. */
export function findTolerant(content: string, text: string): { index: number; length: number } | null {
  if (!text) return null;
  const re = new RegExp(toleranceGroup(text), "g");
  const count = countRegexMatches(re, content);
  if (count === 1) {
    const m = findSingleRegexMatch(re, content);
    if (m) return { index: m.index, length: m[0].length };
  }

  const lengths = [40, 25, 15, 10, 5];
  for (const len of lengths) {
    if (text.length > len) {
      const sub = text.slice(-len);
      const subRe = new RegExp(toleranceGroup(sub), "g");
      const subCount = countRegexMatches(subRe, content);
      if (subCount === 1) {
        const m = findSingleRegexMatch(subRe, content);
        if (m) return { index: m.index, length: m[0].length };
      }
    }
  }
  return null;
}

/** Localise dans `content` la plage RÉELLEMENT annotée par un commentaire
 * Word (w:commentRangeStart/End, voir ReviewComment.anchorText/contextBefore/
 * contextAfter) — jamais une supposition. `anchorText` seul, s'il est déjà
 * unique dans le feuillet, suffit (chemin le plus courant, aussi rapide
 * qu'avant ce correctif — jamais besoin de contexte pour un mot commenté
 * une seule fois). S'il apparaît PLUSIEURS fois (mot ou expression
 * courants, cas réel confirmé sur un commentaire d'une ligne : "anciens"),
 * `contextBefore`/`contextAfter` (le texte RÉEL qui entoure la plage
 * annotée dans le docx, jamais une supposition) désambiguïsent — testés
 * ensemble d'abord (le plus sûr), puis chacun séparément — sans jamais
 * exiger une correspondance littérale avec tout le texte compilé (jamais
 * `contextBefore + anchorText + contextAfter` pris comme un bloc rigide :
 * seul `anchorText` doit matcher EXACTEMENT, le contexte ne fait que
 * choisir LAQUELLE occurrence). Repli final sur findTolerant (dégradation
 * par suffixes courts) si `anchorText` lui-même reste introuvable tel
 * quel — même filet de sécurité qu'avant ce correctif. */
export function findCommentAnchor(
  content: string,
  comment: { anchorText?: string; contextBefore?: string; contextAfter?: string }
): { index: number; length: number } | null {
  const anchorText = comment.anchorText || "";
  if (!anchorText) return null;

  const anchorRe = new RegExp(toleranceGroup(anchorText), "g");
  const count = countRegexMatches(anchorRe, content);
  if (count === 1) {
    const m = findSingleRegexMatch(anchorRe, content);
    if (m) return { index: m.index, length: m[0].length };
  } else if (count > 1) {
    const before = comment.contextBefore || "";
    const after = comment.contextAfter || "";
    const attempts: Array<{ pattern: string; anchorGroup: number }> = [];
    if (before && after) attempts.push({ pattern: toleranceGroup(before) + toleranceGroup(anchorText) + toleranceGroup(after), anchorGroup: 2 });
    if (before) attempts.push({ pattern: toleranceGroup(before) + toleranceGroup(anchorText), anchorGroup: 2 });
    if (after) attempts.push({ pattern: toleranceGroup(anchorText) + toleranceGroup(after), anchorGroup: 1 });
    for (const { pattern, anchorGroup } of attempts) {
      const re = new RegExp(pattern, "g");
      if (countRegexMatches(re, content) !== 1) continue;
      const m = findSingleRegexMatch(re, content);
      if (!m) continue;
      let start = m.index;
      for (let g = 1; g < anchorGroup; g++) start += (m[g] || "").length;
      const length = (m[anchorGroup] || "").length;
      if (length) return { index: start, length };
    }
  }

  return findTolerant(content, anchorText);
}

/** Le texte à retrouver dans un feuillet pour UN changement donné — même
 * construction que ce que planApply cherche à modifier, réutilisée à la
 * fois pour "Ouvrir le feuillet" (voir docx-review-view.js) et pour
 * résoudre un orphelin de frontière (voir resolveOrphans) : les deux
 * doivent toujours pointer sur exactement ce qu'Appliquer manipulerait. */
export function searchTextForChange(change: ReviewChange): string {
  if (change.type === "insertion") return change.contextBefore;
  if (change.type === "replacement") return change.contextBefore + change.oldText;
  if (change.type === "move") return change.toContext;
  return change.contextBefore + change.text; // deletion
}

/** Un orphelin (comment/changement tombé dans `unclassified`, voir
 * trackOrphan dans parseDocumentXml) porte deux scènes CANDIDATES
 * (`prevScene`/`nextScene`, les signets de part et d'autre de la
 * frontière où il est tombé) — jamais une certitude. Ici, on VÉRIFIE
 * plutôt que deviner : `readContent(path)` lit le VRAI contenu actuel de
 * chaque feuillet candidat, et si le texte cherché (findTolerant, même
 * tolérance typographique que planApply) ne s'y trouve que dans UN SEUL
 * des candidats, l'orphelin est reclassé là — une correspondance réelle
 * dans le texte source, pas un pari sur un nombre de caractères. S'il
 * matche dans les deux (ambigu) ou aucun (le texte a changé depuis),
 * reste dans `unclassified`, avec les candidats attachés (`nearFiles`)
 * pour que l'utilisateur puisse ouvrir directement l'un ou l'autre plutôt
 * que devoir les chercher. `readContent` est injecté (async path -> texte
 * | null) pour que cette fonction reste pure et testable sans coffre
 * réel — voir docx-review-view.js pour l'appel avec `vault.read`. */
export async function resolveOrphans(
  unclassified: ReviewBucket,
  idToPath: Map<string, string>,
  readContent: ContentReader
): Promise<ReviewBuckets> {
  const relocated: ReviewBuckets = {}; // path -> { changes: [], comments: [] }

  const resolveList = async <T extends ReviewChange | ReviewComment>(list: T[]): Promise<T[]> => {
    const stillUnresolved: T[] = [];
    for (const item of list) {
      const candidates = [...new Set(
        [item.prevScene, item.nextScene]
          .filter((id): id is string => typeof id === "string")
          .map((id) => idToPath.get(id))
          .filter((path): path is string => typeof path === "string")
      )];
      const searchText = "anchorText" in item ? item.anchorText : searchTextForChange(item);
      const matches: string[] = [];
      for (const path of candidates) {
        const content = await readContent(path);
        if (content != null && findTolerant(content, searchText)) matches.push(path);
      }
      if (matches.length === 1) {
        if (!relocated[matches[0]]) relocated[matches[0]] = { changes: [], comments: [] };
        if ("anchorText" in item) relocated[matches[0]].comments.push(item);
        else relocated[matches[0]].changes.push(item);
      } else {
        item.nearFiles = candidates;
        stillUnresolved.push(item);
      }
    }
    return stillUnresolved;
  };

  unclassified.changes = await resolveList(unclassified.changes);
  unclassified.comments = await resolveList(unclassified.comments);
  return relocated;
}

/** Localise `text` (précédé de `contextBefore`, même dégradation
 * progressive que planApply/planApplyMove) dans `content` et renvoie le
 * texte RÉELLEMENT présent à cet endroit — pas la reconstruction depuis le
 * docx, qui pour un appel de note ne porte que l'identifiant interne Word
 * (voir toleranceGroup). Sert à retrouver les VRAIS `[^label]` du fichier
 * source avant un transfert de note inter-fichiers (resolveFootnoteTransfer)
 * : jamais une conversion devinée depuis l'identifiant Word. `null` si
 * aucune correspondance unique — jamais un pari.
 *
 * Exportée aussi pour « Voir l'origine »/« Voir le passage déplacé »
 * (docx-review-view.ts#openAndReveal, branche "move") : SEULE la dégradation
 * du CONTEXTE est progressive ici — `text` (donc `matchedText`, retourné en
 * entier) ne rétrécit JAMAIS, contrairement à findTolerant (qui, lui, dégrade
 * `text` en repli vers de courts suffixes ASCII — regression confirmée sur
 * un vrai retour : un déplacement de PARAGRAPHE ENTIER ou multi-paragraphe
 * ne sélectionnait plus, après le premier échec de correspondance exacte,
 * que les derniers caractères du DERNIER fragment). */
export function locateChangeMatch(
  content: string,
  contextBefore: string,
  text: string
): { index: number; length: number; matchedText: string } | null {
  const candidates = [...getContextCandidates(contextBefore), ""];
  for (const ctx of candidates) {
    const pattern = ctx ? toleranceGroup(ctx) + toleranceGroup(text) : toleranceGroup(text);
    const re = new RegExp(pattern, "g");
    const count = countRegexMatches(re, content);
    if (count === 1) {
      const m = findSingleRegexMatch(re, content);
      if (m) {
        const matchedText = ctx
          ? content.slice(m.index + (m[1] ? m[1].length : 0), m.index + m[0].length)
          : m[0];
        return { index: m.index, length: m[0].length, matchedText };
      }
    }
  }
  return null;
}

/** Ajoute `[^id]: text` en fin de fichier, séparé du contenu existant par
 * une ligne vide (convention la plus sûre : jamais d'hypothèse sur une
 * structure de fin de fichier particulière). */
function appendFootnoteDefinition(content: string, id: string, text: string): string {
  const trimmed = content.replace(/[ \t]+$/, "").replace(/\n+$/, "");
  const sep = trimmed.length ? "\n\n" : "";
  return `${trimmed}${sep}[^${id}]: ${text}\n`;
}

/** Retire la définition `[^id]: …` (bloc complet, continuations comprises)
 * de `content`. Ne fait rien si la définition est absente (jamais une
 * erreur — appelée après vérification, mais reste sûre isolément).
 *
 * Le bloc de définitions (voir export-docx.ts) enchaîne ses lignes par un
 * simple "\", SANS ligne vide, entre définitions ADJACENTES — seule la toute
 * PREMIÈRE définition du bloc est séparée du paragraphe qui précède par une
 * vraie ligne vide ("\n\n"). Trois cas, jamais confondus (bug confirmé sur
 * un vrai déplacement de note, mission "nettoyage d'une note déplacée") :
 * - définition PREMIÈRE du bloc, D'AUTRES restent après : seule SA ligne
 *   (+ le "\n" qui la sépare de la suivante) part — la ligne vide qui la
 *   séparait du paragraphe reste INTACTE devant ce qui reste (jamais
 *   absorbée avec elle, sous peine de recoller le paragraphe au bloc de
 *   notes restant — la régression observée : un "\n" en moins entre les
 *   deux, réinterprété comme un "\" parasite au réexport DOCX suivant) ;
 * - définition INTERMÉDIAIRE (ni première ni dernière du bloc) : seule SA
 *   ligne (+ son propre "\n") part — les définitions voisines, AVANT et
 *   APRÈS, restent EXACTEMENT telles quelles, "\" de continuation compris ;
 * - définition DERNIÈRE du bloc (rien ne suit plus), D'AUTRES restent
 *   AVANT : le "\" de continuation qui terminait la ligne précédente ne
 *   sépare alors plus rien — un "\" parasite en fin de bloc, retiré lui
 *   seul (jamais le reste de cette ligne, jamais reconstruit) ;
 * - définition SEULE du bloc (première ET dernière à la fois) : la ligne
 *   vide qui la séparait du paragraphe n'a plus rien à séparer non plus —
 *   absorbée avec elle, comme le reste du bloc. */
function removeFootnoteDefinition(content: string, id: string): string {
  const def = findDefinition(content, id);
  if (!def) return content;
  let start = def.start;
  let end = def.end;
  const precededByBlankLine = content[start - 1] === "\n" && content[start - 2] === "\n";
  if (content[end] === "\n") end += 1;
  const followedByAnotherDefinition = /^ {0,3}\[\^[^\]]+\]:/.test(content.slice(end));

  if (precededByBlankLine && !followedByAnotherDefinition) {
    start -= 1;
  } else if (!followedByAnotherDefinition && content[start - 1] === "\n" && content[start - 2] === "\\") {
    return content.slice(0, start - 2) + "\n" + content.slice(end);
  }
  return content.slice(0, start) + content.slice(end);
}

/** Renomme un appel `[^oldId]` -> `[^newId]` dans `text` (jamais dans un
 * fichier entier : seulement le passage en cours de déplacement) — utilisé
 * après renumérotation pour conflit d'identifiant (voir
 * resolveFootnoteTransfer). */
function renameFootnoteCall(text: string, oldId: string, newId: string): string {
  const re = new RegExp(`\\[\\^${escapeRegExp(oldId)}\\]`, "g");
  return text.replace(re, `[^${newId}]`);
}

/** Indique si un label de note est déjà OCCUPÉ (déjà défini `[^label]:` OU
 * déjà appelé `[^label]` dans le contenu, même sans définition). */
function isFootnoteLabelOccupied(content: string | null | undefined, label: string): boolean {
  if (!content) return false;
  const { references, definitions } = parseFootnotes(content);
  return definitions.some((d) => d.id === label) || references.some((r) => r.id === label);
}

/** Transfère vers `toContent` les notes de bas de page réellement appelées
 * par `movedText` (VRAIS `[^label]` du fichier d'origine, voir
 * locateChangeMatch — jamais les identifiants internes Word reconstruits
 * depuis le docx) :
 * - une définition IDENTIQUE déjà présente à destination sous le même
 *   identifiant est réutilisée telle quelle (rien à ajouter, rien à
 *   renommer) ;
 * - un identifiant DÉJÀ PRIS à destination par une définition DIFFÉRENTE
 *   ou un appel existant (conflit) est renuméroté proprement
 *   (nextFootnoteNumber), l'appel déplacé et la nouvelle définition suivant
 *   le même nouvel identifiant ;
 * - la définition d'origine n'est retirée que si PLUS AUCUN AUTRE appel
 *   (que celui qu'on déplace) ne s'en sert encore dans le fichier
 *   d'origine ;
 * - un `[^label]` sans définition dans le fichier d'origine (incohérence
 *   déjà présente dans la source, pas de notre ressort) reste tel quel,
 *   sans transfert.
 * Toujours déterministe (jamais d'échec ici) : l'éventuelle ambiguïté à
 * refuser explicitement — le passage lui-même introuvable de façon sûre —
 * est déjà écartée PLUS TÔT par planApplyInterFile (locateChangeMatch),
 * avant même d'appeler cette fonction. */
function resolveFootnoteTransfer(
  movedText: string,
  fromContent: string,
  toContent: string
): { text: string; fromContent: string; toContent: string } {
  const { references } = parseFootnotes(movedText);
  if (references.length === 0) {
    return { text: movedText, fromContent, toContent };
  }

  const seenIds = [...new Set(references.map((r) => r.id))];
  let workingFrom = fromContent;
  let workingTo = toContent;
  let text = movedText;
  let nextId = nextFootnoteNumber(workingTo);

  for (const label of seenIds) {
    // Contenu de RÉFÉRENCE (fichier d'origine, jamais encore muté par cette
    // boucle) : chaque label est indépendant, pas de risque qu'une
    // itération précédente en affecte la lecture.
    const def = findDefinition(fromContent, label);
    if (!def) continue;

    const existingAtDest = findDefinition(toContent, label);
    let resolvedLabel = label;

    if (existingAtDest) {
      const sameContent = normalizeCutPasteText(existingAtDest.content) === normalizeCutPasteText(def.content);
      if (!sameContent) {
        do {
          resolvedLabel = String(nextId++);
        } while (isFootnoteLabelOccupied(workingTo, resolvedLabel) || isFootnoteLabelOccupied(toContent, resolvedLabel));
        workingTo = appendFootnoteDefinition(workingTo, resolvedLabel, def.content);
      }
      // sinon : même définition déjà présente à destination, rien à ajouter.
    } else if (isFootnoteLabelOccupied(workingTo, label) || isFootnoteLabelOccupied(toContent, label)) {
      do {
        resolvedLabel = String(nextId++);
      } while (isFootnoteLabelOccupied(workingTo, resolvedLabel) || isFootnoteLabelOccupied(toContent, resolvedLabel));
      workingTo = appendFootnoteDefinition(workingTo, resolvedLabel, def.content);
    } else {
      workingTo = appendFootnoteDefinition(workingTo, resolvedLabel, def.content);
    }

    if (resolvedLabel !== label) {
      text = renameFootnoteCall(text, label, resolvedLabel);
    }

    if (findReferences(fromContent, label).length <= 1) {
      workingFrom = removeFootnoteDefinition(workingFrom, label);
    }
  }

  return { text, fromContent: workingFrom, toContent: workingTo };
}

/** Applique un déplacement de texte inter-feuillets : supprime le texte
 * à l'origine (fromFile) et l'insère à la destination (toFile). Quand le
 * passage porte un ou plusieurs appels de note (moveChange.footnoteRefs),
 * transfère aussi leur définition — voir resolveFootnoteTransfer — de façon
 * SÛRE uniquement : le passage d'origine doit être localisable sans
 * ambiguïté (locateChangeMatch), faute de quoi rien n'est écrit, ni dans
 * fromFile ni dans toFile (voir la mission "couper-coller Word + notes"). */
export async function planApplyInterFile(
  vault: ReviewVault,
  fromFile: ReviewVaultFile,
  toFile: ReviewVaultFile,
  moveChange: MoveChange
): Promise<
  | { ok: true; insertedRange?: { start: number; end: number } }
  | { ok: false; step: "from" | "to"; reason: string }
> {
  const fromContent = await vault.read(fromFile);
  const toContent = await vault.read(toFile);

  let workingFromContent = fromContent;
  let workingToContent = toContent;
  let movedText = moveChange.text;

  if (moveChange.footnoteRefs && moveChange.footnoteRefs.length > 0) {
    const fromMatch = locateChangeMatch(fromContent, moveChange.fromContext, moveChange.fromText);
    if (!fromMatch) {
      // Passage introuvable de façon sûre dans le fichier d'origine : on ne
      // devine jamais quelle note transférer. Aucune écriture.
      return { ok: false, step: "from", reason: "ambiguous" };
    }
    const resolved = resolveFootnoteTransfer(fromMatch.matchedText, fromContent, toContent);
    movedText = resolved.text;
    workingFromContent = resolved.fromContent;
    workingToContent = resolved.toContent;
  }

  const delResult = planApply(workingFromContent, {
    type: "deletion",
    contextBefore: moveChange.fromContext,
    text: moveChange.fromText,
    oldText: "",
    newText: "",
    fromContext: "",
    fromText: "",
    toContext: "",
    /* Réutilisé ici pour DÉCLENCHER collapseBoundaryBreak côté origine (voir
       planApply, branche "deletion") — sans conséquence si le déplacement
       n'était PAS un paragraphe entier des deux côtés : collapseBoundaryBreak
       ne modifie rien tant qu'aucun \n{3,} réel n'apparaît pile à la
       frontière de coupe (voir sa définition), donc jamais un risque
       d'écraser une mise en page volontaire du fichier d'origine. */
    destinationBoundary: moveChange.destinationBoundary,
  });
  if (!delResult.ok) return { ok: false, step: "from", reason: delResult.reason };

  const insResult = planApply(workingToContent, {
    type: "insertion",
    contextBefore: moveChange.toContext,
    text: movedText,
    oldText: "",
    newText: "",
    fromContext: "",
    fromText: "",
    toContext: "",
    destinationBoundary: moveChange.destinationBoundary,
  });
  if (!insResult.ok) return { ok: false, step: "to", reason: insResult.reason };

  // Vérification avant écriture (Lot 1) : jamais une structure cassée dans
  // l'un OU l'autre fichier — les DEUX résultats sont déjà calculés à ce
  // stade, rien n'est encore écrit si l'un des deux échoue ce contrôle.
  if (!verifyNoBrokenStructure(workingFromContent, delResult.newContent)) {
    return { ok: false, step: "from", reason: "ambiguous" };
  }
  if (!verifyNoBrokenStructure(workingToContent, insResult.newContent)) {
    return { ok: false, step: "to", reason: "ambiguous" };
  }

  /* Écriture transactionnelle (Lot 3, sécurité multi-feuillets) : jusqu'ici
     rien n'a été écrit — tout est calculé et vérifié en mémoire. À partir
     de cette ligne, soit LES DEUX feuillets finissent modifiés ET relus à
     l'identique de ce qui vient d'être écrit, soit AUCUN des deux ne
     l'est : jamais fromFile vidé sans que toFile ait reçu le texte (ou
     l'inverse). La relecture après chaque écriture protège contre un
     adaptateur de coffre qui rapporterait un succès sans avoir vraiment
     persisté (ex. un plugin de synchronisation qui intercepte l'écriture) —
     un cas que `vault.modify` seul, sans exception, ne détecterait pas.
     Toute écriture OU relecture en échec restaure IMMÉDIATEMENT chaque
     fichier déjà touché à son contenu d'origine (fromContent/toContent, lus
     tout en haut de cette fonction, jamais les versions "working"
     retravaillées par resolveFootnoteTransfer) — dans l'ordre inverse de
     l'écriture. La restauration elle-même reste best-effort (comme le
     snapshot, voir docx-review-view.js#ensureSnapshot) : SI elle échoue à
     son tour, ce n'est PLUS un simple "write-failed" — l'appelant ne doit
     jamais croire l'état initial garanti retrouvé. `reason` devient
     "rollback-failed" : à l'UI d'avertir explicitement que la restauration
     automatique n'a pas pu être garantie et que les snapshots doivent être
     utilisés pour vérifier/récupérer les feuillets concernés à la main. */
  let fromWritten = false;
  let toWritten = false;
  let failedStep: "from" | "to" = "from";
  try {
    await vault.modify(fromFile, delResult.newContent);
    fromWritten = true;
    const fromCheck = await vault.read(fromFile);
    if (fromCheck !== delResult.newContent) {
      throw new Error("post-write verification failed (fromFile)");
    }

    failedStep = "to";
    await vault.modify(toFile, insResult.newContent);
    toWritten = true;
    const toCheck = await vault.read(toFile);
    if (toCheck !== insResult.newContent) {
      throw new Error("post-write verification failed (toFile)");
    }
  } catch {
    let restoreFailed = false;
    if (toWritten) {
      try {
        await vault.modify(toFile, toContent);
      } catch {
        restoreFailed = true;
      }
    }
    if (fromWritten) {
      try {
        await vault.modify(fromFile, fromContent);
      } catch {
        restoreFailed = true;
      }
    }
    return { ok: false, step: failedStep, reason: restoreFailed ? "rollback-failed" : "write-failed" };
  }

  return { ok: true, insertedRange: insResult.insertedRange };
}
