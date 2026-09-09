export type CompiledSegment = {
  text: string;
  sceneBreakBefore?: boolean;
};

function normalizeCompileSeparator(raw: string): string {
  const trimmed = raw.trim();
  return trimmed ? `\n\n${trimmed}\n\n` : "\n\n";
}

/** Join compiled segments, applying the custom separator only before a scene
 * that follows another scene. All other boundaries remain blank lines. */
export function joinCompiledSegments(segments: CompiledSegment[], separator: string): string {
  const normalizedSeparator = normalizeCompileSeparator(separator);
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) out += segments[i].sceneBreakBefore ? normalizedSeparator : "\n\n";
    out += segments[i].text;
  }
  return out;
}
