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
import { VIEW_SIDEBAR, VIEW_BOARD, VIEW_NOTES, VIEW_RESEARCH, VIEW_PROGRESSION, VIEW_JOURNAL, VIEW_TAGS, STATUSES, HIDEABLE_PANELS } from "./constants.js";
import { countWords, foldAccents, escapeRegExp, embedHardBreaks, todayKey, parseStoryDate, compactLineBreaks, frenchTypography } from "./utils/core.js";
import { stripWritingNoise, countSentences, countParagraphs } from "./utils/text-metrics.js";
import { nextFootnoteNumber, renumberFootnotes } from "./utils/footnotes.js";
import { highlightActive, isEditing, openFileActivating } from "./utils/dom.js";
import { ResearchView } from "./views/research-view.js";
import { NotesView } from "./views/notes-view.js";
import { ProgressionView } from "./views/progression-view.js";
import { JournalView } from "./views/journal-view.js";
import { TagsView } from "./views/tags-view.js";
import { getResearchTemplate } from "./services/research-templates.js";
import { BaseFeuilletsView } from "./views/base-feuillets-view.js";
import { FeuilletsView } from "./views/feuillets-view.js";
import { BoardView } from "./views/board-view.js";
import { FeuilletsSettingTab } from "./settings/feuillets-setting-tab.js";
import { initScenesEditor } from "./scenes-editor.js";
import { folderNoteFor, getOrCreateFolderNote } from "./services/folder-notes.js";
import { fmOf, titleFor, shortTitleFor, compiledTitleFor, tagsOf, labelOf, labelsOf, labelColor, folderGoal } from "./services/frontmatter.js";
import { getProjectFolder, projectDisplayName, depthOf, isFrontMatter, roleOfFolder, roleOfFile, getOrderedChildren, flattenFiles, chapterCount, getChapters } from "./services/folder-structure.js";
import { getProjectMode } from "./services/project-mode.js";
import { getChronoFolder, getResearchRoot, maybeRenameResearchFile, entityMatchTags, entityMatchNames, findAppearances } from "./services/research.js";
import { handleFilChanged } from "./services/narrative-threads.js";
import { createDemoProject } from "./services/demo-project.js";
import { ensureFolder, snapshotFile, initProjectStructure, newFolder, newSheet } from "./services/project-files.js";
import { activePresetConfig, getOutputFolder, compile, exportFile, projectMetaFor } from "./services/compile-export.js";
import { ensureDayEntry, compileJournal } from "./services/journal.js";
import { ImportOutlineModal } from "./ui/import-outline-modal.js";
import { NewProjectModal, ProjectManagerModal } from "./ui/project-modals.js";
import { NewSheetModal, NewFolderModal } from "./ui/basic-modals.js";

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
} = require("obsidian");


/* ---------- utilitaires ---------- */

/** Convertit les sauts de ligne simples d'un texte en retours forcés
 * (syntaxe standard « \\ » + retour à la ligne, reconnue par toute version
 * de Pandoc, avec ou sans extension). Les paragraphes (lignes vides) et les
 * lignes de structure (titres, listes, citations, code, tableaux, ***) sont
 * laissés intacts pour ne pas casser leur syntaxe Markdown. */

/* ---------- base commune des vues ---------- */

class FeuilletsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerViews();
    this.registerRibbonIcons();
    this.registerCoreCommands();

    this.addSettingTab(new FeuilletsSettingTab(this.app, this));

    this.applyIndentClass();

    this.registerAutoOpenPanels();
    this.registerConcentrationTracking();
    this.registerDragSafetyNet();
    this.registerLiveTypography();
    this.registerStatusBar();
    this.registerTextEditingCommands();
    this.registerVaultEvents();
    this.patchTabTitles();



    initScenesEditor(this);
  }

  registerViews() {
    this.registerView(VIEW_SIDEBAR, (leaf) => new FeuilletsView(leaf, this));
    this.registerView(VIEW_BOARD, (leaf) => new BoardView(leaf, this));
    this.registerView(VIEW_NOTES, (leaf) => new NotesView(leaf, this));
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.registerView(VIEW_PROGRESSION, (leaf) => new ProgressionView(leaf, this));
    this.registerView(VIEW_JOURNAL, (leaf) => new JournalView(leaf, this));
    this.registerView(VIEW_TAGS, (leaf) => new TagsView(leaf, this));
  }

  registerRibbonIcons() {
    this._ribbonDefs = [
      { key: "sidebar", icon: "files", label: "Feuillets : binder", action: () => this.activateSidebar() },
      { key: "board", icon: "layout-grid", label: "Feuillets : cartes / plan", action: () => this.activateBoard() },
      { key: "progression", icon: "trending-up", label: "Feuillets : statistiques", action: () => this.activateProgression(), hideable: true },
      { key: "journal", icon: "calendar", label: "Feuillets : journal d'écriture", action: () => this.activateJournal(), hideable: true },
      { key: "tags", icon: "tags", label: "Feuillets : tags du projet", action: () => this.activateTags(), hideable: true },
      { key: "concentration", icon: "focus", label: "Mode concentration", action: () => this.toggleConcentration() },
    ];
    this._ribbonEls = {};
    this.refreshRibbonIcons();
  }

  /** Ajoute/retire les icônes du ruban des panneaux masquables — appelé au
   * démarrage et à chaque changement du réglage, sans attendre un
   * rechargement d'Obsidian. Les icônes non masquables ne bougent jamais. */
  refreshRibbonIcons() {
    const hidden = new Set(this.settings.hiddenPanels || []);
    for (const def of this._ribbonDefs) {
      const shouldShow = !def.hideable || !hidden.has(def.key);
      const existing = this._ribbonEls[def.key];
      if (shouldShow && !existing) {
        this._ribbonEls[def.key] = this.addRibbonIcon(def.icon, def.label, def.action);
      } else if (!shouldShow && existing) {
        existing.remove();
        delete this._ribbonEls[def.key];
      }
    }
  }

  isPanelHidden(key) {
    return (this.settings.hiddenPanels || []).includes(key);
  }

  /** Masque un panneau latéral depuis n'importe où (bouton du panneau
   * lui-même, ou case des réglages) : même effet garanti aux deux endroits
   * — ruban retiré, feuilles ouvertes fermées, réglage persisté. */
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
      name: "Ouvrir le binder",
      callback: () => this.activateSidebar(),
    });
    this.addCommand({
      id: "open-board",
      name: "Ouvrir les cartes / le plan",
      callback: () => this.activateBoard(),
    });
    this.addCommand({
      id: "open-progression",
      name: "Ouvrir le panneau Statistiques",
      callback: () => {
        if (this.isPanelHidden("progression")) {
          new Notice("Panneau Statistiques masqué — réactive-le dans les réglages.");
          return;
        }
        this.activateProgression();
      },
    });
    this.addCommand({
      id: "open-journal",
      name: "Ouvrir le journal d'écriture",
      callback: () => {
        if (this.isPanelHidden("journal")) {
          new Notice("Journal d'écriture masqué — réactive-le dans les réglages.");
          return;
        }
        this.activateJournal();
      },
    });
    this.addCommand({
      id: "open-tags",
      name: "Ouvrir les tags du projet",
      callback: () => {
        if (this.isPanelHidden("tags")) {
          new Notice("Panneau Tags masqué — réactive-le dans les réglages.");
          return;
        }
        this.activateTags();
      },
    });
    this.addCommand({
      id: "compile-manuscript",
      name: "Compiler le manuscrit",
      callback: () => this.compile(),
    });
    this.addCommand({
      id: "compile-journal",
      name: "Compiler le carnet d'écriture",
      callback: () => this.compileJournal(),
    });
    this.addCommand({
      id: "export-docx",
      name: "Exporter en .docx (Pandoc)",
      callback: () => this.exportFile("docx"),
    });
    this.addCommand({
      id: "export-epub",
      name: "Exporter en .epub (Pandoc)",
      callback: () => this.exportFile("epub"),
    });
    this.addCommand({
      id: "import-outline",
      name: "Importer un plan en arborescence (Parties/Chapitres/Scènes)",
      callback: () => new ImportOutlineModal(this.app, this).open(),
    });
    this.addCommand({
      id: "undo-move",
      name: "Annuler le dernier déplacement",
      callback: async () => {
        if (!this.moveStack || this.moveStack.length === 0) {
          new Notice("Aucun déplacement à annuler.");
          return;
        }
        const snap = this.moveStack.pop();

        if (snap.type === "move") {
          /* replacer le nœud dans son dossier d'origine */
          const srcParent = this.app.vault.getAbstractFileByPath(
            snap.srcParentPath
          );
          const destFolder = this.app.vault.getAbstractFileByPath(
            snap.destFolderPath
          );
          const node = this.app.vault.getAbstractFileByPath(
            normalizePath(`${snap.destFolderPath}/${snap.nodeName}`)
          );
          if (
            !(srcParent instanceof TFolder) ||
            !(destFolder instanceof TFolder) ||
            !node
          ) {
            new Notice("Impossible d'annuler : un élément a changé entre-temps.");
            return;
          }
          const backPath = normalizePath(`${snap.srcParentPath}/${snap.nodeName}`);
          if (this.app.vault.getAbstractFileByPath(backPath)) {
            new Notice("Impossible d'annuler : le nom est repris à l'origine.");
            return;
          }
          await this.app.fileManager.renameFile(node, backPath);
          const restoreOrder = async (folder, names) => {
            const byName = new Map(
              this.getOrderedChildren(folder).map((c) => [c.name, c])
            );
            const restored = names.map((n) => byName.get(n)).filter(Boolean);
            for (const c of byName.values()) {
              if (!restored.includes(c)) restored.push(c);
            }
            await this.writeOrder(folder, restored);
          };
          await restoreOrder(srcParent, snap.srcOrder);
          await restoreOrder(destFolder, snap.destOrder);
          if (this.settings.autoRename) {
            const root = this.getProjectFolder();
            if (root) await this.renumberTitles(root);
          }
          this.renderAllViews(true);
          new Notice("Déplacement inter-dossiers annulé.");
          return;
        }

        const parent = this.app.vault.getAbstractFileByPath(snap.parentPath);
        if (!(parent instanceof TFolder)) {
          new Notice("Le dossier du déplacement n'existe plus.");
          return;
        }
        const byName = new Map(
          this.getOrderedChildren(parent).map((c) => [c.name, c])
        );
        const restored = snap.order
          .map((n) => byName.get(n))
          .filter(Boolean);
        for (const c of byName.values()) {
          if (!restored.includes(c)) restored.push(c);
        }
        await this.applySiblingOrder(parent, restored, false);
        this.renderAllViews(true);
        new Notice("Réorganisation annulée.");
      },
    });
    this.addCommand({
      id: "toggle-concentration",
      name: "Basculer le mode concentration",
      callback: () => this.toggleConcentration(),
    });
    this.addCommand({
      id: "create-project",
      name: "Créer un nouveau projet…",
      callback: () => new NewProjectModal(this.app, this).open(),
    });
    this.addCommand({
      id: "create-demo-project",
      name: "Créer un projet d'exemple (démonstration)",
      callback: () => this.createDemoProject(),
    });
    this.addCommand({
      id: "manage-projects",
      name: "Gestion des projets…",
      callback: () => new ProjectManagerModal(this.app, this).open(),
    });
    this.addCommand({
      id: "switch-project",
      name: "Changer de projet…",
      callback: () => {
        const all = [
          this.settings.projectFolder,
          ...this.settings.projects,
        ].filter((p, i, a) => p && a.indexOf(p) === i);
        if (all.length < 2) {
          new Notice(
            "Ajoute d'autres projets dans les réglages (un chemin par ligne)."
          );
          return;
        }
        const menu = new Menu();
        for (const p of all) {
          menu.addItem((item) =>
            item
              .setTitle(p)
              .setChecked(p === this.settings.projectFolder)
              .onClick(async () => {
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
      id: "next-sheet",
      name: "Feuillet suivant (ordre du manuscrit)",
      callback: () => this.openNeighbor(1),
    });
    this.addCommand({
      id: "previous-sheet",
      name: "Feuillet précédent (ordre du manuscrit)",
      callback: () => this.openNeighbor(-1),
    });
    this.addCommand({
      id: "snapshot-file",
      name: "Snapshot du feuillet actif",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice("Aucun feuillet du projet actif.");
          return;
        }
        const n = await this.snapshotFile(file, root);
        new Notice(`Snapshot créé : ${n}`);
      },
    });
    this.addCommand({
      id: "snapshot-project",
      name: "Snapshot du projet complet",
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice("Dossier projet introuvable.");
          return;
        }
        const files = this.flattenFiles(root);
        for (const f of files) await this.snapshotFile(f, root);
        new Notice(`Snapshot du projet : ${files.length} feuillets copiés.`);
      },
    });
    this.addCommand({
      id: "restore-snapshot",
      name: "Restaurer un snapshot du feuillet actif",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || !file.path.startsWith(root.path + "/")) {
          new Notice("Aucun feuillet du projet actif.");
          return;
        }
        const dirBases = [root.path, root.parent ? root.parent.path : null].filter(
          Boolean
        );
        let folder = null;
        for (const b of dirBases) {
          const f = this.app.vault.getAbstractFileByPath(
            normalizePath(`${b}/_Snapshots/${file.basename}`)
          );
          if (f instanceof TFolder) {
            folder = f;
            break;
          }
        }
        /* "Snapshots" sans underscore : uniquement voisin, jamais dedans */
        if (!folder && root.parent) {
          const f = this.app.vault.getAbstractFileByPath(
            normalizePath(`${root.parent.path}/Snapshots/${file.basename}`)
          );
          if (f instanceof TFolder) folder = f;
        }
        if (!(folder instanceof TFolder) || folder.children.length === 0) {
          new Notice("Aucun snapshot pour ce feuillet.");
          return;
        }
        const snaps = folder.children
          .filter((c) => c instanceof TFile)
          .sort((a, b) => b.name.localeCompare(a.name));
        const menu = new Menu();
        for (const snap of snaps.slice(0, 15)) {
          menu.addItem((item) =>
            item.setTitle(snap.basename).onClick(async () => {
              /* snapshot de l'état actuel avant restauration : rien ne se perd */
              await this.snapshotFile(file, root);
              const content = await this.app.vault.read(snap);
              await this.app.vault.modify(file, content);
              new Notice(`Restauré : ${snap.basename}`);
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "export-settings",
      name: "Sauvegarder les réglages du plugin (fichier .json)",
      callback: async () => {
        const root = this.getProjectFolder();
        const dir = root ? root.path : "";
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const path = normalizePath(
          `${dir ? dir + "/" : ""}feuillets-reglages-${stamp}.json`
        );
        const payload = JSON.stringify(this.settings, null, 2);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, payload);
        } else {
          await this.app.vault.create(path, payload);
        }
        new Notice(`Réglages sauvegardés : ${path}`);
      },
    });
    this.addCommand({
      id: "import-settings",
      name: "Restaurer les réglages du plugin depuis un fichier .json",
      callback: async () => {
        const files = this.app.vault
          .getFiles()
          .filter((f) => f.extension === "json" && f.name.startsWith("feuillets-reglages"));
        if (files.length === 0) {
          new Notice(
            "Aucune sauvegarde trouvée (fichier feuillets-reglages-*.json)."
          );
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
                /* fusion sur les valeurs par défaut : un réglage ajouté depuis
                   la sauvegarde garde sa valeur par défaut au lieu de disparaître */
                this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
                await this.saveSettings();
                this.applyIndentClass();
                this.applyLiveTypoClasses();
                this.renderAllViews(true);
                new Notice(`Réglages restaurés depuis ${f.name}.`);
              } catch (e) {
                console.error("Feuillets : import des réglages", e);
                new Notice("Fichier de réglages illisible ou corrompu.");
              }
            })
          );
        }
        menu.showAtPosition({ x: window.innerWidth / 2, y: 120 });
      },
    });
    this.addCommand({
      id: "migrate-research",
      name: "Regrouper la recherche dans _Recherche (migration)",
      callback: async () => {
        const root = this.getProjectFolder();
        if (!root) {
          new Notice("Dossier projet introuvable.");
          return;
        }
        /* les anciens dossiers _Personnages/_Lieux/_Chronologie, comme
           _Recherche lui-même, peuvent être enfants du dossier projet
           (ancienne convention) ou voisins (quand "Dossier projet" pointe
           directement sur le sous-dossier des parties/chapitres) — les
           deux emplacements sont cherchés pour la source ET la destination. */
        const searchBases = [
          root.path,
          root.parent ? root.parent.path : null,
        ].filter(Boolean);
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
            const cand = this.app.vault.getAbstractFileByPath(
              normalizePath(`${b}/${from}`)
            );
            if (cand) {
              src = cand;
              break;
            }
          }
          if (!src) continue;
          const destPath = normalizePath(`${destBase}/${to}`);
          if (this.app.vault.getAbstractFileByPath(destPath)) {
            new Notice(`« ${to} » existe déjà : « ${from} » laissé en place.`);
            continue;
          }
          await this.app.fileManager.renameFile(src, destPath);
          moved++;
        }
        new Notice(
          moved > 0
            ? `Migration : ${moved} élément(s) déplacé(s) dans _Recherche (liens mis à jour).`
            : "Rien à migrer."
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "init-project",
      name: "Initialiser la structure du projet (_dossiers + bases)",
      callback: () => this.initProjectStructure(),
    });
    this.addCommand({
      id: "renumber-chapters",
      name: "Renuméroter les titres des chapitres",
      callback: async () => {
        const folder = this.getProjectFolder();
        if (!folder) {
          new Notice("Dossier projet introuvable.");
          return;
        }
        const n = await this.renumberTitles(folder);
        new Notice(`${n} titre(s) mis à jour.`);
      },
    });
  }

  registerAutoOpenPanels() {
    this.app.workspace.onLayoutReady(async () => {
      /* dossiers dupliqués récupérés de sessions antérieures (avant que
         la vérification ci-dessous n'existe, ou après un crash) : on ne
         garde que le premier panneau de chaque type, les autres sont
         fermés. Sans ce nettoyage un doublon une fois créé restait figé
         dans workspace.json et réapparaissait à chaque ouverture. */
      for (const type of [VIEW_NOTES, VIEW_SIDEBAR, VIEW_BOARD, VIEW_RESEARCH, VIEW_PROGRESSION, VIEW_JOURNAL, VIEW_TAGS]) {
        const leaves = this.app.workspace.getLeavesOfType(type);
        for (let i = 1; i < leaves.length; i++) leaves[i].detach();
      }
      if (!this.getProjectFolder()) return;
      if (
        this.settings.autoOpenNotes &&
        !this.isPanelHidden("notes") &&
        this.app.workspace.getLeavesOfType(VIEW_NOTES).length === 0
      ) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) await leaf.setViewState({ type: VIEW_NOTES, active: false });
      }
      if (
        this.settings.autoOpenBinder &&
        this.app.workspace.getLeavesOfType(VIEW_SIDEBAR).length === 0
      ) {
        const leaf = this.app.workspace.getLeftLeaf(false);
        if (leaf)
          await leaf.setViewState({ type: VIEW_SIDEBAR, active: false });
      }
      if (
        this.settings.autoOpenResearch &&
        !this.isPanelHidden("research") &&
        this.app.workspace.getLeavesOfType(VIEW_RESEARCH).length === 0
      ) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf)
          await leaf.setViewState({ type: VIEW_RESEARCH, active: false });
      }
      if (
        this.settings.autoOpenStructure &&
        !this.isPanelHidden("progression") &&
        this.app.workspace.getLeavesOfType(VIEW_PROGRESSION).length === 0
      ) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf)
          await leaf.setViewState({ type: VIEW_PROGRESSION, active: false });
      }
      if (
        this.settings.autoOpenJournal &&
        !this.isPanelHidden("journal") &&
        this.app.workspace.getLeavesOfType(VIEW_JOURNAL).length === 0
      ) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf)
          await leaf.setViewState({ type: VIEW_JOURNAL, active: false });
      }

      await this.loadDeferredViews();
    });
    /* un panneau ouvert avec `active: false` (auto-ouverture ci-dessus) ou
       restauré en arrière-plan par la disposition sauvegardée d'Obsidian
       reste "différé" (isDeferred) tant qu'on ne clique pas dessus — son
       onOpen() ne s'exécute jamais tant qu'il n'est pas chargé pour de bon,
       donc les écouteurs qu'il y enregistre ("file-open" notamment)
       n'existent tout simplement pas encore. Contrairement à la tentative
       précédente, on se contente ICI de forcer le chargement — on ne
       redéclenche PAS nous-mêmes le rendu, pour laisser chaque vue gérer
       ça avec son propre mécanisme, sans doublon ni course. */
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.loadDeferredViews())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.loadDeferredViews())
    );
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
        if (!this.concentrationActive) return; /* hors du mode : rien */
        this.updateParagraphFocus(editor);
        if (this.settings.concentrationTypewriter && editor) {
          const cur = editor.getCursor();
          editor.scrollIntoView({ from: cur, to: cur }, true);
        }
        /* le compteur relit tout le document : débouncé, pas à chaque
           caractère */
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
    /* FILET DE SÉCURITÉ du glisser-déposer, au niveau du DOCUMENT : si la
       ligne d'origine est détruite en plein glissement (re-rendu déclenché
       par une sauvegarde automatique, par exemple), son événement dragend
       ne part JAMAIS — _dragInProgress restait alors bloqué à true (tous
       les rafraîchissements différés tournaient en boucle sans jamais
       s'exécuter) et les classes de survol restaient posées : c'est la
       ligne « bloquée en surbrillance » qui revenait sans cesse. Le
       document, lui, reçoit toujours la fin du geste. */
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
    /* typographie française à la frappe (adapté de French Typos, T. Crouzet) */
    /* Phase de capture : indispensable pour passer AVANT CodeMirror, sinon
       Entrée est traitée deux fois (bug des deux lignes vides).
       Contrepartie : l'écoute est globale, donc on se restreint strictement
       aux frappes VENANT de l'éditeur, et on se retire si le mode Vim est
       actif — sinon on court-circuiterait ses raccourcis. */
    this.registerDomEvent(
      document,
      "keydown",
      (event) => {
      /* CHEMIN CHAUD : ce gestionnaire capture TOUTES les frappes du
         coffre. On sort au plus vite pour les touches non concernées
         (lettres, flèches…) AVANT tout accès DOM ou workspace — sinon
         chaque caractère tapé paie closest() + getActiveViewOfType(). */
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
      /* la frappe doit venir de l'éditeur lui-même, pas d'un champ de
         recherche, d'une modale ou d'un autre plugin */
      const target = event.target;
      if (!target || !target.closest || !target.closest(".cm-editor")) return;
      /* mode Vim : on ne touche à rien, ses raccourcis priment */
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
        /* contextuel plutôt qu'alterné : ouvrant en début de ligne ou après
           espace/parenthèse/tiret, fermant sinon — plus robuste qu'un état
           global qui se désynchronise */
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
          /* seulement en prose : pas dans une liste, un titre, une citation,
             un bloc de code ou le frontmatter */
          if (/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|>|```|---)/.test(lineText)) {
            /* structure : Entrée normale */
          } else if (
            S.liveDoubleEnter &&
            lineText.trim() === "" &&
            cursor.line > 0
          ) {
            /* 2e Entrée consécutive : la ligne vide courante devient une
               ligne à espace insécable — un blanc VISIBLE, qui survit même
               aux affichages "réduit/invisible" des lignes vides — puis
               nouveau paragraphe en dessous. */
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
          editor.replaceRange(
            "\u2014\u00A0",
            { line: cursor.line, ch: cursor.ch - 3 },
            cursor
          );
        } else if (back2 === "--") {
          event.preventDefault();
          editor.replaceRange(
            "\u2013\u00A0",
            { line: cursor.line, ch: cursor.ch - 2 },
            cursor
          );
        }
      }
      },
      true /* capture : avant CodeMirror */
    );
    this.applyLiveTypoClasses();
  }

  registerStatusBar() {
    /* barre d'état : mots du feuillet actif / objectif + mots du jour */
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("feuillets-status-bar");
    const updateStatus = () => {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => this.updateStatusBar(), 300);
    };
    this.registerEvent(this.app.workspace.on("file-open", updateStatus));
    this.registerEvent(this.app.workspace.on("editor-change", updateStatus));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", updateStatus)
    );
    updateStatus();
  }


  registerTextEditingCommands() {
    this.addCommand({
      id: "split-chronology",
      name: "Extraire et éclater la chronologie active en fichiers uniques",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("Ouvre d'abord le document de chronologie à éclater.");
          return;
        }
        const raw = await this.app.vault.read(file);
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

        /* un titre de niveau 2 ou 3 commençant par une date reconnaissable */
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
          new Notice(
            "Aucun titre daté trouvé (## ou ### suivi d'une date, ex. « ## 1826-06-15 - Titre »)."
          );
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
          const fileName = `${b.date} - ${safeTitle || "sans titre"}`;
          const path = normalizePath(`${chronoFolder.path}/${fileName}.md`);
          if (this.app.vault.getAbstractFileByPath(path)) {
            skipped++;
            continue;
          }
          const synopsis = text.replace(/\n+/g, " ").slice(0, 160).trim();
          const content = [
            "---",
            `titre: ${b.title || b.date}`,
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
          `Chronologie éclatée : ${created} fichier(s) créé(s)` +
            (skipped > 0 ? `, ${skipped} déjà existant(s) ignoré(s).` : ".")
        );
        this.renderAllViews(true);
      },
    });
    this.addCommand({
      id: "open-research",
      name: "Ouvrir le panneau de Recherche",
      callback: async () => {
        if (this.isPanelHidden("research")) {
          new Notice("Panneau Recherche masqué — réactive-le dans les réglages.");
          return;
        }
        const existing = this.app.workspace.getLeavesOfType(VIEW_RESEARCH);
        if (existing.length > 0) {
          this.app.workspace.revealLeaf(existing[0]);
          return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: VIEW_RESEARCH, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });
    this.addCommand({
      id: "open-notes",
      name: "Ouvrir les notes du feuillet (panneau latéral)",
      callback: async () => {
        if (this.isPanelHidden("notes")) {
          new Notice("Panneau Notes masqué — réactive-le dans les réglages.");
          return;
        }
        const existing = this.app.workspace.getLeavesOfType(VIEW_NOTES);
        if (existing.length > 0) {
          this.app.workspace.revealLeaf(existing[0]);
          return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: VIEW_NOTES, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });
    this.addCommand({
      id: "fix-escaped-scene-breaks",
      name: "Réparer les séparateurs de scène échappés (\\*\\*\\* → ***)",
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = src.replace(/^[ \t]*\\?\*\\?\*\\?\*[ \t]*$/gm, "***");
        if (out === src) {
          new Notice("Rien à réparer.");
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice("Séparateurs de scène réparés.");
      },
    });
    this.addCommand({
      id: "compact-line-breaks",
      name: "Compacter les lignes vides en sauts de ligne simples (sélection ou document)",
      editorCallback: (editor) => {
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.compactLineBreaks(src);
        if (out === src) {
          new Notice("Rien à compacter.");
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else editor.setValue(out);
        new Notice(
          hasSel
            ? "Sélection compactée."
            : "Document compacté — vérifie qu'aucun vrai paragraphe n'a été resserré par erreur."
        );
      },
    });
    this.addCommand({
      id: "insert-scene-separator",
      name: "Insérer un séparateur de scène (***)",
      editorCallback: (editor) => {
        editor.replaceSelection("\n***\n\n");
      },
    });
    this.addCommand({
      id: "french-typography",
      name: "Typographie française (sélection ou document)",
      editorCallback: (editor) => {
        const file = this.app.workspace.getActiveFile();
        const root = this.getProjectFolder();
        if (!file || !root || (root.path !== "" && !file.path.startsWith(root.path + "/"))) {
          new Notice("Cette commande n'est disponible que pour les fichiers du manuscrit.");
          return;
        }
        const hasSel = editor.somethingSelected();
        const src = hasSel ? editor.getSelection() : editor.getValue();
        const out = this.frenchTypography(src, !hasSel);
        if (out === src) {
          new Notice("Rien à corriger.");
          return;
        }
        if (hasSel) editor.replaceSelection(out);
        else {
          const cursor = editor.getCursor();
          editor.setValue(out);
          editor.setCursor(cursor);
        }
        new Notice("Typographie française appliquée.");
      },
    });
    this.addCommand({
      id: "insert-footnote",
      name: "Insérer une note de bas de page",
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
        new Notice(`Note ${n} insérée — définition ajoutée en fin de fichier.`);
      },
    });
    this.addCommand({
      id: "renumber-footnotes",
      name: "Renuméroter les notes de bas de page (1, 2, 3… dans l'ordre d'apparition)",
      editorCallback: (editor) => {
        const src = editor.getValue();
        const out = renumberFootnotes(src);
        if (out === src) {
          new Notice("Rien à renuméroter.");
          return;
        }
        const cursor = editor.getCursor();
        editor.setValue(out);
        editor.setCursor(cursor);
        new Notice("Notes de bas de page renumérotées.");
      },
    });
  }

  registerVaultEvents() {
    /* create/delete/rename changent la STRUCTURE : rafraîchissement
       rapide. modify (déclenché par CHAQUE sauvegarde automatique, soit
       toutes les ~2 s pendant la frappe) ne change que des compteurs :
       on attend une vraie pause d'écriture avant de reconstruire, sinon
       le rendu tombe systématiquement au milieu d'une phrase. */
    const refresh = () => this.refreshView();
    this.registerEvent(this.app.vault.on("create", (file) => {
      refresh();
      this.maybeAutoInitializeResearchFile(file);
    }));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", (file) => {
      refresh();
      this.maybeAutoInitializeResearchFile(file);
    }));
    this.registerEvent(this.app.vault.on("modify", () => this.refreshView(2500)));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) =>
        this.maybeRenameResearchFile(file)
      )
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.handleFilChanged(file))
    );
    /* panneaux marqués périmés (invisibles au moment d'un rendu) :
       rattrapage dès qu'ils redeviennent visibles */
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.renderStaleViews())
    );
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
    if (parentName === rf.sources.label) sectionKey = "sources";
    else if (parentName === rf.bibliographie.label) sectionKey = "bibliographie";
    else if (parentName === rf.personnages.label) sectionKey = "personnages";
    else if (parentName === rf.lieux.label) sectionKey = "lieux";
    else if (parentName === rf.codex.label) sectionKey = "codex";
    else if (parentName === rf.glossaire.label) sectionKey = "glossaire";
    else if (parentName === "Chronologie") sectionKey = "evenements";

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
    clearTimeout(this._refreshTimer);
    clearTimeout(this._statusTimer);
    clearTimeout(this._concTimer);
    document.body.removeClass("feuillets-indent");
    document.body.removeClass("feuillets-concentration");
    this.removeConcentrationCounter();
    if (this._escHandler)
      document.removeEventListener("keydown", this._escHandler);
    document.body.removeClass("feuillets-lignesvides-invisible");
    document.body.removeClass("feuillets-lignesvides-reduit");
    document.body.removeClass("feuillets-cesure");
    if (this._originalGetDisplayText) {
      MarkdownView.prototype.getDisplayText = this._originalGetDisplayText;
    }
    this.refreshAllTabHeaders();
  }

  /** Titre d'onglet = `titre_court` du frontmatter s'il est renseigné,
   * sinon le nom du fichier comme d'habitude — pour tout fichier Markdown
   * ouvert, pas seulement ceux du projet actif (le champ n'existe de toute
   * façon que sur les fiches qui le renseignent). Reprise à `onunload()`
   * pour ne jamais laisser une classe de vue Obsidian modifiée derrière
   * nous si le plugin est désactivé. */
  patchTabTitles() {
    const plugin = this;
    this._originalGetDisplayText = MarkdownView.prototype.getDisplayText;
    MarkdownView.prototype.getDisplayText = function () {
      /* try/catch indispensable : cette fonction est appelée par Obsidian
         lui-même à chaque rafraîchissement d'onglet (donc très souvent, et
         dans des contextes internes qu'on ne maîtrise pas) — si elle
         lançait la moindre exception, ça pourrait interrompre en plein
         milieu le cycle de mise à jour interne d'Obsidian et laisser
         d'autres éléments de l'interface (comme le panneau Propriétés natif)
         bloqués sur un état obsolète. Repli garanti sur le comportement
         d'origine dans tous les cas douteux. */
      try {
        if (this.file) {
          const fm = plugin.app.metadataCache.getFileCache(this.file)?.frontmatter;
          const short = fm && fm.titre_court ? String(fm.titre_court).trim() : "";
          if (short) return short;
        }
      } catch (e) {
        /* silencieux : on retombe simplement sur le titre par défaut */
      }
      return plugin._originalGetDisplayText.call(this);
    };
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.refreshTabHeaderFor(file))
    );
    /* onglets déjà ouverts avant le (re)chargement du plugin : leur titre
       ne se recalcule pas tout seul juste parce que getDisplayText a
       changé, il faut le déclencher une première fois explicitement. */
    this.app.workspace.onLayoutReady(() => this.refreshAllTabHeaders());
  }

  /** Force Obsidian à relire getDisplayText() pour les onglets d'un fichier
   * donné — sans ça, le titre affiché ne change qu'au prochain changement
   * de feuille active, pas dès que titre_court est modifié. updateHeader()
   * n'est pas dans l'API publique mais existe bien à l'exécution ; appel
   * protégé pour ne jamais casser si une version future d'Obsidian le retire. */
  refreshTabHeaderFor(file) {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view?.file?.path === file.path && typeof leaf.updateHeader === "function") {
        try {
          leaf.updateHeader();
        } catch (e) {}
      }
    }
  }

  refreshAllTabHeaders() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (typeof leaf.updateHeader === "function") {
        try {
          leaf.updateHeader();
        } catch (e) {}
      }
    }
  }

  /** Marque les lignes du paragraphe contenant le curseur, par
   * positionnement précis (domAtPos) — fiable même quand le document
   * défile. Actif seulement en mode concentration niveau Paragraphe. */
  updateParagraphFocus(editor) {
    if (!this.concentrationActive || this.settings.concentrationUnit === "line")
      return;
    const cm = editor && editor.cm;
    if (!cm || !cm.dom || typeof cm.domAtPos !== "function") return;
    const cur = editor.getCursor().line;
    let start = cur;
    let end = cur;
    while (start > 0 && editor.getLine(start - 1).trim() !== "") start--;
    const last = editor.lastLine();
    while (end < last && editor.getLine(end + 1).trim() !== "") end++;
    /* nettoyage CIBLÉ (liste mémorisée) plutôt que querySelectorAll sur
       tout le document à chaque frappe */
    if (this._paraEls) {
      for (const el of this._paraEls)
        el.classList.remove("feuillets-para-active");
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
      } catch (e) {
        /* ligne hors écran : ignorée */
      }
    }
  }

  /** Compteur flottant en mode concentration : mots du feuillet actif /
   * objectif, coloré selon la tolérance — la barre d'état étant masquée. */
  async updateConcentrationCounter(editor) {
    if (!this.concentrationActive || !this.settings.concentrationCounter) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    if (!this._concCounterEl) {
      this._concCounterEl = document.body.createDiv({
        cls: "feuillets-conc-counter",
      });
    }
    const text = editor ? editor.getValue() : await this.app.vault.cachedRead(file);
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const wc = countWords(body);
    const fm = this.fmOf(file);
    const g = parseInt(fm.objectif, 10);
    const goal = isNaN(g) ? this.settings.wordGoal : g;
    this._concCounterEl.setText(goal > 0 ? `${wc} / ${goal}` : String(wc));
    const tol = this.settings.tolerance;
    this._concCounterEl.removeClass("feuillets-status-hit");
    this._concCounterEl.removeClass("feuillets-status-over");
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol)
        this._concCounterEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol)
        this._concCounterEl.addClass("feuillets-status-over");
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
        document.body.style.setProperty(
          "--feuillets-dim-opacity",
          `${(this.settings.dimOpacity || 35) / 100}`
        );
        document.body.style.setProperty(
          "--feuillets-concentration-width",
          `${this.settings.concentrationWidth || 720}px`
        );
        document.body.toggleClass(
          "feuillets-focus-paragraph",
          this.settings.concentrationUnit === "paragraph"
        );
        document.body.toggleClass(
          "feuillets-focus-line",
          this.settings.concentrationUnit !== "paragraph"
        );
        document.body.addClass("feuillets-concentration");
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) this.updateParagraphFocus(editor);
        if (!this._escHandler) {
          this._escHandler = (e) => {
            if (e.key === "Escape" && this.concentrationActive)
              this.toggleConcentration();
          };
          document.addEventListener("keydown", this._escHandler);
        }
        const ed = this.app.workspace.activeEditor?.editor;
        this.updateConcentrationCounter(ed);
        new Notice("Mode concentration — Échap pour sortir.");
      } else {
        document.body.removeClass("feuillets-concentration");
        this.removeConcentrationCounter();
        clearTimeout(this._concTimer);
        if (this._paraEls) {
          for (const el of this._paraEls)
            el.classList.remove("feuillets-para-active");
          this._paraEls = null;
        }
        try {
          if (!this._savedLeft) this.app.workspace.leftSplit.expand();
          if (!this._savedRight) this.app.workspace.rightSplit.expand();
        } catch (e) {}
      }
    } catch (e) {
      console.error("Feuillets : mode concentration", e);
      new Notice("Erreur du mode concentration (console : Ctrl/Cmd+Maj+I).");
    }
  }

  applyLiveTypoClasses() {
    const S = this.settings;
    document.body.toggleClass(
      "feuillets-lignesvides-invisible",
      S.liveEmptyLines === "invisible"
    );
    document.body.toggleClass(
      "feuillets-lignesvides-reduit",
      S.liveEmptyLines === "reduit"
    );
    document.body.toggleClass("feuillets-cesure", S.liveHyphenation);
    document.body.toggleClass("feuillets-justify-live", !!S.liveJustify);
    document.body.toggleClass("feuillets-lecture-comme-live", S.readingMatchLive !== false);
    if (S.liveHyphenation && !document.body.getAttr("lang")) {
      document.body.setAttr("lang", "fr");
    }
    /* taille de texte du mode lecture, indépendante de celle du Live
       Preview (Obsidian les lie sinon toutes les deux au même réglage) */
    const rfs = S.readingFontSize;
    document.body.toggleClass("feuillets-reading-fs", rfs > 0);
    if (rfs > 0) {
      document.body.style.setProperty("--feuillets-reading-fs", `${rfs}px`);
    } else {
      document.body.style.removeProperty("--feuillets-reading-fs");
    }
  }

  applyIndentClass() {
    document.body.toggleClass("feuillets-indent", this.settings.indentParagraphs);
  }

  /** Série de jours consécutifs avec au moins un mot écrit, jusqu'à aujourd'hui inclus. */
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

  openNeighbor(delta) {
    const root = this.getProjectFolder();
    const current = this.app.workspace.getActiveFile();
    if (!root || !current) return;
    const files = this.flattenFiles(root);
    const idx = files.findIndex((f) => f.path === current.path);
    if (idx === -1) {
      new Notice("Le fichier actif n'appartient pas au projet.");
      return;
    }
    const next = files[idx + delta];
    if (!next) {
      new Notice(delta > 0 ? "Dernier feuillet." : "Premier feuillet.");
      return;
    }
    const leaf = this.getLeafForOpeningFile();
    openFileActivating(this.app, leaf, next);
    this.app.workspace.revealLeaf(leaf);
  }

  async updateStatusBar() {
    if (!this.statusEl) return;
    const file = this.app.workspace.getActiveFile();
    const root = this.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) {
      this.statusEl.setText("");
      return;
    }
    /* tampon de l'éditeur si disponible : plus à jour que le disque et
       sans lecture asynchrone à chaque pause de frappe */
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const content =
      mdView && mdView.file === file && mdView.editor
        ? mdView.editor.getValue()
        : await this.app.vault.cachedRead(file);
    const wc = countWords(content);
    const g = parseInt(this.fmOf(file).objectif, 10);
    const goal = isNaN(g) ? this.settings.wordGoal : g;
    let txt = goal > 0 ? `${wc} / ${goal} mots` : `${wc} mots`;
    const key = todayKey();
    const st = (this.settings.stats || {})[key];
    if (st) {
      const total = await this.wordCountOfFolder(root);
      const delta = total - st.start;
      txt += ` · ${delta >= 0 ? "+" : ""}${delta} aujourd'hui`;
    }
    this.statusEl.setText(txt);
    this.statusEl.removeClass("feuillets-status-hit");
    this.statusEl.removeClass("feuillets-status-over");
    const tol = this.settings.tolerance;
    if (goal > 0) {
      if (wc >= goal - tol && wc <= goal + tol)
        this.statusEl.addClass("feuillets-status-hit");
      else if (wc > goal + tol)
        this.statusEl.addClass("feuillets-status-over");
    }
  }

  /** Convertit les lignes vides entre deux lignes de texte en simples
   * sauts de ligne (utile après un collage Scrivener, qui transforme
   * chaque retour à la ligne en saut de paragraphe complet). Les blocs
   * structurels (titres, listes, citations, code, tableaux, ***) et les
   * lignes déjà entourées de 2+ lignes vides (paragraphes probablement
   * volontaires) sont laissés intacts. */
  compactLineBreaks(text) {
    return compactLineBreaks(text);
  }

  /** Corrections typographiques françaises. skipFrontmatter : préserve l'en-tête. */
  frenchTypography(text, skipFrontmatter) {
    return frenchTypography(text, skipFrontmatter);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    this.trimStats();
    await this.saveData(this.settings);
  }

  /** Conserve N jours d'historique glissant (réglage), purge le reste. 0 = illimité. */
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
      /* ne jamais reconstruire le DOM pendant un glisser-déposer en cours :
         ça remplacerait les éléments cible avant le dépôt */
      if (this._dragInProgress) {
        this._dragRetryCount = (this._dragRetryCount || 0) + 1;
        if (this._dragRetryCount < 10) {
          this.refreshView(delay);
          return;
        }
        this._dragInProgress = false; // déblocage automatique après ~8 secondes
      }
      this._dragRetryCount = 0;
      this.renderAllViews();
    }, delay);
  }

  /** Un panneau caché (onglet en arrière-plan, barre latérale repliée)
   * n'est jamais reconstruit : il est marqué périmé et rendu au moment
   * où il redevient visible. Un tableau ouvert en arrière-plan pendant
   * l'écriture ne coûte donc plus rien. */
  leafVisible(leaf) {
    const el = leaf && leaf.view && leaf.view.containerEl;
    if (!el) return false;
    if (typeof el.isShown === "function") return el.isShown();
    return el.offsetParent !== null;
  }

  renderStaleViews() {
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_RESEARCH]) {
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
    for (const type of [VIEW_SIDEBAR, VIEW_BOARD, VIEW_RESEARCH, VIEW_JOURNAL, VIEW_TAGS]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.view && typeof leaf.view.render === "function") {
          if (!force && !this.leafVisible(leaf)) {
            leaf.view._stale = true;
            continue;
          }
          leaf.view._stale = false;
          leaf.view.render(force);
        }
      }
    }
  }

  getProjectFolder() {
    return getProjectFolder(this.app, this.settings);
  }

  projectMode() {
    return getProjectMode(this.app, this.settings);
  }
  unitLabel() {
    return this.projectMode().unit;
  }
  unitLabelPlural() {
    return this.projectMode().unitPlural;
  }

  hasSources() {
    return this.projectMode().hasSources;
  }

  /** Nom affiché d'un projet : le dossier de volume (parent), pas
   * "Manuscrit" — sinon tous les projets s'appellent pareil dès qu'on
   * suit la convention Manuscrit/Recherche/Snapshots en frères. Repli sur
   * le dernier segment si le chemin ne suit pas cette convention. */
  projectDisplayName(path) {
    return projectDisplayName(path);
  }

  fmOf(file) {
    return fmOf(this.app, file);
  }

  titleFor(file) {
    return titleFor(this.app, file);
  }

  /** Titre court pour les vues denses (plan, binder) : clé `titre_court`
   * si renseignée, sinon le titre normal. Jamais utilisé à la compilation. */
  shortTitleFor(file) {
    return shortTitleFor(this.app, file);
  }

  /** Titre pour la COMPILATION : clé `titre` uniquement, jamais le nom du fichier. */
  compiledTitleFor(file) {
    return compiledTitleFor(this.app, file);
  }

  /** Note de dossier (Partie ou Chapitre) : convention « même nom que le
   * dossier, à l'intérieur » (ex. « Partie I/Partie I.md »), reconnaissable
   * sans dépendre du frontmatter — et donc jamais confondue avec une scène
   * (voir l'exclusion dans getOrderedChildren). */
  folderNoteFor(folder) {
    return folderNoteFor(this.app, folder);
  }

  async getOrCreateFolderNote(folder) {
    return getOrCreateFolderNote(this.app, folder);
  }

  tagsOf(file) {
    return tagsOf(this.app, file);
  }

  labelOf(file) {
    return labelOf(this.app, file);
  }

  labelsOf(file) {
    return labelsOf(this.app, file);
  }

  labelColor(name) {
    return labelColor(this.settings, name);
  }

  folderGoal(folder) {
    return folderGoal(this.settings, folder);
  }

  depthOf(node) {
    return depthOf(this.app, this.settings, node);
  }

  /** "Front" (page de titre, dédicace, préfaces, incipit…) : un dossier
   * enfant direct du projet, jamais numéroté ni compté comme chapitre —
   * ce n'est pas du texte du roman, juste ce qui vient avant. Reste visible
   * et manipulable normalement dans le binder (rôle "partie" pour
   * l'affichage), seule la numérotation l'ignore. */
  isFrontMatter(node) {
    return isFrontMatter(this.app, this.settings, node);
  }

  roleOfFolder(folder) {
    return roleOfFolder(this.app, this.settings, folder);
  }

  roleOfFile(file) {
    return roleOfFile(this.app, this.settings, file);
  }

  /** Un dossier préfixé « _ » (recherche, fiches, chronologie…) est exclu
   * du manuscrit : ni numéroté, ni compilé, ni affiché dans aucune vue.
   * `includeHidden` reste disponible pour les cas internes qui doivent
   * malgré tout parcourir ces dossiers (ex. tout-plier). */
  getOrderedChildren(folder, includeHidden = false) {
    return getOrderedChildren(this.app, this.settings, folder, includeHidden);
  }

  flattenFiles(folder) {
    return flattenFiles(this.app, this.settings, folder);
  }

  chapterCount(root) {
    return chapterCount(this.app, this.settings, root);
  }

  getChapters(root) {
    return getChapters(this.app, this.settings, root);
  }

  /** Chapitres : numérotation continue 1..n sur tout le manuscrit, les
   * parties ne comptent jamais. Scènes selon le réglage : « chapitre.scène »
   * (1.1), « continue » (compteur global propre aux scènes) ou « aucune ». */
  /** Dossier des jalons historiques : le chemin configuré d'abord, puis
   * les emplacements historiques, pour ne casser aucun coffre existant. */
  /** Dossier racine de la recherche (parent du dossier de chronologie) —
   * sert à reconnaître qu'un lien pointe vers une fiche personnage/lieu. */
  /** Renomme un fichier de recherche encore sous son nom provisoire dès
   * que `nom`/`prénom` (personnage) ou `titre` (lieu, événement) est
   * rempli. Ne touche jamais un fichier déjà renommé manuellement — la
   * condition sur le nom provisoire garantit que ça ne joue qu'une fois. */
  async maybeRenameResearchFile(file) {
    return maybeRenameResearchFile(this.app, this.settings, file);
  }

  /** Automatisation du suivi de fils narratifs (voir services/narrative-
   * threads.js) — jamais laissée planter le gestionnaire d'événements
   * d'Obsidian, qui l'appelle à chaque sauvegarde de n'importe quel feuillet. */
  async handleFilChanged(file) {
    try {
      await handleFilChanged(this.app, this.settings, this, file);
    } catch (e) {
      console.error("Feuillets: erreur automatisation fil narratif :", e);
    }
  }

  /** Tags qui identifient une fiche (personnage, lieu…) dans le manuscrit :
   * ses propres tags, moins les tags structurels de catégorie
   * (personnage/lieu/evenement/codex), repliés sans accent/casse. À défaut
   * d'un tag propre, le nom normalisé de la fiche sert d'identifiant —
   * aucune configuration n'est donc obligatoire pour que ça fonctionne. */
  entityMatchTags(entityFile) {
    return entityMatchTags(this.app, entityFile);
  }

  entityMatchNames(entityFile) {
    return entityMatchNames(this.app, entityFile);
  }

  async findAppearances(entityFile) {
    return findAppearances(this.app, this.settings, entityFile);
  }

  getResearchRoot() {
    return getResearchRoot(this.app, this.settings);
  }

  getChronoFolder() {
    return getChronoFolder(this.app, this.settings);
  }

  /** Interprète une clé date : "1826", "1826-05", "1826-05-29",
   * éventuellement suivie d'une précision libre. Partagé entre la
   * chronologie et le panneau Notes. */
  /** `file` est un repli, pas une priorité : si `raw` est vide, on tente
   * d'extraire une date en tête du NOM du fichier ("1826-06-15 - ..."). */
  parseStoryDate(raw, file = null) {
    return parseStoryDate(raw, file);
  }

  buildNumbering(root) {
    const map = new Map();
    const mode = this.settings.sceneNumbering;
    const chapMode = this.settings.chapterNumbering || "continu";
    let n = 0; // chapitres
    let sGlobal = 0; // scènes en mode continu
    const chapLabel = () => (chapMode === "aucune" ? "" : `${n}.`);
    /* Front (page de titre, dédicace, préfaces, incipit…) : jamais compté,
       mais on assigne quand même une entrée vide à chaque fichier qu'il
       contient — sinon les endroits qui font `numbering.get(path)` sans
       filet (String(undefined) ou concaténation directe) afficheraient
       littéralement "undefined" devant le titre. */
    const markFrontMatter = (f) => {
      for (const c of this.getOrderedChildren(f)) {
        map.set(c.path, "");
        if (c instanceof TFolder) markFrontMatter(c);
      }
    };
    const walk = (f) => {
      if (chapMode === "parPartie" && this.roleOfFolder(f) === "partie") {
        n = 0; // la numérotation recommence à chaque partie
      }
      for (const child of this.getOrderedChildren(f)) {
        if (this.isFrontMatter(child)) {
          map.set(child.path, "");
          if (child instanceof TFolder) markFrontMatter(child);
          continue;
        }
        if (child instanceof TFolder) {
          if (this.roleOfFolder(child) === "chapitre") {
            n++;
            map.set(child.path, chapLabel());
            let m = 0;
            const walkScenes = (cf) => {
              for (const sc of this.getOrderedChildren(cf)) {
                if (sc instanceof TFolder) walkScenes(sc);
                else {
                  m++;
                  sGlobal++;
                  if (mode === "continue") map.set(sc.path, String(sGlobal));
                  else if (mode === "aucune") map.set(sc.path, "");
                  else
                    map.set(
                      sc.path,
                      chapMode === "aucune" ? String(m) : `${n}.${m}`
                    );
                }
              }
            };
            walkScenes(child);
          } else {
            walk(child);
          }
        } else {
          n++;
          map.set(child.path, chapLabel());
        }
      }
    };
    walk(root);
    return map;
  }

  /** Cache du compte de mots par fichier, invalidé par date de modification
   * — jamais par vue, par le plugin lui-même, pour que le tableau et le
   * binder partagent le même travail au lieu de relire chacun de son
   * côté. Sans lui, chaque rendu relisait tous les fichiers du manuscrit
   * à chaque sauvegarde (Obsidian sauvegarde en continu pendant l'écriture),
   * d'où un ralentissement perceptible sur un manuscrit de 99 chapitres. */
  async getWordCounts(files) {
    if (!this._wcCache) this._wcCache = new Map();
    const cache = this._wcCache;
    /* chemin rapide : on ne crée AUCUNE promesse pour les fichiers déjà
       en cache (comparaison mtime). Appelé à chaque pause de frappe via
       la barre d'état, ce point allouait N promesses pour N fichiers
       alors que seul le feuillet actif avait changé. */
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

  /** Mots écrits aujourd'hui = total actuel − total au premier relevé du jour. */
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

  /** Écrit un ordre de voisins (frontmatter pour les fichiers, réglages
   * pour les dossiers), sans historique ni renumérotation. */
  async writeOrder(parent, orderedChildren) {
    this.settings.orders[parent.path] = orderedChildren.map((c) => c.name);
    for (let i = 0; i < orderedChildren.length; i++) {
      const child = orderedChildren[i];
      if (child instanceof TFile) {
        const current = parseInt(this.fmOf(child).ordre, 10);
        if (current !== i + 1) {
          await this.app.fileManager.processFrontMatter(child, (fm) => {
            fm.ordre = i + 1;
          });
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

  /** Déplace un fichier ou un dossier vers un autre dossier du projet,
   * à la position demandée, avec garde-fous et historique d'annulation. */
  async moveNode(node, srcParent, destFolder, insertIndex) {
    if (node.path === destFolder.path) return;
    /* pas de dossier dans lui-même ou dans un de ses descendants */
    if (
      node instanceof TFolder &&
      (destFolder.path === node.path ||
        destFolder.path.startsWith(node.path + "/"))
    ) {
      new Notice("Impossible de déplacer un dossier dans lui-même.");
      return;
    }
    const destPath = normalizePath(`${destFolder.path}/${node.name}`);
    if (this.app.vault.getAbstractFileByPath(destPath)) {
      new Notice(
        `« ${node.name} » existe déjà dans « ${destFolder.name} » : déplacement annulé.`
      );
      return;
    }

    /* historique : de quoi tout remettre en place */
    this.pushHistory({
      type: "move",
      nodeName: node.name,
      srcParentPath: srcParent.path,
      destFolderPath: destFolder.path,
      srcOrder: this.getOrderedChildren(srcParent).map((c) => c.name),
      destOrder: this.getOrderedChildren(destFolder).map((c) => c.name),
    });

    const srcRemaining = this.getOrderedChildren(srcParent).filter(
      (c) => c.path !== node.path
    );
    await this.app.fileManager.renameFile(node, destPath);

    /* insérer à la position voulue dans la destination */
    const movedNow = this.app.vault.getAbstractFileByPath(destPath);
    const destChildren = this.getOrderedChildren(destFolder).filter(
      (c) => c.path !== destPath
    );
    const at = Math.min(insertIndex, destChildren.length);
    destChildren.splice(at, 0, movedNow);

    await this.writeOrder(destFolder, destChildren);
    await this.writeOrder(srcParent, srcRemaining);
    if (this.settings.autoRename) {
      const root = this.getProjectFolder();
      if (root) await this.renumberTitles(root);
    }
    new Notice(
      `« ${this.titleFor(movedNow) || node.name} » déplacé vers « ${destFolder.name} ».`
    );
  }

  chapterPattern() {
    const prefix = escapeRegExp(this.settings.renamePrefix || "chapitre");
    return new RegExp(`^${prefix}\\s*\\d+$`, "i");
  }

  async renumberTitles(root) {
    const chapMode = this.settings.chapterNumbering || "continu";
    if (chapMode === "aucune") return 0; // pas de renommage sans numérotation
    const pattern = this.chapterPattern();
    const prefix = this.settings.renamePrefix || "chapitre";
    let n = 0;
    let changed = 0;

    const concernsFile = (f) => {
      const fm = this.fmOf(f);
      const t =
        typeof fm.titre === "string"
          ? fm.titre.trim()
          : typeof fm.title === "string"
          ? fm.title.trim()
          : "";
      if (t) return pattern.test(t);
      return pattern.test(f.basename);
    };

    const walk = async (f) => {
      if (chapMode === "parPartie" && this.roleOfFolder(f) === "partie") {
        n = 0;
      }
      for (const child of this.getOrderedChildren(f)) {
        if (child instanceof TFolder) {
          if (this.roleOfFolder(child) === "chapitre") {
            n++;
            /* les dossiers-chapitres n'ont pas de frontmatter : la
               correspondance se fait directement sur le nom du dossier,
               et seul un nom qui suit déjà le motif est renommé — un
               titre personnalisé n'est jamais touché, comme pour les
               fichiers. */
            if (pattern.test(child.name)) {
              const target = `${prefix} ${n}`;
              if (child.name !== target) {
                const destPath = normalizePath(`${f.path}/${target}`);
                if (!this.app.vault.getAbstractFileByPath(destPath)) {
                  const oldPath = child.path;
                  const oldName = child.name;
                  await this.app.fileManager.renameFile(child, destPath);
                  /* migre les caches de position pour éviter de retomber
                     sur un tri alphabétique (faux dès qu'on dépasse 9 :
                     "chapitre 10" avant "chapitre 2") */
                  if (this.settings.folderPositions[oldPath] !== undefined) {
                    this.settings.folderPositions[destPath] =
                      this.settings.folderPositions[oldPath];
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
              await this.app.fileManager.processFrontMatter(child, (fm) => {
                fm.titre = target;
              });
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

  async ensureFolder(path) {
    return ensureFolder(this.app, path);
  }

  /** Copie datée du feuillet dans _Snapshots/<nom>/<horodatage>.md. Comme
   * _Recherche, ce dossier peut être un enfant du dossier projet (ancienne
   * convention) ou son voisin (quand "Dossier projet" pointe directement
   * sur le sous-dossier des parties/chapitres) — les deux emplacements
   * existants sont respectés ; à défaut, créé en voisin. */
  async snapshotFile(file, root) {
    return snapshotFile(this.app, file, root);
  }

  /** Crée les dossiers _ et les fichiers Bases (personnages, lieux). */
  async initProjectStructure() {
    return initProjectStructure(this.app, this.settings);
  }

  /** Génère un projet Feuillets complet et déjà rempli (voir
   * services/demo-project.js) — sert de documentation vivante du plugin. */
  async createDemoProject() {
    return createDemoProject(this.app, this.settings, this);
  }

  newFolder(parent) {
    return newFolder(this.app, parent, () => this.renderAllViews(true));
  }

  newSheet(folder) {
    return newSheet(this.app, this.settings, folder);
  }

  /** Crée un feuillet inséré à une position précise parmi les voisins
   * (menu contextuel « avant / après »), puis réordonne et renumérote. */
  newSheetAt(folder, insertIndex) {
    new NewSheetModal(this.app, folder.name, async (fileName, chapTitle) => {
      const path = normalizePath(`${folder.path}/${fileName}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice("Un feuillet portant ce nom existe déjà.");
        return;
      }
      const isFiction = getProjectMode(this.app, this.settings).yamlPreset === "roman" || getProjectMode(this.app, this.settings).yamlPreset === "nouvelle";
      const lines = [
        "---",
        `titre: ${chapTitle || ""}`,
        "titre_court: ",
        "ordre: 0",
        ...(isFiction ? ["synopsis: "] : ["resume: "]),
        "statut: ",
        "label: ",
        `objectif: ${this.settings.wordGoal}`,
        "tags: ",
        "date: ",
        "notes: ",
        ...(!isFiction ? ["sources: "] : []),
        "compiler: true",
        "---",
        "",
        "",
      ];
      const file = await this.app.vault.create(path, lines.join("\n"));
      const others = this.getOrderedChildren(folder).filter(
        (c) => c.path !== file.path
      );
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
    const existing = this.app.workspace.getLeavesOfType(VIEW_SIDEBAR);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
    } else {
      const leaf = this.app.workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: VIEW_SIDEBAR, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
    /* le binder et le panneau Statistiques vont ensemble — ouvrir l'un
       ouvre l'autre, pas seulement au démarrage d'Obsidian — sauf si ce
       panneau a été explicitement masqué dans les réglages. */
    if (!this.isPanelHidden("progression")) await this.activateProgression();
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
    // 1. Chercher un onglet Markdown non épinglé dans l'espace principal de travail
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const unpinned = markdownLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = l.pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });

    if (unpinned.length > 0) {
      /* préférer l'onglet actuellement actif s'il est éligible : sinon,
         cliquer un feuillet du binder détournait toujours le PREMIER
         onglet ouvert dans l'espace principal (peu importe l'onglet
         réellement affiché/actif), et le binder n'affichait alors plus
         jamais le bon feuillet en surbrillance. */
      const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (recent && unpinned.includes(recent)) return recent;
      return unpinned[0];
    }

    // 2. Chercher un onglet vide non épinglé dans l'espace principal
    const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
    const unpinnedEmpty = emptyLeaves.filter(l => {
      const inSidebar = l.getRoot() === this.app.workspace.leftSplit || l.getRoot() === this.app.workspace.rightSplit;
      const pinned = l.pinned || (l.getViewState && l.getViewState().pinned);
      return !inSidebar && !pinned;
    });

    if (unpinnedEmpty.length > 0) {
      return unpinnedEmpty[0];
    }

    // 3. Repli standard
    return this.app.workspace.getLeaf(false);
  }

  async activateProgression() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_PROGRESSION);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_PROGRESSION, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async activateJournal() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_JOURNAL);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_JOURNAL, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async activateTags() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TAGS);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TAGS, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async ensureJournalEntry(date) {
    return ensureDayEntry(this.app, this.settings, date);
  }

  async compileJournal() {
    return compileJournal(this.app, this.settings);
  }

  /** Compilation : parties → chapitres → textes des scènes.
   * Aucun nom technique de fichier n'apparaît : seuls les noms de dossiers
   * et la clé `titre` du frontmatter sont utilisés. */
  activePresetConfig() {
    return activePresetConfig(this.settings);
  }

  /** Dossier de sortie de la compilation et des exports — à côté du dossier
   * projet (comme _Recherche et _Snapshots), jamais dedans : le manuscrit
   * compilé ne doit jamais apparaître comme un feuillet de plus dans tes
   * propres vues. Créé automatiquement s'il n'existe pas. */
  async getOutputFolder() {
    return getOutputFolder(this.app, this.settings);
  }

  async compile() {
    return compile(this.app, this.settings);
  }

  /** Compile puis convertit via Pandoc vers .docx ou .epub, avec page de
   * titre. Le .docx utilise le document de référence (Times 12, interligne
   * double, marges 2,5 cm, numéros de page, saut de page par chapitre).
   * Pour un PDF : exporter en .docx puis imprimer/exporter depuis Word. */
  async exportFile(format = "docx") {
    return exportFile(this.app, this.settings, format);
  }

  projectMetaFor(folder) {
    return projectMetaFor(this.settings, folder);
  }

  insertIntoActiveEditor(text) {
    const activeEditor = this.app.workspace.activeEditor;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    const recentView = recentLeaf && recentLeaf.view instanceof MarkdownView ? recentLeaf.view : null;
    const editor =
      (activeEditor && activeEditor.editor) ||
      (activeView && activeView.editor) ||
      (recentView && recentView.editor);

    if (!editor) {
      new Notice("Aucun éditeur Markdown détecté. Clique d’abord dans ton brouillon, puis reviens au panneau.");
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
    new Notice("Contenu inséré dans le brouillon.");
  }
}

export default FeuilletsPlugin;
