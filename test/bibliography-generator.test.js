import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  bibliographyEntries,
  bibliographyReferenceCount,
  generateBibliography,
} from "../src/services/bibliography-generator.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* ------------------------------- generateBibliography --------------------- */

test("generateBibliography : format Auteur. *Titre*. Éditeur, Date. avec tous les champs", () => {
  const text = generateBibliography([
    { author: "Victor Hugo", title: "Les Misérables", publisher: "Gallimard", date: "1862" },
  ]);
  assert.equal(text, "# Bibliographie\n\nVictor Hugo. *Les Misérables*. Gallimard, 1862.\n");
});

test("generateBibliography : URL à la fin si présente", () => {
  const text = generateBibliography([
    { author: "A. Camus", title: "L'Étranger", url: "https://example.org/etranger" },
  ]);
  assert.equal(text, "# Bibliographie\n\nA. Camus. *L'Étranger*. https://example.org/etranger\n");
});

test("generateBibliography : champs manquants — jamais de ponctuation cassée", () => {
  // Ni auteur ni éditeur ni date : juste le titre.
  assert.equal(generateBibliography([{ title: "Sans auteur" }]), "# Bibliographie\n\n*Sans auteur*.\n");
  // Ni titre ni éditeur : juste l'auteur.
  assert.equal(generateBibliography([{ author: "Anonyme" }]), "# Bibliographie\n\nAnonyme.\n");
  // Éditeur seul, sans date : pas de virgule flottante.
  assert.equal(
    generateBibliography([{ author: "X", title: "Y", publisher: "Seuil" }]),
    "# Bibliographie\n\nX. *Y*. Seuil.\n"
  );
  // Date seule, sans éditeur : pas de virgule en tête.
  assert.equal(
    generateBibliography([{ author: "X", title: "Y", date: "2020" }]),
    "# Bibliographie\n\nX. *Y*. 2020.\n"
  );
});

test("generateBibliography : tri alphabétique par auteur", () => {
  const text = generateBibliography([
    { author: "Zola", title: "Germinal" },
    { author: "Balzac", title: "Eugénie Grandet" },
    { author: "Camus", title: "La Peste" },
  ]);
  const order = text.split("\n\n").slice(1).map((l) => l.split(".")[0]);
  assert.deepEqual(order, ["Balzac", "Camus", "Zola"]);
});

test("generateBibliography : auteur absent -> tri par titre, à sa place alphabétique", () => {
  const entries = [
    { author: "Zola", title: "Germinal" },
    { title: "Anthologie sans auteur" },
    { author: "Balzac", title: "Eugénie Grandet" },
  ];
  const text = generateBibliography(entries);
  const lines = text.split("\n\n").slice(1);
  // "Anthologie…" (par titre) doit se classer avant "Balzac" et "Zola".
  assert.ok(lines[0].startsWith("*Anthologie"));
  assert.ok(lines[1].startsWith("Balzac"));
  assert.ok(lines[2].startsWith("Zola"));
});

test("generateBibliography : déduplique les références EXACTEMENT identiques", () => {
  const text = generateBibliography([
    { author: "Hugo", title: "Les Misérables", publisher: "Gallimard", date: "1862" },
    { author: "Hugo", title: "Les Misérables", publisher: "Gallimard", date: "1862" },
  ]);
  assert.equal(text, "# Bibliographie\n\nHugo. *Les Misérables*. Gallimard, 1862.\n");
});

test("generateBibliography : deux entrées presque identiques mais pas EXACTEMENT (édition différente) restent distinctes", () => {
  const text = generateBibliography([
    { author: "Hugo", title: "Les Misérables", publisher: "Gallimard", date: "1862" },
    { author: "Hugo", title: "Les Misérables", publisher: "Le Seuil", date: "1862" },
  ]);
  assert.match(text, /Gallimard/);
  assert.match(text, /Le Seuil/);
});

test("generateBibliography : aucune référence -> null, jamais de page vide", () => {
  assert.equal(generateBibliography([]), null);
  // Fiche vide (aucun champ exploitable) : ne compte pas comme référence.
  assert.equal(generateBibliography([{}]), null);
});

test("bibliographyReferenceCount : compte après déduplication", () => {
  const entries = [
    { author: "Hugo", title: "Les Misérables" },
    { author: "Hugo", title: "Les Misérables" },
    { author: "Camus", title: "La Peste" },
  ];
  assert.equal(bibliographyReferenceCount(entries), 2);
});

