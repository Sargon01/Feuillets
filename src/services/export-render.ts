import { Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { applyPedagogicalSemantics } from "../utils/pedagogical-roles.js";
import { applyFeuilletsDirectiveMarkers, prepareFeuilletsDirectives } from "../utils/feuillets-directives.js";

type RenderedFootnote = {
  id: string;
  html: string;
  text: string;
};

type RenderedImage = {
  bytes: Uint8Array;
  ext: string;
  width: number;
  height: number;
  caption: string;
};

export type DocumentMediaImage = Pick<RenderedImage, "width" | "height">;

type RenderedManuscript = {
  containerEl: HTMLDivElement;
  footnotes: RenderedFootnote[];
  images: Map<HTMLImageElement, RenderedImage>;
  /** URL/chemin de chaque image référencée dans le texte mais introuvable ou
   *  illisible dans le coffre — jamais silencieux (voir inlineImages). */
  missingResources: string[];
};

type ExportRenderSegment = {
  text: string;
  frontType?: string | null;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/svg+xml" | "image/webp";

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, ImageMime>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** Rend un markdown déjà compilé (sortie de compile()) en HTML propre via
 * le moteur natif d'Obsidian — pas de parseur maison : MarkdownRenderer
 * gère déjà correctement wikiliens, embeds, callouts et notes de bas de
 * page. Le composant jetable ne sert qu'à satisfaire l'API (cycle de vie
 * des enfants rendus) : chargé puis déchargé immédiatement après le
 * rendu, rien ne s'accumule entre deux exports successifs.
 *
 * Retourne { containerEl, footnotes, images } — le DOM nettoyé (prêt à
 * être sérialisé en HTML pour l'EPUB, ou parcouru nœud par nœud pour le
 * DOCX), la liste des notes de bas de page extraites séparément (chaque
 * format cible les traduit dans son propre mécanisme de notes), et une
 * Map<HTMLImageElement, {bytes,ext,width,height,caption}> donnant accès
 * aux octets bruts de chaque image déjà inlinée dans le DOM en data: URI
 * — l'EPUB/PDF utilisent directement le data: URI (HTML, où l'image est
 * aussi enveloppée dans un <figure>/<figcaption> si elle a une légende),
 * le DOCX a besoin des octets bruts pour construire un vrai ImageRun (la
 * légende y est ajoutée comme un paragraphe séparé — voir export-docx.js). */
export async function renderManuscriptHtml(app: App, markdown: string, sourcePath: string): Promise<RenderedManuscript> {
  /* Créé via l'helper Obsidian createDiv() : l'élément appartient au
     document principal Obsidian mais reste détaché du début à la fin de
     tout le pipeline export (EPUB/DOCX/PDF) — jamais affiché, seulement
     rendu par MarkdownRenderer puis sérialisé/parcouru nœud par nœud. */
  const container = createDiv();
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, prepareFeuilletsDirectives(markdown), container, sourcePath, component);
    applyPedagogicalSemantics(container);
    applyFeuilletsDirectiveMarkers(container);
  } finally {
    component.unload();
  }

  const { images, missingResources } = await inlineImages(app, container, sourcePath);
  const footnotes = extractFootnotes(container);
  stripObsidianCruft(container);

  /* Signalé ici, au point unique partagé par les 4 exporteurs natifs
     (EPUB/DOCX/ODT/PDF appellent tous renderManuscriptHtml*) — plutôt que
     de faire remonter `missingResources` à travers chaque signature de
     retour spécifique au format (Uint8Array, Buffer, void…). Une ressource
     manquante ne doit jamais rester visible seulement dans la console. */
  if (missingResources.length > 0) {
    const list = missingResources.slice(0, 5).join(", ");
    const more = missingResources.length > 5 ? ` (+${missingResources.length - 5})` : "";
    new Notice(`Export : ${missingResources.length} image(s) introuvable(s) dans le coffre : ${list}${more}`);
  }

  return { containerEl: container, footnotes, images, missingResources };
}

