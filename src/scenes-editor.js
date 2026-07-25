const {
  TFile,
  TFolder,
  Notice,
  Modal,
  Setting,
  MarkdownView,
  Menu,
  normalizePath,
  stringifyYaml,
} = require("obsidian");

import {
  splitCsv,
  normalizeTags,
  shortText,
  splitFrontmatter,
  splitBody,
  ensureNumber,
  stripMdExtension,
  sanitizeFileBasename,
  moveItem,
  toValue,
  buildMergedSection,
} from "./utils/scene-fields.js";

export const YAML_PRESETS = {
  roman: {
    label: "Roman",
    targetFields: ["titre", "titre_binder", "ordre", "date"],
    aggregateFields: ["tags", "notes"],
    firstFields: ["statut", "label", "objectif", "compiler"],
    ignoreFields: ["synopsis", "resume"],
  },
  nouvelle: {
    label: "Nouvelle",
    targetFields: ["titre", "titre_binder", "ordre", "date", "statut"],
    aggregateFields: ["tags", "notes"],
    firstFields: ["label", "objectif", "compiler"],
    ignoreFields: ["synopsis", "resume"],
  },
  scenario: {
    label: "Scénario",
    targetFields: ["titre", "ordre", "date"],
    aggregateFields: ["tags", "notes", "label"],
    firstFields: ["statut", "objectif", "compiler"],
    ignoreFields: ["resume"],
  },
  minimal: {
    label: "Minimal",
    targetFields: [
      "titre",
      "titre_binder",
      "ordre",
      "date",
      "statut",
      "label",
      "objectif",
      "compiler",
    ],
    aggregateFields: ["tags"],
    firstFields: [],
    ignoreFields: ["synopsis", "resume", "notes"],
  },
};

/* Le frontmatter est sérialisé par `stringifyYaml` (Obsidian), comme dans
   services/export-templates-custom.js. Il y avait ici un sérialiseur fait
   main dont l'« échappement » se limitait à remplacer les retours à la ligne
   par des espaces : un titre ou un synopsis contenant « : », commençant par
   « # », « [ », « * » ou « & », ou valant « oui »/« true », produisait un
   frontmatter illisible ou lu de travers — sur un fichier que le plugin
   venait de créer à partir du texte de l'autrice. Ces règles de citation YAML
   ne se réimplémentent pas à la main. */

export class TextInputModal extends Modal {
  constructor(app, title, fields, onSubmit) {
    super(app);
    this.titleText = title;
    this.fields = fields;
    this.onSubmit = onSubmit;
    this.values = {};
  }
  onOpen() {
    this.contentEl.empty();
    this.setTitle(this.titleText);
    this.fields.forEach((field, idx) => {
      new Setting(this.contentEl)
        .setName(field.label)
        .setDesc(field.description || "")
        .addText((text) => {
          text.setValue(field.value || "");
          this.values[field.name] = field.value || "";
          text.onChange((value) => {
            this.values[field.name] = value;
          });
          if (idx === 0) {
            window.setTimeout(() => text.inputEl?.focus(), 0);
          }
        });
    });
    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Valider")
          .setCta()
          .onClick(async () => {
            await this.onSubmit(this.values);
            this.close();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Annuler").onClick(() => this.close())
      );
  }
}

class MergeModal extends Modal {
  constructor(app, plugin, files) {
    super(app);
    this.plugin = plugin;
    this.files = files;
    this.targetPath = files[0].path;
    this.sourceOrder = files
      .filter((f) => f.path !== this.targetPath)
      .map((f) => f.path);
    this.mergeMode = plugin.settings.mergeModeDefault;
    this.keepSeparator = plugin.settings.mergeKeepSeparatorDefault;
    this.plan = null;
  }

  async refresh() {
    this.plan = await this.plugin.buildMergePlan(
      this.files,
      this.targetPath,
      this.sourceOrder,
      this.mergeMode,
      this.keepSeparator
    );
    this.render();
  }

