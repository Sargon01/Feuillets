import { Modal, Notice, type App } from "obsidian";
import { getLocale } from "../i18n/index.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";
import {
  isPresentationColor,
  resolvePresentationTheme,
  resetPresentationThemeCustomization,
  validatePresentationThemeName,
  type PresentationThemeColors,
  type PresentationThemeCustomizations,
  type PresentationThemeId,
  type PresentationCalloutColors,
} from "../services/presentation-theme.js";

type ThemeModalPlugin = {
  settings: { presentationThemes: PresentationThemeCustomizations };
  saveSettings(): Promise<void>;
  refreshPresentationAppearance?(): Promise<void>;
};

export class PresentationThemeModal extends Modal {
  private readonly plugin: ThemeModalPlugin;
  private readonly id: PresentationThemeId;
  private readonly onApplied: () => void | Promise<void>;
  private draft: ReturnType<typeof resolvePresentationTheme>;

  constructor(app: App, plugin: ThemeModalPlugin, id: PresentationThemeId, onApplied: () => void | Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.id = id;
    this.onApplied = onApplied;
    this.draft = resolvePresentationTheme(id, plugin.settings.presentationThemes, getLocale());
  }

  onOpen(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl("h2", { text: this.draft.name });
    const name = root.createEl("input", { type: "text" });
    name.value = this.draft.name;
    root.createEl("h3", { text: "Couleurs générales" });
    const colorInputs = new Map<keyof PresentationThemeColors, HTMLInputElement>();
    for (const key of Object.keys(this.draft.colors) as (keyof PresentationThemeColors)[]) {
      const row = root.createDiv({ cls: "setting-item" });
      row.createDiv({ text: key });
      const input = row.createEl("input", { type: "color" });
      input.value = this.draft.colors[key];
      colorInputs.set(key, input);
    }
    root.createEl("h3", { text: "Couleurs des callouts" });
    const calloutInputs = new Map<SemanticRole, { accent: HTMLInputElement; body: HTMLInputElement }>();
    for (const role of SEMANTIC_ROLES) {
      const row = root.createDiv({ cls: "setting-item" });
      row.createDiv({ text: role });
      const accent = row.createEl("input", { type: "color" }); accent.value = this.draft.callouts[role].accent;
      const body = row.createEl("input", { type: "color" }); body.value = this.draft.callouts[role].body;
      calloutInputs.set(role, { accent, body });
    }
    const buttons = root.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: "Annuler" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: "Réinitialiser" }).addEventListener("click", () => {
      this.draft = resolvePresentationTheme(this.id, resetPresentationThemeCustomization(this.plugin.settings.presentationThemes, this.id), getLocale());
      this.onOpen();
    });
    buttons.createEl("button", { text: "Appliquer", cls: "mod-cta" }).addEventListener("click", () => {
      const customizations = { ...this.plugin.settings.presentationThemes };
      const colors = {} as Partial<PresentationThemeColors>;
      for (const [key, input] of colorInputs) if (isPresentationColor(input.value)) colors[key] = input.value.toUpperCase();
      const callouts = {} as Record<SemanticRole, Partial<PresentationCalloutColors>>;
      for (const role of SEMANTIC_ROLES) {
        const inputs = calloutInputs.get(role);
        if (inputs) callouts[role] = { accent: inputs.accent.value.toUpperCase(), body: inputs.body.value.toUpperCase() };
      }
      const error = validatePresentationThemeName(name.value, this.id, customizations);
      if (error) { new Notice(error); return; }
      customizations[this.id] = { name: name.value.trim(), colors, callouts };
      this.plugin.settings.presentationThemes = customizations;
      void this.plugin.saveSettings()
        .then(() => this.plugin.refreshPresentationAppearance?.())
        .then(() => this.onApplied())
        .then(() => this.close());
    });
  }
}
