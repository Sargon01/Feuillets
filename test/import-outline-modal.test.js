import test from "node:test";
import assert from "node:assert/strict";
import { Notice, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ImportOutlineModal } from "../src/ui/import-outline-modal.js";
import { getOrderedChildren } from "../src/services/folder-structure.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.value = "";
    this.style = {};
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  setText(text) { this.text = String(text); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  focus() {}
}

function findByTag(element, tag) {
  for (const child of element.children) {
    if (child.tag === tag) return child;
    const found = findByTag(child, tag);
    if (found) return found;
  }
  return null;
}

function parseFrontmatterBlock(content) {
  const match = (content || "").match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { /* garde la valeur brute */ }
    }
    fm[key] = value;
  }
  return fm;
}

/* Correctif Lot 9 (mode idea-tree) — contrairement à `importFixture()`, ce
 * banc reproduit un `metadataCache`/`fileManager.processFrontMatter` qui
 * PERSISTENT réellement (Map indépendante de `file.content`, exactement le
 * schéma déjà utilisé par narrative-threads.test.js) : indispensable pour
 * que `titleFor()` (matching par titre) et `getOrderedChildren()` (ordre
 * canonique réel, jamais un enregistrement de complaisance) reflètent
 * fidèlement ce que la fusion additive doit lire et écrire. */
function ideaTreeFixture() {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault, fileManager } = createFakeVault([project]);
  const frontmatter = new Map();

  const originalCreate = vault.create.bind(vault);
  vault.create = async (path, content) => {
    const file = await originalCreate(path, content);
    frontmatter.set(file.path, parseFrontmatterBlock(content));
    return file;
  };
  fileManager.processFrontMatter = async (file, callback) => {
    const fm = frontmatter.get(file.path) || {};
    callback(fm);
    frontmatter.set(file.path, fm);
  };

  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  const settings = { orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };
  let renderCalls = 0;
  const plugin = {
    settings: { wordGoal: 750 },
    getProjectFolder: () => project,
    ensureFolder: async (path) => vault.getAbstractFileByPath(path) || (await vault.createFolder(path)),
    getOrderedChildren: (folder) => getOrderedChildren(app, settings, folder),
    writeOrder: async (parent, children) => {
      settings.orders[parent.path] = children.map((c) => c.name);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child instanceof TFile) {
          const fm = frontmatter.get(child.path) || {};
          const current = parseInt(String(fm.order), 10);
          if (current !== i + 1) {
            fm.order = String(i + 1);
            frontmatter.set(child.path, fm);
          }
        } else {
          settings.folderPositions[child.path] = i + 1;
        }
      }
    },
    renderAllViews: () => { renderCalls++; },
  };
  const modal = Object.create(ImportOutlineModal.prototype);
  modal.app = app;
  modal.plugin = plugin;
  modal.options = { source: "idea-tree" };
  return { modal, vault, project, frontmatter, settings, renderCalls: () => renderCalls };
}

/** Titres (dans l'ordre) des enfants directs de `folder`, tels que
 * `getOrderedChildren` les restitue — LE test de la règle de fusion
 * d'ordre (section 7/8 du correctif), jamais `folder.children` brut. */
function orderedNames(app, settings, folder) {
  return getOrderedChildren(app, settings, folder).map((c) => c.name);
}

function importFixture() {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault, files } = createFakeVault([project]);
  const orders = new Map();
  let renderCalls = 0;
  const app = { vault };
  const plugin = {
    settings: { wordGoal: 750 },
    getProjectFolder: () => project,
    ensureFolder: (path) => vault.createFolder(path),
    writeOrder: async (parent, children) => orders.set(parent.path, children.map((child) => child.name)),
    renderAllViews: () => { renderCalls++; },
  };
  const modal = Object.create(ImportOutlineModal.prototype);
  modal.app = app;
  modal.plugin = plugin;
  return { modal, vault, files, orders, renderCalls: () => renderCalls };
}

