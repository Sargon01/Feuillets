import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownView } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Micro-lot delta "bascule Markdown ↔ Continu dans la même leaf" — tests
 * d'intégration Binder : Maj+clic sur 2+ fichiers promeut la MÊME leaf de
 * travail (jamais une nouvelle), et le retrait du dernier membre au-delà de
 * 1 la fait redevenir MarkdownView. `workLeaf` simule fidèlement le
 * comportement réel d'Obsidian (`setViewState`/`openFile` remplacent
 * réellement `leaf.view`, jamais un simple flag) — même harnais que
 * test/binder-continu-membership.test.js, étendu avec une vraie
 * `ScriveningsView` (via `createFakeVault`, comme
 * test/scrivenings-composition.test.js) plutôt qu'un faux objet dupliquant
 * sa surface : cette fois la transformation DE VUE elle-même est testée. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
  requestAnimationFrame: () => 0,
};

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
    // requis par resolveCompileScopeFiles/getOrderedChildren (réels, jamais
    // mockés ici : la résolution du groupe doit être la VRAIE logique).
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    ...overrides,
  };
}

/* §17 du micro-correctif "typographie après toggle + Maj+clic en Continu" :
 * A..G (7 feuillets) pour tester une plage Maj+clic qui dépasse un simple
 * A+B — n'affecte aucun test existant, qui ne référence que a/b/c/d. */
function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md", "Corps A.");
  const b = new TFile("Roman/Manuscrit/B.md", "Corps B.");
  const c = new TFile("Roman/Manuscrit/C.md", "Corps C.");
  const d = new TFile("Roman/Manuscrit/D.md", "Corps D.");
  const e = new TFile("Roman/Manuscrit/E.md", "Corps E.");
  const f = new TFile("Roman/Manuscrit/F.md", "Corps F.");
  const g = new TFile("Roman/Manuscrit/G.md", "Corps G.");
  a.basename = "A"; b.basename = "B"; c.basename = "C"; d.basename = "D";
  e.basename = "E"; f.basename = "F"; g.basename = "G";
  root.children = [a, b, c, d, e, f, g];
  a.parent = root; b.parent = root; c.parent = root; d.parent = root;
  e.parent = root; f.parent = root; g.parent = root;
  const { vault } = createFakeVault([root, a, b, c, d, e, f, g]);
  return { root, a, b, c, d, e, f, g, vault };
}

/** Construit un Binder + UNE leaf de travail ("workLeaf") réutilisée
 * partout — `setViewState`/`openFile` y remplacent réellement `.view`,
 * exactement comme le fait Obsidian, jamais un simple booléen. */
function buildHarness(fixture, { workLeafFile = null } = {}) {
  const { root, a, b, c, d, e, f, g, vault } = fixture;
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path });
  const contentEl = new FakeElement();

  const leftSplit = { name: "left" };
  const rightSplit = { name: "right" };
  const rootSplit = { name: "root" };

  const scriveningsPlugin = { app: null, settings, updateStatusBar: () => {} };
  const setViewStateCalls = [];

  const workLeaf = {
    isDeferred: false,
    getRoot: () => rootSplit,
    loadIfDeferred: async () => {},
    setViewState: async (state) => {
      setViewStateCalls.push(state);
      const nextView = new ScriveningsView(workLeaf, scriveningsPlugin);
      // Le vrai CodeMirror (@codemirror/view) est un stub minimal dans ce
      // runtime de test (test/codemirror-view-stub.mjs, pas un vrai
      // constructeur) — même patron que test/scrivenings-composition.test.js :
      // mountEditor/destroyEditor sont remplacés par des espions, ce fichier
      // teste la transition de VUE elle-même, jamais CodeMirror.
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      workLeaf.view = nextView;
    },
    openFile: async (file) => {
      workLeaf.view = Object.assign(new MarkdownView(), { file });
    },
  };
  workLeaf.view = workLeafFile ? Object.assign(new MarkdownView(), { file: workLeafFile }) : {};

  const workspace = {
    leftSplit,
    rightSplit,
    rootSplit,
    getActiveViewOfType: (Type) =>
      Type === ScriveningsView && workLeaf.view instanceof ScriveningsView ? workLeaf.view : null,
    // Reproduit la RÉSOLUTION RÉELLE du membership Continu (voir
    // FeuilletsView.activeContinuMembershipView, feuillets-view.ts) : la
    // dernière leaf CENTRALE de travail, jamais la "vue globalement
    // active" — un clic dans le Binder (sidebar) ne doit jamais faire
    // perdre cette référence. `workLeaf` est la seule leaf centrale de ce
    // harnais.
    getMostRecentLeaf: (root) => (root === rootSplit ? workLeaf : null),
    getLeavesOfType: () => [],
    setActiveLeaf: () => {},
    revealLeaf: async () => {},
  };

  const app = {
    vault,
    workspace,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  scriveningsPlugin.app = app;
  workLeaf.app = app;
  workLeaf.contentEl = null;

  // Espion de non-régression (§10, §16) : Maj+clic dans un Continu déjà
  // existant ne doit JAMAIS appeler `getLeafForOpeningFile()` — jamais de
  // promotion Markdown, jamais d'onglet vide.
  const getLeafForOpeningFileCalls = [];

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a, b, c, d, e, f, g],
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
    getLeafForOpeningFile: () => { getLeafForOpeningFileCalls.push(true); return workLeaf; },
  };

  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  return { view, contentEl, plugin, app, workLeaf, setViewStateCalls, getLeafForOpeningFileCalls, ...fixture };
}

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

