/* Intégration du moteur de contexte indépendant (context-index.js /
 * context-matcher.js) dans NotesView.renderCitedEntities() — réutilise
 * EXCLUSIVEMENT l'association Binder ↔ Recherche déjà existante
 * (plugin.getLinkedResearchFolder, voir main.ts). Voir aussi
 * test/context-index.test.js et test/context-matcher.test.js pour les
 * moteurs eux-mêmes, testés indépendamment de toute vue. */
import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { NotesView } = await import(modulePath("src/views/notes-view.js"));
// La VRAIE implémentation (utils/core.js), pas une resimulation : les tests
// "Historique" exercent le même parseStoryDate que la production, y compris
// ses limites connues (n'accepte que string/number/boolean — d'où le
// passage systématique par toChronologyDateInput() côté NotesView).
const { parseStoryDate } = await import(modulePath("src/utils/core.js"));

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
    child.parentEl = this;
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  removeEventListener(type, callback) { if (this.events.get(type) === callback) this.events.delete(type); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  remove() {
    if (this.parentEl) this.parentEl.children = this.parentEl.children.filter((c) => c !== this);
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

/** Éditeur Markdown minimal : seuls getValue/getCursor/posToOffset sont
 * consultés par NotesView (activeSourceEditorFor/cursorContextWindow).
 * `posToOffset` ignore l'EditorPosition reçu et renvoie directement
 * `cursorOffset` — inutile de simuler une conversion ligne/colonne pour
 * ces tests, seul l'offset final compte. */
function fakeEditor(text, cursorOffset) {
  return {
    getValue: () => text,
    getCursor: () => ({ line: 0, ch: 0 }),
    posToOffset: () => cursorOffset,
  };
}

/** Pose un éditeur Markdown actif pour `file` — retourne la vue simulée
 * (toujours la MÊME instance à chaque appel de getActiveViewOfType, sinon
 * un test qui la récupère deux fois pour y déclencher un événement
 * n'attraperait pas le bon élément DOM). */
function setActiveEditor(app, file, editor, mode = "source") {
  const activeView = { file, editor, contentEl: new FakeElement(), getMode: () => mode };
  app.workspace.getActiveViewOfType = () => activeView;
  return activeView;
}

/** Minuteurs contrôlés à la main (même schéma que preview-view.test.js) :
 * NotesView utilise window.setTimeout/clearTimeout pour son débounce
 * (~300 ms), absents par défaut de l'environnement Node des tests. */
function installFakeTimers() {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let nextId = 1;
  globalThis.window = {
    setTimeout: (fn) => { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  return {
    pendingCount: () => timers.size,
    runAll() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    restore() { globalThis.window = previousWindow; },
  };
}

/** Construit un projet minimal avec :
 * - un Binder (Manuscrit/Chapitre1/scene.md, feuillet actif) ;
 * - un dossier Recherche général du projet (_Recherche), avec un
 *   sous-dossier (_Recherche/Sub) ;
 * - un dossier Recherche imbriqué associé au CHAPITRE (_Recherche/Chapitre1) ;
 * - un dossier Recherche imbriqué associé au FEUILLET lui-même
 *   (_Recherche/Chapitre1/Feuillet, donc AUSSI sous le dossier du chapitre
 *   et sous la recherche générale — sert au test de déduplication) ;
 * - un dossier hors de toute source autorisée (Ailleurs). */
function buildProject() {
  const root = new TFolder("Projet");

  const manuscritFolder = new TFolder("Projet/Manuscrit");
  manuscritFolder.parent = root;
  const chapterFolder = new TFolder("Projet/Manuscrit/Chapitre1");
  chapterFolder.parent = manuscritFolder;
  manuscritFolder.children = [chapterFolder];

  const activeFile = new TFile("Projet/Manuscrit/Chapitre1/scene.md", "Corps du feuillet");
  activeFile.parent = chapterFolder;
  chapterFolder.children = [activeFile];

  const researchRoot = new TFolder("Projet/_Recherche");
  researchRoot.parent = root;
  const chapterResearch = new TFolder("Projet/_Recherche/Chapitre1");
  chapterResearch.parent = researchRoot;
  const feuilletResearch = new TFolder("Projet/_Recherche/Chapitre1/Feuillet");
  feuilletResearch.parent = chapterResearch;
  const subParis = new TFolder("Projet/_Recherche/Sub");
  subParis.parent = researchRoot;

  // Titrée "Carte Secrète" : présente sous feuilletResearch ET (par
  // imbrication) sous chapterResearch ET researchRoot — sert à la fois au
  // test "trouvée via le feuillet" et au test de déduplication multi-source.
  const ducA = new TFile("Projet/_Recherche/Chapitre1/Feuillet/DucA.md");
  ducA.parent = feuilletResearch;
  feuilletResearch.children = [ducA];

  // Titrée "Bragance Seul" : présente sous chapterResearch (et researchRoot
  // par imbrication) mais PAS sous feuilletResearch.
  const ducB = new TFile("Projet/_Recherche/Chapitre1/DucB.md");
  ducB.parent = chapterResearch;
  chapterResearch.children = [feuilletResearch, ducB];

  // Titrée "Bibliotheque Royale" : uniquement à la racine de la recherche
  // générale du projet, hors de tout dossier lié à un chapitre/feuillet.
  const ducC = new TFile("Projet/_Recherche/DucC.md");
  ducC.parent = researchRoot;
  const lisbonne = new TFile("Projet/_Recherche/Lisbonne.md");
  lisbonne.parent = researchRoot;
  const tagFile = new TFile("Projet/_Recherche/TagOnly.md");
  tagFile.parent = researchRoot;

  const parisFile = new TFile("Projet/_Recherche/Sub/Paris.md");
  parisFile.parent = subParis;
  subParis.children = [parisFile];

  // Titre/basename NE correspondent à rien dans le texte : seul son alias
  // de frontmatter ("Chat Botté") doit permettre de la retrouver — c'est
  // exactement la régression à corriger (l'ancienne détection utilisait
  // déjà les aliases, la chaîne buildContextIndex/matchContext les avait
  // perdus).
  const aliasFile = new TFile("Projet/_Recherche/Marquis.md");
  aliasFile.parent = researchRoot;

  researchRoot.children = [chapterResearch, ducC, lisbonne, subParis, tagFile, aliasFile];

  const outsideFolder = new TFolder("Projet/Ailleurs");
  outsideFolder.parent = root;
  const etranger = new TFile("Projet/Ailleurs/Etranger.md");
  etranger.parent = outsideFolder;
  outsideFolder.children = [etranger];

  root.children = [manuscritFolder, researchRoot, outsideFolder];

  const nodes = [
    root, manuscritFolder, chapterFolder, activeFile,
    researchRoot, chapterResearch, feuilletResearch, subParis,
    ducA, ducB, ducC, lisbonne, tagFile, parisFile, aliasFile,
    outsideFolder, etranger,
  ];
  const filesByPath = new Map(nodes.map((n) => [n.path, n]));

  const titles = {
    [ducA.path]: "Carte Secrète",
    [ducB.path]: "Bragance Seul",
    [ducC.path]: "Bibliotheque Royale",
    [lisbonne.path]: "Séisme de Lisbonne",
    [parisFile.path]: "Paris",
    [tagFile.path]: "Fiche007",
    [etranger.path]: "Etranger",
    [aliasFile.path]: "Fiche 42", // ne correspond à rien dans les textes de test
  };
  const tags = {
    [tagFile.path]: ["complot"],
  };
  const aliases = {
    [aliasFile.path]: ["Chat Botté"],
  };

  return {
    root, manuscritFolder, chapterFolder, activeFile,
    researchRoot, chapterResearch, feuilletResearch, subParis,
    ducA, ducB, ducC, lisbonne, tagFile, parisFile, aliasFile,
    outsideFolder, etranger,
    filesByPath, titles, tags, aliases,
  };
}

function createView(project) {
  const contentEl = new FakeElement();
  const app = {
    vault: {
      getAbstractFileByPath: (path) => project.filesByPath.get(path) ?? null,
      cachedRead: async (file) => file.content || "",
    },
    workspace: {
      getActiveFile: () => project.activeFile,
    },
    metadataCache: {},
  };
  const plugin = {
    settings: { collapsed: {} },
    getProjectFolder: () => project.root,
    getResearchRoot: () => project.researchRoot,
    // Réutilise EXACTEMENT la forme de l'association déjà existante :
    // plugin.getLinkedResearchFolder(TFile | TFolder) → TFolder | null
    // (voir main.ts, researchFolderLinks).
    getLinkedResearchFolder: (node) => {
      if (node.path === project.activeFile.path) return project.feuilletResearch;
      if (node.path === project.chapterFolder.path) return project.chapterResearch;
      return null;
    },
    roleOfFolder: (folder) => (folder.path === project.chapterFolder.path ? "chapitre" : "partie"),
    tagsOf: (file) => project.tags[file.path] || [],
    titleFor: (file) => project.titles[file.path] || file.basename,
    parseStoryDate: (raw, file) => parseStoryDate(raw, file ?? null),
    getChronoFolder: () => null,
    async saveSettings() {},
  };
  const view = new NotesView({ app, contentEl }, plugin);
  // aliasesOf() lit this.fm(file)?.aliases (même cache de métadonnées
  // qu'utilisait déjà l'ancienne détection, voir NotesView.aliasesOf) ; le
  // système historique (âge/mort/évolution) lit this.fm(file)?.date/birth/
  // death sur CE MÊME accès — project.frontmatter permet à un test de poser
  // ces champs par fichier sans construire un vrai frontmatter YAML.
  view.fm = (file) => ({ aliases: project.aliases?.[file.path], ...project.frontmatter?.[file.path] });
  return { view, contentEl, app, plugin };
}

function citedNames(contentEl) {
  return allElements(contentEl)
    .filter((el) => el.classes.has("feuillets-entity-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

/** Ligne `.feuillets-entity-row` de la fiche `title`, ou `undefined`. */
function rowFor(contentEl, title) {
  const rows = allElements(contentEl).filter((el) => el.classes.has("feuillets-entity-row"));
  return rows.find((row) =>
    allElements(row).some((el) => el.classes.has("feuillets-entity-name") && el.text === `• ${title}`)
  );
}

/** Texte de `.feuillets-entity-age` (âge/mort, système historique
 * personnage) sous la fiche `title` — `null` si absent. */
function ageFor(contentEl, title) {
  const row = rowFor(contentEl, title);
  if (!row) return undefined;
  const age = allElements(row).find((el) => el.classes.has("feuillets-entity-age"));
  return age ? age.text : null;
}

/** Texte complet de `.feuillets-entity-info` (état/évolution ou synopsis,
 * système historique lieu/événement) sous la fiche `title` — le texte
 * principal suivi, le cas échéant, du suffixe " (depuis {year})"
 * (.feuillets-entity-since), exactement comme rendu à l'écran. */
function infoFor(contentEl, title) {
  const row = rowFor(contentEl, title);
  if (!row) return undefined;
  const info = allElements(row).find((el) => el.classes.has("feuillets-entity-info"));
  if (!info) return null;
  const since = allElements(info).find((el) => el.classes.has("feuillets-entity-since"));
  return info.text + (since ? since.text : "");
}

/** StoryDate minimal (voir NotesView/plugin.parseStoryDate) pour une année
 * ronde — suffisant pour les tests d'écart d'âge/évolution, qui ne
 * regardent que `.sort` et `.y`. */
function storyDate(year) {
  return { sort: year * 10000, y: year, mo: 0, d: 0, display: String(year) };
}

test("1. une fiche dans Recherche du projet (racine) est trouvée", async () => {
  const project = buildProject();
  project.activeFile.content = "La bibliotheque royale conserve de vieux registres.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Bibliotheque Royale"]);
});

test("2. une fiche dans un SOUS-DOSSIER de Recherche est trouvée", async () => {
  const project = buildProject();
  // parisFile vit dans _Recherche/Sub — un sous-dossier du dossier
  // Recherche général, sans association explicite : la récursion doit le
  // ramasser (includeNested de buildContextIndex).
  project.activeFile.content = "Paris est calme ce soir.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);
});

test("3. une fiche associée au CHAPITRE actif est trouvée", async () => {
  const project = buildProject();
  // DucB ("Bragance Seul") n'existe que dans le dossier lié au chapitre.
  project.activeFile.content = "Bragance apparaît seul ici.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Bragance Seul"]);
});

test("4. une fiche associée au FEUILLET actif est trouvée", async () => {
  const project = buildProject();
  // DucA ("Carte Secrète") est dans le dossier lié directement au feuillet.
  project.activeFile.content = "La carte secrète est cachée.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Carte Secrète"]);
});

test("5. une fiche EXTÉRIEURE aux sources autorisées est ignorée", async () => {
  const project = buildProject();
  // Etranger.md est hors Binder/Recherche liés : même si son titre apparaît
  // mot pour mot dans le texte, il ne doit jamais être proposé.
  project.activeFile.content = "On évoque Etranger au loin.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), []);
});

test("6. un même fichier présent dans PLUSIEURS sources n'apparaît qu'une fois", async () => {
  const project = buildProject();
  // DucA ("Carte Secrète") vit sous feuilletResearch, lui-même sous
  // chapterResearch, lui-même sous researchRoot : les trois sources
  // l'incluent, un seul résultat doit sortir.
  project.activeFile.content = "La carte secrète est cachée.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  const names = citedNames(contentEl).filter((n) => n === "Carte Secrète");
  assert.equal(names.length, 1, "une seule occurrence malgré 3 sources se recouvrant");
});

test("6bis. une fiche retrouvée UNIQUEMENT par alias fonctionne de nouveau (régression corrigée)", async () => {
  const project = buildProject();
  // aliasFile ("Fiche 42") n'a ni titre ni basename présents dans le texte :
  // seul son alias de frontmatter "Chat Botté" doit la faire remonter —
  // exactement ce que faisait l'ancienne détection avant l'intégration du
  // moteur de contexte.
  project.activeFile.content = "Le Chat Botté traverse la forêt en bottes de sept lieues.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Fiche 42"]);
});

