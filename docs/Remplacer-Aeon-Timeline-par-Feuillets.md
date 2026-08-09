# Remplacer Aeon Timeline par Feuillets

> **Français** · [English](REPLACE-AEON-TIMELINE-WITH-FEUILLETS.md) · [Index](README.md)

Vous utilisez Aeon Timeline pour construire la chronologie de votre récit, suivre les personnages, comparer l’ordre réel des événements avec l’ordre narratif, vérifier les âges et observer les différents fils de l’intrigue.

Vous vous demandez si Feuillets peut reprendre ce workflow directement dans Obsidian, sans conserver une application séparée et sans synchroniser deux versions du même projet.

![Cartes, Plan, Chemin de fer et Chronologie](feuillets-mosaique-narrative.png)

La réponse honnête est : **oui pour une grande partie du travail chronologique directement lié à un manuscrit**, mais **Feuillets ne remplace pas encore toute la puissance d’Aeon Timeline comme logiciel spécialisé de modélisation temporelle**.

Aeon Timeline est conçu d’abord pour représenter des événements, des entités, leurs relations et des calendriers complexes. Feuillets est conçu d’abord pour écrire, structurer et réviser un livre. Sa chronologie est intégrée au manuscrit et sert principalement la continuité narrative.

---

## 1. Retrouver la Timeline View

Dans Feuillets, vous utilisez la vue **Chronologie**.

Elle rassemble :

- les scènes datées du manuscrit ;
- les événements historiques ou narratifs ;
- les jalons ;
- les dates de début et de fin disponibles ;
- les personnages, lieux ou tags associés ;
- les événements issus de la Recherche.

### Équivalences principales

| Aeon Timeline | Feuillets |
|---|---|
| Timeline View | Chronologie |
| Event | Scène datée ou événement |
| Milestone | Jalon |
| Grouping | Regroupement ou filtre |
| Inspector | Propriétés et fiche Recherche |
| Timeline file | Projet Feuillets |
| Context Bar | Navigation dans la chronologie |
| Calendar Marker | Jalon ou événement historique |

La différence essentielle est que dans Feuillets, une scène de la chronologie correspond directement à un feuillet réel du manuscrit.

---

## 2. Retrouver les événements

Dans Feuillets, un événement peut être représenté de deux manières.

### Une scène du manuscrit

Le feuillet contient le texte réellement écrit, accompagné de ses propriétés :

```yaml
---
date: 1826-06-15
date_fin: 1826-06-16
lieu: Suvasa
personnages:
  - Kali
  - Deli
fils:
  - attaque-du-tekke
---
```

### Un événement de Recherche

Un événement historique ou narratif peut exister sans être une scène du manuscrit :

```yaml
---
type: evenement
date: 1826-06-15
tags:
  - janissaires
  - empire-ottoman
---
```

Cela permet de distinguer :

- ce qui arrive dans l’univers du récit ;
- ce qui est effectivement raconté dans le manuscrit.

Feuillets peut réutiliser plusieurs noms historiques de rubrique pour ces événements : `Événements`, `Events`, `Chronologie`, `Timeline`, `Chronology` et `_Chronologie`.

---

## 3. Retrouver les entités

Dans Feuillets, ces éléments se trouvent dans l’onglet **Recherche**.

Vous pouvez créer des fiches pour :

- les personnages ;
- les lieux ;
- les événements ;
- les organisations ;
- les objets ;
- les concepts ;
- les éléments d’univers ;
- les sources historiques ;
- les fils narratifs.

### Équivalence

| Aeon Timeline | Feuillets |
|---|---|
| Person | Fiche Personnage |
| Location | Fiche Lieu |
| Story Arc | Fil narratif |
| Project | Projet ou sous-intrigue |
| Item Type | Type de fiche Recherche |
| Entity Properties | Propriétés Markdown |
| Birth/Death | Naissance/Mort |
| Relationship | Propriété, tag ou lien |

Feuillets utilise des fichiers Markdown ordinaires, tandis qu’Aeon conserve ces éléments dans son propre modèle de données.

---

## 4. Retrouver les relations entre événements et entités

Dans Feuillets, vous utilisez principalement :

- les liens Markdown ;
- les propriétés ;
- les tags ;
- les personnages associés ;
- les lieux associés ;
- les fils narratifs ;
- les références de Recherche.

### Exemple

