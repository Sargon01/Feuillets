import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer, Menu, TFolder, TFile } from "obsidian";
import { VIEW_PREVIEW } from "../src/constants.js";
import { PreviewView, activatePreviewView, openScopeWithPreview, openWithPreview } from "../src/views/preview-view.js";
import { resolveCompileScopeFiles } from "../src/services/compile-scope.js";
import { CompileSelectionModal } from "../src/ui/selection-modals.js";
import { LayoutModal } from "../src/ui/layout-modal.js";
import { mountTemplatePreview } from "../src/ui/template-preview.js";
import { setTitleRoleValue } from "../src/utils/title-roles.js";

/* Chantier « PreviewView : zoom et centrage » — deux bugs confirmés
 * manuellement : les boutons de zoom ne pilotaient rien de réel (l'iframe
 * était en `sandbox=""`, origine opaque -> `iframe.contentDocument` valait
 * `null` depuis le document parent, l'exception étant avalée en silence) et
 * le centrage se calculait sur la mauvaise largeur. Ces tests vérifient la
 * VRAIE mécanique : la variable CSS effectivement posée sur
 * `iframe.contentDocument.documentElement.style`, la largeur lue sur
 * `.feuillets-preview-viewport` (jamais `window.innerWidth`), et
 * l'application différée d'un zoom demandé avant le `load` de l'iframe. */

function fakeRender(markdown, container) {
  container.appendChild(element("h2", "Chapitre 1"));
  container.appendChild(element("p", markdown));
  return Promise.resolve();
}

