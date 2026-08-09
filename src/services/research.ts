import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { foldAccents } from "../utils/core.js";
import { fmOf, titleFor, tagsOf, stripFrontmatter } from "./frontmatter.js";
import { feuilletsAuxiliaryPath, getProjectFolder, flattenFiles } from "./folder-structure.js";
import { getLocale } from "../i18n/index.js";

const UNDERSCORED_RESEARCH_ROOT_NAMES = ["_Recherche", "_Research"] as const;
const SIBLING_RESEARCH_ROOT_NAMES = [...UNDERSCORED_RESEARCH_ROOT_NAMES, "Recherche", "Research"] as const;
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

/** Dossier racine de la recherche (parent du dossier de chronologie) —
 * sert à reconnaître qu'un lien pointe vers une fiche personnage/lieu. */
export function getResearchRoot(app: App, settings: FeuilletsSettings): TFolder | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "research"));
  if (canonical instanceof TFolder) return canonical;
  for (const name of UNDERSCORED_RESEARCH_ROOT_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${root.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
  /* « Recherche »/« Research » sans underscore : reconnu UNIQUEMENT à côté
     du dossier projet, jamais à l'intérieur — dedans, l'absence de préfixe
     le ferait apparaître comme une fausse Partie dans le manuscrit,
     exactement ce que l'underscore existe pour empêcher. */
  if (root.parent) {
    for (const name of SIBLING_RESEARCH_ROOT_NAMES) {
      const f = app.vault.getAbstractFileByPath(
        normalizePath(`${root.parent.path}/${name}`)
      );
      if (f instanceof TFolder) return f;
    }
  }
  return null;
}

/** Chemin du dossier de recherche à utiliser pour une ÉCRITURE (création) :
 * reprend le dossier déjà présent sur le disque quel que soit son nom,
 * sinon "Research" (nouveaux projets) — voisin du dossier manuscrit. */
export function researchFolderPath(app: App, settings: FeuilletsSettings, root: TFolder | null | undefined): string | null {
  const existing = getResearchRoot(app, settings);
  if (existing) return existing.path;
  if (root) {
    for (const name of UNDERSCORED_RESEARCH_ROOT_NAMES) {
      const candidate = app.vault.getAbstractFileByPath(normalizePath(`${root.path}/${name}`));
      if (candidate instanceof TFolder) return candidate.path;
    }
  }
  return root ? feuilletsAuxiliaryPath(root, "research") : null;
}

/** Rubrique libre de Recherche dédiée aux fiches créées depuis le Carnet
 * (pont Canvas, voir services/canvas-bridge.ts) — "Carnet" en français,
 * "Notebook" en anglais. Reconnus comme ÉQUIVALENTS : un changement de
 * langue d'Obsidian ne doit jamais créer les deux rubriques en double,
 * l'une ou l'autre déjà présente est toujours réutilisée telle quelle. */
const NOTEBOOK_FOLDER_NAMES = { fr: "Carnet", en: "Notebook" } as const;
const NOTEBOOK_FOLDER_VARIANTS = Object.values(NOTEBOOK_FOLDER_NAMES);

/** Nom de la rubrique Carnet/Notebook pour la locale active — jamais utilisé
 * pour DÉCIDER si un dossier existant est reconnu (voir
 * `isNotebookRubricName`/`findNotebookResearchFolder`, qui acceptent les
 * deux noms), seulement pour savoir lequel CRÉER quand aucun n'existe. */
export function notebookFolderName(): string {
  return getLocale() === "fr" ? NOTEBOOK_FOLDER_NAMES.fr : NOTEBOOK_FOLDER_NAMES.en;
}

/** Vrai si `name` est l'un des noms reconnus de la rubrique Carnet/Notebook
 * (comparaison exacte, comme les autres rubriques de Recherche — voir
 * researchFolderNames, utils/project-modes.js). Fonction pure, exportée
 * pour les tests. */
export function isNotebookRubricName(name: string): boolean {
  return (NOTEBOOK_FOLDER_VARIANTS as readonly string[]).includes(name);
}

/** Dossier Carnet/Notebook déjà présent sous la racine Recherche du projet
 * actif, quel que soit son nom (FR ou EN) — jamais créé ici, seulement
 * reconnu. `null` si aucun des deux n'existe encore. */
export function findNotebookResearchFolder(app: App, settings: FeuilletsSettings): TFolder | null {
  const root = getProjectFolder(app, settings);
  const basePath = researchFolderPath(app, settings, root);
  if (!basePath) return null;
  for (const name of NOTEBOOK_FOLDER_VARIANTS) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${basePath}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Garantit la rubrique Carnet/Notebook : réutilise celle déjà présente
 * (FR ou EN, quelle que soit la langue active), sinon crée celle qui
 * correspond à la locale actuelle — jamais les deux à la fois. Ne crée
 * jamais un doublon "Carnet" + "Notebook" au fil des changements de
 * langue. `null` seulement si aucune racine Recherche n'est déterminable
 * (pas de projet actif). */
export async function ensureNotebookResearchFolder(app: App, settings: FeuilletsSettings): Promise<TFolder | null> {
  const existing = findNotebookResearchFolder(app, settings);
  if (existing) return existing;
  const root = getProjectFolder(app, settings);
  const basePath = researchFolderPath(app, settings, root);
  if (!basePath) return null;
  const path = normalizePath(`${basePath}/${notebookFolderName()}`);
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
      const syn = fmOf(app, f).synopsis;
      if (typeof syn === "string" && syn.trim()) excerpt = syn.trim();
    }
    results.push({ file: f, excerpt, via });
  }
  return results;
}

const RESEARCH_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"]);

/** Indique si un fichier est pris en compte dans le panneau Recherche (markdown, image ou PDF). */
export function isResearchFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  const ext = file.extension.toLowerCase();
  return ext === "md" || ext === "pdf" || RESEARCH_IMAGE_EXTS.has(ext);
}

/** Indique si un fichier est un média image supporté. */
export function isImageFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  return RESEARCH_IMAGE_EXTS.has(file.extension.toLowerCase());
}

/** Indique si un fichier est un document PDF. */
export function isPdfFile(file: unknown): file is TFile {
  if (!(file instanceof TFile)) return false;
  return file.extension.toLowerCase() === "pdf";
}
