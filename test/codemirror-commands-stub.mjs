/* Repli minimal pour les tests Node : @codemirror/commands n'est jamais
 * installé en dépendance (voir test/codemirror-state-stub.mjs et
 * codemirror-view-stub.mjs, même principe) — Obsidian le fournit réellement
 * à l'exécution. `history()` renvoie toujours LE MÊME objet (comme
 * `EditorView.lineWrapping` dans le stub voisin) pour que les tests de
 * composition d'extensions puissent comparer par référence. */
const HISTORY_EXTENSION = { facet: "history" };

export function history() {
  return HISTORY_EXTENSION;
}

export const historyKeymap = [
  { key: "Mod-z", run: () => false, preventDefault: true },
  { key: "Mod-y", mac: "Mod-Shift-z", run: () => false, preventDefault: true },
  { linux: "Ctrl-Shift-z", key: "Mod-Shift-z", run: () => false, preventDefault: true },
];

/* `redo` PUBLIC (LOT 1.3, correctif Cmd+Maj+Z) : même principe que `history()`
 * ci-dessus — un repli minimal pour les tests Node, toujours LA MÊME
 * référence de fonction, pour que les tests de composition de keymap
 * puissent comparer par référence (voir test/cm-scrivenings.test.js). */
export function redo() {
  return false;
}
