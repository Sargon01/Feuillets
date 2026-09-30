import { VIEW_SIDEBAR, VIEW_SCRIVENINGS, BOARD_MODES } from "../constants.js";
import { hasKnownProject } from "../services/folder-structure.js";
import { headingOutlineForFile, headingOutlineInputsForFile } from "../services/heading-outline-cache.js";
import { headingsMatchText } from "../services/heading-outline-text-validation.js";
import { headingTrailAtOffset } from "../services/heading-position.js";
import type { HeadingOutlineInput, HeadingOutlineNode } from "../services/heading-outline.js";
import type { EditorCursorChange, EditorCursorListener } from "../services/editor-cursor-tracking.js";
import { shiftHeadingSubtree, type HeadingSubtreeShiftDirection } from "../services/heading-subtree-shift.js";
import { moveHeadingSection, type HeadingSectionPlacement } from "../services/heading-section-move.js";
import { foldAccents, stripMarkdown } from "../utils/core.js";
import { highlightActive, isEditing, getActiveFileSafe, openFileActivating, openFileAndSelectRange } from "../utils/dom.js";
import { ImportOutlineModal } from "../ui/import-outline-modal.js";
import { NewProjectModal, OpenExistingFolderModal, DuplicateVersionModal, ManageProjectsModal } from "../ui/project-modals.js";
import { FolderWorkspaceModal } from "../ui/folder-workspace-modal.js";
import { NumberingModal } from "../ui/numbering-modal.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { CompareFilesModal, PickFileModal } from "../ui/diff-modal.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import type { BoardModeKey } from "./board-view.js";
import { t, getLocale } from "../i18n/index.js";
import {
  normalizeFilterSentinel,
  statusStoredValue,
  statusDisplayLabel,
  labelStoredValue,
  labelDisplayLabel,
} from "../services/project-taxonomy.js";
import { openScopeInContinu, openScopeInContinuOnLeaf } from "./scrivenings-view.js";
import { createProjectScope, createFileScope, createFolderScope, createSelectionScope, resolveCompileScopeFiles, type CompileScope } from "../services/compile-scope.js";
import { getDraftsFolder, isProjectDraft } from "../services/project-drafts.js";
import { Menu, MarkdownView, TFile, TFolder, setIcon, setTooltip, Notice, normalizePath, type TAbstractFile, type WorkspaceLeaf, type EventRef } from "obsidian";
import { toValue } from "../utils/scene-fields.js";
import { folderPathToWorkspaceScope } from "../services/folder-workspaces.js";
import { workspaceLabels, workspaceStatuses } from "../services/folder-workspaces.js";
import {
  binderPreviewFieldChoices,
  binderPreviewSemanticField,
  clampBinderPreviewLines,
  resolveBinderPreviewField,
} from "../utils/binder-preview.js";
import { RESEARCH_FOLDERS, translatedResearchFolderName } from "../utils/project-modes.js";
import { isResearchAttachment, isResearchFile, researchFileIcon } from "../services/research.js";

type ProjectNode = TFile | TFolder;

/** Contrat minimal exposé par une `ScriveningsView` réellement exploitable
 * comme sélecteur de membership Binder (voir activeContinuMembershipView
 * ci-dessous) — garde de type sans `instanceof`, même patron que
 * `isOpenScopeView` (scrivenings-view.ts) : reconnaît la vue par sa surface
 * publique, ce qui permet des tests avec un faux objet sans monter un vrai
 * CodeMirror ni importer la classe réelle. */
type ContinuMembershipView = {
  compileScope: CompileScope | null;
  getViewType(): string;
  getMemberPaths(): readonly string[];
  hasMember(path: string): boolean;
  toggleMember(path: string): Promise<boolean>;
  collapseToSingleMember(path: string): Promise<boolean>;
  /** Ajout en lot (Maj+clic en Continu, micro-correctif "typographie après
   * toggle + Maj+clic en Continu", §6) — voir ScriveningsView.addMembers.
   * Conservée pour compatibilité ascendante ; le LOT FINAL Binder ↔ Continu
   * (§7) n'en fait plus usage depuis le Binder, voir `setMembers`. */
  addMembers(paths: readonly string[]): Promise<boolean>;
  /** LOT FINAL Binder ↔ Continu, §6 : remplace la composition affichée par
   * exactement ces chemins (Maj+clic §7, Cmd/Ctrl+clic §8) — voir
   * ScriveningsView.setMembers. */
  setMembers(paths: readonly string[]): Promise<boolean>;
  /** LOT FINAL, §4 : ouvre `path` seul, MÊME leaf — chemin unique du clic
   * simple sur un fichier pendant que Continu est actif (§3). */
  openSingleMember(path: string): Promise<boolean>;
  /** Recharge cette MÊME leaf Continu sur un autre scope (dossier, §11) —
   * voir ScriveningsView.openScope. */
  openScope(scope: CompileScope): Promise<boolean>;
};

function isContinuMembershipView(view: unknown): view is ContinuMembershipView {
  return (
    typeof view === "object" &&
    view !== null &&
    "compileScope" in view &&
    "getViewType" in view &&
    typeof view.getViewType === "function" &&
    "getMemberPaths" in view &&
    typeof view.getMemberPaths === "function" &&
    "hasMember" in view &&
    typeof view.hasMember === "function" &&
    "toggleMember" in view &&
    typeof view.toggleMember === "function" &&
    "collapseToSingleMember" in view &&
    typeof view.collapseToSingleMember === "function" &&
    "addMembers" in view &&
    typeof view.addMembers === "function" &&
    "setMembers" in view &&
    typeof view.setMembers === "function" &&
    "openSingleMember" in view &&
    typeof view.openSingleMember === "function" &&
    "openScope" in view &&
    typeof view.openScope === "function"
  );
}

/** Narrowing sans cast direct pour obsidianmd/no-tfile-tfolder-cast — voir
 * base-feuillets-view.ts pour le même patron. Le throw n'est jamais atteint
 * ici : `selected` est toujours ramené à un TFolder avant cet appel. */
function asFolder(af: TAbstractFile | null): TFolder {
  if (!(af instanceof TFolder)) throw new Error(`Expected a folder: ${af ? af.path : "null"}`);
  return af;
}

/** Which workspace event triggered updateActiveHighlight() — see that
 * method: only "active-leaf-change" is checked against an already-active
 * row (GitHub #17, a late event fired once a heading navigation settles). */
type ActiveHighlightReason = "active-leaf-change" | "file-open" | "render-end";

/** GitHub #17 follow-up: private MIME for heading-to-heading drag — never
 * `FEUILLETS_FILE_DRAG_MIME`, never `text/plain`, so a heading drag can
 * never be picked up by the physical TFile/TFolder drag system
 * (attachDragHandlers, base-feuillets-view.ts) or Canvas. The truth of an
 * in-progress heading drag is `FeuilletsView._headingDragState`, never
 * this MIME payload — it only exists to make the native HTML5 drag start. */
const HEADING_DRAG_MIME = "application/x-feuillets-heading";
const HEADING_HORIZONTAL_DRAG_THRESHOLD = 24;

/** Session-only state of an in-progress heading drag — see
 * FeuilletsView._headingDragState. Never persisted, never shared with
 * `plugin.dragState`/`_binderMultiSelect`/`_visibleHeadingOutlinePaths`. */
type HeadingDragState = {
  filePath: string;
  sourceStartOffset: number;
  level: number;
  text: string;
  startClientX: number;
  containsLevelSix: boolean;
  horizontalMode: "move" | HeadingSubtreeShiftDirection | "invalid";
  row: HTMLElement;
};

type CollapsedHeadingSnapshot = {
  keys: string[];
  texts: string[];
  collapsedOrdinals: number[];
};

type RenderFileRowOpts = { showPreview?: boolean; revealProjectDraft?: boolean };
type RenderFileRow = (
  host: HTMLElement,
  file: TFile,
  parent: ProjectNode,
  i: number,
  siblings: ProjectNode[],
  depth: number,
  dragScopeEl: HTMLElement,
  opts?: RenderFileRowOpts
) => boolean;

type SplitBodyCtx = {
  S: FeuilletsSettings;
  binderFilterActive: boolean;
  folderHasMatch: (f: TFolder) => boolean;
  renderFileRow: RenderFileRow;
  /** Vraie racine du projet, distincte de `root` (la racine de travail
   * passée à renderHierarchyBody) dès qu'un dossier est isolé — voir le
   * scope partagé. Sert à l'en-tête d'isolation et au menu contextuel de la
   * ligne racine. */
  projectRoot: TFolder;
  /** Densité EFFECTIVE déjà résolue par render() (override de session du
   * dossier isolé, sinon settings.binderCompact) — voir
   * FeuilletsView.getEffectiveBinderCompact. Ne JAMAIS relire
   * S.binderCompact directement ici pour cette décision. */
  binderCompact: boolean;
  /** Dossier Drafts canonique révélé dans une projection Binder, jamais une
   * racine de compilation ou de statistiques. */
  revealDraftsFolder?: TFolder | null;
  /** Folder path -> total word count of its descendant sheets, precomputed
   * once per render from `wcCache` (see render()) — the single source a
   * folder row's progress bar reads from, never a second async word count. */
  folderWordTotals: Map<string, number>;
};

/* _binderMultiSelect est attaché dynamiquement au plugin par
   base-feuillets-view.js (this.plugin._binderMultiSelect = new Set()) —
   absent de la classe FeuilletsPlugin elle-même (main.js), donc pas
   inférable depuis son propre type. */
type FeuilletsViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  _binderMultiSelect?: Set<string>;
  registerEditorCursorListener?: (listener: EditorCursorListener) => () => void;
};

