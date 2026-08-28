import { Notice, TFolder, TFile } from "obsidian";
import type { App, EventRef, Menu, TAbstractFile } from "obsidian";
import { t } from "../i18n/index.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { canvasPathFor, type CanvasData, type CanvasNode } from "../services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "../ui/canvas-chapter-modal.js";
import { CanvasSplitModal } from "../ui/canvas-split-modal.js";
import { CanvasMergeModal, type MergeRow } from "../ui/canvas-merge-modal.js";
import { applySelectedIdeas, deriveTitle, firstMeaningfulLine, type BridgeMode } from "../services/canvas-bridge.js";
import { ensureNotebookResearchFolder } from "../services/research.js";
import {
  admissibleChapterNodes,
  makeManuscriptPathChecker,
  nodesContainedInGroup,
} from "../services/canvas-chapter.js";
import {
  isIdeaTreeNode,
} from "../services/canvas-idea-tree.js";
import { splitTextNode, executeMerge } from "../services/canvas-split-merge.js";
import { titleFor } from "../services/frontmatter.js";
import type { CanvasPointerLikeEvent, MinimalRuntimeCanvas, MinimalRuntimeNode } from "../services/canvas-runtime.js";
import type { KeymapEventHandler, KeymapEventListener, Modifier } from "obsidian";
import { addMindmapChild, addMindmapSibling, outdentMindmapNode, reparentMindmapNodeByDrop } from "../carnet/blocks/mindmap/mindmap.js";
import { createCarnetFileNode, feuilletsFileDragPath } from "../carnet/canvas/adapter.js";
import { isMindmapMemberNode, mindmapSubtree } from "../carnet/blocks/mindmap/model.js";
import { canReparentByDrop } from "../carnet/blocks/mindmap/interactions.js";
import { isFeuilletsOwnedNode } from "../carnet/canvas/owned-nodes.js";

/* Intégration OPTIONNELLE avec Advanced Canvas (Developer-Mike/obsidian-
 * advanced-canvas). Feuillets ne dépend d'AUCUN module npm de ce plugin, ne
 * l'importe jamais à l'exécution et ne copie aucun de ses fichiers — cette
 * interface locale décrit UNIQUEMENT la portion de son contrat public
 * réellement utilisée ici, vérifiée contre son dépôt (version auditée :
 * 6.5.0, src/@types/CustomWorkspaceEvents.d.ts et src/@types/Canvas.d.ts) :
 *
 *   - événement 'canvas:selection-menu' : (menu: Menu, canvas: Canvas) => void
 *   - événement 'canvas:node-menu' : (menu: Menu, node: CanvasNode) => void —
 *     Advanced Canvas l'utilise lui-même sous cette forme exacte.
 *   - canvas.getSelectionData() : SelectionData (nodes/edges sélectionnés)
 *   - node.canvas : Canvas — chaque CanvasElement porte une référence vers
 *     son Canvas (confirmé dans Canvas.d.ts), donc le node-menu réutilise
 *     exactement le même Canvas (mêmes getData/setData/requestSave) que le
 *     selection-menu, sans accès à quoi que ce soit de non audité.
 *   - node.getData() : CanvasNodeData — mêmes champs (id/type/text/…) que
 *     ceux déjà lus via getSelectionData().
 *   - canvas.getData() / canvas.setData() / canvas.requestSave() : API native
 *     du Canvas d'Obsidian (pas spécifique à Advanced Canvas — présente sur
 *     toute vue Canvas, patchée mais pas remplacée par Advanced Canvas), déjà
 *     utilisée par Advanced Canvas lui-même pour ses propres mutations.
 *
 * Si Advanced Canvas est absent, ces événements personnalisés ne sont
 * jamais émis : `registerAdvancedCanvasIntegration` reste un
 * `app.workspace.on(...)` inerte, jamais une erreur, jamais une
 * fonctionnalité principale désactivée. */

type FeuilletsCanvasNodeSelectionData = CanvasNode;
type FeuilletsCanvasSelectionData = { nodes?: FeuilletsCanvasNodeSelectionData[] };

/** Sous-ensemble structurel du `Canvas` d'Advanced Canvas réellement utilisé
 * ici. `getData`/`setData`/`requestSave` sont optionnels dans ce type local :
 * s'ils manquent à l'exécution (version future incompatible, hôte
 * différent…), le code bascule sur le repli disque plutôt que de supposer
 * leur présence — voir `applyViaBridge`.
 *
 * Intersecté avec `MinimalRuntimeCanvas` (services/canvas-runtime.ts) : le
 * VRAI objet Canvas transmis par les événements `canvas:*-menu` expose EN
 * MÊME TEMPS la couche JSON (getData/setData/importData/requestSave) ET la
 * couche INSTANCES (nodes/createFileNode/removeNode/getEdgesForNode) — un
 * seul type ici pour ne jamais dupliquer le contrat, `canvas-runtime.ts`
 * reste la source de vérité pour la couche instances (aussi utilisée seule
 * par les services purs canvas-bridge.ts/canvas-chapter.ts, qui ne
 * dépendent jamais de ce fichier). */
export type MinimalAdvancedCanvas = MinimalRuntimeCanvas & {
  /** `scope` est le `Scope` Obsidian PUBLIC de la vue Canvas (`View.scope`,
   * natif — pas spécifique à Advanced Canvas), utilisé pour les raccourcis
   * Tab/Entrée/Shift+Tab de la Mindmap. Jamais de listener
   * document/window/wrapperEl — voir `registerMindmapKeymap`. */
  view?: { file?: TFile | null; scope?: MinimalCanvasScope };
  getSelectionData?: () => FeuilletsCanvasSelectionData;
  getData?: () => CanvasData;
  setData?: (data: CanvasData) => void;
  /** CORRECTIF file-node-runtime (historique) : `setData` seul ne fait que
   * réappliquer `nodeData` sur l'instance runtime DÉJÀ présente pour cet id
   * — elle ne recrée JAMAIS l'instance, donc ne change JAMAIS sa classe.
   * `importData(data, true)` a été tenté comme correctif (reconstruction
   * complète depuis le JSON, mécanisme déjà utilisé par Advanced Canvas
   * lui-même après undo/redo) mais s'est révélé INSUFFISANT à l'usage réel
   * dans Obsidian : le remplacement de classe TextNode→FileNode nécessite
   * le vrai mécanisme create/remove (voir services/canvas-runtime.ts,
   * `replaceTextNodeWithFileNode`, désormais le SEUL chemin qui matérialise
   * un vrai file node). `importData`/`setData` restent utilisés ici
   * uniquement comme filet de sécurité pour les mises à jour de CHAMPS sur
   * une instance déjà de la bonne classe (déplacement d'une fiche Recherche
   * déjà file node, par exemple) — jamais comme mécanisme de changement de
   * type. Optionnel et défensif comme le reste de ce type, jamais supposé
   * présent. */
  importData?: (data: CanvasData, clearCanvas?: boolean, silent?: boolean) => void;
  requestSave?: () => void;
};

