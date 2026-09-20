import { TFolder } from "obsidian";
import type { App } from "obsidian";
import { uniqueFileName } from "./canvas-bridge.js";
import { isResearchExtension, researchAcceptedExtensions } from "./research.js";

/* Import of external files directly into a Research folder — never a new
 * "Resources" layer, never a move/delete of the source. Only browser-safe
 * APIs are used here (File.arrayBuffer, Vault.createBinary): no Node `fs`,
 * no Electron API, no FileSystemAdapter, no direct filesystem path. The
 * native `<input type="file">` picker and its DOM wiring live in
 * base-feuillets-view.ts; everything below is pure business logic, testable
 * without a DOM. */

/** Structural subset of the DOM `File` type this module actually needs —
 * lets tests pass a lightweight fake instead of a real browser File, while
 * a real File (which has both members) satisfies it without any cast. */
export type ImportableFile = {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ResearchImportSummary = {
  imported: number;
  skipped: number;
  failed: number;
};

/** Comma-separated `accept` attribute value for the native file picker
 * (e.g. ".md,.png,...") — built from the same extension list
 * isResearchExtension checks, so the picker's hint and the post-selection
 * validation can never drift apart. The `accept` attribute is only a hint
 * to the OS dialog; importFilesIntoResearchFolder below always re-validates
 * every selected file regardless of what the picker allowed through. */
export function researchImportAccept(): string {
  return researchAcceptedExtensions().map((extension) => `.${extension}`).join(",");
}

/** Replaces control characters (including NUL) with a hyphen — the one gap
 * left by the existing name-cleanup convention (safeFileName, services/
 * canvas-bridge.ts), which already strips `/`, `\`, and the other
 * filesystem-unsafe punctuation but never touches control characters. This
 * never interprets the name as a path: `/` and `\` are handled by
 * safeFileName as plain characters to replace, never as separators to
 * split on. */
function stripControlCharacters(name: string): string {
  let result = "";
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    result += code < 32 || code === 127 ? "-" : char;
  }
  return result;
}

/** Splits a (control-character-free) file name into a base name and an
 * extension, the same way Obsidian's own TFile.basename/extension split a
 * path segment: on the LAST dot. This is what lets a composite name like
 * "Dessin.excalidraw.md" collide into "Dessin.excalidraw 2.md" — still
 * recognized as an Excalidraw drawing (isExcalidrawMarkdownFile,
 * services/research.ts) — instead of some other split that would break
 * that recognition. A name with no dot (or starting with one, e.g. a
 * dotfile) has no extension: it is later rejected as unsupported, never
 * given a fabricated one. */
export function splitImportedFileName(name: string): { baseName: string; extension: string } {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return { baseName: name, extension: "" };
  return { baseName: name.slice(0, dotIndex), extension: name.slice(dotIndex + 1) };
}

/** Copies one selected external file into `destination`, never overwriting
 * an existing file: reuses uniqueFileName (services/canvas-bridge.ts) —
 * the exact "Name.ext", "Name 2.ext", "Name 3.ext" convention already used
 * for Research Canvas/Base creation — rather than a second, divergent
 * collision scheme. `uniqueFileName` internally sanitizes the base name via
 * safeFileName, so this function only needs to handle the one gap that
 * leaves open (control characters, see stripControlCharacters). Throws on
 * any failure; the caller decides how to tally that. */
async function copyOneFileIntoFolder(app: App, destination: TFolder, file: ImportableFile, baseName: string, extension: string): Promise<void> {
  const data = await file.arrayBuffer();
  const path = uniqueFileName(
    (candidate) => !!app.vault.getAbstractFileByPath(candidate),
    destination.path,
    baseName,
    extension
  );
  await app.vault.createBinary(path, data);
}

/** Imports `files` into `destination`, one at a time (never in parallel, so
 * at most one file's bytes are held in memory) and never overwriting an
 * existing file. Extensions the `accept` attribute could not enforce
 * (it is only a hint to the OS dialog) are re-validated here against
 * isResearchExtension and counted as skipped, never attempted. A read or
 * write failure on one file is counted as failed and never stops the loop:
 * every remaining file is still attempted, and every already-imported file
 * stays imported. Never opens an imported file, never touches plugin
 * settings, frontmatter, Binder ordering, a Resources folder, or the
 * source files themselves — it only ever calls File.arrayBuffer() (read)
 * and Vault.createBinary() (write). Refreshing Research views and
 * reporting the summary to the user are the caller's responsibility. */
export async function importFilesIntoResearchFolder(
  app: App,
  destination: TFolder,
  files: readonly ImportableFile[]
): Promise<ResearchImportSummary> {
  const summary: ResearchImportSummary = { imported: 0, skipped: 0, failed: 0 };
  for (const file of files) {
    const { baseName, extension } = splitImportedFileName(stripControlCharacters(file.name));
    if (!extension || !isResearchExtension(extension)) {
      summary.skipped++;
      continue;
    }
    try {
      await copyOneFileIntoFolder(app, destination, file, baseName, extension);
      summary.imported++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
