import esbuild from "esbuild";
import process from "node:process";
/* `node:module` plutôt que le paquet `builtin-modules` : Node fournit la
   même liste nativement depuis longtemps, et la revue Obsidian signale
   `builtin-modules` comme dépendance à remplacer (module-replacements).
   Une dépendance de moins à installer et à auditer. */
import { builtinModules } from "node:module";

/* Les deux graphies doivent être externes : `require("fs")` comme
   `require("node:fs")`. builtinModules ne renvoie que la forme nue. */
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const prod = process.argv[2] === "production";

const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@codemirror/language", ...builtins],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  minify: false, // voir CHANGELOG 1.3.0 : code auditable, exigence de la revue Obsidian
  logLevel: "info"
};

if (prod) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
}
