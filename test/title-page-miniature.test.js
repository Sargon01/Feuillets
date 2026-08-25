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
const { t } = await import(modulePath("src/i18n/index.js"));

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
  prepend(child) { this.children = [child, ...this.children.filter((c) => c !== child)]; }
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

function buildEditor(options = {}) {
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
    ...options,
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

/* ==================================================================
 * CORRECTIF PROMPT 2/3, §7-§10 : LayoutEditor.workspaceNavigation —
 * "rail" (historique) vs "summary" (panneau droit). Même fixture
 * buildEditor() que la maquette ci-dessus (vrai coffre en mémoire, vrai
 * ExportTemplateV2 chargé via load()) — aucun inspecteur ni aucune
 * sauvegarde n'est mocké : les mêmes renderPageInspector/renderBody-
 * Inspector/renderHeadingsInspector/renderBlockquoteInspector et le même
 * saveTemplate() sont réutilisés tels quels.
 * ================================================================== */

function summaryRows(host) {
  return allElements(host).filter((el) => el.classes.has("feuillets-layout-summary-row"));
}

function summaryLabels(host) {
  return summaryRows(host).map((row) =>
    allElements(row).find((el) => el.classes.has("feuillets-layout-summary-label"))?.text
  );
}

function openSummaryRow(host, index) {
  summaryRows(host)[index].events.get("click")();
}

function currentInspector(host) {
  return allElements(host).find((el) => el.classes.has("feuillets-layout-inspector"));
}

function backText(host) {
  const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
  if (!backBtn) return "";
  return allElements(backBtn)
    .map((el) => (typeof el.textContent === "string" ? el.textContent : el.text || ""))
    .join(" ")
    .trim();
}

function visibleText(host) {
  return allElements(host)
    .map((el) => [el.text, typeof el.textContent === "string" ? el.textContent : ""].filter(Boolean).join(" "))
    .join(" ")
    .trim();
}

test("LayoutEditor : navigation par défaut = rail (sans workspaceNavigation, comportement historique inchangé)", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor();
    await editor.load();

    assert.equal(editor.workspaceNavigation, "rail");
    assert.ok(editor.navEl, "rail latéral construit");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-nav")), "colonne .feuillets-layout-nav présente");
    assert.equal(editor.selected, "page", "Page sélectionnée par défaut, comme avant ce correctif");
  } finally {
    restore();
  }
});

test("LayoutEditor : workspaceNavigation: \"rail\" explicite conserve la navigation latérale historique", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "rail" });
    await editor.load();

    assert.equal(editor.workspaceNavigation, "rail");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-nav")));
  } finally {
    restore();
  }
});

test("LayoutEditor : workspaceNavigation: \"summary\" affiche les rubriques papier et Diapos dans cet ordre", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();

    assert.deepEqual(summaryLabels(host), [
      t("modal.layout.categoryPage"),
      t("modal.layout.categoryText"),
      t("modal.layout.categoryHeadings"),
      t("modal.layout.categoryElements"),
      t("layoutWorkspace.slides"),
    ]);
  } finally {
    restore();
  }
});

test("LayoutEditor : en summary, aucune colonne .feuillets-layout-nav historique n'est affichée", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();

    assert.equal(editor.navEl, null);
    assert.equal(allElements(host).some((el) => el.classes.has("feuillets-layout-nav")), false);
  } finally {
    restore();
  }
});

