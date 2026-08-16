export function getLanguage() {
  return "fr";
}

export function setIcon(element, icon) {
  if (element && typeof element === "object") element.icon = icon;
}

export class Component {
  load() {}
  unload() {}
}

export class Plugin {}

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.contentEl = leaf.contentEl;
    /* Références d'événements enregistrées via registerEvent — Obsidian les
       désabonne à la fermeture de la vue. Conservées ici pour que les tests
       puissent vérifier le nettoyage. */
    this._registeredEvents = [];
  }
  registerEvent(eventRef) {
    this._registeredEvents.push(eventRef);
    return eventRef;
  }
  /* État de vue : Obsidian les définit sur View, les sous-classes appellent
     super.setState() après avoir lu le leur. */
  async setState() {}
  getState() { return {}; }
  /* Écouteurs DOM : Obsidian les retire à la fermeture de la vue. Conservés
     ici pour que les tests puissent les déclencher et vérifier le nettoyage. */
  registerDomEvent(el, type, handler) {
    if (!this._domEvents) this._domEvents = [];
    this._domEvents.push({ el, type, handler });
    if (el && typeof el.addEventListener === "function") el.addEventListener(type, handler);
  }
}

export const MarkdownRenderer = {
  async render() {},
};

export const Platform = {
  isMobile: false,
  isDesktop: true,
};

export class TFile {
  constructor(path, content = "") {
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.md$/, "");
    this.extension = this.name.split(".").pop();
    this.content = content;
  }
}

export class TFolder {
  constructor(path, children = []) {
    this.path = path;
    this.name = path.split("/").pop();
    this.children = children;
    this.parent = null;
  }
}

export class Notice {
  static onCreate = null;

  constructor(message) {
    this.message = message;
    Notice.onCreate?.(message);
  }
}

export class Modal {
  constructor(app) {
    this.app = app;
  }
  close() {}
  open() {}
}

/* Setting : réplique légère mais RÉELLE (DOM factice construit via
   containerEl.createDiv/createEl, comme le vrai Obsidian) de l'API fluide —
   nécessaire depuis que plusieurs panneaux (ui/*-panel.ts, ui/export-
   panel.ts, views/edition-layout-view.ts) l'utilisent pour leur rendu
   natif (Phase 11B). Deux contraintes historiques à respecter à l'identique
   pour ne rien casser ailleurs :
   - `container._settings` (tableau des instances Setting posées sur ce
     conteneur) et `.controls` (tableau des contrôles ajoutés, dans l'ordre)
     restent alimentés exactement comme avant — test/scenes-editor-i18n.js
     et test/edition-composition-content.js (settingNames()) en dépendent.
   - `setDesc`/`addToggle`/`addButton`/`addDropdown` restent utilisables
     SANS qu'un test doive fournir son propre DOM factice enrichi : le
     constructeur crée lui-même settingEl/infoEl/nameEl/descEl/controlEl via
     `container.createDiv(...)` (présent sur tous les FakeElement du dépôt),
     et chaque addXxx() crée à son tour un élément réel (toggleEl, buttonEl,
     selectEl, inputEl, extraSettingsEl) qu'un test peut retrouver par
     querySelector (ex. `[aria-label="…"]`), exactement comme pour un champ
     construit à la main. Un test qui préfère monkey-patcher Setting.prototype
     (voir installSettingStub(), test/layout-modal.test.js et test/edition-
     composition-view.test.js) reste libre de le faire : ces addXxx() sont
     alors simplement remplacées, `controlEl` (posé au constructeur, jamais
     patché) continue lui d'exister — export-panel.ts s'appuie dessus
     directement pour "Portée", en dehors de tout addXxx(). */
