import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TFolder } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { VIEW_PREVIEW } from "../src/constants.js";
import { createProjectScope } from "../src/services/compile-scope.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/* §36 du chantier « espace central Feuillets » : la surface centrale
 * (workspace / documents / edition) est un état de SESSION de BoardView —
 * jamais persisté, jamais mélangé à `boardMode`. Ce fichier vérifie le
 * contrat complet : mémoire du mode Board, absence d'effet de bord sur
 * Preview côté Documents, réutilisation d'UNE SEULE Preview classique côté
 * Édition, et stabilité de la leaf du Tableau. */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; }, removeProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  hasClass(className) { return this.classes.has(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getAttr(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

/* `_render` consulte `document.activeElement` (isInputFocused) : un document
 * minimal suffit — aucun test ici ne dépend du focus réel. */
if (!globalThis.document) globalThis.document = { activeElement: null };

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

/** Board monté avec des rendus de surface neutralisés : ce fichier teste la
 * MÉCANIQUE de `centralSurface`, pas le contenu des sous-vues (couvert par
 * test/edition-docs-content.test.js et test/edition-workspace-content.test.js). */
function buildBoard({ previewLeaves = [] } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  const contentEl = new FakeElement();
  const boardLeaf = { id: "board" };
  const calls = { getLeafKinds: [], setActiveLeaf: 0, revealLeaf: 0, docs: 0, edition: 0 };

  const workspace = {
    getLeavesOfType: (type) => (type === VIEW_PREVIEW ? previewLeaves : []),
    getLeaf: (kind) => {
      calls.getLeafKinds.push(kind);
      const leaf = {
        isDeferred: false,
        loadIfDeferred: async () => {},
        setViewState: async (state) => {
          if (state.type === VIEW_PREVIEW) {
            leaf.view = {
              compileScope: null,
              scopes: [],
              async setCompileScope(scope) { this.scopes.push(scope); this.compileScope = scope; },
            };
            previewLeaves.push(leaf);
          }
        },
        detach() { this.detached = true; },
      };
      return leaf;
    },
    setActiveLeaf: () => { calls.setActiveLeaf += 1; },
    revealLeaf: () => { calls.revealLeaf += 1; },
    on: () => ({}),
  };

  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.projectFolder = root.path;
  settings.projectMeta = {};

  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => {},
    getOrderedChildren: () => [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    wordCountOfFolder: async () => 0,
    updateDailyStats: async () => {},
    buildNumbering: () => new Map(),
    labelsOf: () => [],
    tagsOf: () => [],
    fmOf: () => ({}),
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
  };

  const app = { workspace, vault: { getAbstractFileByPath: () => null } };
  boardLeaf.app = app;
  const view = new BoardView({ app, contentEl }, plugin);
  view.leaf = boardLeaf;
  view.app = app;
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.tooltip = tooltip;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.barSep = (parent) => parent.createDiv({ cls: "feuillets-bar-sep" });
  // Corps des surfaces neutralisé : seule la mécanique est testée ici.
  view.renderBoard = () => {};
  view.renderBoardWholeManuscript = () => {};
  view.renderBreadcrumbs = () => {};
  view.renderOutline = async () => {};
  view.renderCheminDeFer = () => {};
  view.renderTimeline = () => {};
  view.renderDocumentsSurface = async () => { calls.docs += 1; };
  view.renderEditionSurface = async () => { calls.edition += 1; };

  return { view, contentEl, plugin, settings, root, calls, previewLeaves, boardLeaf };
}

function modeButtons(contentEl) {
  return findAll(contentEl, (el) => el.tag === "button" && el.icon);
}

/* 1. Board démarre sur workspace. */
test("BoardView : la surface centrale démarre sur workspace, jamais persistée", async () => {
  const { view, settings } = buildBoard();
  assert.equal(view.centralSurface, "workspace");
  await view.render(true);
  assert.equal(settings.centralSurface, undefined, "aucun réglage persistant créé");
  assert.equal(settings.boardMode, DEFAULT_SETTINGS.boardMode);
});

/* 2. boardMode historique inchangé + 3. Plan → Documents → retour = Plan. */
test("BoardView : Plan → Documents → retour workspace retrouve exactement Plan", async () => {
  const { view, contentEl, settings, root, calls } = buildBoard();
  settings.projectMeta[root.path] = { boardMode: "outline" };
  await view.render(true);

  const documents = modeButtons(contentEl).find((b) => b.icon === "folder-cog");
  assert.ok(documents, "l'accès Documents éditoriaux est présent dans la barre");
  await view.setCentralSurface("documents");

  assert.equal(view.centralSurface, "documents");
  assert.equal(calls.docs, 1);
  assert.equal(settings.projectMeta[root.path].boardMode, "outline", "boardMode n'est jamais touché par Documents");

  const outline = modeButtons(contentEl).find((b) => b.icon === "list-tree");
  await outline.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.centralSurface, "workspace");
  assert.equal(settings.projectMeta[root.path].boardMode, "outline");
});

/* 4. Chronologie → Édition → retour workspace = Chronologie. */
test("BoardView : Chronologie → Édition → retour workspace retrouve exactement Chronologie", async () => {
  const { view, contentEl, settings, root } = buildBoard();
  // "timeline" est masqué par défaut en Fiction (utils/project-modes.ts) :
  // la préférence projet le rend visible, comme un vrai réglage utilisateur.
  settings.projectMeta[root.path] = { boardMode: "timeline", hiddenBoardModes: [] };
  await view.render(true);

  await view.setCentralSurface("edition");
  assert.equal(settings.projectMeta[root.path].boardMode, "timeline");

  const timeline = modeButtons(contentEl).find((b) => b.icon === "milestone");
  await timeline.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.centralSurface, "workspace");
  assert.equal(settings.projectMeta[root.path].boardMode, "timeline");
});

/* 5. Documents ne crée AUCUN Preview. */
test("BoardView : entrer dans Documents ne crée, ne ferme et ne déplace aucune Preview", async () => {
  const { view, calls, previewLeaves } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("documents");

  assert.deepEqual(calls.getLeafKinds, [], "aucune leaf demandée");
  assert.equal(previewLeaves.length, 0);
  assert.equal(calls.setActiveLeaf, 0);
});

/* 6. Édition crée/réutilise exactement UNE VIEW_PREVIEW classique. */
test("BoardView : entrer dans Édition ouvre exactement une Preview classique, sur le projectScope", async () => {
  const { view, root, previewLeaves, calls } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition");

  assert.equal(previewLeaves.length, 1, "une seule Preview");
  assert.deepEqual(calls.getLeafKinds, ["split"], "créée À CÔTÉ de la leaf du Tableau, jamais en onglet");
  assert.deepEqual(previewLeaves[0].view.scopes, [createProjectScope(root.path)]);
});

test("BoardView : une Preview déjà ouverte est réutilisée, jamais dupliquée", async () => {
  const existing = {
    isDeferred: false,
    loadIfDeferred: async () => {},
    view: { compileScope: null, scopes: [], async setCompileScope(scope) { this.scopes.push(scope); this.compileScope = scope; } },
    detach() { this.detached = true; },
  };
  const { view, previewLeaves, calls } = buildBoard({ previewLeaves: [existing] });
  await view.render(true);
  await view.setCentralSurface("edition");

  assert.equal(previewLeaves.length, 1);
  assert.equal(previewLeaves[0], existing);
  assert.deepEqual(calls.getLeafKinds, [], "aucune nouvelle leaf");
});

/* 7-8. La leaf du Tableau reste la même ; aucune leaf « Édition » n'existe. */
test("BoardView : Édition vit dans la leaf du Tableau — aucune leaf Édition autonome", async () => {
  const { view, boardLeaf, calls } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition");

  assert.equal(view.leaf, boardLeaf, "toujours la même leaf");
  assert.equal(calls.getLeafKinds.filter((kind) => kind === "tab").length, 0, "aucun onglet Édition créé");
  assert.equal(calls.edition, 1);
});

test("BoardView : aucun type de vue « edition workspace » n'est demandé au workspace", async () => {
  const requested = [];
  const { view } = buildBoard();
  view.app.workspace.getLeavesOfType = (type) => { requested.push(type); return []; };
  await view.render(true);
  await view.setCentralSurface("edition");

  assert.equal(requested.includes("feuillets-edition-workspace"), false);
});

/* 9. Changer de mode Édition ne crée aucune leaf. */
test("BoardView : passer d'un mode Édition à l'autre ne crée aucune leaf ni seconde Preview", async () => {
  const { view, calls, previewLeaves } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition", "composition");
  const kindsAfterEnter = [...calls.getLeafKinds];

  await view.setCentralSurface("edition", "layout");
  await view.setCentralSurface("edition", "export");

  assert.deepEqual(calls.getLeafKinds, kindsAfterEnter, "aucune leaf supplémentaire");
  assert.equal(previewLeaves.length, 1, "toujours une seule Preview");
  assert.equal(view.editionMode, "export");
});

/* 10. Micro-correctif « cycle de vie de la Preview créée par Édition » :
 * une Preview TEMPORAIRE (créée par Édition faute d'en trouver une) doit être
 * détachée en quittant réellement la surface Édition ; une Preview
 * PRÉEXISTANTE ne doit jamais l'être. */

/* TEST A : aucune Preview avant Édition → une Preview créée → quitter
 * Édition vers workspace → cette Preview est détachée, aucune ne reste. */
test("BoardView : la Preview créée par Édition est détachée en revenant au workspace (CAS B)", async () => {
  const { view, contentEl, previewLeaves } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition");
  assert.equal(previewLeaves.length, 1, "une Preview créée par Édition");
  const created = previewLeaves[0];

  const cards = modeButtons(contentEl).find((b) => b.icon === "layout-grid");
  await cards.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.centralSurface, "workspace");
  assert.equal(created.detached, true, "la Preview temporaire est détachée");
});

