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
const { DiffModal } = await import(modulePath("src/ui/diff-modal.js"));
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
  // LOT 9B — écritures BINAIRES (createBinary/modifyBinary), distinctes des
  // écritures Markdown ci-dessus (`writes`) : le générateur de DOCX révisé
  // n'écrit JAMAIS dans `content`/`writes`, seulement ici.
  const binaryWrites = [];
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
      async createBinary(path, buf) {
        binaryWrites.push({ path, buf, mode: "create" });
        const created = file(path);
        byPath.set(path, created);
        return created;
      },
      async modifyBinary(entry, buf) {
        binaryWrites.push({ path: entry.path, buf, mode: "modify" });
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
  return { view, app, plugin, contentEl, writes, binaryWrites, ws: wsMock };
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
  // "check-circle" (Marquer comme traité) et "x" (Refuser) sont deux icônes
  // VOLONTAIREMENT distinctes (mission FINITION UX §7, IMPORTANT) — filtrées
  // ici, hors sujet de cette assertion (types/icônes de TYPE de retour).
  const contentIcons = iconsFrom(iconContainer).filter((icon) => icon !== "x" && icon !== "check-circle");
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
  assert.ok(all.some((el) => el.icon === "search"), "Aperçu visible carte fermée");
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
  const previewBtn = allElements(container).find((el) => el.icon === "search");
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

/* =========================================================================
 * LOT 4 — statuts de confiance ("Sûr"/"À vérifier"/"Ambigu") : badge discret
 * + blocage de l'application directe pour un élément Ambigu. La vue ne
 * recalcule jamais elle-même la confiance dans ces tests (confidence posée
 * directement sur l'objet change, comme le ferait analyzeBuffer) — seul le
 * RENDU/la gestion des actions selon ce statut est testée ici.
 * ========================================================================= */
test("LOT 4 (confiance) — badge Sûr/À vérifier/Ambigu affiché selon change.confidence", async () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view } = createView({ files: [dest], content });
  const base = {
    type: "insertion", author: "A", date: "D",
    contextBefore: "Cible.", text: " Ajout.",
  };

  for (const [confidence, expectedLabel] of [
    ["safe", "Sûr"],
    ["review", "À vérifier"],
    ["ambiguous", "Ambigu"],
  ]) {
    const container = new FakeElement();
    view.renderChange(container, dest, { ...base, confidence });
    const badge = allElements(container).find((el) => el.classes.has("feuillets-docx-review-section-badge") && el.classes.has(`mod-confidence-${confidence}`));
    assert.ok(badge, `badge mod-confidence-${confidence} doit être rendu`);
    assert.equal(badge.text, expectedLabel);
  }

  // Sans confidence (analyse antérieure à ce lot, état restauré) : aucun badge de confiance.
  const containerNone = new FakeElement();
  view.renderChange(containerNone, dest, { ...base });
  assert.equal(allElements(containerNone).some((el) => el.classes.has("feuillets-docx-review-section-badge")), false);
});

test("LOT 4 (confiance) — un élément Ambigu n'affiche JAMAIS de bouton Appliquer (aucune écriture automatique possible)", async () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view, writes } = createView({ files: [dest], content });
  const change = {
    type: "insertion", author: "A", date: "D",
    contextBefore: "Cible.", text: " Ajout.",
    confidence: "ambiguous",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);

  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.equal(applyBtn, undefined, "aucun bouton Appliquer pour un élément confidence:\"ambiguous\"");
  assert.equal(writes.length, 0);

  // Un item "safe" (ou sans confidence connue), lui, garde son bouton.
  const containerSafe = new FakeElement();
  view.renderChange(containerSafe, dest, { ...change, confidence: "safe" });
  assert.ok(allElements(containerSafe).find((el) => el.icon === "check"), "un élément \"safe\" garde son bouton Appliquer");
});

test("LOT 4 (correctif) — un élément À vérifier présente Examiner comme action PRINCIPALE, jamais une présentation identique à Sûr", async () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view, writes } = createView({ files: [dest], content });
  const change = {
    type: "insertion", author: "A", date: "D",
    contextBefore: "Cible.", text: " Ajout.",
    confidence: "review",
  };

  // 1. Un item simple (non-déplacement) "review" a un bouton Examiner
  //    (icône "search", convention FINITION UX §7 — "eye" est réservé à
  //    Voir), absent d'un item "safe" — la présentation n'est jamais
  //    identique. Un "safe", lui, garde son bouton Voir ("eye").
  const containerSafe = new FakeElement();
  view.renderChange(containerSafe, dest, { ...change, confidence: "safe" });
  assert.equal(allElements(containerSafe).some((el) => el.icon === "search"), false, "un élément \"safe\" n'a aucun bouton Examiner");
  assert.ok(allElements(containerSafe).some((el) => el.icon === "eye"), "un élément \"safe\" garde son bouton Voir");

  const containerReview = new FakeElement();
  view.renderChange(containerReview, dest, change);
  const elements = allElements(containerReview);
  const examineBtn = elements.find((el) => el.icon === "search");
  const acceptBtn = elements.find((el) => el.icon === "check");
  assert.ok(examineBtn, "bouton Examiner présent pour un élément \"review\"");
  assert.ok(acceptBtn, "l'utilisateur doit ensuite pouvoir accepter volontairement l'opération");
  assert.ok(elements.indexOf(examineBtn) < elements.indexOf(acceptBtn), "Examiner doit être l'action PRINCIPALE, rendue avant Accepter");

  // 2. Cliquer Examiner ne modifie jamais le fichier.
  examineBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0, "Examiner ne doit jamais écrire dans le fichier");
  assert.equal(content[dest.path], "Avant. Cible.", "contenu inchangé après Examiner");

  // 3. L'acceptation volontaire (Accepter), elle, applique bien la modification.
  acceptBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 1, "Accepter applique réellement la modification");
  assert.equal(change.applied, true);

  // 4. Un déplacement "review" garde EXACTEMENT le même nombre de boutons
  //    "search" (Examiner) qu'un déplacement "safe" (previewBtn déjà
  //    existant, jamais dupliqué) : seul le bouton d'acceptation lui-même
  //    en tient compte.
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest2 = file("Projet/Destination2.md", "Avant. Après.");
  const content2 = { [origin.path]: origin.content, [dest2.path]: dest2.content };
  const { view: view2 } = createView({ files: [origin, dest2], content: content2, withWorkspace: true });
  const moveChange = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest2.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const containerMoveSafe = new FakeElement();
  view2.renderChange(containerMoveSafe, dest2, { ...moveChange, confidence: "safe" });
  const containerMoveReview = new FakeElement();
  view2.renderChange(containerMoveReview, dest2, { ...moveChange, confidence: "review" });
  const eyeCountSafe = allElements(containerMoveSafe).filter((el) => el.icon === "search").length;
  const eyeCountReview = allElements(containerMoveReview).filter((el) => el.icon === "search").length;
  assert.equal(eyeCountReview, eyeCountSafe, "un déplacement a déjà son action Examiner (previewBtn) : jamais un doublon pour \"review\"");
  assert.ok(allElements(containerMoveReview).find((el) => el.icon === "check"), "l'acceptation volontaire reste possible pour un déplacement \"review\"");
});

test("LOT 4 (confiance) — retour non rattaché à un feuillet (chemin non résolu) : seulement examiner, jamais appliquer directement", async () => {
  const candidate = file("Projet/Candidat.md", "Un passage candidat ici.");
  const content = { [candidate.path]: candidate.content };
  const { view, writes } = createView({ files: [candidate], content, withWorkspace: true });
  const item = {
    type: "insertion", author: "A", date: "D",
    contextBefore: "candidat ", text: "AJOUT ",
    nearFiles: [candidate.path],
    confidence: "ambiguous",
    confidenceReasons: ["unresolved-path"],
  };
  const header = new FakeElement();
  view.renderNearFilesHints(header, item);

  const applyBtn = allElements(header).find((el) => el.icon === "check");
  assert.equal(applyBtn, undefined, "jamais de bouton d'application directe pour un chemin non résolu");
  const examineBtn = allElements(header).find((el) => el.icon === "search");
  assert.ok(examineBtn, "un bouton d'examen (ouvrir/révéler, sans écrire) doit rester disponible");

  examineBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0, "examiner un candidat ne doit jamais écrire dans le fichier");
});

test("LOT 4 (confiance) — analyzeBuffer calcule réellement confidence pour un retour pas encore appliqué (bout en bout)", async () => {
  const scenePath = "Projet/SceneConfiance.md";
  const scene = file(scenePath, "Avant. Rien d'ajouté ici.");
  const bookmark = bookmarkIdFor(scenePath);
  const { view } = createView({ files: [scene] });
  view.render = async () => {};

  const xml = documentXml(
    `<w:p><w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>Avant. </w:t></w:r>` +
    `<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>Un ajout inédit.</w:t></w:r></w:ins>` +
    `<w:bookmarkEnd w:id="1"/></w:p>`
  );
  const zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": "",
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": "",
  });
  await view.analyzeBuffer(new Uint8Array(), "confiance.docx");
  zip.restore();

  const insertion = view.results.byPath[scenePath].changes.find((c) => c.type === "insertion");
  assert.ok(insertion, "l'insertion doit être présente");
  assert.equal(insertion.applied, undefined, "pas encore présente dans le feuillet : pas déjà appliquée");
  assert.equal(insertion.confidence, "safe");
  assert.deepEqual(insertion.confidenceReasons, ["exact-match"]);
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

/* =========================================================================
 * LOT 5 — refonte UX du panneau : file de décisions éditoriales plate
 * (renderResultsPanel), filtres, navigation, compteurs. renderChange/
 * renderComment restent testés directement plus haut (icônes, actions par
 * confiance) : ici, seulement ce qui les ENTOURE dans le panneau.
 * ========================================================================= */

