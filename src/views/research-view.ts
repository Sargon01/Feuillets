import { TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { VIEW_RESEARCH } from "../constants.js";
import { t } from "../i18n/index.js";
import { isEditing } from "../utils/dom.js";
import { BaseFeuilletsView, type ResearchScopeMode, type ResearchSubTab } from "./base-feuillets-view.js";
import { resolveActiveFileResearchFolders, resolveWorkspaceResearchFolder } from "../services/workspace-research.js";
import { resolveResearchDocumentContext } from "../services/research-document-context.js";

type ResearchViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type ResearchContainer = HTMLElement & { find?: <T extends HTMLElement>(selector: string) => T | null };

function findResearchElement<T extends HTMLElement>(container: HTMLElement, selector: string): T | null {
  const scoped = container as ResearchContainer;
  return scoped.find?.<T>(selector) ?? null;
}

/** Class-selector-only lookup (never an attribute selector — kept
 * consistent with findResearchElement() above, since a bare class selector
 * is the one form every DOM/test-double implementation in this codebase
 * supports). Used to locate the sub-tab buttons by their `.feuillets-
 * research-subtab` class, then filtered further in JS via `getAttr()`. */
function findAllResearchElements(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(selector)) as HTMLElement[];
}

export class ResearchView extends BaseFeuilletsView {
  declare plugin: ResearchViewPlugin;
  declare targetContainer?: HTMLElement;
  declare viewingFile: TFile | null;
  declare _renderGen?: number;
  researchScopeMode: ResearchScopeMode = "workspace";
  researchActiveSubTab: ResearchSubTab = "dossiers";
  protected _bibliographyDebounceTimer: number | null = null;
  protected _bibliographyListenersSetup = false;
  protected _isClosed = false;

  constructor(leaf: WorkspaceLeaf, plugin: ResearchViewPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return VIEW_RESEARCH;
  }

  getDisplayText(): string {
    return t("research.displayText");
  }

  getIcon(): string {
    return "book-marked";
  }