/* TEST B : une Preview existe déjà avant Édition → réutilisée → quitter
 * Édition → cette Preview reste ouverte (jamais détachée). */
test("BoardView : une Preview préexistante n'est jamais fermée en quittant Édition (CAS A)", async () => {
  const existing = {
    isDeferred: false,
    loadIfDeferred: async () => {},
    view: { compileScope: null, scopes: [], async setCompileScope(scope) { this.scopes.push(scope); this.compileScope = scope; } },
    detach() { this.detached = true; },
  };
  const { view, contentEl, previewLeaves } = buildBoard({ previewLeaves: [existing] });
  await view.render(true);
  await view.setCentralSurface("edition");
  assert.equal(previewLeaves.length, 1);
  assert.equal(previewLeaves[0], existing, "la Preview existante est réutilisée, jamais dupliquée");

  const cards = modeButtons(contentEl).find((b) => b.icon === "layout-grid");
  await cards.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.centralSurface, "workspace");
  assert.equal(previewLeaves.length, 1, "la Preview reste ouverte");
  assert.equal(existing.detached, undefined, "jamais détachée : elle préexistait à Édition");
});

/* TEST C : changer de mode interne Composition → Mise en page → Export ne
 * recrée ni ne ferme jamais la Preview temporaire. */
test("BoardView : changer de mode Édition (Composition/Mise en page/Export) ne recrée ni ne ferme la Preview", async () => {
  const { view, previewLeaves } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition", "composition");
  assert.equal(previewLeaves.length, 1);
  const created = previewLeaves[0];

  await view.setCentralSurface("edition", "layout");
  await view.setCentralSurface("edition", "export");
  await view.setCentralSurface("edition", "composition");

  assert.equal(previewLeaves.length, 1, "toujours la même Preview, jamais recréée");
  assert.equal(previewLeaves[0], created);
  assert.equal(created.detached, undefined, "jamais fermée pendant un changement de mode interne");
});

