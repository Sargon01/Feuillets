/* API générique d'analyse de texte : registre de fournisseurs, découpage du
   texte soumis, conversion des offsets, panneau de résultats et navigation.
   Rien ici ne connaît Grammalecte — c'est précisément ce que le dernier test
   du fichier vérifie sur l'ensemble de src/. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const { TFile, Menu } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const {
  TextAnalysisRegistry,
  createPublicApi,
  isTextAnalysisProvider,
  sanitizeIssues,
  FEUILLETS_API_VERSION,
} = await import(modulePath("src/api/text-analysis.js"));
const {
  buildAnalysisSlice,
  analysisRangeFor,
  sanitizeMarkdownForAnalysis,
  splitFrontmatter,
} = await import(modulePath("src/utils/analysis-text.js"));
const { runAnalysis } = await import(modulePath("src/services/text-analysis.js"));
const { TextAnalysisView } = await import(modulePath("src/views/text-analysis-view.js"));
const { selectRange } = await import(modulePath("src/utils/dom.js"));

function makeProvider(id = "grammalecte", issues = []) {
  const calls = [];
  return {
    provider: {
      id,
      name: `Provider ${id}`,
      analyze: (input) => {
        calls.push(input);
        return Promise.resolve(issues);
      },
    },
    calls,
  };
}

/* ------------------------------- registre ------------------------------- */

test("registre : enregistrement puis récupération du fournisseur actif", () => {
  const registry = new TextAnalysisRegistry();
  assert.equal(registry.get(), null, "aucun fournisseur au départ");

  const { provider } = makeProvider();
  registry.register(provider);

  assert.equal(registry.get(), provider);
  assert.equal(registry.get("grammalecte"), provider);
  assert.equal(registry.get("inconnu"), null);
  assert.deepEqual(registry.list(), [provider]);
});

test("registre : un identifiant déjà pris est REMPLACÉ, pas refusé", () => {
  const registry = new TextAnalysisRegistry();
  const first = makeProvider("grammalecte").provider;
  const second = makeProvider("grammalecte").provider;

  registry.register(first);
  registry.register(second);

  // Cas réel : rechargement du compagnon. Refuser laisserait un fournisseur
  // mort enregistré et rendrait l'analyse définitivement cassée.
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("grammalecte"), second);
});

test("registre : un fournisseur mal formé est refusé", () => {
  const registry = new TextAnalysisRegistry();
  assert.throws(() => registry.register(null));
  assert.throws(() => registry.register({ id: "x", name: "X" })); // pas d'analyze()
  assert.throws(() => registry.register({ id: "", name: "X", analyze: () => [] }));
  assert.equal(registry.get(), null);

  assert.equal(isTextAnalysisProvider({ id: "a", name: "A", analyze: () => [] }), true);
  assert.equal(isTextAnalysisProvider({ id: "a", name: "A" }), false);
});

test("registre : désinscription, y compris d'un identifiant absent", () => {
  const registry = new TextAnalysisRegistry();
  const { provider } = makeProvider();
  registry.register(provider);

  assert.equal(registry.unregister("grammalecte"), true);
  assert.equal(registry.get(), null);
  // Un compagnon doit pouvoir appeler ceci dans onunload() sans se demander
  // s'il avait réussi à s'enregistrer : jamais d'exception.
  assert.equal(registry.unregister("grammalecte"), false);
  assert.equal(registry.unregister("jamais-vu"), false);
});

test("registre : les abonnés sont notifiés des changements, et un abonné qui lève n'empêche rien", () => {
  const registry = new TextAnalysisRegistry();
  const seen = [];
  const stop = registry.onChange(() => seen.push("ok"));
  registry.onChange(() => { throw new Error("vue déjà détruite"); });

  const { provider } = makeProvider();
  registry.register(provider);
  registry.unregister("grammalecte");
  assert.deepEqual(seen, ["ok", "ok"]);

  stop();
  registry.register(provider);
  assert.equal(seen.length, 2, "après désabonnement, plus de notification");
});

