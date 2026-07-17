const { ItemView, TFolder, TFile } = require("obsidian");

import { VIEW_TAGS } from "../constants.js";
import { foldAccents } from "../utils/core.js";
import { buildTagTree, collectFiles, sortTagNodes } from "../utils/tag-tree.js";
import { iconBtn } from "../utils/dom.js";

const STRUCTURAL_TAGS = new Set([
  "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
]);

function nodeMatchesSearch(node, term) {
  if (!term) return true;
  if (foldAccents(node.fullPath).includes(term)) return true;
  for (const child of node.children.values()) {
    if (nodeMatchesSearch(child, term)) return true;
  }
  return false;
}

export class TagsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.expandedTags = new Set();
    this.search = "";
  }
  getViewType() {
    return VIEW_TAGS;
  }
  getDisplayText() {
    return "Tags";
  }
  getIcon() {
    return "tags";
  }
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    await this.render();
  }

  /** Fichiers des fiches Recherche (Personnages/Lieux/Chronologie/Codex et
   * tout ce qu'ils contiennent) — parcourus tels quels, sans créer les
   * dossiers s'ils n'existent pas encore (vue en lecture seule). */
  getResearchFiles() {
    const researchRoot = this.plugin.getResearchRoot();
    if (!(researchRoot instanceof TFolder)) return [];
    const files = [];
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    walk(researchRoot);
    return files;
  }

  async render() {
    const container = this.contentEl;
    container.empty();
    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Configure d'abord un dossier projet dans les réglages.");
      return;
    }

    const sceneFiles = this.plugin.flattenFiles(root);
    const researchFiles = this.getResearchFiles();
    const allFiles = [...sceneFiles, ...researchFiles];
    this.fileIndex = new Map(allFiles.map((f) => [f.path, f]));

    const filesWithTags = allFiles.map((f) => ({
      path: f.path,
      tags: this.plugin.tagsOf(f).filter((t) => !STRUCTURAL_TAGS.has(foldAccents(t))),
    }));
    const tree = buildTagTree(filesWithTags);

    const searchBar = wrapper.createDiv({ cls: "feuillets-tags-search-bar" });
    const searchInput = searchBar.createEl("input", {
      type: "text",
      cls: "feuillets-tags-search",
      attr: { placeholder: "Filtrer les tags…" },
    });
    searchInput.value = this.search;
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value;
      this.renderTree(treeContainer, tree);
    });


    const treeContainer = wrapper.createDiv({ cls: "feuillets-tags-tree" });
    this.renderTree(treeContainer, tree);
  }

  renderTree(container, tree) {
    container.empty();
    const term = foldAccents(this.search.trim());
    const roots = sortTagNodes(tree).filter((n) => nodeMatchesSearch(n, term));

    if (roots.length === 0) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText(term ? "Aucun tag ne correspond." : "Aucun tag dans ce projet.");
      return;
    }

    for (const node of roots) {
      this.renderNode(container, node, 0, term);
    }
  }

  renderNode(container, node, depth, term) {
    const key = node.fullPath;
    const forceOpen = !!term;
    const isExpanded = forceOpen || this.expandedTags.has(key);

    const row = container.createDiv({ cls: "feuillets-tags-row" });
    row.style.paddingLeft = `${depth * 16}px`;
    row.createSpan({ cls: "feuillets-chevron" }).setText(isExpanded ? "▾" : "▸");
    row.createSpan({ cls: "feuillets-tags-name" }).setText(`#${node.fullPath}`);
    row.createSpan({ cls: "feuillets-tags-count" }).setText(String(collectFiles(node).size));
    row.addEventListener("click", () => {
      if (this.expandedTags.has(key)) this.expandedTags.delete(key);
      else this.expandedTags.add(key);
      this.render();
    });

    if (!isExpanded) return;

    for (const child of sortTagNodes(node.children)) {
      if (!nodeMatchesSearch(child, term)) continue;
      this.renderNode(container, child, depth + 1, term);
    }

    const files = [...node.files]
      .map((p) => this.fileIndex.get(p))
      .filter(Boolean)
      .sort((a, b) => this.plugin.shortTitleFor(a).localeCompare(this.plugin.shortTitleFor(b), "fr"));

    for (const file of files) {
      const frow = container.createDiv({ cls: "feuillets-tags-file-row" });
      frow.style.paddingLeft = `${(depth + 1) * 16}px`;
      frow.setText(this.plugin.shortTitleFor(file));
      frow.addEventListener("click", (e) => {
        e.stopPropagation();
        this.app.workspace.getLeaf(false).openFile(file);
      });
    }
  }
}