/** Persiste `data` sur un Canvas Advanced Canvas déjà ouvert — TOUJOURS via
 * `importData(data, true)` quand disponible (reconstruit les instances
 * runtime depuis le JSON, honore un `type` changé), sinon repli sur
 * `setData(data)` (compatibilité si `importData` venait à manquer — contrat
 * optionnel, jamais supposé). Point UNIQUE de sauvegarde live, réutilisé par
 * `applyViaBridge`, `applyNodeDirectly` et `livePersist` (Lot 2) — jamais
 * dupliqué, voir tête de fichier. */
function persistCanvasData(canvas: MinimalAdvancedCanvas, data: CanvasData): void {
  if (canvas.importData) canvas.importData(data, true);
  else canvas.setData?.(data);
  canvas.requestSave?.();
}

/** Sous-ensemble structurel du `CanvasNode` (= `CanvasElement`) d'Advanced
 * Canvas réellement utilisé par le clic droit direct sur une carte —
 * `canvas` (référence vers le Canvas parent) et `getData()` sont les deux
 * seuls membres lus, tous deux déjà présents dans le contrat audité. */
export type MinimalAdvancedCanvasNode = {
  canvas?: MinimalAdvancedCanvas;
  getData?: () => FeuilletsCanvasNodeSelectionData;
  /** Lot 5 — élément DOM réel de la carte, transmis par l'événement
   * `advanced-canvas:node-editing-state-changed` (section 6) pour retrouver
   * l'iframe de l'éditeur d'un TextNode et lui poser la classe de lisibilité
   * pendant l'édition. */
  nodeEl?: HTMLElement;
  contentEl?: HTMLElement;
  setData?: (data: Record<string, unknown>) => void;
};

/** Sous-ensemble structurel du `Scope` Obsidian réellement utilisé — mêmes
 * signatures que la classe publique `Scope` (obsidian.d.ts), jamais réécrit
 * ici : ce type local existe seulement pour typer `MinimalAdvancedCanvas`
 * sans imposer une dépendance directe à la classe concrète. */
type MinimalCanvasScope = {
  register(modifiers: Modifier[] | null, key: string | null, func: KeymapEventListener): KeymapEventHandler;
  unregister(handler: KeymapEventHandler): void;
};

type WorkspaceWithCanvasMenuEvents = {
  on(name: "canvas:selection-menu", cb: (menu: Menu, canvas: MinimalAdvancedCanvas) => void): EventRef;
  on(name: "canvas:node-menu", cb: (menu: Menu, node: MinimalAdvancedCanvasNode) => void): EventRef;
  on(
    name: "advanced-canvas:node-rendered",
    cb: (canvas: MinimalAdvancedCanvas, node: MinimalAdvancedCanvasNode) => void
  ): EventRef;
  /** Lot 5 (section 6) — événement Advanced Canvas émis à chaque bascule
   * édition/lecture d'un TextNode. `node.nodeEl` porte l'iframe réel de
   * l'éditeur ; `editing` est `true` à l'ouverture, `false` à la fermeture. */
  on(
    name: "advanced-canvas:node-editing-state-changed",
    cb: (node: MinimalAdvancedCanvasNode, editing: boolean) => void
  ): EventRef;
};

/** Lot 5 — sous-ensemble structurel du `Workspace` réellement utilisé pour
 * retrouver les vues Canvas déjà ouvertes (`WorkspaceLeaf.view`, `getLeaves-
 * OfType` sont tous deux publics/documentés, pas spécifiques à Advanced
 * Canvas). `view.canvas` (le vrai objet Canvas runtime, propriété publique
 * de la CanvasView native d'Obsidian) et `view.scope` (`View.scope`, public)
 * sont ce dont a besoin `registerMindmapKeymap`. `view.register` est la
 * méthode `Component.register` héritée par toute `View` — attacher le
 * nettoyage ici lie le cycle de vie des raccourcis à celui de LA VUE, jamais
 * à un listener document/window. */
type CanvasLeafView = {
  file?: TFile | null;
  canvas?: MinimalAdvancedCanvas;
  scope?: MinimalCanvasScope;
  register(cb: () => void): void;
  /** Correctif « drop Binder/Recherche → FileNode » — wrapper DOM natif de
   * la vue Canvas (`View.containerEl`, public), utilisé UNIQUEMENT pour un
   * `addEventListener` scopé à CETTE vue (jamais document/window). */
  containerEl?: HTMLElement;
  contentEl?: HTMLElement;
};
type WorkspaceWithCanvasLeaves = {
  getLeavesOfType(type: "canvas"): Array<{ view: CanvasLeafView }>;
};

/* L'intégration est enregistrée depuis le cycle de vie du plugin, mais une
 * réinitialisation partielle (ou un appel défensif d'un consommateur) ne doit
 * jamais empiler deux écouteurs sur le même workspace : c'était la cause des
 * entrées Canvas dupliquées, pas un problème de traduction ou de libellé. */
const registeredPlugins = new WeakSet<object>();

/** Vues Canvas dont le Scope Tab/Entrée Mindmap a déjà été attaché : jamais
 * deux fois la même vue, même si `active-leaf-change`/`layout-change` se
 * déclenchent plusieurs fois pour elle (voir `attachMindmapKeymaps`). */
const scopedCanvasViews = new WeakSet<object>();

/** Correctif drag/reparent — vues Canvas dont les écouteurs pointer ont
 * déjà été attachés : jamais deux fois la même vue (même garde que
 * `scopedCanvasViews`, WeakSet distinct car ce sont deux préoccupations
 * indépendantes — l'une peut être nettoyée sans affecter l'autre). */
const dragScopedCanvasViews = new WeakSet<object>();

/** Correctif « drop Binder/Recherche → FileNode » — vues Canvas dont les
 * écouteurs dragover/drop ont déjà été attachés : jamais deux fois la même
 * vue, WeakSet distinct des deux autres (préoccupation indépendante). */
const fileDropScopedCanvasViews = new WeakSet<object>();

export type FeuilletsPluginLike = {
  app: App;
  settings: FeuilletsSettings;
  registerEvent(evt: EventRef): void;
  saveSettings(): void | Promise<void>;
  /** Component.register — nettoyage exécuté au déchargement du PLUGIN (voir
   * section 3 du Lot 5). Optionnel : si absent, seul le déchargement de
   * chaque VUE (via `view.register`, toujours appelé) nettoie ses propres
   * raccourcis. */
  register?(cb: () => void): void;
  /** Lot 9 — mêmes méthodes que celles déjà utilisées par `ImportOutlineModal`
   * (commande « Importer un plan… », voir main.ts) : requises ici pour que
   * l'action node-menu « Transformer cette branche en plan… » réutilise
   * EXACTEMENT la même modale, jamais une seconde implémentation.
   * `getOrderedChildren` (correctif Lot 9, mode idea-tree) : ORDRE
   * CANONIQUE Feuillets, jamais `folder.children` brut — déjà public sur le
   * plugin principal (voir main.ts). */
  getProjectFolder(): TFolder | null;
  ensureFolder(path: string): Promise<TAbstractFile>;
  writeOrder(parent: TAbstractFile, children: TAbstractFile[]): Promise<void>;
  renderAllViews(force: boolean): void;
  getOrderedChildren(folder: TFolder): Array<TFile | TFolder>;
  isFeuilletsCarnetFile?(file: TFile | null | undefined): boolean;
};

