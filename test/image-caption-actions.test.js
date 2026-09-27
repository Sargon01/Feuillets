import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  imageCaptionLineContext,
  addImageCaption,
  editImageCaption,
  removeImageCaption,
} from "../src/services/image-caption-actions.js";

/* Add/Edit/Remove image caption — standalone local image under the cursor
   in a normal Feuillets Markdown sheet. Reuses image-markdown.ts's parser/
   formatter; never a second caption rule. */

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

function fixture() {
  const sheet = makeFile("Project/Chapter/scene.md");
  const image = makeFile("Project/Chapter/image.png");
  const outsider = makeFile("Elsewhere/note.md");
  const chapter = makeFolder("Project/Chapter", [sheet, image]);
  const root = makeFolder("Project", [chapter]);
  const all = new Map();
  const register = (n) => { all.set(n.path, n); (n.children || []).forEach(register); };
  register(root);
  register(outsider);
  const app = {
    vault: {
      getAbstractFileByPath: (path) => all.get(path) || null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        if (all.has(linkpath)) return all.get(linkpath);
        for (const node of all.values()) {
          if (node instanceof TFile && (node.name === linkpath || node.basename === linkpath)) return node;
        }
        return null;
      },
    },
  };
  const settings = { projectFolder: root.path };
  return { app, settings, sheet, image, outsider };
}

test("plain wikilink embed of a resolvable local image: eligible, no caption yet", () => {
  const fx = fixture();
  const context = imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![[image.png]]");
  assert.ok(context);
  assert.equal(context.hasCaption, false);
  assert.equal(context.parsed.target, "image.png");
});

test("already-captioned Markdown embed: eligible, has a caption", () => {
  const fx = fixture();
  const context = imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![Old caption](image.png)");
  assert.ok(context);
  assert.equal(context.hasCaption, true);
  assert.equal(context.parsed.caption, "Old caption");
});

test("ordinary text: not eligible", () => {
  const fx = fixture();
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "Just a sentence."), null);
});

test("remote image: not eligible (not a local image)", () => {
  const fx = fixture();
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![[https://example.com/pic.png]]"), null);
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![Caption](https://example.com/pic.png)"), null);
});

test("non-image extension (e.g. a note wikilink): not eligible", () => {
  const fx = fixture();
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![[Other note.md]]"), null);
});

test("unresolved target (no matching vault file): not eligible", () => {
  const fx = fixture();
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![[ghost.png]]"), null);
});

test("file outside the active project: not eligible, even with a perfectly valid image line", () => {
  const fx = fixture();
  assert.equal(imageCaptionLineContext(fx.app, fx.settings, fx.outsider, "![[image.png]]"), null);
});

test("add caption: plain embed becomes a captioned standard Markdown reference", () => {
  const fx = fixture();
  const context = imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![[image.png]]");
  const result = addImageCaption(context.parsed, "Vue générale du site en 1923");
  assert.deepEqual(result, { ok: true, markdown: "![Vue générale du site en 1923](image.png)" });
});

test("add caption: target with spaces is angle-bracket wrapped, never a bare unescaped destination", () => {
  // addImageCaption only needs the already-parsed target — no vault lookup
  // happens here, so no fixture/eligibility check is needed for this case.
  const result = addImageCaption({ syntax: "wikilink", target: "Pasted image 1.png" }, "Légende");
  assert.equal(result.markdown, "![Légende](<Pasted image 1.png>)");
});

test("add caption: an explicit width alias fails closed instead of silently dropping the size", () => {
  const parsed = { syntax: "wikilink", target: "image.png", width: 300 };
  assert.deepEqual(addImageCaption(parsed, "Une légende"), { ok: false, reason: "would-lose-dimensions" });
});

test("add caption: an explicit width x height alias also fails closed", () => {
  const parsed = { syntax: "wikilink", target: "image.png", width: 300, height: 200 };
  assert.deepEqual(addImageCaption(parsed, "Une légende"), { ok: false, reason: "would-lose-dimensions" });
});

test("edit caption: only the caption text changes, the target is untouched", () => {
  const fx = fixture();
  const context = imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![Ancienne légende](image.png)");
  assert.equal(editImageCaption(context.parsed, "Nouvelle légende"), "![Nouvelle légende](image.png)");
});

test("edit caption: a nested target keeps its exact path", () => {
  const parsed = { syntax: "markdown", target: "folder/image.png", caption: "Old" };
  assert.equal(editImageCaption(parsed, "New"), "![New](folder/image.png)");
});

test("remove caption: produces a plain, valid image reference, image untouched", () => {
  const fx = fixture();
  const context = imageCaptionLineContext(fx.app, fx.settings, fx.sheet, "![Une légende](image.png)");
  assert.equal(removeImageCaption(context.parsed), "![[image.png]]");
});

test("remove caption: a nested target is preserved exactly, never rewritten", () => {
  const parsed = { syntax: "markdown", target: "folder/sous-dossier/image.png", caption: "Legend" };
  assert.equal(removeImageCaption(parsed), "![[folder/sous-dossier/image.png]]");
});
