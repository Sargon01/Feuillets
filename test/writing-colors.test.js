import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import FeuilletsPlugin, { migrateWritingColorSettings } from "../src/main.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/*
 * Custom writing-surface colors: off by default, scoped strictly to
 * MarkdownViews of any known Feuillets project (.feuillets-writing-editor —
 * a broader, independent class from .feuillets-project-editor, see the
 * project-switch scenario covered by deferred-views-project-editor-sync.test.js)
 * and Continu ([data-type="feuillets-scrivenings"]) — never Minimal Theme,
 * never a global Obsidian color, never Binder/Board/Preview/Recherche.
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
    classList: {
      contains: (cls) => body.classes.has(cls),
    },
    style: {
      setProperty: (name, value) => { body.styleProps[name] = value; },
      removeProperty: (name) => { delete body.styleProps[name]; },
    },
  };
  return body;
}

function writingSettings(overrides = {}) {
  return {
    writingColorsEnabled: true,
    writingBackgroundColor: "#292d25",
    writingTextColor: "#c4b49b",
    writingLightBackgroundColor: "#f5f1e8",
    writingLightTextColor: "#332b20",
    writingDarkBackgroundColor: "#292d25",
    writingDarkTextColor: "#c4b49b",
    ...overrides,
  };
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
  assert.equal(DEFAULT_SETTINGS.writingLightBackgroundColor, "#F7F4ED");
  assert.equal(DEFAULT_SETTINGS.writingLightTextColor, "#2E2B26");
  assert.equal(DEFAULT_SETTINGS.writingDarkBackgroundColor, "#282B24");
  assert.equal(DEFAULT_SETTINGS.writingDarkTextColor, "#C2B49A");
});

/* ===================== Tests B/C/D — applyWritingColors() ===================== */

test("Test B — applyWritingColors(): disabled leaves no class and no custom properties", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: writingSettings({ writingColorsEnabled: false }) };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), false);
    assert.equal("--feuillets-writing-background" in body.styleProps, false);
    assert.equal("--feuillets-writing-text" in body.styleProps, false);
  });
});

test("Test C — applyWritingColors(): light mode applies the light pair", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: writingSettings() };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), true);
    assert.equal(body.styleProps["--feuillets-writing-background"], "#f5f1e8");
    assert.equal(body.styleProps["--feuillets-writing-text"], "#332b20");
  });
});

test("Test C bis — applyWritingColors(): dark mode applies the dark pair and updates immediately after a theme change", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: writingSettings() };
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    body.classes.add("theme-dark");
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), true);
    assert.equal(body.styleProps["--feuillets-writing-background"], "#292d25");
    assert.equal(body.styleProps["--feuillets-writing-text"], "#c4b49b");
  });
});

test("Test C ter — applyWritingColors(): an invalid selected color fails closed, never injected into CSS", () => {
  withFakeDocument((body) => {
    const fakePlugin = { settings: writingSettings({ writingDarkBackgroundColor: "not-a-color" }) };
    body.classes.add("theme-dark");
    FeuilletsPlugin.prototype.applyWritingColors.call(fakePlugin);
    assert.equal(body.classes.has("feuillets-writing-colors"), false);
    assert.equal("--feuillets-writing-background" in body.styleProps, false);
    assert.equal("--feuillets-writing-text" in body.styleProps, false);
  });
});

test("Test D — enabling then disabling removes the class and both properties; nothing from the theme is ever copied into settings", () => {
  withFakeDocument((body) => {
    const settings = writingSettings();
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
    assert.equal(Object.keys(settings).length, 7, "no extra field was ever written by applyWritingColors");
  });
});

