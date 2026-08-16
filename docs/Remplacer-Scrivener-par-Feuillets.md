# Remplacer Scrivener par Feuillets

> **Français** · [English](REPLACE-SCRIVENER-WITH-FEUILLETS.md) · [Index](README.md)

Vous utilisez Scrivener pour son Binder, ses fiches, ses synopsis, ses métadonnées, ses snapshots, son mode Scrivenings et sa compilation. Feuillets reprend l’essentiel de ce workflow dans Obsidian, avec une différence structurante : **le projet reste constitué de dossiers et de fichiers Markdown ordinaires**.

![Import d’un projet Scrivener](feuillets-import-scrivener.png)

Feuillets ne cherche pas à reproduire Scrivener pixel par pixel. Il reprend les gestes qui comptent pour écrire un livre — structurer, déplacer, relire, documenter, réécrire, comparer et exporter — tout en conservant l’ouverture du coffre Obsidian.

---

## 1. Retrouver le Binder

Dans Feuillets, l’équivalent du Binder est le **Classeur**.

Vous y retrouvez :

- parties, chapitres, dossiers et feuillets ;
- glisser-déposer et réorganisation ;
- renommage, duplication, scission et fusion ;
- déplacement vers la racine du manuscrit ;
- sélection multiple ;
- recherche et filtres ;
- ouverture d’un dossier en **Continu** ;
- isolation temporaire d’un dossier sans modifier le projet.

La hiérarchie correspond à de vrais dossiers et fichiers du coffre.

### Double vue

Le Classeur peut aussi afficher une **double vue** :

- à gauche, l’arborescence des dossiers du manuscrit pour lire la structure d’un coup d’œil ;
- en dessous, un accès léger et en lecture seule au **Coffre** pour ouvrir une documentation extérieure ;
- à droite, le Classeur normal, avec exactement les mêmes fonctions qu’en vue simple.

Le volet Coffre sert uniquement à trouver et ouvrir un fichier. Il ne transforme jamais un document extérieur en feuillet et ne l’ajoute ni à la compilation ni au Continu.

### Équivalences principales

| Scrivener | Feuillets |
|---|---|
| Binder | Classeur |
| Document | Feuillet |
| Folder | Dossier |
| Draft / Manuscript | Portée Manuscrit |
| Research | Recherche |
| Trash | Corbeille Obsidian |

---

## 2. Retrouver le Corkboard

![Cartes, Plan, Chemin de fer et Chronologie](feuillets-mosaique-narrative.png)

La vue **Cartes** joue le rôle du Corkboard : elle permet de regarder les unités du manuscrit sans rester dans la prose.

Une carte peut notamment montrer le titre, le synopsis, le statut, le label et la progression. Les cartes servent à réorganiser le manuscrit, pas à créer une seconde structure parallèle.

---

## 3. Retrouver l’Outliner

Utilisez **Plan** pour voir la structure et les métadonnées du manuscrit sous forme de tableau.

Selon les colonnes activées, vous pouvez afficher par exemple :

- titre ;
- synopsis ou résumé ;
- statut ;
- label ;
- tags ;
- nombre de mots ;
- objectif et progression ;
- date ;
- propriétés utiles au projet.

Le retour à la ligne des champs longs peut être activé lorsque vous avez besoin de lire un synopsis ou un résumé complet.

> **Plan** sert à voir et travailler la structure. **Édition → Composition → Structure** sert, lui, à régler la numérotation, les titres, séparateurs et règles de compilation.

---

## 4. Retrouver le synopsis, les notes et les propriétés

Le panneau droit de Feuillets est organisé par intention.

### Feuillet

L’onglet **Feuillet** accompagne le texte actif :

- synopsis ;
- résumé ;
- notes de travail ;
- propriétés ;
- notes de bas de page ;
- plan interne ;
- **Contexte** du passage courant.

### Projet

L’onglet **Projet** gère les informations et réglages propres au projet : statuts, labels, tags favoris, objectifs et correspondance des propriétés YAML.