function click(el, modifiers = {}) {
  el.events.get("click")({
    preventDefault: () => {},
    stopPropagation: () => {},
    shiftKey: !!modifiers.shiftKey,
    ctrlKey: !!modifiers.ctrlKey,
    metaKey: !!modifiers.metaKey,
  });
}

/* Attend qu'une PILE d'awaits (flush → lecture séquentielle de chaque
 * fichier → openScope → setViewState…) ait entièrement résolu — un nombre
 * fixe de `Promise.resolve()` ne suffit pas dès que le groupe grandit
 * (chaque fichier ajoute un aller-retour `vault.read` de plus). Planifier
 * une macrotâche garantit que TOUTES les microtâches déjà en attente ont
 * fini de s'écouler avant qu'on continue — jamais un délai arbitraire au
 * sens du minutage : juste la frontière macrotâche/microtâche standard. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/* ===================== A. Clic normal ===================== */

test("A. Clic simple sur A hors Continu : ouverture Markdown historique, aucune promotion", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture);
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView);
  assert.equal(h.workLeaf.view.file, fixture.a);
});

/* ===================== B/D. Maj+clic : promotion same-leaf ===================== */

test("B/D. Maj+clic A puis Maj+clic D : la MÊME leaf devient Continu, jamais une nouvelle leaf", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof ScriveningsView, "la MÊME leaf doit être devenue Continu");
  assert.deepEqual(
    h.workLeaf.view.getMemberPaths(),
    [fixture.a.path, fixture.b.path, fixture.c.path, fixture.d.path]
  );
  assert.equal(h.setViewStateCalls.length, 1, "un seul changement de vue, sur cette leaf");
  assert.equal(h.setViewStateCalls[0].type, VIEW_SCRIVENINGS);
});

test("E. Après promotion réussie : _binderMultiSelect vidé, .is-selected disparu, .is-continu-member présent", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();

  assert.equal(h.plugin._binderMultiSelect.size, 0);
  const itemA = itemFor(h.contentEl, fixture.a.path);
  assert.equal(itemA.classes.has("is-selected"), false);
  assert.equal(itemA.classes.has("is-continu-member"), true);
  assert.equal(itemFor(h.contentEl, fixture.d.path).classes.has("is-continu-member"), true);
});

/* ===================== C. Résolution ===================== */

test("C. Résolution : ordre final = ordre du Binder", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.d });
  await h.view.render(true);

  // Clic D en premier (ancre), puis A : le Set _binderMultiSelect est
  // reconstruit dans l'ordre des SIBLINGS par handleMultiSelectClick — la
  // résolution doit rester celle du Binder (A,B,C,D), jamais l'ordre Set.
  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof ScriveningsView);
  assert.deepEqual(
    h.workLeaf.view.getMemberPaths(),
    [fixture.a.path, fixture.b.path, fixture.c.path, fixture.d.path]
  );
});

test("C. moins de 2 fichiers résolus : aucune promotion, sélection historique posée", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "un seul fichier résolu : jamais de promotion");
  assert.ok(h.plugin._binderMultiSelect.has(fixture.a.path));
});

/* ===================== §8-9 — Cmd/Ctrl+clic pilote RÉELLEMENT Continu === */

test("§9. Cmd/Ctrl+clic depuis un MarkdownView actif : promeut la MÊME leaf en Continu A+D", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.d.path), { ctrlKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof ScriveningsView, "la MÊME leaf devient Continu");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.d.path]);
  assert.equal(h.setViewStateCalls.length, 1, "un seul changement de vue, sur cette leaf");
  assert.equal(!h.plugin._binderMultiSelect || h.plugin._binderMultiSelect.size === 0, true, "jamais le chemin historique une fois promu");
});

test("§9. Cmd/Ctrl+clic sur le fichier déjà actif : aucune promotion (rien à ajouter), chemin historique", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { ctrlKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "toujours le même fichier, jamais de Continu à 1 membre");
  assert.ok(h.plugin._binderMultiSelect.has(fixture.a.path), "retombe sur la sélection historique");
});

