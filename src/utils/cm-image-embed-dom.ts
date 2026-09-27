/**
 * DOM shape shared by every inline image-embed widget in Feuillets: Continu's
 * `ScriveningsImageWidget` (cm-scrivenings-markdown.ts) and the normal
 * editor's captioned-image widget (cm-editor-image-caption.ts) both build
 * their `<img>`/caption element through this one function, so the two
 * surfaces always visually produce the same object — never two independently
 * maintained DOM trees for what is conceptually the same picture.
 *
 * Purely DOM/presentation-oriented: no CodeMirror, no resolution logic, no
 * pointer/click/drag event handling, no knowledge of Markdown syntax. Each
 * widget owns its OWN interaction on top of the plain element this returns
 * (see cm-editor-image-caption.ts's doc comment for why the normal editor
 * and Continu must NOT share interaction semantics, only this visual shape).
 * The element carries no `<a>`, no `href`/`data-href`, and no Obsidian
 * internal-link class — nothing here makes it look, to Obsidian's own native
 * handlers, like a navigable link or embed.
 */

export interface ImageEmbedDomInput {
  /** Already-resolved image source (a vault resource URL, a remote http(s)
   * URL, or any other src a caller has already decided is safe to use). */
  src: string;
  alt: string;
  /** Caption text to display below the image, or absent/blank for none. */
  caption?: string;
  width?: number;
  height?: number;
  onLoad?: () => void;
}

/** `<span class="cm-scrivenings-image-embed"><img/>[<span class="cm-scrivenings-image-caption">…</span>]</span>`. */
export function buildImageEmbedDom(input: ImageEmbedDomInput): HTMLElement {
  const root = createSpan({ cls: "cm-scrivenings-image-embed" });
  const element = createEl("img");
  element.src = input.src;
  element.alt = input.alt;
  element.loading = "lazy";
  if (input.onLoad) element.addEventListener("load", input.onLoad);
  if (input.width !== undefined) element.width = input.width;
  if (input.height !== undefined) element.height = input.height;
  root.appendChild(element);
  if (input.caption?.trim()) {
    const caption = createSpan({ cls: "cm-scrivenings-image-caption" });
    caption.setText(input.caption);
    root.appendChild(caption);
  }
  return root;
}
