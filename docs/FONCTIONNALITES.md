# Feuillets — fonctionnalités par usage

> **Français** · [English](FEATURES.md) · [Index](README.md)

Ce document sert de référence fonctionnelle. Les noms internes de réglages sont volontairement laissés à la documentation technique et au code.

![Vue d’ensemble](feuillets-ecriture-apercu.png)

## Projets

- Création de projets **Fiction**, **Non-fiction** et **Libre**.
- **Fiction** démarre avec `Front`, un premier chapitre et une première scène.
- **Non-fiction** démarre avec `Front`, une première partie et un premier chapitre.
- **Libre** démarre avec `Manuscrit/Nouveau texte.md`, sans `Front` ni hiérarchie éditoriale imposée.
- Projet de démonstration.
- Gestion de plusieurs projets.
- Feuilletisation d’un dossier existant avec choix **Fiction / Non-fiction / Libre**, sans déplacement ni renommage de son contenu personnel.
- Ajout de l’espace auxiliaire canonique `_Feuillets` autour d’un dossier existant feuilleté.
- Import d’un plan structuré et import Scrivener sur ordinateur.
- Métadonnées et conventions de projet facultatives pour écrire.
- Compatibilité avec plusieurs noms historiques français ou anglais pour les dossiers spécialisés, sans migration destructive.

Les espaces auxiliaires V2 sont regroupés sous `_Feuillets` : `Recherche`, `Ressources`, `Edition`, `Journal`, `Snapshots`, `Backups` et `Sortie`. Les anciens emplacements restent reconnus lorsqu’ils existent déjà.

## Écrire

- Vue Écriture appliquée au manuscrit.
- Largeur de texte, taille, interligne et typographie réglables.
- Syntaxe Markdown visuellement discrète.
- Alinéas automatiques.
- Paragraphes normaux, réduits ou visuellement continus.
- Apostrophes, guillemets français, espaces insécables et tirets typographiques à la frappe.
- Commande de correction typographique sur une sélection ou le feuillet.
- Mode Concentration.
- Défilement machine à écrire.
- Estompage par ligne ou paragraphe.
- Compteur de mots flottant.
- Recherche et remplacement dans le manuscrit.
- Insertion d’un séparateur de scène.
- Nettoyage des lignes vides et séparateurs importés.

![Mode Concentration](feuillets-concentration.png)

## Carnet et brainstorming

- Carnet visuel fondé sur un Canvas Obsidian ordinaire.
- Création automatique du Carnet du projet à la première utilisation.
- Capture rapide d’une idée depuis la palette sans quitter le feuillet courant.
- Ajout du feuillet courant au Carnet.
- Ajout d’une sélection de feuillets dans l’ordre réel du Classeur.
- Détection des feuillets déjà présents pour éviter les doublons.
- Transformation d’une idée texte en vrai feuillet Markdown.
- Transformation d’une idée texte en fiche Recherche.
- Transformation de plusieurs idées sélectionnées en feuillets.
- Création d’un chapitre à partir d’une sélection d’éléments du Carnet.
- Création d’un chapitre à partir d’un groupe Canvas.
- Création d’un chapitre à partir d’une branche d’Arbre d’idées.
- Scission d’une idée en deux cartes.
- Fusion de plusieurs idées texte dans l’ordre choisi.
- Arbres d’idées avec branches structurées.
- Ajout rapide d’un enfant ou d’un frère depuis l’Arbre d’idées.
- Réorganisation visuelle d’un Arbre d’idées sans déplacer les autres cartes.
- Distinction entre flèches libres du Canvas et liens structurants créés par Feuillets.
- Transformation d’une branche en plan Feuillets.
- Conversion d’une carte avec enfants en dossier et d’une carte terminale en feuillet.
- Réimport d’un plan issu du Carnet en mode additif et idempotent.
- Réutilisation des dossiers et feuillets existants lorsque leur titre correspond exactement.
- Préservation de l’ordre déjà présent dans le manuscrit lors d’un réimport.
- Détection préalable des ambiguïtés et doublons avant toute mutation.
- Aucune synchronisation automatique imposée entre le Carnet et le Classeur.
- Advanced Canvas recommandé pour les menus directs sur les cartes, les sélections et l’Arbre d’idées, mais non requis pour les fonctions essentielles accessibles depuis la palette.

Voir **[Le Carnet — des idées au manuscrit](HOW-TO-CARNET.md)** pour le guide d’utilisation détaillé.

## Notes de bas de page et citations