test("7. à pertinence égale : feuillet avant chapitre, chapitre avant projet", async () => {
  const project = buildProject();
  // Même score de correspondance pour les trois (titres distincts mais
  // structurellement identiques) : seule la priorité de source doit
  // départager. DucA (feuillet, priorité 0) < DucB (chapitre, priorité 10)
  // < DucC (recherche du projet, priorité 20).
  project.titles[project.ducA.path] = "Alpha Distinctif";
  project.titles[project.ducB.path] = "Beta Distinctif";
  project.titles[project.ducC.path] = "Gamma Distinctif";
  project.activeFile.content = "Alpha Distinctif, Beta Distinctif et Gamma Distinctif se rencontrent.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Alpha Distinctif", "Beta Distinctif", "Gamma Distinctif"]);
});

test("8. les tags Obsidian participent à la correspondance", async () => {
  const project = buildProject();
  // TagOnly.md ("Fiche007") n'a ni titre ni basename présents dans le
  // texte : seul son tag #complot doit le faire remonter.
  project.activeFile.content = "Le complot se prépare dans l'ombre.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Fiche007"]);
});

test("9. « Séisme de Lisbonne » remonte pour « Un séisme frappe Lisbonne »", async () => {
  const project = buildProject();
  project.activeFile.content = "Un séisme frappe Lisbonne cette nuit-là.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Séisme de Lisbonne"]);
});

