/** Retire la syntaxe Markdown d'un extrait pour un APERÇU en texte propre
 * (cartes, binder) — on garde le texte lisible, on enlève seulement les
 * balises (`*`, `**`, `#`, `[[ ]]`, `[texte](url)`, `> `, puces, séparateurs
 * de scène, appels de note…). Volontairement conservateur sur l'underscore :
 * seul un `_..._` clairement délimité (bordé de non-mots) est traité comme
 * de l'italique, pour ne jamais amputer un identifiant en snake_case. */
/** @param {string} text @returns {string} */
export function stripMarkdown(text) {
  if (!text) return "";
  let t = text;

  // Blocs et spans de code : on retire les délimiteurs, on garde le contenu.
  t = t.replace(/```[a-zA-Z0-9]*\r?\n?/g, "").replace(/```/g, "");
  // Images (embed Obsidian ou Markdown) : retirées entièrement de l'aperçu.
  t = t.replace(/!\[\[[^\]]*\]\]/g, "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Wikiliens : [[cible|alias]] -> alias ; [[dossier/cible]] -> "cible".
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, alias) =>
    alias !== undefined ? alias : target.split("/").pop()
  );
  // Liens Markdown [texte](url) -> texte.
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Appels de note de bas de page [^id] -> retirés.
  t = t.replace(/\[\^[^\]]+\]/g, "");

  // Balises ancrées en début de ligne : titres, citations, puces, numéros,
  // séparateurs de scène (*** / --- / ___ seuls sur leur ligne).
  t = t
    .split("\n")
    .map((line) => {
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return ""; // *** --- ___ (avec ou sans espaces)
      return line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}[-*+]\s+/, "")
        .replace(/^\s{0,3}\d+\.\s+/, "");
    })
    .join("\n");

  // Emphases à base d'astérisque (les plus courantes ici), surlignage,
  // barré : marqueurs retirés, contenu gardé.
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/~~(.+?)~~/g, "$1");
  t = t.replace(/==(.+?)==/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  // Italique par underscore UNIQUEMENT s'il est bordé de non-mots (jamais au
  // milieu d'un mot type snake_case).
  t = t.replace(/(^|[^A-Za-z0-9_])_(?!_)([^_]+?)_(?![A-Za-z0-9_])/g, "$1$2");
  t = t.replace(/(^|[^A-Za-z0-9_])__([^_]+?)__(?![A-Za-z0-9_])/g, "$1$2");

  // Caractères Markdown échappés : on rend le caractère littéral.
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, "$1");
  // Astérisques/accents graves esseulés restants (jamais l'underscore).
  t = t.replace(/[*`]/g, "");

  // Espaces et lignes vides surnuméraires.
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** @param {string} text @returns {number} */
export function countWords(text) {
  let t = text;
  t = t.replace(/^---\n[\s\S]*?\n---\n?/, "");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
  t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");
  t = t.replace(/[#>*_`~=]{1,}/g, " ");
  const words = t.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

/** @param {unknown} str @returns {string} */
export function foldAccents(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** @param {string} s @returns {string} */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} text @returns {string} */
export function embedHardBreaks(text) {
  const structural = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\||\s*\*{3}\s*$)/;
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLast = i === lines.length - 1;
        /* une ligne suivante vide (ou ne contenant que l'espace insécable
           du marqueur de "ligne blanche visible" de Feuillets) sépare déjà
           visuellement les deux lignes — lui ajouter un antislash de saut
           forcé produisait un "\" littéral et visible juste avant chaque
           ligne blanche, exporté tel quel en Word. */
        const nextIsStructural =
          !isLast && (structural.test(lines[i + 1]) || lines[i + 1].trim() === "");
        if (
          !isLast &&
          line.trim() !== "" &&
          !structural.test(line) &&
          !nextIsStructural
        ) {
          out.push(line + "\\");
        } else {
          out.push(line);
        }
      }
      return out.join("\n");
    })
    .join("\n\n");
}

/**
 * @param {unknown} raw
 * @param {import("obsidian").TFile | null} [file]
 * @returns {{ sort: number, y: number, mo: number, d: number, display: string } | null}
 */
export function parseStoryDate(raw, file = null) {
  let str = raw !== undefined && raw !== null ? String(raw).trim() : "";
  if (!str && file) {
    /* année à 4 chiffres exigée : un fichier nommé "4.md" ou "10.md"
       (numérotation ordinaire d'un chapitre) ne doit jamais être pris
       pour une date — seul un vrai motif AAAA[-MM[-JJ]] compte. */
    const m0 = file.basename.match(/^(\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)(?:\s|$|-)/);
    if (m0) str = m0[1];
  }
  if (!str) return null;
  const m = str.match(/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = m[2] ? parseInt(m[2], 10) : 0;
  const d = m[3] ? parseInt(m[3], 10) : 0;
  return { sort: y * 10000 + mo * 100 + d, y, mo, d, display: str };
}

/** Compacte les sauts de ligne simples entre deux lignes de texte "normales"
 * (ni vides, ni structurelles) : les paragraphes déjà séparés par une ligne
 * vide, et les lignes de structure (titres, listes, citations, code,
 * tableaux, ***), sont laissés intacts. */
/** @param {string} text @returns {string} */
export function compactLineBreaks(text) {
  const structural = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\||\s*\*{3}\s*$|\s*$)/;
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = line.trim() === "";
    if (isBlank) {
      const prev = out[out.length - 1];
      const next = lines[i + 1];
      const nextBlank = next === undefined || next.trim() === "";
      const prevOk =
        prev !== undefined && prev.trim() !== "" && !structural.test(prev);
      const nextOk =
        next !== undefined && next.trim() !== "" && !structural.test(next);
      if (prevOk && nextOk && !nextBlank) {
        continue; // supprime cette ligne vide : simple saut de ligne
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Corrections typographiques françaises. skipFrontmatter : préserve l'en-tête.
 * Le code (bloc ``` ``` ou span `inline`) n'est jamais touché : guillemets et
 * apostrophes y ont un sens syntaxique, pas typographique. */
/** @param {string} text @param {boolean} skipFrontmatter @returns {string} */
export function frenchTypography(text, skipFrontmatter) {
  let head = "";
  let body = text;
  if (skipFrontmatter) {
    const m = text.match(/^---\n[\s\S]*?\n---\n?/);
    if (m) {
      head = m[0];
      body = text.slice(head.length);
    }
  }
  const NB = " "; // espace fine insécable
  const applyRules = (s) =>
    s
      .replace(/\.\.\./g, "…")
      .replace(/(^|[\s(«])"([^"]+)"/g, (_, a, inner) => `${a}«${NB}${inner}${NB}»`)
      .replace(/'/g, "’")
      .replace(/[ \t]+([;:!?»])/g, `${NB}$1`)
      .replace(/«[ \t]+/g, `«${NB}`)
      .replace(/([\wÀ-ÿ…!?.])([;:!?])/g, (m0, a, p) =>
        p === ";" || p === ":" || p === "!" || p === "?" ? `${a}${NB}${p}` : m0
      );
  body = body
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : applyRules(part)))
    .join("");
  return head + body;
}

/** @returns {string} */
export function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
