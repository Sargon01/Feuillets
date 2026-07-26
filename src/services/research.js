const { TFile, TFolder, normalizePath } = require("obsidian");
import { foldAccents } from "../utils/core.js";
import { fmOf, titleFor, tagsOf } from "./frontmatter.js";
import { getProjectFolder, flattenFiles } from "./folder-structure.js";

/** Dossier des jalons historiques : le chemin configuré d'abord, puis
 * les emplacements historiques, pour ne casser aucun coffre existant. */
export function getChronoFolder(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const candidates = [
    settings.chronoFolder || "_Recherche/Chronologie",
    "_Chronologie",
    "_Recherche/Chronologie",
  ];
  /* deux bases possibles : _Recherche À L'INTÉRIEUR du dossier projet
     (hypothèse d'origine), ou À CÔTÉ de lui — nécessaire dès que le
     dossier projet pointe directement sur le sous-dossier "Manuscrit"
     (requis pour un calcul correct des rôles par profondeur), auquel
     cas _Recherche est un voisin de Manuscrit, pas un enfant. */
  const bases = [root.path, root.parent ? root.parent.path : null].filter(
    Boolean
  );
  for (const base of bases) {
    for (const rel of candidates) {
      const f = app.vault.getAbstractFileByPath(
        normalizePath(`${base}/${rel}`)
      );
      if (f instanceof TFolder) return f;
    }
  }
  /* « Recherche » sans underscore : uniquement à côté du dossier projet,
     jamais dedans — même restriction que getResearchRoot. */
  if (root.parent) {
    const f = app.vault.getAbstractFileByPath(
      normalizePath(`${root.parent.path}/Recherche/Chronologie`)
    );
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Dossier racine de la recherche (parent du dossier de chronologie) —
 * sert à reconnaître qu'un lien pointe vers une fiche personnage/lieu. */
export function getResearchRoot(app, settings) {
  const chrono = getChronoFolder(app, settings);
  if (chrono && chrono.parent) return chrono.parent;
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const bases = [root.path, root.parent ? root.parent.path : null].filter(
    Boolean
  );
  for (const base of bases) {
    const f = app.vault.getAbstractFileByPath(
      normalizePath(`${base}/_Recherche`)
    );
    if (f instanceof TFolder) return f;
  }
  /* « Recherche » sans underscore : reconnu UNIQUEMENT à côté du dossier
     projet, jamais à l'intérieur — dedans, l'absence de préfixe le
     ferait apparaître comme une fausse Partie dans le manuscrit, exactement
     ce que l'underscore existe pour empêcher. */
  if (root.parent) {
    const f = app.vault.getAbstractFileByPath(
      normalizePath(`${root.parent.path}/Recherche`)
    );
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Renomme un fichier de recherche encore sous son nom provisoire dès
 * que `nom`/`prénom` (personnage) ou `titre` (lieu, événement) est
 * rempli. Ne touche jamais un fichier déjà renommé manuellement — la
 * détection se fait sur le nom de fichier "Nouveau X" par défaut. */
export async function maybeRenameResearchFile(app, settings, file) {
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
  const destPath = normalizePath(`${file.parent.path}/${safe}.md`);
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
export function entityMatchTags(app, entityFile) {
  const STRUCTURAL = new Set(["personnage", "lieu", "evenement", "codex"]);
  const own = tagsOf(app, entityFile)
    .map((t) => foldAccents(t))
    .filter((t) => !STRUCTURAL.has(t));
  if (own.length > 0) return own;
  const slug = foldAccents(titleFor(app, entityFile)).replace(/\s+/g, "");
  return slug ? [slug] : [];
}

export function entityMatchNames(app, entityFile) {
  const fm = fmOf(app, entityFile);
  const names = new Set();

  const title = titleFor(app, entityFile);
  if (title && title.length >= 3) {
    names.add(title.trim().toLowerCase());
  }

  if (fm.last_name && fm.last_name.trim().length >= 3) {
    names.add(fm.last_name.trim().toLowerCase());
  }

  if (fm.first_name && fm.first_name.trim().length >= 3) {
    names.add(fm.first_name.trim().toLowerCase());
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

export async function findAppearances(app, settings, entityFile) {
  const root = getProjectFolder(app, settings);
  if (!root) return [];
  const files = flattenFiles(app, settings, root); // déjà dans l'ordre du manuscrit
  const matchTags = new Set(entityMatchTags(app, entityFile));
  const matchNames = entityMatchNames(app, entityFile);
  const resolved = app.metadataCache.resolvedLinks || {};
  const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const results = [];

  // Regex globale avec frontières de mots
  let nameRegex = null;
  if (matchNames.length > 0) {
    const escaped = matchNames.map(n => n.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    nameRegex = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
  }

  for (const f of files) {
    const viaTag =
      matchTags.size > 0 &&
      tagsOf(app, f).some((t) => matchTags.has(foldAccents(t)));

    const links = resolved[f.path];
    const viaLink = !!(links && links[entityFile.path]);

    let viaName = false;
    const raw = await app.vault.cachedRead(f);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    if (nameRegex && nameRegex.test(body)) {
      viaName = true;
    }

    if (!viaTag && !viaLink && !viaName) continue;

    let excerpt = "";
    let via = viaLink ? "lien" : (viaName ? "nom" : "tag");

    if (viaLink) {
      linkRe.lastIndex = 0;
      let m;
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
export function isResearchFile(file) {
  if (!(file instanceof TFile)) return false;
  const ext = file.extension.toLowerCase();
  return ext === "md" || ext === "pdf" || RESEARCH_IMAGE_EXTS.has(ext);
}

/** Indique si un fichier est un média image supporté. */
export function isImageFile(file) {
  if (!(file instanceof TFile)) return false;
  return RESEARCH_IMAGE_EXTS.has(file.extension.toLowerCase());
}

/** Indique si un fichier est un document PDF. */
export function isPdfFile(file) {
  if (!(file instanceof TFile)) return false;
  return file.extension.toLowerCase() === "pdf";
}

