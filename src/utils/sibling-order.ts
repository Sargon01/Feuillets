// @ts-check
/** Réconciliation d'un ordre de fratrie avec un instantané pris plus tôt —
 * utilisé par la commande « Annuler le dernier déplacement » (main.js), dont
 * les deux branches (déplacement inter-dossiers, réorganisation) partagent
 * cette étape avant d'écrire le résultat différemment.
 *
 * Pur : ni Obsidian ni état de plugin, l'appelant fournit les enfants courants.
 *
 * @typedef {{ name: string }} NamedChild
 */

/**
 * Réordonne `current` pour suivre `names`, en tolérant que l'arbre ait bougé
 * depuis la prise de l'instantané :
 *  - un nom de l'instantané qui n'existe plus est ignoré ;
 *  - un enfant apparu depuis est conservé, repoussé en fin de liste — jamais
 *    perdu, car la liste renvoyée sert ensuite à réécrire l'ordre complet du
 *    dossier : un oubli ici effacerait sa position.
 *
 * @template {NamedChild} T
 * @param {T[]} current enfants du dossier, dans leur ordre actuel.
 * @param {string[]} names noms de l'instantané, dans l'ordre voulu.
 * @returns {T[]} exactement les éléments de `current`, réordonnés.
 */
export function orderFromSnapshot<T extends { name: string }>(current: T[], names: string[]): T[] {
  const byName = new Map(current.map((c) => [c.name, c]));
  const restored: T[] = [];
  for (const n of names) {
    const child = byName.get(n);
    /* `delete` au passage : un instantané contenant deux fois le même nom ne
       doit pas insérer le même enfant deux fois dans la liste renvoyée. */
    if (child) {
      restored.push(child);
      byName.delete(n);
    }
  }
  for (const c of byName.values()) restored.push(c);
  return restored;
}
