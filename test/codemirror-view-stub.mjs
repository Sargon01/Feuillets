export const Decoration = {
  none: { none: true },
  mark: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  widget: (spec) => ({ range: (from) => ({ ...spec, from }) }),
  line: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  set: (decorations) => decorations,
};

export const EditorView = {
  decorations: { from: (field) => field },
  editable: { from: (field, get) => ({ facet: "editable", field, get }) },
  domEventHandlers: (handlers) => handlers,
};

export const ViewPlugin = {
  fromClass: (cls) => cls,
};

export class WidgetType {
  compare(other) { return this.eq(other); }
  eq(other) { return this === other; }
  destroy() {}
}
