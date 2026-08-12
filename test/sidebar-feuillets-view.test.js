import assert from "node:assert/strict";
import test from "node:test";
import { SidebarFeuilletsView } from "../src/views/sidebar-feuillets-view.js";
import { t } from "../src/i18n/index.js";
import { DiffModal } from "../src/ui/diff-modal.js";

class FakeElement {
  constructor(options = {}) {
    this.tag = options.tag || "div";
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = new Map();
    this.text = options.text ?? "";
    this.parentNode = null;
    if (options.cls) this.addClass(options.cls);
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) this.attrs.set(key, value);
    }
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }

  createEl(tag, options = {}) {
    const child = new FakeElement({ ...options, tag });
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  setAttr(name, value) { this.attrs.set(name, value); }
  setText(text) { this.text = String(text); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  prepend(child) { this.children = [child, ...this.children.filter((c) => c !== child)]; }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function createSubView(name, calls) {
  return {
    targetContainer: null,
    async render(force) { calls.push({ name, force, targetContainer: this.targetContainer }); },
  };
}

function createSidebar(activeRightPanelTab = "notes", order = [], hiddenPanels = [], { activeFile = null, projectFolder = null } = {}) {
  const contentEl = new FakeElement();
  const listeners = { workspace: new Map(), vault: new Map() };
  const settings = new Proxy(
    { activeRightPanelTab, hiddenPanels },
    {
      set(target, key, value) {
        if (key === "activeRightPanelTab") order.push("settings");
        target[key] = value;
        return true;
      },
    }
  );
  const app = {
    workspace: {
      on(name, callback) { listeners.workspace.set(name, callback); return { name }; },
      getActiveFile() { return activeFile; },
    },
    vault: { on(name, callback) { listeners.vault.set(name, callback); return { name }; } },
  };
  const plugin = {
    settings,
    async saveSettings() { order.push("save"); },
    getProjectFolder() { return projectFolder; },
  };
  const sidebar = new SidebarFeuilletsView({ app, contentEl }, plugin);
  const calls = [];
  sidebar.subViews = {
    notes: createSubView("notes", calls),
    research: createSubView("research", calls),
    journal: createSubView("journal", calls),
    project: createSubView("project", calls),
    docx: createSubView("docx", calls),
    editionDocs: createSubView("editionDocs", calls),
    editionComposition: createSubView("editionComposition", calls),
    editionLayout: createSubView("editionLayout", calls),
    editionExport: createSubView("editionExport", calls),
    analyse: {
      ...createSubView("analyse", calls),
      _chaptersCache: "chapters",
      _vocabCache: "vocab",
      _dashboardCache: "dashboard",
      _romanVocabCache: "roman",
    },
    relecture: createSubView("relecture", calls),
  };
  return { sidebar, contentEl, settings, listeners, calls, order };
}

test("SidebarFeuilletsView remplace les onglets historiques docx et metadata", () => {
  // DocxReviewView n'habite plus l'espace Édition ("project") : l'ancien
  // activeRightPanelTab "docx" ouvre désormais Relecture, directement sur
  // sa page secondaire Révision DOCX (voir tests dédiés plus bas).
  const docx = createSidebar("docx").sidebar;
  assert.equal(docx.activeTab, "relecture");
  assert.equal(docx.relecturePage, "docx");

  const analyse = createSidebar("analyse").sidebar;
  assert.equal(analyse.activeTab, "relecture");
  assert.equal(analyse.relecturePage, "analysis");

  assert.equal(createSidebar("metadata").sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"docx\" ouvre Relecture directement sur Révision DOCX", async () => {
  const { sidebar, calls } = createSidebar("docx");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["docx"]);
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"analyse\" ouvre Relecture directement sur Analyse du texte", async () => {
  const { sidebar, calls } = createSidebar("analyse");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["relecture"]);
});

test("SidebarFeuilletsView démarre sur l'onglet Recherche mémorisé", () => {
  assert.equal(createSidebar("research").sidebar.activeTab, "research");
});

test("SidebarFeuilletsView n'affiche pas les onglets masqués", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "file-edit", "spell-check",
  ]);
});

test("SidebarFeuilletsView conserve l'ordre des quatre onglets visibles", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research", "analyse"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "file-edit", "spell-check",
  ]);
});