class FakeStyle {
  constructor() { this._props = new Map(); }
  setProperty(name, value) { this._props.set(name, String(value)); }
  getPropertyValue(name) { return this._props.get(name) ?? ""; }
}

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.style = new FakeStyle();
    this.classes = new Set();
    this.offsetHeight = 30;
    this.offsetWidth = 30;
    this.clientWidth = 900;
    this.clientHeight = 700;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    /* Zones défilables : `scrollHeight`/`scrollWidth` sont posés par les
       tests qui vérifient la synchronisation et l'ancrage du zoom — un
       élément non défilable les laisse à 0, ce qui est aussi le cas réel. */
    this.scrollHeight = 0;
    this.scrollWidth = 0;
    this.offsetTop = 0;
    /* Position à l'écran, pilotée par les tests : la vue s'en sert pour
       situer la pile de pages dans le repère défilé du viewport (voir
       PreviewView.frameTopWithinScroll). */
    this._rectTop = 0;
    this.classList = { contains: (name) => this.classes.has(name) };
    this._attributes = new Map();
    this._eventListeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this._eventListeners.get(type);
    if (list) { const idx = list.indexOf(listener); if (idx >= 0) list.splice(idx, 1); }
  }
  /* `event` optionnel : les tests de zoom doivent pouvoir envoyer un vrai
     objet d'événement (ctrlKey/metaKey, deltaY, clientX/Y, preventDefault),
     seule façon de vérifier que la molette est traitée comme dans Obsidian
     et que `preventDefault` n'est appelé QUE dans le bon cas. */
  dispatch(type, event) {
    const list = this._eventListeners.get(type);
    if (list) [...list].forEach((fn) => fn(event || { target: this }));
  }
  click() { this.dispatch("click"); }
  toggleClass(cls, val) {
    if (val === undefined) { if (this.classes.has(cls)) this.classes.delete(cls); else this.classes.add(cls); }
    else if (val) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get innerHTML() { return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text; }
  get outerHTML() {
    // Sérialise TOUS les attributs, pas seulement class : sans cela, un
    // data-source-path réellement posé disparaîtrait à la sérialisation et
    // le test croirait à tort que le repère n'a pas été appliqué.
    const classAttr = this.classes.size ? ` class="${this.className}"` : "";
    const attrs = [...this._attributes].map(([n, v]) => ` ${n}="${v}"`).join("");
    return `<${this.tagName.toLowerCase()}${classAttr}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  hasClass(name) { return this.classes.has(name); }
  setText(value) { this.textContent = value; }
  get parentElement() { return this.parentNode; }
  get nextElementSibling() {
    const siblings = this.parentNode ? this.parentNode.children : [];
    const i = siblings.indexOf(this);
    return i >= 0 && i + 1 < siblings.length ? siblings[i + 1] : null;
  }
  /* Un vrai getBoundingClientRect est relatif au viewport visible : il se
     DÉCALE quand on défile. `_rectTop` est donc la position au repos, dont
     on retranche le défilement du conteneur scrollable (`_scroller`) — sans
     quoi le fixture prétendrait qu'un élément garde la même position à
     l'écran en défilant, et masquerait la compensation `+ scrollTop` de
     PreviewView.frameTopWithinScroll. */
  getBoundingClientRect() {
    const top = this._rectTop - (this._scroller ? this._scroller.scrollTop : 0);
    return { top, left: 0, right: this.offsetWidth, bottom: top + this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
  }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    // `value` : Obsidian le pose réellement sur l'élément (options d'un
    // <select>), et c'est ce que lit la barre de style.
    if (options.value !== undefined) child.value = options.value;
    return this.appendChild(child);
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  /* Nécessaire au regroupement des pages Front en <div> dédiés (voir
     export-render.wrapFrontPagesInDom) : sans lui, un projet doté d'une vraie
     page de titre échouait silencieusement au rendu. */
  insertBefore(child, reference) {
    child.remove();
    child.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    return child;
  }
  prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
  after(child) { const parent = this.parentNode; const index = parent.children.indexOf(this); child.remove(); child.parentNode = parent; parent.children.splice(index + 1, 0, child); }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) { this.children.splice(index, 1); child.parentNode = null; } return child; }
  cloneNode(deep) {
    // Les attributs doivent survivre au clonage : paginateManuscript clone
    // chaque élément de tête, et c'est ce clone qui est sérialisé — un
    // data-source-path perdu ici n'atteindrait jamais l'aperçu.
    const clone = new FakeElement(this.tagName, this._text);
    clone.className = this.className;
    for (const [n, v] of this._attributes) clone.setAttribute(n, v);
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matchesSelector(selector) {
    // [attr] — présence seule, ce qu'utilise la recherche de sections.
    const present = selector.match(/^\[([^=\]]+)\]$/);
    if (present) return this.getAttribute(present[1]) !== null;
    // [attr="valeur"]
    const attr = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
    if (attr) return this.getAttribute(attr[1]) === attr[2];
    // .classe
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    // balise
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matchesSelector && child.matchesSelector(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

/** Dimensions naturelles d'une page A4 à 96 dpi — celles que
 *  paginateManuscript pose en dur (210mm x 297mm) sur chaque `.pdf-page`. */
const PAGE_W = 793.7;
const PAGE_H = 1122.5;
const PAGE_GAP = 24;

/* Construit le faux document de l'iframe en reflétant EXACTEMENT la
 * structure produite par mountTemplatePreview (ui/template-preview.ts) :
 * .feuillets-preview-pages-wrapper > .feuillets-preview-pages > N x .pdf-page.
 * Les tailles sont exposées via offsetWidth/offsetHeight — jamais
 * getBoundingClientRect — pour vérifier que la mesure ignore bien tout
 * `transform` déjà en place (voir measureNaturalDimensions). Le
 * `querySelector` délègue au vrai parcours d'arbre de FakeElement plutôt
 * qu'à une correspondance de sous-chaîne : « .feuillets-preview-pages » est
 * un préfixe de « .feuillets-preview-pages-wrapper », et confondre les deux
 * masquerait précisément le bug de géométrie corrigé ici (mesurer le
 * wrapper, dont le padding n'est pas mis à l'échelle, au lieu de l'élément
 * réellement transformé). */
function buildFakeIframeDocument(srcdoc) {
  const pageCount = (srcdoc.match(/class="pdf-page/g) || []).length;
  const docEl = new FakeElement("html");
  docEl.style = new FakeStyle();
  const bodyEl = new FakeElement("body");
  const wrapper = new FakeElement("div");
  wrapper.className = "feuillets-preview-pages-wrapper";
  const pagesGroup = new FakeElement("div");
  pagesGroup.className = "feuillets-preview-pages";
  for (let i = 0; i < pageCount; i++) {
    const page = new FakeElement("div");
    page.className = "pdf-page";
    page.offsetWidth = PAGE_W;
    page.offsetHeight = PAGE_H;
    page.offsetTop = i * (PAGE_H + PAGE_GAP);
    pagesGroup.appendChild(page);
  }
  /* Repères de source réellement présents dans le HTML sérialisé (posés par
     preview-source-map.ts) : on les extrait du srcdoc plutôt que de les
     inventer — le test échoue donc si l'attribut n'a pas survécu jusqu'au
     rendu, ce qui est exactement ce qu'on veut vérifier. */
  for (const match of srcdoc.matchAll(/data-source-path="([^"]+)"/g)) {
    const marked = new FakeElement("div");
    marked.setAttribute("data-source-path", match[1]);
    pagesGroup.appendChild(marked);
  }
  wrapper.appendChild(pagesGroup);
  // Pile des pages : hauteur EXACTE du contenu, sans padding parasite —
  // c'est le contrat de géométrie de ui/template-preview.ts.
  pagesGroup.offsetHeight = pageCount > 0 ? pageCount * PAGE_H + (pageCount - 1) * PAGE_GAP : 0;
  wrapper.offsetHeight = pagesGroup.offsetHeight;
  bodyEl.appendChild(wrapper);
  return {
    documentElement: docEl,
    body: bodyEl,
    readyState: "complete",
    querySelector: (selector) => bodyEl.querySelector(selector),
    querySelectorAll: (selector) => bodyEl.querySelectorAll(selector),
  };
}

Object.defineProperty(FakeElement.prototype, "contentDocument", {
  get() {
    if (this.tagName !== "IFRAME") return undefined;
    if (!this._contentDocument && this.srcdoc) this._contentDocument = buildFakeIframeDocument(this.srcdoc);
    return this._contentDocument || null;
  },
  configurable: true,
});

function element(tag, text, height = 30) { const el = new FakeElement(tag, text); el.offsetHeight = height; return el; }

test("iframe d’aperçu — l’écouteur de chargement est branché avant l’insertion", () => {
  const dom = installDom();
  try {
    const container = element("div");
    const append = container.appendChild.bind(container);
    container.appendChild = (frame) => {
      const result = append(frame);
      // Reproduit le cas Electron rapide : `load` part immédiatement dès
      // l'insertion. Un écouteur ajouté après mountTemplatePreview le rate.
      frame.dispatch("load");
      return result;
    };
    let loaded = null;
    const frame = mountTemplatePreview(
      container,
      "body { color: black; }",
      '<div class="pdf-page"></div>',
      1,
      "manuscript",
      (readyFrame) => { loaded = readyFrame; }
    );
    assert.equal(loaded, frame);
    assert.equal(container.children[0], frame);
  } finally {
    dom.restore();
  }
});

class FakeResizeObserver {
  constructor(callback) { this.callback = callback; this.observed = []; }
  observe(el) { this.observed.push(el); }
  disconnect() { this.observed = []; }
  trigger() { this.callback(); }
}

function installDom() {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    createEl: globalThis.createEl,
    createDiv: globalThis.createDiv,
    createSpan: globalThis.createSpan,
    ResizeObserver: globalThis.ResizeObserver,
    getComputedStyle: globalThis.getComputedStyle,
  };
  /* Padding réel du viewport (styles.css : `padding: 20px 20px`) — la vue
     doit le RETRANCHER de clientWidth/clientHeight, qui l'incluent. Exposé
     via getComputedStyle comme dans un vrai navigateur, et non supposé
     égal à une constante côté TypeScript. */
  globalThis.getComputedStyle = (el) => ({
    paddingLeft: `${el?._paddingX ?? 0}px`,
    paddingRight: `${el?._paddingX ?? 0}px`,
    paddingTop: `${el?._paddingY ?? 0}px`,
    paddingBottom: `${el?._paddingY ?? 0}px`,
  });
  const body = new FakeElement("body");
  body.contains = (node) => body.children.includes(node);
  globalThis.document = { body, createElement: (tag) => new FakeElement(tag) };
  /* Minuteurs contrôlés à la main : c'est ce qui permet de vérifier
     RÉELLEMENT le debounce (plusieurs modifications rapides ne doivent
     laisser qu'un seul minuteur en attente, donc ne provoquer qu'une seule
     recompilation) plutôt que d'attendre en temps réel. */
  const timers = new Map();
  let nextTimerId = 1;
  globalThis.window = {
    setTimeout: (fn) => {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    /* Même file que les minuteurs : `runTimers()` joue donc aussi les
       frames en attente. C'est ce qui permet de VÉRIFIER qu'un train
       d'événements `scroll` ne provoque qu'un seul recalcul (une seule
       frame en attente), au lieu de le supposer. */
    requestAnimationFrame: (fn) => {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => { timers.delete(id); },
  };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { const ro = new FakeResizeObserver(cb); observers.push(ro); return ro; }
  };
  return {
    observers,
    /** Nombre de rafraîchissements différés encore en attente. */
    pendingTimers: () => timers.size,
    /** Déclenche tous les minuteurs en attente (fin du debounce). */
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    restore() {
      globalThis.document = previous.document;
      globalThis.window = previous.window;
      globalThis.createEl = previous.createEl;
      globalThis.createDiv = previous.createDiv;
      globalThis.createSpan = previous.createSpan;
      globalThis.ResizeObserver = previous.ResizeObserver;
      globalThis.getComputedStyle = previous.getComputedStyle;
    },
  };
}

/** Padding horizontal/vertical réel du viewport, tel que styles.css
 *  l'applique (`padding: 20px 20px`) — les tests le posent explicitement
 *  pour vérifier qu'il est bien retranché du calcul de zoom. */
const VIEWPORT_PADDING = 20;
/** Marge de sécurité retranchée en plus par PreviewView (constante interne
 *  VIEWPORT_SAFETY_MARGIN) — dupliquée ici volontairement : si elle change
 *  côté source, ces tests doivent le signaler explicitement. */
const SAFETY_MARGIN = 8;

/** Facteur attendu en « Ajuster à la largeur » pour une largeur de volet
 *  donnée : arrondi au centième INFÉRIEUR, pour ne jamais dépasser la
 *  largeur disponible (donc jamais de barre horizontale). */
function expectedFitWidthScale(viewportClientWidth) {
  const available = viewportClientWidth - 2 * VIEWPORT_PADDING - SAFETY_MARGIN;
  return Math.floor((available / PAGE_W) * 100) / 100;
}

function buildProject() {
  const manuscript = new TFolder("Manuscrit");
  manuscript.name = "Manuscrit";
  manuscript.path = "Manuscrit";

  const chapterDir = new TFolder("Manuscrit/Chapitre 1");
  chapterDir.name = "Chapitre 1";
  chapterDir.path = "Manuscrit/Chapitre 1";
  chapterDir.parent = manuscript;

  const sceneFile = new TFile("Manuscrit/Chapitre 1/01-scene.md", "---\ntitre: Scene 1\n---\nTexte réel de la scène.");
  sceneFile.name = "01-scene.md";
  sceneFile.basename = "01-scene";
  sceneFile.extension = "md";
  sceneFile.path = "Manuscrit/Chapitre 1/01-scene.md";
  sceneFile.parent = chapterDir;

  const sceneFile2 = new TFile("Manuscrit/Chapitre 1/02-scene.md", "---\ntitre: Scene 2\n---\nSeconde scène du chapitre.");
  sceneFile2.name = "02-scene.md";
  sceneFile2.basename = "02-scene";
  sceneFile2.extension = "md";
  sceneFile2.path = "Manuscrit/Chapitre 1/02-scene.md";
  sceneFile2.parent = chapterDir;

  chapterDir.children = [sceneFile, sceneFile2];
  manuscript.children = [chapterDir];

  // Écouteurs posés par la vue, déclenchables à la main depuis les tests.
  const vaultListeners = new Map();
  const workspaceListeners = new Map();
  /* Feuilles ouvertes dans l'espace de travail, par type — c'est ce que la
     vue interroge pour trouver l'éditeur à suivre (voir
     PreviewView.bindSourcePane). */
  const leavesByType = new Map();
  // Feuillet actif : un VRAI TFile (la vue teste `instanceof TFile`).
  let activeFile = sceneFile;
  const app = {
    vault: {
      read: async (f) => (f && typeof f.content === "string" ? f.content : "---\ntitre: Scene 1\n---\nTexte réel de la scène."),
      cachedRead: async (f) => (f && typeof f.content === "string" ? f.content : "---\ntitre: Scene 1\n---\nTexte réel de la scène."),
      createFolder: async () => {},
      create: async (path, content) => new TFile(path, content),
      // Écriture RÉELLE dans le fixture : les tests de première page doivent
      // pouvoir relire ce qui a été persisté, pas seulement compter les appels.
      modify: async (file, content) => { if (file && typeof content === "string") file.content = content; },
      on: (event, handler) => {
        if (!vaultListeners.has(event)) vaultListeners.set(event, []);
        vaultListeners.get(event).push(handler);
        return { event, handler };
      },
      /* Parcours réel de l'arbre plutôt qu'une liste figée : les tests de
         première page ajoutent un dossier Front au projet, il doit être
         résolu comme n'importe quel autre nœud. */
      getAbstractFileByPath: (p) => {
        const walk = (node) => {
          if (node.path === p) return node;
          for (const child of node.children || []) {
            const found = walk(child);
            if (found) return found;
          }
          return null;
        };
        return walk(manuscript);
      },
    },
    /* Frontmatter PAR FICHIER dès qu'un test en pose un (`_fm`) : la page de
       titre Front se distingue d'une scène par son `type: titre` et par son
       indicateur `compile`, exactement comme dans un vrai coffre. Les
       feuillets ordinaires gardent l'ancien frontmatter commun. */
    metadataCache: { getFileCache: (f) => ({ frontmatter: f && f._fm ? f._fm : { titre: "Scene 1" } }) },
    fileManager: {
      processFrontMatter: async (file, mutate) => {
        file._fm = { ...(file._fm || {}) };
        mutate(file._fm);
      },
    },
    workspace: {
      on: (event, handler) => {
        if (!workspaceListeners.has(event)) workspaceListeners.set(event, []);
        workspaceListeners.get(event).push(handler);
        return { event, handler };
      },
      getActiveFile: () => activeFile,
      getLeavesOfType: (type) => leavesByType.get(type) || [],
      getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
      getRightLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
    emitVaultModify: (path) => {
      for (const handler of vaultListeners.get("modify") || []) handler({ path });
    },
    emitWorkspace: (event) => {
      for (const handler of workspaceListeners.get(event) || []) handler();
    },
    setActiveFile: (fileOrPath) => {
      activeFile = typeof fileOrPath === "string"
        ? [sceneFile, sceneFile2].find((f) => f.path === fileOrPath) || { path: fileOrPath }
        : fileOrPath;
    },
    vaultListenerCount: () => (vaultListeners.get("modify") || []).length,
    workspaceListenerCount: (event) => (workspaceListeners.get(event) || []).length,

    /* Une VRAIE feuille Markdown : un `contentEl` contenant l'élément
       réellement défilable d'Obsidian (`.cm-scroller`), pas un objet
       « scroller » inventé — c'est ce que la vue doit savoir retrouver. */
    openMarkdownPane: (file, { scrollHeight = 4000, clientHeight = 600 } = {}) => {
      const contentEl = new FakeElement("div");
      const scroller = contentEl.createDiv({ cls: "cm-scroller" });
      scroller.scrollHeight = scrollHeight;
      scroller.clientHeight = clientHeight;
      const leaf = { view: { file, contentEl } };
      leavesByType.set("markdown", [...(leavesByType.get("markdown") || []), leaf]);
      return scroller;
    },
    closeMarkdownPanes: () => { leavesByType.set("markdown", []); },

    /* Une vue Scrivening : plusieurs feuillets dans UN seul défilement,
       chacun repéré par data-path (voir views/scrivenings-editor.ts). */
    openScriveningsPane: (files, { sceneHeight = 1000, clientHeight = 600 } = {}) => {
      const contentEl = new FakeElement("div");
      const scroll = contentEl.createDiv({ cls: "feuillets-board-scroll" });
      scroll.clientHeight = clientHeight;
      scroll.scrollHeight = files.length * sceneHeight;
      const wrapper = scroll.createDiv({ cls: "feuillets-scrivenings-wrapper" });
      const scenes = files.map((file, i) => {
        const block = wrapper.createDiv({ cls: "feuillets-scrivenings-scene" });
        block.setAttribute("data-path", file.path);
        block._rectTop = i * sceneHeight;
        block._scroller = scroll;
        block.offsetHeight = sceneHeight;
        return block;
      });
      leavesByType.set("feuillets-board", [{ view: { contentEl } }]);
      return { scroll, scenes };
    },
  };

  const settings = {
    projectFolder: "Manuscrit",
    // Projet plat : les dossiers de niveau 1 sont des chapitres (c'est ce
    // que lit roleOfFolder, primitive partagée avec le Binder).
    level1Role: "chapitres",
    exportTemplate: "classique",
    manuscriptTitle: "Grand Roman",
    manuscriptAuthor: "Auteur Test",
    orders: {},
    folderPositions: {},
  };

  return { app, settings, manuscript, chapterDir, sceneFile, sceneFile2 };
}

/** Ouvre une PreviewView complète (DOM + compilation) et renvoie ses
 * repères, sans encore déclencher le `load` de l'iframe — pour laisser
 * chaque test décider quand le simuler. */
async function openView(mode = "manuscript") {
  const { app, settings, manuscript, chapterDir, sceneFile, sceneFile2 } = buildProject();
  settings.previewMode = mode;
  const saved = [];
  const plugin = { settings, getProjectFolder: () => manuscript, saveSettings: async () => { saved.push({ ...settings }); } };
  plugin.savedCount = () => saved.length;
  const leaf = { contentEl: element("div") };
  const view = new PreviewView(leaf, plugin);
  view.app = app;

  await view.onOpen();

  const toolbar = view.contentEl.querySelector(".feuillets-preview-toolbar");
  const viewport = view.contentEl.querySelector(".feuillets-preview-viewport");
  const scaledContainer = view.contentEl.querySelector(".feuillets-preview-scaled-container");
  // Padding réel appliqué par styles.css au viewport (lu via getComputedStyle).
  if (viewport) {
    viewport._paddingX = VIEWPORT_PADDING;
    viewport._paddingY = VIEWPORT_PADDING;
  }
  return { view, plugin, toolbar, viewport, scaledContainer, app, manuscript, chapterDir, sceneFile, sceneFile2, frame: latestFrame(scaledContainer) };
}

/** Dernière iframe montée dans le conteneur — pendant un échange, l'ancienne
 *  et la nouvelle coexistent volontairement (c'est ce qui empêche la zone
 *  défilable de s'effondrer, donc la position d'être perdue). */
function latestFrame(scaledContainer) {
  const frames = scaledContainer.children.filter((c) => c.tagName === "IFRAME");
  return frames[frames.length - 1] || null;
}

const CENTER_LABEL = "Recentrer sur le feuillet ouvert";
const SYNC_LABEL = "Synchroniser le défilement";

function fireLoad(frame) { frame.dispatch("load"); }

/** Ouvre RÉELLEMENT le menu attaché à un contrôle de la barre et renvoie le
 *  Menu construit : la barre n'expose plus qu'un libellé par sujet, tout le
 *  reste vit dans un menu — c'est donc lui qu'il faut inspecter. */
function openMenuVia(el) {
  Menu.lastShown = null;
  el.click();
  assert.ok(Menu.lastShown, "un menu doit s'ouvrir");
  return Menu.lastShown;
}

function menuItem(menu, title) {
  const item = menu.items.find((i) => i.title === title);
  assert.ok(item, `entrée « ${title} » absente du menu (${menu.items.map((i) => i.title).join(" | ")})`);
  return item;
}

function menuTitles(menu) {
  return menu.items.filter((i) => !i.separator).map((i) => i.title);
}

/** Déclenche une entrée de menu comme le ferait un clic réel. */
function runMenuItem(el, title) {
  const item = menuItem(openMenuVia(el), title);
  item.callback();
  return item;
}

test("PreviewView : type de vue stable et informations d'affichage", () => {
  const leaf = { contentEl: element("div") };
  const plugin = { settings: {} };
  const view = new PreviewView(leaf, plugin);
  plugin.settings.previewMode = "manuscript";

  assert.equal(view.getViewType(), "feuillets-manuscript-preview");
  assert.equal(view.getDisplayText(), "Aperçu — manuscrit");
  assert.equal(view.getIcon(), "eye");
  assert.equal(typeof view.open, "undefined", "la vue ne doit pas dériver d'une Modal");
});

test("PreviewView : activation et réutilisation de l'onglet existant (activatePreviewView)", async () => {
  let revealedLeaf = null;
  let createdState = null;

  const existingLeaf = { setViewState: async () => {} };
  const appWithExisting = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_PREVIEW ? [existingLeaf] : []),
      getLeaf: () => null,
      revealLeaf: (leaf) => { revealedLeaf = leaf; },
    },
  };
  await activatePreviewView(appWithExisting);
  assert.equal(revealedLeaf, existingLeaf, "activatePreviewView doit réutiliser l'onglet existant s'il est déjà ouvert");

  const newLeaf = { setViewState: async (state) => { createdState = state; } };
  const appWithoutExisting = {
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: (type) => (type === "tab" ? newLeaf : null),
      revealLeaf: (leaf) => { revealedLeaf = leaf; },
    },
  };
  await activatePreviewView(appWithoutExisting);
  assert.equal(createdState.type, VIEW_PREVIEW);
  assert.equal(createdState.active, true);
  assert.equal(revealedLeaf, newLeaf);
});

test("PreviewView : structure DOM — contentEl > .feuillets-preview-view > toolbar, viewport > scaled-container > iframe", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, toolbar, viewport, scaledContainer, frame } = await openView();
    assert.ok(view.contentEl.querySelector(".feuillets-preview-view"), "la vue doit avoir son conteneur racine");
    assert.ok(toolbar, "la barre d'outils doit exister");
    assert.ok(viewport, "le viewport scrollable doit exister");
    assert.ok(scaledContainer, "le conteneur centreur doit exister");
    assert.ok(scaledContainer.parentNode === viewport, "le conteneur centreur doit être DANS le viewport");
    assert.ok(frame && frame.tagName === "IFRAME", "l'iframe doit être montée dans le conteneur centreur");
    assert.ok(frame.parentNode === scaledContainer, "l'iframe doit être un enfant direct du conteneur centreur");
    // sandbox="allow-same-origin" (pas vide) : sinon iframe.contentDocument
    // est bloqué (origine opaque) et le zoom ne peut jamais rien piloter.
    assert.equal(frame.getAttribute("sandbox"), "allow-same-origin");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : le srcdoc neutralise le `body { margin }` du modèle (cause du décentrage)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { frame } = await openView();
    const srcdoc = frame.srcdoc;

    /* templateToCss() émet `body { … margin: 71pt … }` (2,5 cm) pour la page
       imprimée. Dans l'aperçu, les marges sont déjà portées par le padding
       de chaque .pdf-page : ce margin ne faisait que décaler tout le contenu
       d'environ 95 px vers la droite et vers le bas. Il doit donc rester
       présent (le reste de la règle body porte police/taille/interlignage,
       hérités par les pages) mais être ANNULÉ par la coque, qui doit venir
       APRÈS lui dans la feuille — à spécificité égale, seul l'ordre tranche. */
    const templateBodyMargin = srcdoc.indexOf("margin: 71pt");
    const shellBodyReset = srcdoc.indexOf("body { margin: 0; padding: 0;");
    assert.ok(templateBodyMargin >= 0, "le CSS du modèle doit bien être injecté");
    assert.ok(shellBodyReset >= 0, "la coque doit réinitialiser les marges du body");
    assert.ok(
      shellBodyReset > templateBodyMargin,
      "la réinitialisation de la coque doit venir APRÈS le CSS du modèle, sinon le body reste décalé"
    );

    // La typographie du modèle, elle, doit survivre (héritée par les pages).
    assert.match(srcdoc, /font-family: 'Times New Roman'/);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la pile de pages n'a aucun padding non mis à l'échelle (géométrie exacte)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, frame } = await openView();
    fireLoad(frame);

    /* Un padding sur le wrapper ne serait PAS mis à l'échelle par le
       transform : la hauteur d'iframe (naturalPagesHeight * scale) serait
       alors fausse et la dernière page rognée en zoom réduit. La pile doit
       donc mesurer exactement la somme des pages et de leurs écarts. */
    const doc = frame.contentDocument;
    const pages = doc.querySelectorAll(".pdf-page");
    const expectedHeight = pages.length * PAGE_H + (pages.length - 1) * PAGE_GAP;
    assert.equal(view.naturalPagesHeight, expectedHeight);

    // Et la mesure porte bien sur l'élément transformé, pas sur le wrapper.
    assert.match(frame.srcdoc, /\.feuillets-preview-pages \{[^}]*transform: scale\(var\(--feuillets-preview-scale\)\)/);
    assert.match(frame.srcdoc, /\.feuillets-preview-pages-wrapper \{[^}]*padding: 0;/);
    // Centrage interne : les pages sont centrées dans le wrapper.
    assert.match(frame.srcdoc, /\.feuillets-preview-pages-wrapper \{[^}]*align-items: center;/);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : clic sur + AVANT le chargement de l'iframe — appliqué dès load, jamais avant", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, frame } = await openView();

    runMenuItem(view.zoomLabelEl, "125 %");
    // Avant `load` : rien ne doit avoir été posé sur le document de l'iframe.
    assert.equal(frame.contentDocument.documentElement.style.getPropertyValue("--feuillets-preview-scale"), "");

    fireLoad(frame);
    // La demande de zoom faite avant `load` doit être appliquée dès que
    // l'iframe est prête, pas perdue.
    assert.equal(view.zoomMode, "manual");
    assert.equal(
      frame.contentDocument.documentElement.style.getPropertyValue("--feuillets-preview-scale"),
      String(view.zoomScale)
    );
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : +, − et 100 % pilotent réellement la variable CSS posée dans iframe.contentDocument", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, frame } = await openView();
    fireLoad(frame); // iframe prête : mode fit-width appliqué automatiquement

    const cssVar = () => frame.contentDocument.documentElement.style.getPropertyValue("--feuillets-preview-scale");
    const zoomLabel = view.zoomLabelEl;

    runMenuItem(zoomLabel, "150 %");
    assert.equal(view.zoomScale, 1.5);
    assert.equal(view.zoomMode, "manual");
    assert.equal(cssVar(), "1.5");
    assert.equal(zoomLabel.textContent, "150 %");

    runMenuItem(zoomLabel, "75 %");
    assert.equal(view.zoomScale, 0.75);
    assert.equal(cssVar(), "0.75");
    assert.equal(zoomLabel.textContent, "75 %");

    runMenuItem(zoomLabel, "100 %");
    assert.equal(view.zoomScale, 1);
    assert.equal(view.zoomMode, "manual");
    assert.equal(cssVar(), "1");
    assert.equal(zoomLabel.textContent, "100 %");

    // Le palier courant est coché dans le menu — l'état est lisible sans
    // aucun fond coloré.
    const menu = openMenuVia(zoomLabel);
    assert.equal(menuItem(menu, "100 %").checked, true);
    assert.equal(menuItem(menu, "150 %").checked, false);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : le zoom est borné entre 0.4 et 2", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, frame } = await openView();
    fireLoad(frame);
    view.setZoom(10, "manual");
    assert.equal(view.zoomScale, 2);
    view.setZoom(-5, "manual");
    assert.equal(view.zoomScale, 0.4);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la hauteur/largeur de l'iframe suivent naturalPagesHeight/naturalPageWidth * scale (défilement jusqu'à la dernière page)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, frame } = await openView();
    fireLoad(frame);

    view.setZoom(1, "manual");
    assert.equal(frame.style.width, `${Math.round(view.naturalPageWidth * 1)}px`);
    assert.equal(frame.style.height, `${Math.round(view.naturalPagesHeight * 1)}px`);

    // transform: scale() ne modifie pas le flux — sans ce redimensionnement
    // explicite de l'iframe elle-même, le viewport ne pourrait pas défiler
    // jusqu'à la dernière page une fois zoomé.
    view.setZoom(0.5, "manual");
    assert.equal(frame.style.width, `${Math.round(view.naturalPageWidth * 0.5)}px`);
    assert.equal(frame.style.height, `${Math.round(view.naturalPagesHeight * 0.5)}px`);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la largeur/hauteur d'ajustement se calcule sur .feuillets-preview-viewport.clientWidth, jamais window.innerWidth", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, frame } = await openView();
    fireLoad(frame);

    // window n'a délibérément ni innerWidth ni innerHeight dans ce test —
    // si le calcul les lisait, il lèverait ou produirait NaN.
    viewport.clientWidth = 620;
    runMenuItem(view.zoomLabelEl, "Ajuster à la largeur");

    assert.equal(view.zoomScale, expectedFitWidthScale(620));
    assert.equal(view.zoomMode, "fit-width");
    assert.equal(
      frame.contentDocument.documentElement.style.getPropertyValue("--feuillets-preview-scale"),
      String(view.zoomScale)
    );
    // Garantie « aucune barre horizontale » : la page mise à l'échelle doit
    // tenir dans la largeur de contenu réelle du volet (padding déduit).
    const contentWidth = 620 - 2 * VIEWPORT_PADDING;
    assert.ok(
      view.naturalPageWidth * view.zoomScale <= contentWidth,
      "en fit-width la page ne doit jamais dépasser la largeur de contenu du volet"
    );
    assert.equal(viewport.classes.has("is-manual-zoom"), false, "pas de défilement horizontal en mode automatique");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : ResizeObserver observe uniquement .feuillets-preview-viewport, recalcule en mode auto, laisse le mode manuel intact", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, frame } = await openView();
    fireLoad(frame);

    assert.equal(dom.observers.length, 1);
    assert.deepEqual(dom.observers[0].observed, [viewport]);

    // Mode automatique : un redimensionnement du viewport doit recalculer.
    viewport.clientWidth = 400;
    dom.observers[0].trigger();
    const scaleAfterResizeAuto = view.zoomScale;
    assert.equal(view.zoomMode, "fit-width");
    assert.ok(scaleAfterResizeAuto < 1, "une largeur réduite doit donner un zoom plus petit");

    // Mode manuel : un redimensionnement ne doit PAS changer le zoom.
    runMenuItem(view.zoomLabelEl, "100 %");
    assert.equal(view.zoomScale, 1);
    viewport.clientWidth = 200;
    dom.observers[0].trigger();
    assert.equal(view.zoomScale, 1, "le mode manuel ne doit pas être écrasé par un redimensionnement");
    assert.equal(view.zoomMode, "manual");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});


// ============================================================================
// Sous-lot B — actualisation automatique sans perte de position
// ============================================================================

/** Position à l'écran du viewport dans le fixture (valeur arbitraire : le
 *  calcul d'ancrage ne doit dépendre que de l'ÉCART entre l'iframe et le
 *  viewport, jamais d'une coordonnée absolue). */
const VIEWPORT_SCREEN_TOP = 100;

/** Place une iframe dans le repère du viewport : juste sous son padding
 *  haut, et solidaire de son défilement. */
function placeFrame(frame, viewport) {
  frame._scroller = viewport;
  frame._rectTop = VIEWPORT_SCREEN_TOP + VIEWPORT_PADDING;
  return frame;
}

/** Ouvre la vue, charge la première iframe et met en place une géométrie
 *  connue, pour pouvoir vérifier ensuite la restauration de position. */
async function openLoadedView(mode = "manuscript") {
  const ctx = await openView(mode);
  ctx.viewport._rectTop = VIEWPORT_SCREEN_TOP;
  placeFrame(ctx.frame, ctx.viewport);
  fireLoad(ctx.frame);
  return ctx;
}

/** Laisse la boucle d'événements vider entièrement sa file de microtâches —
 *  nécessaire quand une action est déclenchée en « fire-and-forget » (clic
 *  sur un bouton) et qu'on ne dispose pas de sa promesse. */
function flush() {
  // globalThis.setTimeout : le vrai minuteur de Node, distinct du
  // window.setTimeout stubé (qui, lui, sert à contrôler le debounce).
  return new Promise((resolve) => { globalThis.setTimeout(resolve, 0); });
}

test("PreviewView : une exception après collectSource() ne bloque plus refreshInFlight — un nouveau rafraîchissement reste possible", withRender(async () => {
  const { view, scaledContainer, viewport } = await openLoadedView("manuscript");

  // Simule un échec plus tard dans le pipeline (gabarit, pagination, montage
  // de l'iframe…) — tout ce qui n'était PAS déjà protégé par le try/catch
  // autour de collectSource(). Avant le correctif, une telle exception
  // sortait de refreshPreview() sans jamais appeler finish() : refreshInFlight
  // restait bloqué à true et plus aucun rafraîchissement, bouton compris,
  // ne pouvait plus jamais rien faire tant que la vue n'était pas rouverte.
  const originalRender = view.renderPreviewSource.bind(view);
  view.renderPreviewSource = async () => { throw new Error("échec simulé du pipeline de rendu"); };

  await view.refreshPreview();
  assert.equal(view.statusEl.textContent, "Erreur", "l'échec est signalé, pas silencieux");
  assert.equal(view["refreshInFlight"], false, "refreshInFlight ne doit jamais rester bloqué après une exception");

  // Rétablit un pipeline fonctionnel et vérifie qu'un nouveau rafraîchissement
  // — celui que ferait le bouton Actualiser — produit bien un rendu, au lieu
  // d'être avalé silencieusement par un refreshInFlight resté coincé.
  view.renderPreviewSource = originalRender;
  await view.refreshPreview();
  fireLoad(placeFrame(latestFrame(scaledContainer), viewport));
  assert.equal(view.statusEl.textContent, "Manuscrit à jour", "le rafraîchissement suivant fonctionne de nouveau");
}));

test("PreviewView : un rendu obsolète ne remplace jamais un rendu plus récent", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, scaledContainer } = await openLoadedView();
    const displayed = view.previewFrame;

    // Deux actualisations concurrentes ; la seconde termine sa compilation
    // en premier et devient la référence.
    const first = view.refreshPreview();
    const second = view.refreshPreview();
    await Promise.all([first, second]);

    const frames = scaledContainer.children.filter((c) => c.tagName === "IFRAME");
    const newest = frames[frames.length - 1];

    // Le `load` de l'ANCIENNE génération arrive en retard : il doit être
    // ignoré, et son iframe retirée sans jamais s'afficher.
    const stale = frames.find((f) => f !== newest && f !== displayed);
    if (stale) {
      fireLoad(stale);
      assert.notEqual(view.previewFrame, stale, "un rendu périmé ne doit jamais s'afficher");
    }

    fireLoad(newest);
    assert.equal(view.previewFrame, newest, "seul le rendu le plus récent s'affiche");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : l'actualisation conserve zoom et mode, et ne vide jamais la zone défilable", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, scaledContainer } = await openLoadedView();

    view.setZoom(0.8, "manual");
    const zoomBefore = view.zoomScale;
    const modeBefore = view.zoomMode;
    const oldFrame = view.previewFrame;
    viewport.scrollTop = 500;

    await view.refreshPreview();

    /* Pendant le chargement de la nouvelle iframe, l'ANCIENNE reste montée :
       c'est ce qui empêche la hauteur défilable de s'effondrer, donc le
       navigateur de borner scrollTop à 0 — la cause du retour en haut. */
    assert.ok(
      scaledContainer.children.includes(oldFrame),
      "l'ancienne iframe doit rester en place tant que la nouvelle n'est pas prête"
    );
    assert.equal(viewport.scrollTop, 500, "le défilement ne doit pas être remis à zéro pendant le rechargement");

    const newFrame = placeFrame(latestFrame(scaledContainer), viewport);
    fireLoad(newFrame);

    assert.equal(view.previewFrame, newFrame, "la nouvelle iframe prend le relais après son chargement");
    assert.equal(scaledContainer.children.includes(oldFrame), false, "l'ancienne iframe est retirée après l'échange");
    assert.equal(view.zoomScale, zoomBefore, "le zoom est conservé");
    assert.equal(view.zoomMode, modeBefore, "le mode est conservé");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la position de lecture est restaurée via pageIndex + pageProgress", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, scaledContainer } = await openLoadedView();
    view.setZoom(1, "manual");

    const stackTop = VIEWPORT_PADDING; // frame._rectTop - viewport._rectTop
    // Milieu de la 2e page (index 1), à l'échelle 1.
    const page1Top = stackTop + (PAGE_H + PAGE_GAP);
    viewport.scrollTop = page1Top + 0.5 * PAGE_H;

    await view.refreshPreview();
    const newFrame = placeFrame(latestFrame(scaledContainer), viewport);
    fireLoad(newFrame);

    // Même zoom, même pagination : on doit retomber exactement au même point,
    // et surtout PAS en haut.
    assert.equal(viewport.scrollTop, page1Top + 0.5 * PAGE_H);
    assert.ok(viewport.scrollTop > 0, "la vue ne doit jamais remonter au début");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la position suit le changement de zoom (scrollTop brut ne suffirait pas)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, scaledContainer } = await openLoadedView();
    view.setZoom(1, "manual");

    const stackTop = VIEWPORT_PADDING;
    viewport.scrollTop = stackTop + (PAGE_H + PAGE_GAP) + 0.5 * PAGE_H; // milieu page 2

    // Le zoom change entre la capture et la restauration : un scrollTop brut
    // pointerait alors sur une tout autre page.
    await view.refreshPreview();
    view.setZoom(0.5, "manual");
    const newFrame = placeFrame(latestFrame(scaledContainer), viewport);
    fireLoad(newFrame);

    const expected = stackTop + (PAGE_H + PAGE_GAP) * 0.5 + 0.5 * PAGE_H * 0.5;
    assert.equal(viewport.scrollTop, expected, "la position doit être recalculée avec le nouveau facteur");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : l'index de page est borné si le manuscrit compte moins de pages qu'avant", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, scaledContainer } = await openLoadedView();
    view.setZoom(1, "manual");

    const doc = view.previewFrame.contentDocument;
    const pageCount = doc.querySelectorAll(".pdf-page").length;
    assert.ok(pageCount >= 2, "le manuscrit de test doit compter plusieurs pages");

    // Lecture sur la DERNIÈRE page.
    const stackTop = VIEWPORT_PADDING;
    viewport.scrollTop = stackTop + (pageCount - 1) * (PAGE_H + PAGE_GAP);

    await view.refreshPreview();

    // Le nouveau rendu ne contient plus qu'une seule page (texte raccourci).
    const newFrame = placeFrame(latestFrame(scaledContainer), viewport);
    // Le nouveau rendu ne contient plus qu'UNE page (le texte a raccourci).
    newFrame._contentDocument = buildFakeIframeDocument('<div class="pdf-page"></div>');
    fireLoad(newFrame);

    // Sans bornage, on viserait une page inexistante ; on doit se replacer
    // sur la dernière page réellement présente, jamais au-delà.
    assert.equal(viewport.scrollTop, stackTop, "repli sur la dernière page existante");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("PreviewView : la fermeture nettoie les rafraîchissements différés", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, app } = await openLoadedView();

    /* Écoutes enregistrées via registerEvent (Obsidian les désabonne à la
       fermeture) : modify (rafraîchissement) + editor-change (mode
       after-idle) + file-open et active-leaf-change (suivi du curseur). */
    /* Le rafraîchissement est piloté par editor-change, jamais par une
       écoute vault distincte. */
    assert.equal(app.vaultListenerCount(), 0, "aucune écoute vault.modify ne doit subsister");
    assert.equal(app.workspaceListenerCount("editor-change"), 1);
    assert.equal(app.workspaceListenerCount("file-open"), 1);
    assert.equal(app.workspaceListenerCount("active-leaf-change"), 1);
    assert.equal(view._registeredEvents.length, 3);

    await view.onClose();
    assert.equal(dom.observers[0].observed.length, 0, "le ResizeObserver doit être déconnecté");
    assert.equal(dom.pendingTimers(), 0, "aucun rafraîchissement différé ne doit survivre à la fermeture");
    assert.equal(view.previewFrame, null);
    assert.equal(view.previewViewport, null);
    assert.equal(view.btnSettings, null);
    assert.equal(view.openVisibleEl, null);
    assert.equal(view.btnBarToggle, null);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});


// ============================================================================
// Chantier « Simplification » : barre conforme, plus de réglages dupliqués,
// trois modes Scène / Chapitre / Manuscrit, aucune compilation automatique.
// ============================================================================

/** Compte les appels réels à compile() en observant l'écriture du manuscrit
 *  compilé — c'est compile() (et lui seul) qui écrit Manuscrit.md. */
function countCompiles(app) {
  let n = 0;
  const realCreate = app.vault.create;
  const realModify = app.vault.modify;
  app.vault.create = async (...args) => { n++; return realCreate(...args); };
  app.vault.modify = async (...args) => { n++; return realModify(...args); };
  return () => n;
}

test("barre — fil d'Ariane, Ouvrir ce feuillet, zoom, Export et Réglages seulement", withRender(async () => {
  const { view, toolbar } = await openLoadedView("manuscript");

  const chips = toolbar.children.filter((c) => c.classes.has("feuillets-preview-chip"));
  assert.equal(chips.length, 1, "un seul contrôle de zoom");
  const icons = toolbar.children.filter((c) => c.classes.has("clickable-icon"));
  assert.deepEqual(
    icons.map((icon) => icon.icon),
    ["file-edit", "download", "settings"],
    "trois icônes Obsidian : Ouvrir ce feuillet, Export, Réglages — et aucun « ⋯ »"
  );
  assert.equal(view.btnMore, undefined, "le menu ⋯ n'existe plus");
  assert.equal(typeof view.openMoreMenu, "undefined", "son code a disparu avec lui");
  assert.equal(
    icons.some((icon) => icon.icon === "more-horizontal"),
    false,
    "aucune icône ⋯ ne subsiste dans la barre"
  );
  assert.equal(toolbar.children.filter((c) => c.tagName === "BUTTON").length, 4, "le bouton contextuel est présent mais masqué hors Chapitre/Partie");
  assert.equal(view.openVisibleEl.classes.has("is-hidden"), true, "aucun bouton visible en mode Manuscrit");
  assert.equal(view.openVisibleEl.getAttribute("aria-label"), "Ouvrir ce feuillet");
  assert.equal(view.openVisibleEl.textContent, "", "une icône, plus un bouton texte");
  assert.equal(view.btnSettings.getAttribute("aria-label"), "Réglages d’export");

  assert.ok(toolbar.children.some((c) => c.classes.has("feuillets-preview-breadcrumb")));
  assert.equal(view.zoomLabelEl.textContent, `${Math.round(view.zoomScale * 100)} %`);
  assert.equal(toolbar.children.filter((c) => c.tagName === "SELECT").length, 0, "aucun réglage visible");

  // Aucun contrôle de zoom séparé ne subsiste dans la barre.
  for (const gone of ["Zoom avant (+10 %)", "Zoom arrière (-10 %)", "Taille réelle (100 %)", "Ajuster à la largeur", "Page entière"]) {
    assert.equal(
      toolbar.children.some((c) => c.getAttribute("aria-label") === gone),
      false,
      `« ${gone} » ne doit plus occuper la barre`
    );
  }
  // Ni séparateurs, ni barre du bas : il n'y a plus de groupes à séparer.
  assert.equal(toolbar.children.filter((c) => c.classes.has("feuillets-bar-sep")).length, 0);
  assert.equal(view.contentEl.querySelector(".feuillets-preview-stylebar"), null);

  assert.equal(view.btnBarToggle, null, "aucun ancien bouton séparé");
}));

test("réglages — aucun panneau dupliqué ; l'icône ouvre directement l'onglet Export central", withRender(async () => {
  const { view } = await openLoadedView("manuscript");

  // Le panneau local a disparu, avec sa seconde source de vérité.
  assert.equal(view.contentEl.querySelector(".feuillets-preview-settings"), null);
  assert.equal(typeof view.renderSettingsPanel, "undefined");
  assert.equal(typeof view.settingsPanel, "undefined");

  let settingsOpened = 0;
  let selectedTab = null;
  let rendered = 0;
  const settingsTab = { _activeSettingsTab: "Projet", refreshForExternalCallers: () => { rendered++; } };
  view.app.setting = {
    open: () => { settingsOpened++; },
    openTabById: (id) => { selectedTab = id; },
    activeTab: settingsTab,
  };
  assert.equal(view.btnSettings.icon, "settings");
  view.btnSettings.click();
  await flush();
  assert.equal(settingsOpened, 1);
  assert.equal(selectedTab, "feuillets", "doit ouvrir les paramètres Feuillets, pas une vue locale");
  assert.equal(settingsTab._activeSettingsTab, "Export", "l'onglet Export est sélectionné sans étape intermédiaire");
  assert.equal(rendered, 1, "l'instance déjà ouverte est réaffichée, jamais dupliquée");
  assert.equal(typeof view.app.workspace.getRightLeaf, "function", "aucune feuille latérale n'est créée");
  assert.equal(view.contentEl.querySelectorAll("dialog").length, 0, "aucun modal intermédiaire");
}));

test("mode Scène — rend le feuillet actif SANS jamais appeler compile()", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  const rendered = [];
  MarkdownRenderer.render = async (_app, markdown, container) => {
    rendered.push(markdown);
    fakeRender(markdown, container);
  };
  try {
    const { view, app, scaledContainer, viewport } = await openView("scene");
    const compiles = countCompiles(app);

    fireLoad(placeFrame(latestFrame(scaledContainer), viewport));

    // Le markdown rendu est celui du feuillet actif, pas un manuscrit compilé.
    assert.ok(rendered.some((m) => m.includes("Texte réel de la scène")));
    assert.equal(compiles(), 0, "le mode Scène ne doit JAMAIS écrire Manuscrit.md");
    assert.equal(view.displayedPath, "Manuscrit/Chapitre 1/01-scene.md");
    assert.match(view.getDisplayText(), /01-scene/);
    assert.equal(view.statusEl.textContent, "Feuillet à jour");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("mode Scène — la frappe déclenche UN rendu après une courte pause, sans compiler", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, app, scaledContainer, viewport } = await openView("scene");
    fireLoad(placeFrame(latestFrame(scaledContainer), viewport));
    const compiles = countCompiles(app);
    const generationBefore = view.refreshGeneration;

    app.emitWorkspace("editor-change");
    app.emitWorkspace("editor-change");
    app.emitWorkspace("editor-change");
    assert.equal(dom.pendingTimers(), 1, "trois frappes ne laissent qu'un seul rendu programmé");
    assert.equal(view.statusEl.textContent, "Feuillet à actualiser");

    dom.runTimers();
    await flush();
    assert.equal(view.refreshGeneration, generationBefore + 1, "un seul rendu");
    assert.equal(compiles(), 0, "toujours aucune compilation");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("mode Scène — changer de feuillet actif met à jour l'aperçu ; un fichier hors projet est signalé", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, app, scaledContainer, viewport, sceneFile2 } = await openView("scene");
    fireLoad(placeFrame(latestFrame(scaledContainer), viewport));

    app.setActiveFile(sceneFile2);
    app.emitWorkspace("file-open");
    await flush();
    await flush();
    fireLoad(placeFrame(latestFrame(scaledContainer), viewport));
    assert.equal(view.displayedPath, "Manuscrit/Chapitre 1/02-scene.md");

    // Fichier hors projet : état clair, pas de rendu fantôme.
    app.setActiveFile({ path: "Ailleurs/note.md" });
    app.emitWorkspace("file-open");
    await flush();
    await flush();
    const empty = view.contentEl.querySelector(".feuillets-preview-empty");
    assert.ok(empty, "un fichier hors projet doit produire un état explicite");
    assert.match(empty.textContent, /Aucun feuillet du projet/);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("mode Chapitre — assemble les scènes dans l'ordre du Binder, sans compiler", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  const rendered = [];
  MarkdownRenderer.render = async (_app, markdown, container) => {
    rendered.push(markdown);
    fakeRender(markdown, container);
  };
  try {
    const { view, app, chapterDir } = await openView("chapter");
    const compiles = countCompiles(app);

    // Les deux scènes du chapitre, dans l'ordre.
    const last = rendered[rendered.length - 1];
    const i1 = last.indexOf("Texte réel de la scène");
    const i2 = last.indexOf("Seconde scène du chapitre");
    assert.ok(i1 >= 0 && i2 >= 0, "les deux scènes du chapitre doivent être rendues");
    assert.ok(i1 < i2, "l'ordre du Binder doit être respecté");
    assert.equal(compiles(), 0, "le mode Chapitre ne compile pas le manuscrit");
    assert.equal(view.displayedPath, chapterDir.path);

    // La frappe est regroupée, mais reste sur le pipeline léger du chapitre.
    app.emitWorkspace("editor-change");
    assert.equal(dom.pendingTimers(), 1, "un seul rendu différé est programmé");
    dom.runTimers();
    await flush();
    assert.equal(compiles(), 0, "le mode Chapitre ne compile toujours pas le manuscrit");
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("mode Manuscrit — la frappe déclenche une seule compilation différée", withRender(async (dom) => {
  const { view, app, scaledContainer, viewport } = await openLoadedView("manuscript");
  /* Depuis que l'Aperçu compile en mémoire ({ writeOutput: false }), le
     manuscrit ne passe plus par vault.create/modify — compter ces appels ne
     détecterait plus la compilation. On compte donc les RENDUS, la vraie
     trace d'une recompilation effective. */
  const originalRender = view.renderPreviewSource.bind(view);
  let renders = 0;
  view.renderPreviewSource = async (source, gen, anchor, finish) => {
    renders++;
    return originalRender(source, gen, anchor, finish);
  };
  const rendersBefore = renders;

  // Les frappes successives sont regroupées.
  app.emitWorkspace("editor-change");
  app.emitWorkspace("editor-change");
  app.emitWorkspace("editor-change");
  assert.equal(dom.pendingTimers(), 1, "une seule compilation est programmée");
  dom.runTimers();
  await flush();
  assert.ok(renders > rendersBefore, "le manuscrit est recompilé après le délai");
  fireLoad(placeFrame(latestFrame(scaledContainer), viewport));
  assert.equal(view.statusEl.textContent, "Manuscrit à jour");
}));

test("modes — la portée s'AFFICHE dans Export mais ne s'y change plus (seul le fil d'Ariane la modifie)", withRender(async () => {
  const { view } = await openLoadedView("manuscript");

  view.btnExport.click();
  await flush();
  const label = view.exportPanelEl.querySelector('[aria-label="Portée de l’export"]');
  assert.ok(label, "le libellé de portée est affiché");
  assert.equal(label.textContent, "Manuscrit");
  /* Plus aucun select capable de changer la portée depuis le panneau */
  assert.equal(
    view.exportPanelEl.querySelectorAll('select[aria-label="Portée de l’export"]').length,
    0,
    "la portée n'est pas un select dans Export"
  );
}));

test("suivi de scène — défile vers le feuillet actif en mode Manuscrit, sans bouger si déjà visible", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    for (const block of markdown.split(/\n\n+/)) container.appendChild(element("p", block));
  };
  try {
    const { view, viewport, sceneFile } = await openLoadedView("manuscript");
    view.setZoom(1, "manual");
    const doc = view.previewFrame.contentDocument;
    const target = doc.querySelectorAll(`[data-source-path="${sceneFile.path}"]`)[0];
    assert.ok(target, "le repère de source doit exister dans le rendu compilé");
    target.offsetTop = 900;
    view.app.setActiveFile(sceneFile);

    // 1. Cible loin : on défile.
    viewport.scrollTop = 0;
    view.syncToActiveScene();
    assert.ok(viewport.scrollTop > 0, "l'aperçu doit défiler jusqu'à la scène active");

    // 2. Cible déjà visible : aucun mouvement.
    const settled = VIEWPORT_PADDING + 900 - 50;
    viewport.scrollTop = settled;
    view.syncToActiveScene();
    assert.equal(viewport.scrollTop, settled);

    // Le recentrage manuel a été retiré : la lecture reste libre.
    assert.equal(view.contentEl.querySelectorAll(`[aria-label="${CENTER_LABEL}"]`).length, 0);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("suivi de scène — sans effet en mode Scène (l'aperçu EST déjà la scène active)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
  try {
    const { view, viewport, scaledContainer } = await openView("scene");
    fireLoad(placeFrame(latestFrame(scaledContainer), viewport));
    viewport.scrollTop = 42;
    view.syncToActiveScene();
    assert.equal(viewport.scrollTop, 42);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

// ============================================================================
// Quatre défauts confirmés manuellement : menu contextuel du Binder,
// chapitre sous une Partie, bouton de centrage, styles de gabarit.
// ============================================================================

/** Construit un projet Partie -> Chapitre -> Scène (deux parties contenant
 *  chacune un chapitre PORTANT LE MÊME NOM, pour vérifier qu'on ne les
 *  confond pas), avec des chemins comportant espaces et accents. */
function buildNestedProject() {
  let activeFile = null;
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";
  root.children = [];

  const make = (parent, path, name) => {
    const f = new TFolder(path);
    f.path = path;
    f.name = name;
    f.parent = parent;
    f.children = [];
    parent.children.push(f);
    return f;
  };
  const file = (parent, path, name, content) => {
    const f = new TFile(path, content);
    f.path = path;
    f.name = name;
    f.basename = name.replace(/\.md$/, "");
    f.extension = "md";
    f.parent = parent;
    parent.children.push(f);
    return f;
  };

  const p1 = make(root, "Roman/Manuscrit/Première partie", "Première partie");
  const p2 = make(root, "Roman/Manuscrit/Deuxième partie", "Deuxième partie");
  // MÊME nom de chapitre dans les deux parties.
  const c1 = make(p1, "Roman/Manuscrit/Première partie/Chapitre premier", "Chapitre premier");
  const c2 = make(p2, "Roman/Manuscrit/Deuxième partie/Chapitre premier", "Chapitre premier");
  const s1a = file(c1, "Roman/Manuscrit/Première partie/Chapitre premier/01 Été.md", "01 Été.md", "Scène A de la première partie.");
  const s1b = file(c1, "Roman/Manuscrit/Première partie/Chapitre premier/02 Hiver.md", "02 Hiver.md", "Scène B de la première partie.");
  const s2a = file(c2, "Roman/Manuscrit/Deuxième partie/Chapitre premier/01 Écho.md", "01 Écho.md", "Scène de la deuxième partie.");
  // Deuxième chapitre de la première partie : c'est ce qui distingue le mode
  // Partie du mode Chapitre — sans lui, les deux montreraient la même chose.
  const c1b = make(p1, "Roman/Manuscrit/Première partie/Chapitre second", "Chapitre second");
  const s1c = file(c1b, "Roman/Manuscrit/Première partie/Chapitre second/03 Printemps.md", "03 Printemps.md", "---\ntitle: Printemps\nstatus: brouillon\n---\nScène C, second chapitre.");
  const orphan = file(root, "Roman/Manuscrit/Note libre.md", "Note libre.md", "Hors chapitre.");

  /* Résolution RÉELLE des chemins : `roleOfFolder`, `depthOf` et
     `isFrontMatter` passent tous par getProjectFolder(app, settings), qui lit
     la racine DANS LE COFFRE. Sans cette table, la racine vaut null et tous
     les dossiers seraient classés « partie ». */
  const nodes = new Map();
  const index = (node) => {
    nodes.set(node.path, node);
    for (const child of node.children || []) index(child);
  };
  index(root);

  const app = {
    vault: {
      cachedRead: async (f) => (f && typeof f.content === "string" ? f.content : ""),
      read: async (f) => (f && typeof f.content === "string" ? f.content : ""),
      create: async () => {},
      modify: async () => {},
      createFolder: async () => {},
      on: () => ({}),
      getAbstractFileByPath: (path) => nodes.get(path) || null,
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: {
      on: () => ({}),
      getActiveFile: () => activeFile,
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
      getRightLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
  };
  app.setActiveFile = (f) => { activeFile = f; };
  // Structure à parties : les dossiers de niveau 1 sont des PARTIES.
  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    previewMode: "chapter",
    // Valeurs par défaut réelles du preset (voir DEFAULT_SETTINGS) : ce sont
    // elles qui décident si un titre de chapitre est inséré.
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
  };
  return { app, settings, root, p1, p2, c1, c1b, c2, s1a, s1b, s1c, s2a, orphan };
}

function nestedView() {
  const { app, settings, root, ...rest } = buildNestedProject();
  const view = new PreviewView({ contentEl: element("div") }, { settings, getProjectFolder: () => root, saveSettings: async () => {} });
  view.app = app;
  return { view, app, settings, root, ...rest };
}

test("chapitre — Partie → Chapitre → Scène : c'est le CHAPITRE qui est retenu, jamais la Partie", () => {
  const { view, c1, c2, s1a, s2a } = nestedView();
  assert.equal(view.chapterFolderOf(s1a)?.path, c1.path);
  /* Deux parties contiennent un « Chapitre premier » : le bon doit être
     retenu, celui qui contient réellement la scène. */
  assert.equal(view.chapterFolderOf(s2a)?.path, c2.path);
  assert.notEqual(view.chapterFolderOf(s1a)?.path, view.chapterFolderOf(s2a)?.path);
});

test("chapitre — Chapitre → Scène (projet plat), y compris configuré en « parties »", () => {
  const { app, settings, manuscript, chapterDir, sceneFile } = buildProject();
  const view = new PreviewView({ contentEl: element("div") }, { settings, getProjectFolder: () => manuscript, saveSettings: async () => {} });
  view.app = app;

  settings.level1Role = "chapitres";
  assert.equal(view.chapterFolderOf(sceneFile)?.path, chapterDir.path);

  /* Même arborescence déclarée en « parties » : ce dossier est une Partie,
     pas un Chapitre artificiel. */
  settings.level1Role = "parties";
  assert.equal(view.chapterFolderOf(sceneFile), null);
});

test("chapitre — un feuillet à la racine du projet n'appartient à aucun chapitre", () => {
  const { view, orphan } = nestedView();
  assert.equal(view.chapterFolderOf(orphan), null);
  assert.equal(view.chapterFolderOf(null), null);
});

test("chapitre — les scènes sont assemblées dans l'ordre du Binder", () => {
  const { view, c1, s1a, s1b } = nestedView();
  const scenes = view.orderedScenesOf(c1);
  assert.deepEqual(scenes.map((f) => f.path), [s1a.path, s1b.path]);
});

test("menu — le zoom est le seul menu restant de la barre", withRender(async () => {
  const { view, toolbar } = await openLoadedView("manuscript");
  const titles = menuTitles(openMenuVia(view.zoomLabelEl));
  assert.deepEqual(titles.slice(0, 2), ["Ajuster à la largeur", "Afficher la page entière"]);
  assert.equal(titles.includes(CENTER_LABEL), false);
  assert.equal(titles.includes(SYNC_LABEL), false, "la synchronisation découle désormais de la portée Feuillet");
  assert.equal(titles.includes("Réglages du manuscrit"), false, "les réglages ont leur propre icône");

  // Aucun autre contrôle de la barre n'ouvre de menu.
  for (const btn of [view.btnExport, view.btnSettings, view.openVisibleEl]) {
    Menu.lastShown = null;
    btn.click();
    await flush();
    assert.equal(Menu.lastShown, null, `${btn.getAttribute("aria-label")} agit directement, sans menu`);
  }
  assert.equal(toolbar.children.some((c) => c.icon === "more-horizontal"), false);
}));

test("centrage — chemins avec espaces, accents et sous-dossiers", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    for (const block of markdown.split(/\n\n+/)) container.appendChild(element("p", block));
  };
  try {
    const { view, viewport } = await openLoadedView("manuscript");
    view.setZoom(1, "manual");
    const doc = view.previewFrame.contentDocument;

    // Chemin réaliste : espaces, accents, sous-dossier.
    const tricky = "Manuscrit/Première partie/Chapitre premier/01 Été.md";
    const marked = new (doc.body.constructor)("div");
    marked.setAttribute("data-source-path", tricky);
    marked.offsetTop = 1200;
    doc.querySelectorAll(".feuillets-preview-pages")[0].appendChild(marked);

    view.app.setActiveFile({ path: tricky, extension: "md" });
    Object.setPrototypeOf(view.app.workspace.getActiveFile(), TFile.prototype);

    viewport.scrollTop = 0;
    view.syncToActiveScene();
    assert.ok(viewport.scrollTop > 0, "un chemin accentué doit être retrouvé et centré");

    // Déjà visible : aucun mouvement.
    const settled = VIEWPORT_PADDING + 1200 - 40;
    viewport.scrollTop = settled;
    view.syncToActiveScene();
    assert.equal(viewport.scrollTop, settled);
  } finally {
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("suivi Chapitre/Partie — même étendue : ancrage data-source-path ; autre étendue : nouveau rendu", withRender(async () => {
  const { view, app, settings, root, p1, p2, s1a, s1b, s1c, s2a } = nestedView();
  settings.previewMode = "chapter";
  app.setActiveFile(s1a);
  await view.onOpen();
  const viewport = view.previewViewport;
  fireLoad(placeFrame(latestFrame(view.scaledContainer), viewport));

  const chapterGeneration = view.refreshGeneration;
  app.setActiveFile(s1b);
  await view.onActiveFileChanged();
  assert.equal(view.refreshGeneration, chapterGeneration, "une autre scène du même chapitre ne reconstruit pas");

  app.setActiveFile(s1c);
  await view.onActiveFileChanged();
  assert.ok(view.refreshGeneration > chapterGeneration, "un autre chapitre reconstruit l'étendue Chapitre");
  fireLoad(placeFrame(latestFrame(view.scaledContainer), viewport));

  settings.previewMode = "part";
  await view.refreshPreview();
  fireLoad(placeFrame(latestFrame(view.scaledContainer), viewport));
  const partGeneration = view.refreshGeneration;
  app.setActiveFile(s1a);
  await view.onActiveFileChanged();
  assert.equal(view.refreshGeneration, partGeneration, "une scène de la même partie ne reconstruit pas");

  app.setActiveFile(s2a);
  await view.onActiveFileChanged();
  assert.ok(view.refreshGeneration > partGeneration, "une autre partie reconstruit l'étendue Partie");
  fireLoad(placeFrame(latestFrame(view.scaledContainer), viewport));
  assert.equal(view.displayedPath, p2.path);
  assert.match(view.breadcrumbEl.textContent, /Deuxième partie.*01 Écho/);
  assert.ok(root && p1);
}));

/** Extrait du srcdoc les règles de gabarit qui doivent différer d'un modèle
 *  à l'autre — on vérifie le CSS RÉELLEMENT injecté, pas le réglage. */
function templateRulesOf(frame) {
  const src = frame.srcdoc;
  return {
    font: (src.match(/font-family: ([^;]+);/) || [])[1],
    size: (src.match(/font-size: (\d+pt);/) || [])[1],
    indent: (src.match(/text-indent: ([^;]+);/) || [])[1],
    lineHeight: (src.match(/line-height: ([\d.]+);/) || [])[1],
    bodyMargin: (src.match(/margin: (\d+pt [^;]+);/) || [])[1],
    h1: (src.match(/h1 \{ ([^}]+)\}/) || [])[1],
    divider: (src.match(/hr::before \{ content: "([^"]*)"; \}/) || [])[1],
  };
}

for (const mode of ["scene", "chapter", "manuscript"]) {
  test(`gabarit — mode ${mode} : le CSS du modèle est réellement injecté et change avec le modèle`, async () => {
    const dom = installDom();
    const previousRender = MarkdownRenderer.render;
    MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
    try {
      const ctx = await openView(mode);
      const { view, scaledContainer, viewport } = ctx;
      fireLoad(placeFrame(latestFrame(scaledContainer), viewport));

      // --- Gabarit « Classique » -------------------------------------------
      const classique = templateRulesOf(view.previewFrame);
      assert.match(classique.font, /Times New Roman/);
      assert.equal(classique.size, "12pt");
      assert.equal(classique.lineHeight, "2");
      assert.equal(classique.indent, "1.5em");
      assert.equal(classique.bodyMargin, "71pt 71pt 71pt 71pt");
      assert.match(classique.h1, /page-break-before: always/);
      assert.equal(classique.divider, "* * *");

      // --- Bascule vers un gabarit très différent --------------------------
      view.plugin.settings.exportTemplate = "romanFrancais";
      await view.refreshPreview();
      fireLoad(placeFrame(latestFrame(scaledContainer), viewport));

      const roman = templateRulesOf(view.previewFrame);
      assert.match(roman.font, /Garamond/, "la police doit suivre le gabarit");
      assert.equal(roman.size, "11pt", "la taille doit suivre le gabarit");
      assert.equal(roman.indent, "10pt", "le retrait doit suivre le gabarit");
      assert.equal(roman.bodyMargin, "43pt 57pt 43pt 57pt", "les marges doivent suivre le gabarit");
      assert.match(roman.h1, /Helvetica Neue/, "la police de titre doit suivre le gabarit");
      assert.match(roman.h1, /font-size: 34pt/, "le style de titre doit suivre le gabarit");
      assert.equal(roman.divider, "***", "le séparateur de scène doit suivre le gabarit");

      // Et rien de tout cela ne doit être identique au gabarit précédent.
      assert.notEqual(roman.font, classique.font);
      assert.notEqual(roman.divider, classique.divider);
    } finally {
      MarkdownRenderer.render = previousRender;
      dom.restore();
    }
  });
}

/* ======================================================================
   Sous-lots A à D et F — défilement synchronisé et zoom au trackpad.

   Ces tests simulent de VRAIS événements (`scroll`, `wheel`) sur les VRAIS
   éléments défilables, et vérifient des `scrollTop` réels : c'est la seule
   façon d'attraper une boucle de défilement ou un écouteur resté branché.
   ====================================================================== */

/** Ouvre la vue avec un aperçu chargé ET un éditeur Markdown à côté, comme
 *  dans l'usage réel (écriture à gauche, page à droite). */
async function openWithEditor(mode, { previewScrollHeight = 3000, editorScrollHeight = 4000 } = {}) {
  const ctx = await openLoadedView(mode);
  ctx.viewport.scrollHeight = previewScrollHeight; // clientHeight = 700
  ctx.editor = ctx.app.openMarkdownPane(ctx.sceneFile, { scrollHeight: editorScrollHeight, clientHeight: 600 });
  ctx.app.emitWorkspace("active-leaf-change");
  return ctx;
}

function withRender(fn) {
  return async () => {
    const dom = installDom();
    const previousRender = MarkdownRenderer.render;
    MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);
    try {
      await fn(dom);
    } finally {
      MarkdownRenderer.render = previousRender;
      dom.restore();
    }
  };
}

/** Variante indispensable aux tests de section : un rendu bloc par bloc,
 *  seul cas où les paragraphes-marqueurs de preview-source-map.ts existent
 *  réellement dans le DOM, donc où les `data-source-path` sont posés. */
function withBlockRender(fn) {
  return async () => {
    const dom = installDom();
    const previousRender = MarkdownRenderer.render;
    MarkdownRenderer.render = async (_app, markdown, container) => {
      for (const block of markdown.split(/\n\n+/)) container.appendChild(element("p", block));
    };
    try {
      await fn(dom);
    } finally {
      MarkdownRenderer.render = previousRender;
      dom.restore();
    }
  };
}

test("sync — le défilement de l'éditeur déplace l'aperçu à la même progression", withRender(async (dom) => {
  const { view, viewport, editor } = await openWithEditor("scene");
  assert.equal(view.syncScroller, editor, "la vue doit suivre le .cm-scroller de la feuille active");

  // 1700 / (4000 - 600) = 50 %  ->  0,5 * (3000 - 700) = 1150
  editor.scrollTop = 1700;
  editor.dispatch("scroll");
  editor.dispatch("scroll");
  editor.dispatch("scroll");
  assert.equal(dom.pendingTimers(), 1, "trois événements, UN seul recalcul programmé (une frame)");

  dom.runTimers();
  assert.equal(viewport.scrollTop, 1150);

  // Bas de l'éditeur -> bas de l'aperçu, sans jamais dépasser.
  editor.scrollTop = 99999;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 2300);

  // Haut de l'éditeur -> haut de l'aperçu.
  editor.scrollTop = -50;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 0);
}));

test("sync — aucune boucle : un défilement programmatique n'en déclenche pas un en retour", withRender(async (dom) => {
  const { viewport, editor } = await openWithEditor("scene");

  editor.scrollTop = 1700;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 1150);

  /* L'écriture de `scrollTop` produit un vrai événement `scroll` dans le
     navigateur : on le rejoue ici. Il ne doit RIEN reprogrammer, sinon les
     deux panneaux se poursuivent indéfiniment. */
  const pendingBefore = dom.pendingTimers();
  viewport.dispatch("scroll");
  assert.equal(dom.pendingTimers(), pendingBefore, "aucun recalcul en retour");

  dom.runTimers(); // relâche le drapeau
  assert.equal(editor.scrollTop, 1700, "l'éditeur n'a pas bougé");
}));

test("sync — un écart inférieur au seuil ne provoque aucune correction", withRender(async (dom) => {
  const { viewport, editor } = await openWithEditor("scene");
  viewport.scrollTop = 1149; // cible : 1150, soit 1 px d'écart
  editor.scrollTop = 1700;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 1149, "1 px d'écart ne justifie pas de reprendre la main");
}));

test("sync — l'aperçu ramène l'éditeur sur la même zone (sens retour)", withRender(async (dom) => {
  const { viewport, editor } = await openWithEditor("scene");

  // 575 / 2300 = 25 %  ->  0,25 * 3400 = 850
  viewport.scrollTop = 575;
  viewport.dispatch("scroll");
  assert.equal(dom.pendingTimers(), 1);
  dom.runTimers();
  assert.equal(editor.scrollTop, 850);

  // Et l'écho du côté éditeur ne relance rien.
  const pending = dom.pendingTimers();
  editor.dispatch("scroll");
  assert.equal(dom.pendingTimers(), pending);
}));

test("sync — un défilement manuel récent d'un panneau suspend les corrections de l'autre", withRender(async (dom) => {
  const { viewport, editor } = await openWithEditor("scene");

  // L'utilisatrice défile l'aperçu…
  viewport.scrollTop = 575;
  viewport.dispatch("scroll");
  dom.runTimers();
  assert.equal(editor.scrollTop, 850);

  /* …et l'éditeur reçoit alors l'écho : la correction inverse doit être
     suspendue, sinon les deux positions se disputent pendant tout le geste.
     (Le drapeau couvre l'écho immédiat ; la suspension temporelle couvre le
     geste qui continue.) */
  dom.runTimers(); // relâche le drapeau de sens retour
  const previewBefore = viewport.scrollTop;
  editor.scrollTop = 3400;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, previewBefore, "correction suspendue juste après un geste dans l'aperçu");
}));

test("sync — la portée Feuillet seule active le couplage", withRender(async () => {
  const { view, plugin } = await openWithEditor("scene");
  plugin.settings.previewSyncScroll = false; // ancienne préférence ignorée
  assert.equal(view.syncScrollEnabled, true);
  await view.setMode("chapter");
  assert.equal(view.syncScrollEnabled, false);
  await view.setMode("part");
  assert.equal(view.syncScrollEnabled, false);
  await view.setMode("manuscript");
  assert.equal(view.syncScrollEnabled, false);
  await view.setMode("scene");
  assert.equal(view.syncScrollEnabled, true);
}));

test("sync — un fichier hors projet n'est jamais suivi", withRender(async () => {
  const { view, app } = await openLoadedView("scene");
  const outside = new TFile("Ailleurs/note.md", "Hors projet.");
  outside.path = "Ailleurs/note.md";
  outside.extension = "md";

  const foreign = app.openMarkdownPane(outside, { scrollHeight: 4000, clientHeight: 600 });
  app.setActiveFile(outside);
  view.bindSourcePane();

  assert.equal(view.syncScroller, null, "aucun panneau suivi hors du projet");
  assert.equal(view.followedEl.textContent, "Aucun éditeur suivi");
  assert.equal((foreign._eventListeners.get("scroll") || []).length, 0, "aucun écouteur posé");
}));

test("sync — hors mode Feuillet, aucun listener source n'est conservé", withRender(async (dom) => {
  const { view, app, viewport, editor, sceneFile2 } = await openWithEditor("chapter");
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0);

  app.closeMarkdownPanes();
  const second = app.openMarkdownPane(sceneFile2, { scrollHeight: 2000, clientHeight: 600 });
  app.setActiveFile(sceneFile2);
  app.emitWorkspace("active-leaf-change");
  await flush();

  assert.equal(view.syncScroller, null);
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0);
  assert.equal((second._eventListeners.get("scroll") || []).length, 0);
  view.bindSourcePane();
  view.bindSourcePane();
  assert.equal((second._eventListeners.get("scroll") || []).length, 0);

  // L'ancien panneau ne pilote plus rien.
  const before = viewport.scrollTop;
  editor.scrollTop = 3400;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, before);
}));

test("sync — revenir au mode Feuillet rattache un unique listener", withRender(async () => {
  const { view, editor } = await openWithEditor("chapter");
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0);

  await view.setMode("scene");
  assert.equal((editor._eventListeners.get("scroll") || []).length, 1);
  view.bindSourcePane();
  view.bindSourcePane();
  assert.equal((editor._eventListeners.get("scroll") || []).length, 1, "aucune écoute dupliquée");
}));

test("sync — mode Partie : les deux scrolls restent indépendants", withRender(async (dom) => {
  const { view, viewport, editor } = await openWithEditor("scene");
  await view.setMode("part");
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0);

  const previewBefore = viewport.scrollTop = 320;
  editor.scrollTop = 900;
  editor.dispatch("scroll");
  viewport.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, previewBefore);
  assert.equal(editor.scrollTop, 900);
}));

/** Pose des repères de section exploitables sur l'aperçu chargé : deux
 *  scènes de 1000 px dans une pile de 2000 px, à l'échelle 1. */
function markSections(view, viewport) {
  view.setZoom(1, "manual");
  const doc = view.previewFrame.contentDocument;
  const marks = doc.querySelectorAll("[data-source-path]");
  assert.equal(marks.length, 2, "les deux feuillets doivent être repérés dans le rendu");
  marks[0].offsetTop = 0;
  marks[1].offsetTop = 1000;
  view.naturalPagesHeight = 2000;
  viewport.scrollHeight = 4000;
  viewport.clientHeight = 700;
  // frameTopWithinScroll vaut le padding du viewport (20 px).
  return { first: { top: 20, height: 1000 }, second: { top: 1020, height: 1000 } };
}

test("lecture Chapitre — le feuillet visible pilote l'ouverture, sans rendre", withBlockRender(async (dom) => {
  const { view, app, viewport, sceneFile2 } = await openLoadedView("chapter");
  const sections = markSections(view, viewport);
  const opened = [];
  const focused = [];
  app.workspace.getLeaf = () => ({ openFile: async (file, options) => { opened.push({ file, options }); app.setActiveFile(file); } });
  app.workspace.setActiveLeaf = (leaf, options) => { focused.push({ leaf, options }); };

  const generation = view.refreshGeneration;
  view.setZoom(1.25, "manual");
  viewport.scrollTop = sections.second.top + 80;
  viewport.dispatch("scroll");
  assert.equal(dom.pendingTimers(), 1, "un seul calcul visible est planifié par frame");
  dom.runTimers();

  assert.equal(view.visibleFeuilletPath, sceneFile2.path);
  assert.equal(view.openVisibleEl.classes.has("is-hidden"), false, "le bouton est visible en Chapitre");
  assert.doesNotMatch(view.previewFrame.srcdoc, /feuillets-preview-document/,
    "aucun élément de navigation ne modifie le flux paginé du modèle d'export");
  view.openVisibleEl.click();
  await flush();
  assert.equal(opened[0].file, sceneFile2);
  assert.deepEqual(opened[0].options, { active: true });
  assert.equal(app.workspace.getActiveFile(), sceneFile2, "le Feuillet visible devient la source suivie");
  assert.equal(app.settings?.binderSelectedPath ?? view.plugin.settings.binderSelectedPath, sceneFile2.parent.path);
  assert.equal(focused.length, 1, "le focus revient à l'éditeur");
  assert.equal(view.zoomScale, 1.25);
  assert.equal(view.mode, "chapter", "la portée de lecture est conservée");
  assert.equal(view.syncScrollEnabled, true);
  assert.equal(view.refreshGeneration, generation, "l'ouverture n'a pas besoin de reconstruire le chapitre");
}));

for (const mode of ["chapter", "manuscript"]) {
  test(`recentrage — mode ${mode} : la section du feuillet est visée une fois, sans synchronisation continue`, withBlockRender(async (dom) => {
    const { view, app, viewport, sceneFile2 } = await openLoadedView(mode);
    const sections = markSections(view, viewport);

    const editor = app.openMarkdownPane(sceneFile2, { scrollHeight: 2000, clientHeight: 600 });
    app.setActiveFile(sceneFile2);
    app.emitWorkspace("active-leaf-change");
    await flush();

    // Le changement de feuillet cible réellement sa section.
    view.syncToActiveScene(true);
    assert.equal(viewport.scrollTop, sections.second.top - 24);

    // Les scrolls suivants sont libres : aucun aller ni retour n'est calculé.
    const previewBefore = viewport.scrollTop;
    editor.scrollTop = 700;
    editor.dispatch("scroll");
    dom.runTimers();
    assert.equal(viewport.scrollTop, previewBefore);

    viewport.scrollTop = sections.second.top + 300;
    viewport.dispatch("scroll");
    dom.runTimers();
    assert.equal(editor.scrollTop, 700);
  }));
}

test("sync — Scrivening : ignoré hors mode Feuillet", withBlockRender(async (dom) => {
  const { view, app, viewport, sceneFile, sceneFile2 } = await openLoadedView("manuscript");

  const { scroll } = app.openScriveningsPane([sceneFile, sceneFile2], {
    sceneHeight: 1000,
    clientHeight: 600,
  });
  view.bindSourcePane();
  assert.equal(view.syncScroller, null, "aucun suivi continu dans le manuscrit");
  assert.equal(view.followedEl.textContent, "", "aucun faux état de synchronisation");

  const before = viewport.scrollTop;
  scroll.scrollTop = 1200;
  scroll.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, before);
}));

test("sync — aucun rendu ni compilation pendant un défilement", withRender(async (dom) => {
  const { view, app, viewport, editor } = await openWithEditor("manuscript");
  const compiles = countCompiles(app);
  const generation = view.refreshGeneration;

  for (let i = 0; i < 10; i++) {
    editor.scrollTop = i * 300;
    editor.dispatch("scroll");
    dom.runTimers();
  }
  viewport.scrollTop = 400;
  viewport.dispatch("scroll");
  dom.runTimers();

  assert.equal(compiles(), 0, "défiler ne compile JAMAIS");
  assert.equal(view.refreshGeneration, generation, "défiler ne relance aucun rendu");
}));

test("sync — la fermeture retire l'écoute du panneau source et annule les frames", withRender(async (dom) => {
  const { view, editor } = await openWithEditor("scene");
  editor.scrollTop = 1700;
  editor.dispatch("scroll");
  assert.equal(dom.pendingTimers(), 1);

  await view.onClose();
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0, "écouteur retiré");
  assert.equal(dom.pendingTimers(), 0, "frame en attente annulée");
  assert.equal(view.syncScroller, null);
}));

/* ------------------------------- Zoom --------------------------------- */

/** Rend le viewport réellement défilable : sa hauteur/largeur défilable
 *  suit l'iframe, qui suit le zoom — c'est ce qui permet de vérifier que le
 *  point sous le pointeur est conservé. */
function makeViewportMeasurable(view, viewport) {
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    get: () => parseFloat(view.previewFrame?.style?.height || "0") + 2 * VIEWPORT_PADDING,
  });
  Object.defineProperty(viewport, "scrollWidth", {
    configurable: true,
    get: () => parseFloat(view.previewFrame?.style?.width || "0") + 2 * VIEWPORT_PADDING,
  });
}

function wheel(el, { deltaY, ctrlKey = false, metaKey = false, clientX = 200, clientY = 400 } = {}) {
  let prevented = 0;
  el.dispatch("wheel", {
    deltaY,
    ctrlKey,
    metaKey,
    clientX,
    clientY,
    target: el,
    preventDefault: () => { prevented++; },
  });
  return prevented;
}

test("zoom — Ctrl/Cmd + molette zoome, met à jour le pourcentage et passe en manuel", withRender(async () => {
  const { view, viewport } = await openLoadedView("manuscript");
  view.setZoom(1, "manual");

  assert.equal(wheel(viewport, { deltaY: -100, ctrlKey: true }), 1, "le zoom global d'Obsidian doit être empêché");
  assert.equal(view.zoomScale, 1.04);
  assert.equal(view.zoomMode, "manual");
  assert.equal(view.zoomLabelEl.textContent, "104 %");

  // Cmd sur macOS : même chemin.
  assert.equal(wheel(viewport, { deltaY: 100, metaKey: true }), 1);
  assert.equal(view.zoomScale, 1);
  assert.equal(view.zoomLabelEl.textContent, "100 %");

  // Un mode automatique bascule bien en manuel au premier geste.
  view.zoomMode = "fit-width";
  wheel(viewport, { deltaY: -100, ctrlKey: true });
  assert.equal(view.zoomMode, "manual");

  // Pincement trackpad : petits deltas, mais le geste ne doit pas être mort.
  const before = view.zoomScale;
  wheel(viewport, { deltaY: -4, ctrlKey: true });
  assert.ok(view.zoomScale > before, "un pincement fin doit tout de même zoomer");
}));

test("zoom — molette sans modificateur : ni zoom, ni preventDefault (le défilement reste normal)", withRender(async () => {
  const { view, viewport } = await openLoadedView("manuscript");
  view.setZoom(1, "manual");

  assert.equal(wheel(viewport, { deltaY: -240 }), 0, "le défilement vertical ne doit jamais être intercepté");
  assert.equal(view.zoomScale, 1);
  assert.equal(view.zoomLabelEl.textContent, "100 %");
}));

test("zoom — les bornes 40 % / 200 % tiennent au trackpad", withRender(async () => {
  const { view, viewport } = await openLoadedView("manuscript");
  view.setZoom(1, "manual");

  for (let i = 0; i < 40; i++) wheel(viewport, { deltaY: -500, ctrlKey: true });
  assert.equal(view.zoomScale, 2);
  assert.equal(view.zoomLabelEl.textContent, "200 %");

  for (let i = 0; i < 60; i++) wheel(viewport, { deltaY: 500, ctrlKey: true });
  assert.equal(view.zoomScale, 0.4);
  assert.equal(view.zoomLabelEl.textContent, "40 %");
}));

test("zoom — le point sous le pointeur reste au même endroit du document", withRender(async () => {
  const { view, viewport } = await openLoadedView("manuscript");
  makeViewportMeasurable(view, viewport);
  view.setZoom(1, "manual");
  viewport.clientHeight = 700;
  viewport.scrollTop = 500;
  viewport.scrollLeft = 40;

  const pointerY = 300;
  const before = (viewport.scrollTop + pointerY) / viewport.scrollHeight;
  const beforeX = (viewport.scrollLeft + 150) / viewport.scrollWidth;

  wheel(viewport, { deltaY: -200, ctrlKey: true, clientX: 150, clientY: VIEWPORT_SCREEN_TOP + pointerY });

  assert.ok(view.zoomScale > 1, "le zoom a bien changé");
  const after = (viewport.scrollTop + pointerY) / viewport.scrollHeight;
  const afterX = (viewport.scrollLeft + 150) / viewport.scrollWidth;
  assert.ok(Math.abs(after - before) < 0.005, `point vertical conservé (${before} -> ${after})`);
  assert.ok(Math.abs(afterX - beforeX) < 0.005, `point horizontal conservé (${beforeX} -> ${afterX})`);
  assert.ok(viewport.scrollTop > 500, "la position suit l'agrandissement, pas de retour en haut");
}));

test("zoom — aucun rendu, aucune compilation, et aucun écouteur hors du viewport", withRender(async () => {
  const { view, app, viewport, toolbar } = await openLoadedView("manuscript");
  const compiles = countCompiles(app);
  const generation = view.refreshGeneration;
  for (let i = 0; i < 5; i++) wheel(viewport, { deltaY: -100, ctrlKey: true });
  assert.equal(compiles(), 0);
  assert.equal(view.refreshGeneration, generation);

  /* Les écouteurs DOM de la vue ne visent QUE le viewport : rien ne peut
     donc modifier le comportement de la molette ailleurs dans Obsidian. */
  const targets = new Set((view._domEvents || []).map((e) => e.el));
  assert.deepEqual([...targets], [viewport]);
  assert.deepEqual(
    (view._domEvents || []).map((e) => e.type).sort(),
    ["scroll", "wheel"]
  );
  assert.equal((toolbar._eventListeners.get("wheel") || []).length, 0);
}));

/* ------------------- Barre compacte de style et export ----------------- */

test("barre — les réglages de format et de gabarit restent exclusivement centraux", withRender(async () => {
  const { view, plugin, toolbar } = await openLoadedView("scene");
  assert.equal(toolbar.children.some((child) => child.tagName === "SELECT"), false);
  assert.equal(view.templateSelectEl, undefined);
  assert.equal(view.formatNoteEl, undefined);
  assert.equal(typeof view.setExportFormat, "undefined");
  assert.equal(view.exportFormat, "docx");
  assert.equal(plugin.settings.exportTemplate, "classique");
}));


test("export contextuel — portée (affichée), inclusions, format, gabarit et nom partagent les réglages centraux", withRender(async () => {
  const { view, app, plugin } = await openLoadedView("scene");

  view.btnExport.click();
  await flush();
  assert.equal(view.exportPanelEl.hasClass("is-hidden"), false);
  const selects = view.exportPanelEl.querySelectorAll("select");
  const [format, template] = selects;
  /* La portée n'est plus un select : elle s'affiche et ne se change pas
     depuis le panneau (règle 4 du chantier CompileScope). */
  const scopeLabel = view.exportPanelEl.querySelector('[aria-label="Portée de l’export"]');
  assert.equal(scopeLabel.textContent, "Feuillet");

  format.value = "epub";
  format.dispatch("change");
  await flush();
  assert.equal(plugin.settings.exportFormat, "epub");

  template.value = "moderne";
  template.dispatch("change");
  await flush();
  assert.equal(plugin.settings.exportTemplate, "moderne");

  const previousLayoutOpen = LayoutModal.prototype.open;
  let openedLayout = null;
  LayoutModal.prototype.open = function openLayout() { openedLayout = this; };
  try {
    const visualLayout = view.exportPanelEl.querySelector('[aria-label="Régler visuellement la page de titre"]');
    assert.ok(visualLayout, "le réglage visuel doit être directement disponible dans Export");
    visualLayout.click();
  } finally {
    LayoutModal.prototype.open = previousLayoutOpen;
  }
  assert.equal(openedLayout.templateKey, "moderne");
  let layoutRefreshes = 0;
  view.refreshPreview = async () => { layoutRefreshes++; };
  openedLayout.onChange();
  await flush();
  assert.equal(layoutRefreshes, 1, "une modification dans le modal actualise l’aperçu ouvert");

  const name = view.exportPanelEl.querySelector('[aria-label="Nom du fichier exporté"]');
  name.value = "Mon chapitre";
  name.dispatch("change");
  await flush();
  assert.equal(plugin.settings.compileFileName, "Mon chapitre.md");

  const previousOpen = CompileSelectionModal.prototype.open;
  let selectionOpened = 0;
  CompileSelectionModal.prototype.open = () => { selectionOpened++; };
  try {
    view.exportPanelEl.querySelectorAll("button").find((el) => el.textContent === "Éléments inclus").click();
  } finally {
    CompileSelectionModal.prototype.open = previousOpen;
  }
  assert.equal(selectionOpened, 1, "la sélection existante des feuillets est réutilisée");

  let calls = 0;
  const realExport = view.doExport.bind(view);
  view.doExport = async () => { calls++; };
  view.exportPanelEl.querySelectorAll("button").find((el) => el.textContent === "Exporter").click();
  await flush();
  assert.equal(calls, 1, "le bloc doit appeler doExport, pas une logique d'export locale");

  // Et doExport atteint réellement le service central : en Markdown, il
  // passe par compile(), qui écrit le manuscrit.
  plugin.settings.exportFormat = "md";
  const compiles = countCompiles(app);
  await realExport();
  assert.ok(compiles() > 0, "compile() doit avoir été appelé");
}));

test("panneau Export — repli et réouverture de session ne perdent aucun choix", withRender(async () => {
  const { view, plugin } = await openLoadedView("manuscript");
  view.btnExport.click();
  await flush();
  assert.equal(view.exportPanelEl.hasClass("is-hidden"), false);

  const format = view.exportPanelEl.querySelectorAll("select")[0];
  format.value = "odt";
  format.dispatch("change");
  await flush();
  const close = view.exportPanelEl.querySelector('[aria-label="Replier le panneau Export"]');
  close.click();
  assert.equal(view.exportPanelEl.hasClass("is-hidden"), true);

  view.btnExport.click();
  await flush();
  assert.equal(view.exportPanelEl.hasClass("is-hidden"), false);
  assert.equal(plugin.settings.exportFormat, "odt");
  assert.equal(view.exportPanelEl.querySelectorAll("select")[0].value, "odt");
  assert.equal(
    view.exportPanelEl.querySelectorAll("summary").some((summary) => summary.textContent === "Page de titre"),
    false,
    "la mise en page de titre se règle sur la page, pas dans Export"
  );
  assert.equal(view.contentEl.querySelector(".feuillets-preview-settings"), null, "aucune vue de réglages supplémentaire");
}));

test("panneau Export — plus aucun réglage d'en-tête ni de pied de page", withRender(async () => {
  const { view } = await openLoadedView("manuscript");
  view.btnExport.click();
  await flush();

  const summaries = view.exportPanelEl.querySelectorAll("summary").map((s) => s.textContent);
  assert.deepEqual(summaries, ["Première page"], "une seule sous-section repliable subsiste");

  const labels = view.exportPanelEl.querySelectorAll("label").map((row) => row.textContent);
  for (const gone of [
    "En-tête", "Pied", "Distance", "Espace", "Pages paires", "Première page différente",
  ]) {
    assert.equal(
      labels.some((text) => text.includes(gone)),
      false,
      `« ${gone} » ne doit plus être réglable depuis l'aperçu : c'est le rôle du modal Mise en page visuelle`
    );
  }
  // Ces réglages restent bel et bien accessibles — dans le modal visuel.
  assert.ok(view.exportPanelEl.querySelector('[aria-label="Régler visuellement la page de titre"]'));
}));

test("panneau Export — le bouton d’actualisation force un rendu", withRender(async () => {
  const { view } = await openLoadedView("manuscript");
  view.btnExport.click();
  await flush();
  let refreshes = 0;
  view.refreshPreview = async () => { refreshes++; };

  const refresh = view.exportPanelEl.querySelector('[aria-label="Actualiser l’aperçu"]');
  assert.ok(refresh, "le bouton de secours doit être visible dans l'en-tête Export");
  refresh.click();
  await flush();
  await flush();
  assert.equal(refreshes, 1);
}));

/* ---------------------- Première page (feuillet Front) ------------------ */

/** Contenu réel d'une page de titre à rôles, tel que createMinimalProject
 *  l'écrit (voir services/project-files.ts) — frontmatter compris. */
function frontTitleContent(title = "Grand Roman", author = "Auteur Test") {
  return [
    "---", `title: ${title}`, "type: titre", "compile: true", "---",
    `:::titre: ${title}`,
    ":::sous-titre: ",
    ":::mots: ",
    `:::auteur: ${author}`,
    "",
  ].join("\n");
}

/** Ajoute un dossier Front et ses pages de titre au projet du fixture, comme
 *  un vrai coffre les présenterait. Renvoie les fichiers créés. */
function addFrontPages(manuscript, specs) {
  const front = new TFolder("Manuscrit/Front");
  front.name = "Front";
  front.path = "Manuscrit/Front";
  front.parent = manuscript;
  front.children = specs.map((spec) => {
    const file = new TFile(`Manuscrit/Front/${spec.name}.md`, spec.content ?? frontTitleContent());
    file.name = `${spec.name}.md`;
    file.basename = spec.name;
    file.extension = "md";
    file.path = `Manuscrit/Front/${spec.name}.md`;
    file.parent = front;
    file._fm = { type: "titre", compile: spec.compile !== false, ...(spec.fm || {}) };
    return file;
  });
  manuscript.children = [front, ...manuscript.children];
  return front.children;
}

/** Ouvre la vue avec un dossier Front peuplé et le panneau Export déplié. */
async function openWithFrontPages(specs = [{ name: "Page de titre" }]) {
  const ctx = await openLoadedView("manuscript");
  const files = addFrontPages(ctx.manuscript, specs);
  ctx.view.btnExport.click();
  await flush();
  await flush();
  return { ...ctx, files };
}

/** Champ « Première page » repéré par son libellé accessible. */
function firstPageField(view, label) {
  return view.exportPanelEl.querySelector(`[aria-label="${label}"]`);
}

test("première page — inclusion, exclusion et conservation du fichier Front", withRender(async () => {
  const { view, files } = await openWithFrontPages();
  const [titlePage] = files;

  const include = firstPageField(view, "Inclure la page de titre");
  assert.equal(include.checked, true, "une page Front de type titre est incluse par défaut");

  include.checked = false;
  include.dispatch("change");
  await flush();
  await flush();
  assert.equal(titlePage._fm.compile, false, "l'exclusion passe par l'indicateur compile du frontmatter");
  assert.equal(titlePage._fm.type, "titre", "le type et les métadonnées sont conservés");
  assert.match(titlePage.content, /:::titre: Grand Roman/, "le contenu de la page est conservé");
  assert.ok(view.app.vault.getAbstractFileByPath(titlePage.path), "le fichier Front n'est jamais supprimé");

  // Aucune page de titre générée ne vient remplacer celle qu'on exclut.
  assert.equal(view.frontTitleCandidates().length, 1);
  assert.equal(firstPageField(view, "Inclure la page de titre").checked, false);

  firstPageField(view, "Inclure la page de titre").checked = true;
  firstPageField(view, "Inclure la page de titre").dispatch("change");
  await flush();
  await flush();
  assert.equal(titlePage._fm.compile, true, "la réinclusion rétablit exactement la même page");
}));

test("première page — inclure/exclure ne referme pas la sous-section ni ne reconstruit le reste du panneau", withRender(async () => {
  const { view } = await openWithFrontPages();

  const details = view.exportPanelEl.querySelector("details");
  details.open = true;
  const scopeBefore = view.exportPanelEl.querySelectorAll("select")[0];
  const bodyBefore = view.firstPageBodyEl;

  const include = firstPageField(view, "Inclure la page de titre");
  include.checked = false;
  include.dispatch("change");
  await flush();
  await flush();

  assert.equal(view.exportPanelEl.querySelector("details"), details, "le même <details> reste en place");
  assert.equal(details.open, true, "la sous-section ne se referme pas toute seule");
  assert.equal(view.exportPanelEl.querySelectorAll("select")[0], scopeBefore, "le reste du panneau n'est pas reconstruit");
  assert.equal(view.firstPageBodyEl, bodyBefore, "seul le contenu de la sous-section est rafraîchi, pas son conteneur");
}));

test("première page — le bouton Actualiser resynchronise les champs depuis le fichier Front", withRender(async () => {
  const { view, files } = await openWithFrontPages();
  const [titlePage] = files;

  // Le fichier est modifié AILLEURS (éditeur) pendant que le panneau reste ouvert.
  titlePage.content = setTitleRoleValue(titlePage.content, "titre", "Modifié dans l’éditeur");
  assert.equal(firstPageField(view, "Titre").value, "Grand Roman", "le panneau affiche encore l'ancienne valeur");

  const refresh = view.exportPanelEl.querySelector('[aria-label="Actualiser l’aperçu"]');
  refresh.click();
  await flush();
  await flush();

  assert.equal(firstPageField(view, "Titre").value, "Modifié dans l’éditeur", "le clic relit bien le fichier Front");
}));

test("première page — le fichier Front affiché est le fichier réellement utilisé, et peut changer", withRender(async () => {
  const { view, files } = await openWithFrontPages([
    { name: "Page de titre" },
    { name: "Page de titre — variante", compile: false, content: frontTitleContent("Variante") },
  ]);
  const [main, variant] = files;

  const picker = firstPageField(view, "Fichier Front utilisé");
  assert.deepEqual(picker.children.map((o) => o.value), [main.path, variant.path]);
  assert.equal(picker.value, main.path, "le fichier montré est celui que la compilation retient");

  picker.value = variant.path;
  picker.dispatch("change");
  await flush();
  await flush();
  assert.equal(variant._fm.compile, true);
  assert.equal(main._fm.compile, false, "un seul fichier Front sert de première page");
  assert.equal(firstPageField(view, "Fichier Front utilisé").value, variant.path);
  assert.equal(firstPageField(view, "Titre").value, "Variante", "les champs suivent le fichier choisi");
}));

test("première page — ouverture du fichier Front dans l'éditeur et sélection dans le Binder", withRender(async () => {
  const { view, plugin, files } = await openWithFrontPages();
  let opened = null;
  const leaf = { openFile: async (file) => { opened = file; } };
  plugin.getLeafForOpeningFile = () => leaf;

  const open = view.exportPanelEl.querySelector('[aria-label="Ouvrir le fichier Front"]');
  assert.ok(open, "une icône plate ouvre le fichier Front");
  assert.equal(open.hasClass("clickable-icon"), true);
  open.click();
  await flush();
  await flush();
  assert.equal(opened, files[0]);
  assert.equal(plugin.settings.binderSelectedPath, "Manuscrit/Front", "le Binder suit le fichier ouvert");
}));

test("première page — titre, sous-titre et auteur sont écrits dans le fichier Front, sans état concurrent", withRender(async () => {
  const { view, plugin, viewport, files } = await openWithFrontPages();
  const [titlePage] = files;
  viewport.scrollTop = 640;
  view.zoomScale = 1.3;
  let refreshes = 0;
  view.refreshPreview = async () => { refreshes++; };

  for (const [label, expected] of [["Titre", "NEFES"], ["Sous-titre", "Roman"], ["Auteur", "Halim"]]) {
    const input = firstPageField(view, label);
    input.value = expected;
    input.dispatch("change");
    await flush();
    await flush();
  }

  assert.match(titlePage.content, /:::titre: NEFES/);
  assert.match(titlePage.content, /:::sous-titre: Roman/);
  assert.match(titlePage.content, /:::auteur: Halim/);
  assert.match(titlePage.content, /^---\ntitle: Grand Roman/, "le frontmatter existant est laissé intact");
  assert.equal(refreshes, 3, "chaque champ actualise immédiatement l'aperçu");
  assert.equal(viewport.scrollTop, 640, "le scroll est conservé");
  assert.equal(view.zoomScale, 1.3, "le zoom est conservé");
  // Le titre et l'auteur du manuscrit restent alignés sur le fichier Front.
  assert.equal(plugin.settings.manuscriptTitle, "NEFES");
  assert.equal(plugin.settings.manuscriptAuthor, "Halim");
}));

test("première page — mention complémentaire et image passent par les mêmes rôles Front", withRender(async () => {
  const { view, files } = await openWithFrontPages();
  const [titlePage] = files;

  const mention = firstPageField(view, "Mention complémentaire");
  mention.value = "71 800 mots";
  mention.dispatch("change");
  await flush();
  await flush();
  const image = firstPageField(view, "Image ou logo");
  image.value = "![[logo.png]]";
  image.dispatch("change");
  await flush();
  await flush();

  assert.match(titlePage.content, /:::mots: 71 800 mots/);
  assert.match(titlePage.content, /:::image: !\[\[logo\.png\]\]/);
}));

test("première page — sans feuillet Front, la section reste utilisable et le repli générique subsiste", withRender(async () => {
  const { view } = await openLoadedView("manuscript");
  view.btnExport.click();
  await flush();
  assert.equal(view.frontTitleCandidates().length, 0);
  assert.ok(firstPageField(view, "Inclure la page de titre"), "l'inclusion reste affichée");
  assert.equal(firstPageField(view, "Fichier Front utilisé"), null, "aucun fichier à choisir");
  assert.ok(
    view.exportPanelEl.querySelector('[aria-label="Régler visuellement la page de titre"]'),
    "la mise en page visuelle reste accessible"
  );
}));

test("première page — exclue, elle disparaît de l'aperçu ET de l'export, sans page générée de remplacement", withCapture(async (dom, rendered) => {
  const ctx = await openView("manuscript");
  ctx.viewport._rectTop = VIEWPORT_SCREEN_TOP;
  placeFrame(ctx.frame, ctx.viewport);
  fireLoad(ctx.frame);
  const { view, scaledContainer, viewport } = ctx;
  const [titlePage] = addFrontPages(ctx.manuscript, [{ name: "Page de titre" }]);

  /* Un rendu complet : la vue ne libère sa file qu'au `load` de l'iframe —
     sans lui, tout rafraîchissement suivant serait simplement mis en attente. */
  const renderOnce = async () => {
    await view.refreshPreview();
    const frame = latestFrame(scaledContainer);
    if (frame) fireLoad(placeFrame(frame, viewport));
    await flush();
  };

  view.btnExport.click();
  await flush();
  await flush();
  await renderOnce();
  assert.match(
    rendered.at(-1),
    /FEUILLETS-FRONT:titre[\s\S]*Manuscrit\/Front\/Page de titre\.md/,
    "la page de titre incluse fait bien partie du manuscrit rendu"
  );

  const include = firstPageField(view, "Inclure la page de titre");
  include.checked = false;
  include.dispatch("change");
  for (let i = 0; i < 8; i++) await flush();
  await renderOnce();

  assert.equal(titlePage._fm.compile, false);
  assert.equal(
    rendered.at(-1).includes("Manuscrit/Front/Page de titre.md"),
    false,
    "le manuscrit rendu — donc aussi l'export, qui passe par le même compile() — n'inclut plus la page de titre"
  );
  assert.equal(
    String(latestFrame(scaledContainer)?.srcdoc || "").includes("feuillets-frontpage-generated"),
    false,
    "aucune page de titre générée ne vient remplacer celle qu'on exclut"
  );
  assert.match(titlePage.content, /:::titre: Grand Roman/, "le contenu du feuillet Front est conservé");
}));

test("première page — le modal visuel écrit les mêmes valeurs que celles lues par l'aperçu et l'export", withRender(async () => {
  const { view, plugin } = await openWithFrontPages();
  const previousLayoutOpen = LayoutModal.prototype.open;
  let layout = null;
  LayoutModal.prototype.open = function openLayout() { layout = this; };
  try {
    view.exportPanelEl.querySelector('[aria-label="Régler visuellement la page de titre"]').click();
  } finally {
    LayoutModal.prototype.open = previousLayoutOpen;
  }
  assert.ok(layout, "le bouton ouvre bien le modal de mise en page");
  assert.equal(layout.templateKey, plugin.settings.exportTemplate, "le modal règle le gabarit actif, pas une copie");
}));

test("barre — l'indicateur de fichier suivi reflète la synchronisation de portée", withRender(async () => {
  const { view } = await openWithEditor("scene");
  assert.match(view.followedEl.textContent, /01-scene\.md$/);

  assert.equal(view.syncScrollEnabled, true);
  assert.equal(view.contentEl.querySelectorAll(`[aria-label="${SYNC_LABEL}"]`).length, 0);
}));

/* ---------------- Sous-lot H — transparence absolue -------------------- */

test("boutons — aucun style de fond en ligne, aucune classe maison, état lisible sans pastille", withRender(async () => {
  const { view, toolbar } = await openLoadedView("manuscript");

  /* Il n'y a plus d'état « actif » à peindre dans la barre : le mode et le
     zoom AFFICHENT leur valeur en toutes lettres, et les états cochés
     vivent dans les menus. Reste à garantir qu'aucun fond n'est posé
     depuis le TypeScript, quel que soit le contrôle. */
  const controls = [...toolbar.children].filter(
    (el) => el && (el.hasClass?.("clickable-icon") || el.hasClass?.("feuillets-preview-chip"))
  );
  assert.equal(controls.length, 4, "Ouvrir ce feuillet, zoom, Export et Réglages");

  for (const el of controls) {
    for (const prop of ["background", "background-color", "box-shadow", "border"]) {
      assert.equal(el.style.getPropertyValue(prop), "", `${prop} ne doit jamais être posé en ligne`);
    }
    const extra = [...el.classes].filter(
      (c) => ![
        "clickable-icon",
        "feuillets-preview-chip",
        "feuillets-preview-zoom-val",
        "feuillets-preview-open-visible",
        "is-hidden",
      ].includes(c)
    );
    assert.deepEqual(extra, [], "aucune classe de style maison ni classe d'état colorée");
    // Chaque contrôle reste explicite pour un lecteur d'écran.
    assert.ok(el.getAttribute("aria-label"), "libellé accessible attendu");
    assert.equal(el.getAttribute("title"), el.getAttribute("aria-label"));
  }

  assert.equal(toolbar.children.some((el) => el.hasClass?.("feuillets-preview-breadcrumb")), true);

  /* Le panneau Export applique la même règle : icônes plates, croix plate,
     aucun fond posé depuis le TypeScript. */
  view.btnExport.click();
  await flush();
  await flush();
  for (const el of view.exportPanelEl.querySelectorAll("button")) {
    for (const prop of ["background", "background-color", "box-shadow", "border"]) {
      assert.equal(el.style.getPropertyValue(prop), "", `${prop} ne doit jamais être posé en ligne`);
    }
    assert.ok(el.hasClass("clickable-icon"), "tout bouton du panneau reste un bouton Obsidian plat");
  }
  assert.ok(view.exportPanelEl.querySelector('[aria-label="Replier le panneau Export"]'));
}));

test("sync — l'éditeur suivi n'est pas oublié quand l'aperçu prend le focus, ni pour un fichier hors projet", withRender(async (dom) => {
  const { view, app, viewport, editor, sceneFile } = await openWithEditor("scene");
  assert.equal(view.syncScroller, editor);

  /* 1. L'utilisatrice clique dans l'aperçu : plus aucune vue Markdown
        active. Débrancher ici tuerait la synchronisation aperçu → éditeur
        au moment précis où elle sert. */
  app.closeMarkdownPanes();
  app.emitWorkspace("active-leaf-change");
  await flush();
  assert.equal(view.syncScroller, editor, "la feuille suivie est conservée");

  viewport.scrollTop = 575;
  viewport.dispatch("scroll");
  dom.runTimers();
  assert.equal(editor.scrollTop, 850, "le sens aperçu → éditeur fonctionne encore");

  /* 2. Un fichier hors projet ouvert à côté : il est ignoré, ce qui ne veut
        pas dire qu'on oublie le feuillet suivi. */
  const outside = new TFile("Ailleurs/note.md", "Hors projet.");
  outside.path = "Ailleurs/note.md";
  outside.extension = "md";
  const foreign = app.openMarkdownPane(outside, { scrollHeight: 4000, clientHeight: 600 });
  app.setActiveFile(outside);
  app.emitWorkspace("active-leaf-change");
  await flush();

  assert.equal(view.syncScroller, editor, "le fichier hors projet n'est pas suivi");
  assert.equal((foreign._eventListeners.get("scroll") || []).length, 0);
  assert.equal(view.syncSourcePath, sceneFile.path);
}));

test("lecture Manuscrit — un rafraîchissement conserve zoom et laisse le scroll libre", withRender(async (dom) => {
  const { view, viewport, editor, scaledContainer } = await openWithEditor("manuscript");
  view.setZoom(1.25, "manual");

  viewport.scrollTop = 640;
  editor.scrollTop = 1700;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 640);

  await view.refreshPreview();
  fireLoad(placeFrame(latestFrame(scaledContainer), viewport));

  assert.equal(view.zoomScale, 1.25, "le zoom survit à l'actualisation");
  assert.equal(view.zoomMode, "manual");
  assert.equal((editor._eventListeners.get("scroll") || []).length, 0, "aucun listener continu en Manuscrit");

  // Le défilement reste indépendant après le rafraîchissement.
  viewport.scrollHeight = 3000;
  view.lastPreviewScrollAt = 0;
  editor.scrollTop = 850;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.equal(viewport.scrollTop, 640);
}));

/* ======================================================================
   Chantier « Simplification du mode Manuscrit ».

   Sous-lots A et B — rôle strict de chaque usage, et ZÉRO YAML dans le
   rendu. Le YAML n'était pas seulement inesthétique : rendu en Markdown,
   `---\ntitle: X\n---` produit un <hr> suivi d'un TITRE setext <h2>, et
   paginateManuscript force un saut de page avant tout h1/h2 — le premier
   mot du feuillet se retrouvait donc page 2 alors que l'éditeur était
   ligne 1. C'était la cause du décalage constaté.
   ====================================================================== */

/** HTML réellement paginé (hors coque CSS) : c'est ce que l'autrice voit. */
function pagesHtmlOf(frame) {
  const marker = '<div class="feuillets-preview-pages">';
  const at = frame.srcdoc.indexOf(marker);
  assert.ok(at >= 0, "la pile de pages doit exister dans le document d'aperçu");
  return frame.srcdoc.slice(at + marker.length);
}

/** Comme withRender, mais capture le markdown RÉELLEMENT passé au moteur de
 *  rendu : c'est là qu'un frontmatter oublié se verrait en premier. */
function withCapture(fn) {
  return async () => {
    const dom = installDom();
    const previousRender = MarkdownRenderer.render;
    const rendered = [];
    MarkdownRenderer.render = async (_app, markdown, container) => {
      rendered.push(markdown);
      for (const block of markdown.split(/\n\n+/)) container.appendChild(element("p", block));
    };
    try {
      await fn(dom, rendered);
    } finally {
      MarkdownRenderer.render = previousRender;
      dom.restore();
    }
  };
}

function assertNoYaml(text, context) {
  for (const key of ["title:", "titre:", "status:", "statut:", "order:", "ordre:"]) {
    assert.equal(text.includes(key), false, `${context} : la clé « ${key} » ne doit jamais être rendue`);
  }
  assert.equal(/(^|\n|>)---(\s|<|$)/.test(text), false, `${context} : aucun délimiteur YAML ne doit être rendu`);
}

test("mode Scène — le feuillet SEUL : ni YAML, ni page de titre, ni en-tête de livre", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("scene");

  // Ce qui part au rendu est EXACTEMENT le corps du feuillet.
  assert.equal(rendered.at(-1), "Texte réel de la scène.");
  const html = pagesHtmlOf(view.previewFrame);
  assert.ok(html.includes("Texte réel de la scène."), "le texte du feuillet doit être affiché");
  assertNoYaml(html, "mode Scène");

  // Aucun élément liminaire : ni titre du livre, ni page Front.
  assert.equal(html.includes("Grand Roman"), false, "le titre du livre n'a rien à faire sur une scène");
  assert.equal(html.includes("pdf-author-title"), false);
  assert.equal(html.includes("feuillets-frontpage"), false);

  /* Et le premier bloc rendu EST le premier bloc du fichier : c'est ce qui
     rend la synchronisation naturelle dès la première ligne. */
  assert.equal(rendered.at(-1).split(/\n\n+/)[0], "Texte réel de la scène.");
}));

test("mode Scène — le titre du feuillet n'apparaît que si le gabarit le demande vraiment", withCapture(async (_dom, rendered) => {
  const { view, plugin } = await openLoadedView("scene");
  assert.equal(rendered.at(-1).startsWith("#"), false, "insertSceneTitles est faux par défaut : aucun titre ajouté");

  // Preset qui demande les titres de scène : l'aperçu suit la compilation,
  // il n'invente ni ne supprime rien.
  plugin.settings.insertSceneTitles = true;
  view.app.metadataCache.getFileCache = () => ({ frontmatter: { title: "Le vent se lève" } });
  await view.refreshPreview();
  await flush();
  assert.equal(rendered.at(-1), "# Le vent se lève\n\nTexte réel de la scène.");
}));

test("YAML — chaque feuillet est nettoyé INDIVIDUELLEMENT avant assemblage (mode Chapitre)", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("chapter");

  const markdown = rendered.at(-1);
  // Les deux scènes sont là…
  assert.ok(markdown.includes("Texte réel de la scène."));
  assert.ok(markdown.includes("Seconde scène du chapitre."));
  // …et AUCUN des deux frontmatters n'a survécu : un nettoyage global
  // n'aurait retiré que le premier.
  assertNoYaml(markdown, "markdown assemblé");
  assertNoYaml(pagesHtmlOf(view.previewFrame), "mode Chapitre");
  assert.equal(view.displayedPath, "Manuscrit/Chapitre 1");
}));

/** Relance un rendu ET simule le `load` de la nouvelle iframe : sans ce
 *  `load`, le rendu suivant serait simplement mis en file d'attente (voir
 *  refreshInFlight) et l'assertion porterait sur l'ancien contenu. */
async function rerender(ctx) {
  await ctx.view.refreshPreview();
  const frame = latestFrame(ctx.scaledContainer);
  if (frame) fireLoad(placeFrame(frame, ctx.viewport));
  await flush();
}

test("YAML — fins de ligne CRLF et frontmatter vide sont traités comme les autres", withCapture(async (_dom, rendered) => {
  const ctx = await openLoadedView("scene");
  const { app, sceneFile } = ctx;

  sceneFile.content = "---\r\ntitle: Windows\r\nstatus: relu\r\n---\r\nTexte importé de Windows.";
  await rerender(ctx);
  assert.equal(rendered.at(-1), "Texte importé de Windows.");

  sceneFile.content = "---\n---\nAprès un frontmatter vide.";
  await rerender(ctx);
  assert.equal(rendered.at(-1), "Après un frontmatter vide.");

  // Un séparateur horizontal légitime du corps, lui, survit intact.
  sceneFile.content = "---\ntitle: X\n---\nAvant.\n\n---\n\nAprès.";
  await rerender(ctx);
  assert.equal(rendered.at(-1), "Avant.\n\n---\n\nAprès.");
  assert.equal(app.workspace.getActiveFile(), sceneFile);
}));

test("mode Manuscrit — lui SEUL porte les éléments liminaires du livre", withCapture(async () => {
  const { view } = await openLoadedView("manuscript");
  const html = pagesHtmlOf(view.previewFrame);
  assert.ok(html.includes("Grand Roman"), "le titre du livre appartient au manuscrit complet");
  assert.ok(html.includes("Auteur Test"));
  assert.ok(html.includes("feuillets-frontpage-generated"), "la page générée doit être reconnue comme page de titre interactive");
  assert.ok(html.includes('data-fp-role="titre"'), "le titre généré expose le même rôle visuel qu'une page Front");
  assert.ok(html.includes('data-fp-role="auteur"'), "l'auteur généré expose le même rôle visuel qu'une page Front");
  assertNoYaml(html, "mode Manuscrit");
}));

test("page de titre interactive — titre, sous-titre et auteur persistent sans perdre scroll ni zoom", async () => {
  const dom = installDom();
  try {
    const file = new TFile(
      "Roman/Manuscrit/Front/Titre.md",
      "---\ntitle: Ancien titre\ntype: titre\n---\n:::titre: Ancien titre\n:::sous-titre: Ancien sous-titre\n:::auteur: Ancienne autrice"
    );
    file.path = "Roman/Manuscrit/Front/Titre.md";
    file.extension = "md";
    const settings = {
      previewMode: "manuscript",
      exportTemplate: "classique",
      manuscriptTitle: "Ancien titre",
      manuscriptAuthor: "Ancienne autrice",
    };
    let frontmatterTitle = null;
    const app = {
      vault: {
        getAbstractFileByPath: (path) => path === file.path ? file : null,
        cachedRead: async () => file.content,
        modify: async (_file, content) => { file.content = content; },
      },
      fileManager: {
        processFrontMatter: async (_file, change) => {
          const data = {};
          change(data);
          frontmatterTitle = data.title;
        },
      },
    };
    let saves = 0;
    let refreshes = 0;
    const view = new PreviewView({ contentEl: element("div") }, {
      settings,
      getProjectFolder: () => null,
      saveSettings: async () => { saves++; },
    });
    view.app = app;
    view.previewViewport = element("div");
    view.previewViewport.scrollTop = 730;
    view.zoomScale = 1.35;
    view.zoomMode = "manual";
    view.refreshPreview = async () => { refreshes++; };

    const answers = ["Nouveau titre", "Nouveau sous-titre", "Nouvelle autrice"];
    window.prompt = () => answers.shift();
    await view.editTitleRole(file.path, "titre");
    await view.editTitleRole(file.path, "sous-titre");
    await view.editTitleRole(file.path, "auteur");

    assert.match(file.content, /:::titre: Nouveau titre/);
    assert.match(file.content, /:::sous-titre: Nouveau sous-titre/);
    assert.match(file.content, /:::auteur: Nouvelle autrice/);
    assert.equal(settings.manuscriptTitle, "Nouveau titre");
    assert.equal(settings.manuscriptAuthor, "Nouvelle autrice");
    assert.equal(frontmatterTitle, "Nouveau titre");
    assert.equal(saves, 3);
    assert.equal(refreshes, 3);
    assert.equal(view.previewViewport.scrollTop, 730);
    assert.equal(view.zoomScale, 1.35);
    assert.equal(view.zoomMode, "manual");
  } finally {
    dom.restore();
  }
});

test("page de titre interactive — ordre, espacement et alignement passent par les sources centrales", async () => {
  const dom = installDom();
  try {
    const file = new TFile("Roman/Front/Titre.md", ":::titre: Titre\n:::sous-titre: Sous-titre\n:::auteur: Autrice");
    file.path = "Roman/Front/Titre.md";
    const app = {
      vault: {
        getAbstractFileByPath: (path) => path === file.path ? file : null,
        cachedRead: async () => file.content,
        modify: async (_file, content) => { file.content = content; },
      },
    };
    const view = new PreviewView({ contentEl: element("div") }, {
      settings: { previewMode: "manuscript", exportTemplate: "classique" },
      getProjectFolder: () => null,
    });
    view.app = app;
    view.previewViewport = element("div");
    view.previewViewport.scrollTop = 415;
    view.zoomScale = 1.2;
    view.zoomMode = "manual";
    let refreshes = 0;
    view.refreshPreview = async () => { refreshes++; };

    await view.moveTitleRole(file.path, "auteur", -1);
    assert.equal(file.content, ":::titre: Titre\n:::auteur: Autrice\n:::sous-titre: Sous-titre");

    const styles = { auteur: { marginTopPt: 12, align: "center" } };
    view.updateTitlePageStyles = async (change) => { change(styles); refreshes++; };
    await view.adjustTitleRoleSpacing("auteur", 6);
    await view.cycleTitleRoleAlignment("auteur");
    assert.equal(styles.auteur.marginTopPt, 18);
    assert.equal(styles.auteur.align, "right");
    assert.equal(view.previewViewport.scrollTop, 415);
    assert.equal(view.zoomScale, 1.2);
    assert.equal(refreshes, 3);
  } finally {
    dom.restore();
  }
});

test("page de titre interactive — clic sélectionne sur la page et révèle une barre visuelle compacte", () => {
  const dom = installDom();
  try {
    const root = element("div");
    const doc = {
      createElement(tag) {
        const created = element(tag);
        created.ownerDocument = doc;
        return created;
      },
      querySelectorAll: (selector) => root.querySelectorAll(selector),
      addEventListener() {},
      removeEventListener() {},
    };
    root.ownerDocument = doc;
    const title = element("p", "Mon titre");
    title.ownerDocument = doc;
    root.appendChild(title);
    const view = new PreviewView({ contentEl: element("div") }, {
      settings: { previewMode: "manuscript", exportTemplate: "classique" },
      getProjectFolder: () => null,
    });
    let prompts = 0;
    window.prompt = () => { prompts++; return null; };

    view.makeTitleElementEditable(title, "titre", "Roman/Front/Titre.md");
    title.click();

    assert.equal(title.hasClass("is-title-selected"), true);
    assert.equal(prompts, 0, "un simple clic sélectionne sans ouvrir de formulaire");
    const controls = title.nextElementSibling;
    assert.equal(controls.hasClass("feuillets-preview-title-controls"), true);
    assert.deepEqual(
      controls.children.map((button) => button.getAttribute("aria-label")),
      ["Modifier titre", "Déplacer verticalement", "Monter cet élément", "Descendre cet élément", "Réduire l’espace avant", "Augmenter l’espace avant", "Changer l’alignement"]
    );

    const titlePage = element("div");
    titlePage.ownerDocument = doc;
    root.appendChild(titlePage);
    view.addTitlePageControls(titlePage);
    const pageControls = titlePage.children.at(-1);
    assert.equal(pageControls.hasClass("feuillets-preview-title-page-controls"), true);
    assert.deepEqual(
      pageControls.children.map((button) => button.getAttribute("aria-label")),
      ["Monter la composition", "Descendre la composition", "Réduire les marges internes", "Augmenter les marges internes"]
    );
  } finally {
    dom.restore();
  }
});

test("page de titre générée — un simple clic révèle aussi les commandes visuelles", () => {
  const dom = installDom();
  try {
    const root = element("div");
    const doc = {
      createElement(tag) {
        const created = element(tag);
        created.ownerDocument = doc;
        return created;
      },
      querySelectorAll: (selector) => root.querySelectorAll(selector),
      addEventListener() {},
      removeEventListener() {},
    };
    root.ownerDocument = doc;
    const title = element("h1", "Titre généré");
    title.ownerDocument = doc;
    root.appendChild(title);
    const view = new PreviewView({ contentEl: element("div") }, {
      settings: { previewMode: "manuscript", exportTemplate: "classique", manuscriptTitle: "Titre généré" },
      getProjectFolder: () => null,
      saveSettings: async () => {},
    });
    let prompts = 0;
    window.prompt = () => { prompts++; return null; };

    view.makeFallbackTitleElementEditable(title, "manuscriptTitle", "Titre", "titre");
    title.click();

    assert.equal(title.hasClass("is-title-selected"), true);
    assert.equal(prompts, 0, "le clic sélectionne la zone sans ouvrir immédiatement une boîte de dialogue");
    assert.deepEqual(
      title.nextElementSibling.children.map((button) => button.getAttribute("aria-label")),
      ["Modifier titre", "Déplacer verticalement", "Réduire l’espace avant", "Augmenter l’espace avant", "Changer l’alignement"]
    );
  } finally {
    dom.restore();
  }
});

test("mode Manuscrit — titres Markdown et YAML se complètent sans doublon", withCapture(async (_dom, rendered) => {
  const ctx = await openLoadedView("manuscript");
  const { view, app, sceneFile } = ctx;
  view.plugin.settings.insertSceneTitles = true;
  app.metadataCache.getFileCache = (file) => ({
    frontmatter: file === sceneFile ? { title: "Titre YAML", subtitle: "Sous-titre YAML" } : {},
  });

  sceneFile.content = "## Titre Markdown\n\n### Sous-titre Markdown\n\nCorps.";
  await rerender(ctx);
  let markdown = rendered.at(-1);
  assert.equal((markdown.match(/Titre Markdown/g) || []).length, 1);
  assert.equal((markdown.match(/Sous-titre Markdown/g) || []).length, 1);
  assert.equal(markdown.includes("## Titre YAML"), false);
  assert.equal(markdown.includes("### Sous-titre YAML"), false);

  sceneFile.content = "Corps.";
  await rerender(ctx);
  markdown = rendered.at(-1);
  assert.match(markdown, /## Titre YAML/);
  assert.match(markdown, /### Sous-titre YAML/);
}));

/* ------------------------- Mode Partie -------------------------------- */

/** Ouvre une vue complète sur la structure Partie → Chapitre → Scène. */
async function openNestedView(mode, activeFile) {
  const ctx = buildNestedProject();
  ctx.settings.previewMode = mode;
  ctx.app.setActiveFile(activeFile);
  const saved = [];
  const plugin = {
    settings: ctx.settings,
    getProjectFolder: () => ctx.root,
    saveSettings: async () => { saved.push(1); },
  };
  const view = new PreviewView({ contentEl: element("div") }, plugin);
  view.app = ctx.app;
  await view.onOpen();
  const viewport = view.contentEl.querySelector(".feuillets-preview-viewport");
  viewport._paddingX = VIEWPORT_PADDING;
  viewport._paddingY = VIEWPORT_PADDING;
  viewport._rectTop = VIEWPORT_SCREEN_TOP;
  const scaled = view.contentEl.querySelector(".feuillets-preview-scaled-container");
  const frame = latestFrame(scaled);
  if (frame) fireLoad(placeFrame(frame, viewport));
  return { ...ctx, view, plugin, viewport, frame: view.previewFrame };
}

test("mode Partie — tous les chapitres et scènes de la partie, dans l'ordre du Binder, sans YAML", withCapture(async (_dom, rendered) => {
  const { view, s1a } = await openNestedView("part", null);
  view.app.setActiveFile(s1a);
  await view.refreshPreview();
  await flush();

  const markdown = rendered.at(-1);
  /* Les deux chapitres de la PREMIÈRE partie, avec leurs titres, dans
     l'ordre. Le niveau de titre est celui de la compilation (profondeur du
     nœud) : une partie en H1, ses chapitres en H2. La partie elle-même n'est
     pas re-titrée — c'est le contexte affiché, pas un contenu. */
  const order = ["## Chapitre premier", "Scène A", "Scène B", "## Chapitre second", "Scène C"];
  let cursor = -1;
  for (const piece of order) {
    const at = markdown.indexOf(piece);
    assert.ok(at > cursor, `« ${piece} » attendu après le précédent (ordre du Binder)`);
    cursor = at;
  }
  // Rien de la DEUXIÈME partie.
  assert.equal(markdown.includes("Scène de la deuxième partie"), false);
  // Aucun YAML, aucune page liminaire.
  assertNoYaml(markdown, "mode Partie");
  assert.equal(markdown.includes("feuillets-frontpage"), false);
  assert.equal(view.displayedPath, "Roman/Manuscrit/Première partie");
}));

test("mode Partie — titres : Markdown, YAML et Binder suivent la résolution du Manuscrit", withCapture(async (_dom, rendered) => {
  const { view, app, plugin, s1a } = await openNestedView("part", null);
  view.app.setActiveFile(s1a);
  view.plugin.settings.insertSceneTitles = true;
  const metadata = new Map();
  app.metadataCache.getFileCache = (file) => ({ frontmatter: metadata.get(file.path) || {} });

  const render = async (body, frontmatter) => {
    s1a.content = body;
    metadata.set(s1a.path, frontmatter);
    await view.refreshPreview();
    fireLoad(placeFrame(latestFrame(view.scaledContainer), view.previewViewport));
    await flush();
    return rendered.at(-1);
  };

  let markdown = await render("## Titre Markdown\n\n### Sous-titre Markdown\n\nCorps.", { title: "YAML ignoré", subtitle: "Sous-titre ignoré" });
  assert.equal((markdown.match(/Titre Markdown/g) || []).length, 1);
  assert.equal(markdown.includes("YAML ignoré"), false);
  assert.equal(markdown.includes("Sous-titre ignoré"), false);

  markdown = await render("Corps.", { title: "Titre YAML", subtitle: "Sous-titre YAML" });
  assert.match(markdown, /### Titre YAML/);
  assert.match(markdown, /#### Sous-titre YAML/);

  markdown = await render("## Titre Markdown\n\nCorps.", { title: "YAML ignoré", subtitle: "Sous-titre YAML" });
  assert.equal((markdown.match(/Titre Markdown/g) || []).length, 1);
  assert.match(markdown, /### Sous-titre YAML/);

  markdown = await render("Corps.", {});
  assert.match(markdown, /### 01 Été/, "le Binder ne sert que de dernier repli du titre");
  assert.equal(markdown.includes("####"), false, "aucun sous-titre n'est inventé sans YAML");

  // Les niveaux Markdown générés sont ceux rendus par le même CSS de
  // gabarit que le Manuscrit, pas des classes propres au mode Partie.
  assert.match(view.previewFrame.srcdoc, /h3/);
  assert.equal(plugin.settings.previewMode, "part");
}));

test("lecture Partie — chaque section visible ouvre son propre feuillet, sans reconstruire", withBlockRender(async (dom) => {
  const { view, app, viewport, s1a, s1b, s1c } = await openNestedView("part", null);
  view.app.setActiveFile(s1a);
  await view.refreshPreview();
  const frame = latestFrame(view.scaledContainer);
  fireLoad(placeFrame(frame, viewport));
  const marks = view.previewFrame.contentDocument.querySelectorAll("[data-source-path]");
  assert.ok(marks.length >= 2, "les feuillets de la partie sont tous repérés");
  // Simulation fidèle des pages : offsetTop est local à chaque page (0),
  // seule la position de layout dans l'iframe distingue les feuillets.
  marks.forEach((mark, index) => {
    mark.offsetTop = 0;
    mark._rectTop = index * 1000;
  });
  view.setZoom(1.5, "manual");
  view.naturalPagesHeight = marks.length * 1000;
  viewport.clientHeight = 700;
  viewport.scrollTop = 500;
  const generation = view.refreshGeneration;
  viewport.dispatch("scroll");
  dom.runTimers();
  assert.equal(view.visibleFeuilletPath, s1b.path, "à 150 %, le titre suit encore le début réel du feuillet");
  assert.equal(
    view.sectionForPath(s1b.path).top,
    VIEWPORT_PADDING + 1000,
    "la synchronisation utilise la position globale de la section, pas son offsetTop local nul"
  );
  assert.equal(view.openVisibleEl.classes.has("is-hidden"), false);
  assert.equal(view.refreshGeneration, generation, "le scroll ne rend ni ne compile");

  viewport.scrollTop = 1500;
  const opened = [];
  const editorHost = element("div");
  const editor = editorHost.createDiv({ cls: "cm-scroller" });
  editor.scrollHeight = 2000;
  editor.clientHeight = 600;
  const editorLeaf = {
    view: { file: null, contentEl: editorHost },
    openFile: async (file) => { opened.push(file); app.setActiveFile(file); editorLeaf.view.file = file; },
  };
  // Le fil d'Ariane descend directement au Feuillet visible : il ne réutilise
  // ni la première scène, ni une cible mémorisée avant le scroll.
  app.workspace.getLeaf = () => editorLeaf;
  view.plugin.settings.previewSyncScroll = false;
  const zoom = view.zoomScale;
  view.openVisibleEl.click();
  await flush();
  assert.equal(opened.at(-1), s1c);
  assert.equal(view.mode, "part", "la portée Partie reste visible dans le fil d'Ariane");
  assert.equal(view.syncScrollEnabled, true);
  assert.equal(view.plugin.settings.binderSelectedPath, s1c.parent.path);
  assert.equal(view.zoomScale, zoom);
  assert.equal(view.refreshGeneration, generation, "l'ouverture n'altère pas le rendu de la Partie");
  assert.equal(view.syncScroller, editor, "le scroller de la feuille qui vient d'être ouverte est relié immédiatement");
  assert.equal(view.syncSourcePath, s1c.path);
  dom.runTimers(); // libère le drapeau du positionnement initial
  const previewBefore = viewport.scrollTop;
  view.lastPreviewScrollAt = 0;
  editor.scrollTop = 700;
  editor.dispatch("scroll");
  dom.runTimers();
  assert.notEqual(viewport.scrollTop, previewBefore, "le scroll de l'éditeur déplace la section du feuillet dans la Partie");
}));

test("lecture Manuscrit — Ouvrir ce feuillet relit data-source-path et conserve la lecture", withBlockRender(async (_dom) => {
  const ctx = await openNestedView("manuscript", null);
  const { view, app, viewport } = ctx;
  const marks = view.previewFrame.contentDocument.querySelectorAll("[data-source-path]");
  assert.ok(marks.length >= 3);
  marks.forEach((mark, index) => {
    mark.offsetTop = 0;
    mark._rectTop = index * 1000;
  });
  view.naturalPagesHeight = marks.length * 1000;
  viewport.clientHeight = 700;
  view.setZoom(1.25, "manual");
  const opened = [];
  const generation = view.refreshGeneration;
  viewport.scrollTop = 3000;
  const expectedPath = view.visibleFeuilletPathAtViewport();
  app.workspace.getLeaf = () => ({ openFile: async (file) => { opened.push(file); app.setActiveFile(file); } });
  view.plugin.settings.previewSyncScroll = false;
  const zoom = view.zoomScale;
  view.openVisibleEl.click();
  await flush();
  assert.equal(opened.at(-1).path, expectedPath, "le fil d'Ariane relit le repère actuellement visible");
  assert.equal(view.mode, "manuscript", "la portée Manuscrit reste visible dans le fil d'Ariane");
  assert.equal(view.syncScrollEnabled, true);
  assert.equal(view.plugin.settings.binderSelectedPath, opened.at(-1).parent.path);
  assert.equal(view.zoomScale, zoom);
  assert.equal(view.refreshGeneration, generation);

  /* Même comportement depuis l'ICÔNE de la barre, qui a remplacé le bouton
     texte : elle relit elle aussi le repère réellement sous les yeux. */
  viewport.scrollTop = 1000;
  const secondPath = view.visibleFeuilletPathAtViewport();
  assert.notEqual(secondPath, expectedPath, "la lecture a bien changé de feuillet");
  assert.equal(view.openVisibleEl.hasClass("is-hidden"), false, "l'action est pertinente ici");
  view.openVisibleEl.click();
  await flush();
  assert.equal(opened.at(-1).path, secondPath, "l'icône ouvre exactement le feuillet visible");
  assert.equal(view.plugin.settings.binderSelectedPath, opened.at(-1).parent.path, "et le sélectionne dans le Binder");
  assert.equal(view.zoomScale, zoom, "sans toucher au zoom");
  assert.equal(view.refreshGeneration, generation, "ni au rendu en cours");
}));

for (const mode of ["part", "manuscript"]) {
  test(`lecture ${mode} — le feuillet visible s'ouvre automatiquement après le scroll`, withBlockRender(async (dom) => {
    const ctx = await openNestedView(mode, null);
    const { view, app, viewport, s1a } = ctx;
    if (mode === "part") {
      app.setActiveFile(s1a);
      await view.refreshPreview();
      fireLoad(placeFrame(latestFrame(view.scaledContainer), viewport));
    }
    const marks = view.previewFrame.contentDocument.querySelectorAll("[data-source-path]");
    marks.forEach((mark, index) => {
      mark.offsetTop = 0;
      mark._rectTop = index * 1000;
    });
    view.naturalPagesHeight = marks.length * 1000;
    viewport.clientHeight = 700;
    view.setZoom(1.3, "manual");

    const opened = [];
    const editorHost = element("div");
    const editor = editorHost.createDiv({ cls: "cm-scroller" });
    editor.scrollHeight = 2000;
    editor.clientHeight = 600;
    const leaf = {
      view: { file: null, contentEl: editorHost },
      openFile: async (file, options) => {
        opened.push({ file, options });
        leaf.view.file = file;
      },
    };
    app.workspace.getLeaf = () => leaf;
    let focused = 0;
    app.workspace.setActiveLeaf = () => { focused++; };

    viewport.scrollTop = 1500;
    const expectedPath = view.visibleFeuilletPathAtViewport();
    viewport.dispatch("scroll");
    dom.runTimers();
    await flush();

    assert.equal(opened.length, 1);
    assert.equal(opened[0].file.path, expectedPath);
    assert.deepEqual(opened[0].options, { active: false });
    assert.equal(view.mode, mode, "la portée ne change pas");
    assert.equal(view.synchronizedFeuilletPath, expectedPath);
    assert.equal(view.syncScroller, editor);
    assert.equal(view.zoomScale, 1.3);
    assert.equal(focused, 0, "le scroll de l'aperçu ne vole pas le focus");

    /* L'éditeur neuf se place brièvement au début du fichier. Cet
       événement ne doit jamais faire remonter l'aperçu au début de sa
       section (ni du manuscrit) pendant l'ouverture automatique. */
    const previewPosition = viewport.scrollTop;
    view.lastPreviewScrollAt = 0;
    editor.scrollTop = 0;
    editor.dispatch("scroll");
    dom.runTimers();
    assert.equal(viewport.scrollTop, previewPosition, "l'initialisation de l'éditeur conserve la lecture de l'aperçu");

    viewport.dispatch("scroll");
    dom.runTimers();
    await flush();
    assert.equal(opened.length, 1, "la même section n'est pas rouverte inutilement");
  }));
}

