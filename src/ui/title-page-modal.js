import { resolveExportTemplate, updateTemplateTitlePage } from "../services/export-templates-custom.js";

const { Modal, Setting } = require("obsidian");

/** Éditeur de page de titre (option A) : règle chaque bloc (:::titre:,
 * :::sous-titre:…) du modèle sélectionné et écrit directement dans son .md
 * (updateTemplateTitlePage) — le modèle reste l'unique source de vérité,
 * l'utilisateur n'ouvre jamais le fichier. Ouvert depuis le panneau
 * Compilation / export (sous-rubrique « Page de titre » de Mise en page). */
export class TitlePageModal extends Modal {
  constructor(app, plugin, templateKey, templateLabel) {
    super(app);
    this.plugin = plugin;
    this.templateKey = templateKey;
    this.templateLabel = templateLabel;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", {
      text: `Page de titre — ${this.templateLabel || this.templateKey}`,
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Règle chaque bloc de la page de titre. Les valeurs sont écrites dans le modèle (Ressources/Modèles), sans ouvrir le fichier.",
    });
    await this.renderControls(contentEl.createDiv());
  }

  async renderControls(body) {
    const S = this.plugin.settings;
    const tpl = await resolveExportTemplate(this.app, S, this.templateKey);
    const styles =
      tpl.titlePage && tpl.titlePage.styles
        ? JSON.parse(JSON.stringify(tpl.titlePage.styles))
        : {};
    const roles = Object.keys(styles);
    if (!roles.length) {
      body.createDiv({ cls: "setting-item-description" }).setText(
        "Ce modèle n'a pas de page de titre à rôles. Édite son .md dans Ressources/Modèles pour en ajouter."
      );
      return;
    }
    const save = () => updateTemplateTitlePage(this.app, S, this.templateKey, styles);
    const numField = (parent, name, get, set) =>
      new Setting(parent).setName(name).addText((t) =>
        t.setValue(get() != null ? String(get()) : "").onChange(async (v) => {
          const n = parseFloat(v);
          set(v.trim() === "" || !Number.isFinite(n) ? undefined : n);
          await save();
        })
      );

    for (const role of roles) {
      const st = styles[role];
      body.createEl("h4", { text: role });
      numField(body, "Taille (pt)", () => st.fontSizePt, (n) => (n == null ? delete st.fontSizePt : (st.fontSizePt = n)));
      new Setting(body).setName("Alignement").addDropdown((d) =>
        d
          .addOption("left", "Gauche")
          .addOption("center", "Centré")
          .addOption("right", "Droite")
          .setValue(st.align || "center")
          .onChange(async (v) => {
            st.align = v;
            await save();
          })
      );
      new Setting(body).setName("Gras").addToggle((t) =>
        t.setValue(!!st.bold).onChange(async (v) => {
          if (v) st.bold = true;
          else delete st.bold;
          await save();
        })
      );
      new Setting(body).setName("Italique").addToggle((t) =>
        t.setValue(!!st.italic).onChange(async (v) => {
          if (v) st.italic = true;
          else delete st.italic;
          await save();
        })
      );
      numField(body, "Marge au-dessus (pt)", () => st.marginTopPt, (n) => (n == null ? delete st.marginTopPt : (st.marginTopPt = n)));
      numField(body, "Marge en dessous (pt)", () => st.marginBottomPt, (n) => (n == null ? delete st.marginBottomPt : (st.marginBottomPt = n)));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
