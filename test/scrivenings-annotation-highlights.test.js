import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ScriveningsView, ScriveningsSession } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import { addAnnotation } from "../src/services/annotations.js";
import { splitFrontmatter } from "../src/services/frontmatter.js";
import FeuilletsPlugin from "../src/main.js";

/* LOT 1.4 (§32-36, §61-62) — mapping des annotations existantes vers les
   offsets composites de Continu. `refreshAnnotationHighlights` réutilise
   EXACTEMENT le service `services/annotations.ts` (chargement, résolution)
   et `applyAnnotationHighlights` (cm-annotation-highlighter.ts) — jamais un
   second moteur. */

function fixture() {
  const root = new TFolder("Projet/Manuscrit");
  const fileA = new TFile("Projet/Manuscrit/A.md", "---\ntitle: X\n---\nAlpha bravo.");
  const fileB = new TFile("Projet/Manuscrit/B.md", "Charlie delta echo.");
  root.children = [fileA, fileB];
  fileA.parent = root;
  fileB.parent = root;
  const { vault, fileManager } = createFakeVault([root, fileA, fileB]);
  const app = { vault, fileManager, workspace: { getActiveFile: () => null } };
  const settings = { projectFolder: root.path };
  return { app, settings, root, fileA, fileB };
}

function makeCm(docLength) {
  const cm = { dispatched: [], state: { doc: { length: docLength } } };
  cm.dispatch = (spec) => cm.dispatched.push(spec);
  return cm;
}

function makeView({ app, settings, cm, document }) {
  const view = Object.create(ScriveningsView.prototype);
  view.plugin = { app, settings };
  view.cm = cm;
  view.session = { document };
  return view;
}

test("§34/§61 — annotation d'un segment AVEC frontmatter : mapping composite correct, jamais un offset YAML", async () => {
  const { app, settings, fileA, fileB } = fixture();
  const { frontmatter } = splitFrontmatter(fileA.content);

  const annotation = await addAnnotation(app, settings, {
    file: "A.md",
    start: frontmatter.length + 6,
    end: frontmatter.length + 11,
    quote: "bravo",
    prefix: "Alpha ",
    suffix: ".",
    text: "",
    color: "yellow",
    style: "highlight",
  });

  const document = buildScriveningsDocument([
    { file: fileA, content: fileA.content },
    { file: fileB, content: fileB.content },
  ]);
  const segA = document.segments[0];
  const cm = makeCm(document.text.length);
  const view = makeView({ app, settings, cm, document });

  await view.refreshAnnotationHighlights();

  assert.equal(cm.dispatched.length, 1);
  const decos = cm.dispatched[0].effects.value;
  assert.equal(decos.length, 1);
  assert.equal(decos[0].from, segA.from + 6);
  assert.equal(decos[0].to, segA.from + 11);
  assert.equal(decos[0].attributes["data-annotation-id"], annotation.id);
  // Jamais dans le frontmatter (segA.from marque le tout début du BODY) :
  assert.ok(decos[0].from >= segA.from, "jamais un offset YAML");
});

test("§62 — annotations de DEUX fichiers du scope : décorations aux offsets composites respectifs, ids/couleurs/styles conservés", async () => {
  const { app, settings, fileA, fileB } = fixture();
  const { frontmatter } = splitFrontmatter(fileA.content);

  const annA = await addAnnotation(app, settings, {
    file: "A.md",
    start: frontmatter.length,
    end: frontmatter.length + 5,
    quote: "Alpha",
    prefix: "",
    suffix: " bravo.",
    text: "",
    color: "yellow",
    style: "highlight",
  });
  const annB = await addAnnotation(app, settings, {
    file: "B.md",
    start: 0,
    end: 7,
    quote: "Charlie",
    prefix: "",
    suffix: " delta echo.",
    text: "note",
    color: "blue",
    style: "underline",
  });

  const document = buildScriveningsDocument([
    { file: fileA, content: fileA.content },
    { file: fileB, content: fileB.content },
  ]);
  const segA = document.segments[0];
  const segB = document.segments[1];
  const cm = makeCm(document.text.length);
  const view = makeView({ app, settings, cm, document });

  await view.refreshAnnotationHighlights();

  const decos = cm.dispatched[0].effects.value;
  assert.equal(decos.length, 2);
  const byId = Object.fromEntries(decos.map((d) => [d.attributes["data-annotation-id"], d]));

  assert.equal(byId[annA.id].from, segA.from);
  assert.equal(byId[annA.id].to, segA.from + 5);

  assert.equal(byId[annB.id].from, segB.from);
  assert.equal(byId[annB.id].to, segB.from + 7);
  assert.ok(byId[annB.id].class.includes("cm-annotation-highlight-blue"));
  assert.ok(byId[annB.id].class.includes("cm-annotation-style-underline"));
});

