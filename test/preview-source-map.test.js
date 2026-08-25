import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySourceMarkers,
  markManuscript,
  markSegments,
  SOURCE_MARKER_PREFIX,
  SOURCE_PATH_ATTR,
} from "../src/views/preview-source-map.js";

/* Repères de source de l'aperçu (voir preview-source-map.ts). Module PUR :
 * testable sans Obsidian ni navigateur — il ne fait que transformer du
 * texte, puis parcourir un arbre minimal. */

class Node {
  constructor(tag, text = "") {
    this.tagName = tag.toUpperCase();
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  get nextElementSibling() {
    const siblings = this.parentElement ? this.parentElement.children : [];
    const i = siblings.indexOf(this);
    return i >= 0 && i + 1 < siblings.length ? siblings[i + 1] : null;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = (n) => {
      for (const c of n.children) {
        if (c.tagName === selector.toUpperCase()) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
}

function container(...nodes) {
  const root = new Node("div");
  for (const n of nodes) root.appendChild(n);
  return root;
}

test("markSegments : un marqueur par segment ayant un chemin, rien pour les autres", () => {
  const segments = [
    { path: "Roman/Ch1/Scene.md", text: "Texte de la scène.", frontType: null },
    { path: null, text: "# Chapitre 1", frontType: null },
  ];
  const marked = markSegments(segments);

  assert.ok(marked[0].text.startsWith(`${SOURCE_MARKER_PREFIX}Roman/Ch1/Scene.md\n\n`));
  assert.ok(marked[0].text.endsWith("Texte de la scène."));
  // Un titre de chapitre généré n'a pas de fiche propre : pas de repère,
  // il appartient visuellement à la scène qui suit.
  assert.equal(marked[1].text, "# Chapitre 1");
  // Les segments d'origine ne sont jamais modifiés en place.
  assert.equal(segments[0].text, "Texte de la scène.");
});

test("markManuscript : même assemblage que compile(), avec le séparateur fourni", () => {
  const segments = [
    { path: "a.md", text: "Un", frontType: null },
    { path: "b.md", text: "Deux", frontType: null },
  ];
  const out = markManuscript(segments, "\n\n");
  assert.equal(
    out,
    `${SOURCE_MARKER_PREFIX}a.md\n\nUn\n\n${SOURCE_MARKER_PREFIX}b.md\n\nDeux`
  );
});

test("applySourceMarkers : pose l'attribut sur le bloc SUIVANT et retire le marqueur", () => {
  const marker = new Node("p", `${SOURCE_MARKER_PREFIX}Roman/Ch1/Scene.md`);
  const body = new Node("p", "Première phrase de la scène.");
  const root = container(marker, body);

  const found = applySourceMarkers(root);

  assert.deepEqual(found, ["Roman/Ch1/Scene.md"]);
  assert.equal(body.getAttribute(SOURCE_PATH_ATTR), "Roman/Ch1/Scene.md");
  // Le marqueur ne doit jamais rester visible dans l'aperçu.
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], body);
});

test("applySourceMarkers : transfère le repère au premier bloc restant", () => {
  const marker = new Node("p", `${SOURCE_MARKER_PREFIX}Roman/Ch1/Scene.md`);
  const excluded = new Node("div", "Solution exclue.");
  const remaining = new Node("p", "Premier bloc conservé.");
  const root = container(marker, excluded, remaining);
  excluded.remove();

  applySourceMarkers(root);

  assert.equal(remaining.getAttribute(SOURCE_PATH_ATTR), "Roman/Ch1/Scene.md");
  assert.equal(root.children.includes(marker), false);
});

test("applySourceMarkers : plusieurs scènes, chacune repérée dans l'ordre", () => {
  const root = container(
    new Node("p", `${SOURCE_MARKER_PREFIX}a.md`),
    new Node("p", "Scène A."),
    new Node("p", `${SOURCE_MARKER_PREFIX}b.md`),
    new Node("h2", "Chapitre 2"),
    new Node("p", "Scène B.")
  );

  const found = applySourceMarkers(root);

  assert.deepEqual(found, ["a.md", "b.md"]);
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].getAttribute(SOURCE_PATH_ATTR), "a.md");
  // Le repère va sur le bloc suivant réel, fût-ce un titre.
  assert.equal(root.children[1].getAttribute(SOURCE_PATH_ATTR), "b.md");
  assert.equal(root.children[2].getAttribute(SOURCE_PATH_ATTR), null);
});

test("applySourceMarkers : un texte ordinaire n'est jamais pris pour un marqueur", () => {
  const body = new Node("p", "Elle relut FEUILLETS et referma le carnet.");
  const root = container(body);

  assert.deepEqual(applySourceMarkers(root), []);
  assert.equal(body.getAttribute(SOURCE_PATH_ATTR), null);
  assert.equal(root.children.length, 1);
});

test("applySourceMarkers : marqueur en fin de document, sans bloc suivant", () => {
  const body = new Node("p", "Fin.");
  const marker = new Node("p", `${SOURCE_MARKER_PREFIX}z.md`);
  const root = container(body, marker);

  const found = applySourceMarkers(root);

  // Repli sur le parent plutôt que perdre le repère.
  assert.deepEqual(found, ["z.md"]);
  assert.equal(root.getAttribute(SOURCE_PATH_ATTR), "z.md");
});
