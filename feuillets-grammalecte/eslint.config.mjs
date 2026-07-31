/* Même approche que le dépôt Feuillets : globals listés à la main plutôt
   qu'importés du paquet npm "globals", pour qu'un scanner tiers qui clone le
   dépôt sans `npm install` ne fasse pas planter le chargement de la config. */
const sharedGlobals = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  globalThis: "readonly",
  HTMLElement: "readonly",
  // Node : require("fs")/require("vm") côté desktop, et scripts CLI.
  require: "readonly",
  module: "readonly",
  process: "readonly",
  __dirname: "readonly",
  URL: "readonly",
};

export default [
  {
    ignores: ["main.js", "main.js.map", "node_modules/", "resources/"],
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
    },
  },
];
