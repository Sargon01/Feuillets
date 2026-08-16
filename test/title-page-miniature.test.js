import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Setting, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { DEFAULT_SETTINGS } = await import(modulePath("src/default-settings.js"));
const { LayoutEditor } = await import(modulePath("src/ui/layout-editor.js"));
const { TitlePageMiniature } = await import(modulePath("src/ui/title-page-miniature.js"));

/* §28-§32 du chantier « espace central » : la maquette de la page de titre
 * est UN SEUL composant partagé (ui/title-page-miniature.ts), monté par le
 * LayoutModal historique ET par Mise en page → Première page. Elle est
 * dynamique (le ratio suit la géométrie réelle de la page) et ne manipule que
 * les rôles déjà présents dans `titlePage.styles`. */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.style = {};
    this.settings = [];
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, active) { if (active) this.classes.add(name); else this.classes.delete(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  empty() { this.children = []; this.settings = []; }
  setText(text) { this.text = String(text); return this; }
  querySelectorAll(selector) {
    if (selector !== 'input[type="number"]') return [];
    const found = [];
    const visit = (node) => {
      for (const setting of node.settings) {
        if (setting.kind === "text" && setting.inputEl.type === "number") found.push(setting.inputEl);
      }
      for (const child of node.children) visit(child);
    };
    visit(this);
    return found;
  }
}

function installSettingStub() {
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText", "then"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const add = (kind, parent, configure) => {
    const control = {
      kind,
      options: [],
      inputEl: { type: "text", value: "" },
      extraSettingsEl: new FakeElement(),
      addOption(value, label) { this.options.push({ value, label }); return this; },
      setValue(value) { this.value = value; this.inputEl.value = value; return this; },
      setPlaceholder(value) { this.placeholder = value; return this; },
      setIcon(value) { this.icon = value; return this; },
      setTooltip(value) { this.tooltip = value; return this; },
      setButtonText(value) { this.text = value; return this; },
      setCta() { this.cta = true; return this; },
      onClick(callback) { this.click = callback; return this; },
      onChange(callback) { this.change = callback; return this; },
    };
    parent.settings.push(control);
    configure(control);
    return control;
  };
  Setting.prototype.setName = function setName(name) { this.name = name; return this; };
  Setting.prototype.addButton = function addButton(configure) { add("button", this.container, configure); return this; };
  Setting.prototype.addDropdown = function addDropdown(configure) { add("dropdown", this.container, configure); return this; };
  Setting.prototype.addExtraButton = function addExtraButton(configure) { add("extra", this.container, configure); return this; };
  Setting.prototype.addToggle = function addToggle(configure) { add("toggle", this.container, configure); return this; };
  Setting.prototype.addText = function addText(configure) { add("text", this.container, configure); return this; };
  Setting.prototype.then = function then(callback) { callback(this); return this; };
  return () => Object.assign(Setting.prototype, previous);
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function buildEditor() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const { vault, fileManager } = createFakeVault([volume, manuscript]);
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(settings, { projectFolder: manuscript.path, exportTemplate: "classique" });
  const calls = { frontmatter: [], change: 0 };
  fileManager.processFrontMatter = async (file, update) => {
    const frontmatter = {};
    update(frontmatter);
    calls.frontmatter.push({ file, frontmatter });
  };
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const plugin = { settings, async saveSettings() {} };
  const host = new FakeElement();
  const editor = new LayoutEditor(app, plugin, host, "classique", {
    mode: "workspace",
    onChange: () => { calls.change += 1; },
  });
  return { editor, host, calls };
}

async function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  try {
    await run(listeners);
  } finally {
    globalThis.document = previousDocument;
  }
}

/* ============ §29 : une SEULE implémentation de la maquette ============= */

