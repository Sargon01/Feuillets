# Importer un projet Scrivener

> **Français** · [English](IMPORT-SCRIVENER-EN.md) · [Index](README.md)

Feuillets peut reprendre un projet Scrivener et le convertir en fichiers Markdown et dossiers du coffre Obsidian.

![Import Scrivener](feuillets-import-scrivener.png)

## Avant l’import

Travaillez sur une **copie** du projet Scrivener si vous souhaitez conserver un original intact.

L’import ne transforme pas Scrivener lui-même : il lit les éléments sélectionnés puis crée un projet Feuillets dans le coffre.

## Formats d’entrée

L’importeur sait travailler avec la structure d’un projet `.scriv` et avec une archive compatible contenant le `.scrivx` et ses données.

Selon la plateforme et le navigateur intégré à Obsidian, la sélection peut passer par un fichier/archive ou par les entrées de dossier disponibles.

## Ce que Feuillets cherche à reprendre

Lorsque les éléments sont disponibles et compatibles :

- hiérarchie du Binder/Draft ;
- titres ;
- textes ;
- ordre ;
- statuts compatibles ;
- synopsis ou informations réutilisables ;
- commentaires Scrivener pris en charge ;
- dossiers de Recherche ;
- images, PDF et autres pièces classées comme ressources ;
- certaines métadonnées convertibles.

Les textes RTF sont convertis en Markdown par l’importeur.

## Ce qui change

Scrivener stocke un projet dans son propre bundle. Feuillets produit un ensemble lisible de fichiers et dossiers dans le coffre.

L’objectif n’est donc pas une copie binaire parfaite du projet Scrivener, mais une **migration de travail** :

> structure exploitable + texte lisible + métadonnées utiles + pièces récupérables.

## Pendant l’import

1. Ouvrez le gestionnaire de projets ou l’action d’import Scrivener.
2. Choisissez le projet ou l’archive.
3. Vérifiez l’aperçu/résumé d’import.
4. Choisissez le projet cible selon les options proposées.
5. Lancez l’import.
6. Lisez le rapport final.

## Après l’import

Vérifiez :

- ordre des parties et chapitres ;
- titres ;
- premiers et derniers paragraphes de plusieurs scènes ;
- caractères accentués ;
- listes et emphases ;
- commentaires importants ;
- images/PDF attendus ;
- catégories de Recherche ;
- statuts et champs que vous utilisez réellement.

Ne supprimez pas immédiatement l’original Scrivener. Travaillez quelques jours dans Feuillets, exportez un document de contrôle puis archivez l’ancien projet lorsque vous êtes satisfait.

## Ce que Feuillets ne promet pas

Scrivener contient des fonctionnalités et formats internes qui n’ont pas toujours un équivalent direct en Markdown/Obsidian.

Une fonction sans équivalent pertinent peut être simplifiée, convertie en texte ou signalée dans le rapport plutôt que simulée artificiellement.

## Après la migration

Poursuivez avec :

- [Découvrir Feuillets](DECOUVRIR.md) ;
- [Le parcours d’un auteur](PARCOURS-AUTEUR.md) ;
- [Remplacer Scrivener par Feuillets](Remplacer-Scrivener-par-Feuillets.md).
