import { normalizePath, Notice } from "obsidian";
import type { App, TFile, TFolder } from "obsidian";
import { getProjectFolder, flattenFiles, resourcesFolderPath } from "./folder-structure.js";
import { fmOf, labelOf, labelColor } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { filsOf } from "../utils/arc-fields.js";

const NODE_W = 320;
const NODE_H = 220;
const GAP_X = 40;
const GAP_Y = 40;
const COLS = 5;

/** Valeurs possibles du marqueur `feuillets_managed` posé sur les nodes/edges
 * que Feuillets crée lui-même sur le Tableau brainstorming — jamais posé sur
 * un élément que l'autrice a créé ou déposé à la main (voir canvas-bridge.ts
 * pour "manuscript"/"research" sur les nodes issus d'une idée convertie). */
export type FeuilletsManagedKind = "manuscript" | "research" | "thread";

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
  feuillets_managed?: FeuilletsManagedKind;
  [key: string]: unknown;
};

export type CanvasEdge = {
  id: string;
  fromNode?: string;
  toNode?: string;
  /* "fil"/"feuillets_fil" : anciens marqueurs des arêtes de fils créées par
     Feuillets (avant feuillets_managed) — reconnus en lecture pour toujours,
     jamais réécrits (voir isFeuilletsThreadEdge). */
  fil?: string;
  feuillets_fil?: string;
  feuillets_managed?: FeuilletsManagedKind;
  [key: string]: unknown;
};

export type CanvasData = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

