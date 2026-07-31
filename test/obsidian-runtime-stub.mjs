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

export class Modal {}

export class Setting {
  constructor(container) {
    this.container = container;
  }
}

export class MarkdownView {}

export class Menu {}

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
