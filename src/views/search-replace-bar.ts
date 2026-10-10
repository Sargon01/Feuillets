import { MarkdownView, Menu, Notice, setIcon, type App, type TFile, type TFolder, type Editor } from "obsidian";
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

function insertAtCursor(inputEl: HTMLTextAreaElement | null, str: string): void {
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
  characterMenu: Menu | null = null;
  showOptions = false;
  pendingSearch = false;
  private searchFailed = false;
  private eligibleOccurrences = new Set<SearchOccurrence>();
  private undoVersion = 0;
  private undoStatus: Awaited<ReturnType<GlobalSearchReplace["getUndoStatus"]>> = null;
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

    if (this.containerEl) {
      this.containerEl.querySelector<HTMLTextAreaElement>(".feuillets-search-input")?.focus();
      return;
    }
    this.showReplace = false;
    this.showOptions = false;
    const parent = activeLeaf.containerEl;
    if (this.boundView?.file !== activeLeaf.file && this.options.scope !== "selection") this.scope = null;
    this.boundView = activeLeaf;
    const existing = parent.querySelector(".feuillets-search-bar");
    if (existing) {
      const input = existing.querySelector<HTMLTextAreaElement>(".feuillets-search-input");
      if (input) input.focus();
      return;
    }

    this.containerEl = parent.createDiv({ cls: "feuillets-search-bar" });
    this.render();
    this.containerEl.querySelector<HTMLTextAreaElement>(".feuillets-search-input")?.focus();
    void this.runSearch(false);
  }

  close() {
    this.previewModal?.close();
    this.closeCharacterMenu();
    this.undoVersion++;
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchTimer = null;
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
    const panel = this.containerEl;
    panel.empty();
    panel.setAttr("role", "search");
    panel.setAttr("aria-label", t("searchReplace.title"));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
    });

    const header = panel.createDiv({ cls: "feuillets-search-header" });
    setIcon(header.createSpan({ attr: { "aria-hidden": "true" } }), "search");
    header.createSpan({ text: t("searchReplace.title") });
    this.iconButton(header, "x", "searchReplace.closeTooltip", "feuillets-close-btn", () => this.close());

    const scopeRow = panel.createEl("label", { cls: "feuillets-search-scope-row" });
    scopeRow.createSpan({ text: t("searchReplace.scopeLabel") });
    const scopeSelect = scopeRow.createEl("select", { cls: "feuillets-search-scope", attr: { "aria-label": t("searchReplace.scopeLabel") } });
    for (const scope of ["document", "folder", "selection", "manuscript", "project"] as const) {
      scopeSelect.createEl("option", { value: scope, text: this.scopeLabel(scope) });
    }
    scopeSelect.value = this.options.scope;
    scopeSelect.addEventListener("change", () => {
      const scope = scopeSelect.value;
      if (scope !== "document" && scope !== "folder" && scope !== "selection" && scope !== "manuscript" && scope !== "project") return;
      this.options.scope = scope;
      this.scope = null;
      this.currentIndex = 0;
      this.updateScopeUI();
      void this.runSearch(false);
    });

    const searchRow = panel.createDiv({ cls: "feuillets-search-main-row" });
    const searchInput = this.queryField(searchRow, false);
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.currentIndex = 0;
      this.scheduleSearch(false);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void this.navigateMatch(event.shiftKey ? -1 : 1); }
    });
    this.iconButton(searchRow, "chevron-left", "searchReplace.prevOccurrenceTooltip", "feuillets-search-prev", () => { void this.navigateMatch(-1); });
    this.iconButton(searchRow, "chevron-right", "searchReplace.nextOccurrenceTooltip", "feuillets-search-next", () => { void this.navigateMatch(1); });
    searchRow.createSpan({ cls: "feuillets-search-counter", attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });

    const secondary = panel.createDiv({ cls: "feuillets-search-secondary" });
    const optionsButton = secondary.createEl("button", { cls: "feuillets-search-options-toggle", attr: { "aria-expanded": "false" } });
    setIcon(optionsButton.createSpan({ attr: { "aria-hidden": "true" } }), "sliders-horizontal");
    optionsButton.createSpan({ text: t("searchReplace.optionsLabel") });
    optionsButton.addEventListener("click", () => {
      this.showOptions = !this.showOptions;
      optionsSection.hidden = !this.showOptions;
      optionsButton.setAttr("aria-expanded", String(this.showOptions));
    });
    const replaceButton = secondary.createEl("button", { text: t("searchReplace.replaceBtn"), cls: "feuillets-search-replace-toggle", attr: { "aria-expanded": "false" } });
    replaceButton.addEventListener("click", () => this.toggleReplace());

    const optionsSection = panel.createDiv({ cls: "feuillets-search-options" });
    optionsSection.hidden = !this.showOptions;
    this.checkbox(optionsSection, "searchReplace.options.respectCase", !this.options.ignoreCase, (checked) => { this.options.ignoreCase = !checked; }, "feuillets-search-case");
    this.checkbox(optionsSection, "searchReplace.options.ignoreDiacritics", this.options.ignoreDiacritics, (checked) => { this.options.ignoreDiacritics = checked; }, "feuillets-search-accents");
    const modes = optionsSection.createEl("fieldset", { cls: "feuillets-search-match-modes" });
    modes.createEl("legend", { text: t("searchReplace.matchModeLabel") });
    for (const mode of ["contains", "startsWith", "wholeWord"] as const) {
      const label = modes.createEl("label");
      const radio = label.createEl("input", { type: "radio", cls: `feuillets-search-mode-${mode}`, attr: { name: "feuillets-search-match-mode", value: mode } });
      radio.checked = this.options.matchMode === mode;
      label.createSpan({ text: t(`searchReplace.options.${mode}`) });
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        this.options.matchMode = mode;
        this.currentIndex = 0;
        void this.runSearch(false);
      });
    }
    this.checkbox(optionsSection, "searchReplace.options.includeYaml", this.options.includeYaml, (checked) => { this.options.includeYaml = checked; }, "feuillets-search-yaml");

    const replaceSection = panel.createDiv({ cls: "feuillets-search-replace-section" });
    replaceSection.hidden = !this.showReplace;
    replaceSection.createSpan({ cls: "feuillets-search-field-label", text: t("searchReplace.replaceWithLabel") });
    const replaceRow = replaceSection.createDiv({ cls: "feuillets-search-replace-row" });
    const replaceInput = this.queryField(replaceRow, true);
    replaceInput.addEventListener("input", () => {
      this.replaceQuery = replaceInput.value;
      this.scheduleSearch(false);
    });
    replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void this.executeReplaceAll(); }
    });
    this.checkbox(replaceSection, "searchReplace.options.protectMarkdown", this.options.protectMarkdown, (checked) => { this.options.protectMarkdown = checked; }, "feuillets-search-protection");
    const actions = replaceSection.createDiv({ cls: "feuillets-search-replace-actions" });
    actions.createEl("button", { cls: "feuillets-replace-current-btn", text: t("searchReplace.replaceBtn") }).addEventListener("click", () => { void this.executeReplaceCurrent(); });
    actions.createEl("button", { cls: "feuillets-replace-all-btn", text: t("searchReplace.replaceAllBtn") }).addEventListener("click", () => { void this.executeReplaceAll(); });

    const undo = panel.createDiv({ cls: "feuillets-search-undo" });
    undo.hidden = true;
    undo.createSpan({ cls: "feuillets-search-undo-summary" });
    undo.createEl("button", { cls: "feuillets-search-undo-btn", text: t("searchReplace.undoBtn"), attr: { title: t("searchReplace.undoCommand"), "aria-label": t("searchReplace.undoCommand") } }).addEventListener("click", () => { void this.executeUndo(); });
    panel.createDiv({ cls: "feuillets-search-status", attr: { role: "status", "aria-live": "polite" } });
    this.updateScopeUI();
    this.updateCounterUI();
  }

  private iconButton(parent: HTMLElement, icon: string, key: string, cls: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `feuillets-search-icon-btn ${cls}`, attr: { title: t(key), "aria-label": t(key), type: "button" } });
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  private queryField(parent: HTMLElement, replacement: boolean): HTMLTextAreaElement {
    const wrapper = parent.createDiv({ cls: replacement ? "feuillets-replace-input-wrapper" : "feuillets-search-input-wrapper" });
    const input = wrapper.createEl("textarea", {
      cls: replacement ? "feuillets-replace-input" : "feuillets-search-input",
      attr: { rows: "1", spellcheck: "false", "aria-label": t(replacement ? "searchReplace.replaceWithLabel" : "searchReplace.title"), placeholder: t(replacement ? "searchReplace.replaceWithPlaceholder" : "binder.search.placeholder") },
    });
    input.value = replacement ? this.replaceQuery : this.searchQuery;
    this.iconButton(wrapper, "pilcrow", "searchReplace.specialCharacters", "feuillets-search-characters", () => this.showCharacterMenu(input));
    return input;
  }

  private checkbox(parent: HTMLElement, key: string, checked: boolean, update: (checked: boolean) => void, cls: string): void {
    const label = parent.createEl("label", { cls: "feuillets-search-checkbox" });
    const input = label.createEl("input", { type: "checkbox", cls });
    input.checked = checked;
    label.createSpan({ text: t(key) });
    input.addEventListener("change", () => { update(input.checked); this.currentIndex = 0; void this.runSearch(false); });
  }

  toggleReplace(): void {
    this.showReplace = !this.showReplace;
    this.closeCharacterMenu();
    const section = this.containerEl?.querySelector<HTMLElement>(".feuillets-search-replace-section");
    if (section) section.hidden = !this.showReplace;
    const button = this.containerEl?.querySelector(".feuillets-search-replace-toggle");
    button?.setText(t(this.showReplace ? "searchReplace.hideReplace" : "searchReplace.replaceBtn"));
    button?.setAttr("aria-expanded", String(this.showReplace));
    this.containerEl?.querySelector<HTMLTextAreaElement>(this.showReplace ? ".feuillets-replace-input" : ".feuillets-search-input")?.focus();
    void this.runSearch(false);
  }

  showCharacterMenu(input: HTMLTextAreaElement): void {
    this.closeCharacterMenu();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const container = this.containerEl;
    const menu = new Menu();
    this.characterMenu = menu;
    for (const [key, value] of [["tab", "\t"], ["lineBreak", "\n"], ["paragraph", "\n\n"]] as const) {
      menu.addItem((item) => item.setTitle(t(`searchReplace.options.${key}`)).onClick(() => {
        if (!container || this.containerEl !== container) return;
        input.selectionStart = start;
        input.selectionEnd = end;
        insertAtCursor(input, value);
      }));
    }
    menu.onHide(() => { if (this.characterMenu === menu) this.characterMenu = null; });
    const rect = input.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, input.ownerDocument);
  }

  private closeCharacterMenu(): void {
    this.characterMenu?.hide();
    this.characterMenu = null;
  }

  updateScopeUI() {
    const select = this.containerEl?.querySelector<HTMLSelectElement>(".feuillets-search-scope");
    if (select) {
      for (const option of Array.from(select.options)) option.text = this.scopeLabel(option.value as SearchScope);
      select.value = this.options.scope;
      const scope = this.scope;
      select.title = scope ? scope.type === "selection" ? scope.paths.join(", ") : scope.type === "folder" || scope.type === "file" ? scope.path : scope.projectRoot : this.currentView()?.file?.path ?? "";
    }
    this.updateControls();
  }

  private scopeLabel(scope: SearchScope = this.options.scope): string {
    const file = this.currentView()?.file;
    if (scope === "document") return t("searchReplace.activeDocumentScope", { name: file?.name ?? "" });
    if (scope === "selection") return t("searchReplace.options.binderSelection");
    const resolved = scope === this.options.scope ? this.scope : null;
    const path = resolved ? resolved.type === "folder" || resolved.type === "file" ? resolved.path : resolved.projectRoot
      : scope === "folder" ? file?.parent?.path : scope === "manuscript" && file ? this.plugin.editorialRootFor?.(file)?.path : this.plugin.getProjectFolder?.()?.path;
    const name = path?.split("/").pop() ?? "";
    const label = t(`searchReplace.scope.${scope}`, { name });
    return name ? label : t(`searchReplace.options.${scope === "folder" ? "activeFolder" : scope === "manuscript" ? "activeManuscript" : "wholeProject"}`);
  }

  private updateControls(): void {
    const busy = this.replacing || this.pendingSearch;
    const hasMatches = !!this.searchQuery && this.occurrences.length > 0;
    for (const cls of ["feuillets-search-prev", "feuillets-search-next"]) {
      const button = this.containerEl?.querySelector<HTMLButtonElement>(`.${cls}`);
      if (button) button.disabled = busy || !hasMatches;
    }
    const current = this.containerEl?.querySelector<HTMLButtonElement>(".feuillets-replace-current-btn");
    if (current) current.disabled = busy || !hasMatches || !this.eligibleOccurrences.has(this.occurrences[this.currentIndex]);
    const all = this.containerEl?.querySelector<HTMLButtonElement>(".feuillets-replace-all-btn");
    if (all) all.disabled = busy || !hasMatches || !this.eligibleOccurrences.size;
    const undo = this.containerEl?.querySelector<HTMLButtonElement>(".feuillets-search-undo-btn");
    if (undo) undo.disabled = this.replacing || !this.undoStatus || !!this.undoStatus.error;
  }

  async refreshUndoState(): Promise<void> {
    const container = this.containerEl;
    if (!container) return;
    const version = ++this.undoVersion;
    let status: typeof this.undoStatus = null;
    let errorMessage = "";
    try { status = await this.plugin.getGlobalSearchReplace?.().getUndoStatus() ?? null; }
    catch (error) { errorMessage = globalReplaceErrorMessage(error); }
    if (version !== this.undoVersion || this.containerEl !== container) return;
    this.undoStatus = status;
    const row = container.querySelector<HTMLElement>(".feuillets-search-undo");
    if (row) row.hidden = !status && !errorMessage;
    container.querySelector(".feuillets-search-undo-summary")?.setText(errorMessage || (status?.error ? globalReplaceErrorMessage(status.error)
      : status?.complete ? t("searchReplace.undoSummary", { count: String(status.totalReplacements), files: String(status.filesCount), s1: status.totalReplacements > 1 ? "s" : "", s2: status.filesCount > 1 ? "s" : "" }) : status ? t("searchReplace.undoCommand") : ""));
    this.updateControls();
  }

  async executeUndo(): Promise<void> {
    if (this.replacing) return;
    this.replacing = true;
    this.updateControls();
    try {
      const files = await this.globalService().undoLast();
      new Notice(t("searchReplace.undoSuccess", { files: String(files), s: files > 1 ? "s" : "" }));
      await this.runSearch(false);
    } catch (error) { new Notice(globalReplaceErrorMessage(error)); }
    finally { this.replacing = false; await this.refreshUndoState(); this.updateControls(); }
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
    if (this.containerEl.parentElement !== view.containerEl) {
      const focused = this.containerEl.ownerDocument.activeElement;
      const retainFocus = focused instanceof HTMLElement && this.containerEl.contains(focused);
      view.containerEl.appendChild(this.containerEl);
      if (retainFocus) focused.focus();
    }
    this.updateScopeUI();
    if (!this.navigating) void this.runSearch(false);
  }

  scheduleSearch(navigate = false) {
    this.searchVersion++;
    this.pendingSearch = true;
    this.updateCounterUI();
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchTimer = window.setTimeout(() => { this.searchTimer = null; void this.runSearch(navigate); }, 200);
  }

  async runSearch(navigate = false): Promise<boolean> {
    window.clearTimeout(this.searchTimer ?? undefined);
    this.searchTimer = null;
    const version = ++this.searchVersion;
    this.pendingSearch = true;
    this.searchFailed = false;
    this.updateCounterUI();
    this.containerEl?.querySelector(".feuillets-search-status")?.setText("");
    void this.refreshUndoState();
    if (!this.searchQuery) {
      this.occurrences = [];
      this.eligibleOccurrences.clear();
      this.currentIndex = 0;
      this.pendingSearch = false;
      this.updateCounterUI();
      this.clearActiveHighlights();
      return true;
    }
    const activeView = this.currentView();
    const activeFile = activeView && hasSearchView(activeView) ? activeView.file : null;
    const activeEditor = activeView && hasSearchView(activeView) ? activeView.editor : null;
    const options = { ...this.options, protectMarkdown: this.showReplace && this.options.protectMarkdown, replacementQuery: this.showReplace ? this.replaceQuery : "", activeFile, activeEditor };
    let res: { occurrences: SearchOccurrence[] };
    const eligible = new Set<SearchOccurrence>();
    try {
      if (this.options.scope === "document") {
        const content = activeEditor?.getValue() ?? "";
        res = { occurrences: activeFile && activeEditor ? FeuilletsSearchEngine.searchInText(content, activeFile, this.searchQuery, options) : [] };
        const changes = FeuilletsSearchEngine.planReplacements(content, this.searchQuery, this.replaceQuery, options);
        const offsets = new Set(changes.map(({ from }) => from));
        for (const occurrence of res.occurrences) if (offsets.has(occurrence.index)) eligible.add(occurrence);
      } else {
        const plan = await this.globalService().preview(this.resolveScope(), this.searchQuery, this.replaceQuery, options);
        res = plan;
        const offsets = new Map(plan.documents.map(({ path, changes }) => [path, new Set(changes.map(({ from }) => from))]));
        for (const occurrence of res.occurrences) if (offsets.get(occurrence.file.path)?.has(occurrence.index)) eligible.add(occurrence);
      }
    } catch (error) {
      if (version !== this.searchVersion) return false;
      this.pendingSearch = false;
      this.searchFailed = true;
      this.eligibleOccurrences.clear();
      this.occurrences = [];
      this.updateCounterUI();
      this.clearActiveHighlights();
      this.containerEl?.querySelector(".feuillets-search-status")?.setText(globalReplaceErrorMessage(error));
      return false;
    }
    if (version !== this.searchVersion) return false;
    this.pendingSearch = false;
    this.eligibleOccurrences = eligible;
    this.occurrences = res.occurrences;
    if (this.currentIndex >= this.occurrences.length) this.currentIndex = 0;
    this.updateCounterUI();
    if (navigate && this.occurrences.length > 0) await this.jumpToCurrentMatch(version);
    else this.updateActiveEditorHighlights();
    this.updateScopeUI();
    return version === this.searchVersion;
  }

  updateCounterUI() {
    if (!this.containerEl) return;
    const counterEl = this.containerEl.querySelector(".feuillets-search-counter");
    if (counterEl) this.updateCounterEl(counterEl);
    this.updateControls();
  }

  updateCounterEl(el: Element | null) {
    if (!el) return;
    if (this.pendingSearch || this.searchFailed) { el.setText(""); return; }
    const total = this.occurrences.length;
    if (total === 0) {
      el.setText(this.searchQuery && !this.pendingSearch ? t("searchReplace.noOccurrences") : "");
    } else {
      el.setText(`${this.currentIndex + 1} / ${total}`);
    }
  }

  async navigateMatch(delta: number) {
    if (this.replacing || !await this.runSearch(false) || this.occurrences.length === 0) return;
    this.currentIndex = (this.currentIndex + delta + this.occurrences.length) % this.occurrences.length;
    this.updateCounterUI();
    await this.jumpToCurrentMatch();
  }

  async jumpToCurrentMatch(version = this.searchVersion) {
    const match = this.occurrences[this.currentIndex];
    if (!match || !match.file) return;

    const activeFile = this.currentView()?.file;
    let targetView = this.currentView();

    if (!activeFile || activeFile.path !== match.file.path) {
      let leaf = this.app.workspace.getLeavesOfType("markdown").find(({ view }) => view instanceof MarkdownView && view.file?.path === match.file.path && view.getMode() === "source");
      if (!leaf) {
        leaf = this.app.workspace.getLeaf(false);
      }
      this.navigating = true;
      try { await openFileActivating(this.app, leaf, match.file); }
      finally { this.navigating = false; }
      targetView = this.currentView();
    }

    if (version !== this.searchVersion) return;
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

  async executeReplaceCurrent(): Promise<void> {
    if (this.replacing || !this.searchQuery) return;
    // Capture the selected occurrence before any asynchronous scope read.
    const selected = this.occurrences[this.currentIndex];
    if (!selected) return;
    this.replacing = true;
    const container = this.containerEl;
    const query = this.searchQuery;
    const replacement = this.replaceQuery;
    const options = { ...this.options };
    try {
      if (!await this.runSearch(false) || this.containerEl !== container) return;
      const version = this.searchVersion;
      const index = this.occurrences.findIndex((match) => match.file === selected.file && match.index === selected.index && match.matchText === selected.matchText);
      if (index < 0 || !this.eligibleOccurrences.has(this.occurrences[index])) return;
      this.currentIndex = index;
      await this.jumpToCurrentMatch(version);
      if (version !== this.searchVersion || this.containerEl !== container) return;
      const view = this.currentView();
      if (!view?.editor || view.file !== selected.file) throw new GlobalReplaceError("changed", [selected.file.path]);
      // Reuse global scope validation before a local editor transaction in a wider scope.
      if (options.scope !== "document") {
        const plan = await this.globalService().preview(this.resolveScope(), query, replacement, options);
        if (version !== this.searchVersion || this.containerEl !== container) return;
        if (!plan.occurrences.some((match) => match.file === selected.file && match.index === selected.index && match.matchText === selected.matchText)) throw new GlobalReplaceError("changed", [selected.file.path]);
      }
      FeuilletsSearchEngine.replaceOccurrenceInEditor(view.editor, selected, query, replacement, options);
      await this.runSearch(false);
    } catch (error) { new Notice(globalReplaceErrorMessage(error)); }
    finally { this.replacing = false; this.updateCounterUI(); }
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
    const version = this.searchVersion;
    let refreshed = false;
    this.pendingSearch = false;
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
        if (this.containerEl !== container || version !== this.searchVersion) return;
        const modal = new SearchReplaceConfirmModal(this.app, plan, this.scopeLabel());
        this.previewModal = modal;
        const confirmed = await modal.confirm();
        this.previewModal = null;
        if (!confirmed || this.containerEl !== container) return;
        if (version !== this.searchVersion) throw new GlobalReplaceError("changed");
        result = await service.apply(plan);
      }
      const { totalReplacements, filesCount } = result;
      // Refresh highlights without moving the selections mapped by the transaction.
      await this.runSearch(false);
      refreshed = true;
      new Notice(totalReplacements > 0
        ? t("searchReplace.replacedNotice", { count: String(totalReplacements), s1: totalReplacements > 1 ? "s" : "", files: String(filesCount), s2: filesCount > 1 ? "s" : "" })
        : t("searchReplace.noReplacements"));
    } catch (error) {
      console.error("Feuillets: Replace all failed", error);
      new Notice(error instanceof GlobalReplaceError ? globalReplaceErrorMessage(error) : t("searchReplace.replaceFailed"));
    } finally {
      if (!refreshed && this.containerEl === container) await this.runSearch(false);
      this.replacing = false;
      await this.refreshUndoState();
      this.updateScopeUI();
    }
  }
}
