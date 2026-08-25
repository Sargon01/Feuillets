/* Renderer de production partagé pour UNE slide de Présentation v2 —
 * l'implémentation DOM extraite ici pour être réutilisable indépendamment
 * de toute vue, utilisée par PresentationView, sans dépendance à celle-ci.
 *
 * Namespace de classes CSS : `feuillets-presentation-render-*` (neutre, sans
 * référence au prototype) pour tout ce qui est défini dans ce fichier. Les
 * deux classes de normalisation MediaCell (media-block/media-wrapper) sont
 * définies dans presentation-layout-engine.ts, hors périmètre de ce lot —
 * elles conservent donc encore leur ancien nom historique ; voir le rapport
 * de migration pour le détail de cette limitation assumée.
 *
 * Pipeline, à comportement strictement figé :
 *
 *   MarkdownRenderer source
 *   ↓
 *   analyse des blocs (presentation-layout-engine.ts)
 *   ↓
 *   candidats FLOW / SPLIT / STACK (presentation-layout-engine.ts)
 *   ↓
 *   measurementHost (chaque candidat = un DOM complet, attaché)
 *   ↓
 *   mesure (overflow réel, mediaArea contain)
 *   ↓
 *   choosePresentationCandidate (presentation-layout-engine.ts)
 *   ↓
 *   DOM gagnant mesuré === DOM définitif (détaché du host, inséré tel quel)
 *   ↓
 *   contain mathématique (déjà appliqué avant le choix, jamais recalculé)
 *   ↓
 *   overflow réel (revérifié une fois inséré — signal défensif, jamais un
 *   déclencheur de reconstruction)
 *
 * Le renderer ne connaît ni toolbar, ni navigation, ni compteur, ni
 * fullscreen, ni fichier courant, ni index actif d'un deck : il rend UNE
 * slide et rend la main à l'appelant.
 */
import { MarkdownRenderer, type App, type Component } from "obsidian";
import {
  choosePresentationCandidate,
  descriptorsForSlide,
  generatePresentationCandidates,
  isPresentationTitleSlide,
  normalizePresentationMediaCell,
  presentationContainedMediaSize,
  type PresentationBlockDescriptor,
  type PresentationCandidateMeasurement,
  type PresentationCandidatePlan,
  type PresentationGeometry,
  type PresentationLayoutOverride,
} from "./presentation-layout-engine.js";
import { applySemanticRoles, semanticRoleForElement, SEMANTIC_ROLE_FAMILY } from "../utils/semantic-roles.js";
import { resolvePresentationTheme, type ResolvedPresentationTheme } from "./presentation-theme.js";
import { pendingMediaOf, waitForMediaBatch, PRESENTATION_MEDIA_TIMEOUT_MS } from "../utils/presentation-media.js";

/** Dimensions fixes et déterministes de la surface de slide (aucun shrink automatique). */
export const PRESENTATION_SLIDE_WIDTH = 1280;
export const PRESENTATION_SLIDE_HEIGHT = 720;

const HEADING_GAP_PX = 28;
const SPLIT_GAP_PX = 32;
const STACK_GAP_PX = 24;
const FLOW_GAP_PX = 20;
const HEADING_SIZE_PX: Record<string, string> = { H1: "48px", H2: "40px", H3: "32px", H4: "28px" };

type SyntheseRhythmProfile = Readonly<{
  titleToContent: string;
  headingToContent: string;
  blockToHeading: string;
  paragraphToBlock: string;
}>;

const SYNTHESE_RHYTHM_NORMAL: SyntheseRhythmProfile = {
  titleToContent: "18px",
  headingToContent: "12px",
  blockToHeading: "24px",
  paragraphToBlock: "10px",
};

const SYNTHESE_RHYTHM_COMPACT: SyntheseRhythmProfile = {
  titleToContent: "12px",
  headingToContent: "8px",
  blockToHeading: "16px",
  paragraphToBlock: "6px",
};

/** Entrées minimales requises pour rendre UNE slide, sans dépendre d'aucune vue. */
export interface RenderPresentationSlideOptions {
  /** App Obsidian, transmise telle quelle à MarkdownRenderer.render. */
  app: App;
  /** Contexte/component nécessaire à MarkdownRenderer.render (cycle de vie des embeds). */
  component: Component;
  /** Chemin source du fichier, pour la résolution des liens/embeds. */
  sourcePath: string;
  /** Markdown d'UNE slide (déjà découpée par l'appelant). */
  markdown: string;
  /** Index logique de la slide dans le deck de l'appelant — jamais utilisé pour la navigation. */
  index: number;
  /** Génération du deck au moment de l'appel — reportée telle quelle dans le résultat. */
  generation: number;
  /** Conteneur de mesure hors écran, attaché au DOM réel (jamais display:none). */
  measurementHost: HTMLElement;
  /** Conteneur final où le DOM gagnant est inséré (nécessaire pour la re-mesure après adoption). */
  deckContainer: HTMLElement;
  /** Abandonné par l'appelant quand cette slide devient obsolète (ex. remplacée, vue fermée). */
  controller: AbortController;
  /** Revérifiée après l'attente async de MarkdownRenderer.render — permet d'abandonner proprement
   * une slide devenue périmée pendant le rendu, sans que le renderer connaisse la notion de deck. */
  isGenerationStale: () => boolean;
  /** Appelé quand une image jusque-là non chargée de CETTE slide vient de se résoudre (load/error).
   * Le renderer ne reconstruit rien lui-même : il notifie l'appelant, qui décide (rebuild + remplacement
   * atomique restent des responsabilités de la vue). */
  onMediaResolved?: () => void;
  /** Affichage des rôles Feuillets : "callouts" (défaut) ou "compact". Réutilise le réglage Feuillets global. */
  roleEditorDisplay?: "callouts" | "compact";
  theme?: ResolvedPresentationTheme;
  layoutOverride?: PresentationLayoutOverride | null;
}

/** Résultat structuré du rendu d'UNE slide. */
export interface RenderedPresentationSlide {
  index: number;
  generation: number;
  section: HTMLElement;
  inner: HTMLElement;
  overflow: boolean;
  geometry: PresentationGeometry | null;
  candidate: string | null;
  controller: AbortController;
}

/** Options minimales pour sonder le renderer sans conserver son DOM. */
export type MeasurePresentationSlideOverflowOptions = Omit<RenderPresentationSlideOptions, "measurementHost" | "deckContainer">;

/**
 * Sonde de capacité utilisée par le planner. Elle passe par le renderer de
 * production, puis retire intégralement le conteneur temporaire (DOM et
 * listeners) avant de rendre la main.
 */
