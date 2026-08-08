import { Modal, Notice, TFolder, normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";
import { t } from "../i18n/index.js";
import { FolderSuggest } from "./folder-suggest.js";
import type { CanvasData, CanvasNode } from "../services/canvas-board.js";
import {
  textNodesOf,
  sortNodesSpatially,
  deriveTitle,
  firstMeaningfulLine,
  applySelectedIdeas,
  type BridgeMode,
} from "../services/canvas-bridge.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { ensureNotebookResearchFolder, findNotebookResearchFolder, notebookFolderName, researchFolderPath } from "../services/research.js";
import type { MinimalRuntimeCanvas } from "../services/canvas-runtime.js";

/** Repli universel (aucune dépendance à Advanced Canvas) pour transformer
 * une sélection d'idées texte du Tableau brainstorming en feuillets du
 * manuscrit ou en notes de recherche libres. Toujours disponible depuis la
 * palette de commandes ou le clic droit sur le bouton Canvas du Board —
 * Advanced Canvas, quand il est actif, offre juste un accès plus direct
 * (menu de sélection du canvas) à la même logique (voir
 * integrations/advanced-canvas.ts et services/canvas-bridge.ts). */
/** Stratégie de sauvegarde du .canvas modifié — par défaut un `vault.modify`
 * classique (repli sans Advanced Canvas). L'intégration Advanced Canvas
 * (integrations/advanced-canvas.ts) fournit à la place `canvas.setData()` +
 * `canvas.requestSave()` sur la vue déjà ouverte, pour ne jamais écrire sur
 * le disque pendant qu'une vue Canvas a des changements non enregistrés
 * susceptibles de l'écraser ensuite (voir le commentaire de tête de ce
 * fichier). */
export type CanvasBridgePersist = (data: CanvasData) => void | Promise<void>;

export type CanvasBridgeModalOptions = {
  preselectedIds?: string[];
  persist?: CanvasBridgePersist;
  onDone?: () => void;
  /** Canvas Advanced Canvas RÉEL (couche instances, voir services/canvas-
   * runtime.ts) — permet à `applySelectedIdeas` de matérialiser un vrai
   * FileNode runtime au lieu d'une simple mise à jour JSON. Absent en repli
   * disque (pas de vue Canvas ouverte) : le comportement reste alors
   * purement JSON, comme avant ce correctif. */
  runtimeCanvas?: MinimalRuntimeCanvas;
};

export class CanvasBridgeModal extends Modal {
  private settings: FeuilletsSettings;
  private canvasFile: TFile;
  private canvas: CanvasData;
  private mode: BridgeMode;
  private preselectedIds: Set<string> | null;
  private persist: CanvasBridgePersist;
  private onDone?: () => void;
  private runtimeCanvas?: MinimalRuntimeCanvas;

  private rows: CanvasNode[];
  private checked: Set<string>;

  constructor(
    app: App,
    settings: FeuilletsSettings,
    canvasFile: TFile,
    canvas: CanvasData,
    mode: BridgeMode,
    options: CanvasBridgeModalOptions = {}
  ) {
    super(app);
    this.settings = settings;
    this.canvasFile = canvasFile;
    this.canvas = canvas;
    this.mode = mode;
    this.preselectedIds = options.preselectedIds ? new Set(options.preselectedIds) : null;
    this.persist = options.persist || ((data) => this.app.vault.modify(this.canvasFile, JSON.stringify(data, null, "\t")));
    this.onDone = options.onDone;
    this.runtimeCanvas = options.runtimeCanvas;

    this.rows = sortNodesSpatially(textNodesOf(canvas));
    this.checked = new Set(
      this.preselectedIds
        ? this.rows.filter((n) => this.preselectedIds!.has(n.id)).map((n) => n.id)
        : []
    );
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: this.mode === "manuscript" ? t("modal.canvasBridge.titleManuscript") : t("modal.canvasBridge.titleResearch"),
    });

    if (this.rows.length === 0) {
      contentEl.createEl("p", { text: t("modal.canvasBridge.noIdeas") });
      const closeRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
      closeRow.createEl("button", { text: t("modal.close") }).addEventListener("click", () => this.close());
      return;
    }

    const list = contentEl.createDiv({ cls: "feuillets-canvas-bridge-list" });
    this.renderList(list);

    let folderInput: HTMLInputElement | null = null;
    if (this.mode === "manuscript") {
      contentEl.createEl("label", { text: t("modal.canvasBridge.destinationLabel") });
      folderInput = contentEl.createEl("input", { type: "text" });
      folderInput.addClass("feuillets-input-full");
      const root = getProjectFolder(this.app, this.settings);
      folderInput.value = root ? root.path : "";
      new FolderSuggest(this.app, folderInput);
    } else {
      const notebook = findNotebookResearchFolder(this.app, this.settings);
      const researchPath = notebook
        ? notebook.path
        : `${researchFolderPath(this.app, this.settings, getProjectFolder(this.app, this.settings)) || ""}/${notebookFolderName()}`;
      contentEl.createEl("p", {
        cls: "feuillets-muted",
        text: t("modal.canvasBridge.researchDestination", { path: researchPath }),
      });
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.canvasBridge.confirm"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => { void this.confirm(folderInput); });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  private renderList(list: HTMLElement) {
    list.empty();
    this.rows.forEach((node, i) => {
      const row = list.createDiv({ cls: "feuillets-canvas-bridge-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.checked.has(node.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.checked.add(node.id);
        else this.checked.delete(node.id);
      });

      const label = row.createDiv({ cls: "feuillets-canvas-bridge-label" });
      const title = deriveTitle(node.text || "") || firstMeaningfulLine(node.text || "") || t("modal.canvasBridge.untitledIdea");
      label.createSpan({ text: title, cls: "feuillets-canvas-bridge-title" });

      const moveBtns = row.createDiv({ cls: "feuillets-canvas-bridge-move" });
      const up = moveBtns.createEl("button", { text: "↑" });
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        [this.rows[i - 1], this.rows[i]] = [this.rows[i], this.rows[i - 1]];
        this.renderList(list);
      });
      const down = moveBtns.createEl("button", { text: "↓" });
      down.disabled = i === this.rows.length - 1;
      down.addEventListener("click", () => {
        if (i === this.rows.length - 1) return;
        [this.rows[i + 1], this.rows[i]] = [this.rows[i], this.rows[i + 1]];
        this.renderList(list);
      });
    });
  }

  private async confirm(folderInput: HTMLInputElement | null) {
    const orderedIds = this.rows.filter((n) => this.checked.has(n.id)).map((n) => n.id);
    if (orderedIds.length === 0) {
      new Notice(t("modal.canvasBridge.noSelection"));
      return;
    }

    let destFolder: TFolder | null;
    if (this.mode === "manuscript") {
      const raw = normalizePath((folderInput?.value || "").trim());
      const af = raw ? this.app.vault.getAbstractFileByPath(raw) : null;
      destFolder = af instanceof TFolder ? af : null;
      if (!destFolder) {
        new Notice(t("modal.canvasBridge.invalidFolder"));
        return;
      }
    } else {
      destFolder = await ensureNotebookResearchFolder(this.app, this.settings);
      if (!destFolder) {
        new Notice(t("modal.canvasBridge.invalidFolder"));
        return;
      }
    }

    const result = await applySelectedIdeas(this.app, this.canvas, orderedIds, destFolder, this.mode, this.runtimeCanvas);
    await this.persist(this.canvas);

    this.close();
    new Notice(t("modal.canvasBridge.done", { count: String(result.created) }));
    this.onDone?.();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Modale minimale du node-menu Advanced Canvas (clic droit direct sur UNE
 * carte, action « Transformer en feuillet ») : l'idée est déjà connue par
 * son id, seule la destination manuscrit reste à choisir — jamais de
 * liste des autres idées, jamais de case à cocher, jamais de
 * monter/descendre (voir integrations/advanced-canvas.ts,
 * canvas:node-menu). La conversion elle-même n'est jamais faite ici :
 * `onConfirm` reçoit juste le dossier choisi, l'appelant réutilise le même
 * pipeline canvas-bridge que partout ailleurs. */
export class CanvasNodeToManuscriptModal extends Modal {
  private settings: FeuilletsSettings;
  private ideaTitle: string;
  private onConfirm: (folder: TFolder, title: string) => void | Promise<void>;

  constructor(
    app: App,
    settings: FeuilletsSettings,
    ideaTitle: string,
    onConfirm: (folder: TFolder, title: string) => void | Promise<void>
  ) {
    super(app);
    this.settings = settings;
    this.ideaTitle = ideaTitle;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.canvasBridgeNode.title", { idea: this.ideaTitle }) });
    contentEl.createEl("label", { text: t("modal.canvasBridge.destinationLabel") });
    const folderInput = contentEl.createEl("input", { type: "text" });
    folderInput.addClass("feuillets-input-full");
    const root = getProjectFolder(this.app, this.settings);
    folderInput.value = root ? root.path : "";
    new FolderSuggest(this.app, folderInput);
    contentEl.createEl("label", { text: "Titre" });
    const titleInput = contentEl.createEl("input", { type: "text" });
    titleInput.addClass("feuillets-input-full");
    titleInput.value = this.ideaTitle;
    titleInput.focus();

    const submit = () => {
      const raw = normalizePath((folderInput.value || "").trim());
      const af = raw ? this.app.vault.getAbstractFileByPath(raw) : null;
      if (!(af instanceof TFolder)) {
        new Notice(t("modal.canvasBridge.invalidFolder"));
        return;
      }
      this.close();
      void this.onConfirm(af, titleInput.value);
    };
    folderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("modal.canvasBridge.confirm"), cls: "mod-cta" }).addEventListener("click", submit);
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
