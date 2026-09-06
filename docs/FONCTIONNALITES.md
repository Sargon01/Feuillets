# Feuillets — fonctionnalités par usage

> **Français** · [English](FEATURES.md) · [Index](README.md)

## Manuscrit et structure

### Projets et compatibilité avec les coffres existants

- presets d’initialisation Fiction, Non-fiction et Libre, sans bloquer les capacités disponibles à l’exécution ;
- dossier existant utilisé tel quel ou initialisé ;
- espace auxiliaire `_Feuillets` avec compatibilité legacy non destructive ;
- réglages propres au projet : objectifs, statuts, labels, tags favoris ;
- remappage YAML de synopsis, résumé, statut, POV, label, objectif, fil narratif, personnages et date ;
- plusieurs projets dans le même coffre ;
- export/import d’un **projet portable `.feuil`**, avec restauration de l’ordre et des réglages de projet pris en charge, sans changer le format Markdown du manuscrit.

Voir [Projet portable `.feuil`](PROJET-PORTABLE-FEUIL.md).

### Classeur

- création/renommage/déplacement ;
- glisser-déposer vers la racine ;
- sélection multiple ;
- recherche titre/contenu ;
- filtres statut/label/progression ;
- aperçu configurable des feuillets ;
- isolation d’un dossier et navigation vers le parent/projet ;
- ouverture dans Aperçu ou Continu ;
- association d’un dossier Recherche existant ;
- vue simple ou **double vue** : navigation du projet à gauche — **Manuscrit**, **Recherche**, **Espaces** et **Coffre** ; le volet de droite reste le Classeur de travail et reflète l’espace actif.

### Continu

- un seul éditeur continu pour plusieurs feuillets ;
- fichiers sources Markdown conservés séparément ;
- frontières protégées ;
- sauvegarde redistribuée par fichier ;
- portée fichier/dossier/sélection/projet ;
- synchronisation avec Aperçu ;
- aucun fichier composite sur disque.
- titres Markdown H1 à H6 rendus ;
- menu contextuel : Couper, Copier, Coller, notes de bas de page, **Annotation…**, **Noter une idée** et **Réorganiser le texte** ;
- réorganisation de paragraphes ou de fragments contenus dans un seul paragraphe, sans traverser de frontière de feuillet ;
- Annuler/Rétablir natifs du document Continu.

### Réorganiser le texte

- action disponible dans l’éditeur Markdown natif et dans Continu ;
- mode local à l’éditeur : survoler un paragraphe puis le glisser-déposer ;
- une sélection contenue dans un seul paragraphe peut être déplacée comme fragment ;
- point d’insertion visible, **Échap** pour quitter, une opération = une étape Annuler ;
- Markdown exact conservé.

Dans l’éditeur Markdown natif, le menu contextuel propose selon le contexte **Note de bas de page >**, **Annotation…**, **Noter une idée**, **Réorganiser le texte**, puis les actions **Feuillets : Scinder**, **Feuillets : Dupliquer** et **Feuillets : Déplacer…**.

### Carnet

- Carnet global du projet et **Carnets attachés aux dossiers** ;
- vrai Canvas Obsidian, sans format visuel propriétaire ;
- identité du Carnet de dossier conservée lors des renommages/déplacements ;
- un dossier Recherche associé peut partager le même Carnet logique que son dossier Binder ;
- glisser-déposer depuis le Classeur ou Recherche → vraie carte de fichier, sans modifier le Markdown source ;
- capture d’idées et conversion idée → feuillet ou Recherche ;
- **Plan du Binder** interactif : Actualiser depuis le Binder, préparer la structure, puis Appliquer au Binder explicitement ;
- création/réorganisation de feuillets et dossiers depuis le Plan avec validation préalable ;
- **mindmaps** avec enfants/frères, reparentage, repli, orientation horizontale/verticale et réorganisation ;
- conversion explicite d’une ancienne branche d’Arbre d’idées en mindmap ;
- fonctionnement de base indépendant d’Advanced Canvas.

Voir [Le Carnet — des idées au manuscrit](HOW-TO-CARNET.md).

