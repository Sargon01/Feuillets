import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFolder } from "obsidian";
import { EditionWorkspaceContent } from "../src/ui/edition-workspace-content.js";
import { TextPromptModal } from "../src/ui/basic-modals.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createCustomTemplateFromV2 } from "../src/services/export-templates-custom.js";
import { createDefaultExportTemplateV2 } from "../src/services/export-template-v2.js";

/* Même petit DOM factice que test/edition-composition-content.test.js
 * (convention du dépôt : dupliqué, pas partagé), complété de ce que la barre
 * d'outils Mise en page utilise en plus (select/option, click).
 *
 * L'ancien lanceur latéral EditionLayoutView a été SUPPRIMÉ (§7/§12 du
 * chantier « espace central ») : la gestion des gabarits (gabarit actif,
 * nouveau/dupliquer/renommer/supprimer, imports Ulysses/Word) vit désormais
 * au seul endroit qui affiche le gabarit — la barre d'outils du mode Mise en
 * page d'EditionWorkspaceContent. Mêmes services, mêmes modales. */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
    this.value = "";
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

/** Plugin minimal — pas de dossier projet configuré : listExportTemplates()
 * retombe alors sur les seuls modèles intégrés (aucun vault nécessaire). */
function buildPlugin() {
  return {
    settings: { collapsed: {}, exportTemplate: "classique" },
    saveSettings: async () => {},
    /* §1 du dernier lot UX avant 2.5 : EditionWorkspaceContent monte
       désormais une barre d'export compacte TOUJOURS visible (quel que soit
       l'onglet), qui appelle resolveScope()/getProjectFolder() dès le
       premier rendu — même sans dossier projet actif. */
    getProjectFolder: () => null,
  };
}

function buildCreationFixture() {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project;
  project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getLeavesOfType: () => [] } };
  let saves = 0;
  const plugin = {
    settings: { collapsed: {}, exportTemplate: "classique", projectFolder: manuscript.path },
    saveSettings: async () => { saves += 1; },
    getProjectFolder: () => manuscript,
  };
  return { app, plugin, saves: () => saves };
}

/** Monte le mode « Mise en page » d'EditionWorkspaceContent — seul hôte
 * restant du gabarit actif et de sa gestion. */
async function mountLayout(app, plugin) {
  const contentEl = new FakeElement("div");
  const view = new EditionWorkspaceContent(app, plugin, { app, contentEl }, contentEl, { initialMode: "layout" });
  await view.render();
  return { view, contentEl };
}

test("Mise en page : sélecteur Gabarit peuplé par listExportTemplates, valeur = settings.exportTemplate", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const { contentEl } = await mountLayout({ vault: null, workspace: { getLeavesOfType: () => [] } }, plugin);

    const select = contentEl.querySelector('[aria-label="Gabarit"]');
    assert.ok(select, "le sélecteur Gabarit est présent");
    assert.equal(select.value, "classique");
    const options = select.children.map((o) => o.value);
    assert.ok(options.includes("classique"));
    assert.ok(options.includes("moderne"));
    assert.equal(options.length, 5, "seuls les cinq gabarits intégrés proposés sont listés");
  } finally {
    restore();
  }
});

test("Mise en page : changer le sélecteur écrit directement settings.exportTemplate et sauvegarde", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const { contentEl } = await mountLayout({ vault: null, workspace: { getLeavesOfType: () => [] } }, plugin);

    let saved = false;
    plugin.saveSettings = async () => { saved = true; };

    const select = contentEl.querySelector('[aria-label="Gabarit"]');
    select.value = "moderne";
    select.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(plugin.settings.exportTemplate, "moderne");
    assert.equal(saved, true);
  } finally {
    restore();
  }
});

test("Mise en page : le menu d'options du gabarit est le SEUL point d'entrée de la gestion des gabarits", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildCreationFixture();
    const { contentEl } = await mountLayout(app, plugin);

    assert.ok(contentEl.querySelector('[aria-label="Options du gabarit"]'));
    // Plus aucun lanceur latéral : ni « Modifier visuellement », ni « Ouvrir
    // l'espace Édition » (l'espace EST déjà à l'écran).
    assert.equal(contentEl.querySelector('[aria-label="Modifier visuellement"]'), null);
    assert.equal(contentEl.querySelector('[aria-label="Ouvrir l’espace Édition"]'), null);
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-export-panel").length, 0, "pas de formulaire Export dans le mode Mise en page");
  } finally {
    restore();
  }
});

test("Mise en page : Nouveau gabarit crée un V2 actif sans écraser une collision, sans créer aucune leaf", async () => {
  const restore = installDom();
  const originalPromptOpen = TextPromptModal.prototype.open;
  let promptResult = null;
  TextPromptModal.prototype.open = function openPrompt() { this.onResult(promptResult); };
  try {
    const { app, plugin, saves } = buildCreationFixture();
    const { view, contentEl } = await mountLayout(app, plugin);

    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    const menu = Menu.lastShown;
    assert.deepEqual(menu.items.filter((item) => !item.separator).map((item) => item.title), ["Nouveau gabarit…", "Dupliquer", "Importer Ulysses", "Importer Word"]);

    await view.createNewTemplate();
    assert.equal(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/gabarit.md"), null, "annulation : aucun fichier");
    promptResult = "   ";
    await view.createNewTemplate();
    assert.equal(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/gabarit.md"), null, "nom vide : aucun fichier");

    promptResult = "Mon modèle";
    await view.createNewTemplate();
    const created = app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/mon-modele.md");
    assert.ok(created, "le nouveau fichier est créé dans Resources/Mises en page");
    assert.match(created.content, /version: 2/);
    assert.match(created.content, /profile: document/);
    assert.equal(plugin.settings.exportTemplate, "mon-modele");
    assert.equal(saves(), 1);

    const firstContent = created.content;
    await view.createNewTemplate();
    assert.equal(created.content, firstContent, "la collision ne remplace jamais le premier fichier");
    assert.ok(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/mon-modele-2.md"));
    assert.equal(plugin.settings.exportTemplate, "mon-modele-2");
    assert.equal(saves(), 2);
  } finally {
    TextPromptModal.prototype.open = originalPromptOpen;
    restore();
  }
});

test("Mise en page : les actions Renommer et Supprimer n'apparaissent que pour un fichier personnalisé actif", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildCreationFixture();
    const { view, contentEl } = await mountLayout(app, plugin);
    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    assert.equal(Menu.lastShown.items.some((item) => item.title === "Renommer…"), false);
    assert.equal(Menu.lastShown.items.some((item) => item.title === "Supprimer…"), false);

    await createCustomTemplateFromV2(app, plugin.settings, "perso", "Personnel", createDefaultExportTemplateV2());
    await view.render();
    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    assert.deepEqual(Menu.lastShown.items.filter((item) => !item.separator).map((item) => item.title), ["Nouveau gabarit…", "Dupliquer", "Renommer…", "Supprimer…", "Importer Ulysses", "Importer Word"]);
  } finally { restore(); }
});

test("Mise en page : Importer Ulysses ouvre la modale sans input file", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildCreationFixture();
    const { contentEl } = await mountLayout(app, plugin);
    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    const item = Menu.lastShown.items.find((entry) => entry.title === "Importer Ulysses");
    assert.ok(item, "l'entrée Importer Ulysses est présente");
    assert.equal(
      contentEl.querySelectorAll("input").filter((node) => node.type === "file").length,
      0,
      "l'import se fait par dépôt HTML5 dans la modale, jamais par un input file monté ici"
    );
  } finally { restore(); }
});