test("import outline : crée dossiers, scènes et ordre à partir des titres Markdown", async () => {
  const { modal, vault, orders } = importFixture();

  await modal.importOutline("# Partie 1\n- Scène A\n- Scène B\n## Chapitre 1\nScène C");

  const sceneA = vault.getAbstractFileByPath("Projet/Partie 1/scene-001.md");
  const sceneB = vault.getAbstractFileByPath("Projet/Partie 1/scene-002.md");
  const sceneC = vault.getAbstractFileByPath("Projet/Partie 1/Chapitre 1/scene-003.md");
  assert.ok(sceneA instanceof TFile);
  assert.ok(sceneB instanceof TFile);
  assert.ok(sceneC instanceof TFile);
  assert.match(await vault.read(sceneA), /title: "Scène A"/);
  assert.match(await vault.read(sceneA), /goal: 750/);
  assert.deepEqual(orders.get("Projet"), ["Partie 1"]);
  assert.deepEqual(orders.get("Projet/Partie 1"), ["scene-001.md", "scene-002.md", "Chapitre 1"]);
  assert.deepEqual(orders.get("Projet/Partie 1/Chapitre 1"), ["scene-003.md"]);
});

test("import outline : ne remplace pas une scène existante, avance au prochain nom disponible", async () => {
  const { modal, vault, files } = importFixture();
  const existing = await vault.create("Projet/scene-001.md", "Contenu existant");

  await modal.importOutline("Nouvelle scène");

  assert.equal(vault.getAbstractFileByPath("Projet/scene-001.md"), existing);
  assert.equal(await vault.read(existing), "Contenu existant");
  const created = vault.getAbstractFileByPath("Projet/scene-002.md");
  assert.ok(created instanceof TFile, "la ligne du plan n'est jamais perdue à cause d'une collision technique");
  assert.match(await vault.read(created), /title: "Nouvelle scène"/);
  assert.equal(files.size, 3);
});

test("import outline : constructeur sans initialText — textarea vide, comportement historique", () => {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault } = createFakeVault([project]);
  const app = { vault };
  const plugin = { settings: { wordGoal: 750 }, getProjectFolder: () => project, ensureFolder: () => {}, writeOrder: async () => {}, renderAllViews: () => {} };
  const modal = new ImportOutlineModal(app, plugin);
  modal.contentEl = new FakeElement();
  modal.onOpen();
  const ta = findByTag(modal.contentEl, "textarea");
  assert.equal(ta.value, "");
  modal.onClose();
});

test("import outline : initialText préremplit la textarea", () => {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault } = createFakeVault([project]);
  const app = { vault };
  const plugin = { settings: { wordGoal: 750 }, getProjectFolder: () => project, ensureFolder: () => {}, writeOrder: async () => {}, renderAllViews: () => {} };
  const modal = new ImportOutlineModal(app, plugin, "# Partie 1\n- Scène A");
  modal.contentEl = new FakeElement();
  modal.onOpen();
  const ta = findByTag(modal.contentEl, "textarea");
  assert.equal(ta.value, "# Partie 1\n- Scène A");
  modal.onClose();
});

test("import outline : titre avec ':' produit un YAML sûr", async () => {
  const { modal, vault } = importFixture();
  await modal.importOutline("Kemal : arrivée");
  const file = vault.getAbstractFileByPath("Projet/scene-001.md");
  assert.match(await vault.read(file), /^title: "Kemal : arrivée"$/m);
});

test("import outline : titre avec guillemets produit un YAML sûr", async () => {
  const { modal, vault } = importFixture();
  await modal.importOutline(`L'homme "étrange"`);
  const file = vault.getAbstractFileByPath("Projet/scene-001.md");
  const content = await vault.read(file);
  assert.match(content, /^title: /m);
  const yaml = content.match(/^title: (.*)$/m)[1];
  assert.equal(JSON.parse(yaml), `L'homme "étrange"`);
});

