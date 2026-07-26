/** Formes de données majeures de Feuillets, déclarées une seule fois pour
 * tout le plugin. Fichier de déclaration global (aucun import/export au
 * niveau racine) : ces types sont visibles depuis n'importe quel fichier
 * sans rien importer — on écrit simplement `@param {SceneFrontmatter} fm`.
 *
 * Le code reste en JavaScript, la vérification est OPT-IN fichier par
 * fichier via `// @ts-check` en tête (tsconfig garde `checkJs: false`).
 * Ajouter la directive à un fichier le fait entrer dans le `tsc -noEmit`
 * du build — ne l'ajouter qu'après avoir vérifié qu'il passe.
 *
 * Règle : ne déclarer que des champs VÉRIFIÉS dans le code. Un type qui
 * ment est pire que pas de type — il fait passer une faute de frappe pour
 * un accès légitime. */

/** Frontmatter YAML d'un feuillet. Tout est optionnel : le frontmatter est
 * écrit à la main par l'auteur, rien ne garantit qu'une clé existe ni
 * qu'elle a le bon type — d'où les `typeof x === "string"` défensifs de
 * services/frontmatter.js. La signature d'index autorise les clés libres :
 * un projet peut définir ses propres champs. */
declare type SceneFrontmatter = {
  /** Titre affiché et compilé ; `title` est le repli anglophone. */
  titre?: string;
  title?: string;
  /** Sous-titre, compilé un niveau sous `titre` (compiledSubtitleFor). */
  sous_titre?: string;
  /** Titre court des vues denses ; `titre_court` est l'ancienne clé,
   *  conservée pour les fiches antérieures au renommage. */
  titre_binder?: string;
  titre_court?: string;
  /** Fiches personnage du panneau Recherche : replis du titre (titleFor). */
  nom?: string;
  "prénom"?: string;

  /** Rang dans la fratrie, écrit par writeOrder(). 1-indexé. */
  ordre?: string | number;
  /** L'une des valeurs de STATUSES (src/constants.js). */
  statut?: string;
  /** Liste YAML, ou chaîne séparée par virgules/espaces (tagsOf). */
  tags?: string | string[];
  /** Un feuillet peut porter plusieurs labels (labelsOf). */
  label?: string | string[];
  /** Inclusion à la compilation ; `compile` est l'ancienne clé. */
  compiler?: boolean;
  compile?: boolean;

  synopsis?: string;
  resume?: string;
  notes?: string;
  objectif?: number;
  date?: string;
  type?: string;

  /** Fils narratifs — voir services/narrative-threads.js. */
  fil?: string | string[];
  arc?: string | string[];
  arcs?: string | string[];
  arc_secondaire?: string | string[];
  personnages?: string | string[];
  rythme?: string;

  /** Fiches de chronologie / bibliographie. */
  annee?: string | number;
  naissance?: string;
  mort?: string;
  birth?: string;
  death?: string;
  auteur?: string;
  editeur?: string;
  edition?: string;
  cite_count?: number;

  [key: string]: any;
};

/** Label de couleur, tel que stocké dans settings.labels / ProjectMeta.labels. */
declare type Label = {
  name: string;
  color: string;
};

/** Métadonnées par dossier projet : `settings.projectMeta[cheminDossier]`.
 * À la fois fiche d'identité (nom, icône, type, description) et réglages
 * propres à CE projet, qui priment sur les réglages globaux du même nom.
 * Écrit champ par champ par ui/project-modals.js — TOUT est optionnel,
 * `{}` est un état normal (voir `S.projectMeta[path] = {}`). */
declare type ProjectMeta = {
  /** Nom d'affichage personnalisé ; sinon le nom du dossier. */
  name?: string;
  /** Emoji ou nom d'icône Lucide. */
  icon?: string;
  /** Clé de PROJECT_MODES (utils/project-modes.js) : "fiction", "nonfiction"… */
  type?: string;
  description?: string;
  author?: string;
  /** Palette propre au projet ; sinon repli sur settings.labels (labelColor). */
  labels?: Label[];
  /** Style bibliographique — services/citations.js. */
  citationStyle?: string;

  /* Réglages globaux surchargés par projet. */
  boardMode?: string;
  boardWholeManuscript?: boolean;
  cardContent?: string;
  hiddenBoardModes?: string[];

  [key: string]: any;
};

/** Marges en centimètres, forme normalisée renvoyée par marginsFor(). */
declare type Margins = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Style d'un niveau de titre (h1/h2/h3) d'un modèle d'export. Champ absent
 * = repli du moteur concerné ; niveau entièrement absent = repli historique
 * « saut de page systématique, police héritée » (normalizeHeadings). */