/** Construit un `results` minimal (byPath/unmatched/unclassified) avec des
 * `ord` explicites, sans passer par analyzeBuffer/le parsing XML — ord posé
 * ici comme le ferait parseDocumentXml#stamp (ordinal de document). */
function makeResults(byPath = {}, unmatched = {}, unclassified = { changes: [], comments: [] }) {
  return { byPath, unmatched, unclassified };
}

test("LOT 5 — compteurs actif/résolu portent sur la file entière, tous feuillets confondus", async () => {
  const sceneA = file("Projet/A.md", "Contenu A.");
  const sceneB = file("Projet/B.md", "Contenu B.");
  const { view, contentEl } = createView({ files: [sceneA, sceneB] });
  view.mode = "results";
  view.results = makeResults({
    [sceneA.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Contenu", text: " X.", ord: 0 },
        { type: "insertion", author: "A", date: "D", contextBefore: "Contenu", text: " Y.", ord: 1, applied: true, dismissed: true },
      ],
      comments: [],
    },
    [sceneB.path]: {
      changes: [{ type: "deletion", author: "A", date: "D", contextBefore: "Contenu", text: " B.", ord: 2, dismissed: true }],
      comments: [],
    },
  });
  await view.render();
  const texts = allElements(contentEl).map((el) => el.text).filter(Boolean);
  assert.ok(texts.some((t) => t.includes("1") && t.includes("à traiter")), "1 seul retour actif attendu : " + JSON.stringify(texts));
  assert.ok(texts.some((t) => t.includes("1") && t.includes("résolu")), "1 retour résolu attendu : " + JSON.stringify(texts));
  assert.ok(texts.some((t) => t.includes("1") && t.includes("masqué")), "1 retour masqué attendu : " + JSON.stringify(texts));
});

test("LOT 5 — filtres Tous/Corrections/Déplacements/Commentaires/À vérifier réduisent bien la file affichée", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte.");
  const { view } = createView({ files: [scene] });
  view.mode = "results";
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " ajouté", ord: 0, confidence: "safe" },
        { type: "move", author: "A", date: "D", fromPath: scene.path, toPath: scene.path, fromContext: "", fromText: "ici", toContext: "pour", text: "ici", ord: 1, confidence: "safe" },
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " incertain", ord: 2, confidence: "review" },
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " flou", ord: 3, confidence: "ambiguous" },
      ],
      comments: [{ anchorText: "texte", text: "Vérifier ce mot", author: "A", date: "D", ord: 4 }],
    },
  });

  const countCards = async (filter) => {
    view.activeFilter = filter;
    view.queueIndex = 0;
    const container = new FakeElement();
    await view.renderResultsPanel(container);
    return allElements(container).filter((el) => el.classes.has("feuillets-docx-review-row")).length;
  };

  assert.equal(await countCards("all"), 5, "Tous : les 5 retours (4 changements + 1 commentaire)");
  assert.equal(await countCards("corrections"), 3, "Corrections : les 3 insertions (safe/review/ambiguous), jamais le déplacement ni le commentaire");
  assert.equal(await countCards("moves"), 1, "Déplacements : uniquement le move");
  assert.equal(await countCards("comments"), 1, "Commentaires : uniquement le commentaire");
  assert.equal(await countCards("review"), 2, "À vérifier : review + ambiguous regroupés");

  // Cliquer un onglet change bien le filtre actif et remet la position à 0.
  view.queueIndex = 2;
  view.activeFilter = "all";
  const panel = new FakeElement();
  await view.renderResultsPanel(panel);
  // Le libellé complet et le libellé compact ("Dépl.") vivent tous deux
  // dans le DOM (le CSS, jamais évalué par ces tests, choisit lequel
  // afficher selon la largeur réelle du panneau — voir styles.css).
  const movesTab = allElements(panel).find(
    (el) => el.tag === "button" && el.classes.has("feuillets-docx-review-filter-btn") &&
      el.children.some((c) => c.text === "Déplacements")
  );
  assert.ok(movesTab, "onglet Déplacements présent");
  movesTab.events.get("click")();
  assert.equal(view.activeFilter, "moves");
  assert.equal(view.queueIndex, 0, "changer de filtre remet la position à 0");
});

test("LOT 5 — corrections regroupe insertion/suppression/remplacement, jamais les déplacements ni les commentaires", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " ajouté", ord: 0 },
        { type: "deletion", author: "A", date: "D", contextBefore: "Un", text: "texte", ord: 1 },
        { type: "replacement", author: "A", date: "D", contextBefore: "Un", oldText: "texte", newText: "mot", ord: 2 },
        { type: "move", author: "A", date: "D", fromPath: scene.path, toPath: scene.path, fromContext: "", fromText: "ici", toContext: "texte", text: "ici", ord: 3 },
      ],
      comments: [{ anchorText: "texte", text: "?", author: "A", date: "D", ord: 4 }],
    },
  });
  const container = new FakeElement();
  view.activeFilter = "corrections";
  await view.renderResultsPanel(container);
  const cards = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-row"));
  assert.equal(cards.length, 3, "insertion + suppression + remplacement, jamais le déplacement ni le commentaire");
});

test("LOT 5 — navigation Précédent/Suivant porte sur la liste FILTRÉE et reste dans les bornes", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0 },
        { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1 },
        { type: "insertion", author: "A", date: "D", contextBefore: "contexte", text: " trois", ord: 2 },
      ],
      comments: [],
    },
  });
  view.activeFilter = "all";
  view.queueIndex = 0;

  const container1 = new FakeElement();
  await view.renderResultsPanel(container1);
  const counter1 = allElements(container1).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter1.text, "1 / 3");

  const next1 = allElements(container1).find((el) => el.icon === "chevron-right");
  next1.events.get("click")();
  assert.equal(view.queueIndex, 1);

  const container2 = new FakeElement();
  await view.renderResultsPanel(container2);
  const counter2 = allElements(container2).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter2.text, "2 / 3");

  // Ne dépasse jamais la fin de la liste. Repositionnement direct de
  // queueIndex (hors du mécanisme Précédent/Suivant) : activeItemKey doit
  // être réaligné, sinon resolveCurrentIndex retrouverait encore l'ANCIENNE
  // carte active (identité prioritaire, voir mission §2) et ignorerait ce
  // repositionnement manuel.
  view.queueIndex = 2;
  view.activeItemKey = null;
  const container3 = new FakeElement();
  await view.renderResultsPanel(container3);
  const next3 = allElements(container3).find((el) => el.icon === "chevron-right");
  next3.events.get("click")();
  assert.equal(view.queueIndex, 2, "déjà au dernier élément : Suivant ne dépasse pas la fin");

  // Ne descend jamais sous le début.
  view.queueIndex = 0;
  view.activeItemKey = null;
  const container4 = new FakeElement();
  await view.renderResultsPanel(container4);
  const prev4 = allElements(container4).find((el) => el.icon === "chevron-left");
  prev4.events.get("click")();
  assert.equal(view.queueIndex, 0, "déjà au premier élément : Précédent ne descend pas sous 0");
});

test("LOT 5 — position cohérente après traitement d'une carte : jamais un saut au début de la file", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const content = { [scene.path]: scene.content };
  const { view, writes } = createView({ files: [scene], content });
  const changes = [
    { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "contexte", text: " trois", ord: 2, confidence: "safe" },
  ];
  view.results = makeResults({ [scene.path]: { changes, comments: [] } });
  view.activeFilter = "all";
  view.queueIndex = 1; // positionné sur le second élément

  const container = new FakeElement();
  await view.renderResultsPanel(container);
  const cards = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-row"));
  const secondCard = cards[1];
  const dismissBtn = allElements(secondCard).find((el) => el.icon === "x");
  assert.ok(dismissBtn, "bouton Refuser présent sur la carte courante");
  dismissBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(writes.length, 0, "Refuser ne modifie jamais le Markdown");
  assert.equal(changes[1].dismissed, true, "la carte traitée est bien marquée refusée/traitée");

  // Sans showResolved, la file filtrée passe de 3 à 2 éléments — la position
  // reste ramenée DANS les bornes de cette nouvelle liste, jamais renvoyée
  // au tout début (queueIndex=1 encore valide ici : 2 éléments restants).
  assert.equal(view.queueIndex, 1, "queueIndex inchangé par le traitement lui-même");
  const container2 = new FakeElement();
  await view.renderResultsPanel(container2);
  const counter2 = allElements(container2).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter2.text, "2 / 2", "position ramenée dans les bornes de la liste réduite, jamais au début");
});

test("LOT 5 — les retours résolus restent consultables via « Afficher les retours résolus »", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, applied: true, dismissed: true },
      ],
      comments: [],
    },
  });
  view.showResolved = false;
  const containerHidden = new FakeElement();
  await view.renderResultsPanel(containerHidden);
  assert.equal(allElements(containerHidden).some((el) => el.classes.has("feuillets-docx-review-row")), false, "masqué par défaut");

  view.showResolved = true;
  const containerShown = new FakeElement();
  await view.renderResultsPanel(containerShown);
  const card = allElements(containerShown).find((el) => el.classes.has("feuillets-docx-review-row"));
  assert.ok(card, "le retour résolu reste consultable via Afficher les retours résolus");
  const badge = allElements(card).find((el) => el.classes.has("feuillets-docx-review-section-badge") && el.classes.has("mod-resolved"));
  assert.ok(badge, "badge « Appliqué » visible sur un retour résolu consulté");
  assert.equal(badge.text, "Appliqué");
});

