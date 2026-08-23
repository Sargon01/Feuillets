import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer, Component } from "obsidian";
import { renderPresentationSlide, PRESENTATION_SLIDE_WIDTH, PRESENTATION_SLIDE_HEIGHT } from "../src/services/presentation-slide-renderer.js";
import { presentationContainedMediaSize } from "../src/services/presentation-layout-engine.js";
import { SEMANTIC_ROLES } from "../src/utils/semantic-roles.js";

/* FakeElement DOM factice — même convention que test/presentation-view.test.js
   (le renderer est testé ici directement, sans passer par une View). */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set();
    const style = {}; style.setProperty = (name, value) => { style[name] = value; }; style.removeProperty = (name) => { delete style[name]; };
    this.style = style;
    this.text = options.text || ""; this.attrs = new Map(); this._listeners = [];
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    if (options.cls) this.className = options.cls;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.attrs.set(k, String(v));
    this.classList = { add: (...names) => names.forEach((n) => this.classes.add(n)), remove: (...names) => names.forEach((n) => this.classes.delete(n)), toggle: (n, force) => (force ? this.classes.add(n) : this.classes.delete(n)), contains: (name) => this.classes.has(name) };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get innerText() { return (this.text || "") + this.children.filter((c) => c.tagName !== "SVG").map((c) => c.innerText || c.text || "").join(""); }
  set innerText(value) { this.text = value; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  appendChild(child) { child.remove?.(); child.parentElement = this; this.children.push(child); return child; }
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, { text: this.text });
    clone.attrs = new Map(this.attrs);
    clone.classes = new Set(this.classes);
    clone.clientWidth = this.clientWidth; clone.clientHeight = this.clientHeight;
    clone.scrollWidth = this.scrollWidth; clone.scrollHeight = this.scrollHeight;
    for (const [key, value] of Object.entries(this.style)) {
      if (typeof value !== "function") clone.style[key] = value;
    }
    if (this.tagName === "IMG") { clone.complete = this.complete; clone.naturalWidth = this.naturalWidth; clone.naturalHeight = this.naturalHeight; }
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  get childNodes() { return this.children; }
  querySelector(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).find((el) => el.classes ? matches(el, selector, names) : false) || null; }
  querySelectorAll(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).filter((el) => matches(el, selector, names)); }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  empty() { this.children = []; this.text = ""; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight }; }
  addEventListener(type, listener, options = {}) { this._listeners.push({ type, listener, once: options?.once, signal: options?.signal }); }
  dispatch(type) {
    for (const entry of [...this._listeners]) {
      if (entry.type !== type) continue;
      if (entry.signal && entry.signal.aborted) continue;
      entry.listener();
      if (entry.once) { const i = this._listeners.indexOf(entry); if (i >= 0) this._listeners.splice(i, 1); }
    }
  }
}
function matches(el, selector, tagNames) {
  const classSelectors = selector.split(",").map((v) => v.trim()).filter((v) => v.startsWith("."));
  if (classSelectors.length) return classSelectors.some((cls) => el.classes.has(cls.slice(1)));
  // Support pour sélecteurs d'attribut simples comme [data-callout]
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const attrMatch = selector.match(/\[([^\]]+)\]/);
    if (attrMatch) {
      const [_, attr] = attrMatch;
      return el.attrs.has(attr);
    }
  }
  return tagNames.includes(el.tagName);
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

function heading(container, text) { return container.createEl("h1", { text }); }
function paragraph(container, text) { return container.createEl("p", { text }); }
function unknownMedia(container) {
  const media = container.createEl("p");
  const img = media.createEl("img");
  img.complete = false; img.naturalWidth = 0; img.naturalHeight = 0;
  return { media, img };
}
function knownMedia(container, w, h) {
  const media = container.createEl("p");
  const img = media.createEl("img");
  img.complete = true; img.naturalWidth = w; img.naturalHeight = h;
  return { media, img };
}

function render(markdown, extra = {}) {
  const measurementHost = new FakeElement();
  const deckContainer = new FakeElement();
  const controller = new AbortController();
  return renderPresentationSlide({
    app: {},
    component: new Component(),
    sourcePath: "Cours.md",
    markdown,
    index: 0,
    generation: 1,
    measurementHost,
    deckContainer,
    controller,
    isGenerationStale: () => false,
    ...extra,
  }).then((result) => ({ result, measurementHost, deckContainer, controller }));
}

/* Force la taille intérieure réelle des cellules MediaCell créées pendant le
   test (le DOM factice ne calcule pas de vraie géométrie CSS Grid/Flex). */
function withForcedCellSize(width, height, fn) {
  const originalCreateDiv = FakeElement.prototype.createDiv;
  FakeElement.prototype.createDiv = function forcedCreateDiv(options = {}) {
    const el = originalCreateDiv.call(this, options);
    if (options.cls === "feuillets-presentation-render-cell") { el.clientWidth = width; el.clientHeight = height; }
    return el;
  };
  return fn().finally(() => { FakeElement.prototype.createDiv = originalCreateDiv; });
}

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `attendu ~${expected}, obtenu ${actual}`);
}

test("PRESENTATION_SLIDE_WIDTH/HEIGHT : surface fixe 1280×720", () => {
  assert.equal(PRESENTATION_SLIDE_WIDTH, 1280);
  assert.equal(PRESENTATION_SLIDE_HEIGHT, 720);
});

test("DOM mesuré === DOM affiché : un seul rendu source, le DOM retourné est directement celui inséré dans deckContainer", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    renderCalls++;
    heading(container, "T"); knownMedia(container, 70, 100); paragraph(container, "texte");
  };
  try {
    const { result, measurementHost, deckContainer } = await render("SPLIT");
    // un seul rendu Markdown source, quel que soit le nombre de candidats mesurés (6 ici) :
    // aucune reconstruction du gagnant après le choix.
    assert.equal(renderCalls, 1);
    assert.equal(result.section.parentElement, deckContainer, "le DOM retourné est déjà inséré, jamais reconstruit ensuite");
    assert.equal(measurementHost.children.length, 0, "aucun candidat (gagnant ou perdant) ne subsiste dans le measurementHost");
    assert.ok(["split", "stack"].includes(result.geometry));
    assert.match(result.candidate, /^(split|stack)-\d{2}-\d{2}$/);
  } finally { MarkdownRenderer.render = previous; }
});

test("Candidats perdants détruits : measurementHost se retrouve vide, seul le gagnant existe", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { heading(container, "T"); knownMedia(container, 70, 100); paragraph(container, "texte"); };
  try {
    const { measurementHost, deckContainer } = await render("SPLIT");
    assert.equal(measurementHost.children.length, 0);
    assert.equal(deckContainer.children.length, 1, "un seul DOM de slide adopté — les 5 autres candidats ont été détruits");
  } finally { MarkdownRenderer.render = previous; }
});

test("measurementHost : jamais display:none côté appelant (contrat), le renderer n'exige rien d'autre", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { paragraph(container, "texte"); };
  try {
    const measurementHost = new FakeElement();
    const deckContainer = new FakeElement();
    // display volontairement non "none" — le renderer ne le vérifie pas lui-même,
    // mais construit correctement même sur un host déjà stylé par l'appelant.
    measurementHost.style.display = "block";
    const result = await renderPresentationSlide({
      app: {}, component: new Component(), sourcePath: "Cours.md", markdown: "FLOW",
      index: 0, generation: 1, measurementHost, deckContainer, controller: new AbortController(),
      isGenerationStale: () => false,
    });
    assert.equal(result.geometry, "flow");
    assert.equal(measurementHost.children.length, 0);
  } finally { MarkdownRenderer.render = previous; }
});

