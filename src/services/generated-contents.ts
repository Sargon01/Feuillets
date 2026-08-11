export type GeneratedContentsKind = "summary" | "toc";

export type GeneratedContentsDescriptor = {
  kind: GeneratedContentsKind;
  title: string;
  minLevel: number;
  maxLevel: number;
};

export type GeneratedContentsEntry = {
  text: string;
  level: number;
  sourcePath: string | null;
};

type SourceSegment = { text: string; path: string | null; frontType?: string | null; sourceTitle?: string | null; sourceSubtitle?: string | null };
const headingLine = /^(#{1,6})[ \t]+(.+)$/gm;
const normalize = (value: string) => value.replace(/[*_`]/g, "").trim().replace(/\s+/g, " ");

/** Titre structurel éditorial : seules les métadonnées YAML title/subtitle
 * participent ; short_title est volontairement absent de ce contrat. */
export function structuralTitleForSegment(segment: Pick<SourceSegment, "sourceTitle" | "sourceSubtitle" | "text">): string | null {
  const title = segment.sourceTitle ? normalize(segment.sourceTitle) : "";
  const subtitle = segment.sourceSubtitle ? normalize(segment.sourceSubtitle) : "";
  if (title && subtitle) return `${title} — ${subtitle}`;
  if (title) return title;
  if (subtitle) return subtitle;
  const first = [...(segment.text || "").matchAll(headingLine)].find((h) => h[1].length === 1);
  return first ? normalize(first[2]) : null;
}

/** Entrées communes aux versions Markdown et Word. Le sous-titre YAML est
 * l'autorité ; seul le premier H2 correspondant, avant le contenu, est
 * considéré comme sa matérialisation et évite un doublon. */
export function generatedContentsEntries(segments: SourceSegment[]): GeneratedContentsEntry[] {
  const out: GeneratedContentsEntry[] = [];
  for (const segment of segments) {
    if (segment.frontType) continue;
    const headings = [...(segment.text || "").matchAll(headingLine)].map((m) => ({ level: m[1].length, text: normalize(m[2]), index: m.index ?? 0 }));
    const structuralTitle = structuralTitleForSegment(segment);
    let emittedStructuralTitle = false;
    for (const heading of headings) {
      if (heading.level === 1 && structuralTitle && !emittedStructuralTitle) {
        out.push({ text: structuralTitle, level: 1, sourcePath: segment.path });
        emittedStructuralTitle = true;
        continue;
      }
      out.push({ text: heading.text, level: heading.level, sourcePath: segment.path });
    }
    if (structuralTitle && !emittedStructuralTitle) out.push({ text: structuralTitle, level: 1, sourcePath: segment.path });
  }
  return out;
}

export function generatedContentsDescriptor(kind: GeneratedContentsKind): GeneratedContentsDescriptor {
  return kind === "summary"
    ? { kind, title: "Sommaire", minLevel: 1, maxLevel: 2 }
    : { kind, title: "Table des matières", minLevel: 1, maxLevel: 6 };
}
