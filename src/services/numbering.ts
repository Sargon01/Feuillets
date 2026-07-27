/**
 * Numérotation des chapitres et des scènes du manuscrit — la carte
 * `{chemin: étiquette}` consommée par le binder, le plan, les cartes et les
 * modales de sélection (toutes via `plugin.buildNumbering()`, main.js).
 *
 * Croise quatre dimensions :
 *  - `sceneNumbering` : "continue" (numéro global) | "aucune" | autre =
 *    hiérarchique (1.1, 1.2…) — c'est le repli, pas une valeur nommée.
 *  - `chapterNumbering` : "continu" | "parPartie" (remise à zéro à chaque
 *    dossier de rôle « partie ») | "aucune" (étiquettes vides).
 *  - exclusion du Front matter, récursivement.
 *  - récursion dans les sous-dossiers d'un chapitre : une scène nichée est
 *    numérotée dans la suite de son chapitre, pas comme un chapitre à part.
 *
 * Toutes les dépendances à Obsidian sont injectées via `helpers` — le module
 * est donc pur et testable sans coffre (voir test/numbering.test.js). */

type NumberingNode = {
  path: string;
  name?: string;
  children?: NumberingNode[];
  [key: string]: unknown;
};

type NumberingHelpers = {
  getOrderedChildren?: (node: NumberingNode) => NumberingNode[];
  roleOfFolder?: (node: NumberingNode) => string;
  isFrontMatter?: (node: NumberingNode) => boolean;
  isFolder?: (node: NumberingNode) => boolean;
};

/** Volontairement plus étroit que FeuilletsSettings : ce module ne lit que
 * ces deux clés, et l'exiger en entier obligerait les tests à fabriquer un
 * objet de réglages complet pour rien. */
export function buildNumbering(
  settings: { sceneNumbering?: string; chapterNumbering?: string } | null | undefined,
  root: NumberingNode,
  helpers: NumberingHelpers = {}
): Map<string, string> {
  const getChildren = helpers.getOrderedChildren || ((f: NumberingNode) => f.children || []);
  const getRole = helpers.roleOfFolder || ((f: NumberingNode) => f.role as string || "chapitre");
  const checkFront = helpers.isFrontMatter || ((node: NumberingNode) => !!node.isFront);
  const isFolder = helpers.isFolder || ((node: NumberingNode) => node.children !== undefined || !!node.isFolder);

  const map = new Map<string, string>();
  /* Pas de repli sur une valeur nommée : toute valeur autre que "continue"
     ou "aucune" (y compris undefined) tombe dans la branche hiérarchique,
     comme avant l'extraction hors de main.js. */
  const mode = settings ? settings.sceneNumbering : undefined;
  const chapMode = (settings && settings.chapterNumbering) || "continu";
  let n = 0;
  let sGlobal = 0;

  const chapLabel = (): string => (chapMode === "aucune" ? "" : `${n}.`);

  /** Front matter : tout le sous-arbre est marqué sans numéro. */
  const markFrontMatter = (f: NumberingNode): void => {
    for (const c of getChildren(f)) {
      map.set(c.path, "");
      if (isFolder(c)) markFrontMatter(c);
    }
  };

  const walk = (f: NumberingNode): void => {
    if (chapMode === "parPartie" && getRole(f) === "partie") n = 0;
    for (const child of getChildren(f)) {
      if (checkFront(child)) {
        map.set(child.path, "");
        if (isFolder(child)) markFrontMatter(child);
        continue;
      }

      if (!isFolder(child)) {
        /* Un fichier hors chapitre compte lui-même comme un chapitre. */
        n++;
        map.set(child.path, chapLabel());
        continue;
      }

      if (getRole(child) !== "chapitre") {
        walk(child);
        continue;
      }

      n++;
      map.set(child.path, chapLabel());
      let m = 0;
      const walkScenes = (cf: NumberingNode): void => {
        for (const sc of getChildren(cf)) {
          if (isFolder(sc)) {
            walkScenes(sc);
            continue;
          }
          m++;
          sGlobal++;
          if (mode === "continue") map.set(sc.path, String(sGlobal));
          else if (mode === "aucune") map.set(sc.path, "");
          else map.set(sc.path, chapMode === "aucune" ? String(m) : `${n}.${m}`);
        }
      };
      walkScenes(child);
    }
  };

  walk(root);
  return map;
}
