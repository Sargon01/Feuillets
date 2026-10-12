import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TFile, TFolder } from "obsidian";
import { ReferenceCitationSettingsModal } from "../src/ui/reference-citation-settings.js";
import { FolderWorkspaceModal } from "../src/ui/folder-workspace-modal.js";
import { isDeclaredWorkspaceRoot } from "../src/services/folder-workspaces.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { fr } from "../src/i18n/fr.js";
import { setImmediate } from "node:timers/promises";


const modalSource = readFileSync("src/ui/folder-workspace-modal.ts", "utf8");
const binderSource = readFileSync("src/views/feuillets-view.ts", "utf8");

test("workspace folder context menu opens the local configuration modal only for descendants", () => {
  assert.match(binderSource, /folderWorkspaceExtras\(folder: TFolder\)/);
  assert.match(binderSource, /folderPathToWorkspaceScope\(projectRoot\.path, folder\.path\)/);
  assert.match(binderSource, /new FolderWorkspaceModal\(this\.app, this\.plugin, folder\)\.open\(\)/);
  assert.match(binderSource, /this\.folderWorkspaceExtras\(child\)\(menu\)/);
  assert.match(binderSource, /this\.folderWorkspaceExtras\(treeRoot\)\(menu\)/);
});

test("workspace modal reads provenance without creating settings and applies only preset fields", () => {
  assert.match(modalSource, /resolveFolderWorkspaceValue/);
  assert.match(modalSource, /getFolderWorkspaceConfig/);
  assert.match(modalSource, /workspaceScopeToFolderPath/);
  assert.match(modalSource, /sourceDescription/);
  assert.match(modalSource, /inheritedFromParent/);
  assert.match(modalSource, /inheritedFromProject/);
  assert.match(modalSource, /preset,/);
  assert.match(modalSource, /planningField:/);
  assert.match(modalSource, /newSheetIncludeSources:/);
  assert.match(modalSource, /cardContent:/);
  assert.match(modalSource, /hiddenBoardModes:/);
  assert.match(modalSource, /outlineCols:/);
  assert.match(modalSource, /modal\.folderWorkspace\.workflow/);
  assert.match(modalSource, /modal\.folderWorkspace\.goals/);
  assert.match(modalSource, /workspaceStatuses\(/);
  assert.match(modalSource, /workspaceLabels\(/);
  assert.match(modalSource, /workspaceFavoriteTags\(/);
  assert.match(modalSource, /workspaceWordGoalDefault\(/);
  assert.match(modalSource, /workspaceTotalWordGoal\(/);
  assert.match(modalSource, /workspaceSessionGoal\(/);
  assert.match(modalSource, /workspaceDeadline\(/);
  assert.match(modalSource, /workspaceFieldSource\(/);
  assert.match(modalSource, /saveLocalField/);
  assert.match(modalSource, /resetLocalField/);
  assert.doesNotMatch(modalSource, /projectMeta\[projectRootPath\]\.type\s*=/);
});

test("workspace reset removes only the configured folder entry", () => {
  assert.match(modalSource, /delete next\[relativeScope\]/);
  assert.match(modalSource, /delete meta\.folderWorkspaces/);
  assert.doesNotMatch(modalSource, /for \(const .*folderWorkspaces/);
});

/* REFACTORISATION — statut d'ouvrage intégré à l'espace de travail : l'ancien
 * menu contextuel Binder (« Définir comme ouvrage » / « Retirer le statut
 * d'ouvrage ») est remplacé par une option dans cette modale, exclusivement
 * lue et écrite via services/editorial-roots.ts. */
test("workspace modal expose l'option ouvrage via les API editorial-roots existantes", () => {
  assert.match(modalSource, /import \{ isOuvrageRoot, ouvrageRelativePath, registerOuvrage, unregisterOuvrage \} from "\.\.\/services\/editorial-roots\.js";/);
  assert.match(modalSource, /renderOuvrageOption/);
  assert.match(modalSource, /t\("modal\.folderWorkspace\.defineAsOuvrage"\)/);
  assert.match(modalSource, /isOuvrageRoot\(this\.app, this\.plugin\.settings, projectRoot, this\.folder\)/);
  assert.match(modalSource, /registerOuvrage\(this\.plugin\.settings, projectRoot, this\.folder\)/);
  assert.match(modalSource, /unregisterOuvrage\(this\.plugin\.settings, projectRoot, this\.folder\)/);
});

test("workspace modal : l'option ouvrage exclut la racine globale, Front et ses descendants, et les dossiers préfixés par _", () => {
  assert.match(modalSource, /const rel = ouvrageRelativePath\(projectRoot\.path, this\.folder\.path\);\s*if \(!rel\) return;/);
  assert.match(modalSource, /this\.folder\.name\.startsWith\("_"\)/);
  assert.match(modalSource, /normalizePath\(`\$\{projectRoot\.path\}\/Front`\)/);
  assert.match(modalSource, /this\.folder\.name === "Front" \|\| this\.folder\.path\.split\("\/"\)\.includes\("Front"\)/);
});

test("workspace modal embeds shared citation controls without duplicating resolution", () => {
  assert.match(modalSource, /ReferenceCitationSettingsControls/);
  assert.doesNotMatch(modalSource, /renderCitations|listWorkspaceCitationCandidates|resolveWorkspaceCitationResources|citekeyBibliographyPath|citekeyCslPath|pandocCitationPreviewStyle/);
  assert.match(modalSource, /this\.renderStatuses\(workflow[\s\S]*?this\.renderGoals\(goals/);
});

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.value = typeof options === "string" ? "" : options.value ?? "";
    this._text = typeof options === "string" ? options : options.text ?? "";
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
    if (typeof options === "object" && options.cls) this.className = options.cls;
    for (const [key, value] of Object.entries(options.attr || {})) this.setAttribute(key, value);
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
  dispatch(type, event) {
    const list = this._eventListeners.get(type);
    if (list) [...list].forEach((fn) => fn(event || { target: this }));
  }
  click() {
    if (this.tagName === "INPUT") {
      this.checked = !this.checked;
      this.dispatch("change");
    } else {
      this.dispatch("click");
    }
  }
  toggleClass(cls, val) {
    if (val === undefined) {
      if (this.classes.has(cls)) this.classes.delete(cls);
      else this.classes.add(cls);
    } else if (val) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  hasClass(cls) { return this.classes.has(cls); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    return this.appendChild(child);
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(node, selector) {
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function findSettingByName(root, name) {
  for (const nameEl of root.querySelectorAll(".feuillets-reference-setting-label")) {
    if (nameEl.textContent === name) return nameEl.parentNode;
  }
  return null;
}

function installWindowStub() {
  const previous = globalThis.window;
  globalThis.window = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  return () => { globalThis.window = previous; };
}

function buildWorkspaceCitationFixture(initialFolderWorkspaces = {}) {
  const project = new TFolder("PROJECT");
  const articleA = new TFolder("PROJECT/Article-A");
  const section1 = new TFolder("PROJECT/Article-A/Section-1");
  const docA = new TFile("PROJECT/Article-A/DocA.md");
  const docS = new TFile("PROJECT/Article-A/Section-1/DocS.md");

  section1.parent = articleA;
  section1.children = [docS];
  docS.parent = section1;

  articleA.parent = project;
  articleA.children = [docA, section1];
  docA.parent = articleA;

  project.children = [articleA];

  const projectResearch = new TFolder("RESEARCH/Project-Research");
  const projectBib = new TFile("RESEARCH/Project-Research/project.bib");
  projectBib.extension = "bib";
  const defaultCsl = new TFile("RESEARCH/Project-Research/default.csl");
  defaultCsl.extension = "csl";
  projectResearch.children = [projectBib, defaultCsl];
  projectBib.parent = projectResearch;
  defaultCsl.parent = projectResearch;

  const articleAResearch = new TFolder("RESEARCH/Article-A-Research");
  const articleABib = new TFile("RESEARCH/Article-A-Research/articleA.bib");
  articleABib.extension = "bib";
  const articleACsl = new TFile("RESEARCH/Article-A-Research/articleA.csl");
  articleACsl.extension = "csl";
  articleAResearch.children = [articleABib, articleACsl];
  articleABib.parent = articleAResearch;
  articleACsl.parent = articleAResearch;

  const unrelatedResearch = new TFolder("RESEARCH/Unrelated");
  const leakedBib = new TFile("RESEARCH/Unrelated/leaked.bib");
  leakedBib.extension = "bib";
  unrelatedResearch.children = [leakedBib];
  leakedBib.parent = unrelatedResearch;

  const { vault } = createFakeVault([
    project,
    articleA,
    section1,
    docA,
    docS,
    projectResearch,
    projectBib,
    defaultCsl,
    articleAResearch,
    articleABib,
    articleACsl,
    unrelatedResearch,
    leakedBib,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [articleA.path]: articleAResearch.path,
        },
        citekeyBibliographyPath: "project.bib",
        citekeyCslPath: "default.csl",
        folderWorkspaces: { ...initialFolderWorkspaces },
      },
    },
  };

  let saveCount = 0;
  let renderCount = 0;
  const plugin = {
    settings,
    getProjectFolder: () => project,
    saveSettings: async () => { saveCount++; },
    renderAllViews: () => { renderCount++; },
    refreshCitationRendering() {},
  };

  const app = { vault };

  return {
    app,
    plugin,
    settings,
    project,
    articleA,
    section1,
    projectResearch,
    projectBib,
    defaultCsl,
    articleAResearch,
    articleABib,
    articleACsl,
    saveCount: () => saveCount,
    renderCount: () => renderCount,
  };
}

function openWorkspaceModal(app, plugin, folder) {
  const modal = new FolderWorkspaceModal(app, plugin, folder);
  modal.app = app;
  modal.contentEl = new FakeElement("div");
  modal.onOpen();
  return modal;
}

function openReferenceModal(app, plugin, folder) {
  const modal = new ReferenceCitationSettingsModal(app, plugin, { projectRoot: plugin.getProjectFolder(), scopeRoot: folder, targetScope: folder }, () => true);
  modal.contentEl = new FakeElement("div");
  modal.onOpen();
  return modal;
}

test("workspace modal: rendering causes zero settings mutation and does not alter researchFolderLinks", () => {
  const f = buildWorkspaceCitationFixture();
  const snapshotBefore = JSON.stringify(f.settings);

  const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
  assert.ok(modal.contentEl.querySelector(".feuillets-reference-setting-select"));
  assert.ok(!modal.contentEl.textContent.includes(fr["modal.folderWorkspace.bibliography"]));
  assert.ok(!modal.contentEl.textContent.includes(fr["modal.folderWorkspace.csl"]));

  assert.equal(JSON.stringify(f.settings), snapshotBefore);
  assert.deepEqual(
    f.settings.projectMeta[f.project.path].researchFolderLinks,
    JSON.parse(snapshotBefore).projectMeta[f.project.path].researchFolderLinks
  );
});

test("References settings: displays inheritance from project when no local config", () => {
  const f = buildWorkspaceCitationFixture();
  const modal = openReferenceModal(f.app, f.plugin, f.articleA);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  assert.ok(desc?.includes(fr["modal.folderWorkspace.inheritedFromProject"]));

  const select = bibSetting.querySelector("select");
  assert.ok(select);
  const optionValues = select.children.map((c) => c.value);
  assert.ok(optionValues.includes("__effective__"), "includes __effective__");
  assert.ok(optionValues.includes(""), "includes empty option");
  assert.ok(optionValues.includes("articleA.bib"), "includes candidate from article A research");
  assert.ok(!optionValues.includes("leaked.bib"), "does not leak unrelated research");
});

test("References settings: displays inheritance from parent for descendant folder", () => {
  const f = buildWorkspaceCitationFixture({
    "Article-A": {
      version: 1,
      citekeyBibliographyPath: "articleA.bib",
    },
  });
  const modal = openReferenceModal(f.app, f.plugin, f.section1);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  assert.ok(desc?.includes(fr["modal.folderWorkspace.inheritedFromParent"].replace("{name}", "Article-A")));
});

test("References settings: displays project-level disablement when project bibliography is explicitly disabled", () => {
  const f = buildWorkspaceCitationFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "";
  const modal = openReferenceModal(f.app, f.plugin, f.articleA);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  const expected = `${fr["modal.folderWorkspace.inheritedFromProject"]} — ${fr["modal.folderWorkspace.disabled"]}`;
  assert.equal(desc, expected);
});

test("References settings: displays ancestor disablement when parent workspace bibliography is explicitly disabled", () => {
  const f = buildWorkspaceCitationFixture({
    "Article-A": {
      version: 1,
      citekeyBibliographyPath: "",
    },
  });
  const modal = openReferenceModal(f.app, f.plugin, f.section1);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  const expected = `${fr["modal.folderWorkspace.inheritedFromParent"].replace("{name}", "Article-A")} — ${fr["modal.folderWorkspace.disabled"]}`;
  assert.equal(desc, expected);
});

test("References settings: displays not configured when neither project nor workspace has a bibliography set", () => {
  const f = buildWorkspaceCitationFixture();
  delete f.settings.projectMeta[f.project.path].citekeyBibliographyPath;
  const modal = openReferenceModal(f.app, f.plugin, f.articleA);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  assert.equal(desc, fr["modal.folderWorkspace.notConfigured"]);
});

test("References settings: displays invalid path when local workspace contains an invalid path traversal", () => {
  const f = buildWorkspaceCitationFixture({
    "Article-A": {
      version: 1,
      citekeyBibliographyPath: "../outside.bib",
    },
  });
  const modal = openReferenceModal(f.app, f.plugin, f.articleA);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  const expected = `${fr["modal.folderWorkspace.local"]} — ${fr["modal.folderWorkspace.invalidPath"]}`;
  assert.equal(desc, expected);
});

test("References settings: displays unbound research when workspace has no associated Research folder", () => {
  const f = buildWorkspaceCitationFixture();
  f.settings.projectMeta[f.project.path].researchFolderLinks = {
    [f.project.path]: "RESEARCH/NonExistent",
  };

  const modal = openReferenceModal(f.app, f.plugin, f.articleA);

  const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
  assert.ok(bibSetting, "Bibliography setting exists");
  const desc = bibSetting.querySelector(".setting-item-description")?.textContent;
  const expected = `${fr["modal.folderWorkspace.inheritedFromProject"]} — ${fr["modal.folderWorkspace.unboundResearch"]}`;
  assert.equal(desc, expected);
});

test("References settings: local candidate selection saves field and triggers saveSettings", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture();
    const modal = openReferenceModal(f.app, f.plugin, f.articleA);

    modal.contentEl.querySelector(".feuillets-reference-settings-inheritance").click();
    const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
    const select = bibSetting.querySelector("select");
    select.value = "articleA.bib";
    select.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = f.settings.projectMeta[f.project.path].folderWorkspaces?.["Article-A"]?.citekeyBibliographyPath;
    assert.equal(saved, "articleA.bib");
    assert.ok(f.saveCount() > 0);
  } finally {
    restore();
  }
});

test("References settings: local deactivation (\"\") saves empty string and shows deactivated status", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture();
    const modal = openReferenceModal(f.app, f.plugin, f.articleA);

    modal.contentEl.querySelector(".feuillets-reference-settings-inheritance").click();
    const bibSetting = findSettingByName(modal.contentEl, fr["shared.research.citationBibliography"]);
    const select = bibSetting.querySelector("select");
    select.value = "";
    select.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = f.settings.projectMeta[f.project.path].folderWorkspaces?.["Article-A"]?.citekeyBibliographyPath;
    assert.equal(saved, "");
  } finally {
    restore();
  }
});

test("References settings: reset removes local override and restores inheritance", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({
      "Article-A": {
        version: 1,
        citekeyBibliographyPath: "articleA.bib",
      },
    });
    const modal = openReferenceModal(f.app, f.plugin, f.articleA);

    const resetButton = modal.contentEl.querySelector(".feuillets-reference-settings-inheritance");
    assert.ok(resetButton, "return to inherited settings button exists");
    resetButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = f.settings.projectMeta[f.project.path].folderWorkspaces?.["Article-A"]?.citekeyBibliographyPath;
    assert.equal(saved, undefined, "local override was deleted");
    assert.ok(f.saveCount() > 0);
  } finally {
    restore();
  }
});

function findFolderSetting(root, name) {
  return root.querySelectorAll(".setting-item-name").find((element) => element.textContent === name)?.parentNode.parentNode ?? null;
}

for (const identity of [{ workspaceRoot: true }, { ouvrage: { version: 1 } }, { workspaceRoot: true, ouvrage: { version: 1 } }]) {
  test(`folder reset preserves structural identities ${Object.keys(identity).join(" + ")}`, async () => {
    const restore = installWindowStub();
    try {
      const composition = { version: 1, composition: { outputBasename: "Independent work" } };
      const identities = { ...identity, ...(identity.ouvrage ? { ouvrage: composition } : {}) };
      const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, ...identities, wordGoal: 5000,
        preset: "fiction", liveJustify: false, favoriteTags: ["tag"], statuses: [], labels: [],
        citekeyBibliographyPath: "articleA.bib", futureLocalOverride: "remove" },
      "Article-A/Section-1": { version: 1, wordGoal: 1000 } });
      const descendant = structuredClone(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-1"]);
      const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
      const button = modal.contentEl.querySelectorAll("button").find((element) => element.textContent === fr["modal.folderWorkspace.reset"]);
      assert.ok(button);
      button.click(); await setImmediate();
      assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, ...identities });
      assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-1"], descendant);
      assert.equal(f.saveCount(), 1); assert.equal(f.renderCount(), 1);
      for (const [key, active] of [["defineAsWorkspace", !!identity.workspaceRoot], ["defineAsOuvrage", !!identity.ouvrage]]) {
        assert.equal(findFolderSetting(modal.contentEl, fr[`modal.folderWorkspace.${key}`]).querySelector(".checkbox-container").hasClass("is-enabled"), active);
      }
    } finally { restore(); }
  });
}

test("folder reset removes only an override-only entry and retains its declared descendants", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, wordGoal: 2000 },
      "Article-A/Section-1": { version: 1, workspaceRoot: true } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    await modal.resetLocalConfig(f.project.path, "Article-A");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces, { "Article-A/Section-1": { version: 1, workspaceRoot: true } });
  } finally { restore(); }
});