const DOCUMENT_MEDIA_BLOCK = "feuillets-doc-media-block";
const DOCUMENT_MEDIA_PORTRAIT = "feuillets-doc-media-portrait";
const DOCUMENT_MEDIA_PORTRAIT_FLOW = "feuillets-doc-media-portrait-flow";
const DOCUMENT_MEDIA_PORTRAIT_FLOW_CLEAR = "feuillets-doc-media-portrait-flow-clear";
const DOCUMENT_MEDIA_LANDSCAPE = "feuillets-doc-media-landscape";
const DOCUMENT_MEDIA_LANDSCAPE_CONTEXT = "feuillets-doc-media-landscape-context";

function directBlockForImage(container: HTMLElement, image: HTMLImageElement): HTMLElement | null {
  let block = image.parentElement;
  while (block && block !== container) {
    const tag = block.tagName;
    if (tag === "OL" || tag === "UL" || tag === "LI" || tag === "BLOCKQUOTE" || tag === "TABLE" || /^H[1-6]$/.test(tag)) return null;
    if ((tag === "P" || tag === "FIGURE") && block.parentElement === container) {
      return block.querySelectorAll("img").length === 1 ? block : null;
    }
    block = block.parentElement;
  }
  return null;
}

function isSimpleTextBlock(block: Element): boolean {
  return block.tagName === "P" || block.tagName === "OL" || block.tagName === "UL" || block.tagName === "BLOCKQUOTE";
}

function isPortraitLike(dimensions: DocumentMediaImage, next: Element | null): boolean {
  if (dimensions.height > dimensions.width) return true;
  const ratio = dimensions.width / dimensions.height;
  return ratio >= 0.9 && ratio <= 1.1 && !!next && isSimpleTextBlock(next) && !next.querySelector("img");
}

