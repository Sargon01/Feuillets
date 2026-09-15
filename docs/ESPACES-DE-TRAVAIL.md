# Un projet, plusieurs espaces de travail

> **Français** · [English](WORKSPACES.md) · [Index](README.md)

Feuillets permet de travailler sur un dossier du manuscrit comme sur un contexte cohérent sans créer un projet séparé. Les fichiers Markdown et les dossiers Obsidian restent la source de vérité.

Par exemple :

```text
Projet Roman
├── Recherche commune
├── Tome I
├── Tome II
└── Tome III
```

Vous pouvez isoler **Tome II** et travailler dans son contexte tout en restant dans le même projet. Ce modèle ne concerne pas seulement les romans ou les séries :

- un ouvrage de non-fiction peut être organisé en parties ;
- un cours annuel peut contenir des chapitres et des leçons ;
- un recueil ou un ensemble de documents peut regrouper plusieurs dossiers cohérents.

## Isoler un dossier

L’action **Isoler ce dossier** réduit temporairement la portée de travail à une branche du manuscrit.

Elle ne déplace aucun fichier, ne change pas le dossier du projet et ne crée aucun second projet. L’espace actif est une portée de travail à l’intérieur du projet principal. Vous pouvez revenir au dossier parent ou au projet complet à tout moment.

Il faut distinguer :

- la **portée du projet**, qui désigne l’ensemble du manuscrit ;
- la **portée de travail active**, qui désigne le dossier actuellement isolé.

## Une portée partagée par les outils

Lorsqu’un dossier est isolé, plusieurs surfaces Feuillets peuvent suivre la même portée :

- le Classeur ;
- le Tableau, dans ses modes Cartes, Plan, Chemin de fer et Chronologie ;
- la Recherche ;
- le Carnet du dossier lorsqu’il existe.

**Une structure, plusieurs représentations.** Le même dossier réel peut ainsi être parcouru dans le Classeur, observé dans le Tableau ou consulté dans la Recherche sans créer de copies.

Continu, l’Aperçu et l’export peuvent conserver leur propre choix de portée lorsqu’une opération possède un sélecteur explicite. Il faut donc distinguer la portée de travail de l’espace de la portée choisie pour une opération particulière.

## Réglages locaux et héritage

Pour les réglages pris en charge localement, la valeur effective suit cette chaîne :

```text
dossier exact → dossier parent → projet → réglage global
```

Un dossier ne stocke que les différences qu’il doit réellement surcharger. Par exemple, le projet peut définir un objectif général, un workflow et une typographie habituelle. **Tome II** peut surcharger uniquement son objectif et son workflow. Un chapitre enfant hérite alors de Tome II tant qu’il ne possède pas sa propre valeur.

Tous les réglages Feuillets ne sont pas nécessairement surchargeables localement. L’interface indique les réglages pris en charge et permet de revenir à la valeur héritée sans recopier les réglages du parent.

## Espace de travail ou ouvrage indépendant ?

Un espace ordinaire modifie le contexte local de travail mais reste dans l’unité éditoriale principale du projet. Lorsqu’un dossier doit devenir un tome, un livre ou une autre unité composée indépendamment, ouvrez ses réglages d’espace puis choisissez **Définir ce dossier comme ouvrage**.

L’ouvrage déclaré conserve les mêmes dossiers physiques et fichiers Markdown, mais son Aperçu et son export de portée Projet s’arrêtent à cette frontière éditoriale. Sa Composition peut hériter du projet principal ou devenir locale, notamment pour les pages liminaires, le sommaire, la bibliographie et les annexes. Plusieurs ouvrages frères peuvent ainsi former les tomes d’une série, et un ouvrage peut en contenir un autre si nécessaire.

Voir [Du texte court à la série](DU-TEXTE-COURT-A-LA-SERIE.md).

## Recherche Projet et Recherche Espace

Le modèle conceptuel est le suivant :

```text
Projet = documentation commune
Espace = documentation pertinente pour le dossier isolé
```

Un espace peut utiliser :

- un dossier Recherche associé directement au dossier ;
- un dossier Recherche hérité d’un dossier parent ;
- à défaut, la Recherche du projet selon le mécanisme concerné.

L’héritage descend depuis les ancêtres et ne traverse pas vers un dossier frère. Les mêmes noms de catégories dans le Projet et dans l’Espace ne signifient pas que les dossiers physiques sont fusionnés.

```text
Projet
├── Recherche commune
│   └── Personnages
├── Tome I
│   └── Recherche Tome I
└── Tome II
    └── Recherche Tome II
```

Quand Tome I est l’espace actif, le sélecteur Recherche permet de consulter Projet pour la Recherche commune ou Espace pour Recherche Tome I. Ces deux vues restent distinctes. Recherche Tome II n’appartient pas au contexte actif.

## Associations à un feuillet

Un dossier du Classeur peut avoir une Recherche associée qui participe au contexte de ses descendants selon l’héritage. Un feuillet peut aussi posséder une association documentaire directe.

Une association directe portée par un feuillet reste attachée à ce feuillet. Elle ne devient pas automatiquement une règle héritée par toute une branche ni par les feuillets frères.

## Double vue et groupe Espaces

Dans la double vue du Classeur, les couches sont présentées séparément :

```text
Recherche
  documentation du Projet

Espaces
  recherche Chapitre 1
  recherche Leçon 2

Vault
```

**Recherche** représente la couche documentaire du projet. **Espaces** regroupe les racines Recherche explicitement associées à des dossiers du Classeur.

**Espaces** est une représentation virtuelle de navigation. Elle ne crée pas de dossier physique, ne déplace ni ne copie de fichiers, et ne fusionne pas les dossiers avec la Recherche du projet.

Si un dossier Recherche d’espace se trouve physiquement sous la racine Recherche du projet, il peut malgré tout être présenté dans le groupe Espaces lorsque l’interface le reconnaît comme Recherche d’un espace. Une association documentaire portée uniquement par un feuillet n’apparaît pas pour autant comme une racine d’Espace.

## Chronologie

Dans le projet complet, la Chronologie globale du projet reste disponible.

Dans un espace isolé, la Chronologie conserve cette base globale et peut ajouter la chronologie issue de la Recherche effective de l’espace lorsqu’elle vient d’un dossier exact ou hérité. Les associations documentaires directes pertinentes aux feuillets de l’espace peuvent également être prises en compte.

Les espaces frères ne sont pas agrégés au contexte actif.

## Carnet

Un dossier peut avoir son propre Carnet :

- le Carnet global accompagne la réflexion à l’échelle du projet ;
- le Carnet de dossier accompagne la réflexion à l’échelle d’une partie du projet.

Cela ne crée toujours pas un second manuscrit. Lorsqu’une Recherche est explicitement associée au dossier et que Feuillets peut déterminer leur relation sans ambiguïté, les deux points d’entrée peuvent partager le même Carnet logique.

Voir [Le Carnet — des idées au manuscrit](HOW-TO-CARNET.md).

## Pourquoi ce modèle

Un gros projet peut rester un seul projet sans obliger l’auteur à travailler constamment avec toute sa complexité visible.

**Le projet fournit la continuité ; l’espace fournit le contexte.**
