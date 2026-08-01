// @ts-check
import { Notice, TFolder, TFile, normalizePath, type App } from "obsidian";
import { toValue } from "../utils/scene-fields.js";
import { embedHardBreaks } from "../utils/core.js";
import { footnotePrefixFor, applyCompileTransforms } from "../utils/compile-text.js";
import { renumberFootnotesAcrossTexts } from "../utils/footnotes.js";
import { CompileError, toCompileError } from "./compile-errors.js";
import { fmOf, compiledTitleFor, compiledSubtitleFor, stripFrontmatter } from "./frontmatter.js";
import {
  getProjectFolder,
  getOrderedChildren,
  roleOfFolder,
  roleOfFile,
  flattenFiles,
  isFrontMatter,
  FRONT_PAGE_TYPES,
} from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { preserveBlankLinesForFrontPage } from "./export-render.js";
import { parseTitleRoles, hasTitleRoleLines, TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { exportEpub } from "./export-epub.js";
import { exportDocx } from "./export-docx.js";
import { exportPdf } from "./export-pdf.js";
import { exportOdt } from "./export-odt.js";

/** @typedef {{ name: string; color: string }} Label */
/** @typedef {{ [key: string]: unknown }} ProjectMeta */
/** @typedef {{ filPlaceholders: Record<string, string>; filOrigins: Record<string, string>; filResolved: string[] }} NarrativeThreadState */

/** @typedef {{ name: string; fileName: string; folderTitles: boolean; chapterTitles: boolean; sceneTitles: boolean; separator: string; [key: string]: unknown }} PresetConfig */
/** @typedef {{ path: string | null; text: string; frontType: string | null }} CompileSegment */
/** @typedef {{ outPath: string; manuscript: string; segments: CompileSegment[] }} CompileResult */
/** @typedef {{ markdown: string; title: string; author: string; sourcePath: string; segments?: CompileSegment[] }} ExportContext */

type NativeExportSegment = {
  path: string | null;
  text: string;
  frontType?: string;
};

type NativeExportContext = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments: NativeExportSegment[];
};

type PresetConfig = {
  name: string;
  fileName: string;
  folderTitles: boolean;
  chapterTitles: boolean;
  sceneTitles: boolean;
  separator: string;
  [key: string]: unknown;
};

/** Résolution unique des titres de feuillet : Markdown existant, puis YAML,
 * puis (pour les vues contextuelles seulement) un dernier repli Binder. */
