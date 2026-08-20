import { Modal, type App } from "obsidian";
import { t } from "../i18n/index.js";

type CaptureIdeaHandler = (text: string) => void | Promise<void>;

/** Lot 6 (« Carnet : noter une idée ») — la plus petite modale possible :
 * un seul champ texte, aucun titre, aucune destination, aucun réglage,
 * aucune metadata. Le focus est immédiat, Entrée valide, Escape annule
 * (comportement natif de `Modal`, jamais réimplémenté ici). Un texte vide
 * après trim n'appelle jamais `onSubmit` — voir aussi
 * `services/canvas-board.ts::addTextNodeToCanvas`, qui refuse aussi un
 * texte vide, en défense à deux niveaux. */
export class CaptureIdeaModal extends Modal {
  private onSubmit: CaptureIdeaHandler;

  constructor(app: App, onSubmit: CaptureIdeaHandler) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    const input = contentEl.createEl("input", { type: "text" });
    input.addClass("feuillets-input-full");
    input.placeholder = t("modal.captureIdea.placeholder");
    input.focus();

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      this.close();
      void this.onSubmit(text);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      /* L'Entrée qui valide l'idée ne doit JAMAIS atteindre l'éditeur actif :
         neutralisée avant toute fermeture de la modale (voir correctif
         « Noter une idée » — la ligne vide insérée avant le frontmatter). */
      e.preventDefault();
      e.stopPropagation();
      submit();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