test("maquette : LayoutModal ne réimplémente plus buildBlocks/layout/renderBands/startDrag", () => {
  const source = readFileSync("src/ui/layout-modal.ts", "utf8");
  assert.match(source, /new TitlePageMiniature/);
  // Les quatre méthodes ne subsistent que comme délégations d'une ligne.
  for (const delegation of [
    "buildBlocks(): void { this.miniature.mount(); }",
    "layout(): void { this.miniature.layout(); }",
    "renderBands(): void { this.miniature.renderBands(); }",
    "startDrag(e: PointerEvent, role: string): void { this.miniature.startDrag(e, role); }",
  ]) {
    assert.ok(source.includes(delegation), `délégation attendue : ${delegation}`);
  }
  assert.doesNotMatch(source, /const SCALE =/, "plus d'échelle A4 figée dans la modale");
  assert.doesNotMatch(source, /PAGE_USABLE_PT/);
});

test("maquette : la géométrie vient du helper commun, jamais d'une seconde table de dimensions", () => {
  const source = readFileSync("src/ui/title-page-miniature.ts", "utf8");
  assert.match(source, /resolvePageGeometry/);
  assert.doesNotMatch(source, /\b297\b/, "aucune dimension A4 codée en dur");
  assert.doesNotMatch(source, /\b210\b/);
});

/* ============ §30 : ratio dynamique ==================================== */

test("maquette : le ratio suit l'orientation réelle — A4 portrait plus haute que large", () => {
  const restore = installSettingStub();
  try {
    const { editor } = buildEditor();
    editor.template = { page: { size: "A4", orientation: "portrait", marginsCm: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } }, header: { enabled: true, left: "", right: "" }, footer: { right: "" }, firstPage: { hideHeader: false, pageNumberPosition: "right" }, titlePage: { styles: {} } };
    editor.styles = {};
    editor.roles = [];
    const host = new FakeElement();
    const miniature = new TitlePageMiniature(host, editor, { heightPx: 400 });
    miniature.mount();
    assert.equal(miniature.pageEl.style.height, "400px");
    assert.equal(miniature.pageEl.style.width, "283px");
  } finally { restore(); }
});

test("maquette : A4 paysage produit une page plus large que haute", () => {
  const restore = installSettingStub();
  try {
    const { editor } = buildEditor();
    editor.template = { page: { size: "A4", orientation: "landscape", marginsCm: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } }, header: { enabled: true, left: "", right: "" }, footer: { right: "" }, firstPage: { hideHeader: false, pageNumberPosition: "right" }, titlePage: { styles: {} } };
    editor.styles = {};
    editor.roles = [];
    const host = new FakeElement();
    const miniature = new TitlePageMiniature(host, editor, { heightPx: 200 });
    miniature.mount();
    assert.equal(miniature.pageEl.style.width, "283px");
    assert.ok(Number.parseInt(miniature.pageEl.style.width, 10) > 200, "la largeur dépasse la hauteur");
  } finally { restore(); }
});

test("maquette : A5 et Letter ont des ratios différents d'A4", () => {
  const restore = installSettingStub();
  try {
    const { editor } = buildEditor();
    const widths = {};
    for (const size of ["A4", "A5", "Letter"]) {
      editor.template = { page: { size, orientation: "portrait", marginsCm: { top: 2, bottom: 2, left: 2, right: 2 } }, header: { enabled: true, left: "", right: "" }, footer: { right: "" }, firstPage: { hideHeader: false, pageNumberPosition: "right" }, titlePage: { styles: {} } };
      editor.styles = {};
      editor.roles = [];
      const miniature = new TitlePageMiniature(new FakeElement(), editor, { heightPx: 400 });
      miniature.mount();
      widths[size] = miniature.pageEl.style.width;
    }
    const px = (value) => Number.parseInt(value, 10);
    assert.notEqual(widths.A4, widths.Letter, "A4 et Letter n'ont pas le même ratio");
    assert.ok(Math.abs(px(widths.A4) - px(widths.A5)) <= 1, "A4 et A5 partagent le ratio √2, à l'arrondi près");
    assert.ok(px(widths.Letter) > px(widths.A4), "Letter est proportionnellement plus large");
  } finally { restore(); }
});