```yaml
---
personnages:
  - Kali
  - Deli
lieux:
  - Suvasa
fils:
  - disparition-des-janissaires
---
```

Ou directement dans le texte :

```markdown
Kali rejoint [[Deli]] dans les rues de [[Suvasa]].
```

Ces relations peuvent ensuite alimenter :

- la section Contexte de l’onglet Notes ;
- la Chronologie ;
- le Chemin de fer ;
- le Plan ;
- les recherches Obsidian ;
- les backlinks.

### Différence

Aeon Timeline possède un véritable modèle relationnel configurable avec des rôles.

Feuillets utilise un modèle plus simple, plus directement lisible dans les fichiers, mais moins sophistiqué pour les relations complexes.

---

## 5. Retrouver la Narrative View

Dans Feuillets, cette distinction est intégrée au projet.

### Ordre chronologique

La vue **Chronologie** classe les scènes selon leur date.

### Ordre narratif

Le **Classeur** et le manuscrit classent les mêmes scènes dans l’ordre de lecture.

Vous pouvez donc repérer :

- les retours en arrière ;
- les ellipses ;
- les anticipations ;
- les scènes racontées hors ordre ;
- les périodes absentes du récit.

### Exemple

Ordre chronologique :

```text
1815 — Mort de Deli
1820 — Arrivée de Kali
1826 — Attaque du tekke
```

Ordre narratif :

```text
Chapitre 1 — Attaque du tekke
Chapitre 2 — Souvenir de l’arrivée de Kali
Chapitre 3 — Révélation de la mort de Deli
```

Cette correspondance est l’un des domaines où Feuillets se rapproche le plus d’Aeon Timeline.

---

## 6. Retrouver les arcs narratifs

Dans Feuillets, vous utilisez les **fils narratifs**.

Un feuillet peut appartenir à un ou plusieurs fils :

```yaml
---
fils:
  - secret-hikmet
  - disparition-de-ramazan
  - enquete-de-kemal
---
```

La vue **Chemin de fer** permet ensuite de voir :

- où un fil apparaît ;
- où il disparaît ;
- les scènes qui le développent ;
- les fils parallèles ;
- les fils ouverts ;
- les fils résolus ;
- les éventuels trous narratifs.

### Équivalence

| Aeon Timeline | Feuillets |
|---|---|
| Story Arc | Fil narratif |
| Plotline | Fil ou sous-intrigue |
| Arc Relationship | Propriété `fils` |
| Grouped Timeline | Chemin de fer ou Chronologie filtrée |
| Arc comparison | Colonnes ou filtres par fil |

### Différence

Aeon Timeline peut afficher les arcs comme des entités reliées à tous leurs événements.

Feuillets les traite principalement comme des dimensions du manuscrit et de son organisation narrative.

---

## 7. Retrouver les personnages dans le temps

Feuillets propose également ce contrôle dans le section **Contexte** de l’onglet **Notes**.

Lorsqu’un feuillet possède une date et cite un personnage, Feuillets peut afficher :

```text
Kali
56 ans
```

Ou signaler une incohérence :

```text
⚠ Deli
Mort depuis 11 ans — en 1815
```

Il peut également détecter :

- un personnage pas encore né ;
- un âge impossible ;
- une présence postérieure à la mort ;
- un état historique incompatible ;
- la dernière information connue avant la date de la scène.

### Différence

Dans Aeon Timeline, ce calcul est intégré à la modélisation de l’ensemble des événements.

Dans Feuillets, il intervient directement pendant l’écriture du passage où le personnage est cité.

---

## 8. Retrouver les lieux et déplacements

Dans Feuillets, vous pouvez associer un lieu à chaque scène ou événement :

```yaml
---
date: 1826-06-15
lieu: Suvasa
---
```

Vous pouvez également créer des fiches de lieux dans Recherche et les relier au texte.

La section Contexte de l’onglet Notes peut ensuite afficher la fiche du lieu lorsque son nom ou son alias apparaît dans le passage.

### Limite honnête

Feuillets ne possède pas nécessairement un moteur aussi avancé qu’Aeon Timeline pour calculer automatiquement :

- les déplacements successifs ;
- les distances ;
- les incompatibilités de présence dans deux lieux ;
- les temps de trajet ;
- la position de plusieurs personnages à chaque instant.

Ces contrôles doivent encore être gérés à l’aide de propriétés, de fiches, de filtres ou d’une vérification manuelle.