export function resolvedFileTitleMarkdown(
  app: App,
  file: TFile,
  body: string,
  wantTitle: boolean,
  level: number,
  binderFallback: string | null = null
): string | null {
  if (!wantTitle) return null;
  const headings = Array.from(body.matchAll(/^(#{1,6})\s+\S.*$/gm));
  const markdownTitleLevel = headings[0]?.[1]?.length || 0;
  const titleLevel = markdownTitleLevel || Math.min(level, 6);
  const subtitleLevel = Math.min(titleLevel + 1, 6);
  const hasTitle = markdownTitleLevel > 0;
  const hasSubtitle = headings.slice(1).some((match) => match[1].length === subtitleLevel);
  const title = hasTitle ? null : (compiledTitleFor(app, file) || binderFallback);
  const subtitle = hasSubtitle ? null : compiledSubtitleFor(app, file);
  const lines: string[] = [];
  if (title) lines.push(`${"#".repeat(titleLevel)} ${title}`);
  if (subtitle) lines.push(`${"#".repeat(subtitleLevel)} ${subtitle}`);
  return lines.length ? lines.join("\n\n") : null;
}

export function activePresetConfig(settings: FeuilletsSettings): PresetConfig {
  const S = settings;
  const base: PresetConfig = {
    name: "Réglages par défaut",
    fileName: toValue(S.compileFileName),
    folderTitles: !!S.insertFolderTitles,
    chapterTitles: !!S.insertTitles,
    sceneTitles: !!S.insertSceneTitles,
    separator: toValue(S.separator),
  };
  const idx = typeof S.activePreset === "number" ? S.activePreset : -1;
  if (idx >= 0 && Array.isArray(S.compilePresets) && S.compilePresets[idx]) {
    return Object.assign({}, base, S.compilePresets[idx] as Record<string, unknown>);
  }
  return base;
}

/** Dossier de sortie de la compilation et des exports — à côté du dossier
 * projet (comme _Recherche et _Snapshots), jamais dedans : le manuscrit
 * compilé ne doit jamais apparaître comme un feuillet de plus dans tes
 * propres vues. Créé automatiquement s'il n'existe pas. */
/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @returns {Promise<TFolder|null>}
 */
export async function getOutputFolder(app: App, settings: FeuilletsSettings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  return await ensureFolder(app, `${base}/Sortie`);
}

/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @param {string|null} [scopePath] fichier ou dossier à compiler ; repli sur
 * le manuscrit complet pour préserver tous les anciens appels.
 * @returns {Promise<CompileResult|null>}
 */
export async function compile(app: App, settings: FeuilletsSettings, scopePath: string | null = null) {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }
  const scoped = scopePath ? app.vault.getAbstractFileByPath(normalizePath(scopePath)) : folder;
  if (!(scoped instanceof TFolder) && !(scoped instanceof TFile)) {
    new Notice("Portée d’export introuvable.");
    return null;
  }
  const P = activePresetConfig(settings);
  const parts: string[] = [];
  let count = 0;

  /**
   * @param {TFile} file
   * @param {string|null|undefined} frontType
   * @returns {Promise<string>}
   */
  const readBody = async (file: TFile, frontType: string | null | undefined = null): Promise<string> => {
    const isFrontPage = !!frontType;
    let content: string;
    try {
      content = await app.vault.cachedRead(file);
    } catch (e) {
      // Un feuillet manquant/illisible ne doit jamais faire échouer toute
      // la compilation avec un message vague : celle-ci s'arrête, mais le
      // message nomme CE feuillet précisément (voir compile(), plus bas,
      // qui affiche describe() et n'attribue jamais l'erreur au projet entier).
      throw new CompileError("lecture du feuillet", "Fichier introuvable ou illisible", {
        filePath: file.path,
        cause: e,
      });
    }
    /* Découpage du frontmatter : helper CENTRAL (services/frontmatter.ts),
       partagé avec l'aperçu — deux expressions régulières concurrentes,
       c'était le défaut où l'aperçu affichait un YAML absent de l'export.
       Il corrige au passage le frontmatter VIDE (`---` suivi de `---`), que
       l'expression locale précédente laissait fuir dans le texte compilé. */
    content = stripFrontmatter(content);
    /* Page Front : on ne rogne PAS les lignes vides de tête/queue comme pour
       une scène normale — sur une page de titre en composition libre, ces
       lignes-là sont la mise en page elle-même (voir
       preserveBlankLinesForFrontPage plus bas). Un seul saut de ligne final
       (fin de fichier standard) est retiré, sinon il compterait comme une
       ligne vide supplémentaire non voulue. */
    content = isFrontPage ? content.replace(/\n$/, "") : content.trim();

    /* Transformations communes à tout texte compilé, extraites pour pouvoir
       s'appliquer aussi bloc par bloc sur une page de titre à rôles (voir
       plus bas), pas seulement sur le corps entier d'un coup :
       - renumérotation des notes de bas de page : chaque fichier numérote
         ses notes à partir de 1 sans savoir que la compilation les
         concatène ; sans ce préfixe, deux [^1] pointeraient sur la même note.
       - retrait des wikiliens ([[…]]) : outil d'organisation du coffre, pas
         du texte de roman ; l'alias ou la cible est conservé comme texte, et
         un EMBED ![[image.png]] (?<!!) est laissé intact pour rester une image.
       - typographie française : guillemets/apostrophe/points de suspension/
         espaces insécables garantis même sans la frappe typographique
         (texte collé d'un traitement externe…). Réglable (Réglages → Export). */
    const footnotePrefix = footnotePrefixFor(file.path);
    /** @param {string} str */
    const applyTextTransforms = (str: string): string =>
      applyCompileTransforms(str, footnotePrefix, !!settings.exportFrenchTypography);

    /* Page de titre à rôles : chaque ligne `:::rôle: contenu` devient un
       paragraphe-marqueur `FEUILLETS-FPROLE:rôle` suivi de son contenu, que
       chaque export stylera d'après `titlePage.styles.<rôle>` du modèle. Ici
       l'espacement vient des marges du modèle, donc pas de préservation de
       lignes vides : elles sont simplement ignorées (voir parseTitleRoles).
       Repli sur le chemin WYSIWYG plus bas si la page ne contient aucun rôle
       (composition libre). */
    if (frontType === "titre" && hasTitleRoleLines(content)) {
      const md = parseTitleRoles(content)
        .map((b) => {
          /* Dans un bloc de rôle, « / » (entouré ou non d'espaces) est un
             saut de ligne À L'INTÉRIEUR du bloc (interligne simple), pas un
             séparateur de paragraphe : `:::mots: 71 800 mots / 427 000 signes`
             s'affiche sur deux lignes. Converti en saut de ligne simple ici ;
             embedHardBreaks le transforme ensuite en saut forcé (<br>). */
          const c = applyTextTransforms(b.content.split(/\s*\/\s*/).join("\n"));
          return b.role ? `${TITLE_ROLE_MARKER}${b.role}\n\n${c}` : c;
        })
        .join("\n\n");
      return embedHardBreaks(md);
    }

    content = applyTextTransforms(content);

    /* On ne SUPPRIME jamais les lignes vides : en Markdown, la ligne vide
       SÉPARE deux paragraphes. Sur une page Front en composition libre
       (dédicace/épigraphe, ou page de titre sans rôles), chaque ligne vide
       tapée doit rester une ligne blanche réelle à l'export — voir
       preserveBlankLinesForFrontPage. Le corps de roman normal, lui, garde
       ses paragraphes séparés, leur apparence étant décidée par le style
       (interligne, alinéa) et non par des lignes vides. */
    if (isFrontPage) content = preserveBlankLinesForFrontPage(content);
    return embedHardBreaks(content);
  };

  /* En parallèle de `parts` (texte plat, inchangé — utilisé par Pandoc/EPUB
     et par le fichier Manuscrit.md écrit dans le coffre) : `segments` garde
     la même succession de blocs mais avec le chemin du feuillet d'origine
     (null pour un titre de partie/chapitre, sans fiche propre) et son
     éventuel `frontType` (page Front spéciale : "titre"/"dedicace"/
     "epigraphe", voir folder-structure.js). Sert aux exports natifs (voir
     chaque export-*.js) pour poser un signet par feuillet et distinguer les
     pages Front — jamais écrit tel quel dans un fichier, jamais transmis à
     Pandoc : aucun risque de faire fuiter un marqueur dans du texte visible
     (contrairement à l'erreur des commentaires HTML pour les citations,
     plus tôt). */
  const segments: CompileSegment[] = [];
  /**
   * @param {string} text
   * @param {string|null} path
   * @param {string|null|undefined} [frontType]
   */
  const push = (text: string, path: string | null, frontType: string | null | undefined = null): void => {
    parts.push(text);
    /** @type {CompileSegment} */
    const seg = { path: path || null, text, frontType: frontType || null };
    segments.push(seg);
  };

  /**
   * @param {TFile} file
   * @param {string} role
   * @param {number} depth
   */
  const pushFile = async (file: TFile, role: string, depth: number) => {
    const fm = fmOf(app, file);
    if (fm.compile === false) return;

    /* Page Front spéciale (titre/dédicace/épigraphe) : jamais de titre de
       chapitre ni de numérotation — juste le corps, avec sa propre mise en
       forme dédiée appliquée par chaque export-*.js à partir de frontType. */
    const normalizedFrontType = typeof fm.type === "string" ? fm.type.trim().toLowerCase() : "";
    const isFront = isFrontMatter(app, settings, file) && FRONT_PAGE_TYPES.includes(normalizedFrontType);
    const body = await readBody(file, isFront ? normalizedFrontType : undefined);

    if (isFront) {
      push(body, file.path, normalizedFrontType);
      count++;
      return;
    }

    const wantTitle = role === "scene" ? P.sceneTitles : P.chapterTitles;
    const title = resolvedFileTitleMarkdown(app, file, body, wantTitle, depth + 1);
    if (title) {
      push(`${title}\n\n${body}`, file.path, null);
    } else {
      push(body, file.path, null);
    }
    count++;
  };

  /**
   * @param {TFolder} f
   * @param {number} depth
   */
  const walk = async (f: TFolder, depth: number) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        /* Le dossier Front lui-même n'est jamais un titre de partie/chapitre
           à afficher — ses pages (titre/dédicace/épigraphe) précèdent le
           roman, elles n'en font pas narrativement partie. */
        const isFrontFolder = isFrontMatter(app, settings, child);
        const role = roleOfFolder(app, settings, child);
        const level = "#".repeat(Math.min(depth + 1, 6));
        if (role === "partie") {
          if (P.folderTitles && !isFrontFolder) push(`${level} ${child.name}`, null, null);
          await walk(child, depth + 1);
        } else {
          if (P.chapterTitles && !isFrontFolder) push(`${level} ${child.name}`, null, null);
          for (const sc of flattenFiles(app, settings, child)) {
            await pushFile(sc, "scene", depth + 1);
          }
        }
      } else {
        await pushFile(child, roleOfFile(app, settings, child), depth);
      }
    }
  };
  try {
    if (scoped instanceof TFile) await pushFile(scoped, roleOfFile(app, settings, scoped), 0);
    else await walk(scoped, 0);
  } catch (e) {
    // Jamais une exception non gérée qui remonterait comme un plantage
    // générique : un message contextualisé (feuillet + étape), le reste du
    // projet n'est pas mis en cause — la compilation s'arrête proprement ici.
    const err = toCompileError(e, "compilation");
    new Notice(err.describe());
    return null;
  }

  if (count === 0) {
    new Notice("Aucun feuillet à compiler.");
    return null;
  }
  /* Chaque feuillet source numérote ses propres notes à partir de 1, sans
     savoir que la compilation les concatène : footnotePrefixFor/
     renamespaceFootnotes (appliqués plus haut, par feuillet, dans readBody)
     évitent déjà les collisions d'identifiants entre fichiers. Ceci
     renumérote ENSUITE le manuscrit compilé en 1, 2, 3… continu dans l'ordre
     du document — un confort de lecture, jamais une modification des
     fichiers sources : ni `parts` ni `segments` ne sont relus depuis le
     disque, seule la copie en mémoire écrite dans Manuscrit.md (et donnée
     aux exports natifs) est renumérotée.
     `segments[i].text` DOIT rester synchronisé avec `parts[i]` (même ordre,
     même longueur, `push()` les alimente ensemble) : certains exports
     (pages Front, voir renderManuscriptHtmlWithFrontPages) reconstruisent
     leur propre markdown à partir de `segments`, pas de la chaîne jointe —
     renuméroter l'un sans l'autre romprait la numérotation vue par
     l'utilisatrice selon le format exporté. */
  if (settings.footnoteRenumberOnCompile !== false) {
    const renumberedParts = renumberFootnotesAcrossTexts(parts);
    for (let idx = 0; idx < segments.length; idx++) {
      segments[idx] = { ...segments[idx], text: renumberedParts[idx] };
    }
    parts.length = 0;
    parts.push(...renumberedParts);
  }
  const manuscript = parts.join(P.separator || "\n\n");
  const outputFolder = await getOutputFolder(app, settings);
  const outBase = outputFolder ? outputFolder.path : folder.path;
  const outPath = normalizePath(`${outBase}/${P.fileName || "Manuscrit.md"}`);
  const existing = app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, manuscript);
  } else {
    await app.vault.create(outPath, manuscript);
  }
  new Notice(
    `Manuscrit compilé (${P.name}) : ${count} feuillets → ${P.fileName || "Manuscrit.md"}`
  );
  /** @type {CompileResult} */
  return { outPath, manuscript, segments };
}