function buildHeadingSemanticKeys<T extends Pick<HeadingOutlineInput, "level" | "text">>(
  file: TFile,
  headings: readonly T[]
): Map<T, string> {
  const keys = new Map<T, string>();
  const occurrences = new Map<string, number>();
  for (const heading of headings) {
    const base = `${file.path}\u0000${heading.level}\u0000${heading.text}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    keys.set(heading, `${base}\u0000${occurrence}`);
  }
  return keys;
}

/* app.setting (panneau de réglages) est une API interne d'Obsidian, non
   déclarée dans obsidian.d.ts. */
type AppWithSettingTab = {
  setting: { open(): void; openTabById(id: string): void };
};

export class FeuilletsView extends BaseFeuilletsView {
  declare plugin: FeuilletsViewPlugin;
  declare targetContainer?: HTMLElement;
  declare iconBtn: (
    parent: HTMLElement,
    icon: string,
    tooltip?: string,
    onClick?: (e: MouseEvent) => void | Promise<void>
  ) => HTMLElement;
  _renderGen?: number;
  _binderSearchOpen?: boolean;
  _suppressSearchBlurClose?: boolean;
  /** Densité (compact/standard) propre à une racine de travail isolée,
   * pour la durée de la SESSION uniquement — jamais dans settings, jamais
   * de nouvelle clé DEFAULT_SETTINGS, jamais de système de workspace par
   * dossier. Indexée par chemin de dossier isolé ; un dossier sans entrée
   * ici suit `settings.binderCompact` (voir getEffectiveBinderCompact). */
  _binderCompactOverrides?: Map<string, boolean>;
  /** Which files currently show their Markdown heading structure (GitHub
   * #17), toggled from each file's own context menu — session runtime state
   * only, keyed by `file.path`: never in FeuilletsSettings, never in
   * ProjectMeta, never persisted. Empty by default, so every file's
   * structure starts hidden on a fresh view/session. Cleared naturally when
   * this view instance is destroyed. */
  private _visibleHeadingOutlinePaths = new Set<string>();
  /** Depth counter, not a boolean, so two overlapping heading navigations
   * (a fast double-click landing on two different rows before the first
   * one settles) each keep the Binder's scroll suppressed until BOTH have
   * finished — never reset to "normal" while one is still in flight. Purely
   * transient: never persisted, never causes a render, unrelated to
   * `_visibleHeadingOutlinePaths`. See navigateToHeading() and
   * updateActiveHighlight(): while this is above 0, `file-open`/
   * `active-leaf-change` still mark the parent file `.is-active`, but must
   * never scroll the Binder — the click already scrolled the EDITOR to the
   * right place, and the file row clicked from a heading is typically
   * already visible. */
  private _headingNavigationDepth = 0;
  /** The heading currently being dragged, or `null` — entirely private to
   * heading-to-heading section reordering, never `plugin.dragState`, never
   * `_binderMultiSelect`, never linked to `_visibleHeadingOutlinePaths`.
   * The physical TFile/TFolder drag system (attachDragHandlers,
   * base-feuillets-view.ts) neither reads nor writes this. */
  private _headingDragState: HeadingDragState | null = null;
  /** Which headings are currently collapsed (their descendants hidden) in
   * the Binder's outline — session-only runtime state, never
   * FeuilletsSettings, never ProjectMeta, never YAML/frontmatter, never
   * `settings.collapsed` (that map is physical folders only). Empty by
   * default, so every heading starts expanded. Keyed by a semantic key built
   * from `file.path` + level + text + occurrence (buildHeadingCollapseKeys)
   * — deliberately NEVER `startOffset`, because heading-to-heading drag &
   * drop and any ordinary edit shift offsets on every mutation; a collapsed
   * heading must stay collapsed across a move or a MetadataCache refresh. */
  private _collapsedHeadingKeys = new Set<string>();

  /** Racine à afficher dans le Binder : le scope partagé s'il existe encore
   * et appartient toujours au projet actif, sinon la racine réelle du
   * projet. */
  getBinderWorkingRoot(projectRoot: TFolder | null): TFolder | null {
    if (!projectRoot) return null;
    const sharedFolder =
      typeof this.plugin.getWorkspaceFolder === "function"
        ? this.plugin.getWorkspaceFolder()
        : this.plugin.workspaceFolderPath
          ? this.app.vault.getAbstractFileByPath(this.plugin.workspaceFolderPath)
          : null;
    const resolvedSharedFolder = sharedFolder instanceof TFolder ? sharedFolder : null;
    if (!resolvedSharedFolder && typeof this.plugin.getWorkspaceFolder !== "function") {
      this.plugin.workspaceFolderPath = undefined;
    }
    return resolvedSharedFolder || projectRoot;
  }

  /** Mécanisme d'isolation UNIQUE (chantier "isoler un dossier" +
   * micro-chantier "double-clic pour isoler") : bascule
   * scope partagé et redemande un rendu. Appelé aussi bien par le
   * menu contextuel (binderIsolateExtras) que par le double-clic sur le nom
   * d'un dossier (renderTreeFolders) — jamais dupliqué. Ne déplace, ne
   * renomme, ne modifie aucun fichier. `resetScroll: true` : on entre dans
   * une branche différente, la position de défilement de l'ancienne vue n'a
   * plus de sens ici — la nouvelle racine s'affiche depuis son début plutôt
   * que de conserver un décalage de pixels devenu arbitraire (voir render,
   * _resetScroll). */
  isolateFolder(folder: TFolder): void {
    if (typeof this.plugin.setWorkspaceFolder === "function") this.plugin.setWorkspaceFolder(folder);
    else this.plugin.workspaceFolderPath = folder.path;
    void this.render(true, { resetScroll: true });
  }

  /** Entrée « Isoler ce dossier » ajoutée au menu contextuel standard d'un
   * dossier (showFolderContextMenu, extraItems) — jamais un second menu. */
  binderIsolateExtras(folder: TFolder): (menu: Menu) => void {
    return (menu: Menu) => {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.isolateFolder"))
          .setIcon("focus")
          .onClick(() => this.isolateFolder(folder))
      );
    };
  }

  /** GitHub #17: "Show/Hide file structure", added to the Binder's own file
   * context menu (showFileContextMenu, `extraItems`) — never a second menu,
   * and never leaking into Board or any other surface that shares the same
   * base method (they simply never pass this callback). `headingOutlineForFile()`
   * is called once, right when the menu opens, purely to decide whether the
   * action should appear at all: a file with no heading gets no entry, and
   * the menu stays exactly as before. Toggling only flips this SESSION-ONLY
   * runtime Set (`_visibleHeadingOutlinePaths`) and re-renders — never opens
   * the file, never touches selection/Continu, never calls saveSettings().
   * A double-click on the file's own name (renderFileRow) shares the exact
   * same toggle via `toggleHeadingOutlineForFile()` — never a second, drift-
   * prone implementation of the same Set flip. */
  headingOutlineContextMenuExtras(file: TFile): (menu: Menu) => void {
    return (menu: Menu) => {
      if (headingOutlineForFile(this.app, file).length === 0) return;
      const visible = this._visibleHeadingOutlinePaths.has(file.path);
      menu.addItem((item) =>
        item
          .setTitle(t(visible ? "binder.headingOutline.hide" : "binder.headingOutline.show"))
          .setIcon("list-tree")
          .onClick(() => this.toggleHeadingOutlineForFile(file))
      );
    };
  }

  /** GitHub #17 follow-up: navigates from a clicked heading row to its exact
   * position in `file` — same leaf policy as a normal Binder file click
   * (`getLeafForOpeningFile()` + `revealLeaf()`), then delegates entirely to
   * the existing `openFileAndSelectRange()` (utils/dom.ts) for opening,
   * waiting on the real open, converting the offset, selecting, scrolling
   * and focusing the editor — no navigation logic duplicated here. `start`
   * and `end` are BOTH `node.startOffset`: a heading click places the
   * cursor, it never selects the whole heading line. Never touches
   * `_visibleHeadingOutlinePaths`, never calls `render()`, never touches
   * Binder selection or Continu — a heading click is pure editor
   * navigation. `revealLeaf()` is genuinely AWAITED (not fired and
   * forgotten): the workspace events it can still trigger (`file-open`,
   * `active-leaf-change`) must find `_headingNavigationDepth` still above
   * 0 — releasing the lock any earlier let one of those events reach
   * `updateActiveHighlight()` before `revealLeaf()` had settled, letting
   * the Binder scroll again despite the lock. */
  async navigateToHeading(file: TFile, node: HeadingOutlineNode): Promise<void> {
    this._headingNavigationDepth++;
    try {
      const leaf = this.plugin.getLeafForOpeningFile();
      await openFileAndSelectRange(this.app, leaf, file, node.startOffset, node.startOffset);
      await this.app.workspace.revealLeaf(leaf);
    } finally {
      this._headingNavigationDepth--;
    }
  }

  /** Whether a heading-to-heading drop is allowed in THIS first version:
   * same file, same Markdown level, and not a no-op self-target. Never any
   * other criterion — no cross-file, no cross-level, no promotion or
   * demotion. */
  private isValidHeadingDropTarget(source: HeadingDragState, file: TFile, node: HeadingOutlineNode): boolean {
    return source.filePath === file.path && source.level === node.level && source.sourceStartOffset !== node.startOffset;
  }

  /** Removes the drop-position indicator classes from every heading row in
   * this Binder — never touches the physical drag/drop classes
   * (`feuillets-dragover`/`feuillets-dragging`) used by the TFile/TFolder
   * drag system (attachDragHandlers, base-feuillets-view.ts). */
  private clearHeadingDropIndicators(): void {
    this.contentEl
      .querySelectorAll<HTMLElement>(
        ".feuillets-heading-outline-drop-before, .feuillets-heading-outline-drop-after, .feuillets-heading-outline-drag-promote, .feuillets-heading-outline-drag-demote, .feuillets-heading-outline-drag-invalid"
      )
      .forEach((el) => {
        el.removeClass("feuillets-heading-outline-drop-before");
        el.removeClass("feuillets-heading-outline-drop-after");
        el.removeClass("feuillets-heading-outline-drag-promote");
        el.removeClass("feuillets-heading-outline-drag-demote");
        el.removeClass("feuillets-heading-outline-drag-invalid");
      });
  }

  private updateHeadingHorizontalDragMode(source: HeadingDragState, clientX: number): void {
    const deltaX = clientX - source.startClientX;
    let mode: HeadingDragState["horizontalMode"] = "move";
    if (deltaX <= -HEADING_HORIZONTAL_DRAG_THRESHOLD) mode = source.level === 1 ? "invalid" : "promote";
    if (deltaX >= HEADING_HORIZONTAL_DRAG_THRESHOLD) mode = source.containsLevelSix ? "invalid" : "demote";
    source.horizontalMode = mode;
    source.row.removeClass("feuillets-heading-outline-drag-promote");
    source.row.removeClass("feuillets-heading-outline-drag-demote");
    source.row.removeClass("feuillets-heading-outline-drag-invalid");
    if (mode === "promote") source.row.addClass("feuillets-heading-outline-drag-promote");
    if (mode === "demote") source.row.addClass("feuillets-heading-outline-drag-demote");
    if (mode === "invalid") source.row.addClass("feuillets-heading-outline-drag-invalid");
  }

  /** Wires a single heading row for section-reordering drag & drop — kept
   * out of the recursive renderer (renderHeadingOutlineNodes) so that
   * function stays focused on rendering. Entirely independent of the
   * physical TFile/TFolder drag system: its own MIME (`HEADING_DRAG_MIME`),
   * its own runtime state (`_headingDragState`), its own CSS classes —
   * never `plugin.dragState`, never `_binderMultiSelect`. */
  private attachHeadingDragHandlers(row: HTMLElement, file: TFile, node: HeadingOutlineNode): void {
    row.setAttr("draggable", "true");

    row.addEventListener("dragstart", (e: DragEvent) => {
      // A drag started ON the collapse chevron is structure, not a section
      // move — refuse it here rather than making the chevron itself
      // undraggable, since the row it sits in must stay draggable everywhere
      // else. See §18: no other dragstart/dragover/dragleave/drop/dragend
      // rule changes.
      const target = e.target as HTMLElement | null;
      if (target?.closest(".feuillets-heading-outline-chevron")) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      if (!e.dataTransfer) return;
      this._headingDragState = {
        filePath: file.path,
        sourceStartOffset: node.startOffset,
        level: node.level,
        text: node.text,
        startClientX: e.clientX,
        containsLevelSix: this.headingSubtreeContainsLevel(node, 6),
        horizontalMode: "move",
        row,
      };
      e.dataTransfer.setData(HEADING_DRAG_MIME, file.path);
      e.dataTransfer.effectAllowed = "move";
      row.addClass("feuillets-heading-outline-dragging");
    });

    row.addEventListener("dragend", () => {
      this._headingDragState = null;
      row.removeClass("feuillets-heading-outline-dragging");
      this.clearHeadingDropIndicators();
    });

    row.addEventListener("dragover", (e: DragEvent) => {
      const source = this._headingDragState;
      if (!source) return;
      if (source.filePath !== file.path) return;
      this.updateHeadingHorizontalDragMode(source, e.clientX);
      if (source.horizontalMode !== "move") {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = source.horizontalMode === "invalid" ? "none" : "move";
        this.clearHeadingDropIndicators();
        this.updateHeadingHorizontalDragMode(source, e.clientX);
        return;
      }
      if (!this.isValidHeadingDropTarget(source, file, node)) {
        row.removeClass("feuillets-heading-outline-drop-before");
        row.removeClass("feuillets-heading-outline-drop-after");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const placement: HeadingSectionPlacement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      row.toggleClass("feuillets-heading-outline-drop-before", placement === "before");
      row.toggleClass("feuillets-heading-outline-drop-after", placement === "after");
    });

    row.addEventListener("dragleave", () => {
      row.removeClass("feuillets-heading-outline-drop-before");
      row.removeClass("feuillets-heading-outline-drop-after");
    });

    row.addEventListener("drop", (e: DragEvent) => {
      const source = this._headingDragState;
      if (!source) return;
      if (source.filePath !== file.path) return;
      if (source.horizontalMode !== "move") {
        e.preventDefault();
        e.stopPropagation();
        this._headingDragState = null;
        this.clearHeadingDropIndicators();
        if (source.horizontalMode === "promote" || source.horizontalMode === "demote") {
          void this.shiftHeadingSubtreeInFile(file, source.sourceStartOffset, source.level, source.text, source.horizontalMode);
        }
        return;
      }
      if (!this.isValidHeadingDropTarget(source, file, node)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const placement: HeadingSectionPlacement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      this._headingDragState = null;
      this.clearHeadingDropIndicators();
      void this.moveHeadingSectionInFile(file, source.sourceStartOffset, node.startOffset, source.level, placement);
    });
  }

  /** Moves a Markdown heading section within `file` — the ONLY place that
   * mutates the file for a heading drag. Delegates all section math to
   * `moveHeadingSection()` (heading-section-move.ts): this method's sole
   * job is fetching a trustworthy `text`/`headings` pair, revalidating
   * source and target still exist at the expected level, writing
   * atomically, and waiting for the real MetadataCache refresh before
   * re-rendering.
   *
   * `Vault.process()` — never `cachedRead()`/`read()` + `modify()` — is
   * used because its callback receives the file's CURRENT content at the
   * moment of the atomic write, never a stale snapshot captured at
   * dragstart. `headingOutlineInputsForFile()` is likewise read fresh
   * INSIDE that callback: if the file changed since the Binder was
   * rendered, source/target are re-identified by `startOffset` alone
   * (never by heading text) against this fresh list, and the move is
   * refused — original text returned — if either is missing or no longer
   * at `expectedLevel`. Never an approximate/heuristic repair. */
  private async moveHeadingSectionInFile(
    file: TFile,
    sourceStartOffset: number,
    targetStartOffset: number,
    expectedLevel: number,
    placement: HeadingSectionPlacement
  ): Promise<void> {
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) return;

    let moveChanged = false;
    let writtenText: string | null = null;
    let eventRef: EventRef | null = null;
    /* Installed BEFORE the write so the real "changed" event can never be
       missed — but it only resolves once THIS move has genuinely written a
       change to THIS file, never on an unrelated or earlier event: see
       `moveChanged`, set true only right before the callback below returns
       the actually-moved text. */
    const metadataRefreshed = new Promise<void>((resolve) => {
      eventRef = this.app.metadataCache.on("changed", (changedFile) => {
        if (!moveChanged || changedFile.path !== currentFile.path || writtenText === null) return;
        const headings = headingOutlineInputsForFile(this.app, currentFile);
        if (headingsMatchText(writtenText, headings)) resolve();
      });
    });

    try {
      let didChange = false;
      try {
        await this.app.vault.process(currentFile, (text) => {
          const headings = headingOutlineInputsForFile(this.app, currentFile);
          if (!headingsMatchText(text, headings)) return text;
          const source = headings.find((heading) => heading.startOffset === sourceStartOffset);
          const target = headings.find((heading) => heading.startOffset === targetStartOffset);
          if (!source || !target) return text;
          if (source.level !== expectedLevel || target.level !== expectedLevel) return text;

          const result = moveHeadingSection(text, headings, sourceStartOffset, targetStartOffset, placement);
          if (!result || !result.changed) return text;

          didChange = true;
          moveChanged = true;
          writtenText = result.text;
          return result.text;
        });
      } catch {
        // `vault.process()` itself failing (a disk error, a stale file
        // handle…) means nothing was written — there is nothing to refresh.
        // This method is always invoked as a fire-and-forget `void` call, so
        // a write failure is swallowed here rather than becoming an
        // unhandled rejection. `finally` below still removes the listener.
        // An error from `metadataRefreshed` or `render(true)` below is
        // deliberately OUTSIDE this catch — those happen only after a real
        // write succeeded, and must stay observable.
        return;
      }

      if (!didChange) return;

      await metadataRefreshed;
      await this.render(true);
    } finally {
      if (eventRef) this.app.metadataCache.offref(eventRef);
    }
  }

  /** Builds a deterministic, `startOffset`-independent collapse key for
   * every node in `roots` (a heading outline tree for `file`), keyed by
   * `file.path` + level + text + occurrence — occurrence is a per-document,
   * preorder counter over nodes sharing the same path/level/text, so two
   * identical headings (e.g. two "Introduction" H2s) always get distinct
   * keys. Walked in preorder (document order) so occurrence numbering is
   * stable across renders as long as the DOCUMENT's heading order is
   * unchanged — exactly what `_collapsedHeadingKeys` needs to survive a
   * drag/drop move or a MetadataCache refresh that only shifts offsets. */
  private buildHeadingCollapseKeys(
    file: TFile,
    roots: readonly HeadingOutlineNode[]
  ): Map<HeadingOutlineNode, string> {
    const nodes: HeadingOutlineNode[] = [];
    const visit = (items: readonly HeadingOutlineNode[]) => {
      for (const node of items) {
        nodes.push(node);
        visit(node.children);
      }
    };
    visit(roots);
    return buildHeadingSemanticKeys(file, nodes);
  }

  private collapsedHeadingSnapshot(file: TFile): CollapsedHeadingSnapshot {
    const outline = headingOutlineForFile(this.app, file);
    const keys = this.buildHeadingCollapseKeys(file, outline);
    const nodes = Array.from(keys.keys());
    return {
      keys: nodes.map((node) => keys.get(node) ?? ""),
      texts: nodes.map((node) => node.text),
      collapsedOrdinals: nodes.flatMap((node, index) => this._collapsedHeadingKeys.has(keys.get(node) ?? "") ? [index] : []),
    };
  }

  private restoreCollapsedHeadingSnapshot(file: TFile, snapshot: CollapsedHeadingSnapshot): void {
    const outline = headingOutlineForFile(this.app, file);
    const keys = this.buildHeadingCollapseKeys(file, outline);
    const nodes = Array.from(keys.keys());
    if (nodes.length !== snapshot.texts.length || nodes.some((node, index) => node.text !== snapshot.texts[index])) return;
    for (const key of snapshot.keys) this._collapsedHeadingKeys.delete(key);
    for (const ordinal of snapshot.collapsedOrdinals) {
      const key = keys.get(nodes[ordinal]);
      if (key) this._collapsedHeadingKeys.add(key);
    }
  }

  private async shiftHeadingSubtreeInFile(
    file: TFile,
    sourceStartOffset: number,
    expectedLevel: number,
    expectedText: string,
    direction: HeadingSubtreeShiftDirection
  ): Promise<void> {
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) return;

    const collapseSnapshot = this.collapsedHeadingSnapshot(currentFile);
    let shiftChanged = false;
    let writtenText: string | null = null;
    let eventRef: EventRef | null = null;
    const metadataRefreshed = new Promise<void>((resolve) => {
      eventRef = this.app.metadataCache.on("changed", (changedFile) => {
        if (!shiftChanged || changedFile.path !== currentFile.path || writtenText === null) return;
        const headings = headingOutlineInputsForFile(this.app, currentFile);
        if (headingsMatchText(writtenText, headings)) resolve();
      });
    });

    try {
      let didChange = false;
      try {
        await this.app.vault.process(currentFile, (text) => {
          const headings = headingOutlineInputsForFile(this.app, currentFile);
          if (!headingsMatchText(text, headings)) return text;
          const source = headings.find((heading) => heading.startOffset === sourceStartOffset);
          if (!source || source.level !== expectedLevel || source.text !== expectedText) return text;

          const result = shiftHeadingSubtree(text, headings, sourceStartOffset, direction);
          if (!result || !result.changed) return text;

          didChange = true;
          shiftChanged = true;
          writtenText = result.text;
          return result.text;
        });
      } catch {
        return;
      }

      if (!didChange) return;

      await metadataRefreshed;
      this.restoreCollapsedHeadingSnapshot(currentFile, collapseSnapshot);
      await this.render(true);
    } finally {
      if (eventRef) this.app.metadataCache.offref(eventRef);
    }
  }

  private headingSubtreeContainsLevel(node: HeadingOutlineNode, level: number): boolean {
    return node.level === level || node.children.some((child) => this.headingSubtreeContainsLevel(child, level));
  }

  private showHeadingShiftMenu(e: MouseEvent, file: TFile, node: HeadingOutlineNode): void {
    const target = typeof HTMLElement !== "undefined" && e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest(".feuillets-heading-outline-chevron")) return;
    e.preventDefault();
    e.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("binder.headingOutline.promote"))
        .setDisabled(node.level === 1)
        .onClick(() => void this.shiftHeadingSubtreeInFile(file, node.startOffset, node.level, node.text, "promote"))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.headingOutline.demote"))
        .setDisabled(this.headingSubtreeContainsLevel(node, 6))
        .onClick(() => void this.shiftHeadingSubtreeInFile(file, node.startOffset, node.level, node.text, "demote"))
    );
    menu.showAtMouseEvent(e);
  }

  /** The ONE place that flips a heading's collapsed state — shared by the
   * chevron's click and a double-click on the heading's own text, so
   * neither can drift out of sync with the other. Purely a `Set` toggle
   * plus a rerender: no navigation, no drag state, no persistence. */
  private toggleHeadingCollapsed(key: string): void {
    if (this._collapsedHeadingKeys.has(key)) this._collapsedHeadingKeys.delete(key);
    else this._collapsedHeadingKeys.add(key);
    void this.render(true);
  }

  /** The ONE place that flips whether `file`'s heading structure is shown
   * in the Binder — shared by the file's context menu entry
   * (headingOutlineContextMenuExtras) and a double-click on the file's own
   * name, so neither can drift out of sync with the other. A file with no
   * heading is a no-op: never adds an empty/pointless entry to
   * `_visibleHeadingOutlinePaths`. */
  private toggleHeadingOutlineForFile(file: TFile): void {
    if (headingOutlineForFile(this.app, file).length === 0) return;
    if (this._visibleHeadingOutlinePaths.has(file.path)) this._visibleHeadingOutlinePaths.delete(file.path);
    else this._visibleHeadingOutlinePaths.add(file.path);
    void this.render(true);
  }

  /** Configure uniquement un dossier Manuscrit descendant du projet. La
   * racine du projet, les fichiers et Recherche ne passent pas par cette
   * entrée : ils disposent de leurs propres menus. */
  folderWorkspaceExtras(folder: TFolder): (menu: Menu) => void {
    return (menu: Menu) => {
      const projectRoot = this.plugin.getProjectFolder();
      if (!projectRoot || !folderPathToWorkspaceScope(projectRoot.path, folder.path)) return;
      menu.addItem((item) =>
        item
          .setTitle(t("binder.configureWorkspace"))
          .setIcon("sliders-horizontal")
          .onClick(() => new FolderWorkspaceModal(this.app, this.plugin, folder).open())
      );
    };
  }

  /** Scope à transmettre à « Ouvrir en continu » pour ce dossier : la
   * sélection COMPLÈTE si ce dossier appartient à une multi-sélection
   * Binder de plus d'un élément, sinon le dossier seul — comble le trou
   * identifié Lot 2A §6 (un clic droit sur un fichier sélectionné connaît
   * déjà le groupe via showFileContextMenu ; un dossier sélectionné
   * retombait jusqu'ici toujours sur son propre scope dossier). */
  continuScopeForFolder(folder: TFolder): CompileScope | null {
    const projectRoot = this.plugin.getProjectFolder();
    if (!projectRoot) return null;
    const groupSel = this.plugin._binderMultiSelect;
    if (groupSel && groupSel.size > 1 && groupSel.has(folder.path)) {
      return typeof this.plugin.compileScopeForSelection === "function"
        ? this.plugin.compileScopeForSelection(Array.from(groupSel))
        : createSelectionScope(projectRoot.path, Array.from(groupSel));
    }
    if (typeof this.plugin.compileScopeForFolder === "function") {
      return this.plugin.compileScopeForFolder(folder);
    }
    return createFolderScope(projectRoot.path, folder.path);
  }

  /** Entrée « Ouvrir en continu » ajoutée au menu contextuel standard d'un
   * dossier (showFolderContextMenu, extraItems) — jamais un second menu,
   * même patron que binderIsolateExtras ci-dessus. N'affecte QUE
   * FeuilletsView : BoardView (board-view.ts) appelle showFolderContextMenu
   * sans passer cet extraItems, son menu dossier reste donc strictement
   * inchangé (Lot 2A §6). */
  continuExtras(folder: TFolder): (menu: Menu) => void {
    return (menu: Menu) => {
      const scope = this.continuScopeForFolder(folder);
      if (!scope) return;
      menu.addItem((item) =>
        item
          .setTitle(t("binder.openInContinu"))
          .setIcon("layers")
          .onClick(async () => {
            await openScopeInContinu(this.app, scope);
          })
      );
    };
  }

  /** LOT FINAL Binder ↔ Continu, §11 : clic simple sur le NOM d'un dossier
   * → ouvre ce dossier en Continu dans la LEAF DE TRAVAIL CENTRALE, jamais
   * une nouvelle leaf (jamais `getLeaf("tab")`/`getLeaf("split")`) — même
   * mécanisme same-leaf déjà validé que la promotion Markdown ↔ Continu
   * (`openScopeInContinuOnLeaf`) et que la résolution de la leaf centrale
   * d'un clic fichier normal (`plugin.getLeafForOpeningFile()`, §25).
   *
   * Si la leaf centrale est déjà Continu, on recharge simplement ce nouveau
   * scope dessus (`continu.openScope`) — jamais `openScopeInContinuOnLeaf`,
   * réservée à la transformation D'UN MarkdownView. Dossier sans feuillet
   * Markdown admissible (§14) : ne construit jamais un Continu vide, la vue
   * centrale actuelle reste strictement inchangée. */
  async openFolderInContinu(folder: TFolder): Promise<void> {
    const scope = typeof this.plugin.compileScopeForFolder === "function"
      ? this.plugin.compileScopeForFolder(folder)
      : (this.plugin.getProjectFolder() ? createFolderScope(this.plugin.getProjectFolder()!.path, folder.path) : null);
    if (!scope) return;

    const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
    if (files.length === 0) return;

    const continu = this.activeContinuMembershipView();
    if (continu) {
      const applied = await continu.openScope(scope);
      if (applied) this.refreshContinuMembershipHighlight();
      return;
    }

    const leaf = this.plugin.getLeafForOpeningFile();
    if (!leaf) return;
    const promoted = await openScopeInContinuOnLeaf(this.app, leaf, scope);
    if (promoted) this.refreshContinuMembershipHighlight();
  }

  /** Wrapper d'icône commun aux lignes fichier ET dossier du Binder (§17-20
   * du LOT FINAL Binder ↔ Continu). Grammaire FINALE (micro-correctif final
   * "ligne blanche + finition Continu", §2) — un essai précédent avait
   * coloré l'icône elle-même avec le label ; validation visuelle réelle :
   * pas assez lisible, doublon avec le liseré. Revenu en arrière côté
   * styles.css UNIQUEMENT (`.feuillets-binder-node-icon.has-label` neutre) :
   * l'icône (`setIcon`, natif Obsidian/Lucide — jamais un emoji ni un SVG
   * maison) porte SEULEMENT le TYPE de nœud, TOUJOURS neutre. `.has-label`/
   * `--feuillets-label-color` sont encore posées ici (inoffensives, aucun
   * rendu ni donnée) — le label reste représenté PAR AILLEURS, sur le
   * liseré HISTORIQUE de ligne (`box-shadow` posé directement sur
   * `.feuillets-item`, voir plus bas), intégralement préservé. Ne recolore
   * jamais le texte, le fond de ligne, ni la sélection Continu.
   * `labelColor` à `null` : aucune classe `.has-label` (sans effet visuel
   * de toute façon, voir ci-dessus). */
  buildBinderNodeIcon(host: HTMLElement, iconName: string, labelColor: string | null): HTMLElement {
    const wrap = host.createSpan({ cls: "feuillets-binder-node-icon" });
    setIcon(wrap, iconName);
    if (labelColor) {
      wrap.addClass("has-label");
      wrap.style.setProperty("--feuillets-label-color", labelColor);
    }
    return wrap;
  }

  /** Translated display label for a raw stored status value, resolved
   * against the status catalogue actually in effect for `folder`
   * (workspaceStatuses) — same lookup already used by the Binder's status
   * filter menu and the folder context menu's "Changer de statut" choices.
   * A genuine custom status (no match in the catalogue) keeps showing its
   * own stored name verbatim: never a raw built-in id like "in_progress". */
  private statusDotLabel(value: string, folder: TFolder | null): string {
    for (const status of workspaceStatuses(this.app, this.plugin.settings, folder)) {
      if (statusStoredValue(status).trim() === value) return statusDisplayLabel(status, getLocale());
    }
    return value;
  }

  /** Compact status dot + progress ring, appended to `host` (the title row
   * of a file or folder line) when `binderShowStatus`/`binderShowProgress`
   * are on — the two settings reactivated by this batch. Reuses the exact
   * existing rendering primitives (`.feuillets-status-dot`,
   * `plugin.getStatusColor`, `.feuillets-ring`/`fillRing`, `goalFor`) so a
   * file's own indicators and a folder's indicators (via its folder note)
   * are visually and semantically identical. Renders nothing at all when
   * both settings are off, when there is no status, or when there is no
   * valid word-count goal — never an empty placeholder reserving space. */
  private renderBinderIndicators(
    host: HTMLElement,
    opts: { statusValue: string; contextFolder: TFolder | null; wc: number; goal: number }
  ): void {
    const S = this.plugin.settings;
    if (!S.binderShowStatus && !S.binderShowProgress) return;
    const showStatus = S.binderShowStatus && opts.statusValue !== "";
    const showProgress = S.binderShowProgress && opts.goal > 0;
    if (!showStatus && !showProgress) return;

    const indicators = host.createSpan({ cls: "feuillets-binder-indicators" });

    if (showStatus) {
      const dot = indicators.createSpan({ cls: "feuillets-status-dot" });
      dot.style.background = this.plugin.getStatusColor(opts.statusValue, opts.contextFolder) || "var(--text-faint)";
      const label = this.statusDotLabel(opts.statusValue, opts.contextFolder);
      dot.setAttr("role", "img");
      dot.setAttr("aria-label", label);
      setTooltip(dot, label);
    }

    if (showProgress) {
      const pct = Math.min(100, Math.round((opts.wc / opts.goal) * 100));
      const ring = indicators.createSpan({ cls: "feuillets-ring" });
      this.fillRing(ring, opts.wc, opts.goal, opts.contextFolder);
      ring.setAttr("role", "progressbar");
      ring.setAttr("aria-valuemin", "0");
      ring.setAttr("aria-valuemax", "100");
      ring.setAttr("aria-valuenow", String(pct));
      const tooltip = t("binder.progress.tooltip", { pct: String(pct), wc: String(opts.wc), goal: String(opts.goal) });
      ring.setAttr("aria-label", tooltip);
      setTooltip(ring, tooltip);
    }
  }

  /** Clé de l'éventuel override de densité de session : le chemin de la
   * racine de travail isolée si elle diffère de la vraie racine du projet,
   * sinon `null` (Binder normal — la densité suit `settings.binderCompact`
   * directement, sans jamais consulter la Map). */
  getBinderCompactScope(): string | null {
    const projectRoot = this.getProjectFolder();
    if (!projectRoot) return null;
    const workingRoot = this.getBinderWorkingRoot(projectRoot);
    return workingRoot && workingRoot.path !== projectRoot.path ? workingRoot.path : null;
  }

  /** Densité EFFECTIVE à appliquer au rendu : l'override de session du
   * dossier isolé s'il en a un, sinon `settings.binderCompact` — que ce
   * soit parce qu'aucun dossier n'est isolé, ou qu'il l'est mais n'a encore
   * aucun override (il « hérite » alors simplement de la valeur globale,
   * sans qu'aucune entrée ne soit créée dans la Map avant un premier
   * bascule — voir le bouton Densité dans render()). */
  getEffectiveBinderCompact(scopeKey: string | null): boolean {
    if (scopeKey && this._binderCompactOverrides?.has(scopeKey)) {
      return !!this._binderCompactOverrides.get(scopeKey);
    }
    return !!this.plugin.settings.binderCompact;
  }

  getViewType(): string {
    return VIEW_SIDEBAR;
  }

  getDisplayText(): string {
    return t("binder.displayText");
  }

  getIcon(): string {
    return "files";
  }

  async onOpen(): Promise<void> {
    if (this.plugin.registerEditorCursorListener) {
      this.register(this.plugin.registerEditorCursorListener((change) => this.onEditorCursorChanged(change)));
    }
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateActiveHighlight("active-leaf-change");
        this.refreshCurrentHeadingHighlight();
        /* Continu peut devenir (ou cesser d'être) la leaf active sans
           qu'aucun "layout-change" ne survienne (ex. Alt+Tab entre deux
           onglets déjà ouverts) — voir §3/§10 du micro-lot "sélection
           continu par clic simple" : la surbrillance doit suivre. */
        this.refreshContinuMembershipHighlight();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.updateActiveHighlight("file-open");
        this.refreshCurrentHeadingHighlight();
      })
    );
    /* Ouverture/fermeture de Continu ailleurs (menu Binder d'un AUTRE
       panneau, fermeture d'onglet…) : "layout-change" est l'événement
       workspace générique déjà déclenché par Obsidian dans ces cas — pas de
       scan du Vault, juste une actualisation légère de la surbrillance déjà
       rendue (voir refreshContinuMembershipHighlight ci-dessous). Jamais
       "editor-change" : réservé à la status bar (main.ts, §8). */
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.refreshContinuMembershipHighlight())
    );
    /* Flèches haut/bas = feuillet suivant/précédent (openNeighbor, déjà
       utilisé par les commandes "Feuillet suivant/précédent") — dès que le
       clavier est dans le Binder mais PAS dans un champ de saisie (barre de
       recherche, édition en ligne d'un tag/synopsis…), pour ne jamais voler
       une flèche destinée à déplacer un curseur de texte.
       Posé sur `window` en phase de CAPTURE plutôt que sur this.contentEl en
       bulles (comme avant) : des plugins basés sur React (ex. Notebook
       Navigator, confirmé dans son bundle) posent leurs propres écouteurs
       délégués en phase de capture sur leur conteneur — un écouteur en
       bulles sur notre seul contentEl peut alors ne jamais recevoir
       l'événement selon l'ordre de montage des panneaux. En capture sur
       `window`, on est servis avant n'importe quel écouteur plus bas dans
       l'arbre, quel que soit le plugin. On vérifie donc nous-mêmes que le
       focus est bien dans le Binder (e.target), puisqu'on ne peut plus
       compter sur le simple fait d'avoir été atteints par la bulle. */
    this.registerDomEvent(window, "keydown", async (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as Node | null;
      if (!target || !this.contentEl.contains(target)) return;
      const tag = (target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      const next = await this.plugin.openNeighbor(e.key === "ArrowDown" ? 1 : -1, { focusEditor: false });
      /* openNeighbor parcourt tout le projet dans l'ordre du manuscrit, pas
         seulement le dossier affiché dans le volet fiches — sans faire
         suivre la sélection de dossier ici, une fiche voisine d'un AUTRE
         dossier que celui sélectionné n'existait nulle part dans le DOM
         rendu : aucune surbrillance, focus perdu, et le volet dossiers ne
         semblait jamais "changer" au clavier. */
      const S = this.plugin.settings;
      if (next && next.parent && next.parent.path !== S.binderSelectedPath) {
        S.binderSelectedPath = next.parent.path;
        await this.plugin.saveSettings();
        await this.render(true);
      }
      /* Reprend le focus sur la ligne devenue active pour que la flèche
         suivante continue à naviguer dans le Binder — sans ça, la 2e
         pression irait dans l'éditeur (focus jamais déplacé, mais resté
         sur l'ancienne ligne, plus "active"). Léger délai : l'événement
         "file-open" (qui pose is-active) n'a pas forcément fini avant que
         ce callback continue. */
      window.setTimeout(() => {
        this.contentEl.querySelector<HTMLElement>(".feuillets-item.is-active")?.focus();
      }, 60);
    }, { capture: true });
    await this.render();
  }

  /** Whether `path` already labels a `.feuillets-item.is-active` row in the
   * Binder — used to recognize a REDUNDANT `active-leaf-change` (see
   * updateActiveHighlight): Obsidian still fires this event once a heading
   * click's `openFileAndSelectRange()`/`revealLeaf()` sequence has fully
   * settled, even though the active file never actually changed. Compares
   * `dataset.path` explicitly rather than assuming the only
   * `.is-active` row matches — safe even if several exist momentarily. */
  private isBinderPathAlreadyActive(path: string | null | undefined): boolean {
    if (!path) return false;
    return Array.from(this.contentEl.querySelectorAll<HTMLElement>(".feuillets-item.is-active"))
      .some((el) => el.dataset.path === path);
  }

  updateActiveHighlight(reason: ActiveHighlightReason = "file-open"): void {
    const activePath = getActiveFileSafe(this.app)?.path;
    /* GitHub #17: a heading click's own openFileAndSelectRange()/revealLeaf()
     * sequence still fires a LATE "active-leaf-change" once fully settled
     * (`_headingNavigationDepth` back to 0), even though the active file
     * never actually changed — its row already carries `.is-active`. That
     * redundant event must not scroll the Binder a second time on top of
     * the editor's own scroll. A REAL "active-leaf-change" (next/previous
     * sheet, another tab, an internal link) still targets a row that is
     * NOT yet `.is-active`, so it keeps revealing it exactly as before.
     * Scoped to "active-leaf-change" only — "file-open" and "render-end"
     * keep their historical behavior unconditionally. */
    const redundantActiveLeafChange = reason === "active-leaf-change" && this.isBinderPathAlreadyActive(activePath);
    const scroll = this._headingNavigationDepth === 0 && !redundantActiveLeafChange;
    highlightActive(this.contentEl, activePath, { scroll });
  }

  private centralMarkdownView(): MarkdownView | null {
    const workspace = this.app.workspace;
    if (typeof workspace.getMostRecentLeaf !== "function") return null;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf) return null;
    if (typeof leaf.getRoot === "function" && leaf.getRoot() !== workspace.rootSplit) return null;
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) return null;
    return view;
  }

  private onEditorCursorChanged(change: EditorCursorChange): void {
    const view = this.centralMarkdownView();
    if (!view || view.file?.path !== change.filePath) return;
    this.refreshCurrentHeadingHighlight();
  }

  private refreshCurrentHeadingHighlight(cursorOffset?: number): void {
    if (typeof this.contentEl.findAll !== "function") return;
    const rows = this.contentEl.findAll(".feuillets-heading-outline-row");
    for (const row of rows) {
      row.removeClass("feuillets-heading-outline-current");
      row.removeClass("feuillets-heading-outline-current-ancestor");
    }

    const view = this.centralMarkdownView();
    const file = view?.file;
    if (!view || !file || !this._visibleHeadingOutlinePaths.has(file.path)) return;

    const offset = cursorOffset ?? view.editor.posToOffset(view.editor.getCursor("head"));
    const headings = headingOutlineInputsForFile(this.app, file);
    const trail = headingTrailAtOffset(headings, offset);
    if (trail.length === 0) return;

    const keys = buildHeadingSemanticKeys(file, headings);
    const currentKey = keys.get(trail[trail.length - 1]);
    if (!currentKey) return;
    const rowForKey = (key: string): HTMLElement | undefined =>
      rows.find((row) => row.getAttr("data-heading-outline-key") === key);

    const exact = rowForKey(currentKey);
    if (exact) {
      exact.addClass("feuillets-heading-outline-current");
      return;
    }

    for (let index = trail.length - 2; index >= 0; index--) {
      const ancestorKey = keys.get(trail[index]);
      const ancestor = ancestorKey ? rowForKey(ancestorKey) : undefined;
      if (ancestor) {
        ancestor.addClass("feuillets-heading-outline-current-ancestor");
        return;
      }
    }
  }

  /** Onglet Continu RÉELLEMENT au travail (dernière leaf CENTRALE, pas la
   * "vue globalement active") et compatible avec ce Binder, ou `null` —
   * micro-correctif "focus binder + 2→1 + typographie same-leaf" (§1-2).
   * Strict à dessein : ne retourne un résultat QUE si (1) cette leaf
   * appartient bien à `workspace.rootSplit`, (2) sa vue expose réellement
   * le contrat Continu (`isContinuMembershipView`), (3) `getViewType()`
   * vaut `VIEW_SCRIVENINGS`, (4) son `compileScope` existe, (5) son
   * `projectRoot` correspond au projet affiché par CE Binder.
   *
   * Volontairement PAS `workspace.getActiveViewOfType(ScriveningsView)` :
   * un clic dans le Binder (sidebar) donne le focus à la sidebar, la
   * ScriveningsView centrale cesse alors d'être la vue "active" au sens
   * Obsidian bien qu'elle reste la leaf de travail visible — cette API
   * retournait donc `null` à tort pendant l'interaction même que ce
   * helper doit reconnaître. `getMostRecentLeaf(rootSplit)` ignore le
   * focus de la sidebar : seule la dernière leaf centrale compte. Jamais
   * `getActiveFile()`, jamais le premier résultat de `getLeavesOfType`,
   * jamais une ScriveningsView quelconque ouverte dans un AUTRE onglet. */
  activeContinuMembershipView(): ContinuMembershipView | null {
    const root = this.getProjectFolder();
    if (!root) return null;
    const workspace = this.app.workspace;
    // Défensif : de nombreux faux `workspace` de tests (Binder) ne déclarent
    // pas `getMostRecentLeaf` — jamais absent en Obsidian réel, mais un
    // Binder sans Continu actif ne doit jamais planter pour autant.
    if (typeof workspace.getMostRecentLeaf !== "function") return null;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf) return null;
    if (typeof leaf.getRoot === "function" && leaf.getRoot() !== workspace.rootSplit) return null;
    const view = leaf.view;
    if (!isContinuMembershipView(view)) return null;
    if (view.getViewType() !== VIEW_SCRIVENINGS) return null;
    if (!view.compileScope) return null;
    if (typeof this.plugin.isValidEditorialRootPath === "function") {
      if (!this.plugin.isValidEditorialRootPath(view.compileScope.projectRoot)) return null;
    } else {
      if (view.compileScope.projectRoot !== root.path) return null;
    }
    return view;
  }

  /** Resynchronise `.is-continu-member` sur toutes les lignes fichier déjà
   * rendues (`.feuillets-item[data-path]`), sans reconstruire le Binder ni
   * scanner le Vault : appelée après un toggle réussi, à l'ouverture/
   * fermeture de Continu ailleurs ("layout-change") et au changement de
   * leaf active ("active-leaf-change" — voir onOpen). La vérité reste
   * `continu.hasMember(path)`, jamais `_binderMultiSelect`. */
  refreshContinuMembershipHighlight(): void {
    const view = this.activeContinuMembershipView();
    const rows = this.contentEl.querySelectorAll<HTMLElement>(".feuillets-item[data-path]");
    rows.forEach((el) => {
      const path = el.getAttr("data-path");
      if (!path) return;
      el.toggleClass("is-continu-member", !!view && view.hasMember(path));
    });
  }

  /** Promotion automatique Markdown → Continu après un Maj+clic consommé
   * par `handleMultiSelectClick` (micro-lot delta "bascule Markdown ↔
   * Continu", §2-7) — appelée UNIQUEMENT quand ce clic portait `shiftKey`,
   * jamais pour Cmd/Ctrl+clic (chemin historique de multi-sélection
   * intégralement conservé, voir handleMultiSelectClick). Ne fait RIEN
   * (sélection multiple historique inchangée) si l'une des conditions
   * strictes suivantes échoue :
   * - la résolution RÉELLE du groupe (`resolveCompileScopeFiles`, jamais
   *   `_binderMultiSelect.size`) produit moins de 2 fichiers (§3) ;
   * - `plugin.getLeafForOpeningFile()` n'affiche pas RÉELLEMENT un
   *   `MarkdownView` d'un fichier du groupe résolu, ou est une leaf de
   *   sidebar (§4) — jamais de nouvelle leaf, jamais deviné une autre leaf.
   */
  private async tryPromoteSelectionToContinu(scopeEl: HTMLElement): Promise<void> {
    // Protection de non-régression (micro-correctif "typographie après
    // toggle + Maj+clic en Continu", §9) : ce chemin ne concerne QUE la
    // promotion Markdown → Continu INITIALE. Si un Continu central existe
    // déjà, un Maj+clic doit l'étendre en lot (voir le handler de clic
    // ci-dessous, CAS B) — jamais retomber ici, jamais appeler
    // `getLeafForOpeningFile()` pour un Continu déjà ouvert.
    if (this.activeContinuMembershipView()) return;

    const root = this.getProjectFolder();
    if (!root) return;

    const sel = this.plugin._binderMultiSelect;
    if (!sel || sel.size === 0) return;

    // §3 : le résolveur existant reste seul responsable (dossiers,
    // descendants, doublons, ordre Binder) — jamais `sel.size` comme
    // nombre réel de feuillets.
    const scope = typeof this.plugin.compileScopeForSelection === "function"
      ? this.plugin.compileScopeForSelection([...sel])
      : createSelectionScope(root.path, [...sel]);
    if (!scope) return;
    const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
    if (files.length < 2) return;

    // §4 : identifier STRICTEMENT la leaf Markdown à transformer — celle
    // que le clic normal aurait utilisée.
    const leaf = this.plugin.getLeafForOpeningFile();
    if (!leaf) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const activeFile = view.file;
    if (!activeFile) return;
    if (!files.some((f) => f.path === activeFile.path)) return;
    const inSidebar =
      leaf.getRoot() === this.app.workspace.leftSplit || leaf.getRoot() === this.app.workspace.rightSplit;
    if (inSidebar) return;

    const promoted = await openScopeInContinuOnLeaf(this.app, leaf, scope);
    if (!promoted) return;

    // §7 : la sélection temporaire n'a servi qu'à construire le groupe —
    // plus de `.is-selected`, uniquement `.is-continu-member` désormais.
    sel.clear();
    this.refreshMultiSelectClasses(scopeEl);
    this.refreshContinuMembershipHighlight();
  }

  /** MarkdownView RÉELLEMENT affiché par la leaf centrale de travail (même
   * helper `getLeafForOpeningFile()` qu'un clic normal), ou `null` — LOT
   * FINAL Binder ↔ Continu, §9 : identifie le fichier que Cmd/Ctrl+clic doit
   * rejoindre pour promouvoir cette MÊME leaf en Continu. Même garde-fous
   * que `tryPromoteSelectionToContinu` ci-dessus (jamais une leaf de
   * sidebar), volontairement dupliqués plutôt que factorisés dans le code
   * déjà validé de cette dernière : aucun refactoring opportuniste de ce
   * lot sur un mécanisme intact. */
  private getCmdClickCentralFile(): { leaf: WorkspaceLeaf; file: TFile } | null {
    const leaf = this.plugin.getLeafForOpeningFile();
    if (!leaf) return null;
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return null;
    const activeFile = view.file;
    if (!activeFile) return null;
    const inSidebar =
      leaf.getRoot() === this.app.workspace.leftSplit || leaf.getRoot() === this.app.workspace.rightSplit;
    if (inSidebar) return null;
    return { leaf, file: activeFile };
  }

  /** Promotion Markdown → Continu déclenchée par un Cmd/Ctrl+clic (§9,
   * exemple : A.md actif, Cmd+clic C → même leaf devient Continu A+C) —
   * jamais quand un Continu est déjà actif (voir §8, chemin séparé dans le
   * handler de clic ci-dessous) ni quand la leaf centrale ne montre pas
   * RÉELLEMENT un `MarkdownView` exploitable. Retourne `false` sans rien
   * changer dans tous les cas où la promotion ne peut pas avoir lieu — le
   * clic retombe alors sur le chemin historique `_binderMultiSelect`
   * (voir le handler de clic, §10). */
  private async tryPromoteCmdClickToContinu(file: TFile): Promise<boolean> {
    if (this.activeContinuMembershipView()) return false;

    const root = this.getProjectFolder();
    if (!root) return false;

    const central = this.getCmdClickCentralFile();
    if (!central) return false;
    if (central.file.path === file.path) return false;

    const scope = typeof this.plugin.compileScopeForSelection === "function"
      ? this.plugin.compileScopeForSelection([central.file.path, file.path])
      : createSelectionScope(root.path, [central.file.path, file.path]);
    if (!scope) return false;
    const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
    if (files.length < 2) return false;

    const promoted = await openScopeInContinuOnLeaf(this.app, central.leaf, scope);
    if (!promoted) return false;

    this.refreshContinuMembershipHighlight();
    return true;
  }

  /** Anime le masquage/affichage du volet dossiers sans reconstruire tout
   * le binder — utilisée par le geste de balayage (main.js), qui ne
   * connaît que ce cycle à 2 états (voir registerSwipeGestures). Ne
   * touche pas les boutons de la barre d'actions (icône/tooltip figés
   * jusqu'au prochain vrai rendu), c'est un compromis assumé pour garder
   * le geste fluide. */
  toggleTreeCollapsedClasses(collapsed: boolean): void {
    const split = this.contentEl.querySelector(".feuillets-split");
    if (!split) return;
    const treePane = split.querySelector(".feuillets-tree-pane");
    const resizer = split.querySelector(".feuillets-split-resizer");
    split.toggleClass("is-tree-collapsed", collapsed);
    if (treePane) treePane.toggleClass("is-tree-collapsed", collapsed);
    if (resizer) resizer.toggleClass("is-tree-collapsed", collapsed);
    this.plugin.adjustSidebarWidth();
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Version à 3 états (double volet / fiches seules / dossiers seuls) —
   * utilisée par le bouton dédié (voir render()), relit directement les
   * réglages plutôt que de recevoir un booléen, pour rester correcte quel
   * que soit l'état de départ. */
  applyPaneModeClasses(): void {
    const S = this.plugin.settings;
    const split = this.contentEl.querySelector(".feuillets-split");
    if (!split) return;
    const treePane = split.querySelector(".feuillets-tree-pane");
    const listPane = split.querySelector(".feuillets-list-pane");
    const resizer = split.querySelector(".feuillets-split-resizer");
    const treeCollapsed = !!S.binderTreeCollapsed;
    const listCollapsed = !treeCollapsed && !!S.binderListCollapsed;
    split.toggleClass("is-tree-collapsed", treeCollapsed);
    split.toggleClass("is-list-collapsed", listCollapsed);
    if (treePane) treePane.toggleClass("is-tree-collapsed", treeCollapsed);
    if (listPane) listPane.toggleClass("is-list-collapsed", listCollapsed);
    if (resizer) {
      resizer.toggleClass("is-tree-collapsed", treeCollapsed);
      resizer.toggleClass("is-list-collapsed", listCollapsed);
    }
    this.plugin.adjustSidebarWidth();
    /* Rejoué après un tick : leftSplit.setSize() (API interne, non
       documentée) semble parfois ignorer un appel fait dans la même
       passe qu'un changement de classes CSS sans reconstruction complète
       — probablement une histoire de mise en page pas encore recalculée
       par Obsidian à cet instant précis. Un second appel différé est un
       filet de sécurité peu coûteux. */
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Champ sémantique d'aperçu du mode courant (ajustement "aperçu du
   * Binder") : "synopsis" en Fiction, "summary" en Non-fiction/Libre —
   * règle EXISTANTE de PROJECT_MODES[...].defaults.cardContent
   * (utils/project-modes.ts), jamais un nouveau réglage. Utilisée par
   * render() (résolution de l'aperçu rendu) ET showSplitPaneOptionsMenu
   * (choix proposés), pour qu'elles restent toujours d'accord.
   * `typeof … === "function"` : défensif pour les faux plugins de test qui
   * n'implémentent pas `projectMode()`, sans effet en Obsidian réel où la
   * méthode existe toujours (voir main.ts). */
  getBinderPreviewSemanticField(): "synopsis" | "summary" {
    return binderPreviewSemanticField(
      typeof this.plugin.projectMode === "function" ? this.plugin.projectMode().defaults.cardContent : undefined
    );
  }

  /** Réglages d'affichage (Affichage des lignes + accès aux réglages
   * complets) — ajoutés à la suite du contenu propre à showSplitPaneOptionsMenu
   * (densité, aperçu de la fiche), pas dans une icône réglages à part. */
  buildDisplayOptionsMenu(menu: Menu): void {
    const S = this.plugin.settings;

    const toggle = (title: string, key: string) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(!!S[key])
          .onClick(async () => {
            S[key] = !S[key];
            await this.plugin.saveSettings();
            void this.render(true);
          })
      );

    /* Statut et progression réintroduits (micro-lot "repère d'avancement
       sans dashboard") : une pastille de statut compacte et une micro-barre
       de progression, sur la MÊME ligne que le titre — jamais une seconde
       ligne, jamais un pourcentage permanent (voir renderBinderIndicators).
       Tags et nombre de mots en chiffres restent volontairement retirés de
       ce menu : trop de bruit visuel pour un simple repère d'avancement.
       Leurs clés de réglage (`binderShowTags`/`binderShowWords`) restent en
       place pour compatibilité des données, simplement toujours inertes
       pour ce rendu. Ces métadonnées restent réglables/consultables dans
       Cartes et Plan. */
    menu.addItem((item) => item.setTitle(t("binder.display.header")).setDisabled(true));
    toggle(t("binder.display.labelStripes"), "binderShowLabels");
    toggle(t("binder.display.statusDot"), "binderShowStatus");
    toggle(t("binder.display.progressBars"), "binderShowProgress");
    menu.addSeparator();

    /* Binder access point for Numbering… moved here from the project root's
       context menu — same shortcut to the SAME structure fields as Édition
       → Composition → Le manuscrit → Structure (createCompositionBinding,
       see ui/numbering-modal.ts, unchanged). Always the true GLOBAL project
       root (`getProjectFolder()`), never the isolated working root/selected
       folder: this menu can be opened while the Binder is isolated on a
       subfolder, but Numbering… is a shortcut to the project's own
       composition, not to whatever subfolder happens to be displayed. */
    const numberingRoot = this.plugin.getProjectFolder();
    if (numberingRoot) {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.numbering"))
          .setIcon("list-ordered")
          .onClick(() => new NumberingModal(this.app, this.plugin, numberingRoot).open())
      );
      menu.addSeparator();
    }

    menu.addItem((item) =>
      item
        .setTitle(t("binder.display.moreOptions"))
        .setIcon("settings")
        .onClick(() => {
          const app = this.app as unknown as AppWithSettingTab;
          app.setting.open();
          app.setting.openTabById(this.plugin.manifest.id);
        })
    );
  }

  /** Menu du clic droit sur l'icône "Double volet" : quel champ prévisualiser
   * dans le volet fichiers, puis l'Affichage transversal (voir
   * buildDisplayOptionsMenu). Le choix des volets visibles (double/dossiers
   * seuls/fichiers seuls) vit désormais dans des boutons directs de la barre
   * d'actions (voir render()), plus dans ce menu. */
  currentSplitMode(): "files" | "folders" | "both" {
    const S = this.plugin.settings;
    return S.binderTreeCollapsed ? "files" : S.binderListCollapsed ? "folders" : "both";
  }

  /** Bascule le double volet sur "both"/"folders"/"files" — utilisée par le
   * menu du clic droit ET par les boutons directs de la barre d'actions
   * (voir render()). Passe en double volet si on n'y était pas encore. */
  async applySplitPaneMode(mode: "files" | "folders" | "both"): Promise<void> {
    const S = this.plugin.settings;
    S.binderLayout = "split";
    S.binderTreeCollapsed = mode === "files";
    S.binderListCollapsed = mode === "folders";
    await this.plugin.saveSettings();
    void this.render(true);
    this.plugin.adjustSidebarWidth();
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  showSplitPaneOptionsMenu(e: MouseEvent): void {
    const S = this.plugin.settings;
    const effectiveBinderCompact = this.getEffectiveBinderCompact(this.getBinderCompactScope());
    const menu = new Menu();

    /* Pas de choix de densité ici : bascule directe sur le bouton Densité
       lui-même (un clic), inutile de la dupliquer dans ce menu. */
    menu.addItem((item) => item.setTitle(t("binder.preview.header")).setDisabled(true));
    /* Ajustement "aperçu du Binder" : jamais synopsis ET summary ensemble,
       jamais notes/tags — seuls "Aucun"/"Extrait"/le champ sémantique du
       mode courant sont proposés (voir binderPreviewFieldChoices,
       utils/binder-preview.ts). Une ancienne valeur "tags"/"notes"/l'AUTRE
       champ sémantique reste en donnée mais se résout ici sur ce même
       choix affiché (voir resolveBinderPreviewField pour l'état "coché"). */
    const semanticField = this.getBinderPreviewSemanticField();
    const fieldLabels: Record<string, string> = {
      none: t("binder.preview.none"),
      extrait: t("binder.preview.excerpt"),
      synopsis: t("binder.preview.synopsis"),
      summary: t("binder.preview.summary"),
    };
    const effectiveField = resolveBinderPreviewField(S.listPanePreviewField, semanticField);
    for (const key of binderPreviewFieldChoices(semanticField)) {
      menu.addItem((item) =>
        item
          .setTitle(fieldLabels[key])
          .setChecked(effectiveField === key)
          .onClick(async () => {
            S.listPanePreviewField = key;
            await this.plugin.saveSettings();
            void this.render(true);
          })
      );
    }
    menu.addSeparator();

    if (!effectiveBinderCompact && effectiveField !== "none") {
      menu.addItem((item) => item.setTitle(t("binder.preview.linesHeader")).setDisabled(true));
      /* Ajustement "aperçu du Binder" : au maximum 3 lignes désormais (une
         ancienne valeur >3 encore en donnée reste simplement bornée au
         rendu, voir renderFileRow / clampBinderPreviewLines). */
      const currentLines = clampBinderPreviewLines(S.listPanePreviewLines);
      for (let n = 1; n <= 3; n++) {
        menu.addItem((item) =>
          item
            .setTitle(String(n))
            .setChecked(currentLines === n)
            .onClick(async () => {
              S.listPanePreviewLines = n;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();
    }

    this.buildDisplayOptionsMenu(menu);
    menu.showAtMouseEvent(e);
  }

  /** Menu du clic droit sur le bouton « Carte » du Binder : ouvre le Board en
   *  ARRIÈRE-PLAN dans un des 4 modes (Cartes/Plan/Chemin de fer/Chronologie)
   *  via openBoardModeInBackground — le clic gauche continue d'appeler
   *  activateBoard() strictement inchangé. Le menu partagé des Cartes (clic
   *  droit, section 1) n'est jamais dupliqué ici : ce sont deux surfaces
   *  différentes. */
  showBoardModesMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const [mode] of BOARD_MODES) {
      menu.addItem((item) =>
        item
          .setTitle(t(`board.mode.${mode}`))
          .onClick(() => void this.plugin.openBoardModeInBackground(mode as BoardModeKey))
      );
    }
    menu.showAtMouseEvent(e);
  }

  /** `resetScroll: true` (voir isolateFolder) : n'essaie pas de restaurer la
   * position de défilement d'AVANT ce rendu — sur un changement de branche
   * (isolation), ce décalage en pixels ne correspond plus à rien de sensé
   * dans la nouvelle liste ; on affiche son tout début à la place. Par
   * défaut (repli/dépli, simple clic, rafraîchissement de fond…), la
   * position actuelle est toujours conservée — voir _captureScroll/
   * _restoreScroll. */
  async render(force = false, opts: { resetScroll?: boolean } = {}): Promise<void> {
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    /* Position de défilement mémorisée AVANT de vider le DOM, restaurée en
       fin de reconstruction : un rafraîchissement de fond (modification dans
       le coffre, changement de fichier actif…) reconstruit tout le binder et
       renvoyait sinon la liste tout en haut alors qu'on lisait plus bas. */
    const savedScroll = opts.resetScroll ? [] : this._captureScroll();
    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-container");

    const folder = this.getProjectFolder();
    const S = this.plugin.settings;
    const binderPreviewSemantic = this.getBinderPreviewSemanticField();
    /* Racine de travail (projet complet, ou dossier isolé — voir
       scope partagé) calculée UNE SEULE FOIS ici et réutilisée plus bas pour
       renderHierarchyBody. */
    const workingRoot = folder ? (this.getBinderWorkingRoot(folder) || folder) : null;
    const binderCompactScope = folder && workingRoot && workingRoot.path !== folder.path ? workingRoot.path : null;
    const effectiveBinderCompact = this.getEffectiveBinderCompact(binderCompactScope);
    const draftsFolder = folder ? getDraftsFolder(this.app, folder) : null;

    const header = container.createDiv({ cls: "feuillets-header" });
    const actions = header.createDiv({ cls: "feuillets-actions" });
    this.iconBtn(actions, "notebook", t("binder.notebookTooltip"), () =>
      this.plugin.generateCanvasBoard()
    );
    this.barSep(actions);
    /* Clique gauche : activateBoard() strictement inchangé ; clique droit :
       ouvrir le Board EN ARRIÈRE-PLAN dans un mode précis
       (showBoardModesMenu). */
    const boardBtn = this.iconBtn(actions, "layout-grid", t("binder.boardPlan"), () =>
      this.plugin.activateBoard()
    );
    boardBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showBoardModesMenu(e);
    });
    this.barSep(actions);
    /* CORRECTIF FINAL — double vue = Library opérable + Binder 2.5 unique
       (§2) : UN SEUL bouton de vue, `columns-2`, état exclusif sur
       S.binderLayout ("tree" = simple, "split" = double). Remplace les deux
       boutons adjacents [Vue simple][Double vue] du chantier précédent —
       plus jamais de bouton `list` dédié à la vue simple. Tooltip
       dynamique : "Passer en double vue" / "Revenir à la vue simple".
       adjustSidebarWidth() est rappelé tout de suite ET après un court
       délai (même patron que toggleTreeCollapsedClasses) — l'appel
       immédiat ne suffit pas toujours, l'API interne setSize() semblant
       parfois ignorer un appel fait dans la même passe qu'un rendu complet. */
    const layoutModeBtn = this.iconBtn(
      actions,
      "columns-2",
      S.binderLayout === "split" ? t("binder.mode.simpleTooltip") : t("binder.splitPane.tooltip"),
      async () => {
        S.binderLayout = S.binderLayout === "split" ? "tree" : "split";
        if (S.binderLayout === "split") {
          S.binderTreeCollapsed = false;
          S.binderListCollapsed = false;
        }
        await this.plugin.saveSettings();
        void this.render(true);
        this.plugin.adjustSidebarWidth();
        window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
      }
    );
    if (S.binderLayout === "split") layoutModeBtn.addClass("feuillets-mode-active");
    this.barSep(actions);
    /* Pas de "Mode concentration" ici : déjà une icône de ruban permanente
       (non masquable, voir registerRibbonIcons) et une commande de
       palette — la répéter dans le binder n'ajoute aucun accès réel.
       Les options d'aperçu (densité, aperçu de la fiche) restent
       accessibles depuis le clic droit sur Densité (showSplitPaneOptionsMenu). */
    const densityBtn = this.iconBtn(actions, "rows-3", t("binder.density.tooltip", { mode: effectiveBinderCompact ? t("binder.density.compact") : t("binder.density.standard") }), async () => {
      /* Isolé : bascule un override de SESSION propre à cette racine de
         travail (jamais settings.binderCompact, jamais persisté) — le
         Binder normal et les autres dossiers isolés restent inchangés.
         Non isolé : comportement actuel exact, settings.binderCompact. */
      if (binderCompactScope) {
        if (!this._binderCompactOverrides) this._binderCompactOverrides = new Map();
        this._binderCompactOverrides.set(binderCompactScope, !effectiveBinderCompact);
        void this.render(true);
      } else {
        S.binderCompact = !S.binderCompact;
        await this.plugin.saveSettings();
        void this.render(true);
      }
    });
    if (effectiveBinderCompact) densityBtn.addClass("feuillets-mode-active");
    densityBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showSplitPaneOptionsMenu(e);
    });

    /* Pas de bouton "+" global dans la barre d'actions : en vue double
       volet, l'ajout se fait directement dans chaque volet (le "+" à côté
       du nom du dossier projet dans le volet gauche crée un dossier, le
       "+" du volet fichiers crée un feuillet dans le dossier sélectionné
       — voir renderSplitBody). En vue arbre, chaque ligne de dossier a son
       propre "+" pour créer un sous-dossier/feuillet à l'intérieur (voir
       renderLevel plus bas). "Importer un plan…" reste accessible via la
       palette de commandes et via le "+" racine du volet dossiers. */
    if (!folder) {
      /* Écran d'accueil (titre + 3 actions) seulement au tout premier
         lancement — aucun projet n'a jamais été créé ni ajouté. Dès qu'un
         SEUL projet est connu (même si on vient d'en désactiver un), le
         gestionnaire de projets (liste + hub) reste plus utile : "premier
         projet" ne voudrait plus rien dire. */
      if (hasKnownProject(S)) {
        this.renderProjectManagerSplitView(container, S);
      } else {
        this.renderOnboarding(container);
      }
      return;
    }

    this.barSep(header);
    const filterBar = header.createDiv({ cls: "feuillets-binder-filters" });

    const searchIsOpen =
      this._binderSearchOpen || !!(S.binderSearch || "").trim();
    const searchBtn = this.iconBtn(filterBar, "search", t("binder.search.tooltip"));
    searchBtn.addEventListener("click", () => {
      this._binderSearchOpen = !this._binderSearchOpen;
      if (!this._binderSearchOpen) {
        S.binderSearch = "";
        void this.plugin.saveSettings().then(() => { void this.render(true); });
      } else {
        void this.render(true);
        window.setTimeout(() => {
          this.contentEl.querySelector<HTMLElement>(".feuillets-binder-search")?.focus();
        }, 50);
      }
    });
    if (searchIsOpen) searchBtn.addClass("feuillets-mode-active");

    /* Filtres combinés (ET logique) : statut × label × progression —
       même patron que le menu "Filtres" du Tableau/plan (board-view.js),
       propres au binder (réglages binderStatusFilter/binderLabelFilter/
       binderProgressFilter, indépendants de ceux du Tableau/plan). */
    const binderFilterIsActive = () =>
      !!((S.binderStatusFilter && normalizeFilterSentinel(S.binderStatusFilter) !== "all") ||
      (S.binderLabelFilter && normalizeFilterSentinel(S.binderLabelFilter) !== "all") ||
      (S.binderProgressFilter && normalizeFilterSentinel(S.binderProgressFilter) !== "all"));

    const filterBtn = this.iconBtn(
      filterBar,
      binderFilterIsActive() ? "filter" : "list-filter",
      t("binder.filter.tooltip")
    );
    if (binderFilterIsActive()) filterBtn.addClass("feuillets-mode-active");
    /* Accepts a legacy French sentinel, its legacy English equivalent, or
       an already-stable id (services/project-taxonomy.ts normalizeFilter-
       Sentinel) — a real status/label/progress value passes through
       unchanged. `noneKey` disambiguates the shared "none" id between
       status ("no status") and label ("no label") — see board-view.ts's
       own filterSentinelLabel for the identical pattern. */
    const filterSentinelLabel = (v: string, noneKey?: string) => {
      const normalized = normalizeFilterSentinel(v);
      if (normalized === "all") return t("binder.filter.all");
      if (normalized === "none") return noneKey ? t(noneKey) : v;
      if (normalized === "hit") return t("binder.filter.progressHit");
      if (normalized === "under") return t("binder.filter.progressUnder");
      if (normalized === "over") return t("binder.filter.progressOver");
      return v;
    };
    filterBtn.addEventListener("click", (e: MouseEvent) => {
      const menu = new Menu();

      menu.addItem((item) => item.setTitle(t("binder.filter.statusHeader")).setDisabled(true));
      /* The stored/compared filter value is always statusStoredValue(entry):
         the stable id for a built-in status, the literal name for a
         legacy/custom one — matching whatever a scene's own `status:`
         frontmatter actually contains once assigned through
         makeStatusSelect/the context menu (base-feuillets-view.ts) or the
         card menu (board-view.ts). Only the menu item's text is
         translated (statusDisplayLabel); a legacy/custom entry keeps
         showing and storing its own name unchanged. draftFiles' own
         scanned status values are already the exact stored form — no
         transformation needed. */
      const statusDisplayByValue = new Map<string, string>();
      for (const status of workspaceStatuses(this.app, S, folder)) {
        const value = statusStoredValue(status).trim();
        if (value) statusDisplayByValue.set(value, statusDisplayLabel(status, getLocale()));
      }
      const effectiveStatuses = [...new Set([
        ...workspaceStatuses(this.app, S, folder).map((status) => statusStoredValue(status).trim()),
        ...draftFiles.map((file) => toValue(this.fm(file).status).trim()),
      ])].filter(Boolean);
      for (const s of ["all", ...effectiveStatuses, "none"]) {
        menu.addItem((item) =>
          item
            .setTitle(statusDisplayByValue.get(s) ?? filterSentinelLabel(s, "binder.filter.noStatus"))
            .setChecked(normalizeFilterSentinel(S.binderStatusFilter || "all") === s)
            .onClick(async () => {
              S.binderStatusFilter = s;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();

      const activeLabels = new Set<string>();
      const walkLabels = (f: TFolder) => {
        for (const child of this.plugin.getOrderedChildren(f)) {
          if (child instanceof TFile) {
            for (const label of this.plugin.labelsOf(child)) activeLabels.add(label);
          } else if (child instanceof TFolder) {
            walkLabels(child);
          }
        }
      };
      if (folder) walkLabels(folder);
      for (const file of draftFiles) {
        for (const label of this.plugin.labelsOf(file)) activeLabels.add(label);
      }
      const labelsList = workspaceLabels(this.app, S, folder);
      const labelDisplayByValue = new Map<string, string>();
      labelsList.forEach((l) => {
        const value = labelStoredValue(l).trim();
        if (value) {
          activeLabels.add(value);
          labelDisplayByValue.set(value, labelDisplayLabel(l, getLocale()));
        }
      });
      const labelList = Array.from(activeLabels).sort((a, b) => a.localeCompare(b, getLocale()));

      menu.addItem((item) => item.setTitle(t("binder.filter.labelHeader")).setDisabled(true));
      for (const lb of ["all", ...labelList, "none"]) {
        menu.addItem((item) =>
          item
            .setTitle(labelDisplayByValue.get(lb) ?? filterSentinelLabel(lb, "binder.filter.noLabel"))
            .setChecked(normalizeFilterSentinel(S.binderLabelFilter || "all") === lb)
            .onClick(async () => {
              S.binderLabelFilter = lb;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();

      menu.addItem((item) => item.setTitle(t("binder.filter.progressHeader")).setDisabled(true));
      for (const pr of ["all", "hit", "under", "over"] as const) {
        menu.addItem((item) =>
          item
            .setTitle(filterSentinelLabel(pr))
            .setChecked(normalizeFilterSentinel(S.binderProgressFilter || "all") === pr)
            .onClick(async () => {
              S.binderProgressFilter = pr;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }

      if (binderFilterIsActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle(t("binder.filter.reset"))
            .setIcon("filter-x")
            .onClick(async () => {
              S.binderStatusFilter = "all";
              S.binderLabelFilter = "all";
              S.binderProgressFilter = "all";
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    if ((S.binderSearch || "").trim() || binderFilterIsActive()) {
      const resetBtn = this.iconBtn(
        filterBar,
        "x",
        t("binder.filter.resetSearchAndFilters")
      );
      resetBtn.addEventListener("click", () => {
        void (async () => {
          S.binderSearch = "";
          S.binderStatusFilter = "all";
          S.binderLabelFilter = "all";
          S.binderProgressFilter = "all";
          this._binderSearchOpen = false;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
    }

    /* Barre de recherche sur sa propre ligne, sous la barre d'icônes —
       plus lisible qu'un champ étriqué inséré entre les icônes. */
    if (searchIsOpen) {
      const searchRow = container.createDiv({ cls: "feuillets-binder-search-row" });
      const searchInput = searchRow.createEl("input", {
        type: "text",
        cls: "feuillets-binder-search",
        attr: { placeholder: t("binder.search.placeholder") },
      });
      searchInput.value = S.binderSearch || "";
      let searchTimer: number;
      searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        const caret = searchInput.selectionStart;
        searchTimer = window.setTimeout(() => {
          void (async () => {
            S.binderSearch = searchInput.value;
            await this.plugin.saveSettings();
            await this.render(true);
            const fresh = this.contentEl.querySelector<HTMLInputElement>(".feuillets-binder-search");
            if (fresh) {
              fresh.focus();
              fresh.setSelectionRange(caret, caret);
            }
          })();
        }, 200);
      });
      searchInput.addEventListener("blur", () => {
        /* Un blur peut venir d'un vrai clic ailleurs (fermeture voulue si
           champ vide) OU du fait que ce même champ vient d'être détruit par
           un render(true) déclenché par un AUTRE contrôle de cette ligne
           (ex. contentToggle ci-dessous) — retirer un élément focus du DOM
           déclenche un blur natif, même avec preventDefault sur mousedown.
           Le drapeau _suppressSearchBlurClose distingue ce second cas. */
        if (this._suppressSearchBlurClose) {
          this._suppressSearchBlurClose = false;
          return;
        }
        if (!searchInput.value.trim()) {
          this._binderSearchOpen = false;
          void this.render(true);
        }
      });

      /* Sélecteur de contexte : titre seul ou titre + contenu du texte
         (S.binderSearchContent existait déjà comme réglage caché, jamais
         exposé dans l'UI avant ce bouton). */
      const contentToggle = this.iconBtn(
        searchRow,
        S.binderSearchContent ? "file-search" : "file",
        S.binderSearchContent ? t("binder.search.contentToggle.on") : t("binder.search.contentToggle.off")
      );
      if (S.binderSearchContent) contentToggle.addClass("feuillets-mode-active");
      contentToggle.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
      contentToggle.addEventListener("click", () => {
        void (async () => {
          this._suppressSearchBlurClose = true;
          S.binderSearchContent = !S.binderSearchContent;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
    }

    const searchTerm = foldAccents((S.binderSearch || "").trim());
    let contentIndex: Map<string, { text: string }> | null = null;
    const projectFiles = folder ? this.plugin.flattenFiles(folder) : [];
    const draftFiles = draftsFolder ? this.plugin.flattenFiles(draftsFolder) : [];
    const binderFiles = [...new Map(
      [...projectFiles, ...draftFiles].map((file) => [file.path, file])
    ).values()];
    if (searchTerm && S.binderSearchContent && folder) {
      contentIndex = await this.buildSearchIndex(
        binderFiles
      );
      if (this._renderGen !== myGen) return;
    }

    const passesBinderFilter = (file: TFile): boolean => {
      const search = searchTerm;
      if (search) {
        const hay = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        );
        let found = hay.includes(search);
        if (!found && contentIndex) {
          const entry = contentIndex.get(file.path);
          if (entry && entry.text.includes(search)) found = true;
        }
        if (!found) return false;
      }
      /* normalizeFilterSentinel is a no-op for a real status/label/progress
         value — it only recognizes the "all"/"none"/"hit"/"under"/"over"
         sentinels and their legacy French/English spellings — so this
         still compares the exact stored value against frontmatter for a
         genuine choice, unchanged from before. */
      const sf = normalizeFilterSentinel(S.binderStatusFilter || "all");
      if (sf && sf !== "all") {
        const st = toValue(this.fm(file).status);
        if (sf === "none" ? st !== "" : st !== sf) return false;
      }
      const lf = normalizeFilterSentinel(S.binderLabelFilter || "all");
      if (lf && lf !== "all") {
        const labels = this.plugin.labelsOf(file);
        if (lf === "none" ? labels.length !== 0 : !labels.includes(lf)) return false;
      }
      const pf = normalizeFilterSentinel(S.binderProgressFilter || "all");
      if (pf && pf !== "all") {
        const entry = wcCache.get(file.path);
        const goal = this.goalFor(file);
        if (entry !== undefined && goal > 0) {
          const state = this.ringState(entry.wc, goal, file.parent);
          if (pf === "hit" && state !== "hit") return false;
          if (pf === "under" && state !== "under") return false;
          if (pf === "over" && state !== "over") return false;
        } else if (goal <= 0) {
          return false;
        }
      }
      return true;
    };

    const binderFilterActive =
      (S.binderSearch || "").trim() !== "" || binderFilterIsActive();

    const folderHasMatch = (f: TFolder): boolean => {
      for (const file of this.plugin.flattenFiles(f)) {
        if (passesBinderFilter(file)) return true;
      }
      return false;
    };

    const numbering = folder ? this.plugin.buildNumbering(folder) : new Map<string, string>();
    const wcCache = await this.plugin.getWordCounts(binderFiles);
    if (this._renderGen !== myGen) return;

    /* Folder progress bars (binderShowProgress on a TFolder row, see
       renderHierarchyContents): a folder's word count is the sum of its
       descendant sheets' counts, exactly `wordCountOfFolder()`'s own
       semantics — but computed here from the wcCache already fetched above,
       never a second async read per folder row (that would be an O(folder
       count) burst of vault reads on a large manuscript). One pass over the
       already-resolved files, walking each file's ancestor chain (already
       in memory via `.parent`), accumulates every ancestor folder's total in
       a single O(files × depth) sweep. */
    const folderWordTotals = new Map<string, number>();
    for (const file of binderFiles) {
      const entry = wcCache.get(file.path);
      if (!entry) continue;
      for (let ancestor = file.parent; ancestor; ancestor = ancestor.parent) {
        folderWordTotals.set(ancestor.path, (folderWordTotals.get(ancestor.path) || 0) + entry.wc);
      }
    }

    /* Instantané capturé UNE FOIS pour tout ce rendu — strict (§3 du
       micro-lot "sélection continu par clic simple") : Continu compatible
       uniquement si sa leaf est RÉELLEMENT active, voir
       activeContinuMembershipView. refreshContinuMembershipHighlight()
       (appelée par active-leaf-change/layout-change, voir onOpen) reste
       seule responsable de suivre un changement de leaf active ou une
       ouverture/fermeture de Continu survenue APRÈS ce rendu, sans
       reconstruire le Binder. */
    const continuView = this.activeContinuMembershipView();

    const renderFileRow: RenderFileRow = (
      host,
      file,
      parent,
      i,
      siblings,
      depth,
      dragScopeEl,
      opts = {}
    ) => {
      const revealDraft = opts.revealProjectDraft === true && isProjectDraft(folder, file);
      const hidden =
        file.name.startsWith("_") ||
        parent.name.startsWith("_") ||
        parent.path.includes("/_");
      const visible = revealDraft && draftsFolder && (
        parent.path === draftsFolder.path || parent.path.startsWith(`${draftsFolder.path}/`)
      );
      const effectivelyHidden = hidden && !visible;
      if (!effectivelyHidden && !passesBinderFilter(file)) return false;

      const role = effectivelyHidden ? "cachee" : this.plugin.roleOfFile(file);
      const item = host.createDiv({
        cls:
          role === "scene"
            ? "feuillets-item feuillets-scene"
            : role === "cachee"
            ? "feuillets-item feuillets-hidden"
            : "feuillets-item",
      });
      /* Indentation par profondeur (LOT FINAL Binder ↔ Continu, §15-16) :
         une seule variable CSS `--feuillets-binder-depth`, calc() en CSS
         (styles.css) — jamais un jeu de classes depth-1/depth-2/etc. Le
         `depth` reçu ici est désormais EXACTEMENT le même que celui de la
         ligne dossier qui le contient (voir renderTreeFolders) : un
         feuillet aligne sa colonne chevron/icône/titre sur celle d'un
         dossier du même niveau, jamais un décalage codé en dur en plus. */
      item.style.setProperty("--feuillets-binder-depth", String(depth));
      item.setAttr("data-path", file.path);
      /* Focusable (sans entrer dans l'ordre de tabulation) : un clic sur
         la ligne lui donne le focus DOM, condition nécessaire pour que les
         flèches haut/bas (voir onOpen) remontent bien jusqu'au conteneur
         du Binder — un <div> sans tabindex ne reçoit jamais le focus, même
         cliqué, et les touches ne remontent alors jamais jusqu'ici. */
      item.setAttr("tabindex", "-1");

      /* Colonne chevron réservée (§16 du LOT FINAL Binder ↔ Continu) : un
         feuillet n'a pas de chevron fonctionnel, mais réserve la même
         largeur qu'un dossier du même niveau pour que les colonnes
         icône/titre restent alignées, jamais de zigzag. */
      item.createSpan({ cls: "feuillets-folder-chevron is-empty" });

      let labelColor: string | null = null;
      if (!effectivelyHidden && S.binderShowLabels) {
        const labelName = this.plugin.labelOf(file);
        const labelFolder = revealDraft ? folder : parent instanceof TFolder ? parent : file.parent;
        labelColor = labelName ? this.plugin.labelColor(labelName, labelFolder) : null;
      }
      /* Micro-lot "simplification définitive du Binder", §4 : le liseré de
         label appartient désormais au NŒUD (petit emplacement dédié juste
         avant l'icône fichier), plus au bord du panneau — l'ancien
         `item.style.boxShadow` posé sur toute la ligne est retiré. Emplacement
         réservé sur TOUTES les lignes fichiers dès que l'affichage des labels
         est actif (alignement des icônes identique avec/sans label) ; absent
         du DOM quand l'affichage des labels est désactivé. */
      if (S.binderShowLabels) {
        const swatch = item.createSpan({ cls: "feuillets-label-swatch" });
        if (labelColor) {
          swatch.addClass("has-label");
          swatch.style.setProperty("--feuillets-label-color", labelColor);
        }
      }
      this.buildBinderNodeIcon(item, "file-text", labelColor);

      const body = item.createDiv({ cls: "feuillets-item-body" });
      const nameRow = body.createDiv({ cls: "feuillets-item-name-row" });

      const num = effectivelyHidden ? "" : `${numbering.get(file.path) || ""} `;
      const nameSpan = nameRow.createSpan({ cls: "feuillets-item-name" });
      nameSpan.setText(`${num}${this.plugin.shortTitleFor(file)}`);
      /* Double-click on the NAME ONLY (never the whole row): toggles the
         same `_visibleHeadingOutlinePaths` truth as the file's context menu
         (toggleHeadingOutlineForFile) — a file with no heading is a silent
         no-op there. A held modifier key means some other historical
         gesture might be in play, so this returns without
         preventDefault/stopPropagation, never intercepting it. No timer:
         the single click(s) that precede a real double-click still open the
         file exactly as before. */
      nameSpan.addEventListener("dblclick", (e) => {
        if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.toggleHeadingOutlineForFile(file);
      });

      if (!effectivelyHidden && searchTerm && contentIndex) {
        const inTitle = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        ).includes(searchTerm);
        if (!inTitle) {
          const badge = nameRow.createSpan({ cls: "feuillets-search-badge" });
          setIcon(badge, "text-search");
          badge.setAttr("title", t("binder.item.foundInBody"));
        }
      }

      /* Optional status dot + progress ring, same title line as the name
         above — see renderBinderIndicators(). Never rendered for a hidden
         row (an underscore-prefixed folder's contents, or the revealed
         Drafts projection's own housekeeping files). */
      if (!effectivelyHidden) {
        this.renderBinderIndicators(nameRow, {
          statusValue: toValue(this.fm(file).status).trim(),
          contextFolder: file.parent,
          wc: wcCache.get(file.path)?.wc ?? 0,
          goal: this.goalFor(file),
        });
      }

      /* Mode compact (voir showSplitPaneOptionsMenu) : aucun aperçu, quel
         que soit le champ choisi — la densité prime, l'aperçu se consulte
         en mode standard. Ajustement "aperçu du Binder" : la valeur brute
         sauvegardée (`S.listPanePreviewField`, potentiellement une ancienne
         donnée "tags"/"notes"/un champ sémantique d'un AUTRE mode) est
         résolue au rendu vers la grammaire actuelle — jamais migrée sur
         disque (voir resolveBinderPreviewField, utils/binder-preview.ts). */
      const effectiveField = resolveBinderPreviewField(S.listPanePreviewField, binderPreviewSemantic);
      const headingOutlineVisible = this._visibleHeadingOutlinePaths.has(file.path)
        && headingOutlineForFile(this.app, file).length > 0;
      const previewTitleEmphasized =
        !effectivelyHidden
        && !effectiveBinderCompact
        && opts.showPreview === true
        && effectiveField !== "none";
      const previewExpanded = previewTitleEmphasized && !headingOutlineVisible;
      item.toggleClass("feuillets-item-has-preview", previewExpanded);
      item.toggleClass("feuillets-item-preview-title", previewTitleEmphasized);
      if (previewExpanded) {
        /* §5 : le Binder ne doit jamais devenir une fiche — l'aperçu est
           borné à 3 lignes maximum, quelle que soit une ancienne valeur
           enregistrée (`listPanePreviewLines` peut encore dépasser 3,
           donnée non migrée intentionnellement, voir buildDisplayOptionsMenu). */
        const lines = clampBinderPreviewLines(S.listPanePreviewLines);
        if (effectiveField === "extrait") {
          const prev = body.createDiv({ cls: "feuillets-item-preview" });
          prev.style.maxHeight = `${lines * 1.3}em`;
          void this.app.vault.cachedRead(file).then((content) => {
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            const limit = Number(S.excerptLength) || 420;
            const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
            prev.setText(clean || t("binder.item.emptyPreview"));
          });
        } else {
          // effectiveField ne peut plus valoir que "synopsis" ou "summary"
          // ici (jamais "tags"/"notes", retirés de la grammaire Binder —
          // voir resolveBinderPreviewField).
          const text = toValue(this.fm(file)[effectiveField]).trim();
          if (text) {
            const prev = body.createDiv({ cls: "feuillets-item-preview" });
            prev.style.maxHeight = `${lines * 1.3}em`;
            prev.setText(text);
          }
        }
      }

      /* Micro-lot "repère d'avancement sans dashboard" : la grammaire de la
         ligne reste titre + aperçu facultatif + indicateurs compacts
         (statut/progression, voir renderBinderIndicators just above) — les
         puces de tags et le nombre de mots en chiffres, eux, ne sont
         toujours jamais rendus ici. Ces métadonnées restent entièrement
         disponibles ailleurs (Cartes, Plan, filtres, propriétés) et leurs
         réglages historiques (`binderShowTags`/`binderShowWords`) restent en
         place pour la compatibilité des données sauvegardées, simplement
         toujours inertes pour ce rendu — voir buildDisplayOptionsMenu. */

      item.setAttr("data-path", file.path);

      if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(file.path)) {
        item.addClass("is-selected");
      }

      /* Surbrillance de session "membre du Continu" (§8 du micro-lot
         "sélection continu par clic simple") — jamais sur une ligne
         cachée/dossier, jamais persistée, jamais stockée dans
         `_binderMultiSelect` : simple reflet de `continuView.hasMember(path)`
         au moment de CE rendu (`continuView` capturé une fois plus haut, via
         activeContinuMembershipView — voir §3). Resynchronisée ensuite par
         refreshContinuMembershipHighlight (active-leaf-change/layout-change,
         voir onOpen), sans jamais reconstruire cette ligne. */
      if (!hidden && continuView) {
        item.toggleClass("is-continu-member", continuView.hasMember(file.path));
      }

      /* Micro-chantier finition Continu, §16-18 : complément défensif au
         `user-select: none` déjà posé sur `.feuillets-item-preview`
         (styles.css) — un Maj+clic ou un Cmd/Ctrl+clic ne doit JAMAIS
         démarrer, en plus de la sélection Binder, une sélection native du
         texte de l'aperçu. Purement préventif : ne pilote AUCUNE sélection
         (toute la logique reste dans le `click` ci-dessous, jamais
         déclenchée deux fois).
         Correctif multi-drag : voir shouldPreventMultiSelectMousedown
         (base-feuillets-view.ts) pour la raison précise de la garde — un
         membre déjà sélectionné ne doit plus voir son mousedown bloqué,
         sinon le dragstart natif ne peut jamais démarrer quand Cmd/Ctrl
         reste enfoncé en passant du clic de sélection au glisser. */
      item.addEventListener("mousedown", (e) => {
        if (this.shouldPreventMultiSelectMousedown(e, file.path, hidden)) e.preventDefault();
      });

      item.addEventListener("click", (e) => {
        /* Correctif final multi-drag — Option/Alt+clic = sélection de
           RÉORGANISATION Binder, séparée à 100% des gestes Continu.
           Traité EN PREMIER, avant toute branche Cmd/Ctrl/Maj : ne
           preventDefault/stopPropagate QUE ce geste précis, ne touche
           jamais `continu`/`is-continu-member`/setMembers/promotion. Sur
           une ligne cachée, retombe intégralement sur le chemin
           historique ci-dessous (comme les autres branches). */
        if (!effectivelyHidden && e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleBinderReorderSelection(file.path, parent.path, i, dragScopeEl);
          return;
        }

        /* LOT FINAL Binder ↔ Continu — grammaire Scrivener (§2-10) :
           - Cmd/Ctrl+clic : toggle individuel (§8), pilote RÉELLEMENT
             Continu via setMembers() désormais (jamais plus seulement
             `_binderMultiSelect`) ; depuis un MarkdownView actif, promeut la
             MÊME leaf en Continu (§9) ;
           - Maj+clic (Continu actif) : plage qui peut s'agrandir ET se
             réduire (§5/§7), une seule recomposition via setMembers() ;
           - clic simple (Continu actif) : ouvre CE fichier seul, MÊME leaf,
             quelle que soit la taille du groupe ou l'appartenance
             préalable (§3-4) — n'est plus jamais un toggleMember().
           Rien de tout cela sur une ligne cachée/dossier : `continu` reste
           `null` pour elles, le clic retombe alors intégralement sur le
           chemin historique ci-dessous. */
        const continu = !effectivelyHidden ? this.activeContinuMembershipView() : null;

        if (!effectivelyHidden && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();

          if (continu) {
            /* §8 : la vérité est `continu.getMemberPaths()`, jamais
               `_binderMultiSelect` — construit `nextPaths` puis UNE seule
               recomposition. */
            const current = continu.getMemberPaths();
            const next = current.includes(file.path)
              ? current.filter((p) => p !== file.path)
              : [...current, file.path];
            void continu.setMembers(next).then(() => {
              this.refreshContinuMembershipHighlight();
            });
            return;
          }

          /* §9 : pas de Continu actif — tenter la promotion depuis le
             MarkdownView réellement affiché par la leaf centrale. Échec
             (pas de MarkdownView exploitable, même fichier déjà actif…) :
             retombe sur le chemin historique `_binderMultiSelect` (§10),
             inchangé. */
          void this.tryPromoteCmdClickToContinu(file).then((promoted) => {
            if (!promoted) this.handleMultiSelectClick(e, file, parent, i, siblings, dragScopeEl);
          });
          return;
        }

        if (!effectivelyHidden && e.shiftKey && continu) {
          e.preventDefault();
          e.stopPropagation();

          /* §5/§7 : `handleMultiSelectClick` historique calcule la plage
             depuis son ancre existante — seulement comme OUTIL TEMPORAIRE :
             la vérité de la composition Continu reste
             `session.document.segments`, jamais `_binderMultiSelect`.
             setMembers() REMPLACE toute la composition par cette plage :
             peut donc aussi bien l'agrandir QUE la réduire. */
          this.handleMultiSelectClick(e, file, parent, i, siblings, dragScopeEl);
          const sel = this.plugin._binderMultiSelect;
          const root = this.getProjectFolder();
          if (!sel || sel.size === 0 || !root) return;
          const scope = typeof this.plugin.compileScopeForSelection === "function"
            ? this.plugin.compileScopeForSelection([...sel])
            : createSelectionScope(root.path, [...sel]);
          if (!scope) return;
          const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
          const paths = files.map((f) => f.path);
          void continu.setMembers(paths).then(() => {
            sel.clear();
            this.refreshMultiSelectClasses(dragScopeEl);
            this.refreshContinuMembershipHighlight();
          });
          return;
        }

        if (!effectivelyHidden && !e.shiftKey && continu) {
          /* §3-4 : clic simple pendant que Continu est actif — abandonne la
             sélection multiple de travail, ouvre CE fichier seul dans
             EXACTEMENT la même leaf. Aucune nouvelle leaf, jamais de
             Continu reconstruit à N-1 segments. */
          e.preventDefault();
          e.stopPropagation();
          void continu.openSingleMember(file.path).then((opened) => {
            this.refreshContinuMembershipHighlight();
            if (opened) highlightActive(this.contentEl, file.path);
          });
          return;
        }

        /* Chemin historique (hors Continu, ou ligne cachée) : intégralement
           inchangé. */
        const consumed = this.handleMultiSelectClick(e, file, parent, i, siblings, dragScopeEl);
        if (consumed) {
          /* §2 du micro-lot delta : seul un Maj+clic (jamais Cmd/Ctrl+clic,
             qui reste sur son chemin historique intégral) tente la
             promotion automatique Markdown → Continu quand il vient de
             produire un groupe de 2+ fichiers — voir
             tryPromoteSelectionToContinu (conditions strictes §3-4). */
          if (e.shiftKey) void this.tryPromoteSelectionToContinu(dragScopeEl);
          return;
        }
        /* mis en surbrillance immédiatement, sans attendre les événements
           workspace ("active-leaf-change"/"file-open") : ceux-ci arrivent
           parfois après qu'un autre rendu ait déjà eu lieu, ou pendant que
           le focus transite encore vers la feuille de la scène cliquée —
           on connaît déjà le fichier ciblé, pas besoin de le redéduire. */
        highlightActive(this.contentEl, file.path);
        const leaf = this.plugin.getLeafForOpeningFile();
        const opening = openFileActivating(this.app, leaf, file);
        void this.app.workspace.revealLeaf(leaf);
        // LOT 3 — pont clic simple Binder → Preview existant : jamais un
        // second appel depuis Shift/Cmd/Ctrl/dossier (retournés plus haut) —
        // ces scopes multi/dossier/projet passent déjà par
        // ScriveningsView.openScope() (voir main.ts#syncExistingPreviewScope,
        // qui ne fait rien sans Preview déjà ouvert sur ce projet).
        if (folder) {
          const fileScope = (typeof this.plugin.compileScopeForFile === "function" ? this.plugin.compileScopeForFile(file) : null)
            ?? createFileScope(folder.path, file.path);
          void this.plugin.syncExistingPreviewScope?.(fileScope, null);
        }
        /* Bug fix "unstable Binder focus after a single click": openFileActivating
           moves the DOM focus to the editor, and until now the Binder focus was
           reclaimed after an ARBITRARY 60ms setTimeout — a race against the
           real, asynchronous end of leaf.openFile() (a heavier file, a slower
           CodeMirror mount, or a late Obsidian event could all still move focus
           back to the editor afterwards). Chaining on the REAL Promise returned
           by openFileActivating(), then waiting one animation frame, is
           deterministic: the Binder only reclaims focus once the file is
           genuinely open. `item` is this exact clicked row — no need to
           re-search ".feuillets-item.is-active" in the whole Binder DOM.
           `{ preventScroll: true }` avoids an unwanted Binder scroll jump on
           every single click. */
        void opening.then(() => {
          window.requestAnimationFrame(() => {
            item.focus({ preventScroll: true });
          });
        });
      });

      if (!effectivelyHidden) {
        this.attachDragHandlers(item, item, parent, i, siblings, dragScopeEl);
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.ensureSelectionForContextMenu(file.path, dragScopeEl);
          this.showFileContextMenu(e, file, parent, i, siblings, this.headingOutlineContextMenuExtras(file), true);
        });
      }
      return true;
    };

    if (folder && workingRoot) {
      const hierarchyCtx: SplitBodyCtx = {
        S,
        binderFilterActive,
        folderHasMatch,
        renderFileRow,
        projectRoot: folder,
        binderCompact: effectiveBinderCompact,
        revealDraftsFolder: draftsFolder,
        folderWordTotals,
      };
      if (S.binderLayout === "split") {
        this.renderSplitBody(container, folder, hierarchyCtx);
      } else {
        this.renderHierarchyBody(container, workingRoot, hierarchyCtx);
      }
    }

    /* updateActiveHighlight() peut déplacer le défilement (scrollIntoView
       sur le fichier actif — voir utils/dom.ts, highlightActive) : appelé
       APRÈS, _restoreScroll/_resetScroll a toujours le dernier mot, pour
       qu'un simple clic sur un dossier (repli/dépli, sélection…) ne fasse
       jamais sauter le Binder loin de sa position — voir _captureScroll. */
    this.updateActiveHighlight("render-end");
    this.refreshCurrentHeadingHighlight();
    if (opts.resetScroll) this._resetScroll();
    else this._restoreScroll(savedScroll);
  }

  /** Zones défilantes du binder, selon la mise en page : la liste racine
   * (vue arbre, enfant direct du conteneur) ou les deux volets (double
   * volet). Mémorise la position même à 0 : ne pas le faire laisserait
   * highlightActive() (scrollIntoView sur le fichier actif, appelé par
   * updateActiveHighlight à la fin de render) déplacer silencieusement le
   * défilement sans que rien ne le corrige ensuite — c'est précisément ce
   * qui faisait "sauter" le Binder en fin de liste sur un simple clic de
   * dossier alors qu'on était tout en haut.
   * ":scope > .feuillets-list" : uniquement la liste RACINE du binder (vue
   * arbre, enfant direct de contentEl) — un sélecteur descendant simple
   * attraperait aussi le `.feuillets-list` imbriqué du volet droit en
   * double vue (renderSplitBody, `.feuillets-list-pane > .feuillets-list`),
   * qui défile déjà via son propre `.feuillets-list-pane` ci-dessous. */
  _captureScroll(): { sel: string; top: number }[] {
    const out: { sel: string; top: number }[] = [];
    const sels = [":scope > .feuillets-list", ".feuillets-tree-pane", ".feuillets-list-pane"];
    for (const sel of sels) {
      const el = this.contentEl.querySelector(sel);
      if (el) out.push({ sel, top: el.scrollTop });
    }
    return out;
  }

  _restoreScroll(saved: { sel: string; top: number }[]): void {
    if (!saved || saved.length === 0) return;
    const apply = () => {
      for (const { sel, top } of saved) {
        const el = this.contentEl.querySelector(sel);
        if (el) el.scrollTop = top;
      }
    };
    apply(); // tout de suite : le DOM est déjà construit
    /* puis une 2e passe à la frame suivante — la hauteur défilable d'un
       volet peut n'être finalisée qu'après le prochain calcul de mise en
       page (largeur de barre latérale ajustée, images…), auquel cas le
       premier scrollTop serait plafonné trop bas. */
    window.requestAnimationFrame(apply);
  }

  /** Symétrique de _restoreScroll, pour une entrée en isolation (voir
   * isolateFolder) : la nouvelle racine de travail s'affiche depuis son
   * tout début plutôt que de conserver un décalage devenu arbitraire, et
   * annule là aussi tout scrollIntoView parasite de updateActiveHighlight. */
  _resetScroll(): void {
    const sels = [":scope > .feuillets-list", ".feuillets-tree-pane", ".feuillets-list-pane"];
    const apply = () => {
      for (const sel of sels) {
        const el = this.contentEl.querySelector(sel);
        if (el) el.scrollTop = 0;
      }
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  renderProjectManagerSplitView(container: HTMLElement, S: FeuilletsSettings): void {
    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth || 240}px`);

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth || 240;
      const onMove = (ev: MouseEvent) => {
        S.binderTreeWidth = Math.min(400, Math.max(140, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUpAsync = async () => {
        await this.plugin.saveSettings();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        void onUpAsync();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Left Pane Header: Projets
    const treeHeader = treePane.createDiv({ cls: "feuillets-folder-row feuillets-tree-root" });
    const rootIcon = treeHeader.createDiv({ cls: "feuillets-cell-icon" });
    setIcon(rootIcon, "folder-cog");
    treeHeader.createSpan({ cls: "feuillets-folder-name" }).setText(t("binder.projectManager.title"));

    const treeActions = treeHeader.createDiv({ cls: "feuillets-project-actions" });

    const newBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(newBtn, "folder-plus");
    newBtn.setAttr("aria-label", t("binder.projectManager.newProject"));
    newBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new NewProjectModal(this.app, this.plugin).open();
    });

    const importBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(importBtn, "import");
    importBtn.setAttr("aria-label", t("binder.projectManager.importScrivener"));
    importBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new ScrivenerImportModal(this.app, this.plugin).open();
    });

    // Project List
    const projectListEl = treePane.createDiv({ cls: "feuillets-project-list" });
    projectListEl.addClass("feuillets-project-list");

    const allProjects = (S.projects || []).concat(S.projectFolder ? [S.projectFolder] : [])
      .filter((p, i, a) => p && a.indexOf(p) === i)
      .sort((a, b) =>
        this.plugin.projectDisplayName(a).localeCompare(
          this.plugin.projectDisplayName(b), getLocale(), { sensitivity: "base" }
        )
      );

    if (allProjects.length === 0) {
      projectListEl
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("binder.projectManager.noProjects"));
    } else {
      for (const path of allProjects) {
        const folderObj = this.app.vault.getAbstractFileByPath(path);
        const folderExists = folderObj instanceof TFolder;
        const isActive = folderExists && path === S.projectFolder;
        const meta = S.projectMeta[path] || {};
        const row = projectListEl.createDiv({ cls: `feuillets-folder-row ${isActive ? "is-selected" : ""}` });
        row.addClass("feuillets-project-row-indent");

        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, !folderExists ? "alert-triangle" : (meta.icon as string) || (isActive ? "folder-open" : "folder"));

        const nameSpan = row.createSpan({ cls: "feuillets-folder-name" });
        nameSpan.setText(
          folderExists
            ? this.plugin.projectDisplayName(path)
            : t("binder.projectManager.notFound", { name: this.plugin.projectDisplayName(path) })
        );
        if (!folderExists) {
          nameSpan.addClass("feuillets-muted-italic");
        }

        const actionsEl = row.createDiv({ cls: "feuillets-project-actions" });
        const removeBtn = actionsEl.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
        setIcon(removeBtn, "trash-2");
        removeBtn.setAttr("aria-label", t("binder.projectManager.removeFromList"));
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          S.projects = (S.projects || []).filter((p) => p !== path);
          if (S.projectFolder === path) S.projectFolder = "";
          delete S.projectMeta[path];
          void this.plugin.saveSettings().then(() => {
            this.plugin.renderAllViews(true);
          });
        });

        row.addEventListener("click", () => {
          // MÊME chemin unique que la commande `switch-project` et que le
          // sélecteur de l'en-tête Binder : `plugin.switchProject` (valide le
          // dossier, préserve l'ancien projet, saveSettings + renderAllViews
          // + status bar). `false` = dossier supprimé/déplacé.
          void this.plugin.switchProject(path).then((ok) => {
            if (!ok) new Notice(t("binder.projectManager.folderGone", { path }));
          });
        });
      }
    }

    // Add existing folder input
    const addRow = treePane.createDiv({ cls: "feuillets-properties-add-row" });
    addRow.addClass("feuillets-add-row");
    const addInput = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("binder.projectManager.addExisting") },
    });
    addInput.addClass("feuillets-input-full");
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const p = normalizePath(addInput.value.trim());
      if (!p) return;
      const folder = this.app.vault.getAbstractFileByPath(p);
      if (!(folder instanceof TFolder)) {
        new Notice(t("binder.projectManager.folderNotFound"));
        return;
      }
      void (async () => {
        S.projectFolder = p;
        if (!S.projects.includes(p)) S.projects.push(p);
        await this.plugin.saveSettings();
        addInput.value = "";
        void this.plugin.updateStatusBar();
        this.plugin.renderAllViews(true);
      })();
    });

    // --- Right Pane: Hub & Cards ---
    const listBody = listPane.createDiv({ cls: "feuillets-list" });
    const hub = listBody.createDiv({ cls: "feuillets-project-hub" });

    hub.createEl("h3", { cls: "feuillets-hub-title", text: t("binder.projectManager.hubTitle") });

    const subEl = hub.createDiv({ cls: "feuillets-notes-sub" });
    subEl.setText(t("binder.projectManager.hubSub"));

    const cardsContainer = hub.createDiv({ cls: "feuillets-hub-cards" });

    this.hubCard(
      cardsContainer,
      "folder-plus",
      t("binder.projectManager.card.new.title"),
      t("binder.projectManager.card.new.desc"),
      t("binder.projectManager.card.new.btn"),
      () => new NewProjectModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cardsContainer,
      "import",
      t("binder.projectManager.card.import.title"),
      t("binder.projectManager.card.import.desc"),
      t("binder.projectManager.card.import.btn"),
      () => new ScrivenerImportModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cardsContainer,
      "folder-open",
      t("binder.projectManager.card.add.title"),
      t("binder.projectManager.card.add.desc"),
      t("binder.projectManager.card.add.btn"),
      () => addInput.focus()
    );
  }

  /** Une carte d'action cliquable (icône + titre + description + bouton) —
   * même gabarit que les cartes du gestionnaire de projets
   * (renderProjectManagerSplitView) et de l'écran d'accueil (renderOnboarding),
   * pour que les deux se ressemblent visuellement. `onClick` reçoit
   * l'événement (utile pour positionner un Menu au clic, ex. la démo). */
  hubCard(container: HTMLElement, icon: string, title: string, desc: string, btnText: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const card = container.createDiv({ cls: "feuillets-hub-card" });

    const iconEl = card.createDiv({ cls: "feuillets-cell-icon feuillets-hub-card-icon" });
    setIcon(iconEl, icon);

    const textWrap = card.createDiv({ cls: "feuillets-hub-card-text" });
    const cardTitle = textWrap.createDiv({ cls: "feuillets-hub-card-title" });
    cardTitle.setText(title);

    const cardDesc = textWrap.createDiv({ cls: "feuillets-notes-sub" });
    cardDesc.setText(desc);

    const btn = card.createEl("button", { cls: "mod-small", text: btnText });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });

    card.addEventListener("click", onClick);
    return card;
  }

  /** Véritable écran d'accueil, affiché uniquement au tout premier lancement
   * (aucun projet actif NI connu — voir render()) : titre, accroche, et les
   * trois actions qui font vraiment démarrer l'écriture. Distinct de
   * renderProjectManagerSplitView, qui reste affiché dès qu'AU MOINS un
   * projet est déjà connu (liste à switcher, pas un premier pas). Réutilise
   * .feuillets-settings-title/.feuillets-settings-tagline (déjà le rendu du
   * nom "Feuillets" + accroche dans les réglages) et .feuillets-hub-card
   * (déjà les cartes du gestionnaire de projets) plutôt que d'inventer un
   * nouveau langage visuel. */
  renderOnboarding(container: HTMLElement): void {
    const wrap = container.createDiv({ cls: "feuillets-onboarding" });

    wrap.createDiv({ cls: "feuillets-settings-title" }).setText(t("binder.onboarding.title"));
    wrap.createDiv({ cls: "feuillets-settings-tagline" }).setText(t("binder.onboarding.tagline"));

    const cards = wrap.createDiv({ cls: "feuillets-hub-cards" });

    this.hubCard(
      cards,
      "folder-plus",
      t("binder.onboarding.card.create.title"),
      t("binder.onboarding.card.create.desc"),
      t("binder.onboarding.card.create.btn"),
      () => new NewProjectModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cards,
      "folder-open",
      t("binder.onboarding.card.open.title"),
      t("binder.onboarding.card.open.desc"),
      t("binder.onboarding.card.open.btn"),
      () => new OpenExistingFolderModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cards,
      "sparkles",
      t("binder.onboarding.card.demo.title"),
      t("binder.onboarding.card.demo.desc"),
      t("binder.onboarding.card.demo.btn"),
      () => {
        void this.plugin.createDemoProject();
      }
    );

    wrap.createDiv({ cls: "feuillets-notes-sub feuillets-onboarding-footnote" }).setText(
      t("binder.onboarding.footnote")
    );
  }

  /** Section "Recherche" repliable, ajoutée sous l'arborescence du
   * manuscrit (vue arbre ET double volet) — juste une porte d'accès aux
   * fichiers de recherche depuis le binder, façon Ulysses ("Extras"). Rendu
   * volontairement simple (pas d'anneau de progression, pas de
   * numérotation, pas de menu contextuel manuscrit) : _Recherche est déjà
   * exclu de la compilation/numérotation/statistiques/Tableau par
   * convention de nommage (voir getOrderedChildren, folder-structure.js) —
   * cette section ne fait qu'y donner accès, jamais le mélanger au reste. */
  renderResearchSection(
    container: HTMLElement,
    researchRoot: TFolder,
    rootIcon = "search",
    labelForFile?: (f: TFile) => string,
    linkedFolders: TFolder[] = [],
    excludedRootPaths: ReadonlySet<string> = new Set(),
    workspaceResearchPaths: ReadonlySet<string> = new Set()
  ): void {
    const fileLabel = labelForFile || ((f: TFile) => this.plugin.titleFor(f));
    const S = this.plugin.settings;

    const renderRow = (host: HTMLElement, label: string, depth: number, isFolder: boolean, iconName?: string) => {
      const row = host.createDiv({
        cls: isFolder ? "feuillets-folder-row feuillets-binder-research-row" : "feuillets-item feuillets-binder-research-row",
      });
      row.style.paddingLeft = `${6 + depth * 14}px`;
      const icon = row.createDiv({ cls: "feuillets-cell-icon" });
      setIcon(icon, iconName ?? (depth === 0 ? rootIcon : isFolder ? "folder" : "file-text"));
      const name = row.createSpan({ cls: isFolder ? "feuillets-folder-name" : "feuillets-item-name" });
      name.setText(label);
      name.setAttr("title", label);
      return row;
    };

    // Clic droit sur un dossier de recherche (racine comprise) : créer un
    // sous-dossier ou un fichier dedans — mêmes actions que le manuscrit,
    // mais sans le reste du menu contextuel manuscrit (statut/label/
    // snapshot...), qui n'a pas de sens ici.
    const showResearchFolderMenu = (e: MouseEvent, folder: TFolder) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.newFolder"))
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(folder))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.newFile"))
          .setIcon("file-plus")
          .onClick(async () => {
            let name = t("binder.research.newFileDefaultName");
            let n = 2;
            while (this.app.vault.getAbstractFileByPath(normalizePath(`${folder.path}/${name}.md`))) {
              name = `${t("binder.research.newFileDefaultName")} ${n++}`;
            }
            const file = await this.app.vault.create(normalizePath(`${folder.path}/${name}.md`), "");
            void openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
          })
      );
      menu.showAtMouseEvent(e);
    };

    // Clic droit sur un fichier de recherche : gestion basique (ouvrir en
    // nouvel onglet, dupliquer, corbeille) — pas les options manuscrit
    // (statut/label/snapshot), qui n'ont pas de sens pour une fiche.
    const showResearchFileMenu = (e: MouseEvent, file: TFile) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.openNewTab"))
          .setIcon("file-plus")
          .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.openSplit"))
          .setIcon("columns-2")
          .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file))
      );
      if (isResearchAttachment(file)) {
        menu.showAtMouseEvent(e);
        return;
      }
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.compareWith"))
          .setIcon("diff")
          .onClick(() => {
            new PickFileModal(this.app, this.plugin, file, (other: TFile) => {
              new CompareFilesModal(this.app, this.plugin, file, other).open();
            }).open();
          })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.duplicate"))
          .setIcon("copy")
          .onClick(async () => {
            const content = await this.app.vault.read(file);
            const copySuffix = t("binder.research.copySuffix");
            let name = `${file.basename} (${copySuffix})`;
            let dest = normalizePath(`${file.parent!.path}/${name}.md`);
            let k = 2;
            while (this.app.vault.getAbstractFileByPath(dest)) {
              name = `${file.basename} (${copySuffix} ${k++})`;
              dest = normalizePath(`${file.parent!.path}/${name}.md`);
            }
            await this.app.vault.create(dest, content);
            new Notice(t("binder.research.duplicated", { name }));
            void this.render(true);
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.trash"))
          .setIcon("trash")
          .onClick(async () => {
            await this.app.fileManager.trashFile(file);
            new Notice(t("binder.research.trashed", { name: this.plugin.titleFor(file) || file.basename }));
            void this.render(true);
          })
      );
      menu.showAtMouseEvent(e);
    };

    const strippedRootName = researchRoot.name.replace(/^_/, "");
    const researchLabel = strippedRootName === "Recherche" || strippedRootName === "Research"
      ? t("research.displayText")
      : strippedRootName;
    const rootRow = renderRow(container, researchLabel, 0, true);
    // Séparateur visuel avec l'arborescence du manuscrit juste au-dessus —
    // trop proche sinon, on pouvait croire que "Recherche" faisait partie
    // du manuscrit plutôt que d'un accès à part (voir styles.css).
    rootRow.addClass("feuillets-binder-research-root");
    const rootCollapsed = !!S.collapsed[researchRoot.path];
    rootRow.addEventListener("click", () => {
      void (async () => {
        if (S.collapsed[researchRoot.path]) delete S.collapsed[researchRoot.path];
        else S.collapsed[researchRoot.path] = true;
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    });
    rootRow.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, researchRoot));

    const renderChildren = (folder: TFolder, depth: number, host: HTMLElement) => {
      const orderedChildren = this.plugin.getOrderedChildren(folder);
      const orderedPaths = new Set(orderedChildren.map((child) => child.path));
      const attachments = folder.children
        .filter((child): child is TFile => child instanceof TFile && isResearchFile(child) && !orderedPaths.has(child.path))
        .sort((a, b) => a.name.localeCompare(b.name, getLocale(), { numeric: true }));
      for (const child of [...orderedChildren, ...attachments]) {
        if (child instanceof TFolder) {
          if (excludedRootPaths.has(child.path)) continue;
          const row = renderRow(host, translatedResearchFolderName(RESEARCH_FOLDERS, child.name), depth, true);
          const isCollapsed = !!S.collapsed[child.path];
          row.addEventListener("click", () => {
            void (async () => {
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              void this.render(true);
            })();
          });
          row.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, child));
          if (!isCollapsed) renderChildren(child, depth + 1, host);
        } else if (child instanceof TFile) {
          const row = renderRow(host, fileLabel(child), depth, false, researchFileIcon(child));
          const actionsBtn = row.createSpan({ cls: "feuillets-cell-icon clickable-icon feuillets-binder-research-actions" });
          setIcon(actionsBtn, "more-horizontal");
          actionsBtn.setAttr("aria-label", t("binder.vault.fileActions"));
          actionsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showResearchFileMenu(e, child);
          });
          // Toujours dans un nouvel onglet : consulter une fiche de
          // recherche ne doit jamais remplacer la scène en cours d'écriture.
          row.addEventListener("click", () => {
            void openFileActivating(this.app, this.app.workspace.getLeaf("tab"), child);
          });
          row.addEventListener("contextmenu", (e) => showResearchFileMenu(e, child));
        }
      }
    };
    if (!rootCollapsed) renderChildren(researchRoot, 1, container);

    const renderLinkedFolder = (folder: TFolder, host: HTMLElement, depth: number) => {
      const row = renderRow(host, folder.name, depth, true, "link");
      const isCollapsed = !!S.collapsed[folder.path];
      row.addEventListener("click", () => {
        void (async () => {
          if (S.collapsed[folder.path]) delete S.collapsed[folder.path];
          else S.collapsed[folder.path] = true;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
      row.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, folder));
      if (!isCollapsed) renderChildren(folder, depth + 1, host);
    };

    /* Les associations qui ne proviennent pas d'un TFolder Binder restent
       sur leur projection historique. Elles ne sont pas requalifiées en
       espaces de travail par ce rendu. */
    for (const folder of linkedFolders) {
      if (workspaceResearchPaths.has(folder.path)) continue;
      if (folder.path === researchRoot.path || folder.path.startsWith(`${researchRoot.path}/`)) continue;
      renderLinkedFolder(folder, container, 1);
    }

    const linkedPaths = new Set<string>();
    const admissibleLinkedFolders = linkedFolders.filter((folder) => {
      if (!workspaceResearchPaths.has(folder.path) || folder.path === researchRoot.path) return false;
      if (linkedPaths.has(folder.path)) return false;
      linkedPaths.add(folder.path);
      return true;
    });
    if (admissibleLinkedFolders.length > 0) {
      const spacesCollapsed = S.collapsed["binder:research-spaces"] === true;
      const spacesRow = renderRow(container, t("shared.research.workspaces"), 0, true, "layers-3");
      spacesRow.addClass("feuillets-binder-research-root");
      spacesRow.addClass("feuillets-binder-research-spaces");
      spacesRow.setAttr("data-collapse-key", "binder:research-spaces");
      spacesRow.setAttr("aria-expanded", String(!spacesCollapsed));
      spacesRow.addEventListener("click", () => {
        void (async () => {
          if (S.collapsed["binder:research-spaces"]) delete S.collapsed["binder:research-spaces"];
          else S.collapsed["binder:research-spaces"] = true;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
      if (!spacesCollapsed) {
        const spacesBody = container.createDiv({ cls: "feuillets-binder-research-spaces-body" });
        for (const folder of admissibleLinkedFolders) {
          renderLinkedFolder(folder, spacesBody, 1);
        }
      }
    }
  }

  /** Double vue (correctif final Binder 2.5, modèle Ulysses) : structure des
   * dossiers du projet à gauche (`.feuillets-split`/`.feuillets-tree-pane`/
   * `.feuillets-split-resizer`/`.feuillets-list-pane`, MÊMES classes que
   * l'écran gestionnaire de projets — voir renderProjectManagerSplitView)
   * et Binder/listing du dossier sélectionné à droite. Le volet droit
   * appelle TOUJOURS `ctx.renderFileRow` (le renderFileRow 2.5 du Binder) —
   * jamais une ligne fichier réimplémentée ici, ce qui préserve
   * automatiquement aperçu/labels/Continu/multi-sélection/menus/drag/drop.
   * Sélection PUREMENT structurelle (S.binderSelectedPath, voir
   * selectFolder) : jamais Continu, jamais isolation, jamais nouvelle
   * leaf. */
  /** Chemins des projets VALIDES (dossiers réels du coffre) : le projet actif
   * + ceux de `settings.projects`, dédupliqués. Le sélecteur de projet de
   * l'en-tête n'apparaît que si au moins DEUX projets sont ainsi valides —
   * jamais un chemin orphelin (dossier supprimé/déplacé) dans la liste. */
  private validProjectPaths(): string[] {
    const S = this.plugin.settings;
    return [S.projectFolder, ...(S.projects || [])]
      .filter((p, i, a): p is string => !!p && a.indexOf(p) === i)
      .filter((p) => this.app.vault.getAbstractFileByPath(p) instanceof TFolder);
  }

  private showProjectRootContextMenu(
    event: MouseEvent,
    root: TFolder
  ): void {
    const menu = new Menu();
    const menuTitle = t("shared.contextMenu.openWithPreview");
    menu.addItem((item) =>
      item
        .setTitle(menuTitle)
        .setIcon("eye")
        .onClick(async () => {
          const scope = createProjectScope(root.path);
          await this.openScopeWithContinuAndPreview(scope);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.openInContinu"))
        .setIcon("layers")
        .onClick(async () => {
          const scope = createProjectScope(root.path);
          await openScopeInContinu(this.app, scope);
        })
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("binder.newSheetHere"))
        .setIcon("file-plus")
        .onClick(() => this.plugin.newSheet(root))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.newFolder"))
        .setIcon("folder-plus")
        .onClick(() => this.plugin.newFolder(root))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.importOutline"))
        .setIcon("list-tree")
        .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.visualOutline"))
        .setIcon("network")
        .onClick(() => void this.plugin.openVisualOutline())
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("binder.duplicateAsVersion"))
        .setIcon("copy-plus")
        .onClick(() => {
          new DuplicateVersionModal(this.app, this.plugin.projectDisplayName(root.path), (label) => {
            void this.plugin.duplicateProject(root.path, label);
          }).open();
        })
    );
    menu.showAtMouseEvent(event);
  }

  renderSplitBody(container: HTMLElement, root: TFolder, ctx: SplitBodyCtx): void {
    const { S, binderCompact, projectRoot } = ctx;
    /* Double vue : la Library gauche reste toujours l'arborescence globale
       du projet. Le contenu droit suit uniquement le scope partagé. */
    const workspaceFolder = this.getBinderWorkingRoot(projectRoot) || projectRoot;
    const draftsFolder = ctx.revealDraftsFolder instanceof TFolder ? ctx.revealDraftsFolder : null;
    const draftsSelected = draftsFolder !== null && S.binderSelectedPath === draftsFolder.path;
    const displayRoot = draftsSelected
      ? draftsFolder
      : workspaceFolder;
    const isIsolated = false;

    // Sélection structurelle conservée pour les flux historiques de
    // Recherche ; elle ne pilote ni le workspace ni le contenu droit.
    let selected = this.app.vault.getAbstractFileByPath(S.binderSelectedPath || "");
    const selectedInProject = (f: unknown): f is TFolder =>
      f instanceof TFolder && (f.path === projectRoot.path || f.path.startsWith(projectRoot.path + "/"));
    if (!selectedInProject(selected)) selected = projectRoot;
    const selectedFolder = !draftsSelected && selectedInProject(selected) ? asFolder(selected) : workspaceFolder;

    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth || 170}px`);

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });
    if (binderCompact) listPane.addClass("feuillets-compact");

    resizer.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth || 170;
      const onMove = (ev: MouseEvent) => {
        S.binderTreeWidth = Math.min(360, Math.max(120, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUpAsync = async () => { await this.plugin.saveSettings(); };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        void onUpAsync();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    const selectFolder = async (folder: TFolder) => {
      S.binderSelectedPath = folder.path;
      await this.plugin.saveSettings();
      if (folder.path === projectRoot.path) {
        if (typeof this.plugin.clearWorkspaceFolder === "function") this.plugin.clearWorkspaceFolder();
        else this.plugin.workspaceFolderPath = undefined;
      } else if (typeof this.plugin.setWorkspaceFolder === "function") {
        this.plugin.setWorkspaceFolder(folder);
      } else {
        this.plugin.workspaceFolderPath = folder.path;
        void this.render(true);
      }
    };

    // ---- Racine de la Library (racine du projet, ou racine de travail
    // isolée — §15 : mêmes contrôles/callbacks d'isolation que la vue
    // simple, réutilisés ici plutôt que dupliqués). ----
    const rootRow = treePane.createDiv({ cls: "feuillets-folder-row feuillets-tree-root" });
    if (!draftsSelected && workspaceFolder.path === root.path) rootRow.addClass("is-selected");

    if (isIsolated) {
      // Retour immédiat au projet complet (même helper que la vue simple).
      const backIcon = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(backIcon, "files");
      backIcon.setAttr("aria-label", t("binder.isolation.backToProject"));
      backIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof this.plugin.clearWorkspaceFolder === "function") this.plugin.clearWorkspaceFolder();
        else this.plugin.workspaceFolderPath = undefined;
      });

      // Remonte exactement d'un dossier (même sémantique que renderHierarchyBody).
      const upChevron = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(upChevron, "chevron-left");
      upChevron.setAttr("aria-label", t("binder.isolation.up"));
      upChevron.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = root.parent;
        if (!parent || parent.path === projectRoot.path) {
          if (typeof this.plugin.clearWorkspaceFolder === "function") this.plugin.clearWorkspaceFolder();
          else this.plugin.workspaceFolderPath = undefined;
        } else if (typeof this.plugin.setWorkspaceFolder === "function") {
          this.plugin.setWorkspaceFolder(parent);
        } else {
          this.plugin.workspaceFolderPath = parent.path;
        }
      });

      const nameEl = rootRow.createSpan({ cls: "feuillets-folder-name feuillets-isolation-current" });
      nameEl.setText(root.name);
      nameEl.setAttr("title", root.name);
    } else {
      // Nom du projet (pas le nom brut du dossier) : même comportement que
      // la vue simple (renderHierarchyBody) — clic gauche/clavier ouvrent
      // ManageProjectsModal, clic droit ouvre showProjectRootContextMenu.
      const rootName = rootRow.createSpan({ cls: "feuillets-folder-name" });
      rootName.setText(this.plugin.projectDisplayName(root.path));
      rootName.setAttr("role", "button");
      rootName.setAttr("tabindex", "0");
      /* Bug fix "clicking the project name steals the central working
         focus": the browser's default mousedown behavior moves focus to
         this span BEFORE the click handler below ever runs, stealing focus
         away from whatever editor/Continu leaf currently has it. Only the
         native focus transfer is prevented here — click still opens
         ManageProjectsModal exactly as before, and Tab + Enter/Space still
         reaches and activates this same element via the keyboard (role/
         tabindex untouched). Never triggers selectFolder() or touches
         binderSelectedPath/workspaceFolderPath — this listener does nothing
         but preventDefault(). */
      rootName.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
      });
      rootName.addEventListener("click", (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        new ManageProjectsModal(this.app, this.plugin).open();
      });
      rootName.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          new ManageProjectsModal(this.app, this.plugin).open();
        }
      });
      rootName.addEventListener("contextmenu", (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        this.showProjectRootContextMenu(e, root);
      });

      // Sélecteur de projet (chevron) : UNIQUEMENT en racine non isolée et
      // avec au moins deux projets VALIDES. Jamais un menu HTML, jamais une
      // modale : un `Menu` natif Obsidian, et chaque choix passe par le MÊME
      // chemin unique `plugin.switchProject` que la commande `switch-project`
      // et que le gestionnaire de projets. `stopPropagation()` : ce bouton ne
      // doit jamais déclencher le clic de la ligne racine (selectFolder).
      const projectPaths = this.validProjectPaths();
      if (projectPaths.length >= 2) {
        const switchBtn = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
        setIcon(switchBtn, "chevron-down");
        switchBtn.setAttr("aria-label", t("binder.switchProject"));
        switchBtn.setAttr("title", t("binder.switchProject"));
        switchBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const menu = new Menu();
          for (const path of projectPaths) {
            menu.addItem((item) =>
              item
                .setTitle(this.plugin.projectDisplayName(path))
                .setChecked(path === S.projectFolder)
                .onClick(() => { void this.plugin.switchProject(path); })
            );
          }
          menu.showAtMouseEvent(e);
        });
      }
    }

    const rootAdd = rootRow.createSpan({ cls: "feuillets-folder-add" });
    setIcon(rootAdd, "plus");
    rootAdd.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();
      if (isIsolated) {
        // §15/§21 : racine de travail isolée = un dossier du manuscrit
        // comme un autre pour la création, jamais "Importer un plan…"
        // (réservé à la vraie racine projet, comme dans la vue simple).
        menu.addItem((item) =>
          item.setTitle(t("binder.newSubfolder")).setIcon("folder-plus").onClick(() => this.plugin.newFolder(root))
        );
        menu.addItem((item) =>
          item
            .setTitle(t("binder.newSheetHere"))
            .setIcon("file-plus")
            .onClick(() => {
              void (async () => {
                await selectFolder(root);
                this.plugin.newSheet(root);
              })();
            })
        );
      } else {
        menu.addItem((item) =>
          item.setTitle(t("binder.newFolder")).setIcon("folder-plus").onClick(() => this.plugin.newFolder(root))
        );
        menu.addItem((item) =>
          item
            .setTitle(t("binder.importOutline"))
            .setIcon("list-tree")
            .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
        );
      }
      menu.showAtMouseEvent(e);
    });

    rootRow.addEventListener("click", () => { void selectFolder(root); });

    /* Cible de dépôt pour remonter un dossier imbriqué à la racine —
       exactement le même moteur (plugin.moveNode) que la racine de la vue
       simple (renderHierarchyBody). */
    rootRow.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      const draggedPath = this.plugin.dragState.path;
      if (!draggedPath) return;
      const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
      const draftFile = dragged instanceof TFile && draftsFolder && isProjectDraft(projectRoot, dragged)
        && dragged.parent?.path === this.plugin.dragState.parentPath;
      if (!(dragged instanceof TFolder) && !draftFile) return;
      if (dragged.path === root.path) return;
      if (dragged instanceof TFolder && dragged.parent?.path === root.path) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      rootRow.addClass("feuillets-dragover");
    });
    rootRow.addEventListener("dragleave", () => {
      rootRow.removeClass("feuillets-dragover");
    });
    rootRow.addEventListener("drop", (e) => {
      void (async () => {
        e.preventDefault();
        rootRow.removeClass("feuillets-dragover");
        if (!this.plugin.dragState) return;
        const drag = this.plugin.dragState;
        this.plugin.dragState = null;
        const draggedPath = drag.multi ? null : drag.path;
        if (!draggedPath) return;
        const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
        const draftFile = dragged instanceof TFile && draftsFolder && isProjectDraft(projectRoot, dragged)
          && dragged.parent?.path === drag.parentPath;
        if (!(dragged instanceof TFolder) && !draftFile) return;
        if (dragged.path === root.path) return;
        if (dragged instanceof TFolder && dragged.parent?.path === root.path) return;
        const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
        if (!(srcParent instanceof TFolder)) return;
        if (dragged instanceof TFile && dragged.parent?.path !== srcParent.path) return;
        await this.plugin.moveNode(dragged, srcParent, root, Number.MAX_SAFE_INTEGER);
        this.plugin.renderAllViews(true);
      })();
    });

    // ---- Arbre des dossiers : source de vérité unique, getOrderedChildren ----
    const renderTreeFolders = (parent: TFolder, depth: number) => {
      const siblings = this.plugin.getOrderedChildren(parent);
      siblings.forEach((child, i) => {
        if (!(child instanceof TFolder)) return;
        const hidden = child.name.startsWith("_") || parent.path.includes("/_");
        if (hidden) return;

        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        if (depth === 0) row.addClass("is-depth-0");
        row.style.paddingLeft = `${6 + depth * 14}px`;
        row.setAttr("data-path", child.path);
        if (!draftsSelected && workspaceFolder.path === child.path) row.addClass("is-selected");

        const childFolders = this.plugin.getOrderedChildren(child).filter((c) => c instanceof TFolder);
        const childCollapsed = !!S.collapsed[child.path];

        /* Micro-correctif "repli sans chevron" : plus aucun chevron dans la
           Library gauche — un dossier s'y reconnaît au nom seul. Le clic sur
           la ligne (voir plus bas) sélectionne TOUJOURS ce dossier comme
           displayRoot, et bascule EN PLUS S.collapsed[child.path] quand il a
           de vrais sous-dossiers. §17 : jamais d'icône folder/folder-open
           non plus sur un dossier enfant de la Library. */
        row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);

        const addBtn = row.createSpan({ cls: "feuillets-folder-add" });
        setIcon(addBtn, "plus");
        addBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle(t("binder.newSubfolder")).setIcon("folder-plus").onClick(() => this.plugin.newFolder(child))
          );
          menu.addItem((item) =>
            item
              .setTitle(t("binder.newSheetHere"))
              .setIcon("file-plus")
              .onClick(() => {
                void (async () => {
                  await selectFolder(child);
                  this.plugin.newSheet(child);
                })();
              })
          );
          menu.showAtMouseEvent(e);
        });

        /* Clic sur la ligne : active ce dossier dans le workspace partagé et
           conserve le comportement historique de repli/dépli. */
        row.addEventListener("click", () => {
          void (async () => {
            if (childFolders.length > 0) {
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
            }
            await selectFolder(child);
          })();
        });

        this.attachDragHandlers(row, row, parent, i, siblings, treePane);

        if (!childCollapsed) renderTreeFolders(child, depth + 1);
      });
    };
    renderTreeFolders(root, 0);

    if (draftsFolder) {
      const draftsVisible = !ctx.binderFilterActive || ctx.folderHasMatch(draftsFolder);
      if (draftsVisible) {
        const draftsRow = treePane.createDiv({
          cls: "feuillets-folder-row feuillets-binder-research-row feuillets-binder-research-root feuillets-drafts-row",
        });
        draftsRow.setAttr("data-path", draftsFolder.path);
        const icon = draftsRow.createSpan({ cls: "feuillets-cell-icon" });
        setIcon(icon, "inbox");
        draftsRow.createSpan({ cls: "feuillets-folder-name" }).setText(t("binder.drafts"));
        if (draftsSelected) draftsRow.addClass("is-selected");
        draftsRow.addEventListener("click", () => {
          void (async () => {
            S.binderSelectedPath = draftsFolder.path;
            await this.plugin.saveSettings();
            void this.render(true);
          })();
        });
      }
    }

    /* ---- Recherche : section historique restaurée dans la double vue
       (e2570de) — renderResearchSection garde la Recherche Projet et place
       les associations Binder dans le groupe virtuel Espaces — stockage
       existant inchangé. ---- */
    const researchRoot = this.plugin.getResearchRoot();
    if (researchRoot instanceof TFolder) {
      const linkedEntries = this.plugin.getLinkedResearchFolders();
      const linkedResearch = linkedEntries.map(({ folder }) => folder);
      const workspaceResearchPaths = new Set(
        linkedEntries
          .filter(({ binderNodes }) => binderNodes.some(
            (node) => node instanceof TFolder && node.path.startsWith(`${projectRoot.path}/`)
          ))
          .map(({ folder }) => folder.path)
      );
      this.renderResearchSection(
        treePane,
        researchRoot,
        "search",
        undefined,
        linkedResearch,
        workspaceResearchPaths,
        workspaceResearchPaths
      );
    }

    /* ---- Versions : section historique restaurée dans la double vue
       (e2570de) — même helper, icône history, labels shortTitleFor. ---- */
    const versionsRoot = this.plugin.getVersionsRoot();
    if (versionsRoot instanceof TFolder) {
      this.renderResearchSection(treePane, versionsRoot, "history", (f: TFile) => this.plugin.shortTitleFor(f));
    }

    // ---- Vault : mini-navigateur en lecture seule du Vault entier ----
    const vaultCollapsed = S.collapsed["binder:vault"] === true;
    const vaultRow = treePane.createDiv({
      cls: "feuillets-folder-row feuillets-binder-research-row feuillets-binder-research-root",
    });
    const vaultChevron = vaultRow.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(vaultChevron, vaultCollapsed ? "chevron-right" : "chevron-down");
    vaultRow.createSpan({ cls: "feuillets-folder-name" }).setText(t("binder.vault.label"));
    vaultRow.addEventListener("click", () => {
      void (async () => {
        if (S.collapsed["binder:vault"]) delete S.collapsed["binder:vault"];
        else S.collapsed["binder:vault"] = true;
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    });

    if (!vaultCollapsed) {
      const vaultSort = (a: TAbstractFile, b: TAbstractFile) => {
        const aFolder = a instanceof TFolder;
        const bFolder = b instanceof TFolder;
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return a.name.localeCompare(b.name, getLocale());
      };

      /* Clic droit sur un dossier Vault : associe/retire ce dossier comme
         dossier Recherche du workspace actif
         choisi par renderSplitBody(), aucun modal de sélection nécessaire.
         N'altère jamais S.binderSelectedPath (voir plugin.setLinkedResearchFolder/
         removeLinkedResearchFolder, main.ts). */
      const showVaultFolderMenu = (e: MouseEvent, vaultFolder: TFolder) => {
        e.preventDefault();
        const menu = new Menu();
        const current = this.plugin.getLinkedResearchFolder(selectedFolder);
        if (current && current.path === vaultFolder.path) {
          menu.addItem((item) =>
            item
              .setTitle(t("binder.vault.removeResearchLink"))
              .setIcon("unlink")
              .onClick(async () => {
                await this.plugin.removeLinkedResearchFolder(selectedFolder);
                this.plugin.renderAllViews(true);
              })
          );
        } else {
          menu.addItem((item) =>
            item
              .setTitle(t("binder.vault.useAsResearch"))
              .setIcon("link")
              .onClick(async () => {
                await this.plugin.setLinkedResearchFolder(selectedFolder, vaultFolder);
                this.plugin.renderAllViews(true);
              })
          );
        }
        menu.showAtMouseEvent(e);
      };

      const showVaultFileMenu = (e: MouseEvent, file: TFile) => {
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle(t("binder.vault.open"))
            .setIcon("file")
            .onClick(() => openFileActivating(this.app, this.plugin.getLeafForOpeningFile(), file))
        );
        menu.addItem((item) =>
          item
            .setTitle(t("binder.research.openNewTab"))
            .setIcon("file-plus")
            .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file))
        );
        menu.addItem((item) =>
          item
            .setTitle(t("binder.research.openSplit"))
            .setIcon("columns-2")
            .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file))
        );
        menu.showAtMouseEvent(e);
      };

      /* Rendu progressif : seuls les enfants des dossiers Vault DÉJÀ
         dépliés sont construits (jamais de scan global du Vault). Repli/
         dépli namespacé "binder:vault:<chemin>" — jamais S.collapsed[path]
         brut, qui appartient à l'arbre Manuscrit ci-dessus. */
      const renderVaultFolder = (folder: TFolder, depth: number) => {
        const children = [...folder.children].sort(vaultSort);
        for (const child of children) {
          if (child instanceof TFolder) {
            const key = `binder:vault:${child.path}`;
            const collapsed = S.collapsed[key] !== false; // défaut replié
            const row = treePane.createDiv({ cls: "feuillets-folder-row feuillets-binder-research-row" });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            const chevron = row.createSpan({ cls: "feuillets-cell-icon" });
            setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
            const icon = row.createSpan({ cls: "feuillets-cell-icon" });
            setIcon(icon, "folder");
            row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);
            row.addEventListener("click", () => {
              void (async () => {
                S.collapsed[key] = !collapsed;
                await this.plugin.saveSettings();
                void this.render(true);
              })();
            });
            row.addEventListener("contextmenu", (e) => showVaultFolderMenu(e, child));
            if (!collapsed) renderVaultFolder(child, depth + 1);
          } else if (child instanceof TFile) {
            const row = treePane.createDiv({ cls: "feuillets-item feuillets-binder-research-row" });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            const icon = row.createSpan({ cls: "feuillets-cell-icon" });
            setIcon(icon, "file-text");
            row.createSpan({ cls: "feuillets-item-name" }).setText(child.basename || child.name);
            const actionsBtn = row.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
            setIcon(actionsBtn, "more-horizontal");
            actionsBtn.setAttr("aria-label", t("binder.vault.fileActions"));
            actionsBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              showVaultFileMenu(e, child);
            });
            /* Clic simple : ouvre dans la leaf de travail normale, jamais
               Continu/CompileScope/sélection — jamais S.binderSelectedPath
               modifié (voir doc de méthode). */
            row.addEventListener("click", () => {
              void openFileActivating(this.app, this.plugin.getLeafForOpeningFile(), child);
            });
            row.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              showVaultFileMenu(e, child);
            });
          }
        }
      };
      renderVaultFolder(this.app.vault.getRoot(), 0);
    }

    // ---- Volet droit : contenu du workspace actif rendu par le moteur
    // PARTAGÉ du Binder 2.5 — jamais un second renderer. Le dossier actif
    // n'est jamais répété comme ligne (§9, façon Ulysses) : on rend
    // directement SES enfants, à la profondeur locale 0 (§10) —
    // `collapseCheckRoot = null` (§12) : son éventuel état `collapsed` ne
    // doit jamais masquer silencieusement ses fichiers directs, faute de
    // chevron ici pour le rouvrir ; ses sous-dossiers gardent normalement
    // leur propre état `collapsed`. Aucune section globale (Versions…) —
    // §13, ce volet ne représente QUE le contenu du workspace actif. */
    const listBody = listPane.createDiv({ cls: "feuillets-list" });

    const rightHierarchy = this.renderHierarchyContents(listBody, ctx, displayRoot, null);
    rightHierarchy.render(displayRoot, 0);
    if (rightHierarchy.rowsRendered() === 0) {
      listBody
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("binder.list.emptyRecursive"));
    }
  }

  /** Moteur PARTAGÉ des lignes dossier/fichier du Binder 2.5 (CORRECTIF
   * FINAL — double vue, §5/§6/§30) : rend récursivement les enfants de
   * `parent` (fichiers via `ctx.renderFileRow`, dossiers avec chevron réel/
   * icône neutre/menu contextuel/drag-drop 2.5, EXACTEMENT le comportement
   * historique — voir binderIsolateExtras/continuExtras/openFolderInContinu/
   * isolateFolder) dans `treePane`. UN SEUL renderer de ces lignes pour tout
   * le plugin : utilisé par `renderHierarchyBody` (vue simple,
   * `collapseCheckRoot = treeRoot` — le repli de l'en-tête racine masque
   * alors ses feuillets directs, comportement historique inchangé) ET par
   * le volet droit de `renderSplitBody` (double vue, `collapseCheckRoot =
   * null` — le `displayRoot` n'a pas de ligne/chevron dans ce volet, §9/§12 :
   * son éventuel état `collapsed` ne doit jamais pouvoir masquer
   * silencieusement ses fichiers directs, faute de chevron pour le
   * rouvrir ; ses SOUS-dossiers gardent normalement leur propre état
   * `collapsed`). Aucune branche `if (split) …` à l'intérieur : le code est
   * strictement identique quel que soit l'appelant, seul `collapseCheckRoot`
   * change de valeur. */
  private renderHierarchyContents(
    treePane: HTMLElement,
    ctx: SplitBodyCtx,
    selectedFolder: TFolder,
    collapseCheckRoot: TFolder | null,
    prependRoot: TFolder | null = null
  ): {
    render: (parent: TFolder, depth: number) => void;
    isTruncated: () => boolean;
    rowsRendered: () => number;
  } {
    const { S, binderFilterActive, folderHasMatch, renderFileRow, folderWordTotals } = ctx;

    // Filet de sécurité : chaque dossier jamais replié explicitement
    // (S.collapsed) se déplie par défaut — sur un dossier de projet
    // contenant des milliers de fichiers, ça pouvait construire un DOM
    // énorme d'un coup et planter Obsidian. On plafonne le nombre de lignes
    // rendues plutôt que de changer le comportement normal (jamais atteint
    // pour un projet de taille raisonnable, aucun changement perceptible).
    const MAX_TREE_ROWS = 1500;
    let treeRowCount = 0;
    let treeTruncated = false;

    /* GitHub #17: read-only visual projection of a file's Markdown H1-H6
       heading structure, shown ONLY on demand from that file's own context
       menu (headingOutlineContextMenuExtras) — never a project/global
       setting. Recursively renders the tree already built by
       buildHeadingOutline() (heading-outline.ts) — visual depth comes from
       THAT tree, never directly from `node.level` (a document can jump
       from H1 to H4 with no phantom level in between). These rows stay
       VIRTUAL nodes: still no `data-path`, no tabindex, no `role="button"`,
       never `.feuillets-item`/`.feuillets-folder-row` — see styles.css. The
       row IS click-to-navigate (navigateToHeading) and, since GitHub #17's
       drag & drop follow-up, `draggable` for same-file/same-level section
       reordering (attachHeadingDragHandlers) — never contextmenu, never
       the physical TFile/TFolder drag system. Counts toward the SAME
       `MAX_TREE_ROWS` as physical rows.
       `fileDepth` is the SAME `--feuillets-binder-depth` as the file row
       itself (physical folder depth) — the CSS formula (styles.css) adds
       the file row's own chevron/icon/label column width on top of it, so
       a heading never starts at the chevron's own column. `relativeDepth`
       starts at 1 for a root heading and grows by 1 per nesting level.
       Since GitHub #17's collapse follow-up: a heading WITH children gets a
       real `feuillets-heading-outline-chevron` (structure only — never
       navigates, never drags); a leaf heading gets an empty
       `feuillets-heading-outline-chevron-spacer` of the same width so leaf
       and parent rows at the same depth stay aligned. `collapseKeys` is
       built ONCE per file (buildHeadingCollapseKeys, preorder over the
       WHOLE tree) and threaded through the recursion unchanged — a node
       collapsed via `_collapsedHeadingKeys` simply isn't recursed into, so
       its descendants never become rows and never count toward
       `MAX_TREE_ROWS`. Rows stay FLAT DOM siblings (never wrapped in a
       per-node children container) — the isolated-mode separator CSS
       (`:has(+ .feuillets-heading-outline-row)`) depends on that flatness.
       Hierarchy guides are therefore drawn INSIDE each row instead: one
       absolutely-positioned `feuillets-heading-outline-guide` per ancestor
       level (never a real "│" character), so stacked rows sharing the same
       ancestor line up into a continuous-looking rail purely via CSS. */
    const renderHeadingOutlineNodes = (
      nodes: HeadingOutlineNode[],
      host: HTMLElement,
      file: TFile,
      fileDepth: number,
      relativeDepth: number,
      withLabelColumn: boolean,
      collapseKeys: Map<HeadingOutlineNode, string>
    ): void => {
      for (const node of nodes) {
        if (treeRowCount >= MAX_TREE_ROWS) {
          treeTruncated = true;
          treePane.createDiv({ cls: "feuillets-empty" }).setText(t("binder.tree.truncated", { max: String(MAX_TREE_ROWS) }));
          return;
        }
        treeRowCount++;
        const row = host.createDiv({ cls: "feuillets-heading-outline-row" });
        row.toggleClass("feuillets-heading-outline-row--with-label-column", withLabelColumn);
        row.style.setProperty("--feuillets-binder-depth", String(fileDepth));
        row.style.setProperty("--feuillets-heading-outline-depth", String(relativeDepth));
        row.setAttr("data-heading-level", String(node.level));

        for (let ancestorLevel = 1; ancestorLevel < relativeDepth; ancestorLevel++) {
          const guide = row.createSpan({ cls: "feuillets-heading-outline-guide" });
          guide.style.setProperty("--feuillets-heading-outline-guide-level", String(ancestorLevel));
        }

        const hasChildren = node.children.length > 0;
        const collapseKey = collapseKeys.get(node) ?? "";
        row.setAttr("data-heading-outline-key", collapseKey);
        const collapsed = hasChildren && this._collapsedHeadingKeys.has(collapseKey);
        row.toggleClass("feuillets-heading-outline-row--collapsed", collapsed);

        if (hasChildren) {
          const chevron = row.createSpan({ cls: "feuillets-heading-outline-chevron" });
          setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
          const chevronLabel = t(collapsed ? "binder.headingOutline.expand" : "binder.headingOutline.collapse");
          chevron.setAttr("aria-label", chevronLabel);
          chevron.setAttr("title", chevronLabel);
          chevron.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleHeadingCollapsed(collapseKey);
          });
        } else {
          row.createSpan({ cls: "feuillets-heading-outline-chevron-spacer" });
        }

        const text = row.createSpan({ cls: "feuillets-heading-outline-text" });
        text.setText(node.text);
        text.addEventListener("contextmenu", (e) => this.showHeadingShiftMenu(e, file, node));
        row.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.navigateToHeading(file, node);
        });
        /* A double-click on the TEXT (never the whole row) toggles collapse
           exactly like the chevron, for a heading with children — a leaf
           heading has nothing to collapse, so this is a structural no-op.
           No timer: the row's own "click" above still fires first and still
           navigates, same as a real double-click always fires its
           constituent clicks first — see §21/§22 of this follow-up. */
        if (hasChildren) {
          text.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleHeadingCollapsed(collapseKey);
          });
        }
        this.attachHeadingDragHandlers(row, file, node);
        if (hasChildren && !collapsed) {
          renderHeadingOutlineNodes(node.children, host, file, fileDepth, relativeDepth + 1, withLabelColumn, collapseKeys);
          if (treeTruncated) return;
        }
      }
    };

    /* Ouverture Continu d'un dossier au simple clic sur son NOM (LOT FINAL
       Binder ↔ Continu, §11-12) : programmée après ce court délai plutôt
       qu'exécutée tout de suite, pour qu'un double-clic (isolation, voir
       isolateFolder) ait le temps de l'annuler avant qu'elle ne parte — un
       double-clic ne doit JAMAIS aussi ouvrir Continu au passage. Repli/
       dépli est la responsabilité EXCLUSIVE du chevron (§13), plus jamais
       du nom lui-même — `pendingFolderClickTimer` reste partagé par tout
       l'arbre de CE rendu : un seul geste utilisateur (clic ou
       double-clic) a lieu à la fois, inutile d'en garder un par ligne. */
    const BINDER_CLICK_DELAY_MS = 220;
    let pendingFolderClickTimer: number | null = null;

    const renderTreeFolders = (parent: TFolder, depth: number) => {
      if (treeTruncated) return;
      const siblings = this.plugin.getOrderedChildren(parent);
      for (let i = 0; i < siblings.length; i++) {
        if (treeTruncated) return;
        const child = siblings[i];
        if (
          collapseCheckRoot &&
          parent === collapseCheckRoot &&
          S.collapsed[collapseCheckRoot.path] &&
          child instanceof TFile
        ) continue;
        if (child instanceof TFile) {
          if (treeRowCount >= MAX_TREE_ROWS) {
            treeTruncated = true;
            treePane.createDiv({ cls: "feuillets-empty" }).setText(t("binder.tree.truncated", { max: String(MAX_TREE_ROWS) }));
            return;
          }
          /* §15-16 : même `depth` que la ligne dossier qui contient ce
             fichier (plus de `depth + 1` artificiel) — un feuillet et un
             dossier du même niveau alignent désormais leur colonne
             chevron/icône/titre via la MÊME `--feuillets-binder-depth`. */
          if (renderFileRow(treePane, child, parent, i, siblings, depth, treePane, {
            showPreview: true,
            revealProjectDraft: !!ctx.revealDraftsFolder,
          })) {
            treeRowCount++;
            if (this._visibleHeadingOutlinePaths.has(child.path)) {
              const outline = headingOutlineForFile(this.app, child);
              if (outline.length > 0) {
                const collapseKeys = this.buildHeadingCollapseKeys(child, outline);
                renderHeadingOutlineNodes(outline, treePane, child, depth, 1, S.binderShowLabels, collapseKeys);
              }
            }
          }
          continue;
        }
        if (!(child instanceof TFolder)) continue;
        const inDraftsProjection = ctx.revealDraftsFolder !== null && ctx.revealDraftsFolder !== undefined && (
          child.path === ctx.revealDraftsFolder.path || child.path.startsWith(`${ctx.revealDraftsFolder.path}/`)
        );
        const hidden = (child.name.startsWith("_") || parent.path.includes("/_")) && !inDraftsProjection;
        if (hidden) continue;
        if (binderFilterActive && !folderHasMatch(child)) continue;

        if (treeRowCount >= MAX_TREE_ROWS) {
          treeTruncated = true;
          const warn = treePane.createDiv({ cls: "feuillets-empty" });
          warn.setText(t("binder.tree.truncated", { max: String(MAX_TREE_ROWS) }));
          return;
        }
        treeRowCount++;

        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        if (depth === 0) row.addClass("is-depth-0");
        /* §15-16 : variable CSS de profondeur, calc() en CSS — jamais un
           jeu de classes depth-1/depth-2/etc., jamais de paddingLeft
           calculé ici en JS. */
        row.style.setProperty("--feuillets-binder-depth", String(depth));
        if (selectedFolder.path === child.path) row.addClass("is-active");

        row.setAttr("data-path", child.path);

        if (collapseCheckRoot !== null && this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(child.path)) {
          row.addClass("is-selected");
        }

        /* Chevron (§13-14) : zone de clic PROPRE, plier/déplier
           uniquement — jamais Continu, jamais isolation, jamais sélection.
           Présent seulement si ce dossier a des enfants à déplier/replier ;
           sinon la colonne reste réservée VIDE pour l'alignement (§16). */
        const childEntries = this.plugin.getOrderedChildren(child);
        const childIsCollapsed = !!S.collapsed[child.path];
        const chevron = row.createSpan({ cls: "feuillets-folder-chevron" });
        if (childEntries.length > 0) {
          setIcon(chevron, childIsCollapsed ? "chevron-right" : "chevron-down");
          chevron.setAttr(
            "aria-label",
            t(childIsCollapsed ? "binder.folder.expand" : "binder.folder.collapse")
          );
          chevron.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void (async () => {
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              void this.render(true);
            })();
          });
        } else {
          chevron.addClass("is-empty");
        }

        this.buildBinderNodeIcon(row, "folder", null);

        row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);

        /* Optional status dot + progress ring on the folder's own row —
           read-only, from its existing folder note (never created here) and
           from the word-count totals precomputed once per render
           (ctx.folderWordTotals), never a second wordCountOfFolder() read
           per row. Works exactly the same collapsed or expanded: a folded
           chapter still shows its own indicators without rendering its
           children. */
        if (S.binderShowStatus || S.binderShowProgress) {
          const note = S.binderShowStatus ? this.plugin.folderNoteFor(child) : null;
          const statusValue = note ? toValue(this.fm(note).status).trim() : "";
          const goal = S.binderShowProgress ? this.plugin.folderGoal(child) : 0;
          this.renderBinderIndicators(row, {
            statusValue,
            contextFolder: child,
            wc: folderWordTotals.get(child.path) || 0,
            goal,
          });
        }

        /* Clic simple sur le NOM (§11-12) : ouvre ce dossier en Continu
           dans la leaf de travail centrale — jamais un repli/dépli, devenu
           la responsabilité exclusive du chevron ci-dessus. Programmé après
           un court délai pour laisser un double-clic s'annoncer d'abord ;
           `dblclick` annule ce délai avant d'isoler, un double-clic ne doit
           donc JAMAIS aussi ouvrir Continu au passage. */
        row.addEventListener("click", (e) => {
          if (this.handleMultiSelectClick(e, child, parent, i, siblings, treePane)) return;
          if (pendingFolderClickTimer !== null) window.clearTimeout(pendingFolderClickTimer);
          pendingFolderClickTimer = window.setTimeout(() => {
            pendingFolderClickTimer = null;
            void this.openFolderInContinu(child);
          }, BINDER_CLICK_DELAY_MS);
        });
        row.addEventListener("dblclick", (e) => {
          e.preventDefault();
          if (pendingFolderClickTimer !== null) {
            window.clearTimeout(pendingFolderClickTimer);
            pendingFolderClickTimer = null;
          }
          this.isolateFolder(child);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.ensureSelectionForContextMenu(child.path, treePane);
          this.showFolderContextMenu(e, child, parent, i, siblings, (menu) => {
            this.continuExtras(child)(menu);
            menu.addSeparator();
            this.binderIsolateExtras(child)(menu);
            this.folderWorkspaceExtras(child)(menu);
          }, true);
        });

        this.attachDragHandlers(row, row, parent, i, siblings, treePane);

        /* Le repli du nom du projet (S.collapsed[treeRoot.path]) ne masque
           que les feuillets posés directement à la racine (voir plus haut) —
           il ne doit jamais empêcher un dossier de se déplier via son PROPRE
           état S.collapsed[child.path], sans quoi "tout replier" fige
           l'arborescence : un dossier redevenait cliquable en apparence mais
           son contenu ne se rendait plus jamais tant que la racine restait
           repliée. */
        if (!S.collapsed[child.path] || binderFilterActive) {
          renderTreeFolders(child, depth + 1);
        }
      }
    };

    const render = (parent: TFolder, depth: number): void => {
      if (
        prependRoot &&
        parent === collapseCheckRoot &&
        (!collapseCheckRoot || !S.collapsed[collapseCheckRoot.path])
      ) {
        renderTreeFolders(prependRoot, depth);
      }
      renderTreeFolders(parent, depth);
    };

    return {
      render,
      isTruncated: () => treeTruncated,
      rowsRendered: () => treeRowCount,
    };
  }

  renderHierarchyBody(container: HTMLElement, root: TFolder, ctx: SplitBodyCtx): void {
    const { S, projectRoot, binderCompact } = ctx;
    const draftsFolder = getDraftsFolder(this.app, projectRoot);

    const treePane = container.createDiv({ cls: "feuillets-list" });
    if (binderCompact) treePane.addClass("feuillets-compact");

    const treeRoot = root;

    let selected = this.app.vault.getAbstractFileByPath(S.binderSelectedPath || "");
    const inScope = (f: unknown): f is TFolder =>
      f instanceof TFolder && (f.path === root.path || f.path.startsWith(root.path + "/"));

    if (!inScope(selected)) {
      selected = treeRoot;
    }
    const selectedFolder = asFolder(selected);

    const selectFolder = async (f: TFolder) => {
      S.binderSelectedPath = f.path;
      await this.plugin.saveSettings();
      void this.render(true);
    };

    const rootRow = treePane.createDiv({
      cls: "feuillets-folder-row feuillets-tree-root",
    });
    if (selectedFolder.path === treeRoot.path) rootRow.addClass("is-selected");

    /* En-tête d'isolation (chantier "isoler un dossier" —
       le scope partagé) : réutilise EXACTEMENT la même ligne "nom du
       projet", sans bandeau ni encadrement nouveau. Non isolé, comportement
       identique à avant (nom du projet seul). Isolé, une seule ligne
       compacte : [icône manuscrit] ‹ nom réel du dossier courant — jamais
       de fil d'Ariane complet, jamais de chemin affiché. */
    const isIsolated = treeRoot.path !== projectRoot.path;
    treePane.toggleClass("feuillets-binder-isolated", isIsolated);

    /* Clic sur le nom courant (isolé ou non) : replie/déplie la branche de
       treeRoot — comportement "tout replier/déplier" existant, inchangé,
       juste scopé à la racine de travail. */
    const toggleCollapseCurrentRoot = (e: MouseEvent) => {
      e.stopPropagation();
      const isCollapsed = !!S.collapsed[treeRoot.path];
      S.collapsed[treeRoot.path] = !isCollapsed;
      if (!isCollapsed) {
        for (const child of this.plugin.getOrderedChildren(treeRoot)) {
          if (child instanceof TFolder) S.collapsed[child.path] = true;
        }
      } else {
        const expandAllFolders = (folder: TFolder) => {
          delete S.collapsed[folder.path];
          for (const child of this.plugin.getOrderedChildren(folder)) {
            if (child instanceof TFolder) expandAllFolders(child);
          }
        };
        expandAllFolders(treeRoot);
      }
      void (async () => {
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    };

    if (isIsolated) {
      // Icône manuscrit (réutilise "files", déjà l'icône du Binder — voir
      // getIcon()/registerRibbonIcons — plutôt qu'un SVG maison) : clic =
      // retour immédiat au projet complet.
      const backIcon = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(backIcon, "files");
      backIcon.setAttr("aria-label", t("binder.isolation.backToProject"));
      backIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof this.plugin.clearWorkspaceFolder === "function") this.plugin.clearWorkspaceFolder();
        else this.plugin.workspaceFolderPath = undefined;
      });

      // Chevron : remonte exactement d'un dossier. Si le parent est la
      // racine du projet, revenir au Binder complet (équivalent : la racine
      // de travail redevient le projet, donc l'en-tête isolé disparaît).
      const upChevron = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(upChevron, "chevron-left");
      upChevron.setAttr("aria-label", t("binder.isolation.up"));
      upChevron.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = treeRoot.parent;
        if (!parent || parent.path === projectRoot.path) {
          if (typeof this.plugin.clearWorkspaceFolder === "function") this.plugin.clearWorkspaceFolder();
          else this.plugin.workspaceFolderPath = undefined;
        } else if (typeof this.plugin.setWorkspaceFolder === "function") {
          this.plugin.setWorkspaceFolder(parent);
        } else {
          this.plugin.workspaceFolderPath = parent.path;
        }
      });

      // Nom réel du dossier isolé : casse conservée (pas d'uppercase — voir
      // styles.css), ellipsis sur nom long, tooltip natif via `title`.
      const nameEl = rootRow.createSpan({ cls: "feuillets-folder-name feuillets-isolation-current" });
      nameEl.setText(treeRoot.name);
      nameEl.setAttr("title", treeRoot.name);
      nameEl.addEventListener("click", toggleCollapseCurrentRoot);
    } else {
      // Nom du projet (pas le nom brut du dossier : un projet structuré en
      // <NomDuProjet>/Manuscrit/ afficherait sinon juste "Manuscrit" pour
      // tous les projets — projectDisplayName remonte au vrai nom).
      const rootName = rootRow.createSpan({ cls: "feuillets-folder-name" });
      rootName.setText(this.plugin.projectDisplayName(treeRoot.path));
      rootName.setAttr("role", "button");
      rootName.setAttr("tabindex", "0");
      /* Bug fix "clicking the project name steals the central working
         focus" — see the same guard in renderSplitBody above for the full
         rationale. Only preventDefault(): never triggers selectFolder() nor
         touches binderSelectedPath/workspaceFolderPath. */
      rootName.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
      });
      rootName.addEventListener("click", (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        new ManageProjectsModal(this.app, this.plugin).open();
      });
      rootName.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          new ManageProjectsModal(this.app, this.plugin).open();
        }
      });
      rootName.addEventListener("contextmenu", (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        this.showProjectRootContextMenu(e, treeRoot);
      });

      const quickDraftAdd = rootRow.createSpan({ cls: "feuillets-folder-add feuillets-quick-draft-add" });
      setIcon(quickDraftAdd, "plus");
      quickDraftAdd.setAttr("role", "button");
      quickDraftAdd.setAttr("tabindex", "0");
      quickDraftAdd.setAttr("aria-label", t("binder.quickDraft.create"));
      quickDraftAdd.setAttr("title", t("binder.quickDraft.create"));
      const createQuickDraft = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        void this.plugin.createQuickDraft();
      };
      quickDraftAdd.addEventListener("click", createQuickDraft);
      quickDraftAdd.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") createQuickDraft(e);
      });
    }

    rootRow.addEventListener("click", (e) => {
      void selectFolder(treeRoot);
    });

    /* Clic droit sur la ligne racine : si elle représente le vrai dossier
       projet (pas d'isolation, ou isolation revenue au projet), même menu
       qu'avant — "dupliquer comme nouvelle version" comprise (voir plus
       bas). Isolée sur un sous-dossier, la racine affichée est un dossier
       ordinaire : son clic droit ouvre le menu contextuel standard des
       dossiers (showFolderContextMenu), avec "Isoler ce dossier" en plus —
       jamais un second menu créé pour l'occasion. */
    rootRow.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (treeRoot.path !== projectRoot.path) {
        const workingParent = treeRoot.parent;
        const workingSiblings = workingParent ? this.plugin.getOrderedChildren(workingParent) : [treeRoot];
        const workingIndex = Math.max(0, workingSiblings.indexOf(treeRoot));
        this.ensureSelectionForContextMenu(treeRoot.path, treePane);
        this.showFolderContextMenu(e, treeRoot, workingParent ?? treeRoot, workingIndex, workingSiblings, (menu) => {
          this.continuExtras(treeRoot)(menu);
          menu.addSeparator();
          this.binderIsolateExtras(treeRoot)(menu);
          this.folderWorkspaceExtras(treeRoot)(menu);
        }, true);
        return;
      }
      this.showProjectRootContextMenu(e, treeRoot);
    });

    /* Accepter le dépôt d'un dossier imbriqué sur la racine du projet :
       glisser Documentation/Chapitre 5 sur la racine déplace Chapitre 5 à
       la racine, avec vérifications pour éviter les pièges courants
       (déplacement de la racine elle-même, dossier déjà à la racine,
       conflits de nom, rejets de fichiers). */
    rootRow.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      const draggedPath = this.plugin.dragState.path;
      if (!draggedPath) return;
      const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
      const draftFile = treeRoot.path === projectRoot.path && dragged instanceof TFile && draftsFolder
        && isProjectDraft(projectRoot, dragged) && dragged.parent?.path === this.plugin.dragState.parentPath;
      // Accepter les dossiers historiques et les brouillons uniquement sur
      // la vraie racine du projet.
      if (!(dragged instanceof TFolder) && !draftFile) return;
      // Ne pas accepter la racine elle-même
      if (dragged.path === treeRoot.path) return;
      // Ne pas accepter un dossier qui est déjà à la racine
      if (dragged instanceof TFolder && dragged.parent?.path === treeRoot.path) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      rootRow.addClass("feuillets-dragover");
    });

    rootRow.addEventListener("dragleave", () => {
      rootRow.removeClass("feuillets-dragover");
    });

    rootRow.addEventListener("drop", (e) => {
      void (async () => {
        e.preventDefault();
        rootRow.removeClass("feuillets-dragover");
        if (!this.plugin.dragState) return;
        const drag = this.plugin.dragState;
        this.plugin.dragState = null;

        const draggedPath = drag.multi ? null : drag.path;
        if (!draggedPath) return;

        const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
        const draftFile = treeRoot.path === projectRoot.path && dragged instanceof TFile && draftsFolder
          && isProjectDraft(projectRoot, dragged) && dragged.parent?.path === drag.parentPath;
        // Accepter les dossiers historiques et les brouillons uniquement sur
        // la vraie racine du projet.
        if (!(dragged instanceof TFolder) && !draftFile) return;
        // Ne pas accepter la racine
        if (dragged.path === treeRoot.path) return;
        // Ne pas accepter un dossier qui est déjà à la racine
        if (dragged instanceof TFolder && dragged.parent?.path === treeRoot.path) return;

        const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
        if (!(srcParent instanceof TFolder)) return;
        if (dragged instanceof TFile && dragged.parent?.path !== srcParent.path) return;

        // Déplacer le dossier à la racine
        await this.plugin.moveNode(dragged, srcParent, treeRoot, Number.MAX_SAFE_INTEGER);
        this.plugin.renderAllViews(true);
      })();
    });

    /* Moteur PARTAGÉ des lignes dossier/fichier 2.5 (§5/§30) — le même
       helper alimente le volet droit de la double vue (renderSplitBody).
       `collapseCheckRoot = treeRoot` : comportement historique inchangé,
       le repli de l'en-tête racine masque ses feuillets directs. */
    const hierarchy = this.renderHierarchyContents(
      treePane,
      ctx,
      selectedFolder,
      treeRoot,
      treeRoot.path === projectRoot.path ? getDraftsFolder(this.app, projectRoot) : null
    );
    hierarchy.render(treeRoot, 0);

    // Vider la sélection quand on clique dans une zone vide du Binder
    treePane.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      // Ne vider que si le clic est dans la zone vide ou pas sur un élément avec data-path
      if (!target.closest("[data-path]")) {
        if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.size > 0) {
          this.plugin._binderMultiSelect.clear();
          this.refreshMultiSelectClasses(treePane);
        }
      }
    });
  }
}
