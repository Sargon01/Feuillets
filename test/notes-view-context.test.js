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
    settings: { collapsed: {}, notesPinned: {} },
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
    // Nécessaires uniquement parce que togglePinned() (Lot 6) déclenche un
    // render(true) COMPLET (même mécanique que toute autre action du
    // panneau, ex. renderPropertyRow) — pas seulement renderCitedEntities,
    // qui seul était exercé par ce harnais jusqu'ici.
    isFrontMatter: () => false,
    hasSources: () => false,
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
    allElements(row).some((el) => el.classes.has("feuillets-entity-name") && (el.text === title || el.text === `• ${title}`))
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

test("Volet Recherche — un dossier lié EXTÉRIEUR au projet reste une source de contexte valide", async () => {
  // La restriction géographique (isInsideResearchSpace) est levée pour
  // l'association Binder ↔ Recherche (base-feuillets-view.ts) : un dossier
  // lié à un feuillet peut désormais vivre n'importe où dans le coffre.
  // contextSourcesFor (notes-view.ts) ne filtrait déjà jamais par
  // emplacement — ce test le prouve avec un dossier hors de toute
  // arborescence du projet.
  const project = buildProject();
  const externalFolder = new TFolder("Documentation/Histoire ottomane");
  const externalFile = new TFile("Documentation/Histoire ottomane/Janissaires.md");
  externalFile.parent = externalFolder;
  externalFolder.children = [externalFile];
  project.filesByPath.set(externalFolder.path, externalFolder);
  project.filesByPath.set(externalFile.path, externalFile);
  project.titles[externalFile.path] = "Janissaires";

  const { view, contentEl, plugin } = createView(project);
  // Le feuillet actif est lié à un dossier hors du projet (autre arbre du
  // coffre, sans rapport avec Projet/_Recherche).
  plugin.getLinkedResearchFolder = (node) =>
    node.path === project.activeFile.path ? externalFolder : null;

  project.activeFile.content = "Les janissaires montent la garde.";
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(citedNames(contentEl), ["Janissaires"]);
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
  // Lot 6 : la section « Correspondances fiables » utilise désormais
  // renderSectionHead() (même mécanique que Documents associés et
  // Propriétés, voir renderLimitedSection) — classe "feuillets-section-head"
  // et non plus l'ancien en-tête bricolé "feuillets-notes-section-head".
  assert.equal(all.some((el) => el.classes.has("feuillets-section-head")), true);
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
    settings: { collapsed: {}, notesPinned: {} },
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

/* ===================== Lot 5 : recherche dans le contenu des documents
 * associés — second niveau, distinct des correspondances fiables ci-dessus
 * (Lot 3/4). Scopé feuillet + chapitre UNIQUEMENT : contentSourcesFor()
 * exclut explicitement "project-research" (voir notes-view.ts), jamais la
 * Recherche générale du projet ni le reste du coffre. ===================== */

/** Éléments de la section « Documents associés » (Lot 5) — TOUJOURS
 * distincte de la section « Contexte » (feuillets-entity-name), scopée via
 * sa classe propre feuillets-related-docs-section pour ne jamais confondre
 * les deux listes, même si elles réutilisent le même langage visuel. */
function relatedDocsSection(contentEl) {
  return allElements(contentEl).find((el) => el.classes.has("feuillets-related-docs-section"));
}

/** Ligne (.feuillets-entity-row) portant `nameEl` — remonte jusqu'à trouver
 * l'ancêtre marqué comme ligne de résultat. Sert à savoir si une ligne est
 * masquée par « Afficher davantage » (Lot 6, feuillets-result-hidden posée
 * sur la ligne elle-même, jamais sur le nom). */
function rowElementFor(nameEl) {
  let cur = nameEl;
  while (cur && !(cur.classes && cur.classes.has("feuillets-entity-row"))) cur = cur.parentEl;
  return cur;
}

function isHiddenByShowMore(nameEl) {
  const row = rowElementFor(nameEl);
  return !!(row && row.classes.has("feuillets-result-hidden"));
}

/** Noms VISIBLES de « Documents associés » — exclut les lignes au-delà de
 * la limite par défaut tant que « Afficher davantage » n'a pas été
 * actionné (Lot 6). C'est le sens le plus utile par défaut : la plupart
 * des tests Lot 5 pré-existants attendent le rendu effectivement visible.
 * Voir relatedDocNamesAll() pour le vivier complet (pool "afficher
 * davantage"), utilisé par les tests Lot 6 dédiés. */
function relatedDocNames(contentEl) {
  const section = relatedDocsSection(contentEl);
  if (!section) return [];
  return allElements(section)
    .filter((el) => el.classes.has("feuillets-related-doc-name"))
    .filter((el) => !isHiddenByShowMore(el))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

/** Tous les noms de « Documents associés », visibles ou masqués par
 * « Afficher davantage » (Lot 6) — le vivier complet déjà calculé. */
function relatedDocNamesAll(contentEl) {
  const section = relatedDocsSection(contentEl);
  if (!section) return [];
  return allElements(section)
    .filter((el) => el.classes.has("feuillets-related-doc-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

function relatedDocExcerpt(contentEl, title) {
  const section = relatedDocsSection(contentEl);
  if (!section) return undefined;
  const rows = allElements(section).filter((el) => el.classes.has("feuillets-entity-row"));
  const row = rows.find((r) =>
    allElements(r).some((el) => el.classes.has("feuillets-related-doc-name") && (el.text === title || el.text === `• ${title}`))
  );
  if (!row) return undefined;
  const info = allElements(row).find((el) => el.classes.has("feuillets-entity-info"));
  return info ? info.text : null;
}

/** Noms cités dans la section « Contexte » (Lot 3/4) SEULE — exclut
 * délibérément la section « Documents associés » (Lot 5), qui réutilise la
 * même classe .feuillets-entity-name pour son langage visuel (voir
 * renderRelatedDocumentsSection) : citedNames() seul confondrait les deux
 * listes, ce que ces tests doivent justement distinguer. */
function contextEntityNames(contentEl) {
  return allElements(contentEl)
    .filter((el) => el.classes.has("feuillets-entity-name") && !el.classes.has("feuillets-related-doc-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

/** `view.app.vault.cachedRead` instrumenté : compte les lectures RÉELLES
 * par chemin, sans changer le comportement (renvoie toujours `file.content`
 * comme createView()). Sert aux tests de cache (Lot 5). */
function spyOnReads(view) {
  const reads = [];
  const original = view.app.vault.cachedRead.bind(view.app.vault);
  view.app.vault.cachedRead = async (file) => {
    reads.push(file.path);
    return original(file);
  };
  return reads;
}

/* ===================== Lot 6 : Épinglées / Références du passage /
 * Documents associés, épinglage, limites + « Afficher davantage »,
 * provenance — trois sections distinctes du même bloc Contexte. Aucun des
 * trois moteurs (context-index.ts/context-matcher.ts/context-window.ts/
 * context-content-matcher.ts/context-content-cache.ts) n'est modifié : la
 * suite déjà verte des tests Lot 3/4/5 ci-dessus (et des tests dédiés à
 * chaque moteur, context-*.test.js) EST la preuve qu'ils restent inchangés
 * — ce chantier ne fait que réorganiser leur consommation et leur
 * affichage dans NotesView. ===================== */

/** Une section .feuillets-notes-section dont le titre (feuillets-section-
 * title-text, posé par renderSectionHead — voir renderLimitedSection)
 * commence par `prefix` — utilisé plutôt qu'une classe dédiée pour
 * Références du passage, qui n'en porte aucune (seules Épinglées et
 * Documents associés ont une classe supplémentaire). */
function sectionByTitlePrefix(contentEl, prefix) {
  const sections = allElements(contentEl).filter((el) => el.classes.has("feuillets-notes-section"));
  return sections.find((sec) =>
    allElements(sec).some((c) => c.classes.has("feuillets-section-title-text") && c.text.startsWith(prefix))
  );
}

function pinnedSection(contentEl) {
  return sectionByTitlePrefix(contentEl, "Épinglées");
}

function reliableSection(contentEl) {
  return sectionByTitlePrefix(contentEl, "Contexte") || sectionByTitlePrefix(contentEl, "Correspondances fiables");
}

function namesIn(section, { visibleOnly = false } = {}) {
  if (!section) return [];
  return allElements(section)
    .filter((el) => el.classes.has("feuillets-entity-name"))
    .filter((el) => !visibleOnly || !isHiddenByShowMore(el))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

function pinBtnFor(contentEl, title) {
  const row = rowFor(contentEl, title);
  if (!row) return undefined;
  return allElements(row).find((el) => el.classes.has("feuillets-pin-btn"));
}

function provenanceFor(contentEl, title) {
  const row = rowFor(contentEl, title);
  if (!row) return undefined;
  const badge = allElements(row).find((el) => el.classes.has("feuillets-entity-provenance"));
  return badge ? badge.text : (row.attributes?.["data-provenance"] || row.attributes?.["title"] || null);
}

function showMoreBtnIn(section) {
  if (!section) return undefined;
  return allElements(section).find((el) => el.classes.has("feuillets-show-more"));
}

test("Lot 6 — épingler une fiche la fait apparaître dans « Épinglées »", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const { view, contentEl, plugin } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.equal(pinnedSection(contentEl), undefined, "pas encore d'épinglées");

  await view.togglePinned(project.activeFile, project.ducA.path);
  assert.deepEqual(plugin.settings.notesPinned[project.activeFile.path], [project.ducA.path]);

  const el2 = new FakeElement();
  await view.renderCitedEntities(el2, project.activeFile, null, []);
  assert.deepEqual(namesIn(pinnedSection(el2)), ["Carte Secrète"]);
});

test("Lot 6 — désépingler retire la fiche de « Épinglées »", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const { view, contentEl, plugin } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(namesIn(pinnedSection(contentEl)), ["Carte Secrète"]);

  await view.togglePinned(project.activeFile, project.ducA.path);
  assert.equal(plugin.settings.notesPinned[project.activeFile.path], undefined);

  const el2 = new FakeElement();
  await view.renderCitedEntities(el2, project.activeFile, null, []);
  assert.equal(pinnedSection(el2), undefined);
});

test("Lot 6 — le bouton d'épinglage bascule réellement l'état au clic", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const { view, contentEl, plugin } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  const btn = pinBtnFor(contentEl, "Carte Secrète");
  assert.ok(btn, "le bouton d'épinglage doit être présent sur une ligne épinglée");
  assert.equal(btn.classes.has("is-active"), true);
  assert.equal(btn.icon, "pin-off");

  // Simule le clic réel sur le bouton (même mécanisme que le reste de la
  // suite, voir activeView.contentEl.events.get("keyup") plus haut) :
  // togglePinned() mute S.notesPinned de façon SYNCHRONE avant son premier
  // await, donc l'effet est déjà visible juste après l'appel.
  btn.events.get("click")();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(plugin.settings.notesPinned[project.activeFile.path], undefined);
});

test("Lot 6 — stockage par FEUILLET : un épinglage sur un feuillet n'apparaît jamais sur un autre", async () => {
  const project = buildProject();
  const otherFile = new TFile("Projet/Manuscrit/Chapitre1/autre.md");
  otherFile.parent = project.chapterFolder;
  otherFile.content = "Rien de pertinent ici non plus.";
  project.chapterFolder.children.push(otherFile);
  project.filesByPath.set(otherFile.path, otherFile);
  project.titles[otherFile.path] = "Autre Feuillet";

  project.activeFile.content = "Rien de pertinent ici.";
  const { view, plugin } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);

  const elActive = new FakeElement();
  await view.renderCitedEntities(elActive, project.activeFile, null, []);
  assert.deepEqual(namesIn(pinnedSection(elActive)), ["Carte Secrète"]);

  const elOther = new FakeElement();
  await view.renderCitedEntities(elOther, otherFile, null, []);
  assert.equal(pinnedSection(elOther), undefined, "l'épinglage ne doit jamais fuiter vers un autre feuillet");

  assert.deepEqual(Object.keys(plugin.settings.notesPinned), [project.activeFile.path]);
});

test("Lot 6 — une fiche épinglée reste visible après un changement de paragraphe", async () => {
  const project = buildProject();
  project.activeFile.content = "Premier paragraphe, sans rapport.\n\nDeuxième paragraphe, sans rapport non plus.";
  const { view, contentEl } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);

  // Premier rendu : curseur/texte de repli correspond au feuillet entier
  // (pas d'éditeur actif dans ce harnais) — l'épinglée est déjà là.
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.deepEqual(namesIn(pinnedSection(contentEl)), ["Carte Secrète"]);

  // "Changement de paragraphe" simulé : le contenu change complètement
  // (nouveau texte sans aucun rapport avec DucA), sur un nouveau rendu —
  // l'épinglée doit rester, alors qu'aucune correspondance fiable/contenu
  // ne la retrouverait plus.
  project.activeFile.content = "Tout autre chose, un troisième paragraphe distinct.";
  const el2 = new FakeElement();
  await view.renderCitedEntities(el2, project.activeFile, null, []);
  assert.deepEqual(namesIn(pinnedSection(el2)), ["Carte Secrète"]);
});

test("Lot 6 — aucun doublon : une fiche épinglée qui matcherait aussi Correspondances fiables n'apparaît que dans Épinglées", async () => {
  const project = buildProject();
  // Séisme de Lisbonne (lisbonne.md) matche par TITRE (Lot 3).
  project.activeFile.content = "Un séisme frappe Lisbonne cette nuit-là.";
  const { view, contentEl } = createView(project);

  await view.togglePinned(project.activeFile, project.lisbonne.path);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(namesIn(pinnedSection(contentEl)), ["Séisme de Lisbonne"]);
  // Jamais répétée dans Correspondances fiables.
  assert.equal(namesIn(reliableSection(contentEl)).includes("Séisme de Lisbonne"), false);
});

test("Lot 6 — aucun doublon : une fiche épinglée qui matcherait aussi Documents associés n'apparaît que dans Épinglées", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);
  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(namesIn(pinnedSection(contentEl)), ["Carte Secrète"]);
  assert.deepEqual(relatedDocNamesAll(contentEl), []);
});

test("Lot 6 — suppression d'une fiche épinglée : elle disparaît et le chemin invalide est nettoyé du stockage", async () => {
  const project = buildProject();
  project.activeFile.content = "Rien de pertinent ici.";
  const { view, plugin } = createView(project);

  await view.togglePinned(project.activeFile, project.ducA.path);
  assert.deepEqual(plugin.settings.notesPinned[project.activeFile.path], [project.ducA.path]);

  // Suppression : retirée du vault (comme les tests Lot 5 déjà existants).
  project.feuilletResearch.children = project.feuilletResearch.children.filter((c) => c !== project.ducA);
  project.filesByPath.delete(project.ducA.path);

  const el2 = new FakeElement();
  await view.renderCitedEntities(el2, project.activeFile, null, []);

  assert.equal(pinnedSection(el2), undefined, "plus rien à épingler, la section disparaît");
  assert.equal(plugin.settings.notesPinned[project.activeFile.path], undefined, "le chemin invalide est nettoyé");
});

test("Lot 6 — Correspondances fiables : limite initiale à cinq, « Afficher davantage » puis retour réduit", async () => {
  const project = buildProject();
  project.titles[project.ducA.path] = "Alpha Distinctif";
  project.titles[project.ducB.path] = "Beta Distinctif";
  project.titles[project.ducC.path] = "Gamma Distinctif";
  project.titles[project.lisbonne.path] = "Delta Distinctif";
  project.titles[project.parisFile.path] = "Epsilon Distinctif";
  project.titles[project.tagFile.path] = "Zeta Distinctif";
  project.titles[project.aliasFile.path] = "Eta Distinctif";
  project.activeFile.content =
    "Alpha Distinctif, Beta Distinctif, Gamma Distinctif, Delta Distinctif, " +
    "Epsilon Distinctif, Zeta Distinctif et Eta Distinctif se rencontrent tous.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  const section = reliableSection(contentEl);
  assert.ok(section);
  assert.equal(namesIn(section, { visibleOnly: true }).length, 5, "cinq résultats visibles par défaut");
  assert.equal(namesIn(section).length, 7, "le vivier complet est déjà dans le DOM, juste masqué");

  const moreBtn = showMoreBtnIn(section);
  assert.ok(moreBtn, "« Afficher davantage » doit apparaître au-delà de cinq résultats");

  const reads = spyOnReads(view);
  moreBtn.events.get("click")();
  assert.deepEqual(reads, [], "aucune relecture disque : les résultats déjà calculés sont réutilisés");
  assert.equal(namesIn(section, { visibleOnly: true }).length, 7, "tout le vivier est maintenant visible");

  moreBtn.events.get("click")();
  assert.equal(namesIn(section, { visibleOnly: true }).length, 5, "retour à l'affichage réduit");
});

test("Lot 6 — Documents associés : « Afficher davantage » sans relancer la recherche", async () => {
  const project = buildCumulativeSourcesProject();
  const extra = [];
  for (let i = 0; i < 7; i++) {
    const f = new TFile(`Projet/LiensFeuillet/Fiche${i}.md`);
    f.parent = project.feuilletLinked;
    f.stat = { mtime: 1 };
    f.content = `Document numéro ${i} : le cartographe traça le meridien avant l'aube.`;
    project.titles[f.path] = `Sans Rapport ${i}`;
    project.filesByPath.set(f.path, f);
    extra.push(f);
  }
  project.feuilletLinked.children = [project.ficheFeuillet, ...extra];
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createCumulativeSourcesView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);
  assert.equal(relatedDocNames(contentEl).length, 5);
  assert.equal(relatedDocNamesAll(contentEl).length, 7);

  const section = relatedDocsSection(contentEl);
  const moreBtn = showMoreBtnIn(section);
  assert.ok(moreBtn);

  const reads = spyOnReads(view);
  moreBtn.events.get("click")();
  assert.deepEqual(reads, [], "« Afficher davantage » ne relit rien et ne relance aucune recherche");
  assert.equal(relatedDocNames(contentEl).length, 7);
});

test("Lot 6 — provenance : Feuillet, Chapitre et Projet affichés correctement", async () => {
  const project = buildProject();
  project.titles[project.ducA.path] = "Alpha Distinctif";
  project.titles[project.ducB.path] = "Beta Distinctif";
  project.titles[project.ducC.path] = "Gamma Distinctif";
  project.activeFile.content = "Alpha Distinctif, Beta Distinctif et Gamma Distinctif se rencontrent.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(provenanceFor(contentEl, "Alpha Distinctif"), "Feuillet");
  assert.equal(provenanceFor(contentEl, "Beta Distinctif"), "Chapitre");
  assert.equal(provenanceFor(contentEl, "Gamma Distinctif"), "Projet");
});

test("Lot 6 — provenance des documents associés : jamais autre chose que Feuillet ou Chapitre", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.ducB.stat = { mtime: 1 };
  project.ducB.content = "Les corsaires embarquèrent une cargaison discrète au large des côtes.";
  project.activeFile.content =
    "Le cartographe hésitait devant le meridien tracé la veille. " +
    "Les corsaires avaient chargé une cargaison bien discrète cette nuit-là.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  const provenances = relatedDocNamesAll(contentEl).map((name) => provenanceFor(contentEl, name));
  for (const p of provenances) {
    assert.ok(p === "Feuillet" || p === "Chapitre", `provenance inattendue : ${p}`);
  }
  assert.ok(provenances.length >= 1);
});

test("Lot 6 — section « Épinglées » absente quand rien n'est épinglé", async () => {
  const project = buildProject();
  project.activeFile.content = "Un séisme frappe Lisbonne cette nuit-là.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(pinnedSection(contentEl), undefined);
  // Les deux autres sections, elles, sont bien présentes puisqu'il y a une
  // correspondance fiable — la disparition n'est donc pas un effet de bord
  // global, seule Épinglées est concernée par son absence de contenu.
  assert.ok(reliableSection(contentEl));
});

test("Lot 6 — le titre n'est jamais répété en tête de l'extrait quand il reprend le premier titre Markdown", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  // Le document commence PAR son propre titre en H1 — cleanMarkdownBody()
  // (Lot 5, inchangé) retire déjà le "#", laissant le texte du titre en
  // tête du corps nettoyé ; c'est CE cas précis que le Lot 6 doit détecter
  // à l'affichage (stripLeadingTitleFromExcerpt), sans toucher à l'extrait
  // mémorisé par matchContent() lui-même.
  project.ducA.content =
    "# Carte Secrète\n\nLe cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.titles[project.ducA.path] = "Carte Secrète";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  const excerpt = relatedDocExcerpt(contentEl, "Carte Secrète");
  assert.ok(excerpt);
  assert.equal(excerpt.toLowerCase().startsWith("carte secrète"), false, "le titre ne doit pas être répété en tête");
  assert.ok(excerpt.includes("cartographe"));
});

