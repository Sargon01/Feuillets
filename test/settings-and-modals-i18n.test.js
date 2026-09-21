import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";
import { t, getLocale, setLocale } from "../src/i18n/index.js";

test("dictionaries parity: fr.ts and en.ts have the exact same set of keys", () => {
  const frKeys = Object.keys(fr).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, frKeys);
});

test("dictionaries non-empty: all translations in fr.ts and en.ts are non-empty strings", () => {
  for (const [key, val] of Object.entries(fr)) {
    assert.equal(typeof val, "string", `fr[${key}] must be a string`);
    assert.notEqual(val.trim(), "", `fr[${key}] must not be empty`);
  }
  for (const [key, val] of Object.entries(en)) {
    assert.equal(typeof val, "string", `en[${key}] must be a string`);
    assert.notEqual(val.trim(), "", `en[${key}] must not be empty`);
  }
});

test("settings and modal keys exist in both dictionaries with expected values", () => {
  const requiredKeys = [
    "settings.tabBarUnavailable",
    "settings.section.binder",
    "settings.deadline.placeholder",
    "modal.canvasBridgeNode.titleLabel",
    "modal.tags.placeholder",
    "modal.export.outputNamePlaceholder",
    "modal.folderWorkspace.missingItemLabel",
    "modal.layoutDirective.title",
    "modal.layoutDirective.pagination",
    "modal.layoutDirective.pageBreakBefore",
    "modal.layoutDirective.answerArea",
    "modal.layoutDirective.type",
    "modal.layoutDirective.defaultTwoLines",
    "modal.layoutDirective.lines",
    "modal.layoutDirective.space",
    "modal.layoutDirective.value",
    "modal.layoutDirective.positiveInteger",
    "modal.layoutDirective.unit",
    "modal.layoutDirective.unitLh",
    "modal.layoutDirective.unitMm",
    "modal.layout.outputLayout",
    "modal.layout.singlePage",
    "modal.layout.categoryBlockquoteAndDivider",
    "modal.presentationTheme.generalColors",
    "modal.presentationTheme.calloutColors",
    "modal.presentationTheme.nameInUse",
    "modal.presentationTheme.invalidName",
    "presentation.theme.color.background",
    "presentation.theme.color.text",
    "presentation.theme.color.muted",
    "presentation.theme.color.h1",
    "presentation.theme.color.h2",
    "presentation.theme.color.h3",
    "presentation.theme.color.h4",
    "presentation.theme.color.strong",
    "modal.newProject.namePlaceholder",
    "modal.scrivenerImport.dropAreaHint",
    "modal.scrivenerImport.projectReady",
    "modal.scrivenerImport.noticeProjectReady",
    "modal.scrivenerImport.archiveReady",
    "modal.scrivenerImport.noticeArchiveReady",
    "modal.scrivenerImport.invalidDrop",
    "modal.scrivenerImport.chooseZip",
    "modal.scrivenerImport.noFileChosen",
    "modal.scrivenerImport.macosHint",
    "modal.compileSelection.includedCount",
    "editionDocs.submission.missingManuscriptDocx",
    "editionDocs.submission.missingLetterDocx",
    "editionDocs.fileKind.letterDocx",
    "editionDocs.fileKind.manuscriptDocx",
    "editionDocs.fileKind.letterMarkdown",
    "editionLayout.ulyssesNoUlss",
    "editionLayout.projectFolderNotFound",
    "project.pandocCitationPreview.missingFileOption",
  ];

  for (const key of requiredKeys) {
    assert.ok(fr[key], `Missing FR key: ${key}`);
    assert.ok(en[key], `Missing EN key: ${key}`);
    assert.notEqual(fr[key], "", `Empty FR value for ${key}`);
    assert.notEqual(en[key], "", `Empty EN value for ${key}`);
  }
});

