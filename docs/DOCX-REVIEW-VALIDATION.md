# Validation du flux de révision DOCX

> Pour le parcours utilisateur, voir **[Réviser un manuscrit Word avec Feuillets](HOW-TO-REVISION-DOCX.md)**.

> Document de recette et de maintenance, pas une présentation marketing.

## Flux

```text
Markdown Feuillets
→ export DOCX
→ révision dans Word ou logiciel compatible
→ import du DOCX révisé dans l’onglet Édition
→ analyse des changements
→ décision de l’auteur
→ réintégration dans les fichiers Markdown
→ comparaison/contrôle
```

Le Markdown reste la source de vérité.

## Principe essentiel

Une révision extérieure est une **proposition de modification**, pas une autorisation de réécrire silencieusement le projet.

Lorsqu’un changement ne peut pas être associé de façon suffisamment sûre à un feuillet ou un passage source, il doit rester classé comme à vérifier/ambigu plutôt qu’être appliqué de force.

## Cas à vérifier lors d’une évolution

La suite de tests et les recettes manuelles doivent couvrir, selon les capacités du parseur :

- insertions ;
- suppressions ;
- remplacements ;
- commentaires ;
- commentaires résolus lorsque l’information est disponible ;
- déplacements Word pris en charge ;
- séquences couper-coller détectables ;
- changements multi-paragraphes ;
- changements touchant plusieurs feuillets ;
- notes de bas de page ;
- collisions d’identifiants ;
- protection de la structure Markdown ;
- mapping vers les feuillets sources ;
- état « ambigu » ;
- état « à vérifier » ;
- protection avant écriture ;
- comportement transactionnel pour une opération multi-fichiers ;
- retour contrôlé en cas d’échec ;
- comparaison du résultat avec l’état précédent.

## Protection des sources

Avant toute écriture issue d’un document révisé, le flux doit conserver assez d’information pour que l’auteur puisse :

- identifier les fichiers touchés ;
- comprendre ce qui a été proposé ;
- refuser une modification ;
- contrôler le résultat ;
- revenir à un état antérieur si nécessaire.

La fonction de snapshot/backup ne doit pas être contournée pour gagner quelques lignes de code dans le réimport.

## Tests automatisés de référence

Les principaux tests de cette zone se trouvent notamment dans :

```text
test/docx-review-import.test.js
test/docx-review-regenerate.test.js
test/docx-review-view.test.js
test/docx-blocks.test.js
test/docx-bookmarks.test.js
```

Un nouveau cas de régression doit recevoir un test ciblé dans la couche qui l’a réellement causé.

## Recette manuelle minimale

Pour une modification du moteur DOCX :

1. exporter un projet de contrôle ;
2. ouvrir le DOCX dans Word ou un logiciel compatible ;
3. produire plusieurs types de révisions ;
4. ajouter au moins un commentaire ;
5. sauvegarder le DOCX ;
6. l’importer dans Feuillets ;
7. vérifier la classification des propositions ;
8. appliquer seulement les changements sûrs ;
9. rouvrir les feuillets Markdown ;
10. comparer avec l’état avant import ;
11. réexporter un DOCX de contrôle.

## Projet de contrôle conseillé

Le projet de recette devrait contenir :

- plusieurs feuillets ;
- au moins deux chapitres ;
- texte identique à plusieurs endroits pour tester les ambiguïtés ;
- caractères accentués/Unicode ;
- une note de bas de page ;
- commentaires ;
- paragraphes courts et longs.

## Limites

Les limites réelles doivent être documentées à partir :

- du parseur actuel ;
- des tests ;
- d’un cas Word reproductible.

Ne pas conserver dans ce document des mentions de « lot futur » qui ne correspondent plus à l’état du dépôt. Une limite non encore prise en charge doit être décrite comme limite actuelle et accompagnée, si possible, d’un test ou d’une issue.
