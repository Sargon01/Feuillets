import { t } from "../i18n/index.js";
import { resolvePageGeometry } from "../services/page-geometry.js";
import { titleRoleLabel, type LayoutEditor, type LayoutSelection } from "./layout-editor.js";

/* Hauteur d'affichage de la maquette. La LARGEUR n'est plus figée à 320px :
   elle découle du ratio réel de la page (§30) — A4 portrait, A4 paysage, A5,
   Letter… — via le helper de géométrie commun. */
const DEFAULT_HEIGHT_PX = 400;
const HEADER_PX = 26;
const FOOTER_PX = 26;
const MM_TO_PT = 72 / 25.4;

export type TitlePageMiniatureOptions = {
  /** Hauteur de la maquette en pixels (la largeur suit le ratio de page). */
  heightPx?: number;
  /** Prend EN CHARGE la sélection déclenchée par un clic dans la maquette :
   * l'hôte décide ce que « sélectionner ce bloc » veut dire chez lui (le
   * LayoutModal aligne ses onglets, la catégorie Première page choisit le rôle
   * sans quitter sa catégorie). Absent, la maquette retombe sur
   * `editor.select(target)`, le comportement historique. */
  onSelect?: (target: LayoutSelection) => void;
  /** Notifié pendant un glisser, après chaque mise à jour de `marginTopPt` :
   * permet à l'hôte de rafraîchir la valeur affichée dans son inspecteur SANS
   * le reconstruire (donc sans perdre le focus des autres champs). */
  onDragValue?: () => void;
};

/** Maquette visuelle de la PAGE DE TITRE : bande d'en-tête, blocs de rôles
 * empilés (glissables verticalement) et bande de pied de page.
 *
 * Extraite du LayoutModal (§29) pour être partagée telle quelle par la modale
 * historique ET la catégorie « Première page » de Mise en page — une seule
 * implémentation, un seul comportement.
 *
 * Elle ne possède AUCUN état : tout vient du `LayoutEditor` qu'elle reçoit
 * (`template`, `styles`, `roles`, `selected`) et toute écriture repasse par
 * `editor.select()` / `editor.saveModel()`. Elle ne manipule que les rôles
 * déjà présents dans `titlePage.styles` : aucun objet libre, aucun calque,
 * aucune coordonnée absolue nouvelle, aucun nouveau format de gabarit (§32). */
export class TitlePageMiniature {
  private container: HTMLElement;
  private editor: LayoutEditor;
  private options: TitlePageMiniatureOptions;

  pageEl!: HTMLElement;
  headerBand!: HTMLElement;
  footerBand!: HTMLElement;
  blockEls: Record<string, HTMLElement> = {};
  /** Échelle points → pixels, recalculée à chaque montage depuis la géométrie
   * réelle de la page (jamais une constante A4). */
  private scale = 1;

  constructor(container: HTMLElement, editor: LayoutEditor, options: TitlePageMiniatureOptions = {}) {
    this.container = container;
    this.editor = editor;
    this.options = options;
  }

  private get heightPx(): number {
    return this.options.heightPx ?? DEFAULT_HEIGHT_PX;
  }

  private get styles() { return this.editor.styles; }
  private get roles(): string[] { return this.editor.roles; }
  private get template(): ExportTemplateV2 { return this.editor.template; }

  /** (Re)construit intégralement la maquette dans son conteneur. */
  mount(): HTMLElement {
    this.container.empty();
    const page = this.template.page;
    /* §25/§30 : MÊME helper que la pagination et l'export PDF — jamais une
       seconde table de dimensions, jamais un A4 portrait codé en dur. */
    const geometry = resolvePageGeometry(
      { pageSize: page.size, pageOrientation: page.orientation },
      null,
    );
    const heightPx = this.heightPx;
    const widthPx = Math.round(heightPx * (geometry.widthMm / geometry.heightMm));

    /* Hauteur utile en points (page moins marges haute/basse), d'où l'échelle
       de la pile de blocs : pour une A4 à 2,5 cm de marges, elle vaut 700pt —
       exactement la constante figée d'avant, mais désormais dérivée. */
    const usableMm = Math.max(1, geometry.heightMm - (page.marginsCm.top + page.marginsCm.bottom) * 10);
    this.scale = (heightPx - HEADER_PX - FOOTER_PX) / (usableMm * MM_TO_PT);

    this.pageEl = this.container.createDiv({ cls: "feuillets-tp-page" });
    this.pageEl.style.height = `${heightPx}px`;
    this.pageEl.style.width = `${widthPx}px`;
    this.pageEl.style.flex = `0 0 ${widthPx}px`;

    /* Marges de page discrètes : les blocs s'inscrivent dans la zone de
       composition réelle, jamais dans un 6 % arbitraire. */
    const leftPct = (page.marginsCm.left * 10 / geometry.widthMm) * 100;
    const rightPct = (page.marginsCm.right * 10 / geometry.widthMm) * 100;

    this.headerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-top" });
    this.headerBand.style.height = `${HEADER_PX}px`;
    this.headerBand.addEventListener("click", () => this.select("header"));

    this.footerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-bottom" });
    this.footerBand.style.height = `${FOOTER_PX}px`;
    this.footerBand.addEventListener("click", () => this.select("footer"));

    this.buildBlocks(leftPct, rightPct);
    this.refresh();
    return this.pageEl;
  }

