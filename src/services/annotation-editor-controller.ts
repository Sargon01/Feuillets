import { MarkdownView, Notice, TFile, type App, type Menu } from "obsidian";
import {
  loadAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  annotationsForFile,
  resolveAnnotation,
  toManuscriptRelativePath,
  type Annotation,
  type AnnotationColor,
  type AnnotationStyle,
  type AnnotationsStore,
} from "./annotations.js";
import { getProjectFolder } from "./folder-structure.js";
import {
  applyAnnotationHighlights,
  clearAnnotationHighlights,
  coordsAtOffset,
  annotationIdAtOffset,
  annotationIdForExactRange,
  offsetAtCoords,
  type AnnotationHighlightInput,
  type AnnotationDecorationTarget,
  type AnchorRect,
  type EditorViewInstance as AnnotationEditorViewInstance,
  type AnnotationReadableEditorView,
} from "../utils/cm-annotation-highlighter.js";
import { openFileAndSelectRange } from "../utils/dom.js";
import type { FeuilletsEditorSurface } from "../utils/scrivenings-editor-adapter.js";
import { AnnotationPopover } from "../ui/annotation-popover.js";
import { t } from "../i18n/index.js";
import { presentationNoteAnchorAtOffset, type PresentationNoteAnchorTarget } from "./presentation-note-anchors.js";

/* CORRECTIF (« désengorger main.ts avant tout nouveau correctif ») —
 * PROPRIÉTAIRE de toute la logique « annotations dans un éditeur » :
 * création/modification/suppression, menu contextuel unique « Annotation… »,
 * rafraîchissement des surlignages du fichier actif. Le stockage persistant
 * reste dans services/annotations.ts (loadAnnotations/addAnnotation/…), les
 * décorations CodeMirror dans utils/cm-annotation-highlighter.ts (StateField,
 * et depuis ce chantier les deux lecteurs purs annotationIdAtOffset/
 * annotationIdForExactRange), l'UI dans ui/annotation-popover.ts — rien de
 * tout cela n'est dupliqué ici, seulement orchestré. Jamais de singleton
 * module-level, jamais d'import de main.ts (aucune dépendance circulaire) :
 * ce module ne connaît FeuilletsPlugin qu'à travers `AnnotationEditorControllerDeps`,
 * injecté une seule fois à la construction. */

/** Micro-correctif (« annotation créée non visible immédiatement en
 * Continu ») : callback OPTIONNEL exécuté APRÈS (jamais avant) une mutation
 * d'annotation réellement persistée. Le MarkdownView natif n'en fournit
 * jamais (repli sur `refreshActiveHighlights()`) ; Continu fournit
 * `() => view.refreshAnnotationHighlights()` (main.ts#showScriveningsContextMenu)
 * — jamais de watcher, jamais de polling : un simple relais explicite vers
 * la SEULE vue qui vient d'initier la mutation. */
export type AnnotationChangeCallback = () => void | Promise<void>;

/** CORRECTIF (empilement d'annotations au clic droit, puis lecture du
 * StateField) : contexte du menu contextuel « Annotation… », résolu UNE
 * SEULE FOIS — de façon SYNCHRONE et SANS AUCUNE mutation — avant que le
 * menu ne soit construit (voir `resolveContext`). Seul l'id est transporté
 * pour `existing` : l'objet `Annotation` complet n'est plus nécessaire, la
 * décoration visible EST déjà la preuve de son existence. */
export type AnnotationContext =
  | { kind: "selection" }
  | { kind: "existing"; id: string }
  | { kind: "none" };

/** Coordonnées visuelles (espace de l'EditorView CodeMirror interrogé, PAS
 * forcément l'espace du fichier réel) nécessaires à `resolveContext` :
 * `editorView` porte le `annotationHighlightField` déjà monté. Pour un
 * MarkdownView natif, ces coordonnées sont dérivées automatiquement par le
 * contrôleur (voir `visualCoordinatesForEditor`). Pour Continu, DONT
 * l'EditorView composite travaille dans un espace de coordonnées différent
 * du fichier réel (voir `ScriveningsSegmentEditorAdapter`), l'appelant
 * (main.ts#showScriveningsContextMenu) les construit lui-même à partir de
 * `context.compositeOffset`/`editorView.state.selection.main` et les
 * transmet explicitement — jamais de conversion silencieuse entre les deux
 * espaces ici. */
export interface AnnotationVisualCoordinates {
  editorView: AnnotationReadableEditorView;
  cursorOffset: number;
  selection?: { from: number; to: number };
}

/** Longueur du contexte avant/après une annotation (quote exceptée) —
 * partagée par la création (prefix/suffix initiaux) et le réancrage d'une
 * modification (voir `reanchorAnnotationPatch`) : un seul chiffre, jamais
 * deux longueurs de contexte qui pourraient diverger. */
const ANNOTATION_CONTEXT_LENGTH = 30;

