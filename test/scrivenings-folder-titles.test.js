import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { loadScriveningsDocument } from "../src/services/scrivenings-document.js";
import { buildScriveningsRangeClipboardText, buildScopeClipboardText } from "../src/services/scrivenings-clipboard-source.js";
import { resolveCompileScopeFiles } from "../src/services/compile-scope.js";

/* Copie structurée : les dossiers éditoriaux (parties, chapitres) sont
   restitués avec les règles de compile-export.ts (roleOfFolder,
   isFrontMatter, depthOf) — jamais une seconde règle, jamais dans state.doc. */

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
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    fm[k.trim()] = rest.join(":").trim();
  }
  return fm;
}

function buildFixture({ subOrder = ["Ar-Rahim.md", "Al-Rahman.md"] } = {}) {
  const page = makeFile("Roman/Manuscrit/Front/Page de titre.md", "---\ntype: titre\n---\n\nNEFES\n");
  const incipit = makeFile("Roman/Manuscrit/Front/Incipit.md", "Il était une fois.\n");
  const rahman = makeFile("Roman/Manuscrit/SUBHANALLAH/Al-Rahman.md", "Écoute.\n");
  const rahim = makeFile("Roman/Manuscrit/SUBHANALLAH/Ar-Rahim.md", "---\nstatus: Draft\n---\n\nCompassion.\n");
  const s1 = makeFile("Roman/Manuscrit/RAHMAN/Chapitre A/Scène 1.md", "Scène un.\n");
  const s2 = makeFile("Roman/Manuscrit/RAHMAN/Chapitre A/Scène 2.md", "Scène deux.\n");
  const malik = makeFile("Roman/Manuscrit/RAHMAN/Al-Malik.md", "# Al-Malik\n\nRoi.\n");
  const front = makeFolder("Roman/Manuscrit/Front", [page, incipit]);
  const sub = makeFolder("Roman/Manuscrit/SUBHANALLAH", [rahman, rahim]);
  const chapA = makeFolder("Roman/Manuscrit/RAHMAN/Chapitre A", [s1, s2]);
  const rahmanPart = makeFolder("Roman/Manuscrit/RAHMAN", [chapA, malik]);
  const root = makeFolder("Roman/Manuscrit", [front, sub, rahmanPart]);
  const all = new Map();
  const register = (n) => { all.set(n.path, n); (n.children || []).forEach(register); };
  register(root);
  const writes = [];
  const app = {
    workspace: { getLeaf: () => { throw new Error("workspace"); }, getLeavesOfType: () => { throw new Error("workspace"); } },
    vault: {
      getAbstractFileByPath: (p) => all.get(p) || null,
      read: async (f) => f.content,
      modify: async (f) => { writes.push(f.path); },
      process: async (f) => { writes.push(f.path); },
      create: async (p) => { writes.push(p); },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatterOf(f.content || "") }) },
    fileManager: { processFrontMatter: async () => { writes.push("fm"); }, trashFile: async () => {} },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    compileFileName: "Manuscrit.md",
    orders: {
      [root.path]: ["Front", "SUBHANALLAH", "RAHMAN"],
      [sub.path]: subOrder,
      [rahmanPart.path]: ["Chapitre A", "Al-Malik.md"],
      [chapA.path]: ["Scène 1.md", "Scène 2.md"],
    },
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };
  const plugin = {
    app, settings,
    getProjectFolder: () => root,
    editorialRootFor: FeuilletsPlugin.prototype.editorialRootFor,
    compileScopeForFolder: FeuilletsPlugin.prototype.compileScopeForFolder,
    isValidEditorialRootPath: (p) => p === root.path,
    isSceneFile: (f) => f instanceof TFile,
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
  return { view: new TestView(), app, settings, root, front, sub, rahmanPart, chapA, writes, rahman, rahim, s1, malik, incipit };
}

const scopeOf = (fx, folder) => fx.view.plugin.compileScopeForFolder(folder);
const copy = (fx, folder) => buildScopeClipboardText(fx.app, fx.settings, scopeOf(fx, folder));

async function scopeDoc(fx, scope) {
  const files = resolveCompileScopeFiles(fx.app, fx.settings, scope);
  return loadScriveningsDocument(fx.app, files);
}