test("LOT 5 — un commentaire n'affiche jamais Accepter/Refuser, seulement Voir + Marquer comme traité", async () => {
  const scene = file("Projet/Scene.md", "Un mot ici.");
  const { view } = createView({ files: [scene] });
  const comment = { anchorText: "mot", text: "Vérifier cette formulation.", author: "A", date: "D" };
  const container = new FakeElement();
  view.renderComment(container, scene, comment);
  const all = allElements(container);
  const checkBtn = all.find((el) => el.icon === "check");
  assert.equal(checkBtn, undefined, "jamais de bouton Accepter pour un commentaire");
  // "check-circle" (Marquer comme traité), JAMAIS "x" (Refuser) — mission
  // FINITION UX §7, IMPORTANT : les deux actions ne partagent pas la
  // même croix.
  const dismissBtn = all.find((el) => el.icon === "check-circle");
  assert.ok(dismissBtn, "bouton Marquer comme traité (check-circle) présent");
  assert.equal(all.some((el) => el.icon === "x"), false, "un commentaire n'a jamais l'icône Refuser (x)");
  const row = all.find((el) => el.classes.has("feuillets-clickable"));
  assert.ok(row, "Voir le passage : la carte entière ouvre/révèle le passage (fichier résolu)");
});

test("LOT 5 — emplacement toujours visible : nom du feuillet pour une correction, origine → destination pour un déplacement", () => {
  const origin = file("Projet/Chapitre 2.md");
  const dest = file("Projet/Chapitre 5.md");
  const { view } = createView({ files: [origin, dest] });

  const containerChange = new FakeElement();
  view.renderChange(containerChange, dest, { type: "insertion", author: "A", date: "D", contextBefore: "x", text: "y" });
  const locationChange = allElements(containerChange).find((el) => el.classes.has("feuillets-docx-review-location"));
  assert.ok(locationChange, "ligne d'emplacement présente pour une correction simple");
  assert.equal(locationChange.text, dest.basename);

  const containerMove = new FakeElement();
  view.renderChange(containerMove, dest, {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "", fromText: "x", toContext: "", text: "x",
  });
  const locationMove = allElements(containerMove).find((el) => el.classes.has("feuillets-docx-review-location"));
  assert.ok(locationMove, "ligne d'emplacement présente pour un déplacement");
  assert.equal(locationMove.text, `${origin.basename} → ${dest.basename}`);
});

test("LOT 5 — Ambigu affiche désormais Examiner (pas de bouton Accepter) même pour un item simple", async () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view, writes } = createView({ files: [dest], content });
  const change = {
    type: "insertion", author: "A", date: "D",
    contextBefore: "Cible.", text: " Ajout.",
    confidence: "ambiguous", confidenceReasons: ["multiple-matches"],
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  const examineBtn = allElements(container).find((el) => el.icon === "search");
  assert.ok(examineBtn, "bouton Examiner présent pour un item ambigu");
  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.equal(applyBtn, undefined, "toujours aucun bouton Accepter pour Ambigu");

  examineBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0, "Examiner un item ambigu n'écrit jamais");
  const whyText = allElements(container).find((el) => el.classes.has("feuillets-docx-review-preview-text") && el.text.includes("plusieurs endroits"));
  assert.ok(whyText, "le motif « Pourquoi Ambigu ? » (multiple-matches) est affiché dans les détails");
});

function getFullText(el) {
  return allElements(el).map((e) => e.text).filter(Boolean).join(" ");
}

test("LOT 5 Finition UX — 1. Actions principales explicites textuelles (safe, review, ambiguous)", () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const { view } = createView({ files: [dest] });

  // Safe: Voir, Accepter, Refuser
  const containerSafe = new FakeElement();
  view.renderChange(containerSafe, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "safe" });
  const safeElements = allElements(containerSafe);
  // FINITION UX (mission §7) — convention d'icônes : Voir = "eye", Examiner
  // = "search" (jamais l'inverse, jamais une icône de document générique).
  const viewBtnSafe = safeElements.find((el) => el.icon === "eye");
  const acceptBtnSafe = safeElements.find((el) => el.icon === "check");
  const rejectBtnSafe = safeElements.find((el) => el.icon === "x");
  assert.ok(viewBtnSafe && getFullText(viewBtnSafe).includes("Voir"), "bouton Voir présent pour safe");
  assert.ok(acceptBtnSafe && getFullText(acceptBtnSafe).includes("Accepter"), "bouton Accepter présent pour safe");
  assert.ok(rejectBtnSafe && getFullText(rejectBtnSafe).includes("Refuser"), "bouton Refuser présent pour safe");

  // Review: Examiner, Accepter, Refuser
  const containerReview = new FakeElement();
  view.renderChange(containerReview, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "review" });
  const reviewElements = allElements(containerReview);
  const examineBtnReview = reviewElements.find((el) => el.icon === "search");
  const acceptBtnReview = reviewElements.find((el) => el.icon === "check");
  const rejectBtnReview = reviewElements.find((el) => el.icon === "x");
  assert.ok(examineBtnReview && getFullText(examineBtnReview).includes("Examiner"), "bouton Examiner présent pour review");
  assert.ok(acceptBtnReview && getFullText(acceptBtnReview).includes("Accepter"), "bouton Accepter présent pour review");
  assert.ok(rejectBtnReview && getFullText(rejectBtnReview).includes("Refuser"), "bouton Refuser présent pour review");

  // Ambiguous: Examiner, Refuser (JAMAIS Accepter)
  const containerAmbiguous = new FakeElement();
  view.renderChange(containerAmbiguous, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "ambiguous" });
  const ambElements = allElements(containerAmbiguous);
  const examineBtnAmb = ambElements.find((el) => el.icon === "search");
  const acceptBtnAmb = ambElements.find((el) => el.icon === "check");
  const rejectBtnAmb = ambElements.find((el) => el.icon === "x");
  assert.ok(examineBtnAmb && getFullText(examineBtnAmb).includes("Examiner"), "bouton Examiner présent pour ambiguous");
  assert.equal(acceptBtnAmb, undefined, "bouton Accepter STRICTEMENT ABSENT pour ambiguous");
  assert.ok(rejectBtnAmb && getFullText(rejectBtnAmb).includes("Refuser"), "bouton Refuser présent pour ambiguous");
});

test("LOT 5 Finition UX — 2. Commentaires : boutons explicites Voir le passage et Marquer comme traité", () => {
  const scene = file("Projet/Scene.md", "Un mot ici.");
  const { view } = createView({ files: [scene] });
  const comment = { anchorText: "mot", text: "Remarque.", author: "A", date: "D" };
  const container = new FakeElement();
  view.renderComment(container, scene, comment);
  const elements = allElements(container);

  const viewBtn = elements.find((el) => el.icon === "eye");
  const dismissBtn = elements.find((el) => el.icon === "check-circle");
  assert.ok(viewBtn && getFullText(viewBtn).includes("Voir le passage"), "bouton Voir le passage présent");
  assert.ok(dismissBtn && getFullText(dismissBtn).includes("Marquer comme traité"), "bouton Marquer comme traité présent");
  assert.equal(elements.find((el) => el.icon === "check"), undefined, "un commentaire n'affiche jamais Accepter");
  assert.equal(elements.find((el) => el.icon === "x"), undefined, "un commentaire n'affiche jamais Refuser (icône x réservée au Refuser d'un changement)");
});

test("LOT 5 Finition UX — 3 & 4. En-tête : actions globales explicites et compteurs en français naturel sans (s)", async () => {
  const scene = file("Projet/Scene.md", "Formulation.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { id: "c1", type: "insertion", text: "a", applied: false, dismissed: false },
        { id: "c2", type: "deletion", text: "b", applied: true, dismissed: true },
      ],
      comments: [
        { id: "cm1", text: "note", dismissed: true },
      ],
    },
  });

  const container = new FakeElement();
  await view.renderResultsPanel(container);
  const elements = allElements(container);

  // Vérification de la numération des compteurs
  const sub = elements.find((el) => el.classes.has("feuillets-notes-sub"));
  assert.ok(sub, "sous-titre compteurs présent");
  assert.ok(sub.text.includes("1 à traiter"), "compteur à traiter au singulier");
  assert.ok(sub.text.includes("1 résolu"), "compteur résolu au singulier");
  assert.ok(sub.text.includes("1 masqué"), "compteur masqué affiché si > 0");

  // Vérification des actions globales explicites
  const toolbar = elements.find((el) => el.classes.has("feuillets-docx-review-toolbar"));
  assert.ok(toolbar, "barre d'actions globales présente");
  const toggleBtn = allElements(toolbar).find((el) => el.icon === "eye" || el.icon === "eye-off");
  const dismissAllBtn = allElements(toolbar).find((el) => el.icon === "check-check");
  assert.ok(toggleBtn && (getFullText(toggleBtn).includes("Masquer les résolus") || getFullText(toggleBtn).includes("Afficher les résolus")), "bouton bascule résolus explicite");
  assert.ok(dismissAllBtn && getFullText(dismissAllBtn).includes("Tout marquer résolu"), "bouton tout marquer résolu explicite");
});

test("LOT 5 Responsive — structure verticale de la carte : zone d'actions dédiée sous le contenu principal", () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const { view } = createView({ files: [dest] });

  const container = new FakeElement();
  view.renderChange(container, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "safe" });
  
  const row = allElements(container).find((el) => el.classes.has("feuillets-docx-review-row"));
  assert.ok(row, "ligne de carte présente");
  const actionsZone = allElements(row).find((el) => el.classes.has("feuillets-docx-review-card-actions"));
  assert.ok(actionsZone, "zone d'actions dédiée présente sous le contenu principal");
  
  const acceptBtn = allElements(actionsZone).find((el) => el.icon === "check");
  assert.ok(acceptBtn, "bouton Accepter logé dans la zone d'actions dédiée (ne partage pas la largeur du texte)");
});

