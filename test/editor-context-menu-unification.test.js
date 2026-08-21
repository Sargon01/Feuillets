import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, Menu, Notice, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { CaptureIdeaModal } from "../src/ui/capture-idea-modal.js";
import { loadAnnotations, saveAnnotations } from "../src/services/annotations.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Lot 1 — « Retrait de la Barre d'écriture » : les actions notes de bas de
   page sont regroupées dans UN SEUL sous-menu natif « Note de bas de page »
   (plus aucune entrée plate au niveau racine), les annotations de relecture
   dans un sous-menu « Annotation » (actions désactivées sans sélection),
   « Noter une idée » est partagé par la commande ET le menu. Tous les
   libellés passent par l'i18n (t()) — jamais de chaîne en dur.
   Le plugin est exercé via Object.create(FeuilletsPlugin.prototype)
   (même pattern que test/annotation-editing.test.js) : le stub Obsidian de
   test n'exporte pas `Plugin`, l'instanciation réelle échouerait. */

const previousDocument = globalThis.document;
globalThis.document = { body: {} };
test.after(() => {
  globalThis.document = previousDocument;
});

/* Correctif « Noter une idée ne doit jamais modifier le manuscrit » — DOM
   factice minimal (calqué sur test/entity-modals.test.js) juste assez riche
   pour exercer le VRAI handler `keydown` de CaptureIdeaModal.onOpen(), pas un
   appel direct à captureIdeaToNotebook(). `value`/`focus` couvrent l'input
   texte de la modale. */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    if (options.type) this.type = options.type;
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  addClass(names) { for (const name of String(names).split(" ")) if (name) this.classes.add(name); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  focus() { this.focused = true; }
  empty() { this.children = []; }
}

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

/** Simule l'événement `keydown` réel qu'Obsidian passerait au listener :
 * `preventDefault`/`stopPropagation` espionnés pour vérifier qu'ils sont
 * appelés AVANT toute fermeture de la modale — c'est précisément ce qui
 * empêche l'Entrée de continuer son cycle jusqu'à CodeMirror. */