function listStart(list: Element): number {
  const value = Number.parseInt(list.getAttribute("start") || "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function portraitFlowQuoteAfter(media: Element): Element | null {
  const first = media.nextElementSibling;
  if (first?.tagName === "BLOCKQUOTE") return first;
  return first?.tagName === "P" && first.nextElementSibling?.tagName === "BLOCKQUOTE"
    ? first.nextElementSibling
    : null;
}

function composeLandscapeContext(wrapper: HTMLElement, figure: HTMLElement): void {
  const description = wrapper.nextElementSibling;
  const list = description?.nextElementSibling;
  if (!description || description.tagName !== "P" || !list || (list.tagName !== "OL" && list.tagName !== "UL") || !list.children[0]) return;

  const content = createDiv({ cls: "feuillets-doc-media-content" });
  const firstItem = list.children[0];
  const miniList = list.tagName === "OL" ? createEl("ol") : createEl("ul");
  if (list.tagName === "OL") miniList.setAttribute("start", String(listStart(list)));
  miniList.appendChild(firstItem);
  description.remove();
  content.appendChild(description);
  content.appendChild(miniList);
  if (list.tagName === "OL") list.setAttribute("start", String(listStart(list) + 1));
  if (!list.children.length) list.remove();

  figure.remove();
  wrapper.className = `${wrapper.className} ${DOCUMENT_MEDIA_LANDSCAPE_CONTEXT}`;
  wrapper.appendChild(content);
  wrapper.appendChild(figure);
}

function isPedagogicalRoleBlock(node: Element | null): node is HTMLElement {
  return !!node && node.classList.contains("feuillets-pedagogical-role");
}

/* ===== Surcharge locale `%% image: … %%` (LOT 3A) =====
 * applyFeuilletsDirectiveMarkers (feuillets-directives.ts) pose ces classes
 * directement sur l'<img> pendant le rendu — un emplacement qui survit à
 * stripObsidianCruft (lequel ne retire que les attributs data-*, jamais les
 * classes). composeDocumentMedia les retrouve ici, avant toute décision
 * portrait/paysage automatique, et les transfère sur le wrapper média final. */
const IMAGE_PLACEMENT_CLASSES = new Set([
  "feuillets-image-placement-left",
  "feuillets-image-placement-center",
  "feuillets-image-placement-right",
  "feuillets-image-placement-full",
]);
const IMAGE_WIDTH_CLASS_RE = /^feuillets-image-width-(?:25|33|40|50|60|67|75|100)$/;

/** Retire de `image` puis renvoie les classes de surcharge posées par la
 * directive `image:` — jamais générées ailleurs, donc un simple filtre sur
 * les classes déjà présentes suffit à retrouver l'éventuelle surcharge, sans
 * dépendance à un attribut data-* qui n'aurait pas survécu au strip. */
function takeImageOverrideClasses(image: HTMLImageElement): string[] {
  const classes = (image.className || "").split(/\s+/).filter((cls) => IMAGE_PLACEMENT_CLASSES.has(cls) || IMAGE_WIDTH_CLASS_RE.test(cls));
  if (classes.length) image.classList.remove(...classes);
  return classes;
}

function composeDocumentMediaRoles(container: HTMLElement): void {
  const children = () => Array.from(container.children);
  for (const media of children()) {
    if (!media.classList.contains(DOCUMENT_MEDIA_BLOCK) || media.classList.contains("feuillets-document-media-role-pair")) continue;
    const marker = media.nextElementSibling;
    const hasDirective = media.classList.contains("feuillets-directive-dessous") || !!media.querySelector(".feuillets-directive-dessous");
    const role = marker;
    if (!isPedagogicalRoleBlock(role)) continue;

    const pair = createDiv({ cls: "feuillets-document-media-role-pair" });
    pair.classList.add(hasDirective ? "feuillets-document-media-role-pair-stacked" : "feuillets-document-media-role-pair-side");
    container.insertBefore(pair, media);
    pair.appendChild(media);
    media.classList.remove("feuillets-directive-dessous");
    media.querySelectorAll(".feuillets-directive-dessous").forEach((el) => el.classList.remove("feuillets-directive-dessous"));
    pair.appendChild(role);
  }
  container.querySelectorAll(".feuillets-directive, .feuillets-directive-dessous").forEach((marker) => marker.remove());
}

/** Transforme le DOM déjà rendu en blocs média stables. Les dimensions viennent
 * exclusivement de l'image effectivement résolue et inlinée par Feuillets. */
export function composeDocumentMedia(container: HTMLElement, images: Map<HTMLImageElement, DocumentMediaImage>): void {
  for (const [image, dimensions] of images) {
    const block = directBlockForImage(container, image);
    if (!block || block.className.includes(DOCUMENT_MEDIA_BLOCK)) continue;

    /* Une surcharge explicite désactive UNIQUEMENT la décision automatique
       portrait/paysage pour CETTE image (§18 du lot) : wrapper + figure
       simples, alignement/largeur par classes, jamais de contenu latéral ni
       de flux flottant. Le pairing média+rôle (composeDocumentMediaRoles,
       plus bas) reste appliqué ensuite exactement comme pour le chemin
       automatique — la directive ne décide que de l'alignement/largeur. */
    const overrideClasses = takeImageOverrideClasses(image);
    if (overrideClasses.length) {
      const overrideWrapper = createDiv({ cls: `${DOCUMENT_MEDIA_BLOCK} ${overrideClasses.join(" ")}` });
      const overrideFigure = createDiv({ cls: "feuillets-doc-media-figure" });
      container.insertBefore(overrideWrapper, block);
      overrideFigure.appendChild(block);
      overrideWrapper.appendChild(overrideFigure);
      continue;
    }

    const portrait = isPortraitLike(dimensions, block.nextElementSibling);
    const wrapper = createDiv({ cls: `${DOCUMENT_MEDIA_BLOCK} ${portrait ? DOCUMENT_MEDIA_PORTRAIT : DOCUMENT_MEDIA_LANDSCAPE}` });
    const figure = createDiv({ cls: "feuillets-doc-media-figure" });
    container.insertBefore(wrapper, block);
    figure.appendChild(block);
    wrapper.appendChild(figure);

    if (!portrait) {
      composeLandscapeContext(wrapper, figure);
      continue;
    }
    const quote = portraitFlowQuoteAfter(wrapper);
    if (quote) {
      wrapper.className = `${wrapper.className} ${DOCUMENT_MEDIA_PORTRAIT_FLOW}`;
      const following = quote.nextElementSibling;
      if (following) following.className = `${following.className} ${DOCUMENT_MEDIA_PORTRAIT_FLOW_CLEAR}`.trim();
      continue;
    }
    const content = createDiv({ cls: "feuillets-doc-media-content" });
    let sibling = wrapper.nextElementSibling;
    while (sibling && isSimpleTextBlock(sibling)) {
      const next = sibling.nextElementSibling;
      content.appendChild(sibling);
      sibling = next;
    }
    if (content.children.length > 0) wrapper.appendChild(content);
  }
  composeDocumentMediaRoles(container);
}

/** CSS pour les pages Front (titre/dédicace/épigraphe) une fois isolées par
 * renderManuscriptHtmlWithFrontPages — réutilisée telle quelle par l'EPUB et
 * le PDF (tous deux du CSS de navigateur réel) ; l'ODT n'a pas de CSS en
 * cascade et reçoit son propre traitement dédié dans export-odt.js. */
export const FRONT_PAGE_CSS = `
.feuillets-frontpage {
  page-break-before: always;
  break-before: page;
  text-align: center;
  line-height: 1;
}
.feuillets-frontpage p {
  text-indent: 0 !important;
}
`;

const FRONT_START_RE = /^FEUILLETS-FRONT:(titre|dedicace|epigraphe)$/;
const FRONT_END = "FEUILLETS-FRONT-END";

/* Page de titre à rôles : mécanisme pur (parsing, marqueur) dans
   utils/title-roles.js ; ici seule la partie DOM (retrait des marqueurs,
   étiquetage data-fp-role). */
const TITLE_ROLE_MARKER_RE = new RegExp(`^${TITLE_ROLE_MARKER}(.+)$`);

/** Après isolement des pages Front dans le DOM (wrapFrontPagesInDom), retire
 * les paragraphes-marqueurs `FEUILLETS-FPROLE:rôle` et pose `data-fp-role` sur
 * le paragraphe de contenu qui suit — c'est cet attribut que l'export PDF/
 * HTML cible ensuite en CSS pour appliquer le style du rôle. */
function tagTitleRolesInDom(containerEl: HTMLElement): void {
  containerEl.querySelectorAll(".feuillets-frontpage").forEach((fp) => {
    const kids = Array.from(fp.children);
    for (let i = 0; i < kids.length; i++) {
      const m = (kids[i].textContent || "").trim().match(TITLE_ROLE_MARKER_RE);
      if (!m) continue;
      const role = m[1].trim().toLowerCase();
      const content = kids[i + 1];
      if (content) content.setAttribute("data-fp-role", role);
      kids[i].remove();
    }
  });
}

/** Une page Front (titre/dédicace/épigraphe) n'a pas de mise en page
 * figée (voir FRONT_PAGE_TYPES) : l'autrice compose sa page à la main et son
 * espacement est WYSIWYG — CHAQUE ligne vide qu'elle tape devient une ligne
 * blanche réelle à l'export (une ligne vide = un espace, trois lignes vides =
 * trois espaces). Problème : Markdown fusionne toute suite de lignes vides en
 * un seul saut de paragraphe, et ce saut, entre deux paragraphes collés en
 * interligne simple (voir FRONT_PAGE_LINE_SPACING dans export-docx.js), ne
 * produit AUCUN espace visible — d'où des éléments qui se touchent. On
 * matérialise donc chaque ligne vide par son propre paragraphe rempli d'une
 * espace insécable, sans exception : pas de "première ligne vide consommée
 * comme séparateur", puisque ce séparateur-là ne se voit pas. */
export function preserveBlankLinesForFrontPage(text: string): string {
  const BLANK_LINE_MARKER = "\u00A0";
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() !== "") {
      current.push(lines[i]);
      i++;
      continue;
    }
    if (current.length) {
      paragraphs.push(current.join("\n"));
      current = [];
    }
    while (i < lines.length && lines[i].trim() === "") {
      paragraphs.push(BLANK_LINE_MARKER);
      i++;
    }
  }
  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs.join("\n\n");
}

