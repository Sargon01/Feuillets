import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { loadScriveningsDocument } from "../src/services/scrivenings-document.js";
import { buildScriveningsRangeClipboardText, buildScopeClipboardText } from "../src/services/scrivenings-clipboard-source.js";
import { createProjectScope, createSelectionScope, resolveCompileScopeFiles } from "../src/services/compile-scope.js";

/* Binder « Copier le contenu » : le vrai menu de dossier est exécuté, le
   texte doit être IDENTIQUE à celui d'un Continu ouvert sur le même dossier
   après Cmd+A / Cmd+C (mêmes primitives, jamais une seconde règle). */

function makeFile(path, content) {
  const file = new TFile(path, content);
  file.path = path;
  file.name = path.split("/").pop();
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function makeFolder(path, children = []) {
  const folder = new TFolder(path);
  folder.path = path;
  folder.name = path.split("/").pop();
  folder.children = children;
  for (const c of children) c.parent = folder;
  return folder;
}

function frontmatterOf(content) {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    fm[k.trim()] = rest.join(":").trim();
  }
  return fm;
}

function buildFixture({ orders = {}, rootPath = "Roman/Manuscrit" } = {}) {
  const c3 = makeFile(`${rootPath}/Partie I/Chapitre 3.md`, "Troisième.\n");
  const c1 = makeFile(`${rootPath}/Partie I/Chapitre 1.md`, "---\ntitle: Chapitre I\nstatus: Draft\n---\n\nLe jour se leva.\n");
  const c2 = makeFile(`${rootPath}/Partie I/Chapitre 2.md`, "# Chapitre 2\n\nDéjà titré.\n");
  const sub1 = makeFile(`${rootPath}/Partie II/Chapitre 4.md`, "Quatrième.\n");
  const partI = makeFolder(`${rootPath}/Partie I`, [c3, c1, c2]);
  const partII = makeFolder(`${rootPath}/Partie II`, [sub1]);
  const empty = makeFolder(`${rootPath}/Vide`, []);
  const root = makeFolder(`${rootPath}`, [partI, partII, empty]);
  const all = new Map();
  const register = (n) => { all.set(n.path, n); (n.children || []).forEach(register); };
  register(root);
  const writes = [];
  const app = {
    workspace: { getLeaf: () => { throw new Error("workspace must not be touched"); }, getLeavesOfType: () => { throw new Error("workspace must not be touched"); } },
    vault: {
      getAbstractFileByPath: (p) => all.get(p) || null,
      read: async (f) => f.content,
      cachedRead: async (f) => f.content,
      modify: async (f) => { writes.push(f.path); },
      process: async (f) => { writes.push(f.path); },
      create: async (p) => { writes.push(p); },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatterOf(f.content || "") }) },
    fileManager: { processFrontMatter: async () => { writes.push("fm"); }, trashFile: async () => {} },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    orders: { [partI.path]: orders.partI || ["Chapitre 1.md", "Chapitre 2.md", "Chapitre 3.md"], [root.path]: ["Partie I", "Partie II"] },
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };
  const plugin = {
    app,
    settings,
    getProjectFolder: () => root,
    editorialRootFor: FeuilletsPlugin.prototype.editorialRootFor,
    compileScopeForFile: FeuilletsPlugin.prototype.compileScopeForFile,
    compileScopeForSelection: FeuilletsPlugin.prototype.compileScopeForSelection,
    compileScopeForFolder: FeuilletsPlugin.prototype.compileScopeForFolder,
    isValidEditorialRootPath: (p) => p === root.path,
    isSceneFile: (f) => f instanceof TFile,
    flattenFiles: () => [c1, c2, c3, sub1],
    saveSettings: async () => {},
    fmOf: (f) => frontmatterOf(f.content || ""),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    renderAllViews: () => {},
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  class TestView extends FeuilletsView {
    constructor() { super({ app, contentEl: null }); this.app = app; this.plugin = plugin; }
    async render() {}
  }
  return { view: new TestView(), app, settings, root, partI, partII, empty, c1, c2, c3, all, writes };
}

function withClipboard(writeText) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => { calls.push(text); return writeText(text); } } },
    configurable: true,
    writable: true,
  });
  return {
    calls,
    restore: () => {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete globalThis.navigator;
    },
  };
}

function copyItemFor(fx, folder) {
  fx.view.showFolderContextMenu({ preventDefault() {} }, folder, fx.root, 0, []);
  const item = Menu.lastShown.items.find((i) => i.title === t("binder.copyContents"));
  assert.ok(item, "« Copier le contenu » must be in the folder menu");
  return item;
}

