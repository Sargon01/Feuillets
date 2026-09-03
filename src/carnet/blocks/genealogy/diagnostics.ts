import type { GenealogyPersonId } from "./types.js";

export type GenealogyDiagnosticSeverity = "warning" | "error";

export type GenealogyDiagnosticCode =
  | "invalid-person-id"
  | "duplicate-person-id"
  | "unknown-parent"
  | "unknown-spouse"
  | "unknown-legacy-child"
  | "self-parent"
  | "self-spouse"
  | "self-legacy-child"
  | "legacy-child-conflict"
  | "more-than-two-parents"
  | "ancestry-cycle";

export type GenealogyDiagnostic = {
  severity: GenealogyDiagnosticSeverity;
  code: GenealogyDiagnosticCode;
  personId?: GenealogyPersonId;
  relatedPersonId?: GenealogyPersonId;
};
