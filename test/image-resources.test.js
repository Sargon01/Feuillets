import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  relativeImageResourceParentPath,
  resolvePastedImageDirectory,
  isEligiblePasteTarget,
  ensurePastedImageDirectory,
  pastedImageExtensionFromMime,
  defaultPastedImageBaseName,
  pastedImageBaseName,
  savePastedImage,
  extractPastedImageItems,
  hasPastedImageItems,
  handleEditorImagePaste,
  toImageEmbedMarkdown,
} from "../src/services/image-resources.js";

/* Pasted image resources: destination mirrors the sheet's parent path under
   the project's existing Images resources folder — never a second
   Resources/Ressources hierarchy, never a filesystem/Node API. */

function makeFile(path) {
  const file = new TFile(path);
  file.path = path;
  file.name = path.split("/").pop();
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.includes(".") ? file.name.split(".").pop() : "";
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

/** Minimal in-memory vault: tracks every node by path, supports
   getAbstractFileByPath, createFolder (registers + links into its parent's
   children, mirroring the real Vault) and createBinary. */
function makeApp(nodes, { linkFormat = "wikilink" } = {}) {
  const all = new Map();
  const register = (n) => {
    all.set(n.path, n);
    for (const c of n.children || []) { c.parent = n; register(c); }
  };
  for (const n of nodes) register(n);

  const createdFolders = [];
  const createdBinaries = [];
  const linkCalls = [];

  const parentPathOf = (path) => {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  };

  const vault = {
    getAbstractFileByPath: (p) => all.get(p) || null,
    async createFolder(path) {
      createdFolders.push(path);
      const folder = makeFolder(path);
      const parent = all.get(parentPathOf(path));
      if (parent) {
        folder.parent = parent;
        parent.children = [...(parent.children || []), folder];
      }
      all.set(path, folder);
      return folder;
    },
    async createBinary(path, data) {
      createdBinaries.push({ path, data });
      const file = makeFile(path);
      const parent = all.get(parentPathOf(path));
      if (parent) {
        file.parent = parent;
        parent.children = [...(parent.children || []), file];
      }
      all.set(path, file);
      return file;
    },
  };
  const fileManager = {
    // Real Obsidian `generateMarkdownLink` never prefixes "!" itself, in
    // either format — it is a plain link, embed-ness is the caller's job.
    generateMarkdownLink: (file, sourcePath) => {
      linkCalls.push({ file, sourcePath });
      return linkFormat === "markdown" ? `[${file.name}](${file.path})` : `[[${file.path}]]`;
    },
  };
  return { app: { vault, fileManager }, all, createdFolders, createdBinaries, linkCalls };
}

function structuredFrenchProject() {
  const front = makeFolder("Mon Roman/Manuscrit/Front");
  const partI = makeFolder("Mon Roman/Manuscrit/Partie I", [makeFile("Mon Roman/Manuscrit/Partie I/chapitre.md")]);
  const manuscrit = makeFolder("Mon Roman/Manuscrit", [front, partI]);
  const resources = makeFolder("Mon Roman/_Feuillets/Ressources", [makeFolder("Mon Roman/_Feuillets/Ressources/Images")]);
  const feuillets = makeFolder("Mon Roman/_Feuillets", [resources]);
  const root = makeFolder("Mon Roman", [manuscrit, feuillets]);
  const { app, ...spies } = makeApp([root]);
  return { app, settings: { projectFolder: manuscrit.path }, manuscrit, partI, ...spies };
}

function freeFolderProject(options) {
  const article = makeFile("Project/EDG/L'IDENTITÉ/article.md");
  const edg = makeFolder("Project/EDG/L'IDENTITÉ", [article]);
  const edgRoot = makeFolder("Project/EDG", [edg]);
  const rootFile = makeFile("Project/file.md");
  const images = makeFolder("Project/_Feuillets/Ressources/Images");
  const resources = makeFolder("Project/_Feuillets/Ressources", [images]);
  const feuillets = makeFolder("Project/_Feuillets", [resources]);
  const root = makeFolder("Project", [edgRoot, rootFile, feuillets]);
  const { app, ...spies } = makeApp([root], options);
  return { app, settings: { projectFolder: root.path }, root, rootFile, edgRoot, article, ...spies };
}

/* --- Destination resolution ------------------------------------------- */

test("relativeImageResourceParentPath: root, nested, and outside", () => {
  const root = makeFolder("Root");
  const direct = makeFile("Root/file.md");
  direct.parent = root;
  const nested = makeFile("Root/A/B/file.md");
  nested.parent = makeFolder("Root/A/B");
  const outside = makeFile("Elsewhere/file.md");
  outside.parent = makeFolder("Elsewhere");
  assert.equal(relativeImageResourceParentPath(root, direct), "");
  assert.equal(relativeImageResourceParentPath(root, nested), "A/B");
  assert.equal(relativeImageResourceParentPath(root, outside), null);
});

test("free-folder project: file directly at root", () => {
  const fx = freeFolderProject();
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, fx.rootFile), "Project/_Feuillets/Ressources/Images");
});

