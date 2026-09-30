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
  CITATION_API_VERSION,
} = await import(modulePath("src/api/citation-engine.js"));

const {
  TextAnalysisRegistry,
  createPublicApi,
  FEUILLETS_API_VERSION,
} = await import(modulePath("src/api/text-analysis.js"));

const FeuilletsPluginModule = await import(modulePath("src/main.js"));
const FeuilletsPlugin = FeuilletsPluginModule.default ?? FeuilletsPluginModule;

function makeProvider(id = "feuillets-csl", name = "Feuillets CSL", version = "1.0.0") {
  return {
    id,
    name,
    version,
  };
}

/* -------------------- 1. Validation runtime stricte -------------------- */

test("isCitationEngineProvider: valid provider accepted", () => {
  const provider = makeProvider();
  assert.equal(isCitationEngineProvider(provider), true);

  const custom = { id: "custom-engine", name: "Custom Engine", version: "0.1.0-beta" };
  assert.equal(isCitationEngineProvider(custom), true);
});

test("isCitationEngineProvider: invalid provider rejected", () => {
  // Non-objects or falsy
  assert.equal(isCitationEngineProvider(null), false);
  assert.equal(isCitationEngineProvider(undefined), false);
  assert.equal(isCitationEngineProvider(42), false);
  assert.equal(isCitationEngineProvider("provider"), false);
  assert.equal(isCitationEngineProvider([]), false);

  // Missing or empty id
  assert.equal(isCitationEngineProvider({ name: "CSL", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: "", name: "CSL", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: "   ", name: "CSL", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: 123, name: "CSL", version: "1.0.0" }), false);

  // Missing or empty name
  assert.equal(isCitationEngineProvider({ id: "csl", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "  \t ", version: "1.0.0" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: {}, version: "1.0.0" }), false);

  // Missing or empty version
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", version: "" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", version: "   \n" }), false);
  assert.equal(isCitationEngineProvider({ id: "csl", name: "CSL", version: 1 }), false);
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
    () => registry.register({ id: "   ", name: "CSL", version: "1.0.0" }),
    /invalid citation engine provider/
  );

  assert.equal(registry.get(), null);
  assert.equal(registry.list().length, 0);
});

test("registry: re-registering same id replaces previous provider (reload lifecycle)", () => {
  const registry = new CitationEngineRegistry();
  const v1 = makeProvider("feuillets-csl", "CSL v1", "1.0.0");
  const v2 = makeProvider("feuillets-csl", "CSL v2", "1.1.0");

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
  const p1 = makeProvider("csl-1", "Engine 1", "1.0.0");
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
  const p1Reloaded = makeProvider("csl-1", "CSL Reloaded", "1.0.1");
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
  assert.equal(citationApi.apiVersion, 1);

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

test("plugin.api.citations: exposed with apiVersion 1 and fully operational", () => {
  const analysisRegistry = new TextAnalysisRegistry();
  const citationRegistry = new CitationEngineRegistry();
  const publicApi = createPublicApi(analysisRegistry, citationRegistry);

  assert.ok(publicApi.citations, "publicApi.citations is defined");
  assert.equal(publicApi.citations.apiVersion, 1);

  // Citation operations via plugin.api.citations
  const cslProvider = makeProvider("feuillets-csl", "Feuillets CSL", "1.0.0");
  publicApi.citations.registerProvider(cslProvider);
  assert.equal(publicApi.citations.getProvider(), cslProvider);
  assert.equal(publicApi.citations.getProvider("feuillets-csl"), cslProvider);

  publicApi.citations.unregisterProvider("feuillets-csl");
  assert.equal(publicApi.citations.getProvider(), null);
});

test("FeuilletsPlugin instance exposes citations on plugin.api", () => {
  // Test instance field initializers on prototype-created plugin instance
  const fakeApp = {};
  const fakeManifest = {};
  const plugin = new FeuilletsPlugin(fakeApp, fakeManifest);

  assert.ok(plugin.citationRegistry instanceof CitationEngineRegistry);
  assert.ok(plugin.api, "plugin.api exists");
  assert.ok(plugin.api.citations, "plugin.api.citations exists");
  assert.equal(plugin.api.citations.apiVersion, 1);

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
