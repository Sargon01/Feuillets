import {
  createProjectScope,
  createFileScope,
  createFolderScope,
  resolveCompileScopeFiles,
  type CompileScope,
} from "../services/compile-scope.js";
import { ItemView, MarkdownView, Menu, Notice, TFile, TFolder, normalizePath, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { VIEW_BOARD, VIEW_PREVIEW } from "../constants.js";
import { openFeuilletsExportSettings } from "../settings/open-export-settings.js";
import { listExportTemplates, resolveExportTemplate, updateTemplateTitlePage } from "../services/export-templates-custom.js";
import { paginateManuscript } from "../services/export-pdf.js";
import { renderManuscriptHtml, renderManuscriptHtmlWithFrontPages, FRONT_PAGE_CSS } from "../services/export-render.js";
import { templateToCss, titleRoleCss } from "../utils/export-templates.js";
import { activePresetConfig, compile, exportFile, exportWithScope, resolvedFileTitleMarkdown } from "../services/compile-export.js";
import { depthOf, getOrderedChildren, isFrontMatter, roleOfFile, roleOfFolder } from "../services/folder-structure.js";
import { compiledTitleFor, fmOf, shortTitleFor, stripFrontmatter } from "../services/frontmatter.js";
import { readTitleRoleValue, setTitleRoleValue } from "../utils/title-roles.js";
import { promptText } from "../ui/basic-modals.js";
import { t } from "../i18n/index.js";
import { mountTemplatePreview } from "../ui/template-preview.js";
import { CompileSelectionModal } from "../ui/selection-modals.js";
import { LayoutModal } from "../ui/layout-modal.js";
import {
  applyBlockSourceMarkers,
  applySourceMarkers,
  markManuscript,
  markSegments,
  SOURCE_BLOCK_PATH_ATTR,
  SOURCE_END_COL_ATTR,
  SOURCE_END_LINE_ATTR,
  SOURCE_PATH_ATTR,
  SOURCE_START_COL_ATTR,
  SOURCE_START_LINE_ATTR,
  type SourceBlockMap,
  type SourceBlockPosition,
} from "./preview-source-map.js";
import {
  findScriveningsScroller,
  findSourceScroller,
  progressWithinSection,
  SCRIVENINGS_SCENE_SELECTOR,
  scriveningsAnchor,
  scrollableAmount,
  scrollProgress,
  scrollTopForProgress,
  scrollTopWithinSection,
  SCROLL_SYNC_EPSILON_PX,
  SCROLL_SYNC_SUSPEND_MS,
  type ScrollSection,
} from "./preview-scroll-sync.js";

type PreviewCompileSegment = {
  path: string | null;
  text: string;
  frontType?: string | null;
  /** Nombre de blocs de TITRE ARTIFICIEL (titre de scène, éventuel
   * sous-titre) que PreviewView a insérés en tête de `text`, avant le corps
   * réel du feuillet — jamais deviné : c'est PreviewView qui les a générés
   * (voir sceneTitleMarkdown/partFileTitleMarkdown), donc lui seul le sait
   * avec certitude. Sert au repérage de bloc pour le clic Aperçu → éditeur
   * (voir preview-source-map.ts, applyBlockSourceMarkers). Absent (ou
   * recalculé via titleLeadingSkipFor) pour les segments issus de compile(),
   * qui ne portent pas cette information. */
  titleBlockCount?: number;
};

type PreviewCompileResult = {
  outPath: string;
  manuscript: string;
  segments: PreviewCompileSegment[];
};

type PreviewViewSettings = FeuilletsSettings & {
  exportTemplate: string;
  exportFormat?: string;
  compileFileName?: string;
  activePreset?: number;
  compilePresets?: unknown[];
  manuscriptTitle?: string;
  manuscriptAuthor?: string;
};

export type PreviewViewPlugin = {
  settings: PreviewViewSettings;
  getProjectFolder(): TFolder | null;
  /** Mêmes résolveurs que le Binder : pas de seconde logique de titre. */
  shortTitleFor?(file: TFile): string;
  projectDisplayName?(path: string): string;
  getLeafForOpeningFile?(): WorkspaceLeaf;
  /* Optionnel : la vue reste utilisable avec un plugin minimal (tests),
     mais mémorise ses réglages dès que le vrai plugin est fourni. */
  saveSettings?(): Promise<void>;
};

export type ZoomMode = "fit-width" | "fit-page" | "manual";

/** Les QUATRE usages de l'aperçu, avec un rôle strict chacun — aucun ne
 * doit empiéter sur le suivant.
 *
 * `scene` — ÉCRITURE. Le feuillet actif, et rien d'autre : pas de
 *   couverture, pas de page de titre, pas de dédicace, pas de sommaire,
 *   pas de métadonnées, pas de YAML. Le premier bloc rendu est le premier
 *   bloc du fichier, ce qui rend la synchronisation naturelle dès la
 *   première ligne. NE COMPILE PAS : lecture directe puis rendu — seul
 *   mode à s'actualiser tout seul.
 * `chapter` — LECTURE CONTINUE d'un chapitre : toutes ses scènes dans
 *   l'ordre du Binder, titres et séparateurs du gabarit, aucune page
 *   liminaire globale, aucun YAML. Ne compile pas.
 * `part` — LECTURE d'une partie : ses chapitres et leurs scènes, mêmes
 *   règles que `chapter`. Même code d'assemblage, seul le dossier de départ
 *   change. Ne compile pas.
 * `manuscript` — CONTRÔLE ÉDITORIAL : le livre entier via `compile()`,
 *   pages liminaires comprises (couverture, titre, dédicace…), pagination
 *   réelle. Coûteux : actualisation différée et regroupée. C'est le SEUL
 *   mode où l'alignement exact avec une scène est secondaire. */
export type PreviewMode = "scene" | "chapter" | "part" | "manuscript";

/** Position de lecture, exprimée indépendamment du zoom et du nombre de
 * pages : index de la première page visible + progression relative dans
 * cette page. Un `scrollTop` brut ne survivrait ni à un changement de zoom
 * ni à une repagination. */
type ScrollAnchor = { pageIndex: number; pageProgress: number };

/** Sous-ensemble de `Editor` (API publique Obsidian) réellement utilisé par
 * le clic Aperçu → éditeur — jamais `editor.cm`, jamais d'API interne. */
type PreviewEditorLike = {
  setCursor(pos: { line: number; ch: number }): void;
  scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center?: boolean): void;
  focus(): void;
  getValue(): string;
};

/** Contenu prêt à paginer, quel que soit le mode qui l'a produit. */
type PreviewSource = {
  markdown: string;
  segments: PreviewCompileSegment[] | null;
  /** Chemin de FICHIER servant de contexte à Obsidian pour résoudre les
   * embeds (`![[image.png]]`) — jamais un chemin de dossier. */
  sourcePath: string;
  title: string;
  /** Sous-titre affiché dans l'en-tête de l'onglet (chemin du feuillet). */
  subtitle: string;
};

/** Actualisation automatique du mode Scène : assez long pour ne pas rendre
 * à chaque frappe, assez court pour suivre l'écriture de près. Ce délai ne
 * déclenche JAMAIS de compilation — seulement le rendu d'un seul fichier. */
const REFRESH_DELAY_MS: Record<PreviewMode, number> = { scene: 400, chapter: 850, part: 850, manuscript: 1500 };

/** État affiché discrètement dans la barre d'outils. */
export type PreviewStatus = "fresh" | "stale" | "rendering" | "error";

const AUTO_OPEN_VISIBLE_DELAY_MS = 300;

/** Paliers proposés par le menu de zoom — assez pour couvrir l'usage, assez
 * peu pour tenir dans un menu qu'on lit d'un coup d'œil. Le zoom continu
 * reste disponible au trackpad (Cmd/Ctrl + molette). */
const ZOOM_STEPS = [75, 100, 125, 150];

/** Éléments à ne JAMAIS détourner d'un clic bloc → éditeur (voir
 * bindPreviewBlockClicks) : liens, contrôles de formulaire, contenu
 * éditable, et toutes les poignées propres à Feuillets (page de titre à
 * rôles) qui gèrent déjà leur propre clic. Sélecteurs simples uniquement
 * (pas de combinateur) — c'est tout ce que `Element.closest` a besoin de
 * comprendre ici. */
const PROTECTED_PREVIEW_CLICK_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable]",
  ".feuillets-preview-title-editable",
  ".feuillets-preview-title-controls",
  ".feuillets-preview-title-page-controls",
  "[data-fp-role]",
  "[data-title-controls]",
].join(", ");

/** Niveau de titre Markdown pour un nœud du Binder, à l'identique de
 * `compile()` : la profondeur du nœud, bornée à [1, 6]. */
function headingLevelOf(depth: number): number {
  return Math.min(Math.max(depth, 1), 6);
}

export function previewZoomModeLabel(mode: ZoomMode): string {
  if (mode === "fit-width") return t("preview.zoom.fitWidth");
  if (mode === "fit-page") return t("preview.zoom.fitPage");
  return t("preview.zoom.manual");
}

/** Sous-ensemble de Menu réellement utilisé ici. */
type MenuLike = {
  addItem(cb: (item: MenuItemLike) => void): unknown;
  addSeparator?(): unknown;
  showAtMouseEvent?(e: MouseEvent): unknown;
  showAtPosition?(pos: { x: number; y: number }): unknown;
  hide?(): unknown;
};
export function previewModeLabel(mode: PreviewMode): string {
  return t(`preview.mode.${mode}`);
}

const MODE_ORDER: PreviewMode[] = ["scene", "chapter", "part", "manuscript"];

/** Champs de la première page réellement pris en charge, dans l'ordre où ils
 * apparaissent sur la page. Chacun est un RÔLE du feuillet Front (voir
 * utils/title-roles.ts) : aucun champ n'a de stockage propre à PreviewView. */
export function previewFirstPageFields(): Array<{ label: string; role: string }> {
  return [
    { label: t("preview.firstPageField.title"), role: "titre" },
    { label: t("preview.firstPageField.subtitle"), role: "sous-titre" },
    { label: t("preview.firstPageField.author"), role: "auteur" },
    { label: t("preview.firstPageField.additionalMention"), role: "mots" },
    { label: t("preview.firstPageField.imageOrLogo"), role: "image" },
  ];
}

/** Libellé de statut dépendant du mode : « à actualiser » n'a de sens que
 * là où l'actualisation est manuelle. */
