import type { App, TFile } from "obsidian";
import { shortTitleFor } from "../../services/frontmatter.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import type { CanvasData, CanvasNode, LiveCanvasFileView } from "./types.js";
import { findContainingGroupBlock, hasFileMember, freshNodeId } from "../blocks/shared/native-group-block.js";

type RuntimeCanvasView = LiveCanvasFileView & { canvas?: MinimalRuntimeCanvas & { getData?: () => CanvasData; setData?: (data: CanvasData) => void } };

function isLiveView(value: unknown): value is RuntimeCanvasView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<LiveCanvasFileView>;
  return typeof view.getViewData === "function" && typeof view.setViewData === "function" && typeof view.requestSave === "function";
}

function validateCanvasData(value: unknown): value is CanvasData {
  return !!value && typeof value === "object" && Array.isArray((value as { nodes?: unknown }).nodes) && Array.isArray((value as { edges?: unknown }).edges);
}

export function findOpenCanvasView(app: Pick<App, "workspace">, file: TFile): RuntimeCanvasView | undefined {
  return app.workspace.getLeavesOfType("canvas")
    .map((leaf) => leaf.view as unknown)
    .find((view): view is RuntimeCanvasView => isLiveView(view) && view.file?.path === file.path);
}

export async function readCanvasData(app: Pick<App, "vault" | "workspace">, file: TFile, openView = findOpenCanvasView(app, file)): Promise<CanvasData> {
  const runtime = openView?.canvas;
  const data = runtime?.getData?.();
  if (data !== undefined) {
    if (!validateCanvasData(data)) throw new Error("Invalid Canvas data");
    return data;
  }
  const raw = openView ? openView.getViewData() : await app.vault.read(file);
  const parsed: unknown = JSON.parse(raw);
  if (!validateCanvasData(parsed)) throw new Error("Invalid Canvas data");
  return parsed;
}

export async function persistCanvasData(app: Pick<App, "vault">, file: TFile, data: CanvasData, openView?: RuntimeCanvasView): Promise<void> {
  if (!validateCanvasData(data)) throw new Error("Invalid Canvas data");
  const runtime = openView?.canvas;
  if (runtime?.setData && runtime.requestSave) {
    runtime.setData(data);
    runtime.requestSave();
    return;
  }
  if (openView) {
    openView.setViewData(JSON.stringify(data, null, "\t"), false);
    openView.requestSave();
    return;
  }
  await app.vault.modify(file, JSON.stringify(data, null, "\t"));
}

export type CanvasSession = { data: CanvasData; view?: RuntimeCanvasView; runtimeCanvas?: MinimalRuntimeCanvas; persist: (data: CanvasData) => Promise<void> };

export async function resolveCanvasSession(app: Pick<App, "vault" | "workspace">, file: TFile): Promise<CanvasSession> {
  const view = findOpenCanvasView(app, file);
  const data = await readCanvasData(app, file, view);
  return { data, view, runtimeCanvas: view?.canvas, persist: (next) => persistCanvasData(app, file, next, view) };
}

/* ================================================================
 * Correctif « drag Binder/Recherche → vrai FileNode »
 *
 * Glisser un TFile Feuillets vers un Carnet doit créer un vrai FileNode
 * Canvas — jamais un TextNode `[[lien]]`, jamais une mutation du fichier
 * Markdown lui-même. Le MIME privé ci-dessous transporte le chemin exact du
 * TFile, posé au dragstart par attachDragHandlers (Binder) et
 * attachResearchDragSource (Recherche), lu au drop par le câblage vivant de
 * chaque vue Carnet (voir integrations/advanced-canvas.ts). */

export const FEUILLETS_FILE_DRAG_MIME = "application/x-feuillets-file";

/** Même taille que les FileNodes déjà créés ailleurs dans le Carnet (voir
 * services/canvas-board.ts, `addFileNodeToCanvas`) — aucune nouvelle
 * préférence utilisateur. */
export const CARNET_FILE_NODE_SIZE = { width: 320, height: 220 } as const;

