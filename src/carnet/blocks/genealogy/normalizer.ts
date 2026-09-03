import type { GenealogyDiagnostic, GenealogyDiagnosticCode } from "./diagnostics.js";
import type {
  GenealogyFamilyGraph,
  GenealogyPerson,
  GenealogyPersonId,
  GenealogyPersonInput,
  GenealogyUnion,
  GenealogyUnionSource,
} from "./types.js";

export type GenealogyNormalizationResult = {
  graph: GenealogyFamilyGraph;
  diagnostics: GenealogyDiagnostic[];
};

type PersonRelations = {
  person: GenealogyPerson;
  explicitParentIds: Set<GenealogyPersonId>;
  spouseIds: Set<GenealogyPersonId>;
};

type UnionAccumulator = {
  partnerIds: GenealogyPersonId[];
  childIds: Set<GenealogyPersonId>;
  sources: Set<GenealogyUnionSource>;
};

function addDiagnostic(
  diagnostics: GenealogyDiagnostic[],
  severity: GenealogyDiagnostic["severity"],
  code: GenealogyDiagnosticCode,
  personId?: GenealogyPersonId,
  relatedPersonId?: GenealogyPersonId,
): void {
  diagnostics.push({
    severity,
    code,
    ...(personId === undefined ? {} : { personId }),
    ...(relatedPersonId === undefined ? {} : { relatedPersonId }),
  });
}

function uniqueIds(ids: readonly GenealogyPersonId[] | undefined): GenealogyPersonId[] {
  return [...new Set(ids ?? [])];
}

function compareGenealogyIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function unionKey(partnerIds: readonly GenealogyPersonId[]): string {
  return partnerIds.slice().sort(compareGenealogyIds).map((id) => encodeURIComponent(id)).join("|");
}

function diagnosticValue(value: GenealogyPersonId | undefined): string {
  return value ?? "";
}

function compareDiagnostics(a: GenealogyDiagnostic, b: GenealogyDiagnostic): number {
  return compareGenealogyIds(a.code, b.code)
    || compareGenealogyIds(diagnosticValue(a.personId), diagnosticValue(b.personId))
    || compareGenealogyIds(diagnosticValue(a.relatedPersonId), diagnosticValue(b.relatedPersonId));
}

function sortIds(values: Iterable<GenealogyPersonId>): GenealogyPersonId[] {
  return [...values].sort(compareGenealogyIds);
}

function sortUnionSources(sources: Iterable<GenealogyUnionSource>): GenealogyUnionSource[] {
  const order: readonly GenealogyUnionSource[] = ["spouse", "parentage"];
  return [...sources].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function detectAncestryCycles(
  relations: Map<GenealogyPersonId, PersonRelations>,
  diagnostics: GenealogyDiagnostic[],
): void {
  const state = new Map<GenealogyPersonId, 0 | 1 | 2>();
  const cycleKeys = new Set<string>();

  for (const rootId of [...relations.keys()].sort(compareGenealogyIds)) {
    if (state.get(rootId)) continue;
    state.set(rootId, 1);
    const stack: { id: GenealogyPersonId; nextParentIndex: number }[] = [
      { id: rootId, nextParentIndex: 0 },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const parentIds = relations.get(frame.id)?.person.parentIds ?? [];
      if (frame.nextParentIndex >= parentIds.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }

      const parentId = parentIds[frame.nextParentIndex];
      frame.nextParentIndex += 1;
      if (state.get(parentId) === 1) {
        const cycleStart = stack.findIndex((entry) => entry.id === parentId);
        const cycleIds = stack.slice(cycleStart).map((entry) => entry.id);
        const key = cycleIds.slice().sort(compareGenealogyIds).join("\u0000");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          addDiagnostic(diagnostics, "error", "ancestry-cycle", cycleIds.slice().sort(compareGenealogyIds)[0]);
        }
      } else if (!state.get(parentId)) {
        state.set(parentId, 1);
        stack.push({ id: parentId, nextParentIndex: 0 });
      }
    }
  }
}

