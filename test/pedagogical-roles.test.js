import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PEDAGOGICAL_ROLE_ALIASES,
  PEDAGOGICAL_ROLES,
  PEDAGOGICAL_ROLE_FAMILY,
  PEDAGOGICAL_ROLE_ICON,
  applyPedagogicalSemantics,
  isPedagogicalPageBreak,
  pedagogicalRoleForElement,
} from "../src/utils/pedagogical-roles.js";

class FakeClassList { constructor() { this.values = new Set(); } add(...values) { values.forEach((value) => this.values.add(value)); } contains(value) { return this.values.has(value); } }
class FakeElement {
  constructor(callout, titleText) {
    this.callout = callout;
    this.classList = new FakeClassList();
    this.children = [];
    this._titleText = titleText;
  }
  getAttribute(name) { return name === "data-callout" ? this.callout : null; }
  querySelectorAll(selector) { return selector === "[data-callout]" ? this.children : []; }
  querySelector(selector) {
    if (selector === ".callout-title-inner" && this._titleText !== undefined) {
      return { textContent: this._titleText };
    }
    return null;
  }
}

test("les seize callouts reçoivent leur rôle et leur classe", () => {
  for (const role of PEDAGOGICAL_ROLES) {
    const el = new FakeElement(role); const root = new FakeElement(null); root.children = [el];
    assert.equal(pedagogicalRoleForElement(el), role); assert.deepEqual(applyPedagogicalSemantics(root), { roles: 1, pageBreaks: 0 });
    assert.equal(el.classList.contains("feuillets-pedagogical-role"), true); assert.equal(el.classList.contains(`feuillets-role-${role}`), true);
  }
});

test("les alias anglais normalisent vers les rôles français", () => {
  for (const [alias, role] of Object.entries(PEDAGOGICAL_ROLE_ALIASES)) {
    const el = new FakeElement(alias); const root = new FakeElement(null); root.children = [el];
    assert.equal(pedagogicalRoleForElement(el), role); applyPedagogicalSemantics(root);
    assert.equal(el.classList.contains(`feuillets-role-${role}`), true);
    if (alias !== role) assert.equal(el.classList.contains(`feuillets-role-${alias}`), false);
  }
});

test("saut-page et pagebreak sont structurels et non pédagogiques", () => {
  for (const callout of ["saut-page", "pagebreak"]) {
    const el = new FakeElement(callout); const root = new FakeElement(null); root.children = [el];
    assert.equal(isPedagogicalPageBreak(el), true); assert.deepEqual(applyPedagogicalSemantics(root), { roles: 0, pageBreaks: 1 });
    assert.equal(el.classList.contains("feuillets-pagebreak"), true); assert.equal(el.classList.contains("feuillets-pedagogical-role"), false);
  }
});

test("les callouts ordinaires restent inchangés et l'application est idempotente", () => {
  const role = new FakeElement("questions"); const warning = new FakeElement("warning"); const root = new FakeElement(null); root.children = [role, warning];
  assert.deepEqual(applyPedagogicalSemantics(root), { roles: 1, pageBreaks: 0 }); assert.deepEqual(applyPedagogicalSemantics(root), { roles: 1, pageBreaks: 0 }); assert.equal(warning.classList.values.size, 0);
});

// ---------- Rôle "document" (alias "doc") ----------

test("normalisation : document -> document, doc -> document", () => {
  assert.equal(PEDAGOGICAL_ROLE_ALIASES.document, "document");
  assert.equal(PEDAGOGICAL_ROLE_ALIASES.doc, "document");
});

test("canonicalité : document appartient aux rôles sémantiques, doc n'est qu'un alias", () => {
  assert.equal(PEDAGOGICAL_ROLES.includes("document"), true);
  assert.equal(PEDAGOGICAL_ROLES.includes("doc"), false);
});

test("classe : [!document] et [!doc] produisent tous deux feuillets-role-document", () => {
  for (const callout of ["document", "doc"]) {
    const el = new FakeElement(callout); const root = new FakeElement(null); root.children = [el];
    applyPedagogicalSemantics(root);
    assert.equal(el.classList.contains("feuillets-role-document"), true);
  }
});

test("couleur/icône : document est bleu, icône file-text", () => {
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.document, "blue");
  assert.equal(PEDAGOGICAL_ROLE_ICON.document, "lucide-file-text");
});

test("non-régression : les quinze rôles historiques gardent leur famille/icône", () => {
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.problematique, "green");
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.retenir, "red");
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.definition, "purple");
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.consignes, "orange");
  assert.equal(PEDAGOGICAL_ROLE_FAMILY.trace, "blue");
  assert.equal(PEDAGOGICAL_ROLE_ICON.retenir, "lucide-bookmark");
  assert.equal(PEDAGOGICAL_ROLE_ICON.definition, "lucide-book-open");
});

// ---------- Titre automatique vs titre explicite ----------

test("titre auto : [!document] sans titre est marqué feuillets-role-title-auto", () => {
  const el = new FakeElement("document", "document"); const root = new FakeElement(null); root.children = [el];
  applyPedagogicalSemantics(root);
  assert.equal(el.classList.contains("feuillets-role-title-auto"), true);
  assert.equal(el.classList.contains("feuillets-role-title-explicit"), false);
});

test("titre auto : [!doc] sans titre (alias) est aussi marqué feuillets-role-title-auto", () => {
  const el = new FakeElement("doc", "doc"); const root = new FakeElement(null); root.children = [el];
  applyPedagogicalSemantics(root);
  assert.equal(el.classList.contains("feuillets-role-title-auto"), true);
});

test("titre explicite : [!document] Doc 2 : Carte est marqué feuillets-role-title-explicit, texte conservé", () => {
  const el = new FakeElement("document", "Doc 2 : Carte"); const root = new FakeElement(null); root.children = [el];
  applyPedagogicalSemantics(root);
  assert.equal(el.classList.contains("feuillets-role-title-explicit"), true);
  assert.equal(el.classList.contains("feuillets-role-title-auto"), false);
});

test("titre explicite : [!retenir] Attention au signe garde le titre auteur, jamais réécrit", () => {
  const el = new FakeElement("retenir", "Attention au signe"); const root = new FakeElement(null); root.children = [el];
  applyPedagogicalSemantics(root);
  assert.equal(el.classList.contains("feuillets-role-title-explicit"), true);
  assert.equal(el._titleText, "Attention au signe");
});
