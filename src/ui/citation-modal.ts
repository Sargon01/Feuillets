import { FuzzySuggestModal, type App, type FuzzyMatch, type TFile } from "obsidian";
import { TextInputModal } from "../scenes-editor.js";
import { ConfirmModal } from "./basic-modals.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";
import type { CitationCandidate } from "../services/citation-candidates.js";

type CitationPlugin = {
  fmOf(file: TFile): Record<string, unknown>;
  titleFor(file: TFile): string;
};

type CitationChoiceHandler = (file: TFile, page: string) => void;
type CitationCreateSheetHandler = (attachmentFile: TFile) => Promise<void>;
type CitationAmbiguousHandler = (attachmentFile: TFile, sourceFiles: readonly TFile[]) => void;

/**
 * Fuzzy selection modal for citation candidates:
 * - Source sheets (with optional linked attachments)
 * - Unlinked citable attachments (PDF, DOCX, EPUB, etc.)
 * - Ambiguous attachments claimed by multiple sheets
 */
export class CitationSourceModal extends FuzzySuggestModal<CitationCandidate> {
  plugin: CitationPlugin;
  candidates: CitationCandidate[];
  onChoose: CitationChoiceHandler;
  onCreateSheet: CitationCreateSheetHandler;
  onAmbiguousChoose?: CitationAmbiguousHandler;

  constructor(
    app: App,
    plugin: CitationPlugin,
    candidates: CitationCandidate[],
    onChoose: CitationChoiceHandler,
    onCreateSheet: CitationCreateSheetHandler,
    onAmbiguousChoose?: CitationAmbiguousHandler
  ) {
    super(app);
    this.plugin = plugin;
    this.candidates = candidates;
    this.onChoose = onChoose;
    this.onCreateSheet = onCreateSheet;
    this.onAmbiguousChoose = onAmbiguousChoose;
    this.setPlaceholder(t("modal.citation.searchSourcePlaceholder"));
  }

  getItems(): CitationCandidate[] {
    return this.candidates;
  }

  getItemText(item: CitationCandidate): string {
    if (item.kind === "source-sheet") {
      const fm = this.plugin.fmOf(item.sourceFile);
      const authorStr = toValue(fm.author);
      const title = this.plugin.titleFor(item.sourceFile);
      const sheetName = item.sourceFile.basename || item.sourceFile.name;
      const attNames = item.attachmentFiles.map((f) => f.name).join(" ");
      return [title, authorStr, sheetName, attNames].filter(Boolean).join(" ");
    }
    if (item.kind === "unlinked-attachment") {
      return `${item.attachmentFile.name} ${t("modal.citation.createSourceSheetForDocument")}`;
    }
    return `${item.attachmentFile.name} ${t("modal.citation.ambiguousAttachmentNotice")}`;
  }

  renderSuggestion(match: FuzzyMatch<CitationCandidate>, el: HTMLElement): void {
    const item = match.item;
    el.empty();

    if (item.kind === "source-sheet") {
      const fm = this.plugin.fmOf(item.sourceFile);
      const authorStr = toValue(fm.author);
      const author = authorStr ? ` — ${authorStr}` : "";
      const atts = item.attachmentFiles.map((f) => f.name).join(", ");
      const attLabel = atts ? ` (${atts})` : "";

      const row = el.createDiv({ cls: "feuillets-citation-item" });
      row.createDiv({
        cls: "feuillets-citation-item-title",
        text: `${this.plugin.titleFor(item.sourceFile)}${author}${attLabel}`,
      });
      return;
    }

    if (item.kind === "unlinked-attachment") {
      const row = el.createDiv({ cls: "feuillets-citation-item feuillets-citation-unlinked" });
      row.createDiv({
        cls: "feuillets-citation-item-title",
        text: `${item.attachmentFile.name} — ${t("modal.citation.createSourceSheetForDocument")}`,
      });
      return;
    }

    const row = el.createDiv({ cls: "feuillets-citation-item feuillets-citation-ambiguous" });
    row.createDiv({
      cls: "feuillets-citation-item-title",
      text: `${item.attachmentFile.name} — ${t("modal.citation.multipleSourcesForAttachment", {
        count: String(item.sourceFiles.length),
      })}`,
    });
  }

  onChooseItem(candidate: CitationCandidate): void {
    if (candidate.kind === "source-sheet") {
      promptForPage(this.app, this.plugin, candidate.sourceFile, this.onChoose);
      return;
    }

    if (candidate.kind === "unlinked-attachment") {
      new ConfirmModal(
        this.app,
        t("modal.citation.createSheetConfirmTitle"),
        t("modal.citation.createSheetConfirmMessage", {
          name: candidate.attachmentFile.name,
          folder: candidate.attachmentFile.parent?.name || "",
        }),
        t("modal.citation.createSheetConfirmButton"),
        async () => {
          await this.onCreateSheet(candidate.attachmentFile);
        },
        "mod-cta"
      ).open();
      return;
    }

    // Ambiguous attachment
    if (this.onAmbiguousChoose) {
      this.onAmbiguousChoose(candidate.attachmentFile, candidate.sourceFiles);
      return;
    }

    new CitationAmbiguousSheetModal(
      this.app,
      this.plugin,
      candidate.attachmentFile,
      candidate.sourceFiles,
      (chosenSheet) => {
        promptForPage(this.app, this.plugin, chosenSheet, this.onChoose);
      }
    ).open();
  }
}

/**
 * Modal to resolve ambiguous attachments claimed by multiple source sheets.
 */
export class CitationAmbiguousSheetModal extends FuzzySuggestModal<TFile> {
  plugin: CitationPlugin;
  attachmentFile: TFile;
  sourceFiles: readonly TFile[];
  onChoose: (chosenSheet: TFile) => void;

  constructor(
    app: App,
    plugin: CitationPlugin,
    attachmentFile: TFile,
    sourceFiles: readonly TFile[],
    onChoose: (chosenSheet: TFile) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.attachmentFile = attachmentFile;
    this.sourceFiles = sourceFiles;
    this.onChoose = onChoose;
    this.setPlaceholder(
      t("modal.citation.ambiguousAttachmentTitle", { name: attachmentFile.name })
    );
  }

  getItems(): TFile[] {
    return [...this.sourceFiles];
  }

  getItemText(file: TFile): string {
    const fm = this.plugin.fmOf(file);
    const authorStr = toValue(fm.author);
    const author = authorStr ? ` — ${authorStr}` : "";
    return `${this.plugin.titleFor(file)}${author}`;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

/**
 * Prompts for page number before inserting citation.
 */
export function promptForPage(
  app: App,
  plugin: CitationPlugin,
  file: TFile,
  onChoose: CitationChoiceHandler
): void {
  new TextInputModal(
    app,
    t("modal.citation.citeTitle", { title: plugin.titleFor(file) }),
    [{ name: "page", label: t("modal.citation.pageLabel"), value: "" }],
    async (values: { page: string }) => {
      onChoose(file, values.page);
    }
  ).open();
}
