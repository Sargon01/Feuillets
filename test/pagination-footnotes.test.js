import { test } from "node:test";
import assert from "node:assert/strict";
import {
  observePaginationFootnotes,
  populatePaginationFootnoteNodes,
  markRepeatedPaginationFootnoteReferences,
  PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE,
  clearRepeatedPaginationFootnoteReferenceMarks,
  paginationFootnoteDisplayMarker,
  normalizePaginationFootnoteReferenceMarkers,
} from "../src/services/pagination-footnotes.js";

/**
 * Helper to create a mock footnote definition
 */
function mockDefinition(id, html = `<p>Note ${id}</p>`) {
  return { id, html };
}

/**
 * Helper to create a mock sup.footnote-ref element
 */
function mockSupElement(id, href = `#${id}`, markerText = id) {
  const attributes = {};
  const sup = {
    tagName: "sup",
    classList: { contains: (name) => name === "footnote-ref" },
    getAttribute: (attr) => attributes[attr] ?? null,
    setAttribute: (attr, value) => { attributes[attr] = value; },
    removeAttribute: (attr) => { delete attributes[attr]; },
    hasAttribute: (attr) => attr in attributes,
  };
  const link = { getAttribute: (attr) => (attr === "href" ? href : null), textContent: markerText };
  sup.querySelector = (selector) => (selector === "a[href]" ? link : null);
  return sup;
}

/**
 * Helper to create a mock page body node
 */
function mockPageNode(footnoteRefs = []) {
  const attributes = {};
  return {
    tagName: "p",
    classList: { contains: () => false },
    getAttribute: (attr) => attributes[attr] ?? null,
    setAttribute: (attr, value) => { attributes[attr] = value; },
    removeAttribute: (attr) => { delete attributes[attr]; },
    hasAttribute: (attr) => attr in attributes,
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === "sup.footnote-ref") return footnoteRefs;
      if (selector.includes("[data-pagination-footnote-repeat")) {
        // Return sups with repeat attribute: either "true" value or any value
        const attrValueTrue = `[${PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE}="true"]`;
        if (selector.includes(attrValueTrue)) {
          // Selector specifies "true" value
          return footnoteRefs.filter((sup) => sup.getAttribute?.(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE) === "true");
        } else {
          // Selector just has [data-pagination-footnote-repeat] without value
          return footnoteRefs.filter((sup) => sup.getAttribute?.(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE) !== null);
        }
      }
      return [];
    },
  };
}

/**
 * Helper to create a mock PaginationPage
 */
function mockPage(bodyNodes) {
  return { bodyNodes, footnoteNodes: [] };
}

test("pagination-footnotes : aucune note", () => {
  const pages = [mockPage([mockPageNode()])];
  const definitions = [];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.deepEqual(obs.calls, []);
  assert.deepEqual(obs.assignedIdsByPage[0], []);
  assert.deepEqual(obs.assignedDefinitionsByPage[0], []);
  assert.deepEqual(obs.missingDefinitionIds, []);
  assert.deepEqual(obs.duplicateDefinitionIds, []);
  assert.deepEqual(obs.unusedDefinitionIds, []);
});

test("pagination-footnotes : une seule note", () => {
  const supRef = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([supRef])])];
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls.length, 1);
  assert.equal(obs.calls[0].id, "fn-1");
  assert.equal(obs.calls[0].pageIndex, 0);
  assert.equal(obs.calls[0].callIndex, 0);
  assert.equal(obs.calls[0].markerText, "fn-1");
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1"]);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
  assert.equal(obs.assignedDefinitionsByPage[0][0].id, "fn-1");
  assert.equal(obs.assignedCallsByPage[0].length, 1);
  assert.equal(obs.assignedCallsByPage[0][0].markerText, "fn-1");
});

test("pagination-footnotes : deux notes sur la même page", () => {
  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-2");
  const pages = [mockPage([mockPageNode([sup1, sup2])])];
  const definitions = [mockDefinition("fn-1"), mockDefinition("fn-2")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls.length, 2);
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1", "fn-2"]);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 2);
});

test("pagination-footnotes : appel répété sur la même page", () => {
  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup1, sup2])])];
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls.length, 2);
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1"]);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
});

test("pagination-footnotes : appel répété sur une page ultérieure", () => {
  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup1])]), mockPage([mockPageNode([sup2])])];
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls.length, 2);
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1"]);
  assert.deepEqual(obs.assignedIdsByPage[1], []);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
  assert.equal(obs.assignedDefinitionsByPage[1].length, 0);
});

