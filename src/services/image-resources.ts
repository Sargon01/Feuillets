import { TFolder, normalizePath, type App, type TAbstractFile, type TFile } from "obsidian";
import { feuilletsAuxiliaryRootPath, getProjectFolder, imagesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { safeFileName, uniqueFileName } from "./canvas-bridge.js";

/**
 * Automatic storage for images pasted into a normal Markdown sheet of the
 * active Feuillets project. Destination directory mirrors the sheet's
 * parent path under the project's existing Images resources folder — never
 * a second resources hierarchy (see folder-structure.ts: getResourcesRoot,
 * resourcesFolderPath, imagesFolderPath).
 *
 * Every path helper below is anchored on `getProjectFolder(app, settings)`,
 * the same root already used for every other internal Feuillets resource
 * (annotations.json, citations.json, work-notes.json, layout store — see
 * services/annotations.ts, citation-registry.ts) regardless of ouvrages: a
 * project has exactly one Resources hierarchy, never one per ouvrage.
 */

/** Relative path of `sourceFile`'s parent folder under `root`, mirrored
 * below Images — "" for a file directly inside `root`, `null` if the file
 * is not a descendant of `root`. */
export function relativeImageResourceParentPath(root: TFolder, sourceFile: TFile): string | null {
  const parent = sourceFile.parent;
  if (!parent) return null;
  if (parent.path === root.path) return "";
  const prefix = `${root.path}/`;
  if (!parent.path.startsWith(prefix)) return null;
  return parent.path.slice(prefix.length);
}

/** Destination directory (not guaranteed to exist yet) for an image pasted
 * into `sourceFile`, or `null` when there is no active project, the file is
 * outside it, or the file lives under the Feuillets auxiliary folder
 * (`_Feuillets/…`) itself. Pure path resolution: never creates anything. */
export function resolvePastedImageDirectory(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  sourceFile: TFile
): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const auxRoot = feuilletsAuxiliaryRootPath(root);
  if (sourceFile.path === auxRoot || sourceFile.path.startsWith(`${auxRoot}/`)) return null;
  const relative = relativeImageResourceParentPath(root, sourceFile);
  if (relative === null) return null;
  const imagesRoot = imagesFolderPath(app, root);
  return relative ? normalizePath(`${imagesRoot}/${relative}`) : imagesRoot;
}

/** True for a Markdown file that pasted-image handling applies to: it
 * belongs to the active project and is not under `_Feuillets/`. */
export function isEligiblePasteTarget(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  file: TFile | null
): file is TFile {
  if (!file || file.extension !== "md") return false;
  return resolvePastedImageDirectory(app, settings, file) !== null;
}

/** Creates every missing folder along `path`, segment by segment (Obsidian's
 * `Vault.createFolder` is not relied upon to create intermediate parents).
 * Idempotent: an already-existing segment is reused untouched. */
export async function ensurePastedImageDirectory(app: App, path: string): Promise<TFolder> {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  let current = "";
  let folder: TAbstractFile | null = null;
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    folder = await ensureFolder(app, current);
  }
  if (!(folder instanceof TFolder)) throw new Error(`Feuillets: "${normalized}" is not a folder.`);
  return folder;
}

const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-icon": "ico",
};

/** File extension for a pasted image's MIME type, or `null` when the MIME
 * type is not recognizable as an image at all. Any `image/*` type not in the
 * lookup table still gets a plausible extension derived from its subtype
 * (e.g. an unlisted `image/foo` becomes `.foo`), never rejected outright. */
export function pastedImageExtensionFromMime(mimeType: string): string | null {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (PASTED_IMAGE_EXTENSIONS[normalized]) return PASTED_IMAGE_EXTENSIONS[normalized];
  const match = /^image\/([a-z0-9.+-]+)$/.exec(normalized);
  if (!match) return null;
  const extension = match[1].split("+")[0].replace(/[^a-z0-9]/g, "");
  return extension || null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Obsidian-style deterministic fallback name (without extension), e.g.
 * "Pasted image 20260927 112530" for 2026-09-27 11:25:30. */
export function defaultPastedImageBaseName(now: Date): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `Pasted image ${date} ${time}`;
}

/** Clipboard-provided filenames that carry no real information (a generic
 * placeholder some browsers/OSes give a pasted bitmap, or an empty name) —
 * never reused as-is, always replaced by `defaultPastedImageBaseName`. */
const GENERIC_PASTED_IMAGE_NAMES = new Set(["", "image", "clipboard", "blob", "unknown", "untitled"]);

/** Base name (without extension) to use for a pasted image: the clipboard's
 * own filename when it is actually usable, sanitized via the shared
 * `safeFileName`; the deterministic fallback otherwise. */
