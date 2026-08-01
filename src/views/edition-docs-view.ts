import { Modal, Notice, TFile, TFolder, normalizePath, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { getEditionRoot, editionFolderPath } from "../services/folder-structure.js";
import { ensureEditionFolder } from "../services/project-files.js";
import { openFileActivating } from "../utils/dom.js";

type EditionDocsPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];

type FileExplorerInstance = { revealInFolder?(file: TFile): void };
type AppWithInternalPlugins = App & {
  internalPlugins?: { getPluginById?(id: string): { instance?: FileExplorerInstance } | undefined };
};

/** Révèle un fichier dans l'explorateur natif d'Obsidian (pas le Binder de
 * Feuillets) — même geste que le clic droit "Afficher dans l'explorateur"
 * natif. Silencieux si le plugin natif file-explorer est indisponible ou
 * désactivé plutôt que de lever une erreur : ce n'est jamais l'action
 * principale du bouton (ouvrir l'est), juste un raccourci de confort. */
export function revealInFileExplorer(app: App, file: TFile): boolean {
  const instance = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("file-explorer")?.instance;
  if (!instance?.revealInFolder) return false;
  instance.revealInFolder(file);
  return true;
}

/** Modale minimale à un seul champ — nom du nouveau document à créer
 * directement à la racine du dossier Edition (mêmes conventions que
 * NewFolderModal, basic-modals.ts, mais pour un fichier .md plutôt qu'un
 * dossier). */
class NewEditionDocumentModal extends Modal {
  onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("editionDocs.newDocumentModalTitle") });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: t("editionDocs.newDocumentPlaceholder"),
    });
    input.addClass("feuillets-input-full");
    input.focus();
    const submit = (): void => {
      const name = input.value.trim();
      if (!name) return;
      this.close();
      this.onSubmit(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const btn = contentEl.createEl("button", { cls: "mod-cta", text: t("editionDocs.createDocumentSubmit") });
    btn.addEventListener("click", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Onglet "Documents éditoriaux" du nouvel espace Édition (lot 1) : affiche
 * le contenu du dossier Edition/ (facultatif, voisin de Manuscrit — voir
 * folder-structure.js) et permet de le créer, d'y ouvrir/créer des
 * documents et de les révéler dans l'explorateur natif. Volontairement
 * indépendant du panneau Révision DOCX (DocxReviewView) : les deux
 * cohabitent dans le même onglet "Édition" du panneau latéral
 * (sidebar-feuillets-view.js) sans partager d'état. */
export class EditionDocsView extends BaseFeuilletsView {
  declare plugin: EditionDocsPlugin;
  declare targetContainer?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: EditionDocsPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-edition-docs";
  }

  getDisplayText(): string {
    return t("editionDocs.displayText");
  }

  getIcon(): string {
    return "folder-cog";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-docs-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "folder-cog",
      t("editionDocs.displayText"),
      "editionDocs",
      "documents"
    );
    if (collapsed) return;

    const root = this.plugin.getProjectFolder();
    if (!root) {
      section.createDiv({ cls: "feuillets-empty" }).setText(t("board.noProjectFolder"));
      return;
    }

    const editionRoot = getEditionRoot(this.app, root);
    if (!editionRoot) {
      this.renderCreatePrompt(section, root);
      return;
    }

    this.renderToolbar(section, editionRoot);
    this.renderFolderEntries(section, editionRoot);
  }

  private renderCreatePrompt(section: HTMLElement, root: TFolder): void {
    const body = section.createDiv({ cls: "feuillets-edition-docs-empty" });
    body.createEl("p", { text: t("editionDocs.notCreatedBody") });
    const btn = body.createEl("button", { cls: "mod-cta", text: t("editionDocs.createFolder") });
    btn.addEventListener("click", () => {
      void (async () => {
        await ensureEditionFolder(this.app, root);
        await this.render();
      })();
    });
  }

  private renderToolbar(section: HTMLElement, editionRoot: TFolder): void {
    const toolbar = section.createDiv({ cls: "feuillets-project-actions" });
    this.iconBtn(toolbar, "file-plus", t("editionDocs.newDocument"), () => {
      new NewEditionDocumentModal(this.app, (name) => {
        void this.createDocument(editionRoot, name);
      }).open();
    });
  }

  private async createDocument(editionRoot: TFolder, name: string): Promise<void> {
    const fileName = name.endsWith(".md") ? name : `${name}.md`;
    const path = normalizePath(`${editionRoot.path}/${fileName}`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t("editionDocs.alreadyExists"));
      return;
    }
    const title = fileName.replace(/\.md$/, "");
    const file = await this.app.vault.create(path, `# ${title}\n\n`);
    openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    await this.render();
  }

  /** Mêmes classes `.feuillets-project-row*` que le panneau Projet/Recherche
   * (base-feuillets-view.js) — un seul langage visuel pour "une ligne de
   * fichier/dossier cliquable avec icône + actions" dans tout le plugin,
   * plutôt qu'un style ad hoc pour ce nouvel onglet. */
  private renderFolderEntries(parent: HTMLElement, folder: TFolder, depth = 0): void {
    const children = [...folder.children].sort((a, b) => {
      if (a instanceof TFolder && !(b instanceof TFolder)) return -1;
      if (!(a instanceof TFolder) && b instanceof TFolder) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
    if (children.length === 0) {
      parent.createDiv({ cls: "feuillets-empty" }).setText(t("editionDocs.emptyFolder"));
      return;
    }
    const list = parent.createDiv({ cls: "feuillets-project-list" });
    for (const child of children) {
      if (child instanceof TFolder) {
        this.renderFolderRow(list, child, depth);
        this.renderFolderEntries(list, child, depth + 1);
      } else if (child instanceof TFile) {
        this.renderFileRow(list, child, depth);
      }
    }
  }

  private renderFolderRow(parent: HTMLElement, folder: TFolder, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const icon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, "folder");
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(folder.name);
  }

  private renderFileRow(parent: HTMLElement, file: TFile, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const icon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, "file-text");
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(file.basename);
    row.addEventListener("click", () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    });
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    this.iconBtn(actions, "folder-open", t("editionDocs.revealTooltip"), (e) => {
      e.stopPropagation();
      if (!revealInFileExplorer(this.app, file)) {
        new Notice(t("editionDocs.revealUnavailable"));
      }
    });
  }
}

/** Réexporté pour les services/tests qui n'ont besoin que du chemin, sans
 * dépendre de toute la vue. */
export { editionFolderPath };
