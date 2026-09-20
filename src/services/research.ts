import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { foldAccents } from "../utils/core.js";
import { fmOf, titleFor, tagsOf, stripFrontmatter } from "./frontmatter.js";
import {
  feuilletsAuxiliaryPathFor,
  detectProjectStructureLocale,
  getProjectFolder,
  flattenFiles,
  candidateLocalesForProject,
  isStructuredManuscriptRoot,
} from "./folder-structure.js";
import { FALLBACK_LOCALE, type Locale } from "../i18n/index.js";
import { projectCreationNames } from "../i18n/project-creation.js";
import { DEFAULT_SETTINGS } from "../default-settings.js";

const UNDERSCORED_RESEARCH_ROOT_NAMES = ["_Recherche", "_Research"] as const;
const CHRONO_FOLDER_NAMES = ["Événements", "Chronologie", "Events", "Timeline", "Chronology", "_Chronologie"] as const;

/** Dossier des jalons historiques : le chemin configuré d'abord, puis
 * les emplacements historiques, pour ne casser aucun coffre existant. */
export function getChronoFolder(app: App, settings: FeuilletsSettings): TFolder | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const candidates = [
    settings.chronoFolder || "_Recherche/Chronologie",
    "_Chronologie",
  ];
  /* deux bases possibles : _Recherche À L'INTÉRIEUR du dossier projet
     (hypothèse d'origine), ou À CÔTÉ de lui — nécessaire dès que le
     dossier projet pointe directement sur le sous-dossier "Manuscrit"
     (requis pour un calcul correct des rôles par profondeur), auquel
     cas _Recherche est un voisin de Manuscrit, pas un enfant. */
  const bases = [root.path, root.parent ? root.parent.path : null].filter(
    (path): path is string => Boolean(path)
  );
  for (const base of bases) {
    for (const rel of candidates) {
      const f = app.vault.getAbstractFileByPath(
        normalizePath(`${base}/${rel}`)
      );
      if (f instanceof TFolder) return f;
    }
  }
  const researchRoot = getResearchRoot(app, settings);
  if (researchRoot) {
    for (const name of CHRONO_FOLDER_NAMES) {
      const f = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${name}`));
      if (f instanceof TFolder) return f;
    }
  }
  return null;
}

/** Research root folder for an explicit project. */
export function getResearchRootForProject(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  fallbackLocale?: Locale
): TFolder | null {
  const orderedLocales = candidateLocalesForProject(projectRoot, fallbackLocale);
  for (const locale of orderedLocales) {
    const canonical = app.vault.getAbstractFileByPath(
      feuilletsAuxiliaryPathFor(projectRoot, "research", projectCreationNames(locale))
    );
    if (canonical instanceof TFolder) return canonical;
  }
  for (const name of UNDERSCORED_RESEARCH_ROOT_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${projectRoot.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
  /* "Recherche"/"Research" without underscore: recognized ONLY next to
     the project folder, never inside it — inside, the absence of a prefix
     would make it appear as a false Part in the manuscript,
     which is exactly what the underscore exists to prevent.
     Inspect projectRoot.parent ONLY when projectRoot is a recognized structured
     manuscript root (e.g. Project/Manuscrit), never for an adopted/free project root. */
  if (
    isStructuredManuscriptRoot(projectRoot) &&
    projectRoot.parent &&
    projectRoot.parent.path !== "" &&
    projectRoot.parent.path !== "/"
  ) {
    const legacySiblingNames = orderedLocales[0] === "en"
      ? ["_Research", "Research", "_Recherche", "Recherche"]
      : ["_Recherche", "Recherche", "_Research", "Research"];
    for (const name of legacySiblingNames) {
      const f = app.vault.getAbstractFileByPath(
        normalizePath(`${projectRoot.parent.path}/${name}`)
      );
      if (f instanceof TFolder) return f;
    }
  }
  return null;
}

/** Dossier racine de la recherche (parent du dossier de chronologie) —
 * sert à reconnaître qu'un lien pointe vers une fiche personnage/lieu. */
export function getResearchRoot(app: App, settings: FeuilletsSettings): TFolder | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  return getResearchRootForProject(app, settings, root);
}

/** Chemin du dossier de recherche à utiliser pour une ÉCRITURE (création) :
 * reprend le dossier déjà présent sur le disque quel que soit son nom,
 * sinon utilise la langue structurelle du projet. */
export function researchFolderPath(
  app: App,
  settings: FeuilletsSettings,
  root: TFolder | null | undefined,
  fallbackLocale?: Locale
): string | null {
  if (!root) return null;
  const existing = getResearchRootForProject(app, settings, root, fallbackLocale);
  if (existing) return existing.path;
  for (const name of UNDERSCORED_RESEARCH_ROOT_NAMES) {
    const candidate = app.vault.getAbstractFileByPath(normalizePath(`${root.path}/${name}`));
    if (candidate instanceof TFolder) return candidate.path;
  }
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const projectLocale = detectProjectStructureLocale(app, root, fallback);
  return feuilletsAuxiliaryPathFor(root, "research", projectCreationNames(projectLocale));
}

/** Chemin de la rubrique Chronologie à utiliser pour une écriture. Une
 * rubrique existante garde toujours la priorité ; sinon la racine Recherche
 * est résolue par la politique V2 avant de choisir un nom de rubrique. */
export function chronologyFolderPath(
  app: App,
  settings: FeuilletsSettings,
  root: TFolder | null | undefined,
  fallbackLocale?: Locale
): string | null {
  const existing = getChronoFolder(app, settings);
  if (existing) return existing.path;
  if (settings.chronoFolder && settings.chronoFolder !== DEFAULT_SETTINGS.chronoFolder) {
    return settings.chronoFolder;
  }
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const researchPath = researchFolderPath(app, settings, root, fallback);
  if (!researchPath || !root) return null;
  const projectLocale = detectProjectStructureLocale(app, root, fallback);
  const preferredName = projectCreationNames(projectLocale).researchSections.events;
  return normalizePath(`${researchPath}/${preferredName}`);
}

/** Déplace les anciennes rubriques de Recherche vers une racine déjà
 * résolue par researchFolderPath(). La politique de destination (canonique,
 * legacy, ou création V2) reste donc hors de cette opération mécanique. */
export async function migrateLegacyResearchEntries(
  app: App,
  root: TFolder,
  destinationRoot: string
): Promise<{ moved: number; collisions: Array<{ from: string; to: string }> }> {
  const searchBases = [root.path, root.parent ? root.parent.path : null].filter(
    (path): path is string => Boolean(path)
  );
  const moves = [
    ["_Personnages", "Personnages"],
    ["_Lieux", "Lieux"],
    ["_Chronologie", "Chronologie"],
    ["Personnages.base", "Personnages.base"],
    ["Lieux.base", "Lieux.base"],
  ];
  const collisions: Array<{ from: string; to: string }> = [];
  let moved = 0;
  for (const [from, to] of moves) {
    let src: TFile | TFolder | null = null;
    for (const base of searchBases) {
      const candidate = app.vault.getAbstractFileByPath(normalizePath(`${base}/${from}`));
      if (candidate instanceof TFile || candidate instanceof TFolder) {
        src = candidate;
        break;
      }
    }
    if (!src) continue;
    const destination = normalizePath(`${destinationRoot}/${to}`);
    if (app.vault.getAbstractFileByPath(destination)) {
      collisions.push({ from, to });
      continue;
    }
    await app.fileManager.renameFile(src, destination);
    moved++;
  }
  return { moved, collisions };
}

/** Free-form Research rubric dedicated to notes created from the Notebook
 * (Canvas bridge, see services/canvas-bridge.ts) — "Carnet" in French,
 * "Notebook" in English, both derived from the single source of truth for
 * creation names (src/i18n/project-creation.ts), never a second hardcoded
 * catalogue here. Recognized as EQUIVALENTS: an Obsidian language change
 * must never create duplicate rubrics; whichever is already present is
 * always reused as-is. */
const NOTEBOOK_FOLDER_VARIANTS: readonly string[] = [
  projectCreationNames("fr").notebook,
  projectCreationNames("en").notebook,
];

/** Name of the Notebook rubric for the given locale (defaults to FALLBACK_LOCALE = "en")
 * when none exists yet — never used to DECIDE whether an existing folder is
 * recognized (see `isNotebookRubricName`/`findNotebookResearchFolder`, which
 * accept both names), only to know which one to CREATE. Never calls getLocale(). */
export function notebookFolderName(locale: Locale = FALLBACK_LOCALE): string {
  return projectCreationNames(locale).notebook;
}

/** Vrai si `name` est l'un des noms reconnus de la rubrique Carnet/Notebook
 * (comparaison exacte, comme les autres rubriques de Recherche — voir
 * researchFolderNames, utils/project-modes.js). Fonction pure, exportée
 * pour les tests. */
export function isNotebookRubricName(name: string): boolean {
  return NOTEBOOK_FOLDER_VARIANTS.includes(name);
}

/** Dossier Carnet/Notebook déjà présent sous la racine Recherche du projet
 * actif, quel que soit son nom (FR ou EN) — jamais créé ici, seulement
 * reconnu. `null` si aucun des deux n'existe encore. */
export function findNotebookResearchFolder(
  app: App,
  settings: FeuilletsSettings,
  fallbackLocale?: Locale
): TFolder | null {
  const root = getProjectFolder(app, settings);
  const basePath = researchFolderPath(app, settings, root, fallbackLocale);
  if (!basePath) return null;
  const orderedLocales = candidateLocalesForProject(root, fallbackLocale);
  for (const loc of orderedLocales) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${basePath}/${projectCreationNames(loc).notebook}`));
    if (f instanceof TFolder) return f;
  }
  for (const name of NOTEBOOK_FOLDER_VARIANTS) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${basePath}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Garantit la rubrique Carnet/Notebook : réutilise celle déjà présente
 * (FR ou EN, quelle que soit la langue active), sinon crée celle qui
 * correspond à la langue structurelle du projet — jamais les deux à la fois.
 * Ne crée jamais un doublon "Carnet" + "Notebook" au fil des changements de
 * langue. `null` seulement si aucune racine Recherche n'est déterminable
 * (pas de projet actif). */
