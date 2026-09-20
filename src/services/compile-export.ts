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
  feuilletsAuxiliaryPathFor,
  detectProjectStructureLocale,
  isStructuredManuscriptRoot,
  candidateLocalesForProject,
} from "./folder-structure.js";
import { projectCreationNames } from "../i18n/project-creation.js";
import { FALLBACK_LOCALE, getLocale, type Locale } from "../i18n/index.js";
import { isProjectDraft } from "./project-drafts.js";
import { ensureFolder } from "./project-files.js";
import { preserveBlankLinesForFrontPage } from "./export-render.js";
import { parseTitleRoles, hasTitleRoleLines, TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { exportEpub } from "./export-epub.js";
import { exportDocx } from "./export-docx.js";
import { exportPdf } from "./export-pdf.js";
import { exportOdt } from "./export-odt.js";
import { type CompileScope, resolveCompileScopeFiles, createProjectScope } from "./compile-scope.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import type { ExportCitationSettings } from "./pandoc-citation-preview.js";
import { generateSummary, generateTableOfContents } from "./contents-generator.js";
import type { GeneratedContentsKind } from "./generated-contents.js";
import { generateTableOfIllustrations } from "./tables-generator.js";
import { bibliographyEntriesForEditorialRoot, bibliographyEntriesForFiles, generateBibliography, type BibliographyEntry } from "./bibliography-generator.js";
import { extractCitekeysCached, resolveBibliographicScope, bibtexEntryToBibliographyEntry } from "./citekey-bibliography.js";
import { getCachedBibtexCatalog, type BibtexCatalogEntry } from "./bibtex-catalog.js";
import { resolveCitedSourceFilesForCompileFiles } from "./citation-registry.js";
import { loadLayoutStore, layoutOverridesForFile, relativeLayoutFilePath } from "./layout-store.js";
import { injectDocumentLayoutMarkers } from "./document-layout.js";
import { selectedContentVariant, type ContentVariant } from "./content-variants.js";
import type { ContentExtraction } from "./content-extractions.js";
import { extractSectionsByRoles } from "./content-section-extraction.js";
import type { ContentCollection } from "./content-collections.js";
import { renderContentCollectionMarkdown } from "./content-collection-render.js";
import { joinCompiledSegments } from "./compile-segments.js";
export { joinCompiledSegments } from "./compile-segments.js";
import { effectiveComposition } from "./ouvrage-composition.js";
export { effectiveComposition } from "./ouvrage-composition.js";
import { t } from "../i18n/index.js";
import {
  createPandocPackage,
  sanitizeArchiveSegment,
  type PandocPackageBibliographyFile,
  type PandocPackageCslFile,
  type PandocPackageMediaFile,
  type PandocPackageCitationReport,
  type PandocPackageCitationReportItem,
  type ResolverStatus,
} from "./pandoc-package-export.js";

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
export type ExportFormat = "md" | "epub" | "docx" | "odt" | "pdf" | "pandoc";
export const SUPPORTED_EXPORT_FORMATS: ExportFormat[] = ["epub", "docx", "odt", "pdf", "md", "pandoc"];

/** @typedef {{ name: string; color: string }} Label */
/** @typedef {{ [key: string]: unknown }} ProjectMeta */
/** @typedef {{ filPlaceholders: Record<string, string>; filOrigins: Record<string, string>; filResolved: string[] }} NarrativeThreadState */

/** @typedef {{ name: string; fileName: string; folderTitles: boolean; chapterTitles: boolean; sceneTitles: boolean; separator: string; [key: string]: unknown }} PresetConfig */
type CompileSegment = { path: string | null; text: string; renderText?: string; frontType: string | null; generatedType?: GeneratedContentsKind; sourceTitle?: string | null; sourceSubtitle?: string | null; startsWithGeneratedTitle?: boolean; structuralType?: "part"; sceneBreakBefore?: boolean; titleBlockCount?: number };
/** @typedef {{ outPath: string; manuscript: string; segments: CompileSegment[]; compiledFilePaths: readonly string[] }} CompileResult */
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
  sceneBreakBefore?: boolean;
};

type NativeExportContext = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments: NativeExportSegment[];
  contentVariant: ContentVariant | null;
  separator: string;
  citationSettings?: ExportCitationSettings;
};

/* PresetConfig n'est plus redéclaré ici : il vient de types.d.ts (ambiant,
   visible sans import), qui le dérive désormais de OuvrageCompositionConfig
   par `Pick` plutôt que de porter une seconde liste des mêmes champs — voir
   effectiveComposition() plus bas, qui construit l'objet complet. */

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
  const merged = idx >= 0 && Array.isArray(S.compilePresets) && S.compilePresets[idx]
    ? Object.assign({}, base, S.compilePresets[idx] as Record<string, unknown>)
    : base;
  return merged;
}

/** Résout, à partir des mêmes `scopePath`/`scope` que compile(), la racine
 * éditoriale qu'il calculerait lui-même — factorisé pour qu'exportViaNative
 * (qui ne construit jamais sa propre CompileScope) obtienne EXACTEMENT la
 * même racine, condition nécessaire pour que sa composition effective
 * (ci-dessus) ne diverge jamais de celle que compile() vient d'utiliser
 * pour ce même appel. Ne renvoie jamais null : à défaut de portée
 * résoluble, replie sur `globalRoot` — compile(), appelé juste avant,
 * affiche déjà sa propre Notice si le scope explicite s'avère invalide. */