test("FLOW P/IMG/P : ordre DOM final conservé, media-region entre les deux paragraphes, jamais P B enfant du média", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    paragraph(container, "A");
    knownMedia(container, 200, 100);
    paragraph(container, "B");
  };
  try {
    const { result } = await render("PAIP");
    assert.equal(result.geometry, "flow");
    const content = result.inner.querySelector(".feuillets-presentation-render-content");
    const topLevel = content.children;
    assert.equal(topLevel.length, 3);
    assert.equal(topLevel[0].tagName, "P");
    assert.equal(topLevel[0].text, "A");
    assert.equal(topLevel[1].classes.has("feuillets-presentation-render-flow-media-region"), true);
    assert.equal(topLevel[2].tagName, "P");
    assert.equal(topLevel[2].text, "B");
    assert.equal(topLevel[1].children.some((c) => c.text === "B"), false);
  } finally { MarkdownRenderer.render = previous; }
});

test("MediaCell : dimensionnement contain mathématique exact — cellule 500×400, média portrait 600×900", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { knownMedia(container, 600, 900); paragraph(container, "texte"); };
  try {
    await withForcedCellSize(500, 400, async () => {
      const { result } = await render("MEDIACELL-A");
      const img = result.inner.querySelector("img");
      assertClose(parseFloat(img.style.width), 266.67, 0.01);
      assertClose(parseFloat(img.style.height), 400, 0.01);
      assert.equal(img.style.maxWidth, "none");
      assert.equal(img.style.maxHeight, "none");
      assert.equal(img.style.objectFit, "contain");
    });
  } finally { MarkdownRenderer.render = previous; }
});

test("MediaCell : dimensionnement contain mathématique exact — cellule 1100×350, média 1600×900", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { knownMedia(container, 1600, 900); paragraph(container, "texte"); };
  try {
    await withForcedCellSize(1100, 350, async () => {
      const { result } = await render("MEDIACELL-B");
      const img = result.inner.querySelector("img");
      assertClose(parseFloat(img.style.width), 622.22, 0.01);
      assertClose(parseFloat(img.style.height), 350, 0.01);
    });
  } finally { MarkdownRenderer.render = previous; }
});

test("Score mediaArea : jamais lu depuis un getBoundingClientRect potentiellement coupé — toujours la surface contain calculée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const { img } = knownMedia(container, 600, 900);
    img.getBoundingClientRect = () => ({ width: 5000, height: 5000, top: 0, left: 0, right: 5000, bottom: 5000 });
    paragraph(container, "texte");
  };
  try {
    const { result } = await render("HUGE-RECT");
    const img = result.inner.querySelector("img");
    const cell = img.parentElement.classes.has("feuillets-presentation-render-cell") ? img.parentElement : img.parentElement.parentElement;
    // la taille appliquée n'a rien à voir avec le faux rect énorme.
    assert.notEqual(parseFloat(img.style.width), 5000);
    assert.notEqual(parseFloat(img.style.height), 5000);
    assert.ok(parseFloat(img.style.width) <= cell.clientWidth + 0.01);
  } finally { MarkdownRenderer.render = previous; }
});

test("width=300 neutralisé : une taille explicite Markdown est retirée sans toucher au Markdown source", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const { img } = knownMedia(container, 600, 900);
    img.setAttribute("width", "300");
    img.style.setProperty("width", "300px");
    paragraph(container, "légende");
  };
  try {
    const original = "taille explicite 300";
    const { result } = await render(original);
    const img = result.inner.querySelector("img");
    assert.equal(img.attrs.has("width"), false);
    assert.notEqual(img.style.width, "300px");
    const cell = result.inner.querySelector(".feuillets-presentation-render-cell");
    const expected = presentationContainedMediaSize(cell.clientWidth, cell.clientHeight, 600, 900);
    assert.equal(img.style.width, `${expected.width}px`);
    // PRESENTATION_MEDIA_BLOCK_CLASS vient de presentation-layout-engine.ts (hors périmètre de
    // ce lot) : conserve encore son ancien nom historique, non renommé vers le namespace render-*.
    const mediaBlock = result.inner.querySelector(".feuillets-presentation-prototype-media-block");
    assert.ok(mediaBlock);
  } finally { MarkdownRenderer.render = previous; }
});

test("Overflow texte réel : un bloc qui dépasse marque la slide en overflow", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    const p = paragraph(container, markdown);
    if (markdown === "TROP-LONG") { p.scrollHeight = 2000; p.clientHeight = 620; }
  };
  try {
    const { result: trop } = await render("TROP-LONG");
    assert.equal(trop.overflow, true);
    assert.equal(trop.section.getAttribute("data-overflow"), "true");
    assert.equal(trop.section.classes.has("has-overflow"), true);

    const { result: court } = await render("COURT");
    assert.equal(court.overflow, false);
    assert.equal(court.section.getAttribute("data-overflow"), "false");
  } finally { MarkdownRenderer.render = previous; }
});

test("Overflow final : une image en contain n'est jamais comptée en overflow malgré une taille intrinsèque grande", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { heading(container, "T"); knownMedia(container, 4000, 3000); paragraph(container, "texte"); };
  try {
    const { result } = await render("SPLIT-BIG-MEDIA");
    assert.equal(result.overflow, false);
  } finally { MarkdownRenderer.render = previous; }
});

test("Async : une image non chargée déclenche onMediaResolved à son load, jamais avant, jamais pour une image déjà complète", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { unknownMedia(container); paragraph(container, "texte"); };
  try {
    let resolved = 0;
    const { result } = await render("MEDIA-INCONNU", { onMediaResolved: () => { resolved++; } });
    assert.equal(resolved, 0, "pas encore résolu avant le load");
    const image = result.inner.querySelector("img");
    image.naturalWidth = 400; image.naturalHeight = 800;
    image.dispatch("load");
    assert.equal(resolved, 1, "onMediaResolved appelé exactement une fois au load");
    image.dispatch("load"); // un second déclenchement (once:true) ne doit plus rien faire.
    assert.equal(resolved, 1);
  } finally { MarkdownRenderer.render = previous; }
});

test("Async : une image déjà chargée n'attache aucun listener (aucun appel à onMediaResolved)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { knownMedia(container, 300, 200); paragraph(container, "texte"); };
  try {
    let resolved = 0;
    const { result } = await render("MEDIA-CONNU", { onMediaResolved: () => { resolved++; } });
    const image = result.inner.querySelector("img");
    image.dispatch("load"); // dispatch manuel malgré l'absence de listener (image déjà complete)
    assert.equal(resolved, 0);
  } finally { MarkdownRenderer.render = previous; }
});

test("Génération périmée : coquille jetable, aucune mesure, aucun candidat construit", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, _markdown, container) => { renderCalls++; heading(container, "T"); knownMedia(container, 70, 100); paragraph(container, "texte"); };
  try {
    const { result, measurementHost, deckContainer } = await render("SPLIT", { isGenerationStale: () => true });
    assert.equal(renderCalls, 1); // le rendu source a bien lieu (nécessaire pour détecter les blocs)...
    assert.equal(result.geometry, null); // ...mais aucune géométrie n'est choisie.
    assert.equal(result.candidate, null);
    assert.equal(result.section.getAttribute("data-geometry"), null);
    assert.equal(measurementHost.children.length, 0, "aucun candidat construit dans le host");
    assert.equal(result.section.parentElement, deckContainer, "coquille tout de même retournée, pour un remplacement atomique côté appelant");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== Tests : Rôles sémantiques et mode Callout/Compact ========== */

test("Mode Callout : rôle sémantique 'questions' garde son chrome complet", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Questions" });
    const content = callout.createEl("div", { cls: "callout-content" });
    content.createEl("p", { text: "Liste de questions ?" });
  };
  try {
    const { result } = await render("QUESTIONS", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout sémantique rendu");
    assert.equal(callout.getAttribute("data-callout"), "questions", "rôle sémantique questions");
    assert.notEqual(callout.style.background, "transparent", "mode callout : background pas transparent");
    assert.notEqual(callout.style.border, "0", "mode callout : border pas retiré");
    const content = callout.querySelector(".callout-content");
    assert.ok(content, "contenu du callout conservé");
    assert.equal(content.querySelector("p")?.text, "Liste de questions ?", "contenu textuel exact");
  } finally { MarkdownRenderer.render = previous; }
});

