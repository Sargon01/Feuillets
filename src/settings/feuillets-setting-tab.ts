import { YAML_PRESETS } from "../scenes-editor.js";
import { BOARD_MODES, HIDEABLE_PANELS } from "../constants.js";
import { resolveType } from "../utils/project-modes.js";
import { NewProjectModal, ManageProjectsModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { setLocale, detectLocale, t } from "../i18n/index.js";
import { getProjectMode } from "../services/project-mode.js";
import type { DefaultSettings } from "../default-settings.js";
import { PluginSettingTab, Setting, TFolder, Notice, Menu, Platform, Plugin, type App } from "obsidian";

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

/* Deux recommandations d'Obsidian restent volontairement non suivies ici.
   Ce ne sont pas des oublis, et il n'y a aucune règle désactivée : les
   avertissements sont laissés visibles.

   1. `getSettingDefinitions()` / dépréciation de `display()` — API déclarative
      apparue en 1.13.0, alors que minAppVersion vaut 1.7.2 : l'adopter seule
      priverait de réglages tous les utilisateurs sous 1.13. S'y ajoute un
      obstacle indépendant de la version : ce panneau construit une barre
      d'onglets par catégories (marqueurs data-cat, panneaux, re-rendus
      conditionnels via this.display()) que la forme déclarative ne sait pas
      exprimer. La migration coûterait cette navigation. `display()` reste
      déprécié mais pleinement fonctionnel. Contrepartie assumée : les
      réglages n'apparaissent pas dans la recherche de réglages sur 1.13+.

   2. `setDynamicTooltip()` — déprécié parce que, depuis 1.13.0, la valeur du
      curseur est toujours affichée. En dessous, elle ne l'est pas : retirer
      ces appels supprimerait le retour de valeur pendant le glissement sur
      toute la moitié basse de la plage supportée. L'appel est conservé, sans
      effet sur 1.13+ et utile en deçà.

   À revoir le jour où minAppVersion passera à 1.13.0. Les dépréciations
   réellement contournables (Notice.noticeEl, ButtonComponent.setWarning) le
   sont par détection à l'exécution — voir src/utils/obsidian-compat.ts. */
export class FeuilletsSettingTab extends PluginSettingTab {
  plugin: FeuilletsSettingTabPlugin;
  _activeSettingsTab?: string;

  constructor(app: App, plugin: FeuilletsSettingTabPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    const S = this.plugin.settings;
    const mode = this.plugin.projectMode();
    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();
    containerEl.empty();

    const header = containerEl.createDiv({ cls: "feuillets-settings-header" });
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
    links.createEl("a", { text: t("settings.links.features"), href: `${REPO}/blob/main/FONCTIONNALITES.md`, attr: { target: "_blank", rel: "noopener" } });

    const refresh = () => this.plugin.refreshView();

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.projectFolder"), attr: { "data-cat": "Projet", "data-open": "1" } });

    const allProjects = (S.projects || []).concat(S.projectFolder ? [S.projectFolder] : [])
      .filter((p, i, a) => p && a.indexOf(p) === i)
      .sort((a, b) =>
        this.plugin.projectDisplayName(a).localeCompare(
          this.plugin.projectDisplayName(b), "fr", { sensitivity: "base" }
        )
      );

    // Dropdown pour choisir le projet actif
    new Setting(containerEl)
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
          this.display();
        });
      });

    // Champ texte pour saisir / éditer le chemin directement
    new Setting(containerEl)
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
    const btnSetting = new Setting(containerEl)
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
        const warn = containerEl.createDiv({ cls: "feuillets-empty" });
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

      new Setting(containerEl)
        .setName(t("settings.projectType.name"))
        .setDesc(t("settings.projectType.desc"))
        .addDropdown((d) => {
          d.addOption("fiction", t("settings.projectType.fiction"));
          d.addOption("nonfiction", t("settings.projectType.nonfiction"));
          d.setValue(resolveType(meta.type))
           .onChange(async (v) => {
             meta.type = v;
             await this.plugin.saveSettings();
             this.display(); // Recharger le panneau
             this.plugin.renderAllViews(true);
             refresh();
           });
        });

      if (resolveType(meta.type) === "nonfiction") {
        new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.chronoFolder.name"))
      .setDesc(t("settings.chronoFolder.desc"))
      .addText((t2) =>
        t2.setValue(S.chronoFolder).onChange(async (v) => {
          S.chronoFolder = v.trim() || "Recherche/Chronologie";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.journalFolder.name"))
      .setDesc(t("settings.journalFolder.desc"))
      .addText((t2) =>
        t2.setValue(S.journalFolder).onChange(async (v) => {
          S.journalFolder = v.trim() || "Journal";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.demoProject.name"))
      .setDesc(t("settings.demoProject.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.demoProject.name")).onClick((e) => {
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle(t("settings.demoProject.elira")).onClick(async () => {
              await this.plugin.createDemoProject("elira");
              this.display();
            })
          );
          menu.addItem((item) =>
            item
              .setTitle(t("settings.demoProject.candide"))
              .onClick(async () => {
                await this.plugin.createDemoProject("candide");
                this.display();
              })
          );
          menu.showAtMouseEvent(e);
        })
      );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.numbering"), attr: { "data-cat": "Projet", "data-open": "1" } });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.autoRename.name"))
      .setDesc(t("settings.autoRename.desc"))
      .addToggle((t2) =>
        t2.setValue(S.autoRename).onChange(async (v) => {
          S.autoRename = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName(t("settings.renamePrefix.name")).addText((t2) =>
      t2.setValue(S.renamePrefix).onChange(async (v) => {
        S.renamePrefix = v.trim() || "chapitre";
        await this.plugin.saveSettings();
      })
    );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.statusesLabels"), attr: { "data-cat": "Projet", "data-open": "1" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.statusesLabels.intro")
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.statuses.title"));

    if (!Array.isArray(S.statuses)) S.statuses = [];
    S.statuses.forEach((st, i) => {
      new Setting(containerEl)
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
              this.display();
              refresh();
            })
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText(t("settings.statuses.add")).onClick(async () => {
        S.statuses.push({ name: t("settings.statuses.item", { n: String(S.statuses.length + 1) }), color: "#888888" });
        await this.plugin.saveSettings();
        this.display();
      })
    );

    const currentMeta = root ? S.projectMeta[root.path] : null;
    const projectLabels = currentMeta && currentMeta.labels ? currentMeta.labels : S.labels;

    if (root) {
      containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.labels.titleForProject", { name: root.name }));
    }

    (projectLabels || []).forEach((l, i) => {
      new Setting(containerEl)
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
              this.display();
              refresh();
            })
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText(t("settings.labels.add")).onClick(async () => {
        projectLabels.push({ name: t("settings.labels.item", { n: String(projectLabels.length + 1) }), color: "#888888" });
        await this.plugin.saveSettings();
        this.display();
      })
    );

    new Setting(containerEl)
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.goals"), attr: { "data-cat": "Projet", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.wordGoal.name", { unit }))
      .addText((t2) =>
        t2.setValue(String(S.wordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.wordGoal = isNaN(n) ? 0 : n;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl).setName(t("settings.tolerance.name")).addText((t2) =>
      t2.setValue(String(S.tolerance)).onChange(async (v) => {
        const n = parseInt(v, 10);
        S.tolerance = isNaN(n) ? 0 : Math.max(0, n);
        await this.plugin.saveSettings();
        refresh();
      })
    );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.history"), attr: { "data-cat": "Projet", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.statsRetention.name"))
      .setDesc(t("settings.statsRetention.desc"))
      .addText((t2) =>
        t2.setValue(String(S.statsRetention)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.statsRetention = isNaN(n) ? 120 : Math.max(0, n);
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.backup"), attr: { "data-cat": "Projet", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.backupEnabled.name"))
      .setDesc(t("settings.backupEnabled.desc"))
      .addToggle((t2) =>
        t2.setValue(S.backupEnabled).onChange(async (v) => {
          S.backupEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (S.backupEnabled) {
      new Setting(containerEl)
        .setName(t("settings.backupInterval.name"))
        .addText((t2) =>
          t2.setValue(String(S.backupIntervalMinutes)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupIntervalMinutes = isNaN(n) ? 30 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName(t("settings.backupKeepCount.name"))
        .setDesc(t("settings.backupKeepCount.desc"))
        .addText((t2) =>
          t2.setValue(String(S.backupKeepCount)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupKeepCount = isNaN(n) ? 5 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName(t("settings.backupNow.name"))
        .addButton((b) =>
          b.setButtonText(t("settings.backupNow.btn")).onClick(() => this.plugin.backupProjectNow())
        );
    }

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.appearance"), attr: { "data-cat": "Interface", "data-open": "1" } });

    new Setting(containerEl)
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
            this.display();
          })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.baseFontSize.name"))
      .addSlider((sl) => {
        const current = this.plugin.getVaultConfig("baseFontSize");
        sl.setLimits(12, 28, 1)
          .setValue(typeof current === "number" ? current : 16)
          .setDynamicTooltip()
          .onChange((v) => this.plugin.setVaultConfig("baseFontSize", v));
      });

    new Setting(containerEl)
      .setName(t("settings.textFontFamily.name"))
      .setDesc(t("settings.textFontFamily.desc"))
      .addText((t2) =>
        t2.setValue(String((this.plugin.getVaultConfig("textFontFamily") as string | number | boolean | null | undefined) || "")).onChange((v) => {
          this.plugin.setVaultConfig("textFontFamily", v.trim());
        })
      );

    new Setting(containerEl)
      .setName(t("settings.monospaceFontFamily.name"))
      .addText((t2) =>
        t2.setValue(String((this.plugin.getVaultConfig("monospaceFontFamily") as string | number | boolean | null | undefined) || "")).onChange((v) => {
          this.plugin.setVaultConfig("monospaceFontFamily", v.trim());
        })
      );

    new Setting(containerEl)
      .setName(t("settings.accentColor.name"))
      .addColorPicker((cp) => {
        const current = this.plugin.getVaultConfig("accentColor");
        if (typeof current === "string" && current) cp.setValue(current);
        cp.onChange((v) => this.plugin.setVaultConfig("accentColor", v));
      });

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.liveTypography"), attr: { "data-cat": "Écriture", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.indentParagraphs.name"))
      .setDesc(t("settings.indentParagraphs.desc"))
      .addToggle((t2) =>
        t2.setValue(S.indentParagraphs).onChange(async (v) => {
          S.indentParagraphs = v;
          await this.plugin.saveSettings();
          this.plugin.applyIndentClass();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveApostrophe.name"))
      .setDesc(t("settings.liveApostrophe.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveApostrophe).onChange(async (v) => {
          S.liveApostrophe = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveGuillemets.name"))
      .setDesc(t("settings.liveGuillemets.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveGuillemets).onChange(async (v) => {
          S.liveGuillemets = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveDashes.name"))
      .setDesc(t("settings.liveDashes.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveDashes).onChange(async (v) => {
          S.liveDashes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveTwoEnters.name"))
      .setDesc(t("settings.liveTwoEnters.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveTwoEnters).onChange(async (v) => {
          S.liveTwoEnters = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveDoubleEnter.name"))
      .setDesc(t("settings.liveDoubleEnter.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveDoubleEnter).onChange(async (v) => {
          S.liveDoubleEnter = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.liveHyphenation.name"))
      .setDesc(t("settings.liveHyphenation.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveHyphenation).onChange(async (v) => {
          S.liveHyphenation = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.liveJustify.name"))
      .setDesc(t("settings.liveJustify.desc"))
      .addToggle((t2) =>
        t2.setValue(S.liveJustify).onChange(async (v) => {
          S.liveJustify = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.readingMatchLive.name"))
      .setDesc(t("settings.readingMatchLive.desc"))
      .addToggle((t2) =>
        t2.setValue(S.readingMatchLive !== false).onChange(async (v) => {
          S.readingMatchLive = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.focusMode"), attr: { "data-cat": "Interface", "data-open": "1" } });

     new Setting(containerEl)
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

     new Setting(containerEl)
      .setName(t("settings.typewriterScroll.name"))
      .setDesc(t("settings.typewriterScroll.desc"))
      .addToggle((t2) =>
        t2.setValue(S.concentrationTypewriter).onChange(async (v) => {
          S.concentrationTypewriter = v;
          await this.plugin.saveSettings();
        })
      );

     new Setting(containerEl)
      .setName(t("settings.floatingCounter.name"))
      .setDesc(t("settings.floatingCounter.desc"))
      .addToggle((t2) =>
        t2.setValue(S.concentrationCounter).onChange(async (v) => {
          S.concentrationCounter = v;
          await this.plugin.saveSettings();
          if (!v) this.plugin.removeConcentrationCounter();
        })
      );

     new Setting(containerEl)
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

     new Setting(containerEl)
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.leanInterface"), attr: { "data-cat": "Interface", "data-open": "1" } });
    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.leanInterface.desc"));

    new Setting(containerEl)
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
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.hideProperties.name"))
      .setDesc(t("settings.hideProperties.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("propertiesInDocument") === "hidden").onChange((v) => {
          this.plugin.setVaultConfig("propertiesInDocument", v ? "hidden" : "visible");
        })
      );

    new Setting(containerEl)
      .setName(t("settings.hideInlineTitle.name"))
      .setDesc(t("settings.hideInlineTitle.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showInlineTitle") === false).onChange((v) => {
          this.plugin.setVaultConfig("showInlineTitle", !v);
        })
      );

    new Setting(containerEl)
      .setName(t("settings.hideTabHeader.name"))
      .setDesc(t("settings.hideTabHeader.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showViewHeader") === false).onChange((v) => {
          this.plugin.setVaultConfig("showViewHeader", !v);
        })
      );


    new Setting(containerEl)
      .setName(t("settings.hideRibbon.name"))
      .setDesc(t("settings.hideRibbon.desc"))
      .addToggle((t2) =>
        t2.setValue(this.plugin.getVaultConfig("showRibbon") === false).onChange((v) => {
          this.plugin.setVaultConfig("showRibbon", !v);
        })
      );


    new Setting(containerEl)
      .setName(t("settings.transparentPanels.name"))
      .setDesc(t("settings.transparentPanels.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiTransparentPanels).onChange(async (v) => {
          S.uiTransparentPanels = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.transparentTabBar.name"))
      .setDesc(t("settings.transparentTabBar.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiTransparentTabBar).onChange(async (v) => {
          S.uiTransparentTabBar = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.hideVaultSwitcher.name"))
      .setDesc(t("settings.hideVaultSwitcher.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiHideVaultSwitcher).onChange(async (v) => {
          S.uiHideVaultSwitcher = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.dimTabActions.name"))
      .setDesc(t("settings.dimTabActions.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiDimTabActions).onChange(async (v) => {
          S.uiDimTabActions = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );


    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(t("settings.leanInterface.goFurther"));
    const goFurther = containerEl.createDiv({ cls: "feuillets-tags" });
    this.storeLinkButton(goFurther, t("settings.leanInterface.themeMinimal"), () => this.openAppearanceTab());
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginHider"), () => this.openCommunityPluginsSearch("Hider"));
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginStyleSettings"), () => this.openCommunityPluginsSearch("Style Settings"));
    this.storeLinkButton(goFurther, t("settings.leanInterface.pluginMinimalSettings"), () => this.openCommunityPluginsSearch("Minimal Theme Settings"));

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.sceneMerge"), attr: { "data-cat": "Écriture", "data-open": "1" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.sceneMerge.intro")
    );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.autoAnalyzeInRelecture.name"))
      .setDesc(t("settings.autoAnalyzeInRelecture.desc"))
      .addToggle((toggle) => {
        toggle.setValue(S.autoAnalyzeInRelecture !== false);
        toggle.onChange(async (value) => {
          S.autoAnalyzeInRelecture = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.mergeKeepSeparator.name"))
      .addToggle((toggle) => {
        toggle.setValue(S.mergeKeepSeparatorDefault);
        toggle.onChange(async (value) => {
          S.mergeKeepSeparatorDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.boardPanel"), attr: { "data-cat": "Panneaux latéraux", "data-open": "1" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.boardPanel.intro")
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.boardPanel.arcsIntro", { unit })
    );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.showCardTags.name"))
      .setDesc(t("settings.showCardTags.desc"))
      .addToggle((t2) =>
        t2.setValue(S.showCardTags).onChange(async (v) => {
          S.showCardTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.excerptLength.name"))
      .addText((t2) =>
        t2.setValue(String(S.excerptLength)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.excerptLength = isNaN(n) ? 420 : Math.max(80, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.showProgress.name"))
      .setDesc(t("settings.showProgress.desc"))
      .addToggle((t2) =>
        t2.setValue(S.showProgress).onChange(async (v) => {
          S.showProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.startupPanels"), attr: { "data-cat": "Panneaux latéraux", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.autoOpenBinder.name"))
      .setDesc(t("settings.autoOpen.leftSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenBinder).onChange(async (v) => {
          S.autoOpenBinder = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenResearch.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenResearch).onChange(async (v) => {
          S.autoOpenResearch = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenNotes.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenNotes).onChange(async (v) => {
          S.autoOpenNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenJournal.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenJournal).onChange(async (v) => {
          S.autoOpenJournal = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenProject.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenProject).onChange(async (v) => {
          S.autoOpenProject = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenProperties.name"))
      .setDesc(t("settings.autoOpen.rightSidebar"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenProperties).onChange(async (v) => {
          S.autoOpenProperties = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.autoOpenDocxReview.name"))
      .setDesc(t("settings.autoOpenDocxReview.desc"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenDocxReview).onChange(async (v) => {
          S.autoOpenDocxReview = v;
          await this.plugin.saveSettings();
        })
      );


    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.activeViews"), attr: { "data-cat": "Panneaux latéraux", "data-open": "1" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.activeViews.intro")
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.activeViews.boardModes")
    );
    const meta = root ? S.projectMeta[root.path] : null;
    const projectHiddenModes: string[] = meta ? ((meta.hiddenBoardModes as string[]) || S.hiddenBoardModes || []) : (S.hiddenBoardModes || []);
    const hiddenModes = new Set(projectHiddenModes);
    for (const [key] of BOARD_MODES) {
      const label = t(`board.mode.${key}`);
      new Setting(containerEl).setName(label).addToggle((t2) =>
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

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
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
      new Setting(containerEl).setName(panelLabels[key] || key).addToggle((t2) =>
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

    containerEl.createDiv({ cls: "feuillets-settings-section", text: "Binder", attr: { "data-cat": "Panneaux latéraux", "data-open": "1" } });

     new Setting(containerEl)
      .setName(t("binder.display.labelStripes"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowLabels).onChange(async (v) => {
          S.binderShowLabels = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName(t("binder.display.tagChips"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowTags).onChange(async (v) => {
          S.binderShowTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName(t("binder.display.statusDot"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowStatus).onChange(async (v) => {
          S.binderShowStatus = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName(t("binder.display.progressBars"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowProgress).onChange(async (v) => {
          S.binderShowProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName(t("binder.display.wordCountNumbers"))
      .addToggle((t2) =>
        t2.setValue(S.binderShowWords).onChange(async (v) => {
          S.binderShowWords = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
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

     new Setting(containerEl)
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

     new Setting(containerEl)
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

     new Setting(containerEl)
      .setName(t("settings.swipeGestures.name"))
      .setDesc(t("settings.swipeGestures.desc"))
      .addToggle((t2) =>
        t2.setValue(S.swipeGesturesEnabled !== false).onChange(async (v) => {
          S.swipeGesturesEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.notesPanel"), attr: { "data-cat": "Panneaux latéraux", "data-open": "1" } });

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.notesShowFootnotes.name"))
      .setDesc(t("settings.notesShowFootnotes.desc", { unit }))
      .addToggle((t2) =>
        t2.setValue(S.notesShowFootnotes).onChange(async (v) => {
          S.notesShowFootnotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.notesShowSynopsis.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowSynopsis).onChange(async (v) => {
          S.notesShowSynopsis = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.notesShowResume.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowResume).onChange(async (v) => {
          S.notesShowResume = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.notesShowNotes.name"))
      .addToggle((t2) =>
        t2.setValue(S.notesShowNotes).onChange(async (v) => {
          S.notesShowNotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.notesSectionOrder.name"))
      .setDesc(t("settings.notesSectionOrder.desc"));

    const orderWrapNotes = containerEl.createDiv({ cls: "feuillets-notes-order-wrap" });
    this.renderSectionOrderList(orderWrapNotes, S, "notesSectionOrder", ["Synopsis", "Résumé", "Notes"], refresh);

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.grammarCheck"), attr: { "data-cat": "Correction", "data-open": "1" } });

    /* Section volontairement non interactive : Feuillets ne fournit plus de
       correcteur grammatical (voir README, « Correction grammaticale »). On
       informe plutot que de laisser croire a une panne, et on ne detecte ni
       ne configure aucun greffon tiers — aucune API privee n'est appelee. */
    new Setting(containerEl)
      .setName(t("settings.grammarExternal.name"))
      .setDesc(t("settings.grammarExternal.desc"));

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.compilation"), attr: { "data-cat": "Export", "data-open": "1" } });

    new Setting(containerEl)
      .setName(t("settings.compileFileName.name"))
      .setDesc(t("settings.compileFileName.desc"))
      .addText((t2) =>
        t2.setValue(S.compileFileName || "").onChange(async (v) => {
          S.compileFileName = v.trim() || "Manuscrit.md";
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName(t("settings.insertFolderTitles.name"))
      .addToggle((t2) =>
        t2.setValue(S.insertFolderTitles).onChange(async (v) => {
          S.insertFolderTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.insertTitles.name"))
      .setDesc(t("settings.insertTitles.desc"))
      .addToggle((t2) =>
        t2.setValue(S.insertTitles).onChange(async (v) => {
          S.insertTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.insertSceneTitles.name", { unitPlural }))
      .setDesc(t("settings.insertSceneTitles.desc", { unitPlural }))
      .addToggle((t2) =>
        t2.setValue(S.insertSceneTitles).onChange(async (v) => {
          S.insertSceneTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.manuscriptTitle.name"))
      .setDesc(t("settings.manuscriptTitle.desc"))
      .addText((t2) =>
        t2.setValue(S.manuscriptTitle).onChange(async (v) => {
          S.manuscriptTitle = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.manuscriptAuthor.name"))
      .addText((t2) =>
        t2.setValue(S.manuscriptAuthor).onChange(async (v) => {
          S.manuscriptAuthor = v.trim();
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.compilePresets"), attr: { "data-cat": "Export", "data-open": "1" } });

    (S.compilePresets as PresetConfig[] || []).forEach((p, i) => {
      // Une carte par preset, une ligne étiquetée par champ : l'ancienne
      // version tassait nom + fichier + 3 interrupteurs sans libellé (juste
      // une infobulle au survol) sur une seule ligne — illisible sans
      // deviner ce que chaque interrupteur faisait.
      const card = containerEl.createDiv({ cls: "feuillets-merge-card" });
      const cardHead = card.createDiv({ cls: "feuillets-preset-card-head" });
      cardHead.createSpan({ cls: "feuillets-merge-card-title", text: p.name || t("settings.compilePresets.item", { n: String(i + 1) }) });
      const delBtn = cardHead.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("settings.compilePresets.deleteAria") } });
      delBtn.setText("✕");
      delBtn.addEventListener("click", () => {
        void (async () => {
          S.compilePresets.splice(i, 1);
          if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
          await this.plugin.saveSettings();
          this.display();
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

    new Setting(containerEl).addButton((b) =>
      b.setButtonText(t("settings.compilePresets.add")).onClick(async () => {
        (S.compilePresets as PresetConfig[]).push({
          name: t("settings.compilePresets.item", { n: String(S.compilePresets.length + 1) }),
          fileName: "Sortie.md",
          folderTitles: true,
          chapterTitles: true,
          sceneTitles: false,
        } as PresetConfig);
        await this.plugin.saveSettings();
        this.display();
        refresh();
      })
    );

    containerEl.createDiv({ cls: "feuillets-settings-section", text: t("settings.section.export"), attr: { "data-cat": "Export", "data-open": "1" } });

    containerEl.createDiv({ cls: "setting-item-description" }).setText(
      t("settings.export.engineIntro")
    );

    new Setting(containerEl)
      .setName(t("settings.exportEngine.name"))
      .setDesc(t("settings.exportEngine.desc"))
      .addDropdown((drop) => {
        drop.addOption("natif", t("settings.exportEngine.native"));
        drop.addOption("pandoc", t("settings.exportEngine.pandoc"));
        drop.setValue(S.exportEngine || "natif");
        drop.onChange(async (value) => {
          S.exportEngine = value as DefaultSettings["exportEngine"];
          await this.plugin.saveSettings();
        });
      });

    containerEl.createDiv({ cls: "setting-item-description" }).setText(
      t("settings.export.layoutModelNote")
    );

    new Setting(containerEl)
      .setName(t("settings.exportFrenchTypography.name"))
      .setDesc(t("settings.exportFrenchTypography.desc"))
      .addToggle((t2) =>
        t2.setValue(S.exportFrenchTypography !== false).onChange(async (v) => {
          S.exportFrenchTypography = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.export.pdfOnlyHeader")
    );

    new Setting(containerEl)
      .setName(t("settings.pdfHeaderLeft.name"))
      .setDesc(t("settings.pdfHeaderLeft.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfHeaderLeft || "{title}").onChange(async (v) => {
          S.pdfHeaderLeft = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pdfHeaderRight.name"))
      .setDesc(t("settings.pdfHeaderRight.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfHeaderRight || "{author}").onChange(async (v) => {
          S.pdfHeaderRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pdfDiffHeaders.name"))
      .setDesc(t("settings.pdfDiffHeaders.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.pdfDiffHeaders).onChange(async (v) => {
          S.pdfDiffHeaders = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pdfHideFirstPageHeader.name"))
      .addToggle((t2) =>
        t2.setValue(S.pdfHideFirstPageHeader ?? true).onChange(async (v) => {
          S.pdfHideFirstPageHeader = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.pdfFooterRight.name"))
      .setDesc(t("settings.pdfFooterRight.desc"))
      .addText((t2) =>
        t2.setValue(S.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
          S.pdfFooterRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.pdfMarginTop.name"))
      .addText((t2) =>
        t2.setValue(String(S.pdfMarginTop ?? 2.5)).onChange(async (v) => {
          S.pdfMarginTop = parseFloat(v) || 2.5;
          S.pdfMarginBottom = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pdfMarginLeft.name"))
      .addText((t2) =>
        t2.setValue(String(S.pdfMarginLeft ?? 2.5)).onChange(async (v) => {
          S.pdfMarginLeft = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pdfMirrorMargins.name"))
      .addToggle((t2) =>
        t2.setValue(!!S.pdfMirrorMargins).onChange(async (v) => {
          S.pdfMirrorMargins = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.export.epubOnlyHeader")
    );

    new Setting(containerEl)
      .setName(t("settings.epubLanguage.name"))
      .setDesc(t("settings.epubLanguage.desc"))
      .addText((t2) =>
        t2.setValue(S.epubLanguage).onChange(async (v) => {
          S.epubLanguage = v.trim() || "fr";
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("settings.export.pandocOnlyHeader")
    );

    new Setting(containerEl)
      .setName(t("settings.pandocReference.name"))
      .setDesc(t("settings.pandocReference.desc"))
      .addText((t2) =>
        t2.setValue(S.pandocReference).onChange(async (v) => {
          S.pandocReference = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.pandocPath.name"))
      .setDesc(t("settings.pandocPath.desc"))
      .addText((t2) =>
        t2.setValue(S.pandocPath).onChange(async (v) => {
          S.pandocPath = v.trim() || "pandoc";
          await this.plugin.saveSettings();
        })
      );

    this.organizeSections(containerEl);
  }

  /** Regroupe les réglages en onglets (Projet, Écriture, Interface,
   * Panneaux latéraux, Correction, Export) avec sous-sections repliables.
   *
   * Stratégie en deux temps :
   *   1. Classifier — parcourir containerEl.children, lire les marqueurs
   *      .feuillets-settings-section pour savoir où va chaque nœud.
   *      Aucune modification du DOM à ce stade.
   *   2. Reconstruire — containerEl.empty(), puis réinsérer l'en-tête,
   *      la barre d'onglets et les panneaux. Les nœuds détachés lors du
   *      empty() sont réassignés à leur <details> via appendChild.
   *
   * style.display = "none" plutôt que toggleVisibility() : comportement
   * garanti identique dans toutes les versions d'Obsidian. */
  organizeSections(containerEl: HTMLElement): void {
    const ORDER = ["Projet", "Écriture", "Interface", "Panneaux latéraux", "Correction", "Export"];
    const CATEGORY_LABELS: Record<string, string> = {
      "Projet": t("settings.category.project"),
      "Écriture": t("settings.category.writing"),
      "Interface": t("settings.category.interface"),
      "Panneaux latéraux": t("settings.category.sidePanels"),
      "Correction": t("settings.category.grammar"),
      "Export": t("settings.category.export"),
    };

    // --- Passe 1 : classification, sans toucher au DOM ---
    type SubSection = { title: string | null; openByDefault?: boolean; nodes: HTMLElement[] };
    const byCategory: Record<string, SubSection[]> = {};
    for (const name of ORDER) byCategory[name] = [];
    let currentCategory = "Projet";
    let currentSub: SubSection | null = null;
    let header: HTMLElement | null = null;

    for (const node of Array.from(containerEl.children) as HTMLElement[]) {
      if (node.classList.contains("feuillets-settings-header")) {
        header = node; // conservé séparément, réinséré après empty()
        continue;
      }
      if (node.classList.contains("feuillets-settings-section")) {
        /* La catégorie est portée par l'attribut data-cat du marqueur,
           posé à la création — voir les createDiv({ attr: { "data-cat": … }})
           dans display(). Un marqueur sans data-cat valide avertit en console
           et tombe dans "Projet" plutôt que de disparaître silencieusement. */
        const cat = node.getAttr("data-cat");
        if (!cat || !ORDER.includes(cat)) {
          console.warn(`Feuillets : section "${node.textContent}" sans data-cat valide — Projet par défaut.`);
        }
        currentCategory = (cat && ORDER.includes(cat)) ? cat : "Projet";
        /* data-open sur le marqueur plutôt qu'une comparaison avec le titre
           traduit : la comparaison casserait silencieusement en anglais. */
        currentSub = {
          title: node.textContent,
          openByDefault: node.getAttr("data-open") === "1",
          nodes: [],
        };
        byCategory[currentCategory].push(currentSub);
        continue; // le marqueur lui-même ne sera pas réinséré
      }
      if (currentSub) currentSub.nodes.push(node);
      else byCategory[currentCategory].push({ title: null, nodes: [node] });
    }

    if (!this._activeSettingsTab || !ORDER.includes(this._activeSettingsTab)) {
      this._activeSettingsTab = ORDER[0];
    }

    // --- Reconstruction : table rase puis réinsertion ---
    // containerEl.empty() détache tous les nœuds mais leurs références JS
    // (stockées dans byCategory) restent valides — on peut les réappendre.
    containerEl.empty();
    if (header) containerEl.appendChild(header);

    // Passe 2 : barre d'onglets
    const tabBar = containerEl.createDiv({ cls: "feuillets-settings-tabs" });
    for (const name of ORDER) {
      const btn = tabBar.createEl("button", {
        cls: "feuillets-settings-tab-btn",
        text: CATEGORY_LABELS[name] || name,
      });
      if (name === this._activeSettingsTab) btn.addClass("is-active");
      btn.addEventListener("click", () => {
        if (this._activeSettingsTab === name) return;
        this._activeSettingsTab = name;
        this.display();
      });
    }

    // Passe 3 : panneaux — un seul visible, les autres cachés.
    // style.display plutôt que toggleVisibility() : comportement garanti
    // identique dans toutes les versions d'Obsidian.
    for (const name of ORDER) {
      const panel = containerEl.createDiv({ cls: "feuillets-settings-panel" });
      if (name !== this._activeSettingsTab) panel.setCssProps({ display: "none" });

      for (const sub of byCategory[name]) {
        if (!sub.title) {
          for (const n of sub.nodes) panel.appendChild(n);
          continue;
        }
        // createEl() Obsidian plutôt que document.createElement() :
        // les méthodes Obsidian (addClass, setText…) sont disponibles sur l'élément.
        const subDet = panel.createEl("details", { cls: "feuillets-settings-subsection" });
        if (sub.openByDefault) subDet.setAttribute("open", "");
        subDet.createEl("summary", { cls: "feuillets-settings-subhead", text: sub.title });
        for (const n of sub.nodes) subDet.appendChild(n);
      }
    }
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