---

## 9. Retrouver les calendriers personnalisés

Feuillets utilise principalement les dates stockées dans les propriétés Markdown et les formats reconnus par son moteur chronologique.

### Feuillets convient bien pour :

- les dates calendaires ordinaires ;
- les années seules ;
- les scènes historiques ;
- les récits contemporains ;
- les chronologies narratives classiques ;
- certaines dates partielles.

### Aeon Timeline reste supérieur pour :

- les calendriers entièrement inventés ;
- les ères complexes ;
- les dates avant notre ère très détaillées ;
- les chronologies astronomiques ;
- les précisions temporelles variables ;
- les systèmes sans calendrier grégorien.

Ce point constitue l’une des principales raisons de conserver Aeon Timeline pour certains projets.

---

## 10. Retrouver les durées

Dans Feuillets, une scène peut également posséder plusieurs propriétés temporelles :

```yaml
---
date: 1826-06-15
date_fin: 1826-06-16
heure: "22:30"
duree: "4 heures"
---
```

La Chronologie peut alors utiliser ces informations lorsqu’elles sont prises en charge par la configuration du projet.

### Différence

Aeon Timeline est conçu pour manipuler finement les durées, les chevauchements et les distances temporelles.

Feuillets traite surtout les dates comme des informations narratives liées aux scènes.

---

## 11. Retrouver les dépendances

Dans Feuillets, l’ordre narratif est assuré par le Classeur et l’ordre chronologique par les dates.

Vous pouvez représenter certaines dépendances avec :

- des propriétés ;
- des liens ;
- des fils narratifs ;
- des notes ;
- des statuts ;
- les scènes précédentes et suivantes.

### Exemple

```yaml
---
depend_de:
  - Découverte du carnet
prépare:
  - Confrontation avec Ramazan
---
```

### Limite honnête

Feuillets ne possède pas nécessairement un véritable moteur de dépendances capable de déplacer automatiquement tous les événements liés lorsqu’une date change.

Aeon Timeline reste supérieur pour ce type de planification dynamique.

---

## 12. Retrouver la Relationship View

Feuillets répartit cette fonction entre plusieurs outils :

- les backlinks d’Obsidian ;
- le graphe ;
- les propriétés ;
- les liens Markdown ;
- les fiches Recherche ;
- le Chemin de fer ;
- la Chronologie ;
- la section Contexte de l’onglet Notes ;
- Canvas.

### Pour voir les liens d’une fiche

Ouvrez la fiche Personnage ou Lieu et consultez ses backlinks.

### Pour explorer visuellement les relations

Utilisez Canvas ou le graphe local.

### Pour voir les relations narratives

Utilisez le Chemin de fer.

### Pour voir les relations temporelles

Utilisez la Chronologie.

### Différence

Aeon Timeline fournit une représentation relationnelle unifiée.

Feuillets s’appuie sur plusieurs vues complémentaires de l’écosystème Obsidian.

---

## 13. Retrouver la Subway View

Dans Feuillets, la fonction la plus proche est le **Chemin de fer**.

Cette vue peut représenter :

- les fils narratifs ;
- les personnages point de vue ;
- les intrigues ;
- les lieux ;
- les statuts ;
- les scènes dans l’ordre du manuscrit.

### Différence

La Subway View d’Aeon est construite autour des relations entre entités et événements.

Le Chemin de fer de Feuillets est construit autour des scènes du manuscrit.

Il est donc particulièrement adapté à la vérification narrative, mais moins généraliste.

---

## 14. Retrouver la Spreadsheet View

Dans Feuillets, l’équivalent est la vue **Plan**.

Elle peut afficher notamment :

- titre ;
- date ;
- synopsis ;
- personnages ;
- lieu ;
- statut ;
- label ;
- fils narratifs ;
- nombre de mots ;
- objectif ;
- progression ;
- tags.

Cette vue permet de contrôler de nombreuses scènes sans les ouvrir une à une.

---

## 15. Retrouver l’Outline View

Dans Feuillets, cette fonction est assurée par le **Classeur**.

Vous pouvez structurer :

```text
Partie I
├── Chapitre 1
│   ├── Scène A
│   └── Scène B
└── Chapitre 2
    ├── Scène C
    └── Scène D
```

Le Classeur représente directement l’ordre narratif et la structure du livre.

