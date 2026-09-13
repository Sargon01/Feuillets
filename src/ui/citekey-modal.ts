import { Modal, type App } from "obsidian";
import type { BibtexCatalogEntry } from "../services/bibtex-catalog.js";
import { searchBibtexCatalog } from "../services/bibtex-catalog.js";
import { cleanCitationPages, type CitationReferenceItem } from "../utils/cm-citekey-trigger.js";
import { t } from "../i18n/index.js";

export interface CitekeySelectionItem {
  entry: BibtexCatalogEntry;
  pages: string;
}

export class CitekeyModal extends Modal {
  readonly entries: readonly BibtexCatalogEntry[];
  private readonly onInsert: (items: readonly CitationReferenceItem[]) => void;
  private readonly onCloseCallback?: () => void;
  private selectedItems: CitekeySelectionItem[] = [];
  private searchQuery = "";
  private activeIndex = 0;
  private inserted = false;
  private closed = false;

  private searchInputEl: HTMLInputElement | null = null;
  private resultsContainerEl: HTMLElement | null = null;
  private selectedContainerEl: HTMLElement | null = null;
  private insertButtonEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    entries: readonly BibtexCatalogEntry[],
    onInsert: (items: readonly CitationReferenceItem[]) => void,
    onCloseCallback?: () => void,
  ) {
    super(app);
    this.entries = entries;
    this.onInsert = onInsert;
    this.onCloseCallback = onCloseCallback;
  }

  getSuggestions(query: string): BibtexCatalogEntry[] {
    return searchBibtexCatalog(this.entries, query, 30);
  }

  getSearchResults(): readonly BibtexCatalogEntry[] {
    return searchBibtexCatalog(this.entries, this.searchQuery, 30);
  }

  getSelectedItems(): readonly CitekeySelectionItem[] {
    return this.selectedItems;
  }

  getActiveIndex(): number {
    return this.activeIndex;
  }

  getSearchInput(): HTMLInputElement | null {
    return this.searchInputEl;
  }

  addReference(entryOrKey: string | BibtexCatalogEntry, pages = ""): boolean {
    const entry = typeof entryOrKey === "string"
      ? this.entries.find((e) => e.key === entryOrKey)
      : entryOrKey;

    if (!entry) return false;

    if (this.selectedItems.some((item) => item.entry.key === entry.key)) {
      return false;
    }

    this.selectedItems.push({
      entry,
      pages: cleanCitationPages(pages),
    });

    this.renderSelectedItems();
    this.renderResults();
    this.updateInsertButtonState();
    return true;
  }

  removeReference(key: string): boolean {
    const idx = this.selectedItems.findIndex((item) => item.entry.key === key);
    if (idx === -1) return false;

    this.selectedItems.splice(idx, 1);
    this.renderSelectedItems();
    this.renderResults();
    this.updateInsertButtonState();
    return true;
  }

  setReferencePages(key: string, rawPages: string): boolean {
    const item = this.selectedItems.find((i) => i.entry.key === key);
    if (!item) return false;

    item.pages = cleanCitationPages(rawPages);
    return true;
  }

  insert(): void {
    if (this.selectedItems.length === 0) return;

    this.inserted = true;
    const resultItems: CitationReferenceItem[] = this.selectedItems.map((item) => ({
      key: item.entry.key,
      pages: item.pages,
    }));
    this.onInsert(resultItems);
    this.close();
  }

  cancel(): void {
    this.close();
  }

  private clearSearchAndRefocus(): void {
    if (this.searchInputEl) {
      this.searchInputEl.value = "";
      this.searchQuery = "";
      this.activeIndex = 0;
      this.renderResults();
      this.searchInputEl.focus();
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("feuillets-citekey-modal");
    contentEl.addClass("feuillets-citekey-modal");
    contentEl.addClass("feuillets-citekey-modal-content");

    contentEl.createEl("h2", {
      text: t("modal.citekey.title"),
      cls: "feuillets-citekey-title",
    });

    const searchSection = contentEl.createDiv({ cls: "feuillets-citekey-search-section" });
    const searchInput = searchSection.createEl("input", {
      type: "text",
      placeholder: t("modal.citekey.placeholder"),
      cls: "feuillets-citekey-search-input",
    });
    this.searchInputEl = searchInput;

    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.activeIndex = 0;
      this.renderResults();
    });

    searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
      const results = this.getSearchResults();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length > 0 && this.activeIndex < results.length - 1) {
          this.activeIndex++;
          this.renderResults();
          this.scrollActiveIntoView();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length > 0 && this.activeIndex > 0) {
          this.activeIndex--;
          this.renderResults();
          this.scrollActiveIntoView();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results.length > 0 && this.activeIndex >= 0 && this.activeIndex < results.length) {
          const target = results[this.activeIndex];
          this.addReference(target);
          this.clearSearchAndRefocus();
        }
      }
    });

    this.resultsContainerEl = contentEl.createDiv({ cls: "feuillets-citekey-results-container" });
    this.renderResults();

    contentEl.createEl("h3", {
      text: t("modal.citekey.selectedHeader"),
      cls: "feuillets-citekey-selected-header",
    });
    this.selectedContainerEl = contentEl.createDiv({ cls: "feuillets-citekey-selected-container" });
    this.renderSelectedItems();

    const buttonsContainer = contentEl.createDiv({
      cls: "modal-button-container feuillets-citekey-button-container",
    });

    const cancelButton = buttonsContainer.createEl("button", {
      text: t("modal.citekey.cancel"),
      cls: "feuillets-citekey-cancel-btn",
    });
    cancelButton.addEventListener("click", () => {
      this.cancel();
    });

    const insertButton = buttonsContainer.createEl("button", {
      text: t("modal.citekey.insert"),
      cls: "mod-cta feuillets-citekey-insert-btn",
    });
    this.insertButtonEl = insertButton;

    insertButton.addEventListener("click", () => {
      this.insert();
    });

    this.updateInsertButtonState();

    if (typeof searchInput.focus === "function") {
      searchInput.focus();
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => {
          searchInput.focus();
        }, 10);
      }
    }
  }

  private scrollActiveIntoView(): void {
    if (!this.resultsContainerEl) return;
    const activeEl = this.resultsContainerEl.querySelector<HTMLElement>(
      ".feuillets-citekey-result-active",
    );
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  private renderResults(): void {
    if (!this.resultsContainerEl) return;
    this.resultsContainerEl.empty();

    const results = this.getSearchResults();
    if (results.length === 0) {
      this.resultsContainerEl.createDiv({
        cls: "feuillets-citekey-no-results",
        text: t("modal.citekey.noResults"),
      });
      return;
    }

    if (this.activeIndex >= results.length) {
      this.activeIndex = Math.max(0, results.length - 1);
    }

    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      const isAlreadySelected = this.selectedItems.some((item) => item.entry.key === entry.key);
      const isActive = i === this.activeIndex;

      const itemEl = this.resultsContainerEl.createDiv({
        cls: `feuillets-citekey-result-item${isAlreadySelected ? " feuillets-citekey-result-selected" : ""}${isActive ? " feuillets-citekey-result-active" : ""}`,
      });

      const titleText = entry.title || entry.key;
      itemEl.createDiv({
        cls: "feuillets-citekey-result-title",
        text: titleText,
      });

      const metaEl = itemEl.createDiv({
        cls: "feuillets-citekey-result-meta",
      });

      const authorYearParts: string[] = [];
      if (entry.authors.length > 0) {
        authorYearParts.push(entry.authors.join(", "));
      }
      if (entry.year) {
        authorYearParts.push(`(${entry.year})`);
      }
      const authorYearText = authorYearParts.join(" ") || "—";

      metaEl.createSpan({
        cls: "feuillets-citekey-result-author-year",
        text: authorYearText,
      });

      const keyContainerEl = metaEl.createSpan({
        cls: "feuillets-citekey-result-key-container",
      });

      keyContainerEl.createSpan({
        cls: "feuillets-citekey-result-key",
        text: `@${entry.key}`,
      });

      if (isAlreadySelected) {
        keyContainerEl.createSpan({
          cls: "feuillets-citekey-result-badge",
          text: " ✓",
        });
      }

      itemEl.addEventListener("click", () => {
        if (!isAlreadySelected) {
          this.addReference(entry);
          this.clearSearchAndRefocus();
        }
      });
    }
  }

  private renderSelectedItems(): void {
    if (!this.selectedContainerEl) return;
    this.selectedContainerEl.empty();

    if (this.selectedItems.length === 0) {
      this.selectedContainerEl.createDiv({
        cls: "feuillets-citekey-no-selected",
        text: t("modal.citekey.noSelection"),
      });
      return;
    }

    for (const item of this.selectedItems) {
      const rowEl = this.selectedContainerEl.createDiv({
        cls: "feuillets-citekey-selected-row",
      });

      rowEl.createSpan({
        cls: "feuillets-citekey-selected-key",
        text: `@${item.entry.key}`,
      });

      if (item.entry.title) {
        rowEl.createSpan({
          cls: "feuillets-citekey-selected-title",
          text: item.entry.title,
        });
      }

      const pagesInput = rowEl.createEl("input", {
        type: "text",
        placeholder: t("modal.citekey.pagesPlaceholder"),
        value: item.pages,
        cls: "feuillets-citekey-pages-input",
      });

      const handlePageInput = () => {
        const cleaned = cleanCitationPages(pagesInput.value);
        if (pagesInput.value !== cleaned) {
          pagesInput.value = cleaned;
        }
        item.pages = cleaned;
      };

      pagesInput.addEventListener("input", handlePageInput);
      pagesInput.addEventListener("change", handlePageInput);

      const removeBtn = rowEl.createEl("button", {
        text: t("modal.citekey.remove"),
        cls: "feuillets-citekey-remove-btn",
      });
      removeBtn.addEventListener("click", () => {
        this.removeReference(item.entry.key);
        if (this.searchInputEl) {
          this.searchInputEl.focus();
        }
      });
    }
  }

  private updateInsertButtonState(): void {
    if (!this.insertButtonEl) return;
    const disabled = this.selectedItems.length === 0;
    this.insertButtonEl.disabled = disabled;
    if (disabled) {
      this.insertButtonEl.addClass("is-disabled");
    } else {
      this.insertButtonEl.removeClass("is-disabled");
    }
  }

  override close(): void {
    super.close();
    this.onClose();
  }

  onClose(): void {
    if (!this.closed) {
      this.closed = true;
      this.modalEl.removeClass("feuillets-citekey-modal");
      this.contentEl.removeClass("feuillets-citekey-modal");
      this.contentEl.removeClass("feuillets-citekey-modal-content");
      this.onCloseCallback?.();
    }
  }
}
