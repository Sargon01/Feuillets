import { getProjectStatuses, VIEW_SCRIVENINGS } from "../constants.js";
import { projectWordGoalDefault, projectTolerance } from "../services/project-settings.js";
import { writeLogicalFrontmatterField, isMappableField } from "../services/frontmatter.js";
import { foldAccents } from "../utils/core.js";
import { refreshSearchIndex } from "../utils/search-index.js";
import { AppearancesModal, FolderGoalModal, TagsModal, SaveResearchFilterModal, ManageSavedFiltersModal } from "../ui/entity-modals.js";
import { TextInputModal } from "../scenes-editor.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { NewFolderModal, RenameFolderModal, NewResearchFileModal, RenameFileModal } from "../ui/basic-modals.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getResearchTemplate } from "../services/research-templates.js";
import { promptForPage } from "../ui/citation-modal.js";
import { CompareFilesModal, PickFileModal } from "../ui/diff-modal.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { listSnapshotFiles } from "../services/project-files.js";
import { isResearchFile, isImageFile, isPdfFile, researchFolderPath } from "../services/research.js";
import { resourcesFolderPath, resourcesSubfolderPath } from "../services/folder-structure.js";
import { addOpenWithPreviewItem, openScopeWithPreviewBesideLeaf } from "./preview-view.js";
import { openScopeInContinu, openScopeInContinuOnLeaf } from "./scrivenings-view.js";
import { createFolderScope, createSelectionScope, compileScopesEqual, resolveCompileScopeFiles, type CompileScope } from "../services/compile-scope.js";
import { RESEARCH_FOLDERS, researchFolderLabel, researchFolderNames } from "../utils/project-modes.js";
import { FolderSuggest } from "../ui/folder-suggest.js";
import { t } from "../i18n/index.js";
import { FEUILLETS_FILE_DRAG_MIME } from "../carnet/canvas/adapter.js";
export { remapResearchFolderLinks } from "../carnet/core/path-reference-maintenance.js";

function getResearchSectionIcon(key: string): string {
  return (
    {
      sources: "file-search",
      bibliographie: "library",
      codex: "book-marked",
      personnages: "users",
      lieux: "map-pin",
      glossaire: "spell-check",
      evenements: "calendar",
      coffre: "archive",
      linked: "link",
    } as Record<string, string>
  )[key] || "info";
}

/** Synchronise le `title:` du frontmatter d'un template de fiche Recherche
 * (texte brut, AVANT création du fichier) avec le nom réellement saisi par
 * l'utilisateur — voir promptCreateResearchFile(). `defaultName` est le
 * nom générique passé à getResearchTemplate() (ex. "Nouveau nouveau" pour
 * un dossier personnalisé nommé "Nouveau") qui a servi à générer ce
 * `title:` par défaut ; `cleanName` est le nom que l'utilisateur a
 * effectivement tapé dans la modale (ex. "Mon document"). Ne remplace la
 * valeur QUE si elle correspond EXACTEMENT à `defaultName` — un template
 * sans `title:` n'est jamais modifié, et un `title:` déjà personnalisé
 * (différent de `defaultName`, ex. un modèle utilisateur volontairement
 * titré, ou une fiche personnage qui n'utilise pas `title`) n'est jamais
 * écrasé. N'agit que sur ce texte brut — ne touche ni titleFor() ni
 * fmOf(), et ne lit/écrit rien via metadataCache. */
function syncResearchFileTitle(template: string, defaultName: string, cleanName: string): string {
  const fmMatch = template.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return template;

  const titleLineMatch = fmMatch[1].match(/^title:[ \t]*(.*)$/m);
  if (!titleLineMatch) return template;

  const rawValue = titleLineMatch[1].trim();
  const quotedMatch = rawValue.match(/^"(.*)"$/) || rawValue.match(/^'(.*)'$/);
  const currentValue = quotedMatch ? quotedMatch[1] : rawValue;
  if (currentValue !== defaultName) return template;

  const quoteChar = quotedMatch ? rawValue[0] : "";
  const escapedName = quoteChar === '"' ? cleanName.replace(/"/g, '\\"') : cleanName;
  const newValue = quoteChar ? `${quoteChar}${escapedName}${quoteChar}` : cleanName;

  return template.replace(titleLineMatch[0], `title: ${newValue}`);
}

import {
  ItemView,
  TFile,
  TFolder,
  Notice,
  normalizePath,
  setIcon,
  setTooltip,
  Menu,
  MarkdownRenderer,
  MarkdownView,
  Keymap,
  Modal,
  type WorkspaceLeaf,
  type TAbstractFile,
  type App,
} from "obsidian";
import type FeuilletsPlugin from "../main.js";

/** LOT « ouvrir avec aperçu » — surface MINIMALE d'une vraie vue Continu
 * (ScriveningsView) telle qu'exploitée par `openScopeWithContinuAndPreview`
 * ci-dessous. Garde structurelle SANS `instanceof` : même patron que
 * `isOpenScopeView` (scrivenings-view.ts) et `isScopeableView`
 * (preview-view.ts) — reconnaît la vraie vue par sa surface publique,
 * jamais en important la classe `ScriveningsView` ici. */
interface ContinuWorkView {
  getViewType(): string;
  compileScope: CompileScope | null;
  openScope(scope: CompileScope): Promise<boolean>;
  refreshHostTypography?(): void;
}

function isContinuWorkView(view: unknown): view is ContinuWorkView {
  return (
    typeof view === "object" &&
    view !== null &&
    "getViewType" in view &&
    typeof (view as { getViewType?: unknown }).getViewType === "function" &&
    "openScope" in view &&
    typeof (view as { openScope?: unknown }).openScope === "function" &&
    (view as { getViewType: () => string }).getViewType() === VIEW_SCRIVENINGS
  );
}

/** ensureFolder() garantit toujours un dossier (services/project-files.ts) —
 * ce helper narrowe sans cast direct pour obsidianmd/no-tfile-tfolder-cast ;
 * le throw n'est jamais atteint en pratique. */
function asFolder(af: TAbstractFile): TFolder {
  if (!(af instanceof TFolder)) throw new Error(`Expected a folder: ${af.path}`);
  return af;
}

/** Dossier Binder : soit un dossier (partie/chapitre), soit un fichier
 * Markdown du manuscrit — les deux peuvent être associés à un dossier
 * Recherche. */
type BinderNode = TFolder | TFile;

/** Affiche les sélecteurs compacts près du clic qui a ouvert le menu Binder.
 * L'événement du clic sur l'item du premier menu est volontairement ignoré :
 * seule la position du `contextmenu` initial correspond au clic droit. */
export function showChoices(
  _event: MouseEvent | KeyboardEvent,
  origin: MouseEvent,
  fill: (menu: Menu) => void
): void {
  const menu = new Menu();
  fill(menu);
  menu.showAtMouseEvent(origin);
}

/** Vrai si `folderPath` est un dossier STRICTEMENT sous `basePath` — jamais
 * `basePath` lui-même. N'est plus utilisée pour restreindre l'association
 * Binder → Recherche (un dossier lié peut être n'importe où dans le coffre,
 * voir LinkResearchFolderModal ci-dessous) ; conservée comme prédicat pur,
 * exporté pour les tests. */
export function isInsideResearchSpace(folderPath: string, basePath: string): boolean {
  return folderPath !== basePath && folderPath.startsWith(`${basePath}/`);
}

/** Résout la saisie de LinkResearchFolderModal à l'appui sur Entrée SANS
 * clic sur une suggestion : `candidates` est le résultat de
 * FolderSuggest.getSuggestions(saisie) sur le texte courant. N'accepte
 * jamais de résolution approximative : "none" si aucun dossier ne
 * correspond, "ambiguous" si plusieurs correspondent (l'utilisateur doit
 * alors choisir explicitement une suggestion), sinon l'unique TFolder.
 * Fonction pure, exportée pour les tests. */
export function resolveUniqueFolderMatch(candidates: TFolder[]): TFolder | "none" | "ambiguous" {
  if (candidates.length === 0) return "none";
  if (candidates.length === 1) return candidates[0];
  return "ambiguous";
}

/** Modale de choix d'un dossier EXISTANT du coffre à associer à un dossier
 * ou un fichier Binder (associer ou changer) — simple SOURCE DOCUMENTAIRE,
 * jamais un élément du Binder ni compilé. N'importe quel dossier du coffre
 * peut être associé, y compris hors du projet actif (autre projet,
 * documentation externe…). Ne crée jamais de dossier : on ne fait que
 * mémoriser le chemin dans researchFolderLinks.
 *
 * Recherche dans TOUT le coffre (FolderSuggest, par nom ou morceau de
 * chemin). La sélection d'une suggestion (clic ou clavier) mémorise
 * directement le TFolder choisi — jamais de re-résolution depuis le texte
 * affiché. Sans sélection explicite, Entrée n'accepte que si la saisie
 * désigne SANS AMBIGUÏTÉ un seul dossier ; sinon on redemande à
 * l'utilisateur de choisir explicitement une suggestion. */
class LinkResearchFolderModal extends Modal {
  plugin: FeuilletsPlugin;
  binderNode: BinderNode;
  displayName: string;

  constructor(app: App, plugin: FeuilletsPlugin, binderNode: BinderNode, displayName: string) {
    super(app);
    this.plugin = plugin;
    this.binderNode = binderNode;
    this.displayName = displayName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("binder.research.linkModalTitle", { name: this.displayName }),
    });
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("binder.research.linkModalPlaceholder") },
    });
    input.addClass("feuillets-input-full");
    const suggest = new FolderSuggest(this.app, input);
    let selectedFolder: TFolder | null = null;
    suggest.onSelect((folder) => {
      selectedFolder = folder;
    });
    input.focus();
    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) return;
      /* Le TFolder mémorisé par onSelect n'est réutilisé que tant que la
         saisie visible n'a pas changé depuis la sélection — sinon on
         retombe sur la résolution par correspondance unique ci-dessous. */
      let folder: TFolder | null =
        selectedFolder && selectedFolder.path === raw ? selectedFolder : null;
      if (!folder) {
        const resolved = resolveUniqueFolderMatch(suggest.getSuggestions(raw));
        if (resolved === "none") {
          new Notice(t("binder.research.linkFolderNotFound"));
          return;
        }
        if (resolved === "ambiguous") {
          new Notice(t("binder.research.linkFolderAmbiguous"));
          return;
        }
        folder = resolved;
      }
      this.close();
      await this.plugin.setLinkedResearchFolder(this.binderNode, folder);
      this.plugin.renderAllViews(true);
      new Notice(t("binder.research.folderLinked", { name: folder.name }));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", () => { void submit(); });
  }

  onClose() {
    this.contentEl.empty();
  }
}

type ProjectNode = TFile | TFolder;

