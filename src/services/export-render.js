const { Component, MarkdownRenderer } = require("obsidian");
import { TITLE_ROLE_MARKER, parseTitleRoles, hasTitleRoleLines } from "../utils/title-roles.js";

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
export async function renderManuscriptHtml(app, markdown, sourcePath) {
  const container = document.createElement("div");
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
  } finally {
    component.unload();
  }

  const images = await inlineImages(app, container, sourcePath);
  const footnotes = extractFootnotes(container);
  stripObsidianCruft(container);

  return { containerEl: container, footnotes, images };
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
function tagTitleRolesInDom(containerEl) {
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
export function preserveBlankLinesForFrontPage(text) {
  const BLANK_LINE_MARKER = "\u00A0";
  const lines = text.split("\n");
  const paragraphs = [];
  let current = [];
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
 * directement sur le HTML rendu. Sans `segments` (pandoc, ou aucun
 * feuillet Front dans ce projet), se comporte exactement comme
 * renderManuscriptHtml. */
export async function renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath) {
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

function wrapFrontPagesInDom(containerEl) {
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
    const wrapper = document.createElement("div");
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
function extractFootnotes(container) {
  const footnotes = [];
  try {
    const section = container.querySelector("section.footnotes, .footnotes");
    if (!section) return footnotes;
    const items = section.querySelectorAll("li[id]");
    items.forEach((li) => {
      const id = li.getAttribute("id") || "";
      const clone = li.cloneNode(true);
      clone.querySelectorAll("a.footnote-backref, .footnote-backref").forEach((a) => a.remove());
      footnotes.push({ id, html: clone.innerHTML.trim(), text: clone.textContent.trim() });
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
function realCaption(alt, file) {
  const a = (alt || "").trim();
  if (!a) return "";
  const lower = a.toLowerCase();
  if (lower === file.basename.toLowerCase() || lower === file.name.toLowerCase()) return "";
  if (/^\d+(x\d+)?$/.test(a)) return "";
  return a;
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
function resolveImageFile(app, img, src, sourcePath) {
  const embedEl = img.closest(".internal-embed");
  const linkpath = embedEl?.getAttribute("src") || "";
  if (linkpath) {
    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath || "");
    if (file) return file;
  }
  const path = decodeURIComponent(src.replace(/^app:\/\/[^/]+\//, "").split("?")[0]).replace(/^\/+/, "");
  return app.vault.getFiles().find((f) => f.path === path || src.includes(encodeURIComponent(f.name))) || null;
}

/** Images internes au coffre (embeds `![[fichier.png]]` ou `![alt](fichier.png)`)
 * : Obsidian les rend en `<img src="app://…">`, une URL qui n'a de sens
 * qu'à l'intérieur de l'app — inlinée en data: URI pour que l'export
 * survive une fois sorti du coffre. Les images déjà externes (http/https)
 * ou déjà en data: sont laissées telles quelles. Best-effort : une image
 * non résolue reste avec son URL d'origine plutôt que de faire échouer
 * tout l'export. Retourne une Map<img, {bytes,ext,width,height,caption}>
 * — le DOCX en a besoin pour construire un vrai ImageRun + un paragraphe
 * de légende (voir export-docx.js) ; l'EPUB/PDF reçoivent directement un
 * <figure>/<figcaption> dans le DOM. */
async function inlineImages(app, container, sourcePath) {
  const images = new Map();
  const imgs = Array.from(container.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:") || /^https?:\/\//.test(src)) continue;
    try {
      const file = resolveImageFile(app, img, src, sourcePath);
      if (!file) continue;
      const buf = await app.vault.readBinary(file);
      const b64 = arrayBufferToBase64(buf);
      const ext = (file.extension || "png").toLowerCase();
      const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" }[ext] || "image/png";
      const dataUri = `data:${mime};base64,${b64}`;
      img.setAttribute("src", dataUri);
      const { width, height } = await naturalSizeOf(dataUri);
      const caption = realCaption(img.getAttribute("alt"), file);
      if (caption) {
        const figure = document.createElement("figure");
        img.replaceWith(figure);
        figure.appendChild(img);
        const figcaption = document.createElement("figcaption");
        figcaption.textContent = caption;
        figure.appendChild(figcaption);
      }
      images.set(img, { bytes: new Uint8Array(buf), ext, width, height, caption });
    } catch (e) {
      console.error("Feuillets export: image non inlinée", src, e);
    }
  }
  return images;
}

/** Dimensions réelles d'une image déjà encodée en data: URI — nécessaire
 * pour dimensionner un ImageRun docx sans le déformer. Repli sur une
 * taille raisonnable si le décodage échoue plutôt que de faire échouer
 * tout l'export pour une seule image récalcitrante. */
function naturalSizeOf(dataUri) {
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve({ width: el.naturalWidth || 400, height: el.naturalHeight || 300 });
    el.onerror = () => resolve({ width: 400, height: 300 });
    el.src = dataUri;
  });
}

function arrayBufferToBase64(buf) {
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
function stripObsidianCruft(container) {
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