test("folder identity-only configuration inherits its parent's preset and goal in the actual modal", () => {
  const f = buildWorkspaceCitationFixture({
    "Article-A": { version: 1, preset: "nonfiction", wordGoal: 2000 },
    "Article-A/Section-1": { version: 1, workspaceRoot: true, ouvrage: { version: 1 } },
  });
  const before = structuredClone(f.settings);
  const modal = openWorkspaceModal(f.app, f.plugin, f.section1);
  assert.equal(findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.preset"]).querySelector("select").value, "nonfiction");
  assert.equal(findFolderSetting(modal.contentEl, fr["settings.wordGoal.name"]).querySelector("input").value, "2000");
  assert.ok(modal.contentEl.textContent.includes(fr["modal.folderWorkspace.inheritedFromParent"].replace("{name}", "Article-A")));
  assert.deepEqual(f.settings, before);
});

test("folder context toggles persist all four states independently and never change isolation", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, wordGoal: 2000, preset: "fiction", citekeyBibliographyPath: "articleA.bib" } });
    const preferences = structuredClone(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"]);
    const before = structuredClone(f.settings);
    f.plugin.workspaceFolderPath = f.section1.path;
    f.plugin.setWorkspaceFolder = () => assert.fail("Declaration must not isolate a folder");
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    const names = modal.contentEl.querySelectorAll(".setting-item-name").map((element) => element.textContent);
    assert.deepEqual(names.slice(0, 2), [fr["modal.folderWorkspace.defineAsWorkspace"], fr["modal.folderWorkspace.defineAsOuvrage"]]);
    const change = async (key) => {
      const control = findFolderSetting(modal.contentEl, fr[`modal.folderWorkspace.${key}`]).querySelector(".checkbox-container");
      control.click(); await setImmediate();
    };
    const check = (identities) => {
      assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { ...preferences, ...identities });
      for (const [key, active] of [["defineAsWorkspace", !!identities.workspaceRoot], ["defineAsOuvrage", !!identities.ouvrage]]) {
        assert.equal(findFolderSetting(modal.contentEl, fr[`modal.folderWorkspace.${key}`]).querySelector(".checkbox-container").hasClass("is-enabled"), active);
      }
    };
    check({});
    await change("defineAsWorkspace"); check({ workspaceRoot: true });
    await change("defineAsOuvrage"); check({ workspaceRoot: true, ouvrage: { version: 1 } });
    await change("defineAsWorkspace"); check({ ouvrage: { version: 1 } });
    await change("defineAsWorkspace"); check({ workspaceRoot: true, ouvrage: { version: 1 } });
    await change("defineAsOuvrage"); check({ workspaceRoot: true });
    await change("defineAsWorkspace"); check({});
    assert.equal(f.saveCount(), 6); assert.equal(f.renderCount(), 6);
    assert.equal(f.plugin.workspaceFolderPath, f.section1.path);
    assert.deepEqual(f.settings, before);
  } finally { restore(); }
});

