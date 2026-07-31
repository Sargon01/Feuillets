/* Restaure le moteur Grammalecte dans resources/grammalecte/.
 *
 * Les 9,2 Mo de règles et de dictionnaire ne sont pas commités (voir
 * .gitignore) : ils vivent déjà dans l'historique Git de Feuillets, à
 * l'arborescence `resources/grammalecte/` du commit ci-dessous — le dernier
 * avant leur retrait du dépôt. On les en extrait, sans réseau, sans archive
 * à vérifier, et de façon reproductible.
 *
 * `git cat-file` plutôt que `git checkout` : on écrit uniquement dans ce
 * dossier-ci, sans jamais toucher à l'index ni à l'arbre de travail. */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// becbad7 « feat(grammar): download local engines on demand instead of
// bundling them » a retiré resources/ du dépôt : son parent le contient
// encore, intact.
const SOURCE_REF = "becbad7^";
const SOURCE_PREFIX = "resources/grammalecte/";

const companionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(companionDir, "..");
const targetDir = path.join(companionDir, "resources", "grammalecte");

const git = (args, options = {}) =>
  execFileSync("git", args, { cwd: repoDir, maxBuffer: 64 * 1024 * 1024, ...options });

let entries;
try {
  entries = git(["ls-tree", "-r", "--name-only", SOURCE_REF, "--", SOURCE_PREFIX], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch (error) {
  console.error(
    `Impossible de lire ${SOURCE_REF} dans ${repoDir}. ` +
      "Ce script doit tourner depuis une copie complète du dépôt Feuillets."
  );
  console.error(error.message);
  process.exit(1);
}

if (entries.length === 0) {
  console.error(`Aucun fichier sous ${SOURCE_PREFIX} dans ${SOURCE_REF}.`);
  process.exit(1);
}

let bytes = 0;
for (const entry of entries) {
  const relative = entry.slice(SOURCE_PREFIX.length);
  const destination = path.join(targetDir, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  // Buffer brut : le dictionnaire est un JSON compact, pas du texte à relire.
  const content = git(["cat-file", "blob", `${SOURCE_REF}:${entry}`], { encoding: "buffer" });
  writeFileSync(destination, content);
  bytes += content.length;
}

console.log(
  `${entries.length} fichiers restaurés dans resources/grammalecte/ ` +
    `(${(bytes / 1024 / 1024).toFixed(1)} Mo).`
);
