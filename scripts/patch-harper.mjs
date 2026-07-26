import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// harper.js (BinaryModuleImpl.getInitInput) lit le binaire WASM via
// `fs.readFile(new URL(binary).pathname, ...)`. `.pathname` renvoie le
// chemin *percent-encodé* (ex: un espace devient %20) et n'est jamais
// redécodé avant d'être passé à fs.readFile, qui cherche alors un fichier
// nommé littéralement "%20" au lieu d'un espace — échec systématique dès
// que le chemin du vault contient un caractère spécial (fréquent : vaults
// iCloud sous "Mobile Documents", espace inclus). Correctif upstream pas
// encore publié (harper.js 2.4.0) : on patche le fichier compilé après
// npm install, en attendant.
const target = fileURLToPath(new URL("../node_modules/harper.js/dist/BinaryModule-DTTQwokQ.js", import.meta.url));
const before = "fs.readFile(new URL(binary).pathname, (err, data) => {";
const after = "fs.readFile(decodeURIComponent(new URL(binary).pathname), (err, data) => {";

const content = readFileSync(target, "utf8");
if (content.includes(after)) {
  console.log("patch-harper: déjà appliqué.");
} else if (content.includes(before)) {
  writeFileSync(target, content.replace(before, after));
  console.log("patch-harper: correctif appliqué.");
} else {
  console.warn("patch-harper: motif attendu introuvable — harper.js a peut-être changé de version, vérifier manuellement.");
}
