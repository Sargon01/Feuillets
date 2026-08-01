// @ts-check

/** Type exhaustif pour DEFAULT_SETTINGS — source de vérité unique pour les réglages. */
export type DefaultSettings = {
  language: "auto" | "fr" | "en";
  insertFolderTitles: boolean;
  insertTitles: boolean;
  insertSceneTitles: boolean;
  /** Renumérote 1, 2, 3… en continu les notes de bas de page dans le
   *  manuscrit COMPILÉ (jamais les fichiers sources) — voir compile-export.ts
   *  et utils/footnotes.ts, renumberFootnotesAcrossTexts(). */
  footnoteRenumberOnCompile: boolean;
  separator: string;
  orders: Record<string, string[]>;
  folderPositions: Record<string, number>;
  folderGoals: Record<string, number>;
  collapsed: Record<string, boolean>;
  boardMode: "board" | "outline" | "arcs" | "timeline" | "read";
  boardWholeManuscript: boolean;
  statusFilter: string;
  statuses: Label[];
  tagFilter: string;
  autoRename: boolean;
  renamePrefix: string;
  level1Role: "parties" | "chapitres";
  tileSize: number;
  columns: number;
  showTags: boolean;
  showProgress: boolean;
  fontSize: number;
  liveJustify: boolean;
  readingMatchLive: boolean;
  readingFontSize: number;
  lineHeight: number;
  textWidth: number;
  binderLayout: "split" | "tree";
  binderSelectedPath: string;
  binderTreeWidth: number;
  binderTreeCollapsed: boolean;
  binderListCollapsed: boolean;
  binderCompact: boolean;
  binderSplitRecursive: boolean;
  swipeGesturesEnabled: boolean;
  uiScale: number;
  autoAnalyzeInRelecture: boolean;
  sessionGoal: number;
  projectWordGoal: number;
  deadlineDate: string;
  stats: Record<string, { start: number; latest: number }>;
  pandocPath: string;
  cardContent: "extrait" | "synopsis";
  indentParagraphs: boolean;
  outlineCols: Record<string, boolean>;
  outlineWidths: Record<string, number>;
  showCardTags: boolean;
  projects: string[];
  manuscriptTitle: string;
  manuscriptAuthor: string;
  pandocReference: string;
  epubLanguage: string;
  exportEngine: "natif" | "pandoc";
  exportTemplate: "classique" | "moderne" | "tapuscrit";
  exportFormat: "docx" | "epub" | "pdf";
  /* Aperçu (PreviewView) : quoi afficher. "scene" (défaut) n'affiche que
     le feuillet actif et ne compile jamais ; "chapter" assemble le
     chapitre courant ; "manuscript" passe par compile() et ne
     s'actualise qu'à la demande. */
  previewMode: "scene" | "chapter" | "part" | "manuscript";
  /* Modes Chapitre/Manuscrit : faire défiler l'aperçu jusqu'au feuillet
     qui devient actif. Sans effet en mode Scène (l'aperçu EST déjà le
     feuillet actif) et ne recompile jamais. */
  previewFollowScene: boolean;
  /* Défilement synchronisé entre la feuille Markdown active et l'aperçu,
     dans les DEUX sens. Purement visuel : ne rend rien, ne compile rien. */
  previewSyncScroll: boolean;
  /* Barre de PreviewView repliée : l'aperçu occupe alors toute la place.
     Purement visuel, mémorisé d'une session à l'autre. */
  previewBarCollapsed: boolean;
  docxReviewResolved: Record<string, Record<string, { applied: boolean; dismissed: boolean }>>;
  exportFrenchTypography: boolean;
  pdfPageSize: string;
  pdfOrientation: "portrait" | "landscape";
  pdfMarginTop: number;
  pdfMarginBottom: number;
  pdfMarginLeft: number;
  pdfMarginRight: number;
  pdfMirrorMargins: boolean;
  pdfDiffHeaders: boolean;
  pdfHeaderLeft: string;
  pdfHeaderRight: string;
  pdfFooterLeft: string;
  pdfFooterRight: string;
  pdfPageNumberPosition: "right" | "center" | "left";
  pdfHideFirstPageHeader: boolean;
  pdfOrphans: number;
  pdfWidows: number;
  pdfPreventHeadingOrphans: boolean;
  liveApostrophe: boolean;
  liveGuillemets: boolean;
  liveDashes: boolean;
  liveEmptyLines: "normal" | "reduit" | "invisible";
  liveHyphenation: boolean;
  liveTwoEnters: boolean;
  concentrationWidth: number;
  dimOpacity: number;
  concentrationUnit: "line" | "paragraph";
  concentrationTypewriter: boolean;
  concentrationCounter: boolean;
  uiTransparentPanels: boolean;
  uiTransparentTabBar: boolean;
  uiHideVaultSwitcher: boolean;
  uiDimTabActions: boolean;
  projectMeta: Record<string, ProjectMeta>;
  autoOpenNotes: boolean;
  autoOpenProperties: boolean;
  autoOpenResearch: boolean;
  autoOpenProject: boolean;
  autoOpenDocxReview: boolean;
  autoOpenBinder: boolean;
  binderShowLabels: boolean;
  binderShowTags: boolean;
  binderShowStatus: boolean;
  binderShowProgress: boolean;
  binderShowWords: boolean;
  sceneNumbering: "hier" | "continue" | "aucune";
  timelineOrder: "chrono" | "narratif";
  readScope: string;
  readSelection: string[];
  timelineTagFilter: string;
  timelineScale: "siecle" | "annee" | "mois" | "jour" | "aucune";
  chronoFolder: string;
  journalFolder: string;
  liveDoubleEnter: boolean;
  chapterNumbering: "continu" | "parPartie" | "aucune";
  binderSearch: string;
  binderSearchContent: boolean;
  researchSearch: string;
  researchTagFilter: string;
  binderStatusFilter: string;
  binderLabelFilter: string;
  binderProgressFilter: "Tous" | "Atteint" | "En dessous" | "Dépassé";
  labels: Label[];
  labelFilter: string;
  progressFilter: "Tous" | "Atteint" | "En dessous" | "Dépassé";
  compilePresets: unknown[];
  activePreset: number;
  statsRetention: number;
  splitStatus: string;
  copyCompilerOnSplit: boolean;
  resetSynopsisOnSplit: boolean;
  resetResumeOnSplit: boolean;
  resetNotesOnSplit: boolean;
  mergeNotesSeparator: string;
  mergeModeDefault: "heading" | "comment" | "continuous";
  mergeKeepSeparatorDefault: boolean;
  mergeYamlPreset: string;
  notesShowEntities: boolean;
  notesShowFootnotes: boolean;
  notesShowSynopsis: boolean;
  notesShowResume: boolean;
  notesShowNotes: boolean;
  notesSectionOrder: string[];
  autoOpenJournal: boolean;
  structureSectionOrder: string[];
  hiddenBoardModes: string[];
  hiddenPanels: string[];
  filPlaceholders: NarrativeThreadState["filPlaceholders"];
  filOrigins: NarrativeThreadState["filOrigins"];
  filResolved: NarrativeThreadState["filResolved"];
  backupEnabled: boolean;
  backupIntervalMinutes: number;
  backupKeepCount: number;
  [key: string]: unknown;
};