/** Position de repli du popover d'annotation quand aucune ancre réelle n'a
 * pu être calculée (ex. « Modifier » depuis la page centralisée Annotations,
 * où aucune décoration n'est visible à l'écran) — un coin raisonnable
 * plutôt qu'un crash ou un refus d'ouvrir. Exportée : `openWorkNoteEditor`
 * (main.ts, notes de travail — hors périmètre de ce contrôleur) en a besoin
 * pour son propre repli, même valeur, jamais une seconde constante. */
export const DEFAULT_ANNOTATION_ANCHOR: AnchorRect = { left: 24, right: 24, top: 24, bottom: 24 };

/** Vrai seulement si la plage résolue de `annotation` dans `content`
 * correspond EXACTEMENT à `selection` (bornes strictement égales, jamais un
 * chevauchement) — le seul test utilisé par les deux verrous anti-doublon
 * (§16 avant ouverture du popover, §17 juste avant l'écriture). */
function exactAnnotationRangeMatch(
  annotation: Annotation,
  content: string,
  selection: { start: number; end: number }
): boolean {
  const range = resolveAnnotation(annotation, content);
  return !!range && range.start === selection.start && range.end === selection.end;
}

/**
 * Réancre une annotation EXISTANTE contre le texte ACTUEL de son fichier —
 * appelée à la sauvegarde (clic extérieur/Escape en modification, un
 * changement de couleur ou de style), jamais à la création, jamais pour une
 * annotation `unresolved` : si `resolveAnnotation` ne peut pas retrouver le
 * passage avec certitude, aucune position n'est inventée et cette fonction
 * ne modifie rien (`{}`, fusionné sans effet sur le patch appelant). Ne lit
 * que le fichier (jamais d'écriture Markdown) ; start/end/quote/prefix/suffix
 * sont recalculés à partir de CE contenu, jamais de celui capturé à
 * l'ouverture du popover — le texte a pu changer pendant qu'il restait
 * ouvert. */
async function reanchorAnnotationPatch(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  annotation: Annotation
): Promise<Partial<Omit<Annotation, "id">>> {
  const root = getProjectFolder(app, settings);
  const targetFile = root ? app.vault.getAbstractFileByPath(`${root.path}/${annotation.file}`) : null;
  if (!(targetFile instanceof TFile)) return {};
  const content = await (app.vault.cachedRead?.(targetFile) ?? app.vault.read(targetFile));
  const range = resolveAnnotation(annotation, content);
  if (!range) return {};
  return {
    start: range.start,
    end: range.end,
    quote: content.slice(range.start, range.end),
    prefix: content.slice(Math.max(0, range.start - ANNOTATION_CONTEXT_LENGTH), range.start),
    suffix: content.slice(range.end, Math.min(content.length, range.end + ANNOTATION_CONTEXT_LENGTH)),
  };
}

/** Dépendances injectées par FeuilletsPlugin (main.ts) — jamais un import de
 * FeuilletsPlugin lui-même (aucune dépendance circulaire). `getActiveEditor`/
 * `getActiveFile` restent la responsabilité du plugin (resp. `activeEditorAnywhere()`
 * et `app.workspace.getActiveFile()`), déjà génériques et utilisés hors
 * annotations. */
export interface AnnotationEditorControllerDeps {
  app: App;
  getSettings: () => FeuilletsSettings;
  getActiveEditor: () => FeuilletsEditorSurface | null;
  getActiveFile: () => TFile | null;
}

/** Propriétaire de toute la logique « annotations dans un éditeur » —
 * MarkdownView natif comme Continu. Pas de singleton, pas d'état
 * module-level (hormis les constantes pures ci-dessus) : chaque instance ne
 * connaît que ses `deps`, plus les préférences de session
 * `annotationMenuStyle`/`annotationMenuColor` (propriété d'instance, jamais
 * persistées — voir leur commentaire ci-dessous). */
export class AnnotationEditorController {
  /** Préférence de session NON persistée du menu contextuel « Annotation… »
   * (même comportement que la Barre historique) : style/couleur appliqués
   * au clic, jamais écrits dans les réglages. */
  annotationMenuStyle: AnnotationStyle = "highlight";
  annotationMenuColor: AnnotationColor = "yellow";

  constructor(private readonly deps: AnnotationEditorControllerDeps) {}

  private get app(): App {
    return this.deps.app;
  }

  private get settings(): FeuilletsSettings {
    return this.deps.getSettings();
  }

  /** L'instance EditorView de CodeMirror 6 (view.editor.cm) — même accès
   * non typé que main.ts#runAnalysisCommand pour applyGrammarHighlights :
   * `cm` n'est pas déclaré dans obsidian.d.ts. */
  annotationCmView(editor: FeuilletsEditorSurface | null): AnnotationEditorViewInstance | null {
    if (!editor) return null;
    const cm = (editor as unknown as Record<string, unknown>).cm;
    return (cm as AnnotationEditorViewInstance) ?? null;
  }

