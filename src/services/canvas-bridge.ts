import { normalizePath } from "obsidian";
import type { App, TFile, TFolder } from "obsidian";
import type { CanvasData, CanvasNode } from "./canvas-board.js";

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
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^>\s+/, "")
    .trim();
}

/** Corps du feuillet : tout ce qui suit la première ligne significative,
 * tel quel (aucune autre transformation) — vide si l'idée tenait sur une
 * seule ligne. */
export function bodyAfterTitle(text: string): string {
  const lines = (text || "").split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { idx = i; break; }
  }
  if (idx === -1) return "";
  return lines.slice(idx + 1).join("\n").trim();
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

/** Convertit un text node en file node — copie de TOUTES les propriétés
 * inconnues (styleAttributes, dynamicHeight, zIndex, couleur, position,
 * taille… tout ce qu'Advanced Canvas ou une future version peut y avoir
 * posé), retire seulement `text` (incompatible avec le type "file"), fixe
 * `type`/`file`/`feuillets_managed`. L'id, x, y, width, height, color et
 * toute autre extension restent strictement inchangés — les arêtes
 * existantes référencent cet id et doivent continuer à le retrouver tel
 * quel. */
export function convertTextNodeToFileNode(node: CanvasNode, filePath: string, managed: "manuscript" | "research"): CanvasNode {
  const { text: _text, ...rest } = node;
  return {
    ...rest,
    type: "file",
    file: filePath,
    feuillets_managed: managed,
  };
}

/** Frontmatter minimal d'un feuillet créé depuis une idée Canvas : seul
 * `title` est écrit — indispensable ici parce que le nom de fichier peut
 * porter un suffixe de désambiguïsation ("Idée 2.md") que le titre affiché
 * ne doit pas montrer ; aucun autre champ du squelette habituel (status,
 * label, characters, pov, thread, date, arc…) n'est pré-rempli. */
export function manuscriptSheetContent(title: string, body: string): string {
  const lines = ["---", `title: ${title}`, "---", "", body, ""];
  return lines.join("\n");
}

/** Note de recherche libre créée depuis une idée Canvas : même principe
 * minimal, aucun champ métier (personnage/lieu/…) imposé. */
export function researchNoteContent(title: string, body: string): string {
  return manuscriptSheetContent(title, body);
}

export type BridgeMode = "manuscript" | "research";

/** Résultat d'une conversion appliquée au tableau : combien de fichiers ont
 * réellement été créés, et les ids ignorés (déjà convertis, ou introuvables
 * dans `canvas` au moment de l'appel). */
export type ApplyResult = { created: number; skippedIds: string[] };

/** Applique la conversion à une sélection d'idées, dans l'ordre demandé —
 * mute `canvas.nodes` en place (chaque node sélectionné devient un file
 * node) et crée réellement les fichiers Markdown dans `destFolder`. N'écrit
 * jamais elle-même le fichier .canvas : selon l'appelant, ça peut être un
 * `vault.modify()` direct (repli sans Advanced Canvas) ou un
 * `canvas.setData()` + `canvas.requestSave()` sur la vue Canvas déjà
 * ouverte (intégration Advanced Canvas) — voir integrations/advanced-
 * canvas.ts pour la raison de cette séparation. */
export async function applySelectedIdeas(
  app: App,
  canvas: CanvasData,
  orderedIds: string[],
  destFolder: TFolder,
  mode: BridgeMode
): Promise<ApplyResult> {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  let created = 0;
  const skippedIds: string[] = [];

  for (const id of orderedIds) {
    const node = byId.get(id);
    if (!node || node.type !== "text" || typeof node.text !== "string") {
      skippedIds.push(id);
      continue;
    }
    const title = deriveTitle(node.text) || "Idée";
    const body = bodyAfterTitle(node.text);
    const path = uniqueFileName(
      (p) => !!app.vault.getAbstractFileByPath(p),
      destFolder.path,
      title
    );
    const content = mode === "manuscript" ? manuscriptSheetContent(title, body) : researchNoteContent(title, body);
    const file: TFile = await app.vault.create(path, content);
    const converted = convertTextNodeToFileNode(node, file.path, mode);
    const idx = canvas.nodes.findIndex((n) => n.id === id);
    if (idx !== -1) canvas.nodes[idx] = converted;
    created++;
  }

  return { created, skippedIds };
}
