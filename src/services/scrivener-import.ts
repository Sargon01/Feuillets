/** Import d'un projet Scrivener (.scriv) dans Feuillets — fonctions pures. */

import { PROJECT_MODES, CANONICAL_RESEARCH_LABELS } from "../utils/project-modes.js";
import { extractTag, extractAllTags, getAttr, decodeXmlEntities } from "../utils/xml.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";

export { extractTag, extractAllTags, getAttr, decodeXmlEntities };

type AttachedImage = { fileName: string; fullPath: string; ext: string };
/** Une métadonnée personnalisée Scrivener (CustomMetaData), conservée telle
 * quelle — voir §4 du chantier S2. Toujours un TABLEAU, jamais
 * Record<string,string> : deux champs peuvent porter le même nom, aucune
 * valeur ne doit en écraser une autre, et l'ordre Scrivener est préservé. */
export type ScrivenerCustomMetadata = {
  id: string;
  name: string;
  value: string;
};
type ScrivenerNode = {
  uuid: string;
  xmlType: string;
  isFolder: boolean;
  isImage: boolean;
  title: string;
  synopsis: string;
  labelTitle: string;
  statusTitle: string;
  includeInCompile: boolean;
  wordGoal: number;
  keywords: string[];
  /** Métadonnées personnalisées Scrivener, jamais aplaties dans `keywords`
   * (sauf règle explicite Tags/Keywords, voir §5 du chantier S2) — conservées
   * intégralement pour tous les nœuds, pas seulement les scènes (§7). */
  customMetadata: ScrivenerCustomMetadata[];
  children: ScrivenerNode[];
};
type ParsedScrivx = {
  projectTitle: string;
  draft: ScrivenerNode | null;
  research: ScrivenerNode | null;
  trash: ScrivenerNode | null;
  others: ScrivenerNode[];
};
type ScrImageLink = { rawRef: string; fileName: string; fullMatch: string };
type ScrivenerComment = { rtf: string; isFootnote: boolean };
type RtfOptions = { prefix?: string; uuid?: string };
type ExtractedImage = { name: string; bytes: Uint8Array; ext: string };
type ExtractedComment = { word: string; text: string };
type RtfResult = {
  text: string;
  footnotes: string[];
  chapterTitle?: string;
  sousTitre?: string;
  extractedImages?: ExtractedImage[];
  extractedComments?: ExtractedComment[];
  imageLinks?: ScrImageLink[];
  /** Nombre de scrivlink://UUID rencontrés dont l'UUID est absent du plan
   * d'import (référence vers la Corbeille, ou UUID orphelin) — compté pour
   * un futur rapport d'import (§5/§10 du chantier S1) plutôt que
   * silencieusement ignoré. Jamais un lien inventé à la place. */
  unresolvedLinkCount?: number;
};

type NodeFs = {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
};

type NodePath = {
  join(...paths: string[]): string;
  extname(p: string): string;
};

// ============================ Garde-fou de format ==========================

export function checkScrivenerFormat(entries: string[]) {
  if (entries.includes("binder.scrivproj")) {
    return {
      ok: false,
      error: t("modal.scrivenerImport.legacyFormat"),
    };
  }
  const scrivxName = entries.find((f) => f.toLowerCase().endsWith(".scrivx"));
  if (!scrivxName) {
    return { ok: false, error: t("modal.scrivenerImport.noScrivxFound") };
  }
  return { ok: true, scrivxName };
}

export function rtfPathCandidates(uuid: string): string[] {
  return [`Files/Data/${uuid}/content.rtf`, `Files/Docs/${uuid}.rtf`];
}

export function findAttachedDataImages(scrivPath: string, uuid: string, fs: NodeFs | null, pathMod: NodePath | null) {
  const images: AttachedImage[] = [];
  if (!uuid || !fs || !pathMod) return images;
  const imgExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"];
  const dirPath = pathMod.join(scrivPath, `Files/Data/${uuid}`);
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const ext = pathMod.extname(file).toLowerCase();
        if (imgExts.includes(ext) && file !== "content.rtf" && file !== "notes.rtf") {
          images.push({
            fileName: file,
            fullPath: pathMod.join(dirPath, file),
            ext,
          });
        }
      }
    }
  } catch { /* dossier .scriv illisible ou partiel : on rend les images deja trouvees plutot que d'echouer l'import */ }

  if (images.length === 0) {
    try {
      const docsDir = pathMod.join(scrivPath, "Files/Docs");
      if (fs.existsSync(docsDir)) {
        for (const ext of imgExts) {
          const candidate = pathMod.join(docsDir, `${uuid}${ext}`);
          if (fs.existsSync(candidate)) {
            images.push({
              fileName: `${uuid}${ext}`,
              fullPath: candidate,
              ext,
            });
            break;
          }
        }
      }
    } catch { /* idem pour le balayage des chemins candidats d'un uuid */ }
  }
  return images;
}

// ============================ Parseur du binder =============================

function parseListItems(xml: string | null | undefined) {
  const map = new Map<string, string>();
  if (!xml) return map;

  const reS3 = /<(?:Label|Status)\b([^>]*)>([\s\S]*?)<\/(?:Label|Status)>/g;
  let m: RegExpExecArray | null;
  while ((m = reS3.exec(xml))) {
    const [, attrs, body] = m;
    const idMatch = /\bID="([^"]*)"/.exec(attrs);
    if (idMatch) {
      const titleMatch = /<Title>([\s\S]*?)<\/Title>/.exec(body);
      const title = titleMatch ? titleMatch[1] : body.replace(/<[^>]+>/g, "");
      map.set(idMatch[1], decodeXmlEntities(title).trim());
    }
  }

  for (const { attrs } of extractAllTags(xml, "ListItem")) {
    const id = getAttr(attrs, "ID");
    const name = getAttr(attrs, "Name");
    if (id && !map.has(id)) map.set(id, decodeXmlEntities(name).trim());
  }

  return map;
}

function parseKeywordSettings(xmlContent: string | null | undefined) {
  const map = new Map<string, string>();
  if (!xmlContent) return map;
  const nonBinderXml = xmlContent.replace(/<Binder\b[\s\S]*?<\/Binder>/gi, "");
  const kwSettings =
    extractTag(nonBinderXml, "KeywordsSettings") ||
    extractTag(nonBinderXml, "KeywordSettings");
  const targetXml = kwSettings || extractTag(nonBinderXml, "Keywords") || nonBinderXml;
  if (!targetXml) return map;

  const walk = (xml: string) => {
    const items = extractAllTags(xml, "Keyword");
    for (const item of items) {
      const id = getAttr(item.attrs, "ID") || getAttr(item.attrs, "id");
      const title = extractTag(item.body, "Title");
      if (id && title) {
        map.set(String(id).trim(), decodeXmlEntities(title).trim());
      }
      walk(item.body);
    }
  };
  walk(targetXml);
  return map;
}

function parseCustomMetaDataSettings(xmlContent: string | null | undefined) {
  const map = new Map<string, string>();
  if (!xmlContent) return map;
  const metaSettings =
    extractTag(xmlContent, "MetaDataSettings") ||
    extractTag(xmlContent, "CustomMetaDataSettings") ||
    xmlContent;
  if (!metaSettings) return map;

  const walk = (xml: string) => {
    const items = extractAllTags(xml, "MetaDataField");
    for (const item of items) {
      const id = getAttr(item.attrs, "ID") || getAttr(item.attrs, "id");
      const title = extractTag(item.body, "Title") || extractTag(item.body, "Name") || id;
      if (id && title) {
        map.set(String(id).trim(), decodeXmlEntities(title).trim());
      }
      walk(item.body);
    }
  };
  walk(metaSettings);
  return map;
}

/** Normalise un nom/FieldID de métadonnée pour la comparaison Tags/Keywords
 * (§5 du chantier S2) : insensible à la casse, aux accents et aux
 * espaces/tirets/soulignés usuels — "Mots-Clés", "mots clés" et "MOTS_CLES"
 * doivent tous être reconnus. */
