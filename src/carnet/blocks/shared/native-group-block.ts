import { setIcon } from "obsidian";
import type { CanvasData, CanvasNode } from "../../canvas/types.js";

/** Socle STRUCTUREL commun aux blocs natifs en groupe (Prompt 4 : Relations,
 * Généalogie — Mindmap garde son propre model.ts, non touché, voir tête de
 * prompt : « ne pas refactorer sauf réutilisation triviale »).
 *
 * Un bloc de ce socle est TOUJOURS : un vrai GroupNode Canvas natif
 * (`type: "group"`) portant `feuillets_block: "<type>"` +
 * `feuillets_block_version: 1` + `feuillets_block_id: "<uuid>"` ; ses
 * membres sont de VRAIS nodes Canvas (FileNode le plus souvent) portant le
 * même `feuillets_block_id` ; ses relations métier sont de vraies edges
 * Canvas portant `feuillets_managed: "<type>"` + ce même `feuillets_block_id`
 * — jamais une edge libre, jamais une edge d'un autre bloc/type. Fonctions
 * PURES, aucune E/S, aucune connaissance du DOM ni du runtime Canvas (voir
 * carnet/canvas/adapter.ts pour la matérialisation runtime des FileNodes). */

export const GROUP_BLOCK_VERSION = 1;
export const GROUP_BLOCK_DEFAULT_PADDING = 60;

export type GroupBlockType = "relations" | "genealogy";

export function isGroupBlockNode(node: CanvasNode, blockType: GroupBlockType): boolean {
  return node.type === "group" && node.feuillets_block === blockType && typeof node.feuillets_block_id === "string";
}

export function findGroupBlockNode(canvas: CanvasData, blockType: GroupBlockType, blockId: string): CanvasNode | null {
  return (canvas.nodes || []).find((node) => isGroupBlockNode(node, blockType) && node.feuillets_block_id === blockId) || null;
}

/** Un membre est tout node portant CE `feuillets_block_id`, hormis le
 * groupe lui-même — un `feuillets_block_id` donné n'appartient jamais qu'à
 * un seul bloc, donc indépendant du type précis de ce bloc ici. */
export function isGroupBlockMember(node: CanvasNode, blockId: string): boolean {
  return node.type !== "group" && node.feuillets_block !== "genealogy-union" && node.feuillets_block_id === blockId;
}

export function groupBlockMemberNodes(canvas: CanvasData, blockId: string): CanvasNode[] {
  return (canvas.nodes || []).filter((node) => isGroupBlockMember(node, blockId));
}

/** Une edge est « gérée » par CE bloc UNIQUEMENT si elle porte À LA FOIS le
 * marqueur `feuillets_managed` attendu ET ce `feuillets_block_id` — toute
 * autre edge (libre, idea-tree, mindmap, d'un autre bloc Relations/
 * Généalogie…) n'est jamais lue ni modifiée par ce module ou ses blocs. */
export function isGroupBlockManagedEdge(edge: { feuillets_managed?: string; feuillets_block_id?: string }, managed: string, blockId: string): boolean {
  return edge.feuillets_managed === managed && edge.feuillets_block_id === blockId;
}

function randomHexId(used: Set<string>): string {
  const chars = "0123456789abcdef";
  for (;;) {
    let id = "";
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!used.has(id)) return id;
  }
}

/** Id de node Canvas frais — même schéma que Mindmap (16 caractères hex),
 * jamais un doublon des nodes déjà présents. */
export function freshNodeId(canvas: CanvasData): string {
  return randomHexId(new Set((canvas.nodes || []).map((node) => node.id)));
}

/** Id d'edge Canvas frais, lisible (`<prefix>-<n>`) — même schéma que
 * Mindmap (`freshMindmapEdgeId`), jamais un doublon. */
