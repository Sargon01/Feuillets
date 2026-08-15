import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ScriveningsSession } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument, locationToCompositeOffset } from "../src/services/scrivenings-document.js";

function createSession(pairs, extra = {}) {
  const files = pairs.map(([path, content]) => new TFile(path, content));
  const { vault } = createFakeVault(files);

  const entries = pairs.map(([, content], i) => ({ file: files[i], content }));
  const document = buildScriveningsDocument(entries);

  const app = { vault };
  const timers = { scheduled: [] };
  const session = new ScriveningsSession({
    app,
    debounceMs: 800,
    scheduleTimeout: (cb, ms) => { const id = timers.scheduled.length + 1; timers.scheduled.push({ id, cb, ms }); return id; },
    cancelTimeout: (id) => { timers.scheduled = timers.scheduled.filter((entry) => entry.id !== id); },
    notify: (message) => timers.notified ? timers.notified.push(message) : (timers.notified = [message]),
    ...extra,
  });
  session.load(document);
  return { session, files, vault, timers, document };
}

test("édition contenue dans un seul segment : seul ce fichier est marqué modifié", () => {
  const { session, document } = createSession([
    ["A.md", "Bonjour"],
    ["B.md", "Monde"],
  ]);

  const result = session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Salut" }]);

  assert.ok(result);
  assert.deepEqual(result.touchedPaths, ["A.md"]);
  assert.equal(session.isDirty("A.md"), true);
  assert.equal(session.isDirty("B.md"), false);
  assert.equal(session.dirtyCount, 1);
});

test("sauvegarde différée : programmée à la première frappe, pas déclenchée avant le délai", () => {
  const { session, document, timers } = createSession([["A.md", "Bonjour"]]);
  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Salut" }]);

  assert.equal(timers.scheduled.length, 1);
  assert.equal(timers.scheduled[0].ms, 800);
});

test("flush() : redistribution exacte — seul le fichier modifié est réécrit, YAML préservé", async () => {
  const { session, document, vault, files } = createSession([
    ["A.md", "---\ntitle: A\n---\nAncien A"],
    ["B.md", "---\ntitle: B\n---\nAncien B"],
  ]);

  const offsetEndA = document.segments[0].to;
  session.handleChanges([{ from: 0, to: offsetEndA, insert: "Nouveau A" }]);

  await session.flush();

  assert.equal(await vault.read(files[0]), "---\ntitle: A\n---\nNouveau A");
  assert.equal(await vault.read(files[1]), "---\ntitle: B\n---\nAncien B", "fichier non modifié jamais réécrit");
  assert.equal(session.dirtyCount, 0);
});

test("flush() : redistribution correcte sur plusieurs fichiers modifiés dans le même lot", async () => {
  const { session, document, files, vault } = createSession([
    ["A.md", "AAAA"],
    ["B.md", "BBBB"],
    ["C.md", "CCCC"],
  ]);

  session.handleChanges([
    { from: document.segments[0].to, to: document.segments[0].to, insert: "!" },
    { from: document.segments[2].from, to: document.segments[2].from + 2, insert: "" },
  ]);

  await session.flush();

  assert.equal(await vault.read(files[0]), "AAAA!");
  assert.equal(await vault.read(files[1]), "BBBB");
  assert.equal(await vault.read(files[2]), "CC");
});

test("flush() : fichier vide correctement géré (corps vide, ajout en tête)", async () => {
  const { session, document, files, vault } = createSession([
    ["A.md", "Avant"],
    ["B.md", ""],
  ]);

  const offset = locationToCompositeOffset(document, "B.md", 0);
  session.handleChanges([{ from: offset, to: offset, insert: "Nouveau contenu" }]);
  await session.flush();

  assert.equal(await vault.read(files[1]), "Nouveau contenu");
});

test("modification externe détectée : refuse d'écraser, ne perd pas silencieusement", async () => {
  const { session, document, files, vault, timers } = createSession([["A.md", "Ancien corps"]]);

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Corps édité dans Scrivenings" }]);

  // Modification externe simulée après le chargement de la session.
  await vault.modify(files[0], "Corps modifié ailleurs entretemps");

  await session.flush();

  assert.equal(await vault.read(files[0]), "Corps modifié ailleurs entretemps", "jamais écrasé silencieusement");
  assert.ok(timers.notified?.some((msg) => msg.includes("A")));
});

/* --- LOT 1.2 : dirtyPaths ne doit JAMAIS être retiré avant un succès réel --- */

test("conflit externe : le chemin reste dirty après flush() — un flush ultérieur retente", async () => {
  const { session, document, files, vault } = createSession([["A.md", "Ancien corps"]]);

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Corps édité dans Scrivenings" }]);
  await vault.modify(files[0], "Corps modifié ailleurs entretemps");

  await session.flush();

  assert.equal(session.isDirty("A.md"), true, "un conflit ne doit jamais rendre le chemin silencieusement clean");
  assert.equal(session.dirtyCount, 1);
});

