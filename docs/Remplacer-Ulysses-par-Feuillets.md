# Remplacer Ulysses par Feuillets

Vous utilisez Ulysses pour écrire dans une interface épurée, organiser vos textes en groupes et feuilles, suivre vos objectifs puis exporter un document propre.

Vous vous demandez si Feuillets peut reprendre ce workflow dans Obsidian sans transformer votre environnement d’écriture en système compliqué.

La réponse honnête est : **oui, en particulier pour les livres, recueils et projets documentés**, mais la transition est différente de celle d’un utilisateur de Scrivener.

Ulysses privilégie une bibliothèque unifiée, une excellente intégration à l’écosystème Apple et une expérience très homogène. Feuillets privilégie des fichiers Markdown accessibles, une structure de manuscrit plus explicite et des outils avancés de planification, de documentation et de continuité.

---

## 1. Retrouver la bibliothèque Ulysses

Dans Ulysses, tous les textes sont regroupés dans une bibliothèque centrale composée de projets, groupes, filtres et feuilles.

Dans Feuillets, vous travaillez dans un **coffre Obsidian** contenant un ou plusieurs projets d’écriture.

Chaque projet peut comprendre :

- un manuscrit ;
- des parties ;
- des chapitres ;
- des feuillets ;
- une Recherche ;
- des ressources ;
- des images ;
- des modèles ;
- des exports ;
- des sauvegardes.

### Équivalences principales

| Ulysses | Feuillets |
|---|---|
| Bibliothèque | Coffre Obsidian |
| Projet | Projet Feuillets |
| Groupe | Dossier |
| Feuille | Feuillet |
| Feuille de matériel | Document Recherche ou feuillet exclu |
| Filtre | Filtre, sélection ou vue du projet |
| Corbeille | Corbeille ou suppression Obsidian |

La différence essentielle est que la bibliothèque native de Ulysses est gérée par l’application, tandis que Feuillets s’appuie sur de vrais dossiers et fichiers Markdown visibles dans Obsidian et dans le système de fichiers.

---

## 2. Retrouver les Projects

Dans Ulysses, un Project constitue un espace autonome avec son contenu principal, ses éléments supplémentaires, ses mots-clés et son style d’export préféré.

Dans Feuillets, un projet regroupe également :

- le manuscrit ;
- sa documentation ;
- ses réglages ;
- ses modèles ;
- ses objectifs ;
- ses sauvegardes ;
- ses paramètres de composition.

Vous pouvez :

- créer un projet vide ;
- transformer un dossier Markdown existant en projet ;
- ouvrir plusieurs projets dans le même coffre ;
- importer un plan ;
- importer un projet Scrivener ;
- utiliser un projet de démonstration.

### Différence

Un projet Ulysses reste intégré à la bibliothèque Ulysses.

Un projet Feuillets reste un dossier ordinaire. Même sans le plugin, ses fichiers Markdown demeurent accessibles.

---

## 3. Retrouver les groupes

Dans Ulysses, les groupes servent à organiser les feuilles. Ils peuvent représenter un livre, une partie, un chapitre, une catégorie ou une archive.

Dans Feuillets, les **dossiers** jouent ce rôle.

Vous pouvez organiser un livre ainsi :

```text
Mon roman
├── Partie I
│   ├── Chapitre 1
│   │   ├── Scène 1.md
│   │   └── Scène 2.md
│   └── Chapitre 2
├── Partie II
└── Recherche
```

Feuillets comprend la hiérarchie du manuscrit et peut l’utiliser dans :

- le Classeur ;
- les Cartes ;
- le Plan ;
- la Lecture ;
- la Chronologie ;
- le Chemin de fer ;
- l’Aperçu ;
- la composition finale.

### Différence

Ulysses autorise une organisation très libre par groupes.

Feuillets reste libre, mais comprend aussi la fonction éditoriale de certains niveaux : partie, chapitre, scène, document de recherche.

---

## 4. Retrouver les Sheets

La feuille est l’unité fondamentale de Ulysses.

Dans Feuillets, l’unité équivalente est le **feuillet**.

Un feuillet peut représenter :

- une scène ;
- un article ;
- un chapitre court ;
- une section ;
- un fragment ;
- une préface ;
- une note destinée à la compilation ;
- tout document que vous souhaitez déplacer, relire ou exporter séparément.

