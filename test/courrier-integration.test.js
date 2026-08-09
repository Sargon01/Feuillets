import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { getCourrierApi, buildSubmissionData, detectEditorialDocuments, applySubmissionChoice, prepareSubmission } from "../src/services/courrier-integration.js";

function projectFixture() {
  const volume = new TFolder("Roman1");
  const manuscrit = new TFolder("Roman1/Manuscrit");
  const scene = new TFile("Roman1/Manuscrit/Scène 1.md", "Du texte ici, plusieurs mots.");
  volume.children = [manuscrit];
  manuscrit.parent = volume;
  manuscrit.children = [scene];
  scene.parent = manuscrit;
  return { volume, manuscrit, scene };
}

function createHost({ pluginsManager, projectMeta = {}, wordCount = 0, files = [] } = {}) {
  const { vault } = createFakeVault(files);
  const app = { vault, plugins: pluginsManager };
  const settings = { projectFolder: "Roman1/Manuscrit", projectMeta };
  return {
    app,
    settings,
    async wordCountOfFolder() {
      return wordCount;
    },
    projectDisplayName(path) {
      return (projectMeta[path] || {}).name || path.split("/").slice(-1)[0];
    },
  };
}

// --- getCourrierApi : absent / désactivé / actif ---

test("getCourrierApi : Courrier absent — renvoie null sans lever", () => {
  const app = { plugins: { enabledPlugins: new Set(), plugins: {} } };
  assert.equal(getCourrierApi(app), null);
});

test("getCourrierApi : Courrier installé mais désactivé — renvoie null", () => {
  const app = {
    plugins: {
      enabledPlugins: new Set(),
      plugins: { courrier: { api: { createSubmissionDraft: () => ({ success: true }) } } },
    },
  };
  assert.equal(getCourrierApi(app), null);
});

test("getCourrierApi : aucun gestionnaire de plugins (environnement de test) — renvoie null, ne lève jamais", () => {
  const app = {};
  assert.doesNotThrow(() => getCourrierApi(app));
  assert.equal(getCourrierApi(app), null);
});

test("getCourrierApi : activé mais sans createSubmissionDraft — renvoie null (version incompatible)", () => {
  const app = {
    plugins: {
      enabledPlugins: new Set(["courrier"]),
      plugins: { courrier: { api: {} } },
    },
  };
  assert.equal(getCourrierApi(app), null);
});

test("getCourrierApi : Courrier actif avec l'API attendue — renvoyée telle quelle", () => {
  const api = { createSubmissionDraft: () => ({ success: true }) };
  const app = {
    plugins: {
      enabledPlugins: new Set(["courrier"]),
      plugins: { courrier: { api } },
    },
  };
  assert.equal(getCourrierApi(app), api);
});

// --- buildSubmissionData : lecture seule des métadonnées du projet ---

test("buildSubmissionData : titre, auteur, nombre de mots à partir des métadonnées du projet", async () => {
  const { manuscrit } = projectFixture();
  const host = createHost({
    projectMeta: { "Roman1/Manuscrit": { name: "La Traversée", author: "J. Dupont", type: "fiction" } },
    wordCount: 1234,
  });

  const data = await buildSubmissionData(host, manuscrit);

  assert.equal(data.titre, "La Traversée");
  assert.equal(data.auteur, "J. Dupont");
  assert.equal(data.genre, "fiction");
  assert.equal(data.nombreMots, 1234);
  assert.equal(data.manuscritPath, "Roman1/Manuscrit");
});

test("buildSubmissionData : champs facultatifs absents des métadonnées — jamais renseignés (pas de chaîne vide)", async () => {
  const { manuscrit } = projectFixture();
  const host = createHost({ projectMeta: {}, wordCount: 0 });

  const data = await buildSubmissionData(host, manuscrit);

  assert.ok(!("auteur" in data));
  assert.ok(!("genre" in data));
  assert.ok(!("nombreMots" in data));
  assert.ok(!("synopsis" in data));
  assert.ok(!("documentExportePath" in data));
});

test("buildSubmissionData : description du projet sert de repli pour le synopsis", async () => {
  const { manuscrit } = projectFixture();
  const host = createHost({
    projectMeta: { "Roman1/Manuscrit": { description: "Une traversée initiatique." } },
  });

  const data = await buildSubmissionData(host, manuscrit);

  assert.equal(data.synopsis, "Une traversée initiatique.");
});

