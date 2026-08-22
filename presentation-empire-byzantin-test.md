# Thème I — Chrétientés et Islam

## Des mondes en contact

VIe–XIIIe siècles

---

# Chapitre 1

## L’Empire byzantin

L’Empire byzantin est l’héritier de l’Empire romain d’Orient.

---

# Introduction

## L’héritier de Rome

- En 395, l’Empire romain est divisé en deux parties.
- L’Empire romain d’Orient devient l’Empire byzantin.
- Sa capitale est Byzance, aussi appelée Tu travailles dans le dépôt LOCAL ACTUEL de Feuillets.

IMPORTANT

La V1 Présentation Markdown existe déjà dans le working tree local.

Travaille EXCLUSIVEMENT depuis cet état LOCAL ACTUEL.

INTERDIT :
- git reset
- git checkout de fichiers
- restauration depuis GitHub/main
- écrasement de modifications locales
- commit
- push

Je ne te demande PAS d’auditer ni de choisir l’architecture.

Le contrat fonctionnel est défini ci-dessous.

============================================================
MICRO-CHANTIER — PRÉSENTATION
LAYOUT AUTOMATIQUE « MÉDIA + QUESTIONS »
============================================================

CONTEXTE

L’usage réel principal est pédagogique :

- une image ;
- une photographie ;
- une carte ;
- un document visuel ;
- puis une liste de questions ou de consignes.

Markdown typique :

    # Étudier une plantation

    ![[plantation.png]]

    1. Présentez le document.
    2. Quels produits sont cultivés ?
    3. Qui travaille dans la plantation ?
    4. Que montre ce document ?

Feuillets doit reconnaître AUTOMATIQUEMENT cette structure.

L’utilisateur ne doit ajouter :
- aucune syntaxe spéciale ;
- aucune propriété YAML ;
- aucune directive de layout.

============================================================
OBJECTIF
============================================================

Ajouter un nouveau layout Presentation :

    media-questions

Il correspond structurellement à :

    heading éventuel
    + exactement un média autonome
    + une OL ou UL principale

Le layout doit ensuite choisir automatiquement entre :

A. média à gauche / questions à droite

ou

B. média en haut / questions en dessous

selon la forme du média et la quantité de contenu.

============================================================
NE PAS TOUCHER
============================================================

Préserver intégralement :

- title
- standard
- quote
- media
- media-text
- gallery
- navigation
- plein écran
- compteur
- live refresh
- overflow
- scale 16:9
- rendu Markdown natif
- moteur Document
- portrait-flow Document
- pagination A4
- PDF
- DOCX
- EPUB
- ODT
- Scrivenings
- Aperçu

Aucun changement hors Présentation.

============================================================
FICHIERS AUTORISÉS
============================================================

Production :

- `src/services/presentation.ts`
- `src/views/presentation-view.ts`
- `styles.css`

Tests :

- `test/presentation.test.js`
- `test/presentation-view.test.js`

Ne modifie aucun autre fichier sauf erreur TypeScript directement causée
par cette modification.

============================================================
1 — TYPE DE LAYOUT
============================================================

Dans `src/services/presentation.ts`,
étendre le type existant :

    PresentationLayout

avec :

    "media-questions"

Ne renomme aucun layout existant.

============================================================
2 — DÉTECTION STRUCTURELLE
============================================================

Modifier :

    presentationLayoutFor(root, index)

Le layout `media-questions` doit être sélectionné lorsque la slide contient :

- exactement UN média autonome ;
- exactement UNE OL ou UL principale ;
- éventuellement un heading ;
- éventuellement un ou deux paragraphes simples courts
  servant de contexte/légende/consigne.

IMPORTANT :

La détection est STRUCTURELLE.

INTERDIT :
- chercher le mot « question »
- chercher « exercice »
- chercher « document »
- chercher « carte »
- chercher une matière scolaire
- analyser lexicalement le texte

Une OL/UL associée à un média suffit.

============================================================
3 — PRIORITÉ DE CLASSIFICATION
============================================================

La priorité doit être :

1. title
2. quote si son contrat actuel s’applique
3. gallery
4. media-questions
5. media
6. media-text
7. standard

L’objectif est que :

    IMG + OL

ne tombe plus dans `media-text`.

Mais :

    IMG + simple paragraphe

doit rester `media-text`.

============================================================
4 — MÉDIA AUTONOME
============================================================

Réutiliser STRICTEMENT la définition actuelle du média autonome.

