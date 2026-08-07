import { Notice, TFolder } from "obsidian";
import type { App, EventRef, Menu, TFile } from "obsidian";
import { t } from "../i18n/index.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { canvasPathFor, type CanvasData } from "../services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../ui/canvas-bridge-modal.js";
import { applySelectedIdeas, deriveTitle, type BridgeMode } from "../services/canvas-bridge.js";
import { getResearchRoot, researchFolderPath } from "../services/research.js";
import { ensureFolder } from "../services/project-files.js";

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

type FeuilletsCanvasNodeSelectionData = { id: string; type?: string; text?: string };
type FeuilletsCanvasSelectionData = { nodes?: FeuilletsCanvasNodeSelectionData[] };

/** Sous-ensemble structurel du `Canvas` d'Advanced Canvas réellement utilisé
 * ici. `getData`/`setData`/`requestSave` sont optionnels dans ce type local :
 * s'ils manquent à l'exécution (version future incompatible, hôte
 * différent…), le code bascule sur le repli disque plutôt que de supposer
 * leur présence — voir `applyViaBridge`. */
export type MinimalAdvancedCanvas = {
  view?: { file?: TFile | null };
  getSelectionData?: () => FeuilletsCanvasSelectionData;
  getData?: () => CanvasData;
  setData?: (data: CanvasData) => void;
  requestSave?: () => void;
};

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

export type FeuilletsPluginLike = {
  app: App;
  settings: FeuilletsSettings;
  registerEvent(evt: EventRef): void;
};

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
    const setData = canvas.setData;
    const requestSave = canvas.requestSave;
    new CanvasBridgeModal(app, settings, canvasFile, data, mode, {
      preselectedIds: ids,
      persist: (updated) => {
        setData(updated);
        requestSave();
      },
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
  mode: BridgeMode
): Promise<void> {
  if (canvas.getData && canvas.setData && canvas.requestSave) {
    const data = canvas.getData();
    const result = await applySelectedIdeas(app, data, [nodeId], destFolder, mode);
    canvas.setData(data);
    canvas.requestSave();
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
  const result = await applySelectedIdeas(app, data, [nodeId], destFolder, mode);
  await app.vault.modify(canvasFile, JSON.stringify(data, null, "\t"));
  new Notice(t("modal.canvasBridge.done", { count: String(result.created) }));
}

/** Résout la racine Recherche du projet actif pour l'action node-menu
 * « Transformer en fiche Recherche » — reprend le dossier déjà présent sur
 * le disque quel que soit son nom, sinon crée uniquement la racine (jamais
 * de sous-dossier métier), même règle que le repli universel
 * (CanvasBridgeModal). */
async function resolveResearchDestination(app: App, settings: FeuilletsSettings): Promise<TFolder | null> {
  const existing = getResearchRoot(app, settings);
  if (existing) return existing;
  const root = getProjectFolder(app, settings);
  const path = researchFolderPath(app, settings, root);
  if (!path) return null;
  return (await ensureFolder(app, path)) as TFolder;
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
      const textIds = (selection.nodes || [])
        .filter((n) => n.type === "text")
        .map((n) => n.id);
      if (textIds.length === 0) return;

      const singular = textIds.length === 1;
      addSelectionMenuItems(menu, plugin, canvas, canvasFile, textIds, {
        manuscript: t(singular ? "advancedCanvas.toManuscriptSingular" : "advancedCanvas.toManuscript"),
        research: t(singular ? "advancedCanvas.toResearchSingular" : "advancedCanvas.toResearch"),
      });
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
      // Section 4 : seuls les text nodes reçoivent une action dans ce
      // correctif — file/group/link restent sans action nouvelle ici.
      if (!data || data.type !== "text") return;

      const nodeId = data.id;
      const ideaTitle = deriveTitle(data.text || "") || t("modal.canvasBridge.untitledIdea");

      menu.addItem((item) =>
        item
          .setTitle(t("advancedCanvas.nodeMenu.toManuscript"))
          .setIcon("book-open")
          .onClick(() => {
            new CanvasNodeToManuscriptModal(plugin.app, plugin.settings, ideaTitle, (folder) => {
              void applyNodeDirectly(plugin.app, canvas, canvasFile, nodeId, folder, "manuscript");
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
    })
  );
}
