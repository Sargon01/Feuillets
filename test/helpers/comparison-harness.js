import { MarkdownView, TFile, editorInfoField } from "obsidian";
import { comparisonClickExtension } from "../../src/utils/cm-comparison-decorations.js";

/* Obsidian tourne dans un navigateur : la comparaison passe par
   `window.setTimeout` (règle obsidianmd/prefer-window-timers, compatibilité
   des fenêtres détachées). Node n'a pas de `window` — on fournit le strict
   minimum, comme le font déjà plusieurs tests de ce dépôt. */
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };


/**
 * Atelier commun aux tests de comparaison. Il ne simule QUE ce qu'Obsidian
 * fournit réellement à cette fonctionnalité : des feuilles de workspace, de
 * vraies `MarkdownView` (au sens `instanceof`) et leur vue CodeMirror. Rien
 * ici ne rend du texte — c'est précisément le point de l'architecture : la
 * comparaison n'émet que des décorations, et ce sont elles qu'on observe.
 */

export class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag; this.children = []; this.classes = new Set(); this.events = new Map();
    this.text = options.text ?? ""; this.dataset = {}; this.style = {}; this.disabled = false;
    this.parent = null;
    if (options.cls) this.addClass(options.cls);
    this.attrs = { ...(options.attr ?? {}) };
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of String(names).split(" ")) if (name) this.classes.add(name); }
  removeClass(names) { for (const name of String(names).split(" ")) this.classes.delete(name); }
  setText(text) { this.text = String(text); return this; }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  removeEventListener(type, callback) { if (this.events.get(type) === callback) this.events.delete(type); }
  empty() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  querySelector() { return null; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0 }; }
}

export const allElements = (element) => element.children.flatMap((child) => [child, ...allElements(child)]);

/** Vue CodeMirror 6 factice : un `dispatch` espionné et juste assez d'état
 * pour que les décorations soient bornées au document réel. `topFor` est
 * remplaçable par un test pour provoquer un décalage vertical précis. */
export class FakeCm {
  constructor(file) {
    this.file = file;
    this.dispatched = [];
    this.topFor = (at) => at;
    const doc = {
      get length() { return file.content.length; },
      lineAt: (position) => ({ from: position === 0 ? 0 : file.content.lastIndexOf("\n", position - 1) + 1 }),
    };
    this.state = { doc, field: (field) => (field === editorInfoField ? { file: { path: file.path } } : undefined) };
  }
  dispatch(spec) { this.dispatched.push(spec.effects); }
  lineBlockAt(position) { return { top: this.topFor(position) }; }
}

/** Dernier lot de décorations réellement affiché : CodeMirror ne connaît
 * qu'un état courant, les lots précédents sont remplacés, jamais cumulés. */
export function decorationsOf(cm) {
  const last = [...cm.dispatched].reverse().find((effect) => Array.isArray(effect.value) || effect.value?.none);
  if (!last || last.value?.none) return [];
  return last.value;
}
export function readOnlyOf(cm) {
  return [...cm.dispatched].reverse().find((effect) => typeof effect.value === "boolean")?.value;
}
export const marksOf = (cm) => decorationsOf(cm).filter((range) => typeof range.class === "string");
export const widgetsOf = (cm) => decorationsOf(cm).filter((range) => range.widget);
export const classesOf = (cm) => marksOf(cm).map((range) => range.class);

class FakeMarkdownView extends MarkdownView {
  constructor(file, leaf) {
    super();
    this.file = file; this.leaf = leaf;
    this.cm = new FakeCm(file);
    this.editor = {
      cm: this.cm,
      getValue: () => file.content,
      offsetToPos: (offset) => ({ offset }),
      setSelection: (from, to) => { this.selection = { from, to }; },
      /* Chaque recentrage est enregistré, jamais cumulé — comme les vraies
         décorations : c'est le DERNIER appel qui compte pour un test. */
      scrollIntoView: (range, center) => { this.editor.lastReveal = { ...range, center }; },
    };
    this.contentEl = new FakeElement();
    this.containerEl = new FakeElement();
    /* Zone défilable factice de la feuille — posée par défaut pour qu'un
       test puisse vérifier qu'AUCUN écouteur `scroll` n'y est jamais posé
       (plus de synchronisation continue, dans aucun mode). */
    this.scroller = new FakeElement("div", { cls: "cm-scroller" });
    this.scroller.scrollTop = 0; this.scroller.scrollHeight = 4000; this.scroller.clientHeight = 400;
    this.contentEl.querySelector = (selector) => (selector === ".cm-scroller" ? this.scroller : null);
  }
}

class FakeLeaf {
  constructor(workspace) { this.workspace = workspace; this.view = null; this.detached = false; }
  async openFile(file) { this.view = new FakeMarkdownView(file, this); }
  detach() { this.detached = true; this.view = null; this.workspace.leaves = this.workspace.leaves.filter((leaf) => leaf !== this); }
}