export function previewStatusLabel(status: PreviewStatus, mode: PreviewMode): string {
  if (status === "rendering") return t("preview.status.rendering");
  if (status === "error") return t("preview.status.error");
  if (status === "stale") return t("preview.status.stale", { mode: previewModeLabel(mode) });
  return t("preview.status.fresh", { mode: previewModeLabel(mode) });
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;
/** Sensibilité du zoom à la molette/au pincement : `deltaY` est converti en
 * facteur multiplicatif (exponentiel, donc symétrique — un aller-retour
 * revient exactement au point de départ). Réglée pour qu'un cran de molette
 * classique (~100) fasse environ 4 %. */
const ZOOM_WHEEL_SENSITIVITY = 0.0004;
/* Marge de sécurité (px) retranchée à la largeur/hauteur disponibles avant
 * de calculer un zoom "ajuster à la largeur/page" — évite qu'une page
 * pile-poil à la largeur du viewport touche ses bords, et absorbe l'arrondi
 * au centième du facteur de zoom. */
const VIEWPORT_SAFETY_MARGIN = 8;
/** Au-delà de cette fraction du viewport, une cible est jugée « déjà
 * visible » et le suivi ne bouge pas (évite un sautillement permanent). */
const ALREADY_VISIBLE_RATIO = 0.6;
const SCROLL_TARGET_MARGIN_PX = 24;

/** Arrondi au centième INFÉRIEUR — utilisé pour les modes automatiques :
 * `setZoom` arrondit au plus proche, ce qui peut arrondir vers le haut et
 * rendre la page 1 px plus large que l'espace disponible, donc faire
 * apparaître une barre de défilement horizontale que ces modes doivent
 * justement garantir absente. */
function floorToCent(value: number): number {
  return Math.floor(value * 100) / 100;
}

/** Somme des paddings horizontaux réels d'un élément, en px. Retourne 0 si
 * l'environnement n'expose pas getComputedStyle (tests hors navigateur). */
function horizontalPaddingOf(el: HTMLElement): number {
  if (typeof getComputedStyle !== "function") return 0;
  const style = getComputedStyle(el);
  const left = parseFloat(style.paddingLeft || "0");
  const right = parseFloat(style.paddingRight || "0");
  return (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0);
}

/** Somme des paddings verticaux réels d'un élément, en px (voir ci-dessus). */
function verticalPaddingOf(el: HTMLElement): number {
  if (typeof getComputedStyle !== "function") return 0;
  const style = getComputedStyle(el);
  const top = parseFloat(style.paddingTop || "0");
  const bottom = parseFloat(style.paddingBottom || "0");
  return (Number.isFinite(top) ? top : 0) + (Number.isFinite(bottom) ? bottom : 0);
}

/** CSS de gabarit de l'aperçu : UNE seule assemblée, utilisée par les TROIS
 * modes. Extrait en helper nommé précisément pour qu'un mode ne puisse pas
 * recevoir un style différent d'un autre — police, taille, interligne,
 * retrait, espacement, titres, citations et séparateur de scène viennent
 * tous de `templateToCss()`, le générateur partagé avec les exports PDF et
 * EPUB (jamais réécrit à la main ici).
 *
 * Limite connue, identique dans les trois modes : la TAILLE DE PAGE et les
 * MARGES de la page imprimée viennent des réglages `pdfPageSize`/`pdfMargin*`
 * appliqués par `paginateManuscript()`, pas de `marginsCm` du gabarit —
 * changer de gabarit modifie donc la typographie, pas la géométrie de page. */
export function previewTemplateCss(tpl: ResolvedExportTemplate): string {
  return templateToCss(tpl) + FRONT_PAGE_CSS + "\n" + titleRoleCss(tpl);
}

/** Un élément encore présent dans le document ? Répond « oui » quand
 * l'environnement n'expose pas `isConnected` (tests hors navigateur) : mieux
 * vaut conserver une écoute que la perdre à tort. */
function isStillAttached(el: HTMLElement): boolean {
  return typeof el.isConnected === "boolean" ? el.isConnected : true;
}

/** Échappe les guillemets d'un chemin inséré dans un sélecteur d'attribut. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Vue onglet d'aperçu, en trois usages : Scène, Chapitre, Manuscrit.
 *
 * Structure DOM (voir aussi styles.css) :
 *   contentEl
 *     .feuillets-preview-view (colonne flex)
 *       .feuillets-preview-toolbar
 *       .feuillets-preview-viewport (scrollable — SEULE source de largeur
 *                                     pour les calculs de zoom automatique)
 *         .feuillets-preview-scaled-container (centre l'iframe)
 *           iframe.feuillets-preview-frame (dimensionnée en px par JS)
 *
 * Le zoom est piloté par une SEULE variable CSS
 * (`--feuillets-preview-scale`) posée sur `iframe.contentDocument.documentElement`,
 * appliquée à un UNIQUE wrapper `.feuillets-preview-pages` dans le document
 * de l'iframe (voir ui/template-preview.ts).
 *
 * AUCUN réglage de compilation ne vit ici : format, gabarit, sélection de
 * contenu, pages de titre et notes restent la propriété exclusive du
 * onglet Export des paramètres Feuillets — l'action « Réglages du manuscrit »
 * ne fait que l'ouvrir. Une seule source de vérité.
 */
export class PreviewView extends ItemView {
  plugin: PreviewViewPlugin;

  zoomMode: ZoomMode = "fit-width";
  zoomScale = 1;

  naturalPageWidth: number | null = null;
  naturalPageHeight: number | null = null;
  naturalPagesHeight: number | null = null;

  previewFrame: HTMLIFrameElement | null = null;
  previewViewport: HTMLElement | null = null;
  scaledContainer: HTMLElement | null = null;
  viewEl: HTMLElement | null = null;
  /** Barre volontairement réduite au fil d'Ariane, au zoom et à deux icônes. */
  breadcrumbEl: HTMLElement | null = null;
  zoomLabelEl: HTMLElement | null = null;
  btnExport: HTMLElement | null = null;
  btnSettings: HTMLElement | null = null;
  exportScopeLabelEl: HTMLElement | null = null;
  openVisibleEl: HTMLElement | null = null;
  btnBarToggle: HTMLElement | null = null;
  exportPanelEl: HTMLElement | null = null;
  /** État d'interface de session uniquement ; aucun réglage d'export n'est
   * dupliqué dans PreviewView. */
  private exportPanelCollapsed = true;
  /** Corps de la sous-section « Première page », gardé en référence pour
   * pouvoir la réactualiser SEULE : inclure/exclure ou changer de fichier
   * Front ne doit pas reconstruire tout le panneau Export (portée, format,
   * gabarit…), ce qui refermerait la sous-section et déplacerait le focus
   * hors de tout contrôle. */
  private firstPageBodyEl: HTMLElement | null = null;
  private firstPageTemplates: Array<{ key: string; label: string }> = [];
  /** État repliée/dépliée de « Première page », conservé même à travers un
   * réel rebuild complet du panneau (bouton Actualiser, réouverture). */
  private firstPageOpen = false;
  statusEl: HTMLElement | null = null;
  followedEl: HTMLElement | null = null;
  /** Dernier menu ouvert — pour le refermer sur un double-clic de zoom. */
  private openMenu: MenuLike | null = null;

  /* --- Synchronisation de défilement ---------------------------------
     `syncScroller` est le VRAI élément défilable du panneau source (jamais
     la fenêtre) ; il change avec la feuille active, d'où un écouteur posé
     et retiré à la main plutôt que `registerDomEvent`. */
  syncScroller: HTMLElement | null = null;
  /** Fichier réellement suivi — affiché dans la barre du bas. */
  syncSourcePath: string | null = null;
  private syncKind: "markdown" | "scrivenings" | null = null;
  /** Conteneur du panneau Scrivening suivi, où relire ses blocs de scène. */
  private syncHost: HTMLElement | null = null;
  private syncScrollerCleanup: (() => void) | null = null;
  /** Feuillet explicitement ouvert depuis une portée de lecture. Cette
   * sélection déclenche le suivi sans transformer la portée du rendu. */
  private synchronizedFeuilletPath: string | null = null;
  /* Deux drapeaux DISTINCTS : un défilement que nous provoquons produit un
     événement `scroll` dans le panneau visé ; sans drapeau propre à chaque
     sens, cet écho relancerait immédiatement une correction en retour. */
  private syncingFromEditor = false;
  private syncingFromPreview = false;
  private lastSourceScrollAt = 0;
  private lastPreviewScrollAt = 0;
  /* Arbitrent à eux deux la confiance accordée au tampon vivant de l'éditeur
     — voir liveBufferIsTrustworthy(). */
  private lastEditorChangeAt = 0;
  private lastFileSwitchAt = 0;
  /** Vrai tant qu'un rendu emprunte `vault.cachedRead` (voir compileForPreview). */
  private cachedReadPatched = false;
  private syncJob: (() => void) | null = null;
  private syncHandle: { id: number; kind: "frame" | "timeout" } | null = null;
  private releaseHandles: Array<{ id: number; kind: "frame" | "timeout" }> = [];
  visibleFeuilletPath: string | null = null;
  private visibleFeuilletHandle: { id: number; kind: "frame" | "timeout" } | null = null;
  private autoOpenVisibleTimer: number | null = null;
  private openVisibleRequestId = 0;
  /** Reçoit l'identifiant de l'ouverture automatique qui initialise
   * l'éditeur. Son premier scroll (toujours vers le haut) ne doit surtout
   * pas être renvoyé vers l'aperçu. */
  private preservingPreviewScrollRequestId: number | null = null;

  status: PreviewStatus = "fresh";
  /** Feuillet réellement affiché (modes Scène/Chapitre) — sert d'en-tête
   * d'onglet et évite de re-rendre à l'identique. */
  displayedPath: string | null = null;

  private frameLoaded = false;
  private pendingZoom: { scale: number; mode: ZoomMode } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private compileScope: CompileScope | null = null;



  /* Dernier chemin CONCRET (dossier ou feuillet) explicitement ouvert dans
     l'Aperçu via setCompileScope(). Repère de NAVIGATION uniquement : il ne
     pilote jamais le contenu, le titre ni l'export, dont CompileScope reste
     l'unique source de vérité. En portée Projet, il permet de réafficher
     « Projet › Dossier › Feuillet » avec Projet actif — sans jamais être
     re-synchronisé sur le fichier actif d'Obsidian. `null` tant qu'aucun
     dossier/feuillet n'a été explicitement ouvert. */
  private lastScopedNav: { type: "file" | "folder"; projectRoot: string; path: string } | null = null;

  /* Jeton de génération : seul le rendu le plus récent a le droit
     d'aboutir — un résultat obsolète ne remplace jamais l'affichage. */
  private refreshGeneration = 0;
  private refreshInFlight = false;
  private rerunRequested = false;
  private pendingFrame: HTMLIFrameElement | null = null;
  private refreshTimer: number | null = null;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, plugin: PreviewViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  async setCompileScope(scope: CompileScope): Promise<void> {
    this.rememberScopedNavigation(scope);
    this.compileScope = scope;
    this.updateUI();
    await this.refreshPreview();
  }

  /**
   * Mémorise un chemin CONCRET (dossier ou feuillet) explicitement ouvert dans
   * l'Aperçu — repère de NAVIGATION uniquement, jamais une source pour le
   * contenu, le titre ni l'export, dont CompileScope reste l'unique source de
   * vérité. Quand la portée repasse au niveau Projet, ce chemin permet de
   * réafficher « Projet › Dossier › Feuillet » avec Projet actif.
   *
   * Règles :
   *  - scope file  : mémorise le feuillet (projectRoot, chemin, dossier parent).
   *  - scope folder : mémorise le dossier ; il CONSERVE le dernier feuillet
   *    mémorisé si celui-ci appartient réellement à ce dossier, sinon il
   *    remplace la mémoire par le dossier seul.
   *  - scope project / selection : NE TOUCHE RIEN — le passage au Projet garde
   *    le dernier dossier et feuillet affichés ; une sélection n'invente rien.
   */
  private rememberScopedNavigation(scope: CompileScope): void {
    if (scope.type !== "file" && scope.type !== "folder") return;
    if (scope.type === "file") {
      this.lastScopedNav = { type: "file", projectRoot: scope.projectRoot, path: scope.path };
      return;
    }
    // scope folder
    const prev = this.lastScopedNav;
    const keptInFolder =
      prev && prev.type === "file" && prev.projectRoot === scope.projectRoot && prev.path.startsWith(`${scope.path}/`);
    if (keptInFolder) {
      return;
    }
    this.lastScopedNav = { type: "folder", projectRoot: scope.projectRoot, path: scope.path };
  }

  getViewType(): string {
    return VIEW_PREVIEW;
  }

  getDisplayText(): string {
    if (this.mode === "manuscript") return t("preview.display.manuscript");
    const name = this.displayedPath ? this.displayedPath.split("/").pop() : null;
    return name
      ? t("preview.display.named", { name: name.replace(/\.md$/i, "") })
      : t("preview.display.mode", { mode: previewModeLabel(this.mode).toLowerCase() });
  }

  getIcon(): string {
    return "eye";
  }

  /* ============================ Mode ================================ */

  get mode(): PreviewMode {
    const mode = this.plugin?.settings?.previewMode;
    return MODE_ORDER.includes(mode as PreviewMode) ? (mode as PreviewMode) : "scene";
  }

  async setMode(mode: PreviewMode): Promise<void> {
    /* Un changement de mode historique ne détruit JAMAIS une portée
       CompileScope déjà établie : la portée est la source de vérité, le mode
       ne sert de repli que lorsqu'aucune portée explicite n'est posée. */
    if (this.mode === mode) return;
    this.openVisibleRequestId++;
    if (this.autoOpenVisibleTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.autoOpenVisibleTimer);
      this.autoOpenVisibleTimer = null;
    }
    const wasSheetMode = this.mode === "scene";
    this.plugin.settings.previewMode = mode;
    await this.plugin.saveSettings?.();
    if (wasSheetMode && mode !== "scene") this.stopContinuousSync(true);
    if (!wasSheetMode && mode !== "scene") this.stopContinuousSync(true);
    if (!wasSheetMode && mode === "scene") this.bindSourcePane();
    this.cancelSceneRefresh();
    this.updateUI();
    await this.renderExportPanel();
    await this.refreshPreview();
  }

  /** Le suivi est actif soit pour la compatibilité de l'ancien mode
   * Feuillet, soit après « Ouvrir ce feuillet » depuis une portée longue.
   *
   * Quand une portée CompileScope est posée, c'est ELLE qui décide, jamais
   * `previewMode` (qui peut valoir n'importe quoi, y compris "scene", pendant
   * qu'un dossier ou le projet est affiché) :
   *  - Dossier/Projet : rendu long — le suivi continu ne démarre qu'après un
   *    « Ouvrir ce feuillet » explicite, exactement comme Chapitre/Partie/
   *    Manuscrit historiques.
   *  - Feuillet : comportement d'un feuillet unique, suivi continu.
   *  - Sélection : inchangé dans ce chantier — repli sur `previewMode`. */
  get syncScrollEnabled(): boolean {
    const scope = this.compileScope;
    if (scope) {
      if (scope.type === "folder" || scope.type === "project") return this.synchronizedFeuilletPath !== null;
      if (scope.type === "file") return true;
    }
    return this.mode === "scene" || this.synchronizedFeuilletPath !== null;
  }

  /** Vrai quand l'aperçu affiche un contenu à défilement long où plusieurs
   * feuillets se succèdent — sert à détecter le feuillet visible pendant le
   * scroll. Une portée CompileScope, quand elle existe, prime sur
   * `previewMode` : Dossier et Projet s'y comportent à l'identique (règle 3),
   * une Sélection ou un Feuillet n'y entrent jamais. Sans portée, comportement
   * historique inchangé (Chapitre/Partie/Manuscrit). */
  private get isLongFormPreview(): boolean {
    const scope = this.compileScope;
    if (scope) return scope.type === "folder" || scope.type === "project";
    return this.mode === "chapter" || this.mode === "part" || this.mode === "manuscript";
  }

  /** Sous-ensemble de `isLongFormPreview` qui déclenche en plus l'ouverture
   * automatique du feuillet visible après l'arrêt du scroll. Historiquement
   * réservé à Partie/Manuscrit (Chapitre ne l'a jamais fait) ; les portées
   * Dossier/Projet en héritent intégralement (règles 2 et 3). */
  private get isAutoOpenPreview(): boolean {
    const scope = this.compileScope;
    if (scope) return scope.type === "folder" || scope.type === "project";
    return this.mode === "part" || this.mode === "manuscript";
  }

  /* ----------------------- Barre masquable --------------------------- */

  get barCollapsed(): boolean {
    return this.plugin?.settings?.previewBarCollapsed === true;
  }

  /**
   * Replie ou déplie la barre. Le mode, le zoom, la synchronisation et — le
   * plus visible — la POSITION DE LECTURE sont conservés : masquer la barre
   * change la hauteur du viewport, ce qui suffirait à faire glisser le
   * texte sous les yeux. On mémorise donc le `scrollTop` et on le repose.
   * Rien n'est re-rendu ni recompilé : c'est un simple changement de classe.
   */
  async toggleBar(): Promise<void> {
    const viewport = this.previewViewport;
    const keptScrollTop = viewport ? viewport.scrollTop : 0;

    this.plugin.settings.previewBarCollapsed = !this.barCollapsed;
    await this.plugin.saveSettings?.();
    this.updateUI();

    if (viewport) viewport.scrollTop = keptScrollTop;
    // Un mode de zoom automatique doit tenir compte de la hauteur gagnée.
    if (this.zoomMode !== "manual") this.recalculateAutoZoom();
    if (viewport) viewport.scrollTop = keptScrollTop;
  }

  /* ============================ Ouverture ============================ */

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();

    const view = container.createDiv({ cls: "feuillets-preview-view" });
    this.viewEl = view;

    /* Barre de contexte, réduite à cinq éléments : fil d'Ariane, « Ouvrir ce
       feuillet », zoom, Export et Réglages. Aucun menu « ⋯ » : ce qui n'est
       pas du contexte de lecture vit dans le panneau Export ou dans l'onglet
       Export des paramètres Feuillets. */
    const toolbar = view.createDiv({ cls: "feuillets-preview-toolbar" });
    this.breadcrumbEl = toolbar.createSpan({ cls: "feuillets-preview-breadcrumb" });
    this.openVisibleEl = this.iconBtn(toolbar, "file-edit", t("preview.openVisibleSheet"), () => void this.openVisibleFeuillet());
    this.openVisibleEl.addClass("feuillets-preview-open-visible");
    this.statusEl = view.createSpan({ cls: "feuillets-preview-status feuillets-preview-status-hidden" });
    this.followedEl = view.createSpan({ cls: "feuillets-preview-status-hidden" });

    /* UN SEUL contrôle de zoom : le pourcentage lui-même. Clic = menu,
       double-clic = retour à 100 %, Cmd/Ctrl + molette dans l'aperçu. */
    this.zoomLabelEl = this.chipBtn(toolbar, `${Math.round(this.zoomScale * 100)} %`, t("preview.zoom.tooltip"), (e) => this.openZoomMenu(e));
    this.zoomLabelEl.addClass("feuillets-preview-zoom-val");
    this.zoomLabelEl.addEventListener("dblclick", () => this.resetZoom());

    this.btnExport = this.iconBtn(toolbar, "download", t("project.compilation.exportBtn"), () => this.toggleExportPanel());
    this.btnSettings = this.iconBtn(toolbar, "settings", t("preview.exportSettings"), () => void this.openManuscriptSettings());

    this.exportPanelEl = view.createDiv({ cls: "feuillets-preview-export is-hidden" });
    await this.renderExportPanel();

    this.previewViewport = view.createDiv({ cls: "feuillets-preview-viewport" });
    this.scaledContainer = this.previewViewport.createDiv({ cls: "feuillets-preview-scaled-container" });

    /* Écoutes. AUCUNE ne peut déclencher une compilation du manuscrit
       complet : les modes Chapitre/Partie assemblent directement leur
       sous-arbre et le mode Manuscrit reste manuel. */
    this.registerEvent(this.app.workspace.on("editor-change", () => this.onEditorChange()));
    this.registerEvent(this.app.workspace.on("file-open", () => void this.onActiveFileChanged()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.onActiveFileChanged()));

    /* Défilement et zoom : posés sur le VIEWPORT et sur lui seul — rien
       n'est écouté au niveau du document, donc rien ne peut affecter le
       reste d'Obsidian. `passive: false` est indispensable pour pouvoir
       empêcher le zoom global de l'application au Cmd/Ctrl + molette. */
    this.registerDomEvent(this.previewViewport, "scroll", () => this.onPreviewScroll());
    this.registerDomEvent(this.previewViewport, "wheel", (e: WheelEvent) => this.onViewportWheel(e), { passive: false });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.zoomMode !== "manual") this.recalculateAutoZoom();
      });
      this.resizeObserver.observe(this.previewViewport);
    }

    this.bindSourcePane();
    this.updateUI();
    await this.refreshPreview();
  }

  /* ====================== Politique d'actualisation ==================== */

  private onEditorChange(): void {
    if (this.closed) return;
    const file = this.app.workspace.getActiveFile();
    if (!this.isPreviewableFile(file)) return;
    // Une frappe rend de nouveau le tampon vivant plus à jour que le cache.
    this.lastEditorChangeAt = Date.now();
    this.setStatus("stale");
    this.schedulePreviewRefresh();
  }

  /** En Feuillet, l'éditeur pilote l'aperçu. En Chapitre/Partie, l'aperçu
   * reste la référence : seul un changement de portée déclenche un rendu. */
  private async onActiveFileChanged(): Promise<void> {
    if (this.closed) return;
    /* Tout changement de feuillet périme le tampon vivant : l'éditeur peut
       annoncer le nouveau fichier en contenant encore le texte de l'ancien
       (voir liveBufferIsTrustworthy). */
    this.lastFileSwitchAt = Date.now();
    /* La feuille suivie change AVANT toute décision de rendu : même si rien
       n'est re-rendu (Chapitre/Manuscrit), le défilement doit désormais
       suivre le bon éditeur. */
    this.bindSourcePane();
    this.updateUI();

    const scope = this.compileScope;
    if (scope) {
      /* Portée FEUILLET : l'aperçu suit le feuillet actif, exactement comme le
         mode Scène dont elle est l'équivalent explicite (voir syncScrollEnabled,
         « Feuillet : comportement d'un feuillet unique »). Sans cela, une
         portée posée une fois par « Ouvrir avec aperçu » figeait l'aperçu pour
         de bon : cliquer un autre feuillet dans le Binder n'ouvre que le
         fichier, sans jamais reposer de portée, et l'aperçu restait sur le
         feuillet précédent.

         Les portées DOSSIER, PROJET et SÉLECTION ne suivent JAMAIS le fichier
         actif : leur contenu est une étendue explicitement choisie, et y ouvrir
         un feuillet ne doit pas déplacer la lecture en cours (règle 3). */
      if (scope.type === "file") {
        const active = this.app.workspace.getActiveFile();
        if (this.isPreviewableFile(active) && active.path !== scope.path) {
          await this.setCompileScope(createFileScope(scope.projectRoot, active.path));
        }
      }
      return;
    }

    if (this.mode === "scene") {
      const file = this.app.workspace.getActiveFile();
      const path = file instanceof TFile ? file.path : null;
      if (path === this.displayedPath) return;
      await this.refreshPreview();
      return;
    }
    if (this.mode === "chapter" || this.mode === "part") {
      const active = this.app.workspace.getActiveFile();
      const scope = this.scopeForMode(this.mode, active);
      if (scope && scope.path !== this.displayedPath) {
        await this.refreshPreview();
        return;
      }
    }
    // Même portée : ouvrir le fichier ne déplace pas la lecture en cours.
  }

  private schedulePreviewRefresh(): void {
    if (this.closed || typeof window === "undefined") return;
    this.cancelSceneRefresh();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (Date.now() - this.lastPreviewScrollAt < SCROLL_SYNC_SUSPEND_MS) {
        this.schedulePreviewRefresh();
        return;
      }
      void this.refreshPreview();
    }, REFRESH_DELAY_MS[this.mode]);
  }

  private cancelSceneRefresh(): void {
    if (this.refreshTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /* ====================== Sélection du contenu ======================== */

  private isPreviewableFile(file: unknown): file is TFile {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const root = this.plugin?.getProjectFolder();
    if (!root) return false;
    return file.path === root.path || file.path.startsWith(`${root.path}/`);
  }

  /** Dossier Chapitre réel du Binder. Ne transforme jamais un dossier Partie
   * en chapitre par défaut : son absence est une information de hiérarchie. */
  chapterFolderOf(file: unknown): TFolder | null {
    if (!(file instanceof TFile)) return null;
    const settings = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    if (!root) return null;

    const ancestors: TFolder[] = [];
    let folder: TFolder | null = file.parent;
    while (folder && folder.path !== root.path) {
      ancestors.push(folder);
      folder = folder.parent;
    }
    if (!ancestors.length) return null;

    for (const candidate of ancestors) {
      if (roleOfFolder(this.app, settings, candidate) === "chapitre") return candidate;
    }
    return null;
  }

  /** Portée à afficher : un Chapitre peut être un dossier ou un feuillet
   * unique ; une Partie est nécessairement un dossier Binder. */
  private scopeForMode(mode: "chapter" | "part", file: unknown): TFolder | TFile | null {
    if (!(file instanceof TFile)) return null;
    if (mode === "part") return this.partFolderOf(file);
    return this.chapterFolderOf(file) || (roleOfFile(this.app, this.plugin.settings, file) === "chapitre" ? file : null);
  }

  /* =========== Contenu à jour : tampon vivant plutôt que le disque ========
   * `vault.cachedRead()`/`vault.read()` reflètent le fichier tel qu'Obsidian
   * l'a écrit en cache — avec le retard propre à SON cycle interne
   * d'enregistrement (pas le nôtre : aucun debounce ajouté ici). C'est
   * précisément ce retard qui rendait l'Aperçu « en retard d'une frappe » :
   * la dernière frappe existe déjà dans `MarkdownView.editor.getValue()`
   * avant d'exister dans le cache disque. Quand le feuillet à lire est
   * ACTUELLEMENT ouvert dans un éditeur, on lit donc ce tampon — jamais une
   * écriture, jamais `editor.cm`, jamais d'API privée. Les autres feuillets
   * (non ouverts) gardent `cachedRead()`, inchangé. */

  /** Éditeur Markdown ouvert sur CE fichier précis, s'il en existe un —
   * n'importe lequel des panneaux ouverts, pas seulement le panneau actif :
   * en portée Dossier/Projet, le feuillet en cours d'écriture n'est pas
   * forcément la feuille au focus au moment du rafraîchissement. */
  private editorForFile(file: TFile): PreviewEditorLike | null {
    const workspace = this.app.workspace as unknown as {
      getLeavesOfType?(type: string): Array<{ view?: { file?: unknown; editor?: PreviewEditorLike } }>;
    };
    for (const leaf of workspace.getLeavesOfType?.("markdown") || []) {
      const view = leaf?.view;
      if (view?.file instanceof TFile && view.file.path === file.path && typeof view.editor?.getValue === "function") {
        return view.editor;
      }
    }
    return null;
  }

  /** Le tampon vivant n'est DIGNE DE CONFIANCE que si l'utilisatrice a tapé
   * depuis le dernier changement de feuillet.
   *
   * `editorForFile` reconnaît un éditeur par `view.file.path`. Or, pendant un
   * changement de fichier, Obsidian met `view.file` à jour AVANT que le
   * document CodeMirror n'ait été remplacé : l'éditeur se présente donc comme
   * celui du nouveau feuillet tout en contenant encore le texte de l'ANCIEN.
   * Lire `editor.getValue()` dans cette fenêtre produit un document hybride —
   * titre et métadonnées du bon feuillet (ils viennent du MetadataCache),
   * corps d'un autre (défaut constaté : titre « Al-Malik », corps d'« Ar-Rahim »).
   *
   * Le tampon vivant n'existe que pour une raison : rendre la DERNIÈRE FRAPPE
   * visible sans attendre le cycle d'enregistrement d'Obsidian. Ce besoin
   * n'existe donc que lorsqu'on vient de taper. Hors de ce cas, `cachedRead()`
   * est à la fois suffisant et sûr. */
  private liveBufferIsTrustworthy(): boolean {
    return this.lastEditorChangeAt > this.lastFileSwitchAt;
  }

  /** Contenu à utiliser pour LE RENDU de l'Aperçu : le tampon vivant quand il
   * est digne de confiance (voir ci-dessus), `cachedRead()` sinon. */
  private async readFileForPreview(
    file: TFile,
    fallbackRead: (file: TFile) => Promise<string> = (f) => this.app.vault.cachedRead(f)
  ): Promise<string> {
    if (this.liveBufferIsTrustworthy()) {
      const editor = this.editorForFile(file);
      if (editor) return editor.getValue();
    }
    return fallbackRead(file);
  }

  /** Exécute `run` (un appel à `compile()`) avec `vault.cachedRead` posé sur
   * `readFileForPreview` le temps de l'appel, puis restaure IMMÉDIATEMENT la
   * méthode d'origine — `try/finally`, jamais laissée en place. `compile()`
   * (services/compile-export.ts) n'est pas modifié : c'est le SEUL point
   * d'entrée qu'il expose vers le disque (`readBody` n'appelle que
   * `vault.cachedRead`), donc le seul endroit où brancher un tampon vivant
   * sans dupliquer sa pipeline de transformation (typographie, notes,
   * wikiliens) — la dupliquer aurait été la vraie « devinette » interdite.
   * N'affecte JAMAIS un export réel : `exportWithScope`/`exportFile`
   * appellent `compile()` par un chemin totalement séparé, jamais à travers
   * ce wrapper. Ne délégüe à `readFileForPreview` QUE pour un feuillet
   * réellement ouvert dans un éditeur (voir `editorForFile`) — pour tout
   * autre fichier, le comportement de `cachedRead` reste EXACTEMENT le
   * même : aucun effet de bord visible pour un appelant tiers pendant cette
   * fenêtre. */
  private async compileForPreview<T>(run: () => Promise<T>): Promise<T> {
    const vault = this.app.vault;
    /* Réentrance : si un rendu est déjà en train d'emprunter `cachedRead`, ne
       PAS reposer un second patch par-dessus. Le `finally` du plus interne
       restaurerait sinon le wrapper de l'externe au lieu de la méthode
       d'origine, laissant `vault.cachedRead` définitivement enveloppé — une
       fuite qui survit à la fermeture de l'aperçu. */
    if (this.cachedReadPatched) return run();
    const original: (file: TFile) => Promise<string> = vault.cachedRead.bind(vault);
    this.cachedReadPatched = true;
    // `original` explicitement en repli : `vault.cachedRead` DÉSIGNE la
    // version posée ici tant que le patch est en place — s'appuyer sur
    // `this.app.vault.cachedRead` dans le repli rappellerait cette même
    // fonction et boucle indéfiniment sur elle-même (repli implicite = auto-référence).
    vault.cachedRead = (file: TFile) => this.readFileForPreview(file, original);
    try {
      return await run();
    } finally {
      vault.cachedRead = original;
      this.cachedReadPatched = false;
    }
  }

  /** Assemble le contenu à afficher selon le mode. Renvoie `null` avec un
   * message affiché si le mode ne peut rien montrer. */
  private async collectSource(generation: number): Promise<PreviewSource | null> {
    const settings = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    if (!root) {
      this.showMessage("feuillets-preview-error", t("modal.pdfStyle.selectActiveProject"));
      return null;
    }

    /* Portée CAPTURÉE une seule fois pour toute la durée de ce rendu. La
       relire à chaque étape était une course : `collectSource` traverse
       plusieurs `await`, et un changement de feuillet survenu entre-temps
       (chaque `file-open` en déclenche désormais un) faisait résoudre la
       liste de fichiers avec une portée et compiler avec une AUTRE. */
    const activeScope = this.compileScope;
    if (activeScope) {
      const files = resolveCompileScopeFiles(this.app, settings, activeScope);
      if (!files.length) {
        this.showMessage("feuillets-preview-empty", t("preview.message.emptyScope"));
        return null;
      }
      /* MÊME génération de contenu que l'export : on passe par compile()
         avec la portée CompileScope et { writeOutput: false } — aucun
         fichier n'est posé dans _Sortie, et la page de titre (et les pages
         Front en général) est rendue comme une VRAIE page Front grâce aux
         segments, au lieu d'arriver en texte Markdown brut. Le corps
         réassemblé à la main ici avait ce défaut. */
      let result: PreviewCompileResult | null = null;
      result = await this.compileForPreview(() =>
        compile(this.app, settings, null, activeScope, undefined, { writeOutput: false })
      );
      if (generation !== this.refreshGeneration) return null;
      if (!result) {
        this.showMessage("feuillets-preview-error", t("preview.message.emptyCompilation"));
        return null;
      }
      const firstScene = result.segments?.find((s) => s.path)?.path;
      return {
        markdown: result.manuscript,
        segments: result.segments,
        sourcePath: firstScene || root.path,
        title: settings.manuscriptTitle || root.name,
        subtitle: t("preview.subtitle.scope", { scope: activeScope.type }),
      };
    }

    if (this.mode === "manuscript") {
      let result: PreviewCompileResult | null = null;
      /* L'Aperçu ne doit JAMAIS écrire dans _Sortie : seul le bouton d'export
         explicite a le droit de poser les fichiers de sortie. On compile donc
         en mémoire ({ writeOutput: false }) — le moteur est le même que
         l'export, seuls les effets de bord diffèrent. */
      result = await this.compileForPreview(() =>
        compile(this.app, settings, null, null, undefined, { writeOutput: false })
      );
      if (generation !== this.refreshGeneration) return null;
      if (!result) {
        this.showMessage("feuillets-preview-error", t("preview.message.emptyCompilation"));
        return null;
      }
      const firstScene = result.segments?.find((s) => s.path)?.path;
      return {
        markdown: result.manuscript,
        segments: result.segments,
        sourcePath: firstScene || root.path,
        title: settings.manuscriptTitle || root.name,
        subtitle: t("preview.subtitle.completeManuscript"),
      };
    }

    const active = this.app.workspace.getActiveFile();
    if (!this.isPreviewableFile(active)) {
      this.showMessage(
        "feuillets-preview-empty",
        t("preview.message.noOpenSheet")
      );
      return null;
    }

    if (this.mode === "scene") {
      /* ÉCRITURE : le corps du feuillet, et rien d'autre.
         `stripFrontmatter` est le helper CENTRAL, celui-là même qu'utilise
         la compilation — sans lui, le YAML n'était pas seulement « visible »
         : rendu en Markdown, `---\ntitle: X\n---` produit un <hr> suivi d'un
         TITRE setext <h2>, et `paginateManuscript` force un saut de page
         avant tout h1/h2. Le premier mot du feuillet se retrouvait donc
         page 2 alors que l'éditeur était ligne 1 : c'était LA cause du
         décalage constaté, pas une page de titre. */
      const body = stripFrontmatter(await this.readFileForPreview(active)).trim();
      const title = this.sceneTitleMarkdown(active, 1);
      return {
        markdown: title ? `${title}\n\n${body}` : body,
        /* PAS de segment ici, volontairement : le mode Scène rend le texte
           directement (`renderManuscriptHtml`, branche `else` ci-dessous),
           sans passer par `markManuscript`/`applySourceMarkers` — un test de
           régression (« mode Scène — le feuillet SEUL ») vérifie que le
           Markdown transmis au moteur de rendu est EXACTEMENT `markdown`
           ci-dessus, rien d'ajouté. Conséquence assumée : le clic bloc →
           éditeur (preview-source-map.ts) ne fonctionne pas encore en mode
           Scène — limite explicite de cette première version (voir rapport).
           Sans grand enjeu pratique : en Scène, l'aperçu EST déjà le
           feuillet actif dans l'éditeur. */
        segments: null,
        sourcePath: active.path,
        title: this.binderFileTitle(active),
        subtitle: active.path,
      };
    }

    // --- Modes Chapitre et Partie ----------------------------------------
    const scope = this.scopeForMode(this.mode, active);
    if (!scope) {
      this.showMessage(
        "feuillets-preview-empty",
        this.mode === "part"
          ? t("preview.message.noPart")
          : t("preview.message.noChapter")
      );
      return null;
    }

    if (scope instanceof TFile) return this.collectSingleFileSource(scope);

    const segments = await this.assembleFolder(scope);
    if (!segments.length) {
      this.showMessage("feuillets-preview-empty", t("preview.message.emptyFolder", { name: scope.name }));
      return null;
    }
    const separator = activePresetConfig(settings).separator || "\n\n";
    const firstScene = segments.find((seg) => seg.path)?.path;
    return {
      markdown: segments.map((seg) => seg.text).join(separator),
      segments,
      sourcePath: firstScene || scope.path,
      title: scope.name,
      subtitle: scope.path,
    };
  }

  /** Un chapitre peut être stocké dans un seul feuillet : il reste une
   * portée Chapitre valide, sans inventer de scènes enfants. */
  private async collectSingleFileSource(file: TFile): Promise<PreviewSource> {
    const body = stripFrontmatter(await this.readFileForPreview(file)).trim();
    const title = this.sceneTitleMarkdown(file, 1);
    const text = title ? `${title}\n\n${body}` : body;
    return {
      markdown: text,
      segments: [{ path: file.path, text, frontType: null, titleBlockCount: title ? 1 : 0 }],
      sourcePath: file.path,
      title: this.binderFileTitle(file),
      subtitle: file.path,
    };
  }

  /** Titre d'un feuillet tel que la COMPILATION l'insérerait — donc rien du
   * tout si le preset ne demande pas de titre (`insertSceneTitles`, faux par
   * défaut) ou si le feuillet n'en déclare pas. L'aperçu n'invente jamais un
   * titre que l'export n'aurait pas. */
  private sceneTitleMarkdown(file: TFile, level: number): string | null {
    if (!activePresetConfig(this.plugin.settings).sceneTitles) return null;
    const title = compiledTitleFor(this.app, file);
    return title ? `${"#".repeat(Math.min(level, 6))} ${title}` : null;
  }

  /** Résolution des titres de feuillet en mode Partie. Elle reprend la
   * hiérarchie de la compilation : Markdown déjà écrit, puis YAML, puis
   * Binder pour le titre seul. Les niveaux Markdown font appliquer le CSS
   * du gabarit actif, comme dans le Manuscrit. */
  private partFileTitleMarkdown(file: TFile, body: string, level: number): string | null {
    const preset = activePresetConfig(this.plugin.settings);
    const role = roleOfFile(this.app, this.plugin.settings, file);
    return resolvedFileTitleMarkdown(
      this.app, file, body, role === "scene" ? preset.sceneTitles : preset.chapterTitles, level, this.binderFileTitle(file)
    );
  }

  /**
   * Assemble un dossier du Binder (chapitre OU partie) en segments prêts à
   * rendre. UN SEUL code pour les deux modes : seul le dossier de départ
   * change, jamais les règles.
   *
   * Applique les mêmes règles de présentation que `compile()` (ordre du
   * Binder, titres de dossier selon le preset, feuillets `compile: false`
   * ignorés), restreintes à un sous-arbre — mais SANS rien compiler ni
   * écrire, et sans aucune page liminaire globale : le dossier Front
   * (couverture, page de titre, dédicace, épigraphe) est explicitement
   * exclu, il n'appartient à aucun chapitre ni à aucune partie.
   */
  private async assembleFolder(folder: TFolder): Promise<PreviewCompileSegment[]> {
    const settings = this.plugin.settings;
    const preset = activePresetConfig(settings);
    const segments: PreviewCompileSegment[] = [];

    const walk = async (current: TFolder): Promise<void> => {
      for (const child of getOrderedChildren(this.app, settings, current)) {
        if (child instanceof TFolder) {
          if (isFrontMatter(this.app, settings, child)) continue; // pages liminaires : hors sujet ici
          const role = roleOfFolder(this.app, settings, child);
          const wantTitle = role === "partie" ? preset.folderTitles : preset.chapterTitles;
          if (wantTitle) {
            /* MÊME niveau de titre que la compilation : `compile()` pose
               `#`.repeat(profondeur du nœud) — une partie de niveau 1 en H1,
               son chapitre en H2. Diverger d'un cran donnerait à l'aperçu
               une hiérarchie que l'export n'a pas. */
            segments.push({ text: `${"#".repeat(headingLevelOf(depthOf(this.app, settings, child)))} ${child.name}`, path: null, frontType: null });
          }
          await walk(child);
        } else if (child instanceof TFile && child.extension === "md") {
          if (isFrontMatter(this.app, settings, child)) continue;
          if (fmOf(this.app, child).compile === false) continue;
          // Nettoyage feuillet PAR feuillet, avant tout assemblage : jamais
          // « concaténer puis retirer le premier frontmatter ».
          const body = stripFrontmatter(await this.readFileForPreview(child)).trim();
          if (!body) continue;
          const level = headingLevelOf(depthOf(this.app, settings, child));
          const title = this.mode === "part"
            ? this.partFileTitleMarkdown(child, body, level)
            : this.sceneTitleMarkdown(child, level);
          segments.push({
            text: title ? `${title}\n\n${body}` : body,
            path: child.path,
            frontType: null,
            // `title` peut contenir un sous-titre (`resolvedFileTitleMarkdown`,
            // mode Partie) : autant de blocs de titre artificiels que de
            // paragraphes séparés par une ligne vide.
            titleBlockCount: title ? title.split("\n\n").length : 0,
          });
        }
      }
    };

    await walk(folder);
    return segments;
  }

  /* =================== Repérage de bloc (clic Aperçu → éditeur) ==========
   * Voir preview-source-map.ts (applyBlockSourceMarkers) pour l'explication
   * d'ensemble. Ce qui suit ne fait QUE rassembler, pour renderPreviewSource,
   * les deux informations qu'applyBlockSourceMarkers ne peut pas deviner
   * elle-même : les positions RÉELLES (MetadataCache) et le nombre de blocs
   * de titre artificiels insérés devant chaque feuillet. */

  /** Sections réelles d'un feuillet, dans l'ordre du fichier, frontmatter
   * YAML exclu — jamais recalculées depuis le texte rendu. `null` si le
   * cache n'a rien à offrir (fichier non indexé, par exemple juste créé). */
  private realSectionsFor(file: TFile): SourceBlockPosition[] {
    const sections = this.app.metadataCache.getFileCache(file)?.sections;
    if (!sections || !sections.length) return [];
    return sections
      .filter((section) => section.type !== "yaml")
      .map((section) => ({
        start: { line: section.position.start.line, col: section.position.start.col },
        end: { line: section.position.end.line, col: section.position.end.col },
      }));
  }

  /** Nombre de blocs de titre artificiel qu'un feuillet issu de `compile()`
   * (portée `compileScope`, ou mode Manuscrit) a reçus — recalculé avec
   * EXACTEMENT les mêmes entrées que `compile-export.ts` (`pushFile`) :
   * même sélecteur de rôle, même profondeur, même `resolvedFileTitleMarkdown`.
   * Les transformations de compilation (typographie, notes, wikiliens)
   * n'ajoutent ni ne retirent de ligne de titre : elles ne changent donc
   * jamais ce décompte, seul le texte affiché. Pour les segments que
   * PreviewView construit lui-même (Scène/Chapitre/Partie), ce recalcul
   * n'est jamais utilisé : `titleBlockCount` est déjà connu avec certitude
   * (voir assembleFolder/collectSingleFileSource/collectSource). */
  private async titleLeadingSkipFor(file: TFile): Promise<number> {
    const settings = this.plugin.settings;
    const preset = activePresetConfig(settings);
    const role = roleOfFile(this.app, settings, file);
    const wantTitle = role === "scene" ? preset.sceneTitles : preset.chapterTitles;
    const depth = depthOf(this.app, settings, file);
    const body = stripFrontmatter(await this.readFileForPreview(file)).trim();
    const title = resolvedFileTitleMarkdown(this.app, file, body, wantTitle, depth + 1);
    return title ? title.split("\n\n").length : 0;
  }

  /** Repères de bloc par feuillet, prêts pour `applyBlockSourceMarkers`. Les
   * pages Front (`frontType` non nul — page de titre, dédicace…) sont
   * exclues : elles ont leur propre édition dédiée dans l'aperçu (rôles
   * `:::rôle:`), pas un clic bloc-par-bloc sur du texte ordinaire. */
  private async buildBlocksByPath(
    segments: PreviewCompileSegment[] | null
  ): Promise<Map<string, SourceBlockMap>> {
    const map = new Map<string, SourceBlockMap>();
    if (!segments) return map;
    for (const seg of segments) {
      if (!seg.path || seg.frontType) continue;
      if (map.has(seg.path)) continue; // un feuillet n'apparaît qu'une fois
      const file = this.app.vault.getAbstractFileByPath(seg.path);
      if (!(file instanceof TFile)) continue;
      const sections = this.realSectionsFor(file);
      if (!sections.length) continue;
      const leadingSkip = typeof seg.titleBlockCount === "number"
        ? seg.titleBlockCount
        : await this.titleLeadingSkipFor(file);
      map.set(seg.path, { leadingSkip, sections });
    }
    return map;
  }

  /** Dossier-PARTIE auquel appartient un feuillet : l'ancêtre de rôle
   * « partie » le plus proche de la racine du projet (une partie contient
   * des chapitres, jamais l'inverse). `null` quand le projet n'a pas de
   * niveau Partie — c'est le cas dès que `level1Role` vaut « chapitres » :
   * on le dit alors clairement plutôt que d'afficher un chapitre en se
   * faisant passer pour une partie. */
  partFolderOf(file: unknown): TFolder | null {
    if (!(file instanceof TFile)) return null;
    const settings = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    if (!root) return null;

    let found: TFolder | null = null;
    let folder: TFolder | null = file.parent;
    while (folder && folder.path !== root.path) {
      if (roleOfFolder(this.app, settings, folder) === "partie") found = folder;
      folder = folder.parent;
    }
    return found;
  }

  /** Feuillets d'un chapitre, dans l'ordre du Binder, sous-dossiers
   * compris. `getOrderedChildren` est la primitive partagée avec le Binder,
   * le Tableau et `compile()` — diverger d'elle serait un bug. */
  orderedScenesOf(chapter: TFolder): TFile[] {
    const out: TFile[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of getOrderedChildren(this.app, this.plugin.settings, folder)) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") out.push(child);
      }
    };
    walk(chapter);
    return out;
  }

  /* ========================= Rendu commun ============================= */

  /** Produit l'aperçu du mode courant. Ne vide JAMAIS la zone défilable au
   * préalable : la nouvelle iframe est chargée en coulisse pendant que
   * l'ancienne reste affichée, puis échangée d'un coup — le `scrollTop`
   * n'est donc jamais borné à 0 par le navigateur et la position est
   * restaurée après l'échange. */
  async refreshPreview(): Promise<void> {
    if (this.closed || !this.scaledContainer) return;

    /* File à UNE SEULE tâche : plusieurs demandes pendant un rendu ne
       produisent qu'un seul rejeu, avec l'état le plus récent. */
    if (this.refreshInFlight) {
      this.rerunRequested = true;
      return;
    }

    const generation = ++this.refreshGeneration;
    this.refreshInFlight = true;
    this.cancelSceneRefresh();
    const anchor = this.captureScrollAnchor();
    this.setStatus("rendering");

    const finish = (status: PreviewStatus) => {
      if (generation !== this.refreshGeneration) return;
      this.refreshInFlight = false;
      this.setStatus(status);
      if (this.rerunRequested && !this.closed) {
        this.rerunRequested = false;
        void this.refreshPreview();
      }
    };

    /* Toute la suite (résolution du gabarit, rendu Markdown, pagination,
       montage de l'iframe) était auparavant HORS de tout try/catch : une
       exception à n'importe laquelle de ces étapes (gabarit personnalisé
       invalide, image cassée, note de bas de page malformée…) sortait de
       refreshPreview() sans jamais appeler finish() — refreshInFlight
       restait bloqué à true pour de bon. Conséquence observée : le bouton
       Actualiser (et tout rafraîchissement automatique) ne faisait plus
       rien du tout jusqu'à fermer puis rouvrir l'onglet, la seule façon de
       réinitialiser une nouvelle instance de la vue. Ce bloc englobant
       garantit que finish() est TOUJOURS appelé, quoi qu'il arrive. */
    try {
      let source: PreviewSource | null = null;
      try {
        source = await this.collectSource(generation);
      } catch (e: unknown) {
        if (generation !== this.refreshGeneration) return;
        const msg = e instanceof Error ? e.message : String(e);
        this.showMessage("feuillets-preview-error", t("preview.message.renderError", { message: msg }));
        finish("error");
        return;
      }

      if (generation !== this.refreshGeneration) return;
      if (!source) {
        finish("error");
        return;
      }

      await this.renderPreviewSource(source, generation, anchor, finish);
    } catch (e: unknown) {
      if (generation !== this.refreshGeneration) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Feuillets : échec du rendu de l'aperçu", e);
      this.showMessage("feuillets-preview-error", t("preview.message.renderError", { message: msg }));
      finish("error");
    }
  }

  /** Cœur du rendu, isolé pour que `refreshPreview()` puisse l'englober
   * entièrement dans un seul try/catch (voir son commentaire) — aucune
   * étape d'ici, si elle échoue, ne doit pouvoir laisser refreshInFlight
   * bloqué. `finish("fresh")` reste appelé depuis le callback `onLoad` de
   * l'iframe, pas ici : le rendu n'est vraiment terminé qu'une fois l'iframe
   * chargée. */
  private async renderPreviewSource(
    source: PreviewSource,
    generation: number,
    anchor: ScrollAnchor | null,
    finish: (status: PreviewStatus) => void
  ): Promise<void> {
    const settings = this.plugin.settings;
    const author = settings.manuscriptAuthor || "";
    const tpl = await resolveExportTemplate(this.app, settings, settings.exportTemplate);
    // Même CSS de gabarit pour Scène, Chapitre et Manuscrit (voir helper).
    const css = previewTemplateCss(tpl) + (this.mode === "manuscript" ? `
.feuillets-preview-title-editable {
  cursor: pointer;
  border-radius: 3px;
  transition: outline-color 120ms ease;
}
.feuillets-preview-title-editable:hover,
.feuillets-preview-title-editable:focus-visible,
.feuillets-preview-title-editable.is-title-selected {
  outline: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
  outline-offset: 4px;
}
.feuillets-preview-title-controls {
  position: absolute;
  z-index: 4;
  display: none;
  gap: 2px;
  opacity: .82;
}
.feuillets-preview-title-editable.is-title-selected + .feuillets-preview-title-controls,
.feuillets-preview-title-controls:hover,
.feuillets-preview-title-controls:focus-within { display: inline-flex; }
.feuillets-preview-title-controls button,
.feuillets-preview-title-controls button:hover,
.feuillets-preview-title-controls button:focus {
  width: 22px; height: 22px; padding: 3px;
  color: inherit; background: transparent; border: 0; box-shadow: none;
}
.feuillets-preview-title-controls .is-dragging { cursor: grabbing; }
.feuillets-preview-title-page-controls {
  position: absolute; top: 10px; right: 10px; z-index: 3;
  display: flex; gap: 3px; opacity: 0;
  transition: opacity 120ms ease;
}
.feuillets-frontpage-titre { position: relative; }
.feuillets-frontpage-titre:hover .feuillets-preview-title-page-controls,
.feuillets-preview-title-page-controls:focus-within { opacity: .72; }
.feuillets-preview-title-page-controls button,
.feuillets-preview-title-page-controls button:hover,
.feuillets-preview-title-page-controls button:focus {
  width: 24px; height: 24px; padding: 3px;
  color: inherit; background: transparent; border: 0; box-shadow: none;
}
` : "");

    /* Repères de source (voir preview-source-map.ts) : utiles seulement là
       où plusieurs feuillets coexistent dans le rendu — en mode Scène il
       n'y a rien à retrouver, l'aperçu EST le feuillet actif. */
    let containerEl: HTMLElement;
    let footnotes: Array<{ id: string; html: string; text: string }>;
    if (source.segments && source.segments.length) {
      const separator = activePresetConfig(settings).separator || "\n\n";
      const rendered = await renderManuscriptHtmlWithFrontPages(
        this.app,
        markManuscript(source.segments, separator),
        markSegments(source.segments),
        source.sourcePath
      );
      containerEl = rendered.containerEl;
      footnotes = rendered.footnotes;
      if (generation !== this.refreshGeneration) return;
      /* Repères de BLOC (clic Aperçu → éditeur, voir preview-source-map.ts)
         AVANT applySourceMarkers : ce dernier retire les marqueurs dont
         applyBlockSourceMarkers a encore besoin pour délimiter chaque
         feuillet. `buildBlocksByPath` peut relire un fichier
         (titleLeadingSkipFor) : reconfirmer la génération après l'attente. */
      const blocksByPath = await this.buildBlocksByPath(source.segments);
      if (generation !== this.refreshGeneration) return;
      applyBlockSourceMarkers(containerEl, blocksByPath);
      applySourceMarkers(containerEl);
    } else {
      const rendered = await renderManuscriptHtml(this.app, source.markdown, source.sourcePath);
      containerEl = rendered.containerEl;
      footnotes = rendered.footnotes;
      if (generation !== this.refreshGeneration) return;
    }

    /* Page de titre générique : seulement pour le manuscrit complet, et
       seulement si l'autrice n'a pas composé la sienne. Une scène ou un
       chapitre n'ont pas à recevoir le titre du livre. */
    if (this.mode === "manuscript") {
      const hasAuthoredTitlePage = !!source.segments?.some((s) => s.frontType === "titre");
      /* Une page de titre EXCLUE ne doit pas être remplacée par une page
         générée : l'exclusion serait sans effet visible. Le repli générique
         ne sert donc qu'aux projets qui n'ont aucun feuillet Front de titre. */
      if (!hasAuthoredTitlePage && !this.frontTitleCandidates().length) {
        const titlePage = createDiv({ cls: "feuillets-frontpage feuillets-frontpage-titre feuillets-frontpage-generated" });
        const titleEl = titlePage.createEl("h1", { text: source.title });
        titleEl.setAttribute("data-fp-role", "titre");
        if (author) {
          const authorEl = titlePage.createEl("p", { cls: "pdf-author-title", text: author });
          authorEl.setAttribute("data-fp-role", "auteur");
        }
        containerEl.prepend(titlePage);
      }
    }

    const { pagesHtml } = paginateManuscript(containerEl, footnotes, settings, tpl, source.title, author);
    if (generation !== this.refreshGeneration) return;

    this.displayedPath = this.mode === "manuscript" ? null : source.subtitle;
    this.updateUI();

    // `this.scaledContainer` peut en théorie devenir null entre-temps (fermeture
    // de l'onglet pendant un rendu en vol) — la vérification faite au tout début
    // de refreshPreview() ne se propage plus ici, méthode séparée oblige.
    if (!this.scaledContainer) return;
    this.pendingFrame?.remove();
    const frame = mountTemplatePreview(
      this.scaledContainer,
      css,
      pagesHtml,
      this.zoomScale,
      this.mode,
      (loadedFrame) => {
        this.onFrameLoad(generation, loadedFrame, anchor);
        finish("fresh");
      }
    );
    // Masquée le temps du chargement UNIQUEMENT s'il y a déjà une iframe
    // affichée à ne pas perturber (classe plutôt que style en dur —
    // règle obsidianmd/no-static-styles-assignment).
    if (this.previewFrame) frame.addClass("is-preview-frame-loading");
    this.pendingFrame = frame;
  }

  private onFrameLoad(generation: number, frame: HTMLIFrameElement, anchor: ScrollAnchor | null): void {
    if (generation !== this.refreshGeneration) {
      frame.remove();
      if (this.pendingFrame === frame) this.pendingFrame = null;
      return;
    }

    if (this.previewFrame && this.previewFrame !== frame) this.previewFrame.remove();
    this.previewFrame = frame;
    this.pendingFrame = null;
    frame.removeClass("is-preview-frame-loading");
    this.frameLoaded = true;

    this.measureNaturalDimensions();

    if (this.pendingZoom) {
      const { scale, mode } = this.pendingZoom;
      this.pendingZoom = null;
      this.zoomMode = mode;
      this.zoomScale = scale;
      this.applyZoomToFrame(scale);
      this.updateUI();
    } else if (this.zoomMode === "manual") {
      this.applyZoomToFrame(this.zoomScale);
      this.updateUI();
    } else {
      this.recalculateAutoZoom();
    }

    this.restoreScrollAnchor(anchor);
    this.bindInteractiveTitlePage();
    this.bindPreviewBlockClicks(frame);
    if (this.syncScrollEnabled) {
      this.bindSourcePane();
      this.applySourceToPreview();
    } else {
      this.updateVisibleFeuillet();
    }
  }

  /* =================== Clic dans l'Aperçu → éditeur =====================
   * Navigation EXPLICITE (contrairement au défilement automatique) : rien
   * n'empêche l'éditeur de prendre le focus, c'est même le but. Un seul
   * écouteur, posé par délégation sur le DOCUMENT de l'iframe à chaque
   * chargement — la précédente iframe est de toute façon détachée (voir
   * onFrameLoad), inutile de désabonner quoi que ce soit. */

  /** Installe le gestionnaire de clic délégué. Sans effet si l'iframe n'a
   * pas de `contentDocument` exploitable (sandbox trop strict, iframe déjà
   * détachée). */
  private bindPreviewBlockClicks(frame: HTMLIFrameElement): void {
    const doc = frame.contentDocument;
    if (!doc || typeof doc.addEventListener !== "function") return;
    doc.addEventListener("click", (event: MouseEvent) => this.onPreviewBlockClick(event));
  }

  private onPreviewBlockClick(event: { target: unknown; preventDefault(): void }): void {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;

    // Liens, boutons, champs, contrôles Feuillets : jamais détournés — ils
    // gèrent déjà leur propre clic (ou n'en ont volontairement aucun).
    if (target.closest(PROTECTED_PREVIEW_CLICK_SELECTOR)) return;

    const block = target.closest(`[${SOURCE_START_LINE_ATTR}]`);
    if (!block) return; // aucun repère source exploitable : rien à faire

    // Attribut PROPRE au repérage par bloc : `SOURCE_PATH_ATTR` reste réservé
    // au premier bloc de chaque feuillet, dont dépend le défilement synchronisé.
    const path = block.getAttribute(SOURCE_BLOCK_PATH_ATTR);
    const startLine = Number(block.getAttribute(SOURCE_START_LINE_ATTR));
    const startCol = Number(block.getAttribute(SOURCE_START_COL_ATTR));
    const endLine = Number(block.getAttribute(SOURCE_END_LINE_ATTR));
    const endCol = Number(block.getAttribute(SOURCE_END_COL_ATTR));
    if (
      !path ||
      !Number.isFinite(startLine) || !Number.isFinite(startCol) ||
      !Number.isFinite(endLine) || !Number.isFinite(endCol)
    ) {
      return;
    }

    event.preventDefault();
    void this.openPreviewBlockInEditor(path, { line: startLine, ch: startCol }, { line: endLine, ch: endCol });
  }

  /** Ouvre le feuillet source dans l'éditeur existant (jamais une nouvelle
   * feuille inutile — même résolveur que le reste de l'aperçu) et place le
   * curseur en tête du bloc cliqué. Ne touche ni `compileScope`, ni
   * `previewMode`, ne rerend rien : seule la feuille MARKDOWN change. */
  private async openPreviewBlockInEditor(
    path: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const leaf = this.plugin.getLeafForOpeningFile?.() || this.app.workspace.getLeaf(false);
    if (!leaf) return;

    /* La navigation vise l'ÉDITEUR, jamais l'Aperçu — même garde-fou que
       openVisibleFeuillet({ alignFromPreview: true }) contre un scroll
       TARDIF émis par l'éditeur nouvellement monté (position initiale à
       l'ouverture, puis `scrollIntoView` juste après) : sans lui, ce
       scroll-là est pris pour un geste de lecture par `onSourceScroll` et
       réappliqué à l'Aperçu via `applySourceToPreview` — c'est CE
       mécanisme, pas un rerendu, qui faisait « remonter » l'Aperçu au clic.
       Aucune iframe n'est jamais reconstruite ici ; seule sa position de
       défilement l'était par erreur, corrigée à la source (le scroll-sync
       ne se déclenche plus du tout pendant cette fenêtre) plutôt que
       masquée après coup par un `scrollTo()` différé.

       Volontairement PAS de `this.lastPreviewScrollAt = Date.now()` ici :
       ce champ nourrit le délai générique `SCROLL_SYNC_SUSPEND_MS` (200 ms)
       qu'`applySourceToPreview` applique à TOUT scroll source suivant, pas
       seulement à celui du clic — le poser aurait ignoré, par effet de
       bord, un scroll manuel authentique de l'éditeur survenu dans les 200 ms
       après le clic (régression constatée : la synchronisation Markdown →
       Aperçu restait inerte après un clic). `preservingPreviewScrollRequestId`
       seul suffit : il ne couvre que la fenêtre d'une frame, exactement
       celle du scroll programmatique de `scrollIntoView` ci-dessous. */
    const requestId = ++this.openVisibleRequestId;
    this.preservingPreviewScrollRequestId = requestId;
    const keptPreviewScrollTop = Number(this.previewViewport?.scrollTop) || 0;

    await leaf.openFile(file, { active: true });
    if (this.closed || requestId !== this.openVisibleRequestId) return;

    // Duck-typing volontaire (comme activeMarkdownView) : dans les tests
    // comme dans certaines vues, `leaf.view` n'est jamais une VRAIE instance
    // de MarkdownView, seulement un objet qui en a la forme.
    const view = (leaf as unknown as {
      view?: { file?: unknown; contentEl?: HTMLElement; editor?: PreviewEditorLike };
    }).view;
    const editor = view?.editor;
    if (!editor || typeof editor.setCursor !== "function") {
      if (this.preservingPreviewScrollRequestId === requestId) this.preservingPreviewScrollRequestId = null;
      return;
    }

    this.synchronizedFeuilletPath = file.path;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    /* Brancher le suivi AVANT de bouger le curseur : `scrollIntoView`
       ci-dessous peut émettre un `scroll` sur ce panneau, et c'est
       précisément `preservingPreviewScrollRequestId` (posé plus haut) qui
       doit l'intercepter côté `onSourceScroll` — le brancher après aurait
       laissé passer ce premier scroll sans écouteur pour le voir. */
    this.bindSourcePane({
      file: view?.file instanceof TFile ? view.file : file,
      contentEl: view?.contentEl || null,
    });

    // Le curseur SEUL : jamais de sélection du paragraphe entier, qu'une
    // frappe distraite pourrait remplacer par inadvertance.
    editor.setCursor(from);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();

    // Restaure la position exacte capturée avant l'ouverture — un dernier
    // scroll de l'éditeur peut encore survenir après cette ligne (voir le
    // commentaire d'ouverture), d'où la restauration répétée à la frame
    // suivante avant de lever le garde-fou.
    if (this.previewViewport) this.previewViewport.scrollTop = keptPreviewScrollTop;
    this.releaseAfterFrame(() => {
      if (this.preservingPreviewScrollRequestId !== requestId) return;
      this.preservingPreviewScrollRequestId = null;
      if (this.previewViewport) this.previewViewport.scrollTop = keptPreviewScrollTop;
    });
  }

  /** Rend les champs déjà présents sur la page de titre cliquables. Le DOM
   * ne sert que de déclencheur : la valeur affichée n'est jamais modifiée
   * directement ; elle est écrite dans le fichier Front puis rerendue. */
  private bindInteractiveTitlePage(): void {
    if (this.mode !== "manuscript") return;
    const doc = this.previewFrame?.contentDocument;
    if (!doc) return;
    const titlePage = doc.querySelector<HTMLElement>(".feuillets-frontpage-titre");
    if (titlePage) {
      const source = titlePage.querySelector<HTMLElement>(`[${SOURCE_PATH_ATTR}]`);
      const path = titlePage.getAttribute(SOURCE_PATH_ATTR)
        || source?.getAttribute(SOURCE_PATH_ATTR)
        || null;
      const roleElements = Array.from(titlePage.querySelectorAll<HTMLElement>("[data-fp-role]"));
      for (const element of roleElements) {
        const role = element.getAttribute("data-fp-role");
        if (!role) continue;
        if (path) {
          this.makeTitleElementEditable(element, role, path);
        } else if (role === "titre") {
          this.makeFallbackTitleElementEditable(element, "manuscriptTitle", t("preview.firstPageField.title"), role);
        } else if (role === "auteur") {
          this.makeFallbackTitleElementEditable(element, "manuscriptAuthor", t("preview.firstPageField.author"), role);
        }
      }
      this.addTitlePageControls(titlePage);
      if (roleElements.length) return;
    }

    // Repli des anciens projets sans feuillet Front à rôles : les deux
    // champs génériques existants restent éditables via leurs clés historiques.
    const title = doc.querySelector<HTMLElement>(".feuillets-preview-pages h1");
    const author = doc.querySelector<HTMLElement>(".pdf-author-title");
    if (title) this.makeFallbackTitleElementEditable(title, "manuscriptTitle", t("preview.firstPageField.title"), "titre");
    if (author) this.makeFallbackTitleElementEditable(author, "manuscriptAuthor", t("preview.firstPageField.author"), "auteur");
  }

  private makeTitleElementEditable(element: HTMLElement, role: string, path: string): void {
    element.addClass("feuillets-preview-title-editable");
    element.setAttribute("tabindex", "0");
    element.setAttribute("title", t("preview.titleControl.editRole", { role }));
    element.setAttribute("aria-label", t("preview.titleControl.editRole", { role }));
    element.addEventListener("click", () => this.selectTitleElement(element));
    element.addEventListener("dblclick", () => void this.editTitleRole(path, role));
    element.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.key === "Enter") void this.editTitleRole(path, role);
      else this.selectTitleElement(element);
    });
    this.addTitleRoleControls(element, role, path);
  }

  private selectTitleElement(element: HTMLElement): void {
    const doc = element.ownerDocument;
    for (const selected of Array.from(doc?.querySelectorAll<HTMLElement>(".is-title-selected") || [])) {
      selected.removeClass("is-title-selected");
    }
    element.addClass("is-title-selected");
    const controls = element.nextElementSibling as HTMLElement | null;
    if (controls?.hasClass("feuillets-preview-title-controls")) {
      controls.style.top = `${Number(element.offsetTop) || 0}px`;
      controls.style.left = `${(Number(element.offsetLeft) || 0) + (Number(element.offsetWidth) || 0) + 8}px`;
    }
  }

  /** Petite poignée contextuelle, injectée seulement dans l'iframe affichée.
   * Elle ne modifie jamais le HTML rendu : chaque action persiste d'abord
   * dans le feuillet Front ou dans le gabarit, puis déclenche un nouveau rendu.
   *
   * `doc.createElement` volontaire (pas createEl/createDiv, ni doc.win.createEl) :
   * `element.ownerDocument` est le document de l'iframe d'aperçu, un realm JS
   * séparé sans les prototypes patchés par Obsidian — même raison que
   * export-pdf.ts (iframe.contentDocument). `.win` reste typé `Window` mais
   * pointe vers la fenêtre de CE realm, elle aussi non patchée : y appeler
   * `.createEl` planterait exactement pareil. */
  private addTitleRoleControls(element: HTMLElement, role: string, path: string): void {
    const controls = element.createSpan({ cls: "feuillets-preview-title-controls" });
    controls.setAttribute("data-title-controls", role);
    const action = (icon: string, label: string, run: () => void): void => {
      const button = controls.createEl("button", { cls: "clickable-icon", type: "button" });
      setIcon(button, icon);
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
    };
    action("pencil", t("preview.titleControl.editRole", { role }), () => void this.editTitleRole(path, role));
    const drag = controls.createEl("button", { cls: "clickable-icon", type: "button" });
    setIcon(drag, "grip-vertical");
    drag.setAttribute("aria-label", t("preview.titleControl.moveVertically"));
    drag.setAttribute("title", t("preview.titleControl.moveVertically"));
    drag.addEventListener("pointerdown", (event: PointerEvent) => this.startTitleRoleDrag(event, element, role, drag));
    controls.appendChild(drag);
    action("arrow-up", t("preview.titleControl.moveUp"), () => void this.moveTitleRole(path, role, -1));
    action("arrow-down", t("preview.titleControl.moveDown"), () => void this.moveTitleRole(path, role, 1));
    action("minus", t("preview.titleControl.reduceSpaceBefore"), () => void this.adjustTitleRoleSpacing(role, -6));
    action("plus", t("preview.titleControl.increaseSpaceBefore"), () => void this.adjustTitleRoleSpacing(role, 6));
    action("align-center", t("preview.titleControl.changeAlignment"), () => void this.cycleTitleRoleAlignment(role));
    element.after(controls);
  }

  private startTitleRoleDrag(event: PointerEvent, element: HTMLElement, role: string, handle: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    const doc = element.ownerDocument;
    const startY = event.clientY;
    handle.addClass("is-dragging");
    const move = (next: PointerEvent): void => {
      const delta = (next.clientY - startY) / Math.max(this.zoomScale, 0.1);
      element.style.transform = `translateY(${delta}px)`;
    };
    const up = (next: PointerEvent): void => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      handle.removeClass("is-dragging");
      element.style.removeProperty("transform");
      const deltaPt = Math.round(((next.clientY - startY) / Math.max(this.zoomScale, 0.1)) * 0.75);
      if (deltaPt) void this.adjustTitleRoleSpacing(role, deltaPt);
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
  }

  /** Commandes globales placées DANS la page : déplacement de la composition
   * et marges internes, sans panneau permanent ni réglage parallèle.
   * `doc.createElement` volontaire — voir addTitleRoleControls ci-dessus. */
  private addTitlePageControls(titlePage: HTMLElement): void {
    const controls = titlePage.createSpan({ cls: "feuillets-preview-title-page-controls" });
    const action = (icon: string, label: string, run: () => void): void => {
      const button = controls.createEl("button", { cls: "clickable-icon", type: "button" });
      setIcon(button, icon);
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      controls.appendChild(button);
    };
    action("move-up", t("preview.titleControl.moveCompositionUp"), () => void this.adjustTitlePageVertical(-12));
    action("move-down", t("preview.titleControl.moveCompositionDown"), () => void this.adjustTitlePageVertical(12));
    action("shrink", t("preview.titleControl.reduceInnerMargins"), () => void this.adjustTitlePageHorizontalMargins(-6));
    action("expand", t("preview.titleControl.increaseInnerMargins"), () => void this.adjustTitlePageHorizontalMargins(6));
    titlePage.appendChild(controls);
  }

  private async adjustTitlePageVertical(delta: number): Promise<void> {
    await this.updateTitlePageStyles((styles) => {
      const first = Object.keys(styles)[0];
      if (!first) return;
      styles[first].marginTopPt = Math.max(0, (styles[first].marginTopPt || 0) + delta);
    });
  }

  private async adjustTitlePageHorizontalMargins(delta: number): Promise<void> {
    await this.updateTitlePageStyles((styles) => {
      for (const style of Object.values(styles)) {
        style.marginLeftPt = Math.max(0, (style.marginLeftPt || 0) + delta);
        style.marginRightPt = Math.max(0, (style.marginRightPt || 0) + delta);
      }
    });
  }

  private async adjustTitleRoleSpacing(role: string, delta: number): Promise<void> {
    await this.updateTitlePageStyles((styles) => {
      const style = styles[role] || (styles[role] = {});
      style.marginTopPt = Math.max(0, (style.marginTopPt || 0) + delta);
    });
  }

  private async cycleTitleRoleAlignment(role: string): Promise<void> {
    await this.updateTitlePageStyles((styles) => {
      const style = styles[role] || (styles[role] = {});
      const order = ["left", "center", "right"];
      style.align = order[(order.indexOf(style.align || "center") + 1) % order.length];
    });
  }

  private async moveTitleRole(path: string, role: string, direction: -1 | 1): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
    const roleLines = lines.map((line, index) => ({
      index,
      role: line.trim().match(/^:::\s*(.+?)\s*:\s?(.*)$/)?.[1]?.trim().toLocaleLowerCase("fr") || null,
    })).filter((entry) => entry.role !== null);
    const current = roleLines.findIndex((entry) => entry.role === role.trim().toLocaleLowerCase("fr"));
    const target = current + direction;
    if (current < 0 || target < 0 || target >= roleLines.length) return;
    const a = roleLines[current].index;
    const b = roleLines[target].index;
    [lines[a], lines[b]] = [lines[b], lines[a]];
    await this.app.vault.modify(file, lines.join("\n"));
    await this.refreshPreview();
  }

  private makeFallbackTitleElementEditable(
    element: HTMLElement,
    key: "manuscriptTitle" | "manuscriptAuthor",
    label: string,
    role: string
  ): void {
    element.addClass("feuillets-preview-title-editable");
    element.setAttribute("tabindex", "0");
    element.setAttribute("title", t("preview.titleControl.editRole", { role: label.toLowerCase() }));
    const edit = (): void => {
      const current = String(this.plugin.settings[key] || element.textContent || "");
      void promptText(this.app, label, current).then((next) => {
        if (next === null) return;
        this.plugin.settings[key] = next.trim();
        void this.plugin.saveSettings?.().then(() => this.refreshPreview());
      });
    };
    element.addEventListener("click", () => this.selectTitleElement(element));
    element.addEventListener("dblclick", edit);
    element.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.key === "Enter") edit();
      else this.selectTitleElement(element);
    });
    this.addGeneratedTitleRoleControls(element, role, edit);
  }

  /** `doc.createElement` volontaire — voir addTitleRoleControls plus haut. */
  private addGeneratedTitleRoleControls(element: HTMLElement, role: string, edit: () => void): void {
    const controls = element.createSpan({ cls: "feuillets-preview-title-controls" });
    const action = (icon: string, label: string, run: () => void): HTMLElement => {
      const button = controls.createEl("button", { cls: "clickable-icon", type: "button" });
      setIcon(button, icon);
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      controls.appendChild(button);
      return button;
    };
    action("pencil", t("preview.titleControl.editRole", { role }), edit);
    const drag = action("grip-vertical", t("preview.titleControl.moveVertically"), () => undefined);
    drag.addEventListener("pointerdown", (event: PointerEvent) => this.startTitleRoleDrag(event, element, role, drag));
    action("minus", t("preview.titleControl.reduceSpaceBefore"), () => void this.adjustTitleRoleSpacing(role, -6));
    action("plus", t("preview.titleControl.increaseSpaceBefore"), () => void this.adjustTitleRoleSpacing(role, 6));
    action("align-center", t("preview.titleControl.changeAlignment"), () => void this.cycleTitleRoleAlignment(role));
    element.after(controls);
  }

  private async editTitleRole(path: string, role: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.cachedRead(file);
    const normalizedRole = role.trim().toLocaleLowerCase("fr");
    const current = readTitleRoleValue(content, role);
    const next = await promptText(this.app, t("preview.titleControl.editRole", { role }), current);
    if (next === null) return;
    await this.app.vault.modify(file, setTitleRoleValue(content, role, next));

    if (normalizedRole === "titre") {
      this.plugin.settings.manuscriptTitle = next.trim();
      await this.app.fileManager?.processFrontMatter?.(file, (data: Record<string, unknown>) => { data.title = next.trim(); });
    } else if (normalizedRole === "auteur") {
      this.plugin.settings.manuscriptAuthor = next.trim();
    }
    await this.plugin.saveSettings?.();
    await this.refreshPreview();
  }

  /** Remplace le contenu par un message — seul cas où la zone défilable est
   * légitimement vidée. */
  private showMessage(cls: string, text: string): void {
    if (!this.scaledContainer) return;
    this.previewFrame = null;
    this.pendingFrame = null;
    this.frameLoaded = false;
    this.displayedPath = null;
    this.scaledContainer.empty();
    this.scaledContainer.createDiv({ cls, text });
  }

  private setStatus(status: PreviewStatus): void {
    this.status = status;
    if (this.statusEl) {
      this.statusEl.textContent = previewStatusLabel(status, this.mode);
      this.statusEl.toggleClass("is-error", status === "error");
      this.statusEl.toggleClass("is-working", status === "rendering" || status === "stale");
    }
  }

  /* ==================== Suivi de la scène active ======================
     Volontairement limité au CHANGEMENT DE FEUILLET, en modes Chapitre et
     Manuscrit. Le suivi au curseur qui existait ici s'auto-suspendait :
     il traitait les défilements programmatiques comme manuels (les
     événements `scroll` étant asynchrones, le drapeau se désynchronisait),
     et `selectionchange` le relançait en continu. Un déclencheur unique et
     déterministe vaut mieux qu'un suivi fin qui ne marche pas. */

  syncToActiveScene(force = false): void {
    if (this.closed) return;
    if (this.mode === "scene") return; // l'aperçu EST déjà la scène active

    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return;

    const viewport = this.previewViewport;
    const doc = this.previewFrame?.contentDocument;
    if (!viewport || !doc) return;

    /* Chemins normalisés DES DEUX CÔTÉS avant comparaison : l'attribut est
       posé depuis `segment.path`, la recherche part de `file.path`. Les deux
       viennent d'Obsidian, mais un séparateur dupliqué ou un préfixe « ./ »
       suffirait à faire échouer une comparaison littérale — et l'échec
       serait silencieux (on ne bouge simplement pas). */
    const wanted = normalizePath(file.path);
    const target =
      doc.querySelector<HTMLElement>(`[${SOURCE_PATH_ATTR}="${escapeAttr(wanted)}"]`) ||
      Array.from(doc.querySelectorAll<HTMLElement>(`[${SOURCE_PATH_ATTR}]`)).find(
        (el) => normalizePath(el.getAttribute(SOURCE_PATH_ATTR) || "") === wanted
      );
    if (!target) return; // feuillet absent du rendu courant : ne rien bouger

    const targetTop = this.sectionForPath(file.path)?.top
      ?? this.frameTopWithinScroll() + target.offsetTop * this.zoomScale;
    const relative = targetTop - viewport.scrollTop;
    if (!force && relative >= 0 && relative <= viewport.clientHeight * ALREADY_VISIBLE_RATIO) return;

    viewport.scrollTop = Math.max(0, targetTop - SCROLL_TARGET_MARGIN_PX);
  }

  /* ========================== Menu de la barre ========================
     Le zoom est le SEUL menu restant. La portée se choisit au fil d'Ariane
     ou dans le panneau Export ; les réglages détaillés vivent dans l'onglet
     Export des paramètres Feuillets, ouvert par l'icône Réglages. */

  /** UN seul contrôle de zoom : ce menu remplace les cinq boutons séparés
   * (−, +, largeur, page entière, 100 %) qui encombraient la barre. */
  openZoomMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t("preview.zoom.adjustToWidth"));
      item.setIcon("move-horizontal");
      item.setChecked?.(this.zoomMode === "fit-width");
      item.onClick(() => this.activateAutoMode("fit-width"));
    });
    menu.addItem((item) => {
      item.setTitle(t("preview.zoom.showFullPage"));
      item.setIcon("maximize");
      item.setChecked?.(this.zoomMode === "fit-page");
      item.onClick(() => this.activateAutoMode("fit-page"));
    });
    menu.addSeparator?.();
    for (const percent of ZOOM_STEPS) {
      menu.addItem((item) => {
        item.setTitle(`${percent} %`);
        item.setChecked?.(this.zoomMode === "manual" && Math.round(this.zoomScale * 100) === percent);
        item.onClick(() => this.setZoom(percent / 100, "manual"));
      });
    }
    this.showMenu(menu, e);
  }

  private showMenu(menu: MenuLike, e: MouseEvent): void {
    this.openMenu = menu;
    if (e && typeof menu.showAtMouseEvent === "function") menu.showAtMouseEvent(e);
    else menu.showAtPosition?.({ x: 0, y: 0 });
  }

  /* ==================== Sélection de la source suivie ==================
     PreviewView ne suit qu'UNE feuille à la fois : la feuille Markdown qui
     a réellement le focus, et seulement si son fichier appartient au
     projet. Les vues non Markdown sont ignorées, à une exception près : une
     vue Scrivening (plusieurs feuillets dans un seul panneau), qui expose
     ses propres repères de scène. */

  private activeMarkdownView(): { file: TFile | null; contentEl: HTMLElement | null } | null {
    const workspace = this.app.workspace as unknown as {
      getActiveViewOfType?<T>(type: unknown): T | null;
      getLeavesOfType?(type: string): Array<{ view?: { file?: unknown; contentEl?: HTMLElement } }>;
      getActiveFile?(): unknown;
    };
    const view = workspace.getActiveViewOfType?.<{ file?: unknown; contentEl?: HTMLElement }>(MarkdownView);
    if (view) return { file: view.file instanceof TFile ? view.file : null, contentEl: view.contentEl || null };

    /* Repli (et seul chemin dans les tests) : la feuille Markdown dont le
       fichier EST le fichier actif. Sans repère de focus disponible, c'est
       la meilleure approximation — jamais « la première feuille venue ». */
    const active = workspace.getActiveFile?.();
    if (!(active instanceof TFile)) return null;
    for (const leaf of workspace.getLeavesOfType?.("markdown") || []) {
      const candidate = leaf?.view;
      if (candidate?.file instanceof TFile && candidate.file.path === active.path) {
        return { file: candidate.file, contentEl: candidate.contentEl || null };
      }
    }
    return null;
  }

  /** Panneau Scrivening visible, s'il y en a un : plusieurs feuillets dans
   * un seul défilement, avec un `data-path` par scène. */
  private activeScriveningsHost(): HTMLElement | null {
    const workspace = this.app.workspace as unknown as {
      getLeavesOfType?(type: string): Array<{ view?: { contentEl?: HTMLElement } }>;
    };
    for (const leaf of workspace.getLeavesOfType?.(VIEW_BOARD) || []) {
      const contentEl = leaf?.view?.contentEl;
      if (contentEl && findScriveningsScroller(contentEl)) return contentEl;
    }
    return null;
  }

  /** (Re)branche l'écoute de défilement sur le panneau source pertinent.
   * Idempotent : rebrancher sur le même élément ne pose pas un second
   * écouteur (fuite classique quand la feuille active change souvent). */
  bindSourcePane(preferredMarkdown?: { file: TFile | null; contentEl: HTMLElement | null }): void {
    if (this.closed) return;
    if (!this.syncScrollEnabled) {
      this.stopContinuousSync();
      return;
    }

    let kind: "markdown" | "scrivenings" | null = null;
    let scroller: HTMLElement | null = null;
    let path: string | null = null;
    let host: HTMLElement | null = null;

    const markdown = preferredMarkdown || this.activeMarkdownView();
    if (markdown && this.isPreviewableFile(markdown.file)) {
      if (this.synchronizedFeuilletPath && markdown.file?.path !== this.synchronizedFeuilletPath) {
        // Le changement de focus ne doit jamais substituer une autre scène
        // à celle que l'utilisatrice vient explicitement d'ouvrir.
        this.stopContinuousSync();
        return;
      }
      kind = "markdown";
      path = markdown.file?.path ?? null;
      scroller = findSourceScroller(markdown.contentEl) as HTMLElement | null;
    } else if (!markdown) {
      host = this.activeScriveningsHost();
      if (host) {
        kind = "scrivenings";
        scroller = findScriveningsScroller(host) as HTMLElement | null;
      }
    }

    /* Aucun candidat trouvé alors qu'une feuille était déjà suivie : on la
       GARDE tant qu'elle existe encore.
       C'est indispensable, et pas une commodité : dès que l'utilisatrice
       clique (ou défile) dans l'aperçu, c'est LUI qui devient la feuille
       active — il n'y a alors plus aucune vue Markdown active, et débrancher
       ici tuerait la synchronisation aperçu → éditeur au moment précis où
       elle sert. Même chose pour un fichier hors projet ouvert à côté :
       « ignorer » veut dire ne pas le suivre, pas oublier le feuillet
       qu'on suivait. Une feuille réellement fermée, elle, est détachée du
       document et libère donc bien son écouteur. */
    if (!scroller && this.syncScroller && isStillAttached(this.syncScroller)) {
      return;
    }


    if (scroller !== this.syncScroller) {
      this.syncScrollerCleanup?.();
      this.syncScrollerCleanup = null;
      this.syncScroller = scroller;
      if (scroller && typeof scroller.addEventListener === "function") {
        const handler = (): void => this.onSourceScroll();
        scroller.addEventListener("scroll", handler);
        this.syncScrollerCleanup = () => scroller.removeEventListener("scroll", handler);
      }
    }
    this.syncKind = kind;
    this.syncSourcePath = path;
    this.syncHost = host;
    if (this.followedEl) this.followedEl.textContent = path || t("preview.noEditorFollowed");
  }

  /** Détache l'écoute sans forcément oublier le feuillet choisi : un focus
   * temporaire sur l'aperçu ne doit pas casser le suivi contextuel. */
  private stopContinuousSync(clearSynchronizedFeuillet = false): void {
    this.syncScrollerCleanup?.();
    this.syncScrollerCleanup = null;
    this.syncScroller = null;
    this.syncHost = null;
    this.syncKind = null;
    this.syncSourcePath = null;
    this.syncingFromEditor = false;
    this.syncingFromPreview = false;
    this.lastSourceScrollAt = 0;
    this.lastPreviewScrollAt = 0;
    this.cancelFrame(this.syncHandle);
    this.syncHandle = null;
    this.syncJob = null;
    if (clearSynchronizedFeuillet) this.synchronizedFeuilletPath = null;
    for (const handle of this.releaseHandles) this.cancelFrame(handle);
    this.releaseHandles = [];
  }

  /* ==================== Synchronisation du défilement ==================
     Deux sens, un seul interrupteur. Aucune de ces routines ne rend ni ne
     compile quoi que ce soit : elles ne font que déplacer un `scrollTop`. */

  private onSourceScroll(): void {
    if (this.closed || !this.syncScrollEnabled) return;
    if (this.preservingPreviewScrollRequestId !== null) return;
    // Écho de NOTRE propre correction : surtout ne pas le prendre pour un
    // geste de l'utilisatrice, sinon les deux panneaux se poursuivent.
    if (this.syncingFromPreview) return;
    this.lastSourceScrollAt = Date.now();
    this.scheduleSync(() => this.applySourceToPreview());
  }

  private onPreviewScroll(): void {
    if (this.closed) return;
    // Un scroll que nous venons de produire pour la synchronisation ne doit
    // pas être pris pour une lecture manuelle, sinon il bloquerait la mise à
    // jour source → aperçu qui vient justement de le provoquer.
    const programmatic = this.syncingFromEditor;
    if (!programmatic) this.lastPreviewScrollAt = Date.now();
    if (this.isLongFormPreview) this.scheduleVisibleFeuilletUpdate();
    if (!programmatic && this.isAutoOpenPreview) this.scheduleAutoOpenVisibleFeuillet();
    if (!this.syncScrollEnabled) return;
    if (programmatic) return;
    this.scheduleSync(() => this.applyPreviewToSource());
  }

  /** Au plus UN recalcul par frame, quel que soit le nombre d'événements
   * `scroll` reçus entre-temps — c'est le dernier état qui compte. */
  private scheduleSync(job: () => void): void {
    this.syncJob = job;
    if (this.syncHandle) return;
    this.syncHandle = this.requestFrame(() => {
      this.syncHandle = null;
      const pending = this.syncJob;
      this.syncJob = null;
      if (!this.closed) pending?.();
    });
  }

  private requestFrame(cb: () => void): { id: number; kind: "frame" | "timeout" } | null {
    if (typeof window === "undefined") return null;
    if (typeof window.requestAnimationFrame === "function") {
      return { id: window.requestAnimationFrame(() => cb()), kind: "frame" };
    }
    return { id: window.setTimeout(cb, 0), kind: "timeout" };
  }

  private cancelFrame(handle: { id: number; kind: "frame" | "timeout" } | null): void {
    if (!handle || typeof window === "undefined") return;
    if (handle.kind === "frame" && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(handle.id);
    else if (handle.kind === "timeout") window.clearTimeout(handle.id);
  }

  private scheduleVisibleFeuilletUpdate(): void {
    if (this.visibleFeuilletHandle) return;
    this.visibleFeuilletHandle = this.requestFrame(() => {
      this.visibleFeuilletHandle = null;
      this.updateVisibleFeuillet();
    });
  }

  /** Après l'arrêt du geste, ouvre uniquement le dernier feuillet atteint.
   * Le délai évite de faire défiler l'éditeur à travers toutes les scènes
   * croisées pendant une inertie de trackpad. */
  private scheduleAutoOpenVisibleFeuillet(): void {
    if (typeof window === "undefined") return;
    if (this.autoOpenVisibleTimer !== null) window.clearTimeout(this.autoOpenVisibleTimer);
    this.autoOpenVisibleTimer = window.setTimeout(() => {
      this.autoOpenVisibleTimer = null;
      if (this.closed || !this.isAutoOpenPreview) return;
      const path = this.visibleFeuilletPathAtViewport();
      if (!path || path === this.synchronizedFeuilletPath) return;
      void this.openVisibleFeuillet({ focusEditor: false, alignFromPreview: true });
    }, AUTO_OPEN_VISIBLE_DELAY_MS);
  }

  /** Détermine le feuillet lu au tiers supérieur du viewport, sans rendu. */
  private updateVisibleFeuillet(): void {
    if (!this.isLongFormPreview) return;
    const path = this.visibleFeuilletPathAtViewport();
    if (path === this.visibleFeuilletPath) return;
    this.visibleFeuilletPath = path;
    this.updateUI();
  }

  /** Lit la cible dans le DOM actuellement affiché. Cette méthode est aussi
   * appelée au clic : une frame de scroll encore en attente ne peut donc
   * jamais ouvrir le feuillet précédemment visible. */
  private visibleFeuilletPathAtViewport(): string | null {
    const viewport = this.previewViewport;
    const doc = this.previewFrame?.contentDocument;
    if (!viewport || !doc) return null;
    const marks = Array.from(doc.querySelectorAll<HTMLElement>(`[${SOURCE_PATH_ATTR}]`));
    if (!marks.length) return null;
    const stackTop = this.frameTopWithinScroll();
    const reference = viewport.scrollTop + (viewport.clientHeight || 0) / 3;
    /* Après pagination, chaque section peut vivre dans son propre
       `.pdf-page-content` : son `offsetTop` est alors local à la page (et
       plusieurs sections valent 0). La coordonnée de layout de l'iframe est
       la seule position commune fiable. Le repli offsetTop garde les DOM
       minimaux et les moteurs ne fournissant pas de rectangle. */
    const rectTops = marks.map((el) => el.getBoundingClientRect?.().top);
    const useLayoutCoordinates = rectTops.some((top) => Number.isFinite(top) && top !== 0);
    const tops = marks.map((el, index) => {
      const rectTop = rectTops[index];
      /* getBoundingClientRect() inclut déjà `transform: scale(...)` de la
         pile de pages. Le multiplier une seconde fois éloignait le titre
         de son contenu dès que le zoom n'était pas 100 %. */
      if (useLayoutCoordinates && Number.isFinite(rectTop)) return { top: rectTop, scaled: true };
      return { top: Number(el.offsetTop) || 0, scaled: false };
    });
    const candidates = marks.map((el, index) => {
      const top = stackTop + tops[index].top * (tops[index].scaled ? 1 : this.zoomScale);
      const nextTop = tops[index + 1];
      const bottom = index + 1 < tops.length
        ? stackTop + nextTop.top * (nextTop.scaled ? 1 : this.zoomScale)
        : stackTop + (this.naturalPagesHeight || 0) * this.zoomScale;
      const visible = Math.max(0, Math.min(bottom, viewport.scrollTop + viewport.clientHeight) - Math.max(top, viewport.scrollTop));
      return { path: el.getAttribute(SOURCE_PATH_ATTR), distance: Math.abs(top - reference), visible };
    }).filter((item): item is { path: string; distance: number; visible: number } => !!item.path);
    candidates.sort((a, b) => a.distance - b.distance || b.visible - a.visible);
    return candidates[0]?.path || null;
  }

  /** Relâche un drapeau seulement à la frame SUIVANTE : l'événement
   * `scroll` provoqué par une écriture de `scrollTop` est asynchrone, le
   * relâcher immédiatement le laisserait passer pour un geste manuel. */
  private releaseAfterFrame(release: () => void): void {
    const handle = this.requestFrame(() => {
      if (handle) {
        const i = this.releaseHandles.indexOf(handle);
        if (i >= 0) this.releaseHandles.splice(i, 1);
      }
      release();
    });
    if (handle) this.releaseHandles.push(handle);
    else release();
  }

  /** Intervalle occupé, dans le défilement de l'aperçu, par le feuillet
   * `path`. `null` dès qu'aucun repère n'existe (mode Scène : l'aperçu EST
   * le feuillet, la progression globale suffit et est exacte). */
  private sectionForPath(path: string | null): ScrollSection | null {
    if (!path) return null;
    const doc = this.previewFrame?.contentDocument;
    if (!doc) return null;
    const marks = Array.from(doc.querySelectorAll<HTMLElement>(`[${SOURCE_PATH_ATTR}]`));
    if (!marks.length) return null;

    const wanted = normalizePath(path);
    const index = marks.findIndex((el) => normalizePath(el.getAttribute(SOURCE_PATH_ATTR) || "") === wanted);
    if (index < 0) return null;

    const stackTop = this.frameTopWithinScroll();
    /* Même référentiel que la détection du feuillet visible. Après
       pagination, `offsetTop` est local à `.pdf-page-content` et vaut
       souvent 0 pour plusieurs scènes. Les rectangles sont, eux, exprimés
       dans un référentiel commun et incluent déjà le zoom CSS. */
    const rectTops = marks.map((el) => el.getBoundingClientRect?.().top);
    const useLayoutCoordinates = rectTops.some((value) => Number.isFinite(value) && value !== 0);
    const positions = marks.map((el, markIndex) => {
      const rectTop = rectTops[markIndex];
      if (useLayoutCoordinates && Number.isFinite(rectTop)) return stackTop + rectTop;
      return stackTop + (Number(el.offsetTop) || 0) * this.zoomScale;
    });
    const top = positions[index];
    const end =
      index + 1 < marks.length
        ? positions[index + 1]
        : stackTop + (this.naturalPagesHeight ?? 0) * this.zoomScale;
    return { top, height: Math.max(0, end - top) };
  }

  /** Position visée dans l'aperçu pour l'état actuel du panneau source. */
  private previewTarget(): number | null {
    const viewport = this.previewViewport;
    const scroller = this.syncScroller;
    if (!viewport || !scroller) return null;

    const globalProgress = scrollProgress(scroller);
    let path = this.syncSourcePath;
    let progress = globalProgress;

    if (this.syncKind === "scrivenings") {
      const scenes = this.syncHost?.querySelectorAll<HTMLElement>(SCRIVENINGS_SCENE_SELECTOR);
      const anchor = scriveningsAnchor(scroller, scenes ? Array.from(scenes) : null);
      if (anchor) {
        path = anchor.path;
        progress = anchor.progress;
      } else {
        path = null;
      }
    }

    const section = this.sectionForPath(path);
    // Aucun repère : progression relative pure (repli historique).
    if (!section) return scrollTopForProgress(viewport, globalProgress);

    /* Correctif STRICTEMENT limité à l'aperçu MONO-feuillet. Là, une section
       dégénérée (plus courte que le cadre) fige `scrollTopWithinSection` sur
       `section.top` quelle que soit la progression — panne mesurée en
       conditions réelles — et la progression globale est le repli exact,
       puisque la section EST le document.

       En MULTI-feuillets (Dossier, Projet, Chapitre, Partie), une section
       plus courte que le cadre est au contraire le cas NORMAL : le feuillet
       est rendu et paginé, il occupe bien moins de hauteur que dans
       l'éditeur. Y appliquer un repli quel qu'il soit désactive la
       synchronisation là où elle sert le plus. Comportement historique donc
       inchangé ici. */
    /* Aperçu MONO-feuillet dont la section n'a aucune amplitude : la section
       EST le document, la progression globale est alors exacte. Seul repli
       conservé — les sections des aperçus multi-feuillets sont de nouveau
       mesurées correctement depuis que le repérage par bloc a son propre
       attribut (voir SOURCE_BLOCK_PATH_ATTR). */
    if (!this.isLongFormPreview && !this.sectionHasUsableRange(section)) {
      return scrollTopForProgress(viewport, globalProgress);
    }
    return scrollTopWithinSection(section, viewport.clientHeight || 0, progress);
  }

  /** Une section ne peut porter une progression que si elle est PLUS HAUTE
   * que le cadre qui l'affiche. Sinon `section.height - clientHeight` est nul
   * ou négatif, et les deux conversions de preview-scroll-sync.ts s'effondrent
   * en constantes : `scrollTopWithinSection` renvoie `section.top` pour
   * n'importe quelle progression, et `progressWithinSection` renvoie 0 pour
   * n'importe quelle position. Les DEUX sens de la synchronisation se figent
   * alors en même temps — c'est la panne observée, mesurée en conditions
   * réelles (cible constante à 10⁻¹⁴ près pendant que la source défilait).
   * Dans ce cas la progression GLOBALE est le repli déjà prévu par la
   * hiérarchie documentée du module, et elle est même exacte quand l'aperçu
   * ne contient qu'un seul feuillet. */
  private sectionHasUsableRange(section: ScrollSection): boolean {
    return section.height - (this.previewViewport?.clientHeight || 0) > 0;
  }

  applySourceToPreview(): void {
    if (this.closed || !this.syncScrollEnabled) return;
    const viewport = this.previewViewport;
    if (!viewport || !this.syncScroller) return;
    // L'utilisatrice défile l'aperçu en ce moment : on ne lui reprend pas
    // la main (reprise automatique après une courte inactivité).
    if (Date.now() - this.lastPreviewScrollAt < SCROLL_SYNC_SUSPEND_MS) return;

    const target = this.previewTarget();
    if (target == null) return;
    const clamped = Math.max(0, Math.min(target, scrollableAmount(viewport)));
    if (Math.abs(clamped - viewport.scrollTop) < SCROLL_SYNC_EPSILON_PX) return;

    this.syncingFromEditor = true;
    viewport.scrollTop = clamped;
    this.releaseAfterFrame(() => { this.syncingFromEditor = false; });
  }

  applyPreviewToSource(): void {
    if (this.closed || !this.syncScrollEnabled) return;
    const viewport = this.previewViewport;
    const scroller = this.syncScroller;
    if (!viewport || !scroller) return;
    if (Date.now() - this.lastSourceScrollAt < SCROLL_SYNC_SUSPEND_MS) return;

    /* Sens retour : seule la source Markdown est traitée finement. Une vue
       Scrivening reste en progression relative — ses blocs sont bien
       repérés, mais y écrire une position à partir de l'aperçu supposerait
       de savoir quelle scène l'aperçu montre en tête, ce que les repères
       actuels ne garantissent qu'au feuillet près (voir la limite
       documentée dans preview-scroll-sync.ts). */
    /* Strictement inverse de previewTarget : même conversion, même repli. */
    const found = this.syncKind === "markdown" ? this.sectionForPath(this.syncSourcePath) : null;
    const section = found && (this.isLongFormPreview || this.sectionHasUsableRange(found)) ? found : null;
    const progress = section
      ? progressWithinSection(viewport.scrollTop, section, viewport.clientHeight || 0)
      : scrollProgress(viewport);

    const target = scrollTopForProgress(scroller, progress);
    if (Math.abs(target - (Number(scroller.scrollTop) || 0)) < SCROLL_SYNC_EPSILON_PX) return;

    this.syncingFromPreview = true;
    scroller.scrollTop = target;
    this.releaseAfterFrame(() => { this.syncingFromPreview = false; });
  }

  /* ======================= Réglages & export ==========================
     Aucun réglage de compilation n'est défini ici : l'onglet Export des
     paramètres Feuillets reste la source unique. L'export appelle le point
     d'entrée existant `exportFile()`, qui gère le titre
     repris de la page de titre, le dossier de sortie et les notices. */

  async openManuscriptSettings(): Promise<void> {
    openFeuilletsExportSettings(this.app);
  }

  /** Panneau contextuel compact : aucune valeur propre à PreviewView. Tous
   * les contrôles lisent et écrivent les réglages déjà consommés par
   * compile()/exportFile(), tandis que la portée est le mode courant. */
  private async renderExportPanel(): Promise<void> {
    const panel = this.exportPanelEl;
    if (!panel) return;
    panel.empty();
    panel.toggleClass("is-hidden", this.exportPanelCollapsed);

    const header = panel.createDiv({ cls: "feuillets-preview-export-header" });
    header.createSpan({ cls: "feuillets-preview-export-title", text: t("project.compilation.exportBtn") });
    const headerActions = header.createDiv({ cls: "feuillets-preview-export-header-actions" });
    /* Resynchronise TOUT le panneau — y compris les champs de la première
       page, relus dans le feuillet Front — avec l'aperçu. Utile si le
       fichier a été modifié ailleurs (éditeur, autre onglet) pendant que ce
       panneau restait ouvert. */
    this.iconBtn(headerActions, "refresh-cw", t("preview.export.refreshPreview"), () => void this.reloadExportPanel());
    this.iconBtn(headerActions, "x", t("preview.export.collapsePanel"), () => this.toggleExportPanel(true));

    const main = panel.createDiv({ cls: "feuillets-preview-export-main" });
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = main.createDiv({ cls: "feuillets-preview-export-field" });
      wrap.createSpan({ cls: "feuillets-preview-export-label", text: label });
      wrap.appendChild(control);
      return control;
    };

    /* La portée est AFFICHÉE, jamais modifiable ici : le fil d'Ariane est le
       seul endroit qui change la portée (règle 3 et 4 du chantier). */
    const scopeLabel = createSpan({ cls: "feuillets-preview-export-control feuillets-preview-export-scope-value" });
    scopeLabel.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scopeLabel.textContent = this.scopeDisplayLabel();
    this.exportScopeLabelEl = scopeLabel;
    field(t("preview.export.scope"), scopeLabel);

    const included = createEl("button");
    included.className = "clickable-icon feuillets-preview-export-control feuillets-preview-export-action-btn";
    setIcon(included, "list-checks");
    included.createSpan({ text: t("preview.export.includedItems") });
    included.setAttribute("aria-label", t("preview.export.chooseIncludedItems"));
    included.addEventListener("click", () => {
      new CompileSelectionModal(
        this.app,
        this.plugin as unknown as ConstructorParameters<typeof CompileSelectionModal>[1]
      ).open();
    });
    field(t("preview.export.content"), included);

    const format = createEl("select");
    format.className = "feuillets-preview-export-control";
    for (const [value, label] of [["docx", "DOCX"], ["pdf", "PDF"], ["epub", "EPUB"], ["odt", "ODT"]]) {
      format.createEl("option", { value, text: label });
    }
    format.value = this.exportFormat === "md" ? "docx" : this.exportFormat;
    format.setAttribute("aria-label", t("preview.export.outputFormat"));
    format.addEventListener("change", () => {
      this.plugin.settings.exportFormat = format.value;
      void this.plugin.saveSettings?.();
    });
    field(t("preview.export.format"), format);

    const template = createEl("select");
    template.className = "feuillets-preview-export-control";
    const templates = await listExportTemplates(this.app, this.plugin.settings);
    for (const tpl of templates) template.createEl("option", { value: tpl.key, text: tpl.label });
    template.value = this.plugin.settings.exportTemplate;
    template.setAttribute("aria-label", t("preview.export.templateAriaLabel"));
    template.addEventListener("change", () => {
      this.plugin.settings.exportTemplate = template.value;
      void this.plugin.saveSettings?.();
      void this.refreshPreview();
    });
    field(t("preview.export.template"), template);

    const name = createEl("input");
    name.className = "feuillets-preview-export-control";
    name.type = "text";
    name.value = this.exportFileName().replace(/\.md$/i, "");
    name.setAttribute("aria-label", t("preview.export.outputFileName"));
    name.setAttribute("placeholder", t("preview.export.manuscriptPlaceholder"));
    name.addEventListener("change", () => {
      const fileName = `${name.value.trim() || t("preview.export.defaultFileName")}.md`;
      const index = typeof this.plugin.settings.activePreset === "number" ? this.plugin.settings.activePreset : -1;
      const candidate = index >= 0 ? this.plugin.settings.compilePresets?.[index] : null;
      const preset = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
      if (preset) preset.fileName = fileName;
      else this.plugin.settings.compileFileName = fileName;
      void this.plugin.saveSettings?.();
    });
    field(t("preview.export.fileName"), name);

    await this.renderFirstPageSection(panel, templates);

    const footer = panel.createDiv({ cls: "feuillets-preview-export-footer" });
    const launch = footer.createEl("button", { cls: "clickable-icon mod-cta feuillets-preview-export-launch" });
    setIcon(launch, "download");
    launch.createSpan({ text: t("project.compilation.exportBtn") });
    launch.setAttribute("aria-label", t("preview.export.launch"));
    launch.addEventListener("click", () => void this.doExport());
  }

  /* ======================== Première page =============================
     CONTENU et INCLUSION de la page de titre, jamais sa mise en page fine :
     marges, distances, typographie, en-têtes et pieds appartiennent au modal
     « Mise en page visuelle » (et à l'onglet Export des paramètres), qui
     écrit dans le gabarit et les réglages centraux lus à l'identique par
     l'aperçu et par les exports.

     Source de vérité unique : le feuillet Front lui-même. Les champs
     ci-dessous LISENT ce fichier et y RÉÉCRIVENT — aucune copie locale, donc
     aucun état concurrent possible entre l'aperçu et l'export. */

  /** Feuillets Front pouvant servir de première page : les pages Front de
   * type « titre ». `compile: false` n'exclut pas de cette liste — un
   * feuillet exclu reste choisissable, c'est justement l'intérêt. */
  private frontTitleCandidates(): TFile[] {
    const root = this.plugin.getProjectFolder();
    if (!root) return [];
    const out: TFile[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children || []) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md" && isFrontMatter(this.app, this.plugin.settings, child)) {
          const type = fmOf(this.app, child).type;
          if (typeof type === "string" && type.trim().toLowerCase() === "titre") out.push(child);
        }
      }
    };
    walk(root);
    return out;
  }

  /** État de la première page, lu à chaque rendu du panneau : le feuillet
   * retenu par la compilation est le premier Front « titre » non exclu —
   * exactement la règle qu'applique `compile()`. */
  private frontTitleState(): { files: TFile[]; selected: TFile | null; included: boolean } {
    const files = this.frontTitleCandidates();
    const included = files.find((file) => fmOf(this.app, file).compile !== false) || null;
    return { files, selected: included || files[0] || null, included: !!included };
  }

  /** Inclut ou exclut la page de titre. Le fichier Front et ses métadonnées
   * restent intacts : seul l'indicateur `compile` du frontmatter change,
   * celui-là même que lisent `compile()` et « Éléments inclus ». */
  private async setFirstPageIncluded(included: boolean): Promise<void> {
    const { selected } = this.frontTitleState();
    if (!selected) return;
    await this.app.fileManager?.processFrontMatter?.(selected, (data: Record<string, unknown>) => {
      data.compile = included;
    });
    await this.reloadFirstPageSection();
  }

  /** Choisit un autre feuillet Front. Les autres candidats sont exclus, pas
   * supprimés : revenir en arrière ne coûte qu'un second choix. */
  private async chooseFrontTitleFile(path: string): Promise<void> {
    for (const file of this.frontTitleCandidates()) {
      const wanted = file.path === path;
      if ((fmOf(this.app, file).compile !== false) === wanted) continue;
      await this.app.fileManager?.processFrontMatter?.(file, (data: Record<string, unknown>) => {
        data.compile = wanted;
      });
    }
    await this.reloadFirstPageSection();
  }

  /** Ouvre le feuillet Front dans l'éditeur, comme n'importe quel feuillet du
   * Binder — et le sélectionne au passage dans le Binder. */
  private async openFrontFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = this.plugin.getLeafForOpeningFile?.() || this.app.workspace.getLeaf(false);
    if (!leaf) return;
    await leaf.openFile(file, { active: true });
    if (file.parent) this.plugin.settings.binderSelectedPath = file.parent.path;
    await this.plugin.saveSettings?.();
  }

  /** Écrit un champ dans le feuillet Front puis réactualise l'aperçu. Le HTML
   * rendu n'est jamais retouché à la main : c'est le fichier qui change, et
   * le rendu qui en découle (zoom et position de lecture conservés par
   * refreshPreview). */
  private async setFirstPageField(path: string, role: string, value: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.cachedRead(file);
    const next = setTitleRoleValue(content, role, value);
    if (next !== content) await this.app.vault.modify(file, next);
    if (role === "titre") this.plugin.settings.manuscriptTitle = value.trim();
    if (role === "auteur") this.plugin.settings.manuscriptAuthor = value.trim();
    await this.plugin.saveSettings?.();
    await this.refreshPreview();
  }

  /** Reconstruit le panneau ENTIER (les valeurs affichées viennent du
   * fichier) puis l'aperçu, sans toucher au zoom ni à la position de
   * lecture. Réservé aux actions qui justifient de tout redessiner —
   * ouverture du panneau, bouton « Actualiser » — jamais déclenché en
   * silence par un simple changement de champ : reconstruire le <details>
   * de la première page le refermerait et en chasserait le focus. */
  private async reloadExportPanel(): Promise<void> {
    /* Un échec pendant la reconstruction du panneau (lecture d'un fichier
       Front supprimé entre-temps, gabarit personnalisé invalide…) ne doit
       jamais faire disparaître le bouton « Actualiser » en silence : sans
       ce filet, une exception ici empêchait même l'appel à
       refreshPreview() qui suit — vu de l'utilisatrice, un clic qui ne fait
       plus jamais rien tant que l'onglet n'est pas rouvert. */
    try {
      await this.renderExportPanel();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.exportPanelError", { message: msg }));
      console.error("Feuillets : échec de renderExportPanel", e);
    }
    await this.refreshPreview();
  }

  /** Réactualise SEULEMENT le contenu de « Première page », sans toucher au
   * reste du panneau ni recréer son <details> : l'inclusion/exclusion et le
   * choix d'un autre fichier Front ne doivent ni refermer la sous-section ni
   * faire sauter le focus ailleurs dans l'écran. Même filet qu'au-dessus. */
  private async reloadFirstPageSection(): Promise<void> {
    try {
      if (this.firstPageBodyEl) await this.renderFirstPageFields(this.firstPageBodyEl, this.firstPageTemplates);
      else await this.renderExportPanel();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.firstPageError", { message: msg }));
      console.error("Feuillets : échec de renderFirstPageFields", e);
    }
    await this.refreshPreview();
  }

  private async renderFirstPageSection(panel: HTMLElement, templates: Array<{ key: string; label: string }>): Promise<void> {
    const details = panel.createEl("details", { cls: "feuillets-preview-export-details" });
    details.open = this.firstPageOpen;
    details.addEventListener("toggle", () => { this.firstPageOpen = details.open; });
    const summary = details.createEl("summary", { cls: "feuillets-preview-export-summary" });
    summary.createSpan({ text: t("preview.export.firstPage") });
    const body = details.createDiv({ cls: "feuillets-preview-export-details-body" });
    this.firstPageBodyEl = body;
    this.firstPageTemplates = templates;
    await this.renderFirstPageFields(body, templates);
  }

  /** Contenu de « Première page » — jamais le <details>/<summary> qui
   * l'enveloppe : appelée seule pour un rafraîchissement ciblé
   * (`reloadFirstPageSection`), ou depuis `renderFirstPageSection` lors
   * d'un rebuild complet du panneau. */
  private async renderFirstPageFields(body: HTMLElement, templates: Array<{ key: string; label: string }>): Promise<void> {
    body.empty();
    const { files, selected, included } = this.frontTitleState();

    const row1 = body.createDiv({ cls: "feuillets-preview-export-row feuillets-preview-export-row-1" });
    const row2 = body.createDiv({ cls: "feuillets-preview-export-row feuillets-preview-export-row-2" });

    const includeWrap = row1.createDiv({ cls: "feuillets-preview-export-field feuillets-preview-export-field-checkbox" });
    const includeRow = includeWrap.createEl("label", { cls: "feuillets-preview-export-inline-field" });
    const includeInput = includeRow.createEl("input", { type: "checkbox" });
    includeInput.checked = included;
    includeInput.setAttribute("aria-label", t("preview.export.includeTitlePage"));
    includeInput.addEventListener("change", () => void this.setFirstPageIncluded(includeInput.checked));
    includeRow.createSpan({ text: t("preview.export.includeTitlePage") });

    if (selected) {
      /* Un <div>, pas un <label> : le bouton « ouvrir » qui suit ne doit pas
         être avalé par le libellé (un clic dedans activerait la liste). */
      const fileWrap = row1.createDiv({ cls: "feuillets-preview-export-field feuillets-preview-export-field-front" });
      fileWrap.createSpan({ cls: "feuillets-preview-export-label", text: t("preview.export.frontFile") });
      const fileControls = fileWrap.createDiv({ cls: "feuillets-preview-export-file-controls" });
      const picker = fileControls.createEl("select", { cls: "feuillets-preview-export-control" });
      for (const file of files) picker.createEl("option", { value: file.path, text: file.basename });
      picker.value = selected.path;
      picker.setAttribute("aria-label", t("preview.export.usedFrontFile"));
      picker.addEventListener("change", () => void this.chooseFrontTitleFile(picker.value));
      this.iconBtn(fileControls, "pencil", t("preview.export.openFrontFile"), () => void this.openFrontFile(selected.path));

      const content = await this.app.vault.cachedRead(selected);
      for (const { label, role } of previewFirstPageFields()) {
        const isRow1 = role === "titre" || role === "sous-titre";
        const targetRow = isRow1 ? row1 : row2;

        const wrap = targetRow.createDiv({
          cls: `feuillets-preview-export-field feuillets-preview-export-field-${role}`,
        });
        wrap.createSpan({ cls: "feuillets-preview-export-label", text: label });
        const input = wrap.createEl("input", { type: "text", cls: "feuillets-preview-export-control" });
        input.value = readTitleRoleValue(content, role);
        input.setAttribute("aria-label", label);
        input.addEventListener("change", () => void this.setFirstPageField(selected.path, role, input.value));
      }
    } else {
      row2.createDiv({
        cls: "setting-item-description",
        text: t("preview.export.noTitleFrontFile"),
      });
    }

    /* Le réglage visuel n'est pas une seconde configuration : LayoutModal
     * modifie le même gabarit actif que le rendu et les exports, et c'est le
     * seul endroit où se règlent en-têtes, pieds, numéros de page, distances
     * aux bords et positionnement. */
    const visualLayout = body.createEl("button", { cls: "clickable-icon feuillets-preview-export-visual-btn" });
    const visualLeft = visualLayout.createDiv({ cls: "feuillets-preview-export-visual-left" });
    const iconSpan = visualLeft.createSpan({ cls: "feuillets-preview-export-visual-icon" });
    setIcon(iconSpan, "panel-top");
    visualLeft.createSpan({ text: t("preview.export.visualLayout") });

    const chevron = visualLayout.createSpan({ cls: "feuillets-preview-export-chevron" });
    setIcon(chevron, "chevron-right");
    visualLayout.setAttribute("aria-label", t("preview.export.adjustTitlePageLayout"));
    visualLayout.addEventListener("click", () => {
      // La valeur persistée est la référence : le panneau peut être en train
      // de se reconstruire après un changement de gabarit.
      const activeKey = this.plugin.settings.exportTemplate;
      const activeLabel = templates.find((item) => item.key === activeKey)?.label || activeKey;
      new LayoutModal(
        this.app,
        this.plugin as unknown as ConstructorParameters<typeof LayoutModal>[1],
        activeKey,
        activeLabel,
        () => { void this.refreshPreview(); }
      ).open();
    });
  }

  private async updateTitlePageStyles(change: (styles: Record<string, TitlePageStyle>) => void): Promise<void> {
    const tpl = await resolveExportTemplate(this.app, this.plugin.settings, this.plugin.settings.exportTemplate);
    const styles = JSON.parse(JSON.stringify(tpl.titlePage?.styles || {})) as Record<string, TitlePageStyle>;
    change(styles);
    await updateTemplateTitlePage(this.app, this.plugin.settings, this.plugin.settings.exportTemplate, styles);
    await this.refreshPreview();
  }

  private toggleExportPanel(collapsed?: boolean): void {
    this.exportPanelCollapsed = collapsed ?? !this.exportPanelCollapsed;
    this.exportPanelEl?.toggleClass("is-hidden", this.exportPanelCollapsed);
    /* À l'ouverture, les champs de la première page sont relus dans le
       feuillet Front : il a pu être modifié dans l'éditeur entre-temps, et
       l'écran ne doit jamais montrer une valeur que le fichier n'a plus. */
    if (!this.exportPanelCollapsed) void this.renderExportPanel();
  }

  private exportFileName(): string {
    return activePresetConfig(this.plugin.settings).fileName || `${t("preview.export.defaultFileName")}.md`;
  }

  private exportScopePath(): string | null {
    if (this.mode === "manuscript") return null;
    const active = this.visibleFeuilletPath
      ? this.app.vault.getAbstractFileByPath(this.visibleFeuilletPath)
      : this.app.workspace.getActiveFile();
    if (!(active instanceof TFile)) return null;
    if (this.mode === "scene") return active.path;
    return this.scopeForMode(this.mode, active)?.path || null;
  }

  get exportFormat(): string {
    const format = this.plugin?.settings?.exportFormat;
    return typeof format === "string" && format ? format : "docx";
  }

  /** Libellé de portée affiché dans le panneau Export. CompileScope avant
   * tout ; le mode historique n'est qu'un repli quand aucune portée
   * explicite n'est posée. */
  private scopeDisplayLabel(): string {
    const scope = this.compileScope;
    if (scope) {
      switch (scope.type) {
        case "file":
          return t("preview.scope.file");
        case "folder":
          return t("preview.scope.folder");
        case "project":
          return t("preview.scope.project");
        case "selection":
          return t("preview.scope.selection", { count: String(scope.paths.length) });
      }
    }
    return previewModeLabel(this.mode);
  }

  async doExport(): Promise<void> {
    const format = this.exportFormat;
    /* Portée explicite : on passe par exportWithScope, qui route chaque
       format vers le même moteur que l'Aperçu — c'est LE point d'écriture
       exclusif des fichiers de sortie. */
    if (this.compileScope) {
      const baseName = this.exportFileName().replace(/\.md$/i, "");
      await exportWithScope(this.app, this.plugin.settings, this.compileScope, format as never, baseName);
      return;
    }
    const scopePath = this.exportScopePath();
    if (format === "md") {
      await compile(this.app, this.plugin.settings, scopePath);
      return;
    }
    await exportFile(this.app, this.plugin.settings, format, scopePath);
  }

  /* ========================== Barre d'outils ========================== */

  /** Bouton-icône, calqué sur BaseFeuilletsView.iconBtn : même classe
   * `clickable-icon`, mêmes icônes Lucide. Le style (taille, couleur,
   * survol, arrondi) vient du THÈME — styles.css ne fait qu'aligner et
   * gérer l'opacité, comme pour les autres barres du plugin. */
  iconBtn(parent: HTMLElement, icon: string, label: string, onClick?: (e: MouseEvent) => void): HTMLElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, label);
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    if (onClick) btn.addEventListener("click", (e) => onClick(e));
    return btn;
  }

  /** Bouton TEXTE du zoom : il affiche un état et ouvre un menu. Volontairement pas un
   * `clickable-icon` — ce n'est pas une icône — mais soumis aux mêmes
   * règles de transparence absolue (voir styles.css). */
  chipBtn(parent: HTMLElement, text: string, label: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const btn = parent.createEl("button", { cls: "feuillets-preview-chip", text });
    setTooltip(btn, label);
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.setAttribute("aria-haspopup", "menu");
    btn.addEventListener("click", (e) => onClick(e));
    return btn;
  }

  /** Marque l'état d'un bouton SANS aucun fond : la classe d'état ne sert
   * qu'à la couleur/opacité (voir styles.css, où tout arrière-plan est
   * neutralisé pour ces deux barres), et `aria-pressed` porte l'état réel —
   * lisible par un lecteur d'écran comme par un test. */
  private setPressed(btn: HTMLElement | null | undefined, pressed: boolean): void {
    if (!btn) return;
    btn.toggleClass("feuillets-mode-active", pressed);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
  }

  private updateUI(): void {
    // Le zoom courant EST le contrôle de zoom : une seule valeur affichée.
    if (this.zoomLabelEl) {
      this.zoomLabelEl.textContent = `${Math.round(this.zoomScale * 100)} %`;
      const label = `${t("preview.zoom.tooltip")} — ${previewZoomModeLabel(this.zoomMode)}`;
      setTooltip(this.zoomLabelEl, label);
      this.zoomLabelEl.setAttribute("aria-label", label);
      this.zoomLabelEl.setAttribute("title", label);
    }
    const canOpenVisible = this.isLongFormPreview && !!this.visibleFeuilletPath;
    this.openVisibleEl?.toggleClass("is-hidden", !canOpenVisible);
    this.openVisibleEl?.setAttribute("aria-hidden", canOpenVisible ? "false" : "true");
    /* Le libellé de portée du panneau Export suit la même portée que le
       rendu et le fil d'Ariane (une seule source de vérité). */
    if (this.exportScopeLabelEl) this.exportScopeLabelEl.textContent = this.scopeDisplayLabel();
    this.renderBreadcrumb();
    const collapsed = this.barCollapsed;
    this.viewEl?.toggleClass("is-bar-collapsed", collapsed);
    if (this.btnBarToggle) {
      const label = collapsed ? t("preview.expandBar") : t("preview.collapseBar");
      setIcon(this.btnBarToggle, collapsed ? "chevron-down" : "chevron-up");
      setTooltip(this.btnBarToggle, label);
      this.btnBarToggle.setAttribute("aria-label", label);
      this.btnBarToggle.setAttribute("title", label);
      this.btnBarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }

    this.setStatus(this.status);
  }

  private binderFileTitle(file: TFile): string {
    return this.plugin.shortTitleFor?.(file) || shortTitleFor(this.app, file) || file.basename;
  }

  /** Ouvre le feuillet actuellement lu sans changer ni l'étendue, ni la
   * position, ni le zoom de l'aperçu. Le Binder suit le dossier parent et
   * son écoute de `file-open` sélectionne ensuite le fichier actif. */
  private async openVisibleFeuillet(
    { focusEditor = true, alignFromPreview = false }: { focusEditor?: boolean; alignFromPreview?: boolean } = {}
  ): Promise<void> {
    if (!this.isLongFormPreview) return;
    // Ne jamais réemployer l'état affiché : la cible est relue depuis la
    // section `data-source-path` effectivement sous les yeux au clic.
    const path = this.visibleFeuilletPathAtViewport();
    if (!path) return;
    if (path !== this.visibleFeuilletPath) {
      this.visibleFeuilletPath = path;
      this.updateUI();
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const requestId = ++this.openVisibleRequestId;
    // Toute nouvelle demande annule la protection transitoire de la
    // précédente : une ancienne ouverture ne peut pas bloquer le suivi.
    this.preservingPreviewScrollRequestId = null;
    const keptPreviewScrollTop = alignFromPreview
      ? (Number(this.previewViewport?.scrollTop) || 0)
      : null;
    if (alignFromPreview) {
      this.preservingPreviewScrollRequestId = requestId;
      // Le temps que l'éditeur monte son nouveau document, tout scroll
      // source tardif reste sans effet sur la lecture en cours dans l'aperçu.
      this.lastPreviewScrollAt = Date.now();
    }
    const leaf = this.plugin.getLeafForOpeningFile?.() || this.app.workspace.getLeaf(false);
    if (!leaf) {
      if (this.preservingPreviewScrollRequestId === requestId) this.preservingPreviewScrollRequestId = null;
      return;
    }
    await leaf.openFile(file, { active: focusEditor });
    /* Une ouverture peut encore être en vol lorsque le scroll atteint un
       autre feuillet ou qu'un clic explicite choisit une nouvelle cible.
       Seule la requête la plus récente a le droit d'établir le contexte de
       synchronisation : une ancienne promesse ne peut ainsi jamais remettre
       en place le feuillet qu'elle avait capturé. */
    if (this.closed || requestId !== this.openVisibleRequestId) return;
    if (file.parent) this.plugin.settings.binderSelectedPath = file.parent.path;
    // La portée affichée ne change PAS : seul ce feuillet devient la source
    // de synchronisation avec sa section déjà rendue dans l'aperçu.
    this.synchronizedFeuilletPath = file.path;
    await this.plugin.saveSettings?.();
    if (this.closed || requestId !== this.openVisibleRequestId) return;
    if (focusEditor) this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const openedView = (leaf as unknown as { view?: { file?: unknown; contentEl?: HTMLElement } }).view;
    this.bindSourcePane({
      file: openedView?.file instanceof TFile ? openedView.file : file,
      contentEl: openedView?.contentEl || null,
    });
    if (!alignFromPreview) {
      this.applySourceToPreview();
      return;
    }

    this.applyPreviewToSource();
    /* `openFile()` peut faire émettre un dernier scroll du panneau Markdown
       après la résolution de sa promesse. On restaure donc la position
       capturée puis on enlève le garde-fou à la frame suivante. */
    if (this.previewViewport && keptPreviewScrollTop !== null) this.previewViewport.scrollTop = keptPreviewScrollTop;
    this.releaseAfterFrame(() => {
      if (this.preservingPreviewScrollRequestId !== requestId) return;
      this.preservingPreviewScrollRequestId = null;
      if (this.previewViewport && keptPreviewScrollTop !== null) this.previewViewport.scrollTop = keptPreviewScrollTop;
    });
  }

  private binderProjectTitle(root: TFolder): string {
    return this.plugin.projectDisplayName?.(root.path) || root.name;
  }

  private breadcrumbLevels(): Array<{ title: string; mode: PreviewMode }> {
    const active = this.app.workspace.getActiveFile();
    const visible = (this.mode === "chapter" || this.mode === "part" || this.mode === "manuscript") && this.visibleFeuilletPath
      ? this.app.vault.getAbstractFileByPath(this.visibleFeuilletPath)
      : null;
    const contextFile = visible instanceof TFile ? visible : active;
    const root = this.plugin.getProjectFolder();
    if (!(contextFile instanceof TFile) || !root || !this.isPreviewableFile(contextFile)) return [];
    const part = this.partFolderOf(contextFile);
    const chapter = this.scopeForMode("chapter", contextFile);
    const levels: Array<{ title: string; mode: PreviewMode }> = [{ title: this.binderProjectTitle(root), mode: "manuscript" }];
    if (part) levels.push({ title: part.name, mode: "part" });
    if (chapter) levels.push({ title: chapter instanceof TFile ? this.binderFileTitle(chapter) : chapter.name, mode: "chapter" });
    /* Si le chapitre EST le feuillet, il ne paraît qu'une fois. */
    if (!(chapter instanceof TFile && chapter.path === contextFile.path)) {
      levels.push({ title: this.binderFileTitle(contextFile), mode: "scene" });
    }
    return levels;
  }

  /** Fil d'Ariane dérivé de la portée CompileScope active — LA source de
   * vérité de l'Aperçu. Construit la chaîne project → dossiers → fichier à
   * partir de `compileScope`, jamais à partir du fichier actif ni d'un mode
   * parallèle. Retourne `null` quand aucune portée explicite n'est posée
   * (repli hérité sur le fichier actif, voir breadcrumbLevels()). */
  private scopeBreadcrumbLevels(): Array<{ title: string; scope: CompileScope }> | null {
    const root = this.plugin.getProjectFolder();
    const scope = this.compileScope;
    if (!root || !scope) return null;

    const levels: Array<{ title: string; scope: CompileScope }> = [
      { title: this.binderProjectTitle(root), scope: createProjectScope(scope.projectRoot) },
    ];

    if (scope.type === "selection") {
      /* Une sélection ne correspond à AUCUN emplacement unique : on ne doit
         pas inventer de faux dossier ni de faux feuillet dans le fil d'Ariane. */
      return levels;
    }

    /* Un chemin concret à dérouler sous la racine : le DERNIER dossier ou
       feuillet explicitement ouvert dans l'Aperçu (rememberScopedNavigation).
       Toute ouverture réelle file/folder remplit cette mémoire, et le passage
       au niveau Projet ne la vide pas — d'où « Projet › Dossier › Feuillet »
       avec Projet actif. En portée file/folder active, elle déplie volontairement
       la même mémoire : déplier uniquement le chemin réellement possédé, jamais le
       fichier actif d'Obsidian ni un mode parallèle. Le repère n'est réutilisé
       que s'il appartient au SAME projectRoot que la portée active : changer de
       projet ne réaffiche jamais les dossiers/feuillets du projet précédent. */
    let navPath: string | null = null;
    if (this.lastScopedNav && this.lastScopedNav.projectRoot === scope.projectRoot) {
      navPath = this.lastScopedNav.path;
    } else if (scope.type === "file" || scope.type === "folder") {
      /* Sécurité : une portée file/folder explicitement posée fournit toujours
         son propre chemin si la mémoire est absente ou d'un autre projet. */
      navPath = scope.path;
    }

    if (!navPath) {
      /* Ouverture directe au niveau Projet sans historique : uniquement la
         racine. */
      return levels;
    }

    const rootParts = scope.projectRoot.split("/");
    const rel = navPath.split("/").slice(rootParts.length).filter(Boolean);
    const acc: string[] = [];
    rel.forEach((segment, index) => {
      acc.push(segment);
      const nodePath = `${scope.projectRoot}/${acc.join("/")}`;
      const node = this.app.vault.getAbstractFileByPath(nodePath);
      const isLeaf = index === rel.length - 1;
      const fileLeaf = isLeaf && node instanceof TFile;
      const itemScope = fileLeaf
        ? createFileScope(scope.projectRoot, nodePath)
        : createFolderScope(scope.projectRoot, nodePath);
      const title = fileLeaf ? this.binderFileTitle(node) : node instanceof TFolder ? node.name : segment;
      levels.push({ title, scope: itemScope });
    });
    return levels;
  }

  private isCurrentBreadcrumbScope(scope: CompileScope): boolean {
    const current = this.compileScope;
    if (!current) return false;
    if (scope.type !== current.type) return false;
    if (scope.type === "project") return true;
    if (scope.type === "file" || scope.type === "folder") {
      return (scope as { path: string }).path === (current as { path: string }).path;
    }
    return false;
  }

  private renderBreadcrumb(): void {
    const host = this.breadcrumbEl;
    if (!host) return;
    host.empty();

    const scopeLevels = this.scopeBreadcrumbLevels();
    const levels = scopeLevels || [];

    if (!levels.length) {
      const fallbackLevels = this.breadcrumbLevels();
      if (!fallbackLevels.length) {
        host.setText(t("preview.mode.scene"));
        return;
      }
      fallbackLevels.forEach((level, index) => {
        if (index > 0) {
          host.createSpan({ cls: "feuillets-preview-breadcrumb-separator", text: "›" });
        }
        const button = host.createEl("button", { cls: "feuillets-preview-breadcrumb-item", text: level.title });
        const active = this.mode === level.mode;
        button.setAttribute("title", level.title);
        button.setAttribute("aria-label", t("preview.breadcrumb.show", { title: level.title }));
        if (active) {
          button.addClass("is-current");
          button.setAttribute("aria-current", "page");
        } else {
          button.removeClass("is-current");
          button.setAttribute("aria-current", "false");
          if (typeof button.removeAttribute === "function") {
            button.removeAttribute("aria-current");
          }
        }
        button.addEventListener("click", () => {
          if (index === 0) {
            const projectRoot = this.plugin.getProjectFolder();
            if (projectRoot) void this.setCompileScope(createProjectScope(projectRoot.path));
          } else {
            void this.setMode(level.mode);
          }
        });
      });
      return;
    }

    levels.forEach((level, index) => {
      if (index > 0) {
        host.createSpan({ cls: "feuillets-preview-breadcrumb-separator", text: "›" });
      }

      const button = host.createEl("button", {
        cls: "feuillets-preview-breadcrumb-item",
        text: level.title,
      });

      const isCurrent = this.isCurrentBreadcrumbScope(level.scope);

      button.setAttribute("title", level.title);
      button.setAttribute("aria-label", t("preview.breadcrumb.show", { title: level.title }));

      if (isCurrent) {
        button.addClass("is-current");
        button.setAttribute("aria-current", "page");
      } else {
        button.removeClass("is-current");
        button.setAttribute("aria-current", "false");
        if (typeof button.removeAttribute === "function") {
          button.removeAttribute("aria-current");
        }
      }

      button.addEventListener("click", () => {
        void this.setCompileScope(level.scope);
      });
      button.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void this.setCompileScope(level.scope);
      });
    });
  }

  /* ===================== Zoom à la molette / au trackpad ===============
     Cmd (macOS) ou Ctrl (Windows/Linux) + molette. Le pincement trackpad
     est remonté par Electron comme un `wheel` avec `ctrlKey` : il est donc
     pris en charge par le même chemin, sans code spécifique.

     `preventDefault()` n'est appelé QUE dans ce cas et QUE sur le viewport
     de l'aperçu : le zoom global d'Obsidian reste intact partout ailleurs,
     et le défilement vertical sans modificateur n'est jamais intercepté. */

  private onViewportWheel(e: WheelEvent): void {
    if (!e || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault?.();

    const delta = Number(e.deltaY) || 0;
    if (!delta) return;
    let next = this.zoomScale * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY);
    /* Un pincement trackpad envoie de très petits deltas : sans ce pas
       minimal, l'arrondi au centième les avalerait tous et le geste
       paraîtrait mort. */
    if (Math.round(next * 100) === Math.round(this.zoomScale * 100)) {
      next = this.zoomScale + (delta < 0 ? 0.01 : -0.01);
    }
    this.zoomAroundPointer(next, e);
  }

  /** Zoom en conservant, autant que la géométrie le permet, le point du
   * document qui se trouve sous le pointeur. */
  private zoomAroundPointer(scale: number, e: { clientX?: number; clientY?: number }): void {
    const viewport = this.previewViewport;
    if (!viewport) {
      this.setZoom(scale, "manual");
      return;
    }
    const rect = typeof viewport.getBoundingClientRect === "function" ? viewport.getBoundingClientRect() : null;
    const pointerX = rect ? (Number(e.clientX) || 0) - rect.left : 0;
    const pointerY = rect ? (Number(e.clientY) || 0) - rect.top : 0;

    const beforeWidth = Number(viewport.scrollWidth) || 0;
    const beforeHeight = Number(viewport.scrollHeight) || 0;
    const fx = beforeWidth > 0 ? ((Number(viewport.scrollLeft) || 0) + pointerX) / beforeWidth : 0;
    const fy = beforeHeight > 0 ? (viewport.scrollTop + pointerY) / beforeHeight : 0;

    this.setZoom(scale, "manual");

    const afterWidth = Number(viewport.scrollWidth) || 0;
    const afterHeight = Number(viewport.scrollHeight) || 0;
    if (beforeWidth > 0 && afterWidth > 0) viewport.scrollLeft = Math.max(0, fx * afterWidth - pointerX);
    if (beforeHeight > 0 && afterHeight > 0) viewport.scrollTop = Math.max(0, fy * afterHeight - pointerY);
  }

  /* ===================== Zoom, géométrie, position ==================== */

  private frameTopWithinScroll(): number {
    const viewport = this.previewViewport;
    const frame = this.previewFrame;
    if (!viewport || !frame) return 0;
    if (typeof frame.getBoundingClientRect !== "function" || typeof viewport.getBoundingClientRect !== "function") {
      return 0;
    }
    return frame.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  }

  private captureScrollAnchor(): ScrollAnchor | null {
    const viewport = this.previewViewport;
    const doc = this.previewFrame?.contentDocument;
    if (!viewport || !doc) return null;

    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".pdf-page"));
    if (!pages.length) return null;

    const scrollTop = viewport.scrollTop;
    const stackTop = this.frameTopWithinScroll();
    const scale = this.zoomScale;

    for (let i = pages.length - 1; i >= 0; i--) {
      const pageTop = stackTop + pages[i].offsetTop * scale;
      if (scrollTop >= pageTop || i === 0) {
        const pageHeight = pages[i].offsetHeight * scale;
        const progress = pageHeight > 0 ? (scrollTop - pageTop) / pageHeight : 0;
        return { pageIndex: i, pageProgress: progress };
      }
    }
    return null;
  }

  private restoreScrollAnchor(anchor: ScrollAnchor | null): void {
    if (!anchor) return;
    const viewport = this.previewViewport;
    const doc = this.previewFrame?.contentDocument;
    if (!viewport || !doc) return;

    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".pdf-page"));
    if (!pages.length) return;

    const index = Math.max(0, Math.min(anchor.pageIndex, pages.length - 1));
    const page = pages[index];
    const scale = this.zoomScale;
    const pageTop = this.frameTopWithinScroll() + page.offsetTop * scale;
    viewport.scrollTop = Math.max(0, pageTop + anchor.pageProgress * page.offsetHeight * scale);
  }

  /** Mesure la taille naturelle (NON transformée) — via offsetWidth/Height,
   * qui ignorent `transform`. Mesure `.feuillets-preview-pages` (l'élément
   * réellement transformé) et non son wrapper : voir le contrat de
   * géométrie dans ui/template-preview.ts. */
  private measureNaturalDimensions(): void {
    if (!this.previewFrame) return;
    const doc = this.previewFrame.contentDocument;
    if (!doc) return;

    const pages = doc.querySelector<HTMLElement>(".feuillets-preview-pages");
    if (pages) this.naturalPagesHeight = pages.offsetHeight;

    const firstPage = doc.querySelector<HTMLElement>(".pdf-page");
    if (firstPage) {
      this.naturalPageWidth = firstPage.offsetWidth;
      this.naturalPageHeight = firstPage.offsetHeight;
    }
  }

  setZoom(scale: number, mode: ZoomMode): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(scale * 100) / 100));
    this.zoomScale = clamped;
    this.zoomMode = mode;

    if (!this.frameLoaded) {
      this.pendingZoom = { scale: clamped, mode };
      this.updateUI();
      return;
    }

    this.applyZoomToFrame(clamped);
    this.updateUI();
  }

  private applyZoomToFrame(scale: number): void {
    const frame = this.previewFrame;
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc || !doc.documentElement) return;

    doc.documentElement.style.setProperty("--feuillets-preview-scale", String(scale));

    if (this.naturalPageWidth != null) {
      frame.style.width = `${Math.round(this.naturalPageWidth * scale)}px`;
    }
    if (this.naturalPagesHeight != null) {
      frame.style.height = `${Math.round(this.naturalPagesHeight * scale)}px`;
    }

    this.updateOverflowMode();
  }

  private updateOverflowMode(): void {
    this.previewViewport?.toggleClass("is-manual-zoom", this.zoomMode === "manual");
    this.scaledContainer?.toggleClass("is-fit-page", this.zoomMode === "fit-page");
  }

  /** Double-clic sur le pourcentage : retour à 100 %. Le menu que le
   * premier clic vient d'ouvrir est refermé — sinon il resterait affiché
   * au-dessus d'un zoom déjà remis à sa valeur. */
  resetZoom(): void {
    this.openMenu?.hide?.();
    this.openMenu = null;
    this.setZoom(1, "manual");
  }

  private activateAutoMode(mode: "fit-width" | "fit-page"): void {
    this.zoomMode = mode;
    this.recalculateAutoZoom();
  }

  /** Calcule le zoom automatique à partir de la largeur RÉELLE de
   * `.feuillets-preview-viewport` — jamais `window.innerWidth` ni la
   * largeur globale de l'espace de travail. */
  private recalculateAutoZoom(): void {
    if (this.zoomMode === "manual") return;
    const viewport = this.contentEl.querySelector<HTMLElement>(".feuillets-preview-viewport");
    if (!viewport || this.naturalPageWidth == null || this.naturalPageHeight == null) return;

    const availableWidth = Math.max(
      100,
      viewport.clientWidth - horizontalPaddingOf(viewport) - VIEWPORT_SAFETY_MARGIN
    );

    if (this.zoomMode === "fit-page") {
      const availableHeight = Math.max(
        100,
        viewport.clientHeight - verticalPaddingOf(viewport) - VIEWPORT_SAFETY_MARGIN
      );
      const scale = Math.min(availableWidth / this.naturalPageWidth, availableHeight / this.naturalPageHeight);
      this.setZoom(floorToCent(scale), "fit-page");
    } else {
      this.setZoom(floorToCent(availableWidth / this.naturalPageWidth), "fit-width");
    }
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.openVisibleRequestId++;
    this.rerunRequested = false;
    if (this.autoOpenVisibleTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.autoOpenVisibleTimer);
      this.autoOpenVisibleTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.cancelSceneRefresh();
    this.syncScrollerCleanup?.();
    this.syncScrollerCleanup = null;
    this.syncScroller = null;
    this.syncHost = null;
    this.cancelFrame(this.syncHandle);
    this.syncHandle = null;
    this.syncJob = null;
    for (const handle of this.releaseHandles) this.cancelFrame(handle);
    this.releaseHandles = [];
    this.refreshGeneration++;
    this.refreshInFlight = false;
    this.pendingFrame = null;
    this.previewFrame = null;
    this.previewViewport = null;
    this.scaledContainer = null;
    this.zoomLabelEl = null;
    this.statusEl = null;
    this.viewEl = null;
    this.breadcrumbEl = null;
    this.btnExport = null;
    this.btnSettings = null;
    this.exportScopeLabelEl = null;
    this.compileScope = null;
    this.lastScopedNav = null;
    this.openVisibleEl = null;
    this.btnBarToggle = null;
    this.exportPanelEl = null;
    this.firstPageBodyEl = null;
    this.openMenu = null;
    this.contentEl.empty();
  }
}