test("10. aucune fiche pertinente : la section n'est pas rendue (pas de régression du rendu)", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.equal(allElements(contentEl).some((el) => el.classes.has("feuillets-notes-section")), false);
});

test("10bis. les jalons (chronologie) restent inclus indépendamment du moteur de contexte", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const jalon = new TFile("Projet/_Chrono/1820.md");
  const { view, contentEl } = createView(project);
  await view.renderCitedEntities(contentEl, project.activeFile, null, [jalon]);
  assert.equal(allElements(contentEl).some((el) => el.classes.has("feuillets-notes-section")), true);
});

test("10ter. section repliée : structure inchangée (en-tête rendu, corps absent)", async () => {
  const project = buildProject();
  project.activeFile.content = "On évoque Paris au loin.";
  const { view, contentEl, plugin } = createView(project);
  plugin.settings.collapsed["notes:field:contexte"] = true;
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  const all = allElements(contentEl);
  assert.equal(all.some((el) => el.classes.has("feuillets-notes-section-head")), true);
  assert.equal(all.some((el) => el.classes.has("feuillets-notes-entities-body")), false);
});

/* ===================== Régression : sources cumulatives =================
 * Bug rapporté : une fois un dossier lié au chapitre ou au feuillet, la
 * Recherche générale du projet cessait d'être consultée — une fiche qui n'y
 * existait QUE là (Ramazan, retrouvée par alias) disparaissait. Reproduit
 * ici avec des dossiers liés DISTINCTS de _Recherche (hors de son arbre),
 * pour écarter toute confusion avec les scénarios de nesting déjà couverts
 * plus haut (tests 4, 6, 7). */