  /** Disponible seulement avec une sélection non vide, dans un fichier
   * Markdown du Manuscrit d'un projet Feuillets (voir
   * toManuscriptRelativePath) — jamais hors de ce sous-arbre. */
  canAnnotateSelection(): boolean {
    const editor = this.deps.getActiveEditor();
    if (!editor || !editor.somethingSelected()) return false;
    const file = this.deps.getActiveFile();
    return !!file && toManuscriptRelativePath(this.app, this.settings, file) !== null;
  }

  /** Duplique volontairement `FeuilletsPlugin#currentSelectionRange`
   * (main.ts) — celle-ci reste GÉNÉRIQUE (utilisée aussi par l'analyse de
   * texte, hors annotations) et n'a donc jamais été déplacée ici (voir le
   * commentaire d'extraction). Ce doublon local, purement dérivé de
   * `FeuilletsEditorSurface`, est trivial (3 lignes) et évite d'imposer une
   * dépendance supplémentaire pour un calcul aussi simple. */
  private selectionRange(editor: FeuilletsEditorSurface | null): { start: number; end: number } | null {
    if (!editor || !editor.somethingSelected()) return null;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return to > from ? { start: from, end: to } : null;
  }

  /** CORRECTIF (StateField comme source de vérité) : résout le contexte du
   * menu contextuel « Annotation… » (existing/selection/none) en lisant
   * UNIQUEMENT les décorations déjà montées dans `annotationHighlightField`
   * (`annotationIdForExactRange`/`annotationIdAtOffset`,
   * utils/cm-annotation-highlighter.ts) — jamais `annotations.json`, jamais
   * de cache miroir, jamais de DOM. Priorité EXACTE du contrat : une
   * sélection non vide dont la décoration correspond EXACTEMENT à ses
   * bornes → `existing` (jamais un doublon par-dessus) ; sinon une
   * sélection non vide → `selection` ; sans sélection, une décoration sous
   * le curseur ([from, to)) → `existing` ; sinon → `none`. */
  resolveContext(visualCoordinates: AnnotationVisualCoordinates | null): AnnotationContext {
    if (!visualCoordinates) return { kind: "none" };
    const { editorView, cursorOffset, selection } = visualCoordinates;
    if (selection && selection.to > selection.from) {
      const id = annotationIdForExactRange(editorView, selection.from, selection.to);
      return id ? { kind: "existing", id } : { kind: "selection" };
    }
    const id = annotationIdAtOffset(editorView, cursorOffset);
    return id ? { kind: "existing", id } : { kind: "none" };
  }

  /** Coordonnées visuelles PAR DÉFAUT pour un éditeur MarkdownView natif —
   * dérivées de son EditorView CodeMirror réel (même espace de coordonnées
   * que le fichier). Continu ne passe JAMAIS par ici : il construit ses
   * propres coordonnées composites et les transmet explicitement à
   * `addContextMenuItem` (voir `AnnotationVisualCoordinates`, §13 du
   * contrat). */
  private visualCoordinatesForEditor(editor: FeuilletsEditorSurface): AnnotationVisualCoordinates | null {
    const cm = this.annotationCmView(editor);
    if (!cm) return null;
    const range = this.selectionRange(editor);
    return {
      editorView: cm,
      cursorOffset: editor.posToOffset(editor.getCursor()),
      selection: range ? { from: range.start, to: range.end } : undefined,
    };
  }

  /** MICRO-CORRECTIF (« Annotation… » ne doit jamais quitter Continu) :
   * calcule une ancre visuelle à partir de coordonnées DÉJÀ résolues —
   * jamais une nouvelle API DOM, uniquement `coordsAtOffset` (API PUBLIQUE
   * CodeMirror, déjà utilisée par `createAnnotationFromSelection`
   * ci-dessous pour son propre popover de création). Même choix de borne :
   * `selection.to` en priorité (sélection non vide), sinon `selection.from`,
   * sinon le curseur. `undefined` si aucune ne se résout — jamais de
   * position inventée : l'appelant retombe alors sur son propre repli
   * (`DEFAULT_ANNOTATION_ANCHOR`/navigation vers le fichier source pour un
   * appelant réellement sans ancre, ex. la liste centralisée Annotations).
   * Le cast vers `AnnotationEditorViewInstance` est sûr : le VRAI EditorView
   * CodeMirror (MarkdownView comme composite Continu) expose toujours
   * `coordsAtPos`, seul le typage local `AnnotationReadableEditorView`
   * (lecture du StateField uniquement) ne le déclare pas. */
  private anchorFromVisualCoordinates(
    visualCoordinates: AnnotationVisualCoordinates | null | undefined
  ): AnchorRect | undefined {
    if (!visualCoordinates) return undefined;
    const { editorView, cursorOffset, selection } = visualCoordinates;
    const cm = editorView as unknown as AnnotationEditorViewInstance;
    if (selection && selection.to > selection.from) {
      return coordsAtOffset(cm, selection.to) ?? coordsAtOffset(cm, selection.from) ?? undefined;
    }
    return coordsAtOffset(cm, cursorOffset) ?? undefined;
  }

