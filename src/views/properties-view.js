import { TFile, TFolder, Notice, setIcon } from "obsidian";

import { VIEW_PROPERTIES } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { foldAccents } from "../utils/core.js";
import { openFileActivating } from "../utils/dom.js";
import { buildTagTree, collectFiles, sortTagNodes } from "../utils/tag-tree.js";
import { ConfirmModal } from "../ui/basic-modals.js";
import { t } from "../i18n/index.js";

const STRUCTURAL_TAGS = new Set([
  "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
]);

/** Icônes par type de propriété, même esprit que le panneau natif
 * Propriétés d'Obsidian (texte/liste/nombre/case à cocher/date/date+heure),
 * inféré depuis la forme de la valeur (YAML ne stocke pas le type). */
const TYPE_ICONS = {
  text: "text",
  list: "list",
  number: "hash",
  checkbox: "check-square",
  date: "calendar",
  datetime: "calendar-clock",
};

function inferPropertyType(value) {
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  }
  return "text";
}

function nodeMatchesSearch(node, term) {
  if (!term) return true;
  if (foldAccents(node.fullPath).includes(term)) return true;
  for (const child of node.children.values()) {
    if (nodeMatchesSearch(child, term)) return true;
  }
  return false;
}

/** Panneau natif Feuillets remplaçant le panneau "Toutes les propriétés"
 * d'Obsidian (qui liste tout le coffre) — scopé au projet, avec 3
 * sections repliables : les propriétés du fichier ouvert (éditables
 * directement ici, utile quand le bloc propriétés est masqué dans la
 * note elle-même), les propriétés utilisées dans le projet (clé +
 * valeurs distinctes, navigables jusqu'aux fichiers, avec un "+" pour
 * ajouter une propriété existante au fichier ouvert), et les tags du
 * projet (filtre de recherche et "+" pour ajouter un tag existant au
 * fichier ouvert). */