test("Lot 5 — document associé au FEUILLET retrouvé par son contenu (jamais par son titre)", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(contextEntityNames(contentEl).includes("Carte Secrète"), false, "aucune correspondance par titre ici");
  assert.deepEqual(relatedDocNames(contentEl), ["Carte Secrète"]);
});

test("Lot 5 — document associé au CHAPITRE retrouvé par son contenu", async () => {
  const project = buildProject();
  // DucB vit dans le dossier lié au CHAPITRE seul (pas sous feuilletResearch).
  project.ducB.stat = { mtime: 1 };
  project.ducB.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(contextEntityNames(contentEl).includes("Bragance Seul"), false, "aucune correspondance par titre ici");
  assert.deepEqual(relatedDocNames(contentEl), ["Bragance Seul"]);
});

test("Lot 5 — document NON associé (hors Binder/Recherche) jamais retrouvé par son contenu", async () => {
  const project = buildProject();
  project.etranger.stat = { mtime: 1 };
  project.etranger.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — document de la Recherche générale du projet (project-research) jamais retrouvé par le contenu", async () => {
  const project = buildProject();
  // DucC ne vit QUE sous researchRoot (project-research), hors de tout
  // dossier lié au feuillet/chapitre — contentSourcesFor() doit l'exclure.
  project.ducC.stat = { mtime: 1 };
  project.ducC.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  // Ni par titre (Lot 3, hors sujet ici), ni par contenu (Lot 5) : DucC
  // n'apparaît nulle part.
  assert.equal(citedNames(contentEl).includes("Bibliotheque Royale"), false);
  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — sous-dossier de la Recherche générale (Sub/Paris.md) jamais retrouvé par le contenu", async () => {
  const project = buildProject();
  project.parisFile.stat = { mtime: 1 };
  project.parisFile.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — une fiche déjà remontée par son titre (Lot 3) n'est jamais dupliquée dans « Documents associés »", async () => {
  const project = buildProject();
  // DucA est retrouvé par son TITRE (Lot 3, correspondance fiable) ET son
  // contenu partage aussi des termes avec le passage courant : il ne doit
  // apparaître qu'une fois, dans la section « Contexte », jamais en plus
  // dans « Documents associés ».
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "La carte secrète mentionne aussi un cartographe et un meridien oublié.";
  project.activeFile.content = "La carte secrète refait surface : cartographe et meridien y sont cités.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(citedNames(contentEl), ["Carte Secrète"]);
  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — limite stricte à cinq résultats", async () => {
  const project = buildCumulativeSourcesProject();
  const extra = [];
  for (let i = 0; i < 7; i++) {
    const file = new TFile(`Projet/LiensFeuillet/Fiche${i}.md`);
    file.parent = project.feuilletLinked;
    file.stat = { mtime: 1 };
    file.content = `Document numéro ${i} : le cartographe traça le meridien avant l'aube.`;
    project.titles[file.path] = `Sans Rapport ${i}`;
    project.filesByPath.set(file.path, file);
    extra.push(file);
  }
  project.feuilletLinked.children = [project.ficheFeuillet, ...extra];
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createCumulativeSourcesView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(relatedDocNames(contentEl).length, 5);
});

