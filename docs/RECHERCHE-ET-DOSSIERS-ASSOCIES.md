# Recherche et dossiers associés

> **Français** · [English](RESEARCH-AND-LINKED-FOLDERS.md) · [Index](README.md)

L’espace **Recherche** rassemble la documentation utile au manuscrit sans imposer une structure encyclopédique. Il peut utiliser les dossiers Feuillets habituels, les anciens emplacements reconnus pour compatibilité, et des dossiers existants situés ailleurs dans le coffre.

## Racine Recherche

Les nouveaux projets utilisent l’espace auxiliaire canonique `_Feuillets/Recherche` lorsqu’une racine doit être créée. Les anciennes formes reconnues restent utilisables lorsqu’elles existent ; Feuillets ne les renomme pas automatiquement.

## Associer un dossier existant

Depuis le Classeur, un dossier ou un feuillet peut être associé à **n’importe quel dossier existant du coffre**. Le dossier associé :

- reste à son emplacement d’origine ;
- n’est ni copié ni renommé ;
- peut être situé hors du projet actif ;
- apparaît dans le panneau Recherche sous les dossiers liés.

Un même dossier lié à plusieurs nœuds du Classeur n’a pas besoin d’être dupliqué dans l’interface.

## Dossiers liés externes : lecture et navigation

Un dossier lié situé hors de l’espace Recherche du projet est traité comme une source documentaire externe. Feuillets peut afficher son arborescence et ses fichiers, mais n’en prend pas l’administration.

Pour un fichier Markdown lié, les actions de navigation permettent notamment :

- **Ouvrir dans un nouvel onglet** ;
- **Ouvrir côte à côte**.

Les actions d’écriture structurelle restent absentes depuis ce point d’entrée : pas de renommage, duplication, suppression ou glisser-déposer par Feuillets.

## Dossiers Recherche internes

Les dossiers réellement gérés dans l’espace Recherche du projet conservent leurs outils habituels : création, organisation, renommage, duplication, corbeille et déplacement lorsque l’opération est autorisée.

Cette distinction évite qu’une simple association transforme un dossier documentaire existant en dossier administré par Feuillets.

## Recherche associée et Contexte

L’association sert aussi au **Contexte** du panneau Feuillet. Les dossiers proches du feuillet ou de son chapitre peuvent fournir des références explicites et des correspondances de contenu sans obliger à déplacer la documentation vers `_Feuillets/Recherche`.

Voir [Contexte](How-to-Contexte-Feuillets.md).

## Recherche et Coffre dans la double vue

La double vue du Classeur propose également un accès léger **Coffre**. Les deux mécanismes ne jouent pas le même rôle :

- **Recherche associée** = documentation explicitement reliée au manuscrit et exploitable par les outils de contexte ;
- **Coffre** = navigation libre pour consulter n’importe quel autre document du vault.

Parcourir le Coffre ne crée aucune association Recherche automatiquement.
