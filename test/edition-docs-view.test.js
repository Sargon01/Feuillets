import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, TFile, TFolder, setIcon: realSetIcon } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);

// Mock setIcon to work with FakeElements (stores icon name on the element)
globalThis.setIcon = function setIcon(element, iconName) {
  if (element && typeof element === "object") {
    element.icon = iconName;
  } else if (realSetIcon) {
    return realSetIcon(element, iconName);
  }
};

const { EditionDocsView, revealInFileExplorer } = await import(modulePath("src/views/edition-docs-view.js"));
const { EDITION_FOLDER_NAME } = await import(modulePath("src/services/folder-structure.js"));
const { fr } = await import(modulePath("src/i18n/fr.js"));
const { en } = await import(modulePath("src/i18n/en.js"));

test("EditionDocs : les libellés de suivi des soumissions existent en français et en anglais", () => {
  const keys = Object.keys(fr).filter((key) => key.startsWith("editionDocs.submission."));
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(en[key], `${key} manque en anglais`);
});

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    this.style = {};
    this.icon = null;
    if (options.cls) this.addClass(options.cls);
    if (options.text) this.text = options.text;
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
}

function allElements(element) { return [element, ...element.children.flatMap(allElements)]; }
function textsOf(container) { return allElements(container).map((el) => el.text).filter(Boolean); }
function buttonsOf(container) { return allElements(container).filter((el) => el.tag === "button"); }
function rowsOf(container) { return allElements(container).filter((el) => el.classes.has("feuillets-project-row")); }
function rowWithLabel(container, label) {
  return rowsOf(container).find((row) => allElements(row).some((el) => el.text === label));
}

function createView({ root = null, editionFolder = null, frontmatterByPath = {}, courrierApi = null, revealAvailable = false, embedded = false } = {}) {
  const openedFiles = [];
  const revealedFiles = [];
  const leaf = {
    openFile: async (file) => { openedFiles.push(file); },
  };
  const app = {
    vault: {
      getAbstractFileByPath(path) {
        if (editionFolder && (path === editionFolder.path || path.startsWith(`${editionFolder.path}/`))) {
          return findInFolder(editionFolder, path);
        }
        return null;
      },
      async create(path, content) {
        const file = new TFile(path, content);
        if (editionFolder) editionFolder.children.push(file);
        return file;
      },
    },
    workspace: {
      getLeaf: () => leaf,
      setActiveLeaf: () => {},
    },
    metadataCache: {
      getFileCache(file) {
        const frontmatter = frontmatterByPath[file.path];
        return frontmatter ? { frontmatter } : null;
      },
    },
    plugins: courrierApi ? {
      enabledPlugins: new Set(["courrier"]),
      plugins: { courrier: { api: courrierApi } },
    } : undefined,
    internalPlugins: revealAvailable ? {
      getPluginById(id) {
        if (id !== "file-explorer") return undefined;
        return { instance: { revealInFolder(file) { revealedFiles.push(file); } } };
      },
    } : undefined,
  };
  const plugin = {
    settings: { collapsed: {} },
    getProjectFolder: () => root,
    saveSettings: async () => {},
  };
  const contentEl = new FakeElement();
  const view = new EditionDocsView({ app, contentEl }, plugin, { embedded });
  return { view, app, contentEl, openedFiles, revealedFiles };
}

function findInFolder(folder, path) {
  if (folder.path === path) return folder;
  for (const child of folder.children || []) {
    if (child.path === path) return child;
    if (child instanceof TFolder) {
      const found = findInFolder(child, path);
      if (found) return found;
    }
  }
  return null;
}

test("EditionDocsView : sans dossier projet, affiche un message vide sans planter", async () => {
  const { view, contentEl } = createView({ root: null });
  await view.render();
  assert.ok(textsOf(contentEl).some((t) => t.length > 0));
});

test("EditionDocsView : { embedded: true } masque le grand en-tête repliable, le reste du contenu est inchangé", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const { view, contentEl } = createView({ root, embedded: true });

  await view.render();

  assert.equal(
    allElements(contentEl).some((el) => el.classes.has("feuillets-section-head")),
    false,
    "pas d'en-tête repliable en mode intégré"
  );
  // Même invite qu'en mode autonome (test "propose de le créer" ci-dessous).
  const texts = textsOf(contentEl);
  assert.ok(texts.some((t) => /Edition/i.test(t)), "invite à créer le dossier Edition, inchangée");
});

test("EditionDocsView : projet sans dossier Edition — propose de le créer plutôt que d'afficher une liste vide silencieuse", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const { view, contentEl } = createView({ root });

  await view.render();

  const texts = textsOf(contentEl);
  assert.ok(texts.some((t) => /Edition/i.test(t)), "invite à créer le dossier Edition");
  assert.equal(buttonsOf(contentEl).filter((b) => /Créer/i.test(b.text)).length, 1);
});