test("LayoutEditor : en summary, aucun inspecteur n'est affiché tant qu'une catégorie n'est pas choisie", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();

    assert.equal(editor.selected, null, "aucune catégorie sélectionnée sur le sommaire");
    assert.equal(currentInspector(host), undefined, "aucun .feuillets-layout-inspector monté");
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Page (summary) affiche une liste avec 4 sous-pages", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Ouvrir Page

    // Vérifier qu'on a une liste (pas le sommaire des 4 domaines)
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-summary")), "liste affichée");
    const rows = summaryLabels(host);
    assert.equal(rows.length, 4, "4 sous-pages affichées");
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Page > Format (summary) affiche l'inspecteur Format existant", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Ouvrir Page
    openSummaryRow(host, 0); // Ouvrir Format

    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, "barre Retour affichée");
    const insp = currentInspector(host);
    assert.ok(insp, "inspecteur monté");
    assert.ok(insp._settings.some((s) => s.name === t("modal.layout.format")), "l'inspecteur Format existant est bien réutilisé");
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Texte (summary) affiche une liste avec 3 sous-pages", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Ouvrir Texte

    const rows = summaryLabels(host);
    assert.equal(rows.length, 3, "3 sous-pages affichées");
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Texte > Options (summary) affiche l'inspecteur Body existant", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Ouvrir Texte
    openSummaryRow(host, 2); // Ouvrir Options

    const insp = currentInspector(host);
    assert.ok(insp._settings.some((s) => s.name === t("modal.layout.profile")), "l'inspecteur Body existant (Profil) est bien réutilisé");
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Titres (summary) affiche une liste avec H1-H6", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 2); // Ouvrir Titres

    const rows = summaryLabels(host);
    assert.deepEqual(rows, [
      t("modal.layout.h1"),
      t("modal.layout.h2"),
      t("modal.layout.h3"),
      t("modal.layout.h4"),
      t("modal.layout.h5"),
      t("modal.layout.h6"),
    ]);
  } finally {
    restore();
  }
});

test("LayoutEditor : clic Éléments > Citations en bloc (summary) utilise l'inspecteur Blockquote existant", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 3); // Ouvrir Éléments
    openSummaryRow(host, 0); // Ouvrir Citations en bloc

    assert.equal(editor.selected, "blockquote");
    const insp = currentInspector(host);
    assert.ok(allElements(insp).some((el) => el.tag === "h4" && el.text === t("modal.layout.blockquoteTitle")), "l'inspecteur Blockquote existant est réutilisé");
  } finally {
    restore();
  }
});

test("LayoutEditor : Retour à Mise en page revient au sommaire sans modifier le template", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Ouvrir Page (domaine)
    const before = JSON.stringify(editor.template);

    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")();

    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-summary")), "le sommaire réapparaît");
    assert.equal(summaryLabels(host).length, 5, "5 rubriques affichées, dont Diapos");
    assert.equal(JSON.stringify(editor.template), before, "le template n'est pas modifié par Retour");
  } finally {
    restore();
  }
});

test("LayoutEditor : modifier une propriété depuis l'inspecteur summary utilise toujours saveTemplate/saveExportTemplateV2", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host, calls } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 0); // Format et orientation
    const insp = currentInspector(host);
    const formatControl = insp.settings[0];
    assert.equal(editor.template.page.size, "A4");

    await formatControl.change("A5");

    assert.equal(editor.template.page.size, "A5", "la même donnée ExportTemplateV2 est modifiée");
    assert.equal(calls.frontmatter.length, 1, "saveExportTemplateV2 (frontmatter) a bien été appelé — aucun second mécanisme de sauvegarde");
    assert.equal(calls.change, 1, "onChange (refresh Preview) déclenché via le même notifyChange()");
  } finally {
    restore();
  }
});

/* ==================================================================
 * MICRO-LOT « UNE PAGE À LA FOIS » : chaque clic retire entièrement la
 * page précédente du DOM — jamais deux niveaux visibles côte à côte.
 * Les tests vérifient la DISPARITION réelle des pages, pas seulement
 * le contenu de la page courante.
 * ================================================================== */

test("DOM summary TEST 1 — HOME contient Page, Texte, Titres, Éléments, sans barre Retour", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();

    assert.deepEqual(summaryLabels(host), [
      t("modal.layout.categoryPage"),
      t("modal.layout.categoryText"),
      t("modal.layout.categoryHeadings"),
      t("modal.layout.categoryElements"),
      t("layoutWorkspace.slides"),
    ]);
    assert.equal(allElements(host).some((el) => el.classes.has("feuillets-layout-summary-back")), false, "pas de bouton Retour sur le HOME");
    assert.equal(currentInspector(host), undefined, "aucun inspecteur détaillé sur le HOME");
  } finally {
    restore();
  }
});

