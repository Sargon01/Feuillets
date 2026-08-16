import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, exportWithScope, exportFile } from "../src/services/compile-export.js";
import { createProjectScope } from "../src/services/compile-scope.js";

/* Reproduit le bug réel : « Uncaught (in promise) Error: File already
   exists. » — sur un système de fichiers insensible à la casse (macOS,
   Windows), un fichier de sortie déjà présent sous UNE casse ("Manuscrit.md")
   et un nom résolu sous une AUTRE casse ("manuscrit.md") ne doivent jamais
   déclencher un second create() : celui-ci échouerait au niveau du système
   de fichiers réel, alors que l'index Obsidian (sensible à la casse, lui)
   ne voit pas de collision par un simple getAbstractFileByPath(). Le
   fakeVault (test/helpers/fake-vault.ts) reste, lui, VOLONTAIREMENT
   sensible à la casse par défaut (comme demandé) — c'est le harness
   dédié ci-dessous (makeCaseInsensitiveVault) qui simule le comportement
   réel du système de fichiers, sans rendre tout le fakeVault global
   insensible à la casse. */

/** Enveloppe un fakeVault : create()/createBinary() lèvent
 * `Error: File already exists.` si un fichier du MÊME DOSSIER porte déjà
 * le même nom à la casse près — exactement le comportement observé sur
 * macOS/Windows, jamais reproduit par le fakeVault de base. */
function makeCaseInsensitiveVault(vault) {
  const collide = (path) => {
    const slash = path.lastIndexOf("/");
    const folderPath = slash >= 0 ? path.slice(0, slash) : "";
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const parent = folderPath ? vault.getAbstractFileByPath(folderPath) : null;
    if (!parent || !parent.children) return null;
    const lowerName = name.toLowerCase();
    return parent.children.find((c) => c instanceof TFile && c.name.toLowerCase() === lowerName && c.path !== path) || null;
  };
  const originalCreate = vault.create.bind(vault);
  const originalCreateBinary = vault.createBinary.bind(vault);
  vault.create = async (path, content) => {
    if (collide(path)) throw new Error("File already exists.");
    return originalCreate(path, content);
  };
  vault.createBinary = async (path, content) => {
    if (collide(path)) throw new Error("File already exists.");
    return originalCreateBinary(path, content);
  };
  return vault;
}

function withNoticeCapture(fn) {
  const notices = [];
  const previous = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  return fn(notices).finally(() => {
    Notice.onCreate = previous;
  });
}

function baseSettings(overrides = {}) {
  return {
    level1Role: "chapitres",
    orders: {},
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    ...overrides,
  };
}

test("A. nom legacy compileFileName minuscule après suppression du champ UI : toujours résolu correctement", async () => {
  const manuscript = new TFolder("Legacy/Manuscrit");
  const scene = new TFile("Legacy/Manuscrit/Scene.md", "Texte.");
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { vault } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = baseSettings({
    projectFolder: manuscript.path,
    compileFileName: "manuscrit.md",
  });

  const result = await compile(app, settings);
  assert.ok(result);
  assert.equal(result.outPath, "Legacy/Manuscrit/_Feuillets/Sortie/manuscrit.md");
  assert.ok(vault.getAbstractFileByPath("Legacy/Manuscrit/_Feuillets/Sortie/manuscrit.md"));
});