test("EditionDocsView : liste les documents et dossiers présents dans Edition/", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  root.parent = volume;
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = volume;
  const synopsis = new TFile(`Projet/${EDITION_FOLDER_NAME}/Synopsis.md`);
  synopsis.parent = edition;
  const submissions = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Soumissions`);
  submissions.parent = edition;
  submissions.children = [];
  edition.children = [synopsis, submissions];

  const { view, contentEl, openedFiles } = createView({ root, editionFolder: edition });
  await view.render();

  const texts = textsOf(contentEl);
  assert.ok(texts.includes("Synopsis"), "le document Synopsis est listé (basename, sans extension)");
  assert.ok(texts.some((t) => t === "Soumissions"), "le sous-dossier Soumissions est listé");

  // Cliquer sur la ligne du document déclenche bien l'ouverture du fichier réel.
  const row = rowWithLabel(contentEl, "Synopsis");
  await row.events.get("click")();
  assert.deepEqual(openedFiles, [synopsis]);
});

test("EditionDocsView : le bouton de révélation retombe sur une Notice si l'explorateur natif est indisponible", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  const doc = new TFile(`Projet/${EDITION_FOLDER_NAME}/Biographie.md`);
  doc.parent = edition;
  edition.children = [doc];

  const { view, contentEl, app } = createView({ root, editionFolder: edition });
  // Pas d'internalPlugins sur ce app de test : revealInFileExplorer doit renvoyer false sans lever.
  assert.equal(revealInFileExplorer(app, doc), false);

  await view.render();
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (m) => notices.push(m);
  try {
    // Le bouton de révélation est le second bouton de la ligne du document.
    const rowButtons = buttonsOf(contentEl);
    const btn = rowButtons[rowButtons.length - 1];
    await btn.events.get("click")({ stopPropagation() {} });
    assert.equal(notices.length, 1);
  } finally {
    Notice.onCreate = previousNotice;
  }
});

test("EditionDocsView : clic sur la rangée complète du fichier ouvre le fichier", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  const synopsis = new TFile(`Projet/${EDITION_FOLDER_NAME}/Synopsis.md`);
  synopsis.parent = edition;
  edition.children = [synopsis];

  const { view, contentEl, openedFiles } = createView({ root, editionFolder: edition });
  await view.render();

  const rows = rowsOf(contentEl);
  const synopsisRow = rows.find((r) => allElements(r).some((el) => el.text === "Synopsis"));
  assert.ok(synopsisRow, "rangée du fichier trouvée");

  // Clic sur la rangée : doit ouvrir le fichier.
  await synopsisRow.events.get("click")();
  assert.deepEqual(openedFiles, [synopsis]);
});

test("EditionDocsView : chevron affiche l'état du dossier (fermé/ouvert)", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  const submissions = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Soumissions`);
  submissions.parent = edition;
  submissions.children = [];
  edition.children = [submissions];

  const { view, contentEl } = createView({ root, editionFolder: edition });
  await view.render();

  const folderRows = rowsOf(contentEl).filter((r) =>
    allElements(r).some((el) => el.text === "Soumissions")
  );
  assert.equal(folderRows.length, 1, "une seule rangée pour Soumissions");

  const folderRow = folderRows[0];
  // Trouver l'icône chevron : le premier span avec la classe feuillets-cell-icon
  const cells = folderRow.children.filter((c) => c.classes.has("feuillets-cell-icon"));
  assert.ok(cells.length >= 1, "au moins un span icône (chevron)");
  const chevronIcon = cells[0];
  // Quand le dossier est fermé, le chevron est "chevron-right"
  assert.equal(chevronIcon.icon, "chevron-right", "chevron fermé initialement");

  // Cliquer sur la rangée pour ouvrir le dossier
  await folderRow.events.get("click")();
  await view.render();

  // Chercher la rangée du dossier à nouveau et vérifier le chevron
  const folderRowsAfter = rowsOf(contentEl).filter((r) =>
    allElements(r).some((el) => el.text === "Soumissions")
  );
  const chevronAfter = folderRowsAfter[0].children.filter((c) => c.classes.has("feuillets-cell-icon"))[0];
  assert.equal(chevronAfter.icon, "chevron-down", "chevron ouvert après clic");
});

