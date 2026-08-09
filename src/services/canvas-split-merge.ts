import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { CanvasData, CanvasNode } from "./canvas-board.js";
import { freshCanvasNodeId, uniqueFileName } from "./canvas-bridge.js";
import { stripFrontmatter } from "./frontmatter.js";

/* Brainstorming Carnet : « Scinder… » et « Fusionner… » (section 5A/5B du
 * cahier des charges de simplification). Comme le reste du pont Carnet
 * (canvas-bridge.ts, canvas-chapter.ts), toute arête du Canvas reste sans
 * effet ici — une scission/fusion ne lit ni ne modifie jamais une edge, un
 * groupe ou `researchFolderLinks`. Ne crée AUCUNE structure Binder nouvelle
 * au-delà du fichier feuillet lui-même (section 5A) : pas de réordonnancement
 * imposé, l'autrice range le nouveau feuillet où elle veut, comme n'importe
 * quel fichier créé à la main dans le manuscrit. */

const GAP_X = 40;

// ---------------------------------------------------------------------------
// 1. Scission — proposition de partage par défaut (pur, sert à préremplir
//    la modale ; l'autrice reste libre de tout réécrire avant de confirmer)
// ---------------------------------------------------------------------------

/** Partage par défaut d'un texte en deux : au premier saut de paragraphe
 * (ligne vide) le plus proche du milieu, sinon à la première frontière de
 * mot après le milieu, sinon au milieu exact — jamais au milieu d'un mot
 * si un espace existe à proximité. Ni l'un ni l'autre morceau n'est jamais
 * réécrit au-delà de cette simple coupure : aucune transformation
 * Markdown, aucun résumé. */
export function defaultSplitOf(text: string): { first: string; second: string } {
  const value = text || "";
  if (!value.trim()) return { first: value, second: "" };

  const mid = Math.floor(value.length / 2);
  const paraBreaks: number[] = [];
  const re = /\n\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) paraBreaks.push(m.index + m[0].length);

  if (paraBreaks.length > 0) {
    let best = paraBreaks[0];
    for (const p of paraBreaks) {
      if (Math.abs(p - mid) < Math.abs(best - mid)) best = p;
    }
    return { first: value.slice(0, best).trimEnd(), second: value.slice(best).trimStart() };
  }

  let cut = value.indexOf(" ", mid);
  if (cut === -1) cut = mid;
  return { first: value.slice(0, cut).trimEnd(), second: value.slice(cut).trimStart() };
}

// ---------------------------------------------------------------------------
// 2. Scission d'un TextNode — pur, aucun accès App (section 5A)
// ---------------------------------------------------------------------------

export type SplitTextNodeResult = { canvas: CanvasData; newNode: CanvasNode };

/** Scinde un TextNode du Carnet en deux : le node existant conserve `first`
 * (id/position/style inchangés — les edges existantes le retrouvent tel
 * quel), un second TextNode neuf est créé juste à sa droite avec `second`.
 * Ne touche à AUCUNE edge, AUCUN groupe : le nouveau node n'est relié à
 * rien tant que l'autrice ne trace pas elle-même une flèche. */
export function splitTextNode(canvas: CanvasData, nodeId: string, first: string, second: string): SplitTextNodeResult | null {
  const idx = canvas.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return null;
  const original = canvas.nodes[idx];
  if (original.type !== "text") return null;

  canvas.nodes[idx] = { ...original, text: first };

  const newId = freshCanvasNodeId(canvas);
  const width = typeof original.width === "number" ? original.width : 0;
  const {
    id: _oldId,
    type: _oldType,
    text: _oldText,
    file: _oldFile,
    feuillets_managed: _oldManaged,
    x: _oldX,
    y: _oldY,
    width: _oldWidth,
    height: _oldHeight,
    ...sharedVisualData
  } = original;
  const newNode: CanvasNode = {
    ...sharedVisualData,
    id: newId,
    type: "text",
    text: second,
    x: (original.x || 0) + width + GAP_X,
    y: original.y || 0,
    width: original.width,
    height: original.height,
  };
  canvas.nodes.push(newNode);
  return { canvas, newNode };
}

