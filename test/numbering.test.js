import test from "node:test";
import assert from "node:assert/strict";
import { buildNumbering } from "../src/services/numbering.js";

test("buildNumbering : numérotation continue des scènes et chapitres continu", () => {
  const root = {
    name: "Manuscrit",
    path: "Manuscrit",
    children: [
      {
        name: "Partie 1",
        path: "Manuscrit/Partie 1",
        isFolder: true,
        children: [
          {
            name: "Chapitre 1",
            path: "Manuscrit/Partie 1/Chapitre 1",
            isFolder: true,
            children: [
              { name: "Scene 1.md", path: "Manuscrit/Partie 1/Chapitre 1/Scene 1.md" },
              { name: "Scene 2.md", path: "Manuscrit/Partie 1/Chapitre 1/Scene 2.md" },
            ],
          },
          {
            name: "Chapitre 2",
            path: "Manuscrit/Partie 1/Chapitre 2",
            isFolder: true,
            children: [
              { name: "Scene 3.md", path: "Manuscrit/Partie 1/Chapitre 2/Scene 3.md" },
            ],
          },
        ],
      },
    ],
  };

  const settings = {
    sceneNumbering: "continue",
    chapterNumbering: "continu",
  };

  const helpers = {
    getOrderedChildren: (node) => node.children || [],
    roleOfFolder: (node) => (node.name && node.name.startsWith("Partie") ? "partie" : "chapitre"),
    isFrontMatter: () => false,
  };

  const map = buildNumbering(settings, root, helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1"), "1.");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Scene 1.md"), "1");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Scene 2.md"), "2");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2"), "2.");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/Scene 3.md"), "3");
});

test("buildNumbering : numérotation par chapitre (1.1, 1.2, 2.1) et remise à zéro par partie", () => {
  const root = {
    name: "Manuscrit",
    path: "Manuscrit",
    children: [
      {
        name: "Partie 1",
        path: "Manuscrit/Partie 1",
        isFolder: true,
        children: [
          {
            name: "Chapitre A",
            path: "Manuscrit/Partie 1/Chapitre A",
            isFolder: true,
            children: [{ name: "S1.md", path: "Manuscrit/Partie 1/Chapitre A/S1.md" }],
          },
        ],
      },
      {
        name: "Partie 2",
        path: "Manuscrit/Partie 2",
        isFolder: true,
        children: [
          {
            name: "Chapitre B",
            path: "Manuscrit/Partie 2/Chapitre B",
            isFolder: true,
            children: [{ name: "S2.md", path: "Manuscrit/Partie 2/Chapitre B/S2.md" }],
          },
        ],
      },
    ],
  };

  const settings = {
    sceneNumbering: "hierarchique",
    chapterNumbering: "parPartie",
  };

  const helpers = {
    getOrderedChildren: (node) => node.children || [],
    roleOfFolder: (node) => (node.name && node.name.startsWith("Partie") ? "partie" : "chapitre"),
    isFrontMatter: () => false,
  };

  const map = buildNumbering(settings, root, helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre A"), "1.");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre A/S1.md"), "1.1");

  // Partie 2 remet le compteur de chapitre n à 1
  assert.equal(map.get("Manuscrit/Partie 2/Chapitre B"), "1.");
  assert.equal(map.get("Manuscrit/Partie 2/Chapitre B/S2.md"), "1.1");
});

test("buildNumbering : exclusion des dossiers et fichiers Front", () => {
  const root = {
    name: "Manuscrit",
    path: "Manuscrit",
    children: [
      {
        name: "Front",
        path: "Manuscrit/Front",
        isFolder: true,
        children: [{ name: "Titre.md", path: "Manuscrit/Front/Titre.md" }],
      },
      {
        name: "Chapitre 1",
        path: "Manuscrit/Chapitre 1",
        isFolder: true,
        children: [{ name: "Scene.md", path: "Manuscrit/Chapitre 1/Scene.md" }],
      },
    ],
  };

  const settings = {
    sceneNumbering: "continue",
    chapterNumbering: "continu",
  };

  const helpers = {
    getOrderedChildren: (node) => node.children || [],
    roleOfFolder: () => "chapitre",
    isFrontMatter: (node) => node.name === "Front",
  };

  const map = buildNumbering(settings, root, helpers);

  assert.equal(map.get("Manuscrit/Front"), "");
  assert.equal(map.get("Manuscrit/Front/Titre.md"), "");
  assert.equal(map.get("Manuscrit/Chapitre 1"), "1.");
  assert.equal(map.get("Manuscrit/Chapitre 1/Scene.md"), "1");
});