function generateId(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Chemin du tableau de brainstorming du projet actif — exporté : le pont
 * Canvas (commandes "passer au manuscrit"/"transformer en notes de
 * recherche", intégration Advanced Canvas) doit localiser exactement le même
 * fichier que celui que ce module génère/met à jour, jamais un second chemin
 * recalculé indépendamment. */
export function canvasPathFor(app: App, root: TFolder): string {
  return normalizePath(`${resourcesFolderPath(app, root)}/Tableau brainstorming.canvas`);
}

/** Une arête est reconnue comme une arête de fil posée par Feuillets si elle
 * porte le marqueur actuel (feuillets_managed:"thread") OU un des deux noms
 * hérités ("fil"/"feuillets_fil") — jamais parce que son `label` correspond
 * au nom d'un fil narratif : un lien tracé à la main qui porte par hasard le
 * même texte que le fil ne doit jamais être confondu avec une arête générée. */
function isFeuilletsThreadEdge(e: CanvasEdge): boolean {
  return e.feuillets_managed === "thread" || !!e.fil || !!e.feuillets_fil;
}

/** Équivalents de isFrontMatter/roleOfFile (folder-structure.js), mais
 * paramétrés avec un `root` déjà connu au lieu de le redéduire à chaque
 * appel via getProjectFolder — sur 100 scènes, ça évitait ~300 appels
 * redondants à app.vault.getAbstractFileByPath rien que pour filtrer la
 * liste des scènes. Logique strictement identique, juste sans le travail
 * répété. */
function isFrontWithRoot(root: TFolder, node: TFile | TFolder): boolean {
  const p = `${root.path}/Front`;
  return node.path === p || node.path.startsWith(`${p}/`);
}
function roleOfFileWithRoot(settings: FeuilletsSettings, root: TFolder, file: TFile): "chapitre" | "scene" {
  const parent = file.parent;
  if (!parent || parent.path === root.path) return "chapitre";
  const depth = parent.path === root.path
    ? 0
    : parent.path.slice(root.path.length + 1).split("/").length;
  const parentRole = depth >= 2 ? "chapitre" : (settings.level1Role === "chapitres" ? "chapitre" : "partie");
  return parentRole === "chapitre" ? "scene" : "chapitre";
}

/** Génère ou met à jour le tableau canvas de brainstorming du projet actif :
 * une carte-fichier par scène/chapitre, colorée selon le label du feuillet.
 *
 * INVARIANT NON DESTRUCTIF — le Tableau appartient à l'autrice, pas à
 * Feuillets : cette fonction n'ajoute que ce qui manque, elle ne retire
 * JAMAIS un node existant (text, group, link, file externe, note Recherche,
 * ancienne carte de scène supprimée…), ne déplace ni ne redimensionne rien,
 * et ne retire une arête que si Feuillets l'a lui-même posée (marquée
 * feuillets_managed:"thread", ou l'un des deux noms hérités "fil"/
 * "feuillets_fil"). Une connexion tracée à la main n'est jamais touchée,
 * même si son `label` correspond au nom d'un fil.
 *
 * Ce tableau est volontairement indépendant de l'ordre réel du manuscrit,
 * comme le mode "freeform" du corkboard de Scrivener : le déplacer ici ne
 * réordonne rien dans le binder — c'est un espace de brainstorming, pas
 * une seconde source de vérité pour la séquence des scènes. */
export async function generateCanvasBoard(app: App, settings: FeuilletsSettings): Promise<{ file: TFile; added: number; edgesAdded: number; total: number } | null> {
  const root = getProjectFolder(app, settings);
  if (!root) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }

  const scenes = flattenFiles(app, settings, root).filter(
    (f) =>
      f.extension === "md" &&
      !isFrontWithRoot(root, f) &&
      ["scene", "chapitre"].includes(roleOfFileWithRoot(settings, root, f))
  );

  const path = canvasPathFor(app, root);
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));

  let canvas: CanvasData = { nodes: [], edges: [] };
  const existing = app.vault.getAbstractFileByPath(path) as TFile | null;
  if (existing) {
    try {
      const raw = await app.vault.read(existing);
      const parsed = JSON.parse(raw) as CanvasData;
      if (parsed && Array.isArray(parsed.nodes)) canvas = parsed;
    } catch {
      new Notice("Tableau canvas existant illisible — reconstruit à neuf (rien n'a été écrasé sur le disque avant que tu ne confirmes).");
      canvas = { nodes: [], edges: [] };
    }
  }
  if (!Array.isArray(canvas.nodes)) canvas.nodes = [];
  if (!Array.isArray(canvas.edges)) canvas.edges = [];

  /* Nettoyage défensif minimal : une arête dont l'un des deux bouts pointe
     vers un id qui n'existe nulle part dans le tableau (fichier supprimé
     directement dans le coffre, hors de Feuillets) est déjà une référence
     cassée pour Obsidian lui-même — la retirer ici n'efface aucune donnée
     valide, aucun node existant n'est jamais supprimé par ce module. */
  const nodeIds = new Set(canvas.nodes.map((n) => n.id));
  canvas.edges = canvas.edges.filter((e) => nodeIds.has(e.fromNode as string) && nodeIds.has(e.toNode as string));

  // Nouvelles cartes : placées en dessous de tout ce qui existe déjà, en
  // grille, jamais superposées à un arrangement déjà en place. La couleur
  // est en revanche toujours resynchronisée sur le label actuel du
  // feuillet — y compris pour une carte déjà présente — puisqu'un label
  // ajouté ou changé après coup doit se refléter ; seule la POSITION
  // (voulue par toi) est intouchable une fois posée. Ce resync ne s'applique
  // qu'aux cartes que Feuillets gère réellement : celles déjà marquées
  // feuillets_managed:"manuscript", ou une carte-fichier héritée d'une
  // génération antérieure à ce marqueur (elle est alors migrée dessus,
  // même principe que la migration fil/feuillets_fil→thread plus bas) — un
  // fichier de scène simplement glissé à la main sur le tableau n'est en
  // revanche jamais recoloré ni marqué : impossible de le distinguer d'une
  // ancienne carte Feuillets sans indice, donc traité comme tel par
  // compatibilité ; toute carte future (dès cette version) porte le
  // marqueur dès sa création et ce cas ambigu ne se reproduira plus.
  let maxY = -GAP_Y;
  for (const n of canvas.nodes) {
    const bottom = (n.y || 0) + (n.height || NODE_H);
    if (bottom > maxY) maxY = bottom;
  }
  let col = 0;
  let added = 0;
  const nodeByFileSoFar = new Map<string, CanvasNode>();
  for (const n of canvas.nodes) if (n.type === "file" && n.file) nodeByFileSoFar.set(n.file as string, n);

  for (const file of scenes) {
    const label = labelOf(app, file);
    const color = label ? labelColor(settings, label) : undefined;
    const existingNode = nodeByFileSoFar.get(file.path);
    if (existingNode) {
      existingNode.feuillets_managed = "manuscript";
      if (color) existingNode.color = color;
      else delete existingNode.color;
      continue;
    }
    const node: CanvasNode = {
      id: generateId(),
      type: "file",
      file: file.path,
      x: col * (NODE_W + GAP_X),
      y: maxY + GAP_Y,
      width: NODE_W,
      height: NODE_H,
      feuillets_managed: "manuscript",
    };
    if (color) node.color = color;
    canvas.nodes.push(node);
    added++;
    col++;
    if (col >= COLS) {
      col = 0;
      maxY += GAP_Y + NODE_H;
    }
  }

  // Arêtes des fils narratifs : on relie dans l'ordre du manuscrit les
  // feuillets qui partagent une même valeur de fil: — plantation vers
  // résolution (ou vers le marqueur en attente si pas encore résolu, les
  // deux portent la même valeur tant que ce n'est pas réglé). Reconstruites
  // à chaque génération : on retire d'abord UNIQUEMENT celles que Feuillets
  // a lui-même posées (isFeuilletsThreadEdge) — une arête tracée à la main
  // sur le canvas, même avec le même label qu'un fil, n'est jamais touchée.
  canvas.edges = canvas.edges.filter((e) => !isFeuilletsThreadEdge(e));
  const nodeByFile = new Map<string, CanvasNode>();
  for (const n of canvas.nodes) {
    if (n.type === "file" && n.file) nodeByFile.set(n.file as string, n);
  }
  const byFil = new Map<string, TFile[]>();
  for (const file of scenes) {
    for (const value of filsOf(fmOf(app, file))) {
      if (!byFil.has(value)) byFil.set(value, []);
      byFil.get(value)?.push(file);
    }
  }
  let edgesAdded = 0;
  for (const [value, files] of byFil) {
    if (files.length < 2) continue; // un seul feuillet porte encore ce fil : rien à relier
    const color = labelColor(settings, value) || undefined;
    for (let i = 0; i < files.length - 1; i++) {
      const fromNode = nodeByFile.get(files[i].path);
      const toNode = nodeByFile.get(files[i + 1].path);
      if (!fromNode || !toNode) continue;
      canvas.edges.push({
        id: generateId(),
        fromNode: fromNode.id,
        fromSide: "right",
        toNode: toNode.id,
        toSide: "left",
        color,
        label: value,
        feuillets_managed: "thread",
      });
      edgesAdded++;
    }
  }

  const content = JSON.stringify(canvas, null, "\t");
  let file: TFile;
  if (existing) {
    await app.vault.modify(existing, content);
    file = existing;
  } else {
    file = await app.vault.create(path, content);
  }

  return { file, added, edgesAdded, total: canvas.nodes.length };
}
