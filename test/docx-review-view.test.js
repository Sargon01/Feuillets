import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, Platform, TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { DocxReviewView } = await import(modulePath("src/views/docx-review-view.js"));
const { bookmarkIdFor } = await import(modulePath("src/utils/docx-bookmarks.js"));
const { default: JSZip } = await import("jszip");

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
}

function allElements(element) { return [element, ...element.children.flatMap(allElements)]; }
function file(path, content = "") { return new TFile(path, content); }

function createView({ files = [], settings = {}, content = {}, root = new TFolder("Projet") } = {}) {
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath(path) { return byPath.get(path) ?? null; },
      getMarkdownFiles() { return files.filter((entry) => entry.extension === "md"); },
      async read(entry) { return content[entry.path] ?? entry.content; },
      async modify(...args) { writes.push(args); },
    },
  };
  const plugin = {
    settings: { collapsed: {}, ...settings },
    getProjectFolder: () => root,
    snapshotFile: async () => {},
    listCompiledFilePaths: () => files.filter((entry) => entry.extension === "md").map((entry) => entry.path),
    titleFor: (entry) => entry.basename,
    getOutputFolder: async () => null,
    async saveSettings() { plugin.saveCount += 1; },
    saveCount: 0,
  };
  const contentEl = new FakeElement();
  const view = new DocxReviewView({ app, contentEl }, plugin);
  return { view, app, plugin, contentEl, writes };
}

function iconsFrom(container) { return allElements(container).map((element) => element.icon).filter(Boolean); }

function mockZip(files) {
  const calls = [];
  const original = JSZip.loadAsync;
  JSZip.loadAsync = async () => ({
    file(path) {
      calls.push(path);
      return Object.hasOwn(files, path) ? { async: async () => files[path] } : null;
    },
  });
  return { calls, restore: () => { JSZip.loadAsync = original; } };
}

const documentXml = (body) => `<w:document><w:body>${body}</w:body></w:document>`;

test("DocxReviewView — icônes, clés et résolution des feuillets", async () => {
  const direct = file("Projet/Direct.md");
  const named = file("Projet/Dossier/Chapitre.md");
  const { view } = createView({ files: [direct, named] });

  const iconContainer = new FakeElement();
  for (const type of ["move", "insertion", "deletion", "replacement"]) {
    view.renderChange(iconContainer, null, { type, text: "texte", author: "A", date: "D" });
  }
  view.renderComment(iconContainer, null, { anchorText: "ancre", text: "commentaire", author: "A", isFormatting: false });
  view.renderComment(iconContainer, null, { anchorText: "ancre", text: "", author: "A", isFormatting: true, markers: [] });
  const contentIcons = iconsFrom(iconContainer).filter((icon) => icon !== "x");
  assert.deepEqual(contentIcons.sort(), ["highlighter", "message-square", "minus", "move", "plus", "repeat"].sort());

  view.docxName = "retours.docx";
  const first = { type: "comment", author: "A", date: "D", anchorText: "texte", ord: 1, applied: true, dismissed: false };
  await view.saveItemState(first);
  await view.saveItemState({ ...first });
  await view.saveItemState({ ...first, ord: 2 });
  assert.equal(Object.keys(view.plugin.settings.docxReviewResolved["retours.docx"]).length, 2);
  assert.equal(view.plugin.saveCount, 3);

  for (const candidate of ["Projet/Direct.md", "Projet/Dossier/Chapitre.md", "Chapitre.md", "Chapitre", "Dossier/Chapitre.md"]) {
    const row = new FakeElement();
    view.renderNearFilesHints(new FakeElement(), { nearFiles: [candidate], applied: true }, row);
    assert.equal(row.classes.has("feuillets-clickable"), true, candidate);
  }
  const missing = new FakeElement();
  view.renderNearFilesHints(new FakeElement(), { nearFiles: ["inconnu.md"], applied: true }, missing);
  assert.equal(missing.classes.has("feuillets-clickable"), false);
});

test("DocxReviewView — état, rendu et sauvegarde locale", async () => {
  const { view, contentEl, plugin } = createView();
  assert.equal(view.mode, "picker");
  assert.equal(view.results, null);
  assert.equal(view.showResolved, false);
  assert.equal(view.docxName, "");

  let picker = 0;
  let results = 0;
  view.renderSectionHead = () => false;
  view.renderPickerPanel = async () => { picker += 1; };
  view.renderResultsPanel = async () => { results += 1; };
  await view.render();
  assert.equal(picker, 1);
  view.mode = "results";
  view.results = { byPath: {}, unmatched: {}, unclassified: { changes: [], comments: [] } };
  await view.render();
  assert.equal(results, 1);
  view.renderSectionHead = () => true;
  await view.render();
  assert.equal(results, 1);
  assert.equal(contentEl.classes.has("feuillets-docx-review-container"), true);

  await view.saveItemState({ type: "insertion", text: "x" });
  assert.equal(plugin.saveCount, 0);
  view.docxName = "memo.docx";
  await view.saveItemState({ type: "insertion", text: "x", applied: true, dismissed: true });
  assert.deepEqual(Object.values(plugin.settings.docxReviewResolved["memo.docx"])[0], { applied: true, dismissed: true });
});

