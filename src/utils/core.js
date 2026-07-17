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

export function foldAccents(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
        const nextIsStructural = !isLast && structural.test(lines[i + 1]);
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

/** Corrections typographiques françaises. skipFrontmatter : préserve l'en-tête. */
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
  body = body
    .replace(/\.\.\./g, "…")
    .replace(/(^|[\s(«])"([^"]+)"/g, (_, a, inner) => `${a}«${NB}${inner}${NB}»`)
    .replace(/'/g, "’")
    .replace(/[ \t]+([;:!?»])/g, `${NB}$1`)
    .replace(/«[ \t]+/g, `«${NB}`)
    .replace(/([\wÀ-ÿ…!?.])([;:!?])/g, (m0, a, p) =>
      p === ";" || p === ":" || p === "!" || p === "?" ? `${a}${NB}${p}` : m0
    );
  return head + body;
}

export function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
