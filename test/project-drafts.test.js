import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  createQuickDraftFile,
  draftsFolderPath,
  ensureDraftsFolder,
  firstDraftBodyLine,
  getDraftsFolder,
  initialQuickDraftContent,
  isProjectDraft,
  nextAvailableDraftPath,
  nextAvailablePromotedDraftPath,
  ProjectDraftAutoRenamer,
  sanitizeDraftFileStem,
} from "../src/services/project-drafts.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function structuredProject() {
  const volume = folder("Projet");
  const manuscript = folder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children = [manuscript];
  return { volume, manuscript };
}

function freeProject() {
  return folder("Projet libre");
}

test("draftsFolderPath : utilise la racine projet structurée ou libre", () => {
  const structured = structuredProject();
  assert.equal(draftsFolderPath(structured.manuscript), "Projet/_Feuillets/Drafts");
  assert.equal(draftsFolderPath(freeProject()), "Projet libre/_Feuillets/Drafts");
});

test("Drafts est créé paresseusement et ensureDraftsFolder est idempotent", async () => {
  const { volume, manuscript } = structuredProject();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  assert.equal(getDraftsFolder(app, manuscript), null);
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets"), null);
  assert.equal(vault.getAbstractFileByPath("_Feuillets/Drafts"), null);
  const first = await ensureDraftsFolder(app, manuscript);
  const second = await ensureDraftsFolder(app, manuscript);
  assert.equal(first.path, "Projet/_Feuillets/Drafts");
  assert.equal(second, first);
  assert.equal(vault.getAbstractFileByPath("Drafts"), null);
});

test("ensureDraftsFolder : refuse un fichier occupant le chemin canonique", async () => {
  const { volume, manuscript } = structuredProject();
  const auxiliary = folder("Projet/_Feuillets");
  auxiliary.parent = volume;
  volume.children.push(auxiliary);
  const occupied = new TFile("Projet/_Feuillets/Drafts", "conservé");
  occupied.parent = auxiliary;
  auxiliary.children.push(occupied);
  const { vault } = createFakeVault([volume, manuscript, auxiliary, occupied]);

  await assert.rejects(
    () => ensureDraftsFolder({ vault }, manuscript),
    (error) => error instanceof Error && error.message.includes("Projet/_Feuillets/Drafts")
  );
  assert.equal(occupied.content, "conservé");
});

test("createQuickDraftFile : crée le contenu minimal et numérote les collisions", async () => {
  const { volume, manuscript } = structuredProject();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  const first = await createQuickDraftFile(app, manuscript);
  const second = await createQuickDraftFile(app, manuscript);
  const third = await createQuickDraftFile(app, manuscript);
  assert.equal(first.path, "Projet/_Feuillets/Drafts/Sans titre.md");
  assert.equal(second.path, "Projet/_Feuillets/Drafts/Sans titre 2.md");
  assert.equal(third.path, "Projet/_Feuillets/Drafts/Sans titre 3.md");
  assert.equal(initialQuickDraftContent(), "---\nstatus: Brouillon\n---\n\n");
  assert.equal(first.content, "---\nstatus: Brouillon\n---\n\n");
  assert.doesNotMatch(first.content, /compile|title|order/);
});

test("isProjectDraft : accepte Drafts et ses sous-dossiers, pas les voisins ni les autres projets", () => {
  const { volume, manuscript } = structuredProject();
  const other = folder("Autre projet/Manuscrit");
  const direct = new TFile("Projet/_Feuillets/Drafts/direct.md");
  const nested = new TFile("Projet/_Feuillets/Drafts/Sous-dossier/nested.md");
  const nonMarkdown = new TFile("Projet/_Feuillets/Drafts/image.png");
  const old = new TFile("Projet/_Feuillets/Drafts-old/test.md");
  const version = new TFile("Projet/_Feuillets/Versions/test.md");
  const manuscriptFile = new TFile("Projet/Manuscrit/Chapitre.md");
  const otherDraft = new TFile("Autre projet/_Feuillets/Drafts/test.md");
  const windowsPath = new TFile("Projet\\_Feuillets\\Drafts\\windows.md");
  const { vault } = createFakeVault([volume, manuscript, other, direct, nested, nonMarkdown, old, version, manuscriptFile, otherDraft, windowsPath]);

  assert.equal(isProjectDraft(manuscript, direct), true);
  assert.equal(isProjectDraft(manuscript, nested), true);
  assert.equal(isProjectDraft(manuscript, nonMarkdown), false);
  assert.equal(isProjectDraft(manuscript, old), false);
  assert.equal(isProjectDraft(manuscript, version), false);
  assert.equal(isProjectDraft(manuscript, manuscriptFile), false);
  assert.equal(isProjectDraft(manuscript, otherDraft), false);
  assert.equal(isProjectDraft(manuscript, windowsPath), true);
  assert.equal(vault.getFiles().length, 8);
});

