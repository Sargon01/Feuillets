/* Citation Render Nodes Tests */

import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const {
  isSafeCitationUrl,
  applyCitationTextStyle,
  renderCitationNode,
  renderCitationNodes,
} = await import(modulePath("src/services/citation-render-nodes.js"));

class FakeTextNode {
  constructor(text, ownerDocument = null) {
    this.nodeType = 3;
    this.textContent = text;
    this.parentElement = null;
    this.ownerDocument = ownerDocument;
  }
}

class FakeClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) {
    for (const n of names) this._classes.add(n);
  }
  remove(...names) {
    for (const n of names) this._classes.delete(n);
  }
  contains(name) {
    return this._classes.has(name);
  }
  get length() {
    return this._classes.size;
  }
  toString() {
    return Array.from(this._classes).join(" ");
  }
}

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.href = "";
    this.ownerDocument = ownerDocument;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}

class FakeDocument {
  constructor(options = {}) {
    if (options.noDefaultView) {
      this.defaultView = null;
    } else if (options.noCreateEl) {
      this.defaultView = {};
    } else {
      this.defaultView = {
        createEl: (tag) => new FakeElement(tag, this),
        createSpan: (opts) => {
          const el = new FakeElement("span", this);
          if (opts && opts.cls) el.setAttribute("class", opts.cls);
          return el;
        },
      };
    }
    this.win = this.defaultView;
  }
  createElement(tag) {
    return new FakeElement(tag, this);
  }
  createTextNode(text) {
    return new FakeTextNode(text, this);
  }
}

/* -------------------- 1. URL Safety Helper Tests -------------------- */

test("isSafeCitationUrl: allows safe https, http, and mailto URLs", () => {
  assert.equal(isSafeCitationUrl("https://doi.org/10.1000/182"), true);
  assert.equal(isSafeCitationUrl("http://example.org/ref/item"), true);
  assert.equal(isSafeCitationUrl("mailto:author@university.edu"), true);
  assert.equal(isSafeCitationUrl("https://scholar.google.com/citations?id=123"), true);
});

test("isSafeCitationUrl: rejects dangerous schemes and executable payloads", () => {
  assert.equal(isSafeCitationUrl("javascript:alert(1)"), false);
  assert.equal(isSafeCitationUrl("JAVASCRIPT:alert(1)"), false);
  assert.equal(isSafeCitationUrl("javascript:void(0)"), false);
  assert.equal(isSafeCitationUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeCitationUrl("file:///etc/passwd"), false);
  assert.equal(isSafeCitationUrl("obsidian://open?vault=test"), false);
  assert.equal(isSafeCitationUrl("vbscript:MsgBox"), false);
});

test("isSafeCitationUrl: rejects whitespace and control character bypass tricks", () => {
  assert.equal(isSafeCitationUrl("   javascript:alert(1)   "), false);
  assert.equal(isSafeCitationUrl("\tjavascript:alert(1)"), false);
  assert.equal(isSafeCitationUrl("\njavascript:alert(1)"), false);
  assert.equal(isSafeCitationUrl("java\0script:alert(1)"), false);
  assert.equal(isSafeCitationUrl(""), false);
  assert.equal(isSafeCitationUrl("   "), false);
  assert.equal(isSafeCitationUrl(null), false);
  assert.equal(isSafeCitationUrl(undefined), false);
});

/* -------------------- 2. AST Typographic Mapping Tests -------------------- */

test("applyCitationTextStyle: maps styles to scoped feuillets-csl classes", () => {
  const el = new FakeElement("span");

  applyCitationTextStyle(el, {
    fontStyle: "italic",
    fontWeight: "bold",
    fontVariant: "small-caps",
    textDecoration: "underline",
    verticalAlign: "superscript",
  });

  assert.ok(el.classList.contains("feuillets-csl-font-italic"));
  assert.ok(el.classList.contains("feuillets-csl-weight-bold"));
  assert.ok(el.classList.contains("feuillets-csl-variant-small-caps"));
  assert.ok(el.classList.contains("feuillets-csl-decoration-underline"));
  assert.ok(el.classList.contains("feuillets-csl-valign-sup"));
});

test("applyCitationTextStyle: supports explicit resets", () => {
  const el = new FakeElement("span");

  applyCitationTextStyle(el, {
    fontStyle: "normal",
    fontWeight: "normal",
    fontVariant: "normal",
    textDecoration: "none",
    verticalAlign: "baseline",
  });

  assert.ok(el.classList.contains("feuillets-csl-font-normal"));
  assert.ok(el.classList.contains("feuillets-csl-weight-normal"));
  assert.ok(el.classList.contains("feuillets-csl-variant-normal"));
  assert.ok(el.classList.contains("feuillets-csl-decoration-none"));
  assert.ok(el.classList.contains("feuillets-csl-valign-baseline"));
});

test("applyCitationTextStyle: handles oblique, light, subscript", () => {
  const el = new FakeElement("span");

  applyCitationTextStyle(el, {
    fontStyle: "oblique",
    fontWeight: "light",
    verticalAlign: "subscript",
  });

  assert.ok(el.classList.contains("feuillets-csl-font-oblique"));
  assert.ok(el.classList.contains("feuillets-csl-weight-light"));
  assert.ok(el.classList.contains("feuillets-csl-valign-sub"));
});

/* -------------------- 3. AST Rendering into DOM Tests -------------------- */

