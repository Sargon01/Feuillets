import { Modal, Setting, type App, type DropdownComponent } from "obsidian";
import { t } from "../i18n/index.js";
import type {
  ImagePlacementChoice,
  LayoutDirectiveContext,
  LayoutImageState,
  PairingRelation,
} from "../utils/editor-layout-directives.js";
import type { ColumnRatio, ImageWidth } from "../utils/feuillets-directives.js";

export interface LayoutDirectiveResult {
  image?: LayoutImageState;
  pairing?: { relation: PairingRelation; ratio?: ColumnRatio };
}

const IMAGE_WIDTHS: readonly ImageWidth[] = [25, 33, 40, 50, 60, 67, 75, 100];
const RATIOS: readonly ColumnRatio[] = ["40/60", "50/50", "60/40"];
const EDITABLE_WIDTH_PLACEMENTS: readonly ImagePlacementChoice[] = ["gauche", "centre", "droite"];

/** Modale native unique du LOT 3D (§25) : rend visible/éditable en interface
 * ce que l'utilisatrice tapait jusqu'ici à la main (`%% image: … %%`,
 * `%% colonnes: … %%`, `%% dessous %%`). Aucune mutation du Markdown avant
 * « Appliquer » — Annuler/Escape ferment sans le moindre effet de bord, et
 * le calcul de l'édition réelle (Editor.replaceRange) reste entièrement à
 * la charge de l'appelant (voir main.ts), cette modale se contentant de
 * renvoyer l'état choisi via `onApply`. */
export class LayoutDirectiveModal extends Modal {
  context: LayoutDirectiveContext;
  onApply: (result: LayoutDirectiveResult) => void;

  private imageState: LayoutImageState;
  private pairingRelation: PairingRelation;
  private pairingRatio: ColumnRatio;
  private widthDropdown: DropdownComponent | null = null;
  private ratioDropdown: DropdownComponent | null = null;

  constructor(app: App, context: LayoutDirectiveContext, onApply: (result: LayoutDirectiveResult) => void) {
    super(app);
    this.context = context;
    this.onApply = onApply;
    this.imageState = context.image ? { ...context.image } : { placement: "auto", width: null };
    this.pairingRelation = context.pairing?.relation ?? "auto";
    this.pairingRatio = context.pairing?.ratio ?? "50/50";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("layoutDirective.title") });

    if (this.context.image) this.renderImageSection(contentEl);
    if (this.context.pairing) this.renderPairingSection(contentEl, this.context.pairing);

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("layoutDirective.cancel") }).addEventListener("click", () => this.close());
    const applyBtn = buttons.createEl("button", { text: t("layoutDirective.apply"), cls: "mod-cta" });
    applyBtn.addEventListener("click", () => {
      const result: LayoutDirectiveResult = {};
      if (this.context.image) result.image = this.imageState;
      if (this.context.pairing) result.pairing = { relation: this.pairingRelation, ratio: this.pairingRatio };
      this.onApply(result);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private updateWidthAvailability(): void {
    const editable = EDITABLE_WIDTH_PLACEMENTS.includes(this.imageState.placement);
    this.widthDropdown?.setDisabled(!editable);
  }

  private renderImageSection(container: HTMLElement): void {
    container.createEl("h4", { text: t("layoutDirective.image.section") });

    new Setting(container).setName(t("layoutDirective.image.placement")).addDropdown((dropdown) => {
      dropdown.addOption("auto", t("layoutDirective.image.auto"));
      dropdown.addOption("gauche", t("layoutDirective.image.left"));
      dropdown.addOption("centre", t("layoutDirective.image.center"));
      dropdown.addOption("droite", t("layoutDirective.image.right"));
      dropdown.addOption("pleine-largeur", t("layoutDirective.image.full"));
      dropdown.setValue(this.imageState.placement);
      dropdown.onChange((value) => {
        this.imageState = { ...this.imageState, placement: value as ImagePlacementChoice };
        this.updateWidthAvailability();
      });
    });

    new Setting(container).setName(t("layoutDirective.image.width")).addDropdown((dropdown) => {
      dropdown.addOption("auto", t("layoutDirective.image.widthAuto"));
      for (const width of IMAGE_WIDTHS) dropdown.addOption(String(width), `${width}%`);
      dropdown.setValue(this.imageState.width ? String(this.imageState.width) : "auto");
      dropdown.onChange((value) => {
        this.imageState = { ...this.imageState, width: value === "auto" ? null : (Number(value) as ImageWidth) };
      });
      this.widthDropdown = dropdown;
    });
    this.updateWidthAvailability();
  }

  private renderPairingSection(container: HTMLElement, pairing: NonNullable<LayoutDirectiveContext["pairing"]>): void {
    const alreadyComposed = pairing.relation !== "auto";
    container.createEl("h4", {
      text: t(alreadyComposed ? "layoutDirective.pairing.existingSection" : "layoutDirective.pairing.section"),
    });

    const updateRatioAvailability = () => {
      this.ratioDropdown?.setDisabled(this.pairingRelation !== "colonnes");
    };

    new Setting(container).setName(t("layoutDirective.pairing.relation")).addDropdown((dropdown) => {
      dropdown.addOption("auto", t("layoutDirective.pairing.auto"));
      dropdown.addOption("colonnes", t("layoutDirective.pairing.sideBySide"));
      if (pairing.dessousAvailable) dropdown.addOption("dessous", t("layoutDirective.pairing.dessous"));
      dropdown.setValue(this.pairingRelation);
      dropdown.onChange((value) => {
        this.pairingRelation = value as PairingRelation;
        updateRatioAvailability();
      });
    });

    new Setting(container).setName(t("layoutDirective.pairing.ratio")).addDropdown((dropdown) => {
      for (const ratio of RATIOS) dropdown.addOption(ratio, ratio);
      dropdown.setValue(this.pairingRatio);
      dropdown.onChange((value) => {
        this.pairingRatio = value as ColumnRatio;
      });
      this.ratioDropdown = dropdown;
    });
    updateRatioAvailability();

    if (alreadyComposed) {
      new Setting(container).addButton((button) =>
        button.setButtonText(t("layoutDirective.pairing.remove")).onClick(() => {
          this.pairingRelation = "auto";
          this.onApply({
            ...(this.context.image ? { image: this.imageState } : {}),
            pairing: { relation: "auto" },
          });
          this.close();
        })
      );
    }
  }
}
