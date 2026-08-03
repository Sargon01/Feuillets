import { YAML_PRESETS } from "../scenes-editor.js";
import { BOARD_MODES, HIDEABLE_PANELS } from "../constants.js";
import { resolveType } from "../utils/project-modes.js";
import { NewProjectModal, ManageProjectsModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { LayoutModal } from "../ui/layout-modal.js";
import { setLocale, detectLocale, t } from "../i18n/index.js";
import { getProjectMode } from "../services/project-mode.js";
import { EXPORT_TEMPLATES } from "../utils/export-templates.js";
import type { DefaultSettings } from "../default-settings.js";
import { renderCategoryTabBar } from "./settings-category-tabs.js";
import {
  PluginSettingTab,
  Setting,
  TFolder,
  Notice,
  Menu,
  Platform,
  Plugin,
  type App,
  type SettingDefinitionItem,
} from "obsidian";

/* Union des réglages exhaustifs (default-settings.ts) et de l'interface
   globale partielle (types.d.ts) : ce panneau touche pratiquement tous
   les champs de réglages, contrairement aux autres fichiers migrés qui
   n'en étendent que quelques-uns localement. */
type SettingTabSettings = FeuilletsSettings & DefaultSettings & {
  /* Ni dans FeuilletsSettings (types.d.ts) ni dans DEFAULT_SETTINGS
     (default-settings.ts) : champs sans valeur par défaut, toujours lus
     avec un repli (|| "..."/|| []) dans ce fichier. */
  compileFileName?: string;
  favoriteTags?: string[];
};

type ProjectMode = ReturnType<typeof getProjectMode>;

/* app.setting (panneau de réglages) est une API interne d'Obsidian, non
   déclarée dans obsidian.d.ts — déjà utilisée en best-effort (try/catch)
   dans le code d'origine. */
type SettingTabComponent = { setValue(v: string): void; onChanged(): void };
type SettingsModal = {
  openTabById(id: string): void;
  activeTab?: { searchComponent?: SettingTabComponent };
};
type AppWithSettingTab = { setting: SettingsModal };

/* Toutes ces méthodes sont de vraies méthodes de classe de FeuilletsPlugin
   (main.js), pas des attachements dynamiques — mais PluginSettingTab type
   son constructeur en `plugin: Plugin` (classe Obsidian réelle), pas via
   le JSDoc de main.js comme BaseFeuilletsView : on retrouve donc ici le
   patron Plugin & {...} déjà utilisé pour ScenesEditorPlugin/BoardViewPlugin
   plutôt que ConstructorParameters. */
type FeuilletsSettingTabPlugin = Omit<Plugin, "settings"> & {
  settings: SettingTabSettings;
  projectMode(): ProjectMode;
  unitLabel(): string;
  unitLabelPlural(): string;
  projectDisplayName(path: string): string;
  getProjectFolder(): TFolder | null;
  chapterCount(root: TFolder): number;
  saveSettings(): Promise<void>;
  updateStatusBar(): void;
  renderAllViews(force?: boolean): void;
  createDemoProject(kind: string): Promise<void>;
  refreshView(delay?: number): void;
  refreshRibbonIcons(): void;
  applyLiveTypoClasses(): void;
  applyIndentClass(): void;
  applyLeanInterfaceClasses(): void;
  removeConcentrationCounter(): void;
  getVaultConfig(key: string): unknown;
  setVaultConfig(key: string, value: unknown): void;
  backupProjectNow(): Promise<void>;
  hidePanel(key: string): Promise<void>;

  /* Requis par les modales déjà migrées ouvertes depuis ce panneau
     (ManageProjectsModal, NewProjectModal, ScrivenerImportModal) — mêmes
     signatures que ProjectModalsPlugin/ScrivenerImportPlugin. */
  ensureFolder(path: string): Promise<import("obsidian").TAbstractFile>;
  initProjectStructure(): Promise<void>;
  getOutputFolder(): Promise<import("obsidian").TAbstractFile | null>;
  duplicateProject(path: string, label: string): Promise<string | null>;
  writeOrder(parent: import("obsidian").TAbstractFile, orderedChildren: import("obsidian").TAbstractFile[]): Promise<void>;
};

/* Migré vers l'API déclarative `getSettingDefinitions()` (Obsidian ≥ 1.13.0,
   voir manifest.json). La barre d'onglets persistante par catégorie
   (Projet/Écriture/Interface/Panneaux latéraux/Correction/Export) est
   reconstruite « à la main » dans un item `render()` (composant isolé
   `settings-category-tabs.ts`) plutôt qu'avec la navigation native en
   profondeur (`SettingDefinitionPage`) : cette dernière n'offre aucun moyen
   documenté d'ouvrir une page précise par programme, ce qui aurait cassé
   l'ouverture directe sur « Export » depuis PreviewView/ProjectView (voir
   open-export-settings.ts). `_activeSettingsTab` reste la seule source de
   vérité, `this.update()` remplace tous les anciens `this.display()`.

   `setDynamicTooltip()` (sliders) reste appelé : minAppVersion valant
   désormais 1.13.0, ces appels sont devenus sans effet (la valeur du
   curseur est toujours affichée) mais inoffensifs — suppression possible
   séparément, non faite ici pour rester au périmètre de cette migration. */
export class FeuilletsSettingTab extends PluginSettingTab {
  plugin: FeuilletsSettingTabPlugin;
  _activeSettingsTab?: string;

  constructor(app: App, plugin: FeuilletsSettingTabPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** En-tête du panneau (titre, accroche, liens) — affiché une seule fois,
   * indépendamment de la catégorie active. */
  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "feuillets-settings-header" });
    /* Un div, pas un h2 : l'apparence est entièrement définie par
       .feuillets-settings-title (taille, graisse, marges, couleur), rien
       n'y dépend des styles par défaut d'un titre — et l'ESLint officiel
       d'Obsidian interdit les éléments de titre créés à la main dans un
       onglet de réglages. */
    header.createDiv({ cls: "feuillets-settings-title", text: "Feuillets" });
    header.createDiv({ cls: "feuillets-settings-tagline" }).setText(t("settings.tagline"));
    const links = header.createDiv({ cls: "feuillets-settings-links" });
    const REPO = "https://github.com/Sargon01/Feuillets";
    links.createEl("a", { text: t("settings.links.github"), href: REPO, attr: { target: "_blank", rel: "noopener" } });
    links.createEl("a", { text: t("settings.links.readme"), href: `${REPO}/blob/main/README.md`, attr: { target: "_blank", rel: "noopener" } });
    links.createEl("a", { text: t("settings.links.features"), href: `${REPO}/blob/main/docs/FONCTIONNALITES.md`, attr: { target: "_blank", rel: "noopener" } });
  }

  /** API déclarative (Obsidian ≥ 1.13.0) : un tableau non vide fait qu'Obsidian
   * n'appelle plus jamais `display()` lui-même (voir le compatibilité shim
   * plus bas, seul point qui en dépend encore). Structure : en-tête, barre
   * d'onglets (composant isolé `settings-category-tabs.ts`), puis six groupes
   * — un par catégorie — dont la visibilité suit `_activeSettingsTab`, seule
   * source de vérité. Chaque groupe délègue à une méthode `renderXCategory`
   * qui reprend, quasiment inchangé, le code de contrôle historique. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const ORDER = ["Projet", "Écriture", "Interface", "Panneaux latéraux", "Correction", "Export"];
    const CATEGORY_LABELS: Record<string, string> = {
      "Projet": t("settings.category.project"),
      "Écriture": t("settings.category.writing"),
      "Interface": t("settings.category.interface"),
      "Panneaux latéraux": t("settings.category.sidePanels"),
      "Correction": t("settings.category.grammar"),
      "Export": t("settings.category.export"),
    };
    if (!this._activeSettingsTab || !ORDER.includes(this._activeSettingsTab)) {
      this._activeSettingsTab = ORDER[0];
    }

    const categoryRenderers: Record<string, (container: HTMLElement) => void> = {
      "Projet": (c) => this.renderProjetCategory(c),
      "Écriture": (c) => this.renderEcritureCategory(c),
      "Interface": (c) => this.renderInterfaceCategory(c),
      "Panneaux latéraux": (c) => this.renderPanneauxCategory(c),
      "Correction": (c) => this.renderCorrectionCategory(c),
      "Export": (c) => this.renderExportCategory(c),
    };

    const items: SettingDefinitionItem[] = [
      { name: "", render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.removeClass("setting-item");
        this.renderHeader(setting.settingEl);
      } },
      { name: "", render: (setting) => {
        try {
          setting.settingEl.empty();
          setting.settingEl.removeClass("setting-item");
          renderCategoryTabBar(setting.settingEl, {
            categories: ORDER,
            labels: CATEGORY_LABELS,
            active: this._activeSettingsTab || ORDER[0],
            onSelect: (name) => {
              if (this._activeSettingsTab === name) return;
              this._activeSettingsTab = name;
              this.update();
            },
          });
        } catch (e) {
          // Repli : jamais bloquer l'accès aux réglages pour un problème de
          // rendu de la barre — les groupes ci-dessous restent fonctionnels
          // quel que soit _activeSettingsTab (par défaut "Projet").
          console.error("Feuillets : échec du rendu de la barre d'onglets", e);
          setting.settingEl.empty();
          setting.settingEl.createDiv({
            cls: "setting-item-description",
            text: "Barre d'onglets indisponible — les réglages restent accessibles ci-dessous.",
          });
        }
      } },
    ];

    for (const name of ORDER) {
      items.push({
        type: "group",
        heading: CATEGORY_LABELS[name],
        visible: () => this._activeSettingsTab === name,
        items: [
          { name: "", render: (setting) => {
            setting.settingEl.empty();
            setting.settingEl.removeClass("setting-item");
            categoryRenderers[name](setting.settingEl);
          } },
        ],
      });
    }

    return items;
  }

  private renderProjetCategory(container: HTMLElement): void {
    const S = this.plugin.settings;
    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();
    const refresh = () => this.plugin.refreshView();

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.projectFolder") });


    const allProjects = (S.projects || []).concat(S.projectFolder ? [S.projectFolder] : [])
      .filter((p, i, a) => p && a.indexOf(p) === i)
      .sort((a, b) =>
        this.plugin.projectDisplayName(a).localeCompare(
          this.plugin.projectDisplayName(b), "fr", { sensitivity: "base" }
        )
      );

    // Dropdown pour choisir le projet actif
    new Setting(container)
      .setName(t("settings.activeProject.name"))
      .setDesc(t("settings.activeProject.desc"))
      .addDropdown((d) => {
        d.addOption("", t("settings.activeProject.none"));
        for (const p of allProjects) {
          const folderObj = this.app.vault.getAbstractFileByPath(p);
          const exists = folderObj instanceof TFolder;
          d.addOption(
            p,
            exists
              ? this.plugin.projectDisplayName(p)
              : t("settings.activeProject.notFound", { name: this.plugin.projectDisplayName(p) })
          );
        }
        d.setValue(S.projectFolder || "");
        d.onChange(async (v) => {
          if (v && !(this.app.vault.getAbstractFileByPath(v) instanceof TFolder)) {
            new Notice(t("settings.activeProject.folderGoneNotice", { path: v }));
            d.setValue(S.projectFolder || "");
            return;
          }
          S.projectFolder = v;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
          this.plugin.renderAllViews(true);
          this.update();
        });
      });

    // Champ texte pour saisir / éditer le chemin directement
    new Setting(container)
      .setName(t("settings.projectPath.name"))
      .setDesc(t("settings.projectPath.desc"))
      .addText((tx) => {
        tx.setValue(S.projectFolder || "");
        tx.setPlaceholder("Roman1/Manuscrit");
        tx.onChange(async (v) => {
          const val = v.trim();
          S.projectFolder = val;
          if (val && !(S.projects || []).includes(val)) {
            if (!S.projects) S.projects = [];
            S.projects.push(val);
          }
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
          this.plugin.renderAllViews(true);
        });
      });

    // Boutons d'actions rapides (Créer, Importer Scrivener, Gérer la liste)
    const btnSetting = new Setting(container)
      .setName(t("settings.projectActions.name"))
      .setDesc(t("settings.projectActions.desc"));

    btnSetting.addButton((b) => {
      b.setButtonText(t("settings.projectActions.create"))
        .setCta()
        .onClick(() => {
          new NewProjectModal(this.app, this.plugin).open();
        });
    });

    btnSetting.addButton((b) => {
      b.setButtonText(t("settings.projectActions.importScrivener"))
        .onClick(() => {
          new ScrivenerImportModal(this.app, this.plugin).open();
        });
    });

    btnSetting.addButton((b) => {
      b.setButtonText(t("settings.projectActions.manageList"))
        .onClick(() => {
          new ManageProjectsModal(this.app, this.plugin).open();
        });
    });

    /* garde-fou : un dossier projet mal pointé (ex. un cran trop haut,
       contenant _Recherche/_Snapshots à côté du vrai manuscrit) ne casse
       rien silencieusement — un avertissement explicite apparaît ici. */
    const root = this.plugin.getProjectFolder();
    if (root) {
      const count = this.plugin.chapterCount(root);
      if (count === 0) {
        const warn = container.createDiv({ cls: "feuillets-empty" });
        warn.addClass("feuillets-settings-warning");
        warn.setText(t("settings.emptyProjectWarning", { name: root.name }));
      }
      if (!S.projectMeta) S.projectMeta = {};
      if (!S.projectMeta[root.path]) {
        S.projectMeta[root.path] = { type: "fiction" };
      }
      const meta = S.projectMeta[root.path];
      if (!meta.labels) {
        meta.labels = JSON.parse(JSON.stringify(S.labels || [])) as Label[];
      }

      new Setting(container)
        .setName(t("settings.projectType.name"))
        .setDesc(t("settings.projectType.desc"))
        .addDropdown((d) => {
          d.addOption("fiction", t("settings.projectType.fiction"));
          d.addOption("nonfiction", t("settings.projectType.nonfiction"));
          d.setValue(resolveType(meta.type))
           .onChange(async (v) => {
             meta.type = v;
             await this.plugin.saveSettings();
             this.update(); // Recharger le panneau
             this.plugin.renderAllViews(true);
             refresh();
           });
        });

      if (resolveType(meta.type) === "nonfiction") {
        new Setting(container)
          .setName(t("settings.citationStyle.name"))
          .setDesc(t("settings.citationStyle.desc"))
          .addDropdown((d) =>
            d
              .addOption("footnote", t("settings.citationStyle.footnote"))
              .addOption("parenthetical", t("settings.citationStyle.parenthetical"))
              .setValue(meta.citationStyle || "footnote")
              .onChange(async (v) => {
                meta.citationStyle = v;
                await this.plugin.saveSettings();
              })
          );
      }
    }

    new Setting(container)
      .setName(t("settings.chronoFolder.name"))
      .setDesc(t("settings.chronoFolder.desc"))
      .addText((t2) =>
        t2.setValue(S.chronoFolder).onChange(async (v) => {
          S.chronoFolder = v.trim() || "Recherche/Chronologie";
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.journalFolder.name"))
      .setDesc(t("settings.journalFolder.desc"))
      .addText((t2) =>
        t2.setValue(S.journalFolder).onChange(async (v) => {
          S.journalFolder = v.trim() || "Journal";
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.demoProject.name"))
      .setDesc(t("settings.demoProject.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.demoProject.name")).onClick((e) => {
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle(t("settings.demoProject.elira")).onClick(async () => {
              await this.plugin.createDemoProject("elira");
              this.update();
            })
          );
          menu.addItem((item) =>
            item
              .setTitle(t("settings.demoProject.candide"))
              .onClick(async () => {
                await this.plugin.createDemoProject("candide");
                this.update();
              })
          );
          menu.showAtMouseEvent(e);
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.numbering") });


    new Setting(container)
      .setName(t("settings.level1Role.name"))
      .setDesc(t("settings.level1Role.desc"))
      .addDropdown((d) =>
        d
          .addOption("parties", t("settings.level1Role.parts"))
          .addOption("chapitres", t("settings.level1Role.chapters", { unitPlural }))
          .setValue(S.level1Role)
          .onChange(async (v) => {
            S.level1Role = v as DefaultSettings["level1Role"];
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.chapterNumbering.name"))
      .setDesc(t("settings.chapterNumbering.desc"))
      .addDropdown((d) =>
        d
          .addOption("continu", t("settings.chapterNumbering.continuous"))
          .addOption("parPartie", t("settings.chapterNumbering.perPart"))
          .addOption("aucune", t("settings.chapterNumbering.none"))
          .setValue(S.chapterNumbering)
          .onChange(async (v) => {
            S.chapterNumbering = v as DefaultSettings["chapterNumbering"];
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.sceneNumbering.name", { unitPlural }))
      .setDesc(t("settings.sceneNumbering.desc"))
      .addDropdown((d) =>
        d
          .addOption("hier", t("settings.sceneNumbering.hierarchical", { unit }))
          .addOption("continue", t("settings.sceneNumbering.continuous"))
          .addOption("aucune", t("settings.chapterNumbering.none"))
          .setValue(S.sceneNumbering)
          .onChange(async (v) => {
            S.sceneNumbering = v as DefaultSettings["sceneNumbering"];
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.autoRename.name"))
      .setDesc(t("settings.autoRename.desc"))
      .addToggle((t2) =>
        t2.setValue(S.autoRename).onChange(async (v) => {
          S.autoRename = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container).setName(t("settings.renamePrefix.name")).addText((t2) =>
      t2.setValue(S.renamePrefix).onChange(async (v) => {
        S.renamePrefix = v.trim() || "chapitre";
        await this.plugin.saveSettings();
      })
    );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.statusesLabels") });


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.statusesLabels.intro")
    );

    container.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.statuses.title"));

    if (!Array.isArray(S.statuses)) S.statuses = [];
    S.statuses.forEach((st, i) => {
      new Setting(container)
        .setName(t("settings.statuses.item", { n: String(i + 1) }))
        .addText((t2) =>
          t2.setValue(st.name).onChange(async (v) => {
            st.name = v.trim() || t("settings.statuses.item", { n: String(i + 1) });
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addColorPicker((c) =>
          c.setValue(st.color || "#888888").onChange(async (v) => {
            st.color = v;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip(t("settings.statuses.deleteTooltip"))
            .onClick(async () => {
              S.statuses.splice(i, 1);
              await this.plugin.saveSettings();
              this.update();
              refresh();
            })
        );
    });

    new Setting(container).addButton((b) =>
      b.setButtonText(t("settings.statuses.add")).onClick(async () => {
        S.statuses.push({ name: t("settings.statuses.item", { n: String(S.statuses.length + 1) }), color: "#888888" });
        await this.plugin.saveSettings();
        this.update();
      })
    );

    const currentMeta = root ? S.projectMeta[root.path] : null;
    const projectLabels = currentMeta && currentMeta.labels ? currentMeta.labels : S.labels;

    if (root) {
      container.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.labels.titleForProject", { name: root.name }));
    }

    (projectLabels || []).forEach((l, i) => {
      new Setting(container)
        .setName(t("settings.labels.item", { n: String(i + 1) }))
        .addText((t2) =>
          t2.setValue(l.name).onChange(async (v) => {
            l.name = v.trim() || t("settings.labels.item", { n: String(i + 1) });
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addColorPicker((c) =>
          c.setValue(l.color).onChange(async (v) => {
            l.color = v;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip(t("settings.labels.deleteTooltip"))
            .onClick(async () => {
              projectLabels.splice(i, 1);
              await this.plugin.saveSettings();
              this.update();
              refresh();
            })
        );
    });

    new Setting(container).addButton((b) =>
      b.setButtonText(t("settings.labels.add")).onClick(async () => {
        projectLabels.push({ name: t("settings.labels.item", { n: String(projectLabels.length + 1) }), color: "#888888" });
        await this.plugin.saveSettings();
        this.update();
      })
    );

    new Setting(container)
      .setName(t("settings.favoriteTags.name"))
      .setDesc(t("settings.favoriteTags.desc"))
      .addTextArea((t2) =>
        t2
          .setValue((S.favoriteTags || []).join(", "))
          .onChange(async (v) => {
            S.favoriteTags = [
              ...new Set(
                v
                  .split(/[,\n]+/)
                  .map((x) => x.replace(/^#/, "").trim())
                  .filter(Boolean)
              ),
            ];
            await this.plugin.saveSettings();
          })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.goals") });


    new Setting(container)
      .setName(t("settings.wordGoal.name", { unit }))
      .addText((t2) =>
        t2.setValue(String(S.wordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.wordGoal = isNaN(n) ? 0 : n;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container).setName(t("settings.tolerance.name")).addText((t2) =>
      t2.setValue(String(S.tolerance)).onChange(async (v) => {
        const n = parseInt(v, 10);
        S.tolerance = isNaN(n) ? 0 : Math.max(0, n);
        await this.plugin.saveSettings();
        refresh();
      })
    );

    new Setting(container)
      .setName(t("settings.projectWordGoal.name"))
      .setDesc(t("settings.projectWordGoal.desc"))
      .addText((t2) =>
        t2.setValue(String(S.projectWordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.projectWordGoal = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.deadline.name"))
      .setDesc(t("settings.deadline.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("AAAA-MM-JJ")
          .setValue(S.deadlineDate || "")
          .onChange(async (v) => {
            S.deadlineDate = v.trim();
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.sessionGoal.name"))
      .setDesc(t("settings.sessionGoal.desc"))
      .addText((t2) =>
        t2.setValue(String(S.sessionGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.sessionGoal = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.history") });


    new Setting(container)
      .setName(t("settings.statsRetention.name"))
      .setDesc(t("settings.statsRetention.desc"))
      .addText((t2) =>
        t2.setValue(String(S.statsRetention)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.statsRetention = isNaN(n) ? 120 : Math.max(0, n);
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.backup") });


    new Setting(container)
      .setName(t("settings.backupEnabled.name"))
      .setDesc(t("settings.backupEnabled.desc"))
      .addToggle((t2) =>
        t2.setValue(S.backupEnabled).onChange(async (v) => {
          S.backupEnabled = v;
          await this.plugin.saveSettings();
          this.update();
        })
      );

    if (S.backupEnabled) {
      new Setting(container)
        .setName(t("settings.backupInterval.name"))
        .addText((t2) =>
          t2.setValue(String(S.backupIntervalMinutes)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupIntervalMinutes = isNaN(n) ? 30 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(container)
        .setName(t("settings.backupKeepCount.name"))
        .setDesc(t("settings.backupKeepCount.desc"))
        .addText((t2) =>
          t2.setValue(String(S.backupKeepCount)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupKeepCount = isNaN(n) ? 5 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(container)
        .setName(t("settings.backupNow.name"))
        .addButton((b) =>
          b.setButtonText(t("settings.backupNow.btn")).onClick(() => this.plugin.backupProjectNow())
        );
    }

  }
  private renderEcritureCategory(container: HTMLElement): void {
    const S = this.plugin.settings;

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.liveTypography") });


    new Setting(container)
      .setName(t("settings.indentParagraphs.name"))
      .setDesc(t("settings.indentParagraphs.desc"))
      .addToggle((t2) =>
        t2.setValue(S.indentParagraphs).onChange(async (v) => {
          S.indentParagraphs = v;
          await this.plugin.saveSettings();
          this.plugin.applyIndentClass();
        })
      );

    new Setting(container)
      .setName(t("settings.liveApostrophe.name"))
      .setDesc(t("settings.liveApostrophe.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveApostrophe).onChange(async (v) => {
          S.liveApostrophe = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.liveGuillemets.name"))
      .setDesc(t("settings.liveGuillemets.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveGuillemets).onChange(async (v) => {
          S.liveGuillemets = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.liveDashes.name"))
      .setDesc(t("settings.liveDashes.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveDashes).onChange(async (v) => {
          S.liveDashes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.liveTwoEnters.name"))
      .setDesc(t("settings.liveTwoEnters.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveTwoEnters).onChange(async (v) => {
          S.liveTwoEnters = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.liveDoubleEnter.name"))
      .setDesc(t("settings.liveDoubleEnter.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveDoubleEnter).onChange(async (v) => {
          S.liveDoubleEnter = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.liveEmptyLines.name"))
      .setDesc(t("settings.liveEmptyLines.desc"))
      .addDropdown((d) =>
        d
          .addOption("normal", t("settings.liveEmptyLines.normal"))
          .addOption("reduit", t("settings.liveEmptyLines.reduced"))
          .addOption("invisible", t("settings.liveEmptyLines.invisible"))
          .setValue(S.liveEmptyLines)
          .onChange(async (v) => {
            S.liveEmptyLines = v as DefaultSettings["liveEmptyLines"];
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          })
      );

    new Setting(container)
      .setName(t("settings.liveHyphenation.name"))
      .setDesc(t("settings.liveHyphenation.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveHyphenation).onChange(async (v) => {
          S.liveHyphenation = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.liveJustify.name"))
      .setDesc(t("settings.liveJustify.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveJustify).onChange(async (v) => {
          S.liveJustify = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.readingMatchLive.name"))
      .setDesc(t("settings.readingMatchLive.desc"))
      .addToggle((t2) =>
        t2.setValue(S.readingMatchLive !== false).onChange(async (v) => {
          S.readingMatchLive = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.readingFontSize.name"))
      .setDesc(t("settings.readingFontSize.desc"))
      .addSlider((s) =>
        s
          .setLimits(0, 28, 1)
          .setValue(S.readingFontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.readingFontSize = v;
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.sceneMerge") });


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.sceneMerge.intro")
    );

    new Setting(container)
      .setName(t("settings.mergeYamlPreset.name"))
      .setDesc(t("settings.mergeYamlPreset.desc"))
      .addDropdown((drop) => {
        Object.entries(YAML_PRESETS).forEach(([key, item]) => {
          drop.addOption(key, item.label);
        });
        drop.setValue(S.mergeYamlPreset);
        drop.onChange(async (value) => {
          S.mergeYamlPreset = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName(t("settings.mergeMode.name"))
      .setDesc(t("settings.mergeMode.desc"))
      .addDropdown((drop) => {
        drop.addOption("heading", t("settings.mergeMode.heading"));
        drop.addOption("comment", t("settings.mergeMode.comment"));
        drop.addOption("continuous", t("settings.mergeMode.continuous"));
        drop.setValue(S.mergeModeDefault);
        drop.onChange(async (value) => {
          S.mergeModeDefault = value as DefaultSettings["mergeModeDefault"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName(t("settings.autoAnalyzeInRelecture.name"))
      .setDesc(t("settings.autoAnalyzeInRelecture.desc"))
      .addToggle((toggle) => {
        toggle.setValue(S.autoAnalyzeInRelecture !== false);
        toggle.onChange(async (value) => {
          S.autoAnalyzeInRelecture = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName(t("settings.mergeKeepSeparator.name"))
      .addToggle((toggle) => {
        toggle.setValue(S.mergeKeepSeparatorDefault);
        toggle.onChange(async (value) => {
          S.mergeKeepSeparatorDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName(t("settings.mergeSeparator.name"))
      .setDesc(t("settings.mergeSeparator.desc"))
      .addTextArea((area) => {
        area.setValue(S.mergeNotesSeparator);
        area.inputEl.rows = 3;
        area.inputEl.addClass("feuillets-input-full");
        area.onChange(async (value) => {
          S.mergeNotesSeparator = value;
          await this.plugin.saveSettings();
        });
      });

  }
  private renderInterfaceCategory(container: HTMLElement): void {
    const S = this.plugin.settings;
    const refresh = () => this.plugin.refreshView();

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.appearance") });


    new Setting(container)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("settings.language.auto"))
          .addOption("fr", "Français")
          .addOption("en", "English")
          .setValue(S.language || "auto")
          .onChange(async (v) => {
            S.language = v as DefaultSettings["language"];
            await this.plugin.saveSettings();
            setLocale(detectLocale(S));
            this.plugin.renderAllViews(true);
            this.plugin.refreshRibbonIcons();
            this.update();
          })
      );

    new Setting(container)
      .setName(t("settings.fontSize.name"))
      .addSlider((s) =>
        s
          .setLimits(10, 22, 1)
          .setValue(S.fontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.fontSize = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.uiScale.name"))
      .addSlider((s) =>
        s
          .setLimits(60, 160, 5)
          .setValue(S.uiScale)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.uiScale = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.lineHeight.name"))
      .setDesc(t("settings.lineHeight.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.step = "0.05";
        t2.inputEl.min = "0";
        t2
          .setValue(S.lineHeight ? String(S.lineHeight) : "")
          .setPlaceholder(t("settings.lineHeight.placeholder"))
          .onChange(async (v) => {
            const n = parseFloat(v);
            S.lineHeight = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          });
      });

    new Setting(container)
      .setName(t("settings.textWidth.name"))
      .setDesc(t("settings.textWidth.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.step = "10";
        t2.inputEl.min = "0";
        t2
          .setValue(S.textWidth ? String(S.textWidth) : "")
          .setPlaceholder(t("settings.textWidth.placeholder"))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            S.textWidth = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          });
      });

    new Setting(container)
      .setName(t("settings.baseFontSize.name"))
      .addSlider((sl) => {
        const current = this.plugin.getVaultConfig("baseFontSize");
        sl.setLimits(12, 28, 1)
          .setValue(typeof current === "number" ? current : 16)
          .setDynamicTooltip()
          .onChange((v) => this.plugin.setVaultConfig("baseFontSize", v));
      });

    new Setting(container)
      .setName(t("settings.textFontFamily.name"))
      .setDesc(t("settings.textFontFamily.desc"))
      .addText((t2) =>
        t2.setValue(String((this.plugin.getVaultConfig("textFontFamily") as string | number | boolean | null | undefined) || "")).onChange((v) => {
          this.plugin.setVaultConfig("textFontFamily", v.trim());
        })
      );

    new Setting(container)
      .setName(t("settings.monospaceFontFamily.name"))
      .addText((t2) =>
        t2.setValue(String((this.plugin.getVaultConfig("monospaceFontFamily") as string | number | boolean | null | undefined) || "")).onChange((v) => {
          this.plugin.setVaultConfig("monospaceFontFamily", v.trim());
        })
      );

    new Setting(container)
      .setName(t("settings.accentColor.name"))
      .addColorPicker((cp) => {
        const current = this.plugin.getVaultConfig("accentColor");
        if (typeof current === "string" && current) cp.setValue(current);
        cp.onChange((v) => this.plugin.setVaultConfig("accentColor", v));
      });

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.focusMode") });


     new Setting(container)
      .setName(t("settings.focusUnit.name"))
      .setDesc(t("settings.focusUnit.desc"))
      .addDropdown((d) =>
        d
          .addOption("line", t("settings.focusUnit.line"))
          .addOption("paragraph", t("settings.focusUnit.paragraph"))
          .setValue(S.concentrationUnit)
          .onChange(async (v) => {
            S.concentrationUnit = v as DefaultSettings["concentrationUnit"];
            await this.plugin.saveSettings();
          })
      );

     new Setting(container)
      .setName(t("settings.typewriterScroll.name"))
      .setDesc(t("settings.typewriterScroll.desc"))
      .addToggle((t2) =>
        t2.setValue(S.concentrationTypewriter).onChange(async (v) => {
          S.concentrationTypewriter = v;
          await this.plugin.saveSettings();
        })
      );

     new Setting(container)
      .setName(t("settings.floatingCounter.name"))
      .setDesc(t("settings.floatingCounter.desc"))
      .addToggle((t2) =>
        t2.setValue(S.concentrationCounter).onChange(async (v) => {
          S.concentrationCounter = v;
          await this.plugin.saveSettings();
          if (!v) this.plugin.removeConcentrationCounter();
        })
      );

     new Setting(container)
      .setName(t("settings.dimOpacity.name"))
      .addSlider((sl) =>
        sl
          .setLimits(10, 80, 5)
          .setValue(S.dimOpacity)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.dimOpacity = v;
            await this.plugin.saveSettings();
            document.body.style.setProperty(
               "--feuillets-dim-opacity",
              `${v / 100}`
            );
          })
      );

     new Setting(container)
      .setName(t("settings.concentrationWidth.name"))
      .addSlider((sl) =>
        sl
          .setLimits(480, 1000, 20)
          .setValue(S.concentrationWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.concentrationWidth = v;
            await this.plugin.saveSettings();
            document.body.style.setProperty(
               "--feuillets-concentration-width",
              `${v}px`
            );
          })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.leanInterface") });

    container.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.leanInterface.desc"));

    new Setting(container)
      .setName(t("settings.leanInterface.suggestedValues.name"))
      .setDesc(t("settings.leanInterface.suggestedValues.desc"))
      .addButton((btn) =>
        btn.setButtonText(t("settings.leanInterface.suggestedValues.btn")).onClick(async () => {
          this.plugin.setVaultConfig("propertiesInDocument", "hidden");
          this.plugin.setVaultConfig("showInlineTitle", false);
          this.plugin.setVaultConfig("showViewHeader", false);
          this.plugin.setVaultConfig("showRibbon", false);
          this.plugin.setVaultConfig("baseFontSize", 19);
          this.plugin.setVaultConfig("textFontFamily", "iA Writer Quattro S");
          this.plugin.setVaultConfig("monospaceFontFamily", "iA Writer Mono S");
          this.plugin.setVaultConfig("accentColor", "#c1a777");
          S.uiTransparentPanels = true;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
          new Notice(t("settings.leanInterface.suggestedValues.applied"));
          this.update();
        })
      );

    new Setting(container)
      .setName(t("settings.hideProperties.name"))
      .setDesc(t("settings.hideProperties.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("propertiesInDocument") === "hidden").onChange((v) => {
          this.plugin.setVaultConfig("propertiesInDocument", v ? "hidden" : "visible");
        })
      );

    new Setting(container)
      .setName(t("settings.hideInlineTitle.name"))
      .setDesc(t("settings.hideInlineTitle.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showInlineTitle") === false).onChange((v) => {
          this.plugin.setVaultConfig("showInlineTitle", !v);
        })
      );

    new Setting(container)
      .setName(t("settings.hideTabHeader.name"))
      .setDesc(t("settings.hideTabHeader.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showViewHeader") === false).onChange((v) => {
          this.plugin.setVaultConfig("showViewHeader", !v);
        })
      );


    new Setting(container)
      .setName(t("settings.hideRibbon.name"))
      .setDesc(t("settings.hideRibbon.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showRibbon") === false).onChange((v) => {
          this.plugin.setVaultConfig("showRibbon", !v);
        })
      );


    new Setting(container)
      .setName(t("settings.transparentPanels.name"))
      .setDesc(t("settings.transparentPanels.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiTransparentPanels).onChange(async (v) => {
          S.uiTransparentPanels = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.transparentTabBar.name"))
      .setDesc(t("settings.transparentTabBar.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiTransparentTabBar).onChange(async (v) => {
          S.uiTransparentTabBar = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.hideVaultSwitcher.name"))
      .setDesc(t("settings.hideVaultSwitcher.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiHideVaultSwitcher).onChange(async (v) => {
          S.uiHideVaultSwitcher = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(container)
      .setName(t("settings.dimTabActions.name"))
      .setDesc(t("settings.dimTabActions.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiDimTabActions).onChange(async (v) => {
          S.uiDimTabActions = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.leanInterface.goFurther"));
    const goFurther = container.createDiv({ cls: "feuillets-tags" });
    this.storeLinkButton(goFurther, t("settings.leanInterface.themeMinimal"), () => this.openAppearanceTab());
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginHider"), () => this.openCommunityPluginsSearch("Hider"));
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginStyleSettings"), () => this.openCommunityPluginsSearch("Style Settings"));
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginMinimalSettings"), () => this.openCommunityPluginsSearch("Minimal Theme Settings"));

  }
  private renderPanneauxCategory(container: HTMLElement): void {
    const S = this.plugin.settings;
    const mode = this.plugin.projectMode();
    const unit = this.plugin.unitLabel();
    const refresh = () => this.plugin.refreshView();
    const root = this.plugin.getProjectFolder();

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.boardPanel") });


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.boardPanel.intro")
    );

    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.boardPanel.arcsIntro", { unit })
    );

    new Setting(container)
      .setName(t("settings.tileSize.name"))
      .setDesc(t("settings.tileSize.desc"))
      .addSlider((s) =>
        s
          .setLimits(160, 420, 10)
          .setValue(S.tileSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.tileSize = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

    new Setting(container)
      .setName(t("settings.columns.name"))
      .setDesc(t("settings.columns.desc"))
      .addSlider((s) =>
        s
          .setLimits(0, 8, 1)
          .setValue(S.columns)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.columns = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

    new Setting(container)
      .setName(t("settings.cardContent.name"))
      .setDesc(t("settings.cardContent.desc"))
      .addDropdown((d) =>
        d
          .addOption("extrait", t("settings.cardContent.excerpt"))
          .addOption("synopsis", t("settings.cardContent.synopsis"))
          .setValue(S.cardContent)
          .onChange(async (v) => {
            S.cardContent = v as DefaultSettings["cardContent"];
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(container)
      .setName(t("settings.showCardTags.name"))
      .setDesc(t("settings.showCardTags.desc"))
      .addToggle((t2) =>
        t2.setValue(S.showCardTags).onChange(async (v) => {
          S.showCardTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.excerptLength.name"))
      .addText((t2) =>
        t2.setValue(String(S.excerptLength)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.excerptLength = isNaN(n) ? 420 : Math.max(80, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.showProgress.name"))
      .setDesc(t("settings.showProgress.desc"))
      .addToggle((t2) =>
        t2.setValue(S.showProgress).onChange(async (v) => {
          S.showProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.startupPanels") });


    new Setting(container)
      .setName(t("settings.autoOpenBinder.name"))
      .setDesc(t("settings.autoOpen.leftSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenBinder).onChange(async (v) => {
          S.autoOpenBinder = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenResearch.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenResearch).onChange(async (v) => {
          S.autoOpenResearch = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenNotes.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenNotes).onChange(async (v) => {
          S.autoOpenNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenJournal.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenJournal).onChange(async (v) => {
          S.autoOpenJournal = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenProject.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenProject).onChange(async (v) => {
          S.autoOpenProject = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenProperties.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenProperties).onChange(async (v) => {
          S.autoOpenProperties = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.autoOpenDocxReview.name"))
      .setDesc(t("settings.autoOpenDocxReview.desc"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenDocxReview).onChange(async (v) => {
          S.autoOpenDocxReview = v;
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.activeViews") });


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.activeViews.intro")
    );

    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.activeViews.boardModes")
    );
    const meta = root ? S.projectMeta[root.path] : null;
    const projectHiddenModes: string[] = meta ? ((meta.hiddenBoardModes as string[]) || S.hiddenBoardModes || []) : (S.hiddenBoardModes || []);
    const hiddenModes = new Set(projectHiddenModes);
    for (const [key] of BOARD_MODES) {
      const label = t(`board.mode.${key}`);
      new Setting(container).setName(label).addToggle((t2) =>
        t2.setValue(!hiddenModes.has(key)).onChange(async (v) => {
          const set = new Set(projectHiddenModes);
          if (v) set.delete(key);
          else set.add(key);
          const newHidden = [...set];
          if (meta) {
            meta.hiddenBoardModes = newHidden;
          }
          S.hiddenBoardModes = newHidden;
          await this.plugin.saveSettings();
          this.plugin.renderAllViews(true);
        })
      );
    }

    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.activeViews.sidePanels")
    );
    const hiddenPanels = new Set(S.hiddenPanels || []);
    const panelLabels: Record<string, string> = {
      research: t("sidebar.tab.research"),
      notes: t("sidebar.tab.notes"),
      journal: t("sidebar.tab.journal"),
      project: t("sidebar.tab.project"),
      docxReview: t("settings.activeViews.docxReviewPanel"),
    };
    for (const { key } of HIDEABLE_PANELS) {
      new Setting(container).setName(panelLabels[key] || key).addToggle((t2) =>
        t2.setValue(!hiddenPanels.has(key)).onChange(async (v) => {
          if (!v) {
            await this.plugin.hidePanel(key);
            return;
          }
          const set = new Set(S.hiddenPanels || []);
          set.delete(key);
          S.hiddenPanels = [...set];
          await this.plugin.saveSettings();
          this.plugin.refreshRibbonIcons();
        })
      );
    }

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Binder" });


     new Setting(container)
      .setName(t("binder.display.labelStripes"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowLabels).onChange(async (v) => {
          S.binderShowLabels = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(container)
      .setName(t("binder.display.tagChips"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowTags).onChange(async (v) => {
          S.binderShowTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(container)
      .setName(t("binder.display.statusDot"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowStatus).onChange(async (v) => {
          S.binderShowStatus = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(container)
      .setName(t("binder.display.progressBars"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowProgress).onChange(async (v) => {
          S.binderShowProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(container)
      .setName(t("binder.display.wordCountNumbers"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowWords).onChange(async (v) => {
          S.binderShowWords = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(container)
      .setName(t("settings.previewField.name"))
      .setDesc(t("settings.previewField.desc"))
      .addDropdown((d) =>
        d
          .addOption("none", t("binder.preview.none"))
          .addOption("extrait", t("binder.preview.excerpt"))
          .addOption("synopsis", t("binder.preview.synopsis"))
          .addOption("summary", t("binder.preview.summary"))
          .addOption("notes", t("binder.preview.notes"))
          .addOption("tags", t("binder.preview.tags"))
          .setValue(S.listPanePreviewField)
          .onChange(async (v) => {
            S.listPanePreviewField = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(container)
      .setName(t("settings.previewLines.name"))
      .addSlider((s) =>
        s
          .setLimits(1, 6, 1)
          .setValue(S.listPanePreviewLines)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.listPanePreviewLines = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(container)
      .setName(t("settings.splitRecursive.name"))
      .setDesc(t("settings.splitRecursive.desc"))
      .addToggle((t2) =>
        t2
          .setValue(S.binderSplitRecursive !== false)
          .onChange(async (v) => {
            S.binderSplitRecursive = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(container)
      .setName(t("settings.swipeGestures.name"))
      .setDesc(t("settings.swipeGestures.desc"))
      .addToggle((t2) =>
        t2.setValue(S.swipeGesturesEnabled !== false).onChange(async (v) => {
          S.swipeGesturesEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.notesPanel") });


    new Setting(container)
      .setName(t("settings.notesShowEntities.name"))
      .setDesc(
        (() => {
          /* Les rubriques disponibles varient selon le mode (voir
             utils/project-modes.js — personnages/lieux/codex/glossaire
             n'existent pas en non-fiction) : construit l'exemple à partir
             de ce qui existe réellement plutôt que de suppposer une
             liste fixe. */
          const rf = mode.researchFolders as Record<string, { label: string } | undefined>;
          const examples = [rf.personnages, rf.lieux, rf.sources, rf.codex]
            .filter((r): r is { label: string } => !!r)
            .map((r) => r.label.toLowerCase());
          const list = examples.length ? `${examples.join(", ")}…` : t("settings.notesShowEntities.genericExamples");
          return t("settings.notesShowEntities.desc", { list, unit });
        })()
      )
      .addToggle((t2) =>
        t2.setValue(S.notesShowEntities).onChange(async (v) => {
          S.notesShowEntities = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.notesShowFootnotes.name"))
      .setDesc(t("settings.notesShowFootnotes.desc", { unit }))
      .addToggle((t2) =>
        t2.setValue(S.notesShowFootnotes).onChange(async (v) => {
          S.notesShowFootnotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.notesShowSynopsis.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowSynopsis).onChange(async (v) => {
          S.notesShowSynopsis = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.notesShowResume.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowResume).onChange(async (v) => {
          S.notesShowResume = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.notesShowNotes.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowNotes).onChange(async (v) => {
          S.notesShowNotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(container)
      .setName(t("settings.notesSectionOrder.name"))
      .setDesc(t("settings.notesSectionOrder.desc"));

    const orderWrapNotes = container.createDiv({ cls: "feuillets-notes-order-wrap" });
    this.renderSectionOrderList(orderWrapNotes, S, "notesSectionOrder", ["Synopsis", "Résumé", "Notes"], refresh);

  }
  private renderCorrectionCategory(container: HTMLElement): void {
    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.grammarCheck") });


    /* Section volontairement non interactive : Feuillets ne fournit plus de
       correcteur grammatical (voir README, « Correction grammaticale »). On
       informe plutot que de laisser croire a une panne, et on ne detecte ni
       ne configure aucun greffon tiers — aucune API privee n'est appelee. */
    new Setting(container)
      .setName(t("settings.grammarExternal.name"))
      .setDesc(t("settings.grammarExternal.desc"));

  }
  private renderExportCategory(container: HTMLElement): void {
    const S = this.plugin.settings;
    const unitPlural = this.plugin.unitLabelPlural();
    const refresh = () => this.plugin.refreshView();

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.compilation") });


    new Setting(container)
      .setName(t("settings.compileFileName.name"))
      .setDesc(t("settings.compileFileName.desc"))
      .addText((t2) =>
        t2.setValue(S.compileFileName || "").onChange(async (v) => {
          S.compileFileName = v.trim() || "Manuscrit.md";
          await this.plugin.saveSettings();
        })
    );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Structure" });


    new Setting(container)
      .setName(t("settings.insertFolderTitles.name"))
      .addToggle((t2) =>
        t2.setValue(S.insertFolderTitles).onChange(async (v) => {
          S.insertFolderTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.insertTitles.name"))
      .setDesc(t("settings.insertTitles.desc"))
      .addToggle((t2) =>
        t2.setValue(S.insertTitles).onChange(async (v) => {
          S.insertTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.insertSceneTitles.name", { unitPlural }))
      .setDesc(t("settings.insertSceneTitles.desc", { unitPlural }))
      .addToggle((t2) =>
        t2.setValue(S.insertSceneTitles).onChange(async (v) => {
          S.insertSceneTitles = v;
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Notes" });


    new Setting(container)
      .setName(t("settings.footnoteRenumberOnCompile.name"))
      .setDesc(t("settings.footnoteRenumberOnCompile.desc"))
      .addToggle((t2) =>
        t2.setValue(S.footnoteRenumberOnCompile).onChange(async (v) => {
          S.footnoteRenumberOnCompile = v;
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Pages liminaires" });


    new Setting(container)
      .setName(t("settings.manuscriptTitle.name"))
      .setDesc(t("settings.manuscriptTitle.desc"))
      .addText((t2) =>
        t2.setValue(S.manuscriptTitle).onChange(async (v) => {
          S.manuscriptTitle = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.manuscriptAuthor.name"))
      .addText((t2) =>
        t2.setValue(S.manuscriptAuthor).onChange(async (v) => {
          S.manuscriptAuthor = v.trim();
          await this.plugin.saveSettings();
        })
      );

    /* La maquette reste un outil d'édition visuelle, mais son seul point
       d'entrée est désormais le centre Export. Elle modifie directement le
       gabarit actif (marges et espacements des blocs), sans état local ni
       seconde copie de réglages. */
    new Setting(container)
      .setName("Mise en page visuelle")
      .setDesc("Ajuster visuellement les marges et les espacements de la page de titre du gabarit actif.")
      .addButton((button) =>
        button.setButtonText("Modifier la page de titre").onClick(() => {
          const key = S.exportTemplate;
          const label = EXPORT_TEMPLATES[key]?.label || key;
          new LayoutModal(
            this.app,
            this.plugin,
            key,
            label,
            () => this.update()
          ).open();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.compilePresets") });


    (S.compilePresets as PresetConfig[] || []).forEach((p, i) => {
      // Une carte par preset, une ligne étiquetée par champ : l'ancienne
      // version tassait nom + fichier + 3 interrupteurs sans libellé (juste
      // une infobulle au survol) sur une seule ligne — illisible sans
      // deviner ce que chaque interrupteur faisait.
      const card = container.createDiv({ cls: "feuillets-merge-card" });
      const cardHead = card.createDiv({ cls: "feuillets-preset-card-head" });
      cardHead.createSpan({ cls: "feuillets-merge-card-title", text: p.name || t("settings.compilePresets.item", { n: String(i + 1) }) });
      const delBtn = cardHead.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("settings.compilePresets.deleteAria") } });
      delBtn.setText("✕");
      delBtn.addEventListener("click", () => {
        void (async () => {
          S.compilePresets.splice(i, 1);
          if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
          await this.plugin.saveSettings();
          this.update();
          refresh();
        })();
      });

      new Setting(card)
        .setName(t("settings.compilePresets.name"))
        .addText((t2) =>
          t2.setValue(p.name || "").onChange(async (v) => {
            p.name = v.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName(t("settings.compilePresets.outputFile"))
        .addText((t2) =>
          t2.setPlaceholder("Sortie.md").setValue(p.fileName || "").onChange(async (v) => {
            p.fileName = v.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName(t("settings.insertFolderTitles.name"))
        .addToggle((t2) =>
          t2.setValue(p.folderTitles !== false).onChange(async (v) => {
            p.folderTitles = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName(t("settings.compilePresets.insertChapterTitles"))
        .addToggle((t2) =>
          t2.setValue(p.chapterTitles !== false).onChange(async (v) => {
            p.chapterTitles = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName(t("settings.insertSceneTitles.name", { unitPlural }))
        .addToggle((t2) =>
          t2.setValue(p.sceneTitles === true).onChange(async (v) => {
            p.sceneTitles = v;
            await this.plugin.saveSettings();
          })
        );
    });

    new Setting(container).addButton((b) =>
      b.setButtonText(t("settings.compilePresets.add")).onClick(async () => {
        (S.compilePresets as PresetConfig[]).push({
          name: t("settings.compilePresets.item", { n: String(S.compilePresets.length + 1) }),
          fileName: "Sortie.md",
          folderTitles: true,
          chapterTitles: true,
          sceneTitles: false,
        } as PresetConfig);
        await this.plugin.saveSettings();
        this.update();
        refresh();
      })
    );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Apparence" });


    new Setting(container)
      .setName("Gabarit")
      .addDropdown((drop) => {
        const keys = new Set([...Object.keys(EXPORT_TEMPLATES), S.exportTemplate]);
        for (const key of keys) drop.addOption(key, EXPORT_TEMPLATES[key]?.label || key);
        drop.setValue(S.exportTemplate);
        drop.onChange(async (value) => {
          S.exportTemplate = value as DefaultSettings["exportTemplate"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("Séparateur")
      .setDesc("Texte inséré entre les feuillets compilés.")
      .addText((input) =>
        input.setValue(S.separator).onChange(async (value) => {
          S.separator = value;
          await this.plugin.saveSettings();
        })
      );



    container.createDiv({ cls: "setting-item-description" }).setText(
      t("settings.export.layoutModelNote")
    );

    new Setting(container)
      .setName(t("settings.exportFrenchTypography.name"))
      .setDesc(t("settings.exportFrenchTypography.desc"))
      .addToggle((t2) =>
        t2.setValue(S.exportFrenchTypography !== false).onChange(async (v) => {
          S.exportFrenchTypography = v;
          await this.plugin.saveSettings();
        })
      );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Images" });

    container.createDiv({ cls: "setting-item-description" }).setText(
      "Les images référencées dans les feuillets sont reprises par la compilation et l'export."
    );

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Formats d’export" });

    new Setting(container)
      .setName(t("project.compilation.formatLabel"))
      .addDropdown((drop) => {
        drop.addOption("docx", ".docx (Word)");
        drop.addOption("odt", ".odt (LibreOffice)");
        drop.addOption("epub", ".epub (Ebook)");
        drop.addOption("md", ".md (Markdown)");
        if (!Platform.isMobile) drop.addOption("pdf", ".pdf (PDF)");
        const format = typeof S.exportFormat === "string" ? S.exportFormat : "docx";
        drop.setValue(format);
        drop.onChange(async (value) => {
          S.exportFormat = value as DefaultSettings["exportFormat"];
          await this.plugin.saveSettings();
          this.update();
        });
      });

    const selectedExportFormat: string = typeof S.exportFormat === "string" ? S.exportFormat : "docx";

    if (selectedExportFormat === "pdf") {

    container.createDiv({ cls: "feuillets-settings-subhead", text: "Page" });


    container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.export.pdfOnlyHeader")
    );

    new Setting(container)
      .setName(t("settings.pdfHeaderLeft.name"))
      .setDesc(t("settings.pdfHeaderLeft.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfHeaderLeft || "{title}").onChange(async (v) => {
          S.pdfHeaderLeft = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfHeaderRight.name"))
      .setDesc(t("settings.pdfHeaderRight.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfHeaderRight || "{author}").onChange(async (v) => {
          S.pdfHeaderRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfDiffHeaders.name"))
      .setDesc(t("settings.pdfDiffHeaders.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.pdfDiffHeaders).onChange(async (v) => {
          S.pdfDiffHeaders = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfHideFirstPageHeader.name"))
      .addToggle((t2) =>
        t2.setValue(S.pdfHideFirstPageHeader ?? true).onChange(async (v) => {
          S.pdfHideFirstPageHeader = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfPageNumberPosition.name"))
      .addDropdown((d) =>
        d
          .addOption("right", t("settings.pdfPageNumberPosition.right"))
          .addOption("center", t("settings.pdfPageNumberPosition.center"))
          .addOption("left", t("settings.pdfPageNumberPosition.left"))
          .setValue(S.pdfPageNumberPosition || "right")
          .onChange(async (v) => {
            S.pdfPageNumberPosition = v as DefaultSettings["pdfPageNumberPosition"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("settings.pdfFooterRight.name"))
      .setDesc(t("settings.pdfFooterRight.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
          S.pdfFooterRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfPageSize.name"))
      .addDropdown((d) =>
        d
          .addOption("A4", "A4 (210x297 mm)")
          .addOption("letter", "US Letter")
          .addOption("A5", "A5 (148x210 mm)")
          .addOption("poche", t("settings.pdfPageSize.pocket"))
          .setValue(S.pdfPageSize || "A4")
          .onChange(async (v) => {
            S.pdfPageSize = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("settings.pdfMarginTop.name"))
      .addText((t2) =>
        t2.setValue(String(S.pdfMarginTop ?? 2.5)).onChange(async (v) => {
          S.pdfMarginTop = parseFloat(v) || 2.5;
          S.pdfMarginBottom = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfMarginLeft.name"))
      .addText((t2) =>
        t2.setValue(String(S.pdfMarginLeft ?? 2.5)).onChange(async (v) => {
          S.pdfMarginLeft = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName(t("settings.pdfMirrorMargins.name"))
      .addToggle((t2) =>
        t2.setValue(!!S.pdfMirrorMargins).onChange(async (v) => {
          S.pdfMirrorMargins = v;
          await this.plugin.saveSettings();
        })
      );

    }

    if (selectedExportFormat === "epub") {
      container.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.export.epubOnlyHeader")
      );

    new Setting(container)
      .setName(t("settings.epubLanguage.name"))
      .setDesc(t("settings.epubLanguage.desc"))
      .addText((t2) =>
        t2.setValue(S.epubLanguage).onChange(async (v) => {
          S.epubLanguage = v.trim() || "fr";
          await this.plugin.saveSettings();
        })
      );

    }



  }

  /** Compatibilité : `open-export-settings.ts` appelle ce nom sur l'instance
   * active pour sauter directement sur « Export ». Pas `display()` : une fois
   * `getSettingDefinitions()` non vide, Obsidian considère toute méthode
   * `display()` comme un reliquat de l'API dépréciée et le signale — même
   * si son corps ne fait qu'appeler `update()`. Ce nom neutre évite
   * l'avertissement tout en gardant le même contrat (voir aussi
   * project-view.ts, preview-view.ts et leurs tests). */
  refreshForExternalCallers(): void {
    this.update();
  }


  /** Bouton discret pointant vers un thème/plugin communautaire — jamais une
   * installation automatique (aucune API publique ne le permet, et pour
   * cause : un plugin ne doit pas pouvoir en installer un autre à l'insu de
   * l'utilisateur), juste un raccourci vers le navigateur intégré
   * d'Obsidian, recherche pré-remplie si possible. */
  storeLinkButton(container: HTMLElement, label: string, onClick: () => void): void {
    const chip = container.createSpan({ cls: "feuillets-tag-chip", attr: { role: "button", tabindex: "0" } });
    chip.setText(label);
    chip.addEventListener("click", onClick);
  }

  openCommunityPluginsSearch(query: string): void {
    try {
      const settingModal = (this.app as unknown as AppWithSettingTab).setting;
      if (!settingModal || !settingModal.openTabById) return;
      settingModal.openTabById("community-plugins");
      const tab = settingModal.activeTab;
      if (tab && tab.searchComponent) {
        tab.searchComponent.setValue(query);
        tab.searchComponent.onChanged();
      }
    } catch { /* app.setting est une API interne : ouvrir l'onglet des plugins communautaires est un confort, pas une fonction */ }
  }

  openAppearanceTab(): void {
    try {
      const settingModal = (this.app as unknown as AppWithSettingTab).setting;
      if (settingModal && settingModal.openTabById) settingModal.openTabById("appearance");
    } catch { /* idem pour l'onglet Apparence */ }
  }


  renderSectionOrderList(container: HTMLElement, S: SettingTabSettings, key: string, defaults: string[], refresh: () => void): void {
    container.empty();
    let order: string[] = (S[key] as string[] | undefined) || defaults;
    // Dédoublonner et ne garder que les valeurs présentes dans defaults
    order = Array.from(new Set(order)).filter(item => defaults.includes(item));
    // S'il manque des éléments de defaults, on les rajoute à la fin
    defaults.forEach(item => {
      if (!order.includes(item)) {
        order.push(item);
      }
    });
    S[key] = order;

    const sectionLabel = (name: string) =>
      name === "Synopsis" ? t("notes.section.synopsis")
      : name === "Résumé" ? t("notes.section.summary")
      : name === "Notes" ? t("notes.section.notes")
      : name;

    order.forEach((name, i) => {
      const row = container.createDiv({ cls: "feuillets-notes-order-wrap-row" });
      row.createSpan({ text: sectionLabel(name) });
      const btns = row.createDiv({ cls: "feuillets-notes-order-buttons" });

      const upBtn = btns.createEl("button", { text: "↑", cls: "clickable-icon" });
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => {
        void (async () => {
          if (i === 0) return;
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
          S[key] = order;
          await this.plugin.saveSettings();
          refresh();
          this.renderSectionOrderList(container, S, key, defaults, refresh);
        })();
      });

      const downBtn = btns.createEl("button", { text: "↓", cls: "clickable-icon" });
      downBtn.disabled = i === order.length - 1;
      downBtn.addEventListener("click", () => {
        void (async () => {
          if (i === order.length - 1) return;
          [order[i + 1], order[i]] = [order[i], order[i + 1]];
          S[key] = order;
          await this.plugin.saveSettings();
          refresh();
          this.renderSectionOrderList(container, S, key, defaults, refresh);
        })();
      });
    });
  }
}
