import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  isDeclaredWorkspaceRoot, registerDeclaredWorkspaceRoot, unregisterDeclaredWorkspaceRoot,
  resolveDeclaredWorkspaceRoot, resolveFolderWorkspaceValue,
  isFolderWorkspaceConfigEmpty,
} from "../src/services/folder-workspaces.js";
import { registerOuvrage, unregisterOuvrage, isOuvrageRoot, resolveEditorialRoot } from "../src/services/editorial-roots.js";
import FeuilletsPlugin from "../src/main.js";

function fixture() {
  const root = new TFolder("TEXTES"); const warpi = new TFolder("TEXTES/WARPI");
  const nefes = new TFolder("TEXTES/WARPI/NEFES"); const part = new TFolder("TEXTES/WARPI/NEFES/Partie I");
  const scene = new TFile(`${part.path}/Scene.md`, "# Scene"); const direct = new TFile(`${warpi.path}/Direct.md`, "Text");
  const outside = new TFolder("TEXTES-other/WARPI");
  warpi.parent = root; nefes.parent = warpi; part.parent = nefes; scene.parent = part; direct.parent = warpi;
  root.children = [warpi]; warpi.children = [nefes, direct]; nefes.children = [part]; part.children = [scene];
  const { vault } = createFakeVault([root, warpi, nefes, part, scene, direct, outside]);
  const settings = { projectFolder: root.path, projectMeta: {} };
  return { app: { vault }, settings, root, warpi, nefes, part, scene, direct, outside };
}

test("declared workspace: registration creates only the exact marker and is idempotent", () => {
  const f = fixture();
  assert.equal(registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi), true);
  assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces, { WARPI: { version: 1, workspaceRoot: true } });
  const before = structuredClone(f.settings);
  assert.equal(registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi), false); assert.deepEqual(f.settings, before);
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.warpi), true);
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.nefes), false);
  assert.equal(registerDeclaredWorkspaceRoot(f.settings, f.root, f.root), false);
  assert.equal(registerDeclaredWorkspaceRoot(f.settings, f.root, f.outside), false);
});

test("declared workspace: unregister removes only the exact marker and preserves neighboring declarations", () => {
  const f = fixture(); registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi); registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  assert.equal(unregisterDeclaredWorkspaceRoot(f.settings, f.root, f.nefes), true);
  assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces, { WARPI: { version: 1, workspaceRoot: true } });
  const before = structuredClone(f.settings);
  assert.equal(unregisterDeclaredWorkspaceRoot(f.settings, f.root, f.nefes), false); assert.deepEqual(f.settings, before);
  assert.equal(unregisterDeclaredWorkspaceRoot(f.settings, f.root, f.warpi), true);
  assert.equal(f.settings.projectMeta.TEXTES.folderWorkspaces, undefined);
});

test("declared workspace: adding and removing identity preserves every existing override and ouvrage", () => {
  const f = fixture(); const original = { version: 1, ouvrage: { version: 1 }, preset: "fiction", wordGoal: 5000,
    citekeyBibliographyPath: "references.bib", liveJustify: false, favoriteTags: ["history"] };
  f.settings.projectMeta.TEXTES = { folderWorkspaces: { WARPI: structuredClone(original) } };
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi);
  assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces.WARPI, { ...original, workspaceRoot: true });
  unregisterDeclaredWorkspaceRoot(f.settings, f.root, f.warpi);
  assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces.WARPI, original);
});

for (const workspace of [false, true]) for (const ouvrage of [false, true]) {
  test(`declared workspace: workspace=${workspace}, ouvrage=${ouvrage} are independent identities`, () => {
    const f = fixture();
    if (workspace) registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
    if (ouvrage) registerOuvrage(f.settings, f.root, f.nefes);
    assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.nefes), workspace);
    assert.equal(isOuvrageRoot(f.app, f.settings, f.root, f.nefes), ouvrage);
    if (workspace && ouvrage) {
      unregisterOuvrage(f.settings, f.root, f.nefes);
      assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces["WARPI/NEFES"], { version: 1, workspaceRoot: true });
      registerOuvrage(f.settings, f.root, f.nefes); unregisterDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
      assert.deepEqual(f.settings.projectMeta.TEXTES.folderWorkspaces["WARPI/NEFES"], { version: 1, ouvrage: { version: 1 } });
    }
  });
}

test("declared workspace: nested resolution picks the deepest declaration and ignores isolation", () => {
  const f = fixture(); registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi); registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  f.settings.workspaceFolderPath = f.outside.path;
  const before = structuredClone(f.settings);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.scene), f.nefes);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.nefes), f.nefes);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.direct), f.warpi);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.outside), null);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.root), null);
  assert.deepEqual(f.settings, before);
});

