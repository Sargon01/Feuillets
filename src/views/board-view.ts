import { Menu, Modal, Setting, TFile, TFolder, setIcon, setTooltip, Notice } from "obsidian";
import { VIEW_BOARD, getProjectStatuses, BOARD_MODES } from "../constants.js";
import { projectWordGoalDefault } from "../services/project-settings.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { openFileActivating } from "../utils/dom.js";
import { parseStoryDate, stripMarkdown } from "../utils/core.js";
import {
  PROJECT_MODES,
  resolveType,
  resolveBoardCardContent,
  resolveBoardOutlineColumns,
  semanticPlanningField,
} from "../utils/project-modes.js";
import { DEFAULT_SETTINGS } from "../default-settings.js";
import { povOf, filsOf } from "../utils/arc-fields.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { TagsModal } from "../ui/entity-modals.js";
import { listSnapshotFiles, type NewSheetOptions } from "../services/project-files.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";
import { buildBoardTimelineOptionsMenu, renderBoardTimeline } from "./board-timeline.js";
import { resolveBoardFolderScope } from "./board-scope.js";
import { renderBoardOutline, type OutlineRenderContext } from "./board-outline.js";

type ProjectNode = TFile | TFolder;
export type BoardModeKey = "board" | "outline" | "arcs" | "timeline";

/** Entrée d'une collecte GLOBALE de feuillets du Plan pour le tri : conserve
 * le contexte Binder RÉEL de chaque feuillet (jamais dérivé de la position
 * visuelle triée) — menu contextuel, multi-sélection et toute action
 * structurelle lisent ces valeurs, pas la liste plate. */
interface OutlineFileEntry {
  file: TFile;
  parentFolder: TFolder;
  binderIndex: number;
  siblings: ProjectNode[];
  binderFlatIndex: number;
}

/** Sous-vue de l'espace narratif (Chemin de fer) : Trame = le Chemin de fer
 * actuel, Couloirs = la vue narrative par lignes. État de SESSION de
 * l'instance BoardView, jamais persisté. */
export type NarrativeSubview = "trame" | "lanes";

/** Axe de regroupement des Couloirs : la « ligne » d'un couloir est un Label,
 * un Personnage ou un Fil (multi-valeurs), ou un Pov (scalaire). Ordre imposé
 * partout (barre commune, registre, drag) : Label, Personnage, Fil, Pov —
 * exactement l'ordre de la barre Trame. État de session uniquement. */
type LaneAxis = "label" | "character" | "thread" | "pov";

/* isSceneFile/openMergeModal/duplicateManyScenes/openMoveManyModal sont
   attachés dynamiquement au plugin par initScenesEditor (scenes-editor.ts),
   pas déclarés comme méthodes de classe dans main.js — absents du type
   inféré de FeuilletsPlugin, donc ajoutés ici comme dans ScenesEditorPlugin.
   _binderMultiSelect : idem, attaché par base-feuillets-view.js. */
type BoardViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  _binderMultiSelect?: Set<string>;
  moveStack?: unknown[];
  isSceneFile(file: TFile): boolean;
  openMergeModal(files: TFile[]): Promise<void>;
  duplicateManyScenes(files: TFile[]): Promise<void>;
  openMoveManyModal(files: TFile[]): void;
  newSheet(folder: TFolder, options?: NewSheetOptions): void;
};

function differsFromDefaults(value: Record<string, unknown> | undefined, defaults: Record<string, unknown>): boolean {
  if (!value) return false;
  return Object.keys({ ...defaults, ...value }).some((key) => {
    const current = value[key];
    const initial = defaults[key];
    if (Array.isArray(current) && Array.isArray(initial)) {
      return current.length !== initial.length || current.some((entry, index) => entry !== initial[index]);
    }
    return current !== initial;
  });
}

/* app.commands (exécution de commandes par id) est une API interne
   d'Obsidian, non déclarée dans obsidian.d.ts. */
type AppWithCommands = {
  commands: { executeCommandById(id: string): boolean };
};

/** @param el */
function isInputFocused(el: HTMLElement): boolean {
  const active = document.activeElement;
  return !!active && el.contains(active) && ["TEXTAREA", "INPUT"].includes(active.tagName);
}

function getFilsList(fm: Record<string, unknown>): string[] {
  const fils = fm.thread;
  if (Array.isArray(fils)) return fils.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof fils === "string" && fils.trim()) return fils.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

function getPersonnagesList(fm: Record<string, unknown>): string[] {
  const persos = fm.characters;
  if (Array.isArray(persos)) return persos.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof persos === "string" && persos.trim()) return persos.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

/* §9 LOT 5 — normalisation CSV commune aux listes Personnages/Fil du Chemin
   de fer : split sur virgule, trim, suppression des entrées vides et des
   doublons exacts (première occurrence conservée), ordre préservé — jamais de
   tri alphabétique. « Kemal, Arif, Kemal, , Sophie » → [« Kemal », « Arif »,
   « Sophie »]. */
export function parseCsvList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/* §12 LOT 5 — égalité de listes : mêmes longueur, éléments et ordre. La liste
   vide ne « vaut » que [] — une modification réelle (ajout/suppression/
   renommage) est détectée avant tout setFm/render. */
export function listsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function filColor(name: string): string {
  return `hsl(${hashLaneHue(name)}, 70%, 45%)`;
}

/** Teinte déterministe et stable par valeur (jamais persistée) : hachage
   simple du nom, partagé par toutes les couleurs de lignes Couloirs. La
   saturation et la limpidité varient ensuite par axe pour rester
   reconnaissables entre eux sans se confondre (§6). */
function hashLaneHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

/** Couleur de ligne Couloirs pour l'axe Pov : saturation et limpidité
   modérées pour rester discrète (§6). */
function povLaneColor(name: string): string {
  return `hsl(${hashLaneHue(name)}, 45%, 40%)`;
}

/** Couleur de ligne Couloirs pour l'axe Personnage : distincte de Pov
   (saturation plus affirmée) pour que les deux axes multi-caractères ne se
   confondent pas visuellement. */
function characterLaneColor(name: string): string {
  return `hsl(${hashLaneHue(name)}, 55%, 42%)`;
}

type ModeOptionsCtx = {
  S: FeuilletsSettings;
  meta: ProjectMeta;
  pType: string;
  wholeManuscript: boolean;
};

class TagFilterModal extends Modal {
  private value: string;
  private readonly onSubmit: (value: string) => Promise<void>;
  private submitting = false;

