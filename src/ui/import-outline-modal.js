const { Modal, Notice, normalizePath } = require("obsidian");

export class ImportOutlineModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: "Importer un plan (Multi-niveaux)",
    });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Colle ton plan en Markdown ci-dessous. Les lignes commençant par # (##, ###, etc.) créent des dossiers " +
      "correspondant au niveau de titre. Les tirets (-) ou le texte brut créent des scènes au format .md."
    );
    const ta = contentEl.createEl("textarea", {
      attr: {
        rows: 14,
        placeholder:
          "# Partie 1\n## Chapitre 1\n- Scène 1\n- Scène 2\n## Chapitre 2\n- Scène 3\n# Partie 2\n- Chapitre 3",
      },
    });
    ta.style.width = "100%";
    ta.style.fontFamily = "monospace";
    ta.focus();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Créer l'arborescence", cls: "mod-cta" })
      .addEventListener("click", async () => {
        const text = ta.value;
        if (!text.trim()) {
          new Notice("Colle d'abord une liste.");
          return;
        }
        await this.importOutline(text);
        this.close();
      });
    btnRow
      .createEl("button", { text: "Annuler" })
      .addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }

  safeFolderName(title, index) {
    const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
    return cleaned || `Sans-titre-${index}`;
  }

  async importOutline(text) {
    const plugin = this.plugin;
    const root = plugin.getProjectFolder();
    if (!root) {
      new Notice("Aucun dossier projet défini dans les réglages.");
      return;
    }
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    const activeFolders = [root];
    let createdFoldersCount = 0;
    let createdFilesCount = 0;
    const orderMap = new Map();

    const record = (parent, child) => {
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

        let parent = root;
        for (let i = hashes - 1; i >= 0; i--) {
          if (activeFolders[i]) {
            parent = activeFolders[i];
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

        let parent = root;
        for (let i = activeFolders.length - 1; i >= 0; i--) {
          if (activeFolders[i]) {
            parent = activeFolders[i];
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
    new Notice(`Import réussi : ${createdFoldersCount} dossier(s), ${createdFilesCount} scène(s) créée(s).`);
  }
}
