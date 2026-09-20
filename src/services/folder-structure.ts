import { TFolder, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { fmOf } from "./frontmatter.js";
import { naturalCompare } from "../utils/core.js";
import { projectCreationNames, type ProjectCreationNames } from "../i18n/project-creation.js";
import { FALLBACK_LOCALE, type Locale } from "../i18n/index.js";

type ProjectNode = TFile | TFolder;

/** Candidate locales in order of preference for the given project root:
 * 1. Manuscript-root structural language if identifiable (Manuscript -> "en", Manuscrit -> "fr").
 * 2. Explicitly passed fallback locale (defaults to FALLBACK_LOCALE = "en").
 * 3. The alternative locale. */
export function candidateLocalesForProject(
  root: TFolder | null | undefined,
  fallbackLocale?: Locale
): [Locale, Locale] {
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  if (root) {
    const nameLower = root.name.toLowerCase();
    if (nameLower === projectCreationNames("en").manuscript.toLowerCase()) {
      return ["en", "fr"];
    }
    if (nameLower === projectCreationNames("fr").manuscript.toLowerCase()) {
      return ["fr", "en"];
    }
  }
  return fallback === "fr" ? ["fr", "en"] : ["en", "fr"];
}

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
export const FEUILLETS_AUXILIARY_FOLDER_NAME = "_Feuillets";
export const FEUILLETS_AUXILIARY_FOLDERS = {
  research: "Recherche",
  resources: "Ressources",
  edition: "Edition",
  journal: "Journal",
  snapshots: "Snapshots",
  backups: "Backups",
  output: "Sortie",
  versions: "Versions",
  drafts: "Drafts",
} as const;

/** Every locale's manuscript folder name, derived once from the same
 * project-creation catalogue used for creation (src/i18n/project-creation.ts)
 * — never a second hardcoded name list. Used only to RECOGNIZE an existing
 * manuscript root regardless of which locale created it; never to decide
 * what to create (see createMinimalProject, services/project-files.ts,
 * which captures the active locale's name once per operation). */
const KNOWN_MANUSCRIPT_FOLDER_NAMES: readonly string[] = [
  projectCreationNames("fr").manuscript,
  projectCreationNames("en").manuscript,
];

export function isStructuredManuscriptRoot(root: TFolder | null | undefined): boolean {
  if (!root) return false;
  return KNOWN_MANUSCRIPT_FOLDER_NAMES.includes(root.name);
}

/** Base unique des nouveaux dossiers auxiliaires. Les emplacements
 * historiques restent traités par les résolveurs propres à chaque dossier. */
export function feuilletsAuxiliaryRootPath(root: TFolder): string {
  const parent = root.parent;
  const base = isStructuredManuscriptRoot(root)
    && parent instanceof TFolder
    && parent.path !== ""
    && parent.path !== "/"
    ? parent.path
    : root.path;
  return normalizePath(`${base}/${FEUILLETS_AUXILIARY_FOLDER_NAME}`);
}

export function feuilletsAuxiliaryPath(
  root: TFolder,
  kind: keyof typeof FEUILLETS_AUXILIARY_FOLDERS
): string {
  return normalizePath(`${feuilletsAuxiliaryRootPath(root)}/${FEUILLETS_AUXILIARY_FOLDERS[kind]}`);
}

/** Same path as `feuilletsAuxiliaryPath`, but the folder name comes from an
 * explicit, already-resolved project-creation catalogue (`names`) instead
 * of the hardcoded French default — for CREATION call sites that captured
 * the active locale once via `projectCreationNames(locale)`. Recognition of
 * an already-existing auxiliary folder (whichever locale created it) stays
 * the responsibility of each resolver (e.g. getResourcesRoot below), never
 * this function. */
export function feuilletsAuxiliaryPathFor(
  root: TFolder,
  kind: keyof typeof FEUILLETS_AUXILIARY_FOLDERS,
  names: ProjectCreationNames
): string {
  return normalizePath(`${feuilletsAuxiliaryRootPath(root)}/${names.auxiliary[kind]}`);
}
export const FEUILLETS_RESOURCE_FOLDERS = {
  images: "Images",
  templates: "Modèles",
  layouts: "Mises en page",
  exports: "Exports",
  assets: "Ressources internes",
} as const;

export const FEUILLETS_RESOURCE_SUBFOLDERS = [
  { key: "images", name: FEUILLETS_RESOURCE_FOLDERS.images, variants: [] },
  { key: "templates", name: FEUILLETS_RESOURCE_FOLDERS.templates, variants: ["Templates", "Template"] },
  { key: "layouts", name: FEUILLETS_RESOURCE_FOLDERS.layouts, variants: ["Layouts", "Layout"] },
  { key: "exports", name: FEUILLETS_RESOURCE_FOLDERS.exports, variants: ["Export"] },
  { key: "assets", name: FEUILLETS_RESOURCE_FOLDERS.assets, variants: ["Assets", "Visuels", "Internal resources"] },
] as const;

export const RESOURCES_SUBFOLDER_NAMES = FEUILLETS_RESOURCE_FOLDERS;

/** Dossier "Edition" (synopsis, note d'intention, biographie, lettre
 * d'accompagnement, soumissions, versions envoyées…) : facultatif, voisin
 * de Manuscrit — exactement comme Recherche/Ressources — jamais dedans.
 * N'étant jamais un descendant du dossier projet (getProjectFolder), il est
 * automatiquement hors de portée du Binder, de la compilation et des
 * exports natifs, qui ne parcourent tous que ce sous-arbre (voir
 * getOrderedChildren) : aucune exclusion explicite à écrire ailleurs.
 *
 * "Edition" (sans préfixe) est la VARIANTE HISTORIQUE : reconnue à la
 * lecture (getEditionRoot) mais jamais recréée — les nouveaux dossiers
 * s'appellent "_Edition" (voir getFeuilletsFolderNames). */
export const EDITION_FOLDER_NAME = "Edition";

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
 * renvoie si le dossier s'appelle exactement "Manuscrit" (projet structuré).
 * Pour un dossier adopté (nom différent de "Manuscrit"), la racine du projet
 * est le dossier adopté lui-même.
 *
 * Important : on exclut explicitement la racine du coffre (path vide ou "/")
 * pour éviter que `base` vaille "" et que les dossiers soient créés à la
 * racine du coffre — notamment dans initProjectStructure. */
export function getProjectRoot(app: App, settings: FeuilletsSettings | null | undefined): TFolder | null {
  const manuscrit = getManuscriptRoot(app, settings);
  if (!manuscrit) return null;
  const parent = manuscrit.parent;
  return (isStructuredManuscriptRoot(manuscrit) && parent instanceof TFolder && parent.path !== "" && parent.path !== "/")
    ? parent
    : manuscrit;
}

/** Chemin du dossier d'édition à utiliser : reprend le dossier déjà présent
 * sur le disque quel que soit son nom ("_Edition" ou "Edition" — variante
 * historique, voir getEditionRoot), sinon "_Edition" via la source centrale
 * (getFeuilletsFolderNames) pour une création. Même convention que
 * resourcesFolderPath : jamais un chemin recalculé qui créerait un second
 * dossier concurrent, et jamais "Edition" sans préfixe pour une création.
 * La base exclut la racine du coffre : aucune création à la racine (voir
 * getProjectRoot). */
export function editionFolderPath(app: App, root: TFolder): string {
  const existing = getEditionRoot(app, root);
  if (existing) return existing.path;
  return feuilletsAuxiliaryPath(root, "edition");
}

/** Dossier Edition déjà présent sur le disque, ou null s'il n'a jamais été
 * créé pour ce projet — reconnaissance seule, jamais de création implicite
 * (voir ensureEditionFolder, project-files.ts, pour la création à la
 * demande). Sans impact sur les projets créés avant cette fonctionnalité :
 * un projet sans dossier Edition renvoie simplement null partout. */
export function getEditionRoot(app: App, root: TFolder | null | undefined): TFolder | null {
  if (!root) return null;
  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "edition"));
  if (canonical instanceof TFolder) return canonical;
  const base = isStructuredManuscriptRoot(root) && root.parent instanceof TFolder && root.parent.path !== "" && root.parent.path !== "/"
    ? root.parent.path
    : root.path;
  /* "_Edition" (nouveau nom, source centrale) puis "Edition" (variante
     historique sans préfixe) : jamais renommé, jamais dupliqué. */
  for (const name of [getFeuilletsFolderNames().edition, EDITION_FOLDER_NAME]) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
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