  /** Repositionne les blocs et redessine les bandes — appelé après chaque
   * sauvegarde du modèle ou changement de sélection. */
  refresh(): void {
    this.layout();
    this.renderBands();
  }

  private buildBlocks(leftPct: number, rightPct: number): void {
    this.blockEls = {};
    for (const role of this.roles) {
      const el = this.pageEl.createDiv({ cls: "feuillets-tp-block" });
      el.style.left = `${leftPct}%`;
      el.style.right = `${rightPct}%`;
      el.createSpan({ cls: "feuillets-tp-block-label" }).setText(titleRoleLabel(role));
      el.addEventListener("pointerdown", (e) => this.startDrag(e, role));
      this.blockEls[role] = el;
    }
  }

  /** Positionne chaque bloc dans la zone de contenu (sous la bande en-tête),
   * pile verticale à marges cumulées. */
  layout(): void {
    let y = 0;
    for (const role of this.roles) {
      const st = this.styles[role];
      const size = st.fontSizePt != null ? st.fontSizePt : 12;
      const mTop = st.marginTopPt != null ? st.marginTopPt : 0;
      const mBot = st.marginBottomPt != null ? st.marginBottomPt : 0;
      y += mTop;
      const el = this.blockEls[role];
      if (!el) continue;
      el.style.top = `${HEADER_PX + y * this.scale}px`;
      el.style.fontSize = `${Math.max(6, size * this.scale)}px`;
      el.style.textAlign = st.align || "center";
      el.toggleClass("is-selected", this.editor.selected === role);
      y += size + mBot;
    }
  }

  /** Contenu et état (grisé) des bandes en-tête/pied selon les réglages. */
  renderBands(): void {
    const off = !this.template.header.enabled;
    const hideP1 = this.template.firstPage.hideHeader;

    this.headerBand.empty();
    this.headerBand.toggleClass("is-selected", this.editor.selected === "header");
    this.headerBand.toggleClass("is-muted", off || hideP1);
    if (off) {
      this.headerBand.createSpan().setText(t("modal.layout.headerDisabled"));
    } else {
      this.headerBand.createSpan({ cls: "feuillets-tp-band-l" }).setText(this.template.header.left || "{title}");
      this.headerBand.createSpan({ cls: "feuillets-tp-band-r" }).setText(this.template.header.right || "{author}");
    }
    if (hideP1) this.headerBand.createSpan({ cls: "feuillets-tp-band-note" }).setText(t("modal.layout.hiddenOnP1"));

    this.footerBand.empty();
    this.footerBand.toggleClass("is-selected", this.editor.selected === "footer");
    this.footerBand.toggleClass("is-muted", hideP1);
    const pos = this.template.firstPage.pageNumberPosition;
    const span = this.footerBand.createSpan({ cls: `feuillets-tp-band-${pos === "right" ? "r" : pos === "left" ? "l" : "c"}` });
    span.setText(this.template.footer.right || t("modal.layout.pageOfPages"));
  }

  /** Glisser vertical : modifie le `marginTopPt` EXISTANT du rôle, rien
   * d'autre. La sauvegarde n'a lieu qu'au relâchement (§31 : aucune écriture
   * prématurée). */
  startDrag(e: PointerEvent, role: string): void {
    e.preventDefault();
    this.select(role);
    const st = this.styles[role];
    const startY = e.clientY;
    const startMargin = st.marginTopPt != null ? st.marginTopPt : 0;
    const onMove = (ev: PointerEvent): void => {
      const dPt = (ev.clientY - startY) / this.scale;
      st.marginTopPt = Math.max(0, Math.round(startMargin + dPt));
      this.layout();
      this.options.onDragValue?.();
    };
    /* Écouteur `pointerup` volontairement async, passé tel quel : le test
       (« sans écriture prématurée ») attend sa promesse réelle via
       `await listeners.get("pointerup")()`. `saveModel()` enchaîne plusieurs
       `await` (lecture puis écriture du fichier de gabarit) : un wrapper
       synchrone + `void` casserait cette garantie observable, alors que le DOM
       ignore de toute façon la valeur de retour d'un listener. */
    const onUp = async (): Promise<void> => {
      document.removeEventListener("pointermove", onMove);
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- onUp doit rester la même référence (async) pour pointerup ; voir commentaire ci-dessus
      document.removeEventListener("pointerup", onUp);
      await this.editor.saveModel();
    };
    document.addEventListener("pointermove", onMove);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- écouteur async assumé : le test attend sa promesse réelle (voir commentaire ci-dessus)
    document.addEventListener("pointerup", onUp);
  }

  /** Sélection déclenchée DEPUIS la maquette. L'état vit toujours dans
   * l'éditeur : soit l'hôte l'y écrit lui-même via `onSelect`, soit la
   * maquette appelle `editor.select()` — jamais un second état ici. */
  private select(target: LayoutSelection): void {
    if (this.options.onSelect) this.options.onSelect(target);
    else this.editor.select(target);
    this.refresh();
  }
}
