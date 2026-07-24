// @ts-check
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
 * est donc pur et testable sans coffre (voir test/numbering.test.js). Le seul
 * appelant de production, `FeuilletsPlugin.buildNumbering()`, y passe les
 * vraies implémentations, dont `isFolder: (n) => n instanceof TFolder`.
 *
 * @typedef {{ path: string, name?: string, children?: any[], [key: string]: any }} NumberingNode
 *   Un nœud de l'arbre. Structurellement compatible avec TFile/TFolder d'un
 *   côté, avec de simples objets littéraux de l'autre (tests).
 *
 * @typedef {object} NumberingHelpers
 * @property {(node: NumberingNode) => NumberingNode[]} [getOrderedChildren]
 *   Enfants dans l'ordre d'affichage (settings.orders + frontmatter `ordre`).
 * @property {(node: NumberingNode) => string} [roleOfFolder] "partie" | "chapitre" | …
 * @property {(node: NumberingNode) => boolean} [isFrontMatter]
 * @property {(node: NumberingNode) => boolean} [isFolder]
 *   Défaut : duck-typing (`children` présent). En production, main.js passe
 *   `instanceof TFolder` — ne pas se reposer sur `constructor.name`, qui ne
 *   survit pas à un renommage de classe et n'apporte rien de plus ici.
 */

/**
 * @param {{ sceneNumbering?: string, chapterNumbering?: string }|null|undefined} settings
 *   Volontairement plus étroit que FeuilletsSettings : ce module ne lit que
 *   ces deux clés, et l'exiger en entier obligerait les tests à fabriquer un
 *   objet de réglages complet pour rien.
 * @param {NumberingNode} root dossier projet (ou sous-arbre) à numéroter.
 * @param {NumberingHelpers} [helpers]
 * @returns {Map<string, string>} chemin → étiquette. Une étiquette vide (`""`)
 *   signifie « pas de numéro » (Front matter, ou numérotation désactivée) et
 *   se distingue d'une absence de clé, qui signifie « nœud non visité ».
 */
export function buildNumbering(settings, root, helpers = {}) {
  const getChildren = helpers.getOrderedChildren || ((f) => f.children || []);
  const getRole = helpers.roleOfFolder || ((f) => f.role || "chapitre");
  const checkFront = helpers.isFrontMatter || ((node) => !!node.isFront);
  const isFolder = helpers.isFolder || ((node) => node.children !== undefined || !!node.isFolder);

  /** @type {Map<string, string>} */
  const map = new Map();
  /* Pas de repli sur une valeur nommée : toute valeur autre que "continue"
     ou "aucune" (y compris undefined) tombe dans la branche hiérarchique,
     comme avant l'extraction hors de main.js. */
  const mode = settings ? settings.sceneNumbering : undefined;
  const chapMode = (settings && settings.chapterNumbering) || "continu";
  let n = 0;
  let sGlobal = 0;

  const chapLabel = () => (chapMode === "aucune" ? "" : `${n}.`);

  /** Front matter : tout le sous-arbre est marqué sans numéro.
   * @param {NumberingNode} f */
  const markFrontMatter = (f) => {
    for (const c of getChildren(f)) {
      map.set(c.path, "");
      if (isFolder(c)) markFrontMatter(c);
    }
  };

  /** @param {NumberingNode} f */
  const walk = (f) => {
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
      /** @param {NumberingNode} cf */
      const walkScenes = (cf) => {
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