test("declared workspace: ordinary override configs and ouvrage alone never declare or migrate a workspace", () => {
  const f = fixture(); f.settings.projectMeta.TEXTES = { folderWorkspaces: {
    WARPI: { version: 1, wordGoal: 2000, citekeyBibliographyPath: "chapitre.bib" },
    "WARPI/NEFES": { version: 1, ouvrage: { version: 1 } },
  } };
  const before = structuredClone(f.settings);
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.warpi), false);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.scene), null);
  assert.deepEqual(f.settings, before);
  f.settings.projectMeta.TEXTES.folderWorkspaces.WARPI.workspaceRoot = false;
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.warpi), false);
});

test("declared workspace: missing folders and stale declarations are ignored", async () => {
  const f = fixture(); registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  await f.app.vault.delete(f.nefes);
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.nefes), false);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.scene), null);
});

test("declared workspace: identity-only child still inherits preset and other fields from its parent", () => {
  const f = fixture(); f.settings.projectMeta.TEXTES = { folderWorkspaces: { WARPI: { version: 1, preset: "nonfiction", wordGoal: 2000 } } };
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  const meta = f.settings.projectMeta.TEXTES;
  assert.deepEqual(resolveFolderWorkspaceValue(meta, f.root.path, f.nefes.path, "preset", "free"), { value: "nonfiction", source: "WARPI" });
  assert.equal(resolveFolderWorkspaceValue(meta, f.root.path, f.nefes.path, "wordGoal", 1000).value, 2000);
});

test("declared workspace: persistent identity never changes editorial-root resolution", () => {
  const f = fixture(); registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi);
  assert.equal(resolveEditorialRoot(f.app, f.settings, f.root, f.direct), f.root);
  registerOuvrage(f.settings, f.root, f.nefes);
  assert.equal(resolveEditorialRoot(f.app, f.settings, f.root, f.scene), f.nefes);
  assert.equal(resolveDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.scene), f.warpi);
});

test("declared workspace: registration never activates a folder or calls the isolation setter", (t) => {
  const f = fixture(); const plugin = { settings: f.settings, workspaceFolderPath: f.nefes.path };
  const setter = t.mock.method(FeuilletsPlugin.prototype, "setWorkspaceFolder", async () => {});
  registerDeclaredWorkspaceRoot(plugin.settings, f.root, f.warpi);
  assert.equal(plugin.workspaceFolderPath, f.nefes.path); assert.equal(setter.mock.callCount(), 0);
});

test("declared workspace: both identities and local settings survive actual plugin save/load", async () => {
  const f = fixture();
  f.settings.projectMeta.TEXTES = { folderWorkspaces: { WARPI: {
    version: 1, preset: "fiction", wordGoal: 2300,
    ouvrage: { version: 1, composition: { outputBasename: "My work" } },
  } } };
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi);
  const expected = structuredClone(f.settings.projectMeta.TEXTES.folderWorkspaces);
  let persisted;
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = f.app;
  plugin.settings = f.settings;
  plugin.workspaceFolderPath = f.nefes.path;
  plugin.saveData = async (value) => { persisted = JSON.stringify(value); };
  await plugin.saveSettings();
  const reloaded = Object.create(FeuilletsPlugin.prototype);
  reloaded.app = f.app;
  reloaded.loadData = async () => JSON.parse(persisted);
  reloaded.saveData = plugin.saveData;
  await reloaded.loadSettings();
  assert.deepEqual(reloaded.settings.projectMeta.TEXTES.folderWorkspaces, expected);
  assert.equal(isDeclaredWorkspaceRoot(f.app, reloaded.settings, f.root, f.warpi), true);
  assert.equal(isOuvrageRoot(f.app, reloaded.settings, f.root, f.warpi), true);
  assert.equal(plugin.getWorkspaceFolder(), f.nefes);
  assert.equal(reloaded.getWorkspaceFolder(), null);
  unregisterDeclaredWorkspaceRoot(reloaded.settings, f.root, f.warpi);
  await reloaded.saveSettings();
  const next = Object.create(FeuilletsPlugin.prototype);
  next.app = f.app; next.loadData = reloaded.loadData; next.saveData = plugin.saveData;
  await next.loadSettings();
  assert.equal(isDeclaredWorkspaceRoot(f.app, next.settings, f.root, f.warpi), false);
  assert.equal(isOuvrageRoot(f.app, next.settings, f.root, f.warpi), true);
  assert.equal(next.settings.projectMeta.TEXTES.folderWorkspaces.WARPI.wordGoal, 2300);
  assert.deepEqual(Buffer.from(await f.app.vault.read(f.scene)), Buffer.from("# Scene"));
});

test("declared workspace: each identity keeps its configuration nonempty", () => {
  assert.equal(isFolderWorkspaceConfigEmpty({ version: 1 }), true);
  for (const identity of [{ workspaceRoot: true }, { ouvrage: { version: 1 } }, { workspaceRoot: true, ouvrage: { version: 1 } }]) {
    assert.equal(isFolderWorkspaceConfigEmpty({ version: 1, ...identity }), false);
  }
});
