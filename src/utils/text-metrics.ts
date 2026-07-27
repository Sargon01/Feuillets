/** Retire du texte tout ce qui ne doit pas compter dans les statistiques
 * d'écriture : frontmatter YAML, commentaires (%%...%%, <!--...-->), et
 * blocs/segments de code. */
export function stripWritingNoise(text?: string): string {
  let result = text || "";
  result = result.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  result = result.replace(/%%[\s\S]*?%%/g, "");
  result = result.replace(/<!--[\s\S]*?-->/g, "");
  result = result.replace(/```[\s\S]*?```/g, "");
  result = result.replace(/`[^`]+`/g, "");
  return result;
}

export function countSentences(text: string): number {
  const m = text.match(/[^.!?]+[.!?]+/g);
  return m ? m.length : 0;
}

export function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
}

export function formatNumber(n: unknown): string {
  return Number(n || 0).toLocaleString("fr-FR");
}
