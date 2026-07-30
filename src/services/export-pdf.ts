import { Notice, Platform } from "obsidian";
import type { App } from "obsidian";
import { renderManuscriptHtmlWithFrontPages, FRONT_PAGE_CSS } from "./export-render.js";
import { templateToCss, titleRoleCss } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";

type PdfFootnote = {
  id: string;
  html: string;
};

type PdfExportSegment = {
  text: string;
  frontType?: string | null;
};

type PdfExportInput = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments?: PdfExportSegment[];
};

type PaginationResult = {
  pagesHtml: string;
  totalPages: number;
};

type PdfPageSize = string;
type PdfOrientation = string;
type PdfPageNumberPosition = "left" | "center" | "right";

function isPageElement(node: Node): node is Element {
  return "outerHTML" in node && "classList" in node;
}

function measuredHeight(node: Element): number {
  return "offsetHeight" in node && typeof node.offsetHeight === "number" ? node.offsetHeight || 30 : 30;
}

/** Normalise un identifiant brut de note (issu de href, id, data-footnote-id, etc.)
 * en une clé canonique : décodage d'URL, normalisation Unicode NFC,
 * suppression du '#' initial et des préfixes d'ancre d'Obsidian/Markdown. */
export function normalizeFootnoteId(raw: string): string {
  if (!raw) return "";
  let s = String(raw).trim();

  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) {
    s = s.slice(hashIdx + 1);
  }

  try {
    s = decodeURIComponent(s);
  } catch {
    /* ignore les erreurs de décodage */
  }

  try {
    s = s.normalize("NFC");
  } catch {
    /* ignore si non supporté */
  }

  const prefixes = [
    "user-content-fnref-",
    "user-content-fn-",
    "user-content-fnref:",
    "user-content-fn:",
    "user-content-",
    "fnref-",
    "fn-",
    "fnref:",
    "fn:",
  ];
  const lower = s.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }

  return s;
}

/** Clé simplifiée (insensible à la casse et aux caractères spéciaux) pour le
 * rapprochement tolérant de notes de bas de page. */
