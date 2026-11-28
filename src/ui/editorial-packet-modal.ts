import { Modal, Notice, Setting, TFile, type TFolder, setIcon, setTooltip, type App, type EventRef } from "obsidian";
import { t } from "../i18n/index.js";
import { editorialPacketSources, isLetterSource, packetProjectFiles, packetWorkDestination, preparePacketOutputs, type EditorialPacket, type PacketLetterResolver } from "../services/editorial-packet.js";
import { exportFileName } from "../services/export-destination.js";
import { EditorialPacketPreview } from "./editorial-packet-preview.js";
import type { CslCitationHost } from "../services/csl-citation-host.js";
import { remapPath } from "../carnet/core/path-reference-maintenance.js";

export interface PacketEditorHost {
  app: App;
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  cslCitationHost?: CslCitationHost | null;
}

export class EditorialPacketModal extends Modal {
  private index = -1;
  private plan: EditorialPacket;
  private documents: TFile[];
  private templatePath?: string;
  private renameEvent?: EventRef;
  private editing = false;

  constructor(app: App, private host: PacketEditorHost, private root: TFolder, private edition: TFolder,
    private submit?: (plan: EditorialPacket, onCreated: (path: string) => void) => Promise<string | void>, private letterFor?: PacketLetterResolver,
    private onSubmission?: (path: string) => void,
  ) {
    super(app);
    this.documents = editorialPacketSources(edition, letterFor);
    this.plan = this.newPlan();
    this.templatePath = this.plan.letterSource;
    const active = this.saved().findIndex(plan => plan.projectRoot === root.path);
    if (active >= 0) this.select(active);
  }

  private newPlan(): EditorialPacket {
    const letter = this.edition.children.find(node => node instanceof TFile && isLetterSource(node, this.edition) && !this.letterFor?.(node.path));
    return {
      projectRoot: this.root.path, name: t("packet.defaultName"), sources: [],
      letterSource: letter?.path, format: "composite", manuscript: "none", manuscriptDocx: false, identity: false,
    };
  }

  private saved(): EditorialPacket[] { return this.host.settings.editorialPackets ?? []; }

  private select(index: number): void {
    this.index = index;
    const stored = this.saved()[index];
    this.plan = stored ? { ...stored, sources: [...stored.sources] } : this.newPlan();
    this.templatePath = this.plan.letterSource ?? this.newPlan().letterSource;
  }

  onOpen(): void {
    this.setTitle(t("packet.compose"));
    this.modalEl.addClass("feuillets-packet-form");
    this.renameEvent = this.app.vault.on("rename", (file, oldPath) => {
      const move = (path: string) => remapPath(path, oldPath, file.path);
      this.plan.projectRoot = move(this.plan.projectRoot);
      this.plan.sources = this.plan.sources.map(move);
      if (this.plan.excerpt) this.plan.excerpt = move(this.plan.excerpt);
      if (this.plan.letterSource) this.plan.letterSource = move(this.plan.letterSource);
      if (this.templatePath) this.templatePath = move(this.templatePath);
      this.documents = editorialPacketSources(this.edition, this.letterFor);
      this.render();
    });
    this.render();
  }

  onClose(): void {
    if (this.renameEvent) this.app.vault.offref(this.renameEvent);
    this.contentEl.empty();
  }