test("mode Chapitre — dans une Partie, seul le chapitre de la scène active est montré", withCapture(async (_dom, rendered) => {
  const { s1a } = await openNestedView("chapter", null);
  const ctx = await openNestedView("chapter", s1a);
  await ctx.view.refreshPreview();
  await flush();

  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Scène A"));
  assert.ok(markdown.includes("Scène B"));
  assert.equal(markdown.includes("Scène C"), false, "le chapitre voisin n'a rien à faire ici");
  assert.equal(markdown.includes("Scène de la deuxième partie"), false);
  assert.equal(ctx.view.displayedPath, "Roman/Manuscrit/Première partie/Chapitre premier");
}));

test("mode Partie — dit clairement quand le projet n'a pas de niveau Partie", withCapture(async () => {
  const { view } = await openLoadedView("scene"); // projet plat, level1Role = chapitres
  await view.setMode("part");
  await flush();

  assert.equal(view.previewFrame, null, "rien n'est rendu");
  const message = view.contentEl.querySelector(".feuillets-preview-empty");
  assert.ok(message);
  assert.match(message.textContent, /aucune partie/i);
}));

test("mode Partie — partFolderOf remonte jusqu'à la PARTIE, jamais au chapitre", () => {
  const { view, s1a, s2a, p1, p2, orphan } = nestedView();
  assert.equal(view.partFolderOf(s1a), p1);
  assert.equal(view.partFolderOf(s2a), p2);
  assert.equal(view.partFolderOf(orphan), null, "un feuillet à la racine n'appartient à aucune partie");

  // Projet configuré en chapitres : il n'y a plus de niveau Partie du tout.
  view.plugin.settings.level1Role = "chapitres";
  assert.equal(view.partFolderOf(s1a), null);
});

