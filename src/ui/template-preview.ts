/* Rendu de l'aperçu de mise en page (PreviewView, vue onglet dédiée — voir
   views/preview-view.ts).

   Le CSS d'un modèle d'export est produit par templateToCss() et contient
   des règles `body { … }`, `p { … }`, `h1/h2/h3 { … }`. Il était jusqu'ici
   injecté dans un <style> ajouté au DOM d'Obsidian — deux problèmes :

   1. Ces sélecteurs ne sont pas limités à l'aperçu. La règle `body { … }`
      s'appliquait donc au <body> d'Obsidian lui-même : police, taille,
      interlignage et marges du modèle d'export repeignaient toute la
      fenêtre de l'application tant que la modale restait ouverte.
   2. L'ESLint officiel d'Obsidian interdit la création d'éléments <style>
      (et l'écriture via innerHTML) dans le DOM de l'application.

   L'aperçu vit désormais dans une iframe `sandbox` alimentée par `srcdoc` :
   le CSS du modèle ne s'applique qu'au document d'aperçu, et le rendu y est
   plus fidèle au fichier exporté puisqu'il n'hérite plus du thème
   d'Obsidian. `sandbox="allow-same-origin"` (PAS `allow-scripts` — le
   contenu n'a et n'aura jamais de <script>) : un sandbox VIDE assigne au
   document srcdoc une origine opaque, ce qui bloque l'accès
   `iframe.contentDocument` depuis le document parent (retourne `null`,
   silencieusement) — c'est ce qui rendait le zoom inopérant. */

/** Espace vertical entre deux pages dans l'aperçu, en px NON mis à
 * l'échelle du contenu (il fait partie du flux mesuré, donc il est zoomé
 * comme le reste — voir naturalPagesHeight dans preview-view.ts). */
const PAGE_GAP_PX = 24;

/**
 * Monte l'aperçu paginé dans une iframe isolée. TOUTES les pages sont
 * regroupées dans un unique wrapper `.feuillets-preview-pages` : un seul
 * `transform: scale(var(--feuillets-preview-scale))` pilote le zoom de
 * l'ensemble, au lieu de traquer/transformer chaque `.pdf-page`
 * individuellement.
 *
 * GÉOMÉTRIE (contrat avec preview-view.ts, dont dépendent le
 * dimensionnement de l'iframe ET la restauration du défilement) :
 * `.feuillets-preview-pages` ne porte AUCUNE marge ni padding propre, et
 * son wrapper non plus. La hauteur mesurée sur `.feuillets-preview-pages`
 * est donc exactement la hauteur du contenu à l'échelle 1, et la position
 * visuelle d'une page vaut exactement `page.offsetTop * scale`. Toute la
 * respiration visuelle (padding autour des pages) vit dans le document
 * PARENT, sur `.feuillets-preview-scaled-container` — sinon un padding non
 * transformé fausserait ces deux calculs (l'iframe était trop courte de la
 * moitié du padding, et la dernière page se retrouvait rognée).
 *
 * @param {HTMLElement} container  élément parent (dans le DOM d'Obsidian)
 * @param {string} css             CSS du modèle (templateToCss)
 * @param {string} pagesHtml       HTML des pages (paginateManuscript)
 * @param {number} initialScale    valeur initiale de --feuillets-preview-scale
 */
export function mountTemplatePreview(
  container: HTMLElement,
  css: string,
  pagesHtml: string,
  initialScale: number,
  mode = "manuscript",
  onLoad?: (frame: HTMLIFrameElement) => void,
): HTMLIFrameElement {
  /* L'iframe est préparée DÉTACHÉE. Une iframe `srcdoc` minuscule peut
     terminer son chargement dès son insertion dans Electron ; installer
     l'écouteur seulement après `container.createEl()` laissait alors la
     page visible, mais sans zoom ni interactions de page de titre. */
  const frame = createEl("iframe", { cls: "feuillets-preview-frame" });
  frame.setAttr("sandbox", "allow-same-origin");
  if (onLoad) frame.addEventListener("load", () => onLoad(frame), { once: true });

  frame.srcdoc = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>",
    ":root {",
    `  --feuillets-preview-scale: ${initialScale};`,
    "}",
    /* CSS DU MODÈLE D'ABORD, coque APRÈS. templateToCss() émet un
       `body { margin: <marges du modèle> }` (ex. 71pt pour 2,5 cm) destiné
       à la page imprimée. Dans l'aperçu, les marges sont déjà portées par
       chaque `.pdf-page` (padding en cm posé par paginateManuscript) : ce
       `body { margin }` n'était donc qu'un décalage parasite de ~95 px vers
       la droite et vers le bas — la cause du mauvais centrage. Placé avant
       la coque, il reste disponible pour tout ce qui compte (police,
       taille, interlignage, alignement, titres, citations, séparateurs,
       hérités par le contenu des pages) mais ses règles de POSITION sont
       neutralisées juste en dessous, à spécificité égale et donc par
       simple ordre de cascade. */
    css,
    "html { margin: 0; padding: 0; width: 100%; }",
    "body { margin: 0; padding: 0; width: 100%; overflow: hidden; background: var(--background-secondary, #f0f2f5); }",
    ".feuillets-preview-pages-wrapper {",
    "  width: 100%;",
    "  display: flex;",
    "  flex-direction: column;",
    "  align-items: center;",
    "  box-sizing: border-box;",
    "  margin: 0;",
    "  padding: 0;",
    "}",
    ".feuillets-preview-pages {",
    "  transform: scale(var(--feuillets-preview-scale));",
    "  transform-origin: top center;",
    "  margin: 0;",
    "  padding: 0;",
    "}",
    `.feuillets-preview-pages > .pdf-page { margin: 0 auto ${PAGE_GAP_PX}px auto; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08); border-radius: 2px; }`,
    /* Dernière page sans marge basse : la hauteur mesurée doit être
       exactement celle du contenu, sans blanc résiduel qui décalerait la
       restauration du défilement. */
    ".feuillets-preview-pages > .pdf-page:last-child { margin-bottom: 0; }",
    /* MODE D'APERÇU — un seul CSS central (celui du gabarit, ci-dessus),
       jamais trois copies divergentes : seules quelques sections
       conditionnelles distinguent les usages, via la classe posée sur
       <body>.

       Mode Scène = écriture. Les en-têtes et folios sont de la mise en page
       de LIVRE (titre courant, nom d'auteur, « Page 3 sur 47 ») : ils n'ont
       aucun sens sur un feuillet isolé et ajoutent, en haut de chaque page,
       une zone qui n'existe pas dans le Markdown. Ils sont donc masqués —
       masqués seulement : le HTML paginé reste EXACTEMENT celui de l'export
       (paginateManuscript n'est pas touché), et les modes Chapitre, Partie
       et Manuscrit les affichent normalement. */
    ".is-preview-mode-scene .pdf-page-header,",
    ".is-preview-mode-scene .pdf-page-footer { display: none !important; }",
    "</style></head>",
    `<body class="is-preview-mode-${mode}">`,
    `<div class="feuillets-preview-pages-wrapper"><div class="feuillets-preview-pages">${pagesHtml}</div></div>`,
    "</body></html>",
  ].join("\n");
  container.appendChild(frame);
  return frame;
}
