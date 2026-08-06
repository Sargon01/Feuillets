/**
 * Fenêtre de contexte autour du curseur — fonction PURE, sans dépendance à
 * Obsidian : reçoit le texte brut d'un feuillet (frontmatter compris) et
 * une position de curseur exprimée en offset dans CE texte, et retourne le
 * paragraphe qui contient le curseur — SEUL, par défaut. Les paragraphes
 * voisins (jusqu'à `radius` de chaque côté) ne sont ajoutés QUE si le
 * paragraphe courant est très court (voir SHORT_PARAGRAPH_THRESHOLD) : un
 * paragraphe normal fournit déjà assez de matière au moteur de contexte, et
 * y ajouter systématiquement le voisinage (comportement d'origine, radius
 * fixe) faisait remonter des fiches sans rapport dès que le curseur restait
 * ne serait-ce qu'à un paragraphe de distance d'une mention — le symptôme
 * "fiches sans rapport qui restent affichées après déplacement du curseur".
 * Sert à limiter l'analyse de la section « Contexte » de NotesView au
 * voisinage immédiat de l'écriture en cours, au lieu du feuillet entier.
 *
 * Un paragraphe est une suite de lignes séparée de ses voisines par une ou
 * plusieurs lignes vides. Le frontmatter YAML (`---\n…\n---`) en tête du
 * texte est toujours exclu, aussi bien du résultat que du calcul de
 * position : un offset qui tombe DANS le frontmatter est ramené au tout
 * début du corps. Fonction pure et sans état : rien n'est mémorisé d'un
 * appel à l'autre, donc jamais d'ancienne fenêtre conservée après un
 * changement de paragraphe — chaque appel recalcule tout depuis `text`.
 */

/** Un paragraphe de moins de ce nombre de caractères (une fois bordures
 * blanches retirées) est considéré "très court" — une didascalie, une
 * réplique isolée, un fragment — et seul alors le voisinage compense le
 * manque de matière pour le moteur de contexte. Choisi largement en
 * dessous d'une phrase ordinaire (~60-80 caractères) pour ne déclencher
 * l'élargissement que sur de vrais fragments, pas sur un paragraphe normal
 * un peu bref. */
const SHORT_PARAGRAPH_THRESHOLD = 50;

/** Longueur du bloc frontmatter YAML en tête de `text`, 0 s'il n'y en a
 * pas. Même convention que le reste du plugin (voir stripFrontmatter dans
 * services/frontmatter.ts et son usage dans notes-view.ts) : un bloc
 * `---\n…\n---` optionnellement suivi d'un saut de ligne. */
function frontmatterLength(text: string): number {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? match[0].length : 0;
}

type ParagraphRange = { text: string; start: number; end: number };

/** Découpe `body` en paragraphes non vides, avec leurs positions [start,
 * end[ dans `body` — nécessaire pour localiser celui qui contient le
 * curseur. Un séparateur est une ou plusieurs lignes vides (éventuellement
 * blanches, espaces/tabulations seuls). */
function splitParagraphs(body: string): ParagraphRange[] {
  const separator = /\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g;
  const raw: ParagraphRange[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(body)) !== null) {
    raw.push({ text: body.slice(lastIndex, match.index), start: lastIndex, end: match.index });
    lastIndex = separator.lastIndex;
  }
  raw.push({ text: body.slice(lastIndex), start: lastIndex, end: body.length });

  // Les segments purement blancs (lignes vides en tête/fin de fichier, ou
  // séparateurs multiples) ne sont pas des paragraphes.
  return raw.filter(p => p.text.trim().length > 0);
}

/** Index du paragraphe contenant `offset` — ou, si `offset` tombe dans un
 * séparateur (entre deux paragraphes) ou hors bornes, le paragraphe le
 * plus proche par position. Ne retourne -1 que si `paragraphs` est vide. */
function paragraphIndexAt(paragraphs: ParagraphRange[], offset: number): number {
  if (paragraphs.length === 0) return -1;

  for (let i = 0; i < paragraphs.length; i++) {
    if (offset >= paragraphs[i].start && offset <= paragraphs[i].end) return i;
  }

  // Hors d'un paragraphe (dans un séparateur, avant le premier ou après le
  // dernier) : le dernier paragraphe dont le début précède l'offset, sinon
  // le tout premier.
  let closest = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].start <= offset) closest = i;
    else break;
  }
  return closest;
}

/**
 * Retourne le paragraphe courant (celui qui contient `cursorOffset`) SEUL,
 * sauf s'il est très court (voir SHORT_PARAGRAPH_THRESHOLD) : dans ce cas
 * seulement, il est entouré de jusqu'à `radius` paragraphes précédents et
 * suivants (par défaut 1 de chaque côté), séparés par une ligne vide — le
 * frontmatter YAML exclu, les offsets hors bornes bornés proprement (jamais
 * d'erreur, jamais de découpage négatif).
 */
export function extractContextWindow(
  text: string,
  cursorOffset: number,
  radius = 1
): string {
  if (!text) return "";

  const safeText = String(text);
  const fmLength = frontmatterLength(safeText);
  const body = safeText.slice(fmLength);

  // Offset borné : négatif → 0, trop grand → fin du corps, dans le
  // frontmatter → tout début du corps.
  const rawOffset = Number.isFinite(cursorOffset) ? cursorOffset : 0;
  const bodyOffset = Math.min(Math.max(rawOffset - fmLength, 0), body.length);

  const paragraphs = splitParagraphs(body);
  if (paragraphs.length === 0) return "";

  const currentIndex = paragraphIndexAt(paragraphs, bodyOffset);
  const currentParagraph = paragraphs[currentIndex];

  // Paragraphe courant seul par défaut — élargi uniquement s'il est très
  // court : jamais de voisinage systématique, jamais d'ancienne fenêtre
  // conservée (recalcul complet à chaque appel, aucun état mémorisé ici).
  const isVeryShort = currentParagraph.text.trim().length < SHORT_PARAGRAPH_THRESHOLD;
  const requestedRadius = Number.isFinite(radius) && radius >= 0 ? Math.floor(radius) : 1;
  // `radius` reste la volonté explicite de l'appelant : un paragraphe très
  // court l'autorise à s'appliquer (sinon toujours 0), mais un `radius: 0`
  // explicite reste strictement 0 même sur un fragment très court — jamais
  // élargi malgré lui.
  const effectiveRadius = isVeryShort ? requestedRadius : 0;

  const from = Math.max(0, currentIndex - effectiveRadius);
  const to = Math.min(paragraphs.length - 1, currentIndex + effectiveRadius);

  return paragraphs
    .slice(from, to + 1)
    .map(p => p.text.trim())
    .join("\n\n");
}