Vous pouvez :

- créer un feuillet ;
- le déplacer ;
- le renommer ;
- le dupliquer ;
- le scinder ;
- le fusionner avec d’autres feuillets ;
- l’exclure d’une compilation ;
- lui attribuer un titre d’affichage distinct du nom du fichier.

---

## 5. Retrouver l’écriture épurée

Ulysses est connu pour son éditeur en texte enrichi par une syntaxe légère et pour la séparation entre rédaction et mise en forme finale.

Feuillets conserve le même principe général :

- texte en Markdown ;
- largeur de rédaction contrôlée ;
- syntaxe rendue discrète ;
- typographie personnalisable ;
- paragraphes présentés comme dans un manuscrit ;
- titres rendus ;
- aides à la typographie française ;
- mode Concentration.

### Dans Ulysses

Vous écrivez dans une feuille avec la syntaxe de balisage de l’application.

### Dans Feuillets

Vous écrivez dans un fichier Markdown standard avec l’éditeur natif d’Obsidian.

Le texte reste utilisable dans :

- Obsidian ;
- un éditeur Markdown ;
- Git ;
- un script ;
- une autre application compatible ;
- un futur outil qui n’existe pas encore.

---

## 6. Retrouver le mode éditeur seul

Ulysses permet de passer entre une vue à trois panneaux, deux panneaux ou éditeur seul.

Dans Feuillets, vous pouvez :

- masquer les panneaux latéraux d’Obsidian ;
- utiliser le mode Concentration ;
- réduire l’interface ;
- activer le défilement machine à écrire ;
- atténuer les paragraphes éloignés ;
- conserver un compteur de mots discret.

### Équivalence

| Ulysses | Feuillets |
|---|---|
| Editor Only | Mode Concentration |
| Sheet List + Editor | Classeur + Écriture |
| Library + Sheet List + Editor | Classeur complet + Écriture |
| Full Screen | Plein écran Obsidian ou Concentration |

Ulysses reste plus immédiatement homogène sur ce point. Feuillets offre davantage de réglages, mais ceux-ci doivent être configurés selon vos préférences.

---

## 7. Retrouver les mots-clés

Dans Feuillets, vous utilisez principalement :

- les tags ;
- les labels ;
- les statuts ;
- les fils narratifs ;
- les propriétés personnalisées.

### Exemples

```yaml
---
tags:
  - personnage/Kemal
  - lieu/Suvasa
  - theme/memoire
statut: revision
label: tension
fil:
  - secret-hikmet
---
```

Ces informations peuvent être utilisées dans :

- le Classeur ;
- les Cartes ;
- le Plan ;
- le Chemin de fer ;
- la Chronologie ;
- les recherches ;
- les filtres ;
- la compilation.

### Différence

Ulysses possède un gestionnaire de mots-clés central particulièrement simple.

Feuillets bénéficie de la souplesse des tags et propriétés Obsidian, mais permet aussi de distinguer plusieurs fonctions : thème, statut éditorial, fil narratif, personnage, lieu ou catégorie.

---

## 8. Retrouver les filtres

Dans Feuillets, plusieurs mécanismes couvrent ce besoin :

- filtrage par tag ;
- filtrage par statut ;
- filtrage par label ;
- filtrage par progression ;
- sélection manuelle de feuillets ;
- recherche dans le manuscrit ;
- recherche Obsidian ;
- vues du Plan ;
- vues du Chemin de fer ;
- portée personnalisée de lecture ou d’export.

### Exemple

Pour retrouver toutes les scènes liées à un personnage :

```text
tag : personnage/Kemal
```

Pour isoler les scènes à reprendre :

```text
statut : à réviser
```

Pour suivre un fil narratif :

```text
fil : secret-hikmet
```

Feuillets ne reproduit pas nécessairement l’objet « filtre » de Ulysses à l’identique. Il couvre le besoin à travers ses vues, ses propriétés et les fonctions natives d’Obsidian.

---

## 9. Retrouver les Material Sheets

Ulysses permet de marquer une feuille comme matériel. Elle reste dans le projet, mais elle est exclue par défaut des exports, des statistiques et des objectifs.

Dans Feuillets, vous disposez de plusieurs solutions :

