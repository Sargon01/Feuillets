const { Modal, Notice, ButtonComponent, DropdownComponent } = require("obsidian");
const Diff = require("diff");
import { listSnapshotFiles } from "../services/project-files.js";

export class DiffModal extends Modal {
  constructor(app, pluginOrFile, currentFileOrSnap, initialSnapshot) {
    super(app);
    if (pluginOrFile && pluginOrFile.getProjectFolder) {
      this.plugin = pluginOrFile;
      this.currentFile = currentFileOrSnap;
      this.initialSnapshot = initialSnapshot;
    } else {
      this.plugin = null;
      this.currentFile = pluginOrFile;
      this.initialSnapshot = currentFileOrSnap;
    }
    this.mode = "split"; // "split" | "inline"
    this.snapshots = [];
    this.selectedSnapshot = null;
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-diff-modal");
    contentEl.empty();

    const root = this.plugin ? this.plugin.getProjectFolder() : null;
    this.snapshots = listSnapshotFiles(this.app, this.currentFile, root);

    if (this.snapshots.length === 0) {
      contentEl.createEl("h3", { text: `Comparaison : ${this.currentFile.basename}` });
      contentEl.createDiv({ cls: "feuillets-empty", text: "Aucun snapshot disponible pour ce feuillet." });
      return;
    }

    this.selectedSnapshot = this.initialSnapshot || this.snapshots[0];
    await this.renderModalContent();
  }

  async renderModalContent() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: `Comparaison : ${this.currentFile.basename}` });

    // Barre d'outils supérieure : Sélecteur de snapshot & Mode de vue
    const headerBar = contentEl.createDiv({ cls: "feuillets-diff-header-bar" });

    // Sélecteur de snapshot
    const snapControl = headerBar.createDiv({ cls: "feuillets-diff-controls" });
    snapControl.createSpan({ text: "Snapshot : ", style: "font-weight: 500;" });
    const drop = new DropdownComponent(snapControl);
    this.snapshots.forEach((snap, idx) => {
      const dateLabel = snap.basename;
      drop.addOption(snap.path, `${dateLabel}${idx === 0 ? " (plus récent)" : ""}`);
    });
    if (this.selectedSnapshot) {
      drop.setValue(this.selectedSnapshot.path);
    }
    drop.onChange(async (path) => {
      const found = this.snapshots.find((s) => s.path === path);
      if (found) {
        this.selectedSnapshot = found;
        await this.renderDiffBody(bodyContainer);
      }
    });

    // Bascule de mode Côte à côte / Vue unifiée
    const modeControl = headerBar.createDiv({ cls: "feuillets-diff-controls" });
    const splitBtn = modeControl.createEl("button", {
      text: "Côte à côte",
      cls: `feuillets-diff-mode-btn ${this.mode === "split" ? "mod-cta" : ""}`
    });
    const inlineBtn = modeControl.createEl("button", {
      text: "Vue unifiée",
      cls: `feuillets-diff-mode-btn ${this.mode === "inline" ? "mod-cta" : ""}`
    });

    splitBtn.addEventListener("click", async () => {
      if (this.mode !== "split") {
        this.mode = "split";
        await this.renderModalContent();
      }
    });
    inlineBtn.addEventListener("click", async () => {
      if (this.mode !== "inline") {
        this.mode = "inline";
        await this.renderModalContent();
      }
    });

    // Conteneur du corps (Diff)
    const bodyContainer = contentEl.createDiv();
    await this.renderDiffBody(bodyContainer);

    // Barre d'actions inférieure
    const footerBar = contentEl.createDiv({ cls: "feuillets-diff-footer-bar" });
    
    new ButtonComponent(footerBar)
      .setButtonText("Restaurer ce snapshot")
      .setWarning()
      .onClick(async () => {
        if (!this.selectedSnapshot) return;
        const confirmRestore = confirm(
          `Voulez-vous vraiment restaurer la version du snapshot "${this.selectedSnapshot.basename}" ?\nLe contenu actuel de "${this.currentFile.basename}" sera remplacé.`
        );
        if (confirmRestore) {
          const root = this.plugin ? this.plugin.getProjectFolder() : null;
          if (this.plugin && root) {
            await this.plugin.snapshotFile(this.currentFile, root);
          }
          const content = await this.app.vault.read(this.selectedSnapshot);
          await this.app.vault.modify(this.currentFile, content);
          new Notice(`Feuillet restauré depuis ${this.selectedSnapshot.basename}.`);
          this.close();
        }
      });

    new ButtonComponent(footerBar)
      .setButtonText("Fermer")
      .onClick(() => this.close());
  }

  async renderDiffBody(container) {
    container.empty();
    if (!this.selectedSnapshot) return;

    const rawCurrent = await this.app.vault.read(this.currentFile);
    const rawSnapshot = await this.app.vault.read(this.selectedSnapshot);

    const currentText = rawCurrent.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const snapshotText = rawSnapshot.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

    const diffs = Diff.diffWords(snapshotText, currentText);

    if (this.mode === "split") {
      const splitWrap = container.createDiv({ cls: "feuillets-diff-split-container" });

      // Panneau gauche : Snapshot
      const leftPane = splitWrap.createDiv({ cls: "feuillets-diff-pane" });
      leftPane.createDiv({ cls: "feuillets-diff-pane-header", text: `Snapshot (${this.selectedSnapshot.basename})` });
      const leftContent = leftPane.createDiv({ cls: "feuillets-diff-pane-content" });

      // Panneau droit : Version actuelle
      const rightPane = splitWrap.createDiv({ cls: "feuillets-diff-pane" });
      rightPane.createDiv({ cls: "feuillets-diff-pane-header", text: `Version actuelle (${this.currentFile.basename})` });
      const rightContent = rightPane.createDiv({ cls: "feuillets-diff-pane-content" });

      // Synchronisation du défilement
      let isSyncingLeft = false;
      let isSyncingRight = false;
      leftContent.addEventListener("scroll", () => {
        if (!isSyncingRight) {
          isSyncingLeft = true;
          rightContent.scrollTop = leftContent.scrollTop;
        }
        isSyncingRight = false;
      });
      rightContent.addEventListener("scroll", () => {
        if (!isSyncingLeft) {
          isSyncingRight = true;
          leftContent.scrollTop = rightContent.scrollTop;
        }
        isSyncingLeft = false;
      });

      diffs.forEach((part) => {
        // En colonne Snapshot : afficher le texte inchangé + les éléments supprimés de la version actuelle (en rouge)
        if (!part.added) {
          const span = leftContent.createSpan();
          span.setText(part.value);
          if (part.removed) {
            span.addClass("feuillets-diff-removed");
          } else {
            span.addClass("feuillets-diff-unchanged");
          }
        }

        // En colonne Actuelle : afficher le texte inchangé + les éléments ajoutés (en vert)
        if (!part.removed) {
          const span = rightContent.createSpan();
          span.setText(part.value);
          if (part.added) {
            span.addClass("feuillets-diff-added");
          } else {
            span.addClass("feuillets-diff-unchanged");
          }
        }
      });
    } else {
      // Mode Unifié (Inline)
      const inlineContent = container.createDiv({ cls: "feuillets-diff-inline-container" });
      diffs.forEach((part) => {
        const span = inlineContent.createSpan();
        span.setText(part.value);
        if (part.added) {
          span.addClass("feuillets-diff-added");
        } else if (part.removed) {
          span.addClass("feuillets-diff-removed");
        } else {
          span.addClass("feuillets-diff-unchanged");
        }
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}