---

## 16. Retrouver la Mindmap View

Dans Feuillets, utilisez **Canvas**, le système natif d’Obsidian.

Canvas permet de placer librement :

- des scènes ;
- des personnages ;
- des lieux ;
- des événements ;
- des images ;
- des idées ;
- des fichiers ;
- des groupes ;
- des liens.

### Avantage de Feuillets

Les cartes Canvas peuvent référencer directement les vrais fichiers Markdown du projet.

### Avantage d’Aeon Timeline

La Mindmap est reliée à son modèle structuré d’événements et d’entités, sans travail manuel de liaison.

---

## 17. Retrouver le split screen

Obsidian permet également d’ouvrir plusieurs volets.

Vous pouvez par exemple afficher :

- la Chronologie et le manuscrit ;
- le Chemin de fer et une scène ;
- une fiche Personnage et le texte ;
- la Chronologie et le Plan ;
- le manuscrit et son Aperçu ;
- une fiche historique et le passage en cours.

Vous pouvez enregistrer cette disposition comme espace de travail Obsidian.

---

## 18. Retrouver les notes, tags et propriétés

Dans Feuillets, ces informations sont stockées dans :

- le corps Markdown ;
- le frontmatter YAML ;
- l’onglet Notes ;
- la section Propriétés de l’onglet Notes ;
- les fiches Recherche.

### Exemple

```yaml
---
date: 1826-06-15
statut: brouillon
label: tension
tags:
  - janissaires
  - suvasa
fils:
  - attaque-du-tekke
point_de_vue: Kali
---
```

Elles restent lisibles même sans Feuillets.

---

## 19. Retrouver les pièces jointes

Dans Feuillets, vous pouvez utiliser :

- les pièces jointes d’Obsidian ;
- les images Markdown ;
- les liens vers des PDF ;
- les liens vers des sites ;
- les fiches Sources ;
- les documents placés dans Recherche ;
- les fichiers du dossier Ressources.

Une même pièce jointe peut être reliée à plusieurs scènes ou événements.

---

## 20. Retrouver la recherche et les filtres

Dans Feuillets, vous disposez de :

- la recherche Obsidian ;
- la recherche de l’onglet Recherche ;
- les filtres par tag ;
- les filtres par statut ;
- les filtres par label ;
- les filtres par fil narratif ;
- les filtres chronologiques ;
- le Plan ;
- les vues personnalisées du manuscrit.

### Différence

Aeon Timeline peut rechercher et regrouper tous les éléments de son modèle dans une même application.

Feuillets combine ses propres filtres avec ceux d’Obsidian.

---

## 21. Retrouver la synchronisation avec Scrivener ou Ulysses

Dans Feuillets, cette synchronisation n’est plus nécessaire lorsque le manuscrit est rédigé directement dans Obsidian.

La scène, ses propriétés et sa position existent déjà dans le même projet.

### Avec Aeon Timeline

```text
Scrivener ou Ulysses
→ synchronisation
→ événement Aeon
→ modification
→ nouvelle synchronisation
```

### Avec Feuillets

```text
Feuillet
→ propriétés temporelles
→ Chronologie
→ ordre narratif
→ rédaction
```

Il n’existe plus deux représentations séparées de la même scène.

---

## 22. Retrouver l’intégration avec le manuscrit

Dans Feuillets, la chronologie et le texte appartiennent au même environnement.

Vous pouvez :

- ouvrir une scène depuis la Chronologie ;
- modifier son texte ;
- changer sa date ;
- mettre à jour ses personnages ;
- vérifier son synopsis ;
- voir son ordre narratif ;
- relire son chapitre ;
- exporter le manuscrit.

C’est le principal avantage de Feuillets pour un auteur qui ne souhaite plus maintenir plusieurs logiciels.

---

## 23. Retrouver les contrôles de continuité

Feuillets reprend une partie de cette logique directement dans le section **Contexte** de l’onglet **Notes**.

Pendant que vous écrivez, il peut afficher :

- la date de la scène ;
- l’âge d’un personnage ;
- son dernier état connu ;
- un événement historique proche ;
- une fiche liée au passage ;
- un personnage déjà mort ;
- un personnage pas encore né ;
- un objet anachronique ;
- une technique inexistante à cette date.

### Exemple

