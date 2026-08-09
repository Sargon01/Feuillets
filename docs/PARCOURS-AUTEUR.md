# Le parcours d’un auteur, du premier mot à l’envoi

> **Français** · [English](AUTHOR-WORKFLOW.md) · [Index](README.md)

Ce guide suit le travail dans son ordre naturel. Il ne cherche pas à énumérer chaque réglage.

## 1. Choisir la bonne porte d’entrée

Vous pouvez :

1. **créer un nouveau projet** ;
2. **utiliser un dossier existant tel quel** ;
3. **initialiser un dossier existant** avec un type Feuillets ;
4. **importer un projet Scrivener** ;
5. ouvrir le **projet de démonstration**.

Le choix le plus important est de ne pas restructurer inutilement ce qui existe déjà. Si votre manuscrit Markdown est organisé comme vous le souhaitez, utilisez-le tel quel.

![Création du premier projet](creer-premier-projet.gif)

## 2. Poser la structure

Le Classeur représente le manuscrit réel.

![Classeur](feuillets-classeur.png)

Vous pouvez :

- créer dossiers et feuillets ;
- renommer les dossiers ;
- déplacer des éléments par glisser-déposer ;
- ramener un dossier ou un feuillet à la racine du manuscrit ;
- sélectionner plusieurs éléments ;
- choisir une densité et une présentation du Classeur ;
- rechercher et filtrer.

La structure n’est pas limitée à un schéma rigide. Les termes partie, chapitre, scène ou section servent à guider l’interface ; les fichiers restent libres.

## 3. Écrire dans le feuillet

Le centre de l’atelier reste l’éditeur d’Obsidian.

Feuillets y ajoute :

- une présentation littéraire ;
- des aides typographiques ;
- la recherche/remplacement dans le manuscrit ;
- les notes de bas de page ;
- les citations ;
- le mode Concentration ;
- le défilement machine à écrire.

![Écriture et Aperçu](feuillets-concentration-apercu.png)

## 4. Garder le travail préparatoire à côté du texte

Dans l’Inspecteur, l’onglet **Notes** regroupe ce qui accompagne le feuillet :

- synopsis ;
- résumé ;
- notes de travail ;
- propriétés ;
- notes de bas de page ;
- notes de chapitre ou de dossier ;
- contexte du passage courant.

Le texte final reste séparé des informations de travail.

## 5. Construire la bible du projet

L’onglet **Recherche** accueille les fiches et documents de référence.

Les rubriques automatiques dépendent du type de projet, mais vous pouvez créer des rubriques personnalisées. Un dossier de Recherche peut aussi être explicitement associé à un feuillet ou à un dossier du Classeur, y compris s’il se trouve ailleurs dans le coffre.

Depuis une fiche, vous pouvez insérer :

- un lien ;
- un extrait ;
- un extrait avec sa source.

## 6. Utiliser le contexte pendant l’écriture

La section **Contexte** de Notes suit le passage autour du curseur. Elle peut faire remonter :

- des références explicites ;
- des fiches épinglées ;
- des documents associés ;
- des états de personnages ou de lieux ;
- des événements liés à la date ;
- des alertes chronologiques.

Le mécanisme reste lexical et déterministe. Il ne remplace pas une décision d’auteur et ne corrige rien automatiquement.

Voir [Utiliser le contexte intelligent local](How-to-Contexte-Feuillets.md).

## 7. Explorer avant de décider

Le **Carnet** est l’espace de pensée libre. Sur Canvas, vous pouvez jeter une idée, la relier à d’autres, grouper plusieurs pistes puis choisir celles qui doivent devenir des feuillets ou des documents de Recherche.

Le Carnet n’impose pas d’ordre narratif avant que vous soyez prêt à en créer un.

## 8. Prendre du recul sur le manuscrit

![Plusieurs vues du manuscrit](feuillets-mosaique-narrative.png)

### Cartes

Réorganiser visuellement les scènes et lire synopsis ou extraits.

### Plan

