import { normalizePath, Notice, TFile } from "obsidian";
export type { CanvasNode, CanvasEdge, CanvasData, LiveCanvasFileView } from "../carnet/canvas/types.js";
import type { CanvasData, LiveCanvasFileView } from "../carnet/canvas/types.js";
import type { App, TFolder } from "obsidian";
import { getProjectFolder, resourcesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";

/** Valeurs conservées pour les nodes créés explicitement par Feuillets. */
export type FeuilletsManagedKind = "manuscript" | "research" | "thread";
export type FeuilletsManagedEdgeKind = FeuilletsManagedKind | "idea-tree";

export type AddFileNodeResult = "added" | "duplicate" | "invalid";

/** Lot 6 (« noter une idée ») — pas de notion de doublon (deux idées avec
 * exactement le même texte sont autorisées, voir `addTextNodeToCanvas`) :
 * `"empty"` remplace `"duplicate"` pour le seul cas où rien n'est créé, un
 * texte vide après trim. */
export type AddTextNodeResult = "added" | "empty" | "invalid";

function newFileNodeId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Mutation pure du Carnet : ajoute exactement un FileNode aux coordonnées
 * historiques, ou signale le doublon sans modifier les données. */
export function addFileNodeToCanvas(data: CanvasData, filePath: string): AddFileNodeResult {
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return "invalid";
  if (data.nodes.some((node) => node.type === "file" && node.file === filePath)) return "duplicate";
  const maxY = data.nodes.reduce((max, node) => Math.max(max, (node.y || 0) + (node.height || 160)), 0);
  data.nodes.push({
    id: newFileNodeId(),
    type: "file",
    file: filePath,
    x: 0,
    y: maxY + 40,
    width: 320,
    height: 220,
  });
  return "added";
}

/** Ajoute un feuillet au Carnet en respectant l'état live d'une vue ouverte.
 * Le repli disque n'est employé qu'en l'absence de vue live correspondante. */
export async function addFileNodeToNotebook(
  app: Pick<App, "vault">,
  canvasFile: TFile,
  filePath: string,
  liveView?: LiveCanvasFileView
): Promise<AddFileNodeResult> {
  if (liveView) {
    let data: CanvasData;
    try {
      data = JSON.parse(liveView.getViewData()) as CanvasData;
    } catch {
      return "invalid";
    }
    const result = addFileNodeToCanvas(data, filePath);
    if (result === "added") {
      liveView.setViewData(JSON.stringify(data, null, "\t"), false);
      liveView.requestSave();
    }
    return result;
  }

  let data: CanvasData;
  try {
    data = JSON.parse(await app.vault.read(canvasFile)) as CanvasData;
  } catch {
    return "invalid";
  }
  const result = addFileNodeToCanvas(data, filePath);
  if (result === "added") await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  return result;
}

export type AddFileNodesResult = { added: number; duplicates: number };

/** Lot 7 (« Ajouter la sélection au Carnet ») — mutation pure BATCH : ajoute
 * chaque chemin de `filePaths` (déjà dans l'ORDRE BINDER CANONIQUE — voir
 * views/base-feuillets-view.ts `showFileContextMenu`, jamais l'ordre d'un
 * `Set` de sélection) en réutilisant `addFileNodeToCanvas` tel quel pour
 * chaque path, dans l'ordre reçu — jamais une seconde implémentation de la
 * géométrie : chaque appel voit déjà les nodes ajoutés par les appels
 * précédents dans `data.nodes`, donc l'empilement vertical (section 3,
 * "placement après les nodes existants") reste exactement celui du chemin
 * unitaire, sans code de layout supplémentaire. Un doublon (déjà présent
 * avant CE batch, ou ajouté par un chemin précédent DANS ce même batch —
 * mêmes deux idées ne peuvent de toute façon référencer qu'un seul chemin de
 * fichier) est simplement compté, jamais déplacé ni recréé. */
export function addFileNodesToCanvas(data: CanvasData, filePaths: string[]): AddFileNodesResult {
  let added = 0;
  let duplicates = 0;
  for (const filePath of filePaths) {
    const result = addFileNodeToCanvas(data, filePath);
    if (result === "added") added += 1;
    else if (result === "duplicate") duplicates += 1;
  }
  return { added, duplicates };
}

/** Lot 7 — même invariant Lot 4 que `addFileNodeToNotebook`, mais en UNE
 * SEULE transaction pour tout le batch : `getViewData`/`vault.read` une
 * fois, toutes les mutations en mémoire via `addFileNodesToCanvas`, puis
 * `setViewData(…, false)`/`requestSave` ou `vault.modify` une seule fois —
 * jamais une boucle de `addFileNodeToNotebook` (ce qui multiplierait
 * lectures/écritures/`requestSave`). Si `added === 0` (tout était déjà
 * présent), aucune écriture n'est déclenchée (ni `setViewData`/
 * `requestSave`, ni `vault.modify`) : rien n'a changé, rien à persister. */
export async function addFileNodesToNotebook(
  app: Pick<App, "vault">,
  canvasFile: TFile,
  filePaths: string[],
  liveView?: LiveCanvasFileView
): Promise<AddFileNodesResult | "invalid"> {
  if (liveView) {
    let data: CanvasData;
    try {
      data = JSON.parse(liveView.getViewData()) as CanvasData;
    } catch {
      return "invalid";
    }
    const result = addFileNodesToCanvas(data, filePaths);
    if (result.added > 0) {
      liveView.setViewData(JSON.stringify(data, null, "\t"), false);
      liveView.requestSave();
    }
    return result;
  }

  let data: CanvasData;
  try {
    data = JSON.parse(await app.vault.read(canvasFile)) as CanvasData;
  } catch {
    return "invalid";
  }
  const result = addFileNodesToCanvas(data, filePaths);
  if (result.added > 0) await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  return result;
}

/** Lot 6 (« Carnet : noter une idée ») — mutation pure du Carnet : ajoute
 * exactement un TextNode LIBRE, jamais dédupliqué (deux idées au même texte
 * sont autorisées — voir tête de fichier `AddTextNodeResult`). Le node créé
 * ne porte QUE `type`/`text`/position/dimensions : aucun `feuillets_managed`,
 * aucun `file`, aucune edge, aucune couleur métier, aucun YAML — une idée
 * libre reste libre, jamais associée au feuillet en cours d'écriture ni à
 * quoi que ce soit d'autre (voir integrations/advanced-canvas.ts, jamais
 * touché par ce Lot). Géométrie : même principe que `addFileNodeToCanvas`
 * (empile sous les nodes existants, jamais ne les déplace), dimensions
 * fixes 320×120, aucun `dynamicHeight`. */
export function addTextNodeToCanvas(data: CanvasData, rawText: string): AddTextNodeResult {
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return "invalid";
  const text = String(rawText ?? "").trim();
  if (!text) return "empty";
  const maxY = data.nodes.reduce((max, node) => Math.max(max, (node.y || 0) + (node.height || 160)), 0);
  data.nodes.push({
    id: newFileNodeId(),
    type: "text",
    text,
    x: 0,
    y: maxY + 40,
    width: 320,
    height: 120,
  });
  return "added";
}

/** Lot 6 — même stratégie API live/repli disque que `addFileNodeToNotebook`
 * (invariant du Lot 4, jamais réécrit) : un Carnet déjà ouvert utilise
 * TOUJOURS `getViewData`/`setViewData(…, false)`/`requestSave`, jamais
 * `vault.modify` — un `vault.modify` sur un Canvas ouvert écraserait
 * silencieusement tout déplacement de node non encore sauvegardé par
 * Obsidian. Le repli disque (`vault.read`/`vault.modify`) ne sert que si le
 * Carnet n'est pas ouvert dans une vue live. */
export async function addTextNodeToNotebook(
  app: Pick<App, "vault">,
  canvasFile: TFile,
  rawText: string,
  liveView?: LiveCanvasFileView
): Promise<AddTextNodeResult> {
  if (liveView) {
    let data: CanvasData;
    try {
      data = JSON.parse(liveView.getViewData()) as CanvasData;
    } catch {
      return "invalid";
    }
    const result = addTextNodeToCanvas(data, rawText);
    if (result === "added") {
      liveView.setViewData(JSON.stringify(data, null, "\t"), false);
      liveView.requestSave();
    }
    return result;
  }

  let data: CanvasData;
  try {
    data = JSON.parse(await app.vault.read(canvasFile)) as CanvasData;
  } catch {
    return "invalid";
  }
  const result = addTextNodeToCanvas(data, rawText);
  if (result === "added") await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  return result;
}

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
