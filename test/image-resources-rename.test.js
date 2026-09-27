import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  resolveImageResourceFolderRename,
  syncImageResourceFolderAfterRename,
  syncImageResourceFileAfterMove,
} from "../src/services/image-resources.js";

/*
 * Image-mirror folder rename/move synchronization (Lot 2): when a content
 * folder inside a manuscript is renamed or moved, its mirrored Images
 * folder (if any) follows it. Same small in-memory-vault fixture style as
 * image-resources.test.js (structuredFrenchProject/freeFolderProject),
 * extended with `vault.createFolder` (already needed there too) and a
 * `fileManager.renameFile` spy that actually mutates the fixture's tree —
 * so a test can assert both "renameFile was called" (§18: never
 * `vault.rename`) and the resulting tree shape.
 */

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
    // Never legitimately called by this feature (§9/§18) — a spy that
    // fails the test instantly if it is, rather than silently succeeding.
    async rename() {
      vaultRenameCalls.push(true);
      throw new Error("vault.rename must never be called by the image-mirror rename feature");
    },
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
  };

  return { app: { vault, fileManager }, all, createdFolders, renameCalls, vaultRenameCalls };
}

/** Structured project, mirroring image-resources.test.js's own
 * structuredFrenchProject: `<rootName>/Manuscrit/...` content, with the
 * Images mirror pre-populated at `imagesChildren`'s given relative paths
 * (each entry becomes an existing TFolder under Images). */
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

/** Free/adopted project, mirroring image-resources.test.js's own
 * freeFolderProject: `<rootName>/...` content directly, `_Feuillets` a
 * sibling inside the SAME adopted root. */
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

function addFile(fx, path) {
  const file = makeFile(path);
  const parent = fx.app.vault.getAbstractFileByPath(path.slice(0, path.lastIndexOf("/")));
  parent.children.push(file);
  file.parent = parent;
  fx.all.set(path, file);
  return file;
}

/* --- §16: pure path resolution ----------------------------------------- */

test("1. structured project: Manuscrit/A -> Manuscrit/B resolves Images/A -> Images/B", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  assert.ok(plan);
  assert.equal(plan.oldMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/A");
  assert.equal(plan.newMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/B");
  assert.equal(plan.root.path, "Mon Roman/Manuscrit");
});

test("2. structured nested move: Manuscrit/Partie I/Chapitre -> Manuscrit/Partie II/Chapitre", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Partie I", [makeFolder("Mon Roman/Manuscrit/Partie I/Chapitre")]);
  addFolder(fx, "Mon Roman/Manuscrit/Partie II");
  addFolder(fx, "Mon Roman/Manuscrit/Partie II/Chapitre");
  const plan = resolveImageResourceFolderRename(
    fx.app, [fx.settings],
    "Mon Roman/Manuscrit/Partie I/Chapitre",
    "Mon Roman/Manuscrit/Partie II/Chapitre"
  );
  assert.ok(plan);
  assert.equal(plan.oldMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/Partie I/Chapitre");
  assert.equal(plan.newMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/Partie II/Chapitre");
});

test("3. free project: ROOT/EDG/IDENTITÉ -> ROOT/EDG/IDENTITE", () => {
  const fx = freeProject("TEXTES", { contentChildren: [makeFolder("TEXTES/EDG", [makeFolder("TEXTES/EDG/IDENTITÉ")])] });
  addFolder(fx, "TEXTES/EDG/IDENTITE");
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "TEXTES/EDG/IDENTITÉ", "TEXTES/EDG/IDENTITE");
  assert.ok(plan);
  assert.equal(plan.oldMirrorPath, "TEXTES/_Feuillets/Ressources/Images/EDG/IDENTITÉ");
  assert.equal(plan.newMirrorPath, "TEXTES/_Feuillets/Ressources/Images/EDG/IDENTITE");
});

test("4. folder directly below manuscript root resolves to a directly-below Images path", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Chapitre");
  addFolder(fx, "Mon Roman/Manuscrit/Chapitre renommé");
  const plan = resolveImageResourceFolderRename(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/Chapitre", "Mon Roman/Manuscrit/Chapitre renommé"
  );
  assert.equal(plan.oldMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/Chapitre");
  assert.equal(plan.newMirrorPath, "Mon Roman/_Feuillets/Ressources/Images/Chapitre renommé");
});

test("5. several levels deep", () => {
  const fx = freeProject("TEXTES", {
    contentChildren: [makeFolder("TEXTES/A", [makeFolder("TEXTES/A/B", [makeFolder("TEXTES/A/B/C")])])],
  });
  addFolder(fx, "TEXTES/A/B/D");
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "TEXTES/A/B/C", "TEXTES/A/B/D");
  assert.equal(plan.oldMirrorPath, "TEXTES/_Feuillets/Ressources/Images/A/B/C");
  assert.equal(plan.newMirrorPath, "TEXTES/_Feuillets/Ressources/Images/A/B/D");
});