// ---------------------------------------------------------------------------
// 3. Scission d'un feuillet Markdown déjà présent dans le manuscrit
//    (section 5A) — App-aware, un seul fichier créé, jamais de doublon
// ---------------------------------------------------------------------------

export type SplitFileResult = { originalFile: TFile; newFile: TFile };

/** Scinde le feuillet `file` (déjà dans le manuscrit) : `file` garde son
 * frontmatter inchangé et son corps devient `first` ; un second fichier
 * Markdown neuf est créé dans le MÊME dossier (jamais un dossier inventé),
 * même frontmatter que l'original hormis `title`/`short_title` (suffixés
 * " - 2", comme le mécanisme de scission de scène existant — voir
 * scenes-editor.ts `splitSceneFile` — sans en dépendre : celui-ci exige un
 * éditeur actif sur le fichier, indisponible depuis une carte du Carnet).
 * Ne réordonne jamais le Binder : le nouveau fichier prend sa place comme
 * n'importe quel fichier déposé à la main (section 5A : « ne pas inventer
 * de structure Binder supplémentaire »). */
export async function splitFeuilletFile(app: App, file: TFile, first: string, second: string): Promise<SplitFileResult | null> {
  const raw = await app.vault.read(file);
  const fmMatch = raw.match(/^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/);
  const frontmatterBlock = fmMatch ? fmMatch[0] : "";

  await app.vault.modify(file, `${frontmatterBlock}${first}\n`);

  const folderPath = file.parent ? file.parent.path : "";
  const newTitleBase = `${file.basename} - 2`;
  const newPath = uniqueFileName((p) => !!app.vault.getAbstractFileByPath(p), folderPath, newTitleBase);
  const newFrontmatter = frontmatterBlock
    ? frontmatterBlock
        .replace(/^(title:\s*)(.*)$/m, (_all, prefix: string) => `${prefix}${newTitleBase}`)
        .replace(/^(short_title:\s*)(.*)$/m, (_all, prefix: string) => `${prefix}`)
    : `---\ntitle: ${newTitleBase}\n---\n`;
  const newFile = await app.vault.create(newPath, `${newFrontmatter}${second}\n`);
  return { originalFile: file, newFile };
}

// ---------------------------------------------------------------------------
// 4. Fusion d'une sélection de notes/feuillets (section 5B)
// ---------------------------------------------------------------------------

export const MERGE_SEPARATOR = "\n\n---\n\n";

/** Concatène des morceaux de texte avec le séparateur simple du Carnet —
 * jamais de résumé, jamais de reformulation, l'ordre transmis est respecté
 * tel quel (déjà validé par l'autrice dans la modale). */
export function mergeContents(parts: string[], separator: string = MERGE_SEPARATOR): string {
  return parts.filter((p) => p.trim().length > 0).join(separator);
}

export type MergeSource = { node: CanvasNode; content: string };

export type MergePlanItem = { node: CanvasNode; content: string };

export type MergeExecutionResult =
  | { ok: true; canvas: CanvasData; targetNode: CanvasNode }
  | { ok: false; error: string };

/** Lit le contenu textuel « fusionnable » d'un node admissible : le texte
 * brut pour un TextNode, le corps (frontmatter retiré) pour un feuillet
 * Markdown déjà présent dans le manuscrit. `null` si le node n'est ni l'un
 * ni l'autre (jamais appelé pour une fiche Recherche ou un fichier externe
 * — filtré en amont par l'appelant, voir admissibleChapterNodes). */
export async function readMergeableContent(app: App, node: CanvasNode): Promise<string | null> {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (node.type === "file" && typeof node.file === "string") {
    const file = app.vault.getAbstractFileByPath(node.file);
    if (file instanceof TFile) return stripFrontmatter(await app.vault.read(file));
  }
  return null;
}

