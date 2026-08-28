import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createSheetFile } from "../src/services/project-files.js";
import { getOrderedChildren } from "../src/services/folder-structure.js";
import { shortTitleFor } from "../src/services/frontmatter.js";
import {
  readBinderSnapshot,
  binderFingerprint,
  buildBinderMutationPlan,
  applyBinderMutationPlan,
} from "../src/carnet/bridges/binder.js";
import { reconcilePlanAfterApply } from "../src/carnet/blocks/plan/plan.js";

/* Correctif Prompt 3 (Apply) — reproduit le VRAI chemin déclenché par le
 * bouton ✓ :
 *
 *   onApply → applyPlanToBinder → buildBinderMutationPlan →
 *   applyBinderMutationPlan → planBinderWriter → Vault → relecture Binder
 *   → reconcilePlanAfterApply
 *
 * `planBinderReader`/`planBinderWriter` sont reconstruits ICI avec les
 * MÊMES fonctions réelles que `main.ts` (createSheetFile, getOrderedChildren,
 * shortTitleFor, fileManager.renameFile/processFrontMatter) — jamais une
 * réimplémentation. Seul `writeOrder` est répliqué localement (il vit dans
 * la classe du plugin, pas exporté en fonction pure) — même schéma déjà
 * établi par `import-outline-modal.test.js` (`ideaTreeFixture`) : un
 * `Map` de frontmatter INDÉPENDANT de `file.content` mais persistant, pour
 * que `getOrderedChildren`/`shortTitleFor` reflètent fidèlement ce que
 * l'Apply vient d'écrire. */

function parseFrontmatterBlock(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  for (const line of (match?.[1] || "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    fm[key] = line.slice(idx + 1).trim();
  }
  return fm;
}

function makeBinderFixture() {
  const project = new TFolder("Manuscrit");
  const chapitre1 = new TFolder("Manuscrit/Chapitre 1");
  project.children = [chapitre1];
  chapitre1.parent = project;
  const { vault, fileManager } = createFakeVault([project, chapitre1]);
  const frontmatter = new Map();

  const originalCreate = vault.create.bind(vault);
  vault.create = async (path, content) => {
    const file = await originalCreate(path, content);
    frontmatter.set(file.path, parseFrontmatterBlock(content));
    return file;
  };
  const originalRename = fileManager.renameFile.bind(fileManager);
  fileManager.renameFile = async (file, newPath) => {
    const oldPath = file.path;
    await originalRename(file, newPath);
    if (frontmatter.has(oldPath)) {
      frontmatter.set(file.path, frontmatter.get(oldPath));
      frontmatter.delete(oldPath);
    }
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
  const settings = {
    projectFolder: project.path,
    projectMeta: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    wordGoal: 750,
  };

  // "ancien.md" — le seul feuillet déjà présent dans le Binder.
  const ancien = originalCreate("Manuscrit/Chapitre 1/ancien.md", "---\ntitle: Ancien\nshort_title: \norder: 1\n---\n");
  return { app, settings, project, chapitre1, vault, fileManager, frontmatter, ancienPromise: ancien };
}

/** Reproduit EXACTEMENT `planBinderReader()`/`planBinderWriter()`/
 * `writeOrder()` de `main.ts` — mêmes fonctions réelles, injectées. */
function makeReaderWriter(app, settings) {
  const folderAt = (path) => {
    const node = app.vault.getAbstractFileByPath(path);
    if (!(node instanceof TFolder)) throw new Error(`Folder not found: ${path}`);
    return node;
  };
  const reader = {
    getOrderedChildren: (folder) => getOrderedChildren(app, settings, folder),
    shortTitleFor: (file) => shortTitleFor(app, file),
  };
  const writeOrder = async (parent, names) => {
    const current = getOrderedChildren(app, settings, parent);
    const byName = new Map(current.map((c) => [c.name, c]));
    const ordered = [];
    for (const name of names) { const c = byName.get(name); if (c) { ordered.push(c); byName.delete(name); } }
    for (const c of byName.values()) ordered.push(c);
    settings.orders[parent.path] = ordered.map((c) => c.name);
    for (let i = 0; i < ordered.length; i += 1) {
      const child = ordered[i];
      if (child instanceof TFile) {
        await app.fileManager.processFrontMatter(child, (fm) => { fm.order = String(i + 1); });
      } else {
        settings.folderPositions[child.path] = i + 1;
      }
    }
  };
  const writer = {
    createFolder: async (path) => { await app.vault.createFolder(path); },
    createSheet: async (parentPath, fileName, title, position) => {
      const file = await createSheetFile(app, settings, folderAt(parentPath), fileName, title, position);
      return file.path;
    },
    renameFolder: async (from, to) => {
      const node = app.vault.getAbstractFileByPath(from);
      if (!(node instanceof TFolder)) throw new Error(`Folder not found: ${from}`);
      await app.fileManager.renameFile(node, to);
    },
    move: async (fromPath, toParentPath) => {
      const node = app.vault.getAbstractFileByPath(fromPath);
      if (!node) throw new Error(`Item not found: ${fromPath}`);
      const destination = folderAt(toParentPath);
      await app.fileManager.renameFile(node, `${destination.path}/${node.name}`);
    },
    setShortTitle: async (path, title) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`Sheet not found: ${path}`);
      await app.fileManager.processFrontMatter(file, (fm) => { fm.short_title = title; });
    },
    restoreShortTitle: async (path, previousTitle) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`Sheet not found: ${path}`);
      await app.fileManager.processFrontMatter(file, (fm) => {
        if (previousTitle === undefined) delete fm.short_title;
        else fm.short_title = previousTitle;
      });
    },
    writeOrder: async (parentPath, names) => { await writeOrder(folderAt(parentPath), names); },
    deleteCreated: async (path) => {
      const node = app.vault.getAbstractFileByPath(path);
      if (node) await app.fileManager.trashFile(node);
    },
  };
  return { reader, writer };
}