function buildCumulativeSourcesProject() {
  const root = new TFolder("Projet");

  const manuscritFolder = new TFolder("Projet/Manuscrit");
  manuscritFolder.parent = root;
  const chapterFolder = new TFolder("Projet/Manuscrit/Chapitre1");
  chapterFolder.parent = manuscritFolder;
  manuscritFolder.children = [chapterFolder];

  const activeFile = new TFile("Projet/Manuscrit/Chapitre1/scene.md", "Corps du feuillet");
  activeFile.parent = chapterFolder;
  chapterFolder.children = [activeFile];

  // Recherche générale du projet — contient Ramazan, retrouvable UNIQUEMENT
  // par son alias (ni titre ni basename ne correspondent au texte).
  const researchRoot = new TFolder("Projet/_Recherche");
  researchRoot.parent = root;
  const ramazan = new TFile("Projet/_Recherche/Personnage3.md");
  ramazan.parent = researchRoot;
  researchRoot.children = [ramazan];

  // Dossier lié au FEUILLET — DISTINCT de _Recherche, hors de son arbre.
  const feuilletLinked = new TFolder("Projet/LiensFeuillet");
  feuilletLinked.parent = root;
  const ficheFeuillet = new TFile("Projet/LiensFeuillet/FicheFeuillet.md");
  ficheFeuillet.parent = feuilletLinked;
  feuilletLinked.children = [ficheFeuillet];

  // Dossier lié au CHAPITRE — également distinct.
  const chapterLinked = new TFolder("Projet/LiensChapitre");
  chapterLinked.parent = root;
  const ficheChapitre = new TFile("Projet/LiensChapitre/FicheChapitre.md");
  ficheChapitre.parent = chapterLinked;
  chapterLinked.children = [ficheChapitre];

  root.children = [manuscritFolder, researchRoot, feuilletLinked, chapterLinked];

  const nodes = [
    root, manuscritFolder, chapterFolder, activeFile,
    researchRoot, ramazan, feuilletLinked, ficheFeuillet, chapterLinked, ficheChapitre,
  ];
  const filesByPath = new Map(nodes.map((n) => [n.path, n]));

  const titles = {
    [ramazan.path]: "Fiche 3",
    [ficheFeuillet.path]: "Objet du Feuillet",
    [ficheChapitre.path]: "Objet du Chapitre",
  };
  const aliases = {
    [ramazan.path]: ["Ramazan"],
  };

  return {
    root, manuscritFolder, chapterFolder, activeFile,
    researchRoot, ramazan, feuilletLinked, ficheFeuillet, chapterLinked, ficheChapitre,
    filesByPath, titles, aliases,
  };
}

function createCumulativeSourcesView(project) {
  const contentEl = new FakeElement();
  const app = {
    vault: {
      getAbstractFileByPath: (path) => project.filesByPath.get(path) ?? null,
      cachedRead: async (file) => file.content || "",
    },
    workspace: {
      getActiveFile: () => project.activeFile,
    },
    metadataCache: {},
  };
  const plugin = {
    settings: { collapsed: {} },
    getProjectFolder: () => project.root,
    getResearchRoot: () => project.researchRoot,
    getLinkedResearchFolder: (node) => {
      if (node.path === project.activeFile.path) return project.feuilletLinked;
      if (node.path === project.chapterFolder.path) return project.chapterLinked;
      return null;
    },
    roleOfFolder: (folder) => (folder.path === project.chapterFolder.path ? "chapitre" : "partie"),
    tagsOf: () => [],
    titleFor: (file) => project.titles[file.path] || file.basename,
    async saveSettings() {},
  };
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => ({ aliases: project.aliases?.[file.path] });
  return { view, contentEl, app, plugin };
}

