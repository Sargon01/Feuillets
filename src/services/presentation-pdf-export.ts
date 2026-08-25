/* Export PDF de la Présentation, en 16:9 (projection) ou A4 paysage
 * (impression papier) au choix de l'auteur — RÉUTILISE le même pipeline que
 * l'aperçu, jamais un second moteur de rendu :
 *
 *   Markdown du fichier
 *   → planPresentationSlides() (../services/presentation-slide-planner.ts)
 *   → renderPresentationSlide() PAR SLIDE (../services/presentation-slide-renderer.ts)
 *   → DOM final de chaque slide (candidats FLOW/SPLIT/STACK déjà résolus)
 *   → document d'impression (iframe isolée, styles Obsidian courants clonés)
 *   → dialogue système d'impression → « Enregistrer en PDF »
 *
 * Aucun second parser Markdown, aucune pagination Document/Paged.js, aucune
 * réimplémentation de FLOW/SPLIT/STACK ou du contain : APERÇU = PDF, dans la
 * limite de ce que permet l'impression Chromium. Même principe d'iframe
 * d'impression que ../services/export-pdf.ts, mais jamais sa pagination
 * Document.
 *
 * TROIS sorties partagent CE SEUL fichier et TROIS briques communes :
 *  - preparePresentationExport() : lecture Markdown → planification →
 *    rendu réel de chaque slide → médias stabilisés. Chemin UNIQUE.
 *  - printPresentationDeck() : assemblage de l'iframe d'impression isolée
 *    (styles Obsidian clonés, feuille d'impression posée en dernier,
 *    attente load/300ms, médias, focus→print, cleanup différé). Chemin
 *    UNIQUE.
 *  - ./presentation-a4-composition.ts : découpage en pages, grille A4,
 *    frame 16:9 + contain, sauts de page. Chemin UNIQUE de toute
 *    pagination papier multi-diapositives.
 *
 * Les trois sorties ne sont que des COMPOSITIONS différentes de ces mêmes
 * briques, jamais des pipelines divergents :
 *   Présentation → 1 diapositive par page (16:9 ou A4 paysage) ;
 *   Support      → 2 ou 4 diapositives par page A4 portrait (public) ;
 *   Plan         → 4 diapositives par page + notes personnelles (présentateur).
 */
import { Notice, type App, type Component, type TFile } from "obsidian";
import { planPresentationSlides } from "./presentation-slide-planner.js";
import type { PresentationSlideSource } from "./presentation.js";
import {
  renderPresentationSlide,
  PRESENTATION_SLIDE_WIDTH,
  PRESENTATION_SLIDE_HEIGHT,
  type RenderedPresentationSlide,
} from "./presentation-slide-renderer.js";
import type { PresentationLayoutOverride } from "./presentation-layout-engine.js";
import { getProjectFolder } from "./folder-structure.js";
import { loadLayoutStore, layoutOverridesForFile, relativeLayoutFilePath, type LayoutOverride } from "./layout-store.js";
import { resolvePresentationSlideLayouts, presentationPlanningOverrides } from "./presentation-layout-overrides.js";
import { getPresentationTheme, getRoleEditorDisplay } from "../utils/presentation-helpers.js";
import { pendingMediaOf, waitForMediaBatch, PRESENTATION_MEDIA_TIMEOUT_MS } from "../utils/presentation-media.js";
import { t } from "../i18n/index.js";
import { annotationsForFile, AnnotationsFileCorruptedError, loadAnnotations, toManuscriptRelativePath } from "./annotations.js";
import {
  mapPresentationNotesToSlides,
  type PresentationPlanItem,
  type PresentationPlanNote,
  type PresentationPlanScope,
} from "./presentation-plan.js";
import {
  A4_GRID_2_PER_PAGE,
  A4_GRID_4_PER_PAGE,
  A4_GRID_6_PER_PAGE,
  createRuledNoteLines,
  A4_PORTRAIT_PAGE_SIZE,
  applyA4PageBreaks,
  chunkIntoPages,
  createA4Page,
  createThumbnailFrame,
  fitPresentationThumbnails,
  slotsPerPage,
  styleEl,
  type A4Grid,
} from "./presentation-a4-composition.js";

/**
 * Format PHYSIQUE de la page imprimée — deux usages réellement différents :
 *
 *  - `"16:9"` : la page adopte EXACTEMENT le rapport de la slide composée
 *    (1280×720), pour une projection directe (vidéoprojecteur, lecteur PDF en
 *    plein écran) — aucune marge, aucune bande vide.
 *  - `"a4-landscape"` : format papier standard, pour un support imprimé. La
 *    slide y est réduite et centrée (voir printPageGeometry) : un rapport
 *    16:9 ne tient jamais exactement dans une feuille A4 (rapport 1,414).
 *
 * Obligatoire, jamais de valeur par défaut silencieuse : les deux usages sont
 * trop différents pour qu'un choix implicite soit correct dans les deux cas.
 */
export type PresentationPdfPageFormat = "16:9" | "a4-landscape";

export interface ExportPresentationPdfOptions {
  app: App;
  component: Component;
  file: TFile;
  /** Mêmes réglages Feuillets que ceux du plugin — sert UNIQUEMENT à lire les
   * overrides déjà stockés dans layout.json (dispositions manuelles et sauts
   * explicites), exactement comme le font déjà PresentationView et
   * PresentationPreviewView. Aucune autre utilisation. */
  settings: FeuilletsSettings | null | undefined;
  pageFormat: PresentationPdfPageFormat;
}

export interface ExportPresentationPlanPdfOptions {
  app: App;
  component: Component;
  file: TFile;
  settings: FeuilletsSettings | null | undefined;
  scope: PresentationPlanScope;
}