  /** Construit l'entrée UNIQUE « Annotation… » du menu contextuel de
   * l'éditeur (MarkdownView comme Continu) : ZÉRO mutation, ZÉRO refresh,
   * ZÉRO lecture de `annotations.json` PENDANT cette construction —
   * `resolveContext` est purement synchrone sur le StateField déjà monté.
   * Le `onClick` ne fait QUE lire ce contexte déjà tranché : `existing` →
   * `openAnnotationEditor` ; `selection` → `createAnnotationFromSelection` ;
   * `none` → entrée désactivée, jamais atteinte par un clic réel. Jamais de
   * routeur générique relu au clic (c'est précisément ce qui permettait un
   * doublon avant ce chantier).
   *
   * MICRO-CORRECTIF (Continu) : `visualAnchor`, calculée depuis les MÊMES
   * `visualCoordinates` que la résolution du contexte, est transmise à
   * `openAnnotationEditor` (existing) et à `createAnnotationFromSelection`
   * (son verrou anti-doublon, §9) — sans elle, un `id` `existing` trouvé
   * dans Continu ouvrirait son popover via le fallback générique
   * (navigation vers le fichier Markdown source), ce qui est interdit ici. */
  addContextMenuItem(
    menu: Menu,
    editor: FeuilletsEditorSurface,
    file: TFile,
    options?: {
      onAnnotationChange?: AnnotationChangeCallback;
      visualCoordinates?: AnnotationVisualCoordinates | null;
      /** Point ÉCRAN du clic droit qui a ouvert ce menu. Indispensable
       * pour « Ajouter une note de présentation » : un clic droit ne
       * déplace PAS le curseur, donc sans lui l'entrée décrirait l'endroit
       * où le curseur avait été laissé, et non le titre/l'image/le callout
       * réellement visé (il fallait alors « entrer » d'abord dans
       * l'élément d'un clic gauche). Absent → repli sur le curseur. */
      pointerCoordinates?: { x: number; y: number } | null;
    }
  ): void {
    const visualCoordinates = options?.visualCoordinates ?? this.visualCoordinatesForEditor(editor);
    // Sans coordonnées visuelles disponibles (pas d'EditorView CodeMirror
    // résolue — jamais le cas en production pour un MarkdownView/Continu
    // réel), repli sur la seule heuristique sûre sans lecture async :
    // sélection non vide → `selection`, sinon `none` — jamais `existing`
    // sans preuve.
    const context = visualCoordinates
      ? this.resolveContext(visualCoordinates)
      : ({ kind: editor.somethingSelected() ? "selection" : "none" } as AnnotationContext);
    const onAnnotationChange = options?.onAnnotationChange;
    const visualAnchor = this.anchorFromVisualCoordinates(visualCoordinates);

    menu.addItem((item) => {
      item.setTitle(t("editorMenu.annotation")).setIcon("highlighter");
      if (context.kind === "none") {
        item.setDisabled(true);
      }
      item.onClick(() => {
        if (context.kind === "existing") {
          void this.openAnnotationEditor(context.id, onAnnotationChange ? () => void onAnnotationChange() : undefined, visualAnchor);
        } else if (context.kind === "selection") {
          void this.createAnnotationFromSelection(
            editor,
            file,
            { style: this.annotationMenuStyle, color: this.annotationMenuColor },
            onAnnotationChange,
            visualAnchor
          );
        }
        // "none" : entrée désactivée, jamais atteinte par un clic réel.
      });
    });

    // Création SANS sélection sur un titre/image/callout — UNIQUEMENT
    // quand aucune sélection n'est active et qu'aucune annotation
    // n'existe déjà sous le curseur (context.kind === "none") : une
    // sélection reste TOUJOURS prioritaire (voir createAnnotationFromSelection
    // ci-dessus), jamais concurrencée par cette entrée. Détection PURE,
    // aucun DOM (voir presentation-note-anchors.ts) — sur `editor.getValue()`/
    // `editor.posToOffset(editor.getCursor())`, la MÊME source que
    // `selectionRange` ci-dessus (fonctionne donc identiquement pour un
    // MarkdownView natif comme pour Continu, sans second calcul de
    // coordonnées composite).
    if (context.kind === "none") {
      const target = this.presentationNoteTargetForEditor(editor, options?.pointerCoordinates);
      if (target) {
        menu.addItem((item) => {
          item.setTitle(t("editorMenu.addPresentationNote")).setIcon("presentation");
          item.onClick(() => {
            void this.createPresentationNoteFromTarget(editor, file, target, onAnnotationChange, visualAnchor);
          });
        });
      }
    }
  }

  /** Détection PURE (voir presentation-note-anchors.ts) de la cible titre/
   * image/callout VISÉE — jamais de DOM, jamais de mutation.
   *
   * La position vient EN PRIORITÉ du point du clic droit
   * (`posAtCoords`, API publique CodeMirror) : un clic droit ne déplace pas
   * le curseur, donc s'appuyer sur `getCursor()` obligeait à cliquer
   * d'abord DANS le callout/titre/image pour l'y amener. Le curseur reste
   * le repli quand aucune coordonnée n'est disponible (commande de palette,
   * éditeur sans `posAtCoords`). */
  private presentationNoteTargetForEditor(
    editor: FeuilletsEditorSurface,
    pointerCoordinates?: { x: number; y: number } | null,
  ): PresentationNoteAnchorTarget | null {
    const content = editor.getValue();
    const pointerOffset = offsetAtCoords(this.annotationCmView(editor), pointerCoordinates);
    const offset = pointerOffset ?? editor.posToOffset(editor.getCursor());
    return presentationNoteAnchorAtOffset(content, offset);
  }

