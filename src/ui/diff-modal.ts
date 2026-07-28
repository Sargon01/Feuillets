import { Modal, Notice, ButtonComponent, DropdownComponent, TFile, TFolder, setIcon } from "obsidian";
import type { App } from "obsidian";
/* `import * as` et non un import par défaut : diff v9 est un paquet ESM pur
   qui n'expose que des exports nommés (diffWords, diffLines…). Un
   `import Diff from "diff"` compile chez tsc mais fait échouer esbuild. */
import * as Diff from "diff";
import { listSnapshotFiles } from "../services/project-files.js";
import { ConfirmModal } from "./basic-modals.js";
import { foldAccents } from "../utils/core.js";
import { t } from "../i18n/index.js";

type DiffMode = "split" | "inline";

type DiffPaneElement = HTMLElement & {
  createDiv(options?: { cls?: string; text?: string }): DiffPaneElement;
  createSpan(options?: { cls?: string; text?: string }): DiffPaneElement;
  empty(): void;
};

type ComparePlugin = {
  shortTitleFor(file: TFile): string;
};

type PickFilePlugin = {
  getProjectFolder(): TFolder | null;
  getVersionsRoot(): TFolder | null;
  getOrderedChildren(folder: TFolder): Array<TFile | TFolder>;
  shortTitleFor(file: TFile): string;
};

type DiffPlugin = ComparePlugin & {
  getProjectFolder(): TFolder | null;
  snapshotFile(file: TFile, root: TFolder): Promise<unknown>;
};

type FileChooseHandler = (file: TFile) => void | Promise<void>;

type DiffOrigin = {
  root: TFolder;
  label: string;
  icon: string;
};

type DiffModalArguments =
  | [plugin: DiffPlugin, currentFile: TFile, initialSnapshot?: TFile]
  | [currentFile: TFile, initialSnapshot?: TFile];

function isFileOnlyDiffModalArguments(
  args: DiffModalArguments
): args is [currentFile: TFile, initialSnapshot?: TFile] {
  return args[0] instanceof TFile;
}

/** Rendu partagé du corps de diff (côte à côte / vue unifiée) — utilisé par
 * DiffModal (comparaison avec un snapshot) et CompareFilesModal (comparaison
 * entre deux feuillets quelconques, ex. une scène dans deux versions). */
function renderDiffPanes(
  container: DiffPaneElement,
  mode: DiffMode,
  textA: string,
  textB: string,
  labelA: string,
  labelB: string
) {
  container.empty();
  const diffs = Diff.diffWords(textA, textB);

  if (mode === "split") {
    const splitWrap = container.createDiv({ cls: "feuillets-diff-split-container" });

    const leftPane = splitWrap.createDiv({ cls: "feuillets-diff-pane" });
    leftPane.createDiv({ cls: "feuillets-diff-pane-header", text: labelA });
    const leftContent = leftPane.createDiv({ cls: "feuillets-diff-pane-content" });

    const rightPane = splitWrap.createDiv({ cls: "feuillets-diff-pane" });
    rightPane.createDiv({ cls: "feuillets-diff-pane-header", text: labelB });
    const rightContent = rightPane.createDiv({ cls: "feuillets-diff-pane-content" });

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
      if (!part.added) {
        const span = leftContent.createSpan();
        span.setText(part.value);
        span.addClass(part.removed ? "feuillets-diff-removed" : "feuillets-diff-unchanged");
      }
      if (!part.removed) {
        const span = rightContent.createSpan();
        span.setText(part.value);
        span.addClass(part.added ? "feuillets-diff-added" : "feuillets-diff-unchanged");
      }
    });
  } else {
    const inlineContent = container.createDiv({ cls: "feuillets-diff-inline-container" });
    diffs.forEach((part) => {
      const span = inlineContent.createSpan();
      span.setText(part.value);
      if (part.added) span.addClass("feuillets-diff-added");
      else if (part.removed) span.addClass("feuillets-diff-removed");
      else span.addClass("feuillets-diff-unchanged");
    });
  }
}