- placer la documentation dans **Recherche** ;
- exclure un feuillet de la compilation ;
- utiliser un dossier non compilé ;
- sélectionner précisément les feuillets à exporter ;
- créer une note de travail dans le panneau Notes.

### Équivalence

| Ulysses | Feuillets |
|---|---|
| Material Sheet | Fiche Recherche |
| Material Sheet dans un groupe | Feuillet exclu |
| Extra du projet | Dossier Recherche ou Ressources |
| Exclusion automatique de l’export | Exclusion de compilation |

Feuillets distingue plus clairement les documents destinés au manuscrit des documents servant à le préparer.

---

## 10. Retrouver le Dashboard

Dans Ulysses, le Dashboard rassemble notamment les mots-clés, les objectifs, les statistiques et les pièces jointes de la feuille active.

Dans Feuillets, ces informations sont réparties entre plusieurs panneaux :

### Notes

- synopsis ;
- résumé ;
- notes de travail ;
- sources ;
- contexte automatique ;
- notes de dossier ;
- plan du document.

### Propriétés

- tags ;
- statut ;
- label ;
- date ;
- objectif ;
- métadonnées personnalisées.

### Statistiques

- nombre de mots ;
- progression ;
- objectifs ;
- historique d’écriture.

### Recherche

- personnages ;
- lieux ;
- événements ;
- concepts ;
- sources ;
- bibliographie ;
- glossaire.

Cette séparation rend Feuillets plus riche, mais moins compact que le Dashboard de Ulysses.

---

## 11. Retrouver les notes et pièces jointes

Dans Feuillets, vous pouvez utiliser :

- les notes de travail du panneau Notes ;
- les fiches Recherche ;
- les images du coffre ;
- les liens Markdown ;
- les notes de bas de page ;
- les commentaires Markdown ou HTML ;
- les pièces jointes Obsidian ;
- les Canvas ;
- les notes de chapitre ou de partie.

### Différence

Dans Ulysses, les pièces jointes sont rattachées à une feuille dans l’environnement de l’application.

Dans Feuillets, elles restent des fichiers ou notes identifiables dans le coffre, pouvant être reliés à plusieurs scènes et réutilisés ailleurs.

---

## 12. Retrouver la consultation côte à côte

Obsidian permet naturellement d’ouvrir plusieurs volets.

Dans Feuillets, vous pouvez afficher :

- le manuscrit à gauche et une fiche Recherche à droite ;
- deux feuillets côte à côte ;
- le texte et son Aperçu ;
- deux versions ;
- une scène et une chronologie ;
- le manuscrit et un Canvas ;
- le texte et un document PDF.

Vous pouvez aussi utiliser l’aperçu rapide d’une fiche sans quitter le passage en cours.

---

## 13. Retrouver la documentation liée au texte

Dans Ulysses, l’auteur organise manuellement ses extras, ses feuilles de matériel, ses notes et ses mots-clés.

Feuillets ajoute une fonction plus contextuelle : le panneau **Contexte**.

Pendant que vous écrivez, Feuillets peut afficher automatiquement :

- les personnages cités dans le paragraphe courant ;
- les lieux mentionnés ;
- les événements liés ;
- les fiches reconnues par leur titre, alias ou tags ;
- les documents dont le contenu correspond au passage ;
- l’âge d’un personnage à la date de la scène ;
- son dernier état historique connu ;
- les incohérences chronologiques ;
- les objets anachroniques.

### Exemple

Vous écrivez :

> Les marchands déchargèrent leurs tissus et leurs épices.

Une fiche associée contient :

> Les caravanes transportent des épices et des tissus précieux entre les villes du Hedjaz.

Feuillets peut faire apparaître cette fiche sous **Documents associés**, même si son titre n’est pas écrit dans le passage.

C’est l’une des principales différences entre les deux outils :

> **Ulysses affiche les éléments que vous avez classés avec la feuille.  
> Feuillets peut aussi retrouver ceux que le passage rend pertinents.**

---

## 14. Retrouver les favoris ou références importantes

Dans Feuillets, les éléments importants du contexte peuvent être **épinglés**.

Une fiche épinglée :

- reste visible malgré les déplacements du curseur ;
- reste propre au feuillet actif ;
- ne se répète pas dans les autres sections ;
- peut être prévisualisée ou ouverte.

Cela peut servir à conserver sous les yeux :