### Remappage des propriétés

Feuillets peut s’adapter aux propriétés déjà utilisées dans votre coffre. Par exemple, une propriété existante `State` peut être désignée comme le statut Feuillets sans renommer les fichiers ni migrer le YAML.

Les correspondances sont non destructives : elles indiquent à Feuillets **où lire et écrire**, elles ne réécrivent pas le coffre pour lui imposer un schéma.

---

## 5. Retrouver labels, statuts et métadonnées personnalisées

Feuillets utilise des propriétés Markdown lisibles dans les fichiers. Selon le projet, vous pouvez utiliser :

- statut ;
- un ou plusieurs labels ;
- tags ;
- date ;
- objectif ;
- point de vue ;
- fil narratif ;
- personnages ;
- autres propriétés personnalisées.

Ces informations peuvent alimenter Cartes, Plan, Chemin de fer, Chronologie, filtres et Contexte.

Le remappage YAML permet de conserver vos noms de propriétés existants lorsque vous migrez un coffre déjà organisé.

---

## 6. Retrouver les Collections

Feuillets ne reproduit pas l’objet « Collection » de Scrivener à l’identique. Le besoin est couvert par plusieurs mécanismes complémentaires :

- filtres ;
- sélection multiple ;
- dossier isolé ;
- portée de Continu ;
- portée d’Aperçu ;
- portée de composition/export ;
- vues narratives.

Vous pouvez ainsi travailler temporairement sur un chapitre, une sélection de scènes, un recueil ou un ensemble de feuillets sans déplacer les sources.

---

## 7. Retrouver Scrivenings : le mode Continu

C’est l’une des différences importantes de Feuillets 2.5.

Le mode **Continu** ouvre plusieurs feuillets **dans un seul éditeur continu et réellement éditable**.

Vous pouvez ouvrir :

- un dossier ;
- un chapitre ;
- une partie ;
- une sélection ;
- le manuscrit.

Visuellement, vous travaillez dans un long document. Techniquement, chaque feuillet reste son propre fichier Markdown. Les séparations sont protégées et les modifications sont redistribuées automatiquement dans les fichiers sources.

Il n’existe aucun fichier composite caché à maintenir et Feuillets n’ouvre pas des dizaines d’onglets pour simuler le résultat.

### Continu, Aperçu et Édition

- **Continu** : écrire et réviser plusieurs feuillets comme un seul texte.
- **Aperçu** : lire le résultat paginé et composé.
- **Édition** : régler la composition et la mise en page du document final.

---

## 8. Retrouver Research

La **Recherche** de Feuillets est séparée du manuscrit, mais reste constituée de fichiers ordinaires.

Elle peut contenir personnages, lieux, événements, concepts, sources, bibliographie, glossaire et dossiers personnalisés.

Vous pouvez aussi **associer un dossier existant n’importe où dans le coffre** à un feuillet ou à un dossier du manuscrit. Le dossier n’est ni déplacé ni renommé. Lorsqu’il est extérieur à la Recherche du projet, il apparaît comme dossier lié en lecture seule dans le panneau Recherche.

Ses fichiers peuvent être consultés et ouverts dans un nouvel onglet ou côte à côte, sans que Feuillets n’administre le dossier extérieur.

---

## 9. Retrouver Project Bookmarks et Document Bookmarks

Le workflow équivalent repose sur :

- dossiers Recherche associés à un feuillet ou à un chapitre ;
- liens Markdown ;
- notes de dossier ;
- références épinglées dans **Feuillet → Contexte** ;
- navigation libre dans le coffre en double vue du Classeur.

Une référence épinglée reste attachée au feuillet actif même lorsque vous changez de paragraphe.

---

## 10. Retrouver les Snapshots et les sauvegardes

Feuillets distingue plusieurs niveaux de sécurité :

