/* Fabrique l'archive Grammalecte embarquée dans main.js.
 *
 * Les 21 fichiers du moteur (9,3 Mo) sont concaténés en UNE archive, puis
 * compressés en un seul flux brotli : partager le contexte de compression
 * entre les fichiers gagne nettement sur 21 flux séparés, et une seule
 * décompression au premier usage coûte moins qu'une par fichier.
 *
 * Format de l'archive décompressée :
 *
 *   [4 octets BE : longueur de l'index][index JSON utf8][octets des fichiers]
 *
 * l'index étant [[chemin, longueur], …] dans l'ordre de concaténation. Assez
 * simple pour être relu en dix lignes à l'exécution (voir
 * src/grammalecte-assets.ts), sans dépendance.
 *
 * La compression brotli de qualité 11 prend ~13 s : le résultat est mis en
 * cache sur disque, indexé par l'empreinte des sources, pour que `npm run
 * dev` ne la refasse pas à chaque rebuild. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

/** Fichiers exclus : documentation, rien que le moteur ne lit. */
const EXCLUDED = new Set(["README.txt"]);

const CACHE_DIR = ".cache";

function listFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (EXCLUDED.has(entry)) continue;
      // Chemins POSIX dans l'archive : ce sont des clés, pas des chemins disque.
      found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return found;
}

export class GrammalecteSourcesMissingError extends Error {
  constructor(resourcesDir) {
    super(
      `Sources Grammalecte introuvables dans ${resourcesDir}.\n` +
        "Lancez `npm run resources` une fois avant de construire le greffon " +
        "(les 9 Mo du moteur ne sont pas commités, voir README.md)."
    );
    this.name = "GrammalecteSourcesMissingError";
  }
}

/** Archive brotli des ressources, encodée en base64, prête à être insérée
 *  dans le bundle. Utilise un cache disque si les sources n'ont pas changé. */
export function buildArchiveBase64(resourcesDir, { cacheDir = CACHE_DIR } = {}) {
  if (!existsSync(path.join(resourcesDir, "graphspell", "_dictionaries", "fr-classic.json"))) {
    throw new GrammalecteSourcesMissingError(resourcesDir);
  }

  const names = listFiles(resourcesDir);
  const buffers = names.map((name) => readFileSync(path.join(resourcesDir, ...name.split("/"))));

  const fingerprint = createHash("sha256");
  for (let i = 0; i < names.length; i += 1) {
    fingerprint.update(names[i]);
    fingerprint.update(buffers[i]);
  }
  const cacheFile = path.join(cacheDir, `grammalecte-${fingerprint.digest("hex").slice(0, 16)}.b64`);
  if (existsSync(cacheFile)) {
    return { base64: readFileSync(cacheFile, "utf8"), files: names.length, cached: true };
  }

  const index = Buffer.from(
    JSON.stringify(names.map((name, i) => [name, buffers[i].length])),
    "utf8"
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(index.length, 0);
  const archive = Buffer.concat([header, index, ...buffers]);

  const compressed = brotliCompressSync(archive, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: archive.length,
    },
  });
  const base64 = compressed.toString("base64");

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, base64, "utf8");

  return { base64, files: names.length, cached: false, rawBytes: archive.length, packedBytes: compressed.length };
}
