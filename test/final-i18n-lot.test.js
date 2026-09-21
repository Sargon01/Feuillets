import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";
import { t, getLocale, setLocale, detectLocale, translate, FALLBACK_LOCALE } from "../src/i18n/index.js";
import { normalizeFilterSentinel, statusStoredValue, labelStoredValue } from "../src/services/project-taxonomy.js";
import {
  RESEARCH_FOLDERS,
  researchFolderNames,
  matchesResearchLabel,
  researchFolderNewName,
} from "../src/utils/project-modes.js";
import { detectProjectStructureLocale } from "../src/services/folder-structure.js";
import { projectCreationNames } from "../src/i18n/project-creation.js";
import { uniqueBinaryPath, resolveOutputBaseName } from "../src/services/compile-export.js";
import { resolveRevisedDocxOutputPath } from "../src/views/docx-review-view.js";
import { duplicateExportTemplate } from "../src/services/export-templates-custom.js";
import { duplicateProjectFolder } from "../src/services/project-files.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { TFolder, languageStub } from "obsidian";

/* ==================== 1. Exact Key Parity and Non-Empty Values ==================== */

test("final i18n lot: fr.ts and en.ts have exact key parity", () => {
  const frKeys = Object.keys(fr).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, frKeys, "fr.ts and en.ts must have the exact same set of keys");
});

test("final i18n lot: all dictionary values are non-empty strings", () => {
  for (const [key, val] of Object.entries(fr)) {
    assert.equal(typeof val, "string", `fr[${key}] must be a string`);
    assert.notEqual(val.trim(), "", `fr[${key}] must not be empty`);
  }
  for (const [key, val] of Object.entries(en)) {
    assert.equal(typeof val, "string", `en[${key}] must be a string`);
    assert.notEqual(val.trim(), "", `en[${key}] must not be empty`);
  }
});

/* ==================== 2. French Display under 'fr' ==================== */

test("final i18n lot: French display under 'fr' locale", () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    assert.equal(getLocale(), "fr");

    assert.equal(t("shared.research.citeSource"), "Citer cette source…");
    assert.equal(t("shared.contextMenu.versions"), "Versions…");
    assert.equal(t("modal.layout.alignLeft"), "Gauche");
    assert.equal(t("modal.layout.alignCenter"), "Centre");
    assert.equal(t("modal.layout.alignRight"), "Droite");
    assert.equal(t("notes.section.workNotesInvalid"), "work-notes.json invalide");
    assert.equal(t("editionLayout.ulyssesInvalidSyntax"), "Syntaxe ULSS invalide ou aucune propriété exploitable.");
    assert.equal(t("editionLayout.ulyssesEmptyFile"), "Le fichier est vide.");
    assert.equal(
      t("editionLayout.wordMissingParts"),
      "Le fichier Word ne contient pas les parties obligatoires word/styles.xml et word/document.xml."
    );
    assert.equal(t("nativeReview.delete.errorMustBeArchived"), "La copie doit être archivée avant suppression");
    assert.equal(t("nativeReview.delete.errorMustBeCompleted"), "Seule une relecture terminée peut être supprimée");
    assert.equal(t("nativeReview.sessionFolderNotFound"), "Dossier de session introuvable");
    assert.equal(t("analysis.dashboard.noActiveProject"), "Aucun projet actif.");
    assert.equal(t("modal.layout.noLayoutJsonPath"), "Aucun chemin layout.json disponible.");
    assert.equal(t("taxonomy.status.idea"), "Idée");
    assert.equal(t("scenesEditor.defaultSceneTitle"), "Nouvelle scène");
    assert.equal(t("docxReview.revisedSuffix"), "-révisé");
    assert.equal(t("genealogy.error.invalidPerson"), "déclaration de personne invalide");
    assert.equal(t("genealogy.error.invalidRelations"), "parents ou enfants invalides");
    assert.equal(t("genealogy.error.cycleDetected"), "cycle généalogique détecté");
    assert.equal(t("genealogy.lineError", { line: "4", message: "erreur" }), "Ligne 4 : erreur");
    assert.equal(t("shared.createEntry", { title: "personnage" }), "Créer une fiche personnage");
    assert.equal(
      t("demoProject.alreadyExists", { name: "Test" }),
      "« Test » existe déjà — supprime-le manuellement pour le régénérer."
    );
    assert.equal(
      t("drafts.notice.occupiedByFile", { path: "Drafts" }),
      "Le chemin des brouillons est occupé par un fichier : Drafts"
    );
    assert.equal(
      t("drafts.notice.notAFolder", { path: "Drafts" }),
      "Le chemin des brouillons n'est pas un dossier : Drafts"
    );
    assert.equal(
      t("export.render.missingImages", { count: "2", list: "a.png, b.png", more: "" }),
      "Export : 2 image(s) introuvable(s) dans le coffre : a.png, b.png"
    );
    assert.equal(
      t("export.pdf.mobileUnavailable"),
      "L'export PDF n'est disponible que sur desktop pour l'instant — utilise EPUB ou Word (.docx) sur mobile."
    );
    assert.equal(t("export.pdf.windowPrepFailed"), "Impossible de préparer la fenêtre d'impression PDF.");
    assert.equal(t("export.pdf.htmlSkeletonIncomplete"), "Squelette HTML d'impression incomplet.");
    assert.equal(t("export.pdf.printBoxHint"), "Choisis « Enregistrer au format PDF » dans la boîte d'impression.");
    assert.equal(researchFolderNewName("personnages", "fr"), "Nouveau personnage");
    assert.equal(researchFolderNewName("lieux", "fr"), "Nouveau lieu");
    assert.equal(researchFolderNewName("evenements", "fr"), "Nouvel événement");
  } finally {
    setLocale(initial);
  }
});