test("Lot 5 — extrait lisible centré sur la correspondance", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content =
    "Avant-propos sans intérêt. ".repeat(10) +
    "Le cartographe traça le meridien avant l'aube, loin de tout port connu. " +
    "Suite du document sans intérêt particulier. ".repeat(10);
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  const excerpt = relatedDocExcerpt(contentEl, "Carte Secrète");
  assert.ok(excerpt);
  assert.ok(excerpt.includes("cartographe"));
  assert.ok(excerpt.includes("meridien"));
});

test("Lot 5 — le frontmatter YAML n'influence jamais la correspondance ni l'extrait", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content =
    "---\ntitre: Fiche\ntags: [cartographe, meridien, secret]\n---\n" +
    "Texte réel sans rapport avec la scène.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  // Les mots "cartographe"/"meridien" ne vivent QUE dans le YAML retiré :
  // aucune correspondance ne doit en sortir.
  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — un mot générique isolé ne suffit jamais à faire remonter une fiche", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  // Un seul terme partagé ("meridien") : jamais assez, même significatif.
  project.ducA.content = "Le meridien traverse plusieurs pays et océans du globe entier.";
  project.activeFile.content = "Il évoque un meridien sans autre précision dans cette phrase.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — cache réutilisé si la mtime n'a pas changé (pas de relecture disque)", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl: firstEl } = createView(project);
  const reads = spyOnReads(view);

  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.ok(reads.includes(project.ducA.path), "première lecture attendue");

  reads.length = 0;
  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.equal(reads.includes(project.ducA.path), false, "aucune relecture disque si la mtime n'a pas bougé");
  assert.deepEqual(relatedDocNames(secondEl), ["Carte Secrète"]);
});

