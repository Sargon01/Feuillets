import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  resolveImageResourceFileMove,
  syncImageResourceFileAfterMove,
} from "../src/services/image-resources.js";

/*
 * Lot 3: a single Markdown sheet moved to a different parent folder should
 * bring its OWN referenced pasted images with it — never the whole old
 * mirror directory, never an image the sheet doesn't reference, never a
 * nested/unrelated image. Same small in-memory-vault fixture style as
 * image-resources-rename.test.js (Lot 2's own tests), extended with
 * `vault.read` (the moved sheet's content) and a `metadataCache` stub that
 * resolves a link the same way Obsidian's real one does: exact path, then
 * unique name/basename anywhere in the vault.
 */

function makeFile(path, content = "") {
  const file = new TFile(path);
  file.path = path;
  file.name = path.split("/").pop();
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.includes(".") ? file.name.split(".").pop() : "";
  file.content = content;
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

function makeApp(nodes) {
  const all = new Map();
  const register = (n) => {
    all.set(n.path, n);
    for (const c of n.children || []) { c.parent = n; register(c); }
  };
  for (const n of nodes) register(n);

  const createdFolders = [];
  const renameCalls = [];
  const vaultRenameCalls = [];

  const parentPathOf = (path) => {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  };

  const vault = {
    getAbstractFileByPath: (p) => all.get(p) || null,
    async read(file) { return file.content ?? ""; },
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
    async rename() {
      vaultRenameCalls.push(true);
      throw new Error("vault.rename must never be called by the image-mirror move feature");
    },
    async delete() { throw new Error("vault.delete must never be called by this feature"); },
  };

  const fileManager = {
    async renameFile(file, newPath) {
      renameCalls.push({ from: file.path, to: newPath });
      const oldParent = file.parent;
      if (oldParent?.children) oldParent.children = oldParent.children.filter((c) => c !== file);
      all.delete(file.path);
      file.path = newPath;
      file.name = newPath.split("/").pop();
      const newParent = all.get(parentPathOf(newPath));
      file.parent = newParent || null;
      if (newParent) newParent.children = [...(newParent.children || []), file];
      all.set(newPath, file);
    },
    async trashFile() { throw new Error("trashFile must never be called by this feature"); },
  };

  const metadataCache = {
    // Same resolution order as image-resources.test.js's own fixture: exact
    // path, then a unique name/basename match anywhere in the vault — close
    // enough to Obsidian's real getFirstLinkpathDest for these tests, which
    // never rely on ambiguous-name tie-breaking.
    getFirstLinkpathDest(linkpath) {
      if (all.has(linkpath)) return all.get(linkpath);
      for (const node of all.values()) {
        if (node instanceof TFile && (node.name === linkpath || node.basename === linkpath)) return node;
      }
      return null;
    },
  };

  return { app: { vault, fileManager, metadataCache }, all, createdFolders, renameCalls, vaultRenameCalls };
}

function structuredProject(rootName, { manuscriptChildren = [], imagesChildren = [] } = {}) {
  const manuscrit = makeFolder(`${rootName}/Manuscrit`, manuscriptChildren);
  const imageFolders = imagesChildren.map((relative) => makeFolder(`${rootName}/_Feuillets/Ressources/Images/${relative}`));
  const images = makeFolder(`${rootName}/_Feuillets/Ressources/Images`, imageFolders);
  const resources = makeFolder(`${rootName}/_Feuillets/Ressources`, [images]);
  const feuillets = makeFolder(`${rootName}/_Feuillets`, [resources]);
  const root = makeFolder(rootName, [manuscrit, feuillets]);
  const { app, ...spies } = makeApp([root]);
  return { app, settings: { projectFolder: manuscrit.path }, root, manuscrit, images, feuillets, ...spies };
}

function freeProject(rootName, { contentChildren = [], imagesChildren = [] } = {}) {
  const imageFolders = imagesChildren.map((relative) => makeFolder(`${rootName}/_Feuillets/Ressources/Images/${relative}`));
  const images = makeFolder(`${rootName}/_Feuillets/Ressources/Images`, imageFolders);
  const resources = makeFolder(`${rootName}/_Feuillets/Ressources`, [images]);
  const feuillets = makeFolder(`${rootName}/_Feuillets`, [resources]);
  const root = makeFolder(rootName, [...contentChildren, feuillets]);
  const { app, ...spies } = makeApp([root]);
  return { app, settings: { projectFolder: root.path }, root, images, feuillets, ...spies };
}

function addFolder(fx, path, children = []) {
  const folder = makeFolder(path, children);
  const parent = fx.app.vault.getAbstractFileByPath(path.slice(0, path.lastIndexOf("/")));
  parent.children.push(folder);
  folder.parent = parent;
  fx.all.set(path, folder);
  for (const c of children) fx.all.set(c.path, c);
  return folder;
}

function addFile(fx, path, content = "") {
  const file = makeFile(path, content);
  const parent = fx.app.vault.getAbstractFileByPath(path.slice(0, path.lastIndexOf("/")));
  parent.children.push(file);
  file.parent = parent;
  fx.all.set(path, file);
  return file;
}

/* --- §18: pure path resolution ------------------------------------------ */

test("1. A/scene.md -> B/scene.md resolves old/new image directories", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md")]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md");
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.ok(plan);
  assert.equal(plan.oldImageDirectory, "Mon Roman/_Feuillets/Ressources/Images/A");
  assert.equal(plan.newImageDirectory, "Mon Roman/_Feuillets/Ressources/Images/B");
});

