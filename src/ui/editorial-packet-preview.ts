import { Modal, Notice, Platform, Setting, TFile, TFolder, type App, type EventRef } from "obsidian";
import { exportFileName, writeExportDestination } from "../services/export-destination.js";
import { t } from "../i18n/index.js";
import type { PacketOpenOptions, PacketOutput } from "../services/editorial-packet.js";
import { ConfirmModal } from "./basic-modals.js";

type OutputBytes = ArrayBuffer | Uint8Array;

export function isImportablePacketPdf(buffer: ArrayBuffer): boolean {
  const decoder = new TextDecoder();
  const head = decoder.decode(buffer.slice(0, 16));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/u.test(head)) return false;
  const trailer = decoder.decode(buffer.slice(Math.max(0, buffer.byteLength - 2048)));
  const match = /(?:^|[\r\n])startxref[\t \r\n]+(\d+)[\t \r\n]+%%EOF[\t \r\n\f\0]*$/u.exec(trailer);
  if (!match) return false;
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 9 || offset >= buffer.byteLength - match[0].length) return false;
  const xref = decoder.decode(buffer.slice(offset, offset + 64));
  return /^(?:xref\s|\d+\s+\d+\s+obj\b)/u.test(xref);
}

export class EditorialPacketPreview extends Modal {
  private generation = 0;
  private busy = false;
  private vaultEvents: EventRef[] = [];
  private refreshFile?: (path: string) => void;