test("conflit externe : un flush ultérieur retente et réussit si le contenu externe est redevenu compatible", async () => {
  const { session, document, files, vault } = createSession([["A.md", "Ancien corps"]]);

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Corps édité dans Scrivenings" }]);
  await vault.modify(files[0], "Corps modifié ailleurs entretemps");
  await session.flush();
  assert.equal(session.isDirty("A.md"), true, "toujours dirty juste après le conflit");

  // L'écart externe est résorbé (ex. l'utilisateur annule l'autre
  // modification) : le corps disque redevient celui connu de la session.
  await vault.modify(files[0], "Ancien corps");
  await session.flush();

  assert.equal(session.isDirty("A.md"), false, "le retry doit réussir dès que le conflit n'a plus lieu d'être");
  assert.equal(await vault.read(files[0]), "Corps édité dans Scrivenings");
});

test("erreur d'écriture (Vault.process() qui rejette) : le chemin reste dirty, rien n'est perdu", async () => {
  const { session, document, files, vault, timers } = createSession([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  const originalProcess = vault.process.bind(vault);
  vault.process = async (file, fn) => {
    if (file.path === "A.md") throw new Error("disque indisponible");
    return originalProcess(file, fn);
  };

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Modifié A" }]);
  await session.flush();

  assert.equal(session.isDirty("A.md"), true, "l'échec d'écriture ne doit jamais rendre le chemin clean");
  assert.equal(await vault.read(files[0]), "Corps A", "le contenu disque n'a pas bougé après l'échec");
  assert.ok(timers.notified?.some((msg) => msg.includes("A")), "une notification doit signaler l'échec d'écriture");
});

test("erreur d'écriture sur UN segment n'empêche pas la sauvegarde correcte des autres segments dirty du même lot", async () => {
  const { session, document, files, vault } = createSession([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  const originalProcess = vault.process.bind(vault);
  vault.process = async (file, fn) => {
    if (file.path === "A.md") throw new Error("disque indisponible");
    return originalProcess(file, fn);
  };

  session.handleChanges([
    { from: 0, to: document.segments[0].to, insert: "Modifié A" },
    { from: document.segments[1].from, to: document.segments[1].to, insert: "Modifié B" },
  ]);
  await session.flush();

  assert.equal(session.isDirty("A.md"), true);
  assert.equal(session.isDirty("B.md"), false);
  assert.equal(await vault.read(files[1]), "Modifié B");
});

test("erreur d'écriture : aucun fichier non concerné par le flush n'est jamais écrit", async () => {
  const { session, document, files, vault } = createSession([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  let processedPaths = [];
  const originalProcess = vault.process.bind(vault);
  vault.process = async (file, fn) => {
    processedPaths.push(file.path);
    if (file.path === "A.md") throw new Error("disque indisponible");
    return originalProcess(file, fn);
  };

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Modifié A" }]);
  await session.flush();

  assert.deepEqual(processedPaths, ["A.md"], "B.md n'a jamais été touché, il n'était pas dirty");
  assert.equal(await vault.read(files[1]), "Corps B");
});

test("conflit externe : le frontmatter reste préservé (jamais écrasé, jamais perdu) malgré le refus d'écrire", async () => {
  const { session, document, files, vault } = createSession([["A.md", "---\ntitle: A\n---\nAncien corps"]]);

  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Corps édité dans Scrivenings" }]);
  await vault.modify(files[0], "---\ntitle: A modifié ailleurs\n---\nCorps modifié ailleurs entretemps");

  await session.flush();

  assert.equal(
    await vault.read(files[0]),
    "---\ntitle: A modifié ailleurs\n---\nCorps modifié ailleurs entretemps",
    "le frontmatter ET le corps externes restent intouchés en cas de conflit"
  );
});

test("flush() sans modification : n'écrit rien du tout", async () => {
  const { session, vault, files } = createSession([["A.md", "Corps"]]);
  let modifyCalls = 0;
  const originalModify = vault.modify.bind(vault);
  vault.modify = async (...args) => { modifyCalls++; return originalModify(...args); };

  await session.flush();

  assert.equal(modifyCalls, 0);
  assert.equal(await vault.read(files[0]), "Corps");
});

test("load() d'un nouveau scope réinitialise la session sans rien reporter de l'ancien", () => {
  const { session, document } = createSession([["A.md", "Corps A"]]);
  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Modifié" }]);
  assert.equal(session.dirtyCount, 1);

  const nextDoc = buildScriveningsDocument([{ file: session.document.segments[0].file, content: "Corps A" }]);
  session.load(nextDoc);

  assert.equal(session.dirtyCount, 0);
});

test("destroy() annule un minuteur en attente sans écrire", () => {
  const { session, document, timers } = createSession([["A.md", "Corps"]]);
  session.handleChanges([{ from: 0, to: document.segments[0].to, insert: "Modifié" }]);
  assert.equal(timers.scheduled.length, 1);

  session.destroy();
  assert.equal(timers.scheduled.length, 0);
});
