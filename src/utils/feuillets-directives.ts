export type FeuilletsDirective = "dessous" | "ligne" | "espace";

const DIRECTIVE_LINE = /^(\s*(?:>\s*)?)%%\s*(dessous|ligne|espace)\s*(?::\s*([^%]+?)\s*)?%%\s*$/u;
const MARKER_PREFIX = "FEUILLETS-DIRECTIVE:";
const MARKER_FRAGMENT = /FEUILLETS-DIRECTIVE:(?:dessous|ligne|espace)(?::\s*(?:-?\d+|[A-Za-z]+)(?:\s*mm)?)?/gu;

/* ===== Directive `%% image: … %%` (LOT 3A — placement/largeur locaux) =====
 * Même architecture que dessous/ligne/espace ci-dessus (ligne autonome ->
 * marqueur texte -> retrouvé après rendu -> traduit en classe -> retiré du
 * DOM final) mais dans un préfixe/registre séparé : la valeur porte un `%`
 * littéral (« 40% ») que [^%]+ de DIRECTIVE_LINE ne peut pas capturer, donc
 * un second petit couple regex/marqueur est nécessaire — PAS un second
 * moteur général, seulement l'extension de ce même mécanisme à cette
 * grammaire-ci. */
export type ImagePlacement = "gauche" | "centre" | "droite" | "pleine-largeur";
export type ImageWidth = 25 | 33 | 40 | 50 | 60 | 67 | 75 | 100;
export type ParsedImageDirective = { placement: "auto" } | { placement: ImagePlacement; width?: ImageWidth };

const IMAGE_DIRECTIVE_LINE = /^(\s*(?:>\s*)?)%%\s*image\s*:\s*(.+?)\s*%%\s*$/u;
const IMAGE_MARKER_PREFIX = "FEUILLETS-IMAGE-DIRECTIVE:";
const IMAGE_MARKER_FRAGMENT = /FEUILLETS-IMAGE-DIRECTIVE:[a-z-]+\d*/gu;
const IMAGE_WIDTHS: readonly ImageWidth[] = [25, 33, 40, 50, 60, 67, 75, 100];

/** Grammaire stricte (§21 du lot) : `auto`, `pleine-largeur` seuls, ou
 * gauche/centre/droite avec une largeur optionnelle parmi les 8 valeurs
 * autorisées EXACTEMENT — jamais de px/cm/mm/calc, jamais de largeur après
 * auto/pleine-largeur. Toute autre forme est invalide et reste silencieuse
 * (la ligne d'origine n'est jamais transformée, voir prepareFeuilletsDirectives). */
function parseImageDirectiveValue(raw: string): ParsedImageDirective | null {
  const trimmed = raw.trim();
  if (trimmed === "auto") return { placement: "auto" };
  if (trimmed === "pleine-largeur") return { placement: "pleine-largeur" };
  const match = trimmed.match(/^(gauche|centre|droite)(?:\s+(\d+)%)?$/u);
  if (!match) return null;
  const placement = match[1] as ImagePlacement;
  if (!match[2]) return { placement };
  const width = Number(match[2]) as ImageWidth;
  return IMAGE_WIDTHS.includes(width) ? { placement, width } : null;
}

/** Même grammaire que ci-dessus, appliquée à une ligne source brute plutôt
 * qu'à la valeur déjà isolée — réutilisée par le Live Preview (voir
 * cm-feuillets-directives.ts) pour ne masquer QUE les directives valides. */
export function parseImageDirectiveLine(line: string): ParsedImageDirective | null {
  const match = line.match(IMAGE_DIRECTIVE_LINE);
  return match ? parseImageDirectiveValue(match[2]) : null;
}

function encodeImageDirective(parsed: ParsedImageDirective): string {
  if (parsed.placement === "auto") return `${IMAGE_MARKER_PREFIX}auto`;
  if (parsed.placement === "pleine-largeur") return `${IMAGE_MARKER_PREFIX}pleine-largeur`;
  return `${IMAGE_MARKER_PREFIX}${parsed.placement}${parsed.width ? `-${parsed.width}` : ""}`;
}

