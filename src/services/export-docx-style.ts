import { AlignmentType } from "docx";
import { marginsFor } from "../utils/export-templates.js";
import { TITLE_ROLE_MARKER } from "../utils/title-roles.js";

type FrontOverride = { style?: TitlePageStyle | null; isTitleLine?: boolean };
type SectionPageMargin = Required<Pick<import("docx").IPageMarginAttributes, "top" | "right" | "bottom" | "left">>;

export const FRONT_PAGE_LINE_SPACING = { line: 240, lineRule: "auto" } satisfies import("docx").ISpacingProperties;
export const FRONT_TITLE_FONT_SIZE = 36;

export function alignmentFor(tpl: { align?: string }): typeof AlignmentType[keyof typeof AlignmentType] {
  if (tpl.align === "justify") return AlignmentType.JUSTIFIED;
  if (tpl.align === "center") return AlignmentType.CENTER;
  if (tpl.align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

export function wordLocale(lang: string | null | undefined): string {
  const l = (lang || "fr").toLowerCase();
  if (l.startsWith("en")) return "en-US";
  if (l.startsWith("de")) return "de-DE";
  if (l.startsWith("es")) return "es-ES";
  if (l.startsWith("it")) return "it-IT";
  return "fr-FR";
}

export function sectionPageMargin(tpl: ExportTemplate): SectionPageMargin {
  const margins = marginsFor(tpl);
  return { top: `${margins.top}cm`, bottom: `${margins.bottom}cm`, left: `${margins.left}cm`, right: `${margins.right}cm` };
}

export function titleRoleOf(el: { textContent?: string | null } | null | undefined): string | null {
  if (!el) return null;
  const raw = (el.textContent || "").trim();
  if (!raw.startsWith(TITLE_ROLE_MARKER)) return null;
  return raw.slice(TITLE_ROLE_MARKER.length).trim().toLowerCase();
}

export function frontRoleStyle(tpl: ExportTemplate | null | undefined, role: string | null | undefined): TitlePageStyle | null {
  const styles = tpl && tpl.titlePage && tpl.titlePage.styles;
  return (role && styles && styles[role]) || null;
}

export function frontInlineMarks(frontOverride: FrontOverride | null | undefined): { size?: number; bold?: boolean; italics?: boolean } {
  if (!frontOverride) return {};
  const st = frontOverride.style;
  if (st) return { size: st.fontSizePt != null ? st.fontSizePt * 2 : undefined, bold: st.bold, italics: st.italic };
  return frontOverride.isTitleLine ? { size: FRONT_TITLE_FONT_SIZE } : {};
}

export function frontSpacing(frontOverride: FrontOverride | null | undefined): typeof FRONT_PAGE_LINE_SPACING & { before?: number; after?: number } {
  const st = frontOverride && frontOverride.style;
  if (!st) return FRONT_PAGE_LINE_SPACING;
  return { ...FRONT_PAGE_LINE_SPACING, ...(st.marginTopPt != null ? { before: st.marginTopPt * 20 } : {}), ...(st.marginBottomPt != null ? { after: st.marginBottomPt * 20 } : {}) };
}

export function frontAlignment(frontOverride: FrontOverride | null | undefined): typeof AlignmentType[keyof typeof AlignmentType] {
  const st = frontOverride && frontOverride.style;
  if (st && st.align) return alignmentFor({ align: st.align });
  return AlignmentType.CENTER;
}
