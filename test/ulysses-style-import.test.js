import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { parseUlyssesStyle, importUlyssesStyle } from "../src/services/ulysses-style-import.js";
import { loadCustomTemplates } from "../src/services/export-templates-custom.js";

const SAMPLE_ULSS = `
document-settings:
  page-inset-top: 25mm
  page-inset-bottom: 25mm
  page-inset-inner: 30mm
  page-inset-outer: 35mm
  page-orientation: portrait
  column-count: 1
  column-spacing-width: 12pt
  page-size: A4

paragraph:
  font-family: Baskerville
  font-size: 14pt
  line-height: 1.71
  text-alignment: justified
  first-line-indent: 1.5cm
  margin-bottom: 0pt
  hyphenation: false
  text-color: "#222222"

heading-1:
  font-size: 52pt
  text-alignment: center
  font-weight: bold
  font-style: normal
  margin-top: 72pt
  margin-bottom: 72pt
  page-break: before

heading-2:
  font-size: 24pt
  text-alignment: left
  font-weight: regular
  font-style: italic
  margin-top: 24pt
  margin-bottom: 12pt
  page-break: auto

paragraph-divider:
  content: "* * *"
  alignment: center
`;

/* -------------------------- parseUlyssesStyle ----------------------------- */

test("parseUlyssesStyle : mappe document-settings, paragraph et heading-1/2 supportés", () => {
  const fields = parseUlyssesStyle(SAMPLE_ULSS);

  assert.deepEqual(fields.marginsCm, { top: 2.5, bottom: 2.5, left: 3, right: 3.5 });
  assert.equal(fields.pageOrientation, "portrait");
  assert.deepEqual(fields.columns, { count: 1, gutterPt: 12 });

  assert.equal(fields.fontFamily, "Baskerville");
  assert.equal(fields.fontSizePt, 14);
  assert.equal(fields.lineHeight, 1.71);
  assert.equal(fields.align, "justify", "« justified » (Ulysses) devient « justify » (Feuillets)");
  assert.equal(fields.indent, true);
  assert.equal(fields.indentPt, 43, "1.5cm converti en points, arrondi");
  assert.equal(fields.paragraphSpacing, false, "margin-bottom: 0pt -> pas d'espacement");
  assert.equal(fields.paragraphSpacingPt, undefined);
  assert.equal(fields.hyphenation, false);

  assert.deepEqual(fields.headings.h1, {
    fontSizePt: 52, align: "center", bold: true, italic: false, marginTopPt: 72, marginBottomPt: 72, pageBreakBefore: true,
  });
  assert.deepEqual(fields.headings.h2, {
    fontSizePt: 24, align: "left", bold: false, italic: true, marginTopPt: 24, marginBottomPt: 12, pageBreakBefore: false,
  });
  assert.equal(fields.headings.h3, undefined, "heading-3 absent du fichier -> absent du résultat");

  assert.equal(fields.sceneDivider, "* * *");
});

test("parseUlyssesStyle : ignore silencieusement les propriétés ULSS non supportées", () => {
  const fields = parseUlyssesStyle(SAMPLE_ULSS);

  // "page-size", "text-color", "alignment" (paragraph-divider) ne sont
  // mappées vers AUCUN champ ExportTemplate.
  assert.equal("pageSize" in fields, false);
  assert.equal("textColor" in fields, false);
  assert.equal("colorHex" in fields, false);
  // Aucune propriété inconnue ne fait planter l'analyse.
  assert.doesNotThrow(() => parseUlyssesStyle(SAMPLE_ULSS + "\nunknown-section:\n  weird-key: 1\n"));
});

test("parseUlyssesStyle : conversion pt/mm/cm — un nombre nu est traité comme des points", () => {
  const content = `
paragraph:
  font-size: 12
  margin-bottom: 24
`;
  const fields = parseUlyssesStyle(content);
  assert.equal(fields.fontSizePt, 12);
  assert.equal(fields.paragraphSpacingPt, 24);
});

test("parseUlyssesStyle : conversion mm -> pt et mm -> cm", () => {
  const content = `
document-settings:
  page-inset-top: 10mm
  page-inset-bottom: 10mm
  page-inset-inner: 10mm
  page-inset-outer: 10mm
paragraph:
  margin-bottom: 10mm
`;
  const fields = parseUlyssesStyle(content);
  assert.deepEqual(fields.marginsCm, { top: 1, bottom: 1, left: 1, right: 1 });
  assert.equal(fields.paragraphSpacingPt, Math.round(10 * 2.83465));
});

