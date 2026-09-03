import type { GenealogyFamilyGraph, GenealogyPersonId, GenealogyUnion } from "./types.js";

export type GenealogyLayoutPosition = {
  x: number;
  y: number;
};

export type GenealogyLayout = {
  persons: Record<GenealogyPersonId, GenealogyLayoutPosition>;
  unions: Record<string, GenealogyLayoutPosition>;
};

export const GENEALOGY_PERSON_WIDTH = 220;
export const GENEALOGY_PERSON_HEIGHT = 100;
export const GENEALOGY_UNION_SIZE = 40;
export const GENEALOGY_HORIZONTAL_GAP = 40;
export const GENEALOGY_VERTICAL_GAP = 80;
export const GENEALOGY_COMPONENT_GAP = 160;

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort(compareIds);
}

function unionKey(union: GenealogyUnion): string {
  return union.id;
}

function connectedComponents(graph: GenealogyFamilyGraph): GenealogyPersonId[][] {
  const personIds = new Set(graph.persons.map((person) => person.id));
  const adjacency = new Map<GenealogyPersonId, Set<GenealogyPersonId>>();
  for (const personId of personIds) adjacency.set(personId, new Set());
  for (const union of graph.unions) {
    for (const partnerId of union.partnerIds) {
      const neighbours = adjacency.get(partnerId);
      if (!neighbours) continue;
      for (const otherId of union.partnerIds) {
        if (otherId !== partnerId && personIds.has(otherId)) neighbours.add(otherId);
      }
      for (const childId of union.childIds) {
        if (personIds.has(childId)) neighbours.add(childId);
      }
    }
    for (const childId of union.childIds) {
      const neighbours = adjacency.get(childId);
      if (!neighbours) continue;
      for (const partnerId of union.partnerIds) {
        if (personIds.has(partnerId)) neighbours.add(partnerId);
      }
    }
  }

  const visited = new Set<GenealogyPersonId>();
  const components: GenealogyPersonId[][] = [];
  for (const rootId of sortedIds(personIds)) {
    if (visited.has(rootId)) continue;
    const component: GenealogyPersonId[] = [];
    const pending = [rootId];
    visited.add(rootId);
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      component.push(current);
      for (const neighbour of sortedIds(adjacency.get(current) ?? [])) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        pending.push(neighbour);
      }
    }
    components.push(component.sort(compareIds));
  }
  return components.sort((a, b) => compareIds(a[0] ?? "", b[0] ?? ""));
}

function personGenerations(graph: GenealogyFamilyGraph): Map<GenealogyPersonId, number> {
  const persons = new Map(graph.persons.map((person) => [person.id, person]));
  const memo = new Map<GenealogyPersonId, number>();
  const visiting = new Set<GenealogyPersonId>();
  const generationOf = (personId: GenealogyPersonId): number => {
    const known = memo.get(personId);
    if (known !== undefined) return known;
    if (visiting.has(personId)) return 0;
    visiting.add(personId);
    const person = persons.get(personId);
    const generation = person
      ? Math.max(0, ...person.parentIds.filter((parentId) => persons.has(parentId)).map((parentId) => generationOf(parentId) + 1))
      : 0;
    visiting.delete(personId);
    memo.set(personId, generation);
    return generation;
  };
  for (const personId of sortedIds(persons.keys())) generationOf(personId);
  return memo;
}

