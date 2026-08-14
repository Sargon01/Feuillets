import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  loadAnnotations,
  saveAnnotations,
  annotationsForFile,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  annotationsFilePath,
  toManuscriptRelativePath,
  remapAnnotationsAfterRename,
  AnnotationsFileCorruptedError,
} from "../src/services/annotations.js";

const ANNOTATIONS_PATH = "Projet/_Feuillets/Ressources/Ressources internes/annotations.json";

function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const scene = new TFile("Projet/Manuscrit/Chapitre/Scène.md", "Il faisait nuit. Le chat dormait. Il faisait nuit.");
  volume.children = [root];
  root.parent = volume;
  root.children = [chapter];
  chapter.parent = root;
  chapter.children = [scene];
  scene.parent = chapter;
  const { vault } = createFakeVault([volume, root, chapter, scene]);
  const app = { vault };
  const settings = { projectFolder: root.path };
  return { app, settings, volume, root, chapter, scene };
}

const SCENE_CONTENT = "Il faisait nuit. Le chat dormait. Il faisait nuit.";
const SCENE_QUOTE = "Le chat dormait";
const SCENE_START = SCENE_CONTENT.indexOf(SCENE_QUOTE);
const SCENE_END = SCENE_START + SCENE_QUOTE.length;

function baseInput(overrides = {}) {
  return {
    file: "Chapitre/Scène.md",
    start: SCENE_START,
    end: SCENE_END,
    quote: SCENE_QUOTE,
    prefix: "faisait nuit. ",
    suffix: ". Il faisait",
    text: "note",
    color: "yellow",
    ...overrides,
  };
}

test("annotations: fichier absent => magasin vide, rien créé sur le disque", async () => {
  const { app, settings } = fixture();
  const store = await loadAnnotations(app, settings);
  assert.deepEqual(store, { version: 1, annotations: [] });
  assert.equal(app.vault.getAbstractFileByPath(ANNOTATIONS_PATH), null);
});

test("annotations: chemin résolu sous Ressources internes (_Feuillets)", async () => {
  const { app, settings } = fixture();
  assert.equal(annotationsFilePath(app, settings), ANNOTATIONS_PATH);
});

test("annotations: création / lecture / modification / suppression", async () => {
  const { app, settings } = fixture();

  const created = await addAnnotation(app, settings, baseInput());
  assert.ok(created.id);
  assert.equal(created.color, "yellow");

  const file = app.vault.getAbstractFileByPath(ANNOTATIONS_PATH);
  assert.ok(file instanceof TFile);

  let store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
  assert.equal(store.annotations[0].id, created.id);

  const updated = await updateAnnotation(app, settings, created.id, { color: "blue", text: "note révisée" });
  assert.equal(updated.color, "blue");
  assert.equal(updated.text, "note révisée");

  store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].color, "blue");

  const missing = await updateAnnotation(app, settings, "id-inconnu", { color: "pink" });
  assert.equal(missing, null);

  const deleted = await deleteAnnotation(app, settings, created.id);
  assert.equal(deleted, true);
  store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0);

  const deletedAgain = await deleteAnnotation(app, settings, created.id);
  assert.equal(deletedAgain, false);
});

test("annotations: ancien dossier interne reconnu (Assets)", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const legacyResources = new TFolder("Projet/_Feuillets/Ressources");
  const legacyAssets = new TFolder("Projet/_Feuillets/Ressources/Assets");
  volume.children = [root];
  root.parent = volume;
  root.children = [];
  legacyResources.children = [legacyAssets];
  legacyAssets.parent = legacyResources;
  const { vault } = createFakeVault([volume, root, legacyResources, legacyAssets]);
  const app = { vault };
  const settings = { projectFolder: root.path };

  const path = annotationsFilePath(app, settings);
  assert.equal(path, "Projet/_Feuillets/Ressources/Assets/annotations.json");

  await saveAnnotations(app, settings, { version: 1, annotations: [] });
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Assets/annotations.json") instanceof TFile);
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Ressources internes/annotations.json"), null);
});

test("annotations: chemin `file` relatif au Manuscrit", async () => {
  const { app, settings, scene, root } = fixture();
  const rel = toManuscriptRelativePath(app, settings, scene);
  assert.equal(rel, "Chapitre/Scène.md");
  assert.equal(toManuscriptRelativePath(app, settings, root), "");
});

