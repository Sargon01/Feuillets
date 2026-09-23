import { VIEW_SCRIVENINGS } from "../constants.js";
import { workspaceTolerance, workspaceWordGoalDefault } from "../services/folder-workspaces.js";
import { writeLogicalFrontmatterField, isMappableField } from "../services/frontmatter.js";
import { foldAccents } from "../utils/core.js";
import { refreshSearchIndex } from "../utils/search-index.js";
import { AppearancesModal, FolderGoalModal, TagsModal, SaveResearchFilterModal, ManageSavedFiltersModal } from "../ui/entity-modals.js";
import { TextInputModal } from "../scenes-editor.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { NewFolderModal, RenameBinderItemModal, RenameFolderModal, NewResearchFileModal, RenameFileModal } from "../ui/basic-modals.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getResearchTemplate } from "../services/research-templates.js";
import { promptForPage } from "../ui/citation-modal.js";
import { CompareFilesModal, PickFileModal } from "../ui/diff-modal.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { listSnapshotFiles } from "../services/project-files.js";
import { isProjectDraft } from "../services/project-drafts.js";
import { MoveDraftToProjectModal } from "../ui/move-draft-modal.js";
import {
  isResearchFile,
  isResearchAttachment,
  isResearchPreviewable,
  researchFileIcon,
  researchFileLinkMarkdown,
  researchFileTypeLabel,
  researchFolderPath,
} from "../services/research.js";
import {
  createResearchBase,
  createResearchCanvas,
  delegateNewExcalidrawDrawing,
  isExcalidrawActive,
} from "../services/research-create.js";
import { importFilesIntoResearchFolder, researchImportAccept } from "../services/research-import.js";
import { applyResearchOrder, reorderResearchKeys, RESEARCH_ORDER_DRAG_MIME } from "../services/research-order.js";
import { resourcesFolderPath, resourcesSubfolderPath, detectProjectStructureLocale } from "../services/folder-structure.js";
import { projectCreationNames } from "../i18n/project-creation.js";
import { addOpenWithPreviewItem, openScopeWithPreviewBesideLeaf } from "./preview-view.js";
import { openScopeInContinu, openScopeInContinuOnLeaf } from "./scrivenings-view.js";
import { createFolderScope, createSelectionScope, compileScopesEqual, resolveCompileScopeFiles, type CompileScope } from "../services/compile-scope.js";
import {
  RESEARCH_FOLDERS,
  researchFolderLabel,
  researchFolderNames,
  researchFolderNewName,
  RESEARCH_SECTION_CATALOGUE_KEYS,
  isResearchFolderKey,
} from "../utils/project-modes.js";
import { FolderSuggest } from "../ui/folder-suggest.js";
import { workspaceLabels, workspaceStatuses } from "../services/folder-workspaces.js";
import { t, getLocale } from "../i18n/index.js";
import {
  statusStoredValue,
  statusDisplayLabel,
  labelStoredValue,
  labelDisplayLabel,
} from "../services/project-taxonomy.js";
import { FEUILLETS_FILE_DRAG_MIME } from "../carnet/canvas/adapter.js";
import { collectDocumentScopeCitedBibtexEntries } from "../services/citekey-bibliography.js";
import { analyzeResearchCitations, type ResearchCitationAnalysis } from "../services/research-citation-analysis.js";
import type { ResearchBibliographyGenerationInput } from "../services/bibliography-generator.js";
import {
  buildFootnoteOverviewTree,
  buildFootnoteFileEntries,
  type FootnoteFileEntry,
  type FootnoteFolderNode,
} from "../services/research-footnotes-overview.js";
import type { ResearchDocumentContext, ResearchDocumentScopeMode } from "../services/research-document-context.js";
import { CITABLE_ATTACHMENT_EXTENSIONS } from "../services/citation-candidates.js";
import { isGenuineSourcesFolder } from "../services/workspace-research-context.js";
export { remapResearchFolderLinks } from "../carnet/core/path-reference-maintenance.js";

export type ResearchScopeMode = ResearchDocumentScopeMode;

/** The Research panel's two sub-tabs: "dossiers" shows the project's
 * physical documentary organisation (project/linked research folders,
 * including their Sources and Bibliographie subfolders); "references"
 * shows the reference-focused actions (new Source sheet, insert citation,
 * renumber footnotes) plus the computed Notes and Bibliography, never a
 * folder explorer of any kind. Never persisted to settings — an instance
 * property on ResearchView only, reset on plugin reload, exactly like
 * ResearchScopeMode. */
export type ResearchSubTab = "dossiers" | "references";

/** Context a Research space/folder row needs to be reorderable among its
 * current siblings — visual order only, never a Vault move (see
 * services/research-order.ts). `parentKey` identifies the sibling group
 * (a real folder path for actual folder children, or a synthetic key for a
 * virtual top-level grouping); `key` is this row's own identity within that
 * group (always a real folder path); `siblingKeys` is the FULL group, in
 * the order currently displayed, computed once per render pass by the
 * caller so drag-and-drop and Monter/Descendre always act on exactly what
 * the user sees. */
export type ResearchOrderContext = {
  parentKey: string;
  key: string;
  siblingKeys: string[];
};

