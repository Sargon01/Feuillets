import { STATUSES } from "../constants.js";
import { foldAccents } from "../utils/core.js";
import { AppearancesModal, FolderGoalModal, TagsModal } from "../ui/entity-modals.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { renderCollapsibleHead } from "../utils/dom.js";
import { getResearchTemplate } from "../services/research-templates.js";

function getResearchSectionIcon(key) {
  return {
    sources: "file-search",
    bibliographie: "library",
    codex: "book-marked",
    personnages: "users",
    lieux: "map-pin",
    glossaire: "spell-check",
    evenements: "calendar",
    coffre: "archive",
  }[key] || "info";
}

const {
  ItemView,
  TFile,
  TFolder,
  Notice,
  normalizePath,
  setIcon,
  Menu,
  MarkdownRenderer,
  Keymap,
} = require("obsidian");

function shortenPath(path) {
  if (!path) return "Vault entier";
  const parts = path.split("/");
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join("/")}`;
}

function cleanExcerpt(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function formatExcerpt(text) {
  const cleaned = cleanExcerpt(text);
  if (!cleaned) return "";
  const paragraphCount = cleaned.split(/\n\n+/).filter(Boolean).length;
  const isLong = cleaned.length > 220 || paragraphCount > 1;
  return isLong ? `\n${cleaned}\n` : cleaned;
}

function formatSourcedExcerpt(text, filePath) {
  const compact = cleanExcerpt(text);
  if (!compact) return "";
  const paragraphCount = compact.split(/\n\n+/).filter(Boolean).length;
  const isLong = compact.length > 220 || paragraphCount > 1;
  return isLong
    ? `\n${compact}\n\nSource : [[${filePath}]]\n`
    : `${compact}\n\nSource : [[${filePath}]]`;
}

export class BaseFeuilletsView extends ItemView {
  getProjectLabels() {
    const S = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    const meta = root ? S.projectMeta[root.path] : null;
    return (meta && meta.labels) ? meta.labels : (S.labels || []);
  }
  async render() {}

  async createEntity(folder, baseName, template) {
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
    this.app.workspace.getLeaf(false).openFile(file);
  }

  makeSynopsisArea(parent, file, rows) {
    return this.makeFmArea(parent, file, "synopsis", "Synopsis…", rows);
  }

  makeFmArea(parent, file, key, placeholder, rows) {
    const fm = this.fm(file);
    const ta = parent.createEl("textarea", {
      cls: "feuillets-synopsis",
      attr: { placeholder, rows: String(rows || 4) },
    });
    ta.value = fm[key] || "";
    ta.addEventListener("blur", async () => {
      const v = ta.value.trim();
      if (v !== (fm[key] || "")) await this.setFm(file, key, v);
    });
    return ta;
  }

  splitFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { frontmatter: null, body: content };
    return { frontmatter: match[1], body: content.slice(match[0].length) };
  }

  async makeBodyEditor(parent, file) {
    const raw = await this.app.vault.read(file);
    const parts = this.splitFrontmatter(raw);
    const bodyText = parts.body.trim();

    const editorWrapper = parent.createDiv({ cls: "feuillets-body-editor-wrapper" });
    const textEl = editorWrapper.createDiv({
      cls: "feuillets-flat-text-cell" + (bodyText ? "" : " is-empty"),
      style: "cursor: pointer; min-height: 120px; padding: 8px; border-radius: var(--radius-s);"
    });

    if (bodyText) {
      await MarkdownRenderer.render(this.app, bodyText, textEl, file.path, this);
    } else {
      textEl.createDiv({ cls: "feuillets-empty" }).setText("(fiche vide — cliquer pour écrire)");
    }

    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      textEl.style.display = "none";

      const ta = editorWrapper.createEl("textarea", {
        cls: "feuillets-flat-textarea",
        attr: { placeholder: "Contenu de la fiche…", rows: "12" },
        style: "width: 100%; min-height: 180px; font-family: var(--font-monospace);"
      });
      ta.value = parts.body;
      ta.focus();

      ta.style.height = "auto";
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
          textEl.style.display = "";
          this.render();
        }
      };

      ta.addEventListener("blur", saveAndExit);
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          ta.blur();
        }
      });
    });
  }

  makeLabelSelect(parent, file) {
    const current = this.plugin.labelOf(file);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    const none = sel.createEl("option", { text: "—" });
    none.value = "";
    for (const l of this.getProjectLabels()) {
      const opt = sel.createEl("option", { text: l.name });
      opt.value = l.name;
    }
    sel.value = current;
    sel.setAttr("title", current || "Label : aucun");
    const color = current ? this.plugin.labelColor(current) : null;
    if (color) sel.style.borderLeft = `4px solid ${color}`;
    sel.addEventListener("change", async () => {
      await this.setFm(file, "label", sel.value);
      sel.setAttr("title", sel.value || "Label : aucun");
      sel.blur();
    });
    return sel;
  }

  makeStatusSelect(parent, file) {
    const fm = this.fm(file);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    for (const s of STATUSES) {
      const opt = sel.createEl("option", { text: s || "—" });
      opt.value = s;
    }
    sel.value = STATUSES.includes(fm.statut) ? fm.statut : "";
    sel.setAttr("title", sel.value || "Statut : aucun");
    sel.addEventListener("change", async () => {
      await this.setFm(file, "statut", sel.value);
      sel.setAttr("title", sel.value || "Statut : aucun");
      sel.blur();
    });
    return sel;
  }

  makeTagsEditorPlain(parent, file) {
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const t of tags) {
      wrap.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${t}`);
    }
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : "+ tags" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      await this.setFm(file, "tags", merged);
      input.value = "";
      input.blur();
    });
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", "Cliquer pour retirer ce tag");
      chip.addEventListener("click", async () => {
        const next = tags.filter((_, j) => j !== idx);
        await this.setFm(file, "tags", next);
      });
    });
    return wrap;
  }

  async renderResearchBody(container, root, gen) {
    const S = this.plugin.settings;
    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    const searchInput = toolbar.createEl("input", {
      type: "text",
      cls: "feuillets-binder-search",
      attr: { placeholder: "Rechercher dans la recherche…" },
    });
    searchInput.value = S.researchSearch || "";
    let researchSearchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(researchSearchTimer);
      const caret = searchInput.selectionStart;
      researchSearchTimer = setTimeout(async () => {
        S.researchSearch = searchInput.value;
        await this.plugin.saveSettings();
        await this.render(true);
        const el = this.contentEl.querySelector(".feuillets-binder-search");
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      }, 250);
    });

    const researchRoot = this.plugin.getResearchRoot();
    const baseResearch = researchRoot
      ? researchRoot.path
      : `${root.path}/_Recherche`;
    await this.plugin.ensureFolder(baseResearch);
    if (this._renderGen !== gen) return;

    const mode = this.plugin.projectMode();
    const rf = mode.researchFolders;

    const sourcesFolder = rf.sources
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.sources.label}`)
      : null;
    const bibliographieFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.bibliographie.label}`
    );
    const personnagesFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.personnages.label}`
    );
    const lieuxFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.lieux.label}`
    );
    const codexFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.codex.label}`
    );
    const glossaireFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.glossaire.label}`
    );
    const chronoFolder =
      this.plugin.getChronoFolder() ||
      (await this.plugin.ensureFolder(`${baseResearch}/Chronologie`));

    const standardPaths = new Set([
      sourcesFolder ? sourcesFolder.path : "",
      bibliographieFolder.path,
      personnagesFolder.path,
      lieuxFolder.path,
      codexFolder.path,
      glossaireFolder.path,
      chronoFolder.path,
    ]);

    const customFolders = [];
    if (researchRoot && researchRoot instanceof TFolder) {
      for (const child of researchRoot.children) {
        if (child instanceof TFolder && !standardPaths.has(child.path)) {
          if (!child.name.startsWith("_") && !child.name.startsWith(".")) {
            customFolders.push(child);
          }
        }
      }
    }
    customFolders.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    const tagSet = new Set();
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
      .filter((f) => f instanceof TFolder)
      .flatMap((f) =>
        f.children.filter((c) => c instanceof TFile && c.extension === "md")
      );
    for (const f of allEntityFiles) {
      for (const t of this.plugin.tagsOf(f)) tagSet.add(t);
    }
    const STRUCTURAL_TAGS = new Set([
      "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
    ]);
    const tagOptions = [...tagSet]
      .filter((t) => !STRUCTURAL_TAGS.has(foldAccents(t)))
      .sort((a, b) => a.localeCompare(b, "fr"));

    const tagFilterSel = toolbar.createEl("select", {
      cls: "feuillets-binder-status-filter",
    });
    tagFilterSel.setAttr("title", "Filtrer les fiches par tag");
    const optAllTags = tagFilterSel.createEl("option", { text: "Tous les tags" });
    optAllTags.value = "";
    for (const t of tagOptions) {
      const opt = tagFilterSel.createEl("option", { text: `#${t}` });
      opt.value = t;
    }
    tagFilterSel.value = S.researchTagFilter || "";
    tagFilterSel.addEventListener("change", async () => {
      S.researchTagFilter = tagFilterSel.value;
      await this.plugin.saveSettings();
      await this.render(true);
    });



    const body = container.createDiv({ cls: "feuillets-research-body" });

    this.researchFilterActive =
      !!(S.researchSearch || "").trim() || !!S.researchTagFilter;

    if (rf.sources && sourcesFolder) {
      this.renderSection(body, rf.sources.label, sourcesFolder, async () =>
        this.createEntity(
          sourcesFolder,
          rf.sources.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "sources", rf.sources.newName)
        ), "sources"
      );
    }

    this.renderSection(body, rf.bibliographie.label, bibliographieFolder, async () =>
      this.createEntity(
        bibliographieFolder,
        rf.bibliographie.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "bibliographie", rf.bibliographie.newName)
      ), "bibliographie"
    );

    this.renderSection(body, rf.personnages.label, personnagesFolder, async () =>
      this.createEntity(
        personnagesFolder,
        rf.personnages.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "personnages", rf.personnages.newName)
      ), "personnages"
    );

    this.renderSection(body, rf.lieux.label, lieuxFolder, async () =>
      this.createEntity(
        lieuxFolder,
        rf.lieux.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "lieux", rf.lieux.newName)
      ), "lieux"
    );

    this.renderSection(body, rf.codex.label, codexFolder, async () =>
      this.createEntity(
        codexFolder,
        rf.codex.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "codex", rf.codex.newName)
      ), "codex"
    );

    this.renderSection(body, rf.glossaire.label, glossaireFolder, async () =>
      this.createEntity(
        glossaireFolder,
        rf.glossaire.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "glossaire", rf.glossaire.newName)
      ), "glossaire"
    );

    this.renderSection(body, rf.evenements.label, chronoFolder, async () =>
      this.createEntity(
        chronoFolder,
        rf.evenements.newName,
        await getResearchTemplate(this.app, this.plugin.settings, mode, "evenements", rf.evenements.newName)
      ), "evenements"
    );

    // Rendu des dossiers de recherche personnalisés
    for (const folder of customFolders) {
      const folderTag = foldAccents(folder.name.toLowerCase().replace(/\s+/g, "-"));
      this.renderSection(body, folder.name, folder, () =>
        this.createEntity(
          folder,
          `Nouveau ${folder.name.toLowerCase().replace(/s$/, "")}`,
          [
            "---",
            `titre: "Nouveau ${folder.name.toLowerCase().replace(/s$/, "")}"`,
            "synopsis: ",
            "tags:",
            `  - ${folderTag}`,
            "---",
            ""
          ].join("\n")
        ), folderTag
      );
    }

    if (this.researchFilterActive && S.researchSearch.trim()) {
      const q = S.researchSearch.trim().toLowerCase();
      const baseResearchLower = baseResearch.toLowerCase();
      const vaultMatches = this.app.vault.getMarkdownFiles().filter(f => {
        if (f.path.toLowerCase().startsWith(baseResearchLower + "/")) return false;
        return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
      }).sort((a, b) => a.path.localeCompare(b.path, "fr")).slice(0, 30);

      if (vaultMatches.length > 0) {
        this.renderSection(body, "Coffre (autres notes)", vaultMatches, undefined, "coffre");
      }
    }

    this.filterEntities();
  }

  async renderFileView(container, file, root) {
    this.selectedText = ""; // Réinitialiser la sélection
    const wrapper = container.createDiv({ cls: "feuillets-fileview" });
    const bar = wrapper.createDiv({ cls: "feuillets-fileview-bar" });
    
    this.iconBtn(bar, "arrow-left", "Fermer (retour à la liste)", () => {
      this.viewingFile = null;
      this.render();
    });
    this.iconBtn(bar, "external-link", "Ouvrir dans un nouvel onglet", () => {
      this.app.workspace.getLeaf(true).openFile(file);
    });

    this.barSep(bar);

    // Boutons de prélèvement
    this.iconBtn(bar, "link", "Insérer un lien double-crochets", () => {
      this.plugin.insertIntoActiveEditor(`[[${file.path}]]`);
    });
    this.iconBtn(bar, "quote", "Insérer l'extrait sélectionné", () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice("Sélectionnez d'abord un extrait de texte dans la fiche.");
        return;
      }
      this.plugin.insertIntoActiveEditor(formatExcerpt(this.selectedText));
    });
    this.iconBtn(bar, "book-copy", "Insérer l'extrait avec source", () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice("Sélectionnez d'abord un extrait de texte dans la fiche.");
        return;
      }
      const text = formatSourcedExcerpt(this.selectedText, file.path);
      this.plugin.insertIntoActiveEditor(text);
    });

    this.barSep(bar);

    this.iconBtn(bar, "copy-plus", "Dupliquer", async () => {
      const content = await this.app.vault.read(file);
      let name = `${file.basename} (copie)`;
      let dest = normalizePath(`${file.parent.path}/${name}.md`);
      let k = 2;
      while (this.app.vault.getAbstractFileByPath(dest)) {
        name = `${file.basename} (copie ${k++})`;
        dest = normalizePath(`${file.parent.path}/${name}.md`);
      }
      const copy = await this.app.vault.create(dest, content);
      new Notice(`Dupliqué : ${name}`);
      this.viewingFile = copy;
      this.render();
    });
    this.iconBtn(bar, "trash", "Mettre à la corbeille", async () => {
      await this.app.vault.trash(file, true);
      new Notice(`« ${this.plugin.titleFor(file)} » mis à la corbeille.`);
      this.viewingFile = null;
      this.render();
    });



    const row = wrapper.createDiv({ cls: "feuillets-fileview-row" });
    row.createSpan({ cls: "feuillets-notes-label" }).setText("Label");
    this.makeLabelSelect(row, file);
    this.makeTagsEditorPlain(wrapper, file);

    const body = wrapper.createDiv({ cls: "feuillets-fileview-body" });
    await this.makeBodyEditor(body, file);

    body.addEventListener("mouseup", () => {
      const selected = window.getSelection() ? window.getSelection().toString() : "";
      this.selectedText = selected;
    });
  }

  renderSection(container, title, folderOrFiles, onCreate, iconKey) {
    const collapseKey =
      folderOrFiles instanceof TFolder
        ? folderOrFiles.path
        : `research:${title}`;
    const S = this.plugin.settings;
    const collapsed = !this.researchFilterActive && !!S.collapsed[collapseKey];

    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title,
      icon: getResearchSectionIcon(iconKey),
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        this.render();
      },
      onCreate,
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });

    let files = [];
    if (folderOrFiles instanceof TFolder) {
      files = folderOrFiles.children
        .filter((c) => c instanceof TFile && c.extension === "md")
        .sort((a, b) =>
          this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), "fr")
        );
    } else if (Array.isArray(folderOrFiles)) {
      files = folderOrFiles;
    }

    if (files.length === 0) {
      list.createDiv({ cls: "feuillets-research-empty" }).setText("Vide.");
      return;
    }

    for (const f of files) {
      const row = list.createDiv({ cls: "feuillets-research-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const nameEl = header.createDiv({ cls: "feuillets-research-item-name" });
      nameEl.setText(this.plugin.titleFor(f));

      if (Array.isArray(folderOrFiles)) {
        const openFileBtn = this.iconBtn(
          header,
          "external-link",
          "Ouvrir dans un nouvel onglet"
        );
        openFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.app.workspace.getLeaf("tab").openFile(f);
        });
      } else {
        const appearBtn = this.iconBtn(
          header,
          "list",
          "Voir ses apparitions dans le manuscrit"
        );
        appearBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new AppearancesModal(this.app, this.plugin, f).open();
        });
      }
      row.setAttr("data-search", foldAccents(this.plugin.titleFor(f)));
      row.setAttr("data-tags", this.plugin.tagsOf(f).map(foldAccents).join(","));
      row.addEventListener("click", (e) => {
        if (Keymap.isModEvent(e)) {
          this.app.workspace.getLeaf(true).openFile(f);
          return;
        }
        this.viewingFile = f;
        this.render();
      });
    }
  }

  filterEntities() {
    const term = foldAccents((this.plugin.settings.researchSearch || "").trim());
    const tagFilter = foldAccents(this.plugin.settings.researchTagFilter || "");
    const items = this.contentEl.querySelectorAll(".feuillets-research-item");
    items.forEach((el) => {
      const matchSearch = !term || (el.getAttr("data-search") || "").includes(term);
      const tags = (el.getAttr("data-tags") || "").split(",").filter(Boolean);
      const matchTag = !tagFilter || tags.includes(tagFilter);
      el.style.display = matchSearch && matchTag ? "" : "none";
    });
    const sections = this.contentEl.querySelectorAll(
      ".feuillets-research-section"
    );
    const filterActive = !!term || !!tagFilter;
    sections.forEach((sec) => {
      const visible = sec.querySelectorAll(
        '.feuillets-research-item:not([style*="display: none"])'
      );
      const empty = sec.querySelector(".feuillets-research-empty");
      if (filterActive && empty) empty.style.display = "none";
      sec.style.display =
        filterActive && visible.length === 0 && !empty ? "none" : "";
    });
  }

  async buildSearchIndex(files) {
    if (!this._searchCache) this._searchCache = new Map();
    const cache = this._searchCache;
    let misses = null;
    for (const f of files) {
      const hit = cache.get(f.path);
      if (!hit || hit.mtime !== f.stat.mtime) (misses || (misses = [])).push(f);
    }
    if (misses) {
      await Promise.all(
        misses.map(async (f) => {
          const raw = await this.app.vault.cachedRead(f);
          const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
          cache.set(f.path, {
            mtime: f.stat.mtime,
            text: foldAccents(body),
          });
        })
      );
    }
    if (cache.size > files.length) {
      const alive = new Set(files.map((f) => f.path));
      for (const key of cache.keys()) {
        if (!alive.has(key)) cache.delete(key);
      }
    }
    return cache;
  }

  iconBtn(parent, icon, tooltip, onClick) {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    btn.setAttr("aria-label", tooltip);
    btn.setAttr("title", tooltip);
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  barSep(parent) {
    return parent.createDiv({ cls: "feuillets-bar-sep" });
  }

  showFileContextMenu(e, file, parent, index, siblings) {
    const menu = new Menu();
    const plugin = this.plugin;

    menu.addItem((item) =>
      item
        .setTitle("Ouvrir dans un nouvel onglet")
        .setIcon("file-plus")
        .onClick(() => {
          this.app.workspace.getLeaf("tab").openFile(file);
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Nouveau feuillet avant")
        .setIcon("corner-left-up")
        .onClick(async () => {
          await plugin.newSheetAt(parent, index);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Nouveau feuillet après")
        .setIcon("corner-left-down")
        .onClick(async () => {
          await plugin.newSheetAt(parent, index + 1);
        })
    );
    menu.addSeparator();

    const currentStatus = this.fm(file).statut || "";
    for (const st of STATUSES.filter(Boolean)) {
      menu.addItem((item) =>
        item
          .setTitle(`Statut : ${st}`)
          .setChecked(st === currentStatus)
          .onClick(async () => {
            await this.setFm(file, "statut", st === currentStatus ? "" : st);
          })
      );
    }
    menu.addSeparator();

    const currentLabel = plugin.labelOf(file);
    for (const l of this.getProjectLabels()) {
      menu.addItem((item) =>
        item
          .setTitle(`Label : ${l.name}`)
          .setChecked(l.name === currentLabel)
          .onClick(async () => {
            await this.setFm(file, "label", l.name === currentLabel ? "" : l.name);
          })
      );
    }
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Snapshot")
        .setIcon("camera")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const n = await plugin.snapshotFile(file, root);
          new Notice(`Snapshot créé : ${n}`);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Dupliquer")
        .setIcon("copy")
        .onClick(async () => {
          const content = await this.app.vault.read(file);
          let name = file.basename + " (copie)";
          let dest = normalizePath(`${parent.path}/${name}.md`);
          let k = 2;
          while (this.app.vault.getAbstractFileByPath(dest)) {
            name = `${file.basename} (copie ${k++})`;
            dest = normalizePath(`${parent.path}/${name}.md`);
          }
          await this.app.vault.create(dest, content);
          plugin.renderAllViews(true);
          new Notice(`Dupliqué : ${name}`);
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Mettre à la corbeille")
        .setIcon("trash")
        .onClick(async () => {
          await this.app.vault.trash(file, true);
          plugin.renderAllViews(true);
          new Notice(`« ${plugin.titleFor(file) || file.basename} » mis à la corbeille.`);
        })
    );
    menu.showAtMouseEvent(e);
  }

  showFolderContextMenu(e, folder, parent, index, siblings) {
    const menu = new Menu();
    const plugin = this.plugin;

    menu.addItem((item) =>
      item
        .setTitle("Nouveau feuillet à l'intérieur")
        .setIcon("file-plus")
        .onClick(async () => {
          await plugin.newSheet(folder);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Nouveau sous-dossier")
        .setIcon("folder-plus")
        .onClick(async () => {
          await plugin.newFolder(folder);
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Ouvrir la note de dossier")
        .setIcon("notebook-text")
        .onClick(async () => {
          const note = await plugin.getOrCreateFolderNote(folder);
          this.app.workspace.getLeaf(false).openFile(note);
        })
    );
    menu.addSeparator();

    const note = plugin.folderNoteFor(folder);
    const currentLabel = note ? plugin.labelOf(note) : "";
    for (const l of this.getProjectLabels()) {
      menu.addItem((item) =>
        item
          .setTitle(`Label : ${l.name}`)
          .setChecked(l.name === currentLabel)
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) {
              await this.setFm(targetNote, "label", l.name === currentLabel ? "" : l.name);
            }
          })
      );
    }
    menu.addSeparator();
    const currentStatus = note ? this.fm(note).statut || "" : "";
    for (const st of STATUSES.filter(Boolean)) {
      menu.addItem((item) =>
        item
          .setTitle(`Statut : ${st}`)
          .setChecked(st === currentStatus)
          .onClick(async () => {
            const targetNote = note || await plugin.getOrCreateFolderNote(folder);
            if (targetNote) {
              await this.setFm(targetNote, "statut", st === currentStatus ? "" : st);
            }
          })
      );
    }
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Modifier les tags…")
        .setIcon("tag")
        .onClick(async () => {
          const targetNote = note || await plugin.getOrCreateFolderNote(folder);
          if (targetNote) {
            new TagsModal(this.app, plugin, targetNote).open();
          }
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Modifier le synopsis…")
        .setIcon("text")
        .onClick(async () => {
          const targetNote = note || await plugin.getOrCreateFolderNote(folder);
          if (targetNote) {
            new FmFieldModal(this.app, plugin, targetNote, "synopsis", "Synopsis du dossier").open();
          }
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Modifier le résumé…")
        .setIcon("file-text")
        .onClick(async () => {
          const targetNote = note || await plugin.getOrCreateFolderNote(folder);
          if (targetNote) {
            new FmFieldModal(this.app, plugin, targetNote, "resume", "Résumé du dossier").open();
          }
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Définir l'objectif de mots…")
        .setIcon("target")
        .onClick(() => {
          new FolderGoalModal(this.app, plugin, folder).open();
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Mettre à la corbeille (Supprimer)")
        .setIcon("trash")
        .onClick(async () => {
          await this.app.vault.trash(folder, true);
          plugin.renderAllViews(true);
          new Notice(`Le dossier « ${folder.name} » a été mis à la corbeille.`);
        })
    );
    menu.showAtMouseEvent(e);
  }

  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getProjectFolder() {
    return this.plugin.getProjectFolder();
  }

  fm(file) {
    return this.plugin.fmOf(file);
  }

  titleFor(file) {
    return this.plugin.titleFor(file);
  }

  async setFm(file, key, value) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
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

  goalFor(file) {
    const g = parseInt(this.fm(file).objectif, 10);
    return isNaN(g) ? this.plugin.settings.wordGoal : g;
  }

  ringState(wc, goal) {
    const tol = this.plugin.settings.tolerance;
    if (goal <= 0) return "none";
    if (wc >= goal - tol && wc <= goal + tol) return "hit";
    if (wc > goal + tol) return "over";
    return "under";
  }

  fillRing(ring, wc, goal) {
    const pct = goal > 0 ? Math.min(100, Math.round((wc / goal) * 100)) : 0;
    ring.style.setProperty("--pct", `${pct}%`);
    ring.removeClass("feuillets-ring-hit");
    ring.removeClass("feuillets-ring-over");
    const state = this.ringState(wc, goal);
    if (state === "hit" || state === "over")
      ring.addClass(`feuillets-ring-${state}`);
  }

  attachDragHandlers(handleEl, dropEl, parent, index, siblings, scopeEl) {
    handleEl.draggable = true;
    handleEl.addEventListener("dragstart", (e) => {
      this.plugin.dragState = {
        parentPath: parent.path,
        index,
        path: siblings[index] ? siblings[index].path : null,
      };
      this.plugin._dragInProgress = true;
      this.plugin._dragRetryCount = 0;
      dropEl.addClass("feuillets-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.stopPropagation();
    });
    handleEl.addEventListener("dragend", () => {
      this.plugin._dragInProgress = false;
      this.plugin.dragState = null;
      dropEl.removeClass("feuillets-dragging");
      this.contentEl
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
        });
    });
    dropEl.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dropEl.addClass("feuillets-dragover");
    });
    dropEl.addEventListener("dragleave", () => {
      dropEl.removeClass("feuillets-dragover");
    });
    dropEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropEl.removeClass("feuillets-dragover");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;

      if (drag.parentPath === parent.path) {
        const from = drag.index;
        if (from === index) return;
        const reordered = [...siblings];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(index, 0, moved);
        await this.plugin.applySiblingOrder(parent, reordered);
        this.plugin.renderAllViews(true);
        return;
      }

      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      const target = siblings[index];
      let destFolder = parent;
      let insertIndex = index;
      if (target instanceof TFolder && target.path !== moved.path) {
        destFolder = target;
        insertIndex = Number.MAX_SAFE_INTEGER;
      }
      await this.plugin.moveNode(moved, srcParent, destFolder, insertIndex);
      this.plugin.renderAllViews(true);
    });
  }
}
