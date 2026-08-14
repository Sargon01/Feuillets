export const StateEffect = {
  define: () => ({ of: (value) => ({ value }) }),
};

export const StateField = {
  define: (config) => config,
};

/* Facette `readOnly` : le stub garde seulement la trace de sa provenance, ce
   qui suffit aux tests — c'est le vrai CodeMirror qui la fait respecter. */
export const EditorState = {
  readOnly: { from: (field, get) => ({ facet: "readOnly", field, get }) },
};
