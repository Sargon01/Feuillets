/** Un mode = un type de document. Ne change ni la structure de dossiers
 * ni les champs de frontmatter lus — seulement le vocabulaire affiché et
 * les réglages de départ appliqués une fois à la création du projet. */

const bibliographie = { label: "Bibliographie", newName: "Nouvelle référence", tag: "bibliographie" };

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
const FICTION_RESEARCH = {
  bibliographie,
  glossaire: { label: "Glossaire", newName: "Nouveau terme", tag: "glossaire" },
  evenements: { label: "Événements", newName: "Nouvel événement", tag: "evenement" },
  personnages: { label: "Personnages", newName: "Nouveau personnage", tag: "personnage" },
  lieux: { label: "Lieux", newName: "Nouveau lieu", tag: "lieu" },
  codex: { label: "Lore", newName: "Nouvelle entrée", tag: "codex" },
};

const NONFICTION_RESEARCH = {
  bibliographie,
  sources: { label: "Sources", newName: "Nouvelle source", tag: "source" },
};

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
};

/** Ramène une valeur de type quelconque (absente, ou ancien texte libre
 * non reconnu) sur une clé valide de PROJECT_MODES — "fiction" par repli,
 * pour qu'aucun projet existant ne casse. */
export function resolveType(type) {
  const rawType = (type || "").trim().toLowerCase();
  if (rawType === "fiction" || rawType === "roman" || rawType === "nouvelle") {
    return "fiction";
  }
  if (rawType === "nonfiction" || rawType === "non-fiction" || rawType === "essai" || rawType === "these" || rawType === "thèse" || rawType === "article") {
    return "nonfiction";
  }
  return "fiction";
}

/** Applique les réglages de départ d'un mode — à appeler UNE SEULE FOIS, à
 * la création du projet. Ne doit jamais être rappelée automatiquement
 * ensuite (écraserait les réglages ajustés par l'utilisateur depuis). */
export function applyModeDefaults(settings, type) {
  const mode = PROJECT_MODES[resolveType(type)];
  Object.assign(settings, mode.defaults);
  settings.mergeYamlPreset = mode.yamlPreset;
}