test("fil d'Ariane — titres du Binder, niveaux réels et clics de portée", withRender(async () => {
  const ctx = await openNestedView("scene", null);
  const { view, app, s1a } = ctx;
  app.setActiveFile(s1a);
  view.plugin.projectDisplayName = () => "Roman";
  app.metadataCache.getFileCache = (file) => ({ frontmatter: file === s1a ? { short_title: "Titre Binder" } : {} });
  view.updateUI();

  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");
  assert.deepEqual(buttons().map((el) => el.textContent), ["Roman", "Première partie", "Chapitre premier", "Titre Binder"]);
  assert.equal(buttons().at(-1).getAttribute("aria-current"), "page");

  // Le fallback YAML, puis le basename, suivent le résolveur partagé Binder.
  app.metadataCache.getFileCache = (file) => ({ frontmatter: file === s1a ? { title: "Titre YAML" } : {} });
  view.updateUI();
  assert.equal(buttons().at(-1).textContent, "Titre YAML");
  app.metadataCache.getFileCache = () => ({ frontmatter: {} });
  view.updateUI();
  assert.equal(buttons().at(-1).textContent, "01 Été");

  view.setZoom(1.25, "manual");
  const zoomBefore = view.zoomScale;

  /* Une fois une portée explicite posée, le fil d'Ariane est DÉRIVÉ de la
     portée (jamais du fichier actif) et chaque niveau cliquable applique
     setCompileScope() avec la portée correspondante. */
  const projectRoot = view.plugin.getProjectFolder().path;

  // 1. La racine → portée projet.
  buttons()[0].click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "project", projectRoot });
  assert.deepEqual(buttons().map((el) => el.textContent), ["Roman"], "portée projet : un seul niveau (la racine)");
  assert.equal(buttons()[0].getAttribute("aria-current"), "page");

  // 2. Portée dossier → Projet > Dossier, le dossier est actif.
  await view.setCompileScope({ type: "folder", projectRoot, path: ctx.p1.path });
  await flush();
  assert.deepEqual(buttons().map((el) => el.textContent), ["Roman", "Première partie"]);
  assert.equal(buttons().at(-1).getAttribute("aria-current"), "page");

  // 3. Portée fichier → Projet > Dossier > Fichier, le fichier est actif.
  app.metadataCache.getFileCache = (file) => ({ frontmatter: file === ctx.s1a ? { short_title: "Titre Binder" } : {} });
  view.updateUI();
  await view.setCompileScope({ type: "file", projectRoot, path: ctx.s1a.path });
  await flush();
  assert.deepEqual(
    buttons().map((el) => el.textContent),
    ["Roman", "Première partie", "Chapitre premier", "Titre Binder"],
    "c portée fichier reproduit la hiérarchie réelle"
  );
  assert.equal(buttons().at(-1).getAttribute("aria-current"), "page");

  // 4. Clic sur un niveau dossier → setCompileScope(folder) pour CE niveau.
  const partButton = buttons().find((b) => b.textContent === "Première partie");
  partButton.click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "folder", projectRoot, path: ctx.p1.path });

  // 5. Clic sur la racine → retour à la portée projet, zoom conservé.
  buttons()[0].click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "project", projectRoot });
  assert.equal(view.zoomScale, zoomBefore, "les clics de portée conservent le zoom");
}));