test("SidebarFeuilletsView bascule vers le premier onglet visible si l'onglet mémorisé est masqué", async () => {
  const { sidebar } = createSidebar("research", [], ["research"]);

  await sidebar.render();

  assert.equal(sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView ignore docxReview dans hiddenPanels pour l'onglet Édition", async () => {
  const { sidebar, contentEl } = createSidebar("project", [], ["docxReview"]);

  await sidebar.render();

  assert.ok(contentEl.children[0].children.some((button) => button.icon === "file-edit"));
});

test("SidebarFeuilletsView sauvegarde l'onglet avant de relancer le rendu", async () => {
  const { sidebar, contentEl, order } = createSidebar("notes");
  await sidebar.render();
  const projectButton = contentEl.children[0].children[3];
  let activeTab = sidebar.activeTab;
  Object.defineProperty(sidebar, "activeTab", {
    get: () => activeTab,
    set: (value) => { order.push("activeTab"); activeTab = value; },
  });
  sidebar.render = async () => { order.push("render"); };

  await projectButton.events.get("click")();

  assert.deepEqual(order, ["activeTab", "settings", "save", "render"]);
});

test("SidebarFeuilletsView rend uniquement la sous-vue de l'onglet sélectionné", async () => {
  const { sidebar, calls } = createSidebar();
  for (const tab of ["notes", "research", "journal"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    await sidebar.render();
    assert.deepEqual(calls.map((call) => call.name), [tab]);
  }
});

test("SidebarFeuilletsView : espace Édition s'ouvre sur la page d'accueil, trois entrées verticales dans l'ordre, aucune sous-vue rendue", async () => {
  const { sidebar, calls } = createSidebar("project");
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  assert.equal(sidebar.editionPage, "home", "page par défaut");
  // Aucune sous-vue complète rendue sur l'accueil — même règle que
  // l'accueil Relecture (renderRelectureHome).
  assert.deepEqual(calls.map((call) => call.name), []);
  assert.equal(calls.some((call) => call.name === "docx"), false, "l'espace Édition ne rend plus DocxReviewView");

  // Trois lignes compactes cliquables, PAS une tablist horizontale : même
  // gabarit que l'accueil Relecture (.feuillets-notes-section-head +
  // .feuillets-clickable), une sous chaque autre (aucun conteneur flex
  // horizontal commun ne les regroupe).
  const heads = allElements(container).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.equal(heads.length, 3, "trois lignes compactes cliquables");
  assert.equal(allElements(container).some((el) => el.attrs.get("role") === "tablist"), false, "pas de tablist horizontale");

  const titles = allElements(container)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    t("editionComposition.displayText"),
    t("editionLayout.displayText"),
    t("editionDocs.displayText"),
  ], "ordre : Composition de l’ouvrage → Mise en page & export → Documents éditoriaux");
});

test("SidebarFeuilletsView : cliquer Composition de l'ouvrage affiche uniquement Composition, Retour ramène à l'accueil", async () => {
  const { sidebar, contentEl, calls } = createSidebar("project");
  await sidebar.render();

  const [compositionHead] = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  let renders = 0;
  sidebar.render = async () => { renders += 1; };
  compositionHead.events.get("click")();
  assert.equal(sidebar.editionPage, "composition");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["editionComposition"], "uniquement EditionCompositionView");

  const backBtn = allElements(contentEl.children[1]).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "barre Retour visible");

  renders = 0;
  sidebar.render = async () => { renders += 1; };
  backBtn.events.get("click")();
  assert.equal(sidebar.editionPage, "home");
  assert.equal(renders, 1);
});

test("SidebarFeuilletsView : cliquer Mise en page & export affiche uniquement Mise en page, Retour ramène à l'accueil", async () => {
  const { sidebar, contentEl, calls } = createSidebar("project");
  await sidebar.render();

  const [, layoutHead] = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  let renders = 0;
  sidebar.render = async () => { renders += 1; };
  layoutHead.events.get("click")();
  assert.equal(sidebar.editionPage, "layout");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["editionLayout"], "uniquement EditionLayoutView");

  const backBtn = allElements(contentEl.children[1]).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "barre Retour visible");

  renders = 0;
  sidebar.render = async () => { renders += 1; };
  backBtn.events.get("click")();
  assert.equal(sidebar.editionPage, "home");
  assert.equal(renders, 1);
});

