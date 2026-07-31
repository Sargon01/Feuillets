import esbuild from "esbuild";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";
import { buildArchiveBase64 } from "./scripts/build-grammalecte-archive.mjs";

/* Les deux graphies doivent rester externes : `require("vm")` comme
   `require("node:vm")`. builtinModules ne renvoie que la forme nue. */
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const prod = process.argv[2] === "production";

/* Grammalecte est embarqué DANS main.js : les 9,3 Mo de règles et de
   dictionnaire sont compressés en une archive brotli unique (~1,5 Mo),
   encodée en base64, et substituée au placeholder src/grammalecte-archive.ts
   au moment du build. Le greffon s'installe donc comme n'importe quel greffon
   Obsidian — manifest.json + main.js — sans dossier resources/ à copier ni
   téléchargement. L'archive n'est décompressée qu'à la première analyse
   (voir src/grammalecte-assets.ts). */
const embedGrammalecte = {
  name: "embed-grammalecte",
  setup(build) {
    const placeholder = path.resolve("src/grammalecte-archive.ts");
    build.onLoad({ filter: /grammalecte-archive\.ts$/ }, (args) => {
      if (path.resolve(args.path) !== placeholder) return null;
      const { base64, files, cached, packedBytes } = buildArchiveBase64("resources/grammalecte");
      console.log(
        `[embed-grammalecte] ${files} fichiers, archive ${(base64.length / 1e6).toFixed(2)} Mo en base64` +
          (cached ? " (cache)" : ` (${(packedBytes / 1e6).toFixed(2)} Mo compressés)`)
      );
      return {
        contents: `export const GRAMMALECTE_ARCHIVE_BASE64 = ${JSON.stringify(base64)};\n`,
        loader: "ts",
      };
    });
  },
};

const options = {
  plugins: [embedGrammalecte],
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  minify: false, // code auditable, comme dans Feuillets
  logLevel: "info",
};

if (prod) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
}