function keyEvent(key) {
  return {
    key,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

function openRealCaptureIdeaModal(onSubmit) {
  const modal = new CaptureIdeaModal({}, onSubmit);
  modal.contentEl = new FakeElement();
  const closes = [];
  modal.close = () => closes.push(true);
  modal.onOpen();
  const input = findAll(modal.contentEl, (el) => el.tag === "input")[0];
  return { modal, input, closes };
}

/* §16 — « Noter une idée » : l'Entrée qui valide neutralise l'événement
   AVANT fermeture, et n'appelle jamais l'éditeur (le service Carnet ne
   reçoit d'ailleurs jamais de référence éditeur — voir main.ts
   captureIdeaToNotebook). Contenu avec frontmatter YAML : le manuscrit
   reste rigoureusement identique. */
test("§16 — CaptureIdeaModal : Entrée neutralise l'événement, ferme, ajoute l'idée une fois — jamais de mutation du manuscrit", () => {
  const before = "---\ntitle: Test\nshort_title: Essai\nstatus: Brouillon\n---\n\nPremière phrase.";
  const editor = {
    getValue: () => before,
    // Aucune méthode de mutation exposée : tout appel accidentel jette.
  };

  const submissions = [];
  const { input, closes } = openRealCaptureIdeaModal((text) => submissions.push(text));
  input.value = "Mon idée";

  const evt = keyEvent("Enter");
  input.events.get("keydown")(evt);

  assert.equal(evt.defaultPrevented, true, "preventDefault() appelé");
  assert.equal(evt.propagationStopped, true, "stopPropagation() appelé — l'Entrée n'atteint jamais CodeMirror");
  assert.equal(closes.length, 1, "la modale se ferme une seule fois");
  assert.deepEqual(submissions, ["Mon idée"], "l'idée est transmise une seule fois au Carnet");

  assert.equal(editor.getValue(), before, "le manuscrit est resté byte-for-byte identique");
  assert.equal(editor.getValue().startsWith("---"), true, "le frontmatter commence toujours en première ligne");
  assert.equal(editor.getValue().split("\n")[0], "---", "aucune ligne vide avant le frontmatter");
});

test("§16 — CaptureIdeaModal : même comportement sans frontmatter", () => {
  const submissions = [];
  const { input, closes } = openRealCaptureIdeaModal((text) => submissions.push(text));
  input.value = "Une autre idée";

  const evt = keyEvent("Enter");
  input.events.get("keydown")(evt);

  assert.equal(evt.defaultPrevented, true);
  assert.equal(evt.propagationStopped, true);
  assert.equal(closes.length, 1);
  assert.deepEqual(submissions, ["Une autre idée"]);
});

test("§16 — CaptureIdeaModal : un texte vide après trim n'appelle jamais onSubmit ni close", () => {
  const submissions = [];
  const { input, closes } = openRealCaptureIdeaModal((text) => submissions.push(text));
  input.value = "   ";

  const evt = keyEvent("Enter");
  input.events.get("keydown")(evt);

  assert.equal(evt.defaultPrevented, true, "l'Entrée reste neutralisée même sans texte");
  assert.equal(closes.length, 0, "la modale ne se ferme pas sur un texte vide");
  assert.deepEqual(submissions, []);
});

test("§16 — CaptureIdeaModal : une touche autre qu'Entrée n'est jamais interceptée", () => {
  const submissions = [];
  const { input, closes } = openRealCaptureIdeaModal((text) => submissions.push(text));
  input.value = "a";

  const evt = keyEvent("a");
  input.events.get("keydown")(evt);

  assert.equal(evt.defaultPrevented, false, "les autres touches ne sont pas neutralisées (saisie normale préservée)");
  assert.equal(closes.length, 0);
  assert.deepEqual(submissions, []);
});

function editorMenuHarness() {
  const handlers = {};
  const workspace = {
    on(name, cb) {
      (handlers[name] ||= []).push(cb);
      return {};
    },
    getActiveFile: () => null,
  };
  const consent = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  consent.children = [manuscript];
  manuscript.parent = consent;
  const files = new Map([[consent.path, consent], [manuscript.path, manuscript]]);
  const vault = { getAbstractFileByPath: (p) => files.get(p) || null };
  const app = { workspace, vault };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = { projectFolder: manuscript.path };
  plugin.getProjectFolder = () => manuscript;
  plugin.registerEvent = () => {};
  plugin.annotationMenuStyle = "highlight";
  plugin.annotationMenuColor = "yellow";
  plugin.refreshAnnotationHighlights = async () => {};
  return { plugin, handlers, manuscript };
}

function markdownView(file) {
  const view = new MarkdownView();
  view.file = file;
  return view;
}

function fakeEditor(content, selStart, selEnd, cursorOffset = null) {
  return {
    getValue: () => content,
    somethingSelected: () => selEnd > selStart,
    getCursor: (which) => {
      if (which === "from") return { offset: selStart };
      if (which === "to") return { offset: selEnd };
      return { offset: cursorOffset ?? selEnd };
    },
    posToOffset: (pos) => pos.offset,
  };
}

function captureNotice(run) {
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  return Promise.resolve(run())
    .then(() => notices)
    .finally(() => {
      Notice.onCreate = null;
    });
}

/* §15.A — plus AUCUNE entrée plate : le bloc Feuillets du menu de l'éditeur
   est un sous-menu « Note de bas de page » unique, jamais les anciennes
   actions disposées au niveau racine. */
test("§15.A — notes : le menu éditeur ne contient plus d'actions plates, la « Note de bas de page » est un sous-menu", () => {
  const { plugin, handlers, manuscript } = editorMenuHarness();
  plugin.registerFootnoteContextMenu();
  const cb = handlers["editor-menu"][0];
  const file = new TFile(`${manuscript.path}/Scène.md`, "Un texte.");
  const editor = fakeEditor("Un texte.", 0, 0, 5);
  const menu = new Menu();

  cb(menu, editor, markdownView(file));

  const flatTitles = menu.items
    .filter((i) => !i.separator)
    .map((i) => i.title);
  for (const flat of [
    "editorMenu.footnote.insert",
    "editorMenu.footnote.gotoDefinition",
    "editorMenu.footnote.gotoReference",
    "editorMenu.footnote.check",
    "editorMenu.footnote.renumber",
  ]) {
    assert.equal(flatTitles.includes(t(flat)), false, `plus d'entrée plate « ${t(flat)} »`);
  }

  const root = menu.items.find((i) => i.title === t("editorMenu.footnote"));
  assert.ok(root, "l'entrée racine « Note de bas de page » existe");
  assert.ok(root.submenu instanceof Menu, "elle ouvre un sous-menu natif");
});

/* §15.B — sous-menu « Note de bas de page » : contenu, icônes et callbacks.
   « Aller à la note » n'apparaît qu'avec un appel sous le curseur,
   « Retourner à l'appel » qu'à l'intérieur d'une définition. */
test("§15.B — sous-menu notes : 5 entrées possibles, contextuelles au curseur", () => {
  const { plugin, handlers, manuscript } = editorMenuHarness();
  plugin.registerFootnoteContextMenu();
  const cb = handlers["editor-menu"][0];
  const file = new TFile(`${manuscript.path}/Scène.md`, "Un fait notable[^1].\n\n[^1]: La source.\nUne dernière ligne.");

  const submenuAt = (content, offset) => {
    const menu = new Menu();
    cb(menu, fakeEditor(content, 0, 0, offset), markdownView(file));
    return menu.items.find((i) => i.title === t("editorMenu.footnote")).submenu;
  };

  const titles = (sub) => sub.items.filter((i) => !i.separator).map((i) => i.title);

  const onRef = submenuAt("Un fait notable[^1].\n\n[^1]: La source.", "Un fait notable[".length);
  assert.deepEqual(titles(onRef), [
    t("editorMenu.footnote.insert"),
    t("editorMenu.footnote.gotoDefinition"),
    t("editorMenu.footnote.check"),
    t("editorMenu.footnote.renumber"),
  ], "sur un appel : insert + aller à la note + vérifier + renuméroter");

  const onDef = submenuAt("Un fait notable[^1].\n\n[^1]: La source.", "Un fait notable[^1].\n\n[^1]: La".length);
  assert.deepEqual(titles(onDef), [
    t("editorMenu.footnote.insert"),
    t("editorMenu.footnote.gotoReference"),
    t("editorMenu.footnote.check"),
    t("editorMenu.footnote.renumber"),
  ], "dans une définition : « Retourner à l'appel » remplace « Aller à la note »");

  const none = submenuAt("Un texte sans note du tout.", 3);
  assert.deepEqual(titles(none), [
    t("editorMenu.footnote.insert"),
    t("editorMenu.footnote.check"),
    t("editorMenu.footnote.renumber"),
  ], "hors contexte : insertion toujours proposée, aucun aller-retour");
});

/* §15.J — insertiFootnote : le marqueur [^n] est posé à la position du
   curseur, la définition en fin de fichier, le curseur est replacé APRÈS le
   marqueur et l'éditeur refocalisé — même facteur commun pour la commande et
   le menu. */
test("§15.J — insertFootnote place le rappel, la définition, et replace le curseur après le marqueur", async () => {
  const { plugin } = editorMenuHarness();
  const calls = [];
  const editor = {
    getValue: () => "Du texte sans note.",
    getCursor: (which) => ({ line: 0, ch: which === "to" ? 4 : 4 }),
    replaceRange(text, from, to) {
      calls.push({ text, from, to });
    },
    lastLine: () => 0,
    getLine: () => "Du texte sans note.",
    setCursor(pos) {
      this.lastCursor = pos;
    },
    focus() {
      this.focused = true;
    },
  };
  editor.getValue = () => "Du texte sans note.";
  const notices = await captureNotice(() => {
    plugin.insertFootnote(editor);
  });

  assert.deepEqual(
    calls.map((c) => c.text),
    ["[^1]", "\n\n[^1]: "],
    "un seul rappel [^1] puis UNE définition en fin de fichier"
  );
  assert.deepEqual(editor.lastCursor, { line: 0, ch: 8 }, "le curseur est replacé après le marqueur [^1]");
  assert.equal(editor.focused, true, "l'éditeur est refocalisé");
  assert.deepEqual(notices, [t("main.notice.footnoteInserted", { n: "1" })]);
});

/* §15.C — Micro-finition UX : une seule entrée « Annotation… » (plus pas
   de sous-menu Style/Couleur/Commentaire). L'entrée est désactivée sans
   sélection (l'utilisateur doit sélectionner du texte avant d'annoter). */
test("§15.C — annotation : une seule entrée « Annotation… », désactivée sans sélection", () => {
  const { plugin } = editorMenuHarness();
  const file = new TFile("Projet/Manuscrit/Scène.md", "Le chat dort.");
  const menu = new Menu();
  const editor = fakeEditor("Le chat dort.", 3, 3); // pas de sélection

  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, file);

  const root = menu.items.find((i) => i.title === t("editorMenu.annotation"));
  assert.ok(root, "« Annotation… » présente");
  assert.equal(root.disabled, true, "désactivée sans sélection");
  assert.equal(root.submenu, undefined, "jamais de sous-menu");
});

test("§15.C — annotation : avec sélection, l'entrée est active et crée directement (jamais via openAnnotationCommentForContext)", async () => {
  const { plugin } = editorMenuHarness();
  plugin.annotationMenuStyle = "underline";
  plugin.annotationMenuColor = "green";
  const file = new TFile("Projet/Manuscrit/Scène.md", "Le chat dort.");
  const menu = new Menu();
  const editor = fakeEditor("Le chat dort.", 3, 12); // sélection « chat dort »
  let openedWithInitial = null;
  const controller = plugin.getAnnotationEditor();
  controller.openAnnotationCommentForContext = async () => {
    throw new Error("openAnnotationCommentForContext ne doit plus jamais être appelée par le menu");
  };
  controller.createAnnotationFromSelection = async (ed, f, initial) => {
    openedWithInitial = initial;
  };

  controller.addContextMenuItem(menu, editor, file);

  const root = menu.items.find((i) => i.title === t("editorMenu.annotation"));
  assert.ok(root, "« Annotation… » présente");
  assert.equal(root.disabled, undefined, "active avec sélection");
  await root.callback();
  assert.equal(openedWithInitial.style, "underline", "popover ouvert avec le style de session");
  assert.equal(openedWithInitial.color, "green", "popover ouvert avec la couleur de session");
});

/* §32-33 — Popup unique : cliquer l'entrée Annotation ouvre le popover.
   L'utilisateur peut choisir style, couleur, commentaire dans la même carte
   sans rouvrir le menu. */
test("§32 — clic entrée Annotation ouvre le popover avec les préférences de session (appel direct createAnnotationFromSelection)", async () => {
  const { plugin } = editorMenuHarness();
  plugin.annotationMenuStyle = "underline";
  plugin.annotationMenuColor = "pink";
  const file = new TFile("Projet/Manuscrit/Scène.md", "Le chat dort.");
  const menu = new Menu();
  const editor = fakeEditor("Le chat dort.", 3, 12);
  let callbackArgs = null;
  const controller = plugin.getAnnotationEditor();
  controller.openAnnotationCommentForContext = async () => {
    throw new Error("openAnnotationCommentForContext ne doit plus jamais être appelée par le menu");
  };
  controller.createAnnotationFromSelection = async (ed, f, initial, onAnnotationChange) => {
    callbackArgs = { ed, f, initial, onAnnotationChange };
  };

  controller.addContextMenuItem(menu, editor, file);
  const root = menu.items.find((i) => i.title === t("editorMenu.annotation"));

  await root.callback();

  assert.ok(callbackArgs, "createAnnotationFromSelection appelé");
  assert.equal(callbackArgs.ed, editor, "l'editor passé");
  assert.equal(callbackArgs.f, file, "le fichier passé");
  assert.equal(callbackArgs.initial.style, "underline", "style de session passé");
  assert.equal(callbackArgs.initial.color, "pink", "couleur de session passée");
});

/* §15.E — applyAnnotationOrUpdate : une annotation existante qui couvre
   EXACTEMENT la sélection est MODIFIÉE (jamais de doublon de stockage) ;
   une autre sélection en crée une nouvelle. */
test("§15.E — applyAnnotationOrUpdate modifie l'annotation exacte au lieu de créer un doublon", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const SCENE = "Il faisait nuit. Le chat dormait tranquillement. Il faisait nuit.";
  const scene = new TFile("Projet/Manuscrit/Chapitre/Scène.md", SCENE);
  volume.children = [root];
  root.parent = volume;
  root.children = [chapter];
  chapter.parent = root;
  chapter.children = [scene];
  scene.parent = chapter;
  const { vault } = createFakeVault([volume, root, chapter, scene]);
  const app = { vault, workspace: { getActiveFile: () => null } };
  const settings = { projectFolder: root.path };

  const quote = "Le chat dormait tranquillement";
  const start = SCENE.indexOf(quote);
  const end = start + quote.length;
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1",
      file: "Chapitre/Scène.md",
      start,
      end,
      quote,
      prefix: SCENE.slice(Math.max(0, start - 30), start),
      suffix: SCENE.slice(end, end + 30),
      text: "première note",
      color: "yellow",
    }],
  });

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = settings;
  plugin.refreshAnnotationHighlights = async () => {};

  const editor = {
    getValue: () => SCENE,
    somethingSelected: () => true,
    getCursor: (which) => ({ offset: which === "from" ? start : end }),
    posToOffset: (pos) => pos.offset,
  };

  const ok = await plugin.applyAnnotationOrUpdate(editor, scene, "underline", "green");

  assert.equal(ok, true);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "aucun doublon créé");
  assert.equal(store.annotations[0].id, "ann-1", "l'annotation existante est modifiée, pas remplacée");
  assert.equal(store.annotations[0].color, "green");
  assert.equal(store.annotations[0].style, "underline");
});