- instantané d’un feuillet ;
- versions du manuscrit ;
- comparaison ;
- sauvegardes ZIP du projet ;
- sauvegarde/synchronisation normale du coffre par l’outil de votre choix.

Le but reste le même : pouvoir réécrire sans craindre de perdre l’état précédent.

![Comparaison de versions](feuillets-comparaison.png)

---

## 11. Retrouver la comparaison de versions

Le comparateur de Feuillets distingue :

- ajouts ;
- suppressions ;
- remplacements ;
- **déplacements** de passages lorsque du texte a été coupé puis recollé ailleurs.

La vue **Changements** utilise une grammaire visuelle commune, avec repères, flèches de déplacement et placeholders `[…]` lorsqu’un passage n’existe que d’un côté. Vous pouvez naviguer avec Précédent/Suivant, recentrer sur une différence et restaurer un passage lorsque l’action est disponible.

La vue **Versions** retire les décorations de diff pour relire les deux textes plus simplement. Le défilement synchronisé est optionnel.

---

## 12. Retrouver commentaires et annotations

Feuillets 2.5 possède désormais ses propres **annotations de travail**.

Vous sélectionnez un passage, ajoutez une remarque et le passage reste visuellement repérable dans l’éditeur. L’annotation peut être relue, modifiée puis supprimée lorsqu’elle est traitée.

Ces annotations :

- ne polluent pas le Markdown ;
- ne sont pas destinées à l’export ;
- restent des outils temporaires de travail.

Pour un échange avec une autre personne, Feuillets dispose aussi de la **relecture collaborative**, distincte des annotations personnelles et de la Révision DOCX.

---

## 13. Retrouver une relecture collaborative

Feuillets peut préparer un échange de relecture sous forme de paquet `.feuillets`.

Le principe est volontairement local :

1. l’auteur prépare une portée de manuscrit ;
2. il transmet le paquet au relecteur par le moyen de son choix ;
3. le relecteur travaille sur sa copie et ajoute ses commentaires ;
4. il renvoie le paquet ;
5. l’auteur compare le retour avec l’état envoyé **et** son manuscrit actuel, puis applique, ignore ou traite les changements.

Cela permet de continuer à écrire pendant qu’un tiers relit une version envoyée, sans serveur Feuillets et sans écraser automatiquement le manuscrit courant.

---

## 14. Retrouver la Révision DOCX

Les retours d’un éditeur ou d’un correcteur en Word restent pris en charge sous **Relecture → Révision DOCX**.

Feuillets importe les modifications et commentaires compatibles, les présente dans son workflow de relecture et garde les décisions séparées du texte jusqu’à leur application.

La relecture collaborative native et la Révision DOCX répondent à deux workflows différents ; elles ne sont pas fusionnées artificiellement.

---

## 15. Retrouver la chronologie

La vue **Chronologie** confronte les dates du récit à l’ordre narratif du manuscrit. Elle peut utiliser les scènes datées et les événements de Recherche.

Le **Contexte** du feuillet peut aussi signaler, selon les données du projet :

- âge ou état d’un personnage ;
- personnage déjà mort ou pas encore né ;
- événement historique proche ;
- objet ou technique anachronique.

Ces alertes dépendent de vos propres informations : Feuillets ne prétend pas reconstruire l’histoire à votre place.

---

## 16. Retrouver le suivi des fils narratifs

Le **Chemin de fer** projette les mêmes feuillets selon les fils narratifs, labels, points de vue et autres dimensions utiles. Il sert à observer la distribution d’un fil à travers le manuscrit, pas à imposer une méthode de scénario.

---

## 17. Retrouver le mode Composition

Le mode **Concentration** correspond au besoin de masquer l’environnement autour du texte : largeur contrôlée, défilement machine à écrire, atténuation du texte non actif et compteur discret.

Il ne faut pas le confondre avec l’espace central **Édition**, consacré au document final.

---

## 18. Retrouver les objectifs d’écriture

Feuillets peut suivre :