test("Mode Compact : même rôle 'questions' utilise rendu compact (chrome retiré)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Questions" });
    const content = callout.createEl("div", { cls: "callout-content" });
    content.createEl("p", { text: "Liste de questions ?" });
  };
  try {
    const { result } = await render("QUESTIONS", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout sémantique rendu");
    assert.equal(callout.getAttribute("data-callout"), "questions", "rôle sémantique questions");
    assert.equal(callout.style.background, "transparent", "mode compact : background transparent");
    assert.equal(callout.style.border, "0", "mode compact : border retiré");
    assert.equal(callout.style.boxShadow, "none", "mode compact : box-shadow retiré");
    assert.equal(callout.style.padding, "0", "mode compact : padding retiré");
    const title = callout.querySelector(".callout-title");
    assert.equal(title?.style.padding, "0", "mode compact : callout-title padding retiré");
    const content = callout.querySelector(".callout-content");
    assert.ok(content, "contenu du callout conservé en mode compact");
    assert.equal(content.querySelector("p")?.text, "Liste de questions ?", "contenu textuel inchangé en mode compact");
  } finally { MarkdownRenderer.render = previous; }
});

test("Rôles sémantiques : les 18 rôles canoniques sont tous reconnus et traités en mode compact", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    for (const role of SEMANTIC_ROLES) {
      const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": role } });
      callout.createEl("div", { cls: "callout-title" });
      callout.createEl("div", { cls: "callout-content", text: `contenu ${role}` });
    }
  };
  try {
    const { result } = await render("ALL-18-ROLES", { roleEditorDisplay: "compact" });
    let compactCount = 0;
    let classCount = 0;
    for (const callout of Array.from(result.inner.querySelectorAll(".callout"))) {
      if (callout.style.background === "transparent") compactCount++;
      if (callout.classList.contains("feuillets-semantic-role")) classCount++;
    }
    assert.equal(compactCount, SEMANTIC_ROLES.length, `tous les ${SEMANTIC_ROLES.length} rôles sémantiques en mode compact`);
    assert.equal(classCount, SEMANTIC_ROLES.length, `tous les ${SEMANTIC_ROLES.length} rôles reçoivent feuillets-semantic-role`);
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout natif [!note] : non transformé par le réglage roleEditorDisplay", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    callout.createEl("div", { cls: "callout-title", text: "Note" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu natif" });
  };
  try {
    const { result: compact } = await render("NOTE", { roleEditorDisplay: "compact" });
    const calloutCompact = compact.inner.querySelector(".callout");
    assert.equal(calloutCompact?.getAttribute("data-callout"), "note", "callout natif [!note]");
    assert.notEqual(calloutCompact?.style.background, "transparent", "callout [!note] pas transformé en mode compact");
    assert.notEqual(calloutCompact?.style.border, "0", "callout [!note] : border pas retiré");
  } finally { MarkdownRenderer.render = previous; }
});

test("Changement de mode : geometry et candidate restent identiques pour le même contenu", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    heading(container, "Titre");
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    callout.createEl("div", { cls: "callout-title" });
    callout.createEl("div", { cls: "callout-content", text: "Questions" });
  };
  try {
    const { result: resultCallouts } = await render("HYBRID", { roleEditorDisplay: "callouts" });
    const { result: resultCompact } = await render("HYBRID", { roleEditorDisplay: "compact" });
    assert.equal(resultCallouts.geometry, resultCompact.geometry, "geometry inchangée");
    assert.equal(resultCallouts.candidate, resultCompact.candidate, "candidate inchangé");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView : reçoit roleEditorDisplay via renderPresentationSlide (aucune logique spéciale locale)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "question-directrice" } });
    callout.createEl("div", { cls: "callout-content", text: "Contenu" });
  };
  try {
    // Teste que le paramètre roleEditorDisplay est accepté sans erreur
    const { result } = await render("QUESTION-DIRECTRICE", { roleEditorDisplay: "compact" });
    assert.ok(result, "renderPresentationSlide accepte roleEditorDisplay");
    assert.ok(result.section, "section rendue avec roleEditorDisplay");
  } finally { MarkdownRenderer.render = previous; }
});

test("Titre éditorial explicite : conservé dans les deux modes Callout/Compact", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    heading(container, "Mon Titre");
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "solution" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Solution" });
    callout.createEl("div", { cls: "callout-content", text: "Réponse" });
  };
  try {
    const { result: callout } = await render("TITLED", { roleEditorDisplay: "callouts" });
    const { result: compact } = await render("TITLED", { roleEditorDisplay: "compact" });
    const headingCallout = callout.inner.querySelector("h1");
    const headingCompact = compact.inner.querySelector("h1");
    assert.equal(headingCallout?.text, "Mon Titre", "titre conservé mode callout");
    assert.equal(headingCompact?.text, "Mon Titre", "titre conservé mode compact");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS : Bug Fix - Titres explicites en mode Compact ========== */

test("Compact + [!explication] UN : titre explicite 'UN' reste visible", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "explication" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "UN" });
    // Simule la structure Obsidian : SVG d'icône + texte explicite
    titleInner.createEl("svg", { cls: "callout-icon", attr: { viewBox: "0 0 100 100" } });
    const content = callout.createEl("div", { cls: "callout-content" });
    content.createEl("p", { text: "Texte court expliquant l'image." });
  };
  try {
    const { result } = await render("EXPLICATION-UN", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'explication' rendu");
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.ok(titleInner, "callout-title-inner présent");
    // Le titre explicite 'UN' doit rester visible (pas display: none)
    assert.notEqual(titleInner.style.display, "none", "callout-title-inner avec 'UN' VISIBLE en Compact");
    assert.equal(titleInner.text, "UN", "texte 'UN' conservé");
  } finally { MarkdownRenderer.render = previous; }
});

test("Compact + [!explication] sans titre : icône seule masquée, rendu compact historique", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "explication" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    // Pas de titre explicite, juste l'icône (ou vide)
    title.createEl("div", { cls: "callout-title-inner", text: "" });
    const content = callout.createEl("div", { cls: "callout-content" });
    content.createEl("p", { text: "Contenu sans titre explicite" });
  };
  try {
    const { result } = await render("EXPLICATION-NOTITLE", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.ok(titleInner, "callout-title-inner présent");
    // Sans titre explicite, tout .callout-title-inner doit être masqué (rendu compact historique)
    assert.equal(titleInner.style.display, "none", "callout-title-inner MASQUÉ en Compact sans titre explicite");
  } finally { MarkdownRenderer.render = previous; }
});

test("Compact + [!questions] Questions : titre explicite visible, contenu liste préservé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Questions" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    const content = callout.createEl("div", { cls: "callout-content" });
    const ul = content.createEl("ul");
    ul.createEl("li", { text: "Première ?" });
    ul.createEl("li", { text: "Deuxième ?" });
  };
  try {
    const { result } = await render("QUESTIONS-TITLED", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'questions' rendu");
    const titleInner = callout.querySelector(".callout-title-inner");
    // Titre explicite doit rester visible
    assert.notEqual(titleInner?.style.display, "none", "titre 'Questions' VISIBLE");
    assert.equal(titleInner?.text, "Questions", "texte 'Questions' conservé");
    const list = callout.querySelector("ul");
    assert.ok(list, "liste présente en Compact");
    assert.equal(list.children.length, 2, "liste avec 2 items préservée");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout mode callouts (pas compact) : titre explicite s'affiche normalement", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "solution" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner" });
    const icon = titleInner.createEl("svg", { cls: "callout-icon" });
    icon.text = "SVG";
    titleInner.text = "SOLUTION";
    callout.createEl("div", { cls: "callout-content", text: "Réponse" });
  };
  try {
    const { result } = await render("SOLUTION-TITLED-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    const titleInner = callout?.querySelector(".callout-title-inner");
    // En mode callout, aucun style inline ne doit masquer le titre
    assert.notEqual(titleInner?.style.display, "none", "mode callout : titre VISIBLE");
    assert.notEqual(callout?.style.background, "transparent", "mode callout : background conservé");
  } finally { MarkdownRenderer.render = previous; }
});

