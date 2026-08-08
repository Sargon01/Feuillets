import { Notice, TFolder, TFile } from "obsidian";
import type { App, EventRef, Menu } from "obsidian";
import { t } from "../i18n/index.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { canvasPathFor, type CanvasData, type CanvasNode } from "../services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "../ui/canvas-chapter-modal.js";
import { CanvasSplitModal } from "../ui/canvas-split-modal.js";
import { CanvasMergeModal, type MergeRow } from "../ui/canvas-merge-modal.js";
import { CanvasIdeaTreeModal } from "../ui/canvas-idea-tree-modal.js";
import { applySelectedIdeas, deriveTitle, firstMeaningfulLine, type BridgeMode } from "../services/canvas-bridge.js";
import { ensureNotebookResearchFolder } from "../services/research.js";
import {
  admissibleChapterNodes,
  isAdmissibleChapterNode,
  makeManuscriptPathChecker,
  nodesContainedInGroup,
} from "../services/canvas-chapter.js";
import { createIdeaBranches, ideaTreeBranch, isIdeaTreeNode } from "../services/canvas-idea-tree.js";
import { splitTextNode, executeMerge } from "../services/canvas-split-merge.js";
import { titleFor } from "../services/frontmatter.js";
import type { MinimalRuntimeCanvas } from "../services/canvas-runtime.js";

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
  view?: { file?: TFile | null };
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
};

type WorkspaceWithCanvasMenuEvents = {
  on(name: "canvas:selection-menu", cb: (menu: Menu, canvas: MinimalAdvancedCanvas) => void): EventRef;
  on(name: "canvas:node-menu", cb: (menu: Menu, node: MinimalAdvancedCanvasNode) => void): EventRef;
};

/* L'intégration est enregistrée depuis le cycle de vie du plugin, mais une
 * réinitialisation partielle (ou un appel défensif d'un consommateur) ne doit
 * jamais empiler deux écouteurs sur le même workspace : c'était la cause des
 * entrées Canvas dupliquées, pas un problème de traduction ou de libellé. */
const registeredPlugins = new WeakSet<object>();

export type FeuilletsPluginLike = {
  app: App;
  settings: FeuilletsSettings;
  registerEvent(evt: EventRef): void;
  saveSettings(): void | Promise<void>;
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

/** Ajoute les branches au Canvas courant sans toucher au vault Markdown.
 * L'API live garde la priorité ; le repli disque reste disponible comme
 * pour les autres actions Carnet et préserve les attributs inconnus. */
async function applyIdeaBranches(
  app: App,
  canvas: MinimalAdvancedCanvas,
  canvasFile: TFile,
  parentId: string,
  raw: string
): Promise<void> {
  const readLive = canvas.getData && canvas.setData && canvas.requestSave;
  let data: CanvasData;
  try {
    data = readLive ? canvas.getData!() : (JSON.parse(await app.vault.read(canvasFile)) as CanvasData);
  } catch {
    new Notice(t("main.notice.canvasUnreadable"));
    return;
  }

  const created = createIdeaBranches(data, parentId, raw);
  if (created.nodes.length === 0) return;
  if (readLive) persistCanvasData(canvas, data);
  else await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
}

/** Vrai si `file` est le Carnet (Tableau brainstorming.canvas) du projet
 * Feuillets actif — jamais un autre .canvas du coffre. */
function isActiveNotebook(plugin: FeuilletsPluginLike, file: TFile | null | undefined): file is TFile {
  if (!file) return false;
  const root = getProjectFolder(plugin.app, plugin.settings);
  if (!root) return false;
  return file.path === canvasPathFor(plugin.app, root);
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

  plugin.registerEvent(
    workspace.on("canvas:selection-menu", (menu, canvas) => {
      const canvasFile = canvas.view?.file;
      if (!isActiveNotebook(plugin, canvasFile)) return;

      let selection: FeuilletsCanvasSelectionData;
      try {
        selection = canvas.getSelectionData?.() || {};
      } catch {
        return;
      }
      const selectedNodes = selection.nodes || [];

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
      if (!isActiveNotebook(plugin, canvasFile)) return;

      let data: FeuilletsCanvasNodeSelectionData | undefined;
      try {
        data = node.getData?.();
      } catch {
        return;
      }
      if (!data) return;

      const full = canvas.getData?.();
      const fullNode = full?.nodes.find((candidate) => candidate.id === data!.id) || data;
      const isManuscriptPath = makeManuscriptPathChecker(plugin.app, plugin.settings);
      const canDevelopTree =
        fullNode.type === "text" ||
        (fullNode.type === "file" && isAdmissibleChapterNode(fullNode, isManuscriptPath));

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
              new CanvasSplitModal(plugin.app, ideaTitle, data!.text || "", (first, second) => {
                void applySplit(plugin.app, canvas, canvasFile, fullNode, first, second);
              }).open();
            })
        );
      }

      if (canDevelopTree) {
        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.developIdeaTree"))
            .setIcon("git-branch")
            .onClick(() => {
              new CanvasIdeaTreeModal(plugin.app, (raw) =>
                applyIdeaBranches(plugin.app, canvas, canvasFile, data!.id, raw)
              ).open();
            })
        );
      }

      if (full && isIdeaTreeNode(full, data.id)) {
        menu.addItem((item) =>
          item
            .setTitle(t("advancedCanvas.nodeMenu.createChapterFromBranch"))
            .setIcon("folder-plus")
            .onClick(() => {
              const fresh = canvas.getData?.() || full;
              const branch = ideaTreeBranch(fresh, data!.id);
              new CanvasChapterModal(
                plugin.app,
                plugin.settings,
                fresh,
                { source: "idea-tree", ids: branch.map((branchNode) => branchNode.id) },
                { persist: livePersist(canvas), saveSettings: () => plugin.saveSettings(), runtimeCanvas: canvas }
              ).open();
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
        const groupNode = full.nodes.find((n) => n.id === data!.id);
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
}
