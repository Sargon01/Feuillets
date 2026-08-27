import test from "node:test";
import assert from "node:assert/strict";
import FeuilletsPlugin from "../src/main.js";

function makeEditor(value, cursor = { line: 0, ch: 0 }) {
  const editor = {
    lines: value.split("\n"),
    cursor: { ...cursor },
    selected: false,
    somethingSelected() { return this.selected; },
    getCursor() { return { ...this.cursor }; },
    getLine(line) { return this.lines[line] ?? ""; },
    getValue() { return this.lines.join("\n"); },
    lineCount() { return this.lines.length; },
    setCursor(next) { this.cursor = { ...next }; },
    replaceRange(text, from, to = from) {
      const before = this.lines[from.line].slice(0, from.ch);
      const after = this.lines[to.line].slice(to.ch);
      this.lines.splice(from.line, to.line - from.line + 1, ...`${before}${text}${after}`.split("\n"));
    },
  };
  return editor;
}

function paragraphSpacePlugin() {
  return Object.create(FeuilletsPlugin.prototype);
}

function installLiveHandler(editor, liveDoubleEnter, liveTwoEnters = false) {
  const plugin = paragraphSpacePlugin();
  plugin.settings = { liveApostrophe: false, liveGuillemets: false, liveDashes: false, liveTwoEnters, liveDoubleEnter };
  plugin.registerEvent = () => {};
  plugin.applyLiveTypoClasses = () => {};
  plugin.registerDomEvent = (_target, _type, listener) => { plugin.handler = listener; };
  plugin.app = {
    vault: { getConfig: () => undefined },
    workspace: { on: () => ({}), getActiveViewOfType: () => ({ file: { path: "scene.md" }, editor, getMode: () => "source" }) },
  };
  plugin.getProjectFolder = () => ({ path: "" });
  const oldDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try { plugin.registerLiveTypography(); } finally { globalThis.document = oldDocument; }
  return plugin;
}

function keyEvent(key = "Enter") {
  return {
    key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    target: { closest: (selector) => selector === ".cm-editor" ? {} : null }, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {},
  };
}

const enterEvent = () => keyEvent();

test("insertParagraphSpace insère un seul blanc volontaire sans retour supplémentaire", () => {
  const plugin = paragraphSpacePlugin();
  const editor = makeEditor("Premier paragraphe.", { line: 0, ch: "Premier paragraphe.".length });
  assert.equal(plugin.insertParagraphSpace(editor), true);
  assert.equal(editor.getValue(), "Premier paragraphe.\n\n\u00A0\n\n");
  assert.deepEqual(editor.cursor, { line: 4, ch: 0 });
  editor.replaceRange("Nouveau paragraphe", editor.getCursor());
  assert.equal(editor.getValue(), "Premier paragraphe.\n\n\u00A0\n\nNouveau paragraphe");
});

test("Double Entrée transforme la séparation créée en fin de paragraphe", () => {
  const editor = makeEditor("Une phrase.", { line: 0, ch: 11 });
  const plugin = installLiveHandler(editor, true, true);
  plugin.handler(enterEvent());
  assert.equal(editor.getValue(), "Une phrase.\n\n");
  plugin.handler(enterEvent());
  assert.equal(editor.getValue(), "Une phrase.\n\n\u00A0\n\n");
  assert.deepEqual(editor.cursor, { line: 4, ch: 0 });
});

test("Double Entrée au milieu préserve le texte après le curseur", () => {
  const editor = makeEditor("AvantAprès", { line: 0, ch: 5 });
  const plugin = installLiveHandler(editor, true, true);
  plugin.handler(enterEvent());
  assert.equal(editor.getValue(), "Avant\n\nAprès");
  plugin.handler(enterEvent());
  assert.equal(editor.getValue(), "Avant\n\n\u00A0\n\nAprès");
  assert.deepEqual(editor.cursor, { line: 4, ch: 0 });
});

test("la saisie ou un déplacement annule le Double Entrée en attente", () => {
  const editor = makeEditor("AvantAprès", { line: 0, ch: 5 });
  const plugin = installLiveHandler(editor, true, true);
  plugin.handler(enterEvent());
  editor.replaceRange("x", editor.getCursor());
  editor.setCursor({ line: 2, ch: 1 });
  plugin.handler(keyEvent("x"));
  plugin.handler(enterEvent());
  assert.equal(editor.getValue().includes("\u00A0"), false);

  const movedEditor = makeEditor("AvantAprès", { line: 0, ch: 5 });
  const movedPlugin = installLiveHandler(movedEditor, true, true);
  movedPlugin.handler(enterEvent());
  movedEditor.setCursor({ line: 0, ch: 2 });
  movedPlugin.handler(enterEvent());
  assert.equal(movedEditor.getValue().includes("\u00A0"), false);
});

test("Entrée simple, Maj+Entrée et option désactivée restent inchangées", () => {
  const editor = makeEditor("Texte", { line: 0, ch: 5 });
  const plugin = installLiveHandler(editor, false);
  for (const extra of [{}, { shiftKey: true }]) {
    const event = { ...enterEvent(), ...extra };
    plugin.handler(event);
    assert.equal(event.prevented, false);
  }
  assert.equal(editor.getValue(), "Texte");

  const disabledEditor = makeEditor("Texte", { line: 0, ch: 5 });
  const disabledPlugin = installLiveHandler(disabledEditor, false, true);
  disabledPlugin.handler(enterEvent());
  disabledPlugin.handler(enterEvent());
  assert.equal(disabledEditor.getValue().includes("\u00A0"), false);
});

test("le listener Markdown ignore explicitement Continu", () => {
  const editor = makeEditor("Avant", { line: 0, ch: 5 });
  const plugin = installLiveHandler(editor, true, true);
  const event = enterEvent();
  event.target = {
    closest(selector) {
      return selector === ".feuillets-scrivenings-view" || selector === ".cm-editor" ? {} : null;
    },
  };
  plugin.handler(event);
  assert.equal(event.prevented, false);
  assert.equal(editor.getValue(), "Avant");
});

test("la commande Obsidian appelle uniquement insertParagraphSpace", () => {
  const plugin = paragraphSpacePlugin();
  plugin.settings = { liveDoubleEnter: false };
  const commands = [];
  plugin.addCommand = (command) => { commands.push(command); };
  plugin.registerTextEditingCommands();
  const command = commands.find((entry) => entry.id === "insert-paragraph-space");
  assert.ok(command);
  assert.equal("hotkeys" in command, false);
  const editor = makeEditor("Avant", { line: 0, ch: 5 });
  command.editorCallback(editor);
  assert.equal(editor.getValue(), "Avant\n\n\u00A0\n\n");
});

test("les contextes structurels restent inchangés", () => {
  const plugin = paragraphSpacePlugin();
  for (const source of [
    "- élément", "# Titre", "> citation", "```js\n\ncode\n```", "---\ntitre: Test\n---\nTexte", "| a | b |\n| - | - |\n| c | d |", "a | b\n-- | --\nc | d",
  ]) {
    const lines = source.split("\n");
    const cursor = source.startsWith("```") ? { line: 1, ch: 0 } : { line: 0, ch: lines[0].length };
    const editor = makeEditor(source, cursor);
    assert.equal(plugin.insertParagraphSpace(editor), false, source);
    assert.equal(editor.getValue(), source);
  }
});