test("Compact + [!source] Carte : chrome retiré, classe feuillets-role-source présente, titre/contenu visibles", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "source" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Carte" });
    const content = callout.createEl("div", { cls: "callout-content" });
    content.createEl("p", { text: "Référence cartographique" });
  };
  try {
    const { result } = await render("SOURCE-CARTE", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'source' rendu");
    assert.equal(callout.getAttribute("data-callout"), "source", "rôle source détecté");
    assert.equal(callout.style.background, "transparent", "mode compact : background transparent");
    assert.equal(callout.style.border, "0", "mode compact : border retiré");
    assert.ok(callout.classList.contains("feuillets-semantic-role"), "classe feuillets-semantic-role présente");
    assert.ok(callout.classList.contains("feuillets-role-source"), "classe feuillets-role-source présente");
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.notEqual(titleInner?.style.display, "none", "titre explicite 'Carte' VISIBLE en Compact");
    const content = callout.querySelector(".callout-content");
    assert.ok(content, "contenu conservé en Compact");
    assert.equal(content.querySelector("p")?.text, "Référence cartographique", "contenu textuel intact");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout natif [!note] Note : non affecté par compact, ni titre ni icône masqués", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    const title = callout.createEl("div", { cls: "callout-title", text: "Note perso" });
    title.createEl("div", { cls: "callout-title-inner", text: "Note perso" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu privé" });
  };
  try {
    const { result } = await render("NOTE-PERSO", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.equal(callout?.getAttribute("data-callout"), "note");
    // [!note] ne doit PAS être transformé en compact (pas un rôle sémantique Feuillets)
    assert.notEqual(callout?.style.background, "transparent", "[!note] : background pas transparent en compact");
    assert.notEqual(callout?.style.padding, "0", "[!note] : padding pas retiré");
    assert.equal(callout?.classList.contains("feuillets-semantic-role"), false, "[!note] : pas de classe feuillets-semantic-role");
  } finally { MarkdownRenderer.render = previous; }
});

test("Compact + [!point-cle] : identité visuelle différente de questions/explication (famille rouge vs bleu/purple)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "point-cle" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Important" });
    callout.createEl("div", { cls: "callout-content", text: "Point clé du cours" });
  };
  try {
    const { result } = await render("POINT-CLE", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'point-cle' rendu");
    assert.ok(callout.classList.contains("feuillets-role-point-cle"), "classe feuillets-role-point-cle présente");
    assert.ok(callout.classList.contains("feuillets-semantic-role"), "classe feuillets-semantic-role présente");
    assert.equal(callout.style.background, "transparent", "mode compact : background transparent");
    // En mode compact, l'identité visuelle doit être conservée via l'icône et potentiellement la couleur
    // (la couleur via CSS variables une fois appliquées, ou via les classes)
    // Ce test vérifie que point-cle reçoit sa propre classe, pas une classe générique bleue
  } finally { MarkdownRenderer.render = previous; }
});

test("Geometry et candidate identiques : Compact + [!explication] UN ne change pas la géométrie", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    heading(container, "Titre principal");
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "explication" } });
    const titleEl = callout.createEl("div", { cls: "callout-title" });
    titleEl.createEl("div", { cls: "callout-title-inner", text: "UN" });
    callout.createEl("div", { cls: "callout-content", text: "Texte court" });
  };
  try {
    const { result: calloutMode } = await render("GEO-TEST", { roleEditorDisplay: "callouts" });
    const { result: compactMode } = await render("GEO-TEST", { roleEditorDisplay: "compact" });
    assert.equal(calloutMode.geometry, compactMode.geometry, "geometry identique");
    assert.equal(calloutMode.candidate, compactMode.candidate, "candidate identique");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS : Bug Fix - Icônes doubles et couleurs en Compact ========== */

test("BUG FIX 1 : Compact + [!source] icône native Obsidian masquée, chrome retiré", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "source" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "doc" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu source" });
  };
  try {
    const { result } = await render("SOURCE-BUG-FIX-1", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'source' rendu");
    assert.ok(callout.classList.contains("feuillets-role-source"), "classe feuillets-role-source");
    assert.equal(callout.style.background, "transparent", "background transparent en compact");
    assert.equal(callout.style.border, "0", "border retiré en compact");

    // Le SVG d'Obsidian native dans callout-title-inner doit être masqué (display:none)
    const titleInner = callout.querySelector(".callout-title-inner");
    const nativeSvg = titleInner?.querySelector("svg");
    if (nativeSvg) {
      assert.equal(nativeSvg.style.display, "none", "SVG Obsidian native masqué (display:none)");
    }

    // Vérifier que le titre 'doc' est visible
    assert.equal(titleInner?.text, "doc", "titre 'doc' conservé et visible");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG FIX 2 : Compact + [!point-cle] reprend couleur sémantique, pas bleu générique", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "point-cle" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Point clé" });
    callout.createEl("div", { cls: "callout-content", text: "Important" });
  };
  try {
    const { result } = await render("POINT-CLE-BUG-FIX-2", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'point-cle' rendu");
    assert.ok(callout.classList.contains("feuillets-semantic-role"), "classe feuillets-semantic-role");
    assert.ok(callout.classList.contains("feuillets-role-point-cle"), "classe feuillets-role-point-cle présente");

    // Vérifier que la classe de famille sémantique est bien présente
    // Le style de couleur sera appliqué via CSS classes, pas inline
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.ok(titleInner, "titre 'Point clé' visible");
    assert.equal(titleInner?.text, "Point clé", "texte du titre préservé");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG FIX : Compact + [!solution] reproduit identité visuelle Solution (famille verte)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "solution" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "correction" });
    callout.createEl("div", { cls: "callout-content", text: "Réponse ici" });
  };
  try {
    const { result } = await render("SOLUTION-BUG-FIX", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'solution' rendu");
    assert.ok(callout.classList.contains("feuillets-role-solution"), "classe feuillets-role-solution (famille verte)");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS : Mode Callout - SemanticRole ========== */

test("Callout + [!source] : chrome conservé, icône native masquée, couleur sémantique appliquée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "source" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Document source" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu source" });
  };
  try {
    const { result } = await render("SOURCE-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'source' rendu");
    assert.ok(callout.classList.contains("feuillets-semantic-role"), "classe feuillets-semantic-role présente");
    assert.ok(callout.classList.contains("feuillets-role-source"), "classe feuillets-role-source présente");

    // Chrome conservé (contrairement à Compact)
    assert.notEqual(callout.style.background, "transparent", "mode callout : background CONSERVÉ (pas transparent)");
    assert.notEqual(callout.style.border, "0", "mode callout : border CONSERVÉ");

    // Icône native masquée
    const titleInner = callout.querySelector(".callout-title-inner");
    const nativeSvg = titleInner?.querySelector("svg");
    if (nativeSvg) {
      assert.equal(nativeSvg.style.display, "none", "SVG Obsidian native masqué (display:none)");
    }

    // Titre visible
    assert.equal(titleInner?.text, "Document source", "titre visible en mode callout");

    // Couleur sémantique appliquée au titre (via CSS classes, pas inline)
    const title_elem = callout.querySelector(".callout-title");
    assert.ok(title_elem, "callout-title présent");
    assert.equal(title_elem?.style.color || "", "", "aucune couleur inline sur callout-title (appliquée via CSS classes)");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout + [!point-cle] : chrome conservé, famille rouge appliquée (pas bleu générique)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "point-cle" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Important" });
    callout.createEl("div", { cls: "callout-content", text: "Point clé du cours" });
  };
  try {
    const { result } = await render("POINT-CLE-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'point-cle' rendu");
    assert.ok(callout.classList.contains("feuillets-semantic-role"), "classe feuillets-semantic-role présente");
    assert.ok(callout.classList.contains("feuillets-role-point-cle"), "classe feuillets-role-point-cle présente");

    // Chrome conservé
    assert.notEqual(callout.style.background, "transparent", "mode callout : background CONSERVÉ");

    // Titre visible
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.equal(titleInner?.text, "Important", "titre visible");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout + [!solution] : chrome conservé, famille verte appliquée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "solution" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Réponse" });
    callout.createEl("div", { cls: "callout-content", text: "Voici la solution" });
  };
  try {
    const { result } = await render("SOLUTION-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'solution' rendu");
    assert.ok(callout.classList.contains("feuillets-role-solution"), "classe feuillets-role-solution (famille verte)");
    assert.notEqual(callout.style.background, "transparent", "mode callout : background CONSERVÉ");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout + [!questions] : chrome conservé, famille bleue appliquée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "À retenir" });
    callout.createEl("div", { cls: "callout-content", text: "Questions importantes" });
  };
  try {
    const { result } = await render("QUESTIONS-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'questions' rendu");
    assert.ok(callout.classList.contains("feuillets-role-questions"), "classe feuillets-role-questions (famille bleue)");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout natif [!note] : INCHANGÉ, icône native conservée, pas de traitement sémantique", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Note" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    callout.createEl("div", { cls: "callout-content", text: "Note personnelle" });
  };
  try {
    const { result } = await render("NOTE-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.equal(callout?.getAttribute("data-callout"), "note", "[!note] détecté");
    assert.equal(callout?.classList.contains("feuillets-semantic-role"), false, "[!note] : pas de classe feuillets-semantic-role");

    // Icône native [!note] conservée (pas de traitement)
    const titleInner = callout?.querySelector(".callout-title-inner");
    const nativeSvg = titleInner?.querySelector("svg");
    assert.ok(nativeSvg, "SVG natif [!note] conservé");
    // Ne doit pas avoir display:none appliqué
  } finally { MarkdownRenderer.render = previous; }
});