/* ==================== 3. English Display under 'en' ==================== */

test("final i18n lot: English display under 'en' locale", () => {
  const initial = getLocale();
  try {
    setLocale("en");
    assert.equal(getLocale(), "en");

    assert.equal(t("shared.research.citeSource"), "Cite this source…");
    assert.equal(t("shared.contextMenu.versions"), "Versions…");
    assert.equal(t("modal.layout.alignLeft"), "Left");
    assert.equal(t("modal.layout.alignCenter"), "Centre");
    assert.equal(t("modal.layout.alignRight"), "Right");
    assert.equal(t("notes.section.workNotesInvalid"), "Invalid work-notes.json");
    assert.equal(t("editionLayout.ulyssesInvalidSyntax"), "Invalid ULSS syntax or no usable property.");
    assert.equal(t("editionLayout.ulyssesEmptyFile"), "The file is empty.");
    assert.equal(
      t("editionLayout.wordMissingParts"),
      "The Word file is missing the required word/styles.xml and word/document.xml parts."
    );
    assert.equal(t("nativeReview.delete.errorMustBeArchived"), "The copy must be archived before deletion");
    assert.equal(t("nativeReview.delete.errorMustBeCompleted"), "Only a completed review can be deleted");
    assert.equal(t("nativeReview.sessionFolderNotFound"), "Session folder not found");
    assert.equal(t("analysis.dashboard.noActiveProject"), "No active project.");
    assert.equal(t("modal.layout.noLayoutJsonPath"), "No layout.json path available.");
    assert.equal(t("taxonomy.status.idea"), "Idea");
    assert.equal(t("scenesEditor.defaultSceneTitle"), "New scene");
    assert.equal(t("docxReview.revisedSuffix"), "-revised");
    assert.equal(t("genealogy.error.invalidPerson"), "invalid person declaration");
    assert.equal(t("genealogy.error.invalidRelations"), "invalid parents or children");
    assert.equal(t("genealogy.error.cycleDetected"), "genealogy cycle detected");
    assert.equal(t("genealogy.lineError", { line: "4", message: "error" }), "Line 4: error");
    assert.equal(t("shared.createEntry", { title: "character" }), "Create a character sheet");
    assert.equal(
      t("demoProject.alreadyExists", { name: "Test" }),
      "“Test” already exists — delete it manually to regenerate it."
    );
    assert.equal(
      t("drafts.notice.occupiedByFile", { path: "Drafts" }),
      "Drafts path is occupied by a file: Drafts"
    );
    assert.equal(
      t("drafts.notice.notAFolder", { path: "Drafts" }),
      "Drafts path is not a folder: Drafts"
    );
    assert.equal(
      t("export.render.missingImages", { count: "2", list: "a.png, b.png", more: "" }),
      "Export: 2 image(s) not found in vault: a.png, b.png"
    );
    assert.equal(
      t("export.pdf.mobileUnavailable"),
      "PDF export is only available on desktop for now — use EPUB or Word (.docx) on mobile."
    );
    assert.equal(t("export.pdf.windowPrepFailed"), "Unable to prepare PDF print window.");
    assert.equal(t("export.pdf.htmlSkeletonIncomplete"), "Incomplete HTML print skeleton.");
    assert.equal(t("export.pdf.printBoxHint"), "Choose “Save as PDF” in the print dialog.");
    assert.equal(researchFolderNewName("personnages", "en"), "New character");
    assert.equal(researchFolderNewName("lieux", "en"), "New place");
    assert.equal(researchFolderNewName("evenements", "en"), "New event");
  } finally {
    setLocale(initial);
  }
});

