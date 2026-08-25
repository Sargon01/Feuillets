import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer } from "obsidian";
import { planPresentationSlides } from "../src/services/presentation-slide-planner.js";
import { splitPresentationMarkdownWithRanges } from "../src/services/presentation.js";

const base = { app: {}, component: {}, sourcePath: "Cours.md" };

class PlannerDomElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set(); this.attrs = new Map();
    this.text = options.text || ""; this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    this.style = { setProperty: () => {} }; this.className = options.cls || "";
    if (options.attr) for (const [key, value] of Object.entries(options.attr)) this.attrs.set(key, String(value));
    this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)), remove: (...names) => names.forEach((name) => this.classes.delete(name)), contains: (name) => this.classes.has(name), toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name) };
    if (options.cls?.includes("feuillets-presentation-render-content")) this.scrollHeight = 1440;
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/u).filter(Boolean)); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
  createEl(tag, options = {}) { return this.appendChild(new PlannerDomElement(tag, options)); }
  createDiv(options = {}) { return this.createEl("div", options); }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]).filter((child) => selector.startsWith(".") ? child.classes.has(selector.slice(1)) : selector === child.tagName.toLowerCase()); }
  cloneNode(deep) { const clone = new PlannerDomElement(this.tagName, { cls: this.className, text: this.text }); if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true))); return clone; }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight }; }
  addEventListener() {}
  removeEventListener() {}
}

test("planner : document court sans séparateur = une slide inchangée", async () => {
  const markdown = "# Titre\n\nTexte court.";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.equal(slides.length, 1);
  assert.equal(slides[0].markdown, markdown);
  assert.deepEqual([slides[0].startLine, slides[0].endLine], [0, 2]);
});

test("planner : document long sans séparateur = subdivision bornée avec ancres", async () => {
  const markdown = "# A\n\nPremier bloc.\n\n## B\n\nDeuxième bloc.\n\n### C\n\nTroisième bloc.";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => value.length > 40 });
  assert.equal(slides.length, 3);
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[0, 3], [4, 7], [8, 10]]);
  for (let index = 1; index < slides.length; index++) assert.equal(slides[index - 1].endLine + 1, slides[index].startLine);
  assert.equal(slides[0].startLine, 0);
  assert.equal(slides.at(-1)?.endLine, 10);
  assert.equal(slides.map((slide) => slide.markdown).join("\n\n"), markdown);
});

test("planner : une plage de deux blocs peut séparer un heading de son contenu", async () => {
  const markdown = "# Titre\n\nTrès gros contenu.";
  const slides = await planPresentationSlides({
    ...base,
    markdown,
    measureOverflow: async (value) => value.includes("# Titre") && value.includes("Très gros contenu."),
  });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].markdown.includes("# Titre"), true);
  assert.equal(slides[1].markdown.includes("Très gros contenu."), true);
  assert.ok(slides.every((slide) => slide.markdown.trim() !== ""));
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[0, 1], [2, 2]]);
  assert.equal(slides[0].startLine, 0);
  assert.equal(slides.at(-1)?.endLine, 2);
});

test("planner : avec trois blocs la protection contre le heading orphelin reste active", async () => {
  const markdown = "# Titre\n\nParagraphe A.\n\nParagraphe B.";
  const slides = await planPresentationSlides({
    ...base,
    markdown,
    measureOverflow: async (value) => value.includes("# Titre") && value.includes("Paragraphe B."),
  });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].markdown.includes("# Titre"), true);
  assert.equal(slides[0].markdown.includes("Paragraphe A."), true);
  assert.equal(slides[1].markdown.includes("Paragraphe B."), true);
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[0, 3], [4, 4]]);
});

test("planner : les subdivisions pavent chaque segment sans franchir un séparateur", async () => {
  const markdown = "# A\n\nBloc A.\n\n## B\n\nBloc B.\n\n---\n\n# C\n\nBloc C.";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => value.includes("# A") && value.includes("## B") });
  assert.equal(slides.length, 3);
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[0, 3], [4, 9], [10, 12]]);
  assert.equal(slides[1].endLine, expected[0].endLine);
  assert.equal(slides[2].startLine, expected[1].startLine);
  assert.equal(slides[0].markdown.includes("---"), false);
  assert.equal(slides[1].markdown.includes("---"), false);
  assert.equal(slides[0].endLine + 1, slides[1].startLine);
});