/** Stratégie de sauvegarde partagée par les modales Lot 1 (CanvasBridgeModal,
 * CanvasNodeToManuscriptModal) et Lot 2 (CanvasChapterModal) quand ouvertes
 * depuis Advanced Canvas : jamais un `vault.modify()` direct tant que
 * `setData`/`requestSave` sont disponibles sur la vue déjà ouverte — voir
 * le commentaire de tête de ce fichier et applyViaBridge/applyNodeDirectly. */
function livePersist(canvas: MinimalAdvancedCanvas): ((data: CanvasData) => void) | undefined {
  if (!canvas.setData || !canvas.requestSave) return undefined;
  return (data) => persistCanvasData(canvas, data);
}

/** Convertit une sélection d'idées (une carte via node-menu, une ou
 * plusieurs via selection-menu) — ne travaille QUE sur les ids transmis,
 * jamais sur le reste du tableau ; jamais lu depuis le disque tant qu'une
 * API live est disponible (`getData`/`setData`/`requestSave`), pour ne
 * jamais risquer d'écraser des modifications non enregistrées de la vue
 * Canvas ouverte. Si cette API live n'est pas là (défensif — le contrat
 * vérifié dit qu'elle l'est toujours), repli sur le workflow universel :
 * relecture du fichier sur disque, IDs présélectionnés, aucune donnée en
 * mémoire supposée. Sécurité des données avant élégance UX, comme demandé.
 * Fonction PARTAGÉE entre selection-menu et node-menu : une seule logique
 * d'application du pont, jamais dupliquée. */
async function applyViaBridge(
  app: App,
  settings: FeuilletsSettings,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  ids: string[],
  mode: BridgeMode
): Promise<void> {
  if (canvas.getData && canvas.setData && canvas.requestSave) {
    const data = canvas.getData();
    new CanvasBridgeModal(app, settings, canvasFile, data, mode, {
      preselectedIds: ids,
      persist: (updated) => persistCanvasData(canvas, updated),
      runtimeCanvas: canvas,
    }).open();
    return;
  }

  // Repli : aucune méthode sûre disponible sur cet objet canvas — même
  // chemin que sans Advanced Canvas (relecture disque, écriture directe).
  const raw = await app.vault.read(canvasFile);
  let data: CanvasData;
  try {
    data = JSON.parse(raw) as CanvasData;
  } catch {
    new Notice(t("main.notice.canvasUnreadable"));
    return;
  }
  new CanvasBridgeModal(app, settings, canvasFile, data, mode, { preselectedIds: ids }).open();
}

/** Ajoute les deux actions Feuillets (manuscrit/recherche) à un menu, pour
 * les ids donnés — utilisée par le selection-menu (un ou plusieurs ids),
 * jamais par le node-menu (voir plus bas : celui-ci connaît déjà exactement
 * le node concerné et ne doit jamais rouvrir la modale multi-sélection). */
function addSelectionMenuItems(
  menu: Menu,
  plugin: FeuilletsPluginLike,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  ids: string[],
  labels: { manuscript: string; research: string }
): void {
  menu.addItem((item) =>
    item
      .setTitle(labels.manuscript)
      .setIcon("book-open")
      .onClick(() => {
        void applyViaBridge(plugin.app, plugin.settings, canvas, canvasFile, ids, "manuscript");
      })
  );
  menu.addItem((item) =>
    item
      .setTitle(labels.research)
      .setIcon("flask-conical")
      .onClick(() => {
        void applyViaBridge(plugin.app, plugin.settings, canvas, canvasFile, ids, "research");
      })
  );
}

/** Applique directement la conversion d'UN node déjà connu par son id —
 * jamais de CanvasBridgeModal ici (le node-menu connaît déjà le node
 * concerné, ce n'est pas un workflow de sélection). Même stratégie anti-
 * conflit que `applyViaBridge` : API live du Canvas si disponible, sinon
 * repli disque. */
async function applyNodeDirectly(
  app: App,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  nodeId: string,
  destFolder: TFolder,
  mode: BridgeMode,
  title?: string
): Promise<void> {
  if (canvas.getData && canvas.setData && canvas.requestSave) {
    const data = canvas.getData();
    if (isFeuilletsOwnedNode(data.nodes.find((node) => node.id === nodeId))) return;
    const result = await applySelectedIdeas(app, data, [nodeId], destFolder, mode, canvas, title ? new Map([[nodeId, title]]) : undefined);
    persistCanvasData(canvas, data);
    new Notice(t("modal.canvasBridge.done", { count: String(result.created) }));
    return;
  }

  const raw = await app.vault.read(canvasFile);
  let data: CanvasData;
  try {
    data = JSON.parse(raw) as CanvasData;
  } catch {
    new Notice(t("main.notice.canvasUnreadable"));
    return;
  }
  if (isFeuilletsOwnedNode(data.nodes.find((node) => node.id === nodeId))) return;
  const result = await applySelectedIdeas(app, data, [nodeId], destFolder, mode, undefined, title ? new Map([[nodeId, title]]) : undefined);
  await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  new Notice(t("modal.canvasBridge.done", { count: String(result.created) }));
}

/** Résout la rubrique Carnet/Notebook du projet actif pour l'action
 * node-menu « Transformer en fiche Recherche » (section 3) — jamais
 * directement la racine Recherche : les fiches libres créées depuis le
 * Carnet vivent dans leur propre rubrique, reconnue quelle que soit la
 * langue active (voir services/research.ts, ensureNotebookResearchFolder). */
async function resolveResearchDestination(app: App, settings: FeuilletsSettings): Promise<TFolder | null> {
  return ensureNotebookResearchFolder(app, settings);
}

/** Titre affiché pour un node admissible (idée texte ou feuillet déjà dans
 * le manuscrit) dans les modales Scinder/Fusionner — jamais inventé : le
 * titre réel du fichier pour un file node, la première ligne significative
 * pour un text node, comme partout ailleurs dans le pont Carnet. */
function admissibleNodeTitle(app: App, node: CanvasNode): string {
  if (node.type === "text") {
    return deriveTitle(node.text || "") || firstMeaningfulLine(node.text || "") || t("modal.canvasBridge.untitledIdea");
  }
  const file = typeof node.file === "string" ? app.vault.getAbstractFileByPath(node.file) : null;
  return file instanceof TFile ? titleFor(app, file) : String(node.file || node.id);
}

