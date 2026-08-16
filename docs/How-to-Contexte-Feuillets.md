# How-to — Utiliser le contexte intelligent de Feuillets

> **Français** · [English](HOW-TO-CONTEXT.md) · [Index](README.md)

La section **Contexte** de l’onglet **Feuillet** affiche automatiquement les informations utiles autour du passage en cours d’écriture.

Elle peut retrouver :

- des personnages, lieux, événements ou notions cités dans le passage ;
- des fiches Recherche liées au feuillet ou à son dossier ;
- des informations chronologiques correspondant à la date du feuillet ;
- des incohérences de date ou d’état ;
- des documents associés par recoupement lexical ;
- des références épinglées pour le feuillet actif.

Tout reste local dans le coffre Obsidian. Le Contexte n’utilise pas un service d’IA en ligne.

## 1. Préparer la Recherche

Créez vos fiches dans **Recherche** ou associez au manuscrit un dossier documentaire déjà présent dans le coffre.

Une fiche peut être retrouvée grâce à son titre, ses alias, ses tags ou son contenu. Un dossier associé peut rester totalement hors du projet : Feuillets mémorise le lien sans le déplacer.

Voir [Recherche et dossiers associés](RECHERCHE-ET-DOSSIERS-ASSOCIES.md).

## 2. Associer de la documentation au manuscrit

Feuillets peut utiliser plusieurs niveaux :

- Recherche associée directement au feuillet ;
- Recherche associée à son dossier/chapitre ;
- Recherche générale du projet.

Les résultats proches du texte sont prioritaires. La recherche dans le **contenu intégral** des fiches reste volontairement limitée aux dossiers associés au feuillet ou à son contexte structurel afin d’éviter que tout le projet documentaire remonte à chaque paragraphe.

## 3. Écrire normalement

Aucune commande spéciale n’est nécessaire. Feuillets examine principalement le passage autour du curseur et actualise les résultats lorsque vous vous déplacez dans le texte.

Le but n’est pas d’analyser en permanence le feuillet entier, mais de faire revenir l’information pertinente au moment où elle peut aider.

## Les sections de Contexte

### Épinglées

Une fiche épinglée reste visible pour le feuillet actif même lorsque vous changez de paragraphe. Elle n’est pas répétée dans les autres sections.

### Références du passage

Une fiche peut être reconnue grâce à son titre, un alias, un tag ou une référence explicite présente dans le texte.

### Documents associés

Feuillets peut rapprocher le passage de fiches appartenant aux dossiers Recherche associés. Le rapprochement reste lexical et prévisible : plusieurs termes significatifs ou une expression distinctive sont nécessaires ; un mot générique isolé ne suffit pas.

Feuillets ne prétend pas qu’`étoffe` et `tissu`, ou `bateau` et `navire`, sont automatiquement synonymes. Utilisez des alias ou des formulations réellement présentes dans vos fiches lorsque vous voulez une correspondance déterministe.

## Contexte chronologique

Lorsqu’un feuillet possède une date, Feuillets peut utiliser les informations datées de la Recherche pour afficher :

- un événement voisin ;
- l’âge ou l’état d’un personnage ;
- un personnage déjà mort ou pas encore né ;
- un objet ou une technique anachronique ;
- une autre incompatibilité dérivable des informations du projet.

Ces alertes n’écrivent jamais dans le manuscrit. Elles reposent sur les données présentes dans vos propres fichiers et restent donc des aides à vérifier, pas une vérité historique automatique.

## Ouvrir une fiche sans perdre le texte

Les résultats de Contexte peuvent être prévisualisés ou ouverts selon leur type. Dans le panneau Recherche, y compris pour un **dossier externe associé**, une fiche Markdown peut aussi être ouverte dans un nouvel onglet ou **côte à côte**.

Le dossier externe reste cependant non administré par Feuillets : l’association ne lui donne pas automatiquement des actions de renommage, suppression ou déplacement.

## Pourquoi une fiche n’apparaît-elle pas ?

Vérifiez notamment :

- que le curseur est dans le passage concerné ;
- que le titre, un alias, un tag ou plusieurs termes significatifs correspondent ;
- que le dossier est associé lorsque vous attendez une correspondance par contenu ;
- que la date du feuillet et les dates de la fiche sont reconnues ;
- que la fiche n’est pas déjà dans **Épinglées**.

## Conseils

- Donnez des titres précis aux fiches.
- Utilisez des alias réellement utiles.
- Ajoutez quelques tags descriptifs plutôt qu’une longue liste de mots-clés.
- Écrivez l’information importante dans le corps de la fiche : le moteur de documents associés lit le contenu réel.
- Associez un dossier existant plutôt que de déplacer toute votre documentation si votre coffre est déjà organisé.

## Ce que fait réellement Feuillets

Contexte lit localement le Markdown et les propriétés du projet. Il combine références explicites, alias, tags, dossiers associés, recoupement lexical, dates et épinglages. Il ne réécrit pas le manuscrit et n’invente pas de relations sémantiques absentes de vos données.

> **Le passage appelle sa documentation ; l’auteur décide ce qui lui est réellement utile.**
