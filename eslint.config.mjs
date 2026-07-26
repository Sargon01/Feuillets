import globals from "globals";

export default [
  {
    ignores: [
      "main.js",
      "main.js.map",
      "node_modules/",
      "resources/",
      "_cleanup-backups/",
      "Candide - Voltaire/",
      "coverage/"
    ]
  },
  {
    files: ["src/**/*.js", "scripts/**/*.mjs", "test/**/*.js", "esbuild.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2024
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  }
];
