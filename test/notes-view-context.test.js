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
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  remove() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
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
    async saveSettings() {},
  };
  const view = new NotesView({ app, contentEl }, plugin);
  // aliasesOf() lit this.fm(file)?.aliases — même cache de métadonnées
  // qu'utilisait déjà l'ancienne détection (voir NotesView.aliasesOf).
  view.fm = (file) => ({ aliases: project.aliases?.[file.path] });
  return { view, contentEl, app, plugin };
}

function citedNames(contentEl) {
  return allElements(contentEl)
    .filter((el) => el.classes.has("feuillets-entity-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
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