/* ==================== 4. Zero Vault Writes on Locale Switch ==================== */

test("final i18n lot: zero vault writes / zero settings changes on locale switch", async () => {
  const initial = getLocale();
  let vaultWrites = 0;
  const { vault } = createFakeVault();
  const origCreate = vault.create.bind(vault);
  vault.create = async (...args) => {
    vaultWrites++;
    return origCreate(...args);
  };

  const dummySettings = { language: "auto", projects: ["/manuscript"] };
  const settingsSnapshot = JSON.stringify(dummySettings);

  try {
    setLocale("en");
    detectLocale(dummySettings);
    setLocale("fr");
    detectLocale(dummySettings);
    setLocale("en");

    assert.equal(vaultWrites, 0, "Locale switching must perform zero vault writes");
    assert.equal(JSON.stringify(dummySettings), settingsSnapshot, "Locale switching must not mutate settings");
  } finally {
    setLocale(initial);
  }
});

/* ==================== 5. Non-Reliance on Translated Display Values ==================== */

test("final i18n lot: non-reliance on translated display values as logical identifiers", () => {
  // Filter sentinels
  assert.equal(normalizeFilterSentinel("all"), "all");
  assert.equal(normalizeFilterSentinel("none"), "none");
  assert.equal(normalizeFilterSentinel("Tous"), "all");
  assert.equal(normalizeFilterSentinel("Sans statut"), "none");
  assert.equal(normalizeFilterSentinel("Sans label"), "none");
  assert.equal(normalizeFilterSentinel("All"), "all");
  assert.equal(normalizeFilterSentinel("No status"), "none");
  assert.equal(normalizeFilterSentinel("No label"), "none");

  // Taxonomy keys are stable logical identifiers
  assert.equal(statusStoredValue({ name: "En cours", color: "#d9c04a" }), "En cours");
  assert.equal(statusStoredValue({ id: "in_progress", color: "#d9c04a" }), "in_progress");
  assert.equal(labelStoredValue({ id: "red", color: "#f00" }), "red");
});

/* ==================== 6. English Fallback ==================== */

test("final i18n lot: English fallback for unsupported locales and missing keys", () => {
  const initial = getLocale();
  const oldStub = languageStub.value;
  try {
    setLocale("es");
    assert.equal(getLocale(), FALLBACK_LOCALE, "Unsupported locale code falls back to English");

    languageStub.value = "de";
    assert.equal(
      detectLocale({ language: "unsupported_code" }),
      FALLBACK_LOCALE,
      "detectLocale falls back to English for unknown language code"
    );

    // Missing key in a dictionary falls back to English, then to the key itself
    assert.equal(translate("fr", "this.key.does.not.exist.anywhere"), "this.key.does.not.exist.anywhere");
  } finally {
    languageStub.value = oldStub;
    setLocale(initial);
  }
});

/* ==================== 7. Legacy Structure Recognition Without Renames ==================== */

test("final i18n lot: legacy structure recognition without renames", () => {
  // Characters folder
  const charNames = researchFolderNames(RESEARCH_FOLDERS, "personnages");
  assert.ok(charNames.includes("Personnages"), "Must recognize French Personnages");
  assert.ok(charNames.includes("Characters"), "Must recognize English Characters");
  assert.ok(matchesResearchLabel(RESEARCH_FOLDERS, "personnages", "Characters"));
  assert.ok(matchesResearchLabel(RESEARCH_FOLDERS, "personnages", "Personnages"));

  // Lore / Codex folder
  const codexNames = researchFolderNames(RESEARCH_FOLDERS, "codex");
  assert.ok(codexNames.includes("Lore"), "Must recognize Lore");
  assert.ok(codexNames.includes("Codex"), "Must recognize Codex");
  assert.ok(matchesResearchLabel(RESEARCH_FOLDERS, "codex", "Lore"));
  assert.ok(matchesResearchLabel(RESEARCH_FOLDERS, "codex", "Codex"));

  // Structure detection works without modifying files
  const { vault: structureVault } = createFakeVault([]);
  const app = { vault: structureVault };
  const fakeRoot = new TFolder("Volume 1");
  const manuscriptFolder = new TFolder("Volume 1/Manuscript");
  const researchFolder = new TFolder("Volume 1/Research");
  fakeRoot.children = [manuscriptFolder, researchFolder];

  const detected = detectProjectStructureLocale(app, fakeRoot, "fr");
  assert.equal(detected, "en", "Must detect English project structure");
});