test("bibliographyReferenceCount : 0 pour une liste vide ou sans champ exploitable", () => {
  assert.equal(bibliographyReferenceCount([]), 0);
  assert.equal(bibliographyReferenceCount([{}]), 0);
});

/* ------------------------------- bibliographyEntries ----------------------- */

/** `getResearchRoot()` (services/research.ts) reconnaît `_Recherche` comme
 * FRÈRE de Manuscrit (jamais dedans) : le dossier projet doit donc avoir un
 * vrai parent (le volume), comme dans un coffre réel. */
function buildResearchFixture(folderName) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Recherche");
  const biblio = new TFolder(`Projet/_Recherche/${folderName}`);
  const entry1 = new TFile(
    `Projet/_Recherche/${folderName}/Hugo.md`,
    "---\ntitle: Les Misérables\nauthor: Victor Hugo\npublisher: Gallimard\ndate: 1862\nsynopsis: Un classique\ntags:\n  - bibliographie\n---\n"
  );
  const entry2 = new TFile(
    `Projet/_Recherche/${folderName}/Camus.md`,
    "---\ntitle: La Peste\nauthor: Albert Camus\ndate: 1947\n---\n"
  );
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  research.children = [biblio];
  biblio.children = [entry1, entry2];
  biblio.parent = research;
  entry1.parent = biblio;
  entry2.parent = biblio;

  const { vault } = createFakeVault([volume, manuscript, research, biblio, entry1, entry2]);
  const frontmatter = new Map([
    [entry1.path, {
      title: "Les Misérables", author: "Victor Hugo", publisher: "Gallimard", date: "1862",
      synopsis: "Un classique", tags: ["bibliographie"],
    }],
    [entry2.path, { title: "La Peste", author: "Albert Camus", date: "1947" }],
  ]);
  const app = {
    vault,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
  };
  const settings = { projectFolder: manuscript.path };
  return { app, settings, project: manuscript, entry1, entry2 };
}

test("bibliographyEntries : reconnaît le dossier Bibliographie (FR)", () => {
  const { app, settings } = buildResearchFixture("Bibliographie");
  const entries = bibliographyEntries(app, settings);
  assert.equal(entries.length, 2);
});

test("bibliographyEntries : reconnaît le dossier Bibliography (EN)", () => {
  const { app, settings } = buildResearchFixture("Bibliography");
  const entries = bibliographyEntries(app, settings);
  assert.equal(entries.length, 2);
});

test("bibliographyEntries : lit author/title/publisher/date/url du frontmatter existant, ignore synopsis/tags", () => {
  const { app, settings } = buildResearchFixture("Bibliographie");
  const entries = bibliographyEntries(app, settings);
  const hugo = entries.find((e) => e.author === "Victor Hugo");
  assert.equal(hugo.title, "Les Misérables");
  assert.equal(hugo.publisher, "Gallimard");
  assert.equal(hugo.date, "1862");
  assert.equal(hugo.url, undefined);
  // Aucun champ synopsis/tags ne fuit dans l'entrée.
  assert.equal("synopsis" in hugo, false);
  assert.equal("tags" in hugo, false);
});

test("bibliographyEntries : url lue quand présente sur la fiche", () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Recherche");
  const biblio = new TFolder("Projet/_Recherche/Bibliographie");
  const entry = new TFile("Projet/_Recherche/Bibliographie/Source web.md", "---\ntitle: Article\nauthor: X\nurl: https://example.org\n---\n");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  research.children = [biblio];
  biblio.children = [entry];
  biblio.parent = research;
  entry.parent = biblio;
  const { vault } = createFakeVault([volume, manuscript, research, biblio, entry]);
  const frontmatter = new Map([[entry.path, { title: "Article", author: "X", url: "https://example.org" }]]);
  const app = { vault, metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) } };
  const settings = { projectFolder: manuscript.path };

  const entries = bibliographyEntries(app, settings);
  assert.equal(entries[0].url, "https://example.org");
});

test("bibliographyEntries : aucun dossier Bibliographie/Bibliography -> liste vide", () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Recherche");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  const { vault } = createFakeVault([volume, manuscript, research]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path };

  assert.deepEqual(bibliographyEntries(app, settings), []);
});

