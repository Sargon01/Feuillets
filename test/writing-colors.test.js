import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import FeuilletsPlugin from "../src/main.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/*
 * Custom writing-surface colors: off by default, scoped strictly to
 * Feuillets project editors (.feuillets-project-editor) and Continu
 * ([data-type="feuillets-scrivenings"]) — never Minimal Theme, never a
 * global Obsidian color, never Binder/Board/Preview/Recherche.
 */

const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
const settingTabSource = readFileSync(resolve(process.cwd(), "src/settings/feuillets-setting-tab.ts"), "utf8");
const stylesSource = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/** Minimal fake `document.body`: only the surface applyWritingColors()
 * actually calls (toggleClass, style.setProperty/removeProperty). */
function fakeBody() {
  const body = {
    classes: new Set(),
    styleProps: {},
    toggleClass(cls, on) { on ? this.classes.add(cls) : this.classes.delete(cls); },
    style: {
      setProperty: (name, value) => { body.styleProps[name] = value; },
      removeProperty: (name) => { delete body.styleProps[name]; },
    },
  };
  return body;
}

function withFakeDocument(run) {
  const previous = globalThis.document;
  const body = fakeBody();
  globalThis.document = { body };
  try {
    return run(body);
  } finally {
    globalThis.document = previous;
  }
}

/* ===================== Test A — defaults ===================== */

test("Test A — writingColorsEnabled defaults to false, a fresh install sees no visual change", () => {
  assert.equal(DEFAULT_SETTINGS.writingColorsEnabled, false);
  assert.equal(DEFAULT_SETTINGS.writingBackgroundColor, "#292d25");
  assert.equal(DEFAULT_SETTINGS.writingTextColor, "#c4b49b");
});

/* ===================== Tests B/C/D — applyWritingColors() ===================== */

test("Test B — applyWritingColors(): disabled leaves no class and no custom properties", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: { writingColorsEnabled: false, writingBackgroundColor: "#292d25", writingTextColor: "#c4b49b" } };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), false);
    assert.equal("--feuillets-writing-background" in body.styleProps, false);
    assert.equal("--feuillets-writing-text" in body.styleProps, false);
  });
});

test("Test C — applyWritingColors(): enabled with valid colors sets the class and both custom properties exactly", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: { writingColorsEnabled: true, writingBackgroundColor: "#292d25", writingTextColor: "#c4b49b" } };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), true);
    assert.equal(body.styleProps["--feuillets-writing-background"], "#292d25");
    assert.equal(body.styleProps["--feuillets-writing-text"], "#c4b49b");
  });
});

test("Test C bis — applyWritingColors(): an invalid stored color (hand-edited data.json) fails closed, never injected into CSS", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: { writingColorsEnabled: true, writingBackgroundColor: "not-a-color", writingTextColor: "#c4b49b" } };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), false);
    assert.equal("--feuillets-writing-background" in body.styleProps, false);
    assert.equal("--feuillets-writing-text" in body.styleProps, false);
  });
});

test("Test D — enabling then disabling removes the class and both properties; nothing from the theme is ever copied into settings", () => {
  withFakeDocument((body) => {
    const settings = { writingColorsEnabled: true, writingBackgroundColor: "#292d25", writingTextColor: "#c4b49b" };
    const fakePlugin = { settings };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), true);

    settings.writingColorsEnabled = false;
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);

    assert.equal(body.classes.has("feuillets-writing-colors"), false);
    assert.equal("--feuillets-writing-background" in body.styleProps, false);
    assert.equal("--feuillets-writing-text" in body.styleProps, false);
    // Disabling never records a theme-derived color anywhere in settings.
    assert.equal(settings.writingBackgroundColor, "#292d25");
    assert.equal(settings.writingTextColor, "#c4b49b");
    assert.equal(Object.keys(settings).length, 3, "no extra field was ever written by applyWritingColors");
  });
});

/* ===================== Test E — onunload() cleanup ===================== */

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(end, -1, `${nextSignature} must exist`);
  return source.slice(start, end);
}

test("Test E — onunload() removes the writing-colors class and both custom properties", () => {
  const body = methodBody(mainSource, "onunload() {", "patchTabTitles()");
  assert.match(body, /document\.body\.removeClass\("feuillets-writing-colors"\)/);
  assert.match(body, /document\.body\.style\.removeProperty\("--feuillets-writing-background"\)/);
  assert.match(body, /document\.body\.style\.removeProperty\("--feuillets-writing-text"\)/);
});