test("2. structured project, deeper parents", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Partie I", [makeFile("Mon Roman/Manuscrit/Partie I/scene.md")]);
  addFolder(fx, "Mon Roman/Manuscrit/Partie II");
  addFile(fx, "Mon Roman/Manuscrit/Partie II/scene.md");
  const plan = resolveImageResourceFileMove(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/Partie I/scene.md", "Mon Roman/Manuscrit/Partie II/scene.md"
  );
  assert.equal(plan.oldImageDirectory, "Mon Roman/_Feuillets/Ressources/Images/Partie I");
  assert.equal(plan.newImageDirectory, "Mon Roman/_Feuillets/Ressources/Images/Partie II");
});

test("3. free/adopted project", () => {
  const fx = freeProject("TEXTES", { contentChildren: [makeFolder("TEXTES/EDG", [makeFile("TEXTES/EDG/article.md")])] });
  addFolder(fx, "TEXTES/HISTOIRE");
  addFile(fx, "TEXTES/HISTOIRE/article.md");
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "TEXTES/EDG/article.md", "TEXTES/HISTOIRE/article.md");
  assert.equal(plan.oldImageDirectory, "TEXTES/_Feuillets/Ressources/Images/EDG");
  assert.equal(plan.newImageDirectory, "TEXTES/_Feuillets/Ressources/Images/HISTOIRE");
});

test("4. nested source and destination", () => {
  const fx = freeProject("TEXTES", {
    contentChildren: [makeFolder("TEXTES/A", [makeFolder("TEXTES/A/B", [makeFile("TEXTES/A/B/scene.md")])])],
  });
  addFolder(fx, "TEXTES/A/C");
  addFile(fx, "TEXTES/A/C/scene.md");
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "TEXTES/A/B/scene.md", "TEXTES/A/C/scene.md");
  assert.equal(plan.oldImageDirectory, "TEXTES/_Feuillets/Ressources/Images/A/B");
  assert.equal(plan.newImageDirectory, "TEXTES/_Feuillets/Ressources/Images/A/C");
});

test("5. simple filename rename in the same parent: no operation", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md")]);
  addFile(fx, "Mon Roman/Manuscrit/A/nouvelle-scene.md");
  const plan = resolveImageResourceFileMove(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/A/nouvelle-scene.md"
  );
  assert.equal(plan, null);
});

test("6. a non-Markdown TFile is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/board.canvas")]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/board.canvas");
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/board.canvas", "Mon Roman/Manuscrit/B/board.canvas");
  assert.equal(plan, null);
});