test("Régression — sources cumulatives : feuillet lié + chapitre lié + Recherche générale (jamais l'un à la place de l'autre)", async () => {
  const project = buildCumulativeSourcesProject();
  project.activeFile.content =
    "Ramazan traverse la place. L'objet du Feuillet et l'objet du Chapitre sont posés côte à côte.";
  const { view, contentEl } = createCumulativeSourcesView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  const names = citedNames(contentEl);

  // 4. Ramazan reste trouvé par son alias, malgré les deux dossiers liés.
  assert.ok(names.includes("Fiche 3"), "Ramazan (Recherche générale) doit rester trouvé");
  // 5. Les fiches des DEUX dossiers liés sont aussi trouvées.
  assert.ok(names.includes("Objet du Feuillet"), "la fiche liée au feuillet doit être trouvée");
  assert.ok(names.includes("Objet du Chapitre"), "la fiche liée au chapitre doit être trouvée");
  // 6. Aucune source n'a remplacé une autre : les trois sont bien présentes.
  assert.equal(names.length, 3);
});

test("Régression — sources cumulatives : seul le feuillet est lié, la Recherche générale reste consultée", async () => {
  const project = buildCumulativeSourcesProject();
  // Le chapitre n'est PAS lié : n'affecte pas plugin.getLinkedResearchFolder
  // pour chapterFolder, qui renvoie déjà null dans ce cas.
  project.activeFile.content = "Ramazan traverse la place.";
  const { view, contentEl, plugin } = createCumulativeSourcesView(project);
  plugin.getLinkedResearchFolder = (node) =>
    node.path === project.activeFile.path ? project.feuilletLinked : null;

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Fiche 3"]);
});

/* ============= Fenêtre de contexte autour du curseur (extractContextWindow) =============
 * NotesView doit préférer le paragraphe autour du curseur RÉEL de
 * l'éditeur actif à l'analyse du feuillet entier — avec repli obligatoire
 * sur le corps complet dès qu'aucun éditeur utilisable n'est trouvé. Voir
 * aussi test/context-window.test.js pour extractContextWindow() elle-même,
 * testée indépendamment de toute vue. */

test("Fenêtre de contexte : une fiche hors fenêtre n'apparaît pas, un déplacement du curseur la fait apparaître", async () => {
  const project = buildProject();
  const paras = [
    "Un paragraphe neutre pour espacer le récit.",
    "On évoque Paris dans ce passage précis.",
    "Encore un paragraphe neutre entre les deux passages.",
    "Le Chat Botté traverse la forêt à cet instant.",
    "Un dernier paragraphe neutre pour clore la scène."
  ];
  const body = paras.join("\n\n");
  project.activeFile.content = body;
  const { view, contentEl, app } = createView(project);

  // Curseur dans le paragraphe "Paris" : "Chat Botté" est à 2 paragraphes
  // de distance (radius par défaut = 1), donc hors fenêtre.
  const offsetParis = body.indexOf(paras[1]) + 3;
  setActiveEditor(app, project.activeFile, fakeEditor(body, offsetParis));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);

  // Déplacement du curseur au paragraphe "Chat Botté" : Paris sort de la
  // fenêtre, Chat Botté (retrouvé par son alias) y entre.
  const offsetAlias = body.indexOf(paras[3]) + 3;
  contentEl.empty();
  setActiveEditor(app, project.activeFile, fakeEditor(body, offsetAlias));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Fiche 42"]);
});

test("Repli obligatoire : aucun éditeur actif pour ce feuillet → corps complet", async () => {
  const project = buildProject();
  project.activeFile.content = "On évoque Paris au loin.";
  const { view, contentEl } = createView(project);
  // app.workspace.getActiveViewOfType n'est même pas défini.
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);
});

test("Repli obligatoire : éditeur actif sur un AUTRE fichier → corps complet du feuillet affiché", async () => {
  const project = buildProject();
  project.activeFile.content = "On évoque Paris au loin.";
  const { view, contentEl, app } = createView(project);
  const otherFile = new TFile("Projet/Autre.md", "");
  setActiveEditor(app, otherFile, fakeEditor("Un texte sans rapport.", 0));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);
});

test("Repli obligatoire : éditeur en mode LECTURE → corps complet (jamais le buffer de l'éditeur)", async () => {
  const project = buildProject();
  project.activeFile.content = "On évoque Paris au loin.";
  const { view, contentEl, app } = createView(project);
  // Texte délibérément différent de celui du disque : si le repli échouait
  // à ignorer un éditeur en mode Lecture, ce texte (sans "Paris") serait
  // utilisé à la place et l'assertion échouerait.
  setActiveEditor(app, project.activeFile, fakeEditor("Texte de prévisualisation sans rapport.", 0), "preview");
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);
});

test("Repli obligatoire : une erreur de l'éditeur actif ne casse jamais le rendu", async () => {
  const project = buildProject();
  project.activeFile.content = "On évoque Paris au loin.";
  const { view, contentEl, app } = createView(project);
  app.workspace.getActiveViewOfType = () => { throw new Error("boom"); };
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Paris"]);
});

