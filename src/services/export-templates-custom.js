// @ts-check
import { TFile, TFolder, Notice, normalizePath, stringifyYaml } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { EXPORT_TEMPLATES } from "../utils/export-templates.js";

/**
 * @typedef {import("obsidian").App} App
 * @typedef {import("obsidian").TFile} TFileType
 * @typedef {import("obsidian").TFolder} TFolderType
 */

/** Dossier où le plugin cherche les modèles d'export personnalisés —
 * voisin de Resources/Templates et Resources/Export, jamais dans le
 * dossier projet lui-même.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {string|null} `null` si aucun dossier projet n'est défini.
 */
function customTemplatesFolderPath(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const resPath = resourcesFolderPath(app, root);
  return resourcesSubfolderPath(app, resPath, "Layouts", "Modèles");
}

/** Le dossier s'il existe déjà dans le coffre — jamais créé ici.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {TFolderType|null}
 */
function customTemplatesFolder(app, settings) {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) return null;
  const folder = app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? folder : null;
}

/** Modèles d'export personnalisés : des fiches .md avec frontmatter dans
 * Resources/Layouts — même forme que les modèles intégrés
 * (utils/export-templates.js), lue via fmOf() (déjà utilisée partout
 * ailleurs dans le plugin), pas de nouveau format ni de nouvelle
 * dépendance. Le nom du fichier (sans .md) sert de clé et de repli pour
 * le libellé si le frontmatter n'en précise pas. Une fiche sans
 * frontmatter exploitable est ignorée (avec un message en console)
 * plutôt que de faire échouer tout le menu export.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {Promise<Record<string, ExportTemplate>>} vide si pas de dossier.
 */
export async function loadCustomTemplates(app, settings) {
  const folder = customTemplatesFolder(app, settings);
  if (!folder) return {};
  /** @type {Record<string, ExportTemplate>} */
  const custom = {};
  for (const file of folder.children) {
    if (!(file instanceof TFile) || file.extension !== "md") continue;
    try {
      const fm = fmOf(app, file);
      if (!fm || Object.keys(fm).length === 0) continue;
      const key = file.basename;
      /* `label` doit rester une chaîne : rien n'empêche d'écrire une liste
         YAML (`label: [a, b]`) dans le .md d'un modèle, et elle finirait
         telle quelle dans le <option> du sélecteur d'export. Même garde
         défensive que partout ailleurs sur le frontmatter (voir titleFor). */
      const label = typeof fm.label === "string" && fm.label.trim() ? fm.label.trim() : file.basename;
      custom[key] = Object.assign({}, EXPORT_TEMPLATES.classique, fm, {
        key,
        label,
        custom: true,
      });
    } catch (e) {
      console.error(`Feuillets: modèle d'export personnalisé illisible (${file.path})`, e);
    }
  }
  return custom;
}

/** Liste { key, label } de tous les modèles disponibles — intégrés,
 * complétés/remplacés par les personnalisés de même clé (voir
 * resolveExportTemplate) — pour peupler le sélecteur du menu export.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {Promise<{ key: string, label: string }[]>}
 */
export async function listExportTemplates(app, settings) {
  const custom = await loadCustomTemplates(app, settings);
  const merged = new Map();
  Object.values(EXPORT_TEMPLATES).forEach((t) => merged.set(t.key, { key: t.key, label: t.label }));
  Object.values(custom).forEach((t) => merged.set(t.key, { key: t.key, label: t.label }));
  return Array.from(merged.values());
}

/** Résout un modèle par clé — personnalisé en priorité s'il existe pour
 * cette clé (un fichier Resources/Layouts/<clé>.md personnalise ainsi
 * réellement le modèle intégré du même nom, ex. après
 * exportBuiltInTemplates), sinon intégré, sinon repli sur "classique".
 * Utilisée par export-docx.js/export-epub.js/export-pdf.js à la place de
 * templateFor() (qui reste pure/synchrone, réservée aux tests).
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @param {string} key
 * @returns {Promise<ExportTemplate>} jamais null — repli sur "classique".
 */
export async function resolveExportTemplate(app, settings, key) {
  const custom = await loadCustomTemplates(app, settings);
  if (custom[key]) return custom[key];
  return EXPORT_TEMPLATES[key] || EXPORT_TEMPLATES.classique;
}

/** Matérialise chaque modèle intégré (Classique, Roman simple, APA…) en
 * fichier .md dans Resources/Layouts — un point de départ concret à
 * éditer plutôt qu'à réécrire depuis Exemple.md. Un fichier généré ici
 * porte la même clé que le modèle intégré correspondant (ex. classique.md)
 * : l'éditer le personnalise réellement pour ce projet (voir
 * resolveExportTemplate) sans dupliquer l'entrée dans le menu export.
 * Idempotent : un fichier déjà présent n'est jamais écrasé, pour ne
 * jamais perdre une personnalisation existante. Retourne le nombre de
 * fichiers effectivement créés.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {Promise<number>} nombre de fichiers créés (0 si tous existaient).
 */
export async function exportBuiltInTemplates(app, settings) {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return 0;
  }
  await ensureFolder(app, path);
  let count = 0;
  for (const t of Object.values(EXPORT_TEMPLATES)) {
    const filePath = normalizePath(`${path}/${t.key}.md`);
    if (app.vault.getAbstractFileByPath(filePath)) continue;
    const { key: _key, ...fields } = t;
    const content = `---\n${stringifyYaml(fields).trim()}\n---\n`;
    await app.vault.create(filePath, content);
    count++;
  }
  return count;
}

/** Garantit un fichier .md éditable pour la clé de modèle donnée dans
 * Resources/Layouts : s'il n'existe pas encore, le matérialise depuis le
 * modèle intégré correspondant (comme exportBuiltInTemplates, mais pour un
 * seul modèle) — condition pour que l'UI de réglages puisse éditer un modèle
 * intégré « en coulisses » sans que l'utilisateur ouvre le .md.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @param {string} key
 * @returns {Promise<TFileType|null>} `null` si aucun dossier projet.
 */
export async function ensureTemplateFile(app, settings, key) {
  const folderPath = customTemplatesFolderPath(app, settings);
  if (!folderPath) return null;
  await ensureFolder(app, folderPath);
  const filePath = normalizePath(`${folderPath}/${key}.md`);
  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    const builtin = EXPORT_TEMPLATES[key];
    let content = "---\n---\n";
    if (builtin) {
      const { key: _k, ...fields } = builtin;
      content = `---\n${stringifyYaml(fields).trim()}\n---\n`;
    }
    file = await app.vault.create(filePath, content);
  }
  return file instanceof TFile ? file : null;
}

/** Écrit `titlePage.styles` (objet {rôle: {fontSizePt, bold, italic, align,
 * marginTopPt, marginBottomPt}}) dans le frontmatter du modèle — source de
 * vérité unique (option A) : l'UI de réglages règle les blocs de la page de
 * titre en éditant réellement le .md du modèle sélectionné, sans surcouche.
 * processFrontMatter préserve le reste du frontmatter et le corps.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @param {string} key
 * @param {Record<string, TitlePageStyle>} styles
 * @returns {Promise<void>}
 */
export async function updateTemplateTitlePage(app, settings, key, styles) {
  const file = await ensureTemplateFile(app, settings, key);
  if (!file) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.titlePage = fm.titlePage || {};
    fm.titlePage.styles = styles;
  });
}
