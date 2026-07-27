import { TFolder, TFile, normalizePath } from "obsidian";
import { fmOf } from "./frontmatter.js";

/**
 * @param {import("obsidian").App} app
 * @param {FeuilletsSettings | null | undefined} settings
 * @returns {TFolder | null}
 */
export function getProjectFolder(app, settings) {
  if (!settings || !settings.projectFolder) return null;
  const raw = String(settings.projectFolder).trim();
  if (!raw || raw === "/" || raw === ".") return null;
  const path = normalizePath(raw);
  if (!path || path === "/" || path === ".") return null;
  const af = app.vault.getAbstractFileByPath(path);
  return (af instanceof TFolder && af.path !== "" && af.path !== "/") ? af : null;
}

/**
 * @param {string} path
 * @returns {string}
 *
 * Nom affiché d'un projet : le dossier de volume (parent), pas
 * "Manuscrit" — sinon tous les projets s'appellent pareil dès qu'on
 * suit la convention Manuscrit/Recherche/Snapshots en frères. Repli sur
 * le dernier segment si le chemin ne suit pas cette convention. */
export function projectDisplayName(path) {
  const parts = normalizePath(path || "").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === "manuscrit" && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return last;
}

/**
 * @param {import("obsidian").App} app
 * @param {TFolder | null | undefined} root
 * @returns {TFolder | null}
 *
 * Dossier "Ressources" (modèles, exports personnalisés, images…), voisin
 * du dossier projet — "Resources" pour les nouveaux projets, l'ancien nom
 * français reconnu indéfiniment sur les projets déjà créés (même principe
 * que LEGACY_FIELD_ALIASES en frontmatter, appliqué ici à un vrai dossier :
 * jamais renommé de force sur le disque). */
export function getResourcesRoot(app, root) {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const en = app.vault.getAbstractFileByPath(normalizePath(`${base}/Resources`));
  if (en instanceof TFolder) return en;
  const fr = app.vault.getAbstractFileByPath(normalizePath(`${base}/Ressources`));
  if (fr instanceof TFolder) return fr;
  return null;
}

/**
 * @overload
 * @param {import("obsidian").App} app
 * @param {TFolder} root
 * @returns {string}
 */
/**
 * @overload
 * @param {import("obsidian").App} app
 * @param {null | undefined} root
 * @returns {null}
 */
/**
 * @param {import("obsidian").App} app
 * @param {TFolder | null | undefined} root
 * @returns {string | null}
 *
 * Chemin du dossier Ressources à utiliser pour une ÉCRITURE (création
 * d'un fichier/sous-dossier dedans) : reprend le dossier déjà présent sur
 * le disque quel que soit son nom, sinon "Resources" (nouveaux projets). */
export function resourcesFolderPath(app, root) {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const existing = getResourcesRoot(app, root);
  return existing ? existing.path : normalizePath(`${base}/Resources`);
}

/**
 * @param {import("obsidian").App} app
 * @param {string} resourcesPath
 * @param {string} newName
 * @param {string} legacyName
 * @returns {string}
 *
 * Sous-dossier de Ressources dont le nom a changé (Visuels->Assets,
 * Modèles->Layouts) : reprend le nom déjà présent sur le disque s'il y en
 * a un, sinon le nouveau nom anglais. */
export function resourcesSubfolderPath(app, resourcesPath, newName, legacyName) {
  const en = app.vault.getAbstractFileByPath(normalizePath(`${resourcesPath}/${newName}`));
  if (en instanceof TFolder) return en.path;
  const fr = app.vault.getAbstractFileByPath(normalizePath(`${resourcesPath}/${legacyName}`));
  if (fr instanceof TFolder) return fr.path;
  return normalizePath(`${resourcesPath}/${newName}`);
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFile | TFolder} node @returns {number} */
export function depthOf(app, settings, node) {
  const root = getProjectFolder(app, settings);
  if (!root) return 0;
  if (node.path === root.path) return 0;
  return node.path.slice(root.path.length + 1).split("/").length;
}

/** "Front" (page de titre, dédicace, préfaces, incipit…) : un dossier
 * enfant direct du projet, jamais numéroté ni compté comme chapitre —
 * ce n'est pas du texte du roman, juste ce qui vient avant. Reste visible
 * et manipulable normalement dans le binder (rôle "partie" pour
 * l'affichage), seule la numérotation l'ignore. */
/** Types de page Front reconnus (champ `type` du frontmatter) — chacun
 * reçoit un traitement d'export dédié (saut de page, centrage, pas de
 * titre/numérotation de chapitre) au lieu d'être compilé comme une scène
 * ordinaire. Voir compile-export.js (détection) et chaque export-*.js
 * (mise en forme propre au format). */
