/** Page de titre à rôles : l'autrice marque chaque élément par une ligne
 * `:::rôle: contenu` (`:::titre: **NEFES**`, `:::sous-titre: *Roman*`, …).
 * Chaque rôle reçoit ensuite sa mise en forme (taille, gras, alignement,
 * marges) depuis le modèle d'export via `titlePage.styles.<rôle>` — plus
 * besoin de composer l'espacement à la main. Le rôle est libre : n'importe
 * quel nom que le modèle définit fonctionne ; un rôle absent du modèle
 * retombe simplement sur la mise en forme de base de la page Front.
 *
 * Ces fonctions sont volontairement pures (aucune dépendance Obsidian/DOM)
 * pour rester testables et réutilisables par la compilation (compile-export),
 * le rendu HTML (export-render) et le .docx (export-docx). */

/** Préfixe du paragraphe-marqueur inséré à la compilation, juste avant le
 * contenu d'un rôle. Neutre à l'affichage (texte brut passé tel quel par le
 * moteur Markdown), il est retiré par chaque export après repérage. */
export const TITLE_ROLE_MARKER = "FEUILLETS-FPROLE:";

/* Espaces admis autour du deux-points, y compris l'insécable U+00A0 et la
   fine insécable U+202F que la typographie française peut poser avant un
   « : ». Désignés par leur code et non glissés en clair dans ce commentaire :
   littéraux, ils sont invisibles à la relecture et indiscernables d'une
   espace ordinaire — d'où la règle no-irregular-whitespace. */
const SP = "[ \\t\\u00A0\\u202F]";
const TITLE_ROLE_LINE_RE = new RegExp(`^:::${SP}*(.+?)${SP}*:${SP}?(.*)$`);

/** Découpe le corps d'une page de titre en blocs {role, content}. Une ligne
 * `:::rôle: contenu` donne un bloc typé ; une ligne non marquée (rare, ex.
 * une ligne oubliée sans préfixe) devient un bloc sans rôle, stylé comme le
 * corps de page Front par défaut. Les lignes vides sont ignorées : sur une
 * page à rôles, l'espacement vient des marges du modèle, pas de lignes
 * blanches tapées. */
type TitleRoleBlock = {
  role: string | null;
  content: string;
};

export function parseTitleRoles(text: string): TitleRoleBlock[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((line) => {
      const m = line.match(TITLE_ROLE_LINE_RE);
      if (!m) return { role: null, content: line };
      return { role: m[1].trim().toLowerCase(), content: m[2] };
    });
}

/** Vrai si le corps contient au moins une ligne `:::rôle:` — sinon la page de
 * titre est en composition libre et suit l'ancien chemin WYSIWYG. */
export function hasTitleRoleLines(text: string) {
  return text.split("\n").some((l) => TITLE_ROLE_LINE_RE.test(l.trim()));
}

/** Normalisation d'un nom de rôle : la casse et les espaces autour ne
 * distinguent pas deux rôles (`:::Titre :` et `:::titre:` sont le même). */
function normalizeRole(role: string): string {
  return role.trim().toLocaleLowerCase("fr");
}

/** Index de la ligne portant `role`, ou -1. Sert aux lectures comme aux
 * écritures : une seule définition de « où vit ce rôle ». */
function titleRoleLineIndex(lines: string[], role: string): number {
  const wanted = normalizeRole(role);
  return lines.findIndex((line) => {
    const match = line.trim().match(TITLE_ROLE_LINE_RE);
    return !!match && normalizeRole(match[1]) === wanted;
  });
}

/** Valeur actuellement écrite pour un rôle, chaîne vide si le rôle est
 * absent ou vide. Lecture PURE du fichier Front : aucune copie locale de ces
 * champs n'existe ailleurs. */
export function readTitleRoleValue(text: string, role: string): string {
  const lines = String(text || "").split(/\r?\n/);
  const index = titleRoleLineIndex(lines, role);
  if (index < 0) return "";
  return (lines[index].trim().match(TITLE_ROLE_LINE_RE)?.[2] || "").trim();
}

/** Réécrit (ou ajoute) la ligne `:::rôle: valeur` et renvoie le texte
 * complet. Le reste du fichier — frontmatter compris — est laissé intact :
 * c'est la structure existante du feuillet Front qui est modifiée, jamais
 * remplacée. Un rôle absent dont la valeur est vide n'est pas créé. */
export function setTitleRoleValue(text: string, role: string, value: string): string {
  const lines = String(text || "").split(/\r?\n/);
  const index = titleRoleLineIndex(lines, role);
  const replacement = `:::${role.trim()}: ${String(value ?? "").trim()}`;
  if (index >= 0) lines[index] = replacement;
  else if (String(value ?? "").trim()) lines.push(replacement);
  else return String(text || "");
  return lines.join("\n");
}
