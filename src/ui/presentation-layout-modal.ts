import { Modal, Setting, type App } from "obsidian";
import type { PresentationLayoutOverride } from "../services/presentation-layout-engine.js";
import { t } from "../i18n/index.js";

export class PresentationLayoutModal extends Modal {
  private readonly current: PresentationLayoutOverride | null;
  private readonly onApply: (layout: PresentationLayoutOverride | null) => Promise<void>;

  constructor(app: App, current: PresentationLayoutOverride | null, onApply: (layout: PresentationLayoutOverride | null) => Promise<void>) {
    super(app);
    this.current = current;
    this.onApply = onApply;
  }

  onOpen(): void {
    this.titleEl.setText(t("presentation.layout"));
    const choices: Array<{ value: PresentationLayoutOverride | null; label: string }> = [
      { value: null, label: t("presentation.layoutAutomatic") },
      { value: "flow", label: t("presentation.layoutFlow") },
      { value: "columns", label: t("presentation.layoutColumns") },
      { value: "image-left", label: t("presentation.layoutImageLeft") },
      { value: "image-right", label: t("presentation.layoutImageRight") },
    ];
    for (const choice of choices) {
      new Setting(this.contentEl)
        .setName(choice.label)
        .addButton((button) => {
          button.setButtonText(choice.label).onClick(() => {
            void this.onApply(choice.value).then(() => this.close());
          });
        });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
