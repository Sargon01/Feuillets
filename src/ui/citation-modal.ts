import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { TextInputModal } from "../scenes-editor.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";

type CitationPlugin = {
  fmOf(file: TFile): Record<string, unknown>;
  titleFor(file: TFile): string;
};

type CitationChoiceHandler = (file: TFile, page: string) => void;

/** Sélectionne une fiche Source par recherche floue (titre + auteur),
 * demande ensuite une page — propre à CETTE citation, jamais stockée sur
 * la fiche, la même source pouvant être citée à des pages différentes —
 * puis appelle `onChoose(file, page)`. Le formatage (footnote/
 * parenthetical, Ibid.…) et l'insertion vivent dans
 * plugin.insertCitationFor (main.js), partagés avec l'icône "+" posée
 * directement sur chaque ligne de fiche (panneau Sources) qui saute
 * cette étape de recherche puisque la source est déjà connue. */
export class CitationSourceModal extends FuzzySuggestModal<TFile> {
  plugin: CitationPlugin;
  sourceFiles: TFile[];
  onChoose: CitationChoiceHandler;

  constructor(app: App, plugin: CitationPlugin, sourceFiles: TFile[], onChoose: CitationChoiceHandler) {
    super(app);
    this.plugin = plugin;
    this.sourceFiles = sourceFiles;
    this.onChoose = onChoose;
    this.setPlaceholder(t("modal.citation.searchSourcePlaceholder"));
  }

  getItems(): TFile[] {
    return this.sourceFiles;
  }

  getItemText(file: TFile): string {
    const fm = this.plugin.fmOf(file);
    const authorStr = toValue(fm.author);
    const author = authorStr ? ` — ${authorStr}` : "";
    return `${this.plugin.titleFor(file)}${author}`;
  }

  onChooseItem(file: TFile): void {
    promptForPage(this.app, this.plugin, file, this.onChoose);
  }
}

/** Demande juste la page — utilisé aussi bien après la recherche
 * (CitationSourceModal) que depuis l'icône "+" d'une ligne de fiche
 * (source déjà connue, pas besoin de chercher). */
export function promptForPage(app: App, plugin: CitationPlugin, file: TFile, onChoose: CitationChoiceHandler): void {
  new TextInputModal(
    app,
    t("modal.citation.citeTitle", { title: plugin.titleFor(file) }),
    [{ name: "page", label: t("modal.citation.pageLabel"), value: "" }],
    async (values: { page: string }) => {
      onChoose(file, values.page);
    }
  ).open();
}
