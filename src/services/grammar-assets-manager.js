/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : modules Node (fs/path) et requestUrl, charges seulement cote desktop et seulement au moment du telechargement des moteurs */
/* global require -- défini par environnement */
import JSZip from "jszip";
import { pluginAbsoluteDir } from "../utils/plugin-dir.js";

// Grammalecte (FR) et Harper (EN) sont trop lourds (~26 Mo à eux deux) pour
// être commités dans Feuillets lui-même : l'installeur standard d'Obsidian
// (Store communautaire, BRAT) ne télécharge que main.js/manifest.json/
// styles.css depuis une release — un dossier resources/ n'arriverait
// jamais chez l'utilisateur. On les héberge donc à part et on les
// télécharge à la demande, une seule fois, en cache sur disque ensuite :
// un fetch() ponctuel vers notre propre release, pas une dépendance API
// externe permanente comme LanguageTool.
const ASSETS_VERSION = "v1";
const ASSETS_BASE_URL = "https://github.com/Sargon01/feuillets-assets/releases/download/v1";

const ENGINES = {
  grammalecte: {
    url: `${ASSETS_BASE_URL}/grammalecte.zip`,
    dir: "grammalecte",
    // Fichier-clé vérifié après extraction pour confirmer qu'elle a réussi.
    marker: "graphspell/_dictionaries/fr-classic.json",
  },
  harper: {
    url: `${ASSETS_BASE_URL}/harper.zip`,
    dir: "harper",
    marker: "harper_wasm_slim_bg.wasm",
  },
};

function resourcesDir(app, manifest) {
  const path = require("path");
  return path.join(pluginAbsoluteDir(app, manifest), "resources");
}

function versionMarkerPath(app, manifest, engine) {
  const path = require("path");
  return path.join(resourcesDir(app, manifest), `.${engine}-version.json`);
}

/** true si le moteur donné ("grammalecte" | "harper") est déjà téléchargé
 * et à la bonne version — synchrone, pensé pour un check rapide au rendu
 * des réglages ou avant un checkText(). */
export function isEngineInstalled(app, manifest, engine) {
  const fs = require("fs");
  const path = require("path");
  const def = ENGINES[engine];
  if (!def) return false;

  try {
    const marker = JSON.parse(fs.readFileSync(versionMarkerPath(app, manifest, engine), "utf8"));
    if (marker.version !== ASSETS_VERSION) return false;
  } catch {
    return false;
  }

  return fs.existsSync(path.join(resourcesDir(app, manifest), def.dir, def.marker));
}

/** Télécharge et extrait le moteur donné. onProgress(phase) reçoit
 * "download" puis "extract" pour permettre un message d'état simple.
 * Le marqueur de version n'est écrit qu'une fois l'extraction terminée
 * avec succès : un échec en cours de route laisse isEngineInstalled() à
 * false plutôt que de faire croire à une installation à moitié faite. */
export async function downloadEngine(app, manifest, engine, onProgress) {
  const fs = require("fs");
  const path = require("path");
  const def = ENGINES[engine];
  if (!def) throw new Error(`Moteur inconnu : ${engine}`);

  if (onProgress) onProgress("download");
  // requestUrl (API Obsidian) plutôt que fetch() global : fetch() se heurte
  // au CORS/CSP du process de rendu d'Electron pour un domaine externe
  // comme github.com, requestUrl le contourne (même raison que BRAT s'en
  // sert pour ses propres téléchargements de releases GitHub).
  const { requestUrl } = require("obsidian");
  let response;
  try {
    response = await requestUrl({ url: def.url, method: "GET" });
  } catch (e) {
    throw new Error(`Téléchargement échoué : ${e.message || e}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Téléchargement échoué (HTTP ${response.status}) : ${def.url}`);
  }
  const buffer = response.arrayBuffer;

  if (onProgress) onProgress("extract");
  const zip = await JSZip.loadAsync(buffer);
  const targetDir = path.join(resourcesDir(app, manifest), def.dir);
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    const destPath = path.join(targetDir, entry.name);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const content = await entry.async("nodebuffer");
    fs.writeFileSync(destPath, content);
  }

  fs.writeFileSync(versionMarkerPath(app, manifest, engine), JSON.stringify({ version: ASSETS_VERSION }));
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
