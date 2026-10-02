/* Public Citation Engine API: provider validation, registry lifecycle,
   namespaced FeuilletsCitationApi, and backward compatibility. */

import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const {
  CitationEngineRegistry,
  createCitationApi,
  isCitationEngineProvider,
  validateCitationDocumentResult,
  validateCitationDocumentResultForRequest,
  CITATION_API_VERSION,
} = await import(modulePath("src/api/citation-engine.js"));

const {
  TextAnalysisRegistry,
  createPublicApi,
  FEUILLETS_API_VERSION,
} = await import(modulePath("src/api/text-analysis.js"));

const FeuilletsPluginModule = await import(modulePath("src/main.js"));
const FeuilletsPlugin = FeuilletsPluginModule.default ?? FeuilletsPluginModule;

function makeProvider(id = "feuillets-csl", name = "Feuillets CSL", version = "2.0.0") {
  return {
    id,
    name,
    version,
    renderDocument: async (request) => ({
      documentId: request.documentId,
      revision: request.revision,
      citations: [],
      bibliography: null,
      diagnostics: [],
    }),
    disposeDocument: (_documentId) => {},
  };
}

function makeValidResult(overrides = {}) {
  return {
    documentId: "doc-1",
    revision: 1,
    citations: [
      {
        clusterId: "c1",
        plainText: "(Smith 2020)",
        content: [
          {
            type: "span",
            style: { fontStyle: "normal" },
            children: [
              {
                type: "text",
                text: "(Smith 2020)",
              },
            ],
          },
        ],
      },
    ],
    bibliography: {
      entries: [
        {
          itemIds: ["smith2020"],
          plainText: "Smith, John. 2020. Title.",
          content: [
            {
              type: "block",
              display: "block",
              children: [
                {
                  type: "text",
                  text: "Smith, John. 2020. Title.",
                },
                {
                  type: "link",
                  href: "https://doi.org/10.1000/182",
                  children: [
                    {
                      type: "text",
                      text: "https://doi.org/10.1000/182",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layout: {
        hangingIndent: true,
        entrySpacing: 1,
        lineSpacing: 1,
        secondFieldAlign: "flush",
        maxOffset: 4,
      },
    },
    diagnostics: [
      {
        code: "ITEM_NOT_FOUND",
        severity: "warning",
        message: "Item not found in bibliography.",
        clusterId: "c1",
        citekey: "missing2020",
      },
    ],
    ...overrides,
  };
}

/* -------------------- 1. Validation runtime stricte -------------------- */

test("CITATION_API_VERSION is 2", () => {
  assert.equal(CITATION_API_VERSION, 2);
});

test("isCitationEngineProvider: valid v2 provider accepted", () => {
  const provider = makeProvider();
  assert.equal(isCitationEngineProvider(provider), true);

  const custom = {
    id: "custom-engine",
    name: "Custom Engine",
    version: "0.1.0-beta",
    renderDocument: async () => makeValidResult(),
    disposeDocument: () => {},
  };
  assert.equal(isCitationEngineProvider(custom), true);
});

test("isCitationEngineProvider: v1 legacy provider rejected", () => {
  const v1Provider = {
    id: "feuillets-csl",
    name: "Feuillets CSL",
    version: "1.0.0",
  };
  assert.equal(isCitationEngineProvider(v1Provider), false);
});

test("isCitationEngineProvider: missing renderDocument or disposeDocument rejected", () => {
  assert.equal(
    isCitationEngineProvider({
      id: "csl",
      name: "CSL",
      version: "2.0.0",
      disposeDocument: () => {},
    }),
    false
  );
  assert.equal(
    isCitationEngineProvider({
      id: "csl",
      name: "CSL",
      version: "2.0.0",
      renderDocument: async () => ({}),
    }),
    false
  );
  assert.equal(
    isCitationEngineProvider({
      id: "csl",
      name: "CSL",
      version: "2.0.0",
      renderDocument: "not-a-function",
      disposeDocument: () => {},
    }),
    false
  );
  assert.equal(
    isCitationEngineProvider({
      id: "csl",
      name: "CSL",
      version: "2.0.0",
      renderDocument: async () => ({}),
      disposeDocument: 123,
    }),
    false
  );
});

test("isCitationEngineProvider: invalid metadata rejected", () => {
  // Non-objects or falsy
  assert.equal(isCitationEngineProvider(null), false);
  assert.equal(isCitationEngineProvider(undefined), false);
  assert.equal(isCitationEngineProvider(42), false);
  assert.equal(isCitationEngineProvider("provider"), false);
  assert.equal(isCitationEngineProvider([]), false);

  // Missing or empty id
  assert.equal(isCitationEngineProvider({ name: "CSL", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "", name: "CSL", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "   ", name: "CSL", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: 123, name: "CSL", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);

  // Missing or empty name
  assert.equal(isCitationEngineProvider({ id: "csl", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "  \t ", version: "2.0.0", renderDocument: () => {}, disposeDocument: () => {} }), false);

  // Missing or empty version
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", version: "", renderDocument: () => {}, disposeDocument: () => {} }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", version: "   \n", renderDocument: () => {}, disposeDocument: () => {} }), false);
});

/* -------------------- 2. CitationEngineRegistry -------------------- */

test("registry: register and get provider", () => {
  const registry = new CitationEngineRegistry();
  assert.equal(registry.get(), null, "registry empty initially");
  assert.equal(registry.get("feuillets-csl"), null);

  const provider = makeProvider();
  registry.register(provider);

  assert.equal(registry.get(), provider, "retrieves default active provider");
  assert.equal(registry.get("feuillets-csl"), provider, "retrieves provider by id");
  assert.equal(registry.get("non-existent"), null);
});

test("registry: invalid provider throws and is not registered", () => {
  const registry = new CitationEngineRegistry();

  assert.throws(
    () => registry.register(null),
    /invalid citation engine provider/
  );
  assert.throws(
    () => registry.register({ id: "csl", name: "CSL" }),
    /invalid citation engine provider/
  );
  assert.throws(
    () => registry.register({ id: "csl", name: "CSL", version: "1.0.0" }),
    /invalid citation engine provider/
  );

  assert.equal(registry.get(), null);
  assert.equal(registry.list().length, 0);
});

test("registry: re-registering same id replaces previous provider (reload lifecycle)", () => {
  const registry = new CitationEngineRegistry();
  const v1 = makeProvider("feuillets-csl", "CSL v1", "2.0.0");
  const v2 = makeProvider("feuillets-csl", "CSL v2", "2.1.0");

  registry.register(v1);
  assert.equal(registry.get("feuillets-csl"), v1);
  assert.equal(registry.list().length, 1);

  registry.register(v2);
  assert.equal(registry.get("feuillets-csl"), v2, "provider replaced with newer instance");
  assert.equal(registry.list().length, 1, "does not duplicate provider");
});

test("registry: unregister removes provider", () => {
  const registry = new CitationEngineRegistry();
  const provider = makeProvider();

  registry.register(provider);
  assert.equal(registry.get("feuillets-csl"), provider);

  const removed = registry.unregister("feuillets-csl");
  assert.equal(removed, true);
  assert.equal(registry.get("feuillets-csl"), null);
  assert.equal(registry.get(), null);
  assert.equal(registry.list().length, 0);
});

test("registry: unregister of non-existent id returns false without throwing", () => {
  const registry = new CitationEngineRegistry();

  assert.equal(registry.unregister("never-registered"), false);
  assert.doesNotThrow(() => registry.unregister("never-registered"));

  const provider = makeProvider();
  registry.register(provider);
  assert.equal(registry.unregister("other-id"), false);
  assert.equal(registry.get("feuillets-csl"), provider);
});

test("registry: list returns all registered providers", () => {
  const registry = new CitationEngineRegistry();
  const p1 = makeProvider("csl-1", "Engine 1", "2.0.0");
  const p2 = makeProvider("csl-2", "Engine 2", "2.0.0");

  assert.deepEqual(registry.list(), []);

  registry.register(p1);
  assert.deepEqual(registry.list(), [p1]);

  registry.register(p2);
  assert.deepEqual(registry.list(), [p1, p2]);

  registry.unregister("csl-1");
  assert.deepEqual(registry.list(), [p2]);
});

test("registry: onChange listeners notified on register and effective unregister", () => {
  const registry = new CitationEngineRegistry();
  const events = [];

  const unsubscribe = registry.onChange(() => events.push("change"));

  const p1 = makeProvider("csl-1");
  registry.register(p1);
  assert.equal(events.length, 1, "notified on register");

  // Re-registering triggers change
  const p1Reloaded = makeProvider("csl-1", "CSL Reloaded", "2.0.1");
  registry.register(p1Reloaded);
  assert.equal(events.length, 2, "notified on reload replacement");

  // Effective unregister triggers change
  registry.unregister("csl-1");
  assert.equal(events.length, 3, "notified on unregister");

  // Ineffective unregister (already absent) does NOT trigger change
  registry.unregister("csl-1");
  assert.equal(events.length, 3, "not notified when nothing removed");

  // Unsubscribe stops notifications
  unsubscribe();
  registry.register(p1);
  assert.equal(events.length, 3, "not notified after unsubscribe");
});

test("registry: throwing listener does not break registry operations", () => {
  const registry = new CitationEngineRegistry();
  let normalCalled = false;

  registry.onChange(() => {
    throw new Error("Simulated faulty companion view listener");
  });
  registry.onChange(() => {
    normalCalled = true;
  });

  const p = makeProvider();
  assert.doesNotThrow(() => registry.register(p));
  assert.equal(normalCalled, true);
  assert.equal(registry.get("feuillets-csl"), p);

  normalCalled = false;
  assert.doesNotThrow(() => registry.unregister("feuillets-csl"));
  assert.equal(normalCalled, true);
  assert.equal(registry.get("feuillets-csl"), null);
});

/* -------------------- 3. FeuilletsCitationApi & Factory -------------------- */

test("createCitationApi: namespaced API contract and operations", () => {
  const registry = new CitationEngineRegistry();
  const citationApi = createCitationApi(registry);

  assert.equal(citationApi.apiVersion, CITATION_API_VERSION);
  assert.equal(citationApi.apiVersion, 2);

  assert.deepEqual(
    Object.keys(citationApi).sort(),
    ["apiVersion", "getProvider", "registerProvider", "unregisterProvider"]
  );

  const provider = makeProvider();
  citationApi.registerProvider(provider);
  assert.equal(citationApi.getProvider(), provider);
  assert.equal(citationApi.getProvider("feuillets-csl"), provider);

  citationApi.unregisterProvider("feuillets-csl");
  assert.equal(citationApi.getProvider(), null);
});

/* -------------------- 4. Intégration dans plugin.api -------------------- */

test("plugin.api.citations: exposed with apiVersion 2 and fully operational", () => {
  const analysisRegistry = new TextAnalysisRegistry();
  const citationRegistry = new CitationEngineRegistry();
  const publicApi = createPublicApi(analysisRegistry, citationRegistry);

  assert.ok(publicApi.citations, "publicApi.citations is defined");
  assert.equal(publicApi.citations.apiVersion, 2);

  // Citation operations via plugin.api.citations
  const cslProvider = makeProvider("feuillets-csl", "Feuillets CSL", "2.0.0");
  publicApi.citations.registerProvider(cslProvider);
  assert.equal(publicApi.citations.getProvider(), cslProvider);
  assert.equal(publicApi.citations.getProvider("feuillets-csl"), cslProvider);

  publicApi.citations.unregisterProvider("feuillets-csl");
  assert.equal(publicApi.citations.getProvider(), null);
});

test("FeuilletsPlugin instance exposes citations on plugin.api", () => {
  const fakeApp = {};
  const fakeManifest = {};
  const plugin = new FeuilletsPlugin(fakeApp, fakeManifest);

  assert.ok(plugin.citationRegistry instanceof CitationEngineRegistry);
  assert.ok(plugin.api, "plugin.api exists");
  assert.ok(plugin.api.citations, "plugin.api.citations exists");
  assert.equal(plugin.api.citations.apiVersion, 2);

  const provider = makeProvider();
  plugin.api.citations.registerProvider(provider);
  assert.equal(plugin.api.citations.getProvider(), provider);
  plugin.api.citations.unregisterProvider("feuillets-csl");
  assert.equal(plugin.api.citations.getProvider(), null);
});

/* -------------------- 5. Rétrocompatibilité absolue -------------------- */

test("backward compatibility: FEUILLETS_API_VERSION is unchanged and equals 1", () => {
  assert.equal(FEUILLETS_API_VERSION, 1);
});

test("backward compatibility: text analysis API remains strictly available", () => {
  const analysisRegistry = new TextAnalysisRegistry();
  const citationRegistry = new CitationEngineRegistry();
  const publicApi = createPublicApi(analysisRegistry, citationRegistry);

  assert.equal(publicApi.apiVersion, FEUILLETS_API_VERSION);
  assert.equal(typeof publicApi.registerAnalysisProvider, "function");
  assert.equal(typeof publicApi.unregisterAnalysisProvider, "function");
  assert.equal(typeof publicApi.getAnalysisProvider, "function");

  const mockAnalysisProvider = {
    id: "grammalecte",
    name: "Grammalecte",
    analyze: () => Promise.resolve([]),
  };

  publicApi.registerAnalysisProvider(mockAnalysisProvider);
  assert.equal(publicApi.getAnalysisProvider(), mockAnalysisProvider);
  assert.equal(publicApi.getAnalysisProvider("grammalecte"), mockAnalysisProvider);

  publicApi.unregisterAnalysisProvider("grammalecte");
  assert.equal(publicApi.getAnalysisProvider(), null);
});

/* -------------------- 6. validateCitationDocumentResult -------------------- */

test("validateCitationDocumentResult: valid document result accepted", () => {
  const result = makeValidResult();
  const val = validateCitationDocumentResult(result);
  assert.equal(val.valid, true, `Validation failed: ${val.errors.join(", ")}`);
  assert.equal(val.errors.length, 0);

  // Bibliography null is valid (when includeBibliography: false)
  const valNullBib = validateCitationDocumentResult(makeValidResult({ bibliography: null }));
  assert.equal(valNullBib.valid, true);
});

test("validateCitationDocumentResult: root structure errors detected", () => {
  assert.equal(validateCitationDocumentResult(null).valid, false);
  assert.equal(validateCitationDocumentResult("string").valid, false);
  assert.equal(validateCitationDocumentResult([]).valid, false);

  // Missing or invalid documentId
  assert.equal(validateCitationDocumentResult(makeValidResult({ documentId: "" })).valid, false);
  assert.equal(validateCitationDocumentResult(makeValidResult({ documentId: "   " })).valid, false);
  assert.equal(validateCitationDocumentResult(makeValidResult({ documentId: 123 })).valid, false);

  // Invalid revision
  assert.equal(validateCitationDocumentResult(makeValidResult({ revision: -1 })).valid, false);
  assert.equal(validateCitationDocumentResult(makeValidResult({ revision: 1.5 })).valid, false);
  assert.equal(validateCitationDocumentResult(makeValidResult({ revision: "1" })).valid, false);

  // Invalid citations array
  assert.equal(validateCitationDocumentResult(makeValidResult({ citations: "none" })).valid, false);
  assert.equal(validateCitationDocumentResult(makeValidResult({ citations: [null] })).valid, false);

  // Invalid diagnostics array
  assert.equal(validateCitationDocumentResult(makeValidResult({ diagnostics: {} })).valid, false);

  // Missing or undefined bibliography property
  const missingBib = makeValidResult();
  delete missingBib.bibliography;
  const valMissing = validateCitationDocumentResult(missingBib);
  assert.equal(valMissing.valid, false);
  assert.ok(valMissing.errors.some((e) => e.includes("bibliography must be null or an object.")));

  const undefinedBib = makeValidResult({ bibliography: undefined });
  const valUndefined = validateCitationDocumentResult(undefinedBib);
  assert.equal(valUndefined.valid, false);
  assert.ok(valUndefined.errors.some((e) => e.includes("bibliography must be null or an object.")));
});

test("validateCitationDocumentResult: rejects each invalid AST node type", () => {
  const invalidTypeResult = makeValidResult({
    citations: [
      {
        clusterId: "c1",
        plainText: "cite",
        content: [{ type: "unknown-type", text: "foo" }],
      },
    ],
  });
  const val = validateCitationDocumentResult(invalidTypeResult);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some((e) => e.includes("type must be 'text', 'span', 'block', or 'link'")));
});

test("validateCitationDocumentResult: rejects invalid typography styles and display values", () => {
  // Invalid fontStyle
  const invalidStyleResult = makeValidResult({
    citations: [
      {
        clusterId: "c1",
        plainText: "cite",
        content: [
          {
            type: "span",
            style: { fontStyle: "comic-sans" },
            children: [{ type: "text", text: "foo" }],
          },
        ],
      },
    ],
  });
  const valStyle = validateCitationDocumentResult(invalidStyleResult);
  assert.equal(valStyle.valid, false);
  assert.ok(valStyle.errors.some((e) => e.includes("fontStyle must be")));

  // Invalid block display
  const invalidDisplayResult = makeValidResult({
    citations: [
      {
        clusterId: "c1",
        plainText: "cite",
        content: [
          {
            type: "block",
            display: "inline-flex",
            children: [{ type: "text", text: "foo" }],
          },
        ],
      },
    ],
  });
  const valDisplay = validateCitationDocumentResult(invalidDisplayResult);
  assert.equal(valDisplay.valid, false);
  assert.ok(valDisplay.errors.some((e) => e.includes("display must be")));
});

test("validateCitationDocumentResult: rejects raw HTML fields injected maliciously", () => {
  const rawHtmlOnRoot = makeValidResult({ html: "<script>alert(1)</script>" });
  assert.equal(validateCitationDocumentResult(rawHtmlOnRoot).valid, false);

  const rawHtmlOnNode = makeValidResult({
    citations: [
      {
        clusterId: "c1",
        plainText: "cite",
        content: [
          {
            type: "text",
            text: "cite",
            innerHTML: "<b>bold</b>",
          },
        ],
      },
    ],
  });
  const valNode = validateCitationDocumentResult(rawHtmlOnNode);
  assert.equal(valNode.valid, false);
  assert.ok(valNode.errors.some((e) => e.includes("forbidden property 'innerHTML'")));

  const rawHtmlOnBibEntry = makeValidResult({
    bibliography: {
      entries: [
        {
          itemIds: ["item1"],
          plainText: "text",
          rawHtml: "<div onclick='...'>click</div>",
          content: [{ type: "text", text: "text" }],
        },
      ],
      layout: { hangingIndent: true, entrySpacing: 1, lineSpacing: 1 },
    },
  });
  const valBib = validateCitationDocumentResult(rawHtmlOnBibEntry);
  assert.equal(valBib.valid, false);
  assert.ok(valBib.errors.some((e) => e.includes("forbidden property 'rawHtml'")));
});

test("validateCitationDocumentResult: rejects invalid bibliography layout", () => {
  const invalidLayout = makeValidResult({
    bibliography: {
      entries: [],
      layout: {
        hangingIndent: "not-a-bool",
        entrySpacing: -2,
        lineSpacing: 1,
        secondFieldAlign: "invalid-align",
      },
    },
  });
  const val = validateCitationDocumentResult(invalidLayout);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some((e) => e.includes("hangingIndent must be a boolean")));
  assert.ok(val.errors.some((e) => e.includes("entrySpacing must be a number >= 0")));
  assert.ok(val.errors.some((e) => e.includes("secondFieldAlign must be 'flush' or 'margin'")));
});

test("validateCitationDocumentResult: rejects invalid diagnostics", () => {
  const invalidDiag = makeValidResult({
    diagnostics: [
      {
        code: "",
        severity: "fatal",
        message: 123,
      },
    ],
  });
  const val = validateCitationDocumentResult(invalidDiag);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some((e) => e.includes("code must be a non-empty string")));
  assert.ok(val.errors.some((e) => e.includes("severity must be 'warning' or 'error'")));
  assert.ok(val.errors.some((e) => e.includes("message must be a string")));
});

/* -------------------- 7. validateCitationDocumentResultForRequest -------------------- */

test("validateCitationDocumentResultForRequest: matches exact documentId and revision", () => {
  const request = {
    documentId: "doc-alpha",
    revision: 5,
    style: { id: "apa", version: "1", xml: "<style/>" },
    bibliographies: [{ id: "b1", version: "1", format: "bibtex", content: "@book{}" }],
    clusters: [],
    includeBibliography: false,
  };

  const matchingResult = makeValidResult({ documentId: "doc-alpha", revision: 5 });
  const val = validateCitationDocumentResultForRequest(request, matchingResult);
  assert.equal(val.valid, true);
  assert.equal(val.errors.length, 0);

  // Mismatched documentId
  const mismatchedDocResult = makeValidResult({ documentId: "doc-beta", revision: 5 });
  const valDoc = validateCitationDocumentResultForRequest(request, mismatchedDocResult);
  assert.equal(valDoc.valid, false);
  assert.ok(valDoc.errors.some((e) => e.includes("Document ID mismatch")));

  // Mismatched revision
  const mismatchedRevResult = makeValidResult({ documentId: "doc-alpha", revision: 6 });
  const valRev = validateCitationDocumentResultForRequest(request, mismatchedRevResult);
  assert.equal(valRev.valid, false);
  assert.ok(valRev.errors.some((e) => e.includes("Revision mismatch")));
});