/** Verrou module : empêche deux exports PDF Présentation simultanés (jamais deux iframes). */
let isPresentationPdfExportInProgress = false;

/** Même principe de cleanup différé que ../services/export-pdf.ts : laisse le temps à `print()` de
 * réellement partir avant de supprimer l'iframe qui héberge le document imprimé. */
const IFRAME_CLEANUP_DELAY_MS = 10000;

/* Page physique A4 PAYSAGE (format papier) — utilisée UNIQUEMENT pour
 * pageFormat "a4-landscape". Les slides, elles, restent composées en
 * 1280×720 par le moteur de layout — jamais recomposées ici. */
const PRINT_PAGE_WIDTH_MM = 297;
const PRINT_PAGE_HEIGHT_MM = 210;

function mmToCssPx(mm: number): number {
  return (mm * 96) / 25.4;
}

interface PrintPageGeometry {
  /** Valeur CSS `@page { size: ... }`. */
  atPageSize: string;
  pageWidthCss: string;
  pageHeightCss: string;
  /** Échelle « contain » de la slide dans la page — 1 pour le 16:9 pur (la
   * page EST la boîte de composition, rien à réduire). */
  scale: number;
}

/**
 * Géométrie de la page imprimée pour un format donné.
 *
 * `"16:9"` : dimensions en PIXELS, identiques à PRESENTATION_SLIDE_WIDTH/
 * HEIGHT — pas de conversion en unité physique (mm/in), donc aucun risque
 * d'arrondi. C'est un choix DÉLIBÉRÉ après l'incident du format papier :
 * `size: 13.333333in 7.5in` (deux longueurs en pouces à décimales infinies)
 * était retombé en A4 portrait dans le pipeline d'impression réel, alors que
 * `size: A4 landscape` (nom de format + mot-clé) fonctionne de façon fiable.
 * `px` reste une longueur CSS valide pour `@page size`, mais ce point précis
 * — Chromium l'honore-t-il dans CE pipeline (iframe + `contentWindow.print()`)
 * — n'est PAS vérifiable par les tests FakeDOM de ce fichier : ils testent le
 * DOM construit, jamais le rendu Chromium réel (voir la note en tête de
 * fichier). Un test manuel dédié est nécessaire.
 *
 * `"a4-landscape"` : format papier standard, nom + mot-clé (voir
 * physicalPageGeometry dans ../services/export-pdf.ts, le pipeline PDF
 * Document déjà éprouvé). Le rapport A4 paysage (1,414) ne tient jamais
 * exactement le rapport 16:9 (1,778) : la slide y est réduite et centrée,
 * jamais étirée ni recadrée — cohérent avec « aperçu = PDF ».
 */
function printPageGeometry(format: PresentationPdfPageFormat): PrintPageGeometry {
  if (format === "16:9") {
    return {
      atPageSize: `${PRESENTATION_SLIDE_WIDTH}px ${PRESENTATION_SLIDE_HEIGHT}px`,
      pageWidthCss: `${PRESENTATION_SLIDE_WIDTH}px`,
      pageHeightCss: `${PRESENTATION_SLIDE_HEIGHT}px`,
      scale: 1,
    };
  }
  const pageWidthPx = mmToCssPx(PRINT_PAGE_WIDTH_MM);
  const pageHeightPx = mmToCssPx(PRINT_PAGE_HEIGHT_MM);
  return {
    atPageSize: "A4 landscape",
    pageWidthCss: `${PRINT_PAGE_WIDTH_MM}mm`,
    pageHeightCss: `${PRINT_PAGE_HEIGHT_MM}mm`,
    scale: Math.min(pageWidthPx / PRESENTATION_SLIDE_WIDTH, pageHeightPx / PRESENTATION_SLIDE_HEIGHT),
  };
}

function isPrintableIframe(iframe: HTMLIFrameElement): iframe is HTMLIFrameElement & { contentDocument: Document; contentWindow: Window } {
  return iframe.contentDocument !== null && iframe.contentWindow !== null;
}

/**
 * Overrides layout.json du feuillet — mêmes fonctions publiques que
 * PresentationView et PresentationPreviewView (`loadLayoutStore` +
 * `layoutOverridesForFile`), jamais une seconde lecture divergente. Liste
 * vide si le fichier n'est pas sous le dossier du projet actif.
 */
async function loadPresentationOverrides(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  file: TFile,
): Promise<readonly LayoutOverride[]> {
  const root = getProjectFolder(app, settings);
  const relative = root ? relativeLayoutFilePath(root.path, file.path) : null;
  if (relative === null) return [];
  return layoutOverridesForFile(await loadLayoutStore(app, settings), relative);
}

/** Dispositions manuelles ramenées aux slides RÉELLEMENT planifiées, pour le
 * rendu. Distinct de la résolution faite pour la planification (segments
 * explicites) : ce sont deux projections du MÊME stockage, obtenues par la
 * même fonction publique, jamais deux logiques concurrentes. */
function slideLayoutsForRenderedSlides(
  markdown: string,
  slides: readonly PresentationSlideSource[],
  overrides: readonly LayoutOverride[],
): Map<number, PresentationLayoutOverride> {
  const resolved = resolvePresentationSlideLayouts(markdown, slides, overrides);
  const layouts = new Map<number, PresentationLayoutOverride>();
  for (const [index, override] of resolved) layouts.set(index, override.layout);
  return layouts;
}

type BuiltSlide = { record: RenderedPresentationSlide; resolvedDuringBuild: boolean };