test("6. a single TFile rename is rejected (newPath does not resolve to a TFolder)", () => {
  const fx = structuredProject("Mon Roman");
  addFile(fx, "Mon Roman/Manuscrit/old.md");
  addFile(fx, "Mon Roman/Manuscrit/new.md");
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/old.md", "Mon Roman/Manuscrit/new.md");
  assert.equal(plan, null);
});

test("7. source under _Feuillets is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Dest");
  const plan = resolveImageResourceFolderRename(
    fx.app, [fx.settings], "Mon Roman/_Feuillets/Ressources/Images/Something", "Mon Roman/Manuscrit/Dest"
  );
  assert.equal(plan, null);
});

test("8. destination under _Feuillets is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Src");
  addFolder(fx, "Mon Roman/_Feuillets/Ressources/Images/Somewhere");
  const plan = resolveImageResourceFolderRename(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/Src", "Mon Roman/_Feuillets/Ressources/Images/Somewhere"
  );
  assert.equal(plan, null);
});

test("8b. _Feuillets itself moving (its own rename event) is rejected — no recursion", () => {
  const fx = freeProject("TEXTES");
  // Simulate _Feuillets itself having just moved to a new name; the new
  // path must already resolve to a TFolder for the resolver to consider it.
  fx.feuillets.path = "TEXTES/_Feuillets renamed";
  fx.all.delete("TEXTES/_Feuillets");
  fx.all.set("TEXTES/_Feuillets renamed", fx.feuillets);
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "TEXTES/_Feuillets", "TEXTES/_Feuillets renamed");
  assert.equal(plan, null);
});

test("9. the manuscript root itself is rejected (project-root rename is out of scope)", () => {
  const fx = structuredProject("Mon Roman");
  const other = addFolder(fx, "Mon Roman/ManuscritRenamed");
  void other;
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "Mon Roman/Manuscrit", "Mon Roman/ManuscritRenamed");
  assert.equal(plan, null);
});

test("10. old path outside every known project is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Dest");
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "Outside/Src", "Mon Roman/Manuscrit/Dest");
  assert.equal(plan, null);
});

test("11. new path outside every known project is rejected", () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/Src");
  // "Outside" must resolve to a TFolder for the resolver's TFolder gate.
  const outsideRoot = makeFolder("Outside", [makeFolder("Outside/Dest")]);
  fx.all.set(outsideRoot.path, outsideRoot);
  fx.all.set("Outside/Dest", outsideRoot.children[0]);
  const plan = resolveImageResourceFolderRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/Src", "Outside/Dest");
  assert.equal(plan, null);
});

test("12. move between two different projects is rejected", () => {
  const fxA = structuredProject("Project A");
  const fxB = structuredProject("Project B");
  addFolder(fxA, "Project A/Manuscrit/Src");
  const destFolder = addFolder(fxB, "Project B/Manuscrit/Src");
  // A single real Vault resolves paths from either project; merge both
  // fixtures' lookup maps into one shared `getAbstractFileByPath`.
  const combined = new Map([...fxA.all, ...fxB.all]);
  const app = { vault: { getAbstractFileByPath: (p) => combined.get(p) || null }, fileManager: fxA.app.fileManager };
  const plan = resolveImageResourceFolderRename(
    app, [fxA.settings, fxB.settings], "Project A/Manuscrit/Src", destFolder.path
  );
  assert.equal(plan, null);
});

test("13. nested/overlapping known projects: the most specific (longest) owning root wins, only once", () => {
  // "Big/Manuscrit" is one known project; "Big/Manuscrit/Sub" (itself named
  // "Manuscrit", an adopted sub-project) is ANOTHER known, nested project.
  const inner = makeFolder("Big/Manuscrit/Sub/Manuscrit", [
    makeFolder("Big/Manuscrit/Sub/Manuscrit/Chapitre"),
  ]);
  const sub = makeFolder("Big/Manuscrit/Sub", [inner]);
  const outerManuscrit = makeFolder("Big/Manuscrit", [sub]);
  const root = makeFolder("Big", [outerManuscrit]);
  const { app, ...spies } = makeApp([root]);
  addFolder({ app, all: spies.all }, "Big/Manuscrit/Sub/Manuscrit/ChapitreRenomme");

  const outerSettings = { projectFolder: outerManuscrit.path };
  const innerSettings = { projectFolder: inner.path };
  const plan = resolveImageResourceFolderRename(
    app, [outerSettings, innerSettings],
    "Big/Manuscrit/Sub/Manuscrit/Chapitre", "Big/Manuscrit/Sub/Manuscrit/ChapitreRenomme"
  );
  assert.ok(plan);
  assert.equal(plan.root.path, inner.path, "the more specific (longer) root wins, not the outer one");
});