test("§34 — une annotation non résolue (passage disparu) n'est jamais dessinée", async () => {
  const { app, settings, fileA, fileB } = fixture();

  await addAnnotation(app, settings, {
    file: "A.md",
    start: 999,
    end: 1010,
    quote: "texte disparu introuvable",
    prefix: "avant",
    suffix: "après",
    text: "",
    color: "yellow",
    style: "highlight",
  });

  const document = buildScriveningsDocument([
    { file: fileA, content: fileA.content },
    { file: fileB, content: fileB.content },
  ]);
  const cm = makeCm(document.text.length);
  const view = makeView({ app, settings, cm, document });

  await view.refreshAnnotationHighlights();

  // Aucune annotation résolue : le champ est vidé (Decoration.none), jamais
  // une décoration devinée.
  assert.equal(cm.dispatched.length, 1);
  const value = cm.dispatched[0].effects.value;
  assert.ok(Array.isArray(value) ? value.length === 0 : value.none === true);
});

/* MICRO-CORRECTIF — « annotation créée non visible immédiatement en Continu ».
   §21 : preuve runtime structurelle — une annotation créée depuis Continu
   (via le callback `() => view.refreshAnnotationHighlights()`, exactement
   celui câblé par main.ts#showScriveningsContextMenu) doit être reçue par
   `applyAnnotationHighlights` SANS jamais fermer/rouvrir Continu, changer de
   scope, ni reconstruire l'EditorView. */

test("§21 — création depuis Continu (callback explicite) : la nouvelle annotation apparaît immédiatement dans le composite, sans réouverture", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const fileA = new TFile("Projet/Manuscrit/A.md", "Alpha bravo charlie.");
  root.children = [fileA];
  fileA.parent = root;
  const { vault, fileManager } = createFakeVault([root, fileA]);
  const app = { vault, fileManager, workspace: { getActiveFile: () => null } };
  const settings = { projectFolder: root.path };

  const document = buildScriveningsDocument([{ file: fileA, content: fileA.content }]);
  const segA = document.segments[0];
  const cm = makeCm(document.text.length);
  const view = makeView({ app, settings, cm, document });

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = settings;

  // Sélection "bravo" (offsets 6-11), directement dans le body du segment A —
  // exactement la surface qu'un ScriveningsSegmentEditorAdapter exposerait,
  // sans avoir besoin de l'adaptateur lui-même pour ce test structurel.
  const editor = {
    getValue: () => segA.body,
    somethingSelected: () => true,
    getCursor: (which) => ({ offset: which === "from" ? 6 : 11 }),
    posToOffset: (pos) => pos.offset,
  };

  // AVANT mutation : aucune décoration jamais dispatchée pour cette annotation.
  assert.equal(cm.dispatched.length, 0);

  const ok = await plugin.applyAnnotationOrUpdate(editor, fileA, "highlight", "yellow", () => view.refreshAnnotationHighlights());
  assert.equal(ok, true);

  // Immédiatement après — sans fermer/rouvrir Continu, sans openScope — le
  // composite reflète la nouvelle annotation.
  assert.equal(cm.dispatched.length, 1);
  const decos = cm.dispatched[0].effects.value;
  assert.equal(decos.length, 1);
  assert.equal(decos[0].from, segA.from + 6);
  assert.equal(decos[0].to, segA.from + 11);
});

/* §22 : une frappe ordinaire ne doit JAMAIS déclencher loadAnnotations() ni
   refreshAnnotationHighlights() — les décorations existantes suivent déjà
   `tr.changes` via `annotationHighlightField` (cm-annotation-highlighter.ts),
   jamais un rechargement du fichier annotations.json à chaque transaction. */

test("§22 — une transaction texte ordinaire dans Continu ne déclenche jamais refreshAnnotationHighlights", () => {
  const fileA = new TFile("A.md", "Bonjour");
  const fileB = new TFile("B.md", "Monde");
  const { vault } = createFakeVault([fileA, fileB]);
  const document = buildScriveningsDocument([
    { file: fileA, content: fileA.content },
    { file: fileB, content: fileB.content },
  ]);

  const session = new ScriveningsSession({
    app: { vault },
    scheduleTimeout: () => 1,
    cancelTimeout: () => {},
    notify: () => {},
  });
  session.load(document);

  let refreshCalls = 0;
  const view = Object.create(ScriveningsView.prototype);
  view.session = session;
  view.wordCounts = new Map();
  view.plugin = {};
  view.refreshAnnotationHighlights = async () => {
    refreshCalls++;
  };

  // Frappe ordinaire, contenue dans le segment A — même forme que ce que
  // `scriveningsChangeListener` transmet à `handleEditorChanges` (méthode
  // PRIVÉE mais simple propriété au runtime, appelée ici directement).
  view.handleEditorChanges([{ from: 0, to: document.segments[0].to, insert: "Salut" }]);

  assert.equal(refreshCalls, 0, "aucune transaction texte ordinaire ne doit jamais recharger les annotations");
});
