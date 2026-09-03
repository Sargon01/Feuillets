import type { CanvasData, CanvasEdge, CanvasNode } from "../../canvas/types.js";
import { createGroupBlockNode, GROUP_BLOCK_VERSION } from "../shared/native-group-block.js";
import type { GenealogyFamilyGraph, GenealogyPerson, GenealogyPersonId, GenealogyUnion } from "./types.js";

export type GenealogyCanvasModel = CanvasData;

const PERSON_WIDTH = 220;
const PERSON_HEIGHT = 100;
const UNION_SIZE = 40;
const PERSON_GAP = 40;
const UNION_GAP = 80;

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

function createPersonNode(person: GenealogyPerson, blockId: string, index: number): CanvasNode {
  return {
    id: personNodeId(person.id),
    type: "file",
    file: person.filePath,
    x: index * (PERSON_WIDTH + PERSON_GAP),
    y: 0,
    width: PERSON_WIDTH,
    height: PERSON_HEIGHT,
    feuillets_block: "genealogy",
    feuillets_block_version: GROUP_BLOCK_VERSION,
    feuillets_block_id: blockId,
  };
}

function createUnionNode(union: GenealogyUnion, blockId: string, index: number): CanvasNode {
  return {
    id: unionNodeId(union.id),
    type: "text",
    text: "",
    x: index * (UNION_SIZE + UNION_GAP),
    y: PERSON_HEIGHT + 80,
    width: UNION_SIZE,
    height: UNION_SIZE,
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
        fromSide: "right",
        toSide: "left",
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
        fromSide: "right",
        toSide: "left",
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
  const personNodes = persons.map((person, index) => createPersonNode(person, blockId, index));
  const unionNodes = unions.map((union, index) => createUnionNode(union, blockId, index));
  const maxPersonWidth = persons.length === 0 ? 0 : persons.length * PERSON_WIDTH + (persons.length - 1) * PERSON_GAP;
  const maxUnionWidth = unions.length === 0 ? 0 : unions.length * UNION_SIZE + (unions.length - 1) * UNION_GAP;
  const canvas: CanvasData = { nodes: [], edges: [] };
  const group = createGroupBlockNode(canvas, {
    blockType: "genealogy",
    blockId,
    nodeId: groupNodeId(blockId),
    x: -60,
    y: -60,
    width: Math.max(maxPersonWidth, maxUnionWidth, 120) + 120,
    height: Math.max(PERSON_HEIGHT + 80 + UNION_SIZE, 120) + 120,
  });
  return {
    nodes: [group, ...personNodes, ...unionNodes],
    edges: createEdges({ ...graph, persons, unions }, blockId),
  };
}