test("DOM summary TEST 2 — HOME → Page : le HOME disparaît, seule la page Page (4 sous-pages) reste", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page

    const labels = summaryLabels(host);
    assert.deepEqual(labels, [
      t("modal.layout.format"),
      t("modal.layout.marginsGroup"),
      t("modal.layout.header"),
      t("modal.layout.footer"),
    ], "les 4 sous-pages de Page, plus aucune entrée HOME");
    assert.ok(!labels.includes(t("modal.layout.categoryText"), "Texte n'est plus une entrée HOME"));
    assert.ok(!labels.includes(t("modal.layout.categoryHeadings"), "Titres n'est plus une entrée HOME"));
    assert.ok(!labels.includes(t("modal.layout.categoryElements"), "Éléments n'est plus une entrée HOME"));
    assert.equal(backText(host), t("layoutWorkspace.displayText"), "Retour vers Mise en page");
  } finally {
    restore();
  }
});

test("DOM summary TEST 3 — PAGE → Marges : menu Page absent, inspecteur Marges seul, Retour Page", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 1); // Marges et colonnes

    assert.equal(summaryRows(host).length, 0, "plus aucune ligne summary (menu Page absent)");
    const labels = summaryLabels(host);
    assert.ok(!labels.includes(t("modal.layout.format")), "Format et orientation absent du DOM");
    assert.ok(!labels.includes(t("modal.layout.header")), "En-tête absent du DOM");
    assert.ok(!labels.includes(t("modal.layout.footer")), "Pied de page absent du DOM");
    const insp = currentInspector(host);
    assert.ok(insp, "inspecteur présent");
    assert.ok(insp._settings.some((s) => s.name === t("modal.layout.marginTop")), "inspecteur Marges (Haut) présent");
    assert.ok(backText(host).includes(t("modal.layout.categoryPage")), "Retour vers Page");
  } finally {
    restore();
  }
});

test("DOM summary TEST 4 — Retour Page : inspecteur Marges disparu, les 4 entrées Page reviennent", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 1); // Marges et colonnes
    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")();

    const marginsPresent = allElements(host).some((el) => (el._settings || []).some((s) => s.name === t("modal.layout.marginTop")));
    assert.ok(!marginsPresent, "inspecteur Marges disparu");
    assert.deepEqual(summaryLabels(host), [
      t("modal.layout.format"),
      t("modal.layout.marginsGroup"),
      t("modal.layout.header"),
      t("modal.layout.footer"),
    ], "les 4 entrées Page reviennent");
    assert.equal(backText(host), t("layoutWorkspace.displayText"), "Retour vers Mise en page");
  } finally {
    restore();
  }
});

test("DOM summary TEST 5 — Retour Mise en page : menu Page disparu, le HOME revient", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")();

    assert.deepEqual(summaryLabels(host), [
      t("modal.layout.categoryPage"),
      t("modal.layout.categoryText"),
      t("modal.layout.categoryHeadings"),
      t("modal.layout.categoryElements"),
      t("layoutWorkspace.slides"),
    ], "le HOME revient");
    assert.equal(allElements(host).some((el) => el.classes.has("feuillets-layout-summary-back")), false, "plus de bouton Retour sur le HOME");
  } finally {
    restore();
  }
});

test("DOM summary TEST 6 — Texte → Paragraphes : menu Texte absent, inspecteur Paragraphes seul, Retour Texte", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Texte
    openSummaryRow(host, 1); // Paragraphes

    assert.equal(summaryRows(host).length, 0, "menu Texte absent du DOM");
    const insp = currentInspector(host);
    assert.ok(insp, "inspecteur présent");
    assert.ok(insp._settings.some((s) => s.name === t("modal.layout.lineHeight")), "inspecteur Paragraphes (Interligne) présent");
    assert.ok(backText(host).includes(t("modal.layout.categoryText")), "Retour vers Texte");
  } finally {
    restore();
  }
});

test("DOM summary TEST 7 — Titres → H1 : liste H1-H6 absente, inspecteur H1 présent, Retour Titres", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 2); // Titres
    openSummaryRow(host, 0); // H1

    assert.equal(summaryRows(host).length, 0, "liste H1-H6 absente du DOM");
    const insp = currentInspector(host);
    assert.ok(insp, "inspecteur présent");
    assert.ok(insp._settings.some((s) => s.name === t("modal.layout.sizePt")), "inspecteur H1 (Taille) présent");
    assert.ok(backText(host).includes(t("modal.layout.categoryHeadings")), "Retour vers Titres");
  } finally {
    restore();
  }
});

