import { translate, type Locale } from "../i18n/index.js";
import type { CrossReferenceDisplayMode } from "./cross-reference-model.js";
import type { NumberedCrossReferenceTarget } from "./cross-reference-context.js";

export function formatCrossReference(target: NumberedCrossReferenceTarget, mode: CrossReferenceDisplayMode, locale: Locale): string {
  if (mode === "title") return target.detectedTarget.titleOrCaption;
  if (mode === "number") return String(target.number);
  return `${translate(locale, `xref.type.${target.detectedTarget.type}`)} ${target.number}`;
}