test("applyWritingColors() is called at load time, alongside the other appearance classes", () => {
  assert.match(
    mainSource,
    /this\.applyIndentClass\(\);\s*this\.applyLeanInterfaceClasses\(\);\s*this\.applyWritingColors\(\);/
  );
});

/* ===================== Tests F/G/H — CSS scope ===================== */

function cssRuleFor(marker) {
  const start = stylesSource.indexOf(marker);
  assert.notEqual(start, -1, `CSS rule containing "${marker}" must exist`);
  const end = stylesSource.indexOf("}", start);
  return stylesSource.slice(start, end + 1);
}

test("Test F — the writing-colors CSS rule targets .feuillets-project-editor, never a global Markdown selector", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .feuillets-project-editor");
  assert.match(rule, /\.feuillets-project-editor/);
  assert.doesNotMatch(rule, /^\s*\.markdown-source-view\s*\{/m, "never a bare global .markdown-source-view rule");
});

test("Test G — the writing-colors CSS rule also targets Continu via [data-type=\"feuillets-scrivenings\"], same variables", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .feuillets-project-editor");
  assert.match(rule, /\[data-type="feuillets-scrivenings"\]/);
  assert.match(rule, /--background-primary:\s*var\(--feuillets-writing-background\)/);
  assert.match(rule, /--text-normal:\s*var\(--feuillets-writing-text\)/);
});

test("Test H — the writing-colors rule never targets Board/Preview/Recherche surfaces", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .feuillets-project-editor");
  assert.doesNotMatch(rule, /feuillets-board/);
  assert.doesNotMatch(rule, /feuillets-preview/);
  assert.doesNotMatch(rule, /feuillets-research/);
});

test("applyWritingColors() never reads or writes Style Settings / Minimal Theme's own configuration", () => {
  const method = methodBody(mainSource, "applyWritingColors(): void {", "\n  }");
  // The only externally-visible effects are the class toggle and the two
  // Feuillets-prefixed custom properties — no other API surface touched.
  assert.doesNotMatch(method, /styleSettings|obsidian-style-settings|minimalSettings/i);
  assert.match(method, /toggleClass\("feuillets-writing-colors"/);
  assert.match(method, /setProperty\("--feuillets-writing-background"/);
  assert.match(method, /setProperty\("--feuillets-writing-text"/);
});

/* ===================== Test I — settings UI ===================== */

test("Test I — Interface -> Apparence exposes the three writing-colors controls with the FR/EN i18n keys", () => {
  const section = methodBody(settingTabSource, 'settings.accentColor.name")', 'settings.section.focusMode")');
  assert.match(section, /t\("settings\.writingColors\.section"\)/);
  assert.match(section, /t\("settings\.writingColors\.enabled\.name"\)/);
  assert.match(section, /t\("settings\.writingColors\.enabled\.desc"\)/);
  assert.match(section, /t\("settings\.writingColors\.background\.name"\)/);
  assert.match(section, /t\("settings\.writingColors\.text\.name"\)/);
  assert.match(section, /addToggle/);
  assert.match(section, /addColorPicker/);

  for (const [locale, file] of [["fr", "src/i18n/fr.ts"], ["en", "src/i18n/en.ts"]]) {
    const dict = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const key of [
      "settings.writingColors.section",
      "settings.writingColors.enabled.name",
      "settings.writingColors.enabled.desc",
      "settings.writingColors.background.name",
      "settings.writingColors.text.name",
    ]) {
      assert.match(dict, new RegExp(`"${key.replace(/\./g, "\\.")}":`), `${key} must exist in ${locale}`);
    }
  }
});

/* ===================== Test J — immediate application ===================== */

test("Test J — each of the three controls calls saveSettings() then applyWritingColors(), no full plugin reload", () => {
  const section = methodBody(settingTabSource, 'settings.accentColor.name")', 'settings.section.focusMode")');
  const occurrences = section.match(/await this\.plugin\.saveSettings\(\);\s*this\.plugin\.applyWritingColors\(\);/g) || [];
  assert.equal(occurrences.length, 3, "enabled toggle + background picker + text picker, each applying immediately");
});
