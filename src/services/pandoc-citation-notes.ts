import { parseFootnotes } from "../utils/footnotes.js";
import { maskProtectedContexts, parsePandocCitationDocument, type ParsedPandocCitationDocument } from "./pandoc-citation-parser.js";

export interface CitationNoteContext {
  readonly noteIndex: number;
  readonly kind: "reference" | "inline";
  readonly markerFrom: number;
  readonly markerTo: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly id?: string;
}

function protectedDefinitionOffsets(markdown: string, bodyFrom: number, bodyTo: number): Set<number> {
  const positions: number[] = [];
  let projected = "";
  let start = bodyFrom;
  let firstLine = true;
  while (start < bodyTo) {
    const newline = markdown.indexOf("\n", start);
    const end = newline < 0 ? bodyTo : Math.min(newline, bodyTo);
    const line = markdown.slice(start, end);
    const indent = firstLine ? 0 : /^(?: {1,4}|\t)/.exec(line)?.[0].length ?? 0;
    for (let index = start + indent; index < end; index++) {
      projected += markdown[index];
      positions.push(index);
    }
    if (end < bodyTo) { projected += "\n"; positions.push(end); }
    start = end + 1;
    firstLine = false;
  }
  const protectedText = maskProtectedContexts(projected);
  const offsets = new Set<number>();
  for (let index = 0; index < projected.length; index++) {
    if (projected[index] !== protectedText[index]) offsets.add(positions[index]);
  }
  return offsets;
}

/** Adds note ownership and reading order while preserving source coordinates. */
export function buildNoteAwarePandocCitationDocument(markdown: string): {
  document: ParsedPandocCitationDocument;
  noteCount: number;
  notes: readonly CitationNoteContext[];
} {
  const parsed = parsePandocCitationDocument(markdown);
  const masked = maskProtectedContexts(markdown);
  const { references, definitions } = parseFootnotes(markdown);
  const visibleDefinitions = definitions.filter((definition) => masked.slice(definition.start, definition.start + 2) === "[^");
  const inDefinition = (position: number) => visibleDefinitions.some((definition) => position >= definition.start && position < definition.end);
  const candidates: Omit<CitationNoteContext, "noteIndex">[] = [];
  const invalidInlineRanges: { from: number; to: number }[] = [];

  for (let i = 0; i < masked.length - 1; i++) {
    if (masked.slice(i, i + 2) !== "^[" || inDefinition(i)) continue;
    let escapeCount = 0;
    for (let j = i - 1; j >= 0 && markdown[j] === "\\"; j--) escapeCount++;
    if (escapeCount % 2 !== 0) continue;
    let depth = 1;
    let end = i + 2;
    for (; end < masked.length; end++) {
      if (markdown[end - 1] === "\\") continue;
      if (masked[end] === "[") depth++;
      if (masked[end] === "]" && --depth === 0) break;
    }
    if (depth !== 0) {
      invalidInlineRanges.push({ from: i, to: markdown.length });
      break;
    }
    candidates.push({ kind: "inline", markerFrom: i, markerTo: end + 1, bodyFrom: i + 2, bodyTo: end });
    i = end;
  }

  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.id) || masked.slice(reference.start, reference.end) !== markdown.slice(reference.start, reference.end)
      || candidates.some((note) => reference.start >= note.markerFrom && reference.start < note.markerTo)
      || invalidInlineRanges.some((range) => reference.start >= range.from && reference.start < range.to)) continue;
    const matches = visibleDefinitions.filter((definition) => definition.id === reference.id);
    if (matches.length !== 1) continue;
    seen.add(reference.id);
    const definition = matches[0];
    const colon = markdown.indexOf("]:", definition.start) + 1;
    candidates.push({ kind: "reference", id: reference.id, markerFrom: reference.start, markerTo: reference.end,
      bodyFrom: colon + 1, bodyTo: definition.end });
  }
  const notes = candidates.sort((a, b) => a.markerFrom - b.markerFrom).map((note, index) => ({ ...note, noteIndex: index + 1 }));
  // Remove definition indentation only for protection scanning, never for citation coordinates.
  const definitionProtection = new Set(notes.filter((note) => note.kind === "reference")
    .flatMap((note) => [...protectedDefinitionOffsets(markdown, note.bodyFrom, note.bodyTo)]));
  const ownership = new Map<string, CitationNoteContext>();
  const occurrences = parsed.occurrences.filter((occurrence) => {
    if (definitionProtection.has(occurrence.from)) return false;
    if (invalidInlineRanges.some((range) => occurrence.from >= range.from && occurrence.to <= range.to)) return false;
    const note = notes.find((context) => occurrence.from >= context.bodyFrom && occurrence.to <= context.bodyTo);
    if (!note && inDefinition(occurrence.from)) return false;
    if (note) ownership.set(occurrence.clusterId, note);
    return true;
  }).map((occurrence) => {
    const note = ownership.get(occurrence.clusterId);
    return note ? { ...occurrence, cluster: { ...occurrence.cluster, noteIndex: note.noteIndex } } : occurrence;
  });
  const ordered = [...occurrences].sort((a, b) =>
    (ownership.get(a.clusterId)?.markerFrom ?? a.from) - (ownership.get(b.clusterId)?.markerFrom ?? b.from) || a.from - b.from);
  return { document: { occurrences, clusters: ordered.map((occurrence) => occurrence.cluster) }, noteCount: notes.length, notes };
}