```text
15 juin 1826

⚠ Deli
Mort depuis 11 ans — en 1815

Élimination du corps des janissaires
Le sultan Mahmud II supprime ce corps militaire…
```

Feuillets transforme ainsi la chronologie en outil actif pendant la rédaction, et pas uniquement en vue de planification.

---

## 24. Retrouver les calendriers de personnages

Dans Feuillets, vous pouvez retrouver ses apparitions grâce à :

- ses backlinks ;
- les liens dans le manuscrit ;
- les propriétés `personnages` ;
- les tags ;
- la recherche dans le projet ;
- le Plan ;
- la Chronologie filtrée ;
- le Chemin de fer.

### Exemple

Filtrer la Chronologie sur `Kali` permet de suivre :

- sa première apparition ;
- ses déplacements ;
- les événements auxquels il participe ;
- son évolution dans le temps ;
- les éventuelles périodes incohérentes.

---

## 25. Retrouver la comparaison de plusieurs chronologies

Dans Feuillets, vous pouvez approcher ce workflow avec :

- des filtres par personnages ;
- des filtres par fils ;
- des tags ;
- le Chemin de fer ;
- plusieurs projets Feuillets ;
- différentes Chronologies ;
- le Plan.

### Limite

Feuillets est moins adapté à la comparaison de nombreuses chronologies totalement indépendantes ou de projets non narratifs complexes.

Aeon Timeline reste plus généraliste.

---

## 26. Retrouver les modèles

Feuillets utilise :

- des modes de projet ;
- des modèles de fiches Recherche ;
- des propriétés Markdown ;
- des dossiers Template ;
- des configurations de vues ;
- des modèles d’export.

### Exemple de modèle Personnage

```markdown
---
type: personnage
naissance:
mort:
lieux:
tags:
---

# Nom

## Description

## Chronologie

## Relations

## Notes
```

### Différence

Aeon Timeline permet de configurer son modèle de données de manière beaucoup plus structurée.

Feuillets s’appuie sur des modèles Markdown plus ouverts, mais moins stricts.

---

## 27. Retrouver les sauvegardes

Feuillets propose :

- des instantanés de feuillets ;
- des instantanés du projet ;
- des sauvegardes automatiques ;
- une comparaison de versions ;
- une restauration ;
- les sauvegardes du coffre ;
- Git ou tout autre système externe.

Les fichiers restent directement accessibles dans le système de fichiers.

---

## 28. Retrouver l’utilisation sur plusieurs appareils

Feuillets fonctionne dans Obsidian sur ordinateur et, selon les fonctions concernées, sur mobile.

### Avantage Aeon Timeline

- interface mobile dédiée ;
- chronologie tactile ;
- application autonome ;
- expérience cohérente.

### Avantage Feuillets

- mêmes fichiers Markdown ;
- compatibilité avec Obsidian Sync ou un autre système ;
- pas de fichier temporel séparé du manuscrit.

Les fonctions les plus complexes de Feuillets peuvent toutefois être plus confortables sur ordinateur.

---

## 29. Retrouver l’export et le partage

Feuillets peut exporter :

- le manuscrit ;
- les données Markdown ;
- les tableaux ou vues selon leurs capacités ;
- les documents compilés ;
- les chronologies sous une forme documentaire selon le workflow choisi.

### Limite

Feuillets ne possède pas nécessairement un équivalent direct au fichier Aeon partageable et interactif en lecture seule.

Pour partager la chronologie, vous pouvez produire :

- un export Markdown ;
- un PDF ;
- une capture ou mosaïque ;
- un tableau ;
- un coffre Obsidian partagé.

---

# Workflow quotidien équivalent

## Dans Aeon Timeline avec Scrivener

```text
Ouvrir la chronologie
→ ajouter ou déplacer un événement
→ associer personnages, lieux et arcs
→ vérifier dates et âges
→ réordonner la Narrative View
→ synchroniser avec Scrivener
→ ouvrir Scrivener
→ écrire la scène
→ resynchroniser
```

## Dans Feuillets

```text
Ouvrir le projet
→ créer ou sélectionner un feuillet
→ ajouter sa date et ses propriétés
→ l’observer dans la Chronologie
→ vérifier son ordre dans le Classeur
→ associer personnages, lieux et fils
→ écrire la scène
→ consulter les alertes de la section Contexte de l’onglet Notes
```

La chronologie n’est plus une étape séparée du travail d’écriture.

---