test("DOM summary TEST 8 — Éléments → Citations : menu Éléments absent, aucun Séparateur de scène, inspecteur blockquote présent", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 3); // Éléments
    openSummaryRow(host, 0); // Citations en bloc

    assert.equal(summaryRows(host).length, 0, "menu Éléments absent du DOM");
    assert.ok(!visibleText(host).includes(t("modal.layout.sceneSeparatorsShort")), "Séparateurs de scène absent du DOM");
    const insp = currentInspector(host);
    assert.ok(insp, "inspecteur présent");
    assert.ok(allElements(insp).some((el) => el.tag === "h4" && el.text === t("modal.layout.blockquoteTitle")), "inspecteur Blockquote présent");
    assert.ok(backText(host).includes(t("modal.layout.categoryElements")), "Retour vers Éléments");
  } finally {
    restore();
  }
});

test("DOM summary TEST 9 — Police : résumé affiche la famille simple, jamais la pile technique", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    editor.template.body.fontFamily = "'Times New Roman', Times, serif";

    const text = visibleText(host);
    assert.ok(text.includes("Times New Roman"), "le DOM summary contient « Times New Roman »");
    assert.ok(!text.includes("Times, serif"), "la suite « Times, serif » n'apparaît jamais");
  } finally {
    restore();
  }
});

test("DOM summary TEST 10 — Hérité : un titre sans taille explicite affiche « Hérité », jamais « 0 pt »", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    editor.template.headings.h1.fontSizePt = undefined;
    openSummaryRow(host, 2); // Titres

    const text = visibleText(host);
    assert.ok(text.includes(t("modal.layout.inherited")), "le DOM contient « Hérité »");
    assert.ok(!text.includes("0 pt"), "jamais « 0 pt » pour une valeur absente");
  } finally {
    restore();
  }
});

test("DOM summary TEST 11 — i18n : aucun texte visible du summary ne contient « modal.layout. »", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 1); // Marges
    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")(); // Retour Page
    openSummaryRow(host, 0); // Format et orientation

    assert.ok(!visibleText(host).includes("modal.layout."), "aucune clé brute visible");
  } finally {
    restore();
  }
});

test("DOM summary TEST 12 — Rail : picker, layout et inspecteurs historiques intacts, aucune classe summary", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor(); // rail par défaut
    await editor.load();

    assert.equal(editor.workspaceNavigation, "rail");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-nav")), "rail latéral présent");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-layout-inspector")), "inspecteur présent");
    assert.equal(allElements(host).some((el) => el.classes.has("feuillets-layout-summary-host")), false, "pas de host summary");
    assert.equal(allElements(host).some((el) => el.classes.has("feuillets-layout-summary")), false, "pas de liste summary");

    editor.select("headings");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-heading-level-picker")), "picker horizontal H1-H6 conservé dans le rail");
    assert.ok(allElements(host).some((el) => el.classes.has("feuillets-heading-level")), "boutons de niveau conservés");
  } finally {
    restore();
  }
});

/* ==================================================================
 * MICRO-CORRECTIF VISUEL — DEUX GRAMMAIRES DISTINCTES.
 * Pages de NAVIGATION : LABEL | STATUS | CHEVRON sur une SEULE ligne DOM
 * (frères directs, jamais empilés par un wrapper colonne).
 * Pages de RÉGLAGES : Setting Obsidian label | contrôle sur une seule ligne.
 * Retour : ligne indépendante ; titre : ligne indépendante SOUS le retour.
 * En sous-page : « Retour à Édition » (sidebar) absent de ces composants.
 * ================================================================== */

/** Enfant direct de `el` portant la classe `cls`, sinon undefined. */
function directChild(el, cls) {
  return el.children.find((c) => c.classes?.has(cls));
}

function rowLabelText(row) {
  return directChild(row, "feuillets-layout-summary-label")?.text;
}

