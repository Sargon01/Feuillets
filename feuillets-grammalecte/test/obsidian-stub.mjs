/* Stub minimal de l'API Obsidian : uniquement ce que le compagnon appelle
   réellement. Aucune tentative de reproduire Obsidian — ce qui n'est pas
   utilisé ici n'est pas déclaré. */

export const notices = [];

export class Notice {
  constructor(message) {
    this.message = message;
    notices.push(message);
  }
}

export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.commands = [];
    this.settingTabs = [];
    this._data = null;
  }
  addCommand(command) { this.commands.push(command); return command; }
  addSettingTab(tab) { this.settingTabs.push(tab); return tab; }
  register() {}
  registerEvent() {}
  async loadData() { return this._data; }
  async saveData(data) { this._data = data; }
}

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = null;
  }
}

export class Setting {
  constructor(containerEl) { this.containerEl = containerEl; }
  setName() { return this; }
  setDesc() { return this; }
  addToggle() { return this; }
  addSlider() { return this; }
}

export const Platform = { isDesktop: true, isMobile: false };
