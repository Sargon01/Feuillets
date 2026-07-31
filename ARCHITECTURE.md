# Architecture — Feuillets

Note technique décrivant la structure du code après la modularisation progressive de `main.js`. Aucun comportement visible n'a changé : ce document explique *où* vit désormais chaque responsabilité, pas ce que le plugin fait.

## Arborescence `src/`

```
src/
  main.js                      Bootstrap du plugin, commandes, façades (2650 lignes)
  constants.js                 IDs de vues, statuts (feuilles du graphe de dépendances)
  default-settings.js          Réglages par défaut (feuille)
  scenes-editor.js              Fusion/scission/déplacement de scènes, presets YAML (autonome, greffé sur l'instance)

  services/                     Logique métier pure, sans état d'instance
    folder-notes.js             Notes de dossier (folderNoteFor, getOrCreateFolderNote)
    frontmatter.js               Lecture des métadonnées YAML (fmOf, titleFor, tagsOf, labelOf…)
    folder-structure.js          Navigation binder : rôles, ordre, aplatissement (getOrderedChildren, flattenFiles…)
    research.js                   Détection d'entités et de leurs apparitions (findAppearances, getResearchRoot…)
    research-templates.js         Gabarits de fiches Recherche par mode de projet
    project-files.js              Création de dossiers/feuillets, snapshots (newFolder, newSheet, snapshotFile…)
    project-mode.js               Résolution fiction/non-fiction du projet actif
    compile-export.js             Compilation du manuscrit + orchestration export (compile, exportFile…)
    export-docx.js                Export .docx natif (OOXML réel via la lib `docx`)
    export-epub.js                Export .epub natif (EPUB3 via `jszip`)
    export-pdf.js                 Export .pdf natif (desktop, print Obsidian)
    export-render.js              Rendu Markdown → HTML partagé par les 3 exports natifs
    export-templates-custom.js    Modèles d'export personnalisés (fiches .md dans Ressources/Modèles)
    canvas-board.js                Génération/mise à jour du Canvas "Chemin de fer"
    narrative-threads.js           Suivi des fils narratifs (`fil:`) à travers les scènes
    journal.js                     Entrées du Journal d'écriture
    demo-project.js                Génération d'un projet de démonstration

  utils/
    core.js                     Fonctions pures sans dépendance Obsidian (countWords, frenchTypography…)
    text-metrics.js              Statistiques de texte (countSentences, formatNumber…)
    dom.js                       Petits utilitaires DOM (dépend de setIcon)
    export-templates.js          Modèles d'export intégrés (EXPORT_TEMPLATES, templateFor — purs, testés)
    footnotes.js                  Analyse, validation, navigation et renumérotation des notes de bas de page (l'extraction pour l'export vit dans export-render.js)
    arc-fields.js                 Champs d'arc narratif (panneau Arcs)
    tag-tree.js                   Construction d'arbre de tags (buildTagTree, collectFiles, sortTagNodes)
    project-modes.js              Vocabulaire et réglages par défaut fiction/non-fiction
    journal-carnet.js             Compilation du Journal en un seul document
    journal-stats.js              Statistiques du calendrier d'écriture

  views/                        Rendu + événements UI (héritent de BaseFeuilletsView, sauf mention contraire)
    base-feuillets-view.js       Classe de base : sections repliables, iconBtn, panneau Recherche partagé
    feuillets-view.js             Binder (barre latérale gauche)
    board-view.js                  Tableau/plan : Cartes / Plan / Chemin de fer / Chronologie / Lecture
    notes-view.js                  Panneau Notes (synopsis, contexte, notes de dossier, plan)
    research-view.js               Panneau Recherche (bible narrative)
    properties-view.js             Panneau Propriétés (frontmatter + tags scopés projet)
    project-view.js                Panneau Projet & export
    progression-view.js            Panneau Statistiques (ItemView autonome)
    journal-view.js                 Panneau Journal d'écriture (ItemView autonome)
    arcs-view.js                    Panneau Arcs narratifs (ItemView autonome)

  ui/                            Modales (ConfirmModal, TextInputModal, entity-modals, import-outline…)
  settings/                      Onglet de réglages (feuillets-setting-tab.js)
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

## Typage : vérification opt-in, sans migration TypeScript

Le code reste en JavaScript ESM. Les formes de données majeures
(`SceneFrontmatter`, `ProjectMeta`, `ExportTemplate`, `FeuilletsSettings`,
`Label`, `HeadingStyle`…) sont déclarées une seule fois dans
**`src/types.d.ts`** — fichier de déclaration global, donc utilisable en
JSDoc depuis n'importe quel fichier sans rien importer :

```js
// @ts-check
/** @param {App} app @param {TFile} file @returns {SceneFrontmatter} */
export function fmOf(app, file) { … }
```

`tsconfig.json` garde `checkJs: false` : **la vérification s'active fichier
par fichier** en ajoutant `// @ts-check` en tête. Aucun mur d'erreurs sur
les 25 000 lignes existantes, et le `tsc -noEmit` de `npm run build` devient
réellement bloquant sur les fichiers annotés (il ne vérifiait rien avant :
`src/types.ts` était vide et `checkJs` déjà à `false`).