test("SidebarFeuilletsView : cliquer Documents éditoriaux affiche uniquement Documents, Retour ramène à l'accueil", async () => {
  const { sidebar, contentEl, calls } = createSidebar("project");
  await sidebar.render();

  const [, , docsHead] = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  let renders = 0;
  sidebar.render = async () => { renders += 1; };
  docsHead.events.get("click")();
  assert.equal(sidebar.editionPage, "docs");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["editionDocs"], "uniquement EditionDocsView");

  const backBtn = allElements(contentEl.children[1]).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "barre Retour visible");

  renders = 0;
  sidebar.render = async () => { renders += 1; };
  backBtn.events.get("click")();
  assert.equal(sidebar.editionPage, "home");
  assert.equal(renders, 1);
});

test("SidebarFeuilletsView : la barre Retour de l'espace Édition survit au vidage de son propre conteneur par la sous-vue", async () => {
  const { sidebar, contentEl, calls } = createSidebar("project");
  sidebar.subViews.editionComposition = createEmptyingSubView("editionComposition", calls);
  sidebar.editionPage = "composition";

  await sidebar.render();

  let content = contentEl.children[1];
  let backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "barre Retour visible pour Édition");
  assert.equal(
    allElements(sidebar.subViews.editionComposition.targetContainer).includes(backBtn),
    false,
    "la barre Retour n'est pas dans le targetContainer de la sous-vue"
  );

  await sidebar.render();
  content = contentEl.children[1];
  backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "barre Retour toujours visible après un second rendu");
});

test("SidebarFeuilletsView ne rafraîchit au file-open que Notes et Analyse du texte, jamais l'accueil Relecture ni Révision DOCX", async () => {
  const { sidebar, listeners, calls } = createSidebar();
  const registered = [];
  sidebar.registerEvent = (event) => registered.push(event);
  sidebar.render = async () => {};
  await sidebar.onOpen();

  const cases = [
    { tab: "notes", page: "home", expected: ["notes"] },
    { tab: "research", page: "home", expected: [] },
    { tab: "journal", page: "home", expected: [] },
    { tab: "project", page: "home", expected: [] },
    { tab: "relecture", page: "home", expected: [] },
    { tab: "relecture", page: "analysis", expected: ["relecture"] },
    { tab: "relecture", page: "docx", expected: [] },
  ];
  for (const { tab, page, expected } of cases) {
    calls.length = 0;
    sidebar.activeTab = tab;
    sidebar.relecturePage = page;
    listeners.workspace.get("file-open")();
    await Promise.resolve();
    assert.deepEqual(calls.map((call) => call.name), expected, `${tab}/${page}`);
  }
  assert.equal(registered.length, 2);
});

test("SidebarFeuilletsView invalide les caches Analyse à la modification", async () => {
  const { sidebar, listeners } = createSidebar();
  sidebar.registerEvent = () => {};
  sidebar.render = async () => {};
  await sidebar.onOpen();
  listeners.vault.get("modify")();

  assert.equal(sidebar.subViews.analyse._chaptersCache, null);
  assert.equal(sidebar.subViews.analyse._dashboardCache, null);
  assert.equal(sidebar.subViews.notes.targetContainer, null);
});

test("SidebarFeuilletsView renderAllSubViews respecte la nouvelle organisation : Édition selon sa page (rien sur l'accueil, une seule sous-vue sinon), Relecture selon sa page, une seule sous-vue pour les autres onglets", async () => {
  const { sidebar, calls } = createSidebar("project");
  // Accueil Édition par défaut : rien à rafraîchir (pas de sous-vue affichée).
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), [], "rien sur l'accueil Édition");

  calls.length = 0;
  sidebar.editionPage = "composition";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["editionComposition"], "seule la page Édition active est rafraîchie");

  calls.length = 0;
  sidebar.editionPage = "layout";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["editionLayout"], "seule la page Édition active est rafraîchie");
  sidebar.editionPage = "home";

  calls.length = 0;
  sidebar.activeTab = "research";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["research"]);

  // Relecture : rien à rafraîchir sur l'accueil (pas de sous-vue affichée),
  // uniquement TextAnalysisView sur "analysis", uniquement DocxReviewView
  // sur "docx".
  calls.length = 0;
  sidebar.activeTab = "relecture";
  sidebar.relecturePage = "home";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), []);

  calls.length = 0;
  sidebar.relecturePage = "analysis";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["relecture"]);

  calls.length = 0;
  sidebar.relecturePage = "docx";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["docx"]);
});

