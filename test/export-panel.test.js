import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { ExportPanel } from "../src/ui/export-panel.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/preview-view.test.js (convention du
 * dépôt : dupliqué, pas partagé), réduit à ce qu'ExportPanel utilise
 * réellement — pas de scroll, pas de rect, pas d'iframe. */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
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
  hasClass(cls) { return this.classes.has(cls); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    if (options.value !== undefined) child.value = options.value;
    if (options.type !== undefined) child.type = options.type;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) child.setAttribute(k, v);
    return this.appendChild(child);
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(node, selector) {
  const attr = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function installDom() {
  const previous = { createEl: globalThis.createEl, createDiv: globalThis.createDiv, createSpan: globalThis.createSpan };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  return () => {
    globalThis.createEl = previous.createEl;
    globalThis.createDiv = previous.createDiv;
    globalThis.createSpan = previous.createSpan;
  };
}

/** Projet minimal, plugin minimal — juste assez pour que le panneau se
 * rende (currentExportScope, listExportTemplates, frontTitleCandidates). */
function buildFixture() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const scene = new TFile("Projet/Manuscrit/Scène 1.md", "---\ntitle: Départ\n---\nTexte.");
  manuscript.children = [scene];
  scene.parent = manuscript;
  const { vault, fileManager, files } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  vault.files = files;
  const frontmatter = new Map([[scene.path, { title: "Départ", compile: true }]]);
  const app = { vault, fileManager, metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    exportFormat: "docx",
    compileFileName: "Manuscrit.md",
    activePreset: -1,
    compilePresets: [],
    collapsed: {},
    projectMeta: {},
    orders: {},
    manuscriptTitle: "",
    manuscriptAuthor: "",
  };
  const plugin = {
    settings,
    activeExportScope: null,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, settings, plugin, manuscript };
}

test("ExportPanel : se construit et se rend sans aucun callback — getScope et onPresentationChanged sont facultatifs", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();
    // Aucune exception : le panneau ne dépend plus d'aucun callback Preview.
    assert.ok(container.querySelector('[aria-label="Portée de l’export"]'));
  } finally {
    restore();
  }
});

test("ExportPanel : sans getScope, la portée vient de currentExportScope(plugin) — Projet par défaut", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();

    const label = container.querySelector('[aria-label="Portée de l’export"]');
    assert.equal(label.textContent, "Projet");
    assert.deepEqual(plugin.activeExportScope, { type: "project", projectRoot: manuscript.path });
  } finally {
    restore();
  }
});

test("ExportPanel : avec getScope, le libellé suit exactement le CompileScope fourni", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const scope = { type: "folder", projectRoot: manuscript.path, path: `${manuscript.path}/Chapitre 1` };
    const panel = new ExportPanel(app, plugin, container, { getScope: () => scope });
    await panel.render();

    const label = container.querySelector('[aria-label="Portée de l’export"]');
    assert.equal(label.textContent, "Dossier");
  } finally {
    restore();
  }
});

test("ExportPanel : le bouton Exporter appelle le workflow commun, jamais un callback onExport", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    plugin.settings.exportFormat = "md";
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();

    const launch = container.querySelectorAll("button").find((el) => el.textContent === "Exporter");
    assert.ok(launch, "le bouton Exporter doit exister");
    launch.click();
    // launchExport() est lancé en tir-et-oublie par le bouton (comme dans
    // l'Aperçu réel) : on laisse sa chaîne de promesses (compile → écriture)
    // se dérouler avant de vérifier le résultat.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Le workflow commun écrit réellement via compile() en Markdown — on
    // vérifie l'écriture plutôt qu'un espion sur une méthode PreviewView,
    // puisqu'aucune n'existe plus.
    const written = [...app.vault.files.values()].some((f) => f.path?.endsWith(".md") && f.path.includes("Sortie"));
    assert.ok(written, "l'export doit avoir réellement écrit un fichier compilé");
  } finally {
    restore();
  }
});

test("ExportPanel : onPresentationChanged est facultatif — changer de format sans callback ne lève pas", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();

    const format = container.querySelectorAll("select")[0];
    format.value = "pdf";
    await assert.doesNotReject(async () => { format.dispatch("change"); await Promise.resolve(); });
    assert.equal(plugin.settings.exportFormat, "pdf");
  } finally {
    restore();
  }
});

test("ExportPanel : mode Preview (embedded par défaut) conserve Actualiser et fermer, et est replié par défaut", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.hasClass("is-hidden"), true, "replié par défaut, comme dans l'Aperçu");
    assert.ok(container.querySelector('[aria-label="Actualiser l’aperçu"]'), "bouton Actualiser présent");
    assert.ok(container.querySelector('[aria-label="Replier le panneau Export"]'), "bouton fermer présent");
  } finally {
    restore();
  }
});