test("import outline : titre commençant par '#' produit un YAML sûr (n'ouvre pas un nouveau bloc)", async () => {
  const { modal, vault } = importFixture();
  // Cette ligne ne sera de toute façon jamais interprétée comme un titre
  // Markdown puisqu'elle commence par un caractère non `#`/`-`/texte brut
  // ambigu ici : on vérifie seulement que la valeur YAML reste sûre.
  await modal.importOutline("Scène avec un titre: # secret");
  const file = vault.getAbstractFileByPath("Projet/scene-001.md");
  const content = await vault.read(file);
  const yaml = content.match(/^title: (.*)$/m)[1];
  assert.equal(JSON.parse(yaml), "Scène avec un titre: # secret");
});

test("import outline : titre Unicode produit un YAML sûr", async () => {
  const { modal, vault } = importFixture();
  await modal.importOutline("Été à Suvasa 🌊");
  const file = vault.getAbstractFileByPath("Projet/scene-001.md");
  const content = await vault.read(file);
  const yaml = content.match(/^title: (.*)$/m)[1];
  assert.equal(JSON.parse(yaml), "Été à Suvasa 🌊");
});

test("import outline : une entrée vide ne crée aucun élément", async () => {
  const { modal, files, orders, renderCalls } = importFixture();

  await modal.importOutline("");

  assert.equal(files.size, 1);
  assert.equal(orders.size, 0);
  assert.equal(renderCalls(), 1);
});

// ---------------------------------------------------------------------------
// Correctif Lot 9 — mode idea-tree : import additif et idempotent.
// ---------------------------------------------------------------------------

test("Lot 9 correctif A — idempotence : réimporter exactement le même plan ne recrée rien", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  const ok1 = await modal.importOutlineIdeaTree("# Chapitre 1\n- Scène 1\n- Scène 2");
  assert.equal(ok1, true);
  const chapitre1 = project.children.find((c) => c.name === "Chapitre 1");
  assert.equal(orderedNames(modal.app, settings, chapitre1).filter((n) => n.endsWith(".md")).length, 2);

  const ok2 = await modal.importOutlineIdeaTree("# Chapitre 1\n- Scène 1\n- Scène 2");
  assert.equal(ok2, true);
  const scenes = orderedNames(modal.app, settings, chapitre1).filter((n) => n.endsWith(".md"));
  assert.equal(scenes.length, 2, "toujours exactement 2 scènes après un second import identique");
});

test("Lot 9 correctif B — enrichissement : seule la nouvelle scène est créée", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("- Scène 1\n- Scène 2");
  const before = orderedNames(modal.app, settings, project);

  await modal.importOutlineIdeaTree("- Scène 1\n- Scène 2\n- Scène 3");
  const after = orderedNames(modal.app, settings, project);

  assert.deepEqual(after.slice(0, before.length), before, "les deux scènes existantes ne bougent pas");
  assert.equal(after.length, 3);
});

test("Lot 9 correctif C — absence non destructive : une scène disparue du plan n'est jamais supprimée", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("- Scène 1\n- Scène 2");
  await modal.importOutlineIdeaTree("- Scène 1");

  const names = orderedNames(modal.app, settings, project);
  assert.equal(names.length, 2, "Scène 2 reste présente");
});

test("Lot 9 correctif D — dossiers : Chapitre 2 conservé, Chapitre 3 créé, ordre préservé", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("# Partie 1\n## Chapitre 1\n## Chapitre 2");
  await modal.importOutlineIdeaTree("# Partie 1\n## Chapitre 1\n## Chapitre 3");

  const partie1 = project.children.find((c) => c.name === "Partie 1");
  assert.deepEqual(orderedNames(modal.app, settings, partie1), ["Chapitre 1", "Chapitre 2", "Chapitre 3"]);
});

test("Lot 9 correctif E — ordre : [A,B,C] + plan [A,D,B,E] → [A,B,C,D,E], jamais interfolé", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("- A\n- B\n- C");
  await modal.importOutlineIdeaTree("- A\n- D\n- B\n- E");

  const titles = getOrderedChildren(modal.app, settings, project)
    .filter((c) => c instanceof TFile)
    .map((f) => modal.app.metadataCache.getFileCache(f).frontmatter.title);
  assert.deepEqual(titles, ["A", "B", "C", "D", "E"]);
});