test("Débounce (~300 ms) : plusieurs déplacements rapprochés du curseur ne déclenchent qu'un seul rafraîchissement", async () => {
  const timers = installFakeTimers();
  try {
    const project = buildProject();
    // 3 paragraphes, pour que déplacer le curseur du premier au dernier
    // change RÉELLEMENT la fenêtre extraite (radius 1 : avec seulement 2
    // paragraphes, toute position couvre déjà les deux à la fois).
    const paras = [
      "On évoque Paris dans ce premier passage.",
      "Un paragraphe neutre entre les deux passages.",
      "Le Chat Botté apparaît dans ce dernier passage."
    ];
    const body = paras.join("\n\n");
    project.activeFile.content = body;
    const { view, contentEl, app } = createView(project);

    const offset = body.indexOf(paras[0]) + 3;
    const activeView = setActiveEditor(app, project.activeFile, fakeEditor(body, offset));

    // Premier rendu réel : branche l'écoute clavier/souris sur l'éditeur.
    await view.renderCitedEntities(contentEl, project.activeFile, null, []);
    assert.equal(activeView.contentEl.events.has("keyup"), true, "l'écoute doit être posée après le premier rendu");

    let renderCalls = 0;
    view.render = async () => { renderCalls += 1; };

    // Le curseur a réellement bougé jusqu'au DERNIER paragraphe dans
    // l'éditeur (keyup est émis APRÈS que la touche a déplacé le curseur) —
    // la fenêtre de contexte sera donc différente une fois le débounce
    // écoulé (paragraphes 1+2 au lieu de 0+1).
    const offsetPara3 = body.indexOf(paras[2]) + 3;
    activeView.editor = fakeEditor(body, offsetPara3);

    // Trois "frappes"/déplacements rapprochés : un seul minuteur en
    // attente (chaque nouveau déclenchement annule le précédent).
    activeView.contentEl.events.get("keyup")();
    activeView.contentEl.events.get("keyup")();
    activeView.contentEl.events.get("mouseup")();
    assert.equal(timers.pendingCount(), 1, "un seul minuteur en attente malgré 3 déclenchements rapprochés");
    assert.equal(renderCalls, 0, "aucun rendu avant l'expiration du débounce");

    timers.runAll();
    assert.equal(renderCalls, 1, "un seul rendu déclenché après le débounce");
  } finally {
    timers.restore();
  }
});

test("Règle 5 : pas de nouveau rendu si la fenêtre de contexte n'a pas changé", async () => {
  const timers = installFakeTimers();
  try {
    const project = buildProject();
    // Un seul paragraphe : la fenêtre extraite est TOUJOURS identique,
    // quelle que soit la position du curseur à l'intérieur.
    project.activeFile.content = "On évoque Paris au loin, encore et encore.";
    const { view, contentEl, app } = createView(project);
    const activeView = setActiveEditor(
      app,
      project.activeFile,
      fakeEditor(project.activeFile.content, project.activeFile.content.indexOf("Paris"))
    );

    await view.renderCitedEntities(contentEl, project.activeFile, null, []);

    let renderCalls = 0;
    view.render = async () => { renderCalls += 1; };

    activeView.contentEl.events.get("keyup")();
    timers.runAll();

    assert.equal(renderCalls, 0, "aucun rendu si la fenêtre de contexte est identique à la précédente");
  } finally {
    timers.restore();
  }
});

test("onClose() détache l'écoute du curseur et annule le minuteur de débounce en vol", async () => {
  const timers = installFakeTimers();
  try {
    const project = buildProject();
    project.activeFile.content = "On évoque Paris au loin.";
    const { view, contentEl, app } = createView(project);
    const activeView = setActiveEditor(app, project.activeFile, fakeEditor(project.activeFile.content, 0));

    await view.renderCitedEntities(contentEl, project.activeFile, null, []);
    assert.equal(activeView.contentEl.events.has("keyup"), true, "l'écoute est bien posée");
    assert.equal(activeView.contentEl.events.has("mouseup"), true);

    activeView.contentEl.events.get("keyup")(); // planifie un minuteur
    assert.equal(timers.pendingCount(), 1);

    await view.onClose();

    assert.equal(timers.pendingCount(), 0, "le minuteur en attente est annulé à la fermeture");
    assert.equal(activeView.contentEl.events.has("keyup"), false, "l'écoute keyup a été retirée à la fermeture");
    assert.equal(activeView.contentEl.events.has("mouseup"), false, "l'écoute mouseup a été retirée à la fermeture");
  } finally {
    timers.restore();
  }
});

/* =============== Enrichissements historiques (personnage/lieu/événement) ===============
 * Système historique : écart d'âge/mort pour un personnage
 * (plugin.parseStoryDate + efm.death, voir NotesView), dernière évolution
 * applicable pour un lieu ou un événement (latestStateBefore, voir
 * utils/entity-states.ts — testé isolément dans entity-states.test.js).
 * Les deux tests ci-dessous passent par de VRAIES métadonnées Obsidian
 * (number/Date), donc par la normalisation interne de parseStoryDate (voir
 * normalizeDateInput, utils/natural-date.ts), pour couvrir exactement le
 * même défaut de typage YAML que le reste du panneau. */