test("fil d'Ariane — un chapitre porté par un feuillet n'invente pas de niveau Feuillet", withRender(async () => {
  const { view, app, sceneFile } = await openLoadedView("scene");
  sceneFile.parent = app.vault.getAbstractFileByPath("Manuscrit");
  app.vault.getAbstractFileByPath("Manuscrit").children = [sceneFile];
  view.updateUI();
  const buttons = view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");
  assert.deepEqual(buttons.map((el) => el.textContent), ["Manuscrit", "Scene 1"]);
  buttons[1].click();
  await flush();
  assert.equal(view.mode, "chapter");
}));

/* ---------------- Sous-lot I — gabarits selon le mode ------------------ */

test("gabarits — un seul CSS central, des classes de mode : les folios ne sont masqués qu'en mode Scène", withCapture(async () => {
  for (const mode of ["scene", "chapter", "manuscript"]) {
    const { view } = await openLoadedView(mode);
    const srcdoc = view.previewFrame.srcdoc;

    // Typographie du gabarit : présente dans TOUS les modes.
    assert.match(srcdoc, /font-family: 'Times New Roman'/, `${mode} : la typographie du gabarit doit s'appliquer`);
    assert.match(srcdoc, /<body class="is-preview-mode-[a-z]+">/, `${mode} : une classe de mode doit être posée`);
    assert.ok(srcdoc.includes(`<body class="is-preview-mode-${mode}">`), `${mode} : la bonne classe de mode`);

    // La règle qui masque en-têtes et folios est écrite UNE fois et ne vise
    // que le mode Scène — jamais trois CSS divergents.
    assert.match(srcdoc, /\.is-preview-mode-scene \.pdf-page-header/);
    assert.match(srcdoc, /\.is-preview-mode-scene \.pdf-page-footer \{ display: none/);
  }
}));

/* ------------- Sous-lots E et G — zoom unique, barre masquable --------- */

test("zoom — double-clic sur le pourcentage : retour à 100 %", withRender(async () => {
  const { view } = await openLoadedView("manuscript");
  runMenuItem(view.zoomLabelEl, "150 %");
  assert.equal(view.zoomScale, 1.5);

  view.zoomLabelEl.dispatch("dblclick");
  assert.equal(view.zoomScale, 1, "le double-clic ramène à la taille réelle");
  assert.equal(view.zoomMode, "manual");
  assert.equal(view.zoomLabelEl.textContent, "100 %");
}));

test("barre — aucun bouton de repli séparé", withRender(async () => {
  const { view } = await openLoadedView("manuscript");
  assert.equal(view.btnBarToggle, null);
  assert.equal(view.contentEl.querySelectorAll('[aria-label="Masquer la barre"]').length, 0);
  assert.equal(menuTitles(openMenuVia(view.zoomLabelEl)).includes("Masquer la barre"), false);
}));

test("compileScope — affichage d'une portée file explicite sans écriture ni export", withCapture(async (_dom, rendered) => {
  const { view, sceneFile, sceneFile2 } = await openLoadedView("manuscript");
  let writeCalled = false;
  view.app.vault.modify = async () => { writeCalled = true; };
  view.app.vault.create = async () => { writeCalled = true; };

  await view.setCompileScope({ type: "file", projectRoot: "Manuscrit", path: sceneFile.path });
  await flush();

  assert.equal(writeCalled, false, "aucun fichier ne doit être écrit ni créé");
  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Texte réel de la scène."));
  assert.equal(markdown.includes("Seconde scène du chapitre."), false, "seul le fichier ciblé par la portée file doit être affiché");
}));

test("compileScope — affichage d'une portée folder récursive sans doublons et selon l'ordre du Binder", withCapture(async (_dom, rendered) => {
  const { view, chapterDir } = await openLoadedView("manuscript");

  await view.setCompileScope({ type: "folder", projectRoot: "Manuscrit", path: chapterDir.path });
  await flush();

  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Texte réel de la scène."));
  assert.ok(markdown.includes("Seconde scène du chapitre."));
  const idx1 = markdown.indexOf("Texte réel de la scène.");
  const idx2 = markdown.indexOf("Seconde scène du chapitre.");
  assert.ok(idx1 < idx2, "l'ordre du Binder doit être conservé");
}));

test("compileScope — affichage d'une portée selection explicite sans doublons et avec ordre conservé", withCapture(async (_dom, rendered) => {
  const { view, sceneFile, sceneFile2, chapterDir } = await openLoadedView("manuscript");

  // On sélectionne à la fois le dossier et un fichier enfant pour tester l'absence de doublons
  await view.setCompileScope({ type: "selection", projectRoot: "Manuscrit", paths: [sceneFile2.path, chapterDir.path, sceneFile.path] });
  await flush();

  const markdown = rendered.at(-1);
  const count1 = (markdown.match(/Texte réel de la scène\./g) || []).length;
  const count2 = (markdown.match(/Seconde scène du chapitre\./g) || []).length;
  assert.equal(count1, 1, "aucun doublon pour scene1");
  assert.equal(count2, 1, "aucun doublon pour scene2");

  const idx1 = markdown.indexOf("Texte réel de la scène.");
  const idx2 = markdown.indexOf("Seconde scène du chapitre.");
  assert.ok(idx1 < idx2, "l'ordre du Binder doit être conservé");
}));

test("compileScope — affichage d'une portée project explicite assemblée en mémoire sans écriture ni export", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("manuscript");
  let writeCalled = false;
  view.app.vault.modify = async () => { writeCalled = true; };
  view.app.vault.create = async () => { writeCalled = true; };

  await view.setCompileScope({ type: "project", projectRoot: "Manuscrit" });
  await flush();

  assert.equal(writeCalled, false, "aucun appel à vault.create ni vault.modify ne doit avoir lieu");
  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Texte réel de la scène."));
  assert.ok(markdown.includes("Seconde scène du chapitre."));
  const idx1 = markdown.indexOf("Texte réel de la scène.");
  const idx2 = markdown.indexOf("Seconde scène du chapitre.");
  assert.ok(idx1 < idx2, "l'ordre du Binder doit être conservé");
}));

