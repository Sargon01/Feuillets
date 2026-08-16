import {
  listExportTemplates,
  resolveExportTemplateV2,
  saveExportTemplateV2,
} from "../services/export-templates-custom.js";

import { Setting } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";
import { TitlePageMiniature } from "./title-page-miniature.js";

export type LayoutSelection = string | null;
export type ExportTemplateOption = { key: string; label: string };
export type TitlePageStyles = Record<string, TitlePageStyle>;
type OnLayoutChange = () => void | Promise<void>;
type NumberFieldSetter = (value: number | undefined) => void;
type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type LayoutEditorMode = "modal" | "workspace";
type LayoutPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

export type LayoutEditorOptions = {
  mode: LayoutEditorMode;
  templateLabel?: string;
  onChange?: OnLayoutChange;
  /** Notifié après chaque `select()` — permet à un hôte externe (la
   * maquette du LayoutModal) de resynchroniser son propre affichage
   * (bandes, blocs) sur le nouvel état, sans dupliquer cet état. */
  onSelectionChange?: (selected: LayoutSelection) => void;
  /** Notifié après chaque sauvegarde réussie (`saveTemplate`), AVANT
   * `onChange` — permet à la maquette du LayoutModal de se resynchroniser
   * (bandes en-tête/pied, positions des blocs) sans dupliquer l'état. */
  onSaved?: () => void;
};

function isTemplatePageSize(value: string): value is TemplatePageSize {
  return value === "A4" || value === "A5" || value === "Letter";
}

function isTemplateAlign(value: string): value is TemplateAlign {
  return value === "left" || value === "center" || value === "right" || value === "justify";
}

function isPageNumberPosition(value: string): value is ExportTemplateV2["firstPage"]["pageNumberPosition"] {
  return value === "left" || value === "center" || value === "right";
}

/** Cœur (extrait de l'ancien LayoutModal) partagé par la modale historique
 * (mode "modal") et le nouveau workspace central (mode "workspace") :
 * chargement du modèle V2, état des styles de page de titre, tous les
 * inspecteurs de catégorie, et la sauvegarde (`saveExportTemplateV2`).
 * Ne connaît RIEN de la maquette A4 glissable — celle-ci reste un souci du
 * LayoutModal en mode "modal" uniquement. */
export class LayoutEditor {
  app: App;
  plugin: LayoutPlugin;
  mode: LayoutEditorMode;
  templateKey: string;
  templateLabel: string;
  onChange: OnLayoutChange | undefined;
  onSelectionChange: ((selected: LayoutSelection) => void) | undefined;
  onSaved: (() => void) | undefined;

  template!: ExportTemplateV2;
  styles: TitlePageStyles;
  roles: string[];
  selected: LayoutSelection;
  selectedHeading: HeadingLevel;
  /** Rôle choisi par le sélecteur « Style des éléments » de la catégorie
   * Première page — workspace uniquement (§11 du chantier). */
  selectedRole: string | null;
  templates: ExportTemplateOption[] = [];

  /** Conteneur racine passé au constructeur. En mode "modal", c'est
   * directement l'élément inspecteur existant (aucune navigation propre :
   * la maquette du LayoutModal a déjà la sienne). En mode "workspace",
   * l'éditeur y construit sa propre navigation + inspecteur. */
  host: HTMLElement | null;
  navEl: HTMLElement | null;
  inspectorEl!: HTMLElement;
  navigationButtons: Record<string, HTMLElement>;
  /** Maquette de la page de titre — montée UNIQUEMENT sous « Première page »
   * en mode workspace (§28), et strictement le MÊME composant que celui du
   * LayoutModal (§29). `null` partout ailleurs. */
  miniature: TitlePageMiniature | null = null;

  constructor(app: App, plugin: LayoutPlugin, host: HTMLElement | null, templateKey: string, options: LayoutEditorOptions) {
    this.app = app;
    this.plugin = plugin;
    this.host = host;
    this.templateKey = templateKey;
    this.mode = options.mode;
    this.templateLabel = options.templateLabel || templateKey;
    this.onChange = options.onChange;
    this.onSelectionChange = options.onSelectionChange;
    this.onSaved = options.onSaved;
    this.styles = {};
    this.roles = [];
    this.selected = null;
    this.selectedHeading = "h1";
    this.selectedRole = null;
    this.navigationButtons = {};
    this.navEl = null;
    if (this.mode === "modal" && host) this.inspectorEl = host;
  }