/** Project display name: the volume (parent) folder, not "Manuscrit" or
 * "Manuscript" — otherwise all projects share the same name when following
 * the structured sibling convention. Falls back to the last segment if the
 * path does not follow this convention. */
export function projectDisplayName(path: string): string {
  const parts = normalizePath(path || "").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  const last = parts[parts.length - 1];
  if (KNOWN_MANUSCRIPT_FOLDER_NAMES.some((name) => name.toLowerCase() === last.toLowerCase()) && parts.length > 1) {
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
export function getResourcesRoot(app: App, root: TFolder | null | undefined, fallbackLocale?: Locale): TFolder | null {
  if (!root) return null;
  const orderedLocales = candidateLocalesForProject(root, fallbackLocale);
  for (const locale of orderedLocales) {
    const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPathFor(root, "resources", projectCreationNames(locale)));
    if (canonical instanceof TFolder) return canonical;
  }
  const base = root.parent instanceof TFolder && root.parent.path !== "" && root.parent.path !== "/"
    ? root.parent.path
    : root.path;
  const legacyNames = orderedLocales[0] === "en"
    ? ["_Resources", "Resources", "_Ressources", RESOURCES_FOLDER_NAME]
    : ["_Ressources", RESOURCES_FOLDER_NAME, "_Resources", "Resources"];
  for (const name of legacyNames) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Source de vérité pour les noms de dossiers Feuillets.
 * Les dossiers créés sur le disque sont canoniques et fixes.
 * Les variantes historiques restent reconnues uniquement pour la rétrocompatibilité
 * en lecture sur les anciens projets. */
export function getFeuilletsFolderNames(): {
  research: string;
  researchSubs: Array<{ name: string; variants: string[] }>;
  resources: string;
  resourcesSubs: Array<{ name: string; variants: string[] }>;
  snapshots: string;
  backups: string;
  journal: string;
  edition: string;
} {
  return {
    research: "Recherche",
    researchSubs: [
      {
        name: "Personnages",
        variants: ["Characters", "_Personnages"],
      },
      {
        name: "Lieux",
        variants: ["Places", "Locations", "_Lieux"],
      },
      {
        name: "Événements",
        variants: ["Events", "Timeline", "Chronology", "Chronologie", "_Chronologie"],
      },
      {
        name: "Sources",
        variants: [],
      },
      {
        name: "Bibliographie",
        variants: ["Bibliography"],
      },
      {
        name: "Notes",
        variants: [],
      },
    ],
    resources: "Ressources",
    resourcesSubs: FEUILLETS_RESOURCE_SUBFOLDERS.map((sub) => ({
      name: sub.name,
      variants: [...sub.variants],
    })),
    snapshots: "Snapshots",
    backups: "Backups",
    journal: "Journal",
    edition: "Edition",
  };
}

/**
 * Detect the structural language of an existing project.
 * Pure read-only vault inspection: never writes to the vault or settings.
 * Never calls getLocale() internally; fallbackLocale is mandatory.
 *
 * Deterministic precedence:
 * 1. The language identified by the manuscript-root name ("Manuscript" -> "en", "Manuscrit" -> "fr").
 * 2. Child or sibling folders matching "Manuscript" vs "Manuscrit".
 * 3. Canonical auxiliary folders under `_Feuillets`:
 *    - Research -> "en", Recherche -> "fr"
 *    - Resources -> "en", Ressources -> "fr"
 *    - Output -> "en", Sortie -> "fr"
 * 4. Sibling folders (for legacy or adopted structures):
 *    - Research -> "en", Recherche -> "fr"
 *    - Resources -> "en", Ressources -> "fr"
 *    - Output/_Output -> "en", Sortie/_Sortie -> "fr"
 * 5. Subfolders in the existing resources folder:
 *    - Templates -> "en", Modèles -> "fr"
 *    - Layouts -> "en", Mises en page -> "fr"
 *    - Internal resources -> "en", Ressources internes -> "fr"
 * 6. Subfolders in the existing research folder:
 *    - Characters/Places/Events/Bibliography/Glossary -> "en"
 *    - Personnages/Lieux/Événements/Bibliographie/Glossaire -> "fr"
 * 7. The explicitly captured fallback locale.
 */
export function detectProjectStructureLocale(
  app: App,
  root: TFolder | null | undefined,
  fallbackLocale: Locale
): Locale {
  if (!root) return fallbackLocale;

  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");

  // 1. Direct manuscript root name
  if (root.name.toLowerCase() === namesEn.manuscript.toLowerCase()) return "en";
  if (root.name.toLowerCase() === namesFr.manuscript.toLowerCase()) return "fr";

  // 2. Child manuscript folder (if root is volume root)
  if (Array.isArray(root.children)) {
    for (const child of root.children) {
      if (child instanceof TFolder) {
        if (child.name.toLowerCase() === namesEn.manuscript.toLowerCase()) return "en";
        if (child.name.toLowerCase() === namesFr.manuscript.toLowerCase()) return "fr";
      }
    }
  }

  const checkFolderExists = (path: string): boolean => {
    const af = app.vault.getAbstractFileByPath(normalizePath(path));
    return af instanceof TFolder;
  };

  // 3. Canonical auxiliary folders under _Feuillets
  const auxRoot = feuilletsAuxiliaryRootPath(root);

  const auxEnResearch = checkFolderExists(`${auxRoot}/${namesEn.auxiliary.research}`);
  const auxFrResearch = checkFolderExists(`${auxRoot}/${namesFr.auxiliary.research}`);
  if (auxEnResearch && !auxFrResearch) return "en";
  if (auxFrResearch && !auxEnResearch) return "fr";

  const auxEnResources = checkFolderExists(`${auxRoot}/${namesEn.auxiliary.resources}`);
  const auxFrResources = checkFolderExists(`${auxRoot}/${namesFr.auxiliary.resources}`);
  if (auxEnResources && !auxFrResources) return "en";
  if (auxFrResources && !auxEnResources) return "fr";

  const auxEnOutput = checkFolderExists(`${auxRoot}/${namesEn.auxiliary.output}`);
  const auxFrOutput = checkFolderExists(`${auxRoot}/${namesFr.auxiliary.output}`);
  if (auxEnOutput && !auxFrOutput) return "en";
  if (auxFrOutput && !auxEnOutput) return "fr";

  // 4. Sibling folders (for legacy or non-auxiliary projects)
  const parent = root.parent;
  const base = isStructuredManuscriptRoot(root) && parent instanceof TFolder && parent.path !== "" && parent.path !== "/"
    ? parent.path
    : root.path;

  const sibEnResearch = checkFolderExists(`${base}/${namesEn.research}`) || checkFolderExists(`${base}/_${namesEn.research}`);
  const sibFrResearch = checkFolderExists(`${base}/${namesFr.research}`) || checkFolderExists(`${base}/_${namesFr.research}`);
  if (sibEnResearch && !sibFrResearch) return "en";
  if (sibFrResearch && !sibEnResearch) return "fr";

  const sibEnResources = checkFolderExists(`${base}/${namesEn.resources}`) || checkFolderExists(`${base}/_${namesEn.resources}`);
  const sibFrResources = checkFolderExists(`${base}/${namesFr.resources}`) || checkFolderExists(`${base}/_${namesFr.resources}`);
  if (sibEnResources && !sibFrResources) return "en";
  if (sibFrResources && !sibEnResources) return "fr";

  const sibEnOutput = checkFolderExists(`${base}/Output`) || checkFolderExists(`${base}/_Output`);
  const sibFrOutput = checkFolderExists(`${base}/Sortie`) || checkFolderExists(`${base}/_Sortie`);
  if (sibEnOutput && !sibFrOutput) return "en";
  if (sibFrOutput && !sibEnOutput) return "fr";

  const directEnResearch =
    checkFolderExists(`${base}/_Characters`) ||
    checkFolderExists(`${base}/_Places`) ||
    checkFolderExists(`${base}/_Timeline`);
  const directFrResearch =
    checkFolderExists(`${base}/_Personnages`) ||
    checkFolderExists(`${base}/_Lieux`) ||
    checkFolderExists(`${base}/_Chronologie`);
  if (directEnResearch && !directFrResearch) return "en";
  if (directFrResearch && !directEnResearch) return "fr";

  // 5. Subfolders in resources
  const resRoot = getResourcesRoot(app, root, fallbackLocale);
  if (resRoot) {
    const resEnTemplates = checkFolderExists(`${resRoot.path}/${namesEn.resourceSubfolders.templates}`);
    const resFrTemplates = checkFolderExists(`${resRoot.path}/${namesFr.resourceSubfolders.templates}`);
    if (resEnTemplates && !resFrTemplates) return "en";
    if (resFrTemplates && !resEnTemplates) return "fr";

    const resEnLayouts = checkFolderExists(`${resRoot.path}/${namesEn.resourceSubfolders.layouts}`);
    const resFrLayouts = checkFolderExists(`${resRoot.path}/${namesFr.resourceSubfolders.layouts}`);
    if (resEnLayouts && !resFrLayouts) return "en";
    if (resFrLayouts && !resEnLayouts) return "fr";

    const resEnAssets = checkFolderExists(`${resRoot.path}/${namesEn.resourceSubfolders.assets}`);
    const resFrAssets = checkFolderExists(`${resRoot.path}/${namesFr.resourceSubfolders.assets}`);
    if (resEnAssets && !resFrAssets) return "en";
    if (resFrAssets && !resEnAssets) return "fr";
  }

  // 6. Subfolders in research
  let researchFolder: TFolder | null = null;
  const orderedLocales = candidateLocalesForProject(root, fallbackLocale);
  for (const loc of orderedLocales) {
    const canonical = app.vault.getAbstractFileByPath(
      feuilletsAuxiliaryPathFor(root, "research", projectCreationNames(loc))
    );
    if (canonical instanceof TFolder) {
      researchFolder = canonical;
      break;
    }
  }
  if (!researchFolder) {
    const legacyResearchNames = orderedLocales[0] === "en"
      ? ["_Research", "Research", "_Recherche", "Recherche"]
      : ["_Recherche", "Recherche", "_Research", "Research"];
    for (const name of legacyResearchNames) {
      const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/${name}`));
      if (f instanceof TFolder) {
        researchFolder = f;
        break;
      }
    }
  }

  if (researchFolder) {
    const checkResearchPair = (enName: string, frName: string): Locale | null => {
      const enExists = checkFolderExists(`${researchFolder.path}/${enName}`);
      const frExists = checkFolderExists(`${researchFolder.path}/${frName}`);
      if (enExists && !frExists) return "en";
      if (frExists && !enExists) return "fr";
      return null;
    };

    const charVote = checkResearchPair(namesEn.researchSections.characters, namesFr.researchSections.characters);
    if (charVote) return charVote;

    const placeVote = checkResearchPair(namesEn.researchSections.places, namesFr.researchSections.places);
    if (placeVote) return placeVote;

    const eventVote = checkResearchPair(namesEn.researchSections.events, namesFr.researchSections.events);
    if (eventVote) return eventVote;

    const bibVote = checkResearchPair(namesEn.researchSections.bibliography, namesFr.researchSections.bibliography);
    if (bibVote) return bibVote;

    const glossVote = checkResearchPair(namesEn.researchSections.glossary, namesFr.researchSections.glossary);
    if (glossVote) return glossVote;
  }

  // 7. Explicit fallback locale
  return fallbackLocale;
}

export function resourcesFolderPath(app: App, root: TFolder, fallbackLocale?: Locale): string;
export function resourcesFolderPath(app: App, root: null | undefined, fallbackLocale?: Locale): null;
/** Path of the Resources folder used for writing: reuses an existing folder
 * on disk regardless of which locale created it. When creating a new folder,
 * determines the project's structural language to use the appropriate catalogue name. */
export function resourcesFolderPath(app: App, root: TFolder | null | undefined, fallbackLocale?: Locale): string | null {
  if (!root) return null;
  const existing = getResourcesRoot(app, root, fallbackLocale);
  if (existing) return existing.path;
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const locale = detectProjectStructureLocale(app, root, fallback);
  return feuilletsAuxiliaryPathFor(root, "resources", projectCreationNames(locale));
}

/** Resources subfolder whose name changed over versions: reuses the folder
 * already present on disk if one exists, otherwise creates the primary name. */
export function resourcesSubfolderPath(app: App, resourcesPath: string, newName: string, ...legacyNames: string[]): string {
  for (const name of [newName, ...legacyNames]) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${resourcesPath}/${name}`));
    if (f instanceof TFolder) return f.path;
  }
  return normalizePath(`${resourcesPath}/${newName}`);
}

/** Path of the internal resources subfolder. Reuses an existing folder if present,
 * otherwise selects the primary name based on the detected project language. */
export function internalResourcesFolderPath(app: App, root: TFolder, fallbackLocale?: Locale): string {
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const locale = detectProjectStructureLocale(app, root, fallback);
  const names = projectCreationNames(locale);
  const resPath = resourcesFolderPath(app, root, locale);
  const primaryName = names.resourceSubfolders.assets;
  const altLocale: Locale = locale === "fr" ? "en" : "fr";
  const altName = projectCreationNames(altLocale).resourceSubfolders.assets;
  return resourcesSubfolderPath(
    app,
    resPath,
    primaryName,
    altName,
    "Assets",
    "Visuels",
  );
}

export function depthOf(
  app: App,
  settings: FeuilletsSettings,
  node: ProjectNode,
  editorialRoot?: TFolder | null
): number {
  const root = editorialRoot ?? getProjectFolder(app, settings);
  if (!root) return 0;
  if (node.path === root.path) return 0;
  if (editorialRoot) {
    const prefix = `${root.path}/`;
    if (!node.path.startsWith(prefix)) return 0;
    return node.path.slice(prefix.length).split("/").length;
  }
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

export function isFrontMatter(
  app: App,
  settings: FeuilletsSettings,
  node: ProjectNode,
  editorialRoot?: TFolder | null
): boolean {
  const root = editorialRoot ?? getProjectFolder(app, settings);
  if (!root) return false;
  const p = normalizePath(`${root.path}/${FRONT_FOLDER_NAME}`);
  return node.path === p || node.path.startsWith(`${p}/`);
}

/**
 * @param level1RoleOverride Rôle du premier niveau imposé par l'appelant
 *   (ex. compile-export.ts, `composition.level1Role` — une racine éditoriale
 *   peut avoir son propre `level1Role`, distinct du réglage global) — s'il
 *   est fourni, il tranche seul le niveau 1, SANS jamais consulter
 *   `projectMeta`/`settings.level1Role`. Absent, la résolution historique
 *   (projectMeta de la racine globale, puis réglage global) reste
 *   strictement inchangée — c'est le même algorithme, jamais une copie
 *   parallèle : voir aussi roleOfFile() ci-dessous, qui le transmet tel quel.
 */
export function roleOfFolder(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder,
  editorialRoot?: TFolder | null,
  level1RoleOverride?: "parties" | "chapitres"
): "chapitre" | "partie" {
  const d = depthOf(app, settings, folder, editorialRoot);
  if (d >= 2) return "chapitre";
  if (editorialRoot && d <= 0) return "partie";
  if (level1RoleOverride) return level1RoleOverride === "chapitres" ? "chapitre" : "partie";
  const root = getProjectFolder(app, settings);
  const level1Role = root && settings.projectMeta?.[root.path]?.level1Role;
  return (level1Role === "chapitres" || (!level1Role && settings.level1Role === "chapitres")) ? "chapitre" : "partie";
}

/** @param level1RoleOverride Transmis tel quel à roleOfFolder() — voir sa
 *   documentation ci-dessus. */
export function roleOfFile(
  app: App,
  settings: FeuilletsSettings,
  file: TFile,
  editorialRoot?: TFolder | null,
  level1RoleOverride?: "parties" | "chapitres"
): "chapitre" | "scene" {
  const parent = file.parent;
  const root = editorialRoot ?? getProjectFolder(app, settings);
  if (!root || !parent || parent.path === root.path) return "chapitre";
  return roleOfFolder(app, settings, parent, editorialRoot, level1RoleOverride) === "chapitre" ? "scene" : "chapitre";
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
    /* §Tri naturel : uniquement le fallback final, quand ni l'ordre
       Binder (savedIndex) ni la position explicite (order/folderPositions)
       ne départagent — jamais prioritaire sur eux. */
    return naturalCompare(a.name, b.name);
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

export { detectLegacyProjectStructure, LEGACY_PROJECT_INVENTORY, type LegacyDetectionResult, type LegacyConflict } from "./project-migration.js";
