import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEMANTIC_ROLE_ALIASES,
  SEMANTIC_ROLES,
  SEMANTIC_ROLE_FAMILY,
  SEMANTIC_ROLE_ICON,
  applySemanticRoles,
  isSemanticPageBreak,
  semanticRoleForElement,
} from "../src/utils/semantic-roles.js";

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

test("exactement 18 rôles sémantiques canoniques", () => {
  assert.equal(SEMANTIC_ROLES.length, 18);
  const expected = [
    "introduction", "question-directrice", "objectifs", "competences", "instructions",
    "questions", "solution", "argument", "hypothese", "preuve",
    "source", "citation", "explication", "definition", "methode",
    "synthese", "point-cle", "recommandation",
  ];
  assert.deepEqual([...SEMANTIC_ROLES], expected);
});

test("tous les 18 rôles reçoivent leur classe feuillets-role-<id>", () => {
  for (const role of SEMANTIC_ROLES) {
    const el = new FakeElement(role); const root = new FakeElement(null); root.children = [el];
    assert.equal(semanticRoleForElement(el), role); assert.deepEqual(applySemanticRoles(root), { roles: 1, pageBreaks: 0 });
    assert.equal(el.classList.contains("feuillets-semantic-role"), true); assert.equal(el.classList.contains(`feuillets-role-${role}`), true);
  }
});

test("chaque rôle a un titre automatique par défaut", () => {
  for (const role of SEMANTIC_ROLES) {
    const el = new FakeElement(role, role); const root = new FakeElement(null); root.children = [el];
    applySemanticRoles(root);
    assert.equal(el.classList.contains("feuillets-role-title-auto"), true, `rôle ${role}`);
  }
});

test("chaque rôle a une famille de couleur", () => {
  for (const role of SEMANTIC_ROLES) {
    assert.ok(SEMANTIC_ROLE_FAMILY[role], `rôle ${role} manque sa famille`);
  }
});

test("chaque rôle a une icône Lucide", () => {
  for (const role of SEMANTIC_ROLES) {
    assert.ok(SEMANTIC_ROLE_ICON[role], `rôle ${role} manque son icône`);
    assert.match(SEMANTIC_ROLE_ICON[role], /^lucide-/, `rôle ${role} : icône ne commence pas par lucide-`);
  }
});

test("saut-page et pagebreak restent strictement structurels", () => {
  for (const callout of ["saut-page", "pagebreak"]) {
    const el = new FakeElement(callout); const root = new FakeElement(null); root.children = [el];
    assert.equal(isSemanticPageBreak(el), true); assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 1 });
    assert.equal(el.classList.contains("feuillets-pagebreak"), true); assert.equal(el.classList.contains("feuillets-semantic-role"), false);
  }
});

test("les callouts ordinaires Obsidian restent inchangés et ne reçoivent pas de classe sémantique", () => {
  const obsidianCallouts = ["note", "abstract", "info", "todo", "tip", "success", "warning", "failure", "danger", "bug", "example", "quote", "cite"];
  for (const callout of obsidianCallouts) {
    const el = new FakeElement(callout); const root = new FakeElement(null); root.children = [el];
    assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 }, `callout natif ${callout}`);
    assert.equal(el.classList.contains("feuillets-semantic-role"), false);
  }
});

test("application idempotente : ré-appliquer ne duplique ni ne change rien", () => {
  const el = new FakeElement("solution", "solution"); const root = new FakeElement(null); root.children = [el];
  const first = applySemanticRoles(root);
  const second = applySemanticRoles(root);
  assert.deepEqual(first, second);
  assert.equal(el.classList.values.size, 3); // feuillets-semantic-role, feuillets-role-solution, feuillets-role-title-auto
});

test("titre explicite conserve le texte auteur, marqué feuillets-role-title-explicit", () => {
  const el = new FakeElement("solution", "Mon titre personnalisé"); const root = new FakeElement(null); root.children = [el];
  applySemanticRoles(root);
  assert.equal(el.classList.contains("feuillets-role-title-explicit"), true);
  assert.equal(el.classList.contains("feuillets-role-title-auto"), false);
  assert.equal(el._titleText, "Mon titre personnalisé");
});

test("[!question] reste natif Obsidian, jamais rôle Feuillets", () => {
  const el = new FakeElement("question"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), false);
});

