# Architecture technique — Feuillets

> **Document interne de maintenance.**
>
> Cette page utilise les noms réels du code. Elle n’est pas destinée au parcours de découverte des auteurs.

## Vue d’ensemble

Feuillets est aujourd’hui un projet **TypeScript** compilé vers un bundle Obsidian `main.js`.

Le point d’entrée est :

```text
src/main.ts
```

Le build :

1. vérifie TypeScript ;
2. bundle `src/main.ts` avec esbuild ;
3. produit un `main.js` CommonJS non minifié.

Le bundle généré n’est pas le fichier source à modifier.

## Arborescence fonctionnelle

```text
src/
├── main.ts
├── api/
│   └── text-analysis.ts
├── integrations/
├── i18n/
│   ├── fr.ts
│   ├── en.ts
│   └── index.ts
├── services/
├── settings/
├── ui/
├── utils/
├── views/
├── default-settings.ts
├── constants.ts
└── types.d.ts
```

## `main.ts` — orchestration du plugin

`src/main.ts` reste le point qui connaît l’instance `Plugin` d’Obsidian.

Il orchestre notamment :

- chargement et migration des réglages ;
- enregistrement des vues ;
- commandes ;
- événements du coffre et du workspace ;
- raccourcis et intégrations ;
- façades utilisées par les vues ;
- sauvegarde automatique ;
- API publique d’analyse de texte ;
- rafraîchissement coordonné des surfaces Feuillets.

Une logique métier qui peut recevoir `app`, `settings` et des paramètres explicites doit de préférence vivre dans un service plutôt que grossir `main.ts`.

## Vues principales

### `views/feuillets-view.ts`

Le **Classeur**.

Responsabilités visibles :

- navigation du manuscrit ;
- double volet dossiers/fichiers ;
- recherche et filtres ;
- sélection multiple ;
- menus de dossiers et feuillets ;
- lancement des portées Aperçu/Compilation ;
- onboarding et gestion des projets.

### `views/board-view.ts`

Les représentations **Cartes / Plan / Chemin de fer / Chronologie**.

Cette vue ne possède pas un second manuscrit : elle projette les mêmes fichiers selon un autre besoin.

### `views/preview-view.ts`

L’**Aperçu**.

Il gère :

- portées de lecture ;
- rendu paginé ;
- barre d’outils ;
- zoom ;
- synchronisation avec l’éditeur ;
- fil d’Ariane ;
- panneau Export.

### `views/sidebar-feuillets-view.ts`

L’**Inspecteur unifié**.

Les onglets courants sont :

```text
notes
research
journal
project   → libellé public : Édition
analyse
relecture
```

L’identifiant historique `project` est conservé pour compatibilité de réglages. L’onglet Édition agrège les sous-vues de révision DOCX et de documents éditoriaux.

Les anciennes vues individuelles restent enregistrables uniquement là où la compatibilité de workspace l’exige ; elles ne doivent pas redevenir une seconde architecture d’interface.

### Sous-vues de l’Inspecteur

- `notes-view.ts` — notes, propriétés, notes de bas de page, contexte ;
- `research-view.ts` / `base-feuillets-view.ts` — Recherche ;
- `journal-view.ts` — Journal ;
- `docx-review-view.ts` — révisions DOCX ;
- `edition-docs-view.ts` — documents `_Edition` ;
- `analysis-view.ts` — analyse de prose ;
- `text-analysis-view.ts` — signalements d’un fournisseur compagnon.

## Racines de projet

C’est une zone où les noms historiques peuvent prêter à confusion.

### Racine du manuscrit

`settings.projectFolder` pointe historiquement vers ce que le code appelle souvent `getProjectFolder()`.

Pour un projet créé par Feuillets :

```text
Mon projet/
└── Manuscrit/   ← settings.projectFolder
```

Le Binder et la compilation parcourent cette racine éditoriale.

### Racine réelle du projet

Pour un projet structuré :

