const { ItemView, TFolder, TFile } = require("obsidian");
import { VIEW_ARCS } from "../constants.js";

export class ArcsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedArc = ""; // Filtre d'arc actif ("" = tous)
  }

  getViewType() {
    return VIEW_ARCS;
  }

  getDisplayText() {
    return "Arcs narratifs";
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

    // 1. Collecte récursive des chapitres/parties et scènes dans l'ordre chronologique
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

    // 2. Extraction robuste des arcs depuis le YAML (gestion des tableaux et chaînes à virgules)
    const parseArcs = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) {
        return val.flatMap(x => parseArcs(x));
      }
      return String(val)
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    };

    const getArcSymbol = (name) => {
      return name.slice(0, 2).toUpperCase();
    };

    const scenes = items.filter(x => x.type === "file");
    const arcSet = new Set();
    const sceneArcs = new Map(); // file.path -> Array of arc names

    for (const sc of scenes) {
      const fm = this.plugin.fmOf(sc.file) || {};
      const list = [
        ...parseArcs(fm.arcs),
        ...parseArcs(fm.arc)
      ].filter((v, i, self) => self.indexOf(v) === i); // dédoublonner

      sceneArcs.set(sc.file.path, list);
      for (const a of list) {
        arcSet.add(a);
      }
    }

    const allArcs = Array.from(arcSet).sort((a, b) => a.localeCompare(b, "fr"));

    // 3. Générateur de couleurs HSL déterministe
    const stringToColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      const h = Math.abs(hash) % 360;
      return `hsl(${h}, 70%, 50%)`;
    };

    // 4. Barre d'outils avec menu déroulant pour le filtrage
    const toolbar = wrapper.createDiv({
      cls: "feuillets-arcs-toolbar",
      style: "display: flex; align-items: center; gap: 16px; padding: 8px 12px; background: var(--background-secondary-alt); border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 12px; border-radius: var(--radius-m);"
    });

    const select = toolbar.createEl("select", {
      cls: "feuillets-arcs-filter",
      style: "padding: 6px 10px; border-radius: var(--radius-s); font-size: var(--font-ui-small); background: var(--background-modifier-form-field); border: 1px solid var(--background-modifier-border); cursor: pointer;"
    });

    const allOpt = select.createEl("option", { text: "Tous les arcs narratifs" });
    allOpt.value = "";

    for (const arc of allArcs) {
      const opt = select.createEl("option", { text: arc });
      opt.value = arc;
    }

    select.value = this.selectedArc || "";
    select.addEventListener("change", () => {
      this.selectedArc = select.value;
      this.render();
    });

    // Affichage des pastilles d'intrigues à côté du sélecteur
    const legendList = toolbar.createDiv({ style: "display: flex; flex-wrap: wrap; gap: 10px; margin-left: auto;" });
    const shownArcs = this.selectedArc ? [this.selectedArc] : allArcs;
    for (const arc of shownArcs) {
      const col = stringToColor(arc);
      const symbol = getArcSymbol(arc);
      const item = legendList.createDiv({ style: "display: flex; align-items: center; gap: 6px; font-size: var(--font-ui-small);" });
      const dot = item.createSpan({
        cls: "feuillets-arcs-legend-dot",
        style: `background-color: ${col}; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; width: 14px; height: 14px; border-radius: 50%;`
      });
      dot.setText(symbol);
      item.createSpan({ text: arc, style: "color: var(--text-muted);" });
    }

    if (allArcs.length === 0) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun arc narratif détecté. Ajoutez 'arcs: [Intrigue A, Intrigue B]' ou 'arc: Intrigue A' dans le YAML de vos scènes.");
      return;
    }

    // 5. Filtrage des scènes et repérage des bornes (premier et dernier index de l'arc)
    const activeArcs = this.selectedArc ? [this.selectedArc] : allArcs;
    const filteredScenes = scenes.filter(sc => {
      if (!this.selectedArc) return true;
      const list = sceneArcs.get(sc.file.path) || [];
      return list.includes(this.selectedArc);
    });

    const firstIndices = {};
    const lastIndices = {};
    for (const arc of activeArcs) {
      firstIndices[arc] = -1;
      lastIndices[arc] = -1;
    }

    filteredScenes.forEach((sc, idx) => {
      const list = sceneArcs.get(sc.file.path) || [];
      for (const arc of list) {
        if (activeArcs.includes(arc)) {
          if (firstIndices[arc] === -1) firstIndices[arc] = idx;
          lastIndices[arc] = idx;
        }
      }
    });

    // Détermination de la visibilité des dossiers (si le dossier contient au moins une scène filtrée)
    const folderHasFilteredScene = (folder) => {
      if (!this.selectedArc) return true;
      const descendants = this.plugin.flattenFiles(folder);
      for (const f of descendants) {
        const list = sceneArcs.get(f.path) || [];
        if (list.includes(this.selectedArc)) return true;
      }
      return false;
    };

    // 6. Rendu de la frise chronologique
    const timeline = wrapper.createDiv({ cls: "feuillets-arcs-timeline" });

    let sceneCount = 0;
    for (const item of items) {
      if (item.type === "folder") {
        if (!folderHasFilteredScene(item.folder)) continue;

        const row = timeline.createDiv({
          cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}`
        });
        const railsSpacer = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        railsSpacer.style.width = `${activeArcs.length * 20}px`;
        row.createDiv({ cls: "feuillets-arcs-folder-title", text: item.folder.name });
      } else {
        const file = item.file;
        const list = sceneArcs.get(file.path) || [];
        if (this.selectedArc && !list.includes(this.selectedArc)) continue;

        const currentIdx = sceneCount;
        sceneCount++;

        const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });
        row.style.cursor = "pointer";

        // rails
        const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
        rails.style.width = `${activeArcs.length * 20}px`;

        activeArcs.forEach((arc) => {
          const col = rails.createDiv({ cls: "feuillets-arcs-col" });
          const arcColor = stringToColor(arc);
          col.style.setProperty("--arc-color", arcColor);

          const first = firstIndices[arc];
          const last = lastIndices[arc];
          const hasArc = list.includes(arc);

          // Ligne verticale reliant la première et la dernière apparition
          if (currentIdx >= first && currentIdx <= last) {
            const line = col.createDiv({ cls: "feuillets-arcs-line" });
            line.style.backgroundColor = arcColor;
            if (!hasArc) {
              line.style.opacity = "0.2"; // Estomper si l'arc traverse simplement sans s'y arrêter
            }
          }

          // Point (avec lettres pour daltoniens) si présent
          if (hasArc) {
            const symbol = getArcSymbol(arc);
            const dot = col.createDiv({ cls: "feuillets-arcs-dot" });
            dot.style.backgroundColor = arcColor;
            dot.setText(symbol);
            dot.setAttr("title", arc);
            dot.setAttr("aria-label", arc);
          }
        });

        // Infos textuelles (Titre & badges)
        const titleArea = row.createDiv({ cls: "feuillets-arcs-info" });
        const titleRow = titleArea.createDiv({ style: "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;" });
        titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });

        if (list.length > 0) {
          const badges = titleRow.createDiv({ cls: "feuillets-arcs-row-badges", style: "display: flex; gap: 4px;" });
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

        // Synopsis
        const fm = this.plugin.fmOf(file) || {};
        if (fm.synopsis) {
          titleArea.createDiv({ cls: "feuillets-arcs-file-synopsis", text: fm.synopsis });
        }

        row.addEventListener("click", () => {
          this.app.workspace.getLeaf(false).openFile(file);
        });
      }
    }
  }
}