test("Historique — personnage : Deli mort en 1815, scène 1826 → « mort depuis 11 ans (en 1815) »", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Deli";
  project.tags = { [project.ducC.path]: ["personnage"] };
  project.frontmatter = {
    [project.activeFile.path]: { date: 1826 },
    // `death` déjà résolu depuis l'alias historique `mort` (voir
    // LEGACY_FIELD_ALIASES, services/frontmatter.ts) — ce que renvoie
    // réellement this.fm() une fois la fiche lue. Type NUMBER brut (YAML
    // sans guillemets), pas une chaîne pré-formatée.
    [project.ducC.path]: { death: 1815 },
  };
  project.activeFile.content = "Deli apparaît en pensée dans cette scène.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1826), []);

  assert.deepEqual(citedNames(contentEl), ["Deli"]);
  assert.equal(ageFor(contentEl, "Deli"), "mort depuis 11 ans (en 1815)");
});

test("Historique — lieu : Suvasa, évolutions 1820 et 1825, scène 1826 → « … (depuis 1825) »", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Suvasa";
  project.tags = { [project.ducC.path]: ["lieu"] };
  project.frontmatter = { [project.activeFile.path]: { date: 1826 } };
  project.ducC.content =
    "# Évolution\n" +
    "* 1820 : Un petit port de pêche tranquille.\n" +
    "* 1825 : Les navires de commerce bloquent l'entrée.\n";
  project.activeFile.content = "Suvasa s'étend devant eux, bruyante.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1826), []);

  assert.deepEqual(citedNames(contentEl), ["Suvasa"]);
  assert.equal(infoFor(contentEl, "Suvasa"), "Les navires de commerce bloquent l'entrée. (depuis 1825)");
});

test("Historique — lieu : puce « - » également acceptée, aucune évolution applicable → rien n'est affiché", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Suvasa";
  project.tags = { [project.ducC.path]: ["lieu"] };
  project.frontmatter = { [project.activeFile.path]: { date: 1810 } };
  project.ducC.content = "# Évolution\n- 1820 : Un petit port de pêche tranquille.\n";
  project.activeFile.content = "Suvasa n'est encore qu'un hameau.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1810), []);

  assert.deepEqual(citedNames(contentEl), ["Suvasa"]);
  // Aucune évolution antérieure ou égale à 1810 : pas d'état affiché, et
  // sans synopsis, la zone info est retirée (comportement déjà existant).
  const row = rowFor(contentEl, "Suvasa");
  assert.equal(allElements(row).some((el) => el.classes.has("feuillets-entity-info")), false);
});

test("Historique — événement : fiche datée du 15 juin 1826, scène 1826 → traitement existant conservé", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Bataille de Suvasa";
  project.tags = { [project.ducC.path]: ["evenement"] };
  project.frontmatter = {
    [project.activeFile.path]: { date: 1826 },
    [project.ducC.path]: { date: new Date(Date.UTC(1826, 5, 15)), synopsis: "La bataille décisive de la campagne." },
  };
  project.ducC.content = ""; // pas de section Évolution : repli sur le synopsis
  project.activeFile.content = "La bataille de Suvasa fait rage.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1826), []);

  assert.deepEqual(citedNames(contentEl), ["Bataille de Suvasa"]);
  assert.equal(infoFor(contentEl, "Bataille de Suvasa"), "La bataille décisive de la campagne.");
});

/* ==================== Faux positifs de la fenêtre de contexte (corrigés) ====================
 * Avant correctif, extractContextWindow() élargissait TOUJOURS au
 * paragraphe précédent et suivant (radius fixe) : une fiche mentionnée dans
 * un paragraphe voisin restait affichée même une fois le curseur ailleurs.
 * Reproduit ici avec des paragraphes RÉALISTES (assez longs pour ne jamais
 * être élargis par défaut), puis vérifié corrigé. */

test("Faux positif corrigé : dernier paragraphe sans Deli/Suvasa/janissaires → ils disparaissent", async () => {
  const project = buildProject();
  project.titles[project.ducA.path] = "Deli";
  project.titles[project.ducB.path] = "Suvasa";
  project.titles[project.ducC.path] = "Janissaires";
  const paras = [
    "Deli traverse la ville de Suvasa entourée par une troupe de janissaires en armes, prête à intervenir sur un signal.",
    "Un vent frais se lève sur la mer, apportant une odeur de sel et d'iode tout au long du rivage désert et silencieux."
  ];
  const body = paras.join("\n\n");
  project.activeFile.content = body;
  const { view, contentEl, app } = createView(project);

  // Curseur dans le premier paragraphe : les trois sont bien trouvés
  // (reproduit le cas normal, sert de référence).
  setActiveEditor(app, project.activeFile, fakeEditor(body, body.indexOf(paras[0]) + 5));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl).sort(), ["Deli", "Janissaires", "Suvasa"]);

  // Déplacement au dernier paragraphe — sans rapport, assez long pour ne
  // JAMAIS élargir au voisinage par défaut : les trois doivent disparaître.
  contentEl.empty();
  setActiveEditor(app, project.activeFile, fakeEditor(body, body.indexOf(paras[1]) + 5));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), [], "aucune fiche du paragraphe précédent ne doit rester affichée");
});

