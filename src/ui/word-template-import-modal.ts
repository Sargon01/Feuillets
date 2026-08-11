import { Modal, Notice, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { importWordTemplate } from "../services/word-template-import.js";
type Plugin={settings:FeuilletsSettings;saveSettings():Promise<void>};
/** Import navigateur Word : dépôt HTML5 uniquement, aucun accès Node. */
export class WordTemplateImportModal extends Modal {
  constructor(app:App,private plugin:Plugin,private onImported:()=>Promise<void>|void){super(app);}
  onOpen():void{this.modalEl.addClass("feuillets-ulysses-import-modal");const c=this.contentEl;c.createEl("h3",{text:t("editionLayout.importWord")});c.createEl("p",{cls:"feuillets-notes-sub",text:t("editionLayout.wordDrop")});const z=c.createDiv({cls:"feuillets-ulysses-drop-zone",text:t("editionLayout.wordDrop")});z.addEventListener("dragover",e=>e.preventDefault());z.addEventListener("drop",e=>{e.preventDefault();void this.importFile(e.dataTransfer?.files?.[0]||null);});}
  private async importFile(file:File|null):Promise<void>{if(!file||!/\.(docx|dotx)$/i.test(file.name)){new Notice(t("editionLayout.wordInvalidFile"));return;}try{const r=await importWordTemplate(this.app,this.plugin.settings,file.name,await file.arrayBuffer());if(!r)throw new Error("Dossier projet introuvable.");await this.plugin.saveSettings();new Notice(t("editionLayout.wordImported",{label:r.label}));this.close();await this.onImported();}catch(e){new Notice(t("editionLayout.wordImportError",{message:e instanceof Error?e.message:String(e)}));}}
  onClose():void{this.contentEl.empty();}
}