function assertSingleLineRow(row, { needsStatus }) {
  const label = directChild(row, "feuillets-layout-summary-label");
  assert.ok(label, "label présent");
  const chevron = directChild(row, "feuillets-layout-summary-chevron");
  assert.ok(chevron, "chevron présent");
  const status = directChild(row, "feuillets-layout-summary-status");
  if (needsStatus) {
    assert.ok(status, "status présent");
    assert.ok(!status.text.includes("\n"), "status sur une seule ligne");
  }
  // Label, status et chevron sont des FRÈRES DIRECTS de la row : aucun
  // wrapper `.feuillets-layout-summary-copy` en colonne entre eux.
  for (const child of [label, chevron, status]) {
    if (!child) continue;
    assert.ok(row.children.includes(child), "élément en enfant direct de la row (jamais empilé)");
  }
}

test("MICRO grammaire §26.1 — HOME Mise en page : chaque ligne contient label + status + chevron sur UNE seule ligne DOM", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();

    const rows = summaryRows(host);
    assert.equal(rows.length, 5, "Page, Texte, Titres, Éléments, Diapos");
    // Page, Texte, Titres et Diapos portent un status ; Éléments n'en a pas.
    assertSingleLineRow(rows[0], { needsStatus: true });
    assertSingleLineRow(rows[1], { needsStatus: true });
    assertSingleLineRow(rows[2], { needsStatus: true });
    assertSingleLineRow(rows[3], { needsStatus: false });
    assert.equal(directChild(rows[3], "feuillets-layout-summary-status"), undefined, "Éléments sans status");
    assertSingleLineRow(rows[4], { needsStatus: true });
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.2 — PAGE : Format et orientation + status appartiennent à la même row", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page

    const row = summaryRows(host).find((r) => rowLabelText(r) === t("modal.layout.format"));
    assert.ok(row, "ligne Format et orientation");
    assertSingleLineRow(row, { needsStatus: true });
    const status = directChild(row, "feuillets-layout-summary-status");
    assert.ok(status.text.includes("A4"), "status = A4, sur la même ligne que le label");
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.3 — TEXTE : Texte courant + status appartiennent à la même row", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Texte

    const row = summaryRows(host).find((r) => rowLabelText(r) === t("modal.layout.currentText"));
    assert.ok(row, "ligne Texte courant");
    assertSingleLineRow(row, { needsStatus: true });
    const status = directChild(row, "feuillets-layout-summary-status");
    assert.ok(status.text.includes("Times New Roman"), "status = police, sur la même ligne");
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.4 — TITRES : H1 + status appartiennent à la même row", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 2); // Titres

    const rows = summaryRows(host);
    assert.equal(rows.length, 6, "H1 à H6");
    for (const row of rows) {
      assertSingleLineRow(row, { needsStatus: true });
      const status = directChild(row, "feuillets-layout-summary-status");
      assert.ok(status.text.includes("pt") || status.text === t("modal.layout.inherited"), "status taille ou Hérité");
    }
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.5 — ÉLÉMENTS : ligne compacte, une entrée par ligne", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 3); // Éléments

    const rows = summaryRows(host);
    assert.equal(rows.length, 2, "Citations en bloc + Séparateurs de scène");
    assert.equal(rowLabelText(rows[0]), t("modal.layout.blockquoteLabel"));
    assert.equal(rowLabelText(rows[1]), t("modal.layout.sceneSeparatorsShort"));
    for (const row of rows) assertSingleLineRow(row, { needsStatus: false });
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.6 — FORMAT : le Setting Format garde label + contrôle sur la même ligne Setting", async () => {
  // Sans installSettingStub : le stub de runtime construit le vrai DOM
  // `.setting-item` > info (name) + control, avec `controls` sur l'instance.
  const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
  await editor.load();
  openSummaryRow(host, 0); // Page
  openSummaryRow(host, 0); // Format et orientation

  const insp = currentInspector(host);
  const format = insp._settings.find((s) => s.name === t("modal.layout.format"));
  assert.ok(format, "Setting Format présent");
  assert.ok(format.controls.length > 0, "le contrôle vit dans le MÊME Setting que le label");
  assert.ok(format.settingEl.classes.has("setting-item"), "c'est un Setting Obsidian (setting-item)");
  assert.equal(format.settingEl.classes.has("feuillets-layout-summary-row"), false, "jamais une ligne navigation");
  assert.ok(format.settingEl.children.some((c) => c.classes?.has("setting-item-info")), "label dans le même setting-item");
  assert.ok(format.settingEl.children.some((c) => c.classes?.has("setting-item-control")), "contrôle dans le même setting-item");
});