export type ResearchRenderOptions = {
  scopeMode?: ResearchScopeMode;
  workspaceActive?: boolean;
  workspaceFolder?: TFolder | null;
  researchRoot?: TFolder | null;
  associatedResearchFolder?: TFolder | null;
  onScopeModeChange?: (mode: ResearchScopeMode) => void;
  activeBranchResearchFolders?: {
    folder: TFolder;
    binderNodes: TAbstractFile[];
  }[];
  documentContext: ResearchDocumentContext;
  activeSubTab?: ResearchSubTab;
  onSubTabChange?: (tab: ResearchSubTab) => void;
};

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
      linked: "folder",
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

  /** Monotonic counter shared by every open view instance — guarantees a
   * unique DOM id namespace per instance, so two Research views open at
   * once (e.g. a split pane) never collide on tab/tabpanel ids. */
  private static _nextResearchInstanceId = 0;
  private _researchInstanceId?: string;

  /** Stable per-instance id prefix for the sub-tab bar's DOM ids
   * (`role="tab"`/`role="tabpanel"` pairing) — computed once and cached,
   * never regenerated on a later render of the same view. */
  private researchInstanceId(): string {
    if (!this._researchInstanceId) {
      this._researchInstanceId = `feuillets-research-${BaseFeuilletsView._nextResearchInstanceId++}`;
    }
    return this._researchInstanceId;
  }


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

  getProjectLabels(folder: TFolder | null = null): Label[] {
    const context = folder || this.plugin.getWorkspaceFolder?.() || this.plugin.getProjectFolder();
    return workspaceLabels(this.app, this.plugin.settings, context);
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

  /** Writes the confirmed file into `folder` — the tail shared by every
   * "create a Research sheet" flow, whether `folder` was already resolved
   * before the modal opened or only after confirmation. Never called before
   * the user has confirmed a valid name. */
  private async createResearchFileInFolder(
    folder: TFolder,
    defaultName: string,
    template: string,
    cleanName: string
  ): Promise<void> {
    const fileName = cleanName.endsWith(".md") ? cleanName : `${cleanName}.md`;
    const destPath = normalizePath(`${folder.path}/${fileName}`);
    if (this.app.vault.getAbstractFileByPath(destPath)) {
      new Notice(t("binder.research.renameAlreadyExists", { name: cleanName }));
      return;
    }
    await this.plugin.ensureFolder(folder.path);
    // The entered name replaces the template's generic title; otherwise
    // Research views would keep displaying that generic title via titleFor().
    const content = syncResearchFileTitle(template, defaultName, cleanName);
    const file = await this.app.vault.create(destPath, content);
    openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    void this.render(true);
  }

  /** Ouvre une modale de saisie puis crée le fichier nommé dans le dossier cible. */
  promptCreateResearchFile(folder: TFolder, defaultName: string, template: string): void {
    new NewResearchFileModal(this.app, folder.name, defaultName, async (rawName) => {
      const cleanName = rawName.trim();
      if (this.isFileNameInvalid(cleanName)) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      await this.createResearchFileInFolder(folder, defaultName, template, cleanName);
    }).open();
  }

  /** Opens the standard file-name dialog for a Sources folder that may not
   * exist yet. Only a confirmed,
   * valid name resolves-or-creates the target folder
   * (ensureResearchCategoryFolder — unchanged) before the file is written.
   * Cancelling the dialog never calls ensureResearchCategoryFolder, so it
   * creates nothing at all: zero folder, zero file, zero settings write. */
  private promptCreateSourceSheetLazily(
    targetBasePath: string,
    rf: typeof RESEARCH_FOLDERS,
    opLocale: ReturnType<typeof getLocale>
  ): void {
    const defaultName = rf.sources.newName;
    new NewResearchFileModal(this.app, researchFolderLabel(rf, "sources"), defaultName, async (rawName) => {
      const cleanName = rawName.trim();
      if (this.isFileNameInvalid(cleanName)) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      const folder = await this.ensureResearchCategoryFolder(targetBasePath, rf, "sources");
      const template = await getResearchTemplate(this.app, this.plugin.settings, "sources", defaultName, opLocale);
      await this.createResearchFileInFolder(folder, defaultName, template, cleanName);
    }).open();
  }

  private promptCreateResearchFileInFolder(folder: TFolder): void {
    const knownKey = (Object.keys(RESEARCH_FOLDERS) as Array<keyof typeof RESEARCH_FOLDERS>)
      .find((key) => researchFolderNames(RESEARCH_FOLDERS, key).includes(folder.name));
    const opLocale = getLocale();
    const defaultName = knownKey
      ? researchFolderNewName(knownKey, opLocale)
      : t("research.newEntry.generic", { folder: folder.name.toLowerCase().replace(/s$/, "") });
    const folderTag = foldAccents(folder.name.toLowerCase().replace(/\s+/g, "-"));
    void (async () => {
      const template = knownKey
        ? await getResearchTemplate(this.app, this.plugin.settings, knownKey, defaultName, opLocale)
        : [
          "---",
          `title: "${defaultName}"`,
          "synopsis: ",
          "tags:",
          `  - ${folderTag}`,
          "---",
          "",
        ].join("\n");
      this.promptCreateResearchFile(folder, defaultName, template);
    })();
  }

  /** Menu du bouton « + » d'une surface Recherche (racine, sous-dossier,
   * dossier associé — les trois seuls appelants, voir renderSection et
   * renderResearchSubfolder) : Nouvelle fiche (modèle spécialisé inchangé,
   * `createFiche`), Nouveau Canvas, Nouvelle Base, Nouveau dessin Excalidraw
   * (seulement si le greffon est actif) et Nouveau sous-dossier (flux
   * existant, `plugin.newFolder`). */
  private showResearchCreateMenu(evt: MouseEvent, folder: TFolder, createFiche: () => void | Promise<void>): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("shared.research.newSheetMenuItem"))
        .setIcon("file-text")
        .onClick(() => { void createFiche(); })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.research.newCanvas"))
        .setIcon("layout-dashboard")
        .onClick(() => {
          void (async () => {
            const file = await createResearchCanvas(this.app, folder);
            openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
            void this.render(true);
          })();
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.research.newBase"))
        .setIcon("database")
        .onClick(() => {
          void (async () => {
            const file = await createResearchBase(this.app, folder);
            openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
            void this.render(true);
          })();
        })
    );
    if (isExcalidrawActive(this.app)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.newExcalidraw"))
          .setIcon("shapes")
          .onClick((clickEvt) => {
            delegateNewExcalidrawDrawing(this.app, folder, clickEvt as MouseEvent);
          })
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(t("binder.newSubfolder"))
        .setIcon("folder-plus")
        .onClick(() => this.plugin.newFolder(folder))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("shared.research.importFiles"))
        .setIcon("upload")
        .onClick(() => this.promptImportFilesIntoResearchFolder(folder))
    );
    menu.showAtMouseEvent(evt);
  }

  /** Opens the native, OS-level multiple-file picker and copies whatever
   * gets selected into `folder` — never moving or deleting the sources.
   * The `<input>` is temporary: created, clicked, and always removed
   * afterward (on a real selection, a change with zero files, or a
   * cancel), so nothing lingers in the DOM. Business logic (extension
   * validation, name cleanup, collision handling, sequential copy) lives
   * entirely in services/research-import.ts; this method only wires the
   * picker and reports the result. */
  private promptImportFilesIntoResearchFolder(folder: TFolder): void {
    const input = document.body.createEl("input", {
      type: "file",
      cls: "feuillets-research-import-input",
    });
    input.multiple = true;
    input.accept = researchImportAccept();
    const cleanup = (): void => { input.remove(); };
    input.addEventListener("change", () => {
      const selected = input.files ? Array.from(input.files) : [];
      cleanup();
      if (selected.length === 0) return;
      void (async () => {
        const summary = await importFilesIntoResearchFolder(this.app, folder, selected);
        if (summary.imported > 0) this.plugin.renderAllViews(true);
        new Notice(t("shared.research.importSummary", {
          imported: String(summary.imported),
          skipped: String(summary.skipped),
          failed: String(summary.failed),
        }));
      })();
    });
    input.addEventListener("cancel", cleanup);
    input.click();
  }

  private promptRenameResearchFolder(folder: TFolder): void {
    new RenameFolderModal(this.app, folder.name, async (rawName) => {
      const newName = rawName.trim();
      if (!newName || newName.includes("/") || newName.includes("\\")) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      if (newName === folder.name) return;
      const parent = folder.parent;
      if (!parent) return;
      const newPath = normalizePath(`${parent.path}/${newName}`);
      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(t("shared.contextMenu.folderNameExists"));
        return;
      }
      try {
        await this.app.fileManager.renameFile(folder, newPath);
        this.plugin.renderAllViews(true);
      } catch {
        new Notice(t("shared.contextMenu.renameFolderFailed"));
      }
    }).open();
  }

  private promptRenameBinderFile(file: TFile): void {
    const initial = {
      title: this.plugin.titleFor(file),
      binderTitle: this.plugin.shortTitleFor(file),
      fileName: file.basename,
    };
    new RenameBinderItemModal(this.app, file, initial, async (values) => {
      const nextFileName = values.fileName.trim().replace(/\.md$/i, "");
      if (!nextFileName || nextFileName.includes("/") || nextFileName.includes("\\")) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      const parent = file.parent;
      if (!parent) return;
      const nextPath = normalizePath(`${parent.path}/${nextFileName}.md`);
      if (nextPath !== file.path && this.app.vault.getAbstractFileByPath(nextPath)) {
        new Notice(t("shared.contextMenu.folderNameExists"));
        return;
      }
      const titleChanged = values.title.trim() !== initial.title;
      const binderTitleChanged = values.binderTitle.trim() !== initial.binderTitle;
      const fileRenamed = nextPath !== file.path;
      if (fileRenamed) {
        await this.app.fileManager.renameFile(file, nextPath);
      }
      if (titleChanged || binderTitleChanged) {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          if (titleChanged) {
            delete fm.title;
            delete fm.titre;
            if (values.title.trim()) fm.title = values.title.trim();
          }
          if (binderTitleChanged) {
            delete fm.short_title;
            delete fm.titre_binder;
            delete fm.titre_court;
            if (values.binderTitle.trim()) fm.short_title = values.binderTitle.trim();
          }
        });
      }
      if (fileRenamed || titleChanged || binderTitleChanged) {
        this.plugin.renderAllViews(true);
      }
    }).open();
  }

  private promptRenameBinderFolder(folder: TFolder): void {
    new RenameBinderItemModal(this.app, folder, {
      title: folder.name,
      binderTitle: "",
      fileName: folder.name,
    }, async (values) => {
      const newName = values.title.trim();
      if (!newName || newName.includes("/") || newName.includes("\\")) {
        new Notice(t("binder.research.invalidName"));
        return;
      }
      if (newName === folder.name) return;
      const root = this.plugin.getProjectFolder();
      if (root && folder.path === root.path) {
        new Notice(t("shared.contextMenu.cannotRenameProjectRoot"));
        return;
      }
      const parent = folder.parent;
      if (!parent) return;
      const newPath = normalizePath(`${parent.path}/${newName}`);
      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(t("shared.contextMenu.folderNameExists"));
        return;
      }
      await this.app.fileManager.renameFile(folder, newPath);
      this.plugin.renderAllViews(true);
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
      const extension = file.extension.toLowerCase();
      const extensionSuffix = extension ? `.${extension}` : "";
      const fileName = extensionSuffix && cleanName.toLowerCase().endsWith(extensionSuffix)
        ? cleanName
        : `${cleanName}${extensionSuffix}`;
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
   * à côte), puis les actions supplémentaires du type de ligne (Apparitions,
   * citer une source — voir `extraItems`, renderResearchFileRow), puis
   * Renommer/Dupliquer/Corbeille. Seul point d'entrée du menu "..." : une
   * ligne Recherche ne porte plus aucun autre bouton d'action direct
   * (correctif de simplification des lignes) — jamais de doublon entre
   * `extraItems` et ce qui suit.
   * `navigationOnly` (dossier Recherche EXTERNE associé depuis le Binder,
   * hors racine Recherche du projet — voir renderAssociatedResearchFolders,
   * renderSection) : ne garde que les deux premières entrées de navigation
   * — jamais de renommer/dupliquer/corbeille sur un dossier documentaire
   * externe, en lecture/navigation seule ; `extraItems` (lecture seule,
   * Apparitions/citer) reste disponible même dans ce cas, comme avant la
   * simplification des lignes. */
  showResearchFileContextMenu(
    e: MouseEvent,
    file: TFile,
    navigationOnly = false,
    extraItems?: (menu: Menu) => void
  ): void {
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
    if (extraItems) extraItems(menu);
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
            const copySuffix = t("binder.research.copySuffix");
            let name = `${file.basename} (${copySuffix})`;
            const extensionSuffix = file.extension ? `.${file.extension}` : "";
            let dest = normalizePath(`${file.parent!.path}/${name}${extensionSuffix}`);
            let k = 2;
            while (this.app.vault.getAbstractFileByPath(dest)) {
              name = `${file.basename} (${copySuffix} ${k++})`;
              dest = normalizePath(`${file.parent!.path}/${name}${extensionSuffix}`);
            }
            if (file.extension.toLowerCase() === "md") {
              await this.app.vault.create(dest, await this.app.vault.read(file));
            } else {
              await this.app.vault.createBinary(dest, await this.app.vault.readBinary(file));
            }
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

  /** A built-in label's `<option>` VALUE (what is stored/compared) is
   * always its stable id (labelStoredValue) — never its display name; the
   * option TEXT is the translated name (labelDisplayLabel). A legacy/
   * custom entry stores and shows its own name, unchanged either way. */
  makeLabelSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const current = this.plugin.labelOf(file);
    const entries = this.getProjectLabels(file.parent);
    const displayForValue = (value: string): string => {
      const entry = entries.find((l) => labelStoredValue(l) === value);
      return entry ? labelDisplayLabel(entry, getLocale()) : value;
    };
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    const none = sel.createEl("option", { text: "—" });
    none.value = "";
    for (const l of entries) {
      const value = labelStoredValue(l);
      if (!value) continue;
      const opt = sel.createEl("option", { text: labelDisplayLabel(l, getLocale()) });
      opt.value = value;
    }
    sel.value = current;
    sel.setAttr("title", current ? displayForValue(current) : t("shared.label.none"));
    const color = current ? this.plugin.labelColor(current, file.parent) : null;
    if (color) sel.style.borderLeft = `4px solid ${color}`;
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "label", sel.value);
        sel.setAttr("title", sel.value ? displayForValue(sel.value) : t("shared.label.none"));
        sel.blur();
      })();
    });
    return sel;
  }

  /** Same contract as makeLabelSelect above: a built-in status's `<option>`
   * value is its stable id, its text the translated name; a legacy/custom
   * status keeps its own name for both. */
  makeStatusSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const fm = this.fm(file);
    const entries = workspaceStatuses(this.app, this.plugin.settings, file.parent);
    const displayForValue = (value: string): string => {
      const entry = entries.find((status) => statusStoredValue(status) === value);
      return entry ? statusDisplayLabel(entry, getLocale()) : value;
    };
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    const none = sel.createEl("option", { text: "—" });
    none.value = "";
    const values: string[] = [];
    for (const status of entries) {
      const value = statusStoredValue(status).trim();
      if (!value) continue;
      values.push(value);
      const opt = sel.createEl("option", { text: statusDisplayLabel(status, getLocale()) });
      opt.value = value;
    }
    const status = typeof fm.status === "string" ? fm.status : "";
    sel.value = values.includes(status) ? status : "";
    sel.setAttr("title", sel.value ? displayForValue(sel.value) : t("shared.status.none"));
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "status", sel.value);
        sel.setAttr("title", sel.value ? displayForValue(sel.value) : t("shared.status.none"));
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

  /** Writing variant: guarantees a category's folder (explicit creation
   * triggered by the "+" button of the section, never during render). Reuses
   * an existing folder under its French or English name, otherwise creates it
   * in the project's structural language. */
  private async ensureResearchCategoryFolder(
    baseResearch: string,
    researchFolders: Record<string, { label: string }>,
    key: string
  ): Promise<TFolder> {
    const existing = this.findResearchCategoryFolder(baseResearch, researchFolders, key);
    if (existing) return existing;
    const fallbackLocale = getLocale();
    const root = this.plugin.getProjectFolder();
    const locale = root ? detectProjectStructureLocale(this.app, root, fallbackLocale) : fallbackLocale;
    const names = projectCreationNames(locale);
    const catalogueKey = isResearchFolderKey(key) ? RESEARCH_SECTION_CATALOGUE_KEYS[key] : undefined;
    const folderName = catalogueKey ? names.researchSections[catalogueKey] : researchFolderNames(researchFolders, key)[0];
    return asFolder(await this.plugin.ensureFolder(`${baseResearch}/${folderName}`));
  }

  async renderResearchBody(
    container: HTMLElement,
    root: TFolder,
    gen: number,
    options: ResearchRenderOptions,
  ): Promise<void> {
    const S = this.plugin.settings;
    const opLocale = getLocale();
    const activeSubTab: ResearchSubTab = options.activeSubTab ?? "dossiers";
    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });

    /* Folder search and tag filters only act on folder rows. Keeping them
       out of References leaves that tab with its three reference actions
       and avoids controls that cannot affect the content below. */
    if (activeSubTab === "dossiers") {
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
    }

    if (options.workspaceActive) {
      const scopeName = options.scopeMode === "project"
        ? t("shared.research.scopeProject")
        : t("shared.research.scopeWorkspace");
      const scopeTooltip = `${t("shared.research.scopeLabel")}: ${scopeName}`;
      const scopeButton = this.iconBtn(toolbar, "layers-3", scopeTooltip);
      scopeButton.setAttr("aria-label", scopeTooltip);
      scopeButton.addEventListener("click", (event) => {
        const menu = new Menu();
        menu.addItem((item) => item
          .setTitle(t("shared.research.scopeWorkspace"))
          .setChecked(options.scopeMode !== "project")
          .onClick(() => options.onScopeModeChange?.("workspace")));
        menu.addItem((item) => item
          .setTitle(t("shared.research.scopeProject"))
          .setChecked(options.scopeMode === "project")
          .onClick(() => options.onScopeModeChange?.("project")));
        menu.showAtMouseEvent(event);
      });
    }

    const researchRoot = options.researchRoot !== undefined
      ? options.researchRoot
      : this.plugin.getResearchRoot();
    const baseResearch = researchRoot
      ? researchRoot.path
      : researchFolderPath(this.app, this.plugin.settings, root, opLocale) || root.path;
    /* Clé de parent pour le réordonnancement visuel des espaces de premier
       niveau (Sources, Personnages, dossiers personnalisés…) — un même
       espace peut apparaître dans plusieurs portées (racine du projet,
       Espace de travail actif) ; ancrer la clé sur `baseResearch` garde
       chaque portée indépendante, jamais mélangée avec l'ordre des
       sous-dossiers réels (services/research-order.ts). */
    const sectionsParentKey = `research-sections:${baseResearch}`;
    const associatedWorkspaceFolder = options.associatedResearchFolder || null;
    const displayedResearchPath = associatedWorkspaceFolder?.path || baseResearch;
    const baseResearchFile = associatedWorkspaceFolder || this.app.vault.getAbstractFileByPath(baseResearch);
    const baseResearchFolder = baseResearchFile instanceof TFolder ? baseResearchFile : null;
    if (this._renderGen !== gen) return;

    const rf = RESEARCH_FOLDERS;

    /* Rubriques personnalisées (voir plus bas, "customFolders") : au lieu
       d'imposer un jeu figé de dossiers, l'utilisateur crée exactement
       les catégories dont SON sujet a besoin — un sous-dossier de
       Recherche/ créé ici apparaît automatiquement comme sa propre
       section. Disponible en fiction comme en non-fiction. */
    /* Folder creation belongs exclusively to Dossiers and is never mixed
       with the three reference actions below. */
    if (activeSubTab === "dossiers") {
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
          const categoryFolder = associatedWorkspaceFolder
            ? this.findResearchCategoryFolder(displayedResearchPath, rf, key)
            : this.findResearchCategoryFolder(baseResearch, rf, key);
          if (categoryFolder) continue;
          hasStandardSection = true;
          menu.addItem((item) =>
            item
              .setTitle(researchFolderLabel(rf, key))
              .setIcon(getResearchSectionIcon(key))
              .onClick(async () => {
                if (associatedWorkspaceFolder) {
                  await this.ensureResearchCategoryFolder(displayedResearchPath, rf, key);
                } else {
                  await this.ensureResearchCategoryFolder(baseResearch, rf, key);
                }
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
                  const path = researchFolderPath(this.app, this.plugin.settings, root, opLocale);
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
    }

    const sourcesFolder = associatedWorkspaceFolder ? null : this.findResearchCategoryFolder(baseResearch, rf, "sources");
    const bibliographieFolder = associatedWorkspaceFolder
      ? null
      : this.findResearchCategoryFolder(baseResearch, rf, "bibliographie");
    /* Sources is the manually-authored fiche library, consulted from
       Dossiers as an ordinary browsable folder — it can be the project's
       own global folder or a linked research's own Sources subfolder,
       depending on scope. The
       computed Bibliography (see renderBibliographySection()) aggregates
       whichever fiches are actually cited, plus resolved BibTeX entries;
       the legacy Bibliographie folder of manually-authored fiches stays
       browsable in Dossiers alongside it — no automatic migration between
       the two, they can coexist on disk indefinitely. */
    /* Chaque catégorie standard est reconnue si son dossier existe ; les
       rubriques personnalisées restent gérées séparément ci-dessous. */
    const personnagesFolder = associatedWorkspaceFolder ? null : this.findResearchCategoryFolder(baseResearch, rf, "personnages");
    const lieuxFolder = associatedWorkspaceFolder ? null : this.findResearchCategoryFolder(baseResearch, rf, "lieux");
    const codexFolder = associatedWorkspaceFolder ? null : this.findResearchCategoryFolder(baseResearch, rf, "codex");
    const glossaireFolder = associatedWorkspaceFolder ? null : this.findResearchCategoryFolder(baseResearch, rf, "glossaire");
    const chronoFolder = associatedWorkspaceFolder
      ? null
      : options.workspaceActive && options.scopeMode === "workspace"
      ? this.findResearchCategoryFolder(baseResearch, rf, "evenements")
      : this.plugin.getChronoFolder();

    /* New source sheet, insert citation, renumber footnotes: References'
       three compact actions exclusively — never mixed into the Dossiers
       toolbar (see newFolderBtn above). Always present together in
       References, regardless of whether a global Sources/Bibliographie
       folder happens to exist yet, and regardless of the associatedWorkspaceFolder
       branch — creating the first Source sheet, inserting a citation or
       renumbering footnotes are all meaningful even before any Sources
       folder exists. */
    if (activeSubTab === "references") {
      const newSourceSheetTarget = associatedWorkspaceFolder ? associatedWorkspaceFolder.path : baseResearch;
      const newSourceBtn = this.iconBtn(toolbar, "file-plus", t("shared.research.newSourceSheet"));
      newSourceBtn.setAttr("aria-label", t("shared.research.newSourceSheet"));
      newSourceBtn.addEventListener("click", () => {
        this.promptCreateSourceSheetLazily(newSourceSheetTarget, rf, opLocale);
      });

      const citeSearchBtn = this.iconBtn(toolbar, "quote", t("shared.research.insertCitationTooltip"));
      citeSearchBtn.setAttr("aria-label", t("shared.research.insertCitationTooltip"));
      citeSearchBtn.addEventListener("click", () => this.plugin.openInsertCitation());

      const renumberBtn = this.iconBtn(toolbar, "list-ordered", t("shared.research.renumberFootnotesTooltip"));
      renumberBtn.setAttr("aria-label", t("shared.research.renumberFootnotesTooltip"));
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
    const linkedResearchPaths = new Set(
      this.plugin.getLinkedResearchFolders().map(({ folder }) => folder.path)
    );
    if (baseResearchFolder) {
      for (const child of baseResearchFolder.children) {
        if (child instanceof TFolder && !standardPaths.has(child.path) &&
          !linkedResearchPaths.has(child.path)) {
          if (!child.name.startsWith("_") && !child.name.startsWith(".")) {
            customFolders.push(child);
          }
        }
      }
    }

    const resPath = resourcesFolderPath(this.app, root, opLocale);
    const visuelsPath = resourcesSubfolderPath(this.app, resPath, "Assets", "Visuels");
    const fVisuels = this.app.vault.getAbstractFileByPath(visuelsPath);
    if (fVisuels instanceof TFolder && fVisuels.children.some((c) => isResearchFile(c))) {
      if (!customFolders.some((f) => f.path === fVisuels.path)) {
        customFolders.push(fVisuels);
      }
    }

    customFolders.sort((a, b) => a.name.localeCompare(b.name, getLocale()));

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
      .sort((a, b) => a.localeCompare(b, getLocale()));

    if (activeSubTab === "dossiers") {
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
    }

    const researchInstanceId = this.researchInstanceId();
    this.renderResearchSubTabs(container, researchInstanceId, activeSubTab, options.onSubTabChange);

    const body = container.createDiv({ cls: "feuillets-research-body" });
    body.setAttr("role", "tabpanel");
    body.setAttr("id", `${researchInstanceId}-tabpanel`);
    body.setAttr("aria-labelledby", `${researchInstanceId}-tab-${activeSubTab}`);

    this.researchFilterActive = activeSubTab === "dossiers" &&
      (!!(S.researchSearch || "").trim() || !!S.researchTagFilter);

    const showProjectAssociations = !options.workspaceActive
      || options.scopeMode !== "workspace";

    /* The mandatory document scope is resolved once by ResearchView.render()
       and is never recomputed or replaced with `root` here. */
    const documentContext = options.documentContext;

    if (associatedWorkspaceFolder) {
      if (activeSubTab === "dossiers") {
        this.renderSection(
          body, associatedWorkspaceFolder.name, associatedWorkspaceFolder, async () =>
            this.promptCreateResearchFile(
              associatedWorkspaceFolder,
              t("binder.research.newFileDefaultName"),
              "---\ntitle: \"\"\ntags:\n---\n"
            )
        );
        if (options.workspaceFolder) {
          this.renderAssociatedResearchFolders(
            body,
            associatedWorkspaceFolder,
            this.scopedLinkedResearchFolders(options, associatedWorkspaceFolder, null, new Set()),
            false,
            false
          );
        }
      } else {
        /* Citation analysis (Pandoc + Source-fiche occurrences) — computed
           only for the References tab, never while Dossiers is active. */
        const citationAnalysis = await analyzeResearchCitations(this.app, this.plugin.settings, documentContext);
        await this.renderReferencesTab(body, documentContext, citationAnalysis);
      }
      this.filterEntities();
      return;
    }

    /* Chaque espace de premier niveau (Sources, Personnages, dossiers
       personnalisés…) est décrit AVANT d'être rendu, pour pouvoir calculer
       l'ordre visuel persisté (researchOrder) sur l'ensemble avant le
       premier appel à renderSection — sans quoi la liste de frères
       transmise à chaque section (pour le glisser-déposer et Monter/
       Descendre) ne pourrait pas refléter l'ordre réellement affiché.
       `key` reste toujours le chemin RÉEL d'un dossier existant : jamais
       encodé dans un nom ni un frontmatter (services/research-order.ts). */
    type ResearchSpace = { key: string; render: (siblingKeys: string[]) => void | Promise<void> };
    const spaces: ResearchSpace[] = [];

    if (sourcesFolder) {
      /* Sources remains the manually authored sheet library in Dossiers;
         each row keeps its existing quick-citation action. */
      const citeRowAction = (menu: Menu, file: TFile) => {
        const ext = file.extension.toLowerCase();
        const isMd = ext === "md";
        const isCitableAttachment = CITABLE_ATTACHMENT_EXTENSIONS.has(ext);
        if (!isMd && !isCitableAttachment) return;
        menu.addItem((item) =>
          item
            .setTitle(isMd ? t("shared.research.citeSource") : t("shared.research.citeDocument"))
            .setIcon("quote")
            .onClick(() => { this.plugin.quickCiteSource(file); })
        );
      };
      spaces.push({
        key: sourcesFolder.path,
        render: async (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "sources"), sourcesFolder, undefined, "sources", citeRowAction, undefined, undefined,
            { parentKey: sectionsParentKey, key: sourcesFolder.path, siblingKeys }
          );
        },
      });
    }

    if (bibliographieFolder) {
      /* Legacy folder of manually-authored bibliography fiches — kept
         browsable in Dossiers alongside Sources, distinct from the
         computed Bibliography section of References. */
      spaces.push({
        key: bibliographieFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "bibliographie"), bibliographieFolder, async () =>
            this.promptCreateResearchFile(
              bibliographieFolder,
              rf.bibliographie.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "bibliographie", rf.bibliographie.newName, opLocale)
            ), "bibliographie", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: bibliographieFolder.path, siblingKeys }
          );
        },
      });
    }

    if (personnagesFolder) {
      spaces.push({
        key: personnagesFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "personnages"), personnagesFolder, async () =>
            this.promptCreateResearchFile(
              personnagesFolder,
              rf.personnages.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "personnages", rf.personnages.newName, opLocale)
            ), "personnages", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: personnagesFolder.path, siblingKeys }
          );
        },
      });
    }

    if (lieuxFolder) {
      spaces.push({
        key: lieuxFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "lieux"), lieuxFolder, async () =>
            this.promptCreateResearchFile(
              lieuxFolder,
              rf.lieux.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "lieux", rf.lieux.newName, opLocale)
            ), "lieux", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: lieuxFolder.path, siblingKeys }
          );
        },
      });
    }

    if (codexFolder) {
      spaces.push({
        key: codexFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "codex"), codexFolder, async () =>
            this.promptCreateResearchFile(
              codexFolder,
              rf.codex.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "codex", rf.codex.newName, opLocale)
            ), "codex", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: codexFolder.path, siblingKeys }
          );
        },
      });
    }

    if (glossaireFolder) {
      spaces.push({
        key: glossaireFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "glossaire"), glossaireFolder, async () =>
            this.promptCreateResearchFile(
              glossaireFolder,
              rf.glossaire.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "glossaire", rf.glossaire.newName, opLocale)
            ), "glossaire", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: glossaireFolder.path, siblingKeys }
          );
        },
      });
    }

    if (chronoFolder) {
      spaces.push({
        key: chronoFolder.path,
        render: (siblingKeys) => {
          this.renderSection(body, researchFolderLabel(rf, "evenements"), chronoFolder, async () =>
            this.promptCreateResearchFile(
              chronoFolder,
              rf.evenements.newName,
              await getResearchTemplate(this.app, this.plugin.settings, "evenements", rf.evenements.newName, opLocale)
            ), "evenements", undefined, undefined, undefined,
            { parentKey: sectionsParentKey, key: chronoFolder.path, siblingKeys }
          );
        },
      });
    }

    // Rendu des dossiers de recherche personnalisés
    for (const folder of customFolders) {
      const folderTag = foldAccents(folder.name.toLowerCase().replace(/\s+/g, "-"));
      spaces.push({
        key: folder.path,
        render: (siblingKeys) => {
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
          }, folderTag, undefined, undefined, undefined,
          { parentKey: sectionsParentKey, key: folder.path, siblingKeys }
          );
        },
      });
    }

    const orderedSpaces = applyResearchOrder(sectionsParentKey, spaces, (s) => s.key, S.researchOrder);

    if (activeSubTab === "dossiers") {
      if (orderedSpaces.length > 0) {
        body.createDiv({ cls: "feuillets-research-category-head" }).setText(t("shared.research.projectResearch"));
        const spaceSiblingKeys = orderedSpaces.map((s) => s.key);
        for (const space of orderedSpaces) {
          await space.render(spaceSiblingKeys);
        }
      }

      if (showProjectAssociations) {
        this.renderAssociatedResearchFolders(
          body,
          baseResearchFolder,
          this.scopedLinkedResearchFolders(options, null, baseResearchFolder, standardPaths)
        );
      }

      if (options.workspaceActive && options.scopeMode === "workspace" && options.workspaceFolder) {
        this.renderAssociatedResearchFolders(
          body,
          baseResearchFolder,
          this.scopedLinkedResearchFolders(options, null, baseResearchFolder, standardPaths),
          true,
          true
        );
      }
    } else {
      /* Citation analysis (Pandoc + Source-fiche occurrences) — computed
         only for the References tab, never while Dossiers is active. */
      const citationAnalysis = await analyzeResearchCitations(this.app, this.plugin.settings, documentContext);
      await this.renderReferencesTab(body, documentContext, citationAnalysis);
    }

    this.filterEntities();
  }

  /** Accessible header for the Research panel's two tabs. Folders owns the
   * physical organization, including Sources; References only exposes
   * reference actions and computed Footnotes/Bibliography. The active tab
   * is instance state on ResearchView, never a persisted setting.
   *
   * Real `<button>` elements — Enter/Space activation is native, no manual
   * key handling needed for them. ArrowLeft/ArrowRight/Home/End move focus
   * and roving `tabindex` among the tabs without activating (manual
   * activation pattern): the focused tab still needs Enter/Space/click to
   * actually switch. `instanceId` (unique per view, see
   * researchInstanceId()) keeps this tablist's ids collision-free when
   * several Research views are open at once. */
  private renderResearchSubTabs(
    container: HTMLElement,
    instanceId: string,
    activeTab: ResearchSubTab,
    onChange?: (tab: ResearchSubTab) => void
  ): void {
    const tablist = container.createDiv({ cls: "feuillets-research-subtabs" });
    tablist.setAttr("role", "tablist");
    const tabs: { key: ResearchSubTab; label: string }[] = [
      { key: "dossiers", label: t("shared.research.subtabFolders") },
      { key: "references", label: t("shared.research.subtabReferences") },
    ];
    const buttons: HTMLElement[] = tabs.map((tabDef) => {
      const isActive = tabDef.key === activeTab;
      const tabEl = tablist.createEl("button", { cls: "feuillets-research-subtab" });
      if (isActive) tabEl.addClass("is-active");
      tabEl.setAttr("type", "button");
      tabEl.setAttr("role", "tab");
      tabEl.setAttr("id", `${instanceId}-tab-${tabDef.key}`);
      tabEl.setAttr("aria-controls", `${instanceId}-tabpanel`);
      tabEl.setAttr("aria-selected", String(isActive));
      tabEl.setAttr("tabindex", isActive ? "0" : "-1");
      tabEl.setAttr("data-subtab-key", tabDef.key);
      tabEl.setText(tabDef.label);
      tabEl.addEventListener("click", () => {
        if (isActive) return;
        onChange?.(tabDef.key);
      });
      return tabEl;
    });
    buttons.forEach((button, index) => {
      button.addEventListener("keydown", (event: KeyboardEvent) => {
        let nextIndex = -1;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = buttons.length - 1;
        if (nextIndex === -1) return;
        event.preventDefault();
        button.setAttr("tabindex", "-1");
        const nextButton = buttons[nextIndex];
        nextButton.setAttr("tabindex", "0");
        nextButton.focus();
      });
    });
  }

  /** The linked-research-folder entries relevant to the CURRENT scope —
   * used to render "Recherches liées" in Dossiers. Three cases, mirroring
   * resolveResearchDocumentContext()'s own branches:
   * - associatedWorkspaceFolder set: its descendants, excluding its own
   *   subtree (mergeWorkspaceResearchFolders — unchanged registry logic);
   * - Workspace mode, scoped, no single associated folder: the folders
   *   naturally nested under the project's own Recherche root plus the
   *   ones tied to a Binder node inside this Workspace
   *   (workspaceFileResearchFolders — unchanged registry logic);
   * - otherwise (Project mode): every linked research folder in the
   *   project (computeAssociatedResearchFolders, same default as
   *   renderAssociatedResearchFolders() uses on its own). */
  private scopedLinkedResearchFolders(
    options: ResearchRenderOptions,
    associatedWorkspaceFolder: TFolder | null,
    baseResearchFolder: TFolder | null,
    standardPaths: Set<string>
  ): { folder: TFolder; binderNodes: TAbstractFile[] }[] {
    if (associatedWorkspaceFolder) {
      if (!options.workspaceFolder) return [];
      const fileFolders = this.workspaceFileResearchFolders(options.workspaceFolder);
      const branchFolders = options.activeBranchResearchFolders ?? [];
      return this.mergeWorkspaceResearchFolders(branchFolders, fileFolders).filter(({ folder }) =>
        folder.path !== associatedWorkspaceFolder.path &&
        !folder.path.startsWith(`${associatedWorkspaceFolder.path}/`)
      );
    }
    if (options.workspaceActive && options.scopeMode === "workspace" && options.workspaceFolder) {
      const naturallyLinkedWorkspaceFolders = baseResearchFolder
        ? this.plugin.getLinkedResearchFolders().filter(({ folder }) =>
          folder.path.startsWith(`${baseResearchFolder.path}/`)
          && !standardPaths.has(folder.path)
        )
        : [];
      return [...naturallyLinkedWorkspaceFolders, ...this.workspaceFileResearchFolders(options.workspaceFolder)];
    }
    return this.computeAssociatedResearchFolders(baseResearchFolder, this.plugin.getLinkedResearchFolders(), true);
  }

  /** The References tab: Notes then Bibliography, in that fixed order,
   * each rendered only when the current ResearchDocumentContext scope
   * actually has something to show — never a folder explorer, never a
   * Sources section (Sources stays purely a Dossiers concept; the
   * References toolbar's "New source sheet" action creates directly into
   * the resolved Sources folder, and stays visible in the toolbar even
   * when this tab's own content is empty). When neither section has
   * anything, a single compact empty-state message is shown instead, with
   * no leftover empty header. */
  private async renderReferencesTab(
    container: HTMLElement,
    documentContext: ResearchDocumentContext,
    citationAnalysis: ResearchCitationAnalysis
  ): Promise<void> {
    let renderedAny = false;
    if (await this.renderFootnotesOverviewSection(container, documentContext)) renderedAny = true;
    if (await this.renderBibliographySection(container, documentContext, citationAnalysis)) renderedAny = true;

    if (!renderedAny) {
      container
        .createDiv({ cls: "feuillets-research-empty feuillets-references-empty" })
        .setText(t("shared.research.noReferencesInScope"));
    }
  }

  /** Projette dans le panneau Recherche les dossiers associés depuis le
   * Binder (`researchFolderLinks`, voir plugin.getLinkedResearchFolders())
   * qui ne sont pas déjà visibles naturellement sous la racine Recherche du
   * projet — typiquement un dossier hors projet. Aucun nouveau modèle : on
   * ne fait que RENDRE une association qui existe déjà. Un même dossier associé
   * à plusieurs nœuds du Binder n'apparaît qu'une fois, avec ses
   * associations listées de façon compacte. */
  private workspaceFileResearchFolders(workspaceFolder: TFolder): { folder: TFolder; binderNodes: TAbstractFile[] }[] {
    const files = this.plugin.flattenFiles(workspaceFolder);
    const inScope = new Set(files.map((file) => file.path));
    const order = new Map(files.map((file, index) => [file.path, index]));
    return this.plugin
      .getLinkedResearchFolders()
      .map((entry) => ({
        folder: entry.folder,
        binderNodes: entry.binderNodes.filter((node) => node instanceof TFile && inScope.has(node.path)),
      }))
      .filter(({ binderNodes }) => binderNodes.length > 0)
      .sort((a, b) => {
        const aIndex = Math.min(...a.binderNodes.map((node) => order.get(node.path) ?? Number.MAX_SAFE_INTEGER));
        const bIndex = Math.min(...b.binderNodes.map((node) => order.get(node.path) ?? Number.MAX_SAFE_INTEGER));
        return aIndex - bIndex;
      });
  }

  private mergeWorkspaceResearchFolders(
    primary: { folder: TFolder; binderNodes: TAbstractFile[] }[],
    secondary: { folder: TFolder; binderNodes: TAbstractFile[] }[]
  ): { folder: TFolder; binderNodes: TAbstractFile[] }[] {
    const byPath = new Map<string, { folder: TFolder; binderNodes: TAbstractFile[] }>();
    for (const item of [...primary, ...secondary]) {
      const existing = byPath.get(item.folder.path);
      if (existing) {
        for (const node of item.binderNodes) {
          if (!existing.binderNodes.some((n) => n.path === node.path)) {
            existing.binderNodes.push(node);
          }
        }
      } else {
        byPath.set(item.folder.path, {
          folder: item.folder,
          binderNodes: [...item.binderNodes],
        });
      }
    }
    return Array.from(byPath.values());
  }

  /** The linked-research-folder entries actually associated with
   * `baseResearchFolder`'s scope — deduplicated by path, binder-node
   * associations merged — factored out of renderAssociatedResearchFolders()
   * so scopedLinkedResearchFolders() can reuse the same computation for
   * Project mode's "Recherches liées" list without re-deriving it. */
  private computeAssociatedResearchFolders(
    baseResearchFolder: TFolder | null,
    linkedFolders: { folder: TFolder; binderNodes: TAbstractFile[] }[],
    includeNestedUnderBase: boolean
  ): { folder: TFolder; binderNodes: TAbstractFile[] }[] {
    const associatedByPath = new Map<string, { folder: TFolder; binderNodes: TAbstractFile[] }>();
    const standardResearchPaths = new Set(
      ["personnages", "lieux", "evenements", "codex", "glossaire", "sources", "bibliographie"]
        .map((key) => this.findResearchCategoryFolder(baseResearchFolder?.path || "", RESEARCH_FOLDERS, key)?.path)
        .filter((path): path is string => typeof path === "string")
    );
    for (const entry of linkedFolders
      .filter(({ folder }) => {
        if (!baseResearchFolder) return true;
        if (folder.path === baseResearchFolder.path) return false;
        if (!folder.path.startsWith(`${baseResearchFolder.path}/`)) return true;
        return includeNestedUnderBase && !standardResearchPaths.has(folder.path);
      })) {
      const current = associatedByPath.get(entry.folder.path);
      if (current) current.binderNodes.push(...entry.binderNodes);
      else associatedByPath.set(entry.folder.path, {
        folder: entry.folder,
        binderNodes: [...entry.binderNodes],
      });
    }
    return [...associatedByPath.values()]
      .sort((a, b) => a.folder.name.localeCompare(b.folder.name, getLocale()));
  }

  private renderAssociatedResearchFolders(
    container: HTMLElement,
    baseResearchFolder: TFolder | null,
    linkedFolders = this.plugin.getLinkedResearchFolders(),
    grouped = true,
    includeNestedUnderBase = true
  ): void {
    const associated = this.computeAssociatedResearchFolders(baseResearchFolder, linkedFolders, includeNestedUnderBase);
    if (associated.length === 0) return;

    const S = this.plugin.settings;
    let groupBody = container;
    if (grouped) {
      const collapseKey = "research:spaces";
      const collapsed = !this.researchFilterActive && !!S.collapsed[collapseKey];
      const { section, head } = renderCollapsibleHead(container, {
        classes: {
          section: "feuillets-notes-section feuillets-research-linked-group",
          head: "feuillets-notes-section-head",
          title: "feuillets-notes-section-title",
          icon: "feuillets-notes-section-icon",
        },
        title: t("shared.research.linkedResearch"),
        icon: "layers-3",
        collapsed,
        collapseKey,
        settings: S,
        onToggle: async () => {
          await this.plugin.saveSettings();
          void this.render();
        },
      });
      head.setAttr("data-research-group", "spaces");
      if (collapsed) return;
      groupBody = section.createDiv({ cls: "feuillets-research-linked-list" });
    }

    const roots = associated.filter(({ folder }, index) =>
      !associated.some((candidate, candidateIndex) =>
        candidateIndex !== index && folder.path.startsWith(`${candidate.folder.path}/`)
      )
    );
    /* Réordonnancement visuel réservé au groupe "Espaces" affiché
       (`grouped`) : le seul contexte où ces dossiers associés apparaissent
       comme une liste de frères au même niveau — jamais pour l'appel
       "à plat" (grouped=false, imbriqué sous un dossier associé déjà
       ouvert), dont l'ordre reste alphabétique comme avant. */
    const linkedParentKey = `research-linked:${baseResearchFolder ? baseResearchFolder.path : ""}`;
    const orderedRoots = grouped
      ? applyResearchOrder(linkedParentKey, roots, (r) => r.folder.path, S.researchOrder)
      : roots;
    const rootSiblingKeys = orderedRoots.map((r) => r.folder.path);
    for (const { folder, binderNodes } of orderedRoots) {
      const labels = binderNodes
        .map((n) => (n instanceof TFile ? this.plugin.titleFor(n) : n.name))
        .sort((a, b) => a.localeCompare(b, getLocale()));
      const associationNames = labels.join(" · ");
      this.renderSection(
        groupBody,
        folder.name,
        folder,
        async () => {
          this.promptCreateResearchFileInFolder(folder);
        },
        "linked",
        undefined,
        (head) => {
          head.setAttr("title", labels.length > 0
            ? t("shared.research.associatedWith", { names: associationNames })
            : folder.path);
          if (labels.length > 1) {
            head
              .createSpan({ cls: "feuillets-research-linked-badge" })
              .setText(t("shared.research.linkedCount", { count: String(labels.length) }));
          }
        },
        undefined,
        grouped ? { parentKey: linkedParentKey, key: folder.path, siblingKeys: rootSiblingKeys } : undefined
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
    rowAction?: (menu: Menu, file: TFile) => void,
    headerExtra?: (head: HTMLElement) => void,
    external?: boolean,
    orderContext?: ResearchOrderContext
  ): void {
    const collapseKey =
      folderOrFiles instanceof TFolder
        ? folderOrFiles.path
        : `research:${title}`;
    const S = this.plugin.settings;
    const collapsed = !this.researchFilterActive && !!S.collapsed[collapseKey];

    const { section, head, titleEl } = renderCollapsibleHead(container, {
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
      onCreate: onCreate
        ? (folderOrFiles instanceof TFolder
          ? (event: MouseEvent) => this.showResearchCreateMenu(event, folderOrFiles, onCreate)
          : () => { void onCreate(); })
        : undefined,
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
       `external` reste réservé aux rubriques documentaires explicitement
       rendues en lecture seule. Les associations Binder affichées sous
       ESPACES conservent leurs actions et leurs cibles physiques. */
    if (folderOrFiles instanceof TFolder && !external) {
      const actions = this.iconBtn(head, "more-horizontal", t("shared.research.folderActions"));
      actions.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showResearchFolderContextMenu(e, folderOrFiles, orderContext);
      });
      /* Réordonnancement visuel (jamais un déplacement Vault) : seul le
         libellé devient une poignée de glisser-déposer — jamais toute la
         ligne, pour ne jamais interférer avec le mécanisme EXISTANT de
         déplacement interne (attachResearchDragSource/attachResearchDrop-
         Target, attaché à `section` juste plus bas) : voir
         attachResearchOrderHandle. */
      if (orderContext) this.attachResearchOrderHandle(titleEl, head, orderContext);
    }

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });

    /* Glisser-déposer : une rubrique adossée à un vrai dossier (pas la vue
       agrégée "Coffre") devient une cible de dépôt — on y déplace le fichier
       glissé depuis une autre rubrique. Jamais pour un dossier externe. */
    const destFolder = folderOrFiles instanceof TFolder ? folderOrFiles : null;
    if (destFolder && !external) this.attachResearchDropTarget(section, destFolder);

    if (folderOrFiles instanceof TFolder) {
      /* Afficher les sous-dossiers avant les fichiers — ordre alphabétique
         comme base déterministe (services/research-order.ts), puis l'ordre
         visuel persisté par-dessus, s'il existe. Jamais pour un dossier
         externe : ces sous-dossiers restent, comme avant, en lecture
         seule uniquement. */
      const subfolders = folderOrFiles.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name, getLocale()));
      const orderedSubfolders = external
        ? subfolders
        : applyResearchOrder(folderOrFiles.path, subfolders, (f) => f.path, S.researchOrder);
      const subfolderSiblingKeys = orderedSubfolders.map((f) => f.path);
      for (const sf of orderedSubfolders) {
        this.renderResearchSubfolder(
          list,
          sf,
          external,
          external ? undefined : { parentKey: folderOrFiles.path, key: sf.path, siblingKeys: subfolderSiblingKeys },
          rowAction
        );
      }
    }

    let files: TFile[] = [];
    if (folderOrFiles instanceof TFolder) {
      files = folderOrFiles.children
        .filter((c): c is TFile => isResearchFile(c))
        .sort((a, b) =>
          this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), getLocale())
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

  /** Affiche une ligne de fichier dans une rubrique de recherche — structure
   * volontairement réduite à 4 éléments : [type] [nom] [œil si
   * prévisualisable] […]. Plus aucun bouton chaîne ni bouton d'ouverture
   * directe : "..." regroupe désormais toutes les actions (nouvel onglet,
   * côte à côte, renommer, dupliquer, corbeille, Apparitions, citer une
   * source), jamais dupliquées ailleurs sur la ligne.
   * `external` : fichier d'un dossier associé hors racine Recherche — reste
   * glissable vers un éditeur (copie de lien, voir attachResearchDragSource),
   * mais jamais une source de déplacement interne : ne déplace jamais un
   * fichier hors de son dossier documentaire d'origine. */
  private renderResearchFileRow(
    list: HTMLElement,
    f: TFile,
    _folderOrFiles: TFolder | TFile[],
    rowAction?: (menu: Menu, file: TFile) => void,
    external?: boolean
  ): void {
    const isAttachment = isResearchAttachment(f);
    const row = list.createDiv({ cls: "feuillets-research-item" });
    this.attachResearchDragSource(row, f, !external);
    const header = row.createDiv({ cls: "feuillets-research-item-header" });

    /* Colonne type : TOUJOURS rendue, pour tout fichier Recherche — y
       compris Markdown (un dessin Excalidraw n'a pas d'icône sans ça, voir
       researchFileIcon). Exactement UN indicateur par fichier : soit
       l'icône Lucide (image, Canvas, Base, Excalidraw, ou "file-text" pour
       une fiche ordinaire), soit — pour les formats documentaires non
       Markdown dont l'icône générique ne se distingue pas d'un simple
       document — un petit indicateur textuel fixe (researchFileTypeLabel),
       jamais les deux. Largeur fixe et compacte (styles.css). */
    const iconSpan = header.createSpan({ cls: "feuillets-research-item-icon" });
    const typeLabel = researchFileTypeLabel(f);
    if (typeLabel) {
      iconSpan.addClass("feuillets-research-item-type-badge");
      iconSpan.setText(typeLabel);
    } else {
      setIcon(iconSpan, researchFileIcon(f));
    }

    /* Nom : SEUL élément cliquable de la ligne (jamais toute la ligne) —
       une fiche Markdown ouvre la vue Recherche in situ (outils de
       citation compris, voir renderFileView), une pièce jointe ouvre son
       visualiseur natif Obsidian, comportements strictement inchangés. */
    const nameEl = header.createDiv({ cls: "feuillets-research-item-name" });
    nameEl.setText(this.plugin.titleFor(f));
    nameEl.setAttr("title", this.plugin.titleFor(f));
    nameEl.addEventListener("click", (e) => {
      if (isAttachment || Keymap.isModEvent(e)) {
        openFileActivating(this.app, this.app.workspace.getLeaf(Keymap.isModEvent(e) ? true : "tab"), f);
        return;
      }
      this.viewingFile = f;
      void this.render();
    });

    /* Œil : seulement pour les formats réellement prévisualisables
       (isResearchPreviewable) — masqué (feuillets-research-item-eye,
       display: none en dehors du survol/focus, styles.css) pour ne
       réserver AUCUNE largeur tant que la ligne n'est pas sollicitée. */
    if (isResearchPreviewable(f)) {
      this.addPreviewBtn(header, f).addClass("feuillets-research-item-eye");
    }

    /* "..." : TOUJOURS présent, pour absolument tout type de fichier —
       seule commande visible en permanence (feuillets-research-item-menu-
       btn, styles.css). Regroupe toutes les actions restantes, y compris
       celles qui vivaient auparavant en boutons directs sur la ligne
       (Apparitions, citer une source) ; jamais de doublon avec l'œil ou le
       nom. Pour un dossier associé externe (lecture seule), le menu se
       limite à la navigation — voir showResearchFileContextMenu
       navigationOnly. */
    const fileActionsBtn = this.iconBtn(header, "more-horizontal", t("shared.research.folderActions"));
    fileActionsBtn.addClass("feuillets-research-item-menu-btn");
    fileActionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showResearchFileContextMenu(e, f, external, (menu) => {
        if (!isAttachment || rowAction) menu.addSeparator();
        if (!isAttachment) {
          menu.addItem((item) =>
            item
              .setTitle(t("shared.research.appearancesTooltip"))
              .setIcon("list")
              .onClick(() => { new AppearancesModal(this.app, this.plugin, f).open(); })
          );
        }
        if (rowAction) rowAction(menu, f);
      });
    });

    row.addClass("internal-link");
    row.setAttr("data-href", f.path);
    row.setAttr("data-path", f.path);
    row.setAttr("data-search", foldAccents(this.plugin.titleFor(f)));
    row.setAttr("data-tags", this.plugin.tagsOf(f).map(foldAccents).join(","));
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
    external?: boolean,
    orderContext?: ResearchOrderContext,
    rowAction?: (menu: Menu, file: TFile) => void
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
    if (typeof header.setAttribute === "function") {
      header.setAttribute("data-research-folder-path", folder.path);
    }
    header.setAttr("data-research-folder-path", folder.path);

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

    const createButton = this.iconBtn(header, "plus", t("binder.research.newFile"));
    createButton.addClass("feuillets-research-item-action");
    createButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showResearchCreateMenu(event, folder, () => this.promptCreateResearchFileInFolder(folder));
    });

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
      /* Réordonnancement visuel — poignée sur le seul libellé (jamais toute
         la ligne, déjà draggable ci-dessus pour le déplacement existant) :
         voir attachResearchOrderHandle et le commentaire équivalent dans
         renderSection. */
      if (orderContext) this.attachResearchOrderHandle(nameEl, header, orderContext);
    }

    /* Menu d'actions (⋮) identique à celui des dossiers racines — absent
       pour un dossier externe (lecture seule). */
    if (!external) {
      const actions = this.iconBtn(
        header,
        "more-horizontal",
        t("shared.research.folderActions")
      );
      actions.addClass("feuillets-research-item-menu-btn");
      actions.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showResearchFolderContextMenu(e, folder, orderContext);
      });
    } else {
      const actions = this.iconBtn(
        header,
        "more-horizontal",
        t("shared.research.folderActions")
      );
      actions.addClass("feuillets-research-item-menu-btn");
      actions.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) => item
          .setTitle(t("shared.contextMenu.rename"))
          .setIcon("pencil")
          .onClick(() => this.promptRenameResearchFolder(folder))
        );
        menu.showAtMouseEvent(e);
      });
    }

    if (collapsed) return;

    const nestedList = subItem.createDiv({
      cls: "feuillets-research-list feuillets-research-nested",
    });

    /* Rendu récursif : sous-dossiers d'abord, puis fichiers. Ordre
       alphabétique comme base déterministe, puis l'ordre visuel persisté
       (services/research-order.ts) — jamais pour un dossier externe. */
    const subfolders = folder.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name, getLocale()));
    const orderedSubfolders = external
      ? subfolders
      : applyResearchOrder(folder.path, subfolders, (f) => f.path, S.researchOrder);
    const subfolderSiblingKeys = orderedSubfolders.map((f) => f.path);
    for (const sf of orderedSubfolders) {
      this.renderResearchSubfolder(
        nestedList,
        sf,
        external,
        external ? undefined : { parentKey: folder.path, key: sf.path, siblingKeys: subfolderSiblingKeys },
        rowAction
      );
    }

    const files = folder.children
      .filter((c): c is TFile => isResearchFile(c))
      .sort((a, b) =>
        this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), getLocale())
      );
    for (const f of files) {
      this.renderResearchFileRow(nestedList, f, folder, rowAction, external);
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

  private showResearchFolderContextMenu(e: MouseEvent, folder: TFolder, orderContext?: ResearchOrderContext): void {
    const menu = new Menu();
    const linked = typeof this.plugin.getLinkedResearchFolders === "function"
      ? this.plugin.getLinkedResearchFolders()
      : [];
    const workspaceFolder = typeof this.plugin.getWorkspaceFolder === "function"
      ? this.plugin.getWorkspaceFolder()
      : null;
    const isSourcesFolder = isGenuineSourcesFolder(
      this.app,
      this.plugin.settings,
      folder,
      linked,
      workspaceFolder
    );
    if (isSourcesFolder) {
      const opLocale = getLocale();
      const defaultName = researchFolderNewName("sources", opLocale);
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.newSourceSheet"))
          .setIcon("file-plus")
          .onClick(async () => {
            this.promptCreateResearchFile(
              folder,
              defaultName,
              await getResearchTemplate(this.app, this.plugin.settings, "sources", defaultName, opLocale)
            );
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("main.cmd.insertCitation"))
          .setIcon("quote")
          .onClick(() => {
            this.plugin.openInsertCitation(null, folder);
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.importDocuments"))
          .setIcon("upload")
          .onClick(() => {
            this.promptImportFilesIntoResearchFolder(folder);
          })
      );
      menu.addSeparator();
    }
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
    menu.addItem((item) => item
      .setTitle(t("shared.contextMenu.rename"))
      .setIcon("pencil")
      .onClick(() => this.promptRenameResearchFolder(folder))
    );
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
    /* Alternative accessible/mobile au glisser-déposer (attachResearchOrder-
       Handle) : même réordonnancement purement visuel entre frères, jamais
       un déplacement Vault. "Monter" est désactivé pour le premier élément,
       "Descendre" pour le dernier — jamais absent, pour garder une forme de
       menu stable (même convention que "Coller le dossier" ci-dessus). */
    if (orderContext) {
      const index = orderContext.siblingKeys.indexOf(orderContext.key);
      const canMoveUp = index > 0;
      const canMoveDown = index >= 0 && index < orderContext.siblingKeys.length - 1;
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle(t("shared.research.moveUp")).setIcon("arrow-up");
        if (!canMoveUp) {
          item.setDisabled(true);
        } else {
          item.onClick(() => {
            const targetKey = orderContext.siblingKeys[index - 1];
            const newOrder = reorderResearchKeys(orderContext.siblingKeys, orderContext.key, targetKey, "before");
            void this.persistResearchOrder(orderContext.parentKey, newOrder);
          });
        }
      });
      menu.addItem((item) => {
        item.setTitle(t("shared.research.moveDown")).setIcon("arrow-down");
        if (!canMoveDown) {
          item.setDisabled(true);
        } else {
          item.onClick(() => {
            const targetKey = orderContext.siblingKeys[index + 1];
            const newOrder = reorderResearchKeys(orderContext.siblingKeys, orderContext.key, targetKey, "after");
            void this.persistResearchOrder(orderContext.parentKey, newOrder);
          });
        }
      });
    }
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

  /** Rend une fiche — ou un sous-dossier — de recherche déplaçable.
   *
   * `text/plain` transporte, pour un vrai fichier, de quoi le déposer
   * directement dans un éditeur Obsidian sous forme de lien
   * (researchFileLinkMarkdown, source UNIQUE partagée par tous les flux
   * d'insertion de lien encore utilisés) : le chemin Vault reste toujours
   * COMPLET pour cibler sans ambiguïté (Obsidian entretient ensuite ce
   * lien lui-même aux renommages/déplacements), mais seul le nom de
   * fichier s'affiche dans le feuillet — embed `![[chemin]]` pour une
   * image, lien aliasé `[[chemin|nom]]` pour tout le reste (PDF, DOCX,
   * ODT, EPUB, tableur, présentation, Canvas, Base, Excalidraw, Markdown).
   * `effectAllowed` vaut "copyMove" : un dépôt dans un éditeur reste une
   * COPIE de lien (jamais un déplacement du fichier, jamais hors du
   * panneau Recherche). Un sous-dossier n'a pas de lien wiki cohérent :
   * son `text/plain` reste son chemin brut. Ce payload est posé pour
   * TOUTE ligne rendue, y compris celles d'un dossier associé externe.
   *
   * `allowInternalMove` (faux pour un fichier d'un dossier externe, voir
   * renderResearchFileRow) pilote SÉPARÉMENT le déplacement INTERNE entre
   * dossiers Recherche (`_researchDragPath`, le MIME privé, lus par
   * attachResearchDropTarget) : un dossier externe reste, lui, strictement
   * jamais une source de déplacement — seul son lien peut être copié vers
   * un éditeur, le fichier documentaire d'origine ne bouge jamais. */
  attachResearchDragSource(row: HTMLElement, file: TAbstractFile, allowInternalMove = true): void {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer!.effectAllowed = "copyMove";
      e.dataTransfer!.setData(
        "text/plain",
        file instanceof TFile ? researchFileLinkMarkdown(file) : file.path
      );
      if (allowInternalMove) {
        this.plugin._researchDragPath = file.path;
        /* Correctif « drag Binder/Recherche → vrai FileNode » : UNIQUEMENT
           pour un fichier (jamais un sous-dossier, §4) — un Carnet ouvert
           qui reçoit ce MIME privé y crée un vrai FileNode Canvas (voir
           main.ts, handleCarnetFileDrop), jamais un TextNode `[[lien]]`. Le
           déplacement interne Recherche existant (`_researchDragPath`,
           attachResearchDropTarget) reste totalement inchangé. */
        if (file instanceof TFile) e.dataTransfer!.setData(FEUILLETS_FILE_DRAG_MIME, file.path);
      }
      row.addClass("feuillets-dragging");
      e.stopPropagation();
    });
    row.addEventListener("dragend", () => {
      if (allowInternalMove) this.plugin._researchDragPath = null;
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

  /** Persiste un nouvel ordre pour `parentKey` (la liste COMPLÈTE des frères,
   * dans leur nouvel ordre affiché) et rafraîchit seulement cette vue —
   * jamais toutes les vues (`plugin.renderAllViews`), même mécanique que le
   * repli/dépli (onToggle, ci-dessus) : un changement d'ordre reste, comme
   * lui, un réglage purement visuel de CETTE vue, pas une écriture dans le
   * coffre. Ne touche jamais `settings.orders` (Binder), ni le Vault. */
  private async persistResearchOrder(parentKey: string, newOrder: string[]): Promise<void> {
    this.plugin.settings.researchOrder[parentKey] = newOrder;
    await this.plugin.saveSettings();
    void this.render();
  }

  /** Rend `handleEl` (le SEUL libellé d'un espace/dossier Recherche — jamais
   * toute la ligne) glissable pour réordonner `orderContext.key` parmi ses
   * frères `orderContext.siblingKeys`, et `dropRowEl` (la ligne — en-tête —
   * de ce même espace/dossier) une cible de dépôt avant/après.
   *
   * Volontairement DISJOINT du mécanisme existant de déplacement interne
   * (attachResearchDragSource/attachResearchDropTarget, attaché à toute la
   * ligne pour les fichiers ET les sous-dossiers) : l'état de glisser
   * `_researchOrderDrag` (jamais `_researchDragPath`) et le MIME
   * RESEARCH_ORDER_DRAG_MIME (jamais FEUILLETS_FILE_DRAG_MIME ni
   * `text/plain`) garantissent qu'aucun chemin de fichier n'est jamais lu
   * comme une demande de déplacement — et réciproquement. `stopPropagation`
   * sur `dragstart` empêche aussi l'écouteur existant, posé sur un ancêtre
   * (toute la ligne), de recevoir le même geste par bouillonnement DOM
   * (même précaution que attachResearchDragSource lui-même, plus haut).
   *
   * Ne déplace jamais rien dans le Vault : seul `settings.researchOrder`
   * change, via persistResearchOrder ci-dessus. */
  private attachResearchOrderHandle(
    handleEl: HTMLElement,
    dropRowEl: HTMLElement,
    orderContext: ResearchOrderContext
  ): void {
    const clearDropIndicator = (): void => {
      dropRowEl.removeClass("feuillets-research-order-drop-before");
      dropRowEl.removeClass("feuillets-research-order-drop-after");
    };

    handleEl.addClass("feuillets-research-order-handle");
    handleEl.draggable = true;
    handleEl.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData(RESEARCH_ORDER_DRAG_MIME, orderContext.key);
      this.plugin._researchOrderDrag = { parentKey: orderContext.parentKey, key: orderContext.key };
      handleEl.addClass("feuillets-dragging");
    });
    handleEl.addEventListener("dragend", (e) => {
      e.stopPropagation();
      this.plugin._researchOrderDrag = null;
      handleEl.removeClass("feuillets-dragging");
      clearDropIndicator();
    });

    dropRowEl.addEventListener("dragover", (e) => {
      const drag = this.plugin._researchOrderDrag;
      if (!drag || drag.parentKey !== orderContext.parentKey) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "move";
      const rect = dropRowEl.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      dropRowEl.toggleClass("feuillets-research-order-drop-before", before);
      dropRowEl.toggleClass("feuillets-research-order-drop-after", !before);
    });
    dropRowEl.addEventListener("dragleave", (e) => {
      if (!(e.relatedTarget instanceof Node) || !dropRowEl.contains(e.relatedTarget)) clearDropIndicator();
    });
    dropRowEl.addEventListener("drop", (e) => {
      const drag = this.plugin._researchOrderDrag;
      this.plugin._researchOrderDrag = null;
      clearDropIndicator();
      if (!drag || drag.parentKey !== orderContext.parentKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.key === orderContext.key) return;
      const rect = dropRowEl.getBoundingClientRect();
      const position = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      const newOrder = reorderResearchKeys(orderContext.siblingKeys, drag.key, orderContext.key, position);
      void this.persistResearchOrder(orderContext.parentKey, newOrder);
    });
  }

  /** Renders one file's footnote head + rows exactly as the overview
   * always has — shared verbatim by Workspace mode's flat list and by
   * Project mode's per-group detail, so the two never drift apart. Signals
   * orphan rows both ways: a "[^N]" cited in the text with no matching
   * definition, or the reverse (defined but never cited) — often the sign
   * of text cut/pasted between scenes that broke a note. */
  private renderFootnoteFileEntries(
    list: HTMLElement,
    entries: readonly FootnoteFileEntry[],
    numbering: Map<string, string>
  ): void {
    for (const { file, rows } of entries) {
      const group = list.createDiv({ cls: "feuillets-footnotes-overview-group" });
      const head = group.createDiv({ cls: "feuillets-footnotes-overview-head" });
      head.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      head.setAttr("title", t("shared.footnotes.openSceneTooltip"));
      head.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      for (const row of rows) {
        if (row.kind === "definition") {
          const rowEl = group.createDiv({ cls: "feuillets-footnotes-overview-row" });
          rowEl.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${row.label}]`);
          rowEl.createSpan({ cls: "feuillets-footnotes-overview-text" }).setText(row.text);
          if (!row.citedElsewhere) {
            rowEl.addClass("feuillets-footnotes-overview-orphan");
            rowEl.setAttr("title", t("shared.footnotes.definedNeverCited"));
          }
        } else {
          const rowEl = group.createDiv({
            cls: "feuillets-footnotes-overview-row feuillets-footnotes-overview-orphan",
          });
          rowEl.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${row.label}]`);
          rowEl
            .createSpan({ cls: "feuillets-footnotes-overview-text" })
            .setText(t("shared.footnotes.citedNeverDefined"));
          rowEl.setAttr("title", t("shared.footnotes.citedNeverDefinedTooltip"));
        }
      }
    }
  }

  /** Renders one folder level of Project mode's footnote hierarchy as a
   * single compact tree row — chevron, truncatable label, right-aligned
   * count badge, three stable grid columns (styles.css) — never the big
   * bordered/uppercase section grammar (.feuillets-notes-section*, reserved
   * for the outer "Notes de bas de page" section and other top-level
   * panels): a folder node is a line in a tree, not a new section. Collapsed
   * by default via footnoteGroupCollapseKey() (never a raw vault path — see
   * services/research-footnotes-overview.ts); only once expanded does it
   * render its direct file entries then its child folder nodes,
   * recursively. Opening a parent never opens its children: each node reads
   * its own collapsed state independently. */
  private renderFootnoteFolderNode(
    container: HTMLElement,
    node: FootnoteFolderNode,
    numbering: Map<string, string>
  ): void {
    const S = this.plugin.settings;
    const label = node.label ?? t("shared.footnotes.rootFilesGroup");
    const nodeCollapsed = S.collapsed[node.collapseKey] !== false;

    const row = container.createDiv({ cls: "feuillets-footnotes-tree-row" });
    const toggle = row.createSpan({ cls: "feuillets-footnotes-tree-toggle" });
    setIcon(toggle, nodeCollapsed ? "chevron-right" : "chevron-down");
    const labelEl = row.createSpan({ cls: "feuillets-footnotes-tree-label" });
    labelEl.setText(label);
    labelEl.setAttr("title", label);
    row.createSpan({ cls: "feuillets-footnotes-tree-badge" }).setText(String(node.rowCount));
    row.addEventListener("click", () => {
      void (async () => {
        /* Always write an explicit value: a missing key means collapsed by
           default. Never touch settings.collapsed[node.folderPath], which
           belongs to the Binder's own folder state. */
        S.collapsed[node.collapseKey] = nodeCollapsed ? false : true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });

    if (nodeCollapsed) return;
    const children = container.createDiv({ cls: "feuillets-footnotes-tree-children feuillets-research-nested" });
    this.renderFootnoteFileEntries(children, node.directEntries, numbering);
    for (const child of node.children) {
      this.renderFootnoteFolderNode(children, child, numbering);
    }
  }

  /** Builds the outer "Notes de bas de page" section — header via
   * renderCollapsibleHead (the usual top-level panel grammar, unlike the
   * inner tree nodes above) — and, once expanded, hands its content list to
   * `renderList`. Project mode defaults to COLLAPSED (a tri-state key,
   * explicit true/false, never deleted — see renderFootnoteFolderNode's
   * same pattern); other modes keep the historical expanded-by-default,
   * delete-on-expand behavior. Returns true once a header was rendered, so
   * the caller (renderFootnotesOverviewSection) knows a section now exists
   * in the DOM even while collapsed. */
  private renderFootnotesOverviewHead(
    container: HTMLElement,
    isProjectMode: boolean,
    renderList: (list: HTMLElement) => void
  ): boolean {
    const S = this.plugin.settings;
    const collapseKey = "research:footnotes-overview";
    const collapsed = isProjectMode ? S.collapsed[collapseKey] !== false : !!S.collapsed[collapseKey];

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
        if (isProjectMode) S.collapsed[collapseKey] = collapsed ? false : true;
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    if (collapsed) return true;

    const list = section.createDiv({ cls: "feuillets-research-list" });
    renderList(list);
    return true;
  }

  /** All manuscript footnotes ("[^N]: text"), rendered only when the scope
   * contains at least one row; otherwise the entire section is absent.
   * In Workspace mode this stays the historical flat list,
   * scene by scene, built from documentContext.files alone
   * (buildFootnoteFileEntries()). In Project mode — where
   * documentContext.files can span hundreds of documents across many
   * top-level sub-projects — it becomes a compact tree following the REAL
   * folder hierarchy under documentContext.projectRoot
   * (buildFootnoteOverviewTree(), services/research-footnotes-overview.ts),
   * collapsed by default at every level, expanding one level at a time to
   * the exact same per-file rows on demand. A folder with no footnote
   * content anywhere in its own subtree never gets a node, empty or
   * otherwise. Returns whether a section was actually rendered — the
   * References tab uses this to decide its own empty state. */
  async renderFootnotesOverviewSection(container: HTMLElement, documentContext: ResearchDocumentContext): Promise<boolean> {
    const numbering = this.plugin.buildNumbering(documentContext.scopeRoot);
    const files = documentContext.files
      .filter((file): file is TFile => file instanceof TFile && file.extension === "md")
      .sort((a, b) => (Number(numbering.get(a.path)) || 0) - (Number(numbering.get(b.path)) || 0));

    if (documentContext.mode !== "project") {
      const entries = await buildFootnoteFileEntries(this.app, files);
      if (entries.length === 0) return false;
      return this.renderFootnotesOverviewHead(container, false, (list) => {
        this.renderFootnoteFileEntries(list, entries, numbering);
      });
    }

    const tree = await buildFootnoteOverviewTree(this.app, documentContext.projectRoot, files);
    if (tree.length === 0) return false;
    return this.renderFootnotesOverviewHead(container, true, (list) => {
      const treeContainer = list.createDiv({ cls: "feuillets-footnotes-tree" });
      for (const node of tree) {
        this.renderFootnoteFolderNode(treeContainer, node, numbering);
      }
    });
  }

  /** "Bibliography" as an AGGREGATOR, not a folder of manual fiches: the
   * list of Source fiches actually cited at least once within the current
   * document scope (documentContext), sorted by author — distinct from
   * "every fiche" (a source can exist in the working library without ever
   * being cited in this scope's text). Which fiche a citation points to is
   * decided ONLY by citationAnalysis.sourceCitationCounts (registry
   * occurrences, keyed by sourcePath, strictly localized to
   * documentContext.files) — never by which Sources/Bibliographie folder
   * happens to be visible in this render branch, so a Source living in a
   * different (but still cited) Recherche is never silently dropped. The
   * per-Source-fiche counter is that same map, in every mode — never
   * fm.cite_count, which remains a global, potentially stale counter and
   * is no longer read here. The "Generate" button writes the final
   * bibliography file
   * (plugin.generateBibliographyFile), passed a snapshot of exactly the
   * cited fiches and resolved BibTeX entries this render pass displays —
   * the generator itself never re-resolves a scope or re-scans anything;
   * that generation logic stays out of scope here. Renders NOTHING — no
   * header, no empty-state message — when the scope has no cited Source,
   * no resolved BibTeX entry and no unknown citekey; returns whether a
   * section was actually rendered, so the References tab can decide its
   * own empty state. The "Generate" row appears in BOTH Project and
   * Workspace mode, as soon as the section has a displayable entry —
   * Bibliographie.md stays a single project-wide output file either way
   * (generateBibliographyFile() itself is unchanged); only its label
   * names which scope produced the snapshot. */
  async renderBibliographySection(
    container: HTMLElement,
    documentContext: ResearchDocumentContext,
    citationAnalysis: ResearchCitationAnalysis
  ): Promise<boolean> {
    /* The citation registry (citationAnalysis.sourceCitationCounts, keyed
       by normalized sourcePath) is the sole authority on which Source
       fiche a valid occurrence points to — never the Sources/Bibliographie
       folder(s) happening to be visible in this render branch, so a
       citation to a Source living in a different Recherche is never
       silently dropped. A path that no longer resolves to an existing
       Markdown file (deleted, a folder, an attachment) is skipped; paths
       are deduplicated after normalization. */
    const cited: TFile[] = [];
    const seenSourcePaths = new Set<string>();
    for (const sourcePath of citationAnalysis.sourceCitationCounts.keys()) {
      const normalizedPath = normalizePath(sourcePath);
      if (seenSourcePaths.has(normalizedPath)) continue;
      seenSourcePaths.add(normalizedPath);
      const candidate = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (candidate instanceof TFile && candidate.extension === "md") {
        cited.push(candidate);
      }
    }
    const sourceCountFor = (f: TFile): number => citationAnalysis.sourceCitationCounts.get(f.path) || 0;

    const bibtexResult = await collectDocumentScopeCitedBibtexEntries(
      this.app,
      this.plugin.settings,
      documentContext.projectRoot,
      documentContext.scopeRoot,
      citationAnalysis.citekeyCounts
    );

    if (
      cited.length === 0 &&
      bibtexResult.knownEntries.length === 0 &&
      bibtexResult.unknownKeys.length === 0
    ) {
      return false;
    }

    const S = this.plugin.settings;
    const collapseKey = "research:cited-sources";
    const collapsed = Boolean(S?.collapsed?.[collapseKey]);

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
    if (collapsed) return true;
    const sectionEl = section;

    /* Available in BOTH scopes as soon as the section has at least one
       displayable entry — the label alone names the scope, never the
       button's presence. The write target stays the single project-wide
       Bibliographie.md either way (generateBibliographyFile() is
       unchanged); in Workspace mode this simply overwrites it with the
       Workspace-scoped snapshot the user is currently looking at. */
    const generateLabel = documentContext.mode === "project"
      ? t("shared.bibliography.generateProject")
      : t("shared.bibliography.generateWorkspace");
    const exportRow = sectionEl.createEl("button", { cls: "feuillets-bibliography-export-row" });
    exportRow.setAttr("type", "button");
    exportRow.setAttr("title", t("shared.bibliography.exportTooltip"));
    exportRow.setAttr("aria-label", generateLabel);
    const exportIcon = exportRow.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(exportIcon, "file-output");
    exportRow.createSpan().setText(generateLabel);

    /* Closes over a snapshot of exactly what this render pass displays —
       the same Sources fiches (`cited`) and the same resolved BibTeX
       entries — copied so a later mutation of `cited` or of the result
       arrays can never change what a pending click writes. `documentContext`
       was itself resolved once by ResearchView.render() (never re-derived
       from the active file), so this is always the exact scope currently
       shown, Project or Workspace. */
    const generationInput: ResearchBibliographyGenerationInput = {
      projectRoot: documentContext.projectRoot,
      sourceFiles: [...cited],
      bibtexEntries: [...bibtexResult.allBibliographyEntries],
    };
    exportRow.addEventListener("click", () => { void this.plugin.generateBibliographyFile(generationInput); });

    const list = sectionEl.createDiv({ cls: "feuillets-research-list" });

    const sorted = [...cited].sort((a, b) => {
      const authorA = this.plugin.fmOf(a).author;
      const authorB = this.plugin.fmOf(b).author;
      return (typeof authorA === "string" ? authorA : "").localeCompare(typeof authorB === "string" ? authorB : "", getLocale());
    });
    for (const f of sorted) {
      const row = list.createDiv({ cls: "feuillets-research-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = sourceCountFor(f);
      header
        .createDiv({ cls: "feuillets-research-item-name" })
        .setText(t("shared.bibliography.citationCount", { title: this.plugin.titleFor(f), count: String(n), s: n > 1 ? "s" : "" }));
      row.addEventListener("click", () => {
        this.viewingFile = f;
        void this.render();
      });
    }

    for (const item of bibtexResult.knownEntries) {
      const row = list.createDiv({ cls: "feuillets-research-item feuillets-bibtex-citation-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = item.count;
      const entry = item.entry;
      const authorPart = entry?.author || (entry?.authors && entry.authors.length > 0 ? entry.authors.join(", ") : "");
      const yearPart = entry?.year || entry?.date || "";
      const titlePart = entry?.title ? ` — ${entry.title}` : "";
      const details = [authorPart, yearPart ? `(${yearPart})` : ""].filter(Boolean).join(" ");
      const displayDetails = details ? `${details}${titlePart}` : (entry?.title || "");
      const label = displayDetails
        ? t("shared.bibliography.bibtexCitationCount", {
            key: item.key,
            details: displayDetails,
            count: String(n),
            s: n > 1 ? "s" : "",
          })
        : `@${item.key} (${n} citation${n > 1 ? "s" : ""})`;
      header.createDiv({ cls: "feuillets-research-item-name" }).setText(label);
    }

    for (const item of bibtexResult.unknownKeys) {
      const row = list.createDiv({ cls: "feuillets-research-item feuillets-bibtex-unknown-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = item.count;
      const warningLabel = t("shared.bibliography.unknownCitekeyWarning", {
        key: item.key,
        count: String(n),
        s: n > 1 ? "s" : "",
      });
      const nameEl = header.createDiv({ cls: "feuillets-research-item-name feuillets-citekey-warning" });
      nameEl.setText(warningLabel);
    }
    return true;
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

  showFileContextMenu(e: MouseEvent, file: TFile, parent: ProjectNode, index: number, _siblings: ProjectNode[], binderRename = false): void {
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
      (typeof plugin.isValidEditorialRootPath === "function"
        ? plugin.isValidEditorialRootPath(centralContinu.compileScope.projectRoot)
        : (continuProjectRoot && centralContinu.compileScope.projectRoot === continuProjectRoot.path)) &&
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
            const paths = Array.from(groupSel || []);
            const scope = typeof plugin.compileScopeForSelection === "function"
              ? plugin.compileScopeForSelection(paths)
              : createSelectionScope(projectRoot.path, paths);
            if (!scope) return;
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
            const paths = Array.from(groupSel || []);
            const scope = typeof plugin.compileScopeForSelection === "function"
              ? plugin.compileScopeForSelection(paths)
              : createSelectionScope(projectRoot.path, paths);
            if (!scope) return;
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
    if (isGroup) {
      menu.addItem((item) => item.setTitle(t("shared.contextMenu.groupSelected", { count: String(groupFiles.length) })).setDisabled(true));
    }
    menu.addSeparator();

    /* Structure : Carnet et création. */
    if (isGroup) {
      const selectedPaths = [...groupSel];
      const allAdmissible = selectedPaths.every((p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        return f instanceof TFile && this.plugin.isSceneFile(f);
      });
      if (allAdmissible) {
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
      }
    } else if (file.extension === "md" && file.path.startsWith(`${this.plugin.getProjectFolder()?.path || "\0"}/`)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.addToNotebook"))
          .setIcon("notebook")
          .onClick(() => { void this.plugin.addFileToNotebook(file); })
      );
    }

    menu.addItem((item) => item.setTitle(t("shared.contextMenu.newSheetMenu")).setIcon("file-plus").onClick((evt) =>
      showChoices(evt, e, (choices) => {
        choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetBefore")).setIcon("corner-left-up").onClick(() => plugin.newSheetAt(asFolder(parent), index)));
        choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetAfter")).setIcon("corner-left-down").onClick(() => plugin.newSheetAt(asFolder(parent), index + 1)));
      })
    ));
    menu.addSeparator();
    const currentStatus = (this.fm(file).status as string) || "";
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeStatusMenu")).setIcon("circle-dot").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const status of workspaceStatuses(this.app, this.plugin.settings, file.parent)) {
      const st = statusStoredValue(status).trim();
      if (!st) continue;
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: statusDisplayLabel(status, getLocale()) }))
          .setChecked(!isGroup && st === currentStatus)
          .onClick(async () => {
            if (isGroup) await this.applyBulkStatus(groupFiles, st);
            else await this.setFm(file, "status", st === currentStatus ? "" : st);
          })
      );
    }
    })));
    const currentLabel = plugin.labelOf(file);
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeLabelMenu")).setIcon("tag").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const labelEntry of this.getProjectLabels(file.parent)) {
      const l = labelStoredValue(labelEntry).trim();
      if (!l) continue;
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.labelLabel", { label: labelDisplayLabel(labelEntry, getLocale()) }))
          .setChecked(!isGroup && l === currentLabel)
          .onClick(async () => {
            if (isGroup) await this.applyBulkLabel(groupFiles, l);
            else await this.setFm(file, "label", l === currentLabel ? "" : l);
          })
      );
    }
    })));
    if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.addTagToGroup"))
          .setIcon("tag")
          .onClick(() => this.promptBulkTag(groupFiles, () => { void this.render(); }))
      );
    }

    menu.addItem((item) => item.setTitle(t("binder.research.associatedResearchMenu")).setIcon("search").onClick((evt) =>
      showChoices(evt, e, (choices) => this.addBinderResearchActions(choices, file, researchName))
    ));
    menu.addSeparator();
    if (binderRename) {
      menu.addItem((item) => item
        .setTitle(t("shared.contextMenu.rename"))
        .setIcon("pencil")
        .onClick(() => this.promptRenameBinderFile(file))
      );
    }
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
    /* « Déplacer vers un projet… » : uniquement pour un brouillon
       (_Feuillets/Drafts) — un feuillet du manuscrit se déplace déjà par
       glisser-déposer ou « Déplacer » ci-dessus, jamais entre projets. */
    if (isGroup === false && isProjectDraft(plugin.getProjectFolder(), file)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.moveToProject"))
          .setIcon("folder-symlink")
          .onClick(() => {
            new MoveDraftToProjectModal(this.app, plugin, file).open();
          })
      );
    }
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
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.versions")).setIcon("history").onClick((evt) => showChoices(evt, e, (choices) => {
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
    menu.addSeparator();

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
              const paths = selectedFiles.map((f) => f.path);
              const scope = (typeof plugin.compileScopeForSelection === "function" ? plugin.compileScopeForSelection(paths) : null)
                ?? createSelectionScope(projectRoot.path, paths);
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
              const scope = (typeof plugin.compileScopeForFile === "function" ? plugin.compileScopeForFile(file) : null)
                ?? createFileScope(projectRoot.path, file.path);
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
  showFolderContextMenu(e: MouseEvent, folder: TFolder, _parent: ProjectNode, _index: number, _siblings: ProjectNode[], extraItems?: (menu: Menu) => void, binderRename = false): void {
    const menu = new Menu();
    const plugin = this.plugin;

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.openWithPreview"))
        .setIcon("eye")
        .onClick(async () => {
          const scope = typeof plugin.compileScopeForFolder === "function"
            ? plugin.compileScopeForFolder(folder)
            : (plugin.getProjectFolder() ? createFolderScope(plugin.getProjectFolder()!.path, folder.path) : null);
          if (!scope) return;
          await this.openScopeWithContinuAndPreview(scope);
        })
    );
    extraItems?.(menu);
    this.addFolderCarnetMenuItem(menu, folder);
    menu.addSeparator();

    /* Structure : Carnet, note de dossier et création. */
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.openFolderNote"))
        .setIcon("notebook-text")
        .onClick(async () => {
          const note = await plugin.getOrCreateFolderNote(folder);
          openFileActivating(this.app, this.app.workspace.getLeaf(false), note);
        })
    );
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.newMenu")).setIcon("plus").onClick((evt) => showChoices(evt, e, (choices) => {
      choices.addItem((choice) => choice.setTitle(t("shared.contextMenu.newSheetInside")).setIcon("file-plus").onClick(() => plugin.newSheet(folder)));
      choices.addItem((choice) => choice.setTitle(t("binder.newSubfolder")).setIcon("folder-plus").onClick(() => plugin.newFolder(folder)));
    })));
    menu.addSeparator();

    const note = plugin.folderNoteFor(folder);
    const currentStatus = note ? ((this.fm(note).status as string) || "") : "";
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeStatusMenu")).setIcon("circle-dot").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const status of workspaceStatuses(this.app, plugin.settings, folder)) {
      const st = statusStoredValue(status).trim();
      if (!st) continue;
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: statusDisplayLabel(status, getLocale()) }))
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
    const currentLabel = note ? plugin.labelOf(note) : "";
    menu.addItem((item) => item.setTitle(t("shared.contextMenu.changeLabelMenu")).setIcon("tag").onClick((evt) => showChoices(evt, e, (choices) => {
    for (const labelEntry of this.getProjectLabels(folder)) {
      const l = labelStoredValue(labelEntry).trim();
      if (!l) continue;
      choices.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.labelLabel", { label: labelDisplayLabel(labelEntry, getLocale()) }))
          .setChecked(l === currentLabel)
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) {
              await this.setFm(targetNote, "label", l === currentLabel ? "" : l);
            }
          })
      );
    }
    })));
    menu.addItem((item) => item.setTitle(t("binder.research.associatedResearchMenu")).setIcon("search").onClick((evt) =>
      showChoices(evt, e, (choices) => this.addBinderResearchActions(choices, folder, folder.name))
    ));
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.renameFolder"))
        .setIcon("pencil")
        .onClick(async () => {
          if (binderRename) {
            this.promptRenameBinderFolder(folder);
            return;
          }
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
          const scope = typeof plugin.compileScopeForFolder === "function"
            ? plugin.compileScopeForFolder(folder)
            : (plugin.getProjectFolder() ? createFolderScope(plugin.getProjectFolder()!.path, folder.path) : null);
          if (!scope) {
            new Notice(t("main.notice.projectFolderNotFound"));
            return;
          }
          const modal = new ExportModal(this.app, plugin, {
            type: "folder",
            name: folder.name,
            folderPath: folder.path,
          });
          modal.setOnSubmit(async (format: string, name: string) => {
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
    return isNaN(g) ? workspaceWordGoalDefault(this.app, this.plugin.settings, file.parent) : g;
  }

  ringState(wc: number, goal: number, folder: TFolder | null = null): "none" | "hit" | "over" | "under" {
    const tol = workspaceTolerance(this.app, this.plugin.settings, folder);
    if (goal <= 0) return "none";
    if (wc >= goal - tol && wc <= goal + tol) return "hit";
    if (wc > goal + tol) return "over";
    return "under";
  }

  fillRing(ring: HTMLElement, wc: number, goal: number, folder: TFolder | null = null): void {
    const pct = goal > 0 ? Math.min(100, Math.round((wc / goal) * 100)) : 0;
    ring.style.setProperty("--pct", `${pct}%`);
    ring.removeClass("feuillets-ring-hit");
    ring.removeClass("feuillets-ring-over");
    const state = this.ringState(wc, goal, folder);
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
