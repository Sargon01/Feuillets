const { ItemView, TFolder, TFile } = require("obsidian");
import { VIEW_ARCS } from "../constants.js";
import { openFileActivating } from "../utils/dom.js";

export class ArcsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedArc = ""; // Filtre d'arc actif ("" = tous)
    this.categoryFilter = "all"; // "all" | "fils" | "labels"
    this.displayMode = "table"; // "table" (Tableau lisible) | "rails" (Frise rails)
  }

  getViewType() {
    return VIEW_ARCS;
  }

  getDisplayText() {
    return "Arcs narratifs & Lieux";
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

    // 2. Extraction des fils (fil:), lieux (label:) et arcs (arcs:)
    const parseArcs = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.flatMap(x => parseArcs(x));
      return String(val).split(",").map(x => x.trim()).filter(Boolean);
    };

    const getArcSymbol = (name) => name.slice(0, 2).toUpperCase();

    const scenes = items.filter(x => x.type === "file");
    const arcSet = new Set();
    const sceneArcs = new Map();
    const sceneFilsMap = new Map();
    const sceneLabelsMap = new Map();

    for (const sc of scenes) {
      const fm = this.plugin.fmOf(sc.file) || {};
      const fils = [...parseArcs(fm.fil), ...parseArcs(fm.fils)];
      const labels = [...parseArcs(fm.label), ...parseArcs(fm.labels)];
      const arcs = [...parseArcs(fm.arcs), ...parseArcs(fm.arc)];

      sceneFilsMap.set(sc.file.path, fils);
      sceneLabelsMap.set(sc.file.path, labels);

      let list = [];
      if (this.categoryFilter === "fils") list = fils;
      else if (this.categoryFilter === "labels") list = labels;
      else list = [...fils, ...labels, ...arcs];

      list = list.filter((v, i, self) => self.indexOf(v) === i);
      sceneArcs.set(sc.file.path, list);
      for (const a of list) arcSet.add(a);
    }

    const allArcs = Array.from(arcSet).sort((a, b) => a.localeCompare(b, "fr"));

    const stringToColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      const h = Math.abs(hash) % 360;
      return `hsl(${h}, 70%, 45%)`;
    };

    // 3. Carte d'aide explicative
    const helpCard = wrapper.createDiv({ cls: "feuillets-arcs-help-card" });
    const helpLeft = helpCard.createDiv({ cls: "feuillets-arcs-help-left" });
    helpLeft.createDiv({ cls: "feuillets-arcs-help-icon" }).setText("🛤️");
    helpLeft.createDiv({ cls: "feuillets-arcs-help-text" }).innerHTML =
      `<strong>Gestion des Fils & Lieux :</strong> Visualisez la répartition des intrigues (<code>fil:</code>) et des décors (<code>label:</code>) dans chaque chapitre de votre manuscrit.`;

    // Mode d'affichage Toggle (Tableau vs Frise)
    const modeToggleGroup = helpCard.createDiv({ cls: "feuillets-arcs-mode-toggle" });

    const btnTable = modeToggleGroup.createEl("button", {
      text: "📊 Tableau",
      cls: "feuillets-arcs-toggle-btn" + (this.displayMode === "table" ? " is-active" : "")
    });
    btnTable.addEventListener("click", () => {
      this.displayMode = "table";
      this.render();
    });

    const btnRails = modeToggleGroup.createEl("button", {
      text: "🛤️ Frise rails",
      cls: "feuillets-arcs-toggle-btn" + (this.displayMode === "rails" ? " is-active" : "")
    });
    btnRails.addEventListener("click", () => {
      this.displayMode = "rails";
      this.render();
    });

    // 4. Barre d'outils avec filtres
    const toolbar = wrapper.createDiv({ cls: "feuillets-arcs-toolbar" });

    // Filtre de catégorie (Tous / Fils conducteurs / Lieux)
    const catGroup = toolbar.createDiv({ cls: "feuillets-arcs-cat-group" });
    const catOptions = [
      { id: "all", label: "Tous" },
      { id: "fils", label: "🧵 Fils conducteurs" },
      { id: "labels", label: "📍 Lieux & Labels" }
    ];

    for (const opt of catOptions) {
      const btn = catGroup.createEl("button", {
        text: opt.label,
        cls: "feuillets-arcs-toggle-btn" + ((this.categoryFilter || "all") === opt.id ? " is-active" : "")
      });
      btn.addEventListener("click", () => {
        this.categoryFilter = opt.id;
        this.render();
      });
    }

    // Sélecteur d'arc individuel
    const select = toolbar.createEl("select", { cls: "feuillets-arcs-filter" });

    const allOpt = select.createEl("option", { text: "— Filtrer une élement précis —" });
    allOpt.value = "";

    for (const arc of allArcs) {
      const count = scenes.filter(sc => (sceneArcs.get(sc.file.path) || []).includes(arc)).length;
      const opt = select.createEl("option", { text: `${arc} (${count} chapitre${count > 1 ? "s" : ""})` });
      opt.value = arc;
    }

    select.value = this.selectedArc || "";
    select.addEventListener("change", () => {
      this.selectedArc = select.value;
      this.render();
    });

    if (allArcs.length === 0) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun fil conducteur ni lieu détecté dans le YAML. Renseignez 'fil:' ou 'label:' dans vos chapitres.");
      return;
    }

    // -------------------------------------------------------------
    // OPTION A : MODE TABLEAU CLAIR ET LISIBLE (PAR DÉFAUT)
    // -------------------------------------------------------------
    if (this.displayMode === "table") {
      const tableContainer = wrapper.createDiv({ cls: "feuillets-arcs-table-container" });
      const table = tableContainer.createEl("table", { cls: "feuillets-arcs-table" });

      const renderBadge = (parent, name) => {
        const col = stringToColor(name);
        const badge = parent.createEl("span", { text: name, cls: "feuillets-arcs-table-badge" });
        badge.style.setProperty("--arc-color-bg", col + "20");
        badge.style.setProperty("--arc-color-text", col);
        badge.style.setProperty("--arc-color-border", col + "40");
      };

      // En-tête du tableau
      const thead = table.createEl("thead");
      const trHead = thead.createEl("tr");
      trHead.createEl("th", { text: "Chapitre" });
      trHead.createEl("th", { text: "📍 Lieu (label)" });
      trHead.createEl("th", { text: "🧵 Fil conducteur" });
      trHead.createEl("th", { text: "Résumé / Sous-titre" });

      const tbody = table.createEl("tbody");

      for (const item of items) {
        if (item.type === "folder") {
          const trFolder = tbody.createEl("tr", { cls: "feuillets-arcs-table-row-folder" });
          trFolder.createEl("td", { text: `📁 ${item.folder.name}`, attr: { colSpan: 4 } });
        } else {
          const file = item.file;
          const list = sceneArcs.get(file.path) || [];
          if (this.selectedArc && !list.includes(this.selectedArc)) continue;

          const fm = this.plugin.fmOf(file) || {};
          const fils = sceneFilsMap.get(file.path) || [];
          const labels = sceneLabelsMap.get(file.path) || [];

          const trRow = tbody.createEl("tr", { cls: "feuillets-arcs-table-row" });
          trRow.addEventListener("click", () => {
            openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
          });

          // Col 1: Titre du chapitre
          const tdTitle = trRow.createEl("td", { cls: "feuillets-arcs-table-title" });
          tdTitle.setText(this.plugin.shortTitleFor(file));

          // Col 2: Lieu (label)
          const tdLabel = trRow.createEl("td");
          if (labels.length > 0) {
            for (const l of labels) renderBadge(tdLabel, l);
          } else {
            tdLabel.createEl("span", { text: "—", cls: "feuillets-arcs-table-empty" });
          }

          // Col 3: Fil conducteur
          const tdFil = trRow.createEl("td");
          if (fils.length > 0) {
            for (const f of fils) renderBadge(tdFil, f);
          } else {
            tdFil.createEl("span", { text: "—", cls: "feuillets-arcs-table-empty" });
          }

          // Col 4: Synopsis / sous-titre
          const tdSyn = trRow.createEl("td", { cls: "feuillets-arcs-table-synopsis" });
          const synText = fm.synopsis || fm.sous_titre || "";
          tdSyn.setText(synText || "—");
        }
      }
      return;
    }

    // -------------------------------------------------------------
    // OPTION B : MODE FRISE NARRATIVE / RAILS
    // -------------------------------------------------------------
    // Les lieux (label:) restent à gauche en ronds ; les fils (fil:) passent
    // à droite en carrés, pour ne jamais confondre les deux d'un coup d'œil.
    const labelNameSet = new Set();
    for (const arr of sceneLabelsMap.values()) for (const n of arr) labelNameSet.add(n);
    const isLabelArc = (name) => labelNameSet.has(name);

    const activeArcs = this.selectedArc ? [this.selectedArc] : allArcs;
    const activeLabels = activeArcs.filter(isLabelArc);
    const activeFils = activeArcs.filter(a => !isLabelArc(a));

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

    const folderHasFilteredScene = (folder) => {
      if (!this.selectedArc) return true;
      const descendants = this.plugin.flattenFiles(folder);
      for (const f of descendants) {
        const list = sceneArcs.get(f.path) || [];
        if (list.includes(this.selectedArc)) return true;
      }
      return false;
    };

    const timeline = wrapper.createDiv({ cls: "feuillets-arcs-timeline" });

    const buildRailsHeaderGroup = (parent, arcs, isFil) => {
      const group = parent.createDiv({ cls: "feuillets-arcs-rails-header" });
      group.style.width = `${arcs.length * 28}px`;
      arcs.forEach((arc) => {
        const colColor = stringToColor(arc);
        const symbol = getArcSymbol(arc);
        const colHeader = group.createDiv({
          cls: "feuillets-arcs-col-header",
          title: `${arc} (cliquer pour filtrer)`
        });
        const dot = colHeader.createDiv({
          cls: "feuillets-arcs-col-header-dot" + (isFil ? " is-fil" : "")
        });
        dot.style.setProperty("--arc-color", colColor);
        dot.setText(symbol);

        colHeader.addEventListener("click", () => {
          this.selectedArc = this.selectedArc === arc ? "" : arc;
          this.render();
        });
      });
      return group;
    };

    // En-tête des colonnes au-dessus des rails : lieux (ronds) à gauche, fils (carrés) à droite
    const headerRow = timeline.createDiv({ cls: "feuillets-arcs-header-row" });
    buildRailsHeaderGroup(headerRow, activeLabels, false);

    const headerLabel = headerRow.createDiv({ cls: "feuillets-arcs-header-label" });
    headerLabel.setText(`📍 Lieux (${activeLabels.length}) — 🧵 Fils (${activeFils.length})`);

    buildRailsHeaderGroup(headerRow, activeFils, true);

    let sceneCount = 0;
    for (const item of items) {
      if (item.type === "folder") {
        if (!folderHasFilteredScene(item.folder)) continue;

        const row = timeline.createDiv({
          cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}`
        });
        const spacerLeft = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerLeft.style.width = `${activeLabels.length * 28}px`;
        row.createDiv({ cls: "feuillets-arcs-folder-title", text: item.folder.name });
        const spacerRight = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerRight.style.width = `${activeFils.length * 28}px`;
      } else {
        const file = item.file;
        const list = sceneArcs.get(file.path) || [];
        if (this.selectedArc && !list.includes(this.selectedArc)) continue;

        const currentIdx = sceneCount;
        sceneCount++;

        const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });
        row.style.cursor = "pointer";

        const buildRailsCols = (parent, arcs, isFil) => {
          const rails = parent.createDiv({ cls: "feuillets-arcs-row-rails" });
          rails.style.width = `${arcs.length * 28}px`;

          arcs.forEach((arc) => {
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
              const symbol = getArcSymbol(arc);
              const dot = col.createDiv({ cls: "feuillets-arcs-dot" + (isFil ? " feuillets-arcs-dot-fil" : "") });
              dot.style.backgroundColor = arcColor;
              dot.setText(symbol);
              dot.setAttr("title", `${arc} — ${file.basename}`);
              dot.setAttr("aria-label", arc);
            }
          });
        };

        buildRailsCols(row, activeLabels, false);

        const titleArea = row.createDiv({ cls: "feuillets-arcs-info" });
        const titleRow = titleArea.createDiv({ cls: "feuillets-arcs-title-row" });
        titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });

        if (list.length > 0) {
          const badges = titleRow.createDiv({ cls: "feuillets-arcs-row-badges" });
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

        buildRailsCols(row, activeFils, true);

        row.addEventListener("click", () => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        });
      }
    }
  }
}