Comparer les informations du manuscrit : statut, label, date, objectif, mots, progression, synopsis, résumé et autres colonnes configurées.

### Chemin de fer

Observer les fils narratifs et leur répartition.

### Chronologie

Comparer l’ordre de lecture avec l’ordre des événements et repérer les chevauchements.

### Aperçu

Lire un feuillet, un dossier, une sélection ou le manuscrit avec la composition réelle.

## 9. Transformer le texte

Une scène ou une section peut être :

- déplacée ;
- dupliquée ;
- scindée ;
- fusionnée ;
- exclue de la compilation ;
- réintégrée plus tard.

Les opérations de scission et de fusion appliquent des règles explicites aux propriétés afin d’éviter de perdre silencieusement des informations.

## 10. Analyser sans confondre analyse et correction

L’onglet **Analyse** fournit des indicateurs d’écriture : métriques de prose, répétitions, équilibre entre chapitres, vocabulaire disponible selon les données, et rythme lorsque l’auteur l’a renseigné.

L’onglet **Relecture** a un autre rôle : il affiche les signalements fournis par un module compagnon. Feuillets ne contient pas de moteur grammatical.

## 11. Suivre le travail

Le **Journal** conserve la trace du travail d’écriture. Les statistiques permettent de suivre objectifs, volume et activité.

Il n’est pas nécessaire d’utiliser le Journal dès le début : il peut être ouvert lorsque le projet commence à durer.

## 12. Marquer un état avant une grosse réécriture

Avant une restructuration importante :

- créez un **instantané** du feuillet concerné ;
- ou dupliquez le manuscrit comme **nouvelle version** ;
- laissez la **sauvegarde ZIP** automatique jouer son rôle de filet de sécurité.

![Comparaison de versions](feuillets-comparaison.png)

Un instantané n’est pas une nouvelle branche de travail ; une version, oui.

## 13. Lire avant d’exporter

L’Aperçu sert de contrôle éditorial.

![Aperçu paginé](feuillets-apercu.png)

Vérifiez :

- l’ordre ;
- les titres ;
- les séparateurs ;
- les pages liminaires ;
- le modèle ;
- la portée sélectionnée ;
- la lisibilité générale.

## 14. Composer la bonne portée

Feuillets peut compiler :

- le feuillet courant ;
- un dossier et ses descendants ;
- une sélection de fichiers et dossiers ;
- le projet entier.

Un dossier sélectionné inclut ses descendants Markdown une seule fois, même si un descendant est également sélectionné.

## 15. Exporter

Les formats natifs sont :

- DOCX ;
- EPUB ;
- ODT ;
- PDF sur desktop ;
- Markdown compilé.

Les formats ne sont pas identiques :

- DOCX privilégie l’édition dans un traitement de texte ;
- EPUB reste adaptable à la liseuse ;
- ODT cible l’écosystème OpenDocument ;
- PDF fixe la page ;
- Markdown conserve la composition dans un format texte ouvert.

Voir [Composition et export](COMPOSITION-ET-EXPORT.md).

## 16. Réintégrer des corrections éditoriales

Après un envoi DOCX à un relecteur ou éditeur, l’onglet **Édition** peut analyser les révisions et commentaires du fichier retourné.

Le principe reste :

> Markdown Feuillets → DOCX → révision externe → décision de l’auteur → Markdown

Les cas ambigus ne doivent jamais être appliqués silencieusement.

## 17. Préparer l’envoi

Le dossier `_Edition`, créé à la demande, peut rassembler :

- Synopsis ;
- Note d’intention ;
- Biographie ;
- Lettre d’accompagnement ;
- Soumissions ;
- Versions envoyées.

Le module compagnon **Courrier** peut ensuite gérer l’historique des contacts, envois, réponses et relances.

## 18. Continuer sans verrouillage

À tout moment, le projet reste un ensemble de fichiers et dossiers lisibles par Obsidian et par d’autres outils Markdown.

Feuillets organise l’atelier ; il ne devient pas le propriétaire du manuscrit.