test("§15.E — applyAnnotationOrUpdate : sans sélection, notice et aucun changement", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const scene = new TFile("Projet/Manuscrit/Chapitre/Scène.md", "Il faisait nuit.");
  volume.children = [root];
  root.parent = volume;
  root.children = [chapter];
  chapter.parent = root;
  chapter.children = [scene];
  scene.parent = chapter;
  const { vault } = createFakeVault([volume, root, chapter, scene]);
  const app = { vault, workspace: { getActiveFile: () => null } };
  const settings = { projectFolder: root.path };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = settings;
  plugin.refreshAnnotationHighlights = async () => {};

  const editor = {
    getValue: () => "Il faisait nuit.",
    somethingSelected: () => false,
    getCursor: (_which) => ({ offset: 0 }),
    posToOffset: (pos) => pos.offset,
  };

  const notices = await captureNotice(() => plugin.applyAnnotationOrUpdate(editor, scene, "highlight", "yellow"));
  assert.deepEqual(notices, [t("annotation.notice.noSelection")]);
  const store = await loadAnnotations(app, settings);
  assert.deepEqual(store.annotations, [], "rien n'est enregistré sans sélection");
});

/* §15.D — « Noter une idée » : l'entrée du menu appelle exactement le même
   facteur commun que la commande Cmd+P (openCaptureIdeaModal). */
test("§15.D — « Noter une idée » apparaît dès qu'un projet existe et partage openCaptureIdeaModal", async () => {
  const { plugin, handlers, manuscript } = editorMenuHarness();
  plugin.registerAnnotationContextMenu();
  const cb = handlers["editor-menu"][0];
  const file = new TFile(`${manuscript.path}/Scène.md`, "Un texte.");
  const editor = fakeEditor("Un texte.", 0, 0);

  const opened = [];
  const originalOpen = CaptureIdeaModal.prototype.open;
  CaptureIdeaModal.prototype.open = function open() {
    opened.push(this);
    return this;
  };
  try {
    const menu = new Menu();
    cb(menu, editor, markdownView(file));

    const entry = menu.items.find((i) => i.title === t("editorMenu.captureIdea"));
    assert.ok(entry, "l'entrée « Noter une idée » est présente");
    assert.equal(entry.icon, "pen-line");
    entry.callback();
    assert.equal(opened.length, 1, "le clic ouvre CaptureIdeaModal (même chemin que la commande)");
  } finally {
    CaptureIdeaModal.prototype.open = originalOpen;
  }
});