  constructor(app: import("obsidian").App, value: string, onSubmit: (value: string) => Promise<void>) {
    super(app);
    this.value = value;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.setTitle(t("board.filter.tagPrompt"));
    new Setting(this.contentEl).addText((text) => {
      text.setValue(this.value);
      text.onChange((value) => {
        this.value = value;
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t("modal.cancel")).onClick(() => this.close()))
      .addButton((button) => button.setButtonText(t("modal.save")).setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    await this.onSubmit(this.value.trim().replace(/^#/, ""));
    this.close();
  }
}

export class BoardView extends BaseFeuilletsView {
  declare plugin: BoardViewPlugin;
  declare iconBtn: (
    parent: HTMLElement,
    icon: string,
    tooltip?: string,
    onClick?: (e: MouseEvent) => unknown
  ) => HTMLElement;
  focusedFolderPath: string | null;
  currentCardContent?: string;
  /** Type de projet résolu au dernier render (Fiction/Non-fiction/Libre) —
     capté localement dans _render et mémorisé pour que les cartes Couloirs
     lisent la synopsis dans le BON champ sémantique (semanticPlanningField)
     même quand la préférence d'affichage des cartes est « Extrait ». */
  private lanesProjectType = "fiction";
  /** Sous-vue de l'espace narratif (Trame/Couloirs) — état de SESSION
   * de l'instance (jamais persisté), survit aux render(true) et aux
   * aller-retours Chemin de fer → autre mode → Chemin de fer. */
  narrativeSubview: NarrativeSubview = "trame";
  /** Axe de regroupement des Couloirs (Label/Personnage/Fil/Pov) — état de
   * session. Ordre imposé : Label, Personnage, Fil, Pov. */
  laneAxis: LaneAxis = "label";
  /** Registre des lignes par axe — état de session, initialisé paresseusement
   * par relecture des feuillets dans l'ordre narratif. Jamais retiré de
   * valeur ; une nouvelle valeur découverte est ajoutée à la fin. */
  private laneRegistry: Record<LaneAxis, string[]> = { label: [], character: [], thread: [], pov: [] };
  /** Migration locale défensive : si un boardMode "lanes" avait été persisté
   * par un lot précédent, on le normalise en "arcs" + sous-vue Couloirs une
   * seule fois pour cette instance (jamais réécrit sur le disque). */
  private _lanesMigrated = false;
  selectionModeActive?: boolean;
  wcMap?: Map<string, number>;
  selectedLabel?: string;
  selectedPerso?: string;
  selectedFil?: string;
  selectedPov?: string;
  _renderGen?: number;
  outlineColumns?: Record<string, boolean>;
  /* Tri visuel du Plan — état STRICTEMENT session-only de l'instance (jamais
     de settings, de projectMeta, de YAML). null/null = ordre Binder réel.
     Une seule colonne triée à la fois : cliquer une autre colonne abandonne
     la précédente. Le cycle d'une colonne : asc → desc → ordre Binder. */
  outlineSortColumn: string | null = null;
  outlineSortDirection: "asc" | "desc" | null = null;
  /** Viewport de session du Plan : `key` identifie le périmètre réellement
   * affiché et `top` mémorise son scroll vertical. Il est restauré à chaque
   * rendu du même scope, notamment après les rerenders multiples/différés du
   * drag/drop ; un changement de scope remet `top` à zéro. */
  private _outlineViewport: { key: string; top: number } = { key: "", top: 0 };
  /** Délai de détection simple/double-clic du titre du Plan : un clic ouvre
   * le feuillet après ce délai, un double-clic l'annule pour passer au
   * renommage inline. Variable d'instance pour que les tests puissent la
   * raccourcir (comportement réel inchangé). */
  outlineDblClickDelayMs = 250;

  /* LOT 5C — état de session du drag Couloirs : chemin du feuillet glissé,
     drapeau anti-ouverture (§12 : un drag ne déclenche jamais le clic
     d'ouverture du titre) et valeur source de la ligne ("" pour « Sans… »),
     nécessaire pour retirer UNIQUEMENT la valeur source d'un label/fil
     multi-valeurs au drop. Aucun lien avec plugin.dragState (réordonnancement
     Binder/manuscrit) — le drag Couloirs ne modifie QUE le champ d'axe. */
  private _lanesDragPath: string | null = null;
  private _lanesDragging = false;
  private _lanesDragSource: string | null = null;

  /** §6 : viewport de session Couloirs — scrollLeft/scrollTop mémorisés à la
   * volée (listeners scroll + capture au drop) et restaurés à CHAQUE
   * renderCouloirs sur le nouveau DOM. État de l'INSTANCE uniquement : jamais
   * dans settings, jamais dans ProjectMeta, jamais dans le YAML, jamais
   * saveSettings. `key` identifie le périmètre affiché (root/scope/whole) :
   * si le périmètre change, left/top repartent de 0. */
  private _lanesViewport: { key: string; left: number; top: number } = { key: "", left: 0, top: 0 };

  constructor(leaf: import("obsidian").WorkspaceLeaf, plugin: BoardViewPlugin) {
    super(leaf, plugin);
    this.focusedFolderPath = null;
  }

  getViewType(): string {
    return VIEW_BOARD;
  }

  getDisplayText(): string {
    return t("board.displayText");
  }

  /** Libellé affiché d'un mode du panneau Cartes (BOARD_MODES ne fournit
   * qu'une clé + un repli français) — traduit via i18n, jamais le repli
   * brut de constants.js. */
  boardModeLabel(k: string): string {
    return t(`board.mode.${k}`);
  }

  /** Traduit à l'affichage les valeurs sentinelles internes des filtres
   * (stockées en français dans les réglages, comme pour le Binder — voir
   * filterSentinelLabel dans feuillets-view.js) ; un statut/label/POV réel
   * choisi par l'utilisateur passe inchangé. */
  filterSentinelLabel(v: string): string {
    return v === "Tous" ? t("binder.filter.all")
      : v === "Sans statut" ? t("binder.filter.noStatus")
      : v === "Sans label" ? t("binder.filter.noLabel")
      : v === "Sans POV" ? t("board.filter.noPov")
      : v === "Atteint" ? t("binder.filter.progressHit")
      : v === "En dessous" ? t("binder.filter.progressUnder")
      : v === "Dépassé" ? t("binder.filter.progressOver")
      : v;
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateActiveHighlight()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveHighlight()));
    await this.render();
  }

  updateActiveHighlight(): void {
    const active = this.app.workspace.getActiveFile();
    this.highlightActivePath(active ? active.path : null);
  }

  highlightActivePath(path: string | null): void {
    if (!this.contentEl) return;
    this.contentEl.querySelectorAll(".is-active, .feuillets-dragover, .feuillets-dragging").forEach((r) => {
      r.removeClass("is-active");
      r.removeClass("feuillets-dragover");
      r.removeClass("feuillets-dragging");
    });
    if (path) {
      this.contentEl.querySelectorAll(`[data-path="${CSS.escape(path)}"]`).forEach((r) => r.addClass("is-active"));
    }
  }

  async render(force = false): Promise<void> {
    return this._render(force);
  }

  /** Changement de mode PUBLIC du Board : persiste la préférence (méta du
   *  projet si méta projet, sinon global) et re-rend la vue. Tous les chemins
   *  qui changent de mode — boutons internes du Board, clic droit de la carte
   *  Binder, ouverture en arrière-plan (openBoardModeInBackground) — passent
   *  par CETTE méthode : le mode imposé n'a jamais besoin d'un override de
   *  session. */
  setBoardMode(mode: BoardModeKey): void {
    const S = this.plugin.settings;
    const root = this.getProjectFolder ? this.getProjectFolder() : null;
    let meta: ProjectMeta | null = null;
    if (root) {
      if (!S.projectMeta) S.projectMeta = {};
      if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
      meta = S.projectMeta[root.path];
    }
    if (meta) meta.boardMode = mode;
    S.boardMode = mode;
    void this.plugin.saveSettings();
    void this.render(true);
  }

  passesFilter(file: TFile): boolean {
    const S = this.plugin.settings;
    const statusFilter = S.statusFilter;
    if (statusFilter && statusFilter !== "Tous") {
      const currentStatus = String((this.fm(file).status as string | number | boolean | null | undefined) || "");
      if (statusFilter === "Sans statut" ? currentStatus !== "" : currentStatus !== statusFilter) return false;
    }
    const labelFilter = S.labelFilter;
    if (labelFilter && labelFilter !== "Tous") {
      const labels = this.plugin.labelsOf(file);
      if (labelFilter === "Sans label" ? labels.length !== 0 : !labels.includes(labelFilter)) return false;
    }
    const povFilter = S.povFilter;
    if (povFilter && povFilter !== "Tous") {
      const currentPov = povOf(this.fm(file));
      if (povFilter === "Sans POV" ? currentPov !== "" : currentPov !== povFilter) return false;
    }
    const tagTerm = (S.tagFilter || "").trim().toLowerCase().replace(/^#/, "");
    if (tagTerm && !this.plugin.tagsOf(file).map((l: string) => l.toLowerCase()).some((l: string) => l.includes(tagTerm))) return false;
    const progressFilter = S.progressFilter;
    if (progressFilter && progressFilter !== "Tous" && this.wcMap) {
      const wc = this.wcMap.get(file.path);
      const goal = this.goalFor(file);
      if (wc !== undefined && goal > 0) {
        const state = this.ringState(wc, goal);
        if (progressFilter === "Atteint" && state !== "hit") return false;
        if (progressFilter === "En dessous" && state !== "under") return false;
        if (progressFilter === "Dépassé" && state !== "over") return false;
      } else if (goal <= 0) return false;
    }
    return true;
  }

  filterActive(): boolean {
    const S = this.plugin.settings;
    return !!(
      (S.statusFilter && S.statusFilter !== "Tous") ||
      (S.labelFilter && S.labelFilter !== "Tous") ||
      (S.progressFilter && S.progressFilter !== "Tous") ||
      (S.povFilter && S.povFilter !== "Tous") ||
      (S.tagFilter || "").trim() !== ""
    );
  }

  gridStyle(el: HTMLElement): void {
    /* §16 : la taille des Cartes est désormais pilotée uniquement par
       S.tileSize (Petite/Moyenne/Grande) — l'ancienne propriété S.columns
       reste stockée pour compatibilité mais n'influence plus jamais ce
       calcul. */
    const S = this.plugin.settings;
    el.style.gridTemplateColumns = `repeat(auto-fill, minmax(${S.tileSize}px, 1fr))`;
  }

  async _render(force = false): Promise<void> {
    const container = this.contentEl;
    if (!force && isInputFocused(container)) return;
    const gen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-board-container");

    const S = this.plugin.settings;
    container.style.fontSize = `${S.fontSize}px`;
    container.style.zoom = `${S.uiScale}%`;

    const manuscriptRoot = this.getProjectFolder();
    if (!manuscriptRoot) {
      container.createDiv({ cls: "feuillets-empty", text: t("board.noProjectFolder") });
      return;
    }

    let focusedFolder: TFolder | null = null;
    if (this.focusedFolderPath) {
      const folder = this.app.vault.getAbstractFileByPath(this.focusedFolderPath);
      if (folder instanceof TFolder) focusedFolder = folder;
    }
    const scope = resolveBoardFolderScope(manuscriptRoot, focusedFolder);
    if (this.focusedFolderPath && !scope.hasFocusedFolder) this.focusedFolderPath = null;

    if (!S.projectMeta) S.projectMeta = {};
    if (!S.projectMeta[scope.manuscriptRoot.path]) S.projectMeta[scope.manuscriptRoot.path] = {};
    const meta = S.projectMeta[scope.manuscriptRoot.path];
    const projectType = resolveType(meta.type);
    this.lanesProjectType = projectType;
    const modeConfig = PROJECT_MODES[projectType] || PROJECT_MODES.fiction;
    let mode: string = meta.boardMode || modeConfig.defaults.boardMode;
    this.currentCardContent = resolveBoardCardContent(projectType, meta.cardContent);

    /* LOT 5C §2.1 — migration locale défensive : un ancien boardMode "lanes"
       persisté par un lot précédent n'existe plus comme mode (§2 impose 4
       modes exactement). On le normalise ici, localement pour cette instance :
       mode → "arcs", sous-vue → Couloirs. RIEN n'est réécrit sur le disque
       (ni settings ni ProjectMeta) — la lecture suivante retombera pareil. */
    if (mode === "lanes") {
      mode = "arcs";
      this.narrativeSubview = "lanes";
      this._lanesMigrated = true;
    }

    let initializedProjectPrefs = false;
    const hiddenModes: string[] = Array.isArray(meta.hiddenBoardModes)
      ? meta.hiddenBoardModes
      : Array.isArray(S.hiddenBoardModes) && differsFromDefaults(
        { hiddenBoardModes: S.hiddenBoardModes },
        { hiddenBoardModes: DEFAULT_SETTINGS.hiddenBoardModes }
      )
        ? [...S.hiddenBoardModes]
        : [...modeConfig.boardDefaults.hiddenBoardModes];
    if (!Array.isArray(meta.hiddenBoardModes)) {
      meta.hiddenBoardModes = hiddenModes;
      initializedProjectPrefs = true;
    }
    const outlineColumns: Record<string, boolean> = meta.outlineCols
      ? { ...meta.outlineCols }
      : differsFromDefaults(S.outlineCols, DEFAULT_SETTINGS.outlineCols)
        ? { ...S.outlineCols }
        : { ...modeConfig.boardDefaults.outlineCols };
    if (!meta.outlineCols) {
      meta.outlineCols = outlineColumns;
      initializedProjectPrefs = true;
    }
    /* §6/§9 : resolveBoardOutlineColumns calcule seulement l'AFFICHAGE
       effectif (grammaire finale du Plan) à partir de la priorité
       meta/legacy/defaults ci-dessus — meta.outlineCols garde la donnée
       brute non migrée. */
    this.outlineColumns = resolveBoardOutlineColumns(projectType, outlineColumns);
    if (initializedProjectPrefs && typeof this.plugin.saveSettings === "function") void this.plugin.saveSettings();
    const wholeManuscript = meta.boardWholeManuscript !== undefined ? !!meta.boardWholeManuscript : !!S.boardWholeManuscript;
    const displayedFolder = wholeManuscript ? scope.manuscriptRoot : scope.currentFolder;
    if (mode === "research") mode = "board";

    /* LOT 5C §2 — l'architecture impose EXACTEMENT 4 modes (board, outline,
       arcs, timeline) : Couloirs n'est PAS un mode mais une sous-vue de
       l'espace narratif (arcs). `visibleModes` dérive donc directement de
       BOARD_MODES et de hiddenBoardModes, sans aucun filtrage par type. */
    const allBoardModes = BOARD_MODES.map(([k]) => k);
    let visibleModes = allBoardModes.filter((k) => !hiddenModes.includes(k));
    if (visibleModes.length === 0) visibleModes = allBoardModes;
    if (!visibleModes.includes(mode)) {
      mode = visibleModes[0];
    }
    const activeMode = mode as BoardModeKey;
    const trameDisplayFolder = wholeManuscript ? scope.manuscriptRoot : scope.currentFolder;
    if (activeMode !== "outline") {
      this._outlineViewport.key = "";
      this._outlineViewport.top = 0;
    } else {
      const outlineScopeKey = [
        scope.manuscriptRoot.path,
        displayedFolder.path,
        wholeManuscript ? "whole" : "focused",
      ].join("::");
      if (this._outlineViewport.key !== outlineScopeKey) {
        this._outlineViewport.key = outlineScopeKey;
        this._outlineViewport.top = 0;
      }
    }

    /* Même Set que le Binder/Plan (this.plugin._binderMultiSelect) — un
       seul mécanisme de sélection multiple dans tout le plugin, pas deux
       en parallèle. Le mode sélection du panneau Cartes (cases à cocher,
       selectionModeActive) reste sa propre affordance UI ; seul le
       stockage est désormais partagé. */
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    if (this.selectionModeActive === undefined) this.selectionModeActive = false;

    const bar = container.createDiv({ cls: "feuillets-board-bar" }).createDiv({ cls: "feuillets-board-bar-right" });
    this.iconBtn(bar, this.filterActive() ? "filter" : "list-filter", t("board.filter.tooltip"), (e: MouseEvent) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("binder.filter.statusHeader")).setDisabled(true));
      for (const st of ["Tous", ...getProjectStatuses(this.app, S).filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(st)).setChecked((S.statusFilter || "Tous") === st).onClick(async () => {
            S.statusFilter = st;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      const labels = new Set<string>();
      const projectRoot = this.plugin.getProjectFolder();
      if (projectRoot) {
        const collect = (f: TFolder) => {
          for (const c of this.plugin.getOrderedChildren(f)) {
            if (c instanceof TFile) {
              for (const label of this.plugin.labelsOf(c)) labels.add(label);
            } else if (c instanceof TFolder) collect(c);
          }
        };
        collect(projectRoot);
      }
      const pMeta = projectRoot ? S.projectMeta[projectRoot.path] : null;
      (pMeta && pMeta.labels ? pMeta.labels : S.labels || []).forEach((l) => { if (l.name) labels.add(l.name); });
      const sortedLabels = Array.from(labels).sort((a, b) => a.localeCompare(b, "fr"));
      menu.addItem((item) => item.setTitle(t("binder.filter.labelHeader")).setDisabled(true));
      for (const lb of ["Tous", ...sortedLabels, "Sans label"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(lb)).setChecked((S.labelFilter || "Tous") === lb).onClick(async () => {
            S.labelFilter = lb;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      const povs = new Set<string>();
      if (projectRoot) {
        const collectPov = (f: TFolder) => {
          for (const c of this.plugin.getOrderedChildren(f)) {
            if (c instanceof TFile) {
              const p = povOf(this.fm(c));
              if (p) povs.add(p);
            } else if (c instanceof TFolder) collectPov(c);
          }
        };
        collectPov(projectRoot);
      }
      const sortedPovs = Array.from(povs).sort((a, b) => a.localeCompare(b, "fr"));
      if (sortedPovs.length > 0) {
        menu.addItem((item) => item.setTitle(t("board.filter.povHeader")).setDisabled(true));
        for (const pv of ["Tous", ...sortedPovs, "Sans POV"]) {
          menu.addItem((item) =>
            item.setTitle(this.filterSentinelLabel(pv)).setChecked((S.povFilter || "Tous") === pv).onClick(async () => {
              S.povFilter = pv;
              await this.plugin.saveSettings();
              void this.render();
            })
          );
        }
        menu.addSeparator();
      }
      menu.addItem((item) => item.setTitle(t("binder.filter.progressHeader")).setDisabled(true));
      for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(pr)).setChecked((S.progressFilter || "Tous") === pr).onClick(async () => {
            S.progressFilter = pr;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.filter.tagPrompt")).setIcon("tag").onClick(() => {
          new TagFilterModal(this.app, (S.tagFilter || "").replace(/^#/, ""), async (value) => {
            S.tagFilter = value;
            await this.plugin.saveSettings();
            void this.render();
          }).open();
        })
      );
      if (this.filterActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item.setTitle(t("binder.filter.reset")).setIcon("filter-x").onClick(async () => {
            S.statusFilter = "Tous";
            S.labelFilter = "Tous";
            S.progressFilter = "Tous";
            S.povFilter = "Tous";
            S.tagFilter = "";
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.showAtMouseEvent(e);
    });

    this.barSep(bar);

    const switchMode = (m: string) => async () => {
      this.setBoardMode(m as BoardModeKey);
    };

    const modeGroup = bar.createDiv({ cls: "feuillets-mode-group" });
    const icons: Record<string, string> = { board: "layout-grid", outline: "list-tree", arcs: "git-branch", timeline: "milestone", read: "book-open-text" };
    for (const [k] of BOARD_MODES) {
      if (!visibleModes.includes(k)) continue;
      const btn = this.iconBtn(modeGroup, icons[k], this.boardModeLabel(k), switchMode(k));
      if (activeMode === k) btn.addClass("feuillets-mode-active");
    }

    this.iconBtn(modeGroup, "sliders-horizontal", t("board.viewOptionsTooltip"), (e: MouseEvent) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("board.visibleModesHeader")).setDisabled(true));
      /* §2 — le menu « Modes affichés » propose les 4 modes du réglage
         global (toujours proposés, même si l'utilisateur a déjà masqué les
         autres) — Couloirs n'est PAS un mode et n'y figure jamais. */
      for (const k of allBoardModes) {
        menu.addItem((item) =>
          item.setTitle(this.boardModeLabel(k)).setChecked(visibleModes.includes(k)).onClick(async () => {
            const set = new Set(hiddenModes);
            if (!set.has(k) && visibleModes.length === 1) return;
            if (set.has(k)) set.delete(k); else set.add(k);
            const arr = [...set];
            if (meta) meta.hiddenBoardModes = arr;
            S.hiddenBoardModes = arr;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.selection.enable")).setIcon("list-checks").setChecked(!!this.selectionModeActive).onClick(() => {
          this.selectionModeActive = !this.selectionModeActive;
          if (!this.selectionModeActive) this.plugin._binderMultiSelect?.clear();
          void this.render(true);
        })
      );
      menu.addSeparator();
      this.buildModeOptionsMenu(menu, activeMode, { S, meta, pType: projectType, wholeManuscript, outlineColumns });
      menu.showAtMouseEvent(e);
    });

    /* Bouton « + » global (création) — Cartes et Plan UNIQUEMENT, jamais en
       Chemin de fer/Couloirs/Chronologie. La cible est
       TOUJOURS une racine structurelle réelle : racine du manuscrit pour Plan
       et pour Cartes en mode « Tout le manuscrit », dossier courant réellement
       affiché pour Cartes en navigation normale. La création passe
       exclusivement par le moteur du Binder (plugin.newSheet / plugin.newFolder)
       — aucun vault.create ici, aucun sélecteur de destination supplémentaire
       (créer plus profondément = menu contextuel du dossier). */
    if (activeMode === "board" || activeMode === "outline") {
      this.barSep(bar);
      this.iconBtn(bar, "plus", t("shared.contextMenu.newMenu"), (e: MouseEvent) => {
        const target = displayedFolder;
        const menu = new Menu();
        menu.addItem((item) =>
          item.setTitle(t("binder.newSheetHere")).setIcon("file-plus").onClick(() => {
            this.plugin.newSheet(target, activeMode === "outline" ? { openCreatedFile: false } : undefined);
          })
        );
        menu.addItem((item) =>
          item.setTitle(t("binder.newFolder")).setIcon("folder-plus").onClick(() => this.plugin.newFolder(target))
        );
        menu.showAtMouseEvent(e);
      });
    }
    this.barSep(bar);

    if (this.selectionModeActive && activeMode !== "arcs") {
      const multiSelect = this.plugin._binderMultiSelect;
      const selSize = multiSelect.size;
      const getSelectedFiles = (): TFile[] =>
        [...multiSelect].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
      const clearSel = () => {
        multiSelect.clear();
        this.selectionModeActive = false;
        void this.render(true);
      };
      const unitLabel = this.plugin.unitLabel();
      const unitPlural = this.plugin.unitLabelPlural();
      const btnSel = this.iconBtn(
        bar,
        "list-checks",
        this.selectionModeActive
          ? t("board.selection.actionsTooltip", { unit: unitLabel, count: String(selSize), s: selSize > 1 ? "s" : "" })
          : t("board.selection.selectTooltip", { unitPlural }),
        (e: MouseEvent) => {
          const menu = new Menu();
          if (!this.selectionModeActive) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.selectTooltip", { unitPlural })).setIcon("list-checks").onClick(() => {
                this.selectionModeActive = true;
                void this.render(true);
              })
            );
            menu.showAtMouseEvent(e);
            return;
          }
          menu.addItem((item) =>
            item.setTitle(t("board.selection.merge", { count: String(selSize) })).setIcon("git-merge").setDisabled(selSize < 2).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length < 2) {
                new Notice(t("board.selection.mergeNeedsTwo", { unitPlural }));
                return;
              }
              void this.plugin.openMergeModal(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("board.selection.duplicate", { count: String(selSize) })).setIcon("copy").setDisabled(selSize < 1).onClick(async () => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) await this.plugin.duplicateManyScenes(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("board.selection.move", { count: String(selSize) })).setIcon("move").setDisabled(selSize < 1).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) this.plugin.openMoveManyModal(files);
            })
          );
          menu.addSeparator();

          for (const st of getProjectStatuses(this.app, this.plugin.settings).filter(Boolean)) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.statusCount", { status: st, count: String(selSize) })).setDisabled(selSize < 1).onClick(async () => {
                const files = getSelectedFiles();
                clearSel();
                await this.applyBulkStatus(files, st);
              })
            );
          }
          menu.addSeparator();

          for (const l of this.getProjectLabels()) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.labelCount", { label: l.name, count: String(selSize) })).setDisabled(selSize < 1).onClick(async () => {
                const files = getSelectedFiles();
                clearSel();
                await this.applyBulkLabel(files, l.name);
              })
            );
          }
          menu.addSeparator();

          menu.addItem((item) =>
            item.setTitle(t("board.selection.addTag", { count: String(selSize) })).setIcon("tag").setDisabled(selSize < 1).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              this.promptBulkTag(files, () => { void this.render(true); });
            })
          );
          menu.addSeparator();
          menu.addItem((item) => item.setTitle(t("board.selection.exit")).setIcon("x").onClick(clearSel));
          menu.showAtMouseEvent(e);
        }
      );
      if (this.selectionModeActive) btnSel.addClass("feuillets-mode-active");
    }

    if ((this.plugin.moveStack?.length || 0) > 0) {
      this.iconBtn(bar, "undo-2", t("board.undoMoveTooltip"), () => (this.app as unknown as AppWithCommands).commands.executeCommandById("feuillets:undo-move"));
    }

    /* §4 — barre de PILOTAGE narrative (arcs), distincte du contenu manuscrit
       et CENTRÉE horizontalement : un SEUL sélecteur compact de sous-vue
       (icône + libellé de la sous-vue COURANTE + chevron) qui ouvre un Menu
       Obsidian natif listant Trame / Couloirs ; l'entrée courante y est
       cochée via le Menu natif (setChecked). Plus AUCUN sélecteur d'axe ici :
       la barre d'axe des Couloirs (même grammaire que la barre de filtres
       Trame) vit dans le contenu de la sous-vue, via renderLanesAxisBar.
       Sous-vue et axe restent des états de SESSION (ce.narrativeSubview /
       ce.laneAxis), jamais persistés. */
    if (activeMode === "arcs") {
      const nav = container.createDiv({ cls: "feuillets-narrative-bar" });

      const subviewIcon: Record<NarrativeSubview, string> = { trame: "waypoint", lanes: "rows-3" };
      const subviewLabel: Record<NarrativeSubview, string> = {
        trame: t("board.narrative.trame"),
        lanes: t("board.narrative.lanes"),
      };
      const switchSubview = (key: NarrativeSubview) => {
        if (this.narrativeSubview === key) return;
        this.narrativeSubview = key;
        void this.render(true);
      };

      const selector = nav.createEl("button", {
        cls: "clickable-icon feuillets-narrative-subview-btn",
        attr: { "aria-label": subviewLabel[this.narrativeSubview] },
      });
      setIcon(selector.createSpan({ cls: "feuillets-narrative-btn-icon" }), subviewIcon[this.narrativeSubview]);
      selector.createSpan({ cls: "feuillets-narrative-btn-label", text: subviewLabel[this.narrativeSubview] });
      setIcon(selector.createSpan({ cls: "feuillets-narrative-btn-chevron" }), "chevron-down");
      setTooltip(selector, t("board.narrative.pickSubview"));
      selector.addEventListener("click", (e) => {
        const menu = new Menu();
        menu.addItem((item) =>
          item.setTitle(subviewLabel.trame).setIcon("waypoint").setChecked(this.narrativeSubview === "trame").onClick(() => switchSubview("trame"))
        );
        menu.addItem((item) =>
          item.setTitle(subviewLabel.lanes).setIcon("rows-3").setChecked(this.narrativeSubview === "lanes").onClick(() => switchSubview("lanes"))
        );
        menu.showAtMouseEvent(e);
      });
    }

    const flattened = this.plugin.flattenFiles(scope.manuscriptRoot);
    const wcMapRaw = await this.plugin.getWordCounts(flattened);
    if (this._renderGen !== gen) return;

    this.wcMap = new Map();
    for (const file of flattened) {
      this.wcMap.set(file.path, wcMapRaw.get(file.path)?.wc || 0);
    }

    const bumpTotal = (_n?: number) => {};
    void this.plugin.wordCountOfFolder(scope.manuscriptRoot).then((wc: number) => {
      void this.plugin.updateDailyStats(wc);
    });

    if (this.filterActive()) {
      container.createDiv({ cls: "feuillets-filter-note", text: t("board.filterActiveNote") });
    }

    const numbering = this.plugin.buildNumbering(scope.manuscriptRoot);

    /* LOT 5C (micro-correctif structure) : Couloirs monte sa PROPRE
       architecture à deux niveaux — la barre d'axe vit HORS de la zone
       défilante, au même niveau que le sélecteur de sous-vue, et
       renderCouloirs construit elle-même son scroll (gutter fixe + canevas
       horizontal unique). On retourne ici : aucun scrollArea partagé pour
       cette sous-vue, pour que la barre Label·Personnage·Fil·Pov·+ ne parte
       JAMAIS avec le canevas horizontal (§2/§5/§17). */
    if (activeMode === "arcs" && this.narrativeSubview === "lanes") {
      this.renderCouloirs(container, scope.manuscriptRoot, scope.currentFolder, wholeManuscript, numbering);
      return;
    }

    const scrollArea = container.createDiv({ cls: "feuillets-board-scroll" });
    if (activeMode === "outline") {
      scrollArea.addEventListener("scroll", () => {
        this._outlineViewport.top = scrollArea.scrollTop;
      });
    }

    if (activeMode === "board" && wholeManuscript) {
      this.renderBoardWholeManuscript(scrollArea, scope.manuscriptRoot, numbering, bumpTotal);
    } else if (activeMode === "board") {
      this.renderBreadcrumbs(scrollArea, scope.manuscriptRoot, scope.currentFolder);
      this.renderBoard(scrollArea, scope.manuscriptRoot, scope.currentFolder, numbering, bumpTotal);
    } else if (activeMode === "outline") {
      if (activeMode === "outline" && !wholeManuscript) this.renderBreadcrumbs(scrollArea, scope.manuscriptRoot, scope.currentFolder);
      await this.renderOutline(scrollArea, displayedFolder, numbering, bumpTotal, gen);
      scrollArea.scrollTop = this._outlineViewport.top;
    } else if (activeMode === "arcs") {
      /* §2/§4 : l'espace narratif (arcs) se subdivise en deux sous-vues —
         Trame (le Chemin de fer classique, gelé) et Couloirs (Scrivener).
         Couloirs n'arrive JAMAIS ici : la branche anticipée plus haut
         (renderCouloirs hors du scrollArea partagé) retourne avant ce point. */
      if (this.narrativeSubview === "trame" && !wholeManuscript) {
        this.renderBreadcrumbs(scrollArea, scope.manuscriptRoot, scope.currentFolder);
      }
      this.renderCheminDeFer(scrollArea, trameDisplayFolder, numbering);
    } else if (activeMode === "timeline") {
      for (const file of this.plugin.flattenFiles(scope.manuscriptRoot)) {
        if (this.passesFilter(file)) bumpTotal(this.wcMap.get(file.path) || 0);
      }
      this.renderTimeline(scrollArea, scope.manuscriptRoot, numbering);
    }
  }

  buildModeOptionsMenu(menu: Menu, activeMode: BoardModeKey, ctx: ModeOptionsCtx & { outlineColumns: Record<string, boolean> }): void {
    const { S, meta, pType, wholeManuscript, outlineColumns } = ctx;

    const addScopeOptions = (): void => {
      for (const [val, label] of [[false, t("board.options.folderByFolder")], [true, t("board.options.wholeManuscript")]] as [boolean, string][]) {
        menu.addItem((item) => item.setTitle(label).setChecked(wholeManuscript === val).onClick(async () => {
          if (meta) meta.boardWholeManuscript = val;
          S.boardWholeManuscript = val;
          await this.plugin.saveSettings();
          void this.render(true);
        }));
      }
    };

    if (activeMode === "outline" || activeMode === "arcs") addScopeOptions();

    if (activeMode === "board") {
      menu.addItem((item) => item.setTitle(t("board.options.cardsHeader")).setDisabled(true));
      addScopeOptions();
      menu.addSeparator();
      /* Grammaire finale des Cartes (§10) : plus aucun toggle Progression ni
         Tags — ces informations restent disponibles ailleurs (filtres,
         Plan). Seules 3 options d'affichage subsistent : Portée, Contenu,
         Taille. */
      const semanticField = semanticPlanningField(pType);
      // Le libellé "Résumé long" réutilise EXACTEMENT la traduction déjà
      // établie pour ce même champ sémantique dans l'aperçu du Binder
      // (binder.preview.summary) — une seule source de vocabulaire.
      const contentOptions: [string, string][] =
        semanticField === "synopsis"
          ? [[semanticField, t("board.options.bodySynopsis")], ["extrait", t("board.options.bodyContent")]]
          : [[semanticField, t("binder.preview.summary")], ["extrait", t("board.options.bodyContent")]];
      for (const [val, label] of contentOptions) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(this.currentCardContent === val).onClick(async () => {
            if (meta) meta.cardContent = val;
            S.cardContent = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      for (const [val, label] of [[180, t("board.options.tilesSmall")], [240, t("board.options.tilesMedium")], [320, t("board.options.tilesLarge")]] as [number, string][]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(S.tileSize === val).onClick(async () => {
            S.tileSize = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
    } else if (activeMode === "outline") {
      menu.addItem((item) => item.setTitle(t("board.options.outlineHeader")).setDisabled(true));
      menu.addItem((item) =>
        item.setTitle(t("board.options.resetColumnWidths")).onClick(async () => {
          S.outlineWidths = Object.assign({}, DEFAULT_SETTINGS.outlineWidths);
          await this.plugin.saveSettings();
          void this.render();
        })
      );
      /* Présentation uniquement (§3-6 du micro-chantier tri naturel/wrap) :
         réglage global, même mécanisme de persistance que outlineWidths
         ci-dessus — ne touche jamais le contenu YAML des feuillets. */
      menu.addItem((item) =>
        item.setTitle(t("board.options.wrapLongText")).setChecked(!!S.outlineWrapLongText).onClick(async () => {
          S.outlineWrapLongText = !S.outlineWrapLongText;
          await this.plugin.saveSettings();
          void this.render();
        })
      );
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("board.options.visibleColumnsHeader")).setDisabled(true));
      /* Grammaire finale du Plan (§17-18) : plus jamais Notes/Nom du
         fichier/Progression/Compiler dans ce menu, même sur un vieux
         projet où ces réglages sont encore à `true` en donnée — colonnes
         allouées par mode (synopsis + POV en Fiction, résumé long en
         Non-fiction/Libre). */
      const outlineColumnDefs: [string, string][] =
        pType === "fiction"
          ? [
              ["synopsis", t("board.col.synopsis")],
              ["pov", t("board.col.pov")],
              ["characters", t("board.col.characters")],
              ["thread", t("board.col.thread")],
              ["label", t("board.col.label")],
              ["status", t("board.col.status")],
              ["tags", t("board.col.tags")],
              ["date", t("board.col.date")],
              ["words", t("board.col.words")],
              ["goal", t("board.col.goal")],
            ]
          : [
              ["summary", t("binder.preview.summary")],
              ["label", t("board.col.label")],
              ["status", t("board.col.status")],
              ["tags", t("board.col.tags")],
              ["date", t("board.col.date")],
              ["words", t("board.col.words")],
              ["goal", t("board.col.goal")],
            ];
      for (const [colKey, label] of outlineColumnDefs) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(!!outlineColumns[colKey]).onClick(async () => {
            outlineColumns[colKey] = !outlineColumns[colKey];
            meta.outlineCols = outlineColumns;
            S.outlineCols = { ...outlineColumns };
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
    } else if (activeMode === "arcs") {
      /* §2 LOT 5 — « Informations affichées » du Chemin de fer (Synopsis,
         pov, Personnages, Fil) : options de la sous-vue Trame UNIQUEMENT.
         Couloirs a ses propres réglages locaux (Axe, +) dans la barre
         narrative, jamais ici. */
      if (this.narrativeSubview === "trame") {
        menu.addItem((item) => item.setTitle(t("board.options.arcsHeader")).setDisabled(true));
        menu.addItem((item) =>
          item.setTitle(t("board.options.arcsShowSynopsis")).setChecked(!!S.arcsShowSynopsis).onClick(async () => {
            S.arcsShowSynopsis = !S.arcsShowSynopsis;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
        menu.addItem((item) =>
          item.setTitle(t("board.options.arcsShowPov")).setChecked(!!S.arcsShowPov).onClick(async () => {
            S.arcsShowPov = !S.arcsShowPov;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
        menu.addItem((item) =>
          item.setTitle(t("board.options.arcsShowCharacters")).setChecked(!!S.arcsShowCharacters).onClick(async () => {
            S.arcsShowCharacters = !S.arcsShowCharacters;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
        menu.addItem((item) =>
          item.setTitle(t("board.options.arcsShowThreads")).setChecked(!!S.arcsShowThreads).onClick(async () => {
            S.arcsShowThreads = !S.arcsShowThreads;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
      }
    } else if (activeMode === "timeline") {
      buildBoardTimelineOptionsMenu(menu, {
        settings: S,
        getChronoFolder: () => this.plugin.getChronoFolder(),
        tagsOf: (file) => this.plugin.tagsOf(file),
        saveSettings: () => this.plugin.saveSettings(),
        rerender: () => { void this.render(); },
      });
    }
  }

  makeGoalInput(parent: HTMLElement, file: TFile): HTMLInputElement {
    const fm = this.fm(file);
    const input = parent.createEl("input", {
      cls: "feuillets-goal-input",
      type: "number",
      attr: { min: "0", placeholder: String(projectWordGoalDefault(this.app, this.plugin.settings)) },
    });
    if (fm.goal !== undefined) input.value = toValue(fm.goal);
    input.addEventListener("change", () => {
      /* Jamais NaN ni nombre négatif : une valeur non numérique ou négative
         vide le champ (le writer supprime la clé) au lieu d'écrire un goal
         incohérent. parseInt ne produit jamais Infinity (les exposants sont
         tronqués). min=0 guide l'UI, cette garde protège l'écriture. */
      const val = parseInt(input.value, 10);
      void (async () => {
        await this.setFm(file, "goal", isNaN(val) || val < 0 ? "" : val);
        /* Tri Objectif actif : la liste doit refléter immédiatement le nouvel
           ordre — re-render du Plan après l'écriture (même mécanisme que les
           autres éditeurs de métadonnée, aucun système réactif ajouté). */
        if (this.outlineSortColumn === "goal") void this.render(true);
      })();
    });
    return input;
  }

  makeTagsEditor(parent: HTMLElement, file: TFile): void {
    if (!this.plugin.settings.showTags) return;
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const tag of tags) wrap.createSpan({ cls: "feuillets-tag-chip", text: `#${tag}` });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : t("shared.tags.placeholder") },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const val = input.value.trim();
      if (!val) return;
      const added = val.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
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
        const next = tags.filter((_: string, i: number) => i !== idx);
        void this.setFm(file, "tags", next);
      });
    });
  }

  renderBreadcrumbs(container: HTMLElement, root: TFolder, currentFolder: TFolder): void {
    const chain: TFolder[] = [];
    let cur: TFolder | null = currentFolder;
    while (cur && cur.path !== root.path) {
      chain.push(cur);
      cur = cur.parent;
    }
    chain.push(root);
    chain.reverse();

    const breadcrumbs = container.createDiv({ cls: "feuillets-board-breadcrumbs" });
    chain.forEach((f, idx) => {
      if (idx > 0) breadcrumbs.createSpan({ text: "  /  ", cls: "feuillets-breadcrumb-sep" });
      const isLast = idx === chain.length - 1;
      breadcrumbs
        .createSpan({ cls: "feuillets-breadcrumb-link" + (isLast ? " is-active" : ""), text: f.path === root.path ? t("board.projectBreadcrumb") : f.name })
        .addEventListener("click", () => {
          this.focusedFolderPath = f.path;
          void this.render(true);
        });
    });
  }

  private async focusBoardFolder(folder: TFolder): Promise<void> {
    this.focusedFolderPath = folder.path;
    const projectRoot = this.getProjectFolder();
    const projectMeta = projectRoot ? this.plugin.settings.projectMeta?.[projectRoot.path] : undefined;
    if (projectMeta) projectMeta.boardWholeManuscript = false;
    this.plugin.settings.boardWholeManuscript = false;
    await this.plugin.saveSettings();
    void this.render(true);
  }

  renderBoard(container: HTMLElement, root: TFolder, currentFolder: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
    const children = this.plugin.getOrderedChildren(currentFolder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
    const grid = container.createDiv({ cls: "feuillets-grid" });
    this.gridStyle(grid);
    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      if (item instanceof TFile) {
        if (this.passesFilter(item)) this.renderCard(grid, currentFolder, item, i, children, numbering, bumpTotal);
      } else if (item instanceof TFolder) {
        this.renderFolderCard(grid, currentFolder, item, i, children, numbering, bumpTotal);
      }
    }
  }

  renderBoardWholeManuscript(container: HTMLElement, root: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
    const S = this.plugin.settings;
    const walk = (folder: TFolder, depth: number) => {
      const children = this.plugin.getOrderedChildren(folder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
      let activeGrid: HTMLElement | null = null;
      for (let i = 0; i < children.length; i++) {
        const item = children[i];
        if (item instanceof TFolder) {
          activeGrid = null;
          const sec = container.createDiv({ cls: "feuillets-board-whole-section" });
          sec.style.marginLeft = `${depth * 16}px`;

          /* En-tête construit ici plutôt qu'avec le renderSectionHead
             partagé (Notes/Propriétés/Projet…) : on a besoin que toute la
             ligne serve de poignée de glisser-déposer, comme les cartes de
             scène juste en dessous (renderCard) — une petite poignée dédiée
             de quelques pixels s'est révélée peu fiable/découvrable. */
          const collapseKey = `board:whole:${item.path}`;
          const isCollapsed = !!S.collapsed[collapseKey];
          const head = sec.createDiv({ cls: "feuillets-section-head" });
          const titleEl = head.createDiv({ cls: "feuillets-section-title" });
          titleEl.createSpan({ cls: "feuillets-chevron" }).setText(isCollapsed ? "▸" : "▾");
          const iconEl = titleEl.createSpan({ cls: "feuillets-section-icon" });
          setIcon(iconEl, "folder");
          titleEl.createSpan({ cls: "feuillets-section-title-text" }).setText(item.name);
          titleEl.addEventListener("click", () => {
            void (async () => {
              if (isCollapsed) delete S.collapsed[collapseKey];
              else S.collapsed[collapseKey] = true;
              await this.plugin.saveSettings();
              void this.render(true);
            })();
          });
          if (!this.filterActive()) this.attachDragHandlers(head, sec, folder, i, children, container);

          if (!isCollapsed) walk(item, depth + 1);
        } else if (item instanceof TFile) {
          if (!this.passesFilter(item)) continue;
          if (!activeGrid) {
            activeGrid = container.createDiv({ cls: "feuillets-grid feuillets-board-whole-grid" });
            activeGrid.style.marginLeft = `${depth * 16}px`;
            this.gridStyle(activeGrid);
          }
          this.renderCard(activeGrid, folder, item, i, children, numbering, bumpTotal);
        }
      }
    };
    walk(root, 0);
  }

  makeClickToEditFmArea(parent: HTMLElement, file: TFile, key: string, placeholder: string, maxLines = 6, afterSave?: () => void | Promise<void>): HTMLElement {
    const fm = this.fm(file);
    const val = toValue(fm[key]);
    /* Texte affiché par la cellule : valeur brute si non vide, sinon
       placeholder. Le textarea, lui, reçoit TOUJOURS la valeur brute
       (area.value). */
    const cell = parent.createDiv({ cls: "feuillets-flat-text-cell" + (val ? "" : " is-empty"), text: val || placeholder });
    if (maxLines) {
      cell.style.setProperty("--max-lines", String(maxLines));
      cell.addClass("feuillets-clamp-text");
    }
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      cell.hide();
      const area = parent.createEl("textarea", { cls: "feuillets-flat-textarea feuillets-autosize" });
      area.value = toValue(fm[key]);
      area.focus();
      area.style.removeProperty("height");
      area.style.height = `${area.scrollHeight}px`;
      const save = async () => {
        if (area.parentNode) {
          const raw = area.value.trim();
          if (raw !== toValue(fm[key])) {
            await this.setFm(file, key, raw);
            cell.setText(raw || placeholder);
            if (raw) cell.removeClass("is-empty"); else cell.addClass("is-empty");
            await afterSave?.();
          }
          area.remove();
          cell.show();
        }
      };
      area.addEventListener("blur", () => { void save(); });
      area.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" || (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey))) area.blur();
      });
    });
    return cell;
  }

  /* §9-12 LOT 5 — variante LISTE de makeClickToEditFmArea pour Personnages et
     Fil. La saisie est CSV ; au blur, parseCsvList normalise et setFm reçoit
     toujours un tableau ([] inclus, qui vide le champ logique → « — »).
     setFm + afterSave ne sont déclenchés QUE si la liste change réellement
     (même longueur, mêmes éléments, même ordre). */
  makeClickToEditFmList(parent: HTMLElement, file: TFile, key: string, items: string[], afterSave?: () => void | Promise<void>): HTMLElement {
    const display = items.join(", ");
    const cell = parent.createDiv({ cls: "feuillets-flat-text-cell" + (display ? "" : " is-empty"), text: display || "—" });
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      cell.hide();
      const area = parent.createEl("textarea", { cls: "feuillets-flat-textarea feuillets-autosize" });
      area.value = display;
      area.focus();
      area.style.removeProperty("height");
      area.style.height = `${area.scrollHeight}px`;
      const save = async () => {
        if (area.parentNode) {
          const next = parseCsvList(area.value);
          if (!listsEqual(items, next)) {
            await this.setFm(file, key, next);
            cell.setText(next.join(", ") || "—");
            if (next.length) cell.removeClass("is-empty"); else cell.addClass("is-empty");
            await afterSave?.();
          }
          area.remove();
          cell.show();
        }
      };
      area.addEventListener("blur", () => { void save(); });
      area.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" || (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey))) area.blur();
      });
    });
    return cell;
  }

  /* Édition inline du short_title d'un feuillet par double-clic sur son titre
     (Plan et Cartes) — aucun modal, JAMAIS de renommage physique du fichier.
     L'input compact remplace temporairement le titre affiché, prérempli avec le
     titre court courant (shortTitleFor) ; Enter/blur valident, Escape annule.
     L'écriture passe par setFm(file, "short_title", valeur) — le fichier garde
     exactement son chemin, son basename, son extension, son dossier, son ordre
     Binder et son contenu Markdown ; seule la clé short_title peut changer.
     Valeur vide → setFm avec "" (le champ disparaît, l'affichage retombe sur
     titleFor via shortTitleFor) ; valeur inchangée → aucune écriture, aucun
     render. `host` reçoit l'input ; `displayEl` est l'élément qui portait le
     titre (masqué pendant l'édition). Quand host === displayEl (titre de carte
     Cartes), le texte est vidé puis restauré au lieu d'être masqué. */
  private beginInlineShortTitleEdit(host: HTMLElement, displayEl: HTMLElement, file: TFile): void {
    const current = this.plugin.shortTitleFor(file);
    if (displayEl === host) displayEl.empty();
    else displayEl.hide();
    const input = host.createEl("input", {
      type: "text",
      cls: "feuillets-inline-rename",
      value: current,
    });
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const raw = input.value.trim();
      input.remove();
      if (displayEl === host) displayEl.setText(current);
      else displayEl.show();
      if (!commit) return;
      if (raw === current) return;
      await this.setFm(file, "short_title", raw);
      void this.render(true);
    };
    input.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
      if (evt.key === "Enter") {
        evt.preventDefault();
        void finish(true);
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  renderFolderCard(container: HTMLElement, parentFolder: TFolder, folder: TFolder, index: number, siblings: ProjectNode[], _numbering: unknown, _bumpTotal: unknown): void {
    const card = container.createDiv({ cls: "feuillets-card feuillets-card-folder" });
    card.setAttr("title", t("board.folderCard.doubleClickEnter", { name: folder.name }));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFolderContextMenu(e, folder, parentFolder, index, siblings);
    });
    card.addEventListener("dblclick", () => {
      this.focusedFolderPath = folder.path;
      void this.render(true);
    });

    const folderNote = this.plugin.folderNoteFor(folder);
    const label = folderNote ? this.plugin.labelOf(folderNote) : null;
    const color = label ? this.plugin.labelColor(label) : null;
    if (color) card.style.borderTop = `3px solid ${color}`;

    const head = card.createDiv({ cls: "feuillets-card-head" });
    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "folder");
    /* `style` n'est pas une clé reconnue de DomElementInfo (cls/text/attr/
       title seulement) : Obsidian l'ignore silencieusement à l'exécution,
       ce bloc n'a donc jamais réellement appliqué ce style inline — état
       préexistant à cette migration, reproduit tel quel. */
    const num = head.createDiv({
      cls: "feuillets-card-num",
      attr: { style: "font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 90px; cursor: pointer;" },
    });
    num.setText(folder.name);
    num.setAttr("title", t("board.folderCard.clickToEnter"));
    num.addEventListener("click", (e) => {
      e.stopPropagation();
      this.focusedFolderPath = folder.path;
      void this.render(true);
    });

    /* §15 : plus de nombre de mots, d'objectif affiché ni d'anneau de
       progression sur la carte dossier — grammaire finale Cartes. */
    const fieldKey = this.currentCardContent === "synopsis" ? "synopsis" : "summary";
    const summary = toValue(folderNote && this.plugin.fmOf(folderNote)[fieldKey]);
    const excerpt = card.createDiv({ cls: "feuillets-card-excerpt" });
    excerpt.addClass("feuillets-mt-sm");
    excerpt.setText(summary || (fieldKey === "synopsis" ? t("board.folderCard.synopsisPlaceholder") : t("board.folderCard.summaryPlaceholder")));

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  renderCard(container: HTMLElement, parentFolder: TFolder, file: TFile, index: number, siblings: ProjectNode[], numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
    const S = this.plugin.settings;
    const role = this.plugin.roleOfFile(file);
    const card = container.createDiv({ cls: role === "scene" ? "feuillets-card feuillets-card-scene" : "feuillets-card" });
    card.setAttr("title", file.basename);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFileContextMenu(e, file, parentFolder, index, siblings);
    });

    const label = this.plugin.labelOf(file);
    const color = label ? this.plugin.labelColor(label) : null;
    /* Liseré latéral plutôt que bande supérieure : sur la grille de
       fiches, une barre pleine largeur en haut de chaque carte dominait
       visuellement toute la grille (effet "tableau kanban coloré") avant
       même de lire le texte. En bordure gauche, la couleur du label reste
       un vrai repère au premier coup d'œil sans écraser le reste. */
    if (color) card.style.borderLeft = `3px solid ${color}`;

    const head = card.createDiv({ cls: "feuillets-card-head" });
    if (this.selectionModeActive && this.plugin.isSceneFile(file)) {
      const cb = head.createEl("input", { type: "checkbox", cls: "feuillets-scene-select" });
      cb.checked = this.plugin._binderMultiSelect!.has(file.path);
      cb.setAttr("title", t("board.card.selectThisUnit", { unit: this.plugin.unitLabel() }));
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this.plugin._binderMultiSelect!.add(file.path);
        else this.plugin._binderMultiSelect!.delete(file.path);
        void this.render(true);
      });
    }

    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "file-text");
    head.createDiv({ cls: "feuillets-card-num" }).setText(String(numbering.get(file.path)));
    const titleEl = head.createDiv({ cls: "feuillets-card-title" });
    titleEl.setText(this.plugin.shortTitleFor(file));
    titleEl.setAttr("title", file.basename);
    /* Double-clic sur le TITRE d'une carte FEUILLET → édition inline du
       short_title (même helper que le Plan) — jamais de renommage physique.
       Le double-clic d'une CARTE DOSSIER, lui, continue d'entrer dans le
       dossier (renderFolderCard, inchangé). Le clic simple reste sans effet
       (l'ouverture se fait via l'extrait ou le menu « … »). */
    titleEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.beginInlineShortTitleEdit(titleEl, titleEl, file);
    });

    const pov = povOf(this.fm(file));
    if (pov) {
      const povEl = head.createDiv({ cls: "feuillets-card-pov" });
      povEl.setText(pov);
      povEl.setAttr("title", t("board.card.povTooltip", { pov }));
    }

    /* §12 : statut toujours visible s'il existe — petit, discret, neutre
       (`.feuillets-card-status`, voir styles.css), jamais de couleur de
       statut ni de badge : le label reste le seul repère fortement coloré
       de la carte. */
    const statusValue = toValue(this.fm(file).status);
    if (statusValue) {
      const statusEl = head.createDiv({ cls: "feuillets-card-status" });
      statusEl.setText(statusValue);
      statusEl.setAttr("title", statusValue);
    }

    const more = head.createDiv({ cls: "feuillets-card-more clickable-icon" });
    setIcon(more, "more-horizontal");
    more.setAttr("title", t("board.card.moreTooltip"));
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      const currentSt = toValue(this.fm(file).status);
      const S = this.plugin.settings;
      for (const st of getProjectStatuses(this.app, S).filter(Boolean)) {
        menu.addItem((item) =>
          item.setTitle(t("shared.contextMenu.statusLabel", { status: st })).setChecked(st === currentSt).onClick(async () => {
            await this.setFm(file, "status", st === currentSt ? "" : st);
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.editTags")).onClick(() => {
          new TagsModal(this.app, this.plugin, file).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.editSummary")).onClick(() => {
          new FmFieldModal(this.app, this.plugin, file, "summary", t("board.card.longSummaryLabel"), () => { void this.render(true); }).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("board.card.editPov")).onClick(() => {
          new FmFieldModal(this.app, this.plugin, file, "pov", t("board.card.povFieldLabel"), () => { void this.render(true); }).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("shared.research.openFile")).onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        })
      );

      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.compareWithSnapshot")).setIcon("history").onClick(async () => {
          const projectRoot = this.plugin.getProjectFolder();
          const snapshots = listSnapshotFiles(this.app, file, projectRoot);

          if (snapshots.length === 0) {
            new Notice(t("shared.contextMenu.noSnapshotFound", { name: file.basename }));
            return;
          }

          await openSnapshotComparison(this.app, this.plugin, file, snapshots[0]);
        })
      );

      menu.showAtMouseEvent(e);
    });

    if (this.currentCardContent === "synopsis") {
      this.makeClickToEditFmArea(card, file, "synopsis", t("board.card.synopsisPlaceholder"), 6);
    } else if (this.currentCardContent === "summary") {
      this.makeClickToEditFmArea(card, file, "summary", t("board.card.summaryPlaceholder"), 6);
    } else {
      const excerpt = card.createDiv({ cls: "feuillets-card-excerpt", text: "…" });
      excerpt.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
      void this.app.vault.cachedRead(file).then((raw) => {
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
        /* On tranche un peu large AVANT de nettoyer la syntaxe (le nettoyage
           raccourcit le texte) puis on recoupe à la longueur voulue —
           inutile de dépouiller tout le corps du feuillet pour un aperçu. */
        const limit = Number(S.excerptLength) || 420;
        const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
        excerpt.setText(clean || t("binder.item.emptyPreview"));
      });
    }

    /* §13 : plus de nombre de mots, d'anneau de progression ni de tags/chips
       sous la carte — grammaire finale Cartes. Le calcul du nombre de mots
       reste fait (bumpTotal alimente le total de la barre, les filtres de
       progression et les objectifs restent fonctionnels ailleurs). */
    const wc = this.wcMap!.get(file.path) || 0;
    bumpTotal(wc);

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  renderCheminDeFer(container: HTMLElement, root: TFolder, numbering: Map<string, string>): void {
    const S = this.plugin.settings;
    type ChdfItem = { type: "folder"; folder: TFolder; role: string } | { type: "file"; file: TFile };
    const items: ChdfItem[] = [];
    const collect = (folder: TFolder) => {
      for (const child of this.plugin.getOrderedChildren(folder)) {
        if (child.name.startsWith("_") || child.path.includes("/_") || this.plugin.isFrontMatter(child)) continue;
        if (child instanceof TFolder) {
          const role = this.plugin.roleOfFolder(child);
          if (role === "partie" || role === "chapitre") items.push({ type: "folder", folder: child, role });
          collect(child);
        } else if (child instanceof TFile && child.extension === "md") {
          const role = this.plugin.roleOfFile(child);
          if (role === "scene" || role === "chapitre") items.push({ type: "file", file: child });
        }
      }
    };
    collect(root);

    const fileItems = items.filter((i): i is { type: "file"; file: TFile } => i.type === "file");
    const labelsSet = new Set<string>();
    const labelMap = new Map<string, string[]>();
    const filsMap = new Map<string, string[]>();
    const personnagesSet = new Set<string>();
    const personnagesMap = new Map<string, string[]>();
    const povSet = new Set<string>();
    const povMap = new Map<string, string>();

    for (const item of fileItems) {
      const lbs = this.plugin.labelsOf(item.file);
      labelMap.set(item.file.path, lbs);
      for (const l of lbs) labelsSet.add(l);
      const fm = this.fm(item.file);
      filsMap.set(item.file.path, getFilsList(fm));
      const persos = getPersonnagesList(fm);
      personnagesMap.set(item.file.path, persos);
      for (const p of persos) personnagesSet.add(p);
      const pv = povOf(fm);
      povMap.set(item.file.path, pv);
      if (pv) povSet.add(pv);
    }

    const sortedLabels = Array.from(labelsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const filsSet = new Set<string>();
    for (const arr of filsMap.values()) for (const f of arr) filsSet.add(f);
    const sortedFils = Array.from(filsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const sortedPersonnages = Array.from(personnagesSet).sort((a, b) => a.localeCompare(b, "fr"));
    const sortedPovs = Array.from(povSet).sort((a, b) => a.localeCompare(b, "fr"));

    const wrap = container.createDiv({ cls: "feuillets-notes-container" });
    /* L'état vide ne dépend que de la présence réelle de feuillets : un projet
       avec des scènes mais sans label/fil/POV doit quand même afficher les
       lignes éditables (Synopsis, POV). Sans feuillet du tout, l'état vide
       historique est conservé. */
    if (fileItems.length === 0) {
      wrap.createDiv({
        cls: "feuillets-empty",
        text: t("board.arcs.empty"),
      });
      return;
    }

    /* §23 LOT 4 — la barre de filtres n'existe QUE si une vraie donnée
       filtrable est présente, OU si un filtre Story Arc est encore actif
       (ex. le dernier pov sélectionné vient d'être supprimé : la barre
       reste accessible pour revenir à « Tous »). Condition INDÉPENDANTE
       des options d'affichage (arcsShowSynopsis/Pov/Characters) : masquer
       une ligne ne retire jamais son filtre, et un projet sans aucune
       métadonnée ni filtre actif ne crée aucun faux espace en haut des
       lignes. */
    const hasFilterData =
      sortedLabels.length > 0 || sortedPersonnages.length > 0 || sortedFils.length > 0 || sortedPovs.length > 0;
    const hasActiveArcFilter =
      !!this.selectedLabel ||
      !!this.selectedPerso ||
      !!this.selectedFil ||
      !!this.selectedPov;

    if (hasFilterData || hasActiveArcFilter) {
      const filterBar = wrap.createDiv({ cls: "feuillets-arcs-filter-bar" });

      const buildFilterMenuBtn = (icon: string, name: string, options: string[], currentValue: string | undefined, onSelect: (v: string) => void) => {
        const btn = filterBar.createEl("button", { cls: "clickable-icon feuillets-arcs-filter-btn" });
        setIcon(btn.createSpan(), icon);
        btn.createSpan({ cls: "feuillets-arcs-filter-btn-label", text: currentValue || name });
        setTooltip(btn, currentValue ? `${name} : ${currentValue}` : t("board.arcs.filterByTooltip", { name: name.toLowerCase() }));
        if (currentValue) btn.addClass("is-active");
        btn.addEventListener("click", (e) => {
          const menu = new Menu();
          menu.addItem((item) => item.setTitle(t("binder.filter.all")).setChecked(!currentValue).onClick(() => {
            onSelect("");
            void this.render(true);
          }));
          menu.addSeparator();
          for (const opt of options) {
            menu.addItem((item) =>
              item.setTitle(opt).setChecked(currentValue === opt).onClick(() => {
                onSelect(opt);
                void this.render(true);
              })
            );
          }
          menu.showAtMouseEvent(e);
        });
        return btn;
      };

      /* Chaque bouton est rendu si sa liste contient au moins une valeur,
         OU si une valeur de ce filtre est encore sélectionnée (elle peut
         être devenue obsolète après suppression de la dernière occurrence :
         le bouton reste cliquable pour revenir à « Tous »). */
      if (sortedLabels.length > 0 || this.selectedLabel) {
        buildFilterMenuBtn("map-pin", t("board.arcs.labelFilterName"), sortedLabels, this.selectedLabel, (v) => { this.selectedLabel = v; });
      }
      if (sortedPersonnages.length > 0 || this.selectedPerso) {
        buildFilterMenuBtn("users", t("board.arcs.characterFilterName"), sortedPersonnages, this.selectedPerso, (v) => { this.selectedPerso = v; });
      }
      if (sortedFils.length > 0 || this.selectedFil) {
        buildFilterMenuBtn("route", t("board.arcs.threadFilterName"), sortedFils, this.selectedFil, (v) => { this.selectedFil = v; });
      }
      if (sortedPovs.length > 0 || this.selectedPov) {
        buildFilterMenuBtn("eye", t("board.arcs.povFilterName"), sortedPovs, this.selectedPov, (v) => { this.selectedPov = v; });
      }
    }

    const filterLabel = this.selectedLabel || "";
    const filterFil = this.selectedFil || "";
    const filterPerso = this.selectedPerso || "";
    const filterPov = this.selectedPov || "";

    const activeLabels = filterLabel ? [filterLabel] : sortedLabels;
    const activeFils = filterFil ? [filterFil] : sortedFils;
    const matchedSet = (filterLabel || filterFil || filterPerso || filterPov)
      ? new Set(fileItems.filter((i) => {
          const path = i.file.path;
          if (filterLabel && !(labelMap.get(path) || []).includes(filterLabel)) return false;
          if (filterFil && !(filsMap.get(path) || []).includes(filterFil)) return false;
          if (filterPerso && !(personnagesMap.get(path) || []).includes(filterPerso)) return false;
          if (filterPov && povMap.get(path) !== filterPov) return false;
          return true;
        }).map((i) => i.file.path))
      : null;

    // Étendue (première → dernière apparition) de chaque lieu/fil parmi les scènes
    // effectivement affichées, pour tracer une ligne de continuité entre les points.
    const renderedPaths = items
      .filter((i): i is { type: "file"; file: TFile } => i.type === "file" && (!matchedSet || matchedSet.has(i.file.path)))
      .map((i) => i.file.path);

    const labelFirst: Record<string, number> = {}, labelLast: Record<string, number> = {};
    activeLabels.forEach((lb) => { labelFirst[lb] = -1; labelLast[lb] = -1; });
    const filFirst: Record<string, number> = {}, filLast: Record<string, number> = {};
    activeFils.forEach((f) => { filFirst[f] = -1; filLast[f] = -1; });

    renderedPaths.forEach((path, idx) => {
      for (const lb of labelMap.get(path) || []) {
        if (!(lb in labelFirst)) continue;
        if (labelFirst[lb] === -1) labelFirst[lb] = idx;
        labelLast[lb] = idx;
      }
      for (const f of filsMap.get(path) || []) {
        if (!(f in filFirst)) continue;
        if (filFirst[f] === -1) filFirst[f] = idx;
        filLast[f] = idx;
      }
    });

    const timeline = wrap.createDiv({ cls: "feuillets-arcs-timeline" });
    let fileIndex = 0;

    for (const item of items) {
      if (item.type === "folder") {
        const row = timeline.createDiv({ cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}` });
        const spacerLeft = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerLeft.style.width = `${activeLabels.length * 16}px`;
        const title = row.createDiv({ cls: "feuillets-arcs-folder-title" });
        const num = numbering ? numbering.get(item.folder.path) : "";
        if (num) title.createSpan({ cls: "feuillets-arcs-folder-num", text: num });
        title.createSpan({ text: item.folder.name });
        title.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.focusBoardFolder(item.folder);
        });
        const spacerRight = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerRight.style.width = `${activeFils.length * 16}px`;
        continue;
      }

      const file = item.file;
      if (matchedSet && !matchedSet.has(file.path)) continue;

      const idx = fileIndex++;
      const fm = this.fm(file);
      const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });

      // Lieux (label:) à gauche en ronds
      const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      rails.style.width = `${activeLabels.length * 16}px`;
      const currentLabels = labelMap.get(file.path) || [];

      activeLabels.forEach((lb) => {
        const col = rails.createDiv({ cls: "feuillets-arcs-col" });
        setTooltip(col, lb);
        col.setAttr("title", lb);
        const color = this.plugin.labelColor(lb) || "";
        col.style.setProperty("--arc-color", color);
        const hasLabel = currentLabels.includes(lb);
        if (labelFirst[lb] !== -1 && idx >= labelFirst[lb] && idx <= labelLast[lb]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasLabel) line.addClass("feuillets-dim");
        }
        if (hasLabel) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot" });
          dot.style.backgroundColor = color;
        }
      });

      const info = row.createDiv({ cls: "feuillets-arcs-info" });
      const titleRow = info.createDiv({ cls: "feuillets-arcs-title-row" }).createDiv({ cls: "feuillets-arcs-title-left" });
      if (numbering) titleRow.createSpan({ cls: "feuillets-row-num", text: numbering.get(file.path) || "" });
      if (fm.status) {
        const dot = titleRow.createSpan({ cls: "feuillets-status-dot" });
        dot.style.background = this.plugin.getStatusColor(toValue(fm.status)) || "var(--text-faint)";
      }
      const fileTitle = titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });
      fileTitle.addClass("feuillets-clickable");
      fileTitle.addEventListener("click", (event) => {
        event.stopPropagation();
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      /* §6 LOT 4 — contrat final Synopsis du Chemin de fer : option
         d'affichage ON → la ligne est TOUJOURS présente, même vide (« — »
         éditable, placeholder "—", maxLines=6). Option OFF → aucune ligne,
         aucun espace réservé, aucune donnée touchée. */
      if (S.arcsShowSynopsis) {
        const synopsisHost = info.createDiv({ cls: "feuillets-arcs-file-synopsis" });
        this.makeClickToEditFmArea(synopsisHost, file, "synopsis", "—", 6);
      }

      /* §7-8 LOT 4 — pov : l'icône Lucide « eye » remplace tout libellé
         textuel. La ligne se décompose en iconHost + valueHost :
         makeClickToEditFmArea peut vider son parent lors de ses mises à jour,
         donc il ne reçoit QUE valueHost — l'icône reste hors de la cellule,
         du textarea, de setFm et du YAML. */
      if (S.arcsShowPov) {
        const povHost = info.createDiv({ cls: "feuillets-arcs-pov" });
        const iconHost = povHost.createSpan({ cls: "feuillets-arcs-meta-icon" });
        setIcon(iconHost, "eye");
        const valueHost = povHost.createDiv({ cls: "feuillets-arcs-meta-value" });
        this.makeClickToEditFmArea(valueHost, file, "pov", "—", 1, () => this.render(true));
      }

      /* §4-7 LOT 5 — Personnages : ligne secondaire en flex (icône Lucide
         « users » + valeur CSV éditable). L'icône vit dans iconHost, la valeur
         dans valueHost — makeClickToEditFmList ne reçoit QUE valueHost, donc
         l'icône ne disparaît jamais pendant l'édition. Option ON → ligne
         TOUJOURS présente, même vide (« — » éditable) ; OFF → aucune ligne. */
      if (S.arcsShowCharacters) {
        const charsHost = info.createDiv({ cls: "feuillets-arcs-personnages" });
        const iconHost = charsHost.createSpan({ cls: "feuillets-arcs-meta-icon" });
        setIcon(iconHost, "users");
        const valueHost = charsHost.createDiv({ cls: "feuillets-arcs-meta-value" });
        this.makeClickToEditFmList(valueHost, file, "characters", personnagesMap.get(file.path) || [], () => this.render(true));
      }

      // Fils (fil:) à droite en carrés
      const currentFils = filsMap.get(file.path) || [];

      /* §4-7 LOT 5 — Fil : même grammaire que Personnages avec l'icône
         « route ». La valeur lue et écrite est la MÊME source logique `thread`
         que les rails de droite (currentFils) — un seul modèle de données. */
      if (S.arcsShowThreads) {
        const threadHost = info.createDiv({ cls: "feuillets-arcs-thread" });
        const threadIconHost = threadHost.createSpan({ cls: "feuillets-arcs-meta-icon" });
        setIcon(threadIconHost, "route");
        const threadValueHost = threadHost.createDiv({ cls: "feuillets-arcs-meta-value" });
        this.makeClickToEditFmList(threadValueHost, file, "thread", currentFils, () => this.render(true));
      }

      const filRails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      filRails.style.width = `${activeFils.length * 16}px`;

      activeFils.forEach((f) => {
        const col = filRails.createDiv({ cls: "feuillets-arcs-col" });
        setTooltip(col, f);
        col.setAttr("title", f);
        const color = filColor(f);
        col.style.setProperty("--arc-color", color);
        const hasFil = currentFils.includes(f);
        if (filFirst[f] !== -1 && idx >= filFirst[f] && idx <= filLast[f]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasFil) line.addClass("feuillets-dim");
        }
        if (hasFil) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot feuillets-arcs-dot-fil" });
          dot.style.backgroundColor = color;
        }
      });
    }
  }

  /* ===================== LOT 5C — COULOIRS (lanes) =====================
     Représentation narrative façon Scrivener : axe horizontal = ordre narratif
     réel des feuillets (source ordonnée existante de BoardView, jamais re-triée),
     axe vertical = lignes du registre courant (Label / Personnage / Fil / Pov,
     ordre imposé). Chaque feuillet filtré occupe UNE position horizontale fixe
     (index narratif i en colonne i) ; les emplacements vides conservent la
     largeur d'une carte — ils matérialisent l'alternance narrative, jamais
     révélés (aucune cellule visible). Le drag ne modifie QUE le champ d'axe
     (label/characters/thread/pov), jamais l'ordre du manuscrit. */

  /** Barre d'axe des Couloirs : la MÊME grammaire que la barre de filtres de
     Trame (feuillets-arcs-filter-bar / feuillets-arcs-filter-btn, icône +
     libellé), utilisée ici comme sélecteur EXCLUSIF de l'axe — ordre imposé
     Label, Personnage, Fil, Pov, exactement l'ordre des boutons de la barre
     Trame (mêmes libellés board.arcs.*FilterName). L'axe actif porte la classe
     feuillets-lanes-axis-active + aria-pressed="true" (PAS is-active, réservé
     aux filtres Trame). Le « + » est contextuel à l'axe actif : le tooltip
     reflète ce qu'on crée (Nouveau label / Nouveau personnage / …). */
  private renderLanesAxisBar(container: HTMLElement): void {
    /* Même classe de base que la barre de filtres Trame (grammaire partagée,
       feuillets-arcs-filter-bar) + modificateur Couloirs : largeur INTRINSÈQUE
       centrée (pas de space-between, pas d'étalement à 1000px) pour reprendre
       réellement la compacité de la barre Trame (§4/§18). Construite dans le
       conteneur de niveau vue, jamais dans la zone défilante. */
    const bar = container.createDiv({ cls: "feuillets-arcs-filter-bar feuillets-lanes-axis-bar" });
    const axes: [LaneAxis, string, string][] = [
      ["label", t("board.arcs.labelFilterName"), "map-pin"],
      ["character", t("board.arcs.characterFilterName"), "users"],
      ["thread", t("board.arcs.threadFilterName"), "route"],
      ["pov", t("board.arcs.povFilterName"), "eye"],
    ];
    for (const [key, label, icon] of axes) {
      const btn = bar.createEl("button", { cls: "clickable-icon feuillets-arcs-filter-btn" });
      setIcon(btn.createSpan(), icon);
      btn.createSpan({ cls: "feuillets-arcs-filter-btn-label", text: label });
      setTooltip(btn, label);
      btn.setAttr("aria-label", label);
      const active = this.laneAxis === key;
      btn.setAttr("aria-pressed", String(active));
      if (active) btn.addClass("feuillets-lanes-axis-active");
      btn.addEventListener("click", () => {
        if (this.laneAxis === key) return;
        this.laneAxis = key;
        void this.render(true);
      });
    }
    /* « + » du même ensemble visuel que les axes, légèrement séparé à droite
       (feuillets-lanes-axis-add, §4). */
    const addBtn = this.iconBtn(bar, "plus", this.lanesAddLabel(), () => this.openNewLaneModal());
    addBtn.addClass("feuillets-lanes-axis-add");
  }

  /** Tooltip contextuel du bouton « + » des Couloirs, selon l'axe actif. */
  private lanesAddLabel(): string {
    if (this.laneAxis === "label") return t("board.lanes.addLabel");
    if (this.laneAxis === "character") return t("board.lanes.addCharacter");
    if (this.laneAxis === "thread") return t("board.lanes.addThread");
    return t("board.lanes.addPov");
  }

  renderCouloirs(container: HTMLElement, root: TFolder, currentFolder: TFolder, wholeManuscript: boolean, numbering: Map<string, string>): void {
    /* §5 : même source ordonnée que les autres modes — projet courant, dossier
       focalisé (option « manuscrit entier » respectée), ordre Binder/manuscrit,
       filtres globaux passesFilter(). `container` est le conteneur de niveau
       VUE (.feuillets-board-container) : la barre d'axe et la zone de couloirs
       y sont montées, la barre HORS du scroll (§2/§6). */
    const scope = wholeManuscript ? root : currentFolder;
    if (!wholeManuscript) this.renderBreadcrumbs(container, root, currentFolder);
    /* §6 : clé du périmètre affiché pour le viewport de session — si le
       périmètre change (root, scope, manuscrit entier vs dossier focalisé),
       scrollLeft/scrollTop repartent de 0 ; sinon ils sont restaurés sur le
       nouveau DOM à la fin de ce renderCouloirs (§8). */
    const scopeKey = [root.path, scope.path, wholeManuscript ? "whole" : "focused"].join("::");
    if (this._lanesViewport.key !== scopeKey) {
      this._lanesViewport.key = scopeKey;
      this._lanesViewport.left = 0;
      this._lanesViewport.top = 0;
    }
    const files = this.plugin.flattenFiles(scope).filter((f: TFile) => this.passesFilter(f) && !this.plugin.isFrontMatter(f));

    /* §21 : aucun feuillet dans le périmètre → état vide Feuillets. La présence
       de feuillets sans valeur n'est PAS un état vide. */
    if (files.length === 0) {
      const emptyScroll = container.createDiv({ cls: "feuillets-board-scroll" });
      emptyScroll.createDiv({ cls: "feuillets-empty", text: t("board.lanes.empty") });
      return;
    }

    /* §4 : barre d'axe des Couloirs — même grammaire exacte que la barre de
       filtres de Trame (feuillets-arcs-filter-bar / feuillets-arcs-filter-btn),
       ici en sélecteur EXCLUSIF de l'axe (aria-pressed sur l'actif) + bouton
       « + » contextuel à l'axe actif. Uniquement en Couloirs, jamais en Trame.
       Crucial : la barre est créée dans `container` (niveau vue), PAS dans le
       scroll — elle ne part jamais avec le canevas horizontal (§2/§5/§17). */
    this.renderLanesAxisBar(container);

    /* §6 : registre de lignes de l'axe courant — SESSION, initialisé
       paresseusement par relecture des feuillets visibles dans l'ordre narratif
       (première apparition, jamais alphabétique), jamais retiré de valeur. */
    this.ensureLaneRegistry(files);

    /* §7 : la ligne « sans valeur » est TOUJOURS rendue en dernier et TOUJOURS
       visible — même si aucun feuillet visible n'en a besoin — et est toujours
       une cible de drop. */
    const noValueLabel = this.lanesNoValueLabel();
    const lanes = [...this.laneRegistry[this.laneAxis]];
    const valuesByPath = new Map<string, string[]>();
    for (const file of files) {
      valuesByPath.set(file.path, this.axisValuesOf(file));
    }

    /* §6/§11 : zone de couloirs en DEUX niveaux géométriquement séparés —
       gutter fixe (noms de lignes, HORS de la largeur narrative) et canevas
       horizontal scrollable (le SEUL élément qui défile en X, §8). Toutes les
       pistes partagent le même repère X dans le canevas (§9). Le scroll
       vertical (.feuillets-board-scroll) porte le modificateur
       feuillets-lanes-vertical-scroll (overflow-x: hidden) : la SEULE
       scrollbar horizontale réelle est celle de .feuillets-lanes-scroll.
       La règle générale .feuillets-board-scroll (autres modes) est inchangée. */
    const scrollArea = container.createDiv({ cls: "feuillets-board-scroll feuillets-lanes-vertical-scroll" });
    const lanesArea = scrollArea.createDiv({ cls: "feuillets-lanes-area" });
    const gutter = lanesArea.createDiv({ cls: "feuillets-lanes-gutter" });
    const horizScroll = lanesArea.createDiv({ cls: "feuillets-lanes-scroll" });
    const canvas = horizScroll.createDiv({ cls: "feuillets-lanes" });
    /* §7 : mémoriser le viewport sur les DEUX scrolls réels — le horizontal
       (.feuillets-lanes-scroll) et le vertical (.feuillets-board-scroll) —
       dans _lanesViewport (état de session de l'instance, jamais persisté). */
    horizScroll.addEventListener("scroll", () => { this._lanesViewport.left = horizScroll.scrollLeft; });
    scrollArea.addEventListener("scroll", () => { this._lanesViewport.top = scrollArea.scrollTop; });
    for (const value of lanes) {
      this.renderLaneRow(canvas, gutter, value, files, valuesByPath, numbering, noValueLabel, horizScroll, scrollArea);
    }
    this.renderLaneRow(canvas, gutter, "", files, valuesByPath, numbering, noValueLabel, horizScroll, scrollArea);
    /* §8 : le nouveau DOM reprend le viewport de session APRÈS construction
       complète (canvas, lanes, tracks, slots, cartes). Assignation directe —
       pas de requestAnimationFrame : le DOM est déjà monté, scrollLeft/
       scrollTop se posent de façon synchrone. Fonctionne à CHAQUE
       renderCouloirs, pas seulement pendant le drop — indispensable pour
       survivre au second refresh différé après vault.modify. */
    horizScroll.scrollLeft = this._lanesViewport.left;
    scrollArea.scrollTop = this._lanesViewport.top;
  }

  /** Registre des lignes de l'axe courant : chaque rendu ré-scanne les feuillets
     visibles dans l'ordre narratif et AJOUTE à la fin les valeurs découvertes
     (jamais retirées, jamais triées). Satisfait §6 : « une nouvelle valeur
     découverte est ajoutée à la fin » et « un filtre ne détruit jamais le
     registre » (re-scan idempotent, les valeurs déjà connues passent sans
     effet). */
  private ensureLaneRegistry(files: TFile[]): void {
    const reg = this.laneRegistry[this.laneAxis];
    for (const file of files) {
      for (const v of this.axisValuesOf(file)) {
        if (v && !reg.includes(v)) reg.push(v);
      }
    }
  }

  /** Valeurs de regroupement d'un feuillet pour l'axe courant : Pov = scalaire
     (0 ou 1 valeur), Label / Personnage / Fil = listes multi-valeurs existantes
     (même mécanisme exact que la barre Trame — getPersonnagesList lit
     fm.characters, alias compris). */
  private axisValuesOf(file: TFile): string[] {
    if (this.laneAxis === "label") return this.plugin.labelsOf(file);
    if (this.laneAxis === "character") return getPersonnagesList(this.fm(file));
    if (this.laneAxis === "thread") return filsOf(this.fm(file));
    const pov = povOf(this.fm(file));
    return pov ? [pov] : [];
  }

  /** Libellé de la ligne « sans valeur » selon l'axe courant. */
  private lanesNoValueLabel(): string {
    if (this.laneAxis === "label") return t("board.lanes.noLabel");
    if (this.laneAxis === "character") return t("board.lanes.noCharacter");
    if (this.laneAxis === "thread") return t("board.lanes.noThread");
    return t("board.lanes.noPov");
  }

  /** Couleur de ligne Couloirs : déterministe, jamais persistée. Label → la
     couleur configurée du label (labelColor) ; Fil → la logique colorée
     existante (filColor) ; Pov → variante déterministe discrète de la même
     famille (povLaneColor) ; Personnage → variante distincte de Pov
     (characterLaneColor) pour que les deux axes multi-caractères restent
     reconnaissables. Ligne « Sans … » (valeur vide) → null : la CSS garde sa
     couleur neutre native. */
  private laneLineColor(value: string): string | null {
    if (!value) return null;
    if (this.laneAxis === "label") return this.plugin.labelColor(value);
    if (this.laneAxis === "character") return characterLaneColor(value);
    if (this.laneAxis === "thread") return filColor(value);
    return povLaneColor(value);
  }

  /** Une ligne de couloir = DEUX nœuds jumeaux index-alignés (mêmes itérations,
     même ordre) : le libellé dans le gutter FIXE, la piste dans le canevas
     défilant (autant de slots invisibles que de feuillets visibles — l'index
     narratif i reste en colonne i), vraie ligne horizontale continue centrée
     verticalement sous les cartes (§9). §11 : le gutter est GÉOMÉTRIQUEMENT
     séparé du canevas — plus aucun sticky opaque superposé qui masquerait la
     bande ou les cartes au scroll (§10/§12). */
  private renderLaneRow(
    canvas: HTMLElement,
    gutter: HTMLElement,
    value: string,
    files: TFile[],
    valuesByPath: Map<string, string[]>,
    numbering: Map<string, string>,
    noValueLabel: string,
    horizScroll: HTMLElement,
    scrollArea: HTMLElement
  ): void {
    const laneName = value || noValueLabel;
    const gutterLabel = gutter.createDiv({ cls: "feuillets-lanes-gutter-label", text: laneName });
    gutterLabel.setAttr("title", laneName);
    const row = canvas.createDiv({ cls: "feuillets-lanes-row" });
    const track = row.createDiv({ cls: "feuillets-lanes-track" });
    const line = track.createDiv({ cls: "feuillets-lane-line" });
    /* Couleur de la bande : posée INLINE via une propriété CSS (jamais de
       couleur codée en dur dans styles.css) — la CSS applique la propriété
       avec repli sur la couleur neutre native. Ligne « Sans … » → aucune
       propriété posée → neutre discrète. */
    const lineColor = this.laneLineColor(value);
    if (lineColor) line.style.setProperty("--feuillets-lane-color", lineColor);
    /* Les deux scrolls réels (horizontal + vertical) sont passés à
       attachCouloirsDrop pour la capture du viewport au drop (§9) — jamais
       de querySelector sur le DOM interne Obsidian. */
    this.attachCouloirsDrop(row, gutterLabel, track, value, horizScroll, scrollArea);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const slot = track.createDiv({ cls: "feuillets-lanes-slot" });
      slot.setAttr("data-index", String(i));
      /* La ligne « Sans … » (value === "") accueille les feuillets SANS aucune
         valeur d'axe ; les lignes nommées accueillent les feuillets dont la
         liste de valeurs contient la valeur (multi-valeurs Label/Fil inclus). */
      const fileValues = valuesByPath.get(file.path) || [];
      const matches = value === "" ? fileValues.length === 0 : fileValues.includes(value);
      if (matches) {
        this.renderCouloirsCard(slot, file, i, numbering, value);
      }
    }
  }

  /** Carte Couloir compacte : numéro narratif + titre sur la MÊME ligne, puis
     synopsis/résumé discret sous le titre — jamais Pov/Label/Fil/Personnages/
     Statut/Tags/date/objectif/progression/boutons (§10). Le liseré Label du
     bord gauche est appliqué QUEL QUE SOIT l'axe courant, via le mécanisme
     Label existant (labelColor), jamais une couleur codée en dur ; sans Label,
     seule la bordure neutre normale reste. Clic sur le titre = ouverture
     standard (openFileActivating, §12) ; le drag ne déclenche jamais
     l'ouverture. */
  renderCouloirsCard(slot: HTMLElement, file: TFile, index: number, numbering: Map<string, string>, laneValue: string): void {
    const card = slot.createDiv({ cls: "feuillets-lanes-card" });
    card.setAttr("title", file.basename);
    card.draggable = true;
    /* Valeur source = LA ligne où la carte a été rendue, capturée au DRAGSTART.
       Pour un label/fil multi-valeurs, un même feuillet apparaît dans plusieurs
       lignes : le drop doit retirer UNIQUEMENT la valeur de la ligne d'origine
       (§12 payload : chemin + axe + valeur source ; "" pour la ligne « Sans… »). */
    const sourceValue = laneValue;
    card.addEventListener("dragstart", (e) => {
      this._lanesDragPath = file.path;
      this._lanesDragSource = sourceValue;
      this._lanesDragging = true;
      e.dataTransfer?.setData("text/plain", file.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      card.addClass("feuillets-dragging");
      e.stopPropagation();
    });
    card.addEventListener("dragend", () => {
      this._lanesDragPath = null;
      this._lanesDragSource = null;
      this._lanesDragging = false;
      card.removeClass("feuillets-dragging");
      this.contentEl.querySelectorAll(".feuillets-lanes-dragover, .feuillets-dragging").forEach((el) => {
        el.removeClass("feuillets-lanes-dragover");
        el.removeClass("feuillets-dragging");
      });
    });

    /* Liseré Label : même mécanisme exact que la carte grille (renderCard) —
       labelOf + labelColor, bordure gauche posée inline. labelColor peut
       renvoyer une valeur fausse (label sans couleur configurée) → aucun
       liseré artificiel, bordure neutre conservée. */
    const labelName = this.plugin.labelOf(file);
    const labelColor = labelName ? this.plugin.labelColor(labelName) : null;
    if (labelColor) card.style.borderLeft = `3px solid ${labelColor}`;

    /* Ordre imposé : 1. numéro + titre sur la même ligne (numéro avant le
       titre), 2. synopsis/résumé en dessous. Le champ textuel suit la
       planification SÉMANTIQUE du projet (lanesPlanningField : synopsis en
       Fiction, résumé long en Non-fiction/Libre) — et NON la préférence
       d'affichage currentCardContent, qui peut être « extrait » sans que la
       synopsis doive disparaître des cartes Couloirs. */
    const head = card.createDiv({ cls: "feuillets-lanes-card-head" });
    head.createSpan({ cls: "feuillets-lanes-card-num", text: numbering.get(file.path) || String(index + 1) });
    const title = head.createDiv({ cls: "feuillets-lanes-card-title", text: this.plugin.shortTitleFor(file) });
    title.setAttr("title", file.basename);
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this._lanesDragging) return;
      openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    });

    const synopsis = toValue(this.fm(file)[this.lanesPlanningField()]);
    if (synopsis) {
      card.createDiv({ cls: "feuillets-lanes-card-synopsis", text: synopsis });
    }
  }

  /** Champ sémantique planifié pour les cartes Couloirs — résolution IDENTIQUE
     à celle de Trame (semanticPlanningField(resolveType)) : "synopsis" pour la
     Fiction, "summary" sinon. */
  private lanesPlanningField(): string {
    return semanticPlanningField(this.lanesProjectType);
  }

  /** Récepteur de drop d'une ligne : déposer une carte ici ne fait QUE
     modifier le champ d'axe courant (setFm), jamais réordonner le manuscrit
     (§14). La position X est ignorée — la cible est la ligne entière, le slot
     rendu invisible ne sert qu'à la géométrie horizontale. La classe dragover
     porte sur la PISTE (row du canevas) ET le libellé du gutter (deux nœuds
     jumeaux de la ligne) pour l'accent discret du §9. */
  attachCouloirsDrop(row: HTMLElement, gutterLabel: HTMLElement, track: HTMLElement, laneValue: string, horizScroll: HTMLElement, scrollArea: HTMLElement): void {
    track.addEventListener("dragover", (e) => {
      if (!this._lanesDragPath) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      row.addClass("feuillets-lanes-dragover");
      gutterLabel.addClass("feuillets-lanes-dragover");
    });
    track.addEventListener("dragleave", () => {
      row.removeClass("feuillets-lanes-dragover");
      gutterLabel.removeClass("feuillets-lanes-dragover");
    });
    track.addEventListener("drop", (e) => {
      e.preventDefault();
      row.removeClass("feuillets-lanes-dragover");
      gutterLabel.removeClass("feuillets-lanes-dragover");
      /* §9 : capture de la DERNIÈRE position exacte du viewport juste avant
         que handleCouloirsDrop ne détruise le DOM (render(true) après setFm).
         Complément des listeners scroll de renderCouloirs : le nouveau
         scroller reprendra cette position. Logique métier inchangée. */
      this._lanesViewport.left = horizScroll.scrollLeft;
      this._lanesViewport.top = scrollArea.scrollTop;
      void this.handleCouloirsDrop(laneValue);
    });
  }

  /** Application asynchrone du drop (listener synchrone ci-dessus : le travail
     réel vit ici, invoqué via `void`). §14-16. Le payload est le trio
     (chemin, axe, valeur source) capturé en dragstart ; l'axe courant est
     this.laneAxis. */
  private async handleCouloirsDrop(laneValue: string): Promise<void> {
    const path = this._lanesDragPath;
    const source = this._lanesDragSource;
    this._lanesDragPath = null;
    this._lanesDragSource = null;
    this._lanesDragging = false;
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    /* §15 : déposer une carte sur SA PROPRE ligne (source === cible, "" pour
       « Sans… ») → aucune écriture, aucun render — vaut pour Pov scalaire ET
       pour Label/Fil multi-valeurs. */
    if (source === laneValue) return;
    if (this.laneAxis === "pov") {
      /* POV scalaire : vers « Sans pov » (valeur "") → vide le champ : setFm
         supprime la clé. */
      await this.setFm(file, "pov", laneValue);
    } else {
      /* LABEL/PERSONNAGE/FIL multi-valeurs : retirer UNIQUEMENT la valeur
         source, ajouter la cible si absente, préserver l'ordre (§13).
         Exemples : [A,C] A→B = [C,B] · [A,B,C] A→B = [B,C] · [A,C] A→Sans =
         [C] · []→B = [B]. L'écriture passe par setFm (writer logique, mapping
         de projet, variante de casse) — jamais de YAML écrit à la main. La
         clé logique Personnage est "characters", lue via getPersonnagesList
         (même mécanisme exact que la barre Trame). */
      const key = this.laneAxis === "character" ? "characters" : this.laneAxis === "label" ? "label" : "thread";
      const current =
        key === "label" ? this.plugin.labelsOf(file) : key === "characters" ? getPersonnagesList(this.fm(file)) : filsOf(this.fm(file));
      const next = current.filter((v) => v !== source);
      if (laneValue && !next.includes(laneValue)) next.push(laneValue);
      await this.setFm(file, key, next);
    }
    void this.render(true);
  }

  /** Crée une ligne Couloirs : bouton « + » de la barre narrative. Valeur vide
     après trim → rien ; doublon exact déjà présent → rien ; sinon la valeur est
     ajoutée à la FIN du registre de session de l'axe, puis re-rendu (§8 : aucun
     YAML écrit — une ligne sans feuillet est légale). */
  createLane(axis: LaneAxis, rawValue: string): void {
    const value = String(rawValue || "").trim();
    if (!value) return;
    const reg = this.laneRegistry[axis];
    if (reg.includes(value)) return;
    reg.push(value);
    if (axis === this.laneAxis) void this.render(true);
  }

  /** Ouvre la modale de création de ligne pour l'axe courant (Couloirs). */
  openNewLaneModal(): void {
    new NewLaneModal(this.app, this, this.laneAxis).open();
  }


  renderTimeline(container: HTMLElement, folder: TFolder, numbering: Map<string, string>): void {
    return this.renderTimelineInner(container, folder, numbering);
  }

  renderTimelineInner(container: HTMLElement, folder: TFolder, _numbering: unknown): void {
    renderBoardTimeline(container, folder, {
      settings: this.plugin.settings,
      flattenFiles: (currentFolder) => this.plugin.flattenFiles(currentFolder),
      passesFilter: (file) => this.passesFilter(file),
      isFrontMatter: (file) => this.plugin.isFrontMatter(file),
      fm: (file) => this.fm(file),
      getChronoFolder: () => this.plugin.getChronoFolder(),
      tagsOf: (file) => this.plugin.tagsOf(file),
      shortTitleFor: (file) => this.plugin.shortTitleFor(file),
      setFm: (file, key, value) => this.setFm(file, key, value),
      rerenderAfterDateEdit: () => this.render(true),
      makeClickToEditFmArea: (parent, file, key, placeholder, maxLines) => this.makeClickToEditFmArea(parent, file, key, placeholder, maxLines),
      openFile: (file) => openFileActivating(this.app, this.app.workspace.getLeaf(false), file),
    });
  }

  visibleCols(): { id: string; label: string }[] {
    /* §18 : grammaire finale du Plan — Titre toujours présent, puis
       synopsis+POV en Fiction OU résumé long en Non-fiction/Libre, jamais
       les deux familles ensemble. Notes/nom du fichier/progression/compiler
       ne sont plus jamais rendus, même si un vieux projet les a encore à
       `true` en donnée (voir resolveBoardOutlineColumns). */
    const cols = this.outlineColumns || this.plugin.settings.outlineCols;
    const res = [{ id: "title", label: t("board.col.title") }];
    if (cols.synopsis) res.push({ id: "synopsis", label: t("board.col.synopsis") });
    if (cols.pov) res.push({ id: "pov", label: t("board.col.pov") });
    if (cols.characters) res.push({ id: "characters", label: t("board.col.characters") });
    if (cols.thread) res.push({ id: "thread", label: t("board.col.thread") });
    if (cols.summary) res.push({ id: "summary", label: t("board.col.summary") });
    if (cols.label) res.push({ id: "label", label: t("board.col.label") });
    if (cols.status) res.push({ id: "status", label: t("board.col.status") });
    if (cols.tags) res.push({ id: "tags", label: t("board.col.tags") });
    if (cols.date) res.push({ id: "date", label: t("board.col.date") });
    if (cols.words) res.push({ id: "words", label: t("board.col.words") });
    if (cols.goal) res.push({ id: "goal", label: t("board.col.goal") });
    return res;
  }

  colsTemplate(overrideWidths?: Record<string, number>): string {
    const widths = overrideWidths || this.plugin.settings.outlineWidths;
    return "22px " + this.visibleCols().map((c) => `${Math.max(60, widths[c.id] || 120)}px`).join(" ");
  }

  /** Un tri visuel est-il actif ? null/null = ordre Binder réel (aucune
   * flèche, drag de réorganisation réactivé). */
  private outlineSortActive(): boolean {
    return this.outlineSortColumn !== null && this.outlineSortDirection !== null;
  }

  /* Cycle exact d'un en-tête de colonne : 1er clic ascendant, 2e descendant,
     3e retour à l'ordre Binder, puis on recommence. Cliquer une AUTRE colonne
     abandonne immédiatement la précédente et active la nouvelle en ascendant.
     Le nom de colonne lui-même est la commande de tri — jamais de menu ni de
     toolbar supplémentaire. État session-only, aucune persistance. */
  cycleOutlineSort(colId: string): void {
    if (this.outlineSortColumn !== colId) {
      this.outlineSortColumn = colId;
      this.outlineSortDirection = "asc";
    } else if (this.outlineSortDirection === "asc") {
      this.outlineSortDirection = "desc";
    } else if (this.outlineSortDirection === "desc") {
      this.outlineSortColumn = null;
      this.outlineSortDirection = null;
    }
    void this.render(true);
  }

  /** Valeur de tri d'un feuillet pour une colonne — la MÊME source que la
   * valeur affichée (shortTitleFor pour le titre, povOf pour le pov, listes
   * normalisées pour Personnages/Fil, etc.). strings comparées lexicalement
   * en locale française, words/goal numériquement. Date : moteur temporel
   * Feuillets (parseStoryDate), jamais la chaîne brute. Goal : valeur
   * explicite du feuillet, jamais le défaut projet. */
  private outlineSortValue(file: TFile, colId: string): string | number {
    const fm = this.fm(file);
    switch (colId) {
      case "title": return this.plugin.shortTitleFor(file);
      case "synopsis": return toValue(fm.synopsis);
      case "summary": return toValue(fm.summary);
      case "pov": return povOf(fm);
      case "characters": return getPersonnagesList(fm).join(", ");
      case "thread": return getFilsList(fm).join(", ");
      case "label": return String(this.plugin.labelOf?.(file) || "");
      case "status": return String(toValue(fm.status) || "");
      case "tags": return String(this.plugin.tagsOf?.(file).join(", ") || "");
      case "date": return parseStoryDate(fm.date)?.sort ?? "";
      case "words": return this.wcMap?.get(file.path) || 0;
      case "goal": return this.outlineGoalSortValue(file);
      default: return "";
    }
  }

  /** Valeur de tri Objectif : le goal EXPLICITE du feuillet, jamais le défaut
   * projet (projectWordGoalDefault). Absent, vide ou non numérique → vide,
   * donc TOUJOURS trié en dernier, dans les deux directions. 0 explicitement
   * défini est une vraie valeur numérique (>= 0, jamais « vide »). */
  private outlineGoalSortValue(file: TFile): string | number {
    const raw = this.fm(file).goal;
    if (raw === undefined || raw === null || raw === "") return "";
    if (typeof raw !== "number" && typeof raw !== "string") return "";
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : "";
  }

  /** Règle unique des valeurs vides : renseignées d'abord, vides à la fin —
   * dans les DEUX directions. Les vides ne remontent jamais en tête quand la
   * direction change. Pour un nombre, seules les valeurs absentes (null/
   * undefined) comptent comme vides. */
  private compareOutlineValues(a: TFile, b: TFile, colId: string, dir: "asc" | "desc"): number {
    const va = this.outlineSortValue(a, colId);
    const vb = this.outlineSortValue(b, colId);
    const aEmpty = va === "" || va === null || va === undefined;
    const bEmpty = vb === "" || vb === null || vb === undefined;
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof va === "number" && typeof vb === "number") {
      return dir === "asc" ? va - vb : vb - va;
    }
    const cmp = String(va).localeCompare(String(vb), "fr");
    return dir === "asc" ? cmp : -cmp;
  }

  /* Collecte récursive de TOUS les feuillets du périmètre Plan, dans l'ordre
     Binder réel de parcours (getOrderedChildren à chaque niveau, frontmatter
     exclu). Chaque entrée garde son parent, son indice réel dans CE parent,
     ses siblings Binder réels et un indice plat global — le tiebreak stable du
     tri. Ne mute JAMAIS les tableaux retournés par le plugin (le .filter crée
     un nouveau tableau). */
  private collectOutlineFiles(root: TFolder): OutlineFileEntry[] {
    const out: OutlineFileEntry[] = [];
    const walk = (folder: TFolder, flat: { n: number }) => {
      const children = this.plugin.getOrderedChildren(folder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child instanceof TFolder) {
          walk(child, flat);
        } else {
          out.push({ file: child, parentFolder: folder, binderIndex: i, siblings: children, binderFlatIndex: flat.n });
          flat.n++;
        }
      }
    };
    walk(root, { n: 0 });
    return out;
  }

  /* Cible d'un clic droit située dans un champ textuel éditable (input,
     textarea, select, contenteditable) ? Si oui, le menu contextuel de ligne
     Feuillets ne doit PAS s'ouvrir : on laisse le navigateur/Obsidian gérer
     le menu natif du champ. Vérifiée AVANT tout preventDefault. */
  private isEditableContextTarget(e: MouseEvent): boolean {
    const t = e.target as
      | { tagName?: unknown; tag?: unknown; isContentEditable?: boolean; getAttribute?: (n: string) => string | null; closest?: (s: string) => unknown }
      | null;
    if (!t) return false;
    const tag = typeof t.tagName === "string" ? t.tagName.toLowerCase() : typeof t.tag === "string" ? t.tag.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    if (typeof t.getAttribute === "function" && (t.getAttribute("contenteditable") === "true" || t.getAttribute("contenteditable") === "")) return true;
    if (typeof t.closest === "function" && t.closest("input, textarea, select, [contenteditable]")) return true;
    return false;
  }

  async renderOutline(container: HTMLElement, root: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void, gen: number): Promise<void> {
    const ctx: OutlineRenderContext = {
      settings: this.plugin.settings,
      outlineColumns: this.outlineColumns || this.plugin.settings.outlineCols,
      outlineSortColumn: this.outlineSortColumn,
      outlineSortDirection: this.outlineSortDirection,
      outlineDblClickDelayMs: this.outlineDblClickDelayMs,
      numbering,
      wcMap: this.wcMap || new Map<string, number>(),
      projectType: this.lanesProjectType,
      generation: gen,
      isCurrentGeneration: (generation) => this._renderGen === generation,
      getOrderedChildren: (folder) => this.plugin.getOrderedChildren(folder),
      isFrontMatter: (node) => this.plugin.isFrontMatter(node),
      passesFilter: (file) => this.passesFilter(file),
      fm: (file) => this.fm(file),
      shortTitleFor: (file) => this.plugin.shortTitleFor(file),
      labelOf: (file) => String(this.plugin.labelOf?.(file) || ""),
      tagsOf: (file) => this.plugin.tagsOf(file),
      saveSettings: () => this.plugin.saveSettings(),
      rerender: () => { void this.render(true); },
      onFocusFolder: (folder) => this.focusBoardFolder(folder),
      cycleSort: (column) => this.cycleOutlineSort(column),
      attachColumnResize: (resizer, column, outline) => this.attachColumnResize(resizer, column, outline),
      isMultiSelected: (file) => !!this.plugin._binderMultiSelect?.has(file.path),
      isEditableContextTarget: (event) => this.isEditableContextTarget(event),
      showFileContextMenu: (event, file, parent, index, siblings) => this.showFileContextMenu(event, file, parent, index, siblings),
      showFolderContextMenu: (event, folder, parent, index, siblings) => this.showFolderContextMenu(event, folder, parent, index, siblings),
      attachDragHandlers: (handle, row, parent, index, siblings, table) => this.attachDragHandlers(handle, row, parent, index, siblings, table),
      handleMultiSelectClick: (event, file, parent, index, siblings, table) => this.handleMultiSelectClick(event, file, parent, index, siblings, table),
      beginInlineShortTitleEdit: (cell, title, file) => this.beginInlineShortTitleEdit(cell, title, file),
      openFile: (file) => openFileActivating(this.app, this.app.workspace.getLeaf(false), file),
      makeClickToEditFmArea: (parent, file, key, placeholder, maxLines) => this.makeClickToEditFmArea(parent, file, key, placeholder, maxLines),
      makeClickToEditFmList: (parent, file, key, values, rerender) => this.makeClickToEditFmList(parent, file, key, values, rerender),
      makeTagsEditor: (parent, file) => this.makeTagsEditor(parent, file),
      makeLabelSelect: (parent, file) => this.makeLabelSelect(parent, file),
      makeStatusSelect: (parent, file) => this.makeStatusSelect(parent, file),
      makeGoalInput: (parent, file) => this.makeGoalInput(parent, file),
      fillRing: (parent, words, goal) => this.fillRing(parent, words, goal),
    };
    await renderBoardOutline(container, root, ctx, bumpTotal);
  }

  /** Glisser le bord droit d'un en-tête de colonne pour la redimensionner
   * (poignée .feuillets-col-resizer, CSS déjà prévu mais jamais câblé). La
   * largeur courante suit la souris en direct via la variable CSS
   * --feuillets-cols (aucun re-rendu pendant le glissement — juste un
   * recalcul de grid-template-columns, comme colsTemplate() le ferait),
   * et n'est écrite dans les réglages (donc persistée) qu'au relâchement. */
  attachColumnResize(resizer: HTMLElement, colId: string, outline: HTMLElement): void {
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const widths = this.plugin.settings.outlineWidths;
      const startX = e.clientX;
      const startWidth = Math.max(60, widths[colId] || 120);
      let liveWidth = startWidth;

      /* is-resizing plutôt que compter sur :hover pendant le glissement :
         un mouvement rapide de souris quitte facilement la poignée de
         7px de large, et user-select:none évite de sélectionner le texte
         des lignes en dessous pendant qu'on tire. */
      resizer.addClass("is-resizing");
      document.body.addClass("feuillets-col-resizing");

      const onMouseMove = (moveEvent: MouseEvent) => {
        liveWidth = Math.max(60, startWidth + (moveEvent.clientX - startX));
        outline.style.setProperty(
          "--feuillets-cols",
          this.colsTemplate({ ...widths, [colId]: liveWidth })
        );
      };
      const onMouseUpAsync = async () => {
        resizer.removeClass("is-resizing");
        document.body.removeClass("feuillets-col-resizing");
        widths[colId] = liveWidth;
        await this.plugin.saveSettings();
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        void onMouseUpAsync();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  emptyCells(row: HTMLElement, cols: { id: string; label: string }[], handlers?: Record<string, (cell: HTMLElement) => void>): void {
    for (const c of cols) {
      if (handlers && handlers[c.id]) {
        handlers[c.id](row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` }));
      } else if (c.id !== "title") {
        row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` });
      }
    }
  }

  async renderOutlineLevel(table: HTMLElement, parentFolder: TFolder, depth: number, numbering: Map<string, string>, bumpTotal: (n?: number) => void, cols: { id: string; label: string }[], progress: { count: number }, gen: number): Promise<void> {
    const S = this.plugin.settings;
    const children = this.plugin.getOrderedChildren(parentFolder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
    /* Ici l'ordre est TOUJOURS l'ordre Binder réel : le tri global est traité
       en amont dans renderOutline (liste plate). Les dossiers restent donc
       ancrés à leur emplacement Binder exact et le drag de réorganisation
       est actif à chaque niveau. */
    for (let i = 0; i < children.length; i++) {
      if (this._renderGen !== gen) return;
      const child = children[i];
      if (child instanceof TFolder) {
        /* Même clé que le repli du Binder (S.collapsed[folder.path]) — un
           dossier replié dans un panneau reste replié dans l'autre. */
        const isCollapsed = !!S.collapsed[child.path];
        const row = table.createDiv({ cls: "feuillets-row feuillets-row-folder" });
        const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
        const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
        titleCell.style.paddingLeft = `${depth * 16}px`;
        titleCell.addClass("feuillets-clickable");
        titleCell.createSpan({ cls: "feuillets-chevron" }).setText(isCollapsed ? "▸" : "▾");
        titleCell.createSpan({ cls: "feuillets-folder-name", text: child.name });
        titleCell.addEventListener("click", () => {
          void (async () => {
            if (isCollapsed) delete S.collapsed[child.path];
            else S.collapsed[child.path] = true;
            await this.plugin.saveSettings();
            void this.render(true);
          })();
        });
        /* Menu contextuel partagé du dossier (Nouveau → Nouveau feuillet ici /
           Nouveau sous-dossier, renommage, note de dossier, …) — le MÊME menu
           que Cartes/Binder. `i`/`children` = indice et siblings Binder réels.
           La garde éditeur s'applique aussi ici : jamais de menu Feuillets
           sur un clic droit dans un champ textuel. */
        row.addEventListener("contextmenu", (e) => {
          if (this.isEditableContextTarget(e)) return;
          e.preventDefault();
          this.showFolderContextMenu(e, child, parentFolder, i, children);
        });
        /* Sans ça, une ligne de dossier n'avait aucun écouteur de
           glisser-déposer (seules les scènes en avaient, plus bas) : les
           dossiers étaient donc impossibles à réorganiser dans la vue
           Plan. */
        this.attachDragHandlers(handle, row, parentFolder, i, children, table);

        if (!isCollapsed) {
          await this.renderOutlineLevel(table, child, depth + 1, numbering, bumpTotal, cols, progress, gen);
        }
        continue;
      }

      if (!this.passesFilter(child)) continue;
      this.renderOutlineFileRow(table, child, parentFolder, i, children, depth, bumpTotal, cols);
    }
  }

  /* Ligne feuillet du Plan — partagée entre le rendu hiérarchique (ordre
     Binder) et la liste plate du tri global. `binderIndex`/`siblings` sont
     TOUJOURS les valeurs Binder réelles, jamais la position visuelle triée.
     Le drag de réorganisation n'est branché que hors tri (pendant un tri,
     l'ordre affiché n'est plus l'ordre Binder : aucune écriture d'ordre
     possible). */
  private renderOutlineFileRow(table: HTMLElement, file: TFile, parentFolder: TFolder, binderIndex: number, siblings: ProjectNode[], depth: number, bumpTotal: (n?: number) => void, cols: { id: string; label: string }[]): void {
    const row = table.createDiv({ cls: "feuillets-row feuillets-row-scene" });
    row.setAttr("data-path", file.path);
    if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(file.path)) {
      row.addClass("feuillets-multiselected");
    }
    /* Menu contextuel partagé du feuillet (même menu que Cartes/Binder) —
       jamais un menu parallèle. Un clic droit DANS un champ textuel éditable
       (input/textarea/select/contenteditable) n'ouvre pas le menu de ligne :
       le navigateur/Obsidian garde le menu natif du champ. La garde précède
       tout preventDefault. `binderIndex`/`siblings` restent Binder réels,
       même en tri global. */
    row.addEventListener("contextmenu", (e) => {
      if (this.isEditableContextTarget(e)) return;
      e.preventDefault();
      this.showFileContextMenu(e, file, parentFolder, binderIndex, siblings);
    });

    const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
    if (!this.outlineSortActive()) this.attachDragHandlers(handle, row, parentFolder, binderIndex, siblings, table);
    const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
    titleCell.style.paddingLeft = `${depth * 16}px`;
    /* §17-18 : le titre affiché reste shortTitleFor (distinction intacte).
       Un clic ouvre le feuillet (légère temporisation pour distinguer le
       double-clic) ; un double-clic édite le short_title inline (jamais le
       nom physique du fichier). */
    const titleSpan = titleCell.createSpan({ cls: "feuillets-title-text", text: this.plugin.shortTitleFor(file) });
    let singleClickTimer: number | ReturnType<typeof setTimeout> | null = null;
    titleSpan.addEventListener("click", (e) => {
      if (this.handleMultiSelectClick(e, file, parentFolder, binderIndex, siblings, table)) return;
      if (singleClickTimer) window.clearTimeout(singleClickTimer);
      singleClickTimer = window.setTimeout(() => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      }, this.outlineDblClickDelayMs);
    });
    titleSpan.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (singleClickTimer) {
        window.clearTimeout(singleClickTimer);
        singleClickTimer = null;
      }
      this.beginInlineShortTitleEdit(titleCell, titleSpan, file);
    });

    const wc = this.wcMap!.get(file.path) || 0;
    bumpTotal(wc);

    this.emptyCells(row, cols, {
      /* §2-3 LOT 4 : dans le Plan, une cellule Synopsis ou pov vide affiche
         « — » (même grammaire que la date vide), pas un placeholder texte.
         Le « — » reste cliquable et ouvre le vrai textarea vide. */
      synopsis: (cell) => this.makeClickToEditFmArea(cell, file, "synopsis", "—", 1),
      pov: (cell) => this.makeClickToEditFmArea(cell, file, "pov", "—", 1),
      /* Personnages + Fil du Plan : le MÊME mécanisme liste que le Chemin
         de fer (makeClickToEditFmList) — saisie CSV, normalisation existante,
         écriture vers la clé logique characters/thread (setFm, mappable),
         ordre conservé, valeur vide affichée « — ». */
      characters: (cell) => this.makeClickToEditFmList(cell, file, "characters", getPersonnagesList(this.fm(file)), () => this.render(true)),
      thread: (cell) => this.makeClickToEditFmList(cell, file, "thread", getFilsList(this.fm(file)), () => this.render(true)),
      summary: (cell) => this.makeClickToEditFmArea(cell, file, "summary", t("board.card.summaryPlaceholder"), 1),
      notes: (cell) => this.makeClickToEditFmArea(cell, file, "notes", t("board.outline.notesPlaceholder"), 1),
      tags: (cell) => this.makeTagsEditor(cell, file),
      label: (cell) => this.makeLabelSelect(cell, file),
      status: (cell) => this.makeStatusSelect(cell, file),
      date: (cell) => this.makeClickToEditFmArea(cell, file, "date", "—", 1),
      compile: (cell) => cell.setText(this.fm(file).compile !== false ? t("shared.yes") : t("shared.no")),
      filename: (cell) => cell.setText(file.basename),
      words: (cell) => cell.setText(String(wc)),
      /* Objectif : le MÊME helper que les autres éditeurs d'objectif du
         plugin (makeGoalInput) — input numérique min=0, placeholder =
         objectif projet par défaut, lecture de fm.goal, écriture via
         setFm(file, "goal", …). La cellule n'est plus un texte statique. */
      goal: (cell) => this.makeGoalInput(cell, file),
      progress: (cell) => {
        const ring = cell.createDiv({ cls: "feuillets-ring" });
        this.fillRing(ring, wc, this.goalFor(file));
      }
    });
  }

}

/** Modale de création d'une ligne Couloirs : un champ texte + bouton Créer.
   La saisie est envoyée à BoardView.createLane (registre de SESSION, jamais de
   YAML écrit — une ligne sans feuillet est légale, §8). `value` est une
   propriété normale et `submit()` est public pour que les tests (.js,
   checkJs:false) puissent piloter la modale sans passer par le DOM. */
export class NewLaneModal extends Modal {
  view: BoardView;
  axis: LaneAxis;
  /** Dernière valeur soumise — accessible aux tests directement. */
  value = "";

  constructor(app: import("obsidian").App, view: BoardView, axis: LaneAxis) {
    super(app);
    this.view = view;
    this.axis = axis;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("board.lanes.createLineTitle") });
    const input = contentEl.createEl("input", { type: "text", cls: "feuillets-input-full" });
    input.placeholder = this.placeholder();
    input.focus();
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") this.submit(input.value);
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("board.lanes.create") }).addEventListener("click", () => this.submit(input.value));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Applique la saisie : mémorise la valeur, délègue à createLane (qui valide
     vide/doublon et tient le registre), puis ferme. */
  submit(raw: string): void {
    this.value = raw;
    this.view.createLane(this.axis, raw);
    this.close();
  }

  private placeholder(): string {
    if (this.axis === "label") return t("board.lanes.newLabel");
    if (this.axis === "character") return t("board.lanes.newCharacter");
    if (this.axis === "thread") return t("board.lanes.newThread");
    return t("board.lanes.newPov");
  }
}