test("Lot 5 — mise à jour après modification du contenu d'une fiche (mtime changée)", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Contenu initial sans rapport avec la scène évoquée ici.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl: firstEl } = createView(project);

  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.deepEqual(relatedDocNames(firstEl), []);

  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.ducA.stat = { mtime: 2 };
  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(secondEl), ["Carte Secrète"]);
});

test("Lot 5 — suppression d'une fiche : elle disparaît du résultat suivant", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl: firstEl } = createView(project);

  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.deepEqual(relatedDocNames(firstEl), ["Carte Secrète"]);

  // Suppression : retirée du dossier et du vault.
  project.feuilletResearch.children = project.feuilletResearch.children.filter((c) => c !== project.ducA);
  project.filesByPath.delete(project.ducA.path);

  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(secondEl), []);
});

test("Lot 5 — renommage/déplacement d'une fiche : plus d'ancien chemin, retrouvée sous le nouveau", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl: firstEl } = createView(project);
  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.deepEqual(relatedDocNames(firstEl), ["Carte Secrète"]);

  // Renommage : nouveau TFile (nouveau path), même dossier, même contenu.
  const renamed = new TFile("Projet/_Recherche/Chapitre1/Feuillet/DucA-renomme.md");
  renamed.parent = project.feuilletResearch;
  renamed.stat = { mtime: 1 };
  renamed.content = project.ducA.content;
  project.titles[renamed.path] = "Carte Secrète";
  project.feuilletResearch.children = [renamed];
  project.filesByPath.delete(project.ducA.path);
  project.filesByPath.set(renamed.path, renamed);

  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(secondEl), ["Carte Secrète"]);
});

