/**
 * Choix de la SORTIE papier avant un export PDF de la Présentation. Trois
 * familles d'usage réellement différentes du même contenu — le choix est
 * TOUJOURS demandé, jamais mémorisé silencieusement à la place de l'auteur :
 *
 *  - Présentation → 1 diapositive par page (16:9 pour projeter, A4 paysage
 *    pour imprimer une diapositive par feuille) ;
 *  - Support à distribuer → 2, 4 ou 6 diapositives par page A4 portrait,
 *    avec des réglures pour la prise de notes, destiné au public ;
 *  - Plan de présentation → 4 diapositives par page + notes personnelles,
 *    pour celui qui présente.
 *
 * Voir ../services/presentation-pdf-export.ts : ce ne sont pas plusieurs
 * moteurs, mais plusieurs compositions du même contenu et du même renderer.
 *
 * Présentation : trois RUBRIQUES titrées, chacune avec une grille de cartes
 * cliquables — même langage visuel que les autres modales Feuillets (voir
 * `.feuillets-content-modal-role`, ui/content-variant-modal.ts) : bordure
 * discrète, accent au survol, jetons de thème Obsidian, aucune couleur en
 * dur.
 *
 * Les cartes sont des `div[role="button"]` et NON des `<button>` : Obsidian
 * impose aux boutons de ses modales une hauteur et un `white-space: nowrap`
 * (voir `.modal button:not(.mod-cta)…` dans styles.css) qui faisaient sortir
 * le texte de sa boîte et chevaucher la rubrique suivante. Accessibilité
 * assurée à la main : `role`, `tabindex` et activation clavier Entrée/Espace.
 */
import { Modal, setIcon, type App } from "obsidian";
import type { PresentationPdfPageFormat, PresentationHandoutDensity } from "../services/presentation-pdf-export.js";
import type { PresentationPlanScope } from "../services/presentation-plan.js";
import { t } from "../i18n/index.js";

export type PresentationPdfExportChoice =
  | { kind: "presentation"; pageFormat: PresentationPdfPageFormat }
  | { kind: "handout"; slidesPerPage: PresentationHandoutDensity }
  | { kind: "plan"; scope: PresentationPlanScope };

interface ExportOption {
  choice: PresentationPdfExportChoice;
  label: string;
  hint: string;
}

interface ExportGroup {
  icon: string;
  title: string;
  description: string;
  options: ExportOption[];
}

export class PresentationPdfExportModal extends Modal {
  private readonly onChoose: (choice: PresentationPdfExportChoice) => void;

  constructor(app: App, onChoose: (choice: PresentationPdfExportChoice) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  /** Les trois rubriques et leurs options — une seule source, lue aussi
   * bien pour construire le DOM que par les tests. */
  private groups(): ExportGroup[] {
    const a4Portrait = t("presentation.plan.paperFormatA4Portrait");
    return [
      {
        icon: "presentation",
        title: t("presentation.export.pdf.groupPresentation"),
        description: t("presentation.export.pdf.groupPresentationDesc"),
        options: [
          { choice: { kind: "presentation", pageFormat: "16:9" }, label: t("presentation.export.pdf.format169"), hint: t("presentation.export.pdf.format169Hint") },
          { choice: { kind: "presentation", pageFormat: "a4-landscape" }, label: t("presentation.export.pdf.formatA4"), hint: t("presentation.export.pdf.formatA4Hint") },
        ],
      },
      {
        icon: "layout-grid",
        title: t("presentation.handout.groupTitle"),
        description: t("presentation.handout.groupDesc", { format: a4Portrait }),
        options: ([2, 4, 6] as const).map((slidesPerPage) => ({
          choice: { kind: "handout" as const, slidesPerPage },
          label: t("presentation.handout.perPage", { count: String(slidesPerPage) }),
          hint: t("presentation.handout.perPageHint", { count: String(slidesPerPage) }),
        })),
      },
      {
        icon: "clipboard-list",
        title: t("presentation.plan.groupTitle"),
        description: t("presentation.plan.groupDesc", { format: a4Portrait }),
        options: [
          { choice: { kind: "plan", scope: "all" }, label: t("presentation.plan.scopeAll"), hint: t("presentation.plan.scopeAllHint") },
          { choice: { kind: "plan", scope: "notes-only" }, label: t("presentation.plan.scopeNotesOnly"), hint: t("presentation.plan.scopeNotesOnlyHint") },
        ],
      },
    ];
  }

  onOpen(): void {
    this.modalEl.addClass("feuillets-presentation-export-modal");
    this.titleEl.setText(t("presentation.export.pdf.tooltip"));
    this.contentEl.empty();

    for (const group of this.groups()) {
      const section = this.contentEl.createDiv({ cls: "feuillets-presentation-export-group" });

      const head = section.createDiv({ cls: "feuillets-presentation-export-group-head" });
      const icon = head.createSpan({ cls: "feuillets-presentation-export-group-icon" });
      setIcon(icon, group.icon);
      const heading = head.createDiv({ cls: "feuillets-presentation-export-group-heading" });
      heading.createDiv({ cls: "feuillets-presentation-export-group-title", text: group.title });
      heading.createDiv({ cls: "feuillets-presentation-export-group-desc", text: group.description });

      const grid = section.createDiv({ cls: "feuillets-presentation-export-options" });
      for (const option of group.options) {
        const card = grid.createDiv({
          cls: "feuillets-presentation-export-option feuillets-clickable",
          attr: { role: "button", tabindex: "0", "aria-label": option.label },
        });
        card.createDiv({ cls: "feuillets-presentation-export-option-label", text: option.label });
        card.createDiv({ cls: "feuillets-presentation-export-option-hint", text: option.hint });
        const choose = (): void => {
          this.close();
          this.onChoose(option.choice);
        };
        card.addEventListener("click", choose);
        card.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          choose();
        });
      }
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