test("LOT 5 Responsive — actions textuelles pour déplacements (review et ambiguous)", () => {
  const origin = file("Projet/Origine.md", "Avant. Déplacement. Après.");
  const dest = file("Projet/Destination.md", "Cible.");
  const { view } = createView({ files: [origin, dest] });

  // Move review : Examiner, Accepter, Refuser
  const containerReview = new FakeElement();
  view.renderChange(containerReview, dest, {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Avant. ", fromText: "Déplacement.",
    toContext: "Cible.", text: "Déplacement.",
    confidence: "review",
  });
  const revActions = allElements(containerReview).find((el) => el.classes.has("feuillets-docx-review-card-actions"));
  assert.ok(revActions, "zone d'actions présente pour déplacement review");
  const examineBtnRev = allElements(revActions).find((el) => el.icon === "search");
  const acceptBtnRev = allElements(revActions).find((el) => el.icon === "check");
  const rejectBtnRev = allElements(revActions).find((el) => el.icon === "x");
  assert.ok(examineBtnRev && getFullText(examineBtnRev).includes("Examiner"), "déplacement review a Examiner");
  assert.ok(acceptBtnRev && getFullText(acceptBtnRev).includes("Accepter"), "déplacement review a Accepter");
  assert.ok(rejectBtnRev && getFullText(rejectBtnRev).includes("Refuser"), "déplacement review a Refuser");

  // Move ambiguous : Examiner, Refuser (STRICTEMENT PAS Accepter)
  const containerAmb = new FakeElement();
  view.renderChange(containerAmb, dest, {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Avant. ", fromText: "Déplacement.",
    toContext: "Cible.", text: "Déplacement.",
    confidence: "ambiguous",
  });
  const ambActions = allElements(containerAmb).find((el) => el.classes.has("feuillets-docx-review-card-actions"));
  const examineBtnAmb = allElements(ambActions).find((el) => el.icon === "search");
  const acceptBtnAmb = allElements(ambActions).find((el) => el.icon === "check");
  const rejectBtnAmb = allElements(ambActions).find((el) => el.icon === "x");
  assert.ok(examineBtnAmb && getFullText(examineBtnAmb).includes("Examiner"), "déplacement ambiguous a Examiner");
  assert.equal(acceptBtnAmb, undefined, "déplacement ambiguous n'a JAMAIS de bouton Accepter");
  assert.ok(rejectBtnAmb && getFullText(rejectBtnAmb).includes("Refuser"), "déplacement ambiguous a Refuser");
});

/* =========================================================================
 * CORRECTIF (largeur par défaut + focus de navigation) — la carte active
 * (classe `mod-current`) doit TOUJOURS correspondre à l'index affiché par
 * le compteur "N / total", quels que soient Précédent/Suivant, un
 * changement de filtre ou le traitement d'une carte (active ou non).
 * ========================================================================= */

function activeCardOf(container) {
  const cardWraps = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-card-wrap"));
  const currentCards = cardWraps.filter((el) => el.classes.has("mod-current"));
  return { cardWraps, currentCards };
}

function threeInsertionsResults(scene) {
  return {
    byPath: {
      [scene.path]: {
        changes: [
          { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, confidence: "safe" },
          { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1, confidence: "safe" },
          { type: "insertion", author: "A", date: "D", contextBefore: "contexte", text: " trois", ord: 2, confidence: "safe" },
        ],
        comments: [],
      },
    },
    unmatched: {},
    unclassified: { changes: [], comments: [] },
  };
}

test("CORRECTIF — Suivant : la carte active passe de la 1ère à la 2e, une SEULE carte active à la fois", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const { view } = createView({ files: [scene] });
  view.results = threeInsertionsResults(scene);

  const container1 = new FakeElement();
  await view.renderResultsPanel(container1);
  const before = activeCardOf(container1);
  assert.equal(before.currentCards.length, 1, "une seule carte active au départ");
  assert.equal(before.cardWraps.indexOf(before.currentCards[0]), 0, "la 1ère carte est active par défaut");

  const next = allElements(container1).find((el) => el.icon === "chevron-right");
  next.events.get("click")();
  assert.equal(view.queueIndex, 1, "activeIndex passe de 0 à 1");

  const container2 = new FakeElement();
  await view.renderResultsPanel(container2);
  const after = activeCardOf(container2);
  assert.equal(after.currentCards.length, 1, "toujours une SEULE carte active après Suivant");
  assert.equal(after.cardWraps.indexOf(after.currentCards[0]), 1, "c'est bien la 2e carte qui devient active, pas la 1ère");
  const counter = allElements(container2).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter.text, "2 / 3", "le compteur et la carte active désignent la même carte");
});

test("CORRECTIF — Précédent : revient à la bonne carte (jamais la première par défaut)", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const { view } = createView({ files: [scene] });
  view.results = threeInsertionsResults(scene);

  const c1 = new FakeElement();
  await view.renderResultsPanel(c1);
  allElements(c1).find((el) => el.icon === "chevron-right").events.get("click")(); // -> index 1
  const c2 = new FakeElement();
  await view.renderResultsPanel(c2);
  allElements(c2).find((el) => el.icon === "chevron-right").events.get("click")(); // -> index 2
  assert.equal(view.queueIndex, 2);

  const c3 = new FakeElement();
  await view.renderResultsPanel(c3);
  allElements(c3).find((el) => el.icon === "chevron-left").events.get("click")(); // -> index 1
  assert.equal(view.queueIndex, 1, "Précédent revient à l'index 1, pas à 0");

  const c4 = new FakeElement();
  await view.renderResultsPanel(c4);
  const { cardWraps, currentCards } = activeCardOf(c4);
  assert.equal(currentCards.length, 1);
  assert.equal(cardWraps.indexOf(currentCards[0]), 1, "la carte active correspond bien à l'index 1, pas à la première carte");
});

test("CORRECTIF — changement de filtre : compteur et carte active restent synchronisés (identité conservée si possible)", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, confidence: "safe" },
        { type: "move", author: "A", date: "D", fromPath: scene.path, toPath: scene.path, fromContext: "", fromText: "ici", toContext: "pour", text: "ici", ord: 1, confidence: "safe" },
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " deux", ord: 2, confidence: "safe" },
      ],
      comments: [],
    },
  });

  // Position initiale sur la carte "moves" (index 1 en filtre "all").
  const c1 = new FakeElement();
  await view.renderResultsPanel(c1);
  allElements(c1).find((el) => el.icon === "chevron-right").events.get("click")();
  const c2 = new FakeElement();
  await view.renderResultsPanel(c2);
  const active2 = activeCardOf(c2);
  assert.ok(allElements(active2.currentCards[0]).some((el) => el.text && el.text.includes("Déplacement")), "la carte active est bien le déplacement");

  // Changer de filtre vers "moves" : la MÊME carte (même identité) doit
  // rester active — mission §2, "si l'ancienne carte existe encore dans la
  // nouvelle liste, conserver sa position".
  view.activeFilter = "moves";
  view.queueIndex = 0; // repli, ignoré si l'identité est retrouvée
  const c3 = new FakeElement();
  await view.renderResultsPanel(c3);
  const counter3 = allElements(c3).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter3.text, "1 / 1", "un seul déplacement dans ce filtre");
  const active3 = activeCardOf(c3);
  assert.equal(active3.currentCards.length, 1);
  assert.ok(allElements(active3.currentCards[0]).some((el) => el.text && el.text.includes("Déplacement")), "la même carte (le déplacement) reste active après le changement de filtre");

  // Changer vers "comments" (liste totalement différente, aucun commentaire
  // ici) : pas de carte candidate — vérifié séparément par le message vide,
  // pas de crash.
});

test("CORRECTIF — traiter la carte active la fait disparaître : la carte qui prend sa place devient active", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const content = { [scene.path]: scene.content };
  const { view, writes } = createView({ files: [scene], content });
  const changes = [
    { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "contexte", text: " trois", ord: 2, confidence: "safe" },
  ];
  view.results = makeResults({ [scene.path]: { changes, comments: [] } });

  // Se positionner sur la 1ère carte (déjà active par défaut) et la refuser.
  const c1 = new FakeElement();
  await view.renderResultsPanel(c1);
  const firstCard = activeCardOf(c1).currentCards[0];
  const dismissBtn = allElements(firstCard).find((el) => el.icon === "x");
  dismissBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0, "Refuser ne modifie jamais le Markdown");
  assert.equal(changes[0].dismissed, true);

  // La carte qui PREND LA PLACE de la 1ère (celle qui était en 2e position,
  // "deux") doit devenir active — jamais un saut arbitraire ailleurs.
  const c2 = new FakeElement();
  await view.renderResultsPanel(c2);
  const active2 = activeCardOf(c2);
  assert.equal(active2.currentCards.length, 1, "une seule carte active");
  assert.ok(getFullText(active2.currentCards[0]).includes("deux"), "la carte 'deux' (qui prend la place de la carte traitée) devient active");
  const counter2 = allElements(c2).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter2.text, "1 / 2", "position cohérente : toujours en tête de la file réduite");
});

test("CORRECTIF — traiter la DERNIÈRE carte de la file : la carte précédente devient active", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte général.");
  const content = { [scene.path]: scene.content };
  const { view, writes } = createView({ files: [scene], content });
  const changes = [
    { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1, confidence: "safe" },
    { type: "insertion", author: "A", date: "D", contextBefore: "contexte", text: " trois", ord: 2, confidence: "safe" },
  ];
  view.results = makeResults({ [scene.path]: { changes, comments: [] } });

  // Se positionner sur la DERNIÈRE carte ("trois") et la refuser.
  const c1 = new FakeElement();
  await view.renderResultsPanel(c1);
  allElements(c1).find((el) => el.icon === "chevron-right").events.get("click")();
  const c2 = new FakeElement();
  await view.renderResultsPanel(c2);
  allElements(c2).find((el) => el.icon === "chevron-right").events.get("click")();
  const c3 = new FakeElement();
  await view.renderResultsPanel(c3);
  const lastCard = activeCardOf(c3).currentCards[0];
  assert.ok(getFullText(lastCard).includes("trois"), "positionné sur la dernière carte avant de la traiter");
  const dismissBtn = allElements(lastCard).find((el) => el.icon === "x");
  dismissBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0);

  const c4 = new FakeElement();
  await view.renderResultsPanel(c4);
  const active4 = activeCardOf(c4);
  assert.equal(active4.currentCards.length, 1, "une seule carte active");
  assert.ok(getFullText(active4.currentCards[0]).includes("deux"), "la carte PRÉCÉDENTE ('deux') devient active, jamais un retour à la première");
  const counter4 = allElements(c4).find((el) => el.classes.has("feuillets-docx-review-nav-counter"));
  assert.equal(counter4.text, "2 / 2", "position cohérente sur la nouvelle dernière carte");
});

