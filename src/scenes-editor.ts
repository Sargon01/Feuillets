import {
  TFile,
  TFolder,
  Notice,
  Modal,
  Setting,
  MarkdownView,
  Menu,
  Plugin,
  stringifyYaml,
  type App,
} from "obsidian";

import {
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

type YamlPreset = {
  label: string;
  targetFields: string[];
  aggregateFields: string[];
  firstFields: string[];
  ignoreFields: string[];
};

export const YAML_PRESETS: Record<string, YamlPreset> = {
  roman: {
    label: "Roman",
    targetFields: ["title", "short_title", "order", "date"],
    aggregateFields: ["tags", "notes"],
    firstFields: ["status", "label", "goal", "compile"],
    ignoreFields: ["synopsis", "summary"],
  },
  nouvelle: {
    label: "Nouvelle",
    targetFields: ["title", "short_title", "order", "date", "status"],
    aggregateFields: ["tags", "notes"],
    firstFields: ["label", "goal", "compile"],
    ignoreFields: ["synopsis", "summary"],
  },
  scenario: {
    label: "Scénario",
    targetFields: ["title", "order", "date"],
    aggregateFields: ["tags", "notes", "label"],
    firstFields: ["status", "goal", "compile"],
    ignoreFields: ["summary"],
  },
  minimal: {
    label: "Minimal",
    targetFields: [
      "title",
      "short_title",
      "order",
      "date",
      "status",
      "label",
      "goal",
      "compile",
    ],
    aggregateFields: ["tags"],
    firstFields: [],
    ignoreFields: ["synopsis", "summary", "notes"],
  },
};

type ScenesEditorSettings = FeuilletsSettings & {
  splitStatus: string;
  copyCompilerOnSplit: boolean;
  resetSynopsisOnSplit: boolean;
  resetResumeOnSplit: boolean;
  resetNotesOnSplit: boolean;
  mergeNotesSeparator: string;
  mergeModeDefault: "heading" | "comment" | "continuous";
  mergeKeepSeparatorDefault: boolean;
  mergeYamlPreset: string;
};

type MergePreviewYamlEntry = { key: string; value: string; origin: string; defaultRule: string };
type MergePreview = {
  tags: string[];
  statut: string;
  compiler: boolean;
  objectif: number;
  notes: string;
  excerpts: string[];
  yamlLabel: string;
  yamlEntries: MergePreviewYamlEntry[];
};
type MergePlan = {
  target: TFile;
  sources: TFile[];
  mergeMode: string;
  keepSeparator: boolean;
  localRules: Record<string, string>;
  summary: string;
  preview: MergePreview;
};

type SceneField = { name: string; label: string; description?: string; value: string };

/** Surface du plugin principal (main.js, non encore migré) réellement
 * utilisée ici — évite d'importer FeuilletsPlugin directement (dépendance
 * circulaire), et documente précisément ce dont ce module a besoin. Les
 * méthodes de la section 1 d'initScenesEditor (isSceneFile, splitSceneFile…)
 * sont déclarées ici aussi : elles n'existent pas encore sur `plugin` avant
 * l'appel à initScenesEditor, qui les attache dynamiquement. */
export type ScenesEditorPlugin = Omit<Plugin, "settings"> & {
  settings: ScenesEditorSettings;
  getProjectFolder(): TFolder | null;
  fmOf(file: TFile): SceneFrontmatter;
  shortTitleFor(file: TFile): string;
  unitLabel(): string;
  unitLabelPlural(): string;
  saveSettings(): Promise<void>;

  isSceneFile(file: TFile): boolean;
  openSceneMenu(file: TFile, evt?: MouseEvent): void;
  splitActiveScene(): Promise<void> | void;
  duplicateActiveScene(): Promise<void> | void;
  moveActiveScene(): Promise<void> | void;
  getActiveFile(): TFile | null;
  splitSceneFile(file: TFile | null): Promise<void>;
  duplicateSceneFile(file: TFile | null): Promise<void>;
  moveSceneFile(file: TFile | null): Promise<void>;
  duplicateManyScenes(files: TFile[]): Promise<void>;
  openMoveManyModal(files: TFile[]): void;
  getDefaultRule(preset: YamlPreset, field: string): string;
  applyRule(targetValue: unknown, sourceValue: unknown, rule: string, field: string): unknown;
  buildMergeYaml(
    targetFm: Record<string, unknown>,
    sourceFm: Record<string, unknown>,
    preset: YamlPreset,
    localRules?: Record<string, string>,
    collector?: Record<string, { value: string; origin: string; defaultRule: string }> | null
  ): void;
  buildMergePlan(
    files: TFile[],
    targetPath: string,
    sourceOrder: string[],
    mergeMode: string,
    keepSeparator: boolean,
    localRules?: Record<string, string>
  ): Promise<MergePlan>;
  openMergeModal(files: TFile[]): Promise<void>;
  openYamlOptions(mergeModal: MergeModal): Promise<void>;
  openMergeSelectModal(targetFile: TFile, siblings: TFile[]): Promise<void>;
  applyPreset(key: string): Promise<void>;
  mergeManyScenes(
    sources: TFile[],
    target: TFile,
    mergeMode?: string,
    keepSeparator?: boolean,
    localRules?: Record<string, string>
  ): Promise<void>;
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
  titleText: string;
  fields: SceneField[];
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  values: Record<string, string>;

  constructor(app: App, title: string, fields: SceneField[], onSubmit: (values: Record<string, string>) => Promise<void> | void) {
    super(app);
    this.titleText = title;
    this.fields = fields;
    this.onSubmit = onSubmit;
    this.values = {};
  }
  onOpen(): void {
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
  plugin: ScenesEditorPlugin;
  files: TFile[];
  targetPath: string;
  sourceOrder: string[];
  mergeMode: string;
  keepSeparator: boolean;
  plan: MergePlan | null;

  constructor(app: App, plugin: ScenesEditorPlugin, files: TFile[]) {
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

  async refresh(): Promise<void> {
    this.plan = await this.plugin.buildMergePlan(
      this.files,
      this.targetPath,
      this.sourceOrder,
      this.mergeMode,
      this.keepSeparator
    );
    this.render();
  }

  render(): void {
    const plan = this.plan;
    if (!plan) return;
    this.contentEl.empty();
    this.setTitle("Fusion");

    const hero = this.contentEl.createDiv({ cls: "feuillets-merge-hero" });
    hero.createDiv({ cls: "feuillets-merge-title", text: plan.summary });
    hero.createDiv({
      cls: "feuillets-merge-subtitle",
      text: `${plan.sources.length} source${
        plan.sources.length > 1 ? "s" : ""
      } supprimée${plan.sources.length > 1 ? "s" : ""} après fusion.`,
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
      ["Sources", String(plan.sources.length)],
      ["Tags", String(plan.preview.tags.length)],
      ["Notes", plan.preview.notes ? "oui" : "non"],
      ["Obj.", String(plan.preview.objectif)],
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
      text: this.plugin.shortTitleFor(plan.target),
    });
    left.createDiv({
      cls: "feuillets-merge-path-secondary",
      text: plan.target.path,
    });
    left.createDiv({
      cls: "feuillets-merge-card-title",
      text: "Ordre des sources",
    });
    const sourceList = left.createDiv({ cls: "feuillets-merge-order" });
    plan.sources.forEach((file, index) => {
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
      down.disabled = index === plan.sources.length - 1;
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
      `Stratégie : ${plan.preview.yamlLabel}`,
      `Tags : ${shortText(plan.preview.tags.join(", ") || "—", 42)}`,
      `Notes : ${shortText(plan.preview.notes, 44)}`,
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
    plan.preview.excerpts.forEach((text, idx) => {
      const item = excerptList.createDiv({ cls: "feuillets-merge-excerpt" });
      item.createDiv({
        cls: "feuillets-merge-excerpt-title",
        text: this.plugin.shortTitleFor(plan.sources[idx]),
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
              plan.sources,
              plan.target,
              this.mergeMode,
              this.keepSeparator
            );
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Annuler").onClick(() => this.close())
      );
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }
}

class YamlOptionsModal extends Modal {
  plugin: ScenesEditorPlugin;
  mergeModal: MergeModal;

  constructor(app: App, plugin: ScenesEditorPlugin, mergeModal: MergeModal) {
    super(app);
    this.plugin = plugin;
    this.mergeModal = mergeModal;
  }

  onOpen(): void {
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

    this.contentEl.createDiv({
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
  plugin: ScenesEditorPlugin;
  targetFile: TFile;
  scenes: TFile[];
  selected: Set<TFile>;

  constructor(app: App, plugin: ScenesEditorPlugin, targetFile: TFile, siblings: TFile[]) {
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

  onOpen(): void {
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
    listEl.addClasses(["feuillets-scroll-list", "feuillets-mb-lg"]);

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

export function initScenesEditor(plugin: ScenesEditorPlugin): void {
  // 1. Attach helper functions and methods to the main plugin
  plugin.isSceneFile = (file: TFile): boolean => {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const root = plugin.getProjectFolder();
    if (!root || !file.path.startsWith(root.path + "/")) return false;
    if (file.parent && file.basename === file.parent.name) return false; // note de dossier
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!fm && ("title" in fm || "titre" in fm || "order" in fm || "ordre" in fm || "compile" in fm || "compiler" in fm);
  };

  plugin.openSceneMenu = (file: TFile, evt?: MouseEvent): void => {
    const menu = new Menu();
    menu
      .addItem((i) =>
        i
          .setTitle("Scinder")
          .setIcon("scissors")
          .onClick(async () => plugin.splitSceneFile(file))
      );
    menu
      .addItem((i) =>
        i
          .setTitle("Dupliquer")
          .setIcon("copy")
          .onClick(async () => plugin.duplicateSceneFile(file))
      );
    menu
      .addItem((i) =>
        i
          .setTitle("Déplacer")
          .setIcon("move")
          .onClick(async () => plugin.moveSceneFile(file))
      );
    if (evt) {
      menu.showAtMouseEvent(evt);
    } else {
      menu.showAtPosition({ x: window.innerWidth / 2, y: 80 });
    }
  };

  plugin.splitActiveScene = (): Promise<void> | void => {
    return plugin.splitSceneFile(plugin.getActiveFile());
  };

  plugin.duplicateActiveScene = (): Promise<void> | void => {
    return plugin.duplicateSceneFile(plugin.getActiveFile());
  };

  plugin.moveActiveScene = (): Promise<void> | void => {
    return plugin.moveSceneFile(plugin.getActiveFile());
  };

  plugin.getActiveFile = (): TFile | null => {
    return plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file || null;
  };

  plugin.splitSceneFile = async (file: TFile | null): Promise<void> => {
    const unit = plugin.unitLabel();
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!file) { new Notice(`Aucune ${unit} active.`); return; }
    if (!editor || view?.file?.path !== file.path) {
      new Notice(`Ouvre la ${unit} dans l’éditeur.`);
      return;
    }
    if (!plugin.isSceneFile(file)) {
      new Notice(`Cette note ne ressemble pas à une ${unit} Feuillets.`);
      return;
    }
    const selection = editor.getSelection();
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const splitText =
      selection && selection.trim()
        ? selection
        : content.slice(editor.posToOffset(cursor));
    if (!splitText.trim()) {
      new Notice(
        "Sélectionne un texte ou place le curseur avant la fin du document."
      );
      return;
    }

    const fm: Record<string, unknown> = Object.assign({}, plugin.fmOf(file));
    const currentOrder = ensureNumber(fm.order, 0);
    const defaultTitle = fm.title
      ? `${toValue(fm.title)} - 2`
      : `${file.basename} - 2`;
    const defaultShort = fm.short_title ? `${toValue(fm.short_title)} 2` : "";

    new TextInputModal(
      plugin.app,
      `Scinder la ${unit}`,
      [
        { name: "titre", label: "Nouveau titre", value: String(defaultTitle) },
        { name: "titre_binder", label: "Titre binder", value: String(defaultShort) },
        { name: "ordre", label: "Ordre", value: String(currentOrder + 1) },
        { name: "filename", label: "Nom du fichier", value: String(defaultTitle) },
      ],
      async (values) => {
        const folder = file.parent?.path || "";
        const safe = sanitizeFileBasename(
          values.filename || defaultTitle,
          String(defaultTitle)
        );
        const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
        if (plugin.app.vault.getAbstractFileByPath(path)) {
          new Notice("Un fichier avec ce nom existe déjà.");
          return;
        }
        const frontmatter: Record<string, unknown> = Object.assign({}, fm, {
          title: values.titre || defaultTitle,
          short_title: values.titre_binder || "",
          order: ensureNumber(values.ordre, currentOrder + 1),
          status: plugin.settings.splitStatus || fm.status || "",
        });
        delete frontmatter.titre;
        delete frontmatter.titre_binder;
        delete frontmatter.titre_court;
        delete frontmatter.ordre;
        delete frontmatter.statut;
        if (plugin.settings.resetSynopsisOnSplit) frontmatter.synopsis = "";
        if (plugin.settings.resetResumeOnSplit) frontmatter.summary = "";
        if (plugin.settings.resetNotesOnSplit) frontmatter.notes = "";
        if (!plugin.settings.copyCompilerOnSplit) frontmatter.compile = false;
        if (frontmatter.goal == null) frontmatter.goal = 0;
        delete frontmatter.resume;
        delete frontmatter.objectif;
        delete frontmatter.compiler;
        frontmatter.tags = normalizeTags(frontmatter.tags);
        await plugin.app.vault.create(
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
  };

  plugin.duplicateSceneFile = async (file: TFile | null): Promise<void> => {
    const unit = plugin.unitLabel();
    const unitCap = unit.charAt(0).toUpperCase() + unit.slice(1);
    if (!file) { new Notice(`Aucune ${unit} active.`); return; }
    if (!plugin.isSceneFile(file)) {
      new Notice(`Cette note ne ressemble pas à une ${unit} Feuillets.`);
      return;
    }
    const fm: Record<string, unknown> = Object.assign({}, plugin.fmOf(file));
    const currentOrder = ensureNumber(fm.order, 0);
    const defaultTitle = fm.title
      ? `${toValue(fm.title)} - copie`
      : `${file.basename} - copie`;
    new TextInputModal(
      plugin.app,
      `Dupliquer la ${unit}`,
      [
        { name: "titre", label: "Titre", value: String(defaultTitle) },
        {
          name: "titre_binder",
          label: "Titre binder",
          value: toValue(fm.short_title),
        },
        { name: "ordre", label: "Ordre", value: String(currentOrder + 1) },
        { name: "filename", label: "Nom du fichier", value: String(defaultTitle) },
      ],
      async (values) => {
        const folder = file.parent?.path || "";
        const safe = sanitizeFileBasename(
          values.filename || defaultTitle,
          String(defaultTitle)
        );
        const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
        if (plugin.app.vault.getAbstractFileByPath(path)) {
          new Notice("Un fichier avec ce nom existe déjà.");
          return;
        }
        await plugin.app.vault.copy(file, path);
        const copied = plugin.app.vault.getAbstractFileByPath(path);
        if (!(copied instanceof TFile)) { new Notice("Copie introuvable."); return; }
        await plugin.app.fileManager.processFrontMatter(copied, (fm2: Record<string, unknown>) => {
          fm2.title = values.titre || defaultTitle;
          fm2.short_title = values.titre_binder || "";
          fm2.order = ensureNumber(values.ordre, currentOrder + 1);
          fm2.synopsis = "";
          fm2.summary = "";
          fm2.notes = "";
          fm2.tags = normalizeTags(fm2.tags);
          if (fm2.goal == null) fm2.goal = 0;
          delete fm2.titre;
          delete fm2.titre_binder;
          delete fm2.titre_court;
          delete fm2.ordre;
          delete fm2.resume;
          delete fm2.objectif;
        });
        new Notice(`${unitCap} dupliquée : ${safe}`);
      }
    ).open();
  };

  plugin.moveSceneFile = async (file: TFile | null): Promise<void> => {
    const unit = plugin.unitLabel();
    const unitCap = unit.charAt(0).toUpperCase() + unit.slice(1);
    if (!file) { new Notice(`Aucune ${unit} active.`); return; }
    new TextInputModal(
      plugin.app,
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
          plugin.app.vault.getAbstractFileByPath(targetPath)
        ) {
          new Notice("Le fichier cible existe déjà.");
          return;
        }
        if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
          await plugin.app.vault.createFolder(folder);
        }
        await plugin.app.fileManager.renameFile(file, targetPath);
        new Notice(`${unitCap} déplacée : ${targetPath}`);
      }
    ).open();
  };

  /** Duplication en masse (sélection multi-scènes) : pas de modale par
   * fichier (ça ouvrirait N fenêtres à la suite) — applique directement le
   * même suffixe par défaut que duplicateSceneFile quand on ne change rien
   * au formulaire. Pour un titre personnalisé, dupliquer au cas par cas via
   * le menu contextuel reste possible. */
  plugin.duplicateManyScenes = async (files: TFile[]): Promise<void> => {
    let created = 0;
    for (const file of files) {
      if (!(file instanceof TFile) || !plugin.isSceneFile(file)) continue;
      const fm: Record<string, unknown> = Object.assign({}, plugin.fmOf(file));
      const currentOrder = ensureNumber(fm.order, 0);
      const defaultTitle = fm.title
        ? `${toValue(fm.title)} - copie`
        : `${file.basename} - copie`;
      const folder = file.parent?.path || "";
      const safe = sanitizeFileBasename(defaultTitle, defaultTitle);
      const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
      if (plugin.app.vault.getAbstractFileByPath(path)) {
        new Notice(`Ignoré (nom déjà pris) : ${safe}`);
        continue;
      }
      await plugin.app.vault.copy(file, path);
      const copied = plugin.app.vault.getAbstractFileByPath(path);
      if (!(copied instanceof TFile)) continue;
      await plugin.app.fileManager.processFrontMatter(copied, (fm2: Record<string, unknown>) => {
        fm2.title = defaultTitle;
        fm2.order = ensureNumber(currentOrder + 1);
        fm2.synopsis = "";
        fm2.summary = "";
        fm2.notes = "";
        fm2.tags = normalizeTags(fm2.tags);
        if (fm2.goal == null) fm2.goal = 0;
        delete fm2.titre;
        delete fm2.ordre;
        delete fm2.resume;
        delete fm2.objectif;
      });
      created++;
    }
    const unit = plugin.unitLabel();
    new Notice(
      created > 0
        ? `${created} ${unit}(s) dupliquée(s).`
        : `Aucune ${unit} dupliquée.`
    );
  };

  /** Déplacement en masse : UNE seule modale (dossier cible), chaque
   * fichier garde son propre nom — contrairement à moveSceneFile qui gère
   * aussi un renommage, inutile ici pour plusieurs fichiers à la fois. */
  plugin.openMoveManyModal = (files: TFile[]): void => {
    const unit = plugin.unitLabel();
    const sceneFiles = files.filter(
      (f) => f instanceof TFile && plugin.isSceneFile(f)
    );
    if (sceneFiles.length === 0) {
      new Notice(`Aucune ${unit} à déplacer.`);
      return;
    }
    new TextInputModal(
      plugin.app,
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
        if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
          await plugin.app.vault.createFolder(folder);
        }
        let moved = 0;
        for (const file of sceneFiles) {
          const targetPath = folder
            ? `${folder}/${file.name}`
            : file.name;
          if (
            targetPath !== file.path &&
            plugin.app.vault.getAbstractFileByPath(targetPath)
          ) {
            new Notice(`Ignoré (nom déjà pris à destination) : ${file.name}`);
            continue;
          }
          await plugin.app.fileManager.renameFile(file, targetPath);
          moved++;
        }
        new Notice(
          moved > 0 ? `${moved} ${unit}(s) déplacée(s).` : `Aucune ${unit} déplacée.`
        );
      }
    ).open();
  };

  plugin.getDefaultRule = (preset: YamlPreset, field: string): string => {
    if (preset.ignoreFields.includes(field)) return "ignore";
    if (preset.aggregateFields.includes(field)) return "aggregate";
    if (preset.firstFields.includes(field)) return "first";
    return "target";
  };

  plugin.applyRule = (targetValue: unknown, sourceValue: unknown, rule: string, field: string): unknown => {
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
  };

  plugin.buildMergeYaml = (
    targetFm: Record<string, unknown>,
    sourceFm: Record<string, unknown>,
    preset: YamlPreset,
    localRules: Record<string, string> = {},
    collector: Record<string, { value: string; origin: string; defaultRule: string }> | null = null
  ): void => {
    const fields = [
      ...new Set([
        ...Object.keys(targetFm || {}),
        ...Object.keys(sourceFm || {}),
      ]),
    ];
    for (const field of fields) {
      const rule = localRules[field] || plugin.getDefaultRule(preset, field);
      targetFm[field] = plugin.applyRule(
        targetFm[field],
        sourceFm[field],
        rule,
        field
      );
      if (collector) {
        collector[field] = {
          value: toValue(targetFm[field]),
          origin: rule,
          defaultRule: plugin.getDefaultRule(preset, field),
        };
      }
    }
  };

  plugin.buildMergePlan = async (
    files: TFile[],
    targetPath: string,
    sourceOrder: string[],
    mergeMode: string,
    keepSeparator: boolean,
    localRules: Record<string, string> = {}
  ): Promise<MergePlan> => {
    const target = files.find((f) => f.path === targetPath) || files[0];
    const sourcesAll = files.filter((f) => f.path !== target.path);
    const map = new Map(sourcesAll.map((f) => [f.path, f]));
    const ordered = sourceOrder.filter((p) => map.has(p));
    for (const src of sourcesAll) {
      if (!ordered.includes(src.path)) ordered.push(src.path);
    }
    const sources = ordered.map((p) => map.get(p)).filter((f): f is TFile => !!f);

    const preset = YAML_PRESETS[plugin.settings.mergeYamlPreset];
    const targetFm: Record<string, unknown> = Object.assign({}, plugin.fmOf(target));
    const previewFm: Record<string, unknown> = Object.assign({}, targetFm);
    const collector: Record<string, { value: string; origin: string; defaultRule: string }> = {};
    const sourceBodies: string[] = [];
    const sourceFms: Record<string, unknown>[] = [];
    for (const src of sources) {
      const raw = await plugin.app.vault.read(src);
      sourceBodies.push(splitBody(raw));
      sourceFms.push(Object.assign({}, plugin.fmOf(src)));
    }
    for (const sourceFm of sourceFms) {
      plugin.buildMergeYaml(previewFm, sourceFm, preset, localRules, collector);
    }
    const yamlEntries: MergePreviewYamlEntry[] = [
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
        defaultRule: collector[key]?.defaultRule || plugin.getDefaultRule(preset, key),
      }));
    return {
      target,
      sources,
      mergeMode,
      keepSeparator,
      localRules,
      summary:
        sources.length === 1
          ? `Fusionner "${plugin.shortTitleFor(sources[0])}" dans "${plugin.shortTitleFor(target)}" ?`
          : `Fusionner ${sources.length} ${plugin.unitLabelPlural()} dans "${plugin.shortTitleFor(target)}" ?`,
      preview: {
        tags: normalizeTags(previewFm.tags),
        statut: toValue(previewFm.status),
        compiler: Boolean(previewFm.compile),
        objectif: Number(previewFm.goal ?? 0),
        notes: toValue(previewFm.notes),
        excerpts: sources.map((src, i) =>
          buildMergedSection(src, sourceBodies[i], mergeMode)
        ),
        yamlLabel: preset.label,
        yamlEntries,
      },
    };
  };

  plugin.openMergeModal = async (files: TFile[]): Promise<void> => {
    new MergeModal(plugin.app, plugin, files).open();
  };

  plugin.openYamlOptions = async (mergeModal: MergeModal): Promise<void> => {
    new YamlOptionsModal(plugin.app, plugin, mergeModal).open();
  };

  plugin.openMergeSelectModal = async (targetFile: TFile, siblings: TFile[]): Promise<void> => {
    new MergeSelectModal(plugin.app, plugin, targetFile, siblings).open();
  };

  plugin.applyPreset = async (key: string): Promise<void> => {
    const preset = YAML_PRESETS[key];
    if (!preset) return;
    plugin.settings.mergeYamlPreset = key;
    await plugin.saveSettings();
  };

  plugin.mergeManyScenes = async (
    sources: TFile[],
    target: TFile,
    mergeMode = "heading",
    keepSeparator = true,
    localRules: Record<string, string> = {}
  ): Promise<void> => {
    const unit = plugin.unitLabel();
    if (!(target instanceof TFile) || sources.length === 0) {
      new Notice(`Aucune ${unit} à fusionner.`);
      return;
    }
    const joiner = keepSeparator ? plugin.settings.mergeNotesSeparator : "\n\n";
    let mergedCount = 0;
    for (const source of sources) {
      if (!(source instanceof TFile) || source.path === target.path) continue;
      try {
        const raw = await plugin.app.vault.read(source);
        const sourceBody = splitBody(raw);
        const sourceFm: Record<string, unknown> = Object.assign({}, plugin.fmOf(source));
        await plugin.app.fileManager.processFrontMatter(target, (fm: Record<string, unknown>) =>
          plugin.buildMergeYaml(
            fm,
            sourceFm,
            YAML_PRESETS[plugin.settings.mergeYamlPreset],
            localRules
          )
        );
        await plugin.app.vault.process(target, (current) => {
          const parts = splitFrontmatter(current);
          const fragment = buildMergedSection(source, sourceBody, mergeMode);
          const mergedBody =
            `${parts.body.trimEnd()}${joiner}${fragment}`.trim() + "\n";
          return parts.frontmatter
            ? `---\n${parts.frontmatter}\n---\n\n${mergedBody}`
            : mergedBody;
        });
        await plugin.app.vault.delete(source);
        mergedCount++;
      } catch (e) {
        console.error("Feuillets : échec de la fusion", e);
        new Notice(
          `Fusion interrompue après ${mergedCount} ${unit}(s) fusionnée(s) avec succès : ` +
            `échec sur « ${plugin.shortTitleFor(source)} ». Aucune autre ${unit} n'a été touchée.`
        );
        return;
      }
    }
    new Notice(`Fusion terminée dans : ${plugin.shortTitleFor(target)}`);
  };

  // 2. Register Ribbon Icon
  plugin.addRibbonIcon(
    "scissors-square-dashed-bottom",
    "Feuillets : Actions de scène",
    (evt) => {
      const file = plugin.getActiveFile();
      if (!file || !plugin.isSceneFile(file)) {
        new Notice("Ouvre une scène Feuillets.");
        return;
      }
      plugin.openSceneMenu(file, evt);
    }
  );

  // 3. Register Commands
  plugin.addCommand({
    id: "split-scene",
    name: "Scinder la scène",
    callback: async () => plugin.splitActiveScene(),
  });
  plugin.addCommand({
    id: "duplicate-scene",
    name: "Dupliquer la scène",
    callback: async () => plugin.duplicateActiveScene(),
  });
  plugin.addCommand({
    id: "move-scene",
    name: "Déplacer la scène",
    callback: async () => plugin.moveActiveScene(),
  });
  plugin.addCommand({
    id: "merge-selected-scenes",
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
      const file = view instanceof MarkdownView ? view.file : null;
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
        (f): f is TFile => f instanceof TFile && plugin.isSceneFile(f)
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