/** Exécute une scission Canvas déjà validée par la modale : un TextNode
 * devient deux TextNodes voisins (JSON pur, jamais d'accès disque).
 * Persiste toujours via l'API live du Canvas ouvert quand disponible,
 * repli disque sinon — même stratégie que le reste de ce fichier. */
async function applySplit(
  app: App,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  node: CanvasNode,
  first: string,
  second: string
): Promise<void> {
  const readLive = canvas.getData && canvas.setData && canvas.requestSave;
  const data = readLive ? canvas.getData!() : (JSON.parse(await app.vault.read(canvasFile)) as CanvasData);

  if (node.type === "text") {
    const result = splitTextNode(data, node.id, first, second);
    if (!result) return;
  } else {
    return;
  }

  if (readLive) persistCanvasData(canvas, data);
  else await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  new Notice(t("modal.canvasSplit.done"));
}

/** Exécute une fusion (section 5B) déjà validée par la modale — voir
 * services/canvas-split-merge.ts `executeMerge` pour la logique
 * transactionnelle (rollback en cas d'échec, suppression seulement après
 * succès) : ce point d'entrée ne fait que lire/écrire le Canvas courant. */
async function applyMerge(
  app: App,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  orderedIds: string[],
  targetId: string
): Promise<void> {
  const readLive = canvas.getData && canvas.setData && canvas.requestSave;
  const data = readLive ? canvas.getData!() : (JSON.parse(await app.vault.read(canvasFile)) as CanvasData);

  const result = await executeMerge(app, data, orderedIds, targetId);
  if (!result.ok) {
    new Notice(t("modal.canvasMerge.errorFailed"));
    return;
  }

  if (readLive) persistCanvasData(canvas, result.canvas);
  else await app.vault.modify(canvasFile, JSON.stringify(result.canvas, null, "\t"));
  new Notice(t("modal.canvasMerge.done"));
}

/* --------------------------------------------------------------------- *
 * Raccourcis clavier Mindmap (Scope de la vue Canvas) et décorations de
 * LECTURE des anciens idea-tree.
 *
 * L'arbre d'idées historique est en compatibilité/migration seulement :
 * aucune commande ne crée, n'ajoute ni ne réorganise plus une de ses
 * branches. Ne subsistent ici que des classes CSS purement visuelles qui
 * LISENT ses données existantes, sans jamais les modifier.
 * --------------------------------------------------------------------- */

/** Classe posée sur `node.nodeEl` (lecture) pour les TextNodes réellement
 * membres d'un idea-tree — jamais sur un autre node/Canvas (section 6). */
const IDEA_TREE_MEMBER_CLASS = "feuillets-idea-tree-member";
/** Classe posée sur le `<body>` de l'iframe d'édition (couche DOM séparée,
 * un sélecteur CSS ne peut jamais la traverser depuis `.canvas-node`) pour
 * un TextNode membre en cours d'édition — voir l'écouteur
 * `advanced-canvas:node-editing-state-changed` plus bas. */
const IDEA_TREE_EDITING_CLASS = "feuillets-idea-tree-editing";

/** Recalcule la classe de lecture sur CHAQUE TextNode réel du Canvas ouvert
 * — jamais sur le JSON seul (`node.nodeEl` n'existe que côté instances
 * runtime). Appelé après toute mutation de l'arbre (Tab/Entrée, « Ajouter
 * une branche », « Développer en arbre… », « Réorganiser l'arbre ») pour
 * qu'un node qui vient de rejoindre — ou de quitter — un idea-tree reflète
 * immédiatement son état. Silencieux si `nodes`/`getData` sont absents. */
function refreshIdeaTreeNodeClasses(canvas: MinimalAdvancedCanvas): void {
  if (!canvas.nodes || !canvas.getData) return;
  let data: CanvasData;
  try {
    data = canvas.getData();
  } catch {
    return;
  }
  for (const [id, runtimeNode] of canvas.nodes) {
    const node = data.nodes.find((candidate) => candidate.id === id);
    runtimeNode.nodeEl?.classList.toggle(IDEA_TREE_MEMBER_CLASS, !isFeuilletsOwnedNode(node) && isIdeaTreeNode(data, id));
  }
}

/** Le node runtime réel actuellement sélectionné, seulement si la sélection
 * du Canvas ne contient EXACTEMENT qu'un seul élément — `null` sinon (aucune
 * sélection, sélection multiple, ou `canvas.selection` absent). Les
 * raccourcis Tab/Entrée n'agissent jamais en dehors de ce cas précis
 * (section 2 du Lot 5). */
function activeSelectionNode(canvas: MinimalAdvancedCanvas): MinimalRuntimeNode | null {
  const selection = canvas.selection;
  if (!selection || selection.size !== 1) return null;
  const [only] = selection;
  return only || null;
}

/** Lit `data` depuis le Canvas déjà ouvert (jamais le disque : les
 * raccourcis clavier et le drag n'agissent que sur une vue Canvas déjà en
 * mémoire) — `null` si `getData` est absent ou échoue. */
function liveCanvasData(canvas: MinimalAdvancedCanvas): CanvasData | null {
  if (!canvas.getData) return null;
  try {
    return canvas.getData();
  } catch {
    return null;
  }
}

/** Raccourcis Mindmap Tab (`kind: "child"`) / Entrée (`kind: "sibling"`) /
 * Shift+Tab (`kind: "outdent"`) portés par le Scope PUBLIC de la vue Canvas.
 *
 * Ils n'agissent QUE sur un VRAI node Mindmap : sélection unique, node non
 * édité, et `feuillets_block_id` posé reconnu par `isMindmapMemberNode`
 * (jamais déduit de la géométrie — voir carnet/blocks/mindmap/model.ts).
 * Aucune branche de repli : un TextNode libre, un node d'un autre bloc
 * Feuillets ou un idea-tree legacy repartent tels quels, sans
 * `preventDefault`, donc avec le comportement natif d'Obsidian intact.
 * L'idea-tree est lecture/migration uniquement : aucun raccourci ne crée
 * ni ne réorganise plus une de ses branches. */
function handleMindmapKey(canvas: MinimalAdvancedCanvas, kind: "child" | "sibling" | "outdent"): KeymapEventListener {
  return (evt) => {
    const node = activeSelectionNode(canvas);
    if (!node || node.isEditing) return;
    const data = liveCanvasData(canvas);
    if (!data) return;

    const fullNode = data.nodes.find((n) => n.id === node.id);
    const blockId = fullNode && typeof fullNode.feuillets_block_id === "string" ? fullNode.feuillets_block_id : null;
    if (!fullNode || !blockId || !isMindmapMemberNode(fullNode, blockId)) return;

    const acted =
      kind === "child"
        ? !!addMindmapChild(data, blockId, node.id)
        : kind === "sibling"
          ? !!addMindmapSibling(data, blockId, node.id)
          : outdentMindmapNode(data, blockId, node.id);
    if (!acted) return;
    evt.preventDefault();
    persistCanvasData(canvas, data);
    return false;
  };
}