- objectif par feuillet ;
- objectif de projet ;
- progression ;
- activité récente ;
- calendrier d’écriture ;
- journal de travail.

Les réglages importants peuvent être propres à chaque projet plutôt que partagés globalement entre tous les manuscrits.

---

## 19. Retrouver Compile

L’espace central **Édition** comporte deux modes :

### Composition

Vous choisissez et contrôlez le contenu du document :

- contenu du manuscrit ;
- première page ;
- pages liminaires ;
- sommaire/table des matières ;
- tables ;
- bibliographie ;
- annexes ;
- règles de structure et de compilation.

### Mise en page

Vous réglez la présentation :

- page ;
- corps de texte ;
- titres ;
- citation/séparateur ;
- marges, orientation, colonnes, en-têtes et pieds ;
- gabarit actif.

L’export n’est pas un troisième onglet : les contrôles de portée, format et **Exporter** restent dans la barre supérieure d’Édition.

Les formats natifs comprennent :

- Markdown compilé ;
- DOCX ;
- EPUB ;
- ODT ;
- PDF via le flux d’impression système sur desktop.

L’Aperçu et l’export partagent la même logique de composition.

---

# Migrer un projet Scrivener

L’import Scrivener sur desktop récupère les éléments pris en charge du projet : structure Binder, dossiers, textes, titres, métadonnées compatibles et ressources prises en charge.

Feuillets **préserve explicitement l’ordre du Binder source** lors de l’import. L’ordre naturel des noms n’intervient qu’en repli lorsqu’aucun ordre explicite n’existe.

Après import, contrôlez toujours :

- ordre des parties, chapitres et scènes ;
- titres et synopsis ;
- notes et métadonnées ;
- images et ressources ;
- documents non textuels ;
- éléments exclus de la compilation.

Gardez le projet Scrivener original comme archive jusqu’à validation de plusieurs exports de contrôle.

---

# Workflow quotidien équivalent

## Dans Scrivener

```text
Ouvrir le projet
→ choisir une scène dans le Binder
→ écrire
→ consulter synopsis et notes
→ ouvrir Research
→ créer un Snapshot
→ Scrivenings / Compile
```

## Dans Feuillets

```text
Ouvrir le projet
→ choisir un feuillet dans le Classeur
→ écrire seul ou en Continu
→ consulter Feuillet et Contexte
→ ouvrir ou associer une Recherche
→ créer un instantané quand nécessaire
→ comparer / relire
→ contrôler l’Aperçu
→ composer et exporter dans Édition
```

---

# Ce que vous gagnez

- des fichiers Markdown ordinaires ;
- un projet lisible sans Feuillets ;
- le mode Continu éditable ;
- l’écosystème Obsidian ;
- Recherche liée sans déplacer les dossiers existants ;
- remappage des propriétés YAML ;
- annotations de travail sans marquer le Markdown ;
- relecture collaborative locale ;
- comparaison de versions enrichie ;
- Chronologie et Chemin de fer intégrés ;
- composition/export sans format de projet propriétaire.

# Ce qui reste différent de Scrivener

Scrivener conserve des avantages propres à une application entièrement dédiée : interface homogène sur toutes ses plateformes, système Compile extrêmement mature, objets et métadonnées propriétaires spécialisés, Collections et certaines automatisations très élaborées.

Feuillets privilégie un autre compromis : **un atelier d’écriture complet qui reste compatible avec le coffre, les fichiers et les outils Obsidian déjà utilisés par l’auteur**.

---

# Verdict

Feuillets ne remplace pas Scrivener en copiant son format de projet. Il reprend son idée la plus utile — un livre composé d’unités mobiles que l’on peut écrire, regrouper, relire et compiler — et la reconstruit autour de Markdown et d’Obsidian.

Pour un auteur dont le besoin central est d’écrire, structurer, documenter, réviser et exporter un manuscrit sans enfermement dans un format propriétaire, Feuillets couvre désormais l’essentiel du parcours, y compris un véritable mode Continu proche de Scrivenings.
