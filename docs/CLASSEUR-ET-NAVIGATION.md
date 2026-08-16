# Classeur et navigation

> **Français** · [English](BINDER-AND-NAVIGATION.md) · [Index](README.md)

Le **Classeur** est la structure de travail du manuscrit. Il sert à trouver un texte, déplacer un feuillet, ouvrir un dossier en Continu ou prendre du recul sur la hiérarchie sans transformer le coffre Obsidian en base de données parallèle.

## Vue simple et double vue

Feuillets propose deux présentations du même Classeur.

### Vue simple

La vue simple est le Classeur 2.5 pleine largeur. Toutes les interactions habituelles y restent disponibles : dossiers, feuillets, sélection multiple, recherche, filtres, isolation, glisser-déposer et ouverture en Continu.

### Double vue

La **double vue** ajoute un volet de navigation à gauche. Le Classeur de droite ne change ni d’apparence ni de comportement.

Le volet gauche contient deux zones :

- **Manuscrit** — uniquement les dossiers du projet, dans l’ordre réel du Classeur ;
- **Coffre** — un accès léger aux autres dossiers et fichiers du vault.

Le séparateur peut être redimensionné. Revenir à la vue simple rend toute la largeur au Classeur.

## Manuscrit : voir la structure d’un coup d’œil

La zone **Manuscrit** affiche les dossiers et sous-dossiers, sans répéter les fichiers Markdown. Elle est conçue pour lire rapidement une structure telle que :

```text
Front
Partie 1
  Chapitre 1
  Chapitre 2
Partie 2
  Chapitre 3
```

Un clic sur une ligne de dossier le sélectionne comme racine d’affichage et, s’il possède des sous-dossiers, bascule entre repli et dépliage. Les dossiers sans sous-dossier ne peuvent que être sélectionnés. Un clic ne déclenche pas automatiquement l’isolation du dossier et n’ouvre pas Continu. Les actions de travail restent dans le Classeur de droite.

## Coffre : consulter sans quitter Feuillets

La zone **Coffre** permet de parcourir les documents du vault sans basculer vers l’Explorateur de fichiers d’Obsidian.

Elle reste volontairement limitée à la navigation. Selon le fichier, vous pouvez :

- l’ouvrir ;
- l’ouvrir dans un nouvel onglet ;
- l’ouvrir côte à côte.

Cette zone ne sert pas à administrer le coffre : pas de création, renommage, suppression, déplacement ou glisser-déposer. Ouvrir un document depuis **Coffre** ne l’ajoute pas au manuscrit, à la compilation, à la sélection du Classeur ou au mode Continu.

## Isoler un dossier

**Isoler ce dossier** réduit temporairement le contexte du Classeur à une branche du manuscrit. L’isolation est un état de travail de session : elle ne change pas le dossier projet et ne déplace aucun fichier.

Vous pouvez ensuite revenir au parent ou au projet complet. La double vue ne change pas ce mécanisme : le volet gauche sert à naviguer, l’isolation reste une action explicite du Classeur.

## Ouvrir en Continu

Un dossier du manuscrit peut être ouvert en **Continu** pour travailler sur plusieurs feuillets dans un seul éditeur. La composition reste fondée sur les fichiers Markdown réels et leur ordre dans le Classeur.

Voir [Mode Continu](MODE-CONTINU.md).

## Sélection multiple

Le Classeur permet de sélectionner plusieurs feuillets ou dossiers pour les opérations qui acceptent une portée multiple. Cette sélection appartient au Classeur de droite ; parcourir **Manuscrit** ou **Coffre** dans le volet gauche ne la remplace pas silencieusement.

## Recherche et filtres

La recherche du Classeur peut porter sur les titres et, selon le réglage, le contenu des feuillets. Les filtres peuvent combiner statut, label et progression.

Ces outils concernent le manuscrit. Ils ne transforment pas la zone **Coffre** en moteur de recherche global du vault.

## Classeur, Plan et Continu

Ces trois surfaces répondent à des besoins différents :

| Besoin | Outil |
|---|---|
| Se déplacer, sélectionner, déplacer des fichiers | Classeur |
| Lire la hiérarchie d’un coup d’œil | Double vue → Manuscrit |
| Examiner synopsis, statuts et autres colonnes | Plan |
| Écrire plusieurs feuillets comme un seul texte | Continu |

Le Classeur reste la structure réelle. Le Plan et Continu sont d’autres manières de travailler avec les mêmes fichiers.