/** Attache Tab/Entrée au Scope PUBLIC de la vue Canvas (jamais un listener
 * document/window/wrapperEl — voir section 3 du Lot 5) — une seule fois par
 * vue (`scopedCanvasViews`), jamais dupliqué même si cette fonction est
 * appelée à répétition (`active-leaf-change`/`layout-change`). Les deux
 * `KeymapEventHandler` retournés par `scope.register` sont désenregistrés
 * au déchargement de LA VUE (`view.register`, toujours disponible) et, en
 * plus, au déchargement du PLUGIN si `plugin.register` existe — jamais
 * seulement l'un des deux. */
function registerMindmapKeymap(plugin: FeuilletsPluginLike, view: CanvasLeafView): void {
  const canvas = view.canvas;
  const scope = view.scope;
  if (!canvas || !scope || scopedCanvasViews.has(view)) return;
  scopedCanvasViews.add(view);

  /* Modificateurs EXACTS, jamais `null` (= « toutes variantes ») : Tab et
     Entrée nus seulement, Shift+Tab pour le désindent. Cmd/Ctrl+Entrée et
     les autres combinaisons restent donc entièrement natives — le Plan,
     qui s'en sert (§4), n'a jamais à disputer un raccourci à ce Scope. */
  const tabHandler = scope.register([], "Tab", handleMindmapKey(canvas, "child"));
  const enterHandler = scope.register([], "Enter", handleMindmapKey(canvas, "sibling"));
  const outdentHandler = scope.register(["Shift"], "Tab", handleMindmapKey(canvas, "outdent"));
  const unregister = () => {
    scope.unregister(tabHandler);
    scope.unregister(enterHandler);
    scope.unregister(outdentHandler);
  };
  view.register(unregister);
  plugin.register?.(unregister);

  refreshIdeaTreeNodeClasses(canvas);
}

/** Classe posée sur le `nodeEl` d'un node Mindmap survolé pendant un drag
 * comme cible de reparentage VALIDE — seule décoration visuelle du drag,
 * jamais un second Canvas/overlay. */
const MINDMAP_DROP_TARGET_CLASS = "feuillets-mindmap-drop-target";

function pointInsideNodeData(pos: { x: number; y: number }, node: CanvasNode): boolean {
  const x = Number(node.x) || 0;
  const y = Number(node.y) || 0;
  const width = Number(node.width) || 0;
  const height = Number(node.height) || 0;
  return pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height;
}

/** Position d'un node en coordonnées CANVAS : `node.getBBox()` (membre réel
 * vérifié sur le bundle Advanced Canvas) en priorité — c'est la seule source
 * correcte pendant un drag, puisqu'elle suit le node PENDANT son
 * déplacement ; repli sur la géométrie JSON pour un node non encore bougé ou
 * un runtime qui n'exposerait pas getBBox. */
function runtimeNodeContains(runtimeNode: MinimalRuntimeNode | undefined, fallback: CanvasNode, pos: { x: number; y: number }): boolean {
  const bbox = runtimeNode?.getBBox?.();
  if (bbox) return pos.x >= bbox.minX && pos.x <= bbox.maxX && pos.y >= bbox.minY && pos.y <= bbox.maxY;
  return pointInsideNodeData(pos, fallback);
}

/** Cible Mindmap valide sous `event` — coordonnées CANVAS via
 * `canvas.posFromEvt` (jamais `getBoundingClientRect`, qui est en
 * coordonnées écran et ignorerait zoom/pan).
 *
 * CAUSE DU BUG PRÉCÉDENT, corrigée ici : pendant un drag, le node glissé
 * SUIT le pointeur — il se trouve donc lui-même sous le point de dépose et
 * était systématiquement retenu comme « cible », ce qui faisait toujours
 * échouer le reparentage (cible === node glissé). `excludedIds` écarte
 * explicitement le node glissé, TOUS ses descendants (déjà interdits par
 * l'anti-cycle, mais aussi entraînés visuellement avec lui) et toute la
 * sélection courante, pour que le hit-test voie réellement le node du
 * DESSOUS. Les groupes sont exclus par type. */
function resolveMindmapDropTarget(
  canvas: MinimalAdvancedCanvas,
  event: CanvasPointerLikeEvent,
  draggedId: string,
  blockId: string,
  excludedIds: Set<string>
): { runtimeNode: MinimalRuntimeNode; data: CanvasData } | null {
  if (!canvas.posFromEvt) return null;
  const pos = canvas.posFromEvt(event);
  const data = liveCanvasData(canvas);
  if (!data) return null;
  const candidate = data.nodes.find(
    (node) =>
      node.type !== "group" &&
      !excludedIds.has(node.id) &&
      runtimeNodeContains(canvas.nodes?.get(node.id), node, pos) &&
      canReparentByDrop(data, blockId, draggedId, node.id)
  );
  if (!candidate) return null;
  const runtimeNode = canvas.nodes?.get(candidate.id);
  if (!runtimeNode) return null;
  return { runtimeNode, data };
}

/** Ids à écarter du hit-test pour un drag de `draggedId` : lui-même, tous
 * ses descendants structurels, et toute la sélection courante (un drag
 * multiple entraîne plusieurs nodes qui suivent tous le pointeur). */
function draggedExclusionSet(canvas: MinimalAdvancedCanvas, data: CanvasData, blockId: string, draggedId: string): Set<string> {
  const excluded = new Set<string>([draggedId]);
  for (const descendant of mindmapSubtree(data, blockId, draggedId)) excluded.add(descendant.id);
  if (canvas.selection) for (const selected of canvas.selection) excluded.add(selected.id);
  return excluded;
}

/** Correctif drag/reparent RÉEL (Mindmap) — écouteurs pointer posés sur
 * `canvas.wrapperEl` (membre RÉEL du Canvas natif, vérifié sur le bundle
 * Advanced Canvas qui l'utilise directement depuis `view.canvas`), jamais
 * document/window, jamais un monkey-patch.
 *
 * `canvas.handleSelectionDrag` — envisagé au correctif précédent — N'EXISTE
 * PAS : vérifié, 0 occurrence dans le bundle réel. Tout wrapper autour de
 * cette méthode était donc du code mort, ce qui explique que le drag n'ait
 * jamais rien fait.
 *
 * Le drag natif d'Obsidian continue de déplacer le node visuellement à
 * l'identique (ces écouteurs sont purement passifs, aucun preventDefault) ;
 * au relâchement sur une cible valide, le moteur reparente puis relayout SA
 * Mindmap uniquement. Une seule fois par vue (`dragScopedCanvasViews`),
 * cleanup complet au déchargement de la vue ET du plugin. */