/** Variante de renderManuscriptHtml qui isole en plus les pages Front
 * spéciales (titre/dédicace/épigraphe, voir folder-structure.js) dans leur
 * propre <div class="feuillets-frontpage feuillets-frontpage-{type}">,
 * pour que l'EPUB/ODT/PDF puissent leur appliquer une mise en page dédiée
 * (saut de page, centrage) — même principe que le marqueur textuel utilisé
 * par l'export .docx natif (voir export-docx.js), mais restructuré en DOM
 * plutôt qu'en bookmarks Word, puisque ces trois formats travaillent
 * directement sur le HTML rendu. Sans `segments` (aucun
 * feuillet Front dans ce projet), se comporte exactement comme
 * renderManuscriptHtml. */
export async function renderManuscriptHtmlWithFrontPages(
  app: App,
  markdown: string,
  segments: ExportRenderSegment[] | null | undefined,
  sourcePath: string
): Promise<RenderedManuscript> {
  if (!segments || !segments.length || !segments.some((s) => s.frontType)) {
    return renderManuscriptHtml(app, markdown, sourcePath);
  }
  const markedMarkdown = segments
    .map((seg) =>
      seg.frontType ? `FEUILLETS-FRONT:${seg.frontType}\n\n${seg.text}\n\n${FRONT_END}` : seg.text
    )
    .join("\n\n");
  const result = await renderManuscriptHtml(app, markedMarkdown, sourcePath);
  wrapFrontPagesInDom(result.containerEl);
  tagTitleRolesInDom(result.containerEl);
  return result;
}

