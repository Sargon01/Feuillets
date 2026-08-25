import { Modal, Notice, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";
import { ContentExtractionsError, type ContentExtraction } from "../services/content-extractions.js";

export type ContentExtractionDraft = {
  name: string;
  triggerRoles: SemanticRole[];
};

export function contentExtractionErrorNoticeKey(error: unknown): string {
  if (!(error instanceof ContentExtractionsError)) return "contentExtractions.notice.saveFailed";
  switch (error.code) {
    case "name-required": return "contentExtractions.notice.nameRequired";
    case "duplicate-name": return "contentExtractions.notice.duplicateName";
    case "invalid-role": return "contentExtractions.notice.invalidRole";
    case "no-roles": return "contentExtractions.notice.noRoles";
    case "file-corrupted": return "contentExtractions.notice.fileCorrupted";
    case "extraction-not-found": return "contentExtractions.notice.notFound";
    default: return "contentExtractions.notice.saveFailed";
  }
}

export class ContentExtractionModal extends Modal {
  constructor(
    app: App,
    private initial: ContentExtraction | null,
    private onSubmit: (draft: ContentExtractionDraft) => void | Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t(this.initial ? "contentExtractions.modal.editTitle" : "contentExtractions.modal.newTitle") });
    contentEl.createEl("label", { text: t("contentExtractions.modal.name") });
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.addClass("feuillets-input-full");
    nameInput.value = this.initial?.name || "";
    contentEl.createEl("h4", { text: t("contentExtractions.modal.roles") });

    const selected = new Set(this.initial?.triggerRoles || []);
    const roleInputs = new Map<SemanticRole, HTMLInputElement>();
    for (const role of SEMANTIC_ROLES) {
      const label = contentEl.createEl("label", { cls: "feuillets-content-extraction-role" });
      const input = label.createEl("input", { type: "checkbox" });
      input.checked = selected.has(role);
      roleInputs.set(role, input);
      label.createSpan({ text: t(`contentVariants.roles.${role}`) });
    }

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: t("modal.save"), cls: "mod-cta" }).addEventListener("click", () => {
      const draft: ContentExtractionDraft = {
        name: nameInput.value.trim(),
        triggerRoles: SEMANTIC_ROLES.filter((role) => roleInputs.get(role)?.checked),
      };
      if (!draft.name) { new Notice(t("contentExtractions.notice.nameRequired")); return; }
      if (draft.triggerRoles.length === 0) { new Notice(t("contentExtractions.notice.noRoles")); return; }
      void this.submit(draft);
    });
    nameInput.focus();
  }

  private async submit(draft: ContentExtractionDraft): Promise<void> {
    try {
      await this.onSubmit(draft);
      this.close();
    } catch (error) {
      new Notice(t(contentExtractionErrorNoticeKey(error)));
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
