/** Import d'un projet Scrivener (.scriv) dans Feuillets — fonctions pures. */

import { PROJECT_MODES } from "../utils/project-modes.js";
import { extractTag, extractAllTags, getAttr, decodeXmlEntities } from "../utils/xml.js";
import { t } from "../i18n/index.js";

export { extractTag, extractAllTags, getAttr, decodeXmlEntities };

// ============================ Garde-fou de format ==========================

export function checkScrivenerFormat(entries) {
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

export function rtfPathCandidates(uuid) {
  return [`Files/Data/${uuid}/content.rtf`, `Files/Docs/${uuid}.rtf`];
}

export function findAttachedDataImages(scrivPath, uuid, fs, pathMod) {
  const images = [];
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
  } catch (e) {}

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
    } catch (e) {}
  }
  return images;
}

// ============================ Parseur du binder =============================

function parseListItems(xml) {
  const map = new Map();
  if (!xml) return map;

  const reS3 = /<(?:Label|Status)\b([^>]*)>([\s\S]*?)<\/(?:Label|Status)>/g;
  let m;
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

function parseKeywordSettings(xmlContent) {
  const map = new Map();
  if (!xmlContent) return map;
  const nonBinderXml = xmlContent.replace(/<Binder\b[\s\S]*?<\/Binder>/gi, "");
  const kwSettings =
    extractTag(nonBinderXml, "KeywordsSettings") ||
    extractTag(nonBinderXml, "KeywordSettings");
  const targetXml = kwSettings || extractTag(nonBinderXml, "Keywords") || nonBinderXml;
  if (!targetXml) return map;

  const walk = (xml) => {
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

function parseCustomMetaDataSettings(xmlContent) {
  const map = new Map();
  if (!xmlContent) return map;
  const metaSettings =
    extractTag(xmlContent, "MetaDataSettings") ||
    extractTag(xmlContent, "CustomMetaDataSettings") ||
    xmlContent;
  if (!metaSettings) return map;

  const walk = (xml) => {
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

function parseBinderItem(attrs, body, labelTitles, statusTitles, keywordTitles, customMetaTitles) {
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
  const keywords = [];
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

  const customMetaXml = extractTag(metaXml, "CustomMetaData") || extractTag(body, "CustomMetaData");
  if (customMetaXml) {
    const items = extractAllTags(customMetaXml, "MetaDataItem");
    for (const item of items) {
      const fieldId = getAttr(item.attrs, "FieldID") || getAttr(item.attrs, "fieldID") || extractTag(item.body, "FieldID");
      const val = extractTag(item.body, "Value") || item.body.replace(/<[^>]+>/g, "").trim();
      const fieldTitle = (customMetaTitles && fieldId) ? customMetaTitles.get(fieldId) : fieldId;
      const cleanTitle = (fieldTitle || fieldId || "").trim();
      const cleanVal = decodeXmlEntities(val).trim();

      if (cleanVal) {
        const isTagField = /^(tags?|mots[-_ ]cl[eé]s?|keywords?)$/i.test(cleanTitle) || /^(tags?|mots[-_ ]cl[eé]s?|keywords?)$/i.test(fieldId);
        if (isTagField || cleanVal.includes("#") || cleanVal.includes(",")) {
          const parts = cleanVal
            .split(/[,;\s]+/)
            .map((p) => p.replace(/^#/, "").trim())
            .filter(Boolean);
          for (const p of parts) {
            if (!keywords.includes(p)) keywords.push(p);
          }
        } else {
          if (!keywords.includes(cleanVal)) keywords.push(cleanVal);
        }
      }
    }
  }

  const childrenXml = extractTag(body, "Children");
  const children = childrenXml
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
    children,
  };
}

export function parseScrivx(xmlContent) {
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

export function buildUuidTitleMap(parsed) {
  const map = new Map();
  const walk = (item) => {
    if (item.uuid && item.title) map.set(item.uuid, item.title);
    for (const c of item.children) walk(c);
  };
  if (parsed.draft) walk(parsed.draft);
  if (parsed.research) walk(parsed.research);
  if (parsed.trash) walk(parsed.trash);
  for (const o of parsed.others) walk(o);
  return map;
}

// ========================= Extractions des liens d'images ====================

export function parseScrImageLinks(text) {
  const links = [];
  if (!text) return links;

  const reScr = /\{?\$SCRImageLink\[[^\]]*\][:=]+\$PROJECT:\/\/([^\}\s]+)\}?/gi;
  let m;
  while ((m = reScr.exec(text))) {
    const rawRef = m[1].trim();
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    if (fileName && !links.some((l) => l.fileName.toLowerCase() === fileName.toLowerCase())) {
      links.push({ rawRef, fileName, fullMatch: m[0] });
    }
  }

  const reProject = /\$PROJECT:\/\/([^\s"'<>\}\)]+)/gi;
  while ((m = reProject.exec(text))) {
    const rawRef = m[1].trim();
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    if (fileName && !links.some((l) => l.fileName.toLowerCase() === fileName.toLowerCase())) {
      links.push({ rawRef, fileName, fullMatch: m[0] });
    }
  }

  return links;
}

// ========================= Classification recherche =========================

export function classifyResearchFolder(title) {
  const t = (title || "").trim().toLowerCase();
  if (t === "characters" || t === "character sketches") return "personnages";
  if (t === "places" || t === "locations" || t === "settings") return "lieux";
  return null;
}

export function researchTargetLabel(title, mode) {
  const key = classifyResearchFolder(title);
  if (!key) return null;
  const folders = PROJECT_MODES[mode].researchFolders;
  return folders[key] ? folders[key].label : null;
}

// ============================ Mapping des statuts ===========================

const STATUS_MAP = {
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

export function mapScrivenerStatus(scrivenerStatusTitle) {
  if (!scrivenerStatusTitle) return "";
  const key = scrivenerStatusTitle.trim().toLowerCase();
  if (STATUS_MAP[key] !== undefined) return STATUS_MAP[key];
  return scrivenerStatusTitle.trim();
}

// ============================ Aperçu avant écriture ==========================

export function countImportPreview(parsed) {
  let folders = 0;
  let scenes = 0;
  const walkManuscript = (item) => {
    if (item.isFolder) folders++;
    else scenes++;
    for (const c of item.children) walkManuscript(c);
  };
  if (parsed.draft) for (const c of parsed.draft.children) walkManuscript(c);

  let researchEntries = 0;
  const walkResearch = (item) => {
    if (!item.isFolder) researchEntries++;
    for (const c of item.children) walkResearch(c);
  };
  if (parsed.research) for (const c of parsed.research.children) walkResearch(c);

  return { folders, scenes, researchEntries, unclassifiedRoots: parsed.others.length };
}

// ============================ Frontmatter YAML ==============================

function yamlScalar(value) {
  const v = value == null ? "" : String(value);
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

function yamlTagsBlock(tags) {
  const list = (tags || []).filter(Boolean);
  if (list.length === 0) return "tags: ";
  return "tags:\n" + list.map((t) => `  - ${yamlScalar(t)}`).join("\n");
}

export function extractHeadingTitle(bodyText) {
  const m = /^#{1,2}[ \t]+(.+)$/m.exec(bodyText || "");
  return m ? m[1].trim() : "";
}

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
}) {
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
    "---",
    "",
  ];
  return lines.join("\n");
}

export function buildEntityFrontmatter({ title, synopsis, tags, notes }) {
  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `synopsis: ${yamlScalar(synopsis)}`,
    `notes: ${yamlScalar(notes)}`,
    yamlTagsBlock(tags),
    "---",
    "",
  ];
  return lines.join("\n");
}

// ============================ RTF → Markdown ================================

const CP1252_HIGH = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
  136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
  146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
};
function byteToUnicode(code) {
  return CP1252_HIGH[code] !== undefined ? CP1252_HIGH[code] : code;
}

export function parseScrivenerComments(xml) {
  const comments = {};
  if (!xml) return comments;
  const re = /<Comment\b([^>]*)>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, attrs, rtf] = m;
    const idMatch = /\bID="([^"]*)"/.exec(attrs);
    if (!idMatch) continue;
    comments[idMatch[1]] = { rtf, isFootnote: /\bFootnote="Yes"/.test(attrs) };
  }
  return comments;
}