test("CORRECTIF — aucune régression des handlers Voir/Accepter/Refuser/Examiner après la refonte de la carte active", async () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const content = { [dest.path]: dest.content };
  const { view, writes } = createView({ files: [dest], content, withWorkspace: true });

  // Accepter (safe) écrit toujours via le chemin transactionnel existant.
  const containerSafe = new FakeElement();
  const safeChange = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "safe" };
  view.renderChange(containerSafe, dest, safeChange);
  const acceptBtn = allElements(containerSafe).find((el) => el.icon === "check");
  assert.ok(acceptBtn, "bouton Accepter toujours présent pour un item safe");
  acceptBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 1, "Accepter applique toujours réellement la modification");
  assert.equal(safeChange.applied, true);

  // Refuser ne modifie jamais le Markdown.
  const containerReview = new FakeElement();
  const reviewChange = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Autre.", confidence: "review" };
  view.renderChange(containerReview, dest, reviewChange);
  const examineBtn = allElements(containerReview).find((el) => el.icon === "search");
  assert.ok(examineBtn, "bouton Examiner toujours présent pour un item review");
  examineBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 1, "Examiner n'écrit jamais");
  const rejectBtn = allElements(containerReview).find((el) => el.icon === "x");
  rejectBtn.events.get("click")({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 1, "Refuser ne modifie jamais le Markdown");
  assert.equal(reviewChange.dismissed, true);

  // Voir (clic sur la carte) ouvre toujours le bon feuillet.
  const containerView = new FakeElement();
  view.renderChange(containerView, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Voir." });
  const row = allElements(containerView).find((el) => el.classes.has("feuillets-clickable"));
  assert.ok(row, "la carte reste cliquable (Voir)");
});

test("CORRECTIF — les filtres portent deux libellés (compact + complet) permettant un choix responsive en CSS", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({ [scene.path]: { changes: [], comments: [] } });
  const container = new FakeElement();
  await view.renderResultsPanel(container);

  const filterBtns = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-filter-btn"));
  assert.equal(filterBtns.length, 5, "les 5 filtres sont bien rendus");

  const correctionsBtn = filterBtns.find((btn) => allElements(btn).some((el) => el.text === "Modifications"));
  assert.ok(correctionsBtn, "le libellé complet 'Modifications' est présent dans le DOM");
  const fullSpan = allElements(correctionsBtn).find((el) => el.classes.has("feuillets-docx-review-filter-full"));
  const compactSpan = allElements(correctionsBtn).find((el) => el.classes.has("feuillets-docx-review-filter-compact"));
  assert.ok(fullSpan, "span du libellé complet présent (affiché en CSS à largeur suffisante)");
  assert.ok(compactSpan, "span du libellé compact présent (affiché en CSS à largeur d'ouverture normale)");
  assert.equal(fullSpan.text, "Modifications");
  assert.equal(compactSpan.text, "Modifs", "le libellé compact est bien plus court, pas une simple troncature ellipsis, et n'est plus « Corr. »");
  assert.notEqual(compactSpan.text, fullSpan.text, "compact et complet diffèrent réellement pour les libellés trop longs");
});

/* =========================================================================
 * FINITION UX — bandeau de contrôle sticky unique, types de carte courts,
 * convention d'icônes cohérente, actions dans leur conteneur dédié.
 * ========================================================================= */

test("FINITION UX — pager (Précédent/N-total/Suivant) vit dans le MÊME bloc que filtres/actions globales, une SEULE zone sticky", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici pour le contexte.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({
    [scene.path]: {
      changes: [
        { type: "insertion", author: "A", date: "D", contextBefore: "Un texte", text: " un", ord: 0 },
        { type: "insertion", author: "A", date: "D", contextBefore: "ici", text: " deux", ord: 1 },
      ],
      comments: [],
    },
  });
  const container = new FakeElement();
  await view.renderResultsPanel(container);

  // Une SEULE zone sticky de contrôle.
  const stickyBars = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-sticky-bar"));
  assert.equal(stickyBars.length, 1, "une seule zone sticky de contrôle dans le panneau");
  const stickyBar = stickyBars[0];

  // Titre/compteur, filtres, actions globales ET navigation sont tous DANS
  // cette même zone (mission FINITION UX §1) — jamais des composants
  // séparés qui pourraient défiler indépendamment les uns des autres.
  const inSticky = allElements(stickyBar);
  assert.ok(inSticky.some((el) => el.classes.has("feuillets-docx-review-filters")), "filtres dans le bloc sticky");
  assert.ok(inSticky.some((el) => el.classes.has("feuillets-docx-review-toolbar")), "actions globales dans le bloc sticky");
  assert.ok(inSticky.some((el) => el.classes.has("feuillets-docx-review-nav")), "navigation (pager) dans le bloc sticky");
  assert.ok(inSticky.some((el) => el.classes.has("feuillets-docx-review-nav-counter")), "compteur N/total dans le bloc sticky");

  // La pile de cartes, elle, reste EN DEHORS du bloc sticky (c'est elle qui
  // défile, pas le bandeau de contrôle).
  const queueList = allElements(container).find((el) => el.classes.has("feuillets-docx-review-queue"));
  assert.ok(queueList, "la file de cartes est présente");
  assert.equal(allElements(stickyBar).includes(queueList), false, "la pile de cartes n'est PAS dans le bloc sticky");
});

test("FINITION UX — plus aucun sticky concurrent : le bandeau global n'utilise plus la classe partagée feuillets-research-toolbar", async () => {
  const scene = file("Projet/Scene.md", "Un texte ici.");
  const { view } = createView({ files: [scene] });
  view.results = makeResults({ [scene.path]: { changes: [], comments: [] } });
  const container = new FakeElement();
  await view.renderResultsPanel(container);
  const toolbar = allElements(container).find((el) => el.classes.has("feuillets-docx-review-toolbar"));
  assert.ok(toolbar, "barre d'actions globales présente");
  assert.equal(
    toolbar.classes.has("feuillets-research-toolbar"),
    false,
    "la classe partagée feuillets-research-toolbar (qui porte son PROPRE sticky ailleurs dans l'app) n'est plus utilisée ici — un seul sticky, celui du bloc de contrôle"
  );
});

test("FINITION UX — types de carte courts (Ajout/Suppression/Remplacement/Déplacement/Mise en forme/Commentaire), jamais « proposé »", () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const origin = file("Projet/Origine.md", "Origine.");
  const { view } = createView({ files: [dest, origin] });

  const labelOf = (kind, extra) => {
    const container = new FakeElement();
    if (kind === "change") view.renderChange(container, dest, extra);
    else view.renderComment(container, dest, extra);
    const metaEl = allElements(container).find((el) => el.classes.has("feuillets-docx-review-meta"));
    return metaEl.text;
  };

  assert.equal(labelOf("change", { type: "insertion", author: "A", date: "D", text: "x" }), "Ajout");
  assert.equal(labelOf("change", { type: "deletion", author: "A", date: "D", text: "x" }), "Suppression");
  assert.equal(labelOf("change", { type: "replacement", author: "A", date: "D", oldText: "x", newText: "y" }), "Remplacement");
  assert.equal(
    labelOf("change", { type: "move", author: "A", date: "D", fromPath: origin.path, toPath: dest.path, fromContext: "", fromText: "x", toContext: "", text: "x" }),
    "Déplacement"
  );
  assert.equal(labelOf("comment", { anchorText: "x", author: "A", date: "D", isFormatting: true, markers: [] }), "Mise en forme");
  assert.equal(labelOf("comment", { anchorText: "x", author: "A", date: "D", text: "y" }), "Commentaire");

  for (const label of ["Ajout", "Suppression", "Remplacement"]) {
    assert.ok(!label.includes("proposé"), `« ${label} » ne doit plus contenir « proposé »`);
  }
});