test("free-folder project: nested folder mirrors under Images", () => {
  const fx = freeFolderProject();
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, fx.article), "Project/_Feuillets/Ressources/Images/EDG/L'IDENTITÉ");
});

test("structured Manuscrit project: nested Partie mirrors under Images, next to Manuscrit", () => {
  const fx = structuredFrenchProject();
  const chapitre = fx.app.vault.getAbstractFileByPath("Mon Roman/Manuscrit/Partie I/chapitre.md");
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, chapitre), "Mon Roman/_Feuillets/Ressources/Images/Partie I");
});

test("deeply nested directories are mirrored in full", () => {
  const fx = freeFolderProject();
  const deep = makeFile("Project/EDG/L'IDENTITÉ/Sub/Deeper/note.md");
  deep.parent = makeFolder("Project/EDG/L'IDENTITÉ/Sub/Deeper");
  fx.article.parent.children.push(deep.parent);
  fx.all.set(deep.parent.path, deep.parent);
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, deep), "Project/_Feuillets/Ressources/Images/EDG/L'IDENTITÉ/Sub/Deeper");
});

test("source file outside the active project: no interception", () => {
  const fx = freeFolderProject();
  const outsider = makeFile("Elsewhere/note.md");
  outsider.parent = makeFolder("Elsewhere");
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, outsider), null);
  assert.equal(isEligiblePasteTarget(fx.app, fx.settings, outsider), false);
});

test("no active project: no interception", () => {
  const fx = freeFolderProject();
  assert.equal(resolvePastedImageDirectory(fx.app, { projectFolder: "" }, fx.rootFile), null);
});

test("file under _Feuillets/: no interception even though it is technically under the project tree", () => {
  const fx = freeFolderProject();
  const insideAux = makeFile("Project/_Feuillets/Ressources/note.md");
  insideAux.parent = fx.app.vault.getAbstractFileByPath("Project/_Feuillets/Ressources");
  assert.equal(resolvePastedImageDirectory(fx.app, fx.settings, insideAux), null);
  assert.equal(isEligiblePasteTarget(fx.app, fx.settings, insideAux), false);
});

test("non-Markdown file: not an eligible paste target", () => {
  const fx = freeFolderProject();
  const canvas = makeFile("Project/board.canvas");
  canvas.parent = fx.root;
  assert.equal(isEligiblePasteTarget(fx.app, fx.settings, canvas), false);
});

test("English-structured project: Images resolved next to Manuscript", () => {
  const chapter = makeFile("Novel/Manuscript/Part I/chapter.md");
  const partI = makeFolder("Novel/Manuscript/Part I", [chapter]);
  const manuscript = makeFolder("Novel/Manuscript", [partI]);
  const images = makeFolder("Novel/_Feuillets/Resources/Images");
  const resources = makeFolder("Novel/_Feuillets/Resources", [images]);
  const feuillets = makeFolder("Novel/_Feuillets", [resources]);
  const root = makeFolder("Novel", [manuscript, feuillets]);
  const { app } = makeApp([root]);
  assert.equal(resolvePastedImageDirectory(app, { projectFolder: manuscript.path }, chapter), "Novel/_Feuillets/Resources/Images/Part I");
});

