import test from "node:test";
import assert from "node:assert/strict";
import {
  parseImageMarkdown,
  stripAngleBrackets,
  imageTargetNeedsAngleBrackets,
  formatImageTarget,
  escapeImageCaption,
  formatPlainImageMarkdown,
  formatCaptionedImageMarkdown,
  findImageEmbedsInMarkdown,
} from "../src/services/image-markdown.js";

/* Shared image-Markdown parser/formatter — the single rule reused by
   Continu (cm-scrivenings-markdown.ts), the Pandoc package (compile-
   export.ts), and the add/edit/remove caption editor actions. */

test("plain wikilink embed: no caption, no size", () => {
  assert.deepEqual(parseImageMarkdown("![[image.png]]"), { syntax: "wikilink", target: "image.png" });
});

test("nested-path wikilink embed", () => {
  assert.deepEqual(parseImageMarkdown("![[folder/image.png]]"), { syntax: "wikilink", target: "folder/image.png" });
});

test("wikilink with a width alias: never a caption", () => {
  assert.deepEqual(parseImageMarkdown("![[image.png|300]]"), { syntax: "wikilink", target: "image.png", width: 300 });
});

test("wikilink with a width x height alias", () => {
  assert.deepEqual(parseImageMarkdown("![[image.png|300x200]]"), { syntax: "wikilink", target: "image.png", width: 300, height: 200 });
});

test("standard Markdown syntax with a caption", () => {
  assert.deepEqual(parseImageMarkdown("![Caption](image.png)"), { syntax: "markdown", target: "image.png", caption: "Caption" });
});

test("standard Markdown syntax, no caption at all: alt is absent, not an empty string", () => {
  const parsed = parseImageMarkdown("![](image.png)");
  assert.equal(parsed.syntax, "markdown");
  assert.equal(parsed.target, "image.png");
  assert.equal("caption" in parsed, false);
});

test("angle-bracket destination containing spaces", () => {
  assert.deepEqual(
    parseImageMarkdown("![Caption](<Pasted image 20260927 130801.png>)"),
    { syntax: "markdown", target: "Pasted image 20260927 130801.png", caption: "Caption" }
  );
});

test("URI-encoded destination is kept encoded (decoding is a resolution-time concern, not this parser's)", () => {
  assert.deepEqual(
    parseImageMarkdown("![Caption](folder/image%20name.png)"),
    { syntax: "markdown", target: "folder/image%20name.png", caption: "Caption" }
  );
});

test("accented/Unicode filename", () => {
  assert.deepEqual(parseImageMarkdown("![Vue générale](Vue générale à l'aube.png)"), {
    syntax: "markdown",
    target: "Vue générale à l'aube.png",
    caption: "Vue générale",
  });
});

test("French punctuation and Unicode inside the caption itself", () => {
  const parsed = parseImageMarkdown("![L'aube — « vue générale »](image.png)");
  assert.equal(parsed.caption, "L'aube — « vue générale »");
});

test("not an image embed at all: null", () => {
  assert.equal(parseImageMarkdown("Some plain text."), null);
  assert.equal(parseImageMarkdown("[[note.md]]"), null); // no leading "!": not an embed
  assert.equal(parseImageMarkdown("![note without target]()"), null);
});

test("a non-image extension is still parsed (extension filtering is each caller's own job — see cm-scrivenings-markdown.ts, image-caption-actions.ts)", () => {
  assert.deepEqual(parseImageMarkdown("![[note.md]]"), { syntax: "wikilink", target: "note.md" });
});

test("stripAngleBrackets: only strips a genuine wrapping, never a bare target", () => {
  assert.equal(stripAngleBrackets("<a b.png>"), "a b.png");
  assert.equal(stripAngleBrackets("plain.png"), "plain.png");
  assert.equal(stripAngleBrackets("<>"), "");
});