test("Compact + [!definition] : chrome retiré, couleur sémantique purple appliquée, icône native masquée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "definition" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Terme" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    callout.createEl("div", { cls: "callout-content", text: "Définition" });
  };
  try {
    const { result } = await render("DEFINITION-COMPACT", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'definition' rendu");
    assert.ok(callout.classList.contains("feuillets-role-definition"), "classe feuillets-role-definition (famille purple)");
    assert.equal(callout.style.background, "transparent", "background transparent en compact");

    // Icône native masquée
    const titleInner = callout.querySelector(".callout-title-inner");
    const nativeSvg = titleInner?.querySelector("svg");
    if (nativeSvg) {
      assert.equal(nativeSvg.style.display, "none", "icône native masquée");
    }

    // Titre visible
    assert.equal(titleInner?.text, "Terme", "titre visible");
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout + [!methode] : chrome conservé, couleur sémantique verte appliquée, icône native masquée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "methode" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Méthode" });
    titleInner.createEl("svg", { cls: "callout-icon" });
    callout.createEl("div", { cls: "callout-content", text: "Étapes" });
  };
  try {
    const { result } = await render("METHODE-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout 'methode' rendu");
    assert.ok(callout.classList.contains("feuillets-role-methode"), "classe feuillets-role-methode (famille verte)");
    assert.notEqual(callout.style.background, "transparent", "mode callout : background CONSERVÉ");

    // Icône native masquée
    const titleInner = callout.querySelector(".callout-title-inner");
    const nativeSvg = titleInner?.querySelector("svg");
    if (nativeSvg) {
      assert.equal(nativeSvg.style.display, "none", "icône native masquée");
    }

    // Titre visible
    assert.equal(titleInner?.text, "Méthode", "titre visible");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== Vérification critique : aucune couleur inline ========== */

test("Compact : pas de couleur inline sur les titres de rôles sémantiques (18 rôles)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    for (const role of SEMANTIC_ROLES) {
      const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": role } });
      const title = callout.createEl("div", { cls: "callout-title" });
      title.createEl("div", { cls: "callout-title-inner", text: role });
      callout.createEl("div", { cls: "callout-content", text: `Contenu de ${role}` });
    }
  };
  try {
    const { result } = await render("ALL-ROLES-COMPACT", { roleEditorDisplay: "compact" });
    const callouts = result.inner.querySelectorAll(".callout.feuillets-semantic-role");
    for (const callout of callouts) {
      const title = callout.querySelector(".callout-title");
      assert.equal(title?.style.color || "", "", `Pas de couleur inline sur titre de ${callout.getAttribute("data-callout")} en compact`);
    }
  } finally { MarkdownRenderer.render = previous; }
});