test("pagination-footnotes : définition manquante", () => {
  const sup = mockSupElement("fn-missing");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls.length, 1);
  assert.equal(obs.calls[0].id, "fn-missing");
  assert.deepEqual(obs.assignedIdsByPage[0], []);
  assert.deepEqual(obs.missingDefinitionIds, ["fn-missing"]);
});

test("pagination-footnotes : définition en double", () => {
  const sup = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1", "<p>First</p>"), mockDefinition("fn-1", "<p>Second</p>")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
  assert.equal(obs.assignedDefinitionsByPage[0][0].html, "<p>First</p>");
  assert.deepEqual(obs.duplicateDefinitionIds, ["fn-1"]);
});

test("pagination-footnotes : définition inutilisée", () => {
  const pages = [mockPage([mockPageNode()])];
  const definitions = [mockDefinition("fn-1"), mockDefinition("fn-2")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.deepEqual(obs.unusedDefinitionIds, ["fn-1", "fn-2"]);
});

test("pagination-footnotes : fragment hash simple", () => {
  const sup = mockSupElement("fn-1", "#fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls[0].id, "fn-1");
  assert.equal(obs.assignedDefinitionsByPage[0][0].id, "fn-1");
});

test("pagination-footnotes : fragment avec préfixe URL", () => {
  const sup = mockSupElement("fn-2", "app://something#fn-2");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-2")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls[0].id, "fn-2");
  assert.equal(obs.assignedDefinitionsByPage[0][0].id, "fn-2");
});

test("pagination-footnotes : fragment encodé", () => {
  const sup = mockSupElement("fn-test", "#fn%2Dtest");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-test")];

  const obs = observePaginationFootnotes(pages, definitions);

  // Decoded fragment should match
  assert.equal(obs.calls[0].id, "fn-test");
  assert.equal(obs.assignedDefinitionsByPage[0][0].id, "fn-test");
});

test("pagination-footnotes : fragment invalide ne fait pas planter", () => {
  const sup = mockSupElement("invalid");
  const link = { getAttribute: () => "noHashHref" }; // No # in href
  sup.querySelector = () => link;
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [];

  assert.doesNotThrow(() => {
    observePaginationFootnotes(pages, definitions);
  });
});

test("pagination-footnotes : markerText custom", () => {
  const sup = mockSupElement("fn-1", "#fn-1", "[1]");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls[0].markerText, "[1]");
  assert.equal(obs.assignedCallsByPage[0][0].markerText, "[1]");
});

test("pagination-footnotes : id et markerText indépendants", () => {
  const sup = mockSupElement("fn-custom", "#fn-custom", "7");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-custom")];

  const obs = observePaginationFootnotes(pages, definitions);

  assert.equal(obs.calls[0].id, "fn-custom");
  assert.equal(obs.calls[0].markerText, "7");
  assert.equal(obs.assignedCallsByPage[0][0].id, "fn-custom");
  assert.equal(obs.assignedCallsByPage[0][0].markerText, "7");
});

test("pagination-footnotes : populate crée les nodes", () => {
  const sup = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1", "<p>Note content</p>")];

  let createNodeCalled = 0;
  const createNodeCallParams = [];
  const createNode = (def, call) => {
    createNodeCalled++;
    createNodeCallParams.push({ def, call });
    return { tagName: "li", id: def.id, innerHTML: def.html };
  };

  const obs = populatePaginationFootnoteNodes(pages, definitions, createNode);

  assert.equal(createNodeCalled, 1);
  assert.equal(pages[0].footnoteNodes.length, 1);
  assert.equal(pages[0].footnoteNodes[0].id, "fn-1");
  // Verify createNode received both definition and call with markerText
  assert.equal(createNodeCallParams[0].def.id, "fn-1");
  assert.equal(createNodeCallParams[0].call.markerText, "fn-1");
});

test("pagination-footnotes : populate est idempotent", () => {
  const sup = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1")];

  const createNode = () => ({ tagName: "li" });

  populatePaginationFootnoteNodes(pages, definitions, createNode);
  const firstLength = pages[0].footnoteNodes.length;

  populatePaginationFootnoteNodes(pages, definitions, createNode);
  const secondLength = pages[0].footnoteNodes.length;

  assert.equal(firstLength, secondLength);
});

test("pagination-footnotes : populate ne modifie pas bodyNodes", () => {
  const sup = mockSupElement("fn-1");
  const bodyNode = mockPageNode([sup]);
  const pages = [mockPage([bodyNode])];
  const definitions = [mockDefinition("fn-1")];

  const originalBodyNodes = pages[0].bodyNodes;
  const createNode = () => ({ tagName: "li" });

  populatePaginationFootnoteNodes(pages, definitions, createNode);

  assert.strictEqual(pages[0].bodyNodes, originalBodyNodes);
  assert.equal(pages[0].bodyNodes.length, 1);
  assert.strictEqual(pages[0].bodyNodes[0], bodyNode);
});

test("pagination-footnotes : footnoteNodes n'est pas scanné pour les appels", () => {
  // Create a page where footnoteNodes already exists with a fake reference
  const sup = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  pages[0].footnoteNodes = [{ tagName: "li", querySelector: () => mockSupElement("fn-fake") }];

  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes(pages, definitions);

  // Only one call should be found (the one in bodyNodes)
  assert.equal(obs.calls.length, 1);
  assert.equal(obs.calls[0].id, "fn-1");
});

test("pagination-footnotes : markRepeatedPaginationFootnoteReferences marque les doublons", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");
  const sup3 = mockSupElement("fn-2");
  const bodyNode = mockPageNode([sup1, sup2, sup3]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);

  // First occurrence of fn-1: not marked
  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  // Second occurrence of fn-1: marked with "true"
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
  // First (only) occurrence of fn-2: not marked
  assert.strictEqual(sup3.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
});

test("pagination-footnotes : markRepeated A — deux IDs distincts, aucun repeat", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-2");
  const bodyNode = mockPageNode([sup1, sup2]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);

  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
});