test("parameterized templates interpolate variables in both French and English", () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    assert.equal(
      t("feuil.import.detected", { name: "Projet Monstre" }),
      "Projet détecté : Projet Monstre"
    );
    assert.equal(
      t("modal.folderWorkspace.missingItemLabel", { file: "sources.bib" }),
      "sources.bib (introuvable)"
    );
    assert.equal(
      t("project.pandocCitationPreview.missingFileOption", { name: "citations.bib" }),
      "citations.bib (Introuvable)"
    );
    assert.equal(
      t("modal.compileSelection.includedCount", { included: "4", total: "12" }),
      "4 sur 12 éléments inclus"
    );
    assert.equal(
      t("modal.scrivenerImport.projectReady", { name: "Test.scriv" }),
      "Projet prêt : Test.scriv"
    );
    assert.equal(
      t("modal.scrivenerImport.noticeProjectReady", { name: "Test.scriv" }),
      "Projet .scriv prêt à l'analyse : Test.scriv"
    );
    assert.equal(
      t("modal.scrivenerImport.archiveReady", { name: "Test.zip" }),
      "Archive prête : Test.zip"
    );
    assert.equal(
      t("modal.scrivenerImport.noticeArchiveReady", { name: "Test.zip" }),
      "Archive ZIP prête à l'analyse : Test.zip"
    );

    setLocale("en");
    assert.equal(
      t("feuil.import.detected", { name: "Projet Monstre" }),
      "Detected project: Projet Monstre"
    );
    assert.equal(
      t("modal.folderWorkspace.missingItemLabel", { file: "sources.bib" }),
      "sources.bib (missing)"
    );
    assert.equal(
      t("project.pandocCitationPreview.missingFileOption", { name: "citations.bib" }),
      "citations.bib (Missing)"
    );
    assert.equal(
      t("modal.compileSelection.includedCount", { included: "4", total: "12" }),
      "4 of 12 items included"
    );
    assert.equal(
      t("modal.scrivenerImport.projectReady", { name: "Test.scriv" }),
      "Project ready: Test.scriv"
    );
    assert.equal(
      t("modal.scrivenerImport.noticeProjectReady", { name: "Test.scriv" }),
      ".scriv project ready for analysis: Test.scriv"
    );
    assert.equal(
      t("modal.scrivenerImport.archiveReady", { name: "Test.zip" }),
      "Archive ready: Test.zip"
    );
    assert.equal(
      t("modal.scrivenerImport.noticeArchiveReady", { name: "Test.zip" }),
      "ZIP archive ready for analysis: Test.zip"
    );
  } finally {
    setLocale(initial);
  }
});

test("dynamic locale switching switches translations without mutation or persistence", () => {
  const initial = getLocale();
  try {
    setLocale("en");
    assert.equal(t("modal.layoutDirective.title"), "Layout");
    assert.equal(t("settings.deadline.placeholder"), "YYYY-MM-DD");
    assert.equal(t("modal.newProject.namePlaceholder"), "Novel 1");
    assert.equal(t("modal.presentationTheme.generalColors"), "General colors");
    assert.equal(t("modal.presentationTheme.calloutColors"), "Callout colors");
    assert.equal(t("modal.layout.singlePage"), "Single page");

    setLocale("fr");
    assert.equal(t("modal.layoutDirective.title"), "Disposition");
    assert.equal(t("settings.deadline.placeholder"), "AAAA-MM-JJ");
    assert.equal(t("modal.newProject.namePlaceholder"), "Roman 1");
    assert.equal(t("modal.presentationTheme.generalColors"), "Couleurs générales");
    assert.equal(t("modal.presentationTheme.calloutColors"), "Couleurs des callouts");
    assert.equal(t("modal.layout.singlePage"), "Une page");
  } finally {
    setLocale(initial);
  }
});