test("fonctions de nommage : frontmatter, marqueurs, accents et longueur", () => {
  assert.equal(firstDraftBodyLine("---\nstatus: Brouillon\n---\n\n  Première ligne  \nSuite"), "Première ligne");
  assert.equal(firstDraftBodyLine("---\nstatus: Brouillon\n---\n\n"), null);
  assert.equal(sanitizeDraftFileStem("# Discours du 11 novembre"), "Discours du 11 novembre");
  assert.equal(sanitizeDraftFileStem("> **Bonjour à tous**"), "Bonjour à tous");
  assert.equal(sanitizeDraftFileStem("1. Liste / à tester : oui"), "Liste à tester oui");
  assert.equal(sanitizeDraftFileStem("_Bonjour_"), "Bonjour");
  assert.equal(sanitizeDraftFileStem("_"), null);
  assert.equal(sanitizeDraftFileStem("-"), null);
  assert.equal(sanitizeDraftFileStem("+"), null);
  assert.equal(sanitizeDraftFileStem("*"), null);
  assert.equal(sanitizeDraftFileStem("1."), null);
  assert.equal(sanitizeDraftFileStem("1)"), null);
  assert.equal(sanitizeDraftFileStem("   "), null);
  assert.equal(sanitizeDraftFileStem("éè à — titre"), "éè à — titre");
  assert.equal(sanitizeDraftFileStem("x".repeat(100)).length, 80);
  assert.equal(sanitizeDraftFileStem("...."), null);
});

test("nextAvailableDraftPath : ne crée rien et nettoie le nom préféré", () => {
  const { volume, manuscript } = structuredProject();
  const drafts = folder("Projet/_Feuillets/Drafts");
  drafts.parent = volume;
  volume.children.push(drafts);
  const existing = new TFile("Projet/_Feuillets/Drafts/Bonjour.md");
  existing.parent = drafts;
  drafts.children.push(existing);
  const { vault } = createFakeVault([volume, manuscript, drafts, existing]);
  const path = nextAvailableDraftPath({ vault }, drafts, "**Bonjour**");
  assert.equal(path, "Projet/_Feuillets/Drafts/Bonjour 2.md");
  assert.equal(drafts.children.length, 1);
});

test("nextAvailablePromotedDraftPath : commence à 2 et ne modifie rien", () => {
  const project = folder("Projet");
  const destination = folder("Projet/Humeur");
  const emptyDestination = folder("Projet/Autre");
  const otherDraft = new TFile("Projet/_Feuillets/Drafts/Autre.md", "contenu");
  const draft = new TFile("Projet/_Feuillets/Drafts/Humeur.md", "contenu");
  const existing = new TFile("Projet/Humeur/Humeur 2.md", "existant");
  project.children = [destination, emptyDestination];
  destination.parent = project;
  emptyDestination.parent = project;
  draft.parent = folder("Projet/_Feuillets/Drafts");
  existing.parent = destination;
  destination.children = [existing];
  const { vault } = createFakeVault([project, destination, emptyDestination, draft, otherDraft, existing]);

  assert.equal(nextAvailablePromotedDraftPath({ vault }, emptyDestination, otherDraft), "Projet/Autre/Autre 2.md");
  assert.equal(nextAvailablePromotedDraftPath({ vault }, destination, draft), "Projet/Humeur/Humeur 3.md");
  assert.equal(draft.path, "Projet/_Feuillets/Drafts/Humeur.md");
  assert.equal(existing.content, "existant");
  assert.equal(destination.children.length, 1);
});

function autoRenameFixture(content, draftPath = "Projet/_Feuillets/Drafts/Sans titre.md", extraFiles = []) {
  const { volume, manuscript } = structuredProject();
  const auxiliary = folder("Projet/_Feuillets");
  const drafts = folder("Projet/_Feuillets/Drafts");
  const file = new TFile(draftPath, content);
  auxiliary.parent = volume;
  drafts.parent = auxiliary;
  file.parent = drafts;
  volume.children.push(auxiliary);
  auxiliary.children.push(drafts);
  drafts.children.push(file, ...extraFiles);
  for (const extra of extraFiles) extra.parent = drafts;
  const { vault, fileManager } = createFakeVault([volume, manuscript, auxiliary, drafts, file, ...extraFiles]);
  vault.cachedRead = vault.read;
  return {
    app: { vault, fileManager },
    root: manuscript,
    drafts,
    file,
    fileManager,
  };
}

function waitForRename(delay = 10) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

