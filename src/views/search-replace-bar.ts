import { MarkdownView, Notice, setIcon, type App, type TFile, type TFolder, type Editor } from "obsidian";
import { FeuilletsSearchEngine, type SearchOccurrence } from "../services/feuillets-search-engine.js";
import { openFileActivating } from "../utils/dom.js";
import { applyEditorHighlights, clearEditorHighlights } from "../utils/cm-search-highlighter.js";
import { t } from "../i18n/index.js";
import { type CompileScope, createProjectScope } from "../services/compile-scope.js";
import { GlobalReplaceError, type GlobalSearchReplace } from "../services/global-search-replace.js";
import { SearchReplaceConfirmModal, globalReplaceErrorMessage } from "../ui/search-replace-confirm-modal.js";

type MatchMode = "contains" | "startsWith" | "wholeWord";
type SearchScope = "document" | "folder" | "selection" | "manuscript" | "project";
type SearchOptions = {
  ignoreCase: boolean;
  ignoreDiacritics: boolean;
  matchMode: MatchMode;
  scope: SearchScope;
  includeYaml: boolean;
  protectMarkdown: boolean;
};
type SearchReplacePlugin = {
  getManuscriptFiles?: () => TFile[];
  getGlobalSearchReplace?: () => GlobalSearchReplace;
  getSearchReplaceView?: () => MarkdownView | null;
  getProjectFolder?: () => TFolder | null;
  editorialRootFor?: (node: TFile | TFolder) => TFolder | null;
  compileScopeForFolder?: (folder: TFolder) => CompileScope | null;
  compileScopeForSelection?: (paths: string[]) => CompileScope | null;
  _binderMultiSelect?: Set<string>;
};
type SearchEditor = Editor & { cm?: { dispatch?: (transaction: unknown) => void } };
type SearchMarkdownView = MarkdownView & { file?: TFile; editor?: SearchEditor; containerEl: HTMLElement };

function hasSearchView(view: MarkdownView): view is SearchMarkdownView {
  return "file" in view && "editor" in view;
}

function insertAtCursor(inputEl: HTMLInputElement | null, str: string): void {
  if (!inputEl) return;
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const val = inputEl.value;
  inputEl.value = val.substring(0, start) + str + val.substring(end);
  inputEl.selectionStart = inputEl.selectionEnd = start + str.length;
  inputEl.focus();
  inputEl.dispatchEvent(new Event("input"));
}

export class SearchReplaceBar {
  app: App;
  plugin: SearchReplacePlugin;
  containerEl: HTMLElement | null;
  popoverEl: HTMLElement | null;
  onOutsideClick: ((event: MouseEvent) => void) | null;
  searchQuery: string;
  replaceQuery: string;
  showReplace: boolean;
  occurrences: SearchOccurrence[];
  currentIndex: number;
  searchTimer: ReturnType<Window["setTimeout"]> | null;
  options: SearchOptions;
  replacing = false;
  searchVersion = 0;
  highlightedView: SearchMarkdownView | null = null;
  scope: CompileScope | null = null;
  boundView: SearchMarkdownView | null = null;
  previewModal: SearchReplaceConfirmModal | null = null;
  navigating = false;