  /**
   * Crée une note de présentation SANS sélection, sur la cible (titre,
   * image ou callout) déjà détectée par `presentationNoteTargetForEditor` —
   * même `Annotation` + `SourceAnchor` que `createAnnotationFromSelection`
   * ci-dessus (jamais un second type d'annotation), avec `presentationNote`
   * TOUJOURS vrai dès l'ouverture et les contrôles couleur/style MASQUÉS
   * (`showColors`/`showStyles: false` — voir §3 du contrat : une note de
   * présentation n'est jamais décorée dans la source). Mêmes verrous
   * anti-doublon (§16/§17) que `createAnnotationFromSelection`.
   */
  async createPresentationNoteFromTarget(
    editor: FeuilletsEditorSurface,
    file: TFile,
    target: PresentationNoteAnchorTarget,
    onAnnotationChange: AnnotationChangeCallback = () => this.refreshActiveHighlights(),
    existingAnchor?: AnchorRect | AnnotationDecorationTarget
  ): Promise<void> {
    const relPath = toManuscriptRelativePath(this.app, this.settings, file);
    if (relPath === null) {
      new Notice(t("annotation.notice.noSelection"));
      return;
    }
    const content = editor.getValue();
    if (target.start < 0 || target.end > content.length || target.start >= target.end) return;
    const quote = content.slice(target.start, target.end);
    const prefix = content.slice(Math.max(0, target.start - ANNOTATION_CONTEXT_LENGTH), target.start);
    const suffix = content.slice(target.end, Math.min(content.length, target.end + ANNOTATION_CONTEXT_LENGTH));

    try {
      const store = await loadAnnotations(this.app, this.settings);
      const preExisting = store.annotations.find(
        (a) => a.file === relPath && exactAnnotationRangeMatch(a, content, target)
      );
      if (preExisting) {
        await this.openAnnotationEditor(preExisting.id, onAnnotationChange ? () => void onAnnotationChange() : undefined, existingAnchor);
        return;
      }
    } catch {
      // JSON corrompu : la création normale ci-dessous ira jusqu'à
      // addAnnotation, qui lèvera à son tour — jamais un échec silencieux.
    }

    const cm = this.annotationCmView(editor);
    const anchor =
      coordsAtOffset(cm, target.end) ??
      coordsAtOffset(cm, target.start) ??
      existingAnchor ??
      DEFAULT_ANNOTATION_ANCHOR;

    new AnnotationPopover({
      parentEl: document.body,
      anchor,
      text: "",
      color: "yellow",
      style: "highlight",
      presentationNote: true,
      showPresentationNote: true,
      showColors: false,
      showStyles: false,
      cancelOnEscape: true,
      onSave: async (text, color, style, presentationNote) => {
        let raceExisting: Annotation | null = null;
        try {
          const store = await loadAnnotations(this.app, this.settings);
          raceExisting =
            store.annotations.find((a) => a.file === relPath && exactAnnotationRangeMatch(a, content, target)) ?? null;
        } catch {
          raceExisting = null;
        }
        if (raceExisting) {
          await updateAnnotation(this.app, this.settings, raceExisting.id, { text, color, style, presentationNote });
        } else {
          await addAnnotation(this.app, this.settings, {
            file: relPath,
            start: target.start,
            end: target.end,
            quote,
            prefix,
            suffix,
            text,
            color,
            style,
            presentationNote,
          });
        }
        await onAnnotationChange();
      },
    }).open();
  }

