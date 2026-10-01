/* CSL Citation Host Coordinator Tests (Lot 7A) */

import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const {
  CslCitationHost,
  resolveCslLocale,
  DEFAULT_CSL_PROVIDER_ID,
} = await import(modulePath("src/services/csl-citation-host.js"));

const {
  CitationEngineRegistry,
} = await import(modulePath("src/api/citation-engine.js"));

const { TFile, TFolder } = await import("obsidian");
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));

function createMockProvider(overrides = {}) {
  return {
    id: "feuillets-csl",
    name: "Feuillets CSL",
    version: "2.0.0",
    renderDocument: async (req) => ({
      documentId: req.documentId,
      revision: req.revision,
      citations: [
        {
          clusterId: req.clusters[0]?.id ?? "citation:0:10",
          plainText: "(Smith, 2024)",
          content: [
            {
              type: "span",
              style: { fontStyle: "normal" },
              children: [{ type: "text", text: "(Smith, 2024)" }],
            },
          ],
        },
      ],
      bibliography: null,
      diagnostics: [],
    }),
    disposeDocument: (_id) => {},
    ...overrides,
  };
}

function createMockProjectSetup() {
  const project = new TFolder("PROJECT");
  const projectResearch = new TFolder("PROJECT/Research");
  const bibFile = new TFile("PROJECT/Research/refs.bib");
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 12345, size: 500 };
  bibFile.content = "@article{smith2024, author={Smith}, year={2024}}";

  const cslFile = new TFile("PROJECT/Research/style.csl");
  cslFile.extension = "csl";
  cslFile.stat = { mtime: 67890, size: 300 };
  cslFile.content = "<style><info><title>APA</title></info></style>";

  projectResearch.parent = project;
  projectResearch.children = [bibFile, cslFile];
  bibFile.parent = projectResearch;
  cslFile.parent = projectResearch;
  project.children = [projectResearch];

  const { vault } = createFakeVault([
    project,
    projectResearch,
    bibFile,
    cslFile,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
        },
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "style.csl",
      },
    },
  };

  const app = { vault };
  return { app, settings, projectRoot: project, bibFile, cslFile };
}

/* -------------------- 1. Locale Mapping Tests -------------------- */

test("resolveCslLocale: closed mapping for fr, fr-FR, en, and en-US", () => {
  assert.equal(resolveCslLocale("fr"), "fr-FR");
  assert.equal(resolveCslLocale("fr-FR"), "fr-FR");
  assert.equal(resolveCslLocale("en"), "en-US");
  assert.equal(resolveCslLocale("en-US"), "en-US");

  // Other variants or languages must return undefined
  assert.equal(resolveCslLocale("fr-CA"), undefined);
  assert.equal(resolveCslLocale("en-GB"), undefined);
  assert.equal(resolveCslLocale("de"), undefined);
  assert.equal(resolveCslLocale("es"), undefined);
  assert.equal(resolveCslLocale(""), undefined);
  assert.equal(resolveCslLocale(null), undefined);
  assert.equal(resolveCslLocale(undefined), undefined);
});

/* -------------------- 2. Provider Resolution Tests -------------------- */

test("renderDocument: returns provider-unavailable when provider is not registered", async () => {
  assert.equal(DEFAULT_CSL_PROVIDER_ID, "feuillets-csl");
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  const host = new CslCitationHost({ app, settings, citationRegistry: registry });

  const snapshot = await host.renderDocument("doc-1", "[@smith2024]", projectRoot, null);
  assert.equal(snapshot.status, "provider-unavailable");
  assert.ok(snapshot.reason.includes("feuillets-csl"));

  host.dispose();
});

test("renderDocument: resolves registered provider successfully", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  const snapshot = await host.renderDocument("doc-1", "[@smith2024]", projectRoot, null);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.documentId, "doc-1");
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.result.citations.length, 1);
  assert.equal(snapshot.parsedDocument.occurrences.length, 1);

  host.dispose();
});

/* -------------------- 3. Resource Resolution Tests -------------------- */

test("renderDocument: returns resources-unavailable when bibliography is missing", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  // Clear bibliography path
  delete settings.projectMeta[projectRoot.path].citekeyBibliographyPath;

  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());
  const host = new CslCitationHost({ app, settings, citationRegistry: registry });

  const snapshot = await host.renderDocument("doc-1", "[@smith2024]", projectRoot, null);
  assert.equal(snapshot.status, "resources-unavailable");
  assert.equal(snapshot.bibliographyStatus, "not_configured");

  host.dispose();
});

