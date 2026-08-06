import { getLocale } from "../i18n/index.js";

/** Un mode = un type de document. Ne change ni la structure de dossiers
 * ni les champs de frontmatter lus — seulement le vocabulaire affiché et
 * les réglages de départ appliqués une fois à la création du projet. */

/* Noms de dossiers en anglais depuis cette version (voir services/
   folder-structure.js pour Front/Ressources/Recherche) — l'ancien nom
   français de chaque catégorie reste reconnu indéfiniment sur les
   projets déjà créés, voir LEGACY_RESEARCH_LABELS/matchesResearchLabel
   plus bas. Seuls les nouveaux projets créent des dossiers avec le
   nouveau nom. */
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

/** Personnages/Lieux/Lore/Glossaire/Événements sont des catégories nées
 * pour la fiction (personnages, lieux d'une histoire) — elles ne
 * généralisent pas à la non-fiction (une thèse de droit n'a pas besoin
 * d'"Acteurs", une thèse de diplomatie a besoin de "Traités" plutôt que de
 * "Géographie"). Plutôt que d'imposer un jeu de rubriques figé qui ne
 * correspond à aucun sujet réel, la non-fiction ne crée plus que Sources
 * et Bibliographie automatiquement — tout le reste se fait via le bouton
 * "Nouvelle rubrique" (dossier de recherche personnalisé, voir
 * renderResearchBody), qui s'adapte à CE sujet précis plutôt qu'à un
 * gabarit générique. */
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
 * exister, libellé de la langue active en premier : le nom actuel (anglais)
 * et l'ancien nom français — permet de réutiliser un dossier existant créé
 * dans l'autre langue au lieu d'en créer un doublon. */
export function researchFolderNames(
  researchFolders: Record<string, { label: string }>,
  key: string
): string[] {
  const entry = researchFolders[key];
  if (!entry) return [];
  const preferred = researchFolderLabel(researchFolders, key);
  const legacy = LEGACY_RESEARCH_LABELS[key as keyof typeof LEGACY_RESEARCH_LABELS];
  const other = preferred === entry.label ? legacy : entry.label;
  const names = [preferred];
  if (other && !names.includes(other)) names.push(other);
  return names;
}

/** `name` correspond-il à la catégorie `key` de `researchFolders`, sous
 * son nom actuel (anglais) OU son ancien nom (français) ? */
export function matchesResearchLabel(researchFolders: Record<string, { label: string }>, key: string, name: string) {
  const entry = researchFolders[key];
  if (!entry) return false;
  return name === entry.label || name === LEGACY_RESEARCH_LABELS[key];
}

export const PROJECT_MODES = {
  fiction: {
    label: "Fiction",
    yamlPreset: "roman",
    unit: "scène",
    unitPlural: "scènes",
    hasSources: false,
    researchFolders: FICTION_RESEARCH,
    defaults: {
      level1Role: "parties",
      chapterNumbering: "continu",
      sceneNumbering: "hier",
      boardMode: "board",
      cardContent: "synopsis",
    },
  },
  nonfiction: {
    label: "Non-fiction",
    yamlPreset: "minimal",
    unit: "section",
    unitPlural: "sections",
    hasSources: true,
    researchFolders: NONFICTION_RESEARCH,
    defaults: {
      level1Role: "chapitres",
      chapterNumbering: "continu",
      sceneNumbering: "continue",
      boardMode: "outline",
      cardContent: "summary",
    },
  },
  free: {
    label: "Libre",
    yamlPreset: "minimal",
    unit: "section",
    unitPlural: "sections",
    hasSources: false,
    researchFolders: FREE_RESEARCH,
    defaults: {
      level1Role: "chapitres",
      chapterNumbering: "continu",
      sceneNumbering: "continue",
      boardMode: "outline",
      cardContent: "summary",
    },
  },
};

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

/** Applique les réglages de départ d'un mode — à appeler UNE SEULE FOIS, à
 * la création du projet. Ne doit jamais être rappelée automatiquement
 * ensuite (écraserait les réglages ajustés par l'utilisateur depuis). */
export function applyModeDefaults(settings: FeuilletsSettings, type: string | null | undefined) {
  const mode = PROJECT_MODES[resolveType(type)];
  Object.assign(settings, mode.defaults);
  settings.mergeYamlPreset = mode.yamlPreset;
}