/* Documents fait aussi partie des surfaces « hors Édition » : une Preview
 * temporaire doit être détachée en y accédant depuis Édition. */
test("BoardView : quitter Édition vers Documents détache la Preview temporaire", async () => {
  const { view, previewLeaves } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition");
  assert.equal(previewLeaves.length, 1);
  const created = previewLeaves[0];

  await view.setCentralSurface("documents");

  assert.equal(view.centralSurface, "documents");
  assert.equal(created.detached, true, "la Preview temporaire est détachée en quittant Édition vers Documents");
});

/* §2/§3 : Documents et Édition sont permanents ; les outils Board ne
 * s'affichent QUE sur la surface workspace. */
test("BoardView : Documents et Édition restent visibles même quand tous les modes historiques sont masqués", async () => {
  const { view, contentEl, settings, root } = buildBoard();
  settings.projectMeta[root.path] = { hiddenBoardModes: ["board", "outline", "arcs", "timeline"] };
  await view.render(true);

  const icons = modeButtons(contentEl).map((b) => b.icon);
  assert.ok(icons.includes("folder-cog"), "Documents éditoriaux reste accessible");
  assert.ok(icons.includes("panel-top"), "Édition reste accessible");
});

test("BoardView : les outils strictement Board disparaissent sur Documents et Édition", async () => {
  const { view, contentEl, settings, root } = buildBoard();
  settings.projectMeta[root.path] = { hiddenBoardModes: [] };
  await view.render(true);
  const workspaceIcons = modeButtons(contentEl).map((b) => b.icon);
  assert.ok(workspaceIcons.includes("list-filter"), "filtres présents sur le workspace");
  assert.ok(workspaceIcons.includes("sliders-horizontal"), "options de vue présentes sur le workspace");

  for (const surface of ["documents", "edition"]) {
    await view.setCentralSurface(surface);
    const icons = modeButtons(contentEl).map((b) => b.icon);
    assert.equal(icons.includes("list-filter"), false, `pas de filtres sur ${surface}`);
    assert.equal(icons.includes("filter"), false, `pas de filtres sur ${surface}`);
    assert.equal(icons.includes("sliders-horizontal"), false, `pas d'options de vue sur ${surface}`);
    // Les quatre modes historiques restent là : ils sont le chemin du retour.
    for (const icon of ["layout-grid", "list-tree", "git-branch", "milestone"]) {
      assert.ok(icons.includes(icon), `${icon} reste accessible depuis ${surface}`);
    }
  }
});

