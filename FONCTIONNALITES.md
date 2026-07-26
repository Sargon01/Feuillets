# Feuillets — fonctionnalités et options

Document exhaustif des fonctionnalités du plugin, organisé des réglages les plus
ponctuels aux systèmes les plus importants. Chaque section liste ses options ;
les réglages du plugin (Réglages → Feuillets) sont signalés par **[Réglages]**,
les menus/panneaux par **[Panneau]** ou **[Menu]**.

---

## 1. Typographie à la frappe

Corrections automatiques pendant la saisie dans l'éditeur, inspirées de French
Typos (réimplémentées, non copiées).

- **Apostrophe typographique** `'` → `’` — **[Réglages]** `liveApostrophe`
- **Guillemets français** `"` → `« »` contextuels, avec espaces insécables —
  **[Réglages]** `liveGuillemets`
- **Tirets** `--` → `–` (incise) / `---` → `—` (dialogue), avec espace
  insécable — **[Réglages]** `liveDashes`
- **Lignes vides entre paragraphes** : normal / réduit / invisible —
  **[Réglages]** `liveEmptyLines`
- **Double Entrée** = saut de paragraphe visible (ligne à espace insécable)
  — **[Réglages]** `liveTwoEnters` / `liveDoubleEnter`
- **Césure française en mode lecture** — **[Réglages]** `liveHyphenation`
- **Alinéas automatiques** en début de paragraphe dans l'éditeur —
  **[Réglages]** `indentParagraphs`
- **Justification en Live Preview** (sans césure, coûterait trop cher au
  défilement) — **[Réglages]** `liveJustify`
- Commande **"Typographie française (sélection ou document)"** — applique
  guillemets/apostrophe/points de suspension/espaces insécables a posteriori
  sur du texte déjà tapé (hors code, jamais touché)

## 2. Correction grammaticale (Grammalecte)

Vérification grammaticale et orthographique du feuillet actif, intégrée à
l'éditeur — bureau uniquement.