/**
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @param {TFolder|null} folder
 * @returns {ProjectMeta}
 */
export function projectMetaFor(settings: FeuilletsSettings, folder: TFolder | null) {
  if (!folder) return {};
  return settings.projectMeta[folder.path] || {};
}

/** Liste, sans lire ni construire de texte, les chemins de tous les
 * feuillets qu'une compilation inclurait (mêmes règles que compile() :
 * même parcours, même exclusion `compiler: false`/`compile: false`) — sert
 * à reconstruire la correspondance signet -> feuillet à la lecture d'un
 * .docx annoté renvoyé par un directeur/éditeur (voir utils/docx-bookmarks.js
 * et services/docx-review-import.js) : le lecteur recalcule l'identifiant de
 * signet pour chaque chemin ACTUEL ici et retrouve ainsi de quel feuillet
 * vient chaque signet rencontré dans le docx, sans avoir à recompiler. */
/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @returns {string[]}
 */
export function listCompiledFilePaths(app: App, settings: FeuilletsSettings) {
  const folder = getProjectFolder(app, settings);
  if (!folder) return [];
  const paths: string[] = [];
  /**
   * @param {TFolder} f
   */
  const visit = (f: TFolder) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        const role = roleOfFolder(app, settings, child);
        if (role === "partie") {
          visit(child);
        } else {
          for (const sc of flattenFiles(app, settings, child)) {
            const fm = fmOf(app, sc);
            if (fm.compile === false) continue;
            paths.push(sc.path);
          }
        }
      } else {
        const fm = fmOf(app, child);
        if (fm.compile === false) continue;
        paths.push(child.path);
      }
    }
  };
  visit(folder);
  return paths;
}