  render() {
    this.contentEl.empty();
    this.setTitle("Fusion");

    const hero = this.contentEl.createDiv({ cls: "feuillets-merge-hero" });
    hero.createDiv({ cls: "feuillets-merge-title", text: this.plan.summary });
    hero.createDiv({
      cls: "feuillets-merge-subtitle",
      text: `${this.plan.sources.length} source${
        this.plan.sources.length > 1 ? "s" : ""
      } supprimée${this.plan.sources.length > 1 ? "s" : ""} après fusion.`,
    });

    new Setting(this.contentEl)
      .setName("Scène cible")
      .setDesc("Fichier qui reçoit la fusion")
      .addDropdown((drop) => {
        this.files.forEach((file) => drop.addOption(file.path, this.plugin.shortTitleFor(file)));
        drop.setValue(this.targetPath);
        drop.onChange(async (value) => {
          this.targetPath = value;
          this.sourceOrder = this.files
            .filter((f) => f.path !== value)
            .map((f) => f.path);
          await this.refresh();
        });
      });

    new Setting(this.contentEl)
      .setName("Mode de fusion")
      .setDesc("Forme du texte ajouté")
      .addDropdown((drop) => {
        drop.addOption("heading", "Titre intermédiaire");
        drop.addOption("comment", "Commentaire de provenance");
        drop.addOption("continuous", "Texte continu");
        drop.setValue(this.mergeMode);
        drop.onChange(async (value) => {
          this.mergeMode = value;
          await this.refresh();
        });
      })
      .addToggle((toggle) => {
        toggle.setValue(this.keepSeparator);
        toggle.onChange(async (value) => {
          this.keepSeparator = value;
          await this.refresh();
        });
      });

    const compact = this.contentEl.createDiv({
      cls: "feuillets-merge-compact-note",
      text: `Preset YAML : ${
        YAML_PRESETS[this.plugin.settings.mergeYamlPreset].label
      } · clic pour voir les options`,
    });
    compact.addEventListener("click", async () => {
      await this.plugin.openYamlOptions(this);
    });

    const stats = this.contentEl.createDiv({ cls: "feuillets-merge-stats" });
    [
      ["Sources", String(this.plan.sources.length)],
      ["Tags", String(this.plan.preview.tags.length)],
      ["Notes", this.plan.preview.notes ? "oui" : "non"],
      ["Obj.", String(this.plan.preview.objectif)],
    ].forEach(([label, value]) => {
      const card = stats.createDiv({ cls: "feuillets-merge-stat" });
      card.createDiv({ cls: "feuillets-merge-stat-value", text: value });
      card.createDiv({ cls: "feuillets-merge-stat-label", text: label });
    });

    const grid = this.contentEl.createDiv({ cls: "feuillets-merge-grid" });
    const left = grid.createDiv({ cls: "feuillets-merge-card" });
    left.createDiv({ cls: "feuillets-merge-card-title", text: "Cible" });
    left.createDiv({
      cls: "feuillets-merge-path",
      text: this.plugin.shortTitleFor(this.plan.target),
    });
    left.createDiv({
      cls: "feuillets-merge-path-secondary",
      text: this.plan.target.path,
    });
    left.createDiv({
      cls: "feuillets-merge-card-title",
      text: "Ordre des sources",
    });
    const sourceList = left.createDiv({ cls: "feuillets-merge-order" });
    this.plan.sources.forEach((file, index) => {
      const row = sourceList.createDiv({ cls: "feuillets-merge-order-row" });
      const label = row.createDiv({ cls: "feuillets-merge-order-label" });
      label.createDiv({
        cls: "feuillets-merge-order-index",
        text: String(index + 1),
      });
      label.createDiv({
        cls: "feuillets-merge-order-name",
        text: this.plugin.shortTitleFor(file),
      });
      const actions = row.createDiv({ cls: "feuillets-merge-order-actions" });
      const up = actions.createEl("button", { text: "↑" });
      const down = actions.createEl("button", { text: "↓" });
      up.disabled = index === 0;
      down.disabled = index === this.plan.sources.length - 1;
      up.addEventListener("click", async () => {
        this.sourceOrder = moveItem(this.sourceOrder, index, index - 1);
        await this.refresh();
      });
      down.addEventListener("click", async () => {
        this.sourceOrder = moveItem(this.sourceOrder, index, index + 1);
        await this.refresh();
      });
    });

    const right = grid.createDiv({ cls: "feuillets-merge-card" });
    right.createDiv({ cls: "feuillets-merge-card-title", text: "Résumé YAML" });
    const meta = right.createEl("ul", { cls: "feuillets-merge-list" });
    [
      `Preset : ${YAML_PRESETS[this.plugin.settings.mergeYamlPreset].label}`,
      `Stratégie : ${this.plan.preview.yamlLabel}`,
      `Tags : ${shortText(this.plan.preview.tags.join(", ") || "—", 42)}`,
      `Notes : ${shortText(this.plan.preview.notes, 44)}`,
    ].forEach((line) => meta.createEl("li", { text: line }));

    const excerpts = this.contentEl.createDiv({
      cls: "feuillets-merge-card feuillets-merge-card-full",
    });
    excerpts.createDiv({
      cls: "feuillets-merge-card-title",
      text: "Texte ajouté",
    });
    const excerptList = excerpts.createDiv({
      cls: "feuillets-merge-excerpts",
    });
    this.plan.preview.excerpts.forEach((text, idx) => {
      const item = excerptList.createDiv({ cls: "feuillets-merge-excerpt" });
      item.createDiv({
        cls: "feuillets-merge-excerpt-title",
        text: this.plugin.shortTitleFor(this.plan.sources[idx]),
      });
      item.createDiv({
        cls: "feuillets-merge-excerpt-text",
        text: shortText(text, 120),
      });
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Options YAML")
          .onClick(async () => this.plugin.openYamlOptions(this))
      )
      .addButton((btn) =>
        btn
          .setButtonText("Fusionner")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.plugin.mergeManyScenes(
              this.plan.sources,
              this.plan.target,
              this.mergeMode,
              this.keepSeparator
            );
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Annuler").onClick(() => this.close())
      );
  }

  async onOpen() {
    await this.refresh();
  }
}

class YamlOptionsModal extends Modal {
  constructor(app, plugin, mergeModal) {
    super(app);
    this.plugin = plugin;
    this.mergeModal = mergeModal;
  }