test("individual preference resets preserve both structural identities and work composition", async () => {
  const restore = installWindowStub();
  try {
    const identities = { version: 1, workspaceRoot: true, ouvrage: { version: 1, composition: { outputBasename: "My work" } } };
    const f = buildWorkspaceCitationFixture({ "Article-A": { ...identities, wordGoal: 2000 } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    await modal.resetLocalField(f.project.path, "Article-A", "wordGoal");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], identities);
    await modal.resetLocalField(f.project.path, "Article-A", "workspaceRoot");
    await modal.resetLocalField(f.project.path, "Article-A", "ouvrage");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], identities);
    assert.equal(f.saveCount(), 1);
  } finally { restore(); }
});

const settle = () => setImmediate();
function citationSelect(modal, field) {
  return modal.contentEl.querySelectorAll(".feuillets-reference-setting-select").find((select) => select.getAttribute("data-citation-setting") === field);
}

async function changeCitation(modal, field, value) {
  let select = citationSelect(modal, field);
  if (select.disabled) {
    modal.contentEl.querySelector(".feuillets-reference-settings-inheritance").click();
    select = citationSelect(modal, field);
  }
  select.value = value; select.dispatch("change"); await settle();
}

test("folder reference selectors expose only the receiving folder's Research candidates", () => {
  const f = buildWorkspaceCitationFixture(); const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
  const bib = citationSelect(modal, "citekeyBibliographyPath"); const csl = citationSelect(modal, "citekeyCslPath");
  assert.ok(modal.contentEl.textContent.includes(fr["modal.folderWorkspace.references"]));
  assert.ok(bib.children.some((option) => option.value === "articleA.bib"));
  assert.ok(csl.children.some((option) => option.value === "articleA.csl"));
  assert.ok(!bib.children.some((option) => option.value === "leaked.bib"));
  assert.ok(!bib.children.some((option) => option.value === "project.bib"));
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.project, f.articleA), false); modal.onClose();
});

