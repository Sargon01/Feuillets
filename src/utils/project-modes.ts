import { getLocale } from "../i18n/index.js";

/** Un mode = un type de document. Ne change ni la structure de dossiers
 * ni les champs de frontmatter lus — seulement le vocabulaire affiché et
 * les réglages de départ appliqués une fois à la création du projet.
 *
 * Noms physiques canoniques des sous-dossiers de Recherche (Personnages, Lieux,
 * Événements, Lore, Glossaire, Notes, Sources) créés de manière autonome sans
 * dépendre de la locale de l'interface. Les variantes anglaises et historiques
 * restent reconnues indéfiniment sur les projets existants (voir LEGACY_RESEARCH_LABELS
 * et researchFolderNames plus bas). */
const bibliographie = { label: "Bibliography", newName: "Nouvelle référence", tag: "bibliographie" };

type ResearchFolderDef = { label: string; newName: string; tag: string };
/** Union réelle des deux modes : chaque catégorie n'existe que dans SON
 * mode (fiction ou non-fiction), jamais dans les deux — d'où l'optionalité
 * de chaque champ ici plutôt qu'un jeu de clés figé. */
type ResearchFolders = {
  bibliographie?: ResearchFolderDef;
  glossaire?: ResearchFolderDef;
  evenements?: ResearchFolderDef;
  personnages?: ResearchFolderDef;
  lieux?: ResearchFolderDef;
  codex?: ResearchFolderDef;
  sources?: ResearchFolderDef;
  notes?: ResearchFolderDef;
};

/** Catégories Recherche par défaut selon le mode du projet :
 * - Fiction : Personnages, Lieux, Événements, Lore, Glossaire
 * - Non-fiction : Notes, Sources
 * - Libre : aucune rubrique créée par défaut
 *
 * Bibliographie est conservée pour la compatibilité historique (reconnaissance
 * et affichage des anciens dossiers), mais n'est créée automatiquement dans aucun mode. */
const FICTION_RESEARCH: ResearchFolders = {
  bibliographie,
  glossaire: { label: "Glossary", newName: "Nouveau terme", tag: "glossaire" },
  evenements: { label: "Events", newName: "Nouvel événement", tag: "evenement" },
  personnages: { label: "Characters", newName: "Nouveau personnage", tag: "personnage" },
  lieux: { label: "Places", newName: "Nouveau lieu", tag: "lieu" },
  codex: { label: "Lore", newName: "Nouvelle entrée", tag: "codex" },
};

const NONFICTION_RESEARCH: ResearchFolders = {
  bibliographie,
  notes: { label: "Notes", newName: "Nouvelle note", tag: "notes" },
  sources: { label: "Sources", newName: "Nouvelle source", tag: "source" },
};

const FREE_RESEARCH: ResearchFolders = {};

type BoardModeKey = "board" | "outline" | "arcs" | "timeline";

export type BoardProjectDefaults = {
  hiddenBoardModes: BoardModeKey[];
  outlineCols: Record<string, boolean>;
};

const FICTION_BOARD_DEFAULTS: BoardProjectDefaults = {
  hiddenBoardModes: ["timeline"],
  outlineCols: {
    synopsis: true, summary: false, pov: true, notes: false, tags: false, label: false,
    status: true, date: false, compile: false, filename: false,
    words: false, goal: false, progress: false,
    characters: false, thread: false,
  },
};

const NONFICTION_BOARD_DEFAULTS: BoardProjectDefaults = {
  hiddenBoardModes: ["arcs", "timeline"],
  outlineCols: {
    synopsis: false, summary: true, pov: false, notes: false, tags: false, label: false,
    status: false, date: false, compile: false, filename: false,
    words: false, goal: false, progress: false,
  },
};

const FREE_BOARD_DEFAULTS: BoardProjectDefaults = {
  hiddenBoardModes: ["arcs", "timeline"],
  outlineCols: {
    synopsis: false, summary: true, pov: false, notes: false, tags: false, label: false,
    status: false, date: false, compile: false, filename: false,
    words: false, goal: false, progress: false,
  },
};

/** Ancien nom français de chaque catégorie (dossiers déjà créés avant ce
 * renommage) — jamais renommés de force sur le disque, toujours reconnus
 * en plus du nouveau nom anglais. */
export const LEGACY_RESEARCH_LABELS = {
  bibliographie: "Bibliographie",
  glossaire: "Glossaire",
  evenements: "Événements",
  personnages: "Personnages",
  lieux: "Lieux",
  notes: "Notes",
  codex: "Lore",
  sources: "Sources",
};

export const CANONICAL_RESEARCH_LABELS: Record<string, string> = {
  personnages: "Personnages",
  lieux: "Lieux",
  evenements: "Événements",
  codex: "Lore",
  glossaire: "Glossaire",
  notes: "Notes",
  sources: "Sources",
  bibliographie: "Bibliographie",
};