  private currentView(): SearchMarkdownView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.plugin.getSearchReplaceView?.();
    if (view && hasSearchView(view)) return view;
    return this.boundView && this.app.workspace.getLeavesOfType("markdown").some(({ view: openView }) => openView === this.boundView) ? this.boundView : null;
  }

  private resolveScope(): CompileScope {
    if (this.scope) return this.scope;
    const file = this.currentView()?.file;
    if (!file) throw new GlobalReplaceError("scope");
    const root = this.plugin.getProjectFolder?.();
    const scope = this.options.scope === "folder" && file.parent
      ? this.plugin.compileScopeForFolder?.(file.parent)
      : this.options.scope === "selection"
        ? this.plugin.compileScopeForSelection?.([...(this.plugin._binderMultiSelect ?? [])])
        : this.options.scope === "manuscript"
          ? (() => { const editorial = this.plugin.editorialRootFor?.(file); return editorial ? createProjectScope(editorial.path) : null; })()
          : root ? createProjectScope(root.path) : null;
    if (!scope || scope.type === "selection" && !scope.paths.length) throw new GlobalReplaceError("scope");
    this.scope = scope;
    return scope;
  }

  private globalService(): GlobalSearchReplace {
    const service = this.plugin.getGlobalSearchReplace?.();
    if (!service) throw new GlobalReplaceError("scope");
    return service;
  }

  constructor(app: App, plugin: SearchReplacePlugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = null;
    this.popoverEl = null;
    this.onOutsideClick = null;
    this.searchQuery = "";
    this.replaceQuery = "";
    this.showReplace = false;
    this.occurrences = [];
    this.currentIndex = 0;
    this.searchTimer = null;
    this.options = {
      ignoreCase: true,
      ignoreDiacritics: false,
      matchMode: "contains", // "contains" | "startsWith" | "wholeWord"
      scope: "document",
      includeYaml: false,
      protectMarkdown: false,
    };
  }

  open() {
    const activeLeaf = this.currentView();
    if (!activeLeaf || !hasSearchView(activeLeaf) || !activeLeaf.file?.path.endsWith(".md") || activeLeaf.getMode() !== "source") {
      new Notice(t("searchReplace.openSheetFirst"));
      return;
    }

    const parent = activeLeaf.containerEl;
    this.boundView = activeLeaf;
    const existing = parent.querySelector(".feuillets-search-bar");
    if (existing) {
      const input = existing.querySelector<HTMLInputElement>(".feuillets-search-input-wrapper input");
      if (input) input.focus();
      return;
    }

    this.containerEl = parent.createDiv({ cls: "feuillets-search-bar" });
    this.render();
    void this.runSearch(false);
  }

  close() {
    this.previewModal?.close();
    this.closePopover();
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchVersion++;
    this.clearActiveHighlights();
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }

  toggle() {
    if (this.containerEl) {
      this.close();
    } else {
      this.open();
    }
  }

  render() {
    if (!this.containerEl) return;
    this.containerEl.empty();

    const searchRow = this.containerEl.createDiv({ cls: "feuillets-search-main-row" });

    const inputWrapper = searchRow.createDiv({ cls: "feuillets-search-input-wrapper" });

    const settingsBtn = inputWrapper.createEl("button", {
      cls: "feuillets-search-settings-btn",
      attr: { title: t("searchReplace.settingsTooltip") },
    });
    setIcon(settingsBtn, "search");
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePopover();
    });

    const searchInput = inputWrapper.createEl("input", {
      type: "text",
      cls: "feuillets-search-input",
      attr: { placeholder: t("binder.search.placeholder") },
    });
    searchInput.value = this.searchQuery;
    window.setTimeout(() => searchInput.focus(), 50);

    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.scheduleSearch();
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) void this.navigateMatch(-1);
        else void this.navigateMatch(1);
      }
    });

    const counterEl = searchRow.createSpan({ cls: "feuillets-search-counter" });
    this.updateCounterEl(counterEl);

    this.containerEl.createDiv({ cls: "feuillets-search-scope" });
    this.updateScopeUI();

    const prevBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn",
      attr: { title: t("searchReplace.prevOccurrenceTooltip") },
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => { void this.navigateMatch(-1); });

    const nextBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn",
      attr: { title: t("searchReplace.nextOccurrenceTooltip") },
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => { void this.navigateMatch(1); });

    const toggleReplaceBtn = searchRow.createDiv({
      cls: `feuillets-search-icon-btn ${this.showReplace ? "is-active" : ""}`,
      attr: { title: t("searchReplace.toggleReplaceTooltip") },
    });
    setIcon(toggleReplaceBtn, "replace");
    toggleReplaceBtn.addEventListener("click", () => {
      this.showReplace = !this.showReplace;
      this.render();
      void this.runSearch(false);
    });

    const closeBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn feuillets-close-btn",
      attr: { title: t("searchReplace.closeTooltip") },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    if (this.showReplace) {
      const replaceRow = this.containerEl.createDiv({ cls: "feuillets-search-replace-row" });

      const replaceInput = replaceRow.createEl("input", {
        type: "text",
        cls: "feuillets-replace-input",
        attr: { placeholder: t("searchReplace.replaceWithPlaceholder") },
      });
      replaceInput.value = this.replaceQuery;
      replaceInput.addEventListener("input", () => {
        this.replaceQuery = replaceInput.value;
        this.scheduleSearch(false);
      });

      replaceInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        } else if (e.key === "Enter") {
          e.preventDefault();
          void this.executeReplaceAll();
        }
      });

      const protectionLabel = this.containerEl.createEl("label", { cls: "feuillets-search-protection" });
      const protection = protectionLabel.createEl("input", { type: "checkbox" });
      protection.checked = this.options.protectMarkdown;
      protectionLabel.createSpan({ text: t("searchReplace.options.protectMarkdown") });
      protection.addEventListener("change", () => {
        this.options.protectMarkdown = protection.checked;
        void this.runSearch(false);
      });

      const replaceAllBtn = replaceRow.createEl("button", {
        text: t("searchReplace.replaceAllBtn"),
        cls: "feuillets-btn-replace-all feuillets-replace-all-btn",
      });
      replaceAllBtn.disabled = this.replacing;
      replaceAllBtn.addEventListener("click", () => { void this.executeReplaceAll(); });
    }
  }

  togglePopover() {
    if (this.popoverEl) {
      this.closePopover();
      return;
    }

    this.renderPopover();
  }

  renderPopover() {
    if (!this.containerEl) return;

    if (this.popoverEl) {
      this.popoverEl.remove();
    }

    const popover = this.containerEl.createDiv({ cls: "feuillets-search-popover" });
    this.popoverEl = popover;

    const addItem = (label: string, checked: boolean, onClick: () => void) => {
      const item = popover.createDiv({ cls: "feuillets-search-popover-item" });
      const checkSpan = item.createSpan({ cls: "popover-icon" });
      checkSpan.setText(checked ? "✓" : "");

      item.createSpan().setText(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
        void this.runSearch();
        this.updateScopeUI();
        this.renderPopover();
      });
    };

    const addDivider = () => {
      popover.createDiv({ cls: "feuillets-search-popover-divider" });
    };

    addItem(t("searchReplace.options.ignoreCase"), this.options.ignoreCase, () => {
      this.options.ignoreCase = !this.options.ignoreCase;
    });
    addItem(t("searchReplace.options.ignoreDiacritics"), this.options.ignoreDiacritics, () => {
      this.options.ignoreDiacritics = !this.options.ignoreDiacritics;
    });

    addDivider();

    addItem(t("searchReplace.options.contains"), this.options.matchMode === "contains", () => {
      this.options.matchMode = "contains";
    });
    addItem(t("searchReplace.options.startsWith"), this.options.matchMode === "startsWith", () => {
      this.options.matchMode = "startsWith";
    });
    addItem(t("searchReplace.options.wholeWord"), this.options.matchMode === "wholeWord", () => {
      this.options.matchMode = "wholeWord";
    });

    addDivider();

    const addCharItem = (symbol: string, label: string, textToInsert: string) => {
      const item = popover.createDiv({ cls: "feuillets-search-popover-item" });
      const symbolSpan = item.createSpan({ cls: "popover-icon" });
      symbolSpan.setText(symbol);
      item.createSpan().setText(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = this.containerEl?.querySelector<HTMLInputElement>(".feuillets-search-input-wrapper input") ?? null;
        if (input) {
          insertAtCursor(input, textToInsert);
          this.searchQuery = input.value;
          void this.runSearch();
        }
      });
    };

    addCharItem("⇥", t("searchReplace.options.tab"), "\t");
    addCharItem("¶", t("searchReplace.options.paragraph"), "\n\n");
    addCharItem("↵", t("searchReplace.options.lineBreak"), "\n");

    addDivider();

    addItem(t("searchReplace.options.activeDocument"), this.options.scope === "document", () => {
      this.options.scope = "document";
      this.scope = null;
    });
    for (const [scope, key] of [["folder", "activeFolder"], ["selection", "binderSelection"], ["manuscript", "activeManuscript"], ["project", "wholeProject"]] as const) {
      addItem(t(`searchReplace.options.${key}`), this.options.scope === scope, () => {
        this.options.scope = scope;
        this.scope = null;
      });
    }

    if (!this.onOutsideClick) {
      const onOutsideClick = (e: MouseEvent) => {
        if (this.containerEl && e.target instanceof Node && !this.containerEl.contains(e.target)) {
          this.closePopover();
        }
      };
      this.onOutsideClick = onOutsideClick;
      window.setTimeout(() => {
        document.addEventListener("click", onOutsideClick);
      }, 10);
    }
  }

  closePopover() {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    if (this.onOutsideClick) {
      document.removeEventListener("click", this.onOutsideClick);
      this.onOutsideClick = null;
    }
  }

  updateScopeUI() {
    const scope = this.containerEl?.querySelector(".feuillets-search-scope");
    scope?.setText(this.scopeLabel());
    const button = this.containerEl?.querySelector<HTMLButtonElement>(".feuillets-replace-all-btn");
    if (button) button.disabled = this.replacing;
  }

  private scopeLabel(): string {
    const file = this.currentView()?.file;
    if (this.options.scope === "document") return t("searchReplace.activeDocumentScope", { name: file?.name ?? file?.path ?? "" });
    try {
      const scope = this.resolveScope();
      const name = scope.type === "selection" ? scope.paths.join(", ") : scope.type === "folder" ? scope.path : scope.projectRoot;
      return t(`searchReplace.scope.${this.options.scope}`, { name });
    } catch { return t("searchReplace.error.scope"); }
  }

  handleActiveViewChange() {
    if (!this.containerEl) return;
    this.clearActiveHighlights();
    const view = this.currentView();
    if (!view || !hasSearchView(view) || !view.file?.path.endsWith(".md") || view.getMode() !== "source") {
      this.close();
      return;
    }
    if (!this.navigating && this.boundView?.file !== view.file && this.options.scope !== "selection") this.scope = null;
    this.boundView = view;
    view.containerEl.appendChild(this.containerEl);
    this.updateScopeUI();
    void this.runSearch(false);
  }

  scheduleSearch(navigate = true) {
    this.searchVersion++;
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchTimer = window.setTimeout(() => { void this.runSearch(navigate); }, 200);
  }

  async runSearch(navigate = true) {
    const version = ++this.searchVersion;
    if (!this.searchQuery) {
      this.occurrences = [];
      this.currentIndex = 0;
      this.updateCounterUI();
      this.clearActiveHighlights();
      return;
    }
    const activeView = this.currentView();
    const activeFile = activeView && hasSearchView(activeView) ? activeView.file : null;
    const activeEditor = activeView && hasSearchView(activeView) ? activeView.editor : null;
    const options = { ...this.options, replacementQuery: this.showReplace ? this.replaceQuery : "", activeFile, activeEditor };
    let res: { occurrences: SearchOccurrence[] };
    try {
      res = this.options.scope === "document"
        ? { occurrences: activeFile && activeEditor ? FeuilletsSearchEngine.searchInText(activeEditor.getValue(), activeFile, this.searchQuery, options) : [] }
        : await this.globalService().preview(this.resolveScope(), this.searchQuery, this.showReplace ? this.replaceQuery : "", options);
    } catch (error) {
      if (version !== this.searchVersion) return;
      this.occurrences = [];
      this.updateCounterUI();
      this.clearActiveHighlights();
      this.containerEl?.querySelector(".feuillets-search-scope")?.setText(globalReplaceErrorMessage(error));
      return;
    }
    if (version !== this.searchVersion) return;
    this.occurrences = res.occurrences;
    if (this.currentIndex >= this.occurrences.length) this.currentIndex = 0;
    this.updateCounterUI();
    if (navigate && this.occurrences.length > 0) await this.jumpToCurrentMatch();
    else this.updateActiveEditorHighlights();
  }

  updateCounterUI() {
    if (!this.containerEl) return;
    const counterEl = this.containerEl.querySelector(".feuillets-search-counter");
    if (counterEl) this.updateCounterEl(counterEl);
  }

  updateCounterEl(el: Element | null) {
    if (!el) return;
    const total = this.occurrences.length;
    if (total === 0) {
      el.setText(this.searchQuery ? "0 / 0" : "");
    } else {
      el.setText(`${this.currentIndex + 1} / ${total}`);
    }
  }

  async navigateMatch(delta: number) {
    await this.runSearch(false);
    if (this.occurrences.length === 0) return;
    this.currentIndex = (this.currentIndex + delta + this.occurrences.length) % this.occurrences.length;
    this.updateCounterUI();
    await this.jumpToCurrentMatch();
  }

  async jumpToCurrentMatch() {
    const match = this.occurrences[this.currentIndex];
    if (!match || !match.file) return;

    const activeFile = this.app.workspace.getActiveFile();
    let targetView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!activeFile || activeFile.path !== match.file.path) {
      let leaf = this.app.workspace.getLeavesOfType("markdown").find(({ view }) => view instanceof MarkdownView && view.file?.path === match.file.path && view.getMode() === "source");
      if (!leaf) {
        leaf = this.app.workspace.getLeaf(false);
      }
      this.navigating = true;
      try { await openFileActivating(this.app, leaf, match.file); }
      finally { this.navigating = false; }
      targetView = this.app.workspace.getActiveViewOfType(MarkdownView);
    }

    if (targetView && hasSearchView(targetView) && targetView.editor) {
      const editor = targetView.editor;
      if (editor.getValue().slice(match.index, match.index + match.length) !== match.matchText) {
        await this.runSearch(false);
        return;
      }
      const from = editor.offsetToPos(match.index);
      const to = editor.offsetToPos(match.index + match.length);
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);

      this.updateActiveEditorHighlights(targetView);
    }
  }

  updateActiveEditorHighlights(view?: SearchMarkdownView | null): void {
    const activeView = view || this.currentView();
    if (!activeView || !hasSearchView(activeView) || !activeView.file || !activeView.editor || !activeView.editor.cm) return;

    const currentFilePath = activeView.file.path;
    const docOccurrences = this.occurrences.filter((occ) => occ.file && occ.file.path === currentFilePath);

    const activeMatch = this.occurrences[this.currentIndex];
    let activeIndexInDoc = -1;

    if (activeMatch && activeMatch.file && activeMatch.file.path === currentFilePath) {
      activeIndexInDoc = docOccurrences.findIndex((occ) => occ.index === activeMatch.index);
    }

    if (this.highlightedView && this.highlightedView !== activeView) this.clearActiveHighlights();
    this.highlightedView = activeView;
    applyEditorHighlights(activeView.editor.cm, docOccurrences, activeIndexInDoc);
  }

  clearActiveHighlights(): void {
    const activeView = this.highlightedView ?? this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && hasSearchView(activeView) && activeView.editor?.cm) clearEditorHighlights(activeView.editor.cm);
    this.highlightedView = null;
  }

  async executeReplaceAll() {
    if (this.replacing) return;
    if (!this.searchQuery) {
      new Notice(t("searchReplace.enterSearchTerm"));
      return;
    }
    const view = this.currentView();
    if (!view || !hasSearchView(view) || !view.file?.path.endsWith(".md") || !view.editor || view.getMode() !== "source") {
      new Notice(t("searchReplace.openSheetFirst"));
      return;
    }
    this.replacing = true;
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchVersion++;
    this.updateScopeUI();
    const container = this.containerEl;
    try {
      let result: { totalReplacements: number; filesCount: number };
      if (this.options.scope === "document") {
        result = FeuilletsSearchEngine.replaceInEditor(view.editor, this.searchQuery, this.replaceQuery, this.options);
      } else {
        const service = this.globalService();
        const plan = await service.preview(this.resolveScope(), this.searchQuery, this.replaceQuery, this.options);
        if (!plan.eligible) {
          new Notice(plan.found ? t("searchReplace.noEligible", { protected: String(plan.protectedCount), identical: String(plan.unchangedCount) }) : t("searchReplace.noMatches"));
          return;
        }
        if (this.containerEl !== container) return;
        const modal = new SearchReplaceConfirmModal(this.app, plan, this.scopeLabel());
        this.previewModal = modal;
        const confirmed = await modal.confirm();
        this.previewModal = null;
        if (!confirmed) return;
        result = await service.apply(plan);
      }
      const { totalReplacements, filesCount } = result;
      // Refresh highlights without moving the selections mapped by the transaction.
      await this.runSearch(false);
      new Notice(totalReplacements > 0
        ? t("searchReplace.replacedNotice", { count: String(totalReplacements), s1: totalReplacements > 1 ? "s" : "", files: String(filesCount), s2: filesCount > 1 ? "s" : "" })
        : t("searchReplace.noReplacements"));
    } catch (error) {
      console.error("Feuillets: Replace all failed", error);
      new Notice(error instanceof GlobalReplaceError ? globalReplaceErrorMessage(error) : t("searchReplace.replaceFailed"));
    } finally {
      this.replacing = false;
      this.updateScopeUI();
    }
  }
}