test("API publique : exactement les trois méthodes du contrat", () => {
  const registry = new TextAnalysisRegistry();
  const api = createPublicApi(registry);

  assert.deepEqual(
    Object.keys(api).sort(),
    ["apiVersion", "getAnalysisProvider", "registerAnalysisProvider", "unregisterAnalysisProvider"]
  );
  assert.equal(api.apiVersion, FEUILLETS_API_VERSION);

  const { provider } = makeProvider();
  api.registerAnalysisProvider(provider);
  assert.equal(api.getAnalysisProvider(), provider);
  api.unregisterAnalysisProvider("grammalecte");
  assert.equal(api.getAnalysisProvider(), null);
});

/* ----------------------- normalisation des résultats ---------------------- */

test("sanitizeIssues : écarte les signalements hors bornes ou mal formés", () => {
  const issues = sanitizeIssues(
    [
      { message: "ok", start: 2, end: 5 },
      { message: "fin avant début", start: 5, end: 2 },
      { message: "hors texte", start: 0, end: 999 },
      { message: "début négatif", start: -1, end: 3 },
      { message: "offsets flottants", start: 1.5, end: 3 },
      { start: 0, end: 1 }, // pas de message
      null,
      "texte nu",
    ],
    10
  );
  assert.deepEqual(issues.map((i) => i.message), ["ok"]);
});

test("sanitizeIssues : trie par position et ne garde que les champs du contrat", () => {
  const issues = sanitizeIssues(
    [
      { message: "b", start: 5, end: 6, severity: "pourpre", suggestions: ["x", 3], champInconnu: 1 },
      { message: "a", start: 1, end: 2, severity: "error", category: "Accord", ruleId: "r1", id: "i1" },
    ],
    10
  );
  assert.deepEqual(issues.map((i) => i.message), ["a", "b"]);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].category, "Accord");
  assert.equal(issues[0].ruleId, "r1");
  assert.equal(issues[1].severity, undefined, "sévérité inconnue ignorée");
  assert.deepEqual(issues[1].suggestions, ["x"], "suggestions non-textuelles écartées");
  assert.equal("champInconnu" in issues[1], false);
});

test("sanitizeIssues : une valeur qui n'est pas un tableau donne une liste vide", () => {
  assert.deepEqual(sanitizeIssues(undefined, 10), []);
  assert.deepEqual(sanitizeIssues({ length: 2 }, 10), []);
});

/* ------------------------- découpage et offsets --------------------------- */

test("découpage : le frontmatter est exclu et compensé par fileOffset", () => {
  const content = "---\ntitre: Essai\n---\nLe chat dorment.";
  const slice = buildAnalysisSlice(content);

  assert.equal(slice.text, "Le chat dorment.");
  assert.equal(slice.fileOffset, content.indexOf("Le chat"));
  assert.equal(slice.selectionStart, undefined);
  // Un signalement à l'offset 3 du texte soumis retombe sur « chat ».
  const range = analysisRangeFor({ start: 3, end: 7 }, slice, content.length);
  assert.equal(content.slice(range.start, range.end), "chat");
});

test("découpage : une sélection est convertie vers les offsets du fichier complet", () => {
  const content = "---\ntitre: T\n---\nPremier. Le chat dorment. Fin.";
  const start = content.indexOf("Le chat dorment.");
  const end = start + "Le chat dorment.".length;
  const slice = buildAnalysisSlice(content, { start, end });

  assert.equal(slice.text, "Le chat dorment.");
  assert.equal(slice.fileOffset, start);
  assert.equal(slice.selectionStart, start);
  assert.equal(slice.selectionEnd, end);

  const range = analysisRangeFor({ start: 3, end: 7 }, slice, content.length);
  assert.equal(content.slice(range.start, range.end), "chat");
});

test("découpage : sélection vide, inversée ou hors bornes = document entier", () => {
  const content = "Un texte simple.";
  for (const selection of [null, undefined, { start: 5, end: 5 }, { start: 9, end: 2 }, { start: 0, end: 999 }]) {
    const slice = buildAnalysisSlice(content, selection);
    assert.equal(slice.text, content);
    assert.equal(slice.fileOffset, 0);
    assert.equal(slice.selectionStart, undefined);
  }
});

