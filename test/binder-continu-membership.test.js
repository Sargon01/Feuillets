import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";

// highlightActive (utils/dom.ts) appelle CSS.escape sur le chemin actif —
// absent du runtime Node de test, jamais du vrai navigateur/Obsidian (voir
// test/notes-view.test.js pour le même polyfill minimal).
if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
// Le clic "historique" (hors Continu) reprend le focus via window.setTimeout
// (voir renderFileRow, feuillets-view.ts) — absent du runtime Node de test.
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

/* LOT FINAL Binder ↔ Continu — grammaire Scrivener : quand Continu est
 * RÉELLEMENT actif (leaf active), le Binder devient temporairement son
 * sélecteur :
 * - clic simple = `openSingleMember` (ouvre CE fichier seul, MÊME leaf,
 *   jamais un toggle de la composition affichée, §3-4) ;
 * - Cmd/Ctrl+clic = `setMembers` avec un toggle individuel calculé depuis
 *   `getMemberPaths()` (§8), jamais `_binderMultiSelect` ;
 * - Maj+clic = `setMembers` avec la plage calculée (couvert par
 *   binder-markdown-continu-transition.test.js, §5/§7).
 * Même harnais que test/feuillets-view-onboarding.test.js : `FakeElement`
 * fournit juste assez de la surface DOM d'Obsidian pour exécuter le VRAI
 * `render()`.
 *
 * `getActiveViewOfType` n'est jamais vraiment appelée avec la classe réelle
 * `ScriveningsView` ici (le faux Continu est un simple objet dupliquant sa
 * surface publique — `openScope`/`setMembers`/`openSingleMember` compris,
 * exigés par `isContinuMembershipView`) : le fake workspace ignore le
 * constructeur passé et retourne directement l'objet configuré —
 * exactement ce que FeuilletsView.activeContinuMembershipView consomme,
 * jamais un `instanceof`. */

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { setProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    // Supporte les combinaisons `.classe1.classe2[attr]` (aucun vrai moteur
    // CSS requis) : suffisant pour cibler `.feuillets-item[data-path]` et
    // vérifier l'ABSENCE de sélecteurs 2B.2 comme `.feuillets-continu-toggle`.
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    // requis par resolveCompileScopeFiles/getOrderedChildren (RÉELS, jamais
    // mockés — voir test/binder-markdown-continu-transition.test.js).
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    ...overrides,
  };
}

function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md");
  const b = new TFile("Roman/Manuscrit/B.md");
  a.basename = "A";
  b.basename = "B";
  root.children = [a, b];
  a.parent = root;
  b.parent = root;
  return { root, a, b };
}

function buildView({ root, a, b }, { activeContinuView = null, otherLeafContinuView = null } = {}) {
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path });
  const contentEl = new FakeElement();
  const openedLeaf = { opened: [] };
  const leaf = {
    openFile: async (file) => { openedLeaf.opened.push(file.path); },
  };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a, b],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Roman",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => leaf,
  };
  const otherLeaves = otherLeafContinuView ? [{ view: otherLeafContinuView }] : [];
  // Reproduit la résolution RÉELLE du membership Continu (voir
  // FeuilletsView.activeContinuMembershipView) : `rootSplit` + une leaf
  // centrale "de travail" dont la vue est `activeContinuView` — jamais
  // `getActiveViewOfType`, conservé ici seulement pour les tests qui
  // exercent explicitement le chemin "leaf non active" (voir plus bas).
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: activeContinuView ?? {} };
  const view = new FeuilletsView(
    {
      app: {
        vault: { getAbstractFileByPath: (path) => (path === root.path ? root : null) },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
        workspace: {
          leftSplit: { name: "left" },
          rightSplit: { name: "right" },
          rootSplit,
          getLeavesOfType: (type) => (type === "feuillets-scrivenings" ? otherLeaves : []),
          getActiveViewOfType: (Type) => (Type === ScriveningsView ? activeContinuView : null),
          getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
          setActiveLeaf: () => {},
          revealLeaf: async () => {},
        },
      },
      contentEl,
    },
    plugin
  );
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, plugin, openedLeaf };
}

/** Fabrique un faux Continu qui implémente la surface COMPLÈTE désormais
 * exigée par `isContinuMembershipView` (openScope/setMembers/
 * openSingleMember compris, LOT FINAL Binder ↔ Continu) — sans quoi le
 * Binder ne le reconnaîtrait jamais comme Continu actif et tous ces tests
 * retomberaient silencieusement sur le chemin historique. `toggleMember`/
 * `collapseToSingleMember`/`addMembers` restent définies pour la
 * compatibilité du contrat, même si le Binder ne les appelle plus depuis ce
 * lot (voir feuillets-view.ts). */