test("imageTargetNeedsAngleBrackets / formatImageTarget", () => {
  assert.equal(imageTargetNeedsAngleBrackets("image.png"), false);
  assert.equal(imageTargetNeedsAngleBrackets("Pasted image 1.png"), true);
  assert.equal(formatImageTarget("image.png"), "image.png");
  assert.equal(formatImageTarget("Pasted image 1.png"), "<Pasted image 1.png>");
});

test("escapeImageCaption: backslash and both brackets are escaped, parentheses and everything else are left alone", () => {
  assert.equal(escapeImageCaption("a\\b"), "a\\\\b");
  assert.equal(escapeImageCaption("caption]done"), "caption\\]done");
  assert.equal(escapeImageCaption("(parens) [brackets]"), "(parens) \\[brackets\\]");
  assert.equal(escapeImageCaption("Légende à l'aube — « ici »"), "Légende à l'aube — « ici »");
});

test("formatPlainImageMarkdown / formatCaptionedImageMarkdown", () => {
  assert.equal(formatPlainImageMarkdown("image.png"), "![[image.png]]");
  assert.equal(formatCaptionedImageMarkdown("image.png", "Ceci est la légende"), "![Ceci est la légende](image.png)");
  assert.equal(
    formatCaptionedImageMarkdown("Pasted image 20260927 130801.png", "Ceci est la légende"),
    "![Ceci est la légende](<Pasted image 20260927 130801.png>)"
  );
});

test("round-trip: a formatted captioned image parses back to the same target and caption", () => {
  const target = "folder/Pasted image 20260927 130801.png";
  const caption = "Vue générale du site en 1923, avec [annotations] et un \\backslash";
  const markdown = formatCaptionedImageMarkdown(target, caption);
  const parsed = parseImageMarkdown(markdown);
  assert.equal(parsed.target, target);
  assert.equal(parsed.caption, caption);
});

test("round-trip: a caption containing ']', '[', '\\', or a mix, never truncates it or corrupts the target on re-parse", () => {
  for (const caption of ["a]b", "a\\b", "text (parens) and ] bracket", "trailing bracket]", "[leading bracket]"]) {
    const markdown = formatCaptionedImageMarkdown("image.png", caption);
    const parsed = parseImageMarkdown(markdown);
    assert.equal(parsed.target, "image.png", `target survives for caption ${JSON.stringify(caption)}`);
    assert.equal(parsed.caption, caption, `caption round-trips for ${JSON.stringify(caption)}`);
  }
});

test("round-trip: caption starting with '[' is a Markdown image, never mistaken for a wikilink", () => {
  const markdown = formatCaptionedImageMarkdown("image avec espaces.png", "[Carte] Vue générale");
  assert.equal(markdown, "![\\[Carte\\] Vue générale](<image avec espaces.png>)");
  const parsed = parseImageMarkdown(markdown);
  assert.equal(parsed.syntax, "markdown");
  assert.equal(parsed.target, "image avec espaces.png");
  assert.equal(parsed.caption, "[Carte] Vue générale");
});

test("round-trip: caption containing the literal sequence '](' is not mistaken for the real terminator", () => {
  const caption = "Texte ]( inhabituel mais valide comme contenu";
  const markdown = formatCaptionedImageMarkdown("image.png", caption);
  const parsed = parseImageMarkdown(markdown);
  assert.equal(parsed.target, "image.png");
  assert.equal(parsed.caption, caption);
});

test("round-trip: caption containing a literal backslash", () => {
  const caption = "Une légende avec \\ caractère";
  const parsed = parseImageMarkdown(formatCaptionedImageMarkdown("image.png", caption));
  assert.equal(parsed.caption, caption);
});

test("round-trip: caption combining parentheses and brackets", () => {
  const caption = "Vue (nord-ouest) [1923]";
  const parsed = parseImageMarkdown(formatCaptionedImageMarkdown("image.png", caption));
  assert.equal(parsed.caption, caption);
});

