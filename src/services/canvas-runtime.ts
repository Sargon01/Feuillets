import type { TFile } from "obsidian";
import type { FeuilletsManagedKind } from "./canvas-board.js";

/* Remplacement RUNTIME réel d'un text node par un vrai file node — jamais
 * une simple mise à jour de données JSON (`setData`/`importData`).
 *
 * CAUSE VÉRIFIÉE (voir integrations/advanced-canvas.ts, en-tête, pour
 * l'historique complet des correctifs précédents) : `canvas.setData(data)`
 * comme `canvas.importData(data, true)` ne font, dans le vrai Advanced
 * Canvas/Obsidian, que réappliquer les CHAMPS d'un node sur l'instance
 * runtime déjà en place pour cet id (`node.setData(nodeData)`) — jamais
 * recréer l'instance, donc jamais changer sa CLASSE. Un text node dont
 * `type` est mis à "file" dans le JSON reste donc, tant que l'instance
 * runtime existante n'est pas explicitement remplacée, un TextNode qui
 * continue de rapporter `type:"text"` (sans aperçu Markdown, sans ouverture
 * du vrai fichier, invisible pour toute détection basée sur `type==="file"`
 * comme `isResearchFileNode`). Confirmé sur un test manuel réel dans
 * Obsidian avec Advanced Canvas : `importData(data, true)` N'A PAS
 * matérialisé de vrai file node — cette hypothèse est donc abandonnée
 * comme mécanisme de remplacement de TYPE (elle reste néanmoins un filet de
 * sécurité inoffensif pour les mises à jour de champs sur une instance déjà
 * de la bonne classe, voir `persistCanvasData` dans advanced-canvas.ts).
 *
 * Le SEUL mécanisme qui matérialise réellement un changement de classe est
 * la paire créer/supprimer du contrat Advanced Canvas AUDITÉ (dépôt
 * Developer-Mike/obsidian-advanced-canvas, version 6.5.0,
 * src/@types/Canvas.d.ts — vérifié directement dans le code source, pas
 * seulement les types) :
 *
 *   - `canvas.nodes: Map<string, CanvasNode>` — instances runtime réelles,
 *     jamais le JSON.
 *   - `canvas.createFileNode(options: { pos, size, file: TFile, ... }):
 *     CanvasNode` — crée une VRAIE instance FileNode et L'AJOUTE ELLE-MÊME
 *     à `canvas.nodes` (jamais besoin d'appeler `addNode` ensuite — confirmé
 *     par les deux usages réels audités dans le dépôt : EncapsulateCanvas-
 *     Extension.encapsulateSelection et NodeTemplatesCanvasExtension.
 *     createNodeFromTemplate, qui n'appellent jamais addNode après
 *     createFileNode). Ne reçoit PAS d'id explicite dans aucun usage réel
 *     observé — Obsidian lui en génère un lui-même.
 *   - `canvas.removeNode(node: CanvasNode): void` — retire l'instance de
 *     `canvas.nodes` (usage réel : EncapsulateCanvasExtension —
 *     `canvas.nodes.get(nodeData.id)` puis `canvas.removeNode(node)`).
 *   - `canvas.getEdgesForNode(node: CanvasNode): CanvasEdge[]` — edges
 *     connectées à CE node, présentes dans le contrat audité.
 *   - `node.getData()/setData(data, addHistory?)` et
 *     `edge.getData()/setData(data, addHistory?)` — mise à jour de CHAMPS
 *     sans jamais changer de classe (voir plus haut) ; utilisé ici
 *     UNIQUEMENT pour deux choses saines : (1) recopier géométrie/style sur
 *     la nouvelle instance FileNode déjà de la bonne classe, (2) rediriger
 *     `fromNode`/`toNode` d'une edge EXISTANTE vers le nouvel id — aucune
 *     API `createEdge` documentée n'existe dans le contrat audité, donc
 *     jamais besoin d'en inventer une : une edge existante reste la MÊME
 *     instance, seule sa donnée `fromNode`/`toNode` change.
 *
 * Id : aucun usage réel audité ne permet de forcer l'id du node créé par
 * `createFileNode` — la préférence forte de conserver le même id n'est donc
 * techniquement pas atteignable avec ce contrat ; toutes les edges
 * concernées sont explicitement remappées vers le nouvel id ci-dessous,
 * AVANT la suppression de l'ancien node (un `removeNode` retire
 * vraisemblablement aussi les edges encore attachées à l'id supprimé —
 * les rediriger d'abord les met hors d'atteinte). */

export type RuntimeNodeData = {
  id: string;
  type?: string;
  text?: string;
  file?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  [key: string]: unknown;
};