```text
Mon projet/
├── Manuscrit/
├── _Recherche/
├── _Ressources/
└── ...
```

la racine réelle est `Mon projet`.

`getProjectRoot()` existe pour les opérations qui ont réellement besoin de ce volume.

### Dossier utilisé tel quel

Feuillets accepte aussi :

```text
Articles/
├── A.md
└── B.md
```

avec `settings.projectFolder = "Articles"`.

Il ne faut donc **jamais** supposer que `root.parent` est automatiquement la racine du projet.

Cette distinction gouverne en particulier `_Sortie` et `_Backups`.

## Dossiers conventionnels

La création des noms courants est centralisée dans `getFeuilletsFolderNames()`.

Selon la langue :

- `_Recherche` / `_Research` ;
- `_Ressources` / `_Resources`.

Autres noms techniques stables :

- `_Snapshots` ;
- `_Backups` ;
- `_Journal` ;
- `_Edition`.

`_Versions` et `_Sortie` sont également des espaces techniques utilisés par les services concernés.

Les variantes historiques sans underscore ou dans l’autre langue peuvent être **reconnues** sans être renommées.

Principe :

> création moderne ≠ migration destructive.

## Front matter

`services/frontmatter.ts` est le point central pour :

- lecture du frontmatter ;
- titres ;
- titres courts ;
- labels ;
- tags ;
- valeurs héritées/alias ;
- retrait du frontmatter du corps texte.

Ne pas introduire une regex locale de YAML dans un autre service lorsque ce helper répond déjà au besoin.

`labelOf()` représente le label principal et se fonde sur `labelsOf()`, qui garde l’ensemble des labels.

## Recherche

`services/research.ts` résout notamment :

- racine Recherche ;
- dossier chronologique/événements ;
- apparitions ;
- fichiers de Recherche.

Les racines reconnues incluent les variantes :

```text
_Recherche
_Research
Recherche
Research
```

avec la restriction historique voulue : les variantes sans underscore ne doivent pas apparaître comme faux dossiers du manuscrit.

Pour les événements/chronologie, les variantes historiques FR/EN restent reconnues sans création de doublon.

`utils/project-modes.ts` définit les catégories proposées par Fiction, Non-fiction et Libre et leurs variantes.

## Contexte

La logique Contexte est distribuée entre services spécialisés :

- `context-index.ts` ;
- `context-matcher.ts` ;
- `context-window.ts` ;
- `context-content-cache.ts` ;
- `context-content-matcher.ts`.

`notes-view.ts` orchestre leur rendu.

Séparer ces services permet de tester la correspondance et le cache sans devoir rendre l’UI.

## Carnet et Canvas

La famille `services/canvas-*.ts` couvre :

- fichier Canvas du projet ;
- passerelle d’idées ;
- arbre d’idées ;
- création de chapitre ;
- split/merge ;
- runtime Canvas.

`integrations/advanced-canvas.ts` ajoute uniquement l’adaptation facultative à Advanced Canvas.

Le Canvas natif reste la base.

## Compilation : `CompileScope`

`services/compile-scope.ts` définit quatre portées :

```ts
{ type: "project", ... }
{ type: "file", ... }
{ type: "folder", ... }
{ type: "selection", ... }
```

Le résolveur :

- développe les descendants Markdown d’un dossier ;
- déduplique les fichiers ;
- conserve l’ordre du Binder ;
- exclut les dossiers techniques.

Les vues doivent créer une `CompileScope` puis laisser le service résoudre les fichiers, plutôt que réimplémenter leur propre parcours.

## Compilation et export

`services/compile-export.ts` orchestre :

- résolution de la portée ;
- lecture des feuillets ;
- retrait du frontmatter ;
- titres ;
- pages Front ;
- transformations textuelles ;
- notes de bas de page ;
- appel du moteur de format.

Formats courants :

```text
md
epub
docx
odt
pdf
```

Services de format :