function wrapFrontPagesInDom(containerEl: HTMLElement): void {
  const children = Array.from(containerEl.children);
  let i = 0;
  while (i < children.length) {
    const el = children[i];
    const text = (el.textContent || "").trim();
    const m = text.match(FRONT_START_RE);
    if (!m) {
      i++;
      continue;
    }
    // Créé via createDiv() : containerEl (voir renderManuscriptHtml
    // ci-dessus) reste détaché du document Obsidian, wrapper en fait partie.
    const wrapper = createDiv();
    wrapper.className = `feuillets-frontpage feuillets-frontpage-${m[1]}`;
    el.remove();
    i++;
    while (i < children.length) {
      const inner = children[i];
      i++;
      if ((inner.textContent || "").trim() === FRONT_END) {
        inner.remove();
        break;
      }
      wrapper.appendChild(inner);
    }
    containerEl.insertBefore(wrapper, children[i] || null);
  }
}

/** Notes de bas de page : Obsidian rend les références inline en
 * `sup.footnote-ref` et regroupe le texte des notes dans une
 * `section.footnotes` en fin de document. Best-effort — si la structure
 * diffère (version d'Obsidian différente), on renvoie une liste vide
 * plutôt que d'échouer ; les notes restent alors simplement des liens
 * internes non traduits dans l'export, dégradation acceptable plutôt
 * qu'un export qui plante. */
function isHtmlElement(node: Node): node is HTMLElement & { textContent: string } {
  return "innerHTML" in node && "querySelectorAll" in node && typeof node.textContent === "string";
}

