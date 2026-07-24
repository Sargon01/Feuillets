const { Modal, Notice, TFile, TFolder, setIcon } = require("obsidian");
import { foldAccents } from "../utils/core.js";
import { openFileActivating } from "../utils/dom.js";
import { buildTagTree, collectFiles, sortTagNodes } from "../utils/tag-tree.js";
import { ConfirmModal } from "./basic-modals.js";

const STRUCTURAL_TAGS = new Set([
  "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
]);

/* Fichiers du projet + du dossier Recherche — même périmètre que l'ancien
   onglet Propriétés (properties-view.js, dont cette logique est reprise). */
function projectFiles(app, plugin, root) {
  const files = [...plugin.flattenFiles(root)];
  const researchRoot = plugin.getResearchRoot();
  if (researchRoot instanceof TFolder) {
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    walk(researchRoot);
  }
  return files;
}

function activeProjectFile(app, root) {
  const file = app.workspace.getActiveFile();
  if (file instanceof TFile && file.extension === "md" && (file.path === root.path || file.path.startsWith(root.path + "/"))) {
    return file;
  }
  return null;
}

/** Propriétés utilisées dans tout le projet (clé + valeurs distinctes,
 * navigables jusqu'aux fichiers) — ouverte depuis l'icône dédiée de la
 * section "Propriétés du fichier" du panneau Notes (auparavant un onglet à
 * part, "Propriétés" ; fusionnée pour éviter l'aller-retour permanent
 * entre les deux onglets). */