# Workflow de préparation d’un roman

## Avec Aeon Timeline

```text
Créer les événements
→ créer les personnages et lieux
→ relier les événements aux entités
→ définir les arcs
→ organiser la Narrative View
→ synchroniser avec le logiciel d’écriture
```

## Avec Feuillets

```text
Créer les fiches Recherche
→ construire les événements ou scènes
→ attribuer dates, personnages, lieux et fils
→ comparer Chronologie et Classeur
→ organiser le manuscrit
→ écrire directement dans les feuillets
```

---

# Ce que vous gagnez en passant à Feuillets

## Un projet unique

Le manuscrit, la chronologie, les personnages et la documentation se trouvent dans le même coffre.

## Aucune synchronisation intermédiaire

Vous ne devez plus maintenir une scène dans Aeon et un document correspondant dans un autre logiciel.

## Une chronologie reliée au texte réel

Chaque scène de la Chronologie peut ouvrir directement le passage écrit.

## Un contrôle pendant la rédaction

Les incohérences apparaissent dans la section Contexte de l’onglet Notes au moment où le personnage, l’objet ou l’événement est cité.

## Des fichiers ouverts

Les données importantes sont stockées dans des fichiers Markdown lisibles sans Feuillets.

## L’écosystème Obsidian

Vous bénéficiez de :

- Canvas ;
- backlinks ;
- graphe ;
- propriétés ;
- modèles ;
- recherche ;
- plugins ;
- Git ;
- synchronisation au choix.

## Le cycle complet du livre

Après la chronologie, vous pouvez continuer avec :

- rédaction ;
- révision ;
- instantanés ;
- lecture continue ;
- aperçu ;
- compilation ;
- export.

---

# Ce que vous perdez ou changez

## Un moteur temporel spécialisé

Aeon Timeline reste plus puissant pour :

- les calendriers personnalisés ;
- les dates très anciennes ou très éloignées ;
- les chronologies relatives ;
- les précisions temporelles variables ;
- les durées complexes ;
- les dépendances ;
- les déplacements automatiques d’événements liés.

## Un modèle relationnel formel

Aeon permet de définir précisément les types d’entités, les rôles et les relations.

Feuillets repose davantage sur les propriétés, tags et liens Markdown.

## Des visualisations spécialisées

Aeon propose plusieurs vues dédiées :

- Timeline ;
- Relationship ;
- Subway ;
- Narrative ;
- Spreadsheet ;
- Outline ;
- Mindmap.

Feuillets couvre plusieurs de ces besoins, mais pas toujours avec le même degré de profondeur ou dans une interface unifiée.

## La comparaison avancée de chronologies

Pour des projets historiques, scientifiques, familiaux ou professionnels complexes, Aeon Timeline reste souvent mieux adapté.

## Une application mobile spécialisée

L’expérience de la chronologie sur iPad ou iPhone peut être plus aboutie dans Aeon.

---

# Feuillets peut-il réellement remplacer Aeon Timeline ?

## Oui, probablement, lorsque vous utilisez Aeon principalement pour :

- dater les scènes d’un roman ;
- distinguer ordre narratif et ordre chronologique ;
- suivre les personnages ;
- vérifier leur âge ;
- suivre les arcs ou sous-intrigues ;
- placer des événements historiques ;
- détecter quelques incohérences ;
- préparer une structure avant de rédiger ;
- synchroniser ensuite cette structure avec Scrivener ou Ulysses.

Dans ce cas, Feuillets peut simplifier le workflow en réunissant planification et rédaction.

## Feuillets peut même être plus adapté lorsque vous souhaitez :

- écrire directement depuis la chronologie ;
- ne plus synchroniser plusieurs logiciels ;
- relier les fiches Recherche au texte ;
- faire apparaître les alertes pendant l’écriture ;
- conserver le manuscrit en Markdown ;
- passer immédiatement de la planification à la composition du livre.

## Aeon Timeline reste probablement préférable lorsque vous avez besoin de :

- calendriers fantastiques élaborés ;
- dates avant notre ère complexes ;
- événements couvrant de très longues périodes ;
- dépendances temporelles avancées ;
- relations formelles avec des rôles personnalisés ;
- analyses de déplacements ;
- comparaison de nombreuses chronologies ;
- projets historiques ou professionnels non centrés sur un manuscrit ;
- visualisations relationnelles très poussées.

---

