import { TFile, normalizePath, type App, type TFolder } from "obsidian";

export type FootnoteRow =
  | { kind: "definition"; label: string; text: string; citedElsewhere: boolean }
  | { kind: "reference-without-definition"; label: string };

const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\](?!:)/g;

/** One row per footnote definition (regardless of whether it is ever cited)
 * plus one row per reference with no matching definition — exactly the set
 * of rows the overview renders, so `rows.length` alone is the row count a
 * caller needs for a group counter. A reference whose definition exists
 * never produces a second row. */
export function extractFootnoteRows(rawContent: string): FootnoteRow[] {
  const text = rawContent.replace(/^---\n[\s\S]*?\n---\n?/, "");

  const defs = new Map<string, string>();
  FOOTNOTE_DEF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FOOTNOTE_DEF_RE.exec(text))) defs.set(m[1], m[2].trim());

  const refs = new Set<string>();
  FOOTNOTE_REF_RE.lastIndex = 0;
  while ((m = FOOTNOTE_REF_RE.exec(text))) refs.add(m[1]);

  const rows: FootnoteRow[] = [];
  for (const [label, footnoteText] of defs) {
    rows.push({ kind: "definition", label, text: footnoteText, citedElsewhere: refs.has(label) });
  }
  for (const label of refs) {
    if (defs.has(label)) continue;
    rows.push({ kind: "reference-without-definition", label });
  }
  return rows;
}

export type FootnoteFileEntry = {
  file: TFile;
  rows: FootnoteRow[];
};

const FOOTNOTE_GROUP_KEY_PREFIX = "research:footnotes-group:";
const ROOT_FILES_SEGMENT = "::root-files::";

/** Namespaced settings.collapsed key for a footnote group — deliberately
 * never equal to a raw vault path, so it can never collide with a Binder
 * folder's own collapse key (which IS its raw TFolder.path elsewhere in
 * this file, e.g. renderSection()'s collapseKey). `relativeFolderPath` is
 * relative to projectRoot, using "/" separators; null selects the
 * root-files group. Both the project root and the relative path are
 * percent-encoded, so a literal ":" in either can never be mistaken for
 * this function's own ":" separators, and two different projects or
 * branches always produce distinct keys. */
export function footnoteGroupCollapseKey(projectRootPath: string, relativeFolderPath: string | null): string {
  const encodedRoot = encodeURIComponent(normalizePath(projectRootPath));
  const encodedRelative = relativeFolderPath === null
    ? ROOT_FILES_SEGMENT
    : encodeURIComponent(relativeFolderPath);
  return `${FOOTNOTE_GROUP_KEY_PREFIX}${encodedRoot}:${encodedRelative}`;
}

export type FootnoteFolderNode = {
  /** The real vault folder path this node represents — for the synthetic
   * root-files node, this is projectRoot's own path. Identity/debugging
   * only: never used as a settings.collapsed key (see collapseKey). */
  folderPath: string;
  /** True only for the synthetic node holding files directly at
   * projectRoot — the caller resolves its localized "root files" label. */
  isRootFiles: boolean;
  /** The real folder name, or null for the root-files node. */
  label: string | null;
  collapseKey: string;
  /** Files directly inside this folder (not in any subfolder). */
  directEntries: FootnoteFileEntry[];
  /** Subfolders with footnote content somewhere in their own subtree, in
   * the order their first file was encountered — never alphabetical. */
  children: FootnoteFolderNode[];
  /** Recursive total: this node's own directEntries rows plus every
   * descendant's rowCount. */
  rowCount: number;
};

type Bucket = {
  relativePath: string;
  name: string;
  directEntries: FootnoteFileEntry[];
  childOrder: string[];
};

const ROOT_BUCKET_KEY = "";
/** A NUL-prefixed sentinel: no real vault path segment can ever contain a
 * NUL character, so this can never collide with a real relativePath. */
const ROOT_FILES_BUCKET_KEY = "\0root-files";

async function readContent(app: App, file: TFile): Promise<string> {
  return typeof app.vault.cachedRead === "function"
    ? await app.vault.cachedRead(file)
    : await app.vault.read(file);
}

