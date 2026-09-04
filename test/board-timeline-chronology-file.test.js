import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { renderBoardTimeline } from "../src/views/board-timeline.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.text = options.text || "";
    this.classes = new Set((options.cls || "").split(" ").filter(Boolean));
    this.events = new Map();
    this.style = { removeProperty: () => {} };
    this.parentNode = this;
  }
  createDiv(options = {}) { const child = new FakeElement(options); child.parentNode = this; this.children.push(child); return child; }
  createSpan(options = {}) { return this.createDiv(options); }
  createEl(tag, options = {}) { const child = this.createDiv(options); child.tag = tag; child.value = ""; return child; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  async trigger(type, event = {}) { await this.events.get(type)?.({ stopPropagation: () => {}, ...event }); }
  setText(value) { this.text = String(value); return this; }
  hide() {}
  show() {}
  focus() {}
  remove() {}
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path, date, extra = {}) {
  const value = new TFile(path);
  value.__fm = { date, ...extra };
  return value;
}

function findAll(element, predicate) {
  const result = [];
  for (const child of element.children) {
    if (predicate(child)) result.push(child);
    result.push(...findAll(child, predicate));
  }
  return result;
}

function context(sources, contents, calls = {}) {
  return {
    settings: { timelineOrder: "chrono", timelineTagFilter: "", timelineScale: "aucune" },
    flattenFiles: () => [],
    passesFilter: () => true,
    isFrontMatter: () => false,
    fm: (target) => target.__fm || {},
    getChronoFolders: () => sources,
    tagsOf: (target) => target.__tags || [],
    readFile: async (target) => contents.get(target.path) || "",
    openFileRange: async (...args) => calls.ranges?.push(args),
    shortTitleFor: (target) => target.basename,
    setFm: async (...args) => calls.setFm?.push(args),
    rerenderAfterDateEdit: async () => {},
    makeClickToEditFmArea: (parent, _file, _key, placeholder) => parent.createDiv({ cls: "feuillets-flat-text-cell", text: placeholder }),
    openFile: (target) => calls.open?.push(target),
  };
}

function virtualSource(title, date, text = "Texte") {
  return `# Chronologie\n\n## ${title}\n\n### ${date}\n\n${text}`;
}

test("Chronology.md et Chronologie.md sont projetés, quelle que soit la casse", async () => {
  const chronology = file("Recherche/Chronology.md", "");
  const chronologie = file("Recherche/Chronologie.md", "");
  const sources = [folder("Recherche", [chronology, chronologie])];
  const contents = new Map([
    [chronology.path, virtualSource("A", "1755")],
    [chronologie.path, virtualSource("B", "1756")],
  ]);
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context(sources, contents));
  assert.deepEqual(findAll(container, (el) => el.classes.has("feuillets-timeline-title")).map((el) => el.text), ["A", "B"]);
});

test("un autre basename reste un milestone Research historique", async () => {
  const source = file("Recherche/Events.md", "1755", { synopsis: "Historique" });
  const research = folder("Recherche", [source]);
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context([research], new Map()));
  assert.deepEqual(findAll(container, (el) => el.classes.has("feuillets-timeline-title")).map((el) => el.text), ["Events"]);
});

test("une entrée virtuelle affiche son titre et son texte sans éditeur", async () => {
  const source = file("Recherche/Chronologie.md", "");
  const contents = new Map([[source.path, virtualSource("Séisme de Lisbonne", "1er novembre 1755", "Catastrophe naturelle majeure.")]]);
  let editorCalls = 0;
  const ctx = context([folder("Recherche", [source])], contents);
  ctx.makeClickToEditFmArea = () => { editorCalls += 1; return new FakeElement(); };
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), ctx);
  const title = findAll(container, (el) => el.classes.has("feuillets-timeline-title"))[0];
  const date = findAll(container, (el) => el.classes.has("feuillets-timeline-date-display"))[0];
  assert.equal(title.text, "Séisme de Lisbonne");
  assert.equal(findAll(container, (el) => el.text === "Catastrophe naturelle majeure.").length, 1);
  assert.equal(date.events.has("click"), false);
  assert.equal(editorCalls, 0);
});

test("le titre virtuel ouvre et sélectionne la plage source exacte", async () => {
  const source = file("Recherche/Chronology.md", "");
  const body = virtualSource("Départ", "1755", "Description");
  const contents = new Map([[source.path, body]]);
  const calls = { ranges: [] };
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context([folder("Recherche", [source])], contents, calls));
  await findAll(container, (el) => el.classes.has("feuillets-timeline-title"))[0].trigger("click");
  assert.equal(calls.ranges.length, 1);
  assert.equal(calls.ranges[0][0], source);
  assert.match(body.slice(calls.ranges[0][1], calls.ranges[0][2]), /^## Départ/);
  assert.equal(calls.ranges[0][1], body.indexOf("## Départ"));
  assert.equal(calls.ranges[0][2], body.length);
});

test("un conteneur valide n'est pas ingéré comme milestone supplémentaire", async () => {
  const source = file("Recherche/Chronology.md", "1700");
  const contents = new Map([[source.path, virtualSource("A", "1755") + "\n\n## B\n### 1756\nTexte"]]);
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context([folder("Recherche", [source])], contents));
  assert.deepEqual(findAll(container, (el) => el.classes.has("feuillets-timeline-title")).map((el) => el.text), ["A", "B"]);
});

test("un parser invalide conserve le fallback milestone historique", async () => {
  const source = file("Recherche/Chronology.md", "1700");
  const contents = new Map([[source.path, "## Événement valide\n### 1755\nTexte\n\n## Événement invalide"]]);
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context([folder("Recherche", [source])], contents));
  assert.deepEqual(findAll(container, (el) => el.classes.has("feuillets-timeline-title")).map((el) => el.text), ["Chronology"]);
});

test("les racines imbriquées sont dédupliquées et coexistent avec un milestone réel", async () => {
  const chronology = file("Recherche/Chronology.md", "");
  const normal = file("Recherche/Événement.md", "1754");
  const nested = folder("Recherche/Sous", [chronology]);
  const research = folder("Recherche", [normal, nested]);
  const contents = new Map([[chronology.path, virtualSource("A", "1755")]]);
  const container = new FakeElement();
  await renderBoardTimeline(container, folder("Manuscrit"), context([research, nested], contents));
  assert.deepEqual(findAll(container, (el) => el.classes.has("feuillets-timeline-title")).map((el) => el.text), ["Événement", "A"]);
});

test("les tags du conteneur filtrent toutes ses entrées et gardent la date naturelle", async () => {
  const source = file("Recherche/Chronologie.md", "");
  source.__tags = ["guerre"];
  const contents = new Map([[source.path, virtualSource("A", "1er novembre 1755 à 9 h 30")]]);
  const research = folder("Recherche", [source]);
  const ctx = context([research], contents);
  ctx.settings.timelineTagFilter = "guerre";
  const matching = new FakeElement();
  await renderBoardTimeline(matching, folder("Manuscrit"), ctx);
  assert.equal(findAll(matching, (el) => el.classes.has("feuillets-timeline-title"))[0].text, "A");
  assert.equal(findAll(matching, (el) => el.classes.has("feuillets-timeline-date-display"))[0].text, "1er novembre 1755 à 9 h 30");
  ctx.settings.timelineTagFilter = "politique";
  const hidden = new FakeElement();
  await renderBoardTimeline(hidden, folder("Manuscrit"), ctx);
  assert.equal(findAll(hidden, (el) => el.classes.has("feuillets-timeline-title")).length, 0);
});