function normalizeMetaFieldKey(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

const TAG_FIELD_KEYS = new Set(["tag", "tags", "keyword", "keywords", "motcle", "motscles"]);

/** Un champ personnalisé alimente les keywords Feuillets UNIQUEMENT si son
 * nom résolu OU son FieldID brut désigne explicitement un champ de tags —
 * jamais parce que sa valeur contient une virgule, un "#" ou plusieurs mots
 * (voir §5 : "Lieu = Paris, France" ne doit jamais devenir un tag). */
function isTagFieldName(name: string | null | undefined, fieldId: string | null | undefined): boolean {
  return TAG_FIELD_KEYS.has(normalizeMetaFieldKey(name)) || TAG_FIELD_KEYS.has(normalizeMetaFieldKey(fieldId));
}

function parseBinderItem(
  attrs: string,
  body: string,
  labelTitles: Map<string, string>,
  statusTitles: Map<string, string>,
  keywordTitles: Map<string, string>,
  customMetaTitles: Map<string, string>
): ScrivenerNode {
  const uuid = getAttr(attrs, "UUID") || getAttr(attrs, "ID") || "";
  const xmlType = getAttr(attrs, "Type") || "Text";
  const title = decodeXmlEntities(extractTag(body, "Title")) || "Sans titre";

  const metaXml = extractTag(body, "MetaData") || body;
  const synopsis = decodeXmlEntities(extractTag(metaXml, "Synopsis"));
  const labelId = extractTag(metaXml, "LabelID");
  const statusId = extractTag(metaXml, "StatusID");
  const includeRaw = extractTag(metaXml, "IncludeInCompile");
  const includeInCompile = includeRaw ? includeRaw.trim().toLowerCase() !== "no" : true;

  const targetXml = extractTag(body, "Target") || extractTag(metaXml, "Target");
  let wordGoal = 0;
  if (targetXml) {
    const val = parseInt(targetXml.replace(/<[^>]+>/g, "").trim(), 10);
    if (!isNaN(val) && val > 0) {
      wordGoal = val;
    }
  }

  const keywordsXml = extractTag(metaXml, "Keywords") || extractTag(body, "Keywords");
  const keywords: string[] = [];
  if (keywordsXml) {
    const kwIdTags = extractAllTags(keywordsXml, "KeywordID");
    for (const k of kwIdTags) {
      const id = k.body.trim() || getAttr(k.attrs, "ID") || getAttr(k.attrs, "id");
      const kwTitle = keywordTitles ? keywordTitles.get(id) : null;
      const val = kwTitle || (id && !/^\d+$/.test(id) ? id : null);
      if (val && !keywords.includes(val)) {
        keywords.push(val);
      }
    }
    const kwTags = extractAllTags(keywordsXml, "Keyword");
    for (const k of kwTags) {
      const id = getAttr(k.attrs, "ID") || getAttr(k.attrs, "id") || k.body.trim();
      const titleTag = extractTag(k.body, "Title");
      const kwTitle = (keywordTitles && id) ? keywordTitles.get(id) : null;
      const val = titleTag || kwTitle || (id && !/^\d+$/.test(id) ? id : null);
      if (val && !keywords.includes(val)) {
        keywords.push(val);
      }
    }
    const stringTags = extractAllTags(keywordsXml, "string").map((k) => decodeXmlEntities(k.body).trim());
    for (const s of stringTags) {
      if (s && !keywords.includes(s)) {
        keywords.push(s);
      }
    }
  }

  /* CustomMetaData (§4/§5 du chantier S2) : conservée intégralement dans
   * `customMetadata` (jamais aplatie dans `keywords` par défaut — l'ancien
   * comportement qui coupait sur "," ou "#" produisait des faux tags pour
   * des champs ordinaires comme "Lieu = Paris, France" ou "Référence = #12").
   * Seul un champ explicitement dédié aux Tags/Keywords (nom OU FieldID,
   * voir isTagFieldName) alimente aussi les keywords Feuillets — la
   * métadonnée reste malgré tout présente dans customMetadata (§5 : "même
   * dans ce cas, la metadata reste AUSSI dans customMetadata"). */
  const customMetadata: ScrivenerCustomMetadata[] = [];
  const customMetaXml = extractTag(metaXml, "CustomMetaData") || extractTag(body, "CustomMetaData");
  if (customMetaXml) {
    const items = extractAllTags(customMetaXml, "MetaDataItem");
    for (const item of items) {
      const fieldId = getAttr(item.attrs, "FieldID") || getAttr(item.attrs, "fieldID") || extractTag(item.body, "FieldID");
      /* Un <Value> VIDE (mais présent) est une valeur vide légitime (§4 :
         "une valeur réellement vide peut être ignorée"), à distinguer d'un
         <Value> carrément ABSENT (repli sur le corps brut de l'item, cas
         Scrivener sans balise dédiée) — sinon un champ vide récupérait par
         erreur le contenu du <FieldID> voisin une fois les balises retirées. */
      const hasValueTag = /<Value\b[^>]*>/.test(item.body);
      const val = hasValueTag ? extractTag(item.body, "Value") : item.body.replace(/<[^>]+>/g, "").trim();
      const fieldTitle = (customMetaTitles && fieldId) ? customMetaTitles.get(fieldId) : null;
      /* Aucun nom connu (pas de CustomMetaDataSettings correspondant) :
         name = FieldID (§4). */
      const cleanTitle = (fieldTitle || fieldId || "").trim();
      const cleanVal = decodeXmlEntities(val).trim();

      if (!cleanVal) continue; // valeur réellement vide : ignorée (§4)

      customMetadata.push({ id: fieldId || cleanTitle, name: cleanTitle, value: cleanVal });

      if (isTagFieldName(cleanTitle, fieldId)) {
        /* Séparateurs de tags acceptés : virgule, point-virgule, retour à
           la ligne — JAMAIS l'espace (§5 : "New York, Guerre froide" doit
           rester deux tags, pas quatre). */
        const parts = cleanVal
          .split(/[,;\n]+/)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of parts) {
          if (!keywords.includes(p)) keywords.push(p);
        }
      }
    }
  }

  const childrenXml = extractTag(body, "Children");
  const children: ScrivenerNode[] = childrenXml
    ? extractAllTags(childrenXml, "BinderItem").map(({ attrs: a2, body: b2 }) =>
        parseBinderItem(a2, b2, labelTitles, statusTitles, keywordTitles, customMetaTitles)
      )
    : [];

  const isFolder =
    xmlType === "Folder" ||
    xmlType === "DraftFolder" ||
    xmlType === "ResearchFolder" ||
    xmlType === "TrashFolder";

  const isImage =
    xmlType === "Image" ||
    xmlType === "PDF" ||
    xmlType === "Media" ||
    /\.(png|jpe?g|gif|svg|webp)$/i.test(title);

  return {
    uuid,
    xmlType,
    isFolder,
    isImage,
    title,
    synopsis,
    labelTitle: labelId ? labelTitles.get(labelId) || "" : "",
    statusTitle: statusId ? statusTitles.get(statusId) || "" : "",
    includeInCompile,
    wordGoal,
    keywords,
    customMetadata,
    children,
  };
}

export function parseScrivx(xmlContent: string): ParsedScrivx {
  const projectTitle = decodeXmlEntities(extractTag(xmlContent, "ProjectTitle")) || t("modal.scrivenerImport.importedProject");
  const labelTitles = parseListItems(extractTag(xmlContent, "LabelSettings"));
  const statusTitles = parseListItems(extractTag(xmlContent, "StatusSettings"));
  const keywordTitles = parseKeywordSettings(xmlContent);
  const customMetaTitles = parseCustomMetaDataSettings(xmlContent);

  const binderXml = extractTag(xmlContent, "Binder");
  const rootItems = extractAllTags(binderXml, "BinderItem").map(({ attrs, body }) =>
    parseBinderItem(attrs, body, labelTitles, statusTitles, keywordTitles, customMetaTitles)
  );

  const draft = rootItems.find((it) => it.xmlType === "DraftFolder") || null;
  const research = rootItems.find((it) => it.xmlType === "ResearchFolder") || null;
  const trash = rootItems.find((it) => it.xmlType === "TrashFolder") || null;
  const others = rootItems.filter((it) => it !== draft && it !== research && it !== trash);

  return { projectTitle, draft, research, trash, others };
}

// ============================ Plan d'import (chemins + collisions) =========

/** Nom de fichier/dossier sûr pour un titre Scrivener — mêmes caractères
 * interdits que le système de fichiers (\ / : * ? " < > |), même repli sur
 * "Sans-titre" que par le passé. Seule source de vérité pour la
 * sanitization : utilisée à la fois par le plan d'import (chemins finaux
 * et résolution de collision, ci-dessous) et par l'écriture
 * (scrivener-import-modal.ts) — jamais une seconde logique de calcul de
 * nom (voir §6 du chantier S1 : un seul moteur pour les chemins). */
export function sanitizeScrivenerTitle(title: string | null | undefined): string {
  const cleaned = (title || "").replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || t("modal.scrivenerImport.untitled");
}

/** Résout une collision de chemin de façon déterministe, par simple
 * réservation en mémoire (`used`) — jamais par une requête au coffre : le
 * plan doit pouvoir se calculer entièrement hors ligne, avant la moindre
 * écriture, pour que les liens internes et l'écriture des fichiers
 * utilisent exactement le même résultat (voir buildScrivenerImportPlan).
 * Même algorithme que l'ancien `unusedPath` de la modale (dernier "." du
 * chemin = séparateur d'extension, suffixe "-2", "-3"…) : pas de
 * changement de convention de nommage sans nécessité. */