function ensureBucket(buckets: Map<string, Bucket>, key: string, name: string, parentKey: string | null): Bucket {
  const existing = buckets.get(key);
  if (existing) return existing;
  const bucket: Bucket = { relativePath: key, name, directEntries: [], childOrder: [] };
  buckets.set(key, bucket);
  if (parentKey !== null) buckets.get(parentKey)!.childOrder.push(key);
  return bucket;
}

function finalizeNode(buckets: Map<string, Bucket>, key: string, projectRootPath: string): FootnoteFolderNode {
  const bucket = buckets.get(key)!;
  const isRootFiles = key === ROOT_FILES_BUCKET_KEY;
  const children = bucket.childOrder.map((childKey) => finalizeNode(buckets, childKey, projectRootPath));
  const ownRowCount = bucket.directEntries.reduce((sum, entry) => sum + entry.rows.length, 0);
  const rowCount = ownRowCount + children.reduce((sum, child) => sum + child.rowCount, 0);
  return {
    folderPath: isRootFiles ? normalizePath(projectRootPath) : normalizePath(`${projectRootPath}/${bucket.relativePath}`),
    isRootFiles,
    label: isRootFiles ? null : bucket.name,
    collapseKey: footnoteGroupCollapseKey(projectRootPath, isRootFiles ? null : bucket.relativePath),
    directEntries: bucket.directEntries,
    children,
    rowCount,
  };
}

/** Builds the full folder hierarchy under `projectRoot` for Project mode's
 * compact summary — one node per real subfolder that has footnote content
 * anywhere in its own subtree, nested exactly as the vault nests them
 * (never flattened to a single top-level segment), plus a synthetic
 * root-files node for files directly at `projectRoot`. Each eligible file
 * is read from the vault exactly once; a file with zero rows never creates
 * or grows any node, so an empty folder — or a folder whose only content is
 * a non-Markdown attachment, already excluded from `files` by the caller —
 * never appears at all. Node order, at every depth, follows the order
 * `files` are first encountered in, never a separate alphabetical sort. */
export async function buildFootnoteOverviewTree(
  app: App,
  projectRoot: TFolder,
  files: readonly TFile[],
): Promise<FootnoteFolderNode[]> {
  const rootPath = normalizePath(projectRoot.path);
  const buckets = new Map<string, Bucket>();
  ensureBucket(buckets, ROOT_BUCKET_KEY, "", null);

  for (const file of files) {
    const rows = extractFootnoteRows(await readContent(app, file));
    if (rows.length === 0) continue;

    const normalizedFile = normalizePath(file.path);
    const prefix = `${rootPath}/`;
    if (!normalizedFile.startsWith(prefix)) continue;
    const relativeToRoot = normalizedFile.slice(prefix.length);
    const segments = relativeToRoot.split("/");
    const folderSegments = segments.slice(0, -1);

    if (folderSegments.length === 0) {
      const rootFilesBucket = ensureBucket(buckets, ROOT_FILES_BUCKET_KEY, "", ROOT_BUCKET_KEY);
      rootFilesBucket.directEntries.push({ file, rows });
      continue;
    }

    let parentKey = ROOT_BUCKET_KEY;
    let currentKey = "";
    for (const segment of folderSegments) {
      currentKey = currentKey ? `${currentKey}/${segment}` : segment;
      ensureBucket(buckets, currentKey, segment, parentKey);
      parentKey = currentKey;
    }
    buckets.get(currentKey)!.directEntries.push({ file, rows });
  }

  return buckets.get(ROOT_BUCKET_KEY)!.childOrder.map((key) => finalizeNode(buckets, key, rootPath));
}

/** Workspace mode's flat, un-grouped listing: each eligible file read
 * exactly once, in the given order, skipping files with no footnote
 * content — no folder hierarchy is built at all. */
export async function buildFootnoteFileEntries(
  app: App,
  files: readonly TFile[],
): Promise<FootnoteFileEntry[]> {
  const entries: FootnoteFileEntry[] = [];
  for (const file of files) {
    const rows = extractFootnoteRows(await readContent(app, file));
    if (rows.length === 0) continue;
    entries.push({ file, rows });
  }
  return entries;
}