- un personnage ;
- un lieu ;
- une règle d’univers ;
- une source ;
- une chronologie ;
- un détail historique ;
- une contrainte narrative.

---

## 15. Retrouver les objectifs d’écriture

Feuillets propose :

- un objectif par feuillet ;
- un objectif de projet ;
- le nombre de mots ;
- la progression ;
- des statistiques détaillées ;
- un calendrier d’écriture ;
- un journal quotidien ;
- l’historique du travail.

### Différence

Ulysses dispose d’un système d’objectifs très abouti, immédiatement visible et particulièrement élégant.

Feuillets ajoute une dimension qualitative avec le journal d’écriture :

- objectif de la séance ;
- problème rencontré ;
- décision narrative ;
- solution envisagée ;
- bilan ;
- état du projet.

---

## 16. Retrouver les statistiques

Feuillets permet de suivre notamment :

- les mots d’un feuillet ;
- les mots d’un chapitre ;
- les mots du manuscrit ;
- les objectifs ;
- la progression ;
- les jours d’écriture ;
- les entrées du journal ;
- diverses mesures de texte.

Feuillets se concentre davantage sur le projet long, tandis que Ulysses excelle dans la simplicité du suivi quotidien.

---

## 17. Retrouver la navigation par plan

Dans Feuillets, le panneau **Plan** du feuillet affiche les titres Markdown du document :

```markdown
# Chapitre

## Première section

### Un souvenir

## Retour au présent
```

Vous pouvez cliquer sur un titre pour atteindre directement la section correspondante.

Pour la structure générale du livre, utilisez :

- le Classeur ;
- les Cartes ;
- le Plan du manuscrit ;
- la Lecture ;
- l’Aperçu.

---

## 18. Retrouver l’organisation d’un livre

Ulysses repose principalement sur les groupes et l’ordre des feuilles.

Feuillets ajoute plusieurs représentations du même manuscrit.

### Classeur

Pour naviguer dans les parties, chapitres et scènes.

### Cartes

Pour réorganiser visuellement les feuillets.

### Plan

Pour examiner les synopsis, statuts, mots et propriétés dans un tableau.

### Chemin de fer

Pour suivre les fils narratifs, les points de vue et les statuts.

### Chronologie

Pour comparer l’ordre des événements et l’ordre du récit.

### Lecture

Pour lire plusieurs feuillets en continu.

### Aperçu

Pour voir le manuscrit composé avec ses titres, séparateurs et styles.

Ulysses cherche à réduire le nombre de représentations. Feuillets en propose davantage pour les projets qui deviennent complexes.

---

## 19. Retrouver le déplacement des feuilles

Dans Feuillets, vous pouvez :

- déplacer un feuillet ;
- le réordonner ;
- le glisser vers un autre chapitre ;
- le ramener à la racine du projet ;
- déplacer plusieurs feuillets ;
- fusionner plusieurs scènes ;
- scinder une scène ;
- annuler certains déplacements.

L’ordre du Classeur devient l’ordre de lecture et peut être utilisé pour la composition.

---

## 20. Retrouver les versions et sauvegardes

Feuillets propose explicitement :

- des instantanés du feuillet ;
- des instantanés du projet ;
- des copies datées ;
- une comparaison entre versions ;
- une restauration ;
- une sauvegarde de la configuration ;
- la possibilité d’utiliser Git ou les sauvegardes du coffre.

Les fichiers Markdown peuvent en outre être sauvegardés par :

- iCloud ;
- Dropbox ;
- Git ;
- Syncthing ;
- un disque externe ;
- tout système compatible avec Obsidian.

---

## 21. Retrouver la synchronisation Apple

Feuillets n’impose pas un service de synchronisation.

Vous pouvez choisir :

- Obsidian Sync ;
- iCloud Drive ;
- Dropbox ;
- Syncthing ;
- Git ;
- une autre solution compatible avec le coffre.

### Conséquence

Ulysses offre une expérience Apple plus intégrée et plus simple à configurer.

Feuillets offre davantage de choix et n’impose pas une plateforme unique, mais la fiabilité dépend du système de synchronisation choisi.

---

## 22. Retrouver les dossiers externes

Dans Feuillets, ce fonctionnement n’est pas secondaire : le projet est déjà un dossier de fichiers ordinaires.

