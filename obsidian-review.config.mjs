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
    },
  },
];
