import { normalizePath, TFile } from "obsidian";
import type { App, TFolder } from "obsidian";
import type { CanvasData, CanvasNode } from "./canvas-board.js";
import type { MinimalRuntimeCanvas } from "./canvas-runtime.js";
import { replaceTextNodeWithFileNode } from "./canvas-runtime.js";

/* Pont Canvas → manuscrit/recherche : logique de lecture/transformation pure
 * du JSON Canvas (aucun accès à l'App sauf applySelectedIdeas, seule
 * fonction de ce module qui écrit réellement des fichiers). Utilisée aussi
 * bien par la modale de repli (canvas-bridge-modal.ts, sans Advanced
 * Canvas) que par l'intégration optionnelle (integrations/advanced-
 * canvas.ts) — une seule implémentation des règles de transformation pour
 * les deux chemins. */

/** Un text node du Canvas — jamais un node file/group/link. */
export function textNodesOf(canvas: CanvasData): CanvasNode[] {
  return (canvas.nodes || []).filter((n) => n.type === "text" && typeof n.text === "string");
}

/** Tri spatial déterministe : haut → bas, puis gauche → droite ; à égalité
 * stricte de position, l'id départage pour ne jamais dépendre de l'ordre
 * d'itération du tableau JSON. */
export function sortNodesSpatially(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => {
    const ay = a.y || 0, by = b.y || 0;
    if (ay !== by) return ay - by;
    const ax = a.x || 0, bx = b.x || 0;
    if (ax !== bx) return ax - bx;
    return a.id.localeCompare(b.id);
  });
}

/** Première ligne non vide d'un texte — sert de base au titre. Chaîne vide
 * si le texte ne contient aucune ligne non vide. */
export function firstMeaningfulLine(text: string): string {
  const lines = (text || "").split(/\r?\n/);
  for (const line of lines) {
    if (line.trim()) return line.trim();
  }
  return "";
}

/** Retire uniquement les marqueurs Markdown évidents en tête de ligne
 * (titres #, listes à puces, citation >, numérotée) — jamais le contenu,
 * une astérisque au milieu du texte reste telle quelle. */
