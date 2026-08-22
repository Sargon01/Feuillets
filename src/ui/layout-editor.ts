import {
  listExportTemplates,
  resolveExportTemplateV2,
  saveExportTemplateV2,
} from "../services/export-templates-custom.js";

import { Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import { getLocale, t } from "../i18n/index.js";
import { TitlePageMiniature } from "./title-page-miniature.js";
import { isPedagogicalA4Template } from "../utils/export-templates.js";
import { PEDAGOGICAL_PALETTE } from "../utils/pedagogical-roles.js";

export type LayoutSelection = string | null;
export type ExportTemplateOption = { key: string; label: string };
export type TitlePageStyles = Record<string, TitlePageStyle>;
type OnLayoutChange = () => void | Promise<void>;
type NumberFieldSetter = (value: number | undefined) => void;
type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type LayoutEditorMode = "modal" | "workspace";
export type LayoutSummaryPage =
  | "home"
  | "page"
  | "page-format"
  | "page-margins"
  | "page-header"
  | "page-footer"
  | "text"
  | "text-current"
  | "text-paragraphs"
  | "text-options"
  | "headings"
  | "heading-h1"
  | "heading-h2"
  | "heading-h3"
  | "heading-h4"
  | "heading-h5"
  | "heading-h6"
  | "elements"
  | "blockquote"
  | "scene-divider";
/** Navigation du mode "workspace" — CORRECTIF PROMPT 2/3 : "rail" est le
 * comportement historique (colonne latérale Page/Corps/Titres/Citation,
 * espace central), "summary" une navigation alternative pour le panneau
 * droit (sommaire à quatre lignes, une catégorie ouverte à la fois) —
 * mêmes inspecteurs, mêmes données, même sauvegarde, aucune duplication. */
export type LayoutWorkspaceNavigation = "rail" | "summary";
export type LayoutEditorPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};
/** Alias interne — LayoutEditor lui-même continue d'utiliser ce nom en
 * interne, seul le type exporté pour les autres modules (Composition, §6 du
 * dernier lot UX avant 2.5) change de nom. */
type LayoutPlugin = LayoutEditorPlugin;

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
  /** Navigation du mode "workspace" uniquement (ignoré en mode "modal") —
   * défaut "rail" : tous les appelants existants restent strictement
   * identiques sans le préciser. */
  workspaceNavigation?: LayoutWorkspaceNavigation;
  /** Sidebar embedded uniquement — notifié à chaque rendu du sommaire :
   * `isRoot` ne vaut true que sur la page d'accueil des catégories. Le
   * parent (SidebarFeuilletsView) ne retient QUE cette racine pour décider
   * d'afficher ou non son « Retour à Édition » : aucun état partagé, aucune
   * donnée, aucun déclenchement de leaf. */
  onNavigationRootChange?: (isRoot: boolean) => void;
};

/** Étiquette affichée pour un RÔLE de page de titre — utilisée par
 * l'inspecteur (renderBlockInspector, dropdown « Élément ») et par la
 * maquette (TitlePageMiniature), jamais par la donnée elle-même : le rôle
 * stocké dans `titlePage.styles`/`:::rôle:` (voir utils/title-roles.ts)
 * reste TOUJOURS son nom canonique français ("titre", "sous-titre"…),
 * verrouillé (classique.md, titlePage.styles finalisé) — seul son
 * AFFICHAGE change de langue. Mêmes clés que le formulaire « Première
 * page » (previewFirstPageFields, ui/first-page-panel.ts) pour
 * titre/sous-titre/auteur/mots/image : une seule traduction par rôle,
 * jamais deux formulations différentes pour la même chose. Un rôle
 * inconnu (modèle personnalisé avec un rôle libre, voir title-roles.ts)
 * retombe sur son nom brut — jamais une clé i18n manquante affichée telle
 * quelle. */
const TITLE_ROLE_LABEL_KEYS: Record<string, string> = {
  "titre": "preview.firstPageField.title",
  "sous-titre": "preview.firstPageField.subtitle",
  "auteur": "preview.firstPageField.author",
  "mots": "preview.firstPageField.additionalMention",
  "image": "preview.firstPageField.imageOrLogo",
  "adresse": "modal.layout.roleAddress",
  "coordonnées": "modal.layout.roleContact",
};