/* ==================== 8. Targeted Production-Source Audit ==================== */

test("final i18n lot: targeted production-source audit prevents hardcoded UI strings from returning", () => {
  const filesToAudit = [
    "src/main.ts",
    "src/services/demo-project.ts",
    "src/services/export-pdf.ts",
    "src/services/presentation-pdf-export.ts",
    "src/services/export-render.ts",
    "src/services/project-drafts.ts",
    "src/services/work-notes.ts",
    "src/services/layout-store.ts",
    "src/services/annotations.ts",
    "src/services/citation-registry.ts",
    "src/services/canvas-bridge.ts",
    "src/ui/layout-editor.ts",
    "src/views/base-feuillets-view.ts",
    "src/views/notes-view.ts",
    "src/views/native-review-view.ts",
    "src/views/docx-review-view.ts",
    "src/views/board-view.ts",
    "src/views/feuillets-view.ts",
    "src/views/properties-view.ts",
  ];

  const forbiddenSnippets = [
    // Notices replaced in this lot
    "« existe déjà — supprime-le manuellement pour le régénérer",
    "Échec de la génération du projet d'exemple :",
    "Projet d'exemple créé :",
    "L'export PDF n'est disponible que sur desktop",
    "Choisis « Enregistrer au format PDF »",
    "image(s) introuvable(s) dans le coffre :",
    "work-notes.json invalide",
    "Créer une fiche ${title.toLowerCase()}",
    "-révisé.docx",
    // Titles & tooltips
    ".setTitle(\"Citer cette source…\")",
    ".setTitle(\"Versions…\")",
  ];

  for (const relPath of filesToAudit) {
    const fullPath = join(process.cwd(), relPath);
    const content = readFileSync(fullPath, "utf8");

    for (const forbidden of forbiddenSnippets) {
      assert.ok(
        !content.includes(forbidden),
        `File ${relPath} contains forbidden hardcoded string: "${forbidden}"`
      );
    }
  }
});

/* ==================== 9. Locale-Stable Project Paths & DOCX Review Suffix ==================== */

test("final i18n lot: French project + English UI creates no new English-derived filename", () => {
  const initial = getLocale();
  try {
    setLocale("en");
    assert.equal(getLocale(), "en");

    const { vault } = createFakeVault([]);
    const app = { vault };
    const frenchRoot = new TFolder("Roman");
    const frenchManuscript = new TFolder("Roman/Manuscrit");
    frenchManuscript.parent = frenchRoot;
    frenchRoot.children = [frenchManuscript];
    const frenchOutput = new TFolder("Roman/_Sortie");

    // Structural locale must detect "fr" despite English UI
    const projectLocale = detectProjectStructureLocale(app, frenchRoot, getLocale());
    assert.equal(projectLocale, "fr");

    const defaultManuscriptName = projectCreationNames(projectLocale).manuscript;
    assert.equal(defaultManuscriptName, "Manuscrit");

    // Fallback passed to uniqueBinaryPath produces French-derived name under English UI
    const generatedPath = uniqueBinaryPath(app, frenchOutput.path, "", "epub", defaultManuscriptName);
    assert.equal(generatedPath, "Roman/_Sortie/Manuscrit.epub");
    assert.ok(!generatedPath.includes("Manuscript"), "Must not create English-derived Manuscript.epub");

    // resolveOutputBaseName without override uses defaultManuscriptName
    assert.equal(resolveOutputBaseName(undefined, "", defaultManuscriptName), "Manuscrit");

    // DOCX revised output path retains French suffix under English UI
    const revisedPath = resolveRevisedDocxOutputPath(
      app,
      frenchRoot,
      frenchOutput,
      "chapitre-1.docx",
      getLocale()
    );
    assert.equal(revisedPath, "Roman/_Sortie/chapitre-1-révisé.docx");
    assert.ok(!revisedPath.includes("-revised"), "Must not create English-derived -revised suffix");
  } finally {
    setLocale(initial);
  }
});

