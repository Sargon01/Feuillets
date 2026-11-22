import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { feuilletsAuxiliaryRootPath } from "./folder-structure.js";
import { ensureFolderPath } from "./native-review-session.js";
import { hashReviewText } from "./native-review-package.js";

export const AUTOMATIC_HISTORY_FOLDER = "RewriteHistory";
export function rewriteHistoryPath(root: TFolder): string {
  return normalizePath(`${feuilletsAuxiliaryRootPath(root)}/${AUTOMATIC_HISTORY_FOLDER}`);
}
/** Match only our reserved namespace, including linked Research exports. */
export function isRewriteHistoryPath(path: string): boolean {
  return /(?:^|\/)_Feuillets\/RewriteHistory(?:\/|$)/.test(path);
}
export type RewriteOrigin = "markdown-editor" | "continu" | "external-or-other";
export interface RewriteSheet { id: string; path: string; ctime: number; deleted: boolean }
export interface RewriteIndex { version: 1; projectId: string; sheets: RewriteSheet[] }
export interface RewriteEntry {
  version: 1;
  id: string;
  sheetId: string;
  projectId: string;
  path: string;
  startedAt: number;
  endedAt: number;
  initialWords: number;
  finalWords: number;
  delta: number;
  before: string;
  after?: string;
  origins: RewriteOrigin[];
  status: "pending" | "complete" | "unchanged";
  /** Coalesced recovery checkpoint; removed once the final Markdown exists. */
  checkpoint?: string;
  recovered?: boolean;
}
const idPattern = /^[a-zA-Z0-9-]+$/;
const hashPattern = /^[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validIndex(value: unknown): value is RewriteIndex {
  return record(value) && value.version === 1 && typeof value.projectId === "string" && idPattern.test(value.projectId)
    && Array.isArray(value.sheets) && value.sheets.every((sheet: unknown) => record(sheet)
      && typeof sheet.id === "string" && idPattern.test(sheet.id) && typeof sheet.path === "string"
      && typeof sheet.ctime === "number" && typeof sheet.deleted === "boolean");
}
function validEntry(value: unknown): value is RewriteEntry {
  return record(value) && value.version === 1
    && [value.id, value.sheetId, value.projectId].every((id) => typeof id === "string" && idPattern.test(id))
    && typeof value.path === "string" && typeof value.before === "string" && hashPattern.test(value.before)
    && (value.after === undefined || (typeof value.after === "string" && hashPattern.test(value.after)))
    && [value.startedAt, value.endedAt, value.initialWords, value.finalWords, value.delta].every((n) => typeof n === "number" && Number.isFinite(n))
    && Array.isArray(value.origins) && value.origins.every((origin: unknown) => origin === "markdown-editor" || origin === "continu" || origin === "external-or-other")
    && ["pending", "complete", "unchanged"].includes(String(value.status))
    && (value.checkpoint === undefined || typeof value.checkpoint === "string");
}

/** Serialised by RewriteHistory. Vault.process rejects stale local writes;
 * malformed or externally changed JSON is never silently replaced. */
export class RewriteHistoryStore {
  private readonly known = new Map<string, string>();
  private readonly anchor: TFolder | null;
  constructor(readonly app: App, readonly root: TFolder) {
    const auxiliary = feuilletsAuxiliaryRootPath(root);
    const anchor = app.vault.getAbstractFileByPath(auxiliary.slice(0, auxiliary.lastIndexOf("/")));
    this.anchor = anchor instanceof TFolder ? anchor : null;
  }
  private assertAnchor(): void {
    if (!this.anchor || this.app.vault.getAbstractFileByPath(this.anchor.path) !== this.anchor) throw new Error("History project was removed or replaced");
  }
  get path(): string { return rewriteHistoryPath(this.root); }
  private async readJson(path: string): Promise<unknown> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return undefined;
    if (!(file instanceof TFile)) throw new Error("History path is not a file");
    const text = await this.app.vault.read(file);
    const parsed: unknown = JSON.parse(text);
    this.known.set(path, text);
    return parsed;
  }
  private async writeJson(path: string, value: unknown): Promise<void> {
    this.assertAnchor();
    const text = JSON.stringify(value, null, 2);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const expected = this.known.get(path);
      if (expected === undefined) throw new Error("Unobserved history file");
      await this.app.vault.process(file, (current) => {
        if (current !== expected) throw new Error("Concurrent history modification");
        return text;
      });
    } else {
      if (this.known.has(path)) throw new Error("History file disappeared");
      await ensureFolderPath(this.app, path.slice(0, path.lastIndexOf("/")));
      await this.app.vault.create(path, text);
    }
    this.known.set(path, text);
  }
  remapKnownPaths(oldPath: string, newPath: string): void {
    for (const [path, text] of [...this.known]) {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
      this.known.delete(path); this.known.set(newPath + path.slice(oldPath.length), text);
    }
  }
  async loadIndex(): Promise<RewriteIndex> {
    const value = await this.readJson(`${this.path}/index.json`);
    if (value === undefined) return { version: 1, projectId: crypto.randomUUID(), sheets: [] };
    if (!validIndex(value)) throw new Error("Invalid history index");
    if (new Set(value.sheets.map((sheet) => sheet.id)).size !== value.sheets.length) throw new Error("Duplicate history identity");
    return value;
  }
  async saveIndex(index: RewriteIndex): Promise<void> { await this.writeJson(`${this.path}/index.json`, index); }
  async entries(): Promise<RewriteEntry[]> {
    const folder = this.app.vault.getAbstractFileByPath(`${this.path}/events`);
    if (!folder) return [];
    if (!(folder instanceof TFolder)) throw new Error("Invalid history events folder");
    const result: RewriteEntry[] = [];
    for (const file of folder.children) {
      if (!(file instanceof TFile) || file.extension !== "json") continue;
      const value = await this.readJson(file.path);
      if (!validEntry(value) || file.name !== `${value.id}.json`) throw new Error("Invalid history entry");
      result.push(value);
    }
    return result;
  }
  async saveEntry(entry: RewriteEntry): Promise<void> {
    if (!validEntry(entry)) throw new Error("Invalid history entry");
    await this.writeJson(`${this.path}/events/${entry.id}.json`, entry);
  }
  statePath(hash: string): string {
    if (!hashPattern.test(hash)) throw new Error("Invalid history state reference");
    return `${this.path}/states/${hash}.md`;
  }
  async state(hash: string): Promise<TFile> {
    const file = this.app.vault.getAbstractFileByPath(this.statePath(hash));
    if (!(file instanceof TFile)) throw new Error("History state missing");
    const text = await this.app.vault.read(file);
    if ((await hashReviewText(text)).slice(7) !== hash) throw new Error("History state changed");
    return file;
  }
  async retain(text: string): Promise<string> {
    this.assertAnchor();
    const hash = (await hashReviewText(text)).slice(7);
    const path = this.statePath(hash);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile) || await this.app.vault.read(existing) !== text) throw new Error("History state conflict");
    } else {
      await ensureFolderPath(this.app, `${this.path}/states`);
      await this.app.vault.create(path, text);
    }
    return hash;
  }
}