export type RuntimeEdgeData = {
  id: string;
  fromNode?: string;
  toNode?: string;
  [key: string]: unknown;
};

/** Sous-ensemble structurel de `CanvasNode` (= `CanvasElement`) réellement
 * utilisé ici — `id` est un membre direct de l'instance (pas seulement de
 * `getData()`), confirmé dans le contrat audité. */
export type MinimalRuntimeNode = {
  id: string;
  getData: () => RuntimeNodeData;
  setData: (data: RuntimeNodeData, addHistory?: boolean) => void;
  /** Lot 5 (Arbre d'idées, raccourcis clavier) — `true` tant que l'éditeur
   * (iframe) de ce TextNode est ouvert. Membre runtime standard du Canvas
   * natif/Advanced Canvas, jamais supposé présent : tout code qui le lit le
   * traite comme absent = "non édité" (voir integrations/advanced-
   * canvas.ts, activeSelectionNode). */
  isEditing?: boolean;
  /** Lot 5 — élément DOM réel de la carte, uniquement utilisé pour poser une
   * classe de lisibilité (jamais lu comme source de données) et, pour un
   * TextNode en édition, retrouver l'iframe de son éditeur. */
  nodeEl?: HTMLElement;
};

export type MinimalRuntimeEdgeEnd = {
  node: MinimalRuntimeNode;
  side?: unknown;
  end?: unknown;
  [key: string]: unknown;
};

export type MinimalRuntimeEdge = {
  getData: () => RuntimeEdgeData;
  setData: (data: RuntimeEdgeData, addHistory?: boolean) => void;
  /** Références runtime réelles des extrémités. Advanced Canvas/Obsidian
   * expose `edge.update(from, to)` précisément pour changer le node attaché
   * à une arête ; modifier seulement fromNode/toNode via setData ne suffit
   * pas à maintenir edge.from/edge.to et les index edgeFrom/edgeTo. */
  from?: MinimalRuntimeEdgeEnd;
  to?: MinimalRuntimeEdgeEnd;
  update?: (from: MinimalRuntimeEdgeEnd, to: MinimalRuntimeEdgeEnd) => void;
};

/** Sous-ensemble structurel du `Canvas` réellement utilisé pour le
 * remplacement runtime — distinct de `MinimalAdvancedCanvas`
 * (integrations/advanced-canvas.ts, qui couvre getData/setData/importData/
 * requestSave, la couche JSON) : ce type-ci couvre la couche INSTANCES,
 * jamais mélangée avec la couche JSON dans un même objet de type, pour
 * qu'un faux canvas de test puisse implémenter l'une sans l'autre et
 * refléter fidèlement un contrat partiel. */
export type MinimalRuntimeCanvas = {
  nodes?: Map<string, MinimalRuntimeNode>;
  createFileNode?: (options: {
    pos: { x: number; y: number };
    size: { width: number; height: number };
    file: TFile;
  }) => MinimalRuntimeNode;
  removeNode?: (node: MinimalRuntimeNode) => void;
  getEdgesForNode?: (node: MinimalRuntimeNode) => MinimalRuntimeEdge[];
  requestSave?: () => void;
  /** Lot 5 — sélection courante du Canvas (instances runtime réelles, mêmes
   * objets que les valeurs de `nodes`). Lue seule, jamais écrite : Feuillets
   * ne sélectionne plus jamais automatiquement un node (décision produit —
   * voir integrations/advanced-canvas.ts, `handleIdeaTreeKey`), seulement
   * pour savoir si UN SEUL node est sélectionné avant d'agir sur Tab/Entrée. */
  selection?: Set<MinimalRuntimeNode>;
};

/** Vrai si `canvas` expose l'intégralité du contrat runtime nécessaire au
 * remplacement réel — jamais supposé, toujours vérifié avant emploi. Un
 * Advanced Canvas plus ancien/futur qui manquerait un seul de ces membres
 * fait simplement échouer `replaceTextNodeWithFileNode` (retour `null`),
 * l'appelant retombe alors sur le comportement JSON existant (voir
 * `persistCanvasData`, integrations/advanced-canvas.ts). */
export function hasRuntimeReplaceContract(
  canvas: MinimalRuntimeCanvas
): canvas is MinimalRuntimeCanvas & Required<Pick<MinimalRuntimeCanvas, "nodes" | "createFileNode" | "removeNode" | "getEdgesForNode">> {
  return !!(canvas.nodes && canvas.createFileNode && canvas.removeNode && canvas.getEdgesForNode);
}

export type ReplaceResult = { newId: string };