/** Normalise uniquement les valeurs YAML scalaires admises pour une date. */
export function normalizeGenealogyDate(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Chemin vault d'un TFile Feuillets transporté par un drag, ou `null` si ce
 * `dataTransfer` ne porte pas notre MIME privé (drag Canvas ordinaire, ou
 * provenant d'ailleurs que Binder/Recherche). */
export function feuilletsFileDragPath(dataTransfer: DataTransfer | null | undefined): string | null {
  const path = dataTransfer?.getData(FEUILLETS_FILE_DRAG_MIME);
  return path ? path : null;
}

/** Crée un VRAI FileNode Canvas pour `file`, centré sur `pos` (coordonnées
 * Canvas — jamais écran, voir `canvas.posFromEvt`). Ne mute jamais le
 * fichier Markdown, ne lui attribue aucune relation structurelle Mindmap
 * (§6 du correctif : un fichier lâché dans l'espace d'une Mindmap reste un
 * FileNode libre tant que l'autrice n'agit pas explicitement). `null` si le
 * runtime Canvas n'expose pas `createFileNode` — l'appelant ne crée alors
 * RIEN d'autre à la place (jamais un TextNode de secours). */
export function createCarnetFileNode(
  canvas: Pick<MinimalRuntimeCanvas, "createFileNode" | "requestSave">,
  file: TFile,
  pos: { x: number; y: number }
): MinimalRuntimeNode | null {
  if (!canvas.createFileNode) return null;
  const node = canvas.createFileNode({
    pos: { x: pos.x - CARNET_FILE_NODE_SIZE.width / 2, y: pos.y - CARNET_FILE_NODE_SIZE.height / 2 },
    size: { ...CARNET_FILE_NODE_SIZE },
    file,
  });
  canvas.requestSave?.();
  return node;
}

/** Prompt 4, §3 — dépose un fichier Binder/Recherche/Markdown ordinaire
 * DIRECTEMENT comme membre d'un bloc Relations/Généalogie déjà présent sous
 * le point de dépose : un VRAI FileNode (même mécanisme que
 * `createCarnetFileNode`, jamais un TextNode `[[lien]]`), auquel on pose
 * ensuite `feuillets_block_id` via `setData` (membre RUNTIME réel, voir
 * canvas-runtime.ts) — jamais une relation créée automatiquement.
 * `null` si `createFileNode` est absent, ou si `filePath` est DÉJÀ membre
 * de ce bloc (§3 : jamais deux fois le même fichier). L'appelant
 * (integrations/advanced-canvas.ts) doit avoir déjà vérifié, via
 * `findContainingGroupBlock`, que `pos` tombe bien dans un groupe géré. */
export function addGroupBlockFileMember(
  canvas: Pick<MinimalRuntimeCanvas, "createFileNode" | "requestSave"> & { setData?: (data: CanvasData) => void },
  data: CanvasData,
  blockId: string,
  file: TFile,
  pos: { x: number; y: number },
  app?: Pick<App, "metadataCache">
): MinimalRuntimeNode | null {
  if (hasFileMember(data, blockId, file.path)) return null;
  const group = (data.nodes || []).find((candidate) => candidate.type === "group" && candidate.feuillets_block_id === blockId);
  if (group?.feuillets_block === "genealogy") {
    if (!canvas.setData) {
      const fallback = createCarnetFileNode(canvas, file, pos);
      if (!fallback) return null;
      fallback.setData({ ...fallback.getData(), feuillets_block_id: blockId });
      return fallback;
    }
    const hasMetadata = !!app?.metadataCache?.getFileCache;
    const frontmatter = hasMetadata && app
      ? (app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined) || {}
      : {};
    const label = hasMetadata && app ? shortTitleFor(app as App, file) : file.basename;
    const birth = normalizeGenealogyDate(frontmatter.birth);
    const death = normalizeGenealogyDate(frontmatter.death);
    const dates = birth || death ? `\n${birth}–${death}` : "";
    const person: CanvasNode = {
      id: freshNodeId(data), type: "text", text: `${label}${dates}`,
      x: pos.x - 90, y: pos.y - 28, width: 180, height: 56,
      feuillets_block_id: blockId,
      feuillets_genealogy_person: true,
      feuillets_genealogy_source: file.path,
      feuillets_genealogy_name: label,
      feuillets_genealogy_dates: birth || death ? `${birth}–${death}` : "",
      ...(birth ? { birth } : {}),
      ...(death ? { death } : {}),
    };
    data.nodes.push(person);
    canvas.setData?.(data);
    canvas.requestSave?.();
    return null;
  } else {
    const node = createCarnetFileNode(canvas, file, pos);
    if (!node) return null;
    node.setData({ ...node.getData(), feuillets_block_id: blockId });
    canvas.requestSave?.();
    return node;
  }
}

/** Prompt 4, §3 — groupe Relations/Généalogie (le seul socle qui accepte
 * une adhésion automatique par dépose, jamais la Mindmap : voir §6 du
 * correctif Mindmap, comportement intentionnellement inchangé) dont la
 * zone englobe `pos` — `null` si aucun. En cas de chevauchement de deux
 * groupes gérés, le premier trouvé dans `data.nodes` gagne (même
 * convention que le reste du pont Carnet, ex. `resolveMindmapDropTarget`). */
export function containingGroupBlockAt(data: CanvasData, pos: { x: number; y: number }): CanvasNode | null {
  return findContainingGroupBlock(data, pos);
}
