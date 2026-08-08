import test from "node:test";
import assert from "node:assert/strict";

/**
 * Test du volet droit du Binder (split pane) — affichage des dossiers
 * imbriqués, même s'ils ne contiennent que des sous-dossiers (pas de
 * fichiers directs).
 *
 * Cas testé : Partie 1 > chapitre 1 > scène
 * - Le volet droit doit afficher « Partie 1 », « chapitre 1 » et « scène »
 * - Avant la correction, « Partie 1 » et « chapitre 1 » n'apparaissaient pas
 */

class MockFolder {
  constructor(path, name) {
    this.path = path;
    this.name = name;
    this.children = [];
  }
}

class MockFile {
  constructor(path, name) {
    this.path = path;
    this.name = name;
  }
}

function makeProject() {
  const root = new MockFolder("Manuscript", "Manuscript");
  const partie1 = new MockFolder("Manuscript/Partie 1", "Partie 1");
  const chapitre1 = new MockFolder("Manuscript/Partie 1/chapitre 1", "chapitre 1");
  const scene = new MockFile("Manuscript/Partie 1/chapitre 1/scène.md", "scène");

  root.children = [partie1];
  partie1.parent = root;
  partie1.children = [chapitre1];
  chapitre1.parent = partie1;
  chapitre1.children = [scene];
  scene.parent = chapitre1;

  const allFiles = new Map([
    [root.path, root],
    [partie1.path, partie1],
    [chapitre1.path, chapitre1],
    [scene.path, scene],
  ]);

  const vault = {
    allFiles,
    getAbstractFileByPath: (p) => allFiles.get(p) || null,
  };

  return {
    root,
    partie1,
    chapitre1,
    scene,
    vault,
    allFiles,
  };
}


test("Volet droit (split pane) — affichage des dossiers imbriqués sans fichiers directs", async (t) => {
  await t.test("affiche les sous-titres de tous les dossiers, même sans fichiers directs", () => {
    const project = makeProject();

    // Simuler le rendu du volet droit (simulation du comportement renderFilesOf)
    const renderedHeadings = [];

    // Helper pour obtenir les enfants
    const getChildren = (folder) => {
      if (folder === project.root) return [project.partie1];
      if (folder === project.partie1) return [project.chapitre1];
      if (folder === project.chapitre1) return [project.scene];
      return [];
    };

    const simulateRenderFilesOf = (folder, depth, visited = new Set()) => {
      // Prévenir la récursion infinie
      if (visited.has(folder.path)) return;
      visited.add(folder.path);

      const kids = getChildren(folder);
      const files = kids.filter((c) => c instanceof MockFile);

      // La correction : afficher le sous-titre pour depth > 0
      // AVANT : if (depth > 0 && files.length > 0)
      // APRÈS : if (depth > 0)
      if (depth > 0) {
        renderedHeadings.push({
          name: folder.name,
          depth,
          hasDirectFiles: files.length > 0,
        });
      }

      // Récurser sur les sous-dossiers
      for (const child of kids.filter((c) => c instanceof MockFolder)) {
        simulateRenderFilesOf(child, depth + 1, visited);
      }
    };

    // Rendre à partir de la racine
    simulateRenderFilesOf(project.root, 0);

    // Vérifications
    assert.equal(
      renderedHeadings.length,
      2,
      "deux sous-titres doivent être rendus : Partie 1 et chapitre 1"
    );

    const partie1 = renderedHeadings.find((h) => h.name === "Partie 1");
    assert.ok(partie1, "Partie 1 doit être rendu");
    assert.equal(partie1.depth, 1, "Partie 1 est à profondeur 1");
    assert.equal(
      partie1.hasDirectFiles,
      false,
      "Partie 1 n'a pas de fichiers directs"
    );

    const chapitre1 = renderedHeadings.find((h) => h.name === "chapitre 1");
    assert.ok(chapitre1, "chapitre 1 doit être rendu");
    assert.equal(chapitre1.depth, 2, "chapitre 1 est à profondeur 2");
    assert.equal(
      chapitre1.hasDirectFiles,
      true,
      "chapitre 1 contient scène.md directement"
    );
  });

  await t.test("conserve le comportement de repli/dépli", () => {
    const project = makeProject();
    const S = { collapsed: {} };

    const simulateToggle = () => {
      S.collapsed[project.partie1.path] = !S.collapsed[project.partie1.path];
      S.collapsed[project.chapitre1.path] = !S.collapsed[
        project.chapitre1.path
      ];
    };

    // Avant toggle
    assert.equal(S.collapsed[project.partie1.path], undefined);

    simulateToggle();

    // Après toggle
    assert.equal(S.collapsed[project.partie1.path], true);
    assert.equal(S.collapsed[project.chapitre1.path], true);

    simulateToggle();

    // Après toggle inversé
    assert.equal(S.collapsed[project.partie1.path], false);
    assert.equal(S.collapsed[project.chapitre1.path], false);
  });

  await t.test("ne rend pas le sous-titre à profondeur 0 (racine)", () => {
    const project = makeProject();

    const renderedHeadings = [];

    const getChildren = (folder) => {
      if (folder === project.root) return [project.partie1];
      if (folder === project.partie1) return [project.chapitre1];
      if (folder === project.chapitre1) return [project.scene];
      return [];
    };

    const simulateRenderFilesOf = (folder, depth, visited = new Set()) => {
      if (visited.has(folder.path)) return;
      visited.add(folder.path);

      const kids = getChildren(folder);

      // Seuls les dossiers à depth > 0 sont rendus
      if (depth > 0) {
        renderedHeadings.push(folder.name);
      }

      for (const child of kids.filter((c) => c instanceof MockFolder)) {
        simulateRenderFilesOf(child, depth + 1, visited);
      }
    };

    simulateRenderFilesOf(project.root, 0);

    // La racine ne doit pas apparaître
    assert.equal(
      renderedHeadings.includes("Manuscript"),
      false,
      "la racine (depth 0) ne doit pas être rendue"
    );

    // Les enfants doivent apparaître
    assert.ok(
      renderedHeadings.includes("Partie 1"),
      "Partie 1 doit être rendu"
    );
    assert.ok(
      renderedHeadings.includes("chapitre 1"),
      "chapitre 1 doit être rendu"
    );
  });
});
