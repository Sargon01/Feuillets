/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : path, et la fonction n'a de sens que cote desktop */
/* global require -- défini par environnement */
import { Platform } from "obsidian";

type PathModule = {
  join(...paths: string[]): string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isBasePathGetter(value: unknown): value is () => unknown {
  return typeof value === "function";
}

function desktopBasePath(app: unknown): string {
  if (!isRecord(app) || !isRecord(app.vault) || !isRecord(app.vault.adapter)) {
    throw new Error("Adaptateur de coffre incompatible : chemin de base introuvable.");
  }
  const adapter = app.vault.adapter;
  const getter = adapter.getBasePath;
  const basePath = isBasePathGetter(getter) ? getter() : adapter.basePath;
  if (typeof basePath !== "string") {
    throw new Error("Adaptateur de coffre incompatible : chemin de base introuvable.");
  }
  return basePath;
}

function pluginDirectory(manifest: unknown): string {
  if (!isRecord(manifest) || typeof manifest.dir !== "string") {
    throw new Error("Manifest de plugin incompatible : dossier introuvable.");
  }
  return manifest.dir;
}

// Chemin absolu du dossier du plugin sur disque — desktop uniquement
// (adapter.getBasePath n'existe pas sur mobile, où ce chemin n'a de toute
// façon aucun sens pour du require("fs")/require("vm")).
export function pluginAbsoluteDir(app: unknown, manifest: unknown): string {
  if (!Platform.isDesktop) {
    throw new Error("Le chemin du plugin est disponible uniquement sur ordinateur.");
  }
  const basePath = desktopBasePath(app);
  const path: PathModule = require("path");
  return path.join(basePath, pluginDirectory(manifest));
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
