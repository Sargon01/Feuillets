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
  boardWholeManuscript: false, // Cartes : tout le manuscrit d'un coup (groupé par dossier) au lieu de naviguer dossier par dossier
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
  binderLayout: "split", // "tree" (historique) | "split" (dossiers | feuillets, façon Notebook Navigator/Ulysses — par défaut)
  binderSelectedPath: "", // dossier sélectionné dans le volet gauche en vue double volet
  binderTreeWidth: 170, // px, largeur du volet gauche en vue double volet
  binderTreeCollapsed: false, // replie le volet gauche (dossiers) en vue double volet — volet unique "fiches"
  binderListCollapsed: false, // replie le volet droit (feuillets) en vue double volet — volet unique "dossiers"
  listPanePreviewField: "synopsis", // "none" | "synopsis" | "resume" | "notes" | "tags" — champ affiché en aperçu dans le volet fichier (lecture seule)
  listPanePreviewLines: 2, // nombre de lignes avant troncature de l'aperçu

  binderSplitRecursive: true, // volet fichier : inclure les sous-dossiers du dossier sélectionné (sinon feuillets à plusieurs niveaux invisibles)
  swipeGesturesEnabled: true, // gestes trackpad/tactile pour ouvrir/fermer les volets latéraux — désactivable en cas de conflit avec un autre plugin
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
  exportEngine: "natif", // "natif" (zéro dépendance, fonctionne partout) | "pandoc" (avancé)
  exportTemplate: "classique", // "classique" | "moderne" | "tapuscrit" — voir utils/export-templates.js
  exportFormat: "docx", // "docx" | "epub" | "pdf" — dernier format choisi dans l'onglet Compilation & export
  docxReviewResolved: {}, // { docxName: { itemKey: { applied, dismissed } } }
  exportFrenchTypography: true, // guillemets/apostrophes/espaces insécables appliqués au texte compilé, quel que soit le réglage de frappe
  /* Réglages PDF / Impression WYSIWYG */
  pdfPageSize: "A4",
  pdfOrientation: "portrait",
  pdfMarginTop: 2.5,
  pdfMarginBottom: 2.5,
  pdfMarginLeft: 2.5,
  pdfMarginRight: 2.5,
  pdfMirrorMargins: true,
  pdfDiffHeaders: true,
  pdfHeaderLeft: "{title}",
  pdfHeaderRight: "{author}",
  pdfFooterLeft: "",
  pdfFooterRight: "Page {page} sur {pages}",
  pdfPageNumberPosition: "right", // "right" | "center" | "left"
  pdfHideFirstPageHeader: true,
  pdfOrphans: 2,
  pdfWidows: 2,
  pdfPreventHeadingOrphans: true,
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
  autoOpenProperties: true, // ouvre le panneau Propriétés au démarrage
  autoOpenResearch: false, // ouvre le panneau Recherche au démarrage — interface sobre par défaut
  autoOpenProject: true, // ouvre le panneau Projet & export au démarrage
  autoOpenDocxReview: true, // ouvre le panneau Révision au démarrage — désactivable si l'essai/thèse n'est pas en cycle de relecture
  autoOpenBinder: true, // ouvre le binder au démarrage (navigation principale, reste actif)
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
  binderLabelFilter: "Tous", // filtre de label dans le binder
  binderProgressFilter: "Tous", // filtre de progression dans le binder — "Tous" | "Atteint" | "En dessous" | "Dépassé"
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
  notesShowFootnotes: true,
  notesShowSynopsis: true,
  notesShowResume: true,
  notesShowNotes: true,
  notesSectionOrder: ["Synopsis", "Résumé", "Notes"],

  /* panneau progression */
  autoOpenJournal: false, // ouvre le panneau Journal & statistiques au démarrage — interface sobre par défaut
  structureSectionOrder: ["Progression", "Compteurs"],

  /* vues masquables : modes du panneau Cartes (board/outline/arcs/timeline/read)
     et panneaux latéraux (research/notes/progression/journal/tags) */
  hiddenBoardModes: [],
  hiddenPanels: [],

  /* suivi automatique des fils narratifs (fil:) — { [valeur]: chemin du
     feuillet qui porte le marqueur en attente }, { [valeur]: chemin du
     feuillet où le fil a été planté la première fois — pour ne jamais
     confondre une réédition de ce feuillet d'origine avec une vraie
     nouvelle apparition ailleurs } et liste des valeurs déjà résolues, à
     ne plus jamais retoucher automatiquement */
  filPlaceholders: {},
  filOrigins: {},
  filResolved: [],

  /* mots "appris" par l'utilisateur dans l'onglet Correction grammaticale —
     vocabulaire volontairement absent du dictionnaire (noms propres, mots
     étrangers...), à ne plus jamais signaler comme faute d'orthographe. */
  grammalecteKnownWords: [],
  /* fautes de grammaire ignorées (bouton "Ignorer" de l'onglet Correction
     grammaticale) — signatures "règle::mot" (voir grammarIssueSignature,
     services/grammalecte-checker.js), pas juste l'orthographe. */
  grammalecteIgnoredRules: [],
  /* désactivé par défaut : redon1/redon2 (répétitions de mots proches) sont
     bruyantes — Grammalecte lui-même les désactive par défaut. */
  grammalecteDetectRepetitions: false,
};