test("B. collision Markdown : Manuscrit.md existant + nom résolu manuscrit.md -> modifie le fichier existant, ne crée rien de second", async () => {
  const manuscript = new TFolder("Coll/Manuscrit");
  const scene = new TFile("Coll/Manuscrit/Scene.md", "Nouveau texte.");
  manuscript.children = [scene];
  scene.parent = manuscript;
  const sortie = new TFolder("Coll/Manuscrit/_Feuillets/Sortie");
  const existingOutput = new TFile("Coll/Manuscrit/_Feuillets/Sortie/Manuscrit.md", "Ancien contenu.");
  sortie.children = [existingOutput];
  existingOutput.parent = sortie;

  const feuillets = new TFolder("Coll/Manuscrit/_Feuillets");
  feuillets.children = [sortie];
  sortie.parent = feuillets;
  feuillets.parent = manuscript;
  manuscript.children.push(feuillets);

  const { vault } = createFakeVault([manuscript, scene, feuillets, sortie, existingOutput]);
  vault.cachedRead = vault.read;
  makeCaseInsensitiveVault(vault);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = baseSettings({
    projectFolder: manuscript.path,
    compileFileName: "manuscrit.md",
  });

  const result = await compile(app, settings);
  assert.ok(result, "compile() doit réussir malgré la collision de casse");
  // Le fichier réellement modifié conserve sa casse d'origine.
  assert.equal(result.outPath, "Coll/Manuscrit/_Feuillets/Sortie/Manuscrit.md");
  assert.match(existingOutput.content, /Nouveau texte/, "le fichier existant (Manuscrit.md) doit être modifié");
  // Aucun second fichier "manuscrit.md" n'a été créé à côté.
  assert.equal(sortie.children.length, 1, "un seul fichier de sortie doit exister dans _Sortie");
  assert.equal(vault.getAbstractFileByPath("Coll/Manuscrit/_Feuillets/Sortie/manuscrit.md"), null);
});

test("C. collision EPUB : Manuscrit.epub existant + sortie demandée manuscrit.epub -> modifyBinary(), pas de createBinary() concurrent", async () => {
  const manuscript = new TFolder("EpubColl/Manuscrit");
  const scene = new TFile("EpubColl/Manuscrit/Scene.md", "---\ntitle: Scene\n---\nTexte.");
  manuscript.children = [scene];
  scene.parent = manuscript;
  const sortie = new TFolder("EpubColl/Manuscrit/_Feuillets/Sortie");
  const existingEpub = new TFile("EpubColl/Manuscrit/_Feuillets/Sortie/Manuscrit.epub", "ancien-binaire");
  sortie.children = [existingEpub];
  existingEpub.parent = sortie;
  const feuillets = new TFolder("EpubColl/Manuscrit/_Feuillets", [sortie]);
  sortie.parent = feuillets;
  feuillets.parent = manuscript;
  manuscript.children.push(feuillets);

  const { vault } = createFakeVault([manuscript, scene, feuillets, sortie, existingEpub]);
  vault.cachedRead = vault.read;
  // readBinary retourne le contenu texte simulé — writeBinaryFile n'appelle
  // pas readBinary ici, seul modifyBinary/createBinary comptent.
  vault.modifyBinary = async (file, buf) => { file.content = buf; file.__modifiedBinary = true; };
  vault.createBinary = async (_path, _buf) => {
    throw new Error("createBinary ne doit jamais être appelé ici : le nom cible collisionne avec Manuscrit.epub.");
  };
  makeCaseInsensitiveVault(vault);
  // Ré-enrober createBinary après makeCaseInsensitiveVault : on veut que
  // TOUTE tentative de create (même après détection de collision) échoue
  // fort, pour prouver qu'aucun createBinary() n'est jamais tenté.
  vault.createBinary = async () => {
    throw new Error("createBinary ne doit jamais être appelé ici : le nom cible collisionne avec Manuscrit.epub.");
  };

  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: { title: "Scene", compile: true } }) } };
  const settings = baseSettings({
    projectFolder: manuscript.path,
    compileFileName: "manuscrit.md",
  });

  const { installMinimalDomForTest } = await loadDomHelper();
  const restoreDom = installMinimalDomForTest();
  try {
    const scope = createProjectScope(manuscript.path);
    const outPath = await exportWithScope(app, settings, scope, "epub", "manuscrit");
    assert.ok(outPath, "l'export epub doit réussir malgré la collision de casse");
    assert.equal(outPath, "EpubColl/Manuscrit/_Feuillets/Sortie/Manuscrit.epub");
    assert.ok(existingEpub.__modifiedBinary, "modifyBinary() doit avoir été appelé sur le fichier existant");
  } finally {
    restoreDom();
  }
});

