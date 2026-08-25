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
  getProjectRoot,
  getOrderedChildren,
  roleOfFolder,
  roleOfFile,
  flattenFiles,
  isFrontMatter,
  FRONT_PAGE_TYPES,
  feuilletsAuxiliaryPath,
  MANUSCRIPT_FOLDER_NAME,
} from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { preserveBlankLinesForFrontPage } from "./export-render.js";
import { parseTitleRoles, hasTitleRoleLines, TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { exportEpub } from "./export-epub.js";
import { exportDocx } from "./export-docx.js";
import { exportPdf } from "./export-pdf.js";
import { exportOdt } from "./export-odt.js";
import { type CompileScope, resolveCompileScopeFiles, createProjectScope } from "./compile-scope.js";
import { SUMMARY, TOC, TABLES, BIBLIOGRAPHY, ANNEXES, readGeneratedIncluded } from "./book-composition.js";
import { generateSummary, generateTableOfContents } from "./contents-generator.js";
import type { GeneratedContentsKind } from "./generated-contents.js";
import { generateTableOfIllustrations } from "./tables-generator.js";
import { bibliographyEntries, generateBibliography } from "./bibliography-generator.js";
import { loadLayoutStore, layoutOverridesForFile, relativeLayoutFilePath } from "./layout-store.js";
import { injectDocumentLayoutMarkers } from "./document-layout.js";
import { selectedContentVariant, type ContentVariant } from "./content-variants.js";
import type { ContentExtraction } from "./content-extractions.js";
import { extractSectionsByRoles } from "./content-section-extraction.js";

/** Les deux noms reconnus pour le dossier Annexes, à la RACINE du dossier
 * Manuscrit — même convention de double reconnaissance (FR/EN) que
 * Bibliographie/Bibliography (services/bibliography-generator.ts). */
const ANNEXES_FOLDER_NAMES = ["Annexes", "Appendices"];

/** Dossier Annexes/Appendices du projet, s'il existe — utilisé aussi bien
 * par la compilation (ci-dessous) que par ui/annexes-panel.ts (décompte,
 * bouton « Ouvrir le dossier »). */
export function annexesFolder(app: App, projectRoot: TFolder | null): TFolder | null {
  if (!projectRoot) return null;
  for (const name of ANNEXES_FOLDER_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${projectRoot.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Feuillets Markdown directement dans Annexes/Appendices, DANS L'ORDRE DU
 * PROJET (getOrderedChildren — même service que le Binder et la
 * compilation, aucun second système d'ordre) — sans égard à leur
 * frontmatter `compile`, qui reste une décision de la compilation elle-
 * même (voir plus bas), pas de ce décompte. */
export function annexesFiles(app: App, settings: FeuilletsSettings, projectRoot: TFolder | null): TFile[] {
  const folder = annexesFolder(app, projectRoot);
  if (!folder) return [];
  const out: TFile[] = [];
  for (const child of getOrderedChildren(app, settings, folder)) {
    if (child instanceof TFile && child.extension === "md") out.push(child);
  }
  return out;
}

/** Formats d'export réellement implémentés dans Feuillets.
 * À maintenir en synchro avec les branches de exportViaNative(). */
export type ExportFormat = "md" | "epub" | "docx" | "odt" | "pdf";
export const SUPPORTED_EXPORT_FORMATS: ExportFormat[] = ["epub", "docx", "odt", "pdf", "md"];

/** @typedef {{ name: string; color: string }} Label */
/** @typedef {{ [key: string]: unknown }} ProjectMeta */
/** @typedef {{ filPlaceholders: Record<string, string>; filOrigins: Record<string, string>; filResolved: string[] }} NarrativeThreadState */

/** @typedef {{ name: string; fileName: string; folderTitles: boolean; chapterTitles: boolean; sceneTitles: boolean; separator: string; [key: string]: unknown }} PresetConfig */
type CompileSegment = { path: string | null; text: string; renderText?: string; frontType: string | null; generatedType?: GeneratedContentsKind; sourceTitle?: string | null; sourceSubtitle?: string | null; startsWithGeneratedTitle?: boolean; structuralType?: "part" };
/** @typedef {{ outPath: string; manuscript: string; segments: CompileSegment[] }} CompileResult */
/** @typedef {{ markdown: string; title: string; author: string; sourcePath: string; segments?: CompileSegment[] }} ExportContext */

type NativeExportSegment = {
  path: string | null;
  text: string;
  renderText?: string;
  frontType?: string;
  generatedType?: GeneratedContentsKind;
  sourceTitle?: string | null;
  sourceSubtitle?: string | null;
  startsWithGeneratedTitle?: boolean;
  structuralType?: "part";
};

type NativeExportContext = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments: NativeExportSegment[];
  contentVariant: ContentVariant | null;
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

/** Nom de base (sans extension) de la sortie compilée : résolu ICI, UNE
 * SEULE FOIS, puis réutilisé tel quel par compile() (Markdown) et
 * exportViaNative() (formats binaires) — jamais deux résolutions
 * concurrentes du même nom qui pourraient diverger. Priorité : nom explicite
 * transmis par l'appelant pour CETTE compilation/cet export précis (portée
 * fichier/dossier/sélection avec son propre nom, voir exportWithScope),
 * sinon le nom du preset actif s'il en définit un — activePresetConfig()
 * fusionne déjà preset.fileName > compileFileName legacy (réglage conservé
 * pour compatibilité depuis le retrait du champ « Nom du fichier » de
 * Édition, voir ui/export-panel.ts) — sinon repli "Manuscrit". */
function resolveOutputBaseName(settings: FeuilletsSettings, explicit?: string | null): string {
  if (explicit) return explicit.replace(/\.md$/i, "");
  const P = activePresetConfig(settings);
  return P.fileName ? P.fileName.replace(/\.md$/i, "") : "Manuscrit";
}

/** Une erreur `create()`/`createBinary()` correspondant à une collision de
 * fichier — jamais une autre erreur masquée derrière ce nom générique
 * (l'API Obsidian ne définit pas de sous-classe dédiée, seul le message le
 * dit : "File already exists."). */
function isFileAlreadyExistsError(e: unknown): boolean {
  return e instanceof Error && /already exists/i.test(e.message);
}

/** Cherche, DANS LE MÊME DOSSIER que `path`, un TFile dont le nom est égal
 * à celui de `path` à la casse près — jamais un fichier d'un autre dossier.
 * Sert à retrouver, sur un système de fichiers insensible à la casse
 * (macOS, Windows), le fichier RÉEL déjà écrit sous une casse différente :
 * l'index Obsidian, lui, reste sensible à la casse et ne le retrouve pas
 * via un simple `getAbstractFileByPath(path)`. */
function findCaseInsensitiveMatch(app: App, path: string): TFile | null {
  const exact = app.vault.getAbstractFileByPath(path);
  if (exact instanceof TFile) return exact;
  const slash = path.lastIndexOf("/");
  const folderPath = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const parent = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
  if (!(parent instanceof TFolder)) return null;
  const lowerName = name.toLowerCase();
  for (const child of parent.children) {
    if (child instanceof TFile && child.name.toLowerCase() === lowerName) return child;
  }
  return null;
}

/** Écrit `path` en MODIFIANT le fichier existant plutôt qu'en le recréant,
 * y compris quand seule sa CASSE diffère (voir findCaseInsensitiveMatch) —
 * remplace le duo `getAbstractFileByPath` + `create`/`modify` auparavant
 * dupliqué entre Markdown (compile(), plus bas) et binaire
 * (writeBinaryFile(), plus bas) : sur un système de fichiers insensible à
 * la casse, ce duo pouvait rater un fichier existant nommé différemment en
 * casse et tenter un `create()` qui échoue avec `Error: File already
 * exists.` (l'index Obsidian, lui, EST sensible à la casse — d'où le
 * `Uncaught (in promise) Error: File already exists.` réellement observé).
 * Une collision apparue ENTRE la recherche et `create()` (course : un autre
 * appel a écrit le fichier entretemps) est elle aussi absorbée — la cible
 * est retrouvée une seconde fois et modifiée ; toute autre erreur de
 * `create()`/`createBinary()` est propagée telle quelle, jamais masquée. */
async function writeResolvingCaseCollision(
  app: App,
  path: string,
  modify: (existing: TFile) => Promise<unknown>,
  create: (path: string) => Promise<unknown>
): Promise<{ path: string }> {
  const existing = findCaseInsensitiveMatch(app, path);
  if (existing) {
    await modify(existing);
    return { path: existing.path };
  }
  try {
    await create(path);
    return { path };
  } catch (e) {
    if (!isFileAlreadyExistsError(e)) throw e;
    const raced = findCaseInsensitiveMatch(app, path);
    if (!raced) throw e;
    await modify(raced);
    return { path: raced.path };
  }
}

/** Dossier de sortie de la compilation et des exports.
 *
 * CAS A — le projet suit la convention (dossier `settings.projectFolder`
 * nommé exactement "Manuscrit") : _Sortie est posé À CÔTÉ de Manuscrit, dans
 * son dossier parent (comme _Recherche et _Snapshots), jamais dedans — le
 * manuscrit compilé ne doit jamais apparaître comme un feuillet de plus
 * dans tes propres vues.
 *
 * CAS B — le projet est un dossier "libre" (nom quelconque, contenant
 * directement les chapitres, pas de dossier Manuscrit dédié) : _Sortie est
 * un enfant DIRECT de ce dossier, jamais un niveau au-dessus. Piège à
 * éviter : `getProjectRoot` (folder-structure.ts) remonte TOUJOURS d'un
 * niveau sans vérifier le nom du dossier — inadapté ici, on distingue donc
 * les deux cas explicitement sur le nom, pas sur une heuristique de
 * structure de fichiers.
 *
 * CAS C — pas de dossier projet configuré : null.
 *
 * Créé automatiquement s'il n'existe pas. */
/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @returns {Promise<TFolder|null>}
 */
export async function getOutputFolder(app: App, settings: FeuilletsSettings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const parent = root.parent;
  const base =
    root.name === MANUSCRIPT_FOLDER_NAME && parent instanceof TFolder && parent.path !== "" && parent.path !== "/"
      ? parent
      : root;
  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "output"));
  if (canonical instanceof TFolder) return canonical;
  const legacy = app.vault.getAbstractFileByPath(normalizePath(`${base.path}/_Sortie`));
  if (legacy instanceof TFolder) return legacy;
  return await ensureFolder(app, feuilletsAuxiliaryPath(root, "output"));
}

export type CompileOptions = {
  writeOutput?: boolean;
  contentExtraction?: ContentExtraction | null;
};

/**
 * Compile l'ensemble des feuillets d'un projet selon le preset actif.
 *
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @param {string|null} [scopePath]
 * @param {CompileScope|null} [scope]
 * @param {string|null} [outputFileName]
 * @param {CompileOptions} [options]
 * @returns {Promise<CompileResult|null>}
 */
export async function compile(
  app: App,
  settings: FeuilletsSettings,
  scopePath: string | null = null,
  scope?: CompileScope | null,
  outputFileName?: string | null,
  options?: CompileOptions
) {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }

  // Déterminer la portée à utiliser
  let compilationScope: CompileScope;
  if (scope) {
    compilationScope = scope;
  } else if (scopePath) {
    // Comportement legacy: convertir scopePath en portée
    const scoped = app.vault.getAbstractFileByPath(normalizePath(scopePath));
    if (scoped instanceof TFile && scoped.extension === "md") {
      compilationScope = { type: "file", projectRoot: folder.path, path: scoped.path };
    } else if (scoped instanceof TFolder) {
      compilationScope = { type: "folder", projectRoot: folder.path, path: scoped.path };
    } else {
      new Notice("Portée d’export introuvable.");
      return null;
    }
  } else {
    // Portée par défaut: projet complet
    compilationScope = createProjectScope(folder.path);
  }

  // Résoudre la portée en liste de fichiers
  const filesToCompile = resolveCompileScopeFiles(app, settings, compilationScope);
  if (filesToCompile.length === 0) {
    new Notice("Aucun feuillet à compiler.");
    return null;
  }

  const P = activePresetConfig(settings);
  const layoutStore = await loadLayoutStore(app, settings);
  const parts: string[] = [];
  let count = 0;
  const fileSet = new Set(filesToCompile.map((f) => f.path));

  /**
   * @param {TFile} file
   * @param {string|null|undefined} frontType
   * @returns {Promise<{ text: string; renderText: string } | null>}
   */
  const readBody = async (file: TFile, frontType: string | null | undefined = null): Promise<{ text: string; renderText: string } | null> => {
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
    const relativeLayoutPath = relativeLayoutFilePath(folder.path, file.path) || file.path;
    let renderSource = injectDocumentLayoutMarkers(content, layoutOverridesForFile(layoutStore, relativeLayoutPath));
    if (options?.contentExtraction) {
      const extracted = extractSectionsByRoles(content, options.contentExtraction.triggerRoles);
      if (extracted.length === 0) return null;
      content = extracted.map((section) => section.markdown).join("\n\n");
      const renderSections = extractSectionsByRoles(renderSource, options.contentExtraction.triggerRoles);
      renderSource = renderSections.map((section) => section.markdown).join("\n\n");
    }
    content = stripFrontmatter(content);
    let renderContent = stripFrontmatter(renderSource);
    /* Page Front : on ne rogne PAS les lignes vides de tête/queue comme pour
       une scène normale — sur une page de titre en composition libre, ces
       lignes-là sont la mise en page elle-même (voir
       preserveBlankLinesForFrontPage plus bas). Un seul saut de ligne final
       (fin de fichier standard) est retiré, sinon il compterait comme une
       ligne vide supplémentaire non voulue. */
    content = isFrontPage ? content.replace(/\n$/, "") : content.trim();
    renderContent = isFrontPage ? renderContent.replace(/\n$/, "") : renderContent.trim();

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
      return { text: embedHardBreaks(md), renderText: embedHardBreaks(md) };
    }

    content = applyTextTransforms(content);
    renderContent = applyTextTransforms(renderContent);

    /* On ne SUPPRIME jamais les lignes vides : en Markdown, la ligne vide
       SÉPARE deux paragraphes. Sur une page Front en composition libre
       (dédicace/épigraphe, ou page de titre sans rôles), chaque ligne vide
       tapée doit rester une ligne blanche réelle à l'export — voir
       preserveBlankLinesForFrontPage. Le corps de roman normal, lui, garde
       ses paragraphes séparés, leur apparence étant décidée par le style
       (interligne, alinéa) et non par des lignes vides. */
    if (isFrontPage) { content = preserveBlankLinesForFrontPage(content); renderContent = preserveBlankLinesForFrontPage(renderContent); }
    return { text: embedHardBreaks(content), renderText: embedHardBreaks(renderContent) };
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
  /* Annexes (Phase 9) : compilées à PART du corps principal (voir walk(),
     qui les exclut explicitement en portée project) puis insérées après
     Bibliographie — jamais dans `parts`/`segments` directement, tant que
     leur insertion réelle n'a pas eu lieu. `push`/`pushFile` acceptent donc
     un couple de tableaux cible optionnel (par défaut `parts`/`segments`)
     plutôt que de dupliquer toute la logique de lecture/titre pour elles. */
  const annexParts: string[] = [];
  const annexSegments: CompileSegment[] = [];

  /**
   * @param {string} text
   * @param {string|null} path
   * @param {string|null|undefined} [frontType]
   * @param {string[]} [targetParts]
   * @param {CompileSegment[]} [targetSegments]
   * @returns {Promise<boolean>}
   */
  const push = (
    text: string,
    path: string | null,
    frontType: string | null | undefined = null,
    targetParts: string[] = parts,
    targetSegments: CompileSegment[] = segments
  ): void => {
    targetParts.push(text);
    /** @type {CompileSegment} */
    const seg = { path: path || null, text, frontType: frontType || null };
    targetSegments.push(seg);
  };

  /**
   * @param {TFile} file
   * @param {string} role
   * @param {number} depth
   * @param {string[]} [targetParts]
   * @param {CompileSegment[]} [targetSegments]
   */
  const pushFile = async (
    file: TFile,
    role: string,
    depth: number,
    targetParts: string[] = parts,
    targetSegments: CompileSegment[] = segments
  ) => {
    const fm = fmOf(app, file);
    if (fm.compile === false) return false;

    // Respecter la portée: ignorer les fichiers hors de la liste résolue
    if (!fileSet.has(file.path)) return false;

    /* Page Front spéciale (titre/dédicace/épigraphe) : jamais de titre de
       chapitre ni de numérotation — juste le corps, avec sa propre mise en
       forme dédiée appliquée par chaque export-*.js à partir de frontType. */
    const normalizedFrontType = typeof fm.type === "string" ? fm.type.trim().toLowerCase() : "";
    const isFront = isFrontMatter(app, settings, file) && FRONT_PAGE_TYPES.includes(normalizedFrontType);
    const body = await readBody(file, isFront ? normalizedFrontType : undefined);
    if (!body) return false;
    const sourceTitle = compiledTitleFor(app, file) || null;
    const sourceSubtitle = compiledSubtitleFor(app, file) || null;

    if (isFront) {
      push(body.text, file.path, normalizedFrontType, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = body.renderText;
      Object.assign(targetSegments[targetSegments.length - 1], { sourceTitle, sourceSubtitle });
      count++;
      return true;
    }

    const wantTitle = role === "scene" ? P.sceneTitles : P.chapterTitles;
    const title = resolvedFileTitleMarkdown(app, file, body.text, wantTitle, depth + 1);
    if (title) {
      push(`${title}\n\n${body.text}`, file.path, null, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = `${title}\n\n${body.renderText}`;
    } else {
      push(body.text, file.path, null, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = body.renderText;
    }
    Object.assign(targetSegments[targetSegments.length - 1], { sourceTitle, sourceSubtitle });
    if (title) targetSegments[targetSegments.length - 1].startsWithGeneratedTitle = true;
    count++;
    return true;
  };

  /* Ensemble des dossiers autorisés à produire un titre, selon la portée.
     - file       : ensemble vide — aucun titre de dossier.
     - folder     : le dossier cible et ses sous-dossiers qui contiennent
                    au moins un fichier retenu.
     - selection  : pour chaque fichier retenu, ses ancêtres depuis la
                    racine du projet jusqu'au dossier parent direct.
     - project    : null = pas de restriction (comportement actuel complet).
     Un dossier sans aucun fichier retenu dans fileSet n'est jamais ajouté. */
  let allowedTitleFolders: Set<string> | null = null;

  if (compilationScope.type === "file") {
    allowedTitleFolders = new Set();
  } else if (compilationScope.type === "folder") {
    allowedTitleFolders = new Set();
    const folderRoot = app.vault.getAbstractFileByPath(compilationScope.path);
    if (folderRoot instanceof TFolder) {
      /* Parcours du sous-arbre : un dossier est autorisé ssi au moins
         un de ses descendants directs ou indirects est dans fileSet. */
      const markAllowed = (f: TFolder): boolean => {
        let hasRetained = false;
        for (const child of getOrderedChildren(app, settings, f)) {
          if (child instanceof TFile) {
            if (fileSet.has(child.path)) hasRetained = true;
          } else if (child instanceof TFolder) {
            if (markAllowed(child)) {
              hasRetained = true;
            }
          }
        }
        if (hasRetained) allowedTitleFolders!.add(f.path);
        return hasRetained;
      };
      markAllowed(folderRoot);
    }
  } else if (compilationScope.type === "selection") {
    allowedTitleFolders = new Set();
    for (const filePath of fileSet) {
      /* Remonter chaque fichier retenu jusqu'à la racine du projet,
         en ajoutant chaque dossier intermédiaire (sauf la racine elle-même
         du projet, qui n'est pas un titre de partie/chapitre narratif). */
      const parts = filePath.split("/");
      for (let i = parts.length - 1; i > 0; i--) {
        const ancestorPath = parts.slice(0, i).join("/");
        if (ancestorPath === compilationScope.projectRoot) break;
        allowedTitleFolders.add(ancestorPath);
      }
    }
  }
  // project : allowedTitleFolders reste null → comportement inchangé.

  /* Annexes (Phase 9) : à la RACINE du Manuscrit, EN PORTÉE PROJECT
     UNIQUEMENT — walk() les exclut ci-dessous et une passe séparée les
     compile après coup (voir le bloc suivant), pour pouvoir les insérer
     après Bibliographie plutôt qu'à leur place naturelle dans l'arbre.
     `null` pour toute autre portée : walk() ne les traite alors pas
     différemment d'un dossier ordinaire — comportement inchangé pour
     file/folder/selection, exactement comme demandé. */
  const annexesFolderRef = compilationScope.type === "project" ? annexesFolder(app, folder) : null;

  /**
   * @param {TFolder} f
   * @param {number} depth
   */
  const walk = async (f: TFolder, depth: number, targetParts: string[] = parts, targetSegments: CompileSegment[] = segments) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        if (annexesFolderRef && child.path === annexesFolderRef.path) continue;
        /* Le dossier Front lui-même n'est jamais un titre de partie/chapitre
           à afficher — ses pages (titre/dédicace/épigraphe) précèdent le
           roman, elles n'en font pas narrativement partie. */
        const isFrontFolder = isFrontMatter(app, settings, child);
        const role = roleOfFolder(app, settings, child);
        const level = "#".repeat(Math.min(depth + 1, 6));
        /* N'émettre le titre du dossier que si :
           - la portée ne restreint pas les titres (allowedTitleFolders === null), OU
           - ce dossier fait explicitement partie de l'ensemble autorisé. */
        const titleAllowed = allowedTitleFolders === null || allowedTitleFolders.has(child.path);
        if (options?.contentExtraction) {
          const folderParts: string[] = [];
          const folderSegments: CompileSegment[] = [];
          if (role === "partie") {
            await walk(child, depth + 1, folderParts, folderSegments);
          } else {
            for (const sc of flattenFiles(app, settings, child)) {
              await pushFile(sc, "scene", depth + 1, folderParts, folderSegments);
            }
          }
          if (folderSegments.length > 0) {
            const showTitle = role === "partie" ? P.folderTitles : P.chapterTitles;
            if (showTitle && !isFrontFolder && titleAllowed) {
              push(`${level} ${child.name}`, null, null, targetParts, targetSegments);
              const titleSegment = targetSegments[targetSegments.length - 1];
              if (role === "partie") Object.assign(titleSegment, { startsWithGeneratedTitle: true, structuralType: "part" });
              else titleSegment.startsWithGeneratedTitle = true;
            }
            targetParts.push(...folderParts);
            targetSegments.push(...folderSegments);
          }
        } else if (role === "partie") {
          if (P.folderTitles && !isFrontFolder && titleAllowed) { push(`${level} ${child.name}`, null, null); Object.assign(segments[segments.length - 1], { startsWithGeneratedTitle: true, structuralType: "part" }); }
          await walk(child, depth + 1);
        } else {
          if (P.chapterTitles && !isFrontFolder && titleAllowed) { push(`${level} ${child.name}`, null, null); segments[segments.length - 1].startsWithGeneratedTitle = true; }
          for (const sc of flattenFiles(app, settings, child)) {
            await pushFile(sc, "scene", depth + 1);
          }
        }
      } else {
        await pushFile(child, roleOfFile(app, settings, child), depth, targetParts, targetSegments);
      }
    }
  };
  /* `meta` : lu une seule fois, avant tout parcours — sert à la fois à
     décider si les annexes doivent être compilées à part (ci-dessous, DANS
     le même filet try/catch que le reste) et, plus bas, à Sommaire/TDM/
     Tables/Bibliographie. */
  const meta = compilationScope.type === "project" ? projectMetaFor(settings, folder) : null;
  const wantAnnexes = meta ? readGeneratedIncluded(meta, ANNEXES) ?? false : false;
  try {
    // Compiler en respectant la structure du projet
    // La vérification fileSet dans pushFile() respectera la portée résolue
    await walk(folder, 0);

    /* Annexes, compilées À PART (jamais dans `parts`/`segments` tant
       qu'elles ne sont pas insérées plus bas) : mêmes transformations
       normales que n'importe quel feuillet (readBody, titre via
       resolvedFileTitleMarkdown), même respect de `compile: false`
       (pushFile() le vérifie déjà), même ordre Binder
       (getOrderedChildren). `depth = 1` : un cran sous le futur titre
       `# Annexes`, jamais au même niveau. */
    if (annexesFolderRef && wantAnnexes) {
      for (const child of getOrderedChildren(app, settings, annexesFolderRef)) {
        if (child instanceof TFile) {
          await pushFile(child, "annexe", 1, annexParts, annexSegments);
        }
      }
    }
  } catch (e) {
    // Jamais une exception non gérée qui remonterait comme un plantage
    // générique : un message contextualisé (feuillet + étape), le reste du
    // projet n'est pas mis en cause — la compilation s'arrête proprement ici.
    const err = toCompileError(e, "compilation");
    new Notice(err.describe());
    return null;
  }

  /* Sommaire / Table des illustrations / Table des matières / Bibliographie
     / Annexes (Phases 6, 7, 8 et 9 — services/contents-generator.ts,
     services/tables-generator.ts, services/bibliography-generator.ts,
     modèle services/book-composition.ts) : générés/assemblés à la
     compilation, aucun fichier Markdown source pour les trois premiers,
     rien d'autre n'est modifié. Seulement pour une portée `project` (aucun
     sens sur un simple feuillet/dossier/sélection), et seulement si leur
     inclusion est explicitement activée (projectMeta, voir
     readGeneratedIncluded) — par défaut exclus (defaultComposition()), sauf
     `manuscript`.
     Sommaire/Tables sont calculés AVANT toute insertion, sur un
     instantané de `segments` pris ici même (sinon un bloc généré verrait le
     titre d'un autre bloc généré comme un titre du manuscrit) ; la
     Bibliographie ne vient pas des segments mais des fiches de Recherche →
     Bibliographie/Bibliography. Le Sommaire reste centré sur le manuscrit
     principal seul (`bodySegments`) ; la Table des illustrations ET la Table
     des matières, elles, voient aussi les annexes quand celles-ci sont
     incluses (`tocSourceSegments`) — sans jamais les insérer deux fois :
     `annexSegments` ne sert ici que de SOURCE aux générateurs, leur
     insertion réelle (plus bas) est un événement séparé.
     Ordre de compilation FINAL :
     1. Pages Front (première page, pages liminaires)
     2. Sommaire (juste après Front, avant manuscrit)
     3. Tables (juste après Sommaire, avant manuscrit)
     4. Manuscrit
     5. Table des matières (après manuscrit, avant bibliographie)
     6. Bibliographie
     7. Annexes
     8. Index (pas encore implémenté, donc en fin)
     Table des illustrations (= Tables) s'insère avant le corps.
     `parts` et `segments` reçoivent exactement les mêmes inserts, aux mêmes
     index, pour rester synchronisés (voir le commentaire juste en dessous
     sur cette contrainte). */
  if (compilationScope.type === "project" && meta) {
    const wantSummary = readGeneratedIncluded(meta, SUMMARY) ?? false;
    const wantTables = readGeneratedIncluded(meta, TABLES) ?? false;
    const wantToc = readGeneratedIncluded(meta, TOC) ?? false;
    const wantBibliography = readGeneratedIncluded(meta, BIBLIOGRAPHY) ?? false;
    const bodySegments = segments.slice();
    const tocSourceSegments = wantAnnexes ? bodySegments.concat(annexSegments) : bodySegments;

    // Insérer Sommaire et Tables AVANT le manuscrit, dans cet ordre
    let insertIndex = segments.findIndex((s) => !s.frontType);
    if (insertIndex === -1) insertIndex = segments.length;

    if (wantSummary) {
      const text = generateSummary(bodySegments);
      const generatedSegment: CompileSegment = {
        path: null,
        text,
        frontType: null,
        generatedType: "summary",
      };
      parts.splice(insertIndex, 0, text);
      segments.splice(insertIndex, 0, generatedSegment);
      insertIndex++; // Décaler l'index pour la prochaine insertion
    }

    if (wantTables) {
      const tablesText = generateTableOfIllustrations(tocSourceSegments);
      if (tablesText) {
        parts.splice(insertIndex, 0, tablesText);
        segments.splice(insertIndex, 0, { path: null, text: tablesText, frontType: null });
        insertIndex++; // Décaler l'index
      }
    }

    if (wantBibliography) {
      const bibliographyText = generateBibliography(bibliographyEntries(app, settings));
      if (bibliographyText) {
        parts.push(bibliographyText);
        segments.push({ path: null, text: bibliographyText, frontType: null });
      }
    }

    /* Annexes : déjà compilées à part (voir plus haut, dans le même filet
       try/catch que walk()) — reste seulement à les insérer, après
       Bibliographie. `# Annexes` n'apparaît que s'il existe RÉELLEMENT au
       moins une annexe compilée (annexSegments non vide couvre à la fois
       « désactivé », « dossier absent/vide » et « tout compile: false »). */
    if (wantAnnexes && annexSegments.length) {
      push("# Annexes", null, null);
      parts.push(...annexParts);
      segments.push(...annexSegments);
    }

    // Insérer Table des matières APRÈS le manuscrit, avant bibliographie
    if (wantToc) {
      const text = generateTableOfContents(tocSourceSegments);
      parts.push(text);
      segments.push({ path: null, text, frontType: null, generatedType: "toc" });
    }
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
    const renderTexts = segments.map((segment) => segment.renderText ?? segment.text);
    const renumberedRenderTexts = renumberFootnotesAcrossTexts(renderTexts);
    for (let idx = 0; idx < segments.length; idx++) {
      segments[idx] = { ...segments[idx], text: renumberedParts[idx], renderText: segments[idx].renderText === undefined ? undefined : renumberedRenderTexts[idx] };
    }
    parts.length = 0;
    parts.push(...renumberedParts);
  }
  const manuscript = parts.join(P.separator || "\n\n");
  if (options?.writeOutput === false) {
    return { outPath: "", manuscript, segments };
  }
  const fileName = resolveOutputBaseName(settings, outputFileName);
  const outputFolder = await getOutputFolder(app, settings);
  const realOutBase = outputFolder ? outputFolder.path : folder.path;
  const realOutPath = normalizePath(`${realOutBase}/${fileName}.md`);
  let writtenOutPath = realOutPath;
  try {
    const written = await writeResolvingCaseCollision(
      app,
      realOutPath,
      (existing) => app.vault.modify(existing, manuscript),
      (p) => app.vault.create(p, manuscript)
    );
    writtenOutPath = written.path;
  } catch (e) {
    // Jamais une exception non gérée : un fichier compilé qui ne peut pas
    // être écrit (collision réelle non résolue, permissions…) doit
    // s'afficher comme n'importe quelle autre erreur de compilation,
    // jamais comme une Promise rejetée non gérée dans la console.
    const err = toCompileError(e, "écriture du manuscrit compilé", { filePath: realOutPath });
    new Notice(err.describe());
    return null;
  }
  new Notice(
    `Compilé (${P.name}) : ${count} feuillets → ${fileName}.md`
  );
  /** @type {CompileResult} */
  return { outPath: writtenOutPath, manuscript, segments };
}

/**
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @param {TFolder|null} folder
 * @returns {ProjectMeta}
 */
export function projectMetaFor(settings: FeuilletsSettings, folder: TFolder | null) {
  if (!folder) return {};
  /* `settings.projectMeta` est un réglage central toujours défini en usage
     réel (voir DEFAULT_SETTINGS) — mais certaines fixtures de test
     construisent un `settings` minimal sans lui, notamment celles d'avant
     Phase 6 : lire ce champ ne doit jamais lever pour autant, ici comme
     dans le reste du plugin (repli défensif). */
  return (settings.projectMeta && settings.projectMeta[folder.path]) || {};
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

/**
 * Point d'entrée universel de l'export depuis une portée CompileScope.
 *
 * - `md`   : compile en Markdown et écrit dans _Sortie/<baseName>.md
 * - `epub` : compile puis exporte en EPUB
 * - `docx` : compile puis exporte en DOCX
 * - `odt`  : compile puis exporte en ODT
 * - `pdf`  : compile puis exporte en PDF
 *
 * La même portée (scope) est transmise à compile() pour tous les formats :
 * aucun format ne retombe silencieusement sur Markdown si un autre est
 * demandé. L'extension du fichier de sortie correspond toujours au format.
 *
 * @param baseName nom de base SANS extension (l'extension est ajoutée ici)
 */
export async function exportWithScope(
  app: App,
  settings: FeuilletsSettings,
  scope: CompileScope,
  format: ExportFormat,
  baseName: string,
  contentExtraction: ContentExtraction | null = null
): Promise<string | undefined> {
  if (format === "md") {
    /* Format Markdown : compile() écrit déjà le .md dans _Sortie et renvoie
       le chemin ; on réutilise le paramètre outputFileName pour forcer le nom. */
    const result = await compile(app, settings, null, scope, baseName);
    return result?.outPath;
  }
  /* Formats binaires : on passe par exportViaNative en fournissant la portée
     et le baseName directement — l'extension est ajoutée par exportViaNative
     selon le format. */
  return exportViaNative(app, settings, format, null, undefined, baseName, false, scope, contentExtraction);
}

/** Export DOCX de soumission : même compilation et même moteur que
 * l'export ordinaire, mais écrit directement dans le paquet transmis par
 * Courrier et ne remplace jamais un fichier existant. */
export async function exportDocxToFolder(
  app: App,
  settings: FeuilletsSettings,
  destinationFolderPath: string,
  suggestedBaseName: string
): Promise<string | undefined> {
  return exportViaNative(app, settings, "docx", null, destinationFolderPath, suggestedBaseName, true);
}

/** Export DOCX d'un document Markdown individuel : même moteur natif que le
 * manuscrit, avec une portée `file`, sans réécrire le Markdown source. */
export async function exportEditorialDocumentDocxToFolder(
  app: App,
  settings: FeuilletsSettings,
  sourceFilePath: string,
  destinationFolderPath: string,
  suggestedBaseName: string
): Promise<string | undefined> {
  const root = getProjectFolder(app, settings);
  if (!root) return undefined;
  const scope: CompileScope = { type: "file", projectRoot: root.path, path: sourceFilePath };
  return exportViaNative(app, settings, "docx", null, destinationFolderPath, suggestedBaseName, true, scope);
}

/** Compile puis rend via le moteur natif (MarkdownRenderer d'Obsidian +
 * bibliothèques JS pures `docx`/`jszip`) — aucune dépendance externe,
 * fonctionne desktop et mobile (sauf PDF, desktop uniquement — voir
 * export-pdf.js). Réutilise `compile()` tel quel : seule la conversion
 * finale change de moteur. */
export function resolveExportIdentity(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder,
  segments: { frontType?: string | null; path?: string | null }[]
): { title: string; author: string } {
  const meta = projectMetaFor(settings, folder);
  const realProjectRoot = getProjectRoot(app, settings);
  const realProjectName = realProjectRoot ? realProjectRoot.name : folder.name;

  let pageTitle = "";
  let pageAuthor = "";

  const titrePageSeg = segments.find((s) => s.frontType === "titre" && s.path);
  if (titrePageSeg && titrePageSeg.path) {
    const titreFile = app.vault.getAbstractFileByPath(titrePageSeg.path);
    if (titreFile instanceof TFile) {
      const titreFm = fmOf(app, titreFile);
      if (typeof titreFm.title === "string" && titreFm.title.trim()) {
        pageTitle = titreFm.title.trim();
      }
      if (typeof titreFm.author === "string" && titreFm.author.trim()) {
        pageAuthor = titreFm.author.trim();
      }
    }
  }

  const title = pageTitle || realProjectName;
  const author = pageAuthor || toValue(meta.author) || toValue(settings.manuscriptAuthor) || "";
  return { title, author };
}

/**
 * @param {import("obsidian").App} app
 * @param {import("./types.d.ts").FeuilletsSettings} settings
 * @param {string} format
 * @returns {Promise<void>}
 */
async function exportViaNative(
  app: App,
  settings: FeuilletsSettings,
  format: string,
  scopePath: string | null = null,
  destinationFolderPath?: string,
  baseNameOverride?: string,
  nonDestructive = false,
  scope?: CompileScope,
  contentExtraction?: ContentExtraction | null
): Promise<string | undefined> {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  /* `compile()` est désormais À L'INTÉRIEUR du même filet try/catch que
     l'écriture des formats binaires plus bas : une erreur survenant pendant
     la compilation (y compris l'écriture de Manuscrit.md, voir compile())
     ne doit jamais devenir une Promise rejetée non gérée — compile() gère
     déjà elle-même la plupart de ses erreurs (Notice + retour null), mais
     ce filet reste le dernier recours si une exception lui échappe malgré
     tout. */
  try {
    /* Utiliser la portée explicite si fournie, sinon le chemin legacy. */
    const result = await compile(
      app,
      settings,
      scopePath,
      scope ?? null,
      undefined,
      contentExtraction ? { contentExtraction } : undefined,
    );
    if (!result) return undefined;

    const { title, author } = resolveExportIdentity(app, settings, folder, result.segments);
    /* Le fichier compilé réel (result.outPath) plutôt que le dossier projet :
       la résolution des embeds (![[image.png]]) par Obsidian a besoin d'un
       chemin de FICHIER pour son contexte de répertoire — un chemin de
       dossier peut fausser la résolution des liens relatifs. */
    const sourcePath = result.outPath;
    const outputFolder = await getOutputFolder(app, settings);
    const outBase = destinationFolderPath || (outputFolder ? outputFolder.path : folder.path);
    const baseName = resolveOutputBaseName(settings, baseNameOverride);
    const segments: NativeExportSegment[] = result.segments.map(({ path, text, renderText, frontType, generatedType, sourceTitle, sourceSubtitle, startsWithGeneratedTitle, structuralType }) =>
      frontType === null ? { path, text, ...(renderText !== undefined ? { renderText } : {}), ...(generatedType ? { generatedType } : {}), ...(sourceTitle ? { sourceTitle } : {}), ...(sourceSubtitle ? { sourceSubtitle } : {}), ...(startsWithGeneratedTitle ? { startsWithGeneratedTitle } : {}), ...(structuralType ? { structuralType } : {}) } : { path, text, ...(renderText !== undefined ? { renderText } : {}), frontType, ...(generatedType ? { generatedType } : {}), ...(sourceTitle ? { sourceTitle } : {}), ...(sourceSubtitle ? { sourceSubtitle } : {}), ...(startsWithGeneratedTitle ? { startsWithGeneratedTitle } : {}), ...(structuralType ? { structuralType } : {}) }
    );
    const contentVariant = await selectedContentVariant(app, settings);
    const ctx: NativeExportContext = { markdown: result.manuscript, title, author, sourcePath, segments, contentVariant };

    if (format === "epub") {
      const data = await exportEpub(app, settings, ctx);
      const outPath = nonDestructive ? uniqueBinaryPath(app, outBase, baseName, "epub") : normalizePath(`${outBase}/${baseName}.epub`);
      const writtenPath = await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${writtenPath}`);
      return writtenPath;
    } else if (format === "docx") {
      const data = await exportDocx(app, settings, ctx);
      const outPath = nonDestructive ? uniqueBinaryPath(app, outBase, baseName, "docx") : normalizePath(`${outBase}/${baseName}.docx`);
      const writtenPath = await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${writtenPath}`);
      return writtenPath;
    } else if (format === "odt") {
      const data = await exportOdt(app, settings, ctx);
      const outPath = nonDestructive ? uniqueBinaryPath(app, outBase, baseName, "odt") : normalizePath(`${outBase}/${baseName}.odt`);
      const writtenPath = await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${writtenPath}`);
      return writtenPath;
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
  return undefined;
}

function uniqueBinaryPath(app: App, folderPath: string, baseName: string, extension: string): string {
  const safeBase = baseName.replace(/[\\/:*?"<>|]/g, "-").trim() || "Manuscrit";
  let counter = 0;
  let path = "";
  do {
    const suffix = counter === 0 ? "" : `-${counter}`;
    path = normalizePath(`${folderPath}/${safeBase}${suffix}.${extension}`);
    counter++;
  } while (app.vault.getAbstractFileByPath(path));
  return path;
}

/**
 * LOT 9B — exportée pour être réutilisée par le panneau de révision DOCX
 * (docx-review-view.ts#generateRevisedDocx), qui écrit ainsi le .docx
 * régénéré exactement comme n'importe quel export natif Feuillets (créer si
 * absent, sinon modifier en place) — jamais un second mécanisme d'écriture
 * binaire inventé pour ce lot. Modifie aussi, à la casse près, un fichier
 * déjà existant sous un autre nom (voir writeResolvingCaseCollision) —
 * même politique que le Markdown compilé, jamais un `createBinary()` qui
 * échoue avec `Error: File already exists.` sur un système de fichiers
 * insensible à la casse. Renvoie le chemin RÉELLEMENT écrit (celui du
 * fichier existant retrouvé, casse d'origine préservée, si la cible en
 * différait uniquement par la casse).
 * @param {import("obsidian").App} app
 * @param {string} path
 * @param {Uint8Array|Blob|ArrayBuffer} data
 * @returns {Promise<string>}
 */
export async function writeBinaryFile(app: App, path: string, data: Uint8Array | Blob | ArrayBuffer): Promise<string> {
  let buf: ArrayBuffer;
  if (data instanceof ArrayBuffer) {
    buf = data;
  } else if (data instanceof Uint8Array) {
    buf = data.buffer as ArrayBuffer;
  } else {
    buf = await data.arrayBuffer();
  }
  const written = await writeResolvingCaseCollision(
    app,
    path,
    (existing) => app.vault.modifyBinary(existing, buf),
    (p) => app.vault.createBinary(p, buf)
  );
  return written.path;
}
