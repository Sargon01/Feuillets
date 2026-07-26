// Globals listés à la main plutôt qu'importés du paquet npm "globals" :
// si le scanner d'un service tiers (ex. la revue automatisée d'Obsidian)
// clone le dépôt et lance eslint sans `npm install` au préalable, un
// `import` vers une dépendance non installée fait planter le chargement
// de la config elle-même — avant même d'analyser un seul fichier source.
// C'était très probablement la vraie cause de l'erreur fatale "Source
// code review" du scanner (aucun fichier/ligne jamais cité, cohérent
// avec un crash au chargement de la config plutôt qu'une vraie erreur de
// parsing).
const sharedGlobals = {
  // Browser / Electron renderer
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  WebAssembly: "readonly",
  Blob: "readonly",
  FormData: "readonly",
  AbortController: "readonly",
  MutationObserver: "readonly",
  DOMParser: "readonly",
  performance: "readonly",
  crypto: "readonly",
  CSS: "readonly",
  Event: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  getComputedStyle: "readonly",
  // Node (require("fs")/require("vm") etc. côté desktop, scripts CLI)
  require: "readonly",
  module: "readonly",
  process: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  global: "readonly",
  // Timers / console — communs aux deux environnements
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  globalThis: "readonly",
};

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
  {
    files: ["src/**/*.js", "scripts/**/*.mjs", "test/**/*.js", "esbuild.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // "warn" plutôt que "error" : la liste de globals ci-dessus est
      // tenue à la main (pas exhaustive comme le paquet "globals" l'était)
      // — un global légitime oublié ne doit pas faire échouer le lint.
      "no-undef": "warn",
    },
  },
];