test("renderDocument: returns resources-unavailable when CSL style is missing", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  delete settings.projectMeta[projectRoot.path].citekeyCslPath;

  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());
  const host = new CslCitationHost({ app, settings, citationRegistry: registry });

  const snapshot = await host.renderDocument("doc-1", "[@smith2024]", projectRoot, null);
  assert.equal(snapshot.status, "resources-unavailable");
  assert.equal(snapshot.cslStatus, "not_configured");

  host.dispose();
});

/* -------------------- 4. Resource IDs and Version Tokens -------------------- */

test("renderDocument: sends normalized paths and mtime:size version tokens", async () => {
  const { app, settings, projectRoot, bibFile, cslFile } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  let capturedRequest = null;
  registry.register(
    createMockProvider({
      renderDocument: async (req) => {
        capturedRequest = req;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [],
          bibliography: null,
          diagnostics: [],
        };
      },
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  await host.renderDocument("doc-1", "[@smith2024]", projectRoot, null);

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.documentId, "doc-1");
  assert.equal(capturedRequest.revision, 1);
  assert.equal(capturedRequest.style.id, cslFile.path);
  assert.equal(capturedRequest.style.version, "67890:300");
  assert.equal(capturedRequest.bibliographies[0].id, bibFile.path);
  assert.equal(capturedRequest.bibliographies[0].version, "12345:500");
  assert.equal(capturedRequest.bibliographies[0].format, "bibtex");
  assert.equal(typeof capturedRequest.bibliographies[0].content, "string");
  assert.equal(typeof capturedRequest.style.xml, "string");

  host.dispose();
});

/* -------------------- 5. Asynchronous Race Test (§20) -------------------- */

test("asynchronous race condition: older revision resolving later cannot overwrite newer snapshot", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  let resolveRev1 = null;
  const promiseRev1 = new Promise((resolve) => {
    resolveRev1 = resolve;
  });

  registry.register(
    createMockProvider({
      renderDocument: async (req) => {
        if (req.revision === 1) {
          // Delay revision 1 until manually resolved
          await promiseRev1;
          return {
            documentId: req.documentId,
            revision: 1,
            citations: [{ clusterId: "c1", plainText: "Rev1", content: [] }],
            bibliography: null,
            diagnostics: [],
          };
        }

        // Revision 2 resolves immediately
        return {
          documentId: req.documentId,
          revision: 2,
          citations: [{ clusterId: "c1", plainText: "Rev2", content: [] }],
          bibliography: null,
          diagnostics: [],
        };
      },
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });

  // 1. Request Rev 1 starts
  const req1Promise = host.renderDocument("doc-race", "[@rev1_key]", projectRoot, null);

  // 2. Request Rev 2 starts
  const req2Promise = host.renderDocument("doc-race", "[@rev2_key]", projectRoot, null);

  // 3. Revision 2 resolves first
  const snap2 = await req2Promise;
  assert.equal(snap2.status, "ready");
  assert.equal(snap2.revision, 2);
  assert.equal(snap2.result.citations[0].plainText, "Rev2");

  // Verify host's cached snapshot is revision 2
  assert.equal(host.getLatestSnapshot("doc-race")?.revision, 2);

  // 4. Revision 1 resolves later
  resolveRev1();
  const snap1 = await req1Promise;
  assert.equal(snap1.status, "ready");
  assert.equal(snap1.revision, 2);
  assert.equal(snap1.result.citations[0].plainText, "Rev2");

  // The returned snapshot for rev 1 must NOT downgrade the session
  assert.equal(host.getLatestSnapshot("doc-race")?.revision, 2);
  assert.equal(
    host.getLatestSnapshot("doc-race")?.result.citations[0].plainText,
    "Rev2"
  );

  host.dispose();
});

/* -------------------- 6. Provider Error Handling Tests -------------------- */

test("renderDocument: handles provider throw safely without throwing to caller", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  registry.register(
    createMockProvider({
      renderDocument: async () => {
        throw new Error("citeproc engine crash");
      },
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  const snapshot = await host.renderDocument("doc-err", "[@smith2024]", projectRoot, null);

  assert.equal(snapshot.status, "engine-error");
  assert.ok(snapshot.reason.includes("citeproc engine crash"));

  host.dispose();
});

test("renderDocument: rejects structurally invalid provider result", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  registry.register(
    createMockProvider({
      renderDocument: async () => ({
        // Missing documentId and revision
        citations: "invalid",
      }),
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  const snapshot = await host.renderDocument("doc-invalid", "[@smith2024]", projectRoot, null);

  assert.equal(snapshot.status, "engine-error");
  assert.ok(snapshot.reason.includes("invalid result structure"));

  host.dispose();
});

test("renderDocument: rejects result with revision mismatch", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  registry.register(
    createMockProvider({
      renderDocument: async (req) => ({
        documentId: req.documentId,
        revision: 9999, // Mismatched revision
        citations: [],
        bibliography: null,
        diagnostics: [],
      }),
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  const snapshot = await host.renderDocument("doc-mismatch", "[@smith2024]", projectRoot, null);

  assert.equal(snapshot.status, "engine-error");
  assert.ok(snapshot.reason.includes("does not match request"));

  host.dispose();
});

/* -------------------- 7. Occurrence Lookup & Invalidation -------------------- */

test("getCitation: retrieves rendered citation by clusterId", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  const snapshot = await host.renderDocument("doc-lookup", "[@smith2024]", projectRoot, null);
  assert.equal(snapshot.status, "ready");

  const clusterId = snapshot.parsedDocument.occurrences[0].clusterId;
  const cit = host.getCitation("doc-lookup", clusterId);
  assert.ok(cit);
  assert.equal(cit.plainText, "(Smith, 2024)");

  assert.equal(host.getCitation("doc-lookup", "non-existent-id"), null);

  host.dispose();
});

test("invalidateProvider: clears cached sessions when provider changes", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  await host.renderDocument("doc-inv", "[@smith2024]", projectRoot, null);
  assert.ok(host.getLatestSnapshot("doc-inv"));

  // Invalidate provider directly
  host.invalidateProvider();
  assert.equal(host.getLatestSnapshot("doc-inv"), null);

  host.dispose();
});

test("invalidateResource: invalidates only sessions using modified resource", async () => {
  const { app, settings, projectRoot, bibFile } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  await host.renderDocument("doc-res", "[@smith2024]", projectRoot, null);
  assert.ok(host.getLatestSnapshot("doc-res"));

  // Invalidate unrelated file -> session remains intact
  host.invalidateResource("Unrelated/file.bib");
  assert.ok(host.getLatestSnapshot("doc-res"));

  // Invalidate actual bibliography file -> session is cleared
  host.invalidateResource(bibFile.path);
  assert.equal(host.getLatestSnapshot("doc-res"), null);

  host.dispose();
});

test("disposeDocument: releases session and calls provider.disposeDocument", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  let disposedDocId = null;
  registry.register(
    createMockProvider({
      disposeDocument: (id) => {
        disposedDocId = id;
      },
    })
  );

  const host = new CslCitationHost({ app, settings, citationRegistry: registry });
  await host.renderDocument("doc-dispose", "[@smith2024]", projectRoot, null);
  assert.ok(host.getLatestSnapshot("doc-dispose"));

  host.disposeDocument("doc-dispose");
  assert.equal(host.getLatestSnapshot("doc-dispose"), null);
  assert.equal(disposedDocId, "doc-dispose");

  host.dispose();
});

/* -------------------- 9. Host Session Ownership & Invalidation Regression (Lot 7B) -------------------- */

test("Regression A: invalidateResource disposes provider session before reuse and restarts revisions cleanly", async () => {
  const { app, settings, projectRoot, bibFile } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  const disposedDocs = [];
  const requestedRevisions = [];

  registry.register(
    createMockProvider({
      renderDocument: async (req) => {
        requestedRevisions.push(req.revision);
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "c1",
              plainText: `Rev ${req.revision}`,
              content: [{ type: "text", text: `Rev ${req.revision}` }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
      disposeDocument: (id) => {
        disposedDocs.push(id);
      },
    })
  );

  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });

  // Render doc rev 1
  await host.renderDocument("doc-a", "[@smith2024]", projectRoot, null);
  assert.deepEqual(requestedRevisions, [1]);

  // Render doc rev 2
  await host.renderDocument("doc-a", "[@smith2024, p. 2]", projectRoot, null);
  assert.deepEqual(requestedRevisions, [1, 2]);

  // Invalidate resource
  host.invalidateResource(bibFile.path);
  assert.deepEqual(disposedDocs, ["doc-a"], "Provider disposeDocument must be called before reuse");

  // Render same documentId again -> fresh session starts at revision 1, no revision conflict
  const freshSnap = await host.renderDocument("doc-a", "[@smith2024, p. 3]", projectRoot, null);
  assert.equal(freshSnap.status, "ready");
  assert.equal(freshSnap.revision, 1);
  assert.deepEqual(requestedRevisions, [1, 2, 1], "New session starts cleanly from revision 1");

  host.dispose();
});

test("Regression B: provider replacement disposes session on old provider and new provider starts fresh", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  const disposedA = [];
  const providerA = createMockProvider({
    id: "feuillets-csl",
    name: "Provider A",
    disposeDocument: (id) => {
      disposedA.push(id);
    },
  });

  registry.register(providerA);

  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });
  await host.renderDocument("doc-b", "[@smith2024]", projectRoot, null);

  // Replace provider A with provider B in registry (triggers registry.onChange -> invalidateProvider)
  const disposedB = [];
  const providerBRevisions = [];
  const providerB = createMockProvider({
    id: "feuillets-csl",
    name: "Provider B",
    renderDocument: async (req) => {
      providerBRevisions.push(req.revision);
      return {
        documentId: req.documentId,
        revision: req.revision,
        citations: [
          {
            clusterId: req.clusters[0]?.id ?? "c1",
            plainText: "From B",
            content: [{ type: "text", text: "From B" }],
          },
        ],
        bibliography: null,
        diagnostics: [],
      };
    },
    disposeDocument: (id) => {
      disposedB.push(id);
    },
  });

  registry.register(providerB);

  // Provider A must have had its session disposed
  assert.deepEqual(disposedA, ["doc-b"], "Provider A session must be disposed");

  // Rendering doc-b now sends fresh session to provider B starting at revision 1
  const bSnap = await host.renderDocument("doc-b", "[@smith2024]", projectRoot, null);
  assert.equal(bSnap.status, "ready");
  assert.equal(bSnap.revision, 1);
  assert.deepEqual(providerBRevisions, [1]);

  host.dispose();
  assert.deepEqual(disposedB, ["doc-b"], "Provider B session must be disposed on host.dispose");
});

test("Regression C: host.dispose() disposes every tracked document exactly once", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  const disposed = [];
  registry.register(
    createMockProvider({
      disposeDocument: (id) => {
        disposed.push(id);
      },
    })
  );

  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });
  await host.renderDocument("doc-c1", "[@smith2024]", projectRoot, null);
  await host.renderDocument("doc-c2", "[@smith2024]", projectRoot, null);

  host.dispose();
  assert.deepEqual(disposed.sort(), ["doc-c1", "doc-c2"]);

  // Calling dispose again is a no-op
  host.dispose();
  assert.equal(disposed.length, 2);
});

