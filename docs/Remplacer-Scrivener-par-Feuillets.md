# Passer de Scrivener à Feuillets

> Guide de migration, pas tableau de victoire entre logiciels.

Scrivener et Feuillets partagent plusieurs idées de travail : écrire par unités, conserver une structure visible, documenter le projet et compiler le manuscrit.

La différence fondamentale est le support des données :

- Scrivener possède son format de projet ;
- Feuillets travaille dans un coffre Obsidian avec des fichiers Markdown ordinaires.

![Import d’un projet Scrivener](feuillets-import-scrivener.png)

## Correspondances utiles

| Scrivener | Feuillets |
|---|---|
| Binder | Classeur |
| Document / text item | Feuillet |
| Folder / chapter structure | Dossiers du manuscrit |
| Corkboard | Cartes |
| Outliner | Plan |
| Collections / visual groupings | Filtres, sélections, labels selon le besoin |
| Project Research | Recherche |
| Keywords / labels / status | Tags, labels, statuts |
| Snapshots | Instantanés |
| Compile | Composition + export |
| Scrivenings / continuous reading | Aperçu d’un dossier/projet |
| Project backup | Sauvegarde ZIP |
| Duplicate manuscript | Nouvelle version dans `_Versions` |

La correspondance n’est pas toujours 1:1. Feuillets cherche à préserver le **besoin d’auteur**, pas à reproduire chaque écran de Scrivener.

## 1. Importer plutôt que reconstruire à la main

Utilisez l’import Scrivener lorsque le projet contient déjà une structure importante.

![Import Scrivener](feuillets-import-scrivener.png)

L’importeur tente de reprendre :

- arborescence du Binder ;
- textes ;
- ordre ;
- informations compatibles ;
- Recherche ;
- pièces récupérables.

Voir [Importer un projet Scrivener](IMPORT-SCRIVENER.md).

## 2. Retrouver le Binder

Le **Classeur** remplit le rôle structurel principal.

Il permet de voir et modifier le manuscrit réel sans passer par une base séparée.

Une différence utile : la structure visible correspond directement aux dossiers et fichiers du coffre.

## 3. Corkboard et Outliner

![Cartes, Plan, Chemin de fer et Chronologie](feuillets-mosaique-narrative.png)

Pour un usage proche du Corkboard :

- utilisez **Cartes** ;
- affichez synopsis ou extrait ;
- réordonnez visuellement.

Pour un usage proche de l’Outliner :

- utilisez **Plan** ;
- choisissez les colonnes utiles ;
- comparez statut, label, date, mots, objectif, progression ou autres informations.

## 4. Écrire plusieurs scènes puis les lire ensemble

Dans Feuillets, les scènes restent des fichiers distincts.

L’**Aperçu** permet néanmoins de lire :

- un feuillet ;
- un chapitre/dossier ;
- une partie ;
- une sélection ;
- le projet entier.

Cela conserve l’écriture modulaire sans obliger à fusionner physiquement les fichiers.

## 5. Recherche

Les fiches Research de Scrivener deviennent des documents Markdown dans **Recherche**.

Vous pouvez :

- utiliser les rubriques proposées ;
- créer vos propres rubriques ;
- associer explicitement un dossier documentaire à un chapitre ou un feuillet ;
- réutiliser des dossiers déjà présents ailleurs dans le coffre.

## 6. Snapshots et versions

![Comparaison](feuillets-comparaison.png)

Les **instantanés** servent aux jalons locaux d’un feuillet.

Une **nouvelle version** du manuscrit sert à explorer une direction différente.

La **sauvegarde ZIP** protège régulièrement le projet.

Ces trois mécanismes sont volontairement séparés.

## 7. Compilation

Scrivener Compile correspond dans Feuillets à la chaîne :

> portée → Aperçu → modèle → export

Vous pouvez compiler :

- un fichier ;
- un dossier ;
- une sélection ;
- le projet entier.

Formats natifs : DOCX, EPUB, ODT, PDF desktop et Markdown compilé.

## 8. Fils narratifs et Chronologie

Feuillets ajoute des représentations que vous pouvez utiliser sans changer la structure :

- **Chemin de fer** pour les fils narratifs ;
- **Chronologie** pour distinguer ordre de lecture et ordre des événements.

## 9. Carnet

Le Carnet Canvas peut jouer le rôle d’un espace préparatoire plus libre que le Binder.

Il est utile pour disposer des idées avant de décider lesquelles deviennent des scènes.

## 10. Ce que vous devez vérifier après migration

Ne partez pas du principe que deux logiciels représentent chaque format interne de la même manière.

Contrôlez :

- hiérarchie ;
- titres ;
- texte ;
- commentaires importants ;
- Recherche ;
- pièces jointes ;
- champs vraiment utilisés ;
- export d’un document de test.

## 11. Quand garder Scrivener en parallèle

Gardez l’original Scrivener le temps de valider la migration.

Une fonction très spécifique à Scrivener sans équivalent direct dans votre manière de travailler peut aussi justifier une période de transition.

Le but n’est pas de supprimer l’ancien outil le premier jour ; c’est de vérifier que **votre parcours réel** est couvert.

## 12. Le changement principal

Avec Feuillets, quitter le plugin ne fait pas disparaître la matière du livre :

- les textes restent Markdown ;
- les dossiers restent visibles ;
- la Recherche reste accessible dans Obsidian.

C’est le principal changement de modèle, plus important qu’une correspondance exacte bouton par bouton.