### Cartes, Plan, Chemin de fer, Chronologie

- Cartes et Plan simplifiés autour de leur rôle ;
- Plan hiérarchique avec colonnes configurables et retour à la ligne optionnel des textes longs ;
- tri naturel comme repli lorsqu’aucun ordre explicite n’est enregistré ;
- Chemin de fer pour les fils narratifs ; la première et la dernière occurrence d’un même fil peuvent naturellement servir d’ouverture et de résolution, tandis que les occurrences intermédiaires en montrent le développement. Feuillets n’attribue pas automatiquement ces rôles et ne demande pas de créer des objets narratifs séparés ;
- lorsqu’un fil apparaît pour la première fois, un marqueur de résolution en attente peut être maintenu vers la fin du projet, puis retiré lorsqu’une nouvelle occurrence réelle du même fil apparaît ; aucun rôle narratif nommé n’est attribué automatiquement ;
- Chronologie narrative/chronologique.

Le Classeur reste la structure de travail ; le Tableau en propose plusieurs lectures des mêmes fichiers. Les fils peuvent suivre un objet, une promesse, un conflit ou un motif à travers plusieurs feuillets, sans imposer une interprétation unique des couloirs.

## Espaces et portées

- isolation d’un dossier comme portée de travail sans déplacement ni copie des fichiers ;
- portée feuillet, dossier, sélection ou projet selon l’action ;
- réglages locaux pris en charge avec héritage depuis le parent, le projet ou les réglages globaux ;
- Recherche, Tableau, objectifs, workflow et typographie pouvant suivre le contexte de travail ;
- Projet et Espace conservés comme couches distinctes.

Voir [Un projet, plusieurs espaces de travail](ESPACES-DE-TRAVAIL.md).

## Recherche et Contexte

### Feuillet, notes et annotations

- synopsis/résumé adaptés au type de projet ;
- notes de travail dans le panneau Feuillet ;
- propriétés ;
- notes de bas de page ;
- Contexte local ;
- annotations de travail externes au Markdown, surlignées, éditables et supprimables via **Annotation…**.

### Recherche

- catégories Fiction/Non-fiction adaptées ;
- Sources et Bibliographie rationalisées ;
- dossiers historiques reconnus ;
- association de n’importe quel dossier existant du coffre à un nœud Binder ;
- dossiers liés externes visibles dans le panneau Recherche ;
- fichiers liés ouvrables dans un nouvel onglet ou côte à côte ;
- aucune copie/renommage/déplacement automatique de ces dossiers depuis Recherche ;
- notes Recherche libres en Markdown, sans obligation de fiche Personnage, Lieu ou Événement ;
- propriétés structurées facultatives lorsqu’elles sont utiles.

### Contexte

- passage autour du curseur rapproché de la Recherche pertinente ;
- indices locaux, lexicaux et déterministes : titres, alias, tags, contenu documentaire et informations chronologiques reconnues ;
- fiches Personnage, Lieu, Objet, Institution, Source ou autre documentation pertinente ;
- chronologie d’une fiche pouvant aider à contextualiser son état à une date pertinente, sans compréhension sémantique générale.

## Écriture

- éditeur Markdown natif conservé comme source de travail ;
- largeur, typographie, interligne, alinéas, Concentration et aides d’écriture ;
- Continu permet de travailler plusieurs feuillets comme un seul texte tout en conservant les fichiers sources séparés ;
- vrais fichiers Markdown conservés malgré les réglages visuels.

## Révision et collaboration

### Relecture

Le panneau Relecture regroupe :

- **Analyse de texte** : répétitions et fournisseurs linguistiques optionnels ;
- **Relecture collaborative** : paquets `.feuillets`, notes, plusieurs feuillets, plusieurs tours ;
- **Révision DOCX** : modifications suivies/commentaires Word ;
- **Comparer une version** : instantané vs texte actuel.

### Comparateur

- ajouts, suppressions, remplacements ;
- détection de déplacements/couper-coller ;
- repères `[…]` pour les absences ;
- restauration de passage ;
- double-clic pour recentrer ;
- précédent/suivant ;
- modes Changements / Versions ;
- défilement synchronisé optionnel.