test("pagination-footnotes : markRepeated B — trois occurrences du même ID", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");
  const sup3 = mockSupElement("fn-1");
  const bodyNode = mockPageNode([sup1, sup2, sup3]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);

  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
  assert.strictEqual(sup3.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
});

test("pagination-footnotes : markRepeated C — alterne IDs", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-2");
  const sup3 = mockSupElement("fn-1");
  const sup4 = mockSupElement("fn-2");
  const bodyNode = mockPageNode([sup1, sup2, sup3, sup4]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);

  // First occurrences sans attribute
  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  // Repeats avec "true"
  assert.strictEqual(sup3.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
  assert.strictEqual(sup4.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
});

test("pagination-footnotes : markRepeated D — idempotence", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");
  const bodyNode = mockPageNode([sup1, sup2]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);
  const firstState = [
    sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE),
    sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE),
  ];

  markRepeatedPaginationFootnoteReferences([bodyNode]);
  const secondState = [
    sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE),
    sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE),
  ];

  assert.deepEqual(firstState, secondState);
});

test("pagination-footnotes : markRepeated E — nettoie attribut stale", async () => {
  const { markRepeatedPaginationFootnoteReferences } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");

  // Set stale attribute on first occurrence
  sup1.setAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "stale");

  const bodyNode = mockPageNode([sup1, sup2]);

  markRepeatedPaginationFootnoteReferences([bodyNode]);

  // First occurrence attribute should be cleared
  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  // Second occurrence should be marked
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), "true");
});

test("pagination-footnotes : clearRepeatedPaginationFootnoteReferenceMarks supprime les attributs internes", async () => {
  const { clearRepeatedPaginationFootnoteReferenceMarks } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");

  // Mark them
  sup1.removeAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE);
  sup2.setAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "true");

  const bodyNode = mockPageNode([sup1, sup2]);

  clearRepeatedPaginationFootnoteReferenceMarks([bodyNode]);

  // Both should have attribute removed
  assert.strictEqual(sup1.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
  assert.strictEqual(sup2.getAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE), null);
});

test("pagination-footnotes : observePaginationFootnotes conserve tous les appels, affecte définition au premier", async () => {
  const { observePaginationFootnotes } = await import(
    "../src/services/pagination-footnotes.js"
  );

  const sup1 = mockSupElement("fn-1");
  const sup2 = mockSupElement("fn-1");  // Same ID on different page
  const page1 = mockPage([mockPageNode([sup1])]);
  const page2 = mockPage([mockPageNode([sup2])]);
  const definitions = [mockDefinition("fn-1")];

  const obs = observePaginationFootnotes([page1, page2], definitions);

  // Both calls should be recorded
  assert.equal(obs.calls.length, 2);
  assert.equal(obs.calls[0].id, "fn-1");
  assert.equal(obs.calls[0].pageIndex, 0);
  assert.equal(obs.calls[1].id, "fn-1");
  assert.equal(obs.calls[1].pageIndex, 1);

  // But definition should only be assigned to first page
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1"]);
  assert.deepEqual(obs.assignedIdsByPage[1], []);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
  assert.equal(obs.assignedDefinitionsByPage[1].length, 0);
});

