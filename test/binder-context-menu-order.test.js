import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/views/base-feuillets-view.ts"), "utf8");
const binderSource = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");

function methodBody(sourceText, signature, nextSignature) {
  const start = sourceText.indexOf(signature);
  const end = sourceText.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `${signature} must exist`);
  assert.notEqual(end, -1, `${nextSignature} must exist`);
  return sourceText.slice(start, end);
}

function assertOrder(body, markers) {
  let previous = -1;
  for (const marker of markers) {
    const position = body.indexOf(marker);
    assert.notEqual(position, -1, `missing menu marker: ${marker}`);
    assert.ok(position > previous, `${marker} must follow the previous menu item`);
    previous = position;
  }
}

test("Binder file context menu keeps the requested functional order", () => {
  const body = methodBody(source, "showFileContextMenu(", "showFolderContextMenu(");
  assertOrder(body, [
    't("shared.openNewTab")',
    't("shared.contextMenu.openWithPreview")',
    't("binder.research.openSplit")',
    't("binder.research.compareWith")',
    't("shared.contextMenu.addToNotebook")',
    't("shared.contextMenu.newSheetMenu")',
    't("shared.contextMenu.changeStatusMenu")',
    't("shared.contextMenu.changeLabelMenu")',
    't("binder.research.associatedResearchMenu")',
    't("shared.contextMenu.rename")',
    't("shared.contextMenu.move")',
    't("shared.duplicate")',
    '"Versions…"',
    't("binder.compileFile")',
    't("shared.trash")',
  ]);
  assert.match(body, /promptRenameBinderFile\(file\)/);
  assert.match(body, /addFileToNotebook\(file\)/);
  assert.match(body, /moveSceneFile\(file\)/);
});

test("Binder folder context menu keeps workspace, metadata and destructive groups ordered", () => {
  const body = methodBody(source, "showFolderContextMenu(", "constructor(leaf");
  assertOrder(body, [
    't("shared.contextMenu.openWithPreview")',
    'extraItems?.(menu)',
    'this.addFolderCarnetMenuItem(menu, folder)',
    't("shared.contextMenu.openFolderNote")',
    't("shared.contextMenu.newMenu")',
    't("shared.contextMenu.changeStatusMenu")',
    't("shared.contextMenu.changeLabelMenu")',
    't("binder.research.associatedResearchMenu")',
    't("shared.contextMenu.renameFolder")',
    't("shared.contextMenu.organizationMenu")',
    't("shared.contextMenu.compilationMenu")',
    't("shared.contextMenu.trashFolder")',
  ]);
  assert.match(body, /promptRenameBinderFolder\(folder\)/);
  assert.match(binderSource, /this\.continuExtras\(child\)\(menu\);\s*menu\.addSeparator\(\);\s*this\.binderIsolateExtras\(child\)\(menu\)/s);
});

test("Binder menu labels use the normalized compilation and trash vocabulary", () => {
  const fr = readFileSync(resolve(process.cwd(), "src/i18n/fr.ts"), "utf8");
  const en = readFileSync(resolve(process.cwd(), "src/i18n/en.ts"), "utf8");
  assert.match(fr, /"binder\.compileFile": "Compiler ce feuillet…"/);
  assert.match(en, /"binder\.compileFile": "Compile this sheet…"/);
  assert.match(fr, /"shared\.contextMenu\.trashFolder": "Mettre à la corbeille"/);
  assert.match(en, /"shared\.contextMenu\.trashFolder": "Move to trash"/);
  assert.match(fr, /"binder\.defineAsOuvrage": "Définir comme ouvrage"/);
  assert.match(en, /"binder\.defineAsOuvrage": "Define as work"/);
  assert.match(fr, /"binder\.removeOuvrageStatus": "Retirer le statut d’ouvrage"/);
  assert.match(en, /"binder\.removeOuvrageStatus": "Remove work status"/);
});