test("Faux positif corrigé : passage vers un paragraphe « Arabie » → aucune fiche Lisbonne résiduelle", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Péninsule d'Arabie";
  const paras = [
    "Le grand séisme de Lisbonne a détruit la moitié de la ville en quelques minutes à peine, ravageant tout le port.",
    "Les caravanes traversent la péninsule d'Arabie sous un soleil de plomb, chargées d'épices et de tissus précieux."
  ];
  const body = paras.join("\n\n");
  project.activeFile.content = body;
  const { view, contentEl, app } = createView(project);

  setActiveEditor(app, project.activeFile, fakeEditor(body, body.indexOf(paras[0]) + 5));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Séisme de Lisbonne"]);

  contentEl.empty();
  setActiveEditor(app, project.activeFile, fakeEditor(body, body.indexOf(paras[1]) + 5));
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Péninsule d'Arabie"], "Lisbonne ne doit plus apparaître une fois le curseur dans le passage Arabie");
});

test("Rendu « 11-01 » corrigé : une évolution datée en jour précis sous Lisbonne n'affiche jamais son mois-jour brut", async () => {
  const project = buildProject();
  project.titles[project.ducA.path] = "Séisme de Lisbonne";
  project.tags = { [project.ducA.path]: ["evenement"] };
  project.ducA.content = "* 1755-11-01 : Le grand séisme frappe la ville en quelques minutes.";
  project.activeFile.content = "Le séisme de Lisbonne bouleverse toute l'Europe des Lumières.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1756), []);

  assert.deepEqual(citedNames(contentEl), ["Séisme de Lisbonne"]);
  const info = infoFor(contentEl, "Séisme de Lisbonne");
  assert.equal(info.includes("11-01"), false, "aucune date partielle brute ne doit fuir dans le texte affiché");
  assert.equal(info, "Le grand séisme frappe la ville en quelques minutes. (depuis 1755)");
});

/* ==================== Chronologie simplifiée : dates naturelles, fiches
 * sans `type` (règles 1 à 9 du chantier) ==================== */

test("« # Évolution » s'applique à une fiche SANS AUCUN tag (aucun type particulier requis)", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "La Citadelle";
  // Aucune entrée dans project.tags pour ducC : tagsOf() renvoie [],
  // entityKind() renvoie donc null — ni personnage, ni lieu, ni événement,
  // ni codex. « # Évolution » doit malgré tout s'appliquer : rien dans le
  // panneau Notes ne conditionne son usage à une nature de fiche précise.
  project.frontmatter = { [project.activeFile.path]: { date: 1826 } };
  project.ducC.content =
    "# Évolution\n" +
    "- 1810 : devient un simple avant-poste.\n" +
    "- 1820 : sa mémoire devient un symbole politique.\n";
  project.activeFile.content = "La Citadelle domine toujours la vallée.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, storyDate(1826), []);

  assert.deepEqual(citedNames(contentEl), ["La Citadelle"]);
  assert.equal(infoFor(contentEl, "La Citadelle"), "sa mémoire devient un symbole politique. (depuis 1820)");
});

test("Date de scène en français naturel (« 12 mars 765 ») : écart d'âge personnage calculé normalement", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Deli";
  project.tags = { [project.ducC.path]: ["personnage"] };
  project.frontmatter = {
    [project.activeFile.path]: { date: "12 mars 765" },
    [project.ducC.path]: { birth: "745" },
  };
  project.activeFile.content = "Deli apparaît en pensée dans cette scène.";
  const { view, contentEl, plugin } = createView(project);

  const sceneDate = plugin.parseStoryDate("12 mars 765", null);
  assert.equal(sceneDate.display, "12 mars 765", "l'affichage reste la date naturelle telle qu'écrite");

  await view.renderCitedEntities(contentEl, project.activeFile, sceneDate, []);

  assert.deepEqual(citedNames(contentEl), ["Deli"]);
  assert.equal(ageFor(contentEl, "Deli"), "~20 ans");
});

test("Jalon de chronologie SANS propriété `type`, daté en français naturel, égal à la date de la scène", async () => {
  const project = buildProject();
  project.titles[project.ducC.path] = "Départ de la caravane dans le Hedjaz";
  // Aucun tag, aucun `type` sur la fiche jalon : seule la propriété `date`
  // compte pour la reconnaître (voir la boucle `jalons` dans
  // NotesView.render, indépendante de entityKind() — reproduite ici par
  // l'appel direct à renderCitedEntities avec un jalon déjà résolu).
  project.frontmatter = { [project.ducC.path]: { date: "12 mars 765" } };
  project.activeFile.content = "La caravane s'ébranle avant l'aube.";
  const { view, contentEl, plugin } = createView(project);

  // Même mécanisme EXACT que NotesView.render() pour rapprocher un jalon de
  // la scène : deux dates naturelles identiques doivent produire le même
  // `.sort`, quelle que soit la fiche qui les porte.
  const sceneDate = plugin.parseStoryDate("12 mars 765", null);
  const jalonDate = plugin.parseStoryDate("12 mars 765", null);
  assert.equal(jalonDate.sort, sceneDate.sort);

  await view.renderCitedEntities(contentEl, project.activeFile, sceneDate, [project.ducC]);

  assert.deepEqual(citedNames(contentEl), ["Départ de la caravane dans le Hedjaz"]);
});
