/** Transformations appliquées au corps de chaque feuillet pendant la
 * compilation (voir readBody, services/compile-export.js). Elles s'appliquent
 * soit au corps entier d'une scène, soit bloc par bloc sur une page de titre à
 * rôles — d'où leur regroupement ici plutôt qu'en ligne dans `compile()`.
 *
 * Pur : aucune dépendance à Obsidian, tout arrive en paramètre. */

import { frenchTypography } from "./core.js";
import { renamespaceFootnotes } from "./footnotes.js";

/* Un wikilien, mais PAS un embed. Décomposition :
     (?<!!)              — pas précédé de « ! » : ![[image.png]] reste un embed
                           et doit traverser la compilation intact.
     \[\[([^\]|#]+)      — la cible, jusqu'au premier « | », « # » ou « ] »
     (?:#[^\]|]*)?       — ancre de titre éventuelle, jetée
     (?:\|([^\]]*))?     — alias éventuel, qui prime sur la cible
     \]\]
   Le texte conservé est l'alias s'il existe, sinon la cible : un wikilien est
   un outil d'organisation du coffre, il n'a rien à faire dans un manuscrit
   livré, mais le mot qu'il porte, si. */
const WIKILINK_RE = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/**
 * Espace de noms des notes de bas de page d'un feuillet, dérivé de son chemin.
 * Chaque fichier numérote ses notes à partir de 1 sans savoir que la
 * compilation les concatène : sans ce préfixe, deux `[^1]` de deux scènes
 * différentes pointeraient sur la même note.
 *
 * ATTENTION — la substitution est aveugle aux accents : tout caractère non
 * alphanumérique ASCII devient « - ». Deux feuillets dont les noms ne
 * diffèrent QUE par des caractères accentués aux mêmes positions (« Scène é »
 * et « Scène è ») produisent donc le même préfixe, et leurs notes se
 * mélangeraient. Cas rare mais réel ; le corriger demande de suffixer un
 * condensé du chemin (voir bookmarkIdFor, utils/docx-bookmarks.js), au prix
 * d'étiquettes de notes moins lisibles dans le Manuscrit.md compilé.
 */
export function footnotePrefixFor(path: string): string {
  return String(path || "")
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * Retire les wikiliens en conservant leur texte lisible. Les embeds
 * (`![[…]]`) sont laissés intacts : ce sont des images, pas des liens.
 */
export function stripWikilinks(str: string): string {
  return str.replace(WIKILINK_RE, (_, target, alias) =>
    (alias !== undefined ? alias : target).trim()
  );
}

/**
 * Les trois transformations communes à tout texte compilé, dans l'ordre où
 * elles doivent s'appliquer : renumérotation des notes, retrait des
 * wikiliens, puis typographie française.
 *
 * L'ordre compte — la typographie française insère des espaces insécables et
 * remplace les guillemets ; l'appliquer avant le retrait des wikiliens
 * risquerait de toucher au contenu d'un lien qui n'aurait pas dû l'être.
 */
export function applyCompileTransforms(
  str: string,
  footnotePrefix: string,
  applyFrenchTypography = false
): string {
  let out = renamespaceFootnotes(str, footnotePrefix);
  out = stripWikilinks(out);
  if (applyFrenchTypography) out = frenchTypography(out, false);
  return out;
}