  /** Attache (ou réattache) le conteneur hôte — utile en mode "modal" où
   * l'inspecteur n'existe qu'après reconstruction de la maquette. */
  attach(host: HTMLElement): void {
    this.host = host;
    if (this.mode === "modal") this.inspectorEl = host;
  }

  /** Recharge intégralement le modèle V2 depuis `templateKey` (rejoué au
   * changement de gabarit). En mode "workspace", (re)construit aussi la
   * navigation + l'inspecteur dans `host`. */
  async load(): Promise<void> {
    const S = this.plugin.settings;
    this.templates = await listExportTemplates(this.app, S);
    this.template = await resolveExportTemplateV2(this.app, S, this.templateKey);
    this.styles = JSON.parse(JSON.stringify(this.template.titlePage.styles)) as TitlePageStyles;
    this.roles = Object.keys(this.styles);
    this.selected = null;
    this.selectedRole = null;
    this.miniature = null;

    if (this.mode === "workspace" && this.host) this.renderWorkspace();
  }

  async setTemplateKey(key: string, label?: string): Promise<void> {
    this.templateKey = key;
    if (label) this.templateLabel = label;
    await this.load();
  }

  private renderWorkspace(): void {
    const host = this.host;
    if (!host) return;
    host.empty();
    this.navigationButtons = {};

    this.navEl = host.createDiv({ cls: "feuillets-layout-nav" });
    const categories: Array<[string, string]> = [
      ["page", t("modal.layout.categoryPage")],
      ["body", t("modal.layout.categoryBody")],
      ["headings", t("modal.layout.categoryHeadings")],
      ["blockquote", t("modal.layout.categoryBlockquote")],
      ["firstPage", t("modal.layout.categoryFirstPage")],
    ];
    for (const [key, label] of categories) {
      const button = this.navEl.createEl("button", { cls: "feuillets-layout-nav-item", text: label });
      button.addEventListener("click", () => this.select(key));
      this.navigationButtons[key] = button;
    }

    this.inspectorEl = host.createDiv({ cls: "feuillets-layout-inspector" });
    this.select("page");
  }

  notifyChange(): void {
    if (this.onChange) void this.onChange();
  }

  select(target: LayoutSelection): void {
    this.selected = target;
    if (target === "headings") this.selectedHeading = "h1";
    if (target !== "firstPage") this.selectedRole = null;
    for (const [key, button] of Object.entries(this.navigationButtons)) {
      button.toggleClass("is-active", key === target);
    }
    this.renderInspector();
    if (this.onSelectionChange) this.onSelectionChange(target);
  }

  renderInspector(): void {
    const insp = this.inspectorEl;
    insp.empty();
    // Reconstruite avec l'inspecteur : jamais un élément orphelin conservé.
    if (this.selected !== "firstPage") this.miniature = null;
    if (this.selected === "page") return this.renderPageInspector(insp);
    if (this.selected === "body") return this.renderBodyInspector(insp);
    if (this.selected === "headings") return this.renderHeadingsInspector(insp);
    if (this.selected === "blockquote") return this.renderBlockquoteInspector(insp);
    if (this.selected === "firstPage") return this.renderFirstPageInspector(insp);
    if (this.selected === "header") return this.renderHeaderInspector(insp);
    if (this.selected === "footer") return this.renderFooterInspector(insp);
    if (this.selected && this.styles[this.selected]) return this.renderBlockInspector(insp, this.selected);
    insp.createDiv({ cls: "setting-item-description" }).setText(t("modal.layout.clickAZone"));
  }