  /** Capture le texte sélectionné, ses offsets et un peu de contexte
   * avant/après (utilisés par resolveAnnotation si le texte bouge un peu
   * plus tard), puis ouvre le popover ancré près de la sélection —
   * n'écrit dans annotations.json qu'à la fermeture du popover (voir
   * AnnotationPopover.close), jamais avant, jamais dans le Markdown.
   * `cancelOnEscape: true` : Escape sur une création ANNULE, aucune
   * annotation vide n'est créée — un clic extérieur, lui, sauvegarde
   * toujours (voir le contrat de AnnotationPopover).
   *
   * VERROU ANTI-DOUBLON (§16-17 du contrat) : le menu contextuel n'est pas
   * la seule défense. AVANT d'ouvrir un popover de CRÉATION, on recharge le
   * store et on cherche une annotation EXACTE sur cette plage — si elle
   * existe déjà (ex. décoration pas encore visible/StateField pas encore
   * remonté), on ouvre directement son éditeur au lieu d'empiler un
   * doublon. Une seconde vérification a lieu juste avant `addAnnotation`,
   * dans `onSave` : la fenêtre entre l'ouverture du popover et la
   * sauvegarde peut avoir vu une autre action créer la même annotation —
   * dans ce cas, `onSave` MET À JOUR l'existante au lieu d'en ajouter une
   * seconde. Cette vérification ne se produit qu'AU SAVE, jamais à chaque
   * changement de couleur/style dans la carte.
   *
   * MICRO-CORRECTIF (Continu) : `anchor` — OPTIONNEL — est l'ancre visuelle
   * DÉJÀ calculée par l'appelant (voir `addContextMenuItem`), transmise
   * UNIQUEMENT au verrou §16 ci-dessous (l'`openAnnotationEditor` du cas
   * « exacte déjà existante ») : même si le StateField n'avait pas identifié
   * l'existante avant le clic (contexte résolu `selection`), ce second
   * verrou métier ne doit jamais faire basculer Continu vers le fichier
   * source. Le calcul d'ancre du popover de CRÉATION lui-même, juste
   * en-dessous, reste STRICTEMENT inchangé — aucun second calcul
   * concurrent. */
  async createAnnotationFromSelection(
    editorOverride?: FeuilletsEditorSurface,
    fileOverride?: TFile,
    initial?: { style?: AnnotationStyle; color?: AnnotationColor; presentationNote?: boolean },
    onAnnotationChange: AnnotationChangeCallback = () => this.refreshActiveHighlights(),
    existingAnchor?: AnchorRect | AnnotationDecorationTarget
  ): Promise<void> {
    const editor = editorOverride ?? this.deps.getActiveEditor();
    const file = fileOverride ?? this.deps.getActiveFile();
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    const selection = this.selectionRange(editor);
    if (!editor || relPath === null || !selection) {
      new Notice(t("annotation.notice.noSelection"));
      return;
    }

    const content = editor.getValue();
    const quote = content.slice(selection.start, selection.end);
    const prefix = content.slice(Math.max(0, selection.start - ANNOTATION_CONTEXT_LENGTH), selection.start);
    const suffix = content.slice(selection.end, Math.min(content.length, selection.end + ANNOTATION_CONTEXT_LENGTH));

    // VERROU §16 : une annotation EXACTE existe déjà sur cette plage →
    // éditer l'existante (avec l'ancre Continu déjà connue, s'il y en a
    // une), jamais un second popover de création par-dessus.
    try {
      const store = await loadAnnotations(this.app, this.settings);
      const preExisting = store.annotations.find(
        (a) => a.file === relPath && exactAnnotationRangeMatch(a, content, selection)
      );
      if (preExisting) {
        await this.openAnnotationEditor(preExisting.id, onAnnotationChange ? () => void onAnnotationChange() : undefined, existingAnchor);
        return;
      }
    } catch {
      // JSON corrompu : la création normale ci-dessous ira jusqu'à
      // addAnnotation, qui lèvera à son tour — jamais un échec silencieux.
    }

    const cm = this.annotationCmView(editor);
    const anchor =
      coordsAtOffset(cm, selection.end) ??
      coordsAtOffset(cm, selection.start) ??
      DEFAULT_ANNOTATION_ANCHOR;

    new AnnotationPopover({
      parentEl: document.body,
      anchor,
      text: "",
      color: initial?.color ?? "yellow",
      style: initial?.style ?? "highlight",
      showPresentationNote: true,
      presentationNote: initial?.presentationNote ?? false,
      cancelOnEscape: true,
      onSave: async (text, color, style, presentationNote) => {
        // VERROU §17 : dernière vérification, juste avant l'écriture — une
        // autre action a pu créer l'exacte même annotation pendant que ce
        // popover restait ouvert.
        let raceExisting: Annotation | null = null;
        try {
          const store = await loadAnnotations(this.app, this.settings);
          raceExisting =
            store.annotations.find((a) => a.file === relPath && exactAnnotationRangeMatch(a, content, selection)) ??
            null;
        } catch {
          raceExisting = null;
        }
        // Micro-correctif : la mutation DOIT être persistée (await terminé)
        // AVANT tout refresh — jamais avant, jamais pendant que le popover
        // est encore ouvert (§7-9 du contrat historique).
        if (raceExisting) {
          await updateAnnotation(this.app, this.settings, raceExisting.id, { text, color, style, presentationNote });
        } else {
          await addAnnotation(this.app, this.settings, {
            file: relPath,
            start: selection.start,
            end: selection.end,
            quote,
            prefix,
            suffix,
            text,
            color,
            style,
            presentationNote,
          });
        }
        await onAnnotationChange();
      },
    }).open();
  }

