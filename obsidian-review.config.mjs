/* Configuration ESLint qui reproduit EN LOCAL la revue automatisée du
   tableau de bord développeur d'Obsidian (community.obsidian.md).
   À lancer avant chaque soumission :

       npm run lint:obsidian

   Elle n'est pas chargée automatiquement par ESLint : le nom de fichier ne
   correspond pas au motif `eslint.config.*`, et c'est volontaire.
   `eslint.config.mjs` (le lint courant, `npm run lint`) doit rester
   chargeable sans dépendances installées — un `import` vers un paquet
   absent fait planter ESLint au chargement de la config, avant même
   d'analyser un fichier. C'est précisément ce qui a rendu illisibles
   plusieurs revues du tableau de bord.

   Deux pièges qui font silencieusement rendre « 0 problème » :
   - `obsidianmd/no-unsupported-api` lit les annotations `@since` de
     `obsidian.d.ts` et les compare au `minAppVersion` de `manifest.json` :
     il faut donc le paquet `obsidian` installé ET le manifeste à la racine ;
   - cette règle ne fait pas partie de `recommended`, elle est activée
     explicitement ci-dessous.

   En cas de doute sur une remarque, le code des règles est lisible dans
   node_modules/eslint-plugin-obsidianmd/dist/lib/rules/ — toutes ne sont
   pas pertinentes pour ce dépôt, et l'une d'elles a déjà planté sur du
   code parfaitement valide. */

import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: [
      "main.js",
      "main.js.map",
      "node_modules/",
      ".test-dist/",
      "resources/",
      "_cleanup-backups/",
      "Candide - Voltaire/",
      "coverage/",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    // Limité à src/ : c'est ce que couvre tsconfig.json, et les règles
    // typées ont besoin du programme TypeScript pour fonctionner.
    files: ["src/**/*.js", "src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      "obsidianmd/no-unsupported-api": "error",

      /* `no-undef` (règle JS de base, PAS une règle obsidianmd) : désactivée
         ici pour les fichiers TypeScript, et nulle part ailleurs. Cause
         vérifiée avec `eslint --print-config` : le preset `recommended` du
         plugin la remet lui-même à "warn" pour .ts (son bloc "off" cible un
         motif `files` en tableau imbriqué qui ne matche jamais un .ts seul ;
         un bloc plus tardif, à motif simple, la réarme). Conséquence dans ce
         dépôt : 150+ faux positifs sur des interfaces globales de
         `src/types.d.ts` (FeuilletsSettings, ExportTemplate, TitlePageStyle…)
         — le scope-manager de @typescript-eslint analyse chaque fichier
         isolément et ignore les déclarations globales portées par un AUTRE
         fichier .d.ts, contrairement au compilateur TypeScript. Ce n'est pas
         un trou de couverture : `tsc -noEmit` (déjà lancé par `npm run lint`
         ET `npm run build`) vérifie exhaustivement les identifiants non
         définis — valeurs ET types, tous fichiers confondus — ce que
         `no-undef` ne fait qu'approximer sans cette vue d'ensemble. Lister
         les types un par un dans `languageOptions.globals` marcherait pour
         l'état actuel de types.d.ts, mais redeviendrait incomplet au premier
         type global ajouté : ce n'est pas centralisé, juste reporté.
         Aucun fichier .js ne vit sous src/ (tout est .ts) : rien n'est perdu
         côté JavaScript non typé par cette désactivation. */
      "no-undef": "off",

      /* Calibrage des sévérités sur ce que le tableau de bord considère
         réellement comme bloquant. Sans ça, ces règles-là remontent en
         « error » ici alors qu'Obsidian les classe en « Warning » — on
         croirait à 129 problèmes bloquants là où il n'y en a aucun.
         Elles restent affichées en avertissement, rien n'est masqué.

         Relevé sur la revue de juillet 2026 ; à revoir si Obsidian change
         sa grille. Étaient classées « Error » de leur côté :
         no-unsupported-api, no-static-styles-assignment,
         settings-tab/no-manual-html-headings, no-forbidden-elements et
         les écritures innerHTML — toutes laissées en erreur ici. */
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "eslint-comments/disable-enable-pair": ["error", { "allowWholeFile": true }],
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-misleading-character-class": "warn",
      "no-irregular-whitespace": "warn",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          ignoreWords: [
            "Feuillets",
            "Carnet",
            "Front",
            "Word",
            "OpenDocument",
            "DOCX",
            "ODT",
            "EPUB",
            "ZIP",
          ],
          ignoreRegex: [
            "^Roman1/Manuscrit$",
            "^tag1, tag2, tag3$",
            "^AAAA-MM-JJ$",
            "^US Letter$",
            "^Choisis « Enregistrer au format PDF » dans la boîte d'impression\\.$",
          ],
        },
      ],
    },
  },
  {
    // Frontières de données et utilitaires déjà typés : ici, un `any` qui
    // traverse le module est directement actionnable. Les autres services
    // restent progressivement typables avant d'entrer dans cette liste.
    files: [
      "src/services/frontmatter.ts",
      "src/services/folder-structure.ts",
      "src/utils/core.ts",
      "src/utils/text-metrics.ts",
      "src/utils/footnotes.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  {
    // Les vues et modales manipulent directement les objets dynamiques
    // d'Obsidian et du DOM. Ces alertes y sont trop bruitées pour être
    // actionnables ; les règles de sûreté propres à Obsidian restent actives.
    files: ["src/views/**/*.ts", "src/ui/**/*.ts", "src/settings/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
];
