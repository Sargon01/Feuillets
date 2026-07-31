/* Reconstitution des ressources Grammalecte embarquées dans le bundle.
 *
 * L'archive (voir scripts/build-grammalecte-archive.mjs) est une chaîne
 * base64 inerte tant qu'on n'y touche pas : elle n'est décodée et
 * décompressée qu'au premier chargement du moteur, jamais au démarrage
 * d'Obsidian. Aucune écriture disque, aucun réseau — tout se fait en
 * mémoire. */

/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : zlib, seulement au premier usage */
/* global require -- fourni par l'environnement Electron */

import { GRAMMALECTE_ARCHIVE_BASE64 } from "./grammalecte-archive.ts";

/** Ressources reconstituées : chemin POSIX ("fr/conj.js") -> contenu texte. */
export type AssetMap = ReadonlyMap<string, string>;

export class GrammalecteArchiveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GrammalecteArchiveError";
  }
}

type ArchiveIndex = Array<[string, number]>;

/** Décode une archive base64 vers ses fichiers. Exportée séparément pour
 *  être testable sans les 9 Mo réels. */
export function decodeArchive(base64: string): AssetMap {
  if (!base64) {
    throw new GrammalecteArchiveError(
      "Le moteur Grammalecte n'a pas été embarqué dans ce build. " +
        "Reconstruisez le greffon avec `npm run build` (voir README.md)."
    );
  }

  const zlib = require("zlib") as typeof import("zlib");
  let raw: Buffer;
  try {
    raw = zlib.brotliDecompressSync(Buffer.from(base64, "base64"));
  } catch (error) {
    throw new GrammalecteArchiveError("Archive Grammalecte illisible (décompression impossible).", {
      cause: error,
    });
  }

  if (raw.length < 4) throw new GrammalecteArchiveError("Archive Grammalecte tronquée.");

  const indexLength = raw.readUInt32BE(0);
  let index: ArchiveIndex;
  try {
    index = JSON.parse(raw.subarray(4, 4 + indexLength).toString("utf8")) as ArchiveIndex;
  } catch (error) {
    throw new GrammalecteArchiveError("Index de l'archive Grammalecte illisible.", { cause: error });
  }

  const assets = new Map<string, string>();
  let offset = 4 + indexLength;
  for (const [name, length] of index) {
    const end = offset + length;
    if (end > raw.length) {
      throw new GrammalecteArchiveError(`Archive Grammalecte tronquée au fichier « ${name} ».`);
    }
    assets.set(name, raw.subarray(offset, end).toString("utf8"));
    offset = end;
  }
  return assets;
}

/** Les ressources embarquées dans CE bundle. */
export function loadEmbeddedAssets(): AssetMap {
  return decodeArchive(GRAMMALECTE_ARCHIVE_BASE64);
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
