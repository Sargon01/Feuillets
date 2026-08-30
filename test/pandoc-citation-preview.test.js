import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  parsePandocCitationBibliography,
  formatPandocCitationText,
} from "../src/services/pandoc-citation-preview.js";

/**
 * Parser BibTeX tests.
 */
test("parsePandocCitationBibliography: simple @article entry", () => {
  const bib = `@article{smith2024,
  author = {Smith, John},
  year = {2024},
  title = {Example}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 1);
  const entry = entries.get("smith2024");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["Smith"]);
  assert.equal(entry.year, "2024");
});

test("parsePandocCitationBibliography: two authors", () => {
  const bib = `@article{doe2023,
  author = {Doe, Jane and Brown, Alex},
  year = {2023},
  title = {Example}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("doe2023");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["Doe", "Brown"]);
});

test("parsePandocCitationBibliography: name without comma", () => {
  const bib = `@article{smith2024,
  author = {John Smith},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("smith2024");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["Smith"]);
});

test("parsePandocCitationBibliography: three authors", () => {
  const bib = `@book{jones2022,
  author = {Jones, Alice and Smith, Bob and Davis, Carol},
  year = {2022}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("jones2022");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["Jones", "Smith", "Davis"]);
});

test("parsePandocCitationBibliography: institutional author {{...}}", () => {
  const bib = `@report{who2020,
  author = {{World Health Organization}},
  year = {2020}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("who2020");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["World Health Organization"]);
});

test("parsePandocCitationBibliography: fallback to editor", () => {
  const bib = `@book{editor2023,
  editor = {Editor, Name},
  year = {2023}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("editor2023");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["Editor"]);
});

test("parsePandocCitationBibliography: fallback to date field", () => {
  const bib = `@article{dated2023,
  author = {Smith, John},
  date = {2023-06-17}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("dated2023");
  assert.ok(entry);
  assert.equal(entry.year, "2023");
});

test("parsePandocCitationBibliography: accents preserved", () => {
  const bib = `@article{garcía2024,
  author = {García Márquez, Gabriel},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  const entry = entries.get("garcía2024");
  assert.ok(entry);
  assert.deepEqual(entry.authors, ["García Márquez"]);
});

test("parsePandocCitationBibliography: title with nested braces doesn't break", () => {
  const bib = `@article{nested2024,
  author = {Smith, John},
  title = {An {Important} Result with {Nested} Braces},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 1);
  const entry = entries.get("nested2024");
  assert.ok(entry);
});

test("parsePandocCitationBibliography: multiple entries", () => {
  const bib = `@article{smith2024,
  author = {Smith, John},
  year = {2024}
}

@book{doe2023,
  author = {Doe, Jane},
  year = {2023}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 2);
  assert.ok(entries.get("smith2024"));
  assert.ok(entries.get("doe2023"));
});

test("parsePandocCitationBibliography: @string ignored", () => {
  const bib = `@string{CoolJournal = "Cool Journal"}

@article{smith2024,
  author = {Smith, John},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 1);
});

test("parsePandocCitationBibliography: @comment ignored", () => {
  const bib = `@comment{This is a comment}

@article{smith2024,
  author = {Smith, John},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 1);
});

test("parsePandocCitationBibliography: @preamble ignored", () => {
  const bib = `@preamble{"Some preamble text"}

@article{smith2024,
  author = {Smith, John},
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 1);
});

test("parsePandocCitationBibliography: entry without year is not added", () => {
  const bib = `@article{noYear,
  author = {Smith, John}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 0);
});

test("parsePandocCitationBibliography: entry without author/editor is not added", () => {
  const bib = `@article{noAuthor,
  year = {2024}
}`;
  const entries = parsePandocCitationBibliography(bib);
  assert.equal(entries.size, 0);
});

/**
 * Citation formatting tests.
 */
test("formatPandocCitationText: [@smith2024]", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Voir [@smith2024].", entries);
  assert.equal(result, "Voir (Smith, 2024).");
});

test("formatPandocCitationText: [@smith2024, p. 42]", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Voir [@smith2024, p. 42].", entries);
  assert.equal(result, "Voir (Smith, 2024, p. 42).");
});

test("formatPandocCitationText: [@smith2024, pp. 42–44]", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Voir [@smith2024, pp. 42–44].", entries);
  assert.equal(result, "Voir (Smith, 2024, pp. 42–44).");
});

test("formatPandocCitationText: two authors", () => {
  const entries = new Map([
    ["doe2023", { key: "doe2023", authors: ["Doe", "Brown"], year: "2023" }],
  ]);
  const result = formatPandocCitationText("Comparaison [@doe2023].", entries);
  assert.equal(result, "Comparaison (Doe & Brown, 2023).");
});

test("formatPandocCitationText: three authors (et al.)", () => {
  const entries = new Map([
    ["multi2023", { key: "multi2023", authors: ["Smith", "Jones", "Davis"], year: "2023" }],
  ]);
  const result = formatPandocCitationText("Multiple [@multi2023].", entries);
  assert.equal(result, "Multiple (Smith et al., 2023).");
});