# Méthode de transition recommandée

## 1. Ne supprimez pas votre chronologie Aeon

Conservez le fichier d’origine comme référence jusqu’à validation complète.

## 2. Exportez les données

Exportez notamment :

- les événements ;
- les dates ;
- les résumés ;
- les personnages ;
- les lieux ;
- les arcs ;
- les tags ;
- les propriétés utiles.

## 3. Distinguez scènes et événements

Classez les éléments exportés en deux groupes :

- scènes destinées au manuscrit ;
- événements historiques ou de contexte.

Les scènes deviendront des feuillets.

Les autres événements deviendront des fiches Recherche ou des jalons.

## 4. Recréez les personnages et lieux

Transformez les entités Aeon en fiches Recherche :

```text
Person → Personnage
Location → Lieu
Story Arc → Fil narratif
Event → Scène ou événement
```

## 5. Recréez les relations essentielles

Convertissez uniquement les relations qui servent réellement au manuscrit :

- personnages présents ;
- lieu ;
- fil narratif ;
- date ;
- point de vue ;
- dépendances importantes.

Évitez de recopier mécaniquement toutes les propriétés si elles ne seront jamais utilisées pendant l’écriture.

## 6. Vérifiez la Chronologie

Contrôlez :

- l’ordre des scènes ;
- les dates ;
- les événements simultanés ;
- les retours en arrière ;
- les âges ;
- les décès ;
- les jalons historiques.

## 7. Vérifiez le Classeur

L’ordre du Classeur doit correspondre à la Narrative View d’Aeon.

## 8. Testez un personnage

Choisissez un personnage et vérifiez :

- toutes ses apparitions ;
- son âge ;
- sa date de naissance ;
- sa date de mort ;
- les alertes éventuelles.

## 9. Testez un arc narratif

Choisissez un arc et vérifiez sa continuité dans le Chemin de fer.

## 10. Travaillez en parallèle

Utilisez Feuillets pendant plusieurs scènes avant d’abandonner Aeon Timeline.

---

# Tableau de correspondance rapide

| Fonction Aeon Timeline | Équivalent Feuillets |
|---|---|
| Timeline View | Chronologie |
| Narrative View | Classeur et ordre du manuscrit |
| Event | Scène datée ou événement Recherche |
| Entity | Fiche Recherche |
| Person | Personnage |
| Location | Lieu |
| Story Arc | Fil narratif |
| Relationship | Propriété, lien ou tag |
| Character Age | Âge dans le Contexte |
| Death Warning | Alerte chronologique |
| Spreadsheet View | Plan |
| Outline View | Classeur |
| Subway View | Chemin de fer |
| Mindmap View | Canvas |
| Relationship View | Backlinks, Canvas et graphe |
| Inspector | Notes et Propriétés |
| Notes | Notes de travail ou corps de fiche |
| Tags | Tags |
| Custom Properties | Propriétés YAML |
| Narrative Order | Ordre du Classeur |
| Chronological Order | Chronologie |
| Scrivener Sync | Projet unique, sans synchronisation |
| Ulysses Sync | Projet unique, sans synchronisation |
| CSV Export | Import ou conversion des données |
| Timeline File | Dossier de projet Markdown |

---

# Verdict

Feuillets ne remplace pas Aeon Timeline en tant que moteur chronologique universel.

Il reprend cependant les fonctions les plus utiles à un auteur :

- scènes datées ;
- événements ;
- personnages ;
- lieux ;
- arcs narratifs ;
- ordre chronologique ;
- ordre du récit ;
- âges ;
- morts ;
- alertes de continuité ;
- vues globales du manuscrit.

Il les intègre directement au travail d’écriture.

La question n’est donc pas seulement :

> « Feuillets peut-il produire une chronologie aussi sophistiquée qu’Aeon Timeline ? »

Pour les calendriers complexes et les relations temporelles avancées, pas entièrement.

La question utile est plutôt :

> « Ai-je encore besoin d’une application séparée pour gérer la chronologie de mon roman ? »

Pour un auteur qui utilise Aeon Timeline essentiellement comme compagnon de Scrivener ou d’Ulysses, la réponse peut désormais être **non**.

Pour un utilisateur qui exploite Aeon comme véritable base temporelle et relationnelle complexe, Feuillets peut remplacer le volet narratif du workflow, mais Aeon Timeline conserve une valeur propre.