  onOpen() {
    this.contentEl.empty();
    this.setTitle("Options YAML");
    const preset = YAML_PRESETS[this.plugin.settings.mergeYamlPreset];

    new Setting(this.contentEl)
      .setName("Préréglage")
      .setDesc("Choix simple pour la fusion")
      .addDropdown((drop) => {
        Object.entries(YAML_PRESETS).forEach(([key, item]) =>
          drop.addOption(key, item.label)
        );
        drop.setValue(this.plugin.settings.mergeYamlPreset);
        drop.onChange(async (value) => {
          await this.plugin.applyPreset(value);
          this.mergeModal.sourceOrder = this.mergeModal.files
            .filter((f) => f.path !== this.mergeModal.targetPath)
            .map((f) => f.path);
          await this.mergeModal.refresh();
          this.close();
        });
      });

    this.contentEl.createDiv({
      cls: "feuillets-yaml-subtitle",
      text: `Règles du preset ${preset.label} : cible / source / agrégation / premier non vide / ignore.`,
    });

    const note = this.contentEl.createDiv({
      cls: "feuillets-yaml-note",
      text: "Version volontairement simple : pas d’édition champ par champ dans l’interface.",
    });

    new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText("Fermer")
        .setCta()
        .onClick(() => this.close())
    );
  }
}
class MergeSelectModal extends Modal {
  constructor(app, plugin, targetFile, siblings) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    // Filtrer pour obtenir uniquement les autres scènes du dossier
    this.scenes = siblings.filter(f => 
      f instanceof TFile && 
      f.path !== targetFile.path && 
      plugin.isSceneFile(f)
    );
    this.selected = new Set();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(`Fusionner dans : ${this.plugin.shortTitleFor(this.targetFile)}`);

    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();

    if (this.scenes.length === 0) {
      contentEl.createEl("p", { text: `Aucune autre ${unit} à fusionner dans ce dossier.` });
      new Setting(contentEl).addButton(btn => btn.setButtonText("Fermer").onClick(() => this.close()));
      return;
    }

    contentEl.createEl("p", { text: `Sélectionnez les ${unitPlural} à fusionner dans cette ${unit} cible :` });

    const listEl = contentEl.createDiv({ cls: "feuillets-merge-select-list" });
    listEl.style.maxHeight = "40vh";
    listEl.style.overflowY = "auto";
    listEl.style.marginBottom = "15px";

