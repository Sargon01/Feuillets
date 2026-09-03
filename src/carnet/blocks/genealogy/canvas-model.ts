import type { CanvasData, CanvasEdge, CanvasNode } from "../../canvas/types.js";
import { createGroupBlockNode, fitGroupBlockToMembers, GROUP_BLOCK_VERSION } from "../shared/native-group-block.js";
import {
  GENEALOGY_PERSON_HEIGHT,
  GENEALOGY_PERSON_WIDTH,
  GENEALOGY_UNION_SIZE,
  layoutGenealogy,
} from "./layout.js";
import type { GenealogyFamilyGraph, GenealogyPerson, GenealogyPersonId, GenealogyUnion } from "./types.js";

export type GenealogyCanvasModel = CanvasData;

function compareGenealogyIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function personNodeId(personId: GenealogyPersonId): string {
  return `genealogy-person:${encodeURIComponent(personId)}`;
}

function unionNodeId(unionId: string): string {
  return `genealogy-union:${encodeURIComponent(unionId)}`;
}

function groupNodeId(blockId: string): string {
  return `genealogy-group:${encodeURIComponent(blockId)}`;
}

function edgeId(relation: "partner-union" | "union-child", fromNode: string, toNode: string): string {
  return `genealogy-edge:${relation}:${encodeURIComponent(fromNode)}:${encodeURIComponent(toNode)}`;
}

function createPersonNode(person: GenealogyPerson, blockId: string, position: { x: number; y: number }): CanvasNode {
  return {
    id: personNodeId(person.id),
    type: "file",
    file: person.filePath,
    x: position.x,
    y: position.y,
    width: GENEALOGY_PERSON_WIDTH,
    height: GENEALOGY_PERSON_HEIGHT,
    feuillets_block: "genealogy",
    feuillets_block_version: GROUP_BLOCK_VERSION,
    feuillets_block_id: blockId,
  };
}

function createUnionNode(union: GenealogyUnion, blockId: string, position: { x: number; y: number }): CanvasNode {
  return {
    id: unionNodeId(union.id),
    type: "text",
    text: "",
    x: position.x,
    y: position.y,
    width: GENEALOGY_UNION_SIZE,
    height: GENEALOGY_UNION_SIZE,
    feuillets_block: "genealogy",
    feuillets_block_version: GROUP_BLOCK_VERSION,
    feuillets_block_id: blockId,
    feuillets_genealogy_kind: "union",
  };
}

function createEdges(graph: GenealogyFamilyGraph, blockId: string): CanvasEdge[] {
  const unions = [...graph.unions].sort((a, b) => compareGenealogyIds(a.id, b.id));
  const edges: CanvasEdge[] = [];
  for (const union of unions) {
    const unionId = unionNodeId(union.id);
    for (const partnerId of [...union.partnerIds].sort(compareGenealogyIds)) {
      const fromNode = personNodeId(partnerId);
      edges.push({
        id: edgeId("partner-union", fromNode, unionId),
        fromNode,
        toNode: unionId,
        fromSide: "bottom",
        toSide: "top",
        feuillets_managed: "genealogy",
        feuillets_block_id: blockId,
        feuillets_relation: "partner-union",
      });
    }
    for (const childId of [...union.childIds].sort(compareGenealogyIds)) {
      const toNode = personNodeId(childId);
      edges.push({
        id: edgeId("union-child", unionId, toNode),
        fromNode: unionId,
        toNode,
        fromSide: "bottom",
        toSide: "top",
        feuillets_managed: "genealogy",
        feuillets_block_id: blockId,
        feuillets_relation: "union-child",
      });
    }
  }
  return edges.sort((a, b) => compareGenealogyIds(a.id, b.id));
}

export function createGenealogyCanvasModel(graph: GenealogyFamilyGraph, blockId: string): GenealogyCanvasModel {
  const persons = [...graph.persons].sort((a, b) => compareGenealogyIds(a.id, b.id));
  const unions = [...graph.unions].sort((a, b) => compareGenealogyIds(a.id, b.id));
  const layout = layoutGenealogy({ ...graph, persons, unions });
  const personNodes = persons.map((person) => createPersonNode(person, blockId, layout.persons[person.id] ?? { x: 0, y: 0 }));
  const unionNodes = unions.map((union) => createUnionNode(union, blockId, layout.unions[union.id] ?? { x: 0, y: 0 }));
  const canvas: CanvasData = { nodes: [], edges: [] };
  createGroupBlockNode(canvas, {
    blockType: "genealogy",
    blockId,
    nodeId: groupNodeId(blockId),
    x: -60,
    y: -60,
    width: 120,
    height: 340,
  });
  canvas.nodes.push(...personNodes, ...unionNodes);
  canvas.edges = createEdges({ ...graph, persons, unions }, blockId);
  fitGroupBlockToMembers(canvas, blockId);
  if (canvas.nodes[0] && (canvas.nodes[0].height ?? 0) < 340) canvas.nodes[0].height = 340;
  return {
    nodes: canvas.nodes,
    edges: canvas.edges,
  };
}
