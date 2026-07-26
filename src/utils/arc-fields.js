/** Un champ frontmatter donné peut être une string ou une liste YAML à un
 * seul élément selon la façon dont Obsidian l'a enregistré (panneau
 * Propriétés) — les deux formes existent réellement dans un même coffre. */
export function oneOf(val) {
  return (Array.isArray(val) ? String(val[0] || "") : String(val || "")).trim();
}

/** Arcs d'une scène : `<clé>` (principal) + `<clé>_secondaire` (optionnel),
 * dans cet ordre, sans doublon ni valeur vide. La clé dépend du mode du
 * projet (`arc` en roman/nouvelle, `argument` en thèse/essai, `angle` en
 * article — cf. utils/project-modes.js) : le champ frontmatter doit
 * porter le même nom que le vocabulaire affiché, sinon l'utilisateur
 * saisit "argument: …" en pensant que ça marche et le mode Arcs reste
 * vide. Repli sur `arc`/`arc_secondaire` si la clé du mode est vide (
 * anciennes fiches, ou saisie faite avec le nom générique). */
export function arcsOf(fm, mode) {
  const key = (mode && mode.arc) || "arc";
  const list = [oneOf(fm[key]), oneOf(fm[`${key}_secondary`])].filter(Boolean);
  if (list.length > 0 || key === "arc") return list;
  return [oneOf(fm.arc), oneOf(fm.arc_secondary)].filter(Boolean);
}

/** Personnages d'une scène : liste, ou valeur unique tolérée en string. */
export function personnagesOf(fm) {
  if (Array.isArray(fm.characters)) return fm.characters.filter(Boolean).map(String);
  return fm.characters ? [String(fm.characters)] : [];
}

/** Point de vue (narrateur) d'une scène : valeur unique, distincte de
 * `personnages` (qui liste tout le monde PRÉSENT dans la scène, pas qui la
 * raconte) — un roman multi-POV a besoin de filtrer "toutes les scènes du
 * point de vue de X" indépendamment du casting. Champ facultatif, jamais
 * ajouté au modèle de scène par défaut (comme `fil`/`personnages`) : à
 * l'auteur de le renseigner s'il en a besoin. */
export function povOf(fm) {
  return oneOf(fm.pov);
}

/** Fils narratifs d'une scène : liste de textes (une scène peut avoir
 * plusieurs fils ouverts en même temps). Seule la virgule sépare — pas
 * l'espace — pour ne jamais couper une valeur en texte libre du genre
 * "plante l'indice ici" en plusieurs fils involontairement. */
export function filsOf(fm) {
  const val = fm.thread;
  if (Array.isArray(val)) return val.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === "string" && val.trim()) {
    return val.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}