export async function measurePresentationSlideOverflow(options: MeasurePresentationSlideOverflowOptions): Promise<boolean> {
  if (typeof document === "undefined" || !document.body) return true;
  const root = document.body.createDiv({ cls: "feuillets-presentation-render-probe" });
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "absolute",
    left: "-100000px",
    top: "0",
    width: `${PRESENTATION_SLIDE_WIDTH}px`,
    height: `${PRESENTATION_SLIDE_HEIGHT}px`,
    visibility: "hidden",
    pointerEvents: "none",
  });
  const host = root.createDiv({ cls: "feuillets-presentation-probe-host" });
  const deck = root.createDiv({ cls: "feuillets-presentation-probe-deck" });
  Object.assign(host.style, { width: `${PRESENTATION_SLIDE_WIDTH}px`, height: `${PRESENTATION_SLIDE_HEIGHT}px` });
  Object.assign(deck.style, { width: `${PRESENTATION_SLIDE_WIDTH}px`, height: `${PRESENTATION_SLIDE_HEIGHT}px` });
  root.append(host, deck);
  document.body.appendChild(root);
  try {
    const first = await renderPresentationSlide({ ...options, measurementHost: host, deckContainer: deck });
    /* Une image non encore chargée a une taille naturelle de 0 (voir
     * naturalSizeOf) : mesurée ainsi, une slide qui déborde réellement passe
     * pour tenir. Le résultat de la sonde dépendrait alors de l'état du cache
     * d'images au moment de l'appel — d'où des découpes qui changent d'une
     * ouverture à l'autre. On attend donc les médias (attente BORNÉE, en un
     * seul lot) puis on RE-MESURE une fois, avec leurs vraies dimensions.
     * Les sondes suivantes trouvent les images déjà chargées et repartent
     * directement : ce second rendu n'a lieu qu'une fois par média. */
    const pending = pendingMediaOf(first.section);
    if (pending.length === 0) return first.overflow;
    await waitForMediaBatch(pending, PRESENTATION_MEDIA_TIMEOUT_MS);
    const measured = await renderPresentationSlide({ ...options, measurementHost: host, deckContainer: deck });
    return measured.overflow;
  } finally {
    options.controller.abort();
    root.remove();
  }
}

/* Le linter obsidianmd (no-forbidden-elements) interdit de créer/attacher un
 * <style> — et le cahier des charges interdit de toucher à styles.css. Le
 * style de la slide est donc posé exclusivement en inline, élément par
 * élément, jamais via une feuille de style. */
function styleEl(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

/* Variables CSS locales (--text-normal, --text-muted, --text-faint) : posées via `setCssProps`
 * (API Obsidian dédiée aux propriétés dynamiques) plutôt que `style.setProperty`, avec repli sur
 * l'attribut `style` pour les environnements qui n'exposent pas `setCssProps` (fixtures de test). */
function setCssVars(el: HTMLElement, vars: Record<string, string>): void {
  if (typeof el.setCssProps === "function") {
    el.setCssProps(vars);
    return;
  }
  const existing = el.getAttribute("style") || "";
  const extra = Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");
  el.setAttribute("style", existing ? `${existing};${extra}` : extra);
}

/** Surface visuelle déterministe et fixe de la slide définitive (aucun shrink automatique). */
function baseInnerStyle(hasLongCitation: boolean, theme: ResolvedPresentationTheme): Partial<CSSStyleDeclaration> {
  return {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: hasLongCitation ? "60px 80px" : "72px 80px",
    display: "flex",
    flexDirection: "column",
    rowGap: hasLongCitation ? "20px" : `${HEADING_GAP_PX}px`,
    background: theme.colors.background,
    color: theme.colors.text,
    fontSize: "30px",
    lineHeight: "1.3",
    overflow: "hidden",
  };
}

const CELL_STYLE: Partial<CSSStyleDeclaration> = { minWidth: "0", minHeight: "0", boxSizing: "border-box", overflow: "hidden" };

function headingRegionStyle(): Partial<CSSStyleDeclaration> {
  return { width: "100%", flex: "0 0 auto" };
}

function contentRegionStyle(geometry: "split" | "stack", ratioA: number, ratioB: number): Partial<CSSStyleDeclaration> {
  const base: Partial<CSSStyleDeclaration> = { display: "grid", minWidth: "0", minHeight: "0", boxSizing: "border-box", flex: "1 1 auto", overflow: "hidden" };
  if (geometry === "split") return { ...base, gridTemplateColumns: `minmax(0, ${ratioA}fr) minmax(0, ${ratioB}fr)`, columnGap: `${SPLIT_GAP_PX}px` };
  return { ...base, gridTemplateRows: `minmax(0, ${ratioA}fr) minmax(0, ${ratioB}fr)`, rowGap: `${STACK_GAP_PX}px` };
}

/* "img, video" est un sélecteur composite : le type qu'infère le compilateur pour
 * querySelectorAll(selecteur_composite) est Element (pas HTMLElement), d'où deux
 * requêtes à sélecteur simple ci-dessous plutôt qu'une assertion de type. */
function mediaElementsOf(root: HTMLElement): (HTMLImageElement | HTMLVideoElement)[] {
  return [...Array.from(root.querySelectorAll("img")), ...Array.from(root.querySelectorAll("video"))];
}

const VIDEO_WIDTH_ATTRIBUTE = "data-feuillets-video-width";
const VIDEO_HEIGHT_ATTRIBUTE = "data-feuillets-video-height";

function rememberVideoDimensions(video: HTMLVideoElement): boolean {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  video.setAttribute(VIDEO_WIDTH_ATTRIBUTE, String(width));
  video.setAttribute(VIDEO_HEIGHT_ATTRIBUTE, String(height));
  return true;
}

/** Résout les métadonnées vidéo du DOM source avant tout clonage de candidat. */
async function resolveVideoMetadataForRender(sourceRoot: HTMLElement, signal: AbortSignal): Promise<void> {
  const videos = Array.from(sourceRoot.querySelectorAll("video"));
  await Promise.all(videos.map((video) => {
    if (rememberVideoDimensions(video) || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onMetadata);
        video.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onMetadata = () => {
        rememberVideoDimensions(video);
        finish();
      };
      const onError = () => finish();
      const onAbort = () => finish();
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      video.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) finish();
    });
  }));
}

/** Détecte si un callout est un rôle sémantique Feuillets en inspectant les classes appliquées par applySemanticRoles. */
function isSemanticRoleCallout(callout: HTMLElement): boolean {
  return callout.classList.contains("feuillets-semantic-role");
}

/** Détecte si `.callout-title-inner` contient un titre explicite (texte non-vide). */
function hasExplicitTitle(titleInner: HTMLElement): boolean {
  // Obtient le texte visible de l'élément (innerText exclut les SVG en général)
  // Utilise une approche défensive : si innerText n'est pas disponible, utilise textContent
  const text = (titleInner.innerText || titleInner.textContent || "").trim();
  return text.length > 0;
}

