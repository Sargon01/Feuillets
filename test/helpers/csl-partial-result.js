/** Provider fixture with an unresolved whole cluster and no synthetic items. */
export function partialCslResult(request) {
  const unresolved = request.clusters.filter((cluster) => cluster.items.some((item) => item.id === "missing9999"));
  return {
    documentId: request.documentId,
    revision: request.revision,
    citations: request.clusters.filter((cluster) => !unresolved.includes(cluster)).map((cluster) => ({
      clusterId: cluster.id, plainText: "Rendered known2026",
      content: [{ type: "text", text: "Rendered known2026" }],
    })),
    bibliography: request.includeBibliography ? {
      entries: [{ itemIds: ["known2026"], plainText: "Known book", content: [{ type: "text", text: "Known book" }] }],
      layout: { hangingIndent: false, entrySpacing: 0, lineSpacing: 1 },
    } : null,
    diagnostics: unresolved.map((cluster) => ({
      code: "UNKNOWN_CITEKEY", severity: "error", clusterId: cluster.id,
      citekey: "missing9999", message: "Citekey is absent from the bibliography.",
    })),
  };
}

export function partialCslSource(grouped) {
  return `A [@known2026].\nB ${grouped ? "[@known2026; @missing9999]" : "[@missing9999]"}.\nC [@known2026].`;
}