/**
 * Ouvre ou révèle l'onglet d'aperçu. Une PreviewView déjà ouverte est
 * réutilisée plutôt que dupliquée.
 */
export async function activatePreviewView(app: App): Promise<WorkspaceLeaf | null> {
  const { workspace } = app;
  let leaf: WorkspaceLeaf | null = null;
  const leaves = workspace.getLeavesOfType(VIEW_PREVIEW);

  if (leaves.length > 0) {
    leaf = leaves[0];
  } else {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_PREVIEW, active: true });
  }

  if (leaf) void workspace.revealLeaf(leaf);
  return leaf;
}

interface ScopeableView {
  setCompileScope(scope: CompileScope): Promise<void>;
}

function isScopeableView(view: unknown): view is ScopeableView {
  return (
    typeof view === "object" &&
    view !== null &&
    "setCompileScope" in view &&
    typeof view.setCompileScope === "function"
  );
}

/**
 * Helper unique pour récupérer ou créer la vue Preview, l'activer et lui transmettre une portée explicite CompileScope.
 */
export async function openScopeWithPreview(app: App, scope: CompileScope): Promise<void> {
  const leaf = await activatePreviewView(app);
  /* Une feuille révélée peut rester une vue DIFFÉRÉE (Obsidian ≥ 1.7) : son
     `.view` est alors un simple placeholder sans `setCompileScope`, et l'appel
     ci-dessous échouerait silencieusement (garde de type). Il faut forcer le
     chargement de la vraie instance avant d'y accéder — même schéma que
     `FeuilletsPlugin.loadDeferredViews()`. */
  if (leaf?.isDeferred) await leaf.loadIfDeferred();
  const view = leaf?.view;
  if (isScopeableView(view)) {
    await view.setCompileScope(scope);
  }
}

