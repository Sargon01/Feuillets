# Architecture technique — Feuillets 2.5

> Document de maintenance. Cette page décrit l’architecture fonctionnelle à la fin du chantier 2.5 ; les noms de fichiers sont ceux du code.

## Principe général

Feuillets reste un plugin Obsidian TypeScript. Le manuscrit n’est pas stocké dans un format propriétaire : les fichiers Markdown et les dossiers du coffre restent la source de vérité.

`src/main.ts` orchestre l’instance du plugin, les vues, commandes, migrations de réglages, événements du coffre et façades utilisées par les composants. Les règles métier testables sont déplacées dans `src/services/`, `src/utils/` et les composants DOM de `src/ui/` lorsque possible.

## Surfaces principales

### Classeur — `views/feuillets-view.ts`

Le Classeur gère la navigation du manuscrit : ordre, dossiers, feuillets, sélection multiple, recherche, filtres, drag/drop, isolation et intégration avec Continu.

La 2.5 conserve un mode simple et restaure la double vue historique sans remplacer le rendu principal :

- à gauche, une navigation **Manuscrit** fondée sur les dossiers du projet ;
- sous celle-ci, un accès **Coffre** limité à la navigation/ouverture des documents ;
- à droite, le même Classeur 2.5 que dans la vue simple.

Les réglages historiques `binderLayout`, `binderSelectedPath`, `binderTreeWidth`, `binderTreeCollapsed`, `binderListCollapsed` et `binderSplitRecursive` restent la base de compatibilité du layout. Le volet Coffre ne modifie ni la portée du projet, ni l’isolation, ni la sélection, ni Continu.

### Tableau — `views/board-view.ts`

Le Tableau projette les mêmes fichiers sous plusieurs modes : **Cartes**, **Plan**, **Chemin de fer** et **Chronologie**. Il accueille également les surfaces centrales telles qu’Édition et Documents éditoriaux ; ces contenus sont montés comme composants DOM, pas comme `ItemView` imbriquées.

Le **Plan** est la représentation structurelle tabulaire du manuscrit. Il ne doit pas être confondu avec `Composition → Structure`, qui configure des règles de numérotation/compilation.

### Continu — `views/scrivenings-view.ts` + `services/scrivenings-document.ts`

Continu assemble une `CompileScope` dans un seul `EditorView` CodeMirror. Les séparations entre fichiers sont protégées ; les modifications sont redistribuées vers les fichiers sources.

Il n’existe aucun fichier manuscrit composite persistant. Le modèle continu est un document de travail reconstruit depuis les sources et la portée courante.

### Aperçu — `views/preview-view.ts`

Aperçu rend le document composé/paginé, peut suivre la portée de travail et se synchroniser avec l’éditeur/Continu. La pagination et la géométrie partagée s’appuient notamment sur `services/pagination-engine.ts`, `services/page-geometry.ts` et `services/export-render.ts`.

### Panneau droit — `views/sidebar-feuillets-view.ts`

Les cinq onglets publics sont :

```text
notes       → Feuillet
research    → Recherche
journal     → Journal
project     → Projet
relecture   → Relecture
```

Les anciens identifiants persistés sont migrés/redirigés pour compatibilité ; ils ne doivent pas réintroduire l’ancienne organisation publique.

- **Feuillet** : synopsis/résumé, notes, propriétés, notes de bas de page, Contexte, annotations ;
- **Recherche** : catégories documentaires, Sources/Bibliographie et dossiers associés ;
- **Journal** : journal d’écriture ;
- **Projet** : administration et réglages propres au projet ;
- **Relecture** : analyse de texte, relecture collaborative, Révision DOCX et comparaison.

## Édition centralisée

`ui/edition-workspace-content.ts` monte l’espace central **Édition** avec deux modes visibles :

- `composition`
- `layout`

La valeur historique `export` peut rester acceptée en interne pour compatibilité de commandes, mais elle est normalisée vers Composition. Export n’est plus un troisième onglet : `ExportPanel.renderQuickBar()` fournit la barre persistante de portée/format/export/rafraîchissement.

### Composition — `ui/edition-composition-content.ts`

Composition est une page-sommaire avec sous-pages internes :

- contenu du manuscrit ;
- Première page ;
- pages liminaires/front matter ;
- éléments générés ;
- bibliographie/annexes ;
- structure et règles de compilation.

`FirstPagePanel`, `FrontMatterPanel`, `ContentsPanel`, `TablesPanel`, `BibliographyPanel` et `AnnexesPanel` restent les sources de comportement. La présentation de Première page réutilise `LayoutEditor`/`TitlePageMiniature` au lieu d’introduire un second modèle.

### Mise en page — `ui/layout-editor.ts`

La navigation publique est :

```text
Page
Corps de texte / Body text
Titres / Headings
Citation / Blockquote
```

Les gabarits V2 sont partagés entre Aperçu et exports via `services/export-template-v2.ts`, `services/export-template-v2-css.ts` et `services/export-templates-custom.ts`.

## Portées : `services/compile-scope.ts`

Les opérations de lecture/composition/export utilisent une `CompileScope` explicite :

```ts
{ type: "project", ... }
{ type: "file", ... }
{ type: "folder", ... }
{ type: "selection", ... }
```

Le service résout les descendants admissibles, déduplique et conserve l’ordre canonique. Une vue ne doit pas réimplémenter son propre parcours d’export.

## Export

`services/compile-export.ts` assemble le contenu puis délègue aux moteurs :

- `export-docx.ts`
- `export-epub.ts`
- `export-odt.ts`
- `export-pdf.ts`
- `export-render.ts`