Ne considère jamais comme média principal une image située dans :

- LI
- BLOCKQUOTE
- TABLE
- contenu texte mixte

Ne déplace jamais artificiellement une image hors de son contexte Markdown.

============================================================
5 — DEUX SOUS-LAYOUTS
============================================================

Créer un type interne explicite :

    export type PresentationMediaQuestionsMode =
      | "side"
      | "stacked";

Créer une fonction PURE et testable, par exemple :

    mediaQuestionsModeFor(
      mediaWidth: number,
      mediaHeight: number,
      listItemCount: number
    ): PresentationMediaQuestionsMode

Le nom exact peut suivre les conventions du fichier.

============================================================
6 — RÈGLE AUTOMATIQUE
============================================================

La décision ne doit dépendre que :

- du ratio naturel du média ;
- du nombre d’items de la liste.

Aucune mesure lexicale.

Calcul :

    ratio = mediaWidth / mediaHeight

Règles V1 :

------------------------------------------------------------
PORTRAIT / CARRÉ
------------------------------------------------------------

Si :

    ratio <= 1.15

et :

    listItemCount <= 6

=> `side`

Donc :

    image gauche
    questions droite

Si plus de 6 items :

=> `stacked`

------------------------------------------------------------
PAYSAGE MODÉRÉ
------------------------------------------------------------

Si :

    ratio > 1.15
    ET
    ratio < 1.45

et :

    listItemCount <= 4

=> `side`

Sinon :

=> `stacked`

------------------------------------------------------------
PAYSAGE LARGE / CARTE
------------------------------------------------------------

Si :

    ratio >= 1.45

=> `stacked`

quelle que soit la liste.

============================================================
7 — DIMENSIONS INCONNUES
============================================================

Si les dimensions naturelles du média ne sont pas encore disponibles
ou sont invalides :

    width <= 0
    height <= 0

utiliser temporairement :

    stacked

Ne devine pas un ratio.

Lorsque l’image finit de charger,
PresentationView peut recalculer uniquement ce sous-layout
sans reparser le Markdown.

============================================================
8 — SIDE
============================================================

Classe :

    feuillets-presentation-media-questions-side

Composition logique :

    ┌───────────────────────────────────────────┐
    │ Titre                                     │
    │                                           │
    │ ┌──────────────────┐   1. Question       │
    │ │                  │   2. Question       │
    │ │      MÉDIA       │   3. Question       │
    │ │                  │   4. Question       │
    │ └──────────────────┘                      │
    └───────────────────────────────────────────┘

Sous le heading éventuel :

    grid-template-columns:
        minmax(0, 55fr)
        minmax(0, 45fr)

Média à GAUCHE.

Questions à DROITE.

Pourquoi :
le document visuel est l’objet principal de lecture.

Ne reprends PAS le `media-text` actuel qui place l’image à droite.

============================================================
9 — STACKED
============================================================

Classe :

    feuillets-presentation-media-questions-stacked

Composition :

    ┌───────────────────────────────────────────┐
    │ Titre                                     │
    │                                           │
    │ ┌───────────────────────────────────────┐ │
    │ │                 MÉDIA                 │ │
    │ └───────────────────────────────────────┘ │
    │                                           │
    │ 1. Question                               │
    │ 2. Question                               │
    │ 3. Question                               │
    └───────────────────────────────────────────┘

Utiliser :

    grid-template-rows:
        minmax(0, 1fr)
        auto

Le média doit recevoir la majorité de la hauteur disponible.

Ne fixe pas de hauteur en pixels dépendant du fichier.

============================================================
10 — HEADING
============================================================

Le heading éventuel doit rester :

    grid-column: 1 / -1

ou en première ligne complète.

Il ne doit jamais être intégré dans la colonne questions.

Préserver H1/H2/H3 etc. tels que stylés actuellement en Présentation.

============================================================
11 — PARAGRAPHE CONTEXTUEL ÉVENTUEL
============================================================

Cas accepté :

    # Titre

    ![[image.png]]

    *Document : gravure du XVIIIe siècle.*

    1. Présentez le document.
    2. Décrivez la scène.
    3. Expliquez...

Le paragraphe simple situé avec la liste appartient à la zone
des questions/consignes.

En mode `side` :

    média gauche
    paragraphe + liste droite

En mode `stacked` :

    média haut
    paragraphe + liste dessous

Ne transforme pas ce paragraphe en légende HTML spéciale.

Il reste un vrai `<p>` issu du Markdown.

