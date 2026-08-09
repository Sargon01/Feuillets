# Réécriture, sauvegardes et versions

> **Français** · [English](REWRITING-BACKUPS-AND-VERSIONS.md) · [Index](README.md)

Un manuscrit n’évolue pas en ligne droite. Feuillets sépare plusieurs mécanismes parce qu’ils ne répondent pas au même besoin.

![Comparaison de deux états](feuillets-comparaison.png)

## 1. Sauvegarde ZIP

La sauvegarde automatique ou manuelle crée une archive ZIP locale dans `_Backups`.

Elle est destinée au filet de sécurité régulier, pas au travail comparatif quotidien.

### Projet structuré autour de `Manuscrit`

Si le dossier actif est réellement `Manuscrit` et se trouve dans un dossier de projet :

```text
Mon projet/
├── Manuscrit/
├── _Recherche/
├── _Ressources/
├── _Snapshots/
├── _Versions/
└── _Backups/
```

la sauvegarde couvre **Mon projet** et exclut `_Backups` lui-même du ZIP.

### Dossier utilisé tel quel

Si le projet actif est un dossier quelconque :

```text
Documents/
├── Mon article/
└── Autre dossier/
```

et `Mon article` est utilisé comme projet, Feuillets sauvegarde **strictement `Mon article`**.

Il ne remonte pas vers `Documents`, n’inclut pas `Autre dossier` et ne sauvegarde jamais implicitement la racine entière du coffre.

`_Backups` est créé dans `Mon article`.

### Rotation

Le nombre de ZIP conservés dépend du réglage de rétention. Les anciennes archives au-delà de cette limite sont envoyées à la corbeille via Obsidian.

## 2. Instantané d’un feuillet

Un instantané copie le contenu actuel d’un feuillet dans l’espace `_Snapshots`.

Utilisez-le avant :

- une grosse coupe ;
- une réécriture risquée ;
- une fusion ;
- une expérience locale.

L’instantané est un jalon, pas une branche active.

## 3. Comparaison

La comparaison sert à comprendre les changements :

- ajouts ;
- suppressions ;
- remplacements.

Elle peut être utilisée avec des instantanés ou d’autres fichiers selon le contexte.

## 4. Nouvelle version du manuscrit

**Dupliquer comme nouvelle version** copie le manuscrit dans `_Versions`.

La Recherche reste partagée : l’objectif est de dupliquer le manuscrit, pas toute la bible documentaire.

L’ordre personnalisé du Classeur est recopié avec la version afin qu’une duplication ne retombe pas simplement dans l’ordre alphabétique.

Utilisez une version pour :

- tester un nouveau début ;
- modifier fortement la structure ;
- produire une version courte ;
- conserver un premier jet tout en poursuivant le second.

## 5. Révision DOCX

La réintégration d’un DOCX révisé est encore un autre mécanisme : elle compare des propositions extérieures avec les fichiers Markdown sources.

Les changements ambigus doivent rester soumis à une décision explicite.

Voir [Validation du flux de révision DOCX](DOCX-REVIEW-VALIDATION.md).

## Quel outil choisir ?

| Besoin | Outil |
|---|---|
| Protection régulière du projet | Sauvegarde ZIP |
| Marquer l’état d’un seul feuillet | Instantané |
| Comprendre ce qui a changé | Comparaison |
| Explorer une direction alternative | Nouvelle version |
| Réintégrer les retours d’un relecteur Word | Révision DOCX |

## Limite importante

Les sauvegardes Feuillets sont un filet de sécurité local. Elles ne remplacent pas une vraie stratégie de sauvegarde du coffre entier : Obsidian Sync, Time Machine, sauvegarde système, Git ou autre solution adaptée à vos données.
