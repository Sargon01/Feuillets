import { test } from "node:test";
import assert from "node:assert/strict";
import {
  observePaginationFootnotes,
  populatePaginationFootnoteNodes,
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
function mockSupElement(id, href = `#${id}`) {
  const sup = { tagName: "sup", classList: { contains: (name) => name === "footnote-ref" } };
  const link = { getAttribute: (attr) => (attr === "href" ? href : null) };
  sup.querySelector = (selector) => (selector === "a[href]" ? link : null);
  return sup;
}

/**
 * Helper to create a mock page body node
 */
function mockPageNode(footnoteRefs = []) {
  return {
    tagName: "p",
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === "sup.footnote-ref" ? footnoteRefs : []),
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
  assert.deepEqual(obs.assignedIdsByPage[0], ["fn-1"]);
  assert.equal(obs.assignedDefinitionsByPage[0].length, 1);
  assert.equal(obs.assignedDefinitionsByPage[0][0].id, "fn-1");
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

test("pagination-footnotes : populate crée les nodes", () => {
  const sup = mockSupElement("fn-1");
  const pages = [mockPage([mockPageNode([sup])])];
  const definitions = [mockDefinition("fn-1", "<p>Note content</p>")];

  let createNodeCalled = 0;
  const createNode = (def) => {
    createNodeCalled++;
    return { tagName: "li", id: def.id, innerHTML: def.html };
  };

  const obs = populatePaginationFootnoteNodes(pages, definitions, createNode);

  assert.equal(createNodeCalled, 1);
  assert.equal(pages[0].footnoteNodes.length, 1);
  assert.equal(pages[0].footnoteNodes[0].id, "fn-1");
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

test("pagination-footnotes : garde sur export-pdf", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify the integration point exists
  assert.match(sourceFile, /populatePaginationFootnoteNodes/);
  assert.match(sourceFile, /const nodes = page\.bodyNodes/);
  // Verify it doesn't use footnoteNodes in serialization
  assert.doesNotMatch(sourceFile, /page\.footnoteNodes[\s\S]{0,50}outerHTML/);
});
