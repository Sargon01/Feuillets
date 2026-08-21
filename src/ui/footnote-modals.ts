import { App, Modal, setIcon } from "obsidian";
import type { FootnoteValidationResult } from "../utils/footnotes.js";
import { findDefinition, findReferences } from "../utils/footnotes.js";
import { selectRange } from "../utils/dom.js";
import type { FeuilletsEditorSurface } from "../utils/scrivenings-editor-adapter.js";
import { t } from "../i18n/index.js";

/** Résultat de « Vérifier les notes de bas de page du document » (voir
 * main.ts, commande `check-footnotes`) : une liste courte et cliquable,
 * jamais une vue permanente — conforme au choix d'interface minimale de
 * cette première version (commandes, menu contextuel, petite modale). */
export class FootnoteCheckModal extends Modal {
  editor: FeuilletsEditorSurface;
  result: FootnoteValidationResult;

  constructor(app: App, editor: FeuilletsEditorSurface, result: FootnoteValidationResult) {
    super(app);
    this.editor = editor;
    this.result = result;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("footnotes.check.title") });

    const { missingDefinitions, unusedDefinitions, duplicateDefinitions, emptyDefinitions, malformedReferences } =
      this.result;
    const hasIssues =
      missingDefinitions.length > 0 ||
      unusedDefinitions.length > 0 ||
      duplicateDefinitions.length > 0 ||
      emptyDefinitions.length > 0 ||
      malformedReferences.length > 0;

    if (!hasIssues) {
      contentEl.createEl("p", { text: t("footnotes.check.none") });
      return;
    }

    this.renderGroup(contentEl, t("footnotes.check.missing"), missingDefinitions, (id) => {
      const ref = findReferences(this.editor.getValue(), id)[0];
      if (ref) selectRange(this.editor, ref.start, ref.end);
    });
    this.renderGroup(contentEl, t("footnotes.check.unused"), unusedDefinitions, (id) => {
      const def = findDefinition(this.editor.getValue(), id);
      if (def) selectRange(this.editor, def.start, def.end);
    });
    this.renderGroup(contentEl, t("footnotes.check.duplicate"), duplicateDefinitions, (id) => {
      const def = findDefinition(this.editor.getValue(), id);
      if (def) selectRange(this.editor, def.start, def.end);
    });
    this.renderGroup(contentEl, t("footnotes.check.empty"), emptyDefinitions, (id) => {
      const def = findDefinition(this.editor.getValue(), id);
      if (def) selectRange(this.editor, def.start, def.end);
    });

    if (malformedReferences.length > 0) {
      contentEl.createEl("h4", { text: t("footnotes.check.malformed") });
      const list = contentEl.createEl("ul", { cls: "feuillets-footnote-check-list" });
      for (const ref of malformedReferences) {
        const row = list.createEl("li", { cls: "feuillets-clickable" });
        const icon = row.createSpan();
        setIcon(icon, "alert-triangle");
        row.createSpan({ text: ` [^]` });
        row.addEventListener("click", () => {
          selectRange(this.editor, ref.start, ref.end);
          this.close();
        });
      }
    }
  }

  renderGroup(container: HTMLElement, label: string, ids: string[], onJump: (id: string) => void): void {
    if (ids.length === 0) return;
    container.createEl("h4", { text: label });
    const list = container.createEl("ul", { cls: "feuillets-footnote-check-list" });
    for (const id of ids) {
      const row = list.createEl("li", { text: `[^${id}]`, cls: "feuillets-clickable" });
      row.addEventListener("click", () => {
        onJump(id);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
