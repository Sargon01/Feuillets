/** Manipulation des champs et du corps d'un feuillet pendant le découpage et
 * la fusion de scènes (voir scenes-editor.js). Ces fonctions décident du nom
 * des fichiers créés et du contenu écrit dedans — d'où leur sortie du module
 * d'interface, qui dépend d'Obsidian et n'est donc pas testable.
 *
 * Pur : aucune dépendance à Obsidian. */

/* Caractères interdits dans un nom de fichier. Réunion de deux contraintes :
     - Windows : \ / : * ? " < > |   (un coffre synchronisé doit rester
       ouvrable depuis Windows, même si le fichier est créé sous macOS) ;
     - Obsidian : # ^ [ ] en plus, qui casseraient les wikiliens vers ce
       feuillet.
   Le « : » compte double ici : la typographie française l'emploie couramment
   dans un titre (« Chapitre 3 : la fuite »), et il était absent de la version
   précédente — le fichier créé était donc invalide sous Windows. */
const FORBIDDEN_IN_FILENAME = /[\\/:*?"<>|#^[\]]/g;

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

/** Découpe une saisie « a, b, c » en liste, sans entrées vides. */
export function splitCsv(value: unknown): string[] {
  return safeString(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Tags normalisés et dédoublonnés, que la source soit une liste YAML ou une
 * saisie « a, b, c ». L'ordre de première apparition est conservé. */
export function normalizeTags(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => safeString(v).trim()).filter(Boolean))];
  }
  if (typeof value === "string") return [...new Set(splitCsv(value))];
  return [];
}

/** Aperçu sur une ligne, tronqué. `"—"` si le texte est vide — c'est un
 * affichage, jamais une valeur écrite dans un fichier. */
export function shortText(value: unknown, max = 180): string {
  const text = safeString(value)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Sépare le frontmatter du corps. `frontmatter` est `null` s'il n'y en a pas
 * — à distinguer d'un frontmatter vide, qui donne `""`. */
export function splitFrontmatter(content: unknown): { frontmatter: string | null; body: string } {
  const text = safeString(content);
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

/** Corps seul, sans frontmatter ni blancs de bord. */
export function splitBody(raw: unknown): string {
  return splitFrontmatter(raw).body.trim();
}

export function ensureNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Nom sans son extension `.md`.
 *
 * Le `trim()` vient AVANT le retrait de l'extension : l'ancre `$` de la regex
 * ne matchait pas en présence d'espaces finaux, si bien qu'une saisie
 * « Scene 1.md » suivie d'une espace gardait son extension — et le fichier
 * créé s'appelait « Scene 1.md.md ». */
export function stripMdExtension(name: unknown): string {
  return safeString(name)
    .trim()
    .replace(/\.md$/i, "")
    .trim();
}

/** Nom de fichier sûr dérivé d'un titre saisi par l'autrice. Ne renvoie
 * jamais une chaîne vide : un titre entièrement composé de caractères
 * interdits retomberait sinon sur un nom vide, et `vault.create` échouerait. */
export function sanitizeFileBasename(name: unknown, fallback = "Nouvelle scène"): string {
  const base = stripMdExtension(name)
    .replace(FORBIDDEN_IN_FILENAME, "-")
    /* Un point final est ignoré par Windows (« a. » devient « a »), ce qui
       ferait diverger le nom réel du nom attendu par le plugin. */
    .replace(/\.+$/, "")
    .trim();
  /* Un titre entièrement composé de caractères interdits (« /// ») donnerait
     « --- » : non vide, donc le repli ne se déclenchait pas, et le fichier
     s'appelait littéralement « ---.md ». Un nom réduit à des tirets n'en est
     pas un. */
  if (!base || /^-+$/.test(base)) return fallback;
  return base;
}

/** Déplace un élément dans une copie du tableau. */
export function moveItem<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...array];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** Valeur d'un champ pour un formulaire : une liste devient « a, b ». */
export function toValue(value: unknown): string {
  return Array.isArray(value) ? value.map(safeString).join(", ") : safeString(value);
}

/** Corps d'une scène fusionnée dans une autre, selon le mode choisi :
 * `continuous` colle le texte tel quel, `comment` le fait précéder d'une
 * citation, tout autre mode d'un titre de niveau 2. */
export function buildMergedSection(source: { basename: string }, body: unknown, mode: string): string {
  const clean = safeString(body).trim();
  if (!clean) return "";
  if (mode === "continuous") return clean;
  if (mode === "comment") return `> Fusion depuis ${source.basename}\n\n${clean}`;
  return `## Fusion depuis ${source.basename}\n\n${clean}`;
}