test("D. cohérence des extensions : un basename \"Mon Roman\" produit le même nom pour .md/.docx/.epub/.odt", async () => {
  const manuscript = new TFolder("Ext/Manuscrit");
  const scene = new TFile("Ext/Manuscrit/Scene.md", "---\ntitle: Scene\n---\nTexte.");
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { installMinimalDomForTest } = await loadDomHelper();
  const restoreDom = installMinimalDomForTest();
  try {
    for (const [format, ext] of [["md", "md"], ["docx", "docx"], ["epub", "epub"], ["odt", "odt"]]) {
      const { vault } = createFakeVault([manuscript, scene]);
      vault.cachedRead = vault.read;
      const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: { title: "Scene", compile: true } }) } };
      const settings = baseSettings({ projectFolder: manuscript.path, compileFileName: "manuscrit.md" });
      const scope = createProjectScope(manuscript.path);
      const outPath = await exportWithScope(app, settings, scope, format, "Mon Roman");
      assert.equal(outPath, `Ext/Manuscrit/_Feuillets/Sortie/Mon Roman.${ext}`);
    }
  } finally {
    restoreDom();
  }
});

test("E1. erreur d'écriture du manuscrit compilé : Notice explicite, jamais une exception non gérée hors de compile()", async () => {
  const manuscript = new TFolder("Err/Manuscrit");
  const scene = new TFile("Err/Manuscrit/Scene.md", "Texte.");
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { vault } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  // Provoque une vraie erreur pendant l'écriture du manuscrit compilé —
  // ni "already exists" (donc jamais absorbée par writeResolvingCaseCollision)
  // ni gérée ailleurs : le nouveau try/catch autour de l'écriture, dans
  // compile() lui-même, doit l'attraper.
  vault.create = async () => {
    throw new Error("Disque plein (erreur simulée, sans rapport avec une collision).");
  };

  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = baseSettings({ projectFolder: manuscript.path, compileFileName: "manuscrit.md" });

  await withNoticeCapture(async (notices) => {
    const result = await compile(app, settings);
    assert.equal(result, null, "compile() doit renvoyer null plutôt que de lever");
    assert.ok(
      notices.some((m) => /Disque plein/.test(m)),
      `un Notice doit décrire l'erreur réelle, reçu: ${JSON.stringify(notices)}`
    );
  });
});

test("E2. erreur survenant AVANT l'écriture (résolution du dossier de sortie) : le workflow d'export l'absorbe sans Promise rejetée non gérée", async () => {
  const manuscript = new TFolder("Err2/Manuscrit");
  const scene = new TFile("Err2/Manuscrit/Scene.md", "Texte.");
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { vault } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  // Aucun dossier _Feuillets/Sortie n'existe encore : getOutputFolder()
  // (appelé par compile(), HORS de tout try/catch interne à compile())
  // doit le créer via ensureFolder() -> vault.createFolder() — on fait
  // échouer CET appel précis pour prouver que le try/catch entourant
  // compile() dans exportViaNative() (ajouté par ce correctif) protège
  // aussi les erreurs qui précèdent l'écriture elle-même.
  vault.createFolder = async () => {
    throw new Error("Permission refusée (erreur simulée).");
  };

  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = baseSettings({ projectFolder: manuscript.path, compileFileName: "manuscrit.md" });

  await withNoticeCapture(async (notices) => {
    // exportFile() route vers exportViaNative() : ne doit jamais lever, doit
    // simplement échouer proprement (undefined) avec un Notice explicite —
    // jamais un "Uncaught (in promise)" dans la console.
    const outPath = await exportFile(app, settings, "docx");
    assert.equal(outPath, undefined);
    assert.ok(
      notices.some((m) => /Permission refusée/.test(m)),
      `un Notice doit décrire l'erreur réelle, reçu: ${JSON.stringify(notices)}`
    );
  });
});

