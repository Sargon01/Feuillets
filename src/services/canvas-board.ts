import { normalizePath, Notice, TFile } from "obsidian";
import type { App, TFolder } from "obsidian";
import { getProjectFolder, resourcesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";

/** Valeurs conservées pour les nodes créés explicitement par Feuillets. */
export type FeuilletsManagedKind = "manuscript" | "research" | "thread";
export type FeuilletsManagedEdgeKind = FeuilletsManagedKind | "idea-tree";

export type CanvasNode = {
  id: string;
  type?: string;
  text?: string;
  file?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  feuillets_managed?: FeuilletsManagedKind;
  [key: string]: unknown;
};

export type CanvasEdge = {
  id: string;
  fromNode?: string;
  toNode?: string;
  fil?: string;
  feuillets_fil?: string;
  feuillets_managed?: FeuilletsManagedEdgeKind;
  [key: string]: unknown;
};

export type CanvasData = { nodes: CanvasNode[]; edges: CanvasEdge[] };

/** Chemin stable du Carnet du projet actif. */
export function canvasPathFor(app: App, root: TFolder): string {
  return normalizePath(`${resourcesFolderPath(app, root)}/Tableau brainstorming.canvas`);
}

/**
 * Point d'entrée conservé pour les commandes existantes. Il garantit
 * seulement que le Carnet existe : aucun feuillet, edge, style ou groupe du
 * Canvas existant n'est injecté, synchronisé, supprimé ou réécrit.
 */
export async function generateCanvasBoard(
  app: App,
  settings: FeuilletsSettings
): Promise<{ file: TFile; added: number; edgesAdded: number; total: number } | null> {
  const root = getProjectFolder(app, settings);
  if (!root) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }
  const path = canvasPathFor(app, root);
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const existing = app.vault.getAbstractFileByPath(path);
  const file = existing instanceof TFile
    ? existing
    : await app.vault.create(path, JSON.stringify({ nodes: [], edges: [] }, null, "\t"));
  return { file, added: 0, edgesAdded: 0, total: 0 };
}
