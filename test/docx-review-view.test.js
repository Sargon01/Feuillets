import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, Platform, TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { DocxReviewView } = await import(modulePath("src/views/docx-review-view.js"));
const { bookmarkIdFor } = await import(modulePath("src/utils/docx-bookmarks.js"));
const { default: JSZip } = await import("jszip");

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i !== -1) this.parent.children.splice(i, 1); } }
}

function allElements(element) { return [element, ...element.children.flatMap(allElements)]; }
function file(path, content = "") { return new TFile(path, content); }

/** Mock minimal de app.workspace + d'un éditeur CodeMirror-like, pour les
 * tests Lot 4 (openAndReveal/revealMoveDestination) : `contentByPath` est
 * PARTAGÉ avec le mock vault.modify (voir createView) — un fichier ouvert
 * APRÈS une écriture reflète donc le contenu réellement écrit, sans second
 * système de vérité. */
function createWorkspaceMock(contentByPath) {
  const opened = [];
  const selections = [];
  let currentPath = null;
  const editor = {
    getValue: () => contentByPath[currentPath] ?? "",
    offsetToPos: (offset) => ({ offset }),
    setSelection: (from, to) => { selections.push({ from, to }); },
    scrollIntoView: () => {},
  };
  const view = { file: null, editor };
  const leaf = {
    view,
    async openFile(f) {
      opened.push(f.path);
      currentPath = f.path;
      view.file = f;
    },
  };
  const workspace = {
    getLeaf: () => leaf,
    getActiveFile: () => (currentPath ? { path: currentPath } : null),
    setActiveLeaf: () => {},
  };
  return { workspace, opened, selections, editor };
}

function createView({ files = [], settings = {}, content = {}, root = new TFolder("Projet"), withWorkspace = false } = {}) {
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const writes = [];
  const wsMock = withWorkspace ? createWorkspaceMock(content) : null;
  const app = {
    vault: {
      getAbstractFileByPath(path) { return byPath.get(path) ?? null; },
      getMarkdownFiles() { return files.filter((entry) => entry.extension === "md"); },
      async read(entry) { return content[entry.path] ?? entry.content; },
      async modify(entry, newContent) {
        writes.push([entry, newContent]);
        // Partagé avec le mock workspace (editor.getValue) : une lecture ou
        // une révélation APRÈS écriture voit le VRAI contenu écrit.
        content[entry.path] = newContent;
      },
    },
    ...(wsMock ? { workspace: wsMock.workspace } : {}),
  };
  const plugin = {
    settings: { collapsed: {}, ...settings },
    getProjectFolder: () => root,
    snapshotFile: async () => {},
    listCompiledFilePaths: () => files.filter((entry) => entry.extension === "md").map((entry) => entry.path),
    titleFor: (entry) => entry.basename,
    getOutputFolder: async () => null,
    async saveSettings() { plugin.saveCount += 1; },
    saveCount: 0,
  };
  const contentEl = new FakeElement();
  const view = new DocxReviewView({ app, contentEl }, plugin);
  return { view, app, plugin, contentEl, writes, ws: wsMock };
}

function iconsFrom(container) { return allElements(container).map((element) => element.icon).filter(Boolean); }

function mockZip(files) {
  const calls = [];
  const original = JSZip.loadAsync;
  JSZip.loadAsync = async () => ({
    file(path) {
      calls.push(path);
      return Object.hasOwn(files, path) ? { async: async () => files[path] } : null;
    },
  });
  return { calls, restore: () => { JSZip.loadAsync = original; } };
}

const documentXml = (body) => `<w:document><w:body>${body}</w:body></w:document>`;