test("MICRO grammaire §26.7 — MARGES : le Setting Haut garde label + contrôle sur la même ligne Setting", async () => {
  const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
  await editor.load();
  openSummaryRow(host, 0); // Page
  openSummaryRow(host, 1); // Marges et colonnes

  const insp = currentInspector(host);
  const top = insp._settings.find((s) => s.name === t("modal.layout.marginTop"));
  assert.ok(top, "Setting Haut présent");
  assert.ok(top.controls.length >= 1, "le contrôle vit dans le MÊME Setting que le label");
  assert.equal(top.settingEl.classes.has("feuillets-layout-summary-row"), false, "jamais une ligne navigation");
  assert.ok(top.settingEl.children.some((c) => c.classes?.has("setting-item-info")), "label dans le même setting-item");
  assert.ok(top.settingEl.children.some((c) => c.classes?.has("setting-item-control")), "contrôle dans le même setting-item");
});

test("MICRO grammaire §26.8 — aucune page terminale n'utilise la classe navigation-row pour ses Settings", async () => {
  const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
  await editor.load();
  // Format terminal
  openSummaryRow(host, 0); // Page
  openSummaryRow(host, 0); // Format
  let insp = currentInspector(host);
  assert.equal(summaryRows(host).length, 0, "aucune ligne navigation sur Format");
  assert.ok(insp._settings.length >= 1, "des Settings rendus");
  for (const setting of insp._settings) {
    assert.ok(setting.settingEl.classes.has("setting-item"), "Setting = .setting-item");
    assert.equal(setting.settingEl.classes.has("feuillets-layout-summary-row"), false, "Setting jamais une navigation-row");
  }
  // Marges terminal
  const back = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
  back.events.get("click")(); // Retour Page
  openSummaryRow(host, 1); // Marges
  insp = currentInspector(host);
  assert.equal(summaryRows(host).length, 0, "aucune ligne navigation sur Marges");
  for (const setting of insp._settings) {
    assert.equal(setting.settingEl.classes.has("feuillets-layout-summary-row"), false, "Setting jamais une navigation-row");
  }
});

test("MICRO grammaire §26.9 — Retour et titre sont deux éléments siblings verticaux, jamais dans le même row", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page

    const summaryHost = allElements(host).find((el) => el.classes.has("feuillets-layout-summary-host"));
    assert.ok(summaryHost, "host summary présent");
    const backIdx = summaryHost.children.findIndex((c) => c.classes?.has("feuillets-layout-summary-back"));
    const titleIdx = summaryHost.children.findIndex((c) => c.classes?.has("feuillets-layout-summary-title"));
    assert.ok(backIdx >= 0, "barre Retour en enfant direct du host");
    assert.ok(titleIdx > backIdx, "le titre vient EN DESSOUS du Retour (sibling vertical suivant)");

    const backBar = summaryHost.children[backIdx];
    const title = summaryHost.children[titleIdx];
    assert.ok(!backBar.children.includes(title), "le titre n'est JAMAIS dans la barre Retour");
    assert.ok(!allElements(backBar).includes(title), "le titre n'est descendant d'aucun élément de la barre");
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.10 — en sous-page, « Retour à Édition » est absent", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    assert.equal(visibleText(host).includes("Retour à Édition"), false, "aucun Retour à Édition en sous-page Page");
    openSummaryRow(host, 0); // Format terminal
    assert.equal(visibleText(host).includes("Retour à Édition"), false, "aucun Retour à Édition en sous-page Format");
    // Les seuls Retours affichés sont les retours LOCAUX vers le parent.
    assert.ok(backText(host).includes(t("modal.layout.categoryPage")), "le seul Retour visible est local (Page)");
  } finally {
    restore();
  }
});

