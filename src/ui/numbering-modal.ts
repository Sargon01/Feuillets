import { App, Modal, Setting, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { createCompositionBinding, type CompositionBindingHost } from "../services/ouvrage-composition.js";

/** Minimal host this modal needs — exactly `CompositionBindingHost` (the
 * same contract `createCompositionBinding()` already requires everywhere
 * else) plus the two unit-label helpers used to phrase the scene/section
 * numbering option, unchanged from EditionCompositionContent's own
 * renderStructureSection(). No other plugin surface is used. */
export type NumberingModalPlugin = CompositionBindingHost & {
  unitLabel(): string;
  unitLabelPlural(): string;
};

/** Binder shortcut to the three structure fields that drive the numbering
 * already visible in the Binder — level1Role, chapterNumbering,
 * sceneNumbering. Not a second settings surface: every read and write goes
 * through `createCompositionBinding()`, the exact same binding Édition →
 * Composition → Le manuscrit → Structure uses, so both stay perfectly in
 * sync with no dedicated synchronization logic. Deliberately excludes
 * autoRename/renamePrefix/titles/separator/footnotes/presets — those remain
 * Composition-only (see renderStructureSection, edition-composition-content.ts). */
export class NumberingModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: NumberingModalPlugin,
    private readonly globalRoot: TFolder,
    private readonly editorialRoot: TFolder = globalRoot
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Rebuilds the whole modal body, including a FRESH binding read from the
   * current settings — same pattern as Composition's own refreshBinding():
   * after `binding.update()` has just written a field, the next render must
   * reflect the value actually stored (relevant once an ouvrage's binding
   * flips from inherited to local after its first write), never a stale
   * `value` captured before that write. */
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-numbering-modal");
    contentEl.createEl("h3", { text: t("binder.numbering") });

    const binding = createCompositionBinding(this.plugin, this.globalRoot, this.editorialRoot);
    const value = binding.value;
    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();

    const update = (patch: Partial<OuvrageCompositionConfig>) => {
      void binding.update(patch).then(() => this.render());
    };

    new Setting(contentEl)
      .setName(t("settings.level1Role.name"))
      .addDropdown((dropdown) => {
        dropdown.addOption("parties", t("settings.level1Role.parts"));
        dropdown.addOption("chapitres", t("settings.level1Role.chapters", { unitPlural }));
        dropdown.setValue(value.level1Role);
        dropdown.onChange((v) => update({ level1Role: v as OuvrageCompositionConfig["level1Role"] }));
      });

    new Setting(contentEl)
      .setName(t("settings.chapterNumbering.name"))
      .addDropdown((dropdown) => {
        dropdown.addOption("continu", t("settings.chapterNumbering.continuous"));
        dropdown.addOption("parPartie", t("settings.chapterNumbering.perPart"));
        dropdown.addOption("aucune", t("settings.chapterNumbering.none"));
        dropdown.setValue(value.chapterNumbering);
        dropdown.onChange((v) => update({ chapterNumbering: v as OuvrageCompositionConfig["chapterNumbering"] }));
      });

    new Setting(contentEl)
      .setName(t("settings.sceneNumbering.name", { unitPlural }))
      .addDropdown((dropdown) => {
        dropdown.addOption("hier", t("settings.sceneNumbering.hierarchical", { unit }));
        dropdown.addOption("continue", t("settings.sceneNumbering.continuous"));
        dropdown.addOption("aucune", t("settings.chapterNumbering.none"));
        dropdown.setValue(value.sceneNumbering);
        dropdown.onChange((v) => update({ sceneNumbering: v as OuvrageCompositionConfig["sceneNumbering"] }));
      });
  }
}