test("BoardView : sur Documents/Édition, aucun mode historique n'est marqué actif", async () => {
  const { view, contentEl } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("documents");

  const buttons = modeButtons(contentEl);
  const active = buttons.filter((b) => b.hasClass("feuillets-mode-active")).map((b) => b.icon);
  assert.deepEqual(active, ["folder-cog"], "seul l'accès Documents est actif");
});

/* ==================== §37 : Documents éditoriaux au centre ================
 * Micro-correctif « ne plus embarquer d'ItemView dans BoardView » :
 * EditionDocsContent est un composant DOM PUR (aucune WorkspaceLeaf, aucun
 * cycle de vie de View), monté directement dans la surface centrale — même
 * leaf que le Tableau (BoardView reste la SEULE ItemView), aucun second
 * modèle Documents n'est créé. */

test("BoardView : la surface Documents monte EditionDocsContent, composant DOM pur, sur la leaf du Tableau", async () => {
  const { view, contentEl } = buildBoard();
  // Rendu réel de la surface, cette fois : pas de stub.
  delete view.renderDocumentsSurface;
  await view.render(true);
  await view.setCentralSurface("documents");

  assert.ok(view.docsContent, "un EditionDocsContent est instancié");
  assert.equal(typeof view.docsContent.getViewType, "undefined", "pas une View : aucun getViewType");
  assert.equal(typeof view.docsContent.leaf, "undefined", "aucune WorkspaceLeaf reçue ni stockée");
  const surface = findAll(contentEl, (el) => el.hasClass("feuillets-central-surface"))[0];
  assert.ok(surface, "la surface centrale est rendue");
  assert.ok(
    findAll(surface, (el) => el.hasClass("feuillets-edition-docs-container")).length === 1,
    "le contenu réel d'EditionDocsContent est monté dans la surface"
  );
  assert.equal(
    findAll(surface, (el) => el.hasClass("feuillets-section-head")).length,
    0,
    "composant toujours intégré : pas de grand en-tête repliable"
  );
});

test("BoardView : revenir sur Documents réutilise la MÊME instance de composant (aucun état métier perdu)", async () => {
  const { view } = buildBoard();
  delete view.renderDocumentsSurface;
  await view.render(true);
  await view.setCentralSurface("documents");
  const first = view.docsContent;
  await view.setCentralSurface("workspace");
  await view.setCentralSurface("documents");

  assert.equal(view.docsContent, first);
});

