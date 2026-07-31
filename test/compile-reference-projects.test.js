import test from "node:test";
import assert from "node:assert/strict";
import { Notice, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, listCompiledFilePaths } from "../src/services/compile-export.js";

/* Petits projets de référence (voir le chantier « Compilation professionnelle
 * — Lot 1 ») : construits à la main, comme le reste de compile-export.test.js,
 * mais factorisés ici pour couvrir rapidement plusieurs formes de structure
 * sans répéter 15 lignes de câblage TFolder/TFile à chaque cas. */

function frontmatterBlock(fm, eol = "\n") {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---${eol}${lines.join(eol)}${eol}---${eol}`;
}

/** Construit un arbre TFolder/TFile à partir d'une spec imbriquée :
 *  `{ children: { "Nom": node, ... } }` pour un dossier,
 *  `{ file: { frontmatter, body, eol } }` pour un fichier. */
function buildProject(rootPath, structure) {
  const entries = [];
  const fmByPath = new Map();

  function build(path, node, parent) {
    if (node.file) {
      const fm = node.file.frontmatter || {};
      const raw = frontmatterBlock(fm, node.file.eol || "\n") + (node.file.body ?? "");
      const file = new TFile(path, raw);
      file.parent = parent;
      entries.push(file);
      fmByPath.set(path, fm);
      return file;
    }
    const folder = new TFolder(path, []);
    folder.parent = parent;
    entries.push(folder);
    for (const [name, child] of Object.entries(node.children || {})) {
      folder.children.push(build(`${path}/${name}`, child, folder));
    }
    return folder;
  }

  const root = build(rootPath, structure, null);
  const { vault } = createFakeVault(entries);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: fmByPath.get(file.path) || {} }) },
  };
  return { app, root, entries };
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "Projet/Manuscrit",
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    ...overrides,
  };
}

test("projet vide : compile() renvoie null et prévient, sans planter", async () => {
  const { app } = buildProject("Projet/Manuscrit", { children: {} });
  const notices = [];
  Notice.onCreate = (m) => notices.push(m);
  try {
    const result = await compile(app, baseSettings());
    assert.equal(result, null);
    assert.ok(notices.some((n) => /Aucun feuillet/.test(n)));
  } finally {
    Notice.onCreate = null;
  }
});

test("une seule scène : compilée seule, un segment", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: { "Scène.md": { file: { frontmatter: { title: "Unique" }, body: "Texte." } } },
  });
  const result = await compile(app, baseSettings());
  assert.ok(result);
  assert.equal(result.segments.length, 1);
  assert.match(result.manuscript, /Texte\./);
});

test("plusieurs parties et chapitres : tous les fichiers sélectionnés sont compilés, aucun oublié", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Partie 1": {
        children: {
          "Chapitre 1": {
            children: {
              "Scène 1.md": { file: { frontmatter: { title: "P1C1S1" }, body: "Texte A." } },
              "Scène 2.md": { file: { frontmatter: { title: "P1C1S2" }, body: "Texte B." } },
            },
          },
          "Chapitre 2": {
            children: { "Scène 1.md": { file: { frontmatter: { title: "P1C2S1" }, body: "Texte C." } } },
          },
        },
      },
      "Partie 2": {
        children: {
          "Chapitre 3": {
            children: { "Scène 1.md": { file: { frontmatter: { title: "P2C3S1" }, body: "Texte D." } } },
          },
        },
      },
    },
  });
  const result = await compile(app, baseSettings({ level1Role: "parties" }));
  assert.ok(result);
  const paths = result.segments.map((s) => s.path).filter(Boolean);
  assert.equal(paths.length, 4);
  assert.deepEqual(new Set(paths).size, 4, "aucun doublon");
  for (const t of ["Texte A.", "Texte B.", "Texte C.", "Texte D."]) {
    assert.match(result.manuscript, new RegExp(t));
  }
  // Même liste que le calcul indépendant listCompiledFilePaths (deux façons
  // de compter le même projet ne doivent jamais diverger).
  const settings = baseSettings({ level1Role: "parties" });
  assert.deepEqual(new Set(listCompiledFilePaths(app, settings)), new Set(paths));
});

test("sélection partielle (compile: false) : les fichiers désélectionnés sont exclus, les autres non oubliés", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène 1.md": { file: { frontmatter: { title: "Un", compile: true }, body: "Inclus un." } },
      "Scène 2.md": { file: { frontmatter: { title: "Deux", compile: false }, body: "Exclu." } },
      "Scène 3.md": { file: { frontmatter: { title: "Trois", compile: true }, body: "Inclus trois." } },
    },
  });
  const result = await compile(app, baseSettings());
  assert.ok(result);
  assert.equal(result.segments.length, 2);
  assert.match(result.manuscript, /Inclus un\./);
  assert.match(result.manuscript, /Inclus trois\./);
  assert.doesNotMatch(result.manuscript, /Exclu\./);
});

test("ordre personnalisé : l'ordre du Binder (settings.orders) est respecté, pas l'ordre alphabétique", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Zebre.md": { file: { frontmatter: { title: "Zebre" }, body: "PREMIER." } },
      "Alpha.md": { file: { frontmatter: { title: "Alpha" }, body: "SECOND." } },
    },
  });
  // Alphabétiquement, "Alpha" viendrait avant "Zebre" — l'ordre explicite
  // du Binder doit primer.
  const result = await compile(app, baseSettings({ orders: { "Projet/Manuscrit": ["Zebre.md", "Alpha.md"] } }));
  assert.ok(result);
  const first = result.manuscript.indexOf("PREMIER.");
  const second = result.manuscript.indexOf("SECOND.");
  assert.ok(first >= 0 && second >= 0 && first < second);
});

test("deux scènes de même titre mais de chemins différents restent distinctes", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Chapitre 1": {
        children: { "Scène.md": { file: { frontmatter: { title: "Même titre" }, body: "Contenu du premier." } } },
      },
      "Chapitre 2": {
        children: { "Scène.md": { file: { frontmatter: { title: "Même titre" }, body: "Contenu du second." } } },
      },
    },
  });
  const result = await compile(app, baseSettings());
  assert.ok(result);
  const paths = result.segments.map((s) => s.path).filter(Boolean);
  assert.deepEqual(paths, ["Projet/Manuscrit/Chapitre 1/Scène.md", "Projet/Manuscrit/Chapitre 2/Scène.md"]);
  assert.match(result.manuscript, /Contenu du premier\./);
  assert.match(result.manuscript, /Contenu du second\./);
});

test("images (embeds) : la syntaxe est conservée telle quelle dans le texte compilé", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène.md": {
        file: { frontmatter: { title: "Avec image" }, body: "Avant.\n\n![[illustration.png]]\n\nAprès." },
      },
    },
  });
  const result = await compile(app, baseSettings());
  assert.match(result.manuscript, /!\[\[illustration\.png\]\]/);
});

test("liens internes et externes : wikilien converti en texte lisible, lien Markdown externe conservé", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène.md": {
        file: {
          frontmatter: { title: "Avec liens" },
          body: "Voir [[Personnages/Jean|Jean]] et [ce site](https://exemple.test).",
        },
      },
    },
  });
  const result = await compile(app, baseSettings());
  assert.match(result.manuscript, /Voir Jean et/);
  assert.match(result.manuscript, /\[ce site\]\(https:\/\/exemple\.test\)/);
  assert.doesNotMatch(result.manuscript, /\[\[/);
});

test("trois notes de bas de page dans une seule scène : toutes présentes, appels et définitions appariés", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène.md": {
        file: {
          frontmatter: { title: "Notes" },
          body:
            "Premier fait[^1], puis un second[^2], et un troisième[^3].\n\n" +
            "[^1]: Source un.\n[^2]: Source deux.\n[^3]: Source trois.",
        },
      },
    },
  });
  const result = await compile(app, baseSettings());
  for (const n of [1, 2, 3]) {
    assert.match(result.manuscript, new RegExp(`\\[\\^${n}\\]`));
  }
  assert.match(result.manuscript, /Source un\./);
  assert.match(result.manuscript, /Source deux\./);
  assert.match(result.manuscript, /Source trois\./);
  const defs = result.manuscript.match(/^\[\^\d+\]:/gm) || [];
  assert.equal(defs.length, 3, "trois définitions, jamais fusionnées ni dupliquées");
});

test("caractères français et Unicode : préservés intégralement dans le texte compilé", async () => {
  const body = "Élise déjeuna à Noël. « Ça alors ! » s'écria-t-elle. 日本語のテスト 🎉 — café, hôtel, cœur.";
  const { app } = buildProject("Projet/Manuscrit", {
    children: { "Scène.md": { file: { frontmatter: { title: "Unicode" }, body } } },
  });
  const result = await compile(app, baseSettings());
  assert.match(result.manuscript, /Élise déjeuna à Noël/);
  assert.match(result.manuscript, /日本語のテスト/);
  assert.match(result.manuscript, /🎉/);
  assert.match(result.manuscript, /café, hôtel, cœur/);
});

test("frontmatter aux fins de ligne Windows (CRLF) : exclu du texte compilé comme en LF", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène.md": {
        file: { frontmatter: { title: "CRLF", secret: "ne-doit-jamais-apparaitre" }, body: "Corps réel.", eol: "\r\n" },
      },
    },
  });
  const result = await compile(app, baseSettings());
  assert.match(result.manuscript, /Corps réel\./);
  assert.doesNotMatch(result.manuscript, /ne-doit-jamais-apparaitre/);
  assert.doesNotMatch(result.manuscript, /secret:/);
});

test("fichier illisible : la compilation s'arrête avec un message nommant CE fichier, pas tout le projet", async () => {
  const { app } = buildProject("Projet/Manuscrit", {
    children: {
      "Scène OK.md": { file: { frontmatter: { title: "OK" }, body: "Texte lisible." } },
      "Scène cassée.md": { file: { frontmatter: { title: "Cassée" }, body: "Texte." } },
    },
  });
  const brokenPath = "Projet/Manuscrit/Scène cassée.md";
  const originalRead = app.vault.cachedRead;
  app.vault.cachedRead = async (file) => {
    if (file.path === brokenPath) throw new Error("EACCES");
    return originalRead(file);
  };
  const notices = [];
  Notice.onCreate = (m) => notices.push(m);
  try {
    const result = await compile(app, baseSettings());
    assert.equal(result, null, "la compilation s'arrête, elle ne produit pas un manuscrit amputé en silence");
    assert.equal(notices.length, 1);
    // Le message nomme LE fichier en cause, pas juste "échec".
    assert.match(notices[0], /Scène cassée\.md/);
    assert.doesNotMatch(notices[0].toLowerCase(), /^échec/);
  } finally {
    Notice.onCreate = null;
  }
});

test("aucune modification des fichiers sources sur l'ensemble d'un projet à plusieurs fichiers", async () => {
  const { app, entries } = buildProject("Projet/Manuscrit", {
    children: {
      "Chapitre 1": {
        children: {
          "Scène 1.md": { file: { frontmatter: { title: "A" }, body: "Un fait[^1].\n\n[^1]: Source." } },
        },
      },
      "Chapitre 2": {
        children: {
          "Scène 1.md": { file: { frontmatter: { title: "B" }, body: "![[img.png]] et [[Alias|texte]]." } },
        },
      },
    },
  });
  const sourceFiles = entries.filter((e) => e instanceof TFile);
  const originalContents = new Map(sourceFiles.map((f) => [f.path, f.content]));

  await compile(app, baseSettings());

  for (const f of sourceFiles) {
    assert.equal(f.content, originalContents.get(f.path), `${f.path} ne doit jamais être modifié par compile()`);
  }
});