export class PropertiesView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.expandedProps = new Set();
    this.expandedTags = new Set();
    this.tagSearch = "";
  }

  getViewType() {
    return VIEW_PROPERTIES;
  }

  getDisplayText() {
    return t("properties.displayText");
  }

  getIcon() {
    return "list-tree";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.render())
    );
    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    await this.render();
  }

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

  /** Fichier actif s'il appartient au projet, sinon null — sert à la fois
   * pour la section "Fichier ouvert" et pour savoir si les boutons "+"
   * (propriétés/tags du projet) doivent apparaître. */
  getActiveProjectFile(root) {
    const file = this.app.workspace.getActiveFile();
    if (
      file instanceof TFile &&
      file.extension === "md" &&
      (file.path === root.path || file.path.startsWith(root.path + "/"))
    ) {
      return file;
    }
    return null;
  }

  async render() {
    const container = this.targetContainer || this.contentEl;
    if (container.querySelector("input:focus")) return; // ne pas couper la saisie en cours
    container.empty();
    const wrapper = container.createDiv({ cls: "feuillets-project-container" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.noProjectFolder"));
      return;
    }

    const activeFile = this.getActiveProjectFile(root);

    this.renderActiveFileSection(wrapper, root, activeFile);
    this.renderProjectPropertiesSection(wrapper, root, activeFile);
    this.renderProjectTagsSection(wrapper, root, activeFile);
  }

  renderActiveFileSection(wrapper, root, activeFile) {
    const section = wrapper.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "file-text",
      t("properties.openFile.title"),
      "properties",
      "fichier"
    );
    if (collapsed) return;

    if (!activeFile) {
      section
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.openFile.empty"));
      return;
    }

    const fm = this.fm(activeFile);
    const list = section.createDiv({ cls: "feuillets-properties-list" });
    for (const key of Object.keys(fm)) {
      this.renderPropertyRow(list, activeFile, key, fm[key]);
    }

    const addRow = section.createDiv({ cls: "feuillets-properties-add-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("notes.properties.newPropertyPlaceholder") },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const key = input.value.trim();
      if (!key) return;
      await this.app.fileManager.processFrontMatter(activeFile, (data) => {
        if (!(key in data)) data[key] = "";
      });
      await this.render();
      const added = section.querySelector(
        `.feuillets-properties-row[data-key="${CSS.escape(key)}"] .feuillets-properties-value`
      );
      if (added) added.focus();
    });
  }

  renderPropertyRow(list, file, key, value) {
    const type = inferPropertyType(value);
    const row = list.createDiv({ cls: "feuillets-properties-row" });
    row.setAttr("data-key", key);
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, TYPE_ICONS[type] || "text");
    row.createSpan({ cls: "feuillets-properties-key" }).setText(key);

    if (type === "checkbox") {
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = value;
      cb.addEventListener("change", async () => {
        await this.app.fileManager.processFrontMatter(file, (data) => {
          data[key] = cb.checked;
        });
      });
    } else if (type === "list") {
      this.renderListEditor(row, file, key, value);
    } else if (type === "date" || type === "datetime") {
      const input = row.createEl("input", {
        type: type === "date" ? "date" : "datetime-local",
        cls: "feuillets-properties-value",
      });
      input.value = value;
      input.addEventListener("change", async () => {
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (!input.value) delete data[key];
          else data[key] = input.value;
        });
      });
    } else {
      const input = row.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      input.value = value === undefined || value === null ? "" : String(value);
      const save = async () => {
        const raw = input.value;
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (raw.trim() === "") {
            delete data[key];
            return;
          }
          if (type === "number") {
            const num = Number(raw);
            data[key] = Number.isNaN(num) ? raw : num;
          } else {
            data[key] = raw;
          }
        });
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
    }

    const delBtn = row.createSpan({ cls: "feuillets-properties-delete" });
    setIcon(delBtn, "x");
    delBtn.setAttr("aria-label", t("notes.properties.deleteAria", { key }));
    delBtn.addEventListener("click", async () => {
      await this.app.fileManager.processFrontMatter(file, (data) => {
        delete data[key];
      });
      await this.render();
    });
  }

  /** Éditeur à jetons (façon liste de tags) pour une propriété liste —
   * même vocabulaire visuel que l'éditeur de tags natif du plugin
   * (.feuillets-tags/-tag-chip/-tags-input), généralisé à n'importe
   * quelle clé plutôt que réservé à "tags". */
  renderListEditor(row, file, key, values) {
    const wrap = row.createDiv({ cls: "feuillets-tags feuillets-properties-list-editor" });
    values.forEach((v, idx) => {
      const chip = wrap.createSpan({ cls: "feuillets-tag-chip" });
      chip.setText(String(v));
      chip.setAttr("title", t("notes.properties.removeValueTooltip"));
      chip.addEventListener("click", async () => {
        const next = values.filter((_, i) => i !== idx);
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (next.length === 0) delete data[key];
          else data[key] = next;
        });
      });
    });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: values.length ? "+" : t("notes.properties.newValuePlaceholder") },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw.split(",").map((s) => s.trim()).filter(Boolean);
      await this.app.fileManager.processFrontMatter(file, (data) => {
        data[key] = [...values, ...added];
      });
      input.value = "";
      input.blur();
    });
  }

  renderProjectPropertiesSection(wrapper, root, activeFile) {
    const section = wrapper.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "list-tree",
      t("properties.project.title"),
      "properties",
      "proprietes"
    );
    if (collapsed) return;

    const files = [...this.plugin.flattenFiles(root), ...this.getResearchFiles()];
    const fileIndex = new Map(files.map((f) => [f.path, f]));
    const propMap = new Map(); // key -> Map<valueLabel, Set<path>>
    for (const f of files) {
      const fm = this.fm(f);
      for (const [key, value] of Object.entries(fm)) {
        if (key === "tags") continue;
        if (!propMap.has(key)) propMap.set(key, new Map());
        const valMap = propMap.get(key);
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          const label =
            v === undefined || v === null || v === "" ? t("properties.project.emptyValue") : String(v);
          if (!valMap.has(label)) valMap.set(label, new Set());
          valMap.get(label).add(f.path);
        }
      }
    }

    const keys = [...propMap.keys()].sort((a, b) => a.localeCompare(b, "fr"));
    if (keys.length === 0) {
      section
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.project.empty"));
      return;
    }

    const list = section.createDiv({ cls: "feuillets-tags-tree" });
    for (const key of keys) {
      const valMap = propMap.get(key);
      const totalFiles = new Set([...valMap.values()].flatMap((s) => [...s])).size;
      const isExpanded = this.expandedProps.has(key);
      const activeHasKey = activeFile ? key in this.fm(activeFile) : true;

      const canAdd = activeFile && !activeHasKey;
      const row = list.createDiv({ cls: "feuillets-tags-row" });
      row.createSpan({ cls: "feuillets-chevron" }).setText(isExpanded ? "▾" : "▸");
      row.createSpan({ cls: "feuillets-tags-name" }).setText(key);
      row.createSpan({ cls: "feuillets-tags-count" }).setText(String(totalFiles));
      /* Toujours créé (même désactivé) : sinon sa présence/absence d'une
         ligne à l'autre décale le compteur, qui n'est alors plus aligné
         à la même position d'une propriété à l'autre. */
      const addBtn = row.createSpan({ cls: "feuillets-tags-add" + (canAdd ? "" : " is-disabled") });
      setIcon(addBtn, "plus");
      addBtn.setAttr(
        "aria-label",
        canAdd ? t("properties.project.addToOpenFile", { key }) : t("properties.project.alreadyOnOpenFile")
      );
      if (canAdd) {
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.app.fileManager.processFrontMatter(activeFile, (data) => {
            if (!(key in data)) data[key] = "";
          });
        });
      }
      /* Gestion de la propriété à l'échelle du projet : la retirer de
         TOUS les feuillets qui la portent — une confirmation est
         indispensable, l'action touche potentiellement de nombreux
         fichiers d'un coup. */
      const delBtn = row.createSpan({ cls: "feuillets-tags-add" });
      setIcon(delBtn, "trash-2");
      delBtn.setAttr("aria-label", t("properties.project.deleteFromProjectAria", { key }));
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new ConfirmModal(
          this.app,
          t("properties.project.deleteConfirmTitle", { key }),
          t("properties.project.deleteConfirmBody", { count: totalFiles, s: totalFiles > 1 ? "s" : "" }),
          t("properties.project.deleteConfirmBtn"),
          async () => {
            const paths = new Set([...valMap.values()].flatMap((s) => [...s]));
            for (const p of paths) {
              const f = fileIndex.get(p);
              if (!f) continue;
              await this.app.fileManager.processFrontMatter(f, (data) => {
                delete data[key];
              });
            }
            new Notice(t("properties.project.deletedNotice", { key, count: paths.size, s: paths.size > 1 ? "s" : "" }));
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
        vrow.addClass("feuillets-indent-1");
        vrow.createSpan({ cls: "feuillets-chevron" }).setText(isValExpanded ? "▾" : "▸");
        vrow.createSpan({ cls: "feuillets-tags-name" }).setText(val);
        vrow
          .createSpan({ cls: "feuillets-tags-count" })
          .setText(String(valMap.get(val).size));
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
          .sort((a, b) =>
            this.plugin.shortTitleFor(a).localeCompare(this.plugin.shortTitleFor(b), "fr")
          );
        for (const f of matching) {
          const frow = list.createDiv({ cls: "feuillets-tags-file-row" });
          frow.addClass("feuillets-indent-2");
          frow.setText(this.plugin.shortTitleFor(f));
          frow.addEventListener("click", (e) => {
            e.stopPropagation();
            openFileActivating(this.app, this.app.workspace.getLeaf(false), f);
          });
        }
      }
    }
  }

  renderProjectTagsSection(wrapper, root, activeFile) {
    const section = wrapper.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "tags",
      t("properties.tags.title"),
      "properties",
      "tags"
    );
    if (collapsed) return;

    const files = [...this.plugin.flattenFiles(root), ...this.getResearchFiles()];
    const fileIndex = new Map(files.map((f) => [f.path, f]));
    const filesWithTags = files.map((f) => ({
      path: f.path,
      tags: this.plugin.tagsOf(f).filter((tg) => !STRUCTURAL_TAGS.has(foldAccents(tg))),
    }));
    const tree = buildTagTree(filesWithTags);
    const roots = sortTagNodes(tree);
    if (roots.length === 0) {
      section
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("properties.tags.empty"));
      return;
    }

    const searchWrap = section.createDiv({ cls: "feuillets-tags-search-bar" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "feuillets-tags-search",
      attr: { placeholder: t("properties.tags.filterPlaceholder") },
    });
    searchInput.value = this.tagSearch;

    const list = section.createDiv({ cls: "feuillets-tags-tree" });

    /* Un terme de recherche force le dépli de tout le sous-arbre concerné
       (comme l'ancien panneau Tags) : sinon il faudrait déjà avoir
       déplié manuellement une branche pour que la recherche y trouve
       quelque chose à afficher. */
    const renderTagNode = (node, depth, term) => {
      const key = node.fullPath;
      const isExpanded = !!term || this.expandedTags.has(key);
      const activeTags = activeFile ? this.plugin.tagsOf(activeFile) : [];
      const row = list.createDiv({ cls: "feuillets-tags-row" });
      row.style.paddingLeft = `${depth * 16}px`;
      row.createSpan({ cls: "feuillets-chevron" }).setText(isExpanded ? "▾" : "▸");
      row.createSpan({ cls: "feuillets-tags-name" }).setText(`#${node.fullPath}`);
      row
        .createSpan({ cls: "feuillets-tags-count" })
        .setText(String(collectFiles(node).size));
      const canAdd = activeFile && !activeTags.includes(node.fullPath);
      const addBtn = row.createSpan({ cls: "feuillets-tags-add" + (canAdd ? "" : " is-disabled") });
      setIcon(addBtn, "plus");
      addBtn.setAttr(
        "aria-label",
        canAdd ? t("properties.tags.addToOpenFile", { tag: node.fullPath }) : t("properties.tags.alreadyOnOpenFile")
      );
      if (canAdd) {
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.setFm(activeFile, "tags", [...activeTags, node.fullPath]);
        });
      }
      /* Retire ce tag de TOUS les feuillets qui le portent (pas ceux des
         tags enfants, seulement celui-ci) — confirmation indispensable,
         action potentiellement étendue à de nombreux fichiers. */
      const delBtn = row.createSpan({ cls: "feuillets-tags-add" });
      setIcon(delBtn, "trash-2");
      delBtn.setAttr("aria-label", t("properties.tags.deleteFromProjectAria", { tag: node.fullPath }));
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const count = node.files.size;
        if (count === 0) return;
        new ConfirmModal(
          this.app,
          t("properties.tags.deleteConfirmTitle", { tag: node.fullPath }),
          t("properties.project.deleteConfirmBody", { count, s: count > 1 ? "s" : "" }),
          t("properties.project.deleteConfirmBtn"),
          async () => {
            for (const p of node.files) {
              const f = fileIndex.get(p);
              if (!f) continue;
              const current = this.plugin.tagsOf(f);
              await this.setFm(f, "tags", current.filter((tg) => tg !== node.fullPath));
            }
            new Notice(t("properties.tags.deletedNotice", { tag: node.fullPath, count, s: count > 1 ? "s" : "" }));
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
        .sort((a, b) =>
          this.plugin.shortTitleFor(a).localeCompare(this.plugin.shortTitleFor(b), "fr")
        );
      for (const f of filesHere) {
        const frow = list.createDiv({ cls: "feuillets-tags-file-row" });
        frow.style.paddingLeft = `${(depth + 1) * 16}px`;
        frow.setText(this.plugin.shortTitleFor(f));
        frow.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf(false), f);
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
        list.createDiv({ cls: "feuillets-empty" }).setText(t("properties.tags.noMatch"));
      }
    };
    renderList();

    let searchTimer;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        this.tagSearch = searchInput.value;
        renderList();
      }, 120);
    });
  }
}
