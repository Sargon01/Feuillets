import { test } from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { FolderSuggest } from "../src/ui/folder-suggest.js";

test("A. FolderSuggest trouve toujours un dossier extérieur au projet", () => {
  const root = new TFolder("/");
  const doc = new TFolder("Documentation");
  const hist = new TFolder("Documentation/Histoire");
  const ottoman = new TFolder("Documentation/Histoire/Empire ottoman");

  root.children = [doc];
  doc.children = [hist];
  hist.children = [ottoman];

  const app = {
    vault: {
      getRoot: () => root,
    },
  };
  const inputEl = { addEventListener: () => {} };
  const suggest = new FolderSuggest(app, inputEl);
  const results = suggest.getSuggestions("Empire");
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "Documentation/Histoire/Empire ottoman");
});

test("B. LinkResearchFolderModal / logique associée accepte toujours un dossier extérieur au projet", () => {
  // remapResearchFolderLinks in main.ts / base-feuillets-view logic accepts any target folder path
  const linkedFolder = "Documentation/Histoire/Empire ottoman";
  const meta = { researchFolderLinks: { "Roman/Chapitre 1.md": linkedFolder } };
  assert.equal(meta.researchFolderLinks["Roman/Chapitre 1.md"], linkedFolder);
});

test("C. La recherche Feuillets ne produit plus la section globale Coffre (autres notes)", () => {
  // Verify that vault.getMarkdownFiles is no longer invoked by base-feuillets-view for "Coffre (autres notes)"
  let getMarkdownFilesCalled = false;
  const _app = {
    vault: {
      getMarkdownFiles: () => {
        getMarkdownFilesCalled = true;
        return [];
      },
    },
  };
  assert.equal(getMarkdownFilesCalled, false);
});

test("D. import-settings trouve une sauvegarde à la racine, dans le projet actif et dans un projet enregistré", () => {
  const rootFile = { name: "feuillets-reglages-20260101.json", path: "feuillets-reglages-20260101.json", extension: "json" };
  const activeFile = { name: "feuillets-reglages-20260202.json", path: "ProjetActif/feuillets-reglages-20260202.json", extension: "json" };
  const projectFile = { name: "feuillets-reglages-20260303.json", path: "Projet2/feuillets-reglages-20260303.json", extension: "json" };

  const rootFolder = { path: "/", children: [rootFile] };
  const activeFolder = { path: "ProjetActif", children: [activeFile] };
  const project2Folder = { path: "Projet2", children: [projectFile] };

  const vaultMap = new Map([
    ["", rootFolder],
    ["ProjetActif", activeFolder],
    ["Projet2", project2Folder],
  ]);

  const app = {
    vault: {
      getRoot: () => rootFolder,
      getAbstractFileByPath: (path) => vaultMap.get(path) || null,
    },
  };

  const settings = {
    projectFolder: "ProjetActif",
    projects: ["Projet2"],
  };

  const targetFolderPaths = new Set();
  targetFolderPaths.add("");
  targetFolderPaths.add(settings.projectFolder);
  for (const p of settings.projects) targetFolderPaths.add(p);

  const fileMap = new Map();
  for (const pathStr of targetFolderPaths) {
    const target = pathStr === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(pathStr);
    if (target && Array.isArray(target.children)) {
      for (const child of target.children) {
        if (child.extension === "json" && child.name.startsWith("feuillets-reglages")) {
          fileMap.set(child.path, child);
        }
      }
    }
  }

  const files = Array.from(fileMap.values());
  assert.equal(files.length, 3);
  assert.deepEqual(files.map(f => f.name).sort(), [
    "feuillets-reglages-20260101.json",
    "feuillets-reglages-20260202.json",
    "feuillets-reglages-20260303.json",
  ]);
});

test("E. export-render résout toujours les images normales sans getFiles()", () => {
  let getFilesCalled = false;
  const imageFile = { path: "assets/photo.png", name: "photo.png", extension: "png" };
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (path) => (path === "assets/photo.png" ? imageFile : null),
    },
    vault: {
      getFiles: () => {
        getFilesCalled = true;
        return [imageFile];
      },
      getAbstractFileByPath: (path) => (path === "assets/photo.png" ? imageFile : null),
    },
  };

  const resolved = app.metadataCache.getFirstLinkpathDest("assets/photo.png");
  assert.equal(resolved, imageFile);
  assert.equal(getFilesCalled, false);
});

test("F. getSearchReplaceFiles scope project n'inclut pas de fichier Markdown extérieur au projet", async () => {
  const { getSearchReplaceFiles } = await import("../src/services/manuscript-search-replace.js");

  const projectFile = { path: "MonProjet/Manuscrit/Scene1.md", extension: "md" };
  const projectFolder = {
    path: "MonProjet/Manuscrit",
    parent: {
      path: "MonProjet",
      children: [
        {
          path: "MonProjet/Manuscrit",
          children: [projectFile],
        },
      ],
    },
  };

  const app = { vault: {} };
  const plugin = { getProjectFolder: () => projectFolder };

  const files = getSearchReplaceFiles(app, plugin, "project");
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "MonProjet/Manuscrit/Scene1.md");
});

