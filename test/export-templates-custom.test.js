import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  ensureTemplateFile,
  loadCustomTemplates,
  duplicateExportTemplate,
  listExportTemplates,
  resolveExportTemplate,
  loadCustomTemplatesV2,
  resolveExportTemplateV2,
  saveExportTemplateV2,
} from "../src/services/export-templates-custom.js";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import { normalizeLegacyTemplate } from "../src/services/export-template-v2.js";

test("export templates custom : lit un modèle et crée un modèle manquant", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const custom = new TFile("Projet/Resources/Layouts/perso.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources; custom.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [custom];
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, custom]);
  const app = { vault, fileManager, metadataCache: { getFileCache: (file) => ({ frontmatter: file === custom ? { label: "Mon modèle", fontSizePt: 11 } : {} }) } };
  const settings = { projectFolder: manuscript.path };

  const templates = await loadCustomTemplates(app, settings);
  const created = await ensureTemplateFile(app, settings, "classique");

  assert.equal(templates.perso.label, "Mon modèle");
  assert.equal(created?.path, "Projet/Resources/Layouts/classique.md");
});

test("export templates custom V2 : la sauvegarde matérialise un builtin complet sans champs legacy ni réglages pdf", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project; project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const writes = [];
  fileManager.processFrontMatter = async (file, update) => {
    const fm = { indent: true, pdfHeaderLeft: "Ancien", pageNumbers: true };
    update(fm);
    writes.push({ file, fm });
  };
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path, exportTemplate: "classique", pdfHeaderLeft: "Global inchangé" };
  const template = normalizeLegacyTemplate(EXPORT_TEMPLATES.classique);
  template.profile = "manuscript";
  template.page.marginsCm.left = 3.2;
  template.body.firstLineIndentPt = 24;
  template.headings.h6 = { fontSizePt: 9, italic: true };
  template.header.center = "{page}";
  template.footer.right = "{page}";
  template.titlePage.styles = { titre: { fontSizePt: 22, bold: true } };

  await saveExportTemplateV2(app, settings, "classique", template);

  const saved = writes[0].fm;
  assert.equal(saved.version, 2);
  assert.equal(saved.profile, "manuscript");
  assert.equal(saved.page.marginsCm.left, 3.2);
  assert.equal(saved.body.firstLineIndentPt, 24);
  assert.deepEqual(saved.headings.h6, { fontSizePt: 9, italic: true });
  assert.equal(saved.header.center, "{page}");
  assert.equal(saved.footer.right, "{page}");
  assert.deepEqual(saved.titlePage.styles.titre, { fontSizePt: 22, bold: true });
  for (const key of ["indent", "pdfHeaderLeft", "pageNumbers", "pageNumberPosition", "chapterTitle"]) assert.equal(key in saved, false);
  assert.equal(settings.pdfHeaderLeft, "Global inchangé");
});

test("export templates custom : un nouveau projet sans dossier existant crée dans Layout (nouveau nom)", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project;
  project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path };

  const created = await ensureTemplateFile(app, settings, "classique");

  assert.equal(created?.path, "Projet/_Feuillets/Ressources/Layout/classique.md");
});

test("export templates custom : conserve les valeurs valides et ignore les valeurs de police invalides", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const valid = new TFile("Projet/Resources/Layouts/valide.md");
  const invalid = new TFile("Projet/Resources/Layouts/invalide.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources;
  valid.parent = layouts; invalid.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [valid, invalid];
  const frontmatter = new Map([
    [valid, { fontFamily: "Georgia, serif", fontSizePt: 11, lineHeight: 1.5 }],
    [invalid, { fontFamily: "  ", fontSizePt: 0, lineHeight: null }],
  ]);
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, valid, invalid]);
  const app = { vault, fileManager, metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file) ?? {} }) } };
  const settings = { projectFolder: manuscript.path };

  const templates = await loadCustomTemplates(app, settings);

  assert.equal(templates.valide.fontFamily, "Georgia, serif");
  assert.equal(templates.valide.fontSizePt, 11);
  assert.equal(templates.valide.lineHeight, 1.5);
  assert.equal(templates.invalide.fontFamily, EXPORT_TEMPLATES.classique.fontFamily);
  assert.equal(templates.invalide.fontSizePt, EXPORT_TEMPLATES.classique.fontSizePt);
  assert.equal(templates.invalide.lineHeight, EXPORT_TEMPLATES.classique.lineHeight);
});