test("folder and References modals immediately share bibliography, CSL and every rendering mode", async () => {
  const restore = installWindowStub();
  try {
    const identities = { version: 1, workspaceRoot: true, ouvrage: { version: 1, composition: { outputBasename: "Local work" } },
      wordGoal: 2300, liveJustify: false };
    const f = buildWorkspaceCitationFixture({ "Article-A": structuredClone(identities) });
    const folder = openWorkspaceModal(f.app, f.plugin, f.articleA); const reference = openReferenceModal(f.app, f.plugin, f.articleA);
    await changeCitation(folder, "citekeyBibliographyPath", "articleA.bib");
    assert.equal(citationSelect(reference, "citekeyBibliographyPath").value, "articleA.bib");
    await changeCitation(folder, "citekeyCslPath", "articleA.csl");
    assert.equal(citationSelect(reference, "citekeyCslPath").value, "articleA.csl");
    for (const mode of ["off", "author-date", "csl"]) {
      await changeCitation(folder, "pandocCitationPreviewStyle", mode);
      assert.equal(citationSelect(reference, "pandocCitationPreviewStyle").value, mode);
      assert.ok(citationSelect(folder, "pandocCitationPreviewStyle").getAttribute("title").includes(fr["modal.folderWorkspace.local"]));
    }
    assert.ok(folder.contentEl.textContent.includes(fr["project.pandocCitationPreview.cslCompanionMissing"]));
    await changeCitation(reference, "pandocCitationPreviewStyle", "author-date");
    assert.equal(citationSelect(folder, "pandocCitationPreviewStyle").value, "author-date");
    await changeCitation(reference, "citekeyBibliographyPath", "");
    assert.equal(citationSelect(folder, "citekeyBibliographyPath").value, "");
    await changeCitation(reference, "citekeyCslPath", "");
    assert.equal(citationSelect(folder, "citekeyCslPath").value, "");
    folder.contentEl.querySelector(".feuillets-reference-settings-inheritance").click(); await settle();
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], identities);
    assert.equal(citationSelect(reference, "citekeyBibliographyPath").getAttribute("data-effective-value"), "project.bib");
    assert.equal(f.settings.projectMeta[f.project.path].citekeyBibliographyPath, "project.bib");
    assert.equal(f.settings.projectMeta[f.project.path].citekeyCslPath, "default.csl");
    folder.onClose(); reference.onClose();
  } finally { restore(); }
});