/** Fusionne `orderedNodeIds` (déjà ordonnés par l'autrice dans la modale)
 * dans la carte cible `targetNodeId` — jamais une fusion silencieuse d'une
 * fiche Recherche (filtrée en amont) :
 *
 *  - cible TextNode : son `text` devient le texte fusionné, aucun fichier
 *    créé ;
 *  - cible feuillet Markdown déjà présent : son corps devient le texte
 *    fusionné, son frontmatter reste intact.
 *
 * Les autres cartes de la sélection ne sont supprimées (Canvas + fichier
 * Markdown le cas échéant) QU'APRÈS que la cible a été écrite avec succès —
 * jamais avant, jamais partiellement : en cas d'échec d'une suppression,
 * les fichiers déjà supprimés sont recréés avec leur contenu d'origine
 * (rollback best-effort, sécurité des fichiers avant automatisation, comme
 * partout ailleurs dans Feuillets — voir canvas-chapter.ts). */
export async function executeMerge(
  app: App,
  canvas: CanvasData,
  orderedNodeIds: string[],
  targetNodeId: string
): Promise<MergeExecutionResult> {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const targetNode = byId.get(targetNodeId);
  if (!targetNode) return { ok: false, error: `missing-target:${targetNodeId}` };

  const items: MergePlanItem[] = [];
  for (const id of orderedNodeIds) {
    const node = byId.get(id);
    if (!node) return { ok: false, error: `missing-node:${id}` };
    const content = await readMergeableContent(app, node);
    if (content === null) return { ok: false, error: `not-mergeable:${id}` };
    items.push({ node, content });
  }

  const merged = mergeContents(items.map((i) => i.content));
  const others = items.filter((i) => i.node.id !== targetNodeId);

  // --- état de rollback : contenu d'origine de la cible, fichiers source
  //     supprimés (pour recréation best-effort) ---
  let targetOriginalRaw: string | null = null;
  let targetFile: TFile | null = null;
  const deletedSources: { path: string; content: string }[] = [];

  try {
    if (targetNode.type === "file" && typeof targetNode.file === "string") {
      const file = app.vault.getAbstractFileByPath(targetNode.file);
      if (!(file instanceof TFile)) return { ok: false, error: `missing-target-file:${targetNode.file}` };
      targetFile = file;
      targetOriginalRaw = await app.vault.read(file);
      const fmMatch = targetOriginalRaw.match(/^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/);
      const frontmatterBlock = fmMatch ? fmMatch[0] : "";
      await app.vault.modify(file, `${frontmatterBlock}${merged}\n`);
    } else if (targetNode.type === "text") {
      const idx = canvas.nodes.findIndex((n) => n.id === targetNodeId);
      if (idx === -1) return { ok: false, error: `missing-target:${targetNodeId}` };
      canvas.nodes[idx] = { ...targetNode, text: merged };
    } else {
      return { ok: false, error: `unsupported-target:${targetNodeId}` };
    }

    for (const { node } of others) {
      if (node.type === "file" && typeof node.file === "string") {
        const file = app.vault.getAbstractFileByPath(node.file);
        if (file instanceof TFile) {
          const content = await app.vault.read(file);
          await app.fileManager.trashFile(file);
          deletedSources.push({ path: file.path, content });
        }
      }
    }

    // Suppression Canvas (nodes + edges qui leur étaient reliées) — dernière
    // étape, une fois toutes les mutations disque confirmées.
    const removedIds = new Set(others.map((o) => o.node.id));
    canvas.nodes = canvas.nodes.filter((n) => !removedIds.has(n.id));
    canvas.edges = (canvas.edges || []).filter((e) => !removedIds.has(e.fromNode as string) && !removedIds.has(e.toNode as string));

    const finalTarget = canvas.nodes.find((n) => n.id === targetNodeId) || targetNode;
    return { ok: true, canvas, targetNode: finalTarget };
  } catch (e) {
    for (const { path, content } of [...deletedSources].reverse()) {
      try {
        await app.vault.create(path, content);
      } catch {
        /* best effort : sécurité des fichiers > automatisation */
      }
    }
    if (targetFile && targetOriginalRaw !== null) {
      try {
        await app.vault.modify(targetFile, targetOriginalRaw);
      } catch {
        /* best effort */
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
