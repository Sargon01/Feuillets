const { ItemView, TFolder, TFile } = require("obsidian");
import { VIEW_ARCS } from "../constants.js";
import { openFileActivating } from "../utils/dom.js";

export class ArcsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedArc = ""; // Filtre d'élément actif ("" = tous)
    this.categoryFilter = "all"; // "all" | "fils" | "labels"
    this.displayMode = "table"; // "table" (Tableau lisible) | "rails" (Frise rails)
  }

  getViewType() {
    return VIEW_ARCS;
  }

  getDisplayText() {
    return "Arcs & Lieux";
  }

  getIcon() {
    return "git-branch";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.render())
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.render())
    );
    await this.render();
  }

  async render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("feuillets-arcs-container");

    const root = this.plugin.getProjectFolder();
    if (!root) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText("Configure d'abord un dossier projet dans les réglages.");
      return;
    }

    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

    // 1. Collecte des chapitres et scènes
    const items = [];
    const collect = (folder) => {
      const children = this.plugin.getOrderedChildren(folder);
      for (const child of children) {
        const hidden = child.name.startsWith("_") || child.path.includes("/_");
        if (hidden) continue;

        if (child instanceof TFolder) {
          const role = this.plugin.roleOfFolder(child);
          if (role === "partie" || role === "chapitre") {
            items.push({ type: "folder", folder: child, role });
          }
          collect(child);
        } else if (child instanceof TFile && child.extension === "md") {
          const role = this.plugin.roleOfFile(child);
          if (role === "scene" || role === "chapitre") {
            items.push({ type: "file", file: child });
          }
        }
      }
    };
    collect(root);

    // 2. Extraction simple des lieux et fils
    const parseList = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.flatMap(x => parseList(x));
      return String(val).split(",").map(x => x.trim()).filter(Boolean);
    };

    const getSymbol = (name) => name.slice(0, 2).toUpperCase();

    const scenes = items.filter(x => x.type === "file");
    const arcSet = new Set();
    const sceneArcsMap = new Map();
    const sceneFilsMap = new Map();
    const sceneLabelsMap = new Map();

    for (const sc of scenes) {
      const fm = this.plugin.fmOf(sc.file) || {};
      const fils = [...parseList(fm.fil), ...parseList(fm.fils)];
      const labels = [...parseList(fm.label), ...parseList(fm.labels)];

      sceneFilsMap.set(sc.file.path, fils);
      sceneLabelsMap.set(sc.file.path, labels);

      let list = [];
      if (this.categoryFilter === "fils") list = fils;
      else if (this.categoryFilter === "labels") list = labels;
      else list = [...fils, ...labels];

      list = list.filter((v, i, self) => self.indexOf(v) === i);
      sceneArcsMap.set(sc.file.path, list);
      for (const a of list) arcSet.add(a);
    }

    const allArcs = Array.from(arcSet).sort((a, b) => a.localeCompare(b, "fr"));

    const stringToColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      const h = Math.abs(hash) % 360;
      return `hsl(${h}, 65%, 45%)`;
    };

    // 3. Barre d'outils sobre et épurée
    const toolbar = wrapper.createDiv({
      cls: "feuillets-arcs-toolbar",
      style: "display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; background: var(--background-secondary-alt); border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 14px; border-radius: var(--radius-m); flex-wrap: wrap;"
    });

    // Filtres de vue
    const leftGroup = toolbar.createDiv({ style: "display: flex; align-items: center; gap: 8px;" });

    const catGroup = leftGroup.createDiv({ style: "display: flex; gap: 2px; background: var(--background-modifier-form-field); padding: 2px; border-radius: var(--radius-s); border: 1px solid var(--background-modifier-border);" });
    const catOptions = [
      { id: "all", label: "Tous" },
      { id: "labels", label: "📍 Lieux" },
      { id: "fils", label: "🧵 Fils" }
    ];

    for (const opt of catOptions) {
      const btn = catGroup.createEl("button", {
        text: opt.label,
        style: `padding: 4px 10px; font-size: var(--font-ui-smaller); border: none; border-radius: var(--radius-xs); cursor: pointer; background: ${(this.categoryFilter || "all") === opt.id ? "var(--interactive-accent)" : "transparent"}; color: ${(this.categoryFilter || "all") === opt.id ? "var(--text-on-accent)" : "var(--text-muted)"};`
      });
      btn.addEventListener("click", () => {
        this.categoryFilter = opt.id;
        this.selectedArc = "";
        this.render();
      });
    }

    // Sélecteur d'élément spécifique
    const select = leftGroup.createEl("select", {
      cls: "feuillets-arcs-filter",
      style: "padding: 5px 8px; border-radius: var(--radius-s); font-size: var(--font-ui-small); background: var(--background-modifier-form-field); border: 1px solid var(--background-modifier-border); cursor: pointer;"
    });

    const allOpt = select.createEl("option", { text: "— Filtrer un élément —" });
    allOpt.value = "";

    for (const arc of allArcs) {
      const count = scenes.filter(sc => (sceneArcsMap.get(sc.file.path) || []).includes(arc)).length;
      const opt = select.createEl("option", { text: `${arc} (${count})` });
      opt.value = arc;
    }

    select.value = this.selectedArc || "";
    select.addEventListener("change", () => {
      this.selectedArc = select.value;
      this.render();
    });

    // Bascule de mode Tableau / Frise
    const rightGroup = toolbar.createDiv({ style: "display: flex; gap: 2px; background: var(--background-modifier-form-field); padding: 2px; border-radius: var(--radius-s); border: 1px solid var(--background-modifier-border);" });
    
    const btnTable = rightGroup.createEl("button", {
      text: "📊 Tableau",
      style: `padding: 4px 10px; font-size: var(--font-ui-smaller); border: none; border-radius: var(--radius-xs); cursor: pointer; background: ${this.displayMode === "table" ? "var(--interactive-accent)" : "transparent"}; color: ${this.displayMode === "table" ? "var(--text-on-accent)" : "var(--text-muted)"};`
    });
    btnTable.addEventListener("click", () => {
      this.displayMode = "table";
      this.render();
    });

    const btnRails = rightGroup.createEl("button", {
      text: "🛤️ Frise",
      style: `padding: 4px 10px; font-size: var(--font-ui-smaller); border: none; border-radius: var(--radius-xs); cursor: pointer; background: ${this.displayMode === "rails" ? "var(--interactive-accent)" : "transparent"}; color: ${this.displayMode === "rails" ? "var(--text-on-accent)" : "var(--text-muted)"};`
    });
    btnRails.addEventListener("click", () => {
      this.displayMode = "rails";
      this.render();
    });

    if (allArcs.length === 0) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun lieu ni fil détecté dans le YAML. Renseignez 'label:' ou 'fil:' dans vos chapitres.");
      return;
    }

    // -------------------------------------------------------------
    // OPTION A : TABLEAU MINIMAL ET ÉPURÉ (DEFAULT)
    // -------------------------------------------------------------
    if (this.displayMode === "table") {
      const tableContainer = wrapper.createDiv({ cls: "feuillets-arcs-table-container", style: "overflow-x: auto;" });
      const table = tableContainer.createEl("table", {
        style: "width: 100%; border-collapse: collapse; font-size: var(--font-ui-small);"
      });

      const thead = table.createEl("thead");
      const trHead = thead.createEl("tr", { style: "border-bottom: 2px solid var(--background-modifier-border); background: var(--background-secondary-alt);" });
      trHead.createEl("th", { text: "Chapitre", style: "padding: 8px 12px; text-align: left; width: 200px;" });
      trHead.createEl("th", { text: "📍 Lieu", style: "padding: 8px 12px; text-align: left; width: 150px;" });
      trHead.createEl("th", { text: "🧵 Fil conducteur", style: "padding: 8px 12px; text-align: left; width: 200px;" });
      trHead.createEl("th", { text: "Résumé", style: "padding: 8px 12px; text-align: left;" });

      const tbody = table.createEl("tbody");

      for (const item of items) {
        if (item.type === "folder") {
          const trFolder = tbody.createEl("tr", { style: "background: var(--background-secondary); border-top: 1px solid var(--background-modifier-border);" });
          const tdFolder = trFolder.createEl("td", { colSpan: 4, style: "padding: 8px 12px; font-weight: bold; color: var(--text-accent);" });
          tdFolder.setText(`📁 ${item.folder.name}`);
        } else {
          const file = item.file;
          const list = sceneArcsMap.get(file.path) || [];
          if (this.selectedArc && !list.includes(this.selectedArc)) continue;

          const fm = this.plugin.fmOf(file) || {};
          const fils = sceneFilsMap.get(file.path) || [];
          const labels = sceneLabelsMap.get(file.path) || [];

          const trRow = tbody.createEl("tr", {
            style: "border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; transition: background 0.1s ease;"
          });
          trRow.addEventListener("mouseenter", () => trRow.style.background = "var(--background-modifier-hover)");
          trRow.style.background = "transparent";
          trRow.addEventListener("mouseleave", () => trRow.style.background = "transparent");

          trRow.addEventListener("click", () => {
            openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
          });

          // Col 1: Chapitre
          const tdTitle = trRow.createEl("td", { style: "padding: 8px 12px; font-weight: 500;" });
          tdTitle.setText(this.plugin.shortTitleFor(file));

          // Col 2: Lieu
          const tdLabel = trRow.createEl("td", { style: "padding: 8px 12px;" });
          if (labels.length > 0) {
            for (const l of labels) {
              const col = stringToColor(l);
              tdLabel.createEl("span", {
                text: l,
                style: `display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; font-weight: 500; background: ${col}18; color: ${col}; border: 1px solid ${col}30; margin-right: 4px;`
              });
            }
          } else {
            tdLabel.createEl("span", { text: "—", style: "color: var(--text-faint);" });
          }

          // Col 3: Fil
          const tdFil = trRow.createEl("td", { style: "padding: 8px 12px;" });
          if (fils.length > 0) {
            for (const f of fils) {
              const col = stringToColor(f);
              tdFil.createEl("span", {
                text: f,
                style: `display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; font-weight: 500; background: ${col}18; color: ${col}; border: 1px solid ${col}30; margin-right: 4px;`
              });
            }
          } else {
            tdFil.createEl("span", { text: "—", style: "color: var(--text-faint);" });
          }

          // Col 4: Synopsis
          const tdSyn = trRow.createEl("td", { style: "padding: 8px 12px; color: var(--text-muted); font-size: 0.88em; line-height: 1.35;" });
          const synText = fm.synopsis || fm.sous_titre || "";
          tdSyn.setText(synText || "—");
        }
      }
      return;
    }

    // -------------------------------------------------------------
    // OPTION B : MODE FRISE CHRONOLOGIQUE RAILS
    // -------------------------------------------------------------
    const activeArcs = this.selectedArc ? [this.selectedArc] : allArcs;
    const filteredScenes = scenes.filter(sc => {
      if (!this.selectedArc) return true;
      const list = sceneArcsMap.get(sc.file.path) || [];
      return list.includes(this.selectedArc);
    });

    const firstIndices = {};
    const lastIndices = {};
    for (const arc of activeArcs) {
      firstIndices[arc] = -1;
      lastIndices[arc] = -1;
    }

    filteredScenes.forEach((sc, idx) => {
      const list = sceneArcsMap.get(sc.file.path) || [];
      for (const arc of list) {
        if (activeArcs.includes(arc)) {
          if (firstIndices[arc] === -1) firstIndices[arc] = idx;
          lastIndices[arc] = idx;
        }
      }
    });

    const folderHasFilteredScene = (folder) => {
      if (!this.selectedArc) return true;
      const descendants = this.plugin.flattenFiles(folder);
      for (const f of descendants) {
        const list = sceneArcsMap.get(f.path) || [];
        if (list.includes(this.selectedArc)) return true;
      }
      return false;
    };

    const timeline = wrapper.createDiv({ cls: "feuillets-arcs-timeline" });

    // En-tête des colonnes au-dessus des rails
    const headerRow = timeline.createDiv({
      cls: "feuillets-arcs-header-row",
      style: "display: flex; align-items: flex-end; gap: 8px; padding: 6px 0 10px 0; border-bottom: 2px solid var(--background-modifier-border); margin-bottom: 8px;"
    });

    const railsHeader = headerRow.createDiv({
      cls: "feuillets-arcs-rails-header",
      style: `display: flex; width: ${activeArcs.length * 28}px; flex-shrink: 0; gap: 0;`
    });

    activeArcs.forEach((arc) => {
      const colColor = stringToColor(arc);
      const symbol = getSymbol(arc);
      const colHeader = railsHeader.createDiv({
        cls: "feuillets-arcs-col-header",
        style: "flex: 1; display: flex; flex-direction: column; align-items: center; cursor: pointer;",
        title: `${arc} (cliquer pour filtrer)`
      });
      const dot = colHeader.createDiv({
        style: `width: 18px; height: 18px; border-radius: 50%; background: ${colColor}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; margin-bottom: 4px;`
      });
      dot.setText(symbol);

      colHeader.addEventListener("click", () => {
        this.selectedArc = this.selectedArc === arc ? "" : arc;
        this.render();
      });
    });

    const headerLabel = headerRow.createDiv({
      style: "font-size: var(--font-ui-small); font-weight: var(--font-semibold, 600); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding-left: 8px;"
    });
    headerLabel.setText(`Arcs & Lieux (${activeArcs.length})`);

    let sceneCount = 0;
    for (const item of items) {
      if (item.type === "folder") {
        if (!folderHasFilteredScene(item.folder)) continue;

        const row = timeline.createDiv({
          cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}`
        });
        const railsSpacer = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        railsSpacer.style.width = `${activeArcs.length * 28}px`;
        row.createDiv({ cls: "feuillets-arcs-folder-title", text: item.folder.name });
      } else {
        const file = item.file;
        const list = sceneArcsMap.get(file.path) || [];
        if (this.selectedArc && !list.includes(this.selectedArc)) continue;

        const currentIdx = sceneCount;
        sceneCount++;

        const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });
        row.style.cursor = "pointer";

        const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
        rails.style.width = `${activeArcs.length * 28}px`;

        activeArcs.forEach((arc) => {
          const col = rails.createDiv({ cls: "feuillets-arcs-col" });
          const arcColor = stringToColor(arc);
          col.style.setProperty("--arc-color", arcColor);

          const first = firstIndices[arc];
          const last = lastIndices[arc];
          const hasArc = list.includes(arc);

          if (currentIdx >= first && currentIdx <= last) {
            const line = col.createDiv({ cls: "feuillets-arcs-line" });
            line.style.backgroundColor = arcColor;
            if (!hasArc) line.style.opacity = "0.2";
          }

          if (hasArc) {
            const symbol = getSymbol(arc);
            const dot = col.createDiv({ cls: "feuillets-arcs-dot" });
            dot.style.backgroundColor = arcColor;
            dot.setText(symbol);
            dot.setAttr("title", `${arc} — ${file.basename}`);
            dot.setAttr("aria-label", arc);
          }
        });

        const titleArea = row.createDiv({ cls: "feuillets-arcs-info" });
        const titleRow = titleArea.createDiv({ style: "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;" });
        titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });

        if (list.length > 0) {
          const badges = titleRow.createDiv({ cls: "feuillets-arcs-row-badges", style: "display: flex; gap: 4px; flex-wrap: wrap;" });
          for (const arcName of list) {
            const arcColor = stringToColor(arcName);
            const badge = badges.createSpan({
              cls: "feuillets-arcs-badge",
              text: arcName
            });
            badge.style.setProperty("--arc-color-bg", arcColor + "20");
            badge.style.setProperty("--arc-color-text", arcColor);
          }
        }

        const fm = this.plugin.fmOf(file) || {};
        const syn = fm.synopsis || fm.sous_titre || "";
        if (syn) {
          titleArea.createDiv({ cls: "feuillets-arcs-file-synopsis", text: syn });
        }

        row.addEventListener("click", () => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        });
      }
    }
  }
}