test("folder references inherit parent values through identity-only children and can reset individual fields", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, citekeyBibliographyPath: "articleA.bib", citekeyCslPath: "articleA.csl", pandocCitationPreviewStyle: "csl" },
      "Article-A/Section-1": { version: 1, workspaceRoot: true } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.section1);
    for (const [field, value] of [["citekeyBibliographyPath", "articleA.bib"], ["citekeyCslPath", "articleA.csl"], ["pandocCitationPreviewStyle", "csl"]]) {
      assert.equal(citationSelect(modal, field).getAttribute("data-effective-value"), value);
    }
    await changeCitation(modal, "pandocCitationPreviewStyle", "off");
    await changeCitation(modal, "pandocCitationPreviewStyle", "__inherit__");
    assert.equal(citationSelect(modal, "pandocCitationPreviewStyle").getAttribute("data-effective-value"), "csl");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-1"], { version: 1, workspaceRoot: true });
    modal.onClose();
  } finally { restore(); }
});

test("folder reference writes reject invalid paths, sibling resources and invalid rendering modes", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture(); const before = structuredClone(f.settings); const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    for (const [field, value] of [["citekeyBibliographyPath", "../outside.bib"], ["citekeyBibliographyPath", "leaked.bib"], ["citekeyCslPath", "outside.csl"], ["pandocCitationPreviewStyle", "invalid"]]) {
      await changeCitation(modal, field, value);
    }
    assert.deepEqual(f.settings, before); assert.equal(f.saveCount(), 0); modal.onClose();
  } finally { restore(); }
});