/**
 * Ajoute l'entrée « Ouvrir avec aperçu » à un menu contextuel, si et
 * seulement si `file` est un feuillet Markdown ÉDITABLE du projet.
 *
 * Extrait en fonction autonome parce que le Binder construit son propre
 * `Menu` (BaseFeuilletsView.showFileContextMenu) et ne passe pas par le
 * hook `workspace.on("file-menu")` : l'entrée doit être ajoutable aux deux
 * endroits sans dupliquer ni la condition, ni le comportement.
 *
 * La condition portait auparavant sur `roleOfFile(...) === "scene"`. C'était
 * la cause du défaut confirmé manuellement : dans une structure
 * Partie → feuillets (le cas dès que `level1Role` vaut « parties »),
 * `roleOfFile` classe ces feuillets « chapitre », et l'entrée n'apparaissait
 * donc JAMAIS au clic droit — alors que l'aperçu Scène sait parfaitement
 * afficher n'importe quel feuillet. Le rôle éditorial n'a rien à décider
 * ici : ce qui compte est « ce fichier s'ouvre-t-il dans un éditeur ». Les
 * dossiers (parties, chapitres) passent par `showFolderContextMenu` et
 * n'atteignent jamais cette fonction.
 *
 * @returns true si l'entrée a été ajoutée.
 */