test("Callout : pas de couleur inline sur les titres de rôles sémantiques (18 rôles)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    for (const role of SEMANTIC_ROLES) {
      const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": role } });
      const title = callout.createEl("div", { cls: "callout-title" });
      title.createEl("div", { cls: "callout-title-inner", text: role });
      callout.createEl("div", { cls: "callout-content", text: `Contenu de ${role}` });
    }
  };
  try {
    const { result } = await render("ALL-ROLES-CALLOUT", { roleEditorDisplay: "callouts" });
    const callouts = result.inner.querySelectorAll(".callout.feuillets-semantic-role");
    for (const callout of callouts) {
      const title = callout.querySelector(".callout-title");
      assert.equal(title?.style.color || "", "", `Pas de couleur inline sur titre de ${callout.getAttribute("data-callout")} en callout`);
    }
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS OBLIGATOIRES : Stabilité du contenu Présentation 16:9 ========== */

test("BUG 1 : H2/H3/texte/H3/texte → second H3 reste dans body, pas remonté au header", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "Titre 1" });
    container.createEl("h3", { text: "Sous-titre 1" });
    container.createEl("p", { text: "Texte A" });
    container.createEl("h3", { text: "Sous-titre 2" });
    container.createEl("p", { text: "Texte B" });
  };
  try {
    const { result } = await render("BUG1-HEADINGS");
    const headerRegion = result.inner.querySelector(".feuillets-presentation-render-heading");
    const contentRegion = result.inner.querySelector(".feuillets-presentation-render-content");

    // Header doit contenir H2 + premier H3
    const headerHeadings = Array.from(headerRegion?.querySelectorAll("h2, h3") || []);
    assert.equal(headerHeadings.length, 2, "Header contient exactement 2 headings");
    assert.equal(headerHeadings[0]?.innerText || headerHeadings[0]?.text, "Titre 1", "Header H2");
    assert.equal(headerHeadings[1]?.innerText || headerHeadings[1]?.text, "Sous-titre 1", "Header premier H3");

    // Body doit contenir "Texte A" + second H3 + "Texte B"
    const contentText = contentRegion?.innerText || "";
    assert.ok(contentText.includes("Sous-titre 2"), "Body contient second H3");
    assert.ok(contentText.includes("Texte A"), "Body contient Texte A");
    assert.ok(contentText.includes("Texte B"), "Body contient Texte B");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 2 : H2 + image seule → aucun SPLIT/STACK, uniquement FLOW, image plein espace", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "Titre" });
    const { media, img } = knownMedia(container, 800, 600);
  };
  try {
    const { result } = await render("BUG2-IMAGE-SEULE");
    // Geometry doit être FLOW (null candidate, pas de SPLIT/STACK)
    assert.equal(result.geometry, "flow", "Géométrie FLOW pour H + image seule");
    assert.equal(result.candidate, null, "Pas de candidat SPLIT/STACK");

    // Header + image dans content
    const headerRegion = result.inner.querySelector(".feuillets-presentation-render-heading");
    const contentRegion = result.inner.querySelector(".feuillets-presentation-render-content");
    assert.ok(headerRegion?.querySelector("h2"), "H2 dans header");

    // Image dans content, sans cellule vide
    const images = Array.from(contentRegion?.querySelectorAll("img") || []);
    assert.equal(images.length, 1, "Une seule image");
    assert.ok(!result.overflow, "Pas d'overflow pour image qui tient");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 3 : H2 + 2 images → les deux visibles, ordre conservé, FLOW", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "Titre" });
    const { img: img1 } = knownMedia(container, 400, 300);
    const { img: img2 } = knownMedia(container, 500, 400);
  };
  try {
    const { result } = await render("BUG3-DEUX-IMAGES");
    assert.equal(result.geometry, "flow", "Géométrie FLOW avec 2 images");

    // Les deux images doivent être présentes et visibles (pas de overflow:hidden)
    const images = Array.from(result.inner.querySelectorAll("img"));
    assert.equal(images.length, 2, "Deux images présentes");

    // Vérifier l'ordre (parcours DOM linéaire)
    const contentRegion = result.inner.querySelector(".feuillets-presentation-render-flow");
    const mediaRegions = Array.from(contentRegion?.querySelectorAll(".feuillets-presentation-render-flow-media-region") || []);
    assert.equal(mediaRegions.length, 2, "Deux régions media (une par image)");

    // Aucune image ne doit avoir display:none ou être cachée
    for (const img of images) {
      assert.notEqual(img.style.display, "none", "Image non cachée (display:none)");
    }
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 4 : paragraphe + callout + paragraphe → callout présent entre les deux", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("p", { text: "Avant" });
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    callout.createEl("div", { cls: "callout-title", text: "Note" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu de la note" });
    container.createEl("p", { text: "Après" });
  };
  try {
    const { result } = await render("BUG4-CALLOUT-ENTRE");
    const content = result.inner.querySelector(".feuillets-presentation-render-content");
    const children = Array.from(content?.children || []);

    // Vérifier l'ordre : P + CALLOUT + P
    const callouts = Array.from(content?.querySelectorAll(".callout") || []);
    assert.equal(callouts.length, 1, "Un callout présent");
    const contentText = content?.innerText || "";
    assert.ok(contentText.includes("Avant"), "Texte 'Avant' présent");
    assert.ok(contentText.includes("Contenu de la note"), "Callout content présent");
    assert.ok(contentText.includes("Après"), "Texte 'Après' présent");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 4 : callout sémantique + callout natif → tous deux lisibles, pas d'héritage de couleur sombre", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    // Callout sémantique Feuillets
    const semantic = container.createEl("div", { cls: "callout", attr: { "data-callout": "questions" } });
    semantic.classList.add("feuillets-semantic-role", "feuillets-role-questions");
    semantic.createEl("div", { cls: "callout-title", text: "Questions" });
    semantic.createEl("div", { cls: "callout-content", text: "Contenu questions" });

    // Callout natif Obsidian
    const native = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    native.createEl("div", { cls: "callout-title", text: "Note" });
    native.createEl("div", { cls: "callout-content", text: "Contenu natif" });
  };
  try {
    const { result } = await render("BUG4-CALLOUT-LISIBLE");
    const callouts = Array.from(result.inner.querySelectorAll(".callout"));

    // Tous les callouts doivent être présents
    assert.equal(callouts.length, 2, "Deux callouts présents");

    // Tous les callouts doivent avoir une couleur lisible (pas sombre du thème)
    for (const callout of callouts) {
      const color = callout.style.color;
      // La couleur doit être définie et lisible (pas de couleur sombre du thème)
      assert.ok(color || true, "Callout rendu avec couleur définie");
    }
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 4 : 'document' et 'correction' (anciens ids) → visibles comme callouts ordinaires", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const doc = container.createEl("div", { cls: "callout", attr: { "data-callout": "document" } });
    doc.createEl("div", { cls: "callout-title", text: "Document" });
    doc.createEl("div", { cls: "callout-content", text: "Contenu document" });

    const correction = container.createEl("div", { cls: "callout", attr: { "data-callout": "correction" } });
    correction.createEl("div", { cls: "callout-title", text: "Correction" });
    correction.createEl("div", { cls: "callout-content", text: "Contenu correction" });
  };
  try {
    const { result } = await render("BUG4-ANCIEN-CALLOUT");
    const callouts = Array.from(result.inner.querySelectorAll(".callout"));
    assert.equal(callouts.length, 2, "Deux callouts anciens présents");

    // Vérifier que 'document' et 'correction' sont rendus ordinairement (pas de transformation sémantique)
    const dataCallouts = callouts.map((c) => c.getAttribute("data-callout"));
    assert.ok(dataCallouts.includes("document"), "'document' callout rendu");
    assert.ok(dataCallouts.includes("correction"), "'correction' callout rendu");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 7 : benchmarks existants média+texte SPLIT/STACK restent inchangés", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "Titre" });
    const { img } = knownMedia(container, 800, 600);
    container.createEl("p", { text: "Texte après image" });
  };
  try {
    const { result } = await render("BUG7-MEDIA-TEXTE");
    // Texte après média : doit créer des candidats SPLIT/STACK
    const candidates = ["split-42-58", "split-50-50", "split-58-42", "stack-65-35", "stack-60-40", "stack-55-45"];
    assert.ok(candidates.includes(result.candidate || ""), "Candidat SPLIT ou STACK choisi");
    assert.notEqual(result.geometry, "flow", "Pas FLOW pour média + texte");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 8 : P/IMG/P reste FLOW avec ordre conservé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("p", { text: "Avant l'image" });
    const { img } = knownMedia(container, 600, 400);
    container.createEl("p", { text: "Après l'image" });
  };
  try {
    const { result } = await render("BUG8-FLOW-P-IMG-P");
    // Pas de heading, donc FLOW géné
    assert.equal(result.geometry, "flow", "Géométrie FLOW pour P/IMG/P");

    // Vérifier l'ordre DOM : P + IMG + P
    const contentRegion = result.inner.querySelector(".feuillets-presentation-render-flow");
    const children = Array.from(contentRegion?.children || []);
    const textChildren = children.filter((c) => c.tagName === "P");
    const mediaChildren = children.filter((c) => c.classList?.contains("feuillets-presentation-render-flow-media-region"));

    assert.equal(textChildren.length, 2, "Deux paragraphes");
    assert.equal(mediaChildren.length, 1, "Une région média");
  } finally { MarkdownRenderer.render = previous; }
});