/* ============ §28 : uniquement sous « Première page » ================== */

test("Mise en page : la maquette n'apparaît QUE dans Première page", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor();
    await editor.load();

    for (const category of ["page", "body", "headings", "blockquote"]) {
      editor.select(category);
      assert.equal(editor.miniature, null, `aucune maquette dans ${category}`);
      assert.equal(
        allElements(host).some((el) => el.hasClass("feuillets-tp-page")),
        false,
        `aucune page maquette rendue dans ${category}`
      );
    }

    editor.select("firstPage");
    assert.ok(editor.miniature, "la maquette est montée dans Première page");
    assert.ok(allElements(host).some((el) => el.hasClass("feuillets-tp-page")));
  } finally { restore(); }
});

/* ============ §31 : interactions identiques au contrat historique ====== */

test("Mise en page → Première page : cliquer un bloc sélectionne son rôle dans l'inspecteur", async () => {
  const restore = installSettingStub();
  try {
    const { editor } = buildEditor();
    await editor.load();
    editor.select("firstPage");

    const role = editor.roles[0];
    assert.ok(role, "le gabarit classique expose au moins un rôle de page de titre");
    const block = editor.miniature.blockEls[role];
    assert.ok(block, "le bloc du rôle est rendu");

    await withFakeDocument(async (listeners) => {
      block.events.get("pointerdown")({ clientY: 0, preventDefault() {} });
      listeners.get("pointerup") && await listeners.get("pointerup")();
    });

    assert.equal(editor.selected, "firstPage", "on ne quitte jamais la catégorie Première page");
    assert.equal(editor.selectedRole, role, "l'inspecteur affiche le rôle cliqué");
  } finally { restore(); }
});

test("Mise en page → Première page : le glisser modifie marginTopPt et ne sauvegarde qu'au relâchement", async () => {
  const restore = installSettingStub();
  try {
    const { editor, calls } = buildEditor();
    await editor.load();
    editor.select("firstPage");
    const role = editor.roles[0];
    const before = editor.styles[role].marginTopPt || 0;

    await withFakeDocument(async (listeners) => {
      editor.miniature.startDrag({ clientY: 100, preventDefault() {} }, role);
      assert.equal(calls.frontmatter.length, 0, "aucune écriture prématurée pendant le glisser");
      listeners.get("pointermove")({ clientY: 140 });
      assert.ok(editor.styles[role].marginTopPt > before, "la marge existante augmente vers le bas");
      assert.equal(calls.frontmatter.length, 0, "toujours aucune écriture pendant le mouvement");
      await listeners.get("pointerup")();
      assert.equal(listeners.size, 0, "les écouteurs globaux sont retirés");
    });

    assert.equal(calls.frontmatter.length, 1, "une seule écriture, au relâchement");
    assert.equal(calls.change, 1, "le vrai Preview est rafraîchi une fois");
  } finally { restore(); }
});

test("Mise en page → Première page : le glisser ne borne jamais sous zéro", async () => {
  const restore = installSettingStub();
  try {
    const { editor } = buildEditor();
    await editor.load();
    editor.select("firstPage");
    const role = editor.roles[0];

    await withFakeDocument(async (listeners) => {
      editor.miniature.startDrag({ clientY: 500, preventDefault() {} }, role);
      listeners.get("pointermove")({ clientY: -5000 });
      assert.equal(editor.styles[role].marginTopPt, 0);
      await listeners.get("pointerup")();
    });
  } finally { restore(); }
});

/* ============ §32 : aucun mini-InDesign ================================ */