test("MICRO grammaire §26.CSS — la ligne navigation ne déclare JAMAIS flex-direction: column ; le label garde la priorité, seul le status se tronque", () => {
  const css = readFileSync("styles.css", "utf8");
  const row = ruleBlock(css, ".feuillets-layout-summary-row");
  for (const declaration of ["display: flex", "align-items: center", "width: 100%", "min-width: 0"]) {
    assert.ok(row.includes(declaration), `row navigation : ${declaration}`);
  }
  assert.equal(row.includes("flex-direction: column"), false, "la row n'empile jamais en colonne");
  const label = ruleBlock(css, ".feuillets-layout-summary-label");
  for (const declaration of ["flex: 0 0 auto", "min-width: 0", "white-space: nowrap"]) {
    assert.ok(label.includes(declaration), `label : ${declaration}`);
  }
  const status = ruleBlock(css, ".feuillets-layout-summary-status");
  for (const declaration of ["flex: 1 1 auto", "min-width: 0", "white-space: nowrap", "color: var(--text-muted)"]) {
    assert.ok(status.includes(declaration), `status : ${declaration}`);
  }
  assert.equal(css.includes(".feuillets-layout-summary-copy"), false, "le wrapper colonne a disparu");
});

test("MICRO grammaire §26.CSS — plus AUCUN selector global ne force les Settings du sidebar en ligne/nowrap ; seuls les réglages explicitement compacts le font", () => {
  const css = readFileSync("styles.css", "utf8");
  // 1. Le Setting du host summary n'a PLUS de règle globale forcée en ligne.
  assert.equal(
    css.includes(".feuillets-layout-summary-host .feuillets-layout-inspector .setting-item {"),
    false,
    "aucune règle globale sur tous les Setting du host summary"
  );
  // 2. La classe compacte existe, explicitement scopée (jamais automatique).
  const compact = ruleBlock(css, ".feuillets-layout-summary-host .feuillets-layout-inspector .feuillets-setting-compact");
  for (const declaration of ["display: flex", "flex-direction: row", "align-items: center"]) {
    assert.ok(compact.includes(declaration), `compact : ${declaration}`);
  }
  assert.equal(compact.includes("flex-direction: column"), false, "jamais de colonne sur un Setting compact");
  // 3. Aucune règle générale sur .feuillets-edition-row n'impose nowrap.
  const editionKey = ruleBlock(css, ".feuillets-edition-row .feuillets-properties-key");
  assert.equal(editionKey.includes("white-space: nowrap"), false, "le libellé des lignes édition redevient vivant (peut passer sur deux lignes)");
  // 4. Aucune règle générale sur le conteneur Composition ne force la ligne unique.
  assert.equal(css.includes(".feuillets-edition-composition-container .feuillets-edition-row {"), false, "le conteneur Composition ne force plus le nowrap sur ses rows");
});

/* ============================================================
 * DERNIER CORRECTIF : trois grammaires. La classe compacte
 * `.feuillets-setting-compact` est posée EXPLICITEMENT par LayoutEditor
 * sur les réglages simples (Format, Orientation, Marges, Colonnes,
 * Gouttière, Police, Taille, Alignement, Interligne, Espacements).
 * Les réglages à intitulé long (Structure) et « Retrait première ligne »
 * restent RESPONSIVES (pas de classe compacte).
 * ============================================================ */

function settingName(host, name) {
  const insp = currentInspector(host);
  const container = insp?._settings || insp?.settings || [];
  for (const s of container) {
    if (s.name === name) return s;
  }
  return undefined;
}

function isSettingCompact(host, name) {
  const s = settingName(host, name);
  if (!s) return null;
  return s.settingEl?.classes?.has("feuillets-setting-compact") === true;
}

function clickBack(host) {
  const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "bouton Retour présent");
  backBtn.events.get("click")();
}

test("Compacts §5 — Format et Orientation portent la classe compacte", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 0); // Format et orientation
    assert.equal(isSettingCompact(host, t("modal.layout.format")), true, "Format compact");
    assert.equal(isSettingCompact(host, t("modal.layout.orientation")), true, "Orientation compacte");
  } finally {
    restore();
  }
});