/** Remplace RÉELLEMENT, au runtime, le TextNode `oldNodeId` par un vrai
 * FileNode pointant vers `file` — helper UNIQUE et commun aux trois usages
 * qui en ont besoin : Lot 1 idée→feuillet, Lot 1 idée→fiche Recherche, Lot 2
 * text node→scène pendant création de chapitre (voir services/canvas-
 * bridge.ts `applySelectedIdeas` et services/canvas-chapter.ts
 * `executeChapterPlan`, qui l'appellent tous les deux) — jamais trois
 * implémentations distinctes.
 *
 * Retourne le nouvel id si le remplacement a eu lieu, `null` si `canvas'
 * n'expose pas le contrat requis (voir `hasRuntimeReplaceContract`) ou si
 * `oldNodeId` n'existe plus dans `canvas.nodes` — dans les deux cas,
 * l'appelant doit se rabattre sur le chemin JSON existant.
 *
 * Position/taille/couleur/styleAttributes/dynamicHeight/zIndex et toute
 * propriété inconnue de l'ancien node sont recopiées sur le nouveau ; seuls
 * `id`/`type`/`text`/`file` diffèrent structurellement (comme
 * `convertTextNodeToFileNode`, canvas-bridge.ts, dont ce helper reprend
 * exactement la même logique de préservation — mais appliquée à une vraie
 * instance FileNode plutôt qu'à un objet JSON). */
export function replaceTextNodeWithFileNode(
  canvas: MinimalRuntimeCanvas,
  oldNodeId: string,
  file: TFile,
  managed: FeuilletsManagedKind
): ReplaceResult | null {
  if (!hasRuntimeReplaceContract(canvas)) return null;
  const oldNode = canvas.nodes.get(oldNodeId);
  if (!oldNode) return null;

  const oldData = oldNode.getData();
  const connectedEdges = canvas.getEdgesForNode(oldNode);

  /* IMPORTANT : une edge Canvas possède deux représentations en parallèle :
   * les ids sérialisés (`fromNode`/`toNode`) ET les références runtime
   * (`edge.from.node`/`edge.to.node`, plus les index internes edgeFrom/edgeTo).
   * Advanced Canvas utilise lui-même `edge.update(from, to)` lorsqu'il change
   * l'extrémité d'une arête (FlipEdgeCanvasExtension). `edge.setData()` est
   * réservé aux champs de données et, en plus, Advanced Canvas le patch pour
   * déclencher immédiatement une sauvegarde. On refuse donc le swap runtime
   * si une edge connectée n'expose pas le contrat d'update réel. */
  for (const edge of connectedEdges) {
    if (!edge.from || !edge.to || !edge.update) return null;
  }

  const { id: _oldId, type: _oldType, text: _oldText, file: _oldFile, ...rest } = oldData;

  const newNode = canvas.createFileNode({
    pos: { x: oldData.x ?? 0, y: oldData.y ?? 0 },
    size: { width: oldData.width ?? 0, height: oldData.height ?? 0 },
    file,
  });
  const newId = newNode.id;

  // Rediriger d'abord les références RUNTIME des edges vers le nouveau node.
  // `edge.update` maintient aussi les structures internes Canvas associées aux
  // extrémités ; un simple edge.setData({fromNode/toNode}) ne le garantit pas.
  for (const edge of connectedEdges) {
    const from = edge.from!;
    const to = edge.to!;
    edge.update!(
      from.node.id === oldNodeId ? { ...from, node: newNode } : from,
      to.node.id === oldNodeId ? { ...to, node: newNode } : to
    );
  }

  // L'ancien TextNode peut maintenant disparaître sans emporter les edges :
  // elles ne lui sont plus attachées au runtime.
  canvas.removeNode(oldNode);

  // Appliquer géométrie/style seulement APRÈS la suppression de l'ancien
  // node. Advanced Canvas patch `node.setData()` pour appeler requestSave()
  // immédiatement : placé ici, cet autosave ne peut plus sérialiser l'état
  // transitoire « ancien TextNode + nouveau FileNode ». Cette distinction est
  // cruciale quand un fileManager.renameFile() de Recherche suit : Obsidian
  // met alors à jour les références du .canvas et peut le recharger.
  //
  // Distinction visuelle automatique (simplification Carnet, section 3) :
  // même règle que `convertTextNodeToFileNode` (canvas-bridge.ts) — une
  // couleur Canvas stable seulement pour une fiche Recherche qui n'en
  // portait pas déjà une explicitement, jamais écrasée sinon.
  const color = managed === "research" && !rest.color ? "6" : rest.color;
  newNode.setData(
    { ...newNode.getData(), ...rest, id: newId, type: "file", file: file.path, feuillets_managed: managed, color },
    false
  );

  return { newId };
}
