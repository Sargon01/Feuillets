import { Modal, type App } from "obsidian";
import { t } from "../i18n/index.js";

/** Un document éditorial détecté, proposé comme pièce jointe possible d'une
 * soumission (voir `courrier-integration.ts`, `detectEditorialDocuments`). */
export interface SubmissionAttachmentCandidate {
  id: string;
  label: string;
  path: string;
  checkedByDefault: boolean;
}

/** Modale de sélection des pièces jointes avant transmission à Courrier
 * (Lot 14C) — même famille que `CompileSelectionModal`
 * (`ui/selection-modals.ts` : liste de cases à cocher, boutons en bas).
 * Ne transmet RIEN toute seule : `onConfirm` reçoit juste la liste des
 * chemins cochés, c'est l'appelante (`prepareSubmission`) qui appelle
 * ensuite l'API Courrier — contrainte explicite "ne rien envoyer
 * automatiquement". Fermer sans confirmer n'appelle jamais `onConfirm`. */
export class SubmissionAttachmentsModal extends Modal {
  private candidates: SubmissionAttachmentCandidate[];
  private onConfirm: (selectedPaths: string[]) => void;

  constructor(app: App, candidates: SubmissionAttachmentCandidate[], onConfirm: (selectedPaths: string[]) => void) {
    super(app);
    this.candidates = candidates;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("courrier.attachments.title") });

    if (this.candidates.length === 0) {
      contentEl.createEl("p", { cls: "feuillets-notes-sub", text: t("courrier.attachments.none") });
    } else {
      contentEl.createEl("p", { cls: "feuillets-notes-sub", text: t("courrier.attachments.desc") });
    }

    const listEl = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const checkboxes: Array<[HTMLInputElement, SubmissionAttachmentCandidate]> = [];

    for (const candidate of this.candidates) {
      const row = listEl.createDiv({ cls: "feuillets-read-selection-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = candidate.checkedByDefault;
      checkboxes.push([cb, candidate]);

      const label = row.createSpan();
      label.setText(candidate.label);
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
      });
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: t("courrier.attachments.confirm"), cls: "mod-cta" }).addEventListener("click", () => {
      const selected = checkboxes.filter(([cb]) => cb.checked).map(([, candidate]) => candidate.path);
      this.close();
      this.onConfirm(selected);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