test("Apply Plan→Binder — création dossier+feuillet, ordre, relecture, reconciliation (chemin RÉEL)", async () => {
  const { app, settings, project, ancienPromise } = makeBinderFixture();
  const ancien = await ancienPromise;
  const { reader, writer } = makeReaderWriter(app, settings);

  // Snapshot initial et Plan dirty EXACTEMENT comme dans l'énoncé : la
  // ligne "Chapitre 1/ancien.md" inchangée, + un draft-folder racine
  // "Nouveau chapitre" contenant un draft-file "Nouveau feuillet".
  const snapshot = readBinderSnapshot(reader, project);
  const baseFingerprint = binderFingerprint(snapshot);
  const chapitre1Id = "chapitre-1-uuid";
  const ancienId = "ancien-uuid";
  const draftFolderId = "draft-folder-uuid";
  const draftFileId = "draft-file-uuid";
  const items = [
    {
      id: chapitre1Id, kind: "folder", title: "Chapitre 1", path: "Manuscrit/Chapitre 1", collapsed: false,
      children: [
        { id: ancienId, kind: "file", title: "Ancien", path: ancien.path, collapsed: false, children: [] },
      ],
    },
    {
      id: draftFolderId, kind: "draft-folder", title: "Nouveau chapitre", collapsed: false,
      children: [
        { id: draftFileId, kind: "draft-file", title: "Nouveau feuillet", collapsed: false, children: [] },
      ],
    },
  ];

  const preflight = buildBinderMutationPlan(items, snapshot, baseFingerprint);
  assert.equal(preflight.ok, true, preflight.ok ? "" : JSON.stringify(preflight.issues));
  if (!preflight.ok) return;

  const outcome = await applyBinderMutationPlan(preflight.plan, writer);
  assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.error} @ ${JSON.stringify(outcome.failedAt)}`);
  if (!outcome.ok) return;

  // Dossier créé.
  const createdFolder = app.vault.getAbstractFileByPath("Manuscrit/Nouveau chapitre");
  assert.ok(createdFolder instanceof TFolder, "le dossier « Nouveau chapitre » existe dans le vault");

  // Fichier Markdown créé dedans.
  const createdFile = app.vault.getAbstractFileByPath("Manuscrit/Nouveau chapitre/Nouveau feuillet.md");
  assert.ok(createdFile instanceof TFile, "le feuillet « Nouveau feuillet.md » existe dans le vault");

  // Ordre écrit à la racine du projet.
  const after = readBinderSnapshot(reader, project);
  assert.deepEqual(
    after.children.map((c) => c.path),
    ["Manuscrit/Chapitre 1", "Manuscrit/Nouveau chapitre"],
    "l'ordre relu suit exactement celui du Plan"
  );

  // Binder relu → reconciliation.
  const reconciled = reconcilePlanAfterApply(items, after, binderFingerprint(after), project.path);
  assert.equal(reconciled.dirty, false, "dirty=false après un Apply réussi");

  const [reconciledChapitre1, reconciledDraftFolder] = reconciled.items;
  // draft-folder → folder, draft-file → file.
  assert.equal(reconciledDraftFolder.kind, "folder", "draft-folder devient folder");
  assert.equal(reconciledDraftFolder.children[0].kind, "file", "draft-file devient file");
  // paths renseignés.
  assert.equal(reconciledDraftFolder.path, "Manuscrit/Nouveau chapitre");
  assert.equal(reconciledDraftFolder.children[0].path, "Manuscrit/Nouveau chapitre/Nouveau feuillet.md");
  // UUID conservés (identité stable, jamais régénérée par l'Apply).
  assert.equal(reconciledDraftFolder.id, draftFolderId);
  assert.equal(reconciledDraftFolder.children[0].id, draftFileId);
  assert.equal(reconciledChapitre1.id, chapitre1Id);
  assert.equal(reconciledChapitre1.children[0].id, ancienId);
  // L'item déjà réel n'a pas changé de nature.
  assert.equal(reconciledChapitre1.kind, "folder");
  assert.equal(reconciledChapitre1.children[0].kind, "file");
});