/* Stub DOM minimal MAIS RÉALISTE, identique à celui de
   test/compile-export.test.js (installMinimalDom/makeEl) — les moteurs
   export-docx/export-epub (via export-render.ts#renderManuscriptHtml)
   utilisent réellement querySelectorAll(), childNodes, classList… qu'un
   stub trop simplifié ne fournit pas. Dupliqué ici plutôt qu'importé : ce
   fichier de test n'exporte pas ces helpers. */
function makeEl(tag, textContent = "") {
  const el = {
    tagName: tag.toUpperCase(),
    _text: textContent,
    _attrs: new Map(),
    parentElement: null,
    children: [],
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; },
    set textContent(v) { this.children = []; this._text = v; },
    get childNodes() {
      if (this.children.length) return this.children;
      if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
      return [];
    },
    get nodeType() { return 1; },
    get attributes() { return Array.from(this._attrs, ([name, value]) => ({ name, value })); },
    get className() { return this._attrs.get("class") || ""; },
    get classList() {
      const self = this;
      return { contains: (name) => (self._attrs.get("class") || "").split(/\s+/).includes(name) };
    },
    get innerHTML() { return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text; },
    get outerHTML() {
      const attrs = Array.from(this._attrs, ([k, v]) => ` ${k}="${v}"`).join("");
      return `<${tag.toLowerCase()}${attrs}>${this.innerHTML}</${tag.toLowerCase()}>`;
    },
    setAttribute(name, value) { this._attrs.set(name, String(value)); },
    getAttribute(name) { return this._attrs.get(name) ?? null; },
    appendChild(child) { if (child.remove) child.remove(); child.parentElement = this; this.children.push(child); return child; },
    prepend(child) { if (child.remove) child.remove(); child.parentElement = this; this.children.unshift(child); },
    after(sibling) {
      if (!this.parentElement) return;
      const i = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(i + 1, 0, sibling);
      sibling.parentElement = this.parentElement;
    },
    remove() {
      if (!this.parentElement) return;
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    },
    cloneNode(deep) {
      const c = makeEl(tag, this._text);
      for (const [k, v] of this._attrs) c.setAttribute(k, v);
      if (deep) for (const child of this.children) c.appendChild(child.cloneNode(true));
      return c;
    },
    querySelectorAll(sel) {
      const found = [];
      const visit = (node) => {
        if (node === el) { for (const child of node.children || []) visit(child); return; }
        const t = node.tagName?.toLowerCase() || "";
        const cls = node.getAttribute?.("class") || "";
        if (sel.startsWith(".") && cls.split(/\s+/).includes(sel.slice(1))) found.push(node);
        else if (t === sel.toLowerCase()) found.push(node);
        for (const child of node.children || []) visit(child);
      };
      visit(el);
      return found;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
  };
  return el;
}

async function loadDomHelper() {
  return {
    installMinimalDomForTest() {
      const prev = {
        document: globalThis.document,
        Node: globalThis.Node,
        XMLSerializer: globalThis.XMLSerializer,
        createEl: globalThis.createEl,
        createDiv: globalThis.createDiv,
      };
      globalThis.document = {
        createElement: (tag) => makeEl(tag),
        createTextNode: (t) => ({ nodeType: 3, nodeValue: t, textContent: t, get outerHTML() { return t; }, cloneNode() { return this; }, remove() {} }),
        createElementNS: (_ns, tag) => makeEl(tag),
      };
      globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
      globalThis.XMLSerializer = class { serializeToString(n) { return n?.outerHTML ?? String(n?.textContent ?? ""); } };
      globalThis.createEl = (tag, options = {}) => makeEl(tag, options.text || "");
      globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
      return () => Object.assign(globalThis, prev);
    },
  };
}