export async function ensureNotebookResearchFolder(
  app: App,
  settings: FeuilletsSettings,
  fallbackLocale?: Locale
): Promise<TFolder | null> {
  const existing = findNotebookResearchFolder(app, settings, fallbackLocale);
  if (existing) return existing;
  const root = getProjectFolder(app, settings);
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const basePath = researchFolderPath(app, settings, root, fallback);
  if (!basePath) return null;
  const researchFile = app.vault.getAbstractFileByPath(basePath);
  let projectLocale: Locale;
  if (researchFile instanceof TFolder && (researchFile.name === "Research" || researchFile.name === "_Research")) {
    projectLocale = "en";
  } else if (researchFile instanceof TFolder && (researchFile.name === "Recherche" || researchFile.name === "_Recherche")) {
    projectLocale = "fr";
  } else {
    projectLocale = root ? detectProjectStructureLocale(app, root, fallback) : fallback;
  }
  const path = normalizePath(`${basePath}/${notebookFolderName(projectLocale)}`);
  let base = app.vault.getAbstractFileByPath(basePath);
  if (!base) base = await app.vault.createFolder(basePath);
  if (!(base instanceof TFolder)) return null;
  const created = app.vault.getAbstractFileByPath(path) || (await app.vault.createFolder(path));
  return created instanceof TFolder ? created : null;
}

