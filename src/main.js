/* Feuillets 2.0 — écriture longue façon Scrivener/Ulysses pour Obsidian.
 *
 * Structure : PARTIES (dossiers racine) → CHAPITRES (sous-dossiers)
 *             → SCÈNES (fichiers .md). Niveaux 1 et 3 facultatifs :
 *             fichiers à la racine ou dans une partie = chapitres simples.
 *
 * Compilation : Manuscrit.md = parties, chapitres, textes des scènes.
 * Les noms techniques des fichiers ne sont JAMAIS repris à la compilation :
 * seuls les noms de dossiers et la clé `titre` du frontmatter sont utilisés.
 *
 * Frontmatter par scène : titre, ordre, synopsis, statut, objectif, tags.
 * Objectif des chapitres (dossiers) : stocké dans les réglages du plugin.
 */

import { DEFAULT_SETTINGS } from "./default-settings.js";
import { VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW, VIEW_SIDEBAR_FEUILLETS, getStatusColor, HIDEABLE_PANELS } from "./constants.js";
import { countWords, foldAccents, escapeRegExp, embedHardBreaks, todayKey, parseStoryDate, compactLineBreaks, frenchTypography } from "./utils/core.js";
import { stripWritingNoise, countSentences, countParagraphs, formatNumber } from "./utils/text-metrics.js";
import { nextFootnoteNumber, renumberFootnotes } from "./utils/footnotes.js";
import { highlightActive, isEditing, openFileActivating } from "./utils/dom.js";
import { NotesView } from "./views/notes-view.js";
import { PropertiesView } from "./views/properties-view.js";
import { ResearchView } from "./views/research-view.js";
import { JournalView } from "./views/journal-view.js";
import { ProjectView } from "./views/project-view.js";
import { CitationSourceModal, promptForPage } from "./ui/citation-modal.js";
import { formatCitation } from "./services/citations.js";
import { getResearchTemplate } from "./services/research-templates.js";
import { BaseFeuilletsView } from "./views/base-feuillets-view.js";
import { FeuilletsView } from "./views/feuillets-view.js";
import { BoardView } from "./views/board-view.js";
import { SidebarFeuilletsView } from "./views/sidebar-feuillets-view.js";
import { FeuilletsSettingTab } from "./settings/feuillets-setting-tab.js";
import { initScenesEditor } from "./scenes-editor.js";
import { folderNoteFor, getOrCreateFolderNote } from "./services/folder-notes.js";
import { fmOf, titleFor, shortTitleFor, compiledTitleFor, tagsOf, labelOf, labelsOf, labelColor, folderGoal } from "./services/frontmatter.js";
import { getProjectFolder, projectDisplayName, depthOf, isFrontMatter, roleOfFolder, roleOfFile, getOrderedChildren, flattenFiles, chapterCount, getChapters } from "./services/folder-structure.js";
import { getProjectMode } from "./services/project-mode.js";
import { getChronoFolder, getResearchRoot, maybeRenameResearchFile, entityMatchTags, entityMatchNames, findAppearances } from "./services/research.js";
import { buildNumbering } from "./services/numbering.js";
import { orderFromSnapshot } from "./utils/sibling-order.js";
import { handleFilChanged } from "./services/narrative-threads.js";
import { createDemoProject } from "./services/demo-project.js";
import { generateCanvasBoard } from "./services/canvas-board.js";
import { ensureFolder, snapshotFile, listSnapshotFiles, initProjectStructure, newFolder, newSheet, duplicateProjectFolder, getVersionsRoot } from "./services/project-files.js";
import { createProjectBackup } from "./services/project-backup.js";
import { exportBuiltInTemplates } from "./services/export-templates-custom.js";
import { activePresetConfig, getOutputFolder, compile, exportFile, projectMetaFor, listCompiledFilePaths } from "./services/compile-export.js";
import { ensureDayEntry, compileJournal } from "./services/journal.js";
import { matchesResearchLabel } from "./utils/project-modes.js";
import { setLocale, detectLocale, t } from "./i18n/index.js";
import { ImportOutlineModal } from "./ui/import-outline-modal.js";
import { NewProjectModal, DuplicateVersionModal } from "./ui/project-modals.js";
import { ProjectPropertiesModal, ProjectTagsModal } from "./ui/project-properties-modals.js";
import { ScrivenerImportModal } from "./ui/scrivener-import-modal.js";
import { DocxReviewView } from "./views/docx-review-view.js";
import { NewSheetModal, NewFolderModal } from "./ui/basic-modals.js";
import { FileStatsModal } from "./ui/stats-modal.js";
import { PdfStyleModal } from "./ui/pdf-style-modal.js";
import { SearchReplaceBar } from "./views/search-replace-bar.js";
import { searchHighlightField } from "./utils/cm-search-highlighter.js";
import { grammarIssuesField, grammarClickHandler } from "./utils/cm-grammar-highlighter.js";
import { GrammalecteChecker } from "./services/grammalecte-checker.js";
import { HarperChecker } from "./services/harper-checker.js";
import { GrammarCheckerManager } from "./services/grammar-checker-manager.js";
import { GrammarUserData } from "./services/grammar-user-data.js";

const {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  Notice,
  Modal,
  normalizePath,
  setIcon,
  Menu,
  MarkdownRenderer,
  MarkdownView,
  Platform,
  Keymap,
  setTooltip,
} = require("obsidian");

const RIGHT_SIDEBAR_WIDTH = 280;

class FeuilletsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    setLocale(detectLocale(this.settings));

    this.registerViews();
    this.registerHoverLinkSource("feuillets", { display: "Feuillets", defaultMod: false });
    this.registerRibbonIcons();
    this.registerCoreCommands();
    this.registerLastEditorTracking();

    this.addSettingTab(new FeuilletsSettingTab(this.app, this));

    this.applyIndentClass();
    this.applyLeanInterfaceClasses();

    this.registerAutoOpenPanels();
    this.registerConcentrationTracking();
    this.registerDragSafetyNet();
    this.registerLiveTypography();
    this.registerStatusBar();
    this.registerTextEditingCommands();
    this.registerVaultEvents();
    this.patchTabTitles();
    this.registerSwipeGestures();
    this.registerAutoBackup();
    this.registerEditorExtension(searchHighlightField);
    this.registerEditorExtension(grammarIssuesField);
    this.registerEditorExtension(grammarClickHandler(this));

    // worker_threads = Node : indisponible sur mobile (voir GrammarCheckerManager).
    if (!Platform.isMobile) {
      this.grammalecteChecker = new GrammalecteChecker(this.app, this.manifest);
      this.harperChecker = new HarperChecker(this.app, this.manifest);
      this.grammarUserData = new GrammarUserData(this.app, this.manifest);
      if (this.grammarUserData.migrateFromSettings(this.settings)) await this.saveSettings();
    }
    this.grammarCheckerManager = new GrammarCheckerManager(this.app, this.manifest, this.grammalecteChecker, this.harperChecker, this.grammarUserData);

    initScenesEditor(this);
  }

  registerViews() {
    this.registerView(VIEW_SIDEBAR, (leaf) => new FeuilletsView(leaf, this));
    this.registerView(VIEW_BOARD, (leaf) => new BoardView(leaf, this));
    this.registerView(VIEW_NOTES, (leaf) => new NotesView(leaf, this));
    this.registerView(VIEW_PROPERTIES, (leaf) => new PropertiesView(leaf, this));
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.registerView(VIEW_JOURNAL, (leaf) => new JournalView(leaf, this));
    this.registerView(VIEW_PROJECT, (leaf) => new ProjectView(leaf, this));
    this.registerView(VIEW_DOCX_REVIEW, (leaf) => new DocxReviewView(leaf, this));
    this.registerView(VIEW_SIDEBAR_FEUILLETS, (leaf) => new SidebarFeuilletsView(leaf, this));
  }

  registerRibbonIcons() {
    this._ribbonDefs = [
      { key: "sidebar", icon: "files", labelKey: "main.ribbon.binder", action: () => this.activateSidebar() },
      { key: "board", icon: "layout-grid", labelKey: "main.ribbon.board", action: () => this.activateBoard() },
      { key: "journal", icon: "calendar", labelKey: "main.ribbon.journal", action: () => this.activateJournal(), hideable: true },
      { key: "project", icon: "folder-cog", labelKey: "main.ribbon.project", action: () => this.activateProject(), hideable: true },
      { key: "concentration", icon: "focus", labelKey: "settings.section.focusMode", action: () => this.toggleConcentration() },
    ];
    this._ribbonEls = {};
    this.refreshRibbonIcons();
  }

  refreshRibbonIcons() {
    const hidden = new Set(this.settings.hiddenPanels || []);
    for (const def of this._ribbonDefs) {
      const shouldShow = !def.hideable || !hidden.has(def.key);
      const existing = this._ribbonEls[def.key];
      if (shouldShow && !existing) {
        this._ribbonEls[def.key] = this.addRibbonIcon(def.icon, t(def.labelKey), def.action);
      } else if (!shouldShow && existing) {
        existing.remove();
        delete this._ribbonEls[def.key];
      } else if (shouldShow && existing) {
        // Langue changée entre-temps : la tooltip existante doit suivre.
        setTooltip(existing, t(def.labelKey));
      }
    }
  }

  isPanelHidden(key) {
    return (this.settings.hiddenPanels || []).includes(key);
  }

  async hidePanel(key) {
    const set = new Set(this.settings.hiddenPanels || []);
    set.add(key);
    this.settings.hiddenPanels = [...set];
    await this.saveSettings();
    this.refreshRibbonIcons();
    const def = HIDEABLE_PANELS.find((p) => p.key === key);
    if (def) {
      this.app.workspace.getLeavesOfType(def.view).forEach((l) => l.detach());
    }
  }

  registerCoreCommands() {
    this.addCommand({
      id: "open-feuillets",
      name: t("main.cmd.openBinder"),
      callback: () => this.activateSidebar(),
    });
    this.addCommand({
      id: "open-board",
      name: t("main.cmd.openBoard"),
      callback: () => this.activateBoard(),
    });
    this.addCommand({
      id: "open-progression",
      name: t("main.cmd.openStatsPanel"),
      callback: () => {
        if (this.isPanelHidden("journal")) {
          new Notice(t("main.notice.journalPanelHidden"));
          return;
        }
        this.activateJournal();
      },
    });
    this.addCommand({
      id: "open-journal",
      name: t("main.cmd.openJournal"),
      callback: () => {
        if (this.isPanelHidden("journal")) {
          new Notice(t("main.notice.journalPanelHidden"));
          return;
        }
        this.activateJournal();
      },
    });
    this.addCommand({
      id: "open-project",
      name: t("main.cmd.openProjectPanel"),
      callback: () => {
        if (this.isPanelHidden("project")) {
          new Notice(t("main.notice.projectPanelHidden"));
          return;
        }
        this.activateProject();
      },
    });
    this.addCommand({
      id: "open-export",
      name: t("main.cmd.openCompileExportPanel"),
      callback: () => {
        if (this.isPanelHidden("project")) {
          new Notice(t("main.notice.projectPanelHidden"));
          return;
        }
        this.activateProject();
      },
    });
    this.addCommand({
      id: "open-properties",
      name: t("main.cmd.projectProperties"),
      // Panneau retiré (fusionné dans l'onglet Notes) — ouvre directement
      // la fenêtre flottante, comme les icônes de la section "Propriétés
      // du fichier" (voir notes-view.js).
      callback: () => new ProjectPropertiesModal(this.app, this).open(),
    });
    this.addCommand({
      id: "open-project-tags",
      name: t("main.cmd.projectTags"),
      callback: () => new ProjectTagsModal(this.app, this).open(),
    });
    this.addCommand({
      id: "grammalecte-check-active-file",
      name: t("main.cmd.grammarCheckActiveFile"),
      callback: () => {
        if (!this._grammarView) {
          new Notice(t("main.notice.openSidebarFirst"));
          return;
        }
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(t("main.notice.openSheetToCheck"));
          return;
        }
        // Ne nécessite pas d'avoir l'onglet ouvert/actif : lance la
        // vérification et le soulignement dans l'éditeur directement.
        this._grammarView.runCheck(file);
      },
    });
    this.addCommand({
      id: "grammalecte-next-issue",
      name: t("main.cmd.grammarNextIssue"),
      callback: () => {
        if (!this._grammarView) {
          new Notice(t("main.notice.openGrammarTabFirst"));
          return;
        }
        this._grammarView.jumpToAdjacentIssue(1);
      },
    });
    this.addCommand({
      id: "grammalecte-prev-issue",
      name: t("main.cmd.grammarPrevIssue"),
      callback: () => {
        if (!this._grammarView) {
          new Notice(t("main.notice.openGrammarTabFirst"));
          return;
        }
        this._grammarView.jumpToAdjacentIssue(-1);
      },
    });
    this.addCommand({
      id: "compile-manuscript",
      name: t("main.cmd.compileManuscript"),
      callback: () => this.compile(),
    });
    this.addCommand({
      id: "compile-journal",
      name: t("main.cmd.compileJournal"),
      callback: () => this.compileJournal(),
    });
    this.addCommand({
      id: "export-docx",
      name: t("main.cmd.exportDocx"),
      callback: () => this.exportFile("docx"),
    });
    this.addCommand({
      id: "export-epub",
      name: t("main.cmd.exportEpub"),
      callback: () => this.exportFile("epub"),
    });
    this.addCommand({
      id: "export-pdf",
      name: t("main.cmd.exportPdf"),
      callback: () => this.exportFile("pdf"),
    });
    this.addCommand({
      id: "import-outline",
      name: t("main.cmd.importOutline"),
      callback: () => new ImportOutlineModal(this.app, this).open(),
    });
    this.addCommand({
      id: "undo-move",
      name: t("main.cmd.undoMove"),
      callback: async () => {
        if (!this.moveStack || this.moveStack.length === 0) {
          new Notice(t("main.notice.nothingToUndo"));
          return;
        }
        const snap = this.moveStack.pop();

        if (snap.type === "move") {
          const srcParent = this.app.vault.getAbstractFileByPath(snap.srcParentPath);
          const destFolder = this.app.vault.getAbstractFileByPath(snap.destFolderPath);
          const node = this.app.vault.getAbstractFileByPath(normalizePath(`${snap.destFolderPath}/${snap.nodeName}`));
          if (!(srcParent instanceof TFolder) || !(destFolder instanceof TFolder) || !node) {
            new Notice(t("main.notice.undoImpossibleChanged"));
            return;
          }
          const backPath = normalizePath(`${snap.srcParentPath}/${snap.nodeName}`);
          if (this.app.vault.getAbstractFileByPath(backPath)) {
            new Notice(t("main.notice.undoImpossibleNameTaken"));
            return;
          }
          await this.app.fileManager.renameFile(node, backPath);
          await this.writeOrder(srcParent, this.orderFromSnapshot(srcParent, snap.srcOrder));
          await this.writeOrder(destFolder, this.orderFromSnapshot(destFolder, snap.destOrder));
          if (this.settings.autoRename) {
            const root = this.getProjectFolder();
            if (root) await this.renumberTitles(root);
          }
          this.renderAllViews(true);
          new Notice(t("main.notice.crossFolderMoveUndone"));
          return;
        }

        const parent = this.app.vault.getAbstractFileByPath(snap.parentPath);
        if (!(parent instanceof TFolder)) {
          new Notice(t("main.notice.moveFolderGone"));
          return;
        }
        await this.applySiblingOrder(parent, this.orderFromSnapshot(parent, snap.order), false);
        this.renderAllViews(true);
        new Notice(t("main.notice.reorderUndone"));
      },
    });
    this.addCommand({
      id: "toggle-concentration",
      name: t("main.cmd.toggleConcentration"),
      callback: () => this.toggleConcentration(),
    });
    this.addCommand({
      id: "create-project",
      name: t("main.cmd.createProject"),
      callback: () => new NewProjectModal(this.app, this).open(),
    });
    this.addCommand({
      id: "create-demo-project",
      name: t("main.cmd.createDemoProject"),
      callback: () => {
        const menu = new Menu();
        menu.addItem((item) =>
          item.setTitle(t("settings.demoProject.elira")).onClick(() => this.createDemoProject("elira"))
        );
        menu.addItem((item) =>
          item
            .setTitle(t("settings.demoProject.candide"))
            .onClick(() => this.createDemoProject("candide"))
        );
        menu.showAtPosition({ x: window.innerWidth / 2, y: 80 });
      },
    });
    this.addCommand({
      id: "import-scrivener",
      name: t("main.cmd.importScrivener"),
      callback: () => {
        if (Platform.isMobile) {
          new Notice(t("main.notice.scrivenerDesktopOnly"));
          return;
        }
        new ScrivenerImportModal(this.app, this).open();
      },
    });
    this.addCommand({
      id: "open-docx-review",
      name: t("main.cmd.openDocxReview"),
      callback: () => {
        if (this.isPanelHidden("docxReview")) {
          new Notice(t("main.notice.reviewPanelHidden"));
          return;
        }
        this.activateDocxReview();
      },
    });
    this.addCommand({
      id: "generate-canvas-board",
      name: t("main.cmd.generateCanvasBoard"),
      callback: () => this.generateCanvasBoard(),
    });
    this.addCommand({
      id: "manage-projects",
      name: t("main.cmd.manageProjects"),
      callback: () => {
        if (this.isPanelHidden("project")) {
          new Notice(t("main.notice.projectPanelHidden"));
          return;
        }
        this.activateProject();
      },
    });
    this.addCommand({
      id: "switch-project",
      name: t("main.cmd.switchProject"),
      callback: () => {
        const all = [
          this.settings.projectFolder,
          ...this.settings.projects,
        ].filter((p, i, a) => p && a.indexOf(p) === i);
        if (all.length < 2) {
          new Notice(t("main.notice.addOtherProjects"));
          return;
        }
        const menu = new Menu();
        for (const p of all) {
          menu.addItem((item) =>
            item
              .setTitle(p)
              .setChecked(p === this.settings.projectFolder)
              .onClick(async () => {
                if (
                  this.settings.projectFolder &&
                  !this.settings.projects.includes(this.settings.projectFolder)
                ) {
                  this.settings.projects.push(this.settings.projectFolder);
                }
                this.settings.projectFolder = p;
                await this.saveSettings();
                this.renderAllViews(true);
                this.updateStatusBar();
              })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 80 });
      },
    });
    this.addCommand({
      id: "duplicate-project",
      name: t("main.cmd.duplicateProject"),
      callback: () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("analysis.dashboard.noActiveProject"));
          return;
        }
        new DuplicateVersionModal(this.app, this.projectDisplayName(root.path), async (label) => {
          await this.duplicateProject(root.path, label);
        }).open();
      },
    });
    this.addCommand({
      id: "backup-project-now",
      name: t("main.cmd.backupProjectNow"),
      callback: () => this.backupProjectNow(),
    });
    this.addCommand({
      id: "next-sheet",
      name: t("main.cmd.nextSheet"),
      callback: () => this.openNeighbor(1),
    });
    this.addCommand({
      id: "previous-sheet",
      name: t("main.cmd.previousSheet"),
      callback: () => this.openNeighbor(-1),
    });
    this.addCommand({
      id: "snapshot-file",
      name: t("main.cmd.snapshotFile"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice(t("main.notice.noActiveProjectSheet"));
          return;
        }
        const n = await this.snapshotFile(file, root);
        new Notice(t("main.notice.snapshotCreated", { name: n }));
      },
    });
    this.addCommand({
      id: "snapshot-project",
      name: t("main.cmd.snapshotProject"),
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const files = this.flattenFiles(root);
        for (const f of files) await this.snapshotFile(f, root);
        new Notice(t("main.notice.projectSnapshotDone", { count: files.length }));
      },
    });
    this.addCommand({
      id: "pdf-style-modal",
      name: t("main.cmd.openProjectExportPanel"),
      callback: () => this.activateProject(),
    });
    this.addCommand({
      id: "restore-snapshot",
      name: t("main.cmd.restoreSnapshot"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice(t("main.notice.noActiveProjectSheet"));
          return;
        }
        const snaps = listSnapshotFiles(this.app, file, root);
        if (snaps.length === 0) {
          new Notice(t("main.notice.noSnapshotForSheet"));
          return;
        }
        const menu = new Menu();
        for (const snap of snaps.slice(0, 15)) {
          menu.addItem((item) =>
            item.setTitle(snap.basename).onClick(async () => {
              await this.snapshotFile(file, root);
              const content = await this.app.vault.read(snap);
              await this.app.vault.modify(file, content);
              new Notice(t("main.notice.restored", { name: snap.basename }));
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "export-settings",
      name: t("main.cmd.exportSettings"),
      callback: async () => {
        const root = this.getProjectFolder();
        const dir = root ? root.path : "";
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const path = normalizePath(`${dir ? dir + "/" : ""}feuillets-reglages-${stamp}.json`);
        const payload = JSON.stringify(this.settings, null, 2);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, payload);
        } else {
          await this.app.vault.create(path, payload);
        }
        new Notice(t("main.notice.settingsSaved", { path }));
      },
    });
    this.addCommand({
      id: "import-settings",
      name: t("main.cmd.importSettings"),
      callback: async () => {
        const files = this.app.vault
          .getFiles()
          .filter((f) => f.extension === "json" && f.name.startsWith("feuillets-reglages"));
        if (files.length === 0) {
          new Notice(t("main.notice.noSettingsBackupFound"));
          return;
        }
        const menu = new Menu();
        for (const f of files.sort((a, b) => b.name.localeCompare(a.name))) {
          menu.addItem((item) =>
            item.setTitle(f.name).onClick(async () => {
              try {
                const raw = await this.app.vault.read(f);
                const data = JSON.parse(raw);
                if (!data || typeof data !== "object") throw new Error("format");
                this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
                await this.saveSettings();
                this.applyIndentClass();
                this.applyLiveTypoClasses();
                this.renderAllViews(true);
                new Notice(t("main.notice.settingsRestored", { name: f.name }));
              } catch (e) {
                console.error("Feuillets : import des réglages", e);
                new Notice(t("main.notice.settingsFileUnreadable"));
              }
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "migrate-research",
      name: t("main.cmd.migrateResearch"),
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const searchBases = [root.path, root.parent ? root.parent.path : null].filter(Boolean);
        const existingResearch = this.getResearchRoot();
        const destBase = existingResearch
          ? existingResearch.parent
            ? existingResearch.parent.path
            : root.path
          : root.parent
          ? root.parent.path
          : root.path;
        await this.ensureFolder(`${destBase}/_Recherche`);
        const moves = [
          ["_Personnages", "_Recherche/Personnages"],
          ["_Lieux", "_Recherche/Lieux"],
          ["_Chronologie", "_Recherche/Chronologie"],
          ["Personnages.base", "_Recherche/Personnages.base"],
          ["Lieux.base", "_Recherche/Lieux.base"],
        ];
        let moved = 0;
        for (const [from, to] of moves) {
          let src = null;
          for (const b of searchBases) {
            const cand = this.app.vault.getAbstractFileByPath(normalizePath(`${b}/${from}`));
            if (cand) {
              src = cand;
              break;
            }
          }
          if (!src) continue;
          const destPath = normalizePath(`${destBase}/${to}`);
          if (this.app.vault.getAbstractFileByPath(destPath)) {
            new Notice(t("main.notice.migrateAlreadyExists", { to, from }));
            continue;
          }
          await this.app.fileManager.renameFile(src, destPath);
          moved++;
        }
        new Notice(
          moved > 0
            ? t("main.notice.migrateDone", { count: moved })
            : t("main.notice.nothingToMigrate")
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "init-project",
      name: t("main.cmd.initProject"),
      callback: () => this.initProjectStructure(),
    });
    this.addCommand({
      id: "export-builtin-templates",
      name: t("main.cmd.exportBuiltinTemplates"),
      callback: async () => {
        const n = await exportBuiltInTemplates(this.app, this.settings);
        new Notice(
          n > 0
            ? t("main.notice.templatesExported", { count: n })
            : t("main.notice.templatesAlreadyPresent")
        );
      },
    });
    this.addCommand({
      id: "renumber-chapters",
      name: t("main.cmd.renumberChapters"),
      callback: async () => {
        const folder = this.getProjectFolder();
        if (!folder) {
          new Notice(t("main.notice.projectFolderNotFound"));
          return;
        }
        const n = await this.renumberTitles(folder);
        new Notice(t("main.notice.titlesUpdated", { count: n }));
      },
    });
    this.addCommand({
      id: "open-search-replace-bar",
      name: t("main.cmd.openSearchReplaceBar"),
      callback: () => this.toggleSearchReplaceBar(),
    });
  }

  registerAutoOpenPanels() {
    this.app.workspace.onLayoutReady(async () => {
      this.isLayoutReady = true;

      for (const type of [VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW]) {
        const leaves = this.app.workspace.getLeavesOfType(type);
        for (const leaf of leaves) leaf.detach();
      }
      for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_SIDEBAR_FEUILLETS]) {
        const leaves = this.app.workspace.getLeavesOfType(type);
        for (let i = 1; i < leaves.length; i++) leaves[i].detach();
      }

      // Restauration du dernier projet valide ouvert s'il n'y a pas de projet actif
      if (!this.getProjectFolder() && Array.isArray(this.settings.projects) && this.settings.projects.length > 0) {
        const lastValid = this.settings.projects.slice().reverse().find((p) => {
          const af = this.app.vault.getAbstractFileByPath(p);
          return af instanceof TFolder && af.path !== "" && af.path !== "/";
        });
        if (lastValid) {
          this.settings.projectFolder = lastValid;
          await this.saveSettings();
        }
      }

      const hasProject = !!this.getProjectFolder();

      // Si un projet est actif, ouvrir le binder et le volet droit (si autoOpenBinder est actif)
      if (hasProject) {
        if (
          this.settings.autoOpenBinder &&
          this.app.workspace.getLeavesOfType(VIEW_SIDEBAR).length === 0
        ) {
          const leaf = this.app.workspace.getLeftLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR, active: false });
        }

        if (this.app.workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).length === 0) {
          const leaf = this.app.workspace.getRightLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: false });
        }
      } else {
        // Si VRAIMENT AUCUN projet n'existe (nouvelle installation), ouvrir le volet binder avec le gestionnaire de projet
        if (this.app.workspace.getLeavesOfType(VIEW_SIDEBAR).length === 0) {
          const leaf = this.app.workspace.getLeftLeaf(false);
          if (leaf) await leaf.setViewState({ type: VIEW_SIDEBAR, active: true });
        }
      }

      this.adjustSidebarWidth();
      await this.loadDeferredViews();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.loadDeferredViews())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.loadDeferredViews())
    );
  }

  registerVaultEvents() {
    const refresh = () => {
      if (!this.isLayoutReady) return;
      if (this.settings.projectFolder && !this.getProjectFolder()) {
        const af = this.app.vault.getAbstractFileByPath(this.settings.projectFolder);
        if (!af) {
          this.settings.projectFolder = "";
          this.saveSettings();
          this.updateStatusBar();
        }
      }
      this.refreshView();
    };

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.isLayoutReady) refresh();
      this.maybeAutoInitializeResearchFile(file);
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (this.isLayoutReady) {
        if (this.settings.projectFolder && (file.path === this.settings.projectFolder || this.settings.projectFolder.startsWith(file.path + "/"))) {
          this.settings.projectFolder = "";
          this.saveSettings();
          this.updateStatusBar();
        }
        this.refreshView();
      }
    }));

    this.registerEvent(this.app.vault.on("rename", (file) => {
      if (this.isLayoutReady) refresh();
      this.maybeAutoInitializeResearchFile(file);
    }));
    this.registerEvent(this.app.vault.on("modify", () => this.refreshView(2500)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.maybeRenameResearchFile(file)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.handleFilChanged(file)));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.renderStaleViews();
      this.syncProjectPanelsVisibility();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.syncProjectPanelsVisibility();
    }));
  }

  async loadDeferredViews() {
    const pending = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred) {
        pending.push(leaf.loadIfDeferred().catch(() => {}));
      }
    });
    if (pending.length > 0) await Promise.all(pending);
  }

  registerConcentrationTracking() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (!this.concentrationActive) return;
        this.updateParagraphFocus(editor);
        if (this.settings.concentrationTypewriter && editor) {
          const cur = editor.getCursor();
          editor.scrollIntoView({ from: cur, to: cur }, true);
        }
        clearTimeout(this._concTimer);
        this._concTimer = setTimeout(
          () => this.updateConcentrationCounter(editor),
          250
        );
      })
    );
    this.registerDomEvent(document, "selectionchange", () => {
      if (!this.concentrationActive) return;
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) this.updateParagraphFocus(editor);
    });
  }

  registerDragSafetyNet() {
    const clearDragLeftovers = () => {
      this._dragInProgress = false;
      document
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
        });
    };
    this.registerDomEvent(document, "dragend", clearDragLeftovers);
    this.registerDomEvent(document, "drop", clearDragLeftovers);
  }

  registerLiveTypography() {
    this.registerDomEvent(
      document,
      "keydown",
      (event) => {
        const k = event.key;
        if (k !== "'" && k !== '"' && k !== "Enter" && k !== " ") return;
        const S = this.settings;
        if (
          !S.liveApostrophe &&
          !S.liveGuillemets &&
          !S.liveDashes &&
          !S.liveTwoEnters &&
          !S.liveDoubleEnter
        )
          return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (!target || !target.closest || !target.closest(".cm-editor")) return;
        if (this.app.vault.getConfig?.("vimMode")) return;
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mdView || mdView.getMode() !== "source") return;
        const file = mdView.file;
        const root = this.getProjectFolder();
        if (!file || !root) return;
        if (root.path !== "" && !file.path.startsWith(root.path + "/")) return;

        const editor = mdView.editor;
        const cursor = editor.getCursor();

        if (event.key === "'" && S.liveApostrophe) {
          event.preventDefault();
          if (editor.somethingSelected()) editor.replaceSelection("\u2019");
          else {
            editor.replaceRange("\u2019", cursor);
            editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
          }
        } else if (event.key === '"' && S.liveGuillemets) {
          event.preventDefault();
          const before = cursor.ch > 0
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 1 }, cursor)
            : "";
          const opening = before === "" || /[\s(\[«—–-]/.test(before);
          if (opening) {
            editor.replaceRange("\u00AB\u00A0", cursor);
          } else {
            editor.replaceRange("\u00A0\u00BB", cursor);
          }
          editor.setCursor({ line: cursor.line, ch: cursor.ch + 2 });
        } else if (
          event.key === "Enter" &&
          (S.liveTwoEnters || S.liveDoubleEnter) &&
          !editor.somethingSelected()
        ) {
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            editor.replaceRange("  \n", cursor);
            editor.setCursor({ line: cursor.line + 1, ch: 0 });
          } else {
            const lineText = editor.getLine(cursor.line);
            if (/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|>|```|---)/.test(lineText)) {
              /* structure : Entrée normale */
            } else if (
              S.liveDoubleEnter &&
              lineText.trim() === "" &&
              cursor.line > 0
            ) {
              event.preventDefault();
              event.stopPropagation();
              editor.setLine(cursor.line, "\u00A0");
              editor.replaceRange("\n\n", { line: cursor.line, ch: 1 });
              editor.setCursor({ line: cursor.line + 2, ch: 0 });
            } else if (S.liveTwoEnters) {
              event.preventDefault();
              event.stopPropagation();
              editor.replaceRange("\n\n", cursor);
              editor.setCursor({ line: cursor.line + 2, ch: 0 });
            }
          }
        } else if (event.key === " " && S.liveDashes) {
          const back3 = cursor.ch >= 3
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 3 }, cursor)
            : "";
          const back2 = cursor.ch >= 2
            ? editor.getRange({ line: cursor.line, ch: cursor.ch - 2 }, cursor)
            : "";
          if (back3 === "---") {
            event.preventDefault();
            editor.replaceRange("\u2014\u00A0", { line: cursor.line, ch: cursor.ch - 3 }, cursor);
          } else if (back2 === "--") {
            event.preventDefault();
            editor.replaceRange("\u2013\u00A0", { line: cursor.line, ch: cursor.ch - 2 }, cursor);
          }
        }
      },
      true
    );
    this.applyLiveTypoClasses();

    const reapply = () => {
      this.applyLiveTypoClasses();
      this.applyIndentClass();
    };
    this.registerEvent(this.app.workspace.on("file-open", reapply));
    this.registerEvent(this.app.workspace.on("active-leaf-change", reapply));
  }

  registerStatusBar() {
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("feuillets-status-bar");
    this.statusEl.addClass("feuillets-status-bar-clickable");
    setTooltip(this.statusEl, t("main.statusBarTooltip"));
    this.statusEl.addEventListener("click", () => {
      const file = this.app.workspace.getActiveFile();
      const root = this.getProjectFolder();
      if (!file || !root || !file.path.startsWith(root.path + "/")) return;
      new FileStatsModal(this.app, this, file).open();
    });
    const updateStatus = () => {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => this.updateStatusBar(), 300);
    };
    this.registerEvent(this.app.workspace.on("file-open", updateStatus));
    this.registerEvent(this.app.workspace.on("editor-change", updateStatus));
    this.registerEvent(this.app.workspace.on("active-leaf-change", updateStatus));
    updateStatus();
  }

  registerTextEditingCommands() {
    this.addCommand({
      id: "split-chronology",
      name: t("main.cmd.splitChronology"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(t("main.notice.openChronologyDocFirst"));
          return;
        }
        const raw = await this.app.vault.read(file);
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
        const headRe = /^(#{2,3})\s+(\d{1,4}(?:-\d{1,2}(?:-\d{1,2})?)?)\s*[-–—:]?\s*(.*)$/gm;
        const blocks = [];
        let m;
        let last = null;
        while ((m = headRe.exec(body)) !== null) {
          if (last) last.end = m.index;
          last = {
            date: m[2],
            title: m[3].trim() || m[2],
            start: headRe.lastIndex,
            end: body.length,
          };
          blocks.push(last);
        }
        if (blocks.length === 0) {
          new Notice(t("main.notice.noDatedTitleFound"));
          return;
        }
        const chronoFolder =
          this.getChronoFolder() ||
          (await this.ensureFolder(
            normalizePath(`${this.getProjectFolder().path}/${this.settings.chronoFolder}`)
          ));

        let created = 0;
        let skipped = 0;
        for (const b of blocks) {
          const text = body.slice(b.start, b.end).trim();
          const safeTitle = b.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
          const fileName = `${b.date} - ${safeTitle || t("main.untitled")}`;
          const path = normalizePath(`${chronoFolder.path}/${fileName}.md`);
          if (this.app.vault.getAbstractFileByPath(path)) {
            skipped++;
            continue;
          }
          const synopsis = text.replace(/\n+/g, " ").slice(0, 160).trim();
          const content = [
            "---",
            `title: ${b.title || b.date}`,
            `date: ${b.date}`,
            `synopsis: ${synopsis.replace(/"/g, "'")}`,
            "tags:",
            "  - evenement",
            "---",
            "",
            text,
            "",
          ].join("\n");
          await this.app.vault.create(path, content);
          created++;
        }
        new Notice(
          t("main.notice.chronologySplit", { count: created }) +
            (skipped > 0 ? t("main.notice.chronologySplitSkipped", { count: skipped }) : ".")
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "open-research",
      name: t("main.cmd.openResearchPanel"),
      callback: async () => {
        if (this.isPanelHidden("research")) {
          new Notice(t("main.notice.researchPanelHidden"));
          return;
        }
        this.activateResearch();
      },
    });
    this.addCommand({
      id: "open-notes",
      name: t("main.cmd.openNotesPanel"),
      callback: async () => {
        if (this.isPanelHidden("notes")) {
          new Notice(t("main.notice.notesPanelHidden"));
          return;
        }
        this.activateNotes();
      },
    });
    this.addCommand({
      id: "fix-escaped-scene-breaks",
      name: t("main.cmd.fixEscapedSceneBreaks"),
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = src.replace(/^[ \t]*\\?\*\\?\*\\?\*[ \t]*$/gm, "***");
        if (out === src) {
          new Notice(t("main.notice.nothingToFix"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice(t("main.notice.sceneBreaksFixed"));
      },
    });
    this.addCommand({
      id: "compact-line-breaks",
      name: t("main.cmd.compactLineBreaks"),
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.compactLineBreaks(src);
        if (out === src) {
          new Notice(t("main.notice.nothingToCompact"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice(hasSel ? t("main.notice.selectionCompacted") : t("main.notice.documentCompacted"));
      },
    });
    this.addCommand({
      id: "insert-scene-separator",
      name: t("main.cmd.insertSceneSeparator"),
      editorCallback: (editor) => {
        editor.replaceSelection("\n***\n\n");
      },
    });
    this.addCommand({
      id: "french-typography",
      name: t("main.cmd.frenchTypography"),
      editorCallback: (editor) => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || (root.path !== "" && !file.path.startsWith(root.path + "/"))) {
          new Notice(t("main.notice.manuscriptFilesOnly"));
          return;
        }
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.frenchTypography(src, !hasSel);
        if (out === src) {
          new Notice(t("main.notice.nothingToFixShort"));
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else {
          const cursor = editor.getCursor();
          editor.setValue(out);
          editor.setCursor(cursor);
        }
        new Notice(t("main.notice.frenchTypographyApplied"));
      },
    });
    this.addCommand({
      id: "insert-footnote",
      name: t("main.cmd.insertFootnote"),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "f" }],
      editorCallback: (editor) => {
        const n = nextFootnoteNumber(editor.getValue());
        const marker = `[^${n}]`;
        const at = editor.getCursor("to");
        editor.replaceRange(marker, at, at);
        const lastLine = editor.lastLine();
        const end = { line: lastLine, ch: editor.getLine(lastLine).length };
        const defLine = `\n\n[^${n}]: `;
        editor.replaceRange(defLine, end, end);
        const newLastLine = editor.lastLine();
        editor.setCursor({ line: newLastLine, ch: editor.getLine(newLastLine).length });
        editor.focus();
        new Notice(t("main.notice.footnoteInserted", { n }));
      },
    });
    this.addCommand({
      id: "insert-citation",
      name: t("main.cmd.insertCitation"),
      editorCallback: (editor) => this.openInsertCitation(editor),
    });
    this.addCommand({
      id: "renumber-footnotes",
      name: t("main.cmd.renumberFootnotes"),
      editorCallback: (editor) => {
        const src = editor.getValue();
        const out = renumberFootnotes(src);
        if (out === src) {
          new Notice(t("main.notice.nothingToRenumber"));
          return;
        }
        const cursor = editor.getCursor();
        editor.setValue(out);
        editor.setCursor(cursor);
        new Notice(t("main.notice.footnotesRenumbered"));
      },
    });
  }

  async maybeAutoInitializeResearchFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md" || file.stat.size > 0) return;
    const researchRoot = this.getResearchRoot();
    if (!researchRoot) return;
    if (!file.path.startsWith(researchRoot.path + "/")) return;
    const mode = this.projectMode();
    const rf = mode.researchFolders;
    const parentName = file.parent ? file.parent.name : "";
    let sectionKey = "";
    if (matchesResearchLabel(rf, "sources", parentName)) sectionKey = "sources";
    else if (matchesResearchLabel(rf, "bibliographie", parentName)) sectionKey = "bibliographie";
    else if (matchesResearchLabel(rf, "personnages", parentName)) sectionKey = "personnages";
    else if (matchesResearchLabel(rf, "lieux", parentName)) sectionKey = "lieux";
    else if (matchesResearchLabel(rf, "codex", parentName)) sectionKey = "codex";
    else if (matchesResearchLabel(rf, "glossaire", parentName)) sectionKey = "glossaire";
    else if (parentName === "Chronology" || parentName === "Chronologie") sectionKey = "evenements";
    if (!sectionKey) return;
    const template = await getResearchTemplate(this.app, this.settings, mode, sectionKey, file.basename);
    if (template) {
      try {
        await this.app.vault.modify(file, template);
      } catch (err) {
        console.error("Feuillets: Failed to auto-initialize file:", err);
      }
    }
  }

  onunload() {
    if (this.grammalecteChecker) this.grammalecteChecker.destroy();
    if (this.harperChecker) this.harperChecker.destroy();
    clearTimeout(this._refreshTimer);
    clearTimeout(this._statusTimer);
    clearTimeout(this._concTimer);
    document.body.removeClass("feuillets-indent");
    document.body.removeClass("feuillets-concentration");
    this.removeConcentrationCounter();
    if (this._escHandler) document.removeEventListener("keydown", this._escHandler);
    document.body.removeClass("feuillets-lignesvides-invisible");
    document.body.removeClass("feuillets-lignesvides-reduit");
    document.body.removeClass("feuillets-cesure");
    if (this._originalGetDisplayText) {
      /* Ne restaurer QUE si le prototype porte encore notre patch. Un autre
         plugin ayant patché après nous a enveloppé le nôtre : écraser avec
         notre « original » supprimerait le sien au passage. Dans ce cas on
         laisse la chaîne en place — notre patch reste appelé mais retombe
         toujours sur l'original, donc inoffensif. */
      if (MarkdownView.prototype.getDisplayText === this._patchedGetDisplayText) {
        MarkdownView.prototype.getDisplayText = this._originalGetDisplayText;
        this._originalGetDisplayText = null;
        this._patchedGetDisplayText = null;
      }
      /* Si on n'a PAS pu se retirer, on garde `_originalGetDisplayText` :
         notre patch est encore appelable via la chaîne du plugin qui nous
         enveloppe, et il s'en sert comme repli. */
    }
    this.refreshAllTabHeaders();
  }

  patchTabTitles() {
    const plugin = this;
    /* Garde contre un double appel : sans elle, le second capturerait NOTRE
       patch comme « original », et l'appel de repli en fin de fonction
       bouclerait indéfiniment. */
    if (this._originalGetDisplayText) return;
    this._originalGetDisplayText = MarkdownView.prototype.getDisplayText;
    this._patchedGetDisplayText = function () {
      try {
        if (this.file) {
          const fm = plugin.fmOf(this.file);
          const raw = fm && fm.short_title;
          const short = raw ? String(raw).trim() : "";
          if (short) {
            const versionLabel = plugin.versionLabelForFile(this.file);
            return versionLabel ? `${versionLabel}-${short}` : short;
          }
        }
      } catch (e) {
        /* Silence délibéré, contrairement aux catches métier : on est sur le
           rendu d'en-tête d'onglet, appelé à chaque affichage. Y logger
           inonderait la console, et le repli ci-dessous est déjà le
           comportement correct (titre Obsidian par défaut). */
      }
      return plugin._originalGetDisplayText.call(this);
    };
    MarkdownView.prototype.getDisplayText = this._patchedGetDisplayText;
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.refreshTabHeaderFor(file)));
    this.app.workspace.onLayoutReady(() => this.refreshAllTabHeaders());
  }

  refreshTabHeaderFor(file) {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view?.file?.path === file.path && typeof leaf.updateHeader === "function") {
        try { leaf.updateHeader(); } catch (e) {}
      }
    }
  }

  refreshAllTabHeaders() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (typeof leaf.updateHeader === "function") {
        try { leaf.updateHeader(); } catch (e) {}
      }
    }
  }

  updateParagraphFocus(editor) {
    if (!this.concentrationActive || this.settings.concentrationUnit === "line") return;
    const cm = editor && editor.cm;
    if (!cm || !cm.dom || typeof cm.domAtPos !== "function") return;
    const cur = editor.getCursor().line;
    let start = cur;
    let end = cur;
    while (start > 0 && editor.getLine(start - 1).trim() !== "") start--;
    const last = editor.lastLine();
    while (end < last && editor.getLine(end + 1).trim() !== "") end++;
    if (this._paraEls) {
      for (const el of this._paraEls) el.classList.remove("feuillets-para-active");
    }
    this._paraEls = [];
    for (let ln = start; ln <= end; ln++) {
      try {
        const offset = editor.posToOffset({ line: ln, ch: 0 });
        const result = cm.domAtPos(offset);
        if (!result) continue;
        let node = result.node;
        while (node && node.nodeType === 3) node = node.parentNode;
        const lineEl = node && node.closest ? node.closest(".cm-line") : null;
        if (lineEl) {
          lineEl.classList.add("feuillets-para-active");
          this._paraEls.push(lineEl);
        }
      } catch (e) {}
    }
  }

  async updateConcentrationCounter(editor) {
    if (!this.concentrationActive || !this.settings.concentrationCounter) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    if (!this._concCounterEl) {
      this._concCounterEl = document.body.createDiv({ cls: "feuillets-conc-counter" });
    }
    const text = editor ? editor.getValue() : await this.app.vault.cachedRead(file);
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const wc = countWords(body);
    const fm = this.fmOf(file);
    const g = parseInt(fm.goal, 10);
    const goal = isNaN(g) ? this.settings.wordGoal : g;
    this._concCounterEl.setText(goal > 0 ? `${wc} / ${goal}` : String(wc));
    const tol = this.settings.tolerance;
    this._concCounterEl.removeClass("feuillets-status-hit");
    this._concCounterEl.removeClass("feuillets-status-over");
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol) this._concCounterEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol) this._concCounterEl.addClass("feuillets-status-over");
    }
  }

  removeConcentrationCounter() {
    if (this._concCounterEl) {
      this._concCounterEl.remove();
      this._concCounterEl = null;
    }
  }

  toggleConcentration() {
    try {
      this.concentrationActive = !this.concentrationActive;
      if (this.concentrationActive) {
        try {
          this._savedLeft = this.app.workspace.leftSplit.collapsed;
          this._savedRight = this.app.workspace.rightSplit.collapsed;
          this.app.workspace.leftSplit.collapse();
          this.app.workspace.rightSplit.collapse();
        } catch (e) {}
        document.body.style.setProperty("--feuillets-dim-opacity", `${(this.settings.dimOpacity || 35) / 100}`);
        document.body.style.setProperty("--feuillets-concentration-width", `${this.settings.concentrationWidth || 720}px`);
        document.body.toggleClass("feuillets-focus-paragraph", this.settings.concentrationUnit === "paragraph");
        document.body.toggleClass("feuillets-focus-line", this.settings.concentrationUnit !== "paragraph");
        document.body.addClass("feuillets-concentration");
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) this.updateParagraphFocus(editor);
        if (!this._escHandler) {
          this._escHandler = (e) => {
            if (e.key === "Escape" && this.concentrationActive) this.toggleConcentration();
          };
          document.addEventListener("keydown", this._escHandler);
        }
        const ed = this.app.workspace.activeEditor?.editor;
        this.updateConcentrationCounter(ed);
        new Notice(t("main.notice.concentrationModeOn"));
      } else {
        document.body.removeClass("feuillets-concentration");
        this.removeConcentrationCounter();
        clearTimeout(this._concTimer);
        if (this._paraEls) {
          for (const el of this._paraEls) el.classList.remove("feuillets-para-active");
          this._paraEls = null;
        }
        try {
          if (!this._savedLeft) this.app.workspace.leftSplit.expand();
          if (!this._savedRight) this.app.workspace.rightSplit.expand();
        } catch (e) {}
      }
    } catch (e) {
      console.error("Feuillets : mode concentration", e);
      new Notice(t("main.notice.concentrationModeError"));
    }
  }

  isActiveFileInProject() {
    const root = this.getProjectFolder();
    if (!root) return false;

    // Les vues Feuillets (dont la vue Scrivenings) n'affichent jamais que du
    // contenu projet, mais ne deviennent pas le "fichier actif" au sens
    // d'Obsidian : sans ce cas particulier, applyLiveTypoClasses() se base sur
    // le dernier vrai fichier actif (potentiellement hors projet ou nul) et
    // désactive à tort les réglages de lecture (lignes vides, justification...).
    if (this.app.workspace.getActiveViewOfType(BoardView)) return true;

    const file = this.app.workspace.getActiveFile();
    if (!file) return false;
    if (root.path === "") return true;
    return file.path.startsWith(root.path + "/");
  }

  applyLiveTypoClasses() {
    const S = this.settings;
    const inProject = this.isActiveFileInProject();
    document.body.toggleClass("feuillets-lignesvides-invisible", inProject && S.liveEmptyLines === "invisible");
    document.body.toggleClass("feuillets-lignesvides-reduit", inProject && S.liveEmptyLines === "reduit");
    document.body.toggleClass("feuillets-cesure", inProject && S.liveHyphenation);
    document.body.toggleClass("feuillets-justify-live", inProject && !!S.liveJustify);
    document.body.toggleClass("feuillets-lecture-comme-live", inProject && S.readingMatchLive !== false);
    if (inProject && S.liveHyphenation && !document.body.getAttr("lang")) {
      document.body.setAttr("lang", "fr");
    }
    const rfs = inProject ? S.readingFontSize : 0;
    document.body.toggleClass("feuillets-reading-fs", rfs > 0);
    if (rfs > 0) {
      document.body.style.setProperty("--feuillets-reading-fs", `${rfs}px`);
    } else {
      document.body.style.removeProperty("--feuillets-reading-fs");
    }
    const lh = inProject ? S.lineHeight : 0;
    document.body.toggleClass("feuillets-line-height", lh > 0);
    if (lh > 0) {
      document.body.style.setProperty("--feuillets-line-height", `${lh}`);
    } else {
      document.body.style.removeProperty("--feuillets-line-height");
    }
    const tw = inProject ? S.textWidth : 0;
    document.body.toggleClass("feuillets-text-width", tw > 0);
    if (tw > 0) {
      document.body.style.setProperty("--feuillets-text-width", `${tw}px`);
    } else {
      document.body.style.removeProperty("--feuillets-text-width");
    }
  }

  applyIndentClass() {
    document.body.toggleClass("feuillets-indent", this.isActiveFileInProject() && this.settings.indentParagraphs);
  }

  applyLeanInterfaceClasses() {
    document.body.toggleClass("feuillets-transparent-panels", !!this.settings.uiTransparentPanels);
    document.body.toggleClass("feuillets-transparent-tabbar", !!this.settings.uiTransparentTabBar);
    document.body.toggleClass("feuillets-hide-vault-switcher", !!this.settings.uiHideVaultSwitcher);
    document.body.toggleClass("feuillets-dim-tab-actions", !!this.settings.uiDimTabActions);
  }

  currentStreak() {
    const stats = this.settings.stats || {};
    let streak = 0;
    const d = new Date();
    for (;;) {
      const p = (n) => String(n).padStart(2, "0");
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const st = stats[key];
      const delta = st ? Math.max(0, st.latest - st.start) : 0;
      if (delta <= 0) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  /** `focusEditor: false` (Binder, navigation clavier flèches) : charge le
   * feuillet suivant/précédent dans son volet SANS y déplacer le focus
   * clavier — sinon la 2e pression de flèche irait déplacer le curseur de
   * texte dans l'éditeur au lieu de continuer à naviguer dans le Binder. */
  async openNeighbor(delta, { focusEditor = true } = {}) {
    const root = this.getProjectFolder();
    const current = this.app.workspace.getActiveFile();
    if (!root || !current) return null;
    const files = this.flattenFiles(root);
    const idx = files.findIndex((f) => f.path === current.path);
    if (idx === -1) {
      new Notice(t("main.notice.activeFileNotInProject"));
      return null;
    }
    const next = files[idx + delta];
    if (!next) {
      new Notice(delta > 0 ? t("main.notice.lastSheet") : t("main.notice.firstSheet"));
      return null;
    }
    const leaf = this.getLeafForOpeningFile();
    if (focusEditor) {
      openFileActivating(this.app, leaf, next);
      this.app.workspace.revealLeaf(leaf);
    } else {
      // Attendu ici (contrairement au cas focusEditor) : l'appelant clavier
      // du Binder (feuillets-view.js) a besoin du fichier réellement ouvert
      // pour resynchroniser le dossier sélectionné avant de rendre la main.
      await leaf.openFile(next, { active: true });
    }
    return next;
  }

  async updateStatusBar() {
    if (!this.statusEl) return;
    const file = this.app.workspace.getActiveFile();
    const root = this.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) {
      this.statusEl.setText("");
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const content =
      mdView && mdView.file === file && mdView.editor
        ? mdView.editor.getValue()
        : await this.app.vault.cachedRead(file);
    const wc = countWords(content);
    const chars = stripWritingNoise(content).length;
    const g = parseInt(this.fmOf(file).goal, 10);
    const goal = isNaN(g) ? this.settings.wordGoal : g;
    let txt = goal > 0 ? t("main.statusBar.wordsWithGoal", { wc, goal }) : t("main.statusBar.words", { wc });
    txt += ` · ${t("main.statusBar.chars", { count: formatNumber(chars) })}`;
    const key = todayKey();
    const st = (this.settings.stats || {})[key];
    if (st) {
      const total = await this.wordCountOfFolder(root);
      const delta = total - st.start;
      txt += ` · ${t("main.statusBar.todayDelta", { sign: delta >= 0 ? "+" : "", delta })}`;
    }
    this.statusEl.setText(txt);
    this.statusEl.removeClass("feuillets-status-hit");
    this.statusEl.removeClass("feuillets-status-over");
    const tol = this.settings.tolerance;
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol) this.statusEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol) this.statusEl.addClass("feuillets-status-over");
    }
  }

  compactLineBreaks(text) { return compactLineBreaks(text); }
  frenchTypography(text, skipFrontmatter) { return frenchTypography(text, skipFrontmatter); }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (data && data.autoOpenHub !== undefined && data.autoOpenNotes === undefined) {
      const wasOn = !!data.autoOpenHub;
      const tab = data.hubActiveTab || "properties";
      this.settings.autoOpenNotes = wasOn && tab === "notes";
      this.settings.autoOpenProperties = wasOn && tab === "properties";
      this.settings.autoOpenResearch = wasOn && tab === "research";
      this.settings.autoOpenJournal = wasOn && (tab === "progression" || tab === "journal");
      this.settings.autoOpenProject = wasOn && (tab === "project" || tab === "export");
    }
    if (data && (data.autoOpenProgression !== undefined || data.autoOpenExport !== undefined)) {
      if (data.autoOpenProgression) this.settings.autoOpenJournal = true;
      if (data.autoOpenExport) this.settings.autoOpenProject = true;
    }
    /* Migration : les statuts personnalisés (simples chaînes, ajoutées à une
       liste de base figée) deviennent des entrées {name, color} au même
       titre que les 5 statuts par défaut — voir constants.js. */
    if (data && Array.isArray(data.customStatuses) && data.customStatuses.length) {
      const existingNames = new Set(this.settings.statuses.map((s) => s.name));
      for (const name of data.customStatuses) {
        const clean = typeof name === "string" ? name.trim() : "";
        if (clean && !existingNames.has(clean)) {
          this.settings.statuses.push({ name: clean, color: "#888888" });
          existingNames.add(clean);
        }
      }
    }
    delete this.settings.customStatuses;
    /* Migration : colonnes du Plan renommées (resume->summary,
       compiler->compile, voir default-settings.js) — reprend la valeur
       true/false que l'utilisateur avait choisie sous l'ancien nom. */
    if (data && data.outlineCols) {
      if (data.outlineCols.resume !== undefined && data.outlineCols.summary === undefined) {
        this.settings.outlineCols.summary = data.outlineCols.resume;
      }
      if (data.outlineCols.compiler !== undefined && data.outlineCols.compile === undefined) {
        this.settings.outlineCols.compile = data.outlineCols.compiler;
      }
    }
    if (data && data.outlineWidths) {
      if (data.outlineWidths.resume !== undefined && data.outlineWidths.summary === undefined) {
        this.settings.outlineWidths.summary = data.outlineWidths.resume;
      }
      if (data.outlineWidths.compiler !== undefined && data.outlineWidths.compile === undefined) {
        this.settings.outlineWidths.compile = data.outlineWidths.compiler;
      }
    }
    // Migration : valeur d'enum "resume" -> "summary" (cardContent,
    // listPanePreviewField — voir default-settings.js/utils/project-modes.js)
    if (this.settings.cardContent === "resume") this.settings.cardContent = "summary";
    if (this.settings.listPanePreviewField === "resume") this.settings.listPanePreviewField = "summary";
  }

  async saveSettings() {
    this.trimStats();
    await this.saveData(this.settings);
  }

  trimStats() {
    const stats = this.settings.stats;
    const keep = this.settings.statsRetention;
    if (!stats || !keep || keep <= 0) return;
    const keys = Object.keys(stats);
    if (keys.length <= keep) return;
    keys.sort();
    for (const k of keys.slice(0, keys.length - keep)) delete stats[k];
  }

  refreshView(delay = 800) {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      if (this._dragInProgress) {
        this._dragRetryCount = (this._dragRetryCount || 0) + 1;
        if (this._dragRetryCount < 10) {
          this.refreshView(delay);
          return;
        }
        this._dragInProgress = false;
      }
      this._dragRetryCount = 0;
      this.renderAllViews();
    }, delay);
  }

  leafVisible(leaf) {
    const el = leaf && leaf.view && leaf.view.containerEl;
    if (!el) return false;
    if (typeof el.isShown === "function") return el.isShown();
    return el.offsetParent !== null;
  }

  renderStaleViews() {
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const v = leaf.view;
        if (v && v._stale && typeof v.render === "function" && this.leafVisible(leaf)) {
          v._stale = false;
          v.render();
        }
      }
    }
  }

  renderAllViews(force = false) {
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_PROPERTIES, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW, VIEW_SIDEBAR_FEUILLETS]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.view) {
          if (!force && !this.leafVisible(leaf)) {
            leaf.view._stale = true;
            continue;
          }
          leaf.view._stale = false;
          if (typeof leaf.view.renderAllSubViews === "function") {
            leaf.view.renderAllSubViews(force);
          } else if (typeof leaf.view.render === "function") {
            leaf.view.render(force);
          }
        }
      }
    }
    this.adjustSidebarWidth();
  }

  safeSetSize(split, width) {
    if (!split || typeof split.setSize !== "function") return;
    try { split.setSize(width); } catch (e) {}
  }

  /* vault.getConfig/setConfig : API interne non documentée (comme
     WorkspaceSplit.setSize ci-dessus) mais stable — c'est le même stockage
     que les réglages natifs "Éditeur"/"Apparence" d'Obsidian
     (app.json/appearance.json). Pas de valeur par défaut Feuillets pour ces
     clés : les réglages lisent la valeur réelle courante à chaque rendu, on
     ne fait qu'exposer un raccourci vers un réglage Obsidian existant,
     jamais une préférence stockée en double côté plugin. */
  getVaultConfig(key) {
    try {
      return typeof this.app.vault.getConfig === "function" ? this.app.vault.getConfig(key) : undefined;
    } catch (e) {
      return undefined;
    }
  }

  setVaultConfig(key, value) {
    try {
      if (typeof this.app.vault.setConfig === "function") this.app.vault.setConfig(key, value);
      this.app.workspace.updateOptions();
    } catch (e) {}
  }

  adjustSidebarWidth() {
    if (Platform.isMobile) return;
    const leftSplit = this.app.workspace.leftSplit;
    if (leftSplit && !leftSplit.collapsed) {
      const activeSidebarLeaf = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR)[0];
      if (activeSidebarLeaf) {
        const isSinglePane = this.settings.binderTreeCollapsed || this.settings.binderListCollapsed;
        const width = !isSinglePane ? 400 : 250;
        this.safeSetSize(leftSplit, width);
      }
    }
    const rightSplit = this.app.workspace.rightSplit;
    if (rightSplit && !rightSplit.collapsed) {
      this.safeSetSize(rightSplit, RIGHT_SIDEBAR_WIDTH);
    }
  }

  getProjectFolder() { return getProjectFolder(this.app, this.settings); }
  projectMode() { return getProjectMode(this.app, this.settings); }

  citationStyleFor() {
    const root = this.getProjectFolder();
    const meta = root ? this.settings.projectMeta[root.path] : null;
    return (meta && meta.citationStyle) || "footnote";
  }

  registerLastEditorTracking() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          this._lastMarkdownLeaf = leaf;
        }
      })
    );
  }

  activeEditorAnywhere() {
    const activeEditor = this.app.workspace.activeEditor;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    const recentView = recentLeaf && recentLeaf.view instanceof MarkdownView ? recentLeaf.view : null;
    return (
      (activeEditor && activeEditor.editor) ||
      (activeView && activeView.editor) ||
      (recentView && recentView.editor) ||
      (this._lastMarkdownLeaf && this._lastMarkdownLeaf.view instanceof MarkdownView
        ? this._lastMarkdownLeaf.view.editor
        : null)
    );
  }

  getCitationFolders() {
    const mode = this.projectMode();
    const rf = mode.researchFolders;
    if (!rf.sources) return [];
    const researchRoot = this.getResearchRoot();
    const root = this.getProjectFolder();
    const baseResearch = researchRoot ? researchRoot.path : root ? `${root.path}/_Recherche` : null;
    if (!baseResearch) return [];
    return [rf.sources.label, rf.bibliographie.label]
      .map((label) => this.app.vault.getAbstractFileByPath(normalizePath(`${baseResearch}/${label}`)))
      .filter((f) => f instanceof TFolder);
  }

  async migrateBibliographieIntoSources(bibliographieFolder, sourcesFolder) {
    const files = bibliographieFolder.children.filter((c) => c instanceof TFile && c.extension === "md");
    if (files.length === 0) return;
    let migrated = 0;
    for (const f of files) {
      try {
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          if (fm.annee !== undefined && fm.date === undefined) {
            fm.date = fm.annee;
            delete fm.annee;
          }
          // edition/editeur (vocabulaire Bibliographie) -> publisher (voir
          // services/frontmatter.js, LEGACY_FIELD_ALIASES)
          if (fm.publisher === undefined) {
            if (fm.editeur !== undefined) fm.publisher = fm.editeur;
            else if (fm.edition !== undefined) fm.publisher = fm.edition;
          }
          delete fm.editeur;
          delete fm.edition;
        });
        let name = f.name;
        let destPath = normalizePath(`${sourcesFolder.path}/${name}`);
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(destPath)) {
          name = `${f.basename} ${n++}.${f.extension}`;
          destPath = normalizePath(`${sourcesFolder.path}/${name}`);
        }
        await this.app.fileManager.renameFile(f, destPath);
        migrated++;
      } catch (e) {}
    }
  }

  openInsertCitation(editor) {
    editor = editor || this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.openSceneBeforeCitation"));
      return;
    }
    const folders = this.getCitationFolders();
    if (folders.length === 0) {
      new Notice(t("main.notice.nonfictionOnly"));
      return;
    }
    const files = folders.flatMap((f) => f.children.filter((c) => c instanceof TFile && c.extension === "md"));
    if (files.length === 0) {
      new Notice(t("main.notice.noSourceOrBibliographySheet"));
      return;
    }
    new CitationSourceModal(this.app, this, files, (file, page) =>
      this.insertCitationFor(file, page, editor)
    ).open();
  }

  quickCiteSource(sourceFile) {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.openSceneBeforeCitation"));
      return;
    }
    promptForPage(this.app, this, sourceFile, (file, page) =>
      this.insertCitationFor(file, page, editor)
    );
  }

  renumberActiveFootnotes() {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.openSheetBeforeRenumbering"));
      return;
    }
    const src = editor.getValue();
    const out = renumberFootnotes(src);
    if (out === src) {
      new Notice(t("main.notice.nothingToRenumber"));
      return;
    }
    const cursor = editor.getCursor();
    editor.setValue(out);
    editor.setCursor(cursor);
    new Notice(t("main.notice.footnotesRenumbered"));
  }

  insertCitationFor(sourceFile, page, editor) {
    const rawFm = this.fmOf(sourceFile);
    const fm = {
      author: rawFm.author,
      title: rawFm.title,
      date: rawFm.date || rawFm.annee,
      publisher: rawFm.publisher,
      url: rawFm.url,
    };
    const style = this.citationStyleFor();
    const activeFile = this.app.workspace.getActiveFile();
    if (!this._lastCitedSourceByFile) this._lastCitedSourceByFile = new Map();
    const isRepeat = !!activeFile && this._lastCitedSourceByFile.get(activeFile.path) === sourceFile.path;
    const text = formatCitation(fm, page, style, isRepeat);
    if (!text) {
      new Notice(t("main.notice.emptySourceSheet"));
      return;
    }
    if (activeFile) this._lastCitedSourceByFile.set(activeFile.path, sourceFile.path);
    this.markSourceCited(sourceFile);
    if (style === "parenthetical") {
      const at = editor.getCursor("to");
      editor.replaceRange(text, at, at);
      editor.setCursor({ line: at.line, ch: at.ch + text.length });
      editor.focus();
      new Notice(isRepeat ? t("main.notice.ibidInserted") : t("main.notice.citationInserted"));
      return;
    }
    const n = nextFootnoteNumber(editor.getValue());
    const refMarker = `[^${n}]`;
    const at = editor.getCursor("to");
    editor.replaceRange(refMarker, at, at);
    const lastLine = editor.lastLine();
    const end = { line: lastLine, ch: editor.getLine(lastLine).length };
    editor.replaceRange(`\n\n[^${n}]: ${text}`, end, end);
    editor.setCursor({ line: at.line, ch: at.ch + refMarker.length });
    editor.focus();
    new Notice(isRepeat ? t("main.notice.ibidInsertedNote", { n }) : t("main.notice.citationInsertedNote", { n }));
  }

  /* L'échec n'interrompt pas l'insertion de la citation (déjà écrite dans le
     texte à ce stade), mais il ne doit pas passer inaperçu : `cite_count` est
     ce qui décide de la présence de la source dans generateBibliographyFile,
     donc un échec silencieux ici se manifeste bien plus tard, sous forme
     d'entrée manquante dans la bibliographie. */
  markSourceCited(sourceFile) {
    this.app.fileManager.processFrontMatter(sourceFile, (fm) => {
      fm.cite_count = (fm.cite_count || 0) + 1;
    }).catch((e) => {
      console.error(`Feuillets: compteur de citations non mis à jour (${sourceFile.path})`, e);
      new Notice(t("main.notice.citationInsertedButNotMarked"));
    });
  }

  async generateBibliographyFile() {
    const root = this.getProjectFolder();
    if (!root) return;
    const folders = this.getCitationFolders();
    if (folders.length === 0) return;
    const files = folders.flatMap((f) => f.children.filter((c) => c instanceof TFile && c.extension === "md"));
    const cited = files.filter((f) => (this.fmOf(f).cite_count || 0) > 0);
    if (cited.length === 0) {
      new Notice(t("main.notice.noSourceCitedYet"));
      return;
    }
    const entries = cited
      .map((f) => {
        const raw = this.fmOf(f);
        const fields = { author: raw.author, title: raw.title, date: raw.date || raw.annee, publisher: raw.publisher, url: raw.url };
        return { author: raw.author || "", text: formatCitation(fields, "", "footnote", false) };
      })
      .filter((e) => e.text);
    entries.sort((a, b) => a.author.localeCompare(b.author, "fr"));
    const lines = [`# ${t("shared.bibliography.title")}`, "", ...entries.map((e) => e.text)];
    try {
      const outputFolder = await getOutputFolder(this.app, this.settings);
      const outBase = outputFolder ? outputFolder.path : root.path;
      const path = normalizePath(`${outBase}/Bibliographie.md`);
      const content = lines.join("\n\n") + "\n";
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modify(existing, content);
      else await this.app.vault.create(path, content);
      new Notice(t("main.notice.bibliographyGenerated", { path }));
    } catch (e) {
      /* Action déclenchée par un clic explicite : sans ce retour, l'échec se
         traduit par « rien ne se passe », indiscernable d'un bouton inerte. */
      console.error("Feuillets: génération de la bibliographie impossible", e);
      new Notice(t("main.notice.bibliographyNotGenerated"));
    }
  }

  unitLabel() { return this.projectMode().unit; }
  unitLabelPlural() { return this.projectMode().unitPlural; }
  hasSources() { return this.projectMode().hasSources; }
  // Nom personnalisé (S.projectMeta[path].name, réglable dans
  // ManageProjectsModal) en priorité, sinon déduit du dossier (voir
  // folder-structure.js — gère la convention <Projet>/Manuscrit/).
  projectDisplayName(path) {
    const custom = (this.settings.projectMeta[path] || {}).name;
    return custom && custom.trim() ? custom.trim() : projectDisplayName(path);
  }
  fmOf(file) { return fmOf(this.app, file); }
  titleFor(file) { return titleFor(this.app, file); }
  shortTitleFor(file) { return shortTitleFor(this.app, file); }
  compiledTitleFor(file) { return compiledTitleFor(this.app, file); }
  folderNoteFor(folder) { return folderNoteFor(this.app, folder); }
  async getOrCreateFolderNote(folder) { return getOrCreateFolderNote(this.app, folder); }
  tagsOf(file) { return tagsOf(this.app, file); }
  labelOf(file) { return labelOf(this.app, file); }
  labelsOf(file) { return labelsOf(this.app, file); }
  labelColor(name) { return labelColor(this.settings, name); }
  getStatusColor(name) { return getStatusColor(this.settings, name); }
  folderGoal(folder) { return folderGoal(this.settings, folder); }
  depthOf(node) { return depthOf(this.app, this.settings, node); }
  isFrontMatter(node) { return isFrontMatter(this.app, this.settings, node); }
  roleOfFolder(folder) { return roleOfFolder(this.app, this.settings, folder); }
  roleOfFile(file) { return roleOfFile(this.app, this.settings, file); }
  getOrderedChildren(folder, includeHidden = false) { return getOrderedChildren(this.app, this.settings, folder, includeHidden); }
  flattenFiles(folder) { return flattenFiles(this.app, this.settings, folder); }
  getManuscriptFiles() {
    const root = this.getProjectFolder();
    if (!root) return [];
    return this.flattenFiles(root);
  }
  chapterCount(root) { return chapterCount(this.app, this.settings, root); }
  getChapters(root) { return getChapters(this.app, this.settings, root); }

  async maybeRenameResearchFile(file) { return maybeRenameResearchFile(this.app, this.settings, file); }
  async handleFilChanged(file) {
    try { await handleFilChanged(this.app, this.settings, this, file); } catch (e) {}
  }

  entityMatchTags(entityFile) { return entityMatchTags(this.app, entityFile); }
  entityMatchNames(entityFile) { return entityMatchNames(this.app, entityFile); }
  async findAppearances(entityFile) { return findAppearances(this.app, this.settings, entityFile); }
  getResearchRoot() { return getResearchRoot(this.app, this.settings); }
  getChronoFolder() { return getChronoFolder(this.app, this.settings); }
  listCompiledFilePaths() { return listCompiledFilePaths(this.app, this.settings); }
  parseStoryDate(raw, file = null) { return parseStoryDate(raw, file); }

  buildNumbering(root) {
    return buildNumbering(this.settings, root, {
      getOrderedChildren: (f) => this.getOrderedChildren(f),
      roleOfFolder: (f) => this.roleOfFolder(f),
      isFrontMatter: (node) => this.isFrontMatter(node),
      isFolder: (node) => node instanceof TFolder,
    });
  }

  async getWordCounts(files) {
    if (!this._wcCache) this._wcCache = new Map();
    const cache = this._wcCache;
    let misses = null;
    for (const f of files) {
      const hit = cache.get(f.path);
      if (!hit || hit.mtime !== f.stat.mtime) (misses || (misses = [])).push(f);
    }
    if (misses) {
      await Promise.all(
        misses.map(async (f) => {
          const content = await this.app.vault.cachedRead(f);
          const clean = stripWritingNoise(content);
          cache.set(f.path, {
            mtime: f.stat.mtime,
            wc: countWords(content),
            chars: clean.length,
            charsNoSpaces: clean.replace(/\s/g, "").length,
            sentences: countSentences(clean),
            paragraphs: countParagraphs(clean),
          });
        })
      );
    }
    if (cache.size > files.length) {
      const alive = new Set(files.map((f) => f.path));
      for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
    }
    return cache;
  }

  async wordCountOfFolder(folder) {
    const files = this.flattenFiles(folder);
    const counts = await this.getWordCounts(files);
    let total = 0;
    for (const f of files) total += counts.get(f.path)?.wc || 0;
    return total;
  }

  async updateDailyStats(currentTotal) {
    const key = todayKey();
    const stats = this.settings.stats || {};
    if (!stats[key]) {
      stats[key] = { start: currentTotal, latest: currentTotal };
      this.settings.stats = stats;
      await this.saveSettings();
      return 0;
    }
    if (stats[key].latest !== currentTotal) {
      stats[key].latest = currentTotal;
      this.settings.stats = stats;
      await this.saveSettings();
    }
    return currentTotal - stats[key].start;
  }

  pushHistory(entry) {
    if (!this.moveStack) this.moveStack = [];
    this.moveStack.push(entry);
    if (this.moveStack.length > 30) this.moveStack.shift();
  }

  /* Enfants de `parent` réordonnés selon un instantané de noms pris avant un
     déplacement (voir pushHistory), pour la commande « Annuler le dernier
     déplacement » — dont les deux branches écrivent ensuite le résultat
     différemment (writeOrder / applySiblingOrder). */
  orderFromSnapshot(parent, names) {
    return orderFromSnapshot(this.getOrderedChildren(parent), names);
  }

  async writeOrder(parent, orderedChildren) {
    this.settings.orders[parent.path] = orderedChildren.map((c) => c.name);
    for (let i = 0; i < orderedChildren.length; i++) {
      const child = orderedChildren[i];
      if (child instanceof TFile) {
        const current = parseInt(this.fmOf(child).order, 10);
        if (current !== i + 1) {
          await this.app.fileManager.processFrontMatter(child, (fm) => { fm.order = i + 1; });
        }
      } else {
        this.settings.folderPositions[child.path] = i + 1;
      }
    }
    await this.saveSettings();
  }

  async applySiblingOrder(parent, orderedChildren, recordHistory = true) {
    if (recordHistory) {
      this.pushHistory({
        type: "reorder",
        parentPath: parent.path,
        order: this.getOrderedChildren(parent).map((c) => c.name),
      });
    }
    await this.writeOrder(parent, orderedChildren);
    if (this.settings.autoRename) {
      const root = this.getProjectFolder();
      if (root) await this.renumberTitles(root);
    }
  }

  async moveNode(node, srcParent, destFolder, insertIndex) {
    if (node.path === destFolder.path) return;
    if (node instanceof TFolder && (destFolder.path === node.path || destFolder.path.startsWith(node.path + "/"))) {
      new Notice(t("main.notice.cannotMoveFolderIntoItself"));
      return;
    }
    const destPath = normalizePath(`${destFolder.path}/${node.name}`);
    if (this.app.vault.getAbstractFileByPath(destPath)) {
      new Notice(t("main.notice.alreadyExistsIn", { name: node.name, folder: destFolder.name }));
      return;
    }
    this.pushHistory({
      type: "move",
      nodeName: node.name,
      srcParentPath: srcParent.path,
      destFolderPath: destFolder.path,
      srcOrder: this.getOrderedChildren(srcParent).map((c) => c.name),
      destOrder: this.getOrderedChildren(destFolder).map((c) => c.name),
    });
    const srcRemaining = this.getOrderedChildren(srcParent).filter((c) => c.path !== node.path);
    await this.app.fileManager.renameFile(node, destPath);
    const movedNow = this.app.vault.getAbstractFileByPath(destPath);
    const destChildren = this.getOrderedChildren(destFolder).filter((c) => c.path !== destPath);
    const at = Math.min(insertIndex, destChildren.length);
    destChildren.splice(at, 0, movedNow);
    await this.writeOrder(destFolder, destChildren);
    await this.writeOrder(srcParent, srcRemaining);
    if (this.settings.autoRename) {
      const root = this.getProjectFolder();
      if (root) await this.renumberTitles(root);
    }
    /* Un fichier qui porte EXACTEMENT le nom de son nouveau dossier parent
       devient sa "note de dossier" (synopsis/description, convention
       partagée avec getOrderedChildren dans folder-structure.js) au lieu
       d'une scène normale — donc invisible dans toutes les vues (Binder,
       Cartes, Plan…) sans le moindre signe. Sans cet avertissement,
       glisser par erreur « Postface.md » dans un dossier « Postface » fait
       "disparaître" le fichier sans explication. */
    if (movedNow instanceof TFile && movedNow.basename === destFolder.name) {
      new Notice(
        t("main.notice.becameFolderNote", { name: node.name, folder: destFolder.name }),
        10000
      );
      return;
    }
    new Notice(t("main.notice.moved", { name: this.titleFor(movedNow) || node.name }));
  }

  chapterPattern() {
    const prefix = escapeRegExp(this.settings.renamePrefix || "chapitre");
    return new RegExp(`^${prefix}\\s*\\d+$`, "i");
  }

  async renumberTitles(root) {
    const chapMode = this.settings.chapterNumbering || "continu";
    if (chapMode === "aucune") return 0;
    const pattern = this.chapterPattern();
    const prefix = this.settings.renamePrefix || "chapitre";
    let n = 0;
    let changed = 0;
    const concernsFile = (f) => {
      const fm = this.fmOf(f);
      const title = typeof fm.title === "string" ? fm.title.trim() : "";
      if (title) return pattern.test(title);
      return pattern.test(f.basename);
    };
    const walk = async (f) => {
      if (chapMode === "parPartie" && this.roleOfFolder(f) === "partie") n = 0;
      for (const child of this.getOrderedChildren(f)) {
        if (child instanceof TFolder) {
          if (this.roleOfFolder(child) === "chapitre") {
            n++;
            if (pattern.test(child.name)) {
              const target = `${prefix} ${n}`;
              if (child.name !== target) {
                const destPath = normalizePath(`${f.path}/${target}`);
                if (!this.app.vault.getAbstractFileByPath(destPath)) {
                  const oldPath = child.path;
                  const oldName = child.name;
                  await this.app.fileManager.renameFile(child, destPath);
                  if (this.settings.folderPositions[oldPath] !== undefined) {
                    this.settings.folderPositions[destPath] = this.settings.folderPositions[oldPath];
                    delete this.settings.folderPositions[oldPath];
                  }
                  const savedOrder = this.settings.orders[f.path];
                  if (savedOrder) {
                    const idx = savedOrder.indexOf(oldName);
                    if (idx !== -1) savedOrder[idx] = target;
                  }
                  changed++;
                }
              }
            }
          } else {
            await walk(child);
          }
        } else if (this.roleOfFile(child) === "chapitre") {
          n++;
          if (concernsFile(child)) {
            const target = `${prefix} ${n}`;
            if (this.titleFor(child) !== target) {
              await this.app.fileManager.processFrontMatter(child, (fm) => { fm.title = target; });
              changed++;
            }
          }
        }
      }
    };
    await walk(root);
    if (changed > 0) await this.saveSettings();
    return changed;
  }

  async ensureFolder(path) { return ensureFolder(this.app, path); }
  async snapshotFile(file, root) { return snapshotFile(this.app, file, root); }
  async initProjectStructure() { return initProjectStructure(this.app, this.settings); }

  /** Duplique le dossier manuscrit d'un projet existant (identifié par son
   * chemin) en dossier de référence figé — volontairement PAS ajouté à
   * settings.projects : ce n'est pas un projet basculable, juste une copie
   * qu'on consulte au besoin depuis l'explorateur de fichiers d'Obsidian.
   * Le projet actif ne change pas. */
  async duplicateProject(path, label) {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      new Notice(t("main.notice.folderNotFound"));
      return null;
    }
    let destPath;
    try {
      destPath = await duplicateProjectFolder(this.app, folder, label, this.settings);
    } catch (e) {
      new Notice(e.message || t("main.notice.duplicationImpossible"));
      return null;
    }
    await this.saveSettings();
    new Notice(t("main.notice.versionDuplicated", { path: destPath }), 8000);
    this.renderAllViews(true);
    return destPath;
  }

  getVersionsRoot() { return getVersionsRoot(this.app, this.getProjectFolder()); }

  /** Étiquette de version ("v1", "Premier jet"…) si le fichier vit dans
   * _Versions/<manuscrit> (<étiquette>)/… — sert à préfixer le titre
   * d'onglet, sans quoi une scène ouverte depuis une version archivée
   * affiche exactement le même titre que la scène active du manuscrit
   * (même `titre_binder`, copié tel quel à la duplication). */
  versionLabelForFile(file) {
    const marker = "/_Versions/";
    const idx = file.path.indexOf(marker);
    if (idx === -1) return null;
    const versionFolderName = file.path.slice(idx + marker.length).split("/")[0];
    const m = versionFolderName.match(/\(([^)]*)\)\s*$/);
    return (m ? m[1] : versionFolderName).trim() || null;
  }
  async createDemoProject(kind = "elira") { return createDemoProject(this.app, this.settings, this, kind); }

  async generateCanvasBoard() {
    const result = await generateCanvasBoard(this.app, this.settings);
    if (!result) return;
    const parts = [];
    parts.push(result.added > 0 ? t("main.notice.canvasCardsAdded", { count: result.added }) : t("main.notice.canvasCardsUpToDate", { count: result.total }));
    parts.push(result.edgesAdded > 0 ? t("main.notice.canvasLinksDrawn", { count: result.edgesAdded }) : t("main.notice.canvasNoLinks"));
    const notice = new Notice(`${parts.join(" — ")}. ${t("main.notice.clickToOpen")}`, 8000);
    notice.noticeEl.style.cursor = "pointer";
    notice.noticeEl.addEventListener("click", () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(true), result.file);
    });
  }

  openPdfStyleModal() {
    this.activateProject();
  }

  toggleSearchReplaceBar() {
    if (!this._searchReplaceBar) {
      this._searchReplaceBar = new SearchReplaceBar(this.app, this);
    }
    this._searchReplaceBar.toggle();
  }

  newFolder(parent) { return newFolder(this.app, parent, () => this.renderAllViews(true)); }
  newSheet(folder) { return newSheet(this.app, this.settings, folder); }

  newSheetAt(folder, insertIndex) {
    new NewSheetModal(this.app, folder.name, async (fileName, chapTitle) => {
      const path = normalizePath(`${folder.path}/${fileName}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(t("main.notice.sheetNameExists"));
        return;
      }
      const isFiction = getProjectMode(this.app, this.settings).yamlPreset === "roman";
      const lines = [
        "---",
        `title: ${chapTitle || ""}`,
        "short_title: ",
        "order: 0",
        ...(isFiction ? ["synopsis: "] : ["summary: "]),
        "status: ",
        "label: ",
        `goal: ${this.settings.wordGoal}`,
        "tags: ",
        "date: ",
        "notes: ",
        ...(!isFiction ? ["sources: "] : []),
        "compile: true",
        "---",
        "",
        "",
      ];
      const file = await this.app.vault.create(path, lines.join("\n"));
      const others = this.getOrderedChildren(folder).filter((c) => c.path !== file.path);
      const at = Math.max(0, Math.min(insertIndex, others.length));
      others.splice(at, 0, file);
      await this.applySiblingOrder(folder, others, false);
      this.renderAllViews(true);
      const leaf = this.getLeafForOpeningFile();
      openFileActivating(this.app, leaf, file);
      this.app.workspace.revealLeaf(leaf);
    }).open();
  }

  async activateSidebar() {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(VIEW_SIDEBAR);
    
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
    } else {
      const leftLeaf = workspace.getLeftLeaf(false);
      if (leftLeaf) {
        await leftLeaf.setViewState({ type: VIEW_SIDEBAR, active: true });
        workspace.revealLeaf(leftLeaf);
      }
    }
    await this.activateProjectPanels();
    if (!this.isPanelHidden("journal")) await this.activateJournal();
  }

  async activateBoard() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_BOARD);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_BOARD, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  getLeafForOpeningFile() {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const unpinned = markdownLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = l.pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });
    if (unpinned.length > 0) {
      const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (recent && unpinned.includes(recent)) return recent;
      return unpinned[0];
    }
    const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
    const unpinnedEmpty = emptyLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = l.pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });
    if (unpinnedEmpty.length > 0) return unpinnedEmpty[0];
    return this.app.workspace.getLeaf(false);
  }

  async activateSidebarView(tabId = "project") {
    const workspace = this.app.workspace;
    let leaves = workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS);
    let leaf = leaves.length > 0 ? leaves[0] : null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      if (leaf.view && tabId) {
        leaf.view.activeTab = tabId;
        if (typeof leaf.view.render === "function") {
          await leaf.view.render();
        }
      }
    }
  }

  async activateNotes() { return this.activateSidebarView("notes"); }
  async activateResearch() { return this.activateSidebarView("research"); }
  // "docx" a fusionné avec "project" (voir sidebar-feuillets-view.js) : les
  // deux mènent au même onglet, qui affiche maintenant les deux sections.
  async activateDocxReview() { return this.activateSidebarView("project"); }
  async activateJournal() { return this.activateSidebarView("journal"); }
  async activateProject() { return this.activateSidebarView("project"); }

  async ensureJournalEntry(date) { return ensureDayEntry(this.app, this.settings, date); }
  async compileJournal() { return compileJournal(this.app, this.settings); }
  activePresetConfig() { return activePresetConfig(this.settings); }
  async getOutputFolder() { return getOutputFolder(this.app, this.settings); }
  async compile() { return compile(this.app, this.settings); }
  async exportFile(format = "docx") { return exportFile(this.app, this.settings, format); }
  projectMetaFor(folder) { return projectMetaFor(this.settings, folder); }

  insertIntoActiveEditor(text) {
    const editor = this.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("main.notice.noMarkdownEditor"));
      return;
    }
    const hasSelection = typeof editor.getSelection === "function" && !!editor.getSelection();
    if (hasSelection) {
      editor.replaceSelection(text);
    } else {
      const cursor = editor.getCursor();
      editor.replaceRange(text, cursor);
      editor.setCursor({ line: cursor.line, ch: cursor.ch + text.length });
    }
    new Notice(t("main.notice.contentInserted"));
  }

  /** Sauvegarde automatique périodique (.zip de tout le projet actif dans
   * _Backups) — filet de sécurité en plus des _Versions manuelles, sans
   * dépendre d'un événement de fermeture d'Obsidian (pas fiable pour de
   * l'I/O asynchrone) : un simple minuteur pendant que le coffre est
   * ouvert, comme la sauvegarde périodique de Scrivener. */
  registerAutoBackup() {
    this._lastBackupAt = 0;
    const tick = async () => {
      if (!this.settings.backupEnabled) return;
      const root = this.getProjectFolder();
      if (!root) return;
      const intervalMs = Math.max(1, this.settings.backupIntervalMinutes || 30) * 60 * 1000;
      if (Date.now() - this._lastBackupAt < intervalMs) return;
      this._lastBackupAt = Date.now();
      try {
        await createProjectBackup(this.app, root, this.settings);
      } catch (e) {
        console.error("Feuillets : sauvegarde automatique", e);
      }
    };
    // Vérifié toutes les minutes ; la vraie cadence des sauvegardes est
    // imposée par backupIntervalMinutes (comparaison de date dans tick()).
    // `tick` passé par référence, surtout pas `() => tick()` : la règle
    // obsidianmd/no-sample-code de l'ESLint officiel d'Obsidian plante
    // (TypeError) sur `window.setInterval(() => f(), …)` — elle déréférence
    // `callback.body.callee?.property.type` sans `?.` sur `property`, qui
    // est undefined quand l'appel vise un identifiant simple. Ce plantage
    // faisait échouer toute la revue « Source code » du tableau de bord.
    this.registerInterval(window.setInterval(tick, 60 * 1000));
  }

  async backupProjectNow() {
    const root = this.getProjectFolder();
    if (!root) {
      new Notice(t("analysis.dashboard.noActiveProject"));
      return;
    }
    new Notice(t("main.notice.backupInProgress"));
    try {
      const path = await createProjectBackup(this.app, root, this.settings);
      this._lastBackupAt = Date.now();
      new Notice(t("main.notice.backupCreated", { path }), 8000);
    } catch (e) {
      new Notice(t("main.notice.backupFailed", { error: (e.message || String(e)).slice(0, 200) }));
    }
  }

  registerSwipeGestures() {
    /* Lus à CHAQUE geste, jamais capturés une fois pour toutes : cette
       méthode est appelée depuis onload(), bien avant que la mise en page
       d'Obsidian soit restaurée (onLayoutReady arrive beaucoup plus tard)
       — leftSplit/rightSplit valaient encore undefined à ce moment-là, et
       une capture figée dans des `const` les gardait undefined pour
       toujours, rendant tout le geste silencieusement inopérant. */
    const getLeftSplit = () => this.app.workspace.leftSplit;
    const getRightSplit = () => this.app.workspace.rightSplit;
    const isFichesView = () => !!this.settings.binderTreeCollapsed;

    const toggleFichesViewLight = (collapsed) => {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR)[0];
      const view = leaf && leaf.view;
      if (view && typeof view.toggleTreeCollapsedClasses === "function") {
        view.toggleTreeCollapsedClasses(collapsed);
        return true;
      }
      return false;
    };

    const showFichesView = () => {
      this.settings.binderTreeCollapsed = true;
      this.saveSettings();
      if (!toggleFichesViewLight(true)) this.renderAllViews(true);
    };

    const showDossiersView = () => {
      this.settings.binderTreeCollapsed = false;
      this.saveSettings();
      if (!toggleFichesViewLight(false)) this.renderAllViews(true);
    };

    /* Volet GAUCHE (Binder) : 3 états cycliques (replié → fiches seules →
       dossiers+fiches). `reveal` : true = déployer davantage, false =
       replier davantage — c'est l'appelant (tactile ou trackpad) qui
       traduit un sens de balayage en reveal/replier, jamais l'inverse ici. */
    const executeLeftPanel = (reveal) => {
      const leftSplit = getLeftSplit();
      const rightSplit = getRightSplit();
      if (!this.settings.swipeGesturesEnabled) return;
      if (!leftSplit || !rightSplit) return;
      try {
        if (reveal) {
          if (leftSplit.collapsed) {
            leftSplit.expand();
            showFichesView();
          } else if (isFichesView()) {
            showDossiersView();
          }
        } else if (!leftSplit.collapsed) {
          if (!isFichesView()) showFichesView();
          else leftSplit.collapse();
        }
      } catch (e) {}
    };

    /* Volet DROIT (panneau Feuillets — Inspecteur, ou tout autre panneau
       qui y est ancré) : simple bascule replié/déplié, pas de cycle à 3
       états comme à gauche — rien d'équivalent au mode "fiches seules". */
    const executeRightPanel = (reveal) => {
      const rightSplit = getRightSplit();
      if (!this.settings.swipeGesturesEnabled || !rightSplit) return;
      try {
        if (reveal) {
          if (rightSplit.collapsed) rightSplit.expand();
        } else if (!rightSplit.collapsed) {
          rightSplit.collapse();
        }
      } catch (e) {}
    };

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.closest(".cm-editor")) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    };

    const onTouchEnd = (e) => {
      if (!this.settings.swipeGesturesEnabled || touchStartTime === 0 || e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const duration = Date.now() - touchStartTime;
      touchStartTime = 0;
      if (Math.abs(deltaX) > 80 && Math.abs(deltaY) < 50 && duration < 300) {
        if (touchStartX < window.innerWidth * 0.37) {
          // Près du bord gauche : geste sur le volet gauche.
          executeLeftPanel(deltaX > 0);
        } else if (touchStartX > window.innerWidth * 0.63) {
          // Près du bord droit : geste sur le volet droit, sens inversé
          // (on "tire" le panneau depuis le bord droit vers l'intérieur).
          executeRightPanel(deltaX < 0);
        }
      }
    };

    this.registerDomEvent(window, "touchstart", onTouchStart, { passive: true });
    this.registerDomEvent(window, "touchend", onTouchEnd, { passive: true });

    /* Balayage 2 doigts au trackpad (macOS/Windows precision trackpad) : ne
       déclenche AUCUN événement tactile (touchstart/touchend ci-dessus,
       écrans tactiles uniquement) — un trackpad envoie des événements
       "wheel" avec deltaX/deltaY, jamais des Touch. Le réglage annonçait
       "trackpad / tactile" mais seul le tactile était câblé ; ceci comble
       le trou. On regroupe les événements "wheel" rapprochés en une seule
       "rafale" (comme un seul balayage tactile) pour ne déclencher qu'une
       fois par geste, même si le trackpad envoie des dizaines d'événements
       pendant une seule glissade des doigts. */
    let wheelAccumX = 0;
    let wheelAccumY = 0;
    let wheelLastTime = 0;
    let wheelTriggered = false;
    let wheelStartClientX = 0;

    const onWheel = (e) => {
      if (!this.settings.swipeGesturesEnabled) return;
      if (e.ctrlKey) return; // pincer-zoomer envoie aussi des événements wheel
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.closest(".cm-editor")) return;

      const now = Date.now();
      if (now - wheelLastTime > 200) {
        // Doigts reposés puis relevés depuis > 200ms : nouvelle rafale.
        wheelAccumX = 0;
        wheelAccumY = 0;
        wheelTriggered = false;
        wheelStartClientX = e.clientX;
      }
      wheelLastTime = now;
      wheelAccumX += e.deltaX;
      wheelAccumY += e.deltaY;

      if (wheelTriggered) return;
      /* Pas de zone morte comme au tactile (le curseur traîne souvent côté
         éditeur pendant qu'on écrit) — mais avec DEUX volets possibles, il
         faut malgré tout décider LEQUEL cibler : la moitié de fenêtre où le
         geste démarre tranche, sur toute la largeur, sans zone ignorée. */
      const targetsLeft = wheelStartClientX < window.innerWidth / 2;
      if (targetsLeft ? !getLeftSplit() : !getRightSplit()) return;
      // Dominante horizontale franche, sinon un simple défilement vertical
      // (deltaY) déclencherait le geste par erreur. Seuil abaissé (40, au
      // lieu de 70) : le geste se déclenche avec moins de distance.
      if (Math.abs(wheelAccumX) < 40 || Math.abs(wheelAccumX) < Math.abs(wheelAccumY) * 1.2) return;

      wheelTriggered = true;
      /* Sens du signe deltaX volontairement inversé par rapport à
         l'intuition : confirmé par test (retour utilisateur) que le sens
         "naturel" attendu était inversé sur ce trackpad. */
      if (targetsLeft) executeLeftPanel(wheelAccumX < 0);
      else executeRightPanel(wheelAccumX > 0);
    };

    /* capture:true — indispensable avec des plugins comme Notebook
       Navigator : React attache son propre gestionnaire délégué pour
       "wheel"/"touchstart"/"touchmove" en PHASE DE CAPTURE sur son
       conteneur racine (confirmé dans son bundle : addEventListener(type,
       handler, {capture:true, passive}) pour ces trois types précisément).
       Un écouteur posé en phase de bulles sur `window`, comme avant, arrive
       après coup et peut ne jamais recevoir l'événement si ce gestionnaire
       react stoppe la propagation en chemin. En capture sur `window`, on
       est les tout premiers servis, quoi que fasse un plugin plus bas dans
       l'arbre ensuite. */
    this.registerDomEvent(window, "wheel", onWheel, { passive: true, capture: true });
  }

  // --- GESTION DYNAMIQUE DES PANNEAUX SECONDAIRES ---

  isFeuilletsSidebarActive() {
    const workspace = this.app.workspace;
    if (workspace.leftSplit.collapsed) return false;
    
    const leaves = workspace.getLeavesOfType(VIEW_SIDEBAR);
    if (leaves.length === 0) return false;

    return leaves.some(leaf => {
      return leaf.getRoot() === workspace.leftSplit && this.leafVisible(leaf);
    });
  }

  async syncProjectPanelsVisibility() {
    if (this._isSyncingPanels) return;
    
    const isActive = this.isFeuilletsSidebarActive();

    if (this._lastFeuilletsActive === isActive) return;
    this._isSyncingPanels = true;
    this._lastFeuilletsActive = isActive;

    try {
      if (isActive) {
        await this.activateProjectPanels();
      } else {
        this.deactivateProjectPanels();
      }
    } finally {
      this._isSyncingPanels = false;
    }
  }

  async activateProjectPanels() {
    const workspace = this.app.workspace;
    const oldRightViews = [VIEW_RESEARCH, VIEW_NOTES, VIEW_PROPERTIES, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW];
    for (const viewType of oldRightViews) {
      workspace.getLeavesOfType(viewType).forEach((leaf) => leaf.detach());
    }

    if (workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).length === 0) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_SIDEBAR_FEUILLETS, active: false });
      }
    }
  }

  deactivateProjectPanels() {
    const workspace = this.app.workspace;
    workspace.getLeavesOfType(VIEW_SIDEBAR_FEUILLETS).forEach((leaf) => leaf.detach());
    const oldRightViews = [VIEW_RESEARCH, VIEW_NOTES, VIEW_PROPERTIES, VIEW_JOURNAL, VIEW_PROJECT, VIEW_DOCX_REVIEW];
    for (const viewType of oldRightViews) {
      workspace.getLeavesOfType(viewType).forEach((leaf) => leaf.detach());
    }
  }
}

export default FeuilletsPlugin;