test("buildSubmissionData : document exporté trouvé s'il existe dans Sortie/", async () => {
  const { volume, manuscrit } = projectFixture();
  const sortie = new TFolder("Roman1/Sortie");
  const docx = new TFile("Roman1/Sortie/Manuscrit.docx", "");
  docx.extension = "docx";
  docx.stat = { mtime: 1000 };
  sortie.children = [docx];
  sortie.parent = volume;
  volume.children.push(sortie);
  const host = createHost({ files: [volume, manuscrit, sortie, docx] });

  const data = await buildSubmissionData(host, manuscrit);

  assert.equal(data.documentExportePath, "Roman1/Sortie/Manuscrit.docx");
});

test("buildSubmissionData : aucun dossier Sortie — pas de document exporté, sans lever", async () => {
  const { manuscrit } = projectFixture();
  const host = createHost();

  const data = await buildSubmissionData(host, manuscrit);

  assert.ok(!("documentExportePath" in data));
});

// --- detectEditorialDocuments : Synopsis/Biographie/Lettre/Note + DOCX exporté ---

function editionFixture() {
  const { volume, manuscrit } = projectFixture();
  const edition = new TFolder("Roman1/Edition");
  const synopsis = new TFile("Roman1/Edition/Synopsis.md", "Résumé.");
  const bio = new TFile("Roman1/Edition/Biographie.md", "Bio.");
  edition.children = [synopsis, bio];
  edition.parent = volume;
  synopsis.parent = edition;
  bio.parent = edition;
  volume.children.push(edition);
  return { volume, manuscrit, edition, synopsis, bio };
}

test("detectEditorialDocuments : détecte Synopsis et Biographie, Synopsis coché par défaut, Biographie non", async () => {
  const { volume, manuscrit, edition, synopsis, bio } = editionFixture();
  const host = createHost({ files: [volume, manuscrit, edition, synopsis, bio] });

  const candidates = await detectEditorialDocuments(host.app, host.settings, manuscrit);

  const synopsisCandidate = candidates.find((c) => c.id === "synopsis");
  const bioCandidate = candidates.find((c) => c.id === "biographie");
  assert.ok(synopsisCandidate, "Synopsis doit être détecté");
  assert.equal(synopsisCandidate.checkedByDefault, true);
  assert.ok(bioCandidate, "Biographie doit être détectée");
  assert.equal(bioCandidate.checkedByDefault, false);
});

test("detectEditorialDocuments : document manquant (Lettre d'accompagnement absente) n'apparaît pas", async () => {
  const { volume, manuscrit, edition, synopsis, bio } = editionFixture();
  const host = createHost({ files: [volume, manuscrit, edition, synopsis, bio] });

  const candidates = await detectEditorialDocuments(host.app, host.settings, manuscrit);

  assert.ok(!candidates.some((c) => c.id === "lettre-accompagnement"));
});

test("detectEditorialDocuments : reconnaît les variantes historiques avec apostrophe droite", async () => {
  const { volume, manuscrit, edition, synopsis, bio } = editionFixture();
  const note = new TFile("Roman1/Edition/Note d'intention.md", "Note.");
  const letter = new TFile("Roman1/Edition/Lettre d'accompagnement.md", "Lettre.");
  note.parent = edition;
  letter.parent = edition;
  edition.children.push(note, letter);
  const host = createHost({ files: [volume, manuscrit, edition, synopsis, bio, note, letter] });

  const candidates = await detectEditorialDocuments(host.app, host.settings, manuscrit);

  assert.ok(candidates.some((candidate) => candidate.id === "note-intention" && candidate.path === note.path));
  assert.ok(candidates.some((candidate) => candidate.id === "lettre-accompagnement" && candidate.path === letter.path));
});

test("detectEditorialDocuments : dernier DOCX exporté détecté et coché par défaut (manuscrit)", async () => {
  const { volume, manuscrit } = projectFixture();
  const sortie = new TFolder("Roman1/Sortie");
  const docx = new TFile("Roman1/Sortie/Manuscrit.docx", "");
  docx.extension = "docx";
  docx.stat = { mtime: 1000 };
  sortie.children = [docx];
  sortie.parent = volume;
  volume.children.push(sortie);
  const host = createHost({ files: [volume, manuscrit, sortie, docx] });

  const candidates = await detectEditorialDocuments(host.app, host.settings, manuscrit);

  const manuscritCandidate = candidates.find((c) => c.id === "manuscrit");
  assert.ok(manuscritCandidate);
  assert.equal(manuscritCandidate.checkedByDefault, true);
  assert.equal(manuscritCandidate.path, "Roman1/Sortie/Manuscrit.docx");
});

test("detectEditorialDocuments : aucun dossier Édition ni export — liste vide, sans lever", async () => {
  const { manuscrit } = projectFixture();
  const host = createHost();

  const candidates = await detectEditorialDocuments(host.app, host.settings, manuscrit);

  assert.deepEqual(candidates, []);
});