test("Lot 5 — changement d'association Binder ↔ Recherche : plus retrouvée une fois le lien retiré", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl: firstEl, plugin } = createView(project);
  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.deepEqual(relatedDocNames(firstEl), ["Carte Secrète"]);

  // Le lien Binder ↔ Recherche est retiré pour le feuillet, et
  // feuilletResearch (qui contient DucA) est détaché de chapterResearch —
  // sans quoi le lien restant sur le chapitre continuerait à le retrouver
  // par récursion. Isole proprement "plus aucune source ne mène à DucA".
  project.chapterResearch.children = project.chapterResearch.children.filter(
    (c) => c !== project.feuilletResearch
  );
  plugin.getLinkedResearchFolder = (node) => (node.path === project.chapterFolder.path ? project.chapterResearch : null);

  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(secondEl), []);
});

test("Lot 5 — changement de paragraphe : aucun résidu de l'ancien passage", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Le cartographe traça le meridien avant l'aube, loin de tout port connu.";
  project.ducB.stat = { mtime: 1 };
  // Volontairement sans "Bragance"/"Seul" (titre de ducB) : un mot du titre
  // seul déclencherait une correspondance FIABLE (Lot 3, distinctive-term)
  // qui masquerait ducB de « Documents associés » par déduplication — hors
  // sujet ici, qui teste uniquement le Lot 5 en isolation.
  project.ducB.content = "Les corsaires embarquèrent une cargaison discrète au large des côtes.";
  const { view } = createView(project);

  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const firstEl = new FakeElement();
  await view.renderCitedEntities(firstEl, project.activeFile, null, []);
  assert.deepEqual(relatedDocNames(firstEl), ["Carte Secrète"]);

  project.activeFile.content = "Les corsaires avaient chargé une cargaison bien discrète cette nuit-là.";
  const secondEl = new FakeElement();
  await view.renderCitedEntities(secondEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(secondEl), ["Bragance Seul"]);
});

