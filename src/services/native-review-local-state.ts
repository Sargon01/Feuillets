import { TFile } from "obsidian";
import type { App } from "obsidian";
import { reviewSessionPaths, type NativeReviewStorageLocation } from "./native-review-storage.js";

export interface NativeReviewLocalState { version: 1; archivedAt?: string; }
export async function loadNativeReviewLocalState(app: App, location: NativeReviewStorageLocation, reviewId: string): Promise<NativeReviewLocalState> {
  const file = app.vault.getAbstractFileByPath(reviewSessionPaths(location, reviewId).localStateFile);
  if (!file) return { version: 1 };
  if (!(file instanceof TFile)) throw new Error("local-state.json invalide");
  let state: unknown; try { state = JSON.parse(await app.vault.read(file)); } catch { throw new Error("local-state.json corrompu"); }
  if (!state || typeof state !== "object" || (state as { version?: unknown }).version !== 1 || ((state as { archivedAt?: unknown }).archivedAt !== undefined && typeof (state as { archivedAt?: unknown }).archivedAt !== "string")) throw new Error("local-state.json invalide");
  return state as NativeReviewLocalState;
}
export async function setNativeReviewArchived(app: App, location: NativeReviewStorageLocation, reviewId: string, archived: boolean): Promise<NativeReviewLocalState> {
  const state: NativeReviewLocalState = { version: 1, ...(archived ? { archivedAt: new Date().toISOString() } : {}) };
  const path = reviewSessionPaths(location, reviewId).localStateFile; const file = app.vault.getAbstractFileByPath(path); const text = JSON.stringify(state, null, 2);
  if (file instanceof TFile) await app.vault.modify(file, text); else if (!file) await app.vault.create(path, text); else throw new Error("local-state.json invalide");
  return state;
}
