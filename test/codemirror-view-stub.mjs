export const Decoration = {
  none: { none: true },
  mark: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  replace: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  widget: (spec) => ({ range: (from) => ({ ...spec, from }) }),
  line: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  set: (decorations) => decorations,
};

export function EditorView(config) {
  this.state = config?.state;
  this.dom = config?.parent;
  this.visibleRanges = [{ from: 0, to: config?.state?.doc?.length ?? 0 }];
  this.plugins = [];
  this.focus = () => {};
  this.destroy = () => {
    for (const plugin of this.plugins) {
      if (typeof plugin.destroy === "function") {
        try {
          plugin.destroy();
        } catch {
          // Ignore
        }
      }
    }
  };

function makeDoc(text) {
  const lines = text.split("\n");
  const starts = [];
  let p = 0;
  for (const line of lines) {
    starts.push(p);
    p += line.length + 1;
  }
  return {
    length: text.length,
    lines: lines.length,
    toString: () => text,
    sliceString: (from, to) => text.slice(from, to === undefined ? text.length : to),
    lineAt: (offset) => {
      let idx = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= offset) idx = i;
        else break;
      }
      return {
        number: idx + 1,
        from: starts[idx],
        to: starts[idx] + lines[idx].length,
        text: lines[idx],
      };
    },
  };
}

  this.dispatch = (tr) => {
    if (!tr) return;
    const changes = tr.changes ? (Array.isArray(tr.changes) ? tr.changes : [tr.changes]) : [];
    if (tr.changes && this.state?.doc) {
      let str = this.state.doc.toString();
      const sorted = [...changes].sort((a, b) => b.from - a.from);
      for (const ch of sorted) {
        str = str.slice(0, ch.from) + (ch.insert || "") + str.slice(ch.to ?? ch.from);
      }
      this.state.doc = makeDoc(str);
      this.visibleRanges = [{ from: 0, to: str.length }];
    }
    if (tr.selection && this.state) {
      const anchor = tr.selection.anchor ?? tr.selection.ranges?.[0]?.from ?? 0;
      this.state.selection = {
        ranges: [{ from: anchor, to: anchor }],
        main: { from: anchor, to: anchor },
      };
    }
    const effects = Array.isArray(tr.effects) ? tr.effects : (tr.effects ? [tr.effects] : []);
    if (this.state?._fields) {
      for (const [field, val] of this.state._fields.entries()) {
        if (typeof field.update === "function") {
          try {
            this.state._fields.set(field, field.update(val, {
              effects,
              docChanged: Boolean(tr.changes),
              selectionSet: Boolean(tr.selection),
            changes: {
              mapPos: (pos) => pos,
              touchesRange: (from, to) => changes.some((change) => {
                const changeFrom = change.from;
                const changeTo = change.to ?? change.from;
                return changeFrom <= to && changeTo >= from;
              }),
            },
              state: this.state,
            }));
          } catch {
            // Ignore stub-only field update mismatches
          }
        }
      }
    }
    for (const plugin of this.plugins) {
      if (typeof plugin.update === "function") {
        plugin.update({
          view: this,
          state: this.state,
          docChanged: Boolean(tr.changes),
          selectionSet: Boolean(tr.selection),
          changes: tr.changes,
          transactions: [tr],
        });
      }
    }
  };

  const flatten = (exts) => {
    const res = [];
    if (!exts) return res;
    for (const e of exts) {
      if (Array.isArray(e)) res.push(...flatten(e));
      else if (e) res.push(e);
    }
    return res;
  };
  for (const ext of flatten(config?.state?.extensions)) {
    if (typeof ext === "function") {
      try {
        this.plugins.push(new ext(this));
      } catch {
        // Ignore non-constructors
      }
    }
  }
}

EditorView.decorations = { from: (field) => field };
EditorView.editable = { from: (field, get) => ({ facet: "editable", field, get }) };
EditorView.domEventHandlers = (handlers) => handlers;
EditorView.updateListener = { of: (fn) => ({ facet: "updateListener", fn }) };
EditorView.lineWrapping = { facet: "lineWrapping" };
EditorView.keymap = { of: (bindings) => ({ facet: "keymap", bindings }) };
EditorView.scrollIntoView = (pos, options) => ({ effect: "scrollIntoView", pos, options });

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