const RESEARCH_FOLDER_VARIANTS: Record<string, string[]> = {
  personnages: ["Personnages", "Characters"],
  lieux: ["Lieux", "Places", "Locations"],
  evenements: ["Événements", "Events", "Chronologie", "Timeline", "Chronology"],
  codex: ["Lore", "Codex"],
  glossaire: ["Glossaire", "Glossary"],
  notes: ["Notes"],
  sources: ["Sources"],
  bibliographie: ["Bibliographie", "Bibliography"],
};

/** Libellé affiché d'une catégorie de recherche selon la langue active :
 * en interface française, l'ancien libellé français s'il existe dans
 * LEGACY_RESEARCH_LABELS (source de traduction unique, jamais une seconde
 * liste codée en dur), sinon le libellé anglais actuel. En anglais, le
 * libellé actuel est conservé tel quel. */
export function researchFolderLabel(
  researchFolders: Record<string, { label: string }>,
  key: string
): string {
  const entry = researchFolders[key];
  if (!entry) return "";
  if (getLocale() === "fr") {
    const legacy = LEGACY_RESEARCH_LABELS[key as keyof typeof LEGACY_RESEARCH_LABELS];
    if (legacy) return legacy;
  }
  return entry.label;
}

/** Noms sous lesquels le dossier d'une catégorie de recherche peut déjà
 * exister, nom canonique en premier : le nom canonique (français/Lore), le nom
 * actuel (anglais) et les anciens noms — permet de réutiliser un dossier
 * existant créé sous une variante au lieu d'en créer un doublon. */
export function researchFolderNames(
  researchFolders: Record<string, { label: string }>,
  key: string
): string[] {
  const entry = researchFolders[key];
  if (!entry) return [];

  const canonical = CANONICAL_RESEARCH_LABELS[key];
  const legacy = LEGACY_RESEARCH_LABELS[key as keyof typeof LEGACY_RESEARCH_LABELS];
  const variants = RESEARCH_FOLDER_VARIANTS[key] || [];
  const names: string[] = [];

  if (canonical) names.push(canonical);
  if (entry.label && !names.includes(entry.label)) names.push(entry.label);
  if (legacy && !names.includes(legacy)) names.push(legacy);
  for (const v of variants) {
    if (!names.includes(v)) names.push(v);
  }
  return names;
}

/** `name` correspond-il à la catégorie `key` de `researchFolders`, sous
 * son nom canonique, son nom anglais OU son ancien nom ? */
export function matchesResearchLabel(researchFolders: Record<string, { label: string }>, key: string, name: string) {
  const names = researchFolderNames(researchFolders, key);
  return names.includes(name);
}

export const PROJECT_MODES = {
  fiction: {
    label: "Fiction",
    yamlPreset: "roman",
    unit: "scène",
    unitPlural: "scènes",
    hasSources: false,
    researchFolders: FICTION_RESEARCH,
    defaultResearchFolders: ["personnages", "lieux", "evenements", "codex", "glossaire"],
    defaults: {
      level1Role: "parties",
      chapterNumbering: "continu",
      sceneNumbering: "hier",
      boardMode: "board",
      cardContent: "synopsis",
    },
    boardDefaults: FICTION_BOARD_DEFAULTS,
  },
  nonfiction: {
    label: "Non-fiction",
    yamlPreset: "minimal",
    unit: "section",
    unitPlural: "sections",
    hasSources: true,
    researchFolders: NONFICTION_RESEARCH,
    defaultResearchFolders: ["notes", "sources"],
    defaults: {
      level1Role: "chapitres",
      chapterNumbering: "continu",
      sceneNumbering: "continue",
      boardMode: "outline",
      cardContent: "summary",
    },
    boardDefaults: NONFICTION_BOARD_DEFAULTS,
  },
  free: {
    label: "Libre",
    yamlPreset: "minimal",
    unit: "section",
    unitPlural: "sections",
    hasSources: false,
    researchFolders: FREE_RESEARCH,
    defaultResearchFolders: [],
    defaults: {
      level1Role: "chapitres",
      chapterNumbering: "continu",
      sceneNumbering: "continue",
      boardMode: "outline",
      cardContent: "summary",
    },
    boardDefaults: FREE_BOARD_DEFAULTS,
  },
};

/** Copie les préférences initiales de la zone centrale pour un nouveau
 * projet. La copie empêche ensuite les choix du projet de muter les
 * constantes partagées de PROJECT_MODES. */
export function projectBoardDefaults(type: string | null | undefined): BoardProjectDefaults {
  const defaults = PROJECT_MODES[resolveType(type)].boardDefaults;
  return {
    hiddenBoardModes: [...defaults.hiddenBoardModes],
    outlineCols: { ...defaults.outlineCols },
  };
}

/** Ramène une valeur de type quelconque (absente, ou ancien texte libre
 * non reconnu) sur une clé valide de PROJECT_MODES — "fiction" par repli,
 * pour qu'aucun projet existant ne casse. */