test("legacy Resources folder variant is reused, never duplicated", () => {
  const chapter = makeFile("Mon Roman/Manuscrit/Partie I/chapitre.md");
  const partI = makeFolder("Mon Roman/Manuscrit/Partie I", [chapter]);
  const manuscrit = makeFolder("Mon Roman/Manuscrit", [partI]);
  // Legacy sibling "_Resources" (English legacy name), not the canonical
  // "_Feuillets/Ressources" — getResourcesRoot must still find it.
  const legacyImages = makeFolder("Mon Roman/_Resources/Images");
  const legacyResources = makeFolder("Mon Roman/_Resources", [legacyImages]);
  const root = makeFolder("Mon Roman", [manuscrit, legacyResources]);
  const { app, createdFolders } = makeApp([root]);
  const dir = resolvePastedImageDirectory(app, { projectFolder: manuscrit.path }, chapter);
  assert.equal(dir, "Mon Roman/_Resources/Images/Partie I");
  assert.equal(createdFolders.length, 0, "resolution alone must never create anything");
});

/* --- Directory creation ------------------------------------------------ */

test("existing destination subdirectories are reused, nothing recreated", async () => {
  const fx = structuredFrenchProject();
  const chapitre = fx.app.vault.getAbstractFileByPath("Mon Roman/Manuscrit/Partie I/chapitre.md");
  const partIImages = makeFolder("Mon Roman/_Feuillets/Ressources/Images/Partie I");
  const images = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  images.children.push(partIImages);
  fx.all.set(partIImages.path, partIImages);
  const dir = resolvePastedImageDirectory(fx.app, fx.settings, chapitre);
  const folder = await ensurePastedImageDirectory(fx.app, dir);
  assert.equal(folder, partIImages);
  assert.deepEqual(fx.createdFolders, []);
});

test("missing mirrored directories are created, segment by segment", async () => {
  const fx = freeFolderProject();
  const dir = resolvePastedImageDirectory(fx.app, fx.settings, fx.article);
  await ensurePastedImageDirectory(fx.app, dir);
  assert.deepEqual(fx.createdFolders, [
    "Project/_Feuillets/Ressources/Images/EDG",
    "Project/_Feuillets/Ressources/Images/EDG/L'IDENTITÉ",
  ]);
  assert.ok(fx.app.vault.getAbstractFileByPath(dir) instanceof TFolder);
});

/* --- MIME / naming ------------------------------------------------------ */

test("extension is derived from the MIME type, including unlisted image/* subtypes", () => {
  assert.equal(pastedImageExtensionFromMime("image/png"), "png");
  assert.equal(pastedImageExtensionFromMime("image/jpeg"), "jpg");
  assert.equal(pastedImageExtensionFromMime("image/webp"), "webp");
  assert.equal(pastedImageExtensionFromMime("image/gif"), "gif");
  assert.equal(pastedImageExtensionFromMime("image/avif"), "avif");
  assert.equal(pastedImageExtensionFromMime("image/vnd.custom"), "vndcustom");
  assert.equal(pastedImageExtensionFromMime("text/plain"), null);
  assert.equal(pastedImageExtensionFromMime(""), null);
});

test("default pasted image base name follows the deterministic, readable format", () => {
  assert.equal(defaultPastedImageBaseName(new Date(2026, 8, 27, 11, 25, 30)), "Pasted image 20260927 112530");
  assert.equal(defaultPastedImageBaseName(new Date(2026, 0, 5, 9, 5, 3)), "Pasted image 20260105 090503");
});

