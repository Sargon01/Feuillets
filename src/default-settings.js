export const DEFAULT_SETTINGS = {
  insertFolderTitles: true, // parties
  insertTitles: true, // chapitres
  insertSceneTitles: false, // scènes (clé titre uniquement, jamais le nom du fichier)
  separator: "\n\n",
  orders: {},
  folderPositions: {},
  folderGoals: {}, // { cheminDossierChapitre: objectif }
  collapsed: {}, // { cheminDossier: true }
  boardMode: "board",
  statusFilter: "Tous",
  tagFilter: "",
  autoRename: true,
  renamePrefix: "chapitre",
  level1Role: "parties",
  /* interface */
  tileSize: 240,
  columns: 0, // 0 = automatique
  showTags: true,
  showProgress: false, // anneaux de progression du tableau — interface sobre par défaut
  fontSize: 14,
  liveJustify: false, // texte justifié en Live Preview (sans césure : la césure y coûte trop cher au défilement)
  readingMatchLive: true, // mode lecture : même interligne et espacement de paragraphes qu'en Live Preview
  readingFontSize: 0, // px, mode lecture uniquement — 0 = taille par défaut d'Obsidian (partagée avec Live Preview, donc pas réglable indépendamment sans ceci)
  binderLayout: "tree", // "tree" (historique) | "split" (dossiers | feuillets, façon Notebook Navigator/Ulysses)
  binderSelectedPath: "", // dossier sélectionné dans le volet gauche en vue double volet
  binderTreeWidth: 170, // px, largeur du volet gauche en vue double volet
  listPanePreviewField: "synopsis", // "none" | "synopsis" | "resume" | "notes" | "tags" — champ affiché en aperçu dans le volet fichier (lecture seule)
  listPanePreviewLines: 2, // nombre de lignes avant troncature de l'aperçu
  binderSplitScope: "project", // "project" | "vault" — étendue du volet gauche en vue double volet
  binderSinglePane: false, // double vue : n'afficher qu'un volet à la fois (dossiers OU feuillets), façon Notebook Navigator
  binderSplitRecursive: true, // volet fichier : inclure les sous-dossiers du dossier sélectionné (sinon feuillets à plusieurs niveaux invisibles)
  uiScale: 100,
  /* session */
  sessionGoal: 0,
  projectWordGoal: 0, // objectif de mots du projet entier — panneau Statistiques
  stats: {}, // { "AAAA-MM-JJ": { start, latest } }
  pandocPath: "pandoc",
  cardContent: "extrait", // "extrait" (premières lignes) ou "synopsis"
  indentParagraphs: true, // alinéas en début de paragraphe dans l'éditeur
  outlineCols: {
    synopsis: true, resume: false, notes: false, tags: false, label: false,
    status: true, date: false, compiler: false, filename: false,
    words: true, goal: true, progress: true,
  },
  outlineWidths: {
    title: 260, synopsis: 320, resume: 340, notes: 300, tags: 150, label: 110,
    status: 105, date: 160, compiler: 80, filename: 200, words: 85, goal: 85, progress: 90,
  },
  showCardTags: false, // tags sur les tuiles (le plan a sa colonne, menu Colonnes)
  projects: [], // autres dossiers projets (multi-projets façon Longform)
  manuscriptTitle: "", // page de titre de l'export .docx (défaut : nom du dossier)
  manuscriptAuthor: "",
  pandocReference: "reference-feuillets.docx", // chemin dans le coffre
  epubLanguage: "fr",
  /* typographie à la frappe (comportements adaptés du plugin French Typos
    de Thierry Crouzet — réimplémentés, non copiés) */
  liveApostrophe: true, // ' → ’ à la frappe
  liveGuillemets: true, // " → « » contextuels avec espaces insécables
  liveDashes: true, // "-- " → – / "--- " → — avec espace insécable
  liveEmptyLines: "normal", // "normal" | "reduit" | "invisible"
  liveHyphenation: false, // césure française en mode lecture
  liveTwoEnters: false, // Entrée insère un saut de paragraphe (ligne vide)
  settingsAdvanced: false, // affiche les réglages avancés
  concentrationWidth: 720, // px — largeur de la colonne de texte
  dimOpacity: 35, // % — estompage du texte hors focus
  concentrationUnit: "line", // "line" (fiable) | "paragraph"
  concentrationTypewriter: true, // ligne du curseur maintenue centrée
  concentrationCounter: true, // compteur de mots flottant
  projectMeta: {}, // { cheminDossier: { author, type, description } }

  autoOpenNotes: false, // ouvre le panneau Notes au démarrage — interface sobre par défaut
  autoOpenBinder: true, // ouvre le binder au démarrage (navigation principale, reste actif)
  autoOpenResearch: false, // ouvre le panneau Recherche au démarrage — interface sobre par défaut
  binderShowLabels: false, // liseré de couleur du label dans le binder — interface sobre par défaut
  binderShowTags: false, // pastilles de tags dans le binder
  binderShowStatus: false, // pastille de statut dans le binder — interface sobre par défaut
  binderShowProgress: false, // anneau de progression dans le binder — interface sobre par défaut
  binderShowWords: false, // nombre de mots en chiffres dans le binder
  sceneNumbering: "hier", // "hier" (1.1), "continue" (numéro global), "aucune"
  timelineOrder: "chrono", // "chrono" ou "narratif"
  readScope: "", // "" = tout, chemin d'un dossier, ou "__selection__"
  readSelection: [], // chemins choisis pour la lecture en sélection manuelle
  timelineTagFilter: "", // "" = tous les jalons, sinon tag de la chronologie
  timelineScale: "annee", // "siecle" | "annee" | "mois" | "jour" | "aucune"
  chronoFolder: "Recherche/Chronologie", // chemin des jalons, relatif au projet
  journalFolder: "Journal", // dossier des notes de journal, relatif au projet
  liveDoubleEnter: true, // 2e Entrée consécutive = espace visible (ligne insécable)
  chapterNumbering: "continu", // "continu" | "parPartie" | "aucune"
  binderSearch: "", // recherche texte dans le binder
  binderSearchContent: true, // chercher aussi dans le CORPS des feuillets
  researchSearch: "", // recherche du panneau/mode Recherche
  researchTagFilter: "", // filtre par tag du panneau Recherche
  binderStatusFilter: "Tous", // filtre de statut dans le binder
  labels: [
    { name: "Rouge", color: "#e0524f" },
    { name: "Orange", color: "#e08f4f" },
    { name: "Jaune", color: "#d9c04a" },
    { name: "Vert", color: "#5aa564" },
    { name: "Bleu", color: "#5a8fd9" },
    { name: "Violet", color: "#9a6dd7" },
  ],
  labelFilter: "Tous",
  progressFilter: "Tous", // Tous | Atteint | En dessous | Dépassé
  compilePresets: [],
  activePreset: -1, // -1 = réglages par défaut
  statsRetention: 120, // jours d'historique conservés

  /* édition & fusion des scènes */
  splitStatus: 'brouillon',
  copyCompilerOnSplit: true,
  resetSynopsisOnSplit: true,
  resetResumeOnSplit: true,
  resetNotesOnSplit: true,
  mergeNotesSeparator: '\n\n---\n\n',
  mergeModeDefault: 'heading',
  mergeKeepSeparatorDefault: true,
  mergeYamlPreset: 'roman',

  /* panneau notes */
  notesShowEntities: true,
  notesShowSynopsis: true,
  notesShowResume: true,
  notesShowNotes: true,
  notesSectionOrder: ["Synopsis", "Résumé", "Notes"],

  /* panneau progression */
  autoOpenStructure: false,
  autoOpenJournal: false,
  structureSectionOrder: ["Progression", "Compteurs"],

  /* vues masquables : modes du panneau Cartes (board/outline/arcs/timeline/read)
     et panneaux latéraux (research/notes/progression/journal/tags) */
  hiddenBoardModes: [],
  hiddenPanels: [],

  /* suivi automatique des fils narratifs (fil:) — { [valeur]: chemin du
     feuillet qui porte le marqueur en attente } et liste des valeurs déjà
     résolues, à ne plus jamais retoucher automatiquement */
  filPlaceholders: {},
  filResolved: [],
};

