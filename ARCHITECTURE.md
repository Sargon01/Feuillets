# Architecture technique — Feuillets

> **Document interne de maintenance.**
>
> Cette page emploie volontairement les noms du code, les chemins, les types et
> les termes techniques exacts. Elle n’est pas destinée au parcours public des
> écrivains et n’est pas soumise au vocabulaire simplifié de la documentation
> utilisateur.

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

## Compilation et export

### Le pipeline réel

`compile()` (`services/compile-export.ts`) est la SEULE fonction qui parcourt
le projet. Elle produit un contrat unique :

```ts
{ outPath: string; manuscript: string; segments: CompileSegment[] }
```

- `manuscript` : le texte Markdown complet, dans l'ordre du Binder — c'est ce
  qui est écrit dans `Sortie/Manuscrit.md` et ce que Pandoc reçoit.
- `segments` : la même succession de blocs, mais un par feuillet source
  (`{ path, text, frontType }` — `path` vaut `null` pour un simple titre de
  partie/chapitre, sans fiche propre). C'est ce que les 4 exports natifs
  utilisent pour poser un signet par feuillet et isoler les pages Front.

**Sélection et ordre** viennent d'une seule primitive, `getOrderedChildren`
(`services/folder-structure.ts`) — la même que le Binder, le Tableau et la
modale « Feuillets à compiler » (`ui/selection-modals.ts`). Aucune des trois
surfaces ne recalcule son propre ordre : diverger entre elles est donc
structurellement impossible, pas seulement testé. `compile:false`
(et l'alias hérité `compiler:false`, résolu par `fmOf`) exclut un feuillet
sans le retirer du Binder.

**Un seul rendu, quatre formats.** `exportViaNative()` compile une fois, puis
appelle `renderManuscriptHtml*()` (`services/export-render.ts`) — un seul
passage par `MarkdownRenderer.render()` d'Obsidian — dont EPUB, DOCX, PDF et
ODT partent tous. Chapitres, texte, titres, images et notes sont donc
partagés PAR CONSTRUCTION ; ce qui diverge ensuite est la conversion de ce
DOM commun vers chaque format cible (`docx-blocks.ts`, sérialisation XHTML,
pagination PDF, XML ODT) — voir la matrice ci-dessous.

**Erreurs.** Une erreur de compilation ou d'export est une `CompileError`
(`services/compile-errors.ts`) : `{ step, filePath?, format? }`. Un feuillet
illisible arrête la compilation avec un message qui le nomme précisément
(`describe()` → `"lecture du feuillet (docx) — Chapitre 2/Scène.md : ..."`),
jamais un simple « Échec de l'export ». Une image introuvable n'arrête rien
(best-effort) mais n'est plus seulement logguée en console : une Notice
récapitule les ressources manquantes.

**Les fichiers sources ne sont jamais modifiés** : `compile()` ne lit qu'en
`cachedRead`, les transformations (retrait du frontmatter, renumérotation des
notes, typographie française) n'opèrent que sur la copie en mémoire.

### Matrice de capacités par format

| Capacité | Markdown | HTML (XHTML EPUB) | PDF | DOCX | ODT |
| --- | --- | --- | --- | --- | --- |
| Titres, structure de chapitres | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge |
| Gras/italique/citations/listes | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge |
| Images internes | ✅ conservées (embed) | ✅ transformé (data URI inliné) | ✅ transformé (data URI inliné) | ✅ transformé (ImageRun natif) | ✅ transformé (fragment inliné) |
| Wikiliens `[[...]]` | ⚠️ transformé (converti en texte lisible, jamais un lien) | ⚠️ transformé (idem) | ⚠️ transformé (idem) | ⚠️ transformé (idem) | ⚠️ transformé (idem) |
| Notes de bas de page | ✅ pris en charge (syntaxe standard) | ✅ pris en charge (appel + lien de retour) | ✅ pris en charge (bloc de notes en fin de page) | ✅ pris en charge (vraie note Word) | ⚠️ transformé (notes de fin, texte brut — pas de vraie structure `<text:note>`) |
| Lien de retour note→appel | ➖ non pris en charge (Markdown n'a pas cette notion) | ✅ pris en charge | ➖ non pris en charge (page statique) | ➖ non pris en charge (Word gère son propre aller-retour) | ➖ non pris en charge |
| Renumérotation continue à la compilation | ✅ pris en charge (réglage, désactivable) | hérité du Markdown compilé | hérité | hérité | hérité |
| Mise en forme *à l'intérieur* d'une note (gras, lien) | ✅ pris en charge | ✅ pris en charge | ✅ pris en charge | ⚠️ transformé (texte brut, mise en forme perdue) | ⚠️ transformé (texte brut) |
| Pages Front (titre/dédicace/épigraphe) | ✅ pris en charge | ✅ pris en charge (saut de page CSS) | ✅ pris en charge (saut de page) | ✅ pris en charge (section Word dédiée) | ✅ pris en charge (style de paragraphe dédié) |
| Numérotation par chapitre (pagination avancée) | ➖ non pris en charge | ➖ non pris en charge | ➖ non pris en charge | ➖ non pris en charge | ➖ non pris en charge |

« ✅ pris en charge » : fonctionne comme dans Obsidian. « ⚠️ transformé » :
fonctionne, mais sous une forme adaptée aux limites du format cible — jamais
silencieux, toujours documenté ici. « ➖ non pris en charge » : n'existe pas
dans ce format ou hors périmètre de ce lot — voir « Suites possibles »
ci-dessous pour ce qui est délibérément reporté (profils enregistrables,
en-têtes/pieds de page avancés, métadonnées complètes, notes PDF repaginées
en bas de page, pagination sophistiquée, moteur de PAO externe).

### Fidélité visuelle aperçu/export (Lot 2)

**Une seule source de mise en page.** `templateToCss()` (`utils/export-templates.ts`)
traduit un modèle (`EXPORT_TEMPLATES` — Classique, Moderne, Machine à écrire,
Roman simple, Roman français, APA, Thèse) en une feuille de style : police,
taille, interligne, alignement, marges, retrait de première ligne,
espacement de paragraphe, titres (h1/h2/h3 : taille, graisse, italique,
marges, saut de page), citation, séparateur de scène, contrainte de largeur
des images. C'est la SEULE définition de ces règles — chaque format la
traduit dans son propre langage plutôt que de la redéfinir :

| Format | Consomme `templateToCss`/le modèle | Traduction |
| --- | --- | --- |
| Aperçu (`ui/preview-modal.ts`) | ✅ intégralement | CSS injecté tel quel dans une `<iframe sandbox>` isolée du thème Obsidian — même pagination que PDF (`paginateManuscript`) |
| PDF (`services/export-pdf.ts`) | ✅ intégralement | CSS injecté dans la fenêtre d'impression + pagination JS (mesure réelle des éléments, sauts avant partie/chapitre) |
| EPUB (`services/export-epub.ts`) | ✅ tout sauf `pageOrientation`/`columns` | CSS injecté tel quel dans le XHTML — orientation/colonnes n'ont pas de sens pour un flux reflowable |
| DOCX (`services/export-docx.ts`, `export-docx-style.ts`) | ✅ intégralement | traduit en **styles Word nommés réels** (`heading1`/`heading2`/`heading3` dans `Document({ styles: ... })`) plutôt qu'en formatage direct — reste éditable dans Word |
| ODT (`services/export-odt.ts`) | ✅ intégralement (depuis ce lot) | traduit en styles ODF (`style:default-style`, `Heading_20_1/2/3`, `Quotations`, `Horizontal_20_Line`) — **avant ce lot, l'ODT ignorait le modèle choisi et gardait toujours Times 12pt/2,5cm** |

**L'aperçu affiche désormais le manuscrit RÉELLEMENT compilé.** Avant ce
lot, `PreviewModal` (`ui/preview-modal.ts`) n'était même pas branché à
l'interface (code mort, jamais instancié) et affichait 5 chaînes de
démonstration factices quand on l'appelait directement — jamais le contenu
d'un projet. Il est maintenant ouvert depuis l'icône « œil » du panneau
Compilation (`views/project-view.ts`) et suit exactement le même pipeline
que l'export PDF : `compile()` → `renderManuscriptHtmlWithFrontPages()` →
`paginateManuscript()`. Les sauts de page, titres, séparateurs, images et
notes affichés sont donc ceux que produirait un export PDF sur le même
projet — pas une approximation. `PdfStyleModal`, un doublon de cette même
maquette également jamais branché, a été supprimé.

**Divergences assumées (pas des bugs) :**
- *EPUB* reste un flux XHTML continu en une colonne, quel que soit
  `pageOrientation`/`columns` du modèle — une liseuse reflowable n'a pas de
  page physique.
- *ODT* n'a pas de vraie structure `<text:note>` : les notes sont des notes
  de fin en texte brut (mise en forme interne perdue) — limite déjà
  documentée avant ce lot, non résolue ici (hors périmètre : « notes PDF en
  bas de page » et équivalents restent pour un lot ultérieur).
- *PDF* garde ses notes en fin de document pour ce lot (pas de note en bas
  de page réelle — explicitement hors périmètre).
- Le séparateur de scène par défaut (`"* * *"`) est désormais identique
  entre DOCX (déjà en place), PDF, EPUB et ODT quand le modèle n'en définit
  pas un explicitement (Roman simple/Roman français gardent leurs valeurs
  propres, `"* * *"`/`"***"`).

### Les quatre usages de l'aperçu (PreviewView)

Chaque mode a un rôle strict, et aucun n'empiète sur le suivant :

| Mode | Contenu | Pages liminaires | Compile ? |
| --- | --- | --- | --- |
| **Scène** | le feuillet actif seul | non | non (lecture directe) |
| **Chapitre** | les scènes du chapitre, ordre du Binder | non | non (assemblage direct) |
| **Partie** | les chapitres et scènes de la partie | non | non (même code que Chapitre) |
| **Manuscrit** | le livre entier | oui | oui, à la demande |

Chapitre et Partie partagent **un seul** code d'assemblage
(`assembleFolder`) : seul le dossier de départ change. Il applique les
règles de présentation de `compile()` (ordre du Binder, titres de dossier
selon le preset, niveau de titre = profondeur du nœud, feuillets
`compile: false` ignorés) restreintes à un sous-arbre, sans rien compiler ni
écrire, et exclut explicitement le dossier `Front` — les pages liminaires
n'appartiennent à aucun chapitre.

**Le YAML n'atteint jamais le rendu.** `stripFrontmatter()`
(`services/frontmatter.ts`) est la définition unique de ce découpage,
partagée par la compilation et l'aperçu, appliquée **feuillet par feuillet
avant assemblage**. Ce n'était pas cosmétique : rendu en Markdown,
`---\ntitle: X\n---` produit un `<hr>` suivi d'un **titre setext `<h2>`**, et
`paginateManuscript()` force un saut de page avant tout `h1`/`h2` — le
premier mot du feuillet se retrouvait donc page 2 pendant que l'éditeur
était ligne 1. C'était la cause réelle du décalage de synchronisation, pas
une page de titre.

**Un seul CSS, des classes de mode.** Le gabarit reste produit par
`templateToCss()` pour les quatre modes ; seules quelques sections
conditionnelles distinguent les usages, via la classe posée sur le `<body>`
de l'iframe (`is-preview-mode-scene`…). En mode Scène, en-têtes et folios
(titre courant, « Page 3 sur 47 ») sont masqués : ce sont des éléments de
livre, pas de feuillet. Le HTML paginé reste exactement celui de l'export —
`paginateManuscript()` n'est pas touché.

### Barre et panneau Export de l'aperçu

La barre ne porte que du **contexte** : fil d'Ariane, « Ouvrir ce feuillet »
(icône, affichée seulement quand un feuillet est réellement lisible sous les
yeux), zoom, Export, Réglages. Pas de menu « ⋯ » : l'icône Réglages ouvre
directement l'onglet **Export** des paramètres Feuillets
(`settings/open-export-settings.ts` sélectionne `_activeSettingsTab` sur
l'instance de réglages déjà ouverte — ni modal ni vue intermédiaire).

Le panneau Export tient en six lignes — portée, éléments inclus, format,
gabarit, **Première page**, nom du fichier — plus l'action Exporter.

- **Première page** ne règle que le *contenu* et l'*inclusion* de la page de
  titre. Sa source de vérité est le **feuillet Front** lui-même : inclure ou
  exclure écrit `compile` dans son frontmatter (le fichier et ses métadonnées
  sont conservés), et chaque champ (titre, sous-titre, auteur, mention,
  image) réécrit sa ligne `:::rôle:` via `utils/title-roles.ts`. Aucune copie
  locale dans PreviewView, donc aucun état concurrent : l'aperçu se réactualise
  à partir du fichier, en conservant scroll et zoom.
- **Toute la mise en page** — en-têtes, pieds, numéros de page, première page
  différente, distances aux bords, marges, espacements, typographie — vit dans
  le modal `Mise en page visuelle` (`ui/layout-modal.ts`), qui écrit dans le
  gabarit actif et dans les réglages centraux lus **à l'identique** par
  l'aperçu et par les exports PDF/DOCX/ODT/EPUB.

### Défilement synchronisé Markdown ↔ aperçu (PreviewView)

`views/preview-scroll-sync.ts` contient toute la géométrie de
synchronisation (progression bornée, sections, repérage du panneau source),
sans aucun accès à Obsidian — donc testable seule
(`test/preview-scroll-sync.test.js`). `views/preview-view.ts` ne fait que
brancher les événements et écrire des `scrollTop`.

Hiérarchie appliquée, dans cet ordre :

1. **scène active** — quand un `data-source-path` existe pour le feuillet
   suivi (modes Chapitre, Partie, Manuscrit, repères posés par
   `preview-source-map.ts`), la progression est appliquée à SA section :
   scènes précédentes et pages liminaires ne comptent pas ;
2. **progression relative dans cette scène** ;
3. **progression globale** en dernier recours — c'est le cas du mode Scène,
   où elle est exacte puisque l'aperçu EST le feuillet.

Les deux extrémités sont toujours de vrais éléments défilables
(`.cm-scroller` côté éditeur, `.feuillets-preview-viewport` côté aperçu),
jamais la fenêtre.

**Limite assumée — pas de synchronisation par blocs ni par lignes.** Audit :
côté aperçu, `MarkdownRenderer` n'émet aucune information de ligne et
`stripObsidianCruft()` efface les `data-*` ; le seul mécanisme disponible
(paragraphe-marqueur, cf. `preview-source-map.ts`) casserait listes et blocs
de code s'il était posé par bloc. Côté éditeur, les `.cm-line` présents dans
le DOM ne portent pas leur numéro de ligne : seul `editor.cm`, API interne
non documentée, le donnerait. Ce qui débloquerait ce niveau : un repère de
ligne officiel dans l'API de rendu d'Obsidian. Une vue Scrivening est calée
sur ses blocs `data-path` dans le sens Scrivening → aperçu, et sur la
progression relative dans l'autre sens.

Aucune de ces routines ne rend ni ne compile quoi que ce soit : défiler et
zoomer ne déclenchent jamais `compile()`.

### Checklist manuelle de validation visuelle

Pas de moteur fiable de comparaison d'images dans ce dépôt : la fidélité
visuelle est vérifiée par des **tests structurels** (présence des bonnes
classes CSS, styles Word/ODF nommés, règles `page-break`, séparateur de
scène, contenu réellement compilé dans l'aperçu — voir
`test/export-templates.test.js`, `test/export-odt.test.js`,
`test/export-epub.test.js`, `test/export-pdf.test.js`,
`test/preview-modal.test.js`) et, pour le rendu proprement dit, par une
**inspection humaine**. Manuscrit de référence pour cette inspection (un
petit projet à créer une fois, réutilisable à chaque vérification) :

- une page de titre (rôles `:::rôle:`) ;
- une partie (dossier de niveau 1) contenant deux chapitres ;
- plusieurs scènes par chapitre, dont un paragraphe court et un paragraphe
  long (plusieurs lignes, pour juger l'interligne/justification) ;
- une citation (`> ...`) ;
- une liste à puces ;
- un séparateur de scène (`***`) ;
- une image portrait et une image paysage (juger le recadrage/la
  contrainte de taille) ;
- des caractères français et Unicode (guillemets « », apostrophes
  typographiques, tirets cadratins, accents, emoji) ;
- trois notes de bas de page (au moins une avec une mise en forme interne —
  gras/lien — pour juger ce qui survit par format) ;
- un saut de page explicite.

Pour chaque export (PDF, DOCX, EPUB, ODT) et l'aperçu, vérifier à l'œil :
titre/parties/chapitres/scènes visuellement cohérents entre eux ; retrait de
première ligne et espacement conformes au modèle choisi ; séparateur de
scène lisible (jamais un `<hr>` nu) ; images ni étirées ni débordantes ;
sauts de page aux bons endroits (partie/chapitre, jamais un titre seul en
bas de page) ; notes accessibles et, quand le format le permet, le lien de
retour fonctionnel ; caractères français/Unicode rendus sans mojibake.
Ouvrir le DOCX dans Word (pas seulement LibreOffice) pour confirmer que les
styles de titre apparaissent bien comme styles nommés dans le panneau
Styles, pas comme du formatage figé.

## Vérification

Chaque étape d'extraction a été suivie de `npm run build && npm test` sans tolérance de régression — et depuis l'introduction du typage opt-in, de `npx tsc -noEmit` (inclus dans `npm run build`). État courant : bundle de production à 951.2kb, 428/428 tests verts (`node:test`, fonctions pures de `utils/` et `services/`). `main.js` a regrandi au fil de l'ajout de panneaux entiers (Propriétés, Projet & export) plutôt que de rétrécir — la modularisation en `services/`/`views/` a absorbé la logique, pas fait disparaître le bootstrap qui les câble.

Règle tirée de ces extractions : **écrire les tests contre le comportement voulu, pas contre le code déplacé.** Quatre défauts réels ont été trouvés de cette façon, tous invisibles tant que le code restait dans sa vue ou sa classe — une année négative lue positive, un index de recherche pouvant se figer sur un texte périmé, un `label` de modèle d'export pouvant ne pas être une chaîne, et surtout `AlignmentType.JUSTIFY` (inexistant dans `docx`, donc `undefined`) qui privait de justification tout manuscrit .docx exporté avec le modèle « Classique ».

Ce dernier cas justifie à lui seul le découpage de `services/export-docx.js` : la fonction fautive était inchangée depuis toujours, mais impossible à charger sous Node tant qu'elle vivait dans un module dépendant d'`export-render.js`, donc d'Obsidian. C'est le déplacement vers `export-docx-style.js` — sans dépendance à Obsidian — qui l'a mise à portée de `tsc`.

Le découpage suivant, `services/docx-blocks.js` (DOM rendu → paragraphes `docx`), en a sorti deux autres du même tonneau, tous deux sur le traitement des images :

- `images.find(...)` était appelé sur la **Map** que renvoie `inlineImages` (export-render.js), qui n'a pas cette méthode — et l'appel était hors du `try`. Tout export .docx d'un manuscrit contenant une image échouait donc sur un `TypeError`. La Map étant indexée par le nœud `<img>`, `images.get(node)` remplace avantageusement l'ancienne heuristique `src.includes(path)`.
- `new ImageRun({ data, transformation })` sans `type` fait écrire à `docx` une ressource `word/media/<hash>.undefined`, que Word n'ouvre pas. Le `type` est désormais déduit de l'extension, et un format qu'OOXML ne sait pas empaqueter (webp, avif) est ignoré avec un avertissement plutôt qu'inséré sous une extension fausse.

Ces deux-là sont des séquelles de refactor : `inlineImages` est passé d'un tableau `{path, buffer}` à une Map `{bytes, ext}` sans que le consommateur .docx suive. Le genre de désynchronisation qu'un test d'intégration, même minimal, aurait attrapé — d'où `test/docx-blocks.test.js`, qui empaquette réellement un `.docx` et vérifie l'extension du média dans le zip.