/** Décode un fragment de marqueur retrouvé dans le DOM déjà rendu (voir
 * applyFeuilletsDirectiveMarkers) — pendant de parseFeuilletsDirective, pour
 * le registre image. */
export function parseFeuilletsImageDirective(text: string): ParsedImageDirective | null {
  if (!text.startsWith(IMAGE_MARKER_PREFIX)) return null;
  const raw = text.slice(IMAGE_MARKER_PREFIX.length);
  if (raw === "auto") return { placement: "auto" };
  if (raw === "pleine-largeur") return { placement: "pleine-largeur" };
  const match = raw.match(/^(gauche|centre|droite)(?:-(\d+))?$/u);
  if (!match) return null;
  const placement = match[1] as ImagePlacement;
  if (!match[2]) return { placement };
  const width = Number(match[2]) as ImageWidth;
  return IMAGE_WIDTHS.includes(width) ? { placement, width } : null;
}

const IMAGE_PLACEMENT_CLASS: Record<ImagePlacement, string> = {
  gauche: "feuillets-image-placement-left",
  centre: "feuillets-image-placement-center",
  droite: "feuillets-image-placement-right",
  "pleine-largeur": "feuillets-image-placement-full",
};

/** La PREMIÈRE image immédiatement associée à la directive (§3 du lot) :
 * soit déjà dans le même paragraphe que le marqueur (rendu fusionné, sans
 * ligne vide entre la directive et l'embed), soit dans le bloc qui suit
 * immédiatement — jamais au-delà, jamais les images suivantes. */
function nextImageDirectiveTarget(markerParagraph: Element): HTMLImageElement | null {
  const own = markerParagraph.querySelector("img");
  if (own) return own;
  const next = markerParagraph.nextElementSibling;
  if (!next) return null;
  return (next.tagName === "IMG" ? next : next.querySelector("img")) as HTMLImageElement | null;
}

/** Pose les classes finies (§11/§21 du lot) directement sur l'<img> — un
 * emplacement stable qui traverse le pipeline sans être perturbé par le
 * retrait ultérieur des attributs data-* (stripObsidianCruft) : composeDocumentMedia
 * (export-render.ts) les retrouve ensuite sur ce même nœud pour construire
 * le wrapper final. `auto` équivaut explicitement à l'absence de surcharge
 * (§6) : aucune classe n'est jamais posée pour ce cas. */
function applyImageDirectiveClass(image: HTMLImageElement, parsed: ParsedImageDirective): void {
  if (parsed.placement === "auto") return;
  image.classList.add(IMAGE_PLACEMENT_CLASS[parsed.placement]);
  if ("width" in parsed && parsed.width) image.classList.add(`feuillets-image-width-${parsed.width}`);
}

/* ===== Directive `%% colonnes: … %%` (LOT 3B — compositions explicites en
 * deux colonnes) =====
 * Même architecture, préfixe/registre séparé encore une fois (le ratio "/"
 * ne pose pas de problème de capture ici, mais garder un registre distinct
 * évite d'entremêler trois grammaires très différentes — dessous/ligne/
 * espace — dans un seul regex partagé, comme suggéré par le lot lui-même). */
export type ColumnComposition = "image-texte" | "texte-image" | "image-image";
export type ColumnRatio = "40/60" | "50/50" | "60/40";
export type ParsedColumnsDirective = { composition: ColumnComposition; ratio: ColumnRatio };

const COLUMNS_DIRECTIVE_LINE = /^(\s*(?:>\s*)?)%%\s*colonnes\s*:\s*(.+?)\s*%%\s*$/u;
const COLUMNS_MARKER_PREFIX = "FEUILLETS-COLUMNS-DIRECTIVE:";
const COLUMNS_MARKER_FRAGMENT = /FEUILLETS-COLUMNS-DIRECTIVE:[a-z-]+:[0-9-]+/gu;
const COLUMN_RATIOS: readonly ColumnRatio[] = ["40/60", "50/50", "60/40"];

