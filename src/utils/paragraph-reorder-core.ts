import { parser } from "@lezer/markdown";

/**
 * Moteur PUR du déplacement de paragraphes (LOT 1 — voir le contrat du
 * chantier « Déplacement des paragraphes dans l'éditeur »).
 *
 * Aucune dépendance DOM, aucune dépendance Vault, aucune écriture fichier :
 * ce module reçoit du texte Markdown correspondant à UN segment éditable
 * (le corps d'un `MarkdownView` normal une fois son frontmatter retiré, ou
 * le corps d'UN feuillet Continu) et produit — ou non — un plan de
 * déplacement. Il ne dispatch jamais rien lui-même : c'est la couche
 * CodeMirror (`cm-paragraph-reorder.ts`) qui construit la transaction.
 *
 * Source de vérité UNIQUE pour « qu'est-ce qu'un paragraphe » : le parser
 * de `@lezer/markdown` (déjà présent dans package.json). Jamais `.cm-line`,
 * jamais `textContent`, jamais une hauteur visuelle, jamais une regex.
 */

/** Un bloc Markdown top-level, dans l'ordre réel du document. Seul
 * `Paragraph` est `draggable` pour ce premier lot (voir §10 du contrat) —
 * les autres restent présents dans la structure pour que les seams
 * avant/après eux puissent être calculées. */
export interface MarkdownBlock {
  type: string;
  from: number;
  to: number;
  draggable: boolean;
}

/** Seul type déplaçable pour ce LOT 1 — voir §48 du contrat. */
const DRAGGABLE_TYPES: ReadonlySet<string> = new Set(["Paragraph"]);

/**
 * Résout les blocs Markdown top-level d'UN segment de texte, dans l'ordre
 * réel du document. Un `Paragraph` multiligne (§11 du contrat) reste UNE
 * unité : c'est déjà la granularité que rend `@lezer/markdown` pour ce
 * type de nœud — aucun traitement ligne par ligne n'est fait ici.
 */
export function resolveMarkdownBlocks(text: string): MarkdownBlock[] {
  const tree = parser.parse(text);
  const blocks: MarkdownBlock[] = [];
  let child = tree.topNode.firstChild;
  while (child) {
    blocks.push({
      type: child.name,
      from: child.from,
      to: child.to,
      draggable: DRAGGABLE_TYPES.has(child.name),
    });
    child = child.nextSibling;
  }
  return blocks;
}

/**
 * Plan de déplacement STRICT produit par `planParagraphMove` : une plage
 * contiguë `[from, to)` du segment à remplacer par `insert` — texte EXACT
 * reconstruit à partir des blocs et séparateurs réels de cette plage,
 * jamais une normalisation (§14 du contrat). `selectionOffset` pointe le
 * début du paragraphe déplacé dans sa position finale, pour que la couche
 * CodeMirror puisse y replacer le curseur DANS LA MÊME transaction.
 */
export interface ParagraphMovePlan {
  from: number;
  to: number;
  insert: string;
  selectionOffset: number;
}

/**
 * Calcule le plan de déplacement du bloc à l'index `sourceIndex` (doit être
 * `draggable`) vers la seam `targetSeam` — une frontière logique ENTRE
 * blocs, 0..blocks.length (0 = avant le premier bloc, blocks.length = après
 * le dernier — voir §27 du contrat). Retourne `null` si la seam est hors
 * bornes, si `sourceIndex` ne désigne pas un bloc `draggable`, ou si le
 * résultat serait un no-op (§28) : aucune transaction texte dans ces cas.
 *
 * Algorithme (§16-17) : on calcule directement l'ordre final des blocs, on
 * repère la plus petite fenêtre contiguë [p1, p2] où cet ordre diffère de
 * l'ordre d'origine (propriété d'un déplacement d'UN seul élément : cette
 * fenêtre est contiguë en POSITION comme en VALEUR — les indices de blocs
 * qui y apparaissent sont exactement {p1..p2}), puis on ne reconstruit QUE
 * cette plage. Les séparateurs réels de la fenêtre (`sep(p1)..sep(p2-1)`,
 * les chaînes exactes déjà présentes entre les blocs `p1..p2` d'origine)
 * sont réutilisés tels quels, dans leur ordre d'origine, entre les blocs du
 * nouvel agencement — jamais un séparateur inventé (§14, §55, §58).
 */
export function planParagraphMove(
  text: string,
  blocks: readonly MarkdownBlock[],
  sourceIndex: number,
  targetSeam: number
): ParagraphMovePlan | null {
  const n = blocks.length;
  if (sourceIndex < 0 || sourceIndex >= n) return null;
  if (!blocks[sourceIndex].draggable) return null;
  if (targetSeam < 0 || targetSeam > n) return null;

  const k = sourceIndex;
  const gapIndex = targetSeam <= k ? targetSeam : targetSeam - 1;
  const survivedIdx: number[] = [];
  for (let i = 0; i < n; i++) if (i !== k) survivedIdx.push(i);
  const newOrder = [...survivedIdx.slice(0, gapIndex), k, ...survivedIdx.slice(gapIndex)];

  let p1 = -1;
  for (let i = 0; i < n; i++) {
    if (newOrder[i] !== i) {
      p1 = i;
      break;
    }
  }
  if (p1 === -1) return null; // ordre identique : no-op (§28)

  let p2 = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (newOrder[i] !== i) {
      p2 = i;
      break;
    }
  }

  const windowOrder = newOrder.slice(p1, p2 + 1);
  const seps: string[] = [];
  for (let i = p1; i < p2; i++) seps.push(text.slice(blocks[i].to, blocks[i + 1].from));

  let insert = "";
  let cursorOffsetWithinInsert = 0;
  const movedPositionInWindow = windowOrder.indexOf(k);
  windowOrder.forEach((idx, i) => {
    const blockText = text.slice(blocks[idx].from, blocks[idx].to);
    if (i < movedPositionInWindow) cursorOffsetWithinInsert += blockText.length + (seps[i] ? seps[i].length : 0);
    insert += blockText;
    if (i < windowOrder.length - 1) insert += seps[i];
  });

  const from = blocks[p1].from;
  const to = blocks[p2].to;
  return { from, to, insert, selectionOffset: from + cursorOffsetWithinInsert };
}