test("FINITION UX — convention d'icônes : UNE icône = UN sens dans tout le panneau", () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const origin = file("Projet/Origine.md", "Début. Passage. Fin.");
  const { view } = createView({ files: [dest, origin] });

  // Voir (safe, item simple) -> eye ; Accepter -> check ; Refuser -> x.
  const containerSafe = new FakeElement();
  view.renderChange(containerSafe, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " x", confidence: "safe" });
  const safeEls = allElements(containerSafe);
  assert.ok(safeEls.some((el) => el.icon === "eye"), "Voir -> eye");
  assert.ok(safeEls.some((el) => el.icon === "check"), "Accepter -> check");
  assert.ok(safeEls.some((el) => el.icon === "x"), "Refuser -> x");

  // Examiner (review) -> search, jamais eye.
  const containerReview = new FakeElement();
  view.renderChange(containerReview, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " x", confidence: "review" });
  assert.ok(allElements(containerReview).some((el) => el.icon === "search"), "Examiner -> search");

  // Déplacement : Voir origine -> arrow-up-right, Voir destination -> arrow-down-right, Déplacement (type) -> move.
  const containerMove = new FakeElement();
  const moveChange = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage.",
    toContext: "Avant. ", text: "Passage.",
  };
  view.renderChange(containerMove, dest, moveChange);
  const moveEls = allElements(containerMove);
  assert.ok(moveEls.some((el) => el.icon === "arrow-up-right"), "Voir l'origine -> arrow-up-right");
  assert.ok(moveEls.some((el) => el.icon === "arrow-down-right"), "Voir la destination -> arrow-down-right");
  assert.ok(moveEls.some((el) => el.icon === "move"), "Type Déplacement -> move");

  // Commentaire : Marquer comme traité -> check-circle (jamais x), Rétablir -> rotate-ccw une fois traité.
  const containerComment = new FakeElement();
  const comment = { anchorText: "x", author: "A", date: "D", text: "note" };
  view.renderComment(containerComment, dest, comment);
  assert.ok(allElements(containerComment).some((el) => el.icon === "check-circle"), "Marquer comme traité -> check-circle");
  assert.equal(allElements(containerComment).some((el) => el.icon === "x"), false, "jamais l'icône x (Refuser) sur un commentaire");

  const containerCommentDone = new FakeElement();
  view.renderComment(containerCommentDone, dest, { ...comment, dismissed: true });
  assert.ok(allElements(containerCommentDone).some((el) => el.icon === "rotate-ccw"), "Rétablir -> rotate-ccw");

  // Mise en forme : icône de type -> highlighter.
  const containerFormatting = new FakeElement();
  view.renderComment(containerFormatting, dest, { anchorText: "x", author: "A", date: "D", isFormatting: true, markers: [] });
  assert.ok(allElements(containerFormatting).some((el) => el.icon === "highlighter"), "Mise en forme -> highlighter");
});