- **Vérification à la demande** — commande "Correction grammaticale :
  vérifier le feuillet actif", nécessite le panneau latéral Feuillets ouvert
  (n'importe quel onglet) pour initialiser le vérificateur
- **Navigation entre fautes** — commandes "aller à la faute suivante" /
  "aller à la faute précédente" (`grammalecte-next-issue`,
  `grammalecte-prev-issue`), déplacement direct dans l'éditeur
- **Soulignement dans l'éditeur** — extension CodeMirror dédiée
  (`grammarIssuesField`), avec gestionnaire de clic sur les fautes signalées
  (`grammarClickHandler`)
- **Indisponible sur mobile** — `GrammalecteChecker` dépend de
  `worker_threads` (Node), non chargé si `Platform.isMobile`

## 3. Chercher et remplacer

Barre de recherche/remplacement dédiée au manuscrit, distincte de la
recherche native d'Obsidian.

- Commande **"Chercher et remplacer dans le manuscrit…"** — ouvre/ferme la
  barre (`toggleSearchReplaceBar`)
- **Surlignage des correspondances** dans l'éditeur — extension CodeMirror
  dédiée (`searchHighlightField`)

## 4. Citations et notes de bas de page

Outils d'insertion et de gestion des références, pensés pour l'écriture
académique ou documentée (essais, non-fiction).

- **Insérer une note de bas de page** — commande dédiée, ajoute un marqueur
  `[^n]` au curseur et sa définition en fin de document, numérotation
  automatique (`nextFootnoteNumber`)
- **Renuméroter les notes de bas de page** — commande qui réordonne tous les
  marqueurs et leurs définitions dans l'ordre du document
  (`renumberFootnotes`)
- **Insérer une citation** — modale dédiée (`CitationSourceModal`),
  formatage automatique de la référence (`formatCitation`) à partir d'une
  fiche Source du panneau Recherche

## 5. Outils d'édition de texte

Commandes ponctuelles de nettoyage et de restructuration du texte, sur
sélection ou document entier.

- **Réparer les séparateurs de scène échappés** — corrige les `\*\*\*`
  produits par certains éditeurs externes en véritables `***`
- **Compacter les lignes vides** — remplace les lignes vides multiples par
  des sauts de ligne simples (sélection ou document)
- **Insérer un séparateur de scène** — insère `***` au curseur
- **Extraire et éclater la chronologie active** — découpe un document de
  chronologie (titres `##`/`###` datés) en fiches individuelles dans le
  dossier Chronologie, avec synopsis auto-généré et tag `evenement`

## 6. Mode concentration

Plein écran d'écriture, activable par icône (ruban, binder) ou commande.

- **Largeur de colonne** (px) — **[Réglages]** `concentrationWidth`
- **Opacité d'estompage** du texte hors focus (%) — **[Réglages]** `dimOpacity`
- **Unité de focus** : ligne ou paragraphe — **[Réglages]** `concentrationUnit`
- **Ligne du curseur maintenue centrée** (façon machine à écrire) —
  **[Réglages]** `concentrationTypewriter`
- **Compteur de mots flottant** pendant la frappe — **[Réglages]**
  `concentrationCounter`
- Sort avec Échap ; replie automatiquement les deux barres latérales à
  l'activation (et les restaure à la sortie)

## 7. Gestes de balayage (swipe)

Ouverture/fermeture des barres latérales par geste, sans clic — **[Réglages]**
`swipeGesturesEnabled`.

- **Tactile** (mobile/tablette, écran tactile) : balayage horizontal, zone de
  détection 37 % gauche / 37 % droit de la largeur de fenêtre
- **Trackpad à 2 doigts** (macOS/Windows) : accumulation du défilement
  horizontal (`wheel`) sur toute la durée du geste, un seul déclenchement par
  geste physique ; pas de zone de détection par bord — le curseur peut se
  trouver n'importe où hors de l'éditeur, seule la moitié de fenêtre où le
  geste démarre (gauche/droite) décide quel volet est ciblé
- **Volet gauche (Binder)** : cycle à 3 états — Fermé ↔ Fiches (volet fichiers
  seul) ↔ Dossiers (double volet complet)
- **Volet droit** (panneau Feuillets — Inspecteur) : bascule simple ouvert/
  fermé
- Écouteurs posés en phase de capture sur `window`, pour rester prioritaires
  sur d'éventuels plugins tiers basés sur React (ex. Notebook Navigator) qui
  posent leurs propres gestionnaires délégués `wheel`/`touch*` plus bas dans
  l'arbre DOM

## 8. Labels de couleur

Étiquettes visuelles appliquées à un feuillet ou une note de dossier, visibles
dans le binder (liseré), le Tableau (filtre, liseré des tuiles) et le panneau
Propriétés.

- 6 couleurs par défaut (Rouge/Orange/Jaune/Vert/Bleu/Violet), renommables et
  recolorables — **[Réglages]** `labels`
- Peuvent être redéfinis **par projet** (`projectMeta[chemin].labels`)
- Filtre par label dans le binder et le Tableau/plan

## 9. Fils narratifs et arcs

Suivi de fils d'intrigue à travers les feuillets, via frontmatter.

- **`thread:`** (anciennement `fil:`, toujours lu en repli — et non
  `feuillets_fil`) — liste de fils ouverts sur une scène, séparés par virgule
- **Suivi automatique planté/résolu** : mémorise où un fil a été planté
  (`filOrigins`), où il attend sa résolution (`filPlaceholders`), et les
  valeurs déjà résolues à ne jamais retoucher (`filResolved`)
- **Arcs** (`arc`/`arc_secondary`, ou `argument`/`angle` selon le mode de
  projet) — colonnes colorées dans le mode Chemin de fer (Canvas)
- Couleur des fils dans le mode Chemin de fer : cohérente avec les labels

## 10. Multi-projets

- Liste de dossiers-projets alternatifs, en plus du dossier actif —
  **[Réglages]** `projects`
- **Changer de projet…** — commande/menu listant tous les projets connus,
  bascule tous les panneaux d'un coup (`renderAllViews(true)`)
- **Gestion des projets…** — ouvre le panneau Projet & export
- **Métadonnées par projet** (`projectMeta`) : auteur, type (fiction/non-
  fiction), description, labels, modes de Tableau masqués — indépendantes
  d'un projet à l'autre

## 11. Import de projets externes

- **Importer un plan en arborescence** — Markdown multi-niveaux → dossiers
  Parties/Chapitres + fichiers Scènes (`ImportOutlineModal`)
- **Importer un projet Scrivener…** — conversion d'un projet `.scriv` vers
  la structure Feuillets, bureau uniquement (accès système de fichiers
  requis, `ScrivenerImportModal`)

## 12. Panneau Journal d'écriture

Calendrier mensuel de suivi d'écriture, indépendant de la structure du
manuscrit.

- **Grille mensuelle** avec navigation mois précédent/suivant
- **Point vert** sur les jours ayant une entrée de journal ; infobulle avec
  le delta de mots écrits ce jour-là
- **Aujourd'hui** mis en évidence
- Clic sur un jour → ouvre/édite l'entrée de ce jour (création à la volée si
  absente)