test("whole manuscript: parts/chapters titled once, Front folder and root never, levels from depth/role", async () => {
  const fx = buildFixture();
  const text = await copy(fx, fx.root);
  const headings = text.split("\n").filter((l) => /^#{1,6} /.test(l));
  assert.deepEqual(headings, [
    "## Incipit",
    "# SUBHANALLAH", "## Ar-Rahim", "## Al-Rahman",
    "# RAHMAN", "## Chapitre A", "#### Scène 1", "#### Scène 2",
    "# Al-Malik",
  ]);
  assert.doesNotMatch(text, /^#+ (Front|FRONT|Manuscrit)$/im);
  assert.equal(text.match(/^# SUBHANALLAH$/gm).length, 1);
  assert.doesNotMatch(text, /\n\n\n/, "no piled-up blank lines");
  assert.doesNotMatch(text, /status: Draft|type: titre|^---$/m);
  assert.match(text, /^NEFES\n/m, "front page keeps its body without a generated title");
});

test("exact hierarchy order and spacing", async () => {
  const fx = buildFixture();
  const text = await copy(fx, fx.sub);
  assert.equal(text, "# SUBHANALLAH\n\n## Ar-Rahim\n\nCompassion.\n\n## Al-Rahman\n\nÉcoute.\n");
});

test("custom Binder order drives both files and structure", async () => {
  const fx = buildFixture({ subOrder: ["Al-Rahman.md", "Ar-Rahim.md"] });
  const text = await copy(fx, fx.sub);
  assert.ok(text.indexOf("## Al-Rahman") < text.indexOf("## Ar-Rahim"));
  fx.settings.orders[fx.root.path] = ["Front", "RAHMAN", "SUBHANALLAH"];
  const whole = await copy(fx, fx.root);
  assert.ok(whole.indexOf("# RAHMAN") < whole.indexOf("# SUBHANALLAH"));
});

test("right click on a part: its own title is present; on a chapter folder too, without ancestors", async () => {
  const fx = buildFixture();
  assert.match(await copy(fx, fx.rahmanPart), /^# RAHMAN\n\n## Chapitre A\n\n#### Scène 1/);
  const chapter = await copy(fx, fx.chapA);
  assert.match(chapter, /^## Chapitre A\n\n#### Scène 1/);
  assert.doesNotMatch(chapter, /# RAHMAN/);
});

test("Front folder alone: no folder title", async () => {
  const fx = buildFixture();
  assert.doesNotMatch(await copy(fx, fx.front), /^#+ (Front|FRONT)$/im);
});

test("Binder « Copier le contenu » = Continu select-all for the same scope, no writes", async () => {
  const fx = buildFixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const written = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (x) => { written.push(x); } } }, configurable: true, writable: true });
  try {
    for (const folder of [fx.root, fx.sub, fx.rahmanPart]) {
      fx.view.showFolderContextMenu({ preventDefault() {} }, folder, fx.root, 0, []);
      await Menu.lastShown.items.find((i) => i.title === t("binder.copyFolderContents")).callback();
      const scope = scopeOf(fx, folder);
      const doc = await scopeDoc(fx, scope);
      assert.equal(written.at(-1), buildScriveningsRangeClipboardText(fx.app, fx.settings, scope, doc, 0, doc.text.length));
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
  assert.equal(written.length, 3);
  assert.deepEqual(fx.writes, []);
});

test("partial copy starting mid-file adds no ancestor before the start, but titles the next part", async () => {
  const fx = buildFixture();
  const scope = scopeOf(fx, fx.root);
  const doc = await scopeDoc(fx, scope);
  const rahim = doc.segments.find((s) => s.path === fx.rahman.path);
  const scene1 = doc.segments.find((s) => s.path === fx.s1.path);
  const text = buildScriveningsRangeClipboardText(fx.app, fx.settings, scope, doc, rahim.from + 2, scene1.from + 5);
  assert.equal(text, "oute.\n\n# RAHMAN\n\n## Chapitre A\n\n#### Scène 1\n\nScène");
  assert.doesNotMatch(text, /# SUBHANALLAH/);
});

test("partial copy inside one part crossing two files adds only the next file title", async () => {
  const fx = buildFixture();
  const scope = scopeOf(fx, fx.root);
  const doc = await scopeDoc(fx, scope);
  const first = doc.segments.find((s) => s.path === fx.rahim.path);
  const second = doc.segments.find((s) => s.path === fx.rahman.path);
  const text = buildScriveningsRangeClipboardText(fx.app, fx.settings, scope, doc, first.from + 3, second.from + 4);
  assert.equal(text, "mpassion.\n\n## Al-Rahman\n\nÉcou");
});

test("copy never changes the composite document", async () => {
  const fx = buildFixture();
  const scope = scopeOf(fx, fx.root);
  const doc = await scopeDoc(fx, scope);
  const before = JSON.stringify([doc.text, doc.segments.map((s) => [s.from, s.to, s.body])]);
  buildScriveningsRangeClipboardText(fx.app, fx.settings, scope, doc, 0, doc.text.length);
  assert.equal(JSON.stringify([doc.text, doc.segments.map((s) => [s.from, s.to, s.body])]), before);
});
