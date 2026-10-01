export const StateEffect = {
  define: () => {
    const type = {
      of: (value) => ({
        type,
        value,
        is: (other) => other === type,
      }),
    };
    return type;
  },
};

export const StateField = {
  define: (config) => ({
    ...config,
    _isStateField: true,
  }),
};

/* Facette `readOnly` : le stub garde seulement la trace de sa provenance, ce
   qui suffit aux tests — c'est le vrai CodeMirror qui la fait respecter. */
export const EditorState = {
  create: (config) => {
    const text = typeof config?.doc === "string" ? config.doc : (config?.doc?.toString?.() ?? "");
    const lines = text.split("\n");
    const starts = [];
    let p = 0;
    for (const line of lines) {
      starts.push(p);
      p += line.length + 1;
    }
    const docObj = {
      length: text.length,
      lines: lines.length,
      toString: () => text,
      sliceString: (from, to) => text.slice(from, to),
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

    const fields = new Map();
    const flatten = (exts) => {
      const res = [];
      if (!exts) return res;
      for (const e of exts) {
        if (Array.isArray(e)) res.push(...flatten(e));
        else if (e) res.push(e);
      }
      return res;
    };
    const state = {
      doc: docObj,
      selection: {
        ranges: [{ from: 0, to: 0 }],
        main: { from: 0, to: 0 },
      },
      extensions: config?.extensions,
      _fields: fields,
      field: (f, required = true) => {
        if (fields.has(f)) return fields.get(f);
        if (f && typeof f.create === "function") {
          const init = f.create(state);
          fields.set(f, init);
          return init;
        }
        if (required) throw new Error("Field not found");
        return undefined;
      },
    };

    const allExts = flatten(config?.extensions);
    for (const ext of allExts) {
      if (ext && typeof ext === "object" && typeof ext.create === "function") {
        try {
          fields.set(ext, ext.create(state));
        } catch {
          // Ignore
        }
      }
    }

    return state;
  },
  readOnly: { from: (field, get) => ({ facet: "readOnly", field, get }) },
  transactionFilter: { of: (fn) => ({ facet: "transactionFilter", fn }) },
};

/* `Prec.highest` (micro-lot 1.3.1) : le stub se contente d'envelopper la
   valeur dans un marqueur inspectable par les tests — c'est le vrai
   CodeMirror qui applique réellement la précédence à l'exécution. */
export const Prec = {
  highest: (extension) => ({ prec: "highest", extension }),
};
