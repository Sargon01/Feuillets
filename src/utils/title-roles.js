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

/* Espaces admis autour du deux-points, y compris insécable ( ) et fine
   insécable ( ) que la typographie française peut poser avant un « : ». */
const SP = "[ \\t\\u00A0\\u202F]";
const TITLE_ROLE_LINE_RE = new RegExp(`^:::${SP}*(.+?)${SP}*:${SP}?(.*)$`);

/** Découpe le corps d'une page de titre en blocs {role, content}. Une ligne
 * `:::rôle: contenu` donne un bloc typé ; une ligne non marquée (rare, ex.
 * une ligne oubliée sans préfixe) devient un bloc sans rôle, stylé comme le
 * corps de page Front par défaut. Les lignes vides sont ignorées : sur une
 * page à rôles, l'espacement vient des marges du modèle, pas de lignes
 * blanches tapées. */
export function parseTitleRoles(text) {
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
export function hasTitleRoleLines(text) {
  return text.split("\n").some((l) => TITLE_ROLE_LINE_RE.test(l.trim()));
}
