import assert from "node:assert/strict";
import test from "node:test";
import { ProjectView } from "../src/views/project-view.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  addEventListener(type, callback) {
    this.events.set(type, callback);
  }

  empty() {
    this.children = [];
  }

  setText(text) {
    this.text = String(text);
    return this;
  }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function createView() {
  const contentEl = new FakeElement();
  const calls = { settingsOpened: 0, openedTab: null, settingsTabRendered: 0 };
  const settingsTab = {
    _activeSettingsTab: "Projet",
    refreshForExternalCallers() { calls.settingsTabRendered += 1; },
  };
  const app = {
    vault: { getAbstractFileByPath: () => null },
    setting: {
      open() { calls.settingsOpened += 1; },
      openTabById(id) { calls.openedTab = id; },
      activeTab: settingsTab,
    },
  };
  const plugin = {
    settings: {},
  };
  const view = new ProjectView({ app, contentEl }, plugin);
  return { view, contentEl, calls, settingsTab };
}

async function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag, options) => new FakeElement(tag, options) };
  try {
    await run();
  } finally {
    globalThis.document = previousDocument;
  }
}

test("ProjectView ne crée plus de panneau Compilation / Export", async () => {
  await withFakeDocument(async () => {
    const { view, contentEl } = createView();
    await view.render();

    assert.equal(allElements(contentEl).some((element) => element.classes.has("feuillets-project-section")), true);
    assert.equal(allElements(contentEl).some((element) => element.tag === "select"), false);
    assert.equal(allElements(contentEl).some((element) => element.classes.has("feuillets-export-cta-btn")), false);
  });
});

test("ProjectView ouvre l'onglet Export central sans dupliquer de réglage", async () => {
  await withFakeDocument(async () => {
    const { view, contentEl, calls, settingsTab } = createView();
    await view.render();
    const settingsRow = allElements(contentEl).find((element) => element.classes.has("feuillets-project-row"));
    settingsRow.events.get("click")();

    assert.equal(calls.settingsOpened, 1);
    assert.equal(calls.openedTab, "feuillets");
    assert.equal(settingsTab._activeSettingsTab, "Export");
    assert.equal(calls.settingsTabRendered, 1);
  });
});