function resolveEditorialRootFor(
  app: App,
  globalRoot: TFolder,
  scopePath: string | null,
  scope: CompileScope | null | undefined
): TFolder {
  let compilationScope: CompileScope;
  if (scope) {
    compilationScope = scope;
  } else if (scopePath) {
    const scoped = app.vault.getAbstractFileByPath(normalizePath(scopePath));
    if (scoped instanceof TFile && scoped.extension === "md") {
      compilationScope = { type: "file", projectRoot: globalRoot.path, path: scoped.path };
    } else if (scoped instanceof TFolder) {
      compilationScope = { type: "folder", projectRoot: globalRoot.path, path: scoped.path };
    } else {
      return globalRoot;
    }
  } else {
    compilationScope = createProjectScope(globalRoot.path);
  }
  const editorialRoot = app.vault.getAbstractFileByPath(normalizePath(compilationScope.projectRoot));
  return editorialRoot instanceof TFolder ? editorialRoot : globalRoot;
}

/**
 * Resolves the target folder for workspace bibliography resolution during native export.
 *
 * Scoping rules:
 * - scope.type === "file": file's parent folder
 * - scope.type === "folder": exported folder
 * - scope.type === "project" | "selection": project root (null target folder)
 * - legacy scopePath to file: file's parent folder
 * - legacy scopePath to folder: that folder
 * - neither: project root (null target folder)
 *
 * If the target file/folder is missing: failClosed = true (no bibliography, no fallback to project).
 */
function resolveExportCitationTargetFolder(
  app: App,
  scopePath: string | null | undefined,
  scope: CompileScope | null | undefined
): { folder: TFolder | null; failClosed: boolean } {
  if (scope) {
    if (scope.type === "file") {
      const candidate = app.vault.getAbstractFileByPath(normalizePath(scope.path));
      if (candidate instanceof TFile && candidate.parent) {
        return { folder: candidate.parent, failClosed: false };
      }
      return { folder: null, failClosed: true };
    }
    if (scope.type === "folder") {
      const candidate = app.vault.getAbstractFileByPath(normalizePath(scope.path));
      if (candidate instanceof TFolder) {
        return { folder: candidate, failClosed: false };
      }
      return { folder: null, failClosed: true };
    }
    return { folder: null, failClosed: false };
  }

  if (scopePath) {
    const candidate = app.vault.getAbstractFileByPath(normalizePath(scopePath));
    if (candidate instanceof TFile) {
      if (candidate.parent) {
        return { folder: candidate.parent, failClosed: false };
      }
      return { folder: null, failClosed: true };
    }
    if (candidate instanceof TFolder) {
      return { folder: candidate, failClosed: false };
    }
    return { folder: null, failClosed: true };
  }

  return { folder: null, failClosed: false };
}

/** Nom de base (sans extension) de la sortie compilée : résolu ICI, UNE
 * SEULE FOIS, puis réutilisé tel quel par compile() (Markdown) et
 * exportViaNative() (formats binaires) — jamais deux résolutions
 * concurrentes du même nom qui pourraient diverger. Priorité : nom explicite
 * transmis par l'appelant pour CETTE compilation/cet export précis (portée
 * fichier/dossier/sélection avec son propre nom, voir exportWithScope),
 * sinon `compositionFileName`, tel que résolu par effectiveComposition()
 * pour la racine éditoriale de cet appel — sinon repli "Manuscrit". */
function resolveOutputBaseName(explicit: string | null | undefined, compositionFileName: string): string {
  if (explicit) return explicit.replace(/\.md$/i, "");
  return compositionFileName ? compositionFileName.replace(/\.md$/i, "") : "Manuscrit";
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
 * @param {Locale} [fallbackLocale]
 * @returns {Promise<TFolder|null>}
 */
export async function getOutputFolder(app: App, settings: FeuilletsSettings, fallbackLocale?: Locale) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const parent = root.parent;
  const base =
    isStructuredManuscriptRoot(root) && parent instanceof TFolder && parent.path !== "" && parent.path !== "/"
      ? parent
      : root;

  const orderedLocales = candidateLocalesForProject(root, fallbackLocale);
  for (const locale of orderedLocales) {
    const canonical = app.vault.getAbstractFileByPath(
      feuilletsAuxiliaryPathFor(root, "output", projectCreationNames(locale))
    );
    if (canonical instanceof TFolder) return canonical;
  }

  const legacyNames = orderedLocales[0] === "en"
    ? ["_Output", "Output", "_Sortie", "Sortie"]
    : ["_Sortie", "Sortie", "_Output", "Output"];
  for (const name of legacyNames) {
    const legacy = app.vault.getAbstractFileByPath(normalizePath(`${base.path}/${name}`));
    if (legacy instanceof TFolder) return legacy;
  }

  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const projectLocale = detectProjectStructureLocale(app, root, fallback);
  return await ensureFolder(app, feuilletsAuxiliaryPathFor(root, "output", projectCreationNames(projectLocale)));
}

