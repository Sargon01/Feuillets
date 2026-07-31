# Feuillets Grammalecte

Greffon **compagnon** de [Feuillets](../README.md) : il ajoute la correction
grammaticale et orthographique française **hors ligne** (moteur
[Grammalecte](https://grammalecte.net/)) au studio d'écriture, sans que
Feuillets lui-même embarque le moindre moteur linguistique.

- Feuillets fournit le texte, l'affichage des signalements et la navigation.
- Ce greffon fournit uniquement le moteur.
- Sans ce greffon, Feuillets fonctionne normalement : l'onglet **Relecture**
  indique simplement qu'aucun module d'analyse n'est installé.

L'analyse est **entièrement locale** : aucune requête réseau, le texte ne
quitte jamais l'ordinateur. Elle ne se déclenche que sur commande explicite et
ne modifie jamais les fichiers analysés.

## Utilisation

1. Activer Feuillets, puis Feuillets Grammalecte.
2. Ouvrir un feuillet Markdown.
3. Palette de commandes → **Analyser le document courant** (ou **Analyser la
   sélection**). Ces commandes appartiennent à Feuillets : ce greffon n'en
   ajoute aucune qui les doublerait.
4. Les signalements s'affichent dans l'onglet **Relecture** du panneau
   Feuillets. Un clic ouvre le feuillet et sélectionne le passage concerné.

Le moteur est chargé **à la première analyse**, pas au démarrage d'Obsidian :
~0,2 s et ~43 Mo de mémoire à ce moment-là seulement, puis ~15 ms par
feuillet.

## Installation

Installation Obsidian standard, sans rien de particulier :

1. Créer `<coffre>/.obsidian/plugins/feuillets-grammalecte/`.
2. Y déposer `manifest.json` et `main.js`.
3. Recharger Obsidian, activer le greffon.

Le moteur Grammalecte est **embarqué dans `main.js`** : aucun dossier
`resources/` à copier, aucun téléchargement, aucune étape supplémentaire.
`main.js` pèse donc ~1,9 Mo — 9,3 Mo de règles et de dictionnaire compressés
en une archive brotli unique (1,45 Mo), encodée en base64.

## Développement

Les sources du moteur ne sont **pas** commitées (9,3 Mo). Elles sont
nécessaires pour **construire** le greffon (pas pour l'utiliser) et
s'extraient de l'historique Git de Feuillets, sans réseau :

```bash
npm run resources
```

Puis :

```bash
npm run lint       # eslint + typecheck
npm test           # node --test, sans étape de compilation
npm run build      # typecheck + archive + esbuild -> main.js
```

Le premier `build` compresse l'archive en brotli qualité 11 (~13 s). Le
résultat est mis en cache dans `.cache/`, indexé par l'empreinte des sources :
les builds suivants prennent ~50 ms.

`npm test` et `npm run lint` fonctionnent **sans** les sources du moteur : les
tests qui chargent Grammalecte pour de bon se déclarent `skip` si
`resources/grammalecte/` est absent.

Les tests s'exécutent directement sur les sources TypeScript (Node ≥ 22 sait
retirer les types), d'où les imports en `.ts` et l'absence de dossier de
compilation intermédiaire.

### Structure

```
feuillets-grammalecte/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── eslint.config.mjs
├── versions.json
├── main.ts                                 greffon : (dés)enregistrement
├── scripts/
│   ├── restore-grammalecte-resources.mjs   sources <- historique Git (dev)
│   └── build-grammalecte-archive.mjs       sources -> archive brotli (build)
├── src/
│   ├── feuillets-api.ts                    détection + types partagés
│   ├── grammalecte-archive.ts              placeholder, rempli au build
│   ├── grammalecte-assets.ts               reconstitution de l'archive
│   ├── grammalecte-adapter.ts              moteur (vm) + conversion
│   ├── grammalecte-provider.ts             fournisseur, chargement paresseux
│   └── settings.ts                         3 réglages
└── test/
    ├── grammalecte-adapter.test.ts
    ├── grammalecte-assets.test.ts
    ├── plugin.test.ts
    └── obsidian-stub.mjs                   + hooks de résolution
```

Pas de `styles.css` : ce greffon n'a aucune interface propre, il réutilise
l'onglet de résultats de Feuillets.

### Embarquement du moteur

`src/grammalecte-archive.ts` est un placeholder committé qui n'exporte qu'une
chaîne vide. Au build, un greffon esbuild (`esbuild.config.mjs`) remplace
intégralement ce module par la même constante remplie avec l'archive.
Conséquences : rien de généré n'entre dans le dépôt, le typecheck et les tests
tournent sans les 9 Mo, et le bundle livré est autonome.

L'archive n'est **ni décodée ni décompressée au démarrage** : la chaîne
base64 reste inerte jusqu'au premier `analyze()`, qui appelle
`ensureEngine()` → `loadEmbeddedAssets()` → `loadGrammalecteEngine()`. Les
sources ne sont jamais concaténées dans le scope du greffon : chaque fichier
est évalué dans un contexte `vm` dédié, dont le realm a ses propres
`String.prototype` et `RegExp.prototype` — les extensions `gl_*` de
Grammalecte n'atteignent jamais Obsidian.

### Types partagés

`src/feuillets-api.ts` importe les types de l'API **directement depuis le
noyau** (`import type ... from "../../src/api/text-analysis.ts"`). L'import
est effacé à la compilation : aucun octet de Feuillets n'entre dans ce
bundle, mais le typecheck casse immédiatement si le contrat change. C'est le
seul point de couplage — si ce dossier était extrait dans son propre dépôt,
c'est la seule ligne à remplacer (par un `feuillets-api.d.ts` vendu).

## Licence

GPL-3.0, comme Feuillets et comme Grammalecte.