  setupBibliographyLifecycleListeners(): void {
    if (this._bibliographyListenersSetup) return;
    this._bibliographyListenersSetup = true;

    const debouncedRefresh = () => {
      if (this._isClosed) return;
      if (this._bibliographyDebounceTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(this._bibliographyDebounceTimer);
      }
      if (typeof window !== "undefined") {
        this._bibliographyDebounceTimer = window.setTimeout(() => {
          this._bibliographyDebounceTimer = null;
          if (this._isClosed) return;
          void this.render();
        }, 150);
      }
    };

    if (this.app?.workspace) {
      this.registerEvent(this.app.workspace.on("active-leaf-change", debouncedRefresh));
      this.registerEvent(this.app.workspace.on("file-open", debouncedRefresh));
      this.registerEvent(this.app.workspace.on("editor-change", debouncedRefresh));
    }
    if (this.app?.vault) {
      this.registerEvent(this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && (file.extension === "md" || file.extension === "bib")) {
          debouncedRefresh();
        }
      }));
    }
  }

  async onOpen(): Promise<void> {
    this._isClosed = false;
    this.setupBibliographyLifecycleListeners();
    await this.render();
  }

  async onClose(): Promise<void> {
    this._isClosed = true;
    if (this._bibliographyDebounceTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this._bibliographyDebounceTimer);
      this._bibliographyDebounceTimer = null;
    }
    this._bibliographyListenersSetup = false;
    await super.onClose();
  }

  async render(force = false): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;

    const previousBody = findResearchElement<HTMLElement>(container, ".feuillets-research-body");
    const previousInput = findResearchElement<HTMLInputElement>(container, ".feuillets-binder-search");
    const activeInput = typeof document !== "undefined" && document.activeElement === previousInput;
    const previousSelection = activeInput && previousInput ? { start: previousInput.selectionStart, end: previousInput.selectionEnd } : null;
    const previousScrollTop = previousBody?.scrollTop ?? 0;
    /* If a sub-tab button had focus (the user just activated it via click,
       Enter or Space), the rerender it triggers would otherwise drop focus
       back to the document body — restore it onto the same tab (now
       marked active) below, never a fixed/guessed element. */
    const focusedSubTabKey = typeof document !== "undefined"
      ? findAllResearchElements(container, ".feuillets-research-subtab")
          .find((el) => document.activeElement === el)
          ?.getAttr("data-subtab-key") ?? null
      : null;
    const restoreUi = () => {
      const nextBody = findResearchElement<HTMLElement>(container, ".feuillets-research-body");
      if (nextBody) nextBody.scrollTop = previousScrollTop;
      const nextInput = activeInput ? findResearchElement<HTMLInputElement>(container, ".feuillets-binder-search") : null;
      if (nextInput) {
        nextInput.focus({ preventScroll: true });
        if (previousSelection && previousSelection.start !== null && previousSelection.end !== null) {
          nextInput.setSelectionRange(previousSelection.start, previousSelection.end);
        }
      }
      if (focusedSubTabKey) {
        const nextTabButton = findAllResearchElements(container, ".feuillets-research-subtab")
          .find((el) => el.getAttr("data-subtab-key") === focusedSubTabKey);
        nextTabButton?.focus({ preventScroll: true });
      }
    };

    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-research-container");

    const root = this.plugin.getProjectFolder();
    if (!root) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("board.noProjectFolder"));
      restoreUi();
      return;
    }

    if (this.viewingFile) {
      const stillExists = this.app.vault.getAbstractFileByPath(
        this.viewingFile.path
      );
      if (stillExists instanceof TFile) {
        await this.renderFileView(container, stillExists, root);
        restoreUi();
        return;
      }
      this.viewingFile = null;
    }

    const workspaceFolder = typeof this.plugin.getWorkspaceFolder === "function"
      ? this.plugin.getWorkspaceFolder()
      : null;
    const workspaceActive = workspaceFolder instanceof TFolder && workspaceFolder.path !== root.path;
    const projectResearchRoot = typeof this.plugin.getResearchRoot === "function"
      ? this.plugin.getResearchRoot()
      : null;
    const workspaceResearch = workspaceActive && this.researchScopeMode === "workspace"
      ? resolveWorkspaceResearchFolder(this.app, this.plugin.settings, workspaceFolder)
      : null;
    const associatedResearchFolder = workspaceResearch?.sourceKind === "exact" || workspaceResearch?.sourceKind === "ancestor"
      ? workspaceResearch.folder
      : null;
    const activeFile = typeof this.app?.workspace?.getActiveFile === "function"
      ? this.app.workspace.getActiveFile()
      : null;
    const activeBranchResearchFolders = workspaceActive && this.researchScopeMode === "workspace" && workspaceFolder && activeFile
      ? resolveActiveFileResearchFolders(this.app, this.plugin.settings, workspaceFolder, activeFile)
          .map((item) => ({
            folder: item.folder,
            binderNodes: [item.binderNode],
          }))
      : undefined;
    const documentContext = resolveResearchDocumentContext(
      this.app,
      this.plugin.settings,
      root,
      workspaceFolder,
      this.researchScopeMode,
    );
    await this.renderResearchBody(container, root, myGen, {
      scopeMode: this.researchScopeMode,
      workspaceActive,
      workspaceFolder,
      researchRoot: projectResearchRoot,
      associatedResearchFolder,
      activeBranchResearchFolders,
      documentContext,
      onScopeModeChange: (mode) => {
        this.researchScopeMode = mode;
        void this.render(true);
      },
      activeSubTab: this.researchActiveSubTab,
      onSubTabChange: (tab) => {
        this.researchActiveSubTab = tab;
        void this.render(true);
      },
    });
    restoreUi();
  }
}