test("FINITION UX — les actions principales vivent dans leur conteneur dédié (.feuillets-docx-review-card-actions), jamais mêlées au contenu principal", () => {
  const dest = file("Projet/Destination.md", "Avant. Cible.");
  const { view } = createView({ files: [dest] });
  const container = new FakeElement();
  view.renderChange(container, dest, { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", confidence: "safe" });

  const preview = allElements(container).find((el) => el.classes.has("feuillets-docx-review-preview"));
  const actions = allElements(container).find((el) => el.classes.has("feuillets-docx-review-card-actions"));
  assert.ok(preview, "zone de contenu principal présente");
  assert.ok(actions, "zone d'actions dédiée présente");

  // Aucun bouton d'action (Voir/Accepter/Refuser) n'est un descendant de la
  // zone de contenu principal — ils vivent EXCLUSIVEMENT dans `actions`.
  const buttonsInPreview = allElements(preview).filter((el) => el.tag === "button");
  assert.equal(buttonsInPreview.length, 0, "aucun bouton d'action dans la zone de contenu principal");
  const buttonsInActions = allElements(actions).filter((el) => el.tag === "button");
  assert.ok(buttonsInActions.length >= 3, "Voir/Accepter/Refuser sont bien dans la zone d'actions dédiée");
});

/* =========================================================================
 * LOT 6 — traçabilité des décisions DOCX (réutilise snapshotFile/
 * listSnapshotFiles/DiffModal existants, aucun nouveau moteur de diff, aucun
 * nouveau dossier de snapshots — voir docx-review-view.ts#ReviewApplyTrace).
 * ========================================================================= */

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

test("LOT 6 — application simple crée une trace persistante (fichier + snapshot)", async () => {
  const scene = file("Projet/Scene.md", "Avant. Cible.");
  const content = { [scene.path]: scene.content };
  const { view, plugin } = createView({ files: [scene], content });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async () => "2024-01-01 10h00m00s";

  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout." };
  const container = new FakeElement();
  view.renderChange(container, scene, change);
  const applyBtn = allElements(container).find((el) => el.icon === "check");
  assert.ok(applyBtn, "bouton Appliquer présent");
  applyBtn.events.get("click")({ stopPropagation() {} });
  await flush();

  const saved = plugin.settings.docxReviewResolved["retours.docx"];
  assert.ok(saved, "une entrée a été mémorisée");
  const key = Object.keys(saved)[0];
  const trace = saved[key].trace;
  assert.ok(trace, "une trace a été enregistrée");
  assert.equal(Number.isNaN(new Date(trace.decidedAt).getTime()), false, "decidedAt est une date valide");
  assert.deepEqual(trace.affectedFiles, [{ path: scene.path, snapshotStamp: "2024-01-01 10h00m00s" }]);
  assert.equal(trace.fromPath, undefined);
  assert.equal(trace.toPath, undefined);
});

test("LOT 6 — réouverture du même DOCX : la trace mémorisée est relue depuis les settings", async () => {
  const scene = file("Projet/Scene.md", "Avant. Cible.");
  const content = { [scene.path]: scene.content };
  const { view: view1, plugin } = createView({ files: [scene], content });
  view1.docxName = "retours.docx";
  plugin.snapshotFile = async () => "2024-02-02 11h00m00s";

  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout." };
  const container1 = new FakeElement();
  view1.renderChange(container1, scene, change);
  allElements(container1).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  // Nouvelle "session" : une seconde vue, MÊME plugin.settings (persistance
  // Obsidian réelle) — jamais un second système de vérité.
  const view2 = new (view1.constructor)({ app: view1.app, contentEl: new FakeElement() }, plugin);
  view2.docxName = "retours.docx";
  const reopenedChange = { ...change, applied: true, dismissed: true };
  const container2 = new FakeElement();
  view2.renderChange(container2, scene, reopenedChange);
  const traceLines = allElements(container2).filter((el) => el.classes.has("feuillets-docx-review-trace-line")).map((el) => el.text);
  assert.ok(traceLines.some((t) => t.includes("Appliqué le")), "la date d'application est relue depuis les settings");
  assert.ok(allElements(container2).some((el) => el.icon === "git-compare"), "le bouton Comparer est proposé à la réouverture");
});

test("LOT 6 — ancienne entrée {applied,dismissed} sans trace : aucun crash, carte toujours utilisable", async () => {
  const scene = file("Projet/Scene.md", "Avant. Cible.");
  const { view, plugin } = createView({ files: [scene] });
  view.docxName = "ancien.docx";
  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout.", applied: true, dismissed: true };
  // Entrée legacy strictement {applied, dismissed} — écrite directement,
  // sans passer par saveItemState (simule un settings.json antérieur à ce lot).
  plugin.settings.docxReviewResolved = { "ancien.docx": {} };
  // getItemKey n'est pas exporté : on réutilise saveItemState UNE FOIS pour
  // obtenir la même clé, puis on écrase l'entrée pour retirer `trace`.
  await view.saveItemState(change);
  const savedKey = Object.keys(plugin.settings.docxReviewResolved["ancien.docx"])[0];
  plugin.settings.docxReviewResolved["ancien.docx"][savedKey] = { applied: true, dismissed: true };

  const container = new FakeElement();
  assert.doesNotThrow(() => view.renderChange(container, scene, change));
  const traceLine = allElements(container).find((el) => el.classes.has("feuillets-docx-review-trace-line") && el.text.includes("Point de retour"));
  assert.ok(traceLine, "une ancienne entrée sans trace affiche quand même le point de retour générique");
});

test("LOT 6 — déplacement inter-feuillets : deux fichiers + deux snapshots dans la trace", async () => {
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin } = createView({ files: [origin, dest], content, withWorkspace: true });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async (f) => (f.path === origin.path ? "stamp-origine" : "stamp-destination");

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  const saved = plugin.settings.docxReviewResolved["retours.docx"];
  const trace = Object.values(saved)[0].trace;
  assert.equal(trace.fromPath, origin.path);
  assert.equal(trace.toPath, dest.path);
  assert.deepEqual(
    new Set(trace.affectedFiles.map((a) => a.path)),
    new Set([origin.path, dest.path])
  );
  const stampByPath = Object.fromEntries(trace.affectedFiles.map((a) => [a.path, a.snapshotStamp]));
  assert.equal(stampByPath[origin.path], "stamp-origine");
  assert.equal(stampByPath[dest.path], "stamp-destination");
});

test("LOT 6 — déplacement avec note : le nombre de notes transférées est remonté dans la trace", async () => {
  const origin = file("Projet/Origine.md", "Début. Il partit[^1] à l'aube. Fin.\n\n[^1]: Vers l'inconnu.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin } = createView({ files: [origin, dest], content, withWorkspace: true });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async () => "stamp";

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Il partit[^1] à l'aube.",
    toContext: "Avant. ", text: "Il partit[^1] à l'aube.",
    footnoteRefs: ["1"],
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  const trace = Object.values(plugin.settings.docxReviewResolved["retours.docx"])[0].trace;
  assert.deepEqual(trace.footnotes, { count: 1, renamedCount: 0 });
});

test("LOT 6 — collision de label de note : renamedCount remonté dans la trace", async () => {
  const origin = file("Projet/Origine.md", "Début. Il partit[^1] à l'aube. Fin.\n\n[^1]: Vers l'inconnu.");
  const dest = file("Projet/Destination.md", "Texte existant[^1] ici. Autre.\n\n[^1]: Une note déjà là.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin } = createView({ files: [origin, dest], content, withWorkspace: true });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async () => "stamp";

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Il partit[^1] à l'aube.",
    toContext: "Autre.", text: "Il partit[^1] à l'aube.",
    footnoteRefs: ["1"],
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  const trace = Object.values(plugin.settings.docxReviewResolved["retours.docx"])[0].trace;
  assert.equal(trace.footnotes.count, 1);
  assert.equal(trace.footnotes.renamedCount, 1);
});

test("LOT 6 — échec d'application (passage introuvable) : aucune trace de succès créée", async () => {
  const scene = file("Projet/Scene.md", "Contenu totalement différent.");
  const content = { [scene.path]: scene.content };
  const { view, plugin, writes } = createView({ files: [scene], content });
  view.docxName = "retours.docx";

  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Introuvable.", text: " Ajout." };
  const container = new FakeElement();
  view.renderChange(container, scene, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  assert.equal(writes.length, 0, "aucune écriture");
  assert.equal(change.applied, undefined, "jamais marqué appliqué");
  const saved = plugin.settings.docxReviewResolved?.["retours.docx"];
  assert.ok(!saved || Object.keys(saved).length === 0, "aucune entrée mémorisée en cas d'échec");
});

test("LOT 6 — refus : aucune modification du Markdown, décision mémorisée (date, sans snapshot)", async () => {
  const scene = file("Projet/Scene.md", "Avant. Cible.");
  const content = { [scene.path]: scene.content };
  const { view, plugin, writes } = createView({ files: [scene], content });
  view.docxName = "retours.docx";

  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout." };
  const container = new FakeElement();
  view.renderChange(container, scene, change);
  const dismissBtn = allElements(container).find((el) => el.icon === "x");
  assert.ok(dismissBtn, "bouton Refuser présent");
  dismissBtn.events.get("click")({ stopPropagation() {} });
  await flush();

  assert.equal(writes.length, 0, "un refus ne modifie jamais le Markdown");
  const trace = Object.values(plugin.settings.docxReviewResolved["retours.docx"])[0].trace;
  assert.ok(trace, "la décision de refus est mémorisée");
  assert.equal(Number.isNaN(new Date(trace.decidedAt).getTime()), false);
  assert.deepEqual(trace.affectedFiles, [], "aucun snapshot pour un refus");
});

test("LOT 6 — commentaire traité : décision mémorisée, aucune restauration proposée", async () => {
  const scene = file("Projet/Scene.md", "Un passage annoté.");
  const { view, plugin } = createView({ files: [scene] });
  view.docxName = "retours.docx";

  const comment = { anchorText: "annoté", text: "Vérifie ce passage.", author: "A", date: "D" };
  const container = new FakeElement();
  view.renderComment(container, scene, comment);
  const dismissBtn = allElements(container).find((el) => el.icon === "check-circle");
  assert.ok(dismissBtn, "bouton Marquer comme traité présent");
  dismissBtn.events.get("click")({ stopPropagation() {} });
  await flush();

  const trace = Object.values(plugin.settings.docxReviewResolved["retours.docx"])[0].trace;
  assert.ok(trace, "la décision est mémorisée");
  assert.deepEqual(trace.affectedFiles, []);

  // Re-rendu de la carte traitée : "Traité le <date>", jamais de bouton de
  // restauration DOCX (git-compare) pour un commentaire.
  const container2 = new FakeElement();
  view.renderComment(container2, scene, { ...comment, dismissed: true });
  const traceLines = allElements(container2).filter((el) => el.classes.has("feuillets-docx-review-trace-line")).map((el) => el.text);
  assert.ok(traceLines.some((t) => t.includes("Traité le")));
  assert.equal(allElements(container2).some((el) => el.icon === "git-compare"), false, "aucune restauration proposée pour un commentaire");
});

test("LOT 6 — Comparer (cas simple) ouvre DiffModal sur le snapshot mémorisé, restauration autorisée", async () => {
  const root = new TFolder("Projet");
  const scene = file("Projet/Scene.md", "Avant. Cible.");
  const snapFolder = new TFolder("Projet/Snapshots/Scene");
  const snap = file("Projet/Snapshots/Scene/2024-03-03 09h00m00s.md", "Avant.");
  snapFolder.children = [snap];
  const content = { [scene.path]: scene.content };
  const { view, plugin } = createView({ files: [scene, snapFolder, snap], content, root });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async () => "2024-03-03 09h00m00s";

  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible.", text: " Ajout." };
  const container = new FakeElement();
  view.renderChange(container, scene, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  const container2 = new FakeElement();
  view.renderChange(container2, scene, { ...change, applied: true, dismissed: true });
  const compareBtn = allElements(container2).find((el) => el.icon === "git-compare");
  assert.ok(compareBtn, "bouton Comparer présent");

  const originalOpen = DiffModal.prototype.open;
  let captured = null;
  DiffModal.prototype.open = function () { captured = this; };
  try {
    compareBtn.events.get("click")({ stopPropagation() {} });
  } finally {
    DiffModal.prototype.open = originalOpen;
  }

  assert.ok(captured, "DiffModal a bien été ouvert");
  assert.equal(captured.currentFile, scene);
  assert.equal(captured.allowRestore, true, "restauration autorisée pour une correction simple");
  assert.equal(captured.initialSnapshot, snap, "le VRAI snapshot mémorisé est retrouvé via listSnapshotFiles");
});

test("LOT 6 — déplacement inter-feuillets : aucune restauration directe proposée depuis la carte", async () => {
  const root = new TFolder("Projet");
  const origin = file("Projet/Origine.md", "Début. Passage à couper. Fin.");
  const dest = file("Projet/Destination.md", "Avant. Après.");
  const content = { [origin.path]: origin.content, [dest.path]: dest.content };
  const { view, plugin } = createView({ files: [origin, dest], content, root, withWorkspace: true });
  view.docxName = "retours.docx";
  plugin.snapshotFile = async () => "stamp";

  const change = {
    type: "move", author: "A", date: "D",
    fromPath: origin.path, toPath: dest.path,
    fromContext: "Début. ", fromText: "Passage à couper.",
    toContext: "Avant. ", text: "Passage à couper.",
  };
  const container = new FakeElement();
  view.renderChange(container, dest, change);
  allElements(container).find((el) => el.icon === "check").events.get("click")({ stopPropagation() {} });
  await flush();

  const container2 = new FakeElement();
  view.renderChange(container2, dest, { ...change, applied: true, dismissed: true });
  const compareBtns = allElements(container2).filter((el) => el.icon === "git-compare");
  assert.equal(compareBtns.length, 2, "Comparer l'origine ET Comparer la destination, jamais un bouton de restauration direct");

  const originalOpen = DiffModal.prototype.open;
  let captured = null;
  DiffModal.prototype.open = function () { captured = this; };
  try {
    compareBtns[0].events.get("click")({ stopPropagation() {} });
  } finally {
    DiffModal.prototype.open = originalOpen;
  }
  assert.ok(captured);
  assert.equal(captured.allowRestore, false, "jamais de restauration directe pour un déplacement inter-feuillets");
});

test("LOT 6 — état auto-détecté déjà appliqué SANS état enregistré : aucune trace inventée, aucune restauration proposée", async () => {
  const scene = file("Projet/Scene.md", "Avant. Cible Ajout.");
  const { view, plugin } = createView({ files: [scene] });
  view.docxName = "retours.docx";
  // Aucune entrée dans docxReviewResolved : `applied` posé directement sur
  // l'objet (comme le ferait analyzeBuffer#processItem en détection auto).
  const change = { type: "insertion", author: "A", date: "D", contextBefore: "Cible", text: " Ajout.", applied: true, dismissed: true };

  const container = new FakeElement();
  view.renderChange(container, scene, change);
  const traceLines = allElements(container).filter((el) => el.classes.has("feuillets-docx-review-trace-line")).map((el) => el.text);
  assert.ok(traceLines.some((t) => t.includes("Déjà présent")), "signale l'état auto-détecté, sans date inventée");
  assert.equal(allElements(container).some((el) => el.icon === "git-compare"), false, "aucune comparaison proposée sans point de retour connu");
  assert.equal(plugin.settings.docxReviewResolved, undefined, "aucune trace n'a été écrite dans les settings");
});

/* =========================================================================
 * LOT 9B — génération du DOCX révisé : câblage panneau -> moteur (Lot 9A).
 * Ne duplique jamais les tests internes du moteur (voir
 * test/docx-review-regenerate.test.js) — ici, uniquement ce que la vue lui
 * transmet et comment elle réagit au résultat. `regenerateDocxZipFn` est
 * réassigné (voir DocxReviewView, point d'injection dédié) pour observer les
 * arguments réels sans dépendre du moteur réel.
 * ========================================================================= */

/** Construit une vue déjà analysée (un feuillet, une insertion + un
 * commentaire réels, post-fusions) — même XML minimal que le test "analyse
 * DOCX sans écriture" ci-dessus, réutilisé pour ne pas réinventer un second
 * format de fixture. */
async function setupAnalyzedView(bufferBytes = "docx-bytes-A", docxName = "Manuscrit.docx") {
  const scenePath = "Projet/Scene.md";
  const scene = file(scenePath, "Avant ajout passage");
  const bookmark = bookmarkIdFor(scenePath);
  const created = createView({ files: [scene] });
  const { view } = created;

  const xml = documentXml(
    `<w:p><w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>Avant</w:t></w:r>` +
    `<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t> ajout</w:t></w:r></w:ins>` +
    `<w:commentRangeStart w:id="0"/><w:r><w:t> passage</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
    `<w:r><w:commentReference w:id="0"/></w:r><w:bookmarkEnd w:id="1"/></w:p>`
  );
  const zip = mockZip({
    "word/document.xml": xml,
    "word/comments.xml": '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="AA"><w:r><w:t>Résolu</w:t></w:r></w:p></w:comment></w:comments>',
    "word/footnotes.xml": "<w:footnotes/>",
    "word/commentsExtended.xml": '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>',
  });
  const buf = new TextEncoder().encode(bufferBytes).buffer;
  await view.analyzeBuffer(buf, docxName);
  zip.restore();
  return { ...created, scene, buf };
}

test("LOT 9B — analyzeBuffer conserve le buffer original en mémoire de session", async () => {
  const { view, buf } = await setupAnalyzedView();
  assert.equal(view.originalDocxBuffer, buf, "même référence que le buffer passé à analyzeBuffer");
});

test("LOT 9B — charger un second DOCX remplace le buffer précédent (pas d'accumulation)", async () => {
  const { view } = await setupAnalyzedView("premier", "Un.docx");
  const firstBuf = view.originalDocxBuffer;

  const scenePath = "Projet/Scene.md";
  const bookmark = bookmarkIdFor(scenePath);
  const xml = documentXml(
    `<w:p><w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>Avant</w:t></w:r>` +
    `<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t> ajout</w:t></w:r></w:ins></w:p>`
  );
  const zip = mockZip({ "word/document.xml": xml });
  const secondBuf = new TextEncoder().encode("second").buffer;
  await view.analyzeBuffer(secondBuf, "Deux.docx");
  zip.restore();

  assert.equal(view.originalDocxBuffer, secondBuf, "le buffer courant est bien le second");
  assert.notEqual(view.originalDocxBuffer, firstBuf, "aucune trace du premier buffer");
  assert.equal(view.docxName, "Deux.docx");
});

test("LOT 9B — génération transmet au moteur le buffer original (même référence)", async () => {
  const { view, buf } = await setupAnalyzedView();
  let received = null;
  view.regenerateDocxZipFn = async (...args) => { received = args; return { ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 }; };
  await view.generateRevisedDocx();
  assert.equal(received[0], buf, "le buffer transmis au moteur est le buffer ORIGINAL, sans copie ni transformation");
});

test("LOT 9B — génération transmet les ReviewChange réels (post-fusions)", async () => {
  const { view } = await setupAnalyzedView();
  let received = null;
  view.regenerateDocxZipFn = async (...args) => { received = args; return { ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 }; };
  await view.generateRevisedDocx();
  const [, , parsedChanges] = received;
  const expected = view.results.byPath["Projet/Scene.md"].changes;
  assert.equal(parsedChanges.length, expected.length);
  assert.equal(parsedChanges[0], expected[0], "même objet que celui affiché dans la carte — aucun reparsing");
});

test("LOT 9B — génération transmet les ReviewComment réels", async () => {
  const { view } = await setupAnalyzedView();
  let received = null;
  view.regenerateDocxZipFn = async (...args) => { received = args; return { ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 }; };
  await view.generateRevisedDocx();
  const [, , , parsedComments] = received;
  const expected = view.results.byPath["Projet/Scene.md"].comments;
  assert.equal(parsedComments.length, expected.length);
  assert.equal(parsedComments[0], expected[0]);
});

test("LOT 9B — génération transmet uniquement le saved state du DOCX courant, jamais mélangé avec un autre document", async () => {
  const { view, plugin } = await setupAnalyzedView("bytes", "Courant.docx");
  const insertion = view.results.byPath["Projet/Scene.md"].changes.find((c) => c.type === "insertion");
  await view.saveItemState({ ...insertion, applied: true, dismissed: true });

  // Décision d'un AUTRE document, présente dans les mêmes settings —
  // ne doit JAMAIS apparaître dans les décisions transmises au moteur.
  plugin.settings.docxReviewResolved["Autre.docx"] = {
    "insertion|X|Y|contexte|texte|9": { applied: true, dismissed: true },
  };

  let received = null;
  view.regenerateDocxZipFn = async (...args) => { received = args; return { ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 }; };
  await view.generateRevisedDocx();
  const [, decisions] = received;
  const expectedKeys = Object.keys(plugin.settings.docxReviewResolved["Courant.docx"]);
  assert.deepEqual(Object.keys(decisions).sort(), expectedKeys.sort());
  assert.equal(Object.keys(decisions).some((k) => k.includes("|X|Y|")), false, "aucune décision de l'autre document");
});

test("LOT 9B — aucune décision implicite ajoutée depuis item.applied/dismissed seul (absent de docxReviewResolved)", async () => {
  const { view, plugin } = await setupAnalyzedView();
  // Le commentaire est auto-marqué `dismissed` (commentsExtended w15:done)
  // par analyzeBuffer, SANS jamais passer par saveItemState : docxReviewResolved
  // reste donc vide pour ce document.
  const comment = view.results.byPath["Projet/Scene.md"].comments[0];
  assert.equal(comment.dismissed, true, "prérequis : l'item porte bien un état en mémoire non sauvegardé");
  assert.equal(plugin.settings.docxReviewResolved, undefined, "prérequis : rien n'a été sauvegardé");

  let received = null;
  view.regenerateDocxZipFn = async (...args) => { received = args; return { ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 }; };
  await view.generateRevisedDocx();
  const [, decisions] = received;
  assert.deepEqual(decisions, {}, "aucune décision fabriquée à partir de l'état en mémoire seul");
});

test("LOT 9B — succès crée un fichier .docx", async () => {
  const { view, binaryWrites } = await setupAnalyzedView();
  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();
  assert.equal(binaryWrites.length, 1);
  assert.ok(binaryWrites[0].path.endsWith(".docx"));
});

test("LOT 9B — nom par défaut <nom-original>-révisé.docx", async () => {
  const { view, binaryWrites } = await setupAnalyzedView("bytes", "Manuscrit.docx");
  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();
  assert.ok(binaryWrites[0].path.endsWith("Manuscrit-révisé.docx"), binaryWrites[0].path);
});

test("LOT 9B — l'original n'est jamais écrasé automatiquement", async () => {
  const { view, app, binaryWrites } = await setupAnalyzedView("bytes", "Manuscrit.docx");
  // Simule un fichier original présent dans le coffre, sous ce nom exact
  // (même chemin que celui que writeBinaryFile viserait pour l'original).
  const originalPath = "Projet/Manuscrit.docx";
  const originalFile = file(originalPath);
  const previousLookup = app.vault.getAbstractFileByPath;
  app.vault.getAbstractFileByPath = (path) => (path === originalPath ? originalFile : previousLookup(path));
  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();
  assert.notEqual(binaryWrites[0].path, originalPath);
  assert.equal(binaryWrites[0].mode, "create", "le fichier -révisé.docx est créé, l'original n'est ni lu ni modifié");
});

test("LOT 9B — échec du moteur (ok:false) : aucun fichier créé", async () => {
  const { view, binaryWrites } = await setupAnalyzedView();
  view.regenerateDocxZipFn = async () => ({ ok: false, reason: "invalid-xml-structure" });
  const notices = [];
  Notice.onCreate = (m) => notices.push(m);
  await view.generateRevisedDocx();
  Notice.onCreate = null;
  assert.equal(binaryWrites.length, 0);
  assert.ok(notices.length > 0);
});

test("LOT 9B — unsupported-footnote-move-regeneration affiche un message clair, sans jargon OOXML", async () => {
  const { view } = await setupAnalyzedView();
  // Une décision existante évite ici le message d'avertissement §9 (hors
  // sujet de ce test) — on veut isoler le SEUL message d'échec du moteur.
  const insertion = view.results.byPath["Projet/Scene.md"].changes.find((c) => c.type === "insertion");
  await view.saveItemState({ ...insertion, applied: true, dismissed: true });

  view.regenerateDocxZipFn = async () => ({ ok: false, reason: "unsupported-footnote-move-regeneration" });
  const notices = [];
  Notice.onCreate = (m) => notices.push(m);
  await view.generateRevisedDocx();
  Notice.onCreate = null;
  assert.equal(notices.length, 1);
  assert.equal(notices[0], "Ce document contient un déplacement avec note de bas de page qui ne peut pas encore être régénéré automatiquement.");
  assert.equal(/ooxml|xml|w:moveFrom|w:moveTo/i.test(notices[0]), false, "aucun jargon technique dans le message principal");
});

test("LOT 9B — double lancement empêché : un deuxième clic pendant la génération est ignoré", async () => {
  const { view } = await setupAnalyzedView();
  let calls = 0;
  let resolveEngine;
  view.regenerateDocxZipFn = async () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveEngine = () => resolve({ ok: true, docxBuffer: new ArrayBuffer(0), processedRefsCount: 0 });
    });
  };
  const firstRun = view.generateRevisedDocx();
  // Deuxième clic pendant que la génération est en cours (isGeneratingDocx déjà posé).
  await view.generateRevisedDocx();
  resolveEngine();
  await firstRun;
  assert.equal(calls, 1, "le moteur n'a été invoqué qu'une seule fois");
});

test("LOT 9B — la génération ne modifie aucun fichier Markdown du projet", async () => {
  const { view, writes } = await setupAnalyzedView();
  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();
  assert.equal(writes.length, 0, "aucune écriture Markdown — sortie pure, jamais une application de révisions");
});

test("LOT 9B — la génération ne crée ni ne modifie de snapshot", async () => {
  const { view, plugin } = await setupAnalyzedView();
  let snapshotCalls = 0;
  plugin.snapshotFile = async () => { snapshotCalls += 1; return "stamp"; };
  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();
  assert.equal(snapshotCalls, 0);
});

test("LOT 9B — la génération ne change pas applied/dismissed des cartes existantes ni docxReviewResolved", async () => {
  const { view, plugin } = await setupAnalyzedView("bytes", "Courant.docx");
  const insertion = view.results.byPath["Projet/Scene.md"].changes.find((c) => c.type === "insertion");
  await view.saveItemState({ ...insertion, applied: true, dismissed: true });
  const beforeApplied = insertion.applied;
  const beforeDismissed = insertion.dismissed;
  const beforeResolved = JSON.stringify(plugin.settings.docxReviewResolved);

  view.regenerateDocxZipFn = async () => ({ ok: true, docxBuffer: new ArrayBuffer(4), processedRefsCount: 1 });
  await view.generateRevisedDocx();

  assert.equal(insertion.applied, beforeApplied);
  assert.equal(insertion.dismissed, beforeDismissed);
  assert.equal(JSON.stringify(plugin.settings.docxReviewResolved), beforeResolved, "docxReviewResolved inchangé : sortie pure, pas une nouvelle décision");
});