function cleanExcerpt(text: string): string {
  return String(text || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function formatExcerpt(text: string): string {
  const cleaned = cleanExcerpt(text);
  if (!cleaned) return "";
  const paragraphCount = cleaned.split(/\n\n+/).filter(Boolean).length;
  const isLong = cleaned.length > 220 || paragraphCount > 1;
  return isLong ? `\n${cleaned}\n` : cleaned;
}

function formatSourcedExcerpt(text: string, filePath: string): string {
  const compact = cleanExcerpt(text);
  if (!compact) return "";
  const paragraphCount = compact.split(/\n\n+/).filter(Boolean).length;
  const isLong = compact.length > 220 || paragraphCount > 1;
  return isLong
    ? `\n${compact}\n\nSource : [[${filePath}]]\n`
    : `${compact}\n\nSource : [[${filePath}]]`;
}

export abstract class BaseFeuilletsView extends ItemView {
  plugin!: FeuilletsPlugin;

  /* Propriétés d'instance, jamais initialisées dans un constructeur dédié
     (sous-classes et méthodes de cette base les posent au fil du rendu) —
     voir chaque site d'assignation pour le détail. */
  targetContainer?: HTMLElement;
  _renderGen?: number;
  _searchCache?: Map<string, { mtime: number; text: string }>;
  _selectedTextFile?: string;
  researchFilterActive?: boolean;
  /** Dossier Recherche copié par l'utilisateur. Le presse-papiers reste
   * volontairement interne au panneau : il ne détourne pas le presse-papiers
   * système et ne permet de coller que dans une autre rubrique Recherche. */
  researchFolderClipboardPath?: string;
  selectedText?: string;
  viewingFile?: TFile | null;

  private addFolderCarnetMenuItem(menu: Menu, folder: TFolder): void {
    const candidate = this.plugin as unknown as { canUseFolderCarnet?: (folder: TFolder) => boolean; hasFolderCarnet?: (folder: TFolder) => boolean; openFolderCarnet?: (folder: TFolder) => Promise<void> };
    /* Appels en méthode sur `candidate` — jamais des références détachées
       (`const canUse = candidate.canUseFolderCarnet`) : ces trois méthodes
       lisent `this.app`/`this.settings` sur le plugin réel, une référence
       nue appelée seule (`canUse(folder)`) perd ce `this` et lève une
       TypeError AVANT `menu.showAtMouseEvent`, empêchant tout le menu de
       s'afficher — pas seulement l'item Carnet (régression constatée en
       test manuel, Binder ET Recherche). */
    if (!candidate.canUseFolderCarnet || !candidate.hasFolderCarnet || !candidate.openFolderCarnet) return;
    if (!candidate.canUseFolderCarnet(folder)) return;
    const hasCarnet = candidate.hasFolderCarnet(folder);
    menu.addItem((item) => item
      .setTitle(t(hasCarnet ? "carnet.folder.open" : "carnet.folder.create"))
      .setIcon("notebook-tabs")
      .onClick(() => void candidate.openFolderCarnet!(folder)));
  }

  getProjectLabels(): Label[] {
    const S = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    const meta = root ? S.projectMeta[root.path] : null;
    return (meta && meta.labels) ? meta.labels : (S.labels || []);
  }
  async render(_force?: boolean): Promise<void> {}

  async createEntity(folder: TFolder, baseName: string, template: string): Promise<void> {
    await this.plugin.ensureFolder(folder.path);
    let name = baseName;
    let n = 2;
    while (
      this.app.vault.getAbstractFileByPath(
        normalizePath(`${folder.path}/${name}.md`)
      )
    ) {
      name = `${baseName} ${n++}`;
    }
    const path = normalizePath(`${folder.path}/${name}.md`);
    const file = await this.app.vault.create(path, template);
    openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
  }

  /** Valide un nom de fichier (sans extension) : refuse les noms vides, / et \\. */
  private isFileNameInvalid(name: string): boolean {
    if (!name || !name.trim()) return true;
    if (name.includes("/") || name.includes("\\")) return true;
    return false;
  }

  /** Ouvre une modale de saisie puis crée le fichier nommé dans le dossier cible. */
  promptCreateResearchFile(folder: TFolder, defaultName: string, template: string): void {
    new NewResearchFileModal(this.app, folder.name, defaultName, async (rawName) => {
      const cleanName = rawName.trim();
      if (this.isFileNameInvalid(cleanName)) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      const fileName = cleanName.endsWith(".md") ? cleanName : `${cleanName}.md`;
      const destPath = normalizePath(`${folder.path}/${fileName}`);
      if (this.app.vault.getAbstractFileByPath(destPath)) {
        new Notice(t("binder.research.renameAlreadyExists", { name: cleanName }));
        return;
      }
      await this.plugin.ensureFolder(folder.path);
      // Le nom saisi doit remplacer le title générique du modèle (voir
      // syncResearchFileTitle) — sinon Recherche/Recherche contextuelle
      // continuent d'afficher l'ancien nom générique via titleFor().
      const content = syncResearchFileTitle(template, defaultName, cleanName);
      const file = await this.app.vault.create(destPath, content);
      openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      void this.render(true);
    }).open();
  }

  /** Ouvre une modale de renommage préremplie avec le basename du fichier. */
  promptRenameResearchFile(file: TFile): void {
    const currentBasename = file.basename;
    new RenameFileModal(this.app, currentBasename, async (rawName) => {
      const cleanName = rawName.trim();
      if (this.isFileNameInvalid(cleanName)) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      const fileName = cleanName.endsWith(".md") ? cleanName : `${cleanName}.md`;
      const parentPath = file.parent?.path;
      if (!parentPath) return;
      const destPath = normalizePath(`${parentPath}/${fileName}`);
      if (destPath === file.path) return; // nom inchangé
      if (this.app.vault.getAbstractFileByPath(destPath)) {
        new Notice(t("binder.research.renameAlreadyExists", { name: cleanName }));
        return;
      }
      await this.app.fileManager.renameFile(file, destPath);
      new Notice(t("binder.research.renamed", { name: cleanName }));
      void this.render(true);
    }).open();
  }

  /** Menu contextuel d'un fichier de recherche : Ouvrir (nouvel onglet/côte
   * à côte), puis Renommer/Dupliquer/Corbeille.
   * `navigationOnly` (dossier Recherche EXTERNE associé depuis le Binder,
   * hors racine Recherche du projet — voir renderAssociatedResearchFolders,
   * renderSection) : ne garde que les deux premières entrées de navigation
   * — jamais de renommer/dupliquer/corbeille sur un dossier documentaire
   * externe, en lecture/navigation seule. */
  showResearchFileContextMenu(e: MouseEvent, file: TFile, navigationOnly = false): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.openNewTab"))
        .setIcon("file-plus")
        .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.openSplit"))
        .setIcon("columns-2")
        .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file))
    );
    if (!navigationOnly) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.renameFile"))
          .setIcon("pencil")
          .onClick(() => this.promptRenameResearchFile(file))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("shared.duplicate"))
          .setIcon("copy")
          .onClick(async () => {
            const content = await this.app.vault.read(file);
            const copySuffix = t("binder.research.copySuffix");
            let name = `${file.basename} (${copySuffix})`;
            let dest = normalizePath(`${file.parent!.path}/${name}.md`);
            let k = 2;
            while (this.app.vault.getAbstractFileByPath(dest)) {
              name = `${file.basename} (${copySuffix} ${k++})`;
              dest = normalizePath(`${file.parent!.path}/${name}.md`);
            }
            await this.app.vault.create(dest, content);
            new Notice(t("shared.duplicated", { name }));
            void this.render(true);
          })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("shared.trash"))
          .setIcon("trash")
          .onClick(async () => {
            await this.app.fileManager.trashFile(file);
            new Notice(t("shared.trashed", { name: this.plugin.titleFor(file) || file.basename }));
            void this.render(true);
          })
      );
    }
    menu.showAtMouseEvent(e);
  }

  makeSynopsisArea(parent: HTMLElement, file: TFile, rows: number): HTMLTextAreaElement {
    return this.makeFmArea(parent, file, "synopsis", "Synopsis…", rows);
  }

  makeFmArea(parent: HTMLElement, file: TFile, key: string, placeholder: string, rows: number): HTMLTextAreaElement {
    const fm = this.fm(file);
    const ta = parent.createEl("textarea", {
      cls: "feuillets-synopsis",
      attr: { placeholder, rows: String(rows || 4) },
    });
    ta.value = String((fm[key] as string | number | boolean | null | undefined) || "");
    ta.addEventListener("blur", () => {
      const v = ta.value.trim();
      if (v !== String((fm[key] as string | number | boolean | null | undefined) || "")) void this.setFm(file, key, v);
    });
    return ta;
  }

  splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { frontmatter: null, body: content };
    return { frontmatter: match[1], body: content.slice(match[0].length) };
  }

  async makeBodyEditor(parent: HTMLElement, file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);
    const parts = this.splitFrontmatter(raw);
    const bodyText = parts.body.trim();

    const editorWrapper = parent.createDiv({ cls: "feuillets-body-editor-wrapper" });
    const textEl = editorWrapper.createDiv({
      cls: "feuillets-flat-text-cell" + (bodyText ? "" : " is-empty"),
      attr: { style: "cursor: pointer; min-height: 120px; padding: 8px; border-radius: var(--radius-s);" },
    });

    if (bodyText) {
      await MarkdownRenderer.render(this.app, bodyText, textEl, file.path, this);
    } else {
      textEl.createDiv({ cls: "feuillets-empty" }).setText(t("shared.sheetEditor.empty"));
    }

    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      textEl.hide();

      const ta = editorWrapper.createEl("textarea", {
        cls: "feuillets-flat-textarea feuillets-autosize",
        attr: { placeholder: t("shared.sheetEditor.placeholder"), rows: "12" },
      });
      ta.setCssStyles({ width: "100%", minHeight: "180px", fontFamily: "var(--font-monospace)" });
      ta.value = parts.body;
      ta.focus();

      ta.style.removeProperty("height");
      ta.style.height = Math.max(180, ta.scrollHeight) + "px";

      const saveAndExit = async () => {
        if (ta.parentNode) {
          const newVal = ta.value;
          if (newVal !== parts.body) {
            const newContent = parts.frontmatter
              ? `---\n${parts.frontmatter}\n---\n\n${newVal}`
              : newVal;
            await this.app.vault.modify(file, newContent);
          }
          ta.remove();
          textEl.show();
          void this.render();
        }
      };

      ta.addEventListener("blur", () => { void saveAndExit(); });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          ta.blur();
        }
      });
    });
  }

  makeLabelSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const current = this.plugin.labelOf(file);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    const none = sel.createEl("option", { text: "—" });
    none.value = "";
    for (const l of this.getProjectLabels()) {
      const opt = sel.createEl("option", { text: l.name });
      opt.value = l.name;
    }
    sel.value = current;
    sel.setAttr("title", current || t("shared.label.none"));
    const color = current ? this.plugin.labelColor(current) : null;
    if (color) sel.style.borderLeft = `4px solid ${color}`;
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "label", sel.value);
        sel.setAttr("title", sel.value || t("shared.label.none"));
        sel.blur();
      })();
    });
    return sel;
  }

  makeStatusSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const fm = this.fm(file);
    const statuses = getProjectStatuses(this.app, this.plugin ? this.plugin.settings : null);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    for (const s of statuses) {
      const opt = sel.createEl("option", { text: s || "—" });
      opt.value = s;
    }
    const status = typeof fm.status === "string" ? fm.status : "";
    sel.value = statuses.includes(status) ? status : "";
    sel.setAttr("title", sel.value || t("shared.status.none"));
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "status", sel.value);
        sel.setAttr("title", sel.value || t("shared.status.none"));
        sel.blur();
      })();
    });
    return sel;
  }

  makeTagsEditorPlain(parent: HTMLElement, file: TFile): HTMLElement {
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const tag of tags) {
      wrap.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${tag}`);
    }
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : t("shared.tags.placeholder") },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#/, "").trim())
        .filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      void (async () => {
        await this.setFm(file, "tags", merged);
        input.value = "";
        input.blur();
      })();
    });
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", t("shared.tags.removeTooltip"));
      chip.addEventListener("click", () => {
        const next = tags.filter((_, j) => j !== idx);
        void this.setFm(file, "tags", next);
      });
    });
    return wrap;
  }

  /** Dossier d'une catégorie de recherche pour la langue active : réutilise
   * un dossier déjà existant sous son nom français OU anglais (jamais de
   * doublon, même quand le projet a été créé dans l'autre langue), sinon
   * le crée sous le libellé de la langue active. */
  /** Cherche le dossier d'une catégorie de recherche pour la langue active :
   * réutilise un dossier déjà existant sous son nom français OU anglais
   * (jamais de doublon, même quand le projet a été créé dans l'autre
   * langue), sinon null. Ne crée JAMAIS de dossier : le rendu reste
   * purement descriptif. */
  private findResearchCategoryFolder(
    baseResearch: string,
    researchFolders: Record<string, { label: string }>,
    key: string
  ): TFolder | null {
    const names = researchFolderNames(researchFolders, key);
    for (const name of names) {
      const existing = this.app.vault.getAbstractFileByPath(
        normalizePath(`${baseResearch}/${name}`)
      );
      if (existing instanceof TFolder) return existing;
    }
    return null;
  }

  /** Variante d'ÉCRITURE : garantit le dossier d'une catégorie (création
   * explicite déclenchée par le bouton "+" de la rubrique, jamais par le
   * rendu). Réutilise un dossier existant sous son nom français OU anglais,
   * sinon le crée sous le libellé de la langue active. */
  private async ensureResearchCategoryFolder(
    baseResearch: string,
    researchFolders: Record<string, { label: string }>,
    key: string
  ): Promise<TFolder> {
    const existing = this.findResearchCategoryFolder(baseResearch, researchFolders, key);
    if (existing) return existing;
    const names = researchFolderNames(researchFolders, key);
    return asFolder(await this.plugin.ensureFolder(`${baseResearch}/${names[0]}`));
  }

  async renderResearchBody(container: HTMLElement, root: TFolder, gen: number): Promise<void> {
    const S = this.plugin.settings;
    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    const searchInput = toolbar.createEl("input", {
      type: "text",
      cls: "feuillets-binder-search",
      attr: { placeholder: t("shared.research.searchPlaceholder") },
    });
    searchInput.value = S.researchSearch || "";
    let researchSearchTimer: ReturnType<Window["setTimeout"]>;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(researchSearchTimer);
      S.researchSearch = searchInput.value;
      const nextFilterActive = !!searchInput.value.trim() || !!S.researchTagFilter;
      const renderedFilterActive = !!this.researchFilterActive;
      this.filterEntities();
      researchSearchTimer = window.setTimeout(() => {
        void (async () => {
          await this.plugin.saveSettings();
          if (nextFilterActive !== renderedFilterActive) await this.render(true);
          else this.filterEntities();
        })();
      }, 250);
    });

    const researchRoot = this.plugin.getResearchRoot();
    const baseResearch = researchRoot
      ? researchRoot.path
      : researchFolderPath(this.app, this.plugin.settings, root) || root.path;
    const baseResearchFile = this.app.vault.getAbstractFileByPath(baseResearch);
    const baseResearchFolder = baseResearchFile instanceof TFolder ? baseResearchFile : null;
    if (this._renderGen !== gen) return;

    const rf = RESEARCH_FOLDERS;

    /* Rubriques personnalisées (voir plus bas, "customFolders") : au lieu
       d'imposer un jeu figé de dossiers, l'utilisateur crée exactement
       les catégories dont SON sujet a besoin — un sous-dossier de
       Recherche/ créé ici apparaît automatiquement comme sa propre
       section. Disponible en fiction comme en non-fiction. */
    const newFolderBtn = this.iconBtn(toolbar, "folder-plus", t("shared.research.newTopicTooltip"));
    newFolderBtn.addEventListener("click", (event) => {
      const menu = new Menu();
      const standardKeys = [
        "personnages",
        "lieux",
        "evenements",
        "codex",
        "glossaire",
        "notes",
        "sources",
        "bibliographie",
      ];
      let hasStandardSection = false;
      for (const key of standardKeys) {
        if (this.findResearchCategoryFolder(baseResearch, rf, key)) continue;
        hasStandardSection = true;
        menu.addItem((item) =>
          item
            .setTitle(researchFolderLabel(rf, key))
            .setIcon(getResearchSectionIcon(key))
            .onClick(async () => {
              await this.ensureResearchCategoryFolder(baseResearch, rf, key);
              this.plugin.renderAllViews(true);
            })
        );
      }
      if (hasStandardSection) menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.customSection"))
          .setIcon("folder-plus")
          .onClick(() => {
            void (async () => {
              let folder = baseResearchFolder;
              if (!folder) {
                const path = researchFolderPath(this.app, this.plugin.settings, root);
                if (path) {
                  const created = await this.plugin.ensureFolder(path);
                  folder = created instanceof TFolder ? created : null;
                }
              }
              if (folder) this.plugin.newFolder(folder);
            })();
          })
      );
      menu.showAtMouseEvent(event);
    });

    const sourcesFolder = this.findResearchCategoryFolder(baseResearch, rf, "sources");
    const bibliographieFolder = this.findResearchCategoryFolder(
      baseResearch,
      rf,
      "bibliographie"
    );
    /* Rationalisation : Sources reste la SEULE
       bibliothèque de travail — Bibliographie devient la vue agrégée des
       sources citées (voir plus bas), plus un dossier de fiches
       manuelles. Aucune migration automatique des fichiers utilisateur
       (Phase 7) : Sources l'emporte simplement en lecture dès qu'il
       existe (services/bibliography-generator.ts, resolveBibliographySource)
       — les deux dossiers peuvent coexister sur le disque indéfiniment. */
    /* Chaque catégorie standard est reconnue si son dossier existe ; les
       rubriques personnalisées restent gérées séparément ci-dessous. */
    const personnagesFolder = this.findResearchCategoryFolder(baseResearch, rf, "personnages");
    const lieuxFolder = this.findResearchCategoryFolder(baseResearch, rf, "lieux");
    const codexFolder = this.findResearchCategoryFolder(baseResearch, rf, "codex");
    const glossaireFolder = this.findResearchCategoryFolder(baseResearch, rf, "glossaire");
    const chronoFolder = this.plugin.getChronoFolder();

    if (sourcesFolder || bibliographieFolder) {
      const citeSearchBtn = this.iconBtn(toolbar, "quote", t("shared.research.insertCitationTooltip"));
      citeSearchBtn.addEventListener("click", () => this.plugin.openInsertCitation());
      const renumberBtn = this.iconBtn(toolbar, "list-ordered", t("shared.research.renumberFootnotesTooltip"));
      renumberBtn.addEventListener("click", () => this.plugin.renumberActiveFootnotes());
    }

    const standardPaths = new Set([
      sourcesFolder ? sourcesFolder.path : "",
      bibliographieFolder ? bibliographieFolder.path : "",
      personnagesFolder ? personnagesFolder.path : "",
      lieuxFolder ? lieuxFolder.path : "",
      codexFolder ? codexFolder.path : "",
      glossaireFolder ? glossaireFolder.path : "",
      chronoFolder ? chronoFolder.path : "",
    ]);

    const customFolders: TFolder[] = [];
    if (baseResearchFolder) {
      for (const child of baseResearchFolder.children) {
        if (child instanceof TFolder && !standardPaths.has(child.path)) {
          if (!child.name.startsWith("_") && !child.name.startsWith(".")) {
            customFolders.push(child);
          }
        }
      }
    }

    const resPath = resourcesFolderPath(this.app, root);
    const visuelsPath = resourcesSubfolderPath(this.app, resPath, "Assets", "Visuels");
    const fVisuels = this.app.vault.getAbstractFileByPath(visuelsPath);
    if (fVisuels instanceof TFolder && fVisuels.children.some((c) => isResearchFile(c))) {
      if (!customFolders.some((f) => f.path === fVisuels.path)) {
        customFolders.push(fVisuels);
      }
    }

    customFolders.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    const tagSet = new Set<string>();
    const allEntityFiles = [
      sourcesFolder,
      bibliographieFolder,
      personnagesFolder,
      lieuxFolder,
      codexFolder,
      glossaireFolder,
      chronoFolder,
      ...customFolders,
    ]
      .filter((f): f is TFolder => f instanceof TFolder)
      .flatMap((f) =>
        f.children.filter((c): c is TFile => isResearchFile(c))
      );
    for (const f of allEntityFiles) {
      for (const tag of this.plugin.tagsOf(f)) tagSet.add(tag);
    }
    const STRUCTURAL_TAGS = new Set([
      "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
    ]);
    const tagOptions = [...tagSet]
      .filter((tag) => !STRUCTURAL_TAGS.has(foldAccents(tag)))
      .sort((a, b) => a.localeCompare(b, "fr"));

    const tagFilterActive = !!S.researchTagFilter;
    const tagFilterBtn = this.iconBtn(
      toolbar,
      tagFilterActive ? "tag" : "tags",
      tagFilterActive
        ? t("shared.research.tagFilterActive", { tag: S.researchTagFilter })
        : t("shared.research.tagFilterTooltip")
    );
    if (tagFilterActive) tagFilterBtn.addClass("feuillets-mode-active");
    tagFilterBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.allTags"))
          .setChecked(!S.researchTagFilter)
          .onClick(async () => {
            S.researchTagFilter = "";
            await this.plugin.saveSettings();
            await this.render(true);
          })
      );
      for (const tag of tagOptions) {
        menu.addItem((item) =>
          item
            .setTitle(`#${tag}`)
            .setChecked(S.researchTagFilter === tag)
            .onClick(async () => {
              S.researchTagFilter = tag;
              await this.plugin.saveSettings();
              await this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    this.renderSavedFiltersButton(toolbar, root);

    const body = container.createDiv({ cls: "feuillets-research-body" });

    this.researchFilterActive =
      !!(S.researchSearch || "").trim() || !!S.researchTagFilter;

    this.renderAssociatedResearchFolders(body, baseResearchFolder);

    if (sourcesFolder) {
      /* Sources est la SEULE bibliothèque de travail —
         icône "+" par fiche pour la citer directement (voir aussi le
         bouton "citation" de la barre d'outils, qui cherche dedans). */
      const citeRowAction = (header: HTMLElement, file: TFile) => {
        const citeBtn = this.iconBtn(header, "quote", "Citer cette source…");
        citeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.plugin.quickCiteSource(file);
        });
      };
      this.renderSection(body, researchFolderLabel(rf, "sources"), sourcesFolder, async () =>
        this.promptCreateResearchFile(
          sourcesFolder,
          rf.sources.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "sources", rf.sources.newName)
        ), "sources", citeRowAction
      );

      await this.renderFootnotesOverviewSection(body, root);
      /* "Bibliographie" ici N'EST PLUS un dossier de fiches manuelles —
         c'est la vue agrégée des sources citées + le bouton pour générer
         le fichier final (voir renderBibliographySection). Créer une
         nouvelle référence se fait dans Sources, jamais ici. */
      await this.renderBibliographySection(body, root, [sourcesFolder, ...(bibliographieFolder ? [bibliographieFolder] : [])]);
    } else if (bibliographieFolder) {
      /* Sans dossier Sources, Bibliographie garde son sens d'origine —
         un dossier de fiches
         manuelles pour des lectures complémentaires, sans lien avec le
         texte. */
      this.renderSection(body, researchFolderLabel(rf, "bibliographie"), bibliographieFolder, async () =>
        this.promptCreateResearchFile(
          bibliographieFolder,
          rf.bibliographie.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "bibliographie", rf.bibliographie.newName)
        ), "bibliographie"
      );
    }

    if (personnagesFolder) {
      this.renderSection(body, researchFolderLabel(rf, "personnages"), personnagesFolder, async () =>
        this.promptCreateResearchFile(
          personnagesFolder,
          rf.personnages.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "personnages", rf.personnages.newName)
        ), "personnages"
      );
    }

    if (lieuxFolder) {
      this.renderSection(body, researchFolderLabel(rf, "lieux"), lieuxFolder, async () =>
        this.promptCreateResearchFile(
          lieuxFolder,
          rf.lieux.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "lieux", rf.lieux.newName)
        ), "lieux"
      );
    }

    if (codexFolder) {
      this.renderSection(body, researchFolderLabel(rf, "codex"), codexFolder, async () =>
        this.promptCreateResearchFile(
          codexFolder,
          rf.codex.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "codex", rf.codex.newName)
        ), "codex"
      );
    }

    if (glossaireFolder) {
      this.renderSection(body, researchFolderLabel(rf, "glossaire"), glossaireFolder, async () =>
        this.promptCreateResearchFile(
          glossaireFolder,
          rf.glossaire.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "glossaire", rf.glossaire.newName)
        ), "glossaire"
      );
    }

    if (chronoFolder) {
      this.renderSection(body, researchFolderLabel(rf, "evenements"), chronoFolder, async () =>
        this.promptCreateResearchFile(
          chronoFolder,
          rf.evenements.newName,
          await getResearchTemplate(this.app, this.plugin.settings, "evenements", rf.evenements.newName)
        ), "evenements"
      );
    }

    // Rendu des dossiers de recherche personnalisés
    for (const folder of customFolders) {
      const folderTag = foldAccents(folder.name.toLowerCase().replace(/\s+/g, "-"));
      this.renderSection(body, folder.name, folder, async () => {
        const defaultName = `Nouveau ${folder.name.toLowerCase().replace(/s$/, "")}`;
        this.promptCreateResearchFile(
          folder,
          defaultName,
          [
            "---",
            `title: "${defaultName}"`,
            "synopsis: ",
            "tags:",
            `  - ${folderTag}`,
            "---",
            ""
          ].join("\n")
        );
      }, folderTag
      );
    }

    this.filterEntities();
  }

  /** Projette dans le panneau Recherche les dossiers associés depuis le
   * Binder (`researchFolderLinks`, voir plugin.getLinkedResearchFolders())
   * qui ne sont pas déjà visibles naturellement sous la racine Recherche du
   * projet — typiquement un dossier hors projet. Aucun nouveau modèle : on
   * ne fait que RENDRE, en lecture seule (voir le paramètre `external` de
   * renderSection), une association qui existe déjà. Un même dossier associé
   * à plusieurs nœuds du Binder n'apparaît qu'une fois, avec ses
   * associations listées de façon compacte. */
  private renderAssociatedResearchFolders(
    container: HTMLElement,
    baseResearchFolder: TFolder | null
  ): void {
    const associated = this.plugin
      .getLinkedResearchFolders()
      .filter(({ folder }) => {
        if (!baseResearchFolder) return true;
        return (
          folder.path !== baseResearchFolder.path &&
          !folder.path.startsWith(`${baseResearchFolder.path}/`)
        );
      })
      .sort((a, b) => a.folder.name.localeCompare(b.folder.name, "fr"));
    if (associated.length === 0) return;

    const groupHead = container.createDiv({
      cls: "feuillets-research-linked-group",
    });
    groupHead
      .createSpan({
        cls: "feuillets-notes-section-title feuillets-research-linked-group-title",
      })
      .setText(t("shared.research.linkedFolders"));

    for (const { folder, binderNodes } of associated) {
      const labels = binderNodes
        .map((n) => (n instanceof TFile ? this.plugin.titleFor(n) : n.name))
        .sort((a, b) => a.localeCompare(b, "fr"));
      this.renderSection(
        container,
        folder.name,
        folder,
        undefined,
        "linked",
        undefined,
        (head) => {
          head.setAttr("title", folder.path);
          if (labels.length > 0) {
            head
              .createSpan({ cls: "feuillets-research-linked-badge" })
              .setText(labels.join(" · "));
          }
        },
        true
      );
    }
  }

  async renderFileView(container: HTMLElement, file: TFile, _root: TFolder | null): Promise<void> {
    /* Ne réinitialiser la sélection que si la fiche affichée change
       vraiment — PAS à chaque appel de renderFileView. Ce panneau est
       reconstruit très souvent sans que l'utilisateur ait rien demandé :
       toute modification n'importe où dans le coffre déclenche
       refreshView()/renderAllViews() (voir main.js, vault.on("modify"))
       après 2,5 s, et ce panneau n'est pas protégé par isEditing() tant
       qu'aucun champ n'y a le focus. Avant ce correctif, sélectionner un
       extrait puis attendre quelques secondes avant de cliquer sur le
       bouton de citation perdait systématiquement la sélection — d'où
       "le bouton ne fonctionne pas, avec ou sans source ça ne change
       pas" : le rejet se produisait avant même d'atteindre la logique
       liée aux tags. */
    if (this._selectedTextFile !== file.path) {
      this.selectedText = "";
      this._selectedTextFile = file.path;
    }
    const wrapper = container.createDiv({ cls: "feuillets-fileview" });
    const bar = wrapper.createDiv({ cls: "feuillets-fileview-bar" });

    this.iconBtn(bar, "arrow-left", t("shared.fileView.closeTooltip"), () => {
      this.viewingFile = null;
      void this.render();
    });
    this.iconBtn(bar, "external-link", t("shared.openNewTab"), () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(true), file);
    });

    this.barSep(bar);

    // Boutons de prélèvement
    this.iconBtn(bar, "link", t("shared.fileView.insertLinkTooltip"), () => {
      this.plugin.insertIntoActiveEditor(`[[${file.path}]]`);
    });
    this.iconBtn(bar, "quote", t("shared.fileView.insertExcerptTooltip"), () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice(t("shared.fileView.selectExcerptFirst"));
        return;
      }
      this.plugin.insertIntoActiveEditor(formatExcerpt(this.selectedText));
    });
    this.iconBtn(bar, "book-copy", t("shared.fileView.insertSourcedExcerptTooltip"), () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice(t("shared.fileView.selectExcerptFirst"));
        return;
      }
      /* fiche Source/Bibliographie : citation formatée (footnote ou
         auteur-date selon le réglage du projet), avec sa vraie page —
         avant, ce bouton se contentait d'accrocher "Source : [[lien]]",
         jamais une référence bibliographique réelle. Toute AUTRE fiche
         (Personnage, Lieu, Codex…) n'a pas de champs de citation : garde
         le renvoi par lien, seul repère qui ait du sens pour elles. */
      const tags = this.plugin.tagsOf(file).map((tag) => foldAccents(tag));
      const isCitable = tags.includes("source") || tags.includes("bibliographie");
      if (!isCitable) {
        this.plugin.insertIntoActiveEditor(formatSourcedExcerpt(this.selectedText, file.path));
        return;
      }
      const editor = this.plugin.activeEditorAnywhere();
      if (!editor) {
        new Notice(t("shared.fileView.openSceneFirst"));
        return;
      }
      const excerpt = formatExcerpt(this.selectedText);
      promptForPage(this.app, this.plugin, file, (chosenFile, page) => {
        const at = editor.getCursor("to");
        editor.replaceRange(excerpt, at, at);
        const lines = excerpt.split("\n");
        const endLine = at.line + lines.length - 1;
        const endCh = lines.length === 1 ? at.ch + lines[0].length : lines[lines.length - 1].length;
        editor.setCursor({ line: endLine, ch: endCh });
        this.plugin.insertCitationFor(chosenFile, page, editor);
      });
    });

    this.barSep(bar);

    this.iconBtn(bar, "copy-plus", t("shared.duplicate"), async () => {
      const content = await this.app.vault.read(file);
      const copySuffix = t("binder.research.copySuffix");
      let name = `${file.basename} (${copySuffix})`;
      let dest = normalizePath(`${file.parent!.path}/${name}.md`);
      let k = 2;
      while (this.app.vault.getAbstractFileByPath(dest)) {
        name = `${file.basename} (${copySuffix} ${k++})`;
        dest = normalizePath(`${file.parent!.path}/${name}.md`);
      }
      const copy = await this.app.vault.create(dest, content);
      new Notice(t("shared.duplicated", { name }));
      this.viewingFile = copy;
      void this.render();
    });
    this.iconBtn(bar, "trash", t("shared.trash"), async () => {
      await this.app.fileManager.trashFile(file);
      new Notice(t("shared.trashed", { name: this.plugin.titleFor(file) }));
      this.viewingFile = null;
      void this.render();
    });

    const row = wrapper.createDiv({ cls: "feuillets-fileview-row" });
    row.createSpan({ cls: "feuillets-notes-label" }).setText(t("shared.label.field"));
    this.makeLabelSelect(row, file);
    this.makeTagsEditorPlain(wrapper, file);

    const body = wrapper.createDiv({ cls: "feuillets-fileview-body" });
    await this.makeBodyEditor(body, file);

    body.addEventListener("mouseup", (e) => {
      /* window.getSelection() ne voit jamais l'intérieur d'un <textarea>
         (sélection native du champ, hors de l'API Selection du navigateur)
         — sans ce cas séparé, sélectionner un extrait pendant l'édition
         de la fiche (plutôt qu'en lecture) ne capturait jamais rien. */
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) {
        this.selectedText = target.value.substring(target.selectionStart, target.selectionEnd);
        return;
      }
      const selection = window.getSelection();
      this.selectedText = selection ? selection.toString() : "";
    });
  }

  renderSection(
    container: HTMLElement,
    title: string,
    folderOrFiles: TFolder | TFile[],
    onCreate?: () => Promise<void>,
    iconKey?: string,
    rowAction?: (header: HTMLElement, file: TFile) => void,
    headerExtra?: (head: HTMLElement) => void,
    external?: boolean
  ): void {
    const collapseKey =
      folderOrFiles instanceof TFolder
        ? folderOrFiles.path
        : `research:${title}`;
    const S = this.plugin.settings;
    const collapsed = !this.researchFilterActive && !!S.collapsed[collapseKey];

    const { section, head } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title,
      icon: getResearchSectionIcon(iconKey || ""),
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
      onCreate: onCreate ? () => { void onCreate(); } : undefined,
    });

    if (headerExtra) headerExtra(head);

    // Ajouter l'attribut data pour identifier le dossier
    if (folderOrFiles instanceof TFolder && typeof head.setAttribute === "function") {
      head.setAttribute("data-research-folder-path", folderOrFiles.path);
      head.setAttribute("data-research-folder-name", folderOrFiles.name);
    }

    /* Chaque rubrique Recherche correspond à un vrai dossier. Le menu rend
       donc accessibles les mêmes opérations d'arborescence que dans le
       Binder, y compris les sous-dossiers utiles à une future association
       entre une partie du Binder et sa documentation.
       `external` (dossier associé depuis le Binder mais hors de la racine
       Recherche du projet — voir renderAssociatedResearchFolders) reste en
       lecture/navigation seule : ni menu d'actions d'écriture, ni cible de
       dépôt — on ne modifie jamais un dossier documentaire externe. */
    if (folderOrFiles instanceof TFolder && !external) {
      const actions = this.iconBtn(head, "more-horizontal", t("shared.research.folderActions"));
      actions.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showResearchFolderContextMenu(e, folderOrFiles);
      });
    }

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });

    /* Glisser-déposer : une rubrique adossée à un vrai dossier (pas la vue
       agrégée "Coffre") devient une cible de dépôt — on y déplace le fichier
       glissé depuis une autre rubrique. Jamais pour un dossier externe. */
    const destFolder = folderOrFiles instanceof TFolder ? folderOrFiles : null;
    if (destFolder && !external) this.attachResearchDropTarget(section, destFolder);

    if (folderOrFiles instanceof TFolder) {
      /* Afficher les sous-dossiers avant les fichiers (ordre
         alphabétique conservé à chaque niveau). */
      const subfolders = folderOrFiles.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      for (const sf of subfolders) {
        this.renderResearchSubfolder(list, sf, external);
      }
    }

    let files: TFile[] = [];
    if (folderOrFiles instanceof TFolder) {
      files = folderOrFiles.children
        .filter((c): c is TFile => isResearchFile(c))
        .sort((a, b) =>
          this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), "fr")
        );
    } else if (Array.isArray(folderOrFiles)) {
      files = folderOrFiles;
    }

    /* N'afficher "vide" que s'il n'y a ni fichier ni sous-dossier. */
    if (files.length === 0) {
      const hasSubfolders =
        folderOrFiles instanceof TFolder &&
        folderOrFiles.children.some((c): c is TFolder => c instanceof TFolder);
      if (!hasSubfolders) {
        list.createDiv({ cls: "feuillets-research-empty" }).setText(t("shared.research.empty"));
      }
      return;
    }

    for (const f of files) {
      this.renderResearchFileRow(list, f, folderOrFiles, rowAction, external);
    }
  }

  /** Affiche une ligne de fichier dans une rubrique de recherche.
   * `external` : fichier d'un dossier associé hors racine Recherche — pas
   * de source de glisser-déposer, pour ne jamais déplacer un fichier hors
   * de son dossier documentaire d'origine. */
  private renderResearchFileRow(
    list: HTMLElement,
    f: TFile,
    folderOrFiles: TFolder | TFile[],
    rowAction?: (header: HTMLElement, file: TFile) => void,
    external?: boolean
  ): void {
    const isMedia = isImageFile(f) || isPdfFile(f);
    const row = list.createDiv({ cls: "feuillets-research-item" });
    if (!external) this.attachResearchDragSource(row, f);
    const header = row.createDiv({ cls: "feuillets-research-item-header" });

    if (isImageFile(f)) {
      const iconSpan = header.createSpan({ cls: "feuillets-research-item-icon" });
      setIcon(iconSpan, "image");
    } else if (isPdfFile(f)) {
      const iconSpan = header.createSpan({ cls: "feuillets-research-item-icon" });
      setIcon(iconSpan, "file-text");
    }

    const nameEl = header.createDiv({ cls: "feuillets-research-item-name" });
    nameEl.setText(this.plugin.titleFor(f));

    this.addPreviewBtn(header, f);

    /* Menu contextuel ⋯ sur chaque fichier : Renommer, Dupliquer, Corbeille.
       Pour un fichier d'un dossier associé externe (lecture seule), le
       bouton reste affiché mais le menu se limite à la navigation (Ouvrir
       dans un nouvel onglet / côte à côte) — voir showResearchFileContextMenu
       navigationOnly. */
    if (!isMedia) {
      const fileActionsBtn = this.iconBtn(header, "more-horizontal", t("shared.research.folderActions"));
      fileActionsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showResearchFileContextMenu(e, f, external);
      });
    }

    if (isMedia) {
      const insertLinkBtn = this.iconBtn(
        header,
        "link",
        isImageFile(f)
          ? t("shared.research.insertImageTooltip")
          : t("shared.research.insertPdfLinkTooltip")
      );
      insertLinkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fname = f.name;
        const link = isImageFile(f) ? `![[${fname}]]` : `[[${fname}]]`;
        this.plugin.insertIntoActiveEditor(link);
        new Notice(t("shared.research.linkInserted", { name: fname }));
      });

      const openFileBtn = this.iconBtn(
        header,
        "external-link",
        t("shared.research.openFile")
      );
      openFileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
      });
    } else if (Array.isArray(folderOrFiles)) {
      const openFileBtn = this.iconBtn(
        header,
        "external-link",
        t("shared.openNewTab")
      );
      openFileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
      });
    } else {
      const appearBtn = this.iconBtn(
        header,
        "list",
        t("shared.research.appearancesTooltip")
      );
      appearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new AppearancesModal(this.app, this.plugin, f).open();
      });
      if (rowAction) rowAction(header, f);
    }

    row.addClass("internal-link");
    row.setAttr("data-href", f.path);
    row.setAttr("data-path", f.path);
    row.setAttr("data-search", foldAccents(this.plugin.titleFor(f)));
    row.setAttr("data-tags", this.plugin.tagsOf(f).map(foldAccents).join(","));

    row.addEventListener("click", (e) => {
      if (isMedia || Keymap.isModEvent(e)) {
        openFileActivating(this.app, this.app.workspace.getLeaf(Keymap.isModEvent(e) ? true : "tab"), f);
        return;
      }
      this.viewingFile = f;
      void this.render();
    });
  }

  /** Affiche récursivement un sous-dossier de recherche avec son chevron,
   *  son icône, son menu d'actions et son contenu (sous-dossiers d'abord,
   *  puis fichiers). La ligne entière est cliquable pour replier/déplier le
   *  contenu ; l'état est persisté dans S.collapsed sous la clé
   *  `research-folder:${folder.path}` (même mécanique que les rubriques).
   *  `external` (hérité du dossier racine associé, voir renderSection) :
   *  ni menu d'actions, ni glisser-déposer, à quelque profondeur que ce
   *  soit — un sous-dossier d'un dossier externe reste, lui aussi,
   *  strictement en lecture. */
  private renderResearchSubfolder(
    parentList: HTMLElement,
    folder: TFolder,
    external?: boolean
  ): void {
    const S = this.plugin.settings;
    const collapseKey = `research-folder:${folder.path}`;
    const collapsed = !this.researchFilterActive && !!S.collapsed[collapseKey];

    const subItem = parentList.createDiv({
      cls: "feuillets-research-item feuillets-research-subfolder",
    });
    const header = subItem.createDiv({
      cls: "feuillets-research-item-header",
    });

    /* Chevron d'état + icône dossier + nom : toute la ligne bascule
       l'état replié/déplié du contenu. */
    const chevron = header.createSpan({
      cls: "feuillets-research-subfolder-chevron",
    });
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

    const folderIcon = header.createSpan({
      cls: "feuillets-research-item-icon",
    });
    setIcon(folderIcon, "folder");

    const nameEl = header.createDiv({ cls: "feuillets-research-item-name" });
    nameEl.setText(folder.name);

    header.addEventListener("click", () => {
      void (async () => {
        if (collapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });

    /* Le sous-dossier est à la fois source et cible de drag & drop : on
       réutilise exactement les mêmes fonctions que les fichiers, ce qui
       permet de le déplacer vers une rubrique principale, vers un autre
       sous-dossier, ou vers son dossier parent (les cas interdits — dans
       lui-même, dans un descendant, conflit de nom, sortie de _Recherche —
       sont refusés par attachResearchDropTarget). Jamais pour un dossier
       externe : ni source (le sortir déplacerait le dossier documentaire
       de l'autrice), ni cible. */
    if (!external) {
      this.attachResearchDragSource(subItem, folder);
      this.attachResearchDropTarget(subItem, folder);
    }

    /* Menu d'actions (⋮) identique à celui des dossiers racines — absent
       pour un dossier externe (lecture seule). */
    if (!external) {
      const actions = this.iconBtn(
        header,
        "more-horizontal",
        t("shared.research.folderActions")
      );
      actions.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showResearchFolderContextMenu(e, folder);
      });
    }

    if (collapsed) return;

    const nestedList = subItem.createDiv({
      cls: "feuillets-research-list feuillets-research-nested",
    });

    /* Rendu récursif : sous-dossiers d'abord, puis fichiers. */
    const subfolders = folder.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    for (const sf of subfolders) {
      this.renderResearchSubfolder(nestedList, sf, external);
    }

    const files = folder.children
      .filter((c): c is TFile => isResearchFile(c))
      .sort((a, b) =>
        this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), "fr")
      );
    for (const f of files) {
      this.renderResearchFileRow(nestedList, f, folder, undefined, external);
    }

    if (subfolders.length === 0 && files.length === 0) {
      nestedList
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("shared.research.empty"));
    }
  }

  /** Copie récursivement un dossier de Recherche. `readBinary`/`createBinary`
   * préservent aussi les images et PDF déposés dans les sous-dossiers. */
  private async copyResearchFolderContents(source: TFolder, destination: string): Promise<void> {
    await this.app.vault.createFolder(destination);
    for (const child of source.children) {
      const target = normalizePath(`${destination}/${child.name}`);
      if (child instanceof TFolder) {
        await this.copyResearchFolderContents(child, target);
      } else if (child instanceof TFile) {
        const data = await this.app.vault.readBinary(child);
        await this.app.vault.createBinary(target, data);
      }
    }
  }

  private async pasteResearchFolder(destination: TFolder): Promise<void> {
    const sourcePath = this.researchFolderClipboardPath;
    const source = sourcePath && this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFolder)) {
      this.researchFolderClipboardPath = undefined;
      new Notice(t("shared.research.nothingToPaste"));
      return;
    }
    if (destination.path === source.path || destination.path.startsWith(`${source.path}/`)) {
      new Notice(t("shared.research.cannotPasteIntoItself"));
      return;
    }

    const copySuffix = t("binder.research.copySuffix");
    let name = source.name;
    let target = normalizePath(`${destination.path}/${name}`);
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      name = `${source.name} (${copySuffix} ${index++})`;
      target = normalizePath(`${destination.path}/${name}`);
    }
    await this.copyResearchFolderContents(source, target);
    this.plugin.renderAllViews(true);
    new Notice(t("shared.research.folderPasted", { name }));
  }

  private showResearchFolderContextMenu(e: MouseEvent, folder: TFolder): void {
    const menu = new Menu();
    this.addFolderCarnetMenuItem(menu, folder);
    const carnetPlugin = this.plugin as unknown as { canUseFolderCarnet?: (folder: TFolder) => boolean };
    if (carnetPlugin.canUseFolderCarnet?.(folder)) menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("binder.newSubfolder"))
        .setIcon("folder-plus")
        .onClick(() => this.plugin.newFolder(folder))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.research.copyFolder"))
        .setIcon("copy")
        .onClick(() => {
          this.researchFolderClipboardPath = folder.path;
          new Notice(t("shared.research.folderCopied", { name: folder.name }));
        })
    );
    menu.addItem((item) => {
      item.setTitle(t("shared.research.pasteFolder")).setIcon("clipboard-paste");
      if (!this.researchFolderClipboardPath) item.setDisabled(true);
      else item.onClick(() => void this.pasteResearchFolder(folder));
    });
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.trashFolder"))
        .setIcon("trash")
        .onClick(async () => {
          await this.app.fileManager.trashFile(folder);
          this.plugin.renderAllViews(true);
          new Notice(t("shared.contextMenu.folderTrashed", { name: folder.name }));
        })
    );
    menu.showAtMouseEvent(e);
  }

  /** Bouton "œil" : déclenche l'aperçu natif d'Obsidian (Aperçu de page) au
   * CLIC plutôt qu'au survol — le survol automatique gênait (aperçu qui
   * s'ouvre en passant simplement la souris sur la liste). Encore utilisé
   * par le panneau Notes (notes-view.ts) et par les fiches de Recherche —
   * plus par le Binder. */
  addPreviewBtn(header: HTMLElement, f: TFile): HTMLElement {
    const btn = this.iconBtn(header, "eye", t("shared.previewTooltip"));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: "feuillets",
        hoverParent: this,
        targetEl: btn,
        linktext: f.path,
        sourcePath: f.path,
      });
    });
    return btn;
  }

  /** Rend une fiche — ou un sous-dossier — de recherche déplaçable : au
   * dragstart, on mémorise son chemin sur le plugin (état partagé entre les
   * rubriques, comme dragState pour le binder). Le vrai déplacement est
   * fait par la cible de dépôt. */
  attachResearchDragSource(row: HTMLElement, file: TAbstractFile): void {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      this.plugin._researchDragPath = file.path;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", file.path);
      /* Correctif « drag Binder/Recherche → vrai FileNode » : UNIQUEMENT
         pour un fichier (jamais un sous-dossier, §4) — un Carnet ouvert qui
         reçoit ce MIME privé y crée un vrai FileNode Canvas (voir main.ts,
         handleCarnetFileDrop), jamais un TextNode `[[lien]]`. Le
         déplacement interne Recherche existant (`_researchDragPath`,
         attachResearchDropTarget) reste totalement inchangé. */
      if (file instanceof TFile) e.dataTransfer!.setData(FEUILLETS_FILE_DRAG_MIME, file.path);
      row.addClass("feuillets-dragging");
      e.stopPropagation();
    });
    row.addEventListener("dragend", () => {
      this.plugin._researchDragPath = null;
      this.contentEl
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
        });
    });
  }

  /** Fait d'une rubrique ou d'un sous-dossier (section adossée à un vrai
   * dossier) une cible de dépôt : lâcher une fiche OU un sous-dossier l'y
   * déplace via fileManager.renameFile (met à jour les liens du coffre).
   * Ignore le dépôt dans le dossier d'origine, refuse une collision de nom
   * plutôt que d'écraser, refuse de ranger un dossier dans lui-même ou dans
   * l'un de ses descendants, et ne laisse jamais rien sortir de _Recherche. */
  attachResearchDropTarget(section: HTMLElement, destFolder: TFolder): void {
    section.addEventListener("dragover", (e) => {
      if (!this.plugin._researchDragPath) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      section.addClass("feuillets-dragover");
    });
    section.addEventListener("dragleave", (e) => {
      if (!(e.relatedTarget instanceof Node) || !section.contains(e.relatedTarget)) section.removeClass("feuillets-dragover");
    });
    section.addEventListener("drop", (e) => {
      e.preventDefault();
      /* Un sous-dossier est lui-même une cible de dépôt DANS une rubrique
         qui en est aussi une : sans stopPropagation, le même drop serait
         traité deux fois (vers le sous-dossier puis vers la rubrique). */
      e.stopPropagation();
      section.removeClass("feuillets-dragover");
      const srcPath = this.plugin._researchDragPath;
      this.plugin._researchDragPath = null;
      if (!srcPath) return;
      const source = this.app.vault.getAbstractFileByPath(srcPath);
      if (!source) return;

      /* Refus : un dossier déposé dans lui-même ou dans un de ses
         descendants (boucle impossible à construire). */
      if (
        source instanceof TFolder &&
        (destFolder.path === source.path || destFolder.path.startsWith(`${source.path}/`))
      ) {
        new Notice(t("shared.research.cannotPasteIntoItself"));
        return;
      }

      /* Refus (défensif) : sortir de l'espace _Recherche du projet actif.
         Toutes les cibles rendues sont déjà sous _Recherche, mais on ne
         déplace jamais un dossier de recherche hors de cet espace. */
      const researchRoot = this.plugin.getResearchRoot();
      const projectRoot = this.plugin.getProjectFolder();
      const baseResearch = researchRoot instanceof TFolder
        ? researchRoot.path
        : projectRoot
          ? `${projectRoot.path}/_Recherche`
          : "_Recherche";
      if (destFolder.path !== baseResearch && !destFolder.path.startsWith(`${baseResearch}/`)) {
        new Notice(t("shared.research.cannotPasteIntoItself"));
        return;
      }

      /* Déposer dans le dossier parent direct : rien à déplacer. */
      if (source.parent && source.parent.path === destFolder.path) return;

      const dest = normalizePath(`${destFolder.path}/${source.name}`);
      if (this.app.vault.getAbstractFileByPath(dest)) {
        new Notice(t("shared.research.duplicateNameInSection"));
        return;
      }
      void (async () => {
        await this.app.fileManager.renameFile(source, dest);
        this.plugin.renderAllViews(true);
      })();
    });
  }

  /** Toutes les notes de bas de page ("[^N]: texte") du manuscrit, scène
   * par scène mais regroupées en un seul endroit — pas fichier par
   * fichier comme dans le panneau Notes. Signale aussi les références
   * orphelines : un "[^N]" cité dans le texte sans définition
   * correspondante, ou l'inverse (définie mais jamais citée) — souvent le
   * signe d'un texte coupé/collé entre scènes qui a cassé une note. */
  async renderFootnotesOverviewSection(container: HTMLElement, root: TFolder): Promise<void> {
    const S = this.plugin.settings;
    const collapseKey = "research:footnotes-overview";
    const collapsed = !!S.collapsed[collapseKey];

    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title: t("shared.footnotes.title"),
      icon: "list",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });
    const numbering = this.plugin.buildNumbering(root);
    const files = this.plugin
      .flattenFiles(root)
      .sort((a, b) => (Number(numbering.get(a.path)) || 0) - (Number(numbering.get(b.path)) || 0));

    const defRe = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
    const refRe = /\[\^([^\]]+)\](?!:)/g;
    let anyContent = false;

    for (const file of files) {
      const raw = await this.app.vault.cachedRead(file);
      const text = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

      const defs = new Map<string, string>();
      defRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = defRe.exec(text))) defs.set(m[1], m[2].trim());

      const refs = new Set<string>();
      refRe.lastIndex = 0;
      while ((m = refRe.exec(text))) refs.add(m[1]);

      if (defs.size === 0 && refs.size === 0) continue;
      anyContent = true;

      const group = list.createDiv({ cls: "feuillets-footnotes-overview-group" });
      const head = group.createDiv({ cls: "feuillets-footnotes-overview-head" });
      head.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      head.setAttr("title", t("shared.footnotes.openSceneTooltip"));
      head.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      for (const [label, footnoteText] of defs) {
        const row = group.createDiv({ cls: "feuillets-footnotes-overview-row" });
        row.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${label}]`);
        row.createSpan({ cls: "feuillets-footnotes-overview-text" }).setText(footnoteText);
        if (!refs.has(label)) {
          row.addClass("feuillets-footnotes-overview-orphan");
          row.setAttr("title", t("shared.footnotes.definedNeverCited"));
        }
      }
      for (const label of refs) {
        if (defs.has(label)) continue;
        const row = group.createDiv({
          cls: "feuillets-footnotes-overview-row feuillets-footnotes-overview-orphan",
        });
        row.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${label}]`);
        row
          .createSpan({ cls: "feuillets-footnotes-overview-text" })
          .setText(t("shared.footnotes.citedNeverDefined"));
        row.setAttr("title", t("shared.footnotes.citedNeverDefinedTooltip"));
      }
    }

    if (!anyContent) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("shared.footnotes.empty"));
    }
  }

  /** "Bibliographie" comme AGRÉGATEUR, pas comme dossier de fiches
   * manuelles : la liste des Sources/Bibliographie effectivement citées
   * au moins une fois (cite_count > 0, incrémenté par
   * plugin.insertCitationFor), triées par auteur — distinct de "toutes
   * les fiches" (une source peut exister dans la bibliothèque de travail
   * sans jamais être mobilisée dans le texte). Le bouton "Générer"
   * écrit le fichier bibliographie final (plugin.generateBibliographyFile),
   * prêt à être collé dans le manuscrit compilé ou fourni à part. */
  async renderBibliographySection(container: HTMLElement, root: TFolder, candidateFolders: TFolder[]): Promise<void> {
    const S = this.plugin.settings;
    const collapseKey = "research:cited-sources";
    const collapsed = !!S.collapsed[collapseKey];

    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title: t("shared.bibliography.title"),
      icon: "library",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    if (collapsed) return;
    const sectionEl = section;

    const files = candidateFolders.flatMap((f) =>
      f.children.filter((c): c is TFile => c instanceof TFile && c.extension === "md")
    );
    const cited = files.filter((f) => (this.plugin.fmOf(f).cite_count || 0) > 0);

    const exportRow = sectionEl.createDiv({ cls: "feuillets-bibliography-export-row" });
    exportRow.setAttr("title", t("shared.bibliography.exportTooltip"));
    const exportIcon = exportRow.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(exportIcon, "file-output");
    exportRow.createSpan().setText(t("shared.bibliography.generate"));
    exportRow.addEventListener("click", () => { void this.plugin.generateBibliographyFile(); });

    const list = sectionEl.createDiv({ cls: "feuillets-research-list" });
    if (cited.length === 0) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("shared.bibliography.empty"));
      return;
    }

    const sorted = [...cited].sort((a, b) => {
      const authorA = this.plugin.fmOf(a).author;
      const authorB = this.plugin.fmOf(b).author;
      return (typeof authorA === "string" ? authorA : "").localeCompare(typeof authorB === "string" ? authorB : "", "fr");
    });
    for (const f of sorted) {
      const fm = this.plugin.fmOf(f);
      const row = list.createDiv({ cls: "feuillets-research-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = Number(fm.cite_count) || 0;
      header
        .createDiv({ cls: "feuillets-research-item-name" })
        .setText(t("shared.bibliography.citationCount", { title: this.plugin.titleFor(f), count: String(n), s: n > 1 ? "s" : "" }));
      row.addEventListener("click", () => {
        this.viewingFile = f;
        void this.render();
      });
    }
  }

  /** "Dossiers de recherche sauvegardés" — un filtre Recherche (texte +
   * tag) enregistré sous un nom, réappliqué en un clic. Ne crée pas de
   * vrai dossier sur le disque : juste une combinaison de critères
   * mémorisée par projet (S.projectMeta[root.path].savedResearchFilters),
   * rejouée sur les mêmes fiches à chaque clic — donc toujours à jour,
   * contrairement à un dossier figé qu'il faudrait retrier à la main. */
  renderSavedFiltersButton(toolbar: HTMLElement, root: TFolder | null): void {
    if (!root) return;
    const S = this.plugin.settings;
    if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
    const meta = S.projectMeta[root.path];
    const filters = (meta.savedResearchFilters as { name: string; search: string; tag: string }[] | undefined) || [];

    const btn = this.iconBtn(toolbar, "bookmark", t("shared.savedFilters.tooltip"));
    btn.addEventListener("click", (e) => {
      const menu = new Menu();
      const hasActiveFilter = !!(S.researchSearch || "").trim() || !!S.researchTagFilter;
      menu.addItem((item) =>
        item
          .setTitle(t("shared.savedFilters.save"))
          .setIcon("bookmark-plus")
          .setDisabled(!hasActiveFilter)
          .onClick(() => {
            new SaveResearchFilterModal(this.app, async (name) => {
              if (!meta.savedResearchFilters) meta.savedResearchFilters = [];
              (meta.savedResearchFilters as { name: string; search: string; tag: string }[]).push({
                name,
                search: S.researchSearch || "",
                tag: S.researchTagFilter || "",
              });
              await this.plugin.saveSettings();
              void this.render(true);
            }).open();
          })
      );
      if (filters.length > 0) {
        menu.addSeparator();
        for (const f of filters) {
          menu.addItem((item) =>
            item.setTitle(f.name).setIcon("bookmark").onClick(async () => {
              S.researchSearch = f.search || "";
              S.researchTagFilter = f.tag || "";
              await this.plugin.saveSettings();
              void this.render(true);
            })
          );
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle(t("shared.savedFilters.manage"))
            .setIcon("settings")
            .onClick(() => {
              new ManageSavedFiltersModal(this.app, this.plugin, root, () => this.render(true)).open();
            })
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  filterEntities(): void {
    /* this.contentEl est la feuille ENTIÈRE quand cette vue est une sous-vue
       de SidebarFeuilletsView (Inspecteur) — voir renderSavedFiltersButton
       et le correctif équivalent sur le focus de la recherche. Chercher
       depuis this.contentEl pouvait manquer les éléments qu'on vient de
       (re)construire, laissant tout affiché sans filtrage apparent. */
    const scope = this.targetContainer || this.contentEl;
    const term = foldAccents((this.plugin.settings.researchSearch || "").trim());
    const tagFilter = foldAccents(this.plugin.settings.researchTagFilter || "");
    const items = scope.querySelectorAll(".feuillets-research-item");
    items.forEach((el) => {
      const dataSearch = el.getAttr("data-search") || "";
      const dataTags = el.getAttr("data-tags") || "";
      const matchSearch = !term || dataSearch.includes(term) || dataTags.includes(term);
      const tags = dataTags.split(",").filter(Boolean);
      const matchTag = !tagFilter || tags.includes(tagFilter);
      (el as HTMLElement).style.display = matchSearch && matchTag ? "" : "none";
    });
    const sections = scope.querySelectorAll(
      ".feuillets-research-section"
    );
    const filterActive = !!term || !!tagFilter;
    sections.forEach((sec) => {
      const visible = sec.querySelectorAll(
        '.feuillets-research-item:not([style*="display: none"])'
      );
      const empty = sec.querySelector(".feuillets-research-empty");
      if (filterActive && empty) (empty as HTMLElement).hide();
      (sec as HTMLElement).style.display =
        filterActive && visible.length === 0 && !empty ? "none" : "";
    });
  }

  async buildSearchIndex(files: TFile[]): Promise<Map<string, { mtime: number; text: string }>> {
    if (!this._searchCache) this._searchCache = new Map();
    return refreshSearchIndex(this._searchCache, files, async (f) => {
      if (!(f instanceof TFile)) return "";
      const raw = await this.app.vault.cachedRead(f);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
      return foldAccents(body);
    });
  }

  iconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick?: (e: MouseEvent) => void | Promise<void>): HTMLElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, tooltip);
    if (onClick) btn.addEventListener("click", (e) => { void onClick(e); });
    return btn;
  }

  barSep(parent: HTMLElement): HTMLElement {
    return parent.createDiv({ cls: "feuillets-bar-sep" });
  }

  /** En-tête de section repliable (icône + titre, cliquable pour
   * replier/déplier) — même patron visuel et mécanique que les sections
   * du panneau Notes (renderCollapsibleTextarea, notes-view.js) : icône +
   * titre en petites majuscules, pas de chevron, état persisté dans
   * S.collapsed (comme partout ailleurs dans le plugin) sous la clé
   * `namespace:key`. `renderActions`, si fourni, reçoit un conteneur
   * d'icônes de barre d'outils placé à part, hors de la zone cliquable
   * qui replie la section (pas besoin de stopPropagation). Retourne true
   * si la section est actuellement repliée — l'appelant ne construit
   * alors pas son corps. */
  renderSectionHead(
    section: HTMLElement,
    icon: string,
    title: string,
    namespace: string,
    key: string,
    renderActions?: (actions: HTMLElement) => void
  ): boolean {
    const S = this.plugin.settings;
    const collapseKey = `${namespace}:${key}`;
    const isCollapsed = !!S.collapsed[collapseKey];

    const head = section.createDiv({ cls: "feuillets-section-head" });
    const titleEl = head.createDiv({ cls: "feuillets-section-title" });
    const iconEl = titleEl.createSpan({ cls: "feuillets-section-icon" });
    setIcon(iconEl, icon);
    titleEl.createSpan({ cls: "feuillets-section-title-text" }).setText(title);
    titleEl.addEventListener("click", () => {
      void (async () => {
        if (isCollapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    });
    if (renderActions) {
      const actions = head.createDiv({ cls: "feuillets-project-actions" });
      renderActions(actions);
    }
    return isCollapsed;
  }

  /** Actions Binder ↔ Recherche partagées entre le menu d'un DOSSIER et
   * celui d'un FICHIER Markdown du Binder. Clé de la map
   * researchFolderLinks : `keyNode` lui-même — dossier du Binder ou
   * fichier du Binder directement. `displayName` est le nom affiché dans
   * la modale (titre ou basename du fichier, nom du dossier). La création
   * suit la règle du parent associé : pour un fichier, c'est `keyNode.parent`
   * qui sert à trouver le dossier Recherche du parent lié s'il existe,
   * sinon _Recherche. */
  private addBinderResearchActions(
    menu: Menu,
    keyNode: TFile | TFolder,
    displayName: string
  ): void {
    const plugin = this.plugin;

    const linkedResearch = plugin.getLinkedResearchFolder(keyNode);
    if (linkedResearch) {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.openLinkedFolder"))
          .setIcon("search")
          .onClick(() => {
            void this.openResearchFolderInTab(linkedResearch);
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.changeLinkedFolder"))
          .setIcon("pencil")
          .onClick(() => new LinkResearchFolderModal(this.app, plugin, keyNode, displayName).open())
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.detachLinkedFolder"))
          .setIcon("unlink")
          .onClick(async () => {
            await plugin.removeLinkedResearchFolder(keyNode);
            plugin.renderAllViews(true);
            new Notice(t("binder.research.folderDetached"));
          })
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.createLinkedFolder"))
          .setIcon("folder-plus")
          .onClick(() => {
            /* Règle du parent associé : la création d'un dossier Recherche
               lié se fait DANS le dossier Recherche associé du parent Binder
               (clé `keyNode` elle-même pour un dossier, son parent pour un
               fichier) s'il en a un — la documentation suit ainsi la
               structure du manuscrit. Sinon, repli sur _Recherche du projet
               actif. */
            const parentFolder = keyNode.parent instanceof TFolder ? keyNode.parent : null;
            const parentLinked = parentFolder ? plugin.getLinkedResearchFolder(parentFolder) : null;
            const root = plugin.getProjectFolder();
            let basePath: string | null = null;
            if (parentLinked) basePath = parentLinked.path;
            else if (root) {
              const researchRoot = plugin.getResearchRoot();
              basePath = researchRoot ? researchRoot.path : `${root.path}/_Recherche`;
            }
            if (!basePath) {
              new Notice(t("binder.research.noResearchRoot"));
              return;
            }
            new NewFolderModal(this.app, displayName, async (name) => {
              const target = normalizePath(`${basePath}/${name}`);
              const existing = this.app.vault.getAbstractFileByPath(target);
              if (existing) {
                new Notice(t("binder.research.linkAlreadyExists", { name }));
                return;
              }
              const created = await this.app.vault.createFolder(target);
              const createdFolder = this.app.vault.getAbstractFileByPath(target);
              if (!(createdFolder instanceof TFolder)) return;
              await plugin.setLinkedResearchFolder(keyNode, createdFolder);
              plugin.renderAllViews(true);
              new Notice(t("binder.research.linkedFolderCreated", { name: created.name }));
            }).open();
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.linkExistingFolder"))
          .setIcon("link")
          .onClick(() => new LinkResearchFolderModal(this.app, plugin, keyNode, displayName).open())
      );
    }
  }

  private async openResearchFolderInTab(folder: TFolder): Promise<void> {
    /* Ouvrir la vue Recherche de la sidebar Feuillets (pas une nouvelle
       feuille centrale) et révéler le dossier lié. */
    const { VIEW_SIDEBAR_FEUILLETS } = await import("../constants.js");
    const app = this.app;

    // Chercher la sidebar Feuillets existante
    const sidebarLeaves = app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS);
    let sidebarLeaf = sidebarLeaves.length > 0 ? sidebarLeaves[0] : null;

    // Si pas de sidebar, l'ouvrir à droite
    if (!sidebarLeaf) {
      const rightLeaf = (app.workspace as unknown as { getRightLeaf?: (create: boolean) => unknown }).getRightLeaf?.(true);
      sidebarLeaf = rightLeaf as WorkspaceLeaf | null;
      if (sidebarLeaf && typeof (sidebarLeaf as unknown as { setViewState?: (state: unknown) => Promise<void> }).setViewState === "function") {
        await (sidebarLeaf as unknown as { setViewState: (state: unknown) => Promise<void> }).setViewState({ type: VIEW_SIDEBAR_FEUILLETS, state: {} });
      }
    }

    if (!sidebarLeaf) {
      new Notice(t("binder.research.folderNoLongerExists"));
      return;
    }

    // Activer la leaf de la sidebar
    await app.workspace.revealLeaf(sidebarLeaf);

    // Obtenir la view sidebar et basculer vers l'onglet Recherche
    const sidebarView = sidebarLeaf.view as unknown as {
      activeTab?: string;
      subViews?: Record<string, { revealLinkedResearchFolder?: (folder: TFolder) => Promise<void> }>;
      render?: (force?: boolean) => Promise<void>;
    } | null;

    if (sidebarView) {
      // Basculer vers l'onglet Recherche
      if (sidebarView.activeTab !== "research") {
        sidebarView.activeTab = "research";
        if (typeof sidebarView.render === "function") {
          await sidebarView.render(true);
        }
      }

      // Révéler le dossier lié dans la vue Recherche de la sidebar
      const researchSubView = sidebarView.subViews?.["research"];
      if (researchSubView && typeof researchSubView.revealLinkedResearchFolder === "function") {
        await researchSubView.revealLinkedResearchFolder(folder);
      }
    }
  }

  async revealLinkedResearchFolder(folder: TFolder): Promise<void> {
    /* Méthode publique pour révéler et surligner un dossier Recherche lié.
       Utilisée par openResearchFolderInTab et depuis les views sidebar. */
    // Vérifier que le dossier existe toujours
    const stillExists = this.app.vault.getAbstractFileByPath(folder.path);
    if (!(stillExists instanceof TFolder)) {
      new Notice(t("binder.research.folderNoLongerExists"));
      return;
    }

    // Forcer le rendu de la view pour s'assurer que le DOM est à jour
    if (typeof (this as unknown as { render?: (force?: boolean) => Promise<void> }).render === "function") {
      await (this as unknown as { render?: (force?: boolean) => Promise<void> }).render?.(true);
    }

    // Surligner le dossier après un court délai
    window.setTimeout(() => {
      this.highlightResearchFolderInTab(folder);
    }, 100);
  }

  private highlightResearchFolderInTab(folder: TFolder): void {
    /* Chercher le dossier dans le DOM de la view Recherche et ajouter
       un surlignage temporaire. Utilise le targetContainer (sidebar) ou
       contentEl (centrale) selon la context. */
    // Utiliser le conteneur de cette vue si disponible
    const container = (this as unknown as { targetContainer?: HTMLElement; contentEl?: HTMLElement }).targetContainer ||
                      (this as unknown as { contentEl?: HTMLElement }).contentEl;
    if (!container) return;

    // Chercher le dossier par son chemin ou son nom
    const folderElements = container.querySelectorAll<HTMLElement>(
      `[data-research-folder-path="${folder.path}"],
       [data-research-folder-name="${folder.name}"]`
    );

    if (folderElements.length === 0) {
      // Le dossier n'est pas visible (probablement un parent replié)
      // On pourrait ici déplier les parents, mais pour l'instant on quitte silencieusement
      return;
    }

    // Surligner le premier élément trouvé
    const element = folderElements[0];
    element.classList.add("feuillets-highlight-research-folder");

    // Faire défiler jusqu'à l'élément
    element.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Retirer le surlignage après 2 secondes
    window.setTimeout(() => {
      element.classList.remove("feuillets-highlight-research-folder");
    }, 2000);
  }

  /**
   * Micro-correctif « Nouvel onglet parasite » — si un Continu CENTRAL
   * existe déjà pour le PROJET de `scope` (même `projectRoot`), retrouve sa
   * VRAIE leaf par identité (`leaf.view === centralContinu`) parmi
   * `getLeavesOfType(VIEW_SCRIVENINGS)`. Retourne `null` si aucun Continu
   * central pertinent n'existe — l'appelant doit alors se rabattre sur
   * `plugin.getLeafForOpeningFile()` (chemin historique, §ci-dessous).
   * N'appelle JAMAIS `getLeafForOpeningFile()` elle-même : c'est précisément
   * cet appel, fait à tort quand Continu vivait déjà ailleurs, qui créait
   * une leaf Markdown/vide neuve avant que le Continu réel soit réutilisé —
   * laissant cette leaf neuve orpheline sous forme de « Nouvel onglet ».
   */
  private centralContinuWorkLeaf(scope: CompileScope): { leaf: WorkspaceLeaf; continu: ContinuWorkView } | null {
    const centralContinu = this.plugin.getCentralContinuView?.();
    if (!centralContinu || !centralContinu.compileScope) return null;
    if (centralContinu.compileScope.projectRoot !== scope.projectRoot) return null;
    const leaf = this.app.workspace.getLeavesOfType(VIEW_SCRIVENINGS).find((l) => l.view === centralContinu);
    if (!leaf) return null;
    return { leaf, continu: centralContinu };
  }

  /**
   * Micro-correctif « ouvrir avec aperçu » — coordinateur UNIQUE entre
   * Continu et Preview pour une portée CompileScope donnée : s'assure que
   * la leaf de travail affiche Continu sur `scope`, puis ouvre/réutilise
   * Preview À CÔTÉ d'elle avec EXACTEMENT le même scope. Focus final sur
   * Continu.
   *
   * Résolution de la leaf de travail, PAR PRIORITÉ :
   *  1. le Continu CENTRAL déjà ouvert pour ce projet (`centralContinuWorkLeaf`)
   *     — sa propre leaf, retrouvée par identité, JAMAIS
   *     `plugin.getLeafForOpeningFile()` dans ce cas (micro-correctif
   *     « Nouvel onglet parasite ») ;
   *  2. à défaut seulement, le chemin historique via
   *     `plugin.getLeafForOpeningFile()` :
   *     - déjà Continu → recompose seulement si le scope diffère (jamais
   *       inutilement) ; si `openScope()` refuse (sécurité anti-perte), on
   *       s'arrête SANS toucher Preview — jamais de divergence entre les
   *       deux vues ;
   *     - Markdown → transformée EN PLACE via `openScopeInContinuOnLeaf`,
   *       le chemin déjà validé de la promotion Markdown → Continu ;
   *     - ni l'un ni l'autre (repli exceptionnel) → `openScopeInContinu`,
   *       qui résout ou crée l'onglet Continu unique du plugin.
   */
  async openScopeWithContinuAndPreview(scope: CompileScope): Promise<void> {
    const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
    if (!files.length) return;

    let workLeaf: WorkspaceLeaf;

    const existingCentral = this.centralContinuWorkLeaf(scope);
    if (existingCentral) {
      const { leaf, continu } = existingCentral;
      if (!continu.compileScope || !compileScopesEqual(continu.compileScope, scope)) {
        const applied = await continu.openScope(scope);
        if (!applied) return;
      }
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      continu.refreshHostTypography?.();
      workLeaf = leaf;
    } else {
      workLeaf = this.plugin.getLeafForOpeningFile();

      const currentView = workLeaf.view;
      if (isContinuWorkView(currentView)) {
        if (!currentView.compileScope || !compileScopesEqual(currentView.compileScope, scope)) {
          const applied = await currentView.openScope(scope);
          if (!applied) return;
        }
        this.app.workspace.setActiveLeaf(workLeaf, { focus: true });
        currentView.refreshHostTypography?.();
      } else if (currentView instanceof MarkdownView) {
        const applied = await openScopeInContinuOnLeaf(this.app, workLeaf, scope);
        if (!applied) return;
      } else {
        const fallbackLeaf = await openScopeInContinu(this.app, scope);
        if (!fallbackLeaf) return;
        workLeaf = fallbackLeaf;
      }
    }

    await openScopeWithPreviewBesideLeaf(this.app, scope, workLeaf);
    this.app.workspace.setActiveLeaf(workLeaf, { focus: true });
  }

  showFileContextMenu(e: MouseEvent, file: TFile, parent: ProjectNode, index: number, _siblings: ProjectNode[]): void {
    const menu = new Menu();
    const plugin = this.plugin;

    const researchName = this.plugin.shortTitleFor?.(file) || this.plugin.titleFor?.(file) || file.basename;

    /* Feuillet cliqué faisant partie d'une sélection multiple (voir
       handleMultiSelectClick) : Statut/Label/Tags s'appliquent alors à
       tout le groupe, pas seulement à celui sur lequel on a cliqué droit.
       Le reste du menu (nouveau feuillet avant/après, snapshot,
       dupliquer…) n'a de sens que pour CE feuillet précis et reste
       inchangé. */
    const groupSel = this.plugin._binderMultiSelect;
    const isGroup = !!(groupSel && groupSel.size > 1 && groupSel.has(file.path));
    const groupFiles = isGroup
      ? [...groupSel].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile)
      : [file];

    /* Lot 7 — « Ajouter la sélection au Carnet » REMPLACE, dans ce cas
       précis, le simple « Ajouter au Carnet » : jamais les deux à la fois,
       jamais un repli silencieux sur le seul fichier cliqué si la
       sélection contient un élément non admissible (dossier, Recherche,
       note de dossier, .md hors manuscrit…) — voir `isSceneFile`, le même
       prédicat métier que la commande palette du Lot 6. Le comportement
       simple à un seul feuillet reste exactement celui d'avant ce Lot. */
    if (isGroup) {
      const selectedPaths = [...groupSel];
      const allAdmissible = selectedPaths.every((p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        return f instanceof TFile && this.plugin.isSceneFile(f);
      });
      if (allAdmissible) {
        // ORDRE = ORDRE DU BINDER : jamais l'ordre du Set de sélection
        // (qui reflète l'ordre des Cmd-clics) — le parcours canonique
        // `flattenFiles` donne l'ordre réel du manuscrit, filtré ensuite
        // sur les chemins sélectionnés.
        const root = this.plugin.getProjectFolder();
        const orderedSelected = root
          ? this.plugin.flattenFiles(root).filter((f) => groupSel.has(f.path))
          : [];
        menu.addItem((item) =>
          item
            .setTitle(t("shared.contextMenu.addSelectionToNotebook"))
            .setIcon("notebook")
            .onClick(() => { void this.plugin.addFilesToNotebook(orderedSelected); })
        );
        menu.addSeparator();
      }
    } else if (file.extension === "md" && file.path.startsWith(`${this.plugin.getProjectFolder()?.path || "\0"}/`)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.addToNotebook"))
          .setIcon("notebook")
          .onClick(() => { void this.plugin.addFileToNotebook(file); })
      );
      menu.addSeparator();
    }

    if (isGroup) {
      menu.addItem((item) => item.setTitle(t("shared.contextMenu.groupSelected", { count: String(groupFiles.length) })).setDisabled(true));
      menu.addSeparator();
    }

    menu.addItem((item) =>
      item
        .setTitle(t("shared.openNewTab"))
        .setIcon("file-plus")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
        })
    );
    /* « Ouvrir avec aperçu » vit ICI et pas seulement dans le hook
       `workspace.on("file-menu")` : le Binder construit son propre Menu et
       ne passe jamais par ce hook — l'entrée y était donc invisible.
       Réservée aux vraies scènes (roleOfFile), pas aux feuillets-chapitres
       ni aux fiches hors manuscrit.
       Priorité de la PORTÉE utilisée par cette seule entrée (micro-correctif
       « ouvrir avec aperçu ») :
        1. le Continu CENTRAL déjà ouvert, si `file` en est membre — sa
           propre portée (folder/project/selection), JAMAIS reconstruite ;
        2. l'ancienne multi-sélection `_binderMultiSelect`, si `file` en fait
           partie ;
        3. le feuillet seul (comportement historique inchangé,
           `addOpenWithPreviewItem`/`openWithPreview`). */
    const centralContinu = this.plugin.getCentralContinuView?.() || null;
    const continuProjectRoot = plugin.getProjectFolder();
    const continuScopeForFile =
      centralContinu &&
      centralContinu.compileScope &&
      continuProjectRoot &&
      centralContinu.compileScope.projectRoot === continuProjectRoot.path &&
      centralContinu.getMemberPaths().includes(file.path)
        ? centralContinu.compileScope
        : null;

    if (continuScopeForFile) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.openWithPreview"))
          .setIcon("eye")
          .onClick(async () => {
            await this.openScopeWithContinuAndPreview(continuScopeForFile);
          })
      );
    } else if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.openWithPreview"))
          .setIcon("eye")
          .onClick(async () => {
            const projectRoot = plugin.getProjectFolder();
            if (!projectRoot) return;
            const scope = createSelectionScope(projectRoot.path, Array.from(groupSel || []));
            await this.openScopeWithContinuAndPreview(scope);
          })
      );
    } else {
      addOpenWithPreviewItem(menu, this.app, plugin, file);
    }
    /* « Ouvrir en continu » n'existe QUE pour une multi-sélection — un
       feuillet unique a déjà son vrai MarkdownView natif (voir
       showFileContextMenu, cas `else` ci-dessus : Continu n'y apporte rien,
       Lot 2A §7). Logique et portée INCHANGÉES par le micro-correctif
       « ouvrir avec aperçu » : `_binderMultiSelect` reste sa seule source. */
    if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.openInContinu"))
          .setIcon("layers")
          .onClick(async () => {
            const projectRoot = plugin.getProjectFolder();
            if (!projectRoot) return;
            const scope = createSelectionScope(projectRoot.path, Array.from(groupSel || []));
            await openScopeInContinu(this.app, scope);
          })
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.openSplit"))
        .setIcon("columns-2")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.compareWith"))
        .setIcon("diff")
        .onClick(() => {
          new PickFileModal(this.app, plugin, file, (other) => {
            new CompareFilesModal(this.app, plugin, file, other).open();
          }).open();
        })
    );
    menu.addSeparator();

    menu.addItem((item) => item.setTitle(t("shared.contextMenu.newSheetMenu")).setIcon("file-plus").onClick((evt) =>
      showChoices(evt, e, (choices) => {
        choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetBefore")).setIcon("corner-left-up").onClick(() => plugin.newSheetAt(asFolder(parent), index)));
        choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetAfter")).setIcon("corner-left-down").onClick(() => plugin.newSheetAt(asFolder(parent), index + 1)));
      })
    ));
    menu.addSeparator();

    const currentStatus = (this.fm(file).status as string) || "";
    const allStatuses = getProjectStatuses(this.app, this.plugin ? this.plugin.settings : null);
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeStatusMenu")).setIcon("circle-dot").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const st of allStatuses.filter(Boolean)) {
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: st }))
          .setChecked(!isGroup && st === currentStatus)
          .onClick(async () => {
            if (isGroup) await this.applyBulkStatus(groupFiles, st);
            else await this.setFm(file, "status", st === currentStatus ? "" : st);
          })
      );
    }
    })));
    menu.addSeparator();

    const currentLabel = plugin.labelOf(file);
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeLabelMenu")).setIcon("tag").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const l of this.getProjectLabels()) {
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.labelLabel", { label: l.name }))
          .setChecked(!isGroup && l.name === currentLabel)
          .onClick(async () => {
            if (isGroup) await this.applyBulkLabel(groupFiles, l.name);
            else await this.setFm(file, "label", l.name === currentLabel ? "" : l.name);
          })
      );
    }
    })));
    menu.addSeparator();

    if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.addTagToGroup"))
          .setIcon("tag")
          .onClick(() => this.promptBulkTag(groupFiles, () => { void this.render(); }))
      );
      menu.addSeparator();
    }

    menu.addItem((item) => item.setTitle(t("binder.research.associatedResearchMenu")).setIcon("search").onClick((evt) =>
      showChoices(evt, e, (choices) => this.addBinderResearchActions(choices, file, researchName))
    ));
    menu.addItem((item) => item.setTitle("Versions…").setIcon("history").onClick((evt) => showChoices(evt, e, (choices) => {
    choices.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.snapshot"))
        .setIcon("camera")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const n = await plugin.snapshotFile(file, root);
          new Notice(t("shared.contextMenu.snapshotCreated", { name: n }));
        })
    );
    choices.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.compareWithSnapshot"))
        .setIcon("history")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const snapshots = listSnapshotFiles(this.app, file, root);
          if (snapshots.length === 0) {
            new Notice(t("shared.contextMenu.noSnapshotFound", { name: file.basename }));
            return;
          }
          await openSnapshotComparison(this.app, plugin, file, snapshots[0]);
        })
    );
    })));
    /* « Déplacer » : comportement unitaire historique (moveSceneFile).
       Le réordonnancement multi-feuillets se fait par glisser-déposer
       dans le Binder (sélectionner plusieurs feuillets, puis drag). */
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.move"))
        .onClick(() => {
          void this.plugin.moveSceneFile(file);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.duplicate"))
        .setIcon("copy")
        .onClick(async () => {
          const content = await this.app.vault.read(file);
          const copySuffix = t("binder.research.copySuffix");
          let name = `${file.basename} (${copySuffix})`;
          let dest = normalizePath(`${(asFolder(parent)).path}/${name}.md`);
          let k = 2;
          while (this.app.vault.getAbstractFileByPath(dest)) {
            name = `${file.basename} (${copySuffix} ${k++})`;
            dest = normalizePath(`${(asFolder(parent)).path}/${name}.md`);
          }
          await this.app.vault.create(dest, content);
          plugin.renderAllViews(true);
          new Notice(t("shared.duplicated", { name }));
        })
    );

    // Compilation libre
    const compilationTitle = isGroup
      ? t("binder.compileSelection")
      : t("binder.compileFile");
    menu.addItem((item) =>
      item
        .setTitle(compilationTitle)
        .setIcon("download")
        .onClick(async () => {
          const { ExportModal } = await import("../ui/export-modal.js");
          const { runExportWorkflow } = await import("../services/export-workflow.js");

          if (isGroup) {
            // Compiler la sélection (tous les fichiers sélectionnés)
            const selectedFiles = Array.from(plugin._binderMultiSelect || new Set())
              .map((path: string) => this.app.vault.getAbstractFileByPath(path))
              .filter((f): f is TFile => f instanceof TFile);
            const projectRoot = plugin.getProjectFolder();
            if (!projectRoot) {
              new Notice(t("main.notice.projectFolderNotFound"));
              return;
            }
            const { createSelectionScope } = await import("../services/compile-scope.js");
            const modal = new ExportModal(this.app, plugin, {
              type: "selection",
              files: selectedFiles,
            });
            modal.setOnSubmit(async (format: string, name: string) => {
              const scope = createSelectionScope(projectRoot.path, selectedFiles.map((f) => f.path));
              await runExportWorkflow(this.app, plugin, scope, format, name);
            });
            modal.open();
          } else {
            // Compiler ce fichier
            const projectRoot = plugin.getProjectFolder();
            if (!projectRoot) {
              new Notice(t("main.notice.projectFolderNotFound"));
              return;
            }
            const { createFileScope } = await import("../services/compile-scope.js");
            const modal = new ExportModal(this.app, plugin, {
              type: "file",
              files: [file],
            });
            modal.setOnSubmit(async (format: string, name: string) => {
              const scope = createFileScope(projectRoot.path, file.path);
              await runExportWorkflow(this.app, plugin, scope, format, name);
            });
            modal.open();
          }
        })
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.trash"))
        .setIcon("trash")
        .onClick(async () => {
          await this.app.fileManager.trashFile(file);
          plugin.renderAllViews(true);
          new Notice(t("shared.trashed", { name: plugin.titleFor(file) || file.basename }));
        })
    );
    menu.showAtMouseEvent(e);
  }

  /** `extraItems`, optionnel : permet à une vue appelante d'ajouter des
   * entrées propres à son contexte (ex. « Isoler ce dossier » dans le
   * Binder — voir FeuilletsView.binderIsolateExtras) sans dupliquer tout ce
   * menu ni en créer un second. BoardView (l'autre appelant) ne le passe
   * jamais : son menu reste identique à avant. */
  showFolderContextMenu(e: MouseEvent, folder: TFolder, _parent: ProjectNode, _index: number, _siblings: ProjectNode[], extraItems?: (menu: Menu) => void): void {
    const menu = new Menu();
    const plugin = this.plugin;

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.openWithPreview"))
        .setIcon("eye")
        .onClick(async () => {
          const projectRoot = plugin.getProjectFolder();
          if (!projectRoot) return;
          const scope = createFolderScope(projectRoot.path, folder.path);
          await this.openScopeWithContinuAndPreview(scope);
        })
    );
    extraItems?.(menu);
    this.addFolderCarnetMenuItem(menu, folder);
    menu.addSeparator();

    menu.addItem((item) => item.setTitle(t("shared.contextMenu.newMenu")).setIcon("plus").onClick((evt) => showChoices(evt, e, (choices) => {
      choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetInside")).setIcon("file-plus").onClick(() => plugin.newSheet(folder)));
      choices.addItem((choice) => choice.setTitle(t("binder.newSubfolder")).setIcon("folder-plus").onClick(() => plugin.newFolder(folder)));
    })));
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.renameFolder"))
        .setIcon("pencil")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (root && folder.path === root.path) {
            new Notice(t("shared.contextMenu.cannotRenameProjectRoot") || "Cannot rename the project root.");
            return;
          }
          new RenameFolderModal(this.app, folder.name, async (newName) => {
            const parent = folder.parent;
            if (!parent) return;
            const newPath = normalizePath(`${parent.path}/${newName}`);
            if (this.app.vault.getAbstractFileByPath(newPath)) {
              new Notice(t("shared.contextMenu.folderNameExists") || `A folder or file named "${newName}" already exists.`);
              return;
            }
            try {
              await this.app.fileManager.renameFile(folder, newPath);
              plugin.renderAllViews(true);
              new Notice(t("shared.contextMenu.folderRenamed", { name: newName }) || `Folder renamed to "${newName}".`);
            } catch {
              new Notice(t("shared.contextMenu.renameFolderFailed") || "Failed to rename folder.");
            }
          }).open();
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.openFolderNote"))
        .setIcon("notebook-text")
        .onClick(async () => {
          const note = await plugin.getOrCreateFolderNote(folder);
          openFileActivating(this.app, this.app.workspace.getLeaf(false), note);
        })
    );
    menu.addSeparator();

    menu.addItem((item) => item.setTitle(t("binder.research.associatedResearchMenu")).setIcon("search").onClick((evt) =>
      showChoices(evt, e, (choices) => this.addBinderResearchActions(choices, folder, folder.name))
    ));
    menu.addSeparator();

    const note = plugin.folderNoteFor(folder);
    const currentLabel = note ? plugin.labelOf(note) : "";
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeLabelMenu")).setIcon("tag").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const l of this.getProjectLabels()) {
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.labelLabel", { label: l.name }))
          .setChecked(l.name === currentLabel)
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) {
              await this.setFm(targetNote, "label", l.name === currentLabel ? "" : l.name);
            }
          })
      );
    }
    })));
    menu.addSeparator();
    const currentStatus = note ? ((this.fm(note).status as string) || "") : "";
    const allStatuses = getProjectStatuses(this.app, plugin ? plugin.settings : null);
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeStatusMenu")).setIcon("circle-dot").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const st of allStatuses.filter(Boolean)) {
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: st }))
          .setChecked(st === currentStatus)
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) {
              await this.setFm(targetNote, "status", st === currentStatus ? "" : st);
            }
          })
      );
    }
    })));
    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle(t("shared.contextMenu.organizationMenu"))
      .setIcon("settings-2")
      .onClick((evt) => showChoices(evt, e, (choices) => {
        choices.addItem((item) => item
          .setTitle(t("shared.contextMenu.editTags"))
          .setIcon("tag")
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) new TagsModal(this.app, plugin, targetNote).open();
          })
        );
        choices.addItem((item) => item
          .setTitle(t("shared.contextMenu.editSynopsis"))
          .setIcon("text")
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) new FmFieldModal(this.app, plugin, targetNote, "synopsis", t("shared.contextMenu.folderSynopsisLabel"), () => this.render(true)).open();
          })
        );
        choices.addItem((item) => item
          .setTitle(t("shared.contextMenu.editSummary"))
          .setIcon("file-text")
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) new FmFieldModal(this.app, plugin, targetNote, "summary", t("shared.contextMenu.folderSummaryLabel"), () => this.render(true)).open();
          })
        );
        choices.addItem((item) => item
          .setTitle(t("shared.contextMenu.setWordGoal"))
          .setIcon("target")
          .onClick(() => new FolderGoalModal(this.app, plugin, folder).open())
        );
      }))
    );
    menu.addSeparator();

    // Compilation libre : le sélecteur reste natif, même lorsqu'une seule
    // commande de compilation de dossier est actuellement disponible.
    menu.addItem((item) => item
      .setTitle(t("shared.contextMenu.compilationMenu"))
      .setIcon("download")
      .onClick((evt) => showChoices(evt, e, (choices) => {
        choices.addItem((item) => item
        .setTitle(t("binder.compileFolder"))
        .setIcon("download")
        .onClick(async () => {
          const { ExportModal } = await import("../ui/export-modal.js");
          const { runExportWorkflow } = await import("../services/export-workflow.js");
          const { createFolderScope } = await import("../services/compile-scope.js");
          const projectRoot = plugin.getProjectFolder();
          if (!projectRoot) {
            new Notice(t("main.notice.projectFolderNotFound"));
            return;
          }
          const modal = new ExportModal(this.app, plugin, {
            type: "folder",
            name: folder.name,
            folderPath: folder.path,
          });
          modal.setOnSubmit(async (format: string, name: string) => {
            const scope = createFolderScope(projectRoot.path, folder.path);
            await runExportWorkflow(this.app, plugin, scope, format, name);
          });
          modal.open();
        }));
      }))
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.trashFolder"))
        .setIcon("trash")
        .onClick(async () => {
          await this.app.fileManager.trashFile(folder);
          plugin.renderAllViews(true);
          new Notice(t("shared.contextMenu.folderTrashed", { name: folder.name }));
        })
    );
    menu.showAtMouseEvent(e);
  }

  constructor(leaf: WorkspaceLeaf, plugin: FeuilletsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getProjectFolder(): TFolder | null {
    return this.plugin.getProjectFolder();
  }

  fm(file: TFile): SceneFrontmatter {
    return this.plugin.fmOf(file);
  }

  titleFor(file: TFile): string {
    return this.plugin.titleFor(file);
  }

  /** §18 du chantier « mapping YAML » : pour les 9 champs logiques
   * mappables (isMappableField), délègue à l'écrivain logique centralisé
   * (mapping de projet, variante de casse déjà présente, jamais de clé
   * dupliquée) — voir services/frontmatter.ts writeLogicalFrontmatterField.
   * Toute autre clé (tags, colonnes calculées…) continue d'écrire la clé
   * RAW exacte, exactement comme avant ce chantier. */
  async setFm(file: TFile, key: string, value: unknown): Promise<void> {
    if (isMappableField(key)) {
      await writeLogicalFrontmatterField(this.app, this.plugin.settings, file, key, value);
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (fm: SceneFrontmatter) => {
      if (
        value === "" ||
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0)
      ) {
        delete fm[key];
      } else {
        fm[key] = value;
      }
    });
  }

  goalFor(file: TFile): number {
    const g = parseInt(String(this.fm(file).goal), 10);
    return isNaN(g) ? projectWordGoalDefault(this.app, this.plugin.settings) : g;
  }

  ringState(wc: number, goal: number): "none" | "hit" | "over" | "under" {
    const tol = projectTolerance(this.app, this.plugin.settings);
    if (goal <= 0) return "none";
    if (wc >= goal - tol && wc <= goal + tol) return "hit";
    if (wc > goal + tol) return "over";
    return "under";
  }

  fillRing(ring: HTMLElement, wc: number, goal: number): void {
    const pct = goal > 0 ? Math.min(100, Math.round((wc / goal) * 100)) : 0;
    ring.style.setProperty("--pct", `${pct}%`);
    ring.removeClass("feuillets-ring-hit");
    ring.removeClass("feuillets-ring-over");
    const state = this.ringState(wc, goal);
    if (state === "hit" || state === "over")
      ring.addClass(`feuillets-ring-${state}`);
  }

  /** Garde défensive posée sur `mousedown` (feuillets-view.ts, renderFileRow) :
   * avec Maj/Cmd/Ctrl enfoncé, empêche la sélection native du texte de
   * l'aperçu pendant la construction de la multi-sélection Binder. Depuis
   * que la ligne entière (et non plus une poignée séparée) porte le drag
   * (`dropEl === handleEl`, voir attachDragHandlers), ce même `mousedown`
   * est aussi celui qui doit laisser le navigateur démarrer un `dragstart`
   * natif — or `preventDefault()` sur `mousedown` empêche ce `dragstart`.
   * Exactement le geste cassé : garder Cmd/Ctrl enfoncé après avoir
   * sélectionné plusieurs feuillets, puis glisser l'un d'eux SANS relâcher
   * la touche. On ne bloque donc plus que le premier Maj/Cmd/Ctrl+clic qui
   * construit la sélection ; un membre déjà sélectionné laisse le drag
   * natif s'amorcer. Isolé ici (plutôt qu'inline) pour rester testable
   * indépendamment du rendu complet d'une ligne. */
  shouldPreventMultiSelectMousedown(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey?: boolean }, path: string, hidden: boolean): boolean {
    if (hidden || !(e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)) return false;
    const sel = this.plugin._binderMultiSelect;
    if (sel && sel.has(path)) return false;
    return true;
  }

  /** Toggle individuel d'un chemin dans `_binderMultiSelect` (existant,
   * jamais un second Set) : initialise la sélection si nécessaire, bascule
   * `path`, déplace l'ancre, rafraîchit les classes. Correctif final
   * multi-drag, §3 : extrait de la branche Cmd/Ctrl de `handleMultiSelectClick`
   * pour être réutilisé tel quel par le geste Option/Alt dédié à la
   * réorganisation Binder (voir feuillets-view.ts) — sans dupliquer la
   * logique ni créer un second état parallèle. */
  toggleBinderReorderSelection(path: string, parentPath: string, index: number, scopeEl: HTMLElement): void {
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    const sel = this.plugin._binderMultiSelect;
    if (sel.has(path)) sel.delete(path);
    else sel.add(path);
    this.plugin._binderMultiSelectAnchor = { parentPath, index };
    this.refreshMultiSelectClasses(scopeEl);
  }

  /** Clic sur une ligne sélectionnable en vue d'un déplacement groupé
   * (Binder, Plan…) : Maj+clic sélectionne la PLAGE depuis le dernier
   * point d'ancrage (comme un explorateur de fichiers), Cmd/Ctrl+clic
   * bascule un élément un par un tout en déplaçant l'ancrage, un clic
   * normal réinitialise. Partagé entre vues pour un comportement
   * identique partout — voir attachDragHandlers pour la suite (le
   * glisser-déposer group entraîne réellement toute la sélection).
   * Retourne true si le clic a été consommé par la sélection (l'appelant
   * ne doit alors pas ouvrir le fichier). */
  handleMultiSelectClick(e: MouseEvent, node: TAbstractFile, parent: ProjectNode, index: number, siblings: ProjectNode[], scopeEl: HTMLElement): boolean {
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    const sel = this.plugin._binderMultiSelect;

    if (e.shiftKey) {
      e.preventDefault();
      const anchor = this.plugin._binderMultiSelectAnchor;
      if (anchor && anchor.parentPath === parent.path) {
        const lo = Math.min(anchor.index, index);
        const hi = Math.max(anchor.index, index);
        sel.clear();
        for (let i = lo; i <= hi; i++) {
          if (siblings[i]) sel.add(siblings[i].path);
        }
      } else {
        sel.clear();
        sel.add(node.path);
        this.plugin._binderMultiSelectAnchor = { parentPath: parent.path, index };
      }
      this.refreshMultiSelectClasses(scopeEl);
      return true;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.toggleBinderReorderSelection(node.path, parent.path, index, scopeEl);
      return true;
    }

    if (sel.size > 0) {
      sel.clear();
      this.refreshMultiSelectClasses(scopeEl);
    }
    this.plugin._binderMultiSelectAnchor = { parentPath: parent.path, index };
    return false;
  }

  refreshMultiSelectClasses(scopeEl: HTMLElement): void {
    const sel = this.plugin._binderMultiSelect;
    scopeEl.querySelectorAll("[data-path]").forEach((el) => {
      const path = el.getAttr("data-path");
      if (sel && path && sel.has(path)) el.addClass("is-selected");
      else el.removeClass("is-selected");
    });
  }

  ensureSelectionForContextMenu(nodePath: string, scopeEl: HTMLElement): void {
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    const sel = this.plugin._binderMultiSelect;

    // Si le nœud cliqué n'est pas sélectionné, sélectionner uniquement celui-ci
    if (!sel.has(nodePath)) {
      sel.clear();
      sel.add(nodePath);
      this.refreshMultiSelectClasses(scopeEl);
    }
    // Sinon, garder la sélection existante (aucune action)
  }

  /** Actions groupées — mêmes trois gestes partagés entre le clic droit du
   * Binder/Plan (showFileContextMenu) et le mode sélection du panneau
   * Cartes : appliquer un statut, un label, ou ajouter un tag à toute une
   * liste de feuillets d'un coup. Centralisé ici pour ne pas avoir deux
   * copies de la même boucle setFm+Notice à maintenir. */
  async applyBulkStatus(files: TFile[], status: string): Promise<void> {
    for (const f of files) await this.setFm(f, "status", status);
    new Notice(t("shared.bulk.statusApplied", { status, count: String(files.length), s: files.length > 1 ? "s" : "" }));
  }

  async applyBulkLabel(files: TFile[], labelName: string): Promise<void> {
    for (const f of files) await this.setFm(f, "label", labelName);
    new Notice(t("shared.bulk.labelApplied", { label: labelName, count: String(files.length), s: files.length > 1 ? "s" : "" }));
  }

  promptBulkTag(files: TFile[], onDone?: () => void): void {
    new TextInputModal(
      this.app,
      t("shared.bulk.addTagTitle", { count: String(files.length), s: files.length > 1 ? "s" : "" }),
      [{ name: "tag", label: t("shared.tags.field"), value: "" }],
      async (values) => {
        const clean = String(values.tag || "").trim().replace(/^#/, "");
        if (!clean) return;
        for (const f of files) {
          const existing = this.plugin.tagsOf(f);
          if (!existing.includes(clean)) await this.setFm(f, "tags", [...existing, clean]);
        }
        new Notice(t("shared.bulk.tagApplied", { tag: clean, count: String(files.length), s: files.length > 1 ? "s" : "" }));
        if (onDone) onDone();
      }
    ).open();
  }

  /** Filtre une liste de chemins sélectionnés pour éliminer les descendants
   * d'autres éléments sélectionnés. Cela évite de déplacer un élément deux
   * fois si son parent est également sélectionné. */
  filterOutDescendants(selectedPaths: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const path of selectedPaths) {
      // Vérifier si ce chemin est un descendant d'un autre chemin sélectionné
      let isDescendant = false;
      for (const otherPath of selectedPaths) {
        if (otherPath !== path && path.startsWith(otherPath + "/")) {
          isDescendant = true;
          break;
        }
      }
      if (!isDescendant) {
        result.add(path);
      }
    }
    return result;
  }

  /** Calcule l'ordre final d'une liste de siblings après retrait d'un
   * sous-ensemble déplacé puis réinsertion en bloc à une frontière — utilisé
   * pour le reorder same-parent, aussi bien unitaire que multi (correctif
   * final multi-drag, §8/§9). `boundary` est un index dans l'espace de la
   * liste ORIGINALE (AVANT cible = index de la cible, APRÈS cible =
   * index + 1) — jamais recalculé après un retrait partiel, ce qui était la
   * source du bug de reorder unitaire vers le bas (`splice(effectiveIndex)`
   * appliqué à une liste déjà amputée du membre déplacé). On compte ici
   * combien de membres déplacés avaient un index STRICTEMENT inférieur à la
   * frontière pour corriger l'index d'insertion en conséquence. */
  resolveDropOrder(siblings: ProjectNode[], movedIndices: Set<number>, boundary: number): ProjectNode[] {
    const movedBeforeBoundary = [...movedIndices].filter((i) => i < boundary).length;
    const remaining = siblings.filter((_, i) => !movedIndices.has(i));
    const insertionIndex = Math.max(0, Math.min(boundary - movedBeforeBoundary, remaining.length));
    const movedNodes = [...movedIndices].sort((a, b) => a - b).map((i) => siblings[i]);
    const result = [...remaining];
    result.splice(insertionIndex, 0, ...movedNodes);
    return result;
  }

  attachDragHandlers(handleEl: HTMLElement, dropEl: HTMLElement, parent: ProjectNode, index: number, siblings: ProjectNode[], _scopeEl: HTMLElement): void {
    /* La ligne entière devient draggable (handleEl === dropEl). */
    dropEl.draggable = true;
    dropEl.addEventListener("dragstart", (e) => {
      /* Ne pas démarrer un drag depuis un contrôle interactif explicite
         (bouton, menu, chevron d'expansion, "+" d'ajout) — cela
         empêcherait leur usage normal. */
      const target = e.target as HTMLElement;
      if (target.closest("button, .feuillets-folder-add, .feuillets-folder-chevron, .clickable-icon, .feuillets-project-actions, [aria-label]")) {
        e.preventDefault();
        return;
      }

      /* Poignée d'une scène faisant partie d'une sélection multiple
         (Cmd/Ctrl+clic ou Maj+clic, voir renderFileRow) : on entraîne tout
         le groupe, pas juste celle qu'on a saisie — sinon la sélection ne
         servirait à rien pour un vrai déplacement groupé. */
      const draggedPath = siblings[index] ? siblings[index].path : null;
      const draggedNode = siblings[index];

      // Interdire le drag des dossiers techniques (qui commencent par _)
      if (draggedNode instanceof TFolder && draggedNode.name.startsWith("_")) {
        e.preventDefault();
        return;
      }

      /* Éligibilité STRICTE du batch (correctif final multi-drag, §5) : un
         drag groupé n'est autorisé que si le nœud réellement saisi est un
         TFile, que la sélection contient plus d'un élément dont ce chemin,
         ET que TOUS les chemins sélectionnés se résolvent en TFile ayant
         EXACTEMENT le même parent que le fichier saisi. La moindre entorse
         (dossier dans la sélection, parent différent) fait retomber sur le
         drag unitaire historique — plus de filtrage silencieux d'une
         sélection multi-parent en batch partiel. */
      const sel = this.plugin._binderMultiSelect;
      let items: { path: string; index: number }[] | null = null;
      if (draggedNode instanceof TFile && sel && sel.size > 1 && draggedPath && sel.has(draggedPath)) {
        const allSameParentFiles = [...sel].every((p) => {
          const node = this.app.vault.getAbstractFileByPath(p);
          return node instanceof TFile && node.parent?.path === draggedNode.parent?.path;
        });
        if (allSameParentFiles) {
          // L'ordre des items vient exclusivement de `siblings` (ordre Binder réel).
          const candidateItems = siblings
            .map((s, i) => ({ path: s.path, index: i }))
            .filter((it) => sel.has(it.path));
          if (candidateItems.length > 1) items = candidateItems;
        }
      }
      if (items) {
        this.plugin.dragState = { parentPath: parent.path, multi: true, items };
      } else {
        this.plugin.dragState = {
          parentPath: parent.path,
          index,
          path: draggedPath,
        };
      }
      this.plugin._dragInProgress = true;
      this.plugin._dragRetryCount = 0;
      dropEl.addClass("feuillets-dragging");
      /* Le drag HTML natif a besoin d'un DataTransfer réellement initialisé
         au dragstart pour être engagé par Chromium/Electron — un
         `effectAllowed` seul, sans aucun `setData`, ne suffit pas. Toute
         ligne Binder (fichier seul, dossier, ou groupe multi) pose donc
         d'abord ce marqueur MIME privé, minimal et stable : il ne sert
         qu'à initialiser correctement l'opération native, jamais à
         transporter le groupe réel (qui reste exclusivement dans
         `plugin.dragState`, lu au drop — voir §3/§4 du correctif). */
      const transfer = e.dataTransfer;
      if (transfer) {
        transfer.setData("application/x-feuillets-binder", draggedPath ?? "feuillets");
        transfer.effectAllowed = "move";
      }
      /* Le Binder garde son propre état pour le réordonnancement interne,
         mais expose aussi le chemin du feuillet au Canvas natif. Obsidian /
         Advanced Canvas peut alors créer un vrai FileNode sans que Feuillets
         ne déplace, copie ou modifie le Markdown. Les dossiers et les
         sélections multiples restent volontairement exclus de ce premier
         flux. */
      if (transfer && draggedNode instanceof TFile && !this.plugin.dragState?.multi) {
        transfer.setData("text/plain", draggedNode.path);
        /* Correctif « drag Binder/Recherche → vrai FileNode » : MIME privé
           supplémentaire lu par le câblage vivant du Carnet (voir
           integrations/advanced-canvas.ts) pour matérialiser un VRAI
           FileNode Canvas au drop, jamais un TextNode `[[lien]]`. */
        transfer.setData(FEUILLETS_FILE_DRAG_MIME, draggedNode.path);
      }
      e.stopPropagation();
    });
    dropEl.addEventListener("dragend", () => {
      this.plugin._dragInProgress = false;
      this.plugin.dragState = null;
      dropEl.removeClass("feuillets-dragging");
      this.contentEl
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging, .feuillets-dragover-folder, .feuillets-dragover-between")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
          el.removeClass("feuillets-dragover-folder");
          el.removeClass("feuillets-dragover-between");
        });
    });
    dropEl.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";

      // Déterminer la zone de drop selon le type d'élément survolé
      const rect = dropEl.getBoundingClientRect();
      const dropNode = siblings[index];
      const isFolder = dropNode instanceof TFolder;
      const relativeY = e.clientY - rect.top;
      const height = rect.height;

      if (isFolder) {
        // Dossier : 3 zones (haut 30% = AVANT, milieu 40% = DANS, bas 30% = APRÈS)
        const topThreshold = height * 0.3;
        const bottomThreshold = height * 0.7;
        if (relativeY < topThreshold) {
          // AVANT le dossier
          dropEl.addClass("feuillets-dragover-between");
          dropEl.removeClass("feuillets-dragover-folder");
        } else if (relativeY > bottomThreshold) {
          // APRÈS le dossier
          dropEl.addClass("feuillets-dragover-between");
          dropEl.removeClass("feuillets-dragover-folder");
        } else {
          // DANS le dossier
          dropEl.addClass("feuillets-dragover-folder");
          dropEl.removeClass("feuillets-dragover-between");
        }
      } else {
        // Feuillet : 2 zones (haut 50% = AVANT, bas 50% = APRÈS)
        const middleY = rect.top + height / 2;
        const isNearBottom = e.clientY > middleY;
        if (isNearBottom) {
          // APRÈS le feuillet
          dropEl.addClass("feuillets-dragover-between");
          dropEl.removeClass("feuillets-dragover-folder");
        } else {
          // AVANT le feuillet
          dropEl.addClass("feuillets-dragover-between");
          dropEl.removeClass("feuillets-dragover-folder");
        }
      }
    });
    dropEl.addEventListener("dragleave", () => {
      dropEl.removeClass("feuillets-dragover");
      dropEl.removeClass("feuillets-dragover-folder");
      dropEl.removeClass("feuillets-dragover-between");
    });
    dropEl.addEventListener("drop", (e) => {
      void (async () => {
      e.preventDefault();
      dropEl.removeClass("feuillets-dragover");
      dropEl.removeClass("feuillets-dragover-folder");
      dropEl.removeClass("feuillets-dragover-between");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;

      // Résoudre la position de drop finale selon la zone survolée
      const rect = dropEl.getBoundingClientRect();
      const dropNode = siblings[index];
      const isFolder = dropNode instanceof TFolder;
      const relativeY = e.clientY - rect.top;
      const height = rect.height;

      let effectiveIndex = index;
      let dropInsideFolder = false;

      if (isFolder) {
        const topThreshold = height * 0.3;
        const bottomThreshold = height * 0.7;
        if (relativeY < topThreshold) {
          // AVANT le dossier
          effectiveIndex = index;
          dropInsideFolder = false;
        } else if (relativeY > bottomThreshold) {
          // APRÈS le dossier
          effectiveIndex = index + 1;
          dropInsideFolder = false;
        } else {
          // DANS le dossier
          effectiveIndex = Number.MAX_SAFE_INTEGER;
          dropInsideFolder = true;
        }
      } else {
        const middleY = rect.top + height / 2;
        const isNearBottom = e.clientY > middleY;
        if (isNearBottom) {
          // APRÈS le feuillet
          effectiveIndex = index + 1;
        } else {
          // AVANT le feuillet
          effectiveIndex = index;
        }
      }

      if (drag.multi) {
        /* Correctif final multi-drag, §7 : un batch ne fait plus qu'une
           seule chose — réordonner des TFile siblings dans leur parent
           commun. Toute destination cross-folder ou « dans un dossier »
           est refusée proprement (aucun moveNode multiple, aucune seconde
           source de vérité) : la sélection et le Binder restent intacts,
           l'utilisateur peut simplement réessayer sur une zone valide. */
        if (drag.parentPath !== parent.path || dropInsideFolder) return;

        const movedIndices = new Set((drag.items || []).map((it) => it.index));
        /* §8 : jamais de return prématuré parce que la cible appartient au
           groupe — on calcule d'abord l'ordre final, la comparaison
           path-par-path avec l'ordre initial décide seule du no-op. */
        const finalOrder = this.resolveDropOrder(siblings, movedIndices, effectiveIndex);
        const changed = finalOrder.some((node, i) => node.path !== siblings[i].path);
        if (changed) {
          await this.plugin.applySiblingOrder(asFolder(parent), finalOrder);
          this.plugin.renderAllViews(true);
        }
        return;
      }

      if (drag.parentPath === parent.path) {
        const from = drag.index!;
        const target = siblings[index];
        const draggedNode = siblings[from];
        /* Cible = un dossier frère (même parent que le fichier déplacé) :
           déposer DANS le dossier seulement si on est dans la zone centrale. */
        if (
          dropInsideFolder &&
          target instanceof TFolder &&
          target.path !== drag.path &&
          !(draggedNode instanceof TFolder)
        ) {
          const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
          if (moved) await this.plugin.moveNode(moved as ProjectNode, asFolder(parent), target, Number.MAX_SAFE_INTEGER);
          this.plugin.renderAllViews(true);
          return;
        }
        /* §9 : même helper que le multi (`resolveDropOrder`) — corrige le
           bug historique où `effectiveIndex`, calculé dans l'espace de la
           liste ORIGINALE, était réappliqué tel quel après un
           `splice(from, 1)` qui avait déjà décalé les index suivants. */
        const finalOrder = this.resolveDropOrder(siblings, new Set([from]), effectiveIndex);
        const changed = finalOrder.some((node, i) => node.path !== siblings[i].path);
        if (changed) {
          await this.plugin.applySiblingOrder(asFolder(parent), finalOrder);
          this.plugin.renderAllViews(true);
        }
        return;
      }

      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      const target = siblings[index];
      let destFolder: TFolder = asFolder(parent);
      let insertIndex = effectiveIndex;
      if (dropInsideFolder && target instanceof TFolder && target.path !== moved.path) {
        destFolder = target;
        insertIndex = Number.MAX_SAFE_INTEGER;
      }
      await this.plugin.moveNode(moved as ProjectNode, srcParent, destFolder, insertIndex);
      this.plugin.renderAllViews(true);
      })();
    });
  }

  /** Zone de dépôt de secours pour un dossier sans aucun feuillet (ex. Front
   * juste après la création du projet) : attachDragHandlers n'attache ses
   * écouteurs qu'aux lignes de fiches réellement rendues, donc un dossier
   * vide n'a alors aucune cible de drop — glisser une scène dedans ne
   * faisait rien. `dropEl` est ici le message "Aucun feuillet…" affiché à
   * la place de la liste ; le dépôt ajoute simplement à la fin de `folder`. */
  attachEmptyFolderDropHandler(dropEl: HTMLElement | null | undefined, folder: TFolder): void {
    if (!dropEl) return;
    dropEl.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      // Pour le dossier vide, c'est toujours un dépôt DANS le dossier
      dropEl.addClass("feuillets-dragover-folder");
    });
    dropEl.addEventListener("dragleave", () => {
      dropEl.removeClass("feuillets-dragover");
      dropEl.removeClass("feuillets-dragover-folder");
      dropEl.removeClass("feuillets-dragover-between");
    });
    dropEl.addEventListener("drop", (e) => {
      void (async () => {
      e.preventDefault();
      dropEl.removeClass("feuillets-dragover");
      dropEl.removeClass("feuillets-dragover-folder");
      dropEl.removeClass("feuillets-dragover-between");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;

      /* Correctif final multi-drag, §7 : un dossier vide n'est jamais le
         parent source du groupe (c'est une zone de dépôt de secours pour un
         AUTRE dossier) — donc toujours cross-folder pour un batch. Refuser
         proprement, aucun moveNode multiple. */
      if (drag.multi) return;

      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      await this.plugin.moveNode(moved as ProjectNode, srcParent, folder, Number.MAX_SAFE_INTEGER);
      this.plugin.renderAllViews(true);
      })();
    });
  }
}