test("maquette : aucun objet libre, calque, poignée de redimensionnement ni création de rôle", () => {
  const source = readFileSync("src/ui/title-page-miniature.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["resize", "layer", "createRole", "addRole", "zIndex", "draggable"]) {
    assert.doesNotMatch(code, new RegExp(forbidden, "i"), `aucune notion de ${forbidden} dans le code`);
  }
  // Les blocs viennent EXCLUSIVEMENT des rôles déjà présents dans le modèle.
  assert.match(source, /for \(const role of this\.roles\)/);
});

test("maquette : elle n'écrit jamais ailleurs que dans le modèle V2 via l'éditeur", () => {
  const source = readFileSync("src/ui/title-page-miniature.ts", "utf8");
  assert.match(source, /this\.editor\.saveModel\(\)/);
  assert.doesNotMatch(source, /saveSettings/);
  assert.doesNotMatch(source, /settings\.pdf/);
});

/* ============ §33/§34 : contrat de layout de l'espace central =========== */

/** Bloc de règles d'un sélecteur exact, tel qu'écrit dans styles.css. */
function ruleBlock(css, selector) {
  const index = css.indexOf(`\n${selector} {`);
  assert.ok(index >= 0, `règle ${selector} absente de styles.css`);
  const start = css.indexOf("{", index);
  return css.slice(start + 1, css.indexOf("}", start));
}

test("CSS : la racine Édition empile nav figée + corps extensible et ne défile jamais elle-même", () => {
  const css = readFileSync("styles.css", "utf8");
  const root = ruleBlock(css, ".feuillets-layout-workspace");
  for (const declaration of ["display: flex", "flex-direction: column", "height: 100%", "min-height: 0", "min-width: 0", "overflow: hidden"]) {
    assert.ok(root.includes(declaration), `racine Édition : ${declaration}`);
  }
  assert.equal(root.includes("overflow-y: auto"), false, "la racine ne porte plus le défilement");

  const nav = ruleBlock(css, ".feuillets-edition-mode-nav");
  assert.ok(nav.includes("flex: 0 0 auto"), "la barre de modes est figée");

  const body = ruleBlock(css, ".feuillets-edition-mode-body");
  for (const declaration of ["flex: 1 1 auto", "min-height: 0", "min-width: 0", "overflow: hidden"]) {
    assert.ok(body.includes(declaration), `corps de mode : ${declaration}`);
  }
});

test("CSS : la surface d'un mode est l'UNIQUE zone défilante verticalement", () => {
  const css = readFileSync("styles.css", "utf8");
  const surface = ruleBlock(css, ".feuillets-edition-mode-surface");
  for (const declaration of ["width: 100%", "min-width: 0", "min-height: 0", "overflow-y: auto"]) {
    assert.ok(surface.includes(declaration), `surface de mode : ${declaration}`);
  }
  assert.ok(surface.includes("overflow-x: hidden"), "aucun défilement horizontal parasite");
});

test("CSS : la surface centrale de BoardView suit le même contrat", () => {
  const css = readFileSync("styles.css", "utf8");
  const surface = ruleBlock(css, ".feuillets-central-surface");
  for (const declaration of ["flex: 1 1 auto", "min-height: 0", "min-width: 0", "overflow: hidden"]) {
    assert.ok(surface.includes(declaration), `surface centrale : ${declaration}`);
  }
});

test("CSS : le mode actif est signalé discrètement, jamais par un rectangle plein", () => {
  const css = readFileSync("styles.css", "utf8");
  const active = ruleBlock(css, ".feuillets-edition-mode-item.is-active");
  assert.ok(active.includes("background: transparent"), "aucun aplat de fond sur l'onglet actif");
  assert.ok(active.includes("box-shadow: inset 0 -2px 0 var(--interactive-accent)"), "filet d'accent en bas");
  const item = ruleBlock(css, ".feuillets-edition-mode-item");
  assert.ok(item.includes("background: transparent"), "onglets inactifs transparents");
  assert.ok(item.includes("border: none"), "aucun contour de bouton");
  assert.ok(item.includes("var(--font-ui-small)"), "typographie d'interface native");
});