    this.scenes.forEach(file => {
      new Setting(listEl)
        .setName(this.plugin.shortTitleFor(file))
        .addToggle(toggle => {
          toggle.onChange(val => {
            if (val) this.selected.add(file);
            else this.selected.delete(file);
          });
        });
    });

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText("Suivant").setCta().onClick(() => {
        if (this.selected.size === 0) {
          new Notice(`Veuillez sélectionner au moins une ${unit}.`);
          return;
        }
        this.close();
        this.plugin.openMergeModal([this.targetFile, ...this.selected]);
      }))
      .addButton(btn => btn.setButtonText("Annuler").onClick(() => this.close()));
  }
}


export function initScenesEditor(plugin) {
  // 1. Attach helper functions and methods to the main plugin
  plugin.isSceneFile = function (file) {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const root = this.getProjectFolder();
    if (!root || !file.path.startsWith(root.path + "/")) return false;
    if (file.parent && file.basename === file.parent.name) return false; // note de dossier
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!fm && ("titre" in fm || "ordre" in fm || "compiler" in fm);
  }.bind(plugin);

  plugin.openSceneMenu = function (file, evt) {
    const menu = new Menu();
    menu
      .addItem((i) =>
        i
          .setTitle("Scinder")
          .setIcon("scissors")
          .onClick(async () => this.splitSceneFile(file))
      );
    menu
      .addItem((i) =>
        i
          .setTitle("Dupliquer")
          .setIcon("copy")
          .onClick(async () => this.duplicateSceneFile(file))
      );
    menu
      .addItem((i) =>
        i
          .setTitle("Déplacer")
          .setIcon("move")
          .onClick(async () => this.moveSceneFile(file))
      );
    if (evt) {
      menu.showAtMouseEvent(evt);
    } else {
      menu.showAtPosition({ x: window.innerWidth / 2, y: 80 });
    }
  }.bind(plugin);

  plugin.splitActiveScene = function () {
    return this.splitSceneFile(this.getActiveFile());
  }.bind(plugin);

  plugin.duplicateActiveScene = function () {
    return this.duplicateSceneFile(this.getActiveFile());
  }.bind(plugin);

  plugin.moveActiveScene = function () {
    return this.moveSceneFile(this.getActiveFile());
  }.bind(plugin);

  plugin.getActiveFile = function () {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file || null;
  }.bind(plugin);
  plugin.splitSceneFile = async function (file) {
    const unit = this.unitLabel();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!file) return new Notice(`Aucune ${unit} active.`);
    if (!editor || view?.file?.path !== file.path) {
      return new Notice(`Ouvre la ${unit} dans l’éditeur.`);
    }
    if (!this.isSceneFile(file)) {
      return new Notice(`Cette note ne ressemble pas à une ${unit} Feuillets.`);
    }
    const selection = editor.getSelection();
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const splitText =
      selection && selection.trim()
        ? selection
        : content.slice(editor.posToOffset(cursor));
    if (!splitText.trim()) {
      return new Notice(
        "Sélectionne un texte ou place le curseur avant la fin du document."
      );
    }

    const fm = Object.assign(
      {},
      this.app.metadataCache.getFileCache(file)?.frontmatter || {}
    );
    const currentOrder = ensureNumber(fm.ordre, 0);
    const defaultTitle = fm.titre
      ? `${fm.titre} - 2`
      : `${file.basename} - 2`;
    // repli sur titre_court (ancienne clé, renommée) pour une fiche déjà
    // écrite avant le renommage
    const shortSource = fm.titre_binder !== undefined ? fm.titre_binder : fm.titre_court;
    const defaultShort = shortSource ? `${shortSource} 2` : "";

    new TextInputModal(
      this.app,
      `Scinder la ${unit}`,
      [
        { name: "titre", label: "Nouveau titre", value: defaultTitle },
        { name: "titre_binder", label: "Titre binder", value: defaultShort },
        { name: "ordre", label: "Ordre", value: String(currentOrder + 1) },
        { name: "filename", label: "Nom du fichier", value: defaultTitle },
      ],
      async (values) => {
        const folder = file.parent?.path || "";
        const safe = sanitizeFileBasename(
          values.filename || defaultTitle,
          defaultTitle
        );
        const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          return new Notice("Un fichier avec ce nom existe déjà.");
        }
        const frontmatter = Object.assign({}, fm, {
          titre: values.titre || defaultTitle,
          titre_binder: values.titre_binder || "",
          ordre: ensureNumber(values.ordre, currentOrder + 1),
          statut: this.settings.splitStatus || fm.statut || "",
        });
        delete frontmatter.titre_court;
        if (this.settings.resetSynopsisOnSplit) frontmatter.synopsis = "";
        if (this.settings.resetResumeOnSplit) frontmatter.resume = "";
        if (this.settings.resetNotesOnSplit) frontmatter.notes = "";
        if (!this.settings.copyCompilerOnSplit) frontmatter.compiler = false;
        if (frontmatter.objectif == null) frontmatter.objectif = 0;
        frontmatter.tags = normalizeTags(frontmatter.tags);
        await this.app.vault.create(
          path,
          `---\n${stringifyYaml(frontmatter).trim()}\n---\n\n${splitText.trimStart()}\n`
        );
        if (selection && selection.trim()) {
          editor.replaceSelection("");
        } else {
          editor.replaceRange(
            "",
            editor.getCursor("from"),
            editor.offsetToPos(content.length)
          );
        }
        new Notice(`${unit.charAt(0).toUpperCase() + unit.slice(1)} créée : ${safe}`);
      }
    ).open();
  }.bind(plugin);

  plugin.duplicateSceneFile = async function (file) {
    const unit = this.unitLabel();
    const unitCap = unit.charAt(0).toUpperCase() + unit.slice(1);
    if (!file) return new Notice(`Aucune ${unit} active.`);
    if (!this.isSceneFile(file)) {
      return new Notice(`Cette note ne ressemble pas à une ${unit} Feuillets.`);
    }
    const fm = Object.assign(
      {},
      this.app.metadataCache.getFileCache(file)?.frontmatter || {}
    );
    const currentOrder = ensureNumber(fm.ordre, 0);
    const defaultTitle = fm.titre
      ? `${fm.titre} - copie`
      : `${file.basename} - copie`;
    new TextInputModal(
      this.app,
      `Dupliquer la ${unit}`,
      [
        { name: "titre", label: "Titre", value: defaultTitle },
        {
          name: "titre_binder",
          label: "Titre binder",
          // repli sur titre_court (ancienne clé, renommée)
          value: (fm.titre_binder !== undefined ? fm.titre_binder : fm.titre_court) || "",
        },
        { name: "ordre", label: "Ordre", value: String(currentOrder + 1) },
        { name: "filename", label: "Nom du fichier", value: defaultTitle },
      ],
      async (values) => {
        const folder = file.parent?.path || "";
        const safe = sanitizeFileBasename(
          values.filename || defaultTitle,
          defaultTitle
        );
        const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          return new Notice("Un fichier avec ce nom existe déjà.");
        }
        await this.app.vault.copy(file, path);
        const copied = this.app.vault.getAbstractFileByPath(path);
        if (!(copied instanceof TFile)) return new Notice("Copie introuvable.");
        await this.app.fileManager.processFrontMatter(copied, (fm2) => {
          fm2.titre = values.titre || defaultTitle;
          fm2.titre_binder = values.titre_binder || "";
          delete fm2.titre_court;
          fm2.ordre = ensureNumber(values.ordre, currentOrder + 1);
          fm2.synopsis = "";
          fm2.resume = "";
          fm2.notes = "";
          fm2.tags = normalizeTags(fm2.tags);
          if (fm2.objectif == null) fm2.objectif = 0;
        });
        new Notice(`${unitCap} dupliquée : ${safe}`);
      }
    ).open();
  }.bind(plugin);

  plugin.moveSceneFile = async function (file) {
    const unit = this.unitLabel();
    const unitCap = unit.charAt(0).toUpperCase() + unit.slice(1);
    if (!file) return new Notice(`Aucune ${unit} active.`);
    new TextInputModal(
      this.app,
      `Déplacer la ${unit}`,
      [
        { name: "folder", label: "Dossier cible", value: file.parent?.path || "" },
        {
          name: "filename",
          label: "Nom du fichier",
          value: stripMdExtension(file.name),
        },
      ],
      async (values) => {
        const folder = String(values.folder || "").trim();
        const basename = sanitizeFileBasename(
          values.filename || file.basename,
          file.basename
        );
        const targetPath = folder ? `${folder}/${basename}.md` : `${basename}.md`;
        if (
          targetPath !== file.path &&
          this.app.vault.getAbstractFileByPath(targetPath)
        ) {
          return new Notice("Le fichier cible existe déjà.");
        }
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        await this.app.fileManager.renameFile(file, targetPath);
        new Notice(`${unitCap} déplacée : ${targetPath}`);
      }
    ).open();
  }.bind(plugin);

  /** Duplication en masse (sélection multi-scènes) : pas de modale par
   * fichier (ça ouvrirait N fenêtres à la suite) — applique directement le
   * même suffixe par défaut que duplicateSceneFile quand on ne change rien
   * au formulaire. Pour un titre personnalisé, dupliquer au cas par cas via
   * le menu contextuel reste possible. */
  plugin.duplicateManyScenes = async function (files) {
    let created = 0;
    for (const file of files) {
      if (!(file instanceof TFile) || !this.isSceneFile(file)) continue;
      const fm = Object.assign(
        {},
        this.app.metadataCache.getFileCache(file)?.frontmatter || {}
      );
      const currentOrder = ensureNumber(fm.ordre, 0);
      const defaultTitle = fm.titre
        ? `${fm.titre} - copie`
        : `${file.basename} - copie`;
      const folder = file.parent?.path || "";
      const safe = sanitizeFileBasename(defaultTitle, defaultTitle);
      let path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`Ignoré (nom déjà pris) : ${safe}`);
        continue;
      }
      await this.app.vault.copy(file, path);
      const copied = this.app.vault.getAbstractFileByPath(path);
      if (!(copied instanceof TFile)) continue;
      await this.app.fileManager.processFrontMatter(copied, (fm2) => {
        fm2.titre = defaultTitle;
        fm2.ordre = ensureNumber(currentOrder + 1);
        fm2.synopsis = "";
        fm2.resume = "";
        fm2.notes = "";
        fm2.tags = normalizeTags(fm2.tags);
        if (fm2.objectif == null) fm2.objectif = 0;
      });
      created++;
    }
    const unit = this.unitLabel();
    new Notice(
      created > 0
        ? `${created} ${unit}(s) dupliquée(s).`
        : `Aucune ${unit} dupliquée.`
    );
  }.bind(plugin);

  /** Déplacement en masse : UNE seule modale (dossier cible), chaque
   * fichier garde son propre nom — contrairement à moveSceneFile qui gère
   * aussi un renommage, inutile ici pour plusieurs fichiers à la fois. */
  plugin.openMoveManyModal = function (files) {
    const unit = this.unitLabel();
    const sceneFiles = files.filter(
      (f) => f instanceof TFile && this.isSceneFile(f)
    );
    if (sceneFiles.length === 0) {
      return new Notice(`Aucune ${unit} à déplacer.`);
    }
    new TextInputModal(
      this.app,
      `Déplacer ${sceneFiles.length} ${unit}(s)`,
      [
        {
          name: "folder",
          label: "Dossier cible",
          value: sceneFiles[0].parent?.path || "",
        },
      ],
      async (values) => {
        const folder = String(values.folder || "").trim();
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        let moved = 0;
        for (const file of sceneFiles) {
          const targetPath = folder
            ? `${folder}/${file.name}`
            : file.name;
          if (
            targetPath !== file.path &&
            this.app.vault.getAbstractFileByPath(targetPath)
          ) {
            new Notice(`Ignoré (nom déjà pris à destination) : ${file.name}`);
            continue;
          }
          await this.app.fileManager.renameFile(file, targetPath);
          moved++;
        }
        new Notice(
          moved > 0 ? `${moved} ${unit}(s) déplacée(s).` : `Aucune ${unit} déplacée.`
        );
      }
    ).open();
  }.bind(plugin);

  plugin.getDefaultRule = function (preset, field) {
    if (preset.ignoreFields.includes(field)) return "ignore";
    if (preset.aggregateFields.includes(field)) return "aggregate";
    if (preset.firstFields.includes(field)) return "first";
    return "target";
  }.bind(plugin);

  plugin.applyRule = function (targetValue, sourceValue, rule, field) {
    if (rule === "ignore") return "";
    if (rule === "source") return sourceValue ?? targetValue ?? "";
    if (
      rule === "first"
    ) {
      return toValue(targetValue).trim()
        ? targetValue
        : sourceValue ?? targetValue ?? "";
    }
    if (rule === "aggregate") {
      if (field === "tags") {
        return [
          ...new Set([...normalizeTags(targetValue), ...normalizeTags(sourceValue)]),
        ];
      }
      return [targetValue, sourceValue].filter((v) => toValue(v).trim()).join("\n\n");
    }
    return targetValue ?? "";
  }.bind(plugin);

  plugin.buildMergeYaml = function (
    targetFm,
    sourceFm,
    preset,
    localRules = {},
    collector = null
  ) {
    const fields = [
      ...new Set([
        ...Object.keys(targetFm || {}),
        ...Object.keys(sourceFm || {}),
      ]),
    ];
    for (const field of fields) {
      const rule = localRules[field] || this.getDefaultRule(preset, field);
      targetFm[field] = this.applyRule(
        targetFm[field],
        sourceFm[field],
        rule,
        field
      );
      if (collector) {
        collector[field] = {
          value: toValue(targetFm[field]),
          origin: rule,
          defaultRule: this.getDefaultRule(preset, field),
        };
      }
    }
  }.bind(plugin);

  plugin.buildMergePlan = async function (
    files,
    targetPath,
    sourceOrder,
    mergeMode,
    keepSeparator,
    localRules = {}
  ) {
    const target = files.find((f) => f.path === targetPath) || files[0];
    const sourcesAll = files.filter((f) => f.path !== target.path);
    const map = new Map(sourcesAll.map((f) => [f.path, f]));
    const ordered = sourceOrder.filter((p) => map.has(p));
    for (const src of sourcesAll) {
      if (!ordered.includes(src.path)) ordered.push(src.path);
    }
    const sources = ordered.map((p) => map.get(p)).filter(Boolean);

    const preset = YAML_PRESETS[this.settings.mergeYamlPreset];
    const targetFm = Object.assign(
      {},
      this.app.metadataCache.getFileCache(target)?.frontmatter || {}
    );
    const previewFm = Object.assign({}, targetFm);
    const collector = {};
    const sourceBodies = [];
    const sourceFms = [];
    for (const src of sources) {
      const raw = await this.app.vault.read(src);
      sourceBodies.push(splitBody(raw));
      sourceFms.push(
        Object.assign(
          {},
          this.app.metadataCache.getFileCache(src)?.frontmatter || {}
        )
      );
    }
    for (const sourceFm of sourceFms) {
      this.buildMergeYaml(previewFm, sourceFm, preset, localRules, collector);
    }
    const yamlEntries = [
      ...new Set([...Object.keys(previewFm), ...Object.keys(collector)]),
    ]
      .sort()
      .map((key) => ({
        key,
        value: shortText(
          previewFm[key] == null ? "" : toValue(previewFm[key]),
          140
        ),
        origin: collector[key]?.origin || "target",
        defaultRule: collector[key]?.defaultRule || this.getDefaultRule(preset, key),
      }));
    return {
      target,
      sources,
      mergeMode,
      keepSeparator,
      localRules,
      summary:
        sources.length === 1
          ? `Fusionner "${this.shortTitleFor(sources[0])}" dans "${this.shortTitleFor(target)}" ?`
          : `Fusionner ${sources.length} ${this.unitLabelPlural()} dans "${this.shortTitleFor(target)}" ?`,
      preview: {
        tags: normalizeTags(previewFm.tags),
        statut: previewFm.statut || "",
        compiler: Boolean(previewFm.compiler),
        objectif: previewFm.objectif ?? 0,
        notes: previewFm.notes || "",
        excerpts: sources.map((src, i) =>
          buildMergedSection(src, sourceBodies[i], mergeMode)
        ),
        yamlLabel: preset.label,
        yamlEntries,
      },
    };
  }.bind(plugin);

  plugin.openMergeModal = async function (files) {
    new MergeModal(this.app, this, files).open();
  }.bind(plugin);

  plugin.openYamlOptions = async function (mergeModal) {
    new YamlOptionsModal(this.app, this, mergeModal).open();
  }.bind(plugin);

  plugin.openMergeSelectModal = async function (targetFile, siblings) {
    new MergeSelectModal(this.app, this, targetFile, siblings).open();
  }.bind(plugin);

  plugin.applyPreset = async function (key) {
    const preset = YAML_PRESETS[key];
    if (!preset) return;
    this.settings.mergeYamlPreset = key;
    await this.saveSettings();
  }.bind(plugin);

  plugin.mergeManyScenes = async function (
    sources,
    target,
    mergeMode = "heading",
    keepSeparator = true,
    localRules = {}
  ) {
    const unit = this.unitLabel();
    const unitPlural = this.unitLabelPlural();
    if (!(target instanceof TFile) || sources.length === 0) {
      return new Notice(`Aucune ${unit} à fusionner.`);
    }
    const joiner = keepSeparator ? this.settings.mergeNotesSeparator : "\n\n";
    let mergedCount = 0;
    for (const source of sources) {
      if (!(source instanceof TFile) || source.path === target.path) continue;
      try {
        const raw = await this.app.vault.read(source);
        const sourceBody = splitBody(raw);
        const sourceFm = Object.assign(
          {},
          this.app.metadataCache.getFileCache(source)?.frontmatter || {}
        );
        await this.app.fileManager.processFrontMatter(target, (fm) =>
          this.buildMergeYaml(
            fm,
            sourceFm,
            YAML_PRESETS[this.settings.mergeYamlPreset],
            localRules
          )
        );
        await this.app.vault.process(target, (current) => {
          const parts = splitFrontmatter(current);
          const fragment = buildMergedSection(source, sourceBody, mergeMode);
          const mergedBody =
            `${parts.body.trimEnd()}${joiner}${fragment}`.trim() + "\n";
          return parts.frontmatter
            ? `---\n${parts.frontmatter}\n---\n\n${mergedBody}`
            : mergedBody;
        });
        await this.app.vault.delete(source);
        mergedCount++;
      } catch (e) {
        console.error("Feuillets : échec de la fusion", e);
        new Notice(
          `Fusion interrompue après ${mergedCount} ${unit}(s) fusionnée(s) avec succès : ` +
            `échec sur « ${this.shortTitleFor(source)} ». Aucune autre ${unit} n'a été touchée.`
        );
        return;
      }
    }
    new Notice(`Fusion terminée dans : ${this.shortTitleFor(target)}`);
  }.bind(plugin);

  // 2. Register Ribbon Icon
  plugin.addRibbonIcon(
    "scissors-square-dashed-bottom",
    "Feuillets : Actions de scène",
    (evt) => {
      const file = plugin.getActiveFile();
      if (!file || !plugin.isSceneFile(file)) {
        return new Notice("Ouvre une scène Feuillets.");
      }
      plugin.openSceneMenu(file, evt);
    }
  );

  // 3. Register Commands
  plugin.addCommand({
    id: "feuillets-split",
    name: "Scinder la scène",
    callback: async () => plugin.splitActiveScene(),
  });
  plugin.addCommand({
    id: "feuillets-duplicate",
    name: "Dupliquer la scène",
    callback: async () => plugin.duplicateActiveScene(),
  });
  plugin.addCommand({
    id: "feuillets-move",
    name: "Déplacer la scène",
    callback: async () => plugin.moveActiveScene(),
  });
  plugin.addCommand({
    id: "feuillets-merge-selected",
    name: "Fusionner les scènes sélectionnées",
    callback: async () =>
      new Notice("Sélectionne au moins deux fichiers dans l’explorateur."),
  });

  // 4. Register Event Hooks
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || !plugin.isSceneFile(file)) return;
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Scinder")
          .setIcon("scissors")
          .onClick(async () => plugin.splitSceneFile(file))
      );
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Dupliquer")
          .setIcon("copy")
          .onClick(async () => plugin.duplicateSceneFile(file))
      );
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Déplacer")
          .setIcon("move")
          .onClick(async () => plugin.moveSceneFile(file))
      );
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
      const file = view?.file;
      if (!(file instanceof TFile) || !plugin.isSceneFile(file)) return;
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Scinder")
          .setIcon("scissors")
          .onClick(async () => plugin.splitSceneFile(file))
      );
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Dupliquer")
          .setIcon("copy")
          .onClick(async () => plugin.duplicateSceneFile(file))
      );
      menu.addItem((item) =>
        item
          .setTitle("Feuillets: Déplacer")
          .setIcon("move")
          .onClick(async () => plugin.moveSceneFile(file))
      );
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on("files-menu", (menu, files) => {
      const sceneFiles = files.filter(
        (f) => f instanceof TFile && plugin.isSceneFile(f)
      );
      if (sceneFiles.length < 2) return;
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(`Feuillets: Fusionner ${sceneFiles.length} scènes`)
          .setIcon("git-merge")
          .onClick(async () => plugin.openMergeModal(sceneFiles))
      );
    })
  );
}