test("parseUlyssesStyle : conversion cm -> pt et cm -> cm (identité)", () => {
  const content = `
document-settings:
  page-inset-top: 2cm
  page-inset-bottom: 2cm
  page-inset-inner: 2cm
  page-inset-outer: 2cm
paragraph:
  margin-bottom: 1cm
`;
  const fields = parseUlyssesStyle(content);
  assert.deepEqual(fields.marginsCm, { top: 2, bottom: 2, left: 2, right: 2 });
  assert.equal(fields.paragraphSpacingPt, Math.round(28.3465));
});

test("parseUlyssesStyle : marges incomplètes (un seul côté renseigné) -> marginsCm absent, jamais de valeur devinée", () => {
  const content = `
document-settings:
  page-inset-top: 25mm
`;
  const fields = parseUlyssesStyle(content);
  assert.equal(fields.marginsCm, undefined);
});

test("parseUlyssesStyle : fichier vide ou sans section connue -> objet vide", () => {
  assert.deepEqual(parseUlyssesStyle(""), {});
  assert.deepEqual(parseUlyssesStyle("citation:\n  color: red\n"), {});
});

/* -------------------------- importUlyssesStyle ---------------------------- */

/** Le stub `stringifyYaml` de test/obsidian-runtime-stub.mjs sérialise
 * naïvement (`${key}: ${String(item)}`, sans repli objet imbriqué) : pour
 * relire un frontmatter fraîchement écrit par le service, on relit les
 * champs PLATS du contenu réel du fichier — suffisant pour label/
 * fontFamily/sceneDivider ; les champs imbriqués (marginsCm…) sont ignorés
 * ici comme du stub lui-même, on ne les vérifie donc pas par ce chemin. */
function parseFlatFrontmatter(content) {
  const match = (content || "").match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!match) return out;
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const value = line.slice(i + 1).trim();
    if (value === "[object Object]") continue;
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function buildFixture() {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project;
  project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (file) => ({ frontmatter: parseFlatFrontmatter(file.content) }) },
  };
  const settings = { projectFolder: manuscript.path, exportTemplate: "classique" };
  return { app, settings };
}

test("importUlyssesStyle : crée un gabarit personnalisé dans le dossier Layouts existant", async () => {
  const { app, settings } = buildFixture();

  const result = await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);

  assert.ok(result);
  assert.equal(result.label, "Roman simple");
  const file = app.vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Layout/${result.key}.md`);
  assert.ok(file instanceof TFile);
});

test("importUlyssesStyle : le gabarit importé devient IMMÉDIATEMENT actif", async () => {
  const { app, settings } = buildFixture();

  const result = await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);

  assert.equal(settings.exportTemplate, result.key);
});

test("importUlyssesStyle : accepte .ulss comme .ulstyle", async () => {
  const { app, settings } = buildFixture();

  const result = await importUlyssesStyle(app, settings, "Style perso.ulss", SAMPLE_ULSS);

  assert.equal(result.label, "Style perso");
});

test("importUlyssesStyle : les champs plats (fontFamily, sceneDivider…) sont bien lisibles ensuite via loadCustomTemplates", async () => {
  const { app, settings } = buildFixture();

  const result = await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);
  const custom = await loadCustomTemplates(app, settings);

  assert.equal(custom[result.key].fontFamily, "Baskerville");
  assert.equal(custom[result.key].sceneDivider, "* * *");
  assert.equal(custom[result.key].label, "Roman simple");
});

test("importUlyssesStyle : n'écrase jamais un gabarit existant du même nom — clé unique", async () => {
  const { app, settings } = buildFixture();

  const first = await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);
  const second = await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);

  assert.notEqual(first.key, second.key);
  assert.ok(app.vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Layout/${first.key}.md`) instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Layout/${second.key}.md`) instanceof TFile);
});

test("importUlyssesStyle : ne modifie aucun réglage global hors du nouveau gabarit", async () => {
  const { app, settings } = buildFixture();
  settings.compileFileName = "Manuscrit.md";
  settings.orders = { a: ["x"] };

  await importUlyssesStyle(app, settings, "Roman simple.ulstyle", SAMPLE_ULSS);

  assert.equal(settings.compileFileName, "Manuscrit.md");
  assert.deepEqual(settings.orders, { a: ["x"] });
});

test("importUlyssesStyle : aucun dossier projet -> null, sans lever", async () => {
  const { vault, fileManager } = createFakeVault([]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: "Inexistant", exportTemplate: "classique" };

  const result = await importUlyssesStyle(app, settings, "Style.ulstyle", SAMPLE_ULSS);

  assert.equal(result, null);
});