test("bibliographyEntries : aucun dossier projet -> liste vide, sans lever", () => {
  const { vault } = createFakeVault([]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: "Inexistant" };

  assert.deepEqual(bibliographyEntries(app, settings), []);
});

test("bibliographyEntries -> generateBibliography : intégration bout en bout, triée par auteur", () => {
  const { app, settings } = buildResearchFixture("Bibliographie");
  const text = generateBibliography(bibliographyEntries(app, settings));
  assert.equal(
    text,
    "# Bibliographie\n\nAlbert Camus. *La Peste*. 1947.\n\nVictor Hugo. *Les Misérables*. Gallimard, 1862.\n"
  );
});

/* ------------------------- Phase 7 : Sources canonique --------------------- */

/** Fixture Sources : deux fiches, l'une citée (`cite_count > 0`), l'autre
 * pas, plus optionnellement un dossier Bibliographie legacy à côté — pour
 * vérifier la priorité de Sources quand les deux existent. */
function buildSourcesFixture({ withLegacyBibliographie = false } = {}) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Recherche");
  const sources = new TFolder("Projet/_Recherche/Sources");
  const cited = new TFile(
    "Projet/_Recherche/Sources/Hugo.md",
    "---\ntitle: Les Misérables\nauthor: Victor Hugo\ncite_count: 2\n---\n"
  );
  const uncited = new TFile(
    "Projet/_Recherche/Sources/Camus.md",
    "---\ntitle: La Peste\nauthor: Albert Camus\n---\n"
  );
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  research.children = [sources];
  sources.children = [cited, uncited];
  sources.parent = research;
  cited.parent = sources;
  uncited.parent = sources;

  const allFiles = [volume, manuscript, research, sources, cited, uncited];
  const frontmatter = new Map([
    [cited.path, { title: "Les Misérables", author: "Victor Hugo", cite_count: 2 }],
    [uncited.path, { title: "La Peste", author: "Albert Camus" }],
  ]);

  if (withLegacyBibliographie) {
    const biblio = new TFolder("Projet/_Recherche/Bibliographie");
    const legacyEntry = new TFile(
      "Projet/_Recherche/Bibliographie/Legacy.md",
      "---\ntitle: Ancien titre\nauthor: Ancien Auteur\n---\n"
    );
    research.children.push(biblio);
    biblio.children = [legacyEntry];
    biblio.parent = research;
    legacyEntry.parent = biblio;
    allFiles.push(biblio, legacyEntry);
    frontmatter.set(legacyEntry.path, { title: "Ancien titre", author: "Ancien Auteur" });
  }

  const { vault } = createFakeVault(allFiles);
  const app = {
    vault,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
  };
  const settings = { projectFolder: manuscript.path };
  return { app, settings };
}

test("bibliographyEntries : Sources canonique — une fiche avec cite_count=0 (absent) est exclue", () => {
  const { app, settings } = buildSourcesFixture();
  const entries = bibliographyEntries(app, settings);
  assert.equal(entries.some((e) => e.author === "Albert Camus"), false);
});

test("bibliographyEntries : Sources canonique — une fiche avec cite_count>0 est incluse", () => {
  const { app, settings } = buildSourcesFixture();
  const entries = bibliographyEntries(app, settings);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].author, "Victor Hugo");
});

test("bibliographyEntries : Sources est prioritaire sur Bibliographie legacy quand les deux existent — jamais de fusion", () => {
  const { app, settings } = buildSourcesFixture({ withLegacyBibliographie: true });
  const entries = bibliographyEntries(app, settings);
  // Seule la fiche Sources citée apparaît ; la fiche legacy (sans cite_count,
  // dans un dossier différent) n'est jamais mélangée.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].author, "Victor Hugo");
  assert.equal(entries.some((e) => e.author === "Ancien Auteur"), false);
});

test("bibliographyEntries : repli Bibliographie legacy quand Sources n'existe pas — fiche sans cite_count incluse quand même", () => {
  const { app, settings } = buildResearchFixture("Bibliographie");
  const entries = bibliographyEntries(app, settings);
  // Comportement historique préservé : les deux fiches de la fixture legacy
  // (aucune n'a de cite_count) comptent toutes les deux.
  assert.equal(entries.length, 2);
});
