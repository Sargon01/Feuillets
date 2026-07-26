import { normalizePath, Notice } from "obsidian";
import { getProjectFolder, flattenFiles, resourcesFolderPath } from "./folder-structure.js";
import { fmOf, labelOf, labelColor } from "./frontmatter.js";
import { ensureFolder } from "./project-files.js";
import { filsOf } from "../utils/arc-fields.js";

const NODE_W = 320;
const NODE_H = 220;
const GAP_X = 40;
const GAP_Y = 40;
const COLS = 5;

function generateId() {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function canvasPathFor(app, root) {
  return normalizePath(`${resourcesFolderPath(app, root)}/Tableau brainstorming.canvas`);
}

/** Équivalents de isFrontMatter/roleOfFile (folder-structure.js), mais
 * paramétrés avec un `root` déjà connu au lieu de le redéduire à chaque
 * appel via getProjectFolder — sur 100 scènes, ça évitait ~300 appels
 * redondants à app.vault.getAbstractFileByPath rien que pour filtrer la
 * liste des scènes. Logique strictement identique, juste sans le travail
 * répété. */
function isFrontWithRoot(root, node) {
  const p = `${root.path}/Front`;
  return node.path === p || node.path.startsWith(`${p}/`);
}
function roleOfFileWithRoot(settings, root, file) {
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
 * Les cartes déjà présentes gardent EXACTEMENT leur position — seules les
 * scènes nouvelles (jamais vues) ou disparues (supprimées/déplacées hors
 * projet) sont ajoutées/retirées, pour ne jamais détruire un arrangement
 * manuel déjà en place.
 *
 * Ce tableau est volontairement indépendant de l'ordre réel du manuscrit,
 * comme le mode "freeform" du corkboard de Scrivener : le déplacer ici ne
 * réordonne rien dans le binder — c'est un espace de brainstorming, pas
 * une seconde source de vérité pour la séquence des scènes. */
export async function generateCanvasBoard(app, settings) {
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

  let canvas = { nodes: [], edges: [] };
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) {
    try {
      const raw = await app.vault.read(existing);
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.nodes)) canvas = parsed;
    } catch {
      new Notice("Tableau canvas existant illisible — reconstruit à neuf (rien n'a été écrasé sur le disque avant que tu ne confirmes).");
      canvas = { nodes: [], edges: [] };
    }
  }
  if (!Array.isArray(canvas.nodes)) canvas.nodes = [];
  if (!Array.isArray(canvas.edges)) canvas.edges = [];

  // Retire les cartes dont le fichier n'appartient plus au projet (scène
  // supprimée ou déplacée hors du manuscrit).
  const scenePaths = new Set(scenes.map((f) => f.path));
  canvas.nodes = canvas.nodes.filter((n) => n.type !== "file" || scenePaths.has(n.file));
  const nodeIds = new Set(canvas.nodes.map((n) => n.id));
  canvas.edges = canvas.edges.filter((e) => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode));

  // Nouvelles cartes : placées en dessous de tout ce qui existe déjà, en
  // grille, jamais superposées à un arrangement déjà en place. La couleur
  // est en revanche toujours resynchronisée sur le label actuel du
  // feuillet — y compris pour une carte déjà présente — puisqu'un label
  // ajouté ou changé après coup doit se refléter ; seule la POSITION
  // (voulue par toi) est intouchable une fois posée.
  let maxY = -GAP_Y;
  for (const n of canvas.nodes) {
    const bottom = (n.y || 0) + (n.height || NODE_H);
    if (bottom > maxY) maxY = bottom;
  }
  let col = 0;
  let added = 0;
  const nodeByFileSoFar = new Map();
  for (const n of canvas.nodes) if (n.type === "file") nodeByFileSoFar.set(n.file, n);

  for (const file of scenes) {
    const label = labelOf(app, file);
    const color = label ? labelColor(settings, label) : undefined;
    const existingNode = nodeByFileSoFar.get(file.path);
    if (existingNode) {
      if (color) existingNode.color = color;
      else delete existingNode.color;
      continue;
    }
    const node = {
      id: generateId(),
      type: "file",
      file: file.path,
      x: col * (NODE_W + GAP_X),
      y: maxY + GAP_Y,
      width: NODE_W,
      height: NODE_H,
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
  // à chaque génération : on retire d'abord UNIQUEMENT celles qu'on a
  // nous-mêmes créées (marquées par le champ "fil") — une arête que tu as
  // tracée toi-même à la main sur le canvas n'a pas ce champ et n'est
  // jamais touchée.
  // "feuillets_fil" : ancien nom du marqueur (une seule génération l'a
  // jamais utilisé) — filtré ici aussi une fois pour toutes, migration
  // silencieuse vers "fil" sans dupliquer les arêtes déjà tracées.
  canvas.edges = canvas.edges.filter((e) => !e.fil && !e.feuillets_fil);
  const nodeByFile = new Map();
  for (const n of canvas.nodes) {
    if (n.type === "file") nodeByFile.set(n.file, n);
  }
  const byFil = new Map();
  for (const file of scenes) {
    for (const value of filsOf(fmOf(app, file))) {
      if (!byFil.has(value)) byFil.set(value, []);
      byFil.get(value).push(file);
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
        fil: value,
      });
      edgesAdded++;
    }
  }

  const content = JSON.stringify(canvas, null, "\t");
  let file;
  if (existing) {
    await app.vault.modify(existing, content);
    file = existing;
  } else {
    file = await app.vault.create(path, content);
  }

  return { file, added, edgesAdded, total: canvas.nodes.length };
}
