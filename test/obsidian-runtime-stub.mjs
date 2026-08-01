export function setIcon(element, icon) {
  if (element && typeof element === "object") element.icon = icon;
}

export class Component {
  load() {}
  unload() {}
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

/* Setting : API fluide minimale, suffisante pour vérifier qu'un panneau
   déclare bien les bons contrôles ET pour déclencher leurs onChange —
   c'est ce que testent les suites de PreviewView (le réglage doit atteindre
   les settings réels, pas une copie locale). */
export class Setting {
  constructor(container) {
    this.container = container;
    this.name = "";
    this.desc = "";
    this.controls = [];
    if (container && Array.isArray(container._settings)) container._settings.push(this);
    else if (container) container._settings = [this];
  }
  setName(name) { this.name = name; return this; }
  setDesc(desc) { this.desc = desc; return this; }
  addDropdown(cb) {
    const control = {
      type: "dropdown",
      options: [],
      value: "",
      addOption(v, label) { this.options.push({ value: v, label }); return this; },
      setValue(v) { this.value = v; return this; },
      onChange(fn) { this.changeHandler = fn; return this; },
      select(v) { this.value = v; return this.changeHandler ? this.changeHandler(v) : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
  addToggle(cb) {
    const control = {
      type: "toggle",
      value: false,
      setValue(v) { this.value = v; return this; },
      onChange(fn) { this.changeHandler = fn; return this; },
      toggle(v) { this.value = v; return this.changeHandler ? this.changeHandler(v) : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
  addButton(cb) {
    const control = {
      type: "button",
      text: "",
      setButtonText(text) { this.text = text; return this; },
      setCta() { return this; },
      onClick(fn) { this.clickHandler = fn; return this; },
      click() { return this.clickHandler ? this.clickHandler() : undefined; },
    };
    cb(control);
    this.controls.push(control);
    return this;
  }
}

export class MarkdownView {}

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