test("Lot 5 — fiche vide n'est jamais proposée", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "";
  project.activeFile.content = "Le cartographe hésitait devant le meridien tracé la veille.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("Lot 5 — aucune section « Documents associés » quand rien ne remonte", async () => {
  const project = buildProject();
  project.ducA.stat = { mtime: 1 };
  project.ducA.content = "Contenu sans le moindre rapport avec la scène.";
  project.activeFile.content = "Rien de pertinent ici non plus.";
  const { view, contentEl } = createView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.equal(relatedDocsSection(contentEl), undefined);
});

/* ===================== Régression signalée en test manuel : « Commerce
 * caravanier » (dossier associé « Arabie ») invisible malgré deux termes
 * communs bien présents à l'œil dans les deux textes. Cause : le texte de
 * la fiche était encodé en Unicode décomposé (NFD — accent combinant séparé
 * de sa lettre, ex. clavier français macOS/certains copier-coller), ce qui
 * cassait "épices" en deux jetons dans context-content-matcher.ts avant
 * correction. Reproduit ici à l'identique (mêmes deux phrases que le
 * rapport de bug), fiche en NFD pour reproduire fidèlement les conditions
 * du test manuel. ===================== */
test("Régression — « Commerce caravanier » (dossier associé « Arabie ») retrouvé malgré un encodage NFD/NFC différent", async () => {
  const project = buildCumulativeSourcesProject();
  // Réutilise le dossier déjà lié au FEUILLET (voir buildCumulativeSourcesProject)
  // comme "Arabie", et sa fiche comme "Commerce caravanier" — même montage
  // que le rapport de bug (dossier associé directement au feuillet actif).
  project.titles[project.ficheFeuillet.path] = "Commerce caravanier";
  project.ficheFeuillet.stat = { mtime: 1 };
  // NFD : reproduit fidèlement l'encodage constaté en test manuel.
  project.ficheFeuillet.content =
    "Les caravanes transportent des épices et des tissus précieux entre les villes.".normalize("NFD");
  project.activeFile.content =
    "Les marchands déchargèrent leurs tissus et leurs épices avant la tombée de la nuit.";
  const { view, contentEl } = createCumulativeSourcesView(project);

  await view.renderCitedEntities(contentEl, project.activeFile, null, []);

  assert.ok(relatedDocsSection(contentEl), "la section « Documents associés » doit apparaître");
  assert.deepEqual(relatedDocNames(contentEl), ["Commerce caravanier"]);
  const excerpt = relatedDocExcerpt(contentEl, "Commerce caravanier");
  assert.ok(excerpt.includes("épices") || excerpt.normalize("NFC").includes("épices"));
  assert.ok(excerpt.includes("tissus"));
});