test("export templates custom : un gabarit personnalisé de même clé est résolu avant l'intégré", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const customApa = new TFile("Projet/Resources/Layouts/apa.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources; customApa.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [customApa];
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, customApa]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (file) => ({ frontmatter: file === customApa ? { label: "APA maison", fontSizePt: 13, hyphenation: true } : {} }) },
  };

  const resolved = await resolveExportTemplate(app, { projectFolder: manuscript.path }, "apa");

  assert.equal(resolved.key, "apa");
  assert.equal(resolved.label, "APA maison");
  assert.equal(resolved.fontSizePt, 13);
  assert.equal(resolved.hyphenation, true);
  assert.equal(resolved.custom, true);
  assert.equal(resolved.fontFamily, EXPORT_TEMPLATES.classique.fontFamily, "le personnalisé conserve sa résolution actuelle depuis Classique");
  assert.notEqual(resolved, EXPORT_TEMPLATES.apa);
});

test("export templates custom V2 : un ancien fichier reste lisible sans fusion implicite avec Classique", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const custom = new TFile("Projet/Resources/Layouts/ancien.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources; custom.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [custom];
  const frontmatter = { label: "Ancien", fontFamily: "Georgia, serif", fontSizePt: 11, hyphenation: false };
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, custom]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter }) } };
  const settings = { projectFolder: manuscript.path };

  const legacy = await loadCustomTemplates(app, settings);
  const v2 = await loadCustomTemplatesV2(app, settings);

  assert.equal(legacy.ancien.fontFamily, "Georgia, serif", "la voie legacy conserve sa compatibilité publique");
  assert.equal(v2.ancien.body.fontFamily, "Georgia, serif");
  assert.deepEqual(v2.ancien.headings, {
    h1: { pageBreakBefore: true }, h2: { pageBreakBefore: true }, h3: {}, h4: {}, h5: {}, h6: {},
  }, "V2 ne récupère jamais les titres de Classique");
  assert.equal(v2.ancien.profile, "document");
  assert.deepEqual(frontmatter, { label: "Ancien", fontFamily: "Georgia, serif", fontSizePt: 11, hyphenation: false });
});

/* ---------------------- duplicateExportTemplate (Phase 11) --------------- */

/** Le stub `stringifyYaml` de test/obsidian-runtime-stub.mjs sérialise
 * naïvement (`${key}: ${String(item)}`, sans repli objet imbriqué) : pour
 * relire un frontmatter fraîchement écrit par le service (plutôt que
 * pré-posé à la main comme les fixtures ci-dessus), on relit les champs
 * PLATS du contenu réel du fichier — suffisant pour label/fontFamily, les
 * champs imbriqués (marginsCm, headings…) restent hors de portée de ce
 * mini-parseur, comme du stub lui-même. */
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

test("duplicateExportTemplate : résout le gabarit actif, crée une copie avec le libellé « <nom> — copie »", async () => {
  const { app, settings } = buildFixture();

  const result = await duplicateExportTemplate(app, settings);

  assert.ok(result);
  assert.equal(result.key, "classique-copie");
  assert.equal(result.label, `${EXPORT_TEMPLATES.classique.label} — copie`);
  const file = app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Layout/classique-copie.md");
  assert.ok(file instanceof TFile);
});

test("duplicateExportTemplate : rend IMMÉDIATEMENT la copie active", async () => {
  const { app, settings } = buildFixture();

  const result = await duplicateExportTemplate(app, settings);

  assert.equal(settings.exportTemplate, result.key);
});