export function addOpenWithPreviewItem(
  menu: { addItem(cb: (item: MenuItemLike) => void): unknown },
  app: App,
  plugin: PreviewViewPlugin,
  file: TFile
): boolean {
  if (!(file instanceof TFile) || file.extension !== "md") return false;
  const root = plugin.getProjectFolder();
  if (!root) return false;
  if (file.path !== root.path && !file.path.startsWith(`${root.path}/`)) return false;
  // Le manuscrit compilé est une SORTIE, pas un feuillet à écrire.
  if (file.name === plugin.settings.compileFileName) return false;
  menu.addItem((item) => {
    item.setTitle(t("shared.contextMenu.openWithPreview"));
    item.setIcon("eye");
    item.onClick(() => {
      void openWithPreview(app, plugin, file);
    });
  });
  return true;
}

/** Sous-ensemble de MenuItem réellement utilisé ici. */
type MenuItemLike = {
  setTitle(title: string): unknown;
  setIcon(icon: string): unknown;
  onClick(cb: () => void): unknown;
  /* Optionnel : tous les menus n'affichent pas de coche, et l'entrée
     « Ouvrir avec aperçu » n'en a pas besoin. */
  setChecked?(checked: boolean): unknown;
};

/**
 * « Ouvrir avec aperçu » : le feuillet dans la feuille courante, l'aperçu
 * dans une feuille ADJACENTE (split vertical), en mode Scène.
 *
 * Réutilise une PreviewView déjà ouverte plutôt que d'en empiler une
 * seconde, et ne force aucune largeur : l'utilisatrice reste libre de
 * redimensionner ou déplacer les feuilles ensuite.
 */
