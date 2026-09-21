import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { stripFrontmatter } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { feuilletsAuxiliaryPath, getOrderedChildren, detectProjectStructureLocale } from "./folder-structure.js";
import { FALLBACK_LOCALE, t, type Locale } from "../i18n/index.js";
import { projectCreationNames, type ProjectCreationNames } from "../i18n/project-creation.js";

/** Every locale's draft stem, derived once from the project-creation
 * catalogue (src/i18n/project-creation.ts) — never a second hardcoded
 * name. Used only to RECOGNIZE a still-untouched quick draft regardless of
 * which locale created it (isDefaultQuickDraftName below); never to decide
 * what to create (see createQuickDraftFile, which receives an
 * already-resolved catalogue). */
const KNOWN_DRAFT_STEMS: readonly string[] = [
  projectCreationNames("fr").draftStem,
  projectCreationNames("en").draftStem,
];
const DEFAULT_MAX_STEM_LENGTH = 80;
type DraftTimer = number;

function clearDraftTimer(timer: DraftTimer): void {
  window.clearTimeout(timer);
}

function setDraftTimer(callback: () => void, delayMs: number): DraftTimer {
  return window.setTimeout(callback, delayMs);
}

export function draftsFolderPath(manuscriptRoot: TFolder): string {
  return feuilletsAuxiliaryPath(manuscriptRoot, "drafts");
}

export function getDraftsFolder(app: App, manuscriptRoot: TFolder | null | undefined): TFolder | null {
  if (!manuscriptRoot) return null;
  const folder = app.vault.getAbstractFileByPath(draftsFolderPath(manuscriptRoot));
  return folder instanceof TFolder ? folder : null;
}

export async function ensureDraftsFolder(app: App, manuscriptRoot: TFolder): Promise<TFolder> {
  const path = draftsFolderPath(manuscriptRoot);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) throw new Error(t("drafts.notice.occupiedByFile", { path }));
  const ensured = await ensureFolder(app, path);
  if (!(ensured instanceof TFolder)) throw new Error(t("drafts.notice.notAFolder", { path }));
  return ensured;
}

export function isProjectDraft(
  manuscriptRoot: TFolder | null | undefined,
  file: TFile | null | undefined
): boolean {
  if (!manuscriptRoot || !file || file.extension.toLowerCase() !== "md") return false;
  const draftsPath = normalizePath(draftsFolderPath(manuscriptRoot));
  const filePath = normalizePath(file.path);
  return filePath.startsWith(`${draftsPath}/`);
}

export function initialQuickDraftContent(): string {
  return "---\nstatus: Brouillon\n---\n\n";
}