export function allocateImportPath(used: Set<string>, basePath: string): string {
  if (!used.has(basePath)) {
    used.add(basePath);
    return basePath;
  }
  const dot = basePath.lastIndexOf(".");
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath;
  const ext = dot > 0 ? basePath.slice(dot) : "";
  let i = 2;
  let candidate = "";
  do {
    candidate = `${stem}-${i}${ext}`;
    i++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function joinImportPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

// ============================ Registre central des ressources (S3) =========

/** Registre central d'allocation de noms pour TOUTES les ressources binaires
 * copiées dans le dossier Assets Feuillets pendant un import Scrivener —
 * voir §4 du chantier S3. Partagé par les trois circuits existants (images
 * RTF extraites, Files/Data/<uuid>, $PROJECT://+$SCRImageLink) pour que deux
 * SOURCES différentes ne se retrouvent jamais avec le même nom de fichier
 * final (collision silencieuse, §3), tout en garantissant qu'une MÊME
 * source référencée plusieurs fois réutilise toujours le même fichier (§6) —
 * jamais une copie par référence. */
export type ScrivenerAssetRegistry = {
  /** sourceKey (voir ci-dessous) -> nom de fichier final déjà attribué. */
  sourceToFinalName: Map<string, string>;
  /** Noms de fichier déjà réservés dans Assets, tous circuits confondus —
   * même mécanique de suffixe déterministe ("-2", "-3"…) que
   * allocateImportPath, appliquée ici à un simple nom de fichier plutôt
   * qu'à un chemin complet (aucun dossier n'intervient dans ce registre). */
  usedNames: Set<string>;
};

export function createAssetRegistry(): ScrivenerAssetRegistry {
  return { sourceToFinalName: new Map(), usedNames: new Set() };
}

export type AssetAllocationResult = {
  /** Nom de fichier réellement à utiliser — dans Assets et dans l'embed
   * Markdown correspondant. */
  finalName: string;
  /** true la toute première fois que cette sourceKey est vue : c'est à ce
   * moment (et seulement celui-là) que l'appelant doit réellement copier
   * les octets et incrémenter son compteur d'assets importés (§19) — une
   * source déjà vue ne doit jamais être recopiée ni recomptée. */
  isNewSource: boolean;
  /** true si `isNewSource` ET que `finalName` diffère du nom souhaité —
   * une collision réelle avec une AUTRE source a forcé un suffixe
   * déterministe (§3/§5) : c'est le signal pour incrémenter
   * assetCollisionsRenamed (§19), jamais déclenché par la simple
   * répétition de la même source. */
  renamed: boolean;
};

/** Alloue (ou réutilise) le nom de fichier final d'une ressource, à partir
 * d'une clé de source STABLE et d'un nom souhaité (§4/§5/§6 du chantier S3).
 *
 * Exemples de sourceKey (voir §4) :
 *   data:<uuid>/<filename>        — Files/Data/<uuid>/...
 *   rtf:<uuid>:<index>             — image \pict extraite du RTF (toujours
 *                                    une source neuve, jamais de doublon
 *                                    voulu — voir §8)
 *   project:<rawRef normalisé>     — $PROJECT:// / $SCRImageLink
 *
 * Le suffixe ("-2", "-3"…) est ajouté AVANT l'extension, via le même
 * algorithme que allocateImportPath (aucune duplication de logique — voir
 * §5 : "photo.jpg -> photo-2.jpg", "archive.final.pdf -> archive.final-2.pdf"). */
export function allocateAssetName(
  registry: ScrivenerAssetRegistry,
  sourceKey: string,
  desiredName: string
): AssetAllocationResult {
  const existing = registry.sourceToFinalName.get(sourceKey);
  if (existing) {
    return { finalName: existing, isNewSource: false, renamed: false };
  }
  const finalName = allocateImportPath(registry.usedNames, desiredName);
  registry.sourceToFinalName.set(sourceKey, finalName);
  return { finalName, isNewSource: true, renamed: finalName !== desiredName };
}

// ============================ Médias non pris en charge (S3) ===============

/** Extensions de ressource déjà prises en charge par l'import — INCHANGÉES
 * depuis avant S3 (voir §14 : "Ne pas ajouter de nouveaux formats en S3"),
 * dupliquées ici uniquement pour la classification (§15), jamais utilisées
 * pour décider quoi copier — ce rôle reste celui de findAttachedDataImages
 * (scrivener-import-modal.ts), inchangé. */
const SUPPORTED_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"]);

/** Fichiers techniques Scrivener connus du moteur d'import dans
 * Files/Data/<uuid>/ — jamais signalés comme médias non pris en charge
 * (§15 : "content.rtf, notes.rtf, synopsis.txt, content.comments... ne
 * doivent PAS être signalés comme médias"). */
const CONTROL_FILE_BASENAMES = new Set(["content.rtf", "notes.rtf", "synopsis.txt", "content.comments"]);

export type ScrivenerAttachedFileKind = "supported" | "unsupported" | "controlFile";

/** Classifie un fichier trouvé dans Files/Data/<uuid>/ (§15/§30 du chantier
 * S3) : fichier technique du moteur, ressource déjà prise en charge, ou
 * média inconnu à signaler (jamais importé, jamais converti, jamais
 * supprimé — voir §14/§25). Fonction PURE, ne lit aucun fichier. */
export function classifyAttachedFile(fileName: string): ScrivenerAttachedFileKind {
  const lower = (fileName || "").trim().toLowerCase();
  if (CONTROL_FILE_BASENAMES.has(lower)) return "controlFile";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  return SUPPORTED_ASSET_EXTENSIONS.has(ext) ? "supported" : "unsupported";
}

/** Comportement historique préservé (§5/§9/§10 du chantier S3) : dans
 * Files/Data/<uuid>/, un fichier basé "content" ou "notes" (ex.
 * content.jpg, notes.png) garde un nom dérivé de l'UUID pour éviter son
 * ambiguïté — seul cas où un UUID reste visible dans le nom final, par
 * nécessité déjà présente avant S3. Tout autre fichier garde son nom
 * d'origine. Toujours utilisé comme `desiredName` du registre central
 * (jamais le nom final imposé directement — voir allocateAssetName). */
export function deriveDataAssetDesiredName(uuid: string, fileName: string): string {
  const extIndex = fileName.lastIndexOf(".");
  const ext = extIndex >= 0 ? fileName.slice(extIndex) : "";
  const base = extIndex >= 0 ? fileName.slice(0, extIndex) : fileName;
  return (base.toLowerCase() === "content" || base.toLowerCase() === "notes") ? `${uuid}${ext}` : fileName;
}

// ============================ Rapport d'import (S3) =========================

/** Bilan factuel d'un import Scrivener — voir §17 du chantier S3. Rempli
 * progressivement par scrivener-import-modal.ts au fil de l'écriture
 * réelle (jamais à partir du plan seul : voir §18/§19, les compteurs ne
 * montent qu'après un succès réel de app.vault.create/createBinary). */
export type ScrivenerImportReport = {
  markdownFilesCreated: number;
  assetsImported: number;
  assetCollisionsRenamed: number;
  unresolvedInternalLinks: number;
  unresolvedAssets: number;
  ambiguousAssets: number;
  unsupportedAssets: number;
  trashEntriesSkipped: number;
  rtfMissingOrUnreadable: number;
  /** Listes courtes et dédupliquées — jamais affichées en intégralité dans
   * le Notice final (§24), seulement leur longueur. */
  unsupportedAssetNames: string[];
  ambiguousAssetNames: string[];
};

export function createEmptyImportReport(): ScrivenerImportReport {
  return {
    markdownFilesCreated: 0,
    assetsImported: 0,
    assetCollisionsRenamed: 0,
    unresolvedInternalLinks: 0,
    unresolvedAssets: 0,
    ambiguousAssets: 0,
    unsupportedAssets: 0,
    trashEntriesSkipped: 0,
    rtfMissingOrUnreadable: 0,
    unsupportedAssetNames: [],
    ambiguousAssetNames: [],
  };
}

/** Résumé du Notice final (§23) : n'affiche que les compteurs non nuls,
 * jamais une ligne à zéro. Fonction PURE, testable indépendamment de
 * l'écriture réelle (§31 tests 39/40). */
export function formatImportSummary(report: ScrivenerImportReport): string {
  const intro = t("modal.scrivenerImport.summaryIntro", {
    files: String(report.markdownFilesCreated),
    assets: String(report.assetsImported),
  });
  const warnings: string[] = [];
  if (report.unresolvedInternalLinks > 0) {
    warnings.push(t("modal.scrivenerImport.summaryUnresolvedLinks", { count: String(report.unresolvedInternalLinks) }));
  }
  if (report.unresolvedAssets > 0) {
    warnings.push(t("modal.scrivenerImport.summaryUnresolvedAssets", { count: String(report.unresolvedAssets) }));
  }
  if (report.ambiguousAssets > 0) {
    warnings.push(t("modal.scrivenerImport.summaryAmbiguousAssets", { count: String(report.ambiguousAssets) }));
  }
  if (report.unsupportedAssets > 0) {
    warnings.push(t("modal.scrivenerImport.summaryUnsupportedAssets", { count: String(report.unsupportedAssets) }));
  }
  if (report.trashEntriesSkipped > 0) {
    warnings.push(t("modal.scrivenerImport.summaryTrashSkipped", { count: String(report.trashEntriesSkipped) }));
  }
  if (report.rtfMissingOrUnreadable > 0) {
    warnings.push(t("modal.scrivenerImport.summaryRtfUnreadable", { count: String(report.rtfMissingOrUnreadable) }));
  }
  /* §23 : jamais de ligne à zéro — seuls les compteurs non nuls apparaissent,
     joints par " ; " et clos par un point final. */
  return warnings.length > 0 ? `${intro} ${warnings.join(" ; ")}.` : intro;
}

export type ScrivenerImportTargetKind =
  | "manuscriptScene"
  | "manuscriptFolder"
  | "manuscriptContainer"
  /** Note propre de la racine Draft elle-même — voir §9 du chantier S2.
   * Jamais de folderPath : le dossier physique reste toujours Manuscrit/. */
  | "manuscriptRoot"
  | "researchFolder"
  | "researchEntry"
  /** Note propre de la racine Research elle-même — voir §11 du chantier S2.
   * Jamais de folderPath : le dossier existe déjà (racine Recherche Feuillets). */
  | "researchRoot";

/** Une entrée du plan = un nœud Scrivener (identifié par son UUID) et sa
 * destination FINALE dans le coffre, déjà résolue (collisions comprises).
 * `markdownPath` est le fichier .md qui représente réellement ce nœud pour
 * les liens internes (scrivlink://UUID, voir rtfToMarkdown) ; `folderPath`
 * le dossier qu'il crée, le cas échéant. Un nœud peut avoir les deux
 * (dossier avec sa propre note, Text avec enfants) ou un seul des deux
 * (scène simple ; dossier de recherche sans note propre — voir §12 du
 * chantier S1, hors périmètre). */
export type ScrivenerImportTarget = {
  uuid: string;
  sourceTitle: string;
  kind: ScrivenerImportTargetKind;
  markdownPath?: string;
  folderPath?: string;
};

export type ScrivenerImportPlan = {
  /** Une entrée par nœud visité, dans l'ORDRE EXACT du parcours en
   * profondeur du binder — l'écriture consomme cette liste dans le même
   * ordre (curseur séquentiel), jamais par re-calcul ni par re-recherche
   * du titre : une seule source de vérité pour la correspondance nœud ->
   * chemin (voir scrivener-import-modal.ts). */
  targets: ScrivenerImportTarget[];
  /** UUID Scrivener -> chemin Markdown final, pour la conversion des liens
   * scrivlink://UUID (rtfToMarkdown). Contient UNIQUEMENT des cibles .md
   * réellement prévues par le plan (markdownPath) — jamais un simple
   * folderPath : un wikilien Obsidian doit pointer vers une note, pas vers
   * un TFolder. Un nœud sans note propre (dossier de recherche, voir §12
   * du chantier S1) n'a donc AUCUNE entrée ici — son UUID est traité comme
   * non résolu par rtfToMarkdown (texte visible conservé, jamais de faux
   * lien). Voir le correctif S1 « liens vers dossiers sans note ». */
  uuidToPath: Map<string, string>;
};

export type ScrivenerImportPlanOptions = {
  manuscritPath: string;
  projectTitle?: string;
  researchRootPath?: string | null;
  mode: keyof typeof PROJECT_MODES;
  unclassifiedFolderLabel: string;
  /** Nom physique RÉEL (déjà présent sur le disque, ou nom canonique à
   * défaut) du dossier Recherche cible pour chaque catégorie reconnue par
   * classifyResearchFolder (ex. "personnages" -> "Personnages", ou une
   * variante legacy déjà existante) — résolu par l'appelant (lecture disque
   * hors de cette fonction pure, voir researchFolderNames/CANONICAL_RESEARCH_LABELS
   * dans utils/project-modes.ts). Un Folder Scrivener "Characters" classifié
   * "personnages" est ainsi toujours écrit dans le dossier Personnages
   * existant, jamais dans un second dossier "Characters" recréé sous son
   * libellé anglais interne. Absent ou clé manquante = repli sur le nom
   * canonique (CANONICAL_RESEARCH_LABELS), jamais sur folderDef.label. */
  researchCategoryFolderNames?: Partial<Record<string, string>>;
  /** UUID de TOUT nœud Folder (au sens large : dossier du manuscrit, racine
   * Draft, racine Research, dossier Research classifié ou imbriqué, racine
   * "other") dont l'import va RÉELLEMENT créer une note propre — décidé par
   * une pré-analyse en lecture seule du contenu Scrivener (RTF, synopsis,
   * label, statut, notes, commentaires, mots-clés, customMetadata, images
   * jointes — voir la fonction de décision partagée dans
   * scrivener-import-modal.ts, §8 du chantier S2), PAS par cette fonction
   * (qui reste pure et ne lit aucun fichier). Un nœud absent de cet
   * ensemble reçoit toujours son `folderPath` (le dossier est créé dans
   * tous les cas, quand il en a un) mais AUCUN `markdownPath` : jamais de
   * note fabriquée ici pour un nœud qui restera vide — voir le correctif S1
   * « plan et note de dossier manuscrit », généralisé en S2 à toute la
   * hiérarchie. Le nom du champ reste `manuscriptFolderNoteUuids` pour ne
   * pas casser les tests S1 existants ; son usage est désormais global. Omis
   * ou vide = aucun nœud n'a de note (comportement le plus prudent). */
  manuscriptFolderNoteUuids?: Set<string>;
};

/** Construit le plan de destination COMPLET avant la moindre écriture —
 * voir §3 du chantier S1 (« fiabiliser la structure et les liens
 * internes »). Fonction PURE : ne touche jamais au disque/coffre, ne lit
 * aucun contenu RTF — seulement la structure `ParsedScrivx` déjà analysée
 * (titres, hiérarchie, type de nœud). Les collisions de titres (même nom,
 * même dossier parent) sont résolues ici, une fois pour toutes, dans
 * l'ordre du binder Scrivener — jamais au hasard au moment de
 * app.vault.create() (voir §3 et §7). */
export function isScrivenerTitlePageNode(title: string, parentTitle?: string, projectTitle?: string): boolean {
  const norm = (title || "").trim().toLowerCase();
  if (norm === "page de titre" || norm === "title page" || norm === "cover") return true;
  if (parentTitle) {
    const parentNorm = parentTitle.trim().toLowerCase();
    if (parentNorm === "front" || parentNorm === "front matter" || parentNorm === "_front" || parentNorm === "pages initiales") {
      if (norm === "title" || norm === "titre") return true;
      if (projectTitle && norm === projectTitle.trim().toLowerCase()) return true;
    }
  }
  return false;
}

export function buildScrivenerImportPlan(
  parsed: ParsedScrivx,
  opts: ScrivenerImportPlanOptions
): ScrivenerImportPlan {
  const used = new Set<string>();
  const namedFolders = new Map<string, string>();
  const targets: ScrivenerImportTarget[] = [];

  const canonicalFrontPath = joinImportPath(opts.manuscritPath, "Front");
  const canonicalTitlePagePath = joinImportPath(canonicalFrontPath, "Page de titre.md");
  used.add(canonicalFrontPath);
  used.add(canonicalTitlePagePath);

  // Dossier "connu" (Personnages, Lieux, Non classé…) : réutilisé tel quel
  // à chaque référence, jamais dédoublonné — même principe que
  // plugin.ensureFolder (idempotent), pas une collision de titre réelle.
  const reusableFolder = (name: string): string => {
    const existing = namedFolders.get(name);
    if (existing) return existing;
    const path = joinImportPath(opts.researchRootPath || "", name);
    used.add(path);
    namedFolders.set(name, path);
    return path;
  };

  const planManuscriptNode = (item: ScrivenerNode, destPath: string, parentTitle?: string): void => {
    const safe = sanitizeScrivenerTitle(item.title);
    if (item.isFolder) {
      const normTitle = item.title.trim().toLowerCase();
      const isFrontFolder = normTitle === "front" || normTitle === "front matter" || normTitle === "_front" || normTitle === "pages initiales";
      const folderPath = isFrontFolder ? canonicalFrontPath : allocateImportPath(used, joinImportPath(destPath, safe));
      const willHaveNote = opts.manuscriptFolderNoteUuids?.has(item.uuid) ?? false;
      // Le nom de la note n'est réservé dans `used` QUE si elle sera
      // réellement créée : sinon un enfant portant le même titre que le
      // dossier (ex. un Text "Partie 1" sous le dossier "Partie 1") se
      // ferait renommer en "-2" pour éviter une collision avec une note
      // qui ne verra jamais le jour — une fausse collision, jamais voulue.
      let notePath: string | undefined;
      if (willHaveNote) {
        const folderName = folderPath.slice(folderPath.lastIndexOf("/") + 1);
        notePath = allocateImportPath(used, joinImportPath(folderPath, `${folderName}.md`));
      }
      targets.push({
        uuid: item.uuid,
        sourceTitle: item.title,
        kind: "manuscriptFolder",
        folderPath,
        ...(notePath ? { markdownPath: notePath } : {}),
      });
      for (const child of item.children) planManuscriptNode(child, folderPath, item.title);
      return;
    }
    if (item.children.length > 0) {
      const folderPath = allocateImportPath(used, joinImportPath(destPath, safe));
      const folderName = folderPath.slice(folderPath.lastIndexOf("/") + 1);
      const filePath = allocateImportPath(used, joinImportPath(folderPath, `00-${folderName}.md`));
      targets.push({ uuid: item.uuid, sourceTitle: item.title, kind: "manuscriptContainer", folderPath, markdownPath: filePath });
      for (const child of item.children) planManuscriptNode(child, folderPath, item.title);
      return;
    }
    const isTitlePage = isScrivenerTitlePageNode(item.title, parentTitle, opts.projectTitle);
    const filePath = isTitlePage ? canonicalTitlePagePath : allocateImportPath(used, joinImportPath(destPath, `${safe}.md`));
    targets.push({ uuid: item.uuid, sourceTitle: item.title, kind: "manuscriptScene", markdownPath: filePath });
  };

  if (parsed.draft) {
    /* §9 du chantier S2 : la racine Draft ne crée JAMAIS de sous-dossier —
       si elle a du contenu propre, sa note vit directement dans Manuscrit/,
       réservée AVANT les enfants (ordre requis pour que la collision
       Draft.md / enfant homonyme se résolve de façon déterministe, §10). */
    const draftWillHaveNote = opts.manuscriptFolderNoteUuids?.has(parsed.draft.uuid) ?? false;
    if (draftWillHaveNote) {
      const safe = sanitizeScrivenerTitle(parsed.draft.title);
      const notePath = allocateImportPath(used, joinImportPath(opts.manuscritPath, `${safe}.md`));
      targets.push({ uuid: parsed.draft.uuid, sourceTitle: parsed.draft.title, kind: "manuscriptRoot", markdownPath: notePath });
    }
    for (const child of parsed.draft.children) planManuscriptNode(child, opts.manuscritPath);
  }

  /* Symétrique de planManuscriptNode pour la Recherche (§13 du chantier
     S2) : un Folder Research (classifié ou non, imbriqué ou non) reçoit
     toujours son `folderPath`, et un `markdownPath` UNIQUEMENT s'il a du
     contenu propre (même Set partagé que le manuscrit, voir §8). */
  const planResearchNode = (item: ScrivenerNode, destPath: string): void => {
    const safe = sanitizeScrivenerTitle(item.title);
    if (item.isFolder) {
      const folderPath = allocateImportPath(used, joinImportPath(destPath, safe));
      const willHaveNote = opts.manuscriptFolderNoteUuids?.has(item.uuid) ?? false;
      let notePath: string | undefined;
      if (willHaveNote) {
        const folderName = folderPath.slice(folderPath.lastIndexOf("/") + 1);
        notePath = allocateImportPath(used, joinImportPath(folderPath, `${folderName}.md`));
      }
      targets.push({
        uuid: item.uuid,
        sourceTitle: item.title,
        kind: "researchFolder",
        folderPath,
        ...(notePath ? { markdownPath: notePath } : {}),
      });
      for (const child of item.children) planResearchNode(child, folderPath);
      return;
    }
    const filePath = allocateImportPath(used, joinImportPath(destPath, `${safe}.md`));
    targets.push({ uuid: item.uuid, sourceTitle: item.title, kind: "researchEntry", markdownPath: filePath });
  };

  if (opts.researchRootPath) {
    const researchFolders = PROJECT_MODES[opts.mode].researchFolders as Record<string, { label: string; tag: string }>;
    if (parsed.research) {
      /* §11 du chantier S2 : même principe que la racine Draft — pas de
         sous-dossier Research/Research/…, note directe dans la racine
         Recherche si contenu propre, réservée avant les enfants. Aucun tag
         structurel (personnage/lieu) ne lui est jamais associé (§11, §21). */
      const researchRootWillHaveNote = opts.manuscriptFolderNoteUuids?.has(parsed.research.uuid) ?? false;
      if (researchRootWillHaveNote) {
        const safe = sanitizeScrivenerTitle(parsed.research.title);
        const notePath = allocateImportPath(used, joinImportPath(opts.researchRootPath, `${safe}.md`));
        targets.push({ uuid: parsed.research.uuid, sourceTitle: parsed.research.title, kind: "researchRoot", markdownPath: notePath });
      }
      for (const child of parsed.research.children) {
        const key = child.isFolder ? classifyResearchFolder(child.title) : null;
        const folderDef = key ? researchFolders[key] : null;
        if (folderDef && key) {
          /* Nom physique CANONIQUE Feuillets (Personnages, Lieux…), jamais
             folderDef.label (libellé anglais interne "Characters"/"Places") :
             voir le commentaire de researchCategoryFolderNames ci-dessus. */
          const categoryFolderName =
            opts.researchCategoryFolderNames?.[key] || CANONICAL_RESEARCH_LABELS[key] || folderDef.label;
          const targetFolder = reusableFolder(categoryFolderName);
          /* §12 : le dossier classifié (Characters, Places…) reçoit sa
             propre note SEULEMENT s'il a du contenu propre — jamais de
             tag structurel personnage/lieu sur CETTE note (portée par ses
             enfants directs uniquement, à l'écriture). */
          const classifiedWillHaveNote = opts.manuscriptFolderNoteUuids?.has(child.uuid) ?? false;
          if (classifiedWillHaveNote) {
            /* Correctif final S2 : la note représente le Folder SCRIVENER
               d'origine (`child`), pas le dossier Feuillets cible partagé
               (`targetFolder`, réutilisé tel quel entre plusieurs Folder
               classifiés vers la même rubrique — voir reusableFolder). Son
               nom doit donc rester le titre Scrivener sanitizé du Folder,
               jamais le basename du dossier cible : "Character Sketches"
               classé dans Characters/ produit Characters/Character
               Sketches.md, pas Characters/Characters.md. */
            const noteName = sanitizeScrivenerTitle(child.title);
            const notePath = allocateImportPath(used, joinImportPath(targetFolder, `${noteName}.md`));
            targets.push({ uuid: child.uuid, sourceTitle: child.title, kind: "researchFolder", folderPath: targetFolder, markdownPath: notePath });
          }
          for (const grandchild of child.children) planResearchNode(grandchild, targetFolder);
        } else {
          const fallback = reusableFolder(opts.unclassifiedFolderLabel);
          planResearchNode(child, fallback);
        }
      }
    }
    for (const other of parsed.others) {
      /* §14 : une racine "other" Folder suit désormais le même mécanisme
         que les dossiers Research (planResearchNode) — dossier toujours
         créé, note propre uniquement si contenu. Rien de spécifique ici :
         c'est le même moteur, pas un second système parallèle. */
      const fallback = reusableFolder(opts.unclassifiedFolderLabel);
      planResearchNode(other, fallback);
    }
  }

  const uuidToPath = new Map<string, string>();
  for (const target of targets) {
    /* Jamais de repli sur folderPath : un wikilien doit pointer vers une
       note .md réellement prévue, jamais vers un simple TFolder (voir
       le commentaire de ScrivenerImportPlan.uuidToPath ci-dessus). */
    if (target.uuid && target.markdownPath && !uuidToPath.has(target.uuid)) {
      uuidToPath.set(target.uuid, target.markdownPath);
    }
  }

  return { targets, uuidToPath };
}

// ========================= Extractions des liens d'images ====================

export function parseScrImageLinks(text: string): ScrImageLink[] {
  const links: ScrImageLink[] = [];
  if (!text) return links;

  const reScr = /\{?\$SCRImageLink\[[^\]]*\][:=]+\$PROJECT:\/\/([^}\s]+)\}?/gi;
  let m: RegExpExecArray | null;
  while ((m = reScr.exec(text))) {
    const rawRef = m[1].trim();
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    if (fileName && !links.some((l) => l.fileName.toLowerCase() === fileName.toLowerCase())) {
      links.push({ rawRef, fileName, fullMatch: m[0] });
    }
  }

  const reProject = /\$PROJECT:\/\/([^\s"'<>})]+)/gi;
  while ((m = reProject.exec(text))) {
    const rawRef = m[1].trim();
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    if (fileName && !links.some((l) => l.fileName.toLowerCase() === fileName.toLowerCase())) {
      links.push({ rawRef, fileName, fullMatch: m[0] });
    }
  }

  return links;
}

/** Corrige le bug §13 du chantier S3 : deux références $PROJECT://
 * DIFFÉRENTES partageant le même basename, dans le MÊME document, ne
 * doivent jamais s'écraser l'une l'autre dans les embeds Markdown.
 *
 * Remplace les occurrences AU FIL DU TEXTE (callback de .replace, donc dans
 * l'ordre d'apparition, jamais un remplacement global par basename), avec
 * une désambiguïsation LOCALE au document (rawRef -> nom réservé) :
 *   - une rawRef déjà vue dans ce document réutilise son nom déjà résolu
 *     (§6 : même source, même fichier) ;
 *   - une rawRef nouvelle dont le basename est déjà pris par une AUTRE
 *     rawRef de ce document reçoit un suffixe déterministe ("-2", "-3"…),
 *     même algorithme que allocateImportPath.
 *
 * Cette désambiguïsation ne couvre que les collisions INTERNES au document
 * — la désambiguïsation inter-documents (même basename, sources différentes
 * dans deux fichiers distincts) reste du ressort du registre central
 * (ScrivenerAssetRegistry, appliqué à l'écriture dans
 * scrivener-import-modal.ts), qui reçoit `imageLinks` en sortie d'ici comme
 * `desiredName`. Fonction PURE, ne lit/écrit aucun fichier. */
function resolveProjectImageEmbeds(text: string): { text: string; imageLinks: ScrImageLink[] } {
  if (!text) return { text: text || "", imageLinks: [] };

  const imageLinks: ScrImageLink[] = [];
  const localNameByRawRef = new Map<string, string>();
  const usedLocalNames = new Set<string>();

  const resolve = (rawRefRaw: string, fullMatch: string): string => {
    const rawRef = rawRefRaw.trim();
    const existing = localNameByRawRef.get(rawRef);
    if (existing) return existing;
    const baseName = (rawRef.slice(rawRef.lastIndexOf("/") + 1).trim()) || "asset";
    const finalName = allocateImportPath(usedLocalNames, baseName);
    localNameByRawRef.set(rawRef, finalName);
    imageLinks.push({ rawRef, fileName: finalName, fullMatch });
    return finalName;
  };

  let out = text.replace(
    /\{?\$SCRImageLink\[[^\]]*\][:=]+\$PROJECT:\/\/([^}\s]+)\}?/gi,
    (match: string, rawRef: string) => `\n\n![[${resolve(rawRef, match)}]]\n\n`
  );

  out = out.replace(
    /\$PROJECT:\/\/([^\s"'<>})]+)/gi,
    (match: string, rawRef: string) => `\n\n![[${resolve(rawRef, match)}]]\n\n`
  );

  return { text: out, imageLinks };
}

// ========================= Classification recherche =========================

export function classifyResearchFolder(title: string | null | undefined) {
  const t = (title || "").trim().toLowerCase();
  if (t === "characters" || t === "character sketches") return "personnages";
  if (t === "places" || t === "locations" || t === "settings") return "lieux";
  return null;
}

export function researchTargetLabel(title: string | null | undefined, mode: keyof typeof PROJECT_MODES) {
  const key = classifyResearchFolder(title);
  if (!key) return null;
  const folders = PROJECT_MODES[mode].researchFolders;
  if (!folders[key]) return null;
  // Nom physique CANONIQUE Feuillets (Personnages, Lieux…) — jamais le
  // libellé anglais interne (folders[key].label), voir researchCategoryFolderNames.
  return CANONICAL_RESEARCH_LABELS[key] || folders[key].label;
}

// ============================ Mapping des statuts ===========================

const STATUS_MAP: Record<string, string> = {
  "no status": "",
  "sans état": "",
  "s/o": "",
  "to do": "Idée",
  "à faire": "Idée",
  "outline": "Idée",
  "first draft": "Brouillon",
  "version préliminaire": "Brouillon",
  "second draft": "En cours",
  "revised draft": "Révisé",
  "brouillon révisé": "Révisé",
  "final draft": "Terminé",
  "version finale": "Terminé",
  "done": "Terminé",
  "terminé": "Terminé",
};

export function mapScrivenerStatus(scrivenerStatusTitle: string | null | undefined) {
  if (!scrivenerStatusTitle) return "";
  const key = scrivenerStatusTitle.trim().toLowerCase();
  if (STATUS_MAP[key] !== undefined) return STATUS_MAP[key];
  return scrivenerStatusTitle.trim();
}

// ============================ Aperçu avant écriture ==========================

export function countImportPreview(parsed: ParsedScrivx) {
  let folders = 0;
  let scenes = 0;
  const walkManuscript = (item: ScrivenerNode) => {
    if (item.isFolder) folders++;
    else scenes++;
    for (const c of item.children) walkManuscript(c);
  };
  if (parsed.draft) for (const c of parsed.draft.children) walkManuscript(c);

  let researchEntries = 0;
  const walkResearch = (item: ScrivenerNode) => {
    if (!item.isFolder) researchEntries++;
    for (const c of item.children) walkResearch(c);
  };
  if (parsed.research) for (const c of parsed.research.children) walkResearch(c);

  /* Corbeille Scrivener (§16 du chantier S2) : jamais importée, mais plus
   * jamais ignorée silencieusement — comptée récursivement (la racine Trash
   * elle-même n'est pas comptée) pour être annoncée avant confirmation. */
  let trashEntries = 0;
  const walkTrash = (item: ScrivenerNode) => {
    trashEntries++;
    for (const c of item.children) walkTrash(c);
  };
  if (parsed.trash) for (const c of parsed.trash.children) walkTrash(c);

  return { folders, scenes, researchEntries, unclassifiedRoots: parsed.others.length, trashEntries };
}

// ============================ Frontmatter YAML ==============================

function yamlScalar(value: unknown) {
  const v = value == null ? "" : toValue(value);
  if (v === "") return "";
  const looksTyped = /^(-?\d+(\.\d+)?|true|false|null|~|yes|no)$/i.test(v);
  if (looksTyped || /[:#[\]{}&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v) || v.includes("\n")) {
    /* Les retours à la ligne réels DOIVENT être échappés en "\n" littéral :
       un saut de ligne brut dans un scalaire entre guillemets YAML impose une
       indentation de continuation stricte sur toutes les lignes suivantes —
       jamais garantie ici (texte multi-paragraphe, notes agrégeant plusieurs
       commentaires) — et casse le parseur YAML d'Obsidian avec une erreur
       "deficient indentation" sur les notes multi-lignes. */
    return `"${v
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r\n/g, "\\n")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\n")}"`;
  }
  return v;
}

function yamlTagsBlock(tags: string[] | null | undefined) {
  const list = (tags || []).filter(Boolean);
  if (list.length === 0) return "tags: ";
  return "tags:\n" + list.map((t) => `  - ${yamlScalar(t)}`).join("\n");
}

/** Bloc `scrivener_metadata` (§6 du chantier S2) : une entrée par métadonnée
 * personnalisée conservée, identifiable par son nom Scrivener d'origine.
 * Retourne une chaîne vide (clé absente) si `items` est vide — jamais une
 * clé `scrivener_metadata:` orpheline. Les propriétés Feuillets restent au
 * niveau racine du frontmatter : ce bloc ne promeut JAMAIS une métadonnée
 * personnalisée vers une propriété Feuillets (un champ nommé "title" ou
 * "tags" reste ici, sans toucher aux clés racine `title`/`tags`). */
function yamlCustomMetadataBlock(items: ScrivenerCustomMetadata[] | null | undefined): string {
  const list = (items || []).filter((m) => m && m.value);
  if (list.length === 0) return "";
  const entries = list.map(
    (m) => `  - id: ${yamlScalar(m.id)}\n    name: ${yamlScalar(m.name)}\n    value: ${yamlScalar(m.value)}`
  );
  return "scrivener_metadata:\n" + entries.join("\n");
}

export function extractHeadingTitle(bodyText: string | null | undefined) {
  const m = /^#{1,2}[ \t]+(.+)$/m.exec(bodyText || "");
  return m ? m[1].trim() : "";
}

type SceneFrontmatterOptions = {
  titre?: string;
  titreCourt?: string;
  sousTitre?: string;
  order: number;
  isFiction?: boolean;
  synopsis?: string;
  statut?: string;
  label?: string;
  tags?: string[];
  notes?: string;
  includeInCompile?: boolean;
  wordGoal?: number;
  /** Métadonnées personnalisées Scrivener conservées (§6/§7 du chantier
   * S2) — jamais promues en propriété Feuillets, voir yamlCustomMetadataBlock. */
  customMetadata?: ScrivenerCustomMetadata[];
};

export function buildSceneFrontmatter({
  titre,
  titreCourt,
  sousTitre,
  order,
  isFiction,
  synopsis,
  statut,
  label,
  tags,
  notes,
  includeInCompile,
  wordGoal,
  customMetadata,
}: SceneFrontmatterOptions) {
  const binderTitle = sousTitre || titreCourt || titre || "";
  const lines = [
    "---",
    `title: ${yamlScalar(titre)}`,
    `short_title: ${yamlScalar(binderTitle)}`,
    `subtitle: ${yamlScalar(sousTitre)}`,
    `order: ${order}`,
    `${isFiction ? "synopsis" : "summary"}: ${yamlScalar(synopsis)}`,
    `status: ${yamlScalar(statut)}`,
    `label: ${yamlScalar(label)}`,
    `goal: ${wordGoal || 0}`,
    yamlTagsBlock(tags),
    "date: ",
    `notes: ${yamlScalar(notes)}`,
    `compile: ${includeInCompile !== false ? "true" : "false"}`,
  ];
  const metaBlock = yamlCustomMetadataBlock(customMetadata);
  if (metaBlock) lines.push(metaBlock);
  lines.push("---", "");
  return lines.join("\n");
}

type EntityFrontmatterOptions = {
  title?: string;
  synopsis?: string;
  tags?: string[];
  notes?: string;
  customMetadata?: ScrivenerCustomMetadata[];
};

export function buildEntityFrontmatter({ title, synopsis, tags, notes, customMetadata }: EntityFrontmatterOptions) {
  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `synopsis: ${yamlScalar(synopsis)}`,
    `notes: ${yamlScalar(notes)}`,
    yamlTagsBlock(tags),
  ];
  const metaBlock = yamlCustomMetadataBlock(customMetadata);
  if (metaBlock) lines.push(metaBlock);
  lines.push("---", "");
  return lines.join("\n");
}

// ============================ RTF → Markdown ================================

const CP1252_HIGH = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
  136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
  146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
};
function byteToUnicode(code: number) {
  return (CP1252_HIGH as Record<number, number>)[code] !== undefined ? (CP1252_HIGH as Record<number, number>)[code] : code;
}

export function parseScrivenerComments(xml: string | null | undefined) {
  const comments: Record<string, ScrivenerComment> = {};
  if (!xml) return comments;
  const re = /<Comment\b([^>]*)>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [, attrs, rtf] = m;
    const idMatch = /\bID="([^"]*)"/.exec(attrs);
    if (!idMatch) continue;
    comments[idMatch[1]] = { rtf, isFootnote: /\bFootnote="Yes"/.test(attrs) };
  }
  return comments;
}

