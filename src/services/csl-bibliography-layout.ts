import type { BibliographyLayout } from "../api/citation-contract.js";

interface ScopedBibliographyDocument {
  createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  defaultView?: (Window & { createEl?<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] }) | null;
}

export function createCslBibliographyElement<K extends keyof HTMLElementTagNameMap>(doc: ScopedBibliographyDocument, tag: K): HTMLElementTagNameMap[K] {
  const element = doc.defaultView?.createEl?.(tag);
  return element?.ownerDocument === doc ? element : doc.createElement(tag);
}

export function applyCslBibliographyLayout(element: HTMLElement, layout: BibliographyLayout): void {
  const values = [layout.entrySpacing, layout.lineSpacing, ...(layout.maxOffset === undefined ? [] : [layout.maxOffset])];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Invalid bibliography layout");
  element.setAttribute("data-csl-hanging-indent", String(layout.hangingIndent));
  element.setAttribute("data-csl-entry-spacing", String(layout.entrySpacing));
  element.setAttribute("data-csl-line-spacing", String(layout.lineSpacing));
  if (layout.secondFieldAlign) element.setAttribute("data-csl-second-field-align", layout.secondFieldAlign);
  if (layout.maxOffset !== undefined) element.setAttribute("data-csl-max-offset", String(layout.maxOffset));
  element.style.setProperty("--csl-entry-spacing", `${layout.entrySpacing * layout.lineSpacing}em`);
  element.style.setProperty("--csl-line-spacing", String(layout.lineSpacing));
  element.style.setProperty("--csl-label-width", `${Math.max(1, layout.maxOffset ?? 3)}ch`);
}

export function readCslBibliographyLayout(element: { getAttribute(name: string): string | null }): BibliographyLayout {
  const number = (name: string, fallback: number): number => {
    const value = element.getAttribute(name);
    const parsed = value === null ? fallback : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const align = element.getAttribute("data-csl-second-field-align");
  return {
    hangingIndent: element.getAttribute("data-csl-hanging-indent") === "true",
    entrySpacing: number("data-csl-entry-spacing", 0),
    lineSpacing: number("data-csl-line-spacing", 1),
    ...(align === "flush" || align === "margin" ? { secondFieldAlign: align } : {}),
    ...(element.getAttribute("data-csl-max-offset") !== null ? { maxOffset: number("data-csl-max-offset", 3) } : {}),
  };
}

/** Converts the numeric label width to a deterministic paragraph tab position. */
export function cslBibliographyTabPositionPt(layout: BibliographyLayout, fontSizePt = 12): number {
  return (Math.max(1, layout.maxOffset ?? 3) * 0.5 + 1) * fontSizePt;
}
