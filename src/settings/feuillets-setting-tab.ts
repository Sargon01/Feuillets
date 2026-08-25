import { YAML_PRESETS } from "../scenes-editor.js";
import { BOARD_MODES } from "../constants.js";
import { setLocale, detectLocale, t } from "../i18n/index.js";
import { getProjectMode } from "../services/project-mode.js";
import {
  BINDER_PREVIEW_MAX_LINES,
  binderPreviewFieldChoices,
  binderPreviewSemanticField,
  clampBinderPreviewLines,
  resolveBinderPreviewField,
} from "../utils/binder-preview.js";
import type { DefaultSettings } from "../default-settings.js";
import { renderCategoryTabBar } from "./settings-category-tabs.js";
import {
  PluginSettingTab,
  Setting,
  TFolder,
  Notice,
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
  syncProjectEditorScope(): void;
  refreshPresentationRoleDisplay(): Promise<void>;
  refreshPresentationAppearance(): Promise<void>;
  applyIndentClass(): void;
  applyLeanInterfaceClasses(): void;
  removeConcentrationCounter(): void;
  getVaultConfig(key: string): unknown;
  setVaultConfig(key: string, value: unknown): void;
  backupProjectNow(): Promise<void>;
  hidePanel(key: string): Promise<void>;

};