test("a usable clipboard filename is reused; a generic or empty one falls back", () => {
  const now = new Date(2026, 8, 27, 11, 25, 30);
  assert.equal(pastedImageBaseName("Sunset over the bay.png", now), "Sunset over the bay");
  assert.equal(pastedImageBaseName("image.png", now), "Pasted image 20260927 112530");
  assert.equal(pastedImageBaseName("", now), "Pasted image 20260927 112530");
  assert.equal(pastedImageBaseName(null, now), "Pasted image 20260927 112530");
  assert.equal(pastedImageBaseName("clipboard.png", now), "Pasted image 20260927 112530");
});

/* --- Writing + collisions ------------------------------------------------ */

function buffer(byte) {
  return new Uint8Array([byte]).buffer;
}

test("filename collision never overwrites an existing image", async () => {
  const fx = freeFolderProject();
  const now = new Date(2026, 8, 27, 11, 25, 30);
  const first = await savePastedImage(fx.app, fx.settings, fx.rootFile, { mimeType: "image/png", originalName: "art.png", arrayBuffer: buffer(1) }, now);
  const second = await savePastedImage(fx.app, fx.settings, fx.rootFile, { mimeType: "image/png", originalName: "art.png", arrayBuffer: buffer(2) }, now);
  assert.equal(first.path, "Project/_Feuillets/Ressources/Images/art.png");
  assert.equal(second.path, "Project/_Feuillets/Ressources/Images/art 2.png");
  assert.equal(new Uint8Array(fx.createdBinaries[0].data)[0], 1, "first file's bytes are untouched by the second write");
});

test("savePastedImage returns null and writes nothing for an ineligible target", async () => {
  const fx = freeFolderProject();
  const outsider = makeFile("Elsewhere/note.md");
  outsider.parent = makeFolder("Elsewhere");
  const created = await savePastedImage(fx.app, fx.settings, outsider, { mimeType: "image/png", originalName: null, arrayBuffer: buffer(1) });
  assert.equal(created, null);
  assert.deepEqual(fx.createdBinaries, []);
});

/* --- Clipboard extraction ------------------------------------------------ */

function clipboardItem(kind, type, file) {
  return { kind, type, getAsFile: () => file };
}

test("text-only clipboard: no image items extracted", () => {
  const items = extractPastedImageItems({ items: [clipboardItem("string", "text/plain", null)] });
  assert.deepEqual(items, []);
  assert.equal(hasPastedImageItems({ items: [clipboardItem("string", "text/plain", null)] }), false);
});

test("no clipboard data at all: no image items, no throw", () => {
  assert.deepEqual(extractPastedImageItems(null), []);
  assert.equal(hasPastedImageItems(undefined), false);
});

test("mixed clipboard: only the image/* file items are extracted, in order", () => {
  const png = { name: "a.png", arrayBuffer: async () => buffer(1) };
  const jpg = { name: "b.jpg", arrayBuffer: async () => buffer(2) };
  const items = extractPastedImageItems({
    items: [clipboardItem("string", "text/plain", null), clipboardItem("file", "image/png", png), clipboardItem("file", "image/jpeg", jpg)],
  });
  assert.deepEqual(items.map((i) => i.mimeType), ["image/png", "image/jpeg"]);
  assert.equal(items[0].file, png);
});

/* --- Editor insertion ------------------------------------------------ */

function fakeEditor() {
  const calls = [];
  return { calls, replaceSelection: (text) => calls.push(text) };
}

test("generated embed points to the created TFile, via the app's own link generator", async () => {
  const fx = freeFolderProject();
  const editor = fakeEditor();
  const png = { name: "art.png", arrayBuffer: async () => buffer(9) };
  await handleEditorImagePaste(fx.app, fx.settings, { items: [clipboardItem("file", "image/png", png)] }, editor, fx.rootFile, new Date(2026, 8, 27, 11, 25, 30));
  assert.equal(editor.calls.length, 1);
  assert.equal(fx.linkCalls.length, 1);
  assert.equal(fx.linkCalls[0].file.path, "Project/_Feuillets/Ressources/Images/art.png");
  assert.equal(fx.linkCalls[0].sourcePath, fx.rootFile.path);
  assert.equal(editor.calls[0], "![[Project/_Feuillets/Ressources/Images/art.png]]");
});