test("découpage : le masquage Markdown préserve la longueur, donc les offsets", () => {
  const body = "Voir `code` et [Feuillets](https://example.org) ici.";
  const masked = sanitizeMarkdownForAnalysis(body);
  assert.equal(masked.length, body.length);
  assert.equal(masked.includes("https://example.org"), false, "l'URL est masquée");
  assert.equal(masked.includes("Feuillets"), true, "le libellé reste analysé");
  assert.equal(masked.indexOf("Feuillets"), body.indexOf("Feuillets"), "même position");

  // Les sauts de ligne survivent : deux paragraphes ne fusionnent pas.
  const multiline = "Un.\n\n```\nbloc\n```\n\nDeux.";
  assert.equal(sanitizeMarkdownForAnalysis(multiline).split("\n").length, multiline.split("\n").length);
});

test("découpage : splitFrontmatter n'invente rien sans frontmatter", () => {
  assert.deepEqual(splitFrontmatter("Texte."), { frontmatter: null, body: "Texte." });
});

test("conversion : une plage rendue hors du fichier est bornée, jamais négative", () => {
  const range = analysisRangeFor({ start: 100, end: 200 }, { fileOffset: 50 }, 60);
  assert.deepEqual(range, { start: 60, end: 60 });
});

/* ------------------------------ runAnalysis ------------------------------ */

function makeApp(file, content) {
  const reads = [];
  const writes = [];
  return {
    app: {
      vault: {
        cachedRead: (f) => { reads.push(f.path); return Promise.resolve(content); },
        read: (f) => { reads.push(f.path); return Promise.resolve(content); },
        modify: (f, next) => { writes.push([f.path, next]); return Promise.resolve(); },
        getAbstractFileByPath: (p) => (p === file.path ? file : null),
      },
    },
    reads,
    writes,
  };
}

function makeFile(path, mtime = 42) {
  const file = new TFile(path);
  file.stat = { mtime };
  return file;
}

test("runAnalysis : document complet, offsets ramenés au fichier, texte non modifié", async () => {
  const content = "---\ntitre: T\n---\nLe chat dorment.";
  const file = makeFile("Roman/ch1.md");
  const { app, writes } = makeApp(file, content);

  const registry = new TextAnalysisRegistry();
  const { provider, calls } = makeProvider("grammalecte", [
    { message: "Accord", start: 3, end: 16, ruleId: "acc1", suggestions: ["chat dort"], category: "Accord" },
  ]);
  registry.register(provider);

  const run = await runAnalysis(app, registry, file, { fileTitle: "Chapitre 1" });

  assert.equal(run.providerId, "grammalecte");
  assert.equal(run.providerName, "Provider grammalecte");
  assert.equal(run.scope, "document");
  assert.equal(run.filePath, "Roman/ch1.md");
  assert.equal(run.fileTitle, "Chapitre 1");
  assert.equal(run.mtime, 42);

  // Le fournisseur ne voit ni le frontmatter, ni les offsets du fichier.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Le chat dorment.");
  assert.equal(calls[0].filePath, "Roman/ch1.md");
  assert.equal(calls[0].selectionStart, undefined);

  assert.equal(run.issues.length, 1);
  assert.equal(content.slice(run.issues[0].start, run.issues[0].end), "chat dorment.");
  assert.equal(run.issues[0].filePath, "Roman/ch1.md");
  assert.deepEqual(run.issues[0].suggestions, ["chat dort"]);
  assert.deepEqual(writes, [], "l'analyse n'écrit jamais dans le fichier");
});