Vous pouvez donc :

- ouvrir le projet dans Finder ;
- modifier un fichier dans un autre éditeur ;
- placer le projet sous Git ;
- utiliser des scripts ;
- sauvegarder le dossier librement ;
- accéder aux images et ressources sans export préalable.

---

## 23. Retrouver l’export rapide

Dans Feuillets, vous pouvez compiler ou exporter :

- le feuillet actif ;
- un dossier ;
- un chapitre ;
- une partie ;
- le manuscrit complet ;
- un ensemble de feuillets sélectionnés ;
- un recueil constitué manuellement.

Pour une utilisation proche de l’export rapide de Ulysses, vous pouvez aussi :

- copier le Markdown ;
- ouvrir directement le fichier ;
- compiler une sélection ;
- exporter un document court.

---

## 24. Retrouver les formats d’export

Feuillets propose également une composition vers plusieurs formats, notamment :

- Markdown compilé ;
- DOCX ;
- EPUB ;
- PDF ;
- ODT, selon les fonctions activées.

Vous pouvez définir :

- les éléments inclus ;
- leur ordre ;
- les titres ;
- les séparateurs ;
- la première page ;
- les styles ;
- les marges ;
- la typographie ;
- certains réglages propres au format.

### Différence

Ulysses met l’accent sur la rapidité : choisir un style, prévisualiser et exporter.

Feuillets permet une composition plus structurelle du livre, avec sélection des feuillets, rôles éditoriaux et modèles de projet.

---

## 25. Retrouver les styles d’export

Feuillets utilise le même principe général :

1. vous écrivez en Markdown ;
2. vous sélectionnez un modèle ;
3. vous prévisualisez le résultat ;
4. vous exportez.

L’Aperçu et l’export partagent la même logique de composition, afin que le document visualisé corresponde au document produit.

---

## 26. Retrouver la publication sur le web

Feuillets n’est pas principalement un outil de publication directe vers des plateformes.

Pour publier un article, vous pouvez :

- exporter en Markdown ;
- copier le texte ;
- ouvrir le fichier dans un outil de publication ;
- utiliser une extension Obsidian adaptée ;
- intégrer le coffre à un générateur de site.

### Verdict sur ce point

Pour un blogueur publiant fréquemment directement depuis son application d’écriture, **Ulysses reste plus pratique**.

Pour un auteur qui prépare des textes, articles, livres ou recueils avant publication, Feuillets couvre mieux la structuration longue.

---

## 27. Retrouver la grammaire et le style

Feuillets ne cherche pas à embarquer un correcteur unique.

Dans Obsidian, vous pouvez utiliser un plugin spécialisé, par exemple :

- LanguageTool ;
- Harper ;
- un module Grammalecte compagnon ;
- un autre outil adapté à votre langue.

### Différence

Ulysses offre une solution plus intégrée.

Feuillets sépare l’atelier d’écriture du moteur de correction, ce qui permet de choisir l’outil, mais demande une installation complémentaire.

---

## 28. Retrouver les commentaires et annotations

Dans Feuillets, vous pouvez utiliser :

- des commentaires Markdown ;
- des notes de travail ;
- des notes de bas de page ;
- des surlignages ;
- des fiches Recherche ;
- des annotations fournies par Obsidian ;
- des retours reçus dans un DOCX.

Le modèle est moins fermé : les annotations peuvent provenir de plusieurs outils compatibles avec le coffre.

---

## 29. Retrouver le workflow d’un roman

### Dans Ulysses

```text
Créer un projet
→ créer des groupes
→ écrire une feuille par scène ou chapitre
→ ajouter des mots-clés
→ joindre du matériel
→ suivre l’objectif
→ sélectionner le projet ou les feuilles
→ choisir un style
→ exporter
```

### Dans Feuillets

```text
Créer ou ouvrir un projet
→ construire les parties et chapitres dans le Classeur
→ écrire un feuillet par scène ou section
→ ajouter synopsis, tags, statut et fils narratifs
→ documenter dans Recherche
→ consulter le Contexte pendant l’écriture
→ suivre l’objectif et le journal
→ relire dans Lecture ou Aperçu
→ sélectionner le contenu
→ composer et exporter
```

---

## 30. Retrouver le workflow d’un article

### Dans Ulysses

