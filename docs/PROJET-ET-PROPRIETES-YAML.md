# Projet et propriétés YAML

> **Français** · [English](PROJECT-AND-YAML-PROPERTIES.md) · [Index](README.md)

Feuillets 2.5 déplace les réglages réellement éditoriaux vers le **Projet** actif et permet d’adapter ses champs aux propriétés YAML déjà utilisées dans un coffre.

## Réglages propres au projet

Le panneau **Projet** regroupe notamment :

- objectifs ;
- statuts ;
- labels ;
- tags favoris ;
- informations du projet ;
- propriétés YAML.

Lorsqu’un projet ne définit pas une valeur, Feuillets conserve un repli vers le réglage global historique. Lire un projet ne copie pas automatiquement ces valeurs dans ses métadonnées.

## Remappage YAML

Les champs logiques remappables sont :

- synopsis ;
- résumé long ;
- statut ;
- POV ;
- label ;
- objectif ;
- fil narratif ;
- personnages ;
- date.

Exemple : si votre coffre utilise `State` au lieu de `status`, vous pouvez mapper **Statut → State**.

## Ce qui n’est pas remappable

Le remappage concerne les métadonnées éditoriales listées ci-dessus. Les champs structurels et techniques comme l’ordre du Binder, l’inclusion dans la compilation, le type de fichier, le titre, `short_title` ou les tags restent gérés selon leur contrat propre.

Cette limite évite qu’un simple mapping puisse modifier la structure du projet ou détourner une propriété ayant un autre rôle.

## Priorité de lecture

Feuillets privilégie un mapping explicite du projet. Sans mapping, il continue de reconnaître la propriété canonique et ses variantes historiques sûres. Il n’utilise pas de correspondance floue susceptible de confondre deux propriétés. Une variante de casse n’est utilisée que lorsqu’elle est unique ; une configuration ambiguë doit être corrigée explicitement plutôt que devinée.

## Écriture non destructive

Lorsqu’un champ est modifié, Feuillets écrit dans la propriété mappée ou canonique appropriée via les API de frontmatter d’Obsidian. Changer le mapping **ne renomme ni ne migre automatiquement** les propriétés déjà présentes dans les fichiers. Supprimer un mapping revient simplement au comportement canonique/historique : aucune migration inverse n’est lancée.

## Portée

Le mapping appartient au projet actif. Il ne doit pas être appliqué aux fichiers d’un autre projet simplement parce qu’ils sont ouverts dans le même coffre.