export function firstDraftBodyLine(markdown: string): string | null {
  const body = stripFrontmatter(markdown);
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function sanitizeDraftFileStem(line: string, maxLength = DEFAULT_MAX_STEM_LENGTH): string | null {
  const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : DEFAULT_MAX_STEM_LENGTH;
  let stem = line.trim();
  stem = stem.replace(/^\s{0,3}#{1,6}\s*/, "");
  stem = stem.replace(/^\s*>\s*/, "");
  stem = stem.replace(/^\s*[-+*](?:\s+|$)/, "");
  stem = stem.replace(/^\s*\d+[.)](?:\s+|$)/, "");
  stem = stem.replace(/(\*\*|__|~~|`|\*|_)/g, "");
  stem = stem.replace(/[\\/:*?"<>|]/g, " ");
  stem = stem.replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!stem) return null;
  stem = stem.slice(0, limit).replace(/[. ]+$/g, "");
  return stem || null;
}

export function nextAvailableDraftPath(
  app: App,
  draftsFolder: TFolder,
  preferredStem?: string,
  ignoreFile?: TFile,
  names?: ProjectCreationNames,
  fallbackLocale?: Locale
): string {
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const resolvedNames = names ?? projectCreationNames(detectProjectStructureLocale(app, draftsFolder, fallback));
  const stem = sanitizeDraftFileStem(preferredStem || "") || resolvedNames.draftStem;
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const path = normalizePath(`${draftsFolder.path}/${stem}${suffix}.md`);
    const existing = app.vault.getAbstractFileByPath(path);
    if (!existing || existing === ignoreFile) return path;
    index += 1;
  }
}

export function nextAvailablePromotedDraftPath(app: App, destination: TFolder, file: TFile): string {
  let index = 2;
  while (true) {
    const path = normalizePath(`${destination.path}/${file.basename} ${index}.${file.extension}`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
    index += 1;
  }
}

/** Déplace un brouillon vers un dossier d'un projet quelconque (même projet
 * ou un autre) — opération dédiée à racine de destination EXPLICITE, jamais
 * `plugin.moveNode` (qui suppose toujours le projet ACTIF, source et
 * destination confondues). `destFolderPath` est résolu à nouveau ici, jamais
 * un `TFolder` capturé plus tôt par l'appelant (modale ouverte, dossier
 * supprimé entretemps) : une destination disparue renvoie `null` au lieu de
 * planter ou de créer un chemin fantôme.
 *
 * `app.fileManager.renameFile` seul déplace le fichier (préserve les liens
 * Obsidian) — AUCUN `processFrontMatter` : le frontmatter et le contenu du
 * brouillon restent identiques bit à bit, aucune propriété n'est jamais
 * adaptée au projet cible (ni `order`, ni `status`, ni quoi que ce soit
 * d'autre). Une collision de nom est résolue par
 * `nextAvailablePromotedDraftPath` (Titre 2.md, Titre 3.md…), jamais un
 * écrasement — divergence assumée avec `moveNode`, qui abandonne plutôt
 * l'opération sur collision hors promotion de brouillon.
 *
 * Le fichier déplacé est ajouté à LA FIN de `settings.orders` du dossier
 * cible (seule donnée touchée pour le positionner — jamais `fm.order` dans
 * le fichier lui-même) : le comparateur de tri de `getOrderedChildren`
 * consulte `settings.orders` en priorité, donc cela suffit à garantir sa
 * position sans toucher au frontmatter. */
export async function moveDraftToProjectFolder(
  app: App,
  settings: FeuilletsSettings,
  file: TFile,
  destFolderPath: string
): Promise<TFile | null> {
  const destFolder = app.vault.getAbstractFileByPath(normalizePath(destFolderPath));
  if (!(destFolder instanceof TFolder)) return null;
  if (!(file.parent instanceof TFolder)) return null;

  const straightPath = normalizePath(`${destFolder.path}/${file.name}`);
  const destPath = app.vault.getAbstractFileByPath(straightPath)
    ? nextAvailablePromotedDraftPath(app, destFolder, file)
    : straightPath;

  await app.fileManager.renameFile(file, destPath);
  const moved = app.vault.getAbstractFileByPath(destPath);
  if (!(moved instanceof TFile)) return null;

  const siblings = getOrderedChildren(app, settings, destFolder, false).filter(
    (child) => child.path !== moved.path
  );
  settings.orders[destFolder.path] = [...siblings.map((child) => child.name), moved.name];

  return moved;
}

export async function createQuickDraftFile(
  app: App,
  manuscriptRoot: TFolder,
  names?: ProjectCreationNames,
  fallbackLocale?: Locale
): Promise<TFile> {
  const fallback = fallbackLocale ?? FALLBACK_LOCALE;
  const resolvedNames = names ?? projectCreationNames(detectProjectStructureLocale(app, manuscriptRoot, fallback));
  const draftsFolder = await ensureDraftsFolder(app, manuscriptRoot);
  const path = nextAvailableDraftPath(app, draftsFolder, resolvedNames.draftStem, undefined, resolvedNames, fallback);
  return app.vault.create(path, initialQuickDraftContent());
}

const DEFAULT_QUICK_DRAFT_NAME_PATTERN = new RegExp(
  `^(?:${KNOWN_DRAFT_STEMS.map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?: \\d+)?$`
);

export function isDefaultQuickDraftName(file: TFile): boolean {
  if (file.extension.toLowerCase() !== "md") return false;
  return DEFAULT_QUICK_DRAFT_NAME_PATTERN.test(file.basename);
}

interface AutoRenameState {
  timer: DraftTimer | null;
  scheduledPath: string | null;
  expectedRename: { oldPath: string; targetPath: string } | null;
  trackedAutomatically: boolean;
}

export class ProjectDraftAutoRenamer {
  private readonly states = new Map<TFile, AutoRenameState>();
  private readonly manuallyStopped = new WeakSet<TFile>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly getProjectRoot: () => TFolder | null,
    private readonly delayMs = 900
  ) {}

  schedule(file: TFile): void {
    if (this.disposed || this.manuallyStopped.has(file)) return;
    const root = this.getProjectRoot();
    const state = this.states.get(file);
    if (!root || !isProjectDraft(root, file) || (!isDefaultQuickDraftName(file) && !state?.trackedAutomatically)) {
      if (state) this.clearState(file, state);
      return;
    }
    if (state?.timer !== null && state?.timer !== undefined) clearDraftTimer(state.timer);
    const nextState: AutoRenameState = state || {
      timer: null,
      scheduledPath: null,
      expectedRename: null,
      trackedAutomatically: false,
    };
    nextState.scheduledPath = file.path;
    const scheduledPath = file.path;
    nextState.timer = setDraftTimer(() => {
      void this.process(file, scheduledPath, nextState);
    }, this.delayMs);
    this.states.set(file, nextState);
  }

  handleRename(file: TFile, oldPath: string): void {
    const state = this.states.get(file);
    if (!state) {
      this.manuallyStopped.add(file);
      return;
    }
    const expected = state.expectedRename;
    if (expected && expected.oldPath === oldPath && expected.targetPath === file.path) {
      state.expectedRename = null;
      state.scheduledPath = file.path;
      return;
    }
    this.manuallyStopped.add(file);
    this.clearState(file, state);
  }

  cancel(file: TFile): void {
    const state = this.states.get(file);
    if (state) this.clearState(file, state);
  }

  dispose(): void {
    this.disposed = true;
    for (const [file, state] of this.states) this.clearState(file, state);
    this.states.clear();
  }

  private clearState(file: TFile, state: AutoRenameState): void {
    if (state.timer !== null) clearDraftTimer(state.timer);
    this.states.delete(file);
  }

  private async process(file: TFile, scheduledPath: string, state: AutoRenameState): Promise<void> {
    state.timer = null;
    if (this.disposed || this.states.get(file) !== state || state.scheduledPath !== scheduledPath) return;
    const root = this.getProjectRoot();
    const current = this.app.vault.getAbstractFileByPath(file.path);
    if (!root || current !== file || file.path !== scheduledPath || !isProjectDraft(root, file)) {
      this.clearState(file, state);
      return;
    }
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return;
    }
    if (this.disposed || this.states.get(file) !== state || state.scheduledPath !== scheduledPath) return;
    const line = firstDraftBodyLine(content);
    const stem = line ? sanitizeDraftFileStem(line) : null;
    if (!stem) return;
    const draftsFolder = getDraftsFolder(this.app, root);
    if (!draftsFolder) return;
    const targetPath = nextAvailableDraftPath(this.app, draftsFolder, stem, file);
    if (targetPath === file.path) return;
    const latestRoot = this.getProjectRoot();
    const latest = this.app.vault.getAbstractFileByPath(file.path);
    if (
      this.disposed ||
      this.states.get(file) !== state ||
      !latestRoot ||
      latest !== file ||
      !isProjectDraft(latestRoot, file)
    ) return;
    state.expectedRename = { oldPath: file.path, targetPath };
    try {
      await this.app.fileManager.renameFile(file, targetPath);
      state.trackedAutomatically = true;
      state.scheduledPath = targetPath;
    } catch {
      state.expectedRename = null;
    }
  }
}
