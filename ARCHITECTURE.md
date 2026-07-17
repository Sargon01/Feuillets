# Architecture — Feuillets

Note technique décrivant la structure du code après la modularisation progressive de `main.js`. Aucun comportement visible n'a changé : ce document explique *où* vit désormais chaque responsabilité, pas ce que le plugin fait.

## Arborescence `src/`

```
src/
  main.js                      Bootstrap du plugin, commandes, façades
  constants.js                 IDs de vues, statuts (feuilles du graphe de dépendances)
  default-settings.js          Réglages par défaut (feuille)
  scenes-editor.js              Fusion/scission/déplacement de scènes (autonome, greffé sur l'instance)

  services/                     Logique métier pure, sans état d'instance
    folder-notes.js             Notes de dossier (folderNoteFor, getOrCreateFolderNote)
    frontmatter.js               Lecture des métadonnées YAML (fmOf, titleFor, tagsOf, labelOf…)
    folder-structure.js          Navigation binder : rôles, ordre, aplatissement (getOrderedChildren, flattenFiles…)
    research.js                   Détection d'entités et de leurs apparitions (findAppearances, getResearchRoot…)
    project-files.js              Création de dossiers/feuillets, snapshots (newFolder, newSheet, snapshotFile…)
    compile-export.js             Compilation du manuscrit et export Pandoc (compile, exportFile…)

  utils/
    core.js                     Fonctions pures sans dépendance Obsidian (countWords, frenchTypography…)
    text-metrics.js              Statistiques de texte (countSentences, formatNumber…)
    dom.js                       Petits utilitaires DOM (dépend de setIcon)

  views/                        Rendu + événements UI (héritent de BaseFeuilletsView)
  ui/                            Modales
  settings/                      Onglet de réglages
```

## Le principe de façade

Chaque fonction extraite de `main.js` vers `services/` ou `utils/` garde une **méthode-façade** de même nom sur `FeuilletsPlugin`, qui se contente de déléguer :

```js
// main.js
async compile() {
  return compile(this.app, this.settings);
}
```

Aucun site d'appel existant (vues, modales, `scenes-editor.js`) n'a eu besoin d'être modifié. Ce choix vient d'un constat fait pendant l'audit : compter les appelants externes d'une méthode pour juger si son extraction est "sûre" s'est révélé peu fiable — plusieurs méthodes données comme "0 appel externe" avaient en réalité des appelants (`findAppearances`, `initProjectStructure`, `writeOrder`, `applySiblingOrder`). Garder systématiquement la façade rend ce risque non pertinent : le nombre réel d'appelants n'a plus d'importance.

## Style des modules de service

Les fonctions extraites ne lisent jamais `this` implicitement : elles reçoivent `app`/`settings` (et les autres données nécessaires) en paramètres explicites.

```js
// services/frontmatter.js
export function titleFor(app, file) { ... }

// services/folder-structure.js
export function getOrderedChildren(app, settings, folder, includeHidden = false) { ... }
```

Ce style évite tout import circulaire vers `main.js` : un service peut importer un autre service (ex. `research.js` importe `folder-structure.js` et `frontmatter.js`), mais aucun service n'importe jamais `main.js`. Le graphe de dépendances reste un DAG à trois strates : `main.js` → `views/`+`settings/` → `services/`+`ui/`+`utils/` → `constants.js`/`default-settings.js`.

Certaines actions ont besoin de déclencher un rafraîchissement de vue après coup, sans que le service ait à connaître les vues. Solution retenue : un callback `onDone` injecté par l'appelant.

```js
// services/project-files.js
export function newFolder(app, parent, onDone) {
  new NewFolderModal(app, parent.name, async (name) => {
    await app.vault.createFolder(path);
    if (onDone) onDone();
  }).open();
}

// main.js
newFolder(parent) {
  return newFolder(this.app, parent, () => this.renderAllViews(true));
}
```

## Ce qui reste dans `main.js`, et pourquoi

- **Bootstrap** (`onload`, les 10 méthodes `register*` : `registerViews`, `registerCoreCommands`, `registerVaultEvents`…) — touchent de l'état d'instance partagé (`this._paraEls`, `this.moveStack`, `this._concCounterEl`) entretenu au fil de la vie du plugin. Les séparer proprement nécessiterait de faire circuler cet état autrement qu'en propriétés d'instance implicites — un chantier à part, plus risqué.
- **Numérotation/renommage** (`buildNumbering`, `chapterPattern`, `renumberTitles`) — mélange settings + structure + écriture fichier ; laissé de côté cette itération.
- **Historique/déplacement** (`pushHistory`, `writeOrder`, `applySiblingOrder`, `moveNode`) — partage `this.moveStack` avec le système undo/redo déjà câblé dans `registerCoreCommands`. `newSheetAt` (dans `project-files`-adjacent) dépend de `applySiblingOrder` et reste donc dans `main.js`, non extrait avec le reste de son groupe.
- **`insertIntoActiveEditor`** et autres petites méthodes UI-adjacentes qui manipulent directement l'éditeur actif — pas de logique métier isolable.

Ces exclusions sont volontaires : le principe directeur de ce refactor était "pas de big-bang". Les zones à plus haut risque (état partagé, undo/redo) sont documentées ici comme suite possible plutôt que traitées maintenant.

## Suites possibles (non traitées)

- Extraire `buildNumbering`/`renumberTitles` vers `services/numbering.js`, en passant `settings` explicitement.
- Extraire `pushHistory`/`writeOrder`/`applySiblingOrder`/`moveNode` vers `services/move-history.js`, ce qui demanderait de faire transiter `this.moveStack` en paramètre ou de l'encapsuler dans un petit objet dédié plutôt qu'une propriété d'instance brute.
- Découper `registerCoreCommands` (391 lignes, la plus grosse des méthodes `register*`) en sous-groupes thématiques, une fois l'état partagé qu'elle capture identifié et stabilisé.
- Extraire la logique pure mélangée aux vues repérée pendant l'audit mais non traitée : `views/notes-view.js` (`latestStateBefore`, détection d'entités citées), `views/board-view.js` (approximation de position curseur), `views/base-feuillets-view.js` (`buildSearchIndex`).

## Vérification

Chaque étape d'extraction a été suivie de `npm run build && npm test` sans tolérance de régression. État final : `main.js` réduit de 2541 à 1878 lignes (~26%), bundle stable à 194.6kb, 43/43 tests verts. Une vérification manuelle dans Obsidian (ouverture de chaque vue, création/renommage de feuillet, fusion de scènes, compilation, export, note de dossier) reste à faire avant déploiement dans le coffre de test.
