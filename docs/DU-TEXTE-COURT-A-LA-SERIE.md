# Du texte court à la série

> [English](FROM-SHORT-TEXT-TO-SERIES.md) · Français · [Index](README.md)

Feuillets n’exige pas qu’un manuscrit commence comme un livre. Un unique fichier Markdown peut rester un article, une fiche de cours, une nouvelle ou une note. La structure ne s’ajoute que lorsqu’elle devient utile.

## Commencer sans structure

Utilisez le Classeur et l’éditeur Markdown natif pour un texte autonome. Un fichier, un dossier, une sélection ou le projet complet peut être ouvert dans Continu, l’Aperçu ou l’export sans avoir à créer d’abord des chapitres ou des parties.

La commande **Nouveau brouillon rapide** crée un feuillet Markdown vide sous `_Feuillets/Drafts` (ou `_Feuillets/Brouillons`), avec le statut initial `Brouillon`. Sa première ligne non vide devient automatiquement son nom de fichier. Renommez-le manuellement à tout moment pour conserver le nom choisi. Une action dédiée permet de déplacer facilement un brouillon vers n'importe quel dossier ou chapitre du projet avec protection contre les collisions de nom. Les brouillons rapides ne rejoignent pas la compilation du projet tant qu’ils ne sont pas intégrés au manuscrit ; un brouillon peut néanmoins être exporté seul.

## Utiliser les espaces lorsqu’un projet a besoin de contextes locaux

Isolez un dossier du Classeur pour en faire l’espace de travail actif. Cela ne crée ni second projet ni copie de fichier. Le dossier actif peut simplement disposer de son propre contexte lorsque c’est utile : Recherche, Carnet, Tableau, objectifs, workflow et typographie d’écriture. Les réglages peuvent hériter du dossier parent et du projet.

Cette organisation convient à un cours avec un dossier par leçon, à un recueil de textes indépendants ou à un livre divisé en parties. Le retour au projet restitue l’ensemble de la structure partagée. Voir [Un projet, plusieurs espaces de travail](ESPACES-DE-TRAVAIL.md).

## Transformer un dossier en ouvrage indépendant

Lorsqu’un dossier du projet devient un livre, un tome ou une autre unité éditoriale indépendante, ouvrez ses réglages d’espace puis choisissez **Définir ce dossier comme ouvrage**. Le dossier reste à sa place ; aucun manuscrit n’est copié et aucun nouveau projet n’est créé.

Cet ouvrage reçoit sa propre frontière éditoriale :

- son Aperçu et son export de portée Projet restent contenus dans cet ouvrage ;
- sa Composition peut hériter de celle du projet ou être personnalisée localement ;
- ses pages liminaires, son sommaire, sa bibliographie et ses annexes restent propres à cet ouvrage ;
- les ouvrages imbriqués sont possibles : l’ouvrage déclaré le plus profond fixe la frontière éditoriale active.

## Exemple : une trilogie

```text
Saga
├── Tome I        ← défini comme ouvrage
├── Tome II       ← défini comme ouvrage
└── Tome III      ← défini comme ouvrage
```

Conservez au niveau du projet ce qui est commun : Recherche globale, références partagées, Carnet ou notes de série. Donnez à chaque tome un dossier Recherche d’espace lorsqu’il a besoin de sa propre documentation. Ouvrez ou exportez **Tome II** : Feuillets ne compose que ce tome. Ouvrez le projet principal lorsque vous devez retrouver l’organisation de toute la série.

Cette même organisation convient à une édition en recueil, à un cours composé de modules autonomes ou à plusieurs articles réunis dans un seul dossier de coffre.