export class Setting {
  constructor(container) {
    this.container = container;
    this.name = "";
    this.desc = "";
    this.controls = [];
    if (container && Array.isArray(container._settings)) container._settings.push(this);
    else if (container) container._settings = [this];

    this.settingEl = container?.createDiv ? container.createDiv({ cls: "setting-item" }) : container;
    this.infoEl = this.settingEl.createDiv ? this.settingEl.createDiv({ cls: "setting-item-info" }) : this.settingEl;
    this.nameEl = this.infoEl.createDiv ? this.infoEl.createDiv({ cls: "setting-item-name" }) : this.infoEl;
    this.descEl = this.infoEl.createDiv ? this.infoEl.createDiv({ cls: "setting-item-description" }) : this.infoEl;
    this.controlEl = this.settingEl.createDiv ? this.settingEl.createDiv({ cls: "setting-item-control" }) : this.settingEl;
  }
  setName(name) {
    this.name = name;
    if (this.nameEl?.setText) this.nameEl.setText(name); else if (this.nameEl) this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc) {
    this.desc = desc;
    if (this.descEl?.setText) this.descEl.setText(desc); else if (this.descEl) this.descEl.textContent = desc;
    return this;
  }
  setClass(cls) { this.settingEl?.addClass?.(cls); return this; }
  setTooltip(text) { this.settingEl?.setAttribute?.("aria-label", text); return this; }
  then(cb) { cb(this); return this; }
  addDropdown(cb) {
    const selectEl = this.controlEl?.createEl ? this.controlEl.createEl("select", { cls: "dropdown" }) : undefined;
    const control = {
      type: "dropdown",
      selectEl,
      options: [],
      value: "",
      addOption(v, label) {
        this.options.push({ value: v, label });
        selectEl?.createEl?.("option", { value: v, text: label });
        return this;
      },
      setValue(v) { this.value = v; if (selectEl) selectEl.value = v; return this; },
      setDisabled(v) { this.disabled = v; return this; },
      onChange(fn) {
        this.changeHandler = fn;
        selectEl?.addEventListener?.("change", () => fn(selectEl.value));
        return this;
      },
      select(v) { this.value = v; if (selectEl) selectEl.value = v; return this.changeHandler ? this.changeHandler(v) : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
  addToggle(cb) {
    const toggleEl = this.controlEl?.createEl ? this.controlEl.createEl("div", { cls: "checkbox-container" }) : undefined;
    const control = {
      type: "toggle",
      toggleEl,
      value: false,
      setValue(v) { this.value = v; toggleEl?.toggleClass?.("is-enabled", v); return this; },
      setTooltip(text) { this.tooltip = text; toggleEl?.setAttribute?.("aria-label", text); return this; },
      setDisabled(v) { this.disabled = v; return this; },
      onChange(fn) { this.changeHandler = fn; return this; },
      toggle(v) { this.value = v; toggleEl?.toggleClass?.("is-enabled", v); return this.changeHandler ? this.changeHandler(v) : undefined; },
    };
    /* Comme le vrai ToggleComponent d'Obsidian : cliquer sur toggleEl
       inverse l'état ET déclenche onChange — un test peut donc simuler un
       clic utilisateur avec `toggleEl.click()`/`toggleEl.dispatch("click")`
       plutôt que de passer par le contrôle renvoyé par addToggle(). */
    toggleEl?.addEventListener?.("click", () => {
      control.value = !control.value;
      toggleEl.toggleClass?.("is-enabled", control.value);
      control.changeHandler?.(control.value);
    });
    cb(control);
    this.controls.push(control);
    return this;
  }
  addButton(cb) {
    const buttonEl = this.controlEl?.createEl ? this.controlEl.createEl("button", { cls: "clickable-icon" }) : undefined;
    const control = {
      type: "button",
      buttonEl,
      text: "",
      setButtonText(text) { this.text = text; buttonEl?.setText?.(text); return this; },
      setIcon(icon) { this.icon = icon; if (buttonEl) buttonEl.icon = icon; return this; },
      setTooltip(text) { this.tooltip = text; buttonEl?.setAttribute?.("aria-label", text); return this; },
      setCta() { this.cta = true; buttonEl?.addClass?.("mod-cta"); return this; },
      setWarning() { this.warning = true; buttonEl?.addClass?.("mod-warning"); return this; },
      setDisabled(v) { this.disabled = v; return this; },
      onClick(fn) {
        this.clickHandler = fn;
        buttonEl?.addEventListener?.("click", () => fn());
        return this;
      },
      click() { return this.clickHandler ? this.clickHandler() : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
  addExtraButton(cb) {
    const extraSettingsEl = this.controlEl?.createEl
      ? this.controlEl.createEl("div", { cls: "clickable-icon extra-setting-button" })
      : undefined;
    const control = {
      type: "extra",
      extraSettingsEl,
      setIcon(icon) { this.icon = icon; if (extraSettingsEl) extraSettingsEl.icon = icon; return this; },
      setTooltip(text) { this.tooltip = text; extraSettingsEl?.setAttribute?.("aria-label", text); return this; },
      setDisabled(v) { this.disabled = v; return this; },
      onClick(fn) {
        this.clickHandler = fn;
        extraSettingsEl?.addEventListener?.("click", () => fn());
        return this;
      },
      click() { return this.clickHandler ? this.clickHandler() : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
  addText(cb) {
    const inputEl = this.controlEl?.createEl ? this.controlEl.createEl("input", { type: "text" }) : undefined;
    const control = {
      type: "text",
      inputEl,
      value: "",
      setValue(v) { this.value = v; if (inputEl) inputEl.value = v; return this; },
      setPlaceholder(p) { this.placeholder = p; inputEl?.setAttribute?.("placeholder", p); return this; },
      setDisabled(v) { this.disabled = v; return this; },
      onChange(fn) {
        this.changeHandler = fn;
        inputEl?.addEventListener?.("change", () => fn(inputEl.value));
        return this;
      },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
}

export class MarkdownView {}

/* Sentinelle distincte : les tests construisent leur propre état CM fake et
   reconnaissent cette valeur exacte pour répondre à `state.field(...)`. */
export const editorInfoField = { __brand: "editorInfoField" };

export class Menu {
  constructor() {
    this.items = [];
  }
  addItem(cb) {
    const item = {
      title: "",
      icon: "",
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setChecked(v) { this.checked = v; return this; },
      setDisabled(v) { this.disabled = v; return this; },
      setWarning(v) { this.warning = v; return this; },
      onClick(fn) { this.callback = fn; return this; },
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    this.items.push({ separator: true });
    return this;
  }
  showAtPosition(pos) {
    this.position = pos;
    Menu.lastShown = this;
    return this;
  }
  showAtMouseEvent(event) {
    this.event = event;
    Menu.lastShown = this;
    return this;
  }
}
Menu.lastShown = null;

export class Keymap {}

export class FuzzySuggestModal {}

export class PopoverSuggest {
  constructor(app) {
    this.app = app;
  }
  open() {}
  close() {}
}

export class AbstractInputSuggest extends PopoverSuggest {
  constructor(app, textInputEl) {
    super(app);
    this.textInputEl = textInputEl;
    this.limit = 100;
  }
  setValue(value) {
    this.textInputEl.value = value;
  }
  getValue() {
    return this.textInputEl.value;
  }
  onSelect(callback) {
    this._onSelect = callback;
    return this;
  }
}

export function setTooltip() {}

export class ButtonComponent {
  constructor(container) {
    this.container = container;
    this.container.buttonComponents ||= [];
    this.container.buttonComponents.push(this);
  }

  setButtonText(text) {
    this.text = text;
    return this;
  }

  setWarning() {
    this.warning = true;
    return this;
  }

  onClick(callback) {
    this.callback = callback;
    return this;
  }
}

export class DropdownComponent {
  constructor(container) {
    this.container = container;
    this.options = [];
  }

  addOption(value, label) {
    this.options.push({ value, label });
    return this;
  }

  setValue(value) {
    this.value = value;
    return this;
  }

  onChange(callback) {
    this.callback = callback;
    return this;
  }
}

export function stringifyYaml(value) {
  return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("\n");
}

export function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "");
}
