export type GenealogyPersonId = string;

export type GenealogyPersonInput = {
  id: GenealogyPersonId;
  filePath: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  birth?: string;
  death?: string;
  parentIds?: readonly GenealogyPersonId[];
  spouseIds?: readonly GenealogyPersonId[];
  legacyChildIds?: readonly GenealogyPersonId[];
};

export type GenealogyPerson = {
  id: GenealogyPersonId;
  filePath: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  birth?: string;
  death?: string;
  parentIds: GenealogyPersonId[];
  spouseIds: GenealogyPersonId[];
  childIds: GenealogyPersonId[];
};

export type GenealogyUnionSource = "spouse" | "parentage";

export type GenealogyUnion = {
  id: string;
  partnerIds: GenealogyPersonId[];
  childIds: GenealogyPersonId[];
  sources: GenealogyUnionSource[];
};

export type GenealogyFamilyGraph = {
  persons: GenealogyPerson[];
  unions: GenealogyUnion[];
};