  /** Annotation visuelle IMMÉDIATE : enregistre l'annotation sur la
   *  sélection avec la préférence de session, sans popover obligatoire ; si
   *  une annotation existante recouvre EXACTEMENT la sélection, elle est
   *  MODIFIÉE (jamais de doublon de stockage). Retourne false (avec notice)
   *  sans sélection, hors manuscrit, ou sur écriture impossible — jamais
   *  d'exception. Conservée pour compatibilité (commande palette, tests
   *  ciblés) : le menu contextuel route directement via `addContextMenuItem`
   *  ci-dessus, qui ne l'appelle jamais. */
  async applyAnnotationOrUpdate(
    editor: FeuilletsEditorSurface,
    file: TFile,
    style: AnnotationStyle,
    color: AnnotationColor,
    onAnnotationChange: AnnotationChangeCallback = () => this.refreshActiveHighlights()
  ): Promise<boolean> {
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    const selection = this.selectionRange(editor);
    if (relPath === null || !selection || selection.start === selection.end) {
      new Notice(t("annotation.notice.noSelection"));
      return false;
    }
    const content = editor.getValue();
    const quote = content.slice(selection.start, selection.end);
    const prefix = content.slice(Math.max(0, selection.start - ANNOTATION_CONTEXT_LENGTH), selection.start);
    const suffix = content.slice(selection.end, Math.min(content.length, selection.end + ANNOTATION_CONTEXT_LENGTH));
    try {
      const store = await loadAnnotations(this.app, this.settings);
      const existing = store.annotations.find(
        (a) => a.file === relPath && exactAnnotationRangeMatch(a, content, selection)
      );
      if (existing) {
        await updateAnnotation(this.app, this.settings, existing.id, { color, style });
      } else {
        await addAnnotation(this.app, this.settings, {
          file: relPath,
          start: selection.start,
          end: selection.end,
          quote,
          prefix,
          suffix,
          text: "",
          color,
          style,
        });
      }
    } catch {
      new Notice(t("annotation.notice.corrupted"));
      return false;
    }
    // Mutation persistée avec succès (try ci-dessus terminé sans lever) :
    // c'est SEULEMENT maintenant que le refresh a lieu.
    await onAnnotationChange();
    return true;
  }

  /** « Ajouter / modifier un commentaire… » : sélection → nouveau
   *  commentaire (popover, style/couleur initiaux) ; sinon une annotation
   *  existante dont l'ancre recouvre le curseur → modification
   *  (openAnnotationEditor) ; sinon rien à commenter. Conservée pour
   *  compatibilité (§8 du correctif précédent) : le menu contextuel ne
   *  l'appelle plus jamais (elle re-résoudrait la sélection/le curseur AU
   *  CLIC, source du bug de doublon corrigé précédemment) — `addContextMenuItem`
   *  route directement vers `openAnnotationEditor`/`createAnnotationFromSelection`. */
  async openAnnotationCommentForContext(
    editor: FeuilletsEditorSurface,
    file: TFile,
    style: AnnotationStyle,
    color: AnnotationColor,
    onAnnotationChange?: AnnotationChangeCallback
  ): Promise<void> {
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    if (relPath === null) {
      new Notice(t("annotation.notice.noSelection"));
      return;
    }
    const selection = this.selectionRange(editor);
    if (selection && selection.start !== selection.end) {
      await this.createAnnotationFromSelection(editor, file, { style, color }, onAnnotationChange);
      return;
    }
    try {
      const store = await loadAnnotations(this.app, this.settings);
      const content = editor.getValue();
      const offset = editor.posToOffset(editor.getCursor());
      const candidate = store.annotations.find((annotation) => {
        if (annotation.file !== relPath) return false;
        const range = resolveAnnotation(annotation, content);
        // La range est [start, end) : le curseur sur end n'est pas contenu.
        return range ? offset >= range.start && offset < range.end : false;
      });
      if (!candidate) {
        new Notice(t("annotation.notice.noSelection"));
        return;
      }
      await this.openAnnotationEditor(candidate.id, onAnnotationChange ? () => void onAnnotationChange() : undefined);
    } catch {
      new Notice(t("annotation.notice.corrupted"));
    }
  }

