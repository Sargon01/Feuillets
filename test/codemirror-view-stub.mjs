export const Decoration = {
  none: { none: true },
  mark: (spec) => ({ range: (from, to) => ({ ...spec, from, to }) }),
  set: (decorations) => decorations,
};

export const EditorView = {
  decorations: { from: (field) => field },
  domEventHandlers: (handlers) => handlers,
};