- **Dernière entrée** affichée par défaut (rendu Markdown, lecture seule dans
  le panneau ; édition en ouvrant l'entrée dans un onglet)
- **Compiler le carnet** — assemble les entrées en un seul document
- Dossier des entrées configurable — **[Réglages]** `journalFolder`
- Rétention de l'historique de statistiques (jours conservés) — **[Réglages]**
  `statsRetention`

## 13. Panneau Statistiques (Progression)

Compteurs et objectifs, à deux niveaux : projet entier et feuillet actif.

- **Objectif de mots** — barre de progression colorée (atteint/en
  dessous/dépassé, tolérance réglable) — pour le projet (`projectWordGoal`)
  et pour la scène active (champ `objectif` du frontmatter, repli sur
  `wordGoal`)
- **Compteurs détaillés** : caractères, caractères sans espaces, phrases,
  mots/phrase, paragraphes, pages estimées, temps de lecture — pour le
  feuillet actif et pour le projet entier
- **Historique récent** — histogramme des mots écrits sur les 14 derniers
  jours (mêmes données que le Journal d'écriture), total sur la période
- Sections repliables et persistantes (icône + titre, même patron que les
  autres panneaux)

## 14. Panneau Recherche

Fiches de "bible" narrative, organisées par catégorie — vocabulaire différent
selon le mode de projet (voir §19).

- **Catégories fiction** : Personnages, Lieux, Lore (Codex), Bibliographie,
  Glossaire, Événements
- **Catégories non-fiction** : Sources, Acteurs, Géographie, Concepts,
  Bibliographie, Glossaire, Événements
- **Dossiers personnalisés** ajoutés par l'utilisateur, détectés
  automatiquement (tout sous-dossier non standard de Ressources/Recherche)
- **Recherche texte** dans les fiches — **[Réglages]** `researchSearch`
- **Filtre par tag** (icône, menu au lieu d'un menu déroulant) —
  **[Réglages]** `researchTagFilter`
- **Migration de la recherche** — commande "Regrouper la recherche dans
  _Recherche" : déplace les anciens dossiers `_Personnages`, `_Lieux`,
  `_Chronologie` et bases associées vers `_Recherche/…`, liens mis à jour
- Clic sur une fiche → vue détaillée dans le panneau (retour à la liste)

## 15. Panneau Notes

Contexte et métadonnées du feuillet ouvert, tout ce qui n'est jamais compilé
ni compté dans le manuscrit.

- **Notes de dossier** — pastilles cliquables vers les notes de Partie/
  Chapitre englobant le feuillet ouvert (création à la volée)
- **Jalons historiques** — jalons de la Chronologie datés au même point que
  la scène active, rendu Markdown intégré
- **Tags** de la scène active, en pastilles
- **Contexte** — fiches de Recherche citées dans le texte (détection par
  wikilien ou par occurrence du nom/alias), avec âge du personnage à la date
  de la scène le cas échéant ; section repliable — **[Réglages]**
  `notesShowEntities`
- **Synopsis / Résumé / Notes de travail / Sources** — champs éditables en
  place (clic pour révéler une zone de texte), repliables individuellement,
  **réordonnables** (flèches haut/bas) — **[Réglages]** `notesShowSynopsis`,
  `notesShowResume`, `notesShowNotes`, `notesSectionOrder`
- **Plan** (outline) — titres `#` à `######` du feuillet ouvert, cliquables
  pour sauter à l'endroit exact dans l'éditeur ; toujours en dernière
  section (remplace le panneau natif "Plan" d'Obsidian, scopé pareil au
  fichier ouvert)

## 16. Panneau Propriétés

Alternative scopée-projet au panneau natif "Toutes les propriétés"
d'Obsidian (qui liste tout le coffre), et remplaçant de l'ancien panneau Tags.

- **Fichier ouvert** — propriétés du frontmatter éditables directement, avec
  icône de type (texte/liste/nombre/case à cocher/date/date+heure, inférée
  de la valeur) : case à cocher pour les booléens, vrai sélecteur de date
  pour les dates, éditeur à jetons pour les listes ; ajout d'une nouvelle
  propriété, suppression individuelle
- **Propriétés du projet** — toutes les clés utilisées dans le projet,
  agrégées ; dépliable clé → valeurs distinctes → fichiers concernés
  (cliquables) ; bouton "+" pour ajouter une propriété existante au fichier
  ouvert ; suppression d'une propriété de **tous** les feuillets du projet
  (avec confirmation)
- **Tags du projet** — même arborescence dépliable, avec champ de recherche/
  filtre, bouton "+" pour ajouter un tag au fichier ouvert, suppression d'un
  tag de tous les feuillets concernés (avec confirmation)
- Sections repliables et persistantes

## 17. Panneau Révision (retours .docx)

Panneau dédié à l'intégration des retours d'un directeur ou d'un éditeur
reçus sous forme de fichier `.docx` annoté.

- Commande **"Ouvrir le panneau Révision (retours .docx d'un directeur/
  éditeur)"**
- Panneau masquable indépendamment des autres — **[Réglages]** `hiddenPanels`
  (clé `docxReview`)

## 18. Panneau Projet & export

Panneau dédié, qui reste ouvert (contrairement à un menu), pour les actions
de gestion de projet et d'export.

- **Projet** — liste des projets connus, clic pour changer d'actif ; "Nouveau
  projet…", "Gestion des projets…"
- **Compilation** — preset actif (clic pour changer), ".md (Markdown
  compilé)", "Choisir les feuillets à compiler…"
- **Export** — modèle de mise en page actif (clic pour changer, avec option
  d'exporter les modèles intégrés vers des fichiers personnalisables),
  boutons .docx/.epub/.pdf
- Sections repliables et persistantes, icônes de section (pas de bouton
  texte encadré — même vocabulaire visuel que les autres panneaux)

## 19. Binder (navigation principale)

Barre latérale gauche, toujours visible — arborescence du manuscrit.

- **4 modes d'affichage**, cycle par un seul bouton : Double volet (dossiers
  | feuillets) → Dossiers seuls → Fichiers seuls → Vue arbre classique →
  (retour au double volet) — **[Réglages]** `binderLayout`,
  `binderTreeCollapsed`, `binderListCollapsed`
- **Double volet** : volet gauche redimensionnable (`binderTreeWidth`),
  portée Projet uniquement ou Tout le coffre (`binderSplitScope`),
  sous-dossiers inclus ou non dans le volet fichiers
  (`binderSplitRecursive`) ; chaque volet a son propre "+" contextuel
  (dossier à gauche, feuillet à droite dans le dossier sélectionné)
- **Filtres combinés** (ET logique) : statut, label, progression —
  **[Réglages]** `binderStatusFilter`, `binderLabelFilter`,
  `binderProgressFilter`
- **Recherche** : titres seuls ou titres + corps du texte (indexé) —
  **[Réglages]** `binderSearch`, `binderSearchContent`
- **Options d'affichage** (menu) : liserés de labels, pastilles de tags,
  pastille de statut, barres de progression, nombre de mots en chiffres,
  champ d'aperçu sous le titre (aucun/extrait/synopsis/résumé/notes/tags) et
  son nombre de lignes — **[Réglages]** `binderShowLabels`,
  `binderShowTags`, `binderShowStatus`, `binderShowProgress`,
  `binderShowWords`, `listPanePreviewField`, `listPanePreviewLines`
- **Gestion du projet et export** → panneau dédié (§18), plus de bouton ici
- **Mode concentration** — icône directe dans la barre
- **Glisser-déposer** pour réorganiser/déplacer feuillets et dossiers, y
  compris déposer un feuillet directement sur un dossier frère (même
  parent) pour l'y déplacer ; commande "Annuler le dernier déplacement"
- Si un feuillet déplacé finit par porter **exactement le même nom que son
  dossier parent**, il devient la note de ce dossier (synopsis/description)
  au lieu d'une scène — exclu des vues en conséquence ; une notification
  explique le changement plutôt que de le laisser silencieux
- **Navigation clavier** : flèches ↑/↓ = feuillet suivant/précédent dans
  l'ordre du manuscrit (comme les commandes "Feuillet suivant/précédent"),
  dès que le focus est dans le Binder — le dossier sélectionné suit
  automatiquement si la fiche voisine appartient à un autre dossier
- **Import de plan** (Markdown multi-niveaux → arborescence de dossiers/
  scènes)
- Renumérotation automatique des chapitres — **[Réglages]** `autoRename`,
  `renamePrefix`, `chapterNumbering`, `sceneNumbering`

## 20. Tableau / Plan (vue centrale)

Panneau central, 5 modes d'affichage, toujours visible.

- **Cartes** — tuiles en grille (taille réglable ou colonnes fixes,
  contenu extrait/synopsis, tags et barres de progression optionnels) —
  **[Réglages]** `tileSize`, `columns`, `cardContent`, `showCardTags`,
  `showProgress` ; en mode "Tout le manuscrit", les en-têtes de dossier sont
  repliables (chevron) et réorganisables par glisser-déposer
- **Plan** (outline) — tableau de colonnes configurables (synopsis, résumé,
  notes, tags, label, statut, date, compiler, fichier, mots, objectif,
  progression), largeurs ajustables — **[Réglages]** `outlineCols`,
  `outlineWidths` ; les lignes de dossier sont repliables (chevron, même clé
  de repli que le Binder) et réorganisables par glisser-déposer
- **Chemin de fer** (Canvas) — corkboard généré en tableau natif Obsidian
  (Canvas), cartes colorées par label, colonnes par fil narratif ; pensé
  pour rester fluide même à 100 scènes — commande "Générer/mettre à jour le
  tableau canvas"
- **Chronologie** — jalons + scènes datées, ordre chronologique ou narratif,
  échelle (siècle/année/mois/jour/sans en-têtes), filtre par tag —
  **[Réglages]** `timelineOrder`, `timelineScale`, `timelineTagFilter`
- **Lecture** — flux continu en lecture, périmètre réglable (tout le
  manuscrit, un dossier, sélection manuelle de feuillets) — **[Réglages]**
  `readScope`, `readSelection`
- **Filtres combinés** (statut/label/progression) + recherche par tag, comme
  le binder
- **Sélection multiple** — mode dédié (cases discrètes), fusionner/
  dupliquer/déplacer plusieurs feuillets d'un coup
- **Modes affichés** — masquer les modes non utilisés (par projet)
- **Options de la vue** — réglages propres au mode actif, regroupés dans un
  seul menu (cartes : tuiles/contenu ; plan : colonnes ; chronologie :
  ordre/tags/échelle ; lecture : périmètre)
- Icônes et grille de cartes centrées horizontalement dans le panneau

## 21. Export natif (moteur sans dépendance)

Cœur de la fonctionnalité d'export — fonctionne sur mobile comme sur bureau,
sans rien installer.

- **2 moteurs** : natif (par défaut, zéro dépendance) ou Pandoc (avancé,
  bureau uniquement, pour qui l'a déjà installé et configuré) —
  **[Réglages]** `exportEngine`, `pandocPath`, `pandocReference`
- **3 formats natifs** :
  - **.docx** (OOXML réel, via la bibliothèque `docx`) — titres, notes de
    bas de page, images avec légendes automatiques (texte alternatif),
    tableaux, en-tête/pied de page avec numérotation
  - **.epub** (généré via `jszip`, EPUB3 valide) — flux continu, métadonnées
    (titre, auteur, langue)
  - **.pdf** — via la boîte d'impression du système (bureau uniquement)
- **7 modèles intégrés** : Classique (manuscrit), Moderne, Machine à écrire,
  Roman simple, Roman français (paysage, 2 colonnes — adaptés de vrais
  styles Ulysses), APA (7e édition), Thèse — police, marges, interligne,
  alignement, retrait, styles de titres par niveau, séparateur de scène,
  numérotation des pages, césure
- **Modèles personnalisés** — fichiers `.md` avec frontmatter YAML dans
  `Ressources/Modèles`, même schéma que les modèles intégrés ; un fichier du
  même nom qu'un modèle intégré le remplace réellement (pas de doublon dans
  le menu) ; action "Exporter les modèles intégrés" pour partir d'un modèle
  existant à personnaliser
- **Typographie française automatique à l'export** — guillemets, apostrophe,
  points de suspension, espaces insécables, appliqués au texte compilé (pas
  au fichier source), même si la frappe assistée est désactivée ; code
  (blocs et spans) jamais touché — **[Réglages]** `exportFrenchTypography`
- **Langue du document** posée pour le correcteur/la césure de Word et la
  métadonnée EPUB/PDF — **[Réglages]** `epubLanguage`
- **Compilation** — presets nommés (séparateur, titres de parties/
  chapitres/scènes, nom de fichier), sélection manuelle des feuillets à
  compiler — **[Réglages]** `compilePresets`, `activePreset`,
  `insertFolderTitles`, `insertTitles`, `insertSceneTitles`, `separator`
- **Titre et auteur** du manuscrit — **[Réglages]** `manuscriptTitle`,
  `manuscriptAuthor`

## 22. Sauvegarde et restauration des réglages

Portabilité de la configuration du plugin, indépendante de la synchronisation
du coffre.

- **Sauvegarder les réglages du plugin** — exporte l'intégralité de
  `this.settings` en fichier `.json` horodaté (`feuillets-reglages-AAAA-MM-JJ
  .json`), dans le dossier du projet actif
- **Restaurer les réglages du plugin** — liste tous les fichiers
  `feuillets-reglages-*.json` du coffre (menu, plus récent en premier),
  fusion avec les réglages par défaut à la restauration
  (`Object.assign(DEFAULT_SETTINGS, data)`), échec géré proprement (fichier
  illisible ou corrompu)

## 23. Snapshots

Copies datées de sauvegarde, indépendantes de l'historique Git/versions
d'Obsidian.

- **Snapshot du feuillet actif** — copie horodatée du fichier ouvert
- **Snapshot du projet complet** — copie horodatée de tous les feuillets du
  projet en une seule commande
- **Restaurer un snapshot** — menu des 15 snapshots les plus récents du
  feuillet actif, snapshot de sécurité pris avant toute restauration

## 24. Structure de projet et fondations

- **Modes de projet** : Fiction (scènes, parties/chapitres, vocabulaire
  "personnages/lieux/lore") ou Non-fiction (sections, "acteurs/géographie/
  concepts/sources") — appliqué une fois à la création, jamais réécrasé
  automatiquement ensuite
- **Dossier du projet**, dossier de Recherche, dossier Snapshots, dossier
  Ressources (Templates, Export, Visuels, Modèles), dossier Journal —
  détectés ou créés via "Initialiser la structure du projet"
- **Statuts** — entièrement personnalisables (nom + couleur), comme les
  labels — 5 statuts par défaut (Idée/Brouillon/En cours/Révisé/Terminé),
  renommables/recolorables/supprimables, d'autres ajoutables librement —
  **[Réglages]** `statuses`
- **Fusion et scission de scènes** — réglages de comportement par défaut
  (statut à la scission, copie des réglages de compilation, remise à zéro
  synopsis/résumé/notes, séparateur de fusion, mode et préréglage YAML) —
  **[Réglages]** `splitStatus`, `copyCompilerOnSplit`,
  `resetSynopsisOnSplit`, `resetResumeOnSplit`, `resetNotesOnSplit`,
  `mergeNotesSeparator`, `mergeModeDefault`, `mergeKeepSeparatorDefault`,
  `mergeYamlPreset`
- **Projet de démonstration** — commande "Créer un projet d'exemple" pour
  découvrir le plugin sans partir de zéro
- **Vocabulaire frontmatter en anglais** (première étape d'internationalisation) :
  les clés YAML sont désormais en anglais (`title`, `short_title`, `subtitle`,
  `order`, `status`, `goal`, `summary`, `thread`, `characters`, `author`,
  `publisher`, `pace`, `role`, `end_date`, `birth`, `death`, `compile`) — les
  anciennes clés françaises (`titre`, `statut`, `ordre`…) restent lues
  indéfiniment en repli sur les fiches déjà écrites, jamais réécrites de
  force ; seules les nouvelles fiches et les nouvelles écritures utilisent
  les clés anglaises — voir `services/frontmatter.js` (`LEGACY_FIELD_ALIASES`)
- **Panneaux au démarrage** — ouverture automatique du binder, Recherche,
  Notes, Statistiques, Journal, Projet & export, Propriétés (chacun
  indépendamment réglable) — **[Réglages]** `autoOpen*`
- **Vues actives** — masquer les modes du Tableau et les panneaux latéraux
  non utilisés, y compris le panneau Révision (icône de ruban et commande
  retirées, réactivable à tout moment) — **[Réglages]** `hiddenBoardModes`,
  `hiddenPanels`
- **Réglages avancés** — bascule globale qui révèle une catégorie de
  réglages supplémentaire (Apparence, Labels de couleur, Presets de
  compilation, Historique, Projets) — **[Réglages]** `settingsAdvanced`
- **Apparence** — taille de police, échelle de l'interface, largeur des
  colonnes du Tableau — **[Réglages]** `fontSize`, `uiScale`

---

*Mis à jour à partir d'un audit exhaustif de `src/main.js` (commandes,
vues enregistrées) — les noms entre crochets `[Réglages]` correspondent aux
clés internes dans `src/default-settings.js`, utiles pour retrouver un
réglage précis dans le code.*
