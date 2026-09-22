import { TFile, normalizePath, type App } from "obsidian";
import type { ResearchDocumentContext } from "./research-document-context.js";
import { extractCitekeysCached } from "./citekey-bibliography.js";
import { loadCitationRegistry } from "./citation-registry.js";

export type ResearchCitationAnalysis = {
  citekeyCounts: ReadonlyMap<string, number>;
  sourceCitationCounts: ReadonlyMap<string, number>;
};

/** Single pass over `documentContext.files`, computed once per Research
 * render and shared by the Sources counters and the Bibliography section —
 * never re-derives the document scope itself (that stays
 * research-document-context.ts's sole responsibility) and never touches
 * bibliographic-resource discovery (.bib inheritance stays
 * citekey-bibliography.ts's, deliberately independent of this scope). */
export async function analyzeResearchCitations(
  app: App,
  settings: FeuilletsSettings,
  documentContext: ResearchDocumentContext,
): Promise<ResearchCitationAnalysis> {
  const eligibleFiles = documentContext.files.filter(
    (file): file is TFile => file instanceof TFile && file.extension === "md",
  );

  const citekeyCounts = new Map<string, number>();
  for (const file of eligibleFiles) {
    const content = typeof app.vault.cachedRead === "function"
      ? await app.vault.cachedRead(file)
      : await app.vault.read(file);
    for (const [key, count] of extractCitekeysCached(file, content)) {
      citekeyCounts.set(key, (citekeyCounts.get(key) || 0) + count);
    }
  }

  const sourceCitationCounts = new Map<string, number>();
  const registry = await loadCitationRegistry(app, settings);
  if (registry.citations.length > 0) {
    const scopedPaths = new Set(eligibleFiles.map((file) => file.path));
    const rootPath = normalizePath(documentContext.projectRoot.path);
    for (const occurrence of registry.citations) {
      const absolutePath = normalizePath(`${rootPath}/${occurrence.file}`);
      if (!scopedPaths.has(absolutePath)) continue;
      sourceCitationCounts.set(
        occurrence.sourcePath,
        (sourceCitationCounts.get(occurrence.sourcePath) || 0) + 1,
      );
    }
  }

  return { citekeyCounts, sourceCitationCounts };
}
