import test from "node:test";
import assert from "node:assert/strict";
import { Modal, Notice, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { exportDestination, exportFileName, writeExportDestination } from "../src/services/export-destination.js";
import { exportResultActions, presentExportResult } from "../src/services/export-result.js";
import { ExportDestinationModal } from "../src/ui/export-destination-modal.js";
import { t } from "../src/i18n/index.js";

function fixture() {
  const folder = new TFolder("Delivery");
  const { vault } = createFakeVault([folder]);
  return { vault, workspace: { openLinkText: async () => {}, getLeavesOfType: () => [] } };
}

for (const extension of ["md", "docx", "epub", "odt", "zip"]) {
  test(`file name validation and extension: ${extension}`, () => {
    assert.equal(exportFileName("Bozlak - Version éditeur", extension), `Bozlak - Version éditeur.${extension}`);
    assert.equal(exportFileName(`Book.${extension.toUpperCase()}`, extension), `Book.${extension}`);
    assert.equal(exportFileName("Book.pdf", extension), `Book.${extension}`);
    for (const invalid of ["", " ", ".", "..", "../Book", "Book/Part", "Book\\Part", "Book?", "Book.", "NUL", "CON.txt", "COM1", "bad\u0000name"]) {
      assert.throws(() => exportFileName(invalid, extension), undefined, invalid);
    }
  });
}

test("vault destination validates folders, supports vault root, rejects path traversal", () => {
  const app = fixture();
  assert.deepEqual(exportDestination(app, "Delivery", "Custom.docx", "docx"), { path: "Delivery/Custom.docx" });
  assert.deepEqual(exportDestination(app, "", "Custom", "docx"), { path: "Custom.docx" });
  for (const folder of ["../Outside", "Delivery/../Outside", "C:\\Outside", "./Delivery"]) {
    assert.throws(() => exportDestination(app, folder, "Book", "md"));
  }
});

test("exclusive writer refuses exact and case-insensitive collisions", async () => {
  const app = fixture();
  await app.vault.create("Delivery/Book.md", "original");
  await assert.rejects(writeExportDestination(app, { path: "Delivery/Book.md" }, "replacement"));
  await assert.rejects(writeExportDestination(app, { path: "Delivery/book.md" }, "replacement"));
  assert.equal(await app.vault.read(app.vault.getAbstractFileByPath("Delivery/Book.md")), "original");
});

test("exclusive writer never turns a racing create failure into a modify", async () => {
  const app = fixture();
  app.vault.create = async () => { throw new Error("File already exists."); };
  app.vault.modify = async () => { assert.fail("must not modify a racing file"); };
  await assert.rejects(writeExportDestination(app, { path: "Delivery/Book.md" }, "text"), /already exists/);
});

test("writer returns the path returned by Obsidian and respects typed-array byte offsets", async () => {
  const app = fixture();
  const bytes = new Uint8Array([99, 1, 2, 88]).subarray(1, 3);
  app.vault.createBinary = async (path, buffer) => {
    assert.equal(path, "Delivery/Book.docx");
    assert.deepEqual([...new Uint8Array(buffer)], [1, 2]);
    return { path: "Actual/Book.docx" };
  };
  assert.equal(await writeExportDestination(app, { path: "Delivery/Book.docx" }, bytes), "Actual/Book.docx");
});

test("Obsidian save modal accepts custom name/destination and resolves once", () => {
  const app = fixture();
  const choices = [];
  const modal = new ExportDestinationModal(app, { fileName: "Manuscrit.docx", folderPath: "Delivery", extension: "docx" }, (choice) => choices.push(choice));
  modal.onOpen();
  const inputs = modal.contentEl.querySelectorAll("input");
  assert.equal(inputs[0].value, "Manuscrit.docx");
  inputs[0].value = "Bozlak - Version éditeur.docx";
  inputs[0].dispatchEvent({ type: "input" });
  inputs[1].value = "Editor";
  inputs[1].dispatchEvent({ type: "input" });
  modal.contentEl.querySelectorAll("button").find((button) => button.textContent === t("export.save.action")).click();
  modal.onClose();
  assert.deepEqual(choices, [{ path: "Editor/Bozlak - Version éditeur.docx" }]);
  assert.equal(app.vault.getAbstractFileByPath("Editor"), null, "choosing does not create the folder");
});

test("Obsidian save modal collision keeps the dialog open; dismissal cancels without writing", async () => {
  const app = fixture();
  await app.vault.create("Delivery/Book.md", "original");
  const choices = [];
  const modal = new ExportDestinationModal(app, { fileName: "Book.md", folderPath: "Delivery", extension: "md" }, (choice) => choices.push(choice));
  modal.onOpen();
  modal.contentEl.querySelectorAll("button").find((button) => button.textContent === t("export.save.action")).click();
  assert.deepEqual(choices, []);
  modal.onClose();
  modal.onClose();
  assert.deepEqual(choices, [null]);
  assert.equal(app.vault.getFiles().length, 1);
});

test("desktop actions pass the actual adapter path to the default app and Finder/Explorer", async () => {
  const app = fixture();
  await app.vault.create("Delivery/Custom.docx", "binary");
  app.vault.adapter = { getFullPath: (path) => `/real/vault/${path}` };
  const calls = [];
  const actions = exportResultActions(app, "Delivery/Custom.docx", {
    openPath: async (path) => { calls.push(["open", path]); return ""; },
    showItemInFolder: (path) => { calls.push(["reveal", path]); },
  });
  await actions.open();
  await actions.reveal();
  assert.deepEqual(calls, [["open", "/real/vault/Delivery/Custom.docx"], ["reveal", "/real/vault/Delivery/Custom.docx"]]);
});

test("without desktop APIs, open uses Obsidian and reveal selects the file in its explorer", async () => {
  const app = fixture();
  const file = await app.vault.create("Delivery/Book.md", "text");
  const calls = [];
  const leaf = { view: { revealInFolder: (value) => { assert.equal(value, file); calls.push("select"); } } };
  app.workspace.openLinkText = async (...args) => { calls.push(args); };
  app.workspace.getLeavesOfType = () => [leaf];
  app.workspace.revealLeaf = async (value) => { assert.equal(value, leaf); calls.push("explorer"); };
  const actions = exportResultActions(app, file.path, null);
  await actions.open();
  await actions.reveal();
  assert.deepEqual(calls, [[file.path, "", true], "explorer", "select"]);
});

test("without reveal API, a location modal shows the exact vault path", async () => {
  const app = fixture();
  const file = await app.vault.create("Delivery/Book.md", "text");
  const previous = Modal.prototype.open;
  let shown;
  Modal.prototype.open = function () { this.onOpen(); shown = this; };
  try {
    await exportResultActions(app, file.path, null).reveal();
    assert.equal(shown.contentEl.querySelector("p").textContent, t("export.result.location", { path: file.path }));
    assert.ok(shown.contentEl.querySelector("button"));
  } finally { Modal.prototype.open = previous; }
});

test("failed native open falls back to Obsidian; deleted output has no action", async () => {
  const app = fixture();
  const file = await app.vault.create("Delivery/Book.md", "text");
  app.vault.adapter = { getFullPath: (path) => `/real/${path}` };
  const opened = [];
  app.workspace.openLinkText = async (path) => { opened.push(path); };
  const actions = exportResultActions(app, file.path, { openPath: async () => "no application", showItemInFolder: () => {} });
  await actions.open();
  assert.deepEqual(opened, [file.path]);
  await app.vault.delete(file);
  await assert.rejects(actions.open());
  await assert.rejects(actions.reveal());
});

test("completion notice exposes both actions for the exact written file", async () => {
  const app = fixture();
  const file = await app.vault.create("Delivery/Book.md", "text");
  const previousCreateFragment = globalThis.createFragment;
  const previousNotice = Notice.onCreate;
  const buttons = [];
  let message;
  const fragment = { appendText: () => {}, createEl: (_tag, options) => {
    const button = { text: options.text, addEventListener: (_event, callback) => { button.callback = callback; } };
    buttons.push(button);
    return button;
  } };
  const opened = [];
  app.workspace.openLinkText = async (path) => { opened.push(path); };
  globalThis.createFragment = () => fragment;
  Notice.onCreate = (value) => { message = value; };
  try {
    presentExportResult(app, file.path);
    assert.equal(message, fragment);
    assert.deepEqual(buttons.map((button) => button.text), [t("export.result.open"), t("export.result.reveal")]);
    buttons[0].callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(opened, [file.path]);
  } finally { globalThis.createFragment = previousCreateFragment; Notice.onCreate = previousNotice; }
});