test("duplicateExportTemplate : ne remplace jamais un fichier existant — clé unique à chaque appel", async () => {
  const { app, settings } = buildFixture();

  const first = await duplicateExportTemplate(app, settings);
  // Redevient "classique" pour dupliquer deux fois le même gabarit source.
  settings.exportTemplate = "classique";
  const second = await duplicateExportTemplate(app, settings);

  assert.notEqual(first.key, second.key);
  assert.equal(first.key, "classique-copie");
  assert.equal(second.key, "classique-copie-2");
  // Le premier fichier existe toujours, intact.
  assert.ok(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Layout/classique-copie.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Layout/classique-copie-2.md") instanceof TFile);
});

test("duplicateExportTemplate : la copie est immédiatement disponible via listExportTemplates", async () => {
  const { app, settings } = buildFixture();

  const result = await duplicateExportTemplate(app, settings);
  const templates = await listExportTemplates(app, settings);

  assert.ok(templates.some((tpl) => tpl.key === result.key && tpl.label === result.label));
});

test("duplicateExportTemplate : préserve les champs du gabarit dupliqué (pas de valeurs par défaut écrasées)", async () => {
  const { app, settings } = buildFixture();

  const result = await duplicateExportTemplate(app, settings);
  const custom = await loadCustomTemplates(app, settings);

  assert.equal(custom[result.key].fontFamily, EXPORT_TEMPLATES.classique.fontFamily);
  assert.equal(custom[result.key].fontSizePt, EXPORT_TEMPLATES.classique.fontSizePt);
  assert.equal(custom[result.key].lineHeight, EXPORT_TEMPLATES.classique.lineHeight);
});

test("duplicateExportTemplate : écrit une copie V2 de Classique avec le profil manuscript", async () => {
  const { app, settings } = buildFixture();

  const result = await duplicateExportTemplate(app, settings);
  const file = app.vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Layout/${result.key}.md`);

  assert.match(file.content, /version: 2/);
  assert.match(file.content, /profile: manuscript/);
  for (const field of ["page", "body", "headings", "header", "footer", "firstPage", "titlePage", "blockquote", "sceneDivider"]) {
    assert.match(file.content, new RegExp(`${field}:`), `${field} doit être écrit dans la copie V2`);
  }
});

test("duplicateExportTemplate : conserve le profil document d'un gabarit intégré", async () => {
  const { app, settings } = buildFixture();
  settings.exportTemplate = "romanSimple";

  const result = await duplicateExportTemplate(app, settings);
  const file = app.vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Layout/${result.key}.md`);

  assert.match(file.content, /profile: document/);
});

test("resolveExportTemplateV2 : APA et Thèse conservent leur profil académique sans muter les sources", async () => {
  const { app, settings } = buildFixture();
  const before = structuredClone(EXPORT_TEMPLATES);

  const apa = await resolveExportTemplateV2(app, settings, "apa");
  const these = await resolveExportTemplateV2(app, settings, "these");
  apa.page.marginsCm.left = 99;

  assert.equal(apa.profile, "academic");
  assert.equal(these.profile, "academic");
  assert.deepEqual(EXPORT_TEMPLATES, before);
});

test("loadCustomTemplatesV2 : un fichier V2 complet est conservé et isolé des données source", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const custom = new TFile("Projet/Resources/Layouts/complet.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources; custom.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [custom];
  const frontmatter = {
    version: 2, profile: "document", page: { size: "A5", orientation: "portrait", marginsCm: { top: 1, bottom: 1, left: 1, right: 1 }, mirrorMargins: false, columns: { count: 1, gutterPt: 0 } },
    body: { fontFamily: "Georgia", fontSizePt: 11, lineHeight: 1.5, align: "left", firstLineIndentPt: 0, paragraphSpacingBeforePt: 0, paragraphSpacingAfterPt: 0, hyphenation: false },
    headings: { h1: {}, h2: {}, h3: {}, h4: {}, h5: {}, h6: {} }, blockquote: {}, sceneDivider: "",
    header: { enabled: true, left: "L", center: "", right: "R", distanceCm: 1, bodyGapPt: 2, differentOddEven: false },
    footer: { enabled: true, left: "", center: "", right: "F", distanceCm: 1, bodyGapPt: 2 },
    firstPage: { hideHeader: true, pageNumberPosition: "right" }, titlePage: { styles: { titre: { fontSizePt: 22 } } },
  };
  const before = structuredClone(frontmatter);
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, custom]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter }) } };

  const templates = await loadCustomTemplatesV2(app, { projectFolder: manuscript.path });
  templates.complet.body.fontSizePt = 99;
  templates.complet.titlePage.styles.titre.fontSizePt = 9;

  assert.equal(templates.complet.profile, "document");
  assert.equal(templates.complet.page.size, "A5");
  assert.equal(templates.complet.header.left, "L");
  assert.deepEqual(frontmatter, before);
});

test("duplicateExportTemplate : aucun dossier projet -> null, sans lever", async () => {
  const { vault, fileManager } = createFakeVault([]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: "Inexistant", exportTemplate: "classique" };

  const result = await duplicateExportTemplate(app, settings);

  assert.equal(result, null);
});