test("compileScope — sélection multiple non contiguë dans des dossiers différents (un.md et trois.md)", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("manuscript");
  let writeCalled = false;
  view.app.vault.modify = async () => { writeCalled = true; };
  view.app.vault.create = async () => { writeCalled = true; };

  const projectRoot = new TFolder("Projet");
  projectRoot.name = "Projet";
  projectRoot.path = "Projet";

  const chap1 = new TFolder("Projet/Chapitre 1");
  chap1.name = "Chapitre 1";
  chap1.path = "Projet/Chapitre 1";
  chap1.parent = projectRoot;

  const chap3 = new TFolder("Projet/Chapitre 3");
  chap3.name = "Chapitre 3";
  chap3.path = "Projet/Chapitre 3";
  chap3.parent = projectRoot;

  const unFile = new TFile("Projet/Chapitre 1/un.md", "Contenu de un.md");
  unFile.name = "un.md";
  unFile.basename = "un";
  unFile.extension = "md";
  unFile.path = "Projet/Chapitre 1/un.md";
  unFile.parent = chap1;
  unFile.content = "Contenu de un.md";

  const troisFile = new TFile("Projet/Chapitre 3/trois.md", "Contenu de trois.md");
  troisFile.name = "trois.md";
  troisFile.basename = "trois";
  troisFile.extension = "md";
  troisFile.path = "Projet/Chapitre 3/trois.md";
  troisFile.parent = chap3;
  troisFile.content = "Contenu de trois.md";

  chap1.children = [unFile];
  chap3.children = [troisFile];
  projectRoot.children = [chap1, chap3];

  const filesMap = new Map([
    ["Projet", projectRoot],
    ["Projet/Chapitre 1", chap1],
    ["Projet/Chapitre 3", chap3],
    ["Projet/Chapitre 1/un.md", unFile],
    ["Projet/Chapitre 3/trois.md", troisFile],
  ]);

  view.app.vault.getAbstractFileByPath = (path) => filesMap.get(path) || null;
  view.app.vault.read = async (f) => (f && typeof f.content === "string" ? f.content : "");

  /* La compilation passe par getProjectFolder(app, settings) : on aligne le
     projet actif sur l'arbre « Projet » construit par ce test, sinon la
     racine « Manuscrit » du fixture (absente de filesMap) renverrait null. */
  view.plugin.settings.projectFolder = "Projet";

  const scope = {
    type: "selection",
    projectRoot: "Projet",
    paths: ["Projet/Chapitre 1/un.md", "Projet/Chapitre 3/trois.md"],
  };

  const resolved = resolveCompileScopeFiles(view.app, view.plugin.settings, scope);
  assert.equal(resolved.length, 2, "resolveCompileScopeFiles renvoie 2 fichiers");
  assert.equal(resolved[0].path, "Projet/Chapitre 1/un.md");
  assert.equal(resolved[1].path, "Projet/Chapitre 3/trois.md");

  await view.setCompileScope(scope);
  await flush();

  assert.equal(writeCalled, false, "aucune écriture ni export n'a lieu");

  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Contenu de un.md"), "contient le contenu de un.md");
  assert.ok(markdown.includes("Contenu de trois.md"), "contient le contenu de trois.md");

  const idxUn = markdown.indexOf("Contenu de un.md");
  const idxTrois = markdown.indexOf("Contenu de trois.md");
}));

