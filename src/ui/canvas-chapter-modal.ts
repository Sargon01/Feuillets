import { Modal, Notice, TFolder, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";
import { FolderSuggest } from "./folder-suggest.js";
import type { CanvasBridgePersist } from "./canvas-bridge-modal.js";
import type { CanvasData, CanvasNode } from "../services/canvas-board.js";
import { deriveTitle, firstMeaningfulLine } from "../services/canvas-bridge.js";
import {
  admissibleChapterNodes,
  makeManuscriptPathChecker,
  makeBinderIndex,
  defaultChapterOrder,
  defaultChapterNameForGroup,
  nodesContainedInGroup,
  groupNodesOf,
  buildChapterPlan,
  isChapterPlanError,
  executeChapterPlan,
} from "../services/canvas-chapter.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { titleFor } from "../services/frontmatter.js";
import type { MinimalRuntimeCanvas } from "../services/canvas-runtime.js";

/** Contexte d'ouverture : un groupe précis (node-menu), une sélection déjà
 * connue (selection-menu), ou rien de préétabli (commande palette — voir
 * section 4 : choisir un groupe existant OU cocher manuellement). */
export type CanvasChapterContext =
  | { source: "group"; group: CanvasNode }
  | { source: "selection"; ids: string[] }
  | { source: "idea-tree"; ids: string[] }
  | { source: "command" };

export type CanvasChapterModalOptions = {
  persist?: CanvasBridgePersist;
  saveSettings: () => void | Promise<void>;
  onDone?: () => void;
  /** Canvas Advanced Canvas RÉEL (couche instances, voir services/canvas-
   * runtime.ts) — transmis à `executeChapterPlan` pour que chaque text node
   * retenu comme scène devienne un vrai FileNode runtime, jamais une simple
   * mise à jour JSON. Absent en repli (commande palette sans Advanced
   * Canvas) : comportement JSON inchangé. */
  runtimeCanvas?: MinimalRuntimeCanvas;
};

/** Modale de création d'un chapitre depuis le Carnet — reste volontairement
 * simple (section 7) : nom, destination, éléments cochables et ordonnables,
 * rien d'autre. Aucune métadonnée narrative n'est jamais demandée ici. */
export class CanvasChapterModal extends Modal {
  private settings: FeuilletsSettings;
  private canvas: CanvasData;
  private context: CanvasChapterContext;
  private persist: CanvasBridgePersist;
  private saveSettingsFn: () => void | Promise<void>;
  private onDone?: () => void;
  private runtimeCanvas?: MinimalRuntimeCanvas;

  private isManuscriptPath: (path: string) => boolean;
  private allAdmissible: CanvasNode[];
  private groups: CanvasNode[];
  private rows: CanvasNode[] = [];
  private checked: Set<string> = new Set();
  private references: CanvasNode[] = [];
  private activeGroupId: string | null = null;

  private nameInput?: HTMLInputElement;
  private itemsEl?: HTMLElement;
  private referencesEl?: HTMLElement;

  constructor(
    app: App,
    settings: FeuilletsSettings,
    canvas: CanvasData,
    context: CanvasChapterContext,
    options: CanvasChapterModalOptions
  ) {
    super(app);
    this.settings = settings;
    this.canvas = canvas;
    this.context = context;
    this.persist = options.persist || ((data) => { void data; });
    this.saveSettingsFn = options.saveSettings;
    this.onDone = options.onDone;
    this.runtimeCanvas = options.runtimeCanvas;

    this.isManuscriptPath = makeManuscriptPathChecker(app, settings);
    this.allAdmissible = admissibleChapterNodes(canvas.nodes || [], this.isManuscriptPath);
    this.groups = groupNodesOf(canvas);

    this.applyContext(context);
  }

  private binderIndex(): (path: string) => number {
    const root = getProjectFolder(this.app, this.settings);
    return root ? makeBinderIndex(this.app, this.settings, root) : () => Number.MAX_SAFE_INTEGER;
  }

  private applyContext(context: CanvasChapterContext) {
    if (context.source === "group") {
      this.activeGroupId = context.group.id;
      const contained = nodesContainedInGroup(this.canvas, context.group);
      this.rows = defaultChapterOrder(admissibleChapterNodes(contained, this.isManuscriptPath), this.binderIndex());
      this.references = contained.filter((n) => !this.rows.includes(n) && n.type !== "group");
      this.checked = new Set(this.rows.map((n) => n.id));
    } else if (context.source === "selection") {
      const byId = new Map(this.allAdmissible.map((n) => [n.id, n]));
      const selected = context.ids.map((id) => byId.get(id)).filter((n): n is CanvasNode => !!n);
      this.rows = defaultChapterOrder(selected, this.binderIndex());
      this.references = [];
      this.checked = new Set(this.rows.map((n) => n.id));
    } else if (context.source === "idea-tree") {
      // L'ordre DFS pré-calculé par canvas-idea-tree.ts porte l'intention de
      // la branche. Aucun tri spatial/Binder ne doit le remplacer ici.
      const byId = new Map((this.canvas.nodes || []).map((n) => [n.id, n]));
      const branch = context.ids.map((id) => byId.get(id)).filter((n): n is CanvasNode => !!n);
      this.rows = admissibleChapterNodes(branch, this.isManuscriptPath);
      this.references = branch.filter((n) => !this.rows.includes(n) && n.type !== "group");
      this.checked = new Set(this.rows.map((n) => n.id));
    } else {
      this.rows = defaultChapterOrder(this.allAdmissible, this.binderIndex());
      this.references = [];
      this.checked = new Set();
    }
  }

  private groupLabel(g: CanvasNode): string {
    const label = defaultChapterNameForGroup(g);
    return label || t("modal.canvasChapter.groupPickerUnnamed");
  }

  private itemLabel(node: CanvasNode): string {
    if (node.type === "text") {
      return deriveTitle(node.text || "") || firstMeaningfulLine(node.text || "") || t("modal.canvasBridge.untitledIdea");
    }
    const file = this.app.vault.getAbstractFileByPath(String(node.file));
    if (file instanceof TFile) return titleFor(this.app, file);
    return String(node.file);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.canvasChapter.title") });

    contentEl.createEl("label", { text: t("modal.canvasChapter.nameLabel") });
    this.nameInput = contentEl.createEl("input", { type: "text" });
    this.nameInput.addClass("feuillets-input-full");
    this.nameInput.placeholder = t("modal.canvasChapter.namePlaceholder");
    if (this.context.source === "group") {
      this.nameInput.value = defaultChapterNameForGroup(this.context.group);
    } else if (this.context.source === "idea-tree") {
      // Lot 5 (section 8) : le nom prérempli est celui du NODE CLIQUÉ, la
      // racine de la branche choisie — context.ids[0] (voir
      // integrations/advanced-canvas.ts, `ideaTreeBranch(fresh, data!.id)`),
      // jamais `ideaTreeRoot()` : sur A─B─C, une action lancée depuis B doit
      // proposer « B », pas « A ».
      const clickedId = this.context.ids[0];
      const clicked = clickedId ? this.canvas.nodes.find((n) => n.id === clickedId) : undefined;
      if (clicked) this.nameInput.value = this.itemLabel(clicked);
    }
    this.nameInput.focus();

    if (this.context.source === "command" && this.groups.length > 0) {
      contentEl.createEl("label", { text: t("modal.canvasChapter.groupPickerLabel") });
      const select = contentEl.createEl("select");
      select.addClass("feuillets-input-full");
      select.createEl("option", { text: t("modal.canvasChapter.groupPickerManual"), value: "" });
      for (const g of this.groups) {
        select.createEl("option", { text: this.groupLabel(g), value: g.id });
      }
      select.addEventListener("change", () => {
        const id = select.value;
        if (!id) {
          this.activeGroupId = null;
          this.references = [];
          this.checked = new Set();
        } else {
          const group = this.groups.find((g) => g.id === id) || null;
          if (group) {
            this.activeGroupId = group.id;
            const contained = nodesContainedInGroup(this.canvas, group);
            const admissible = admissibleChapterNodes(contained, this.isManuscriptPath);
            this.rows = defaultChapterOrder(admissible, this.binderIndex());
            this.references = contained.filter((n) => !this.rows.includes(n) && n.type !== "group");
            this.checked = new Set(this.rows.map((n) => n.id));
            if (!this.nameInput!.value.trim()) this.nameInput!.value = defaultChapterNameForGroup(group);
          }
        }
        this.renderItems();
        this.renderReferences();
      });
    }

    contentEl.createEl("label", { text: t("modal.canvasBridge.destinationLabel") });
    const folderInput = contentEl.createEl("input", { type: "text" });
    folderInput.addClass("feuillets-input-full");
    const root = getProjectFolder(this.app, this.settings);
    folderInput.value = root ? root.path : "";
    new FolderSuggest(this.app, folderInput);

    contentEl.createEl("label", { text: t("modal.canvasChapter.itemsLabel") });
    this.itemsEl = contentEl.createDiv({ cls: "feuillets-canvas-bridge-list" });
    this.renderItems();
    this.referencesEl = contentEl.createDiv({ cls: "feuillets-muted" });
    this.renderReferences();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.canvasChapter.confirm"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => { void this.confirm(folderInput); });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  private renderReferences() {
    if (!this.referencesEl) return;
    this.referencesEl.empty();
    for (const ref of this.references) {
      this.referencesEl.createEl("p", {
        text: t("modal.canvasChapter.referenceNotIncluded", { name: this.itemLabel(ref) }),
      });
    }
  }

  private renderItems() {
    if (!this.itemsEl) return;
    const list = this.itemsEl;
    list.empty();
    // `this.rows` porte déjà la bonne liste dans tous les cas : contenu du
    // groupe (source "group" ou groupe choisi dans le sélecteur), sélection
    // transmise (source "selection"), ou tous les éléments admissibles du
    // Carnet à cocher librement (source "command" sans groupe choisi) —
    // voir applyContext() et le gestionnaire de <select> dans onOpen().
    const rows = this.rows;

    rows.forEach((node, i) => {
      const row = list.createDiv({ cls: "feuillets-canvas-bridge-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.checked.has(node.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.checked.add(node.id);
        else this.checked.delete(node.id);
      });

      const label = row.createDiv({ cls: "feuillets-canvas-bridge-label" });
      label.createSpan({ text: this.itemLabel(node), cls: "feuillets-canvas-bridge-title" });

      const moveBtns = row.createDiv({ cls: "feuillets-canvas-bridge-move" });
      const up = moveBtns.createEl("button", { text: "↑" });
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        this.renderItems();
      });
      const down = moveBtns.createEl("button", { text: "↓" });
      down.disabled = i === rows.length - 1;
      down.addEventListener("click", () => {
        if (i === rows.length - 1) return;
        [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
        this.renderItems();
      });
    });
  }

  private async confirm(folderInput: HTMLInputElement) {
    const raw = normalizePath((folderInput.value || "").trim());
    const destFolder = raw ? this.app.vault.getAbstractFileByPath(raw) : null;
    const root = getProjectFolder(this.app, this.settings);
    if (
      !(destFolder instanceof TFolder) ||
      !root ||
      (destFolder.path !== root.path && !destFolder.path.startsWith(root.path + "/"))
    ) {
      new Notice(t("modal.canvasChapter.errorInvalidDestination"));
      return;
    }

    const orderedNodes = this.rows.filter((n) => this.checked.has(n.id));
    const name = (this.nameInput?.value || "").trim();
    const plan = buildChapterPlan(name, destFolder.path, orderedNodes, (p) => !!this.app.vault.getAbstractFileByPath(p));

    if (isChapterPlanError(plan)) {
      if (plan.code === "empty-name") new Notice(t("modal.canvasChapter.errorEmptyName"));
      else if (plan.code === "no-items") new Notice(t("modal.canvasChapter.errorNoItems"));
      else new Notice(t("modal.canvasChapter.errorCollision", { name }));
      return;
    }

    const result = await executeChapterPlan(this.app, this.settings, this.canvas, plan, this.runtimeCanvas);
    if (!result.ok) {
      new Notice(t("modal.canvasChapter.errorFailed"));
      return;
    }

    await this.persist(this.canvas);
    await this.saveSettingsFn();
    this.close();
    new Notice(t("modal.canvasChapter.done", { name: plan.chapterName, count: String(plan.items.length) }));
    this.onDone?.();
  }

  onClose() {
    this.contentEl.empty();
  }
}