- `export-docx.ts`
- `export-epub.ts`
- `export-odt.ts`
- `export-pdf.ts`
- `export-render.ts`

Les modèles partagés vivent notamment dans `utils/export-templates.ts` et `services/export-templates-custom.ts`.

### `_Sortie`

Pour un `Manuscrit` structuré, `_Sortie` est placé dans la racine réelle du projet.

Pour un dossier utilisé tel quel, `_Sortie` reste un enfant du dossier actif.

Cette règle ne doit pas être remplacée par `root.parent || root`.

## Sauvegardes

`services/project-backup.ts` centralise la racine de sauvegarde.

Règle actuelle :

```text
root.name === "Manuscrit"
et parent réel hors racine du coffre
    → sauvegarder le parent
sinon
    → sauvegarder root
```

`_Backups` est créé sous cette même racine et exclu du ZIP.

Cette règle protège les dossiers « utilisés tels quels » contre l’inclusion accidentelle de leurs frères ou de la racine du coffre.

## Instantanés et versions

`services/project-files.ts` gère notamment :

- instantanés ;
- duplication du manuscrit dans `_Versions` ;
- copie de l’ordre de Binder ;
- création/initialisation de structure ;
- `_Edition`.

Une version du manuscrit ne duplique pas automatiquement la Recherche.

## Analyse de prose et analyse linguistique

Deux concepts doivent rester séparés.

### Analyse intégrée

`views/analysis-view.ts` et les utilitaires associés calculent des métriques locales sur le texte.

### Fournisseur compagnon

`api/text-analysis.ts` définit `TextAnalysisProvider`.

Le contrat contient :

- identifiant ;
- nom ;
- `analyze()` ;
- options facultatives d’ignorance/apprentissage ;
- analyse linguistique facultative.

Les résultats sont validés à l’exécution : un plugin tiers peut être écrit en TypeScript, mais le runtime ne doit jamais faire confiance à ses offsets sans contrôle.

`FEUILLETS_API_VERSION` versionne ce contrat.

## Internationalisation

`i18n/index.ts` choisit la langue.

Les dictionnaires :

```text
src/i18n/fr.ts
src/i18n/en.ts
```

Toute chaîne utilisateur nouvelle doit être présente dans les deux.

Les identifiants persistés ne doivent pas changer avec la langue.

## Tests

Les tests vivent dans `test/`.

Le flux par défaut :

```bash
npm test
```

compile le projet de test dans `.test-dist`, prépare le stub Obsidian puis exécute `node:test`.

Les tests privilégient les fonctions/services purs lorsque possible, et utilisent des stubs ciblés pour les contrats Obsidian.

## Build et lint

```bash
npm run build
npm run lint
npm run lint:obsidian
```

Le build TypeScript est bloquant avant le bundle de production.

`esbuild.config.mjs` :

- entrée : `src/main.ts` ;
- format : CommonJS ;
- cible : ES2018 ;
- bundle non minifié ;
- APIs hôtes/Node externes au bundle selon la configuration.

## Règles d’architecture à préserver

1. **Une seule source de vérité pour une règle métier.**
   - frontmatter → `frontmatter.ts`
   - portées → `compile-scope.ts`
   - noms conventionnels → helpers de structure
   - sauvegarde → `project-backup.ts`

2. **Pas de remontée automatique au parent d’un projet libre.**

3. **Pas de migration destructive de dossiers historiques.**

4. **Une vue ne recrée pas son propre ordre du manuscrit.**

5. **Les modules compagnons restent découplés du noyau.**

6. **Une correction locale ne doit pas devenir un prétexte à réarchitecturer le dépôt.**

## Documentation technique liée

- [Sécurité et ressources externes](SECURITY_AND_EXTERNAL_RESOURCES.md)
- [Maintenance documentaire](NOTE-DE-MAINTENANCE.md)
- [Politique de sécurité](../SECURITY.md)
- [Contribuer](../CONTRIBUTING.md)