export const FRONT_PAGE_TYPES = ["titre", "dedicace", "epigraphe"];

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFile | TFolder} node @returns {boolean} */
export function isFrontMatter(app, settings, node) {
  const root = getProjectFolder(app, settings);
  if (!root) return false;
  const p = normalizePath(`${root.path}/Front`);
  return node.path === p || node.path.startsWith(`${p}/`);
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFolder} folder @returns {"chapitre" | "partie"} */
export function roleOfFolder(app, settings, folder) {
  const d = depthOf(app, settings, folder);
  if (d >= 2) return "chapitre";
  return settings.level1Role === "chapitres" ? "chapitre" : "partie";
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFile} file @returns {"chapitre" | "scene"} */
export function roleOfFile(app, settings, file) {
  const parent = file.parent;
  const root = getProjectFolder(app, settings);
  if (!root || !parent || parent.path === root.path) return "chapitre";
  return roleOfFolder(app, settings, parent) === "chapitre" ? "scene" : "chapitre";
}

/** Un dossier préfixé « _ » (recherche, fiches, chronologie…) est exclu
 * du manuscrit : ni numéroté, ni compilé, ni affiché dans aucune vue.
 * `includeHidden` reste disponible pour les cas internes qui doivent
 * malgré tout parcourir ces dossiers (ex. tout-plier). */
/**
 * @param {import("obsidian").App} app
 * @param {FeuilletsSettings} settings
 * @param {TFolder | null | undefined} folder
 * @param {boolean} [includeHidden]
 * @returns {(TFile | TFolder)[]}
 */
export function getOrderedChildren(app, settings, folder, includeHidden = false) {
  if (!folder || !(folder instanceof TFolder) || !Array.isArray(folder.children)) return [];
  const children = folder.children.filter(
    (c) =>
      (c instanceof TFolder &&
        !c.name.startsWith(".") &&
        (includeHidden || !c.name.startsWith("_"))) ||
      (c instanceof TFile &&
        c.extension === "md" &&
        c.name !== settings.compileFileName &&
        c.basename !== folder.name) // note de dossier (Partie I/Partie I.md) : jamais une scène
  );
  const saved = settings.orders[folder.path] || [];
  const savedIndex = new Map(saved.map((n, i) => [n, i]));

  const posOf = (c) => {
    if (c instanceof TFile) {
      const o = parseInt(fmOf(app, c).order, 10);
      return isNaN(o) ? null : o;
    }
    const o = settings.folderPositions[c.path];
    return typeof o === "number" ? o : null;
  };

  return children.sort((a, b) => {
    const ia = savedIndex.has(a.name) ? savedIndex.get(a.name) : null;
    const ib = savedIndex.has(b.name) ? savedIndex.get(b.name) : null;
    if (ia !== null && ib !== null && ia !== ib) return ia - ib;
    if (ia !== null && ib === null) return -1;
    if (ia === null && ib !== null) return 1;
    const pa = posOf(a);
    const pb = posOf(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFolder | null | undefined} folder @returns {TFile[]} */
export function flattenFiles(app, settings, folder) {
  if (!folder || !(folder instanceof TFolder)) return [];
  const out = [];
  const walk = (f) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) walk(child);
      else out.push(child);
    }
  };
  walk(folder);
  return out;
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFolder | null | undefined} root @returns {number} */
export function chapterCount(app, settings, root) {
  if (!root || !(root instanceof TFolder)) return 0;
  let n = 0;
  const walk = (f) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (isFrontMatter(app, settings, child)) continue; // jamais compté
      if (child instanceof TFolder) {
        if (roleOfFolder(app, settings, child) === "chapitre") n++;
        walk(child);
      } else if (roleOfFile(app, settings, child) === "chapitre") n++;
    }
  };
  walk(root);
  return n;
}

/** @param {import("obsidian").App} app @param {FeuilletsSettings} settings @param {TFolder | null | undefined} root @returns {(TFile | TFolder)[]} */
export function getChapters(app, settings, root) {
  if (!root || !(root instanceof TFolder)) return [];
  const chapters = [];
  const walk = (f) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (isFrontMatter(app, settings, child)) continue;
      if (child instanceof TFolder) {
        if (roleOfFolder(app, settings, child) === "chapitre") {
          chapters.push(child);
        }
        walk(child);
      } else {
        if (roleOfFile(app, settings, child) === "chapitre") {
          chapters.push(child);
        }
      }
    }
  };
  walk(root);
  return chapters;
}
