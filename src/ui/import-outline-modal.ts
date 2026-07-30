import { Modal, Notice, normalizePath, type App, type TAbstractFile, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";

type ImportOutlineSettings = {
  wordGoal: number;
};

type ImportOutlinePlugin = {
  settings: ImportOutlineSettings;
  getProjectFolder(): TFolder | null;
  ensureFolder(path: string): Promise<TAbstractFile>;
  writeOrder(parent: TAbstractFile, children: TAbstractFile[]): Promise<void>;
  renderAllViews(force: boolean): void;
};

export class ImportOutlineModal extends Modal {
  plugin: ImportOutlinePlugin;

  constructor(app: App, plugin: ImportOutlinePlugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.importOutline.title"),
    });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.importOutline.desc")
    );
    const ta = contentEl.createEl("textarea", {
      attr: {
        rows: 14,
        placeholder: t("modal.importOutline.placeholder"),
      },
    });
    ta.addClass("feuillets-input-full");
    ta.addClass("feuillets-mono");
    ta.focus();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.importOutline.createBtn"), cls: "mod-cta" })
      .addEventListener("click", async () => {
        const text = ta.value;
        if (!text.trim()) {
          new Notice(t("modal.importOutline.pasteFirst"));
          return;
        }
        await this.importOutline(text);
        this.close();
      });
    btnRow
      .createEl("button", { text: t("modal.cancel") })
      .addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }

  safeFolderName(title: string, index: number): string {
    const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
    return cleaned || t("modal.importOutline.untitled", { index: String(index) });
  }

  async importOutline(text: string): Promise<void> {
    const plugin = this.plugin;
    const root = plugin.getProjectFolder();
    if (!root) {
      new Notice(t("modal.importOutline.noProjectFolder"));
      return;
    }
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    const activeFolders: Array<TAbstractFile | null> = [root];
    let createdFoldersCount = 0;
    let createdFilesCount = 0;
    const orderMap = new Map<string, TAbstractFile[]>();

    const record = (parent: TAbstractFile, child: TAbstractFile): void => {
      const arr = orderMap.get(parent.path) || [];
      arr.push(child);
      orderMap.set(parent.path, arr);
    };

    let fileIdx = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const headerMatch = raw.match(/^\s*(#+)\s+(.+)$/);
      const bulletMatch = raw.match(/^\s*[-*+]\s+(.+)$/);

      if (headerMatch) {
        const hashes = headerMatch[1].length; // niveau 1 à 6
        const title = headerMatch[2].trim();
        if (!title) continue;

        let parent: TAbstractFile = root;
        for (let i = hashes - 1; i >= 0; i--) {
          const activeFolder = activeFolders[i];
          if (activeFolder) {
            parent = activeFolder;
            break;
          }
        }

        const folderName = this.safeFolderName(title, createdFoldersCount + 1);
        const folder = await plugin.ensureFolder(`${parent.path}/${folderName}`);
        
        activeFolders[hashes] = folder;
        // Efface les dossiers actifs de niveau supérieur
        for (let i = hashes + 1; i < activeFolders.length; i++) {
          activeFolders[i] = null;
        }

        record(parent, folder);
        createdFoldersCount++;
      } else {
        let title = "";
        if (bulletMatch) {
          title = bulletMatch[1].trim();
        } else {
          title = line;
        }
        if (!title) continue;

        let parent: TAbstractFile = root;
        for (let i = activeFolders.length - 1; i >= 0; i--) {
          const activeFolder = activeFolders[i];
          if (activeFolder) {
            parent = activeFolder;
            break;
          }
        }

        fileIdx++;
        const fileName = `scene-${String(fileIdx).padStart(3, "0")}.md`;
        const path = normalizePath(`${parent.path}/${fileName}`);

        if (!this.app.vault.getAbstractFileByPath(path)) {
          const fileLines = [
            "---",
            `title: ${title}`,
            "short_title: ",
            `order: ${fileIdx}`,
            "synopsis: ",
            "summary: ",
            "status: ",
            "label: ",
            `goal: ${plugin.settings.wordGoal}`,
            "tags: ",
            "date: ",
            "notes: ",
            "compile: true",
            "---",
            "",
            "",
          ];
          const file = await this.app.vault.create(path, fileLines.join("\n"));
          record(parent, file);
          createdFilesCount++;
        }
      }
    }

    for (const [parentPath, children] of orderMap) {
      const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
      if (parentFolder) await plugin.writeOrder(parentFolder, children);
    }

    plugin.renderAllViews(true);
    new Notice(t("modal.importOutline.importDone", { folders: String(createdFoldersCount), files: String(createdFilesCount) }));
  }
}