test("planner : les séparateurs explicites ne sont jamais franchis", async () => {
  const markdown = "# A\n\nCourt.\n---\n# B\n\nCourt.";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.equal(slides.length, 2);
  assert.deepEqual(slides.map((slide) => slide.markdown), ["# A\n\nCourt.", "# B\n\nCourt."]);
});

test("planner : une unité atomique trop grande reste une seule slide", async () => {
  const markdown = "```text\n" + "ligne\n".repeat(200) + "```";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.equal(slides.length, 1);
  assert.equal(slides[0].markdown, markdown.trim());
});

test("planner : les priorités H1/H2/question-directrice/H3 restent déterministes", async () => {
  const markdown = "# A\n\nA\n\n## B\n\nB\n\n> [!question-directrice]\n> Q\n\n### C\n\nC";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.deepEqual(slides.map((slide) => slide.markdown), ["# A", "A", "## B", "B", "> [!question-directrice]\n> Q", "### C", "C"]);
});

test("planner : aucune slide vide et document sans rôle", async () => {
  const markdown = "Premier paragraphe.\n\nDeuxième paragraphe.";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.ok(slides.every((slide) => slide.markdown.trim() !== ""));
  assert.equal(slides.length, 2);
});

test("planner : rôles structurants et affinités", async () => {
  const markdown = "> [!introduction]\n> Intro\n\n> [!argument]\n> Argument\n\n> [!preuve]\n> Preuve\n\n> [!objectifs]\n> Objectifs\n\n> [!competences]\n> Compétences\n\n> [!synthese]\n> Fin";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => value.includes("[!introduction]") && value.includes("[!synthese]") });
  assert.ok(slides.some((slide) => slide.markdown.includes("argument") && slide.markdown.includes("preuve")));
  assert.ok(slides.some((slide) => slide.markdown.includes("objectifs") && slide.markdown.includes("competences")));
});

test("planner : une affinité argument/preuve ne bloque pas une coupure nécessaire", async () => {
  const markdown = "> [!argument]\n> Argument.\n\n> [!preuve]\n> Preuve.";
  const slides = await planPresentationSlides({
    ...base,
    markdown,
    measureOverflow: async (value) => value.includes("[!argument]") && value.includes("[!preuve]"),
  });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].markdown.includes("argument"), true);
  assert.equal(slides[1].markdown.includes("preuve"), true);
});

test("planner : l’affinité reste préférée lorsqu’une autre frontière est équivalente", async () => {
  const markdown = "Bloc ordinaire.\n\n> [!argument]\n> Argument.\n\n> [!preuve]\n> Preuve.";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => value.includes("Bloc ordinaire") && value.includes("[!preuve]") });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].markdown.includes("argument"), false);
  assert.equal(slides[1].markdown.includes("argument") && slides[1].markdown.includes("preuve"), true);
});

test("planner : callout, blockquote, code, liste et tableau restent atomiques", async () => {
  const markdown = "> [!note]\n> ligne 1\n>\n> ligne 2\n\n> citation\n> ligne 2\n\n```text\ncode\n\nfin\n```\n\n- un\n- deux\n\n| A | B |\n|---|---|\n| 1 | 2 |";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.equal(slides.length, 5);
  assert.ok(slides[0].markdown.includes("ligne 2"));
  assert.ok(slides[1].markdown.includes("citation"));
  assert.ok(slides[2].markdown.includes("code\n\nfin"));
  assert.ok(slides[3].markdown.includes("- deux"));
});

test("planner : la syntaxe Markdown et les coordonnées ne dérivent pas", async () => {
  const markdown = "  **même** [lien](https://example.test) [[wikilink]]\n\nMême texte\n\n![image](image.png)\n\nDernier";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.deepEqual(slides.map((slide) => slide.markdown), ["**même** [lien](https://example.test) [[wikilink]]", "Même texte", "![image](image.png)", "Dernier"]);
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[0, 1], [2, 3], [4, 5], [6, 6]]);
});

test("planner : speaker-notes suivent le bloc visible et ne sont pas une slide seule", async () => {
  const markdown = "# Titre\n\nVisible\n\n> [!speaker-notes]\n> À dire\n\n> [!synthese]\n> Fin";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => true });
  assert.equal(slides.some((slide) => /^> \[!speaker-notes\]/u.test(slide.markdown)), false);
  assert.ok(slides.some((slide) => slide.markdown.includes("Visible") && slide.markdown.includes("À dire")));
});

