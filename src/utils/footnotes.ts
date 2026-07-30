/** Rend les identifiants de notes de bas de page (`[^1]`, `[^note]`…)
 * uniques à l'échelle du manuscrit compilé, en les préfixant avec un
 * identifiant propre au fichier source.
 *
 * Nécessaire parce que chaque scène/section est un fichier indépendant : un
 * auteur numérote naturellement ses notes `[^1]`, `[^2]`… dans chaque
 * fichier, sans savoir que la compilation les concatène tous en un seul
 * document avant de passer à Pandoc. Sans ce renommage, deux fichiers
 * utilisant tous les deux `[^1]` se retrouveraient à pointer vers la même
 * note dans le document final — Pandoc ne voit alors qu'un identifiant
 * global, pas un identifiant par fichier. */
export function renamespaceFootnotes(content: string, prefix: string): string;
export function renamespaceFootnotes(content: null, prefix: string): null;
export function renamespaceFootnotes(content: undefined, prefix: string): undefined;
export function renamespaceFootnotes(content: string | null | undefined, prefix: string): string | null | undefined {
  if (!content || !prefix) return content;
  return content.replace(/\[\^([^\]]+)\]/g, (_, id) => `[^${prefix}-${id}]`);
}

/** Numéro à donner à la prochaine note insérée dans ce fichier : le plus
 * grand identifiant purement numérique + 1 (les identifiants nommés comme
 * `[^remarque]` sont ignorés pour ce calcul, sans faire planter le
 * comptage). 1 si le fichier n'a encore aucune note numérique. */
export function nextFootnoteNumber(content?: string | null): number {
  if (!content) return 1;
  let max = 0;
  for (const m of content.matchAll(/\[\^(\d+)\]/g)) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** Remet les identifiants de notes à 1, 2, 3… dans leur ordre de première
 * apparition dans le texte (référence ou définition, la première
 * rencontrée dans la lecture linéaire du fichier) — utile après avoir
 * supprimé ou réordonné des notes, la suite devenant non contiguë (1, 3, 4…).
 * Idempotent : ré-appliqué sur un fichier déjà propre, ne change rien. */
export function renumberFootnotes(content: string): string;
export function renumberFootnotes(content: null): null;
export function renumberFootnotes(content: undefined): undefined;
export function renumberFootnotes(content: string | null | undefined): string | null | undefined {
  if (!content) return content;
  const order = new Map<string, number>();
  let next = 1;
  for (const m of content.matchAll(/\[\^([^\]]+)\]/g)) {
    if (!order.has(m[1])) order.set(m[1], next++);
  }
  if (order.size === 0) return content;
  return content.replace(/\[\^([^\]]+)\]/g, (_match: string, id: string) => `[^${order.get(id)}]`);
}