`strictNullChecks` est activé — la classe de bug la plus fréquente ici, plusieurs
helpers renvoyant `null` (`compiledTitleFor`, `compiledSubtitleFor`, `labelColor`).

Vérifiés à ce jour : `services/frontmatter.js`, `utils/export-templates.js`,
`services/export-templates-custom.js` (la famille « modèles d'export » est
close), `services/numbering.js`, `utils/entity-states.js`,
`utils/search-index.js`, `utils/sibling-order.js`, `utils/docx-bookmarks.js`,
`services/export-docx-style.js`, `services/docx-blocks.js`,
`utils/compile-text.js`, `utils/scene-fields.js` et `utils/xml.js`. Candidat
suivant, même critère (formes de données circulant entre modules) :
`utils/title-roles.js`.

`escapeXml` était dupliqué à l'identique dans `export-odt.js` et
`export-epub.js` ; il vit désormais dans `utils/xml.js`, à côté de son inverse
`decodeXmlEntities`, avec un test d'aller-retour. Une fonction dont dépend la
validité de tout fichier exporté n'a pas à exister en deux exemplaires.

**Ne jamais réimplémenter la sérialisation YAML.** `scenes-editor.js` écrivait
le frontmatter des scènes découpées avec un sérialiseur fait main dont
l'« échappement » se limitait à remplacer les retours à la ligne par des
espaces. Un titre contenant « : » — forme française courante (« Chapitre 3 :
la fuite ») — ou commençant par « # », « [ », « * », « & », suffisait à
produire un frontmatter illisible ou lu de travers, sur un fichier que le
plugin venait de créer à partir du texte de l'autrice. `stringifyYaml`
(Obsidian) est déjà utilisé par `export-templates-custom.js` : c'est le seul
chemin admis.

Limite connue, figée par un test dans `test/compile-text.test.js` :
`footnotePrefixFor` remplace tout caractère non alphanumérique ASCII par
« - », donc deux feuillets dont les noms ne diffèrent que par des caractères
accentués **aux mêmes positions** (« Scène é » / « Scène è ») partagent leur
espace de noms de notes de bas de page. Rare mais réel. Le corriger demande
de suffixer un condensé du chemin (`bookmarkIdFor`, `utils/docx-bookmarks.js`)
au prix d'étiquettes moins lisibles dans le `Manuscrit.md` compilé — arbitrage
laissé ouvert, pas tranché unilatéralement.

Cas particulier des moteurs d'export : `export-docx.js`, `export-epub.js` et
`export-pdf.js` chargent `export-render.js`, qui dépend d'Obsidian — ils ne
sont donc ni importables sous Node ni vérifiables par `tsc` tant que leur
logique pure y reste mêlée. Le remède est le découpage, pas le mock :
`export-docx-style.js` isole la traduction modèle → primitives `docx`, et
c'est ce qui a permis d'y trouver le bug de justification.

Attention : **`// @ts-check` seul ne suffit pas.** `noImplicitAny` est désactivé,
donc un paramètre non annoté reste `any` et le fichier passe sans rien vérifier.
La directive n'a de valeur qu'accompagnée des `@param`/`@returns`. Sur
`EXPORT_TEMPLATES`, l'annotation `@type {Record<string, ExportTemplate>}` fait
vérifier chaque modèle intégré contre le typedef : un champ mal typé dans un
modèle est signalé au build, plus à l'export.

Deux règles pour `types.d.ts` :

- **Ne déclarer que des champs vérifiés dans le code.** Un type qui ment est
  pire que pas de type : il fait passer une faute de frappe pour un accès légitime.
- **Signature d'index (`[key: string]: any`) sur les types issus de YAML**
  (`SceneFrontmatter`, `ExportTemplate`, `ProjectMeta`) : le frontmatter est
  écrit à la main, un modèle d'export personnalisé fusionne un frontmatter
  arbitraire par-dessus « classique », et `project-modals.js` écrit
  `projectMeta[path][key]` dynamiquement. Conséquence assumée : les fautes de
  frappe sur un **nom de clé** ne sont pas détectées ; les erreurs de **type**
  (`string[]` traité comme `string`), d'**arité** et de **null** le sont.

## Suites possibles (non traitées)