export async function openWithPreview(
  app: App,
  plugin: PreviewViewPlugin,
  file: TFile
): Promise<void> {
  const { workspace } = app;

  // 1. Le feuillet, dans la feuille active (ou une nouvelle si aucune).
  const editorLeaf = workspace.getLeaf(false);
  await editorLeaf.openFile(file, { active: true });

  // 2. Résoudre le projectRoot et construire la portée file.
  const root = plugin.getProjectFolder();
  const projectRootPath = root ? root.path : (file.parent ? file.parent.path : file.path);
  const fileScope = createFileScope(projectRootPath, file.path);

  // Conservé temporairement pour compatibilité
  plugin.settings.previewMode = "scene";
  await plugin.saveSettings?.();

  // 3. Une feuille adjacente, sauf si un aperçu est déjà ouvert quelque part.
  const existing = workspace.getLeavesOfType(VIEW_PREVIEW);
  let previewLeaf: WorkspaceLeaf | null = existing[0] || null;
  if (!previewLeaf) {
    previewLeaf = workspace.getLeaf("split");
    await previewLeaf.setViewState({ type: VIEW_PREVIEW, active: false });
  }
  if (previewLeaf) void workspace.revealLeaf(previewLeaf);

  /* Une feuille d'aperçu réutilisée (`existing[0]`, restaurée par la mise en
     page d'Obsidian) peut être une vue DIFFÉRÉE : son `.view` n'est alors
     qu'un placeholder sans `setCompileScope`, et l'étape 4 échouerait sans le
     moindre avertissement. La breadcrumb « Projet › Dossier › Feuillet » se
     réaffichait alors par coïncidence via le repli historique sur le fichier
     actif (breadcrumbLevels()), sans jamais poser la vraie portée ni remplir
     lastScopedNav — d'où l'effondrement au clic sur « Projet » : la toute
     première portée jamais reçue par l'instance réelle. */
  if (previewLeaf?.isDeferred) await previewLeaf.loadIfDeferred();

  // 4. Transmettre la portée file à l'instance réelle de PreviewView.
  const view = previewLeaf?.view as PreviewView | undefined;
  if (view && typeof view.setCompileScope === "function") {
    await view.setCompileScope(fileScope);
  }

  // 5. Le focus reste à l'écriture, pas à l'aperçu.
  workspace.setActiveLeaf(editorLeaf, { focus: true });
}