test("fil d'Ariane — le clic sur la racine utilise setCompileScope({ type: 'project' }) sans écriture ni export", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("scene");
  let writeCalled = false;
  view.app.vault.create = async () => { writeCalled = true; };
  view.app.vault.modify = async () => { writeCalled = true; };

  let scopePassed = null;
  const originalSetCompileScope = view.setCompileScope.bind(view);
  view.setCompileScope = async (scope) => {
    scopePassed = scope;
    return originalSetCompileScope(scope);
  };

  const buttons = view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");
  const rootButton = buttons[0];
  assert.ok(rootButton, "le bouton racine du fil d'Ariane doit exister");

  const modeBefore = view.mode;
  rootButton.click();
  await flush();

  assert.ok(scopePassed, "setCompileScope a été appelé");
  assert.deepEqual(scopePassed, {
    type: "project",
    projectRoot: "Manuscrit",
  }, "la portée transmise est { type: 'project', projectRoot: 'Manuscrit' }");

  assert.equal(view.mode, modeBefore, "ne bascule pas vers le mode historique manuscript");
  assert.equal(writeCalled, false, "vault.create et vault.modify ne sont jamais appelés");

  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Texte réel de la scène."), "les fichiers du projet sont rendus en mémoire");
  assert.ok(markdown.includes("Seconde scène du chapitre."), "plusieurs fichiers du projet sont rendus en mémoire");
}));