- Insertion d’une note.
- Navigation entre appel et définition.
- Vérification des appels orphelins ou définitions absentes.
- Renumérotation des identifiants numériques.
- Identifiants nommés conservés.
- Gestion des collisions entre feuillets lors de la composition.
- Insertion d’une citation depuis une fiche Source.
- Export adapté selon les possibilités de chaque format.

## Notes et Contexte

L’onglet **Feuillet** de l’Inspecteur peut réunir ce qui accompagne le feuillet sans appartenir au texte final :

- synopsis et résumé ;
- notes de travail ;
- sources ;
- notes du chapitre ou de la partie ;
- plan interne du feuillet ;
- fiches épinglées ;
- références explicites du passage ;
- documents associés par correspondance lexicale ;
- informations chronologiques et états datés ;
- alertes de cohérence lorsque les données nécessaires existent.

La section **Contexte** reste locale et déterministe : elle ne fait appel à aucune IA distante et ne modifie pas le manuscrit automatiquement.

Voir **[Utiliser le contexte intelligent de Feuillets](How-to-Contexte-Feuillets.md)**.

## Organiser le manuscrit

- Classeur hiérarchique.
- Parties, chapitres, scènes et feuillets.
- Plusieurs présentations du Classeur.
- Création contextuelle au bon niveau.
- Glisser-déposer, y compris vers la racine du manuscrit.
- Renommage des dossiers et des feuillets.
- Annulation du dernier déplacement.
- Renumérotation.
- Recherche par titre ou contenu.
- Filtres par statut, étiquette et progression.
- Extraits, synopsis, résumés, notes ou mots-clés affichables dans le Classeur.
- Gestion de plusieurs projets.
- Ordre personnalisé persistant.
- Compilation contextuelle d’un fichier, d’un dossier ou d’une sélection.
- Import d’un plan structuré.
- Import Scrivener sur ordinateur.

## Cartes, Plan, Chemin de fer, Chronologie et lecture

![Cartes, Plan, Chemin de fer et Chronologie](feuillets-mosaique-narrative.png)

### Cartes

- Une carte par scène.
- Taille et nombre de colonnes réglables.
- Synopsis, extrait ou informations affichables.
- Étiquettes et progression.
- Réorganisation visuelle.
- Travail sur un chapitre ou le manuscrit entier.

### Plan

- Tableau hiérarchique.
- Colonnes configurables.
- Largeurs réglables.
- Informations possibles : synopsis, résumé, notes, mots-clés, étiquette, statut, date, composition, mots, objectif et progression.

### Chemin de fer

- Tableau Canvas natif.
- Cartes colorées.
- Regroupement ou lecture par fil narratif.
- Vue d’ensemble adaptée à un grand nombre de scènes.

### Chronologie

- Scènes datées et jalons.
- Ordre chronologique ou narratif.
- Plusieurs échelles temporelles.
- Filtres.
- Événements parallèles.

### Lecture et Aperçu

- Lecture continue du manuscrit ou d’une sélection.
- Aperçu à l’échelle de la scène, du chapitre, de la partie ou du manuscrit.
- Synchronisation avec le feuillet actif.
- Fil de navigation.
- Zoom.
- Accès au panneau Export.
- Rendu fondé sur la composition réelle.

## Recherche et documentation

- Bible du projet.
- Personnages, lieux, événements, concepts, univers, sources, bibliographie et glossaire.
- Catégories adaptées au type de projet.
- Recherche et filtrage.
- Insertion d’un lien ou extrait dans le feuillet actif.
- Lecture d’états datés présents dans les fiches.

La racine canonique de Recherche est `_Feuillets/Recherche`. Feuillets reconnaît aussi les variantes historiques `_Recherche`, `_Research`, `Recherche` et `Research` lorsqu’elles existent déjà. Les dossiers non préfixés ne sont reconnus que dans le contexte historique attendu, sans renommage ni migration destructive. Si canonical et legacy coexistent, la racine canonique est prioritaire.

Pour les événements chronologiques, les variantes historiques telles que `Événements`, `Events`, `Chronologie`, `Timeline`, `Chronology` et `_Chronologie` peuvent être réutilisées lorsqu’elles existent.

## Propriétés et Inspecteur

- Édition des propriétés du feuillet actif.
- Champs de texte, dates, cases et listes.
- Vue des propriétés employées dans le projet.
- Ajout d’une propriété existante.
- Suppression en masse avec confirmation.
- Parcours des mots-clés du projet.
- Possibilité de masquer la présentation native des propriétés dans l’éditeur.

Les propriétés restent facultatives pour écrire.

L’**Inspecteur** unifié regroupe cinq onglets :