async function continuSelectAll(fx, folder) {
  const scope = fx.view.plugin.compileScopeForFolder(folder);
  const files = resolveCompileScopeFiles(fx.app, fx.settings, scope);
  const doc = await loadScriveningsDocument(fx.app, files);
  return buildScriveningsRangeClipboardText(fx.app, fx.settings, scope, doc, 0, doc.text.length);
}

test("folder copy = Continu Cmd+A/Cmd+C, in Binder order, with titles, no frontmatter", async () => {
  const fx = buildFixture();
  const clip = withClipboard(async () => {});
  try {
    await copyItemFor(fx, fx.partI).callback();
  } finally {
    clip.restore();
  }
  assert.equal(clip.calls.length, 1);
  const text = clip.calls[0];
  assert.equal(text, await continuSelectAll(fx, fx.partI));
  assert.ok(text.indexOf("Le jour se leva.") < text.indexOf("Déjà titré.") && text.indexOf("Déjà titré.") < text.indexOf("Troisième."));
  assert.match(text, /^#{1,6} Chapitre I$/m);
  assert.doesNotMatch(text, /status: Draft|^---$/m);
  assert.equal(text.match(/^#{1,6} Chapitre 2$/gm)?.length, 1, "existing Markdown title is not duplicated");
});

test("Binder order wins over folder.children order", async () => {
  const fx = buildFixture({ orders: { partI: ["Chapitre 3.md", "Chapitre 1.md", "Chapitre 2.md"] } });
  const text = await buildScopeClipboardText(fx.app, fx.settings, fx.view.plugin.compileScopeForFolder(fx.partI));
  assert.ok(text.indexOf("Troisième.") < text.indexOf("Le jour se leva."));
});

test("sub-folders are traversed recursively; structural folders are titled (see scrivenings-folder-titles.test.js)", async () => {
  const fx = buildFixture();
  const text = await buildScopeClipboardText(fx.app, fx.settings, fx.view.plugin.compileScopeForFolder(fx.root));
  assert.ok(text.indexOf("Troisième.") < text.indexOf("Quatrième."));
  assert.equal(text.match(/^# Partie I$/gm)?.length, 1);
  assert.equal(text.match(/^# Partie II$/gm)?.length, 1);
  assert.ok(text.indexOf("# Partie I\n") < text.indexOf("Troisième.") && text.indexOf("Troisième.") < text.indexOf("# Partie II"));
  assert.doesNotMatch(text, /^#+ Manuscrit$/m);
  assert.equal(text, await continuSelectAll(fx, fx.root));
});

test("empty folder: nothing written to the clipboard, no error", async () => {
  const fx = buildFixture();
  const item = copyItemFor(fx, fx.empty);
  const clip = withClipboard(async () => {});
  try {
    await item.callback();
  } finally {
    clip.restore();
  }
  assert.equal(clip.calls.length, 0);
});

test("clipboard failure is a clean no-op and mutates nothing", async () => {
  const fx = buildFixture();
  const before = JSON.stringify([fx.c1.content, fx.c2.content, fx.c3.content]);
  const clip = withClipboard(async () => { throw new Error("denied"); });
  try {
    await copyItemFor(fx, fx.partI).callback();
  } finally {
    clip.restore();
  }
  assert.equal(JSON.stringify([fx.c1.content, fx.c2.content, fx.c3.content]), before);
  assert.deepEqual(fx.writes, []);
});

test("copy never writes to the vault, compiles, or touches the workspace", async () => {
  const fx = buildFixture();
  const clip = withClipboard(async () => {});
  try {
    await copyItemFor(fx, fx.root).callback(); // would throw if the workspace were used
  } finally {
    clip.restore();
  }
  assert.deepEqual(fx.writes, []);
});

function selectedCopyItem(fx, node) {
  const event = { preventDefault() {} };
  const scopeEl = { querySelectorAll: () => [] };
  fx.view.ensureSelectionForContextMenu(node.path, scopeEl);
  if (node instanceof TFolder) fx.view.showFolderContextMenu(event, node, fx.root, 0, []);
  else fx.view.showFileContextMenu(event, node, node.parent, 0, []);
  return Menu.lastShown.items.find((item) => item.title === t("binder.copyContents"));
}

for (const [label, keys, expected] of [
  ["contiguous", ["c1", "c2"], ["Le jour se leva.", "Déjà titré."]],
  ["noncontiguous", ["c1", "c3"], ["Le jour se leva.", "Troisième."]],
  ["reverse click order", ["c3", "c1"], ["Le jour se leva.", "Troisième."]],
  ["folder and another sheet", ["partII", "c1"], ["Le jour se leva.", "Quatrième."]],
  ["folder and descendant", ["partI", "c2"], ["Le jour se leva.", "Déjà titré.", "Troisième."]],
]) {
  test(`multi-selection copy: ${label}, Binder order, exact membership, no duplicate`, async () => {
    const fx = buildFixture();
    const paths = keys.map((key) => fx[key].path);
    const selection = new Set(paths);
    fx.view.plugin._binderMultiSelect = selection;
    const clip = withClipboard(async () => {});
    try { await selectedCopyItem(fx, fx[keys[0]]).callback(); } finally { clip.restore(); }
    assert.equal(fx.view.plugin._binderMultiSelect, selection);
    assert.deepEqual([...selection], paths);
    const text = clip.calls[0];
    const bodies = ["Le jour se leva.", "Déjà titré.", "Troisième.", "Quatrième."];
    for (const body of bodies) assert.equal(text.split(body).length - 1, expected.includes(body) ? 1 : 0);
    for (let i = 1; i < expected.length; i++) assert.ok(text.indexOf(expected[i - 1]) < text.indexOf(expected[i]));
    assert.equal(text, await buildScopeClipboardText(fx.app, fx.settings, createSelectionScope(fx.root.path, paths)));
    assert.deepEqual(fx.writes, []);
  });
}

test("Shift-click range and right-click preserve and copy every sheet in the range", async () => {
  const fx = buildFixture();
  const scopeEl = { querySelectorAll: () => [] };
  const siblings = [fx.c1, fx.c2, fx.c3];
  fx.view.handleMultiSelectClick({ preventDefault() {} }, fx.c1, fx.partI, 0, siblings, scopeEl);
  fx.view.handleMultiSelectClick({ shiftKey: true, preventDefault() {} }, fx.c3, fx.partI, 2, siblings, scopeEl);
  const clip = withClipboard(async () => {});
  try { await selectedCopyItem(fx, fx.c2).callback(); } finally { clip.restore(); }
  assert.deepEqual([...fx.view.plugin._binderMultiSelect], siblings.map((file) => file.path));
  for (const body of ["Le jour se leva.", "Déjà titré.", "Troisième."]) assert.ok(clip.calls[0].includes(body));
});

test("right-click outside a selection retains the Binder's single-target behavior", async () => {
  const fx = buildFixture();
  fx.view.plugin._binderMultiSelect = new Set([fx.c1.path, fx.c2.path]);
  const clip = withClipboard(async () => {});
  try { await selectedCopyItem(fx, fx.c3).callback(); } finally { clip.restore(); }
  assert.deepEqual([...fx.view.plugin._binderMultiSelect], [fx.c3.path]);
  assert.match(clip.calls[0], /Troisième/);
  assert.doesNotMatch(clip.calls[0], /Le jour se leva|Déjà titré/);
});

for (const rootPath of ["Roman/Manuscrit", "Existing folder"]) {
  test(`project root copy: ${rootPath}, titles and technical folder exclusions`, async () => {
    const fx = buildFixture({ rootPath });
    for (const name of ["_Feuillets", "_Recherche", "_Sortie", "_Snapshots"]) {
      const file = makeFile(`${rootPath}/${name}/Hidden.md`, "TECHNICAL CONTENT");
      const folder = makeFolder(`${rootPath}/${name}`, [file]);
      folder.parent = fx.root;
      fx.root.children.push(folder);
      fx.all.set(folder.path, folder);
      fx.all.set(file.path, file);
    }
    fx.view.showProjectRootContextMenu({}, fx.root);
    const item = Menu.lastShown.items.find((item) => item.title === t("binder.copyContents"));
    const clip = withClipboard(async () => {});
    try { await item.callback(); } finally { clip.restore(); }
    assert.equal(clip.calls[0], await buildScopeClipboardText(fx.app, fx.settings, createProjectScope(fx.root.path)));
    assert.doesNotMatch(clip.calls[0], /TECHNICAL CONTENT/);
    assert.ok(clip.calls[0].indexOf("Le jour se leva.") < clip.calls[0].indexOf("Quatrième."));
    assert.deepEqual(fx.writes, []);
  });
}

test("empty project preserves clipboard", async () => {
  const fx = buildFixture();
  fx.root.children = [];
  fx.view.showProjectRootContextMenu({}, fx.root);
  const clip = withClipboard(async () => {});
  try { await Menu.lastShown.items.find((item) => item.title === t("binder.copyContents")).callback(); }
  finally { clip.restore(); }
  assert.deepEqual(clip.calls, []);
});

test("a read failure after the first selected sheet never copies partial content", async () => {
  const fx = buildFixture();
  fx.view.plugin._binderMultiSelect = new Set([fx.c1.path, fx.c2.path]);
  fx.app.vault.read = async (file) => {
    if (file === fx.c2) throw new Error("unreadable");
    return file.content;
  };
  const clip = withClipboard(async () => {});
  try { await selectedCopyItem(fx, fx.c1).callback(); } finally { clip.restore(); }
  assert.deepEqual(clip.calls, []);
});