function scanGroup(src, start) {
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

export function rtfToMarkdown(rtf, comments = {}, binderItemMap = null, options = {}) {
  if (!rtf || !rtf.startsWith("{\\rtf")) return { text: (rtf || "").trim(), footnotes: [] };

  const footnotes = [];
  const extractedImages = [];
  const extractedComments = [];

  function convert(src, collectFootnotes) {
    const len = src.length;
    let i = 0;
    let out = "";
    let bold = false;
    let italic = false;
    let unicodeSkip = 1;

    let inRow = false;
    let cells = [];
    let cellBuf = "";
    let tableRunActive = false;

    let pendingOpen = "";

    const rawAppend = (s) => {
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

    const emit = (s) => {
      if (!s) return;
      if (pendingOpen) {
        const leading = /^[ \t]*/.exec(s)[0];
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

    const openSpan = (marker) => {
      pendingOpen += marker;
    };

    const closeSpan = (marker) => {
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
          let { text: annotText } = rtfToMarkdown(rawText, comments, binderItemMap);
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
              bytes[b / 2] = parseInt(hexClean.substr(b, 2), 16);
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
          const webLinkMatch = !linkMatch && !commentMatch && /HYPERLINK\s+(?:"([^"]+)"|([^\s\}]+))/i.exec(inner);

          if (linkMatch) {
            const targetUuid = linkMatch[1];
            const targetTitle = binderItemMap ? binderItemMap.get(targetUuid) : null;
            if (targetTitle) {
              if (cleanText && cleanText !== targetTitle.trim()) {
                emit(`[[${targetTitle.trim()}|${cleanText}]]`);
              } else {
                emit(`[[${targetTitle.trim()}]]`);
              }
            } else if (cleanText) {
              emit(`[[${cleanText}]]`);
            }
          } else if (commentMatch) {
            const commentUuid = commentMatch[1];
            const commentEntry = comments && comments[commentUuid];
            if (collectFootnotes && commentEntry) {
              const { text: cText } = rtfToMarkdown(commentEntry.rtf, comments, binderItemMap);
              const cleanCText = (cText || "").trim();
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
          const hex = src.substr(i + 2, 2);
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
  const imageLinks = parseScrImageLinks(converted);
  const marker = extractChapterTitleMarker(converted);

  // Génération du format Body Title exigé par Feuillets (## Title puis ### Subtitle)
  let bodyHeader = "";
  if (marker.title) {
    bodyHeader = `## ${marker.title}\n`;
    if (marker.sousTitre) {
      bodyHeader += `\n### ${marker.sousTitre}\n`;
    }
    bodyHeader += "\n";
  }

  const bodyContent = finalizeConvertedText(marker.title ? marker.rest : converted);

  const res = {
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
  return res;
}

export function extractChapterTitleMarker(text) {
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
  let rest = m[2];

  rawTitle = rawTitle.replace(/<\$ScrKeepWithNext>/g, "").replace(/\*\*|\*/g, "").trim();
  const parts = rawTitle.split(/[\r\n]+/).map((p) => p.trim()).filter(Boolean);

  if (parts.length > 2 || rawTitle.length > 200) {
    return { title: "", sousTitre: "", rest: text };
  }

  const title = parts[0] || "";
  const sousTitre = parts[1] || "";

  return { title, sousTitre, rest };
}

function finalizeConvertedText(raw) {
  let text = raw;

  text = text.replace(/<\$ScrKeepWithNext>/g, "");

  text = text.replace(/\{?\$SCRImageLink\[[^\]]*\][:=]+\$PROJECT:\/\/([^\}\s]+)\}?/gi, (match, rawRef) => {
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    return `\n\n![[${fileName}]]\n\n`;
  });

  text = text.replace(/\$PROJECT:\/\/([^\s"'<>\}\)]+)/gi, (match, rawRef) => {
    const fileName = rawRef.slice(rawRef.lastIndexOf("/") + 1).trim();
    return `\n\n![[${fileName}]]\n\n`;
  });

  text = text.replace(/<!?\$Scr_[a-zA-Z0-9_]+::\d+>/g, (m, offset, fullStr) => {
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