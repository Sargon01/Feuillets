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
  onDragValue?: () => void;
};

/** Paragraph geometry only; glyph layout belongs to the paginated preview. */
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
  private scaleX = 1;
  private dragCancel: (() => void) | null = null;

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
    this.destroy();
    this.container.empty();
    this.pageEl = this.container.createDiv({ cls: "feuillets-tp-page" });

    this.headerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-top" });
    this.headerBand.style.height = `${HEADER_PX}px`;
    this.headerBand.addEventListener("click", () => this.select("header"));

    this.footerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-bottom" });
    this.footerBand.style.height = `${FOOTER_PX}px`;
    this.footerBand.addEventListener("click", () => this.select("footer"));

    this.buildBlocks();
    this.refresh();
    return this.pageEl;
  }

  /** Repositionne les blocs et redessine les bandes — appelé après chaque
   * sauvegarde du modèle ou changement de sélection. */
  refresh(): void {
    this.layout();
    this.renderBands();
  }

  private buildBlocks(): void {
    this.blockEls = {};
    for (const role of this.roles) {
      const el = this.pageEl.createDiv({ cls: "feuillets-tp-block" });
      el.createSpan({ cls: "feuillets-tp-block-label" }).setText(titleRoleLabel(role));
      el.addEventListener("pointerdown", (e) => this.startDrag(e, role));
      this.blockEls[role] = el;
    }
  }

  layout(): void {
    const page = this.template.page;
    const geometry = resolvePageGeometry({ pageSize: page.size, pageOrientation: page.orientation }, null);
    const widthPx = Math.round(this.heightPx * geometry.widthMm / geometry.heightMm);
    this.scale = this.heightPx / (geometry.heightMm * MM_TO_PT);
    this.scaleX = widthPx / (geometry.widthMm * MM_TO_PT);
    this.pageEl.style.height = `${this.heightPx}px`;
    this.pageEl.style.width = `${widthPx}px`;
    this.pageEl.style.flex = `0 0 ${widthPx}px`;
    let y = page.marginsCm.top * 10 * MM_TO_PT;
    for (const role of this.roles) {
      const st = this.styles[role];
      const size = st.fontSizePt != null ? st.fontSizePt : 12;
      const mTop = st.marginTopPt != null ? st.marginTopPt : 0;
      const mBot = st.marginBottomPt != null ? st.marginBottomPt : 0;
      y += mTop;
      const el = this.blockEls[role];
      if (!el) continue;
      el.style.top = `${y * this.scale}px`;
      el.style.left = `${(page.marginsCm.left * 10 * MM_TO_PT + (st.marginLeftPt ?? 0)) * this.scaleX}px`;
      el.style.right = `${(page.marginsCm.right * 10 * MM_TO_PT + (st.marginRightPt ?? 0)) * this.scaleX}px`;
      el.style.fontSize = `${Math.max(6, size * this.scale)}px`;
      el.style.textAlign = st.align || "center";
      el.toggleClass("is-selected", this.editor.selected === role || (this.editor.selected === "firstPage" && this.editor.selectedRole === role));
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

  cancelDrag(): void {
    this.dragCancel?.();
  }

  destroy(): void {
    this.cancelDrag();
  }

  startDrag(e: PointerEvent, role: string): void {
    if (e.button > 0 || e.isPrimary === false) return;
    this.cancelDrag();
    e.preventDefault();
    this.select(role);
    const st = this.styles[role];
    const block = this.blockEls[role];
    const doc = block.ownerDocument;
    const initial = { marginTopPt: st.marginTopPt, marginLeftPt: st.marginLeftPt, marginRightPt: st.marginRightPt };
    const startTop = initial.marginTopPt ?? 0;
    const startLeft = initial.marginLeftPt ?? 0;
    const startRight = initial.marginRightPt ?? 0;
    if (![startTop, startLeft, startRight, e.clientX, e.clientY].every(Number.isFinite)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const page = this.template.page;
    const minX = -page.marginsCm.left * 10 * MM_TO_PT - startLeft;
    const maxX = page.marginsCm.right * 10 * MM_TO_PT + startRight;
    const width = parseFloat(this.pageEl.style.width) / this.scaleX + minX - maxX;
    const bottom = this.heightPx / this.scale - page.marginsCm.bottom * 10 * MM_TO_PT;
    const maxTop = Math.max(startTop, startTop + bottom - parseFloat(block.style.top) / this.scale - (st.fontSizePt ?? 12));
    let dragging = false;
    const restore = (): void => {
      for (const key of ["marginTopPt", "marginLeftPt", "marginRightPt"] as const) {
        if (initial[key] === undefined) delete st[key];
        else st[key] = initial[key];
      }
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId || !Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return;
      if (!block.isConnected || this.styles[role] !== st) { cancel(); return; }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 4) return;
      dragging = true;
      restore();
      const top = Math.max(0, Math.min(maxTop, startTop + Math.round(dy / this.scale)));
      if (dy !== 0 && top !== startTop && Number.isFinite(top)) st.marginTopPt = top;
      // Opposite margins translate the paragraph without changing its width or alignment.
      const horizontal = Math.max(minX, Math.min(maxX, Math.round(dx / this.scaleX)));
      if (dx !== 0 && width > 0 && minX <= maxX && horizontal !== 0) {
        st.marginLeftPt = startLeft + horizontal;
        st.marginRightPt = startRight - horizontal;
      }
      this.layout();
      this.options.onDragValue?.();
    };
    const cleanup = (): void => {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onUpListener);
      doc.removeEventListener("pointercancel", onCancel);
      doc.defaultView?.removeEventListener("blur", cancel);
      observer.disconnect();
      this.dragCancel = null;
    };
    const cancel = (): void => {
      cleanup();
      restore();
      this.layout();
      this.options.onDragValue?.();
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId === e.pointerId) cancel();
    };
    const onUp = async (ev: PointerEvent): Promise<void> => {
      if (ev.pointerId !== e.pointerId) return;
      if (!block.isConnected || this.styles[role] !== st) { cancel(); return; }
      onMove(ev);
      cleanup();
      if ((["marginTopPt", "marginLeftPt", "marginRightPt"] as const).some((key) => st[key] !== initial[key])) await this.editor.saveModel();
    };
    const onUpListener = onUp as EventListener;
    const observer = new MutationObserver(() => { if (!block.isConnected) cancel(); });
    observer.observe(doc.body, { childList: true, subtree: true });
    this.dragCancel = cancel;
    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerup", onUpListener);
    doc.addEventListener("pointercancel", onCancel);
    doc.defaultView?.addEventListener("blur", cancel);
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
