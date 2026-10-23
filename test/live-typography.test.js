import test from "node:test";
import assert from "node:assert/strict";
import { liveTypographyChanges } from "../src/utils/live-typography.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

const enabled = { liveApostrophe: true, liveEllipsis: true };
function convert(text, options = enabled, plain = text, range = { from: 0, to: text.length }, paste = true) {
  let result = text;
  for (const change of liveTypographyChanges(text, [range], options, paste, plain).reverse()) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

test("HTML spaces are repaired only with ordinary-space evidence in text/plain", () => {
  const plain = "La fraternité se construit ensemble.";
  assert.equal(convert(plain.replaceAll(" ", "\u00a0"), enabled, plain), plain);
  assert.equal(convert("**La\u00a0fraternité**\u00a0se\u00a0construit\u00a0ensemble.", enabled, plain), "**La fraternité** se construit ensemble.");
  assert.equal(convert(plain), plain);
});

test("legitimate French spacing, numbers, expressions and Double Enter survive", () => {
  const plain = "La fraternité se construit ensemble : « oui ! » 10 000 euros ; New\u00a0York.\n\n\u00a0\n\nSuite.";
  const source = plain.replaceAll(" ", "\u00a0");
  const expected = "La fraternité se construit ensemble\u00a0: «\u00a0oui\u00a0!\u00a0»\u00a010\u00a0000\u00a0euros\u00a0; New\u00a0York.\n\n\u00a0\n\nSuite.";
  const out = convert(source, enabled, plain);
  assert.equal(out, expected);
  assert.equal(convert(source, enabled, plain.replace("\n\n\u00a0\n\n", "\n\n \n\n")), expected);
  assert.equal(convert("New\u00a0York", enabled, "New York"), "New\u00a0York");
});

test("ambiguous clipboard representations preserve intentional nonbreaking spaces", () => {
  const source = "La\u00a0fraternité\u00a0se\u00a0construit\u00a0ensemble.";
  assert.equal(convert(source), source);
  assert.equal(convert(source, enabled, undefined), source);
  const ambiguous = "Un mot Un\u00a0mot autre phrase";
  assert.equal(convert("Un\u00a0mot\u00a0autre\u00a0phrase", enabled, ambiguous), "Un\u00a0mot autre phrase");
});

test("pasted prose apostrophes and ellipses follow independent options", () => {
  assert.equal(convert("L'histoire d'un homme... déjà l’été…"), "L’histoire d’un homme… déjà l’été…");
  assert.equal(convert("L'histoire...", { ...enabled, liveApostrophe: false }), "L'histoire…");
  assert.equal(convert("L'histoire...", { ...enabled, liveEllipsis: false }), "L’histoire...");
  assert.equal(convert("L'histoire...", { liveApostrophe: false, liveEllipsis: false }), "L'histoire...");
  assert.equal(DEFAULT_SETTINGS.liveEllipsis, true);
});

test("third typed dot contracts only the new ellipsis; existing text is untouched", () => {
  const source = "L'histoire... Suite...";
  assert.equal(convert(source, enabled, undefined, { from: source.length - 1, to: source.length }, false), "L'histoire... Suite…");
  assert.equal(convert("Quatre...."), "Quatre....");
  assert.equal(convert("Cinq....."), "Cinq.....");
  assert.equal(convert("l'", enabled, undefined, { from: 1, to: 2 }, false), "l’");
});

test("Markdown syntax, YAML, URLs, code, attributes and escapes survive paste", () => {
  for (const technical of [
    "```js\nconst x = 'texte...';\n```", "~~~js\nconst x = 'texte...';\n~~~",
    "```\nl'histoire...", "    l'histoire...", "`l'histoire...`", "``l'histoire...``",
    "---\ntitre: 'l'histoire...'\n---", "---\ntitre: 'l'histoire...'", "---\r\ntitre: 'l'histoire...'\r\n---",
    "[l'histoire...](https://example.test/l'histoire...)", "![l'histoire...](image.png)", "[x]: /l'histoire... 'titre...'",
    "[[l'histoire...|d'un homme...]]", "https://example.test/l'histoire...", "mailto:l'histoire...@example.test",
    "<span title=\"l'histoire...\">", "data-value='l’histoire...'", "$f('x')...$", "\\' \\...",
    "data-value='histoire...", "[texte](local/l'histoire...",
  ]) assert.equal(convert(technical), technical, technical);
  assert.equal(convert("`l'histoire...` et **l'histoire...**"), "`l'histoire...` et **l’histoire…**");
});

test("insertion into an existing technical context is protected", () => {
  for (const [before, after] of [["`l", "histoire...`"], ["---\ntitre: l", "histoire...\n---"], ["[l", "histoire...](dest)"], ["https://x.test/l", "histoire..."]]) {
    const source = before + "'" + after;
    assert.equal(convert(source, enabled, undefined, { from: before.length, to: before.length + 1 }, false), source);
  }
});
