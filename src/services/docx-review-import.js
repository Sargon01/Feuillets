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

const CONTEXT_CHARS = 40;

function emptyBucket() {
  return { changes: [], comments: [] };
}

/** `word/commentsExtended.xml` (Word moderne) -> { [w15:paraId]: { done,
 * paraIdParent } }. Porte l'état "résolu" (w15:done="1", posé quand
 * l'éditeur coche « Marquer comme résolu » dans Word) et le lien de réponse
 * (w15:paraIdParent -> le paraId du commentaire parent). Le lien vers un
 * commentaire concret se fait via le w14:paraId partagé avec comments.xml
 * (voir parseCommentsXml). Fichier absent des .docx anciens : dégradation
 * silencieuse (aucun état résolu, aucun fil), jamais une erreur. */
export function parseCommentsExtended(commentsExtendedXml) {
  const byParaId = {};
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
export function parseCommentsXml(commentsXml, extendedByParaId = {}) {
  const byId = {};
  if (!commentsXml) return byId;
  const paraIdToId = {}; // w14:paraId -> w:id du commentaire (pour résoudre paraIdParent -> id parent)
  const collected = []; // { id, paraIds } pour la 2e passe (parent/résolu)
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
function trimContextBefore(text) {
  return text.length > CONTEXT_CHARS ? text.slice(-CONTEXT_CHARS) : text;
}

/** Enveloppe `text` dans les marqueurs Markdown gras/italique, en gardant
 * les espaces de tête/fin HORS des marqueurs (Markdown refuse une emphase
 * qui commence/finit par une espace : "** mot**" n'est pas du gras). Rend
 * le texte inchangé si aucun format ou si le cœur est vide. */
function wrapEmphasis(text, bold, italic) {
  if (!text || (!bold && !italic)) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const lead = m[1], core = m[2], trail = m[3];
  if (!core) return text;
  const open = (bold ? "**" : "") + (italic ? "*" : "");
  const close = (italic ? "*" : "") + (bold ? "**" : "");
  return lead + open + core + close + trail;
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
 * avant w:commentRangeEnd). */
export function parseDocumentXml(documentXml, commentsById = {}) {
  const scenes = {};
  const unclassified = emptyBucket();
  const bucketFor = (bookmarkId) => {
    if (!bookmarkId) return unclassified;
    if (!scenes[bookmarkId]) scenes[bookmarkId] = emptyBucket();
    return scenes[bookmarkId];
  };

  const xml = documentXml || "";
  const tags = walkTags(xml);

  let currentBookmarkId = null; // signet de feuillet en cours (nom, pas w:id)
  const bookmarkNameById = new Map(); // w:id numérique -> nom (pour retrouver quel signet ferme un w:bookmarkEnd)
  let lastClosedBookmarkId = null; // dernier signet refermé — scène candidate "avant" pour un orphelin posé à la frontière
  let pendingOrphans = []; // éléments poussés dans unclassified en attendant de connaître leur scène candidate "après"
  let currentMoveName = null; // nom de déplacement en cours (partagé origine/destination)
  const moveRangeNameById = new Map(); // w:id numérique -> nom (pour retrouver quel déplacement ferme un w:move{From,To}RangeEnd)
  let insInfo = null; // { author, date, buffer, contextBefore } pendant un w:ins
  let delInfo = null; // idem pour w:del
  const openComments = new Map(); // w:id -> texte d'ancrage accumulé
  /* w:footnoteReference w:id="N" (appel de note dans le corps) -> le signet
     de feuillet où il apparaît. C'est le SEUL lien entre une note et son
     feuillet : word/footnotes.xml, lui, ne porte aucun signet — sans cette
     table, une correction faite par le relecteur À L'INTÉRIEUR d'une note
     (donc dans footnotes.xml) ne saurait pas dans quel feuillet l'appliquer.
     Voir parseFootnotesXml + parseDocxReview. */
  const footnoteOwners = {};

  /* Appelé juste après avoir poussé un élément dans `unclassified` (jamais
     dans une scène reconnue) : y attache les deux scènes candidates de
     part et d'autre de la frontière où il est tombé — `nextScene` reste
     null ici, rempli plus tard par bookmarkStart dès que la prochaine
     scène s'ouvre (voir plus haut). */
  const trackOrphan = (obj) => {
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

  /* Une mise en forme ajoutée en suivi des modifications (barrer/souligner/
     surligner/mettre en gras un mot pour attirer l'attention, SANS le
     supprimer ni le remplacer) passe par w:rPrChange — un mécanisme
     ENTIÈREMENT différent de w:ins/w:del, jamais reconnu jusqu'ici :
     confirmé sur un vrai retour où un mot barré ainsi n'apparaissait dans
     aucun résultat. Capturé comme un commentaire informatif (pas de sens
     à "Appliquer" une mise en forme dans du markdown source) plutôt que
     silencieusement ignoré. */
  const FORMAT_MARKER_TAGS = new Set(["w:b", "w:i", "w:u", "w:strike", "w:highlight"]);
  const FORMAT_LABELS = { "w:b": "gras", "w:i": "italique", "w:u": "souligné", "w:strike": "barré", "w:highlight": "surligné" };
  let formatMarkers = null; // accumulé pendant qu'on est DANS un <w:rPr>, hors de tout <w:rPrChange> imbriqué
  let insideRPrChange = false;
  let pendingFormatChange = null; // { author, date, markers } capturé à la fermeture de w:rPrChange, consommé par le prochain w:t
  /* Format gras/italique du run EN COURS — sert à conserver la mise en forme
     d'un texte INSÉRÉ par le relecteur (w:ins) : sans ça, un mot ajouté en
     gras/italique dans Word arrivait en texte brut (audit #1). Réinitialisé
     à chaque <w:r> (un run sans <w:rPr> est du texte sans format). */
  let runBold = false;
  let runItalic = false;

  const appendText = (raw) => {
    const isInserted = !!insInfo; // dans un w:ins/w:moveTo actif : pas encore dans la source
    if (pendingParaBreak) {
      pendingParaBreak = false;
      if (!isInserted) runningText += "\n\n";
      if (insInfo) insInfo.buffer += "\n\n";
      if (delInfo) delInfo.buffer += "\n\n";
      for (const id of openComments.keys()) openComments.set(id, openComments.get(id) + "\n\n");
    }
    if (!isInserted) runningText += raw;
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
      currentBookmarkId = name || currentBookmarkId;
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
        contextBefore: runningText,
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
        const entry = {
          type: "insertion",
          text,
          author: insInfo.author,
          date: insInfo.date,
          contextBefore: trimContextBefore(insInfo.contextBefore),
          moved: insInfo.moved,
          moveName: insInfo.moveName,
        };
        trackOrphan(entry);
        bucketFor(currentBookmarkId).changes.push(entry);
      }
      insInfo = null;
      continue;
    }
    if ((t.name === "w:del" || t.name === "w:moveFrom") && !t.isClose && !t.selfClosing) {
      delInfo = {
        author: getAttr(t.attrs, "w:author") || "Inconnu",
        date: getAttr(t.attrs, "w:date") || "",
        buffer: "",
        contextBefore: runningText,
        moved: t.name === "w:moveFrom",
        moveName: currentMoveName,
      };
      continue;
    }
    if ((t.name === "w:del" || t.name === "w:moveFrom") && t.isClose) {
      if (delInfo && delInfo.buffer.length > 0) {
        const entry = {
          type: "deletion",
          text: delInfo.buffer,
          author: delInfo.author,
          date: delInfo.date,
          contextBefore: trimContextBefore(delInfo.contextBefore),
          moved: delInfo.moved,
          moveName: delInfo.moveName,
        };
        trackOrphan(entry);
        bucketFor(currentBookmarkId).changes.push(entry);
      }
      delInfo = null;
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
      pendingFormatChange = {
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
      if (pendingFormatChange && pendingFormatChange.markers.length > 0 && raw.trim()) {
        const markers = [...new Set(pendingFormatChange.markers)];
        const labels = markers.map((m) => FORMAT_LABELS[m]).filter(Boolean);
        const entry = {
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
        bucketFor(currentBookmarkId).comments.push(entry);
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
      continue;
    }
    if (t.name === "w:commentRangeStart" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id) openComments.set(id, "");
      continue;
    }
    if (t.name === "w:commentRangeEnd" && t.selfClosing) {
      const id = getAttr(t.attrs, "w:id");
      if (id && openComments.has(id)) {
        const anchorText = openComments.get(id).trim();
        openComments.delete(id);
        const comment = commentsById[id];
        if (comment) {
          const entry = {
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
          trackOrphan(entry);
          bucketFor(currentBookmarkId).comments.push(entry);
        }
      }
      continue;
    }
  }

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
  const stamp = (obj) => {
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
function parseFootnoteBody(body, commentsById) {
  const changes = [];
  const comments = [];
  const tags = walkTags(body);
  let runningText = "";
  let insInfo = null;
  let delInfo = null;
  const openComments = new Map();
  let pendingParaBreak = false;
  let sawParagraph = false;

  const append = (raw) => {
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
      insInfo = { author: getAttr(t.attrs, "w:author") || "Inconnu", date: getAttr(t.attrs, "w:date") || "", buffer: "", contextBefore: runningText };
      continue;
    }
    if (t.name === "w:ins" && t.isClose) {
      if (insInfo && insInfo.buffer.length > 0) {
        changes.push({ type: "insertion", text: insInfo.buffer, author: insInfo.author, date: insInfo.date, contextBefore: trimContextBefore(insInfo.contextBefore), moved: false, moveName: null });
      }
      insInfo = null;
      continue;
    }
    if (t.name === "w:del" && !t.isClose && !t.selfClosing) {
      delInfo = { author: getAttr(t.attrs, "w:author") || "Inconnu", date: getAttr(t.attrs, "w:date") || "", buffer: "", contextBefore: runningText };
      continue;
    }
    if (t.name === "w:del" && t.isClose) {
      if (delInfo && delInfo.buffer.length > 0) {
        changes.push({ type: "deletion", text: delInfo.buffer, author: delInfo.author, date: delInfo.date, contextBefore: trimContextBefore(delInfo.contextBefore), moved: false, moveName: null });
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
        const anchorText = openComments.get(id).trim();
        openComments.delete(id);
        const comment = commentsById[id];
        if (comment) {
          const c = { anchorText, text: comment.text, author: comment.author, date: comment.date };
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
export function parseFootnotesXml(footnotesXml, commentsById = {}) {
  const byId = {};
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
function mergeMovePairs(changes) {
  const byMoveName = new Map();
  for (const c of changes) {
    if (c.moved && c.moveName) {
      if (!byMoveName.has(c.moveName)) byMoveName.set(c.moveName, []);
      byMoveName.get(c.moveName).push(c);
    }
  }
  const consumed = new Set();
  const merged = [];
  for (const c of changes) {
    if (consumed.has(c)) continue;
    if (c.moved && c.moveName) {
      const group = byMoveName.get(c.moveName);
      const del = group.find((g) => g.type === "deletion");
      const ins = group.find((g) => g.type === "insertion");
      if (del && ins && group.length === 2) {
        consumed.add(del);
        consumed.add(ins);
        merged.push({
          type: "move",
          text: ins.text,
          author: ins.author,
          date: ins.date,
          fromContext: del.contextBefore,
          fromText: del.text,
          toContext: ins.contextBefore,
        });
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
export function mergeGlobalMovePairs(byPath, unmatched = {}, unclassified = {}) {
  const allContainers = [];

  for (const [path, bucket] of Object.entries(byPath)) {
    if (bucket && bucket.changes) {
      allContainers.push({ path, list: bucket.changes });
    }
  }
  for (const [id, bucket] of Object.entries(unmatched)) {
    if (bucket && bucket.changes) {
      allContainers.push({ path: null, list: bucket.changes });
    }
  }
  if (unclassified && unclassified.changes) {
    allContainers.push({ path: null, list: unclassified.changes });
  }

  const byMoveName = new Map();
  for (const container of allContainers) {
    for (const c of container.list) {
      if (c.moved && c.moveName && c.type !== "move") {
        if (!byMoveName.has(c.moveName)) byMoveName.set(c.moveName, []);
        byMoveName.get(c.moveName).push({ container, change: c });
      }
    }
  }

  for (const [moveName, items] of byMoveName.entries()) {
    const delItem = items.find((i) => i.change.type === "deletion");
    const insItem = items.find((i) => i.change.type === "insertion");
    if (delItem && insItem && items.length === 2) {
      const delIndex = delItem.container.list.indexOf(delItem.change);
      if (delIndex !== -1) delItem.container.list.splice(delIndex, 1);

      const insIndex = insItem.container.list.indexOf(insItem.change);
      if (insIndex !== -1) insItem.container.list.splice(insIndex, 1);

      const del = delItem.change;
      const ins = insItem.change;

      const mergedMove = {
        type: "move",
        text: ins.text,
        author: ins.author || del.author,
        date: ins.date || del.date,
        fromContext: del.contextBefore,
        fromText: del.text,
        toContext: ins.contextBefore,
        fromPath: delItem.container.path || null,
        toPath: insItem.container.path || null,
        moved: true,
        moveName,
        nearFiles: [
          ...new Set([
            ...(del.nearFiles || []),
            ...(ins.nearFiles || []),
            ...(delItem.container.path ? [delItem.container.path] : []),
            ...(insItem.container.path ? [insItem.container.path] : []),
          ]),
        ],
      };

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
function isChainAdjacent(chain, last, next) {
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
function mergeAdjacentReplacements(changes) {
  const merged = [];
  let i = 0;
  while (i < changes.length) {
    const cur = changes[i];
    if ((cur.type !== "deletion" && cur.type !== "insertion") || cur.moved) {
      merged.push(cur);
      i++;
      continue;
    }
    const chain = [cur];
    let j = i + 1;
    while (j < changes.length && isChainAdjacent(chain, chain[chain.length - 1], changes[j])) {
      chain.push(changes[j]);
      j++;
    }
    if (chain.length > 1) {
      merged.push({
        type: "replacement",
        oldText: chain.filter((c) => c.type === "deletion").map((c) => c.text).join(""),
        newText: chain.filter((c) => c.type === "insertion").map((c) => c.text).join(""),
        author: chain[0].author,
        date: chain[0].date,
        contextBefore: chain[0].contextBefore,
        moved: false,
      });
    } else {
      merged.push(cur);
    }
    i = j; // j == i+1 si la chaîne n'a pas grandi, sinon la fin de la chaîne consommée
  }
  return merged;
}

/** Point d'entrée complet : docx déjà décompressé en { "word/document.xml":
 * string, "word/comments.xml": string|undefined, "word/footnotes.xml":
 * string|undefined } (voir views/docx-review-view.js pour l'appel réel via
 * jszip — séparé ici pour rester une fonction pure, testable sans dépendance
 * à jszip ni à l'environnement Obsidian). Les retours trouvés DANS une note
 * de bas de page (footnotes.xml) sont rattachés au feuillet où l'appel de
 * note apparaît (footnoteOwners, voir parseDocumentXml) — ou à unclassified
 * si l'appel n'est dans aucun signet reconnu. */
export function parseDocxReview(files) {
  const extendedByParaId = parseCommentsExtended(files["word/commentsExtended.xml"] || "");
  const commentsById = parseCommentsXml(files["word/comments.xml"] || "", extendedByParaId);
  const { scenes, unclassified, footnoteOwners } = parseDocumentXml(files["word/document.xml"] || "", commentsById);

  const footnoteBuckets = parseFootnotesXml(files["word/footnotes.xml"] || "", commentsById);
  for (const [fnId, bucket] of Object.entries(footnoteBuckets)) {
    const owner = footnoteOwners[fnId] || null;
    let target;
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
export function resolveScenesToPaths(scenes, currentPaths) {
  const idToPath = new Map(currentPaths.map((p) => [bookmarkIdFor(p), p]));
  const byPath = {};
  const unmatched = {};
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
function toleranceGroup(text) {
  let pattern = "";
  let i = 0;
  const MD = "[*_~=]*";

  while (i < text.length) {
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

function getFrontmatterEndOffset(content) {
  if (!content) return 0;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? match[0].length : 0;
}

function countRegexMatches(re, content) {
  const bodyStart = getFrontmatterEndOffset(content);
  let count = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(content))) {
    if (m.index >= bodyStart) count++;
  }
  return count;
}

function findSingleRegexMatch(re, content) {
  const bodyStart = getFrontmatterEndOffset(content);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(content))) {
    if (m.index >= bodyStart) return m;
  }
  return null;
}

function getContextCandidates(contextText) {
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

/** Un "move" demande DEUX modifications distinctes du même feuillet —
 * retirer le texte à son origine, l'ajouter à sa destination — jamais
 * superposées. Recherche tolérante avec dégradation progressive du contexte
 * pour résister aux édits multiples dans la même phrase ou au découpage dans
 * le même paragraphe. */
function planApplyMove(content, change) {
  if (change.fromContext === undefined || change.toContext === undefined) return { ok: false, reason: "no-context" };

  let toMatch = null;
  if (change.toContext === "") {
    const bodyStart = getFrontmatterEndOffset(content);
    toMatch = { index: bodyStart, length: 0, 0: "" };
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
  }
  if (!toMatch) return { ok: false, reason: "not-found" };

  const bodyStart = getFrontmatterEndOffset(content);
  const insertAt = Math.max(bodyStart, toMatch.index + toMatch[0].length);

  let fromMatch = null;
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

  if (fromMatch && fromMatch.index >= bodyStart) {
    const rawFromText = usedFromCtx
      ? content.slice(fromMatch.index + (fromMatch[1] ? fromMatch[1].length : 0), fromMatch.index + fromMatch[0].length)
      : fromMatch[0];
    const textToInsert = rawFromText || change.text;

    const edits = [
      { start: insertAt, end: insertAt, replacement: textToInsert },
      usedFromCtx
        ? { start: fromMatch.index, end: fromMatch.index + fromMatch[0].length, replacement: fromMatch[1] }
        : { start: fromMatch.index, end: fromMatch.index + fromMatch[0].length, replacement: "" },
    ].sort((a, b) => b.start - a.start);

    let result = content;
    for (const e of edits) {
      result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
    }
    return { ok: true, newContent: result };
  } else {
    // Si fromText est encore présent dans le fichier mais n'a pas pu être localisé de façon sûre (ex. ambiguïté), ne pas dupliquer sans couper !
    const rawFromRe = new RegExp(toleranceGroup(change.fromText), "g");
    const rawFromCount = countRegexMatches(rawFromRe, content);
    if (rawFromCount > 0) {
      return { ok: false, reason: rawFromCount > 1 ? "ambiguous" : "not-found" };
    }
    // Si fromText n'est plus dans le fichier (déjà coupé par un edit préalable), appliquer l'insertion seule
    return { ok: true, newContent: content.slice(0, insertAt) + change.text + content.slice(insertAt) };
  }
}

/** Calcule le nouveau contenu d'un feuillet SI `change` devait y être appliqué.
 * Utilise une recherche à dégradation progressive de contexte pour permettre
 * l'application successive de plusieurs modifications dans la même phrase ou
 * paragraphe sans être bloqué par la modification du contexte voisin. */
export function planApply(content, change) {
  if (!change) return { ok: false, reason: "no-context" };
  if (change.type === "move") return planApplyMove(content, change);
  if (change.contextBefore === undefined && !change.text && !change.oldText) return { ok: false, reason: "no-context" };

  let sawAmbiguous = false;

  if (change.type === "insertion") {
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
          return { ok: true, newContent: content.slice(0, insertAt) + change.text + content.slice(insertAt) };
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
        if (ctx) {
          return { ok: true, newContent: content.slice(0, m.index) + m[1] + content.slice(m.index + m[0].length) };
        } else {
          return { ok: true, newContent: content.slice(0, m.index) + content.slice(m.index + m[0].length) };
        }
      }
    }
  }
  return { ok: false, reason: sawAmbiguous ? "ambiguous" : "not-found" };
}

/** Cherche `text` (tolérance typographique, voir toleranceGroup) dans
 * `content` avec dégradation progressive du contexte en cas de modifs
 * successives dans la même zone. */
export function findTolerant(content, text) {
  if (!text) return null;
  const bodyStart = getFrontmatterEndOffset(content);
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

/** Le texte à retrouver dans un feuillet pour UN changement donné — même
 * construction que ce que planApply cherche à modifier, réutilisée à la
 * fois pour "Ouvrir le feuillet" (voir docx-review-view.js) et pour
 * résoudre un orphelin de frontière (voir resolveOrphans) : les deux
 * doivent toujours pointer sur exactement ce qu'Appliquer manipulerait. */
export function searchTextForChange(change) {
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
export async function resolveOrphans(unclassified, idToPath, readContent) {
  const relocated = {}; // path -> { changes: [], comments: [] }

  const resolveList = async (list, isComment) => {
    const stillUnresolved = [];
    for (const item of list) {
      const candidates = [...new Set([item.prevScene, item.nextScene].filter(Boolean).map((id) => idToPath.get(id)).filter(Boolean))];
      const searchText = isComment ? item.anchorText : searchTextForChange(item);
      const matches = [];
      for (const path of candidates) {
        const content = await readContent(path);
        if (content != null && findTolerant(content, searchText)) matches.push(path);
      }
      if (matches.length === 1) {
        if (!relocated[matches[0]]) relocated[matches[0]] = { changes: [], comments: [] };
        relocated[matches[0]][isComment ? "comments" : "changes"].push(item);
      } else {
        item.nearFiles = candidates;
        stillUnresolved.push(item);
      }
    }
    return stillUnresolved;
  };

  unclassified.changes = await resolveList(unclassified.changes, false);
  unclassified.comments = await resolveList(unclassified.comments, true);
  return relocated;
}

/** Applique un déplacement de texte inter-feuillets : supprime le texte
 * à l'origine (fromFile) et l'insère à la destination (toFile). */
export async function planApplyInterFile(vault, fromFile, toFile, moveChange) {
  const fromContent = await vault.read(fromFile);
  const toContent = await vault.read(toFile);

  const delResult = planApply(fromContent, {
    type: "deletion",
    contextBefore: moveChange.fromContext,
    text: moveChange.fromText,
  });
  if (!delResult.ok) return { ok: false, step: "from", reason: delResult.reason };

  const insResult = planApply(toContent, {
    type: "insertion",
    contextBefore: moveChange.toContext,
    text: moveChange.text,
  });
  if (!insResult.ok) return { ok: false, step: "to", reason: insResult.reason };

  await vault.modify(fromFile, delResult.newContent);
  await vault.modify(toFile, insResult.newContent);
  return { ok: true };
}