declare type HeadingStyle = {
  fontSizePt?: number;
  align?: string;
  bold?: boolean;
  italic?: boolean;
  marginTopPt?: number;
  marginBottomPt?: number;
  pageBreakBefore?: boolean;
};

/** Style d'un rôle de page de titre (titre, sous-titre, mots, auteur,
 * adresse, coordonnées — rôles libres, voir titleRoleCss). */
declare type TitlePageStyle = {
  fontSizePt?: number;
  align?: string;
  bold?: boolean;
  italic?: boolean;
  marginTopPt?: number;
  marginBottomPt?: number;
};

/** Modèle de mise en page pour l'export natif EPUB/DOCX/PDF — source de
 * vérité unique consommée par les trois formats (utils/export-templates.js).
 *
 * Un modèle personnalisé est un fichier Resources/Layouts/<clé>.md dont le
 * frontmatter est fusionné PAR-DESSUS le modèle « classique »
 * (loadCustomTemplates) : d'où la signature d'index, et d'où le fait que
 * seuls `key` et `label` sont réellement garantis présents. */
declare type ExportTemplate = {
  /** Identifiant ET nom de fichier du modèle personnalisé : "classique"… */
  key: string;
  /** Libellé affiché dans le sélecteur d'export. */
  label: string;
  /** Vrai pour un modèle issu de Resources/Layouts, pas un intégré. */
  custom?: boolean;

  fontFamily?: string;
  /** Police des titres ; repli sur fontFamily si absente (templateToCss). */
  headingFontFamily?: string;
  fontSizePt?: number;
  /** Multiplicateur (2 = double interligne), pas une valeur en points. */
  lineHeight?: number;
  align?: string;
  /** Alinéa de première ligne ; `indentPt` en règle la largeur (défaut 1.5em). */
  indent?: boolean;
  indentPt?: number;
  /** Espacement entre paragraphes : `true` = 1em après. Alternative exclusive,
   *  `paragraphSpacingPt` = espacement explicite AVANT, en points. */
  paragraphSpacing?: boolean;
  paragraphSpacingPt?: number;
  hyphenation?: boolean;
  blockquote?: { italic?: boolean; colorHex?: string };

  /** Marge uniforme ; `marginsCm` (asymétrique) prime si présent (marginsFor). */
  marginCm?: number;
  marginsCm?: Margins;

  pageNumbers?: boolean;
  /** "footer-right" par défaut ; "header-right" est DOCX uniquement. */
  pageNumberPosition?: string;
  /** Texte affiché à la place d'un `<hr>`, ex. "* * *". */
  sceneDivider?: string;

  /* Supports paginés uniquement (export PDF) : l'EPUB, reflowable par nature,
     ignore volontairement ces deux champs — voir templatePrintCss. */
  /** "landscape" ; posé dans la règle @page par l'appelant, pas ici. */
  pageOrientation?: string;
  columns?: { count: number; gutterPt: number };

  headings?: { h1?: HeadingStyle; h2?: HeadingStyle; h3?: HeadingStyle };
  /** Ancien champ, H1 uniquement — normalizeHeadings le traduit en headings.h1. */
  chapterTitle?: HeadingStyle;

  titlePage?: { styles?: Record<string, TitlePageStyle> };

  [key: string]: any;
};

/** Réglages du plugin. Volontairement PARTIEL : seuls les champs consommés
 * par du code déjà vérifié sont déclarés, la signature d'index couvre le
 * reste. DEFAULT_SETTINGS (src/default-settings.js) reste la référence
 * exhaustive et commentée — ne pas la dupliquer ici. */
declare type FeuilletsSettings = {
  /** Chemin du dossier projet actif. Réellement optionnel : c'est le seul
   *  champ ci-dessous ABSENT de DEFAULT_SETTINGS, donc undefined tant
   *  qu'aucun projet n'a été choisi — d'où le garde de labelColor(). */
  projectFolder?: string;

  /* Les champs suivants sont NON optionnels : loadSettings() fait un
     `Object.assign({}, DEFAULT_SETTINGS, data)` (src/main.js), donc toute
     clé de DEFAULT_SETTINGS est toujours présente, même sur un data.json
     ancien ou tronqué. Les déclarer optionnels obligerait à écrire des
     gardes `?.` mensongers dans tout le code. */
  projectMeta: Record<string, ProjectMeta>;
  /** Palette globale, repli quand le projet n'a pas la sienne. */
  labels: Label[];
  /** { cheminDossier: objectif en mots }. */
  folderGoals: Record<string, number>;
  /** { cheminDossier: [noms des enfants, dans l'ordre] }. */
  orders: Record<string, string[]>;
  folderPositions: Record<string, number>;

  [key: string]: any;
};
