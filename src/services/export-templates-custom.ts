import { TFile, TFolder, Notice, normalizePath, stringifyYaml } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath, FEUILLETS_RESOURCE_FOLDERS } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { BUILTIN_TEMPLATE_CATALOG, EXPORT_TEMPLATES } from "../utils/export-templates.js";
import { normalizeLegacyTemplate, normalizeV2Template } from "./export-template-v2.js";

/**
 * @typedef {import("obsidian").App} App
 * @typedef {import("obsidian").TFile} TFileType
 * @typedef {import("obsidian").TFolder} TFolderType
 */

/** Dossier où le plugin cherche les modèles d'export personnalisés —
 * voisin de Resources/Templates et Resources/Export, jamais dans le
 * dossier projet lui-même. Exportée : réutilisée telle quelle par
 * services/ulysses-style-import.ts (Phase 11), plutôt que de dupliquer la
 * résolution du dossier Layouts.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {string|null} `null` si aucun dossier projet n'est défini.
 */
export function customTemplatesFolderPath(app: App, settings: FeuilletsSettings): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const resPath = resourcesFolderPath(app, root);
  return resourcesSubfolderPath(app, resPath, FEUILLETS_RESOURCE_FOLDERS.layouts, "Layouts", "Layout");
}

/** Le dossier s'il existe déjà dans le coffre — jamais créé ici.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {TFolderType|null}
 */
function customTemplatesFolder(app: App, settings: FeuilletsSettings): TFolder | null {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) return null;
  const folder = app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? folder : null;
}

/** Retourne uniquement le fichier personnalisé exact de cette clé. Un
 * gabarit intégré, même résolu sous la même clé, ne produit jamais de fichier
 * ici : cette distinction protège les actions Renommer et Supprimer. */
export function customTemplateFile(app: App, settings: FeuilletsSettings, key: string): TFile | null {
  const folder = customTemplatesFolder(app, settings);
  if (!folder) return null;
  const file = app.vault.getAbstractFileByPath(normalizePath(`${folder.path}/${key}.md`));
  return file instanceof TFile ? file : null;
}

/** Renomme l'affichage d'un gabarit personnalisé sans modifier sa clé ni son
 * fichier. Les références à `settings.exportTemplate` restent donc stables. */
export async function renameCustomTemplate(app: App, settings: FeuilletsSettings, key: string, label: string): Promise<boolean> {
  const file = customTemplateFile(app, settings, key);
  if (!file) return false;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    frontmatter.label = label;
  });
  return true;
}

/** Envoie le fichier personnalisé à la corbeille. Si la clé n'est pas celle
 * d'un gabarit intégré, le réglage actif revient à Classique ; pour un
 * override intégré, la même clé est conservée et l'intégré réapparaît. */
export async function deleteCustomTemplate(app: App, settings: FeuilletsSettings, key: string): Promise<{ deleted: boolean; activeChanged: boolean }> {
  const file = customTemplateFile(app, settings, key);
  if (!file) return { deleted: false, activeChanged: false };
  await app.fileManager.trashFile(file);
  if (EXPORT_TEMPLATES[key]) return { deleted: true, activeChanged: false };
  (settings as { exportTemplate: string }).exportTemplate = "classique";
  return { deleted: true, activeChanged: true };
}

/** Une police personnalisée doit rester une chaîne réellement utilisable. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Les dimensions DOCX sont exprimées par des nombres positifs et finis. */
function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Préserve les valeurs de modèle valides, sans laisser un frontmatter mal
 * formé effacer les valeurs par défaut nécessaires à l'export.
 */
function validTemplateOverrides(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const overrides = { ...frontmatter };
  if (!isNonEmptyString(overrides.fontFamily)) delete overrides.fontFamily;
  if (!isPositiveFiniteNumber(overrides.fontSizePt)) delete overrides.fontSizePt;
  if (!isPositiveFiniteNumber(overrides.lineHeight)) delete overrides.lineHeight;
  return overrides;
}

function templateV2FromFrontmatter(frontmatter: Record<string, unknown>): ExportTemplateV2 | null {
  if (frontmatter.version !== 2 || !frontmatter.page || !frontmatter.body) return null;
  // Le frontmatter est lu comme données utilisateur : la copie évite que la
  // normalisation V2 ou son appelant ne puisse modifier le cache Obsidian.
  return normalizeV2Template(JSON.parse(JSON.stringify(frontmatter)) as ExportTemplateV2);
}