/**
 * Construit UNE slide avec le vrai renderer de production, avec exactement le
 * même contexte fonctionnel que les vues actuelles (app, component,
 * sourcePath, markdown, index, generation, roleEditorDisplay, theme).
 * `onMediaResolved` note seulement qu'une image jusque-là non chargée s'est
 * résolue PENDANT cette construction — jamais de reconstruction ici même :
 * cette responsabilité reste à l'appelant (voir stabiliseMedias plus bas).
 */
async function buildSlide(
  app: App,
  component: Component,
  sourcePath: string,
  markdown: string,
  index: number,
  generation: number,
  measurementHost: HTMLElement,
  deckContainer: HTMLElement,
  roleEditorDisplay: "callouts" | "compact" | undefined,
  theme: ReturnType<typeof getPresentationTheme>,
  layoutOverride: PresentationLayoutOverride | null,
): Promise<BuiltSlide> {
  const controller = new AbortController();
  let resolvedDuringBuild = false;
  const record = await renderPresentationSlide({
    app,
    component,
    sourcePath,
    markdown,
    index,
    generation,
    measurementHost,
    deckContainer,
    controller,
    isGenerationStale: () => false,
    onMediaResolved: () => { resolvedDuringBuild = true; },
    roleEditorDisplay,
    theme,
    layoutOverride,
  });
  return { record, resolvedDuringBuild };
}

/**
 * Rend TOUTES les slides finales avec le renderer réel, SÉQUENTIELLEMENT
 * (jamais en parallèle : measurementHost/deckContainer sont partagés, et
 * l'ordre des slides dans deckContainer doit rester l'ordre du planner) puis
 * stabilise les médias non chargés : attente bornée en LOT, puis
 * reconstruction UNE SEULE FOIS des slides concernées.
 */
async function renderAndStabilizeSlides(
  app: App,
  component: Component,
  sourcePath: string,
  slidesMarkdown: readonly string[],
  measurementHost: HTMLElement,
  deckContainer: HTMLElement,
  roleEditorDisplay: "callouts" | "compact" | undefined,
  theme: ReturnType<typeof getPresentationTheme>,
  layoutOverrides: ReadonlyMap<number, PresentationLayoutOverride>,
): Promise<RenderedPresentationSlide[]> {
  const records: RenderedPresentationSlide[] = [];
  const pendingIndexes: number[] = [];
  for (let index = 0; index < slidesMarkdown.length; index++) {
    const layoutOverride = layoutOverrides.get(index) ?? null;
    const built = await buildSlide(app, component, sourcePath, slidesMarkdown[index], index, 0, measurementHost, deckContainer, roleEditorDisplay, theme, layoutOverride);
    records.push(built.record);
    if (built.resolvedDuringBuild || pendingMediaOf(built.record.section).length > 0) pendingIndexes.push(index);
  }

  if (pendingIndexes.length > 0) {
    const batch = pendingIndexes.flatMap((index) => pendingMediaOf(records[index].section));
    await waitForMediaBatch(batch, PRESENTATION_MEDIA_TIMEOUT_MS);

    for (const index of pendingIndexes) {
      const layoutOverride = layoutOverrides.get(index) ?? null;
      const rebuilt = await buildSlide(app, component, sourcePath, slidesMarkdown[index], index, 1, measurementHost, deckContainer, roleEditorDisplay, theme, layoutOverride);
      records[index].controller.abort();
      records[index].section.remove();
      records[index] = rebuilt.record;
    }
  }

  return records;
}

/** Résultat de la préparation commune — CHEMIN UNIQUE utilisé par les deux
 * exports (voir en-tête de fichier). Rien de spécifique au format papier ni
 * à la composition finale : juste le Markdown, les slides planifiées et le
 * DOM final déjà rendu/stabilisé de chacune, dans `renderRoot` (détaché du
 * document, à retirer par l'appelant une fois l'impression terminée). */
interface PreparedPresentationExport {
  markdown: string;
  slides: PresentationSlideSource[];
  records: RenderedPresentationSlide[];
  renderRoot: HTMLElement;
}

/**
 * Lecture Markdown → overrides layout.json → planification (même fonction
 * que l'aperçu) → rendu réel de CHAQUE slide finale → stabilisation des
 * médias. Retourne `null` si le feuillet ne produit aucune slide — à
 * l'appelant de notifier (le message diffère selon le contexte : présentation
 * classique ou plan). N'attache `renderRoot` au document QUE si des slides
 * existent réellement à rendre.
 */
