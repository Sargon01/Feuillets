/** Treat the input as one installed family, never as executable CSS or a font list. */
export function normalizeCarnetFont(value: unknown): string {
  return typeof value === "string" ? Array.from(value.trim()).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("") : "";
}

export function applyCarnetFont(element: HTMLElement, value: unknown): boolean {
  if (!element.style) return false;
  const font = normalizeCarnetFont(value);
  const css = font ? `${JSON.stringify(font)}, var(--font-text)` : "";
  if (element.style.getPropertyValue("--feuillets-carnet-font") === css) return false;
  if (css) element.style.setProperty("--feuillets-carnet-font", css);
  else element.style.removeProperty("--feuillets-carnet-font");
  return true;
}