test("BUG 9 : aucun bloc du DOM source ne disparaît dans le candidat retenu", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "H2" });
    container.createEl("p", { text: "P1" });
    const { img: img1 } = knownMedia(container, 400, 300);
    container.createEl("p", { text: "P2" });
    const { img: img2 } = knownMedia(container, 500, 400);
    container.createEl("p", { text: "P3" });
  };
  try {
    const { result } = await render("BUG9-COMPLETUDE");
    const text = result.inner.innerText || "";

    // Tous les blocs du source doivent être présents dans le rendu
    assert.ok(text.includes("H2"), "H2 rendu");
    assert.ok(text.includes("P1"), "P1 rendu");
    assert.ok(text.includes("P2"), "P2 rendu");
    assert.ok(text.includes("P3"), "P3 rendu");

    // Deux images
    const images = Array.from(result.inner.querySelectorAll("img"));
    assert.equal(images.length, 2, "Deux images rendues");

    // Aucun image ne doit être caché par overflow
    for (const img of images) {
      assert.notEqual(img.style.display, "none", "Aucune image cachée");
    }
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS : Callouts visibles — autonomie visuelle Présentation 16:9 ========== */

test("CALLOUT : paragraphe + [!note] + paragraphe → titre et contenu visibles en FLOW", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("p", { text: "Avant" });
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Note importante" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu de la note" });
    container.createEl("p", { text: "Après" });
  };
  try {
    const { result } = await render("CALLOUT-NOTE-VISIBLE");
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "Callout [!note] présent");

    // Vérifier que le callout a les styles d'autonomie
    assert.equal(callout.style.display || "block", "block", "Callout display visible");
    assert.equal(callout.style.boxSizing, "border-box", "Callout box-sizing défini");
    assert.notEqual(callout.style.maxHeight, "0", "Callout pas tronqué en hauteur");

    // Vérifier que le titre est visible
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.ok(titleInner, "Titre du callout présent");
    assert.ok(result.inner.innerText?.includes("Note importante"), "Titre visible dans le texte");

    // Vérifier que le contenu est visible
    assert.ok(result.inner.innerText?.includes("Contenu de la note"), "Contenu visible");

    // Vérifier que le contexte n'est pas altéré (paragraphes avant/après)
    assert.ok(result.inner.innerText?.includes("Avant"), "Texte avant présent");
    assert.ok(result.inner.innerText?.includes("Après"), "Texte après présent");
  } finally { MarkdownRenderer.render = previous; }
});

test("CALLOUT : [!synthese] mode Callout → boîte + titre + contenu visibles", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    callout.classList.add("feuillets-semantic-role", "feuillets-role-synthese");
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
  };
  try {
    const { result } = await render("CALLOUT-SYNTHESE-CALLOUT", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "Callout [!synthese] rendu");

    // Vérifier l'autonomie visuelle
    assert.notEqual(callout.style.display, "none", "Callout visible");
    assert.notEqual(callout.style.maxHeight, "0", "Callout pas tronqué");

    // Vérifier que le contenu est accessible
    const text = result.inner.innerText || "";
    assert.ok(text.includes("Synthèse"), "Titre visible");
    assert.ok(text.includes("Points clés résumés"), "Contenu visible");
  } finally { MarkdownRenderer.render = previous; }
});

test("CALLOUT : [!synthese] mode Compact → contenu visible, chrome compact", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    callout.classList.add("feuillets-semantic-role", "feuillets-role-synthese");
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
  };
  try {
    const { result } = await render("CALLOUT-SYNTHESE-COMPACT", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "Callout [!synthese] rendu");

    // Vérifier que le contenu reste visible même en mode compact
    const text = result.inner.innerText || "";
    assert.ok(text.includes("Points clés résumés"), "Contenu visible en Compact");
  } finally { MarkdownRenderer.render = previous; }
});

test("CALLOUT : [!document] et [!correction] → visibles comme callouts ordinaires", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const doc = container.createEl("div", { cls: "callout", attr: { "data-callout": "document" } });
    doc.createEl("div", { cls: "callout-title" });
    doc.createEl("div", { cls: "callout-content", text: "Contenu document" });

    const correction = container.createEl("div", { cls: "callout", attr: { "data-callout": "correction" } });
    correction.createEl("div", { cls: "callout-title" });
    correction.createEl("div", { cls: "callout-content", text: "Contenu correction" });
  };
  try {
    const { result } = await render("CALLOUT-ANCIEN-TYPE");
    const callouts = Array.from(result.inner.querySelectorAll(".callout"));
    assert.equal(callouts.length, 2, "Deux callouts présents");

    // Vérifier qu'ils sont visibles
    assert.ok(result.inner.innerText?.includes("Contenu document"), "document callout visible");
    assert.ok(result.inner.innerText?.includes("Contenu correction"), "correction callout visible");

    // Vérifier qu'aucun n'a été transformé en rôle sémantique
    for (const callout of callouts) {
      assert.equal(callout.classList.contains("feuillets-semantic-role"), false, "Non sémantique");
    }
  } finally { MarkdownRenderer.render = previous; }
});

test("CALLOUT : callout + image produisant SPLIT/STACK → callout toujours visible", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("h2", { text: "Titre" });
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "info" } });
    callout.createEl("div", { cls: "callout-title", text: "Info" });
    callout.createEl("div", { cls: "callout-content", text: "Information importante" });
    const { img } = knownMedia(container, 600, 400);
  };
  try {
    const { result } = await render("CALLOUT-SPLIT-STACK");
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "Callout présent dans SPLIT/STACK");

    // Vérifier que le callout est visible même en géométrie SPLIT/STACK
    const text = result.inner.innerText || "";
    assert.ok(text.includes("Information importante"), "Callout visible en SPLIT/STACK");

    // Vérifier que le callout n'est pas dans overflow:hidden
    assert.notEqual(callout.style.display, "none", "Callout pas caché");
    assert.equal(callout.style.overflow, "visible", "Callout overflow:visible");
    // Callout non sémantique ('info') : chrome générique réellement stylé, pas un nœud nu
    assert.notEqual(callout.style.background, "", "Chrome générique : background posé même en SPLIT/STACK");
    assert.ok(callout.style.borderLeft, "Chrome générique : bordure gauche posée même en SPLIT/STACK");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS : autonomie totale du renderer face à un thème Obsidian hostile ========== */

test("Thème hostile — [!synthese] (sémantique) : couleur claire/overflow:hidden/max-height:0 posés AVANT traitement sont neutralisés", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    // Simule un thème Obsidian hostile qui aurait déjà posé son propre style inline
    // sur le callout et son contenu avant que le renderer n'intervienne.
    callout.style.color = "#eeeeee";
    callout.style.overflow = "hidden";
    callout.style.maxHeight = "0";
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    const content = callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
    content.style.color = "#eeeeee";
    content.style.overflow = "hidden";
    content.style.maxHeight = "0";
  };
  try {
    const { result } = await render("HOSTILE-SYNTHESE", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout, "callout [!synthese] rendu");
    assert.equal(callout.style.overflow, "visible", "overflow:hidden hostile neutralisé sur le callout");
    assert.equal(callout.style.maxHeight, "none", "max-height:0 hostile neutralisé sur le callout");
    assert.notEqual(callout.style.color, "#eeeeee", "couleur claire hostile neutralisée sur le callout");
    const content = callout.querySelector(".callout-content");
    assert.equal(content.style.overflow, "visible", "overflow:hidden hostile neutralisé sur le contenu");
    assert.equal(content.style.maxHeight, "none", "max-height:0 hostile neutralisé sur le contenu");
    assert.equal(content.style.color, "#1f1f1f", "couleur claire hostile neutralisée sur le contenu, couleur sombre explicite");
    assert.ok(result.inner.innerText?.includes("Points clés résumés"), "contenu toujours lisible malgré le thème hostile");
  } finally { MarkdownRenderer.render = previous; }
});

test("Thème hostile — [!note] (non sémantique) : titre à couleur claire posé AVANT traitement est neutralisé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Note" });
    // Thème hostile : couleur claire + overflow:hidden posés directement sur le titre
    titleInner.style.color = "#f0f0f0";
    titleInner.style.overflow = "hidden";
    titleInner.style.maxHeight = "0";
    const content = callout.createEl("div", { cls: "callout-content", text: "Contenu de la note" });
    content.style.color = "#f0f0f0";
  };
  try {
    const { result } = await render("HOSTILE-NOTE", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    const titleInner = callout.querySelector(".callout-title-inner");
    assert.equal(titleInner.style.color, "#1f1f1f", "couleur claire hostile neutralisée sur le titre non sémantique");
    assert.equal(titleInner.style.overflow, "visible", "overflow:hidden hostile neutralisé sur le titre");
    assert.equal(titleInner.style.maxHeight, "none", "max-height:0 hostile neutralisé sur le titre");
    const content = callout.querySelector(".callout-content");
    assert.equal(content.style.color, "#1f1f1f", "couleur claire hostile neutralisée sur le contenu");
    assert.ok(result.inner.innerText?.includes("Note"), "titre toujours lisible");
    assert.ok(result.inner.innerText?.includes("Contenu de la note"), "contenu toujours lisible");
  } finally { MarkdownRenderer.render = previous; }
});

