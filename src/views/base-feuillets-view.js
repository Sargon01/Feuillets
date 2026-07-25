import { STATUSES, getProjectStatuses } from "../constants.js";
import { foldAccents } from "../utils/core.js";
import { refreshSearchIndex } from "../utils/search-index.js";
import { AppearancesModal, FolderGoalModal, TagsModal, SaveResearchFilterModal, ManageSavedFiltersModal } from "../ui/entity-modals.js";
import { TextInputModal } from "../scenes-editor.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { renderCollapsibleHead, openFileActivating } from "../utils/dom.js";
import { getResearchTemplate } from "../services/research-templates.js";
import { promptForPage } from "../ui/citation-modal.js";
import { DiffModal, CompareFilesModal, PickFileModal } from "../ui/diff-modal.js";
import { listSnapshotFiles } from "../services/project-files.js";
import { isResearchFile, isImageFile, isPdfFile } from "../services/research.js";


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
  setTooltip,
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
    openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
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
    const statuses = getProjectStatuses(this.plugin ? this.plugin.settings : null);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    for (const s of statuses) {
      const opt = sel.createEl("option", { text: s || "—" });
      opt.value = s;
    }
    sel.value = statuses.includes(fm.statut) ? fm.statut : "";
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
        /* this.contentEl est la feuille ENTIÈRE (partagée par tous les
           sous-onglets de l'Inspecteur quand cette vue est une sous-vue de
           SidebarFeuilletsView — voir son renderXTab()/targetContainer) :
           y chercher l'input peut retrouver un ancien nœud détaché plutôt
           que celui qu'on vient de recréer. Se limiter au conteneur réel
           de CETTE vue lève l'ambiguïté. */
        const scope = this.targetContainer || this.contentEl;
        const el = scope.querySelector(".feuillets-binder-search");
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
    const baseResearchFolder = await this.plugin.ensureFolder(baseResearch);
    if (this._renderGen !== gen) return;

    const mode = this.plugin.projectMode();
    const rf = mode.researchFolders;

    if (rf.sources) {
      /* à côté de la barre de recherche : cherche dans Sources ET
         Bibliographie à la fois (l'icône "+" de chaque fiche, plus bas,
         cite directement CETTE entrée sans recherche). */
      const citeSearchBtn = this.iconBtn(
        toolbar,
        "quote",
        "Insérer une citation (recherche dans Sources et Bibliographie)"
      );
      citeSearchBtn.addEventListener("click", () => this.plugin.openInsertCitation());

      const renumberBtn = this.iconBtn(
        toolbar,
        "list-ordered",
        "Renuméroter les notes de bas de page du feuillet actif"
      );
      renumberBtn.addEventListener("click", () => this.plugin.renumberActiveFootnotes());
    }

    /* Rubriques personnalisées (voir plus bas, "customFolders") : au lieu
       d'imposer un jeu figé de dossiers, l'utilisateur crée exactement
       les catégories dont SON sujet a besoin — un sous-dossier de
       Recherche/ créé ici apparaît automatiquement comme sa propre
       section. Disponible en fiction comme en non-fiction. */
    const newFolderBtn = this.iconBtn(toolbar, "folder-plus", "Nouvelle rubrique de recherche…");
    newFolderBtn.addEventListener("click", () => {
      if (baseResearchFolder) this.plugin.newFolder(baseResearchFolder);
    });

    const sourcesFolder = rf.sources
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.sources.label}`)
      : null;
    const bibliographieFolder = await this.plugin.ensureFolder(
      `${baseResearch}/${rf.bibliographie.label}`
    );
    /* Rationalisation : en non-fiction, Sources reste la SEULE
       bibliothèque de travail — Bibliographie devient la vue agrégée des
       sources citées (voir plus bas), plus un dossier de fiches
       manuelles. Migration automatique, idempotente (ne fait rien une
       fois les fiches déjà déplacées) : ne s'exécute jamais en fiction,
       où Bibliographie garde son sens d'origine. */
    if (rf.sources && sourcesFolder) {
      await this.plugin.migrateBibliographieIntoSources(bibliographieFolder, sourcesFolder);
    }
    /* rf.personnages/lieux/codex/glossaire/evenements n'existent plus en
       non-fiction (voir utils/project-modes.js) — plus de dossier imposé
       ni auto-créé pour ces catégories : à l'utilisateur de créer les
       rubriques utiles à SON sujet via le bouton "Nouvelle rubrique". Un
       dossier déjà existant sur le disque (ancien projet, avant ce
       changement) continue de fonctionner : non reconnu ici, il tombe
       simplement dans "customFolders" plus bas et reste visible avec son
       contenu — rien n'est supprimé automatiquement. */
    const personnagesFolder = rf.personnages
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.personnages.label}`)
      : null;
    const lieuxFolder = rf.lieux
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.lieux.label}`)
      : null;
    const codexFolder = rf.codex
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.codex.label}`)
      : null;
    const glossaireFolder = rf.glossaire
      ? await this.plugin.ensureFolder(`${baseResearch}/${rf.glossaire.label}`)
      : null;
    const chronoFolder = rf.evenements
      ? this.plugin.getChronoFolder() || (await this.plugin.ensureFolder(`${baseResearch}/Chronologie`))
      : this.plugin.getChronoFolder();

    const standardPaths = new Set([
      sourcesFolder ? sourcesFolder.path : "",
      bibliographieFolder.path,
      personnagesFolder ? personnagesFolder.path : "",
      lieuxFolder ? lieuxFolder.path : "",
      codexFolder ? codexFolder.path : "",
      glossaireFolder ? glossaireFolder.path : "",
      chronoFolder ? chronoFolder.path : "",
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

    const projBase = root.parent ? root.parent.path : root.path;
    const visuelsPath = normalizePath(`${projBase}/Ressources/Visuels`);
    const fVisuels = this.app.vault.getAbstractFileByPath(visuelsPath);
    if (fVisuels instanceof TFolder && fVisuels.children.some((c) => isResearchFile(c))) {
      if (!customFolders.some((f) => f.path === fVisuels.path)) {
        customFolders.push(fVisuels);
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
        f.children.filter((c) => isResearchFile(c))
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

    const tagFilterActive = !!S.researchTagFilter;
    const tagFilterBtn = this.iconBtn(
      toolbar,
      tagFilterActive ? "tag" : "tags",
      tagFilterActive ? `Filtre de tag : #${S.researchTagFilter}` : "Filtrer les fiches par tag"
    );
    if (tagFilterActive) tagFilterBtn.addClass("feuillets-mode-active");
    tagFilterBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Tous les tags")
          .setChecked(!S.researchTagFilter)
          .onClick(async () => {
            S.researchTagFilter = "";
            await this.plugin.saveSettings();
            await this.render(true);
          })
      );
      for (const t of tagOptions) {
        menu.addItem((item) =>
          item
            .setTitle(`#${t}`)
            .setChecked(S.researchTagFilter === t)
            .onClick(async () => {
              S.researchTagFilter = t;
              await this.plugin.saveSettings();
              await this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    this.renderSavedFiltersButton(toolbar, root);

    const body = container.createDiv({ cls: "feuillets-research-body" });

    this.researchFilterActive =
      !!(S.researchSearch || "").trim() || !!S.researchTagFilter;

    if (rf.sources && sourcesFolder) {
      /* Non-fiction : Sources est la SEULE bibliothèque de travail —
         icône "+" par fiche pour la citer directement (voir aussi le
         bouton "citation" de la barre d'outils, qui cherche dedans). */
      const citeRowAction = (header, file) => {
        const citeBtn = this.iconBtn(header, "quote", "Citer cette source…");
        citeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.plugin.quickCiteSource(file);
        });
      };
      this.renderSection(body, rf.sources.label, sourcesFolder, async () =>
        this.createEntity(
          sourcesFolder,
          rf.sources.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "sources", rf.sources.newName)
        ), "sources", citeRowAction
      );

      await this.renderFootnotesOverviewSection(body, root);
      /* "Bibliographie" ici N'EST PLUS un dossier de fiches manuelles —
         c'est la vue agrégée des sources citées + le bouton pour générer
         le fichier final (voir renderBibliographySection). Créer une
         nouvelle référence se fait dans Sources, jamais ici. */
      await this.renderBibliographySection(body, root, [sourcesFolder, bibliographieFolder]);
    } else {
      /* Fiction (pas de Sources, pas de système de citation) :
         Bibliographie garde son sens d'origine — un dossier de fiches
         manuelles pour des lectures complémentaires, sans lien avec le
         texte. */
      this.renderSection(body, rf.bibliographie.label, bibliographieFolder, async () =>
        this.createEntity(
          bibliographieFolder,
          rf.bibliographie.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "bibliographie", rf.bibliographie.newName)
        ), "bibliographie"
      );
    }

    if (rf.personnages && personnagesFolder) {
      this.renderSection(body, rf.personnages.label, personnagesFolder, async () =>
        this.createEntity(
          personnagesFolder,
          rf.personnages.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "personnages", rf.personnages.newName)
        ), "personnages"
      );
    }

    if (rf.lieux && lieuxFolder) {
      this.renderSection(body, rf.lieux.label, lieuxFolder, async () =>
        this.createEntity(
          lieuxFolder,
          rf.lieux.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "lieux", rf.lieux.newName)
        ), "lieux"
      );
    }

    if (rf.codex && codexFolder) {
      this.renderSection(body, rf.codex.label, codexFolder, async () =>
        this.createEntity(
          codexFolder,
          rf.codex.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "codex", rf.codex.newName)
        ), "codex"
      );
    }

    if (rf.glossaire && glossaireFolder) {
      this.renderSection(body, rf.glossaire.label, glossaireFolder, async () =>
        this.createEntity(
          glossaireFolder,
          rf.glossaire.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "glossaire", rf.glossaire.newName)
        ), "glossaire"
      );
    }

    if (rf.evenements && chronoFolder) {
      this.renderSection(body, rf.evenements.label, chronoFolder, async () =>
        this.createEntity(
          chronoFolder,
          rf.evenements.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "evenements", rf.evenements.newName)
        ), "evenements"
      );
    }

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
    /* Ne réinitialiser la sélection que si la fiche affichée change
       vraiment — PAS à chaque appel de renderFileView. Ce panneau est
       reconstruit très souvent sans que l'utilisateur ait rien demandé :
       toute modification n'importe où dans le coffre déclenche
       refreshView()/renderAllViews() (voir main.js, vault.on("modify"))
       après 2,5 s, et ce panneau n'est pas protégé par isEditing() tant
       qu'aucun champ n'y a le focus. Avant ce correctif, sélectionner un
       extrait puis attendre quelques secondes avant de cliquer sur le
       bouton de citation perdait systématiquement la sélection — d'où
       "le bouton ne fonctionne pas, avec ou sans source ça ne change
       pas" : le rejet se produisait avant même d'atteindre la logique
       liée aux tags. */
    if (this._selectedTextFile !== file.path) {
      this.selectedText = "";
      this._selectedTextFile = file.path;
    }
    const wrapper = container.createDiv({ cls: "feuillets-fileview" });
    const bar = wrapper.createDiv({ cls: "feuillets-fileview-bar" });
    
    this.iconBtn(bar, "arrow-left", "Fermer (retour à la liste)", () => {
      this.viewingFile = null;
      this.render();
    });
    this.iconBtn(bar, "external-link", "Ouvrir dans un nouvel onglet", () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(true), file);
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
    this.iconBtn(bar, "book-copy", "Insérer l'extrait avec citation de la source", () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice("Sélectionnez d'abord un extrait de texte dans la fiche.");
        return;
      }
      /* fiche Source/Bibliographie : citation formatée (footnote ou
         auteur-date selon le réglage du projet), avec sa vraie page —
         avant, ce bouton se contentait d'accrocher "Source : [[lien]]",
         jamais une référence bibliographique réelle. Toute AUTRE fiche
         (Personnage, Lieu, Codex…) n'a pas de champs de citation : garde
         le renvoi par lien, seul repère qui ait du sens pour elles. */
      const tags = this.plugin.tagsOf(file).map((t) => foldAccents(t));
      const isCitable = tags.includes("source") || tags.includes("bibliographie");
      if (!isCitable) {
        this.plugin.insertIntoActiveEditor(formatSourcedExcerpt(this.selectedText, file.path));
        return;
      }
      const editor = this.plugin.activeEditorAnywhere();
      if (!editor) {
        new Notice("Ouvre une scène et place le curseur dedans avant d'insérer un extrait.");
        return;
      }
      const excerpt = formatExcerpt(this.selectedText);
      promptForPage(this.app, this.plugin, file, (chosenFile, page) => {
        const at = editor.getCursor("to");
        editor.replaceRange(excerpt, at, at);
        const lines = excerpt.split("\n");
        const endLine = at.line + lines.length - 1;
        const endCh = lines.length === 1 ? at.ch + lines[0].length : lines[lines.length - 1].length;
        editor.setCursor({ line: endLine, ch: endCh });
        this.plugin.insertCitationFor(chosenFile, page, editor);
      });
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

    body.addEventListener("mouseup", (e) => {
      /* window.getSelection() ne voit jamais l'intérieur d'un <textarea>
         (sélection native du champ, hors de l'API Selection du navigateur)
         — sans ce cas séparé, sélectionner un extrait pendant l'édition
         de la fiche (plutôt qu'en lecture) ne capturait jamais rien. */
      if (e.target && e.target.tagName === "TEXTAREA") {
        const ta = e.target;
        this.selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        return;
      }
      const selected = window.getSelection() ? window.getSelection().toString() : "";
      this.selectedText = selected;
    });
  }

  renderSection(container, title, folderOrFiles, onCreate, iconKey, rowAction) {
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

    /* Glisser-déposer : une rubrique adossée à un vrai dossier (pas la vue
       agrégée "Coffre") devient une cible de dépôt — on y déplace le fichier
       glissé depuis une autre rubrique. */
    const destFolder = folderOrFiles instanceof TFolder ? folderOrFiles : null;
    if (destFolder) this.attachResearchDropTarget(section, destFolder);

    let files = [];
    if (folderOrFiles instanceof TFolder) {
      files = folderOrFiles.children
        .filter((c) => isResearchFile(c))
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
      const isMedia = isImageFile(f) || isPdfFile(f);
      const row = list.createDiv({ cls: "feuillets-research-item" });
      this.attachResearchDragSource(row, f);
      const header = row.createDiv({ cls: "feuillets-research-item-header" });

      if (isImageFile(f)) {
        const iconSpan = header.createSpan({ cls: "feuillets-research-item-icon" });
        setIcon(iconSpan, "image");
      } else if (isPdfFile(f)) {
        const iconSpan = header.createSpan({ cls: "feuillets-research-item-icon" });
        setIcon(iconSpan, "file-text");
      }

      const nameEl = header.createDiv({ cls: "feuillets-research-item-name" });
      nameEl.setText(this.plugin.titleFor(f));

      this.addPreviewBtn(header, f);

      if (isMedia) {
        const insertLinkBtn = this.iconBtn(
          header,
          "link",
          isImageFile(f)
            ? "Insérer l'image dans la scène active (![[...]])"
            : "Insérer le lien PDF dans la scène active ([[...]])"
        );
        insertLinkBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const link = isImageFile(f) ? `![[${f.name}]]` : `[[${f.name}]]`;
          this.plugin.insertIntoActiveEditor(link);
          new Notice(`Lien inséré : ${f.name}`);
        });

        const openFileBtn = this.iconBtn(
          header,
          "external-link",
          "Ouvrir le fichier"
        );
        openFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
        });
      } else if (Array.isArray(folderOrFiles)) {
        const openFileBtn = this.iconBtn(
          header,
          "external-link",
          "Ouvrir dans un nouvel onglet"
        );
        openFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
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
        if (rowAction) rowAction(header, f);
      }

      row.addClass("internal-link");
      row.setAttr("data-href", f.path);
      row.setAttr("data-path", f.path);
      row.setAttr("data-search", foldAccents(this.plugin.titleFor(f)));
      row.setAttr("data-tags", this.plugin.tagsOf(f).map(foldAccents).join(","));

      row.addEventListener("click", (e) => {
        if (isMedia || Keymap.isModEvent(e)) {
          openFileActivating(this.app, this.app.workspace.getLeaf(Keymap.isModEvent(e) ? true : "tab"), f);
          return;
        }
        this.viewingFile = f;
        this.render();
      });
    }
  }

  /** Bouton "œil" : déclenche l'aperçu natif d'Obsidian (Aperçu de page) au
   * CLIC plutôt qu'au survol — le survol automatique gênait (aperçu qui
   * s'ouvre en passant simplement la souris sur la liste). */
  addPreviewBtn(header, f) {
    const btn = this.iconBtn(header, "eye", "Aperçu…");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: "feuillets",
        hoverParent: this,
        targetEl: btn,
        linktext: f.path,
        sourcePath: f.path,
      });
    });
    return btn;
  }

  /** Rend une fiche de recherche déplaçable : au dragstart, on mémorise son
   * chemin sur le plugin (état partagé entre les rubriques, comme dragState
   * pour le binder). Le vrai déplacement est fait par la cible de dépôt. */
  attachResearchDragSource(row, file) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      this.plugin._researchDragPath = file.path;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", file.path);
      row.addClass("feuillets-dragging");
      e.stopPropagation();
    });
    row.addEventListener("dragend", () => {
      this.plugin._researchDragPath = null;
      this.contentEl
        .querySelectorAll(".feuillets-dragover, .feuillets-dragging")
        .forEach((el) => {
          el.removeClass("feuillets-dragover");
          el.removeClass("feuillets-dragging");
        });
    });
  }

  /** Fait d'une rubrique (section adossée à un dossier) une cible de dépôt :
   * lâcher une fiche l'y déplace via fileManager.renameFile (met à jour les
   * liens du coffre). Ignore le dépôt dans la rubrique d'origine, et refuse
   * une collision de nom plutôt que d'écraser. */
  attachResearchDropTarget(section, destFolder) {
    section.addEventListener("dragover", (e) => {
      if (!this.plugin._researchDragPath) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      section.addClass("feuillets-dragover");
    });
    section.addEventListener("dragleave", (e) => {
      if (!section.contains(e.relatedTarget)) section.removeClass("feuillets-dragover");
    });
    section.addEventListener("drop", async (e) => {
      e.preventDefault();
      section.removeClass("feuillets-dragover");
      const srcPath = this.plugin._researchDragPath;
      this.plugin._researchDragPath = null;
      if (!srcPath) return;
      const file = this.app.vault.getAbstractFileByPath(srcPath);
      if (!(file instanceof TFile)) return;
      if (file.parent && file.parent.path === destFolder.path) return;
      const dest = normalizePath(`${destFolder.path}/${file.name}`);
      if (this.app.vault.getAbstractFileByPath(dest)) {
        new Notice("Une fiche du même nom existe déjà dans cette rubrique.");
        return;
      }
      await this.app.fileManager.renameFile(file, dest);
      this.plugin.renderAllViews(true);
    });
  }

  /** Toutes les notes de bas de page ("[^N]: texte") du manuscrit, scène
   * par scène mais regroupées en un seul endroit — pas fichier par
   * fichier comme dans le panneau Notes. Signale aussi les références
   * orphelines : un "[^N]" cité dans le texte sans définition
   * correspondante, ou l'inverse (définie mais jamais citée) — souvent le
   * signe d'un texte coupé/collé entre scènes qui a cassé une note. */
  async renderFootnotesOverviewSection(container, root) {
    const S = this.plugin.settings;
    const collapseKey = "research:footnotes-overview";
    const collapsed = !!S.collapsed[collapseKey];

    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title: "Notes de bas de page (relecture)",
      icon: "list",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        this.render();
      },
    });
    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });
    const numbering = this.plugin.buildNumbering(root);
    const files = this.plugin
      .flattenFiles(root)
      .sort((a, b) => (numbering.get(a.path) || 0) - (numbering.get(b.path) || 0));

    const defRe = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
    const refRe = /\[\^([^\]]+)\](?!:)/g;
    let anyContent = false;

    for (const file of files) {
      const raw = await this.app.vault.cachedRead(file);
      const text = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

      const defs = new Map();
      defRe.lastIndex = 0;
      let m;
      while ((m = defRe.exec(text))) defs.set(m[1], m[2].trim());

      const refs = new Set();
      refRe.lastIndex = 0;
      while ((m = refRe.exec(text))) refs.add(m[1]);

      if (defs.size === 0 && refs.size === 0) continue;
      anyContent = true;

      const group = list.createDiv({ cls: "feuillets-footnotes-overview-group" });
      const head = group.createDiv({ cls: "feuillets-footnotes-overview-head" });
      head.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      head.setAttr("title", "Ouvrir cette scène");
      head.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      for (const [label, footnoteText] of defs) {
        const row = group.createDiv({ cls: "feuillets-footnotes-overview-row" });
        row.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${label}]`);
        row.createSpan({ cls: "feuillets-footnotes-overview-text" }).setText(footnoteText);
        if (!refs.has(label)) {
          row.addClass("feuillets-footnotes-overview-orphan");
          row.setAttr("title", "Définie mais jamais citée dans le texte de cette scène — à vérifier.");
        }
      }
      for (const label of refs) {
        if (defs.has(label)) continue;
        const row = group.createDiv({
          cls: "feuillets-footnotes-overview-row feuillets-footnotes-overview-orphan",
        });
        row.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${label}]`);
        row
          .createSpan({ cls: "feuillets-footnotes-overview-text" })
          .setText("citée dans le texte, mais aucune définition correspondante");
        row.setAttr("title", "Citée dans le texte, mais aucune ligne \"[^…]: texte\" ne la définit — à vérifier.");
      }
    }

    if (!anyContent) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText("Aucune note de bas de page dans le manuscrit pour l'instant.");
    }
  }

  /** "Bibliographie" comme AGRÉGATEUR, pas comme dossier de fiches
   * manuelles : la liste des Sources/Bibliographie effectivement citées
   * au moins une fois (cite_count > 0, incrémenté par
   * plugin.insertCitationFor), triées par auteur — distinct de "toutes
   * les fiches" (une source peut exister dans la bibliothèque de travail
   * sans jamais être mobilisée dans le texte). Le bouton "Générer"
   * écrit le fichier bibliographie final (plugin.generateBibliographyFile),
   * prêt à être collé dans le manuscrit compilé ou fourni à part. */
  async renderBibliographySection(container, root, candidateFolders) {
    const S = this.plugin.settings;
    const collapseKey = "research:cited-sources";
    const collapsed = !!S.collapsed[collapseKey];

    const { section } = renderCollapsibleHead(container, {
      classes: {
        section: "feuillets-notes-section feuillets-research-section",
        head: "feuillets-notes-section-head",
        title: "feuillets-notes-section-title",
        icon: "feuillets-notes-section-icon",
      },
      title: "Bibliographie",
      icon: "library",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        this.render();
      },
    });
    if (collapsed) return;

    const files = candidateFolders.flatMap((f) =>
      f.children.filter((c) => c instanceof TFile && c.extension === "md")
    );
    const cited = files.filter((f) => (this.plugin.fmOf(f).cite_count || 0) > 0);

    const exportRow = section.createDiv({ cls: "feuillets-bibliography-export-row" });
    exportRow.setAttr(
      "title",
      "Écrit le fichier bibliographie dans le dossier Sortie, prêt à être collé dans le manuscrit compilé."
    );
    const exportIcon = exportRow.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(exportIcon, "file-output");
    exportRow.createSpan().setText("Générer la bibliographie…");
    exportRow.addEventListener("click", () => this.plugin.generateBibliographyFile());

    const list = section.createDiv({ cls: "feuillets-research-list" });
    if (cited.length === 0) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText("Aucune source citée pour l'instant — l'icône guillemet d'une fiche l'ajoutera ici.");
      return;
    }

    const sorted = [...cited].sort((a, b) =>
      (this.plugin.fmOf(a).auteur || "").localeCompare(this.plugin.fmOf(b).auteur || "", "fr")
    );
    for (const f of sorted) {
      const fm = this.plugin.fmOf(f);
      const row = list.createDiv({ cls: "feuillets-research-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = fm.cite_count || 0;
      header
        .createDiv({ cls: "feuillets-research-item-name" })
        .setText(`${this.plugin.titleFor(f)} — ${n} citation${n > 1 ? "s" : ""}`);
      row.addEventListener("click", () => {
        this.viewingFile = f;
        this.render();
      });
    }
  }

  /** "Dossiers de recherche sauvegardés" — un filtre Recherche (texte +
   * tag) enregistré sous un nom, réappliqué en un clic. Ne crée pas de
   * vrai dossier sur le disque : juste une combinaison de critères
   * mémorisée par projet (S.projectMeta[root.path].savedResearchFilters),
   * rejouée sur les mêmes fiches à chaque clic — donc toujours à jour,
   * contrairement à un dossier figé qu'il faudrait retrier à la main. */
  renderSavedFiltersButton(toolbar, root) {
    if (!root) return;
    const S = this.plugin.settings;
    if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
    const meta = S.projectMeta[root.path];
    const filters = meta.savedResearchFilters || [];

    const btn = this.iconBtn(toolbar, "bookmark", "Dossiers de recherche sauvegardés…");
    btn.addEventListener("click", (e) => {
      const menu = new Menu();
      const hasActiveFilter = !!(S.researchSearch || "").trim() || !!S.researchTagFilter;
      menu.addItem((item) =>
        item
          .setTitle("Enregistrer le filtre actif…")
          .setIcon("bookmark-plus")
          .setDisabled(!hasActiveFilter)
          .onClick(() => {
            new SaveResearchFilterModal(this.app, async (name) => {
              if (!meta.savedResearchFilters) meta.savedResearchFilters = [];
              meta.savedResearchFilters.push({
                name,
                search: S.researchSearch || "",
                tag: S.researchTagFilter || "",
              });
              await this.plugin.saveSettings();
              this.render(true);
            }).open();
          })
      );
      if (filters.length > 0) {
        menu.addSeparator();
        for (const f of filters) {
          menu.addItem((item) =>
            item.setTitle(f.name).setIcon("bookmark").onClick(async () => {
              S.researchSearch = f.search || "";
              S.researchTagFilter = f.tag || "";
              await this.plugin.saveSettings();
              this.render(true);
            })
          );
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Gérer les dossiers sauvegardés…")
            .setIcon("settings")
            .onClick(() => {
              new ManageSavedFiltersModal(this.app, this.plugin, root, () => this.render(true)).open();
            })
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  filterEntities() {
    /* this.contentEl est la feuille ENTIÈRE quand cette vue est une sous-vue
       de SidebarFeuilletsView (Inspecteur) — voir renderSavedFiltersButton
       et le correctif équivalent sur le focus de la recherche. Chercher
       depuis this.contentEl pouvait manquer les éléments qu'on vient de
       (re)construire, laissant tout affiché sans filtrage apparent. */
    const scope = this.targetContainer || this.contentEl;
    const term = foldAccents((this.plugin.settings.researchSearch || "").trim());
    const tagFilter = foldAccents(this.plugin.settings.researchTagFilter || "");
    const items = scope.querySelectorAll(".feuillets-research-item");
    items.forEach((el) => {
      const dataSearch = el.getAttr("data-search") || "";
      const dataTags = el.getAttr("data-tags") || "";
      const matchSearch = !term || dataSearch.includes(term) || dataTags.includes(term);
      const tags = dataTags.split(",").filter(Boolean);
      const matchTag = !tagFilter || tags.includes(tagFilter);
      el.style.display = matchSearch && matchTag ? "" : "none";
    });
    const sections = scope.querySelectorAll(
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
    return refreshSearchIndex(this._searchCache, files, async (f) => {
      const raw = await this.app.vault.cachedRead(f);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
      return foldAccents(body);
    });
  }

  iconBtn(parent, icon, tooltip, onClick) {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, tooltip);
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  barSep(parent) {
    return parent.createDiv({ cls: "feuillets-bar-sep" });
  }

  /** En-tête de section repliable (icône + titre, cliquable pour
   * replier/déplier) — même patron visuel et mécanique que les sections
   * du panneau Notes (renderCollapsibleTextarea, notes-view.js) : icône +
   * titre en petites majuscules, pas de chevron, état persisté dans
   * S.collapsed (comme partout ailleurs dans le plugin) sous la clé
   * `namespace:key`. `renderActions`, si fourni, reçoit un conteneur
   * d'icônes de barre d'outils placé à part, hors de la zone cliquable
   * qui replie la section (pas besoin de stopPropagation). Retourne true
   * si la section est actuellement repliée — l'appelant ne construit
   * alors pas son corps. */
  renderSectionHead(section, icon, title, namespace, key, renderActions) {
    const S = this.plugin.settings;
    const collapseKey = `${namespace}:${key}`;
    const isCollapsed = !!S.collapsed[collapseKey];

    const head = section.createDiv({ cls: "feuillets-section-head" });
    const titleEl = head.createDiv({ cls: "feuillets-section-title" });
    const iconEl = titleEl.createSpan({ cls: "feuillets-section-icon" });
    setIcon(iconEl, icon);
    titleEl.createSpan({ cls: "feuillets-section-title-text" }).setText(title);
    titleEl.addEventListener("click", async () => {
      if (isCollapsed) delete S.collapsed[collapseKey];
      else S.collapsed[collapseKey] = true;
      await this.plugin.saveSettings();
      this.render();
    });
    if (renderActions) {
      const actions = head.createDiv({ cls: "feuillets-project-actions" });
      renderActions(actions);
    }
    return isCollapsed;
  }

  showFileContextMenu(e, file, parent, index, siblings) {
    const menu = new Menu();
    const plugin = this.plugin;

    /* Feuillet cliqué faisant partie d'une sélection multiple (voir
       handleMultiSelectClick) : Statut/Label/Tags s'appliquent alors à
       tout le groupe, pas seulement à celui sur lequel on a cliqué droit.
       Le reste du menu (nouveau feuillet avant/après, snapshot,
       dupliquer…) n'a de sens que pour CE feuillet précis et reste
       inchangé. */
    const groupSel = this.plugin._binderMultiSelect;
    const isGroup = !!(groupSel && groupSel.size > 1 && groupSel.has(file.path));
    const groupFiles = isGroup
      ? [...groupSel].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f) => f instanceof TFile)
      : [file];

    if (isGroup) {
      menu.addItem((item) => item.setTitle(`${groupFiles.length} feuillets sélectionnés`).setDisabled(true));
      menu.addSeparator();
    }

    menu.addItem((item) =>
      item
        .setTitle("Ouvrir dans un nouvel onglet")
        .setIcon("file-plus")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Ouvrir en vue côte à côte")
        .setIcon("columns-2")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Comparer avec un autre feuillet…")
        .setIcon("diff")
        .onClick(() => {
          new PickFileModal(this.app, plugin, file, (other) => {
            new CompareFilesModal(this.app, plugin, file, other).open();
          }).open();
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
    const allStatuses = getProjectStatuses(this.plugin ? this.plugin.settings : null);
    for (const st of allStatuses.filter(Boolean)) {
      menu.addItem((item) =>
        item
          .setTitle(`Statut : ${st}`)
          .setChecked(!isGroup && st === currentStatus)
          .onClick(async () => {
            if (isGroup) {
              for (const f of groupFiles) await this.setFm(f, "statut", st);
              new Notice(`Statut « ${st} » appliqué à ${groupFiles.length} feuillets.`);
            } else {
              await this.setFm(file, "statut", st === currentStatus ? "" : st);
            }
          })
      );
    }
    menu.addSeparator();

    const currentLabel = plugin.labelOf(file);
    for (const l of this.getProjectLabels()) {
      menu.addItem((item) =>
        item
          .setTitle(`Label : ${l.name}`)
          .setChecked(!isGroup && l.name === currentLabel)
          .onClick(async () => {
            if (isGroup) {
              for (const f of groupFiles) await this.setFm(f, "label", l.name);
              new Notice(`Label « ${l.name} » appliqué à ${groupFiles.length} feuillets.`);
            } else {
              await this.setFm(file, "label", l.name === currentLabel ? "" : l.name);
            }
          })
      );
    }
    menu.addSeparator();

    if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle("Ajouter un tag au groupe…")
          .setIcon("tag")
          .onClick(() => {
            new TextInputModal(
              this.app,
              `Ajouter un tag à ${groupFiles.length} feuillets`,
              [{ name: "tag", label: "Tag", value: "" }],
              async (values) => {
                const clean = String(values.tag || "").trim().replace(/^#/, "");
                if (!clean) return;
                for (const f of groupFiles) {
                  const existing = this.plugin.tagsOf(f);
                  if (!existing.includes(clean)) {
                    await this.setFm(f, "tags", [...existing, clean]);
                  }
                }
                new Notice(`Tag « ${clean} » ajouté à ${groupFiles.length} feuillets.`);
                this.render();
              }
            ).open();
          })
      );
      menu.addSeparator();
    }

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
        .setTitle("Comparer avec le snapshot")
        .setIcon("history")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const snapshots = listSnapshotFiles(this.app, file, root);
          if (snapshots.length === 0) {
            new Notice(`Aucun snapshot trouvé pour : ${file.basename}`);
            return;
          }
          new DiffModal(this.app, plugin, file, snapshots[0]).open();
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
          openFileActivating(this.app, this.app.workspace.getLeaf(false), note);
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
    const allStatuses = getProjectStatuses(plugin ? plugin.settings : null);
    for (const st of allStatuses.filter(Boolean)) {
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
            new FmFieldModal(this.app, plugin, targetNote, "synopsis", "Synopsis du dossier", () => this.render(true)).open();
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
            new FmFieldModal(this.app, plugin, targetNote, "resume", "Résumé du dossier", () => this.render(true)).open();
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

  /** Clic sur une ligne sélectionnable en vue d'un déplacement groupé
   * (Binder, Plan…) : Maj+clic sélectionne la PLAGE depuis le dernier
   * point d'ancrage (comme un explorateur de fichiers), Cmd/Ctrl+clic
   * bascule un élément un par un tout en déplaçant l'ancrage, un clic
   * normal réinitialise. Partagé entre vues pour un comportement
   * identique partout — voir attachDragHandlers pour la suite (le
   * glisser-déposer group entraîne réellement toute la sélection).
   * Retourne true si le clic a été consommé par la sélection (l'appelant
   * ne doit alors pas ouvrir le fichier). */
  handleMultiSelectClick(e, file, parent, index, siblings, scopeEl) {
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    const sel = this.plugin._binderMultiSelect;

    if (e.shiftKey) {
      e.preventDefault();
      const anchor = this.plugin._binderMultiSelectAnchor;
      if (anchor && anchor.parentPath === parent.path) {
        const lo = Math.min(anchor.index, index);
        const hi = Math.max(anchor.index, index);
        sel.clear();
        for (let i = lo; i <= hi; i++) {
          if (siblings[i]) sel.add(siblings[i].path);
        }
      } else {
        sel.clear();
        sel.add(file.path);
        this.plugin._binderMultiSelectAnchor = { parentPath: parent.path, index };
      }
      this.refreshMultiSelectClasses(scopeEl);
      return true;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (sel.has(file.path)) sel.delete(file.path);
      else sel.add(file.path);
      this.plugin._binderMultiSelectAnchor = { parentPath: parent.path, index };
      this.refreshMultiSelectClasses(scopeEl);
      return true;
    }

    if (sel.size > 0) {
      sel.clear();
      this.refreshMultiSelectClasses(scopeEl);
    }
    this.plugin._binderMultiSelectAnchor = { parentPath: parent.path, index };
    return false;
  }

  refreshMultiSelectClasses(scopeEl) {
    const sel = this.plugin._binderMultiSelect;
    scopeEl.querySelectorAll("[data-path]").forEach((el) => {
      const path = el.getAttr("data-path");
      if (sel && sel.has(path)) el.addClass("feuillets-multiselected");
      else el.removeClass("feuillets-multiselected");
    });
  }

  attachDragHandlers(handleEl, dropEl, parent, index, siblings, scopeEl) {
    handleEl.draggable = true;
    handleEl.addEventListener("dragstart", (e) => {
      /* Poignée d'une scène faisant partie d'une sélection multiple
         (Cmd/Ctrl+clic ou Maj+clic, voir renderFileRow) : on entraîne tout
         le groupe, pas juste celle qu'on a saisie — sinon la sélection ne
         servirait à rien pour un vrai déplacement groupé. */
      const sel = this.plugin._binderMultiSelect;
      const draggedPath = siblings[index] ? siblings[index].path : null;
      if (sel && sel.size > 1 && draggedPath && sel.has(draggedPath)) {
        const items = siblings
          .map((s, i) => ({ path: s.path, index: i }))
          .filter((it) => sel.has(it.path));
        this.plugin.dragState = { parentPath: parent.path, multi: true, items };
      } else {
        this.plugin.dragState = {
          parentPath: parent.path,
          index,
          path: draggedPath,
        };
      }
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

      if (drag.multi) {
        if (this.plugin._binderMultiSelect) this.plugin._binderMultiSelect.clear();
        if (drag.parentPath === parent.path) {
          const draggedIndices = new Set(drag.items.map((it) => it.index));
          if (draggedIndices.has(index)) return;
          const movedNodes = drag.items.map((it) => siblings[it.index]).filter(Boolean);
          const remaining = siblings.filter((_, i) => !draggedIndices.has(i));
          /* Les éléments déplacés situés avant la cible sont déjà retirés
             de `remaining` — décaler l'index cible d'autant pour tomber au
             bon endroit une fois le groupe réinséré. */
          const removedBefore = drag.items.filter((it) => it.index < index).length;
          const targetIndex = Math.max(0, index - removedBefore);
          const reordered = [...remaining];
          reordered.splice(targetIndex, 0, ...movedNodes);
          await this.plugin.applySiblingOrder(parent, reordered);
        } else {
          const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
          if (srcParent instanceof TFolder) {
            const target = siblings[index];
            let destFolder = parent;
            let insertIndex = index;
            if (target instanceof TFolder) {
              destFolder = target;
              insertIndex = Number.MAX_SAFE_INTEGER;
            }
            for (const it of drag.items) {
              const node = this.app.vault.getAbstractFileByPath(it.path);
              if (!node) continue;
              await this.plugin.moveNode(node, srcParent, destFolder, insertIndex);
              if (insertIndex !== Number.MAX_SAFE_INTEGER) insertIndex++;
            }
          }
        }
        this.plugin.renderAllViews(true);
        return;
      }

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
