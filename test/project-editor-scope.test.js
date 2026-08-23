import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile, TFolder } from "obsidian";
import FeuilletsPlugin, { isFileInsideProject, syncMarkdownViewProjectEditorClass } from "../src/main.js";

function createContentEl() {
  const classes = new Set();
  return {
    classes,
    addClass(name) { classes.add(name); },
    removeClass(name) { classes.delete(name); },
  };
}

function createMarkdownView(path) {
  const view = Object.create(MarkdownView.prototype);
  view.file = new TFile(path);
  view.contentEl = createContentEl();
  return view;
}

function createPlugin(rootPath = "projet") {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.getProjectFolder = () => rootPath ? new TFolder(rootPath) : null;
  return plugin;
}

test("isFileInsideProject respecte les limites réelles du dossier", () => {
  const root = new TFolder("projet");

  assert.equal(isFileInsideProject(new TFile("projet/chapitre/fichier.md"), root), true);
  assert.equal(isFileInsideProject(new TFile("projet/fichier.md"), root), true);
  assert.equal(isFileInsideProject(new TFile("autre/fichier.md"), root), false);
  assert.equal(isFileInsideProject(new TFile("projet-autre/fichier.md"), root), false);
});

test("la classe feuillets-project-editor suit le fichier de chaque MarkdownView", () => {
  const plugin = createPlugin();
  const view = createMarkdownView("projet/chapitre/fichier.md");

  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "compact");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);

  view.file = new TFile("autre/fichier.md");
  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), false);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);

  view.file = new TFile("projet/fichier.md");
  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);
});

test("la bascule Callouts ↔ Compact resynchronise la même MarkdownView", () => {
  const view = createMarkdownView("projet/cours.md");
  const root = new TFolder("projet");

  syncMarkdownViewProjectEditorClass(view, root, "compact");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);

  syncMarkdownViewProjectEditorClass(view, root, "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);

  syncMarkdownViewProjectEditorClass(view, root, "compact");
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);
});

test("Compact s'applique de la même façon dans les trois modes de projet", () => {
  const root = new TFolder("projet");
  for (const type of ["fiction", "nonfiction", "free"]) {
    const view = createMarkdownView(`projet/${type}.md`);
    syncMarkdownViewProjectEditorClass(view, root, "compact");
    assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
    assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);
  }
});

test("un fichier hors projet ne reçoit aucune classe Feuillets", () => {
  const view = createMarkdownView("hors-projet/note.md");
  const root = new TFolder("projet");

  syncMarkdownViewProjectEditorClass(view, root, "compact");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), false);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);
});