const stripFrontmatter = (raw: string) => raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

/** Comparaison entre deux feuillets quelconques (pas forcément un fichier et
 * son snapshot) — sert notamment à comparer une même scène entre deux
 * versions dupliquées du manuscrit, ou une version archivée et le
 * manuscrit actif. Pas de bouton "Restaurer" : contrairement à un
 * snapshot, rien ne dit lequel des deux devrait écraser l'autre. */
export class CompareFilesModal extends Modal {
  plugin: ComparePlugin | null;
  fileA: TFile;
  fileB: TFile;
  mode: DiffMode;

  constructor(app: App, plugin: ComparePlugin | null, fileA: TFile, fileB: TFile) {
    super(app);
    this.plugin = plugin;
    this.fileA = fileA;
    this.fileB = fileB;
    this.mode = "split";
  }

  labelFor(file: TFile): string {
    return `${this.plugin ? this.plugin.shortTitleFor(file) : file.basename} — ${file.parent ? file.parent.name : ""}`;
  }

  async onOpen() {
    const { modalEl } = this;
    modalEl.addClass("feuillets-diff-modal");
    await this.render();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.diff.compareTwoSheets") });

    const headerBar = contentEl.createDiv({ cls: "feuillets-diff-header-bar" });
    const modeControl = headerBar.createDiv({ cls: "feuillets-diff-controls" });
    const splitBtn = modeControl.createEl("button", {
      text: t("modal.diff.sideBySide"),
      cls: `feuillets-diff-mode-btn ${this.mode === "split" ? "mod-cta" : ""}`,
    });
    const inlineBtn = modeControl.createEl("button", {
      text: t("modal.diff.unifiedView"),
      cls: `feuillets-diff-mode-btn ${this.mode === "inline" ? "mod-cta" : ""}`,
    });
    splitBtn.addEventListener("click", async () => {
      if (this.mode !== "split") { this.mode = "split"; await this.render(); }
    });
    inlineBtn.addEventListener("click", async () => {
      if (this.mode !== "inline") { this.mode = "inline"; await this.render(); }
    });

    const bodyContainer = contentEl.createDiv();
    const rawA = await this.app.vault.read(this.fileA);
    const rawB = await this.app.vault.read(this.fileB);
    renderDiffPanes(
      bodyContainer, this.mode,
      stripFrontmatter(rawA), stripFrontmatter(rawB),
      this.labelFor(this.fileA), this.labelFor(this.fileB)
    );

    const footerBar = contentEl.createDiv({ cls: "feuillets-diff-footer-bar" });
    new ButtonComponent(footerBar).setButtonText(t("modal.close")).onClick(() => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Sélecteur de feuillet pour "Comparer avec…" — restreint au manuscrit
 * actif et à ses versions archivées (_Versions) : c'est là qu'a du sens de
 * comparer une même scène, pas dans tout le coffre. Arborescence repliable
 * (une section par origine : manuscrit actif, puis chaque version), pas une
 * liste plate à recherche floue — une liste seule ne disait pas si un
 * résultat venait du manuscrit ou d'une version, ni de quel dossier. */
export class PickFileModal extends Modal {
  plugin: PickFilePlugin;
  excludeFile: TFile;
  onChoose: FileChooseHandler;
  collapsed: Set<string>;
  filter: string;

  constructor(app: App, plugin: PickFilePlugin, excludeFile: TFile, onChoose: FileChooseHandler) {
    super(app);
    this.plugin = plugin;
    this.excludeFile = excludeFile;
    this.onChoose = onChoose;
    this.collapsed = new Set();
    this.filter = "";
  }

  onOpen() {
    const { modalEl } = this;
    modalEl.addClass("feuillets-pickfile-modal");
    this.render();
  }

  getOrigins(): DiffOrigin[] {
    const root = this.plugin.getProjectFolder();
    if (!(root instanceof TFolder)) return [];
    const origins = [{ root, label: t("modal.diff.activeManuscript"), icon: "book-marked" }];
    const versionsRoot = this.plugin.getVersionsRoot();
    if (versionsRoot instanceof TFolder) {
      for (const child of this.plugin.getOrderedChildren(versionsRoot)) {
        if (child instanceof TFolder) origins.push({ root: child, label: child.name, icon: "history" });
      }
    }
    return origins;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.diff.compareWithWhich") });

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "feuillets-binder-search",
      attr: { placeholder: t("modal.diff.filterPlaceholder") },
    });
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = search.value;
      this.renderTree(tree);
    });
    search.focus();

