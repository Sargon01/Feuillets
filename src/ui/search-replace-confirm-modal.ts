import { Modal, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { GlobalReplaceError, type GlobalReplacePlan, type PlannedDocument } from "../services/global-search-replace.js";

export function globalReplaceErrorMessage(error: unknown): string {
  return error instanceof GlobalReplaceError
    ? t(`searchReplace.error.${error.reason}`, { paths: error.paths.join(", "), backup: error.backupPath })
    : t("searchReplace.replaceFailed");
}

/** Native confirmation with bounded, on-demand context rendering. */
export class SearchReplaceConfirmModal extends Modal {
  private settled = false;
  private finish: ((confirmed: boolean) => void) | undefined;
  constructor(app: App, private readonly plan: GlobalReplacePlan, private readonly scopeLabel: string) { super(app); }

  confirm(): Promise<boolean> {
    return new Promise((resolve) => { this.finish = resolve; this.open(); });
  }

  private settle(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.finish?.(confirmed);
    this.close();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("searchReplace.previewTitle") });
    contentEl.createEl("p", { text: this.scopeLabel });
    contentEl.createEl("p", { text: t("searchReplace.previewCounts", { found: String(this.plan.found), count: String(this.plan.eligible), skipped: String(this.plan.skipped), files: String(this.plan.filesCount) }) });
    const list = contentEl.createDiv({ cls: "feuillets-search-preview" });
    const documents = this.plan.documents.filter(({ changes }) => changes.length);
    let shown = 0;
    const more = contentEl.createEl("button", { text: t("searchReplace.showMore") });
    const showBatch = () => {
      const next = Math.min(shown + 20, documents.length);
      for (; shown < next; shown++) this.renderDocument(list, documents[shown]);
      more.hidden = shown >= documents.length;
    };
    more.addEventListener("click", showBatch);
    showBatch();
    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.settle(false));
    const confirm = buttons.createEl("button", { cls: "mod-cta", text: t("searchReplace.confirmGlobal", { files: String(this.plan.filesCount), s: this.plan.filesCount > 1 ? "s" : "" }) });
    confirm.addEventListener("click", () => { confirm.disabled = true; this.settle(true); });
  }

  private renderDocument(parent: HTMLElement, document: PlannedDocument): void {
    const details = parent.createEl("details");
    details.createEl("summary", { text: `${document.path} (${document.changes.length})` });
    let shown = 0;
    const content = details.createDiv();
    const more = details.createEl("button", { text: t("searchReplace.showMore") });
    const showBatch = () => {
      const next = Math.min(shown + 20, document.changes.length);
      for (; shown < next; shown++) {
        const change = document.changes[shown];
        const before = document.original.slice(Math.max(0, change.from - 45), change.from).replace(/\s+/g, " ");
        const after = document.original.slice(change.to, change.to + 45).replace(/\s+/g, " ");
        const row = content.createDiv({ cls: "feuillets-search-preview-change" });
        const render = (label: string, text: string) => {
          const line = row.createDiv();
          line.createSpan({ cls: "feuillets-search-preview-label", text: `${label} ` });
          line.createSpan({ text: before });
          const preview = line.createSpan({ cls: "feuillets-search-preview-text" });
          preview.createSpan({ cls: "feuillets-search-preview-text-content", text: text ? text.length > 160 ? `${text.slice(0, 160)}…` : text : t("searchReplace.emptyReplacement") });
          line.createSpan({ text: after });
        };
        render(t("searchReplace.before"), change.expected);
        render(t("searchReplace.after"), change.text);
      }
      more.hidden = shown >= document.changes.length;
    };
    details.addEventListener("toggle", () => { if (details.open && !shown) showBatch(); });
    more.addEventListener("click", showBatch);
  }

  onClose(): void {
    if (!this.settled) { this.settled = true; this.finish?.(false); }
    this.contentEl.empty();
  }
}
