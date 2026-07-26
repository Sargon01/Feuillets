import { FuzzySuggestModal } from "obsidian";
import { TextInputModal } from "../scenes-editor.js";
import { t } from "../i18n/index.js";

/** Sélectionne une fiche Source par recherche floue (titre + auteur),
 * demande ensuite une page — propre à CETTE citation, jamais stockée sur
 * la fiche, la même source pouvant être citée à des pages différentes —
 * puis appelle `onChoose(file, page)`. Le formatage (footnote/
 * parenthetical, Ibid.…) et l'insertion vivent dans
 * plugin.insertCitationFor (main.js), partagés avec l'icône "+" posée
 * directement sur chaque ligne de fiche (panneau Sources) qui saute
 * cette étape de recherche puisque la source est déjà connue. */
export class CitationSourceModal extends FuzzySuggestModal {
  constructor(app, plugin, sourceFiles, onChoose) {
    super(app);
    this.plugin = plugin;
    this.sourceFiles = sourceFiles;
    this.onChoose = onChoose;
    this.setPlaceholder(t("modal.citation.searchSourcePlaceholder"));
  }

  getItems() {
    return this.sourceFiles;
  }

  getItemText(file) {
    const fm = this.plugin.fmOf(file);
    const author = fm.author ? ` — ${fm.author}` : "";
    return `${this.plugin.titleFor(file)}${author}`;
  }

  onChooseItem(file) {
    promptForPage(this.app, this.plugin, file, this.onChoose);
  }
}

/** Demande juste la page — utilisé aussi bien après la recherche
 * (CitationSourceModal) que depuis l'icône "+" d'une ligne de fiche
 * (source déjà connue, pas besoin de chercher). */
export function promptForPage(app, plugin, file, onChoose) {
  new TextInputModal(
    app,
    t("modal.citation.citeTitle", { title: plugin.titleFor(file) }),
    [{ name: "page", label: t("modal.citation.pageLabel"), value: "" }],
    async (values) => {
      onChoose(file, values.page);
    }
  ).open();
}