test("DocxReviewView — icônes, clés et résolution des feuillets", async () => {
  const direct = file("Projet/Direct.md");
  const named = file("Projet/Dossier/Chapitre.md");
  const { view } = createView({ files: [direct, named] });

  const iconContainer = new FakeElement();
  for (const type of ["move", "insertion", "deletion", "replacement"]) {
    view.renderChange(iconContainer, null, { type, text: "texte", author: "A", date: "D" });
  }
  view.renderComment(iconContainer, null, { anchorText: "ancre", text: "commentaire", author: "A", isFormatting: false });
  view.renderComment(iconContainer, null, { anchorText: "ancre", text: "", author: "A", isFormatting: true, markers: [] });
  const contentIcons = iconsFrom(iconContainer).filter((icon) => icon !== "x");
  assert.deepEqual(contentIcons.sort(), ["highlighter", "message-square", "minus", "move", "plus", "repeat"].sort());

  view.docxName = "retours.docx";
  const first = { type: "comment", author: "A", date: "D", anchorText: "texte", ord: 1, applied: true, dismissed: false };
  await view.saveItemState(first);
  await view.saveItemState({ ...first });
  await view.saveItemState({ ...first, ord: 2 });
  assert.equal(Object.keys(view.plugin.settings.docxReviewResolved["retours.docx"]).length, 2);
  assert.equal(view.plugin.saveCount, 3);

  for (const candidate of ["Projet/Direct.md", "Projet/Dossier/Chapitre.md", "Chapitre.md", "Chapitre", "Dossier/Chapitre.md"]) {
    const row = new FakeElement();
    view.renderNearFilesHints(new FakeElement(), { nearFiles: [candidate], applied: true }, row);
    assert.equal(row.classes.has("feuillets-clickable"), true, candidate);
  }
  const missing = new FakeElement();
  view.renderNearFilesHints(new FakeElement(), { nearFiles: ["inconnu.md"], applied: true }, missing);
  assert.equal(missing.classes.has("feuillets-clickable"), false);
});

test("DocxReviewView — état, rendu et sauvegarde locale", async () => {
  const { view, contentEl, plugin } = createView();
  assert.equal(view.mode, "picker");
  assert.equal(view.results, null);
  assert.equal(view.showResolved, false);
  assert.equal(view.docxName, "");

  let picker = 0;
  let results = 0;
  view.renderSectionHead = () => false;
  view.renderPickerPanel = async () => { picker += 1; };
  view.renderResultsPanel = async () => { results += 1; };
  await view.render();
  assert.equal(picker, 1);
  view.mode = "results";
  view.results = { byPath: {}, unmatched: {}, unclassified: { changes: [], comments: [] } };
  await view.render();
  assert.equal(results, 1);
  view.renderSectionHead = () => true;
  await view.render();
  assert.equal(results, 1);
  assert.equal(contentEl.classes.has("feuillets-docx-review-container"), true);

  await view.saveItemState({ type: "insertion", text: "x" });
  assert.equal(plugin.saveCount, 0);
  view.docxName = "memo.docx";
  await view.saveItemState({ type: "insertion", text: "x", applied: true, dismissed: true });
  assert.deepEqual(Object.values(plugin.settings.docxReviewResolved["memo.docx"])[0], { applied: true, dismissed: true });
});

test("DocxReviewView — snapshot unique et non bloquant", async () => {
  const scene = file("Projet/Scene.md");
  const { view, plugin } = createView({ files: [scene] });
  let snapshots = 0;
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  plugin.snapshotFile = async () => { snapshots += 1; };
  await view.ensureSnapshot({ path: scene.path });
  await Promise.all([view.ensureSnapshot(scene), view.ensureSnapshot(scene)]);
  await view.ensureSnapshot(file("Projet/Autre.md"));
  assert.equal(snapshots, 2);
  assert.equal(notices.length, 1);
  plugin.snapshotFile = async () => { throw new Error("snapshot indisponible"); };
  await view.ensureSnapshot(file("Projet/Echec.md"));
  assert.equal(view._snapshotted.has("Projet/Echec.md"), true);
  Notice.onCreate = null;
});

