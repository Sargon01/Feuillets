/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : path, et la fonction n'a de sens que cote desktop */
// Chemin absolu du dossier du plugin sur disque — desktop uniquement
// (adapter.getBasePath n'existe pas sur mobile, où ce chemin n'a de toute
// façon aucun sens pour du require("fs")/require("vm")).
export function pluginAbsoluteDir(app, manifest) {
  const path = require("path");
  const basePath = app.vault.adapter.getBasePath
    ? app.vault.adapter.getBasePath()
    : app.vault.adapter.basePath;
  return path.join(basePath, manifest.dir);
}
