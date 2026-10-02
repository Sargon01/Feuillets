/** Decodes a note target using the final fragment of a rendered link. */
export function normalizeFootnoteFragment(href: string): string | null {
  const hashIndex = href.lastIndexOf("#");
  if (hashIndex < 0) return null;
  let fragment = href.slice(hashIndex + 1);
  try { fragment = decodeURIComponent(fragment); } catch { /* Preserve malformed URI fragments. */ }
  return fragment || null;
}

export function footnoteCallId(element: Element): string | null {
  const link = element.tagName.toLowerCase() === "a" ? element : element.querySelector("a[href]");
  return normalizeFootnoteFragment(link?.getAttribute("href") ?? "");
}

export function isFootnoteSection(element: Element): boolean {
  return Boolean(element.classList?.contains("footnotes"));
}

export function isFootnoteCall(element: Element): boolean {
  return element.tagName.toLowerCase() === "sup" && Boolean(element.classList?.contains("footnote-ref"));
}

export function footnoteDefinitions(root: Element): Element[] {
  const definitions: Element[] = [];
  const visit = (element: Element, inNotes: boolean): void => {
    const inside = inNotes || isFootnoteSection(element);
    if (inside && element.tagName.toLowerCase() === "li" && element.getAttribute("id")) definitions.push(element);
    for (const child of Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1)) visit(child, inside);
  };
  visit(root, false);
  return definitions;
}

export function footnoteCallsInOrder(root: Element): Element[] {
  const calls: Element[] = [];
  const visit = (element: Element): void => {
    if (isFootnoteSection(element) || ["CODE", "PRE", "SCRIPT", "STYLE"].includes(element.tagName)) return;
    if (isFootnoteCall(element)) { calls.push(element); return; }
    for (const child of Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1)) visit(child);
  };
  visit(root);
  return calls;
}

export interface DomFootnote {
  readonly id: string;
  readonly call: Element;
  readonly definition: Element;
  readonly noteIndex: number;
}

/** Resolves first surviving calls; missing or duplicate targets fail closed. */
export function pairDomFootnotes(root: Element): readonly DomFootnote[] | null {
  const definitions = footnoteDefinitions(root);
  const notes: DomFootnote[] = [];
  const seen = new Set<string>();
  for (const call of footnoteCallsInOrder(root)) {
    const id = footnoteCallId(call);
    if (!id) return null;
    if (seen.has(id)) continue;
    const matches = definitions.filter((definition) => definition.getAttribute("id") === id);
    if (matches.length !== 1) return null;
    seen.add(id);
    notes.push({ id, call, definition: matches[0], noteIndex: notes.length + 1 });
  }
  return notes;
}