### Relecture collaborative

- portée feuillet/dossier/projet ;
- paquet portable `.feuillets` ;
- copie locale côté relecteur ;
- notes ancrées aux passages ;
- retour vers l’auteur ;
- analyse 3-way avec le manuscrit actuel ;
- appliquer/ignorer/traiter manuellement ;
- fils et tours suivants ;
- archivage local.

## Édition et publication

### Édition et composition

- onglet du panneau Feuillets ;
- modes Composition et Mise en page ;
- Première page unique dans Composition ;
- pages liminaires ;
- sommaire/table des matières/tables ;
- bibliographie et annexes ;
- structure du manuscrit ;
- gabarits V2 partagés avec Aperçu/export ;
- création/duplication/renommage de gabarits ;
- import Ulysses et Word.

### Rôles sémantiques et publications dérivées

- 18 rôles canoniques facultatifs, sans obligation d’annoter le texte ordinaire ;
- variantes : même document avec certains rôles exclus ;
- extractions : sections structurelles entières contenant les rôles déclencheurs ;
- collections : blocs portant les rôles choisis, avec contexte de titres ;
- variantes combinables avec une extraction ou une collection ;
- configuration par projet dans **Composition → Le manuscrit** ;
- aucune duplication du manuscrit source.

### Présentation

- rendu 16:9 du même Markdown ;
- `---` comme séparateur de diapositives ;
- compositions automatiques FLOW / SPLIT / STACK ;
- texte, images, groupes de callouts et citations longues pris en compte par la mise en page ;
- notes `[!speaker-notes]` non projetées ;
- vidéo compatible, notamment MP4 ;
- thèmes `classic`, `course`, `ivory`, `slate`, `dark` ;
- override exceptionnel Auto / flow / columns / image-left / image-right stocké hors Markdown.

### Mise en page

- Page : format, orientation, marges, miroir, colonnes, gouttière, en-tête/pied ;
- Corps : police, taille, interligne, retrait, espacement, césure, profil ;
- Titres : styles et sauts de page ;
- Citation : marges, couleur, italique, séparateur de scène.

### Aperçu

- document réellement paginé pour un feuillet, un dossier, une sélection ou le projet ;
- notes de bas de page placées au pied de la page de leur premier appel, avec espace réservé pendant la pagination ;
- appels répétés sans duplication de la définition et notes pleine largeur sous une composition multicolonne ;
- limitation connue : une note individuelle plus haute qu’une page utile n’est pas encore fragmentée ;
- aperçu Pandoc/Zotero facultatif par projet à partir d’un fichier `.bib` du coffre ;
- affichage **Clés brutes** ou **Auteur-date**, avec localisateurs et groupes simples pris en charge ;
- Markdown source et exports natifs inchangés ; citekeys non résolues laissées brutes ;
- aucun moteur CSL complet : le style bibliographique final peut rester géré par un flux Pandoc externe.

Les citations relient les sources Recherche au manuscrit. Lors d’une compilation, Feuillets peut limiter la bibliographie aux sources réellement citées dans la portée compilée.

### Export

- Markdown compilé ;
- DOCX ;
- EPUB ;
- ODT ;
- PDF desktop via impression système ;
- barre d’export compacte **Portée → Contenu → Format → Exporter** ;
- menu Contenu : document complet, extraction ou collection ;
- nom de sortie résolu automatiquement avec compatibilité legacy ;
- collisions de casse macOS gérées lors du remplacement des sorties existantes.

## Import / export

### Import Scrivener

- structure Binder/Draft ;
- textes RTF convertis en Markdown ;
- métadonnées compatibles ;
- Recherche et ressources prises en charge ;
- **ordre Scrivener persistant**, même lorsque le coffre trierait autrement.

## Local, confidentialité et formats ouverts

### Sécurité et confidentialité

- pas de télémétrie ;
- pas de service distant requis ;
- imports explicitement déclenchés ;
- relecture collaborative par fichier local explicite ;
- APIs Obsidian pour les écritures de coffre ;
- aucun Pandoc ou exécutable de conversion.
