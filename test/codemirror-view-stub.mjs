export const Decoration = {
  none: { none: true },
  mark: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  replace: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  widget: (spec) => ({ range: (from) => ({ ...spec, from }) }),
  line: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  set: (decorations) => decorations,
};

export const EditorView = {
  decorations: { from: (field) => field },
  editable: { from: (field, get) => ({ facet: "editable", field, get }) },
  domEventHandlers: (handlers) => handlers,
  updateListener: { of: (fn) => ({ facet: "updateListener", fn }) },
  lineWrapping: { facet: "lineWrapping" },
  keymap: { of: (bindings) => ({ facet: "keymap", bindings }) },
  /* LOT « clic Preview → Continu » (ScriveningsView.focusSourcePosition) —
     stub minimal de l'API STATIQUE réelle : un vrai CodeMirror renvoie un
     StateEffect ; ici, un simple objet inspectable suffit aux tests
     (dispatchCalls[0].effects). */
  scrollIntoView: (pos, options) => ({ effect: "scrollIntoView", pos, options }),
};

export const ViewPlugin = {
  /* Retourne TOUJOURS `cls` (rétrocompatible avec tous les tests
     historiques qui font `ext[1] === MaPluginClass` ou l'instancient
     directement) — mais attache le `spec` du PluginSpec réel (notamment
     `eventHandlers`) sous une propriété TEST-ONLY inspectable, pour que
     les tests puissent réellement exercer le pipeline pointerdown →
     pointermove → pointerup plutôt que seulement des helpers purs (voir
     test/cm-paragraph-reorder.test.js). Aucune sémantique runtime
     nouvelle : ce fichier n'existe que dans le harness Node. */
  fromClass: (cls, spec) => {
    if (spec !== undefined) {
      Object.defineProperty(cls, "__viewPluginSpec", { value: spec, configurable: true, enumerable: false });
    }
    return cls;
  },
};

/* `keymap` PUBLIC de haut niveau (micro-lot 1.3.1), distinct de
   `EditorView.keymap` ci-dessus mais même principe de stub — c'est le vrai
   CodeMirror qui combine réellement les bindings à l'exécution. */
export const keymap = {
  of: (bindings) => ({ facet: "keymap", bindings }),
};

export class WidgetType {
  compare(other) { return this.eq(other); }
  eq(other) { return this === other; }
  destroy() {}
}
