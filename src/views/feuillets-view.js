import { VIEW_SIDEBAR, STATUSES } from "../constants.js";
import { foldAccents } from "../utils/core.js";
import { highlightActive, isEditing, getActiveFileSafe } from "../utils/dom.js";
import { ImportOutlineModal } from "../ui/import-outline-modal.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

const { Menu, TFile, TFolder, setIcon } = require("obsidian");

export class FeuilletsView extends BaseFeuilletsView {
  getViewType() {
    return VIEW_SIDEBAR;
  }

  getDisplayText() {
    return "Feuillets";
  }

  getIcon() {
    return "files";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateActiveHighlight();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateActiveHighlight())
    );
    await this.render();
  }

  updateActiveHighlight() {
    highlightActive(this.contentEl, getActiveFileSafe(this.app)?.path);
  }

  async render(force = false) {
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-container");

    const folder = this.getProjectFolder();
    const S = this.plugin.settings;

    const header = container.createDiv({ cls: "feuillets-header" });
    const actions = header.createDiv({ cls: "feuillets-actions" });
    this.iconBtn(actions, "layout-grid", "Tableau / plan", () =>
      this.plugin.activateBoard()
    );
    const addBtn = this.iconBtn(
      actions,
      "file-plus",
      "Nouveau feuillet (racine)"
    );
    const addFolderBtn = this.iconBtn(
      actions,
      "folder-plus",
      "Nouveau dossier / importer un plan"
    );
    const layoutBtn = this.iconBtn(
      actions,
      S.binderLayout === "split" ? "list-tree" : "columns-2",
      S.binderLayout === "split"
        ? "Revenir à la vue arbre"
        : "Vue double volet (dossiers | feuillets)"
    );
    layoutBtn.addEventListener("click", async () => {
      S.binderLayout = S.binderLayout === "split" ? "tree" : "split";
      await this.plugin.saveSettings();
      this.render(true);
    });

    if (S.binderLayout === "split") {
      const singleBtn = this.iconBtn(
        actions,
        S.binderSinglePane ? "columns-2" : "panel-left",
        S.binderSinglePane
          ? "Afficher les deux volets"
          : "Afficher un seul volet à la fois"
      );
      if (S.binderSinglePane) singleBtn.addClass("feuillets-mode-active");
      singleBtn.addEventListener("click", async () => {
        S.binderSinglePane = !S.binderSinglePane;
        this._singleShowList = false;
        await this.plugin.saveSettings();
        this.render(true);
      });
    }

    if (!folder) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun dossier projet défini (réglages du plugin).");
      addBtn.disabled = true;
      addFolderBtn.disabled = true;
      return;
    }

    addBtn.addEventListener("click", () => this.plugin.newSheet(folder));
    addFolderBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Nouveau dossier…")
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(folder))
      );
      menu.addItem((item) =>
        item
          .setTitle("Importer un plan…")
          .setIcon("list-tree")
          .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
      );
      menu.showAtMouseEvent(e);
    });

    const filterBar = header.createDiv({ cls: "feuillets-binder-filters" });

    const searchWrap = filterBar.createDiv({ cls: "feuillets-search-wrap" });
    const searchIsOpen =
      this._binderSearchOpen || !!(S.binderSearch || "").trim();
    const searchBtn = this.iconBtn(searchWrap, "search", "Rechercher");
    searchBtn.addEventListener("click", () => {
      this._binderSearchOpen = true;
      this.render(true);
      setTimeout(() => {
        this.contentEl.querySelector(".feuillets-binder-search")?.focus();
      }, 0);
    });
    if (searchIsOpen) searchBtn.addClass("feuillets-mode-active");

    let searchInput = null;
    if (searchIsOpen) {
      searchInput = searchWrap.createEl("input", {
        type: "text",
        cls: "feuillets-binder-search",
        attr: { placeholder: "Rechercher…" },
      });
      searchInput.value = S.binderSearch || "";
      let searchTimer;
      searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const caret = searchInput.selectionStart;
        searchTimer = setTimeout(async () => {
          S.binderSearch = searchInput.value;
          await this.plugin.saveSettings();
          await this.render(true);
          const fresh = this.contentEl.querySelector(".feuillets-binder-search");
          if (fresh) {
            fresh.focus();
            fresh.setSelectionRange(caret, caret);
          }
        }, 200);
      });
      searchInput.addEventListener("blur", () => {
        if (!searchInput.value.trim()) {
          this._binderSearchOpen = false;
          this.render(true);
        }
      });
    }

    const scopeBtn = this.iconBtn(
      filterBar,
      S.binderSearchContent ? "text-search" : "case-sensitive",
      S.binderSearchContent
        ? "Recherche : titres ET texte des feuillets (cliquer pour limiter aux titres)"
        : "Recherche : titres seulement (cliquer pour chercher aussi dans le texte)"
    );
    if (S.binderSearchContent) scopeBtn.addClass("feuillets-mode-active");
    scopeBtn.addEventListener("click", async () => {
      S.binderSearchContent = !S.binderSearchContent;
      await this.plugin.saveSettings();
      this.render(true);
    });

    const statusFilterActive =
      S.binderStatusFilter && S.binderStatusFilter !== "Tous";
    const statusBtn = this.iconBtn(
      filterBar,
      statusFilterActive ? "filter" : "list-filter",
      statusFilterActive
        ? `Filtre de statut : ${S.binderStatusFilter}`
        : "Filtrer par statut"
    );
    if (statusFilterActive) statusBtn.addClass("feuillets-mode-active");
    statusBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      for (const s of ["Tous", ...STATUSES.filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item
            .setTitle(s)
            .setChecked((S.binderStatusFilter || "Tous") === s)
            .onClick(async () => {
              S.binderStatusFilter = s;
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    if ((S.binderSearch || "").trim() || S.binderStatusFilter !== "Tous") {
      const resetBtn = this.iconBtn(
        filterBar,
        "x",
        "Réinitialiser la recherche et le filtre"
      );
      resetBtn.addEventListener("click", async () => {
        S.binderSearch = "";
        S.binderStatusFilter = "Tous";
        this._binderSearchOpen = false;
        await this.plugin.saveSettings();
        this.render(true);
      });
    }

    const searchTerm = foldAccents((S.binderSearch || "").trim());
    let contentIndex = null;
    if (searchTerm && S.binderSearchContent) {
      contentIndex = await this.buildSearchIndex(
        this.plugin.flattenFiles(folder)
      );
      if (this._renderGen !== myGen) return;
    }

    const passesBinderFilter = (file) => {
      const search = searchTerm;
      if (search) {
        const hay = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        );
        let found = hay.includes(search);
        if (!found && contentIndex) {
          const entry = contentIndex.get(file.path);
          if (entry && entry.text.includes(search)) found = true;
        }
        if (!found) return false;
      }
      const sf = S.binderStatusFilter;
      if (sf && sf !== "Tous") {
        const st = this.fm(file).statut || "";
        if (sf === "Sans statut" ? st !== "" : st !== sf) return false;
      }
      return true;
    };

    const binderFilterActive =
      (S.binderSearch || "").trim() !== "" || S.binderStatusFilter !== "Tous";

    const folderHasMatch = (f) => {
      for (const file of this.plugin.flattenFiles(f)) {
        if (passesBinderFilter(file)) return true;
      }
      return false;
    };

    const numbering = this.plugin.buildNumbering(folder);
    const allFiles = this.plugin.flattenFiles(folder);
    const wcCache = await this.plugin.getWordCounts(allFiles);
    if (this._renderGen !== myGen) return;



    const renderFileRow = (
      host,
      file,
      parent,
      i,
      siblings,
      depth,
      dragScopeEl,
      opts = {}
    ) => {
      const hidden =
        file.name.startsWith("_") ||
        parent.name.startsWith("_") ||
        parent.path.includes("/_");
      if (!hidden && !passesBinderFilter(file)) return false;

      const role = hidden ? "cachee" : this.plugin.roleOfFile(file);
      const goal = this.goalFor(file);
      const item = host.createDiv({
        cls:
          role === "scene"
            ? "feuillets-item feuillets-scene"
            : role === "cachee"
            ? "feuillets-item feuillets-hidden"
            : "feuillets-item",
      });
      item.style.paddingLeft = `${20 + depth * 14}px`;
      item.setAttr("data-path", file.path);

      const grip = item.createSpan({ cls: "feuillets-drag-grip" });
      setIcon(grip, "grip-vertical");

      if (!hidden && S.binderShowLabels) {
        const labelName = this.plugin.labelOf(file);
        const color = labelName ? this.plugin.labelColor(labelName) : null;
        if (color) item.style.boxShadow = `inset 3px 0 0 ${color}`;
      }

      const ring = item.createDiv({ cls: "feuillets-ring" });
      if (hidden || !S.binderShowProgress) ring.style.display = "none";

      const body = item.createDiv({ cls: "feuillets-item-body" });
      const nameRow = body.createDiv({ cls: "feuillets-item-name-row" });

      if (!hidden && S.binderShowStatus) {
        const st = this.fm(file).statut || "";
        if (st) {
          const dot = nameRow.createSpan({
            cls: `feuillets-status-dot feuillets-status-dot-${STATUSES.indexOf(st)}`,
          });
          dot.setAttr("title", `Statut : ${st}`);
        }
      }

      const num =
        hidden || opts.outOfProject
          ? ""
          : `${numbering.get(file.path) || ""} `;
      nameRow
        .createSpan({ cls: "feuillets-item-name" })
        .setText(`${num}${this.plugin.shortTitleFor(file)}`);

      if (!hidden && searchTerm && contentIndex) {
        const inTitle = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        ).includes(searchTerm);
        if (!inTitle) {
          const badge = nameRow.createSpan({ cls: "feuillets-search-badge" });
          setIcon(badge, "text-search");
          badge.setAttr("title", "Trouvé dans le texte du feuillet");
        }
      }

      if (!hidden && opts.showPreview && S.listPanePreviewField !== "none") {
        const field = S.listPanePreviewField;
        const lines = S.listPanePreviewLines || 2;
        if (field === "extrait") {
          const prev = body.createDiv({ cls: "feuillets-item-preview" });
          prev.style.maxHeight = `${lines * 1.4}em`;
          this.app.vault.cachedRead(file).then((content) => {
            const raw = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            prev.setText(raw.slice(0, S.excerptLength || 420) || "— vide —");
          });
        } else {
          let text = "";
          if (field === "tags") {
            text = this.plugin.tagsOf(file).map((t) => `#${t}`).join(" ");
          } else {
            text = (this.fm(file)[field] || "").toString().trim();
          }
          if (text) {
            const prev = body.createDiv({ cls: "feuillets-item-preview" });
            prev.style.maxHeight = `${lines * 1.4}em`;
            prev.setText(text);
          }
        }
      }

      if (!hidden && S.binderShowTags) {
        const tags = this.plugin.tagsOf(file);
        if (tags.length > 0) {
          const tagRow = body.createDiv({ cls: "feuillets-tags" });
          for (const t of tags) {
            tagRow.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${t}`);
          }
        }
      }

      if (!hidden) {
        const wc = wcCache.get(file.path)?.wc || 0;
        if (S.binderShowProgress) this.fillRing(ring, wc, goal);
        if (S.binderShowWords) {
          body.createDiv({ cls: "feuillets-item-wc" }).setText(`${wc} mots`);
        }
      }

      item.addEventListener("click", () => {
        /* mis en surbrillance immédiatement, sans attendre les événements
           workspace ("active-leaf-change"/"file-open") : ceux-ci arrivent
           parfois après qu'un autre rendu ait déjà eu lieu, ou pendant que
           le focus transite encore vers la feuille de la scène cliquée —
           on connaît déjà le fichier ciblé, pas besoin de le redéduire. */
        highlightActive(this.contentEl, file.path);
        const leaf = this.plugin.getLeafForOpeningFile();
        leaf.openFile(file, { active: true });
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        this.app.workspace.revealLeaf(leaf);
      });

      if (!hidden) {
        this.attachDragHandlers(grip, item, parent, i, siblings, dragScopeEl);
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showFileContextMenu(e, file, parent, i, siblings);
        });
      }
      return true;
    };

    if (S.binderLayout === "split") {
      this.renderSplitBody(container, folder, {
        S,
        numbering,
        binderFilterActive,
        folderHasMatch,
        renderFileRow,
      });
    } else {
      const list = container.createDiv({ cls: "feuillets-list" });

      const renderLevel = (parent, depth) => {
        const siblings = this.plugin.getOrderedChildren(parent);
        for (let i = 0; i < siblings.length; i++) {
          const child = siblings[i];
          const hidden =
            child.name.startsWith("_") ||
            parent.name.startsWith("_") ||
            parent.path.includes("/_");

          if (child instanceof TFolder) {
            if (!hidden && binderFilterActive && !folderHasMatch(child)) continue;
            const role = hidden ? "cachee" : this.plugin.roleOfFolder(child);
            const row = list.createDiv({
              cls:
                role === "partie"
                  ? "feuillets-folder-row"
                  : role === "cachee"
                  ? "feuillets-folder-row feuillets-hidden"
                  : "feuillets-item feuillets-chapter-folder",
            });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            row.style.cursor = "pointer";
            row.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              this.showFolderContextMenu(e, child, parent, i, siblings);
            });

            if (role === "chapitre" || role === "partie") {
              const ring = row.createDiv({ cls: "feuillets-ring" });
              row
                .createDiv({ cls: "feuillets-item-body" })
                .createDiv({ cls: "feuillets-item-name" })
                .setText(
                  `${numbering.get(child.path) || ""} ${child.name}`.trim()
                );
              const cGoal = this.plugin.folderGoal(child);
              this.plugin.wordCountOfFolder(child).then((wc) => {
                if (S.binderShowProgress) this.fillRing(ring, wc, cGoal);
              });
              if (!S.binderShowProgress) ring.style.display = "none";
            } else {
              row
                .createSpan({ cls: "feuillets-folder-name" })
                .setText(child.name);
            }

            let addSub = null;
            if (!hidden) {
              addSub = row.createSpan({ cls: "feuillets-folder-add" });
              addSub.setText("+");
              addSub.setAttr(
                "title",
                role === "chapitre"
                  ? `Nouvelle ${this.plugin.unitLabel()} dans ce chapitre`
                  : "Nouveau feuillet dans cette partie"
              );
              addSub.addEventListener("click", (e) => {
                e.stopPropagation();
                this.plugin.newSheet(child);
              });
              this.attachDragHandlers(row, row, parent, i, siblings, list);
            }

            row.addEventListener("click", async (e) => {
              if (addSub && (e.target === addSub || addSub.contains(e.target))) return;
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              this.render();
            });

            if (!S.collapsed[child.path] || binderFilterActive) {
              renderLevel(child, depth + 1);
            }
          } else {
            renderFileRow(list, child, parent, i, siblings, depth, list);
          }
        }
      };

      renderLevel(folder, 0);
    }

    this.updateActiveHighlight();
  }

  renderSplitBody(container, root, ctx) {
    const {
      S,
      numbering,
      binderFilterActive,
      folderHasMatch,
      renderFileRow,
    } = ctx;

    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);

    const single = !!S.binderSinglePane;
    const showList = single ? !!this._singleShowList : true;
    if (single) split.addClass("is-single");

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });

    if (single) {
      treePane.toggleClass("is-hidden", showList);
      resizer.addClass("is-hidden");
      listPane.toggleClass("is-hidden", !showList);
    }

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth;
      const onMove = (ev) => {
        S.binderTreeWidth = Math.min(360, Math.max(120, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUp = async () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        await this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    const scopeToggle = treePane.createDiv({ cls: "feuillets-tree-scope" });
    const wholeVault = S.binderSplitScope === "vault";
    const scopeBtn2 = this.iconBtn(
      scopeToggle,
      wholeVault ? "folder-tree" : "vault",
      wholeVault ? "Limiter au dossier projet" : "Afficher tout le coffre"
    );
    scopeBtn2.addEventListener("click", async () => {
      S.binderSplitScope = wholeVault ? "project" : "vault";
      await this.plugin.saveSettings();
      this.render(true);
    });

    const recursive = S.binderSplitRecursive !== false;
    const recBtn = this.iconBtn(
      scopeToggle,
      recursive ? "folder-tree" : "folder",
      recursive
        ? "Volet fichier : sous-dossiers inclus (cliquer pour limiter au dossier sélectionné)"
        : "Volet fichier : dossier sélectionné seulement (cliquer pour inclure les sous-dossiers)"
    );
    if (recursive) recBtn.addClass("feuillets-mode-active");
    recBtn.addEventListener("click", async () => {
      S.binderSplitRecursive = !recursive;
      await this.plugin.saveSettings();
      this.render(true);
    });

    const treeRoot = wholeVault ? this.app.vault.getRoot() : root;

    let selected = this.app.vault.getAbstractFileByPath(S.binderSelectedPath || "");
    const inScope = (f) =>
      f instanceof TFolder &&
      (wholeVault || f.path === root.path || f.path.startsWith(root.path + "/"));

    if (!inScope(selected)) {
      selected = treeRoot;
    }

    const selectFolder = async (f) => {
      S.binderSelectedPath = f.path;
      if (single) this._singleShowList = true;
      await this.plugin.saveSettings();
      this.render(true);
    };

    const rootRow = treePane.createDiv({
      cls: "feuillets-folder-row feuillets-tree-root",
    });
    if (selected.path === treeRoot.path) rootRow.addClass("is-selected");
    const rootIcon = rootRow.createDiv({ cls: "feuillets-cell-icon" });
    setIcon(rootIcon, wholeVault ? "vault" : "book-marked");
    rootRow
      .createSpan({ cls: "feuillets-folder-name" })
      .setText(wholeVault ? this.app.vault.getName() : treeRoot.name);
    rootRow.addEventListener("click", () => selectFolder(treeRoot));

    const renderTreeFolders = (parent, depth) => {
      const siblings = this.plugin.getOrderedChildren(parent);
      for (let i = 0; i < siblings.length; i++) {
        const child = siblings[i];
        if (!(child instanceof TFolder)) continue;
        const hidden = child.name.startsWith("_") || parent.path.includes("/_");
        if (hidden) continue;
        if (binderFilterActive && !folderHasMatch(child)) continue;

        const role = this.plugin.roleOfFolder(child);
        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        if (depth === 0) row.addClass("is-depth-0");
        row.style.paddingLeft = `${6 + depth * 14}px`;
        if (selected.path === child.path) row.addClass("is-selected");

        const grip = row.createSpan({ cls: "feuillets-drag-grip" });
        setIcon(grip, "grip-vertical");

        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, role === "partie" ? "folder" : "folder-open");

        row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);

        const addBtn = row.createSpan({ cls: "feuillets-folder-add" });
        addBtn.setText("+");
        addBtn.setAttr("title", `Ajouter dans « ${child.name} »`);
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const menu = new Menu();
          menu.addItem((item) =>
            item
              .setTitle("Nouveau sous-dossier…")
              .setIcon("folder-plus")
              .onClick(() => this.plugin.newFolder(child))
          );
          menu.addItem((item) =>
            item
              .setTitle("Nouveau feuillet ici")
              .setIcon("file-plus")
              .onClick(async () => {
                await selectFolder(child);
                this.plugin.newSheet(child);
              })
          );
          menu.showAtMouseEvent(e);
        });

        row.addEventListener("click", async (e) => {
          if (e.target === addBtn || addBtn.contains(e.target)) return;
          // Toggle collapse
          if (S.collapsed[child.path]) delete S.collapsed[child.path];
          else S.collapsed[child.path] = true;
          await this.plugin.saveSettings();
          await selectFolder(child);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showFolderContextMenu(e, child, parent, i, siblings);
        });

        this.attachDragHandlers(grip, row, parent, i, siblings, split);

        if (!S.collapsed[child.path] || binderFilterActive) {
          renderTreeFolders(child, depth + 1);
        }
      }
    };

    renderTreeFolders(treeRoot, 0);

    if (single && showList) {
      const back = listPane.createDiv({ cls: "feuillets-single-back" });
      const backIcon = back.createSpan({ cls: "feuillets-cell-icon" });
      setIcon(backIcon, "chevron-left");
      back.createSpan().setText(selected.name);
      back.addEventListener("click", () => {
        this._singleShowList = false;
        this.render(true);
      });
    }

    const listBody = listPane.createDiv({ cls: "feuillets-list" });
    let any = false;

    const renderFilesOf = (folder, depth) => {
      const kids = this.plugin.getOrderedChildren(folder);
      const files = kids.filter((c) => c instanceof TFile);
      if (depth > 0 && files.length > 0) {
        listBody
          .createDiv({ cls: "feuillets-list-subheading" })
          .setText(folder.name);
      }
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (!(child instanceof TFile)) continue;
        const shown = renderFileRow(listBody, child, folder, i, kids, 0, split, {
          showPreview: true,
          outOfProject:
            !child.path.startsWith(root.path + "/") && child.path !== root.path,
        });
        if (shown) any = true;
      }
      if (S.binderSplitRecursive !== false) {
        for (const c of kids) {
          if (c instanceof TFolder) renderFilesOf(c, depth + 1);
        }
      }
    };

    renderFilesOf(selected, 0);

    if (!any) {
      listBody
        .createDiv({ cls: "feuillets-empty" })
        .setText(
          S.binderSplitRecursive !== false
            ? "Aucun feuillet dans ce dossier ni ses sous-dossiers."
            : "Aucun feuillet directement dans ce dossier."
        );
    }
  }
}