/** Vrai si `path` se trouve sous la rubrique Carnet/Notebook (FR ou EN)
 * effectivement présente sur le disque — sert à distinguer une fiche
 * Recherche encore "libre" (créée depuis le Carnet, jamais classée par
 * l'auteur) d'une fiche déjà rangée ailleurs (Personnages, Lieux…). Le
 * Carnet lui-même ne s'en sert plus pour déplacer quoi que ce soit
 * automatiquement (une arête n'a aucun effet métier) ; ce prédicat reste
 * utile pour d'autres usages généraux de Recherche. */
export function isUnderNotebookResearchFolder(app: App, settings: FeuilletsSettings, path: string): boolean {
  const folder = findNotebookResearchFolder(app, settings);
  if (!folder) return false;
  return path === folder.path || path.startsWith(`${folder.path}/`);
}

/** Renomme un fichier de recherche encore sous son nom provisoire dès
 * que `nom`/`prénom` (personnage) ou `titre` (lieu, événement) est
 * rempli. Ne touche jamais un fichier déjà renommé manuellement — la
 * détection se fait sur le nom de fichier "Nouveau X" par défaut. */
export async function maybeRenameResearchFile(app: App, settings: FeuilletsSettings, file: TFile | null | undefined): Promise<void> {
  if (!(file instanceof TFile) || file.extension !== "md") return;
  const researchRoot = getResearchRoot(app, settings);
  if (!researchRoot || !file.path.startsWith(researchRoot.path + "/"))
    return;
  const placeholder = /^(Nouveau personnage|Nouveau lieu|Nouvel événement|Nouvelle entrée)( \d+)?$/;
  if (!placeholder.test(file.basename)) return;
  const desired = titleFor(app, file);
  if (!desired || desired === file.basename) return;
  const safe = desired.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 100);
  if (!safe) return;
  const destPath = normalizePath(`${file.parent!.path}/${safe}.md`);
  if (app.vault.getAbstractFileByPath(destPath)) return;
  try {
    await app.fileManager.renameFile(file, destPath);
  } catch (e) {
    console.warn("Feuillets : renommage automatique impossible.", e);
  }
}