test("7. source outside every known project is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md");
  const outsideFolder = makeFolder("Outside", [makeFile("Outside/scene.md")]);
  fx.all.set(outsideFolder.path, outsideFolder);
  fx.all.set("Outside/scene.md", outsideFolder.children[0]);
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "Outside/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.equal(plan, null);
});

test("8. destination outside every known project is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md")]);
  const outsideFolder = makeFolder("Outside", [makeFile("Outside/scene.md")]);
  fx.all.set(outsideFolder.path, outsideFolder);
  fx.all.set("Outside/scene.md", outsideFolder.children[0]);
  const plan = resolveImageResourceFileMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Outside/scene.md");
  assert.equal(plan, null);
});

test("9. cross-project move is rejected", () => {
  const fxA = structuredProject("Project A");
  const fxB = structuredProject("Project B");
  addFolder(fxA, "Project A/Manuscrit/A", [makeFile("Project A/Manuscrit/A/scene.md")]);
  addFolder(fxB, "Project B/Manuscrit/B");
  const destFile = addFile(fxB, "Project B/Manuscrit/B/scene.md");
  const combined = new Map([...fxA.all, ...fxB.all]);
  const app = {
    vault: { getAbstractFileByPath: (p) => combined.get(p) || null, read: fxA.app.vault.read },
    fileManager: fxA.app.fileManager,
    metadataCache: fxA.app.metadataCache,
  };
  const plan = resolveImageResourceFileMove(app, [fxA.settings, fxB.settings], "Project A/Manuscrit/A/scene.md", destFile.path);
  assert.equal(plan, null);
});

test("10. a Markdown file under _Feuillets is rejected as source or destination", () => {
  const fx = freeProject("TEXTES");
  addFolder(fx, "TEXTES/Dest");
  addFile(fx, "TEXTES/Dest/note.md");
  addFile(fx, "TEXTES/_Feuillets/Ressources/note.md");
  const p1 = resolveImageResourceFileMove(fx.app, [fx.settings], "TEXTES/_Feuillets/Ressources/note.md", "TEXTES/Dest/note.md");
  assert.equal(p1, null);

  const fx2 = freeProject("TEXTES");
  addFolder(fx2, "TEXTES/Src", [makeFile("TEXTES/Src/note.md")]);
  addFile(fx2, "TEXTES/_Feuillets/Ressources/note2.md");
  const p2 = resolveImageResourceFileMove(fx2.app, [fx2.settings], "TEXTES/Src/note.md", "TEXTES/_Feuillets/Ressources/note2.md");
  assert.equal(p2, null);
});

test("11. overlapping known projects: only the most specific owner is used", () => {
  const inner = makeFolder("Big/Manuscrit/Sub/Manuscrit", [
    makeFolder("Big/Manuscrit/Sub/Manuscrit/A", [makeFile("Big/Manuscrit/Sub/Manuscrit/A/scene.md")]),
  ]);
  const sub = makeFolder("Big/Manuscrit/Sub", [inner]);
  const outerManuscrit = makeFolder("Big/Manuscrit", [sub]);
  const root = makeFolder("Big", [outerManuscrit]);
  const { app, ...spies } = makeApp([root]);
  const fx = { app, ...spies };
  addFolder(fx, "Big/Manuscrit/Sub/Manuscrit/B");
  addFile(fx, "Big/Manuscrit/Sub/Manuscrit/B/scene.md");

  const outerSettings = { projectFolder: outerManuscrit.path };
  const innerSettings = { projectFolder: inner.path };
  const plan = resolveImageResourceFileMove(
    app, [outerSettings, innerSettings],
    "Big/Manuscrit/Sub/Manuscrit/A/scene.md", "Big/Manuscrit/Sub/Manuscrit/B/scene.md"
  );
  assert.ok(plan);
  assert.equal(plan.root.path, inner.path);
});