export class ProjectPropertiesModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.expandedProps = new Set();
  }

  onOpen() {
    this.contentEl.addClass("feuillets-project-modal");
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Propriétés du projet" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText("Aucun projet actif.");
      return;
    }
    const activeFile = activeProjectFile(this.app, root);
    const files = projectFiles(this.app, this.plugin, root);
    const fileIndex = new Map(files.map((f) => [f.path, f]));
    const propMap = new Map(); // key -> Map<valueLabel, Set<path>>
    for (const f of files) {
      const fm = this.plugin.fmOf(f);
      for (const [key, value] of Object.entries(fm)) {
        if (key === "tags") continue;
        if (!propMap.has(key)) propMap.set(key, new Map());
        const valMap = propMap.get(key);
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          const label = v === undefined || v === null || v === "" ? "(vide)" : String(v);
          if (!valMap.has(label)) valMap.set(label, new Set());
          valMap.get(label).add(f.path);
        }
      }
    }

    const keys = [...propMap.keys()].sort((a, b) => a.localeCompare(b, "fr"));
    if (keys.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText("Aucune propriété dans ce projet.");
      return;
    }

    const list = contentEl.createDiv({ cls: "feuillets-tags-tree" });
    for (const key of keys) {
      const valMap = propMap.get(key);
      const totalFiles = new Set([...valMap.values()].flatMap((s) => [...s])).size;
      const isExpanded = this.expandedProps.has(key);
      const activeHasKey = activeFile ? key in this.plugin.fmOf(activeFile) : true;
      const canAdd = activeFile && !activeHasKey;

      const row = list.createDiv({ cls: "feuillets-tags-row" });
      row.createSpan({ cls: "feuillets-chevron" }).setText(isExpanded ? "▾" : "▸");
      row.createSpan({ cls: "feuillets-tags-name" }).setText(key);
      row.createSpan({ cls: "feuillets-tags-count" }).setText(String(totalFiles));
      const addBtn = row.createSpan({ cls: "feuillets-tags-add" + (canAdd ? "" : " is-disabled") });
      setIcon(addBtn, "plus");
      addBtn.setAttr("aria-label", canAdd ? `Ajouter « ${key} » au fichier ouvert` : "Déjà présente sur le fichier ouvert");
      if (canAdd) {
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.app.fileManager.processFrontMatter(activeFile, (data) => {
            if (!(key in data)) data[key] = "";
          });
        });
      }
      const delBtn = row.createSpan({ cls: "feuillets-tags-add" });
      setIcon(delBtn, "trash-2");
      delBtn.setAttr("aria-label", `Supprimer « ${key} » de tous les feuillets du projet`);
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new ConfirmModal(
          this.app,
          `Supprimer « ${key} » ?`,
          `Cette propriété sera retirée de ${totalFiles} feuillet${totalFiles > 1 ? "s" : ""} du projet. Cette action ne peut pas être annulée.`,
          "Supprimer",
          async () => {
            const paths = new Set([...valMap.values()].flatMap((s) => [...s]));
            for (const p of paths) {
              const f = fileIndex.get(p);
              if (!f) continue;
              await this.app.fileManager.processFrontMatter(f, (data) => {
                delete data[key];
              });
            }
            new Notice(`« ${key} » supprimée de ${paths.size} feuillet(s).`);
            this.render();
          }
        ).open();
      });
      row.addEventListener("click", () => {
        if (this.expandedProps.has(key)) this.expandedProps.delete(key);
        else this.expandedProps.add(key);
        this.render();
      });
      if (!isExpanded) continue;

      const values = [...valMap.keys()].sort((a, b) => a.localeCompare(b, "fr"));
      for (const val of values) {
        const valKey = `${key} ${val}`;
        const isValExpanded = this.expandedProps.has(valKey);
        const vrow = list.createDiv({ cls: "feuillets-tags-row" });
        vrow.style.paddingLeft = "16px";
        vrow.createSpan({ cls: "feuillets-chevron" }).setText(isValExpanded ? "▾" : "▸");
        vrow.createSpan({ cls: "feuillets-tags-name" }).setText(val);
        vrow.createSpan({ cls: "feuillets-tags-count" }).setText(String(valMap.get(val).size));
        vrow.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.expandedProps.has(valKey)) this.expandedProps.delete(valKey);
          else this.expandedProps.add(valKey);
          this.render();
        });
        if (!isValExpanded) continue;

        const matching = [...valMap.get(val)]
          .map((p) => fileIndex.get(p))
          .filter(Boolean)
          .sort((a, b) => this.plugin.shortTitleFor(a).localeCompare(this.plugin.shortTitleFor(b), "fr"));
        for (const f of matching) {
          const frow = list.createDiv({ cls: "feuillets-tags-file-row" });
          frow.style.paddingLeft = "32px";
          frow.setText(this.plugin.shortTitleFor(f));
          frow.addEventListener("click", (e) => {
            e.stopPropagation();
            openFileActivating(this.app, this.app.workspace.getLeaf(false), f);
            this.close();
          });
        }
      }
    }
  }
}

/** Tags utilisés dans tout le projet, en arbre navigable — même fusion que
 * ProjectPropertiesModal ci-dessus. */