  constructor(app: App, private name: string, private outputs: PacketOutput[], private options: PacketOpenOptions) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.name);
    this.modalEl.addClass("feuillets-packet-preview");
    const top = this.contentEl.createDiv();
    const body = this.contentEl.createDiv();
    if (!this.outputs.length) {
      body.setText(t("packet.empty"));
      return;
    }
    this.vaultEvents = [
      this.app.vault.on("create", file => this.refreshFile?.(file.path)),
      this.app.vault.on("modify", file => this.refreshFile?.(file.path)),
      this.app.vault.on("delete", file => this.refreshFile?.(file.path)),
      this.app.vault.on("rename", (file, oldPath) => {
        this.refreshFile?.(oldPath);
        this.refreshFile?.(file.path);
      }),
    ];
    const select = top.createEl("select", { attr: { "aria-label": t("packet.output") } });
    for (const output of this.outputs) select.createEl("option", { value: output.name, text: output.name });
    const display = () => {
      const output = this.outputs.find(item => item.name === select.value);
      if (output) void this.display(body, output);
    };
    select.addEventListener("change", display);
    display();
  }

  onClose(): void {
    this.generation++;
    for (const ref of this.vaultEvents) this.app.vault.offref(ref);
    this.vaultEvents = [];
    this.refreshFile = undefined;
    this.contentEl.empty();
  }

  private async display(body: HTMLElement, output: PacketOutput): Promise<void> {
    const generation = ++this.generation;
    body.empty();
    let name = output.name;
    const extension = output.prepareDocx ? "docx" : "pdf";
    const target = () => `${this.options.destination}/${this.options.workExport ? exportFileName(name, extension) : output.name}`;
    let updateLabels: ((exists: boolean) => void) | undefined;
    const status = body.createDiv({ cls: "setting-item-description" });
    const refresh = () => {
      try {
        const path = target();
        const file = this.app.vault.getAbstractFileByPath(path);
        const ready = file instanceof TFile && file.stat.size > 0;
        status.setText(t(ready ? "packet.fileReady" : this.options.workExport ? "packet.workDestination" : "packet.filePending", { path }));
        updateLabels?.(file instanceof TFile);
      } catch (error) {
        status.setText(error instanceof Error ? error.message : String(error));
      }
    };
    this.refreshFile = path => {
      try { if (target() === path) refresh(); }
      catch { /* The filename field already reports invalid input. */ }
    };
    if (this.options.workExport) {
      const label = t("packet.workFilename");
      new Setting(body).setName(label).addText(text => {
        text.inputEl.setAttribute("aria-label", label);
        text.setValue(output.name).onChange(value => {
          name = value;
          refresh();
        });
      });
    }
    refresh();
    const actions = new Setting(body);
    if (output.prepareDocx) {
      const prepare = output.prepareDocx;
      if (output.existingDocx) actions.setDesc(t("packet.docxAttachment"));
      actions.addButton(button => {
        updateLabels = exists => { button.setButtonText(t(exists ? "packet.replaceDocx" : output.existingDocx ? "packet.copyDocx" : "packet.exportDocx")); };
        button.setCta().onClick(() => this.run(() => this.save(target(), prepare, refresh)));
        refresh();
      });
      return;
    }
    try {
      const html = await output.preparePdf?.();
      if (!html || generation !== this.generation) return;
      const frame = body.createEl("iframe", { cls: "feuillets-packet-print",
        attr: { title: output.name, sandbox: "allow-same-origin allow-modals" } });
      let enablePrint = () => {};
      frame.addEventListener("load", () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        void Promise.all([doc.fonts.ready, ...Array.from(doc.images, image => image.decode().catch(() => undefined))]).then(() => {
          if (generation === this.generation) enablePrint();
        });
      });
      frame.srcdoc = html;
      const input = body.createEl("input", { type: "file", attr: { accept: "application/pdf,.pdf" } });
      input.hidden = true;
      let selectedTarget: string | undefined;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        const path = selectedTarget;
        input.value = "";
        selectedTarget = undefined;
        if (!file) return;
        void this.run(async () => {
          const destination = path ?? target();
          const buffer = await file.arrayBuffer();
          if (!isImportablePacketPdf(buffer)) throw new Error(t("packet.invalidPdf"));
          await this.save(destination, async () => buffer, refresh);
        });
      });
      actions.addButton(button => {
        button.setButtonText(t("packet.print")).setCta().setDisabled(true).onClick(() => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        });
        enablePrint = () => { button.setDisabled(Platform.isMobile); };
      });
      if (this.options.workExport) actions.setDesc(t("packet.workPdfHelp"));
      actions.addButton(button => {
        updateLabels = exists => { button.setButtonText(t(exists ? "packet.replacePdf" : "packet.importPdf")); };
        button.onClick(() => this.run(async () => {
          selectedTarget = target();
          input.click();
        }));
        refresh();
      });
      if (!this.options.workExport) actions.addButton(button => button.setButtonText(t("packet.checkFile")).onClick(refresh));
    } catch (error) {
      if (generation === this.generation) status.setText(error instanceof Error ? error.message : String(error));
    }
  }

  private async save(path: string, prepare: () => Promise<OutputBytes>, refresh: () => void): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile && this.options.workExport) {
      const mtime = existing.stat.mtime;
      new ConfirmModal(this.app, t("packet.replaceWorkTitle"), t("packet.replaceWorkBody", { file: existing.name }),
        t("packet.replaceWorkConfirm"), () => this.run(async () => {
          await this.writeOutput(path, await prepare(), existing, mtime);
          refresh();
        })).open();
      return;
    }
    await this.writeOutput(path, await prepare(), existing instanceof TFile ? existing : undefined, existing instanceof TFile ? existing.stat.mtime : undefined);
    refresh();
  }

  private async writeOutput(path: string, buffer: OutputBytes, existing?: TFile, mtime?: number): Promise<void> {
    const write = () => this.writeToVault(path, buffer, existing, mtime);
    if (this.options.write) {
      if (!await this.options.write(write)) throw new Error(t("packet.exportLocked"));
      return;
    }
    if (this.options.canWrite && !await this.options.canWrite()) throw new Error(t("packet.exportLocked"));
    await write();
  }

  private async writeToVault(path: string, buffer: OutputBytes, existing?: TFile, mtime?: number): Promise<void> {
    if (!this.options.workExport && !(this.app.vault.getAbstractFileByPath(this.options.destination) instanceof TFolder)) {
      throw new Error(t("packet.noDestination"));
    }
    if (existing) {
      if (this.app.vault.getAbstractFileByPath(path) !== existing || existing.stat.mtime !== mtime) throw new Error(t("export.save.collision", { path }));
      await this.app.vault.modifyBinary(existing, buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer);
      return;
    }
    await writeExportDestination(this.app, { path }, buffer);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await action(); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; }
  }
}
