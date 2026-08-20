/* Feuillets 2.0 — écriture longue façon Scrivener/Ulysses pour Obsidian.
 *
 * Structure : PARTIES (dossiers racine) → CHAPITRES (sous-dossiers)
 *             → SCÈNES (fichiers .md). Niveaux 1 et 3 facultatifs :
 *             fichiers à la racine ou dans une partie = chapitres simples.
 *
 * Compilation : Manuscrit.md = parties, chapitres, textes des scènes.
 * Les noms techniques des fichiers ne sont JAMAIS repris à la compilation :
 * seuls les noms de dossiers et la clé `titre` du frontmatter sont utilisés.
 *
 * Frontmatter par scène : titre, ordre, synopsis, statut, objectif, tags.
 * Objectif des chapitres (dossiers) : stocké dans les réglages du plugin.
 */

import { DEFAULT_SETTINGS } from "./default-settings.js";
import type { CompileScope } from "./services/compile-scope.js";
import type { ScriveningsScrollAnchor } from "./utils/cm-scrivenings-scroll.js";
import { VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW, VIEW_SIDEBAR_FEUILLETS, VIEW_PREVIEW, VIEW_SCRIVENINGS, getStatusColor, HIDEABLE_PANELS } from "./constants.js";
import { projectWordGoalDefault, projectTolerance } from "./services/project-settings.js";
import { countWords, escapeRegExp, todayKey, parseStoryDate, compactLineBreaks, frenchTypography } from "./utils/core.js";
import { stripWritingNoise, countSentences, countParagraphs, formatNumber } from "./utils/text-metrics.js";
import {
  nextFootnoteNumber,
  renumberFootnotes,
  validateFootnotes,
  referenceIdAtOffset,
  definitionIdAtOffset,
  findDefinition,
  findReferences,
} from "./utils/footnotes.js";
import { openFileActivating, openFileAndSelectRange, selectRange } from "./utils/dom.js";
import { NotesView } from "./views/notes-view.js";
import { PropertiesView } from "./views/properties-view.js";
import { ResearchView } from "./views/research-view.js";
import { JournalView } from "./views/journal-view.js";
import { ProjectView } from "./views/project-view.js";
import { PreviewView, openWithPreview } from "./views/preview-view.js";
import { ScriveningsView } from "./views/scrivenings-view.js";
import { formatScriveningsStats } from "./utils/scrivenings-stats.js";
import { activeComparisonContext, closeFeuilletsComparison } from "./views/comparison-view.js";
import { CitationSourceModal, promptForPage } from "./ui/citation-modal.js";
import { formatCitation } from "./services/citations.js";
import { bibliographyEntries, generateBibliography, resolveBibliographySource } from "./services/bibliography-generator.js";
import { getResearchTemplate } from "./services/research-templates.js";

import { FeuilletsView } from "./views/feuillets-view.js";
import { remapResearchFolderLinks } from "./views/base-feuillets-view.js";
import { BoardView, type BoardModeKey } from "./views/board-view.js";
import { SidebarFeuilletsView, type EditionPage } from "./views/sidebar-feuillets-view.js";
import { FeuilletsSettingTab } from "./settings/feuillets-setting-tab.js";
import { initScenesEditor, type ScenesEditorPlugin } from "./scenes-editor.js";
import { folderNoteFor, getOrCreateFolderNote } from "./services/folder-notes.js";
import { fmOf, titleFor, shortTitleFor, compiledTitleFor, tagsOf, labelOf, labelsOf, labelColor, folderGoal } from "./services/frontmatter.js";
import { getProjectFolder, projectDisplayName, depthOf, isFrontMatter, roleOfFolder, roleOfFile, getOrderedChildren, flattenFiles, chapterCount, getChapters } from "./services/folder-structure.js";
import { prepareSubmission } from "./services/courrier-integration.js";
import { getProjectMode, getProjectType } from "./services/project-mode.js";
import { chronologyFolderPath, getChronoFolder, getResearchRoot, researchFolderPath, migrateLegacyResearchEntries, maybeRenameResearchFile, entityMatchTags, entityMatchNames, findAppearances } from "./services/research.js";
import { parseChronologyImport } from "./services/chronology-import.js";
import { buildNumbering } from "./services/numbering.js";
import { orderFromSnapshot } from "./utils/sibling-order.js";
import { handleFilChanged } from "./services/narrative-threads.js";
import { createDemoProject } from "./services/demo-project.js";
import {
  addFileNodeToNotebook,
  addFileNodesToNotebook,
  addTextNodeToNotebook,
  canvasPathFor,
  generateCanvasBoard,
  type LiveCanvasFileView,
  type CanvasData,
} from "./services/canvas-board.js";
import { CaptureIdeaModal } from "./ui/capture-idea-modal.js";
import { CanvasBridgeModal } from "./ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "./ui/canvas-chapter-modal.js";
import type { BridgeMode } from "./services/canvas-bridge.js";
import { registerAdvancedCanvasIntegration } from "./integrations/advanced-canvas.js";
import { ensureFolder, snapshotFile, listSnapshotFiles, initProjectStructure, newFolder, newSheet, duplicateProjectFolder, getVersionsRoot } from "./services/project-files.js";
import { createProjectBackup } from "./services/project-backup.js";
import { exportBuiltInTemplates } from "./services/export-templates-custom.js";
import { activePresetConfig, getOutputFolder, compile, exportFile, projectMetaFor, listCompiledFilePaths } from "./services/compile-export.js";
import { ensureDayEntry, compileJournal } from "./services/journal.js";
import { matchesResearchLabel } from "./utils/project-modes.js";
import { setLocale, detectLocale, t } from "./i18n/index.js";
import { ImportOutlineModal } from "./ui/import-outline-modal.js";
import { ManageProjectsModal, NewProjectModal, DuplicateVersionModal } from "./ui/project-modals.js";
import { ProjectPropertiesModal, ProjectTagsModal } from "./ui/project-properties-modals.js";
import { ScrivenerImportModal } from "./ui/scrivener-import-modal.js";
import { DocxReviewView } from "./views/docx-review-view.js";
import { NewSheetModal, ConfirmModal } from "./ui/basic-modals.js";
import { FootnoteCheckModal } from "./ui/footnote-modals.js";
import { FileStatsModal } from "./ui/stats-modal.js";
import { AnnotationPopover } from "./ui/annotation-popover.js";
import {
  loadAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  annotationsForFile,
  resolveAnnotation,
  toManuscriptRelativePath,
  remapAnnotationsAfterRename,
  type Annotation,
  type AnnotationColor,
  type AnnotationStyle,
  type AnnotationsStore,
} from "./services/annotations.js";
import { addWorkNote, deleteWorkNote, updateWorkNote, remapWorkNotesAfterRename } from "./services/work-notes.js";

import { SearchReplaceBar } from "./views/search-replace-bar.js";
import { searchHighlightField } from "./utils/cm-search-highlighter.js";
import {
  annotationHighlightField,
  annotationDoubleClickExtension,
  applyAnnotationHighlights,
  clearAnnotationHighlights,
  coordsAtOffset,
  type AnnotationHighlightInput,
  type AnnotationDecorationTarget,
  type AnchorRect,
  type EditorViewInstance as AnnotationEditorViewInstance,
} from "./utils/cm-annotation-highlighter.js";
import { emptyLinesPlugin } from "./utils/cm-empty-lines.js";
import { nativeReviewThreadHighlightField, nativeReviewThreadDoubleClickExtension, applyNativeReviewThreadHighlights, clearNativeReviewThreadHighlights } from "./utils/cm-native-review-highlighter.js";
import { comparisonDecorationField, comparisonReadOnlyField, comparisonClickExtension } from "./utils/cm-comparison-decorations.js";
import { listNativeReviewSessions } from "./services/native-review-exchange.js";
import { currentReviewRound, nativeReviewWorkingContext } from "./services/native-review-session.js";
import { loadNativeReviewThreads, addNativeReviewThread, setNativeReviewThreadResolved } from "./services/native-review-threads.js";
import { NativeReviewThreadPopover } from "./ui/native-review-thread-popover.js";
import { reviewSessionPaths, reviewerReviewStorageLocation, type NativeReviewStorageLocation } from "./services/native-review-storage.js";
import { paragraphIndentPlugin } from "./utils/cm-paragraph-indent.js";
import {
  grammarIssuesField,
  grammarContextMenuExtension,
  applyGrammarHighlights,
} from "./utils/cm-grammar-highlighter.js";
import { stripLegacyGrammarSettings, cleanupLegacyEnginesOnDisk } from "./services/legacy-grammar-cleanup.js";
import {
  TextAnalysisRegistry,
  createPublicApi,
  type FeuilletsPublicApi,
  type TextAnalysisProvider,
} from "./api/text-analysis.js";
import { runAnalysis, type AnalysisRun } from "./services/text-analysis.js";

import {
  Plugin,
  TFile,
  TFolder,
  Notice,
  normalizePath,
  Menu,
  MarkdownView,
  Platform,
  setTooltip,
  type View,
  type WorkspaceLeaf,
  type Vault,
  type TAbstractFile,
  type Editor,
  type WorkspaceSidedock,
  type WorkspaceMobileDrawer,
  type App,
} from "obsidian";

const RIGHT_SIDEBAR_WIDTH = 280;

/** Sous-menu natif Obsidian : `MenuItem.setSubmenu()` existe à l'exécution
 *  mais n'est pas encore publique dans obsidian.d.ts (voir « Make setSubmenu
 *  public API » sur le forum Obsidian). Les sous-menus du menu contextuel de
 *  l'éditeur et de ses blocs Feuillets s'appuient sur cette surface —
 *  augmentation typée de module, jamais `any`. */
declare module "obsidian" {
  interface MenuItem {
    setSubmenu(): Menu;
  }
}

type ProjectNode = TFile | TFolder;

type MoveHistoryEntry =
  | { type: "reorder"; parentPath: string; order: string[] }
  | {
      type: "move";
      nodeName: string;
      srcParentPath: string;
      destFolderPath: string;
      srcOrder: string[];
      destOrder: string[];
    };

/** Contrat minimal du panneau droit Édition utilisé par les commandes
 * historiques pour ouvrir directement une sous-page sans dépendre de son
 * implémentation concrète. */
interface EditionSidebarPageView {
  openEditionPage(page: EditionPage): Promise<void>;
}

function isEditionSidebarPageView(view: unknown): view is EditionSidebarPageView {
  return (
    typeof view === "object" &&
    view !== null &&
    "openEditionPage" in view &&
    typeof (view as { openEditionPage?: unknown }).openEditionPage === "function"
  );
}

/** Vue générique manipulée par les méthodes de rendu global (renderAllViews,
 * renderStaleViews…) : elles s'appliquent à plusieurs classes de vues
 * différentes (Binder, Board, Notes…) via la même convention `render` /
 * `renderAllSubViews` / `_stale`, jamais déclarée sur la classe `View`
 * d'Obsidian elle-même. */
type StaleableView = View & {
  _stale?: boolean;
  render?: (force?: boolean) => void | Promise<void>;
  renderAllSubViews?: (force?: boolean) => void | Promise<void>;
};

/** `getConfig`/`setConfig` : API interne non déclarée dans obsidian.d.ts,
 * voir commentaire de getVaultConfig/setVaultConfig plus bas. */
type VaultWithConfig = Vault & {
  getConfig?: (key: string) => unknown;
  setConfig?: (key: string, value: unknown) => void;
};

/** `pinned` : API interne non déclarée dans obsidian.d.ts (voir
 * getLeafForOpeningFile). */
type LeafWithPinned = WorkspaceLeaf & { pinned?: boolean };

/** `updateHeader` : API interne non déclarée dans obsidian.d.ts (voir
 * patchTabTitles / refreshTabHeaderFor / refreshAllTabHeaders). */
type LeafWithHeaderUpdate = WorkspaceLeaf & { updateHeader?: () => void };

/** `setSize` : API interne non déclarée dans obsidian.d.ts (voir
 * safeSetSize/adjustSidebarWidth). */
type SplitWithSetSize = (WorkspaceSidedock | WorkspaceMobileDrawer) & {
  setSize?: (width: number) => void;
};

/** `.cm` : instance CodeMirror 6 brute, non déclarée dans l'API `Editor`
 * publique d'Obsidian (voir updateParagraphFocus). */