export function normalizeGenealogy(
  inputs: readonly GenealogyPersonInput[],
): GenealogyNormalizationResult {
  const diagnostics: GenealogyDiagnostic[] = [];
  const acceptedInputs = new Map<GenealogyPersonId, GenealogyPersonInput>();

  for (const input of inputs) {
    if (input.id.trim() === "") {
      addDiagnostic(diagnostics, "error", "invalid-person-id");
      continue;
    }
    if (acceptedInputs.has(input.id)) {
      addDiagnostic(diagnostics, "error", "duplicate-person-id", input.id);
      continue;
    }
    acceptedInputs.set(input.id, input);
  }

  const relations = new Map<GenealogyPersonId, PersonRelations>();
  for (const input of acceptedInputs.values()) {
    const parentIds = new Set<GenealogyPersonId>();
    for (const parentId of uniqueIds(input.parentIds)) {
      if (parentId === input.id) {
        addDiagnostic(diagnostics, "error", "self-parent", input.id, parentId);
      } else if (!acceptedInputs.has(parentId)) {
        addDiagnostic(diagnostics, "warning", "unknown-parent", input.id, parentId);
      } else {
        parentIds.add(parentId);
      }
    }

    const spouseIds = new Set<GenealogyPersonId>();
    for (const spouseId of uniqueIds(input.spouseIds)) {
      if (spouseId === input.id) {
        addDiagnostic(diagnostics, "error", "self-spouse", input.id, spouseId);
      } else if (!acceptedInputs.has(spouseId)) {
        addDiagnostic(diagnostics, "warning", "unknown-spouse", input.id, spouseId);
      } else {
        spouseIds.add(spouseId);
      }
    }

    relations.set(input.id, {
      person: {
        id: input.id,
        filePath: input.filePath,
        displayName: input.displayName,
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
        ...(input.birth === undefined ? {} : { birth: input.birth }),
        ...(input.death === undefined ? {} : { death: input.death }),
        parentIds: sortIds(parentIds),
        spouseIds: sortIds(spouseIds),
        childIds: [],
      },
      explicitParentIds: parentIds,
      spouseIds,
    });
  }

  for (const [personId, relation] of relations) {
    for (const spouseId of relation.spouseIds) {
      relations.get(spouseId)?.spouseIds.add(personId);
    }
  }
  for (const relation of relations.values()) {
    relation.person.spouseIds = sortIds(relation.spouseIds);
  }

  for (const [parentId] of relations) {
    for (const childId of uniqueIds(acceptedInputs.get(parentId)?.legacyChildIds)) {
      if (childId === parentId) {
        addDiagnostic(diagnostics, "error", "self-legacy-child", parentId, childId);
        continue;
      }
      const child = relations.get(childId);
      if (!child) {
        addDiagnostic(diagnostics, "warning", "unknown-legacy-child", parentId, childId);
        continue;
      }
      if (child.explicitParentIds.size > 0) {
        if (!child.explicitParentIds.has(parentId)) {
          addDiagnostic(diagnostics, "warning", "legacy-child-conflict", parentId, childId);
        }
      } else {
        child.person.parentIds = sortIds([...child.person.parentIds, parentId]);
      }
    }
  }

  for (const relation of relations.values()) {
    if (relation.person.parentIds.length > 2) {
      addDiagnostic(diagnostics, "warning", "more-than-two-parents", relation.person.id);
    }
  }

  for (const relation of relations.values()) {
    for (const parentId of relation.person.parentIds) {
      relations.get(parentId)?.person.childIds.push(relation.person.id);
    }
  }
  for (const relation of relations.values()) {
    relation.person.childIds = sortIds(relation.person.childIds);
  }

  detectAncestryCycles(relations, diagnostics);

  const unions = new Map<string, UnionAccumulator>();
  const getUnion = (partnerIds: readonly GenealogyPersonId[]): UnionAccumulator => {
    const sortedPartners = sortIds(partnerIds);
    const key = unionKey(sortedPartners);
    let union = unions.get(key);
    if (!union) {
      union = { partnerIds: sortedPartners, childIds: new Set(), sources: new Set() };
      unions.set(key, union);
    }
    return union;
  };

  for (const relation of relations.values()) {
    for (const spouseId of relation.spouseIds) {
      if (compareGenealogyIds(relation.person.id, spouseId) < 0) {
        getUnion([relation.person.id, spouseId]).sources.add("spouse");
      }
    }
  }
  for (const relation of relations.values()) {
    if (relation.person.parentIds.length === 0) continue;
    const union = getUnion(relation.person.parentIds);
    union.sources.add("parentage");
    union.childIds.add(relation.person.id);
  }

  const persons: GenealogyPerson[] = [...relations.values()]
    .map(({ person }) => ({
      ...person,
      parentIds: sortIds(person.parentIds),
      spouseIds: sortIds(person.spouseIds),
      childIds: sortIds(person.childIds),
    }))
    .sort((a, b) => compareGenealogyIds(a.id, b.id));
  const normalizedUnions: GenealogyUnion[] = [...unions.entries()]
    .map(([key, union]) => ({
      id: `union:${key}`,
      partnerIds: union.partnerIds.slice(),
      childIds: sortIds(union.childIds),
      sources: sortUnionSources(union.sources),
    }))
    .sort((a, b) => compareGenealogyIds(a.id, b.id));

  diagnostics.sort(compareDiagnostics);
  return { graph: { persons, unions: normalizedUnions }, diagnostics };
}