/* Migré vers l'API déclarative `getSettingDefinitions()` (Obsidian ≥ 1.13.0,
   voir manifest.json). La barre d'onglets persistante par catégorie
   (Projet/Écriture/Interface/Panneaux latéraux/Correction/Export) est
   reconstruite « à la main » dans un item `render()` (composant isolé
   `settings-category-tabs.ts`) plutôt qu'avec la navigation native en
   profondeur (`SettingDefinitionPage`). `_activeSettingsTab` reste la seule
   source de vérité et `this.update()` remplace les anciens `this.display()`.

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
    /* §19 du chantier « espace central » : plus d'onglet « Composition &
       export » dans les Paramètres — ces réglages de FABRICATION du livre
       vivent désormais dans l'espace central Édition (Composition / Export).
       AUCUNE clé persistée n'est supprimée pour autant : ce chantier déplace
       l'interface, pas le stockage (data.json legacy reste valide).

       §26/Phase E du chantier « panneau Projet + métadonnées + mapping
       YAML » : plus d'onglet « Projet » non plus — les neuf réglages qu'il
       exposait (type, style de citation, statuts, labels, tags favoris,
       objectif par défaut, tolérance, objectif global, date limite,
       objectif de session) ont chacun un équivalent testé et ÉCRIVABLE
       dans le panneau latéral Projet (views/sidebar-feuillets-view.ts).
       Là encore, AUCUNE clé persistée n'est supprimée : les anciennes
       valeurs globales (S.wordGoal, S.tolerance, S.statuses, S.labels,
       S.favoriteTags, S.projectWordGoal, S.deadlineDate, S.sessionGoal)
       restent les replis legacy que services/project-settings.ts et
       ProjectMeta.propertyMap continuent de lire pour tout projet sans
       surcharge. */
    const ORDER = ["Écriture", "Interface", "Vues", "Sauvegarde & historique"];
    const CATEGORY_LABELS: Record<string, string> = {
      "Écriture": t("settings.category.writing"),
      "Interface": t("settings.category.interface"),
      "Vues": t("settings.category.views"),
      "Sauvegarde & historique": t("settings.category.backupHistory"),
    };
    if (!this._activeSettingsTab || !ORDER.includes(this._activeSettingsTab)) {
      this._activeSettingsTab = ORDER[0];
    }

    const categoryRenderers: Record<string, (container: HTMLElement) => void> = {
      "Écriture": (c) => this.renderEcritureCategory(c),
      "Interface": (c) => this.renderInterfaceCategory(c),
      "Vues": (c) => this.renderPanneauxCategory(c),
      "Sauvegarde & historique": (c) => this.renderBackupCategory(c),
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
          // quel que soit _activeSettingsTab (par défaut "Écriture").
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
      .setName(t("settings.roleEditorDisplay.name"))
      .setDesc(t("settings.roleEditorDisplay.desc"))
      .addDropdown((d) =>
        d
          .addOption("callouts", t("settings.roleEditorDisplay.callouts"))
          .addOption("compact", t("settings.roleEditorDisplay.compact"))
          .setValue(S.roleEditorDisplay || "callouts")
          .onChange(async (v) => {
            S.roleEditorDisplay = v as DefaultSettings["roleEditorDisplay"];
            await this.plugin.saveSettings();
            this.plugin.syncProjectEditorScope();
            await this.plugin.refreshPresentationRoleDisplay();
          })
      );

    new Setting(container)
      .setName(t("settings.readingFontSize.name"))
      .setDesc(t("settings.readingFontSize.desc"))
      .addSlider((s) =>
        s
          .setLimits(0, 28, 1)
          .setValue(S.readingFontSize)
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
  private renderBackupCategory(container: HTMLElement): void {
    const S = this.plugin.settings;
    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.history") });
    new Setting(container)
      .setName(t("settings.statsRetention.name"))
      .setDesc(t("settings.statsRetention.desc"))
      .addText((input) => input.setValue(String(S.statsRetention)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        S.statsRetention = isNaN(parsed) ? 120 : Math.max(0, parsed);
        await this.plugin.saveSettings();
      }));
    container.createDiv({ cls: "feuillets-settings-subhead", text: t("settings.section.backup") });
    new Setting(container)
      .setName(t("settings.backupEnabled.name"))
      .setDesc(t("settings.backupEnabled.desc"))
      .addToggle((toggle) => toggle.setValue(S.backupEnabled).onChange(async (value) => {
        S.backupEnabled = value;
        await this.plugin.saveSettings();
        this.update();
      }));
    if (!S.backupEnabled) return;
    new Setting(container).setName(t("settings.backupInterval.name")).addText((input) =>
      input.setValue(String(S.backupIntervalMinutes)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        S.backupIntervalMinutes = isNaN(parsed) ? 30 : Math.max(1, parsed);
        await this.plugin.saveSettings();
      }));
    new Setting(container)
      .setName(t("settings.backupKeepCount.name"))
      .setDesc(t("settings.backupKeepCount.desc"))
      .addText((input) => input.setValue(String(S.backupKeepCount)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        S.backupKeepCount = isNaN(parsed) ? 5 : Math.max(1, parsed);
        await this.plugin.saveSettings();
      }));
    new Setting(container).setName(t("settings.backupNow.name")).addButton((button) =>
      button.setButtonText(t("settings.backupNow.btn")).onClick(() => this.plugin.backupProjectNow()));
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
      .setName(t("settings.dimTabActions.name"))
      .setDesc(t("settings.dimTabActions.desc"))
      .addToggle((t2) =>
        t2.setValue(!!S.uiDimTabActions).onChange(async (v) => {
          S.uiDimTabActions = v;
          await this.plugin.saveSettings();
          this.plugin.applyLeanInterfaceClasses();
        })
      );


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

    /* §23 du LOT "binder isolé + simplification cartes/plan" : la
       personnalisation des Cartes (Portée/Contenu/Taille) se fait
       désormais uniquement dans le menu local de la vue Cartes — plus de
       doublon ici pour tileSize/columns/cardContent/showCardTags/
       excerptLength/showProgress. Ces propriétés restent en donnée pour
       compatibilité (anciens réglages), simplement retirées de cette UI. */

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
      .setName(t("settings.autoOpenInspector.name"))
      .setDesc(t("settings.autoOpenInspector.desc"))
      .addToggle((t2) =>
        t2.setValue(S.autoOpenInspector).onChange(async (v) => {
          S.autoOpenInspector = v;
          await this.plugin.saveSettings();
        })
      );

    const activeInspectorTab = () =>
      S.activeRightPanelTab === "analyse" ? "stats" :
      S.activeRightPanelTab === "docx" ? "relecture" :
      S.activeRightPanelTab === "metadata" ? "notes" :
      S.activeRightPanelTab === "notes" || S.activeRightPanelTab === "research" ||
      S.activeRightPanelTab === "journal" || S.activeRightPanelTab === "project" ||
      S.activeRightPanelTab === "stats" || S.activeRightPanelTab === "relecture"
        ? S.activeRightPanelTab
        : "notes";
    new Setting(container)
      .setName(t("settings.inspectorInitialTab.name"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("notes", t("sidebar.tab.notes"))
          .addOption("research", t("sidebar.tab.research"))
          .addOption("journal", t("sidebar.tab.journal"))
          .addOption("project", t("sidebar.tab.edition"))
          .addOption("stats", t("sidebar.tab.stats"))
          .addOption("relecture", t("sidebar.tab.proofreading"))
          .setValue(activeInspectorTab())
          .onChange(async (value) => {
            S.activeRightPanelTab = value;
            await this.plugin.saveSettings();
          });
      });

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
    const inspectorTabs = [
      ["notes", t("sidebar.tab.notes")],
      ["research", t("sidebar.tab.research")],
      ["journal", t("sidebar.tab.journal")],
      ["project", t("sidebar.tab.edition")],
      ["stats", t("sidebar.tab.stats")],
      ["relecture", t("sidebar.tab.proofreading")],
    ];
    const hiddenPanels = new Set(S.hiddenPanels || []);
    for (const [key, label] of inspectorTabs) {
      new Setting(container).setName(label).addToggle((t2) =>
        t2.setValue(!hiddenPanels.has(key)).onChange(async (v) => {
          const set = new Set(S.hiddenPanels || []);
          if (!v) {
            const visibleTabs = inspectorTabs.filter(([tabId]) => !set.has(tabId));
            if (visibleTabs.length === 1 && visibleTabs[0][0] === key) {
              new Notice(t("settings.inspector.keepOneTab"));
              return;
            }
            set.add(key);
            if (activeInspectorTab() === key) {
              S.activeRightPanelTab = inspectorTabs.find(([tabId]) => !set.has(tabId))![0];
            }
          } else {
            set.delete(key);
          }
          S.hiddenPanels = [...set];
          await this.plugin.saveSettings();
          this.plugin.renderAllViews(true);
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

    /* Micro-lot "simplification définitive du Binder" + ajustement "aperçu
       du Binder" : puces de tags, statut, barres de progression et nombre
       de mots retirés — devenus sans effet dans le Binder (voir
       feuillets-view.ts renderFileRow). Leurs clés de réglage restent en
       place pour compatibilité, simplement plus proposées ici. */

    /* Grammaire d'aperçu partagée avec le menu local du Binder
       (showSplitPaneOptionsMenu, feuillets-view.ts) : jamais synopsis ET
       summary ensemble, jamais notes/tags — un seul champ sémantique, celui
       du mode courant (mode.defaults.cardContent, déjà lu ci-dessus).
       `mode?.defaults?.cardContent` : défensif pour les faux plugins de
       test qui ne fournissent pas cette forme complète. */
    const semanticField = binderPreviewSemanticField(mode?.defaults?.cardContent);
    const previewFieldLabels: Record<string, string> = {
      none: t("binder.preview.none"),
      extrait: t("binder.preview.excerpt"),
      synopsis: t("binder.preview.synopsis"),
      summary: t("binder.preview.summary"),
    };
    const effectivePreviewField = resolveBinderPreviewField(S.listPanePreviewField, semanticField);

     new Setting(container)
      .setName(t("settings.previewField.name"))
      .setDesc(t("settings.previewField.desc"))
      .addDropdown((d) => {
        for (const key of binderPreviewFieldChoices(semanticField)) {
          d.addOption(key, previewFieldLabels[key]);
        }
        return d
          .setValue(effectivePreviewField)
          .onChange(async (v) => {
            S.listPanePreviewField = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          });
      });

     new Setting(container)
      .setName(t("settings.previewLines.name"))
      .addSlider((s) =>
        s
          .setLimits(1, BINDER_PREVIEW_MAX_LINES, 1)
          .setValue(clampBinderPreviewLines(S.listPanePreviewLines))
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

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.tab.proofreading") });
    new Setting(container)
      .setName(t("settings.autoAnalyzeInRelecture.name"))
      .setDesc(t("settings.autoAnalyzeInRelecture.desc"))
      .addToggle((toggle) => toggle.setValue(S.autoAnalyzeInRelecture !== false).onChange(async (value) => {
        S.autoAnalyzeInRelecture = value;
        await this.plugin.saveSettings();
      }));

  }
  /* §19/§20 : `renderExportCategory` a été SUPPRIMÉE — son interface vit
     désormais dans l'espace central Édition (Composition pour la structure, la
     numérotation, les notes, les informations d'ouvrage et la compilation ;
     Export pour la typographie française ; Mise en page pour le gabarit et la
     géométrie de page V2). AUCUNE clé de réglage n'a été retirée de
     DEFAULT_SETTINGS : seul le point d'entrée d'interface a changé. */

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