test("BoardView : aucun second modèle Documents — la surface délègue à EditionDocsContent, jamais à une ItemView", () => {
  const source = readFileSync("src/views/board-view.ts", "utf8");
  assert.match(source, /new EditionDocsContent\(this\.app, this\.plugin, host\)/);
  assert.doesNotMatch(source, /new EditionDocsView\(/, "plus aucune ItemView Documents imbriquée");
  // Aucune reconstruction locale du dossier Edition/ ni de ses documents.
  assert.doesNotMatch(source, /getEditionRoot|EDITION_DOCUMENTS|prepareSubmission/);
});

/* ==================== Micro-correctif : ne plus embarquer d'ItemView =====
 * dans BoardView ==========================================================
 * BoardView est déjà la SEULE ItemView de l'espace central : Documents
 * (EditionDocsContent) et Composition (EditionCompositionContent, montée
 * par EditionWorkspaceContent) sont des composants DOM purs, sans View, ni
 * ItemView, ni WorkspaceLeaf propre. Les parcours réels (Cartes/Plan/Chemin
 * de fer/Chronologie ↔ Documents/Édition) ne recréent jamais la leaf ni le
 * contentEl du Tableau. */

test("BoardView : Documents ne construit aucune ItemView — composant DOM pur seulement", async () => {
  const { view } = buildBoard();
  delete view.renderDocumentsSurface;
  await view.render(true);
  await view.setCentralSurface("documents");

  assert.ok(view.docsContent, "EditionDocsContent instancié");
  assert.equal(typeof view.docsContent.onOpen, "undefined", "aucune méthode de cycle de vie ItemView (onOpen)");
  assert.equal(typeof view.docsContent.getIcon, "undefined", "aucune méthode de cycle de vie ItemView (getIcon)");
  assert.equal(typeof view.docsContent.leaf, "undefined", "aucune WorkspaceLeaf reçue");
});

test("BoardView : Édition (mode Composition) ne construit aucune ItemView — composant DOM pur seulement", async () => {
  const { view } = buildBoard();
  delete view.renderEditionSurface;
  await view.render(true);
  await view.setCentralSurface("edition", "composition");

  const composition = view.editionContent && view.editionContent.compositionContent;
  assert.ok(composition, "EditionCompositionContent instancié");
  assert.equal(typeof composition.onOpen, "undefined", "aucune méthode de cycle de vie ItemView (onOpen)");
  assert.equal(typeof composition.getIcon, "undefined", "aucune méthode de cycle de vie ItemView (getIcon)");
  assert.equal(typeof composition.leaf, "undefined", "aucune WorkspaceLeaf reçue");
});

test("BoardView : Cartes → Documents → Cartes conserve exactement la même leaf et le même contentEl", async () => {
  const { view, contentEl, boardLeaf } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("documents");
  await view.setCentralSurface("workspace");

  assert.equal(view.leaf, boardLeaf, "toujours la même leaf du Tableau");
  assert.equal(view.contentEl, contentEl, "toujours le même contentEl — jamais reconstruit par une leaf annexe");
});

test("BoardView : Plan → Documents → Plan conserve exactement la même leaf et le même contentEl", async () => {
  const { view, contentEl, root, settings, boardLeaf } = buildBoard();
  settings.projectMeta[root.path] = { boardMode: "outline" };
  await view.render(true);
  await view.setCentralSurface("documents");
  const outline = modeButtons(contentEl).find((b) => b.icon === "list-tree");
  await outline.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.leaf, boardLeaf);
  assert.equal(view.contentEl, contentEl);
  assert.equal(view.centralSurface, "workspace");
  assert.equal(settings.projectMeta[root.path].boardMode, "outline");
});

test("BoardView : Cartes → Édition → Cartes conserve exactement la même leaf et le même contentEl", async () => {
  const { view, contentEl, boardLeaf } = buildBoard();
  await view.render(true);
  await view.setCentralSurface("edition");
  const cards = modeButtons(contentEl).find((b) => b.icon === "layout-grid");
  await cards.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.leaf, boardLeaf);
  assert.equal(view.contentEl, contentEl);
  assert.equal(view.centralSurface, "workspace");
});

test("BoardView : Chemin de fer → Édition → Chemin de fer conserve exactement la même leaf et le même contentEl", async () => {
  const { view, contentEl, root, settings, boardLeaf } = buildBoard();
  settings.projectMeta[root.path] = { boardMode: "arcs" };
  await view.render(true);
  await view.setCentralSurface("edition");
  const arcs = modeButtons(contentEl).find((b) => b.icon === "git-branch");
  await arcs.events.get("click")({});
  await Promise.resolve();

  assert.equal(view.leaf, boardLeaf);
  assert.equal(view.contentEl, contentEl);
  assert.equal(view.centralSurface, "workspace");
  assert.equal(settings.projectMeta[root.path].boardMode, "arcs");
});
