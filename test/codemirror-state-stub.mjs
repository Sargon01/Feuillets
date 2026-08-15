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
  transactionFilter: { of: (fn) => ({ facet: "transactionFilter", fn }) },
};

/* `Prec.highest` (micro-lot 1.3.1) : le stub se contente d'envelopper la
   valeur dans un marqueur inspectable par les tests — c'est le vrai
   CodeMirror qui applique réellement la précédence à l'exécution. */
export const Prec = {
  highest: (extension) => ({ prec: "highest", extension }),
};
