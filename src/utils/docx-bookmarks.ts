// @ts-check
/** Identifiant de signet Word stable et court pour un chemin de feuillet —
 * pose un signet par feuillet à l'export .docx natif (services/export-docx.js)
 * et le retrouve à la lecture d'un .docx annoté renvoyé par un directeur/
 * éditeur (services/docx-review-import.js), SANS jamais stocker ni faire
 * apparaître le chemin lui-même dans le document : le lecteur recalcule ce
 * même identifiant pour chaque feuillet du projet ACTUEL et retrouve la
 * correspondance par égalité d'identifiant.
 *
 * Un nom de signet Word doit commencer par une lettre et ne contenir que des
 * lettres/chiffres/underscores (40 caractères max) — un chemin de fichier
 * réel (accents, espaces, "/", souvent plus de 40 caractères) n'est ni
 * valide ni assez court tel quel, d'où ce hash plutôt qu'un encodage
 * réversible du chemin (qui dépasserait la limite dès un chemin un peu
 * long). FNV-1a 32 bits : pas cryptographique, mais stable et bien réparti —
 * largement suffisant pour un espace de quelques centaines de feuillets par
 * projet (collision fortuite quasi impossible à cette échelle). */
export function bookmarkIdFor(path: string | null | undefined) {
  const s = String(path || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "fs" + (h >>> 0).toString(36);
}

/* Marqueur de découpe injecté dans le markdown avant le rendu HTML, puis
   reconnu et retiré à la construction des paragraphes .docx : c'est lui qui
   dit « le feuillet suivant commence ici », donc où poser le signet. Passer
   par le texte plutôt que par une structure parallèle garantit que le
   marqueur suit exactement le même chemin de rendu que le contenu, et ne
   peut pas se désynchroniser de lui. */
export const MARKER_PREFIX = "FEUILLETS-SCENE:";

/* Segment sans chemin (titre de dossier inséré à la compilation) : ferme la
   page Front en cours sans ouvrir de signet. Ne correspond à aucun feuillet
   réel, donc sans effet à la relecture d'un .docx annoté. */
export const RESET_MARKER_ID = "reset";

const MARKER_RE = /^FEUILLETS-SCENE:([a-zA-Z0-9_]+)(?::(titre|dedicace|epigraphe))?$/;

/**
 * Markdown compilé, préfixé d'un marqueur par segment.
 * @param {{ path?: string|null, text: string, frontType?: string|null }[]} segments
 * @returns {string}
 */
export function markedMarkdownFor(segments: Array<{ path?: string | null; text: string; frontType?: string | null }>) {
  return segments
    .map((seg) => {
      if (!seg.path) return `${MARKER_PREFIX}${RESET_MARKER_ID}\n\n${seg.text}`;
      const suffix = seg.frontType ? `:${seg.frontType}` : "";
      const marker = `${MARKER_PREFIX}${bookmarkIdFor(seg.path)}${suffix}\n\n`;
      return marker + seg.text;
    })
    .join("\n\n");
}

/**
 * Lit un marqueur depuis un élément rendu, ou `null` si l'élément n'en est
 * pas un. `id: null` avec un retour non nul signifie « marqueur de remise à
 * zéro » — à distinguer d'un `null` tout court, qui veut dire « pas un
 * marqueur, c'est du contenu ».
 * @param {{ textContent?: string|null }|null|undefined} el
 * @returns {{ id: string|null, frontType: string|null }|null}
 */
export function bookmarkMarkerInfoOf(el: { textContent?: string | null } | null | undefined) {
  if (!el) return null;
  const raw = (el.textContent || "").trim();
  const m = raw.match(MARKER_RE);
  if (!m) return null;
  return { id: m[1] === RESET_MARKER_ID ? null : m[1], frontType: m[2] || null };
}