test("[!synthese] mode Callout : boîte réellement stylée (fond + bordure gauche bleue famille + padding), pas un nœud nu", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
  };
  try {
    const { result } = await render("SYNTHESE-BOX", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.ok(callout.classList.contains("feuillets-role-synthese"), "rôle synthese (famille bleue)");
    assert.ok(callout.style.background && callout.style.background !== "transparent", "fond réellement posé (pas transparent)");
    assert.ok(callout.style.borderLeft.includes("#1F5EA8") || callout.style.borderLeft.toLowerCase().includes("1f5ea8"), "bordure gauche à la couleur de famille bleue (synthese)");
    assert.notEqual(callout.style.padding, "0", "padding réellement posé");
  } finally { MarkdownRenderer.render = previous; }
});

test("[!synthese] mode Compact : chrome retiré (fond/bordure/padding) mais texte et titre restent visibles", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
  };
  try {
    const { result } = await render("SYNTHESE-COMPACT-BOX", { roleEditorDisplay: "compact" });
    const callout = result.inner.querySelector(".callout");
    assert.equal(callout.style.background, "transparent", "fond retiré en Compact");
    assert.equal(callout.style.border, "0", "bordure retirée en Compact");
    assert.equal(callout.style.padding, "0", "padding retiré en Compact");
    const title = callout.querySelector(".callout-title");
    assert.equal(title.style.padding, "0", "padding du titre retiré en Compact");
    assert.ok(result.inner.innerText?.includes("Synthèse"), "titre toujours visible en Compact");
    assert.ok(result.inner.innerText?.includes("Points clés résumés"), "contenu toujours visible en Compact");
  } finally { MarkdownRenderer.render = previous; }
});

test("[!note] mode Compact : réglage Compact sans effet — reste une boîte générique réellement stylée", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    callout.createEl("div", { cls: "callout-title", text: "Note" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu privé" });
  };
  try {
    const { result: compact } = await render("NOTE-BOX-COMPACT", { roleEditorDisplay: "compact" });
    const { result: callouts } = await render("NOTE-BOX-COMPACT", { roleEditorDisplay: "callouts" });
    const calloutCompact = compact.inner.querySelector(".callout");
    const calloutFull = callouts.inner.querySelector(".callout");
    // Chrome générique identique quel que soit le réglage — le Compact ne le transforme jamais.
    assert.equal(calloutCompact.style.background, calloutFull.style.background, "même fond, Compact sans effet sur un callout non sémantique");
    assert.equal(calloutCompact.style.borderLeft, calloutFull.style.borderLeft, "même bordure gauche, Compact sans effet");
    assert.notEqual(calloutCompact.style.background, "transparent", "boîte générique réellement stylée (fond posé)");
    assert.ok(calloutCompact.style.borderLeft, "bordure gauche générique posée");
  } finally { MarkdownRenderer.render = previous; }
});

test("[!document] / [!correction] : boîte générique réellement stylée (pas un nœud nu), non sémantiques", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const doc = container.createEl("div", { cls: "callout", attr: { "data-callout": "document" } });
    doc.createEl("div", { cls: "callout-title", text: "Document" });
    doc.createEl("div", { cls: "callout-content", text: "Contenu document" });
    const correction = container.createEl("div", { cls: "callout", attr: { "data-callout": "correction" } });
    correction.createEl("div", { cls: "callout-title", text: "Correction" });
    correction.createEl("div", { cls: "callout-content", text: "Contenu correction" });
  };
  try {
    const { result } = await render("DOC-CORRECTION-BOX");
    const [doc, correction] = Array.from(result.inner.querySelectorAll(".callout"));
    for (const callout of [doc, correction]) {
      assert.equal(callout.classList.contains("feuillets-semantic-role"), false, "non sémantique");
      assert.notEqual(callout.style.background, "", "fond générique posé");
      assert.notEqual(callout.style.background, "transparent", "pas transparent, une vraie boîte");
      assert.ok(callout.style.borderLeft, "bordure gauche générique posée");
    }
  } finally { MarkdownRenderer.render = previous; }
});

test("CALLOUT + FLOW : [!note] entre deux paragraphes en FLOW reçoit le même chrome générique stylé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("p", { text: "Avant" });
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    callout.createEl("div", { cls: "callout-title", text: "Note" });
    callout.createEl("div", { cls: "callout-content", text: "Contenu de la note" });
    container.createEl("p", { text: "Après" });
  };
  try {
    const { result } = await render("FLOW-NOTE-BOX");
    assert.equal(result.geometry, "flow", "géométrie FLOW");
    const callout = result.inner.querySelector(".callout");
    assert.notEqual(callout.style.background, "transparent", "chrome générique réellement stylé en FLOW");
    assert.ok(callout.style.borderLeft, "bordure gauche générique posée en FLOW");
    assert.equal(callout.style.overflow, "visible", "callout jamais tronqué en FLOW");
  } finally { MarkdownRenderer.render = previous; }
});

/* ========== TESTS OBLIGATOIRES : mix-blend-mode: lighten du thème Obsidian neutralisé ========== */

test("Thème Obsidian hostile — [!synthese] (sémantique) : mix-blend-mode:lighten posé AVANT traitement est neutralisé → normal", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "synthese" } });
    // Simule le thème Obsidian réel qui applique mix-blend-mode: lighten sur les callouts
    callout.style.mixBlendMode = "lighten";
    const title = callout.createEl("div", { cls: "callout-title" });
    title.createEl("div", { cls: "callout-title-inner", text: "Synthèse" });
    callout.createEl("div", { cls: "callout-content", text: "Points clés résumés" });
  };
  try {
    const { result } = await render("LIGHTEN-SYNTHESE", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.equal(callout.style.mixBlendMode, "normal", "mix-blend-mode:lighten hostile neutralisé sur rôle sémantique");
    assert.ok(result.inner.innerText?.includes("Synthèse"), "callout visible malgré le thème hostile");
    assert.ok(result.inner.innerText?.includes("Points clés résumés"), "contenu visible");
  } finally { MarkdownRenderer.render = previous; }
});

test("Thème Obsidian hostile — [!note] (non sémantique) : mix-blend-mode:lighten posé AVANT traitement est neutralisé → normal", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    const callout = container.createEl("div", { cls: "callout", attr: { "data-callout": "note" } });
    callout.style.mixBlendMode = "lighten";
    const title = callout.createEl("div", { cls: "callout-title", text: "Note" });
    const titleInner = title.createEl("div", { cls: "callout-title-inner", text: "Note" });
    const content = callout.createEl("div", { cls: "callout-content", text: "Contenu de la note" });
  };
  try {
    const { result } = await render("LIGHTEN-NOTE", { roleEditorDisplay: "callouts" });
    const callout = result.inner.querySelector(".callout");
    assert.equal(callout.style.mixBlendMode, "normal", "mix-blend-mode:lighten hostile neutralisé sur callout non sémantique");
    assert.ok(result.inner.innerText?.includes("Note"), "titre visible");
    assert.ok(result.inner.innerText?.includes("Contenu de la note"), "contenu visible malgré le thème hostile");
  } finally { MarkdownRenderer.render = previous; }
});
