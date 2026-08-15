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
};

export const ViewPlugin = {
  fromClass: (cls) => cls,
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