export function titleRoleLabel(role: string): string {
  const key = TITLE_ROLE_LABEL_KEYS[role];
  return key ? t(key) : role;
}

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
  /** Sidebar embedded — informateur racine du sommaire summary (voir
   * LayoutEditorOptions.onNavigationRootChange). */
  onNavigationRootChange: ((isRoot: boolean) => void) | undefined;

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
  /** "rail" (historique, espace central) ou "summary" (sommaire à quatre
   * lignes, panneau droit — CORRECTIF PROMPT 2/3, §7-§8). */
  workspaceNavigation: LayoutWorkspaceNavigation;
  /** Page actuellement affichée en navigation "summary" — "home" =
   * sommaire affiché, autres = sous-pages. Sans effet en "rail". */
  private summaryPage: LayoutSummaryPage = "home";
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
    this.onNavigationRootChange = options.onNavigationRootChange;
    this.styles = {};
    this.roles = [];
    this.selected = null;
    this.selectedHeading = "h1";
    this.selectedRole = null;
    this.navigationButtons = {};
    this.navEl = null;
    this.workspaceNavigation = options.workspaceNavigation || "rail";
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
    await this.loadModel();
    if (this.mode === "workspace" && this.host) this.renderWorkspace();
  }

  /** Charge le modèle V2 SANS construire la navigation — factorisé hors de
   * `load()` pour que `renderStandaloneFirstPage()` (Composition → Première
   * page, §6) partage exactement le même chargement, sans duplication. */
  private async loadModel(): Promise<void> {
    const S = this.plugin.settings;
    this.templates = await listExportTemplates(this.app, S);
    this.template = await resolveExportTemplateV2(this.app, S, this.templateKey);
    this.styles = JSON.parse(JSON.stringify(this.template.titlePage.styles)) as TitlePageStyles;
    this.roles = Object.keys(this.styles);
    this.selected = null;
    this.selectedRole = null;
    this.miniature = null;
  }

  /** Rendu autonome de la seule catégorie « Première page », SANS la
   * navigation Page/Corps/Titres/Citation — utilisé par Composition →
   * Première page (§6 du dernier lot UX avant 2.5). Mêmes contrôles, même
   * TitlePageMiniature, même ExportTemplateV2 que renderFirstPageInspector()
   * en mode workspace : aucune seconde source de vérité, aucune donnée de
   * page de titre dupliquée. */
  async renderStandaloneFirstPage(host: HTMLElement): Promise<void> {
    await this.loadModel();
    this.selected = "firstPage";
    this.inspectorEl = host;
    host.empty();
    this.renderFirstPageInspector(host);
  }

  async setTemplateKey(key: string, label?: string): Promise<void> {
    this.templateKey = key;
    if (label) this.templateLabel = label;
    await this.load();
  }

  /** Quatre catégories partagées par les deux navigations "rail" et
   * "summary" — mêmes clés, mêmes libellés, aucune duplication. */
  private static readonly CATEGORIES: Array<[string, string]> = [
    ["page", "modal.layout.categoryPage"],
    ["body", "modal.layout.categoryBody"],
    ["headings", "modal.layout.categoryHeadings"],
    ["blockquote", "modal.layout.categoryBlockquote"],
  ];

  private renderWorkspace(): void {
    const host = this.host;
    if (!host) return;
    host.empty();
    this.navigationButtons = {};
    this.navEl = null;

    if (this.workspaceNavigation === "summary") {
      this.renderSummaryNavigation(host);
      return;
    }

    this.navEl = host.createDiv({ cls: "feuillets-layout-nav" });
    /* §6-§7 du dernier lot UX avant 2.5 : "Première page" quitte la
       navigation Mise en page (renderWorkspace = workspace uniquement,
       jamais le LayoutModal historique qui construit sa propre nav séparée,
       voir layout-modal.ts) — elle vit désormais UNIQUEMENT dans
       Composition → Première page (voir renderStandaloneFirstPage
       ci-dessous, réutilisée depuis là par EditionCompositionContent). */
    for (const [key, labelKey] of LayoutEditor.CATEGORIES) {
      const button = this.navEl.createEl("button", { cls: "feuillets-layout-nav-item", text: t(labelKey) });
      button.addEventListener("click", () => this.select(key));
      this.navigationButtons[key] = button;
    }

    this.inspectorEl = host.createDiv({ cls: "feuillets-layout-inspector" });
    this.select("page");
  }

  /** Navigation "summary" (CORRECTIF PROMPT 2/3, §8-§9) : hiérarchie
   * arborescente — home affiche les 4 domaines, puis chaque domaine affiche
   * ses sous-pages, chaque sous-page affiche l'inspecteur précis. UNE PAGE À
   * LA FOIS : un UNIQUE host summary par rendu, vidé par renderWorkspace()
   * avant chaque nouveau rendu — jamais deux niveaux visibles côte à côte. */
  private renderSummaryNavigation(host: HTMLElement): void {
    const summaryHost = host.createDiv({ cls: "feuillets-layout-summary-host" });
    if (this.summaryPage === "home") {
      this.renderSummaryHome(summaryHost);
    } else {
      this.renderSummaryPage(summaryHost, this.summaryPage);
    }
    /* Le parent (sidebar embedded) ne veut savoir QUE si l'éditeur est sur
       sa page racine — « Retour à Édition » n'est rendu que dans ce cas
       seul (voir SidebarFeuilletsView). Aucun état dupliqué. */
    if (this.onNavigationRootChange) this.onNavigationRootChange(this.summaryPage === "home");
  }

  private renderSummaryHome(host: HTMLElement): void {
    const list = host.createDiv({ cls: "feuillets-layout-summary" });

    // Page
    this.renderSummarySubRow(list, "page", "modal.layout.categoryPage", () => {
      const size = this.template.page.size || "A4";
      const orientation = this.template.page.orientation;
      return `${size} · ${t(`modal.layout.${orientation}`)}`;
    });

    // Texte
    this.renderSummarySubRow(list, "text", "modal.layout.categoryText", () => {
      const font = this.template.body.fontFamily || "";
      const size = this.template.body.fontSizePt || 0;
      return `${this.displayFontFamily(font)} · ${size} pt`;
    });

    // Titres
    this.renderSummarySubRow(list, "headings", "modal.layout.categoryHeadings", () => {
      return t("modal.layout.h1ToH6");
    });

    // Éléments
    this.renderSummarySubRow(list, "elements", "modal.layout.categoryElements", () => {
      return "";
    });
  }

  private openSummaryPage(page: LayoutSummaryPage): void {
    this.summaryPage = page;
    this.renderWorkspace();
  }

  private renderSummaryPage(host: HTMLElement, page: LayoutSummaryPage): void {
    this.renderSummaryBackBar(host, page);
    const titleKey = this.summaryPageTitleKey(page);
    if (titleKey) {
      host.createEl("h4", { cls: "feuillets-layout-summary-title", text: t(titleKey) });
    }
    this.inspectorEl = host.createDiv({ cls: "feuillets-layout-inspector" });

    switch (page) {
      case "page":
        this.renderSummaryPageDomain(this.inspectorEl);
        break;
      case "page-format":
        this.renderPageFormatInspector(this.inspectorEl);
        break;
      case "page-margins":
        this.renderPageMarginsInspector(this.inspectorEl);
        break;
      case "page-header":
        this.renderHeaderInspector(this.inspectorEl);
        break;
      case "page-footer":
        this.renderFooterInspector(this.inspectorEl);
        break;
      case "text":
        this.renderSummaryTextDomain(this.inspectorEl);
        break;
      case "text-current":
        this.renderBodyTextInspector(this.inspectorEl);
        break;
      case "text-paragraphs":
        this.renderBodyParagraphInspector(this.inspectorEl);
        break;
      case "text-options":
        this.renderBodyOptionsInspector(this.inspectorEl);
        break;
      case "headings":
        this.renderSummaryHeadingsDomain(this.inspectorEl);
        break;
      case "heading-h1":
      case "heading-h2":
      case "heading-h3":
      case "heading-h4":
      case "heading-h5":
      case "heading-h6": {
        const level = page.replace("heading-", "") as HeadingLevel;
        this.selected = "headings";
        this.renderHeadingLevelInspector(this.inspectorEl, level);
        if (this.onSelectionChange) this.onSelectionChange("headings");
        break;
      }
      case "elements":
        this.renderSummaryElementsDomain(this.inspectorEl);
        break;
      case "blockquote":
        this.selected = "blockquote";
        this.renderBlockquoteStyleInspector(this.inspectorEl);
        if (this.onSelectionChange) this.onSelectionChange("blockquote");
        break;
      case "scene-divider":
        this.selected = "blockquote";
        this.renderSceneDividerInspector(this.inspectorEl);
        if (this.onSelectionChange) this.onSelectionChange("blockquote");
        break;
    }
  }

  private renderSummaryPageDomain(host: HTMLElement): void {
    const list = host.createDiv({ cls: "feuillets-layout-summary" });

    this.renderSummarySubRow(list, "page-format", "modal.layout.format", () => {
      const size = this.template.page.size || "A4";
      const orientation = this.template.page.orientation;
      return `${size} · ${t(`modal.layout.${orientation}`)}`;
    });

    this.renderSummarySubRow(list, "page-margins", "modal.layout.marginsGroup", () => {
      const { top, bottom, left, right } = this.template.page.marginsCm;
      const columns = this.template.page.columns.count;
      if (top === bottom && left === right && top === left) {
        const value = getLocale() === "fr" ? String(top).replace(".", ",") : String(top);
        return `${value} cm · ${columns} col.`;
      }
      return `${columns} col.`;
    });

    this.renderSummarySubRow(list, "page-header", "modal.layout.header", () => {
      return this.template.header.enabled ? t("modal.layout.enabled") : t("modal.layout.disabled");
    });

    this.renderSummarySubRow(list, "page-footer", "modal.layout.footer", () => {
      return this.template.footer.enabled ? t("modal.layout.enabled") : t("modal.layout.disabled");
    });
  }

  private renderSummaryTextDomain(host: HTMLElement): void {
    const list = host.createDiv({ cls: "feuillets-layout-summary" });

    this.renderSummarySubRow(list, "text-current", "modal.layout.currentText", () => {
      const body = this.template.body;
      const font = body.fontFamily || "";
      const size = body.fontSizePt || 0;
      return `${this.displayFontFamily(font)} · ${size} pt · ${this.alignmentLabel(body.align || "justify")}`;
    });

    this.renderSummarySubRow(list, "text-paragraphs", "modal.layout.paragraphsGroup", () => {
      const lineHeight = this.template.body.lineHeight || 1;
      const indent = this.template.body.firstLineIndentPt || 0;
      return `${t("modal.layout.lineHeight")} ${lineHeight} · ${t("modal.layout.summaryIndent")} ${indent} pt`;
    });

    this.renderSummarySubRow(list, "text-options", "modal.layout.typographyShort", () => {
      return "";
    });
  }

  private renderSummaryHeadingsDomain(host: HTMLElement): void {
    const list = host.createDiv({ cls: "feuillets-layout-summary" });
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      const headingKey = `modal.layout.${level}`;
      this.renderSummarySubRow(list, `heading-${level}` as LayoutSummaryPage, headingKey, () => {
        const size = this.template.headings[level].fontSizePt;
        if (size !== undefined && size > 0) return `${size} pt`;
        return t("modal.layout.inherited");
      });
    }
  }

  private renderSummaryElementsDomain(host: HTMLElement): void {
    const list = host.createDiv({ cls: "feuillets-layout-summary" });

    this.renderSummarySubRow(list, "blockquote", "modal.layout.blockquoteLabel", () => {
      return "";
    });

    this.renderSummarySubRow(list, "scene-divider", "modal.layout.sceneSeparatorsShort", () => {
      return "";
    });
  }

  /* GRAMMAIRE « PAGE DE NAVIGATION » (micro-correctif visuel) : une ligne =
   * une entrée — LABEL | STATUS | CHEVRON, TOUT sur la même ligne. Le label
   * et le status sont des frères DANS la row (jamais empilés par
   * flex-direction: column), le chevron ferme la ligne. */
  private renderSummarySubRow(
    list: HTMLElement,
    page: LayoutSummaryPage,
    labelKey: string,
    getStatus: () => string
  ): void {
    const row = list.createDiv({ cls: "feuillets-layout-summary-row", attr: { role: "button", tabindex: "0" } });
    row.createSpan({ cls: "feuillets-layout-summary-label", text: t(labelKey) });
    const status = getStatus();
    if (status) {
      row.createSpan({ cls: "feuillets-layout-summary-status", text: status });
    }
    const chevron = row.createSpan({ cls: "feuillets-layout-summary-chevron" });
    setIcon(chevron, "chevron-right");

    const open = (): void => this.openSummaryPage(page);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  private renderSummaryBackBar(host: HTMLElement, page: LayoutSummaryPage): void {
    const backBar = host.createDiv({ cls: "feuillets-layout-summary-back" });
    const backBtn = backBar.createEl("button", { cls: "feuillets-back-btn" });
    const iconSpan = backBtn.createSpan({ cls: "feuillets-back-icon" });
    setIcon(iconSpan, "arrow-left");
    backBtn.prepend(iconSpan);

    /* UN SEUL Retour, toujours vers le parent immédiat (§24) — la carte
       SUMMARY_PARENT est l'unique source de vérité du chemin de retour. */
    const parent = LayoutEditor.SUMMARY_PARENT[page];
    const text = backBtn.createSpan();
    text.textContent = ` ${t(this.summaryPageLabelKey(parent))}`;

    backBtn.addEventListener("click", () => {
      this.summaryPage = parent;
      this.renderWorkspace();
    });
  }

  /** Parent immédiat de chaque page summary — le retour est toujours celui
   * vers cette page parente, jamais un saut vers le sommaire racine. */
  private static readonly SUMMARY_PARENT: Record<LayoutSummaryPage, LayoutSummaryPage> = {
    home: "home",
    page: "home",
    "page-format": "page",
    "page-margins": "page",
    "page-header": "page",
    "page-footer": "page",
    text: "home",
    "text-current": "text",
    "text-paragraphs": "text",
    "text-options": "text",
    headings: "home",
    "heading-h1": "headings",
    "heading-h2": "headings",
    "heading-h3": "headings",
    "heading-h4": "headings",
    "heading-h5": "headings",
    "heading-h6": "headings",
    elements: "home",
    blockquote: "elements",
    "scene-divider": "elements",
  };

  /** Libellé affiché par le bouton Retour — le nom de la page parente. */
  private summaryPageLabelKey(page: LayoutSummaryPage): string {
    switch (page) {
      case "page": return "modal.layout.categoryPage";
      case "text": return "modal.layout.categoryText";
      case "headings": return "modal.layout.categoryHeadings";
      case "elements": return "modal.layout.categoryElements";
      default: return "layoutWorkspace.displayText";
    }
  }

  /** Titre affiché en tête d'une page summary — "home", en-tête et pied de
   * page n'en ont pas (leurs inspecteurs posent déjà leur propre sous-titre). */
  private summaryPageTitleKey(page: LayoutSummaryPage): string | null {
    switch (page) {
      case "page": return "modal.layout.categoryPage";
      case "page-format": return "modal.layout.formatOrientation";
      case "page-margins": return "modal.layout.marginsColumns";
      case "page-header": return null;
      case "page-footer": return null;
      case "text": return "modal.layout.categoryText";
      case "text-current": return "modal.layout.currentText";
      case "text-paragraphs": return "modal.layout.paragraphsGroup";
      case "text-options": return "modal.layout.typographicOptions";
      case "headings": return "modal.layout.categoryHeadings";
      case "heading-h1": return "modal.layout.h1";
      case "heading-h2": return "modal.layout.h2";
      case "heading-h3": return "modal.layout.h3";
      case "heading-h4": return "modal.layout.h4";
      case "heading-h5": return "modal.layout.h5";
      case "heading-h6": return "modal.layout.h6";
      case "elements": return "modal.layout.categoryElements";
      case "blockquote": return "modal.layout.blockquoteLabel";
      case "scene-divider": return "modal.layout.sceneSeparatorLabel";
      default: return null;
    }
  }

  /** Résume une face de police UNIQUEMENT pour l'affichage (statuts du
   * sommaire) : première famille avant la première virgule, guillemets
   * retirés, jamais la chaîne technique complète. Ne modifie jamais la
   * donnée sauvegardée. */
  private displayFontFamily(value: string): string {
    const first = value.split(",")[0].trim();
    return first.replace(/^['"]+|['"]+$/g, "");
  }

  /** Libellé i18n d'un alignement — jamais une clé construite dynamiquement. */
  private alignmentLabel(value: TemplateAlign): string {
    switch (value) {
      case "left": return t("modal.layout.alignLeft");
      case "center": return t("modal.layout.alignCenter");
      case "right": return t("modal.layout.alignRight");
      case "justify": return t("modal.layout.alignJustify");
    }
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

  /* §8 du dernier lot UX avant 2.5 : en-tête/pied désactivés n'affichent
     plus QUE le seul champ utile — l'interrupteur — au lieu de tous leurs
     champs grisés. Le bascule ré-affiche/masque le reste EN reconstruisant
     l'inspecteur (`renderInspector()`), seule façon de faire apparaître ou
     disparaître les champs suivants — jamais les données du gabarit.
     UNIQUEMENT en mode "workspace" (Édition → Mise en page, cible réelle du
     chantier) : le LayoutModal historique (mode "modal", où l'utilisatrice
     clique directement les bandes en-tête/pied de la maquette) continue
     d'afficher tous les champs, comportement inchangé — hors du périmètre de
     ce chantier. */

  renderHeaderInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.headerAllPages") });
    new Setting(insp).setName(t("modal.layout.enableHeader")).addToggle((t2) =>
      t2.setValue(this.template.header.enabled).onChange(async (v) => {
        this.template.header.enabled = v;
        await this.saveTemplate();
        if (this.mode === "workspace") this.renderInspector();
      })
    );
    if (this.mode === "workspace" && !this.template.header.enabled) return;
    new Setting(insp).setName(t("modal.layout.headerLeft")).addText((t2) =>
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
    new Setting(insp).setName(t("modal.layout.headerRight")).addText((t2) =>
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
        if (this.mode === "workspace") this.renderInspector();
      })
    );
    if (this.mode === "workspace" && !this.template.footer.enabled) return;
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
    insp.createEl("h4", { text: titleRoleLabel(role) });
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

  /** Champ numérique compact (drapeau `compact`) — pose la classe explicite
   * `feuillets-setting-compact` (label | contrôle en ligne sous le sidebar
   * embedded) UNIQUEMENT pour les réglages courts qui la méritent : jamais
   * automatique, jamais sur un autre Setting. */
  private numberField(insp: HTMLElement, name: string, value: () => number, set: (value: number) => void, compact = false): void {
    const setting = new Setting(insp).setName(name);
    if (compact) setting.setClass("feuillets-setting-compact");
    setting.addText((control) => {
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

  /** Champ texte — même drapeau `compact` que numberField, pour les seuls
   * libellés courts désignés (Police, …). */
  private textField(insp: HTMLElement, name: string, value: () => string, set: (value: string) => void, compact = false): void {
    const setting = new Setting(insp).setName(name);
    if (compact) setting.setClass("feuillets-setting-compact");
    setting.addText((control) =>
      control.setValue(value()).onChange(async (next) => { set(next); await this.saveTemplate(); })
    );
  }

  /** Champ couleur natif Obsidian (corps/titres) avec reset — §8-§9 du lot
   * couleurs/soulignement. `value` reste `undefined` tant que l'autrice n'a
   * rien choisi (absence = repli historique, jamais matérialisé) ; `effective`
   * ne sert qu'à initialiser visuellement le composant, jamais persisté par
   * la simple ouverture de l'inspecteur. Le reset supprime la propriété et
   * repasse par le MÊME mécanisme de sauvegarde (saveTemplate). */
  private colorField(insp: HTMLElement, name: string, value: () => string | undefined, effective: () => string, set: (value: string | undefined) => void): void {
    new Setting(insp).setName(name)
      .addColorPicker((cp) => {
        cp.setValue(value() || effective());
        cp.onChange(async (next) => { set(next || undefined); await this.saveTemplate(); });
      })
      .addExtraButton((b) => {
        b.setIcon("rotate-ccw").setTooltip(t("modal.layout.reset")).onClick(async () => {
          set(undefined);
          await this.saveTemplate();
          this.renderInspector();
        });
      });
  }

  private renderPageFormatInspector(insp: HTMLElement): void {
    new Setting(insp).setName(t("modal.layout.format")).setClass("feuillets-setting-compact").addDropdown((d) => d
      .addOption("A4", "A4").addOption("A5", "A5").addOption("Letter", "Letter")
      .setValue(isTemplatePageSize(this.template.page.size) ? this.template.page.size : "A4")
      .onChange(async (v) => {
        if (isTemplatePageSize(v)) this.template.page.size = v;
        await this.saveTemplate();
      }));
    new Setting(insp).setName(t("modal.layout.orientation")).setClass("feuillets-setting-compact").addDropdown((d) => d
      .addOption("portrait", t("modal.layout.portrait")).addOption("landscape", t("modal.layout.landscape"))
      .setValue(this.template.page.orientation).onChange(async (v) => {
        if (v === "portrait" || v === "landscape") this.template.page.orientation = v;
        await this.saveTemplate();
      }));
    new Setting(insp).setName("Disposition PDF / aperçu").setClass("feuillets-setting-compact").addDropdown((d) => d
      .addOption("single", "Une page")
      .addOption("two-up-successive", t("modal.layout.twoUpSuccessive"))
      .addOption("two-up-duplicate", t("modal.layout.twoUpDuplicate"))
      .setValue(this.template.page.outputLayout || "single")
      .onChange(async (v) => {
        if (v === "single" || v === "two-up-successive" || v === "two-up-duplicate") this.template.page.outputLayout = v;
        await this.saveTemplate();
      }));
    new Setting(insp).setName(t("modal.layout.semanticRoleMarkers")).setClass("feuillets-setting-compact").addDropdown((d) => d
      .addOption("legacy", t("modal.layout.semanticRoleMarkersLegacy"))
      .addOption("show", t("modal.layout.semanticRoleMarkersShow"))
      .addOption("hide", t("modal.layout.semanticRoleMarkersHide"))
      .setValue(this.template.semanticRoleMarkers || "legacy")
      .onChange(async (v) => {
        if (v === "legacy" || v === "show" || v === "hide") this.template.semanticRoleMarkers = v;
        await this.saveTemplate();
      }));
  }

  private renderPageMarginsInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.marginsGroup") });
    const marginLabels: Record<"top" | "bottom" | "left" | "right", string> = {
      top: t("modal.layout.marginTop"),
      bottom: t("modal.layout.marginBottom"),
      left: t("modal.layout.marginLeft"),
      right: t("modal.layout.marginRight"),
    };
    for (const side of ["top", "bottom", "left", "right"] as const) {
      this.numberField(insp, marginLabels[side], () => this.template.page.marginsCm[side], (v) => this.template.page.marginsCm[side] = Math.max(0, v), true);
    }
    new Setting(insp).setName(t("modal.layout.mirrorMargins")).setClass("feuillets-setting-compact").addToggle((control) => control.setValue(this.template.page.mirrorMargins).onChange(async (v) => {
      this.template.page.mirrorMargins = v; await this.saveTemplate();
    }));

    new Setting(insp).setName(t("modal.layout.columns")).setClass("feuillets-setting-compact").addText((control) => {
      control.inputEl.type = "number";
      control.setValue(String(this.template.page.columns.count)).onChange(async (raw) => {
        const next = Number.parseFloat(raw);
        if (!Number.isFinite(next)) return;
        const wasMulti = this.template.page.columns.count > 1;
        this.template.page.columns.count = Math.max(1, Math.round(next));
        await this.saveTemplate();
        if (wasMulti !== (this.template.page.columns.count > 1)) this.renderInspector();
      });
    });
    if (this.template.page.columns.count > 1) {
      this.numberField(insp, t("modal.layout.gutterPt"), () => this.template.page.columns.gutterPt, (v) => this.template.page.columns.gutterPt = Math.max(0, v), true);
    }
  }

  renderPageInspector(insp: HTMLElement): void {
    /* Pas de titre "Page" ici : la navigation (workspace) ou l'onglet
       (modal) l'affiche déjà juste à côté — doublon évident, §4 du micro-lot
       finition UI. */
    this.renderPageFormatInspector(insp);
    this.renderPageMarginsInspector(insp);

    if (this.mode === "workspace") {
      // renderHeaderInspector/renderFooterInspector posent déjà leur propre
      // sous-titre ("En-tête (toutes les pages)" / "Pied de page (numéro)") —
      // aucun titre supplémentaire à ajouter ici, ce serait un doublon.
      this.renderHeaderInspector(insp);
      const footerSection = insp.createDiv({ cls: "feuillets-layout-section" });
      this.renderFooterInspector(footerSection);
    }
  }

  private renderBodyTextInspector(insp: HTMLElement): void {
    const body = this.template.body;
    this.textField(insp, t("modal.layout.font"), () => body.fontFamily, (v) => body.fontFamily = v, true);
    this.numberField(insp, t("modal.layout.sizePt"), () => body.fontSizePt, (v) => body.fontSizePt = Math.max(1, v), true);
    new Setting(insp).setName(t("modal.layout.alignment")).setClass("feuillets-setting-compact").addDropdown((d) => d
      .addOption("left", t("modal.layout.alignLeft")).addOption("center", t("modal.layout.alignCenter")).addOption("right", t("modal.layout.alignRight")).addOption("justify", t("modal.layout.alignJustify"))
      .setValue(body.align).onChange(async (v) => { if (isTemplateAlign(v)) body.align = v; await this.saveTemplate(); }));
    this.colorField(insp, t("modal.layout.textColor"), () => body.colorHex, () => body.colorHex || "#000000", (v) => { body.colorHex = v; });
  }

  private renderBodyParagraphInspector(insp: HTMLElement): void {
    const body = this.template.body;
    /* « Retrait première ligne (pt) » reste volontairement RESPONSIVE (pas
       de classe compacte) : son intitulé ne tient pas de façon confortable
       dans la ligne compacte du sidebar — il passe sur deux lignes au lieu
       de se tronquer. */
    this.numberField(insp, t("modal.layout.lineHeight"), () => body.lineHeight, (v) => body.lineHeight = Math.max(0.1, v), true);
    this.numberField(insp, t("modal.layout.firstLineIndentPt"), () => body.firstLineIndentPt, (v) => body.firstLineIndentPt = Math.max(0, v));
    this.numberField(insp, t("modal.layout.spacingBeforePt"), () => body.paragraphSpacingBeforePt, (v) => body.paragraphSpacingBeforePt = Math.max(0, v), true);
    this.numberField(insp, t("modal.layout.spacingAfterPt"), () => body.paragraphSpacingAfterPt, (v) => body.paragraphSpacingAfterPt = Math.max(0, v), true);
  }

  private renderBodyOptionsInspector(insp: HTMLElement): void {
    const body = this.template.body;
    new Setting(insp).setName(t("modal.layout.hyphenation")).addToggle((control) => control.setValue(body.hyphenation).onChange(async (v) => { body.hyphenation = v; await this.saveTemplate(); }));
    new Setting(insp).setName(t("modal.layout.profile")).addDropdown((d) => d
      .addOption("manuscript", t("modal.layout.profileManuscript")).addOption("document", t("modal.layout.profileDocument")).addOption("academic", t("modal.layout.profileAcademic"))
      .setValue(this.template.profile).onChange(async (v) => {
        if (v === "manuscript" || v === "document" || v === "academic") this.template.profile = v;
        await this.saveTemplate();
      }));

    /* §2 du dernier lot UX avant 2.5 : "Typographie française à l'export"
       vit désormais ici (déplacée depuis Édition) — mais écrit TOUJOURS
       settings.exportFrenchTypography, JAMAIS le gabarit ExportTemplateV2 :
       ce réglage reste global au plugin, pas une propriété par gabarit. */
    new Setting(insp).setName(t("settings.exportFrenchTypography.name")).addToggle((c) =>
      c.setValue(this.plugin.settings.exportFrenchTypography !== false).onChange(async (v) => {
        this.plugin.settings.exportFrenchTypography = v;
        await this.plugin.saveSettings();
        this.notifyChange();
      })
    );
  }

  renderBodyInspector(insp: HTMLElement): void {
    /* Pas de titre "Corps de texte" ici : doublon avec la navigation/l'onglet
       — même règle qu'en Page, §4. */
    this.renderBodyTextInspector(insp);
    this.renderBodyParagraphInspector(insp);
    this.renderBodyOptionsInspector(insp);
  }

  private renderHeadingLevelInspector(insp: HTMLElement, level: HeadingLevel): void {
    const style = this.template.headings[level];
    this.textField(insp, t("modal.layout.font"), () => style.fontFamily || "", (v) => style.fontFamily = v.trim() || undefined);
    this.numberField(insp, t("modal.layout.sizePt"), () => style.fontSizePt ?? 0, (v) => style.fontSizePt = v || undefined);
    new Setting(insp).setName(t("modal.layout.bold")).addToggle((c) => c.setValue(!!style.bold).onChange(async (v) => { style.bold = v; await this.saveTemplate(); }));
    new Setting(insp).setName(t("modal.layout.italic")).addToggle((c) => c.setValue(!!style.italic).onChange(async (v) => { style.italic = v; await this.saveTemplate(); }));
    this.textField(insp, t("modal.layout.alignment"), () => style.align || "left", (v) => {
      if (isTemplateAlign(v)) style.align = v;
    });
    this.numberField(insp, t("modal.layout.headingSpaceBefore"), () => style.marginTopPt ?? 0, (v) => style.marginTopPt = v || undefined);
    this.numberField(insp, t("modal.layout.headingSpaceAfter"), () => style.marginBottomPt ?? 0, (v) => style.marginBottomPt = v || undefined);
    new Setting(insp).setName(t("modal.layout.pageBreakBefore")).addToggle((c) => c.setValue(!!style.pageBreakBefore).onChange(async (v) => { style.pageBreakBefore = v; await this.saveTemplate(); }));
    this.colorField(insp, t("modal.layout.color"), () => style.colorHex, () => this.headingEffectiveColor(level), (v) => { style.colorHex = v; });
    new Setting(insp).setName(t("modal.layout.underline")).addToggle((c) => c.setValue(!!style.underline).onChange(async (v) => { style.underline = v; await this.saveTemplate(); }));
  }

  /** Couleur visuelle du picker quand `colorHex` est absent — §10 du lot
   * couleurs/soulignement. Jamais persistée par cette lecture seule : ne
   * reproduit le repli rouge/rouge/vert du profil Document pédagogique A4
   * (voir isPedagogicalA4Template/PEDAGOGICAL_PALETTE, utils/export-templates.ts)
   * que pour H1-H3, sinon retombe sur la couleur du corps puis sur noir. */
  private headingEffectiveColor(level: HeadingLevel): string {
    if ((level === "h1" || level === "h2" || level === "h3")
      && isPedagogicalA4Template({ key: this.templateKey, label: this.templateLabel, profile: this.template.profile })) {
      return level === "h3" ? PEDAGOGICAL_PALETTE.green : PEDAGOGICAL_PALETTE.red;
    }
    return this.template.body.colorHex || "#000000";
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
    const editor = insp.createDiv({ cls: "feuillets-heading-editor" });
    editor.createEl("h5", { text: this.selectedHeading.toUpperCase() });
    this.renderHeadingLevelInspector(editor, this.selectedHeading);
  }

  private renderBlockquoteStyleInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.blockquoteTitle") });
    const quote = this.template.blockquote;
    this.textField(insp, t("modal.layout.font"), () => quote.fontFamily || "", (v) => quote.fontFamily = v.trim() || undefined);
    this.optionalNumberField(insp, t("modal.layout.sizePt"), () => quote.fontSizePt, (v) => quote.fontSizePt = v);
    this.optionalNumberField(insp, t("modal.layout.lineHeight"), () => quote.lineHeight, (v) => quote.lineHeight = v);
    new Setting(insp).setName(t("modal.layout.alignment")).addDropdown((d) => d
      .addOption("", t("modal.layout.default")).addOption("left", t("modal.layout.alignLeft")).addOption("center", t("modal.layout.alignCenter")).addOption("right", t("modal.layout.alignRight")).addOption("justify", t("modal.layout.alignJustify"))
      .setValue(quote.align || "").onChange(async (v) => { quote.align = isTemplateAlign(v) ? v : undefined; await this.saveTemplate(); }));
    this.optionalNumberField(insp, t("modal.layout.firstLineIndentPt"), () => quote.firstLineIndentPt, (v) => quote.firstLineIndentPt = v);
    this.optionalNumberField(insp, t("modal.layout.marginLeftPt"), () => quote.marginLeftPt, (v) => quote.marginLeftPt = v);
    this.optionalNumberField(insp, t("modal.layout.marginRightPt"), () => quote.marginRightPt, (v) => quote.marginRightPt = v);
    this.optionalNumberField(insp, t("modal.layout.blockquoteSpaceBeforePt"), () => quote.marginTopPt, (v) => quote.marginTopPt = v);
    this.optionalNumberField(insp, t("modal.layout.blockquoteSpaceAfterPt"), () => quote.marginBottomPt, (v) => quote.marginBottomPt = v);
    new Setting(insp).setName(t("modal.layout.italic")).addDropdown((d) => d
      .addOption("", t("modal.layout.default")).addOption("true", t("modal.layout.italic")).addOption("false", t("modal.layout.italicNormal"))
      .setValue(quote.italic === undefined ? "" : String(quote.italic)).onChange(async (v) => { quote.italic = v === "" ? undefined : v === "true"; await this.saveTemplate(); }));
    this.textField(insp, t("modal.layout.color"), () => quote.colorHex || "", (v) => quote.colorHex = v.trim() || undefined);
  }

  private renderSceneDividerInspector(insp: HTMLElement): void {
    this.textField(insp, t("modal.layout.sceneSeparator"), () => this.template.sceneDivider, (v) => this.template.sceneDivider = v);
  }

  renderBlockquoteInspector(insp: HTMLElement): void {
    this.renderBlockquoteStyleInspector(insp);
    this.renderSceneDividerInspector(insp);
  }

  renderFirstPageInspector(insp: HTMLElement): void {
    /* §28 : la maquette visuelle ne réapparaît QUE dans Mise en page →
       Première page (jamais dans Page, Corps, Titres ni Citation), et
       uniquement en mode workspace — en mode "modal", le LayoutModal monte
       déjà SA maquette à côté de l'inspecteur (même composant partagé). */
    if (this.mode === "workspace") this.mountFirstPageMiniature(insp);

    // Pas de titre "Première page" ici : doublon avec la navigation/l'onglet, §4.
    new Setting(insp).setName(t("modal.layout.hideHeaderFooter")).addToggle((c) => c.setValue(this.template.firstPage.hideHeader).onChange(async (v) => { this.template.firstPage.hideHeader = v; await this.saveTemplate(); }));
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
      for (const role of this.roles) d.addOption(role, titleRoleLabel(role));
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