test("writing-color migration copies legacy values only into missing theme-specific fields", () => {
  const settings = writingSettings({
    writingBackgroundColor: "#123456",
    writingTextColor: "#abcdef",
    writingLightBackgroundColor: "#292d25",
    writingLightTextColor: "#c4b49b",
    writingDarkBackgroundColor: "#292d25",
    writingDarkTextColor: "#c4b49b",
  });
  const changed = migrateWritingColorSettings(settings, {
    writingBackgroundColor: "#123456",
    writingTextColor: "#abcdef",
  });
  assert.equal(changed, true);
  assert.equal(settings.writingLightBackgroundColor, "#123456");
  assert.equal(settings.writingLightTextColor, "#abcdef");
  assert.equal(settings.writingDarkBackgroundColor, "#123456");
  assert.equal(settings.writingDarkTextColor, "#abcdef");

  settings.writingDarkBackgroundColor = "#010203";
  const preserved = migrateWritingColorSettings(settings, {
    writingBackgroundColor: "#123456",
    writingTextColor: "#abcdef",
    writingLightBackgroundColor: "#123456",
    writingLightTextColor: "#abcdef",
    writingDarkBackgroundColor: "#010203",
    writingDarkTextColor: "#abcdef",
  });
  assert.equal(preserved, false);
  assert.equal(settings.writingDarkBackgroundColor, "#010203");
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

test("theme changes reapply writing colors through the workspace css-change event", () => {
  assert.match(
    mainSource,
    /this\.registerEvent\(this\.app\.workspace\.on\("css-change", \(\) => this\.applyWritingColors\(\)\)\);/
  );
});

/* ===================== Tests F/G/H — CSS scope ===================== */

function cssRuleFor(marker) {
  const start = stylesSource.indexOf(marker);
  assert.notEqual(start, -1, `CSS rule containing "${marker}" must exist`);
  const end = stylesSource.indexOf("}", start);
  return stylesSource.slice(start, end + 1);
}

test("Test F — the writing-colors CSS rule targets .feuillets-writing-editor, never a global Markdown selector", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .workspace-leaf-content[data-type=\"markdown\"] .feuillets-writing-editor");
  assert.match(rule, /\.feuillets-writing-editor/);
  assert.doesNotMatch(rule, /^\s*\.markdown-source-view\s*\{/m, "never a bare global .markdown-source-view rule");
});

test("Test G — the writing-colors CSS rule also targets Continu via [data-type=\"feuillets-scrivenings\"], same variables", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .workspace-leaf-content[data-type=\"markdown\"] .feuillets-writing-editor");
  assert.match(rule, /\[data-type="feuillets-scrivenings"\]/);
  assert.match(rule, /--background-primary:\s*var\(--feuillets-writing-background\)/);
  assert.match(rule, /--text-normal:\s*var\(--feuillets-writing-text\)/);
});

test("Test H — the writing-colors rule never targets Board/Preview/Recherche surfaces", () => {
  const rule = cssRuleFor("body.feuillets-writing-colors .workspace-leaf-content[data-type=\"markdown\"] .feuillets-writing-editor");
  assert.doesNotMatch(rule, /feuillets-board/);
  assert.doesNotMatch(rule, /feuillets-preview/);
  assert.doesNotMatch(rule, /feuillets-research/);
});

/* ===== bug fix: default Obsidian theme's .cm-content text color ===== */

function fullFeatureBlock() {
  const start = stylesSource.indexOf("custom writing colors");
  assert.notEqual(start, -1, "the writing-colors CSS section must exist");
  // Second rule's own closing brace: the .cm-content selector is unique
  // enough on its own to anchor past the first (variables) rule.
  const contentRuleStart = stylesSource.indexOf(".cm-content {", start);
  assert.notEqual(contentRuleStart, -1, "the .cm-content color rule must exist");
  const end = stylesSource.indexOf("}", contentRuleStart);
  return stylesSource.slice(start, end + 1);
}

test("Test K — .cm-content receives color: var(--feuillets-writing-text) for both the writing editor and Continu", () => {
  const block = fullFeatureBlock();
  assert.match(block, /\.feuillets-writing-editor\s+\.markdown-source-view\.mod-cm6\s+\.cm-content/, "targets the writing editor's CM6 content layer");
  assert.match(block, /\[data-type="feuillets-scrivenings"\]\s+\.cm-content/, "targets Continu's content layer");
  // The color declaration must belong to the .cm-content rule, not the
  // variables rule above it — isolate the text after the last selector.
  const contentRule = block.slice(block.lastIndexOf(".cm-content"));
  assert.match(contentRule, /color:\s*var\(--feuillets-writing-text\)/);
});

test("Test L — no dangerous wildcard selector (.cm-content * / .feuillets-writing-editor *) — descendants keep their own colors", () => {
  const block = fullFeatureBlock();
  assert.doesNotMatch(block, /\.cm-content\s*\*/, "never every descendant of .cm-content");
  assert.doesNotMatch(block, /\.feuillets-writing-editor\s*\*/, "never every descendant of .feuillets-writing-editor");
  assert.doesNotMatch(block, /!important/);
});

test("no global migration: every other .feuillets-project-editor rule (composition directives, semantic roles, callouts, compact display…) is untouched", () => {
  // The writing-colors feature switched to .feuillets-writing-editor for its
  // OWN two rules only — every other, pre-existing use of
  // .feuillets-project-editor in the stylesheet must still target exactly
  // that class, never be swept into a global find/replace.
  const occurrences = (stylesSource.match(/\.feuillets-project-editor\b/g) || []).length;
  assert.ok(occurrences > 30, `expected the many pre-existing .feuillets-project-editor rules to remain (found ${occurrences})`);
  // Only the two actual CSS selector lines matter here — not the
  // explanatory comment above them, which legitimately names the class it
  // deliberately does NOT use anymore.
  const selectorLines = fullFeatureBlock().split("\n").filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"));
  assert.equal(selectorLines.some((line) => line.includes(".feuillets-project-editor")), false,
    "the writing-colors rules themselves no longer reference .feuillets-project-editor");
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

test("Test I — Interface -> Appearance exposes the enabled toggle and light/dark writing color pairs", () => {
  const section = methodBody(settingTabSource, 'settings.accentColor.name")', 'settings.section.focusMode")');
  assert.match(section, /t\("settings\.writingColors\.section"\)/);
  assert.match(section, /t\("settings\.writingColors\.enabled\.name"\)/);
  assert.match(section, /t\("settings\.writingColors\.enabled\.desc"\)/);
  assert.match(section, /t\("settings\.writingColors\.background\.name"\)/);
  assert.match(section, /t\("settings\.writingColors\.text\.name"\)/);
  assert.match(section, /t\("settings\.writingColors\.lightMode"\)/);
  assert.match(section, /t\("settings\.writingColors\.darkMode"\)/);
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
      "settings.writingColors.lightMode",
      "settings.writingColors.darkMode",
    ]) {
      assert.match(dict, new RegExp(`"${key.replace(/\./g, "\\.")}":`), `${key} must exist in ${locale}`);
    }
  }
});

/* ===================== Test J — immediate application ===================== */

test("Test J — each writing-color control saves and applies immediately, with no full plugin reload", () => {
  const section = methodBody(settingTabSource, 'settings.accentColor.name")', 'settings.section.focusMode")');
  const occurrences = section.match(/await this\.plugin\.saveSettings\(\);\s*this\.plugin\.applyWritingColors\(\);/g) || [];
  assert.equal(occurrences.length, 2, "enabled toggle and the shared color-picker helper apply immediately");
  assert.match(section, /addWritingColorPicker\(t\("settings\.writingColors\.background\.name"\), "writingLightBackgroundColor"\)/);
  assert.match(section, /addWritingColorPicker\(t\("settings\.writingColors\.text\.name"\), "writingLightTextColor"\)/);
  assert.match(section, /addWritingColorPicker\(t\("settings\.writingColors\.background\.name"\), "writingDarkBackgroundColor"\)/);
  assert.match(section, /addWritingColorPicker\(t\("settings\.writingColors\.text\.name"\), "writingDarkTextColor"\)/);
});
