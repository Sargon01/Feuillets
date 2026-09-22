import { TFile, normalizePath, type App } from "obsidian";
import type { ResearchDocumentContext } from "./research-document-context.js";
import { extractCitekeysCached } from "./citekey-bibliography.js";
import { loadCitationRegistry, resolveCitationOccurrence, type CitationOccurrence } from "./citation-registry.js";

export type ResearchCitationAnalysis = {
  citekeyCounts: ReadonlyMap<string, number>;
  sourceCitationCounts: ReadonlyMap<string, number>;
};

/** Single pass over `documentContext.files`, computed once per Research
 * render and shared by the Sources counters and the Bibliography section —
 * never re-derives the document scope itself (that stays
 * research-document-context.ts's sole responsibility) and never touches
 * bibliographic-resource discovery (.bib inheritance stays
 * citekey-bibliography.ts's, deliberately independent of this scope).
 *
 * A registry occurrence only ever counts toward sourceCitationCounts once
 * its anchor is confirmed to still resolve in the citing document's
 * CURRENT content (resolveCitationOccurrence(), the same mechanism the
 * registry already exposes elsewhere) — a citation removed from the text
 * stops being counted even though the registry entry itself is left
 * untouched; this analysis never writes back to the registry. Anchor
 * validation reuses the exact same content already read for citekey
 * extraction: each eligible file is read from the vault exactly once. */
export async function analyzeResearchCitations(
  app: App,
  settings: FeuilletsSettings,
  documentContext: ResearchDocumentContext,
): Promise<ResearchCitationAnalysis> {
  const eligibleFiles = documentContext.files.filter(
    (file): file is TFile => file instanceof TFile && file.extension === "md",
  );

  const registry = await loadCitationRegistry(app, settings);
  const occurrencesByAbsolutePath = new Map<string, CitationOccurrence[]>();
  if (registry.citations.length > 0) {
    const rootPath = normalizePath(documentContext.projectRoot.path);
    for (const occurrence of registry.citations) {
      const absolutePath = normalizePath(`${rootPath}/${occurrence.file}`);
      const existing = occurrencesByAbsolutePath.get(absolutePath);
      if (existing) existing.push(occurrence);
      else occurrencesByAbsolutePath.set(absolutePath, [occurrence]);
    }
  }

  const citekeyCounts = new Map<string, number>();
  const sourceCitationCounts = new Map<string, number>();

  for (const file of eligibleFiles) {
    const content = typeof app.vault.cachedRead === "function"
      ? await app.vault.cachedRead(file)
      : await app.vault.read(file);

    for (const [key, count] of extractCitekeysCached(file, content)) {
      citekeyCounts.set(key, (citekeyCounts.get(key) || 0) + count);
    }

    /* Only occurrences whose citing file is itself eligible (i.e. already
       being read above, part of documentContext.files) are ever looked
       up — an occurrence belonging to a sibling space's file, never
       visited by this loop, is implicitly never counted. */
    const occurrences = occurrencesByAbsolutePath.get(file.path);
    if (!occurrences) continue;
    for (const occurrence of occurrences) {
      if (!resolveCitationOccurrence(occurrence, content)) continue;
      const sourcePath = normalizePath(occurrence.sourcePath);
      sourceCitationCounts.set(sourcePath, (sourceCitationCounts.get(sourcePath) || 0) + 1);
    }
  }

  return { citekeyCounts, sourceCitationCounts };
}
