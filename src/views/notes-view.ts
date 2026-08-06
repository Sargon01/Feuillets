import { MarkdownView, TFile, TFolder, setIcon, type Editor, type WorkspaceLeaf } from "obsidian";

import { VIEW_NOTES } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { foldAccents } from "../utils/core.js";
import { latestStateBefore } from "../utils/entity-states.js";
import { isEditing, openFileActivating } from "../utils/dom.js";
import { ProjectPropertiesModal, ProjectTagsModal } from "../ui/project-properties-modals.js";
import { FRONT_PAGE_TYPES } from "../services/folder-structure.js";
import { DiffModal } from "../ui/diff-modal.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";
import { buildContextIndex, type ContextDocument, type ContextSource } from "../services/context-index.js";
import { matchContext } from "../services/context-matcher.js";
import { extractContextWindow } from "../services/context-window.js";

/** Délai de latence avant de recalculer la section « Contexte » après un
 * déplacement du curseur ou une frappe dans l'éditeur suivi — voir
 * scheduleContextWindowRefresh(). */
const CONTEXT_WINDOW_DEBOUNCE_MS = 300;


type NotesPropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";
type EntityKind = "personnage" | "lieu" | "evenement" | "codex";
type NotesSectionKey = "synopsis" | "summary" | "notes" | "sources";
type NotesFrontmatter = Record<string, unknown> & {
  aliases?: string | string[];
  birth?: unknown;
  date?: unknown;
  death?: unknown;
  synopsis?: unknown;
  type?: unknown;
};
type StoryDate = { sort: number; display: string; y: number; mo: number; d: number };
type Footnote = { label: string; text: string };
type BaseNotesViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type NotesSettings = FeuilletsSettings & {
  collapsed: Record<string, boolean>;
  notesSectionOrder: string[];
  notesShowEntities: boolean;
  notesShowFootnotes: boolean;
  notesShowNotes: boolean;
  notesShowResume: boolean;
  notesShowSynopsis: boolean;
};
type NotesViewPlugin = Omit<BaseNotesViewPlugin, "parseStoryDate" | "settings"> & {
  settings: NotesSettings;
  parseStoryDate(raw: unknown, file?: TFile | null): StoryDate | null;
};

const SECTION_ICONS: Partial<Record<NotesSectionKey, string>> = {
  synopsis: "align-left",
  summary: "file-text",
  notes: "sticky-note",
};

function getNotesSectionIcon(key: NotesSectionKey): string {
  return SECTION_ICONS[key] || "info";
}

/** Icônes par type de propriété, même esprit que le panneau natif
 * Propriétés d'Obsidian — repris de l'ancien onglet Propriétés
 * (properties-view.js), fusionné ici (voir renderFilePropertiesSection). */
const TYPE_ICONS: Record<NotesPropertyType, string> = {
  text: "text",
  list: "list",
  number: "hash",
  checkbox: "check-square",
  date: "calendar",
  datetime: "calendar-clock",
};

/* Priorités des sources de contexte réellement produites par
 * contextSourcesFor() — utilisées uniquement pour dédupliquer un chemin de
 * source apparu deux fois (voir contextSourcesFor). Valeurs alignées sur
 * les priorités par défaut de context-index.ts (feuillet < chapitre <
 * recherche du projet), dupliquées ici à dessein : ce fichier ne doit pas
 * modifier context-index.ts pour ce correctif. */
const CONTEXT_SOURCE_PRIORITY: Record<"feuillet" | "chapter" | "project-research", number> = {
  "feuillet": 0,
  "chapter": 10,
  "project-research": 20,
};

function inferPropertyType(value: unknown): NotesPropertyType {
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  }
  return "text";
}

export class NotesView extends BaseFeuilletsView {
  declare plugin: NotesViewPlugin;
  declare targetContainer?: HTMLElement;
  viewedFile: TFile | null;
  currentPath: string | null;