test("renderCitationNodes: renders plain text nodes without interpreting HTML", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    { type: "text", text: "Ordinary text & <script>alert(1)</script>" },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  assert.equal(container.childNodes[0].nodeType, 3);
  assert.equal(
    container.childNodes[0].textContent,
    "Ordinary text & <script>alert(1)</script>"
  );
});

test("renderCitationNode: renders single node directly into parent", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  renderCitationNode({ type: "text", text: "direct node" }, container, doc);
  assert.equal(container.childNodes.length, 1);
  assert.equal(container.textContent, "direct node");
});

test("renderCitationNodes: renders nested spans with typography classes", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "span",
      style: { fontStyle: "italic" },
      children: [
        { type: "text", text: "Italic prefix " },
        {
          type: "span",
          style: { fontStyle: "normal", fontWeight: "bold" },
          children: [{ type: "text", text: "nested bold normal" }],
        },
      ],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  const outerSpan = container.childNodes[0];
  assert.equal(outerSpan.tagName, "SPAN");
  assert.ok(outerSpan.classList.contains("feuillets-csl-font-italic"));
  assert.equal(outerSpan.childNodes.length, 2);

  const innerSpan = outerSpan.childNodes[1];
  assert.equal(innerSpan.tagName, "SPAN");
  assert.ok(innerSpan.classList.contains("feuillets-csl-font-normal"));
  assert.ok(innerSpan.classList.contains("feuillets-csl-weight-bold"));
  assert.equal(innerSpan.textContent, "nested bold normal");
});

test("renderCitationNodes: renders block nodes with bibliography display classes", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "block",
      display: "left-margin",
      children: [{ type: "text", text: "[1]" }],
    },
    {
      type: "block",
      display: "right-inline",
      children: [{ type: "text", text: "Smith (2024). Title." }],
    },
    {
      type: "block",
      display: "indent",
      children: [{ type: "text", text: "Indented annotation." }],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 3);
  assert.ok(container.childNodes[0].classList.contains("feuillets-csl-left-margin"));
  assert.ok(container.childNodes[1].classList.contains("feuillets-csl-right-inline"));
  assert.ok(container.childNodes[2].classList.contains("feuillets-csl-indent"));
});

test("renderCitationNodes: renders safe links with proper attributes", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "link",
      href: "https://doi.org/10.1000/182",
      children: [{ type: "text", text: "10.1000/182" }],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  const link = container.childNodes[0];
  assert.equal(link.tagName, "A");
  assert.equal(link.href, "https://doi.org/10.1000/182");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.ok(link.classList.contains("feuillets-csl-link"));
  assert.equal(link.textContent, "10.1000/182");
});

test("renderCitationNodes: renders unsafe link fallback without clickable anchor", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "link",
      href: "javascript:alert(1)",
      children: [{ type: "text", text: "dangerous payload" }],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  const fallback = container.childNodes[0];
  // Must NOT be an <a> element
  assert.notEqual(fallback.tagName, "A");
  assert.equal(fallback.tagName, "SPAN");
  assert.ok(fallback.classList.contains("feuillets-csl-link-disabled"));
  // Children must still be rendered
  assert.equal(fallback.textContent, "dangerous payload");
});

test("renderCitationNodes: preserves Unicode characters cleanly", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");

  const nodes = [
    { type: "text", text: "Érudition française : œuvre, mémoire & référence." },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(
    container.textContent,
    "Érudition française : œuvre, mémoire & référence."
  );
});

test("renderCitationNodes: functions when defaultView is null and every node belongs to ownerDocument", () => {
  const doc = new FakeDocument({ noDefaultView: true });
  assert.equal(doc.defaultView, null);
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "block",
      display: "block",
      children: [
        {
          type: "span",
          style: { fontStyle: "italic", fontWeight: "bold" },
          children: [
            { type: "text", text: "Formatted citation" },
            {
              type: "link",
              href: "https://example.org/source",
              children: [{ type: "text", text: " (source)" }],
            },
          ],
        },
      ],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  const blockEl = container.childNodes[0];
  assert.equal(blockEl.tagName, "DIV");
  assert.equal(blockEl.ownerDocument, doc);

  const spanEl = blockEl.childNodes[0];
  assert.equal(spanEl.tagName, "SPAN");
  assert.equal(spanEl.ownerDocument, doc);

  const text1 = spanEl.childNodes[0];
  assert.equal(text1.textContent, "Formatted citation");
  assert.equal(text1.ownerDocument, doc);

  const linkEl = spanEl.childNodes[1];
  assert.equal(linkEl.tagName, "A");
  assert.equal(linkEl.ownerDocument, doc);

  const linkText = linkEl.childNodes[0];
  assert.equal(linkText.textContent, " (source)");
  assert.equal(linkText.ownerDocument, doc);
});

test("renderCitationNodes: functions when defaultView does not provide createEl", () => {
  const doc = new FakeDocument({ noCreateEl: true });
  assert.ok(doc.defaultView);
  assert.equal(typeof doc.defaultView.createEl, "undefined");
  const container = doc.createElement("div");

  const nodes = [
    {
      type: "span",
      style: { fontVariant: "small-caps" },
      children: [{ type: "text", text: "Smith" }],
    },
  ];

  renderCitationNodes(nodes, container, doc);

  assert.equal(container.childNodes.length, 1);
  const spanEl = container.childNodes[0];
  assert.equal(spanEl.tagName, "SPAN");
  assert.equal(spanEl.ownerDocument, doc);
  assert.ok(spanEl.classList.contains("feuillets-csl-variant-small-caps"));
  assert.equal(spanEl.textContent, "Smith");
});