test("ProjectDraftAutoRenamer renomme un brouillon avec sa première ligne", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\n## Discours du 11 novembre\n");
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 2);
  renamer.schedule(fixture.file);
  await waitForRename();
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Discours du 11 novembre.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer débounce les modifications et utilise le dernier contenu", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nPremier\n");
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 5);
  renamer.schedule(fixture.file);
  fixture.file.content = "---\nstatus: Brouillon\n---\n\nDernier\n";
  renamer.schedule(fixture.file);
  await waitForRename(15);
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Dernier.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer suit un renommage automatique puis corrige le titre", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nDiscour\n");
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 2);
  renamer.schedule(fixture.file);
  await waitForRename();
  const firstPath = fixture.file.path;
  renamer.handleRename(fixture.file, "Projet/_Feuillets/Drafts/Sans titre.md");
  fixture.file.content = "---\nstatus: Brouillon\n---\n\nDiscours\n";
  renamer.schedule(fixture.file);
  await waitForRename();
  assert.equal(firstPath, "Projet/_Feuillets/Drafts/Discour.md");
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Discours.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer protège un renommage manuel", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nTitre\n");
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 5);
  renamer.schedule(fixture.file);
  const oldPath = fixture.file.path;
  await fixture.fileManager.renameFile(fixture.file, "Projet/_Feuillets/Drafts/Choisi.md");
  renamer.handleRename(fixture.file, oldPath);
  await waitForRename(15);
  fixture.file.content = "---\nstatus: Brouillon\n---\n\nAutre titre\n";
  renamer.schedule(fixture.file);
  await waitForRename(15);
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Choisi.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer ignore un brouillon déplacé hors de Drafts", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nTitre\n");
  const target = folder("Projet/TEXTES");
  target.parent = fixture.root.parent;
  fixture.root.parent?.children.push(target);
  fixture.app.vault.getAbstractFileByPath = (path) => {
    if (path === target.path) return target;
    return path === fixture.file.path ? fixture.file : path === fixture.root.path ? fixture.root : null;
  };
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 5);
  renamer.schedule(fixture.file);
  const oldPath = fixture.file.path;
  fixture.file.path = "Projet/TEXTES/Sans titre.md";
  await fixture.fileManager.renameFile(fixture.file, fixture.file.path);
  renamer.handleRename(fixture.file, oldPath);
  await waitForRename(15);
  assert.equal(fixture.file.path, "Projet/TEXTES/Sans titre.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer numérote les collisions sans auto-collision", async () => {
  const existing = new TFile("Projet/_Feuillets/Drafts/Discours.md");
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nDiscours\n", undefined, [existing]);
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 2);
  renamer.schedule(fixture.file);
  await waitForRename();
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Discours 2.md");
  renamer.handleRename(fixture.file, "Projet/_Feuillets/Drafts/Sans titre.md");
  fixture.file.content = "---\nstatus: Brouillon\n---\n\nDiscours\n";
  renamer.schedule(fixture.file);
  await waitForRename();
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Discours 2.md");
  renamer.dispose();
});

test("ProjectDraftAutoRenamer ignore les noms non éligibles et dispose ses minuteurs", async () => {
  const empty = autoRenameFixture("---\nstatus: Brouillon\n---\n\n");
  const manual = autoRenameFixture("---\nstatus: Brouillon\n---\n\nTitre\n", "Projet/_Feuillets/Drafts/Manuel.md");
  const renamer = new ProjectDraftAutoRenamer(empty.app, () => empty.root, 2);
  renamer.schedule(empty.file);
  renamer.dispose();
  await waitForRename();
  assert.equal(empty.file.path, "Projet/_Feuillets/Drafts/Sans titre.md");
  const manualRenamer = new ProjectDraftAutoRenamer(manual.app, () => manual.root, 2);
  manualRenamer.schedule(manual.file);
  await waitForRename();
  assert.equal(manual.file.path, "Projet/_Feuillets/Drafts/Manuel.md");
  manualRenamer.dispose();
});

test("ProjectDraftAutoRenamer mémorise un renommage manuel avant tout suivi", async () => {
  const fixture = autoRenameFixture("---\nstatus: Brouillon\n---\n\nTitre\n");
  const renamer = new ProjectDraftAutoRenamer(fixture.app, () => fixture.root, 2);
  const oldPath = fixture.file.path;
  await fixture.fileManager.renameFile(fixture.file, "Projet/_Feuillets/Drafts/Sans titre 2.md");
  renamer.handleRename(fixture.file, oldPath);
  fixture.file.content = "---\nstatus: Brouillon\n---\n\nNouveau titre\n";
  renamer.schedule(fixture.file);
  await waitForRename();
  assert.equal(fixture.file.path, "Projet/_Feuillets/Drafts/Sans titre 2.md");
  renamer.dispose();
});