function fakeContinuView(projectRoot, members) {
  const set = new Set(members);
  const openedSingle = [];
  const setMembersCalls = [];
  return {
    compileScope: { type: "selection", projectRoot, paths: [...set] },
    getViewType: () => VIEW_SCRIVENINGS,
    getMemberPaths: () => [...set],
    hasMember: (path) => set.has(path),
    toggleMember: async (path) => {
      set.has(path) ? set.delete(path) : set.add(path);
      return true;
    },
    collapseToSingleMember: async () => false,
    addMembers: async (paths) => {
      for (const path of paths) set.add(path);
      return true;
    },
    openScope: async () => true,
    /** §3-4 : ouvre `path` seul — ne modifie JAMAIS la composition Continu
     * elle-même (dans le vrai système, la leaf devient un MarkdownView
     * distinct ; ce fake ne modélise que l'APPEL, la transition de leaf
     * réelle est couverte par binder-markdown-continu-transition.test.js,
     * qui utilise une vraie ScriveningsView). */
    openSingleMember: async (path) => {
      openedSingle.push(path);
      return true;
    },
    /** §6-8 : remplace toute la composition par `paths` (dédoublonnés). */
    setMembers: async (paths) => {
      const deduped = [...new Set(paths)];
      setMembersCalls.push(deduped);
      if (deduped.length === 0) return false;
      set.clear();
      for (const path of deduped) set.add(path);
      return true;
    },
    _openedSingle: openedSingle,
    _setMembersCalls: setMembersCalls,
  };
}

function fakeFailingContinuView(projectRoot, members) {
  const set = new Set(members);
  const openedSingle = [];
  const setMembersCalls = [];
  return {
    compileScope: { type: "selection", projectRoot, paths: [...set] },
    getViewType: () => VIEW_SCRIVENINGS,
    getMemberPaths: () => [...set],
    hasMember: (path) => set.has(path),
    collapseToSingleMember: async () => false,
    toggleMember: async () => false,
    addMembers: async () => false,
    openScope: async () => false,
    // Conflit/dirty non résolu (§4) : rien ne change, retourne toujours false.
    openSingleMember: async (path) => {
      openedSingle.push(path);
      return false;
    },
    setMembers: async (paths) => {
      setMembersCalls.push([...new Set(paths)]);
      return false;
    },
    _openedSingle: openedSingle,
    _setMembersCalls: setMembersCalls,
  };
}

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

function click(el, modifiers = {}) {
  let prevented = false;
  let stopped = false;
  el.events.get("click")({
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    shiftKey: !!modifiers.shiftKey,
    ctrlKey: !!modifiers.ctrlKey,
    metaKey: !!modifiers.metaKey,
    altKey: !!modifiers.altKey,
  });
  return { prevented, stopped };
}

/* ===================== §3-4 — clic simple ===================== */

test("Continu actif + fichier NON membre + clic simple : ouvre ce fichier seul (openSingleMember), jamais un ajout", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, []);
  const { view, contentEl, openedLeaf } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const { prevented, stopped } = click(itemA);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(continuView._openedSingle, [fixture.a.path]);
  assert.deepEqual(continuView._setMembersCalls, [], "aucun appel setMembers depuis un clic simple");
  assert.equal(continuView.hasMember(fixture.a.path), false, "openSingleMember ne modifie jamais la composition Continu elle-même");
  assert.deepEqual(openedLeaf.opened, [], "jamais via le mécanisme historique (autre leaf)");
});

test("Continu actif + fichier MEMBRE + clic simple : ouvre ce même fichier seul, jamais un retrait", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl, openedLeaf } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  click(itemA);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, [fixture.a.path]);
  assert.deepEqual(openedLeaf.opened, []);
});

test("openSingleMember échoue (conflit/dirty) : l'état visuel précédent est conservé", async () => {
  const fixture = buildFixture();
  const continuView = fakeFailingContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(itemA.classes.has("is-continu-member"), true);

  click(itemA);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, [fixture.a.path]);
  assert.equal(continuView.hasMember(fixture.a.path), true, "rien n'a réellement changé");
  assert.equal(itemA.classes.has("is-continu-member"), true, "la surbrillance précédente est conservée");
});

test("Continu ouvert sur le MÊME projet mais dans une leaf NON active : clic historique", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, []);
  const { view, contentEl, openedLeaf } = buildView(fixture, { otherLeafContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  click(itemA);
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, [], "aucun appel : Continu n'est pas la leaf active");
  assert.deepEqual(openedLeaf.opened, [fixture.a.path], "le fichier s'ouvre normalement");
});

test("Continu actif mais sur un AUTRE projet : clic historique", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView("Autre/Manuscrit", []);
  const { view, contentEl, openedLeaf } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  click(itemA);
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, []);
  assert.deepEqual(openedLeaf.opened, [fixture.a.path]);
});

test("aucun Continu ouvert : clic historique normal", async () => {
  const fixture = buildFixture();
  const { view, contentEl, openedLeaf } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  click(itemA);
  await Promise.resolve();

  assert.deepEqual(openedLeaf.opened, [fixture.a.path]);
});

/* ===================== §8 — Cmd/Ctrl+clic pilote RÉELLEMENT Continu ===== */