  /** Champ numérique V2 partagé par les inspecteurs compacts (en-tête/pied). */
  private bandNumber(
    insp: HTMLElement,
    name: string,
    value: () => number,
    set: (value: number) => void,
  ): void {
    new Setting(insp).setName(name).addText((t2) => {
      t2.inputEl.type = "number";
      t2.setValue(String(value())).onChange(async (v) => {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) return;
        set(Math.max(0, n));
        await this.saveTemplate();
      });
    });
  }

  renderHeaderInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.headerAllPages") });
    new Setting(insp).setName(t("modal.layout.enableHeader")).addToggle((t2) =>
      t2.setValue(this.template.header.enabled).onChange(async (v) => {
        this.template.header.enabled = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName("Gauche").addText((t2) =>
      t2.setValue(this.template.header.left).onChange(async (v) => {
        this.template.header.left = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.headerCenter")).addText((t2) =>
      t2.setValue(this.template.header.center).onChange(async (v) => {
        this.template.header.center = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName("Droite").addText((t2) =>
      t2.setValue(this.template.header.right).onChange(async (v) => {
        this.template.header.right = v;
        await this.saveTemplate();
      })
    );
    this.bandNumber(insp, t("modal.layout.distanceToEdge"), () => this.template.header.distanceCm, (v) => this.template.header.distanceCm = v);
    this.bandNumber(insp, t("modal.layout.headerBodyGap"), () => this.template.header.bodyGapPt, (v) => this.template.header.bodyGapPt = v);
    new Setting(insp).setName(t("modal.layout.alternating")).addToggle((t2) =>
      t2.setValue(this.template.header.differentOddEven).onChange(async (v) => {
        this.template.header.differentOddEven = v;
        await this.saveTemplate();
      })
    );
    insp.createDiv({ cls: "setting-item-description", text: t("modal.layout.variables") });
  }

  renderFooterInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.footerNumber") });
    new Setting(insp).setName(t("modal.layout.enableFooter")).addToggle((t2) =>
      t2.setValue(this.template.footer.enabled).onChange(async (v) => {
        this.template.footer.enabled = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.formatWithVars")).addText((t2) =>
      t2.setValue(this.template.footer.right).onChange(async (v) => {
        this.template.footer.right = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.footerLeft")).addText((t2) =>
      t2.setValue(this.template.footer.left).onChange(async (v) => {
        this.template.footer.left = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.footerCenter")).addText((t2) =>
      t2.setValue(this.template.footer.center).onChange(async (v) => {
        this.template.footer.center = v;
        await this.saveTemplate();
      })
    );
    this.bandNumber(insp, t("modal.layout.distanceToEdge"), () => this.template.footer.distanceCm, (v) => this.template.footer.distanceCm = v);
    this.bandNumber(insp, t("modal.layout.footerBodyGap"), () => this.template.footer.bodyGapPt, (v) => this.template.footer.bodyGapPt = v);
    insp.createDiv({ cls: "setting-item-description", text: t("modal.layout.variables") });
  }

  renderBlockInspector(insp: HTMLElement, role: string): void {
    const st = this.styles[role];
    insp.createEl("h4", { text: role });
    const num = (name: string, get: () => number | undefined, set: NumberFieldSetter): Setting =>
      new Setting(insp).setName(name).addText((t2) => {
        t2.inputEl.type = "number";
        t2.setValue(get() != null ? String(get()) : "").onChange(async (v) => {
          const n = parseFloat(v);
          set(v.trim() === "" || !Number.isFinite(n) ? undefined : n);
          await this.saveModel();
        });
      });

    num(t("modal.layout.sizePt"), () => st.fontSizePt, (n) => (n == null ? delete st.fontSizePt : (st.fontSizePt = n)));

    new Setting(insp).setName(t("modal.layout.alignment")).then((s) => {
      const alignments: Array<[string, string]> = [["left", "align-left"], ["center", "align-center"], ["right", "align-right"]];
      for (const [val, icon] of alignments) {
        s.addExtraButton((b) => {
          b.setIcon(icon).setTooltip(val).onClick(async () => {
            st.align = val;
            this.renderInspector();
            await this.saveModel();
          });
          if ((st.align || "center") === val) b.extraSettingsEl.addClass("is-active");
        });
      }
    });

    num(t("modal.layout.marginAbove"), () => st.marginTopPt, (n) => (n == null ? delete st.marginTopPt : (st.marginTopPt = n)));
    num(t("modal.layout.marginBelow"), () => st.marginBottomPt, (n) => (n == null ? delete st.marginBottomPt : (st.marginBottomPt = n)));
  }

  private numberField(insp: HTMLElement, name: string, value: () => number, set: (value: number) => void): void {
    new Setting(insp).setName(name).addText((control) => {
      control.inputEl.type = "number";
      control.setValue(String(value())).onChange(async (raw) => {
        const next = Number.parseFloat(raw);
        if (!Number.isFinite(next)) return;
        set(next);
        await this.saveTemplate();
      });
    });
  }

  private optionalNumberField(insp: HTMLElement, name: string, value: () => number | undefined, set: (value: number | undefined) => void): void {
    new Setting(insp).setName(name).addText((control) => {
      control.inputEl.type = "number";
      const current = value();
      control.setValue(current == null ? "" : String(current)).onChange(async (raw) => {
        if (raw.trim() === "") set(undefined);
        else {
          const next = Number.parseFloat(raw);
          if (!Number.isFinite(next)) return;
          set(next);
        }
        await this.saveTemplate();
      });
    });
  }

  private textField(insp: HTMLElement, name: string, value: () => string, set: (value: string) => void): void {
    new Setting(insp).setName(name).addText((control) =>
      control.setValue(value()).onChange(async (next) => { set(next); await this.saveTemplate(); })
    );
  }

  renderPageInspector(insp: HTMLElement): void {
    /* Pas de titre "Page" ici : la navigation (workspace) ou l'onglet
       (modal) l'affiche déjà juste à côté — doublon évident, §4 du micro-lot
       finition UI. */
    this.textField(insp, "Format", () => this.template.page.size, (v) => {
      if (isTemplatePageSize(v)) this.template.page.size = v;
    });
    new Setting(insp).setName("Orientation").addDropdown((d) => d
      .addOption("portrait", "Portrait").addOption("landscape", "Paysage")
      .setValue(this.template.page.orientation).onChange(async (v) => {
        if (v === "portrait" || v === "landscape") this.template.page.orientation = v;
        await this.saveTemplate();
      }));
    for (const side of ["top", "bottom", "left", "right"] as const) {
      this.numberField(insp, `Marge ${side}`, () => this.template.page.marginsCm[side], (v) => this.template.page.marginsCm[side] = Math.max(0, v));
    }
    new Setting(insp).setName("Marges miroir").addToggle((control) => control.setValue(this.template.page.mirrorMargins).onChange(async (v) => {
      this.template.page.mirrorMargins = v; await this.saveTemplate();
    }));
    this.numberField(insp, "Colonnes", () => this.template.page.columns.count, (v) => this.template.page.columns.count = Math.max(1, Math.round(v)));
    this.numberField(insp, "Gouttière (pt)", () => this.template.page.columns.gutterPt, (v) => this.template.page.columns.gutterPt = Math.max(0, v));

    if (this.mode === "workspace") {
      // renderHeaderInspector/renderFooterInspector posent déjà leur propre
      // sous-titre ("En-tête (toutes les pages)" / "Pied de page (numéro)") —
      // aucun titre supplémentaire à ajouter ici, ce serait un doublon.
      this.renderHeaderInspector(insp);
      const footerSection = insp.createDiv({ cls: "feuillets-layout-section" });
      this.renderFooterInspector(footerSection);
    }
  }

  renderBodyInspector(insp: HTMLElement): void {
    const body = this.template.body;
    /* Pas de titre "Corps de texte" ici : doublon avec la navigation/l'onglet
       — même règle qu'en Page, §4. */
    this.textField(insp, "Police", () => body.fontFamily, (v) => body.fontFamily = v);
    this.numberField(insp, "Taille (pt)", () => body.fontSizePt, (v) => body.fontSizePt = Math.max(1, v));
    this.numberField(insp, "Interligne", () => body.lineHeight, (v) => body.lineHeight = Math.max(0.1, v));
    new Setting(insp).setName("Alignement").addDropdown((d) => d
      .addOption("left", "Gauche").addOption("center", "Centré").addOption("right", "Droite").addOption("justify", "Justifié")
      .setValue(body.align).onChange(async (v) => { if (isTemplateAlign(v)) body.align = v; await this.saveTemplate(); }));
    this.numberField(insp, "Retrait première ligne (pt)", () => body.firstLineIndentPt, (v) => body.firstLineIndentPt = Math.max(0, v));
    this.numberField(insp, "Espacement avant (pt)", () => body.paragraphSpacingBeforePt, (v) => body.paragraphSpacingBeforePt = Math.max(0, v));
    this.numberField(insp, "Espacement après (pt)", () => body.paragraphSpacingAfterPt, (v) => body.paragraphSpacingAfterPt = Math.max(0, v));
    new Setting(insp).setName("Césure").addToggle((control) => control.setValue(body.hyphenation).onChange(async (v) => { body.hyphenation = v; await this.saveTemplate(); }));
    new Setting(insp).setName("Profil").addDropdown((d) => d
      .addOption("manuscript", "Manuscrit").addOption("document", "Document").addOption("academic", "Académique")
      .setValue(this.template.profile).onChange(async (v) => {
        if (v === "manuscript" || v === "document" || v === "academic") this.template.profile = v;
        await this.saveTemplate();
      }));
  }

  renderHeadingsInspector(insp: HTMLElement): void {
    // Pas de titre "Titres" ici : doublon avec la navigation/l'onglet, §4.
    const picker = insp.createDiv({ cls: "feuillets-heading-level-picker" });
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      const button = picker.createEl("button", { cls: "feuillets-heading-level", text: level.toUpperCase() });
      button.toggleClass("is-active", this.selectedHeading === level);
      button.addEventListener("click", () => {
        this.selectedHeading = level;
        this.renderInspector();
      });
    }
    const style = this.template.headings[this.selectedHeading];
    const editor = insp.createDiv({ cls: "feuillets-heading-editor" });
    editor.createEl("h5", { text: this.selectedHeading.toUpperCase() });
    this.textField(editor, "Police", () => style.fontFamily || "", (v) => style.fontFamily = v.trim() || undefined);
    this.numberField(editor, "Taille (pt)", () => style.fontSizePt ?? 0, (v) => style.fontSizePt = v || undefined);
    new Setting(editor).setName("Gras").addToggle((c) => c.setValue(!!style.bold).onChange(async (v) => { style.bold = v; await this.saveTemplate(); }));
    new Setting(editor).setName("Italique").addToggle((c) => c.setValue(!!style.italic).onChange(async (v) => { style.italic = v; await this.saveTemplate(); }));
    this.textField(editor, "Alignement", () => style.align || "left", (v) => {
      if (isTemplateAlign(v)) style.align = v;
    });
    this.numberField(editor, "Espace avant", () => style.marginTopPt ?? 0, (v) => style.marginTopPt = v || undefined);
    this.numberField(editor, "Espace après", () => style.marginBottomPt ?? 0, (v) => style.marginBottomPt = v || undefined);
    new Setting(editor).setName("Saut de page avant").addToggle((c) => c.setValue(!!style.pageBreakBefore).onChange(async (v) => { style.pageBreakBefore = v; await this.saveTemplate(); }));
  }

  renderBlockquoteInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: "Citation et séparateur" });
    const quote = this.template.blockquote;
    this.textField(insp, "Police", () => quote.fontFamily || "", (v) => quote.fontFamily = v.trim() || undefined);
    this.optionalNumberField(insp, "Taille (pt)", () => quote.fontSizePt, (v) => quote.fontSizePt = v);
    this.optionalNumberField(insp, "Interligne", () => quote.lineHeight, (v) => quote.lineHeight = v);
    new Setting(insp).setName("Alignement").addDropdown((d) => d
      .addOption("", "Par défaut").addOption("left", "Gauche").addOption("center", "Centré").addOption("right", "Droite").addOption("justify", "Justifié")
      .setValue(quote.align || "").onChange(async (v) => { quote.align = isTemplateAlign(v) ? v : undefined; await this.saveTemplate(); }));
    this.optionalNumberField(insp, "Retrait première ligne (pt)", () => quote.firstLineIndentPt, (v) => quote.firstLineIndentPt = v);
    this.optionalNumberField(insp, "Marge gauche (pt)", () => quote.marginLeftPt, (v) => quote.marginLeftPt = v);
    this.optionalNumberField(insp, "Marge droite (pt)", () => quote.marginRightPt, (v) => quote.marginRightPt = v);
    this.optionalNumberField(insp, "Espace avant (pt)", () => quote.marginTopPt, (v) => quote.marginTopPt = v);
    this.optionalNumberField(insp, "Espace après (pt)", () => quote.marginBottomPt, (v) => quote.marginBottomPt = v);
    new Setting(insp).setName("Italique").addDropdown((d) => d
      .addOption("", "Par défaut").addOption("true", "Italique").addOption("false", "Normal")
      .setValue(quote.italic === undefined ? "" : String(quote.italic)).onChange(async (v) => { quote.italic = v === "" ? undefined : v === "true"; await this.saveTemplate(); }));
    this.textField(insp, "Couleur", () => quote.colorHex || "", (v) => quote.colorHex = v.trim() || undefined);
    this.textField(insp, "Séparateur de scène", () => this.template.sceneDivider, (v) => this.template.sceneDivider = v);
  }

  renderFirstPageInspector(insp: HTMLElement): void {
    /* §28 : la maquette visuelle ne réapparaît QUE dans Mise en page →
       Première page (jamais dans Page, Corps, Titres ni Citation), et
       uniquement en mode workspace — en mode "modal", le LayoutModal monte
       déjà SA maquette à côté de l'inspecteur (même composant partagé). */
    if (this.mode === "workspace") this.mountFirstPageMiniature(insp);

    // Pas de titre "Première page" ici : doublon avec la navigation/l'onglet, §4.
    new Setting(insp).setName("Masquer en-tête et pied").addToggle((c) => c.setValue(this.template.firstPage.hideHeader).onChange(async (v) => { this.template.firstPage.hideHeader = v; await this.saveTemplate(); }));
    new Setting(insp).setName(t("modal.layout.pageNumberPosition")).addDropdown((d) => d
      .addOption("left", t("modal.layout.alignLeft"))
      .addOption("center", t("modal.layout.alignCenter"))
      .addOption("right", t("modal.layout.alignRight"))
      .setValue(this.template.firstPage.pageNumberPosition).onChange(async (v) => {
        if (isPageNumberPosition(v)) this.template.firstPage.pageNumberPosition = v;
        await this.saveTemplate();
      }));

    if (this.mode !== "workspace") return;

    /* "Style des éléments" : titre de sous-section conservé une seule fois ;
       le champ lui-même se nomme "Élément" (pas "Style des éléments"),
       §4 du micro-lot finition UI. */
    const roleSection = insp.createDiv({ cls: "feuillets-layout-section" });
    roleSection.createEl("h4", { text: t("modal.layout.elementStyle") });
    new Setting(roleSection).setName(t("modal.layout.element")).addDropdown((d) => {
      d.addOption("", t("modal.layout.chooseElement"));
      for (const role of this.roles) d.addOption(role, role);
      d.setValue(this.selectedRole || "").onChange((v) => {
        this.selectedRole = v || null;
        this.renderInspector();
      });
    });
    if (this.selectedRole && this.styles[this.selectedRole]) {
      this.renderBlockInspector(roleSection, this.selectedRole);
    }
  }

  /** §29-§31 : réutilise TitlePageMiniature telle quelle — clic sur un bloc
   * = sélection du rôle affichée par l'inspecteur, glisser vertical =
   * `marginTopPt` existant, sauvegarde dans le MÊME ExportTemplateV2, puis
   * rafraîchissement du vrai Preview via `onChange`. Aucune donnée nouvelle. */
  private mountFirstPageMiniature(insp: HTMLElement): void {
    const host = insp.createDiv({ cls: "feuillets-layout-miniature" });
    this.miniature = new TitlePageMiniature(host, this, {
      heightPx: 260,
      onSelect: (target) => {
        /* Un clic sur un bloc choisit son rôle SANS quitter la catégorie
           Première page : l'inspecteur affiche ce rôle juste sous la maquette.
           Un clic sur une bande est ignoré ici — en workspace, en-tête et pied
           s'éditent dans la catégorie Page (aucun doublon d'interface). */
        if (typeof target !== "string" || !this.styles[target]) return;
        this.selected = "firstPage";
        this.selectedRole = target;
        this.renderInspector();
      },
      onDragValue: () => this.syncMiniatureInspector(),
    });
    this.miniature.mount();
  }

  /** Met à jour le champ « marge au-dessus » pendant un glisser, sans
   * reconstruire l'inspecteur (garde le focus des autres champs) — même
   * contrat que LayoutModal.syncInspectorValues. */
  private syncMiniatureInspector(): void {
    const role = this.selectedRole;
    if (!role || !this.styles[role]) return;
    const inputs = this.inspectorEl.querySelectorAll<HTMLInputElement>('input[type="number"]');
    const target = inputs[inputs.length - 2];
    if (target) target.value = this.styles[role].marginTopPt != null ? String(this.styles[role].marginTopPt) : "";
  }

  async saveModel(): Promise<void> {
    this.template.titlePage.styles = JSON.parse(JSON.stringify(this.styles)) as TitlePageStyles;
    await this.saveTemplate();
  }

  async saveTemplate(): Promise<void> {
    await saveExportTemplateV2(this.app, this.plugin.settings, this.templateKey, this.template);
    // La maquette du workspace suit le modèle sauvegardé (format, orientation,
    // bandes, positions) sans passer par une reconstruction complète.
    this.miniature?.refresh();
    if (this.onSaved) this.onSaved();
    this.notifyChange();
  }
}