const sectionDefaults = { views: false, workflow: false, goals: false, typography: false, references: false };

function workspaceSection(modal, key) {
  const section = modal.contentEl.querySelectorAll(".feuillets-workspace-section")
    .find((element) => element.getAttribute("data-workspace-section") === key);
  assert.ok(section, key);
  return { section, header: section.querySelector(".feuillets-workspace-section-toggle"),
    content: section.querySelector(".feuillets-workspace-section-content") };
}

function assertSectionStates(modal, expected) {
  for (const [key, expanded] of Object.entries(expected)) {
    const { header, content } = workspaceSection(modal, key);
    assert.equal(header.getAttribute("aria-expanded"), String(expanded), key);
    assert.equal(content.hidden, !expanded, key);
  }
}

test("workspace sections expose all existing groups with accessible headers and expected defaults", () => {
  const f = buildWorkspaceCitationFixture();
  const before = structuredClone(f.settings);
  const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
  assert.deepEqual(modal.contentEl.querySelectorAll(".feuillets-workspace-section")
    .map((element) => element.getAttribute("data-workspace-section")), Object.keys(sectionDefaults));
  assertSectionStates(modal, sectionDefaults);
  const essentials = modal.contentEl.querySelector(".feuillets-workspace-essentials");
  assert.ok(essentials);
  assert.equal(essentials.querySelectorAll(".feuillets-workspace-section").length, 0);
  assert.equal(essentials.querySelectorAll(".setting-item").length, 4);
  for (const key of ["defineAsWorkspace", "defineAsOuvrage", "preset"]) {
    assert.equal(findFolderSetting(essentials, fr[`modal.folderWorkspace.${key}`]).parentNode, essentials);
  }
  assert.equal(modal.contentEl.querySelectorAll(".setting-item-name")
    .filter((element) => element.textContent === fr["modal.folderWorkspace.preset"]).length, 1);
  const ids = new Set();
  for (const [key, expanded] of Object.entries(sectionDefaults)) {
    const { section, header, content } = workspaceSection(modal, key);
    assert.equal(header.tagName, "BUTTON");
    assert.equal(header.getAttribute("type"), "button");
    assert.equal(header.textContent, fr[`modal.folderWorkspace.${key}`]);
    assert.equal(header.getAttribute("aria-controls"), content.getAttribute("id"));
    assert.ok(!ids.has(content.getAttribute("id"))); ids.add(content.getAttribute("id"));
    const chevron = section.querySelector(".feuillets-workspace-section-chevron");
    assert.equal(chevron.getAttribute("aria-hidden"), "true");
    assert.equal(chevron.icon, expanded ? "chevron-down" : "chevron-right");
  }
  assert.deepEqual(f.settings, before); assert.equal(f.saveCount(), 0); modal.onClose();
});

test("workspace folding is independent and keeps controls mounted without saves, renders or vault writes", () => {
  const f = buildWorkspaceCitationFixture(); const before = structuredClone(f.settings);
  const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
  const controls = modal.citationControls;
  const dropdown = citationSelect(modal, "citekeyBibliographyPath");
  const identity = findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.defineAsWorkspace"]);
  modal.renderContent = () => assert.fail("Folding must not rebuild the modal");
  f.plugin.refreshCitationRendering = () => assert.fail("Folding must not refresh citations");
  for (const method of ["modify", "create", "createFolder", "delete", "rename"]) {
    f.app.vault[method] = () => assert.fail(`Folding must not ${method} in the vault`);
  }
  const expected = { ...sectionDefaults };
  for (const key of ["views", "workflow", "goals", "typography", "references", "views"]) {
    workspaceSection(modal, key).header.click(); expected[key] = !expected[key];
    assertSectionStates(modal, expected);
  }
  assert.equal(expected.workflow, true); assert.equal(expected.goals, true); assert.equal(expected.typography, true);
  assert.equal(modal.citationControls, controls); assert.equal(controls.active, true);
  assert.equal(citationSelect(modal, "citekeyBibliographyPath"), dropdown);
  assert.equal(findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.defineAsWorkspace"]), identity);
  assert.deepEqual(f.settings, before); assert.equal(f.saveCount(), 0); assert.equal(f.renderCount(), 0);
  modal.onClose();
});

for (const action of ["workspace", "ouvrage", "views", "preset", "references", "reset", "workflow", "goals", "typography"]) {
  test(`workspace section state and controls survive a ${action} setting change`, async () => {
    const restore = installWindowStub();
    try {
      const identities = { workspaceRoot: true, ouvrage: { version: 1, composition: { outputBasename: "Local work" } } };
      const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, ...identities, wordGoal: 2000 } });
      const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
      const expected = { ...sectionDefaults, views: true, workflow: true, goals: true, typography: true };
      for (const key of ["views", "workflow", "goals", "typography"]) workspaceSection(modal, key).header.click();
      if (action === "references") {
        workspaceSection(modal, "references").header.click(); expected.references = true;
      }
      modal.contentEl.scrollTop = 210;
      const config = () => f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"];
      if (action === "workspace" || action === "ouvrage") {
        const key = action === "workspace" ? "defineAsWorkspace" : "defineAsOuvrage";
        findFolderSetting(modal.contentEl, fr[`modal.folderWorkspace.${key}`]).querySelector(".checkbox-container").click();
        await settle();
        assert.equal(config().workspaceRoot, action === "workspace" ? undefined : true);
        assert.deepEqual(config().ouvrage, action === "ouvrage" ? undefined : identities.ouvrage);
      } else if (action === "views") {
        const toggle = findFolderSetting(modal.contentEl, fr["board.mode.board"]).querySelector(".checkbox-container");
        const wasVisible = toggle.hasClass("is-enabled"); toggle.click(); await settle();
        assert.equal(config().hiddenBoardModes.includes("board"), wasVisible);
      } else if (action === "preset") {
        const select = findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.preset"]).querySelector("select");
        select.value = "fiction"; select.dispatch("change"); await settle();
        assert.equal(config().preset, "fiction"); assert.deepEqual(config().ouvrage, identities.ouvrage);
      } else if (action === "references") {
        await changeCitation(modal, "pandocCitationPreviewStyle", "author-date");
        assert.equal(config().pandocCitationPreviewStyle, "author-date");
      } else if (action === "reset") {
        const reset = modal.contentEl.querySelector(".feuillets-workspace-essentials").querySelectorAll("button")
          .find((element) => element.textContent === fr["modal.folderWorkspace.reset"]);
        reset.click(); await settle(); assert.deepEqual(config(), { version: 1, ...identities });
      } else if (action === "workflow") {
        findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.statuses"]).querySelector("button").click();
        await settle(); assert.ok(Array.isArray(config().statuses));
      } else {
        const label = action === "goals" ? fr["settings.wordGoal.name"] : fr["settings.readingFontSize.name"];
        const input = findFolderSetting(modal.contentEl, label).querySelector("input");
        input.value = action === "goals" ? "3456" : "20"; input.dispatch("input"); await settle();
        assert.equal(config()[action === "goals" ? "wordGoal" : "readingFontSize"], action === "goals" ? 3456 : 20);
      }
      assertSectionStates(modal, expected);
      // Also exercise the common rebuild path after controls with a partial refresh.
      modal.rerenderContent(); assertSectionStates(modal, expected);
      assert.equal(modal.contentEl.scrollTop, 210);
      assert.equal(f.saveCount(), 1); modal.onClose();
    } finally { restore(); }
  });
}

