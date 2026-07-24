import { resolveExportTemplate, updateTemplateTitlePage } from "../services/export-templates-custom.js";

const { Modal, Setting, setIcon } = require("obsidian");

/* Hauteur utile approximative d'une page A4 portrait (842pt − 2×2,5cm de
   marge ≈ 700pt) : sert d'échelle à la maquette. C'est un aperçu de mise en
   page, pas un rendu exact — les valeurs écrites restent en points. */
const PAGE_USABLE_PT = 700;
const MOCKUP_H_PX = 470;
const SCALE = MOCKUP_H_PX / PAGE_USABLE_PT;

/** Éditeur visuel de page de titre (option A). La page de titre est une pile
 * verticale de blocs (titre, sous-titre, mots…) : on ne place pas librement en
 * 2D (ce que l'export DOCX/PDF ne saurait pas rendre), mais on règle
 * visuellement l'espacement (glisser un bloc vers le haut/bas → marge du
 * dessus), la taille (poignée ou champ) et l'alignement (G/C/D). Un inspecteur
 * donne aussi les marges haut/bas au point près. Chaque changement est écrit
 * dans le .md du modèle (updateTemplateTitlePage) — source de vérité unique. */
export class TitlePageModal extends Modal {
  constructor(app, plugin, templateKey, templateLabel) {
    super(app);
    this.plugin = plugin;
    this.templateKey = templateKey;
    this.templateLabel = templateLabel;
    this.styles = {};
    this.roles = [];
    this.selected = null;
    this.blockEls = {};
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-titlepage-modal");
    contentEl.empty();
    contentEl.createEl("h3", { text: `Page de titre — ${this.templateLabel || this.templateKey}` });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Glisse un bloc vers le haut/bas pour régler l'espace au-dessus. Sélectionne-le pour ajuster taille, alignement et marges. Tout est écrit dans le modèle.",
    });

    const tpl = await resolveExportTemplate(this.app, this.plugin.settings, this.templateKey);
    this.styles =
      tpl.titlePage && tpl.titlePage.styles ? JSON.parse(JSON.stringify(tpl.titlePage.styles)) : {};
    this.roles = Object.keys(this.styles);

    if (!this.roles.length) {
      contentEl.createDiv({ cls: "setting-item-description" }).setText(
        "Ce modèle n'a pas de page de titre à rôles. Édite son .md dans Ressources/Modèles pour en ajouter."
      );
      return;
    }

    const wrap = contentEl.createDiv({ cls: "feuillets-tp-editor" });
    this.pageEl = wrap.createDiv({ cls: "feuillets-tp-page" });
    this.pageEl.style.height = `${MOCKUP_H_PX}px`;
    this.pageEl.addEventListener("pointerdown", (e) => {
      // clic dans le vide de la page : désélectionne
      if (e.target === this.pageEl) this.select(null);
    });

    this.inspectorEl = wrap.createDiv({ cls: "feuillets-tp-inspector" });

    this.buildBlocks();
    this.layout();
    this.renderInspector();
  }

  buildBlocks() {
    this.blockEls = {};
    for (const role of this.roles) {
      const el = this.pageEl.createDiv({ cls: "feuillets-tp-block" });
      el.createSpan({ cls: "feuillets-tp-block-label" }).setText(role);
      el.addEventListener("pointerdown", (e) => this.startDrag(e, role));
      this.blockEls[role] = el;
    }
  }

  /** Recalcule et applique la position/taille/alignement de chaque bloc à
   * partir des styles courants (pile verticale, marges cumulées). */
  layout() {
    let y = 0;
    for (const role of this.roles) {
      const st = this.styles[role];
      const size = st.fontSizePt != null ? st.fontSizePt : 12;
      const mTop = st.marginTopPt != null ? st.marginTopPt : 0;
      const mBot = st.marginBottomPt != null ? st.marginBottomPt : 0;
      y += mTop;
      const el = this.blockEls[role];
      el.style.top = `${y * SCALE}px`;
      el.style.fontSize = `${Math.max(6, size * SCALE)}px`;
      el.style.textAlign = st.align || "center";
      el.toggleClass("is-selected", this.selected === role);
      y += size + mBot;
    }
  }

  startDrag(e, role) {
    e.preventDefault();
    this.select(role);
    const st = this.styles[role];
    const startY = e.clientY;
    const startMargin = st.marginTopPt != null ? st.marginTopPt : 0;
    const onMove = (ev) => {
      const dPt = (ev.clientY - startY) / SCALE;
      st.marginTopPt = Math.max(0, Math.round(startMargin + dPt));
      this.layout();
      this.syncInspectorValues();
    };
    const onUp = async () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      await this.save();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  select(role) {
    this.selected = role;
    this.layout();
    this.renderInspector();
  }

  renderInspector() {
    const insp = this.inspectorEl;
    insp.empty();
    if (!this.selected) {
      insp.createDiv({ cls: "setting-item-description" }).setText(
        "Sélectionne un bloc sur la page pour l'ajuster."
      );
      return;
    }
    const role = this.selected;
    const st = this.styles[role];
    insp.createEl("h4", { text: role });

    const num = (name, get, set) =>
      new Setting(insp).setName(name).addText((t) => {
        t.inputEl.type = "number";
        t.setValue(get() != null ? String(get()) : "").onChange(async (v) => {
          const n = parseFloat(v);
          set(v.trim() === "" || !Number.isFinite(n) ? undefined : n);
          this.layout();
          await this.save();
        });
      });

    num("Taille (pt)", () => st.fontSizePt, (n) => (n == null ? delete st.fontSizePt : (st.fontSizePt = n)));

    new Setting(insp).setName("Alignement").then((s) => {
      for (const [val, icon] of [["left", "align-left"], ["center", "align-center"], ["right", "align-right"]]) {
        s.addExtraButton((b) => {
          b.setIcon(icon).setTooltip(val).onClick(async () => {
            st.align = val;
            this.layout();
            this.renderInspector();
            await this.save();
          });
          if ((st.align || "center") === val) b.extraSettingsEl.addClass("is-active");
        });
      }
    });

    num("Marge au-dessus (pt)", () => st.marginTopPt, (n) => (n == null ? delete st.marginTopPt : (st.marginTopPt = n)));
    num("Marge en dessous (pt)", () => st.marginBottomPt, (n) => (n == null ? delete st.marginBottomPt : (st.marginBottomPt = n)));
  }

  /** Met à jour les champs numériques de l'inspecteur pendant un glisser sans
   * tout reconstruire (garde le focus/les autres champs intacts). */
  syncInspectorValues() {
    if (!this.selected) return;
    const st = this.styles[this.selected];
    const inputs = this.inspectorEl.querySelectorAll('input[type="number"]');
    // ordre : Taille, Marge au-dessus, Marge en dessous
    if (inputs[1]) inputs[1].value = st.marginTopPt != null ? String(st.marginTopPt) : "";
  }

  save() {
    return updateTemplateTitlePage(this.app, this.plugin.settings, this.templateKey, this.styles);
  }

  onClose() {
    this.contentEl.empty();
  }
}