test("Lot 6 — Hiérarchie Références du passage : date sous l'en-tête, événement avant alertes et références ordinaires", async () => {
  const project = buildProject();
  project.frontmatter = {};
  project.titles[project.ducA.path] = "Élimination des janissaires";
  project.tags[project.ducA.path] = ["evenement"];

  project.titles[project.ducB.path] = "Deli";
  project.tags[project.ducB.path] = ["personnage"];
  project.frontmatter[project.ducB.path] = { death: "1815" };

  project.titles[project.ducC.path] = "Montre-bracelet";
  project.frontmatter[project.ducC.path] = { anachronisme: "Objet anachronique pour cette date." };

  project.titles[project.lisbonne.path] = "Futuriste";
  project.tags[project.lisbonne.path] = ["personnage"];
  project.frontmatter[project.lisbonne.path] = { birth: "1850" };

  project.titles[project.parisFile.path] = "Café du Hedjaz";

  project.activeFile.content =
    "Élimination des janissaires, Deli, Montre-bracelet, Futuriste et Café du Hedjaz.";

  const { view, contentEl } = createView(project);
  const sceneDate = storyDate(1826);

  await view.renderCitedEntities(contentEl, project.activeFile, sceneDate, []);

  const section = reliableSection(contentEl);
  assert.ok(section, "la section Contexte doit exister");

  // Date affichée sous l'en-tête de section
  const dateLine = allElements(section).find((el) => el.classes.has("feuillets-context-date-line"));
  assert.ok(dateLine, "la date doit être présente sous l'en-tête Contexte");
  assert.equal(dateLine.text, "1826");

  // Ordre strict : 1. Événement, 2. Alertes (Deli, Montre-bracelet, Futuriste), 3. Référence ordinaire
  const names = namesIn(section);
  assert.equal(names[0], "Élimination des janissaires", "1. Contexte chronologique (événement)");
  assert.ok(names.slice(1, 4).includes("Deli"), "2. Alertes chronologiques (Deli mort)");
  assert.ok(names.slice(1, 4).includes("Montre-bracelet"), "2. Alertes chronologiques (anachronisme)");
  assert.ok(names.slice(1, 4).includes("Futuriste"), "2. Alertes chronologiques (pas encore né)");
  assert.equal(names[4], "Café du Hedjaz", "3. Références ordinaires");

  // Icône d'alerte présente sur Deli, Montre-bracelet et Futuriste, absente sur Café du Hedjaz
  const deliRow = rowFor(section, "Deli");
  assert.ok(allElements(deliRow).some((el) => el.classes.has("feuillets-entity-alert-icon")), "icône d'alerte ⚠ sur Deli");
  assert.ok(ageFor(section, "Deli").includes("1815"), "mention de mort sur Deli");

  const montreRow = rowFor(section, "Montre-bracelet");
  assert.ok(allElements(montreRow).some((el) => el.classes.has("feuillets-entity-alert-icon")), "icône d'alerte ⚠ sur Montre-bracelet");

  const futuristeRow = rowFor(section, "Futuriste");
  assert.ok(allElements(futuristeRow).some((el) => el.classes.has("feuillets-entity-alert-icon")), "icône d'alerte ⚠ sur personnage pas encore né");

  const cafeRow = rowFor(section, "Café du Hedjaz");
  assert.equal(allElements(cafeRow).some((el) => el.classes.has("feuillets-entity-alert-icon")), false, "pas d'alerte sur référence ordinaire");

  // Provenance absente du texte visible mais conservée dans l'attribut
  assert.equal(allElements(cafeRow).some((el) => el.classes.has("feuillets-entity-provenance")), false, "provenance absente du texte visible");
  assert.ok(cafeRow.attributes["data-provenance"], "provenance présente dans data-provenance");
});