- ~~Extraire `buildNumbering` vers `services/numbering.js`~~ — **fait.** Les
  dépendances à Obsidian sont injectées via un paramètre `helpers`
  (`getOrderedChildren`, `roleOfFolder`, `isFrontMatter`, `isFolder`), ce qui
  rend le module pur et testable sans coffre : 9 cas dans
  `test/numbering.test.js` couvrent les deux axes de numérotation, la
  remise à zéro par partie, l'exclusion du Front matter, la récursion dans un
  sous-dossier de chapitre et le fichier-chapitre à la racine.

  Point d'attention pour toute extraction du même genre : `isFolder` **doit**
  rester injecté. La version intermédiaire testait
  `child.children !== undefined || child.isFolder || child.constructor.name === "TFolder"`
  — du duck-typing qui marche par accident (un `TFile` n'a pas de `children`)
  mais qui dépend d'un nom de classe. `main.js` passe désormais le vrai
  `(node) => node instanceof TFolder`, et les tests leur duck-typing : parité
  exacte en production, pas de dépendance à Obsidian dans les tests.

  `renumberTitles` n'a pas le même profil (boucle de `renameFile`) et reste
  dans `main.js`.
- ~~Extraire `pushHistory`/`writeOrder`/`applySiblingOrder`/`moveNode` vers
  `services/move-history.js`~~ — écarté après examen : ces fonctions sont de
  l'orchestration I/O (`app.fileManager`, `processFrontMatter`,
  `saveSettings`, `Notice`). Extraites, elles traînent toujours six
  dépendances explicites au lieu d'un couplage implicite, sans gain de
  testabilité en retour (il faudrait mocker le vault). Coût net positif.
- Découper `registerCoreCommands` (391 lignes, la plus grosse des méthodes `register*`) en sous-groupes thématiques, une fois l'état partagé qu'elle capture identifié et stabilisé.
- Extraire la logique pure mélangée aux vues. **Fait** pour `latestStateBefore`
  (→ `utils/entity-states.js`), `buildSearchIndex` (→ `utils/search-index.js`,
  lecture injectée) et la réconciliation d'ordre de `undo-move`
  (→ `utils/sibling-order.js`). **Restent** : la détection d'entités citées
  (`views/notes-view.js`) et l'approximation de position curseur
  (`views/board-view.js`).

## Vérification

Chaque étape d'extraction a été suivie de `npm run build && npm test` sans tolérance de régression — et depuis l'introduction du typage opt-in, de `npx tsc -noEmit` (inclus dans `npm run build`). État courant : bundle de production à 951.2kb, 428/428 tests verts (`node:test`, fonctions pures de `utils/` et `services/`). `main.js` a regrandi au fil de l'ajout de panneaux entiers (Propriétés, Projet & export) plutôt que de rétrécir — la modularisation en `services/`/`views/` a absorbé la logique, pas fait disparaître le bootstrap qui les câble.

Règle tirée de ces extractions : **écrire les tests contre le comportement voulu, pas contre le code déplacé.** Quatre défauts réels ont été trouvés de cette façon, tous invisibles tant que le code restait dans sa vue ou sa classe — une année négative lue positive, un index de recherche pouvant se figer sur un texte périmé, un `label` de modèle d'export pouvant ne pas être une chaîne, et surtout `AlignmentType.JUSTIFY` (inexistant dans `docx`, donc `undefined`) qui privait de justification tout manuscrit .docx exporté avec le modèle « Classique ».

Ce dernier cas justifie à lui seul le découpage de `services/export-docx.js` : la fonction fautive était inchangée depuis toujours, mais impossible à charger sous Node tant qu'elle vivait dans un module dépendant d'`export-render.js`, donc d'Obsidian. C'est le déplacement vers `export-docx-style.js` — sans dépendance à Obsidian — qui l'a mise à portée de `tsc`.

Le découpage suivant, `services/docx-blocks.js` (DOM rendu → paragraphes `docx`), en a sorti deux autres du même tonneau, tous deux sur le traitement des images :

- `images.find(...)` était appelé sur la **Map** que renvoie `inlineImages` (export-render.js), qui n'a pas cette méthode — et l'appel était hors du `try`. Tout export .docx d'un manuscrit contenant une image échouait donc sur un `TypeError`. La Map étant indexée par le nœud `<img>`, `images.get(node)` remplace avantageusement l'ancienne heuristique `src.includes(path)`.
- `new ImageRun({ data, transformation })` sans `type` fait écrire à `docx` une ressource `word/media/<hash>.undefined`, que Word n'ouvre pas. Le `type` est désormais déduit de l'extension, et un format qu'OOXML ne sait pas empaqueter (webp, avif) est ignoré avec un avertissement plutôt qu'inséré sous une extension fausse.

Ces deux-là sont des séquelles de refactor : `inlineImages` est passé d'un tableau `{path, buffer}` à une Map `{bytes, ext}` sans que le consommateur .docx suive. Le genre de désynchronisation qu'un test d'intégration, même minimal, aurait attrapé — d'où `test/docx-blocks.test.js`, qui empaquette réellement un `.docx` et vérifie l'extension du média dans le zip.
