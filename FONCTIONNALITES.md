# Feuillets — fonctionnalités et options

Document exhaustif des fonctionnalités du plugin, organisé des réglages les plus
ponctuels aux systèmes les plus importants. Chaque section liste ses options ;
les réglages du plugin (Réglages → Feuillets) sont signalés par **[Réglages]**,
les menus/panneaux par **[Panneau]** ou **[Menu]**.

---

## Questions fréquentes

- **Comment créer un projet ?** → §24
- **Quelle est la différence entre le projet et le dossier `Manuscrit` ?** → §24
- **Comment réorganiser un chapitre ? Comment déplacer une scène ?** → §19
- **Comment créer une partie ?** → §19, §24
- **Comment utiliser la vue Cartes ? Comment utiliser la vue Plan ?** → §20
- **Comment compiler seulement une partie ? Comment exclure un document
  de la compilation ?** → §21
- **Comment modifier la page de titre ?** → §24, §21
- **Où placer mes images ?** → §24 (`Ressources/Images`)
- **À quoi sert le dossier `Recherche` ?** → §14, §24
- **Où sont stockés mes snapshots ? Comment restaurer un snapshot ?** → §23
- **Comment comparer deux versions ? Comment dupliquer un dossier pour
  créer une V2 ? Comment ouvrir la copie et l'original ?** → §24, §23
- **Puis-je utiliser Feuillets sans YAML ? Puis-je utiliser mes propres
  noms de dossiers ? Puis-je ouvrir un dossier Markdown existant ?** → §24
- **Pourquoi un fichier n'apparaît-il pas dans le Binder ?** → §19
- **Pourquoi un document n'apparaît-il pas dans la compilation ?** → §21
- **Où sont générés les exports ? À quoi servent `Template`, `Layout`,
  `Export` et `Assets` ?** → §21, §24

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

## 2. Correction grammaticale : greffons dédiés

Feuillets **n'intègre plus de correcteur grammatical** depuis la 1.4.5, et
n'en télécharge aucun. Les moteurs Grammalecte, Harper et LanguageTool ont
été retirés : ils imposaient de télécharger puis d'exécuter du code après
installation (Grammalecte, Harper) ou d'envoyer le texte du manuscrit à un
service distant (LanguageTool).

Pour relire l'orthographe et la grammaire, installe un greffon dédié depuis
la galerie communautaire d'Obsidian — par exemple
[Harper](https://community.obsidian.md/plugins/harper) pour l'anglais, ou un
greffon LanguageTool. Ces greffons sont indépendants : Feuillets ne les
détecte pas, ne les configure pas, n'accède pas à leurs données et
fonctionne à l'identique qu'ils soient installés ou non.

**Feuillets ne dépend d'aucune langue.** Aucun dictionnaire ni moteur
linguistique n'est embarqué : les outils du panneau Analyse (répétitions,
équilibre des chapitres, ratio de dialogue, courbe narrative) fonctionnent
sur n'importe quelle langue en écriture latine.

## 3. Chercher et remplacer

Barre de recherche/remplacement dédiée au manuscrit, distincte de la
recherche native d'Obsidian.

- Commande **"Chercher et remplacer dans le manuscrit…"** — ouvre/ferme la
  barre (`toggleSearchReplaceBar`)
- **Surlignage des correspondances** dans l'éditeur — extension CodeMirror
  dédiée (`searchHighlightField`)

## 4. Citations et notes de bas de page

Outils d'insertion et de gestion des références, pensés pour l'écriture
académique ou documentée (essais, non-fiction) autant que pour la fiction
(sources, digressions, précisions).

Feuillets utilise la syntaxe Markdown **standard**, la même qu'Obsidian
reconnaît nativement — aucun format propriétaire :

```markdown
Une phrase contenant une note.[^1]

[^1]: Contenu de la note.
```

Les identifiants nommés sont pris en charge au même titre que les
numériques :

```markdown
Cette affirmation doit être précisée.[^source-principale]

[^source-principale]: Voir l'ouvrage cité, page 42.
```

### Commandes