  /* ===== Fenêtre de contexte autour du curseur (section « Contexte ») =====
     Élément DOM actuellement écouté (keyup/mouseup) pour détecter un
     déplacement du curseur ou une frappe dans l'éditeur Markdown du
     feuillet affiché — et sa fonction de nettoyage, exactement le même
     schéma que PreviewView.bindSourcePane/syncScrollerCleanup (rebranchement
     idempotent, écouteurs posés/retirés à la main car la cible change au
     fil des feuillets, ce que `registerDomEvent` seul ne permettrait pas de
     réévaluer). */
  private cursorTrackedEl: HTMLElement | null = null;
  private cursorTrackedCleanup: (() => void) | null = null;
  private contextWindowTimer: number | null = null;
  /** Dernière fenêtre de contexte (ou corps complet de repli) effectivement
   * envoyée à matchContext() — permet de ne PAS redéclencher un rendu quand
   * le curseur bouge sans changer de paragraphe (règle 5 du chantier). */
  private lastCursorContextText: string | null = null;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, plugin: BaseNotesViewPlugin) {
    super(leaf, plugin);
    this.viewedFile = null; // note de dossier consultée
    this.currentPath = null;
  }

  getViewType(): string {
    return VIEW_NOTES;
  }
  getDisplayText(): string {
    return t("notes.displayText");
  }
  getIcon(): string {
    return "sticky-note";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on("file-open", (newFile: TFile | null) => {
        /* forcé : le fichier actif a changé, il faut refléter le nouveau
           quel que soit l'état du focus — sans ça, si le curseur était
           resté dans un champ de CE panneau (Synopsis, Notes…) au moment
           de cliquer un autre feuillet ailleurs, le panneau restait figé
           sur l'ancien fichier jusqu'à ce qu'on clique dessus pour lui
           rendre le focus. Le garde-fou plus bas reste utile pour les
           rafraîchissements du MÊME fichier (vault "modify"/metadataCache
           "changed"), où il évite de couper une frappe en cours. */
        if (newFile && (!this.viewedFile || newFile.path !== this.viewedFile.path)) {
          this.viewedFile = null;
        }
        void this.render(true);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file: TFile) => {
        const targetPath = this.viewedFile ? this.viewedFile.path : this.currentPath;
        if (file.path === targetPath) void this.render();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        const targetPath = this.viewedFile ? this.viewedFile.path : this.currentPath;
        if (file.path === targetPath) void this.render();
      })
    );
    await this.render(true);
  }

  /** Nettoyage à la fermeture — registerEvent()/registerDomEvent() se
   * chargent déjà de tout ce qui passe par eux (voir onOpen), mais le
   * suivi de curseur est rebranché à la main (cible dynamique, voir
   * bindCursorTracking) et doit donc être détaché à la main aussi, comme
   * PreviewView le fait pour syncScrollerCleanup. Un timer de debounce en
   * vol ne doit jamais déclencher un rendu après fermeture de la vue. */
  async onClose(): Promise<void> {
    this.closed = true;
    this.cursorTrackedCleanup?.();
    this.cursorTrackedCleanup = null;
    this.cursorTrackedEl = null;
    if (this.contextWindowTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.contextWindowTimer);
      this.contextWindowTimer = null;
    }
  }

  async render(force = false): Promise<void> {
    const S = this.plugin.settings;
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;
    container.empty();

    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

    const activeFile = this.app.workspace.getActiveFile();
    let file = this.viewedFile || activeFile;
    if (this.viewedFile) {
      const exists = this.app.vault.getAbstractFileByPath(this.viewedFile.path);
      if (!exists) {
        this.viewedFile = null;
        file = activeFile;
      }
    }

    const root = this.plugin.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("notes.openSheetFirst"));
      this.currentPath = null;
      return;
    }
    this.currentPath = file.path;
    const fm: NotesFrontmatter = this.fm(file);

    // Barre de retour si on consulte une note de dossier
    if (this.viewedFile && activeFile && this.viewedFile.path !== activeFile.path) {
      const backBar = wrapper.createDiv({ cls: "feuillets-notes-back-bar" });
      const backBtn = backBar.createEl("button", {
        cls: "feuillets-back-btn",
        text: ` ${t("notes.backToSheet")}`
      });
      const iconSpan = backBtn.createSpan({ cls: "feuillets-back-icon" });
      setIcon(iconSpan, "arrow-left");
      backBtn.prepend(iconSpan);
      backBtn.addEventListener("click", () => {
        this.viewedFile = null;
        void this.render();
      });
    }

    this.renderFolderNoteLinks(wrapper, file);
    this.renderFilePropertiesSection(wrapper, file);

    const sceneDate: StoryDate | null = this.plugin.parseStoryDate(fm.date, file);
    const jalons: TFile[] = [];
    if (sceneDate) {
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const walk = (cf: TFolder): void => {
          for (const c of cf.children) {
            if (c instanceof TFolder) walk(c);
            else if (c instanceof TFile && c.extension === "md") {
              const d = this.plugin.parseStoryDate(this.fm(c).date, c);
              if (d && d.sort === sceneDate.sort) jalons.push(c);
            }
          }
        };
        walk(chronoFolder);
      }
    }

    if (S.notesShowEntities) {
      await this.renderCitedEntities(wrapper, file, sceneDate, jalons);
    }

    const order = S.notesSectionOrder || ["Synopsis", "Résumé", "Notes"];
    for (const sectionName of order) {
      if (sectionName === "Synopsis" && S.notesShowSynopsis) {
        this.renderCollapsibleTextarea(wrapper, t("notes.section.synopsis"), "synopsis", file, fm, t("notes.section.synopsisPlaceholder"), 3);
      } else if (sectionName === "Résumé" && S.notesShowResume) {
        this.renderCollapsibleTextarea(wrapper, t("notes.section.summary"), "summary", file, fm, t("notes.section.summaryPlaceholder"), 5);
      } else if (sectionName === "Notes" && S.notesShowNotes) {
        this.renderCollapsibleTextarea(wrapper, t("notes.section.notes"), "notes", file, fm, t("notes.section.notesPlaceholder"), 8);
      }
    }

    if (this.plugin.hasSources()) {
      this.renderCollapsibleTextarea(wrapper, t("notes.section.sources"), "sources", file, fm, t("notes.section.sourcesPlaceholder"), 4);
    }

    if (S.notesShowFootnotes) {
      await this.renderFootnotesSection(wrapper, file);
    }
  }

  entityKind(ent: TFile): EntityKind | null {
    const tags = this.plugin.tagsOf(ent).map((tag: string) => foldAccents(tag));
    if (tags.includes("personnage")) return "personnage";
    if (tags.includes("lieu")) return "lieu";
    if (tags.includes("evenement")) return "evenement";
    if (tags.includes("codex")) return "codex";
    return null;
  }

  /** Dossier Chapitre réel du Binder contenant `file` — même définition que
   * PreviewView.chapterFolderOf (dupliquée ici à dessein : ce chantier ne
   * doit pas toucher l'Aperçu). Ne transforme jamais un dossier Partie en
   * chapitre par défaut : son absence est une information de hiérarchie,
   * pas une erreur. */
  private chapterFolderOf(file: TFile): TFolder | null {
    const root = this.plugin.getProjectFolder();
    if (!root) return null;

    const ancestors: TFolder[] = [];
    let folder: TFolder | null = file.parent;
    while (folder && folder.path !== root.path) {
      ancestors.push(folder);
      folder = folder.parent;
    }
    if (!ancestors.length) return null;

    for (const candidate of ancestors) {
      if (this.plugin.roleOfFolder(candidate) === "chapitre") return candidate;
    }
    return null;
  }

  /** Sources de contexte autorisées pour `file` — TOUJOURS cumulatives,
   * jamais l'une à la place de l'autre : dossier de recherche associé au
   * feuillet lui-même (priorité "feuillet" = 0), dossier associé à son
   * chapitre s'il existe (priorité "chapter" = 10), PUIS la recherche
   * générale du projet, sous-dossiers compris, TOUJOURS ajoutée si elle
   * existe (priorité "project-research" = 20) — un dossier lié ne retire
   * jamais la Recherche générale de la liste, il s'y ajoute. Aucun retour
   * anticipé : chaque source possible est évaluée indépendamment des
   * autres. Réutilise EXCLUSIVEMENT l'association Binder ↔ Recherche déjà
   * existante (plugin.getLinkedResearchFolder / researchFolderLinks, voir
   * main.ts) — aucun second système.
   *
   * Un même chemin obtenu par deux voies (ex. le dossier lié au feuillet
   * choisi identique à celui du chapitre) est dédupliqué en conservant la
   * priorité la plus forte (la plus précise) — buildContextIndex() fait
   * déjà ce choix par DOCUMENT, cette déduplication porte sur la liste des
   * SOURCES elle-même, avant même de la lui passer. */
  private contextSourcesFor(file: TFile): ContextSource[] {
    const candidates: Array<{ path: string; kind: keyof typeof CONTEXT_SOURCE_PRIORITY }> = [];

    const linkedToFile = this.plugin.getLinkedResearchFolder(file);
    if (linkedToFile) candidates.push({ path: linkedToFile.path, kind: "feuillet" });

    const chapterFolder = this.chapterFolderOf(file);
    if (chapterFolder) {
      const linkedToChapter = this.plugin.getLinkedResearchFolder(chapterFolder);
      if (linkedToChapter) candidates.push({ path: linkedToChapter.path, kind: "chapter" });
    }

    const researchRoot = this.plugin.getResearchRoot();
    if (researchRoot) candidates.push({ path: researchRoot.path, kind: "project-research" });

    const byPath = new Map<string, { path: string; kind: keyof typeof CONTEXT_SOURCE_PRIORITY }>();
    for (const candidate of candidates) {
      const existing = byPath.get(candidate.path);
      if (!existing || CONTEXT_SOURCE_PRIORITY[candidate.kind] < CONTEXT_SOURCE_PRIORITY[existing.kind]) {
        byPath.set(candidate.path, candidate);
      }
    }
    return Array.from(byPath.values());
  }

  /** Alias de frontmatter (`aliases`) d'un fichier, déjà disponibles dans le
   * cache de métadonnées d'Obsidian via this.fm() (BaseFeuilletsView.fm →
   * plugin.fmOf → metadataCache.getFileCache) — aucune lecture disque
   * supplémentaire. Entièrement facultatifs : absence de la clé (ou fiche
   * sans frontmatter) donne simplement une liste vide, jamais une erreur.
   * Accepte aussi bien une chaîne unique qu'une liste YAML, comme le reste
   * du frontmatter Obsidian. */
  private aliasesOf(file: TFile): string[] {
    const raw = this.fm(file)?.aliases;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map(String).filter(Boolean);
  }

  /** Documents Markdown des sources autorisées, récursivement — path,
   * basename, titre Feuillets existant (repli sur le basename), tags et
   * alias Obsidian, exactement les champs attendus par buildContextIndex().
   * La déduplication d'un même fichier atteint par plusieurs sources est
   * déléguée à buildContextIndex (priorité la plus précise = la plus
   * basse gagne), pas reproduite ici. */
  private collectContextDocuments(sources: ContextSource[]): ContextDocument[] {
    const documents: ContextDocument[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          walk(child);
        } else if (child instanceof TFile && child.extension === "md") {
          documents.push({
            path: child.path,
            basename: child.basename,
            title: this.plugin.titleFor(child),
            tags: this.plugin.tagsOf(child),
            aliases: this.aliasesOf(child),
          });
        }
      }
    };
    for (const source of sources) {
      const folder = this.app.vault.getAbstractFileByPath(source.path);
      if (folder instanceof TFolder) walk(folder);
    }
    return documents;
  }

  /** Éditeur Markdown actif correspondant EXACTEMENT à `file` — jamais un
   * éditeur ouvert sur un autre fichier, jamais en mode Lecture. Réutilise
   * getActiveViewOfType(MarkdownView), déjà le mécanisme employé ailleurs
   * dans le plugin (FeuilletsPlugin.activeEditorAnywhere,
   * PreviewView.activeMarkdownView) plutôt qu'un second système de
   * détection. `null` dans tous les cas de repli (pas d'éditeur, autre
   * fichier, mode Lecture, erreur) — à l'appelant de retomber sur le corps
   * complet du feuillet. */
  private activeSourceEditorFor(file: TFile): { editor: Editor; contentEl: HTMLElement } | null {
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return null;
      if (!(view.file instanceof TFile) || view.file.path !== file.path) return null;
      if (typeof view.getMode === "function" && view.getMode() !== "source") return null;
      if (!view.editor || !view.contentEl) return null;
      return { editor: view.editor, contentEl: view.contentEl };
    } catch {
      return null;
    }
  }

  /** Fenêtre de contexte (paragraphe précédent/courant/suivant) autour du
   * curseur RÉEL de l'éditeur actif de `file` — `null` dès qu'aucun éditeur
   * utilisable n'est trouvé (repli obligatoire sur le corps complet, voir
   * renderCitedEntities). Le texte ET l'offset viennent tous deux de
   * l'éditeur lui-même (editor.getValue()/getCursor()) : jamais mélangés
   * avec le contenu lu sur disque (vault.cachedRead), qui peut différer
   * d'une frappe non encore sauvegardée. */
  private cursorContextWindow(file: TFile): string | null {
    const source = this.activeSourceEditorFor(file);
    if (!source) return null;
    try {
      const text = source.editor.getValue();
      const offset = source.editor.posToOffset(source.editor.getCursor());
      return extractContextWindow(text, offset);
    } catch {
      return null;
    }
  }

  /** (Ré)accroche l'écoute clavier/souris sur l'éditeur Markdown actif du
   * feuillet affiché — seul moyen de détecter un déplacement du curseur
   * SANS frappe (clic, flèches) : l'API Obsidian n'expose aucun événement
   * dédié au déplacement du curseur (seulement "editor-change", sur le
   * CONTENU) ; "keyup"/"mouseup" sur le conteneur de l'éditeur couvrent à la
   * fois la frappe et le déplacement pur, avec la même conséquence
   * (planifier un rafraîchissement, voir scheduleContextWindowRefresh).
   * Idempotent, sur le même schéma que PreviewView.bindSourcePane :
   * rebrancher sur le même élément ne pose jamais un second écouteur, et le
   * précédent est toujours détaché avant d'en poser un nouveau. */
  private bindCursorTracking(file: TFile): void {
    if (this.closed) return;
    const source = this.activeSourceEditorFor(file);
    const nextEl = source?.contentEl || null;

    if (nextEl === this.cursorTrackedEl) return;

    this.cursorTrackedCleanup?.();
    this.cursorTrackedCleanup = null;
    this.cursorTrackedEl = nextEl;

    if (nextEl) {
      const handler = (): void => this.scheduleContextWindowRefresh(file);
      nextEl.addEventListener("keyup", handler);
      nextEl.addEventListener("mouseup", handler);
      this.cursorTrackedCleanup = () => {
        nextEl.removeEventListener("keyup", handler);
        nextEl.removeEventListener("mouseup", handler);
      };
    }
  }

  /** Débounce (~300 ms) avant de recalculer la section « Contexte » — et,
   * règle 5 du chantier, un rafraîchissement complet (render(), avec tout
   * ce qu'il recalcule) n'est déclenché que si la fenêtre de contexte a
   * RÉELLEMENT changé depuis la dernière fois : un simple déplacement du
   * curseur qui reste dans le même paragraphe ne provoque aucun rendu. */
  private scheduleContextWindowRefresh(file: TFile): void {
    if (this.closed || typeof window === "undefined") return;
    if (this.contextWindowTimer !== null) window.clearTimeout(this.contextWindowTimer);
    this.contextWindowTimer = window.setTimeout(() => {
      this.contextWindowTimer = null;
      if (this.closed) return;
      const nextText = this.cursorContextWindow(file);
      if (nextText !== null && nextText === this.lastCursorContextText) return;
      void this.render();
    }, CONTEXT_WINDOW_DEBOUNCE_MS);
  }

  /** Propriétés du fichier ouvert — reprise de l'ancien onglet Propriétés
   * (properties-view.js), placée en première section pour ne plus avoir à
   * basculer entre l'onglet Notes et l'onglet Propriétés en permanence.
   * Les deux icônes ("Propriétés du projet"/"Tags du projet") ouvrent en
   * fenêtre flottante ce qui restait de cet onglet (vue project-wide,
   * navigable jusqu'aux fichiers). */
  renderFilePropertiesSection(wrapper: HTMLElement, file: TFile): void {
    const section = wrapper.createDiv({ cls: "feuillets-notes-section" });
    const collapsed = this.renderSectionHead(
      section,
      "file-text",
      t("notes.properties.title"),
      "notes",
      "proprietes-fichier",
      (actions: HTMLElement) => {
        this.iconBtn(actions, "list-tree", t("notes.properties.projectPropertiesTooltip"), () =>
          new ProjectPropertiesModal(this.app, this.plugin).open()
        );
        this.iconBtn(actions, "tags", t("notes.properties.projectTagsTooltip"), () =>
          new ProjectTagsModal(this.app, this.plugin).open()
        );
        this.iconBtn(actions, "history", t("notes.properties.compareSnapshotTooltip"), () =>
          new DiffModal(this.app, this.plugin, file).open()
        );
      }
    );
    if (collapsed) return;

    const fm: NotesFrontmatter = this.fm(file);
    const isFront = this.plugin.isFrontMatter(file);
    if (isFront) this.renderFrontPageTypeRow(section, file, fm);

    const list = section.createDiv({ cls: "feuillets-properties-list" });
    for (const key of Object.keys(fm)) {
      if (isFront && key === "type") continue; // remplacé par le sélecteur dédié ci-dessus
      this.renderPropertyRow(list, file, key, fm[key]);
    }

    const addRow = section.createDiv({ cls: "feuillets-properties-add-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("notes.properties.newPropertyPlaceholder") },
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      void (async () => {
        const key = input.value.trim();
        if (!key) return;
        await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          if (!(key in data)) data[key] = "";
        });
        await this.render(true);
        const added = section.querySelector(
          `.feuillets-properties-row[data-key="${CSS.escape(key)}"] .feuillets-properties-value`
        ) as { focus?: () => void } | null;
        if (added && typeof added.focus === "function") added.focus();
      })();
    });
  }

  /** Sélecteur dédié pour le champ `type` d'une page du dossier Front
   * (titre/dédicace/épigraphe) — évite de faire dépendre la mise en page
   * spéciale à l'export d'une valeur tapée à la main dans l'éditeur de
   * propriétés générique (typo, majuscule, "titlepage" au lieu de "titre"…
   * silencieusement retombé en page normale). Voir FRONT_PAGE_TYPES et
   * isFrontMatter dans folder-structure.js, et la détection dans
   * compile-export.js. */
  renderFrontPageTypeRow(section: HTMLElement, file: TFile, fm: NotesFrontmatter): void {
    const row = section.createDiv({ cls: "feuillets-properties-row" });
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, "book-open-text");
    row.createSpan({ cls: "feuillets-properties-key" }).setText(t("notes.properties.frontPageTypeLabel"));

    const select = row.createEl("select", { cls: "feuillets-properties-value" });
    select.createEl("option", { text: t("notes.properties.frontPageTypeNormal"), value: "" });
    const LABELS: Record<string, string> = {
      titre: t("notes.properties.frontPageTypeTitle"),
      dedicace: t("notes.properties.frontPageTypeDedication"),
      epigraphe: t("notes.properties.frontPageTypeEpigraph"),
    };
    for (const t of FRONT_PAGE_TYPES) {
      select.createEl("option", { text: LABELS[t] || t, value: t });
    }
    const current = typeof fm.type === "string" ? fm.type.trim().toLowerCase() : "";
    select.value = FRONT_PAGE_TYPES.includes(current) ? current : "";
    select.addEventListener("change", () => {
      void (async () => {
        await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          if (select.value) data.type = select.value;
          else delete data.type;
        });
        await this.render(true);
      })();
    });
  }

  renderPropertyRow(list: HTMLElement, file: TFile, key: string, value: unknown): void {
    const type = inferPropertyType(value);
    const row = list.createDiv({ cls: "feuillets-properties-row" });
    row.setAttr("data-key", key);
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, TYPE_ICONS[type] || "text");
    row.createSpan({ cls: "feuillets-properties-key" }).setText(key);

    if (type === "checkbox" && typeof value === "boolean") {
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = value;
      cb.addEventListener("change", () => {
        void this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          data[key] = cb.checked;
        });
      });
    } else if (type === "list" && Array.isArray(value)) {
      this.renderListEditor(row, file, key, value);
    } else if ((type === "date" || type === "datetime") && typeof value === "string") {
      const input = row.createEl("input", {
        type: type === "date" ? "date" : "datetime-local",
        cls: "feuillets-properties-value",
      });
      input.value = value;
      input.addEventListener("change", () => {
        void this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          if (!input.value) delete data[key];
          else data[key] = input.value;
        });
      });
    } else {
      const input = row.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      input.value = value === undefined || value === null ? "" : toValue(value);
      const save = async () => {
        const raw = input.value;
        await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
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
      input.addEventListener("blur", () => { void save(); });
      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") input.blur();
      });
    }

    const delBtn = row.createSpan({ cls: "feuillets-properties-delete" });
    setIcon(delBtn, "x");
    delBtn.setAttr("aria-label", t("notes.properties.deleteAria", { key }));
    delBtn.addEventListener("click", () => {
      void (async () => {
        await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          delete data[key];
        });
        await this.render(true);
      })();
    });
  }

  /** Éditeur à jetons (façon liste de tags) pour une propriété liste —
   * même vocabulaire visuel que l'éditeur de tags natif du plugin. */
  renderListEditor(row: HTMLElement, file: TFile, key: string, values: unknown[]): void {
    const wrap = row.createDiv({ cls: "feuillets-tags feuillets-properties-list-editor" });
    values.forEach((v, idx) => {
      const chip = wrap.createSpan({ cls: "feuillets-tag-chip" });
      chip.setText(toValue(v));
      chip.setAttr("title", t("notes.properties.removeValueTooltip"));
      chip.addEventListener("click", () => {
        void (async () => {
          const next = values.filter((_, i) => i !== idx);
          await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
            if (next.length === 0) delete data[key];
            else data[key] = next;
          });
        })();
      });
    });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: values.length ? "+" : t("notes.properties.newValuePlaceholder") },
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      void (async () => {
        const raw = input.value.trim();
        if (!raw) return;
        const added = raw.split(",").map((s) => s.trim()).filter(Boolean);
        await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
          data[key] = [...values, ...added];
        });
        input.value = "";
        input.blur();
      })();
    });
  }

  /** Fil d'Ariane vers les notes de dossier (Partie/Chapitre) au-dessus du
   * feuillet actif — pastilles façon tag (fond + couleur d'accent) plutôt
   * que texte atténué : trop discret pour être remarqué dans certains
   * thèmes (confondu avec "n'apparaît pas" alors que le contenu était bien
   * là, juste illisible). */
  /** Fil d'Ariane vers les notes de dossier (Partie/Chapitre) au-dessus du
   * feuillet actif. Style forcé en ligne (pas via styles.css) et SANS
   * `overflow: hidden` sur le conteneur : c'est cette propriété qui
   * rendait tout le bloc invisible (coupé à zéro par un ancêtre flex plus
   * haut dans la mise en page) — un `overflow: hidden` semblait raisonnable
   * ici (éviter le retour à la ligne) mais coupait bien plus que prévu.
   * Confirmé par diagnostic direct (Notice + document.body.contains) avant
   * de conclure, pas par supposition. */
  renderFolderNoteLinks(container: HTMLElement, file: TFile): void {
    const root = this.plugin.getProjectFolder();
    if (!root) return;

    const chain: TFolder[] = [];
    let cur = file.parent;
    while (cur instanceof TFolder && cur.path.startsWith(root.path)) {
      const role = this.plugin.roleOfFolder(cur);
      if (role === "chapitre" || role === "partie") {
        chain.push(cur);
      }
      if (cur.path === root.path) break;
      cur = cur.parent;
    }
    if (chain.length === 0) return;
    chain.reverse(); // partie d'abord, puis chapitre

    const box = container.createDiv({ cls: "feuillets-notes-folder-links" });
    for (const folder of chain) {
      const link = box.createDiv({ cls: "feuillets-notes-folder-link" });
      link.setText(folder.name);
      link.setAttr("title", t("notes.folderNoteTooltip", { name: folder.name }));
      link.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        void (async () => {
          const note = await this.plugin.getOrCreateFolderNote(folder);
          if (note) {
            this.viewedFile = note;
            void this.render();
          }
        })();
      });
    }
  }

  async renderCitedEntities(container: HTMLElement, file: TFile, sceneDate: StoryDate | null, jalons: TFile[] = []): Promise<void> {
    const S = this.plugin.settings;
    const collapseKey = "notes:field:contexte";
    const collapsed = !!S.collapsed[collapseKey];

    // Rebranche l'écoute clavier/souris sur l'éditeur actif de CE feuillet
    // (ou la détache s'il n'y en a plus) à chaque rendu — voir
    // bindCursorTracking. Fait AVANT tout retour anticipé plus bas : le
    // suivi doit rester synchrone avec le feuillet réellement affiché même
    // quand la section ne produit finalement aucun résultat.
    this.bindCursorTracking(file);

    /* Sources autorisées — moteur de contexte indépendant (context-index.js
       / context-matcher.js), branché sur l'association Binder ↔ Recherche
       DÉJÀ existante (plugin.getLinkedResearchFolder), jamais sur un second
       système : feuillet actif → son chapitre → recherche générale du
       projet (sous-dossiers compris), voir contextSourcesFor(). */
    const sources = this.contextSourcesFor(file);
    if (sources.length === 0 && jalons.length === 0) return;

    const documents = this.collectContextDocuments(sources);
    const index = buildContextIndex(documents, sources);

    /* Fenêtre de contexte autour du curseur RÉEL de l'éditeur actif —
       repli OBLIGATOIRE sur le corps complet du feuillet (comme avant ce
       chantier) dès qu'aucun éditeur utilisable n'est trouvé : autre
       fichier affiché, mode Lecture, aucune vue Markdown, ou toute erreur
       (voir cursorContextWindow/activeSourceEditorFor). Le frontmatter est
       déjà exclu par extractContextWindow() dans le cas fenêtré ; il est
       retiré ici à la main dans le cas de repli, comme précédemment. */
    const cursorWindow = this.cursorContextWindow(file);
    const contextText = cursorWindow !== null
      ? cursorWindow
      : (await this.app.vault.cachedRead(file)).replace(/^---\n[\s\S]*?\n---\n?/, "");

    // Mémorisé pour scheduleContextWindowRefresh (règle 5 : pas de nouveau
    // rendu si la fenêtre de contexte n'a pas changé) — mis à jour à CHAQUE
    // rendu, quel que soit son déclencheur, pour rester une référence fiable.
    this.lastCursorContextText = contextText;

    // Le texte retenu (fenêtre autour du curseur, ou corps complet en
    // repli) est envoyé tel quel au moteur — buildContextIndex() puis
    // matchContext(), rien d'autre.
    const matches = matchContext(contextText, index);

    const citedSet = new Set<TFile>();
    for (const jalon of jalons) citedSet.add(jalon);
    for (const match of matches) {
      const found = this.app.vault.getAbstractFileByPath(match.candidate.path);
      if (found instanceof TFile) citedSet.add(found);
    }

    const entities = [...citedSet];
    if (entities.length === 0) return;

    /* Regroupées par nature (personnage/lieu/événement/codex) sans le
       préciser visuellement : inutile de l'expliciter, la nature de
       chaque fiche est déjà évidente au premier coup d'œil (nom, âge
       éventuel...). */
    const ORDER: Array<EntityKind | null> = ["personnage", "lieu", "evenement", "codex", null];
    entities.sort(
      (a, b) => ORDER.indexOf(this.entityKind(a)) - ORDER.indexOf(this.entityKind(b))
    );

    // Collapsible header matching the others
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const headSection = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = headSection.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, "book-open");

    const sectionTitle = sceneDate ? t("notes.context.titleWithDate", { date: sceneDate.display }) : t("notes.context.title");
    headSection.createSpan({ cls: "feuillets-notes-section-title" }).setText(sectionTitle);

    headSection.addEventListener("click", () => {
      void (async () => {
        if (collapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });

    if (collapsed) return;

    const box = section.createDiv({ cls: "feuillets-notes-entities-body" });
    box.setAttr("style", "margin-top: 6px;");

    for (const ent of entities) {
      const efm: NotesFrontmatter = this.fm(ent);
      const kind = this.entityKind(ent);

      const row = box.createDiv({ cls: "feuillets-entity-row" });
      const head = row.createDiv({ cls: "feuillets-entity-head" });
      const nameEl = head.createSpan({ cls: "feuillets-entity-name" });
      nameEl.setText(`• ${this.plugin.titleFor(ent)}`);
      nameEl.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), ent);
      });
      /* Bouton aperçu (popover natif au clic) juste à côté : consulter la
         fiche (âge, couleur des yeux…) sans remplacer la scène en cours
         dans l'éditeur — cliquer le nom, lui, navigue toujours (utile pour
         éditer la fiche elle-même), les deux usages coexistent. */
      this.addPreviewBtn(head, ent);

      if (kind === "personnage" && sceneDate) {
        const birth = this.plugin.parseStoryDate(efm.birth);
        const death = this.plugin.parseStoryDate(efm.death);
        if (death && sceneDate.sort > death.sort) {
          const diff = sceneDate.y - death.y;
          const text = diff > 0
            ? t("notes.context.deadSince", { count: String(diff), s: diff > 1 ? "s" : "", year: String(death.y) })
            : t("notes.context.deadIn", { year: String(death.y) });
          head
            .createSpan({ cls: "feuillets-entity-age" })
            .setText(text);
        } else if (birth) {
          const age = sceneDate.y - birth.y;
          if (age >= 0) {
            head
              .createSpan({ cls: "feuillets-entity-age" })
              .setText(t("notes.context.approxAge", { age: String(age) }));
          }
        }
      }

      const info = row.createDiv({ cls: "feuillets-entity-info" });
      let shown = false;
      if (sceneDate && kind !== "codex") {
        const content = await this.app.vault.cachedRead(ent);
        const state = latestStateBefore(content, sceneDate.y);
        if (state) {
          info.setText(state.text);
          info.setAttr("title", t("notes.context.stateAsOf", { year: String(state.y) }));
          if (state.y !== sceneDate.y) {
            info
              .createSpan({ cls: "feuillets-entity-since" })
              .setText(t("notes.context.since", { year: String(state.y) }));
          }
          shown = true;
        }
      }
      if (!shown && efm.synopsis) {
        info.setText(toValue(efm.synopsis).trim());
      } else if (!shown && !efm.synopsis) {
        info.remove();
      }
    }
  }

  /** Notes de bas de page (`[^label]: texte`) définies dans le corps du
   * feuillet — lecture seule (le contenu vit dans le corps du texte, pas
   * dans le frontmatter, contrairement aux autres rubriques de ce
   * panneau) : cliquer une entrée ouvre le feuillet à l'endroit de sa
   * définition plutôt que de proposer une édition qui serait trompeuse. */
  async renderFootnotesSection(container: HTMLElement, file: TFile): Promise<void> {
    const S = this.plugin.settings;
    const collapseKey = "notes:field:footnotes";
    const collapsed = !!S.collapsed[collapseKey];

    const raw = await this.app.vault.cachedRead(file);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    const footnotes: Footnote[] = [];
    const re = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      footnotes.push({ label: m[1], text: m[2].trim() });
    }
    if (footnotes.length === 0) return;

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, "list");

    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(t("shared.footnotes.title"));

    head.addEventListener("click", () => {
      void (async () => {
        if (collapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-notes-field-container" });
    for (const fn of footnotes) {
      const row = list.createDiv({ cls: "feuillets-flat-text-cell" });
      row.createSpan({ cls: "feuillets-entity-name" }).setText(`[^${fn.label}] `);
      row.createSpan().setText(fn.text);
      row.addClass("feuillets-clickable");
      row.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
    }
  }

  renderCollapsibleTextarea(container: HTMLElement, label: string, key: NotesSectionKey, file: TFile, fm: NotesFrontmatter, placeholder: string, rows: number): void {
    const S = this.plugin.settings;
    const collapseKey = `notes:field:${key}`;
    const collapsed = !!S.collapsed[collapseKey];

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, getNotesSectionIcon(key));

    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(label);

    head.addEventListener("click", () => {
      void (async () => {
        if (collapsed) delete S.collapsed[collapseKey];
        else S.collapsed[collapseKey] = true;
        await this.plugin.saveSettings();
        void this.render();
      })();
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-notes-field-container" });
    const currentVal = typeof fm[key] === "string" ? fm[key] : "";

    const textEl = list.createDiv({
      cls: "feuillets-flat-text-cell" + (currentVal ? "" : " is-empty"),
      text: currentVal || placeholder,
    });
    textEl.setAttr("style", "white-space: pre-wrap; min-height: 24px; cursor: pointer; padding: 4px 8px; border-radius: var(--radius-s);");

    textEl.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      textEl.hide();

      const ta = list.createEl("textarea", {
        cls: "feuillets-flat-textarea feuillets-autosize",
        attr: { placeholder, rows: String(rows) }
      });
      ta.value = currentVal;
      ta.focus();

      ta.style.removeProperty("height");
      ta.style.height = ta.scrollHeight + "px";

      const saveAndExit = async () => {
        if (ta.parentNode) {
          const newVal = ta.value.trim();
          if (newVal !== (fm[key] || "")) {
            await this.app.fileManager.processFrontMatter(file, (x: Record<string, unknown>) => {
              if (newVal) x[key] = newVal;
              else delete x[key];
            });
            textEl.setText(newVal || placeholder);
            if (newVal) textEl.removeClass("is-empty");
            else textEl.addClass("is-empty");
          }
          ta.remove();
          textEl.show();
        }
      };

      ta.addEventListener("blur", () => { void saveAndExit(); });
      ta.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
          ta.blur();
        }
      });
    });
  }
}
