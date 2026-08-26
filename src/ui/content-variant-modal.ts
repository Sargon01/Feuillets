import { Modal, Notice, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";
import { ContentVariantsError, type ContentVariant, type QuestionAnswerSpaceMode } from "../services/content-variants.js";

export type ContentVariantDraft = {
  name: string;
  excludedRoles: SemanticRole[];
  questionAnswerSpace: QuestionAnswerSpaceMode;
};

export function contentVariantErrorNoticeKey(error: unknown): string {
  if (!(error instanceof ContentVariantsError)) return "contentVariants.notice.saveFailed";
  switch (error.code) {
    case "file-corrupted": return "contentVariants.notice.fileCorrupted";
    case "name-required": return "contentVariants.notice.nameRequired";
    case "duplicate-name": return "contentVariants.notice.duplicateName";
    case "invalid-role": return "contentVariants.notice.invalidRole";
    case "invalid-question-answer-space": return "contentVariants.notice.invalidQuestionAnswerSpace";
    case "variant-not-found": return "contentVariants.notice.variantNotFound";
    default: return "contentVariants.notice.saveFailed";
  }
}

export class ContentVariantModal extends Modal {
  constructor(
    app: App,
    private initial: ContentVariant | null,
    private onSubmit: (draft: ContentVariantDraft) => void | Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-content-derivation-modal");
    contentEl.createEl("h3", { text: t(this.initial ? "contentVariants.modal.editTitle" : "contentVariants.modal.newTitle") });
    const nameLabel = contentEl.createEl("label", { cls: "feuillets-content-modal-field-label", text: t("contentVariants.modal.name") });
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.addClass("feuillets-input-full");
    nameInput.setAttribute("aria-label", t("contentVariants.modal.name"));
    nameInput.value = this.initial?.name || "";
    nameLabel.appendChild(nameInput);
    contentEl.createEl("h4", { text: t("contentVariants.modal.includedRoles") });

    const excluded = new Set(this.initial?.excludedRoles || []);
    const roleInputs = new Map<SemanticRole, HTMLInputElement>();
    const roleGrid = contentEl.createDiv({ cls: "feuillets-content-modal-role-grid", attr: { role: "group", "aria-label": t("contentVariants.modal.includedRoles") } });
    const roleSummary = contentEl.createDiv({ cls: "feuillets-content-modal-role-summary" });
    const updateRoleSummary = (): void => {
      const selected = SEMANTIC_ROLES.filter((role) => roleInputs.get(role)?.checked);
      roleSummary.setText(`${t("contentVariants.modal.selectedRolesCount", { count: String(selected.length) })} · ${t("contentVariants.modal.roleHint")}`);
    };
    for (const role of SEMANTIC_ROLES) {
      const label = roleGrid.createEl("label", { cls: "feuillets-content-modal-role feuillets-content-variant-role" });
      const input = label.createEl("input", { type: "checkbox" });
      input.checked = !excluded.has(role);
      label.classList.toggle("is-selected", input.checked);
      input.addEventListener("change", () => {
        label.classList.toggle("is-selected", input.checked);
        updateRoleSummary();
      });
      roleInputs.set(role, input);
      label.createSpan({ text: t(`contentVariants.roles.${role}`) });
    }
    updateRoleSummary();
    contentEl.createDiv({ cls: "feuillets-content-variants-hint", text: t("contentVariants.modal.roleHint") });

    contentEl.createEl("h4", { text: t("contentVariants.modal.questions") });
    const answerLabel = contentEl.createEl("label");
    const answerInput = answerLabel.createEl("input", { type: "checkbox" });
    answerInput.checked = this.initial?.questionAnswerSpace !== "hide";
    answerLabel.createSpan({ text: t("contentVariants.modal.keepAnswerSpaces") });

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: t("modal.save"), cls: "mod-cta" }).addEventListener("click", () => {
      const draft: ContentVariantDraft = {
        name: nameInput.value.trim(),
        excludedRoles: SEMANTIC_ROLES.filter((role) => !roleInputs.get(role)?.checked),
        questionAnswerSpace: answerInput.checked ? "keep" : "hide",
      };
      if (!draft.name) { new Notice(t("contentVariants.notice.nameRequired")); return; }
      void this.submit(draft);
    });
    nameInput.focus();
  }

  private async submit(draft: ContentVariantDraft): Promise<void> {
    try {
      await this.onSubmit(draft);
      this.close();
    } catch (error) {
      new Notice(t(contentVariantErrorNoticeKey(error)));
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