test("workspace sections use instance-only defaults and unique control IDs on reopening", () => {
  const f = buildWorkspaceCitationFixture();
  const first = openWorkspaceModal(f.app, f.plugin, f.articleA);
  const firstId = workspaceSection(first, "views").content.getAttribute("id");
  for (const key of Object.keys(sectionDefaults)) workspaceSection(first, key).header.click();
  first.onClose();
  const second = openWorkspaceModal(f.app, f.plugin, f.articleA);
  assertSectionStates(second, sectionDefaults);
  assert.notEqual(workspaceSection(second, "views").content.getAttribute("id"), firstId);
  assert.equal(f.saveCount(), 0); second.onClose();
});

test("folded References retain shared controls and receive autonomous settings updates", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, workspaceRoot: true,
      ouvrage: { version: 1, composition: { outputBasename: "Local work" } } } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    const autonomous = openReferenceModal(f.app, f.plugin, f.articleA);
    assert.equal(workspaceSection(modal, "references").content.hidden, true);
    await changeCitation(autonomous, "citekeyBibliographyPath", "articleA.bib");
    await changeCitation(autonomous, "citekeyCslPath", "articleA.csl");
    assert.equal(workspaceSection(modal, "references").content.hidden, true);
    workspaceSection(modal, "references").header.click();
    assert.equal(citationSelect(modal, "citekeyBibliographyPath").value, "articleA.bib");
    assert.equal(citationSelect(modal, "citekeyCslPath").value, "articleA.csl");
    assert.equal(f.saveCount(), 2);
    modal.contentEl.querySelector(".feuillets-reference-settings-inheritance").click(); await settle();
    assert.equal(workspaceSection(modal, "references").content.hidden, false);
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], {
      version: 1, workspaceRoot: true, ouvrage: { version: 1, composition: { outputBasename: "Local work" } },
    });
    modal.onClose(); autonomous.onClose();
  } finally { restore(); }
});

function connectedTo(element, root) {
  for (let node = element; node; node = node.parentNode) if (node === root) return true;
  return false;
}

for (const field of ["statuses", "labels"]) {
  test(`a delayed ${field} addition cannot detach a color picker used after the click`, async () => {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1,
      statuses: [{ name: "Draft", color: "#123456" }], labels: [{ name: "Scene", color: "#654321" }] } });
    let complete;
    f.plugin.saveSettings = () => new Promise((resolveSave) => { complete = resolveSave; });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    workspaceSection(modal, "workflow").header.click();
    workspaceSection(modal, "typography").header.click();
    const add = modal.contentEl.querySelectorAll("button").find((button) => button.textContent === fr[`settings.${field}.add`]);
    add.click();
    const finishAdd = complete;
    const list = modal.contentEl.querySelector(field === "statuses" ? ".feuillets-workspace-status-list" : ".feuillets-workspace-label-list");
    const color = list.querySelectorAll("input")[1];
    color.value = "#abcdef"; color.dispatch("change");
    finishAdd(); await settle();
    assert.equal(connectedTo(color, modal.contentEl), true);
    assert.equal(workspaceSection(modal, "workflow").content.hidden, false);
    assert.equal(workspaceSection(modal, "typography").content.hidden, false);
    complete(); await settle(); modal.onClose();
  });
}

