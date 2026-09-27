import type { App, TFile } from "obsidian";
import { toManuscriptRelativePath } from "./annotations.js";
import { formatCaptionedImageMarkdown, formatPlainImageMarkdown, parseImageMarkdown, type ParsedImageMarkdown } from "./image-markdown.js";

/**
 * Add/edit/remove-caption editor actions on a standalone local image embed
 * in a normal Feuillets Markdown sheet. Caption text lives only in the
 * Markdown source (`![Caption](target)`) — never YAML, sidecar metadata, or
 * a proprietary syntax; see image-markdown.ts for the shared parser/
 * formatter this module builds on.
 */

const CAPTION_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"]);

function isRemoteTarget(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

function hasImageExtension(target: string): boolean {
  const clean = target.split(/[?#]/, 1)[0] ?? target;
  const dot = clean.lastIndexOf(".");
  return dot >= 0 && CAPTION_IMAGE_EXTENSIONS.has(clean.slice(dot + 1).toLowerCase());
}

/** Resolves `target` (as written, possibly URI-encoded) to a real vault
 * file — same raw-then-decoded fallback already used by Continu's image
 * resolver (scrivenings-view.ts) and export-render.ts's `resolveImageFile`,
 * never a third resolution strategy. */
function resolveLocalImageFile(app: App, target: string, sourcePath: string): TFile | null {
  const direct = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  if (direct) return direct;
  try {
    const decoded = decodeURIComponent(target);
    if (decoded !== target) return app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
  } catch {
    // Malformed percent-encoding: no decoded fallback, `direct` already null.
  }
  return null;
}

export interface ImageCaptionLineContext {
  parsed: ParsedImageMarkdown;
  hasCaption: boolean;
}

/** Whether `lineText` is a standalone local image embed inside `file`, with
 * `file` itself inside the active Feuillets project — the single gate the
 * three caption commands share. `null` disables every one of them: a line
 * that isn't a lone image embed, a remote source, an unresolved/non-image
 * target, or a file outside the project ("Do not act on unrelated text",
 * "Do not modify notes outside the relevant Feuillets project context"). */
export function imageCaptionLineContext(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  file: TFile,
  lineText: string
): ImageCaptionLineContext | null {
  if (toManuscriptRelativePath(app, settings, file) === null) return null;
  const parsed = parseImageMarkdown(lineText);
  if (!parsed) return null;
  if (isRemoteTarget(parsed.target) || !hasImageExtension(parsed.target)) return null;
  if (!resolveLocalImageFile(app, parsed.target, file.path)) return null;
  return { parsed, hasCaption: !!parsed.caption };
}

export type AddImageCaptionResult =
  | { ok: true; markdown: string }
  | { ok: false; reason: "would-lose-dimensions" };

/**
 * New line text once a caption is added. Fails closed — `{ ok: false }`,
 * nothing to apply — rather than silently discarding an explicit wikilink
 * size (`|300`, `|300x200`): standard Markdown image syntax has no portable
 * way to carry both a caption and a pixel size at once, and this task does
 * not introduce a proprietary one to work around that.
 */
export function addImageCaption(parsed: ParsedImageMarkdown, caption: string): AddImageCaptionResult {
  if (parsed.width !== undefined || parsed.height !== undefined) {
    return { ok: false, reason: "would-lose-dimensions" };
  }
  return { ok: true, markdown: formatCaptionedImageMarkdown(parsed.target, caption) };
}

/** New line text once an existing caption is changed to `caption` — the
 * target (image location/filename) is never touched. */
export function editImageCaption(parsed: ParsedImageMarkdown, caption: string): string {
  return formatCaptionedImageMarkdown(parsed.target, caption);
}

/** New line text once a caption is removed — a plain, Obsidian-native
 * embed; the image itself is never moved, renamed, or deleted. */
export function removeImageCaption(parsed: ParsedImageMarkdown): string {
  return formatPlainImageMarkdown(parsed.target);
}
