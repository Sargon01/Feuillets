const { MarkdownView, Notice, setIcon } = require("obsidian");
import { FeuilletsSearchEngine } from "../services/feuillets-search-engine.js";
import { openFileActivating } from "../utils/dom.js";
import { applyEditorHighlights, clearEditorHighlights } from "../utils/cm-search-highlighter.js";
import { t } from "../i18n/index.js";

function insertAtCursor(inputEl, str) {
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
  constructor(app, plugin) {
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
      scope: "manuscript",   // "document" | "manuscript"
      includeYaml: false,
    };
  }

  open() {
    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeLeaf) {
      new Notice(t("searchReplace.openSheetFirst"));
      return;
    }

    const parent = activeLeaf.containerEl;
    const existing = parent.querySelector(".feuillets-search-bar");
    if (existing) {
      const input = existing.querySelector(".feuillets-search-input-wrapper input");
      if (input) input.focus();
      return;
    }

    this.containerEl = parent.createDiv({ cls: "feuillets-search-bar" });
    this.render();
  }

  close() {
    this.closePopover();
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

    // --- Ligne Principale : Recherche & Navigation ---
    const searchRow = this.containerEl.createDiv({ cls: "feuillets-search-main-row" });

    // Zone d'entrée avec loupe intégrée à gauche
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
    setTimeout(() => searchInput.focus(), 50);

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
        if (e.shiftKey) this.navigateMatch(-1);
        else this.navigateMatch(1);
      }
    });

    // Compteur d'occurrences (ex: 3 / 15)
    const counterEl = searchRow.createSpan({ cls: "feuillets-search-counter" });
    this.updateCounterEl(counterEl);

    // Flèche Précédent (<)
    const prevBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn",
      attr: { title: t("searchReplace.prevOccurrenceTooltip") },
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => this.navigateMatch(-1));

    // Flèche Suivant (>)
    const nextBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn",
      attr: { title: t("searchReplace.nextOccurrenceTooltip") },
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => this.navigateMatch(1));

    // Bouton de bascule Remplacement
    const toggleReplaceBtn = searchRow.createDiv({
      cls: `feuillets-search-icon-btn ${this.showReplace ? "is-active" : ""}`,
      attr: { title: t("searchReplace.toggleReplaceTooltip") },
    });
    setIcon(toggleReplaceBtn, "replace");
    toggleReplaceBtn.addEventListener("click", () => {
      this.showReplace = !this.showReplace;
      this.render();
    });

    // Bouton Fermer (×)
    const closeBtn = searchRow.createDiv({
      cls: "feuillets-search-icon-btn feuillets-close-btn",
      attr: { title: t("searchReplace.closeTooltip") },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    // --- Ligne Remplacement (Si activée) ---
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
      });

      replaceInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        } else if (e.key === "Enter") {
          e.preventDefault();
          this.executeReplaceAll();
        }
      });

      // Bouton Remplacer tout (CTA)
      const replaceAllBtn = replaceRow.createEl("button", {
        text: t("searchReplace.replaceAllBtn"),
        cls: "feuillets-btn-replace-all feuillets-replace-all-btn",
      });
      replaceAllBtn.addEventListener("click", () => this.executeReplaceAll());
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

    this.popoverEl = this.containerEl.createDiv({ cls: "feuillets-search-popover" });

    const addItem = (label, checked, onClick) => {
      const item = this.popoverEl.createDiv({ cls: "feuillets-search-popover-item" });
      const checkSpan = item.createSpan({ cls: "popover-icon" });
      checkSpan.setText(checked ? "✓" : "");

      item.createSpan().setText(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
        this.runSearch();
        this.renderPopover();
      });
    };

    const addDivider = () => {
      this.popoverEl.createDiv({ cls: "feuillets-search-popover-divider" });
    };

    // 1. Casse & Diacritiques
    addItem(t("searchReplace.options.ignoreCase"), this.options.ignoreCase, () => {
      this.options.ignoreCase = !this.options.ignoreCase;
    });
    addItem(t("searchReplace.options.ignoreDiacritics"), this.options.ignoreDiacritics, () => {
      this.options.ignoreDiacritics = !this.options.ignoreDiacritics;
    });

    addDivider();

    // 2. Mode de correspondance
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

    // 3. Caractères spéciaux
    const addCharItem = (symbol, label, textToInsert) => {
      const item = this.popoverEl.createDiv({ cls: "feuillets-search-popover-item" });
      const symbolSpan = item.createSpan({ cls: "popover-icon" });
      symbolSpan.setText(symbol);
      item.createSpan().setText(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = this.containerEl?.querySelector(".feuillets-search-input-wrapper input");
        if (input) {
          insertAtCursor(input, textToInsert);
          this.searchQuery = input.value;
          this.runSearch();
        }
      });
    };

    addCharItem("⇥", t("searchReplace.options.tab"), "\t");
    addCharItem("¶", t("searchReplace.options.paragraph"), "\n\n");
    addCharItem("↵", t("searchReplace.options.lineBreak"), "\n");

    addDivider();

    // 4. Portée
    addItem(t("searchReplace.options.activeDocument"), this.options.scope === "document", () => {
      this.options.scope = "document";
    });
    addItem(t("searchReplace.options.activeFolder"), this.options.scope === "manuscript", () => {
      this.options.scope = "manuscript";
    });

    // Clic extérieur pour fermer
    if (!this.onOutsideClick) {
      this.onOutsideClick = (e) => {
        if (this.containerEl && !this.containerEl.contains(e.target)) {
          this.closePopover();
        }
      };
      setTimeout(() => {
        document.addEventListener("click", this.onOutsideClick);
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

  scheduleSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 200);
  }

  async runSearch() {
    if (!this.searchQuery) {
      this.occurrences = [];
      this.currentIndex = 0;
      this.updateCounterUI();
      this.clearActiveHighlights();
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const res = await FeuilletsSearchEngine.searchInVault(this.app, this.plugin, this.searchQuery, {
      ...this.options,
      activeFile,
    });

    this.occurrences = res.occurrences;
    if (this.currentIndex >= this.occurrences.length) {
      this.currentIndex = 0;
    }
    this.updateCounterUI();

    if (this.occurrences.length > 0) {
      await this.jumpToCurrentMatch();
    } else {
      this.clearActiveHighlights();
    }
  }

  updateCounterUI() {
    if (!this.containerEl) return;
    const counterEl = this.containerEl.querySelector(".feuillets-search-counter");
    if (counterEl) this.updateCounterEl(counterEl);
  }

  updateCounterEl(el) {
    if (!el) return;
    const total = this.occurrences.length;
    if (total === 0) {
      el.setText(this.searchQuery ? "0 / 0" : "");
    } else {
      el.setText(`${this.currentIndex + 1} / ${total}`);
    }
  }

  async navigateMatch(delta) {
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
      let leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => l.view && l.view.file && l.view.file.path === match.file.path);
      if (!leaf) {
        leaf = this.app.workspace.getLeaf(false);
      }
      openFileActivating(this.app, leaf, match.file);
      await new Promise((resolve) => setTimeout(resolve, 80));
      targetView = this.app.workspace.getActiveViewOfType(MarkdownView);
    }

    if (targetView && targetView.editor) {
      const editor = targetView.editor;
      editor.setSelection({ line: match.line, ch: match.ch }, { line: match.line, ch: match.ch + match.length });
      editor.scrollIntoView({ from: { line: match.line, ch: match.ch }, to: { line: match.line, ch: match.ch + match.length } }, true);

      this.updateActiveEditorHighlights(targetView);
    }
  }

  updateActiveEditorHighlights(view) {
    const activeView = view || this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file || !activeView.editor || !activeView.editor.cm) return;

    const currentFilePath = activeView.file.path;
    const docOccurrences = this.occurrences.filter((occ) => occ.file && occ.file.path === currentFilePath);

    const activeMatch = this.occurrences[this.currentIndex];
    let activeIndexInDoc = -1;

    if (activeMatch && activeMatch.file && activeMatch.file.path === currentFilePath) {
      activeIndexInDoc = docOccurrences.findIndex((occ) => occ.index === activeMatch.index);
    }

    applyEditorHighlights(activeView.editor.cm, docOccurrences, activeIndexInDoc);
  }

  clearActiveHighlights() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor && activeView.editor.cm) {
      clearEditorHighlights(activeView.editor.cm);
    }
  }

  async executeReplaceAll() {
    if (!this.searchQuery) {
      new Notice(t("searchReplace.enterSearchTerm"));
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const { totalReplacements, filesCount } = await FeuilletsSearchEngine.replaceInVault(
      this.app,
      this.plugin,
      this.searchQuery,
      this.replaceQuery,
      {
        scope: this.options.scope,
        ignoreCase: this.options.ignoreCase,
        ignoreDiacritics: this.options.ignoreDiacritics,
        matchMode: this.options.matchMode,
        activeFile,
      }
    );

    new Notice(
      t("searchReplace.replacedNotice", { count: totalReplacements, s1: totalReplacements > 1 ? "s" : "", files: filesCount, s2: filesCount > 1 ? "s" : "" })
    );

    await this.runSearch();
    await this.plugin.renderAllViews(true);
  }
}