export class ProjectTagsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.expandedTags = new Set();
    this.tagSearch = "";
  }

  onOpen() {
    this.contentEl.addClass("feuillets-project-modal");
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Tags du projet" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText("Aucun projet actif.");
      return;
    }
    const activeFile = activeProjectFile(this.app, root);
    const files = projectFiles(this.app, this.plugin, root);
    const fileIndex = new Map(files.map((f) => [f.path, f]));
    const filesWithTags = files.map((f) => ({
      path: f.path,
      tags: this.plugin.tagsOf(f).filter((t) => !STRUCTURAL_TAGS.has(foldAccents(t))),
    }));
    const tree = buildTagTree(filesWithTags);
    const roots = sortTagNodes(tree);
    if (roots.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText("Aucun tag dans ce projet.");
      return;
    }

    const searchWrap = contentEl.createDiv({ cls: "feuillets-tags-search-bar" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "feuillets-tags-search",
      attr: { placeholder: "Filtrer les tags…" },
    });
    searchInput.value = this.tagSearch;

    const list = contentEl.createDiv({ cls: "feuillets-tags-tree" });

    const nodeMatchesSearch = (node, term) => {
      if (!term) return true;
      if (foldAccents(node.fullPath).includes(term)) return true;
      for (const child of node.children.values()) {
        if (nodeMatchesSearch(child, term)) return true;
      }
      return false;
    };

    const renderTagNode = (node, depth, term) => {
      const key = node.fullPath;
      const isExpanded = !!term || this.expandedTags.has(key);
      const activeTags = activeFile ? this.plugin.tagsOf(activeFile) : [];
      const row = list.createDiv({ cls: "feuillets-tags-row" });
      row.style.paddingLeft = `${depth * 16}px`;
      row.createSpan({ cls: "feuillets-chevron" }).setText(isExpanded ? "▾" : "▸");
      row.createSpan({ cls: "feuillets-tags-name" }).setText(`#${node.fullPath}`);
      row.createSpan({ cls: "feuillets-tags-count" }).setText(String(collectFiles(node).size));
      const canAdd = activeFile && !activeTags.includes(node.fullPath);
      const addBtn = row.createSpan({ cls: "feuillets-tags-add" + (canAdd ? "" : " is-disabled") });
      setIcon(addBtn, "plus");
      addBtn.setAttr("aria-label", canAdd ? `Ajouter #${node.fullPath} au fichier ouvert` : "Déjà présent sur le fichier ouvert");
      if (canAdd) {
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const merged = [...activeTags, node.fullPath];
          await this.app.fileManager.processFrontMatter(activeFile, (data) => {
            data.tags = merged;
          });
        });
      }
      const delBtn = row.createSpan({ cls: "feuillets-tags-add" });
      setIcon(delBtn, "trash-2");
      delBtn.setAttr("aria-label", `Supprimer #${node.fullPath} de tous les feuillets du projet`);
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const count = node.files.size;
        if (count === 0) return;
        new ConfirmModal(
          this.app,
          `Supprimer #${node.fullPath} ?`,
          `Ce tag sera retiré de ${count} feuillet${count > 1 ? "s" : ""} du projet. Cette action ne peut pas être annulée.`,
          "Supprimer",
          async () => {
            for (const p of node.files) {
              const f = fileIndex.get(p);
              if (!f) continue;
              const current = this.plugin.tagsOf(f);
              const next = current.filter((t) => t !== node.fullPath);
              await this.app.fileManager.processFrontMatter(f, (data) => {
                data.tags = next;
              });
            }
            new Notice(`#${node.fullPath} supprimé de ${count} feuillet(s).`);
            this.render();
          }
        ).open();
      });
      row.addEventListener("click", () => {
        if (this.expandedTags.has(key)) this.expandedTags.delete(key);
        else this.expandedTags.add(key);
        this.render();
      });
      if (!isExpanded) return;

      for (const child of sortTagNodes(node.children)) {
        if (nodeMatchesSearch(child, term)) renderTagNode(child, depth + 1, term);
      }

      const filesHere = [...node.files]
        .map((p) => fileIndex.get(p))
        .filter(Boolean)
        .sort((a, b) => this.plugin.shortTitleFor(a).localeCompare(this.plugin.shortTitleFor(b), "fr"));
      for (const f of filesHere) {
        const frow = list.createDiv({ cls: "feuillets-tags-file-row" });
        frow.style.paddingLeft = `${(depth + 1) * 16}px`;
        frow.setText(this.plugin.shortTitleFor(f));
        frow.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf(false), f);
          this.close();
        });
      }
    };

    const renderList = () => {
      list.empty();
      const term = foldAccents(this.tagSearch.trim());
      for (const node of roots) {
        if (nodeMatchesSearch(node, term)) renderTagNode(node, 0, term);
      }
      if (term && list.childElementCount === 0) {
        list.createDiv({ cls: "feuillets-empty" }).setText("Aucun tag ne correspond.");
      }
    };
    renderList();

    let searchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.tagSearch = searchInput.value;
        renderList();
      }, 120);
    });
  }
}
