import test from "node:test";
import assert from "node:assert/strict";
import { applyCarnetFont, normalizeCarnetFont } from "../src/carnet/canvas/font.js";
import { createCarnetLifecycle } from "../src/carnet/core/lifecycle.js";

function element() {
  const props = new Map(), classes = new Set();
  return { props, classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), remove: (...keys) => keys.forEach((key) => classes.delete(key)) },
    style: { getPropertyValue: (key) => props.get(key) ?? "", setProperty: (key, value) => props.set(key, value), removeProperty: (key) => props.delete(key) } };
}

test("font family is optional, escaped as one family, and has a theme fallback", () => {
  const el = element();
  assert.equal(normalizeCarnetFont(undefined), "");
  assert.equal(normalizeCarnetFont("  Avenir Next  "), "Avenir Next");
  assert.equal(applyCarnetFont(el, "Georgia"), true);
  assert.equal(el.props.get("--feuillets-carnet-font"), '"Georgia", var(--font-text)');
  assert.equal(applyCarnetFont(el, "Georgia"), false);
  assert.equal(applyCarnetFont(el, 'Unknown; "font", name'), true);
  assert.equal(el.props.get("--feuillets-carnet-font"), '"Unknown; \\"font\\", name", var(--font-text)');
  assert.equal(applyCarnetFont(el, ""), true); assert.equal(el.props.size, 0);
  assert.equal(applyCarnetFont(el, ""), false);
});

test("lifecycle applies font only to recognized Carnets, updates every open view and cleans rebuilt views", () => {
  const make = (path) => ({ view: { file: { path }, containerEl: element() } });
  const a = make("A.canvas"), b = make("B.canvas"), ordinary = make("Ordinary.canvas");
  let leaves = [a, b, ordinary], font = "Palatino";
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => leaves } }, (file) => file?.path !== "Ordinary.canvas", undefined, undefined, () => ({ font }));
  lifecycle.refresh();
  for (const leaf of [a, b]) assert.equal(leaf.view.containerEl.props.get("--feuillets-carnet-font"), '"Palatino", var(--font-text)');
  assert.equal(ordinary.view.containerEl.props.size, 0);
  font = "Baskerville"; lifecycle.refresh(); assert.match(a.view.containerEl.props.get("--feuillets-carnet-font"), /Baskerville/);
  const previous = a.view.containerEl; a.view.containerEl = element(); leaves = [a, ordinary]; lifecycle.refresh();
  assert.equal(previous.props.size, 0); assert.equal(b.view.containerEl.props.size, 0);
  assert.match(a.view.containerEl.props.get("--feuillets-carnet-font"), /Baskerville/);
  font = ""; lifecycle.refresh(); assert.equal(a.view.containerEl.props.size, 0);
  font = "Georgia"; lifecycle.refresh(); lifecycle.cleanup(); assert.equal(a.view.containerEl.props.size, 0);
});