test("Compacts §5 — Marges, miroir, colonnes et gouttière compacts (gouttière seulement si > 1 colonne)", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 0); // Page
    openSummaryRow(host, 1); // Marges et colonnes
    for (const name of [t("modal.layout.marginTop"), t("modal.layout.marginBottom"), t("modal.layout.marginLeft"), t("modal.layout.marginRight"), t("modal.layout.mirrorMargins"), t("modal.layout.columns")]) {
      assert.equal(isSettingCompact(host, name), true, `compact attendu : ${name}`);
    }
    assert.equal(isSettingCompact(host, t("modal.layout.gutterPt")), null, "pas de gouttière en 1 colonne");

    editor.template.page.columns.count = 2;
    clickBack(host); // revenir à la liste Page
    openSummaryRow(host, 1); // rouvrir Marges et colonnes
    assert.equal(isSettingCompact(host, t("modal.layout.gutterPt")), true, "gouttière compacte en 2 colonnes");
  } finally {
    restore();
  }
});

test("Compacts §5 — Police, Taille et Alignement compacts ; Orphelines et Profil restent responsives", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Texte
    openSummaryRow(host, 0); // Texte courant
    assert.equal(isSettingCompact(host, t("modal.layout.font")), true, "Police compacte");
    assert.equal(isSettingCompact(host, t("modal.layout.sizePt")), true, "Taille compacte");
    assert.equal(isSettingCompact(host, t("modal.layout.alignment")), true, "Alignement compact");
    clickBack(host); // revenir à la liste Texte
    openSummaryRow(host, 2); // Options
    assert.equal(isSettingCompact(host, t("modal.layout.profile")), false, "Profil NON compact (responsive)");
  } finally {
    restore();
  }
});

test("Compacts §5 — Interligne et espacements compacts ; « Retrait première ligne » volontairement responsive", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 1); // Texte
    openSummaryRow(host, 1); // Paragraphes
    assert.equal(isSettingCompact(host, t("modal.layout.lineHeight")), true, "Interligne compact");
    assert.equal(isSettingCompact(host, t("modal.layout.spacingBeforePt")), true, "Espacement avant compact");
    assert.equal(isSettingCompact(host, t("modal.layout.spacingAfterPt")), true, "Espacement après compact");
    assert.equal(isSettingCompact(host, t("modal.layout.firstLineIndentPt")), false, "Retrait première ligne NON compact (intitulé long)");
  } finally {
    restore();
  }
});

test("Compacts — aucune classe compacte sur les réglages de Titres ni d'Éléments", async () => {
  const restore = installSettingStub();
  try {
    const { editor, host } = buildEditor({ workspaceNavigation: "summary" });
    await editor.load();
    openSummaryRow(host, 2); // Titres
    openSummaryRow(host, 0); // H1
    const insp = currentInspector(host);
    assert.equal(allElements(insp).some((el) => el.classes.has("feuillets-setting-compact")), false, "aucun Setting compact dans l'inspecteur H1");
    clickBack(host); // H1 → liste Titres
    clickBack(host); // Titres → sommaire racine
    openSummaryRow(host, 3); // Éléments
    openSummaryRow(host, 0); // Citations en bloc
    const insp2 = currentInspector(host);
    assert.equal(allElements(insp2).some((el) => el.classes.has("feuillets-setting-compact")), false, "aucun Setting compact dans l'inspecteur Citations");
  } finally {
    restore();
  }
});

test("racine : LayoutEditor notifie onNavigationRootChange(true) sur le sommaire puis (false) en sous-page, (true) au Retour", async () => {
  const restore = installSettingStub();
  try {
    const seen = [];
    const { editor, host } = buildEditor({ workspaceNavigation: "summary", onNavigationRootChange: (isRoot) => seen.push(isRoot) });
    await editor.load();
    assert.deepEqual(seen, [true], "le sommaire est la page racine");
    openSummaryRow(host, 0); // Page
    assert.deepEqual(seen, [true, false], "sous-page → hors racine");
    const backBtn = allElements(host).find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")();
    assert.deepEqual(seen, [true, false, true], "retour au sommaire → racine à nouveau");
  } finally {
    restore();
  }
});