export function pastedImageBaseName(originalName: string | null | undefined, now: Date): string {
  const trimmed = (originalName || "").trim();
  const withoutExtension = trimmed.replace(/\.[^./]+$/, "").trim();
  if (withoutExtension && !GENERIC_PASTED_IMAGE_NAMES.has(withoutExtension.toLowerCase())) {
    return safeFileName(withoutExtension);
  }
  return defaultPastedImageBaseName(now);
}

/** Raw bytes and metadata of one pasted image, already extracted from the
 * clipboard by the caller (main.ts) — this module never touches
 * `ClipboardEvent`/`DataTransfer` itself for the write path. */
export interface PastedImageData {
  mimeType: string;
  originalName: string | null;
  arrayBuffer: ArrayBuffer;
}

/** Writes one pasted image under the resolved, lazily-created destination
 * directory for `sourceFile`, never overwriting an existing file (deterministic
 * "Name.ext", "Name 2.ext"… suffixing — see `uniqueFileName`,
 * services/canvas-bridge.ts). Returns `null` without writing anything when
 * the paste target is not eligible or the MIME type is not an image. */
export async function savePastedImage(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  sourceFile: TFile,
  data: PastedImageData,
  now: Date = new Date()
): Promise<TFile | null> {
  const directory = resolvePastedImageDirectory(app, settings, sourceFile);
  if (directory === null) return null;
  const extension = pastedImageExtensionFromMime(data.mimeType);
  if (!extension) return null;
  await ensurePastedImageDirectory(app, directory);
  const baseName = pastedImageBaseName(data.originalName, now);
  const path = uniqueFileName((candidate) => !!app.vault.getAbstractFileByPath(candidate), directory, baseName, extension);
  return app.vault.createBinary(path, data.arrayBuffer);
}

/** Minimal, DOM-structural view of a clipboard image item — matches the
 * real `DataTransferItem`/`File` without importing them by name, so this
 * module stays testable without a real `ClipboardEvent`. */
export interface PastedImageClipboardFile {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface PastedImageClipboardItem {
  readonly kind: string;
  readonly type: string;
  getAsFile(): PastedImageClipboardFile | null;
}
export interface PastedImageClipboardData {
  readonly items: ArrayLike<PastedImageClipboardItem>;
}

/** Image file items of a clipboard payload — anything whose MIME type
 * starts with `image/`, in clipboard order. `null`/absent `items` (a
 * text-only paste) yields an empty list. */
export function extractPastedImageItems(
  clipboardData: PastedImageClipboardData | null | undefined
): { file: PastedImageClipboardFile; mimeType: string }[] {
  if (!clipboardData?.items) return [];
  const out: { file: PastedImageClipboardFile; mimeType: string }[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) out.push({ file, mimeType: item.type });
  }
  return out;
}

/** True as soon as the clipboard carries at least one image item — the
 * synchronous half of "positively identified an image paste", checked by
 * the caller (main.ts) before it calls `preventDefault()`. */
export function hasPastedImageItems(clipboardData: PastedImageClipboardData | null | undefined): boolean {
  return extractPastedImageItems(clipboardData).length > 0;
}

/** `generateMarkdownLink` produces a plain link (wikilink `[[...]]` or
 * Markdown `[text](url)`), never an embed — it has no notion of "this is
 * meant to be shown inline". Turns either form into its embed by prefixing
 * `!`, without reconstructing the link itself; a no-op if the link already
 * is an embed (defensive — `generateMarkdownLink` never returns one today). */
export function toImageEmbedMarkdown(link: string): string {
  return link.startsWith("!") ? link : `!${link}`;
}

/** Minimal editor surface this module needs to insert the pasted embeds —
 * satisfied by Obsidian's real `Editor` without importing it by name. */
export interface PastedImageEditorTarget {
  replaceSelection(text: string): void;
}

/** Saves every image item of `clipboardData` under `sourceFile`'s resolved
 * destination and inserts one embed per successfully written image at the
 * editor's current selection, in a single edit. An image that fails to
 * write is skipped silently (never a broken embed, never overwrites an
 * existing file) — callers that need to log the failure can wrap this call.
 * A no-op (no edit at all) when nothing could be written. */
export async function handleEditorImagePaste(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  clipboardData: PastedImageClipboardData | null | undefined,
  editor: PastedImageEditorTarget,
  sourceFile: TFile,
  now: Date = new Date()
): Promise<void> {
  const items = extractPastedImageItems(clipboardData);
  if (items.length === 0) return;
  const embeds: string[] = [];
  for (const item of items) {
    try {
      const arrayBuffer = await item.file.arrayBuffer();
      const created = await savePastedImage(
        app,
        settings,
        sourceFile,
        { mimeType: item.mimeType, originalName: item.file.name || null, arrayBuffer },
        now
      );
      if (created) embeds.push(toImageEmbedMarkdown(app.fileManager.generateMarkdownLink(created, sourceFile.path)));
    } catch (error) {
      console.error("Feuillets: failed to save a pasted image", error);
    }
  }
  if (embeds.length > 0) editor.replaceSelection(embeds.join("\n"));
}