function scanGroup(src: string, start: number) {
  let depth = 1;
  let i = start + 1;
  const len = src.length;
  while (i < len && depth > 0) {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      if (next === "{" || next === "}" || next === "\\") { i += 2; continue; }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  return i;
}

export function rtfToMarkdown(
  rtf: string,
  comments: Record<string, ScrivenerComment> = {},
  binderItemMap: Map<string, string> | null = null,
  options: RtfOptions = {}
): RtfResult {
  if (!rtf || !rtf.startsWith("{\\rtf")) return { text: (rtf || "").trim(), footnotes: [] };

  const footnotes: string[] = [];
  const extractedImages: ExtractedImage[] = [];
  const extractedComments: ExtractedComment[] = [];
  let unresolvedLinks = 0;

  function convert(src: string, collectFootnotes: boolean) {
    const len = src.length;
    let i = 0;
    let out = "";
    let bold = false;
    let italic = false;
    let unicodeSkip = 1;

    let inRow = false;
    let cells: string[] = [];
    let cellBuf = "";
    let tableRunActive = false;

    let pendingOpen = "";

    const rawAppend = (s: string) => {
      if (inRow) cellBuf += s;
      else out += s;
    };

    const stripTrailingSpace = () => {
      if (inRow) {
        const m = /[ \t]+$/.exec(cellBuf);
        if (!m) return "";
        cellBuf = cellBuf.slice(0, -m[0].length);
        return m[0];
      }
      const m = /[ \t]+$/.exec(out);
      if (!m) return "";
      out = out.slice(0, -m[0].length);
      return m[0];
    };

    const emit = (s: string) => {
      if (!s) return;
      if (pendingOpen) {
        const leading = /^[ \t]*/.exec(s)?.[0] || "";
        const rest = s.slice(leading.length);
        if (leading) rawAppend(leading);
        if (rest) {
          rawAppend(pendingOpen + rest);
          pendingOpen = "";
        }
        return;
      }
      rawAppend(s);
    };

    const openSpan = (marker: string) => {
      pendingOpen += marker;
    };

    const closeSpan = (marker: string) => {
      if (pendingOpen.endsWith(marker)) {
        pendingOpen = pendingOpen.slice(0, -marker.length);
        return;
      }
      const trailing = stripTrailingSpace();
      rawAppend(marker + trailing);
    };

    const closeMarkers = () => {
      if (bold) { closeSpan("**"); bold = false; }
      if (italic) { closeSpan("*"); italic = false; }
    };

    const breakParagraph = () => {
      const activeBold = bold;
      const activeItalic = italic;
      closeMarkers();
      out += "\n\n"; // 2 \n = Standard Markdown Paragraph Break
      if (activeBold) openSpan("**");
      if (activeItalic) openSpan("*");
      bold = activeBold;
      italic = activeItalic;
    };

    const renderRow = () => {
      if (!inRow) return;
      inRow = false;
      const cleanCells = cells.map((c) => c.trim().replace(/\n+/g, " "));
      if (cleanCells.every((c) => c === "")) { cells = []; cellBuf = ""; return; }
      if (!tableRunActive) {
        tableRunActive = true;
        out += "| " + cleanCells.join(" | ") + " |\n";
        out += "| " + cleanCells.map(() => "---").join(" | ") + " |\n";
      } else {
        out += "| " + cleanCells.join(" | ") + " |\n";
      }
      cells = [];
      cellBuf = "";
    };

    while (i < len) {
      const c = src[i];

      // Ignorer les sauts de ligne purs du fichier RTF.
      if (c === "\r" || c === "\n") {
        const lastChar = out.slice(-1);
        if (lastChar && !/[ \t\n]/.test(lastChar)) {
          emit(" ");
        }
        i++;
        continue;
      }

      const code = c.charCodeAt(0);
      if (code < 32 && code !== 9) {
        i++;
        continue;
      }

      if (c === "<") {
        /* Marqueurs internes Scrivener (texte littéral, pas des mots de
           contrôle RTF) : <$ScrKeepWithNext>, <$Scr_Ps::N>, <!$Scr_Ps::N>.
           Écrits directement via rawAppend (hors du circuit emit/pendingOpen)
           pour qu'ils ne "consomment" jamais un gras/italique en attente —
           sans ça, un marqueur situé juste après un saut de paragraphe forçait
           l'ouverture d'une emphase sur du texte invisible, laissant des "*"
           orphelins une fois le marqueur retiré par finalizeConvertedText. */
        const tagMatch = /^<\$ScrKeepWithNext>|^<!?\$Scr_[a-zA-Z0-9_]+::\d+>/.exec(src.slice(i));
        if (tagMatch) {
          rawAppend(tagMatch[0]);
          i += tagMatch[0].length;
          continue;
        }
      }

      if (c === "{") {
        const peek = src.slice(i, i + 35);
        if (/^\{\\(\*\\)?Scrv?_annot\b/i.test(peek) || /^\{\\(\*\\)?[a-z0-9_]*annot/i.test(peek)) {
          const end = scanGroup(src, i);
          const inner = src.slice(i + 1, end - 1);
          let rawText = inner;
          const textIdx = inner.indexOf("\\text=");
          if (textIdx !== -1) {
            rawText = inner.slice(textIdx + 6);
          }
          rawText = rawText.replace(/\\end_Scrv?_annot\b/gi, "").trim();
          const annotRes = rtfToMarkdown(rawText, comments, binderItemMap);
          let annotText = annotRes.text;
          /* §20 du chantier S3 : un scrivlink://UUID non résolu À L'INTÉRIEUR
             d'une annotation doit compter dans le bilan final au même titre
             qu'un lien non résolu du corps principal — jamais silencieusement
             perdu par l'appel récursif à rtfToMarkdown (voir aussi le cas
             symétrique pour les commentaires scrivcmt:// plus bas). */
          unresolvedLinks += annotRes.unresolvedLinkCount || 0;
          annotText = (annotText || "").replace(/\\n/g, " ").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
          if (annotText) {
            extractedComments.push({ word: "", text: `[Annotation]: ${annotText}` });
          }
          i = end;
          continue;
        }
        if (/^\{\\footnote\b/.test(peek)) {
          const end = scanGroup(src, i);
          if (collectFootnotes) {
            const inner = src.slice(i + 1, end - 1);
            const footnoteText = finalizeConvertedText(convert(inner, false)).trim();
            if (footnoteText) {
              footnotes.push(footnoteText);
              emit(`[^${footnotes.length}]`);
            }
          }
          i = end;
          continue;
        }
        if (/^\{\\(\*\\)?(?:shppict|pict)\b/.test(peek)) {
          const end = scanGroup(src, i);
          const inner = src.slice(i + 1, end - 1);
          const isPng = /\\pngblip\b/.test(inner);
          const ext = isPng ? "png" : "jpg";
          
          const hexMatches = inner.match(/([0-9a-fA-F\s]{40,})/g);
          let hexClean = "";
          if (hexMatches) {
            let largest = "";
            for (const h of hexMatches) {
              const clean = h.replace(/\s+/g, "");
              if (clean.length > largest.length && clean.length % 2 === 0) {
                largest = clean;
              }
            }
            hexClean = largest;
          }

          if (hexClean) {
            const bytes = new Uint8Array(hexClean.length / 2);
            for (let b = 0; b < hexClean.length; b += 2) {
              bytes[b / 2] = parseInt(hexClean.slice(b, b + 2), 16);
            }
            const imgIndex = extractedImages.length + 1;
            const prefix = options.prefix || (options.uuid ? `img-${options.uuid.slice(0, 8)}` : "scrivener-img");
            const imgName = `${prefix}-${imgIndex}.${ext}`;
            extractedImages.push({ name: imgName, bytes, ext });
            emit(`\n\n![[${imgName}]]\n\n`);
          }
          i = end;
          continue;
        }
        if (/^\{\\field\b/.test(peek)) {
          const end = scanGroup(src, i);
          const inner = src.slice(i + 1, end - 1);
          const fldrsltIdx = inner.indexOf("{\\fldrslt");
          let linkText = "";
          if (fldrsltIdx !== -1) {
            const fldrsltEnd = scanGroup(inner, fldrsltIdx);
            const fldrsltInner = inner
              .slice(fldrsltIdx + "{\\fldrslt".length, fldrsltEnd - 1)
              .replace(/^ /, "");
            linkText = convert(fldrsltInner, false);
          }
          const cleanText = (linkText || "").trim();

          const linkMatch = /(?:scrivlink|x-scrivener-item):\/\/([0-9A-Fa-f-]+)/.exec(inner);
          const commentMatch = /scrivcmt:\/\/([0-9A-Fa-f-]+)/.exec(inner);
          const webLinkMatch = !linkMatch && !commentMatch && /HYPERLINK\s+(?:"([^"]+)"|([^\s}]+))/i.exec(inner);

          if (linkMatch) {
            const targetUuid = linkMatch[1];
            const targetPath = binderItemMap ? binderItemMap.get(targetUuid) : null;
            if (targetPath) {
              /* `binderItemMap` porte désormais le CHEMIN MARKDOWN FINAL
                 planifié (voir buildScrivenerImportPlan), pas un titre
                 approximatif — l'extension ".md" est retirée pour rester
                 un wikilien Obsidian idiomatique ([[dossier/Cible]]). */
              const linkTarget = targetPath.endsWith(".md") ? targetPath.slice(0, -3) : targetPath;
              if (cleanText && cleanText !== linkTarget) {
                emit(`[[${linkTarget}|${cleanText}]]`);
              } else {
                emit(`[[${linkTarget}]]`);
              }
            } else {
              /* UUID absent du plan (référence vers la Corbeille, ou UUID
                 orphelin) : jamais un lien inventé à partir du texte
                 affiché (risque réel de pointer vers un tout autre
                 document du coffre qui porterait ce titre par coïncidence)
                 — on garde le texte visible tel quel, en texte simple. */
              unresolvedLinks++;
              if (cleanText) emit(cleanText);
            }
          } else if (commentMatch) {
            const commentUuid = commentMatch[1];
            const commentEntry = comments && comments[commentUuid];
            if (collectFootnotes && commentEntry) {
              const commentRes = rtfToMarkdown(commentEntry.rtf, comments, binderItemMap);
              /* §20 du chantier S3 : idem pour un lien non résolu à
                 l'intérieur d'un commentaire Scrivener converti. */
              unresolvedLinks += commentRes.unresolvedLinkCount || 0;
              const cleanCText = (commentRes.text || "").trim();
              if (cleanCText) {
                if (commentEntry.isFootnote) {
                  if (cleanText) emit(cleanText);
                  footnotes.push(cleanCText);
                  emit(`[^${footnotes.length}]`);
                } else {
                  extractedComments.push({ word: cleanText, text: cleanCText });
                  if (cleanText) emit(cleanText);
                }
              } else if (cleanText) {
                emit(cleanText);
              }
            } else if (cleanText) {
              emit(cleanText);
            }
          } else if (webLinkMatch) {
            const rawUrl = (webLinkMatch[1] || webLinkMatch[2] || "").trim();
            if (rawUrl) {
              if (cleanText && cleanText !== rawUrl) {
                emit(`[${cleanText}](${rawUrl})`);
              } else {
                emit(`[${rawUrl}](${rawUrl})`);
              }
            } else if (cleanText) {
              emit(cleanText);
            }
          } else if (cleanText) {
            emit(cleanText);
          }

          i = end;
          continue;
        }
        if (/^\{\\(fonttbl|colortbl|stylesheet|info|object|header|footer|fldinst|datafield)\b/.test(peek) || peek.startsWith("{\\*\\")) {
          i = scanGroup(src, i);
          continue;
        }
        i++;
        continue;
      }
      if (c === "}") { i++; continue; }

      if (c === "\\") {
        const next = src[i + 1];

        if (next === "'") {
          const hex = src.slice(i + 2, i + 4);
          const codeHex = parseInt(hex, 16);
          if (!isNaN(codeHex)) {
            const unicodeCode = byteToUnicode(codeHex);
            emit(String.fromCharCode(unicodeCode));
            i += 4;
            continue;
          }
        }
        if (next === "\n" || next === "\r") {
          /* Antislash suivi d'un vrai retour à la ligne : équivalent de \par
             (spec RTF). C'est la SEULE forme que Scrivener Mac (Cocoa) écrit
             — sans ce cas, les fins de paragraphe fuyaient en \n bruts sans
             refermer le gras/l'italique en cours, et sans séparer les
             paragraphes en Markdown. */
          breakParagraph();
          if (!inRow) tableRunActive = false;
          i += next === "\r" && src[i + 2] === "\n" ? 3 : 2;
          continue;
        }
        if (next === "*") { emit(""); i += 2; continue; }
        if (next === "~") { emit("\u00A0"); i += 2; continue; }
        if (next === "_") { emit("-"); i += 2; continue; }
        if (next === "-") { i += 2; continue; }

        if (!/[a-zA-Z]/.test(next)) {
          emit(next);
          i += 2;
          continue;
        }

        const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i));
        if (match) {
          const word = match[1];
          const param = match[2];
          i += match[0].length;

          switch (word) {
            case "par":
              breakParagraph();
              if (!inRow) tableRunActive = false;
              break;
            case "line":
              /* Un \line isolé se comporte comme \par (saut de paragraphe
                 normal). Deux \line consécutifs totalisent 4 sauts de ligne
                 bruts, que finalizeConvertedText collapse en une ligne
                 blanche visible via la règle "\n{3,}" plus bas dans le
                 fichier. */
              breakParagraph();
              if (!inRow) tableRunActive = false;
              break;
            case "lquote": emit("‘"); break;
            case "rquote": emit("’"); break;
            case "ldblquote": emit("“"); break;
            case "rdblquote": emit("”"); break;
            case "emdash": emit("—"); break;
            case "endash": emit("–"); break;
            case "bullet": emit("•"); break;
            case "tab": emit("  "); break;
            case "b":
              if (param === "0") { if (bold) { closeSpan("**"); bold = false; } }
              else if (!bold) { openSpan("**"); bold = true; }
              break;
            case "i":
              if (param === "0") { if (italic) { closeSpan("*"); italic = false; } }
              else if (!italic) { openSpan("*"); italic = true; }
              break;
            case "u": {
              const codeU = parseInt(param, 10);
              if (!isNaN(codeU)) {
                const cp = codeU < 0 ? codeU + 65536 : codeU;
                if (cp === 8232 || cp === 8233) {
                  breakParagraph();
                  if (!inRow) tableRunActive = false;
                } else if (cp !== 65279 && (cp >= 32 || cp === 9)) {
                  emit(String.fromCharCode(cp));
                }
              }
              let skip = unicodeSkip;
              while (skip > 0 && i < len) {
                if (src[i] === "\\" && src[i + 1] === "'") { i += 4; }
                else if (src[i] !== "\\" && src[i] !== "{" && src[i] !== "}") { i++; }
                else break;
                skip--;
              }
              break;
            }
            case "uc": {
              const n = parseInt(param, 10);
              if (!isNaN(n)) unicodeSkip = n;
              break;
            }
            case "trowd":
              inRow = true;
              cells = [];
              cellBuf = "";
              break;
            case "cell":
              cells.push(cellBuf);
              cellBuf = "";
              break;
            case "row":
              renderRow();
              break;
            default:
              break;
          }
          continue;
        }

        i += 2;
        continue;
      }

      if (c === "\t") {
        emit("  ");
        i++;
        continue;
      }
      if (c === "*") {
        emit("");
        i++;
        continue;
      }
      emit(c);
      i++;
    }

    renderRow();
    closeMarkers();
    return out;
  }

  const converted = convert(rtf, true);
  /* Correctif §13 du chantier S3 : résolution + désambiguïsation locale des
     embeds $PROJECT://+$SCRImageLink AVANT l'extraction du titre de
     chapitre et le nettoyage final — voir resolveProjectImageEmbeds
     ci-dessus. `imageLinks` porte désormais le nom LOCALEMENT désambiguïsé
     (déjà écrit dans le texte), que scrivener-import-modal.ts passe comme
     `desiredName` au registre central pour la désambiguïsation
     inter-documents (voir §4/§13). finalizeConvertedText garde ses propres
     regex $PROJECT/$SCRImageLink comme filet de sécurité pour les rares
     occurrences hors du corps principal (ex. notes de bas de page) —
     comportement historique inchangé pour ce cas, voir son commentaire. */
  const { text: withEmbeds, imageLinks } = resolveProjectImageEmbeds(converted);
  const marker = extractChapterTitleMarker(withEmbeds);

  // Génération du format Body Title exigé par Feuillets (## Title puis ### Subtitle)
  let bodyHeader = "";
  if (marker.title) {
    bodyHeader = `## ${marker.title}\n`;
    if (marker.sousTitre) {
      bodyHeader += `\n### ${marker.sousTitre}\n`;
    }
    bodyHeader += "\n";
  }

  const bodyContent = finalizeConvertedText(marker.title ? marker.rest : withEmbeds);

  const res: RtfResult = {
    text: bodyHeader + bodyContent,
    footnotes,
    chapterTitle: marker.title,
    sousTitre: marker.sousTitre,
  };
  if (extractedImages.length > 0) {
    res.extractedImages = extractedImages;
  }
  if (extractedComments.length > 0) {
    res.extractedComments = extractedComments;
  }
  if (imageLinks.length > 0) {
    res.imageLinks = imageLinks;
  }
  if (unresolvedLinks > 0) {
    res.unresolvedLinkCount = unresolvedLinks;
  }
  return res;
}

export function extractChapterTitleMarker(text: string | null | undefined) {
  if (!text || typeof text !== "string") {
    return { title: "", sousTitre: "", rest: text || "" };
  }

  const cleanHead = text.replace(/^<\$ScrKeepWithNext>/, "");
  // Le parseur permet désormais des espaces ou des sauts de ligne avant le marqueur Scrivener
  const m = /^\s*<\$Scr_Ps::0>([\s\S]*?)<!\$Scr_Ps::0>([\s\S]*)$/.exec(cleanHead);
  if (!m) {
    return { title: "", sousTitre: "", rest: text };
  }

  let rawTitle = m[1];
  const rest = m[2];

  rawTitle = rawTitle.replace(/<\$ScrKeepWithNext>/g, "").replace(/\*\*|\*/g, "").trim();
  const parts = rawTitle.split(/[\r\n]+/).map((p) => p.trim()).filter(Boolean);

  if (parts.length > 2 || rawTitle.length > 200) {
    return { title: "", sousTitre: "", rest: text };
  }

  const title = parts[0] || "";
  const sousTitre = parts[1] || "";

  return { title, sousTitre, rest };
}

function finalizeConvertedText(raw: string) {
  let text = raw;

  text = text.replace(/<\$ScrKeepWithNext>/g, "");

  text = text.replace(/\{?\$SCRImageLink\[[^\]]*\][:=]+\$PROJECT:\/\/([^}\s]+)\}?/gi, (match: string, rawRef: string) => {
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    return `\n\n![[${fileName}]]\n\n`;
  });

  text = text.replace(/\$PROJECT:\/\/([^\s"'<>})]+)/gi, (match: string, rawRef: string) => {
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    return `\n\n![[${fileName}]]\n\n`;
  });

  text = text.replace(/<!?\$Scr_[a-zA-Z0-9_]+::\d+>/g, (m: string, offset: number, fullStr: string) => {
    const before = fullStr[offset - 1] || "";
    const after = fullStr[offset + m.length] || "";
    if (/[a-zA-Z0-9À-ÿ]/.test(before) && /[a-zA-Z0-9À-ÿ]/.test(after)) {
      return " ";
    }
    return "";
  });

  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  /* Deux espaces ordinaires coll\u00E9s EN MILIEU de ligne (pr\u00E9c\u00E9d\u00E9s d'un vrai
     caract\u00E8re) -> un seul. Cas r\u00E9el : un retour \u00E0 la ligne RTF plac\u00E9 DANS
     une port\u00E9e italique ("...du \n\i tekke\n\i0  ?") ajoute un espace \u00E0 la
     fin de l'italique, que la fermeture du marqueur repousse apr\u00E8s le "*" ;
     le texte litt\u00E9ral qui suit ("  ?") apporte d\u00E9j\u00E0 son propre espace, d'o\u00F9
     "*tekke*  ?" (deux espaces). L'indentation de vers (deux espaces en
     D\u00C9BUT de ligne, voir \tab) est pr\u00E9serv\u00E9e : la regex exige un caract\u00E8re
     non-espace juste avant, jamais un d\u00E9but de ligne. Les espaces
     ins\u00E9cables (\u00A0/\u202F, typographie fran\u00E7aise avant ?!;:\u00BB) ne sont
     pas concern\u00E9s \u2014 seuls les U+0020 doubl\u00E9s le sont. */
  text = text.replace(/(\S) {2,}/g, "$1 ");

  // 1. Sauts de ligne manuels / doubles sauts (3 \n ou plus) => Ligne blanche visuelle garantie dans Obsidian (\n\u00A0\n\n)
  text = text.replace(/\n{3,}/g, "\n\u00A0\n\n");

  // 2. Les paragraphes simples (\n\n) restent des \n\n, garantissant l'affichage propre en mode Source.
  
  text = text.replace(/\*\*([.,!?;:\-—«»'"()\t \u00A0\u2003]+)\*\*/g, "$1");
  text = text.replace(/\*([.,!?;:\-—«»'"()\t \u00A0\u2003]+)\*/g, "$1");

  /* Espace parasite ENTRE un marqueur d'emphase fermant et la ponctuation
     qui suit ("*Allahu Ekber* ." -> "*Allahu Ekber*.") : meme origine que le
     double espace corrige plus haut - un retour a la ligne RTF dans la
     portee italique ajoute un espace en fin d'emphase, repousse apres le
     "*" a la fermeture, juste devant un point/une virgule. Seule la
     ponctuation qui, en francais, ne prend JAMAIS d'espace avant est visee
     (. , ... ) ] ) ; ? ! ; : gardent leur espace insecable a l'export). */
  text = text.replace(/(\*{1,2}) +([.,…)\]])/g, "$1$2");

  /* Espace parasite APRES une apostrophe d'elision, avant un marqueur
     d'emphase ouvrant ("L' *ezan*" -> "L'*ezan*") : l'elision (l', d', qu'...)
     colle toujours au mot suivant. Le retour a la ligne RTF apres
     l'apostrophe injectait un espace avant l'italique. */
  text = text.replace(/([’']) +(\*{1,2}\S)/g, "$1$2");
  text = text.replace(//g, "\\*");

  return text.trim();
}