test("resolveAnnotation: offsets exacts encore valides", () => {
  const annotation = baseInput({ id: "a1" });
  const resolved = resolveAnnotation(annotation, SCENE_CONTENT);
  assert.deepEqual(resolved, { start: SCENE_START, end: SCENE_END });
  assert.equal(SCENE_CONTENT.slice(resolved.start, resolved.end), SCENE_QUOTE);
});

test("resolveAnnotation: insertion avant le passage décale les offsets", () => {
  const original = "Il faisait nuit. Le chat unique dormait paisiblement.";
  const quote = "chat unique";
  const start = original.indexOf(quote);
  const end = start + quote.length;
  const annotation = {
    id: "a1",
    file: "x.md",
    start,
    end,
    quote,
    prefix: original.slice(Math.max(0, start - 10), start),
    suffix: original.slice(end, end + 10),
    text: "",
    color: "yellow",
  };
  const edited = "PRÉFIXE AJOUTÉ. " + original;
  const resolved = resolveAnnotation(annotation, edited);
  assert.ok(resolved);
  assert.equal(edited.slice(resolved.start, resolved.end), quote);
  assert.notEqual(resolved.start, start);
});

test("resolveAnnotation: suppression avant le passage décale les offsets", () => {
  const original = "AVANT-TEXTE. Le passage annoté reste identique ici.";
  const quote = "passage annoté";
  const start = original.indexOf(quote);
  const end = start + quote.length;
  const annotation = {
    id: "a1",
    file: "x.md",
    start,
    end,
    quote,
    prefix: original.slice(Math.max(0, start - 8), start),
    suffix: original.slice(end, end + 8),
    text: "",
    color: "yellow",
  };
  const edited = original.replace("AVANT-TEXTE. ", "");
  const resolved = resolveAnnotation(annotation, edited);
  assert.ok(resolved);
  assert.equal(edited.slice(resolved.start, resolved.end), quote);
});

test("resolveAnnotation: petite modification du passage retrouvée via prefix/suffix", () => {
  const original = "Contexte avant. Le chat gris dormait. Contexte après.";
  const quote = "Le chat gris dormait";
  const start = original.indexOf(quote);
  const end = start + quote.length;
  const annotation = {
    id: "a1",
    file: "x.md",
    start,
    end,
    quote,
    prefix: "Contexte avant. ",
    suffix: ". Contexte après.",
    text: "",
    color: "yellow",
  };
  const edited = original.replace(quote, "Le chat noir dormait");
  const resolved = resolveAnnotation(annotation, edited);
  assert.ok(resolved);
  assert.equal(edited.slice(resolved.start, resolved.end), "Le chat noir dormait");
});

test("resolveAnnotation: occurrences multiples départagées par prefix/suffix", () => {
  const content = "AAA cible BBB texte de remplissage. CCC cible DDD.";
  const annotation = {
    id: "a1",
    file: "x.md",
    start: 999,
    end: 1010,
    quote: "cible",
    prefix: "CCC ",
    suffix: " DDD",
    text: "",
    color: "yellow",
  };
  const resolved = resolveAnnotation(annotation, content);
  assert.ok(resolved);
  const secondIdx = content.indexOf("cible", content.indexOf("cible") + 1);
  assert.equal(resolved.start, secondIdx);
});

test("resolveAnnotation: ambiguïté persistante => unresolved", () => {
  const content = "X cible Y cible Z";
  const annotation = {
    id: "a1",
    file: "x.md",
    start: 999,
    end: 1010,
    quote: "cible",
    prefix: "inconnu",
    suffix: "inconnu",
    text: "",
    color: "yellow",
  };
  const resolved = resolveAnnotation(annotation, content);
  assert.equal(resolved, null);
});

test("resolveAnnotation: passage supprimé => unresolved", () => {
  const content = "Ce texte ne contient plus rien de pertinent.";
  const annotation = {
    id: "a1",
    file: "x.md",
    start: 5,
    end: 20,
    quote: "passage disparu",
    prefix: "avant",
    suffix: "après",
    text: "",
    color: "yellow",
  };
  const resolved = resolveAnnotation(annotation, content);
  assert.equal(resolved, null);
});

