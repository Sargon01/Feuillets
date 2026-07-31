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

/** Renumérote en 1, 2, 3… les notes d'un ensemble de textes traités comme
 * UN SEUL document dans l'ordre du tableau (voir compile-export.js : chaque
 * élément est un segment du manuscrit compilé — feuillet, titre de partie…).
 * Contrairement à `renumberFootnotes` (un seul texte), l'ordre de première
 * apparition est calculé sur TOUS les segments avant de réécrire chacun
 * séparément : c'est ce qui permet à `[^1]` du premier feuillet et `[^1]` du
 * second (déjà rendus uniques par renamespaceFootnotes) de devenir `[^1]` et
 * `[^2]` de façon CONTINUE sur tout le document compilé, plutôt que deux
 * fois "1" si chaque segment était renumérotée indépendamment. */
export function renumberFootnotesAcrossTexts(texts: string[]): string[] {
  const order = new Map<string, number>();
  let next = 1;
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(/\[\^([^\]]+)\]/g)) {
      if (!order.has(m[1])) order.set(m[1], next++);
    }
  }
  // Toujours reconstruire un nouveau tableau, même sans aucune note à
  // renuméroter : renvoyer `texts` tel quel exposerait la même référence
  // qu'un éventuel appelant s'apprêtant à la muter en place (voir
  // compile-export.ts, qui fait `parts.length = 0` juste après) — un piège
  // d'aliasing classique qui viderait alors aussi le tableau "renuméroté".
  if (order.size === 0) return [...texts];
  return texts.map((text) =>
    text ? text.replace(/\[\^([^\]]+)\]/g, (_match: string, id: string) => `[^${order.get(id) ?? id}]`) : text
  );
}

/* ------------------------------------------------------------------------
 * Analyse (appels, définitions, validation) — voir docs/FONCTIONNALITES.md,
 * section « Notes de bas de page ».
 *
 * Analyse ligne par ligne plutôt qu'une seule grande regex sur tout le
 * texte : la principale source de fragilité d'une regex globale ici serait
 * de confondre un APPEL `[^1]` et le DÉBUT D'UNE DÉFINITION `[^1]:` — la
 * syntaxe Markdown standard (CommonMark, Pandoc) exige qu'une définition
 * commence en tout début de ligne (0 à 3 espaces d'indentation tolérés),
 * jamais au milieu d'une phrase. Scanner ligne par ligne rend cette
 * distinction triviale et gère aussi les définitions multi-lignes (lignes de
 * continuation indentées d'au moins 4 espaces ou une tabulation, éventuel
 * paragraphe séparé par une ligne vide) sans backtracking hasardeux.
 * ---------------------------------------------------------------------- */

/** Un appel de note `[^id]` (jamais un début de définition). */
export interface FootnoteReference {
  id: string;
  start: number;
  end: number;
}

/** Une définition `[^id]: contenu`, continuations multi-lignes incluses.
 * `content` est le texte dé-indenté et joint par des \n, sans les lignes
 * vides de tête/queue. `start`/`end` couvrent tout le bloc (marqueur +
 * continuations), pour une sélection/navigation qui montre la note entière. */
export interface FootnoteDefinition {
  id: string;
  start: number;
  end: number;
  content: string;
}

export interface FootnoteValidationResult {
  /** Appelées mais jamais définies dans ce fichier. */
  missingDefinitions: string[];
  /** Définies mais jamais appelées. */
  unusedDefinitions: string[];
  /** Un même identifiant défini plusieurs fois. */
  duplicateDefinitions: string[];
  /** Définition présente mais sans contenu (`[^id]: ` vide). */
  emptyDefinitions: string[];
  /** Appels à l'identifiant vide (`[^]`) — jamais valides en Markdown. */
  malformedReferences: FootnoteReference[];
}

function isContinuationLine(line: string): boolean {
  return /^(?: {4,}|\t)/.test(line);
}

const DEFINITION_START_RE = /^ {0,3}\[\^([^\]]+)\]:[ \t]?(.*)$/;

/** Offsets de début de chaque ligne de `content`, pour convertir un index
 * (ligne, colonne) en offset absolu sans reconstruire les lignes précédentes
 * à chaque fois. */
function lineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1; // +1 pour le \n retiré par split()
  }
  return offsets;
}

/** Analyse `content` en appels et définitions. Fonction pure, sans état
 * partagé entre deux appels (contrairement à un usage naïf de `RegExp.exec`
 * avec `g`, où oublier de réinitialiser `lastIndex` est une source classique
 * de bug — chaque appel ici part d'une regex fraîche). */