/** Grammaire stricte (§3/§34 du lot) : composition ∈ {image-texte, texte-
 * image, image-image}, ratio ∈ {40/60, 50/50, 60/40} EXACTEMENT, séparés par
 * un espace unique. Aucune autre valeur numérique, aucune normalisation. */
function parseColumnsDirectiveValue(raw: string): ParsedColumnsDirective | null {
  const match = raw.trim().match(/^(image-texte|texte-image|image-image)\s+(40\/60|50\/50|60\/40)$/u);
  if (!match) return null;
  const ratio = match[2] as ColumnRatio;
  return COLUMN_RATIOS.includes(ratio) ? { composition: match[1] as ColumnComposition, ratio } : null;
}

/** Pendant de parseImageDirectiveLine — grammaire partagée avec le Live
 * Preview (cm-feuillets-directives.ts), pour ne masquer que les formes valides. */
export function parseColumnsDirectiveLine(line: string): ParsedColumnsDirective | null {
  const match = line.match(COLUMNS_DIRECTIVE_LINE);
  return match ? parseColumnsDirectiveValue(match[2]) : null;
}

function encodeColumnsDirective(parsed: ParsedColumnsDirective): string {
  return `${COLUMNS_MARKER_PREFIX}${parsed.composition}:${parsed.ratio.replace("/", "-")}`;
}

/** Décode un fragment de marqueur retrouvé dans le DOM déjà rendu — pendant
 * de parseFeuilletsImageDirective, pour le registre colonnes. */
export function parseFeuilletsColumnsDirective(text: string): ParsedColumnsDirective | null {
  if (!text.startsWith(COLUMNS_MARKER_PREFIX)) return null;
  const raw = text.slice(COLUMNS_MARKER_PREFIX.length);
  const match = raw.match(/^(image-texte|texte-image|image-image):(40-60|50-50|60-40)$/u);
  if (!match) return null;
  return { composition: match[1] as ColumnComposition, ratio: match[2].replace("-", "/") as ColumnRatio };
}

function columnsMarkerFragments(text: string): string[] {
  return Array.from(text.matchAll(COLUMNS_MARKER_FRAGMENT), (match) => match[0]);
}

/** Un paragraphe-marqueur déjà "consommé" (dessous/image/colonnes) : sans
 * rendu propre une fois ses fragments techniques retirés, et ne portant
 * aucun média — exactement le même critère que celui utilisé par
 * removeDirectiveFragments pour décider de le retirer du DOM. Ignoré (§6 du
 * lot) lors de la recherche des deux blocs structurels qui suivent une
 * directive `colonnes:` — jamais un titre, une table ou un autre contenu
 * utilisateur, qui restent des obstacles opaques à la recherche. */
function isSpentDirectiveMarkerParagraph(el: Element): boolean {
  if (el.tagName !== "P" || el.querySelector("img, .internal-embed")) return false;
  const text = el.textContent || "";
  if (!text.includes(MARKER_PREFIX) && !text.includes(IMAGE_MARKER_PREFIX) && !text.includes(COLUMNS_MARKER_PREFIX)) return false;
  return text.replace(MARKER_FRAGMENT, "").replace(IMAGE_MARKER_FRAGMENT, "").replace(COLUMNS_MARKER_FRAGMENT, "").trim() === "";
}

function nextStructuralSibling(el: Element): Element | null {
  let sibling = el.nextElementSibling;
  while (sibling && isSpentDirectiveMarkerParagraph(sibling)) sibling = sibling.nextElementSibling;
  return sibling;
}

/** Les DEUX PREMIERS blocs structurels qui suivent la directive (§5 du lot)
 * — jamais un troisième, jamais de portée persistante : un simple appel
 * ponctuel à nextElementSibling deux fois de suite, sans aucun état conservé
 * entre deux directives `colonnes:`. */
