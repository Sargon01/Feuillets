import { TFolder, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { fmOf } from "./frontmatter.js";

type ProjectNode = TFile | TFolder;

export function getProjectFolder(app: App, settings: FeuilletsSettings | null | undefined): TFolder | null {
  if (!settings || !settings.projectFolder) return null;
  const raw = String(settings.projectFolder).trim();
  if (!raw || raw === "/" || raw === ".") return null;
  const path = normalizePath(raw);
  if (!path || path === "/" || path === ".") return null;
  const af = app.vault.getAbstractFileByPath(path);
  return (af instanceof TFolder && af.path !== "" && af.path !== "/") ? af : null;
}

/** Noms de dossiers conventionnels créés pour un NOUVEAU projet — une seule
 * source de vérité, réutilisée par createMinimalProject (project-files.ts)
 * et le projet de démonstration (demo-project.ts). Ne gouverne que la
 * CRÉATION : la RECONNAISSANCE d'un dossier déjà existant sous un autre nom
 * (Research/Resources en anglais, _Recherche hérité…) reste assurée
 * ailleurs (getResourcesRoot ci-dessous, getResearchRoot dans research.ts)
 * et n'est jamais court-circuitée par ces constantes. */
export const MANUSCRIPT_FOLDER_NAME = "Manuscrit";
export const FRONT_FOLDER_NAME = "Front";
export const RESEARCH_FOLDER_NAME = "Recherche";
export const RESOURCES_FOLDER_NAME = "Ressources";
export const RESOURCES_SUBFOLDER_NAMES = {
  images: "Images",
  template: "Template",
  layout: "Layout",
  export: "Export",
  assets: "Assets",
} as const;

/** Racine éditoriale du projet : le dossier Manuscrit — ce que le Binder,
 * les vues Cartes/Plan et la compilation utilisent, et ce que
 * `settings.projectFolder` pointe historiquement (jamais la racine réelle
 * du projet). Simple alias explicite de getProjectFolder : donne un nom
 * sans ambiguïté au code qui distingue volontairement les deux racines
 * (createMinimalProject, documentation), sans renommer les ~90 appels
 * existants à getProjectFolder à travers ~35 fichiers — un renommage pur
 * n'apporterait rien et risquerait une régression sans rapport avec cette
 * tâche. */
export const getManuscriptRoot = getProjectFolder;

/** Racine réelle du projet : le dossier qui contient Manuscrit, Recherche
 * et Ressources en frères — un cran au-dessus de ce que `getManuscriptRoot`
 * renvoie. C'est sous cette racine qu'un nouveau projet est créé
 * (createMinimalProject). Pour un ancien projet sans dossier de volume
 * distinct (Manuscrit directement à la racine du coffre), il n'y a pas de
 * racine "réelle" différente à trouver : le parent de Manuscrit est renvoyé
 * tel quel, sans rien déplacer ni renommer sur le disque. */
export function getProjectRoot(app: App, settings: FeuilletsSettings | null | undefined): TFolder | null {
  const manuscrit = getManuscriptRoot(app, settings);
  if (!manuscrit) return null;
  return manuscrit.parent instanceof TFolder ? manuscrit.parent : manuscrit;
}

/** Un SEUL projet a-t-il jamais été créé ou ajouté, actif ou non — décide
 * si le Binder montre le vrai écran d'accueil (premier lancement, aucun
 * projet connu du tout) ou le gestionnaire de projets habituel (au moins un
 * projet déjà connu, même désactivé : "premier projet" ne voudrait plus
 * rien dire). Ne vérifie pas que le dossier existe encore sur le disque —
 * c'est `getProjectFolder`/la liste affichée qui gèrent ce cas (ligne "…
 * introuvable"), pas cette décision d'affichage. */
export function hasKnownProject(settings: FeuilletsSettings | null | undefined): boolean {
  if (!settings) return false;
  return !!(settings.projectFolder || (settings.projects && settings.projects.length > 0));
}

/** Nom affiché d'un projet : le dossier de volume (parent), pas
 * "Manuscrit" — sinon tous les projets s'appellent pareil dès qu'on
 * suit la convention Manuscrit/Recherche/Snapshots en frères. Repli sur
 * le dernier segment si le chemin ne suit pas cette convention. */
export function projectDisplayName(path: string): string {
  const parts = normalizePath(path || "").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === "manuscrit" && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return last;
}

/** Dossier "Ressources" (modèles, exports personnalisés, images…), voisin
 * du dossier projet — "Ressources" pour les nouveaux projets, "Resources"
 * (anglais, ancien nom "nouveau") comme "Ressources" (nom historique
 * français) restent reconnus indéfiniment sur les projets déjà créés sous
 * l'un ou l'autre (même principe que LEGACY_FIELD_ALIASES en frontmatter,
 * appliqué ici à un vrai dossier : jamais renommé de force sur le disque). */
export function getResourcesRoot(app: App, root: TFolder | null | undefined): TFolder | null {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const en = app.vault.getAbstractFileByPath(normalizePath(`${base}/Resources`));
  if (en instanceof TFolder) return en;
  const fr = app.vault.getAbstractFileByPath(normalizePath(`${base}/${RESOURCES_FOLDER_NAME}`));
  if (fr instanceof TFolder) return fr;
  return null;
}

export function resourcesFolderPath(app: App, root: TFolder): string;
export function resourcesFolderPath(app: App, root: null | undefined): null;
/** Chemin du dossier Ressources à utiliser pour une ÉCRITURE (création
 * d'un fichier/sous-dossier dedans) : reprend le dossier déjà présent sur
 * le disque quel que soit son nom, sinon RESOURCES_FOLDER_NAME ("Ressources",
 * nouveaux projets). */
export function resourcesFolderPath(app: App, root: TFolder | null | undefined): string | null {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const existing = getResourcesRoot(app, root);
  return existing ? existing.path : normalizePath(`${base}/${RESOURCES_FOLDER_NAME}`);
}

/** Sous-dossier de Ressources dont le nom a changé (Visuels->Assets,
 * Modèles->Layouts) : reprend le nom déjà présent sur le disque s'il y en
 * a un, sinon le nouveau nom anglais. */
/** `legacyNames` accepte un ou plusieurs anciens noms, dans l'ordre où ils
 * ont été le nom "actuel" au fil des versions (ex. Layout a remplacé
 * Layouts, qui avait lui-même remplacé Modèles) — chacun reste reconnu
 * indéfiniment, quelle que soit la version qui a créé le dossier. */
export function resourcesSubfolderPath(app: App, resourcesPath: string, newName: string, ...legacyNames: string[]): string {
  for (const name of [newName, ...legacyNames]) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${resourcesPath}/${name}`));
    if (f instanceof TFolder) return f.path;
  }
  return normalizePath(`${resourcesPath}/${newName}`);
}

export function depthOf(app: App, settings: FeuilletsSettings, node: ProjectNode): number {
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

export function isFrontMatter(app: App, settings: FeuilletsSettings, node: ProjectNode): boolean {
  const root = getProjectFolder(app, settings);
  if (!root) return false;
  const p = normalizePath(`${root.path}/${FRONT_FOLDER_NAME}`);
  return node.path === p || node.path.startsWith(`${p}/`);
}

export function roleOfFolder(app: App, settings: FeuilletsSettings, folder: TFolder): "chapitre" | "partie" {
  const d = depthOf(app, settings, folder);
  if (d >= 2) return "chapitre";
  return settings.level1Role === "chapitres" ? "chapitre" : "partie";
}

export function roleOfFile(app: App, settings: FeuilletsSettings, file: TFile): "chapitre" | "scene" {
  const parent = file.parent;
  const root = getProjectFolder(app, settings);
  if (!root || !parent || parent.path === root.path) return "chapitre";
  return roleOfFolder(app, settings, parent) === "chapitre" ? "scene" : "chapitre";
}

/** Un dossier préfixé « _ » (recherche, fiches, chronologie…) est exclu
 * du manuscrit : ni numéroté, ni compilé, ni affiché dans aucune vue.
 * `includeHidden` reste disponible pour les cas internes qui doivent
 * malgré tout parcourir ces dossiers (ex. tout-plier). */
export function getOrderedChildren(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder | null | undefined,
  includeHidden = false
): ProjectNode[] {
  if (!folder || !(folder instanceof TFolder) || !Array.isArray(folder.children)) return [];
  const children = folder.children.filter(
    (c): c is ProjectNode =>
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

  const posOf = (c: ProjectNode): number | null => {
    if (c instanceof TFile) {
      const o = parseInt(String(fmOf(app, c).order), 10);
      return isNaN(o) ? null : o;
    }
    const o = settings.folderPositions[c.path];
    return typeof o === "number" ? o : null;
  };

  return children.sort((a, b) => {
    const ia = savedIndex.has(a.name) ? savedIndex.get(a.name)! : null;
    const ib = savedIndex.has(b.name) ? savedIndex.get(b.name)! : null;
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

export function flattenFiles(app: App, settings: FeuilletsSettings, folder: TFolder | null | undefined): TFile[] {
  if (!folder || !(folder instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (f: TFolder): void => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) walk(child);
      else out.push(child);
    }
  };
  walk(folder);
  return out;
}

export function chapterCount(app: App, settings: FeuilletsSettings, root: TFolder | null | undefined): number {
  if (!root || !(root instanceof TFolder)) return 0;
  let n = 0;
  const walk = (f: TFolder): void => {
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

export function getChapters(app: App, settings: FeuilletsSettings, root: TFolder | null | undefined): ProjectNode[] {
  if (!root || !(root instanceof TFolder)) return [];
  const chapters: ProjectNode[] = [];
  const walk = (f: TFolder): void => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (isFrontMatter(app, settings, child)) continue;
      if (child instanceof TFolder) {
        if (roleOfFolder(app, settings, child) === "chapitre") {
          chapters.push(child);
        }
        walk(child);
      } else if (roleOfFile(app, settings, child) === "chapitre") {
        chapters.push(child);
      }
    }
  };
  walk(root);
  return chapters;
}
