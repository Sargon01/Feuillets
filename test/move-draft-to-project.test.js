import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TFile, TFolder, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { moveDraftToProjectFolder } from "../src/services/project-drafts.js";
import { resolveCompileScopeFiles } from "../src/services/compile-scope.js";
import { getOrderedChildren } from "../src/services/folder-structure.js";
import { MoveDraftToProjectModal } from "../src/ui/move-draft-modal.js";
import { t } from "../src/i18n/index.js";

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function baseSettings(overrides = {}) {
  return {
    orders: {},
    folderPositions: {},
    compileFileName: undefined,
    projectFolder: "",
    projects: [],
    ...overrides,
  };
}

const DRAFT_CONTENT =
  "---\nstatus: Brouillon\ntags:\n  - idée\n  - à trier\n---\n\nPremière ligne.\n\nDeuxième paragraphe avec des « guillemets ».\n";

/** Deux projets structurés distincts : Projet A (source, avec un brouillon
 * dans _Feuillets/Drafts) et Projet B (cible, avec un sous-dossier réel et
 * un dossier technique "_Feuillets" qui ne doit jamais être proposé comme
 * destination). */
function buildFixture(draftName = "Idée.md") {
  const volumeA = folder("ProjetA");
  const manuscriptA = folder("ProjetA/Manuscrit");
  const auxA = folder("ProjetA/_Feuillets");
  const draftsA = folder("ProjetA/_Feuillets/Drafts");
  const draft = new TFile(`ProjetA/_Feuillets/Drafts/${draftName}`, DRAFT_CONTENT);
  manuscriptA.parent = volumeA;
  auxA.parent = volumeA;
  draftsA.parent = auxA;
  draft.parent = draftsA;
  volumeA.children = [manuscriptA, auxA];
  auxA.children = [draftsA];
  draftsA.children = [draft];

  const volumeB = folder("ProjetB");
  const manuscriptB = folder("ProjetB/Manuscrit");
  const chapterB = folder("ProjetB/Manuscrit/Chapitre 1");
  const auxB = folder("ProjetB/_Feuillets");
  const sceneB = new TFile("ProjetB/Manuscrit/Chapitre 1/Scene.md", "---\ntitle: Scene\n---\n\nTexte.\n");
  volumeB.children = [manuscriptB, auxB];
  manuscriptB.parent = volumeB;
  auxB.parent = volumeB;
  manuscriptB.children = [chapterB];
  chapterB.parent = manuscriptB;
  chapterB.children = [sceneB];
  sceneB.parent = chapterB;

  const entries = [volumeA, manuscriptA, auxA, draftsA, draft, volumeB, manuscriptB, chapterB, auxB, sceneB];
  const { vault, fileManager } = createFakeVault(entries);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => null } };
  const settings = baseSettings({ projectFolder: manuscriptA.path, projects: [manuscriptB.path] });
  return { app, settings, draft, manuscriptA, manuscriptB, chapterB, auxB, draftsA, sceneB };
}

test("moveDraftToProjectFolder : déplace vers la racine du projet cible", async () => {
  const { app, settings, draft, manuscriptB } = buildFixture();
  const moved = await moveDraftToProjectFolder(app, settings, draft, manuscriptB.path);
  assert.ok(moved);
  assert.equal(moved.path, "ProjetB/Manuscrit/Idée.md");
  assert.equal(moved.parent.path, manuscriptB.path);
  assert.equal(app.vault.getAbstractFileByPath("ProjetA/_Feuillets/Drafts/Idée.md"), null);
});

test("moveDraftToProjectFolder : déplace vers un sous-dossier du projet cible", async () => {
  const { app, settings, draft, chapterB } = buildFixture();
  const moved = await moveDraftToProjectFolder(app, settings, draft, chapterB.path);
  assert.ok(moved);
  assert.equal(moved.path, "ProjetB/Manuscrit/Chapitre 1/Idée.md");
  assert.equal(moved.parent.path, chapterB.path);
});

test("moveDraftToProjectFolder : collision de nom -> numérote automatiquement, jamais d'écrasement", async () => {
  const { app, settings, draft, chapterB, sceneB } = buildFixture("Scene.md");
  const moved = await moveDraftToProjectFolder(app, settings, draft, chapterB.path);
  assert.ok(moved);
  assert.equal(moved.path, "ProjetB/Manuscrit/Chapitre 1/Scene 2.md");
  assert.equal(sceneB.content, "---\ntitle: Scene\n---\n\nTexte.\n");
  assert.equal(app.vault.getAbstractFileByPath("ProjetB/Manuscrit/Chapitre 1/Scene.md"), sceneB);
});

test("moveDraftToProjectFolder : dossier de destination disparu -> aucun déplacement", async () => {
  const { app, settings, draft } = buildFixture();
  const originalPath = draft.path;
  const originalContent = draft.content;
  const moved = await moveDraftToProjectFolder(app, settings, draft, "ProjetB/Manuscrit/Dossier fantôme");
  assert.equal(moved, null);
  assert.equal(draft.path, originalPath);
  assert.equal(draft.content, originalContent);
  assert.equal(app.vault.getAbstractFileByPath(originalPath), draft);
});