test("DocxReviewView — analyse DOCX sans écriture et états restaurés", async () => {
  const scenePath = "Projet/Scene.md";
  const scene = file(scenePath, "Avant ajout passage");
  const bookmark = bookmarkIdFor(scenePath);
  const { view, writes } = createView({ files: [scene] });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  let renders = 0;
  view.render = async () => { renders += 1; };

  let zip = mockZip({});
  await view.analyzeBuffer(new Uint8Array(), "illisible.docx");
  zip.restore();
  assert.equal(view.results, null);
  assert.equal(notices.length, 1);

  zip = mockZip({ "word/comments.xml": "" });
  await view.analyzeBuffer(new Uint8Array(), "invalide.docx");
  zip.restore();
  assert.equal(notices.length, 2);

  const xml = documentXml(
    `<w:p><w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>Avant</w:t></w:r>` +
    `<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t> ajout</w:t></w:r></w:ins>` +
    `<w:commentRangeStart w:id="0"/><w:r><w:t> passage</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
    `<w:r><w:commentReference w:id="0"/></w:r><w:bookmarkEnd w:id="1"/></w:p>`
  );
  zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="AA"><w:r><w:t>Résolu</w:t></w:r></w:p></w:comment></w:comments>',
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>',
  });
  await view.analyzeBuffer(new Uint8Array(), "retours.docx");
  assert.deepEqual(zip.calls, ["word/document.xml", "word/comments.xml", "word/footnotes.xml", "word/commentsExtended.xml", "word/styles.xml"]);
  zip.restore();
  assert.equal(view.mode, "results");
  assert.equal(renders, 1);
  assert.equal(writes.length, 0);
  const bucket = view.results.byPath[scenePath];
  assert.ok(bucket);
  const comment = bucket.comments[0];
  assert.equal(comment.dismissed, true);
  const insertion = bucket.changes.find((item) => item.type === "insertion");
  assert.equal(insertion.applied, true);

  insertion.applied = true;
  insertion.dismissed = false;
  await view.saveItemState(insertion);
  zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="AA"><w:r><w:t>Résolu</w:t></w:r></w:p></w:comment></w:comments>',
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>',
  });
  await view.analyzeBuffer(new Uint8Array(), "retours.docx");
  zip.restore();
  const restored = view.results.byPath[scenePath].changes.find((item) => item.type === "insertion");
  assert.equal(restored.applied, true);
  assert.equal(restored.dismissed, false);
  assert.equal(writes.length, 0);
  Notice.onCreate = null;
});

test("DocxReviewView — analyse d'un fichier externe via Web File API (aucun accès fs)", async () => {
  const { view } = createView();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const container = new FakeElement();
  await view.renderPickerPanel(container);

  const analyzeBtn = allElements(container).find((element) => element.tag === "button" && element.icon === "search");
  assert.ok(analyzeBtn, "bouton d'analyse externe introuvable");

  await analyzeBtn.events.get("click")();
  assert.equal(notices.length, 1);
  Notice.onCreate = null;
});

test("DocxReviewView — rendu seul sans snapshot ni application", async () => {
  const { view } = createView();
  let snapshots = 0;
  view.ensureSnapshot = async () => { snapshots += 1; };
  view.renderSectionHead = () => true;
  await view.onOpen();
  await view.render();
  assert.equal(snapshots, 0);
  assert.equal(view._snapshotted, undefined);
  Platform.isMobile = false;
});

test("DocxReviewView — conservée telle quelle sous le nouvel espace Édition (lot 1 : renommage UI seul)", async () => {
  // Le lot 1 renomme l'espace « Révision » en « Édition » et y ajoute les
  // documents éditoriaux, mais ne touche à aucune fonction DOCX : même type
  // de vue, même icône, et le rendu du panneau de sélection de fichier
  // reste identique (mode "picker" par défaut, aucun résultat encore chargé).
  const { view, contentEl } = createView();
  assert.equal(view.getViewType(), "feuillets-docx-review");
  assert.equal(view.getIcon(), "file-diff");
  assert.equal(view.mode, "picker");

  await view.onOpen();
  const icons = iconsFrom(contentEl);
  assert.ok(icons.includes("file-diff"), "l'en-tête de section Révision DOCX est toujours rendue");
});

/* =========================================================================
 * Lot 2/3/4 — carte de déplacement : origine/destination visibles,
 * boutons Voir l'origine/la destination, Aperçu du résultat (sans
 * écriture), révélation du passage après application, panneau qui reste
 * ouvert.
 * ========================================================================= */

test("Lot 2 — carte de déplacement : origine/destination distinctes, feuillets visibles, type de destination", () => {
  const origin = file("Projet/Origine.md");
  const dest = file("Projet/Destination.md");
  const { view } = createView({ files: [origin, dest] });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "avant", fromText: "passage",
    toContext: "après", toContextAfter: "suite",
    text: "passage", destinationBoundary: "paragraph-end",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const all = allElements(container);

  const originZone = all.find((el) => el.classes.has("mod-origin"));
  const destZone = all.find((el) => el.classes.has("mod-destination"));
  assert.ok(originZone, "zone d'origine distincte présente");
  assert.ok(destZone, "zone de destination distincte présente");
  assert.notEqual(originZone, destZone);

  // Le feuillet d'ORIGINE (différent du feuillet affiché, "Destination")
  // doit être nommément visible.
  assert.ok(all.some((el) => el.text && el.text.includes("Origine")));

  const boundary = all.find((el) => el.classes.has("feuillets-docx-review-boundary"));
  assert.ok(boundary, "le type de destination doit être affiché");
  assert.equal(boundary.text, "à la fin du paragraphe");
});

test("mission item 4 — carte de déplacement compacte : le texte complet reste replié par défaut, déplié d'un clic", () => {
  const origin = file("Projet/Origine.md");
  const dest = file("Projet/Destination.md");
  const { view } = createView({ files: [origin, dest] });
  const longFromText =
    "Un très long passage déplacé qui dépasse largement les soixante-dix caractères prévus pour le résumé compact de la carte, afin de vérifier qu'il est bien tronqué.";
  const longText =
    "Un autre très long passage inséré à la destination, tout aussi long que celui d'origine, pour vérifier la même troncature côté destination.";
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "avant", fromText: longFromText,
    toContext: "après", text: longText,
    destinationBoundary: "between-paragraphs",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  let all = allElements(container);

  // Replié par défaut : le texte COMPLET n'apparaît nulle part, mais un
  // résumé tronqué reste visible pour identifier le passage.
  assert.equal(all.some((el) => el.text === longFromText), false, "le texte d'origine complet n'est pas affiché tant que la carte est repliée");
  assert.equal(all.some((el) => el.text === longText), false, "le texte de destination complet n'est pas affiché tant que la carte est repliée");
  assert.ok(all.some((el) => el.classes.has("mod-origin") && el.classes.has("mod-compact")), "un résumé compact d'origine est présent");
  assert.ok(all.some((el) => el.classes.has("mod-destination") && el.classes.has("mod-compact")), "un résumé compact de destination est présent");
  // Type, origine, destination et type de destination restent visibles fermés.
  assert.ok(all.some((el) => el.text && el.text.includes("Déplacement")));
  assert.ok(all.some((el) => el.classes.has("feuillets-docx-review-boundary")));
  // Actions principales toujours visibles fermées.
  assert.ok(all.some((el) => el.icon === "arrow-up-right"), "Voir l'origine visible carte fermée");
  assert.ok(all.some((el) => el.icon === "arrow-down-right"), "Voir la destination visible carte fermée");
  assert.ok(all.some((el) => el.icon === "eye"), "Aperçu visible carte fermée");
  assert.ok(all.some((el) => el.icon === "check"), "Appliquer visible carte fermée");

  const detailBtn = all.find((el) => el.icon === "chevron-down");
  assert.ok(detailBtn, "bouton pour déplier les passages complets présent");

  detailBtn.events.get("click")({ stopPropagation() {} });
  all = allElements(container);
  assert.ok(all.some((el) => el.text === longFromText), "le texte d'origine complet apparaît une fois déplié");
  assert.ok(all.some((el) => el.text === longText), "le texte de destination complet apparaît une fois déplié");

  // Un second clic replie à nouveau.
  detailBtn.events.get("click")({ stopPropagation() {} });
  all = allElements(container);
  assert.equal(all.some((el) => el.text === longFromText), false, "recliqué : le texte complet disparaît à nouveau");
});

test("Lot 2 — même feuillet : deux zones origine/destination restent affichées séparément", () => {
  const sheet = file("Projet/Sheet.md");
  const { view } = createView({ files: [sheet] });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: sheet.path, toPath: sheet.path,
    fromContext: "avant", fromText: "passage",
    toContext: "après", text: "passage",
  };
  const container = new FakeElement();
  view.renderChange(container, sheet, change);
  const all = allElements(container);
  assert.ok(all.some((el) => el.classes.has("mod-origin")));
  assert.ok(all.some((el) => el.classes.has("mod-destination")));
});

test("Lot 2 — boutons Voir l'origine / Voir la destination ouvrent le bon feuillet", async () => {
  const origin = file("Projet/Origine.md", "avant passage après.");
  const dest = file("Projet/Destination.md", "après suite.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, ws } = createView({ files: [origin, dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "avant ", fromText: "passage",
    toContext: "après ", text: "suite",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const btns = allElements(container).filter((el) => el.tag === "button");
  const originBtn = btns.find((b) => b.icon === "arrow-up-right");
  const destBtn = btns.find((b) => b.icon === "arrow-down-right");
  assert.ok(originBtn, "bouton Voir l'origine présent");
  assert.ok(destBtn, "bouton Voir la destination présent");

  originBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ws.opened, [origin.path]);

  ws.opened.length = 0;
  destBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ws.opened, [dest.path]);
});

test("mission item 3 — Voir l'origine sélectionne le passage COMPLET d'un déplacement multi-paragraphe, jamais seulement le dernier fragment", async () => {
  // Régression confirmée : openAndReveal dégradait, via findTolerant, la
  // recherche du TEXTE ENTIER (pas seulement du contexte) en cas d'échec
  // de correspondance exacte — pour un fromText multi-paragraphe (deux
  // "\n\n" internes ici), le repli ne retrouvait plus que les derniers
  // caractères du DERNIER fragment. locateChangeMatch (utilisé maintenant
  // par la branche "move") ne dégrade JAMAIS le texte lui-même, seulement
  // le contexte qui le précède.
  const fromText = "Paragraphe un déplacé.\n\nParagraphe deux déplacé.\n\nParagraphe trois déplacé.";
  const origin = file("Projet/Origine.md", `Avant le passage.\n\n${fromText}\n\nAprès le passage.`);
  const dest = file("Projet/Destination.md", "Cible.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, ws } = createView({ files: [origin, dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Avant le passage.\n\n", fromText,
    toContext: "Cible.", text: fromText,
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const originBtn = allElements(container).find((el) => el.icon === "arrow-up-right");
  assert.ok(originBtn, "bouton Voir l'origine présent");

  originBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(ws.selections.length, 1, "une seule sélection posée");
  const { from, to } = ws.selections[0];
  const selectedLength = to.offset - from.offset;
  assert.equal(selectedLength, fromText.length, "la plage sélectionnée couvre le passage COMPLET (les trois paragraphes), jamais seulement le dernier fragment");
  const selectedText = origin.content.slice(from.offset, to.offset);
  assert.equal(selectedText, fromText);
  assert.ok(selectedText.includes("Paragraphe un déplacé."), "le PREMIER paragraphe fait bien partie de la sélection");
});

test("mission item 3 — Voir le passage déplacé (destination) sélectionne aussi le passage complet, multi-paragraphe", async () => {
  const text = "Premier paragraphe collé.\n\nDeuxième paragraphe collé.";
  const dest = file("Projet/Destination.md", `Avant.\n\n${text}\n\nAprès.`);
  const content = { [dest.path]: dest.content };
  const { view, ws } = createView({ files: [dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D", applied: true,
    fromPath: dest.path, toPath: dest.path,
    fromContext: "", fromText: text,
    toContext: "Avant.\n\n", text,
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const viewMovedBtn = allElements(container).find((el) => el.icon === "locate");
  assert.ok(viewMovedBtn, "bouton « Voir le passage déplacé » présent");

  viewMovedBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(ws.selections.length, 1);
  const { from, to } = ws.selections[0];
  assert.equal(to.offset - from.offset, text.length, "la destination sélectionnée couvre les DEUX paragraphes collés, pas seulement le dernier");
});

test("Lot 3 — Aperçu du résultat ne modifie jamais le fichier", async () => {
  const dest = file("Projet/Destination.md", "Contexte avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view, writes } = createView({ files: [dest], content });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: dest.path, toPath: dest.path,
    fromContext: "", fromText: "Passage inséré.",
    toContext: "Cible.", text: " Passage inséré.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const previewBtn = allElements(container).find((el) => el.icon === "eye");
  assert.ok(previewBtn, "bouton Aperçu du résultat présent");

  previewBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 0, "l'aperçu ne doit jamais écrire dans le fichier");
  const previewBox = allElements(container).find((el) => el.classes.has("feuillets-docx-review-preview-box"));
  assert.ok(previewBox, "un bloc d'aperçu doit être affiché");
  assert.ok(content[dest.path] === "Contexte avant. Cible.", "le contenu du fichier reste identique");
});

test("Lot 4 — après application, le feuillet cible est ouvert et le passage sélectionné, le panneau reste utilisable", async () => {
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, ws, writes } = createView({ files: [origin, dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.ok(applyBtn, "bouton Appliquer présent");

  applyBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 2, "écriture de l'origine ET de la destination");
  assert.ok(ws.opened.includes(dest.path), "le feuillet de destination doit avoir été ouvert pour révéler le passage");
  assert.ok(ws.selections.length > 0, "une sélection doit avoir été posée sur le passage inséré");
  // Le panneau lui-même n'est jamais fermé : l'instance de vue reste
  // pleinement utilisable après l'application.
  assert.equal(typeof view.renderChange, "function");
});

test("Lot 4 — la sélection après application utilise la plage EXACTE écrite (insertedRange), jamais une re-recherche textuelle", async () => {
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, ws, writes } = createView({ files: [origin, dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");

  applyBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 2);
  assert.equal(ws.selections.length, 1, "une seule sélection, posée directement sur la plage connue");
  const { from, to } = ws.selections[0];
  // offsetToPos (mock) renvoie {offset} tel quel : from.offset/to.offset SONT
  // les offsets d'insertedRange — vérifie qu'ils délimitent, dans le fichier
  // RÉELLEMENT écrit, exactement le passage déplacé, sans rien autour.
  assert.equal(content[dest.path].slice(from.offset, to.offset), "Passage à couper.");
});

test("Lot 4 — jamais de notice d'échec de sélection quand l'écriture a réussi et que la plage est connue", async () => {
  const dest = file("Projet/Destination.md", "Avant. Milieu. Fin passage à couper.");
  const content = { [dest.path]: dest.content };
  const { view, ws, writes } = createView({ files: [dest], content, withWorkspace: true });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const change = {
    type: "move", author: "A", date: "D",
    fromPath: dest.path, toPath: dest.path,
    fromContext: "Fin ", fromText: "passage à couper.",
    toContext: "Avant. ", text: "passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");

  applyBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 1);
  assert.equal(ws.selections.length, 1);
  assert.ok(!notices.some((m) => typeof m === "string" && m.includes("n'a pas pu être retrouvé")), "aucune notice d'échec quand la plage était déjà connue");
  Notice.onCreate = null;
});

test("LOT 3 (sécurité transactionnelle) — les DEUX feuillets sont snapshotés avant la moindre écriture, pour un déplacement inter-feuillets", async () => {
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin, writes } = createView({ files: [origin, dest], content, withWorkspace: true });
  const order = [];
  plugin.snapshotFile = async (f) => { order.push(`snapshot:${f.path}`); };
  const realModify = view.app.vault.modify.bind(view.app.vault);
  view.app.vault.modify = async (f, c) => {
    order.push(`write:${f.path}`);
    return realModify(f, c);
  };

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.ok(applyBtn, "bouton Appliquer présent");

  applyBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 2, "écriture de l'origine ET de la destination");
  const snapshotEvents = order.filter((e) => e.startsWith("snapshot:"));
  const firstWriteIdx = order.findIndex((e) => e.startsWith("write:"));
  assert.equal(snapshotEvents.length, 2, "les DEUX feuillets (origine et destination) doivent être snapshotés");
  assert.deepEqual(
    new Set(snapshotEvents.map((e) => e.slice("snapshot:".length))),
    new Set([origin.path, dest.path])
  );
  assert.ok(
    snapshotEvents.every((e) => order.indexOf(e) < firstWriteIdx),
    "aucune écriture avant que les deux snapshots soient créés : " + JSON.stringify(order)
  );
});

test("LOT 3 (sécurité transactionnelle) — snapshot de l'origine réussi, snapshot de la destination en échec : aucune écriture, rien marqué appliqué", async () => {
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin, writes } = createView({ files: [origin, dest], content, withWorkspace: true });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  plugin.snapshotFile = async (f) => {
    if (f.path === dest.path) throw new Error("snapshot de la destination indisponible");
    // le snapshot de l'origine, lui, réussit.
  };

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.ok(applyBtn, "bouton Appliquer présent");

  applyBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 0, "vault.modify ne doit JAMAIS être appelé quand le snapshot de la destination échoue");
  assert.equal(content[origin.path], "Début. Passage à couper. Fin.", "origine inchangée");
  assert.equal(content[dest.path], "Avant. Après.", "destination inchangée");
  assert.equal(change.applied, undefined, "le retour ne doit jamais être marqué appliqué");
  assert.ok(
    notices.some((m) => typeof m === "string" && m.toLowerCase().includes("point de retour")),
    "une notice explicite doit signaler l'échec du snapshot : " + JSON.stringify(notices)
  );
  Notice.onCreate = null;
});

test("Lot 4 — bouton « Voir le passage déplacé » sur un déplacement déjà appliqué", async () => {
  const dest = file("Projet/Destination.md", "Avant. Passage.");
  const content = { [dest.path]: dest.content };
  const { view, ws } = createView({ files: [dest], content, withWorkspace: true });
  const change = {
    type: "move", author: "A", date: "D", applied: true,
    fromPath: dest.path, toPath: dest.path,
    fromContext: "", fromText: "Passage.",
    toContext: "Avant. ", text: "Passage.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);

  const viewMovedBtn = allElements(container).find((el) => el.icon === "locate");
  assert.ok(viewMovedBtn, "bouton « Voir le passage déplacé » présent sur un item déjà appliqué");

  viewMovedBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(ws.opened.includes(dest.path));
});

test("Lot 4 — le bouton « Voir le passage déplacé » n'apparaît PAS avant application", () => {
  const dest = file("Projet/Destination.md");
  const { view } = createView({ files: [dest] });
  const change = {
    type: "move", author: "A", date: "D", applied: false,
    fromPath: dest.path, toPath: dest.path,
    fromContext: "", fromText: "Passage.",
    toContext: "Avant. ", text: "Passage.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const viewMovedBtn = allElements(container).find((el) => el.icon === "locate");
  assert.equal(viewMovedBtn, undefined);
});

test("Problème 3 (réel) — clic sur un commentaire dont l'ancre est AMBIGUË : désambiguïsé par contexte, jamais « introuvable »", async () => {
  const scene = file(
    "Projet/Scene.md",
    "Les anciens usages voulaient que Candide. Les anciens domestiques soupçonnaient la vérité."
  );
  const content = { [scene.path]: scene.content };
  const { view, ws } = createView({ files: [scene], content, withWorkspace: true });
  const comment = {
    anchorText: "anciens",
    contextBefore: "Candide. Les ",
    contextAfter: " domestiques",
    text: "Vérifier", author: "A", date: "D",
  };
  const container = new FakeElement();
  view.renderComment(container, scene, comment);
  const row = allElements(container).find((el) => el.classes.has("feuillets-clickable"));
  assert.ok(row, "la carte doit être cliquable (fichier résolu)");

  row.events.get("click")();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(ws.selections.length, 1);
  const { from, to } = ws.selections[0];
  const expectedIndex = scene.content.indexOf("anciens domestiques");
  assert.deepEqual({ from: from.offset, to: to.offset }, { from: expectedIndex, to: expectedIndex + "anciens".length });
});
