/* Préparation du texte envoyé à un fournisseur d'analyse, et retour des
 * offsets vers le fichier d'origine.
 *
 * Rien ici n'est propre à une langue ni à un moteur : c'est du Markdown et
 * de l'arithmétique d'offsets. Le fournisseur reçoit un texte brut et rend
 * des offsets DANS CE TEXTE ; Feuillets seul sait ce qu'il en a retiré
 * (frontmatter) ou découpé (sélection), donc Feuillets seul refait la
 * conversion. Un compagnon n'a jamais à connaître le frontmatter. */

/** Masque la syntaxe Markdown qui produirait des signalements parasites
 * (code, LaTeX, commentaires HTML, URL) SANS jamais changer la longueur du
 * texte : chaque caractère masqué devient une espace, les sauts de ligne
 * restent des sauts de ligne (pour ne pas fusionner deux paragraphes).
 * Conséquence recherchée : les offsets du texte nettoyé et du texte brut
 * sont IDENTIQUES, aucune table de correspondance n'est nécessaire. */
function blankFull(text: string, regex: RegExp): string {
  return text.replace(regex, (m) => m.replace(/[^\n]/g, " "));
}

/** `[texte](url)` et `![alt](url)` : on garde le texte visible, qui doit
 * être analysé, et on masque la syntaxe et l'URL autour. */
function unwrapLinksAndImages(text: string): string {
  return text.replace(
    /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g,
    (_whole: string, bang: string, label: string, url: string) => {
      const lead = " ".repeat(bang.length + 1); // « ! » éventuel + « [ »
      const trail = " ".repeat(url.length + 3); // « ] » + « ( » + url + « ) »
      return lead + label + trail;
    }
  );
}

function blankFormattingChars(text: string): string {
  let out = text.replace(/^(#{1,6}\s+)/gm, (m) => " ".repeat(m.length));
  out = out.replace(/^(\s*[-*+]\s+)/gm, (m) => " ".repeat(m.length));
  out = out.replace(/^(\s*\d+\.\s+)/gm, (m) => " ".repeat(m.length));
  out = out.replace(/(\*\*|\*|__|~~|==)/g, (m) => " ".repeat(m.length));
  return out;
}

export function sanitizeMarkdownForAnalysis(text: string): string {
  let out = text;
  out = blankFull(out, /```[\s\S]*?```/g); // blocs de code (```)
  out = blankFull(out, /~~~[\s\S]*?~~~/g); // blocs de code (~~~)
  out = blankFull(out, /`[^`\n]*`/g); // code inline
  out = blankFull(out, /\$\$[\s\S]*?\$\$/g); // LaTeX bloc
  out = blankFull(out, /\$[^$\n]+\$/g); // LaTeX inline
  out = blankFull(out, /<!--[\s\S]*?-->/g); // commentaires HTML
  out = unwrapLinksAndImages(out); // liens et images
  out = blankFormattingChars(out); // puces, titres, emphase
  return out;
}

/** Retire le frontmatter YAML en tête de fichier. Même expression que
 * BaseFeuilletsView.splitFrontmatter, isolée ici pour rester utilisable
 * hors d'une vue (commandes, tests). */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

/** Texte prêt à analyser + décalage à rajouter aux offsets rendus par le
 * fournisseur pour retomber sur le fichier. */
export type AnalysisSlice = {
  /** Texte transmis au fournisseur (frontmatter retiré, Markdown masqué). */
  text: string;
  /** offsetDansLeFichier = offsetDuFournisseur + fileOffset. */
  fileOffset: number;
  /** Bornes de la sélection dans le fichier, si analyse partielle. */
  selectionStart?: number;
  selectionEnd?: number;
};

/** Découpe le contenu d'un fichier pour analyse.
 *
 * - sans sélection : tout le corps, frontmatter exclu (le YAML n'a jamais à
 *   être relu par un correcteur) ;
 * - avec sélection : exactement la sélection, y compris si elle mord sur le
 *   frontmatter — l'utilisateur a désigné ce passage explicitement.
 *
 * Une sélection vide ou inversée est traitée comme une absence de sélection :
 * les commandes n'ont pas à distinguer « rien sélectionné » de « curseur
 * simple ». */
export function buildAnalysisSlice(
  content: string,
  selection?: { start?: number; end?: number } | null
): AnalysisSlice {
  const start = selection?.start;
  const end = selection?.end;
  const hasSelection =
    typeof start === "number" && typeof end === "number" && end > start &&
    start >= 0 && end <= content.length;

  if (hasSelection) {
    return {
      text: sanitizeMarkdownForAnalysis(content.slice(start, end)),
      fileOffset: start,
      selectionStart: start,
      selectionEnd: end,
    };
  }

  const { body } = splitFrontmatter(content);
  return {
    text: sanitizeMarkdownForAnalysis(body),
    fileOffset: content.length - body.length,
  };
}

/** Convertit les bornes d'un signalement vers le fichier, en les bornant au
 * contenu réel : un fournisseur tiers peut rendre n'importe quoi, et une
 * plage hors fichier ferait échouer editor.offsetToPos(). */
export function analysisRangeFor(
  issue: { start: number; end: number },
  slice: { fileOffset: number },
  contentLength: number
): { start: number; end: number } {
  const start = Math.max(0, Math.min(contentLength, issue.start + slice.fileOffset));
  const end = Math.max(start, Math.min(contentLength, issue.end + slice.fileOffset));
  return { start, end };
}