export function parseFootnotes(content: string | null | undefined): {
  references: FootnoteReference[];
  definitions: FootnoteDefinition[];
} {
  const references: FootnoteReference[] = [];
  const definitions: FootnoteDefinition[] = [];
  if (!content) return { references, definitions };

  const lines = content.split("\n");
  const starts = lineStartOffsets(lines);
  // Lignes déjà consommées par une définition (marqueur + continuations) :
  // exclues de la recherche d'appels, pour qu'un `[^2]` cité DANS le corps
  // d'une définition (note qui renvoie vers une autre note) ne soit jamais
  // pris pour un appel du texte principal.
  const consumed: Array<[number, number]> = [];

  let i = 0;
  while (i < lines.length) {
    const m = DEFINITION_START_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const id = m[1];
    const leadingSpaces = lines[i].length - lines[i].replace(/^ {0,3}/, "").length;
    const defStart = starts[i] + leadingSpaces;
    const contentParts: string[] = [m[2]];

    let j = i + 1;
    while (j < lines.length) {
      if (isContinuationLine(lines[j])) {
        contentParts.push(lines[j].replace(/^(?: {1,4}|\t)/, ""));
        j++;
        continue;
      }
      // Paragraphe séparé par une ligne vide, mais toujours indenté sous
      // cette définition (sinon la ligne vide clôt la définition).
      if (lines[j].trim() === "" && j + 1 < lines.length && isContinuationLine(lines[j + 1])) {
        contentParts.push("");
        j++;
        continue;
      }
      break;
    }

    const defEnd = starts[j - 1] + lines[j - 1].length;
    const text = contentParts.join("\n").replace(/\n+$/, "").trim();
    definitions.push({ id, start: defStart, end: defEnd, content: text });
    consumed.push([i, j]);
    i = j;
  }

  const isConsumedLine = (lineIndex: number) => consumed.some(([s, e]) => lineIndex >= s && lineIndex < e);
  const refRe = /\[\^([^\]]*)\]/g;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (isConsumedLine(lineIndex)) continue;
    refRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(lines[lineIndex])) !== null) {
      const start = starts[lineIndex] + m.index;
      references.push({ id: m[1], start, end: start + m[0].length });
    }
  }

  return { references, definitions };
}

/** Vérifie les notes d'un fichier : références manquantes, définitions
 * inutilisées ou dupliquées, définitions vides, appels malformés. Pure —
 * aucun accès à Obsidian, testable sur une simple chaîne. */
export function validateFootnotes(content: string | null | undefined): FootnoteValidationResult {
  const { references, definitions } = parseFootnotes(content);

  const definedIds = new Set(definitions.map((d) => d.id));
  const citedIds = new Set(references.map((r) => r.id));

  const seenOnce = new Set<string>();
  const duplicateDefinitions: string[] = [];
  for (const d of definitions) {
    if (seenOnce.has(d.id)) {
      if (!duplicateDefinitions.includes(d.id)) duplicateDefinitions.push(d.id);
    } else {
      seenOnce.add(d.id);
    }
  }

  const missingDefinitions = [...new Set(references.map((r) => r.id))].filter(
    (id) => id !== "" && !definedIds.has(id)
  );
  const unusedDefinitions = [...definedIds].filter((id) => !citedIds.has(id));
  const emptyDefinitions = definitions.filter((d) => d.content === "").map((d) => d.id);
  const malformedReferences = references.filter((r) => r.id.trim() === "");

  return { missingDefinitions, unusedDefinitions, duplicateDefinitions, emptyDefinitions, malformedReferences };
}

/** Identifiant de l'appel sur lequel (ou tout près duquel) se trouve
 * `offset`, ou `null`. « À proximité » : à quelques caractères d'un appel
 * sur la même ligne — assez tolérant pour que le curseur juste avant ou
 * juste après les crochets compte, sans confondre deux appels différents
 * sur une ligne dense. */
export function referenceIdAtOffset(content: string | null | undefined, offset: number): string | null {
  if (!content) return null;
  const { references } = parseFootnotes(content);

  const exact = references.find((r) => offset >= r.start && offset <= r.end);
  if (exact) return exact.id;

  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const lineEndIdx = content.indexOf("\n", offset);
  const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx;
  const onLine = references.filter((r) => r.start >= lineStart && r.end <= lineEnd);
  if (onLine.length === 0) return null;

  let best = onLine[0];
  let bestDist = Math.min(Math.abs(best.start - offset), Math.abs(best.end - offset));
  for (const r of onLine.slice(1)) {
    const d = Math.min(Math.abs(r.start - offset), Math.abs(r.end - offset));
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  const PROXIMITY_TOLERANCE = 3;
  return bestDist <= PROXIMITY_TOLERANCE ? best.id : null;
}

/** Identifiant de la définition dans laquelle se trouve `offset` (marqueur
 * ou l'une de ses lignes de continuation), ou `null` si le curseur n'est
 * dans aucune définition. */
export function definitionIdAtOffset(content: string | null | undefined, offset: number): string | null {
  if (!content) return null;
  const { definitions } = parseFootnotes(content);
  const found = definitions.find((d) => offset >= d.start && offset <= d.end);
  return found ? found.id : null;
}

export function findDefinition(content: string | null | undefined, id: string): FootnoteDefinition | null {
  if (!content) return null;
  return parseFootnotes(content).definitions.find((d) => d.id === id) ?? null;
}

export function findReferences(content: string | null | undefined, id: string): FootnoteReference[] {
  if (!content) return [];
  return parseFootnotes(content).references.filter((r) => r.id === id);
}