============================================================
12 — ORDRE MARKDOWN
============================================================

Supporter :

    IMG
    OL/UL

et :

    IMG
    P
    OL/UL

Le DOM de présentation peut être restructuré VISUELLEMENT,
mais :

- ne modifie jamais le Markdown ;
- ne change pas l’ordre logique du contenu ;
- ne duplique aucun nœud ;
- ne perd aucun nœud.

============================================================
13 — IMAGES
============================================================

Conserver le correctif actuel de dimensionnement des médias.

Dans les deux sous-layouts :

    min-width: 0
    min-height: 0

La zone média doit être bornée.

Image :

    display: block
    max-width: 100%
    max-height: 100%
    width: auto
    height: auto
    object-fit: contain

Aucun crop.

Aucune déformation.

============================================================
14 — LISTES
============================================================

Dans `media-questions` uniquement :

- liste lisible ;
- retrait raisonnable ;
- espacement vertical compact mais aéré ;
- pas de réduction minuscule automatique.

OL :
conserver les numéros Markdown.

UL :
conserver les puces.

Ne transforme pas les listes en paragraphes.

============================================================
15 — OVERFLOW
============================================================

Conserver STRICTEMENT le système actuel :

    scrollWidth > clientWidth
    OU
    scrollHeight > clientHeight

=> `Contenu trop long`

Mais le contrôle doit intervenir APRÈS :

- chargement/dimensionnement du média ;
- choix `side` / `stacked` ;
- application des classes correspondantes.

Une slide raisonnable :

    image + 4 questions

ne doit pas produire un faux overflow.

Une slide :

    image + 15 longues questions

peut légitimement produire :

    Contenu trop long

Ne réduis pas automatiquement toute la police.

============================================================
16 — RECALCUL APRÈS CHARGEMENT IMAGE
============================================================

Lorsqu’une image du layout `media-questions` finit de charger :

1. lire :
       naturalWidth
       naturalHeight
2. calculer :
       mediaQuestionsModeFor(...)
3. poser la bonne classe :
       side
       OU
       stacked
4. recalculer l’overflow ;
5. recalculer le scale uniquement si nécessaire.

Ne re-render pas tout le Markdown.

Éviter tout listener non nettoyé à la fermeture/re-render.

============================================================
17 — CLASSES CSS
============================================================

Toutes les règles sous :

    .feuillets-presentation-view

Ajouter au minimum :

    .feuillets-presentation-layout-media-questions

    .feuillets-presentation-media-questions-side

    .feuillets-presentation-media-questions-stacked

Utiliser les conventions CSS existantes du moteur Présentation.

Aucune règle globale.

============================================================
18 — CAS À PRÉSERVER
============================================================

------------------------------------------------------------
IMAGE + TEXTE SIMPLE
------------------------------------------------------------

    # Voltaire

    ![[voltaire.jpeg]]

    Philosophe français du XVIIIe siècle.

=> reste `media-text`.

------------------------------------------------------------
IMAGE SEULE
------------------------------------------------------------

    # Carte

    ![[carte.png]]

=> reste `media`.

------------------------------------------------------------
DEUX IMAGES
------------------------------------------------------------

    ![[a.png]]
    ![[b.png]]

=> reste `gallery`.

------------------------------------------------------------
IMAGE + BLOCKQUOTE
------------------------------------------------------------

Ne doit PAS devenir `media-questions`
sauf présence d’une OL/UL correspondant au contrat.

------------------------------------------------------------
LISTE SANS IMAGE
------------------------------------------------------------

=> `standard`.

============================================================
19 — TESTS SERVICE OBLIGATOIRES
============================================================

Dans `test/presentation.test.js` :

A. classification

1.

    H1
    IMG
    OL

=> media-questions

2.

    H1
    IMG
    P
    UL

=> media-questions

3.

    H1
    IMG
    P

=> media-text

4.

    H1
    IMG

=> media

5.

    H1
    IMG
    IMG

=> gallery

6.

    H1
    OL

=> standard

------------------------------------------------------------
B. mediaQuestionsModeFor
------------------------------------------------------------

Tester exactement :

portrait :

    600 × 900
    4 items
=> side

carré :

    631 × 631
    4 items
=> side

carré :

    631 × 631
    7 items
=> stacked

paysage modéré :

    1200 × 900
    3 items
=> side

paysage modéré :

    1200 × 900
    5 items
=> stacked

carte large :

    1600 × 900
    3 items