test("round-trip: combined French/Unicode punctuation together with escaped characters", () => {
  const caption = "« [Carte] » — vue d'ensemble (à l'aube) \\ légende";
  const parsed = parseImageMarkdown(formatCaptionedImageMarkdown("image.png", caption));
  assert.equal(parsed.caption, caption);
});

test("wikilink syntax is never confused with a Markdown caption starting with '['", () => {
  assert.deepEqual(parseImageMarkdown("![[image.png]]"), { syntax: "wikilink", target: "image.png" });
  const captioned = parseImageMarkdown(formatCaptionedImageMarkdown("image.png", "[note]"));
  assert.equal(captioned.syntax, "markdown");
  assert.equal(captioned.caption, "[note]");
});

/* --- findImageEmbedsInMarkdown: whole-document scan (Lot 3) ------------- */

test("wikilink embed is found", () => {
  const embeds = findImageEmbedsInMarkdown("Some prose.\n\n![[photo.jpg]]\n\nMore prose.");
  assert.equal(embeds.length, 1);
  assert.deepEqual(embeds[0], { syntax: "wikilink", target: "photo.jpg" });
});

test("numeric-size wikilink embed is found, with width parsed", () => {
  const embeds = findImageEmbedsInMarkdown("![[photo.jpg|300]]");
  assert.equal(embeds.length, 1);
  assert.deepEqual(embeds[0], { syntax: "wikilink", target: "photo.jpg", width: 300 });
});

test("plain Markdown image is found", () => {
  const embeds = findImageEmbedsInMarkdown("![](photo.jpg)");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "photo.jpg");
});

test("captioned Markdown image is found, with its caption", () => {
  const embeds = findImageEmbedsInMarkdown("![Vue générale](photo.jpg)");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "photo.jpg");
  assert.equal(embeds[0].caption, "Vue générale");
});

test("caption beginning with escaped square brackets is found correctly", () => {
  const embeds = findImageEmbedsInMarkdown(formatCaptionedImageMarkdown("photo.jpg", "[Image 1] Vue générale"));
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].caption, "[Image 1] Vue générale");
});

test("target containing spaces, wrapped in <...>, is found", () => {
  const embeds = findImageEmbedsInMarkdown("![Caption](<Pasted image 20260927 130801.png>)");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "Pasted image 20260927 130801.png");
});

test("a URI-encoded target is found, still encoded (decoding is a resolution-time concern)", () => {
  const embeds = findImageEmbedsInMarkdown("![Caption](folder/image%20name.png)");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "folder/image%20name.png");
});

test("repeated reference to the same image is reported once per occurrence — deduplication is the caller's job", () => {
  const embeds = findImageEmbedsInMarkdown("![[photo.jpg]]\n\nSome prose.\n\n![Again](photo.jpg)");
  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].target, "photo.jpg");
  assert.equal(embeds[1].target, "photo.jpg");
});

test("image syntax inside a fenced code block is ignored", () => {
  const content = [
    "Some prose.",
    "```",
    "![[photo.jpg]]",
    "![Caption](other.jpg)",
    "```",
    "![[real.jpg]]",
  ].join("\n");
  const embeds = findImageEmbedsInMarkdown(content);
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "real.jpg");
});

test("image syntax inside a tilde-fenced code block is ignored too", () => {
  const content = ["~~~", "![[photo.jpg]]", "~~~", "![[real.jpg]]"].join("\n");
  const embeds = findImageEmbedsInMarkdown(content);
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "real.jpg");
});

test("image syntax inside inline code is ignored (the leading backtick already fails the strict prefix check)", () => {
  const embeds = findImageEmbedsInMarkdown("Some prose with `![[photo.jpg]]` shown as code.\n\n![[real.jpg]]");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].target, "real.jpg");
});

test("no embeds at all: empty array", () => {
  assert.deepEqual(findImageEmbedsInMarkdown("Just plain prose, no images at all."), []);
});