  /** Ouvre le popover en modification pour l'annotation `id`, près de
   * `anchor` — appelé par le double-clic sur une décoration
   * (annotationDoubleClickExtension, qui transmet l'élément décoré comme
   * ancre) et par l'action « Modifier » de la page centralisée Annotations
   * (NotesView.renderAnnotationRow, sans ancre : repli sur
   * DEFAULT_ANNOTATION_ANCHOR). `onChange` est un point d'extension MINIMAL
   * pour ce second appelant : NotesView n'a besoin de rien de plus que
   * d'être prévenue une fois la sauvegarde/suppression effectuée, pour
   * rerendre sa propre liste — le popover, la persistance
   * (update/deleteAnnotation) et le rafraîchissement CodeMirror restent
   * ICI, jamais dupliqués ailleurs. */
  async openAnnotationEditor(
    id: string,
    onChange?: () => void,
    anchor?: AnchorRect | AnnotationDecorationTarget
  ): Promise<void> {
    let store: AnnotationsStore;
    try {
      store = await loadAnnotations(this.app, this.settings);
    } catch {
      new Notice(t("annotation.notice.corrupted"));
      return;
    }
    const annotation = store.annotations.find((a) => a.id === id);
    if (!annotation) return;

    let resolvedAnchor = anchor;
    if (!resolvedAnchor) {
      const root = getProjectFolder(this.app, this.settings);
      const targetFile = root ? this.app.vault.getAbstractFileByPath(`${root.path}/${annotation.file}`) : null;
      if (targetFile instanceof TFile && this.app.workspace.getLeaf) {
        const content = await (this.app.vault.cachedRead?.(targetFile) ?? this.app.vault.read(targetFile));
        const range = resolveAnnotation(annotation, content);
        if (range) {
          await openFileAndSelectRange(this.app, this.app.workspace.getLeaf(false), targetFile, range.start, range.end);
          await this.refreshActiveHighlights();
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-annotation-id="${CSS.escape(id)}"]`));
          resolvedAnchor =
            candidates.find((el) => {
              const r = el.getBoundingClientRect();
              return r.bottom > 0 && r.top < window.innerHeight;
            }) ??
            // Aucune décoration à viser : c'est le cas NORMAL d'une note de
            // présentation, qui n'est jamais surlignée dans la source (§3).
            // Le passage vient pourtant d'être navigué et sélectionné —
            // `coordsAtOffset` (API publique CodeMirror, déjà utilisée par
            // la création) donne donc sa position à l'écran. Sans cela, le
            // popover retombait sur DEFAULT_ANNOTATION_ANCHOR, c'est-à-dire
            // le coin haut-gauche de la fenêtre, loin de la note.
            coordsAtOffset(this.annotationCmView(this.deps.getActiveEditor()), range.start) ??
            this.app.workspace.getActiveViewOfType(MarkdownView)?.contentEl.querySelector<HTMLElement>(".cm-editor") ??
            undefined;
        }
      }
    }
    new AnnotationPopover({
      parentEl: document.body,
      anchor: resolvedAnchor ?? DEFAULT_ANNOTATION_ANCHOR,
      text: annotation.text,
      color: annotation.color,
      style: annotation.style ?? "highlight",
      showPresentationNote: true,
      presentationNote: annotation.presentationNote ?? false,
      // §3 du contrat : une note de présentation n'affiche jamais les
      // contrôles couleur/style (elle n'est jamais décorée dans la
      // source) — comportement STRICTEMENT inchangé pour une annotation
      // normale (showColors/showStyles restent `true` par défaut, voir
      // ui/annotation-popover.ts).
      showColors: annotation.presentationNote !== true,
      showStyles: annotation.presentationNote !== true,
      onStyleChange: async (style) => {
        await updateAnnotation(this.app, this.settings, id, { style, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshActiveHighlights();
      },
      onColorChange: async (color) => {
        await updateAnnotation(this.app, this.settings, id, { color, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshActiveHighlights();
      },
      onSave: async (text, color, style, presentationNote) => {
        await updateAnnotation(this.app, this.settings, id, { text, color, style, presentationNote, ...(await reanchorAnnotationPatch(this.app, this.settings, annotation)) });
        await this.refreshActiveHighlights();
        onChange?.();
      },
      onDelete: async () => {
        await deleteAnnotation(this.app, this.settings, id);
        await this.refreshActiveHighlights();
        onChange?.();
      },
    }).open();
  }

  /** Recharge les annotations du fichier actif, les résout avec
   * resolveAnnotation() et transmet uniquement les annotations résolues au
   * highlighter — nettoie si le fichier n'a aucune annotation ou n'est pas
   * dans le Manuscrit. Appelé au changement de fichier/feuillet actif
   * seulement (voir main.ts#registerAnnotationHighlightSync) : jamais à
   * chaque frappe, CodeMirror mappe déjà les décorations existantes via
   * tr.changes. Aucun cache à invalider : il n'en existe plus (voir
   * SUPPRESSION DU CACHE, compte rendu). */
  async refreshActiveHighlights(): Promise<void> {
    const editor = this.deps.getActiveEditor();
    const cm = this.annotationCmView(editor);
    if (!cm) return;

    const file = this.deps.getActiveFile();
    const relPath = file ? toManuscriptRelativePath(this.app, this.settings, file) : null;
    if (relPath === null) {
      clearAnnotationHighlights(cm);
      return;
    }

    let store: AnnotationsStore;
    try {
      store = await loadAnnotations(this.app, this.settings);
    } catch {
      clearAnnotationHighlights(cm);
      return;
    }

    // §3 du contrat : une note de présentation n'est JAMAIS décorée dans la
    // source (aucune couleur, aucun surlignage, aucun soulignement) — son
    // ancre continue d'être résolue normalement (resolveAnnotation), seule
    // sa DÉCORATION visuelle est exclue ici. Annotations normales
    // inchangées.
    const list = annotationsForFile(store, relPath).filter((a) => a.presentationNote !== true);
    if (list.length === 0) {
      clearAnnotationHighlights(cm);
      return;
    }

    const content = editor ? editor.getValue() : "";
    const inputs: AnnotationHighlightInput[] = list.map((a) => ({
      id: a.id,
      color: a.color,
      style: a.style ?? "highlight",
      range: resolveAnnotation(a, content),
    }));
    applyAnnotationHighlights(cm, inputs);
  }
}