function nextTwoStructuralBlocks(markerParagraph: Element): [Element, Element] | null {
  const first = nextStructuralSibling(markerParagraph);
  if (!first) return null;
  const second = nextStructuralSibling(first);
  return second ? [first, second] : null;
}

/** Slot `image` (§7 du lot) : un bloc P/FIGURE contenant EXACTEMENT une
 * image reconnue — jamais plusieurs images dans le même paragraphe. */
function isImageSlotBlock(el: Element): boolean {
  return (el.tagName === "P" || el.tagName === "FIGURE") && el.querySelectorAll("img").length === 1;
}

/** Slot `texte` (§8 du lot) : un paragraphe sans image, une liste, une
 * citation, ou un callout (natif Obsidian ou rôle sémantique Feuillets
 * déjà rendu — data-callout ou .callout) — jamais un heading, une table,
 * ni un bloc portant une image. */
function isTextSlotBlock(el: Element): boolean {
  if (el.querySelector("img, .internal-embed")) return false;
  const tag = el.tagName;
  if (tag === "P" || tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE") return true;
  return el.getAttribute("data-callout") != null || el.classList.contains("callout");
}

const COLUMN_KIND_BY_COMPOSITION: Record<ColumnComposition, readonly ["media" | "text", "media" | "text"]> = {
  "image-texte": ["media", "text"],
  "texte-image": ["text", "media"],
  "image-image": ["media", "media"],
};

function blocksMatchComposition(composition: ColumnComposition, first: Element, second: Element): boolean {
  if (composition === "image-image") return isImageSlotBlock(first) && isImageSlotBlock(second);
  if (composition === "image-texte") return isImageSlotBlock(first) && isTextSlotBlock(second);
  return isTextSlotBlock(first) && isImageSlotBlock(second);
}

/** Construit le wrapper `.feuillets-columns` (§11/§12 du lot) et y DÉPLACE
 * (jamais ne clone) les deux blocs déjà identifiés. Ne s'applique QUE si la
 * structure réelle correspond exactement à la composition demandée (§9) —
 * sinon rien n'est modifié, le marqueur technique disparaîtra quand même
 * ensuite via removeDirectiveFragments, comme toute directive Feuillets
 * valide. La profondeur du wrapper (deux niveaux de div sous le conteneur)
 * suffit à elle seule à faire disparaître les deux blocs des candidats du
 * pairing média+rôle automatique ET du portrait-flow ensuite (composeDocumentMedia,
 * export-render.ts) : directBlockForImage n'y reconnaît un bloc image que
 * lorsqu'il est un enfant DIRECT du conteneur — priorité 3B garantie sans
 * marqueur supplémentaire (§11). */
function composeExplicitColumns(markerParagraph: Element, parsed: ParsedColumnsDirective): void {
  const blocks = nextTwoStructuralBlocks(markerParagraph);
  if (!blocks) return;
  const [first, second] = blocks;
  if (!blocksMatchComposition(parsed.composition, first, second)) return;
  const container = markerParagraph.parentElement;
  if (!container) return;

  const [firstKind, secondKind] = COLUMN_KIND_BY_COMPOSITION[parsed.composition];
  const wrapper = createDiv({ cls: `feuillets-columns feuillets-columns-${parsed.ratio.replace("/", "-")}` });
  const firstColumn = createDiv({ cls: `feuillets-column feuillets-column-first feuillets-column-${firstKind}` });
  const secondColumn = createDiv({ cls: `feuillets-column feuillets-column-second feuillets-column-${secondKind}` });

  container.insertBefore(wrapper, first);
  firstColumn.appendChild(first);
  secondColumn.appendChild(second);
  wrapper.appendChild(firstColumn);
  wrapper.appendChild(secondColumn);
}

export function prepareFeuilletsDirectives(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let inFrontmatter = lines[0]?.trim() === "---";
  return lines.map((line) => {
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      return line;
    }
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const imageMatch = line.match(IMAGE_DIRECTIVE_LINE);
    if (imageMatch) {
      const parsedImage = parseImageDirectiveValue(imageMatch[2]);
      return parsedImage ? `${imageMatch[1]}${encodeImageDirective(parsedImage)}` : line;
    }
    const columnsMatch = line.match(COLUMNS_DIRECTIVE_LINE);
    if (columnsMatch) {
      const parsedColumns = parseColumnsDirectiveValue(columnsMatch[2]);
      return parsedColumns ? `${columnsMatch[1]}${encodeColumnsDirective(parsedColumns)}` : line;
    }
    const match = line.match(DIRECTIVE_LINE);
    return match ? `${match[1]}${MARKER_PREFIX}${match[2]}${match[3] ? `:${match[3].trim()}` : ""}` : line;
  }).join("\n");
}