test("source audit: settings and modals have no hardcoded French string literals in UI sinks", () => {
  const checkSource = (relPath, forbiddenPatterns) => {
    const fullPath = join(process.cwd(), relPath);
    const content = readFileSync(fullPath, "utf8");
    for (const pat of forbiddenPatterns) {
      assert.doesNotMatch(
        content,
        pat,
        `File ${relPath} contains forbidden unlocalized pattern ${pat}`
      );
    }
  };

  checkSource("src/settings/feuillets-setting-tab.ts", [
    /text:\s*"Barre d’onglets indisponible"/,
    /text:\s*"Barre latérale"/,
    /\.addOption\("fr",\s*"Français"\)/,
    /\.addOption\("en",\s*"English"\)/,
  ]);

  checkSource("src/ui/canvas-bridge-modal.ts", [
    /createEl\("label",\s*\{\s*text:\s*"Titre"\s*\}\)/,
  ]);

  checkSource("src/ui/edition-docs-content.ts", [
    /"manuscrit DOCX"/,
    /"lettre DOCX"/,
    /"Lettre DOCX"/,
    /"Manuscrit DOCX"/,
    /"Lettre source Markdown"/,
  ]);

  checkSource("src/ui/entity-modals.ts", [
    /placeholder:\s*"Ajouter un tag…"/,
  ]);

  checkSource("src/ui/export-modal.ts", [
    /placeholder:\s*"Nom du fichier exporté"/,
    /new Notice\("Le nom du fichier ne peut pas être vide\."\)/,
  ]);

  checkSource("src/ui/feuil-project-import-modal.ts", [
    /\$\{t\("feuil\.import\.detected"\)\}\s*:/,
  ]);

  checkSource("src/ui/folder-workspace-modal.ts", [
    /\.setPlaceholder\("AAAA-MM-JJ"\)/,
    /\$\{localBibVal\}\s*\(\$\{t\("modal\.folderWorkspace\.missing"\)\}\)/,
    /\$\{localCslVal\}\s*\(\$\{t\("modal\.folderWorkspace\.missing"\)\}\)/,
  ]);

  checkSource("src/ui/layout-directive-modal.ts", [
    /createEl\("h3",\s*\{\s*text:\s*"Disposition"\s*\}\)/,
    /setName\("Pagination"\)/,
    /setTooltip\("Saut de page avant"\)/,
    /createEl\("button",\s*\{\s*text:\s*"Annuler"\s*\}\)/,
    /createEl\("button",\s*\{\s*text:\s*"Appliquer"/,
    /createEl\("h4",\s*\{\s*text:\s*"Zone de réponse"\s*\}\)/,
    /setName\("Type"\)/,
    /addOption\("default",\s*"Par défaut \(2 lignes\)"\)/,
    /addOption\("lines",\s*"Lignes"\)/,
    /addOption\("space",\s*"Espace"\)/,
    /setName\("Valeur"\)/,
    /setPlaceholder\("Entier positif"\)/,
    /setName\("Unité"\)/,
  ]);

  checkSource("src/ui/layout-editor.ts", [
    /setName\("Disposition PDF \/ aperçu"\)/,
    /addOption\("single",\s*"Une page"\)/,
  ]);

  checkSource("src/ui/layout-modal.ts", [
    /\["page",\s*"Page"\]/,
    /\["body",\s*"Corps de texte"\]/,
    /\["headings",\s*"Titres"\]/,
    /\["blockquote",\s*"Citation et séparateur"\]/,
    /\["firstPage",\s*"Première page"\]/,
  ]);

  checkSource("src/ui/presentation-theme-modal.ts", [
    /createEl\("h3",\s*\{\s*text:\s*"Couleurs générales"\s*\}\)/,
    /createEl\("h3",\s*\{\s*text:\s*"Couleurs des callouts"\s*\}\)/,
    /createEl\("button",\s*\{\s*text:\s*"Annuler"\s*\}\)/,
    /createEl\("button",\s*\{\s*text:\s*"Réinitialiser"\s*\}\)/,
    /createEl\("button",\s*\{\s*text:\s*"Appliquer"/,
    /"Nom déjà utilisé"/,
    /"Nom invalide"/,
  ]);

  checkSource("src/ui/project-config-content.ts", [
    /\.setPlaceholder\("AAAA-MM-JJ"\)/,
  ]);

  checkSource("src/ui/project-modals.ts", [
    /placeholder:\s*"Roman1"/,
    /\$\{currentBibValue\}\s*\(\$\{t\("project\.pandocCitationPreview\.missingFile"\)\}\)/,
    /\$\{currentCslValue\}\s*\(\$\{t\("project\.pandocCitationPreview\.missingFile"\)\}\)/,
  ]);

  checkSource("src/ui/scrivener-import-modal.ts", [
    /setText\("Glissez-déposez votre dossier \.scriv/,
    /setText\(`Projet prêt : \$\{entryName\}`\)/,
    /new Notice\(`Projet \.scriv prêt à l'analyse : \$\{entryName\}`\)/,
    /setText\(`Archive prête : \$\{file\.name\}`\)/,
    /new Notice\(`Archive ZIP prête à l'analyse : \$\{file\.name\}`\)/,
    /new Notice\("Veuillez glisser-déposer un dossier \.scriv/,
    /text:\s*"Choisir une archive ZIP…" */,
    /setText\("Aucun fichier choisi"\)/,
    /setText\(\s*"Sur macOS : vous pouvez glisser-déposer/,
    /placeholder:\s*"Mon roman"/,
  ]);

  checkSource("src/ui/selection-modals.ts", [
    /\$\{included\}\s*sur\s*\$\{files\.length\}\s*éléments inclus/,
  ]);

  checkSource("src/ui/ulysses-import-modal.ts", [
    /new Error\("L’archive \.ulstyle ne contient aucun fichier ULSS\."\)/,
    /new Error\("Dossier projet introuvable\."\)/,
  ]);

  checkSource("src/ui/word-template-import-modal.ts", [
    /new Error\("Dossier projet introuvable\."\)/,
  ]);
});