test("fil d'Ariane — état actif visuel dérivé de la portée CompileScope", withCapture(async (_dom, _rendered) => {
  const { view, chapterDir } = await openLoadedView("scene");
  let writeCalled = false;
  view.app.vault.create = async () => { writeCalled = true; };
  view.app.vault.modify = async () => { writeCalled = true; };

  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // 1. Portée projet : un seul niveau, la racine active.
  await view.setCompileScope({ type: "project", projectRoot: "Manuscrit" });
  await flush();
  const rootBtn = buttons()[0];
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit"], "une portée projet n'a qu'un niveau");
  assert.equal(rootBtn.hasClass("is-current"), true, "le bouton racine possède is-current");
  assert.equal(rootBtn.getAttribute("aria-current"), "page", "aria-current vaut page sur le bouton racine");

  // 2. Portée dossier : Projet > Dossier, le dossier actif, la racine non.
  await view.setCompileScope({ type: "folder", projectRoot: "Manuscrit", path: chapterDir.path });
  await flush();
  const chapBtn = buttons().find((b) => b.textContent.includes("Chapitre"));
  assert.ok(chapBtn, "le bouton dossier apparaît dans le fil d'Ariane");
  assert.equal(chapBtn.getAttribute("aria-current"), "page", "le dossier devient actif");
  assert.equal(buttons()[0].hasClass("is-current"), false, "la racine perd is-current");
  assert.equal(view.compileScope.type, "folder");

  // 3. Le clic sur la racine revient à la portée projet, sans écriture.
  buttons()[0].click();
  await flush();
  assert.equal(view.compileScope.type, "project", "le clic racine applique setCompileScope(project)");
  assert.equal(writeCalled, false, "les clics de portée ne déclenchent ni vault.create ni vault.modify");
}));

test("compileScope — le fonctionnement du mode scene reste inchangé sans portée explicite", withCapture(async (_dom, rendered) => {
  const { view } = await openLoadedView("scene");
  await view.refreshPreview();
  await flush();

  const markdown = rendered.at(-1);
  assert.ok(markdown.includes("Texte réel de la scène."));
}));

test("fil d'Ariane — portée project : le dernier chemin est conservé en navigation cliquable, Projet actif", withCapture(async (_dom, _rendered) => {
  const { view, chapterDir, sceneFile } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  view.app.metadataCache.getFileCache = (file) => ({ frontmatter: file === sceneFile ? { short_title: "Titre Conservé" } : {} });
  view.updateUI();
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // Ouverture directe au niveau Projet SANS historique : uniquement la racine.
  await view.setCompileScope({ type: "project", projectRoot });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit"], "sans historique, une portée project n'affiche que la racine");
  assert.equal(buttons()[0].getAttribute("aria-current"), "page", "la racine est le niveau actif");

  // On ouvre ensuite un feuillet : la navigation déroule Projet › Dossier › Feuillet.
  await view.setCompileScope({ type: "file", projectRoot, path: sceneFile.path });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1", "Titre Conservé"]);
  assert.equal(buttons().at(-1).getAttribute("aria-current"), "page", "le feuillet ouvert est actif");

  // Retour au niveau Projet : le chemin concret est CONSERVÉ et reste cliquable.
  await view.setCompileScope({ type: "project", projectRoot });
  await flush();
  assert.deepEqual(
    buttons().map((b) => b.textContent),
    ["Manuscrit", "Chapitre 1", "Titre Conservé"],
    "le dernier chemin dossier/feuillet est conservé dans la navigation"
  );
  assert.equal(buttons()[0].getAttribute("aria-current"), "page", "Projet reste visuellement le niveau actif");
  assert.equal(buttons()[0].hasClass("is-current"), true);
  assert.equal(buttons().at(-1).getAttribute("aria-current"), "false", "le feuillet conservé n'est pas actif");

  // Clic sur le dossier conservé → scope folder.
  buttons().find((b) => b.textContent === "Chapitre 1").click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "folder", projectRoot, path: chapterDir.path });

  // On réaffiche le feuillet dans la navigation (rapporter la portée file),
  // puis on repasse à la racine : le feuillet reste cliquable.
  await view.setCompileScope({ type: "file", projectRoot, path: sceneFile.path });
  await flush();
  await view.setCompileScope({ type: "project", projectRoot });
  await flush();
  assert.deepEqual(
    buttons().map((b) => b.textContent),
    ["Manuscrit", "Chapitre 1", "Titre Conservé"],
    "après réaffichage du feuillet, le chemin complet reparaît"
  );
  buttons().find((b) => b.textContent === "Titre Conservé").click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "file", projectRoot, path: sceneFile.path });
}));

test("fil d'Ariane — portée selection n'invente aucun descendant", withCapture(async (_dom, _rendered) => {
  const { view } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  await view.setCompileScope({ type: "selection", projectRoot, paths: [`${projectRoot}/Chapitre 1/02-scene.md`] });
  await flush();

  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit"], "une sélection ne montre que la racine, sans inventer de niveau");
  assert.equal(view.compileScope.type, "selection", "CompileScope selection reste la source de vérité");
}));

test("fil d'Ariane — parcours réel Feuillet → Projet → Dossier → Projet → Feuillet", withCapture(async (_dom, _rendered) => {
  const { view, chapterDir, sceneFile } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  view.app.metadataCache.getFileCache = (file) => ({ frontmatter: file === sceneFile ? { short_title: "Feuillet Écrit" } : {} });
  view.updateUI();
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // 1. Le Binder ouvre le feuillet (scope file).
  await view.setCompileScope({ type: "file", projectRoot, path: sceneFile.path });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1", "Feuillet Écrit"], "la ligne initiale est Projet › Dossier › Feuillet");

  // 3. Clic sur le premier libellé (Projet).
  buttons()[0].click();
  await flush();
  assert.equal(view.compileScope.type, "project", "le clic Projet passe en portée project");

  // 4. La ligne GARDE Projet › Dossier › Feuillet, avec Projet actif.
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1", "Feuillet Écrit"]);
  assert.equal(buttons()[0].getAttribute("aria-current"), "page", "Projet est visuellement la portée active");
  assert.equal(buttons()[1].getAttribute("aria-current"), "false");
  assert.equal(buttons()[2].getAttribute("aria-current"), "false");

  // 7. Clic sur Dossier → portée folder.
  buttons().find((b) => b.textContent === "Chapitre 1").click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "folder", projectRoot, path: chapterDir.path });

  // 9. Nouveau clic Projet → Dossier et Feuillet toujours présents.
  buttons()[0].click();
  await flush();
  assert.deepEqual(view.compileScope.type, "project");
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1", "Feuillet Écrit"], "Dossier et Feuillet sont conservés");

  // 11. Clic Feuillet → portée file.
  buttons().find((b) => b.textContent === "Feuillet Écrit").click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "file", projectRoot, path: sceneFile.path });
}));

test("fil d'Ariane — ouverture initiale par dossier", withCapture(async () => {
  const { view, chapterDir } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // 1. Le Binder ouvre d'abord le dossier (scope folder).
  await view.setCompileScope({ type: "folder", projectRoot, path: chapterDir.path });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1"], "Projet › Dossier");

  // 3. Clic Projet → la ligne RESTE Projet › Dossier.
  buttons()[0].click();
  await flush();
  assert.equal(view.compileScope.type, "project");
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit", "Chapitre 1"], "le dossier est conservé");

  // 5. Clic Dossier → à nouveau une portée folder.
  buttons().find((b) => b.textContent === "Chapitre 1").click();
  await flush();
  assert.deepEqual(view.compileScope, { type: "folder", projectRoot, path: chapterDir.path });
}));

test("fil d'Ariane — Projet sans historique", withCapture(async () => {
  const { view } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // Ouverture directement en portée project, sans historique.
  await view.setCompileScope({ type: "project", projectRoot });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit"], "sans historique, la ligne ne contient que Projet");
  assert.equal(buttons().length, 1);
}));

test("fil d'Ariane — sélection n'invente aucune descente même avec un historique", withCapture(async () => {
  const { view, sceneFile } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // Même si lastScopedNav contient d'abord un fichier…
  await view.setCompileScope({ type: "file", projectRoot, path: sceneFile.path });
  await flush();
  assert.equal(view["lastScopedNav"]?.path, sceneFile.path, "un feuillet a d'abord été mémorisé");
  // …une sélection ne montre que la racine.
  await view.setCompileScope({ type: "selection", projectRoot, paths: [`${projectRoot}/Chapitre 1/${sceneFile.name}`] });
  await flush();
  assert.deepEqual(buttons().map((b) => b.textContent), ["Manuscrit"], "une sélection doit montrer uniquement Projet");
  assert.equal(buttons().length, 1, "aucun niveau dossier ni feuillet n'est créé pour une sélection");
}));

test("fil d'Ariane — changement de projet : les dossiers/feuillets du projet A ne fuient pas dans le projet B", withCapture(async () => {
  const { view, sceneFile } = await openLoadedView("scene");
  const projectRoot = view.plugin.getProjectFolder().path;
  const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");

  // 1. Mémorise un fichier dans le projet A ("Manuscrit").
  await view.setCompileScope({ type: "file", projectRoot, path: sceneFile.path });
  await flush();
  assert.equal(
    view["lastScopedNav"].path,
    sceneFile.path,
    "le chemin est mémorisé dans le projet A"
  );

  // 2. Passage explicitement à un scope du projet B.
  await view.setCompileScope({ type: "project", projectRoot: "ZuneB" });
  await flush();
  const titles = buttons().map((b) => b.textContent);
  assert.deepEqual(titles, ["Manuscrit"], "le projet B n'affiche que sa racine");
  assert.equal(titles.includes("Chapitre 1"), false, "le dossier du projet A n'apparaît pas dans le projet B");
}));

test("openScopeWithPreview — l'initialisation RÉELLE du Binder alimente lastScopedNav", async () => {
  const dom = installDom();
  try {
    const { app, settings, manuscript, sceneFile } = buildProject();
    settings.previewMode = "scene";
    const plugin = { settings, getProjectFolder: () => manuscript, saveSettings: async () => {} };
    const leaf = { contentEl: element("div") };
    const view = new PreviewView(leaf, plugin);
    view.app = app;
    await view.onOpen();
    view.updateUI();
    // Titre de feuillet déterministe via short_title dans le frontmatter.
    app.metadataCache.getFileCache = (f) => ({ frontmatter: f === sceneFile ? { short_title: "Feuillet Binder" } : {} });
    // La vue RÉELLE est déjà dans le workspace : openScopeWithPreview la
    // RÉUTILISE et lui transmet la portée par setCompileScope — exactement le
    // parcours employé par le Binder, sans appel artificiel à la mémoire.
    app.workspace.getLeavesOfType = (type) => (type === VIEW_PREVIEW ? [{ view, setViewState: async () => {} }] : []);

    await openScopeWithPreview(app, { type: "file", projectRoot: "Manuscrit", path: "Manuscrit/Chapitre 1/01-scene.md" });
    await flush();

    assert.deepEqual(view["lastScopedNav"], { type: "file", projectRoot: "Manuscrit", path: sceneFile.path }, "l'ouverture réelle nourrit lastScopedNav");
    const buttons = () => view.breadcrumbEl.children.filter((el) => el.tagName === "BUTTON");
    assert.deepEqual(
      buttons().map((b) => b.textContent),
      ["Manuscrit", "Chapitre 1", "Feuillet Binder"],
      "la ligne réellement construite via le Binder est Projet › Dossier › Feuillet"
    );
  } finally {
    dom.restore();
  }
});

test("compileScope — l'Aperçu project ne pose AUCUN fichier sous _Sortie", withCapture(async (_dom, _rendered) => {
  const { view } = await openLoadedView("manuscript");
  const written = [];
  view.app.vault.createFolder = async (p) => { written.push(p); };
  view.app.vault.create = async (p) => { written.push(p); };
  view.app.vault.modify = async () => {};
  const projectRoot = view.plugin.getProjectFolder().path;

  await view.setCompileScope({ type: "project", projectRoot });
  await flush();

  assert.deepEqual(written, [], "aucun dossier ni fichier ne doit être écrit pendant l'Aperçu");
  assert.ok(!view.app.vault.getAbstractFileByPath(`${projectRoot}/_Sortie`), "_Sortie n'existe pas après l'Aperçu");
}));

test("page de titre — en portée project, elle est isolée en page Front, pas rendue en Markdown brut", withCapture(async (_dom, _rendered) => {
  const { view, manuscript } = await openLoadedView("manuscript");
  addFrontPages(manuscript, [{ name: "Page de titre" }]);
  const projectRoot = view.plugin.getProjectFolder().path;

  await view.setCompileScope({ type: "project", projectRoot });
  await flush();

  const srcdoc = String(view.previewFrame?.srcdoc || "");
  assert.ok(srcdoc.includes("feuillets-frontpage-titre"), "la page de titre doit être isolée comme une page Front dans l'Aperçu");
  assert.ok(srcdoc.includes("Grand Roman"), "le titre de la page Front est présent dans le rendu");
  assert.equal(srcdoc.includes("FEUILLETS-FPROLE:"), false, "aucun marqueur de rôle ne doit fuir");
  assert.equal(srcdoc.includes(":::"), false, "aucune syntaxe de rôle brute ne doit être rendue");
}));

test("openScopeWithPreview — ouvre/active la vue Preview et applique setCompileScope sans recréer de vue", async () => {
  const dom = installDom();
  try {
    const app = {
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => ({
          setViewState: async () => {},
        }),
        revealLeaf: () => {},
      },
    };
    let activeLeafCount = 0;
    let scopePassed = null;

    const mockPreviewView = {
      setCompileScope: async (scope) => { scopePassed = scope; },
    };

    const existingLeaf = {
      view: mockPreviewView,
      setViewState: async () => {},
    };

    app.workspace.getLeavesOfType = (type) => (type === VIEW_PREVIEW ? [existingLeaf] : []);
    app.workspace.revealLeaf = () => { activeLeafCount++; };

    await openScopeWithPreview(app, { type: "file", projectRoot: "Manuscrit", path: "Manuscrit/scene.md" });

    assert.equal(activeLeafCount, 1, "la vue existante est révélée");
    assert.deepEqual(scopePassed, { type: "file", projectRoot: "Manuscrit", path: "Manuscrit/scene.md" });
  } finally {
    dom.restore();
  }
});

test("openWithPreview — initialise CompileScope file, alimente lastScopedNav et préserve les boutons frères après clic sur Projet", withRender(async () => {
  const { view, app, plugin, s1a } = await openNestedView("scene", null);
  view.plugin.shortTitleFor = () => null;
  app.metadataCache.getFileCache = () => ({ frontmatter: {} });

  // 1 & 2. Appel réel à openWithPreview(app, plugin, s1a)
  app.workspace.getLeavesOfType = (type) => (type === VIEW_PREVIEW ? [{ view }] : []);
  app.workspace.getLeaf = () => ({ openFile: async () => {} });
  app.workspace.setActiveLeaf = () => {};

  await openWithPreview(app, plugin, s1a);
  await flush();

  // 4. compileScope est de type file
  assert.ok(view.compileScope !== null, "compileScope n'est pas null");
  assert.equal(view.compileScope.type, "file");
  assert.equal(view.compileScope.path, s1a.path);

  // 5. lastScopedNav contient le fichier
  assert.ok(view.lastScopedNav !== null, "lastScopedNav n'est pas null");
  assert.equal(view.lastScopedNav.type, "file");
  assert.equal(view.lastScopedNav.path, s1a.path);

  const getButtons = () =>
    Array.from(view.breadcrumbEl.querySelectorAll(".feuillets-preview-breadcrumb-item"));

  const getButtonLabels = () => getButtons().map((b) => b.textContent.trim());

  // 6. Fil d'Ariane affiche Projet › Dossier › Feuillet
  assert.deepEqual(getButtonLabels(), ["Manuscrit", "Première partie", "Chapitre premier", "01 Été"]);

  // 7. Clic sur Projet
  const projectBtn = getButtons().find((b) => b.textContent.trim() === "Manuscrit");
  assert.ok(projectBtn, "bouton Projet trouvé");
  projectBtn.click();
  await flush();

  // 8. compileScope devient project
  assert.equal(view.compileScope.type, "project");

  // 9. La ligne affiche toujours Projet › Dossier › Feuillet
  assert.deepEqual(getButtonLabels(), ["Manuscrit", "Première partie", "Chapitre premier", "01 Été"]);

  // 10. Dossier et Feuillet restent cliquables
  const folderBtn = getButtons().find((b) => b.textContent.trim() === "Chapitre premier");
  assert.ok(folderBtn, "bouton Dossier trouvé");
  folderBtn.click();
  await flush();
  assert.equal(view.compileScope.type, "folder");
  assert.equal(view.compileScope.path, s1a.parent.path);

  const fileBtn = getButtons().find((b) => b.textContent.trim() === "01 Été");
  assert.ok(fileBtn, "bouton Feuillet trouvé");
  fileBtn.click();
  await flush();
  assert.equal(view.compileScope.type, "file");
  assert.equal(view.compileScope.path, s1a.path);
}));

test("openWithPreview — une feuille d'aperçu réutilisée mais DIFFÉRÉE (Obsidian ≥ 1.7) reçoit quand même setCompileScope", withRender(async () => {
  const { view, app, plugin, s1a } = await openNestedView("scene", null);
  view.plugin.shortTitleFor = () => null;
  app.metadataCache.getFileCache = () => ({ frontmatter: {} });

  /* Reproduit une feuille d'aperçu déjà ouverte dans le workspace mais
     encore DIFFÉRÉE : `.view` est un simple placeholder sans setCompileScope
     tant que `loadIfDeferred()` n'a pas été appelé — exactement ce que fait
     Obsidian pour une feuille restaurée par la mise en page et pas encore
     visible. Avant le correctif, openWithPreview() lisait `.view` avant tout
     chargement et abandonnait silencieusement (garde de type), laissant
     `compileScope`/`lastScopedNav` intacts (nuls) : le clic sur « Projet »
     s'appuyait alors pour la première fois sur une mémoire vide. */
  const placeholderView = {};
  const deferredLeaf = {
    isDeferred: true,
    loadIfDeferred: async () => {
      deferredLeaf.isDeferred = false;
      deferredLeaf.view = view;
    },
    view: placeholderView,
  };

  app.workspace.getLeavesOfType = (type) => (type === VIEW_PREVIEW ? [deferredLeaf] : []);
  app.workspace.getLeaf = () => ({ openFile: async () => {} });
  app.workspace.setActiveLeaf = () => {};

  await openWithPreview(app, plugin, s1a);
  await flush();

  assert.ok(view.compileScope !== null, "la portée file doit atteindre la VRAIE vue malgré le report de chargement");
  assert.equal(view.compileScope.type, "file");
  assert.equal(view.compileScope.path, s1a.path);
  assert.equal(view.lastScopedNav?.path, s1a.path, "lastScopedNav doit être nourri dès la première ouverture");

  const getButtons = () =>
    Array.from(view.breadcrumbEl.querySelectorAll(".feuillets-preview-breadcrumb-item"));
  const getButtonLabels = () => getButtons().map((b) => b.textContent.trim());
  assert.deepEqual(getButtonLabels(), ["Manuscrit", "Première partie", "Chapitre premier", "01 Été"]);

  const projectBtn = getButtons().find((b) => b.textContent.trim() === "Manuscrit");
  projectBtn.click();
  await flush();

  assert.equal(view.compileScope.type, "project");
  assert.deepEqual(
    getButtonLabels(),
    ["Manuscrit", "Première partie", "Chapitre premier", "01 Été"],
    "Dossier et Feuillet doivent rester dans le fil d'Ariane après le passage à Projet"
  );
}));