type EditorWithCM = Editor & {
  cm?: {
    dom?: HTMLElement;
    domAtPos?: (offset: number) => { node: Node } | null;
  };
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Objet de réglages brut (par ex. la valeur chargée par loadData()) :
 * distingue un vrai objet-dictionnaire d'un tableau, de `null`, ou d'un
 * scalaire — sans jamais retomber sur `any` comme le ferait
 * `Array.isArray`/un cast direct. */
function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Comme `Array.isArray`, mais garde le type élément en `unknown` plutôt que
 * de retomber sur `any[]` (signature de la lib standard). */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Longueur du contexte avant/après une annotation (quote exceptée) —
 * partagée par la création (prefix/suffix initiaux, createAnnotationFromSelection)
 * et le réancrage d'une modification (voir reanchorAnnotationPatch) : un
 * seul chiffre, jamais deux longueurs de contexte qui pourraient diverger. */
const ANNOTATION_CONTEXT_LENGTH = 30;

/**
 * Réancre une annotation EXISTANTE contre le texte ACTUEL de son fichier —
 * appelée à la sauvegarde (clic extérieur/Escape en modification, un
 * changement de couleur ou de style), jamais à la création, jamais pour une
 * annotation `unresolved` : si `resolveAnnotation` ne peut pas retrouver le
 * passage avec certitude, aucune position n'est inventée et cette fonction
 * ne modifie rien (`{}`, fusionné sans effet sur le patch appelant). Ne lit
 * que le fichier (jamais d'écriture Markdown) ; start/end/quote/prefix/suffix
 * sont recalculés à partir de CE contenu, jamais de celui capturé à
 * l'ouverture du popover — le texte a pu changer pendant qu'il restait
 * ouvert. Fonction libre (pas une méthode de FeuilletsPlugin) : les types
 * `plugin` structurels utilisés par les autres vues (NotesView, DocxReviewView…)
 * n'ont ainsi rien de nouveau à déclarer. */
async function reanchorAnnotationPatch(app: App, settings: FeuilletsSettings | null | undefined, annotation: Annotation): Promise<Partial<Omit<Annotation, "id">>> {
  const root = getProjectFolder(app, settings);
  const targetFile = root ? app.vault.getAbstractFileByPath(`${root.path}/${annotation.file}`) : null;
  if (!(targetFile instanceof TFile)) return {};
  const content = await (app.vault.cachedRead?.(targetFile) ?? app.vault.read(targetFile));
  const range = resolveAnnotation(annotation, content);
  if (!range) return {};
  return {
    start: range.start,
    end: range.end,
    quote: content.slice(range.start, range.end),
    prefix: content.slice(Math.max(0, range.start - ANNOTATION_CONTEXT_LENGTH), range.start),
    suffix: content.slice(range.end, Math.min(content.length, range.end + ANNOTATION_CONTEXT_LENGTH)),
  };
}

const nativeReviewWorkingTitles = new Map<string, string>();
/** Titres d'onglet pour la colonne comparée d'une Comparison ouverte (voir
 * comparison-view.ts#setComparisonDisplayTitle) — jamais mélangés à
 * `nativeReviewWorkingTitles`, dont le cycle de vie (vidée puis repeuplée à
 * chaque rafraîchissement des sessions) effacerait ces entrées sans le
 * savoir. Posée à l'ouverture d'une comparaison, retirée à sa fermeture. */
const comparisonDisplayTitles = new Map<string, string>();
class FeuilletsPlugin extends Plugin {
  /**
   * Déclaré explicitement sur la sous-classe, comme le demande la doc
   * d'Obsidian (« Declare a concrete type on your subclass to type it »)
   * depuis qu'`Plugin.settings?: unknown` existe dans l'API (1.13.0).
   * Sans cette déclaration, l'ESLint officiel d'Obsidian résout chaque
   * `this.settings` vers ce membre marqué `@since 1.13.0` et signale ~140
   * fois « requires Obsidian v1.13.0 » — alors qu'affecter `this.settings`
   * est justement l'usage documenté et fonctionne depuis toujours (simple
   * propriété d'instance sur les versions antérieures).
   */
  settings!: FeuilletsSettings;
  nativeReviewEditorContext: { reviewId: string; location: NativeReviewStorageLocation; documentId?: string } | null = null;
  activeNativeReviewThreadPopover: NativeReviewThreadPopover | null = null;

  /** Portée d'export courante, mémorisée pour la SEULE durée de la session
   * (Binder, Aperçu et Édition la partagent via services/export-workflow.ts).
   * Volontairement absente de settings/data.json : perdue au redémarrage,
   * ce qui est normal — voir export-workflow.ts. */
  activeExportScope: CompileScope | null = null;

  moveStack?: MoveHistoryEntry[];
  _ribbonDefs?: Array<{ key: string; icon: string; labelKey: string; action: () => void; hideable?: boolean }>;
  _ribbonEls?: Record<string, HTMLElement>;

  /* ---- Analyse linguistique déléguée (voir src/api/text-analysis.ts) ----
     Feuillets n'embarque aucun moteur : un greffon compagnon enregistre un
     fournisseur via `plugin.api`, Feuillets se charge du texte, des offsets,
     de l'affichage et de la navigation. Sans compagnon, tout ceci reste
     inerte — aucune commande ne plante, le panneau explique simplement
     qu'il manque un module. */
  analysisRegistry = new TextAnalysisRegistry();
  /** Surface publique lue par les greffons compagnons. Nommée `api` par
   *  convention Obsidian (`app.plugins.plugins["feuillets"].api`). */
  api: FeuilletsPublicApi = createPublicApi(this.analysisRegistry);
  /** Dernière analyse effectuée, affichée par l'onglet Relecture. */
  analysisRun: AnalysisRun | null = null;
  analysisRunning = false;
  autoAnalyzeTimer: number | ReturnType<typeof setTimeout> | null = null;
  lastAutoAnalyzedContent = "";


  isLayoutReady?: boolean;
  concentrationActive?: boolean;
  _concTimer?: number;
  _dragInProgress?: boolean;
  _dragRetryCount?: number;
  statusEl?: HTMLElement;
  _statusTimer?: number;
  _paraEls?: HTMLElement[] | null;
  _concCounterEl?: HTMLElement | null;
  _savedLeft?: boolean;
  _savedRight?: boolean;
  _escHandler?: (e: KeyboardEvent) => void;
  _originalGetDisplayText?: ((this: MarkdownView) => string) | null;
  _patchedGetDisplayText?: ((this: MarkdownView) => string) | null;
  _refreshTimer?: number;
  _lastMarkdownLeaf?: WorkspaceLeaf;
  _lastCitedSourceByFile?: Map<string, string>;
  _wcCache?: Map<
    string,
    { mtime: number; wc: number; chars: number; charsNoSpaces: number; sentences: number; paragraphs: number }
  >;
  _searchReplaceBar?: SearchReplaceBar;
  _lastBackupAt?: number;
  _isSyncingPanels?: boolean;
  _lastFeuilletsActive?: boolean;

  /* Attachées dynamiquement par initScenesEditor (scenes-editor.js), pas
     déclarées ici en tant que méthodes de classe — voir scenes-editor.ts,
     ScenesEditorPlugin (surface exacte requise, réutilisée par accès indexé
     pour rester synchronisée avec ce module sans dupliquer les signatures). */
  declare isSceneFile: ScenesEditorPlugin["isSceneFile"];
  declare openSceneMenu: ScenesEditorPlugin["openSceneMenu"];
  declare splitActiveScene: ScenesEditorPlugin["splitActiveScene"];
  declare duplicateActiveScene: ScenesEditorPlugin["duplicateActiveScene"];
  declare moveActiveScene: ScenesEditorPlugin["moveActiveScene"];
  declare getActiveFile: ScenesEditorPlugin["getActiveFile"];
  declare splitSceneFile: ScenesEditorPlugin["splitSceneFile"];
  declare duplicateSceneFile: ScenesEditorPlugin["duplicateSceneFile"];
  declare moveSceneFile: ScenesEditorPlugin["moveSceneFile"];
  declare duplicateManyScenes: ScenesEditorPlugin["duplicateManyScenes"];
  declare openMoveManyModal: ScenesEditorPlugin["openMoveManyModal"];
  declare getDefaultRule: ScenesEditorPlugin["getDefaultRule"];
  declare applyRule: ScenesEditorPlugin["applyRule"];
  declare buildMergeYaml: ScenesEditorPlugin["buildMergeYaml"];
  declare buildMergePlan: ScenesEditorPlugin["buildMergePlan"];
  declare openMergeModal: ScenesEditorPlugin["openMergeModal"];
  declare openYamlOptions: ScenesEditorPlugin["openYamlOptions"];
  declare openMergeSelectModal: ScenesEditorPlugin["openMergeSelectModal"];
  declare applyPreset: ScenesEditorPlugin["applyPreset"];
  declare mergeManyScenes: ScenesEditorPlugin["mergeManyScenes"];

  /** Préférence de session NON persistée du sous-menu « Annotation » du menu
   *  contextuel de l'éditeur (même comportement que la Barre historique) :
   *  style/couleur appliqués au clic, cochés au prochain menu, jamais écrits
   *  dans les réglages. Volontairement public (comme `_binderMultiSelect`) :
   *  les contrats de vue en Omit (notes-view/docx-review-view) reposent sur
   *  les membres publics du plugin. */
  annotationMenuStyle: AnnotationStyle = "highlight";
  annotationMenuColor: AnnotationColor = "yellow";

  /* Attachés dynamiquement par base-feuillets-view.ts (Binder, sélection
     multiple, glisser-déposer, recherche). openTagsModal : requis par
     BoardViewPlugin (board-view.ts) mais n'existe nulle part dans le code
     actuel — bouton mort au clic déjà présent avant cette migration, non
     corrigé ici (voir commentaire dans board-view.ts). */
  _binderMultiSelect?: Set<string>;
  _binderMultiSelectAnchor?: { parentPath: string; index: number };
  _researchDragPath?: string | null;
  dragState?: {
    parentPath: string;
    multi?: boolean;
    items?: { path: string; index: number }[];
    index?: number;
    path?: string | null;
  } | null;
  declare openTagsModal: (file: TFile) => void;

  async onload() {
    await this.loadSettings();
    setLocale(detectLocale(this.settings as { language?: string }));

    this.registerViews();
    this.registerHoverLinkSource("feuillets", { display: "Feuillets", defaultMod: false });
    this.registerRibbonIcons();
    this.registerCoreCommands();
    this.registerLastEditorTracking();

    /* `this.settings` (FeuilletsSettings, volontairement partiel — voir
       types.d.ts) est réellement un sur-ensemble de DefaultSettings à
       l'exécution (loadSettings() fait Object.assign({}, DEFAULT_SETTINGS,
       data)), mais élargir le TYPE de la classe casserait la covariance de
       `declare plugin` des vues qui déclarent un contrat plus étroit
       (NotesView, DocxReviewView…) — d'où ces casts locaux plutôt qu'un
       élargissement global. */
    this.addSettingTab(
      new FeuilletsSettingTab(this.app, this as unknown as ConstructorParameters<typeof FeuilletsSettingTab>[1])
    );

    this.applyIndentClass();
    this.applyLeanInterfaceClasses();

    this.registerAutoOpenPanels();
    this.registerConcentrationTracking();
    this.registerDragSafetyNet();
    this.registerLiveTypography();
    this.registerStatusBar();
    this.registerTextEditingCommands();
    this.registerFootnoteContextMenu();
    this.registerAnnotationCommands();
    this.registerAnnotationContextMenu();
    this.registerAnnotationHighlightSync();
    this.registerNativeReviewHighlightSync();
    this.registerNativeReviewContextMenu();
    this.registerVaultEvents();
    this.patchTabTitles();
    this.registerSwipeGestures();
    this.registerAutoBackup();
    this.registerEditorExtension(searchHighlightField);
    this.registerEditorExtension([grammarIssuesField, grammarContextMenuExtension(this)]);
    this.registerEditorExtension([
      annotationHighlightField,
      annotationDoubleClickExtension((id, target) => void this.openAnnotationEditor(id, undefined, target)),
    ]);
    this.registerEditorExtension([nativeReviewThreadHighlightField, nativeReviewThreadDoubleClickExtension((id, target) => void this.openNativeReviewThread(id, target))]);
    this.registerEditorExtension([comparisonDecorationField, comparisonReadOnlyField, comparisonClickExtension()]);
    this.registerEditorExtension(emptyLinesPlugin);
    this.registerEditorExtension(paragraphIndentPlugin);

    this.registerMarkdownPostProcessor((element) => {
      const paragraphs = element.matches("p")
        ? [element]
        : Array.from(element.querySelectorAll<HTMLParagraphElement>("p"));

      for (const p of paragraphs) {
        if (p.children.length === 1 && p.firstElementChild?.tagName === "BR" && p.textContent?.trim() === "") {
          p.classList.add("feuillets-empty-paragraph");
        }
      }
    });

    cleanupLegacyEnginesOnDisk(this.app, this.manifest);

    /* Un compagnon peut s'enregistrer/se retirer à tout moment (installation,
       rechargement du greffon) : le panneau ouvert doit suivre. `register()`
       coupe l'abonnement au déchargement de Feuillets — pas de référence
       retenue vers une vue morte. */
    this.register(this.analysisRegistry.onChange(() => this.refreshAnalysisPanel()));

    /* Intégration Advanced Canvas : purement optionnelle, sans effet si le
       plugin compagnon n'est pas installé (voir integrations/advanced-
       canvas.ts — l'événement personnalisé qu'elle écoute n'est alors
       simplement jamais émis). */
    registerAdvancedCanvasIntegration(this);

    initScenesEditor(this as unknown as ScenesEditorPlugin);
  }

  registerViews() {
    this.registerView(VIEW_SIDEBAR, (leaf) => new FeuilletsView(leaf, this));
    this.registerView(VIEW_BOARD, (leaf) => new BoardView(leaf, this));
    this.registerView(VIEW_NOTES, (leaf) => new NotesView(leaf, this));
    this.registerView(VIEW_PROPERTIES, (leaf) => new PropertiesView(leaf, this));
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.registerView(VIEW_JOURNAL, (leaf) => new JournalView(leaf, this));
    this.registerView(VIEW_PROJECT, (leaf) => new ProjectView(leaf, this));
    this.registerView(VIEW_DOCX_REVIEW, (leaf) => new DocxReviewView(leaf, this));
    this.registerView(VIEW_SIDEBAR_FEUILLETS, (leaf) => new SidebarFeuilletsView(leaf, this));
    this.registerView(VIEW_PREVIEW, (leaf) => new PreviewView(leaf, this));
    // LOT 1 — cœur technique uniquement : pas encore d'entrée Binder/commande
    // pour ouvrir cette vue (voir views/scrivenings-view.ts).
    this.registerView(VIEW_SCRIVENINGS, (leaf) => new ScriveningsView(leaf, this));
  }

  registerRibbonIcons() {
    this._ribbonDefs = [
      { key: "sidebar", icon: "files", labelKey: "main.ribbon.binder", action: () => { void this.activateSidebar(); } },
      { key: "board", icon: "layout-grid", labelKey: "main.ribbon.board", action: () => { void this.activateBoard(); } },
      { key: "concentration", icon: "focus", labelKey: "settings.section.focusMode", action: () => this.toggleConcentration() },
    ];
    this._ribbonEls = {};
    this.refreshRibbonIcons();
  }

  refreshRibbonIcons() {
    const hidden = new Set(this.settings.hiddenPanels || []);
    for (const def of this._ribbonDefs!) {
      const shouldShow = !def.hideable || !hidden.has(def.key);
      const existing = this._ribbonEls![def.key];
      if (shouldShow && !existing) {
        this._ribbonEls![def.key] = this.addRibbonIcon(def.icon, t(def.labelKey), def.action);
      } else if (!shouldShow && existing) {
        existing.remove();
        delete this._ribbonEls![def.key];
      } else if (shouldShow && existing) {
        // Langue changée entre-temps : la tooltip existante doit suivre.
        setTooltip(existing, t(def.labelKey));
      }
    }
  }

  isPanelHidden(key: string): boolean {
    return (this.settings.hiddenPanels || []).includes(key);
  }

  async hidePanel(key: string): Promise<void> {
    const set = new Set(this.settings.hiddenPanels || []);
    set.add(key);
    this.settings.hiddenPanels = [...set];
    await this.saveSettings();
    this.refreshRibbonIcons();
    const def = HIDEABLE_PANELS.find((p) => p.key === key);
    if (def) {
      this.app.workspace.getLeavesOfType(def.view).forEach((l) => l.detach());
    }
  }

  registerCoreCommands() {
    /* « Ouvrir avec aperçu » : le feuillet à gauche, l'aperçu de la scène
       à droite. Réutilise une PreviewView déjà ouverte plutôt que d'en
       empiler une seconde, et ne force aucune largeur — l'utilisatrice
       reste libre de déplacer les feuilles ensuite. */
    this.addCommand({
      id: "open-with-preview",
      name: t("main.cmd.openWithPreview"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== "md") return false;
        if (!checking) void openWithPreview(this.app, this, file);
        return true;
      },
    });
    this.addCommand({
      id: "open-binder",
      name: t("main.cmd.openBinder"),
      callback: () => this.activateSidebar(),
    });
    this.addCommand({
      id: "open-board",
      name: t("main.cmd.openBoard"),
      callback: () => this.activateBoard(),
    });
    this.addCommand({
      id: "open-progression",
      name: t("main.cmd.openStatsPanel"),
      callback: () => { void this.activateJournal(); },
    });
    this.addCommand({
      id: "open-journal",
      name: t("main.cmd.openJournal"),
      callback: () => { void this.activateJournal(); },
    });
    this.addCommand({
      id: "open-project",
      name: t("main.cmd.openProjectPanel"),
      callback: () => { void this.activateEditionPage("home"); },
    });
    this.addCommand({
      id: "open-export",
      name: t("main.cmd.openCompileExportPanel"),
      /* La barre Portée / Format / Exporter est globale dans l'onglet
         Édition du panneau droit : ouvrir son accueil suffit, sans toucher
         au Board ni créer de Preview. */
      callback: () => { void this.activateEditionPage("home"); },
    });
    /* Intégration Courrier (Lot 14B) : n'apparaît utilisable que si un
       projet d'écriture est ouvert (même garde que les autres commandes
       de cette section) — Courrier lui-même reste facultatif, absent ou
       désactivé donne juste une notice claire (voir prepareSubmission). */
    this.addCommand({
      id: "prepare-submission",
      name: t("main.cmd.prepareSubmission"),
      checkCallback: (checking) => {
        const root = getProjectFolder(this.app, this.settings);
        if (!root) return false;
        if (!checking) void prepareSubmission(this);
        return true;
      },
    });
    this.addCommand({
      id: "open-properties",
      name: t("main.cmd.projectProperties"),
      // Panneau retiré (fusionné dans l'onglet Notes) — ouvre directement
      // la fenêtre flottante, comme les icônes de la section "Propriétés
      // du fichier" (voir notes-view.js).
      callback: () => new ProjectPropertiesModal(this.app, this).open(),
    });
    this.addCommand({
      id: "open-project-tags",
      name: t("main.cmd.projectTags"),
      callback: () => new ProjectTagsModal(this.app, this).open(),
    });
    /* Commandes génériques d'analyse linguistique : toujours présentes, même
       sans module compagnon installé (elles le disent alors, sans échouer).
       C'est Feuillets qui les porte, pour que le compagnon n'ait pas à
       redéclarer les mêmes entrées dans la palette. */
    this.addCommand({
      id: "analyze-active-file",
      name: t("main.cmd.analyzeActiveFile"),
      callback: () => { void this.analyzeActiveFile(); },
    });
    this.addCommand({
      id: "analyze-selection",
      name: t("main.cmd.analyzeSelection"),
      callback: () => { void this.analyzeSelection(); },
    });
    this.addCommand({
      id: "open-analysis-results",
      name: t("main.cmd.openAnalysisResults"),
      callback: () => { void this.activateSidebarView("relecture"); },
    });
    this.addCommand({
      id: "compile-manuscript",
      name: t("main.cmd.compileManuscript"),
      callback: () => this.compile(),
    });
    this.addCommand({
      id: "compile-journal",
      name: t("main.cmd.compileJournal"),
      callback: () => this.compileJournal(),
    });
    this.addCommand({
      id: "export-docx",
      name: t("main.cmd.exportDocx"),
      callback: () => this.exportFile("docx"),
    });
    this.addCommand({
      id: "export-epub",
      name: t("main.cmd.exportEpub"),
      callback: () => this.exportFile("epub"),
    });
    this.addCommand({
      id: "export-pdf",
      name: t("main.cmd.exportPdf"),
      callback: () => this.exportFile("pdf"),
    });
    this.addCommand({
      id: "import-outline",
      name: t("main.cmd.importOutline"),
      callback: () => new ImportOutlineModal(this.app, this).open(),
    });
    this.addCommand({
      id: "undo-move",
      name: t("main.cmd.undoMove"),
      callback: async () => {
        if (!this.moveStack || this.moveStack.length === 0) {
          new Notice(t("main.notice.nothingToUndo"));
          return;
        }
        const snap = this.moveStack.pop();
        if (!snap) return;

        if (snap.type === "move") {
          const srcParent = this.app.vault.getAbstractFileByPath(snap.srcParentPath);
          const destFolder = this.app.vault.getAbstractFileByPath(snap.destFolderPath);
          const node = this.app.vault.getAbstractFileByPath(normalizePath(`${snap.destFolderPath}/${snap.nodeName}`));
          if (!(srcParent instanceof TFolder) || !(destFolder instanceof TFolder) || !node) {
            new Notice(t("main.notice.undoImpossibleChanged"));
            return;
          }
          const backPath = normalizePath(`${snap.srcParentPath}/${snap.nodeName}`);
          if (this.app.vault.getAbstractFileByPath(backPath)) {
            new Notice(t("main.notice.undoImpossibleNameTaken"));
            return;
          }
          await this.app.fileManager.renameFile(node, backPath);
          await this.writeOrder(srcParent, this.orderFromSnapshot(srcParent, snap.srcOrder));
          await this.writeOrder(destFolder, this.orderFromSnapshot(destFolder, snap.destOrder));
          if (this.settings.autoRename) {
            const root = this.getProjectFolder();
            if (root) await this.renumberTitles(root);
          }
          this.renderAllViews(true);
          new Notice(t("main.notice.crossFolderMoveUndone"));
          return;
        }

        const parent = this.app.vault.getAbstractFileByPath(snap.parentPath);
        if (!(parent instanceof TFolder)) {
          new Notice(t("main.notice.moveFolderGone"));
          return;
        }
        await this.applySiblingOrder(parent, this.orderFromSnapshot(parent, snap.order), false);
        this.renderAllViews(true);
        new Notice(t("main.notice.reorderUndone"));
      },
    });
    this.addCommand({
      id: "toggle-concentration",
      name: t("main.cmd.toggleConcentration"),
      callback: () => this.toggleConcentration(),
    });
    this.addCommand({
      id: "create-project",
      name: t("main.cmd.createProject"),
      callback: () => new NewProjectModal(this.app, this).open(),
    });
    this.addCommand({
      id: "create-demo-project",
      name: t("main.cmd.createDemoProject"),
      callback: () => this.createDemoProject(),
    });
    this.addCommand({
      id: "import-scrivener",
      name: t("main.cmd.importScrivener"),
      callback: () => {
        if (Platform.isMobile) {
          new Notice(t("main.notice.scrivenerDesktopOnly"));
          return;
        }
        new ScrivenerImportModal(this.app, this).open();
      },
    });
    this.addCommand({
      id: "open-docx-review",
      name: t("main.cmd.openDocxReview"),
      callback: () => {
        /* §12A du dernier lot UX avant 2.5 : activateDocxReview() ouvre
           désormais l'onglet "relecture" du panneau latéral unifié (voir
           sidebar-feuillets-view.ts, activeTabFor()) — la clé masquée
           vérifiée ici doit donc être la MÊME que celle qui masque cet
           onglet (settings.hiddenPanels, filtré dans SidebarFeuilletsView),
           pas l'ancienne clé "docxReview" (VIEW_DOCX_REVIEW autonome,
           devenue obsolète dans ce chemin depuis la fusion dans le panneau
           latéral). */
        if (this.isPanelHidden("relecture")) {
          new Notice(t("main.notice.reviewPanelHidden"));
          return;
        }
        void this.activateDocxReview();
      },
    });
    this.addCommand({
      id: "generate-canvas-board",
      name: t("main.cmd.generateCanvasBoard"),
      callback: () => this.generateCanvasBoard(),
    });
    this.addCommand({
      id: "canvas-bridge-to-manuscript",
      name: t("main.cmd.canvasBridgeToManuscript"),
      callback: () => void this.openCanvasBridge("manuscript"),
    });
    this.addCommand({
      id: "canvas-bridge-to-research",
      name: t("main.cmd.canvasBridgeToResearch"),
      callback: () => void this.openCanvasBridge("research"),
    });
    this.addCommand({
      id: "canvas-chapter-create",
      name: t("main.cmd.canvasChapterCreate"),
      callback: () => void this.openCanvasChapterModal(),
    });
    /* Lot 6 — disponible dès qu'un projet Feuillets actif existe (avant/
       pendant l'écriture d'un feuillet, ou depuis toute autre vue) ; la
       modale ne fait jamais rien d'autre qu'ajouter un TextNode libre,
       jamais ouvrir le Carnet ni changer le fichier actif. */
    this.addCommand({
      id: "notebook-capture-idea",
      name: t("main.cmd.notebookCaptureIdea"),
      checkCallback: (checking) => {
        if (!this.getProjectFolder()) return false;
        if (!checking) {
          this.openCaptureIdeaModal();
        }
        return true;
      },
    });
    /* Lot 6 — n'apparaît que pour un feuillet du manuscrit réellement actif
       (prédicat métier existant `isSceneFile`, jamais une détection par
       chemin réinventée ici : exclut Recherche et tout .md hors manuscrit).
       Appelle directement `addFileToNotebook`, jamais dupliquée. */
    this.addCommand({
      id: "notebook-add-current-sheet",
      name: t("main.cmd.notebookAddCurrentSheet"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || !this.isSceneFile(file)) return false;
        if (!checking) void this.addFileToNotebook(file);
        return true;
      },
    });
    this.addCommand({
      id: "manage-projects",
      name: t("main.cmd.manageProjects"),
      callback: () => new ManageProjectsModal(this.app, this).open(),
    });
    this.addCommand({
      id: "switch-project",
      name: t("main.cmd.switchProject"),
      callback: () => {
        const all = [
          this.settings.projectFolder,
          ...this.settings.projects,
        ].filter((p, i, a): p is string => !!p && a.indexOf(p) === i);
        if (all.length < 2) {
          new Notice(t("main.notice.addOtherProjects"));
          return;
        }
        const menu = new Menu();
        for (const p of all) {
          menu.addItem((item) =>
            item
              .setTitle(p)
              .setChecked(p === this.settings.projectFolder)
              .onClick(async () => {
                // MÊME chemin unique que le sélecteur de projet du Binder et
                // que le gestionnaire de projets : `switchProject`.
                const ok = await this.switchProject(p);
                if (!ok) new Notice(t("modal.manageProjects.folderGone", { path: p }));
              })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 80 });
      },
    });
    this.addCommand({
      id: "duplicate-project",
      name: t("main.cmd.duplicateProject"),
      callback: () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("analysis.dashboard.noActiveProject"));
          return;
        }
        new DuplicateVersionModal(this.app, this.projectDisplayName(root.path), (label) => {
          void this.duplicateProject(root.path, label);
        }).open();
      },
    });
    this.addCommand({
      id: "backup-project-now",
      name: t("main.cmd.backupProjectNow"),
      callback: () => this.backupProjectNow(),
    });
    this.addCommand({
      id: "next-sheet",
      name: t("main.cmd.nextSheet"),
      callback: () => this.openNeighbor(1),
    });
    this.addCommand({
      id: "previous-sheet",
      name: t("main.cmd.previousSheet"),
      callback: () => this.openNeighbor(-1),
    });
    this.addCommand({
      id: "snapshot-file",
      name: t("main.cmd.snapshotFile"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice(t("main.notice.noActiveProjectSheet"));
          return;
        }
        const n = await this.snapshotFile(file, root);
        new Notice(t("main.notice.snapshotCreated", { name: n }));
      },
    });
    this.addCommand({
      id: "snapshot-project",
      name: t("main.cmd.snapshotProject"),
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const files = this.flattenFiles(root);
        for (const f of files) await this.snapshotFile(f, root);
        new Notice(t("main.notice.projectSnapshotDone", { count: String(files.length) }));
      },
    });
    this.addCommand({
      id: "pdf-style-modal",
      /* Id conservé pour la compatibilité des raccourcis existants ; la
         commande ouvre désormais Édition → Mise en page dans le panneau
         droit, jamais une surface du Board. */
      name: t("main.cmd.openProjectExportPanel"),
      callback: () => { void this.activateEditionPage("layout"); },
    });
    this.addCommand({
      id: "restore-snapshot",
      name: t("main.cmd.restoreSnapshot"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice(t("main.notice.noActiveProjectSheet"));
          return;
        }
        const snaps = listSnapshotFiles(this.app, file, root);
        if (snaps.length === 0) {
          new Notice(t("main.notice.noSnapshotForSheet"));
          return;
        }
        const menu = new Menu();
        for (const snap of snaps.slice(0, 15)) {
          menu.addItem((item) =>
            item.setTitle(snap.basename).onClick(async () => {
              await this.snapshotFile(file, root);
              const content = await this.app.vault.read(snap);
              await this.app.vault.modify(file, content);
              new Notice(t("main.notice.restored", { name: snap.basename }));
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "export-settings",
      name: t("main.cmd.exportSettings"),
      callback: async () => {
        const root = this.getProjectFolder();
        const dir = root ? root.path : "";
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const path = normalizePath(`${dir ? dir + "/" : ""}feuillets-reglages-${stamp}.json`);
        const payload = JSON.stringify(this.settings, null, 2);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, payload);
        } else {
          await this.app.vault.create(path, payload);
        }
        new Notice(t("main.notice.settingsSaved", { path }));
      },
    });
    this.addCommand({
      id: "import-settings",
      name: t("main.cmd.importSettings"),
      callback: async () => {
        const targetFolderPaths = new Set<string>();
        targetFolderPaths.add("");
        const activeProject = this.getProjectFolder();
        if (activeProject) targetFolderPaths.add(activeProject.path);
        if (this.settings.projectFolder) targetFolderPaths.add(this.settings.projectFolder);
        if (Array.isArray(this.settings.projects)) {
          for (const p of this.settings.projects) {
            if (typeof p === "string" && p) targetFolderPaths.add(p);
          }
        }

        const fileMap = new Map<string, TFile>();
        for (const pathStr of targetFolderPaths) {
          const target = pathStr === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(pathStr);
          if (target instanceof TFolder) {
            for (const child of target.children) {
              if (child instanceof TFile && child.extension === "json" && child.name.startsWith("feuillets-reglages")) {
                fileMap.set(child.path, child);
              }
            }
          }
        }

        const files = Array.from(fileMap.values());
        if (files.length === 0) {
          new Notice(t("main.notice.noSettingsBackupFound"));
          return;
        }
        const menu = new Menu();
        for (const f of files.sort((a, b) => b.name.localeCompare(a.name))) {
          menu.addItem((item) =>
            item.setTitle(f.name).onClick(async () => {
              try {
                const raw = await this.app.vault.read(f);
                const parsed: unknown = JSON.parse(raw);
                if (!isSettingsRecord(parsed)) throw new Error("format");
                this.settings = Object.assign({}, DEFAULT_SETTINGS, parsed) as unknown as FeuilletsSettings;
                await this.saveSettings();
                this.applyIndentClass();
                this.applyLiveTypoClasses();
                this.renderAllViews(true);
                new Notice(t("main.notice.settingsRestored", { name: f.name }));
              } catch (e) {
                console.error("Feuillets : import des réglages", e);
                new Notice(t("main.notice.settingsFileUnreadable"));
              }
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "migrate-research",
      name: t("main.cmd.migrateResearch"),
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const destinationRoot = researchFolderPath(this.app, this.settings, root);
        if (!destinationRoot) return;
        await this.ensureFolder(destinationRoot);
        const result = await migrateLegacyResearchEntries(this.app, root, destinationRoot);
        for (const { from, to } of result.collisions) {
          new Notice(t("main.notice.migrateAlreadyExists", { to, from }));
        }
        new Notice(
          result.moved > 0
            ? t("main.notice.migrateDone", { count: String(result.moved) })
            : t("main.notice.nothingToMigrate")
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "init-project",
      name: t("main.cmd.initProject"),
      callback: () => this.initProjectStructure(),
    });
    this.addCommand({
      id: "export-builtin-templates",
      name: t("main.cmd.exportBuiltinTemplates"),
      callback: async () => {
        const n = await exportBuiltInTemplates(this.app, this.settings);
        new Notice(
          n > 0
            ? t("main.notice.templatesExported", { count: String(n) })
            : t("main.notice.templatesAlreadyPresent")
        );
      },
    });
    this.addCommand({
      id: "renumber-chapters",
      name: t("main.cmd.renumberChapters"),
      callback: async () => {
        const folder = this.getProjectFolder();
        if (!folder) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const n = await this.renumberTitles(folder);
        new Notice(t("main.notice.titlesUpdated", { count: String(n) }));
      },
    });
    this.addCommand({
      id: "open-search-replace-bar",
      name: t("main.cmd.openSearchReplaceBar"),
      callback: () => this.toggleSearchReplaceBar(),
    });
  }

  registerAutoOpenPanels() {
    this.app.workspace.onLayoutReady(async () => {
      this.isLayoutReady = true;

      for (const type of [VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW]) {
        const leaves = this.app.workspace.getLeavesOfType(type);
        for (const leaf of leaves) leaf.detach();
      }
      for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_SIDEBAR_FEUILLETS]) {
        const leaves = this.app.workspace.getLeavesOfType(type);
        for (let i = 1; i < leaves.length; i++) leaves[i].detach();
      }

      // Restauration du dernier projet valide ouvert s'il n'y a pas de projet actif
      if (!this.getProjectFolder() && Array.isArray(this.settings.projects) && this.settings.projects.length > 0) {
        const lastValid = this.settings.projects.slice().reverse().find((p) => {
          const af = this.app.vault.getAbstractFileByPath(p);
          return af instanceof TFolder && af.path !== "" && af.path !== "/";
        });
        if (lastValid) {
          this.settings.projectFolder = lastValid;
          await this.saveSettings();
        }
      }

      const hasProject = !!this.getProjectFolder();

      // Si un projet est actif, ouvrir les panneaux demandés s'ils n'existent pas déjà.
      if (hasProject) {
        if (
          this.settings.autoOpenBinder &&
          this.app.workspace.getLeavesOfType(VIEW_SIDEBAR).length === 0
        ) {
          const leaf = this.app.workspace.getLeftLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR, active: false });
        }

        if (
          this.settings.autoOpenInspector &&
          this.app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).length === 0
        ) {
          const leaf = this.app.workspace.getRightLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: false });
        }
      } else {
        // Si VRAIMENT AUCUN projet n'existe (nouvelle installation), ouvrir le volet binder avec le gestionnaire de projet
        if (this.app.workspace.getLeavesOfType(VIEW_SIDEBAR).length === 0) {
          const leaf = this.app.workspace.getLeftLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR, active: true });
        }
      }

      this.adjustSidebarWidth();
      await this.loadDeferredViews();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.loadDeferredViews())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.loadDeferredViews())
    );
  }

  registerVaultEvents() {
    const refresh = () => {
      if (!this.isLayoutReady) return;
      if (this.settings.projectFolder && !this.getProjectFolder()) {
        const af = this.app.vault.getAbstractFileByPath(this.settings.projectFolder);
        if (!af) {
          this.settings.projectFolder = "";
          void this.saveSettings();
          void this.updateStatusBar();
        }
      }
      this.refreshView();
    };

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.isLayoutReady) refresh();
      void this.maybeAutoInitializeResearchFile(file);
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (this.isLayoutReady) {
        if (this.settings.projectFolder && (file.path === this.settings.projectFolder || this.settings.projectFolder.startsWith(file.path + "/"))) {
          this.settings.projectFolder = "";
          void this.saveSettings();
          void this.updateStatusBar();
        }
        this.refreshView();
      }
    }));

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.isLayoutReady) refresh();
      void this.maybeAutoInitializeResearchFile(file);
      /* Un renommage/déplacement dans le coffre rend obsolètes les chemins
         mémorisés des associations Binder→Recherche : on les remappe pour
         suivre le dossier déplacé, sans toucher aux chemins voisins. */
      if (oldPath && file.path && oldPath !== file.path) {
        this.remapResearchFolderLinks(oldPath, file.path);
        void remapAnnotationsAfterRename(this.app, this.settings, oldPath, file.path).catch(() => undefined);
        void remapWorkNotesAfterRename(this.app, this.settings, oldPath, file.path).catch(() => undefined);
      }
    }));
    this.registerEvent(this.app.vault.on("modify", () => this.refreshView(2500)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.maybeRenameResearchFile(file)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.handleFilChanged(file)));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.renderStaleViews();
      void this.syncProjectPanelsVisibility();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      void this.syncProjectPanelsVisibility();
    }));

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (this.settings.autoAnalyzeInRelecture === false) return;
        if (!this.isRelectureViewActive()) return;

        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return;

        const content = editor.getValue();
        if (content === this.lastAutoAnalyzedContent) return;

        if (this.autoAnalyzeTimer) {
          window.clearTimeout(this.autoAnalyzeTimer);
          this.autoAnalyzeTimer = null;
        }

        this.autoAnalyzeTimer = window.setTimeout(() => {
          this.autoAnalyzeTimer = null;
          if (this.settings.autoAnalyzeInRelecture === false) return;
          if (!this.isRelectureViewActive()) return;

          const currentFile = this.app.workspace.getActiveFile();
          if (!currentFile || currentFile.path !== file.path) return;

          const currentContent = editor.getValue();
          if (currentContent === this.lastAutoAnalyzedContent) return;
          this.lastAutoAnalyzedContent = currentContent;

          void (async () => {
            await this.analyzeActiveFile();
            if (typeof editor.focus === "function") editor.focus();
          })();
        }, 1000);
      })
    );
  }

  async loadDeferredViews() {
    const pending: Promise<void>[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred) {
        pending.push(leaf.loadIfDeferred().catch(() => {}));
      }
    });
    if (pending.length > 0) await Promise.all(pending);
  }

  registerConcentrationTracking() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (!this.concentrationActive) return;
        this.updateParagraphFocus(editor);
        if (this.settings.concentrationTypewriter && editor) {
          const cur = editor.getCursor();
          editor.scrollIntoView({ from: cur, to: cur }, true);
        }
        window.clearTimeout(this._concTimer);
        this._concTimer = window.setTimeout(
          () => { void this.updateConcentrationCounter(editor); },
          250
        );
      })
    );
    this.registerDomEvent(document, "selectionchange", () => {
      if (!this.concentrationActive) return;
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) this.updateParagraphFocus(editor);
    });
  }

  registerDragSafetyNet() {
    const clearDragLeftovers = () => {
      this._dragInProgress = false;
      document
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
        });
    };
    this.registerDomEvent(document, "dragend", clearDragLeftovers);
    this.registerDomEvent(document, "drop", clearDragLeftovers);
  }

  registerLiveTypography() {
    this.registerDomEvent(
      document,
      "keydown",
      (event) => {
        const k = event.key;
        if (k !== "'" && k !== '"' && k !== "Enter" && k !== " ") return;
        const S = this.settings;
        if (
          !S.liveApostrophe &&
          !S.liveGuillemets &&
          !S.liveDashes &&
          !S.liveTwoEnters &&
          !S.liveDoubleEnter
        )
          return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (!target || !target.closest || !target.closest(".cm-editor")) return;
        if ((this.app.vault as VaultWithConfig).getConfig?.("vimMode")) return;
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mdView || mdView.getMode() !== "source") return;
        const file = mdView.file;
        const root = this.getProjectFolder();
        if (!file || !root) return;
        if (root.path !== "" && !file.path.startsWith(root.path + "/")) return;

        const editor = mdView.editor;
        const cursor = editor.getCursor();

        if (event.key === "'" && S.liveApostrophe) {
          event.preventDefault();
          if (editor.somethingSelected()) editor.replaceSelection("\u2019");
          else {
            editor.replaceRange("\u2019", cursor);
            editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
          }
        } else if (event.key === '"' && S.liveGuillemets) {
          event.preventDefault();
          const before = cursor.ch > 0
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 1 }, cursor)
            : "";
          const opening = before === "" || /[\s([«—–-]/.test(before);
          if (opening) {
            editor.replaceRange("\u00AB\u00A0", cursor);
          } else {
            editor.replaceRange("\u00A0\u00BB", cursor);
          }
          editor.setCursor({ line: cursor.line, ch: cursor.ch + 2 });
        } else if (
          event.key === "Enter" &&
          (S.liveTwoEnters || S.liveDoubleEnter) &&
          !editor.somethingSelected()
        ) {
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            editor.replaceRange("  \n", cursor);
            editor.setCursor({ line: cursor.line + 1, ch: 0 });
          } else {
            const lineText = editor.getLine(cursor.line);
            if (/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|>|```|---)/.test(lineText)) {
              /* structure : Entrée normale */
            } else if (
              S.liveDoubleEnter &&
              lineText.trim() === "" &&
              cursor.line > 0
            ) {
              event.preventDefault();
              event.stopPropagation();
              editor.setLine(cursor.line, "\u00A0");
              editor.replaceRange("\n\n", { line: cursor.line, ch: 1 });
              editor.setCursor({ line: cursor.line + 2, ch: 0 });
            } else if (S.liveTwoEnters) {
              event.preventDefault();
              event.stopPropagation();
              editor.replaceRange("\n\n", cursor);
              editor.setCursor({ line: cursor.line + 2, ch: 0 });
            }
          }
        } else if (event.key === " " && S.liveDashes) {
          const back3 = cursor.ch >= 3
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 3 }, cursor)
            : "";
          const back2 = cursor.ch >= 2
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 2 }, cursor)
            : "";
          if (back3 === "---") {
            event.preventDefault();
            editor.replaceRange("\u2014\u00A0", { line: cursor.line, ch: cursor.ch - 3 }, cursor);
          } else if (back2 === "--") {
            event.preventDefault();
            editor.replaceRange("\u2013\u00A0", { line: cursor.line, ch: cursor.ch - 2 }, cursor);
          }
        }
      },
      true
    );
    this.applyLiveTypoClasses();

    const reapply = () => {
      this.applyLiveTypoClasses();
      this.applyIndentClass();
    };
    this.registerEvent(this.app.workspace.on("file-open", reapply));
    this.registerEvent(this.app.workspace.on("active-leaf-change", reapply));
  }

  registerStatusBar() {
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("feuillets-status-bar");
    this.statusEl.addClass("feuillets-status-bar-clickable");
    setTooltip(this.statusEl, t("main.statusBarTooltip"));
    this.statusEl.addEventListener("click", () => {
      // Continu (§8, lot 2B.2) : la status bar affiche le total du GROUPE,
      // pas un feuillet précis — un clic ne doit jamais rouvrir
      // FileStatsModal sur un ancien feuillet actif, jamais utilisé ici.
      if (this.app.workspace.getActiveViewOfType(ScriveningsView)?.compileScope) return;
      const file = this.app.workspace.getActiveFile();
      this.openFileStats(file);
    });
    const updateStatus = () => {
      window.clearTimeout(this._statusTimer);
      this._statusTimer = window.setTimeout(() => { void this.updateStatusBar(); }, 300);
    };
    this.registerEvent(this.app.workspace.on("file-open", updateStatus));
    this.registerEvent(this.app.workspace.on("editor-change", updateStatus));
    this.registerEvent(this.app.workspace.on("active-leaf-change", updateStatus));
    updateStatus();
  }

  registerTextEditingCommands() {
    this.addCommand({
      id: "split-chronology",
      name: t("main.cmd.splitChronology"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(t("main.notice.openChronologyDocFirst"));
          return;
        }
        const raw = await this.app.vault.read(file);
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
        // Moteur pur (services/chronology-import.ts, testable sous Node) :
        // essaie d'abord "## titre" + "### date" (nouveau format), retombe
        // ENTIÈREMENT sur l'ancien format à un seul niveau
        // ("## AAAA[-MM[-JJ]] - Titre") si le document en porte la
        // signature, jamais mélangé. Jamais de propriété `type` déduite ou
        // ajoutée dans les deux cas. Un document mal formé (bloc sans date,
        // ou date non reconnue) fait échouer l'import ENTIER — jamais de
        // création partielle.
        const result = parseChronologyImport(body);
        if (!result.ok) {
          const key = result.error.reason === "missing-date"
            ? "main.notice.chronologyImportMissingDate"
            : "main.notice.chronologyImportInvalidDate";
          new Notice(t(key, { title: result.error.title }));
          return;
        }
        const blocks = result.blocks;
        if (blocks.length === 0) {
          new Notice(t("main.notice.noDatedTitleFound"));
          return;
        }
        const root = this.getProjectFolder();
        const chronologyPath = chronologyFolderPath(this.app, this.settings, root);
        if (!chronologyPath) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const chronoFolder = this.getChronoFolder() || await this.ensureFolder(chronologyPath);

        let created = 0;
        let skipped = 0;
        for (const b of blocks) {
          const safeTitle = b.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
          const safeDate = b.date.replace(/[\\/:*?"<>|]/g, "-");
          const fileName = `${safeDate} - ${safeTitle || t("main.untitled")}`;
          const path = normalizePath(`${chronoFolder.path}/${fileName}.md`);
          if (this.app.vault.getAbstractFileByPath(path)) {
            skipped++;
            continue;
          }
          const synopsis = b.text.replace(/\n+/g, " ").slice(0, 160).trim();
          // Tag historique automatique — ajouté par l'importateur lui-même,
          // jamais demandé à l'auteur, et ce n'est pas une propriété `type` :
          // même résultat homogène pour l'ancien et le nouveau format.
          const content = [
            "---",
            `title: "${(b.title || b.date).replace(/"/g, "'")}"`,
            `date: "${b.date.replace(/"/g, "'")}"`,
            `synopsis: "${synopsis.replace(/"/g, "'")}"`,
            "tags:",
            "  - evenement",
            "---",
            "",
            b.text,
            "",
          ].join("\n");
          await this.app.vault.create(path, content);
          created++;
        }
        new Notice(
          t("main.notice.chronologySplit", { count: String(created) }) +
            (skipped > 0 ? t("main.notice.chronologySplitSkipped", { count: String(skipped) }) : ".")
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "open-research",
      name: t("main.cmd.openResearchPanel"),
      callback: () => { void this.activateResearch(); },
    });
    this.addCommand({
      id: "open-notes",
      name: t("main.cmd.openNotesPanel"),
      callback: () => { void this.activateNotes(); },
    });
    this.addCommand({
      id: "fix-escaped-scene-breaks",
      name: t("main.cmd.fixEscapedSceneBreaks"),
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = src.replace(/^[ \t]*\\?\*\\?\*\\?\*[ \t]*$/gm, "***");
        if (out === src) {
          new Notice(t("main.notice.nothingToFix"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice(t("main.notice.sceneBreaksFixed"));
      },
    });
    this.addCommand({
      id: "compact-line-breaks",
      name: t("main.cmd.compactLineBreaks"),
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.compactLineBreaks(src);
        if (out === src) {
          new Notice(t("main.notice.nothingToCompact"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice(hasSel ? t("main.notice.selectionCompacted") : t("main.notice.documentCompacted"));
      },
    });
    this.addCommand({
      id: "insert-scene-separator",
      name: t("main.cmd.insertSceneSeparator"),
      editorCallback: (editor) => {
        editor.replaceSelection("\n***\n\n");
      },
    });
    this.addCommand({
      id: "french-typography",
      name: t("main.cmd.frenchTypography"),
      editorCallback: (editor) => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || (root.path !== "" && !file.path.startsWith(root.path + "/"))) {
          new Notice(t("main.notice.manuscriptFilesOnly"));
          return;
        }
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.frenchTypography(src, !hasSel);
        if (out === src) {
          new Notice(t("main.notice.nothingToFixShort"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else {
          const cursor = editor.getCursor();
          editor.setValue(out);
          editor.setCursor(cursor);
        }
        new Notice(t("main.notice.frenchTypographyApplied"));
      },
    });
    this.addCommand({
      id: "insert-footnote",
      name: t("main.cmd.insertFootnote"),
      editorCallback: (editor) => this.insertFootnote(editor),
    });
    this.addCommand({
      id: "insert-citation",
      name: t("main.cmd.insertCitation"),
      editorCallback: (editor) => this.openInsertCitation(editor),
    });
    this.addCommand({
      id: "renumber-footnotes",
      name: t("main.cmd.renumberFootnotes"),
      editorCallback: (editor) => this.renumberFootnotesInEditor(editor),
    });
    this.addCommand({
      id: "goto-footnote-definition",
      name: t("main.cmd.gotoFootnoteDefinition"),
      editorCallback: (editor) => this.gotoFootnoteDefinition(editor),
    });
    this.addCommand({
      id: "goto-footnote-reference",
      name: t("main.cmd.gotoFootnoteReference"),
      editorCallback: (editor) => this.gotoFootnoteReference(editor),
    });
    this.addCommand({
      id: "check-footnotes",
      name: t("main.cmd.checkFootnotes"),
      editorCallback: (editor) => this.checkFootnotesInEditor(editor),
    });
  }

  /** Menu contextuel de l'éditeur pour les notes de bas de page : n'affiche
   * chaque action que si elle est pertinente à la position du curseur — pas
   * de « Aller à la note » si le curseur n'est sur aucun appel, pas de
   * « Revenir à l'appel » hors d'une définition (voir le chantier notes de
   * bas de page, section Interface). L'insertion, elle, reste toujours
   * proposée : jamais hors contexte sur un feuillet Markdown. */
  /** Le bloc Feuillets du menu contextuel de l'éditeur groupe désormais ses
   *  notes dans UN SEUL sous-menu natif « Note de bas de page » (plus
   *  d'entrée plate au niveau racine). Tous les libellés proviennent des
   *  mécanismes existants ; « Aller à la note »/« Retourner à l'appel »
   *  n'apparaissent que dans un contexte de note, comme avant. */
  registerFootnoteContextMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView) || !view.file || view.file.extension !== "md") return;
        const content = editor.getValue();
        const offset = editor.posToOffset(editor.getCursor());
        const refId = referenceIdAtOffset(content, offset);
        const defId = definitionIdAtOffset(content, offset);

        menu.addSeparator();
        menu.addItem((item) => {
          item.setTitle(t("editorMenu.footnote")).setIcon("list-plus");
          const sub = item.setSubmenu();
          sub.addItem((entry) =>
            entry.setTitle(t("editorMenu.footnote.insert")).setIcon("list-plus").onClick(() => this.insertFootnote(editor))
          );
          if (refId) {
            sub.addItem((entry) =>
              entry
                .setTitle(t("editorMenu.footnote.gotoDefinition"))
                .setIcon("arrow-down-to-line")
                .onClick(() => this.gotoFootnoteDefinition(editor))
            );
          }
          if (defId) {
            sub.addItem((entry) =>
              entry
                .setTitle(t("editorMenu.footnote.gotoReference"))
                .setIcon("arrow-up-to-line")
                .onClick(() => this.gotoFootnoteReference(editor))
            );
          }
          sub.addSeparator();
          sub.addItem((entry) =>
            entry.setTitle(t("editorMenu.footnote.check")).onClick(() => this.checkFootnotesInEditor(editor))
          );
          sub.addItem((entry) =>
            entry.setTitle(t("editorMenu.footnote.renumber")).onClick(() => this.renumberFootnotesInEditor(editor))
          );
        });
      })
    );
  }

  /* ---------- Annotations de relecture (surlignage éditeur, lot 3) ----------
     Stockage/ancrage : services/annotations.ts (lot 1). Décorations
     CodeMirror : utils/cm-annotation-highlighter.ts (lot 2). Ici : la
     commande de création, l'entrée de menu contextuel, le modal, et le
     chargement/rafraîchissement des surlignages du fichier actif — jamais
     d'écriture dans le Markdown, jamais de nouveau système de stockage. */

  /** L'instance EditorView de CodeMirror 6 (view.editor.cm) — même accès
   * non typé que runAnalysisCommand pour applyGrammarHighlights : `cm`
   * n'est pas déclaré dans obsidian.d.ts. */
  annotationCmView(editor: Editor | null): AnnotationEditorViewInstance | null {
    if (!editor) return null;
    const cm = (editor as unknown as Record<string, unknown>).cm;
    return (cm as AnnotationEditorViewInstance) ?? null;
  }

  /** Disponible seulement avec une sélection non vide, dans un fichier
   * Markdown du Manuscrit d'un projet Feuillets (voir
   * toManuscriptRelativePath) — jamais hors de ce sous-arbre. */
  canAnnotateSelection(): boolean {
    const editor = this.activeEditorAnywhere();
    if (!editor || !editor.somethingSelected()) return false;
    const file = this.app.workspace.getActiveFile();
    return !!file && toManuscriptRelativePath(this.app, this.settings, file) !== null;
  }

  registerAnnotationCommands(): void {
    this.addCommand({
      id: "add-annotation",
      name: t("main.cmd.addAnnotation"),
      checkCallback: (checking) => {
        if (!this.canAnnotateSelection()) return false;
        if (!checking) void this.createAnnotationFromSelection();
        return true;
      },
    });
  }

  /** Le bloc Feuillets du menu contextuel de l'éditeur : sous-menu
   *  « Annotation » (style/couleur/commentaire, actions désactivées sans
   *  sélection, jamais d'annotation vide) puis « Noter une idée » (même flux
   *  que la commande Carnet existante). Le sous-menu n'apparaît que dans un
   *  feuillet du Manuscrit ; « Noter une idée » dès qu'un projet existe. */
  registerAnnotationContextMenu(): void {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView) || !view.file) return;
        if (toManuscriptRelativePath(this.app, this.settings, view.file) !== null) {
          this.buildAnnotationEditorSubmenu(menu, editor, view.file);
        }
        if (this.getProjectFolder()) {
          menu.addItem((item) =>
            item.setTitle(t("editorMenu.captureIdea")).setIcon("pen-line").onClick(() => this.openCaptureIdeaModal())
          );
        }
      })
    );
  }

  /** Construction du sous-menu « Annotation » — hérite de la logique
   *  fonctionnelle du prototype de la Barre (menus natifs Style/Couleur/
   *  commentaire, préférence de session non persistée) posée sur le clic
   *  droit de l'éditeur. Les actions style/couleur sont désactivées sans
   *  sélection annotable ; le commentaire « Ajouter / modifier… » reste
   *  possible sur une annotation déjà présente au curseur. */
  buildAnnotationEditorSubmenu(menu: Menu, editor: Editor, file: TFile): void {
    const hasSelection = editor.somethingSelected();
    menu.addItem((item) => {
      item.setTitle(t("editorMenu.annotation")).setIcon("highlighter");
      const sub = item.setSubmenu();

      sub.addItem((i) => i.setTitle(t("editorMenu.annotation.style")).setDisabled(true));
      const styles: Array<AnnotationStyle> = ["highlight", "underline", "strikethrough"];
      for (const style of styles) {
        sub.addItem((i) => {
          i.setTitle(t(`editorMenu.annotation.style.${style}`));
          if (!hasSelection) i.setDisabled(true);
          else i.setChecked(this.annotationMenuStyle === style);
          i.onClick(() => {
            this.annotationMenuStyle = style;
            void this.applyAnnotationOrUpdate(editor, file, style, this.annotationMenuColor);
          });
        });
      }

      sub.addSeparator();
      sub.addItem((i) => i.setTitle(t("editorMenu.annotation.color")).setDisabled(true));
      const colors: Array<AnnotationColor> = ["yellow", "green", "blue", "pink"];
      for (const color of colors) {
        sub.addItem((i) => {
          i.setTitle(t(`annotation.popover.color.${color}`));
          if (!hasSelection) i.setDisabled(true);
          else i.setChecked(this.annotationMenuColor === color);
          i.onClick(() => {
            this.annotationMenuColor = color;
            void this.applyAnnotationOrUpdate(editor, file, this.annotationMenuStyle, color);
          });
        });
      }

      sub.addSeparator();
      sub.addItem((i) =>
        i
          .setTitle(t("editorMenu.annotation.comment"))
          .setIcon("message-square")
          .onClick(() => void this.openAnnotationCommentForContext(editor, file, this.annotationMenuStyle, this.annotationMenuColor))
      );
    });
  }

  /** Position de repli du popover d'annotation quand aucune ancre réelle
   * n'a pu être calculée (ex. « Modifier » depuis la page centralisée
   * Annotations, où aucune décoration n'est visible à l'écran) — un coin
   * raisonnable plutôt qu'un crash ou un refus d'ouvrir. */
  static readonly DEFAULT_ANNOTATION_ANCHOR: AnchorRect = { left: 24, right: 24, top: 24, bottom: 24 };

  /** Capture le texte sélectionné, ses offsets et un peu de contexte
   * avant/après (utilisés par resolveAnnotation si le texte bouge un peu
   * plus tard), puis ouvre le popover ancré près de la sélection —
   * n'écrit dans annotations.json qu'à la fermeture du popover (voir
   * AnnotationPopover.close), jamais avant, jamais dans le Markdown.
   * `cancelOnEscape: true` : Escape sur une création ANNULE, aucune
   * annotation vide n'est créée — un clic extérieur, lui, sauvegarde
   * toujours (voir le contrat de AnnotationPopover). */
  async createAnnotationFromSelection(
    editorOverride?: Editor,
    fileOverride?: TFile,
    initial?: { style?: AnnotationStyle; color?: AnnotationColor }
  ): Promise<void> {
    const editor = editorOverride ?? this.activeEditorAnywhere();
    const file = fileOverride ?? this.app.workspace.getActiveFile();
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    const selection = this.currentSelectionRange(editor ?? undefined);
    if (!editor || relPath === null || !selection) {
      new Notice(t("annotation.notice.noSelection"));
      return;
    }

    const content = editor.getValue();
    const CONTEXT_LENGTH = ANNOTATION_CONTEXT_LENGTH;
    const quote = content.slice(selection.start, selection.end);
    const prefix = content.slice(Math.max(0, selection.start - CONTEXT_LENGTH), selection.start);
    const suffix = content.slice(selection.end, Math.min(content.length, selection.end + CONTEXT_LENGTH));

    const cm = this.annotationCmView(editor);
    const anchor =
      coordsAtOffset(cm, selection.end) ??
      coordsAtOffset(cm, selection.start) ??
      FeuilletsPlugin.DEFAULT_ANNOTATION_ANCHOR;

    new AnnotationPopover({
      parentEl: document.body,
      anchor,
      text: "",
      color: initial?.color ?? "yellow",
      style: initial?.style ?? "highlight",
      cancelOnEscape: true,
      onSave: async (text, color, style) => {
        await addAnnotation(this.app, this.settings, {
          file: relPath,
          start: selection.start,
          end: selection.end,
          quote,
          prefix,
          suffix,
          text,
          color,
          style,
        });
        await this.refreshAnnotationHighlights();
      },
    }).open();
  }

  /** Annotation visuelle IMMÉDIATE (sous-menu Annotation du menu contextuel
   *  de l'éditeur) : enregistre l'annotation sur la sélection avec la
   *  préférence de session, sans popover obligatoire ; si une annotation
   *  existante recouvre EXACTEMENT la sélection, elle est MODIFIÉE (jamais
   *  de doublon de stockage). Retourne false (avec notice) sans sélection,
   *  hors manuscrit, ou sur écriture impossible — jamais d'exception. */
  async applyAnnotationOrUpdate(
    editor: Editor,
    file: TFile,
    style: AnnotationStyle,
    color: AnnotationColor
  ): Promise<boolean> {
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    const selection = this.currentSelectionRange(editor);
    if (relPath === null || !selection || selection.start === selection.end) {
      new Notice(t("annotation.notice.noSelection"));
      return false;
    }
    const content = editor.getValue();
    const CONTEXT_LENGTH = ANNOTATION_CONTEXT_LENGTH;
    const quote = content.slice(selection.start, selection.end);
    const prefix = content.slice(Math.max(0, selection.start - CONTEXT_LENGTH), selection.start);
    const suffix = content.slice(selection.end, Math.min(content.length, selection.end + CONTEXT_LENGTH));
    try {
      const store = await loadAnnotations(this.app, this.settings);
      const existing = store.annotations.find((annotation) => {
        if (annotation.file !== relPath) return false;
        const range = resolveAnnotation(annotation, content);
        return range ? range.start === selection.start && range.end === selection.end : false;
      });
      if (existing) {
        await updateAnnotation(this.app, this.settings, existing.id, { color, style });
      } else {
        await addAnnotation(this.app, this.settings, {
          file: relPath,
          start: selection.start,
          end: selection.end,
          quote,
          prefix,
          suffix,
          text: "",
          color,
          style,
        });
      }
    } catch {
      new Notice(t("annotation.notice.corrupted"));
      return false;
    }
    await this.refreshAnnotationHighlights();
    return true;
  }

  /** « Ajouter / modifier un commentaire… » (sous-menu Annotation du menu
   *  contextuel de l'éditeur) : sélection →
   *  nouveau commentaire (popover, style/couleur initiaux) ; sinon une
   *  annotation existante dont l'ancre recouvre le curseur → modification
   *  (openAnnotationEditor) ; sinon rien à commenter. */
  async openAnnotationCommentForContext(
    editor: Editor,
    file: TFile,
    style: AnnotationStyle,
    color: AnnotationColor
  ): Promise<void> {
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    if (relPath === null) {
      new Notice(t("annotation.notice.noSelection"));
      return;
    }
    const selection = this.currentSelectionRange(editor);
    if (selection && selection.start !== selection.end) {
      await this.createAnnotationFromSelection(editor, file, { style, color });
      return;
    }
    try {
      const store = await loadAnnotations(this.app, this.settings);
      const content = editor.getValue();
      const offset = editor.posToOffset(editor.getCursor());
      const candidate = store.annotations.find((annotation) => {
        if (annotation.file !== relPath) return false;
        const range = resolveAnnotation(annotation, content);
        return range ? offset >= range.start && offset <= range.end : false;
      });
      if (!candidate) {
        new Notice(t("annotation.notice.noSelection"));
        return;
      }
      await this.openAnnotationEditor(candidate.id);
    } catch {
      new Notice(t("annotation.notice.corrupted"));
    }
  }

  /** Ouvre le popover en modification pour l'annotation `id`, près de
   * `anchor` — appelé par le double-clic sur une décoration
   * (annotationDoubleClickExtension, qui transmet l'élément décoré comme
   * ancre) et, depuis le lot 4, par l'action « Modifier » de la page
   * centralisée Annotations (NotesView.renderAnnotationRow, sans ancre :
   * repli sur DEFAULT_ANNOTATION_ANCHOR). `onChange` est un point
   * d'extension MINIMAL pour ce second appelant : NotesView n'a besoin de
   * rien de plus que d'être prévenue une fois la sauvegarde/suppression
   * effectuée, pour rerendre sa propre liste — le popover, la persistance
   * (update/deleteAnnotation) et le rafraîchissement CodeMirror restent
   * ICI, jamais dupliqués ailleurs. */
  async openAnnotationEditor(
    id: string,
    onChange?: () => void,
    anchor?: AnchorRect | AnnotationDecorationTarget
  ): Promise<void> {
    let store: AnnotationsStore;
    try {
      store = await loadAnnotations(this.app, this.settings);
    } catch {
      new Notice(t("annotation.notice.corrupted"));
      return;
    }
    const annotation = store.annotations.find((a) => a.id === id);
    if (!annotation) return;

    let resolvedAnchor = anchor;
    if (!resolvedAnchor) {
      const root = this.getProjectFolder();
      const targetFile = root ? this.app.vault.getAbstractFileByPath(`${root.path}/${annotation.file}`) : null;
      if (targetFile instanceof TFile && this.app.workspace.getLeaf) {
        const content = await (this.app.vault.cachedRead?.(targetFile) ?? this.app.vault.read(targetFile));
        const range = resolveAnnotation(annotation, content);
        if (range) {
          await openFileAndSelectRange(this.app, this.app.workspace.getLeaf(false), targetFile, range.start, range.end);
          await this.refreshAnnotationHighlights();
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-annotation-id="${CSS.escape(id)}"]`));
          resolvedAnchor = candidates.find((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }) ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.contentEl.querySelector<HTMLElement>(".cm-editor") ?? undefined;
        }
      }
    }
    new AnnotationPopover({
      parentEl: document.body,
      anchor: resolvedAnchor ?? FeuilletsPlugin.DEFAULT_ANNOTATION_ANCHOR,
      text: annotation.text,
      color: annotation.color,
      style: annotation.style ?? "highlight",
      onStyleChange: async (style) => {
        await updateAnnotation(this.app, this.settings, id, { style, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshAnnotationHighlights();
      },
      onColorChange: async (color) => {
        await updateAnnotation(this.app, this.settings, id, { color, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshAnnotationHighlights();
      },
      onSave: async (text, color, style) => {
        await updateAnnotation(this.app, this.settings, id, { text, color, style, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshAnnotationHighlights();
        onChange?.();
      },
      onDelete: async () => {
        await deleteAnnotation(this.app, this.settings, id);
        await this.refreshAnnotationHighlights();
        onChange?.();
      },
    }).open();
  }

  async openWorkNoteEditor(file: TFile, id: string | null, initialText: string, onChange: () => void, legacy = false, sidebarAnchor?: HTMLElement): Promise<void> {
    const anchor = sidebarAnchor ?? FeuilletsPlugin.DEFAULT_ANNOTATION_ANCHOR;
    new AnnotationPopover({ parentEl: document.body, anchor, text: initialText, color: "yellow", showColors: false, showStyles: false,
      onSave: async (text) => {
        if (legacy) await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => { frontmatter.notes = text; });
        else if (id) await updateWorkNote(this.app, this.settings, id, text);
        else { const relative = toManuscriptRelativePath(this.app, this.settings, file); if (relative !== null) await addWorkNote(this.app, this.settings, relative, text); }
        onChange();
      },
      onDelete: legacy ? undefined : async () => { if (id) await deleteWorkNote(this.app, this.settings, id); onChange(); },
    }).open();
  }

  /** Recharge les annotations du fichier actif, les résout avec
   * resolveAnnotation() et transmet uniquement les annotations résolues au
   * highlighter — nettoie si le fichier n'a aucune annotation ou n'est pas
   * dans le Manuscrit. Appelé au changement de fichier/feuillet actif
   * seulement (voir registerAnnotationHighlightSync) : jamais à chaque
   * frappe, CodeMirror mappe déjà les décorations existantes via
   * tr.changes. */
  async refreshAnnotationHighlights(): Promise<void> {
    const editor = this.activeEditorAnywhere();
    const cm = this.annotationCmView(editor);
    if (!cm) return;

    const file = this.app.workspace.getActiveFile();
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    if (relPath === null) {
      clearAnnotationHighlights(cm);
      return;
    }

    let store: AnnotationsStore;
    try {
      store = await loadAnnotations(this.app, this.settings);
    } catch {
      clearAnnotationHighlights(cm);
      return;
    }

    const list = annotationsForFile(store, relPath);
    if (list.length === 0) {
      clearAnnotationHighlights(cm);
      return;
    }

    const content = editor ? editor.getValue() : "";
    const inputs: AnnotationHighlightInput[] = list.map((a) => ({
      id: a.id,
      color: a.color,
      style: a.style ?? "highlight",
      range: resolveAnnotation(a, content),
    }));
    applyAnnotationHighlights(cm, inputs);
  }

  /** Événements Workspace déjà utilisés ailleurs dans main.ts pour ce genre
   * de resynchronisation (voir registerStatusBar, registerLiveTypography) —
   * pas d'écoute "editor-change" ici : ce serait un scan à chaque frappe,
   * inutile puisque CodeMirror mappe déjà les décorations existantes. La
   * gestion de plusieurs panneaux ouverts simultanément reste au lot 5. */
  registerAnnotationHighlightSync(): void {
    const refresh = () => void this.refreshAnnotationHighlights();
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
  }

  /** Titre d'onglet propre pour la colonne comparée d'une Comparison — jamais
   * un renommage du fichier réel, seulement l'en-tête affiché (même
   * mécanisme que `nativeReviewWorkingTitles`, voir `patchTabTitles`).
   * `title: null` efface l'entrée : appelé à la fermeture de la comparaison. */
  setComparisonDisplayTitle(path: string, title: string | null): void {
    if (title) comparisonDisplayTitles.set(path, title); else comparisonDisplayTitles.delete(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) this.refreshTabHeaderFor(file);
  }

  /** Synchronise les propositions reçues dans chaque working ouvert. Les widgets
   * CodeMirror ne sont jamais écrits dans le Markdown et le reviewer ne voit
   * pas ses propres modifications comme un faux diff. */
  async refreshNativeReviewDecorations(): Promise<void> {
    let sessions: Awaited<ReturnType<typeof listNativeReviewSessions>>;
    try { sessions = await listNativeReviewSessions(this.app, this.settings); } catch { return; }
    nativeReviewWorkingTitles.clear(); for (const entry of sessions) for (const document of entry.session?.documents ?? []) if (document.localSourcePath) nativeReviewWorkingTitles.set(document.localSourcePath, document.title);
    this.refreshAllTabHeaders();
    const context = this.nativeReviewEditorContext;
    const entry = context ? sessions.find((item) => item.session?.reviewId === context.reviewId && item.location.sessionsRootPath === context.location.sessionsRootPath) : null;
    const session = entry?.session;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      const path = view.file?.path;
      const cm = this.annotationCmView(view.editor);
      if (!path || !cm) continue;
      const reviewDocument = session?.documents.find((document) => document.localSourcePath === path);
      if (!session || !reviewDocument || session.status === "completed") { clearNativeReviewThreadHighlights(cm); continue; }
      try { const threads = (await loadNativeReviewThreads(this.app, session.reviewId, entry.location)).threads.filter((thread) => thread.documentId === reviewDocument.documentId && thread.status === "open"); applyNativeReviewThreadHighlights(cm, threads.map((thread) => ({ ...thread, reviewId: session.reviewId })), view.editor.getValue()); } catch { clearNativeReviewThreadHighlights(cm); }
    }
  }

  registerNativeReviewHighlightSync(): void {
    const refresh = () => { this.closeNativeReviewThreadPopover(); void this.refreshNativeReviewDecorations(); };
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.vault.on("modify", refresh));
  }

  registerNativeReviewContextMenu(): void {
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file || !editor.somethingSelected()) return;
      void listNativeReviewSessions(this.app, this.settings).then((sessions) => {
        const session = sessions.map((item) => item.session).find((candidate) => candidate?.localRole === "reviewer" && candidate.status === "active" && !currentReviewRound(candidate).sent && currentReviewRound(candidate).received && candidate.documents.some((document) => document.localSourcePath === view.file?.path));
        if (!session) return;
        menu.addItem((item) => item.setTitle(t("nativeReview.editorMenu.comment")).setIcon("highlighter").onClick(() => void this.createNativeReviewThread(session.reviewId, view, editor)));
      }).catch(() => undefined);
    }));
  }

  async createNativeReviewThread(reviewId: string, view: MarkdownView, editor: Editor): Promise<void> {
    const sessions = await listNativeReviewSessions(this.app, this.settings); const entry = sessions.find((item) => item.session?.reviewId === reviewId); const session = entry?.session;
    const documentInfo = session?.documents.find((document) => document.localSourcePath === view.file?.path); if (!session || !documentInfo) return;
    const start = editor.posToOffset(editor.getCursor("from")); const end = editor.posToOffset(editor.getCursor("to")); if (start === end) return;
    const anchor = this.annotationCmView(editor) && coordsAtOffset(this.annotationCmView(editor), end) || FeuilletsPlugin.DEFAULT_ANNOTATION_ANCHOR;
    new AnnotationPopover({ parentEl: document.body, anchor, text: "", color: "yellow", onSave: async (text, color, style) => { await addNativeReviewThread(this.app, reviewId, documentInfo.documentId, start, end, text, { color, style }, entry?.location); await this.refreshNativeReviewDecorations(); } }).open();
  }

  setNativeReviewEditorContext(context: { reviewId: string; location: NativeReviewStorageLocation; documentId?: string } | null): void {
    this.closeNativeReviewThreadPopover(); this.nativeReviewEditorContext = context; void this.refreshNativeReviewDecorations();
  }
  clearNativeReviewEditorContext(): void { this.setNativeReviewEditorContext(null); }
  closeNativeReviewThreadPopover(): void { this.activeNativeReviewThreadPopover?.close(); this.activeNativeReviewThreadPopover = null; document.querySelectorAll(".cm-native-review-thread-active").forEach((element) => element.removeClass("cm-native-review-thread-active")); }

  async openNativeReviewThread(threadId: string, target: { getBoundingClientRect?(): AnchorRect; getAttribute(name: string): string | null }): Promise<void> {
    const context = this.nativeReviewEditorContext; if (!context) return;
    const sessions = await listNativeReviewSessions(this.app, this.settings);
    for (const entry of sessions) { const session = entry.session; if (!session || session.reviewId !== context.reviewId || entry.location.sessionsRootPath !== context.location.sessionsRootPath) continue; const threads = await loadNativeReviewThreads(this.app, session.reviewId, entry.location); const thread = threads.threads.find((candidate) => candidate.threadId === threadId); if (!thread) continue; const names = new Map(session.participants.map((person) => [person.id, person.name])); this.closeNativeReviewThreadPopover(); document.querySelectorAll(`[data-native-review-thread-id="${CSS.escape(threadId)}"]`).forEach((element) => element.addClass("cm-native-review-thread-active")); const popover = new NativeReviewThreadPopover({ parentEl: document.body, anchor: target, thread, names, readOnly: session.localRole !== "author" || session.status !== "active", onHandled: async () => { await setNativeReviewThreadResolved(this.app, session.reviewId, threadId, true, entry.location); this.closeNativeReviewThreadPopover(); await this.refreshNativeReviewDecorations(); } }); this.activeNativeReviewThreadPopover = popover; popover.open(); return; }
  }

  async maybeAutoInitializeResearchFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md" || file.stat.size > 0) return;
    const researchRoot = this.getResearchRoot();
    if (!researchRoot) return;
    if (!file.path.startsWith(researchRoot.path + "/")) return;
    const mode = this.projectMode();
    const rf = mode.researchFolders;
    const parentName = file.parent ? file.parent.name : "";
    let sectionKey = "";
    if (matchesResearchLabel(rf, "sources", parentName)) sectionKey = "sources";
    else if (matchesResearchLabel(rf, "bibliographie", parentName)) sectionKey = "bibliographie";
    else if (matchesResearchLabel(rf, "personnages", parentName)) sectionKey = "personnages";
    else if (matchesResearchLabel(rf, "lieux", parentName)) sectionKey = "lieux";
    else if (matchesResearchLabel(rf, "codex", parentName)) sectionKey = "codex";
    else if (matchesResearchLabel(rf, "glossaire", parentName)) sectionKey = "glossaire";
    else if (parentName === "Chronology" || parentName === "Chronologie") sectionKey = "evenements";
    if (!sectionKey) return;
    const template = await getResearchTemplate(this.app, this.settings, mode, sectionKey, file.basename);
    if (template) {
      try {
        await this.app.vault.modify(file, template);
      } catch (err) {
        console.error("Feuillets: Failed to auto-initialize file:", err);
      }
    }
  }

  onunload() {
    // Une comparaison ouverte tient des décorations et un verrou de lecture
    // seule sur deux vrais éditeurs : ils doivent redevenir ordinaires même
    // si le plugin part sans passer par la fermeture normale.
    void closeFeuilletsComparison();
    comparisonDisplayTitles.clear();
    window.clearTimeout(this._refreshTimer);
    window.clearTimeout(this._statusTimer);
    window.clearTimeout(this._concTimer);
    document.body.removeClass("feuillets-indent");
    document.body.removeClass("feuillets-concentration");
    this.removeConcentrationCounter();
    if (this._escHandler) document.removeEventListener("keydown", this._escHandler);
    document.body.removeClass("feuillets-lignesvides-invisible");
    document.body.removeClass("feuillets-lignesvides-reduit");
    document.body.removeClass("feuillets-cesure");
    if (this._originalGetDisplayText) {
      /* Ne restaurer QUE si le prototype porte encore notre patch. Un autre
         plugin ayant patché après nous a enveloppé le nôtre : écraser avec
         notre « original » supprimerait le sien au passage. Dans ce cas on
         laisse la chaîne en place — notre patch reste appelé mais retombe
         toujours sur l'original, donc inoffensif. */
      if (MarkdownView.prototype.getDisplayText === this._patchedGetDisplayText) {
        MarkdownView.prototype.getDisplayText = this._originalGetDisplayText;
        this._originalGetDisplayText = null;
        this._patchedGetDisplayText = null;
      }
      /* Si on n'a PAS pu se retirer, on garde `_originalGetDisplayText` :
         notre patch est encore appelable via la chaîne du plugin qui nous
         enveloppe, et il s'en sert comme repli. */
    }
    this.refreshAllTabHeaders();
  }

  patchTabTitles() {
    /* Alias de `this` indispensable ici : le patch ci-dessous est une
       `function` classique posée sur MarkdownView.prototype, dont le `this`
       est la vue, pas le plugin. Une flèche capturerait le bon `plugin` mais
       perdrait l'accès à `this.file` de la vue — donc alias, pas flèche. */
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- le patch est une `function` posee sur le prototype : son `this` est la vue, pas le plugin
    const plugin = this;
    /* Garde contre un double appel : sans elle, le second capturerait NOTRE
       patch comme « original », et l'appel de repli en fin de fonction
       bouclerait indéfiniment. */
    if (this._originalGetDisplayText) return;
    /* Référence à une méthode non liée, volontaire : on mémorise
       l'implémentation d'origine pour la restaurer dans onunload et pour
       l'appeler en repli — elle sera toujours invoquée via .call(this).
       getDisplayText() utilise réellement `this` (this.file côté vue) : lui
       annoter `this: void` mentirait sur son comportement. Ni flèche (on
       n'écrit pas cette fonction, on récupère celle du prototype) ni bind()
       (il n'y a pas encore d'instance de vue précise à laquelle s'attacher
       ici) ne s'appliquent sans changer le comportement. */
    // eslint-disable-next-line @typescript-eslint/unbound-method -- volontaire, voir commentaire ci-dessus : appelée uniquement via .call(this)
    this._originalGetDisplayText = MarkdownView.prototype.getDisplayText;
    this._patchedGetDisplayText = function (this: MarkdownView): string {
      try {
        if (this.file) {
          const comparisonTitle = comparisonDisplayTitles.get(this.file.path);
          if (comparisonTitle) return comparisonTitle;
          const reviewTitle = nativeReviewWorkingTitles.get(this.file.path);
          if (reviewTitle) return reviewTitle;
          const fm = plugin.fmOf(this.file);
          const raw = fm && fm.short_title;
          const short = raw ? String(raw).trim() : "";
          if (short) {
            const versionLabel = plugin.versionLabelForFile(this.file);
            return versionLabel ? `${versionLabel}-${short}` : short;
          }
        }
      } catch {
        /* Silence délibéré, contrairement aux catches métier : on est sur le
           rendu d'en-tête d'onglet, appelé à chaque affichage. Y logger
           inonderait la console, et le repli ci-dessous est déjà le
           comportement correct (titre Obsidian par défaut). */
      }
      // eslint-disable-next-line @typescript-eslint/unbound-method -- même repli volontaire que ci-dessus : getDisplayText() utilise `this`, appelée uniquement via .call(this) plus bas
      const fallback: (this: MarkdownView) => string = plugin._originalGetDisplayText ?? MarkdownView.prototype.getDisplayText;
      const displayText: unknown = fallback.call(this);
      return typeof displayText === "string" ? displayText : "";
    };
    MarkdownView.prototype.getDisplayText = this._patchedGetDisplayText;
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.refreshTabHeaderFor(file)));
    this.app.workspace.onLayoutReady(() => this.refreshAllTabHeaders());
  }

  refreshTabHeaderFor(file: TFile): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      const leafWithHeader = leaf as LeafWithHeaderUpdate;
      if (view?.file?.path === file.path && typeof leafWithHeader.updateHeader === "function") {
        try { leafWithHeader.updateHeader(); } catch { /* leaf.updateHeader() est une API interne non documentee : si elle disparait, l'onglet garde son titre par defaut */ }
      }
    }
  }

  refreshAllTabHeaders(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const leafWithHeader = leaf as LeafWithHeaderUpdate;
      if (typeof leafWithHeader.updateHeader === "function") {
        try { leafWithHeader.updateHeader(); } catch { /* idem : rafraichir l'en-tete d'onglet est cosmetique, jamais bloquant */ }
      }
    }
  }

  updateParagraphFocus(editor: Editor): void {
    if (!this.concentrationActive || this.settings.concentrationUnit === "line") return;
    const cm = (editor as EditorWithCM).cm;
    if (!cm || !cm.dom || typeof cm.domAtPos !== "function") return;
    const cur = editor.getCursor().line;
    let start = cur;
    let end = cur;
    while (start > 0 && editor.getLine(start - 1).trim() !== "") start--;
    const last = editor.lastLine();
    while (end < last && editor.getLine(end + 1).trim() !== "") end++;
    if (this._paraEls) {
      for (const el of this._paraEls) el.classList.remove("feuillets-para-active");
    }
    this._paraEls = [];
    for (let ln = start; ln <= end; ln++) {
      try {
        const offset = editor.posToOffset({ line: ln, ch: 0 });
        const result = cm.domAtPos(offset);
        if (!result) continue;
        let node: Node | null = result.node;
        while (node && node.nodeType === 3) node = node.parentNode;
        const lineEl = node instanceof Element ? node.closest(".cm-line") : null;
        if (lineEl instanceof HTMLElement) {
          lineEl.classList.add("feuillets-para-active");
          this._paraEls.push(lineEl);
        }
      } catch { /* on parcourt le DOM interne de CodeMirror : un changement de structure ne doit pas casser le mode concentration */ }
    }
  }

  async updateConcentrationCounter(editor: Editor | undefined): Promise<void> {
    if (!this.concentrationActive || !this.settings.concentrationCounter) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    if (!this._concCounterEl) {
      this._concCounterEl = document.body.createDiv({ cls: "feuillets-conc-counter" });
    }
    const text = editor ? editor.getValue() : await this.app.vault.cachedRead(file);
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const wc = countWords(body);
    const fm = this.fmOf(file);
    const g = parseInt(String(fm.goal), 10);
    const goal = isNaN(g) ? projectWordGoalDefault(this.app, this.settings) : g;
    this._concCounterEl.setText(goal > 0 ? `${wc} / ${goal}` : String(wc));
    const tol = projectTolerance(this.app, this.settings);
    this._concCounterEl.removeClass("feuillets-status-hit");
    this._concCounterEl.removeClass("feuillets-status-over");
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol) this._concCounterEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol) this._concCounterEl.addClass("feuillets-status-over");
    }
  }

  removeConcentrationCounter() {
    if (this._concCounterEl) {
      this._concCounterEl.remove();
      this._concCounterEl = null;
    }
  }

  toggleConcentration() {
    try {
      this.concentrationActive = !this.concentrationActive;
      if (this.concentrationActive) {
        try {
          this._savedLeft = this.app.workspace.leftSplit.collapsed;
          this._savedRight = this.app.workspace.rightSplit.collapsed;
          this.app.workspace.leftSplit.collapse();
          this.app.workspace.rightSplit.collapse();
        } catch { /* leftSplit/rightSplit absents sur mobile : la concentration s'active quand meme, sans replier de panneau */ }
        const S = this.settings;
        document.body.style.setProperty("--feuillets-dim-opacity", `${(S.dimOpacity || 35) / 100}`);
        document.body.style.setProperty("--feuillets-concentration-width", `${S.concentrationWidth || 720}px`);
        document.body.toggleClass("feuillets-focus-paragraph", S.concentrationUnit === "paragraph");
        document.body.toggleClass("feuillets-focus-line", S.concentrationUnit !== "paragraph");
        document.body.addClass("feuillets-concentration");
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) this.updateParagraphFocus(editor);
        if (!this._escHandler) {
          this._escHandler = (e) => {
            if (e.key === "Escape" && this.concentrationActive) this.toggleConcentration();
          };
          document.addEventListener("keydown", this._escHandler);
        }
        const ed = this.app.workspace.activeEditor?.editor;
        void this.updateConcentrationCounter(ed);
        new Notice(t("main.notice.concentrationModeOn"));
      } else {
        document.body.removeClass("feuillets-concentration");
        this.removeConcentrationCounter();
        window.clearTimeout(this._concTimer);
        if (this._paraEls) {
          for (const el of this._paraEls) el.classList.remove("feuillets-para-active");
          this._paraEls = null;
        }
        try {
          if (!this._savedLeft) this.app.workspace.leftSplit.expand();
          if (!this._savedRight) this.app.workspace.rightSplit.expand();
        } catch { /* idem au retour : si les panneaux n'existent pas, il n'y a rien a redeployer */ }
      }
    } catch (e) {
      console.error("Feuillets : mode concentration", e);
      new Notice(t("main.notice.concentrationModeError"));
    }
  }

  /** Résout Continu comme contexte de travail CENTRAL — la dernière leaf du
   * `rootSplit`, jamais la "vue globalement active" — micro-correctif
   * "typographie après toggle + Maj+clic en Continu". Même patron que
   * `FeuilletsView.activeContinuMembershipView` (feuillets-view.ts) : un
   * clic dans le Binder (sidebar) donne le focus global à la sidebar sans
   * faire perdre Continu comme leaf de travail affichée au centre —
   * `getActiveViewOfType(ScriveningsView)` y retournait donc `null` à tort.
   * Résolution UNIQUE, réutilisée par `isActiveFileInProject()` et
   * `updateStatusBar()` — jamais une seconde logique de résolution.
   * Jamais `getActiveFile()`, jamais `getActiveViewOfType`, jamais le
   * premier résultat de `getLeavesOfType`, jamais un Continu ouvert dans un
   * AUTRE onglet central ou sur un AUTRE projet. */
  getCentralContinuView(): ScriveningsView | null {
    const root = this.getProjectFolder();
    if (!root) return null;
    const workspace = this.app.workspace;
    // Défensif : de nombreux faux `workspace` de tests ne déclarent pas
    // `getMostRecentLeaf` — jamais absent en Obsidian réel.
    if (typeof workspace.getMostRecentLeaf !== "function") return null;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf) return null;
    if (typeof leaf.getRoot === "function" && leaf.getRoot() !== workspace.rootSplit) return null;
    const view = leaf.view;
    if (!(view instanceof ScriveningsView)) return null;
    if (!view.compileScope) return null;
    if (view.compileScope.projectRoot !== root.path) return null;
    return view;
  }

  /**
   * Vide les écritures en attente de TOUTES les vues Continu réellement
   * ouvertes sur `projectRoot` (le scope AFFICHÉ — jamais le scope d'un autre
   * projet, jamais une vue fermée), AVANT l'export. Appelle le
   * `flushPendingWrites()` de chaque vue concernée — qui lui-même appelle le
   * `flush()` EXISTANT de sa session : aucune seconde logique de sauvegarde.
   * Retourne `true` si aucun Continu n'est ouvert sur ce projet ou si tous
   * ont fini sans fichier dirty, `false` dès qu'une vue a échoué à vider son
   * lot (conflit externe ou erreur `Vault.process()` — l'export est alors
   * ABANDONNÉ : des textes locaux non écrits ne doivent jamais être
   * compilés). Ne ferme JAMAIS une vue, ne change JAMAIS de scope ni de
   * projet — un simple vidage. Point d'entrée du hook optionnel
   * `ExportWorkflowPlugin.flushContinuWritesForProject` (export-workflow.ts).
   */
  async flushContinuWritesForProject(projectRoot: string): Promise<boolean> {
    const workspace = this.app.workspace;
    // Défensif : les faux `workspace` de tests ne déclarent pas toujours
    // `getLeavesOfType` — jamais absent en Obsidian réel.
    if (typeof workspace.getLeavesOfType !== "function") return true;
    const leaves = workspace.getLeavesOfType(VIEW_SCRIVENINGS);
    if (leaves.length === 0) return true;
    let allClean = true;
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof ScriveningsView)) continue;
      if (view.compileScope?.projectRoot !== projectRoot) continue;
      if (!(await view.flushPendingWrites())) allClean = false;
    }
    return allClean;
  }

  /** LOT 3 — pont Continu → Preview : transmet un CompileScope déjà résolu
   * par Continu au SEUL Preview déjà ouvert sur ce même projet — jamais de
   * création, activation, révélation ni déplacement de leaf Preview.
   * Continu ne doit JAMAIS ouvrir automatiquement Preview : sans Preview du
   * même projet déjà ouvert, cette méthode ne fait rigoureusement rien.
   * Au maximum le PREMIER Preview pertinent (même `projectRoot`) est
   * touché ; tous les autres restent strictement inchangés. */
  async syncExistingPreviewScope(
    scope: CompileScope,
    anchor?: ScriveningsScrollAnchor | null
  ): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_PREVIEW);
    if (leaves.length === 0) return;

    let target: WorkspaceLeaf | null = null;
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof PreviewView && view.compileScope?.projectRoot === scope.projectRoot) {
        target = leaf;
        break;
      }
    }
    if (!target) return;

    if (target.isDeferred) await target.loadIfDeferred();
    const view = target.view;
    if (!(view instanceof PreviewView)) return;
    await view.followCompileScope(scope, anchor);
  }

  /** LOT 3 — pont Continu → Preview : signale à un Preview déjà CHARGÉ du
   * même projet qu'une frappe ACCEPTÉE dans Continu a touché ces chemins —
   * jamais pendant qu'une leaf Preview est encore différée (`loadIfDeferred`
   * n'est JAMAIS appelé ici : forcer le chargement d'une vue pendant la
   * frappe serait le genre de coût que ce pont doit précisément éviter).
   * Résolution du Continu via `getCentralContinuView()`, l'UNIQUE définition
   * du Continu de travail — jamais `getActiveViewOfType`. */
  notifyContinuDocumentChanged(paths: readonly string[]): void {
    const continu = this.getCentralContinuView();
    if (!continu || !continu.compileScope) return;

    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_PREVIEW)) {
      if (leaf.isDeferred) continue;
      const view = leaf.view;
      if (view instanceof PreviewView && view.compileScope?.projectRoot === continu.compileScope.projectRoot) {
        view.onContinuDocumentChanged(paths);
        return;
      }
    }
  }

  isActiveFileInProject() {
    const file = this.app.workspace.getActiveFile();
    // Un working/*.md de relecture reçoit la même grammaire d'édition qu'un
    // feuillet normal le temps que sa session existe — sans dépendre d'un
    // projet actif : un relecteur pur peut n'en avoir aucun. Reconnaissance
    // dynamique via la session déjà écrite par Feuillets, jamais via le
    // fichier lui-même (voir isActiveReviewWorkingFile).
    if (this.isActiveReviewWorkingFile(file)) return true;

    const root = this.getProjectFolder();
    if (!root) return false;

    // Les vues Feuillets (dont la vue Scrivenings) n'affichent jamais que du
    // contenu projet, mais ne deviennent pas le "fichier actif" au sens
    // d'Obsidian : sans ce cas particulier, applyLiveTypoClasses() se base sur
    // le dernier vrai fichier actif (potentiellement hors projet ou nul) et
    // désactive à tort les réglages de lecture (lignes vides, justification...).
    if (this.app.workspace.getActiveViewOfType(BoardView)) return true;

    // Idem pour Scrivenings : sa vue n'affiche que du contenu projet (voir
    // resolveCompileScopeFiles), mais n'est jamais non plus le "fichier
    // actif" au sens Obsidian. Reconnue dès que sa leaf de travail CENTRALE
    // porte un scope déjà chargé (openScope() passé) — jamais via le dernier
    // vrai fichier Markdown actif (potentiellement hors projet ou nul), et
    // jamais via `getActiveViewOfType` : un clic dans le Binder ne doit pas
    // faire perdre ce contexte (voir getCentralContinuView ci-dessus).
    if (this.getCentralContinuView()) return true;

    // Les deux colonnes d'une Comparaison sont de vraies feuilles Markdown,
    // mais celle de droite est un document interne (retour du relecteur ou
    // snapshot) qui n'appartient pas au Manuscrit. Elle hérite donc du
    // contexte du feuillet de GAUCHE : sans cela, les deux textes ne se
    // composeraient pas pareil dès que le focus passe à droite — exactement
    // l'écart de composition que la comparaison doit rendre impossible.
    const comparison = activeComparisonContext();
    const target = comparison && file?.path === comparison.comparedPath ? this.app.vault.getAbstractFileByPath(comparison.sourcePath) : file;
    if (!(target instanceof TFile)) return false;
    if (root.path === "") return true;
    return target.path.startsWith(root.path + "/");
  }

  /** Un working/*.md n'est reconnu que si sa session de relecture existe
   * encore sur disque : dès qu'elle est supprimée, ce même fichier (s'il
   * survit ailleurs) redevient un Markdown ordinaire sans aucune trace
   * laissée dessus — la reconnaissance ne repose que sur ce test, jamais sur
   * un marqueur écrit dans le fichier. */
  isActiveReviewWorkingFile(file: TFile | null): boolean {
    if (!file) return false;
    const context = nativeReviewWorkingContext(file.path);
    if (!context) return false;
    const sessionFile = reviewSessionPaths(reviewerReviewStorageLocation(), context.reviewId).sessionFile;
    return this.app.vault.getAbstractFileByPath(sessionFile) instanceof TFile;
  }

  applyLiveTypoClasses(): void {
    const S = this.settings;
    const inProject = this.isActiveFileInProject();
    document.body.toggleClass("feuillets-lignesvides-invisible", inProject && S.liveEmptyLines === "invisible");
    document.body.toggleClass("feuillets-lignesvides-reduit", inProject && S.liveEmptyLines === "reduit");
    document.body.toggleClass("feuillets-cesure", inProject && S.liveHyphenation);
    document.body.toggleClass("feuillets-justify-live", inProject && !!S.liveJustify);
    document.body.toggleClass("feuillets-lecture-comme-live", inProject && S.readingMatchLive !== false);
    if (inProject && S.liveHyphenation && !document.body.getAttr("lang")) {
      document.body.setAttr("lang", "fr");
    }
    const rfs = inProject ? S.readingFontSize : 0;
    document.body.toggleClass("feuillets-reading-fs", rfs > 0);
    if (rfs > 0) {
      document.body.style.setProperty("--feuillets-reading-fs", `${rfs}px`);
    } else {
      document.body.style.removeProperty("--feuillets-reading-fs");
    }
    const lh = inProject ? S.lineHeight : 0;
    document.body.toggleClass("feuillets-line-height", lh > 0);
    if (lh > 0) {
      document.body.style.setProperty("--feuillets-line-height", `${lh}`);
    } else {
      document.body.style.removeProperty("--feuillets-line-height");
    }
    const tw = inProject ? S.textWidth : 0;
    document.body.toggleClass("feuillets-text-width", tw > 0);
    if (tw > 0) {
      document.body.style.setProperty("--feuillets-text-width", `${tw}px`);
    } else {
      document.body.style.removeProperty("--feuillets-text-width");
    }
  }

  applyIndentClass() {
    document.body.toggleClass("feuillets-indent", !!(this.isActiveFileInProject() && this.settings.indentParagraphs));
  }

  applyLeanInterfaceClasses() {
    document.body.toggleClass("feuillets-transparent-panels", !!this.settings.uiTransparentPanels);
    document.body.toggleClass("feuillets-transparent-tabbar", !!this.settings.uiTransparentTabBar);
    document.body.toggleClass("feuillets-dim-tab-actions", !!this.settings.uiDimTabActions);
  }

  currentStreak(): number {
    const stats = this.settings.stats || {};
    let streak = 0;
    const d = new Date();
    for (;;) {
      const p = (n) => String(n).padStart(2, "0");
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const st = stats[key];
      const delta = st ? Math.max(0, st.latest - st.start) : 0;
      if (delta <= 0) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  /** `focusEditor: false` (Binder, navigation clavier flèches) : charge le
   * feuillet suivant/précédent dans son volet SANS y déplacer le focus
   * clavier — sinon la 2e pression de flèche irait déplacer le curseur de
   * texte dans l'éditeur au lieu de continuer à naviguer dans le Binder. */
  async openNeighbor(
    delta: number,
    { focusEditor = true, fromFile }: { focusEditor?: boolean; fromFile?: TFile } = {}
  ): Promise<TFile | null> {
    const root = this.getProjectFolder();
    const current = fromFile ?? this.app.workspace.getActiveFile();
    if (!root || !current) return null;
    const files = this.flattenFiles(root);
    const idx = files.findIndex((f) => f.path === current.path);
    if (idx === -1) {
      new Notice(t("main.notice.activeFileNotInProject"));
      return null;
    }
    const next = files[idx + delta];
    if (!next) {
      new Notice(delta > 0 ? t("main.notice.lastSheet") : t("main.notice.firstSheet"));
      return null;
    }
    const leaf = this.getLeafForOpeningFile();
    if (focusEditor) {
      openFileActivating(this.app, leaf, next);
      void this.app.workspace.revealLeaf(leaf);
    } else {
      // Attendu ici (contrairement au cas focusEditor) : l'appelant clavier
      // du Binder (feuillets-view.js) a besoin du fichier réellement ouvert
      // pour resynchroniser le dossier sélectionné avant de rendre la main.
      await leaf.openFile(next, { active: true });
    }
    return next;
  }

  async updateStatusBar() {
    if (!this.statusEl) return;

    // Continu (§8, lot 2B.2) : jamais les statistiques du dernier TFile actif
    // — le total du GROUPE affiché par la vue, tant qu'un scope y est chargé.
    // Un MarkdownView normal actif retombe intégralement sur le comportement
    // ci-dessous, strictement inchangé. Résolution via la leaf CENTRALE de
    // travail (getCentralContinuView, même helper que
    // isActiveFileInProject) — jamais `getActiveViewOfType` : un clic dans
    // le Binder ne doit pas vider la status bar du groupe Continu affiché.
    const scrivenings = this.getCentralContinuView();
    if (scrivenings?.compileScope) {
      this.statusEl.setText(formatScriveningsStats(scrivenings.getGroupStats()));
      this.statusEl.removeClass("feuillets-status-hit");
      this.statusEl.removeClass("feuillets-status-over");
      return;
    }

    const file = this.app.workspace.getActiveFile();
    const root = this.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) {
      this.statusEl.setText("");
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const content =
      mdView && mdView.file === file && mdView.editor
        ? mdView.editor.getValue()
        : await this.app.vault.cachedRead(file);
    const wc = countWords(content);
    const chars = stripWritingNoise(content).length;
    const g = parseInt(String(this.fmOf(file).goal), 10);
    const goal = isNaN(g) ? projectWordGoalDefault(this.app, this.settings) : g;
    let txt = goal > 0 ? t("main.statusBar.wordsWithGoal", { wc: String(wc), goal: String(goal) }) : t("main.statusBar.words", { wc: String(wc) });
    txt += ` · ${t("main.statusBar.chars", { count: formatNumber(chars) })}`;
    const key = todayKey();
    const st = (this.settings.stats || {})[key];
    if (st) {
      const total = await this.wordCountOfFolder(root);
      const delta = total - st.start;
      txt += ` · ${t("main.statusBar.todayDelta", { sign: delta >= 0 ? "+" : "", delta: String(delta) })}`;
    }
    this.statusEl.setText(txt);
    this.statusEl.removeClass("feuillets-status-hit");
    this.statusEl.removeClass("feuillets-status-over");
    const tol = projectTolerance(this.app, this.settings);
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol) this.statusEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol) this.statusEl.addClass("feuillets-status-over");
    }
  }

  compactLineBreaks(text: string): string { return compactLineBreaks(text); }
  frenchTypography(text: string, skipFrontmatter: boolean): string { return frenchTypography(text, skipFrontmatter); }

  async loadSettings(): Promise<void> {
    /* loadData() est typé `Promise<any>` par l'API Obsidian : la donnée
       chargée est traitée comme `unknown` puis validée avant tout accès,
       jamais castée en bloc vers FeuilletsSettings. */
    const raw: unknown = await this.loadData();
    const data: Record<string, unknown> = isSettingsRecord(raw) ? raw : {};
    /* Correction grammaticale retirée en 1.4.5 : on purge ses clés avant la
       fusion, sinon Object.assign les reconduirait indéfiniment dans
       data.json. Aucune autre clé n'est touchée — voir
       services/legacy-grammar-cleanup.ts. */
    const legacyGrammarStripped = stripLegacyGrammarSettings(data);
    /* DEFAULT_SETTINGS (default-settings.ts) n'a pas wordGoal / povFilter /
       listPanePreviewField / listPanePreviewLines — écart préexistant avec
       FeuilletsSettings (types.d.ts) qui les déclare non optionnels, sans
       rapport avec cette correction (ces 4 champs n'y figurent pas et n'ont
       jamais eu de valeur par défaut, avant comme après TypeScript). C'est
       la seule raison du passage par `unknown` ci-dessous : TypeScript
       refuse un cast direct tant que ces 4 propriétés manquent. Le reste de
       la fusion (tout le corps de cette méthode) reste entièrement
       vérifié — ni `any`, ni cast sur `data`. */
    /* §12A du dernier lot UX avant 2.5 : "autoOpenDocxReview" migre vers
       l'onglet "relecture" — pas "project" — même correction que
       activateDocxReview() (voir plus bas) : la Révision DOCX vit désormais
       dans Relecture, "project" reproduirait la même confusion pour les
       utilisatrices migrant un ancien réglage. */
    const legacyAutoOpenPanels: Array<[string, "notes" | "research" | "journal" | "project" | "relecture"]> = [
      ["autoOpenNotes", "notes"],
      ["autoOpenResearch", "research"],
      ["autoOpenJournal", "journal"],
      ["autoOpenProject", "project"],
      ["autoOpenDocxReview", "relecture"],
      ["autoOpenProperties", "notes"],
    ];
    const hasOwn = (key: string): boolean => Object.getOwnPropertyDescriptor(data, key) !== undefined;
    const hasAutoOpenInspector = hasOwn("autoOpenInspector");
    const hasActiveRightPanelTab = hasOwn("activeRightPanelTab");
    const directLegacyPanels = legacyAutoOpenPanels
      .filter(([key]) => hasOwn(key))
      .map(([key, tab]) => [asBoolean(data[key]) === true, tab] as const);
    const historicalPanels: Array<[boolean, "notes" | "research" | "journal" | "project" | "relecture"]> = [];
    if (directLegacyPanels.length === 0) {
      if (hasOwn("autoOpenHub")) {
        const hubTab = asString(data.hubActiveTab) || "properties";
        historicalPanels.push([
          asBoolean(data.autoOpenHub) === true,
          hubTab === "research" ? "research" :
          hubTab === "progression" || hubTab === "journal" ? "journal" :
          hubTab === "project" || hubTab === "export" ? "project" : "notes",
        ]);
      }
      if (hasOwn("autoOpenProgression")) {
        historicalPanels.push([asBoolean(data.autoOpenProgression) === true, "journal"]);
      }
      if (hasOwn("autoOpenExport")) {
        historicalPanels.push([asBoolean(data.autoOpenExport) === true, "project"]);
      }
    }
    for (const [key] of legacyAutoOpenPanels) delete data[key];

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data) as unknown as FeuilletsSettings;
    if (!hasAutoOpenInspector) {
      const migratedPanels = directLegacyPanels.length > 0 ? directLegacyPanels : historicalPanels;
      if (migratedPanels.length > 0) {
        this.settings.autoOpenInspector = migratedPanels.some(([enabled]) => enabled);
        if (!hasActiveRightPanelTab) {
          const activePanel = migratedPanels.find(([enabled]) => enabled);
          if (activePanel) this.settings.activeRightPanelTab = activePanel[1];
        }
      }
    }
    /* Migration : les statuts personnalisés (simples chaînes, ajoutées à une
       liste de base figée) deviennent des entrées {name, color} au même
       titre que les 5 statuts par défaut — voir constants.js. */
    if (isUnknownArray(data.customStatuses) && data.customStatuses.length) {
      const existingNames = new Set(this.settings.statuses.map((s) => s.name));
      for (const name of data.customStatuses) {
        const clean = typeof name === "string" ? name.trim() : "";
        if (clean && !existingNames.has(clean)) {
          this.settings.statuses.push({ name: clean, color: "#888888" });
          existingNames.add(clean);
        }
      }
    }
    delete this.settings.customStatuses;
    /* Migration : colonnes du Plan renommées (resume->summary,
       compiler->compile, voir default-settings.js) — reprend la valeur
       true/false que l'utilisateur avait choisie sous l'ancien nom. */
    if (isSettingsRecord(data.outlineCols)) {
      const cols = data.outlineCols;
      const resume = asBoolean(cols.resume);
      if (resume !== undefined && cols.summary === undefined) {
        this.settings.outlineCols.summary = resume;
      }
      const compiler = asBoolean(cols.compiler);
      if (compiler !== undefined && cols.compile === undefined) {
        this.settings.outlineCols.compile = compiler;
      }
    }
    if (isSettingsRecord(data.outlineWidths)) {
      const widths = data.outlineWidths;
      const resume = asNumber(widths.resume);
      if (resume !== undefined && widths.summary === undefined) {
        this.settings.outlineWidths.summary = resume;
      }
      const compiler = asNumber(widths.compiler);
      if (compiler !== undefined && widths.compile === undefined) {
        this.settings.outlineWidths.compile = compiler;
      }
    }
    // Migration : valeur d'enum "resume" -> "summary" (cardContent,
    // listPanePreviewField — voir default-settings.js/utils/project-modes.js)
    if (this.settings.cardContent === "resume") this.settings.cardContent = "summary";
    if (this.settings.listPanePreviewField === "resume") this.settings.listPanePreviewField = "summary";
    if (legacyGrammarStripped) await this.saveSettings();
  }

  async saveSettings() {
    this.trimStats();
    await this.saveData(this.settings);
  }

  trimStats(): void {
    const stats = this.settings.stats;
    const keep = Number(this.settings.statsRetention);
    if (!stats || !keep || keep <= 0) return;
    const keys = Object.keys(stats);
    if (keys.length <= keep) return;
    keys.sort();
    for (const k of keys.slice(0, keys.length - keep)) delete stats[k];
  }

  refreshView(delay = 800) {
    window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      if (this._dragInProgress) {
        this._dragRetryCount = (this._dragRetryCount || 0) + 1;
        if (this._dragRetryCount < 10) {
          this.refreshView(delay);
          return;
        }
        this._dragInProgress = false;
      }
      this._dragRetryCount = 0;
      this.renderAllViews();
    }, delay);
  }

  leafVisible(leaf: WorkspaceLeaf): boolean {
    const el = leaf && leaf.view && leaf.view.containerEl;
    if (!el) return false;
    if (typeof el.isShown === "function") return el.isShown();
    return el.offsetParent !== null;
  }

  renderStaleViews(): void {
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const v = leaf.view as StaleableView;
        if (v && v._stale && typeof v.render === "function" && this.leafVisible(leaf)) {
          v._stale = false;
          void v.render();
        }
      }
    }
  }

  renderAllViews(force = false): void {
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW, VIEW_SIDEBAR_FEUILLETS]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const view = leaf.view as StaleableView;
        if (view) {
          if (!force && !this.leafVisible(leaf)) {
            view._stale = true;
            continue;
          }
          view._stale = false;
          if (typeof view.renderAllSubViews === "function") {
            void view.renderAllSubViews(force);
          } else if (typeof view.render === "function") {
            void view.render(force);
          }
        }
      }
    }
    this.adjustSidebarWidth();
  }

  /** Rafraîchit UNIQUEMENT le Binder (VIEW_SIDEBAR + VIEW_SIDEBAR_FEUILLETS)
   * — jamais VIEW_BOARD, donc jamais la surface centrale Édition
   * (Composition/Mise en page) qu'elle héberge parfois. Contrairement à
   * `refreshView()`/`renderAllViews()` (qui reconstruisent tout, y compris
   * la sous-page Composition active en cours d'édition), ce chemin ciblé
   * sert les réglages qui n'affectent QUE l'affichage du Binder — la
   * numérotation en premier lieu — sans jamais faire perdre le focus, le
   * défilement ni la sous-page ouverte dans Composition (dernier lot UX
   * avant 2.5, §9 : bug de perte de focus dans Composition → Structure). */
  refreshBinderViews(): void {
    for (const type of [VIEW_SIDEBAR, VIEW_SIDEBAR_FEUILLETS]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const view = leaf.view as StaleableView;
        if (!view) continue;
        if (!this.leafVisible(leaf)) { view._stale = true; continue; }
        view._stale = false;
        if (typeof view.renderAllSubViews === "function") void view.renderAllSubViews(false);
        else if (typeof view.render === "function") void view.render(false);
      }
    }
  }

  safeSetSize(split: SplitWithSetSize | null | undefined, width: number): void {
    if (!split || typeof split.setSize !== "function") return;
    try { split.setSize(width); } catch { /* setSize peut refuser une largeur : l'ajustement de la barre laterale est cosmetique */ }
  }

  /* vault.getConfig/setConfig : API interne non documentée (comme
     WorkspaceSplit.setSize ci-dessus) mais stable — c'est le même stockage
     que les réglages natifs "Éditeur"/"Apparence" d'Obsidian
     (app.json/appearance.json). Pas de valeur par défaut Feuillets pour ces
     clés : les réglages lisent la valeur réelle courante à chaque rendu, on
     ne fait qu'exposer un raccourci vers un réglage Obsidian existant,
     jamais une préférence stockée en double côté plugin. */
  getVaultConfig(key: string): unknown {
    const vault = this.app.vault as VaultWithConfig;
    try {
      return typeof vault.getConfig === "function" ? vault.getConfig(key) : undefined;
    } catch {
      return undefined;
    }
  }

  setVaultConfig(key: string, value: unknown): void {
    const vault = this.app.vault as VaultWithConfig;
    try {
      if (typeof vault.setConfig === "function") vault.setConfig(key, value);
      this.app.workspace.updateOptions();
    } catch { /* vault.setConfig et workspace.updateOptions sont des API internes d'Obsidian, absentes selon la version */ }
  }

  adjustSidebarWidth() {
    if (Platform.isMobile) return;
    const leftSplit = this.app.workspace.leftSplit;
    if (leftSplit && !leftSplit.collapsed) {
      const activeSidebarLeaf = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR)[0];
      if (activeSidebarLeaf) {
        const width = this.settings.binderLayout === "split" ? 380 : 250;
        this.safeSetSize(leftSplit, width);
      }
    }
    const rightSplit = this.app.workspace.rightSplit;
    if (rightSplit && !rightSplit.collapsed) {
      this.safeSetSize(rightSplit, RIGHT_SIDEBAR_WIDTH);
    }
  }

  getProjectFolder() { return getProjectFolder(this.app, this.settings); }
  projectMode() { return getProjectMode(this.app, this.settings); }

  /**
   * Change de projet actif — UNIQUE point de passage, utilisé par la commande
   * `switch-project`, par le gestionnaire de projets du Binder et par le
   * sélecteur de projet de l'en-tête Binder (jamais une logique dupliquée).
   * Valide le chemin (un dossier RÉEL du coffre — jamais un chemin orphelin),
   * ignore le no-op si c'est déjà le projet actif, préserve l'ancien projet
   * dans `settings.projects` (règle historique, voir l'ancienne commande),
   * puis enchaîne EXACTEMENT la même séquence que les chemins d'avant :
   * `settings.projectFolder = path`, `saveSettings()`, `renderAllViews(true)`,
   * `updateStatusBar()`. Retourne `false` si le chemin n'est pas un dossier
   * valide, `true` sinon (y compris pour un no-op). Ne ferme jamais une vue,
   * ne touche jamais à l'état d'édition.
   */
  async switchProject(path: string): Promise<boolean> {
    const S = this.settings;
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFolder)) return false;
    if (path === S.projectFolder) return true;
    if (S.projectFolder && !S.projects.includes(S.projectFolder)) S.projects.push(S.projectFolder);
    S.projectFolder = path;
    await this.saveSettings();
    this.renderAllViews(true);
    void this.updateStatusBar();
    return true;
  }

  citationStyleFor() {
    const root = this.getProjectFolder();
    const meta = root ? this.settings.projectMeta[root.path] : null;
    return (meta && meta.citationStyle) || "footnote";
  }

  registerLastEditorTracking() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          this._lastMarkdownLeaf = leaf;
        }
      })
    );
  }

  activeEditorAnywhere(): Editor | null {
    const activeEditor = this.app.workspace.activeEditor;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    const recentView = recentLeaf && recentLeaf.view instanceof MarkdownView ? recentLeaf.view : null;
    return (
      (activeEditor && activeEditor.editor) ||
      (activeView && activeView.editor) ||
      (recentView && recentView.editor) ||
      (this._lastMarkdownLeaf && this._lastMarkdownLeaf.view instanceof MarkdownView
        ? this._lastMarkdownLeaf.view.editor
        : null)
    ) ?? null;
  }

  /** Dossier(s) proposés par « Insérer une citation » — réservé à la
   * non-fiction (`rf.sources` défini). Réutilise `resolveBibliographySource`
   * (services/bibliography-generator.ts) : Sources canonique si présent,
   * sinon repli Bibliographie/Bibliography legacy, jamais les deux à la
   * fois — même règle que la bibliographie générée. */
  getCitationFolders(): TFolder[] {
    const mode = this.projectMode();
    if (!mode.researchFolders.sources) return [];
    const resolved = resolveBibliographySource(this.app, this.settings);
    return resolved ? [resolved.folder] : [];
  }

  openInsertCitation(editor?: Editor | null): void {
    const resolvedEditor = editor || this.activeEditorAnywhere();
    if (!resolvedEditor) {
      new Notice(t("main.notice.openSceneBeforeCitation"));
      return;
    }
    const folders = this.getCitationFolders();
    if (folders.length === 0) {
      new Notice(t("main.notice.nonfictionOnly"));
      return;
    }
    const files = folders.flatMap((f) => f.children.filter((c): c is TFile => c instanceof TFile && c.extension === "md"));
    if (files.length === 0) {
      new Notice(t("main.notice.noSourceOrBibliographySheet"));
      return;
    }
    new CitationSourceModal(this.app, this, files, (file, page) =>
      this.insertCitationFor(file, page, resolvedEditor)
    ).open();
  }

  quickCiteSource(sourceFile: TFile): void {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.openSceneBeforeCitation"));
      return;
    }
    promptForPage(this.app, this, sourceFile, (file, page) =>
      this.insertCitationFor(file, page, editor)
    );
  }

  renumberActiveFootnotes(): void {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.openSheetBeforeRenumbering"));
      return;
    }
    const src = editor.getValue();
    const out = renumberFootnotes(src);
    if (out === src) {
      new Notice(t("main.notice.nothingToRenumber"));
      return;
    }
    new ConfirmModal(
      this.app,
      t("main.cmd.renumberFootnotes"),
      t("main.notice.renumberFootnotesConfirm"),
      t("main.cmd.renumberFootnotes"),
      () => {
        const cursor = editor.getCursor();
        editor.setValue(out);
        editor.setCursor(cursor);
        new Notice(t("main.notice.footnotesRenumbered"));
      }
    ).open();
  }

  /** Insère un appel de note à la position du curseur (après la sélection
   * si une sélection existe — `getCursor("to")` renvoie déjà la borne de
   * fin) et ajoute sa définition en fin de fichier. Le curseur reste DANS
   * le texte courant, immédiatement après l'appel `[^n]` — l'éditeur ne
   * descend jamais vers la définition (« Aller à la note » est le chemin
   * explicite pour la rejoindre). Partagé par la commande, le menu
   * contextuel de l'éditeur et le sous-menu Note de bas de page. */
  insertFootnote(editor: Editor): void {
    const n = nextFootnoteNumber(editor.getValue());
    const marker = `[^${n}]`;
    const at = editor.getCursor("to");
    editor.replaceRange(marker, at, at);
    const afterCall = { line: at.line, ch: at.ch + marker.length };
    const lastLine = editor.lastLine();
    const end = { line: lastLine, ch: editor.getLine(lastLine).length };
    const defLine = `\n\n[^${n}]: `;
    editor.replaceRange(defLine, end, end);
    editor.setCursor(afterCall);
    editor.focus();
    new Notice(t("main.notice.footnoteInserted", { n: String(n) }));
  }

  /** Depuis un appel `[^id]` (curseur dessus ou à proximité), sélectionne sa
   * définition. Partagé par la commande et le menu contextuel. */
  gotoFootnoteDefinition(editor: Editor): void {
    const content = editor.getValue();
    const id = referenceIdAtOffset(content, editor.posToOffset(editor.getCursor()));
    if (!id) {
      new Notice(t("main.notice.noFootnoteRefHere"));
      return;
    }
    const def = findDefinition(content, id);
    if (!def) {
      new Notice(t("main.notice.footnoteDefMissing", { id }));
      return;
    }
    selectRange(editor, def.start, def.end);
  }

  /** Depuis une définition (curseur dans son texte), sélectionne son premier
   * appel dans le document. Partagé par la commande et le menu contextuel. */
  gotoFootnoteReference(editor: Editor): void {
    const content = editor.getValue();
    const id = definitionIdAtOffset(content, editor.posToOffset(editor.getCursor()));
    if (!id) {
      new Notice(t("main.notice.notInFootnoteDefinition"));
      return;
    }
    const refs = findReferences(content, id);
    if (refs.length === 0) {
      new Notice(t("main.notice.footnoteRefMissing", { id }));
      return;
    }
    selectRange(editor, refs[0].start, refs[0].end);
  }

  /** Renumérote les notes du fichier édité — même corps EXACT que la commande
   *  Cmd+P « Renuméroter les notes de bas de page ». Facteur commun entre la
   *  commande et l'action permanente « Renumérotation » de la Barre : UN SEUL
   *  chemin de transformation (validation, association, notification), jamais
   *  deux copies. */
  renumberFootnotesInEditor(editor: Editor): void {
    const src = editor.getValue();
    const out = renumberFootnotes(src);
    if (out === src) {
      new Notice(t("main.notice.nothingToRenumber"));
      return;
    }
    /* Renuméroter est une transformation qui touche tout le fichier :
       demande confirmation avant d'y toucher (voir le chantier notes de
       bas de page), contrairement à l'insertion d'une seule note. */
    new ConfirmModal(
      this.app,
      t("main.cmd.renumberFootnotes"),
      t("main.notice.renumberFootnotesConfirm"),
      t("main.cmd.renumberFootnotes"),
      () => {
        const cursor = editor.getCursor();
        editor.setValue(out);
        editor.setCursor(cursor);
        new Notice(t("main.notice.footnotesRenumbered"));
      }
    ).open();
  }

  /** Vérifie les notes du fichier édité — même corps EXACT que la commande
   *  Cmd+P « Vérifier les notes de bas de page ». Facteur commun avec
   *  l'action permanente « Vérification » de la Barre. */
  checkFootnotesInEditor(editor: Editor): void {
    const result = validateFootnotes(editor.getValue());
    new FootnoteCheckModal(this.app, editor, result).open();
  }

  insertCitationFor(sourceFile: TFile, page: string, editor: Editor): void {
    const rawFm = this.fmOf(sourceFile);
    const fm = {
      author: asString(rawFm.author),
      title: rawFm.title,
      date: rawFm.date || rawFm.annee,
      publisher: asString(rawFm.publisher),
      url: asString(rawFm.url),
    };
    const style = this.citationStyleFor();
    const activeFile = this.app.workspace.getActiveFile();
    if (!this._lastCitedSourceByFile) this._lastCitedSourceByFile = new Map();
    const isRepeat = !!activeFile && this._lastCitedSourceByFile.get(activeFile.path) === sourceFile.path;
    const text = formatCitation(fm, page, style, isRepeat);
    if (!text) {
      new Notice(t("main.notice.emptySourceSheet"));
      return;
    }
    if (activeFile) this._lastCitedSourceByFile.set(activeFile.path, sourceFile.path);
    this.markSourceCited(sourceFile);
    if (style === "parenthetical") {
      const at = editor.getCursor("to");
      editor.replaceRange(text, at, at);
      editor.setCursor({ line: at.line, ch: at.ch + text.length });
      editor.focus();
      new Notice(isRepeat ? t("main.notice.ibidInserted") : t("main.notice.citationInserted"));
      return;
    }
    const n = nextFootnoteNumber(editor.getValue());
    const refMarker = `[^${n}]`;
    const at = editor.getCursor("to");
    editor.replaceRange(refMarker, at, at);
    const lastLine = editor.lastLine();
    const end = { line: lastLine, ch: editor.getLine(lastLine).length };
    editor.replaceRange(`\n\n[^${n}]: ${text}`, end, end);
    editor.setCursor({ line: at.line, ch: at.ch + refMarker.length });
    editor.focus();
    new Notice(isRepeat ? t("main.notice.ibidInsertedNote", { n: String(n) }) : t("main.notice.citationInsertedNote", { n: String(n) }));
  }

  /* L'échec n'interrompt pas l'insertion de la citation (déjà écrite dans le
     texte à ce stade), mais il ne doit pas passer inaperçu : `cite_count` est
     ce qui décide de la présence de la source dans generateBibliographyFile,
     donc un échec silencieux ici se manifeste bien plus tard, sous forme
     d'entrée manquante dans la bibliographie. */
  markSourceCited(sourceFile: TFile): void {
    this.app.fileManager.processFrontMatter(sourceFile, (fm: SceneFrontmatter) => {
      fm.cite_count = (fm.cite_count || 0) + 1;
    }).catch((e: unknown) => {
      console.error(`Feuillets: compteur de citations non mis à jour (${sourceFile.path})`, e);
      new Notice(t("main.notice.citationInsertedButNotMarked"));
    });
  }

  /** Écrit `Bibliographie.md` — même sélection et même formatage EXACTEMENT
   * que la bibliographie générée dans Composition (services/compile-
   * export.ts) : `bibliographyEntries()` + `generateBibliography()`
   * (services/bibliography-generator.ts), aucun second moteur ici. Ce
   * qu'on ajoute par rapport à Composition : l'écriture du fichier, la
   * Notice et la gestion d'erreur. */
  async generateBibliographyFile(): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) return;
    const content = generateBibliography(bibliographyEntries(this.app, this.settings));
    if (!content) {
      new Notice(t("main.notice.noSourceCitedYet"));
      return;
    }
    try {
      const outputFolder = await getOutputFolder(this.app, this.settings);
      const outBase = outputFolder ? outputFolder.path : root.path;
      const path = normalizePath(`${outBase}/Bibliographie.md`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modify(existing, content);
      else await this.app.vault.create(path, content);
      new Notice(t("main.notice.bibliographyGenerated", { path }));
    } catch (e) {
      /* Action déclenchée par un clic explicite : sans ce retour, l'échec se
         traduit par « rien ne se passe », indiscernable d'un bouton inerte. */
      console.error("Feuillets: génération de la bibliographie impossible", e);
      new Notice(t("main.notice.bibliographyNotGenerated"));
    }
  }

  unitLabel() { return t(getProjectType(this.app, this.settings) === "fiction" ? "unit.scene" : "unit.section"); }
  unitLabelPlural() { return t(getProjectType(this.app, this.settings) === "fiction" ? "unit.scenes" : "unit.sections"); }
  hasSources() { return this.projectMode().hasSources; }
  // Nom personnalisé (S.projectMeta[path].name, réglable dans
  // ManageProjectsModal) en priorité, sinon déduit du dossier (voir
  // folder-structure.js — gère la convention <Projet>/Manuscrit/).
  projectDisplayName(path: string): string {
    const custom = (this.settings.projectMeta[path] || {}).name;
    return custom && custom.trim() ? custom.trim() : projectDisplayName(path);
  }
  fmOf(file: TFile | null | undefined): SceneFrontmatter { return fmOf(this.app, file, this.settings); }
  titleFor(file: TFile): string { return titleFor(this.app, file); }
  shortTitleFor(file: TFile): string { return shortTitleFor(this.app, file); }
  compiledTitleFor(file: TFile): string | null { return compiledTitleFor(this.app, file); }
  folderNoteFor(folder: TFolder): TFile | null { return folderNoteFor(this.app, folder); }
  async getOrCreateFolderNote(folder: TFolder): Promise<TFile> { return getOrCreateFolderNote(this.app, folder); }
  tagsOf(file: TFile): string[] { return tagsOf(this.app, file); }
  labelOf(file: TFile): string { return labelOf(this.app, file); }
  labelsOf(file: TFile): string[] { return labelsOf(this.app, file); }
  labelColor(name: string): string | null { return labelColor(this.settings, name); }
  getStatusColor(name: string): string | null { return getStatusColor(this.app, this.settings, name); }
  folderGoal(folder: TFolder): number { return folderGoal(this.settings, folder); }
  depthOf(node: ProjectNode): number { return depthOf(this.app, this.settings, node); }
  isFrontMatter(node: ProjectNode): boolean { return isFrontMatter(this.app, this.settings, node); }
  roleOfFolder(folder: TFolder): "chapitre" | "partie" { return roleOfFolder(this.app, this.settings, folder); }
  roleOfFile(file: TFile): "chapitre" | "scene" { return roleOfFile(this.app, this.settings, file); }
  getOrderedChildren(folder: TFolder | null | undefined, includeHidden = false): ProjectNode[] {
    return getOrderedChildren(this.app, this.settings, folder, includeHidden);
  }
  flattenFiles(folder: TFolder | null | undefined): TFile[] { return flattenFiles(this.app, this.settings, folder); }
  getManuscriptFiles(): TFile[] {
    const root = this.getProjectFolder();
    if (!root) return [];
    return this.flattenFiles(root);
  }
  chapterCount(root: TFolder | null | undefined): number { return chapterCount(this.app, this.settings, root); }
  getChapters(root: TFolder | null | undefined): ProjectNode[] { return getChapters(this.app, this.settings, root); }

  async maybeRenameResearchFile(file: TFile): Promise<void> { return maybeRenameResearchFile(this.app, this.settings, file); }
  async handleFilChanged(file: TFile): Promise<void> {
    try { await handleFilChanged(this.app, this.settings, this, file); } catch { /* gestionnaire d'evenement sur changement de fichier : une erreur ici ne doit jamais remonter a l'autrice en pleine ecriture */ }
  }

  entityMatchTags(entityFile: TFile) { return entityMatchTags(this.app, entityFile); }
  entityMatchNames(entityFile: TFile) { return entityMatchNames(this.app, entityFile); }
  async findAppearances(entityFile: TFile) { return findAppearances(this.app, this.settings, entityFile); }
  getResearchRoot() { return getResearchRoot(this.app, this.settings); }
  getChronoFolder(): TFolder | null { return getChronoFolder(this.app, this.settings); }

  /* ---- Association Binder ↔ Recherche ----
     Stockée par projet dans S.projectMeta[racine].researchFolderLinks :
     clé = chemin du dossier Binder (manuscrit), valeur = chemin du dossier
     Recherche associé. Le stockage est une simple map de chaînes ; aucun
     dossier physique n'est créé ni supprimé par ces méthodes. */

  /** Dossier Recherche associé à un dossier Binder du projet actif, s'il
   * existe toujours sur le disque. */
  getLinkedResearchFolder(binderNode: TAbstractFile): TFolder | null {
    const root = this.getProjectFolder();
    if (!root) return null;
    const meta = this.settings.projectMeta[root.path];
    const linked = meta && meta.researchFolderLinks
      ? meta.researchFolderLinks[binderNode.path]
      : null;
    if (!linked) return null;
    const f = this.app.vault.getAbstractFileByPath(linked);
    return f instanceof TFolder ? f : null;
  }

  /** Associe (ou remplace) le dossier Recherche d'un nœud Binder
   * (dossier ou fichier Markdown). */
  async setLinkedResearchFolder(
    binderNode: TAbstractFile,
    researchFolder: TFolder
  ): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) return;
    const S = this.settings;
    if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
    const meta = S.projectMeta[root.path];
    if (!meta.researchFolderLinks) meta.researchFolderLinks = {};
    meta.researchFolderLinks[binderNode.path] = researchFolder.path;
    await this.saveSettings();
  }

  /** Détache le dossier Recherche associé : supprime SEULEMENT l'entrée de
   * la map — aucun dossier physique n'est supprimé ni déplacé. */
  async removeLinkedResearchFolder(binderNode: TAbstractFile): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) return;
    const meta = this.settings.projectMeta[root.path];
    if (!meta || !meta.researchFolderLinks) return;
    if (delete meta.researchFolderLinks[binderNode.path]) {
      await this.saveSettings();
    }
  }

  /** Dossiers Recherche associés depuis le Binder du projet actif,
   * regroupés par dossier réel (un même dossier de recherche peut être
   * associé à plusieurs nœuds du Binder — dossier ou fichier Markdown).
   * Ignore silencieusement toute association orpheline : dossier
   * Recherche disparu du disque, ou nœud Binder qui n'existe plus (aucune
   * entrée n'est modifiée ni supprimée des settings pour autant — voir
   * remapResearchFolderLinks pour le seul mécanisme de nettoyage). */
  getLinkedResearchFolders(): { folder: TFolder; binderNodes: TAbstractFile[] }[] {
    const root = this.getProjectFolder();
    if (!root) return [];
    const meta = this.settings.projectMeta[root.path];
    const links = meta && meta.researchFolderLinks ? meta.researchFolderLinks : null;
    if (!links) return [];
    const byPath = new Map<string, { folder: TFolder; binderNodes: TAbstractFile[] }>();
    for (const [binderPath, folderPath] of Object.entries(links)) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) continue;
      const binderNode = this.app.vault.getAbstractFileByPath(binderPath);
      if (!binderNode) continue;
      const entry = byPath.get(folder.path);
      if (entry) entry.binderNodes.push(binderNode);
      else byPath.set(folder.path, { folder, binderNodes: [binderNode] });
    }
    return [...byPath.values()];
  }

  /** Remappe les liens Binder→Recherche de TOUS les projets connus (pas
   * seulement le projet actif) après un renommage/déplacement. */
  remapResearchFolderLinks(oldPath: string, newPath: string): void {
    const S = this.settings;
    let changed = false;
    for (const projectPath of Object.keys(S.projectMeta)) {
      const meta = S.projectMeta[projectPath];
      if (!meta || !meta.researchFolderLinks) continue;
      const next = remapResearchFolderLinks(meta.researchFolderLinks, oldPath, newPath);
      if (next !== meta.researchFolderLinks) {
        meta.researchFolderLinks = next;
        changed = true;
      }
    }
    if (changed) void this.saveSettings();
  }
  listCompiledFilePaths() { return listCompiledFilePaths(this.app, this.settings); }
  parseStoryDate(raw: unknown, file: TFile | null = null) { return parseStoryDate(raw, file); }

  buildNumbering(root: TFolder): Map<string, string> {
    /* numbering.ts est volontairement pur (testable sans coffre) : son
       NumberingNode est une forme générique, pas TFile/TFolder — d'où les
       casts, seul point de jonction entre les deux mondes. */
    const helpers = {
      getOrderedChildren: (f: TFolder) => this.getOrderedChildren(f),
      roleOfFolder: (f: TFolder) => this.roleOfFolder(f),
      isFrontMatter: (node: ProjectNode) => this.isFrontMatter(node),
      isFolder: (node: unknown) => node instanceof TFolder,
    };
    return buildNumbering(
      this.settings,
      root as unknown as Parameters<typeof buildNumbering>[1],
      helpers as unknown as Parameters<typeof buildNumbering>[2]
    );
  }

  async getWordCounts(files: TFile[]): Promise<
    Map<string, { mtime: number; wc: number; chars: number; charsNoSpaces: number; sentences: number; paragraphs: number }>
  > {
    if (!this._wcCache) this._wcCache = new Map();
    const cache = this._wcCache;
    let misses: TFile[] | null = null;
    for (const f of files) {
      const hit = cache.get(f.path);
      if (!hit || hit.mtime !== f.stat.mtime) (misses || (misses = [])).push(f);
    }
    if (misses) {
      await Promise.all(
        misses.map(async (f) => {
          const content = await this.app.vault.cachedRead(f);
          const clean = stripWritingNoise(content);
          cache.set(f.path, {
            mtime: f.stat.mtime,
            wc: countWords(content),
            chars: clean.length,
            charsNoSpaces: clean.replace(/\s/g, "").length,
            sentences: countSentences(clean),
            paragraphs: countParagraphs(clean),
          });
        })
      );
    }
    if (cache.size > files.length) {
      const alive = new Set(files.map((f) => f.path));
      for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
    }
    return cache;
  }

  async wordCountOfFolder(folder: TFolder | null | undefined): Promise<number> {
    const files = this.flattenFiles(folder);
    const counts = await this.getWordCounts(files);
    let total = 0;
    for (const f of files) total += counts.get(f.path)?.wc || 0;
    return total;
  }

  async updateDailyStats(currentTotal: number): Promise<number> {
    const key = todayKey();
    const stats = this.settings.stats || {};
    if (!stats[key]) {
      stats[key] = { start: currentTotal, latest: currentTotal };
      this.settings.stats = stats;
      await this.saveSettings();
      return 0;
    }
    if (stats[key].latest !== currentTotal) {
      stats[key].latest = currentTotal;
      this.settings.stats = stats;
      await this.saveSettings();
    }
    return currentTotal - stats[key].start;
  }

  pushHistory(entry: MoveHistoryEntry): void {
    if (!this.moveStack) this.moveStack = [];
    this.moveStack.push(entry);
    if (this.moveStack.length > 30) this.moveStack.shift();
  }

  /* Enfants de `parent` réordonnés selon un instantané de noms pris avant un
     déplacement (voir pushHistory), pour la commande « Annuler le dernier
     déplacement » — dont les deux branches écrivent ensuite le résultat
     différemment (writeOrder / applySiblingOrder). */
  orderFromSnapshot(parent: TFolder, names: string[]): ProjectNode[] {
    return orderFromSnapshot(this.getOrderedChildren(parent), names);
  }

  async writeOrder(parent: TFolder, orderedChildren: ProjectNode[]): Promise<void> {
    this.settings.orders[parent.path] = orderedChildren.map((c) => c.name);
    for (let i = 0; i < orderedChildren.length; i++) {
      const child = orderedChildren[i];
      if (child instanceof TFile) {
        const current = parseInt(String(this.fmOf(child).order), 10);
        if (current !== i + 1) {
          await this.app.fileManager.processFrontMatter(child, (fm: SceneFrontmatter) => { fm.order = i + 1; });
        }
      } else {
        this.settings.folderPositions[child.path] = i + 1;
      }
    }
    await this.saveSettings();
  }

  async applySiblingOrder(parent: TFolder, orderedChildren: ProjectNode[], recordHistory = true): Promise<void> {
    if (recordHistory) {
      this.pushHistory({
        type: "reorder",
        parentPath: parent.path,
        order: this.getOrderedChildren(parent).map((c) => c.name),
      });
    }
    await this.writeOrder(parent, orderedChildren);
    if (this.settings.autoRename) {
      const root = this.getProjectFolder();
      if (root) await this.renumberTitles(root);
    }
  }

  async moveNode(node: ProjectNode, srcParent: TFolder, destFolder: TFolder, insertIndex: number): Promise<void> {
    if (node.path === destFolder.path) return;
    if (node instanceof TFolder && (destFolder.path === node.path || destFolder.path.startsWith(node.path + "/"))) {
      new Notice(t("main.notice.cannotMoveFolderIntoItself"));
      return;
    }
    const destPath = normalizePath(`${destFolder.path}/${node.name}`);
    if (this.app.vault.getAbstractFileByPath(destPath)) {
      new Notice(t("main.notice.alreadyExistsIn", { name: node.name, folder: destFolder.name }));
      return;
    }
    this.pushHistory({
      type: "move",
      nodeName: node.name,
      srcParentPath: srcParent.path,
      destFolderPath: destFolder.path,
      srcOrder: this.getOrderedChildren(srcParent).map((c) => c.name),
      destOrder: this.getOrderedChildren(destFolder).map((c) => c.name),
    });
    const srcRemaining = this.getOrderedChildren(srcParent).filter((c) => c.path !== node.path);
    await this.app.fileManager.renameFile(node, destPath);
    const movedNow = this.app.vault.getAbstractFileByPath(destPath);
    const destChildren = this.getOrderedChildren(destFolder).filter((c) => c.path !== destPath);
    const at = Math.min(insertIndex, destChildren.length);
    destChildren.splice(at, 0, movedNow as ProjectNode);
    await this.writeOrder(destFolder, destChildren);
    await this.writeOrder(srcParent, srcRemaining);
    if (this.settings.autoRename) {
      const root = this.getProjectFolder();
      if (root) await this.renumberTitles(root);
    }
    /* Un fichier qui porte EXACTEMENT le nom de son nouveau dossier parent
       devient sa "note de dossier" (synopsis/description, convention
       partagée avec getOrderedChildren dans folder-structure.js) au lieu
       d'une scène normale — donc invisible dans toutes les vues (Binder,
       Cartes, Plan…) sans le moindre signe. Sans cet avertissement,
       glisser par erreur « Postface.md » dans un dossier « Postface » fait
       "disparaître" le fichier sans explication. */
    if (movedNow instanceof TFile && movedNow.basename === destFolder.name) {
      new Notice(
        t("main.notice.becameFolderNote", { name: node.name, folder: destFolder.name }),
        10000
      );
      return;
    }
    const movedName = movedNow instanceof TFile ? this.titleFor(movedNow) : "";
    new Notice(t("main.notice.moved", { name: movedName || node.name }));
  }

  chapterPattern(): RegExp {
    const prefix = escapeRegExp(String(this.settings.renamePrefix || "chapitre"));
    return new RegExp(`^${prefix}\\s*\\d+$`, "i");
  }

  async renumberTitles(root: TFolder): Promise<number> {
    const chapMode = this.settings.chapterNumbering || "continu";
    if (chapMode === "aucune") return 0;
    const pattern = this.chapterPattern();
    const prefix = this.settings.renamePrefix || "chapitre";
    let n = 0;
    let changed = 0;
    const concernsFile = (f: TFile): boolean => {
      const fm = this.fmOf(f);
      const title = typeof fm.title === "string" ? fm.title.trim() : "";
      if (title) return pattern.test(title);
      return pattern.test(f.basename);
    };
    const walk = async (f: TFolder): Promise<void> => {
      if (chapMode === "parPartie" && this.roleOfFolder(f) === "partie") n = 0;
      for (const child of this.getOrderedChildren(f)) {
        if (child instanceof TFolder) {
          if (this.roleOfFolder(child) === "chapitre") {
            n++;
            if (pattern.test(child.name)) {
              const target = `${prefix} ${n}`;
              if (child.name !== target) {
                const destPath = normalizePath(`${f.path}/${target}`);
                if (!this.app.vault.getAbstractFileByPath(destPath)) {
                  const oldPath = child.path;
                  const oldName = child.name;
                  await this.app.fileManager.renameFile(child, destPath);
                  if (this.settings.folderPositions[oldPath] !== undefined) {
                    this.settings.folderPositions[destPath] = this.settings.folderPositions[oldPath];
                    delete this.settings.folderPositions[oldPath];
                  }
                  const savedOrder = this.settings.orders[f.path];
                  if (savedOrder) {
                    const idx = savedOrder.indexOf(oldName);
                    if (idx !== -1) savedOrder[idx] = target;
                  }
                  changed++;
                }
              }
            }
          } else {
            await walk(child);
          }
        } else if (this.roleOfFile(child) === "chapitre") {
          n++;
          if (concernsFile(child)) {
            const target = `${prefix} ${n}`;
            if (this.titleFor(child) !== target) {
              await this.app.fileManager.processFrontMatter(child, (fm: SceneFrontmatter) => { fm.title = target; });
              changed++;
            }
          }
        }
      }
    };
    await walk(root);
    if (changed > 0) await this.saveSettings();
    return changed;
  }

  async ensureFolder(path: string): Promise<TAbstractFile> { return ensureFolder(this.app, path); }
  async snapshotFile(file: TFile, root: TFolder): Promise<string> { return snapshotFile(this.app, file, root); }
  async initProjectStructure(identity?: { title?: string; author?: string }): Promise<void> { return initProjectStructure(this.app, this.settings, identity); }

  /** Duplique le dossier manuscrit d'un projet existant (identifié par son
   * chemin) en dossier de référence figé — volontairement PAS ajouté à
   * settings.projects : ce n'est pas un projet basculable, juste une copie
   * qu'on consulte au besoin depuis l'explorateur de fichiers d'Obsidian.
   * Le projet actif ne change pas. */
  async duplicateProject(path: string, label: string): Promise<string | null> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      new Notice(t("main.notice.folderNotFound"));
      return null;
    }
    let destPath: string;
    try {
      destPath = await duplicateProjectFolder(this.app, folder, label, this.settings);
    } catch (e) {
      new Notice((e instanceof Error ? e.message : "") || t("main.notice.duplicationImpossible"));
      return null;
    }
    await this.saveSettings();
    new Notice(t("main.notice.versionDuplicated", { path: destPath }), 8000);
    this.renderAllViews(true);
    return destPath;
  }

  /** Enregistre un dossier existant (n'importe quel dossier du vault) comme
   * projet Feuillets, sans le déplacer ni le modifier. Le dossier est ajouté
   * à la liste des projets — il peut ensuite être ouvert normalement. Refuse
   * un dossier déjà enregistré pour éviter les doublons. */
  async registerExistingProjectFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      new Notice(t("main.notice.folderNotFound"));
      return;
    }

    // Vérifier que le dossier n'est pas déjà un projet
    if (this.settings.projects.includes(path)) {
      new Notice(t("main.notice.alreadyAProject", { name: folder.name }));
      return;
    }

    // Afficher la modale de sélection du mode
    const { TransformToProjectModal } = await import("./ui/project-modals.js");
    new TransformToProjectModal(this.app, this, path).open();
  }

  getVersionsRoot(): TFolder | null { return getVersionsRoot(this.app, this.getProjectFolder()); }

  /** Étiquette de version ("v1", "Premier jet"…) si le fichier vit dans
   * _Versions/<manuscrit> (<étiquette>)/… — sert à préfixer le titre
   * d'onglet, sans quoi une scène ouverte depuis une version archivée
   * affiche exactement le même titre que la scène active du manuscrit
   * (même `titre_binder`, copié tel quel à la duplication). */
  versionLabelForFile(file: TFile): string | null {
    const marker = "/_Versions/";
    const idx = file.path.indexOf(marker);
    if (idx === -1) return null;
    const versionFolderName = file.path.slice(idx + marker.length).split("/")[0];
    const m = versionFolderName.match(/\(([^)]*)\)\s*$/);
    return (m ? m[1] : versionFolderName).trim() || null;
  }
  async createDemoProject(): Promise<void> {
    return createDemoProject(this.app, this.settings, this);
  }

  async generateCanvasBoard(): Promise<void> {
    const result = await generateCanvasBoard(this.app, this.settings);
    if (!result) return;
    const existing = this.app.workspace.getLeavesOfType("canvas").find(
      (leaf) => (leaf.view as unknown as { file?: TFile }).file?.path === result.file.path
    );
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }
    openFileActivating(this.app, this.app.workspace.getLeaf(true), result.file);
  }

  /** Ajoute explicitement un feuillet au Carnet sans modifier le Binder. */
  async addFileToNotebook(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    const root = this.getProjectFolder();
    if (!root || !file.path.startsWith(`${root.path}/`)) return;
    const result = await generateCanvasBoard(this.app, this.settings);
    if (!result) return;
    const liveView = this.app.workspace.getLeavesOfType("canvas")
      .map((leaf) => leaf.view as unknown as { file?: TFile | null } & Partial<LiveCanvasFileView>)
      .find((view): view is { file: TFile } & LiveCanvasFileView =>
        view.file?.path === result.file.path &&
        typeof view.getViewData === "function" &&
        typeof view.setViewData === "function" &&
        typeof view.requestSave === "function"
      );
    const outcome = await addFileNodeToNotebook(this.app, result.file, file.path, liveView);
    if (outcome === "duplicate") {
      new Notice("Ce feuillet est déjà dans le Carnet.");
    }
  }

  /** Lot 7 (« Ajouter la sélection au Carnet ») — équivalent BATCH de
   * `addFileToNotebook` ci-dessus, jamais une boucle d'appels à celle-ci
   * (une seule transaction Canvas, voir `addFileNodesToNotebook`,
   * services/canvas-board.ts). `files` est déjà dans l'ORDRE BINDER
   * CANONIQUE — reçu tel quel, jamais retrié ici (voir l'appelant,
   * views/base-feuillets-view.ts `showFileContextMenu`, qui construit cet
   * ordre via `flattenFiles`, jamais depuis l'ordre d'un `Set` de
   * sélection). N'ouvre jamais le Carnet, ne touche jamais à la sélection
   * Binder ni au fichier actif — `addFileToNotebook` reste intact,
   * non modifiée au-delà de ce commentaire de tête. */
  async addFilesToNotebook(files: TFile[]): Promise<void> {
    if (files.length === 0) return;
    const root = this.getProjectFolder();
    if (!root) return;
    const result = await generateCanvasBoard(this.app, this.settings);
    if (!result) return;
    const liveView = this.app.workspace.getLeavesOfType("canvas")
      .map((leaf) => leaf.view as unknown as { file?: TFile | null } & Partial<LiveCanvasFileView>)
      .find((view): view is { file: TFile } & LiveCanvasFileView =>
        view.file?.path === result.file.path &&
        typeof view.getViewData === "function" &&
        typeof view.setViewData === "function" &&
        typeof view.requestSave === "function"
      );
    const outcome = await addFileNodesToNotebook(this.app, result.file, files.map((f) => f.path), liveView);
    if (outcome === "invalid") return;
    const { added, duplicates } = outcome;
    if (added === 0) {
      new Notice(t("main.notice.notebookBatchAllDuplicates"));
    } else if (duplicates === 0) {
      new Notice(added === 1
        ? t("main.notice.notebookBatchAddedOne")
        : t("main.notice.notebookBatchAddedMany", { count: String(added) }));
    } else if (added === 1 && duplicates === 1) {
      new Notice(t("main.notice.notebookBatchMixedOneOne"));
    } else if (added === 1) {
      new Notice(t("main.notice.notebookBatchMixedOneMany", { duplicates: String(duplicates) }));
    } else if (duplicates === 1) {
      new Notice(t("main.notice.notebookBatchMixedManyOne", { added: String(added) }));
    } else {
      new Notice(t("main.notice.notebookBatchMixedManyMany", { added: String(added), duplicates: String(duplicates) }));
    }
  }

  /** « Noter une idée » — facteur commun : la commande Cmd+P ET le menu
   *  contextuel de l'éditeur appellent CETTE même méthode, jamais l'une
   *  dupliquée pour l'autre. */
  openCaptureIdeaModal(): void {
    new CaptureIdeaModal(this.app, (text) => void this.captureIdeaToNotebook(text)).open();
  }

  /** Lot 6 (« Carnet : noter une idée ») — ajoute un TextNode LIBRE au
   * Carnet sans jamais l'ouvrir, changer de feuille active, ou toucher au
   * zoom/viewport : `generateCanvasBoard` garantit seulement que le fichier
   * .canvas existe (jamais d'ouverture de vue), et `addTextNodeToNotebook`
   * (services/canvas-board.ts) respecte l'état live d'un Carnet déjà ouvert
   * exactement comme `addFileToNotebook` ci-dessus (invariant du Lot 4).
   * Aucune association au feuillet en cours d'écriture — voir tête de
   * fichier `addTextNodeToCanvas`. */
  async captureIdeaToNotebook(rawText: string): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) return;
    const result = await generateCanvasBoard(this.app, this.settings);
    if (!result) return;
    const liveView = this.app.workspace.getLeavesOfType("canvas")
      .map((leaf) => leaf.view as unknown as { file?: TFile | null } & Partial<LiveCanvasFileView>)
      .find((view): view is { file: TFile } & LiveCanvasFileView =>
        view.file?.path === result.file.path &&
        typeof view.getViewData === "function" &&
        typeof view.setViewData === "function" &&
        typeof view.requestSave === "function"
      );
    await addTextNodeToNotebook(this.app, result.file, rawText, liveView);
  }

  /** Ouvre le pont Canvas → manuscrit/recherche (repli universel, sans
   * Advanced Canvas) : lit le Tableau brainstorming.canvas du projet actif,
   * et laisse la modale choisir/ordonner les idées à convertir. N'agit que
   * sur CE tableau précis — jamais un autre .canvas du coffre. */
  async openCanvasBridge(mode: BridgeMode): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) {
      new Notice(t("main.notice.projectFolderNotFound"));
      return;
    }
    const path = canvasPathFor(this.app, root);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t("main.notice.canvasBoardMissing"));
      return;
    }
    const raw = await this.app.vault.read(file);
    let data: CanvasData;
    try {
      data = JSON.parse(raw) as CanvasData;
    } catch {
      new Notice(t("main.notice.canvasUnreadable"));
      return;
    }
    new CanvasBridgeModal(this.app, this.settings, file, data, mode).open();
  }

  /** Commande palette « Carnet : créer un chapitre… » (section 4) — repli
   * universel, sans dépendance à Advanced Canvas : ouvre la modale sur le
   * Carnet du projet actif, l'auteur choisit un groupe existant ou coche
   * manuellement des éléments admissibles (voir CanvasChapterModal,
   * contexte "command"). */
  async openCanvasChapterModal(): Promise<void> {
    const root = this.getProjectFolder();
    if (!root) {
      new Notice(t("main.notice.projectFolderNotFound"));
      return;
    }
    const path = canvasPathFor(this.app, root);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t("main.notice.canvasBoardMissing"));
      return;
    }
    const raw = await this.app.vault.read(file);
    let data: CanvasData;
    try {
      data = JSON.parse(raw) as CanvasData;
    } catch {
      new Notice(t("main.notice.canvasUnreadable"));
      return;
    }
    new CanvasChapterModal(this.app, this.settings, data, { source: "command" }, {
      persist: (updated) => this.app.vault.modify(file, JSON.stringify(updated, null, "\t")),
      saveSettings: () => this.saveSettings(),
    }).open();
  }


  toggleSearchReplaceBar() {
    if (!this._searchReplaceBar) {
      this._searchReplaceBar = new SearchReplaceBar(this.app, this);
    }
    this._searchReplaceBar.toggle();
  }

  newFolder(parent: TFolder): void { return newFolder(this.app, parent, () => this.renderAllViews(true)); }
  newSheet(folder: TFolder): void { return newSheet(this.app, this.settings, folder); }

  newSheetAt(folder: TFolder, insertIndex: number): void {
    new NewSheetModal(this.app, folder.name, async (fileName, chapTitle) => {
      const path = normalizePath(`${folder.path}/${fileName}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(t("main.notice.sheetNameExists"));
        return;
      }
      const isFiction = getProjectMode(this.app, this.settings).yamlPreset === "roman";
      const lines = [
        "---",
        `title: ${chapTitle || ""}`,
        "short_title: ",
        "order: 0",
        ...(isFiction ? ["synopsis: "] : ["summary: "]),
        "status: ",
        "label: ",
        `goal: ${projectWordGoalDefault(this.app, this.settings)}`,
        "tags: ",
        "date: ",
        "notes: ",
        ...(!isFiction ? ["sources: "] : []),
        "compile: true",
        "---",
        "",
        "",
      ];
      const file = await this.app.vault.create(path, lines.join("\n"));
      const others = this.getOrderedChildren(folder).filter((c) => c.path !== file.path);
      const at = Math.max(0, Math.min(insertIndex, others.length));
      others.splice(at, 0, file);
      await this.applySiblingOrder(folder, others, false);
      this.renderAllViews(true);
      const leaf = this.getLeafForOpeningFile();
      openFileActivating(this.app, leaf, file);
      void this.app.workspace.revealLeaf(leaf);
    }).open();
  }

  async activateSidebar() {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(VIEW_SIDEBAR);
    
    if (existing.length > 0) {
      void workspace.revealLeaf(existing[0]);
    } else {
      const leftLeaf = workspace.getLeftLeaf(false);
      if (leftLeaf) {
        await leftLeaf.setViewState({ type: VIEW_SIDEBAR, active: true });
        void workspace.revealLeaf(leftLeaf);
      }
    }
    await this.activateProjectPanels();
    if (!this.isPanelHidden("journal")) await this.activateJournal();
  }

  /** Statistiques d'un feuillet de projet — même garde que le clic de la
   *  status bar (appartenance au projet actif, sinon no-op strict). Seul
   *  point d'entrée de FileStatsModal pour la Barre ET la status bar. */
  openFileStats(file: TFile | null): void {
    const root = this.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) return;
    new FileStatsModal(this.app, this, file).open();
  }

  async activateBoard() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_BOARD);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_BOARD, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  /** Garde structurelle typée du Board (jamais `any`/`instanceof` imposé) pour
   *  les chemins d'ouverture/mode dynamiques. */
  isBoardModeView(view: unknown): view is BoardView & { setBoardMode(mode: BoardModeKey): void } {
    return typeof view === "object" && view !== null && typeof (view as BoardView).setBoardMode === "function";
  }

  /** Ouvre le Board EN ARRIÈRE-PLAN dans un mode précis (clic droit de la
   *  carte Binder, actions permanentes) : la leaf existante est réutilisée
   *  SANS revealLeaf ; sinon une leaf centrale en onglet est créée puis la
   *  leaf d'écriture d'origine (même mécanique rootSplit que le reste de
   *  Feuillets) est restaurée à la fin. Ne touche jamais à une leaf de
   *  Sidebar et jamais à la vue Preview. */
  async openBoardModeInBackground(mode: BoardModeKey): Promise<void> {
    const workspace = this.app.workspace;
    const rootSplit = workspace.rootSplit;
    const existing = workspace.getLeavesOfType(VIEW_BOARD);
    if (existing.length > 0) {
      const view = existing[0].view;
      if (this.isBoardModeView(view)) view.setBoardMode(mode);
      return;
    }
    const anchor = workspace.getMostRecentLeaf(rootSplit);
    const leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_BOARD, active: true });
    const view = leaf.view;
    if (this.isBoardModeView(view)) view.setBoardMode(mode);
    void workspace.revealLeaf(leaf);
    if (anchor && anchor !== leaf && typeof anchor.getRoot === "function" && anchor.getRoot() === rootSplit) {
      void workspace.revealLeaf(anchor);
    }
  }

  getLeafForOpeningFile() {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const unpinned = markdownLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = (l as LeafWithPinned).pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });
    if (unpinned.length > 0) {
      const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (recent && unpinned.includes(recent)) return recent;
      return unpinned[0];
    }
    const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
    const unpinnedEmpty = emptyLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = (l as LeafWithPinned).pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });
    if (unpinnedEmpty.length > 0) return unpinnedEmpty[0];
    return this.app.workspace.getLeaf(false);
  }

  async activateSidebarView(tabId = "project"): Promise<void> {
    if (
      (tabId === "notes" || tabId === "research" || tabId === "journal" ||
        tabId === "project" || tabId === "analyse" || tabId === "relecture") &&
      this.isPanelHidden(tabId)
    ) {
      new Notice(t("sidebar.notice.tabHidden"));
      return;
    }
    const workspace = this.app.workspace;
    const leaves = workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS);
    let leaf = leaves.length > 0 ? leaves[0] : null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: true });
      }
    }
    if (leaf) {
      void workspace.revealLeaf(leaf);
      const view = leaf.view as View & { activeTab?: string; render?: () => Promise<void> };
      if (view && tabId) {
        view.activeTab = tabId;
        if (typeof view.render === "function") {
          await view.render();
        }
      }
    }
  }

  /* ---------- Analyse linguistique (déléguée à un compagnon) ---------- */

  getAnalysisProvider(providerId?: string): TextAnalysisProvider | null {
    return this.analysisRegistry.get(providerId);
  }

  /** Analyse le feuillet actif ; si une sélection existe dans l'éditeur, ne
   *  porte que sur cette sélection (les offsets restent ceux du fichier). */
  async analyzeActiveFile(): Promise<void> {
    return this.runAnalysisCommand(this.currentSelectionRange());
  }

  /** Analyse explicitement la sélection : sans sélection, refuse plutôt que
   *  d'analyser tout le document à l'insu de l'utilisatrice — la commande
   *  « analyser le document courant » est là pour ça. */
  async analyzeSelection(): Promise<void> {
    const selection = this.currentSelectionRange();
    if (!selection) {
      new Notice(t("analysisResults.notice.noSelection"));
      return;
    }
    return this.runAnalysisCommand(selection);
  }

  currentSelectionRange(editorOverride?: Editor): { start: number; end: number } | null {
    const editor = editorOverride ?? this.activeEditorAnywhere();
    if (!editor || !editor.somethingSelected()) return null;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return to > from ? { start: from, end: to } : null;
  }

  async runAnalysisCommand(selection: { start: number; end: number } | null): Promise<void> {
    if (!this.getAnalysisProvider()) {
      new Notice(t("analysisResults.notice.noProvider"));
      void this.activateSidebarView("relecture");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t("analysisResults.notice.openSheet"));
      return;
    }

    this.analysisRunning = true;
    await this.activateSidebarView("relecture");
    try {
      this.analysisRun = await runAnalysis(this.app, this.analysisRegistry, file, {
        selection,
        fileTitle: this.titleFor(file),
      });
      const activeEd = this.activeEditorAnywhere();
      if (activeEd) {
        const cm = (activeEd as unknown as Record<string, unknown>).cm as { dispatch(spec: { effects?: unknown }): void } | undefined;
        if (cm) applyGrammarHighlights(cm, this.analysisRun ? this.analysisRun.issues : [], this, file.path);
      }
    } catch (error) {
      this.analysisRun = null;
      const message = error instanceof Error ? error.message : String(error);
      new Notice(
        message === "NO_PROVIDER"
          ? t("analysisResults.notice.noProvider")
          : t("analysisResults.notice.failed", { error: message })
      );
    } finally {
      this.analysisRunning = false;
      this.refreshAnalysisPanel();
    }
  }

  /** Redessine l'onglet Relecture s'il est ouvert et affiché. Appelé après
   *  une analyse et à chaque (dés)enregistrement de fournisseur, pour que
   *  l'installation ou le retrait du compagnon se voie sans rouvrir le
   *  panneau. */
  refreshAnalysisPanel(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS)) {
      const view = leaf.view as View & { activeTab?: string; render?: () => Promise<void> };
      if (view && view.activeTab === "relecture" && typeof view.render === "function") {
        void view.render();
      }
    }
  }

  isRelectureViewActive(): boolean {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS)) {
      const view = leaf.view as View & { activeTab?: string };
      if (view && view.activeTab === "relecture") {
        return true;
      }
    }
    return false;
  }

  async activateNotes() { return this.activateSidebarView("notes"); }
  async activateResearch() { return this.activateSidebarView("research"); }
  /* §12A du dernier lot UX avant 2.5 : "docx" mène désormais à l'onglet
   * "relecture" (voir activeTabFor(), sidebar-feuillets-view.ts) — plus à
   * "project", contrairement à ce que documentait ce commentaire avant une
   * fusion ultérieure qui a reséparé les deux onglets. */
  async activateDocxReview() { return this.activateSidebarView("relecture"); }
  async activateJournal() { return this.activateSidebarView("journal"); }
  async activateProject() { return this.activateSidebarView("project"); }
  /** Ouvre une page précise d'Édition dans le panneau droit unifié.
   * `activateSidebarView("project")` reste l'unique chemin de création/
   * révélation de la sidebar ; ce second temps ne fait que choisir la page
   * interne demandée. Aucun Board ni Preview n'est créé. */
  async activateEditionPage(page: EditionPage): Promise<void> {
    if (this.isPanelHidden("project")) {
      await this.activateSidebarView("project");
      return;
    }
    await this.activateSidebarView("project");
    const leaf = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS)[0];
    if (!leaf) return;
    if (leaf.isDeferred) await leaf.loadIfDeferred();
    const view = leaf.view;
    if (isEditionSidebarPageView(view)) await view.openEditionPage(page);
  }

  async ensureJournalEntry(date: Date): Promise<TFile | null> {
    return ensureDayEntry(this.app, this.settings, date);
  }
  async compileJournal() { return compileJournal(this.app, this.settings); }
  activePresetConfig(): PresetConfig { return activePresetConfig(this.settings); }
  async getOutputFolder() { return getOutputFolder(this.app, this.settings); }
  async compile() { return compile(this.app, this.settings); }
  async exportFile(format = "docx") { return exportFile(this.app, this.settings, format); }
  projectMetaFor(folder: TFolder): ProjectMeta { return projectMetaFor(this.settings, folder); }

  insertIntoActiveEditor(text: string): void {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.noMarkdownEditor"));
      return;
    }
    const hasSelection = typeof editor.getSelection === "function" && !!editor.getSelection();
    if (hasSelection) {
      editor.replaceSelection(text);
    } else {
      const cursor = editor.getCursor();
      editor.replaceRange(text, cursor);
      editor.setCursor({ line: cursor.line, ch: cursor.ch + text.length });
    }
    new Notice(t("main.notice.contentInserted"));
  }

  /** Sauvegarde automatique périodique (.zip de tout le projet actif dans
   * _Backups) — filet de sécurité en plus des _Versions manuelles, sans
   * dépendre d'un événement de fermeture d'Obsidian (pas fiable pour de
   * l'I/O asynchrone) : un simple minuteur pendant que le coffre est
   * ouvert, comme la sauvegarde périodique de Scrivener. */
  registerAutoBackup() {
    this._lastBackupAt = 0;
    const runTick = async () => {
      if (!this.settings.backupEnabled) return;
      const root = this.getProjectFolder();
      if (!root) return;
      const intervalMs = Math.max(1, Number(this.settings.backupIntervalMinutes) || 30) * 60 * 1000;
      if (Date.now() - (this._lastBackupAt ?? 0) < intervalMs) return;
      this._lastBackupAt = Date.now();
      try {
        await createProjectBackup(this.app, root, this.settings as unknown as Parameters<typeof createProjectBackup>[2]);
      } catch (e) {
        console.error("Feuillets : sauvegarde automatique", e);
      }
    };
    /* `tick` reste une fonction synchrone (void this.settings) passée par
       référence à setInterval — surtout pas `() => runTick()` ni
       `() => { void runTick(); }` en ligne : la règle obsidianmd/no-sample-code
       de l'ESLint officiel d'Obsidian plante (TypeError) sur
       `window.setInterval(() => f(), …)` — elle déréférence
       `callback.body.callee?.property.type` sans `?.` sur `property`, qui
       est undefined quand l'appel vise un identifiant simple. Ce plantage
       faisait échouer toute la revue « Source code » du tableau de bord. */
    const tick = () => { void runTick(); };
    // Vérifié toutes les minutes ; la vraie cadence des sauvegardes est
    // imposée par backupIntervalMinutes (comparaison de date dans runTick()).
    this.registerInterval(window.setInterval(tick, 60 * 1000));
  }

  async backupProjectNow() {
    const root = this.getProjectFolder();
    if (!root) {
      new Notice(t("analysis.dashboard.noActiveProject"));
      return;
    }
    new Notice(t("main.notice.backupInProgress"));
    try {
      const path = await createProjectBackup(this.app, root, this.settings as unknown as Parameters<typeof createProjectBackup>[2]);
      this._lastBackupAt = Date.now();
      new Notice(t("main.notice.backupCreated", { path }), 8000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      new Notice(t("main.notice.backupFailed", { error: message.slice(0, 200) }));
    }
  }

  registerSwipeGestures() {
    /* Lus à CHAQUE geste, jamais capturés une fois pour toutes : cette
       méthode est appelée depuis onload(), bien avant que la mise en page
       d'Obsidian soit restaurée (onLayoutReady arrive beaucoup plus tard)
       — leftSplit/rightSplit valaient encore undefined à ce moment-là, et
       une capture figée dans des `const` les gardait undefined pour
       toujours, rendant tout le geste silencieusement inopérant. */
    const getLeftSplit = () => this.app.workspace.leftSplit;
    const getRightSplit = () => this.app.workspace.rightSplit;
    const isFichesView = () => !!this.settings.binderTreeCollapsed;

    const toggleFichesViewLight = (collapsed: boolean): boolean => {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR)[0];
      const view = leaf && (leaf.view as View & { toggleTreeCollapsedClasses?: (collapsed: boolean) => void });
      if (view && typeof view.toggleTreeCollapsedClasses === "function") {
        view.toggleTreeCollapsedClasses(collapsed);
        return true;
      }
      return false;
    };

    const showFichesView = () => {
      this.settings.binderTreeCollapsed = true;
      void this.saveSettings();
      if (!toggleFichesViewLight(true)) this.renderAllViews(true);
    };

    const showDossiersView = () => {
      this.settings.binderTreeCollapsed = false;
      void this.saveSettings();
      if (!toggleFichesViewLight(false)) this.renderAllViews(true);
    };

    /* Volet GAUCHE (Binder) : 3 états cycliques (replié → fiches seules →
       dossiers+fiches). `reveal` : true = déployer davantage, false =
       replier davantage — c'est l'appelant (tactile ou trackpad) qui
       traduit un sens de balayage en reveal/replier, jamais l'inverse ici. */
    const executeLeftPanel = (reveal: boolean) => {
      const leftSplit = getLeftSplit();
      const rightSplit = getRightSplit();
      if (!this.settings.swipeGesturesEnabled) return;
      if (!leftSplit || !rightSplit) return;
      try {
        if (reveal) {
          if (leftSplit.collapsed) {
            leftSplit.expand();
            showFichesView();
          } else if (isFichesView()) {
            showDossiersView();
          }
        } else if (!leftSplit.collapsed) {
          if (!isFichesView()) showFichesView();
          else leftSplit.collapse();
        }
      } catch { /* geste tactile sur un split absent ou deja replie : sans effet, sans consequence */ }
    };

    /* Volet DROIT (panneau Feuillets — Inspecteur, ou tout autre panneau
       qui y est ancré) : simple bascule replié/déplié, pas de cycle à 3
       états comme à gauche — rien d'équivalent au mode "fiches seules". */
    const executeRightPanel = (reveal: boolean) => {
      const rightSplit = getRightSplit();
      if (!this.settings.swipeGesturesEnabled || !rightSplit) return;
      try {
        if (reveal) {
          if (rightSplit.collapsed) rightSplit.expand();
        } else if (!rightSplit.collapsed) {
          rightSplit.collapse();
        }
      } catch { /* idem pour le panneau droit */ }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target!.closest(".cm-editor")) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!this.settings.swipeGesturesEnabled || touchStartTime === 0 || e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const duration = Date.now() - touchStartTime;
      touchStartTime = 0;
      if (Math.abs(deltaX) > 80 && Math.abs(deltaY) < 50 && duration < 300) {
        if (touchStartX < window.innerWidth * 0.37) {
          // Près du bord gauche : geste sur le volet gauche.
          executeLeftPanel(deltaX > 0);
        } else if (touchStartX > window.innerWidth * 0.63) {
          // Près du bord droit : geste sur le volet droit, sens inversé
          // (on "tire" le panneau depuis le bord droit vers l'intérieur).
          executeRightPanel(deltaX < 0);
        }
      }
    };

    this.registerDomEvent(window, "touchstart", onTouchStart, { passive: true });
    this.registerDomEvent(window, "touchend", onTouchEnd, { passive: true });

    /* Balayage 2 doigts au trackpad (macOS/Windows precision trackpad) : ne
       déclenche AUCUN événement tactile (touchstart/touchend ci-dessus,
       écrans tactiles uniquement) — un trackpad envoie des événements
       "wheel" avec deltaX/deltaY, jamais des Touch. Le réglage annonçait
       "trackpad / tactile" mais seul le tactile était câblé ; ceci comble
       le trou. On regroupe les événements "wheel" rapprochés en une seule
       "rafale" (comme un seul balayage tactile) pour ne déclencher qu'une
       fois par geste, même si le trackpad envoie des dizaines d'événements
       pendant une seule glissade des doigts. */
    let wheelAccumX = 0;
    let wheelAccumY = 0;
    let wheelLastTime = 0;
    let wheelTriggered = false;
    let wheelStartClientX = 0;

    const onWheel = (e: WheelEvent) => {
      if (!this.settings.swipeGesturesEnabled) return;
      if (e.ctrlKey) return; // pincer-zoomer envoie aussi des événements wheel
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target!.closest(".cm-editor")) return;

      const now = Date.now();
      if (now - wheelLastTime > 200) {
        // Doigts reposés puis relevés depuis > 200ms : nouvelle rafale.
        wheelAccumX = 0;
        wheelAccumY = 0;
        wheelTriggered = false;
        wheelStartClientX = e.clientX;
      }
      wheelLastTime = now;
      wheelAccumX += e.deltaX;
      wheelAccumY += e.deltaY;

      if (wheelTriggered) return;
      /* Pas de zone morte comme au tactile (le curseur traîne souvent côté
         éditeur pendant qu'on écrit) — mais avec DEUX volets possibles, il
         faut malgré tout décider LEQUEL cibler : la moitié de fenêtre où le
         geste démarre tranche, sur toute la largeur, sans zone ignorée. */
      const targetsLeft = wheelStartClientX < window.innerWidth / 2;
      if (targetsLeft ? !getLeftSplit() : !getRightSplit()) return;
      // Dominante horizontale franche, sinon un simple défilement vertical
      // (deltaY) déclencherait le geste par erreur. Seuil abaissé (40, au
      // lieu de 70) : le geste se déclenche avec moins de distance.
      if (Math.abs(wheelAccumX) < 40 || Math.abs(wheelAccumX) < Math.abs(wheelAccumY) * 1.2) return;

      wheelTriggered = true;
      /* Sens du signe deltaX volontairement inversé par rapport à
         l'intuition : confirmé par test (retour utilisateur) que le sens
         "naturel" attendu était inversé sur ce trackpad. */
      if (targetsLeft) executeLeftPanel(wheelAccumX < 0);
      else executeRightPanel(wheelAccumX > 0);
    };

    /* capture:true — indispensable avec des plugins comme Notebook
       Navigator : React attache son propre gestionnaire délégué pour
       "wheel"/"touchstart"/"touchmove" en PHASE DE CAPTURE sur son
       conteneur racine (confirmé dans son bundle : addEventListener(type,
       handler, {capture:true, passive}) pour ces trois types précisément).
       Un écouteur posé en phase de bulles sur `window`, comme avant, arrive
       après coup et peut ne jamais recevoir l'événement si ce gestionnaire
       react stoppe la propagation en chemin. En capture sur `window`, on
       est les tout premiers servis, quoi que fasse un plugin plus bas dans
       l'arbre ensuite. */
    this.registerDomEvent(window, "wheel", onWheel, { passive: true, capture: true });
  }

  // --- GESTION DYNAMIQUE DES PANNEAUX SECONDAIRES ---

  isFeuilletsSidebarActive() {
    const workspace = this.app.workspace;
    const inspectorLeaves = workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS);
    if (inspectorLeaves.some((leaf) =>
      leaf.getRoot() === workspace.rightSplit && this.leafVisible(leaf)
    )) {
      return true;
    }

    if (workspace.leftSplit.collapsed) return false;
    
    const leaves = workspace.getLeavesOfType(VIEW_SIDEBAR);
    if (leaves.length === 0) return false;

    return leaves.some(leaf => {
      return leaf.getRoot() === workspace.leftSplit && this.leafVisible(leaf);
    });
  }

  async syncProjectPanelsVisibility() {
    if (this._isSyncingPanels) return;
    
    const isActive = this.isFeuilletsSidebarActive();

    if (this._lastFeuilletsActive === isActive) return;
    this._isSyncingPanels = true;
    this._lastFeuilletsActive = isActive;

    try {
      if (isActive) {
        await this.activateProjectPanels();
      } else {
        this.deactivateProjectPanels();
      }
    } finally {
      this._isSyncingPanels = false;
    }
  }

  async activateProjectPanels() {
    const workspace = this.app.workspace;
    const oldRightViews = [VIEW_RESEARCH, VIEW_NOTES, VIEW_PROPERTIES, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW];
    for (const viewType of oldRightViews) {
      workspace.getLeavesOfType(viewType).forEach((leaf) => leaf.detach());
    }

    if (workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).length === 0) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: false });
      }
    }
  }

  deactivateProjectPanels() {
    const workspace = this.app.workspace;
    workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).forEach((leaf) => leaf.detach());
    const oldRightViews = [VIEW_RESEARCH, VIEW_NOTES, VIEW_PROPERTIES, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW];
    for (const viewType of oldRightViews) {
      workspace.getLeavesOfType(viewType).forEach((leaf) => leaf.detach());
    }
  }
}

export default FeuilletsPlugin;
