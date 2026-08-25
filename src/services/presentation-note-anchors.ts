/** Détection PURE (aucun DOM, aucune écriture) de la cible d'une note de
 * présentation créée SANS sélection — clic droit sur un titre, une image ou
 * un callout. Retourne un `SourceAnchor`-compatible `{start, end}` dans le
 * Markdown source, jamais une nouvelle structure de donnée : l'appelant
 * (AnnotationEditorController) construit ensuite une `Annotation` ordinaire
 * avec `presentationNote: true`, exactement comme pour une sélection de
 * texte — voir services/annotations.ts. Le Markdown n'est jamais modifié
 * par ce module. */

export interface PresentationNoteAnchorTarget {
  start: number;
  end: number;
}

const HEADING_LINE_RE = /^(#{1,6})[ \t]+\S.*$/;
const WIKI_IMAGE_RE = /!\[\[[^\]]+\]\]/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;
const CALLOUT_HEADER_RE = /^>\s*\[![a-zA-Z][\w-]*\][+-]?/;

function lineBounds(content: string, offset: number): { start: number; end: number; text: string } {
  const start = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let end = content.indexOf("\n", offset);
  if (end === -1) end = content.length;
  return { start, end, text: content.slice(start, end) };
}

/** Titre (H1..H6) : ancre la ligne entière — le libellé humain (sans `#`)
 * est dérivé plus tard, à l'affichage, par humanAnnotationTargetLabel
 * (utils/annotation-target-label.ts), jamais recalculé ici. */
export function headingTargetAtOffset(content: string, offset: number): PresentationNoteAnchorTarget | null {
  const { start, end, text } = lineBounds(content, offset);
  if (!HEADING_LINE_RE.test(text)) return null;
  return { start, end };
}

/** Image wiki `![[...]]` ou Markdown `![...](...)` : ancre l'occurrence
 * EXACTE sous le curseur — plusieurs occurrences du même fichier restent
 * distinguées par prefix/suffix (SourceAnchor existant), jamais par ce
 * détecteur. */
export function imageTargetAtOffset(content: string, offset: number): PresentationNoteAnchorTarget | null {
  for (const re of [WIKI_IMAGE_RE, MD_IMAGE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      const start = match.index;
      const end = start + match[0].length;
      if (offset >= start && offset <= end) return { start, end };
    }
  }
  return null;
}

function isCalloutLine(line: string): boolean {
  return /^\s*>/.test(line);
}

/** Callout : clic n'importe où dans le bloc → ancre le bloc logique entier
 * (toutes les lignes `>` contiguës démarrant par un en-tête `> [!type]`),
 * jamais une sélection manuelle.
 *
 * TOLÉRANCE DE BORD, indispensable en Live Preview : un callout y est rendu
 * comme un bloc HTML qui REMPLACE ses lignes source. `posAtCoords` (le seul
 * moyen de savoir sur quoi porte un clic droit, qui ne déplace pas le
 * curseur) renvoie alors une position à la FRONTIÈRE de ce bloc — souvent la
 * ligne vide juste avant ou juste après, jamais une ligne `>` réelle. Sans
 * cette tolérance, « clic droit sur un callout » ne trouvait donc rien tant
 * qu'on n'était pas ENTRÉ dedans (ce qui redéplie les lignes source et
 * repositionne le curseur). On accepte donc, en plus de la ligne visée
 * elle-même, la ligne IMMÉDIATEMENT adjacente (±1) — bornée à une seule
 * ligne : jamais une recherche du callout « le plus proche ».
 *
 * `null` si aucune de ces lignes n'appartient à un callout, ou si le bloc
 * contigu ne commence pas par un en-tête de callout valide (simple citation
 * `>` ordinaire). */
export function calloutTargetAtOffset(content: string, offset: number): PresentationNoteAnchorTarget | null {
  const lines = content.split("\n");
  const lineOffsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineOffsets.push(pos);
    pos += line.length + 1;
  }
  let lineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = lineOffsets[i];
    const lineEnd = lineStart + lines[i].length;
    if (offset >= lineStart && offset <= lineEnd) {
      lineIndex = i;
      break;
    }
  }
  if (lineIndex === -1) return null;

  for (const candidate of [lineIndex, lineIndex - 1, lineIndex + 1]) {
    if (candidate < 0 || candidate >= lines.length || !isCalloutLine(lines[candidate])) continue;
    const block = calloutBlockAt(lines, lineOffsets, candidate);
    if (block) return block;
  }
  return null;
}

/** Étend `index` (déjà connue comme ligne `>`) au bloc `>` contigu complet,
 * et ne le retient QUE s'il commence par un vrai en-tête de callout. */
function calloutBlockAt(
  lines: readonly string[],
  lineOffsets: readonly number[],
  index: number,
): PresentationNoteAnchorTarget | null {
  let blockStart = index;
  while (blockStart > 0 && isCalloutLine(lines[blockStart - 1])) blockStart--;
  if (!CALLOUT_HEADER_RE.test(lines[blockStart].trim())) return null;

  let blockEnd = index;
  while (blockEnd + 1 < lines.length && isCalloutLine(lines[blockEnd + 1])) blockEnd++;

  return { start: lineOffsets[blockStart], end: lineOffsets[blockEnd] + lines[blockEnd].length };
}

/** Ordre de détection : titre → image → callout. `null` si le curseur ne
 * porte sur aucun de ces trois éléments — l'appelant retombe alors sur le
 * comportement existant (aucune entrée de menu supplémentaire). Ne
 * généralise PAS aux tableaux/listes (hors périmètre). */
export function presentationNoteAnchorAtOffset(content: string, offset: number): PresentationNoteAnchorTarget | null {
  return (
    headingTargetAtOffset(content, offset) ??
    imageTargetAtOffset(content, offset) ??
    calloutTargetAtOffset(content, offset)
  );
}