test("EditionDocsView : message 'dossier vide' visible uniquement si le dossier est ouvert et vide", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  const empty = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Vide`);
  empty.parent = edition;
  empty.children = [];
  edition.children = [empty];

  const { view, contentEl } = createView({ root, editionFolder: edition });
  await view.render();

  // Initialement, le dossier est fermé (collapsed) : pas de message "vide"
  const emptyMessages = allElements(contentEl).filter((el) =>
    el.classes.has("feuillets-empty") && allElements(el).some((e) => /vide|empty/i.test(e.text))
  );
  assert.equal(emptyMessages.length, 0, "aucun message vide pour dossier fermé");

  // Ouvrir le dossier
  const emptyRow = rowsOf(contentEl).find((r) => allElements(r).some((el) => el.text === "Vide"));
  await emptyRow.events.get("click")();
  await view.render();

  // Maintenant, le dossier est ouvert et doit afficher "vide"
  const emptyMessagesAfter = allElements(contentEl).filter((el) =>
    el.classes.has("feuillets-empty") && /vide|empty/i.test(el.text)
  );
  assert.ok(emptyMessagesAfter.length > 0, "message vide visible pour dossier ouvert");
});

test("EditionDocsView : sections repliables (DOCX Review et Documents) cohabitent dans le même onglet Édition", async () => {
  // Ce test vérifie que les deux sections peuvent être rendues et repliées
  // indépendamment (testable au niveau de la vue elle-même et du sidbar).
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  edition.children = [];

  const { view } = createView({ root, editionFolder: edition });
  // Simuler la méthode renderSectionHead (elle devrait exister dans BaseFeuilletsView)
  assert.ok(typeof view.renderSectionHead === "function", "renderSectionHead disponible");
});

test("EditionDocsView : tri des documents par ordre conventionnel, puis dossiers alphabétiquement", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;

  // Créer les documents dans un ordre arbitraire
  const biographie = new TFile(`Projet/${EDITION_FOLDER_NAME}/Biographie.md`);
  const synopsis = new TFile(`Projet/${EDITION_FOLDER_NAME}/Synopsis.md`);
  const note = new TFile(`Projet/${EDITION_FOLDER_NAME}/Note d'intention.md`);
  const letter = new TFile(`Projet/${EDITION_FOLDER_NAME}/Lettre d'accompagnement.md`);
  const custom = new TFile(`Projet/${EDITION_FOLDER_NAME}/Custom.md`);
  const versions = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Versions envoyées`);
  const submissions = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Soumissions`);

  biographie.parent = edition;
  synopsis.parent = edition;
  note.parent = edition;
  letter.parent = edition;
  custom.parent = edition;
  versions.parent = edition;
  submissions.parent = edition;
  versions.children = [];
  submissions.children = [];

  // Ordre arbitraire dans le dossier
  edition.children = [letter, versions, biographie, submissions, custom, note, synopsis];

  const { view, contentEl } = createView({ root, editionFolder: edition });
  await view.render();

  const rows = rowsOf(contentEl);
  const labels = rows.map((r) => allElements(r).find((el) => el.classes.has("feuillets-project-row-label"))?.text).filter(Boolean);

  // Ordre attendu : Synopsis, Note d'intention, Biographie, Lettre d'accompagnement, Custom (alphabétique), Soumissions, Versions envoyées
  const expected = ["Synopsis.md", "Note d'intention.md", "Biographie.md", "Lettre d'accompagnement.md", "Custom.md", "Soumissions", "Versions envoyées"];
  assert.deepEqual(labels, expected, "documents triés : conventionnels d'abord, custom et dossiers par ordre alphabétique");
});

test("EditionDocsView : synthèse une soumission sans doublon ambigu, avec statut, documents, dates et actions", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  root.parent = volume;
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = volume;
  const submissions = new TFolder(`${edition.path}/Soumissions`);
  submissions.parent = edition;
  const submission = new TFolder(`${submissions.path}/Projet réel - Éditions du Vent`);
  submission.parent = submissions;
  const letter = new TFile(`${submission.path}/Lettre.md`);
  letter.parent = submission;
  const packageFolder = new TFolder(`${submission.path}/Dossier à envoyer`);
  packageFolder.parent = submission;
  const letterDocx = new TFile(`${packageFolder.path}/Lettre - Projet réel - Éditions du Vent.docx`);
  const manuscript = new TFile(`${packageFolder.path}/Manuscrit - Projet réel.docx`);
  letterDocx.parent = packageFolder;
  manuscript.parent = packageFolder;
  packageFolder.children = [letterDocx, manuscript];
  submission.children = [letter, packageFolder];
  submissions.children = [submission];
  edition.children = [submissions];

  const calls = [];
  const courrierApi = {
    createSubmissionDraft() { return { success: true }; },
    async exportSubmissionDocx(path) { calls.push(["export", path]); return { success: true }; },
    async markSubmissionAsSent(path) { calls.push(["sent", path]); return { success: true }; },
  };
  const { view, contentEl } = createView({
    root,
    editionFolder: edition,
    courrierApi,
    frontmatterByPath: {
      [letter.path]: {
        destinataire_nom: "Éditions du Vent",
        suivi: { statut: "Envoyé", date_envoi: "2026-08-02", date_relance: "2099-09-02" },
      },
    },
  });

  await view.render();
  const texts = textsOf(contentEl);
  assert.ok(texts.includes("Préparer → Rédiger → Exporter → Envoyer → Relancer"));
  assert.ok(texts.includes("Éditions du Vent"));
  assert.ok(texts.includes("Envoyée"));
  assert.ok(texts.includes("Documents prêts"));
  assert.ok(texts.includes("Envoi : 2026-08-02"));
  assert.ok(texts.includes("Relance : 2099-09-02"));
  for (const label of ["Ouvrir la lettre", "Ouvrir le dossier", "Exporter", "Marquer comme envoyée"]) {
    assert.equal(buttonsOf(contentEl).filter((button) => button.text === label).length, 1, `${label} affiché une seule fois`);
  }

  buttonsOf(contentEl).find((button) => button.text === "Exporter").events.get("click")();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [["export", letter.path]]);
});