export const DEFAULT_SETTINGS: DefaultSettings = {
  language: "auto",
  insertFolderTitles: true,
  insertTitles: true,
  insertSceneTitles: false,
  footnoteRenumberOnCompile: true,
  separator: "\n\n",
  orders: {},
  folderPositions: {},
  folderGoals: {},
  collapsed: {},
  boardMode: "board",
  boardWholeManuscript: false,
  statusFilter: "Tous",
  statuses: [
    { name: "Idée", color: "#8a8a8a" },
    { name: "Brouillon", color: "#e08f4f" },
    { name: "En cours", color: "#d9c04a" },
    { name: "Révisé", color: "#5a8fd9" },
    { name: "Terminé", color: "#5aa564" },
  ],
  tagFilter: "",
  autoRename: true,
  renamePrefix: "chapitre",
  level1Role: "parties",
  tileSize: 240,
  columns: 0,
  showTags: true,
  showProgress: false,
  fontSize: 14,
  liveJustify: false,
  readingMatchLive: true,
  readingFontSize: 0,
  lineHeight: 0,
  textWidth: 0,
  binderLayout: "split",
  binderSelectedPath: "",
  binderTreeWidth: 170,
  binderTreeCollapsed: false,
  binderListCollapsed: false,
  binderCompact: false,
  binderSplitRecursive: true,
  swipeGesturesEnabled: true,
  uiScale: 100,
  autoAnalyzeInRelecture: true,
  sessionGoal: 0,
  projectWordGoal: 0,
  deadlineDate: "",
  stats: {},
  pandocPath: "pandoc",
  cardContent: "extrait",
  indentParagraphs: true,
  outlineCols: {
    synopsis: true, summary: false, notes: false, tags: false, label: false,
    status: true, date: false, compile: false, filename: false,
    words: true, goal: true, progress: true,
  },
  outlineWidths: {
    title: 260, synopsis: 320, summary: 340, notes: 300, tags: 150, label: 110,
    status: 105, date: 160, compile: 80, filename: 200, words: 85, goal: 85, progress: 90,
  },
  showCardTags: false,
  projects: [],
  manuscriptTitle: "",
  manuscriptAuthor: "",
  pandocReference: "reference-feuillets.docx",
  epubLanguage: "fr",
  exportEngine: "natif",
  exportTemplate: "classique",
  exportFormat: "docx",
  previewMode: "scene",
  previewFollowScene: true,
  previewSyncScroll: true,
  previewBarCollapsed: false,
  docxReviewResolved: {},
  exportFrenchTypography: true,
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
  pdfPageNumberPosition: "right",
  pdfHideFirstPageHeader: true,
  pdfOrphans: 2,
  pdfWidows: 2,
  pdfPreventHeadingOrphans: true,
  liveApostrophe: true,
  liveGuillemets: true,
  liveDashes: true,
  liveEmptyLines: "normal",
  liveHyphenation: false,
  liveTwoEnters: false,
  concentrationWidth: 720,
  dimOpacity: 35,
  concentrationUnit: "line",
  concentrationTypewriter: true,
  concentrationCounter: true,
  uiTransparentPanels: false,
  uiTransparentTabBar: false,
  uiHideVaultSwitcher: false,
  uiDimTabActions: false,
  projectMeta: {},
  autoOpenNotes: false,
  autoOpenProperties: true,
  autoOpenResearch: false,
  autoOpenProject: true,
  autoOpenDocxReview: true,
  autoOpenBinder: true,
  binderShowLabels: false,
  binderShowTags: false,
  binderShowStatus: false,
  binderShowProgress: false,
  binderShowWords: false,
  sceneNumbering: "hier",
  timelineOrder: "chrono",
  readScope: "",
  readSelection: [],
  timelineTagFilter: "",
  timelineScale: "annee",
  chronoFolder: "Recherche/Chronologie",
  journalFolder: "Journal",
  liveDoubleEnter: true,
  chapterNumbering: "continu",
  binderSearch: "",
  binderSearchContent: true,
  researchSearch: "",
  researchTagFilter: "",
  binderStatusFilter: "Tous",
  binderLabelFilter: "Tous",
  binderProgressFilter: "Tous",
  labels: [
    { name: "Rouge", color: "#e0524f" },
    { name: "Orange", color: "#e08f4f" },
    { name: "Jaune", color: "#d9c04a" },
    { name: "Vert", color: "#5aa564" },
    { name: "Bleu", color: "#5a8fd9" },
    { name: "Violet", color: "#9a6dd7" },
  ],
  labelFilter: "Tous",
  progressFilter: "Tous",
  compilePresets: [],
  activePreset: -1,
  statsRetention: 120,
  splitStatus: "brouillon",
  copyCompilerOnSplit: true,
  resetSynopsisOnSplit: true,
  resetResumeOnSplit: true,
  resetNotesOnSplit: true,
  mergeNotesSeparator: "\n\n---\n\n",
  mergeModeDefault: "heading",
  mergeKeepSeparatorDefault: true,
  mergeYamlPreset: "roman",
  notesShowEntities: true,
  notesShowFootnotes: true,
  notesShowSynopsis: true,
  notesShowResume: true,
  notesShowNotes: true,
  notesSectionOrder: ["Synopsis", "Résumé", "Notes"],
  autoOpenJournal: false,
  structureSectionOrder: ["Progression", "Compteurs"],
  hiddenBoardModes: [],
  hiddenPanels: [],
  filPlaceholders: {},
  filOrigins: {},
  filResolved: [],
  backupEnabled: true,
  backupIntervalMinutes: 30,
  backupKeepCount: 5,
};