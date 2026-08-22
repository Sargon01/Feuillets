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

  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "structured", "compact");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);

  view.file = new TFile("autre/fichier.md");
  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "fiction", "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), false);
  assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), false);

  view.file = new TFile("projet/fichier.md");
  syncMarkdownViewProjectEditorClass(view, plugin.getProjectFolder(), "fiction", "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), false);
});

test("la bascule Callouts ↔ Compact resynchronise la même MarkdownView", () => {
  const view = createMarkdownView("projet/cours.md");
  const root = new TFolder("projet");

  syncMarkdownViewProjectEditorClass(view, root, "structured", "compact");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);

  syncMarkdownViewProjectEditorClass(view, root, "structured", "callouts");
  assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
  assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), true);
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);

  syncMarkdownViewProjectEditorClass(view, root, "structured", "compact");
  assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), true);
});

test("Compact ne s'applique jamais aux autres modes", () => {
  const root = new TFolder("projet");
  for (const type of ["fiction", "nonfiction", "free"]) {
    const view = createMarkdownView(`projet/${type}.md`);
    syncMarkdownViewProjectEditorClass(view, root, type, "compact");
    assert.equal(view.contentEl.classes.has("feuillets-project-editor"), true);
    assert.equal(view.contentEl.classes.has("feuillets-project-mode-structured"), false);
    assert.equal(view.contentEl.classes.has("feuillets-role-display-compact"), false);
  }
});

test("le CSS cible les directives et rôles uniquement sous la portée locale", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile("styles.css", "utf8");
  const start = styles.indexOf("/* Directives de composition");
  const end = styles.indexOf("/* ===================== LOT 5C", start);
  const compactCallouts = styles.slice(start, end);
  const compactRolesStart = styles.indexOf("/* Mode compact :");
  const compactRolesEnd = styles.indexOf("/* Document structuré :", compactRolesStart);
  const compactRoles = styles.slice(compactRolesStart, compactRolesEnd);
  const calloutRolesStart = styles.indexOf("/* Mode Callouts :");
  const calloutRolesEnd = styles.indexOf("/* Mode compact :", calloutRolesStart);
  const calloutRoles = styles.slice(calloutRolesStart, calloutRolesEnd);

  assert.match(compactCallouts, /\.feuillets-project-editor \.markdown-source-view\.mod-cm6\.is-live-preview \.callout:is\(\[data-callout="saut-page"\], \[data-callout="pagebreak"\]\)/);
  assert.match(styles, /\.feuillets-project-editor\.feuillets-project-mode-structured[\s\S]*data-callout="questions"/);
  assert.match(styles, /feuillets-project-mode-structured\.feuillets-role-display-compact/);
  assert.match(styles, /feuillets-project-mode-structured[\s\S]*HyperMD-header-1[\s\S]*color:\s*var\(--color-red\)/);
  assert.match(styles, /feuillets-project-mode-structured[\s\S]*HyperMD-header-3[\s\S]*color:\s*var\(--color-green\)/);
  assert.match(styles, /\.feuillets-project-editor \.markdown-source-view\.mod-cm6\.is-live-preview \.cm-line\.feuillets-directive-dessous/);
  for (const role of ["problematique", "questions", "correction", "trace", "retenir", "definition", "exemple", "methodologie"]) {
    assert.match(styles, new RegExp(`feuillets-project-mode-structured[\\s\\S]*data-callout="${role}"`));
  }
  assert.match(styles, /\.callout-title[\s\S]*\.callout-icon[\s\S]*color:\s*rgb\(var\(--callout-color\)\)/);
  assert.match(calloutRoles, /feuillets-project-mode-structured:not\(\.feuillets-role-display-compact\)[\s\S]*background:\s*rgba\(var\(--callout-color\), 0\.1\)/);
  assert.match(calloutRoles, /border-left:\s*3px solid rgb\(var\(--callout-color\)\)/);
  assert.match(compactRoles, /feuillets-project-editor\.feuillets-project-mode-structured\.feuillets-role-display-compact[\s\S]*background:\s*transparent/);
  assert.match(compactRoles, /feuillets-project-editor\.feuillets-project-mode-structured\.feuillets-role-display-compact[\s\S]*border:\s*0/);
  assert.match(compactRoles, /feuillets-project-editor\.feuillets-project-mode-structured\.feuillets-role-display-compact[\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(styles, /(?:^|\n)\s*\.callout\[data-callout="questions"\]/);
  assert.doesNotMatch(compactCallouts, /!important/);
});
