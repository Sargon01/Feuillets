import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// harper.js (BinaryModuleImpl.getInitInput) a deux problèmes dans un
// contexte Obsidian/Electron desktop, tous deux dans cette même fonction :
//
// 1. Elle lit le binaire WASM via `fs.readFile(new URL(binary).pathname, ...)`.
//    `.pathname` renvoie le chemin *percent-encodé* (un espace devient %20)
//    et n'est jamais redécodé avant fs.readFile, qui cherche alors un
//    fichier nommé littéralement "%20" — échec systématique dès que le
//    chemin du vault contient un espace (fréquent : vaults iCloud sous
//    "Mobile Documents").
// 2. Elle charge "fs" via un `import("fs")` dynamique (pensé pour un
//    bundler webpack/vite en environnement Node "pur"). Dans le bundle CJS
//    d'un plugin Obsidian, cet import() dynamique tente une résolution ESM
//    de "fs" côté renderer Electron, qui échoue ("Failed to resolve module
//    specifier 'fs'") — alors que require("fs") fonctionne très bien ici
//    (utilisé ailleurs dans nos propres checkers).
//
// Correctif upstream pas encore publié (harper.js 2.4.0) : on remplace la
// fonction entière par une version synchrone basée sur require(), après
// npm install.
const target = fileURLToPath(new URL("../node_modules/harper.js/dist/BinaryModule-DTTQwokQ.js", import.meta.url));

const fixed = `function getInitInput(binary) {
  if (typeof process !== "undefined" && binary.startsWith("file://")) {
    const fs = require("fs");
    return new Promise((resolve, reject) => {
      fs.readFile(decodeURIComponent(new URL(binary).pathname), (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    });
  }
  return binary;
}`;

// Les deux variantes qu'on peut trouver selon que le patch a déjà tourné
// une fois avec l'ancienne version (simple décodage) ou jamais.
const variants = [
  `function getInitInput(binary) {
  if (typeof process !== "undefined" && binary.startsWith("file://")) {
    return import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      "fs"
    ).then(
      (fs) => new Promise((resolve, reject) => {
        fs.readFile(new URL(binary).pathname, (err, data) => {
          if (err) reject(err);
          resolve(data);
        });
      })
    );
  }
  return binary;
}`,
  `function getInitInput(binary) {
  if (typeof process !== "undefined" && binary.startsWith("file://")) {
    return import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      "fs"
    ).then(
      (fs) => new Promise((resolve, reject) => {
        fs.readFile(decodeURIComponent(new URL(binary).pathname), (err, data) => {
          if (err) reject(err);
          resolve(data);
        });
      })
    );
  }
  return binary;
}`,
];

const content = readFileSync(target, "utf8");
if (content.includes(fixed)) {
  console.log("patch-harper: déjà appliqué.");
} else {
  const variant = variants.find((v) => content.includes(v));
  if (variant) {
    writeFileSync(target, content.replace(variant, fixed));
    console.log("patch-harper: correctif appliqué.");
  } else {
    console.warn("patch-harper: motif attendu introuvable — harper.js a peut-être changé de version, vérifier manuellement.");
  }
}
