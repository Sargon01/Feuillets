/** Types shared by the Canvas boundary.  Canvas is deliberately permissive:
 * plugins may add fields which Feuillets does not know about. */
export type CanvasNode = {
  id: string;
  type?: string;
  text?: string;
  file?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  feuillets_managed?: "manuscript" | "research" | "thread";
  /** Groupe Canvas natif délimitant un bloc Feuillets, porté UNIQUEMENT par
   * le node `type: "group"` qui
   * délimite le bloc. */
  feuillets_block?: "mindmap" | "relations";
  feuillets_block_version?: 1;
  /** Porté par le groupe ET par chaque node membre du bloc (même uuid) —
   * voir src/carnet/blocks/mindmap/model.ts. */
  feuillets_block_id?: string;
  /** IDs des nodes Mindmap actuellement repliés, portée par le groupe
   * uniquement (voir src/carnet/blocks/mindmap/interactions.ts). */
  mindmapCollapsed?: string[];
  /** Plan Binder (Prompt 3/5) — porté par le seul TextNode Plan du Carnet.
   * `feuillets_binder_plan`/`feuillets_binder_items` restent lus pour la
   * compatibilité (§13) ; le modèle courant vit dans `feuillets_plan_items`
   * (items à UUID stables) + `feuillets_plan_version`. */
  feuillets_binder_plan?: string;
  feuillets_binder_root?: string;
  feuillets_binder_items?: unknown;
  feuillets_binder_fingerprint?: string;
  feuillets_binder_dirty?: boolean;
  feuillets_binder_ui_version?: number;
  feuillets_plan_items?: unknown;
  feuillets_plan_version?: number;
  /** Orientation du layout, portée par le groupe uniquement — absence de
   * champ = "horizontal" (compatibilité, voir layout.ts). Ne change jamais
   * le modèle parent/enfant, uniquement la géométrie. */
  mindmapOrientation?: "horizontal" | "vertical";
  [key: string]: unknown;
};

export type CanvasEdge = {
  id: string;
  fromNode?: string;
  toNode?: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  /** Champs NATIFS du format `.canvas` (pas spécifiques à Feuillets) —
   * étiquette affichée sur l'edge et style des embouts. Prompt 4 les
   * réutilise tels quels pour Relations (label facultatif) et Généalogie
   * (parent→enfant fléché, conjoints en simple trait `toEnd: "none"`) :
   * jamais un rendu Feuillets custom, le Canvas natif les affiche déjà. */
  label?: string;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  fil?: string;
  feuillets_fil?: string;
  feuillets_managed?: "manuscript" | "research" | "thread" | "idea-tree" | "mindmap" | "relations";
  /** Même uuid que le node membre — seule une edge portant CE marqueur ET
   * ce même id est structurelle pour le moteur Mindmap (§2 du correctif),
   * ou pour un bloc Relations/Généalogie (Prompt 4, même discipline). */
  feuillets_block_id?: string;
  /** Relations (Prompt 4) — identité STABLE de la relation elle-même,
   * distincte de `id` (qui reste l'id Canvas de l'edge). */
  feuillets_relation_id?: string;
  /** Généalogie (Prompt 4) — nature de la relation portée par CETTE edge.
   * `parent-child` : dirigée, `fromNode` = parent, `toNode` = enfant.
   * `spouse` : non dirigée sémantiquement (le sens fromNode/toNode Canvas
   * reste arbitraire, jamais interprété comme une hiérarchie). */
  feuillets_relation?: "parent-child" | "spouse";
  [key: string]: unknown;
};

export type CanvasData = { nodes: CanvasNode[]; edges: CanvasEdge[] };

export type LiveCanvasFileView = {
  file?: import("obsidian").TFile | null;
  getViewData(): string;
  setViewData(data: string, clear: boolean): void;
  requestSave(): void;
};