export function simplifyFootnoteId(canonicalId: string): string {
  if (!canonicalId) return "";
  return canonicalId
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export class FootnoteMatcher {
  private idMap = new Map<string, string>();

  constructor(footnotes: PdfFootnote[]) {
    for (const f of footnotes) {
      const raw = f.id;
      if (!raw) continue;
      this.idMap.set(raw, raw);

      const canonical = normalizeFootnoteId(raw);
      if (canonical) {
        this.idMap.set(canonical, raw);
        this.idMap.set(`fn-${canonical}`, raw);
        this.idMap.set(`fnref-${canonical}`, raw);
        this.idMap.set(`#fn-${canonical}`, raw);
        this.idMap.set(`#fnref-${canonical}`, raw);

        const simplified = simplifyFootnoteId(canonical);
        if (simplified) {
          this.idMap.set(simplified, raw);
        }
      }
    }
  }

  match(rawRef: string): string | null {
    if (!rawRef) return null;

    if (this.idMap.has(rawRef)) return this.idMap.get(rawRef)!;

    const canonical = normalizeFootnoteId(rawRef);
    if (canonical && this.idMap.has(canonical)) {
      return this.idMap.get(canonical)!;
    }

    if (canonical) {
      const trimmed = canonical.replace(/[-:][0-9]+$/, "");
      if (trimmed && this.idMap.has(trimmed)) {
        return this.idMap.get(trimmed)!;
      }
    }

    if (canonical) {
      const simplified = simplifyFootnoteId(canonical);
      if (simplified && this.idMap.has(simplified)) {
        return this.idMap.get(simplified)!;
      }
    }

    return null;
  }
}

/** IDs de notes de bas de page effectivement appelées dans cet élément
 * (placement "bas de page") : inspection robuste du DOM pour capturer les
 * structures Obsidian réelles (a, sup, data-footnote-id, data-footnote-ref,
 * href encodé/préfixé, etc.). */
function footnoteIdRefsIn(el: Element, matcher: FootnoteMatcher): string[] {
  if (!el || typeof el !== "object") return [];
  const found: string[] = [];

  const addIfMatched = (raw: string | null | undefined) => {
    if (!raw) return;
    const matchedId = matcher.match(raw);
    if (matchedId && !found.includes(matchedId)) {
      found.push(matchedId);
    }
  };

  const inspectNode = (node: Element) => {
    if (!node || typeof node.getAttribute !== "function") return;

    const href = node.getAttribute("href");
    if (href) addIfMatched(href);

    const dataFnId = node.getAttribute("data-footnote-id");
    if (dataFnId) addIfMatched(dataFnId);

    const dataFnRef = node.getAttribute("data-footnote-ref");
    if (dataFnRef && dataFnRef !== "true" && dataFnRef !== "") {
      addIfMatched(dataFnRef);
    }

    const id = node.getAttribute("id");
    if (id && (id.startsWith("fnref") || id.startsWith("fn-") || id.startsWith("fn:"))) {
      addIfMatched(id);
    }
  };

  const visit = (node: Element) => {
    inspectNode(node);
    if ("children" in node && node.children) {
      const children = Array.from(node.children);
      for (const child of children) {
        visit(child);
      }
    }
  };

  visit(el);
  return found;
}

/** CSS de la zone de notes de bas de page en placement "bas de page" —
 * styles portés par des classes plutôt que par `element.style.*`, ce
 * document PDF n'ayant pas de feuille de style Obsidian à hériter (voir
 * exportPdf, où ce bloc est concaténé au CSS du modèle). `.pdf-page-content`
 * en `flex: 1 1 auto` et `.pdf-page-footnotes` en `flex: 0 0 auto` (posés
 * inline sur la page, voir plus bas) : le contenu principal occupe tout
 * l'espace restant, ce qui pousse mécaniquement la zone de notes tout en
 * bas de la page, même si le contenu ne remplit pas la page entière. */
export const FOOTNOTE_BOTTOM_CSS = `
.pdf-page-footnotes {
  border-top: 1px solid #cccccc;
  margin-top: 8px;
  padding-top: 4px;
  overflow: hidden;
}
.pdf-footnote-entry {
  display: flex;
  gap: 4px;
  font-size: 0.85em;
  margin: 2px 0;
}
.pdf-footnote-num {
  flex-shrink: 0;
}
`;

/** Marge fixe pour la bordure/le rembourrage de `.pdf-page-footnotes`
 * (voir FOOTNOTE_BOTTOM_CSS) — non mesurable via measureHost puisqu'elle
 * appartient à un conteneur, pas aux entrées mesurées individuellement. */
const FOOTNOTE_ZONE_OVERHEAD_PX = 16;

/** Un élément "note de bas de page" autonome (placement "bas de page") :
 * numéro explicite (pas de <ol> natif — la numérotation native ne survit
 * pas à la coupe des notes entre plusieurs pages) + contenu HTML de la
 * note. Même méthode d'insertion sûre que pour le placement "fin du
 * manuscrit" : DOMParser (document inerte, n'exécute ni script ni
 * gestionnaire d'événement) puis migration des nœuds — jamais
 * d'affectation à innerHTML sur un élément vivant. */
function buildFootnoteEntry(footnote: PdfFootnote, number: number): HTMLElement {
  const entry = createDiv({ cls: "pdf-footnote-entry" });
  entry.id = footnote.id;
  entry.createSpan({ cls: "pdf-footnote-num", text: `${number}.` });
  const body = entry.createSpan({ cls: "pdf-footnote-body" });
  const parsed = new DOMParser().parseFromString(footnote.html, "text/html");
  while (parsed.body.firstChild) body.appendChild(parsed.body.firstChild);
  return entry;
}

function isPrintableIframe(iframe: HTMLIFrameElement): iframe is HTMLIFrameElement & { contentDocument: Document; contentWindow: Window } {
  return iframe.contentDocument !== null && iframe.contentWindow !== null;
}

type PageBuild = { content: Element[]; footnotes: Element[] };

/** Sélectionne, à partir de `startIndex`, la plus longue séquence
 * contiguë d'éléments de contenu tenant dans `contentMaxH` — reprise
 * exacte de la logique de saut de page (titres H1/H2, pages Front,
 * dépassement de hauteur) utilisée par le placement "fin du manuscrit",
 * appliquée ici à une tranche pour permettre ensuite de réserver de la
 * place aux notes (voir paginateWithBottomFootnotes). `elements` reste
 * l'intégralité du tableau : les index sont globaux, pas relatifs à la
 * tranche, pour que la comparaison avec l'élément précédent (page Front)
 * reste correcte d'une page à l'autre. */
function selectPageContent(
  elements: Element[],
  startIndex: number,
  contentMaxH: number,
  measureHost: HTMLElement
): { nodes: Element[]; heights: number[]; nextIndex: number } {
  const nodes: Element[] = [];
  const heights: number[] = [];
  let currentH = 0;
  let i = startIndex;
  for (; i < elements.length; i++) {
    const node = elements[i];
    const tag = node.tagName ? node.tagName.toLowerCase() : "";

    measureHost.appendChild(node);
    const nodeH = measuredHeight(node);
    measureHost.removeChild(node);

    const isHeading = ["h1", "h2", "h3", "h4"].includes(tag);
    const isTitle = tag === "h1" || tag === "h2";
    const isFrontPage = !!(node.classList && node.classList.contains("feuillets-frontpage"));
    const prevWasFrontPage = i > 0 && elements[i - 1].classList && elements[i - 1].classList.contains("feuillets-frontpage");
    const forceNewPage = isTitle || isFrontPage || prevWasFrontPage || (isHeading && currentH + nodeH + 50 > contentMaxH);

    if ((forceNewPage || currentH + nodeH > contentMaxH) && nodes.length > 0) break;

    nodes.push(node);
    heights.push(nodeH);
    currentH += nodeH;
  }
  return { nodes, heights, nextIndex: i };
}

/** Pagination avec notes de bas de page ancrées au bas de leur page
 * d'appel (placement "bas de page"). Contrairement au placement "fin du
 * manuscrit", les notes ne sont jamais insérées dans le flux des
 * paragraphes : chaque page se voit attribuer un contenu principal ET,
 * séparément, la liste des notes appelées par ce contenu — assemblées
 * plus bas dans une zone dédiée (`.pdf-page-footnotes`).
 *
 * Algorithme, par page :
 *  1. Sélectionne le contenu qui tiendrait sans les notes (selectPageContent).
 *  2. Détermine les notes nouvellement appelées par ce contenu (+ celles
 *     reportées depuis la page précédente si elles n'y tenaient pas).
 *  3. Si contenu + notes dépasse la hauteur disponible, repousse le
 *     dernier paragraphe vers la page suivante et recalcule (ses notes,
 *     si elles n'étaient référencées par aucun autre paragraphe déjà
 *     retenu, repartent avec lui).
 *  4. Si même une page sans aucun contenu ne suffit pas à faire tenir
 *     toutes les notes candidates (note très longue), affiche celles qui
 *     tiennent et reporte le reste à la page suivante — jamais perdues. */
function paginateWithBottomFootnotes(
  contentElements: Element[],
  footnotes: PdfFootnote[],
  contentMaxH: number,
  measureHost: HTMLElement
): PageBuild[] {
  const matcher = new FootnoteMatcher(footnotes);
  const footnoteNumberById = new Map(footnotes.map((f, i) => [f.id, i + 1]));
  const footnoteById = new Map(footnotes.map((f) => [f.id, f]));

  const entryCache = new Map<string, HTMLElement>();
  const getEntry = (id: string): HTMLElement => {
    let el = entryCache.get(id);
    if (!el) {
      el = buildFootnoteEntry(footnoteById.get(id)!, footnoteNumberById.get(id)!);
      entryCache.set(id, el);
    }
    return el;
  };
  const measureEntry = (id: string): number => {
    const el = getEntry(id);
    measureHost.appendChild(el);
    const h = measuredHeight(el);
    measureHost.removeChild(el);
    return h;
  };
  const blockHeight = (ids: string[]): number =>
    ids.length === 0 ? 0 : FOOTNOTE_ZONE_OVERHEAD_PX + ids.reduce((sum, id) => sum + measureEntry(id), 0);

  const placedIds = new Set<string>();
  let carry: string[] = [];
  const pages: PageBuild[] = [];
  let index = 0;

  while (index < contentElements.length || carry.length > 0) {
    const { nodes, heights, nextIndex } = selectPageContent(contentElements, index, contentMaxH, measureHost);

    // IDs nouvellement appelés par chaque paragraphe retenu (une note
    // n'est attribuée qu'au premier paragraphe de LA PAGE qui l'appelle).
    const claimed = new Set([...placedIds, ...carry]);
    const idsPerNode: string[][] = nodes.map((node) => {
      const refs = footnoteIdRefsIn(node, matcher).filter((id) => !claimed.has(id));
      refs.forEach((id) => claimed.add(id));
      return refs;
    });

    const workingNodes = nodes.slice();
    const workingHeights = heights.slice();
    const workingIdsPerNode = idsPerNode.slice();
    let contentH = workingHeights.reduce((a, b) => a + b, 0);

    const candidateIds = (): string[] => [...carry, ...workingIdsPerNode.flat()];

    // Repousse le dernier paragraphe vers la page suivante tant que le
    // contenu retenu + les notes qu'il appelle ne tient pas — jamais en
    // dessous d'un seul paragraphe (comme la pagination de contenu seul :
    // une page garde toujours au moins un élément), pour ne pas se
    // retrouver à évincer indéfiniment la même note avec son paragraphe.
    while (workingNodes.length > 1 && contentH + blockHeight(candidateIds()) > contentMaxH) {
      contentH -= workingHeights[workingHeights.length - 1];
      workingNodes.pop();
      workingHeights.pop();
      workingIdsPerNode.pop();
    }

    let finalIds = candidateIds();
    let nextCarry: string[] = [];
    if (contentH + blockHeight(finalIds) > contentMaxH) {
      // Le contenu retenu (au moins un paragraphe, ou aucun s'il s'agit
      // d'une page de pure continuation de notes) ne laisse pas assez de
      // place pour toutes les notes candidates : affiche celles qui
      // tiennent, reporte le reste à la page suivante — jamais perdu.
      const fitted: string[] = [];
      for (const id of finalIds) {
        const candidate = [...fitted, id];
        const wouldFit = contentH + blockHeight(candidate) <= contentMaxH;
        if (!wouldFit) {
          // Rien du tout ne tient sur une page sans aucun contenu (note
          // plus haute qu'une page entière) : force au moins une entrée
          // pour garantir une progression plutôt que de la reporter à
          // l'infini. Si du contenu est présent, on préfère au contraire
          // reporter la note en entier sur la page suivante, qui aura
          // plus de place libre.
          if (fitted.length === 0 && workingNodes.length === 0) fitted.push(id);
          break;
        }
        fitted.push(id);
      }
      nextCarry = finalIds.slice(fitted.length);
      finalIds = fitted;
    }

    for (const id of finalIds) placedIds.add(id);

    pages.push({ content: workingNodes, footnotes: finalIds.map((id) => getEntry(id)) });

    carry = nextCarry;
    index = nextIndex - (nodes.length - workingNodes.length);
  }

  // Note jamais appelée dans le texte (repli rare, ex. structure HTML
  // inattendue) : ajoutée à la dernière page plutôt que perdue.
  const orphans = footnotes.filter((f) => !placedIds.has(f.id));
  if (orphans.length > 0) {
    if (pages.length === 0) pages.push({ content: [], footnotes: [] });
    const last = pages[pages.length - 1];
    for (const f of orphans) {
      placedIds.add(f.id);
      last.footnotes.push(getEntry(f.id));
    }
  }

  return pages;
}

/** Pagine le contenu HTML en boîtes de pages réelles (.pdf-page) pour l'impression PDF et l'aperçu WYSIWYG.
 * Gère les en-têtes et pieds de page différenciés (paires/impaires), les sauts de page sur titres (H1/H2),
 * la position des numéros de page (droite, centré, gauche) et la couleur adoucie des en-têtes (#aaaaaa). */
export function paginateManuscript(
  containerEl: HTMLElement,
  footnotes: PdfFootnote[] | null | undefined,
  settings: FeuilletsSettings,
  tpl: ResolvedExportTemplate,
  title = "",
  author = ""
): PaginationResult {
  const pageSize: PdfPageSize = settings.pdfPageSize || "A4";
  const orientation: PdfOrientation = settings.pdfOrientation || tpl.pageOrientation || "portrait";
  const mTop = settings.pdfMarginTop ?? 2.5;
  const mBottom = settings.pdfMarginBottom ?? 2.5;
  const mLeft = settings.pdfMarginLeft ?? 2.5;
  const mRight = settings.pdfMarginRight ?? 2.5;

  const mirror = !!settings.pdfMirrorMargins;
  const diffHeaders = !!settings.pdfDiffHeaders;
  const hideFirst = settings.pdfHideFirstPageHeader ?? true;
  const pageNumPos: PdfPageNumberPosition = settings.pdfPageNumberPosition || "right"; // "right" | "center" | "left"

  // Dimensions de la page (A4 = 210x297mm)
  const isLandscape = orientation === "landscape";
  const pageWmm = pageSize === "A5" ? (isLandscape ? 210 : 148) : pageSize === "letter" ? (isLandscape ? 279 : 216) : (isLandscape ? 297 : 210);
  const pageHmm = pageSize === "A5" ? (isLandscape ? 148 : 210) : pageSize === "letter" ? (isLandscape ? 216 : 279) : (isLandscape ? 210 : 297);

  const mmToPx = 3.7795;
  const pageHpx = Math.round(pageHmm * mmToPx);
  const pageWpx = Math.round(pageWmm * mmToPx);

  const topPx = Math.round(mTop * 10 * mmToPx);
  const bottomPx = Math.round(mBottom * 10 * mmToPx);
  const contentMaxH = pageHpx - topPx - bottomPx;

  // Conteneur de mesure des éléments HTML — élément du document principal
  // Obsidian (ajouté à document.body ci-dessous).
  const measureHost = document.body.createDiv({ cls: "feuillets-pdf-measure-host" });
  measureHost.style.width = `${pageWpx - Math.round((mLeft + mRight) * 10 * mmToPx)}px`;
  measureHost.style.fontFamily = tpl.fontFamily;
  measureHost.style.fontSize = `${tpl.fontSizePt}pt`;
  measureHost.style.lineHeight = String(tpl.lineHeight);

  const contentElements = Array.from(containerEl.children)
    .map((el) => el.cloneNode(true))
    .filter(isPageElement);

  const footnotePlacement = settings.pdfFootnotePlacement === "bottom" ? "bottom" : "end";

  let rawPages: PageBuild[];

  if (footnotePlacement === "bottom" && footnotes && footnotes.length > 0) {
    // Placement "bas de page" : les notes ne rejoignent JAMAIS le flux des
    // paragraphes — chaque page reçoit son propre contenu et sa propre
    // liste de notes, assemblés séparément plus bas (voir
    // paginateWithBottomFootnotes et la zone .pdf-page-footnotes).
    rawPages = paginateWithBottomFootnotes(contentElements, footnotes, contentMaxH, measureHost);
  } else {
    // Placement "fin du manuscrit" (comportement historique, strictement
    // inchangé) : toutes les notes regroupées dans un unique bloc ajouté
    // en tant que dernier élément du flux, paginé comme n'importe quel
    // autre contenu.
    const elements = contentElements;
    if (footnotes && footnotes.length > 0) {
      // Détaché tant qu'il n'est pas poussé dans `elements` ci-dessous — élément
      // du document principal Obsidian (ses enfants sont déjà créés via createEl).
      const fnDiv = createDiv({ cls: "pdf-footnotes-section" });
      fnDiv.createEl("hr");
      const ol = fnDiv.createEl("ol");
      /* Le contenu d'une note est du HTML issu du rendu Markdown d'Obsidian
         (voir extractFootnotes dans export-render.js). Il est analysé dans un
         document inerte via DOMParser — qui n'exécute ni script ni gestionnaire
         d'événement, et ne touche pas au document courant — puis ses nœuds sont
         déplacés dans le <li>. Plus sûr, et plus lisible, qu'une affectation à
         innerHTML sur un élément vivant. */
      for (const f of footnotes) {
        const li = ol.createEl("li");
        li.id = f.id;
        const parsed = new DOMParser().parseFromString(f.html, "text/html");
        while (parsed.body.firstChild) li.appendChild(parsed.body.firstChild);
      }
      elements.push(fnDiv);
    }

    const rawContentPages: Element[][] = [];
    let currentPageNodes: Element[] = [];
    let currentH = 0;

    for (let i = 0; i < elements.length; i++) {
      const node = elements[i];
      const tag = node.tagName ? node.tagName.toLowerCase() : "";

      measureHost.appendChild(node);
      const nodeH = measuredHeight(node);
      measureHost.removeChild(node);

      const isHeading = ["h1", "h2", "h3", "h4"].includes(tag);
      // Saut de page systématique pour H1 (partie) et H2 (chapitre)
      const isTitle = tag === "h1" || tag === "h2";
      // Page Front (titre/dédicace/épigraphe, voir export-render.js) : sur sa
      // propre page, jamais partagée avec ce qui précède OU ce qui suit.
      const isFrontPage = !!(node.classList && node.classList.contains("feuillets-frontpage"));
      const prevWasFrontPage = i > 0 && elements[i - 1].classList && elements[i - 1].classList.contains("feuillets-frontpage");
      const forceNewPage = isTitle || isFrontPage || prevWasFrontPage || (isHeading && currentH + nodeH + 50 > contentMaxH);

      if ((forceNewPage || currentH + nodeH > contentMaxH) && currentPageNodes.length > 0) {
        rawContentPages.push(currentPageNodes);
        currentPageNodes = [];
        currentH = 0;
      }

      currentPageNodes.push(node);
      currentH += nodeH;
    }

    if (currentPageNodes.length > 0) {
      rawContentPages.push(currentPageNodes);
    }

    rawPages = rawContentPages.map((nodes) => ({ content: nodes, footnotes: [] }));
  }

  if (document.body.contains(measureHost)) {
    document.body.removeChild(measureHost);
  }

  const totalPages = Math.max(1, rawPages.length);

  // Assemblage final des pages avec en-têtes/pieds et numérotation
  const pagesHtml = rawPages.map((page, idx) => {
    const nodes = page.content;
    const pageNum = idx + 1;
    const isEven = pageNum % 2 === 0;
    const isFirst = pageNum === 1;

    const currentLeftM = mirror ? (isEven ? mRight : mLeft) : mLeft;
    const currentRightM = mirror ? (isEven ? mLeft : mRight) : mRight;

    let hLeftText = (settings.pdfHeaderLeft ?? "{title}").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
    let hRightText = (settings.pdfHeaderRight ?? "{author}").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);

    const numStr = (settings.pdfFooterRight ?? "Page {page} sur {pages}")
      .replace(/\{title\}/gi, title)
      .replace(/\{author\}/gi, author)
      .replace(/\{page\}/gi, String(pageNum))
      .replace(/\{pages\}/gi, String(totalPages));

    let fLeftText = (settings.pdfFooterLeft ?? "").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
    let fCenterText = "";
    let fRightText = "";

    if (pageNumPos === "center") {
      fCenterText = numStr;
    } else if (pageNumPos === "left") {
      fLeftText = numStr;
    } else {
      fRightText = numStr;
    }

    if (diffHeaders && isEven) {
      // Inversion pour les pages paires (gauches)
      [hLeftText, hRightText] = [hRightText, hLeftText];
      if (pageNumPos === "right") {
        fLeftText = numStr;
        fRightText = "";
      } else if (pageNumPos === "left") {
        fRightText = numStr;
        fLeftText = "";
      }
    }

    const showHeaderFooter = !(isFirst && hideFirst);
    const nodesHtml = nodes.map((n) => n.outerHTML).join("\n");
    const footnotesHtml = page.footnotes.map((n) => n.outerHTML).join("\n");

    return `
      <div class="pdf-page ${isEven ? "page-even" : "page-odd"}" style="
        width: ${pageWmm}mm;
        height: ${pageHmm}mm;
        padding-top: ${mTop}cm;
        padding-bottom: ${mBottom}cm;
        padding-left: ${currentLeftM}cm;
        padding-right: ${currentRightM}cm;
        box-sizing: border-box;
        page-break-after: always;
        break-after: page;
        position: relative;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        color: #111111;
      ">
        ${
          showHeaderFooter
            ? `
          <div class="pdf-page-header" style="
            position: absolute;
            top: ${mTop * 0.3}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: flex;
            justify-content: space-between;
            font-size: 8pt;
            color: #aaaaaa;
            border-bottom: 0.5pt solid #f0f0f0;
            padding-bottom: 3px;
            font-family: ${tpl.fontFamily};
          ">
            <span>${hLeftText}</span>
            <span>${hRightText}</span>
          </div>
        `
            : ""
        }
        <div class="pdf-page-content" style="flex: 1 1 auto; overflow: hidden;">
          ${nodesHtml}
        </div>
        ${footnotesHtml ? `<div class="pdf-page-footnotes">${footnotesHtml}</div>` : ""}
        ${
          showHeaderFooter
            ? `
          <div class="pdf-page-footer" style="
            position: absolute;
            bottom: ${mBottom * 0.3}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            font-size: 8pt;
            color: #aaaaaa;
            border-top: 0.5pt solid #f0f0f0;
            padding-top: 3px;
            font-family: ${tpl.fontFamily};
          ">
            <div style="text-align: left;">${fLeftText}</div>
            <div style="text-align: center;">${fCenterText}</div>
            <div style="text-align: right;">${fRightText}</div>
          </div>
        `
            : ""
        }
      </div>
    `;
  });

  return { pagesHtml: pagesHtml.join("\n"), totalPages };
}

