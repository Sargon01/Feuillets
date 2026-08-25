import { splitFrontmatter } from "../services/frontmatter.js";

/** Ligne `---` isolée (0-3 espaces autorisés) : une frontière logique.
 * 4+ espaces ou 1+ tab = bloc de code indentés, jamais des frontières.
 * `***` et `___` restent des séparateurs Markdown ordinaires, jamais des
 * frontières — voir la documentation du module. */
const LOGICAL_BOUNDARY = /^[ ]{0,3}---[ \t]*$/;
// Regex pour détecter une ligne avec fence (backticks ou tildes)
// Note: pour les OUVERTURES, le texte après les backticks est autorisé (ex: ``` md)
// Pour les FERMETURES, voir le code qui valide séparément
// Tabs au début = bloc de code indentés (rejettés), donc seulement 0-3 espaces autorisés
const FENCE_OPEN = /^[ ]{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Une unité logique source, avec sa plage de lignes dans le fichier
 * ORIGINAL (frontmatter compris) — coordonnées Editor 0-based, `endLine`
 * INCLUS. La ligne frontière qui clôt une unité appartient à CETTE unité
 * (jamais à la suivante) : voir `splitMarkdownLogicalUnitsWithRanges`.
 */
export interface MarkdownLogicalUnitSource {
  markdown: string;
  startLine: number;
  endLine: number;
}

/**
 * Mécanique interne UNIQUE qui décide quelles lignes sont des frontières
 * logiques et découpe le corps (hors frontmatter) en unités — walk ligne à
 * ligne :
 * - Une ligne `---` isolée referme l'unité courante
 * - SAUF à l'intérieur d'une fence (```` ``` ```` ou `~~~`) ouverte, où rien
 *   n'est une frontière. Une fence ne se referme que par le même caractère
 *   (backtick/tilde) avec une longueur >= à celle de l'ouverture ; une
 *   pseudo-fermeture plus courte (ex. ouverture ```` ```` ````, ligne ``` ```` ```)
 *   ne referme rien.
 * Le frontmatter YAML initial est retiré avant ce walk par `splitFrontmatter`,
 * donc ses propres `---` ne sont jamais vus ici.
 *
 * Découpeur Présentation générique partagé.
 */
function splitMarkdownLogicalUnitsInternal(markdown: string): MarkdownLogicalUnitSource[] {
  const { frontmatter, body } = splitFrontmatter(markdown);
  // La frontmatter matchée consomme un nombre ENTIER de lignes (elle se
  // termine toujours par \r?\n ou par la fin de la chaîne) : son nombre de
  // sauts de ligne donne exactement le décalage de ligne du corps.
  const frontmatterLineOffset = frontmatter ? (frontmatter.match(/\r?\n/g)?.length ?? 0) : 0;

  const bodyLines = body.split(/\r?\n/);
  const bucketOfLine: number[] = new Array<number>(bodyLines.length).fill(-1);
  const linesToInclude: boolean[] = new Array<boolean>(bodyLines.length).fill(true);
  const consumedByCallout = new Set<number>();
  const rawBuckets: string[][] = [];
  let currentLines: string[] = [];
  let bucketIndex = 0;
  let fence: { char: "`" | "~"; length: number } | null = null;

  const flush = () => {
    rawBuckets.push(currentLines);
    currentLines = [];
    bucketIndex++;
  };

  // Track si on est dans un groupe de frontières structurelles
  let inFrontierGroup = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    // Détecter une potentielle fence (ouverture ou fermeture)
    const matchOpen = line.match(FENCE_OPEN);
    if (matchOpen) {
      const marker = matchOpen[1][0] as "`" | "~";
      const length = matchOpen[1].length;

      if (!fence) {
        // C'est une OUVERTURE de fence
        fence = { char: marker, length };
      } else {
        // On est déjà à l'intérieur d'une fence. Vérifier si c'est une FERMETURE valide.
        // La fermeture doit avoir:
        // - Le même caractère (backtick ou tilde)
        // - Une longueur >= longueur d'ouverture
        // - Uniquement des espaces/tabs après (validé par FENCE_CLOSE)
        if (fence.char === marker && length >= fence.length && line.match(FENCE_CLOSE)) {
          fence = null;
        }
      }
      if (linesToInclude[i]) currentLines.push(line);
      bucketOfLine[i] = bucketIndex;
      continue;
    }

    // Vérifier si c'est une frontière structurelle
    const isBoundary = !fence && LOGICAL_BOUNDARY.test(line);
    if (isBoundary) {
      // Frontière structurelle : marquer le bucket
      bucketOfLine[i] = bucketIndex;

      // NE PAS faire de flush ici - attendre une ligne de contenu réel
      inFrontierGroup = true;
      continue;
    }

    // Ligne non-frontière : vérifier si c'est du contenu réel ou une ligne blanche
    const isBlankLine = line.trim() === "";

    if (inFrontierGroup && !isBlankLine) {
      // On sort du groupe de frontières (ligne non-blanche, non-frontière)
      // Faire un flush d'abord pour créer le bucket vide
      flush();
      inFrontierGroup = false;
    }

    // Les lignes blanches et le contenu réel appartiennent au bucket courant
    if (linesToInclude[i]) currentLines.push(line);
    // Ne pas ré-assigner si cette ligne a déjà été marquée par la consommation du callout
    if (!consumedByCallout.has(i)) {
      bucketOfLine[i] = bucketIndex;
    }
  }
  flush();

  // Contenu final (trim) de chaque bucket brut — identique au comportement historique.
  const bucketMarkdown = rawBuckets.map((lines) => lines.join("\n").trim());
  const nonEmptyBucketIndexes = bucketMarkdown
    .map((text, idx) => (text ? idx : -1))
    .filter((idx) => idx >= 0);

  if (nonEmptyBucketIndexes.length === 0) return [];

  // Reporte chaque bucket VIDE (droppé) sur le bucket non-vide le plus proche
  // (en avant, sinon en arrière) : garantit un pavage complet du corps, sans
  // trou, pour la recherche « quelle unité contient cette ligne ».
  const effectiveBucketOfRaw: number[] = new Array<number>(rawBuckets.length);
  for (let b = 0; b < rawBuckets.length; b++) {
    if (bucketMarkdown[b]) { effectiveBucketOfRaw[b] = b; continue; }
    const forward = nonEmptyBucketIndexes.find((idx) => idx >= b);
    effectiveBucketOfRaw[b] = forward !== undefined ? forward : nonEmptyBucketIndexes[nonEmptyBucketIndexes.length - 1];
  }

  const rangeByBucket = new Map<number, { min: number; max: number }>();
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bucketOfLine[i];
    if (raw < 0) continue;
    const effective = effectiveBucketOfRaw[raw];
    const range = rangeByBucket.get(effective);
    if (!range) rangeByBucket.set(effective, { min: i, max: i });
    else { range.min = Math.min(range.min, i); range.max = Math.max(range.max, i); }
  }

  return nonEmptyBucketIndexes.map((idx) => {
    const range = rangeByBucket.get(idx)!;
    return {
      markdown: bucketMarkdown[idx],
      startLine: frontmatterLineOffset + range.min,
      endLine: frontmatterLineOffset + range.max,
    };
  });
}

/** Découpe le Markdown en unités logiques sans interpréter le Markdown. */
export function splitMarkdownLogicalUnits(markdown: string): string[] {
  return splitMarkdownLogicalUnitsInternal(markdown).map((unit) => unit.markdown);
}

/**
 * Comme `splitMarkdownLogicalUnits`, avec en plus la plage de lignes
 * (Editor 0-based, `endLine` inclus, coordonnées du fichier ORIGINAL) de
 * chaque unité. Même logique de séparation, aucun second parseur (voir
 * `splitMarkdownLogicalUnitsInternal`).
 */
export function splitMarkdownLogicalUnitsWithRanges(markdown: string): MarkdownLogicalUnitSource[] {
  return splitMarkdownLogicalUnitsInternal(markdown);
}
