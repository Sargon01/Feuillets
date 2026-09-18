import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { isResearchFile, isResearchAttachment, researchFileIcon } from "../src/services/research.js";
import { uniqueFileName } from "../src/services/canvas-bridge.js";
import {
  createResearchCanvas,
  createResearchBase,
  minimalBaseFileContent,
  isExcalidrawActive,
  delegateNewExcalidrawDrawing,
  EXCALIDRAW_PLUGIN_ID,
} from "../src/services/research-create.js";
import { t } from "../src/i18n/index.js";

/* Simule l'enregistrement RÉEL d'Excalidraw sur "file-menu" (voir
   CommandManager.ts du greffon, `fileMenuHandlerCreateNew`) : un item
   titré EXACTEMENT "New drawing", jamais filtré par type de fichier — le
   dossier cible est capturé par SA PROPRE fermeture sur `file`, jamais
   passé en argument au callback (signature réelle : `(evt) => …`).
   `title` permet de simuler un autre greffon (titre différent) ou son
   absence (onCreate jamais appelé). */
function fakeAppWithExcalidrawFileMenu(onCreate, title = "New drawing") {
  const calls = [];
  return {
    calls,
    app: {
      workspace: {
        trigger: (name, menu, file, source) => {
          calls.push([name, menu, file, source]);
          if (name === "file-menu" && title) {
            menu.addItem((item) => {
              item
                .setTitle(title)
                .setIcon("excalidraw-icon")
                .onClick((evt) => onCreate(evt, file));
            });
          }
        },
      },
    },
  };
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

/* ===== non-régression : types de pièces jointes Recherche déjà supportés ===== */

test("isResearchFile/isResearchAttachment : pdf, docx, odt, epub, tableur, présentation, image restent reconnus", () => {
  const cases = [
    ["Source.pdf", true, true],
    ["Source.docx", true, true],
    ["Source.odt", true, true],
    ["Livre.epub", true, true],
    ["Tableau.xlsx", true, true],
    ["Diapo.pptx", true, true],
    ["Photo.png", true, true],
    ["Fiche.md", true, false],
  ];
  for (const [name, expectedFile, expectedAttachment] of cases) {
    const f = new TFile(`Recherche/${name}`);
    assert.equal(isResearchFile(f), expectedFile, name);
    assert.equal(isResearchAttachment(f), expectedAttachment, name);
  }
});

test("Un fichier .excalidraw.md reste reconnu comme une fiche Markdown ordinaire (extension \"md\"), comportement d'ouverture inchangé", () => {
  const f = new TFile("Recherche/Croquis.excalidraw.md");
  assert.equal(f.extension, "md");
  assert.equal(isResearchFile(f), true);
  assert.equal(isResearchAttachment(f), false);
});

/* ===== visibilité et ouverture native de .canvas et .base ===== */

test("isResearchFile/isResearchAttachment/researchFileIcon reconnaissent .canvas et .base", () => {
  const canvas = new TFile("Recherche/Tableau.canvas");
  const base = new TFile("Recherche/Vue.base");
  assert.equal(isResearchFile(canvas), true);
  assert.equal(isResearchAttachment(canvas), true);
  assert.equal(researchFileIcon(canvas), "layout-dashboard");
  assert.equal(isResearchFile(base), true);
  assert.equal(isResearchAttachment(base), true);
  assert.equal(researchFileIcon(base), "database");
});

/* ===== Canvas : JSON valide + collision ===== */

test("createResearchCanvas : dépose un Canvas JSON valide et vide, numérote les collisions", async () => {
  const root = folder("Recherche");
  const { vault } = createFakeVault([root]);
  const app = { vault };

  const first = await createResearchCanvas(app, root);
  assert.equal(first.path, "Recherche/Canvas.canvas");
  const parsed = JSON.parse(first.content);
  assert.deepEqual(parsed, { nodes: [], edges: [] });

  const second = await createResearchCanvas(app, root);
  assert.equal(second.path, "Recherche/Canvas 2.canvas");
  assert.deepEqual(JSON.parse(second.content), { nodes: [], edges: [] });
});

/* ===== Base : YAML valide filtré sur le dossier cible + collision ===== */

test("minimalBaseFileContent : filtre sur le dossier cible avec une vue table minimale", () => {
  const yaml = minimalBaseFileContent("Recherche/Personnages");
  assert.match(yaml, /^filters:\n  and:\n {4}- file\.inFolder\("Recherche\/Personnages"\)\n/);
  assert.match(yaml, /views:\n {2}- type: table\n {4}name: Table\n {4}order:\n {6}- file\.name\n/);
});

test("minimalBaseFileContent : échappe les guillemets d'un chemin de dossier", () => {
  const yaml = minimalBaseFileContent('Recherche/Dossier "spécial"');
  assert.match(yaml, /file\.inFolder\("Recherche\/Dossier \\"spécial\\""\)/);
});

test("createResearchBase : dépose un fichier .base filtré sur le dossier cible, numérote les collisions", async () => {
  const root = folder("Recherche/Lieux");
  const { vault } = createFakeVault([root]);
  const app = { vault };

  const first = await createResearchBase(app, root);
  assert.equal(first.path, "Recherche/Lieux/Base.base");
  assert.match(first.content, /file\.inFolder\("Recherche\/Lieux"\)/);
  assert.match(first.content, /type: table/);

  const second = await createResearchBase(app, root);
  assert.equal(second.path, "Recherche/Lieux/Base 2.base");
});

/* ===== uniqueFileName généralisé (extension) ===== */

test("uniqueFileName : garde \"md\" par défaut (non-régression) et accepte une extension explicite", () => {
  const taken = new Set(["Projet/Idées/Titre.md"]);
  const mdPath = uniqueFileName((p) => taken.has(p), "Projet/Idées", "Titre");
  assert.equal(mdPath, "Projet/Idées/Titre 2.md");

  const canvasPath = uniqueFileName(() => false, "Recherche", "Carte", "canvas");
  assert.equal(canvasPath, "Recherche/Carte.canvas");
});

/* ===== présence conditionnelle d'Excalidraw ===== */

test("isExcalidrawActive : vrai seulement si le greffon est installé ET activé", () => {
  assert.equal(isExcalidrawActive({}), false);
  assert.equal(isExcalidrawActive({ plugins: {} }), false);
  assert.equal(isExcalidrawActive({ plugins: { enabledPlugins: new Set() } }), false);
  assert.equal(isExcalidrawActive({ plugins: { enabledPlugins: new Set(["autre-plugin"]) } }), false);
  assert.equal(isExcalidrawActive({ plugins: { enabledPlugins: new Set([EXCALIDRAW_PLUGIN_ID]) } }), true);
});

test("delegateNewExcalidrawDrawing : exécute directement le callback \"New drawing\" ciblé sur le bon dossier, sans jamais afficher de menu", () => {
  const root = folder("Recherche/Personnages");
  const created = [];
  const { app, calls } = fakeAppWithExcalidrawFileMenu((evt, targetFolder) => {
    created.push({ evt, targetFolder });
  });
  Menu.lastShown = null;
  const originalAddItem = Menu.prototype.addItem;
  const evt = { type: "click" };

  delegateNewExcalidrawDrawing(app, root, evt);

  // "file-menu" bien déclenché sur le dossier ciblé, jamais un identifiant de commande.
  assert.equal(calls.length, 1);
  const [name, menu, file, source] = calls[0];
  assert.equal(name, "file-menu");
  assert.ok(menu instanceof Menu);
  assert.equal(file, root);
  assert.equal(source, "file-explorer-context-menu");

  // Le callback "New drawing" a bien tourné, avec le dossier ciblé capturé
  // par SA PROPRE fermeture (jamais reconstruit par ce module).
  assert.equal(created.length, 1);
  assert.equal(created[0].evt, evt);
  assert.equal(created[0].targetFolder, root);

  // Aucune méthode d'affichage du menu n'a jamais été appelée : pas de
  // menu contextuel intermédiaire, aucun effet visuel.
  assert.equal(Menu.lastShown, null);
  assert.equal(menu.event, undefined);
  assert.equal(menu.position, undefined);

  // Le prototype Menu.addItem est restauré après coup, pour ne pas
  // contaminer un menu construit ailleurs.
  assert.equal(Menu.prototype.addItem, originalAddItem);
});

test("delegateNewExcalidrawDrawing : un autre item (titre différent) n'est jamais confondu avec « New drawing »", () => {
  const root = folder("Recherche");
  const created = [];
  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { app } = fakeAppWithExcalidrawFileMenu((evt, targetFolder) => { created.push({ evt, targetFolder }); }, "Some other plugin item");
    delegateNewExcalidrawDrawing(app, root, { type: "click" });

    assert.equal(created.length, 0, "un item d'un autre greffon ne doit jamais être exécuté à la place");
    assert.equal(notices.length, 1);
    assert.equal(notices[0], t("main.notice.excalidrawDrawingUnavailable"));
    assert.equal(Menu.lastShown, null);
  } finally {
    Notice.onCreate = previousOnCreate;
  }
});

test("delegateNewExcalidrawDrawing : Excalidraw absent (aucun item ajouté) -> Notice claire, rien n'est créé, jamais de menu affiché", () => {
  const root = folder("Recherche");
  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    const app = { workspace: { trigger: () => {} } };
    delegateNewExcalidrawDrawing(app, root, { type: "click" });

    assert.equal(notices.length, 1);
    assert.equal(notices[0], t("main.notice.excalidrawDrawingUnavailable"));
    assert.equal(Menu.lastShown, null);
  } finally {
    Notice.onCreate = previousOnCreate;
  }
});
