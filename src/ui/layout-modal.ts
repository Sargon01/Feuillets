import { listExportTemplates } from "../services/export-templates-custom.js";

import { Modal } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";
import { LayoutEditor } from "./layout-editor.js";
import { TitlePageMiniature } from "./title-page-miniature.js";
import type { ExportTemplateOption, LayoutSelection, TitlePageStyles } from "./layout-editor.js";

type BlockElements = Record<string, HTMLElement>;
type OnLayoutChange = () => void;
type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type LayoutPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

/** Éditeur visuel de MISE EN PAGE (option A) : une seule maquette A4 réunit
 * l'en-tête (bande haute), les blocs de la page de titre (milieu, glissables)
 * et le pied de page (bande basse). Cliquer une zone l'ouvre dans
 * l'inspecteur. En-tête, pied et blocs de titre appartiennent au MODÈLE V2
 * écrit dans son .md. La première page peut masquer les bandes : elles sont
 * alors grisées dans la maquette.
 *
 * Depuis l'extraction du LayoutEditor (chantier « mise en page centrale »)
 * puis de la maquette elle-même (TitlePageMiniature, §29 du chantier « espace
 * central »), cette modale ne contient plus AUCUNE logique propre : le modèle
 * V2, l'état des styles et les inspecteurs vivent dans `this.editor`
 * (ui/layout-editor.ts), la maquette glissable dans `this.miniature`
 * (ui/title-page-miniature.ts) — les deux partagés tels quels avec la
 * catégorie « Première page » de l'espace central. */
export class LayoutModal extends Modal {
  plugin: LayoutPlugin;
  templateKey: string;
  templateLabel: string;
  onChange: OnLayoutChange | undefined;
  editor: LayoutEditor;
  miniature!: TitlePageMiniature;
  templates: ExportTemplateOption[] = [];
  titleEl!: HTMLElement;
  layoutContainer!: HTMLElement;
  inspectorEl!: HTMLElement;
  navigationButtons: Record<string, HTMLElement>;

  constructor(app: App, plugin: LayoutPlugin, templateKey: string, templateLabel: string, onChange?: OnLayoutChange) {
    super(app);
    this.plugin = plugin;
    this.templateKey = templateKey;
    this.templateLabel = templateLabel;
    this.onChange = onChange; // rafraîchit le panneau après un changement
    this.navigationButtons = {};
    this.editor = new LayoutEditor(app, plugin, null, templateKey, {
      mode: "modal",
      templateLabel,
      onChange: () => this.notifyChange(),
      onSaved: () => this.miniature?.refresh(),
    });
  }

  /** Blocs de la maquette — reflet direct de TitlePageMiniature, conservé
   * comme propriété de la modale pour ne rien changer à sa surface publique. */
  get blockEls(): BlockElements { return this.miniature?.blockEls ?? {}; }
  get pageEl(): HTMLElement { return this.miniature.pageEl; }
  get headerBand(): HTMLElement { return this.miniature.headerBand; }
  get footerBand(): HTMLElement { return this.miniature.footerBand; }

  /** Reflets directs de l'état du LayoutEditor — conservés comme propriétés
   * de la modale pour ne rien changer à sa surface publique (tests). */
  get template(): ExportTemplateV2 { return this.editor.template; }
  get styles(): TitlePageStyles { return this.editor.styles; }
  get roles(): string[] { return this.editor.roles; }
  get selected(): LayoutSelection { return this.editor.selected; }
  get selectedHeading(): HeadingLevel { return this.editor.selectedHeading; }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-titlepage-modal");
    contentEl.empty();
    this.titleEl = contentEl.createEl("h3", { cls: "feuillets-tp-title" });
    contentEl.createEl("p", {
      cls: "setting-item-description feuillets-tp-desc",
      text: t("modal.layout.clickToEdit"),
    });

    const S = this.plugin.settings;
    this.templates = await listExportTemplates(this.app, S);
    if (!this.templates.some((tpl) => tpl.key === this.templateKey) && this.templates[0]) {
      this.templateKey = this.templates[0].key;
      this.editor.templateKey = this.templateKey;
    }

    this.layoutContainer = contentEl.createDiv();
    await this.renderLayout();
  }

  /** (Re)charge les blocs du modèle courant et (re)construit la maquette
   * (bandes + blocs + inspecteur) — rejoué quand on change de modèle. */
  async renderLayout(): Promise<void> {
    this.titleEl.setText(t("modal.layout.pageLayoutTitle", { name: this.templateLabel || this.templateKey }));
    const c = this.layoutContainer;
    c.empty();

    await this.editor.load();

    const wrap = c.createDiv({ cls: "feuillets-tp-editor" });
    const navigation = wrap.createDiv({ cls: "feuillets-tp-navigation" });
    for (const [key, label] of [["page", "Page"], ["body", "Corps de texte"], ["headings", "Titres"], ["blockquote", "Citation et séparateur"], ["firstPage", "Première page"]]) {
      const button = navigation.createEl("button", { cls: "feuillets-tp-navigation-item", text: label });
      button.addEventListener("click", () => this.select(key));
      this.navigationButtons[key] = button;
    }
    const pageHost = wrap.createDiv();
    this.miniature = new TitlePageMiniature(pageHost, this.editor, {
      onSelect: (target) => this.select(target),
      onDragValue: () => this.syncInspectorValues(),
    });
    this.miniature.mount();

    this.inspectorEl = wrap.createDiv({ cls: "feuillets-tp-inspector" });
    this.editor.attach(this.inspectorEl);

    this.miniature.refresh();
    this.editor.renderInspector();
  }

  notifyChange(): void {
    if (this.onChange) this.onChange();
  }

  /** Délégations à la maquette partagée — surface publique de la modale
   * inchangée (tests historiques). */
  buildBlocks(): void { this.miniature.mount(); }
  layout(): void { this.miniature.layout(); }
  renderBands(): void { this.miniature.renderBands(); }
  startDrag(e: PointerEvent, role: string): void { this.miniature.startDrag(e, role); }

  select(target: LayoutSelection): void {
    this.editor.select(target);
    this.syncNavigation(target);
    this.miniature.refresh();
  }

  /** Aligne la navigation propre à la modale sur la sélection courante — que
   * le changement vienne d'un onglet ou d'un clic dans la maquette. */
  private syncNavigation(target: LayoutSelection): void {
    for (const [key, button] of Object.entries(this.navigationButtons)) {
      button.toggleClass("is-active", key === target);
    }
  }

  /** Met à jour le champ « marge au-dessus » pendant un glisser, sans
   * reconstruire l'inspecteur (garde le focus des autres champs). */
  syncInspectorValues(): void {
    if (!this.selected || !this.styles[this.selected]) return;
    const st = this.styles[this.selected];
    const inputs = this.inspectorEl.querySelectorAll<HTMLInputElement>('input[type="number"]');
    // ordre : Taille, Marge au-dessus, Marge en dessous
    if (inputs[1]) inputs[1].value = st.marginTopPt != null ? String(st.marginTopPt) : "";
  }

  async saveModel(): Promise<void> {
    await this.editor.saveModel();
  }

  async saveTemplate(): Promise<void> {
    await this.editor.saveTemplate();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