/** PDF via la boîte de dialogue d'impression du système */
export async function exportPdf(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments }: PdfExportInput): Promise<void> {
  if (Platform.isMobile) {
    new Notice(
      "L'export PDF n'est disponible que sur desktop pour l'instant — utilise EPUB ou Word (.docx) sur mobile."
    );
    return;
  }

  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const { containerEl, footnotes } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath);

  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  if (!hasAuthoredTitlePage) {
    // Titre et auteur au sommet du document — éléments du document principal
    // Obsidian, créés détachés puis repositionnés (prepend/after) dans
    // containerEl plutôt qu'ajoutés en fin d'arbre par createEl.
    const titleEl = createEl("h1", { text: title });
    containerEl.prepend(titleEl);
    if (author) {
      const authorEl = createEl("p", { cls: "pdf-author-title", text: author });
      titleEl.after(authorEl);
    }
  }

  const { pagesHtml } = paginateManuscript(containerEl, footnotes, settings, tpl, title, author);

  const css = templateToCss(tpl) + FRONT_PAGE_CSS + "\n" + titleRoleCss(tpl) + "\n" + FOOTNOTE_BOTTOM_CSS;
  const pageSize: PdfPageSize = settings.pdfPageSize || "A4";
  const orientation: PdfOrientation = settings.pdfOrientation || tpl.pageOrientation || "portrait";

  // Iframe hôte de l'impression : élément du document principal Obsidian.
  const iframe = document.body.createEl("iframe", { cls: "feuillets-pdf-print-frame" });

  if (!isPrintableIframe(iframe)) {
    throw new Error("Impossible de préparer la fenêtre d'impression PDF.");
  }

  /* Construction explicite du document d'impression, sans document.write
     (obsolète, ré-analyse tout le document au fil de l'eau). iframe.contentDocument
     est un DOM détaché du document Obsidian — un realm JS séparé sans les
     prototypes patchés par Obsidian (pas de createEl/createDiv ici), d'où
     l'API DOM native. open()/close() sont conservés à l'identique de l'ancien
     code (close() aide à déclencher l'évènement "load" de l'iframe, attendu
     plus bas).

     doc.open() vide le document : il ne recrée PAS de squelette <html>/
     <head>/<body> (c'était le rôle du parseur HTML déclenché par
     document.write, qu'on ne fait plus). doc.documentElement/doc.head/
     doc.body valent donc réellement null juste après — d'où l'ancien crash
     (« Cannot read properties of null (reading 'setAttribute') »). On
     construit donc html/head/body nous-mêmes, sur des références locales
     jamais relues dans le document, puis on insère l'arbre complet d'un
     coup via replaceChildren. */
  const doc = iframe.contentDocument;
  doc.open();

  const htmlEl = doc.createElement("html");
  htmlEl.setAttribute("lang", settings.epubLanguage || "fr");
  const headEl = doc.createElement("head");
  const bodyEl = doc.createElement("body");
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  const metaEl = doc.createElement("meta");
  metaEl.setAttribute("charset", "utf-8");
  headEl.appendChild(metaEl);

  const titleTag = doc.createElement("title");
  titleTag.textContent = title;
  headEl.appendChild(titleTag);

  const styleEl = doc.createElement("style");
  styleEl.textContent = `${css}
@page {
  size: ${pageSize}${orientation === "landscape" ? " landscape" : ""};
  margin: 0 !important;
}
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  .pdf-page {
    page-break-after: always !important;
    break-after: page !important;
  }
}`;
  headEl.appendChild(styleEl);

  /* pagesHtml est du HTML déjà produit par paginateManuscript à partir du
     rendu Markdown natif d'Obsidian (MarkdownRenderer) — jamais de saisie
     brute non passée par ce pipeline. Même méthode que pour les notes de
     bas de page plus haut (voir DOMParser dans paginateManuscript) : analysé
     dans un document inerte (n'exécute ni script ni gestionnaire
     d'événement), puis ses nœuds sont déplacés dans le corps de la page
     d'impression — pas d'affectation à innerHTML sur un document vivant. */
  const parsedPages = new DOMParser().parseFromString(pagesHtml, "text/html");
  while (parsedPages.body.firstChild) {
    bodyEl.appendChild(parsedPages.body.firstChild);
  }

  doc.replaceChildren(htmlEl);
  doc.close();

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    window.setTimeout(resolve, 300);
  });

  new Notice("Choisis « Enregistrer au format PDF » dans la boîte d'impression.", 6000);
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  window.setTimeout(cleanup, 10000);
}