test("SidebarFeuilletsView utilise le rendu Édition pour un onglet invalide sans écrire les réglages", async () => {
  const { sidebar, settings, calls } = createSidebar("invalide");
  await sidebar.render();

  assert.equal(settings.activeRightPanelTab, "invalide");
  // Édition retombe sur sa page d'accueil : aucune sous-vue rendue.
  assert.deepEqual(calls.map((call) => call.name), []);
  assert.equal(sidebar.editionPage, "home");
});

test("SidebarFeuilletsView : l'accueil Relecture affiche Analyse du texte et Révision DOCX sans rendre leurs sous-vues", async () => {
  const { sidebar, contentEl, calls } = createSidebar("relecture");
  await sidebar.render();

  assert.equal(sidebar.relecturePage, "home");
  assert.deepEqual(calls.map((call) => call.name), [], "aucune des deux sous-vues complètes n'est rendue");

  const content = contentEl.children[1];
  const heads = allElements(content).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.equal(heads.length, 2, "deux lignes compactes cliquables");

  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [t("relecture.home.analysis.title"), t("relecture.home.docx.title")]);

  const subs = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-sub"))
    .map((el) => el.text);
  assert.deepEqual(subs, [t("relecture.home.analysis.sub"), t("relecture.home.docx.sub")]);

  // Pas de carte lourde : aucun .feuillets-hub-card sur cette page.
  assert.equal(allElements(content).some((el) => el.classes.has("feuillets-hub-card")), false);
});

test("SidebarFeuilletsView : cliquer sur Analyse du texte puis Révision DOCX ouvre chaque fois la sous-vue correspondante, seule", async () => {
  const { sidebar, contentEl, calls } = createSidebar("relecture");
  await sidebar.render();

  const [analysisHead] = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  let renders = 0;
  sidebar.render = async () => { renders += 1; };
  analysisHead.events.get("click")();
  assert.equal(sidebar.relecturePage, "analysis");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["relecture"], "uniquement TextAnalysisView");

  // Retour à l'accueil pour rejouer le même scénario avec Révision DOCX.
  sidebar.relecturePage = "home";
  await sidebar.render();
  const heads = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  renders = 0;
  sidebar.render = async () => { renders += 1; };
  heads[1].events.get("click")();
  assert.equal(sidebar.relecturePage, "docx");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["docx"], "uniquement DocxReviewView");
});