- **Insérer une note de bas de page** — place l'appel après la sélection (ou
  au curseur, sans sélection), ajoute la définition en fin de fichier avec le
  premier numéro libre (`nextFootnoteNumber`), et place le curseur dans son
  contenu. Disponible aussi dans le menu contextuel de l'éditeur.
- **Aller à la définition de la note** — depuis un appel `[^id]` (curseur
  dessus ou juste à côté), sélectionne sa définition.
- **Revenir à l'appel de note** — depuis une définition, sélectionne son
  (premier) appel dans le document.
- **Vérifier les notes de bas de page du document** — ouvre une petite liste
  cliquable des anomalies détectées : appels sans définition, définitions
  sans appel, identifiants dupliqués, définitions vides, appels malformés
  (`[^]`). Chaque ligne navigue directement vers le passage concerné.
- **Renuméroter les notes de bas de page** — remet les identifiants
  *numériques* à `1, 2, 3…` dans l'ordre d'apparition ; les identifiants
  nommés (`[^source]`) ne sont jamais touchés. Reste manuelle (jamais
  automatique à chaque modification) et demande confirmation avant
  d'appliquer, puisqu'elle réécrit tout le fichier.
- **Insérer une citation** — modale dédiée (`CitationSourceModal`),
  formatage automatique de la référence (`formatCitation`) à partir d'une
  fiche Source du panneau Recherche.

### Emplacement et identifiants

Les définitions restent à la fin du fichier où elles ont été insérées —
aucune section ni titre n'est requis, aucune section existante n'est
déplacée. Les identifiants générés automatiquement sont numériques et
uniques dans le fichier : le premier numéro libre est choisi, pas
nécessairement `nombre de définitions + 1` (un fichier avec `[^1]` et `[^3]`
propose `2`, pas `4`).

### Vues et recherche

Le Binder n'affiche jamais une définition de note comme un feuillet séparé.
Les vues Cartes et Plan retirent les blocs de définition des extraits
générés (le texte principal, lui, n'est jamais modifié dans le fichier
source). La recherche générale trouve le contenu des notes comme n'importe
quel texte — chaque résultat indique s'il provient d'une définition de note.

### Notes et manuscrit compilé (plusieurs fichiers)

Chaque feuillet numérote ses propres notes sans savoir que la compilation
les concatène : deux scènes utilisant toutes les deux `[^1]` ne collisionnent
jamais — chaque fichier reçoit un espace de noms interne dérivé de son
chemin (`chapitre-1-scene-1__1`, `chapitre-2-scene-1__1`…) **uniquement dans
le document compilé**, jamais dans les fichiers sources. Par défaut, le
manuscrit compilé est ensuite renuméroté en continu (`1, 2, 3…` dans l'ordre
du document) — réglage **Renuméroter les notes dans le document compilé**,
activé par défaut, désactivable dans les réglages de compilation.

Une compilation partielle (un seul chapitre, un preset qui exclut des
feuillets) ne compile que les notes des fichiers réellement inclus ; un
fichier marqué `compile: false` n'apporte ni ses appels ni ses définitions.

### Comportement par format d'export