    const tree = contentEl.createDiv({ cls: "feuillets-pickfile-tree" });
    this.renderTree(tree);
  }

  renderTree(tree: DiffPaneElement) {
    tree.empty();
    const q = foldAccents(this.filter.trim());
    const origins = this.getOrigins();
    if (origins.length === 0) {
      tree.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.dashboard.noActiveProject"));
      return;
    }

    for (const origin of origins) {
      const rootRow = tree.createDiv({ cls: "feuillets-folder-row feuillets-binder-research-row feuillets-binder-research-root" });
      const icon = rootRow.createDiv({ cls: "feuillets-cell-icon" });
      setIcon(icon, origin.icon);
      rootRow.createSpan({ cls: "feuillets-folder-name" }).setText(origin.label);
      const isCollapsed = this.collapsed.has(origin.root.path) && !q;
      rootRow.addEventListener("click", () => {
        if (this.collapsed.has(origin.root.path)) this.collapsed.delete(origin.root.path);
        else this.collapsed.add(origin.root.path);
        this.renderTree(tree);
      });
      if (isCollapsed) continue;

      const anyShown = { value: false };
      const renderChildren = (folder: TFolder, depth: number) => {
        for (const child of this.plugin.getOrderedChildren(folder)) {
          if (child instanceof TFolder) {
            const matchInside = !q || this.folderHasMatch(child, q);
            if (!matchInside) continue;
            const row = tree.createDiv({ cls: "feuillets-folder-row feuillets-binder-research-row" });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            const fIcon = row.createDiv({ cls: "feuillets-cell-icon" });
            setIcon(fIcon, "folder");
            row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);
            const childCollapsed = this.collapsed.has(child.path) && !q;
            row.addEventListener("click", () => {
              if (this.collapsed.has(child.path)) this.collapsed.delete(child.path);
              else this.collapsed.add(child.path);
              this.renderTree(tree);
            });
            if (!childCollapsed) renderChildren(child, depth + 1);
          } else if (child instanceof TFile && child.extension === "md" && child.path !== this.excludeFile.path) {
            const title = this.plugin.shortTitleFor(child);
            if (q && !foldAccents(title).includes(q)) continue;
            anyShown.value = true;
            const row = tree.createDiv({ cls: "feuillets-item feuillets-binder-research-row" });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            const fIcon = row.createDiv({ cls: "feuillets-cell-icon" });
            setIcon(fIcon, "file-text");
            row.createSpan({ cls: "feuillets-item-name" }).setText(title);
            row.addEventListener("click", () => {
              this.close();
              this.onChoose(child);
            });
          }
        }
      };
      renderChildren(origin.root, 1);
      if (q && !anyShown.value) {
        rootRow.remove();
      }
    }
  }

  folderHasMatch(folder: TFolder, q: string): boolean {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (this.folderHasMatch(child, q)) return true;
      } else if (child instanceof TFile && child.extension === "md") {
        if (foldAccents(this.plugin.shortTitleFor(child)).includes(q)) return true;
      }
    }
    return false;
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class DiffModal extends Modal {
  plugin: DiffPlugin | null;
  currentFile: TFile;
  initialSnapshot: TFile | undefined;
  mode: DiffMode;
  snapshots: TFile[];
  selectedSnapshot: TFile | null;

  constructor(app: App, plugin: DiffPlugin, currentFile: TFile, initialSnapshot?: TFile);
  constructor(app: App, currentFile: TFile, initialSnapshot?: TFile);
  constructor(
    app: App,
    ...args: DiffModalArguments
  ) {
    super(app);
    if (isFileOnlyDiffModalArguments(args)) {
      const [currentFile, initialSnapshot] = args;
      this.plugin = null;
      this.currentFile = currentFile;
      this.initialSnapshot = initialSnapshot;
    } else {
      const [plugin, currentFile, initialSnapshot] = args;
      this.plugin = plugin;
      this.currentFile = currentFile;
      this.initialSnapshot = initialSnapshot;
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
      contentEl.createEl("h3", { text: t("modal.diff.comparisonTitle", { name: this.currentFile.basename }) });
      contentEl.createDiv({ cls: "feuillets-empty", text: t("modal.diff.noSnapshotAvailable") });
      return;
    }

    this.selectedSnapshot = this.initialSnapshot || this.snapshots[0];
    await this.renderModalContent();
  }

  async renderModalContent() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: t("modal.diff.comparisonTitle", { name: this.currentFile.basename }) });

    // Barre d'outils supérieure : Sélecteur de snapshot & Mode de vue
    const headerBar = contentEl.createDiv({ cls: "feuillets-diff-header-bar" });

    // Sélecteur de snapshot
    const snapControl = headerBar.createDiv({ cls: "feuillets-diff-controls" });
    const snapshotLabel = snapControl.createSpan({ text: `${t("modal.diff.snapshotLabel")} ` });
    snapshotLabel.style.fontWeight = "500";
    const drop = new DropdownComponent(snapControl);
    this.snapshots.forEach((snap, idx) => {
      const dateLabel = snap.basename;
      drop.addOption(snap.path, `${dateLabel}${idx === 0 ? ` ${t("modal.diff.mostRecent")}` : ""}`);
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
      text: t("modal.diff.sideBySide"),
      cls: `feuillets-diff-mode-btn ${this.mode === "split" ? "mod-cta" : ""}`
    });
    const inlineBtn = modeControl.createEl("button", {
      text: t("modal.diff.unifiedView"),
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
      .setButtonText(t("modal.diff.restoreSnapshot"))
      .setWarning()
      .onClick(() => {
        if (!this.selectedSnapshot) return;
        /* ConfirmModal plutôt que window.confirm() : cohérence avec le reste
           de l'UI (cf. src/ui/basic-modals.js) et confirm() est bloquant,
           donc proscrit par la revue Obsidian. */
        const snapshot = this.selectedSnapshot;
        new ConfirmModal(
          this.app,
          t("modal.diff.restoreSnapshot"),
          t("modal.diff.restoreConfirm", { snapshot: snapshot.basename, current: this.currentFile.basename }),
          t("modal.diff.restoreSnapshot"),
          async () => {
            const root = this.plugin ? this.plugin.getProjectFolder() : null;
            if (this.plugin && root) {
              await this.plugin.snapshotFile(this.currentFile, root);
            }
            const content = await this.app.vault.read(snapshot);
            await this.app.vault.modify(this.currentFile, content);
            new Notice(t("modal.diff.restoredNotice", { name: snapshot.basename }));
            this.close();
          }
        ).open();
      });

    new ButtonComponent(footerBar)
      .setButtonText(t("modal.close"))
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
      leftPane.createDiv({ cls: "feuillets-diff-pane-header", text: t("modal.diff.snapshotPane", { name: this.selectedSnapshot.basename }) });
      const leftContent = leftPane.createDiv({ cls: "feuillets-diff-pane-content" });

      // Panneau droit : Version actuelle
      const rightPane = splitWrap.createDiv({ cls: "feuillets-diff-pane" });
      rightPane.createDiv({ cls: "feuillets-diff-pane-header", text: t("modal.diff.currentVersionPane", { name: this.currentFile.basename }) });
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