/** Tags qui identifient une fiche (personnage, lieu…) dans le manuscrit :
 * ses propres tags, moins les tags structurels de catégorie
 * (personnage/lieu/evenement/codex), repliés sans accent/casse. À défaut
 * d'un tag propre, le nom normalisé de la fiche sert d'identifiant —
 * aucune configuration n'est donc obligatoire pour que ça fonctionne. */
export function entityMatchTags(app: App, entityFile: TFile): string[] {
  const STRUCTURAL = new Set(["personnage", "lieu", "evenement", "codex"]);
  const own = tagsOf(app, entityFile)
    .map((t) => foldAccents(t))
    .filter((t) => !STRUCTURAL.has(t));
  if (own.length > 0) return own;
  const slug = foldAccents(titleFor(app, entityFile)).replace(/\s+/g, "");
  return slug ? [slug] : [];
}

export function entityMatchNames(app: App, entityFile: TFile): string[] {
  const fm = fmOf(app, entityFile);
  const names = new Set<string>();
  const lastName = fm.last_name as string | undefined;
  const firstName = fm.first_name as string | undefined;

  const title = titleFor(app, entityFile);
  if (title && title.length >= 3) {
    names.add(title.trim().toLowerCase());
  }

  if (lastName && lastName.trim().length >= 3) {
    names.add(lastName.trim().toLowerCase());
  }

  if (firstName && firstName.trim().length >= 3) {
    names.add(firstName.trim().toLowerCase());
  }

  // Ajout des mots individuels distincts pour le prénom/nom
  if (title) {
    const parts = title.split(/[\s'-]+/);
    for (const p of parts) {
      if (p.length >= 3 && !["les", "des", "une", "aux", "van", "der", "von", "de", "le", "la", "du", "et", "un"].includes(p.toLowerCase())) {
        names.add(p.toLowerCase());
      }
    }
  }

  return [...names];
}

export async function findAppearances(app: App, settings: FeuilletsSettings, entityFile: TFile): Promise<Array<{ file: TFile; excerpt: string; via: "lien" | "nom" | "tag" }>> {
  const root = getProjectFolder(app, settings);
  if (!root) return [];
  const files = flattenFiles(app, settings, root); // déjà dans l'ordre du manuscrit
  const matchTags = new Set(entityMatchTags(app, entityFile));
  const matchNames = entityMatchNames(app, entityFile);
  const resolved = app.metadataCache.resolvedLinks || {};
  const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const results: Array<{ file: TFile; excerpt: string; via: "lien" | "nom" | "tag" }> = [];

  // Frontières Unicode : `\b` ne considère pas les lettres accentuées comme
  // des caractères de mot. Les lookarounds conservent les offsets du texte.
  let nameRegex: RegExp | null = null;
  if (matchNames.length > 0) {
    const escaped = matchNames.map(n => n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    nameRegex = new RegExp(`(?<![\\p{L}\\p{N}_])(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "iu");
  }

  for (const f of files) {
    const viaTag =
      matchTags.size > 0 &&
      tagsOf(app, f).some((t) => matchTags.has(foldAccents(t)));

    const links = resolved[f.path];
    const viaLink = !!(links && links[entityFile.path]);

    let viaName = false;
    const raw = await app.vault.cachedRead(f);
    const body = stripFrontmatter(raw);

    if (nameRegex && nameRegex.test(body)) {
      viaName = true;
    }

    if (!viaTag && !viaLink && !viaName) continue;

    let excerpt = "";
    const via: "lien" | "nom" | "tag" = viaLink ? "lien" : (viaName ? "nom" : "tag");

    if (viaLink) {
      linkRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(body)) !== null) {
        const dest = app.metadataCache.getFirstLinkpathDest(
          m[1].trim(),
          f.path
        );
        if (dest && dest.path === entityFile.path) {
          const start = Math.max(0, m.index - 80);
          const end = Math.min(body.length, m.index + m[0].length + 80);
          excerpt =
            (start > 0 ? "…" : "") +
            body.slice(start, end).trim().replace(/\s+/g, " ") +
            (end < body.length ? "…" : "");
          break;
        }
      }
    } else if (viaName && nameRegex) {
      nameRegex.lastIndex = 0;
      const m = nameRegex.exec(body);
      if (m) {
        const start = Math.max(0, m.index - 80);
        const end = Math.min(body.length, m.index + m[0].length + 80);
        excerpt =
          (start > 0 ? "…" : "") +
          body.slice(start, end).trim().replace(/\s+/g, " ") +
          (end < body.length ? "…" : "");
      }
    }

    if (!excerpt) {
      /* pas de lien littéral (ou seulement un tag) : le synopsis de la
         scène sert de repère, à défaut d'un passage précis à montrer */
      const syn = fmOf(app, f, settings).synopsis;
      if (typeof syn === "string" && syn.trim()) excerpt = syn.trim();
    }
    results.push({ file: f, excerpt, via });
  }
  return results;
}

const RESEARCH_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"]);
const RESEARCH_DOCUMENT_EXTS = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "tsv",
  "ppt",
  "pptx",
  "odp",
  "epub",
  "bib",
]);
/** Fichiers structurés natifs d'Obsidian (Canvas, Base) : jamais du texte
 * libre, jamais un « document » au sens RESEARCH_DOCUMENT_EXTS — reconnus à
 * part pour garder à chaque ensemble un sens honnête. */
const RESEARCH_STRUCTURED_EXTS = new Set(["canvas", "base"]);

/** Single source of truth for "is this extension one Research recognizes" —
 * case-insensitive, takes a bare extension (no leading dot). Shared by
 * isResearchFile (below), the file-picker `accept` attribute, and the
 * post-selection validation of imported files (see
 * services/research-import.ts) — never a second, divergent extension list. */
export function isResearchExtension(extension: string): boolean {
  const ext = extension.toLowerCase();
  return ext === "md" || RESEARCH_DOCUMENT_EXTS.has(ext) || RESEARCH_IMAGE_EXTS.has(ext) || RESEARCH_STRUCTURED_EXTS.has(ext);
}

/** Every extension Research recognizes, without a leading dot — used to
 * build the native file-picker `accept` attribute (services/research-
 * import.ts). Order is not meaningful; content mirrors isResearchExtension
 * exactly, since both read the same three sets. */
export function researchAcceptedExtensions(): string[] {
  return ["md", ...RESEARCH_IMAGE_EXTS, ...RESEARCH_DOCUMENT_EXTS, ...RESEARCH_STRUCTURED_EXTS];
}

/** Returns whether a file can be shown in Research surfaces.
 * Attachments are still opened by Obsidian so the registered viewer can
 * handle their extension. */
export function isResearchFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  return isResearchExtension(file.extension);
}

/** Returns whether the file must open in an Obsidian view instead of the
 * editable Markdown sheet embedded in the Research panel. */
export function isResearchAttachment(file: unknown): boolean {
  return isResearchFile(file) && file.extension.toLowerCase() !== "md";
}

/** Fichier de dessin Excalidraw : un `.md` ordinaire pour tout le reste du
 * plugin (isResearchFile/isResearchAttachment le traitent comme n'importe
 * quelle fiche Markdown, jamais modifiés ici) — reconnu seulement pour lui
 * donner une icône distincte dans Recherche. Reconnaît aussi une variante
 * renommée par collision (« Dessin.excalidraw 1.md » — le suffixe numéroté
 * s'insère AVANT « .md », voir uniqueFileName/nextAvailablePromotedDraftPath,
 * jamais après) : un simple `.endsWith(".excalidraw.md")` la manquerait.
 * L'ouverture reste celle, déjà existante, du greffon Excalidraw natif :
 * jamais changée ici. */
export function isExcalidrawMarkdownFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  if (file.extension.toLowerCase() !== "md") return false;
  return /\.excalidraw(?: \d+)?\.md$/i.test(file.name);
}

/** Returns the Lucide icon that best identifies a Research file family.
 * `pencil` (jamais `pencil-ruler`, absent des icônes Obsidian sûres) pour
 * un dessin Excalidraw. */
export function researchFileIcon(file: TFile): string {
  const ext = file.extension.toLowerCase();
  if (RESEARCH_IMAGE_EXTS.has(ext)) return "image";
  if (["xls", "xlsx", "ods", "csv", "tsv"].includes(ext)) return "table-2";
  if (["ppt", "pptx", "odp"].includes(ext)) return "presentation";
  if (ext === "epub") return "book-open";
  if (ext === "canvas") return "layout-dashboard";
  if (ext === "base") return "database";
  if (isExcalidrawMarkdownFile(file)) return "pencil";
  return "file-text";
}

/** Indicateur textuel fixe (« PDF », « DOCX »…) pour les fichiers
 * documentaires non Markdown dont l'icône générique Lucide ne se
 * distingue pas d'un simple document — remplace researchFileIcon() dans la
 * colonne icône des lignes Recherche (renderResearchFileRow) pour CES
 * extensions précises. Jamais pour une image, un Canvas, une Base ou un
 * dessin Excalidraw : ceux-ci gardent leur icône dédiée. `null` si `file`
 * n'appartient pas à RESEARCH_DOCUMENT_EXTS. */
export function researchFileTypeLabel(file: unknown): string | null {
  if (!(file instanceof TFile)) return null;
  const ext = file.extension.toLowerCase();
  return RESEARCH_DOCUMENT_EXTS.has(ext) ? ext.toUpperCase() : null;
}

/** Indique si un fichier est un média image supporté. */
export function isImageFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  return RESEARCH_IMAGE_EXTS.has(file.extension.toLowerCase());
}

/** Source UNIQUE du Markdown produit pour insérer un fichier Recherche dans
 * un feuillet — partagée par tous les flux d'insertion de lien qui restent
 * après la simplification des lignes Recherche (aujourd'hui : le payload
 * `text/plain` du glisser-déposer, voir attachResearchDragSource). Le
 * chemin Vault reste TOUJOURS complet (jamais le seul nom, pour ne créer
 * aucun lien ambigu — Obsidian entretient ensuite ce lien lui-même aux
 * renommages/déplacements) ; seul ce qui s'AFFICHE change : une image
 * s'incruste (`![[chemin]]`), tout le reste se lie avec le nom de fichier
 * en alias (`[[chemin|nom]]`) pour ne jamais exposer le chemin complet
 * dans le texte du feuillet. */
export function researchFileLinkMarkdown(file: TFile): string {
  /* Vérifie l'extension directement plutôt que via isImageFile(file) : ce
     prédicat `file is TFile` ne narrows rien d'utile ici (`file` est déjà
     un TFile) et fait dégénérer la branche "faux" en `never` dès qu'elle
     accède à `file.path`/`file.name` — un vrai piège TypeScript, pas
     seulement un style différent. */
  const isEmbed = RESEARCH_IMAGE_EXTS.has(file.extension.toLowerCase());
  return isEmbed ? `![[${file.path}]]` : `[[${file.path}|${file.name}]]`;
}

/** Indique si un fichier est un document PDF. */
export function isPdfFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  return file.extension.toLowerCase() === "pdf";
}

/** Décision UNIQUE et centralisée pour le bouton œil des lignes Recherche
 * (addPreviewBtn) — « prévisualisable » signifie ici : le mécanisme natif
 * d'aperçu d'Obsidian (Aperçu de page / hover-link) sait effectivement
 * afficher ce type. Couvre le Markdown (fiche ordinaire ou dessin
 * Excalidraw — y compris une variante renommée par collision comme
 * « Dessin.excalidraw 1.md » : l'extension reste "md" dans tous les cas,
 * aucun cas particulier à écrire ici), les images supportées, le PDF, le
 * Canvas et la Base. Jamais DOCX/ODT/EPUB/tableur/présentation/RTF —
 * Obsidian n'a pas d'aperçu natif pour ces formats. Utilisé par la SEULE
 * ligne de rendu de fichier Recherche (renderResearchFileRow), donc déjà
 * partagée par les rubriques, les sous-dossiers et les dossiers associés. */
export function isResearchPreviewable(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  const ext = file.extension.toLowerCase();
  return ext === "md" || ext === "pdf" || ext === "canvas" || ext === "base" || RESEARCH_IMAGE_EXTS.has(ext);
}