/* --- §17: filesystem behavior ------------------------------------------- */

test("14. old mirror absent: no folder created, no rename call", async () => {
  const fx = structuredProject("Mon Roman");
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  assert.deepEqual(fx.createdFolders, []);
  assert.deepEqual(fx.renameCalls, []);
});

test("15. old mirror exists / destination absent: destination parent ensured, old mirror renamed exactly once", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["Partie I/Chapitre A"] });
  addFolder(fx, "Mon Roman/Manuscrit/Partie I", [makeFolder("Mon Roman/Manuscrit/Partie I/Chapitre A")]);
  // The content folder has ALREADY been renamed/moved by Obsidian by the
  // time this Vault "rename" event fires — its new location must already
  // exist as a TFolder.
  addFolder(fx, "Mon Roman/Manuscrit/Partie II", [makeFolder("Mon Roman/Manuscrit/Partie II/Chapitre A")]);
  await syncImageResourceFolderAfterRename(
    fx.app, [fx.settings],
    "Mon Roman/Manuscrit/Partie I/Chapitre A", "Mon Roman/Manuscrit/Partie II/Chapitre A"
  );
  assert.equal(fx.renameCalls.length, 1);
  assert.equal(fx.renameCalls[0].from, "Mon Roman/_Feuillets/Ressources/Images/Partie I/Chapitre A");
  assert.equal(fx.renameCalls[0].to, "Mon Roman/_Feuillets/Ressources/Images/Partie II/Chapitre A");
  const moved = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/Partie II/Chapitre A");
  assert.ok(moved instanceof TFolder);
  assert.equal(fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/Partie I/Chapitre A"), null);
});

test("16. nested destination parent absent: required parents are created, then the mirror moves", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  addFolder(fx, "Mon Roman/Manuscrit/A");
  // "B/C" already existed; "B/C/A" is the content folder's new (post-move)
  // location, already a TFolder by the time this Vault event fires.
  addFolder(fx, "Mon Roman/Manuscrit/B", [makeFolder("Mon Roman/Manuscrit/B/C")]);
  addFolder(fx, "Mon Roman/Manuscrit/B/C/A");
  await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B/C/A");
  assert.deepEqual(fx.createdFolders, [
    "Mon Roman/_Feuillets/Ressources/Images/B",
    "Mon Roman/_Feuillets/Ressources/Images/B/C",
  ]);
  assert.equal(fx.renameCalls.length, 1);
  assert.equal(fx.renameCalls[0].to, "Mon Roman/_Feuillets/Ressources/Images/B/C/A");
  assert.ok(fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/B/C/A") instanceof TFolder);
});

test("17. destination exact path already exists: no overwrite, no move, old mirror remains, warning emitted", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A", "B"] });
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(fx.renameCalls, []);
  assert.deepEqual(fx.createdFolders, []);
  assert.ok(fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/A") instanceof TFolder, "old mirror untouched");
  assert.ok(fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images/B") instanceof TFolder, "destination untouched");
  assert.equal(warnings.length, 1);
});

test("18. _Feuillets itself moving never triggers a mirror operation (no recursion)", async () => {
  const fx = freeProject("TEXTES", { imagesChildren: ["A"] });
  fx.feuillets.path = "TEXTES/_Feuillets renamed";
  fx.all.delete("TEXTES/_Feuillets");
  fx.all.set("TEXTES/_Feuillets renamed", fx.feuillets);
  await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "TEXTES/_Feuillets", "TEXTES/_Feuillets renamed");
  assert.deepEqual(fx.renameCalls, []);
  assert.deepEqual(fx.createdFolders, []);
});

test("19. inactive known project: the mirror still follows the rename", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  // "Active" project is something else entirely; "Mon Roman" is only in the
  // known-but-inactive list — exactly what knownProjectContexts() would hand
  // this feature for a project that is not the currently active one.
  const inactiveOnly = [fx.settings];
  await syncImageResourceFolderAfterRename(fx.app, inactiveOnly, "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  assert.equal(fx.renameCalls.length, 1);
});