test("12. one Vault event yields at most one plan even with overlapping projects", async () => {
  const inner = makeFolder("Big/Manuscrit/Sub/Manuscrit", [
    makeFolder("Big/Manuscrit/Sub/Manuscrit/A", [makeFile("Big/Manuscrit/Sub/Manuscrit/A/scene.md")]),
  ]);
  const sub = makeFolder("Big/Manuscrit/Sub", [inner]);
  const outerManuscrit = makeFolder("Big/Manuscrit", [sub]);
  const root = makeFolder("Big", [outerManuscrit]);
  const { app, ...spies } = makeApp([root]);
  const fx = { app, ...spies };
  addFolder(fx, "Big/Manuscrit/Sub/Manuscrit/B");
  addFile(fx, "Big/Manuscrit/Sub/Manuscrit/B/scene.md");
  const outerSettings = { projectFolder: outerManuscrit.path };
  const innerSettings = { projectFolder: inner.path };
  await syncImageResourceFileAfterMove(
    app, [outerSettings, innerSettings], "Big/Manuscrit/Sub/Manuscrit/A/scene.md", "Big/Manuscrit/Sub/Manuscrit/B/scene.md"
  );
  // No images referenced at all here — this test only locks the "at most
  // one plan" invariant already proven directly above; the async path must
  // not throw or double-process anything.
  assert.deepEqual(fx.renameCalls, []);
});

/* --- §20: filesystem behavior -------------------------------------------- */

test("27. no eligible image referenced: destination directory not created", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", "Just prose, no images.")]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", "Just prose, no images.");
  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.deepEqual(fx.createdFolders, []);
  assert.deepEqual(fx.renameCalls, []);
});

test("28. one eligible image: destination directory created, image moved once", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo.path, photo);

  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", "![[photo.jpg]]")]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", "![[photo.jpg]]");

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");

  assert.deepEqual(fx.createdFolders, ["Mon Roman/_Feuillets/Ressources/Images/B"]);
  assert.equal(fx.renameCalls.length, 1);
  assert.equal(fx.renameCalls[0].from, "Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  assert.equal(fx.renameCalls[0].to, "Mon Roman/_Feuillets/Ressources/Images/B/photo.jpg");
});

test("29. several referenced eligible images are all moved", async () => {
  const photo1 = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo1.jpg");
  const photo2 = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo2.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo1, photo2]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo1.path, photo1);
  fx.all.set(photo2.path, photo2);

  const content = "![[photo1.jpg]]\n\n![Deux](photo2.jpg)";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");

  assert.equal(fx.renameCalls.length, 2);
  const moved = fx.renameCalls.map((c) => c.to).sort();
  assert.deepEqual(moved, [
    "Mon Roman/_Feuillets/Ressources/Images/B/photo1.jpg",
    "Mon Roman/_Feuillets/Ressources/Images/B/photo2.jpg",
  ]);
});

test("30. an unrelated image in the old mirror (not referenced by the sheet) stays put", async () => {
  const referenced = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/referenced.jpg");
  const unrelated = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/unrelated.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [referenced, unrelated]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(referenced.path, referenced);
  fx.all.set(unrelated.path, unrelated);

  const content = "![[referenced.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");

  assert.equal(fx.renameCalls.length, 1);
  // `referenced` is mutated in place by the fake fileManager.renameFile, so
  // its ORIGINAL path is captured beforehand rather than reading `.path`
  // now (which already reflects the NEW location).
  assert.equal(fx.renameCalls[0].from, "Mon Roman/_Feuillets/Ressources/Images/A/referenced.jpg");
  assert.ok(fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/A/unrelated.jpg") instanceof TFile, "unrelated image stays in the OLD mirror");
});

test("31. exact destination collision on one image: it stays, warning emitted, old mirror untouched", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  const collidingDestination = makeFile("Mon Roman/_Feuillets/Ressources/Images/B/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  const mirrorB = makeFolder("Mon Roman/_Feuillets/Ressources/Images/B", [collidingDestination]);
  imagesFolder.children.push(mirrorA, mirrorB);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(mirrorB.path, mirrorB);
  fx.all.set(photo.path, photo);
  fx.all.set(collidingDestination.path, collidingDestination);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(fx.renameCalls, []);
  assert.equal(warnings.length, 1);
  assert.ok(fx.app.vault.getAbstractFileByPath(photo.path) instanceof TFile, "source image stays put");
  assert.equal(fx.app.vault.getAbstractFileByPath(photo.path).path, photo.path);
});