`services/export-workflow.ts` centralise le workflow utilisateur.

Le nom de sortie est résolu de manière commune et les écritures tiennent compte des collisions de casse de fichiers déjà présents, notamment sur les systèmes macOS insensibles à la casse. Le fichier réellement existant est modifié plutôt qu’un second nom concurrent créé.

PDF reste un flux desktop vers l’impression système ; DOCX/EPUB/ODT sont générés localement.

## Ordre du manuscrit

L’ordre explicite enregistré reste prioritaire. Le tri naturel n’intervient qu’en repli lorsqu’aucun ordre n’est disponible.

Les imports de plan et Scrivener persistent explicitement l’ordre de la source. `ui/import-outline-modal.ts` et le flux Scrivener utilisent le mécanisme canonique `writeOrder()`/`getOrderedChildren()` au lieu de dépendre de `folder.children` ou d’un tri alphabétique.

## Frontmatter et mapping YAML

`services/frontmatter.ts` centralise lecture logique et écriture des champs. Le panneau Projet peut définir un mapping par projet pour :

```text
synopsis
summary
status
pov
label
goal
thread
characters
date
```

La résolution privilégie le mapping explicite, puis les formes canoniques/legacy reconnues. L’écriture passe par `fileManager.processFrontMatter()` et ne migre pas en masse les fichiers lorsqu’un mapping change.

`services/project-settings.ts` résout également les réglages propres au projet avec repli sur les valeurs globales historiques.

## Recherche

`services/research.ts` résout la racine canonique et les variantes legacy. Les nouvelles écritures utilisent `_Feuillets/Recherche` lorsqu’aucune racine reconnue n’existe.

`researchFolderLinks` permet d’associer un nœud du Classeur à un dossier existant n’importe où dans le coffre. Le panneau Recherche projette ces dossiers liés sans les déplacer. Les dossiers externes restent navigation-only : leurs fichiers peuvent être ouverts, y compris côte à côte, mais Feuillets n’y expose pas les opérations d’administration du dossier Recherche interne.

La double vue du Classeur comporte aussi un mini-navigateur Coffre ; il est indépendant de `researchFolderLinks` et ne crée aucune association automatiquement.

## Contexte

Les services principaux sont :

- `context-index.ts`
- `context-matcher.ts`
- `context-window.ts`
- `context-content-cache.ts`
- `context-content-matcher.ts`

Le rendu public vit dans l’onglet **Feuillet**, pas dans un ancien onglet Notes séparé.

## Annotations de travail

`services/annotations.ts` stocke les annotations hors du Markdown et gère leur ancrage/réancrage. Les décorations de l’éditeur restent une représentation UI ; les marqueurs ne sont jamais insérés dans le texte source.

## Comparaison

`services/comparison-model.ts` et `services/comparison-plan.ts` construisent la grammaire de différences utilisée par la vue de comparaison : ajouts, suppressions, remplacements, déplacements, repères de vides, navigation et restauration.

La vue possède des modes **Changements** et **Versions** et un défilement synchronisé optionnel. Une sélection/recentrage synchronise des positions propres à chaque côté ; les deux documents ne partagent pas artificiellement le même offset.

## Relecture collaborative native

La relecture collaborative est séparée des annotations personnelles et de Révision DOCX. Elle s’appuie sur une famille de services dédiée :

- `native-review-package.ts`
- `native-review-exchange.ts`
- `native-review-session.ts`
- `native-review-storage.ts`
- `native-review-author.ts`
- `native-review-author-return.ts`
- `native-review-author-decisions.ts`
- `native-review-reviewer.ts`
- `native-review-reviewer-return.ts`
- `native-review-threads.ts`
- `native-review-change-groups.ts`
- `native-review-work.ts`
- `native-review-local-state.ts`

Le paquet `.feuillets` contient la portée nécessaire au tour de relecture. L’auteur conserve la baseline envoyée afin de comparer le retour du relecteur au texte envoyé et au manuscrit actuel.

## Révision DOCX

`services/docx-review-import.ts`, `docx-blocks.ts` et `docx-review-regenerate.ts` gèrent l’import/rattachement des modifications suivies et commentaires Word. L’entrée publique se trouve sous **Relecture**.

## Projets et dossiers auxiliaires

Pour un projet structuré, `settings.projectFolder` peut pointer vers `Manuscrit` tandis que la racine réelle du projet contient `_Feuillets`. Un dossier existant utilisé tel quel reste lui-même la racine de travail.

Ne jamais supposer que `root.parent` est automatiquement la racine réelle.

Les dossiers auxiliaires canoniques sont sous `_Feuillets` lorsque créés par la génération actuelle : Recherche, Ressources, Edition, Journal, Snapshots, Backups et Sortie. Les emplacements historiques reconnus restent lisibles sans migration destructive.

## Sécurité des accès

Les écritures ordinaires utilisent les API du Vault/`fileManager`. Les workflows d’import qui nécessitent un fichier externe sont déclenchés explicitement par l’utilisateur. Scrivener est desktop-only car son import doit lire le projet choisi hors du Vault.

Aucun moteur de grammaire distant n’est intégré au noyau. L’API de fournisseur linguistique permet à un plugin compagnon distinct d’ajouter des résultats.

## Vérifications de release

```bash
npm test
npm run build
npm run lint
npm run lint:obsidian
```

Les tests doivent couvrir le comportement final, pas seulement la présence du DOM : l’incident d’export `File already exists` a notamment montré qu’un fake Vault trop permissif peut masquer une différence réelle du filesystem.