export function deriveTitle(text: string): string {
  const line = firstMeaningfulLine(text);
  const title = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^>\s+/, "")
    .trim();
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}…` : title;
}

/** Corps du feuillet : tout ce qui suit la première ligne significative,
 * tel quel (aucune autre transformation) — vide si l'idée tenait sur une
 * seule ligne. */
export function bodyAfterTitle(text: string): string {
  return text || "";
}

/** Nom de fichier sûr dérivé d'un titre — caractères interdits par le
 * système de fichiers retirés, jamais vide (repli sur "Idée"). */
export function safeFileName(title: string): string {
  const cleaned = (title || "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned || "Idée";
}

/** Nom de fichier .md sans collision dans un dossier donné : "Nom.md", puis
 * "Nom 2.md", "Nom 3.md"… `exists` teste un chemin normalisé complet — pur,
 * ne touche pas le vault (le vault réel ou un faux en test lui sont passés
 * indifféremment). */
export function uniqueFileName(exists: (path: string) => boolean, folderPath: string, baseName: string): string {
  const safe = safeFileName(baseName);
  let candidate = normalizePath(`${folderPath}/${safe}.md`);
  if (!exists(candidate)) return candidate;
  let n = 2;
  for (;;) {
    candidate = normalizePath(`${folderPath}/${safe} ${n}.md`);
    if (!exists(candidate)) return candidate;
    n++;
  }
}

/** Génère un id Canvas neuf. Un changement de type text→file ne réutilise
 * jamais l'ancien id dans le Canvas live : Obsidian peut conserver la classe
 * runtime associée à un id existant. Avec un id neuf, `importData(..., true)`
 * crée nécessairement une nouvelle instance pour le nouveau node. */
export function freshCanvasNodeId(canvas: CanvasData): string {
  const used = new Set(canvas.nodes.map((n) => n.id));
  const chars = "0123456789abcdef";
  for (;;) {
    let id = "";
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!used.has(id)) return id;
  }
}

/** Couleur Canvas native (préréglage numérique "1".."6" du Canvas
 * d'Obsidian — jamais un hex arbitraire) posée automatiquement sur toute
 * carte qui devient une fiche Recherche depuis le Carnet, pour qu'on la
 * distingue d'un coup d'œil d'une note libre ou d'un feuillet — simple
 * distinction visuelle, sans AUCUN effet métier (voir RESEARCH_NODE_COLOR
 * en tête de fichier pour le choix). "6" (violet) : jamais utilisée par les
 * cartes de scène (celles-ci portent la couleur hex du label, voir
 * services/canvas-board.ts `labelColor`), donc jamais de collision visuelle
 * avec un feuillet coloré par son label. */
const RESEARCH_NODE_COLOR = "6";

/** Convertit un text node en file node — copie de TOUTES les propriétés
 * inconnues (styleAttributes, dynamicHeight, zIndex, couleur, position,
 * taille… tout ce qu'Advanced Canvas ou une future version peut y avoir
 * posé), retire seulement `text` (incompatible avec le type "file"), fixe
 * `type`/`file`/`feuillets_managed`. L'id, x, y, width, height et toute
 * autre extension restent strictement inchangés — les arêtes existantes
 * référencent cet id et doivent continuer à le retrouver tel quel.
 *
 * Distinction visuelle automatique (simplification Carnet, section 3) :
 * pour une conversion en fiche Recherche (`managed === "research"`), une
 * couleur Canvas stable est posée SEULEMENT si la carte n'en portait pas
 * déjà une explicitement — une personnalisation manuelle de l'autrice sur
 * la note d'origine n'est jamais écrasée. */
export function convertTextNodeToFileNode(node: CanvasNode, filePath: string, managed: "manuscript" | "research"): CanvasNode {
  const { text: _text, ...rest } = node;
  const converted: CanvasNode = {
    ...rest,
    type: "file",
    file: filePath,
    feuillets_managed: managed,
  };
  if (managed === "research" && !converted.color) {
    converted.color = RESEARCH_NODE_COLOR;
  }
  return converted;
}

/** Frontmatter minimal d'un feuillet créé depuis une idée Canvas : seul
 * `title` est écrit — indispensable ici parce que le nom de fichier peut
 * porter un suffixe de désambiguïsation ("Idée 2.md") que le titre affiché
 * ne doit pas montrer ; aucun autre champ du squelette habituel (status,
 * label, characters, pov, thread, date, arc…) n'est pré-rempli. */
export function manuscriptSheetContent(title: string, body: string): string {
  const lines = ["---", `title: ${JSON.stringify(title)}`, "---", "", body, ""];
  return lines.join("\n");
}

/** Note de recherche libre créée depuis une idée Canvas : même principe
 * minimal, aucun champ métier (personnage/lieu/…) imposé. */
export function researchNoteContent(title: string, body: string): string {
  return manuscriptSheetContent(title, body);
}

export type BridgeMode = "manuscript" | "research";

/** Résout le fichier Markdown cible pour convertir `node` (déjà réputé text
 * node) — réutilise le fichier déjà créé si `node.file` pointe vers un
 * fichier réellement présent sur le disque (artefact d'une conversion
 * antérieure interrompue AVANT le remplacement runtime réel — le type est
 * alors resté "text" mais le fichier existe bel et bien, voir services/
 * canvas-runtime.ts) : jamais un second Markdown créé dans ce cas
 * (« scène 2.md » puis « scène 2 1.md » à chaque nouvelle tentative). Sinon
 * crée un nouveau fichier via le pipeline habituel (titre dérivé, contenu
 * minimal, nom sans collision). `wasCreated` distingue les deux cas pour
 * l'appelant (ex. rollback : ne jamais supprimer un fichier réutilisé qui
 * préexistait). */
export async function resolveOrCreateSheetFile(
  app: App,
  node: CanvasNode,
  destFolder: TFolder,
  mode: BridgeMode,
  titleOverride?: string
): Promise<{ file: TFile; wasCreated: boolean }> {
  if (typeof node.file === "string") {
    const existing = app.vault.getAbstractFileByPath(node.file);
    if (existing instanceof TFile) return { file: existing, wasCreated: false };
  }
  const title = titleOverride?.trim() || deriveTitle(node.text || "") || "Idée";
  const body = node.text || "";
  const path = uniqueFileName(
    (p) => !!app.vault.getAbstractFileByPath(p),
    destFolder.path,
    title
  );
  const content = mode === "manuscript" ? manuscriptSheetContent(title, body) : researchNoteContent(title, body);
  const file = await app.vault.create(path, content);
  return { file, wasCreated: true };
}

/** Résultat d'une conversion appliquée au tableau : combien de fichiers ont
 * réellement été traités (créés ou réparés/réutilisés), les ids ignorés
 * (déjà convertis, ou introuvables dans `canvas` au moment de l'appel), et
 * la correspondance ancien id → id EFFECTIF après l'opération — identique à
 * l'ancien id si le remplacement runtime n'a pas eu lieu (JSON seul, id
 * inchangé) ou n'était pas applicable (`runtimeCanvas` absent), différent
 * si un vrai FileNode a été créé avec un nouvel id (voir services/
 * canvas-runtime.ts, aucune API ne permet d'imposer l'id). */
export type ApplyResult = { created: number; skippedIds: string[]; convertedIds: Map<string, string> };

/** Applique la conversion à une sélection d'idées, dans l'ordre demandé —
 * mute `canvas.nodes` en place (chaque node sélectionné devient un file
 * node dans le JSON) et crée/réutilise réellement les fichiers Markdown
 * dans `destFolder`. Si `runtimeCanvas` est fourni (intégration Advanced
 * Canvas — voir integrations/advanced-canvas.ts), tente EN PLUS le
 * remplacement runtime réel (`replaceTextNodeWithFileNode`, seul mécanisme
 * qui matérialise vraiment un file node dans le Canvas ouvert — `setData`/
 * `importData` seuls en sont incapables, voir canvas-runtime.ts). N'écrit
 * jamais elle-même le fichier .canvas : selon l'appelant, ça peut être un
 * `vault.modify()` direct (repli sans Advanced Canvas) ou une sauvegarde
 * live sur la vue Canvas déjà ouverte. */
export async function applySelectedIdeas(
  app: App,
  canvas: CanvasData,
  orderedIds: string[],
  destFolder: TFolder,
  mode: BridgeMode,
  runtimeCanvas?: MinimalRuntimeCanvas,
  titleOverrides?: Map<string, string>
): Promise<ApplyResult> {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  let created = 0;
  const skippedIds: string[] = [];
  const convertedIds = new Map<string, string>();

  for (const id of orderedIds) {
    const node = byId.get(id);
    if (!node || node.type !== "text" || typeof node.text !== "string") {
      skippedIds.push(id);
      continue;
    }

    const { file } = await resolveOrCreateSheetFile(app, node, destFolder, mode, titleOverrides?.get(id));
    const runtimeReplacement = runtimeCanvas
      ? replaceTextNodeWithFileNode(runtimeCanvas, id, file, mode)
      : null;
    const effectiveId = runtimeReplacement?.newId || freshCanvasNodeId(canvas);
    convertedIds.set(id, effectiveId);

    const converted = { ...convertTextNodeToFileNode(node, file.path, mode), id: effectiveId };
    const idx = canvas.nodes.findIndex((n) => n.id === id);
    if (idx !== -1) canvas.nodes[idx] = converted;

    // Le nouvel id est remappé dans le JSON AVANT toute persistance. Ainsi
    // `importData(data, true)` reçoit un état atomique : ancien TextNode absent,
    // nouveau FileNode présent, toutes les arêtes déjà reliées au nouvel id.
    for (const edge of canvas.edges || []) {
      if (edge.fromNode === id) edge.fromNode = effectiveId;
      if (edge.toNode === id) edge.toNode = effectiveId;
    }

    created++;
  }

  return { created, skippedIds, convertedIds };
}