export type ParsedFeuilletsDirective = { directive: FeuilletsDirective; value?: number; unit?: "lh" | "mm" };

export function parseFeuilletsDirective(text: string): ParsedFeuilletsDirective | null {
  if (!text.startsWith(MARKER_PREFIX)) return null;
  const [, name, rawValue] = text.split(":", 3);
  if (name === "dessous") return { directive: "dessous" };
  if (name !== "ligne" && name !== "espace") return null;
  const value = rawValue?.trim().match(/^([1-9]\d*)(?:\s*(mm))?$/u);
  if (!value) return null;
  if (name === "ligne" && value[2]) return null;
  return { directive: name, value: Number(value[1]), unit: value[2] ? "mm" : "lh" };
}

function appendAnswerDecoration(li: HTMLElement, parsed: ParsedFeuilletsDirective): void {
  Array.from(li.children).forEach((child) => {
    if (child.classList.contains("feuillets-answer-line") || child.classList.contains("feuillets-answer-space")) child.remove();
  });
  li.classList.add("feuillets-answer-custom");
  if (parsed.directive === "ligne") {
    for (let index = 0; index < (parsed.value || 0); index++) {
      const line = createSpan({ cls: "feuillets-answer-line" });
      li.appendChild(line);
    }
    return;
  }
  const space = createSpan({ cls: "feuillets-answer-space" });
  space.setAttribute("style", `height: ${parsed.value}${parsed.unit === "mm" ? "mm" : "lh"};`);
  li.appendChild(space);
}

function markerFragments(text: string): string[] {
  return Array.from(text.matchAll(MARKER_FRAGMENT), (match) => match[0]);
}

function imageMarkerFragments(text: string): string[] {
  return Array.from(text.matchAll(IMAGE_MARKER_FRAGMENT), (match) => match[0]);
}

type DirectiveTextNode = {
  parent: Element;
  text: string;
  replace: (text: string) => void;
};

function directiveTextNodes(root: Element): DirectiveTextNode[] {
  const document = root.ownerDocument;
  if (document?.createTreeWalker) {
    const walker = document.createTreeWalker(root, 4);
    const nodes: DirectiveTextNode[] = [];
    let node = walker.nextNode();
    while (node) {
      const textNode = node;
      const parent = textNode.parentElement;
      const text = textNode.nodeValue || "";
      if (parent && (text.includes(MARKER_PREFIX) || text.includes(IMAGE_MARKER_PREFIX) || text.includes(COLUMNS_MARKER_PREFIX))) {
        nodes.push({ parent, text, replace: (value) => { textNode.nodeValue = value; } });
      }
      node = walker.nextNode();
    }
    return nodes;
  }
  return Array.from(root.querySelectorAll("*")).flatMap((el) => {
    const text = el.children.length === 0 ? el.textContent || "" : "";
    return (text.includes(MARKER_PREFIX) || text.includes(IMAGE_MARKER_PREFIX) || text.includes(COLUMNS_MARKER_PREFIX)) ? [{ parent: el, text, replace: (value: string) => { el.textContent = value; } }] : [];
  });
}

function removeDirectiveFragments(root: Element): void {
  directiveTextNodes(root).forEach((node) => {
    const cleaned = node.text.replace(MARKER_FRAGMENT, "").replace(IMAGE_MARKER_FRAGMENT, "").replace(COLUMNS_MARKER_FRAGMENT, "");
    if (cleaned === node.text) return;
    node.replace(cleaned);
    if (node.parent.tagName === "P" && !node.parent.textContent?.trim() && !node.parent.querySelector("img, .internal-embed")) node.parent.remove();
  });
}

