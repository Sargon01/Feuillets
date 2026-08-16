# Validation du flux de révision DOCX

> Pour le parcours utilisateur, voir **[Réviser un manuscrit Word avec Feuillets](HOW-TO-REVISION-DOCX.md)**.

> Document de recette et de maintenance, pas une présentation marketing.

## Point d’entrée 2.5

Le flux DOCX appartient désormais à **Relecture → Révision DOCX**.

Il ne doit plus être documenté comme une fonction de l’ancien onglet Édition du panneau droit. L’espace central **Édition** est réservé à Composition et Mise en page.

## Flux

```text
Markdown Feuillets
→ export DOCX
→ révision dans Word ou logiciel compatible
→ import du DOCX révisé dans Relecture → Révision DOCX
→ analyse et regroupement des changements
→ décision de l’auteur
→ réintégration contrôlée dans les fichiers Markdown
→ comparaison / contrôle
```

Le Markdown reste la source de vérité.

## Principe essentiel

Une révision extérieure est une **proposition**, jamais une autorisation de réécrire silencieusement le projet.

Lorsqu’un changement ne peut pas être associé avec une confiance suffisante à un feuillet ou à un passage source, il doit rester à vérifier ou ambigu plutôt qu’être appliqué arbitrairement.

## Grammaire de comparaison 2.5

Lorsque le flux présente un avant/après, il doit rester cohérent avec la grammaire commune du comparateur Feuillets :

- ajout ;
- suppression ;
- remplacement ;
- déplacement/couper-coller lorsqu’il peut être identifié ;
- placeholder `[…]` sur le côté où le passage n’existe plus ou pas encore ;
- navigation précédent/suivant ;
- recentrage sur la différence sélectionnée ;
- défilement synchronisé uniquement lorsqu’il est activé.

Le rendu peut être adapté au contexte DOCX, mais ne doit pas réintroduire une seconde logique visuelle contradictoire.

## Décisions et traçabilité

Une décision appliquée doit permettre de retrouver au minimum :

- le changement concerné ;
- les fichiers touchés ;
- la date de décision ;
- les instantanés créés lorsqu’ils sont nécessaires ;
- les éventuels mouvements entre fichiers ;
- les opérations sur notes de bas de page lorsque le changement en contient.

La trace ne doit pas stocker une seconde copie inutile du manuscrit dans les réglages.

## Cas à vérifier lors d’une évolution

La suite de tests et les recettes manuelles doivent couvrir, selon les capacités du parseur :

- insertions ;
- suppressions ;
- remplacements ;
- commentaires ;
- commentaires résolus lorsque l’information est disponible ;
- déplacements Word pris en charge ;
- couper-coller détectable ;
- changements multi-paragraphes ;
- changements touchant plusieurs feuillets ;
- notes de bas de page ;
- collisions d’identifiants ;
- protection de la structure Markdown ;
- mapping vers les feuillets sources ;
- état ambigu / à vérifier ;
- protection avant écriture ;
- comportement transactionnel pour une opération multi-fichiers ;
- retour contrôlé en cas d’échec ;
- comparaison du résultat avec l’état précédent.

## Protection des sources

Avant toute écriture issue du DOCX révisé, le flux doit conserver assez d’information pour que l’auteur puisse :

- comprendre ce qui est proposé ;
- refuser ou ignorer une proposition ;
- identifier les fichiers qui seront touchés ;
- contrôler le résultat ;
- retrouver un état antérieur lorsque le workflow prévoit un instantané.

La protection par snapshot/trace ne doit pas être contournée pour simplifier l’application d’un changement.

## Distinction avec la relecture collaborative

La **Révision DOCX** et la **relecture collaborative native** sont deux workflows différents.

Révision DOCX :

```text
DOCX exporté
→ Word / logiciel compatible
→ DOCX révisé
→ import et traitement
```

Relecture collaborative :

```text
paquet .feuillets
→ copie de travail du relecteur
→ commentaires / changements
→ paquet retour
→ comparaison à trois états côté auteur
```

Ils peuvent partager la même grammaire de comparaison, mais leurs formats d’échange et leurs règles de réintégration ne doivent pas être confondus.

## Tests automatisés de référence

Les principaux tests de cette zone se trouvent notamment dans les suites DOCX :

```text
test/docx-review-import.test.js
test/docx-review-regenerate.test.js
test/docx-review-view.test.js
test/docx-blocks.test.js
test/docx-bookmarks.test.js
```

Les noms exacts doivent être vérifiés lors de la recette si une suite est renommée. Une régression doit recevoir un test ciblé dans la couche qui l’a causée.

## Recette manuelle minimale

Pour toute modification du moteur DOCX :

1. exporter un projet de contrôle ;
2. ouvrir le DOCX dans Word ou un logiciel compatible ;
3. produire insertion, suppression, remplacement et au moins un couper-coller ;
4. ajouter au moins un commentaire ;
5. inclure une modification touchant une note de bas de page si le chantier la concerne ;
6. sauvegarder le DOCX ;
7. l’importer depuis **Relecture → Révision DOCX** ;
8. vérifier la classification et les déplacements ;
9. appliquer seulement les propositions sûres ;
10. rouvrir les fichiers Markdown sources ;
11. comparer avec l’état précédent ;
12. réexporter un DOCX de contrôle.

## Projet de contrôle conseillé

Le projet de recette devrait contenir :

- plusieurs feuillets ;
- au moins deux chapitres ;
- texte identique à plusieurs endroits pour tester les ambiguïtés ;
- caractères accentués et Unicode ;
- une note de bas de page ;
- commentaires ;
- paragraphes courts et longs ;
- au moins un passage pouvant être déplacé d’un feuillet à un autre.

## Limites

Les limites doivent être documentées à partir du parseur actuel, des tests et de cas DOCX reproductibles.

Ne pas conserver ici de promesse de « lot futur » ou de comportement historique qui ne correspond plus au dépôt. Une limite non prise en charge doit être décrite comme limite actuelle, sans prétendre que le moteur sait l’interpréter.