| Format | Notes | Détail |
| --- | --- | --- |
| Markdown | ✅ Réelles | Syntaxe standard préservée, identifiants sans collision, ordre de compilation respecté — relisible tel quel dans Obsidian. |
| HTML | ✅ Réelles | Rendu par `MarkdownRenderer` (le moteur natif d'Obsidian, pas un parseur maison) : appel cliquable, liste de notes en bas, lien de retour vers l'appel. |
| PDF | ✅ Réelles | Notes de bas de page paginées (une zone dédiée par page, calculée par le moteur de pagination). |
| DOCX | ✅ Réelles | Vraies notes de bas de page Word, via la bibliothèque `docx` (pas un texte simulé). |
| EPUB | ✅ Réelles | Section `epub:type="footnotes"` conforme, liens de retour, identifiants uniques. |
| ODT | ⚠️ Notes de fin, texte brut | Ce générateur ODT est un export XML minimal, sans conversion intermédiaire ; il ne construit pas de vraie structure `<text:note>` OpenDocument (qui demanderait d'apparier citation et corps de note dans le flux). Les notes apparaissent donc en **notes de fin**, sous un titre « Notes », clairement séparées du corps — jamais silencieusement perdues, jamais confondues avec le texte. Une éventuelle mise en forme *à l'intérieur* d'une note (gras, italique, lien) n'est en revanche pas préservée dans cet export précis : seul le texte l'est. |

### Questions fréquentes

- **Où est stockée la note ?** Dans le fichier lui-même, à la suite des
  autres définitions déjà présentes — jamais dans un fichier séparé.
- **Puis-je utiliser des noms comme `[^source]` ?** Oui, dès l'écriture
  manuelle ; la renumérotation automatique ne les modifie jamais.
- **Que se passe-t-il si deux scènes utilisent `[^1]` ?** Rien de visible :
  la compilation les distingue automatiquement (voir ci-dessus), les
  fichiers sources ne changent pas.
- **Les fichiers sources sont-ils modifiés pendant la compilation ?** Non,
  jamais — la renumérotation et le renommage d'identifiants n'affectent que
  la copie en mémoire écrite dans `Manuscrit.md` et les exports.
- **Pourquoi une note n'apparaît-elle pas dans l'export ?** Le feuillet qui
  la contient est peut-être marqué `compile: false`, ou hors du chapitre
  compilé lors d'une compilation partielle.
- **Comment retrouver une note orpheline ?** « Vérifier les notes de bas de
  page du document » (par feuillet) ou la section Notes de bas de page du
  panneau Recherche (vue d'ensemble sur tout le manuscrit).
- **Notes de fin de chapitre ou de document, en plus des vraies notes de bas
  de page ?** Pas dans cette version : cela demanderait de restituer chaque
  chapitre séparément avant rendu (le pipeline actuel rend tout le manuscrit
  en un seul passage), un chantier distinct plutôt qu'un réglage ajouté sans
  architecture pour le porter.

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

- **Catégories fiction** : Characters, Places, Lore (Codex), Bibliography,
  Glossary, Events — noms de dossiers en anglais depuis cette version ;
  l'ancien nom français (Personnages, Lieux, Bibliographie, Glossaire,
  Événements) reste reconnu indéfiniment sur les projets déjà créés, jamais
  renommé de force — voir `utils/project-modes.js` (`LEGACY_RESEARCH_LABELS`)
- **Catégories non-fiction** : Sources, Acteurs, Géographie, Concepts,
  Bibliography, Glossary, Events
- **Dossiers personnalisés** ajoutés par l'utilisateur, détectés
  automatiquement (tout sous-dossier non standard de `Recherche`)
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

## 21. Compilation et export natif (moteur sans dépendance)

Cœur de la fonctionnalité d'export — fonctionne sur mobile comme sur bureau,
sans rien installer.

- **Compiler le manuscrit** — commande "Compiler le manuscrit" : assemble
  tous les feuillets du projet actif en un seul document, dans l'ordre du
  Binder. Un **preset de compilation** (nommé, réutilisable) contrôle le
  séparateur entre scènes et si les titres de parties/chapitres/scènes sont
  insérés.
- **Compilation partielle** — sélection manuelle des feuillets à inclure
  plutôt que la totalité du projet, depuis le mode sélection multiple du
  Tableau.
- **Exclure un document en permanence** — le champ `compile: false` dans le
  frontmatter d'un feuillet le retire de toute compilation (ponctuelle ou
  partielle), sans le retirer du Binder ni du décompte de mots — utile pour
  une note personnelle ou un brouillon mis de côté à l'intérieur du
  manuscrit.
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
  `Ressources/Layout` (anciens noms `Resources/Layouts` et
  `Ressources/Modèles` toujours reconnus), même schéma que les modèles
  intégrés ; un fichier du
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

- **Racine réelle du projet vs racine éditoriale** — un projet vit dans
  `Nom du projet/`, qui contient `Manuscrit/` (le texte, ce que lisent le
  Binder, les Cartes/Plan et la compilation), `Recherche/` et `Ressources/`
  en frères de `Manuscrit`, jamais dedans. `settings.projectFolder` pointe
  historiquement sur `Manuscrit` (racine éditoriale), pas sur `Nom du
  projet/` (racine réelle) — voir `services/folder-structure.js`
  (`getManuscriptRoot`, `getProjectRoot`)
- **Créer un projet** — "Nouveau projet…" (nom, auteur facultatif, dossier
  parent facultatif, type) crée en une fois `Manuscrit/Front/Page de
  titre.md` (préremplie), un premier chapitre prêt à écrire (`Chapitre
  1/Scène 1.md` en fiction, `Partie 1/Chapitre 1.md` en non-fiction),
  `Recherche/` et `Ressources/{Images,Template,Layout,Export,Assets}/` —
  puis ouvre directement le premier feuillet, curseur en position d'écrire.
  `Snapshots` et `Journal` ne sont pas créés à ce stade : ils apparaissent
  tout seuls à leur premier usage réel (premier instantané, premier jour de
  journal), ou immédiatement via "Initialiser la structure du projet"
  — voir `services/project-files.js` (`createMinimalProject`)
- **Ouvrir un dossier existant** — utilise n'importe quel dossier du coffre
  comme manuscrit : aucun fichier n'est déplacé, renommé, ni modifié ; seule
  la référence dans les réglages change — voir `ui/project-modals.js`
  (`OpenExistingFolderModal`)
- **Modes de projet** : Fiction (scènes, parties/chapitres, vocabulaire
  "personnages/lieux/lore") ou Non-fiction (sections, "acteurs/géographie/
  concepts/sources") — appliqué une fois à la création, jamais réécrasé
  automatiquement ensuite
- **Dossier Recherche**, dossier Snapshots, dossier Ressources (Images,
  Template, Layout, Export, Assets), dossier Journal — détectés ou créés via
  "Initialiser la structure du projet" ; les anciens noms de dossiers
  (`Research`/`Resources` anglais, `Templates`/`Layouts` au pluriel,
  `Visuels`/`Modèles`) restent reconnus indéfiniment sur les projets déjà
  créés sous l'un ou l'autre, jamais renommés de force sur le disque — voir
  `services/folder-structure.js` (`getResourcesRoot`, `resourcesSubfolderPath`)
  et `services/research.js` (`getResearchRoot`)
- **Dupliquer comme nouvelle version** — fige une copie datée du manuscrit
  actif (Recherche reste partagée entre les versions) sous `_Versions/`,
  accessible par clic droit sur la racine du manuscrit dans le Binder, par
  l'icône dédiée de "Gérer les projets", ou par la commande "Dupliquer le
  manuscrit actif (nouvelle version)…" ; la copie s'ouvre et se compare à
  l'original via "Comparer avec un autre feuillet…" sans jamais le modifier
  — voir `services/project-files.js` (`duplicateProjectFolder`)
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
- **Vocabulaire frontmatter en anglais** : les clés YAML sont désormais en
  anglais (`title`, `short_title`, `subtitle`, `order`, `status`, `goal`,
  `summary`, `thread`, `characters`, `author`, `publisher`, `pace`, `role`,
  `end_date`, `birth`, `death`, `compile`) — les anciennes clés françaises
  (`titre`, `statut`, `ordre`…) restent lues indéfiniment en repli sur les
  fiches déjà écrites, jamais réécrites de force ; seules les nouvelles
  fiches et les nouvelles écritures utilisent les clés anglaises — voir
  `services/frontmatter.js` (`LEGACY_FIELD_ALIASES`)
- **Interface bilingue français/anglais** — mécanisme `src/i18n/` (dictionnaire
  plat, `t(clé, paramètres)`), utilisé dans l'intégralité de l'interface :
  tous les panneaux, l'onglet Réglages, les commandes/notifications de
  `main.js`, et toutes les modales. Langue suivant celle d'Obsidian par
  défaut ("Automatique"), ou forcée en français/anglais — **[Réglages]**
  `language`. Les identifiants internes (clés frontmatter, valeurs stockées,
  noms de rôle de la page de titre) restent inchangés quelle que soit la
  langue affichée — seul le texte affiché à l'écran est traduit.
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