=> stacked

dimensions invalides :

    0 × 0
=> stacked

============================================================
20 — TESTS VIEW OBLIGATOIRES
============================================================

Dans `test/presentation-view.test.js` :

1. PORTRAIT + QUESTIONS

Image simulée :
    600 × 900

Liste :
    4 items

=> classe layout media-questions
=> classe side
=> média à gauche
=> liste à droite
=> aucun contenu dupliqué
=> aucun overflow artificiel.

2. CARRÉ + QUESTIONS

    631 × 631
    4 items

=> side.

3. CARTE LARGE + QUESTIONS

    1600 × 900
    4 items

=> stacked.

4. BEAUCOUP DE QUESTIONS

    631 × 631
    8 items

=> stacked.

5. IMAGE + P SIMPLE

=> media-text historique.

6. IMAGE SEULE

=> media historique.

7. GALLERY

=> gallery historique.

8. LOAD IMAGE

Initialement dimensions absentes :
=> stacked provisoire.

Après événement `load` avec dimensions portrait :
=> side.

9. OVERFLOW RÉEL

Image + très longue liste :
=> système `Contenu trop long` toujours fonctionnel.

10. AUCUNE DUPLICATION

Chaque :
- heading
- image
- paragraphe
- item de liste

doit apparaître exactement une fois dans le DOM final.

============================================================
21 — BENCHMARK MANUEL
============================================================

Tester dans Obsidian :

------------------------------------------------------------
A — PHOTO + QUESTIONS
------------------------------------------------------------

    # Étudier une plantation

    ![[plantation.png]]

    1. Présentez le document.
    2. Quels produits sont cultivés ?
    3. Qui travaille dans la plantation ?
    4. Que montre ce document ?

Attendu :
layout automatique adapté au ratio réel.

------------------------------------------------------------
B — PORTRAIT + QUESTIONS
------------------------------------------------------------

    # Voltaire

    ![[voltaire.jpeg]]

    1. Présentez Voltaire.
    2. À quel siècle appartient-il ?
    3. Quelle idée défend-il ?
    4. Expliquez son rôle dans les Lumières.

Attendu :

    portrait gauche
    questions droite

------------------------------------------------------------
C — CARTE + QUESTIONS
------------------------------------------------------------

    # Le commerce triangulaire

    ![[carte-commerce-triangulaire.png]]

    1. Identifiez les trois espaces.
    2. Quels produits circulent ?
    3. Décrivez les principaux flux.

Attendu :

    grande carte en haut
    questions dessous

------------------------------------------------------------
D — TEXTE + IMAGE
------------------------------------------------------------

    # Voltaire

    ![[voltaire.jpeg]]

    Philosophe français du XVIIIe siècle.

Attendu :

    media-text historique

PAS media-questions.

============================================================
22 — NON-RÉGRESSIONS
============================================================

Exécuter les tests existants concernant :

- split Presentation
- title
- standard
- quote
- media
- media-text
- gallery
- navigation clavier
- fullscreen
- live refresh
- scale
- overflow

Et la suite complète du projet.

============================================================
23 — GARDE-FOUS
============================================================

ABSOLUMENT :

- aucun `any`
- aucun `ts-ignore`
- aucun nouvel `eslint-disable`
- aucun `!important`
- aucune dépendance
- aucune syntaxe Markdown propriétaire
- aucune propriété YAML requise
- aucun hardcode de nom de fichier
- aucun hardcode de matière scolaire
- aucune analyse lexicale des questions
- aucune coordonnée absolue
- aucun `position:absolute`
- aucune modification du Markdown
- aucun changement du moteur Document
- aucun changement de pagination
- aucun changement des exporteurs
- aucun commit
- aucun push

============================================================
24 — VALIDATION
============================================================

Exécuter dans cet ordre :

1. tests ciblés `presentation.test.js`
2. tests ciblés `presentation-view.test.js`
3. `npm test`
4. `npm run build`
5. `npm run lint`
6. `npm run lint:obsidian`
7. `git diff --check`
8. `git status --short`

============================================================
À LA FIN
============================================================

Donne uniquement :

- fichiers modifiés ;
- nouveau layout `media-questions` ;
- règle de détection structurelle ;
- règle automatique side/stacked ;
- comportement portrait/carré ;
- comportement paysage/carte ;
- comportement avec beaucoup de questions ;
- preuve que media-text/media/gallery/media restent inchangés ;
- résultat overflow ;
- tests ciblés ;
- npm test ;
- build ;
- lint ;
- lint Obsidian ;
- git diff --check ;
- git status --short.