- **Feuillet** ;
- **Recherche** ;
- **Journal** ;
- **Édition** ;
- **Relecture**.

La section **Contexte** et les propriétés du feuillet sont accessibles depuis **Feuillet**. Les onglets inutiles peuvent être masqués ; Feuillets conserve toujours au moins un onglet visible.

## Scènes

- Création.
- Déplacement.
- Duplication.
- Scission.
- Fusion multiple.
- Sélection multiple.
- Règles configurables pour les informations lors d’une fusion ou d’une scission.
- Exclusion permanente de la composition sans retrait du Classeur.
- Statuts personnalisables.
- Une ou plusieurs étiquettes colorées ; la première sert de couleur principale lorsqu’une vue n’affiche qu’une couleur.
- Objectif de mots.
- Synopsis et résumé.
- Fils narratifs.

## Suivi

- Objectifs par scène et projet.
- Comptage de mots.
- Statistiques de texte.
- Estimation de pages et de temps de lecture.
- Historique récent.
- Calendrier d’écriture.
- Journal quotidien.
- Compilation du journal.

## Relecture et révision éditoriale

- Relecture dans l’Aperçu.
- Comparaison de deux états.
- Recherche et remplacement.
- Révision d’un DOCX annoté dans **Inspecteur → Édition → Révision DOCX**.
- Détection native des répétitions rapprochées dans **Relecture**, même sans module compagnon.
- Signalements linguistiques supplémentaires dans **Relecture** lorsqu’un fournisseur spécialisé est installé.
- Correction linguistique confiée à un module compagnon, notamment Feuillets-Grammalecte ; aucun moteur grammatical n’est embarqué dans le noyau.
- Contrôleur d’incohérences entre manuscrit, fiches et chronologie lorsque disponible dans la version installée.

## Sauvegardes et versions

- Sauvegardes automatiques.
- Instantané du feuillet actif.
- Instantané du projet.
- Restauration avec protection préalable.
- Duplication complète en nouvelle version.
- Comparaison avec l’original.
- Sauvegarde et restauration des réglages.

Pour un dossier existant feuilleté, la sauvegarde reste strictement dans ce dossier. Pour un projet structuré dont le dossier actif est `Manuscrit`, la sauvegarde couvre le projet parent. `_Feuillets/Backups` est la destination canonique et n’est jamais inclus dans sa propre archive ; un `_Backups` historique déjà présent reste reconnu.

## Composition

- Assemblage selon l’ordre du Classeur.
- Portée : scène, chapitre, partie, manuscrit ou sélection.
- Exclusion de certains feuillets.
- Titres de parties, chapitres et scènes.
- Séparateurs.
- Page de titre issue du feuillet liminaire.
- Modèles intégrés.
- Modèles personnalisés.
- Mise en page visuelle.
- Marges, orientation, colonnes, polices, espacements, en-têtes, pieds et pagination selon le format.
- Aperçu reposant sur la même logique que les exports.

Une portée peut être un feuillet, un dossier avec ses descendants, une sélection de fichiers et dossiers ou le projet entier. Lorsqu’un dossier et l’un de ses descendants sont sélectionnés ensemble, le descendant n’est composé qu’une seule fois.

## Export

Le moteur natif prend en charge :

- Markdown compilé ;
- DOCX ;
- EPUB ;
- ODT ;
- PDF par impression sur ordinateur.

Principes :

- aucun service en ligne imposé ;
- composition effectuée localement ;
- source non modifiée par l’export ;
- différences assumées entre formats ;
- styles Word nommés dans le DOCX ;
- EPUB adaptable à la liseuse ;
- limites spécifiques des notes dans certains formats.

![Aperçu paginé](feuillets-apercu.png)

## Interface

- Interface française ou anglaise.
- Langue automatique ou forcée.
- Valeurs suggérées pour une interface épurée.
- Masquage du titre intégré, des propriétés, du ruban, du sélecteur de coffre et d’autres éléments natifs.
- Transparence des panneaux et barres.
- Réduction visuelle des icônes secondaires.
- Police, taille, largeur de texte, interligne et couleur d’accent.
- Gestes tactiles ou pavé tactile pour ouvrir et fermer les panneaux.
- Onglets de l’Inspecteur et vues activables ou masquables.
- Export et import des réglages.

## Vie éditoriale avec Courrier

- Carnet d’adresses.
- Maisons d’édition, agents, revues et concours.
- Modèles de lettres.
- Historique.
- Suivi des envois.
- Réponses.
- Relances.
- Pièces et versions envoyées.