test("[!questions] est rôle Feuillets (plural), jamais natif", () => {
  const el = new FakeElement("questions"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 1, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), true);
  assert.equal(el.classList.contains("feuillets-role-questions"), true);
});

test("[!example] reste natif Obsidian, jamais rôle Feuillets", () => {
  const el = new FakeElement("example"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), false);
});

test("[!citation] est rôle Feuillets, jamais natif", () => {
  const el = new FakeElement("citation"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 1, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), true);
  assert.equal(el.classList.contains("feuillets-role-citation"), true);
});

test("[!quote] reste natif Obsidian, jamais rôle Feuillets", () => {
  const el = new FakeElement("quote"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), false);
});

test("[!source] est rôle Feuillets, jamais natif", () => {
  const el = new FakeElement("source"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 1, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), true);
  assert.equal(el.classList.contains("feuillets-role-source"), true);
});

test("[!document] n'est plus rôle Feuillets, reste natif", () => {
  const el = new FakeElement("document"); const root = new FakeElement(null); root.children = [el];
  assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  assert.equal(el.classList.contains("feuillets-semantic-role"), false);
});

test("aucun ancien rôle pédagogique n'est reconnu : problematique, consignes, correction, trace, etc.", () => {
  const oldRoles = ["problematique", "consignes", "correction", "trace", "exemple", "retenir", "lexique", "methodologie", "tache", "document"];
  for (const oldRole of oldRoles) {
    const el = new FakeElement(oldRole); const root = new FakeElement(null); root.children = [el];
    // Aucun de ces anciens rôles ne doit être reconnu
    assert.equal(semanticRoleForElement(el), null, `ancien rôle ${oldRole} ne doit pas être reconnu`);
    assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  }
});

test("aucun alias anglais historique n'est reconnu : problematic, lesson, example, keypoint, glossary, doc, etc.", () => {
  const oldAliases = ["problematic", "lesson", "example", "keypoint", "glossary", "doc", "objectives", "competencies"];
  for (const alias of oldAliases) {
    const el = new FakeElement(alias); const root = new FakeElement(null); root.children = [el];
    assert.equal(semanticRoleForElement(el), null, `alias ancien ${alias} ne doit pas être reconnu`);
    assert.deepEqual(applySemanticRoles(root), { roles: 0, pageBreaks: 0 });
  }
});

test("la liste SEMANTIC_ROLE_ALIASES contient exactement 18 entrées (les rôles canoniques uniquement)", () => {
  assert.equal(Object.keys(SEMANTIC_ROLE_ALIASES).length, 18);
  for (const role of SEMANTIC_ROLES) {
    assert.ok(role in SEMANTIC_ROLE_ALIASES, `rôle ${role} doit être dans SEMANTIC_ROLE_ALIASES`);
    assert.equal(SEMANTIC_ROLE_ALIASES[role], role, `alias ${role} doit normaliser vers ${role}`);
  }
});

test("titres automatiques par défaut en FR", () => {
  const frLabels = {
    introduction: "introduction",
    "question-directrice": "question-directrice",
    objectifs: "objectifs",
    competences: "competences",
    instructions: "instructions",
    questions: "questions",
    solution: "solution",
    argument: "argument",
    hypothese: "hypothese",
    preuve: "preuve",
    source: "source",
    citation: "citation",
    explication: "explication",
    definition: "definition",
    methode: "methode",
    synthese: "synthese",
    "point-cle": "point-cle",
    recommandation: "recommandation",
  };
  for (const [role, label] of Object.entries(frLabels)) {
    const el = new FakeElement(role, label); const root = new FakeElement(null); root.children = [el];
    applySemanticRoles(root);
    assert.equal(el.classList.contains("feuillets-role-title-auto"), true, `rôle ${role} avec titre "${label}"`);
  }
});

test("aucune collision : les rôles sémantiques ne chevauchent jamais les callouts Obsidian", () => {
  const semanticIds = new Set(SEMANTIC_ROLES);
  const obsidianCallouts = new Set(["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote", "cite"]);
  for (const role of semanticIds) {
    assert.equal(obsidianCallouts.has(role), false, `rôle sémantique "${role}" chevauche un callout Obsidian natif`);
  }
  for (const callout of obsidianCallouts) {
    assert.equal(semanticIds.has(callout), false, `callout Obsidian "${callout}" chevauche un rôle sémantique`);
  }
});