test("SidebarFeuilletsView : le bouton Retour des pages secondaires de Relecture revient à l'accueil", async () => {
  for (const legacyTab of ["docx", "analyse"]) {
    const { sidebar, contentEl } = createSidebar(legacyTab);
    await sidebar.render();

    const backBtn = allElements(contentEl.children[1]).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre de retour attendue pour ${legacyTab}`);

    let renders = 0;
    sidebar.render = async () => { renders += 1; };
    backBtn.events.get("click")();

    assert.equal(sidebar.relecturePage, "home");
    assert.equal(renders, 1);
  }
});

/** Sous-vue factice qui reproduit le comportement réel de TextAnalysisView/
 * DocxReviewView : elle vide ENTIÈREMENT son propre targetContainer au
 * début de render() (comme leur `container.empty()`), puis y pose un
 * marqueur. Sert à prouver que la barre Retour — postée ailleurs — survit
 * à ce vidage plutôt que de le supposer. */
function createEmptyingSubView(name, calls) {
  return {
    targetContainer: null,
    async render(force) {
      calls.push({ name, force, targetContainer: this.targetContainer });
      if (this.targetContainer) {
        this.targetContainer.empty();
        this.targetContainer.createDiv({ cls: `feuillets-${name}-marker` });
      }
    },
  };
}

test("SidebarFeuilletsView : la barre Retour des pages Analyse/Révision DOCX survit au vidage de leur propre conteneur par la sous-vue", async () => {
  for (const [legacyTab, subViewKey] of [["analyse", "relecture"], ["docx", "docx"]]) {
    const { sidebar, contentEl, calls } = createSidebar(legacyTab);
    sidebar.subViews[subViewKey] = createEmptyingSubView(subViewKey, calls);

    await sidebar.render();

    let content = contentEl.children[1];
    let backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre Retour visible pour ${legacyTab}`);
    // La barre Retour n'habite jamais le conteneur que la sous-vue a le
    // droit de vider : elle ne peut donc structurellement pas l'effacer.
    assert.equal(
      allElements(sidebar.subViews[subViewKey].targetContainer).includes(backBtn),
      false,
      "la barre Retour n'est pas dans le targetContainer de la sous-vue"
    );
    let marker = allElements(content).find((el) => el.classes.has(`feuillets-${subViewKey}-marker`));
    assert.ok(marker, `contenu de la sous-vue rendu pour ${legacyTab}`);

    // Un second rendu (ex. changement de feuillet actif) revide de nouveau
    // le même conteneur — la barre Retour, elle, reste intacte.
    await sidebar.render();
    content = contentEl.children[1];
    backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre Retour toujours visible après un second rendu (${legacyTab})`);
    marker = allElements(content).find((el) => el.classes.has(`feuillets-${subViewKey}-marker`));
    assert.ok(marker, `contenu de la sous-vue toujours rendu après un second rendu (${legacyTab})`);

    // Et le clic Retour fonctionne toujours.
    let renders = 0;
    sidebar.render = async () => { renders += 1; };
    backBtn.events.get("click")();
    assert.equal(sidebar.relecturePage, "home");
    assert.equal(renders, 1);
  }
});

test("SidebarFeuilletsView : l'accueil Relecture propose Comparer une version pour un feuillet Markdown valide du projet actif", async () => {
  const projectFolder = { path: "Projet" };
  const activeFile = { path: "Projet/scene.md", extension: "md" };
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { activeFile, projectFolder });

  await sidebar.render();
  const content = contentEl.children[1];
  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    t("relecture.home.analysis.title"),
    t("relecture.home.docx.title"),
    t("relecture.home.diff.title"),
  ]);
  const subs = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-sub"))
    .map((el) => el.text);
  assert.deepEqual(subs, [
    t("relecture.home.analysis.sub"),
    t("relecture.home.docx.sub"),
    t("relecture.home.diff.sub"),
  ]);
});

test("SidebarFeuilletsView : Comparer une version n'apparaît pas sans feuillet Markdown valide du projet actif", async () => {
  const cases = [
    { activeFile: null, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Projet/image.png", extension: "png" }, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Ailleurs/scene.md", extension: "md" }, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Projet/scene.md", extension: "md" }, projectFolder: null },
  ];
  for (const options of cases) {
    const { sidebar, contentEl } = createSidebar("relecture", [], [], options);
    await sidebar.render();
    const titles = allElements(contentEl.children[1])
      .filter((el) => el.classes.has("feuillets-notes-section-title"))
      .map((el) => el.text);
    assert.deepEqual(titles, [t("relecture.home.analysis.title"), t("relecture.home.docx.title")]);
  }
});

test("SidebarFeuilletsView : cliquer sur Comparer une version ouvre DiffModal avec le feuillet actif, sans créer de troisième page", async () => {
  const projectFolder = { path: "Projet" };
  const activeFile = { path: "Projet/scene.md", extension: "md" };
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { activeFile, projectFolder });
  await sidebar.render();

  const original = DiffModal.prototype.open;
  let opened = null;
  DiffModal.prototype.open = function () { opened = this; };
  try {
    const rows = allElements(contentEl.children[1]).filter(
      (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
    );
    assert.equal(rows.length, 3);
    rows[2].events.get("click")();

    assert.ok(opened, "DiffModal.open() appelé");
    assert.equal(opened.currentFile, activeFile);
    assert.equal(sidebar.relecturePage, "home", "aucune troisième page secondaire créée");
  } finally {
    DiffModal.prototype.open = original;
  }
});
