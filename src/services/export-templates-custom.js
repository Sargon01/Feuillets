const { TFile, TFolder, Notice, normalizePath, stringifyYaml } = require("obsidian");
import { getProjectFolder } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { EXPORT_TEMPLATES } from "../utils/export-templates.js";

/** Dossier où le plugin cherche les modèles d'export personnalisés —
 * voisin de Ressources/Templates et Ressources/Export, jamais dans le
 * dossier projet lui-même. */
function customTemplatesFolderPath(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  return normalizePath(`${base}/Ressources/Modèles`);
}

function customTemplatesFolder(app, settings) {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) return null;
  const folder = app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? folder : null;
}

/** Modèles d'export personnalisés : des fiches .md avec frontmatter dans
 * Ressources/Modèles — même forme que les modèles intégrés
 * (utils/export-templates.js), lue via fmOf() (déjà utilisée partout
 * ailleurs dans le plugin), pas de nouveau format ni de nouvelle
 * dépendance. Le nom du fichier (sans .md) sert de clé et de repli pour
 * le libellé si le frontmatter n'en précise pas. Une fiche sans
 * frontmatter exploitable est ignorée (avec un message en console)
 * plutôt que de faire échouer tout le menu export. */
export async function loadCustomTemplates(app, settings) {
  const folder = customTemplatesFolder(app, settings);
  if (!folder) return {};
  const custom = {};
  for (const file of folder.children) {
    if (!(file instanceof TFile) || file.extension !== "md") continue;
    try {
      const fm = fmOf(app, file);
      if (!fm || Object.keys(fm).length === 0) continue;
      const key = file.basename;
      custom[key] = Object.assign({}, EXPORT_TEMPLATES.classique, fm, {
        key,
        label: fm.label || file.basename,
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
 * resolveExportTemplate) — pour peupler le sélecteur du menu export. */
export async function listExportTemplates(app, settings) {
  const custom = await loadCustomTemplates(app, settings);
  const merged = new Map();
  Object.values(EXPORT_TEMPLATES).forEach((t) => merged.set(t.key, { key: t.key, label: t.label }));
  Object.values(custom).forEach((t) => merged.set(t.key, { key: t.key, label: t.label }));
  return Array.from(merged.values());
}

/** Résout un modèle par clé — personnalisé en priorité s'il existe pour
 * cette clé (un fichier Ressources/Modèles/<clé>.md personnalise ainsi
 * réellement le modèle intégré du même nom, ex. après
 * exportBuiltInTemplates), sinon intégré, sinon repli sur "classique".
 * Utilisée par export-docx.js/export-epub.js/export-pdf.js à la place de
 * templateFor() (qui reste pure/synchrone, réservée aux tests). */
export async function resolveExportTemplate(app, settings, key) {
  const custom = await loadCustomTemplates(app, settings);
  if (custom[key]) return custom[key];
  return EXPORT_TEMPLATES[key] || EXPORT_TEMPLATES.classique;
}

/** Matérialise chaque modèle intégré (Classique, Roman simple, APA…) en
 * fichier .md dans Ressources/Modèles — un point de départ concret à
 * éditer plutôt qu'à réécrire depuis Exemple.md. Un fichier généré ici
 * porte la même clé que le modèle intégré correspondant (ex. classique.md)
 * : l'éditer le personnalise réellement pour ce projet (voir
 * resolveExportTemplate) sans dupliquer l'entrée dans le menu export.
 * Idempotent : un fichier déjà présent n'est jamais écrasé, pour ne
 * jamais perdre une personnalisation existante. Retourne le nombre de
 * fichiers effectivement créés. */
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
    const { key, ...fields } = t;
    const content = `---\n${stringifyYaml(fields).trim()}\n---\n`;
    await app.vault.create(filePath, content);
    count++;
  }
  return count;
}

/** Garantit un fichier .md éditable pour la clé de modèle donnée dans
 * Ressources/Modèles : s'il n'existe pas encore, le matérialise depuis le
 * modèle intégré correspondant (comme exportBuiltInTemplates, mais pour un
 * seul modèle) — condition pour que l'UI de réglages puisse éditer un modèle
 * intégré « en coulisses » sans que l'utilisateur ouvre le .md. */
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
 * processFrontMatter préserve le reste du frontmatter et le corps. */
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