function legacyFieldsFromV2(tpl: ExportTemplateV2): Omit<ExportTemplate, "key" | "label" | "custom"> {
  return {
    fontFamily: tpl.body.fontFamily,
    fontSizePt: tpl.body.fontSizePt,
    lineHeight: tpl.body.lineHeight,
    align: tpl.body.align,
    indent: tpl.body.firstLineIndentPt > 0,
    indentPt: tpl.body.firstLineIndentPt || undefined,
    paragraphSpacing: tpl.body.paragraphSpacingAfterPt > 0,
    paragraphSpacingPt: tpl.body.paragraphSpacingBeforePt || undefined,
    hyphenation: tpl.body.hyphenation,
    marginsCm: { ...tpl.page.marginsCm },
    /* §23-§24 : la projection ne transportait QUE l'orientation — ni le
       format, ni les marges miroir, ni les bandes. Les consommateurs legacy
       retombaient donc systématiquement sur les anciens réglages PDF, y
       compris pour un gabarit V2 qui exprimait pourtant explicitement ces
       valeurs. Elles sont désormais projetées, et priment (voir
       services/page-geometry.ts et paginateManuscript). */
    pageSize: tpl.page.size,
    pageOrientation: tpl.page.orientation,
    mirrorMargins: tpl.page.mirrorMargins,
    columns: { ...tpl.page.columns },
    header: { ...tpl.header },
    footer: { ...tpl.footer },
    firstPage: { ...tpl.firstPage },
    ...(tpl.blockquote ? { blockquote: { ...tpl.blockquote } } : {}),
    sceneDivider: tpl.sceneDivider,
    headings: Object.fromEntries(Object.entries(tpl.headings).map(([level, style]) => [level, { ...style }])),
    titlePage: JSON.parse(JSON.stringify(tpl.titlePage)),
  };
}

function v2FileFields(tpl: ExportTemplateV2, label: string): Record<string, unknown> {
  // Un fichier produit par l'éditeur canonique est V2 seulement. Les
  // consommateurs legacy obtiennent leur projection en mémoire dans
  // loadCustomTemplates(), sans réintroduire de dette dans le fichier.
  return { version: 2, profile: tpl.profile, page: tpl.page, body: tpl.body, headings: tpl.headings,
    blockquote: tpl.blockquote, sceneDivider: tpl.sceneDivider, header: tpl.header, footer: tpl.footer,
    firstPage: tpl.firstPage, titlePage: tpl.titlePage, label };
}

/** Lit les gabarits personnalisés sous leur forme V2. Les anciens fichiers
 * restent en lecture seule : ils sont normalisés en mémoire sans être
 * réécrits et sans hériter implicitement du gabarit « classique ». */
export async function loadCustomTemplatesV2(app: App, settings: FeuilletsSettings): Promise<Record<string, ExportTemplateV2>> {
  const folder = customTemplatesFolder(app, settings);
  if (!folder) return {};
  const custom: Record<string, ExportTemplateV2> = {};
  for (const file of folder.children) {
    if (!(file instanceof TFile) || file.extension !== "md") continue;
    try {
      const fm = fmOf(app, file);
      if (!fm || Object.keys(fm).length === 0) continue;
      const existingV2 = templateV2FromFrontmatter(fm);
      custom[file.basename] = existingV2 ?? normalizeLegacyTemplate({
        ...validTemplateOverrides(fm), key: file.basename,
        label: typeof fm.label === "string" && fm.label.trim() ? fm.label.trim() : file.basename,
      });
    } catch (e) {
      console.error(`Feuillets: modèle d'export personnalisé V2 illisible (${file.path})`, e);
    }
  }
  return custom;
}

/** Résolution V2 séparée, volontairement non utilisée par les exporteurs
 * pendant la migration. */