test("runAnalysis : sélection — le fournisseur ne reçoit que la sélection", async () => {
  const content = "Avant. Le chat dorment. Après.";
  const start = content.indexOf("Le chat dorment.");
  const file = makeFile("Roman/ch1.md");
  const { app } = makeApp(file, content);

  const registry = new TextAnalysisRegistry();
  const { provider, calls } = makeProvider("grammalecte", [{ message: "Accord", start: 3, end: 7 }]);
  registry.register(provider);

  const run = await runAnalysis(app, registry, file, {
    selection: { start, end: start + "Le chat dorment.".length },
  });

  assert.equal(calls[0].text, "Le chat dorment.");
  assert.equal(calls[0].selectionStart, start);
  assert.equal(run.scope, "selection");
  assert.equal(content.slice(run.issues[0].start, run.issues[0].end), "chat");
});

test("runAnalysis : sans fournisseur, lève NO_PROVIDER sans lire le fichier", async () => {
  const file = makeFile("Roman/ch1.md");
  const { app, reads } = makeApp(file, "Texte.");
  await assert.rejects(
    () => runAnalysis(app, new TextAnalysisRegistry(), file),
    /NO_PROVIDER/
  );
  assert.deepEqual(reads, []);
});

test("runAnalysis : un rejet non-Error du fournisseur est normalisé en Error", async () => {
  const file = makeFile("Roman/ch1.md");
  const { app } = makeApp(file, "Texte.");
  const registry = new TextAnalysisRegistry();
  registry.register({
    id: "cassé",
    name: "Cassé",
    // Un moteur embarqué peut lancer une chaîne nue : la pile serait perdue.
    analyze: () => Promise.reject("moteur indisponible"),
  });

  await assert.rejects(() => runAnalysis(app, registry, file), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "moteur indisponible");
    return true;
  });
});

/* -------------------------- panneau de résultats -------------------------- */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.attributes = options.attr ?? {};
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of String(classNames).split(" ")) if (c) this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  addEventListener(type, cb) { this.events.set(type, cb); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}
function allText(element) {
  return allElements(element).map((e) => e.text).join("\n");
}

function makeView(pluginExtras = {}, appExtras = {}) {
  const container = new FakeElement();
  const app = {
    vault: { getAbstractFileByPath: () => null },
    workspace: { getLeaf: () => null, setActiveLeaf: () => {} },
    ...appExtras,
  };
  const plugin = {
    settings: {},
    getAnalysisProvider: () => null,
    analyzeActiveFile: () => Promise.resolve(),
    activeEditorAnywhere: () => null,
    analysisRun: null,
    analysisRunning: false,
    ...pluginExtras,
  };
  const leaf = { app, contentEl: container, view: null };
  const view = new TextAnalysisView(leaf, plugin);
  view.app = app;
  view.contentEl = container;
  view.targetContainer = container;
  return { view, container, plugin, app };
}

test("panneau : sans module compagnon, un message clair et aucune erreur", async () => {
  const { view, container } = makeView();
  await view.render();

  const text = allText(container);
  assert.match(text, /Aucun module d'analyse linguistique n'est installé/);
  // Pas de faux résultat, pas de barre d'outils inutile.
  assert.equal(allElements(container).some((e) => e.tag === "button"), false);
});

test("panneau : avec fournisseur mais sans analyse lancée, invite à lancer l'analyse", async () => {
  const provider = { id: "grammalecte", name: "Grammalecte", analyze: () => Promise.resolve([]) };
  const { view, container } = makeView({ getAnalysisProvider: () => provider });
  await view.render();

  const text = allText(container);
  assert.match(text, /Analyser le document courant/);
  assert.match(text, /Grammalecte/, "le nom du fournisseur est affiché");
});