function registerMindmapDragReparent(plugin: FeuilletsPluginLike, view: CanvasLeafView): void {
  const canvas = view.canvas;
  const wrapper = canvas?.wrapperEl;
  if (!canvas || !wrapper || !canvas.posFromEvt || dragScopedCanvasViews.has(view)) return;
  dragScopedCanvasViews.add(view);

  let draggedId: string | null = null;
  let draggedBlockId: string | null = null;
  let hoveredEl: HTMLElement | undefined;
  const clearHover = () => {
    hoveredEl?.classList.remove(MINDMAP_DROP_TARGET_CLASS);
    hoveredEl = undefined;
  };

  const onPointerDown = (evt: PointerEvent) => {
    draggedId = null;
    draggedBlockId = null;
    const data = liveCanvasData(canvas);
    if (!data || !canvas.posFromEvt) return;
    const pos = canvas.posFromEvt(evt);
    const hit = data.nodes.find((node) => node.type !== "group" && runtimeNodeContains(canvas.nodes?.get(node.id), node, pos));
    if (!hit || typeof hit.feuillets_block_id !== "string" || !isMindmapMemberNode(hit, hit.feuillets_block_id)) return;
    if (canvas.nodes?.get(hit.id)?.isEditing) return;
    draggedId = hit.id;
    draggedBlockId = hit.feuillets_block_id;
  };

  const onPointerMove = (evt: PointerEvent) => {
    if (!draggedId || !draggedBlockId) return;
    const data = liveCanvasData(canvas);
    if (!data) { clearHover(); return; }
    const excluded = draggedExclusionSet(canvas, data, draggedBlockId, draggedId);
    const target = resolveMindmapDropTarget(canvas, evt, draggedId, draggedBlockId, excluded);
    const targetEl = target?.runtimeNode.nodeEl;
    if (hoveredEl !== targetEl) {
      clearHover();
      if (targetEl) { hoveredEl = targetEl; hoveredEl.classList.add(MINDMAP_DROP_TARGET_CLASS); }
    }
  };

  const onPointerUp = (evt: PointerEvent) => {
    clearHover();
    const dragged = draggedId;
    const blockId = draggedBlockId;
    draggedId = null;
    draggedBlockId = null;
    if (!dragged || !blockId) return;
    const data = liveCanvasData(canvas);
    if (!data) return;
    const excluded = draggedExclusionSet(canvas, data, blockId, dragged);
    const target = resolveMindmapDropTarget(canvas, evt, dragged, blockId, excluded);
    if (!target) return;
    if (!reparentMindmapNodeByDrop(target.data, blockId, dragged, target.runtimeNode.id)) return;
    persistCanvasData(canvas, target.data);
    refreshIdeaTreeNodeClasses(canvas);
  };

  wrapper.addEventListener("pointerdown", onPointerDown);
  wrapper.addEventListener("pointermove", onPointerMove);
  wrapper.addEventListener("pointerup", onPointerUp);
  const unregister = () => {
    clearHover();
    wrapper.removeEventListener("pointerdown", onPointerDown);
    wrapper.removeEventListener("pointermove", onPointerMove);
    wrapper.removeEventListener("pointerup", onPointerUp);
  };
  view.register(unregister);
  plugin.register?.(unregister);
}

/** Parcourt les vues Canvas déjà ouvertes et attache le Scope Tab/Entrée à
 * celles qui affichent le Carnet du projet actif — jamais aux autres Canvas
 * du coffre (section 9 : aucun autre Canvas/node ne doit être affecté).
 * Silencieux si `getLeavesOfType` est absent (repli défensif, comme le
 * reste de ce fichier). */
function attachMindmapKeymaps(plugin: FeuilletsPluginLike): void {
  const workspace = plugin.app.workspace as unknown as WorkspaceWithCanvasLeaves;
  if (!workspace.getLeavesOfType) return;
  for (const leaf of workspace.getLeavesOfType("canvas")) {
    const view = leaf?.view;
    /* `isFeuilletsCarnet` (global OU Carnet de dossier) plutôt que
       `isActiveNotebook` (global seul, historique idea-tree) : Tab/Entrée/
       Shift+Tab servent maintenant aussi la Mindmap (Prompt 2/5), qui doit
       fonctionner dans N'IMPORTE QUEL Carnet Feuillets, pas seulement le
       Carnet global. Repli identique à l'ancien comportement quand
       `plugin.isFeuilletsCarnetFile` est absent (voir isFeuilletsCarnet). */
    if (view && isFeuilletsCarnet(plugin, view.file)) registerMindmapKeymap(plugin, view);
  }
}

/** Correctif drag/reparent (Mindmap, §2) — parcourt les vues Canvas déjà
 * ouvertes et attache les écouteurs pointer à celles qui affichent un
 * Carnet Feuillets (global ou de dossier). Idempotente comme
 * `attachMindmapKeymaps` (`dragScopedCanvasViews`), rappelée aux mêmes
 * événements workspace. */
function attachMindmapDragKeymaps(plugin: FeuilletsPluginLike): void {
  const workspace = plugin.app.workspace as unknown as WorkspaceWithCanvasLeaves;
  if (!workspace.getLeavesOfType) return;
  for (const leaf of workspace.getLeavesOfType("canvas")) {
    const view = leaf?.view;
    if (view && isFeuilletsCarnet(plugin, view.file)) registerMindmapDragReparent(plugin, view);
  }
}

/** Correctif « drop Binder/Recherche → FileNode » (§5) : attache
 * `dragover`/`drop` au wrapper DOM de CETTE vue Canvas — jamais document/
 * window, une seule fois par vue (`fileDropScopedCanvasViews`), cleanup
 * complet au déchargement de la vue ET du plugin. `dragover` accepte
 * uniquement un `dataTransfer` portant `FEUILLETS_FILE_DRAG_MIME` dont le
 * chemin résout un TFile réel — jamais un déplacement du fichier, seulement
 * `dropEffect = "copy"`. `drop` crée un VRAI FileNode (`createCarnetFileNode`,
 * carnet/canvas/adapter.ts) à la position convertie par `canvas.posFromEvt`
 * (jamais une coordonnée écran), puis `preventDefault`/`stopPropagation`
 * pour empêcher le comportement natif Canvas de créer EN PLUS un TextNode
 * `[[lien]]` pour ce même dépôt. Un TFile lâché dans l'espace d'une Mindmap
 * ne reçoit ici AUCUNE relation structurelle (§6) — jamais déduite de sa
 * position de dépôt. */