export async function resolveExportTemplateV2(app: App, settings: FeuilletsSettings, key: string): Promise<ExportTemplateV2> {
  const custom = await loadCustomTemplatesV2(app, settings);
  return custom[key] ?? normalizeLegacyTemplate(EXPORT_TEMPLATES[key] || EXPORT_TEMPLATES.classique);
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
 * @returns {Promise<Record<string, ResolvedExportTemplate>>} vide si pas de dossier.
 */
export async function loadCustomTemplates(app: App, settings: FeuilletsSettings): Promise<Record<string, ResolvedExportTemplate>> {
  const folder = customTemplatesFolder(app, settings);
  if (!folder) return {};
  /** @type {Record<string, ResolvedExportTemplate>} */
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
      const v2 = templateV2FromFrontmatter(fm);
      custom[key] = v2 ? {
        ...legacyFieldsFromV2(v2),
        key,
        label,
        custom: true,
      } : Object.assign({}, EXPORT_TEMPLATES.classique, validTemplateOverrides(fm), {
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
export async function listExportTemplates(app: App, settings: FeuilletsSettings): Promise<Array<{ key: string; label: string }>> {
  const custom = await loadCustomTemplates(app, settings);
  const merged = new Map<string, { key: string; label: string }>();
  for (const key of BUILTIN_TEMPLATE_CATALOG) {
    const template = custom[key] || EXPORT_TEMPLATES[key];
    merged.set(key, { key, label: template.label });
  }
  Object.values(custom).forEach((t) => {
    if (!merged.has(t.key)) merged.set(t.key, { key: t.key, label: t.label });
  });
  const activeKey = (settings as { exportTemplate?: string }).exportTemplate;
  if (activeKey && EXPORT_TEMPLATES[activeKey] && !merged.has(activeKey)) {
    const template = custom[activeKey] || EXPORT_TEMPLATES[activeKey];
    merged.set(activeKey, { key: activeKey, label: template.label });
  }
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
 * @returns {Promise<ResolvedExportTemplate>} jamais null — repli sur "classique".
 */
export async function resolveExportTemplate(app: App, settings: FeuilletsSettings, key: string): Promise<ResolvedExportTemplate> {
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
export async function exportBuiltInTemplates(app: App, settings: FeuilletsSettings): Promise<number> {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return 0;
  }
  await ensureFolder(app, path);
  let count = 0;
  for (const key of BUILTIN_TEMPLATE_CATALOG) {
    const t = EXPORT_TEMPLATES[key];
    const filePath = normalizePath(`${path}/${t.key}.md`);
    if (app.vault.getAbstractFileByPath(filePath)) continue;
    const v2 = normalizeLegacyTemplate(t);
    const content = `---\n${stringifyYaml(v2FileFields(v2, t.label)).trim()}\n---\n`;
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
export async function ensureTemplateFile(app: App, settings: FeuilletsSettings, key: string): Promise<TFile | null> {
  const folderPath = customTemplatesFolderPath(app, settings);
  if (!folderPath) return null;
  await ensureFolder(app, folderPath);
  const filePath = normalizePath(`${folderPath}/${key}.md`);
  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    const builtin = EXPORT_TEMPLATES[key];
    let content = "---\n---\n";
    if (builtin) {
      const v2 = normalizeLegacyTemplate(builtin);
      content = `---\n${stringifyYaml(v2FileFields(v2, builtin.label)).trim()}\n---\n`;
    }
    file = await app.vault.create(filePath, content);
  }
  return file instanceof TFile ? file : null;
}

/** Clé de fichier jamais déjà prise dans Layouts, à partir d'une clé de
 * base : "<base>", puis "<base>-2", "<base>-3"… jusqu'à en trouver une
 * libre. Ne crée rien elle-même — seulement calcule un nom sûr, pour ne
 * JAMAIS écraser un fichier existant (Dupliquer comme Importer Ulysses,
 * Phase 11).
 * @param {App} app
 * @param {string} folderPath
 * @param {string} baseKey
 * @returns {Promise<string>}
 */
async function uniqueTemplateKey(app: App, folderPath: string, baseKey: string): Promise<string> {
  let key = baseKey;
  let n = 2;
  while (app.vault.getAbstractFileByPath(normalizePath(`${folderPath}/${key}.md`))) {
    key = `${baseKey}-${n}`;
    n++;
  }
  return key;
}

export async function createCustomTemplateFromV2(
  app: App,
  settings: FeuilletsSettings,
  baseKey: string,
  label: string,
  template: ExportTemplateV2
): Promise<{ key: string; label: string } | null> {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }
  await ensureFolder(app, path);
  const key = await uniqueTemplateKey(app, path, baseKey);
  await app.vault.create(normalizePath(`${path}/${key}.md`), `---\n${stringifyYaml(v2FileFields(template, label)).trim()}\n---\n`);
  (settings as { exportTemplate: string }).exportTemplate = key;
  return { key, label };
}

/** Écrit un nouveau modèle personnalisé dans Layouts et le rend
 * IMMÉDIATEMENT actif (`settings.exportTemplate`) — le même format
 * Markdown/frontmatter que les modèles existants (voir
 * exportBuiltInTemplates), jamais un second système. N'appelle jamais
 * `saveSettings()` elle-même : `settings` est mutée en mémoire, à
 * l'appelant (UI) de persister — même convention que le reste du plugin
 * (services écrivent l'état, les vues déclenchent la sauvegarde).
 * Partagée par `duplicateExportTemplate` et
 * services/ulysses-style-import.ts (Phase 11) : un seul chemin d'écriture
 * de modèle personnalisé.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @param {string} baseKey clé de départ — rendue unique ici si besoin.
 * @param {string} label
 * @param {Record<string, unknown>} fields champs ExportTemplate (sans key/label/custom).
 * @returns {Promise<{key:string,label:string}|null>} `null` si aucun dossier projet.
 */
export async function createCustomTemplateFromFields(
  app: App,
  settings: FeuilletsSettings,
  baseKey: string,
  label: string,
  fields: Record<string, unknown>
): Promise<{ key: string; label: string } | null> {
  const path = customTemplatesFolderPath(app, settings);
  if (!path) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }
  await ensureFolder(app, path);
  const key = await uniqueTemplateKey(app, path, baseKey);
  const filePath = normalizePath(`${path}/${key}.md`);
  const content = `---\n${stringifyYaml({ ...fields, label }).trim()}\n---\n`;
  await app.vault.create(filePath, content);
  (settings as { exportTemplate: string }).exportTemplate = key;
  return { key, label };
}

/** Duplique le gabarit ACTIF (`settings.exportTemplate`) en un nouveau
 * modèle personnalisé, dans le même dossier Layouts que les autres —
 * jamais un second système de gabarits. Clé unique
 * ("<clé>-copie", "<clé>-copie-2"…), libellé « <nom> — copie », ne
 * remplace jamais un fichier existant, rend la copie immédiatement active.
 * @param {App} app
 * @param {FeuilletsSettings} settings
 * @returns {Promise<{key:string,label:string}|null>} `null` si aucun dossier projet.
 */
export async function duplicateExportTemplate(
  app: App,
  settings: FeuilletsSettings
): Promise<{ key: string; label: string } | null> {
  const sourceKey = (settings as { exportTemplate?: string }).exportTemplate || "classique";
  const source = await resolveExportTemplate(app, settings, sourceKey);
  const label = `${source.label} — copie`;
  const sourceV2 = await resolveExportTemplateV2(app, settings, sourceKey);
  return createCustomTemplateFromV2(app, settings, `${sourceKey}-copie`, label, sourceV2);
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
export async function updateTemplateTitlePage(app: App, settings: FeuilletsSettings, key: string, styles: Record<string, TitlePageStyle>): Promise<void> {
  const template = await resolveExportTemplateV2(app, settings, key);
  template.titlePage.styles = JSON.parse(JSON.stringify(styles)) as Record<string, TitlePageStyle>;
  await saveExportTemplateV2(app, settings, key, template);
}

/** Sauvegarde atomiquement la forme canonique V2 du gabarit sélectionné.
 * Toute écriture d'édition efface les clés legacy du frontmatter, mais une
 * simple lecture d'un ancien fichier ne l'écrit jamais. */
export async function saveExportTemplateV2(app: App, settings: FeuilletsSettings, key: string, template: ExportTemplateV2): Promise<void> {
  const file = await ensureTemplateFile(app, settings, key);
  if (!file) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  const normalized = normalizeV2Template(JSON.parse(JSON.stringify(template)) as ExportTemplateV2);
  const label = (await resolveExportTemplate(app, settings, key)).label || key;
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const field of Object.keys(fm)) delete fm[field];
    Object.assign(fm, v2FileFields(normalized, label));
  });
}
