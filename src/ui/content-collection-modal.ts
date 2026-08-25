import { Modal, Notice, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";
import { ContentCollectionsError, type ContentCollection } from "../services/content-collections.js";

export type ContentCollectionDraft = {
  name: string;
  roles: SemanticRole[];
};

export function contentCollectionErrorNoticeKey(error: unknown): string {
  if (!(error instanceof ContentCollectionsError)) return "contentCollections.notice.saveFailed";
  switch (error.code) {
    case "name-required": return "contentCollections.notice.nameRequired";
    case "duplicate-name": return "contentCollections.notice.duplicateName";
    case "invalid-role": return "contentCollections.notice.invalidRole";
    case "no-roles": return "contentCollections.notice.noRoles";
    case "file-corrupted": return "contentCollections.notice.fileCorrupted";
    case "collection-not-found": return "contentCollections.notice.notFound";
    default: return "contentCollections.notice.saveFailed";
  }
}

export class ContentCollectionModal extends Modal {
  constructor(
    app: App,
    private initial: ContentCollection | null,
    private onSubmit: (draft: ContentCollectionDraft) => void | Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-content-derivation-modal");
    contentEl.createEl("h3", { text: t(this.initial ? "contentCollections.modal.editTitle" : "contentCollections.modal.newTitle") });
    const nameLabel = contentEl.createEl("label", { cls: "feuillets-content-modal-field-label", text: t("contentCollections.modal.name") });
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.addClass("feuillets-input-full");
    nameInput.setAttribute("aria-label", t("contentCollections.modal.name"));
    nameInput.value = this.initial?.name || "";
    nameLabel.appendChild(nameInput);
    contentEl.createEl("h4", { text: t("contentCollections.modal.roles") });

    const selected = new Set(this.initial?.roles || []);
    const roleInputs = new Map<SemanticRole, HTMLInputElement>();
    const roleGrid = contentEl.createDiv({ cls: "feuillets-content-modal-role-grid", attr: { role: "group", "aria-label": t("contentCollections.modal.roles") } });
    const roleSummary = contentEl.createDiv({ cls: "feuillets-content-modal-role-summary" });
    const updateRoleSummary = (): void => {
      const roles = SEMANTIC_ROLES.filter((role) => roleInputs.get(role)?.checked);
      roleSummary.setText(t("contentCollections.modal.selectedRolesCount", { count: String(roles.length) }));
    };
    for (const role of SEMANTIC_ROLES) {
      const label = roleGrid.createEl("label", { cls: "feuillets-content-modal-role feuillets-content-collection-role" });
      const input = label.createEl("input", { type: "checkbox" });
      input.checked = selected.has(role);
      input.addEventListener("change", updateRoleSummary);
      roleInputs.set(role, input);
      label.createSpan({ text: t(`contentVariants.roles.${role}`) });
    }
    updateRoleSummary();

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: t("modal.save"), cls: "mod-cta" }).addEventListener("click", () => {
      const draft: ContentCollectionDraft = {
        name: nameInput.value.trim(),
        roles: SEMANTIC_ROLES.filter((role) => roleInputs.get(role)?.checked),
      };
      if (!draft.name) { new Notice(t("contentCollections.notice.nameRequired")); return; }
      if (draft.roles.length === 0) { new Notice(t("contentCollections.notice.noRoles")); return; }
      void this.submit(draft);
    });
    nameInput.focus();
  }

  private async submit(draft: ContentCollectionDraft): Promise<void> {
    try {
      await this.onSubmit(draft);
      this.close();
    } catch (error) {
      new Notice(t(contentCollectionErrorNoticeKey(error)));
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