function registerCarnetFileDrop(plugin: FeuilletsPluginLike, view: CanvasLeafView): void {
  const canvas = view.canvas;
  const wrapper = canvas?.wrapperEl;
  if (!canvas || !wrapper || !canvas.posFromEvt || fileDropScopedCanvasViews.has(view)) return;
  fileDropScopedCanvasViews.add(view);

  const resolveDroppedFile = (evt: DragEvent): TFile | null => {
    const path = feuilletsFileDragPath(evt.dataTransfer);
    if (!path) return null;
    const file = plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  };

  const onDragOver = (evt: DragEvent) => {
    if (!resolveDroppedFile(evt)) return;
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (evt: DragEvent) => {
    const file = resolveDroppedFile(evt);
    if (!file || !canvas.posFromEvt) return;
    evt.preventDefault();
    evt.stopPropagation();
    const pos = canvas.posFromEvt(evt);
    /* Prompt 4, §3 — un dépôt qui tombe DANS un bloc Relations/Généalogie
       déjà présent l'ajoute comme MEMBRE (feuillets_block_id posé), jamais
       comme relation automatique. Comportement Mindmap intentionnellement
       INCHANGÉ (§6 de son propre correctif, non touché ici) :
       `containingGroupBlockAt` ne reconnaît que Relations/Généalogie, donc
       un dépôt dans l'espace d'une Mindmap retombe sur le FileNode libre
       ci-dessous, exactement comme avant. */
    if (createCarnetFileNode(canvas, file, pos)) refreshIdeaTreeNodeClasses(canvas);
  };

  /* Phase CAPTURE, sur `canvas.wrapperEl` : le handler de dépôt natif du
     Canvas vit sur cette même surface. Attaché en phase bouillonnement (ou
     sur le `containerEl` extérieur, comme au correctif précédent), le nôtre
     s'exécutait APRÈS lui — Obsidian avait déjà créé son TextNode `[[lien]]`
     et `stopPropagation` arrivait trop tard. En capture, nous passons avant
     et `preventDefault`/`stopPropagation` l'empêchent réellement. */
  wrapper.addEventListener("dragover", onDragOver, true);
  wrapper.addEventListener("drop", onDrop, true);
  const unregister = () => {
    wrapper.removeEventListener("dragover", onDragOver, true);
    wrapper.removeEventListener("drop", onDrop, true);
  };
  view.register(unregister);
  plugin.register?.(unregister);
}

/** Parcourt les vues Canvas déjà ouvertes et attache dragover/drop à celles
 * qui affichent un Carnet Feuillets (global ou de dossier) — même principe
 * que `attachMindmapDragKeymaps`. */
function attachCarnetFileDropKeymaps(plugin: FeuilletsPluginLike): void {
  const workspace = plugin.app.workspace as unknown as WorkspaceWithCanvasLeaves;
  if (!workspace.getLeavesOfType) return;
  for (const leaf of workspace.getLeavesOfType("canvas")) {
    const view = leaf?.view;
    if (view && isFeuilletsCarnet(plugin, view.file)) registerCarnetFileDrop(plugin, view);
  }
}

/** Vrai si `file` est le Carnet (Tableau brainstorming.canvas) du projet
 * Feuillets actif — jamais un autre .canvas du coffre. */
function isActiveNotebook(plugin: FeuilletsPluginLike, file: TFile | null | undefined): file is TFile {
  if (!file) return false;
  const root = getProjectFolder(plugin.app, plugin.settings);
  if (!root) return false;
  return file.path === canvasPathFor(plugin.app, root);
}

function isFeuilletsCarnet(plugin: FeuilletsPluginLike, file: TFile | null | undefined): file is TFile {
  return !!file && (plugin.isFeuilletsCarnetFile?.(file) ?? isActiveNotebook(plugin, file));
}

/** Enregistre les écouteurs `canvas:selection-menu` (une ou plusieurs
 * cartes sélectionnées → CanvasBridgeModal, workflow multi-sélection) et
 * `canvas:node-menu` (clic droit direct sur UNE carte → action immédiate
 * sur cet id précis, jamais la modale multi-sélection) — sans effet si
 * Advanced Canvas n'est pas installé/actif (les événements ne sont alors
 * simplement jamais émis). Ignorent silencieusement : tout canvas qui
 * n'est pas le Carnet du projet actif, et toute sélection/node sans text
 * node. Les deux chemins réutilisent le même pipeline pur
 * (`applySelectedIdeas`, services/canvas-bridge.ts) — jamais deux logiques
 * de conversion distinctes, seule la couche UI diffère. */
export function registerAdvancedCanvasIntegration(plugin: FeuilletsPluginLike): void {
  if (registeredPlugins.has(plugin)) return;
  registeredPlugins.add(plugin);
  const workspace = plugin.app.workspace as unknown as WorkspaceWithCanvasMenuEvents;
  /* §12 du lot Plan : le Plan n'est PLUS monté depuis
     `advanced-canvas:node-rendered` — cet événement n'existe que si
     Advanced Canvas est installé, alors que le Plan doit fonctionner sans
     lui. Le montage passe désormais par le lifecycle Carnet natif (voir
     main.ts, decoratePlanCanvasView). */

  plugin.registerEvent(
    workspace.on("canvas:selection-menu", (menu, canvas) => {
      const canvasFile = canvas.view?.file;
      if (!isFeuilletsCarnet(plugin, canvasFile)) return;

      let selection: FeuilletsCanvasSelectionData;
      try {
        selection = canvas.getSelectionData?.() || {};
      } catch {
        return;
      }
      const selectedNodes = (selection.nodes || []).filter((selected) => !isFeuilletsOwnedNode(selected));

      // Lot 1 — inchangé : idées texte sélectionnées → manuscrit/recherche.
      const textIds = selectedNodes.filter((n) => n.type === "text").map((n) => n.id);
      if (textIds.length > 0) {
        const singular = textIds.length === 1;
        addSelectionMenuItems(menu, plugin, canvas, canvasFile, textIds, {
          manuscript: t(singular ? "advancedCanvas.toManuscriptSingular" : "advancedCanvas.toManuscript"),
          research: t(singular ? "advancedCanvas.toResearchSingular" : "advancedCanvas.toResearch"),
        });
      }

      // Lot 2 (section 17) : au moins 2 éléments admissibles (texte + file
      // manuscrit) dans la sélection → « Créer un chapitre avec la
      // sélection… ». Group/link/research/externe ignorés silencieusement.
      // Un seul élément admissible reste un feuillet, pas un chapitre.
      if (canvas.getData) {
        const full = canvas.getData();
        const isManuscriptPath = makeManuscriptPathChecker(plugin.app, plugin.settings);
        const selectedFull = selectedNodes
          .map((n) => full.nodes.find((fn) => fn.id === n.id))
          .filter((n): n is CanvasNode => !!n);
        const admissible = admissibleChapterNodes(selectedFull, isManuscriptPath);
        if (admissible.length >= 2) {
          menu.addItem((item) =>
            item
              .setTitle(t("advancedCanvas.selectionMenu.createChapter"))
              .setIcon("folder-plus")
              .onClick(() => {
                new CanvasChapterModal(
                  plugin.app,
                  plugin.settings,
                  full,
                  { source: "selection", ids: admissible.map((n) => n.id) },
                  { persist: livePersist(canvas), saveSettings: () => plugin.saveSettings(), runtimeCanvas: canvas }
                ).open();
              })
          );

          /* La fusion Canvas ne concerne que des TextNodes libres. Les
             FileNodes manuscrit gardent le moteur Feuillets déjà ajouté par
             files-menu (YAML, ordre et invariants de scènes) ; le mélange
             texte/fichier ne reçoit aucune fusion ambiguë. */
          if (admissible.every((n) => n.type === "text")) {
            menu.addItem((item) =>
              item
                .setTitle(t("advancedCanvas.selectionMenu.merge"))
                .setIcon("combine")
                .onClick(() => {
                  const rows: MergeRow[] = admissible.map((n) => ({ id: n.id, title: admissibleNodeTitle(plugin.app, n) }));
                  new CanvasMergeModal(plugin.app, rows, (orderedIds, targetId) => {
                    void applyMerge(plugin.app, canvas, canvasFile, orderedIds, targetId);
                  }).open();
                })
            );
          }
        }
      }
    })
  );

  /* node-menu = action directe sur UN élément déjà connu (jamais la modale
     multi-sélection) :
       - « Transformer en fiche Recherche » : aucune UI, destination déjà
         déterminée par le projet (racine Recherche) ;
       - « Transformer en feuillet » : seule la destination manuscrit peut
         être demandée (CanvasNodeToManuscriptModal, une seule idée). */
  plugin.registerEvent(
    workspace.on("canvas:node-menu", (menu, node) => {
      const canvas = node.canvas;
      if (!canvas) return;
      const canvasFile = canvas.view?.file;
      if (!isFeuilletsCarnet(plugin, canvasFile)) return;

      let data: FeuilletsCanvasNodeSelectionData | undefined;
      try {
        data = node.getData?.();
      } catch {
        return;
      }
      if (!data) return;

      const full = canvas.getData?.();
      const fullNode = full?.nodes.find((candidate) => candidate.id === data.id) || data;
      if (isFeuilletsOwnedNode(fullNode)) return;
      if (data.type === "text") {
        const nodeId = data.id;
        const ideaTitle = deriveTitle(data.text || "") || t("modal.canvasBridge.untitledIdea");

        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.toManuscript"))
            .setIcon("book-open")
            .onClick(() => {
              new CanvasNodeToManuscriptModal(plugin.app, plugin.settings, ideaTitle, (folder, title) => {
                void applyNodeDirectly(plugin.app, canvas, canvasFile, nodeId, folder, "manuscript", title);
              }).open();
            })
        );
        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.toResearch"))
            .setIcon("flask-conical")
            .onClick(() => {
              void (async () => {
                const dest = await resolveResearchDestination(plugin.app, plugin.settings);
                if (!dest) {
                  new Notice(t("modal.canvasBridge.invalidFolder"));
                  return;
                }
                await applyNodeDirectly(plugin.app, canvas, canvasFile, nodeId, dest, "research");
              })();
            })
        );
        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.split"))
            .setIcon("scissors")
            .onClick(() => {
              const freshData = canvas.getData ? canvas.getData() : null;
              const fullNode = freshData ? freshData.nodes.find((n) => n.id === nodeId) : null;
              if (!fullNode) return;
              new CanvasSplitModal(plugin.app, ideaTitle, data.text || "", (first, second) => {
                void applySplit(plugin.app, canvas, canvasFile, fullNode, first, second);
              }).open();
            })
        );
      }

      if (data.type === "text") return;

      // FileNode manuscrit : aucun « Scinder… » Canvas. Le menu de fichier
      // Feuillets fournit déjà « Feuillets: Scinder » avec son moteur fiable.

      // Lot 2 (section 3/18) : group node → « Créer un chapitre dans le
      // manuscrit… », seulement s'il contient au moins un élément
      // admissible ; sinon l'action n'est simplement pas proposée. file et
      // link nodes ne reçoivent toujours aucune action dans ce Lot.
      if (data.type === "group" && full) {
        const groupNode = full.nodes.find((n) => n.id === data.id);
        if (!groupNode) return;
        const isManuscriptPath = makeManuscriptPathChecker(plugin.app, plugin.settings);
        const contained = nodesContainedInGroup(full, groupNode);
        const admissible = admissibleChapterNodes(contained, isManuscriptPath);
        if (admissible.length === 0) return;

        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.createChapter"))
            .setIcon("folder-plus")
            .onClick(() => {
              new CanvasChapterModal(
                plugin.app,
                plugin.settings,
                full,
                { source: "group", group: groupNode },
                { persist: livePersist(canvas), saveSettings: () => plugin.saveSettings(), runtimeCanvas: canvas }
              ).open();
            })
        );
      }
    })
  );

  /* Lot 5 (section 6) — classe de lisibilité pendant l'édition : posée sur
   * le `<body>` réel de l'iframe d'édition, jamais sur `.canvas-node`
   * (couche DOM séparée, aucun sélecteur CSS ne la traverse). Ignoré pour
   * tout node hors idea-tree ou tout Canvas qui n'est pas le Carnet actif. */
  plugin.registerEvent(
    workspace.on("advanced-canvas:node-editing-state-changed", (node, editing) => {
      const canvas = node.canvas;
      if (!canvas) return;
      if (!isActiveNotebook(plugin, canvas.view?.file)) return;

      let data: FeuilletsCanvasNodeSelectionData | undefined;
      try {
        data = node.getData?.();
      } catch {
        return;
      }
      if (!data) return;
      const full = liveCanvasData(canvas);
      if (!full || !isIdeaTreeNode(full, data.id)) return;

      const body = node.nodeEl?.querySelector("iframe")?.contentDocument?.body;
      body?.classList.toggle(IDEA_TREE_EDITING_CLASS, editing);
    })
  );

  /* Attache le Scope Tab/Entrée Mindmap à chaque vue Canvas du
   * Carnet déjà ouverte ou qui vient de s'ouvrir. `active-leaf-change` et
   * `layout-change` sont les deux événements Workspace natifs déjà utilisés
   * ailleurs dans le plugin (main.ts) pour réagir à l'ouverture d'une vue ;
   * `attachMindmapKeymaps` reste elle-même idempotente (`scopedCanvasViews`)
   * donc aucun risque de double attache même appelée à chaque déclenchement. */
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => attachMindmapKeymaps(plugin)));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => attachMindmapKeymaps(plugin)));
  attachMindmapKeymaps(plugin);

  /* Correctif drag/reparent (Mindmap, Prompt 2) — mêmes événements
     workspace, même idempotence (dragScopedCanvasViews), écouteurs
     indépendants du Scope Tab/Entrée ci-dessus. */
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => attachMindmapDragKeymaps(plugin)));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => attachMindmapDragKeymaps(plugin)));
  attachMindmapDragKeymaps(plugin);

  /* Correctif « drop Binder/Recherche → FileNode » — mêmes événements
     workspace, même idempotence (fileDropScopedCanvasViews), indépendant
     des deux câblages ci-dessus. */
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => attachCarnetFileDropKeymaps(plugin)));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => attachCarnetFileDropKeymaps(plugin)));
  attachCarnetFileDropKeymaps(plugin);
}