function alignPartnerGenerations(
  graph: GenealogyFamilyGraph,
  generations: Map<GenealogyPersonId, number>,
): void {
  const limit = graph.persons.length + graph.unions.length + 1;
  for (let iteration = 0; iteration < limit; iteration += 1) {
    let changed = false;
    for (const union of [...graph.unions].sort((a, b) => compareIds(unionKey(a), unionKey(b)))) {
      const partnerGeneration = Math.max(0, ...union.partnerIds.map((id) => generations.get(id) ?? 0));
      for (const partnerId of union.partnerIds) {
        if ((generations.get(partnerId) ?? 0) < partnerGeneration) {
          generations.set(partnerId, partnerGeneration);
          changed = true;
        }
      }
      for (const childId of union.childIds) {
        if ((generations.get(childId) ?? 0) < partnerGeneration + 1) {
          generations.set(childId, Math.min(partnerGeneration + 1, graph.persons.length + 1));
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function partnerBlocks(
  personIds: readonly GenealogyPersonId[],
  unions: readonly GenealogyUnion[],
  generation: number,
  generations: ReadonlyMap<GenealogyPersonId, number>,
): GenealogyPersonId[][] {
  const parent = new Map(personIds.map((id) => [id, id]));
  const find = (id: GenealogyPersonId): GenealogyPersonId => {
    let current = id;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      if (next === undefined) return current;
      current = next;
    }
    return current;
  };
  const join = (a: GenealogyPersonId, b: GenealogyPersonId): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const union of unions) {
    const ids = union.partnerIds.filter((id) => generations.get(id) === generation && parent.has(id));
    for (const id of ids.slice(1)) {
      const first = ids[0];
      if (first !== undefined) join(first, id);
    }
  }
  const blocks = new Map<GenealogyPersonId, GenealogyPersonId[]>();
  for (const id of personIds) {
    const root = find(id);
    const block = blocks.get(root) ?? [];
    block.push(id);
    blocks.set(root, block);
  }
  return [...blocks.values()]
    .map((block) => block.sort(compareIds))
    .sort((a, b) => compareIds(a[0] ?? "", b[0] ?? ""));
}

function placeComponent(
  graph: GenealogyFamilyGraph,
  component: readonly GenealogyPersonId[],
  generations: ReadonlyMap<GenealogyPersonId, number>,
  personPositions: Map<GenealogyPersonId, GenealogyLayoutPosition>,
  unionPositions: Map<string, GenealogyLayoutPosition>,
  offsetX: number,
): number {
  const componentSet = new Set(component);
  const componentUnions = graph.unions.filter((union) => union.partnerIds.some((id) => componentSet.has(id)) || union.childIds.some((id) => componentSet.has(id)));
  const maxGeneration = Math.max(0, ...component.map((id) => generations.get(id) ?? 0));
  for (let generation = 0; generation <= maxGeneration; generation += 1) {
    const ids = component.filter((id) => generations.get(id) === generation);
    const blocks = partnerBlocks(ids, componentUnions, generation, generations);
    let x = offsetX;
    for (const block of blocks) {
      for (const id of block) {
        personPositions.set(id, { x, y: generation * (GENEALOGY_PERSON_HEIGHT + GENEALOGY_VERTICAL_GAP) });
        x += GENEALOGY_PERSON_WIDTH + GENEALOGY_HORIZONTAL_GAP;
      }
    }
  }

  const positionedUnions = [...componentUnions].sort((a, b) => compareIds(unionKey(a), unionKey(b)));
  for (const union of positionedUnions) {
    const partners = union.partnerIds
      .map((id) => personPositions.get(id))
      .filter((position): position is GenealogyLayoutPosition => position !== undefined);
    if (partners.length === 0) continue;
    const left = Math.min(...partners.map((position) => position.x));
    const right = Math.max(...partners.map((position) => position.x + GENEALOGY_PERSON_WIDTH));
    const unionX = (left + right - GENEALOGY_UNION_SIZE) / 2;
    const generation = Math.max(0, ...union.partnerIds.map((id) => generations.get(id) ?? 0));
    unionPositions.set(union.id, {
      x: unionX,
      y: generation * (GENEALOGY_PERSON_HEIGHT + GENEALOGY_VERTICAL_GAP) + GENEALOGY_PERSON_HEIGHT + GENEALOGY_VERTICAL_GAP / 2,
    });
  }

  for (let generation = 1; generation <= maxGeneration; generation += 1) {
    const children = component.filter((id) => generations.get(id) === generation);
    const childUnions = positionedUnions.filter((union) => union.childIds.some((id) => children.includes(id)));
    const placed = new Set<GenealogyPersonId>();
    const requests = childUnions.map((union) => {
      const ids = union.childIds.filter((id) => children.includes(id)).sort(compareIds);
      const unionPosition = unionPositions.get(union.id);
      const width = ids.length * GENEALOGY_PERSON_WIDTH + Math.max(0, ids.length - 1) * GENEALOGY_HORIZONTAL_GAP;
      return { ids, desiredX: (unionPosition?.x ?? offsetX) + GENEALOGY_UNION_SIZE / 2 - width / 2, width };
    }).filter((request) => request.ids.length > 0).sort((a, b) => a.desiredX - b.desiredX || compareIds(a.ids[0] ?? "", b.ids[0] ?? ""));
    let cursor = requests.length > 0 ? Number.NEGATIVE_INFINITY : offsetX;
    for (const request of requests) {
      const start = Math.max(request.desiredX, cursor);
      request.ids.forEach((id, index) => {
        personPositions.set(id, { x: start + index * (GENEALOGY_PERSON_WIDTH + GENEALOGY_HORIZONTAL_GAP), y: generation * (GENEALOGY_PERSON_HEIGHT + GENEALOGY_VERTICAL_GAP) });
        placed.add(id);
      });
      cursor = start + request.width + GENEALOGY_HORIZONTAL_GAP;
    }
    for (const id of children.filter((childId) => !placed.has(childId)).sort(compareIds)) {
      personPositions.set(id, { x: Math.max(cursor, offsetX), y: generation * (GENEALOGY_PERSON_HEIGHT + GENEALOGY_VERTICAL_GAP) });
      cursor = Math.max(cursor, offsetX) + GENEALOGY_PERSON_WIDTH + GENEALOGY_HORIZONTAL_GAP;
    }
  }

  const minX = Math.min(...component.map((id) => personPositions.get(id)?.x ?? offsetX));
  const translation = Math.max(0, offsetX - minX);
  if (translation > 0) {
    for (const id of component) {
      const position = personPositions.get(id);
      if (position) position.x += translation;
    }
    for (const union of componentUnions) {
      const position = unionPositions.get(union.id);
      if (position) position.x += translation;
    }
  }
  const maxX = Math.max(offsetX, ...component.map((id) => (personPositions.get(id)?.x ?? offsetX) + GENEALOGY_PERSON_WIDTH));
  return maxX;
}

export function layoutGenealogy(graph: GenealogyFamilyGraph): GenealogyLayout {
  const generations = personGenerations(graph);
  alignPartnerGenerations(graph, generations);
  const personPositions = new Map<GenealogyPersonId, GenealogyLayoutPosition>();
  const unionPositions = new Map<string, GenealogyLayoutPosition>();
  let offsetX = 0;
  for (const component of connectedComponents(graph)) {
    const maxX = placeComponent(graph, component, generations, personPositions, unionPositions, offsetX);
    offsetX = maxX + GENEALOGY_COMPONENT_GAP;
  }

  const persons: Record<GenealogyPersonId, GenealogyLayoutPosition> = {};
  for (const id of sortedIds(personPositions.keys())) {
    const position = personPositions.get(id);
    if (position) persons[id] = position;
  }
  const unions: Record<string, GenealogyLayoutPosition> = {};
  for (const id of sortedIds(unionPositions.keys())) {
    const position = unionPositions.get(id);
    if (position) unions[id] = position;
  }
  return { persons, unions };
}