test("final i18n lot: English project + French UI creates no new French-derived filename", () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    assert.equal(getLocale(), "fr");

    const { vault } = createFakeVault([]);
    const app = { vault };
    const englishRoot = new TFolder("Novel");
    const englishManuscript = new TFolder("Novel/Manuscript");
    englishManuscript.parent = englishRoot;
    englishRoot.children = [englishManuscript];
    const englishOutput = new TFolder("Novel/_Output");

    // Structural locale must detect "en" despite French UI
    const projectLocale = detectProjectStructureLocale(app, englishRoot, getLocale());
    assert.equal(projectLocale, "en");

    const defaultManuscriptName = projectCreationNames(projectLocale).manuscript;
    assert.equal(defaultManuscriptName, "Manuscript");

    // Fallback passed to uniqueBinaryPath produces English-derived name under French UI
    const generatedPath = uniqueBinaryPath(app, englishOutput.path, "", "epub", defaultManuscriptName);
    assert.equal(generatedPath, "Novel/_Output/Manuscript.epub");
    assert.ok(!generatedPath.includes("Manuscrit"), "Must not create French-derived Manuscrit.epub");

    // resolveOutputBaseName without override uses defaultManuscriptName
    assert.equal(resolveOutputBaseName(undefined, "", defaultManuscriptName), "Manuscript");

    // DOCX revised output path retains English suffix under French UI
    const revisedPath = resolveRevisedDocxOutputPath(
      app,
      englishRoot,
      englishOutput,
      "chapter-1.docx",
      getLocale()
    );
    assert.equal(revisedPath, "Novel/_Output/chapter-1-revised.docx");
    assert.ok(!revisedPath.includes("-révisé"), "Must not create French-derived -révisé suffix");
  } finally {
    setLocale(initial);
  }
});

test("final i18n lot: standalone / no-project fallback follows active UI locale", () => {
  const initial = getLocale();
  try {
    const { vault } = createFakeVault([]);
    const app = { vault };

    // French UI without project root
    setLocale("fr");
    assert.equal(getLocale(), "fr");
    const frBinary = uniqueBinaryPath(app, "Exports", "", "docx");
    assert.equal(frBinary, "Exports/Manuscrit.docx");
    const frRevised = resolveRevisedDocxOutputPath(app, null, null, "standalone.docx", getLocale());
    assert.equal(frRevised, "standalone-révisé.docx");

    // English UI without project root
    setLocale("en");
    assert.equal(getLocale(), "en");
    const enBinary = uniqueBinaryPath(app, "Exports", "", "docx");
    assert.equal(enBinary, "Exports/Manuscript.docx");
    const enRevised = resolveRevisedDocxOutputPath(app, null, null, "standalone.docx", getLocale());
    assert.equal(enRevised, "standalone-revised.docx");
  } finally {
    setLocale(initial);
  }
});

test("final i18n lot: no rename or write occurs solely when switching locale", () => {
  const initial = getLocale();
  let vaultWrites = 0;
  let renames = 0;
  const { vault, fileManager } = createFakeVault([]);
  const origCreate = vault.create.bind(vault);
  const origRename = fileManager.renameFile.bind(fileManager);
  vault.create = async (...args) => {
    vaultWrites++;
    return origCreate(...args);
  };
  fileManager.renameFile = async (...args) => {
    renames++;
    return origRename(...args);
  };
  const app = { vault, fileManager };

  const frenchRoot = new TFolder("Roman");
  const frenchManuscript = new TFolder("Roman/Manuscrit");
  frenchManuscript.parent = frenchRoot;
  frenchRoot.children = [frenchManuscript];

  const englishRoot = new TFolder("Novel");
  const englishManuscript = new TFolder("Novel/Manuscript");
  englishManuscript.parent = englishRoot;
  englishRoot.children = [englishManuscript];

  try {
    // Perform multiple locale switches
    setLocale("en");
    detectProjectStructureLocale(app, frenchRoot, getLocale());
    detectProjectStructureLocale(app, englishRoot, getLocale());

    setLocale("fr");
    detectProjectStructureLocale(app, frenchRoot, getLocale());
    detectProjectStructureLocale(app, englishRoot, getLocale());

    setLocale("en");
    resolveRevisedDocxOutputPath(app, frenchRoot, null, "test.docx", getLocale());
    resolveRevisedDocxOutputPath(app, englishRoot, null, "test.docx", getLocale());

    assert.equal(vaultWrites, 0, "Zero vault writes on locale switch");
    assert.equal(renames, 0, "Zero renames on locale switch");
  } finally {
    setLocale(initial);
  }
});