test("moveDraftToProjectFolder : conserve le Markdown et le frontmatter à l'identique", async () => {
  const { app, settings, draft, manuscriptB } = buildFixture();
  const moved = await moveDraftToProjectFolder(app, settings, draft, manuscriptB.path);
  assert.equal(moved.content, DRAFT_CONTENT);
  assert.doesNotMatch(moved.content, /\norder:/);
  assert.doesNotMatch(moved.content, /\ncompile:/);
});

test("moveDraftToProjectFolder : ajoute le brouillon à la fin de l'ordre du dossier cible", async () => {
  const { app, settings, draft, manuscriptB } = buildFixture();
  settings.orders[manuscriptB.path] = ["Chapitre 1"];
  const moved = await moveDraftToProjectFolder(app, settings, draft, manuscriptB.path);
  assert.deepEqual(settings.orders[manuscriptB.path], ["Chapitre 1", moved.name]);
});

test("moveDraftToProjectFolder : le brouillon déplacé devient compilable normalement dans le projet cible", async () => {
  const { app, settings, draft, manuscriptB } = buildFixture();
  const scope = { type: "project", projectRoot: manuscriptB.path };
  const before = resolveCompileScopeFiles(app, settings, scope);
  assert.ok(!before.some((f) => f.basename === "Idée"));

  const moved = await moveDraftToProjectFolder(app, settings, draft, manuscriptB.path);
  const after = resolveCompileScopeFiles(app, settings, scope);
  assert.ok(after.some((f) => f.path === moved.path));
});

test("plugin.moveDraftToProject (main.ts) : déplacement dédié, sauvegarde, changement de projet, ouverture puis rafraîchissement — jamais moveNode ni processFrontMatter", () => {
  const source = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
  const start = source.indexOf("async moveDraftToProject(");
  assert.notEqual(start, -1, "moveDraftToProject doit exister sur le plugin");
  const end = source.indexOf("\n  chapterPattern()", start);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  const markers = [
    "moveDraftToProjectFolder(this.app, this.settings, file, destFolderPath)",
    "this.saveSettings()",
    "this.switchProject(destProjectRootPath)",
    "openFileActivating(this.app, leaf, moved)",
    "this.renderAllViews(true)",
  ];
  let previous = -1;
  for (const marker of markers) {
    const position = body.indexOf(marker);
    assert.notEqual(position, -1, `marqueur manquant : ${marker}`);
    assert.ok(position > previous, `${marker} doit suivre l'étape précédente`);
    previous = position;
  }
  assert.doesNotMatch(body, /processFrontMatter/);
  assert.doesNotMatch(body, /this\.moveNode\(/);
});

test("MoveDraftToProjectModal : liste tous les projets connus, exclut les dossiers techniques, délègue le déplacement", async () => {
  const { app, settings, draft, manuscriptB, chapterB, auxB } = buildFixture();
  settings.projects = [manuscriptB.path, "ProjetC/Manuscrit"]; // ProjetC : projet connu mais disparu du coffre

  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);

  const calls = [];
  const plugin = {
    settings,
    getOrderedChildren: (f, includeHidden) => getOrderedChildren(app, settings, f, includeHidden),
    projectDisplayName: (path) => path.split("/")[0],
    moveDraftToProject: async (file, destProjectRootPath, destFolderPath) => {
      calls.push({ file, destProjectRootPath, destFolderPath });
      return true;
    },
  };

  try {
    const modal = new MoveDraftToProjectModal(app, plugin, draft);
    modal.open();

    const projectRows = modal.contentEl.querySelectorAll(".feuillets-project-item");
    assert.equal(projectRows.length, 3, "projet source inclus + projet cible + projet disparu");

    // Le projet source (Projet A, actif) doit être listé — la modale ne
    // l'exclut jamais, seul _Feuillets/Drafts (dossier technique) est
    // absent de l'arbre de destination.
    assert.ok(projectRows.some((row) => row.querySelector(".feuillets-project-name").textContent === "ProjetA"));

    const missingRow = projectRows[2];
    assert.match(missingRow.querySelector(".feuillets-project-name").textContent, /introuvable/);
    missingRow.click();
    assert.equal(notices.length, 1, "un projet disparu affiche une notice et ne navigue jamais");
    assert.equal(
      modal.contentEl.querySelectorAll(".feuillets-project-item").length,
      3,
      "toujours à l'étape de sélection du projet après le clic sur un projet disparu"
    );

    const targetRow = projectRows[1];
    assert.equal(targetRow.querySelector(".feuillets-project-name").textContent, "ProjetB");
    targetRow.click();

    const folderRows = modal.contentEl.querySelectorAll(".feuillets-move-draft-target");
    const labels = folderRows.map((row) => row.textContent);
    assert.deepEqual(labels, [t("modal.moveDraftToProject.projectRoot"), "Chapitre 1"]);
    assert.ok(!labels.includes(auxB.name), "aucun dossier technique (_Feuillets) n'est jamais proposé");

    folderRows[1].click(); // "Chapitre 1"
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, draft);
    assert.equal(calls[0].destProjectRootPath, manuscriptB.path);
    assert.equal(calls[0].destFolderPath, chapterB.path);
    await Promise.resolve(); // laisse retomber le garde-fou `moving` avant le prochain clic

    folderRows[0].click(); // racine du projet
    assert.equal(calls.length, 2);
    assert.equal(calls[1].destFolderPath, manuscriptB.path);
  } finally {
    Notice.onCreate = previousOnCreate;
  }
});