test("Binder folder context menu : entrées ouvrage, ordre et exclusions sur vrai menu", async () => {
  const { Menu, TFolder } = await import("obsidian");
  const { FeuilletsView } = await import("../src/views/feuillets-view.js");
  const { t } = await import("../src/i18n/index.js");

  const root = new TFolder("WARPI");
  const tome1 = new TFolder("WARPI/Tome 1");
  const nefes = new TFolder("WARPI/NEFES");
  const front = new TFolder("WARPI/Front");
  const frontSection = new TFolder("WARPI/Front/Dédicace");
  const hiddenFolder = new TFolder("WARPI/_Feuillets");

  tome1.parent = root;
  nefes.parent = root;
  front.parent = root;
  frontSection.parent = front;
  hiddenFolder.parent = root;
  root.children = [tome1, nefes, front, hiddenFolder];
  front.children = [frontSection];

  const allFiles = new Map([
    ["WARPI", root],
    ["WARPI/Tome 1", tome1],
    ["WARPI/NEFES", nefes],
    ["WARPI/Front", front],
    ["WARPI/Front/Dédicace", frontSection],
    ["WARPI/_Feuillets", hiddenFolder],
  ]);

  const settings = {
    projectFolder: "WARPI",
    level1Role: "parties",
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
        },
      },
    },
  };

  let saved = false;
  const existingLeaf = {
    setViewState: async () => {},
    view: { openScope: async () => {} },
  };
  const app = {
    workspace: {
      getLeaf: () => existingLeaf,
      getLeavesOfType: () => [existingLeaf],
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
    vault: {
      getAbstractFileByPath: (p) => allFiles.get(p) || null,
      read: async () => "",
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => { saved = true; },
    fmOf: () => ({}),
    labelOf: () => "",
    labelsOf: () => [],
    titleFor: (f) => f.basename,
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
    getOrderedChildren: (folder) => folder?.children || [],
  };

  class TestBinderView extends FeuilletsView {
    constructor() {
      super({ app, contentEl: null });
      this.app = app;
      this.plugin = plugin;
      this.rendered = 0;
    }
    async render() { this.rendered++; }
  }

  const view = new TestBinderView();

  const makeBinderExtras = (folder) => (menu) => {
    view.continuExtras(folder)(menu);
    menu.addSeparator();
    view.binderIsolateExtras(folder)(menu);
    view.binderOuvrageExtras(folder)(menu);
    view.folderWorkspaceExtras(folder)(menu);
  };

  // 1. Un dossier ordinaire descendant propose « Définir comme ouvrage »
  // et est placé après l'isolation et avant la configuration d'espace de travail
  view.showFolderContextMenu({ preventDefault() {} }, tome1, root, 0, [tome1], makeBinderExtras(tome1));
  const menuTome1 = Menu.lastShown;
  const defineEntry = menuTome1.items.find((i) => i.title === t("binder.defineAsOuvrage"));
  assert.ok(defineEntry, "un dossier ordinaire descendant propose « Définir comme ouvrage »");
  assert.equal(defineEntry.icon, "book-open-check");
  assert.equal(menuTome1.items.some((i) => i.title === t("binder.removeOuvrageStatus")), false);

  const iIsolate1 = menuTome1.items.findIndex((i) => i.title === t("binder.isolateFolder"));
  const iOuvrage1 = menuTome1.items.findIndex((i) => i.title === t("binder.defineAsOuvrage"));
  const iWorkspace1 = menuTome1.items.findIndex((i) => i.title === t("binder.configureWorkspace"));
  assert.ok(iIsolate1 !== -1, "Isoler ce dossier doit être présent");
  assert.ok(iOuvrage1 !== -1, "Définir comme ouvrage doit être présent");
  assert.ok(iWorkspace1 !== -1, "Configurer cet espace de travail doit être présent");
  assert.ok(iIsolate1 < iOuvrage1, "l'entrée ouvrage est placée après l'isolation");
  assert.ok(iOuvrage1 < iWorkspace1, "l'entrée ouvrage est placée avant la configuration d'espace de travail");

  // Au clic : enregistre l'ouvrage, sauvegarde et rafraîchit
  saved = false;
  view.rendered = 0;
  await defineEntry.callback();
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots["Tome 1"], { version: 1 });
  assert.equal(saved, true);
  assert.equal(view.rendered, 1);

  // 2. Un dossier enregistré propose « Retirer le statut d’ouvrage »
  view.showFolderContextMenu({ preventDefault() {} }, nefes, root, 1, [tome1, nefes], makeBinderExtras(nefes));
  const menuNefes = Menu.lastShown;
  const removeEntry = menuNefes.items.find((i) => i.title === t("binder.removeOuvrageStatus"));
  assert.ok(removeEntry, "un dossier enregistré propose « Retirer le statut d’ouvrage »");
  assert.equal(removeEntry.icon, "book-open");
  assert.equal(menuNefes.items.some((i) => i.title === t("binder.defineAsOuvrage")), false);

  const iIsolate2 = menuNefes.items.findIndex((i) => i.title === t("binder.isolateFolder"));
  const iOuvrage2 = menuNefes.items.findIndex((i) => i.title === t("binder.removeOuvrageStatus"));
  const iWorkspace2 = menuNefes.items.findIndex((i) => i.title === t("binder.configureWorkspace"));
  assert.ok(iIsolate2 < iOuvrage2, "l'entrée ouvrage est placée après l'isolation");
  assert.ok(iOuvrage2 < iWorkspace2, "l'entrée ouvrage est placée avant la configuration d'espace de travail");

  // Au clic : désenregistre l'ouvrage, sauvegarde et rafraîchit
  saved = false;
  view.rendered = 0;
  await removeEntry.callback();
  assert.equal("NEFES" in settings.projectMeta["WARPI"].ouvrageRoots, false);
  assert.equal(saved, true);
  assert.equal(view.rendered, 1);

  // 3. La racine globale et Front ne proposent aucune de ces entrées
  // Sur Front
  view.showFolderContextMenu({ preventDefault() {} }, front, root, 2, [front], makeBinderExtras(front));
  const menuFront = Menu.lastShown;
  assert.equal(menuFront.items.some((i) => i.title === t("binder.defineAsOuvrage")), false);
  assert.equal(menuFront.items.some((i) => i.title === t("binder.removeOuvrageStatus")), false);

  // Sur un descendant de Front
  view.showFolderContextMenu({ preventDefault() {} }, frontSection, front, 0, [frontSection], makeBinderExtras(frontSection));
  const menuFrontSection = Menu.lastShown;
  assert.equal(menuFrontSection.items.some((i) => i.title === t("binder.defineAsOuvrage")), false);
  assert.equal(menuFrontSection.items.some((i) => i.title === t("binder.removeOuvrageStatus")), false);

  // Sur la racine globale
  view.showFolderContextMenu({ preventDefault() {} }, root, root, 0, [root], makeBinderExtras(root));
  const menuRoot = Menu.lastShown;
  assert.equal(menuRoot.items.some((i) => i.title === t("binder.defineAsOuvrage")), false);
  assert.equal(menuRoot.items.some((i) => i.title === t("binder.removeOuvrageStatus")), false);

  // Sur un dossier commençant par _
  view.showFolderContextMenu({ preventDefault() {} }, hiddenFolder, root, 3, [hiddenFolder], makeBinderExtras(hiddenFolder));
  const menuHidden = Menu.lastShown;
  assert.equal(menuHidden.items.some((i) => i.title === t("binder.defineAsOuvrage")), false);
  assert.equal(menuHidden.items.some((i) => i.title === t("binder.removeOuvrageStatus")), false);
});