test("32. a collision on one image does not prevent another eligible image from moving", async () => {
  const colliding = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/colliding.jpg");
  const clean = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/clean.jpg");
  const existingDestination = makeFile("Mon Roman/_Feuillets/Ressources/Images/B/colliding.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [colliding, clean]);
  const mirrorB = makeFolder("Mon Roman/_Feuillets/Ressources/Images/B", [existingDestination]);
  imagesFolder.children.push(mirrorA, mirrorB);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(mirrorB.path, mirrorB);
  fx.all.set(colliding.path, colliding);
  fx.all.set(clean.path, clean);
  fx.all.set(existingDestination.path, existingDestination);

  const content = "![[colliding.jpg]]\n\n![[clean.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(fx.renameCalls.length, 1);
  assert.equal(fx.renameCalls[0].from, "Mon Roman/_Feuillets/Ressources/Images/A/clean.jpg");
  assert.equal(fx.renameCalls[0].to, "Mon Roman/_Feuillets/Ressources/Images/B/clean.jpg");
});

test("33. the old directory is left empty, never deleted", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo.path, photo);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");

  const oldDir = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/A");
  assert.ok(oldDir instanceof TFolder, "old (now empty) mirror directory still exists");
  assert.deepEqual(oldDir.children, []);
});

test("34/35. uses app.fileManager.renameFile, never app.vault.rename", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo.path, photo);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");

  assert.equal(fx.renameCalls.length, 1);
  assert.deepEqual(fx.vaultRenameCalls, []);
});

test("36. no delete API is ever called by this feature", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo.path, photo);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  // vault.delete/fileManager.trashFile already throw in this fixture if called.
  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.equal(fx.renameCalls.length, 1);
});

test("37. moved image bytes/content are unchanged", async () => {
  const photo = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.jpg", "raw-bytes-marker");
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [photo]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(photo.path, photo);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.equal(photo.content, "raw-bytes-marker");
});

/* --- §19 filtering rules also exercised through the async orchestrator -- */

test("21. a remote image reference is ignored", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  const content = "![Remote](https://example.com/photo.jpg)";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);
  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.deepEqual(fx.renameCalls, []);
  assert.deepEqual(fx.createdFolders, []);
});

test("22. an unresolved image reference is ignored", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  const content = "![[does-not-exist.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);
  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.deepEqual(fx.renameCalls, []);
});

test("23. an image outside the old mirror directory (different mirror) is ignored", async () => {
  const elsewhere = makeFile("Mon Roman/_Feuillets/Ressources/Images/C/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A", "C"] });
  const imagesC = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/C");
  imagesC.children.push(elsewhere);
  fx.all.set(elsewhere.path, elsewhere);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.deepEqual(fx.renameCalls, []);
});

test("24. an image in a nested subdirectory of the old mirror is ignored (this lot only moves DIRECT children)", async () => {
  const nested = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/subfolder/photo.jpg");
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  const mirrorA = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/A");
  const subfolder = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A/subfolder", [nested]);
  mirrorA.children.push(subfolder);
  fx.all.set(subfolder.path, subfolder);
  fx.all.set(nested.path, nested);

  const content = "![[photo.jpg]]";
  addFolder(fx, "Mon Roman/Manuscrit/A", [makeFile("Mon Roman/Manuscrit/A/scene.md", content)]);
  addFolder(fx, "Mon Roman/Manuscrit/B");
  addFile(fx, "Mon Roman/Manuscrit/B/scene.md", content);

  await syncImageResourceFileAfterMove(fx.app, [fx.settings], "Mon Roman/Manuscrit/A/scene.md", "Mon Roman/Manuscrit/B/scene.md");
  assert.deepEqual(fx.renameCalls, []);
});