```text
Créer une feuille
→ écrire
→ ajouter des mots-clés
→ fixer une limite de longueur
→ corriger
→ exporter ou publier
```

### Dans Feuillets

```text
Créer un feuillet
→ écrire
→ ajouter tags, statut et sources
→ fixer un objectif
→ prévisualiser
→ exporter le feuillet seul
```

Feuillets peut aussi regrouper plusieurs articles dans un dossier puis les compiler sous forme de recueil.

---

## 31. Retrouver le workflow d’un recueil

Dans Feuillets :

1. chaque article ou nouvelle reste un feuillet indépendant ;
2. les feuillets peuvent appartenir à des dossiers différents ;
3. vous sélectionnez les textes du recueil ;
4. vous définissez leur ordre ;
5. vous choisissez les titres et séparateurs ;
6. vous prévisualisez ;
7. vous exportez le recueil.

Cette fonction convient aux recueils de nouvelles, chroniques, essais ou articles.

---

# Ce que vous gagnez en passant à Feuillets

## Des fichiers réellement ouverts

Votre texte reste dans des fichiers Markdown ordinaires.

Vous pouvez les lire, les modifier, les sauvegarder et les déplacer sans dépendre de Feuillets.

## Une structure de livre plus riche

Vous disposez de :

- parties ;
- chapitres ;
- scènes ;
- synopsis ;
- statuts ;
- fils narratifs ;
- chronologie ;
- Cartes ;
- Plan ;
- Chemin de fer ;
- Aperçu.

## Une véritable bible de projet

Les personnages, lieux, événements, concepts et sources ne sont pas seulement des feuilles placées dans un groupe. Ils sont organisés comme documentation du projet.

## Un contexte automatique

Le passage courant peut faire remonter les fiches et alertes utiles sans recherche manuelle.

## L’écosystème Obsidian

Vous conservez :

- les liens ;
- les backlinks ;
- le graphe ;
- Canvas ;
- les plugins ;
- les propriétés ;
- les modèles ;
- les commandes ;
- les possibilités d’automatisation.

## Aucun abonnement propre à Feuillets

Feuillets fonctionne localement dans Obsidian et ne requiert pas de service en ligne pour ses fonctions ordinaires.

---

# Ce que vous perdez ou changez

## L’intégration Apple parfaite

Ulysses offre une expérience cohérente entre Mac, iPad et iPhone, avec une synchronisation conçue pour sa propre bibliothèque.

Feuillets dépend davantage d’Obsidian, du système de synchronisation et des limites des plugins sur mobile.

## L’extrême simplicité

Dans Ulysses, vous pouvez ouvrir une feuille et commencer immédiatement.

Feuillets propose plus de panneaux, de vues et de concepts. Ils peuvent être masqués, mais l’environnement reste plus vaste.

## Le Dashboard centralisé

Les informations sont réparties entre Notes, Propriétés, Recherche, Statistiques et Journal.

## La publication directe de blog

Ulysses reste plus efficace pour publier régulièrement vers certaines plateformes.

## Le correcteur intégré

Dans Feuillets, la correction dépend d’un outil compagnon ou d’une extension dédiée.

## Les styles Ulysses existants

Vos styles d’export Ulysses ne sont pas transférés directement. Il faut choisir ou reconstruire un modèle dans Feuillets.

---

# Feuillets peut-il réellement remplacer Ulysses ?

## Oui, probablement, si vous utilisez Ulysses principalement pour :

- écrire des romans ;
- rédiger de la non-fiction longue ;
- écrire un texte par feuille ;
- organiser des chapitres et sections ;
- gérer un recueil ;
- suivre des objectifs ;
- conserver du matériel de recherche ;
- exporter en DOCX, EPUB ou PDF ;
- écrire en Markdown ;
- travailler dans une interface concentrée.

## Feuillets peut même être plus adapté si vous avez besoin de :

- gérer une grande bible narrative ;
- suivre des personnages et lieux ;
- vérifier une chronologie ;
- repérer des anachronismes ;
- visualiser des fils narratifs ;
- comparer ordre narratif et ordre chronologique ;
- composer plusieurs versions d’un livre ;
- conserver vos fichiers hors d’un format propriétaire ;
- intégrer votre projet à l’écosystème Obsidian.

## Ulysses restera probablement préférable si votre priorité est :

