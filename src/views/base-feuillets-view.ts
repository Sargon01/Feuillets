import { getProjectStatuses } from "../constants.js";
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
import { resourcesFolderPath, resourcesSubfolderPath } from "../services/folder-structure.js";
import { addOpenWithPreviewItem } from "./preview-view.js";
import { t } from "../i18n/index.js";

function getResearchSectionIcon(key: string): string {
  return (
    {
      sources: "file-search",
      bibliographie: "library",
      codex: "book-marked",
      personnages: "users",
      lieux: "map-pin",
      glossaire: "spell-check",
      evenements: "calendar",
      coffre: "archive",
    } as Record<string, string>
  )[key] || "info";
}

import {
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
  type WorkspaceLeaf,
  type TAbstractFile,
} from "obsidian";
import type FeuilletsPlugin from "../main.js";

/** ensureFolder() garantit toujours un dossier (services/project-files.ts) —
 * ce helper narrowe sans cast direct pour obsidianmd/no-tfile-tfolder-cast ;
 * le throw n'est jamais atteint en pratique. */
function asFolder(af: TAbstractFile): TFolder {
  if (!(af instanceof TFolder)) throw new Error(`Expected a folder: ${af.path}`);
  return af;
}

type ProjectNode = TFile | TFolder;

function cleanExcerpt(text: string): string {
  return String(text || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function formatExcerpt(text: string): string {
  const cleaned = cleanExcerpt(text);
  if (!cleaned) return "";
  const paragraphCount = cleaned.split(/\n\n+/).filter(Boolean).length;
  const isLong = cleaned.length > 220 || paragraphCount > 1;
  return isLong ? `\n${cleaned}\n` : cleaned;
}

function formatSourcedExcerpt(text: string, filePath: string): string {
  const compact = cleanExcerpt(text);
  if (!compact) return "";
  const paragraphCount = compact.split(/\n\n+/).filter(Boolean).length;
  const isLong = compact.length > 220 || paragraphCount > 1;
  return isLong
    ? `\n${compact}\n\nSource : [[${filePath}]]\n`
    : `${compact}\n\nSource : [[${filePath}]]`;
}

export abstract class BaseFeuilletsView extends ItemView {
  plugin!: FeuilletsPlugin;

  /* Propriétés d'instance, jamais initialisées dans un constructeur dédié
     (sous-classes et méthodes de cette base les posent au fil du rendu) —
     voir chaque site d'assignation pour le détail. */
  targetContainer?: HTMLElement;
  _renderGen?: number;
  _searchCache?: Map<string, { mtime: number; text: string }>;
  _selectedTextFile?: string;
  researchFilterActive?: boolean;
  selectedText?: string;
  viewingFile?: TFile | null;

  getProjectLabels(): Label[] {
    const S = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    const meta = root ? S.projectMeta[root.path] : null;
    return (meta && meta.labels) ? meta.labels : (S.labels || []);
  }
  async render(_force?: boolean): Promise<void> {}

  async createEntity(folder: TFolder, baseName: string, template: string): Promise<void> {
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

  makeSynopsisArea(parent: HTMLElement, file: TFile, rows: number): HTMLTextAreaElement {
    return this.makeFmArea(parent, file, "synopsis", "Synopsis…", rows);
  }

  makeFmArea(parent: HTMLElement, file: TFile, key: string, placeholder: string, rows: number): HTMLTextAreaElement {
    const fm = this.fm(file);
    const ta = parent.createEl("textarea", {
      cls: "feuillets-synopsis",
      attr: { placeholder, rows: String(rows || 4) },
    });
    ta.value = String((fm[key] as string | number | boolean | null | undefined) || "");
    ta.addEventListener("blur", () => {
      const v = ta.value.trim();
      if (v !== String((fm[key] as string | number | boolean | null | undefined) || "")) void this.setFm(file, key, v);
    });
    return ta;
  }

  splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { frontmatter: null, body: content };
    return { frontmatter: match[1], body: content.slice(match[0].length) };
  }

  async makeBodyEditor(parent: HTMLElement, file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);
    const parts = this.splitFrontmatter(raw);
    const bodyText = parts.body.trim();

    const editorWrapper = parent.createDiv({ cls: "feuillets-body-editor-wrapper" });
    const textEl = editorWrapper.createDiv({
      cls: "feuillets-flat-text-cell" + (bodyText ? "" : " is-empty"),
      attr: { style: "cursor: pointer; min-height: 120px; padding: 8px; border-radius: var(--radius-s);" },
    });

    if (bodyText) {
      await MarkdownRenderer.render(this.app, bodyText, textEl, file.path, this);
    } else {
      textEl.createDiv({ cls: "feuillets-empty" }).setText(t("shared.sheetEditor.empty"));
    }

    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      textEl.hide();

      const ta = editorWrapper.createEl("textarea", {
        cls: "feuillets-flat-textarea feuillets-autosize",
        attr: { placeholder: t("shared.sheetEditor.placeholder"), rows: "12" },
      });
      ta.setCssStyles({ width: "100%", minHeight: "180px", fontFamily: "var(--font-monospace)" });
      ta.value = parts.body;
      ta.focus();

      ta.style.removeProperty("height");
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
          textEl.show();
          void this.render();
        }
      };

      ta.addEventListener("blur", () => { void saveAndExit(); });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          ta.blur();
        }
      });
    });
  }

  makeLabelSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const current = this.plugin.labelOf(file);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    const none = sel.createEl("option", { text: "—" });
    none.value = "";
    for (const l of this.getProjectLabels()) {
      const opt = sel.createEl("option", { text: l.name });
      opt.value = l.name;
    }
    sel.value = current;
    sel.setAttr("title", current || t("shared.label.none"));
    const color = current ? this.plugin.labelColor(current) : null;
    if (color) sel.style.borderLeft = `4px solid ${color}`;
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "label", sel.value);
        sel.setAttr("title", sel.value || t("shared.label.none"));
        sel.blur();
      })();
    });
    return sel;
  }

  makeStatusSelect(parent: HTMLElement, file: TFile): HTMLSelectElement {
    const fm = this.fm(file);
    const statuses = getProjectStatuses(this.plugin ? this.plugin.settings : null);
    const sel = parent.createEl("select", { cls: "feuillets-status" });
    for (const s of statuses) {
      const opt = sel.createEl("option", { text: s || "—" });
      opt.value = s;
    }
    const status = typeof fm.status === "string" ? fm.status : "";
    sel.value = statuses.includes(status) ? status : "";
    sel.setAttr("title", sel.value || t("shared.status.none"));
    sel.addEventListener("change", () => {
      void (async () => {
        await this.setFm(file, "status", sel.value);
        sel.setAttr("title", sel.value || t("shared.status.none"));
        sel.blur();
      })();
    });
    return sel;
  }

  makeTagsEditorPlain(parent: HTMLElement, file: TFile): HTMLElement {
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const tag of tags) {
      wrap.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${tag}`);
    }
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : t("shared.tags.placeholder") },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#/, "").trim())
        .filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      void (async () => {
        await this.setFm(file, "tags", merged);
        input.value = "";
        input.blur();
      })();
    });
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", t("shared.tags.removeTooltip"));
      chip.addEventListener("click", () => {
        const next = tags.filter((_, j) => j !== idx);
        void this.setFm(file, "tags", next);
      });
    });
    return wrap;
  }

  async renderResearchBody(container: HTMLElement, root: TFolder, gen: number): Promise<void> {
    const S = this.plugin.settings;
    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    const searchInput = toolbar.createEl("input", {
      type: "text",
      cls: "feuillets-binder-search",
      attr: { placeholder: t("shared.research.searchPlaceholder") },
    });
    searchInput.value = S.researchSearch || "";
    let researchSearchTimer: ReturnType<Window["setTimeout"]>;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(researchSearchTimer);
      const caret = searchInput.selectionStart;
      researchSearchTimer = window.setTimeout(() => {
        void (async () => {
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
          const el = scope.querySelector<HTMLInputElement>(".feuillets-binder-search");
          if (el) {
            el.focus();
            el.setSelectionRange(caret, caret);
          }
        })();
      }, 250);
    });

    const researchRoot = this.plugin.getResearchRoot();
    const baseResearch = researchRoot
      ? researchRoot.path
      : `${root.path}/_Recherche`;
    const baseResearchFolder = asFolder(await this.plugin.ensureFolder(baseResearch));
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
        t("shared.research.insertCitationTooltip")
      );
      citeSearchBtn.addEventListener("click", () => this.plugin.openInsertCitation());

      const renumberBtn = this.iconBtn(
        toolbar,
        "list-ordered",
        t("shared.research.renumberFootnotesTooltip")
      );
      renumberBtn.addEventListener("click", () => this.plugin.renumberActiveFootnotes());
    }

    /* Rubriques personnalisées (voir plus bas, "customFolders") : au lieu
       d'imposer un jeu figé de dossiers, l'utilisateur crée exactement
       les catégories dont SON sujet a besoin — un sous-dossier de
       Recherche/ créé ici apparaît automatiquement comme sa propre
       section. Disponible en fiction comme en non-fiction. */
    const newFolderBtn = this.iconBtn(toolbar, "folder-plus", t("shared.research.newTopicTooltip"));
    newFolderBtn.addEventListener("click", () => {
      if (baseResearchFolder) this.plugin.newFolder(baseResearchFolder);
    });

    const sourcesFolder = rf.sources
      ? asFolder(await this.plugin.ensureFolder(`${baseResearch}/${rf.sources.label}`))
      : null;
    const bibliographieFolder = asFolder(await this.plugin.ensureFolder(
      `${baseResearch}/${rf.bibliographie.label}`
    ));
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
      ? asFolder(await this.plugin.ensureFolder(`${baseResearch}/${rf.personnages.label}`))
      : null;
    const lieuxFolder = rf.lieux
      ? asFolder(await this.plugin.ensureFolder(`${baseResearch}/${rf.lieux.label}`))
      : null;
    const codexFolder = rf.codex
      ? asFolder(await this.plugin.ensureFolder(`${baseResearch}/${rf.codex.label}`))
      : null;
    const glossaireFolder = rf.glossaire
      ? asFolder(await this.plugin.ensureFolder(`${baseResearch}/${rf.glossaire.label}`))
      : null;
    const chronoFolder = rf.evenements
      ? this.plugin.getChronoFolder() || asFolder(await this.plugin.ensureFolder(`${baseResearch}/Chronologie`))
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

    const customFolders: TFolder[] = [];
    if (researchRoot && researchRoot instanceof TFolder) {
      for (const child of researchRoot.children) {
        if (child instanceof TFolder && !standardPaths.has(child.path)) {
          if (!child.name.startsWith("_") && !child.name.startsWith(".")) {
            customFolders.push(child);
          }
        }
      }
    }

    const resPath = resourcesFolderPath(this.app, root);
    const visuelsPath = resourcesSubfolderPath(this.app, resPath, "Assets", "Visuels");
    const fVisuels = this.app.vault.getAbstractFileByPath(visuelsPath);
    if (fVisuels instanceof TFolder && fVisuels.children.some((c) => isResearchFile(c))) {
      if (!customFolders.some((f) => f.path === fVisuels.path)) {
        customFolders.push(fVisuels);
      }
    }

    customFolders.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    const tagSet = new Set<string>();
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
      .filter((f): f is TFolder => f instanceof TFolder)
      .flatMap((f) =>
        f.children.filter((c): c is TFile => isResearchFile(c))
      );
    for (const f of allEntityFiles) {
      for (const tag of this.plugin.tagsOf(f)) tagSet.add(tag);
    }
    const STRUCTURAL_TAGS = new Set([
      "personnage", "lieu", "evenement", "codex", "source", "bibliographie", "glossaire",
    ]);
    const tagOptions = [...tagSet]
      .filter((tag) => !STRUCTURAL_TAGS.has(foldAccents(tag)))
      .sort((a, b) => a.localeCompare(b, "fr"));

    const tagFilterActive = !!S.researchTagFilter;
    const tagFilterBtn = this.iconBtn(
      toolbar,
      tagFilterActive ? "tag" : "tags",
      tagFilterActive
        ? t("shared.research.tagFilterActive", { tag: S.researchTagFilter })
        : t("shared.research.tagFilterTooltip")
    );
    if (tagFilterActive) tagFilterBtn.addClass("feuillets-mode-active");
    tagFilterBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("shared.research.allTags"))
          .setChecked(!S.researchTagFilter)
          .onClick(async () => {
            S.researchTagFilter = "";
            await this.plugin.saveSettings();
            await this.render(true);
          })
      );
      for (const tag of tagOptions) {
        menu.addItem((item) =>
          item
            .setTitle(`#${tag}`)
            .setChecked(S.researchTagFilter === tag)
            .onClick(async () => {
              S.researchTagFilter = tag;
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
      const citeRowAction = (header: HTMLElement, file: TFile) => {
        const citeBtn = this.iconBtn(header, "quote", "Citer cette source…");
        citeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.plugin.quickCiteSource(file);
        });
      };
      this.renderSection(body, rf.sources.label, sourcesFolder, async () =>
        this.createEntity(
          sourcesFolder,
          rf.sources!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "sources", rf.sources!.newName)
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
          rf.personnages!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "personnages", rf.personnages!.newName)
        ), "personnages"
      );
    }

    if (rf.lieux && lieuxFolder) {
      this.renderSection(body, rf.lieux.label, lieuxFolder, async () =>
        this.createEntity(
          lieuxFolder,
          rf.lieux!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "lieux", rf.lieux!.newName)
        ), "lieux"
      );
    }

    if (rf.codex && codexFolder) {
      this.renderSection(body, rf.codex.label, codexFolder, async () =>
        this.createEntity(
          codexFolder,
          rf.codex!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "codex", rf.codex!.newName)
        ), "codex"
      );
    }

    if (rf.glossaire && glossaireFolder) {
      this.renderSection(body, rf.glossaire.label, glossaireFolder, async () =>
        this.createEntity(
          glossaireFolder,
          rf.glossaire!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "glossaire", rf.glossaire!.newName)
        ), "glossaire"
      );
    }

    if (rf.evenements && chronoFolder) {
      this.renderSection(body, rf.evenements.label, chronoFolder, async () =>
        this.createEntity(
          chronoFolder,
          rf.evenements!.newName,
          await getResearchTemplate(this.app, this.plugin.settings, mode, "evenements", rf.evenements!.newName)
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
            `title: "Nouveau ${folder.name.toLowerCase().replace(/s$/, "")}"`,
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
        this.renderSection(body, t("shared.research.vaultOtherNotes"), vaultMatches, undefined, "coffre");
      }
    }

    this.filterEntities();
  }

  async renderFileView(container: HTMLElement, file: TFile, _root: TFolder | null): Promise<void> {
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

    this.iconBtn(bar, "arrow-left", t("shared.fileView.closeTooltip"), () => {
      this.viewingFile = null;
      void this.render();
    });
    this.iconBtn(bar, "external-link", t("shared.openNewTab"), () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(true), file);
    });

    this.barSep(bar);

    // Boutons de prélèvement
    this.iconBtn(bar, "link", t("shared.fileView.insertLinkTooltip"), () => {
      this.plugin.insertIntoActiveEditor(`[[${file.path}]]`);
    });
    this.iconBtn(bar, "quote", t("shared.fileView.insertExcerptTooltip"), () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice(t("shared.fileView.selectExcerptFirst"));
        return;
      }
      this.plugin.insertIntoActiveEditor(formatExcerpt(this.selectedText));
    });
    this.iconBtn(bar, "book-copy", t("shared.fileView.insertSourcedExcerptTooltip"), () => {
      if (!this.selectedText || !this.selectedText.trim()) {
        new Notice(t("shared.fileView.selectExcerptFirst"));
        return;
      }
      /* fiche Source/Bibliographie : citation formatée (footnote ou
         auteur-date selon le réglage du projet), avec sa vraie page —
         avant, ce bouton se contentait d'accrocher "Source : [[lien]]",
         jamais une référence bibliographique réelle. Toute AUTRE fiche
         (Personnage, Lieu, Codex…) n'a pas de champs de citation : garde
         le renvoi par lien, seul repère qui ait du sens pour elles. */
      const tags = this.plugin.tagsOf(file).map((tag) => foldAccents(tag));
      const isCitable = tags.includes("source") || tags.includes("bibliographie");
      if (!isCitable) {
        this.plugin.insertIntoActiveEditor(formatSourcedExcerpt(this.selectedText, file.path));
        return;
      }
      const editor = this.plugin.activeEditorAnywhere();
      if (!editor) {
        new Notice(t("shared.fileView.openSceneFirst"));
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

    this.iconBtn(bar, "copy-plus", t("shared.duplicate"), async () => {
      const content = await this.app.vault.read(file);
      const copySuffix = t("binder.research.copySuffix");
      let name = `${file.basename} (${copySuffix})`;
      let dest = normalizePath(`${file.parent!.path}/${name}.md`);
      let k = 2;
      while (this.app.vault.getAbstractFileByPath(dest)) {
        name = `${file.basename} (${copySuffix} ${k++})`;
        dest = normalizePath(`${file.parent!.path}/${name}.md`);
      }
      const copy = await this.app.vault.create(dest, content);
      new Notice(t("shared.duplicated", { name }));
      this.viewingFile = copy;
      void this.render();
    });
    this.iconBtn(bar, "trash", t("shared.trash"), async () => {
      await this.app.fileManager.trashFile(file);
      new Notice(t("shared.trashed", { name: this.plugin.titleFor(file) }));
      this.viewingFile = null;
      void this.render();
    });

    const row = wrapper.createDiv({ cls: "feuillets-fileview-row" });
    row.createSpan({ cls: "feuillets-notes-label" }).setText(t("shared.label.field"));
    this.makeLabelSelect(row, file);
    this.makeTagsEditorPlain(wrapper, file);

    const body = wrapper.createDiv({ cls: "feuillets-fileview-body" });
    await this.makeBodyEditor(body, file);

    body.addEventListener("mouseup", (e) => {
      /* window.getSelection() ne voit jamais l'intérieur d'un <textarea>
         (sélection native du champ, hors de l'API Selection du navigateur)
         — sans ce cas séparé, sélectionner un extrait pendant l'édition
         de la fiche (plutôt qu'en lecture) ne capturait jamais rien. */
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) {
        this.selectedText = target.value.substring(target.selectionStart, target.selectionEnd);
        return;
      }
      const selection = window.getSelection();
      this.selectedText = selection ? selection.toString() : "";
    });
  }

  renderSection(
    container: HTMLElement,
    title: string,
    folderOrFiles: TFolder | TFile[],
    onCreate?: () => Promise<void>,
    iconKey?: string,
    rowAction?: (header: HTMLElement, file: TFile) => void
  ): void {
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
      icon: getResearchSectionIcon(iconKey || ""),
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
      onCreate: onCreate ? () => { void onCreate(); } : undefined,
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });

    /* Glisser-déposer : une rubrique adossée à un vrai dossier (pas la vue
       agrégée "Coffre") devient une cible de dépôt — on y déplace le fichier
       glissé depuis une autre rubrique. */
    const destFolder = folderOrFiles instanceof TFolder ? folderOrFiles : null;
    if (destFolder) this.attachResearchDropTarget(section, destFolder);

    let files: TFile[] = [];
    if (folderOrFiles instanceof TFolder) {
      files = folderOrFiles.children
        .filter((c): c is TFile => isResearchFile(c))
        .sort((a, b) =>
          this.plugin.titleFor(a).localeCompare(this.plugin.titleFor(b), "fr")
        );
    } else if (Array.isArray(folderOrFiles)) {
      files = folderOrFiles;
    }

    if (files.length === 0) {
      list.createDiv({ cls: "feuillets-research-empty" }).setText(t("shared.research.empty"));
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
            ? t("shared.research.insertImageTooltip")
            : t("shared.research.insertPdfLinkTooltip")
        );
        insertLinkBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const fname = f.name;
          const link = isImageFile(f) ? `![[${fname}]]` : `[[${fname}]]`;
          this.plugin.insertIntoActiveEditor(link);
          new Notice(t("shared.research.linkInserted", { name: fname }));
        });

        const openFileBtn = this.iconBtn(
          header,
          "external-link",
          t("shared.research.openFile")
        );
        openFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
        });
      } else if (Array.isArray(folderOrFiles)) {
        const openFileBtn = this.iconBtn(
          header,
          "external-link",
          t("shared.openNewTab")
        );
        openFileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), f);
        });
      } else {
        const appearBtn = this.iconBtn(
          header,
          "list",
          t("shared.research.appearancesTooltip")
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
        void this.render();
      });
    }
  }

  /** Bouton "œil" : déclenche l'aperçu natif d'Obsidian (Aperçu de page) au
   * CLIC plutôt qu'au survol — le survol automatique gênait (aperçu qui
   * s'ouvre en passant simplement la souris sur la liste). */
  addPreviewBtn(header: HTMLElement, f: TFile): HTMLElement {
    const btn = this.iconBtn(header, "eye", t("shared.previewTooltip"));
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
  attachResearchDragSource(row: HTMLElement, file: TFile): void {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      this.plugin._researchDragPath = file.path;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", file.path);
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
  attachResearchDropTarget(section: HTMLElement, destFolder: TFolder): void {
    section.addEventListener("dragover", (e) => {
      if (!this.plugin._researchDragPath) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      section.addClass("feuillets-dragover");
    });
    section.addEventListener("dragleave", (e) => {
      if (!(e.relatedTarget instanceof Node) || !section.contains(e.relatedTarget)) section.removeClass("feuillets-dragover");
    });
    section.addEventListener("drop", (e) => {
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
        new Notice(t("shared.research.duplicateNameInSection"));
        return;
      }
      void (async () => {
        await this.app.fileManager.renameFile(file, dest);
        this.plugin.renderAllViews(true);
      })();
    });
  }

  /** Toutes les notes de bas de page ("[^N]: texte") du manuscrit, scène
   * par scène mais regroupées en un seul endroit — pas fichier par
   * fichier comme dans le panneau Notes. Signale aussi les références
   * orphelines : un "[^N]" cité dans le texte sans définition
   * correspondante, ou l'inverse (définie mais jamais citée) — souvent le
   * signe d'un texte coupé/collé entre scènes qui a cassé une note. */
  async renderFootnotesOverviewSection(container: HTMLElement, root: TFolder): Promise<void> {
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
      title: t("shared.footnotes.title"),
      icon: "list",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-research-list" });
    const numbering = this.plugin.buildNumbering(root);
    const files = this.plugin
      .flattenFiles(root)
      .sort((a, b) => (Number(numbering.get(a.path)) || 0) - (Number(numbering.get(b.path)) || 0));

    const defRe = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
    const refRe = /\[\^([^\]]+)\](?!:)/g;
    let anyContent = false;

    for (const file of files) {
      const raw = await this.app.vault.cachedRead(file);
      const text = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

      const defs = new Map<string, string>();
      defRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = defRe.exec(text))) defs.set(m[1], m[2].trim());

      const refs = new Set<string>();
      refRe.lastIndex = 0;
      while ((m = refRe.exec(text))) refs.add(m[1]);

      if (defs.size === 0 && refs.size === 0) continue;
      anyContent = true;

      const group = list.createDiv({ cls: "feuillets-footnotes-overview-group" });
      const head = group.createDiv({ cls: "feuillets-footnotes-overview-head" });
      head.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      head.setAttr("title", t("shared.footnotes.openSceneTooltip"));
      head.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      for (const [label, footnoteText] of defs) {
        const row = group.createDiv({ cls: "feuillets-footnotes-overview-row" });
        row.createSpan({ cls: "feuillets-footnotes-overview-label" }).setText(`[^${label}]`);
        row.createSpan({ cls: "feuillets-footnotes-overview-text" }).setText(footnoteText);
        if (!refs.has(label)) {
          row.addClass("feuillets-footnotes-overview-orphan");
          row.setAttr("title", t("shared.footnotes.definedNeverCited"));
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
          .setText(t("shared.footnotes.citedNeverDefined"));
        row.setAttr("title", t("shared.footnotes.citedNeverDefinedTooltip"));
      }
    }

    if (!anyContent) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("shared.footnotes.empty"));
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
  async renderBibliographySection(container: HTMLElement, root: TFolder, candidateFolders: TFolder[]): Promise<void> {
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
      title: t("shared.bibliography.title"),
      icon: "library",
      collapsed,
      collapseKey,
      settings: S,
      onToggle: async () => {
        await this.plugin.saveSettings();
        void this.render();
      },
    });
    if (collapsed) return;
    const sectionEl = section;

    const files = candidateFolders.flatMap((f) =>
      f.children.filter((c): c is TFile => c instanceof TFile && c.extension === "md")
    );
    const cited = files.filter((f) => (this.plugin.fmOf(f).cite_count || 0) > 0);

    const exportRow = sectionEl.createDiv({ cls: "feuillets-bibliography-export-row" });
    exportRow.setAttr("title", t("shared.bibliography.exportTooltip"));
    const exportIcon = exportRow.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(exportIcon, "file-output");
    exportRow.createSpan().setText(t("shared.bibliography.generate"));
    exportRow.addEventListener("click", () => { void this.plugin.generateBibliographyFile(); });

    const list = sectionEl.createDiv({ cls: "feuillets-research-list" });
    if (cited.length === 0) {
      list
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("shared.bibliography.empty"));
      return;
    }

    const sorted = [...cited].sort((a, b) => {
      const authorA = this.plugin.fmOf(a).author;
      const authorB = this.plugin.fmOf(b).author;
      return (typeof authorA === "string" ? authorA : "").localeCompare(typeof authorB === "string" ? authorB : "", "fr");
    });
    for (const f of sorted) {
      const fm = this.plugin.fmOf(f);
      const row = list.createDiv({ cls: "feuillets-research-item" });
      const header = row.createDiv({ cls: "feuillets-research-item-header" });
      const n = Number(fm.cite_count) || 0;
      header
        .createDiv({ cls: "feuillets-research-item-name" })
        .setText(t("shared.bibliography.citationCount", { title: this.plugin.titleFor(f), count: String(n), s: n > 1 ? "s" : "" }));
      row.addEventListener("click", () => {
        this.viewingFile = f;
        void this.render();
      });
    }
  }

  /** "Dossiers de recherche sauvegardés" — un filtre Recherche (texte +
   * tag) enregistré sous un nom, réappliqué en un clic. Ne crée pas de
   * vrai dossier sur le disque : juste une combinaison de critères
   * mémorisée par projet (S.projectMeta[root.path].savedResearchFilters),
   * rejouée sur les mêmes fiches à chaque clic — donc toujours à jour,
   * contrairement à un dossier figé qu'il faudrait retrier à la main. */
  renderSavedFiltersButton(toolbar: HTMLElement, root: TFolder | null): void {
    if (!root) return;
    const S = this.plugin.settings;
    if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
    const meta = S.projectMeta[root.path];
    const filters = (meta.savedResearchFilters as { name: string; search: string; tag: string }[] | undefined) || [];

    const btn = this.iconBtn(toolbar, "bookmark", t("shared.savedFilters.tooltip"));
    btn.addEventListener("click", (e) => {
      const menu = new Menu();
      const hasActiveFilter = !!(S.researchSearch || "").trim() || !!S.researchTagFilter;
      menu.addItem((item) =>
        item
          .setTitle(t("shared.savedFilters.save"))
          .setIcon("bookmark-plus")
          .setDisabled(!hasActiveFilter)
          .onClick(() => {
            new SaveResearchFilterModal(this.app, async (name) => {
              if (!meta.savedResearchFilters) meta.savedResearchFilters = [];
              (meta.savedResearchFilters as { name: string; search: string; tag: string }[]).push({
                name,
                search: S.researchSearch || "",
                tag: S.researchTagFilter || "",
              });
              await this.plugin.saveSettings();
              void this.render(true);
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
              void this.render(true);
            })
          );
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle(t("shared.savedFilters.manage"))
            .setIcon("settings")
            .onClick(() => {
              new ManageSavedFiltersModal(this.app, this.plugin, root, () => this.render(true)).open();
            })
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  filterEntities(): void {
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
      (el as HTMLElement).style.display = matchSearch && matchTag ? "" : "none";
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
      if (filterActive && empty) (empty as HTMLElement).hide();
      (sec as HTMLElement).style.display =
        filterActive && visible.length === 0 && !empty ? "none" : "";
    });
  }

  async buildSearchIndex(files: TFile[]): Promise<Map<string, { mtime: number; text: string }>> {
    if (!this._searchCache) this._searchCache = new Map();
    return refreshSearchIndex(this._searchCache, files, async (f) => {
      if (!(f instanceof TFile)) return "";
      const raw = await this.app.vault.cachedRead(f);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
      return foldAccents(body);
    });
  }

  iconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick?: (e: MouseEvent) => void | Promise<void>): HTMLElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, tooltip);
    if (onClick) btn.addEventListener("click", (e) => { void onClick(e); });
    return btn;
  }

  barSep(parent: HTMLElement): HTMLElement {
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
  renderSectionHead(
    section: HTMLElement,
    icon: string,
    title: string,
    namespace: string,
    key: string,
    renderActions?: (actions: HTMLElement) => void
  ): boolean {
    const S = this.plugin.settings;
    const collapseKey = `${namespace}:${key}`;
    const isCollapsed = !!S.collapsed[collapseKey];

    const head = section.createDiv({ cls: "feuillets-section-head" });
    const titleEl = head.createDiv({ cls: "feuillets-section-title" });
    const iconEl = titleEl.createSpan({ cls: "feuillets-section-icon" });
    setIcon(iconEl, icon);
    titleEl.createSpan({ cls: "feuillets-section-title-text" }).setText(title);
    titleEl.addEventListener("click", () => {
      void (async () => {
        if (isCollapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    });
    if (renderActions) {
      const actions = head.createDiv({ cls: "feuillets-project-actions" });
      renderActions(actions);
    }
    return isCollapsed;
  }

  showFileContextMenu(e: MouseEvent, file: TFile, parent: ProjectNode, index: number, _siblings: ProjectNode[]): void {
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
      ? [...groupSel].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile)
      : [file];

    if (isGroup) {
      menu.addItem((item) => item.setTitle(t("shared.contextMenu.groupSelected", { count: String(groupFiles.length) })).setDisabled(true));
      menu.addSeparator();
    }

    menu.addItem((item) =>
      item
        .setTitle(t("shared.openNewTab"))
        .setIcon("file-plus")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
        })
    );
    /* « Ouvrir avec aperçu » vit ICI et pas seulement dans le hook
       `workspace.on("file-menu")` : le Binder construit son propre Menu et
       ne passe jamais par ce hook — l'entrée y était donc invisible.
       Réservée aux vraies scènes (roleOfFile), pas aux feuillets-chapitres
       ni aux fiches hors manuscrit. */
    if (!isGroup) {
      addOpenWithPreviewItem(menu, this.app, plugin, file);
    }
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.openSplit"))
        .setIcon("columns-2")
        .onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.research.compareWith"))
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
        .setTitle(t("shared.contextMenu.newSheetBefore"))
        .setIcon("corner-left-up")
        .onClick(async () => {
          plugin.newSheetAt(asFolder(parent), index);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.newSheetAfter"))
        .setIcon("corner-left-down")
        .onClick(async () => {
          plugin.newSheetAt(asFolder(parent), index + 1);
        })
    );
    menu.addSeparator();

    const currentStatus = (this.fm(file).status as string) || "";
    const allStatuses = getProjectStatuses(this.plugin ? this.plugin.settings : null);
    for (const st of allStatuses.filter(Boolean)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: st }))
          .setChecked(!isGroup && st === currentStatus)
          .onClick(async () => {
            if (isGroup) await this.applyBulkStatus(groupFiles, st);
            else await this.setFm(file, "statut", st === currentStatus ? "" : st);
          })
      );
    }
    menu.addSeparator();

    const currentLabel = plugin.labelOf(file);
    for (const l of this.getProjectLabels()) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.labelLabel", { label: l.name }))
          .setChecked(!isGroup && l.name === currentLabel)
          .onClick(async () => {
            if (isGroup) await this.applyBulkLabel(groupFiles, l.name);
            else await this.setFm(file, "label", l.name === currentLabel ? "" : l.name);
          })
      );
    }
    menu.addSeparator();

    if (isGroup) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.addTagToGroup"))
          .setIcon("tag")
          .onClick(() => this.promptBulkTag(groupFiles, () => { void this.render(); }))
      );
      menu.addSeparator();
    }

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.snapshot"))
        .setIcon("camera")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const n = await plugin.snapshotFile(file, root);
          new Notice(t("shared.contextMenu.snapshotCreated", { name: n }));
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.compareWithSnapshot"))
        .setIcon("history")
        .onClick(async () => {
          const root = plugin.getProjectFolder();
          if (!root) return;
          const snapshots = listSnapshotFiles(this.app, file, root);
          if (snapshots.length === 0) {
            new Notice(t("shared.contextMenu.noSnapshotFound", { name: file.basename }));
            return;
          }
          new DiffModal(this.app, plugin, file, snapshots[0]).open();
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.duplicate"))
        .setIcon("copy")
        .onClick(async () => {
          const content = await this.app.vault.read(file);
          const copySuffix = t("binder.research.copySuffix");
          let name = `${file.basename} (${copySuffix})`;
          let dest = normalizePath(`${(asFolder(parent)).path}/${name}.md`);
          let k = 2;
          while (this.app.vault.getAbstractFileByPath(dest)) {
            name = `${file.basename} (${copySuffix} ${k++})`;
            dest = normalizePath(`${(asFolder(parent)).path}/${name}.md`);
          }
          await this.app.vault.create(dest, content);
          plugin.renderAllViews(true);
          new Notice(t("shared.duplicated", { name }));
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.trash"))
        .setIcon("trash")
        .onClick(async () => {
          await this.app.fileManager.trashFile(file);
          plugin.renderAllViews(true);
          new Notice(t("shared.trashed", { name: plugin.titleFor(file) || file.basename }));
        })
    );
    menu.showAtMouseEvent(e);
  }

  showFolderContextMenu(e: MouseEvent, folder: TFolder, _parent: ProjectNode, _index: number, _siblings: ProjectNode[]): void {
    const menu = new Menu();
    const plugin = this.plugin;

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.newSheetInside"))
        .setIcon("file-plus")
        .onClick(async () => {
          plugin.newSheet(folder);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("binder.newSubfolder"))
        .setIcon("folder-plus")
        .onClick(async () => {
          plugin.newFolder(folder);
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.openFolderNote"))
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
          .setTitle(t("shared.contextMenu.labelLabel", { label: l.name }))
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
    const currentStatus = note ? ((this.fm(note).status as string) || "") : "";
    const allStatuses = getProjectStatuses(plugin ? plugin.settings : null);
    for (const st of allStatuses.filter(Boolean)) {
      menu.addItem((item) =>
        item
          .setTitle(t("shared.contextMenu.statusLabel", { status: st }))
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
        .setTitle(t("shared.contextMenu.editTags"))
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
        .setTitle(t("shared.contextMenu.editSynopsis"))
        .setIcon("text")
        .onClick(async () => {
          const targetNote = note || await plugin.getOrCreateFolderNote(folder);
          if (targetNote) {
            new FmFieldModal(this.app, plugin, targetNote, "synopsis", t("shared.contextMenu.folderSynopsisLabel"), () => this.render(true)).open();
          }
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.editSummary"))
        .setIcon("file-text")
        .onClick(async () => {
          const targetNote = note || await plugin.getOrCreateFolderNote(folder);
          if (targetNote) {
            new FmFieldModal(this.app, plugin, targetNote, "summary", t("shared.contextMenu.folderSummaryLabel"), () => this.render(true)).open();
          }
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.setWordGoal"))
        .setIcon("target")
        .onClick(() => {
          new FolderGoalModal(this.app, plugin, folder).open();
        })
    );
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("shared.contextMenu.trashFolder"))
        .setIcon("trash")
        .onClick(async () => {
          await this.app.fileManager.trashFile(folder);
          plugin.renderAllViews(true);
          new Notice(t("shared.contextMenu.folderTrashed", { name: folder.name }));
        })
    );
    menu.showAtMouseEvent(e);
  }

  constructor(leaf: WorkspaceLeaf, plugin: FeuilletsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getProjectFolder(): TFolder | null {
    return this.plugin.getProjectFolder();
  }

  fm(file: TFile): SceneFrontmatter {
    return this.plugin.fmOf(file);
  }

  titleFor(file: TFile): string {
    return this.plugin.titleFor(file);
  }

  async setFm(file: TFile, key: string, value: unknown): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: SceneFrontmatter) => {
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

  goalFor(file: TFile): number {
    const g = parseInt(String(this.fm(file).goal), 10);
    return isNaN(g) ? this.plugin.settings.wordGoal : g;
  }

  ringState(wc: number, goal: number): "none" | "hit" | "over" | "under" {
    const tol = Number(this.plugin.settings.tolerance);
    if (goal <= 0) return "none";
    if (wc >= goal - tol && wc <= goal + tol) return "hit";
    if (wc > goal + tol) return "over";
    return "under";
  }

  fillRing(ring: HTMLElement, wc: number, goal: number): void {
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
  handleMultiSelectClick(e: MouseEvent, file: TFile, parent: ProjectNode, index: number, siblings: ProjectNode[], scopeEl: HTMLElement): boolean {
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

  refreshMultiSelectClasses(scopeEl: HTMLElement): void {
    const sel = this.plugin._binderMultiSelect;
    scopeEl.querySelectorAll("[data-path]").forEach((el) => {
      const path = el.getAttr("data-path");
      if (sel && path && sel.has(path)) el.addClass("feuillets-multiselected");
      else el.removeClass("feuillets-multiselected");
    });
  }

  /** Actions groupées — mêmes trois gestes partagés entre le clic droit du
   * Binder/Plan (showFileContextMenu) et le mode sélection du panneau
   * Cartes : appliquer un statut, un label, ou ajouter un tag à toute une
   * liste de feuillets d'un coup. Centralisé ici pour ne pas avoir deux
   * copies de la même boucle setFm+Notice à maintenir. */
  async applyBulkStatus(files: TFile[], status: string): Promise<void> {
    for (const f of files) await this.setFm(f, "statut", status);
    new Notice(t("shared.bulk.statusApplied", { status, count: String(files.length), s: files.length > 1 ? "s" : "" }));
  }

  async applyBulkLabel(files: TFile[], labelName: string): Promise<void> {
    for (const f of files) await this.setFm(f, "label", labelName);
    new Notice(t("shared.bulk.labelApplied", { label: labelName, count: String(files.length), s: files.length > 1 ? "s" : "" }));
  }

  promptBulkTag(files: TFile[], onDone?: () => void): void {
    new TextInputModal(
      this.app,
      t("shared.bulk.addTagTitle", { count: String(files.length), s: files.length > 1 ? "s" : "" }),
      [{ name: "tag", label: t("shared.tags.field"), value: "" }],
      async (values) => {
        const clean = String(values.tag || "").trim().replace(/^#/, "");
        if (!clean) return;
        for (const f of files) {
          const existing = this.plugin.tagsOf(f);
          if (!existing.includes(clean)) await this.setFm(f, "tags", [...existing, clean]);
        }
        new Notice(t("shared.bulk.tagApplied", { tag: clean, count: String(files.length), s: files.length > 1 ? "s" : "" }));
        if (onDone) onDone();
      }
    ).open();
  }

  attachDragHandlers(handleEl: HTMLElement, dropEl: HTMLElement, parent: ProjectNode, index: number, siblings: ProjectNode[], _scopeEl: HTMLElement): void {
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
      e.dataTransfer!.effectAllowed = "move";
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
      e.dataTransfer!.dropEffect = "move";
      dropEl.addClass("feuillets-dragover");
    });
    dropEl.addEventListener("dragleave", () => {
      dropEl.removeClass("feuillets-dragover");
    });
    dropEl.addEventListener("drop", (e) => {
      void (async () => {
      e.preventDefault();
      dropEl.removeClass("feuillets-dragover");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;

      if (drag.multi) {
        if (this.plugin._binderMultiSelect) this.plugin._binderMultiSelect.clear();
        const sameParentTarget = drag.parentPath === parent.path ? siblings[index] : null;
        const draggedIndices = new Set((drag.items || []).map((it) => it.index));
        if (
          sameParentTarget instanceof TFolder &&
          !draggedIndices.has(index)
        ) {
          /* Cible = un dossier frère (même parent que le groupe déplacé,
             ex. tous deux enfants directs de la racine du projet) : on
             veut y déposer le groupe, pas le réordonner parmi ses frères
             — sinon glisser un feuillet à la racine vers un dossier vide
             comme Front (même parent) ne faisait jamais rien. */
          const insertIndex = Number.MAX_SAFE_INTEGER;
          for (const it of (drag.items || [])) {
            const node = this.app.vault.getAbstractFileByPath(it.path);
            if (!node) continue;
            await this.plugin.moveNode(node as ProjectNode, asFolder(parent), sameParentTarget, insertIndex);
          }
        } else if (drag.parentPath === parent.path) {
          if (draggedIndices.has(index)) return;
          const movedNodes = (drag.items || []).map((it) => siblings[it.index]).filter(Boolean);
          const remaining = siblings.filter((_, i) => !draggedIndices.has(i));
          /* Les éléments déplacés situés avant la cible sont déjà retirés
             de `remaining` — décaler l'index cible d'autant pour tomber au
             bon endroit une fois le groupe réinséré. */
          const removedBefore = (drag.items || []).filter((it) => it.index < index).length;
          const targetIndex = Math.max(0, index - removedBefore);
          const reordered = [...remaining];
          reordered.splice(targetIndex, 0, ...movedNodes);
          await this.plugin.applySiblingOrder(asFolder(parent), reordered);
        } else {
          const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
          if (srcParent instanceof TFolder) {
            const target = siblings[index];
            let destFolder: TFolder = asFolder(parent);
            let insertIndex = index;
            if (target instanceof TFolder) {
              destFolder = target;
              insertIndex = Number.MAX_SAFE_INTEGER;
            }
            for (const it of (drag.items || [])) {
              const node = this.app.vault.getAbstractFileByPath(it.path);
              if (!node) continue;
              await this.plugin.moveNode(node as ProjectNode, srcParent, destFolder, insertIndex);
              if (insertIndex !== Number.MAX_SAFE_INTEGER) insertIndex++;
            }
          }
        }
        this.plugin.renderAllViews(true);
        return;
      }

      if (drag.parentPath === parent.path) {
        const from = drag.index!;
        if (from === index) return;
        const target = siblings[index];
        const draggedNode = siblings[from];
        /* Cible = un dossier frère (même parent que le fichier déplacé,
           ex. tous deux enfants directs de la racine du projet) : déposer
           dessus doit le déplacer DEDANS, pas juste réordonner les frères
           — sinon glisser un feuillet à la racine vers un dossier vide
           comme Front (même parent) ne faisait jamais rien. Seulement si
           l'élément déplacé est un FICHIER : un dossier déplacé sur un
           dossier frère doit rester un simple réordonnancement (Cartes,
           Plan…), sinon on ne peut plus jamais réorganiser l'ordre des
           dossiers entre eux — glisser un dossier reste toujours une
           réorganisation ici, jamais un emboîtement. */
        if (
          target instanceof TFolder &&
          target.path !== drag.path &&
          !(draggedNode instanceof TFolder)
        ) {
          const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
          if (moved) await this.plugin.moveNode(moved as ProjectNode, asFolder(parent), target, Number.MAX_SAFE_INTEGER);
          this.plugin.renderAllViews(true);
          return;
        }
        const reordered = [...siblings];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(index, 0, moved);
        await this.plugin.applySiblingOrder(asFolder(parent), reordered);
        this.plugin.renderAllViews(true);
        return;
      }

      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      const target = siblings[index];
      let destFolder: TFolder = asFolder(parent);
      let insertIndex = index;
      if (target instanceof TFolder && target.path !== moved.path) {
        destFolder = target;
        insertIndex = Number.MAX_SAFE_INTEGER;
      }
      await this.plugin.moveNode(moved as ProjectNode, srcParent, destFolder, insertIndex);
      this.plugin.renderAllViews(true);
      })();
    });
  }

  /** Zone de dépôt de secours pour un dossier sans aucun feuillet (ex. Front
   * juste après la création du projet) : attachDragHandlers n'attache ses
   * écouteurs qu'aux lignes de fiches réellement rendues, donc un dossier
   * vide n'a alors aucune cible de drop — glisser une scène dedans ne
   * faisait rien. `dropEl` est ici le message "Aucun feuillet…" affiché à
   * la place de la liste ; le dépôt ajoute simplement à la fin de `folder`. */
  attachEmptyFolderDropHandler(dropEl: HTMLElement, folder: TFolder): void {
    dropEl.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      dropEl.addClass("feuillets-dragover");
    });
    dropEl.addEventListener("dragleave", () => {
      dropEl.removeClass("feuillets-dragover");
    });
    dropEl.addEventListener("drop", (e) => {
      void (async () => {
      e.preventDefault();
      dropEl.removeClass("feuillets-dragover");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;

      if (drag.multi) {
        if (this.plugin._binderMultiSelect) this.plugin._binderMultiSelect.clear();
        const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
        if (srcParent instanceof TFolder) {
          for (const it of (drag.items || [])) {
            const node = this.app.vault.getAbstractFileByPath(it.path);
            if (!node) continue;
            await this.plugin.moveNode(node as ProjectNode, srcParent, folder, Number.MAX_SAFE_INTEGER);
          }
        }
        this.plugin.renderAllViews(true);
        return;
      }

      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      await this.plugin.moveNode(moved as ProjectNode, srcParent, folder, Number.MAX_SAFE_INTEGER);
      this.plugin.renderAllViews(true);
      })();
    });
  }
}