export function hasRemainingFeuilletsDirectiveMarker(root: Element): boolean {
  return directiveTextNodes(root).some((node) => node.text.includes(MARKER_PREFIX) || node.text.includes(IMAGE_MARKER_PREFIX) || node.text.includes(COLUMNS_MARKER_PREFIX));
}

function isMainQuestionItem(li: Element, role: Element): li is HTMLElement {
  if (li.tagName !== "LI" || li.parentElement?.tagName !== "OL") return false;
  let ancestor = li.parentElement?.parentElement || null;
  while (ancestor && ancestor !== role) {
    if (ancestor.tagName === "LI") return false;
    ancestor = ancestor.parentElement;
  }
  return ancestor === role;
}

function hasClass(el: Element, className: string): boolean {
  return el.classList?.contains(className) || false;
}

function questionRoles(root: Element): Element[] {
  const roles = new Set<Element>();
  if (hasClass(root, "feuillets-role-questions") || root.getAttribute("data-callout")?.trim().toLowerCase() === "questions") roles.add(root);
  root.querySelectorAll("[data-callout], .feuillets-role-questions").forEach((el) => {
    if (hasClass(el, "feuillets-role-questions") || el.getAttribute("data-callout")?.trim().toLowerCase() === "questions") roles.add(el);
  });
  return Array.from(roles);
}

function applyQuestionDirectives(role: Element): number {
  let count = 0;
  const directives = new Map<HTMLElement, ParsedFeuilletsDirective>();
  const elements = Array.from(role.querySelectorAll("*"));
  const questions = elements.filter((el): el is HTMLElement => el.tagName === "LI" && isMainQuestionItem(el, role));

  for (const node of directiveTextNodes(role)) {
    for (const fragment of markerFragments(node.text)) {
      const parsed = parseFeuilletsDirective(fragment);
      if (!parsed || parsed.directive === "dessous") continue;
      const containingItem = node.parent.closest("li");
      const precedingQuestions = questions.filter((li) => elements.indexOf(li) < elements.indexOf(node.parent));
      const target = containingItem && isMainQuestionItem(containingItem, role)
        ? containingItem
        : precedingQuestions[precedingQuestions.length - 1] || null;
      if (target) directives.set(target, parsed);
    }
  }

  removeDirectiveFragments(role);
  questions.forEach((li) => {
    appendAnswerDecoration(li, directives.get(li) || { directive: "ligne", value: 2, unit: "lh" });
    count++;
  });
  return count;
}

export function applyFeuilletsDirectiveMarkers(root: HTMLElement): number {
  let count = 0;
  directiveTextNodes(root).forEach((node) => {
    for (const fragment of markerFragments(node.text)) {
      const parsed = parseFeuilletsDirective(fragment);
      if (parsed?.directive !== "dessous") continue;
      const previous = node.parent.previousElementSibling;
      if (previous?.querySelector("img, .internal-embed")) previous.classList.add("feuillets-directive-dessous");
    }
    for (const fragment of imageMarkerFragments(node.text)) {
      const parsed = parseFeuilletsImageDirective(fragment);
      if (!parsed) continue;
      const target = nextImageDirectiveTarget(node.parent);
      if (target) applyImageDirectiveClass(target, parsed);
    }
    for (const fragment of columnsMarkerFragments(node.text)) {
      const parsed = parseFeuilletsColumnsDirective(fragment);
      if (!parsed) continue;
      composeExplicitColumns(node.parent, parsed);
    }
  });
  questionRoles(root).forEach((role) => { count += applyQuestionDirectives(role); });
  removeDirectiveFragments(root);
  return count;
}

export function isFeuilletsDirective(el: Element, directive: FeuilletsDirective): boolean {
  return el.getAttribute("data-feuillets-directive") === directive;
}