/* ==================== 10. Blocker Corrections ==================== */

test("final i18n blocker 1: no lot/phase comments remain in i18n dictionaries", () => {
  const frSource = readFileSync(join(process.cwd(), "src/i18n/fr.ts"), "utf-8");
  const enSource = readFileSync(join(process.cwd(), "src/i18n/en.ts"), "utf-8");
  assert.doesNotMatch(frSource, /Final lot additions/i);
  assert.doesNotMatch(enSource, /Final lot additions/i);
});

test("final i18n blocker 2: resolveOutputBaseName standalone fallback derives from active UI locale", () => {
  const initial = getLocale();
  try {
    // Standalone fallback derives from active UI locale
    setLocale("fr");
    assert.equal(resolveOutputBaseName(undefined, ""), "Manuscrit");
    assert.equal(resolveOutputBaseName("", "   "), "Manuscrit");

    setLocale("en");
    assert.equal(resolveOutputBaseName(undefined, ""), "Manuscript");
    assert.equal(resolveOutputBaseName("", "   "), "Manuscript");

    // Project-bound operations pass their structure-derived manuscript name explicitly
    // French project manuscript passed explicitly while UI is English -> keeps "Manuscrit"
    assert.equal(resolveOutputBaseName(undefined, "", "Manuscrit"), "Manuscrit");
    // English project manuscript passed explicitly while UI is French -> keeps "Manuscript"
    setLocale("fr");
    assert.equal(resolveOutputBaseName(undefined, "", "Manuscript"), "Manuscript");
  } finally {
    setLocale(initial);
  }
});

test("final i18n blocker 3: duplicateExportTemplate uses stable technical key while labels are translated", async () => {
  const initial = getLocale();
  try {
    // Under French UI
    setLocale("fr");
    const mFr = new TFolder("ProjetFR/Manuscrit");
    const pFr = new TFolder("ProjetFR");
    pFr.children = [mFr];
    mFr.parent = pFr;
    const { vault: vaultFr } = createFakeVault([pFr, mFr]);
    const appFr = { vault: vaultFr };
    const settingsFr = { projectFolder: mFr.path, exportTemplate: "classique" };

    const resultFr = await duplicateExportTemplate(appFr, settingsFr);
    assert.ok(resultFr);
    assert.equal(resultFr.key, "classique-copie", "Technical key must be classique-copie under French UI");
    assert.equal(resultFr.label, "Manuscrit éditeur — copie", "Label must be localized in French");
    assert.ok(vaultFr.getAbstractFileByPath("ProjetFR/_Feuillets/Ressources/Mises en page/classique-copie.md"));

    // Under English UI
    setLocale("en");
    const mEn = new TFolder("ProjetEN/Manuscript");
    const pEn = new TFolder("ProjetEN");
    pEn.children = [mEn];
    mEn.parent = pEn;
    const { vault: vaultEn } = createFakeVault([pEn, mEn]);
    const appEn = { vault: vaultEn };
    const settingsEn = { projectFolder: mEn.path, exportTemplate: "classique" };

    const resultEn = await duplicateExportTemplate(appEn, settingsEn);
    assert.ok(resultEn);
    assert.equal(resultEn.key, "classique-copie", "Technical key must remain stable 'classique-copie' under English UI");
    assert.equal(resultEn.label, "Manuscrit éditeur — copy", "Label must be localized in English");
    assert.ok(vaultEn.getAbstractFileByPath("ProjetEN/_Feuillets/Resources/Layouts/classique-copie.md"));
  } finally {
    setLocale(initial);
  }
});