  private render(): void {
    const host = this.contentEl;
    host.empty();
    new Setting(host).setName(t("packet.saved")).addDropdown(dropdown => {
      dropdown.addOption("-1", t("packet.new"));
      this.saved().forEach((plan, index) => {
        if (plan.projectRoot === this.root.path) dropdown.addOption(String(index), plan.name);
      });
      dropdown.setValue(String(this.index)).onChange(value => {
        this.select(Number(value));
        this.render();
      });
    });
    new Setting(host).setName(t("packet.name")).addText(text =>
      text.setValue(this.plan.name).onChange(value => { this.plan.name = value; }));
    const selectedLetter = this.plan.sources.some(path => !!this.letterFor?.(path));
    const template = this.templatePath;
    if (template && !selectedLetter) {
      new Setting(host).setName(t("packet.letter")).setDesc(template.slice(template.lastIndexOf("/") + 1))
        .addToggle(toggle => toggle.setValue(!!this.plan.letterSource).onChange(value => {
          this.plan.letterSource = value ? template : undefined;
        }));
    }
    new Setting(host).setName(t("packet.format")).addDropdown(dropdown => dropdown
      .addOption("composite", t("packet.composite")).addOption("pdf", t("packet.separatePdf")).addOption("docx", t("packet.separateDocx"))
      .setValue(this.plan.format).onChange(value => {
        if (value === "composite" || value === "pdf" || value === "docx") this.plan.format = value;
        this.render();
      }));
    const ordered = host.createDiv({ cls: "feuillets-packet-documents" });
    ordered.createEl("h4", { text: t("packet.documents") });
    const documents = new Map(this.documents.map(file => [file.path, file]));
    const paths = [...this.plan.sources, ...documents.keys()].filter((path, index) =>
      index < this.plan.sources.length || (path !== template && !this.plan.sources.includes(path)));
    for (const path of paths) {
      const row = ordered.createDiv({ cls: "feuillets-packet-document" });
      const label = row.createEl("label");
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = this.plan.sources.includes(path);
      const file = documents.get(path);
      label.createSpan({ text: file?.basename ?? path });
      const letter = this.letterFor?.(path);
      const kind = letter ? "packet.courrierLetter"
        : file?.extension.toLowerCase() === "docx" ? "packet.docxAttachment" : null;
      if (kind) label.createSpan({ cls: "setting-item-description", text: [t(kind), letter?.recipient].filter(Boolean).join(" · ") });
      checkbox.addEventListener("change", () => {
        this.plan.sources = checkbox.checked ? [...this.plan.sources, path] : this.plan.sources.filter(source => source !== path);
        this.render();
      });
      const current = this.plan.sources.indexOf(path);
      if (current < 0) continue;
      for (const direction of [-1, 1]) {
        const target = current + direction;
        const text = t(direction < 0 ? "packet.up" : "packet.down");
        const button = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": text } });
        setIcon(button, direction < 0 ? "arrow-up" : "arrow-down");
        setTooltip(button, text);
        button.disabled = target < 0 || target >= this.plan.sources.length;
        button.addEventListener("click", () => {
          const sources = this.plan.sources;
          [sources[current], sources[target]] = [sources[target], sources[current]];
          this.render();
        });
      }
    }
    new Setting(host).setName(t("packet.manuscript")).addDropdown(dropdown => dropdown
      .addOption("none", t("packet.none")).addOption("full", t("packet.full")).addOption("excerpt", t("packet.excerpt"))
      .setValue(this.plan.manuscript).onChange(value => {
        if (value === "none" || value === "full" || value === "excerpt") this.plan.manuscript = value;
        this.render();
      }));
    if (this.plan.manuscript === "excerpt") {
      new Setting(host).setName(t("packet.sheet")).addDropdown(dropdown => {
        dropdown.addOption("", t("packet.choose"));
        for (const file of packetProjectFiles(this.app, this.host.settings, this.root)) dropdown.addOption(file.path, file.basename);
        dropdown.setValue(this.plan.excerpt ?? "").onChange(value => { this.plan.excerpt = value; });
      });
    }
    if (this.plan.manuscript !== "none" && this.plan.format !== "docx") {
      new Setting(host).setName(t("packet.manuscriptDocx")).addToggle(toggle =>
        toggle.setValue(this.plan.manuscriptDocx).onChange(value => { this.plan.manuscriptDocx = value; }));
    }
    new Setting(host).setName(t("packet.identity")).addToggle(toggle =>
      toggle.setValue(this.plan.identity).onChange(value => { this.plan.identity = value; }));

    const actions = new Setting(host);
    actions.addButton(button => button.setButtonText(t("packet.save")).onClick(() => this.run(() => this.save(false))));
    if (this.index >= 0) actions.addButton(button => button.setButtonText(t("packet.duplicate")).onClick(() => this.run(() => this.save(true))));
    actions.addButton(button => button.setButtonText(t("packet.previewOnly")).onClick(() => this.run(async () => this.preview())));
    if (this.submit) actions.addButton(button => button.setButtonText(t("packet.prepareSubmission")).setCta()
      .onClick(() => this.run(async () => {
        const complete = (path: string) => {
          this.close();
          this.onSubmission?.(path);
        };
        const path = await this.submit?.(this.value(), complete);
        if (path) complete(path);
      })));
  }

  private value(): EditorialPacket {
    const name = this.plan.name.trim();
    if (!name) throw new Error(t("packet.nameRequired"));
    exportFileName(name, "pdf");
    return { ...this.plan, name, sources: [...this.plan.sources] };
  }

  private async save(duplicate: boolean): Promise<void> {
    const values = this.host.settings.editorialPackets ??= [];
    const plan = this.value();
    if (duplicate) plan.name += ` (${t("packet.copy")})`;
    if (duplicate || this.index < 0) this.index = values.length;
    values[this.index] = plan;
    this.select(this.index);
    await this.host.saveSettings();
    new Notice(t("packet.savedNotice"));
    this.render();
  }

  private preview(): void {
    const plan = this.value();
    const outputs = preparePacketOutputs(this.app, this.host.settings, plan, undefined, this.host.cslCitationHost, this.letterFor);
    new EditorialPacketPreview(this.app, plan.name, outputs, { destination: packetWorkDestination(this.edition, plan.name), workExport: true }).open();
    this.close();
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.editing) return;
    this.editing = true;
    try { await action(); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.editing = false; }
  }
}