test("annotations: JSON corrompu préservé, jamais écrasé", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const feuillets = new TFolder("Projet/_Feuillets");
  const resources = new TFolder("Projet/_Feuillets/Ressources");
  const assets = new TFolder("Projet/_Feuillets/Ressources/Ressources internes");
  volume.children = [root, feuillets];
  root.parent = volume;
  root.children = [];
  feuillets.parent = volume;
  feuillets.children = [resources];
  resources.parent = feuillets;
  resources.children = [assets];
  assets.parent = resources;
  assets.children = [];
  const { vault } = createFakeVault([volume, root, feuillets, resources, assets]);
  const corrupted = await vault.create(ANNOTATIONS_PATH, "{ not valid json");
  const app = { vault };
  const settings = { projectFolder: root.path };

  await assert.rejects(() => loadAnnotations(app, settings), AnnotationsFileCorruptedError);
  const stillThere = vault.getAbstractFileByPath(ANNOTATIONS_PATH);
  assert.ok(stillThere instanceof TFile);
  assert.equal(stillThere.content, "{ not valid json");
  void corrupted;
});

test("annotations: aucun fichier Markdown n'est jamais touché", async () => {
  const { app, settings, scene } = fixture();
  const before = scene.content;
  await addAnnotation(app, settings, baseInput());
  await updateAnnotation(app, settings, (await loadAnnotations(app, settings)).annotations[0].id, { color: "green" });
  assert.equal(scene.content, before);
  assert.equal(scene.content.includes("annotation"), false);
});

test("annotationsForFile: filtre par chemin relatif", async () => {
  const { app, settings } = fixture();
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Scène.md" }));
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Autre.md" }));
  const store = await loadAnnotations(app, settings);
  const forScene = annotationsForFile(store, "Chapitre/Scène.md");
  assert.equal(forScene.length, 1);
  assert.equal(forScene[0].file, "Chapitre/Scène.md");
});

test("remapAnnotationsAfterRename: un renommage/déplacement du fichier suit son annotation, jamais les voisines", async () => {
  const { app, settings, root } = fixture();
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Scène.md" }));
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Voisine.md" }));

  const changed = await remapAnnotationsAfterRename(app, settings, `${root.path}/Chapitre/Scène.md`, `${root.path}/Chapitre/Renommée.md`);
  assert.equal(changed, true);

  const store = await loadAnnotations(app, settings);
  const files = store.annotations.map((a) => a.file).sort();
  assert.deepEqual(files, ["Chapitre/Renommée.md", "Chapitre/Voisine.md"], "seule l'annotation du fichier renommé suit, la voisine reste inchangée");
});

test("remapAnnotationsAfterRename: un déplacement de DOSSIER suit toutes ses annotations d'un coup", async () => {
  const { app, settings, root } = fixture();
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Scène.md" }));
  await addAnnotation(app, settings, baseInput({ file: "Chapitre/Autre.md" }));

  const changed = await remapAnnotationsAfterRename(app, settings, `${root.path}/Chapitre`, `${root.path}/NouveauChapitre`);
  assert.equal(changed, true);

  const store = await loadAnnotations(app, settings);
  const files = store.annotations.map((a) => a.file).sort();
  assert.deepEqual(files, ["NouveauChapitre/Autre.md", "NouveauChapitre/Scène.md"]);
});

test("un fichier supprimé n'efface pas ses annotations : resolveAnnotation reste appelable, rien n'est réécrit tout seul", async () => {
  const { app, settings, scene } = fixture();
  await addAnnotation(app, settings, baseInput());
  const before = await loadAnnotations(app, settings);
  assert.equal(before.annotations.length, 1);

  // Suppression du fichier : aucun mécanisme d'annotations.ts ne réagit à
  // cet événement lui-même (voir main.ts, qui ne branche rien sur "delete") —
  // l'annotation reste donc, telle quelle, jusqu'à ce qu'un appelant la
  // résolve contre un contenu (voir notes-view-annotations.test.js pour le
  // rendu "Passage introuvable" côté vue).
  await app.vault.delete(scene);
  const after = await loadAnnotations(app, settings);
  assert.deepEqual(after, before, "l'annotation est conservée telle quelle, jamais supprimée automatiquement");
});