test("final i18n blocker 4: duplicateProjectFolder resolves copy suffix via project structure locale", async () => {
  const initial = getLocale();
  try {
    // French project under English UI -> preserves French-derived duplicate folder name
    setLocale("en");
    const roman = new TFolder("MonRoman");
    const manuscrit = new TFolder("MonRoman/Manuscrit");
    roman.children = [manuscrit];
    manuscrit.parent = roman;
    const { vault: vaultFr } = createFakeVault([roman, manuscrit]);
    const appFr = { vault: vaultFr };
    const destFr = await duplicateProjectFolder(appFr, roman, "");
    assert.equal(destFr, "MonRoman/_Feuillets/Versions/MonRoman (copie)", "French project must retain French suffix (copie) under English UI");
    assert.ok(vaultFr.getAbstractFileByPath(destFr));

    // English project under French UI -> preserves English-derived duplicate folder name
    setLocale("fr");
    const novel = new TFolder("MyNovel");
    const manuscript = new TFolder("MyNovel/Manuscript");
    novel.children = [manuscript];
    manuscript.parent = novel;
    const { vault: vaultEn } = createFakeVault([novel, manuscript]);
    const appEn = { vault: vaultEn };
    const destEn = await duplicateProjectFolder(appEn, novel, "");
    assert.equal(destEn, "MyNovel/_Feuillets/Versions/MyNovel (copy)", "English project must retain English suffix (copy) under French UI");
    assert.ok(vaultEn.getAbstractFileByPath(destEn));
  } finally {
    setLocale(initial);
  }
});

test("final i18n blocker 5: board-view POV filter migration and normalization", () => {
  // 1. normalizeFilterSentinel handles canonical and legacy values
  assert.equal(normalizeFilterSentinel("all"), "all");
  assert.equal(normalizeFilterSentinel("none"), "none");
  assert.equal(normalizeFilterSentinel("Tous"), "all");
  assert.equal(normalizeFilterSentinel("All"), "all");
  assert.equal(normalizeFilterSentinel("Sans POV"), "none");
  assert.equal(normalizeFilterSentinel("Sans pov"), "none");
  assert.equal(normalizeFilterSentinel("No pov"), "none");
  assert.equal(normalizeFilterSentinel("Alice"), "Alice");

  // 2. Source code wiring in board-view.ts: never build menu entries from "Tous" or "Sans POV"
  const boardSource = readFileSync(join(process.cwd(), "src/views/board-view.ts"), "utf-8");
  assert.doesNotMatch(boardSource, /\[\s*["']Tous["']\s*,\s*\.\.\.sortedPovs/);
  assert.doesNotMatch(boardSource, /,\s*["']Sans POV["']\s*\]/);
  assert.match(boardSource, /for\s*\(\s*const pv of \[\s*"all",\s*\.\.\.sortedPovs,\s*"none"\s*\]\)/);
  assert.match(boardSource, /normalizeFilterSentinel\(S\.povFilter \|\| "all"\) === pv/);
  assert.match(boardSource, /S\.povFilter = pv/);
  assert.match(boardSource, /S\.povFilter = "all"/);
  assert.match(boardSource, /normalizeFilterSentinel\(S\.povFilter \|\| "all"\)/);
  assert.match(boardSource, /normalizeFilterSentinel\(S\.povFilter\)/);
  assert.doesNotMatch(boardSource, /S\.povFilter === ["']Tous["']/);
  assert.doesNotMatch(boardSource, /S\.povFilter === ["']Sans POV["']/);
  assert.doesNotMatch(boardSource, /S\.povFilter !== ["']Tous["']/);
  assert.doesNotMatch(boardSource, /S\.povFilter !== ["']Sans POV["']/);

  // 3. Filtering predicate logic:
  function evaluatePovFilter(storedFilter, filePov) {
    const povFilter = normalizeFilterSentinel(storedFilter || "all");
    if (povFilter && povFilter !== "all") {
      if (povFilter === "none" ? filePov !== "" : filePov !== povFilter) return false;
    }
    return true;
  }

  // "all", undefined, legacy "Tous", legacy "All" allow all
  for (const allVal of ["all", undefined, "Tous", "All"]) {
    assert.equal(evaluatePovFilter(allVal, "Alice"), true);
    assert.equal(evaluatePovFilter(allVal, ""), true);
  }

  // "none", legacy "Sans POV", legacy "Sans pov", legacy "No pov" allow only empty POV
  for (const noneVal of ["none", "Sans POV", "Sans pov", "No pov"]) {
    assert.equal(evaluatePovFilter(noneVal, ""), true);
    assert.equal(evaluatePovFilter(noneVal, "Alice"), false);
  }

  // Specific POV allows only exact match
  assert.equal(evaluatePovFilter("Alice", "Alice"), true);
  assert.equal(evaluatePovFilter("Alice", "Bob"), false);
  assert.equal(evaluatePovFilter("Alice", ""), false);
});