export function freshEdgeId(canvas: CanvasData, prefix: string): string {
  const used = new Set((canvas.edges || []).map((edge) => edge.id));
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export type CreateGroupBlockOptions = {
  blockType: GroupBlockType;
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Crée le GroupNode Canvas natif portant les marqueurs du socle — ne crée
 * AUCUN membre, l'appelant (relations.ts/genealogy.ts) reste responsable de
 * son contenu initial. Poussé directement dans `canvas.nodes`. */
export function createGroupBlockNode(canvas: CanvasData, options: CreateGroupBlockOptions): CanvasNode {
  const node: CanvasNode = {
    id: freshNodeId(canvas),
    type: "group",
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    label: options.blockType === "relations" ? "Relations" : "Généalogie",
    feuillets_block: options.blockType,
    feuillets_block_version: GROUP_BLOCK_VERSION,
    feuillets_block_id: options.blockId,
  };
  canvas.nodes.push(node);
  return node;
}

/** Redimensionne/repositionne UNIQUEMENT le groupe pour qu'il continue
 * d'englober tous ses membres (avec une marge constante) — jamais utilisé
 * pour déduire la structure, seulement pour l'affichage (même principe que
 * Mindmap `fitGroupToMembers`, généralisé ici pour être partagé). */
export function fitGroupBlockToMembers(canvas: CanvasData, blockId: string, padding: number = GROUP_BLOCK_DEFAULT_PADDING): void {
  const group = (canvas.nodes || []).find((node) => node.type === "group" && node.feuillets_block_id === blockId);
  const members = groupBlockMemberNodes(canvas, blockId);
  if (!group || members.length === 0) return;
  const left = Math.min(...members.map((node) => Number(node.x) || 0));
  const top = Math.min(...members.map((node) => Number(node.y) || 0));
  const right = Math.max(...members.map((node) => (Number(node.x) || 0) + (Number(node.width) || 0)));
  const bottom = Math.max(...members.map((node) => (Number(node.y) || 0) + (Number(node.height) || 0)));
  group.x = left - padding;
  group.y = top - padding;
  group.width = right - left + padding * 2;
  group.height = bottom - top + padding * 2;
}

/** §3 — vrai si un FileNode portant CE chemin est DÉJÀ membre du bloc :
 * jamais deux fois le même fichier dans le même bloc. Ignore tout node qui
 * n'est pas un FileNode (un TextNode/GroupNode ne porte jamais `file`). */
export function hasFileMember(canvas: CanvasData, blockId: string, filePath: string): boolean {
  return groupBlockMemberNodes(canvas, blockId).some((node) => node.type === "file" && node.file === filePath);
}

/** §3 — groupe géré par CE socle (Relations OU Généalogie, jamais Mindmap :
 * comportement Mindmap intentionnellement inchangé, voir prompt) dont la
 * zone englobe `pos` (coordonnées CANVAS, jamais écran). Utilisé par le
 * dépose Binder/Recherche pour décider : adhésion automatique au bloc si
 * `pos` tombe dedans, sinon FileNode libre comme aujourd'hui. */
export function findContainingGroupBlock(canvas: CanvasData, pos: { x: number; y: number }): CanvasNode | null {
  return (
    (canvas.nodes || []).find((node) => {
      if (node.type !== "group" || typeof node.feuillets_block_id !== "string") return false;
      if (node.feuillets_block !== "relations" && node.feuillets_block !== "genealogy") return false;
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      const width = Number(node.width) || 0;
      const height = Number(node.height) || 0;
      return pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height;
    }) || null
  );
}

/** Retire un membre du bloc — le NODE Canvas (jamais le fichier Markdown
 * qu'il référence, cette fonction ne touche jamais au vault) ET toute edge
 * qui le referençait, gérée par ce bloc ou non : une edge pointant vers un
 * node qui n'existe plus est de toute façon invalide (même hygiène que la
 * suppression native d'un node Canvas). `false` si `nodeId` n'est pas membre
 * de ce bloc. */
export function removeGroupBlockMember(canvas: CanvasData, blockId: string, nodeId: string): boolean {
  const nodes = canvas.nodes || [];
  const index = nodes.findIndex((node) => node.id === nodeId && isGroupBlockMember(node, blockId));
  if (index === -1) return false;
  nodes.splice(index, 1);
  canvas.edges = (canvas.edges || []).filter((edge) => edge.fromNode !== nodeId && edge.toNode !== nodeId);
  return true;
}

/* ================================================================
 * UI — petite toolbar DOM partagée (Prompt 4, §2/§8), attachée au groupe.
 *
 * Mêmes garanties que le header du Plan (voir ui/canvas-binder-plan-
 * outliner.ts) : chaque bouton stoppe pointerdown/mousedown/click/
 * dblclick — jamais `preventDefault()` global — pour ne jamais déclencher
 * le déplacement natif du GroupNode ni armer un drag métier, même un clic
 * droit résiduel. Le RESTE du groupe (fond, bordure, poignées de
 * redimensionnement) n'est jamais touché ici : il reste une zone Canvas
 * normale. Idempotent : un appel répété sur le même `host` retrouve la
 * MÊME barre et se contente d'actualiser ses boutons — jamais empilée.
 * ================================================================ */

export type GroupBlockToolbarButton = {
  id: string;
  icon: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

const TOOLBAR_CLASS = "feuillets-group-block-toolbar";

const stopEvent = (event: Event) => event.stopPropagation();

export function renderGroupBlockToolbar(host: HTMLElement, buttons: GroupBlockToolbarButton[]): void {
  let bar = host.querySelector<HTMLElement>(`.${TOOLBAR_CLASS}`);
  if (!bar) {
    bar = host.createDiv({ cls: TOOLBAR_CLASS });
    bar.addEventListener("pointerdown", stopEvent);
    bar.addEventListener("mousedown", stopEvent);
    bar.addEventListener("click", stopEvent);
    bar.addEventListener("dblclick", stopEvent);
    // Clic droit/secondaire sur la barre elle-même : jamais un menu Canvas,
    // jamais un drag amorcé — voir §8 (« ne pas reproduire les problèmes
    // du Plan »).
    bar.addEventListener("contextmenu", (event) => { event.preventDefault(); stopEvent(event); });
  }
  bar.empty();
  for (const spec of buttons) {
    const button = bar.createEl("button", { attr: { "aria-label": spec.label, title: spec.label } });
    button.dataset.toolbarId = spec.id;
    setIcon(button, spec.icon);
    button.disabled = !!spec.disabled;
    button.addEventListener("pointerdown", stopEvent);
    button.addEventListener("mousedown", stopEvent);
    button.addEventListener("dblclick", stopEvent);
    button.addEventListener("click", (event) => {
      stopEvent(event);
      if (!button.disabled) spec.onClick();
    });
  }
}

export function removeGroupBlockToolbar(host: HTMLElement): void {
  host.querySelector(`.${TOOLBAR_CLASS}`)?.remove();
}