export class FakeWorkspace {
  constructor() { this.leaves = []; this.refs = new Set(); }
  add() { const leaf = new FakeLeaf(this); this.leaves.push(leaf); return leaf; }
  getLeavesOfType(type) { return type === "markdown" ? this.leaves.filter((leaf) => leaf.view) : []; }
  getLeaf() { return this.add(); }
  /* `this.leaves` reflète l'ordre VISUEL des colonnes : c'est ce que les
     tests lisent pour vérifier que l'avant est bien à gauche. */
  createLeafBySplit(reference, direction, before = false) {
    const leaf = new FakeLeaf(this);
    const at = this.leaves.indexOf(reference);
    this.leaves.splice(at < 0 ? this.leaves.length : at + (before ? 0 : 1), 0, leaf);
    return leaf;
  }
  revealLeaf() {}
  getActiveViewOfType() { return null; }
  on(name, callback) { const ref = { name, callback }; this.refs.add(ref); return ref; }
  offref(ref) { this.refs.delete(ref); }
  emit(name, ...args) { for (const ref of [...this.refs]) if (ref.name === name) ref.callback(...args); }
}

/** Colonnes dans l'ordre visuel : gauche = avant, droite = après. */
export const columns = (workspace) => workspace.leaves.filter((leaf) => leaf.view).map((leaf) => leaf.view);
export const columnCms = (workspace) => columns(workspace).map((view) => view.cm);

/** Vue Markdown ouverte sur ce chemin, et sa vue CodeMirror. */
export function viewFor(workspace, path) {
  return workspace.leaves.find((leaf) => leaf.view?.file?.path === path)?.view ?? null;
}
export function cmFor(workspace, path) { return viewFor(workspace, path)?.cm ?? null; }
/** Dernier recentrage demandé à CETTE vue (`{offset, offset, center}`), ou
 * `null` si aucun — jamais déduit d'un scroll global. */
export const revealOf = (view) => view?.editor?.lastReveal ?? null;
/** Vrai seulement si un écouteur `scroll` a réellement été posé sur la zone
 * défilable de cette vue — la preuve qu'une synchronisation continue existe. */
export const hasScrollListener = (view) => Boolean(view?.scroller?.events?.has("scroll"));
export function barOf(workspace, path) {
  const view = viewFor(workspace, path);
  return view ? allElements(view.containerEl).find((child) => child.classes.has("feuillets-comparison-toolbar")) ?? null : null;
}
export const barButtons = (bar) => (bar ? allElements(bar).filter((child) => child.tag === "button" && child.text) : []);

/** Événements du coffre : le vault factice n'en émet pas, la comparaison s'y
 * abonne pourtant. On les branche sans jamais changer le vault lui-même. */
export function wireVaultEvents(vault) {
  const refs = new Set();
  vault.on = (name, callback) => { const ref = { name, callback }; refs.add(ref); return ref; };
  vault.offref = (ref) => refs.delete(ref);
  vault.emit = (name, ...args) => { for (const ref of [...refs]) if (ref.name === name) ref.callback(...args); };
  return vault;
}

class FakeHTMLElement {
  constructor(attrs = {}) { this.attrs = attrs; }
  closest(selector) {
    const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    return names.some((name) => name in this.attrs) ? this : null;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getBoundingClientRect() { return { left: 4, bottom: 8 }; }
}

/** Clic réel sur une décoration : passe par l'extension CodeMirror enregistrée
 * dans main.ts, jamais par un raccourci interne à la comparaison. */
export function clickDecoration(cm, attrs) {
  const previous = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeHTMLElement;
  try { return comparisonClickExtension().click({ target: new FakeHTMLElement(attrs) }, cm); }
  finally { globalThis.HTMLElement = previous; }
}

/** Double-clic réel — même extension, même chemin que `clickDecoration` :
 * jamais un raccourci qui appellerait directement une méthode privée de la
 * session. */
export function doubleClickDecoration(cm, attrs) {
  const previous = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeHTMLElement;
  try { return comparisonClickExtension().dblclick({ target: new FakeHTMLElement(attrs) }, cm); }
  finally { globalThis.HTMLElement = previous; }
}

/** Échap réel, sur l'éditeur donné — même extension globale. */
export function pressEscape(cm) {
  return comparisonClickExtension().keydown({ key: "Escape" }, cm);
}

export const settle = async (tries = 40) => { for (let index = 0; index < tries; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
export const until = async (check, tries = 80) => { for (let index = 0; index < tries; index += 1) { await new Promise((resolve) => setTimeout(resolve, 0)); if (check()) return true; } return false; };

export const isFile = (value) => value instanceof TFile;
