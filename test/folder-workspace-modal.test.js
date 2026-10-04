import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers";
import { TFile, TFolder } from "obsidian";
import { ReferenceCitationSettingsModal } from "../src/ui/reference-citation-settings.js";
import { FolderWorkspaceModal } from "../src/ui/folder-workspace-modal.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { fr } from "../src/i18n/fr.js";
import { isDeclaredWorkspaceRoot } from "../src/services/folder-workspaces.js";


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

test("folder modal shares existing citation controls with References, without another resolver", () => {
  assert.match(modalSource, /ReferenceCitationSettingsControls/);
  assert.match(modalSource, /modal\.folderWorkspace\.references/);
  assert.doesNotMatch(modalSource, /listWorkspaceCitationCandidates|resolveWorkspaceCitationResources/);
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
    if (typeof options === "object") for (const [name, value] of Object.entries(options.attr ?? {})) this._attributes.set(name, String(value));
    this._eventListeners = new Map();
    if (typeof options === "object" && options.cls) this.className = options.cls;
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
  assert.equal(modal.contentEl.querySelectorAll(".feuillets-reference-setting-select").length, 3);
  assert.ok(modal.contentEl.textContent.includes(fr["shared.research.citationBibliography"]));
  assert.ok(modal.contentEl.textContent.includes(fr["shared.research.citationCslStyle"]));

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

const settle = () => new Promise((resolve) => setImmediate(resolve));

function findFolderSetting(root, name) {
  return root.querySelectorAll(".setting-item-name").find((element) => element.textContent === name)?.parentNode.parentNode ?? null;
}

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

test("folder identity-only configuration inherits the parent's preset and fields in the actual modal", () => {
  const f = buildWorkspaceCitationFixture({
    "Article-A": { version: 1, preset: "nonfiction", wordGoal: 2000 },
    "Article-A/Section-1": { version: 1, workspaceRoot: true, ouvrage: { version: 1 } },
  });
  const before = structuredClone(f.settings); const modal = openWorkspaceModal(f.app, f.plugin, f.section1);
  assert.equal(findFolderSetting(modal.contentEl, fr["modal.folderWorkspace.preset"]).querySelector("select").value, "nonfiction");
  assert.equal(findFolderSetting(modal.contentEl, fr["settings.wordGoal.name"]).querySelector("input").value, "2000");
  assert.ok(modal.contentEl.textContent.includes(fr["modal.folderWorkspace.inheritedFromParent"].replace("{name}", "Article-A")));
  assert.deepEqual(f.settings, before); modal.onClose();
});

for (const identity of [{ workspaceRoot: true }, { ouvrage: { version: 1 } }, { workspaceRoot: true, ouvrage: { version: 1 } }]) {
  test(`folder reset preserves structural identities ${Object.keys(identity).join(" + ")}`, async () => {
    const restore = installWindowStub();
    try {
      const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, ...identity, wordGoal: 5000,
        preset: "fiction", liveJustify: false, favoriteTags: ["tag"], statuses: [], labels: [],
        citekeyBibliographyPath: "articleA.bib", citekeyCslPath: "articleA.csl", pandocCitationPreviewStyle: "csl",
        futureLocalOverride: "remove" }, "Article-A/Section-1": { version: 1, wordGoal: 1000 } });
      const parent = structuredClone(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-1"]);
      const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
      const reference = openReferenceModal(f.app, f.plugin, f.articleA);
      await modal.resetLocalConfig(f.project.path, "Article-A");
      assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, ...identity });
      assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-1"], parent);
      assert.equal(citationSelect(reference, "citekeyBibliographyPath").getAttribute("data-effective-value"), "project.bib");
      modal.onClose(); reference.onClose();
    } finally { restore(); }
  });
}

test("folder reset removes an override-only entry but never its descendants", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, wordGoal: 2000 },
      "Article-A/Section-1": { version: 1, workspaceRoot: true } });
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA); await modal.resetLocalConfig(f.project.path, "Article-A");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces, { "Article-A/Section-1": { version: 1, workspaceRoot: true } });
    modal.onClose();
  } finally { restore(); }
});

test("folder context toggles are independent, preserve overrides and never activate isolation", async () => {
  const restore = installWindowStub();
  try {
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, wordGoal: 2000 } });
    f.plugin.workspaceFolderPath = f.section1.path;
    f.plugin.setWorkspaceFolder = () => assert.fail("declaring an identity must not isolate a folder");
    const modal = openWorkspaceModal(f.app, f.plugin, f.articleA);
    const toggle = async (key) => { findFolderSetting(modal.contentEl, fr[key]).querySelector(".checkbox-container").click(); await settle(); };
    await toggle("modal.folderWorkspace.defineAsWorkspace"); await toggle("modal.folderWorkspace.defineAsOuvrage");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, wordGoal: 2000, workspaceRoot: true, ouvrage: { version: 1 } });
    await toggle("modal.folderWorkspace.defineAsWorkspace");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, wordGoal: 2000, ouvrage: { version: 1 } });
    await toggle("modal.folderWorkspace.defineAsWorkspace"); await toggle("modal.folderWorkspace.defineAsOuvrage");
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, wordGoal: 2000, workspaceRoot: true });
    assert.equal(f.plugin.workspaceFolderPath, f.section1.path); modal.onClose();
  } finally { restore(); }
});

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
    const f = buildWorkspaceCitationFixture({ "Article-A": { version: 1, workspaceRoot: true, ouvrage: { version: 1 } } });
    const folder = openWorkspaceModal(f.app, f.plugin, f.articleA); const reference = openReferenceModal(f.app, f.plugin, f.articleA);
    await changeCitation(folder, "citekeyBibliographyPath", "articleA.bib");
    assert.equal(citationSelect(reference, "citekeyBibliographyPath").value, "articleA.bib");
    await changeCitation(folder, "citekeyCslPath", "articleA.csl");
    assert.equal(citationSelect(reference, "citekeyCslPath").value, "articleA.csl");
    for (const mode of ["off", "author-date", "csl"]) {
      await changeCitation(folder, "pandocCitationPreviewStyle", mode);
      assert.equal(citationSelect(reference, "pandocCitationPreviewStyle").value, mode);
    }
    await changeCitation(reference, "pandocCitationPreviewStyle", "author-date");
    assert.equal(citationSelect(folder, "pandocCitationPreviewStyle").value, "author-date");
    await changeCitation(reference, "citekeyBibliographyPath", "");
    assert.equal(citationSelect(folder, "citekeyBibliographyPath").value, "");
    await changeCitation(reference, "citekeyCslPath", "");
    assert.equal(citationSelect(folder, "citekeyCslPath").value, "");
    folder.contentEl.querySelector(".feuillets-reference-settings-inheritance").click(); await settle();
    assert.deepEqual(f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"], { version: 1, workspaceRoot: true, ouvrage: { version: 1 } });
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