test("§8. Continu déjà actif (A+D), Cmd/Ctrl+clic G : setMembers ajoute G en UNE recomposition", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.d.path), { ctrlKey: true });
  await settle();
  const continuView = h.workLeaf.view;
  assert.ok(continuView instanceof ScriveningsView);
  assert.equal(h.setViewStateCalls.length, 1);

  click(itemFor(h.contentEl, fixture.g.path), { ctrlKey: true });
  await settle();

  assert.equal(h.workLeaf.view, continuView, "toujours la même instance Continu");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.d.path, fixture.g.path]);
  assert.equal(h.setViewStateCalls.length, 1, "aucun changement de vue supplémentaire");
});

test("§8. Continu déjà actif (A+D+G), Cmd/Ctrl+clic D (membre) : setMembers le retire", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.d.path), { ctrlKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.g.path), { ctrlKey: true });
  await settle();
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.d.path, fixture.g.path]);

  click(itemFor(h.contentEl, fixture.d.path), { ctrlKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof ScriveningsView, "toujours Continu : il reste 2 membres");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.g.path]);
});

test("§8. Continu à 2 membres (A+G), Cmd/Ctrl+clic G (membre) : retombe à 1 → MÊME leaf redevient MarkdownView A", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.g.path), { ctrlKey: true });
  await settle();
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.g.path]);

  click(itemFor(h.contentEl, fixture.g.path), { ctrlKey: true });
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la même leaf redevient Markdown");
  assert.equal(h.workLeaf.view.file, fixture.a);
});

/* ===================== F. Continu à 3+ membres ===================== */

test("F. Continu à 3+ membres : clic simple ouvre CE fichier seul (openSingleMember), jamais un toggle de la composition", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();

  const continuView = h.workLeaf.view;
  assert.ok(continuView instanceof ScriveningsView);
  assert.equal(continuView.getMemberPaths().length, 4);

  click(itemFor(h.contentEl, fixture.b.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la MÊME leaf redevient Markdown — jamais un Continu à 3 segments");
  assert.equal(h.workLeaf.view.file, fixture.b, "B lui-même est ouvert, jamais un autre membre");
});

/* ===================== G. Clic simple dans Continu : fichier seul ======= */

test("G. Continu à 2 membres, clic simple sur l'un : la MÊME leaf redevient MarkdownView de CE fichier", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  assert.ok(h.workLeaf.view instanceof ScriveningsView);
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path]);

  click(itemFor(h.contentEl, fixture.a.path)); // clic simple sans modificateur
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la MÊME leaf redevient Markdown");
  assert.equal(h.workLeaf.view.file, fixture.a, "A lui-même est ouvert, jamais B");
  assert.equal(itemFor(h.contentEl, fixture.a.path).classes.has("is-continu-member"), false);
  assert.equal(itemFor(h.contentEl, fixture.b.path).classes.has("is-continu-member"), false);
});

/* ===================== §10-13 — focus Binder réel (micro-correctif) =====
 * Reproduit le scénario Obsidian réel : un clic dans le Binder (sidebar)
 * donne le focus à la sidebar, `getActiveViewOfType(ScriveningsView)` ne
 * retourne donc plus rien pendant l'interaction — volontairement forcé à
 * `null` ici pour prouver que le nouveau code ne dépend PLUS de cette API,
 * seulement de `getMostRecentLeaf(rootSplit)` (voir
 * FeuilletsView.activeContinuMembershipView). */

test("§10. Continu A+B, Binder a le focus (getActiveViewOfType===null), clic C : ouvre C seul sur la MÊME leaf, jamais A+B+C", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  assert.ok(h.workLeaf.view instanceof ScriveningsView);
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path]);

  // Le Binder prend le focus : plus aucune vue "globalement active".
  h.app.workspace.getActiveViewOfType = () => null;

  click(itemFor(h.contentEl, fixture.c.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la même leaf redevient Markdown de C, même avec le focus Binder");
  assert.equal(h.workLeaf.view.file, fixture.c);
});