/** Point d'entrée de l'export : route vers le moteur natif (zéro dépendance,
 * fonctionne partout dont mobile). */
export async function exportFile(app: App, settings: FeuilletsSettings, format = "docx", scopePath: string | null = null) {
  return exportViaNative(app, settings, format, scopePath);
}

/** Compile puis rend via le moteur natif (MarkdownRenderer d'Obsidian +
 * bibliothèques JS pures `docx`/`jszip`) — aucune dépendance externe,
 * fonctionne desktop et mobile (sauf PDF, desktop uniquement — voir
 * export-pdf.js). Réutilise `compile()` tel quel : seule la conversion
 * finale change de moteur. */
/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @param {string} format
 * @returns {Promise<void>}
 */
async function exportViaNative(app: App, settings: FeuilletsSettings, format: string, scopePath: string | null = null) {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  const result = await compile(app, settings, scopePath);
  if (!result) return;

  const meta = projectMetaFor(settings, folder);
  let title = toValue(settings.manuscriptTitle) || folder.name;
  const author = toValue(settings.manuscriptAuthor) || toValue(meta.author);
  /* Le titre affiché en en-tête (et dans les métadonnées du fichier) doit
     rester celui réellement composé sur la page de titre — une seule
     source de vérité — plutôt que le nom du dossier projet ou un titre
     réglé séparément dans les paramètres, qu'on oublierait facilement de
     synchroniser. Repli sur le titre des paramètres si la page de titre
     n'a pas encore de champ `titre` renseigné. */
  const titrePageSeg = result.segments.find((s) => s.frontType === "titre" && s.path);
  if (titrePageSeg && titrePageSeg.path) {
    const titreFile = app.vault.getAbstractFileByPath(titrePageSeg.path);
    if (titreFile instanceof TFile) {
      const titreFm = fmOf(app, titreFile);
      if (typeof titreFm.title === "string" && titreFm.title.trim()) {
        title = titreFm.title.trim();
      }
    }
  }
  /* Le fichier compilé réel (result.outPath) plutôt que le dossier projet :
     la résolution des embeds (![[image.png]]) par Obsidian a besoin d'un
     chemin de FICHIER pour son contexte de répertoire — un chemin de
     dossier peut fausser la résolution des liens relatifs. */
  const sourcePath = result.outPath;
  const outputFolder = await getOutputFolder(app, settings);
  const outBase = outputFolder ? outputFolder.path : folder.path;
  const P = activePresetConfig(settings);
  const baseName = (P.fileName || "Manuscrit.md").replace(/\.md$/i, "");
  const segments: NativeExportSegment[] = result.segments.map(({ path, text, frontType }) =>
    frontType === null ? { path, text } : { path, text, frontType }
  );
  const ctx: NativeExportContext = { markdown: result.manuscript, title, author, sourcePath, segments };

  try {
    if (format === "epub") {
      const data = await exportEpub(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.epub`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "docx") {
      const data = await exportDocx(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.docx`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "odt") {
      const data = await exportOdt(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.odt`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "pdf") {
      await exportPdf(app, settings, ctx);
    } else {
      new Notice(`Format d'export inconnu : ${format}`);
    }
  } catch (e) {
    console.error("Feuillets: export natif", e);
    const err = toCompileError(e, `export ${format}`, { format });
    new Notice(err.describe().slice(0, 300));
  }
}

/**
 * @param {import("obsidian").App} app
 * @param {string} path
 * @param {Uint8Array|Blob|ArrayBuffer} data
 * @returns {Promise<void>}
 */
async function writeBinaryFile(app: App, path: string, data: Uint8Array | Blob | ArrayBuffer) {
  let buf: ArrayBuffer;
  if (data instanceof ArrayBuffer) {
    buf = data;
  } else if (data instanceof Uint8Array) {
    buf = data.buffer as ArrayBuffer;
  } else {
    buf = await data.arrayBuffer();
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
  } else {
    await app.vault.createBinary(path, buf);
  }
}


