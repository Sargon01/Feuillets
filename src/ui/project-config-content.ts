import { Modal, Notice, Setting, TFolder, TFile, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { MAPPABLE_FIELDS, rawFrontmatterOf } from "../services/frontmatter.js";
import {
  projectStatuses, projectFavoriteTags, projectWordGoalDefault, projectTolerance,
  projectTotalWordGoal, projectDeadline, projectSessionGoal,
} from "../services/project-settings.js";

export type ProjectConfigPage =
  | "goals"
  | "statuses"
  | "labels"
  | "tags"
  | "mapping";

/** Étiquette de rendu d'un champ mappable (§21). MAPPABLE_FIELDS
 * (services/frontmatter.ts) donne déjà l'ordre attendu par le mockup du
 * chantier (Synopsis, Résumé long, Statut, POV, Label, Objectif, Fil
 * narratif, Personnages, Date) — aucun second tableau d'ordre créé. */
function mappingFieldLabel(field: MappableFrontmatterField): string {
  return t(`sidebar.project.mappingField.${field}`);
}

export class YamlPropertyNameModal extends Modal {
  private onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: t("sidebar.project.mappingNewTitle") });
    const input = this.contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("sidebar.project.mappingNewName") },
    });
    input.addClass("feuillets-input-full");
    input.focus();

    const submit = (): void => {
      const name = input.value.trim();
      if (!name || name.includes("\n") || name.includes("\r")) {
        new Notice(t("sidebar.project.mappingNewInvalid"));
        return;
      }
      this.close();
      this.onSubmit(name);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });

    const buttons = this.contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("shared.cancel") }).addEventListener("click", () => this.close());
    const addButton = buttons.createEl("button", { text: t("sidebar.project.mappingNewAdd") });
    addButton.addClass("mod-cta");
    addButton.addEventListener("click", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Extraction UNIQUE de la logique de rendu des cinq pages de configuration
 * du projet, partagées entre SidebarFeuilletsView et ManageProjectsModal.
 * Centralisé pour éviter la duplication LOGIQUE (pas seulement visuelle) durant
 * la transition. */
export class ProjectConfigContent {
  app: App;
  plugin: ProjectConfigContentPlugin;
  requestRender: () => void;

  constructor(app: App, plugin: ProjectConfigContentPlugin, requestRender: () => void) {
    this.app = app;
    this.plugin = plugin;
    this.requestRender = requestRender;
  }

  /** Répartition stricte vers les cinq rendus existants. */
  renderPage(
    page: ProjectConfigPage,
    container: HTMLElement,
    path: string,
    root: TFolder,
  ): void {
    switch (page) {
      case "goals": this.renderProjectGoalsPage(container, path); break;
      case "statuses": this.renderProjectStatusesPage(container, path); break;
      case "labels": this.renderProjectLabelsPage(container, path); break;
      case "tags": this.renderProjectTagsPage(container, path); break;
      case "mapping": this.renderProjectMappingPage(container, path, root); break;
    }
  }

  /** Sous-page « Objectifs » (§9) : les cinq réglages historiques de
   * Paramètres → Projet, désormais surchargeables par projet — même valeur
   * EFFECTIVE que partout ailleurs (resolvers services/project-settings.ts).
   * Chaque champ affiche un bouton de réinitialisation UNIQUEMENT quand une
   * surcharge existe déjà pour CE projet (exigence de sécurité additionnelle
   * #4 du plan : jamais de copie de la valeur globale, seulement `delete`). */
  private renderProjectGoalsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowGoals") });

    const meta = (): ProjectMeta | undefined => S.projectMeta[path];
    const ensureMeta = (): ProjectMeta => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      return S.projectMeta[path];
    };
    const addReset = (setting: Setting, onReset: () => void): void => {
      setting.addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          onReset();
          void this.plugin.saveSettings();
          this.requestRender();
        })
      );
    };
    const numberRow = (
      label: string, desc: string | undefined,
      getValue: () => number, setValue: (n: number) => void,
      hasOverride: () => boolean, reset: () => void,
    ): void => {
      const setting = new Setting(section).setName(label);
      if (desc) setting.setDesc(desc);
      setting.addText((t2) =>
        t2.setValue(String(getValue())).onChange((v) => {
          const n = parseInt(v, 10);
          setValue(isNaN(n) ? 0 : Math.max(0, n));
          void this.plugin.saveSettings();
        })
      );
      if (hasOverride()) addReset(setting, reset);
    };

    numberRow(
      t("settings.wordGoal.name"), undefined,
      () => projectWordGoalDefault(this.app, S),
      (n) => { ensureMeta().wordGoal = n; },
      () => typeof meta()?.wordGoal === "number",
      () => { delete meta()!.wordGoal; },
    );
    numberRow(
      t("settings.tolerance.name"), undefined,
      () => projectTolerance(this.app, S),
      (n) => { ensureMeta().tolerance = n; },
      () => typeof meta()?.tolerance === "number",
      () => { delete meta()!.tolerance; },
    );
    numberRow(
      t("settings.projectWordGoal.name"), undefined,
      () => projectTotalWordGoal(this.app, S),
      (n) => { ensureMeta().projectWordGoal = n; },
      () => typeof meta()?.projectWordGoal === "number",
      () => { delete meta()!.projectWordGoal; },
    );
    numberRow(
      t("settings.sessionGoal.name"), undefined,
      () => projectSessionGoal(this.app, S),
      (n) => { ensureMeta().sessionGoal = n; },
      () => typeof meta()?.sessionGoal === "number",
      () => { delete meta()!.sessionGoal; },
    );

    // Date limite : texte libre AAAA-MM-JJ, pas un champ numérique — même
    // patron que l'ancien Paramètres → Projet.
    const deadlineSetting = new Setting(section)
      .setName(t("settings.deadline.name"));
    deadlineSetting.addText((t2) =>
      t2.setPlaceholder("AAAA-MM-JJ").setValue(projectDeadline(this.app, S)).onChange((v) => {
        ensureMeta().deadlineDate = v.trim();
        void this.plugin.saveSettings();
      })
    );
    if (typeof meta()?.deadlineDate === "string") {
      addReset(deadlineSetting, () => { delete meta()!.deadlineDate; });
    }
  }

  /** Sous-page « Statuts » (§6) : clone-on-first-edit — lire n'écrit jamais.
   * Tant qu'aucune modification réelle n'a eu lieu, la liste affichée EST
   * `settings.statuses` (repli global, via le resolver centralisé) ; le
   * premier changement clone cette liste dans `ProjectMeta.statuses`, qui
   * seul est ensuite modifié — jamais le tableau global. */
  private renderProjectStatusesPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowStatuses") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.statuses);
    const list = hasOverride ? S.projectMeta[path].statuses! : projectStatuses(this.app, S);
    const ensureOverride = (): ProjectStatusEntry[] => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      const meta = S.projectMeta[path];
      if (!meta.statuses) meta.statuses = JSON.parse(JSON.stringify(projectStatuses(this.app, S))) as ProjectStatusEntry[];
      return meta.statuses;
    };

    list.forEach((st, i) => {
      new Setting(section)
        .setName(String(i + 1))
        .addText((t2) =>
          t2.setValue(st.name || "").onChange((v) => {
            const arr = ensureOverride();
            arr[i].name = v.trim() || t("settings.statuses.item", { n: String(i + 1) });
            void this.plugin.saveSettings();
          })
        )
        .addColorPicker((c) =>
          c.setValue(st.color || "#888888").onChange((v) => {
            const arr = ensureOverride();
            arr[i].color = v;
            void this.plugin.saveSettings();
          })
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip(t("settings.statuses.deleteTooltip")).onClick(() => {
            const arr = ensureOverride();
            arr.splice(i, 1);
            void this.plugin.saveSettings();
            this.requestRender();
          })
        );
    });

    new Setting(section).addButton((b) =>
      b.setButtonText(t("settings.statuses.add")).onClick(() => {
        const arr = ensureOverride();
        arr.push({ name: t("settings.statuses.item", { n: String(arr.length + 1) }), color: "#888888" });
        void this.plugin.saveSettings();
        this.requestRender();
      })
    );

    if (hasOverride) {
      new Setting(section).setName(t("sidebar.project.resetToGlobal")).addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.statuses;
          void this.plugin.saveSettings();
          this.requestRender();
        })
      );
    }
  }

  /** Sous-page « Labels » (§7) : administration déplacée depuis l'ancien
   * Paramètres → Projet, MÊME comportement (nom/couleur/ajouter/supprimer),
   * même clone-on-first-edit que les statuts — aucun second système de
   * labels créé. */
  private renderProjectLabelsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowLabels") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.labels);
    const list = hasOverride ? S.projectMeta[path].labels! : (S.labels || []);
    const ensureOverride = (): Label[] => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      const meta = S.projectMeta[path];
      if (!meta.labels) meta.labels = JSON.parse(JSON.stringify(S.labels || [])) as Label[];
      return meta.labels;
    };

    list.forEach((l, i) => {
      new Setting(section)
        .setName(String(i + 1))
        .addText((t2) =>
          t2.setValue(l.name).onChange((v) => {
            const arr = ensureOverride();
            arr[i].name = v.trim() || t("settings.labels.item", { n: String(i + 1) });
            void this.plugin.saveSettings();
          })
        )
        .addColorPicker((c) =>
          c.setValue(l.color).onChange((v) => {
            const arr = ensureOverride();
            arr[i].color = v;
            void this.plugin.saveSettings();
          })
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip(t("settings.labels.deleteTooltip")).onClick(() => {
            const arr = ensureOverride();
            arr.splice(i, 1);
            void this.plugin.saveSettings();
            this.requestRender();
          })
        );
    });

    new Setting(section).addButton((b) =>
      b.setButtonText(t("settings.labels.add")).onClick(() => {
        const arr = ensureOverride();
        arr.push({ name: t("settings.labels.item", { n: String(arr.length + 1) }), color: "#888888" });
        void this.plugin.saveSettings();
        this.requestRender();
      })
    );

    if (hasOverride) {
      new Setting(section).setName(t("sidebar.project.resetToGlobal")).addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.labels;
          void this.plugin.saveSettings();
          this.requestRender();
        })
      );
    }
  }

  /** Sous-page « Tags » (§8) : administre UNIQUEMENT les tags favoris
   * proposés par Feuillets — jamais les tags Obsidian eux-mêmes, jamais de
   * second système de tags (voir services/frontmatter.ts tagsOf, inchangé). */
  private renderProjectTagsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowTags") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.favoriteTags);
    const setting = new Setting(section)
      .setName(t("settings.favoriteTags.name"))
      .addTextArea((t2) =>
        t2.setPlaceholder(t("settings.favoriteTags.placeholder")).setValue(projectFavoriteTags(this.app, S).join(", ")).onChange((v) => {
          if (!S.projectMeta[path]) S.projectMeta[path] = {};
          S.projectMeta[path].favoriteTags = [
            ...new Set(v.split(/[,\n]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean)),
          ];
          void this.plugin.saveSettings();
        })
      );
    if (hasOverride) {
      setting.addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.favoriteTags;
          void this.plugin.saveSettings();
          this.requestRender();
        })
      );
    }
  }

  /** Sous-page « Correspondance des propriétés » (§21-24 du chantier
   * « mapping YAML »). Aucun fichier Markdown n'est jamais modifié ici —
   * uniquement `meta.propertyMap`, voir applyMapping(). */
  private renderProjectMappingPage(container: HTMLElement, path: string, root: TFolder): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowMapping") });
    section.createDiv({ cls: "feuillets-notes-sub" }).setText(t("sidebar.project.mappingIntro"));

    const projectProperties = this.projectYamlPropertyNames(root);
    const projectSet = new Set(projectProperties);
    const otherVaultProperties = this.vaultYamlPropertyNames().filter((name) => !projectSet.has(name));
    const propertyMap = S.projectMeta[path]?.propertyMap || {};

    for (const field of MAPPABLE_FIELDS) {
      const current = propertyMap[field];
      const row = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
      row.createSpan({ cls: "feuillets-notes-section-title", text: mappingFieldLabel(field) });
      const select = row.createEl("select", { cls: "feuillets-properties-value" });
      select.setAttr("style", "margin-left: auto;");
      select.createEl("option", { value: "", text: t("sidebar.project.mappingDefault", { field: mappingFieldLabel(field) }) });
      this.addMappingOptions(select, t("sidebar.project.mappingProjectProperties"), projectProperties);
      this.addMappingOptions(select, t("sidebar.project.mappingOtherVaultProperties"), otherVaultProperties);
      if (current && !projectSet.has(current) && !otherVaultProperties.includes(current)) {
        select.createEl("option", { value: current, text: current });
      }
      select.createEl("option", { value: "__feuillets_new_yaml_property__", text: t("sidebar.project.mappingNewProperty") });
      select.value = current || "";
      select.addEventListener("change", () => {
        if (select.value === "__feuillets_new_yaml_property__") {
          select.value = current || "";
          new YamlPropertyNameModal(this.app, (name) => {
            this.applyMapping(path, field, name);
            this.requestRender();
          }).open();
          return;
        }
        this.applyMapping(path, field, select.value || undefined);
      });
    }
  }

  private addMappingOptions(select: HTMLSelectElement, label: string, properties: string[]): void {
    if (!properties.length) return;
    const group = select.createEl("optgroup", { attr: { label } });
    for (const property of properties) group.createEl("option", { value: property, text: property });
  }

  /** Propriétés YAML de premier niveau des fichiers Markdown du projet actif. */
  private projectYamlPropertyNames(root: TFolder): string[] {
    const files = this.plugin.flattenFiles(root).filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    const keys = new Set<string>();
    for (const f of files) {
      for (const key of Object.keys(rawFrontmatterOf(this.app, f))) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }

  /** Propriétés YAML de premier niveau de tous les Markdown du vault, via le cache. */
  private vaultYamlPropertyNames(): string[] {
    const keys = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      for (const key of Object.keys(rawFrontmatterOf(this.app, file))) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }

  /** §23 : écrit UNIQUEMENT `meta.propertyMap[field]` (ou le supprime,
   * §23 second cas) — jamais un fichier Markdown. §24 : refuse une
   * collision silencieuse (deux champs logiques → même propriété RAW). */
  private applyMapping(path: string, field: MappableFrontmatterField, target: string | undefined): void {
    const S = this.plugin.settings;
    if (!S.projectMeta[path]) S.projectMeta[path] = {};
    const meta = S.projectMeta[path];
    if (!target) {
      if (meta.propertyMap) {
        delete meta.propertyMap[field];
        if (Object.keys(meta.propertyMap).length === 0) delete meta.propertyMap;
      }
    } else {
      const map = meta.propertyMap || {};
      const collisionField = (Object.keys(map) as MappableFrontmatterField[]).find(
        (f) => f !== field && map[f] === target
      );
      if (collisionField) {
        new Notice(t("sidebar.project.mappingCollision", { target, field: mappingFieldLabel(collisionField) }));
        return;
      }
      if (!meta.propertyMap) meta.propertyMap = {};
      meta.propertyMap[field] = target;
    }
    void this.plugin.saveSettings();
    this.plugin.renderAllViews(true);
  }
}

type ProjectConfigContentPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  renderAllViews(force?: boolean): void;
  flattenFiles(folder: TFolder): readonly (TFile | TFolder)[];
};