test("§11. Continu A+B, Binder a le focus, clic B : openSingleMember atteint, MÊME leaf redevient MarkdownView B", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  assert.ok(h.workLeaf.view instanceof ScriveningsView);

  h.app.workspace.getActiveViewOfType = () => null;

  click(itemFor(h.contentEl, fixture.b.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la même leaf redevient Markdown");
  assert.equal(h.workLeaf.view.file, fixture.b, "B lui-même est ouvert, même avec le focus Binder");
});

test("§12. Continu ouvert dans un AUTRE onglet central, dernière leaf centrale = MarkdownView : clic historique", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  // Un Continu existe ailleurs (autre onglet central), mais la dernière
  // leaf centrale de travail reste `workLeaf`, un MarkdownView — un Continu
  // simplement ouvert ailleurs ne doit jamais capter le Binder.
  const elsewhereContinuView = new ScriveningsView(
    { app: h.app, contentEl: null },
    { app: h.app, settings: h.plugin.settings, updateStatusBar: () => {} }
  );
  h.app.workspace.getLeavesOfType = (type) =>
    type === VIEW_SCRIVENINGS ? [{ view: elsewhereContinuView }] : [];

  click(itemFor(h.contentEl, fixture.a.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView, "comportement historique : fichier ouvert normalement");
  assert.equal(h.workLeaf.view.file, fixture.a);
});

test("§13. Surbrillance : survit au focus Binder, disparaît immédiatement après un clic simple (ouverture fichier seul)", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();

  // Focus Binder : la surbrillance des membres A/B doit survivre.
  h.app.workspace.getActiveViewOfType = () => null;
  h.view.refreshContinuMembershipHighlight();
  assert.equal(itemFor(h.contentEl, fixture.a.path).classes.has("is-continu-member"), true);
  assert.equal(itemFor(h.contentEl, fixture.b.path).classes.has("is-continu-member"), true);

  // Clic simple sur C (non-membre) : ouvre C seul, la MÊME leaf quitte
  // Continu — plus aucune surbrillance Continu nulle part, même avec le
  // focus Binder.
  click(itemFor(h.contentEl, fixture.c.path));
  await settle();

  assert.ok(h.workLeaf.view instanceof MarkdownView);
  assert.equal(h.workLeaf.view.file, fixture.c);
  assert.equal(itemFor(h.contentEl, fixture.a.path).classes.has("is-continu-member"), false);
  assert.equal(itemFor(h.contentEl, fixture.b.path).classes.has("is-continu-member"), false);
  assert.equal(itemFor(h.contentEl, fixture.c.path).classes.has("is-continu-member"), false);
});

/* ===================== §16 — Maj+clic dans Continu : jamais getLeafForOpeningFile ===================== */

test("§16A. Continu A+B existant, Maj+clic D : getLeafForOpeningFile jamais appelé", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  assert.ok(h.workLeaf.view instanceof ScriveningsView);
  h.getLeafForOpeningFileCalls.length = 0; // ne compter qu'à partir d'ici : Continu A+B existe déjà

  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();

  assert.equal(h.getLeafForOpeningFileCalls.length, 0, "jamais appelé pour un Maj+clic dans un Continu existant");
});

test("§16B. Continu A+B existant, Maj+clic D : même instance, membres A+B+C+D, aucune nouvelle leaf, aucun setViewState supplémentaire", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  const continuView = h.workLeaf.view;
  assert.ok(continuView instanceof ScriveningsView);
  assert.equal(h.setViewStateCalls.length, 1);

  click(itemFor(h.contentEl, fixture.d.path), { shiftKey: true });
  await settle();

  assert.equal(h.workLeaf.view, continuView, "toujours la même instance Continu");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path, fixture.c.path, fixture.d.path]);
  assert.equal(h.setViewStateCalls.length, 1, "aucun setViewState supplémentaire");
});

/* ===================== §17 — Maj+clic ajoute une PLAGE étendue =========== */

test("§17. Continu A+B, Maj+clic G : Continu A+B+C+D+E+F+G en UNE seule recomposition, aucun membre retiré", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  await h.view.render(true);

  click(itemFor(h.contentEl, fixture.a.path), { shiftKey: true });
  await settle();
  click(itemFor(h.contentEl, fixture.b.path), { shiftKey: true });
  await settle();
  assert.ok(h.workLeaf.view instanceof ScriveningsView);
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path]);
  h.getLeafForOpeningFileCalls.length = 0; // Continu A+B existe déjà, ne compter qu'à partir d'ici

  const continuView = h.workLeaf.view;
  let openScopeCalls = 0;
  const realOpenScope = continuView.openScope.bind(continuView);
  continuView.openScope = async (scope) => {
    openScopeCalls++;
    return realOpenScope(scope);
  };

  click(itemFor(h.contentEl, fixture.g.path), { shiftKey: true });
  await settle();

  assert.equal(h.workLeaf.view, continuView, "aucune nouvelle leaf");
  assert.equal(openScopeCalls, 1, "une seule recomposition, jamais un toggle par fichier");
  assert.deepEqual(
    h.workLeaf.view.getMemberPaths(),
    [fixture.a.path, fixture.b.path, fixture.c.path, fixture.d.path, fixture.e.path, fixture.f.path, fixture.g.path],
    "plage complète A→G, ordre du Binder, aucun membre existant retiré"
  );
  assert.equal(h.getLeafForOpeningFileCalls.length, 0);
  assert.equal(h.setViewStateCalls.length, 1, "aucun changement de vue supplémentaire");
});