export type CompileOptions = {
  writeOutput?: boolean;
  contentExtraction?: ContentExtraction | null;
  contentCollection?: ContentCollection | null;
  bibliographyMode?: "default" | "pandoc";
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
  if (options?.contentExtraction && options.contentCollection) {
    throw new Error("contentExtraction et contentCollection sont des modes de dérivation alternatifs et ne peuvent pas être utilisés ensemble.");
  }
  /* Racine GLOBALE Feuillets : réglages, presets, mise en page, brouillons
     globaux et dossier de sortie restent toujours rattachés à elle. */
  const opLocale = getLocale();
  const globalRoot = getProjectFolder(app, settings);
  if (!globalRoot) {
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
      compilationScope = { type: "file", projectRoot: globalRoot.path, path: scoped.path };
    } else if (scoped instanceof TFolder) {
      compilationScope = { type: "folder", projectRoot: globalRoot.path, path: scoped.path };
    } else {
      new Notice("Portée d’export introuvable.");
      return null;
    }
  } else {
    // Portée par défaut: projet complet
    compilationScope = createProjectScope(globalRoot.path);
  }

  /* Racine ÉDITORIALE : point de départ du parcours et référence des rôles
     (profondeur, Front, Annexes), lue dans `projectRoot` quelle que soit la
     portée (project, folder, file, selection). Une portée rattachée à un
     ouvrage imbriqué (WARPI/NEFES) est ainsi calculée relativement à CET
     ouvrage, jamais à la racine globale qui le contient. */
  const editorialRoot = app.vault.getAbstractFileByPath(normalizePath(compilationScope.projectRoot));
  if (!(editorialRoot instanceof TFolder)) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }

  // Résoudre la portée en liste de fichiers
  const resolvedFiles = resolveCompileScopeFiles(app, settings, compilationScope);
  const filesToCompile = compilationScope.type === "file"
    ? resolvedFiles
    : resolvedFiles.filter((file) => !isProjectDraft(globalRoot, file));
  if (filesToCompile.length === 0) {
    new Notice("Aucun feuillet à compiler.");
    return null;
  }

  /* LOT 5A — composition EFFECTIVE de editorialRoot (jamais globalRoot tel
     quel) : un ouvrage (NEFES) sans composition locale hérite de celle du
     projet global, un ouvrage avec composition locale l'utilise seule. Le
     nom du preset actif (identité, hors composition) reste lu séparément
     via activePresetConfig(settings).name, seulement pour la Notice finale
     — jamais propre à un ouvrage (voir plus bas). */
  const composition = effectiveComposition(settings, globalRoot, editorialRoot);
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
    const relativeLayoutPath = relativeLayoutFilePath(globalRoot.path, file.path) || file.path;
    let renderSource = injectDocumentLayoutMarkers(content, layoutOverridesForFile(layoutStore, relativeLayoutPath));
    if (options?.contentExtraction) {
      const extracted = extractSectionsByRoles(content, options.contentExtraction.triggerRoles);
      if (extracted.length === 0) return null;
      content = extracted.map((section) => section.markdown).join("\n\n");
      const renderSections = extractSectionsByRoles(renderSource, options.contentExtraction.triggerRoles);
      renderSource = renderSections.map((section) => section.markdown).join("\n\n");
    } else if (options?.contentCollection) {
      const collected = renderContentCollectionMarkdown(content, options.contentCollection);
      if (collected === null) return null;
      content = collected;
      const renderCollected = renderContentCollectionMarkdown(renderSource, options.contentCollection);
      renderSource = renderCollected === null ? "" : renderCollected;
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
  const compiledFilePaths: string[] = [];
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
    const isFront = isFrontMatter(app, settings, file, editorialRoot) && FRONT_PAGE_TYPES.includes(normalizedFrontType);
    const body = await readBody(file, isFront ? normalizedFrontType : undefined);
    if (!body) return false;
    const sourceTitle = compiledTitleFor(app, file) || null;
    const sourceSubtitle = compiledSubtitleFor(app, file) || null;

    if (isFront) {
      push(body.text, file.path, normalizedFrontType, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = body.renderText;
      Object.assign(targetSegments[targetSegments.length - 1], { sourceTitle, sourceSubtitle });
      count++;
      compiledFilePaths.push(file.path);
      return true;
    }

    const wantTitle = role === "scene" ? composition.sceneTitles : composition.chapterTitles;
    /* RECTIFICATION LOT 4 — le titre automatique d'une SCÈNE est TOUJOURS
       généré en H4, niveau ABSOLU (jamais depth + 1, jamais dépendant d'un
       ouvrage) : projet global ou ouvrage, portée project/folder/file,
       scène peu ou très profondément nichée — toujours H4. Un rôle
       "chapitre" (roleOfFile() peut aussi le renvoyer ici, pour un feuillet
       posé directement sous une partie) garde le calcul historique
       `depth + 1`, comme les titres de dossier (parties/chapitres,
       inchangés ailleurs dans ce fichier). Ni sceneTitles/chapterTitles
       (réglage d'affichage, seul maître de wantTitle) ni un titre déjà
       écrit à la main dans le contenu (resolvedFileTitleMarkdown lui donne
       toujours la priorité par rapport à `level`) ne sont affectés. */
    const titleLevel = role === "scene" ? 4 : depth + 1;
    const title = resolvedFileTitleMarkdown(app, file, body.text, wantTitle, titleLevel);
    if (title) {
      push(`${title}\n\n${body.text}`, file.path, null, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = `${title}\n\n${body.renderText}`;
    } else {
      push(body.text, file.path, null, targetParts, targetSegments);
      targetSegments[targetSegments.length - 1].renderText = body.renderText;
    }
    Object.assign(targetSegments[targetSegments.length - 1], { sourceTitle, sourceSubtitle });
    if (title) targetSegments[targetSegments.length - 1].startsWithGeneratedTitle = true;
    targetSegments[targetSegments.length - 1].titleBlockCount = title ? title.split("\n\n").length : 0;
    count++;
    compiledFilePaths.push(file.path);
    return true;
  };

  /** Pushes a run of scene files from the same chapter folder, marking every
   * scene but the first with `sceneBreakBefore` — the scene separator belongs
   * between scenes, never between a chapter/part title and its first scene
   * (atendev). */
  const pushSceneSequence = async (
    files: TFile[],
    depth: number,
    targetParts: string[] = parts,
    targetSegments: CompileSegment[] = segments
  ): Promise<void> => {
    let previousWasScene = false;
    for (const sc of files) {
      const before = targetSegments.length;
      await pushFile(sc, "scene", depth, targetParts, targetSegments);
      if (targetSegments.length > before) {
        if (previousWasScene) targetSegments[targetSegments.length - 1].sceneBreakBefore = true;
        previousWasScene = true;
      }
    }
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
  const annexesFolderRef = compilationScope.type === "project" ? annexesFolder(app, editorialRoot) : null;

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
        const isFrontFolder = isFrontMatter(app, settings, child, editorialRoot);
        const role = roleOfFolder(app, settings, child, editorialRoot, composition.level1Role);
        const level = "#".repeat(Math.min(depth + 1, 6));
        /* N'émettre le titre du dossier que si :
           - la portée ne restreint pas les titres (allowedTitleFolders === null), OU
           - ce dossier fait explicitement partie de l'ensemble autorisé. */
        const titleAllowed = allowedTitleFolders === null || allowedTitleFolders.has(child.path);
        if (options?.contentExtraction || options?.contentCollection) {
          const folderParts: string[] = [];
          const folderSegments: CompileSegment[] = [];
          if (role === "partie") {
            await walk(child, depth + 1, folderParts, folderSegments);
          } else {
            await pushSceneSequence(flattenFiles(app, settings, child), depth + 1, folderParts, folderSegments);
          }
          if (folderSegments.length > 0) {
            const showTitle = role === "partie" ? composition.folderTitles : composition.chapterTitles;
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
          if (composition.folderTitles && !isFrontFolder && titleAllowed) { push(`${level} ${child.name}`, null, null); Object.assign(segments[segments.length - 1], { startsWithGeneratedTitle: true, structuralType: "part" }); }
          await walk(child, depth + 1);
        } else {
          if (composition.chapterTitles && !isFrontFolder && titleAllowed) { push(`${level} ${child.name}`, null, null); segments[segments.length - 1].startsWithGeneratedTitle = true; }
          await pushSceneSequence(flattenFiles(app, settings, child), depth + 1);
        }
      } else {
        await pushFile(child, roleOfFile(app, settings, child, editorialRoot, composition.level1Role), depth, targetParts, targetSegments);
      }
    }
  };
  /* `composition.annexes` : lu une seule fois, avant tout parcours — sert à
     la fois à décider si les annexes doivent être compilées à part
     (ci-dessous, DANS le même filet try/catch que le reste) et, plus bas, à
     Sommaire/TDM/Tables/Bibliographie. Sommaire/Tables/TDM/Bibliographie/
     Annexes n'ont de sens qu'en portée `project` (aucun sens sur un simple
     feuillet/dossier/sélection) — comportement historique inchangé. */
  const wantAnnexes = compilationScope.type === "project" ? composition.annexes : false;
  try {
    // Compiler en respectant la structure du projet. Une portée fichier
    // explicite peut viser un brouillon, physiquement hors de l'arborescence
    // du manuscrit ; ce cas passe directement par le même pushFile().
    // La vérification fileSet dans pushFile() respecte la portée résolue.
    if (compilationScope.type === "file" && filesToCompile.length === 1 && isProjectDraft(globalRoot, filesToCompile[0])) {
      await pushFile(filesToCompile[0], roleOfFile(app, settings, filesToCompile[0]), 0);
    } else {
      await walk(editorialRoot, 0);
    }

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
  if (compilationScope.type === "project" || options?.bibliographyMode === "pandoc") {
    const wantSummary = compilationScope.type === "project" ? composition.summary : false;
    const wantTables = compilationScope.type === "project" ? composition.tables : false;
    const wantToc = compilationScope.type === "project" ? composition.toc : false;
    const wantBibliography = composition.bibliography;
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
      if (options?.bibliographyMode === "pandoc") {
        const heading = t("export.pandoc.bibliographyHeading");
        const bibliographyText = `# ${heading}\n\n::: {#refs}\n:::\n`;
        parts.push(bibliographyText);
        segments.push({ path: null, text: bibliographyText, frontType: null });
      } else if (compilationScope.type === "project") {
        const contextualCitations = await resolveCitedSourceFilesForCompileFiles(app, settings, filesToCompile);
        const bibliographyEntriesForCompilation = contextualCitations.hasIndexedOccurrences
          ? bibliographyEntriesForFiles(app, contextualCitations.sourceFiles)
          : bibliographyEntriesForEditorialRoot(app, settings, editorialRoot, opLocale);

        const compiledBibtexEntries: BibliographyEntry[] = [];
        const bibCatalogCache = new Map<string, readonly BibtexCatalogEntry[]>();

        for (const file of filesToCompile) {
          const fm = fmOf(app, file);
          if (fm.compile === false) continue;

          const content = typeof app.vault.cachedRead === "function"
            ? await app.vault.cachedRead(file)
            : await app.vault.read(file);
          const citekeys = extractCitekeysCached(file, content);
          if (citekeys.size === 0) continue;

          const { bibFile } = resolveBibliographicScope(app, settings, globalRoot, file);
          if (!bibFile) continue;

          let catalog = bibCatalogCache.get(bibFile.path);
          if (!catalog) {
            catalog = await getCachedBibtexCatalog(app, bibFile);
            bibCatalogCache.set(bibFile.path, catalog);
          }

          const catMap = new Map<string, BibtexCatalogEntry>();
          for (const catEntry of catalog) {
            catMap.set(catEntry.key, catEntry);
          }

          for (const key of citekeys.keys()) {
            const entry = catMap.get(key);
            if (entry) {
              compiledBibtexEntries.push(bibtexEntryToBibliographyEntry(entry, bibFile.path));
            }
          }
        }

        const allBibliographyEntries = [...bibliographyEntriesForCompilation, ...compiledBibtexEntries];
        const bibliographyText = generateBibliography(allBibliographyEntries);
        if (bibliographyText) {
          parts.push(bibliographyText);
          segments.push({ path: null, text: bibliographyText, frontType: null });
        }
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
  if (composition.footnoteRenumberOnCompile) {
    const renumberedParts = renumberFootnotesAcrossTexts(parts);
    const renderTexts = segments.map((segment) => segment.renderText ?? segment.text);
    const renumberedRenderTexts = renumberFootnotesAcrossTexts(renderTexts);
    for (let idx = 0; idx < segments.length; idx++) {
      segments[idx] = { ...segments[idx], text: renumberedParts[idx], renderText: segments[idx].renderText === undefined ? undefined : renumberedRenderTexts[idx] };
    }
    parts.length = 0;
    parts.push(...renumberedParts);
  }
  const manuscript = joinCompiledSegments(segments, composition.separator);
  if (options?.writeOutput === false) {
    return { outPath: "", manuscript, segments, compiledFilePaths: Object.freeze([...compiledFilePaths]) };
  }
  const fileName = resolveOutputBaseName(outputFileName, composition.fileName);
  const outputFolder = await getOutputFolder(app, settings, opLocale);
  const realOutBase = outputFolder ? outputFolder.path : globalRoot.path;
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
    `Compilé (${activePresetConfig(settings).name}) : ${count} feuillets → ${fileName}.md`
  );
  /** @type {CompileResult} */
  return { outPath: writtenOutPath, manuscript, segments, compiledFilePaths: Object.freeze([...compiledFilePaths]) };
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

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function isRegisteredPackageMedia(target: string, mediaFiles: Map<string, PandocPackageMediaFile>): boolean {
  const trimmed = target.trim();
  if (!trimmed.startsWith("media/")) return false;
  const rawName = trimmed.slice("media/".length).trim();
  if (!rawName) return false;
  if (mediaFiles.has(rawName)) return true;
  try {
    const decodedName = decodeURIComponent(rawName);
    return mediaFiles.has(decodedName);
  } catch {
    return false;
  }
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return str;

  const replacements: string[] = [];
  for (const match of matches) {
    replacements.push(await replacer(match));
  }
  let result = "";
  let lastIndex = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    result += str.slice(lastIndex, match.index);
    result += replacements[i];
    lastIndex = match.index + match[0].length;
  }
  result += str.slice(lastIndex);
  return result;
}

function relativePathToProject(projectRoot: TFolder, file: TFile): string {
  const rootPath = normalizePath(projectRoot.path);
  const filePath = normalizePath(file.path);
  if (filePath === rootPath) return file.name;
  if (filePath.startsWith(`${rootPath}/`)) {
    return filePath.slice(rootPath.length + 1);
  }
  return file.name;
}

type MediaCollectorState = {
  mediaFiles: Map<string, PandocPackageMediaFile>;
  mediaVaultMap: Map<string, string>;
  seenNames: Map<string, number>;
  warnings: string[];
};

async function transformSegmentMedia(
  app: App,
  text: string,
  sourceFilePath: string,
  mediaState: MediaCollectorState
): Promise<string> {
  if (!text) return text;

  const codeBlocks: string[] = [];
  const placeholderPrefix = `\x00FEUILLET_CODE_${Date.now()}_`;
  let protectedText = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholderPrefix}${idx}\x00`;
  });

  const WIKILINK_IMAGE_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  protectedText = await replaceAsync(protectedText, WIKILINK_IMAGE_RE, async (match) => {
    const fullMatch = match[0];
    const rawTarget = match[1] ?? "";
    const rawAlt = match[2];
    const target = rawTarget.trim();
    const alt = rawAlt !== undefined ? rawAlt.trim() : "";

    if (isRemoteUrl(target)) {
      return alt ? `![${alt}](${target})` : `![](${target})`;
    }

    const decoded = decodeURIComponent(target);
    const candidateFile = app.metadataCache?.getFirstLinkpathDest
      ? app.metadataCache.getFirstLinkpathDest(decoded, sourceFilePath)
      : null;
    const directPathFile = app.vault.getAbstractFileByPath(decoded);
    const directFile = candidateFile ?? (directPathFile instanceof TFile ? directPathFile : null);

    if (directFile instanceof TFile) {
      let finalName = mediaState.mediaVaultMap.get(directFile.path);
      if (!finalName) {
        const safeBase = sanitizeArchiveSegment(directFile.name);
        const lower = safeBase.toLowerCase();
        const count = mediaState.seenNames.get(lower) || 0;
        mediaState.seenNames.set(lower, count + 1);
        if (count > 0) {
          const dotIdx = safeBase.lastIndexOf(".");
          finalName = dotIdx > 0
            ? `${safeBase.slice(0, dotIdx)}-${count}${safeBase.slice(dotIdx)}`
            : `${safeBase}-${count}`;
        } else {
          finalName = safeBase;
        }
        mediaState.mediaVaultMap.set(directFile.path, finalName);
        const data = await app.vault.readBinary(directFile);
        mediaState.mediaFiles.set(finalName, { relativePath: finalName, data });
      }

      const isDimension = /^\d+(x\d+)?$/.test(alt);
      const effectiveAlt = isDimension ? "" : alt;
      return `![${effectiveAlt}](media/${finalName})`;
    }

    mediaState.warnings.push(`Missing media asset: ${target}`);
    return fullMatch;
  });

  const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g;
  protectedText = await replaceAsync(protectedText, MD_IMAGE_RE, async (match) => {
    const fullMatch = match[0];
    const alt = match[1] ?? "";
    const rawTarget = match[2] ?? "";
    const title = match[3];
    const target = rawTarget.trim();

    if (isRemoteUrl(target) || target.startsWith("data:") || isRegisteredPackageMedia(target, mediaState.mediaFiles)) {
      return fullMatch;
    }

    const decoded = decodeURIComponent(target);
    const candidateFile = app.metadataCache?.getFirstLinkpathDest
      ? app.metadataCache.getFirstLinkpathDest(decoded, sourceFilePath)
      : null;
    const directPathFile = app.vault.getAbstractFileByPath(decoded);
    const directFile = candidateFile ?? (directPathFile instanceof TFile ? directPathFile : null);

    if (directFile instanceof TFile) {
      let finalName = mediaState.mediaVaultMap.get(directFile.path);
      if (!finalName) {
        const safeBase = sanitizeArchiveSegment(directFile.name);
        const lower = safeBase.toLowerCase();
        const count = mediaState.seenNames.get(lower) || 0;
        mediaState.seenNames.set(lower, count + 1);
        if (count > 0) {
          const dotIdx = safeBase.lastIndexOf(".");
          finalName = dotIdx > 0
            ? `${safeBase.slice(0, dotIdx)}-${count}${safeBase.slice(dotIdx)}`
            : `${safeBase}-${count}`;
        } else {
          finalName = safeBase;
        }
        mediaState.mediaVaultMap.set(directFile.path, finalName);
        const data = await app.vault.readBinary(directFile);
        mediaState.mediaFiles.set(finalName, { relativePath: finalName, data });
      }

      return title
        ? `![${alt}](media/${finalName} "${title}")`
        : `![${alt}](media/${finalName})`;
    }

    mediaState.warnings.push(`Missing media asset: ${target}`);
    return fullMatch;
  });

  const placeholderRe = new RegExp(`${placeholderPrefix}(\\d+)\x00`, "g");
  let restored = "";
  let lastIndex = 0;
  let placeholderMatch: RegExpExecArray | null;
  while ((placeholderMatch = placeholderRe.exec(protectedText)) !== null) {
    restored += protectedText.slice(lastIndex, placeholderMatch.index);
    const idxStr = placeholderMatch[1] ?? "";
    const idx = Number.parseInt(idxStr, 10);
    restored += codeBlocks[idx] ?? "";
    lastIndex = placeholderMatch.index + placeholderMatch[0].length;
  }
  restored += protectedText.slice(lastIndex);
  return restored;
}

export async function exportPandocPackageWithScope(
  app: App,
  settings: FeuilletsSettings,
  scope: CompileScope,
  baseName: string,
  contentExtraction: ContentExtraction | null = null,
  contentCollection: ContentCollection | null = null,
  compileFn: typeof compile = compile
): Promise<string | undefined> {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice(t("export.pandoc.projectFolderNotFound"));
    return undefined;
  }

  try {
    const compileOptions: CompileOptions = {
      writeOutput: false,
      bibliographyMode: "pandoc",
      ...(contentExtraction ? { contentExtraction } : {}),
      ...(contentCollection ? { contentCollection } : {}),
    };

    const result = await compileFn(
      app,
      settings,
      null,
      scope,
      undefined,
      compileOptions
    );
    if (!result) return undefined;

    const editorialRootForExport = resolveEditorialRootFor(app, folder, null, scope);
    const composition = effectiveComposition(settings, folder, editorialRootForExport);
    const wantBibliography = Boolean(composition.bibliography);
    const suppressBibliography = !wantBibliography;

    const mediaCollector: MediaCollectorState = {
      mediaFiles: new Map(),
      mediaVaultMap: new Map(),
      seenNames: new Map(),
      warnings: [],
    };

    const transformedSegments: CompileSegment[] = [];
    for (const seg of result.segments) {
      if (seg.path) {
        const transformedText = await transformSegmentMedia(app, seg.text, seg.path, mediaCollector);
        const transformedRenderText = seg.renderText !== undefined
          ? await transformSegmentMedia(app, seg.renderText, seg.path, mediaCollector)
          : undefined;
        transformedSegments.push({
          ...seg,
          text: transformedText,
          ...(transformedRenderText !== undefined ? { renderText: transformedRenderText } : {}),
        });
      } else {
        transformedSegments.push(seg);
      }
    }

    const finalManuscript = joinCompiledSegments(
      transformedSegments.map((s) => ({
        ...s,
        text: s.renderText ?? s.text,
      })),
      composition.separator
    );

    const unknownKeys: PandocPackageCitationReportItem[] = [];
    const neededBibFilesMap = new Map<string, TFile>();

    for (const filePath of result.compiledFilePaths) {
      const file = app.vault.getAbstractFileByPath(normalizePath(filePath));
      if (!(file instanceof TFile) || file.extension !== "md") continue;

      const content = typeof app.vault.cachedRead === "function"
        ? await app.vault.cachedRead(file)
        : await app.vault.read(file);
      const fileCitekeys = extractCitekeysCached(file, content);
      if (fileCitekeys.size === 0) continue;

      const { bibFile } = resolveBibliographicScope(app, settings, folder, file);
      if (bibFile) {
        const catalog = await getCachedBibtexCatalog(app, bibFile);
        const catalogMap = new Map<string, BibtexCatalogEntry>();
        for (const entry of catalog) {
          catalogMap.set(entry.key, entry);
        }

        let bibNeededByThisFile = false;
        for (const [key, count] of fileCitekeys) {
          if (catalogMap.has(key)) {
            bibNeededByThisFile = true;
          } else {
            unknownKeys.push({
              key,
              occurrenceCount: count,
              sourceMarkdownPath: relativePathToProject(folder, file),
              resolverStatus: "unknown_citekey",
            });
          }
        }
        if (bibNeededByThisFile) {
          neededBibFilesMap.set(normalizePath(bibFile.path), bibFile);
        }
      } else {
        const res = resolveWorkspaceCitationResources(app, settings, folder, file);
        let resolverStatus: ResolverStatus = "missing_bibliography";
        if (res.bibliography.status === "disabled") {
          resolverStatus = "disabled_bibliography";
        } else if (res.bibliography.status === "invalid_path") {
          resolverStatus = "invalid_bibliography_path";
        } else if (res.bibliography.status === "unbound_research" && !res.selectionResearchFolder) {
          resolverStatus = "unbound_research";
        }

        for (const [key, count] of fileCitekeys) {
          unknownKeys.push({
            key,
            occurrenceCount: count,
            sourceMarkdownPath: relativePathToProject(folder, file),
            resolverStatus,
          });
        }
      }
    }

    const neededBibFiles = Array.from(neededBibFilesMap.values());

    const seenKeyOwner = new Map<string, { path: string; name: string }>();
    for (const bibFile of neededBibFiles) {
      const catalog = await getCachedBibtexCatalog(app, bibFile);
      for (const entry of catalog) {
        const previousOwner = seenKeyOwner.get(entry.key);
        if (previousOwner && previousOwner.path !== bibFile.path) {
          new Notice(t("export.pandoc.duplicateCitekey", {
            key: entry.key,
            file1: previousOwner.name,
            file2: bibFile.name,
          }));
          return undefined;
        }
        seenKeyOwner.set(entry.key, { path: bibFile.path, name: bibFile.name });
      }
    }

    const { folder: citationTargetFolder, failClosed: citationFailClosed } =
      resolveExportCitationTargetFolder(app, null, scope);
    let cslFile: PandocPackageCslFile | null = null;
    if (!citationFailClosed) {
      const scopeRes = resolveWorkspaceCitationResources(app, settings, folder, citationTargetFolder);
      if (scopeRes.csl.status === "valid" && scopeRes.csl.file) {
        const cslContent = await app.vault.read(scopeRes.csl.file);
        cslFile = {
          filename: sanitizeArchiveSegment(scopeRes.csl.file.name),
          content: cslContent,
        };
      }
    }

    const bibliographies: PandocPackageBibliographyFile[] = [];
    const seenBibNames = new Map<string, number>();
    for (const bibFile of neededBibFiles) {
      const safeBase = sanitizeArchiveSegment(bibFile.name);
      const lower = safeBase.toLowerCase();
      const count = seenBibNames.get(lower) || 0;
      seenBibNames.set(lower, count + 1);
      let filename = safeBase;
      if (count > 0) {
        const dotIdx = safeBase.lastIndexOf(".");
        filename = dotIdx > 0
          ? `${safeBase.slice(0, dotIdx)}-${count}${safeBase.slice(dotIdx)}`
          : `${safeBase}-${count}`;
      }
      const content = await app.vault.read(bibFile);
      bibliographies.push({ filename, content });
    }

    const hasReport = unknownKeys.length > 0 || mediaCollector.warnings.length > 0;
    const citationReport: PandocPackageCitationReport | null = hasReport
      ? {
          ...(unknownKeys.length > 0 ? { unknownKeys } : {}),
          ...(mediaCollector.warnings.length > 0 ? { warnings: mediaCollector.warnings } : {}),
        }
      : null;

    const zipData = await createPandocPackage({
      manuscript: finalManuscript,
      suppressBibliography,
      bibliographies,
      csl: cslFile,
      media: Array.from(mediaCollector.mediaFiles.values()),
      citationReport,
    });

    const opLocale = getLocale();
    const outputFolder = await getOutputFolder(app, settings, opLocale);
    const outBase = outputFolder ? outputFolder.path : folder.path;
    const safeBase = resolveOutputBaseName(baseName, composition.fileName);
    const zipBaseName = safeBase.toLowerCase().endsWith("-pandoc") ? safeBase : `${safeBase}-pandoc`;
    const outPath = normalizePath(`${outBase}/${zipBaseName}.zip`);
    const writtenPath = await writeBinaryFile(app, outPath, zipData);
    new Notice(t("export.pandoc.exportSuccess", { path: writtenPath }));
    return writtenPath;
  } catch (e) {
    console.error("Feuillets: export pandoc", e);
    const err = toCompileError(e, "export pandoc", { format: "pandoc" });
    new Notice(err.describe().slice(0, 300));
    return undefined;
  }
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
  contentExtraction: ContentExtraction | null = null,
  contentCollection: ContentCollection | null = null,
  compileFn: typeof compile = compile
): Promise<string | undefined> {
  if (format === "md") {
    /* Format Markdown : compile() écrit déjà le .md dans _Sortie et renvoie
       le chemin ; on réutilise le paramètre outputFileName pour forcer le nom. */
    const result = await compileFn(app, settings, null, scope, baseName);
    return result?.outPath;
  }
  if (format === "pandoc") {
    return exportPandocPackageWithScope(app, settings, scope, baseName, contentExtraction, contentCollection, compileFn);
  }
  /* Formats binaires : on passe par exportViaNative en fournissant la portée
     et le baseName directement — l'extension est ajoutée par exportViaNative
     selon le format. */
  return exportViaNative(app, settings, format, null, undefined, baseName, false, scope, contentExtraction, contentCollection);
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
  contentExtraction?: ContentExtraction | null,
  contentCollection?: ContentCollection | null
): Promise<string | undefined> {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  /* `compile()` est désormais À L'INTÉRIEUR du même filet try/catch que
     l'écriture des formats binaires plus bas : une erreur survenant pendant
     la compilation en mémoire ne doit jamais devenir une Promise rejetée
     non gérée — compile() gère
     déjà elle-même la plupart de ses erreurs (Notice + retour null), mais
     ce filet reste le dernier recours si une exception lui échappe malgré
     tout. */
  try {
    /* Utiliser la portée explicite si fournie, sinon le chemin legacy. */
    const compileOptions: CompileOptions = { writeOutput: false };
    if (contentExtraction || contentCollection) {
      compileOptions.contentExtraction = contentExtraction;
      compileOptions.contentCollection = contentCollection;
    }
    const result = await compile(
      app,
      settings,
      scopePath,
      scope ?? null,
      undefined,
      compileOptions,
    );
    if (!result) return undefined;

    /* Même racine éditoriale que celle que compile() vient d'utiliser pour
       CE MÊME appel (scopePath/scope identiques, voir
       resolveEditorialRootFor) : la composition effective ci-dessous ne
       peut donc jamais diverger de celle déjà appliquée par compile() —
       Markdown, PDF, DOCX, EPUB et ODT partagent ainsi toujours strictement
       la même composition. */
    const editorialRootForExport = resolveEditorialRootFor(app, folder, scopePath, scope);
    const composition = effectiveComposition(settings, folder, editorialRootForExport);

    const { title, author } = resolveExportIdentity(app, settings, folder, result.segments);
    /* Le fichier compilé réel (result.outPath) plutôt que le dossier projet :
       la résolution des embeds (![[image.png]]) par Obsidian a besoin d'un
       chemin de FICHIER pour son contexte de répertoire — un chemin de
       dossier peut fausser la résolution des liens relatifs. */
    const scopedFile = scope?.type === "file"
      ? app.vault.getAbstractFileByPath(normalizePath(scope.path))
      : null;
    const segmentFile = result.segments.find((segment) => {
      if (!segment.path) return false;
      return app.vault.getAbstractFileByPath(normalizePath(segment.path)) instanceof TFile;
    });
    const sourcePath = scopedFile instanceof TFile
      ? scopedFile.path
      : segmentFile?.path && app.vault.getAbstractFileByPath(normalizePath(segmentFile.path)) instanceof TFile
        ? normalizePath(segmentFile.path)
        : folder.path;
    const opLocale = getLocale();
    const outputFolder = await getOutputFolder(app, settings, opLocale);
    const outBase = destinationFolderPath || (outputFolder ? outputFolder.path : folder.path);
    const baseName = resolveOutputBaseName(baseNameOverride, composition.fileName);
    const segments: NativeExportSegment[] = result.segments.map(({ path, text, renderText, frontType, generatedType, sourceTitle, sourceSubtitle, startsWithGeneratedTitle, structuralType, sceneBreakBefore }) =>
      frontType === null ? { path, text, ...(renderText !== undefined ? { renderText } : {}), ...(generatedType ? { generatedType } : {}), ...(sourceTitle ? { sourceTitle } : {}), ...(sourceSubtitle ? { sourceSubtitle } : {}), ...(startsWithGeneratedTitle ? { startsWithGeneratedTitle } : {}), ...(structuralType ? { structuralType } : {}), ...(sceneBreakBefore ? { sceneBreakBefore } : {}) } : { path, text, frontType, ...(renderText !== undefined ? { renderText } : {}), ...(generatedType ? { generatedType } : {}), ...(sourceTitle ? { sourceTitle } : {}), ...(sourceSubtitle ? { sourceSubtitle } : {}), ...(startsWithGeneratedTitle ? { startsWithGeneratedTitle } : {}), ...(structuralType ? { structuralType } : {}), ...(sceneBreakBefore ? { sceneBreakBefore } : {}) }
    );
    const contentVariant = await selectedContentVariant(app, settings);
    const { folder: citationTargetFolder, failClosed: citationFailClosed } =
      resolveExportCitationTargetFolder(app, scopePath, scope);

    const projectMeta = settings.projectMeta?.[folder.path];
    const citationStyle = (projectMeta?.pandocCitationPreviewStyle as PandocCitationPreviewStyle) || "off";
    let citationBibliographyPath = "";

    if (!citationFailClosed) {
      const resolution = resolveWorkspaceCitationResources(app, settings, folder, citationTargetFolder);
      if (resolution.bibliography.status === "valid" && resolution.bibliography.file) {
        citationBibliographyPath = resolution.bibliography.file.path;
      }
    }

    const citationSettings: ExportCitationSettings = {
      style: citationStyle,
      bibliographyPath: citationBibliographyPath,
    };

    const ctx: NativeExportContext = {
      markdown: result.manuscript,
      title,
      author,
      sourcePath,
      segments,
      contentVariant,
      separator: composition.separator,
      citationSettings,
    };

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

function exactArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
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
    buf = exactArrayBuffer(data);
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