test("Regression D: disposing unknown documentId does not call provider", async () => {
  const { app, settings, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();

  let providerDisposed = false;
  registry.register(
    createMockProvider({
      disposeDocument: () => {
        providerDisposed = true;
      },
    })
  );

  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });
  await host.renderDocument("doc-real", "[@smith2024]", projectRoot, null);

  // Dispose an unknown documentId
  host.disposeDocument("doc-unknown-999");
  assert.equal(providerDisposed, false, "Disposing unknown documentId must not call provider");

  host.dispose();
});

test("onInvalidation: subscribers receive targeted or global invalidation events", async () => {
  const { app, settings, projectRoot, bibFile } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });
  await host.renderDocument("doc-inv-1", "[@smith2024]", projectRoot, null);

  const events = [];
  const unsubscribe = host.onInvalidation((ev) => {
    events.push(ev);
  });

  // Targeted resource invalidation
  host.invalidateResource(bibFile.path);
  assert.equal(events.length, 1);
  assert.deepEqual(Array.from(events[0].documentIds || []), ["doc-inv-1"]);

  // Global invalidation
  host.invalidateAllResources();
  assert.equal(events.length, 2);
  assert.equal(events[1].documentIds, null);

  // Unsubscribe
  unsubscribe();
  host.invalidateAllResources();
  assert.equal(events.length, 2, "Unsubscribed listener should not receive more events");

  host.dispose();
});

test("getSettings: host uses fresh settings per render", async () => {
  const { app, projectRoot } = createMockProjectSetup();
  const registry = new CitationEngineRegistry();
  registry.register(createMockProvider());

  let currentSettings = {
    projectFolder: projectRoot.path,
    projectMeta: {
      [projectRoot.path]: {
        researchFolderLinks: { [projectRoot.path]: "PROJECT/Research" },
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "style.csl",
      },
    },
  };

  const host = new CslCitationHost({
    app,
    getSettings: () => currentSettings,
    citationRegistry: registry,
  });

  const snap1 = await host.renderDocument("doc-s", "[@smith2024]", projectRoot, null);
  assert.equal(snap1.status, "ready");

  // Mutate or replace settings to point to missing CSL
  currentSettings = {
    projectFolder: projectRoot.path,
    projectMeta: {
      [projectRoot.path]: {
        researchFolderLinks: { [projectRoot.path]: "PROJECT/Research" },
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "nonexistent.csl",
      },
    },
  };

  const snap2 = await host.renderDocument("doc-s", "[@smith2024, p. 10]", projectRoot, null);
  assert.equal(snap2.status, "resources-unavailable");

  host.dispose();
});