test("Continu actif + Ctrl+clic fichier NON membre : setMembers([...current, path]), jamais _binderMultiSelect", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl, plugin, openedLeaf } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  click(itemB, { ctrlKey: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._setMembersCalls, [[fixture.a.path, fixture.b.path]]);
  assert.deepEqual(continuView.getMemberPaths(), [fixture.a.path, fixture.b.path]);
  assert.deepEqual(openedLeaf.opened, [], "jamais le chemin historique");
  assert.equal(!!plugin._binderMultiSelect?.has(fixture.b.path), false, "_binderMultiSelect n'est plus la vérité en Continu");
});

test("Continu actif + Ctrl+clic fichier MEMBRE : setMembers retire ce chemin", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path, fixture.b.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  click(itemB, { ctrlKey: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._setMembersCalls, [[fixture.a.path]]);
  assert.deepEqual(continuView.getMemberPaths(), [fixture.a.path]);
});

test("Continu actif + Maj+clic : chemin historique de plage puis setMembers, jamais openSingleMember", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  click(itemB, { shiftKey: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, []);
  assert.ok(continuView._setMembersCalls.length >= 1);
});

/* ===================== Correctif final multi-drag — Option/Alt ===================== */

test("Continu actif + Option/Alt+clic : n'appelle ni setMembers ni openSingleMember, ne touche pas la composition", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl, plugin } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  const { prevented, stopped } = click(itemB, { altKey: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(continuView._setMembersCalls, [], "Option/Alt+clic n'appelle jamais setMembers");
  assert.deepEqual(continuView._openedSingle, [], "Option/Alt+clic n'appelle jamais openSingleMember");
  assert.deepEqual(continuView.getMemberPaths(), [fixture.a.path], "composition Continu inchangée");
  assert.ok(plugin._binderMultiSelect?.has(fixture.b.path), "la sélection de réorganisation Binder est construite séparément");
});

/* ===================== §15 — surbrillance ===================== */

test("Continu actif : les membres sont surlignés, pas les autres", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  assert.equal(itemFor(contentEl, fixture.a.path).classes.has("is-continu-member"), true);
  assert.equal(itemFor(contentEl, fixture.b.path).classes.has("is-continu-member"), false);
});

test("groupe Continu vide : aucun membre surligné ; clic simple ouvre le fichier seul, ne l'ajoute plus au groupe", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, []);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  assert.equal(itemFor(contentEl, fixture.a.path).classes.has("is-continu-member"), false);
  assert.equal(itemFor(contentEl, fixture.b.path).classes.has("is-continu-member"), false);

  click(itemFor(contentEl, fixture.b.path));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(continuView._openedSingle, [fixture.b.path]);
  assert.deepEqual(continuView.getMemberPaths(), [], "openSingleMember ne modifie pas la composition Continu");
  assert.equal(itemFor(contentEl, fixture.b.path).classes.has("is-continu-member"), false);
});

test("refreshContinuMembershipHighlight retire la surbrillance quand Continu n'est plus la leaf active", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  assert.equal(itemFor(contentEl, fixture.a.path).classes.has("is-continu-member"), true);

  // L'utilisateur bascule sur un autre onglet : Continu n'est plus la leaf
  // centrale de travail (dernière leaf active du rootSplit devient un
  // MarkdownView quelconque).
  view.app.workspace.getMostRecentLeaf = (root) =>
    root === view.app.workspace.rootSplit ? { getRoot: () => root, view: {} } : null;
  view.refreshContinuMembershipHighlight();

  assert.equal(itemFor(contentEl, fixture.a.path).classes.has("is-continu-member"), false);

  // Retour sur l'onglet Continu : la surbrillance est restaurée depuis les membres réels.
  view.app.workspace.getMostRecentLeaf = (root) =>
    root === view.app.workspace.rootSplit ? { getRoot: () => root, view: continuView } : null;
  view.refreshContinuMembershipHighlight();

  assert.equal(itemFor(contentEl, fixture.a.path).classes.has("is-continu-member"), true);
});

/* ===================== §16 — absence de pollution visuelle (2B.2) ===================== */

test("aucune trace des anciens contrôles cercle/circle-check/aria-pressed de membership", async () => {
  const fixture = buildFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.a.path]);
  const { view, contentEl } = buildView(fixture, { activeContinuView: continuView });
  await view.render(true);

  assert.equal(contentEl.querySelectorAll(".feuillets-continu-toggle").length, 0, "le contrôle 2B.2 ne doit plus exister");
  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(itemA.getAttr("aria-pressed"), null, "aucun aria-pressed de membership sur la ligne");
  assert.equal(itemA.getAttr("data-continu-path"), null);
  // Aucun descendant de la ligne ne porte l'icône circle/circle-check.
  const iconChildren = itemA.children.filter((c) => c.icon === "circle" || c.icon === "circle-check");
  assert.equal(iconChildren.length, 0);
});