test("formatPandocCitationText: [@smith2024; @doe2023]", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ["doe2023", { key: "doe2023", authors: ["Doe"], year: "2023" }],
  ]);
  const result = formatPandocCitationText("Comparaison [@smith2024; @doe2023].", entries);
  assert.equal(result, "Comparaison (Smith, 2024; Doe, 2023).");
});

test("formatPandocCitationText: multiple groups in one text", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ["doe2023", { key: "doe2023", authors: ["Doe"], year: "2023" }],
  ]);
  const result = formatPandocCitationText("A [@smith2024]. B [@doe2023].", entries);
  assert.equal(result, "A (Smith, 2024). B (Doe, 2023).");
});

test("formatPandocCitationText: unknown citekey leaves entire group unchanged", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Voir [@smith2024; @unknown].", entries);
  assert.equal(result, "Voir [@smith2024; @unknown].");
});

test("formatPandocCitationText: narrative form unchanged", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Smith @smith2024 dit quelque chose.", entries);
  assert.equal(result, "Smith @smith2024 dit quelque chose.");
});

test("formatPandocCitationText: prefix not starting with @ unchanged", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const result = formatPandocCitationText("Voir [@smith2024].", entries);
  assert.equal(result, "Voir (Smith, 2024).");
  const result2 = formatPandocCitationText("[see @smith2024].", entries);
  assert.equal(result2, "[see @smith2024].");
});

test("formatPandocCitationText: email unchanged", () => {
  const entries = new Map();
  const result = formatPandocCitationText("Contactez john@example.com.", entries);
  assert.equal(result, "Contactez john@example.com.");
});

test("formatPandocCitationText: text without citations unchanged", () => {
  const entries = new Map();
  const result = formatPandocCitationText("Texte ordinaire sans citation.", entries);
  assert.equal(result, "Texte ordinaire sans citation.");
});

test("formatPandocCitationText: idempotent", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);
  const input = "Voir [@smith2024].";
  const first = formatPandocCitationText(input, entries);
  const second = formatPandocCitationText(first, entries);
  assert.equal(first, second);
  assert.equal(second, "Voir (Smith, 2024).");
});

/**
 * DOM helper for testing text node transformation without App/TFile dependency.
 * Simulates a minimal DOM tree and allows transformation via a callback.
 */
class FakeDOMNode {
  constructor(tagName, textContent = "") {
    this.tagName = tagName ? tagName.toUpperCase() : "";
    this._textContent = textContent;
    this.childNodes = [];
    this.parentElement = null;
    this.className = "";
    this.href = null;
    this.attributes = {};
    this._isText = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  get nodeType() {
    return this._isText ? 3 : 1; // 3 = TEXT_NODE, 1 = ELEMENT_NODE
  }

  get textContent() {
    if (this._isText) {
      return this._textContent;
    }
    // For elements, concatenate all child text content
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    if (this._isText) {
      this._textContent = value;
    } else {
      // For elements, clear children and set text
      this._textContent = value;
      this.childNodes = [];
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  static text(content) {
    const node = new FakeDOMNode("", content);
    node._isText = true;
    return node;
  }
}

/**
 * Transform text nodes in a DOM tree using the same logic as applyPandocCitationPreview.
 * This helper avoids needing App/TFile for unit testing.
 */
function transformTextNodesInDOM(
  node,
  transformer
) {
  if (node._isText) {
    // TEXT_NODE
    if (node.parentElement && !["CODE", "PRE", "SCRIPT", "STYLE", "A"].includes(node.parentElement.tagName)) {
      node.textContent = transformer(node.textContent);
    }
  } else if (node.tagName) {
    // ELEMENT_NODE
    if (!["CODE", "PRE", "SCRIPT", "STYLE", "A"].includes(node.tagName)) {
      // Recurse into children
      for (const child of node.childNodes) {
        transformTextNodesInDOM(child, transformer);
      }
    }
  }
}

/**
 * DOM tests for pandoc citation text transformation.
 */
test("DOM: simple text with citation transformed", () => {
  const p = new FakeDOMNode("P");
  p.appendChild(FakeDOMNode.text("Voir "));
  p.appendChild(FakeDOMNode.text("[@smith2024]"));
  p.appendChild(FakeDOMNode.text("."));

  // Simulate transformation
  transformTextNodesInDOM(p, (text) =>
    formatPandocCitationText(text, new Map([
      ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ]))
  );

  assert.equal(p.textContent, "Voir (Smith, 2024).");
});

test("DOM: CODE element text unchanged", () => {
  const code = new FakeDOMNode("CODE");
  code.appendChild(FakeDOMNode.text("[@smith2024]"));

  const original = code.textContent;

  transformTextNodesInDOM(code, (text) =>
    formatPandocCitationText(text, new Map([
      ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ]))
  );

  assert.equal(code.textContent, original);
  assert.equal(code.textContent, "[@smith2024]");
});

test("DOM: PRE element text unchanged", () => {
  const pre = new FakeDOMNode("PRE");
  pre.appendChild(FakeDOMNode.text("[@smith2024]"));

  const original = pre.textContent;

  transformTextNodesInDOM(pre, (text) =>
    formatPandocCitationText(text, new Map([
      ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ]))
  );

  assert.equal(pre.textContent, original);
  assert.equal(pre.textContent, "[@smith2024]");
});

test("DOM: A (link) element text unchanged", () => {
  const a = new FakeDOMNode("A");
  a.href = "#";
  a.appendChild(FakeDOMNode.text("[@smith2024]"));

  const original = a.textContent;

  transformTextNodesInDOM(a, (text) =>
    formatPandocCitationText(text, new Map([
      ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ]))
  );

  assert.equal(a.textContent, original);
  assert.equal(a.textContent, "[@smith2024]");
  assert.equal(a.href, "#");
});

test("DOM: email address unchanged", () => {
  const p = new FakeDOMNode("P");
  p.appendChild(FakeDOMNode.text("john@example.com"));

  transformTextNodesInDOM(p, (text) =>
    formatPandocCitationText(text, new Map())
  );

  assert.equal(p.textContent, "john@example.com");
});

test("DOM: mixed structure with protected elements", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
    ["doe2023", { key: "doe2023", authors: ["Doe", "Brown"], year: "2023" }],
  ]);

  const root = new FakeDOMNode("DIV");
  const p1 = root.appendChild(new FakeDOMNode("P"));
  p1.appendChild(FakeDOMNode.text("Avant "));
  p1.appendChild(FakeDOMNode.text("[@smith2024]"));
  p1.appendChild(FakeDOMNode.text("."));

  const code = root.appendChild(new FakeDOMNode("CODE"));
  code.appendChild(FakeDOMNode.text("[@smith2024]"));

  const pre = root.appendChild(new FakeDOMNode("PRE"));
  pre.appendChild(FakeDOMNode.text("[@smith2024]"));

  const a = root.appendChild(new FakeDOMNode("A"));
  a.href = "#";
  a.appendChild(FakeDOMNode.text("[@smith2024]"));

  const p2 = root.appendChild(new FakeDOMNode("P"));
  p2.appendChild(FakeDOMNode.text("Après "));
  p2.appendChild(FakeDOMNode.text("[@smith2024; @doe2023]"));
  p2.appendChild(FakeDOMNode.text("."));

  transformTextNodesInDOM(root, (text) =>
    formatPandocCitationText(text, entries)
  );

  // Verify each element
  assert.equal(p1.textContent, "Avant (Smith, 2024).");
  assert.equal(code.textContent, "[@smith2024]");
  assert.equal(pre.textContent, "[@smith2024]");
  assert.equal(a.textContent, "[@smith2024]");
  assert.equal(a.href, "#");
  assert.equal(p2.textContent, "Après (Smith, 2024; Doe & Brown, 2023).");

  // Verify structure unchanged
  assert.equal(root.childNodes.length, 5);
});