Confirme explicitement :

- aucun Markdown modifié ;
- aucun changement du moteur Document ;
- aucun changement du paginateur ;
- aucun changement des exports ;
- aucun commit ;
- aucun push.

Ne propose aucun autre chantier.Constantinople.
- Les empereurs byzantins se considèrent comme les successeurs des empereurs romains.

---

# Constantinople

## Une nouvelle Rome

- L’empire s’étend au sud-est de l’Europe et en Asie Mineure.
- Il abrite des peuples de langues et de cultures différentes.
- Constantinople est située au carrefour de l’Europe et de l’Asie.

> Comment s’organise l’Empire byzantin et quels sont ses contacts avec ses voisins ?

---

# Séance 1

## Un empire romain, grec et chrétien

- Étudier la culture et la religion de l’Empire byzantin.
- Analyser et comprendre des documents.
- Observer Constantinople, sa capitale.

---

# Constantinople

## Une capitale protégée

- Entre quels continents et quelles mers se situe-t-elle ?
- Par quoi est-elle protégée ?
- Quels monuments abrite-t-elle ?
- Où se trouvent Sainte-Sophie et le palais impérial ?

---

# Sainte-Sophie

## Une ville chrétienne

- L’église Sainte-Sophie est construite à Constantinople.
- Les mosaïques représentent le Christ et les empereurs.
- Elles montrent que les empereurs byzantins sont chrétiens.

---

# I — Un empire romain, grec et chrétien

## Une langue, un héritage

- Dans l’Empire byzantin, on parle surtout grec.
- Les empereurs se présentent comme les successeurs des Romains.
- Les villes rappellent l’Antiquité grecque et romaine : acropoles, aqueducs, forums.

---

# I — Un empire chrétien

## Une religion dominante

- Les empereurs résident à Constantinople.
- Ils sont chrétiens.
- Le christianisme est la religion dominante dans l’empire.

---

# Séance 2

## Les pouvoirs du basileus

- Comprendre comment les empereurs byzantins gouvernent leur empire.
- Travailler par petits groupes sur des documents historiques.
- Étudier une mosaïque et une enluminure.

---

# Enquêter comme des historiens

## Étudier un document

- Présenter sa nature, sa date et son sujet.
- Identifier l’empereur représenté.
- Expliquer pourquoi il est représenté ainsi.
- Montrer ce que le document apprend sur son pouvoir.

---

# II — Le basileus

## Un empereur sacré

- Le basileus signifie « roi » en grec.
- Il est considéré comme sacré, choisi par Dieu.
- Il gouverne avec l’aide du clergé, d’une administration et de fonctionnaires.

---

# II — Chef de guerre

## Défendre l’empire

- L’empereur est à la tête de l’armée byzantine.
- Il défend l’empire contre les royaumes et peuples voisins.
- Au Moyen Âge, l’empire est de plus en plus menacé et son territoire se réduit.

---

# Séance 3

## Un empire en contact avec ses voisins

- Étudier les relations avec l’Occident et le monde musulman.
- Lire une carte de l’Empire byzantin face à ses voisins.
- Travailler à partir de documents archéologiques.

---

# La tombe de Prittlewell

## Des échanges à l’échelle de l’Europe

- Localiser précisément la tombe.
- Dater la tombe et sa découverte.
- Identifier la personne enterrée.
- Comprendre les relations entre l’Empire byzantin et ses voisins.

---

# III — Commerce et contacts

## Un carrefour méditerranéen

- Le commerce autour de la Méditerranée est très actif.
- L’Empire byzantin se situe entre l’Asie, l’Afrique et l’Europe.
- Il est un espace essentiel pour les marchands de ces régions.

---

# III — Guerres et conquêtes

## Une puissance convoitée

- La richesse de l’empire attire les convoitises.
- En 1204, Constantinople est prise et pillée par les chrétiens d’Occident.
- En 1453, les Turcs musulmans achèvent la conquête de l’empire.

---

# Les dates à retenir

| Date | Événement |
| --- | --- |
| 395 | Division de l’Empire romain ; naissance de l’Empire romain d’Orient. |
| Vers 550 | Règne de Justinien ; l’empire est au sommet de sa puissance. |
| 1204 | Prise de Constantinople par les chrétiens d’Occident. |
| 1453 | Conquête turque de Constantinople et fin de l’Empire byzantin. |