test("ExportPanel : mode embedded reste toujours visible et n'affiche ni Actualiser ni fermer", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container, { embedded: true });
    await panel.render();

    assert.equal(container.hasClass("is-hidden"), false, "toujours visible en mode embedded");
    assert.equal(container.querySelector('[aria-label="Actualiser l’aperçu"]'), null);
    assert.equal(container.querySelector('[aria-label="Replier le panneau Export"]'), null);
    // Les champs et le bouton Exporter restent identiques.
    assert.ok(container.querySelector('[aria-label="Portée de l’export"]'));
    const launch = container.querySelectorAll("button").find((el) => el.textContent === "Exporter");
    assert.ok(launch);
    assert.ok(launch.hasClass("mod-cta"));
    assert.ok(launch.hasClass("feuillets-edition-export-cta"));
  } finally {
    restore();
  }
});

/* ===================== Phase 2 — présentation embedded ===================== */

test("ExportPanel : embedded:true ajoute la classe is-embedded sur la racine du panneau", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container, { embedded: true });
    await panel.render();

    assert.ok(container.hasClass("is-embedded"));
    assert.equal(container.hasClass("feuillets-preview-export"), false, "Édition n'hérite pas du habillage du panneau Aperçu");
  } finally {
    restore();
  }
});

test("ExportPanel : le panneau Preview (non embedded) reste inchangé — pas de is-embedded", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ExportPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.hasClass("is-embedded"), false);
    assert.ok(container.hasClass("feuillets-preview-export"));
  } finally {
    restore();
  }
});

test("ExportPanel : Gabarit n'existe plus dans aucun mode (Phase 11 : déplacé dans Édition → Mise en page)", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();

    const previewContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, previewContainer).render();
    assert.equal(previewContainer.querySelector('[aria-label="Gabarit d’export"]'), null);
    assert.equal(previewContainer.querySelectorAll("select").length, 1, "seul le select Format subsiste");

    const embeddedContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, embeddedContainer, { embedded: true }).render();
    assert.equal(embeddedContainer.querySelector('[aria-label="Gabarit d’export"]'), null);
    assert.equal(embeddedContainer.querySelectorAll("select").length, 2, "Portée et Format sont disponibles dans le panneau intégré");
  } finally {
    restore();
  }
});

test("ExportPanel : Première page n'existe plus dans aucun mode (Phase 3 : déplacée dans Édition → Composition de l'ouvrage)", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();

    const previewContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, previewContainer).render();
    assert.equal(previewContainer.querySelectorAll(".feuillets-preview-export-summary").length, 0, "aucune sous-section repliable en mode Preview");
    assert.equal(previewContainer.querySelectorAll("details").length, 0);

    const embeddedContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, embeddedContainer, { embedded: true }).render();
    assert.equal(embeddedContainer.querySelectorAll(".feuillets-preview-export-summary").length, 0, "aucune sous-section repliable en mode embedded");
    assert.equal(embeddedContainer.querySelectorAll("details").length, 0);

    // Portée / Format / Nom / Exporter restent présents : le contenu appartient
    // désormais à Composition de l’ouvrage.
    assert.ok(previewContainer.querySelector('[aria-label="Portée de l’export"]'));
    assert.equal(previewContainer.querySelector('[aria-label="Choisir les éléments inclus"]'), null);
    assert.ok(previewContainer.querySelector('[aria-label="Format de sortie"]'));
    assert.ok(previewContainer.querySelector('[aria-label="Nom du fichier exporté"]'));
    assert.ok(previewContainer.querySelectorAll("button").some((el) => el.textContent === "Exporter"));
  } finally {
    restore();
  }
});

test("ExportPanel : le bouton final Exporter garde la classe Preview uniquement hors mode embedded", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();

    const previewContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, previewContainer).render();
    assert.ok(previewContainer.querySelector(".feuillets-preview-export-launch"));

    const embeddedContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, embeddedContainer, { embedded: true }).render();
    const embeddedLaunch = embeddedContainer.querySelectorAll("button").find((el) => el.textContent === "Exporter");
    assert.ok(embeddedLaunch);
    assert.equal(embeddedContainer.querySelector(".feuillets-preview-export-launch"), null);
  } finally {
    restore();
  }
});

test("ExportPanel : « Éléments inclus » n’est affiché dans aucun mode", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();

    const previewContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, previewContainer).render();
    const previewIncluded = previewContainer.querySelector('[aria-label="Choisir les éléments inclus"]');
    assert.equal(previewIncluded, null);

    const embeddedContainer = new FakeElement("div");
    await new ExportPanel(app, plugin, embeddedContainer, { embedded: true }).render();
    const embeddedIncluded = embeddedContainer.querySelector('[aria-label="Choisir les éléments inclus"]');
    assert.equal(embeddedIncluded, null);
  } finally {
    restore();
  }
});

/* ===================== Phase 2 — garde CSS ===================== */

test("styles.css : la cause du CTA sur-appliqué (sélecteurs génériques [class*=\"export\"]) a disparu", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const css = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /button\[class\*="export"\]/);
  assert.doesNotMatch(css, /button:not\(\[class\*="export"\]\)/);
});