test("DocxReviewView — snapshot unique et non bloquant", async () => {
  const scene = file("Projet/Scene.md");
  const { view, plugin } = createView({ files: [scene] });
  let snapshots = 0;
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  plugin.snapshotFile = async () => { snapshots += 1; };
  await view.ensureSnapshot({ path: scene.path });
  await Promise.all([view.ensureSnapshot(scene), view.ensureSnapshot(scene)]);
  await view.ensureSnapshot(file("Projet/Autre.md"));
  assert.equal(snapshots, 2);
  assert.equal(notices.length, 1);
  plugin.snapshotFile = async () => { throw new Error("snapshot indisponible"); };
  await view.ensureSnapshot(file("Projet/Echec.md"));
  assert.equal(view._snapshotted.has("Projet/Echec.md"), true);
  Notice.onCreate = null;
});

test("DocxReviewView — analyse DOCX sans écriture et états restaurés", async () => {
  const scenePath = "Projet/Scene.md";
  const scene = file(scenePath, "Avant ajout passage");
  const bookmark = bookmarkIdFor(scenePath);
  const { view, writes } = createView({ files: [scene] });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  let renders = 0;
  view.render = async () => { renders += 1; };

  let zip = mockZip({});
  await view.analyzeBuffer(new Uint8Array(), "illisible.docx");
  zip.restore();
  assert.equal(view.results, null);
  assert.equal(notices.length, 1);

  zip = mockZip({ "word/comments.xml": "" });
  await view.analyzeBuffer(new Uint8Array(), "invalide.docx");
  zip.restore();
  assert.equal(notices.length, 2);

  const xml = documentXml(
    `<w:p><w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>Avant</w:t></w:r>` +
    `<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t> ajout</w:t></w:r></w:ins>` +
    `<w:commentRangeStart w:id="0"/><w:r><w:t> passage</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
    `<w:r><w:commentReference w:id="0"/></w:r><w:bookmarkEnd w:id="1"/></w:p>`
  );
  zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="AA"><w:r><w:t>Résolu</w:t></w:r></w:p></w:comment></w:comments>',
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>',
  });
  await view.analyzeBuffer(new Uint8Array(), "retours.docx");
  assert.deepEqual(zip.calls, ["word/document.xml", "word/comments.xml", "word/footnotes.xml", "word/commentsExtended.xml"]);
  zip.restore();
  assert.equal(view.mode, "results");
  assert.equal(renders, 1);
  assert.equal(writes.length, 0);
  const bucket = view.results.byPath[scenePath];
  assert.ok(bucket);
  const comment = bucket.comments[0];
  assert.equal(comment.dismissed, true);
  const insertion = bucket.changes.find((item) => item.type === "insertion");
  assert.equal(insertion.applied, true);

  insertion.applied = true;
  insertion.dismissed = false;
  await view.saveItemState(insertion);
  zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="AA"><w:r><w:t>Résolu</w:t></w:r></w:p></w:comment></w:comments>',
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>',
  });
  await view.analyzeBuffer(new Uint8Array(), "retours.docx");
  zip.restore();
  const restored = view.results.byPath[scenePath].changes.find((item) => item.type === "insertion");
  assert.equal(restored.applied, true);
  assert.equal(restored.dismissed, false);
  assert.equal(writes.length, 0);
  Notice.onCreate = null;
});

test("DocxReviewView — analyse d'un fichier externe refuse proprement hors desktop (aucun accès fs)", async () => {
  const { view } = createView();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const container = new FakeElement();
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    await view.renderPickerPanel(container);
    const analyzeBtn = allElements(container).find((element) => element.tag === "button" && element.icon === "search");
    assert.ok(analyzeBtn, "bouton d'analyse externe introuvable");
    await analyzeBtn.events.get("click")();
    assert.equal(notices.length, 1);
    assert.match(notices[0], /indisponible/i);
  } finally {
    Platform.isDesktop = previousDesktop;
    Notice.onCreate = null;
  }
});

test("DocxReviewView — rendu seul sans snapshot ni application", async () => {
  const { view } = createView();
  let snapshots = 0;
  view.ensureSnapshot = async () => { snapshots += 1; };
  view.renderSectionHead = () => true;
  await view.onOpen();
  await view.render();
  assert.equal(snapshots, 0);
  assert.equal(view._snapshotted, undefined);
  Platform.isMobile = false;
});
