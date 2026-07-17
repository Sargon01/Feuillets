/** Un mode = un type de document. Ne change ni la structure de dossiers
 * ni les champs de frontmatter lus — seulement le vocabulaire affiché et
 * les réglages de départ appliqués une fois à la création du projet. */

const SHARED_RESEARCH = {
  bibliographie: { label: "Bibliographie", newName: "Nouvelle référence", tag: "bibliographie" },
  glossaire: { label: "Glossaire", newName: "Nouveau terme", tag: "glossaire" },
  evenements: { label: "Événements", newName: "Nouvel événement", tag: "evenement" },
};

/** Les 3 sous-dossiers qui changent de nom selon la famille du mode — le
 * tag structurel (donnée interne, jamais montré) reste le même des deux
 * côtés : seul l'habillage affiché varie. */
const FICTION_RESEARCH = {
  ...SHARED_RESEARCH,
  personnages: { label: "Personnages", newName: "Nouveau personnage", tag: "personnage" },
  lieux: { label: "Lieux", newName: "Nouveau lieu", tag: "lieu" },
  codex: { label: "Lore", newName: "Nouvelle entrée", tag: "codex" },
};

const NONFICTION_RESEARCH = {
  ...SHARED_RESEARCH,
  sources: { label: "Sources", newName: "Nouvelle source", tag: "source" },
  personnages: { label: "Acteurs", newName: "Nouvel acteur", tag: "personnage" },
  lieux: { label: "Géographie", newName: "Nouvelle entrée", tag: "lieu" },
  codex: { label: "Concepts", newName: "Nouveau concept", tag: "codex" },
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
      cardContent: "resume",
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