- l’expérience Apple la plus fluide possible ;
- la synchronisation Mac, iPad et iPhone sans configuration ;
- l’écriture d’articles courts ;
- la publication directe vers un blog ;
- une interface volontairement minimale ;
- un Dashboard unique ;
- un correcteur intégré ;
- des objectifs d’écriture extrêmement simples et élégants ;
- le moins de réglages possible.

---

# Méthode de transition recommandée

## 1. Ne migrez pas immédiatement toute votre bibliothèque

Choisissez un seul projet terminé ou peu risqué.

## 2. Exportez-le depuis Ulysses

Selon vos besoins, exportez :

- en Markdown ;
- en TextBundle si les images doivent suivre ;
- en DOCX pour contrôler la mise en forme ;
- feuille par feuille ou groupe par groupe.

## 3. Recréez la structure dans Feuillets

Transformez :

- les Projects en projets Feuillets ;
- les Groups en dossiers ;
- les Sheets en feuillets ;
- les Material Sheets en fiches Recherche ou documents exclus.

## 4. Convertissez les mots-clés

Transformez les mots-clés importants en :

- tags ;
- statuts ;
- labels ;
- fils narratifs.

Ne recopiez pas mécaniquement tous les mots-clés. Profitez de la migration pour distinguer leur fonction.

## 5. Vérifiez les éléments particuliers

Contrôlez :

- les images ;
- les notes ;
- les commentaires ;
- les annotations ;
- les notes de bas de page ;
- les liens ;
- les titres ;
- les séparateurs ;
- les caractères spéciaux.

## 6. Recréez les objectifs

Définissez les objectifs de feuillets et de projet, puis utilisez le Journal pour conserver le suivi qualitatif.

## 7. Testez l’export

Exportez :

- un feuillet ;
- un chapitre ;
- le projet entier.

Comparez avec vos sorties Ulysses.

## 8. Travaillez en parallèle quelques jours

Continuez à conserver le projet Ulysses comme archive jusqu’à ce que le cycle complet soit validé.

---

# Tableau de correspondance rapide

| Fonction Ulysses | Équivalent Feuillets |
|---|---|
| Library | Coffre Obsidian |
| Project | Projet Feuillets |
| Group | Dossier |
| Sheet | Feuillet |
| Material Sheet | Recherche ou feuillet exclu |
| Sheet List | Classeur |
| Editor | Vue Écriture |
| Editor Only | Mode Concentration |
| Dashboard | Notes + Propriétés + Statistiques |
| Keywords | Tags, labels, statuts, fils |
| Filter | Filtres et vues |
| Goal | Objectif |
| Writing History | Statistiques et Journal |
| Attachments | Ressources, images, liens, Recherche |
| Split View | Volets Obsidian |
| Outline | Plan du feuillet |
| Export Preview | Aperçu |
| Export Style | Modèle de composition |
| Project Export | Compilation du projet |
| External Folder | Projet Markdown natif |
| Extras | Recherche et Ressources |
| Material | Contenu exclu de la compilation |

---

# Verdict

Feuillets ne cherche pas à reproduire chaque détail de Ulysses.

Il en reprend les principes essentiels :

- écrire dans des unités courtes ;
- organiser ces unités en groupes ;
- séparer le texte de sa mise en forme ;
- rester concentré sur la rédaction ;
- suivre ses objectifs ;
- exporter proprement.

Puis il les étend vers le travail d’un livre complexe :

- manuscrit hiérarchisé ;
- bible narrative ;
- contexte automatique ;
- chronologie ;
- fils narratifs ;
- versions ;
- composition détaillée ;
- fichiers Markdown ouverts.

La question n’est donc pas seulement :

> « Feuillets est-il aussi minimal que Ulysses ? »

Il ne l’est pas, et ne doit probablement pas chercher à l’être entièrement.

La question utile est :

> « Puis-je retrouver la fluidité de mon écriture tout en gagnant les outils nécessaires lorsque mon projet devient un véritable livre ? »

Pour un utilisateur de Ulysses écrivant des romans, essais, recueils ou ouvrages documentés, la réponse peut être **oui**.

Pour un auteur dont la priorité absolue reste l’écosystème Apple, la publication de blog et une interface presque invisible, Ulysses conserve un avantage réel.