export function resolveType(type: string | null | undefined) {
  const rawType = (type || "").trim().toLowerCase();
  if (rawType === "fiction" || rawType === "roman" || rawType === "nouvelle") {
    return "fiction";
  }
  if (rawType === "nonfiction" || rawType === "non-fiction" || rawType === "essai" || rawType === "these" || rawType === "thèse" || rawType === "article") {
    return "nonfiction";
  }
  if (rawType === "free" || rawType === "libre") {
    return "free";
  }
  return "fiction";
}

/** Style de création physique : identique au mode résolu (les trois modes
 * canoniques ont chacun leur propre structure physique). */
export function projectCreationStyle(type: string | null | undefined): "fiction" | "nonfiction" | "free" {
  return resolveType(type);
}

/** Applique les réglages de départ d'un mode — à appeler UNE SEULE FOIS, à
 * la création du projet. Ne doit jamais être rappelée automatiquement
 * ensuite (écraserait les réglages ajustés par l'utilisateur depuis). */
export function applyModeDefaults(settings: FeuilletsSettings, type: string | null | undefined) {
  const mode = PROJECT_MODES[resolveType(type)];
  Object.assign(settings, mode.defaults);
  settings.mergeYamlPreset = mode.yamlPreset;
}

/* ===== LOT "binder isolé + simplification cartes/plan" : sémantique unique
 * par mode (§5-6) — Fiction planifie avec un synopsis, Non-fiction/Libre
 * avec un résumé long, jamais les deux à la fois. Aucune migration sur
 * disque : ces fonctions résolvent seulement l'affichage effectif à partir
 * d'une éventuelle ancienne donnée (synopsis en Non-fiction/Libre, summary
 * en Fiction, etc.). */

/** Champ de planification sémantique du mode : "synopsis" en Fiction,
 * "summary" en Non-fiction/Libre. Jamais les deux simultanément. */
export type SemanticPlanningField = "synopsis" | "summary";

export function semanticPlanningField(type: string | null | undefined): SemanticPlanningField {
  return resolveType(type) === "fiction" ? "synopsis" : "summary";
}

/** Contenu effectif d'une carte (mode Cartes) : soit l'extrait du corps du
 * fichier, soit le champ de planification sémantique du mode — jamais
 * "synopsis" ET "summary" comme deux choix distincts proposés à
 * l'utilisateur (voir §14). */
export type BoardCardContent = "extrait" | "synopsis" | "summary";

export function resolveBoardCardContent(
  type: string | null | undefined,
  stored: unknown,
  planningField?: SemanticPlanningField
): BoardCardContent {
  if (stored === "extrait") return "extrait";
  return planningField || semanticPlanningField(type);
}

/** Colonnes autorisées du Plan par mode — jamais notes/nom du fichier/
 * progression/compiler, quel que soit l'ancien réglage stocké (§6/§18). */
const BOARD_OUTLINE_COMMON_COLS = ["label", "status", "tags", "date", "words", "goal"] as const;

const BOARD_OUTLINE_ALWAYS_HIDDEN = ["notes", "filename", "progress", "compile", "compiler"] as const;

/** Calcule les colonnes Plan effectivement affichables pour un mode donné,
 * à partir d'un éventuel ancien objet de colonnes stocké. Ne migre rien sur
 * disque : `stored` n'est jamais modifié, seul le résultat calculé change
 * d'un rendu à l'autre. */
export function resolveBoardOutlineColumns(
  type: string | null | undefined,
  stored?: Record<string, boolean> | null,
  planningField?: SemanticPlanningField
): Record<string, boolean> {
  const resolvedType = resolveType(type);
  const isFiction = resolvedType === "fiction";
  const defaults = PROJECT_MODES[resolvedType].boardDefaults.outlineCols;
  const s = stored || {};

  const hasSemanticKey = s.synopsis !== undefined || s.summary !== undefined;
  const semanticEnabled = hasSemanticKey
    ? !!(s.synopsis || s.summary)
    : !!(defaults.synopsis || defaults.summary);

  const result: Record<string, boolean> = {};

  const semanticField = planningField || semanticPlanningField(type);
  result.synopsis = semanticField === "synopsis" ? semanticEnabled : false;
  result.summary = semanticField === "summary" ? semanticEnabled : false;

  if (isFiction) {
    result.pov = s.pov !== undefined ? !!s.pov : !!defaults.pov;
    /* Personnages + Fil : colonnes optionnelles du Plan réservées à la
       Fiction (le mode narre des personnages et des fils narratifs), OFF
       par défaut pour ne pas surcharger l'état initial — l'autrice les
       active via « Colonnes visibles ». Jamais présentes en Non-fiction/
       Libre, même stockées à true (même règle que pov). */
    result.characters = s.characters !== undefined ? !!s.characters : !!defaults.characters;
    result.thread = s.thread !== undefined ? !!s.thread : !!defaults.thread;
  } else {
    result.pov = false;
    result.characters = false;
    result.thread = false;
  }

  for (const key of BOARD_OUTLINE_COMMON_COLS) {
    result[key] = s[key] !== undefined ? !!s[key] : !!defaults[key];
  }

  for (const key of BOARD_OUTLINE_ALWAYS_HIDDEN) {
    result[key] = false;
  }

  return result;
}