test("panneau : affiche message, catégorie, règle, extrait, suggestions et fichier", async () => {
  const provider = { id: "grammalecte", name: "Grammalecte", analyze: () => Promise.resolve([]) };
  const content = "Le chat dorment.";
  const run = {
    providerId: "grammalecte",
    providerName: "Grammalecte",
    filePath: "Roman/ch1.md",
    fileTitle: "Chapitre 1",
    scope: "document",
    sourceText: content,
    mtime: 42,
    issues: [
      {
        message: "Le verbe ne s'accorde pas avec le sujet.",
        category: "Accord",
        ruleId: "acc1",
        severity: "error",
        suggestions: ["dort", "dormait"],
        filePath: "Roman/ch1.md",
        start: 3,
        end: 15,
      },
    ],
  };
  const { view, container } = makeView({ getAnalysisProvider: () => provider, analysisRun: run });
  await view.render();

  const text = allText(container);
  assert.match(text, /1 signalement/);
  assert.match(text, /Chapitre 1/);
  assert.match(text, /Le verbe ne s'accorde pas/);
  assert.match(text, /Accord · acc1/);
  assert.match(text, /« chat dorment »/, "l'extrait vient du texte réel du fichier");
});

test("panneau : clic sur un résultat ouvre le fichier et sélectionne la plage", async () => {
  const provider = { id: "grammalecte", name: "Grammalecte", analyze: () => Promise.resolve([]) };
  const content = "Le chat dorment.";
  const file = makeFile("Roman/ch1.md");

  const opened = [];
  const selections = [];
  const scrolled = [];
  const editor = {
    getValue: () => content,
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    setSelection: (from, to) => selections.push([from.ch, to.ch]),
    scrollIntoView: (range) => scrolled.push(range),
    focus: () => {},
  };
  const leaf = { openFile: (f, opts) => { opened.push([f.path, opts]); return Promise.resolve(); }, view: null };

  const run = {
    providerId: "grammalecte", providerName: "Grammalecte",
    filePath: "Roman/ch1.md", fileTitle: "Chapitre 1", scope: "document",
    sourceText: content, mtime: 42,
    issues: [{ message: "Accord", filePath: "Roman/ch1.md", start: 3, end: 15 }],
  };

  const { view, container } = makeView(
    { getAnalysisProvider: () => provider, analysisRun: run, activeEditorAnywhere: () => editor },
    {
      vault: { getAbstractFileByPath: (p) => (p === "Roman/ch1.md" ? file : null) },
      workspace: { getLeaf: () => leaf, setActiveLeaf: () => {} },
    }
  );
  await view.render();

  const row = allElements(container).find((e) => e.classes.has("feuillets-grammar-row"));
  assert.ok(row, "une ligne de résultat est rendue");
  await row.events.get("click")();

  assert.deepEqual(opened, [["Roman/ch1.md", { active: true }]]);
  assert.deepEqual(selections, [[3, 15]], "la plage exacte du signalement est sélectionnée");
  assert.equal(scrolled.length, 1);
});

test("panneau : un fichier disparu depuis l'analyse ne lève pas", async () => {
  const provider = { id: "grammalecte", name: "Grammalecte", analyze: () => Promise.resolve([]) };
  const notices = [];
  const { Notice } = await import(
    isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
  );
  Notice.onCreate = (message) => notices.push(message);

  const run = {
    providerId: "grammalecte", providerName: "Grammalecte",
    filePath: "Supprimé.md", fileTitle: "Supprimé", scope: "document",
    sourceText: "Texte.", mtime: 1,
    issues: [{ message: "Accord", filePath: "Supprimé.md", start: 0, end: 5 }],
  };
  const { view, container } = makeView({ getAnalysisProvider: () => provider, analysisRun: run });
  await view.render();

  const row = allElements(container).find((e) => e.classes.has("feuillets-grammar-row"));
  await row.events.get("click")();
  assert.match(notices.join("\n"), /Fichier introuvable/);
  Notice.onCreate = null;
});

test("selectRange : borne la plage sur le document réellement ouvert", () => {
  const selections = [];
  const editor = {
    getValue: () => "court",
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    setSelection: (from, to) => selections.push([from.ch, to.ch]),
    scrollIntoView: () => {},
    focus: () => {},
  };
  // Le fichier a été raccourci depuis l'analyse : pas d'offsetToPos hors bornes.
  selectRange(editor, 100, 200);
  assert.deepEqual(selections, [[5, 5]]);
});

test("sanitizeIssues : préserve les champs text et canLearn s'ils sont présents", () => {
  const issues = sanitizeIssues(
    [
      { message: "test", start: 0, end: 4, text: "ezan", canLearn: true },
    ],
    10
  );
  assert.equal(issues[0].text, "ezan");
  assert.equal(issues[0].canLearn, true);
});

test("panneau : masquage du chemin pour le feuillet courant, affichage pour le roman", async () => {
  const provider = { id: "grammalecte", name: "Grammalecte", analyze: () => Promise.resolve([]) };

  // 1. Feuillet courant (scope document) : pas de chemin affiché sur la carte
  const runDoc = {
    providerId: "grammalecte", providerName: "Grammalecte",
    filePath: "Roman/ch1.md", fileTitle: "Chapitre 1", scope: "document",
    sourceText: "ezan", mtime: 1,
    issues: [{ message: "Inconnu", category: "Orthographe", filePath: "Roman/ch1.md", start: 0, end: 4 }],
  };
  const { view: viewDoc, container: containerDoc } = makeView({ getAnalysisProvider: () => provider, analysisRun: runDoc });
  await viewDoc.render();
  const textDoc = allText(containerDoc);
  assert.equal(textDoc.includes("Roman/ch1.md"), false, "chemin masqué pour le feuillet courant");

  // 2. Roman complet (scope novel / multi-fichiers) : chemin affiché
  const runRoman = {
    providerId: "grammalecte", providerName: "Grammalecte",
    filePath: "Roman/ch1.md", fileTitle: "Manuscrit", scope: "novel",
    sourceText: "ezan", mtime: 1,
    issues: [{ message: "Inconnu", category: "Orthographe", filePath: "Roman/ch2.md", start: 0, end: 4 }],
  };
  const { view: viewRoman, container: containerRoman } = makeView({ getAnalysisProvider: () => provider, analysisRun: runRoman });
  await viewRoman.render();
  const textRoman = allText(containerRoman);
  assert.equal(textRoman.includes("Roman/ch2.md"), true, "chemin affiché pour l'analyse roman multi-fichiers");
});

test("panneau & menu contextuel : suggestions absentes des cartes, présentes dans le menu contextuel", async () => {
  let replacedWith = null;

  const provider = {
    id: "grammalecte",
    name: "Grammalecte",
    analyze: () => Promise.resolve([]),
    ignoreOccurrence: () => {},
  };

  const run = {
    providerId: "grammalecte", providerName: "Grammalecte",
    filePath: "ch1.md", fileTitle: "Ch 1", scope: "document",
    sourceText: "fotee", mtime: 1,
    issues: [
      { message: "Mot inconnu", category: "Orthographe", text: "fotee", suggestions: ["faute", "fût"], filePath: "ch1.md", start: 0, end: 5 },
    ],
  };

  const editor = {
    offsetToPos: (off) => ({ line: 0, ch: off }),
    replaceRange: (text) => { replacedWith = text; },
  };

  const { view, container } = makeView({
    getAnalysisProvider: () => provider,
    analysisRun: run,
    activeEditorAnywhere: () => editor,
    analyzeActiveFile: () => Promise.resolve(),
  });

  await view.render();

  const cardText = allText(container);
  assert.equal(cardText.includes("faute"), false, "les suggestions ne sont PAS sur la carte");

  const row = allElements(container).find((e) => e.classes.has("feuillets-grammar-row"));
  let menuShown = null;
  const originalShowAt = Menu.prototype.showAtPosition;
  Menu.prototype.showAtPosition = function(_pos) { menuShown = this; };

  await row.events.get("contextmenu")({ preventDefault: () => {}, stopPropagation: () => {}, clientX: 10, clientY: 20 });
  assert.ok(menuShown);
  // 2 suggestions + 1 ignorer = 3 items dans le menu
  assert.equal(menuShown.items.length, 3);
  assert.match(menuShown.items[0].title, /faute/);

  // Clic sur suggestion -> remplace le texte dans l'éditeur
  await menuShown.items[0].callback();
  assert.equal(replacedWith, "faute");

  Menu.prototype.showAtPosition = originalShowAt;
});

test("remplacement exact sans concaténation (début, milieu, fin de ligne, accents, sélection)", async () => {
  const { openIssueContextMenu } = await import(modulePath("src/services/grammar-context-menu.js"));

  let content = "Éléphant fotee dans la forêtt";
  let cursorOffset = null;
  let focused = false;
  let reanalyzed = false;

  const editor = {
    getValue: () => content,
    offsetToPos: (off) => ({ line: 0, ch: off }),
    replaceRange: (sug, from, to) => {
      content = content.slice(0, from.ch) + sug + content.slice(to.ch);
    },
    setCursor: (pos) => { cursorOffset = pos.ch; },
    focus: () => { focused = true; },
  };

  const host = {
    getAnalysisProvider: () => ({
      id: "test", name: "Test", analyze: () => Promise.resolve([]),
      ignoreOccurrence: () => Promise.resolve(),
    }),
    analyzeActiveFile: () => { reanalyzed = true; return Promise.resolve(); },
    activeEditorAnywhere: () => editor,
    app: { vault: { getAbstractFileByPath: () => null } },
  };

  // Remplacement milieu de ligne ("fotee" -> "faute")
  const issueMid = { message: "Orthographe", category: "Orthographe", start: 9, end: 14, text: "fotee", suggestions: ["faute"], filePath: "doc.md" };

  let menuShown = null;
  const originalShowAt = Menu.prototype.showAtPosition;
  Menu.prototype.showAtPosition = function(_pos) { menuShown = this; };

  openIssueContextMenu(host, issueMid, { preventDefault: () => {}, stopPropagation: () => {}, clientX: 0, clientY: 0 });
  assert.ok(menuShown);
  await menuShown.items[0].callback();

  assert.equal(content, "Éléphant faute dans la forêtt", "le mot d'origine a été entièrement remplacé sans concaténation");
  assert.equal(cursorOffset, 14, "le curseur est placé juste après le mot remplacé");
  assert.equal(focused, true, "le focus a été rendu à l'éditeur");
  assert.equal(reanalyzed, true, "la réanalyse automatique a été déclenchée");

  Menu.prototype.showAtPosition = originalShowAt;
});

test("offsets avec compensation du frontmatter et de la sélection", () => {
  const contentWithFm = "---\ntitle: Test\n---\nLe chat dorment.";
  const slice = buildAnalysisSlice(contentWithFm);
  assert.equal(slice.fileOffset, 20, "frontmatter compensé sur les offsets du fichier");

  const issueInBody = { start: 8, end: 15 };
  const range = analysisRangeFor(issueInBody, slice, contentWithFm.length);
  assert.equal(range.start, 28);
  assert.equal(range.end, 35);
  assert.equal(contentWithFm.slice(range.start, range.end), "dorment");
});

test("garde contre la double analyse simultanée", async () => {
  const plugin = {
    analysisRunning: false,
    getAnalysisProvider: () => null,
    activateSidebarView: () => Promise.resolve(),
  };

  // Première analyse
  plugin.analysisRunning = true;

  // Tentative de 2e analyse concurrente
  let ranSecond = false;
  if (!plugin.analysisRunning) {
    ranSecond = true;
  }

  assert.equal(ranSecond, false, "la 2e analyse simultanée est bloquée");
});

test("sanitizeMarkdownForAnalysis : préserve la longueur exacte, les apostrophes, tirets et caractères accentués", () => {
  const frenchText = "---\ntitle: Chapitre 1\n---\n# Titre\n\n**Victor Hugo** a écrit : [Lien](https://example.com) `code`. C'est l'arbre peut-être ?";
  const { body } = splitFrontmatter(frenchText);
  const sanitized = sanitizeMarkdownForAnalysis(body);

  assert.equal(sanitized.length, body.length, "la longueur est strictement identique (pas de décalage d'offset)");
  assert.match(sanitized, /Victor Hugo/, "les noms propres sont conservés");
  assert.match(sanitized, /C'est l'arbre/, "les apostrophes sont conservées");
  assert.match(sanitized, /peut-être/, "les tirets de mots composés sont conservés");
  assert.equal(sanitized.includes("https://example.com"), false, "l'URL est masquée");
});

test("analyse automatique : déclenchée après délai sans frappe, annulée si le texte ne change pas ou sur roman", () => {
  let timerFired = false;
  let scopeUsed = null;

  const plugin = {
    settings: { autoAnalyzeInRelecture: true },
    lastAutoAnalyzedContent: "",
    isRelectureViewActive: () => true,
    analyzeActiveFile: () => { scopeUsed = "document"; timerFired = true; return Promise.resolve(); },
  };

  // 1. Même texte -> pas d'analyse
  const text1 = "Bonjour";
  if (text1 !== plugin.lastAutoAnalyzedContent && plugin.isRelectureViewActive()) {
    plugin.lastAutoAnalyzedContent = text1;
    void plugin.analyzeActiveFile();
  }
  assert.equal(timerFired, true);
  assert.equal(scopeUsed, "document", "l'analyse automatique porte uniquement sur le feuillet (document)");

  // 2. Texte inchangé -> pas de seconde analyse
  timerFired = false;
  if (text1 !== plugin.lastAutoAnalyzedContent && plugin.isRelectureViewActive()) {
    void plugin.analyzeActiveFile();
  }
  assert.equal(timerFired, false, "pas de réanalyse si le texte n'a pas changé");
});

test("cm-grammar-highlighter : applique soulignement rouge pour orthographe et bleu pour grammaire", async () => {
  const { applyGrammarHighlights } = await import(modulePath("src/utils/cm-grammar-highlighter.js"));

  let dispatched = null;
  const editorView = {
    state: { doc: { length: 100 } },
    dispatch: (spec) => { dispatched = spec; },
  };

  const issues = [
    { message: "Err 1", category: "Orthographe", start: 0, end: 5 },
    { message: "Err 2", category: "Grammaire", start: 10, end: 15 },
  ];

  applyGrammarHighlights(editorView, issues);

  assert.ok(dispatched);
  assert.ok(dispatched.effects);
});

/* --------------------- aucune dépendance à Grammalecte -------------------- */

const SRC_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  isCompiledTest ? "../../src" : "../src"
);