function extractFootnotes(container: HTMLElement): RenderedFootnote[] {
  const footnotes: RenderedFootnote[] = [];
  try {
    const section = container.querySelector("section.footnotes, .footnotes");
    if (!section) return footnotes;
    const items = section.querySelectorAll("li[id]");
    items.forEach((li) => {
      const id = li.getAttribute("id") || "";
      const clone = li.cloneNode(true);
      if (!isHtmlElement(clone)) return;

      /* `html` GARDE le lien de retour (`a.footnote-backref`) : c'est le
         "aller-retour" attendu en HTML/EPUB (voir footnotesXhtml,
         export-epub.js). `text`, lui, en est délibérément privé — DOCX
         construit une vraie note Word à partir de ce texte brut, où une
         flèche "↩" ne représenterait plus un lien cliquable, juste un
         caractère parasite. D'où deux clones distincts plutôt qu'un retrait
         partagé qui priverait HTML/EPUB de leur lien de retour. */
      const textOnlyClone = clone.cloneNode(true);
      if (isHtmlElement(textOnlyClone)) {
        textOnlyClone.querySelectorAll("a.footnote-backref, .footnote-backref").forEach((a) => a.remove());
      }

      let html = clone.innerHTML.trim();
      let text = (isHtmlElement(textOnlyClone) ? textOnlyClone.textContent : clone.textContent).trim();

      /* Le caractère de la flèche "↩" (U+21A9) porte ses propres sélecteurs
         de variante de présentation textuelle/emoji U+FE0E/U+FE0F — jamais
         de plage plus large : une classe de caractères mal formée ici a déjà
         fait disparaître des chiffres et de la ponctuation ordinaires du
         contenu d'une note (ex. "note 1" -> "note"), un bug distinct de la
         présence du lien lui-même. */
      text = text
        // eslint-disable-next-line no-misleading-character-class -- voulu : on cible ↩ avec ses variantes de presentation U+FE0E/U+FE0F
        .replace(/[\u21A9\uFE0E\uFE0F]/g, "")
        .replace(/[\s/\\]+$/, "")
        .trim();

      html = html
        .replace(/<a[^>]*class=["']internal-link["'][^>]*>.*?<\/a>/gi, "")
        // Débris (slash/espace/&nbsp;) laissé juste avant une fermeture de
        // paragraphe — PAS ancré en fin de chaîne : le lien de retour, lui,
        // reste après `</p>` désormais (voir plus haut), donc "la fin de la
        // note" n'est plus "la fin de la chaîne html".
        .replace(/(?:&nbsp;|\s)*[/\\]+\s*(<\/p>)/gi, "$1")
        .trim();

      footnotes.push({ id, html, text });
    });
    section.remove();
  } catch (e) {
    console.error("Feuillets export: extraction des notes de bas de page échouée", e);
  }
  return footnotes;
}

/** Une légende réelle (texte alternatif `![légende](fichier.png)`) se
 * distingue du texte alternatif par défaut qu'Obsidian met sur un embed
 * `![[fichier.png]]` sans alias (le nom du fichier lui-même) ou d'un
 * indice de taille façon `![[fichier.png|300]]` (juste un nombre) — ni
 * l'un ni l'autre n'est une vraie légende à afficher. */
function realCaption(alt: string | null, file: TFile): string {
  const a = (alt || "").trim();
  if (!a) return "";
  const lower = a.toLowerCase();
  if (lower === file.basename.toLowerCase() || lower === file.name.toLowerCase()) return "";
  if (/^\d+(x\d+)?$/.test(a)) return "";
  return a;
}

/** Garde centralisée : une source d'image DISTANTE (http/https) n'est
 * JAMAIS résolue via les méthodes de fichiers locaux d'Obsidian
 * (metadataCache.getFirstLinkpathDest, vault.getFiles…) et ne doit jamais
 * compter parmi les images « introuvables dans le coffre » — elle n'a
 * simplement rien à y faire. Un seul point de vérité pour les deux endroits
 * qui examinent une source d'image (le src de l'<img> et celui de son
 * wrapper .internal-embed, voir resolveImageFile ci-dessous) : un embed
 * externe `![[https://…]]` peut porter l'URL d'origine sur le wrapper sans
 * que l'<img> rendu la reprenne à l'identique. trim() absorbe un espace
 * parasite éventuel (copier-coller), `i` la casse du schéma. */
function isRemoteImageSource(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/** Résout l'image réellement visée par un `<img>` rendu par Obsidian.
 * Méthode fiable en priorité : Obsidian pose le chemin ORIGINAL du lien
 * (tel qu'écrit dans le markdown — donc correct même dans un sous-
 * dossier, ambigu ou non) sur l'élément `.internal-embed` qui enveloppe
 * l'image ; on le passe à l'API officielle de résolution de liens
 * d'Obsidian (metadataCache.getFirstLinkpathDest), qui applique les mêmes
 * règles qu'Obsidian lui-même. En repli seulement (structure DOM
 * inattendue) : reconstitution approximative du chemin depuis l'URL
 * app:// rendue, en dernier recours un simple appariement par nom de
 * fichier — moins fiable en cas d'homonymes dans des dossiers différents,
 * mais mieux que rien. */
function resolveImageFile(app: App, img: HTMLImageElement, src: string, sourcePath?: string): TFile | null {
  const embedEl = img.closest(".internal-embed");
  const linkpath = embedEl?.getAttribute("src") || "";
  if (linkpath && !isRemoteImageSource(linkpath)) {
    const file = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(linkpath), sourcePath || "");
    if (file) return file;
  }

  const rawSrc = img.getAttribute("src") || "";
  if (rawSrc && !isRemoteImageSource(rawSrc) && !rawSrc.startsWith("data:") && !rawSrc.startsWith("app://")) {
    const decoded = decodeURIComponent(rawSrc);
    const file = app.metadataCache.getFirstLinkpathDest(decoded, sourcePath || "");
    if (file) return file;
    if (app.vault.getAbstractFileByPath) {
      const direct = app.vault.getAbstractFileByPath(decoded);
      if (direct instanceof TFile) return direct;
    }
  }

  const path = decodeURIComponent(src.replace(/^app:\/\/[^/]+\//, "").split("?")[0]).replace(/^\/+/, "");
  if (path) {
    if (app.vault.getAbstractFileByPath) {
      const directFile = app.vault.getAbstractFileByPath(path);
      if (directFile instanceof TFile) return directFile;
    }

    const fileFromPath = app.metadataCache.getFirstLinkpathDest(path, sourcePath || "");
    if (fileFromPath) return fileFromPath;
  }

  return null;
}

/** Images internes au coffre (embeds `![[fichier.png]]` ou `![alt](fichier.png)`)
 * : Obsidian les rend en `<img src="app://…">`, une URL qui n'a de sens
 * qu'à l'intérieur de l'app — inlinée en data: URI pour que l'export
 * survive une fois sorti du coffre. Les images DISTANTES (http/https, voir
 * isRemoteImageSource) ou déjà en data: sont laissées telles quelles —
 * jamais résolues via les chemins du coffre, jamais comptées parmi les
 * ressources introuvables. Best-effort : une image locale non résolue reste
 * avec son URL d'origine plutôt que de faire échouer tout l'export. Retourne
 * une Map<img, {bytes,ext,width,height,caption}> — le DOCX en a besoin pour
 * construire un vrai ImageRun + un paragraphe de légende (voir
 * export-docx.js) ; l'EPUB/PDF reçoivent directement un <figure>/<figcaption>
 * dans le DOM. */
async function inlineImages(
  app: App,
  container: HTMLElement,
  sourcePath?: string
): Promise<{ images: Map<HTMLImageElement, RenderedImage>; missingResources: string[] }> {
  const images = new Map<HTMLImageElement, RenderedImage>();
  // Set plutôt que tableau : la même image (locale manquante ou distante mal
  // formée) peut apparaître dans plusieurs scènes/segments du manuscrit —
  // un seul avertissement par source, jamais un doublon par occurrence.
  const missingResources = new Set<string>();
  const imgs = Array.from(container.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) continue;
    // Une image distante (http/https) n'est JAMAIS résolue via les chemins
    // du coffre : ni comptée parmi les « introuvables », ni passée aux API
    // locales (getFirstLinkpathDest, vault.getFiles…). Le wrapper
    // .internal-embed d'un embed externe `![[https://…]]` peut porter l'URL
    // d'origine même quand l'<img> rendu ne la reprend pas telle quelle —
    // les deux sources sont donc examinées, pas seulement celle de l'<img>.
    const embedSrc = img.closest(".internal-embed")?.getAttribute("src") || "";
    const remoteSource = isRemoteImageSource(src)
      ? src.trim()
      : (embedSrc && isRemoteImageSource(embedSrc) ? embedSrc.trim() : null);
    if (remoteSource) {
      // Conserve l'URL réelle dans le HTML/export — jamais inlinée en
      // data:, jamais réécrite en placeholder local.
      if (src !== remoteSource) img.setAttribute("src", remoteSource);
      continue;
    }
    try {
      const file = resolveImageFile(app, img, src, sourcePath);
      if (!file) {
        // Une image introuvable dans le coffre n'était auparavant signalée
        // nulle part : ni Notice, ni même console.error — invisible pour
        // l'utilisatrice. Voir renderManuscriptHtml, qui remonte cette
        // liste jusqu'à exportViaNative pour un avertissement explicite.
        missingResources.add(src);
        continue;
      }
      const buf = await app.vault.readBinary(file);
      const b64 = arrayBufferToBase64(buf);
      const ext = (file.extension || "png").toLowerCase();
      const mime = IMAGE_MIME_BY_EXTENSION[ext] || "image/png";
      const dataUri = `data:${mime};base64,${b64}`;
      img.setAttribute("src", dataUri);
      const { width, height } = await naturalSizeOf(dataUri);
      const caption = realCaption(img.getAttribute("alt"), file);
      if (caption) {
        // Créés via createEl() : img appartient à container (voir
        // renderManuscriptHtml ci-dessus), détaché du document Obsidian.
        const figure = createEl("figure");
        img.replaceWith(figure);
        figure.appendChild(img);
        const figcaption = createEl("figcaption");
        figcaption.textContent = caption;
        figure.appendChild(figcaption);
      }
      images.set(img, { bytes: new Uint8Array(buf), ext, width, height, caption });
    } catch (e) {
      console.error("Feuillets export: image non inlinée", src, e);
      missingResources.add(src);
    }
  }
  return { images, missingResources: Array.from(missingResources) };
}

/** Dimensions réelles d'une image déjà encodée en data: URI — nécessaire
 * pour dimensionner un ImageRun docx sans le déformer. Repli sur une
 * taille raisonnable si le décodage échoue plutôt que de faire échouer
 * tout l'export pour une seule image récalcitrante. */
function naturalSizeOf(dataUri: string): Promise<ImageDimensions> {
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve({ width: el.naturalWidth || 400, height: el.naturalHeight || 300 });
    el.onerror = () => resolve({ width: 400, height: 300 });
    el.src = dataUri;
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Retire ce qui n'a de sens que dans l'app (boutons de copie de bloc de
 * code, attributs data-* internes) — le contenu sémantique (titres,
 * paragraphes, gras/italique, listes, citations, références de notes)
 * reste intact. */
function stripObsidianCruft(container: HTMLElement): void {
  container
    .querySelectorAll("button, .copy-code-button, .edit-block-button, .callout-icon, .collapse-indicator")
    .forEach((el) => el.remove());
  container.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-") && attr.name !== "data-footnote-id") {
        el.removeAttribute(attr.name);
      }
    }
  });
}