test("20. one Vault rename produces at most one project mirror operation", async () => {
  const inner = makeFolder("Big/Manuscrit/Sub/Manuscrit", [makeFolder("Big/Manuscrit/Sub/Manuscrit/A")]);
  const sub = makeFolder("Big/Manuscrit/Sub", [inner]);
  const outerManuscrit = makeFolder("Big/Manuscrit", [sub]);
  const root = makeFolder("Big", [outerManuscrit]);
  const { app, ...spies } = makeApp([root]);
  const fx = { app, ...spies };
  addFolder(fx, "Big/Manuscrit/Sub/Manuscrit/B");
  const outerSettings = { projectFolder: outerManuscrit.path };
  const innerSettings = { projectFolder: inner.path };
  await syncImageResourceFolderAfterRename(
    app, [outerSettings, innerSettings], "Big/Manuscrit/Sub/Manuscrit/A", "Big/Manuscrit/Sub/Manuscrit/B"
  );
  // No mirror existed for either root, so nothing to move — but critically,
  // only ONE plan is ever computed/acted on (verified directly in the pure
  // resolver test above); this integration test locks the same invariant
  // through the full async orchestrator.
  assert.deepEqual(fx.renameCalls, []);
});

test("21. image files remain byte-for-byte untouched by a normal whole-folder move", async () => {
  const image = makeFile("Mon Roman/_Feuillets/Ressources/Images/A/photo.png");
  image.content = "raw-bytes-marker";
  const fx = structuredProject("Mon Roman", { imagesChildren: [] });
  const imagesFolder = fx.app.vault.getAbstractFileByPath("Mon Roman/_Feuillets/Ressources/Images");
  const mirrorA = makeFolder("Mon Roman/_Feuillets/Ressources/Images/A", [image]);
  imagesFolder.children.push(mirrorA);
  fx.all.set(mirrorA.path, mirrorA);
  fx.all.set(image.path, image);
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  assert.equal(fx.renameCalls.length, 1, "the whole folder moves as ONE operation, never per-file");
  assert.equal(image.content, "raw-bytes-marker", "never rewritten");
});

test("22. no delete API is ever called by this feature", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A", "B"] });
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  fx.app.vault.delete = () => { throw new Error("vault.delete must never be called by this feature"); };
  fx.app.fileManager.trashFile = () => { throw new Error("trashFile must never be called by this feature"); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  } finally {
    console.warn = originalWarn;
  }
});

/* --- §18: link-safety regression — fileManager.renameFile, never vault.rename --- */

test("uses app.fileManager.renameFile for the mirror move, never app.vault.rename", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["A"] });
  addFolder(fx, "Mon Roman/Manuscrit/A");
  addFolder(fx, "Mon Roman/Manuscrit/B");
  await syncImageResourceFolderAfterRename(fx.app, [fx.settings], "Mon Roman/Manuscrit/A", "Mon Roman/Manuscrit/B");
  assert.equal(fx.renameCalls.length, 1);
  assert.deepEqual(fx.vaultRenameCalls, []);
});

/* --- §23 (Lot 3 task): folder-move regression — the single-file-move sync
 * must never additionally act on a whole-folder rename/move event. -------- */

test("whole-folder move regression: the mirror folder still moves as ONE operation, and the file-move sync never additionally fires for the same event", async () => {
  const fx = structuredProject("Mon Roman", { imagesChildren: ["Test Folder A"] });
  addFolder(fx, "Mon Roman/Manuscrit/Test Folder A", [makeFile("Mon Roman/Manuscrit/Test Folder A/scene.md")]);
  addFolder(fx, "Mon Roman/Manuscrit/Test Folder B", [makeFile("Mon Roman/Manuscrit/Test Folder B/scene.md")]);

  // main.ts's centralized rename handler calls BOTH sync functions,
  // additively, for every Vault "rename" event — including a whole-folder
  // move like this one.
  await syncImageResourceFolderAfterRename(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/Test Folder A", "Mon Roman/Manuscrit/Test Folder B"
  );
  await syncImageResourceFileAfterMove(
    fx.app, [fx.settings], "Mon Roman/Manuscrit/Test Folder A", "Mon Roman/Manuscrit/Test Folder B"
  );

  // Exactly one operation: the whole mirror folder moved once. The
  // file-move sync is a no-op here (its own newPath resolves to a TFolder,
  // never a Markdown TFile), so it never attempts to move anything itself
  // — no duplicate operation, no collision warning against itself.
  assert.equal(fx.renameCalls.length, 1);
  assert.equal(fx.renameCalls[0].from, "Mon Roman/_Feuillets/Ressources/Images/Test Folder A");
  assert.equal(fx.renameCalls[0].to, "Mon Roman/_Feuillets/Ressources/Images/Test Folder B");
});