async function preparePresentationExport(
  app: App,
  component: Component,
  file: TFile,
  settings: FeuilletsSettings | null | undefined,
): Promise<PreparedPresentationExport | null> {
  const markdown = await app.vault.read(file);
  const roleEditorDisplay = getRoleEditorDisplay(app);
  const theme = getPresentationTheme(app, file.path);
  /* Mêmes overrides que l'aperçu, et surtout appliqués au MÊME moment :
     la planification doit connaître les dispositions manuelles et les sauts
     explicites, sans quoi le PDF serait découpé autrement que l'aperçu. */
  const overrides = await loadPresentationOverrides(app, settings, file);
  const planning = presentationPlanningOverrides(markdown, overrides);
  const slides = await planPresentationSlides({
    app, component, sourcePath: file.path, markdown, roleEditorDisplay, theme,
    slideLayouts: planning.slideLayouts,
    forcedBreakLines: planning.forcedBreakLines,
  });
  if (slides.length === 0) return null;

  const layoutOverrides = slideLayoutsForRenderedSlides(markdown, slides, overrides);

  const renderRoot = document.body.createDiv({ cls: "feuillets-presentation-pdf-export-root" });
  styleEl(renderRoot, { position: "absolute", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  try {
    const measurementHost = renderRoot.createDiv({ cls: "feuillets-presentation-pdf-export-measurement" });
    const deckContainer = renderRoot.createDiv({ cls: "feuillets-presentation-pdf-export-deck" });
    styleEl(measurementHost, { width: `${PRESENTATION_SLIDE_WIDTH}px`, height: `${PRESENTATION_SLIDE_HEIGHT}px` });
    styleEl(deckContainer, { width: `${PRESENTATION_SLIDE_WIDTH}px`, height: `${PRESENTATION_SLIDE_HEIGHT}px` });

    const records = await renderAndStabilizeSlides(
      app, component, file.path, slides.map((slide) => slide.markdown),
      measurementHost, deckContainer, roleEditorDisplay, theme, layoutOverrides,
    );

    return { markdown, slides, records, renderRoot };
  } catch (error) {
    // Rien à mesurer/imprimer : ne laisse jamais un renderRoot partiellement
    // construit accroché au document principal si le rendu échoue en route.
    renderRoot.remove();
    throw error;
  }
}

/**
 * Construit la page d'impression d'UNE slide, assemblée dans le document
 * PRINCIPAL (détachée), puis importée EN UNE FOIS dans le document
 * d'impression par l'appelant :
 *
 *   .feuillets-presentation-print-page (taille/overflow/coupure de page)
 *   └── section de slide clonée, explicitement visible
 *
 * Le renderer pose `position: absolute; inset: 0; visibility: hidden` sur
 * `section` pour ses besoins de MESURE hors écran (measurementHost) — un état
 * qui n'a plus aucun sens une fois sorti de ce contexte : le clone est donc
 * réinitialisé en flux normal (`position: static`), explicitement visible
 * (`display: block; visibility: visible; opacity: 1`), et redimensionné
 * pour remplir la page plutôt que de dépendre d'un ancêtre positionné (le
 * measurementHost/deckContainer d'origine) qui n'existe plus dans l'iframe.
 * Aucun état "actif"/"courant" d'une vue interactive n'est requis ici : une
 * page imprimée est TOUJOURS visible, par construction.
 */
function buildPrintPage(section: HTMLElement, geometry: PrintPageGeometry): HTMLElement {
  const page = createDiv({ cls: "feuillets-presentation-print-page" });
  styleEl(page, {
    width: geometry.pageWidthCss,
    height: geometry.pageHeightCss,
    margin: "0",
    padding: "0",
    overflow: "hidden",
    position: "relative",
    // Centre la slide dans la page : en 16:9 pur (scale 1, mêmes dimensions)
    // c'est un no-op visuel ; en A4 paysage, les bandes résiduelles sont
    // réparties également en haut et en bas.
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const clone = section.cloneNode(true) as HTMLElement;
  clone.classList.add("is-active");
  styleEl(clone, {
    position: "static",
    inset: "auto",
    // Conserve la taille de composition RÉELLE (1280×720) : c'est celle sur
    // laquelle le moteur de layout a mesuré et choisi ses candidats. Seule
    // une transformation d'échelle l'adapte ensuite à la page — jamais un
    // redimensionnement de boîte, qui relancerait une mise en page
    // différente de l'aperçu.
    width: `${PRESENTATION_SLIDE_WIDTH}px`,
    height: `${PRESENTATION_SLIDE_HEIGHT}px`,
    flex: "none",
    margin: "0",
    padding: "0",
    display: "block",
    visibility: "visible",
    opacity: "1",
    pointerEvents: "auto",
    transform: `scale(${geometry.scale})`,
    transformOrigin: "center center",
  });
  page.appendChild(clone);
  return page;
}

/* Classe d'impression PROPRE À OBSIDIAN. app.css contient, dans son bloc
 * `@media print` :
 *
 *   body > :not(.print) { display: none !important; }
 *
 * Comme l'export clone les feuilles de style de la fenêtre Obsidian courante
 * (pour garder thèmes/rôles/callouts identiques à l'aperçu), cette règle
 * arrive AUSSI dans le document d'impression et masque le deck — un
 * `!important` qu'aucune spécificité ne peut battre. La seule façon correcte
 * de s'en sortir est celle prévue par Obsidian lui-même : porter la classe
 * `print`, si bien que `:not(.print)` cesse de matcher. Aucun `!important`
 * ajouté de notre côté. */
const OBSIDIAN_PRINT_ROOT_CLASS = "print";

/** Feuille d'impression PARTAGÉE par les deux exports : `@page`, reset,
 * `print-color-adjust`, et la règle de saut de page pour les pages qui
 * portent la classe `.feuillets-presentation-print-page` (Présentation
 * classique). Le Plan de présentation n'utilise PAS cette classe sur ses
 * propres pages (`.feuillets-presentation-plan-page`) : ses sauts de page
 * sont posés directement en style inline par buildPresentationPlanDeck()
 * (voir plus bas) — ces deux règles restent donc inertes pour lui, sans
 * conflit ni duplication d'une seconde feuille d'impression. */
function printStyle(atPageSize: string): string {
  return `
@page {
  size: ${atPageSize};
  margin: 0;
}
html, body {
  margin: 0;
  padding: 0;
}
.feuillets-presentation-print-deck {
  display: block;
  margin: 0;
  padding: 0;
  /* Les slides ont des fonds/couleurs de thème : sans cela Chromium les
     supprime à l'impression et ne garde que le texte. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.feuillets-presentation-print-page {
  break-after: page;
  page-break-after: always;
}
.feuillets-presentation-print-page:last-child {
  break-after: auto;
  page-break-after: auto;
}
`;
}

/**
 * Assemble et lance l'impression d'un deck déjà construit — CHEMIN UNIQUE
 * d'impression pour les deux exports (voir en-tête de fichier) :
 *
 *   création iframe → contentDocument/contentWindow vérifiés → doc.open()
 *   → squelette HTML → clonage des <style>/<link> Obsidian courants
 *   → NOTRE feuille d'impression ajoutée EN DERNIER → import du deck fourni
 *   → doc.replaceChildren/doc.close() → attente load OU repli 300ms
 *   → `afterImport` éventuel (le deck importé peut différer du deck
 *     d'origine : géométrie recalculée par le document d'impression lui-même)
 *   → attente médias bornée → focus() → print() → cleanup différé.
 *
 * `deck` est importé EN UNE SEULE FOIS (jamais nœud par nœud). Verrou
 * anti-double-export, attente média bornée, repli 300ms, absence de
 * `fonts.ready`/`requestAnimationFrame`, focus avant print, cleanup à 10s :
 * mécanismes déjà éprouvés, strictement conservés ici, inchangés pour la
 * Présentation classique.
 */
async function printPresentationDeck(options: {
  deck: HTMLElement;
  atPageSize: string;
  title: string;
  afterImport?: (importedBody: HTMLElement) => void;
}): Promise<void> {
  const iframe = document.body.createEl("iframe", { cls: "feuillets-presentation-pdf-print-frame" });
  styleEl(iframe, { position: "absolute", left: "-100000px", top: "0", width: "0", height: "0", border: "0" });
  let cleanupScheduled = false;
  try {
    if (!isPrintableIframe(iframe)) throw new Error("Impossible de préparer la fenêtre d'impression PDF.");
    // Référence stable capturée pour les closures ci-dessous (`iframe`, en
    // portée englobante, redevient `HTMLIFrameElement | null` aux yeux du
    // vérificateur de types dans une fermeture asynchrone).
    const printableIframe = iframe;

    const doc = printableIframe.contentDocument;
    doc.open();
    const skeleton = new DOMParser().parseFromString(
      "<html><head><meta charset=\"utf-8\"><title></title><style></style></head><body></body></html>",
      "text/html",
    );
    const htmlEl = doc.importNode(skeleton.documentElement, true);
    const headEl = htmlEl.querySelector("head");
    const bodyEl = htmlEl.querySelector("body");
    const titleTag = htmlEl.querySelector("title");
    const printStyleEl = htmlEl.querySelector("style");
    if (!headEl || !bodyEl || !titleTag || !printStyleEl) throw new Error("Squelette HTML d'impression incomplet.");

    titleTag.textContent = options.title;

    // Clone les styles/feuilles de style de la fenêtre Obsidian courante : thèmes,
    // rôles, callouts et styles Feuillets restent identiques à l'aperçu.
    for (const styleNode of Array.from(document.querySelectorAll("style"))) {
      headEl.appendChild(doc.importNode(styleNode.cloneNode(true), true));
    }
    for (const linkNode of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
      headEl.appendChild(doc.importNode(linkNode.cloneNode(true), true));
    }
    printStyleEl.textContent = printStyle(options.atPageSize);
    /* Notre feuille d'impression est REPLACÉE EN DERNIER dans le head : les
       styles Obsidian clonés juste au-dessus la précédaient, et à spécificité
       égale c'est la dernière règle qui gagne (notamment pour `@page`). */
    headEl.appendChild(printStyleEl);

    // Assemblé dans le document PRINCIPAL (détaché), puis importé EN UNE
    // SEULE FOIS — jamais nœud par nœud — pour éviter toute ambiguïté
    // d'appartenance de document avant l'import explicite.
    bodyEl.appendChild(doc.importNode(options.deck, true));

    doc.replaceChildren(htmlEl);
    doc.close();

    // Même attente bornée que ../services/export-pdf.ts (technique déjà
    // éprouvée) : `doc.close()` doit déclencher le `load` de l'iframe, mais
    // avec un repli borné si ce n'est pas le cas — jamais un `print()` lancé
    // avant que le document d'impression ait fini de se construire. Aucune
    // autre attente (`fonts.ready`, `requestAnimationFrame`) n'est ajoutée
    // après celle-ci : dans une iframe hors écran/minuscule, ces deux
    // mécanismes peuvent rester suspendus indéfiniment sans jamais résoudre.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(); };
      printableIframe.addEventListener("load", finish, { once: true });
      window.setTimeout(finish, 300);
    });

    // Certains appelants (le Plan de présentation) doivent recalculer une
    // géométrie qui dépend du document d'impression LUI-MÊME, une fois le
    // deck réellement importé — jamais avant.
    options.afterImport?.(bodyEl);

    // Dernière vérification, bornée, juste avant `print()` : certaines images
    // importées dans le document d'impression peuvent ne pas être encore
    // décodées dans ce nouveau document. Un seul lot, jamais un délai par
    // média joué en série, et on imprime de toute façon au bout du délai.
    const pendingPrintMedia = pendingMediaOf(bodyEl);
    if (pendingPrintMedia.length > 0) {
      await waitForMediaBatch(pendingPrintMedia, PRESENTATION_MEDIA_TIMEOUT_MS);
    }

    // Ordre obligatoire : focus() → print() → nettoyage différé programmé
    // seulement APRÈS print() — jamais avant, pour ne jamais retirer l'iframe
    // avant que l'impression ait réellement eu l'occasion de partir.
    printableIframe.contentWindow.focus();
    printableIframe.contentWindow.print();
    cleanupScheduled = true;
    window.setTimeout(() => { printableIframe.remove(); }, IFRAME_CLEANUP_DELAY_MS);
  } finally {
    // Chemin d'erreur AVANT que print() ne parte (y compris si print() lui-même
    // a levé) : rien n'a encore programmé le nettoyage différé de l'iframe — la
    // retirer immédiatement plutôt que de la laisser accrochée au document
    // Obsidian principal.
    if (!cleanupScheduled) iframe.remove();
  }
}

/**
 * Exporte la Présentation courante en PDF 16:9, en imprimant le MÊME DOM que
 * l'aperçu (rendu par renderPresentationSlide) via une iframe d'impression
 * isolée — jamais un second moteur PDF, jamais la pagination Document.
 */
export async function exportPresentationPdf(options: ExportPresentationPdfOptions): Promise<void> {
  const { app, component, file, settings, pageFormat } = options;
  const geometry = printPageGeometry(pageFormat);

  if (isPresentationPdfExportInProgress) {
    new Notice(t("presentation.export.pdf.busy"));
    return;
  }
  if (typeof document === "undefined" || !document.body) return;

  isPresentationPdfExportInProgress = true;
  let prepared: PreparedPresentationExport | null = null;

  try {
    prepared = await preparePresentationExport(app, component, file, settings);
    if (!prepared) {
      new Notice(t("presentation.export.pdf.empty"));
      return;
    }
    const { records } = prepared;

    const deck = createDiv({ cls: `feuillets-presentation-print-deck ${OBSIDIAN_PRINT_ROOT_CLASS}` });
    for (const record of records) deck.appendChild(buildPrintPage(record.section, geometry));

    await printPresentationDeck({
      deck,
      atPageSize: geometry.atPageSize,
      title: file.basename,
    });
  } catch (error) {
    console.error("Feuillets : échec de l'export PDF de la présentation.", error);
    new Notice(t("presentation.export.pdf.error"));
  } finally {
    isPresentationPdfExportInProgress = false;
    prepared?.renderRoot.remove();
  }
}

/* ==================================================================
 * Sorties papier MULTI-DIAPOSITIVES — Support à distribuer (handout) et
 * Plan de présentation.
 *
 * Toutes deux réutilisent, sans exception :
 *  - preparePresentationExport() : lecture Markdown → planification → rendu
 *    réel de chaque slide (chemin UNIQUE, partagé avec la Présentation) ;
 *  - la couche de composition A4 (./presentation-a4-composition.ts) :
 *    découpage en pages, grille, frame 16:9, contain, sauts de page ;
 *  - printPresentationDeck() : pipeline d'impression UNIQUE.
 *
 * Seule change la COMPOSITION d'une cellule :
 *  - Support   → la miniature seule (document destiné au public) ;
 *  - Plan      → miniature + notes personnelles (document du présentateur).
 *
 * La grille est FIXE, jamais adaptative : 4 diapositives par page restent
 * une vraie matrice 2×2 même sur une dernière page incomplète.
 * ================================================================== */

/** Disposition interne d'une carte du plan : une carte QUI PORTE des notes
 * empile miniature (en haut) et notes (en dessous) ; une carte sans aucune
 * note ne crée aucune zone de notes et laisse la miniature occuper toute la
 * surface utile — jamais de grande zone vide artificielle. */
type PresentationPlanCardLayout = "stacked" | "thumbnail-only";

function planCardLayoutFor(hasNotes: boolean): PresentationPlanCardLayout {
  return hasNotes ? "stacked" : "thumbnail-only";
}

/** Cellule de la grille, commune au Support et au Plan : c'est elle qui
 * porte le cadre visuel (le contenu interne diffère selon la sortie). */
function createA4Cell(page: HTMLElement, cls: string, attr?: Record<string, string>): HTMLElement {
  const cell = page.createDiv({ cls, attr });
  styleEl(cell, {
    minWidth: "0",
    minHeight: "0",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: "2mm",
    overflow: "visible",
  });
  return cell;
}

/** Numéro (et titre) affiché d'une diapositive — index RÉEL dans le deck
 * d'origine (`slideIndex + 1`) : une sélection « notes uniquement » garde
 * donc les numéros du deck, jamais renumérotée depuis 1. Le titre est lu
 * dans le DOM FINAL déjà rendu de la slide, jamais reparsé du Markdown. */
function slideCaptionText(section: HTMLElement, slideIndex: number, withHeading: boolean): string {
  const heading = withHeading ? section.querySelector("h1, h2, h3")?.textContent?.trim() : "";
  return heading
    ? t("presentation.plan.slideNumberWithHeading", { index: String(slideIndex + 1), heading })
    : t("presentation.plan.slideNumber", { index: String(slideIndex + 1) });
}

/* ---------- Support à distribuer (handout) ---------- */

/** Densités proposées pour le support : 2, 4 ou 6 diapositives par feuille
 * A4 portrait — jamais une valeur libre, jamais un seuil calculé. */
export type PresentationHandoutDensity = 2 | 4 | 6;

export interface ExportPresentationHandoutPdfOptions {
  app: App;
  component: Component;
  file: TFile;
  settings: FeuilletsSettings | null | undefined;
  slidesPerPage: PresentationHandoutDensity;
}

function handoutGrid(slidesPerPage: PresentationHandoutDensity): A4Grid {
  if (slidesPerPage === 6) return A4_GRID_6_PER_PAGE;
  if (slidesPerPage === 4) return A4_GRID_4_PER_PAGE;
  return A4_GRID_2_PER_PAGE;
}

/** Nombre de réglures manuscrites sous chaque miniature — les lignes ayant
 * un PAS FIXE (voir RULED_LINE_PITCH_CSS), ce nombre est simplement celui
 * qui remplit la hauteur réellement laissée libre par la miniature dans une
 * cellule de cette densité, sur une feuille A4 portrait :
 *
 *   2/page → cellule ~132mm, miniature pleine largeur ~105mm de haut → ~2 lignes ;
 *   4/page → cellule ~132mm, miniature ~50mm de haut             → ~9 lignes ;
 *   6/page → cellule  ~86mm, miniature ~50mm de haut             → ~3 lignes.
 *
 * Valeurs FIXES, jamais un calcul au pixel qui dépendrait du moteur
 * d'impression ; le bloc de réglures est de toute façon borné par la
 * cellule (`overflow: hidden`). */
function handoutRuleCount(slidesPerPage: PresentationHandoutDensity): number {
  if (slidesPerPage === 6) return 3;
  if (slidesPerPage === 4) return 9;
  return 2;
}

/** UNE page du support : la grille demandée, une cellule par diapositive,
 * chaque cellule = un petit numéro + la miniature. Aucune note : ce
 * document est destiné au public. */
function buildHandoutPage(
  slideIndexes: readonly number[],
  slidesPerPage: PresentationHandoutDensity,
  records: readonly RenderedPresentationSlide[],
): HTMLElement {
  const grid = handoutGrid(slidesPerPage);
  const page = createA4Page("feuillets-presentation-handout-page", grid, {
    "data-slides-per-page": String(slotsPerPage(grid)),
  });
  for (const slideIndex of slideIndexes) {
    const cell = createA4Cell(page, "feuillets-presentation-handout-cell", { "data-slide-index": String(slideIndex) });
    const section = records[slideIndex].section;
    const caption = cell.createDiv({
      cls: "feuillets-presentation-handout-caption",
      text: slideCaptionText(section, slideIndex, false),
    });
    styleEl(caption, { flex: "none", font: "600 8.5pt sans-serif", color: "#666" });
    createThumbnailFrame(cell, section, "feuillets-presentation-handout-thumbnail-frame");
    // Réglures pour la prise de notes MANUSCRITES sous chaque diapositive —
    // c'est ce qui distingue un support d'une simple planche de vignettes.
    createRuledNoteLines(cell, handoutRuleCount(slidesPerPage), "feuillets-presentation-handout-rules");
  }
  return page;
}

/** Exporte un support à distribuer (2 ou 4 diapositives par page A4
 * portrait) — même préparation et même pipeline d'impression que la
 * Présentation, seule la composition change. */
export async function exportPresentationHandoutPdf(options: ExportPresentationHandoutPdfOptions): Promise<void> {
  const { app, component, file, settings, slidesPerPage } = options;

  if (isPresentationPdfExportInProgress) {
    new Notice(t("presentation.export.pdf.busy"));
    return;
  }
  if (typeof document === "undefined" || !document.body) return;

  isPresentationPdfExportInProgress = true;
  let prepared: PreparedPresentationExport | null = null;

  try {
    prepared = await preparePresentationExport(app, component, file, settings);
    if (!prepared) {
      new Notice(t("presentation.export.pdf.empty"));
      return;
    }
    const { records, renderRoot } = prepared;

    const pageElements = chunkIntoPages(records.map((_, index) => index), slidesPerPage)
      .map((slideIndexes) => {
        const page = buildHandoutPage(slideIndexes, slidesPerPage, records);
        renderRoot.appendChild(page);
        fitPresentationThumbnails(page);
        return page;
      });
    applyA4PageBreaks(pageElements);

    const deck = createDiv({ cls: `feuillets-presentation-print-deck ${OBSIDIAN_PRINT_ROOT_CLASS}` });
    for (const page of pageElements) deck.appendChild(page);

    await printPresentationDeck({
      deck,
      atPageSize: A4_PORTRAIT_PAGE_SIZE,
      title: file.basename,
      afterImport: refitImportedDeck,
    });
  } catch (error) {
    console.error("Feuillets : échec de l'export PDF du support.", error);
    new Notice(t("presentation.export.pdf.error"));
  } finally {
    isPresentationPdfExportInProgress = false;
    prepared?.renderRoot.remove();
  }
}

/* ---------- Plan de présentation ---------- */

/** Le plan est TOUJOURS une matrice 2×2 — 4 diapositives par feuille, y
 * compris sur une dernière page incomplète (les emplacements restants
 * restent simplement vides). Aucune densité adaptative : la géométrie ne
 * change jamais d'une page à l'autre. */
const PLAN_GRID = A4_GRID_4_PER_PAGE;

function stylePlanNotes(notes: HTMLElement): void {
  styleEl(notes, {
    minWidth: "0",
    minHeight: "0",
    boxSizing: "border-box",
    flex: "1",
    font: "10pt/1.4 sans-serif",
    color: "#111",
    whiteSpace: "pre-wrap",
    // Jamais de troncature, jamais d'ellipsis : si une note est
    // exceptionnellement longue, c'est la PAGE qui grandit (voir
    // createA4Page, min-height + overflow visible).
    overflow: "visible",
  });
}

/**
 * UNE page du plan — matrice 2×2 fixe. Chaque carte :
 *
 *   .feuillets-presentation-plan-card[data-layout][data-slide-index]
 *   ├── .feuillets-presentation-plan-heading  (« Diapositive N — titre »)
 *   └── .feuillets-presentation-plan-body
 *       ├── frame 16:9 (clone EXACT de la section 1280×720)
 *       └── .feuillets-presentation-plan-notes   (UNIQUEMENT s'il y a des notes)
 */
function buildPresentationPlanPage(
  items: readonly PresentationPlanItem[],
  records: readonly RenderedPresentationSlide[],
): HTMLElement {
  const page = createA4Page("feuillets-presentation-plan-page", PLAN_GRID, {
    "data-capacity": String(slotsPerPage(PLAN_GRID)),
  });

  for (const item of items) {
    const hasNotes = item.notes.length > 0;
    const layout = planCardLayoutFor(hasNotes);
    const card = createA4Cell(page, "feuillets-presentation-plan-card", {
      "data-layout": layout,
      "data-slide-index": String(item.slideIndex),
    });
    styleEl(card, { border: "1px solid #d0d0d0", borderRadius: "1.5mm", padding: "3mm" });

    const section = records[item.slideIndex].section;
    const headingEl = card.createDiv({
      cls: "feuillets-presentation-plan-heading",
      text: slideCaptionText(section, item.slideIndex, true),
    });
    styleEl(headingEl, { flex: "none", font: "600 9.5pt sans-serif", color: "#333" });

    const body = card.createDiv({ cls: "feuillets-presentation-plan-body" });
    styleEl(body, {
      flex: "1",
      minHeight: "0",
      minWidth: "0",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      // TOUJOURS en haut de la case, avec ou sans note : l'espace laissé
      // libre sous une miniature sans commentaire est délibéré — il sert à
      // écrire des annotations MANUSCRITES sur le tirage papier.
      justifyContent: "flex-start",
      gap: "2.5mm",
      overflow: "visible",
    });

    createThumbnailFrame(body, section, "feuillets-presentation-plan-thumbnail-frame");

    // Aucune note : aucune zone `.feuillets-presentation-plan-notes` créée
    // du tout — jamais une zone vide artificielle.
    if (hasNotes) {
      const notes = body.createDiv({ cls: "feuillets-presentation-plan-notes" });
      stylePlanNotes(notes);
      for (const note of item.notes) {
        const noteEl = notes.createDiv({ cls: "feuillets-presentation-plan-note", text: note.text });
        styleEl(noteEl, { margin: "0 0 1.5mm" });
      }
    }
  }
  return page;
}

/** Recalcule les miniatures avec la géométrie du DOCUMENT D'IMPRESSION
 * lui-même, une fois le deck réellement importé — obligatoire, et commun
 * aux deux sorties multi-diapositives. */
function refitImportedDeck(importedBody: HTMLElement): void {
  const importedDeck = importedBody.querySelector<HTMLElement>(".feuillets-presentation-print-deck");
  if (importedDeck) fitPresentationThumbnails(importedDeck);
}

/** Assemble le deck FINAL du plan : découpage fixe en pages de 4, matrice
 * 2×2 identique partout, miniatures ajustées, sauts de page posés. */
function buildPresentationPlanDeck(
  items: readonly PresentationPlanItem[],
  records: readonly RenderedPresentationSlide[],
  renderRoot: HTMLElement,
): HTMLElement {
  const pageElements = chunkIntoPages(items, slotsPerPage(PLAN_GRID)).map((pageItems) => {
    const page = buildPresentationPlanPage(pageItems, records);
    renderRoot.appendChild(page);
    fitPresentationThumbnails(page);
    return page;
  });
  applyA4PageBreaks(pageElements);

  const deck = createDiv({ cls: `feuillets-presentation-print-deck ${OBSIDIAN_PRINT_ROOT_CLASS}` });
  for (const page of pageElements) deck.appendChild(page);
  return deck;
}


/** Exporte un plan A4 portrait composé à partir du DOM final des slides —
 * réutilise preparePresentationExport()/printPresentationDeck(), jamais un
 * second pipeline. */
export async function exportPresentationPlanPdf(options: ExportPresentationPlanPdfOptions): Promise<void> {
  const { app, component, file, settings, scope } = options;

  if (isPresentationPdfExportInProgress) {
    new Notice(t("presentation.export.pdf.busy"));
    return;
  }
  if (typeof document === "undefined" || !document.body) return;

  isPresentationPdfExportInProgress = true;
  let prepared: PreparedPresentationExport | null = null;

  try {
    prepared = await preparePresentationExport(app, component, file, settings);
    if (!prepared) {
      new Notice(t("presentation.export.pdf.empty"));
      return;
    }
    const { markdown, slides, records, renderRoot } = prepared;

    let notesBySlide = new Map<number, PresentationPlanNote[]>();
    let unresolved: string[] = [];
    const relative = toManuscriptRelativePath(app, settings, file);
    if (relative !== null) {
      try {
        const store = await loadAnnotations(app, settings);
        const mapped = mapPresentationNotesToSlides(markdown, slides, annotationsForFile(store, relative));
        notesBySlide = mapped.notesBySlide;
        unresolved = mapped.unresolvedAnnotationIds;
      } catch (error) {
        if (error instanceof AnnotationsFileCorruptedError) {
          new Notice(t("annotation.notice.corrupted"));
          return;
        }
        throw error;
      }
    }
    if (unresolved.length > 0) new Notice(t("presentation.plan.unresolvedNotice"));

    const items: PresentationPlanItem[] = slides
      .map((_, slideIndex) => ({ slideIndex, notes: notesBySlide.get(slideIndex) ?? [] }))
      .filter((item) => scope === "all" || item.notes.length > 0);
    if (items.length === 0) {
      new Notice(t("presentation.plan.emptyNotice"));
      return;
    }

    const deck = buildPresentationPlanDeck(items, records, renderRoot);

    await printPresentationDeck({
      deck,
      atPageSize: A4_PORTRAIT_PAGE_SIZE,
      title: file.basename,
      afterImport: refitImportedDeck,
    });
  } catch (error) {
    console.error("Feuillets : échec de l'export PDF du plan.", error);
    new Notice(t("presentation.export.pdf.error"));
  } finally {
    isPresentationPdfExportInProgress = false;
    prepared?.renderRoot.remove();
  }
}