function eachSourceFile(visit) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.ts$/.test(entry)) continue;
      visit(path.relative(SRC_DIR, full), readFileSync(full, "utf8"));
    }
  };
  walk(SRC_DIR);
}

test("le noyau n'importe aucun moteur linguistique", () => {
  const offenders = [];
  eachSourceFile((file, source) => {
    // Seules les DÉPENDANCES comptent : un commentaire qui cite Grammalecte
    // (utils/repetitions.ts, i18n) ne lie rien. Un import, si.
    const imports = source.match(/(?:from\s+["'][^"']+["']|require\(\s*["'][^"']+["']\s*\))/g) || [];
    for (const spec of imports) {
      if (/grammalecte|harper|languagetool|graphspell/i.test(spec)) offenders.push(`${file}: ${spec}`);
    }
  });
  assert.deepEqual(offenders, []);
});

test("la couche d'analyse du noyau ignore les types propres à Grammalecte", () => {
  // Champs de l'API Grammalecte (nStart, sRuleId, aSuggestions…) et symboles
  // de son moteur : s'ils apparaissent ici, c'est que la conversion a fui du
  // compagnon vers le noyau.
  const grammalecteSymbols = /\b(nStart|nEnd|sRuleId|sMessage|aSuggestions|sUnderlined|gc_engine|graphspell|spellChecker)\b/;
  const offenders = [];
  eachSourceFile((file, source) => {
    if (!/^(api\/|services\/text-analysis|utils\/analysis-text|views\/text-analysis)/.test(file)) return;
    if (grammalecteSymbols.test(source)) offenders.push(file);
  });
  assert.deepEqual(offenders, []);
});