// --- applySubmissionChoice : transmission après confirmation explicite ---

test("applySubmissionChoice : chemins cochés transmis dans pieceJointes", () => {
  const calls = [];
  const api = { createSubmissionDraft: (data) => { calls.push(data); return { success: true }; } };

  applySubmissionChoice(api, { titre: "La Traversée" }, ["Roman1/Edition/Synopsis.md"]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].pieceJointes, ["Roman1/Edition/Synopsis.md"]);
});

test("applySubmissionChoice : aucun chemin coché — pieceJointes absent, jamais un tableau vide", () => {
  const calls = [];
  const api = { createSubmissionDraft: (data) => { calls.push(data); return { success: true }; } };

  applySubmissionChoice(api, { titre: "La Traversée" }, []);

  assert.equal(calls.length, 1);
  assert.ok(!("pieceJointes" in calls[0]));
});

test("applySubmissionChoice : l'export DOCX direct remplace la copie du manuscrit historique de Sortie", () => {
  const calls = [];
  const api = { createSubmissionDraft: (data) => { calls.push(data); return { success: true }; } };
  const data = {
    titre: "La Traversée",
    documentExportePath: "Roman1/Sortie/Manuscrit.docx",
    exportManuscritDocx: async () => "Roman1/Edition/Soumissions/Paquet/Dossier à envoyer/Manuscrit - La Traversée.docx",
  };

  applySubmissionChoice(api, data, ["Roman1/Sortie/Manuscrit.docx", "Roman1/Edition/Synopsis.md"]);

  assert.deepEqual(calls[0].pieceJointes, ["Roman1/Edition/Synopsis.md"]);
  assert.equal(typeof calls[0].exportManuscritDocx, "function");
});

test("buildSubmissionData : transmet le callback d'export DOCX des documents éditoriaux", async () => {
  const { volume, manuscrit } = projectFixture();
  const host = createHost({ files: [volume, manuscrit] });

  const data = await buildSubmissionData(host, manuscrit);

  assert.equal(typeof data.exportEditorialDocumentDocx, "function");
});

// --- prepareSubmission : orchestration complète ---

test("prepareSubmission : aucun projet actif — notice claire, jamais d'ouverture de modale ni d'appel à Courrier", async () => {
  const calls = [];
  const app = {
    plugins: { enabledPlugins: new Set(["courrier"]), plugins: { courrier: { api: { createSubmissionDraft: (d) => { calls.push(d); return { success: true }; } } } } },
    vault: createFakeVault([]).vault,
  };
  const host = { app, settings: { projectFolder: "" }, async wordCountOfFolder() { return 0; }, projectDisplayName: (p) => p };

  await prepareSubmission(host);

  assert.equal(calls.length, 0);
});

test("prepareSubmission : Courrier absent — notice claire nommant le plugin requis, jamais d'ouverture de modale", async () => {
  const { volume, manuscrit } = projectFixture();
  const { vault } = createFakeVault([volume, manuscrit]);
  const app = { vault, plugins: { enabledPlugins: new Set(), plugins: {} } };
  const host = { app, settings: { projectFolder: "Roman1/Manuscrit", projectMeta: {} }, async wordCountOfFolder() { return 0; }, projectDisplayName: (p) => p };

  await assert.doesNotReject(() => prepareSubmission(host));
});

test("prepareSubmission : Courrier actif — rassemble les données et ouvre la modale de sélection sans lever (aucun envoi tant que non confirmé)", async () => {
  const { volume, manuscrit } = projectFixture();
  const { vault } = createFakeVault([volume, manuscrit]);
  const calls = [];
  const app = {
    vault,
    plugins: {
      enabledPlugins: new Set(["courrier"]),
      plugins: { courrier: { api: { createSubmissionDraft: (data) => { calls.push(data); return { success: true }; } } } },
    },
  };
  const host = {
    app,
    settings: { projectFolder: "Roman1/Manuscrit", projectMeta: { "Roman1/Manuscrit": { name: "La Traversée" } } },
    async wordCountOfFolder() { return 500; },
    projectDisplayName: () => "La Traversée",
  };

  await assert.doesNotReject(() => prepareSubmission(host));

  // La modale (stub de test : `open()` n'appelle jamais `onOpen()`) ne
  // confirme rien toute seule — voir SubmissionAttachmentsModal.test.js
  // pour la confirmation elle-même et applySubmissionChoice ci-dessus pour
  // l'effet réel d'une confirmation.
  assert.equal(calls.length, 0);
});