/** Dimensionne l'icône sémantique (1em relatif au font-size du titre). */
function sizeSemanticRoleIcon(iconEl: HTMLElement): void {
  styleEl(iconEl, {
    width: "1em",
    height: "1em",
    flexShrink: "0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  });
  // Dimensionner aussi le SVG interne
  const svg = iconEl.querySelector<HTMLElement>("svg");
  if (svg) {
    styleEl(svg, {
      width: "100%",
      height: "100%",
    });
  }
}

/** Couleur d'une famille sémantique en rgba, à partir de l'hexadécimal SEMANTIC_PALETTE — jamais
 * une seconde table de couleurs : uniquement une conversion de format sur la source de vérité. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Masque l'icône SVG native Obsidian selon le contrat existant : si le titre porte un texte
 * explicite, seule l'icône est masquée (le texte reste visible) ; sinon tout `.callout-title-inner`
 * (qui ne contient alors qu'une icône native, remplacée par le repère sémantique) est masqué. */
function applySemanticCalloutIconHandling(callout: HTMLElement, calloutTitle: HTMLElement | null, calloutTitleInner: HTMLElement | null): void {
  const nativeIcon = callout.querySelector<HTMLElement>(".callout-icon");
  if (nativeIcon) styleEl(nativeIcon, { display: "none" });

  if (calloutTitleInner) {
    if (hasExplicitTitle(calloutTitleInner)) {
      const icon = calloutTitleInner.querySelector<HTMLElement>("svg");
      if (icon) styleEl(icon, { display: "none" });
    } else {
      styleEl(calloutTitleInner, { display: "none" });
    }
  }

  const roleIcon = calloutTitle?.querySelector<HTMLElement>(".feuillets-role-marker-icon");
  if (roleIcon) sizeSemanticRoleIcon(roleIcon);
}

/** Chrome complet d'un rôle sémantique (réglage "callouts") : boîte réellement stylée, dérivée
 * de SEMANTIC_ROLE_FAMILY + SEMANTIC_PALETTE (source de vérité unique, jamais dupliquée). Ne
 * touche jamais la couleur de `.callout-title` : la teinte du texte du titre reste pilotée par
 * styles.css (`.feuillets-presentation-render-slide .callout.feuillets-role-* .callout-title`). */
function applySemanticCalloutChrome(callout: HTMLElement, role: keyof typeof SEMANTIC_ROLE_FAMILY, theme: ResolvedPresentationTheme): void {
  const hex = theme.callouts[role].accent;
  styleEl(callout, {
    background: hexToRgba(hex, 0.08),
    border: `1px solid ${hexToRgba(hex, 0.35)}`,
    borderLeft: `4px solid ${hex}`,
    borderRadius: "4px",
    padding: "16px 20px",
  });
}

/** Rendu compact d'un rôle sémantique : chrome décoratif retiré, titre/icône/contenu conservés
 * visibles (l'identité de couleur reste portée par les classes `feuillets-role-*`, jamais inline). */
function applySemanticCompactChrome(callout: HTMLElement, calloutTitle: HTMLElement | null, calloutContent: HTMLElement | null): void {
  styleEl(callout, { background: "transparent", border: "0", boxShadow: "none", padding: "0" });
  if (calloutTitle) styleEl(calloutTitle, { padding: "0" });
  if (calloutContent) styleEl(calloutContent, { padding: "0" });
}

/** Chrome neutre d'un callout NON sémantique (`note`, `document`, `correction`, natifs Obsidian…) :
 * une boîte Callout générique lisible, indépendante du thème Obsidian et jamais transformée par le
 * réglage Compact — ni chrome retiré, ni icône native touchée. */
function applyGenericCalloutChrome(callout: HTMLElement, theme: ResolvedPresentationTheme): void {
  styleEl(callout, {
    background: theme.neutralCallout.background,
    border: `1px solid ${theme.neutralCallout.border}`,
    borderLeft: `4px solid ${theme.neutralCallout.borderLeft}`,
    borderRadius: "4px",
    padding: "16px 20px",
  });
}

/** Réduit uniquement le corps des citations sémantiques multi-paragraphes. */
function isLongCitationCallout(callout: HTMLElement): boolean {
  if (!isSemanticRoleCallout(callout) || semanticRoleForElement(callout) !== "citation") return false;
  const calloutContent = callout.querySelector<HTMLElement>(".callout-content");
  if (!calloutContent) return false;
  const directParagraphs = Array.from(calloutContent.children).filter((child) => child.tagName === "P");
  return directParagraphs.length >= 2;
}

function applyCitationBodySizing(callout: HTMLElement, calloutContent: HTMLElement | null): void {
  if (calloutContent && isLongCitationCallout(callout)) styleEl(calloutContent, { fontSize: "24px" });
}

/** Respiration verticale déterministe des blocs directs d'une synthèse.
 * Le rôle canonique est la seule source de vérité : aucun texte visible, couleur
 * ou rescannage du Markdown n'intervient ici. */
function applySyntheseVerticalRhythm(root: HTMLElement, profile: SyntheseRhythmProfile): void {
  for (const callout of Array.from(root.querySelectorAll<HTMLElement>(".callout"))) {
    if (!isSemanticRoleCallout(callout) || semanticRoleForElement(callout) !== "synthese") continue;
    const content = callout.querySelector<HTMLElement>(".callout-content");
    if (!content) continue;

    styleEl(content, { marginTop: profile.titleToContent });
    const children = Array.from(content.children) as HTMLElement[];
    let firstDirectHeading = true;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const previous = children[index - 1];
      const isHeading = /^H[1-4]$/.test(child.tagName);
      const isParagraph = child.tagName === "P";
      const isList = child.tagName === "UL" || child.tagName === "OL";

      if (isHeading) {
        styleEl(child, {
          marginTop: firstDirectHeading ? "0px" : profile.blockToHeading,
          marginBottom: profile.headingToContent,
        });
        firstDirectHeading = false;
      } else if (isParagraph) {
        styleEl(child, { margin: "0" });
        if (previous?.tagName === "P" || previous?.tagName === "UL" || previous?.tagName === "OL") {
          styleEl(child, { marginTop: profile.paragraphToBlock });
        }
      } else if (isList) {
        if (previous?.tagName === "P") styleEl(child, { marginTop: profile.paragraphToBlock });
      }
    }
  }
}

/**
 * Point d'entrée UNIQUE de mise en forme des callouts pour la Présentation 16:9 — remplace les
 * anciennes couches successives (applyCompactRoleDisplay / applyCalloutRoleDisplay /
 * normalizeCalloutForPresentation). Pour CHAQUE `.callout` :
 *  1. pose une autonomie visuelle déterministe, indépendante du thème Obsidian (visibilité,
 *     dimensionnement, couleur de texte, variables `--text-*` locales) ;
 *  2. si le callout porte un rôle sémantique Feuillets (`feuillets-semantic-role`), applique le
 *     chrome complet (réglage "callouts") ou le chrome compact (réglage "compact"), tous deux
 *     dérivés de SEMANTIC_ROLE_FAMILY + SEMANTIC_PALETTE ;
 *  3. sinon, applique un chrome générique neutre, jamais affecté par le réglage Compact.
 * Appelée après applySemanticRoles()/applyMarkdownReset(), avant tout descriptor/snapshot/clonage/
 * mesure : le DOM ainsi stylé est celui qui est ensuite cloné, mesuré et affiché tel quel.
 */
function applyPresentationCalloutDisplay(root: HTMLElement, roleEditorDisplay: "callouts" | "compact" | undefined, theme: ResolvedPresentationTheme): void {
  for (const callout of Array.from(root.querySelectorAll<HTMLElement>(".callout"))) {
    const calloutTitle = callout.querySelector<HTMLElement>(".callout-title");
    const calloutTitleInner = callout.querySelector<HTMLElement>(".callout-title-inner");
    const calloutContent = callout.querySelector<HTMLElement>(".callout-content");
    const role = semanticRoleForElement(callout);

    // 1. Autonomie visuelle déterministe — s'applique à TOUS les callouts, sémantiques ou non.
    styleEl(callout, {
      display: "block",
      width: "100%",
      height: "auto",
      maxHeight: "none",
      overflow: "visible",
      boxSizing: "border-box",
      margin: "0.75em 0",
      color: theme.colors.text,
      mixBlendMode: "normal", // Neutralise le `mix-blend-mode: lighten` du thème Obsidian qui rendrait le callout invisible sur fond blanc
    });
    setCssVars(callout, { "--text-normal": theme.colors.text, "--text-muted": theme.colors.muted, "--text-faint": theme.colors.muted });

    if (calloutTitle) styleEl(calloutTitle, { display: "flex", alignItems: "center", gap: "4px", overflow: "visible", maxHeight: "none" });
    // Jamais de couleur inline sur .callout-title-inner pour un rôle sémantique : la teinte de
    // famille vient de styles.css (`.feuillets-role-* .callout-title`) et cascade jusqu'ici.
    if (calloutTitleInner) styleEl(calloutTitleInner, { display: "block", overflow: "visible", maxHeight: "none" });
    if (calloutContent) styleEl(calloutContent, { display: "block", height: "auto", maxHeight: "none", overflow: "visible", color: role && isSemanticRoleCallout(callout) ? theme.callouts[role].body : theme.colors.text });

    // 2/3. Rôle sémantique Feuillets vs callout ordinaire — jamais l'un transformé en l'autre.
    if (role && isSemanticRoleCallout(callout)) {
      applySemanticCalloutIconHandling(callout, calloutTitle, calloutTitleInner);
      applyCitationBodySizing(callout, calloutContent);
      if (calloutTitle) styleEl(calloutTitle, { color: theme.callouts[role].accent });
      if (calloutContent) styleEl(calloutContent, { color: theme.callouts[role].body });
      if (roleEditorDisplay === "compact") {
        applySemanticCompactChrome(callout, calloutTitle, calloutContent);
      } else {
        applySemanticCalloutChrome(callout, role, theme);
      }
    } else {
      // Callout non sémantique : jamais de SemanticRole, boîte générique, Compact sans effet.
      // Aucune table de couleurs sémantique à respecter ici : couleur de titre explicite autorisée,
      // pour neutraliser un thème hostile qui aurait imposé une couleur claire au titre natif.
      applyGenericCalloutChrome(callout, theme);
      if (calloutTitle) styleEl(calloutTitle, { color: theme.colors.text });
      if (calloutTitleInner) styleEl(calloutTitleInner, { color: theme.colors.text });
    }
  }
}

/** Grammaire typographique autonome de la Présentation, appliquée avant toute mesure. */
function applyPresentationTypography(root: HTMLElement, theme: ResolvedPresentationTheme): void {
  const headingColors: Record<string, string> = { H1: theme.colors.h1, H2: theme.colors.h2, H3: theme.colors.h3, H4: theme.colors.h4 };
  for (const tag of ["h1", "h2", "h3", "h4"] as const) {
    for (const heading of Array.from(root.querySelectorAll<HTMLElement>(tag))) {
      styleEl(heading, { fontSize: HEADING_SIZE_PX[heading.tagName], color: headingColors[heading.tagName] });
    }
  }

  for (const strong of Array.from(root.querySelectorAll<HTMLElement>("strong"))) {
    let ancestor = strong.parentElement;
    let structuralColor: string | null = null;
    while (ancestor && ancestor !== root) {
      if (/^H[1-4]$/.test(ancestor.tagName)) {
        structuralColor = headingColors[ancestor.tagName];
        break;
      }
      if (ancestor.classList.contains("callout-title")) {
        const callout = ancestor.closest<HTMLElement>(".callout");
        const role = callout ? semanticRoleForElement(callout) : null;
        structuralColor = role ? theme.callouts[role].accent : theme.colors.text;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    styleEl(strong, { color: structuralColor ?? theme.colors.strong });
  }

  for (const callout of Array.from(root.querySelectorAll<HTMLElement>(".callout"))) {
    if (isSemanticRoleCallout(callout) && semanticRoleForElement(callout) === "synthese") {
      const title = callout.querySelector<HTMLElement>(".callout-title");
      if (title) styleEl(title, { color: theme.callouts.synthese.accent });
    }
  }
}

/** Reset Markdown local à la slide (jamais styles.css, jamais le DOM de l'éditeur).
 * BUG 4 FIX: Callouts (et autres blocs) restent lisibles avec couleur explicite. */
function applyMarkdownReset(root: HTMLElement): void {
  for (const p of Array.from(root.querySelectorAll("p"))) styleEl(p, { margin: "0" });
  const lists = [...Array.from(root.querySelectorAll("ul")), ...Array.from(root.querySelectorAll("ol"))];
  for (const list of lists) styleEl(list, { margin: "0", paddingLeft: "1.25em" });
  for (const li of Array.from(root.querySelectorAll("li"))) styleEl(li, { margin: "0 0 0.3em 0" });
  for (const bq of Array.from(root.querySelectorAll("blockquote"))) styleEl(bq, { margin: "0" });
  const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
  for (const tag of headingTags) {
    for (const el of Array.from(root.querySelectorAll(tag))) {
      styleEl(el, { margin: "0", lineHeight: "1.08" });
      const size = HEADING_SIZE_PX[el.tagName];
      if (size) styleEl(el, { fontSize: size });
    }
  }
  for (const media of mediaElementsOf(root)) styleEl(media, { margin: "0" });

  // Les callouts (tous types) ne sont plus traités ici : applyPresentationCalloutDisplay,
  // appelée juste après, leur pose l'intégralité de leur autonomie visuelle — une seule couche,
  // jamais deux traitements successifs et potentiellement contradictoires sur le même élément.
}

/**
 * Fait remplir la cellule par le bloc média et ses wrappers intermédiaires
 * (centrage, aucune taille propre) — mais ne dimensionne jamais le média
 * lui-même : les wrappers Obsidian ne doivent plus décider de sa taille
 * finale, seule la formule mathématique `presentationContainedMediaSize` le
 * fait (voir sizeContainedMedia ci-dessous).
 */
function fillMediaCellWrappers(cell: HTMLElement, mediaBlock: HTMLElement): void {
  const fill: Partial<CSSStyleDeclaration> = { width: "100%", height: "100%", display: "grid", placeItems: "center", minWidth: "0", minHeight: "0" };
  styleEl(mediaBlock, fill);
  let node = mediaBlock.parentElement;
  while (node && node !== cell) { styleEl(node, fill); node = node.parentElement; }
}

/** Dimensions naturelles d'un média, quelle que soit sa balise (img ou video). */
function naturalSizeOf(media: HTMLImageElement | HTMLVideoElement): { width: number; height: number } {
  if (media.tagName === "VIDEO") {
    const video = media as unknown as HTMLVideoElement;
    if (video.videoWidth > 0 && video.videoHeight > 0) return { width: video.videoWidth, height: video.videoHeight };
    const width = Number(video.getAttribute(VIDEO_WIDTH_ATTRIBUTE));
    const height = Number(video.getAttribute(VIDEO_HEIGHT_ATTRIBUTE));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };
    return { width: video.videoWidth ?? 0, height: video.videoHeight ?? 0 };
  }
  const img = media as HTMLImageElement;
  return { width: img.naturalWidth ?? 0, height: img.naturalHeight ?? 0 };
}

/**
 * Dimensionne EXPLICITEMENT le média avec la taille contain mathématique
 * (`presentationContainedMediaSize`), à partir de la taille intérieure réelle
 * de `cell` et des dimensions naturelles du média — jamais en laissant le
 * navigateur résoudre `contain` à travers les wrappers. Si le média n'est
 * pas encore chargé (naturalWidth/naturalHeight à 0) ou si la cellule n'est
 * pas encore mesurable, n'invente aucune taille : l'architecture async gérée
 * par l'appelant reconstruira cette slide une fois l'image chargée.
 */
function sizeContainedMedia(cell: HTMLElement, media: HTMLImageElement | HTMLVideoElement): void {
  styleEl(media, { display: "block", objectFit: "contain", margin: "0" });
  const { width: naturalWidth, height: naturalHeight } = naturalSizeOf(media);
  const contained = presentationContainedMediaSize(cell.clientWidth, cell.clientHeight, naturalWidth, naturalHeight);
  if (!contained) return;
  styleEl(media, { width: `${contained.width}px`, height: `${contained.height}px`, maxWidth: "none", maxHeight: "none" });
}

/**
 * Surface EXACTE utilisée pour `mediaArea` : recalculée avec la même formule
 * et les mêmes entrées (taille réelle de la cellule + dimensions naturelles)
 * que celles appliquées au média affiché par sizeContainedMedia — jamais un
 * `getBoundingClientRect()` du média, qui peut représenter un rectangle
 * coupé par `overflow:hidden` si les wrappers avaient laissé le média
 * déborder de sa cellule.
 */
function containedMediaAreaOf(cell: HTMLElement): number {
  const media = mediaElementsOf(cell)[0];
  if (!media) return 0;
  const { width: naturalWidth, height: naturalHeight } = naturalSizeOf(media);
  const contained = presentationContainedMediaSize(cell.clientWidth, cell.clientHeight, naturalWidth, naturalHeight);
  return contained ? contained.area : 0;
}

function elementHeight(el: HTMLElement): number {
  if (typeof el.getBoundingClientRect === "function") return el.getBoundingClientRect().height;
  return el.clientHeight ?? 0;
}

function cellOverflowPx(el: HTMLElement | null): number {
  if (!el) return 0;
  return Math.max(0, el.scrollWidth - el.clientWidth) + Math.max(0, el.scrollHeight - el.clientHeight);
}

type ComposeSplitStackResult = {
  headingRegion: HTMLElement;
  contentRegion: HTMLElement;
  cellA: HTMLElement;
  cellB: HTMLElement;
  mediaCell: HTMLElement | null;
  stackA: HTMLElement | null;
  stackB: HTMLElement | null;
};

type ComposeFlowResult = {
  headingRegion: HTMLElement;
  contentRegion: HTMLElement;
  nonMediaBlocks: HTMLElement[];
  forcedOverflow: boolean;
};

function leadingHeadingPrefix(descriptors: PresentationBlockDescriptor[]): { headingIndexes: number[]; body: PresentationBlockDescriptor[] } {
  let firstBody = 0;
  while (firstBody < descriptors.length && descriptors[firstBody].kind === "heading") firstBody++;
  return {
    headingIndexes: descriptors.slice(0, firstBody).map((descriptor) => descriptor.index),
    body: descriptors.slice(firstBody),
  };
}

/** Plans bornés aux callouts directs : chaque point de coupure est contigu et
 * réutilise generatePresentationCandidates pour conserver exactement les cinq
 * ratios du contrat texte–texte existant. */
function generateGroupedCalloutCandidates(descriptors: PresentationBlockDescriptor[]): PresentationCandidatePlan[] {
  const { headingIndexes, body } = leadingHeadingPrefix(descriptors);
  if (body.length < 3 || body.some((descriptor) => descriptor.kind !== "callout")) return [];
  const candidates: PresentationCandidatePlan[] = [];
  for (let split = 1; split < body.length; split++) {
    const pairPlans = generatePresentationCandidates([
      ...headingIndexes.map((index) => ({ index, kind: "heading" as const })),
      { index: body[0].index, kind: "callout" },
      { index: body[split].index, kind: "callout" },
    ]);
    for (const plan of pairPlans) {
      candidates.push({
        ...plan,
        id: `grouped-${split}-${plan.id}`,
        headingIndexes,
        cellAIndexes: body.slice(0, split).map((descriptor) => descriptor.index),
        cellBIndexes: body.slice(split).map((descriptor) => descriptor.index),
        mediaPosition: null,
      });
    }
  }
  return candidates;
}

/** Un candidat construit comme un DOM complet de slide, attaché au measurementHost. */
type BuiltCandidate = {
  section: HTMLElement;
  inner: HTMLElement;
  contentRegion: HTMLElement;
  cellA: HTMLElement | null;
  cellB: HTMLElement | null;
  mediaCell: HTMLElement | null;
  nonMediaBlocks: HTMLElement[] | null;
  forcedOverflow: boolean;
  stackA: HTMLElement | null;
  stackB: HTMLElement | null;
};

type OverflowSnapshot = { overflow: boolean; overflowPx: number };

/** Compose heading-region + content-region (grid SPLIT/STACK) dans `container`, à partir de clones des nœuds source. */
function composeSplitStackInto(container: HTMLElement, sourceChildren: HTMLElement[], plan: PresentationCandidatePlan): ComposeSplitStackResult {
  const headingRegion = container.createDiv({ cls: "feuillets-presentation-render-heading" });
  styleEl(headingRegion, headingRegionStyle());
  const contentRegion = container.createDiv({ cls: `feuillets-presentation-render-content feuillets-presentation-render-${plan.geometry}` });
  styleEl(contentRegion, contentRegionStyle(plan.geometry, plan.cellARatio, plan.cellBRatio));
  const cellA = contentRegion.createDiv({ cls: "feuillets-presentation-render-cell" });
  const cellB = contentRegion.createDiv({ cls: "feuillets-presentation-render-cell" });
  styleEl(cellA, CELL_STYLE);
  styleEl(cellB, CELL_STYLE);

  /* Chaque candidat est un DOM indépendant : les nœuds source sont clonés,
   * jamais déplacés, afin que plusieurs candidats puissent coexister,
   * attachés simultanément au measurementHost, sans se voler leur contenu.
   * Le regroupement (callout-stack) est décidé CELLULE PAR CELLULE : une
   * cellule avec un seul index (ex. le média seul d'un candidat média+contenu
   * groupé) ne doit jamais recevoir de stack, même quand l'autre cellule en a
   * un — sinon le "média block" attendu par normalizePresentationMediaCell
   * serait le wrapper de stack, pas le bloc média réel. */
  const stackA = plan.cellAIndexes.length > 1 ? cellA.createDiv({ cls: "feuillets-presentation-render-callout-stack" }) : null;
  const stackB = plan.cellBIndexes.length > 1 ? cellB.createDiv({ cls: "feuillets-presentation-render-callout-stack" }) : null;
  if (stackA) styleEl(stackA, { display: "flex", flexDirection: "column", rowGap: `${FLOW_GAP_PX}px`, width: "100%", minWidth: "0" });
  if (stackB) styleEl(stackB, { display: "flex", flexDirection: "column", rowGap: `${FLOW_GAP_PX}px`, width: "100%", minWidth: "0" });
  const pick = (idx: number): HTMLElement => sourceChildren[idx].cloneNode(true) as HTMLElement;
  for (const idx of plan.headingIndexes) headingRegion.appendChild(pick(idx));
  for (const idx of plan.cellAIndexes) (stackA ?? cellA).appendChild(pick(idx));
  for (const idx of plan.cellBIndexes) (stackB ?? cellB).appendChild(pick(idx));

  let mediaCell: HTMLElement | null = null;
  if (plan.mediaPosition === "a" && cellA.children[0]) mediaCell = cellA;
  else if (plan.mediaPosition === "b" && cellB.children[0]) mediaCell = cellB;
  if (mediaCell) {
    const mediaBlock = mediaCell.children[0] as HTMLElement;
    normalizePresentationMediaCell(mediaCell, mediaBlock);
    fillMediaCellWrappers(mediaCell, mediaBlock);
    // La cellule SPLIT/STACK a déjà sa taille finale (tracks fr fixes du grid,
    // indépendantes de son propre contenu) : le média peut être dimensionné
    // immédiatement, sans attendre un calcul différé.
    for (const media of mediaElementsOf(mediaBlock)) sizeContainedMedia(mediaCell, media);
  }
  return { headingRegion, contentRegion, cellA, cellB, mediaCell, stackA, stackB };
}

/**
 * FLOW (jamais de candidats mesurés en parallèle — géométrie unique imposée,
 * un seul DOM construit) : content-region en colonne flex, avec une
 * media-region dimensionnée à l'espace vertical réellement disponible. Le
 * calcul de hauteur n'a lieu qu'une fois le DOM réellement attaché au host
 * (donc mesurable) — jamais sur un DOM détaché.
 *
 * BUG 3 FIX: Gère correctement plusieurs médias — chacun reste visible avec
 * sa propre région, partageant l'espace disponible. Aucun média ne disparaît par overflow.
 * BUG 4 FIX: Callouts (et autres blocs non-media) restent lisibles avec couleur explicite.
 */
function composeFlowInto(container: HTMLElement, sourceChildren: HTMLElement[], descriptors: PresentationBlockDescriptor[], isTitle: boolean): ComposeFlowResult {
  // BUG 1 FIX: Seulement headings contigus au début — tous autres blocs vont dans le body
  const { headingIndexes, body: nonHeaderBlocks } = leadingHeadingPrefix(descriptors);

  const headingRegion = container.createDiv({ cls: "feuillets-presentation-render-heading" });
  styleEl(headingRegion, headingRegionStyle());
  const contentRegion = container.createDiv({ cls: "feuillets-presentation-render-content feuillets-presentation-render-flow" });
  styleEl(contentRegion, {
    display: "flex",
    flexDirection: "column",
    rowGap: `${FLOW_GAP_PX}px`,
    minWidth: "0",
    minHeight: "0",
    boxSizing: "border-box",
    flex: "1 1 auto",
    overflow: "hidden",
    justifyContent: isTitle ? "center" : "flex-start",
  });

  const pick = (idx: number): HTMLElement => sourceChildren[idx].cloneNode(true) as HTMLElement;
  for (const idx of headingIndexes) headingRegion.appendChild(pick(idx));

  const mediaEntries = nonHeaderBlocks.filter((d) => d.kind === "media");
  const mediaRegions: HTMLElement[] = [];
  let flowMediaBlock: HTMLElement | null = null;
  const nonMediaBlocks: HTMLElement[] = [];
  for (const d of nonHeaderBlocks) {
    if (d.kind === "media") {
      const mediaBlock = pick(d.index);
      if (!flowMediaBlock) flowMediaBlock = mediaBlock;
      const mediaRegion = contentRegion.createDiv({ cls: "feuillets-presentation-render-flow-media-region" });
      // Pas de hauteur encore : elle dépend de l'espace réellement disponible,
      // calculé ci-dessous une fois tous les blocs non-média mesurés. Dimensionner
      // le média maintenant lirait une hauteur de cellule non définitive.
      styleEl(mediaRegion, { display: "grid", placeItems: "center", minWidth: "0", minHeight: "0", overflow: "hidden", width: "100%", flex: "0 0 auto" });
      mediaRegion.appendChild(mediaBlock);
      normalizePresentationMediaCell(mediaRegion, mediaBlock);
      fillMediaCellWrappers(mediaRegion, mediaBlock);
      mediaRegions.push(mediaRegion);
    } else {
      const node = pick(d.index);
      styleEl(node, { flex: "0 0 auto", width: "100%" });
      if (d.kind !== "heading") styleEl(node, { color: "#1f1f1f" }); // BUG 4 FIX: Couleur explicite pour les callouts et blocs ordinaires
      contentRegion.appendChild(node);
      nonMediaBlocks.push(node);
    }
  }

  /* À ce point, `container` est déjà attaché à `host` (créé avant l'appel à
   * composeFlowInto) : clientHeight/getBoundingClientRect reflètent une
   * géométrie réellement calculée, jamais un DOM détaché. */
  let forcedOverflow = false;
  if (mediaRegions.length > 0) {
    const contentHeight = contentRegion.clientHeight;
    const nonMediaHeightSum = nonMediaBlocks.reduce((sum, el) => sum + elementHeight(el), 0);
    const gapCount = Math.max(0, nonHeaderBlocks.length - 1);
    const availableMediaHeight = contentHeight - nonMediaHeightSum - gapCount * FLOW_GAP_PX;

    if (mediaEntries.length === 1 && availableMediaHeight > 0) {
      // Cas unique : un seul média utilise toute la hauteur disponible
      styleEl(mediaRegions[0], { height: `${availableMediaHeight}px` });
    } else if (mediaEntries.length > 1) {
      // BUG 3 FIX: Plusieurs médias — partage équitable de l'espace disponible
      // Chaque région média reçoit 0 0 auto (flex-shrink=1) pour parler ses parts
      if (availableMediaHeight > 0) {
        const heightPerMedia = availableMediaHeight / mediaEntries.length;
        for (const region of mediaRegions) {
          styleEl(region, { flex: `0 1 ${heightPerMedia}px` });
        }
      } else {
        // Pas d'espace : au moins 1px par région pour les rendre visibles
        for (const region of mediaRegions) {
          styleEl(region, { flex: `1 0 auto`, minHeight: "1px" });
        }
      }
    } else if (availableMediaHeight <= 0) {
      // Cas unique avec pas d'espace
      styleEl(mediaRegions[0], { height: "0px" });
      forcedOverflow = true;
    }

    // Dimensionner tous les médias avec la formule contain
    for (const mediaRegion of mediaRegions) {
      const mediaBlocks = Array.from(mediaRegion.children) as HTMLElement[];
      for (const mediaBlock of mediaBlocks) {
        for (const media of mediaElementsOf(mediaBlock)) {
          sizeContainedMedia(mediaRegion, media);
        }
      }
    }
  }
  return { headingRegion, contentRegion, nonMediaBlocks, forcedOverflow };
}

/**
 * Construit un candidat comme un DOM COMPLET de slide (section + inner +
 * géométrie), attaché à `host` (measurementHost, ou transitoirement le
 * conteneur final dans le cas de la coquille de génération périmée).
 * `plan` null => FLOW (candidat unique, aucune comparaison).
 */
function buildCandidateSection(
  host: HTMLElement,
  index: number,
  sourceChildren: HTMLElement[],
  plan: PresentationCandidatePlan | null,
  isTitle: boolean,
  descriptors: PresentationBlockDescriptor[],
  hasLongCitation: boolean,
  theme: ResolvedPresentationTheme,
): BuiltCandidate {
  const section = host.createEl("section", {
    cls: "feuillets-presentation-render-slide",
    attr: { "data-slide-index": String(index) },
  });
  styleEl(section, { position: "absolute", inset: "0", width: `${PRESENTATION_SLIDE_WIDTH}px`, height: `${PRESENTATION_SLIDE_HEIGHT}px`, boxSizing: "border-box", visibility: "hidden", pointerEvents: "none" });
  const inner = section.createDiv({ cls: "feuillets-presentation-render-inner" });
  styleEl(inner, baseInnerStyle(hasLongCitation, theme));
  setCssVars(inner, { "--text-normal": theme.colors.text, "--text-muted": theme.colors.muted, "--text-faint": theme.colors.muted });

  if (plan) {
    section.setAttribute("data-geometry", plan.geometry);
    section.setAttribute("data-candidate", plan.id);
    const { contentRegion, cellA, cellB, mediaCell, stackA, stackB } = composeSplitStackInto(inner, sourceChildren, plan);
    return { section, inner, contentRegion, cellA, cellB, mediaCell, nonMediaBlocks: null, forcedOverflow: false, stackA, stackB };
  }

  section.setAttribute("data-geometry", "flow");
  if (isTitle) section.setAttribute("data-title-slide", "true");
  const { contentRegion, nonMediaBlocks, forcedOverflow } = composeFlowInto(inner, sourceChildren, descriptors, isTitle);
  return { section, inner, contentRegion, cellA: null, cellB: null, mediaCell: null, nonMediaBlocks, forcedOverflow, stackA: null, stackB: null };
}

/** Mesure PURE d'un candidat SPLIT/STACK déjà attaché : entrée directe pour choosePresentationCandidate. */
function measureBuiltCandidate(id: string, candidate: BuiltCandidate): PresentationCandidateMeasurement {
  const textCells = [candidate.cellA, candidate.cellB].filter((c): c is HTMLElement => c !== null && c !== candidate.mediaCell);
  let overflowPx = cellOverflowPx(candidate.contentRegion);
  for (const cell of textCells) overflowPx += cellOverflowPx(cell);
  const mediaArea = candidate.mediaCell ? containedMediaAreaOf(candidate.mediaCell) : 0;
  const minTextWidth = textCells.length ? Math.min(...textCells.map((c) => c.clientWidth)) : 0;
  return { id, overflowPx, mediaArea, minTextWidth };
}

type GroupedCandidateMeasurement = {
  measurement: PresentationCandidateMeasurement;
  columnImbalancePx: number;
};

function intrinsicStackHeight(stack: HTMLElement | null): number {
  if (!stack) return 0;
  if (stack.scrollHeight > 0) return stack.scrollHeight;
  const gap = parseFloat(stack.style.rowGap || "0") || 0;
  return Array.from(stack.children).reduce((sum, child) => sum + elementHeight(child as HTMLElement), 0)
    + Math.max(0, stack.children.length - 1) * gap;
}

function chooseGroupedCalloutCandidate(measurements: GroupedCandidateMeasurement[]): string | null {
  if (measurements.length === 0) return null;
  const plain = measurements.map((entry) => entry.measurement);
  const chosen = choosePresentationCandidate(plain);
  if (!chosen) return null;
  const winner = measurements.find((entry) => entry.measurement.id === chosen);
  if (!winner) return chosen;

  const valid = plain.filter((measurement) => measurement.overflowPx <= 1);
  const equivalent = valid.length > 0
    ? measurements.filter((entry) => entry.measurement.overflowPx <= 1
      && Math.abs(entry.measurement.mediaArea - winner.measurement.mediaArea) / Math.max(Math.abs(entry.measurement.mediaArea), Math.abs(winner.measurement.mediaArea), 1) < 0.01
      && entry.measurement.minTextWidth === winner.measurement.minTextWidth)
    : measurements.filter((entry) => entry.measurement.overflowPx === winner.measurement.overflowPx
      && entry.measurement.mediaArea === winner.measurement.mediaArea);
  return equivalent.reduce((best, entry) => entry.columnImbalancePx < best.columnImbalancePx ? entry : best, winner).measurement.id;
}

/** Overflow réel du candidat déjà construit : content-region + cellules/blocs non-média uniquement. Jamais le média en contain. */
function measureCandidateOverflow(candidate: BuiltCandidate): OverflowSnapshot {
  let overflowPx = cellOverflowPx(candidate.contentRegion);
  if (candidate.nonMediaBlocks) {
    for (const block of candidate.nonMediaBlocks) overflowPx += cellOverflowPx(block);
  } else {
    const textCells = [candidate.cellA, candidate.cellB].filter((c): c is HTMLElement => c !== null && c !== candidate.mediaCell);
    for (const cell of textCells) overflowPx += cellOverflowPx(cell);
  }
  const overflow = candidate.forcedOverflow || overflowPx > 1;
  return { overflow, overflowPx };
}

/** Applique l'override uniquement aux familles de plans déjà produites par le moteur. */
function layoutPlansForOverride(
  plans: PresentationCandidatePlan[],
  override: PresentationLayoutOverride | null,
): PresentationCandidatePlan[] {
  if (override === null) return plans;
  if (override === "flow") return [];
  if (override === "columns") return plans.filter((plan) => plan.geometry === "split");

  // image-left : média en cellule A
  if (override === "image-left") {
    return plans.filter((plan) => plan.geometry === "split" && plan.mediaPosition === "a");
  }

  // image-right : média en cellule B
  return plans.filter((plan) => plan.geometry === "split" && plan.mediaPosition === "b");
}

/**
 * Construit TOUS les candidats SPLIT/STACK comme des DOM complets attachés
 * simultanément au measurementHost, les mesure, choisit le gagnant avec
 * choosePresentationCandidate (inchangé), détruit les perdants, et retourne
 * le DOM du gagnant intact — jamais reconstruit.
 */
function chooseAndKeepWinner(
  host: HTMLElement,
  index: number,
  sourceChildren: HTMLElement[],
  plans: PresentationCandidatePlan[],
  isTitle: boolean,
  descriptors: PresentationBlockDescriptor[],
  hasLongCitation: boolean,
  theme: ResolvedPresentationTheme,
  allowFlowFallback: boolean,
): BuiltCandidate {
  const built = plans.map((plan) => ({ plan, candidate: buildCandidateSection(host, index, sourceChildren, plan, isTitle, descriptors, hasLongCitation, theme) }));
  const measurements: PresentationCandidateMeasurement[] = built.map(({ plan, candidate }) => measureBuiltCandidate(plan.id, candidate));
  const isGroupedCallout = plans[0]?.id.startsWith("grouped-") ?? false;
  const groupedMeasurements = isGroupedCallout
    ? built.map(({ candidate }, index) => ({ measurement: measurements[index], columnImbalancePx: Math.abs(intrinsicStackHeight(candidate.stackA) - intrinsicStackHeight(candidate.stackB)) }))
    : [];
  const chosenId = isGroupedCallout ? chooseGroupedCalloutCandidate(groupedMeasurements) : choosePresentationCandidate(measurements);
  const winnerEntry = built.find((b) => b.plan.id === chosenId) ?? built[0];

  const isTextText = !isGroupedCallout && plans.every((plan) => plan.geometry === "split" && plan.mediaPosition === null);
  const allSplitsOverflow = (isTextText || isGroupedCallout) && measurements.every((measurement) => measurement.overflowPx > 1);
  if (allowFlowFallback && allSplitsOverflow) {
    const flowCandidate = buildCandidateSection(host, index, sourceChildren, null, isTitle, descriptors, hasLongCitation, theme);
    const flowMeasurement = measureCandidateOverflow(flowCandidate);
    const bestSplitOverflowPx = measurements.find((measurement) => measurement.id === winnerEntry.plan.id)?.overflowPx ?? Number.POSITIVE_INFINITY;
    const flowWins = !flowMeasurement.overflow || flowMeasurement.overflowPx < bestSplitOverflowPx;
    if (flowWins) {
      for (const entry of built) entry.candidate.section.remove();
      return flowCandidate;
    }
    flowCandidate.section.remove();
  }

  for (const entry of built) {
    if (entry !== winnerEntry) entry.candidate.section.remove(); // détruit les candidats perdants.
  }
  return winnerEntry.candidate;
}

/* Médias visuels asynchrones : chaque listener appartient explicitement à SA slide,
 * jamais à « la slide actuellement active » — l'AbortController fourni par
 * l'appelant (par slide) est l'unique mécanisme d'annulation. Le renderer ne
 * reconstruit rien lui-même : il se contente de notifier l'appelant. */
function bindMediaListeners(inner: HTMLElement, controller: AbortController, onMediaResolved?: () => void): void {
  if (!onMediaResolved) return;
  const images = Array.from(inner.querySelectorAll("img"));
  for (const image of images) {
    if (image.complete) continue;
    const resolve = () => onMediaResolved();
    image.addEventListener("load", resolve, { signal: controller.signal, once: true });
    image.addEventListener("error", resolve, { signal: controller.signal, once: true });
  }
}

/**
 * Rend UNE slide, en respectant l'invariant DOM mesuré === DOM affiché :
 *  1. rendu source (une seule fois) dans un environnement hors écran ;
 *  2. analyse structurelle + génération de candidats ;
 *  3. chaque candidat est un DOM COMPLET de slide, construit et attaché au
 *     measurementHost (jamais un fragment mesuré séparément puis rejoué) ;
 *  4. mesure de chaque candidat pendant qu'il est attaché ;
 *  5. choix du meilleur candidat (choosePresentationCandidate) ;
 *  6. destruction des candidats perdants ;
 *  7. le candidat gagnant est détaché du measurementHost et inséré tel
 *     quel dans `deckContainer` — jamais reconstruit, jamais recomposé ;
 *  8. overflow revérifié sur ce même DOM une fois inséré (signal défensif).
 * FLOW suit le même principe avec un candidat unique (aucune comparaison).
 */
export async function renderPresentationSlide(options: RenderPresentationSlideOptions): Promise<RenderedPresentationSlide> {
  const { app, component, sourcePath, markdown, index, generation, measurementHost, deckContainer, controller, isGenerationStale, onMediaResolved, roleEditorDisplay } = options;
  const theme = options.theme ?? resolvePresentationTheme("classic");
  const layoutOverride = options.layoutOverride ?? null;

  const sourceRoot = measurementHost.createDiv({ cls: "feuillets-presentation-render-source" });
  styleEl(sourceRoot, { position: "absolute", left: "-100000px", top: "0", width: `${PRESENTATION_SLIDE_WIDTH}px`, visibility: "hidden", pointerEvents: "none" });
  await MarkdownRenderer.render(app, markdown, sourceRoot, sourcePath, component);

  if (isGenerationStale() || controller.signal.aborted) {
    // génération périmée avant la moindre mesure : rien à construire, juste une coquille jetable.
    sourceRoot.remove();
    const section = deckContainer.createEl("section", { cls: "feuillets-presentation-render-slide", attr: { "data-slide-index": String(index) } });
    const inner = section.createDiv({ cls: "feuillets-presentation-render-inner" });
    return { index, generation, overflow: false, geometry: null, candidate: null, section, inner, controller };
  }

  await resolveVideoMetadataForRender(sourceRoot, controller.signal);

  if (isGenerationStale() || controller.signal.aborted) {
    sourceRoot.remove();
    const section = deckContainer.createEl("section", { cls: "feuillets-presentation-render-slide", attr: { "data-slide-index": String(index) } });
    const inner = section.createDiv({ cls: "feuillets-presentation-render-inner" });
    return { index, generation, overflow: false, geometry: null, candidate: null, section, inner, controller };
  }

  // Applique les rôles sémantiques Feuillets (détection + classes + icônes)
  applySemanticRoles(sourceRoot);

  applyMarkdownReset(sourceRoot);

  // Pose l'autonomie visuelle complète des callouts (chrome + titre + contenu), AVANT tout
  // descriptor/snapshot/clonage/mesure : le DOM ainsi stylé est celui qui est ensuite affiché.
  applyPresentationCalloutDisplay(sourceRoot, roleEditorDisplay, theme);
  applyPresentationTypography(sourceRoot, theme);

  const hasSynthese = Array.from(sourceRoot.querySelectorAll<HTMLElement>(".callout"))
    .some((callout) => isSemanticRoleCallout(callout) && semanticRoleForElement(callout) === "synthese");

  const buildProfileWinner = (profile: SyntheseRhythmProfile | null): BuiltCandidate => {
    const preparedRoot = profile
      ? measurementHost.createDiv({ cls: "feuillets-presentation-render-prepared" })
      : sourceRoot;
    if (profile) {
      for (const child of Array.from(sourceRoot.children)) preparedRoot.appendChild(child.cloneNode(true));
      applySyntheseVerticalRhythm(preparedRoot, profile);
    }

    const descriptors = descriptorsForSlide(preparedRoot);
    const isTitle = layoutOverride === "flow" ? false : isPresentationTitleSlide(index, descriptors);
    const hasLongCitation = Array.from(preparedRoot.querySelectorAll<HTMLElement>(".callout")).some(isLongCitationCallout);
    const groupedCalloutPlans = isTitle ? [] : generateGroupedCalloutCandidates(descriptors);
    const automaticPlans = isTitle
      ? []
      : groupedCalloutPlans.length > 0 ? groupedCalloutPlans : generatePresentationCandidates(descriptors);
    const plans = layoutPlansForOverride(automaticPlans, layoutOverride);
    const overrideApplied = layoutOverride !== null && (layoutOverride === "flow" || plans.length > 0);
    /* Chaque profil repart d'une base indépendante. Les candidats clonent
     * ensuite cette base exactement comme dans le pipeline historique. */
    const sourceChildren = Array.from(preparedRoot.children) as HTMLElement[];
    const winner = plans.length === 0
      ? buildCandidateSection(measurementHost, index, sourceChildren, null, isTitle, descriptors, hasLongCitation, theme)
      : chooseAndKeepWinner(measurementHost, index, sourceChildren, plans, isTitle, descriptors, hasLongCitation, theme, layoutOverride === null);
    if (layoutOverride) {
      winner.section.setAttribute("data-layout-override", layoutOverride);
      winner.section.setAttribute("data-layout-override-applied", overrideApplied ? "true" : "false");
    }
    if (profile) preparedRoot.remove();
    return winner;
  };

  const normalWinner = buildProfileWinner(hasSynthese ? SYNTHESE_RHYTHM_NORMAL : null);
  let winner = normalWinner;
  const normalOverflowPx = hasSynthese ? measureCandidateOverflow(normalWinner).overflowPx : 0;
  if (hasSynthese && normalOverflowPx > 0) {
    const compactWinner = buildProfileWinner(SYNTHESE_RHYTHM_COMPACT);
    const compactOverflowPx = measureCandidateOverflow(compactWinner).overflowPx;
    if (compactOverflowPx < normalOverflowPx) {
      normalWinner.section.remove();
      winner = compactWinner;
    } else {
      compactWinner.section.remove();
    }
  }

  // Mesure AVANT adoption — le candidat est encore attaché au measurementHost.
  const before = measureCandidateOverflow(winner);

  // Adoption directe : détacher du host, insérer dans le conteneur final. Aucune
  // reconstruction, aucun recalcul de géométrie — le DOM mesuré devient, tel
  // quel, le DOM affiché.
  winner.section.remove();
  deckContainer.appendChild(winner.section);

  // Mesure à nouveau le MÊME DOM, maintenant dans le conteneur final : le layout
  // ne doit jamais changer. Une divergence de plus de 1px est un signal défensif,
  // jamais un déclencheur de reconstruction — elle marque simplement la slide en
  // overflow.
  const after = measureCandidateOverflow(winner);
  const diverged = Math.abs(after.overflowPx - before.overflowPx) > 1;
  const overflow = before.overflow || after.overflow || diverged;
  winner.section.setAttribute("data-overflow", overflow ? "true" : "false");
  winner.section.classList.toggle("has-overflow", overflow);

  sourceRoot.remove();

  const geometry = (winner.section.getAttribute("data-geometry") as PresentationGeometry | null) ?? null;
  const candidate = winner.section.getAttribute("data-candidate");
  bindMediaListeners(winner.inner, controller, onMediaResolved);

  return { index, generation, overflow, geometry, candidate, section: winner.section, inner: winner.inner, controller };
}