/* Arbre commun aux cas ci-dessous : une partie, deux chapitres, et une scène
   nichée dans un sous-dossier de chapitre (cas que la récursion walkScenes
   doit numéroter dans la suite de son chapitre, pas comme un chapitre). */
const arbre = () => ({
  name: "Manuscrit",
  path: "Manuscrit",
  children: [
    {
      name: "Partie 1",
      path: "Manuscrit/Partie 1",
      isFolder: true,
      children: [
        {
          name: "Chapitre 1",
          path: "Manuscrit/Partie 1/Chapitre 1",
          isFolder: true,
          children: [
            { name: "S1.md", path: "Manuscrit/Partie 1/Chapitre 1/S1.md" },
            {
              name: "Sous-dossier",
              path: "Manuscrit/Partie 1/Chapitre 1/Sous-dossier",
              isFolder: true,
              children: [{ name: "S2.md", path: "Manuscrit/Partie 1/Chapitre 1/Sous-dossier/S2.md" }],
            },
          ],
        },
        {
          name: "Chapitre 2",
          path: "Manuscrit/Partie 1/Chapitre 2",
          isFolder: true,
          children: [{ name: "S3.md", path: "Manuscrit/Partie 1/Chapitre 2/S3.md" }],
        },
      ],
    },
  ],
});

const helpers = {
  getOrderedChildren: (node) => node.children || [],
  roleOfFolder: (node) => (node.name && node.name.startsWith("Partie") ? "partie" : "chapitre"),
  isFrontMatter: () => false,
};

test("buildNumbering : une scène nichée poursuit la numérotation de son chapitre", () => {
  const map = buildNumbering({ sceneNumbering: "hier", chapterNumbering: "continu" }, arbre(), helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/S1.md"), "1.1");
  // nichée d'un niveau, mais toujours la scène 2 du chapitre 1
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Sous-dossier/S2.md"), "1.2");
  // le sous-dossier lui-même ne reçoit aucune étiquette
  assert.equal(map.has("Manuscrit/Partie 1/Chapitre 1/Sous-dossier"), false);
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/S3.md"), "2.1");
});

test("buildNumbering : sceneNumbering « aucune » vide les scènes, pas les chapitres", () => {
  const map = buildNumbering({ sceneNumbering: "aucune", chapterNumbering: "continu" }, arbre(), helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1"), "1.");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2"), "2.");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/S1.md"), "");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Sous-dossier/S2.md"), "");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/S3.md"), "");
});

test("buildNumbering : chapterNumbering « aucune » vide les chapitres et déhiérarchise les scènes", () => {
  const map = buildNumbering({ sceneNumbering: "hier", chapterNumbering: "aucune" }, arbre(), helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1"), "");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2"), "");
  // sans numéro de chapitre, la scène retombe sur son rang seul
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/S1.md"), "1");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Sous-dossier/S2.md"), "2");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/S3.md"), "1");
});

test("buildNumbering : « continue » numérote les scènes globalement, à travers les chapitres", () => {
  const map = buildNumbering({ sceneNumbering: "continue", chapterNumbering: "aucune" }, arbre(), helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/S1.md"), "1");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/Sous-dossier/S2.md"), "2");
  // le compteur global ignore le changement de chapitre
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/S3.md"), "3");
});

test("buildNumbering : un fichier hors chapitre compte comme un chapitre", () => {
  const root = {
    name: "Manuscrit",
    path: "Manuscrit",
    children: [
      { name: "Prologue.md", path: "Manuscrit/Prologue.md" },
      {
        name: "Chapitre 1",
        path: "Manuscrit/Chapitre 1",
        isFolder: true,
        children: [{ name: "S1.md", path: "Manuscrit/Chapitre 1/S1.md" }],
      },
    ],
  };

  const map = buildNumbering({ sceneNumbering: "hier", chapterNumbering: "continu" }, root, {
    ...helpers,
    roleOfFolder: () => "chapitre",
  });

  assert.equal(map.get("Manuscrit/Prologue.md"), "1.");
  assert.equal(map.get("Manuscrit/Chapitre 1"), "2.");
  assert.equal(map.get("Manuscrit/Chapitre 1/S1.md"), "2.1");
});

test("buildNumbering : sceneNumbering absent retombe sur le hiérarchique", () => {
  const map = buildNumbering({ chapterNumbering: "continu" }, arbre(), helpers);

  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 1/S1.md"), "1.1");
  assert.equal(map.get("Manuscrit/Partie 1/Chapitre 2/S3.md"), "2.1");
});