test("DOM: idempotent transformation", () => {
  const p = new FakeDOMNode("P");
  p.appendChild(FakeDOMNode.text("Voir [@smith2024]."));

  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);

  // First pass
  transformTextNodesInDOM(p, (text) =>
    formatPandocCitationText(text, entries)
  );
  const firstResult = p.textContent;

  // Second pass
  transformTextNodesInDOM(p, (text) =>
    formatPandocCitationText(text, entries)
  );
  const secondResult = p.textContent;

  assert.equal(firstResult, "Voir (Smith, 2024).");
  assert.equal(secondResult, firstResult);
});

test("DOM: citation in footnote-like structure", () => {
  const entries = new Map([
    ["smith2024", { key: "smith2024", authors: ["Smith"], year: "2024" }],
  ]);

  // Simulate: <div class="footnotes"><ol><li><p>Voir [@smith2024, p. 42].</p></li></ol></div>
  const footnotes = new FakeDOMNode("DIV");
  footnotes.className = "footnotes";

  const ol = footnotes.appendChild(new FakeDOMNode("OL"));
  const li = ol.appendChild(new FakeDOMNode("LI"));
  li.setAttribute("id", "fn-1");

  const p = li.appendChild(new FakeDOMNode("P"));
  p.appendChild(FakeDOMNode.text("Voir "));
  p.appendChild(FakeDOMNode.text("[@smith2024, p. 42]"));
  p.appendChild(FakeDOMNode.text("."));

  transformTextNodesInDOM(footnotes, (text) =>
    formatPandocCitationText(text, entries)
  );

  assert.equal(p.textContent, "Voir (Smith, 2024, p. 42).");
  assert.equal(li.getAttribute("id"), "fn-1");
});

/**
 * Preview-view integration guard.
 */
test("preview-view imports applyPandocCitationPreview", async () => {
  const previewViewPath = path.resolve(process.cwd(), "src/views/preview-view.ts");
  const content = fs.readFileSync(previewViewPath, "utf8");

  // Verify import
  assert.match(content, /import.*applyPandocCitationPreview.*from.*pandoc-citation-preview/);

  // Verify usage in both paths
  assert.match(content, /createAfterVariantCallback/);
  assert.match(content, /renderManuscriptHtmlWithFrontPages/);
  assert.match(content, /renderManuscriptHtml/);
});