test("bibliographic saves retain the shared controls and all three select nodes", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, pandocCitationPreviewStyle: "off" } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    const autonomous = openReferenceModal(f.app, f.plugin, f.articleA);
    workspaceSection(modal, "references").header.click();
    const controls = modal.citationControls;
    const selects = modal.contentEl.querySelectorAll("select").slice(-3);
    const autonomousSelects = autonomous.contentEl.querySelectorAll("select");
    await changeCitation(modal, "pandocCitationPreviewStyle", "csl");
    assert.ok(modal.citationControls === controls);
    assert.ok(modal.contentEl.querySelectorAll("select").slice(-3).every((select, index) => select === selects[index]));
    assert.ok(autonomous.contentEl.querySelectorAll("select").every((select, index) => select === autonomousSelects[index]));
    assert.equal(workspaceSection(modal, "references").content.hidden, false);
    autonomous.onClose(); modal.onClose();
  } finally { restore(); }
});

for (const field of ["statuses", "labels"]) {
  test(`${field} structural changes retain surviving rows and reset only that local list`, async () => {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, workspaceRoot: true,
      ouvrage: { version: 1, composition: { outputBasename: "Work" } }, wordGoal: 1200,
      [field]: [{ name: "First", color: "#123456" }, { name: "Second", color: "#654321" }] } });
    f.settings.projectMeta[f.project.path][field] = [{ name: "Inherited", color: "#888888" }];
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    workspaceSection(modal, "workflow").header.click();
    const list = modal.contentEl.querySelector(field === "statuses" ? ".feuillets-workspace-status-list" : ".feuillets-workspace-label-list");
    const survivingName = list.querySelectorAll("input")[2];
    list.querySelector(".extra-setting-button").click(); await settle();
    assert.equal(connectedTo(survivingName, modal.contentEl), true);
    survivingName.value = "Renamed"; survivingName.dispatch("input"); await settle();
    const config = f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"];
    assert.deepEqual(config[field], [{ name: "Renamed", color: "#654321" }]);
    const reset = workspaceSection(modal, "workflow").content.querySelectorAll(".setting-item-name")
      .find((element) => element.textContent === fr["modal.folderWorkspace.resetField"]);
    reset.parentNode.parentNode.querySelector(".extra-setting-button").click(); await settle();
    assert.equal(list.querySelector("input").value, "Inherited");
    const restored = f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"];
    assert.equal(restored[field], undefined);
    assert.equal(restored.workspaceRoot, true); assert.equal(restored.wordGoal, 1200);
    assert.equal(restored.ouvrage.composition.outputBasename, "Work");
    assert.equal(workspaceSection(modal, "workflow").content.hidden, false); modal.onClose();
  });
}

test("rapid bibliography edits in both windows serialize writes without dropping a value", async () => {
  const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, workspaceRoot: true,
    ouvrage: { version: 1 }, pandocCitationPreviewStyle: "off" } });
  const pending = []; let active = 0; let maxActive = 0; let persisted;
  f.plugin.saveSettings = () => {
    const snapshot = structuredClone(f.settings);
    maxActive = Math.max(maxActive, ++active);
    return new Promise((resolveSave) => pending.push(() => { active--; persisted = snapshot; resolveSave(); }));
  };
  const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
  const autonomous = openReferenceModal(f.app, f.plugin, f.articleA);
  workspaceSection(modal, "references").header.click();
  for (const [owner, field, value] of [[modal, "pandocCitationPreviewStyle", "csl"],
    [autonomous, "citekeyBibliographyPath", "articleA.bib"], [modal, "citekeyCslPath", "articleA.csl"]]) {
    const select = citationSelect(owner, field);
    assert.equal(select.disabled, false); select.value = value; select.dispatch("change");
  }
  for (let count = 0; count < 3; count++) { assert.equal(pending.length, 1); pending.shift()(); await settle(); }
  assert.equal(maxActive, 1); assert.deepEqual(persisted, f.settings);
  const config = persisted.projectMeta[f.project.path].folderWorkspaces["Article-A"];
  assert.equal(config.pandocCitationPreviewStyle, "csl"); assert.equal(config.citekeyBibliographyPath, "articleA.bib");
  assert.equal(config.citekeyCslPath, "articleA.csl"); assert.equal(config.workspaceRoot, true); assert.ok(config.ouvrage);
  assert.equal(modal.citationControls.saving, false); assert.equal(autonomous.saving, false);
  assert.equal(workspaceSection(modal, "references").content.hidden, false);
  modal.onClose(); autonomous.onClose();
});

for (const field of ["statuses", "labels"]) {
  test(`forking inherited ${field} keeps existing inputs through subsequent additions`, async () => {
    const f = buildWorkspaceCitationFixture();
    const inherited = { id: field === "statuses" ? "draft" : "red", name: "Inherited", color: "#123456" };
    f.settings.projectMeta[f.project.path][field] = [inherited];
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    workspaceSection(modal, "workflow").header.click();
    const list = modal.contentEl.querySelector(field === "statuses" ? ".feuillets-workspace-status-list" : ".feuillets-workspace-label-list");
    const [name, color] = list.querySelectorAll("input");
    color.value = "#abcdef"; color.dispatch("change"); await settle();
    assert.equal(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"][field][0].id, inherited.id);
    const add = modal.contentEl.querySelectorAll("button").find((button) => button.textContent === fr[`settings.${field}.add`]);
    add.click(); await settle();
    assert.equal(list.querySelector("input") === name, true);
    assert.equal(connectedTo(color, modal.contentEl), true);
    name.value = "Local"; name.dispatch("input"); await settle();
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"][field][0], { name: "Local", color: "#abcdef" });
    assert.deepEqual(f.settings.projectMeta[f.project.path][field], [inherited]);
    modal.onClose();
  });
}
