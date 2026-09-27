import { TFile, TFolder, normalizePath, type App, type TAbstractFile } from "obsidian";
import { feuilletsAuxiliaryRootPath, getProjectFolder, imagesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { safeFileName, uniqueFileName } from "./canvas-bridge.js";
import { findImageEmbedsInMarkdown } from "./image-markdown.js";

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

/* -------------------------------------------------------------------- *
 * Image-mirror folder rename/move synchronization (Lot 2).
 *
 * When a CONTENT folder inside a manuscript is renamed or moved, its
 * mirrored Images folder (if one exists — see resolvePastedImageDirectory
 * above) should follow it, exactly like the pasted-image destination
 * itself already mirrors a sheet's parent path. This is folder rename/move
 * synchronization ONLY: no orphan cleanup, no deletion synchronization, no
 * image migration, no cross-project moves, no project-root handling
 * (existing Feuillets project-path remapping already owns that lifecycle).
 * -------------------------------------------------------------------- */

/** True when `path` is `root` itself or a descendant of it. */
function isSameOrDescendantPath(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** True when `path` is a STRICT descendant of `root` — never `root` itself.
 * A manuscript root's own rename/move is explicitly out of scope for this
 * feature (existing Feuillets project-path remapping owns that lifecycle),
 * so every candidate root below requires this, not `isSameOrDescendantPath`. */
function isStrictDescendantPath(root: string, path: string): boolean {
  return path.startsWith(`${root}/`);
}

function parentPathOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Shared owning-root selection for BOTH the folder-mirror resolver
 * (`resolveImageResourceFolderRename`) and the file-move resolver
 * (`resolveImageResourceFileMove`, Lot 3, below): the most specific
 * (longest `root.path`) known project whose manuscript root satisfies
 * `belongs(root.path, path)` for BOTH `pathA` and `pathB`, and whose
 * Feuillets auxiliary folder contains neither. Never more than one root, so
 * a single Vault event never triggers more than one mirror operation.
 *
 * `belongs` differs between the two callers: a FOLDER's own rename must
 * never equal the root itself (`isStrictDescendantPath` — a project-root
 * rename/move is out of scope), while a Markdown file's PARENT folder
 * legitimately CAN be the root itself (`isSameOrDescendantPath` — a file
 * living directly at the project root is an ordinary case). */
function selectOwningRoot(
  app: App,
  contexts: readonly FeuilletsSettings[],
  pathA: string,
  pathB: string,
  belongs: (rootPath: string, path: string) => boolean
): TFolder | null {
  let bestRoot: TFolder | null = null;
  for (const settings of contexts) {
    const root = getProjectFolder(app, settings);
    if (!root) continue;
    if (!belongs(root.path, pathA) || !belongs(root.path, pathB)) continue;
    const auxRoot = feuilletsAuxiliaryRootPath(root);
    if (isSameOrDescendantPath(auxRoot, pathA) || isSameOrDescendantPath(auxRoot, pathB)) continue;
    if (!bestRoot || root.path.length > bestRoot.path.length) bestRoot = root;
  }
  return bestRoot;
}

/** One resolved image-mirror rename: the owning manuscript root, and the
 * exact old/new mirror paths under its Images resources folder. */
export interface ImageResourceFolderRenamePlan {
  root: TFolder;
  oldMirrorPath: string;
  newMirrorPath: string;
}

/** Pure path resolution — never touches the filesystem. Determines whether
 * a folder rename/move (`oldPath` -> `newPath`) corresponds to an
 * image-resource mirror move, and if so, computes the mirror's old and new
 * paths. `contexts` is every KNOWN project (active or not — see
 * `knownProjectContexts()`, main.ts's `registerVaultEvents()`), never only
 * the active one.
 *
 * Returns `null` when:
 * - `newPath` does not currently resolve to a `TFolder` (a single Markdown
 *   file rename, or anything else that is not a folder);
 * - no known project's manuscript root is a STRICT ancestor of BOTH
 *   `oldPath` and `newPath` (this rejects a project-root rename itself, a
 *   cross-project move, and moving content into/out of a project — see
 *   this module's own doc comment);
 * - `oldPath` or `newPath` is that root's Feuillets auxiliary folder
 *   (`_Feuillets/…`) itself or a descendant of it — critical for a
 *   free/adopted project, where `_Feuillets` can be inside the manuscript
 *   root itself: without this, the mirror move this function triggers
 *   would generate its OWN rename event and recurse into itself.
 *
 * When several known project roots are strict ancestors of both paths
 * (nested/overlapping known projects), the MOST SPECIFIC one (longest
 * `root.path`) is used — never more than one, so a single Vault rename
 * event never triggers more than one mirror move. */
export function resolveImageResourceFolderRename(
  app: App,
  contexts: readonly FeuilletsSettings[],
  oldPath: string,
  newPath: string
): ImageResourceFolderRenamePlan | null {
  if (!oldPath || !newPath || oldPath === newPath) return null;
  if (!(app.vault.getAbstractFileByPath(newPath) instanceof TFolder)) return null;

  const bestRoot = selectOwningRoot(app, contexts, oldPath, newPath, isStrictDescendantPath);
  if (!bestRoot) return null;

  const oldRelative = oldPath.slice(bestRoot.path.length + 1);
  const newRelative = newPath.slice(bestRoot.path.length + 1);
  const imagesRoot = imagesFolderPath(app, bestRoot);
  return {
    root: bestRoot,
    oldMirrorPath: normalizePath(`${imagesRoot}/${oldRelative}`),
    newMirrorPath: normalizePath(`${imagesRoot}/${newRelative}`),
  };
}

/** Moves a content folder's mirrored Images folder to follow it, after a
 * Vault "rename" event — called from main.ts's centralized `vault.on("rename", …)`
 * handler, never a second Vault listener. A no-op (nothing created, nothing
 * moved) whenever `resolveImageResourceFolderRename` returns `null`, or when
 * the OLD mirror folder does not currently exist: the Images hierarchy stays
 * lazy with respect to nested content folders, so a content-folder rename
 * never conjures up an empty mirror folder that was never there before.
 *
 * Uses `app.fileManager.renameFile` (never `vault.rename`) for the actual
 * move, so Obsidian performs its own normal link-maintenance on every file
 * inside the moved folder — this function never rewrites Markdown links
 * itself.
 *
 * Fails closed on a destination collision (the exact `newMirrorPath` already
 * exists): logs one `console.warn` and leaves both the old mirror and the
 * existing destination untouched — never an overwrite, merge, dedup, or
 * rename-to-"folder 2". This is the ONLY outcome this function logs itself;
 * an unexpected filesystem failure is left to propagate to the caller (see
 * this module's own call site in main.ts, which logs it via `console.error`
 * without ever aborting the rest of the Vault rename maintenance). */
export async function syncImageResourceFolderAfterRename(
  app: App,
  contexts: readonly FeuilletsSettings[],
  oldPath: string,
  newPath: string
): Promise<void> {
  const plan = resolveImageResourceFolderRename(app, contexts, oldPath, newPath);
  if (!plan) return;

  const oldMirror = app.vault.getAbstractFileByPath(plan.oldMirrorPath);
  if (!(oldMirror instanceof TFolder)) return;

  if (app.vault.getAbstractFileByPath(plan.newMirrorPath)) {
    console.warn(
      "Feuillets image resource mirror rename: destination already exists, leaving both untouched",
      plan.oldMirrorPath,
      plan.newMirrorPath
    );
    return;
  }

  const destinationParent = parentPathOf(plan.newMirrorPath);
  if (destinationParent) await ensurePastedImageDirectory(app, destinationParent);
  await app.fileManager.renameFile(oldMirror, plan.newMirrorPath);
}

/* -------------------------------------------------------------------- *
 * Move a single Markdown sheet's OWN referenced images with it (Lot 3).
 *
 * Lot 2 (above) follows a FOLDER rename/move. This lot handles the other
 * case: a single Markdown FILE moved to a different parent folder, whose
 * pasted images (mirrored under the OLD parent's Images directory — see
 * resolvePastedImageDirectory) would otherwise be silently left behind.
 * Only images the moved sheet actually references, that physically live
 * DIRECTLY inside the old mirror directory, ever move — never the whole
 * directory, never an unrelated or nested image (see
 * resolveEligibleMirroredImageFile below).
 * -------------------------------------------------------------------- */

/** Every raster extension a pasted image could have been written with —
 * derived from `PASTED_IMAGE_EXTENSIONS` (this file, above) rather than a
 * second, independently maintained list: an image this feature considers
 * moving is, by definition, one Feuillets itself could have produced. */
const MOVABLE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(Object.values(PASTED_IMAGE_EXTENSIONS));

/** Resolves ONE parsed embed target to an eligible `TFile` to move, or
 * `null` when it is remote, unresolvable, not a recognized image
 * extension, or not living DIRECTLY inside `oldImageDirectory` (a nested
 * subfolder, a different mirror, or anywhere else is never eligible — see
 * this module's own doc comment, §7 of the originating task).
 *
 * Tries the target as written, then `decodeURIComponent`-ed (mirroring the
 * same raw-then-decoded convention already used by
 * cm-editor-image-caption.ts's resolveEditorImageSource and Continu's own
 * image resolver) — and, because this runs AFTER the sheet has already
 * moved, tries resolving against the sheet's NEW path first, falling back
 * to its OLD path, so `metadataCache.getFirstLinkpathDest`'s own relative/
 * ambiguous-link resolution is never penalized by mid-move path timing. */
function resolveEligibleMirroredImageFile(
  app: App,
  target: string,
  newSourcePath: string,
  oldSourcePath: string,
  oldImageDirectory: string
): TFile | null {
  if (/^https?:\/\//i.test(target) || target.startsWith("data:")) return null;

  const candidates = [target];
  try {
    const decoded = decodeURIComponent(target);
    if (decoded !== target) candidates.push(decoded);
  } catch {
    // Malformed percent-encoding: no decoded fallback, raw candidate only.
  }

  for (const sourcePath of [newSourcePath, oldSourcePath]) {
    for (const candidate of candidates) {
      const resolved = app.metadataCache.getFirstLinkpathDest(candidate, sourcePath);
      if (
        resolved instanceof TFile &&
        MOVABLE_IMAGE_EXTENSIONS.has(resolved.extension.toLowerCase()) &&
        resolved.parent?.path === oldImageDirectory
      ) {
        return resolved;
      }
    }
  }
  return null;
}

/** Every image the moved sheet references that is eligible to move with
 * it — deduplicated by resolved file path (the same physical image
 * referenced twice in the sheet moves exactly once) — found by scanning
 * `content` (the sheet's OWN current text, never `metadataCache`: reading
 * the file directly sidesteps any risk of the Vault rename callback
 * running before the cache has caught up, see this module's own call site
 * for why). */
function eligibleImagesReferencedBy(
  app: App,
  content: string,
  newSourcePath: string,
  oldSourcePath: string,
  oldImageDirectory: string
): TFile[] {
  const byPath = new Map<string, TFile>();
  for (const embed of findImageEmbedsInMarkdown(content)) {
    const file = resolveEligibleMirroredImageFile(app, embed.target, newSourcePath, oldSourcePath, oldImageDirectory);
    if (file) byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

/** One resolved image-mirror directory move for a single moved Markdown
 * sheet: the owning manuscript root, and the old/new Images directories
 * its own images should move between. */
export interface ImageResourceFileMovePlan {
  root: TFolder;
  oldImageDirectory: string;
  newImageDirectory: string;
}

/** Pure path resolution — never touches the filesystem, never reads the
 * sheet's content. Determines whether a Vault rename event corresponds to
 * a Markdown sheet moved to a DIFFERENT parent folder, and if so, computes
 * the old and new Images directories its own pasted images should follow
 * between.
 *
 * Returns `null` when:
 * - `newPath` does not currently resolve to a Markdown `TFile` (anything
 *   else — a folder, a non-Markdown file — is Lot 2's or nobody's concern);
 * - the file's parent folder did not actually change (a same-directory
 *   filename-only rename never moves images — the mirror is keyed on the
 *   PARENT folder, never the filename);
 * - no known project's manuscript root contains BOTH the old and the new
 *   parent folder (rejects a cross-project move, and moving content
 *   into/out of a project) — via the SAME most-specific-root selection as
 *   `resolveImageResourceFolderRename` (`selectOwningRoot`, above), so a
 *   single Vault event never triggers more than one project's mirror
 *   operation here either;
 * - the old or new parent folder is that root's Feuillets auxiliary folder
 *   (`_Feuillets/…`) itself or a descendant of it — a Markdown file under
 *   `_Feuillets` is never a content sheet for this feature, and the mirror
 *   move THIS feature itself performs (via `fileManager.renameFile` on the
 *   image, not the sheet) naturally never re-enters here either: it is not
 *   a Markdown file, so the very first check above already rejects it.
 *
 * Unlike a folder's own rename (`resolveImageResourceFolderRename`), the
 * parent folder legitimately CAN be the manuscript root itself (a sheet
 * living directly at the project root) — `selectOwningRoot` is called with
 * `isSameOrDescendantPath`, not `isStrictDescendantPath`. */
export function resolveImageResourceFileMove(
  app: App,
  contexts: readonly FeuilletsSettings[],
  oldPath: string,
  newPath: string
): ImageResourceFileMovePlan | null {
  if (!oldPath || !newPath || oldPath === newPath) return null;
  const file = app.vault.getAbstractFileByPath(newPath);
  if (!(file instanceof TFile) || file.extension !== "md") return null;

  const oldParent = parentPathOf(oldPath);
  const newParent = parentPathOf(newPath);
  if (oldParent === newParent) return null;

  const bestRoot = selectOwningRoot(app, contexts, oldParent, newParent, isSameOrDescendantPath);
  if (!bestRoot) return null;

  const imagesRoot = imagesFolderPath(app, bestRoot);
  const oldRelative = oldParent === bestRoot.path ? "" : oldParent.slice(bestRoot.path.length + 1);
  const newRelative = newParent === bestRoot.path ? "" : newParent.slice(bestRoot.path.length + 1);
  return {
    root: bestRoot,
    oldImageDirectory: oldRelative ? normalizePath(`${imagesRoot}/${oldRelative}`) : imagesRoot,
    newImageDirectory: newRelative ? normalizePath(`${imagesRoot}/${newRelative}`) : imagesRoot,
  };
}

/** Moves a single moved Markdown sheet's own eligible pasted images (see
 * this module's own doc comment) to follow it, after a Vault "rename"
 * event — called from main.ts's SAME centralized `vault.on("rename", …)`
 * handler as `syncImageResourceFolderAfterRename`, never a second listener.
 *
 * A no-op (nothing created, nothing moved) whenever
 * `resolveImageResourceFileMove` returns `null`, or when zero of the
 * sheet's referenced images turn out eligible: the destination Images
 * directory is created ONLY once at least one image is actually about to
 * move into it, never merely because the sheet moved.
 *
 * Uses `app.fileManager.renameFile` per image (never `vault.rename`), so
 * Obsidian performs its own normal link-maintenance for every backlink —
 * this function never rewrites a Markdown link itself, and an image
 * shared by another sheet is free to move with this one (the physical
 * location follows whichever sheet triggered the move; explicit shared-
 * asset ownership is a separate, later concern).
 *
 * Collisions are handled PER IMAGE: an exact destination collision logs one
 * `console.warn`, leaves that one image (and the destination) untouched,
 * and never prevents any OTHER eligible image from moving. The old mirror
 * directory is never deleted, even if this leaves it empty. */
export async function syncImageResourceFileAfterMove(
  app: App,
  contexts: readonly FeuilletsSettings[],
  oldPath: string,
  newPath: string
): Promise<void> {
  const plan = resolveImageResourceFileMove(app, contexts, oldPath, newPath);
  if (!plan) return;

  const file = app.vault.getAbstractFileByPath(newPath);
  if (!(file instanceof TFile)) return;

  const content = await app.vault.read(file);
  const images = eligibleImagesReferencedBy(app, content, newPath, oldPath, plan.oldImageDirectory);
  if (images.length === 0) return;

  await ensurePastedImageDirectory(app, plan.newImageDirectory);
  for (const image of images) {
    const destination = normalizePath(`${plan.newImageDirectory}/${image.name}`);
    if (app.vault.getAbstractFileByPath(destination)) {
      console.warn(
        "Feuillets image resource file move: destination already exists, leaving both untouched",
        image.path,
        destination
      );
      continue;
    }
    await app.fileManager.renameFile(image, destination);
  }
}
