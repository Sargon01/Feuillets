// Nettoyage du texte avant envoi à Grammalecte : masque la syntaxe Markdown
// qui produirait de faux signalements (liens, code, LaTeX, commentaires HTML)
// sans jamais changer la longueur du texte — chaque caractère masqué est
// remplacé par une espace (les sauts de ligne restent des sauts de ligne, pour
// ne pas fusionner des paragraphes). Résultat : les offsets du texte nettoyé
// et du texte brut sont IDENTIQUES, aucune table de correspondance requise.

function blankFull(text: string, regex: RegExp) {
  return text.replace(regex, (m) => m.replace(/[^\n]/g, " "));
}

// [texte](url) et ![alt](url) : on garde le texte visible (ce qui doit être
// vérifié), on masque uniquement la syntaxe et l'URL autour.
function unwrapLinksAndImages(text: string) {
  return text.replace(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g, (_whole: string, bang: string, label: string, url: string) => {
    const lead = " ".repeat(bang.length + 1); // "!" éventuel + "["
    const trail = " ".repeat(url.length + 3); // "]" + "(" + url + ")"
    return lead + label + trail;
  });
}

export function sanitizeForGrammarCheck(text: string) {
  let out = text;
  out = blankFull(out, /```[\s\S]*?```/g); // blocs de code (```)
  out = blankFull(out, /~~~[\s\S]*?~~~/g); // blocs de code (~~~)
  out = blankFull(out, /`[^`\n]*`/g); // code inline
  out = blankFull(out, /\$\$[\s\S]*?\$\$/g); // LaTeX bloc
  out = blankFull(out, /\$[^$\n]+\$/g); // LaTeX inline
  out = blankFull(out, /<!--[\s\S]*?-->/g); // commentaires HTML
  out = unwrapLinksAndImages(out); // liens et images
  return out;
}