test("le CSS cible les directives et rôles uniquement sous la portée locale, transversale aux modes", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile("styles.css", "utf8");
  const start = styles.indexOf("/* Directives de composition");
  const end = styles.indexOf("/* ===================== LOT 5C", start);
  const compactCallouts = styles.slice(start, end);
  const compactRolesStart = styles.indexOf("/* Mode compact :");
  const compactRolesEnd = styles.indexOf("/* La variable de callout colore", compactRolesStart);
  const compactRoles = styles.slice(compactRolesStart, compactRolesEnd);
  const calloutRolesStart = styles.indexOf("/* Mode Callouts :");
  const calloutRolesEnd = styles.indexOf("/* Mode compact :", calloutRolesStart);
  const calloutRoles = styles.slice(calloutRolesStart, calloutRolesEnd);

  assert.match(compactCallouts, /\.feuillets-project-editor \.markdown-source-view\.mod-cm6\.is-live-preview \.callout:is\(\[data-callout="saut-page"\], \[data-callout="pagebreak"\]\)/);
  assert.match(styles, /\.feuillets-project-editor \.markdown-source-view\.mod-cm6\.is-live-preview \.callout:is\([\s\S]*data-callout="questions"/);

  // Les 18 rôles canoniques (src/utils/semantic-roles.ts) doivent tous être
  // ciblés en mode Callout et en mode Compact — aucun oublié.
  const canonicalRoles = [
    "introduction", "question-directrice", "objectifs", "competences", "instructions",
    "questions", "solution", "argument", "hypothese", "preuve",
    "source", "citation", "explication", "definition", "methode",
    "synthese", "point-cle", "recommandation",
  ];
  for (const role of canonicalRoles) {
    assert.match(styles, new RegExp(`\\.feuillets-project-editor \\.markdown-source-view\\.mod-cm6\\.is-live-preview \\.callout:is\\([\\s\\S]*?data-callout="${role}"`), `couleur/icône manquante pour le rôle "${role}"`);
    assert.match(calloutRoles, new RegExp(`data-callout="${role}"`), `mode Callout manquant pour le rôle "${role}"`);
    assert.match(compactRoles, new RegExp(`data-callout="${role}"`), `mode Compact manquant pour le rôle "${role}"`);
  }

  // Régressions visibles signalées : ces rôles ont concrètement cessé de
  // changer de rendu entre Callout et Compact — on les verrouille explicitement.
  for (const role of ["solution", "synthese", "source", "point-cle"]) {
    assert.match(calloutRoles, new RegExp(`data-callout="${role}"`), `Callout: rôle "${role}" absent`);
    assert.match(compactRoles, new RegExp(`data-callout="${role}"`), `Compact: rôle "${role}" absent`);
  }

  assert.match(styles, /\.callout-title[\s\S]*\.callout-icon[\s\S]*color:\s*rgb\(var\(--callout-color\)\)/);
  assert.match(calloutRoles, /\.feuillets-project-editor:not\(\.feuillets-role-display-compact\)[\s\S]*background:\s*rgba\(var\(--callout-color\), 0\.1\)/);
  assert.match(calloutRoles, /border-left:\s*3px solid rgb\(var\(--callout-color\)\)/);
  assert.match(compactRoles, /\.feuillets-project-editor\.feuillets-role-display-compact[\s\S]*background:\s*transparent/);
  assert.match(compactRoles, /\.feuillets-project-editor\.feuillets-role-display-compact[\s\S]*border:\s*0/);
  assert.match(compactRoles, /\.feuillets-project-editor\.feuillets-role-display-compact[\s\S]*box-shadow:\s*none/);

  // La classe de mode et la coloration H1/H2/H3 qu'elle imposait ont disparu.
  assert.doesNotMatch(styles, /feuillets-project-mode-structured/);
  assert.doesNotMatch(styles, /\.feuillets-project-editor[\s\S]{0,400}HyperMD-header-1[\s\S]{0,200}color:\s*var\(--color-red\)/);

  assert.doesNotMatch(styles, /(?:^|\n)\s*\.callout\[data-callout="questions"\]/);
  assert.doesNotMatch(compactCallouts, /!important/);

  // L'ancienne grammaire de rôles (alias, rôles disparus) ne doit plus
  // recevoir aucun traitement Feuillets nulle part dans le fichier.
  const obsoleteRoles = [
    "problematique", "problematic", "correction", "trace", "lesson",
    "methodologie", "methodology", "objectives", "competencies",
    "exemple", "example", "tache", "task", "retenir", "keypoint",
    "lexique", "glossary", "consignes", "explanation",
  ];
  for (const role of obsoleteRoles) {
    assert.doesNotMatch(styles, new RegExp(`data-callout="${role}"`), `sélecteur obsolète encore présent pour "${role}"`);
  }

  // Les callouts natifs/Obsidian ordinaires ne doivent recevoir aucune
  // classe ou règle Feuillets : ni couleur de famille, ni icône, ni chrome.
  for (const nativeCallout of ["question", "example", "quote", "note", "document", "doc"]) {
    assert.doesNotMatch(styles, new RegExp(`\\.feuillets-project-editor[\\s\\S]{0,200}data-callout="${nativeCallout}"`), `callout natif "${nativeCallout}" reçoit un traitement Feuillets`);
  }
});