test("toImageEmbedMarkdown: wikilink, Markdown link, and already-embed forms", () => {
  assert.equal(toImageEmbedMarkdown("[[image.png]]"), "![[image.png]]");
  assert.equal(toImageEmbedMarkdown("[image.png](Project/Images/image.png)"), "![image.png](Project/Images/image.png)");
  assert.equal(toImageEmbedMarkdown("![[image.png]]"), "![[image.png]]", "no double '!' when already an embed");
  assert.equal(toImageEmbedMarkdown("![image.png](Project/Images/image.png)"), "![image.png](Project/Images/image.png)");
});

test("generateMarkdownLink returning a wikilink is embedded, never a bare link", async () => {
  const fx = freeFolderProject({ linkFormat: "wikilink" });
  const editor = fakeEditor();
  const png = { name: "art.png", arrayBuffer: async () => buffer(1) };
  await handleEditorImagePaste(fx.app, fx.settings, { items: [clipboardItem("file", "image/png", png)] }, editor, fx.rootFile);
  assert.equal(editor.calls[0], "![[Project/_Feuillets/Ressources/Images/art.png]]");
});

test("generateMarkdownLink returning a Markdown link is embedded the same way, without reconstructing the path", async () => {
  const fx = freeFolderProject({ linkFormat: "markdown" });
  const editor = fakeEditor();
  const png = { name: "art.png", arrayBuffer: async () => buffer(1) };
  await handleEditorImagePaste(fx.app, fx.settings, { items: [clipboardItem("file", "image/png", png)] }, editor, fx.rootFile);
  assert.equal(editor.calls[0], "![art.png](Project/_Feuillets/Ressources/Images/art.png)");
});

test("several images pasted at once: each is written before its embed is inserted, in one edit", async () => {
  const fx = freeFolderProject();
  const editor = fakeEditor();
  const a = { name: "a.png", arrayBuffer: async () => buffer(1) };
  const b = { name: "b.jpg", arrayBuffer: async () => buffer(2) };
  await handleEditorImagePaste(
    fx.app,
    fx.settings,
    { items: [clipboardItem("file", "image/png", a), clipboardItem("file", "image/jpeg", b)] },
    editor,
    fx.rootFile
  );
  assert.equal(editor.calls.length, 1, "a single combined edit, never one transaction per image");
  assert.equal(fx.createdBinaries.length, 2);
  assert.equal(editor.calls[0].split("\n").length, 2);
});

test("one image failing among several is skipped cleanly: the other still gets its embed, nothing overwritten", async () => {
  const fx = freeFolderProject();
  const editor = fakeEditor();
  const good = { name: "good.png", arrayBuffer: async () => buffer(1) };
  const bad = { name: "bad.png", arrayBuffer: async () => { throw new Error("clipboard read failed"); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleEditorImagePaste(
      fx.app,
      fx.settings,
      { items: [clipboardItem("file", "image/png", bad), clipboardItem("file", "image/png", good)] },
      editor,
      fx.rootFile
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(fx.createdBinaries.length, 1);
  assert.equal(editor.calls.length, 1);
  assert.doesNotMatch(editor.calls[0], /\n/);
  assert.match(editor.calls[0], /good\.png/);
});

test("text-only paste: handleEditorImagePaste is a no-op, no write, no edit", async () => {
  const fx = freeFolderProject();
  const editor = fakeEditor();
  await handleEditorImagePaste(fx.app, fx.settings, { items: [clipboardItem("string", "text/plain", null)] }, editor, fx.rootFile);
  assert.deepEqual(fx.createdBinaries, []);
  assert.deepEqual(editor.calls, []);
});

test("never writes with Node filesystem APIs / never encodes bytes as text: the exact ArrayBuffer reaches createBinary", async () => {
  const fx = freeFolderProject();
  const raw = buffer(42);
  await savePastedImage(fx.app, fx.settings, fx.rootFile, { mimeType: "image/png", originalName: "x.png", arrayBuffer: raw });
  assert.equal(fx.createdBinaries[0].data, raw);
});