test("pagination-footnotes : PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE constant existe et est une chaîne", async () => {
  const { PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE } = await import(
    "../src/services/pagination-footnotes.js"
  );

  assert.equal(typeof PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "string");
  assert.match(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, /^data-/);
  assert.equal(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "data-pagination-footnote-repeat");
});

test("pagination-footnotes : garde sur export-pdf — import des helpers Lot 5", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify Lot 5 helpers are imported
  assert.match(sourceFile, /markRepeatedPaginationFootnoteReferences/);
  assert.match(sourceFile, /cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences/);
  assert.match(sourceFile, /clearRepeatedPaginationFootnoteReferenceMarks/);
  // Verify marking is conditional on footnotes existing
  assert.match(sourceFile, /if \(footnotes && footnotes\.length > 0\)/);
  // Verify cleanup is called
  assert.match(sourceFile, /clearRepeatedPaginationFootnoteReferenceMarks/);
});

test("pagination-footnotes : garde sur export-pdf — structure originale conservée", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify the integration point exists
  assert.match(sourceFile, /populatePaginationFootnoteNodes/);
  assert.match(sourceFile, /const nodes = page\.bodyNodes/);
  // Verify footnotes zone structure
  assert.match(sourceFile, /pdf-page-footnotes/);
  assert.match(sourceFile, /pdf-page-footnotes-separator/);
  assert.match(sourceFile, /pdf-page-footnote-marker/);
  assert.match(sourceFile, /pdf-page-footnote-content/);
  // Verify old .pdf-footnotes-section construction is removed
  assert.doesNotMatch(sourceFile, /pdf-footnotes-section/);
  // Verify markerText normalized and injected via textContent (Finition typographique)
  assert.match(sourceFile, /markerSpan\.textContent = paginationFootnoteDisplayMarker\(call\.markerText\)/);
  // Verify no innerHTML for marker
  assert.doesNotMatch(sourceFile, /markerSpan\.innerHTML/);
  // Verify position relative conditional
  assert.match(sourceFile, /hasPageFootnotes/);
  assert.match(sourceFile, /position: relative/);
  // Verify absolute positioning via setCssStyles
  assert.match(sourceFile, /position\s*:\s*["']absolute["']/);
  assert.match(sourceFile, /left\s*:\s*["']0["']/);
  assert.match(sourceFile, /right\s*:\s*["']0["']/);
  assert.match(sourceFile, /bottom\s*:\s*["']0["']/);
  // Verify column handling via setCssStyles
  assert.match(sourceFile, /columnCount\s*:\s*["']1["']/);
  assert.match(sourceFile, /columnSpan\s*:\s*["']all["']/);
  // Verify notes placed INSIDE pdf-page-content
  assert.match(sourceFile, /pageFootnotesHtml/);
});

// Finition typographique: tests pour paginationFootnoteDisplayMarker
test("pagination-footnotes: paginationFootnoteDisplayMarker removes outer brackets", () => {
  assert.strictEqual(paginationFootnoteDisplayMarker("[1]"), "1");
  assert.strictEqual(paginationFootnoteDisplayMarker("[12]"), "12");
  assert.strictEqual(paginationFootnoteDisplayMarker("[a]"), "a");
});

test("pagination-footnotes: paginationFootnoteDisplayMarker preserves non-bracketed", () => {
  assert.strictEqual(paginationFootnoteDisplayMarker("1"), "1");
  assert.strictEqual(paginationFootnoteDisplayMarker("12"), "12");
  assert.strictEqual(paginationFootnoteDisplayMarker("a"), "a");
});

test("pagination-footnotes: paginationFootnoteDisplayMarker handles incomplete brackets", () => {
  assert.strictEqual(paginationFootnoteDisplayMarker("[1"), "[1");
  assert.strictEqual(paginationFootnoteDisplayMarker("1]"), "1]");
  assert.strictEqual(paginationFootnoteDisplayMarker("[]"), "[]");
});

test("pagination-footnotes: paginationFootnoteDisplayMarker handles empty string", () => {
  assert.strictEqual(paginationFootnoteDisplayMarker(""), "");
});

test("pagination-footnotes: paginationFootnoteDisplayMarker is idempotent", () => {
  const original = "[1]";
  const first = paginationFootnoteDisplayMarker(original);
  const second = paginationFootnoteDisplayMarker(first);
  assert.strictEqual(first, "1");
  assert.strictEqual(second, "1");
});

test("pagination-footnotes: normalizePaginationFootnoteReferenceMarkers normalizes marked reference", () => {
  // Mock a sup.footnote-ref with mutable textContent link
  let linkText = "[1]";
  const link = {
    textContent: linkText,
    getAttribute: (attr) => (attr === "href" ? "#fn-1" : null),
    set textContent(val) { linkText = val; },
    get textContent() { return linkText; },
  };

  const sup = {
    tagName: "SUP",
    classList: { contains: (name) => name === "footnote-ref" },
    querySelector: (sel) => (sel === "a[href]" ? link : null),
    querySelectorAll: () => [],
  };

  normalizePaginationFootnoteReferenceMarkers([sup]);
  assert.strictEqual(linkText, "1");
});

test("pagination-footnotes: normalizePaginationFootnoteReferenceMarkers preserves href", () => {
  let linkText = "[99]";
  const link = {
    textContent: linkText,
    getAttribute: (attr) => (attr === "href" ? "#my-id" : null),
    set textContent(val) { linkText = val; },
    get textContent() { return linkText; },
  };

  const sup = {
    tagName: "SUP",
    classList: { contains: (name) => name === "footnote-ref" },
    querySelector: (sel) => (sel === "a[href]" ? link : null),
    querySelectorAll: () => [],
  };

  normalizePaginationFootnoteReferenceMarkers([sup]);
  assert.strictEqual(linkText, "99");
  assert.strictEqual(link.getAttribute("href"), "#my-id");
});

test("pagination-footnotes: normalizePaginationFootnoteReferenceMarkers handles descendants", () => {
  // Create a parent node with sup.footnote-ref descendants
  let link1Text = "[1]";
  let link2Text = "[2]";

  const sup1 = {
    tagName: "SUP",
    classList: { contains: (name) => name === "footnote-ref" },
    querySelector: () => ({
      textContent: link1Text,
      getAttribute: () => "#fn-1",
      set textContent(val) { link1Text = val; },
      get textContent() { return link1Text; },
    }),
  };

  const sup2 = {
    tagName: "SUP",
    classList: { contains: (name) => name === "footnote-ref" },
    querySelector: () => ({
      textContent: link2Text,
      getAttribute: () => "#fn-2",
      set textContent(val) { link2Text = val; },
      get textContent() { return link2Text; },
    }),
  };

  const parent = {
    querySelectorAll: (sel) => (sel === "sup.footnote-ref" ? [sup1, sup2] : []),
  };

  normalizePaginationFootnoteReferenceMarkers([parent]);
  assert.strictEqual(link1Text, "1");
  assert.strictEqual(link2Text, "2");
});

test("pagination-footnotes: normalizePaginationFootnoteReferenceMarkers is idempotent", () => {
  let linkText = "[1]";
  const link = {
    textContent: linkText,
    getAttribute: () => "#fn-1",
    set textContent(val) { linkText = val; },
    get textContent() { return linkText; },
  };

  const sup = {
    tagName: "SUP",
    classList: { contains: (name) => name === "footnote-ref" },
    querySelector: () => link,
    querySelectorAll: () => [],
  };

  normalizePaginationFootnoteReferenceMarkers([sup]);
  assert.strictEqual(linkText, "1");

  // Apply again - should remain "1", not "1]" or similar
  normalizePaginationFootnoteReferenceMarkers([sup]);
  assert.strictEqual(linkText, "1");
});

test("pagination-footnotes: normalizePaginationFootnoteReferenceMarkers skips non-footnote", () => {
  let text = "[1]";
  const p = {
    tagName: "P",
    classList: { contains: () => false },
    set textContent(val) { text = val; },
    get textContent() { return text; },
    querySelectorAll: () => [],
  };

  normalizePaginationFootnoteReferenceMarkers([p]);
  assert.strictEqual(text, "[1]"); // Should NOT change
});