test("planner : frontmatter et séparateurs explicites conservent les plages", async () => {
  const markdown = "---\ntitle: Cours\n---\n# A\n\nA\n---\n# B\n\nB";
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(slides.map((slide) => slide.markdown), ["# A\n\nA", "# B\n\nB"]);
  assert.deepEqual(slides.map((slide) => [slide.startLine, slide.endLine]), [[3, 6], [7, 9]]);
});

test("planner : plusieurs niveaux de subdivision restent croissants et sans chevauchement", async () => {
  const markdown = Array.from({ length: 8 }, (_, index) => `## ${index + 1}\n\nBloc ${index + 1}`).join("\n\n");
  const slides = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => (value.match(/^## /gmu) ?? []).length > 1 });
  assert.equal(slides.length, 8);
  for (let index = 1; index < slides.length; index++) assert.ok(slides[index - 1].endLine < slides[index].startLine);
  assert.ok(slides.every((slide) => slide.markdown.trim() !== ""));
});

test("planner : le chemin réel sans sonde injectée subdivise sans slide vide", async () => {
  const markdown = Array.from({ length: 4 }, (_, index) => `## Réel ${index + 1}\n\n${"Texte déterministe très long. ".repeat(40)}`).join("\n\n");
  const previousDocument = globalThis.document;
  const previousRender = MarkdownRenderer.render;
  const body = new PlannerDomElement("body");
  globalThis.document = { body, createElement: (tag) => new PlannerDomElement(tag) };
  MarkdownRenderer.render = async (_app, source, container) => {
    for (const block of source.split(/\n\n/u).filter((value) => value.trim() !== "")) container.createEl(block.startsWith("#") ? "h2" : "p", { text: block });
  };
  try {
    const slides = await planPresentationSlides({ ...base, markdown });
    assert.ok(slides.length > 1);
    assert.ok(slides.every((slide) => slide.markdown.trim() !== ""));
    for (let index = 1; index < slides.length; index++) assert.ok(slides[index - 1].endLine < slides[index].startLine);
    assert.ok(slides.every((slide) => markdown.includes(slide.markdown)));
  } finally {
    MarkdownRenderer.render = previousRender;
    globalThis.document = previousDocument;
  }
});

test("planner : plusieurs séparateurs courts gardent exactement le découpage historique", async () => {
  const markdown = "# Un\n\nA\n---\n# Deux\n\nB\n---\n# Trois\n\nC";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(actual, expected);
});

test("planner : un séparateur dans une fence backticks reste du contenu", async () => {
  const markdown = "# Exemple\n\n```text\n---\nceci appartient au code\n```\n\nTexte après le code.";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 1);
  assert.match(actual[0].markdown, /---/u);
  assert.match(actual[0].markdown, /ceci appartient au code/u);
  assert.match(actual[0].markdown, /Texte après le code\./u);
});

test("planner : une fence contenant --- reste atomique pendant une subdivision", async () => {
  const markdown = "# Exemple\n\n```text\n---\ncontenu du code\n```\n\n## Suite\n\nDeuxième bloc.";
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async (value) => value.includes("# Exemple") && value.includes("## Suite") });
  assert.equal(actual.length, 2);
  assert.deepEqual(actual.map((slide) => slide.markdown), ["# Exemple\n\n```text\n---\ncontenu du code\n```", "## Suite\n\nDeuxième bloc."]);
  assert.ok(actual[0].markdown.includes("---"));
  assert.ok(actual[0].markdown.includes("contenu du code"));
  assert.deepEqual(actual.map((slide) => [slide.startLine, slide.endLine]), [[0, 6], [7, 9]]);
});

test("planner : un --- indenté n'est pas une frontière", async () => {
  const markdown = "# Exemple\n\n    ---\n    ceci est du code\n\nTexte suivant.";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 1);
  assert.match(actual[0].markdown, /    ---/u);
  assert.match(actual[0].markdown, /Texte suivant\./u);
});

test("planner : un séparateur dans une fence tildes reste du contenu", async () => {
  const markdown = "# Exemple\n\n~~~text\n---\ncontenu\n~~~\n\nTexte suivant.";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 1);
  assert.match(actual[0].markdown, /---/u);
  assert.match(actual[0].markdown, /Texte suivant\./u);
});

test("planner : un vrai séparateur conserve exactement le découpage partagé", async () => {
  const markdown = "# A\n\nA\n\n---\n\n# B\n\nB";
  const expected = splitPresentationMarkdownWithRanges(markdown);
  const actual = await planPresentationSlides({ ...base, markdown, measureOverflow: async () => false });
  assert.deepEqual(actual, expected);
});