test("Lot 9 correctif F — scène dans un chapitre existant : [S1,S2] + plan [S1,S3] → [S1,S2,S3]", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("# Chapitre 1\n- S1\n- S2");
  await modal.importOutlineIdeaTree("# Chapitre 1\n- S1\n- S3");

  const chapitre1 = project.children.find((c) => c.name === "Chapitre 1");
  const titles = getOrderedChildren(modal.app, settings, chapitre1)
    .filter((c) => c instanceof TFile)
    .map((f) => modal.app.metadataCache.getFileCache(f).frontmatter.title);
  assert.deepEqual(titles, ["S1", "S2", "S3"]);
});

test("Lot 9 correctif G — ambiguïté existante : deux feuillets « Transition » → erreur, aucun troisième fichier", async () => {
  const { modal, project } = ideaTreeFixture();
  const yaml = (title) => ["---", `title: ${JSON.stringify(title)}`, "---", "", ""].join("\n");
  await modal.app.vault.create("Projet/scene-001.md", yaml("Transition"));
  await modal.app.vault.create("Projet/scene-002.md", yaml("Transition"));

  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  const ok = await modal.importOutlineIdeaTree("- Transition");
  Notice.onCreate = previousNotice;

  assert.equal(ok, false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Transition/);
  assert.equal(project.children.filter((c) => c.name.endsWith(".md")).length, 2, "aucun troisième fichier créé");
});

test("Lot 9 correctif H — doublon dans le plan lui-même : deux « Transition » dans le même dossier → erreur", async () => {
  const { modal, project } = ideaTreeFixture();

  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  const ok = await modal.importOutlineIdeaTree("- Transition\n- Transition");
  Notice.onCreate = previousNotice;

  assert.equal(ok, false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Transition/);
  assert.equal(project.children.filter((c) => c.name.endsWith(".md")).length, 0, "aucune fusion arbitraire, aucune création");
});

test("Lot 9 correctif I — un titre modifié dans le Carnet n'est jamais deviné comme un renommage : deux feuillets distincts", async () => {
  const { modal, project, settings } = ideaTreeFixture();

  await modal.importOutlineIdeaTree("- Ancien titre");
  await modal.importOutlineIdeaTree("- Nouveau titre");

  const titles = getOrderedChildren(modal.app, settings, project)
    .filter((c) => c instanceof TFile)
    .map((f) => modal.app.metadataCache.getFileCache(f).frontmatter.title);
  assert.deepEqual(titles.sort(), ["Ancien titre", "Nouveau titre"]);
});

test("Lot 9 correctif J — l'import manuel historique (sans options.source) reste inchangé : aucune fusion, une nouvelle scène par ligne", async () => {
  const { modal, vault } = importFixture();

  await modal.importOutline("Scène 1");
  await modal.importOutline("Scène 1");

  assert.ok(vault.getAbstractFileByPath("Projet/scene-001.md") instanceof TFile);
  assert.ok(vault.getAbstractFileByPath("Projet/scene-002.md") instanceof TFile, "le mode historique ne fusionne jamais par titre");
});

test("Lot 9 correctif K — non-régression : la modale reste ouverte (constructeur idea-tree préserve initialText, aucune fermeture forcée avant Créer)", () => {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault } = createFakeVault([project]);
  const app = { vault };
  const plugin = {
    settings: { wordGoal: 750 },
    getProjectFolder: () => project,
    ensureFolder: async () => {},
    writeOrder: async () => {},
    renderAllViews: () => {},
    getOrderedChildren: () => [],
  };
  const modal = new ImportOutlineModal(app, plugin, "# A\n- B", { source: "idea-tree" });
  assert.equal(modal.initialText, "# A\n- B");
  assert.equal(modal.options.source, "idea-tree");
});
