import test from "node:test";
import assert from "node:assert/strict";
import {
  parseScriveningsSegmentFormatting,
  parseScriveningsSegmentFormattingCached,
  clearScriveningsMarkdownCache,
  compositeScriveningsFormatting,
  scriveningsSegmentRanges,
  scriveningsSegmentsInRanges,
  scriveningsGroupIsActive,
  scriveningsHeadingIsActive,
  scriveningsHeadingClass,
  buildScriveningsMarkdownPlan,
  planScriveningsToggleFormatting,
  createScriveningsToggleCommand,
  createScriveningsMarkdownPlugin,
  createScriveningsMarkdownExtensions,
  CM_SCRIVENINGS_EMPHASIS_CLASS,
  CM_SCRIVENINGS_STRONG_CLASS,
} from "../src/utils/cm-scrivenings-markdown.js";
import { scriveningsExtensions } from "../src/utils/cm-scrivenings.js";

// Champ factice pour les tests qui n'ont pas besoin du VRAI
// `scriveningsBoundariesField` de cm-scrivenings.ts (celui-ci n'est jamais
// importé par cm-scrivenings-markdown.ts — voir « SENS DE DÉPENDANCE » en
// tête de ce fichier — il lui est toujours passé en paramètre). N'importe
// quelle valeur convient : le state stub ci-dessous l'ignore.
const FAKE_BOUNDARIES_FIELD = Symbol("scrivenings-boundaries-field-test");

/* ==================== Parsing (par segment, @lezer/markdown) ==================== */

test("parseScriveningsSegmentFormatting : *italique* est reconnu, marqueurs et contenu correctement bornés", () => {
  const { nodes, groups } = parseScriveningsSegmentFormatting("Le *muezzin* appelle.");
  assert.equal(nodes.length, 1);
  const [node] = nodes;
  assert.equal(node.type, "emphasis");
  assert.deepEqual([node.from, node.to], [3, 12]);
  assert.deepEqual([node.contentFrom, node.contentTo], [4, 11]);
  assert.deepEqual([node.openFrom, node.openTo], [3, 4]);
  assert.deepEqual([node.closeFrom, node.closeTo], [11, 12]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], { from: 3, to: 12, marks: [{ from: 3, to: 4 }, { from: 11, to: 12 }] });
});

test("parseScriveningsSegmentFormatting : _italique_ (underscore) reconnu au même titre que *italique*", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le _muezzin_ appelle.");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "emphasis");
  assert.deepEqual([nodes[0].contentFrom, nodes[0].contentTo], [4, 11]);
});

test("parseScriveningsSegmentFormatting : **gras** reconnu", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le **muezzin** appelle.");
  assert.equal(nodes.length, 1);
  const [node] = nodes;
  assert.equal(node.type, "strong");
  assert.deepEqual([node.from, node.to], [3, 14]);
  assert.deepEqual([node.contentFrom, node.contentTo], [5, 12]);
  assert.deepEqual([node.openFrom, node.openTo], [3, 5]);
  assert.deepEqual([node.closeFrom, node.closeTo], [12, 14]);
});

test("parseScriveningsSegmentFormatting : __gras__ (underscore) reconnu au même titre que **gras**", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le __muezzin__ appelle.");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "strong");
});

test("parseScriveningsSegmentFormatting : ***gras italique*** produit deux nœuds imbriqués fusionnés dans UN SEUL groupe de masquage", () => {
  const { nodes, groups } = parseScriveningsSegmentFormatting("Le ***muezzin*** appelle.");
  assert.equal(nodes.length, 2);

  const strong = nodes.find((n) => n.type === "strong");
  const emphasis = nodes.find((n) => n.type === "emphasis");
  assert.deepEqual([emphasis.from, emphasis.to], [3, 16]);
  assert.deepEqual([emphasis.contentFrom, emphasis.contentTo], [4, 15]);
  assert.deepEqual([strong.from, strong.to], [4, 15]);
  assert.deepEqual([strong.contentFrom, strong.contentTo], [6, 13]);

  assert.equal(groups.length, 1, "un seul passage formaté, jamais deux groupes de masquage indépendants");
  assert.deepEqual(groups[0].from, 3);
  assert.deepEqual(groups[0].to, 16);
  assert.deepEqual(
    groups[0].marks.map((m) => [m.from, m.to]),
    [[3, 4], [4, 6], [13, 15], [15, 16]],
    "les 4 marqueurs (simple + double de chaque côté) doivent apparaître ensemble"
  );
});

test("parseScriveningsSegmentFormatting : syntaxe imbriquée valide, **gras *italique* gras**", () => {
  const { nodes, groups } = parseScriveningsSegmentFormatting("Le **gras *italique* gras** fin.");
  assert.equal(nodes.length, 2);
  const strong = nodes.find((n) => n.type === "strong");
  const emphasis = nodes.find((n) => n.type === "emphasis");
  assert.deepEqual([strong.from, strong.to], [3, 27]);
  assert.deepEqual([emphasis.from, emphasis.to], [10, 20]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].marks.map((m) => [m.from, m.to]),
    [[3, 5], [10, 11], [19, 20], [25, 27]]
  );
});

test("parseScriveningsSegmentFormatting : marqueurs échappés jamais interprétés", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le \\*muezzin\\* appelle.");
  assert.equal(nodes.length, 0);
});

test("parseScriveningsSegmentFormatting : astérisques littéraux (flanking CommonMark invalide) non interprétés", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le * espace * ne compte pas.");
  assert.equal(nodes.length, 0);
});

test("parseScriveningsSegmentFormatting : emphase à l'intérieur d'un code inline jamais interprétée", () => {
  const { nodes } = parseScriveningsSegmentFormatting("Le `code *not emphasis*` fin.");
  assert.equal(nodes.length, 0);
});

test("parseScriveningsSegmentFormatting : syntaxe incomplète jamais rendue", () => {
  assert.equal(parseScriveningsSegmentFormatting("*début").nodes.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("**pas fermé").nodes.length, 0);
});

/* ==================== Callouts Markdown dans Continu ==================== */

test("parseScriveningsSegmentFormatting : les callouts sont reconnus uniquement dans un Blockquote", () => {
  const parsed = parseScriveningsSegmentFormatting("> [!warning] Attention\n> Corps");
  assert.equal(parsed.callouts.length, 1);
  assert.equal(parsed.callouts[0].type, "warning");
  assert.equal(parsed.callouts[0].explicitTitle, true);
  assert.equal(parsed.callouts[0].titleFrom !== undefined, true);
  assert.equal(parseScriveningsSegmentFormatting("[!note]").callouts.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("> simple citation").callouts.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("```text\n> [!note]\n```").callouts.length, 0);
});

test("parseScriveningsSegmentFormatting : les suffixes + et - sont acceptés et le label automatique est déterministe", () => {
  const parsed = parseScriveningsSegmentFormatting("> [!question-directrice]+\n> Corps");
  assert.equal(parsed.callouts.length, 1);
  assert.equal(parsed.callouts[0].type, "question-directrice");
  assert.equal(parsed.callouts[0].explicitTitle, false);
  assert.equal(parsed.callouts[0].autoLabel, "Question directrice");
});

test("buildScriveningsMarkdownPlan : un callout inactif masque les marqueurs et décore toutes ses lignes", () => {
  const text = "> [!note]\n> Corps";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.equal(plan.calloutLines.length, 2);
  assert.match(plan.calloutLines[0].classes, /cm-scrivenings-callout-title-auto/);
  assert.match(plan.calloutLines[0].classes, /cm-scrivenings-callout-first/);
  assert.match(plan.calloutLines[1].classes, /cm-scrivenings-callout-last/);
  assert.equal(plan.calloutLines[0].attributes["data-callout-label"], "Note");
  assert.ok(plan.hiddenMarkRanges.some((range) => range.from === 0 && range.to > 1));
});

test("buildScriveningsMarkdownPlan : un callout actif conserve toute sa syntaxe", () => {
  const text = "> [!warning] Attention\n> Corps *italique*";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 3, to: 3 }],
  });
  assert.equal(plan.calloutLines.length, 2);
  assert.ok(plan.calloutLines.every((line) => line.classes.includes("cm-scrivenings-callout-active")));
  assert.equal(plan.hiddenMarkRanges.some((range) => range.from === 0 && range.to === 1), false);
  assert.equal(plan.hiddenMarkRanges.some((range) => text.slice(range.from, range.to).includes("[!warning]")), false);
  assert.equal(plan.styleRanges.some((range) => range.type === "emphasis"), true);
});

test("createScriveningsMarkdownPlugin : un callout produit des décorations de ligne CodeMirror", () => {
  const text = "> [!note]\n> Corps";
  const fakeDoc = { text, get length() { return this.text.length; }, sliceString(from, to) { return this.text.slice(from, to); } };
  const fakeState = {
    doc: fakeDoc,
    selection: { main: { from: 0, to: 0 }, ranges: [] },
    field: () => [],
  };
  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  const instance = new PluginClass({ state: fakeState, visibleRanges: [{ from: 0, to: text.length }] });
  assert.equal(instance.decorations.filter((decoration) => typeof decoration.attributes?.class === "string" && decoration.attributes.class.includes("cm-scrivenings-callout-line")).length, 2);
});

test("compositeScriveningsFormatting : un callout ne traverse jamais une frontière de feuillet", () => {
  const first = "> [!note]\n> A";
  const second = "> B";
  const separator = "\n";
  const segment = { from: 0, to: first.length };
  const composite = compositeScriveningsFormatting(segment, first);
  assert.equal(composite.callouts.length, 1);
  const other = compositeScriveningsFormatting({ from: first.length + separator.length, to: first.length + separator.length + second.length }, second);
  assert.equal(other.callouts.length, 0);
});

test("parseScriveningsSegmentFormatting : images seules wikilink et Markdown sont reconnues avec leurs dimensions", () => {
  const parsed = parseScriveningsSegmentFormatting("![[folder/image.jpg|205]]\n![Carte](image.png)\n![[image.webp|205x300]]");
  assert.equal(parsed.images.length, 3);
  assert.deepEqual(parsed.images[0], { ...parsed.images[0], kind: "wikilink", target: "folder/image.jpg", width: 205 });
  assert.equal(parsed.images[1].kind, "markdown");
  assert.equal(parsed.images[1].alt, "Carte");
  assert.equal(parsed.images[2].width, 205);
  assert.equal(parsed.images[2].height, 300);
  assert.equal(parseScriveningsSegmentFormatting("Texte ![[image.png]]").images.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("![[note.md]]").images.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("```\n![[image.png]]\n```").images.length, 0);
});

test("buildScriveningsMarkdownPlan : une image distante inactive devient un remplacement, active reste éditable", () => {
  const text = "![Carte](https://exemple.com/image.png)";
  const inactive = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.equal(inactive.imageWidgets.length, 1);
  const active = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 4, to: 4 }],
  });
  assert.equal(active.imageWidgets.length, 0);
});

test("createScriveningsMarkdownPlugin : une image produit un widget de remplacement", () => {
  const text = "![Carte](https://exemple.com/image.png)";
  const fakeDoc = { text, get length() { return this.text.length; }, sliceString(from, to) { return this.text.slice(from, to); } };
  const fakeState = { doc: fakeDoc, selection: { main: { from: 0, to: 0 }, ranges: [] }, field: () => [] };
  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  const instance = new PluginClass({ state: fakeState, visibleRanges: [{ from: 0, to: text.length }] });
  const imageDecoration = instance.decorations.find((decoration) => decoration.widget !== undefined);
  assert.ok(imageDecoration);
  assert.equal(imageDecoration.block, undefined);
  assert.deepEqual([imageDecoration.from, imageDecoration.to], [0, text.length]);
});

test("resolver injecté : reçoit cible, type et offset composite puis fournit l'URL au widget", () => {
  const text = "![[image.png]]";
  const calls = [];
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
    resolveImage: (target, kind, offset) => {
      calls.push({ target, kind, offset });
      return "app://local/image.png";
    },
  });
  assert.deepEqual(calls, [{ target: "image.png", kind: "wikilink", offset: 0 }]);
  assert.equal(plan.imageWidgets[0].source, "app://local/image.png");
});

test("resolver injecté : deux segments reçoivent deux offsets composites distincts", () => {
  const first = "![[image.png]]";
  const second = "![[image.png]]";
  const composite = `${first}\n${second}`;
  const calls = [];
  const plan = buildScriveningsMarkdownPlan({
    docLength: composite.length,
    sliceText: (from, to) => composite.slice(from, to),
    boundaries: [first.length],
    visibleRanges: [{ from: 0, to: composite.length }],
    selections: [],
    resolveImage: (target, kind, offset) => {
      calls.push({ target, kind, offset });
      return "app://vault/image.png";
    },
  });
  assert.equal(plan.imageWidgets.length, 2);
  assert.deepEqual(calls.map((call) => call.offset), [0, first.length + 1]);
});

test("parseScriveningsSegmentFormatting : les tableaux sont reconnus par Lezer", () => {
  const parsed = parseScriveningsSegmentFormatting("| A | B |\n|---|---|\n| C | D |");
  assert.equal(parsed.tables.length, 1);
  assert.equal(parsed.tables[0].header.cells.length, 2);
  assert.equal(parsed.tables[0].rows.length, 1);
  assert.equal(parsed.tables[0].rows[0].cells.length, 2);
  assert.equal(parseScriveningsSegmentFormatting("du texte | avec une barre").tables.length, 0);
  assert.equal(parseScriveningsSegmentFormatting("```\n| A | B |\n|---|---|\n```").tables.length, 0);
});

test("buildScriveningsMarkdownPlan : un tableau devient widget inactif et reste Markdown actif", () => {
  const text = "| **A** | B |\n|---|---|\n| C | D |";
  const inactive = buildScriveningsMarkdownPlan({ docLength: text.length, sliceText: (from, to) => text.slice(from, to), boundaries: [], visibleRanges: [{ from: 0, to: text.length }], selections: [] });
  assert.equal(inactive.tableWidgets.length, 1);
  assert.equal(inactive.styleRanges.some((range) => range.from >= inactive.tableWidgets[0].from && range.to <= inactive.tableWidgets[0].to), false);
  const active = buildScriveningsMarkdownPlan({ docLength: text.length, sliceText: (from, to) => text.slice(from, to), boundaries: [], visibleRanges: [{ from: 0, to: text.length }], selections: [{ from: 4, to: 4 }] });
  assert.equal(active.tableWidgets.length, 0);
  assert.equal(active.hiddenMarkRanges.some((range) => range.from > 0 && range.to < text.length), false);
});

test("createScriveningsMarkdownPlugin : ne produit aucun remplacement de bloc pour un tableau", () => {
  const text = "| A | B |\n|---|---|\n| C | D |";
  const fakeDoc = { text, get length() { return this.text.length; }, sliceString(from, to) { return this.text.slice(from, to); } };
  const fakeState = { doc: fakeDoc, selection: { main: { from: 0, to: 0 }, ranges: [] }, field: () => [] };
  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  const instance = new PluginClass({ state: fakeState, visibleRanges: [{ from: 0, to: text.length }] });
  assert.equal(instance.decorations.some((decoration) => decoration.widget !== undefined && decoration.block === true), false);
});

test("createScriveningsMarkdownExtensions : le StateField tableau porte seul les remplacements block", () => {
  const text = "| A | B |\n|---|---|\n| C | D |";
  const state = {
    doc: { length: text.length, sliceString: (from, to) => text.slice(from, to) },
    selection: { ranges: [] },
    field: () => [],
  };
  const [tableField, markdownPlugin] = createScriveningsMarkdownExtensions(FAKE_BOUNDARIES_FIELD);
  const tableDecorations = tableField.create(state);
  assert.equal(tableDecorations.length, 1);
  assert.equal(tableDecorations[0].block, true);
  assert.equal(typeof markdownPlugin, "function");
  const plugin = new markdownPlugin({ state, visibleRanges: [{ from: 0, to: text.length }] });
  assert.equal(plugin.decorations.some((decoration) => decoration.block === true), false);
});

test("buildScriveningsMarkdownPlan : un tableau reste limité à son segment", () => {
  const first = "| A | B |\n|---|---|\n| C | D |";
  const second = "| X | Y |\n|---|---|\n| Z | W |";
  const text = `${first}\n${second}`;
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [first.length],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.equal(plan.tableWidgets.length, 2);
  assert.equal(plan.tableWidgets[0].to, first.length);
  assert.equal(plan.tableWidgets[1].from, first.length + 1);
});

/* ==================== `***` seul = trois étoiles, jamais une ligne horizontale (micro-lot 1.3.1) ==================== */

test("parseScriveningsSegmentFormatting : `***` seul sur sa ligne (HorizontalRule pour @lezer/markdown) ne produit AUCUN nœud ni groupe — sa plage est reconnue à part", () => {
  const { nodes, groups, horizontalRules } = parseScriveningsSegmentFormatting("***");
  assert.deepEqual(nodes, []);
  assert.deepEqual(groups, []);
  assert.deepEqual(horizontalRules, [{ from: 0, to: 3 }]);
});

test("parseScriveningsSegmentFormatting : `***` seul entre deux paragraphes reste sans nœud ni groupe, le reste du texte n'est pas affecté", () => {
  const text = "Avant\n\n***\n\nAprès";
  const { nodes, groups, horizontalRules } = parseScriveningsSegmentFormatting(text);
  assert.deepEqual(nodes, []);
  assert.deepEqual(groups, []);
  assert.equal(horizontalRules.length, 1);
  assert.equal(text.slice(horizontalRules[0].from, horizontalRules[0].to), "***");
});

test("parseScriveningsSegmentFormatting : `***texte***` continue de fonctionner exactement comme avant (gras + italique), non affecté par la garde HorizontalRule", () => {
  const { nodes, groups } = parseScriveningsSegmentFormatting("***texte***");
  assert.equal(nodes.length, 2);
  assert.equal(groups.length, 1);
});

test("buildScriveningsMarkdownPlan : une ligne `***` seule ne reçoit AUCUNE décoration (ni style, ni Decoration.replace()) — reste visible telle quelle", () => {
  const text = "Avant\n\n***\n\nAprès";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 0, to: 0 }],
  });
  assert.deepEqual(plan.styleRanges, []);
  assert.deepEqual(plan.hiddenMarkRanges, []);
});

test("createScriveningsMarkdownPlugin : une ligne `***` ne produit AUCUNE décoration réelle (ni widget, ni replace, ni bordure) — aucune apparence de ligne horizontale", () => {
  const text = "Avant\n\n***\n\nAprès";
  const fakeDoc = {
    text,
    get length() {
      return this.text.length;
    },
    sliceString(from, to) {
      return this.text.slice(from, to);
    },
  };
  const fakeState = {
    doc: fakeDoc,
    selection: { main: { from: 0, to: 0 }, ranges: [{ from: 0, to: 0 }] },
    field: () => [],
  };
  const fakeView = { state: fakeState, visibleRanges: [{ from: 0, to: fakeDoc.length }] };

  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  const instance = new PluginClass(fakeView);
  // Le stub `Decoration.set` (test/codemirror-view-stub.mjs) renvoie
  // directement le tableau de ranges construit — vide ici, donc aucune
  // décoration (widget, replace ou mark) n'atteint jamais le DOM pour
  // cette ligne : ni trait, ni bordure, ni séparateur graphique.
  assert.deepEqual(instance.decorations, []);
});

test("buildScriveningsMarkdownPlan : `***` en code inline/bloc reste littéral (jamais recouvert par aucune décoration)", () => {
  const inlineCode = "Le `***` littéral.";
  const inlineCodePlan = buildScriveningsMarkdownPlan({
    docLength: inlineCode.length,
    sliceText: (from, to) => inlineCode.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: inlineCode.length }],
    selections: [],
  });
  assert.deepEqual(inlineCodePlan.styleRanges, []);
  assert.deepEqual(inlineCodePlan.hiddenMarkRanges, []);

  const fencedCode = "```\n***\n```";
  const fencedCodePlan = buildScriveningsMarkdownPlan({
    docLength: fencedCode.length,
    sliceText: (from, to) => fencedCode.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: fencedCode.length }],
    selections: [],
  });
  assert.deepEqual(fencedCodePlan.styleRanges, []);
  assert.deepEqual(fencedCodePlan.hiddenMarkRanges, []);
});

/* ==================== CORRECTIF `\*\*\*` échappé (micro-chantier finition Continu) ==================== */

test("parseScriveningsSegmentFormatting : une ligne source ENTIÈRE `\\*\\*\\*` masque SEULEMENT ses trois backslashes, jamais les `*`", () => {
  const { nodes, groups, horizontalRules, escapedSeparators } = parseScriveningsSegmentFormatting("\\*\\*\\*");
  assert.deepEqual(nodes, [], "jamais interprété comme une emphase");
  assert.deepEqual(groups, []);
  assert.deepEqual(horizontalRules, [], "jamais un thematic break — le document composite reste inchangé");
  assert.deepEqual(escapedSeparators, [
    { from: 0, to: 1 },
    { from: 2, to: 3 },
    { from: 4, to: 5 },
  ]);
});

test("buildScriveningsMarkdownPlan : ligne `\\*\\*\\*` seule -> les backslashes sont masqués, les trois `*` restent visibles, aucun `<hr>`", () => {
  const text = "\\*\\*\\*";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.deepEqual(plan.styleRanges, [], "jamais un style d'emphase");
  assert.deepEqual(plan.hiddenMarkRanges, [
    { from: 0, to: 1 },
    { from: 2, to: 3 },
    { from: 4, to: 5 },
  ]);
  // Le résultat visible (backslashes masqués, `*` restants) reconstruit
  // exactement « *** » — jamais « \*\*\* ».
  const hiddenChars = new Set();
  for (const range of plan.hiddenMarkRanges) for (let i = range.from; i < range.to; i++) hiddenChars.add(i);
  const visible = [...text].filter((_, i) => !hiddenChars.has(i)).join("");
  assert.equal(visible, "***");
});

test("buildScriveningsMarkdownPlan : `\\*\\*\\*` entre deux paragraphes -> seule cette ligne est masquée, le reste du texte n'est jamais affecté", () => {
  const text = "avant\n\\*\\*\\*\napres";
  const before = text;
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.deepEqual(plan.styleRanges, []);
  assert.deepEqual(plan.hiddenMarkRanges, [
    { from: 6, to: 7 },
    { from: 8, to: 9 },
    { from: 10, to: 11 },
  ]);
  assert.equal(text, before, "le document composite reste STRICTEMENT identique — seules des décorations sont posées");
});

test("buildScriveningsMarkdownPlan : jamais de règle trop large — `*`, `**`, `***`, `\\*` seuls, et `texte \\* texte` ne produisent AUCUNE plage masquée par ce correctif", () => {
  const cases = ["*", "**", "***", "\\*", "texte \\* texte"];
  for (const text of cases) {
    const plan = buildScriveningsMarkdownPlan({
      docLength: text.length,
      sliceText: (from, to) => text.slice(from, to),
      boundaries: [],
      visibleRanges: [{ from: 0, to: text.length }],
      selections: [],
    });
    assert.deepEqual(plan.hiddenMarkRanges, [], `cas « ${text} » : aucune plage masquée attendue`);
  }
});

test("compositeScriveningsFormatting : les plages `escapedSeparators` sont traduites en offsets composites (segment.from ajouté), comme `horizontalRules`", () => {
  const segment = { from: 100, to: 106 };
  const { escapedSeparators } = compositeScriveningsFormatting(segment, "\\*\\*\\*");
  assert.deepEqual(escapedSeparators, [
    { from: 100, to: 101 },
    { from: 102, to: 103 },
    { from: 104, to: 105 },
  ]);
});

test("buildScriveningsMarkdownPlan : `***texte***` (gras + italique) continue de recevoir style et masquage contextuel, sans régression", () => {
  const text = "Avant ***texte*** après.";
  const outside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 0, to: 0 }],
  });
  assert.equal(outside.styleRanges.length, 2, "gras + italique");
  assert.equal(outside.hiddenMarkRanges.length, 4, "marqueurs masqués hors curseur");

  const inside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 10, to: 10 }], // à l'intérieur de "***texte***" (groupe [6, 17])
  });
  assert.deepEqual(inside.hiddenMarkRanges, [], "marqueurs réaffichés quand le passage est actif");
});

/* ==================== Cache par segment ==================== */

test("parseScriveningsSegmentFormattingCached : même texte -> même référence en cache, jamais reparsé", () => {
  clearScriveningsMarkdownCache();
  const text = "Le *muezzin* appelle.";
  const first = parseScriveningsSegmentFormattingCached(text);
  const second = parseScriveningsSegmentFormattingCached(text);
  assert.equal(first, second);
});

test("parseScriveningsSegmentFormattingCached : un texte différent (même après une frappe) reparse bien", () => {
  clearScriveningsMarkdownCache();
  const first = parseScriveningsSegmentFormattingCached("Le *mot* ici.");
  const second = parseScriveningsSegmentFormattingCached("Le *mot* ici!");
  assert.notEqual(first, second);
});

/* ==================== Segments déduits des frontières ==================== */

test("scriveningsSegmentRanges : segment 1 = 0 -> boundary[0], segment i = boundary[i-1]+1 -> boundary[i], dernier -> fin du document", () => {
  const ranges = scriveningsSegmentRanges([10, 21], 30);
  assert.deepEqual(ranges, [
    { from: 0, to: 10 },
    { from: 11, to: 21 },
    { from: 22, to: 30 },
  ]);
});

test("scriveningsSegmentRanges : aucune frontière -> un seul segment, tout le document", () => {
  assert.deepEqual(scriveningsSegmentRanges([], 12), [{ from: 0, to: 12 }]);
});

test("scriveningsSegmentsInRanges : ne garde que les segments recouvrant au moins une plage visible, entiers", () => {
  const segments = [
    { from: 0, to: 10 },
    { from: 11, to: 21 },
    { from: 22, to: 30 },
  ];
  const kept = scriveningsSegmentsInRanges(segments, [{ from: 15, to: 16 }]);
  assert.deepEqual(kept, [{ from: 11, to: 21 }], "un segment partiellement visible est gardé ENTIER");
});

/* ==================== Frontières : jamais d'emphase multi-feuillets ==================== */

test("buildScriveningsMarkdownPlan : `*début` dans A + `fin*` dans B ne produit AUCUNE emphase (chaque segment parsé isolément)", () => {
  const segA = "Le *début";
  const segB = "fin* de segment.";
  const composite = `${segA}\n${segB}`;
  const boundaries = [segA.length];

  const plan = buildScriveningsMarkdownPlan({
    docLength: composite.length,
    sliceText: (from, to) => composite.slice(from, to),
    boundaries,
    visibleRanges: [{ from: 0, to: composite.length }],
    selections: [],
  });

  assert.deepEqual(plan.styleRanges, []);
  assert.deepEqual(plan.hiddenMarkRanges, []);
});

test("buildScriveningsMarkdownPlan : deux emphases valides de part et d'autre d'une frontière, aucune décoration ne recouvre la jonction", () => {
  const segA = "Le *mot* d'ici";
  const segB = "Et *l'autre* mot.";
  const composite = `${segA}\n${segB}`;
  const boundary = segA.length;

  const plan = buildScriveningsMarkdownPlan({
    docLength: composite.length,
    sliceText: (from, to) => composite.slice(from, to),
    boundaries: [boundary],
    visibleRanges: [{ from: 0, to: composite.length }],
    selections: [],
  });

  assert.equal(plan.styleRanges.length, 2, "une emphase par segment");
  for (const span of [...plan.styleRanges, ...plan.hiddenMarkRanges]) {
    assert.ok(span.to <= boundary || span.from > boundary, "aucune plage ne doit chevaucher la jonction");
  }
});

test("buildScriveningsMarkdownPlan : seuls les segments qui intersectent visibleRanges sont effectivement parsés (jamais un scan global)", () => {
  const segA = "Segment A avec *emphase A*.";
  const segB = "Segment B avec *emphase B*.";
  const segC = "Segment C avec *emphase C*.";
  const composite = [segA, segB, segC].join("\n");
  const boundaryA = segA.length;
  const boundaryB = boundaryA + 1 + segB.length;

  const calls = [];
  const spySlice = (from, to) => {
    calls.push([from, to]);
    return composite.slice(from, to);
  };

  const segmentBRange = { from: boundaryA + 1, to: boundaryB };

  const plan = buildScriveningsMarkdownPlan({
    docLength: composite.length,
    sliceText: spySlice,
    boundaries: [boundaryA, boundaryB],
    visibleRanges: [{ from: segmentBRange.from + 2, to: segmentBRange.from + 4 }], // à l'intérieur du seul segment B
    selections: [],
  });

  assert.equal(calls.length, 1, "un seul segment aurait dû être extrait/parsé");
  assert.deepEqual(calls[0], [segmentBRange.from, segmentBRange.to]);
  assert.equal(plan.styleRanges.length, 1, "seule l'emphase du segment B doit apparaître");
});

/* ==================== Affichage : rendu + masquage contextuel ==================== */

test("scriveningsGroupIsActive : une sélection qui touche [group.from, group.to] (bornes incluses) active le groupe", () => {
  const group = { from: 3, to: 12, marks: [] };
  assert.equal(scriveningsGroupIsActive(group, [{ from: 7, to: 7 }]), true, "curseur dans le passage");
  assert.equal(scriveningsGroupIsActive(group, [{ from: 3, to: 3 }]), true, "curseur pile sur le marqueur ouvrant");
  assert.equal(scriveningsGroupIsActive(group, [{ from: 12, to: 12 }]), true, "curseur pile sur le marqueur fermant");
  assert.equal(scriveningsGroupIsActive(group, [{ from: 0, to: 2 }]), false, "sélection avant le passage");
  assert.equal(scriveningsGroupIsActive(group, [{ from: 13, to: 20 }]), false, "sélection après le passage");
});

test("buildScriveningsMarkdownPlan : le contenu reçoit la classe italique/gras adaptée", () => {
  const text = "Le *muezzin* appelle et son **appel** résonne.";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  const emphasisSpan = plan.styleRanges.find((s) => s.type === "emphasis");
  const strongSpan = plan.styleRanges.find((s) => s.type === "strong");
  assert.equal(text.slice(emphasisSpan.from, emphasisSpan.to), "muezzin");
  assert.equal(text.slice(strongSpan.from, strongSpan.to), "appel");
});

test("buildScriveningsMarkdownPlan : marqueurs masqués quand le curseur est hors du passage", () => {
  const text = "Le *muezzin* appelle.";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 0, to: 0 }],
  });
  assert.deepEqual(plan.hiddenMarkRanges, [
    { from: 3, to: 4 },
    { from: 11, to: 12 },
  ]);
});

test("buildScriveningsMarkdownPlan : marqueurs visibles (jamais masqués) quand le curseur touche le passage (« Le *muezz|in* appelle. »)", () => {
  const text = "Le *muezzin* appelle.";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 8, to: 8 }], // « Le *muezz|in* appelle. »
  });
  assert.deepEqual(plan.hiddenMarkRanges, []);
  assert.equal(plan.styleRanges.length, 1, "le style (italique) reste appliqué, seul le masquage change");
});

test("buildScriveningsMarkdownPlan : déplacer le curseur hors du passage remet le masquage", () => {
  const text = "Le *muezzin* appelle.";
  const params = (selections) => ({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections,
  });
  const active = buildScriveningsMarkdownPlan(params([{ from: 8, to: 8 }]));
  const inactiveAgain = buildScriveningsMarkdownPlan(params([{ from: 20, to: 20 }]));
  assert.deepEqual(active.hiddenMarkRanges, []);
  assert.deepEqual(inactiveAgain.hiddenMarkRanges, [
    { from: 3, to: 4 },
    { from: 11, to: 12 },
  ]);
});

test("buildScriveningsMarkdownPlan : pour ***texte***, TOUS les marqueurs réapparaissent ensemble dès que le passage est actif", () => {
  const text = "Le ***muezzin*** appelle.";
  const outsidePlan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 0, to: 0 }],
  });
  assert.equal(outsidePlan.hiddenMarkRanges.length, 4, "tous masqués hors curseur");

  const insidePlan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 8, to: 8 }],
  });
  assert.deepEqual(insidePlan.hiddenMarkRanges, [], "les 4 marqueurs réapparaissent ensemble");
});

test("createScriveningsMarkdownPlugin (ViewPlugin) : la simple construction/mise à jour des décorations ne dispatch jamais de transaction", () => {
  const fakeDoc = { text: "Le *muezzin* appelle.", get length() { return this.text.length; }, sliceString(from, to) { return this.text.slice(from, to); } };
  const fakeState = {
    doc: fakeDoc,
    selection: { main: { from: 0, to: 0 }, ranges: [{ from: 0, to: 0 }] },
    field: () => [],
  };
  const fakeView = { state: fakeState, visibleRanges: [{ from: 0, to: fakeDoc.length }] }; // pas de `dispatch` du tout

  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  assert.equal(typeof PluginClass, "function", "en environnement de test, le stub ViewPlugin.fromClass renvoie la classe telle quelle");
  const instance = new PluginClass(fakeView);
  assert.ok(instance.decorations, "les décorations doivent être construites sans jamais avoir besoin de dispatch()");

  instance.update({ docChanged: false, viewportChanged: true, selectionSet: false, view: fakeView });
  assert.ok(instance.decorations);
});

test("CM_SCRIVENINGS_EMPHASIS_CLASS / CM_SCRIVENINGS_STRONG_CLASS : classes CSS dédiées minimales", () => {
  assert.equal(CM_SCRIVENINGS_EMPHASIS_CLASS, "cm-scrivenings-emphasis");
  assert.equal(CM_SCRIVENINGS_STRONG_CLASS, "cm-scrivenings-strong");
});

test("createScriveningsMarkdownExtensions : composé du seul plugin de rendu (micro-lot 1.3.1 : le keymap Mod-i/Mod-b vit désormais dans cm-scrivenings.ts, avec Mod-Shift-z, dans un même Prec.highest)", () => {
  const extensions = createScriveningsMarkdownExtensions(FAKE_BOUNDARIES_FIELD);
  assert.equal(extensions.length, 2);
  assert.equal(typeof extensions[0], "object", "le premier mécanisme est le StateField des tableaux");
  assert.equal(typeof extensions[1], "function", "le second mécanisme reste le plugin Markdown inline");
});

test("scriveningsExtensions (cm-scrivenings.ts) : inclut bien le plugin de rendu Markdown de ce lot, construit avec le VRAI champ de frontières", () => {
  // Intégration minimale : cm-scrivenings.ts appelle
  // createScriveningsMarkdownExtensions(scriveningsBoundariesField) — ce
  // test s'assure juste que la composition ne lève pas et grossit bien le
  // tableau final (pas de régression sur le nombre d'extensions montées).
  assert.ok(scriveningsExtensions.length > 7, "les extensions Markdown doivent bien s'ajouter aux extensions déjà connues");
});

/* ==================== Commandes Mod-i / Mod-b ==================== */

test("planScriveningsToggleFormatting : sélection sans formatage existant -> ajoute l'italique (*)", () => {
  const text = "Le muezzin appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 3,
    selectionTo: 10, // "muezzin"
    type: "emphasis",
  });
  assert.deepEqual(plan, {
    changes: [
      { from: 3, to: 3, insert: "*" },
      { from: 10, to: 10, insert: "*" },
    ],
    selection: { anchor: 4, head: 11 },
  });
});

test("planScriveningsToggleFormatting : sélection sans formatage existant -> ajoute le gras (**)", () => {
  const text = "Le muezzin appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 3,
    selectionTo: 10,
    type: "strong",
  });
  assert.deepEqual(plan, {
    changes: [
      { from: 3, to: 3, insert: "**" },
      { from: 10, to: 10, insert: "**" },
    ],
    selection: { anchor: 5, head: 12 },
  });
});

test("planScriveningsToggleFormatting : sélection correspondant exactement à une italique existante -> la retire", () => {
  const text = "Le *muezzin* appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 4,
    selectionTo: 11, // "muezzin", contenu exact du nœud Emphasis
    type: "emphasis",
  });
  assert.deepEqual(plan, {
    changes: [
      { from: 11, to: 12, insert: "" },
      { from: 3, to: 4, insert: "" },
    ],
    selection: { anchor: 3, head: 10 },
  });
});

test("planScriveningsToggleFormatting : sélection correspondant exactement à un gras existant -> le retire", () => {
  const text = "Le **muezzin** appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 5,
    selectionTo: 12, // "muezzin"
    type: "strong",
  });
  assert.deepEqual(plan, {
    changes: [
      { from: 12, to: 14, insert: "" },
      { from: 3, to: 5, insert: "" },
    ],
    selection: { anchor: 3, head: 10 },
  });
});

test("planScriveningsToggleFormatting : curseur vide -> Mod-i insère une paire `*`+`*` et place le curseur entre les deux", () => {
  const text = "Le  appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 3,
    selectionTo: 3,
    type: "emphasis",
  });
  assert.deepEqual(plan, {
    changes: [{ from: 3, to: 3, insert: "**" }],
    selection: { anchor: 4, head: 4 },
  });
});

test("planScriveningsToggleFormatting : curseur vide -> Mod-b insère `****` et place le curseur entre les deux paires", () => {
  const text = "Le  appelle.";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    selectionFrom: 3,
    selectionTo: 3,
    type: "strong",
  });
  assert.deepEqual(plan, {
    changes: [{ from: 3, to: 3, insert: "****" }],
    selection: { anchor: 5, head: 5 },
  });
});

test("planScriveningsToggleFormatting : sélection traversant une frontière -> null (aucune modification, jamais d'emphase multi-feuillets)", () => {
  const text = "AAAA\nBBBB";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [4],
    selectionFrom: 2,
    selectionTo: 7,
    type: "emphasis",
  });
  assert.equal(plan, null);
});

test("planScriveningsToggleFormatting : curseur pile sur une jonction -> null (position ambiguë, aucun segment)", () => {
  const text = "AAAA\nBBBB";
  const plan = planScriveningsToggleFormatting({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [4],
    selectionFrom: 4,
    selectionTo: 4,
    type: "strong",
  });
  assert.equal(plan, null);
});

test("createScriveningsToggleCommand(FIELD, \"emphasis\") : dispatch exactement le plan calculé, jamais autre chose (transaction CodeMirror normale)", () => {
  const text = "Le muezzin appelle.";
  const dispatched = [];
  const fakeView = {
    state: {
      doc: { length: text.length, sliceString: (from, to) => text.slice(from, to) },
      selection: { main: { from: 3, to: 10 } },
      field: () => [],
    },
    dispatch: (spec) => dispatched.push(spec),
  };

  const toggleEmphasis = createScriveningsToggleCommand(FAKE_BOUNDARIES_FIELD, "emphasis");
  const handled = toggleEmphasis(fakeView);
  assert.equal(handled, true, "le raccourci doit toujours être consommé");
  assert.equal(dispatched.length, 1);
  assert.deepEqual(Object.keys(dispatched[0]).sort(), ["changes", "selection"]);
  assert.deepEqual(dispatched[0].changes, [
    { from: 3, to: 3, insert: "*" },
    { from: 10, to: 10, insert: "*" },
  ]);
  assert.deepEqual(dispatched[0].selection, { anchor: 4, head: 11 });
});

test("createScriveningsToggleCommand(FIELD, \"strong\") : sélection multi-feuillets -> raccourci consommé (true), aucun dispatch", () => {
  const text = "AAAA\nBBBB";
  const dispatched = [];
  const fakeView = {
    state: {
      doc: { length: text.length, sliceString: (from, to) => text.slice(from, to) },
      selection: { main: { from: 2, to: 7 } },
      field: () => [4],
    },
    dispatch: (spec) => dispatched.push(spec),
  };

  const toggleStrong = createScriveningsToggleCommand(FAKE_BOUNDARIES_FIELD, "strong");
  const handled = toggleStrong(fakeView);
  assert.equal(handled, true, "le raccourci doit être consommé même sans modification, pour éviter tout comportement navigateur parasite");
  assert.deepEqual(dispatched, []);
});

/* ==================== Titres ATX `#`→`######` (finition Continu) ==================== */

test("parseScriveningsSegmentFormatting : chaque niveau `#` à `######` est un titre de bon niveau, contenu borné après le marqueur + l'espace syntaxique", () => {
  const cases = [
    ["# Titre", 1, 0, 7, [2, 7], "Titre"],
    ["## Titre 2", 2, 0, 10, [3, 10], "Titre 2"],
    ["### T3", 3, 0, 6, [4, 6], "T3"],
    ["#### T4", 4, 0, 7, [5, 7], "T4"],
    ["##### T5", 5, 0, 8, [6, 8], "T5"],
    ["###### T6", 6, 0, 9, [7, 9], "T6"],
  ];
  for (const [text, level, from, to, [contentFrom, contentTo], content] of cases) {
    const { headings } = parseScriveningsSegmentFormatting(text);
    assert.equal(headings.length, 1, `« ${text} » doit être un seul titre`);
    const [heading] = headings;
    assert.equal(heading.level, level, `« ${text} » niveau ${level}`);
    assert.deepEqual([heading.from, heading.to], [from, to]);
    assert.deepEqual([heading.contentFrom, heading.contentTo], [contentFrom, contentTo]);
    assert.equal(text.slice(heading.contentFrom, heading.contentTo), content, `« ${text} » contenu = « ${content} »`);
    assert.equal(heading.marks.length, 1);
    assert.deepEqual(heading.marks[0], { from, to: from + level }, "le HeaderMark couvre exactement les `#`");
  }
});

test("parseScriveningsSegmentFormatting : sept `#` ne font JAMAIS un titre (paragraphe pour la grammaire), et `#Titre` sans espace non plus", () => {
  for (const text of ["####### pas un titre", "#Titre", "###Titre###"]) {
    const { headings } = parseScriveningsSegmentFormatting(text);
    assert.deepEqual(headings, [], `« ${text} » : la grammaire ne doit reconnaître aucun titre ATX`);
  }
});

test("parseScriveningsSegmentFormatting : marqueur échappé `\\#` jamais un titre, `\\# pas un titre` reste un paragraphe", () => {
  const { headings } = parseScriveningsSegmentFormatting("\\# pas un titre");
  assert.deepEqual(headings, []);
});

test("parseScriveningsSegmentFormatting : `**gras**` et `*italique*` dans un titre restent des nœuds d'emphase, SANS affecter le titre", () => {
  const text = "# **gras** et *italique* dans le titre";
  const { headings, nodes, groups } = parseScriveningsSegmentFormatting(text);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].level, 1);
  assert.deepEqual([headings[0].contentFrom, headings[0].contentTo], [2, 38]);
  assert.equal(nodes.length, 2, "le gras et l'italique imbriqués restent collectés");
  assert.equal(groups.length, 2, "deux groupes de masquage d'emphase, indépendants du titre");
});

test("parseScriveningsSegmentFormatting : `## foo ##` porte DEUX HeaderMark (ouvrant ET fermant), tous deux collectés", () => {
  const { headings } = parseScriveningsSegmentFormatting("## foo ##");
  assert.equal(headings.length, 1);
  const [heading] = headings;
  assert.equal(heading.level, 2);
  assert.deepEqual(
    heading.marks.map((m) => [m.from, m.to]),
    [[0, 2], [7, 9]],
    "le marqueur fermant est un HeaderMark de plus, reconnu par la grammaire"
  );
  assert.deepEqual([heading.contentFrom, heading.contentTo], [3, 7], "le contenu s'arrête avant le `##` fermant");
});

test("parseScriveningsSegmentFormatting : syntaxe incomplète — `#` seul et `## ` (marqueur + espace) sont des titres VIDES, jamais des styles", () => {
  for (const text of ["#", "## "]) {
    const { headings } = parseScriveningsSegmentFormatting(text);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].contentFrom, headings[0].contentTo, "aucun contenu à styler");
  }
});

test("parseScriveningsSegmentFormatting : un SetextHeading (`Titre` souligné `===`) n'est JAMAIS collecté comme titre ATX", () => {
  const { headings } = parseScriveningsSegmentFormatting("Titre\n=====");
  assert.deepEqual(headings, [], "seule la syntaxe `#`→`######` est traitée par ce lot");
});

test("scriveningsHeadingIsActive : une sélection qui touche [heading.from, heading.to] (bornes incluses) réaffiche les `#`", () => {
  const heading = { level: 1, from: 7, to: 14, contentFrom: 9, contentTo: 14, marks: [{ from: 7, to: 8 }] };
  assert.equal(scriveningsHeadingIsActive(heading, [{ from: 12, to: 12 }]), true, "curseur dans le titre");
  assert.equal(scriveningsHeadingIsActive(heading, [{ from: 7, to: 7 }]), true, "curseur pile sur le marqueur ouvrant");
  assert.equal(scriveningsHeadingIsActive(heading, [{ from: 14, to: 14 }]), true, "curseur pile sur la fin du titre");
  assert.equal(scriveningsHeadingIsActive(heading, [{ from: 0, to: 6 }]), false, "sélection avant le titre");
  assert.equal(scriveningsHeadingIsActive(heading, [{ from: 15, to: 20 }]), false, "sélection après le titre");
});

test("scriveningsHeadingClass : une classe CSS dédiée par niveau (`cm-scrivenings-heading-h1`…`h6`)", () => {
  assert.equal(scriveningsHeadingClass(1), "cm-scrivenings-heading-h1");
  assert.equal(scriveningsHeadingClass(2), "cm-scrivenings-heading-h2");
  assert.equal(scriveningsHeadingClass(3), "cm-scrivenings-heading-h3");
  assert.equal(scriveningsHeadingClass(4), "cm-scrivenings-heading-h4");
  assert.equal(scriveningsHeadingClass(5), "cm-scrivenings-heading-h5");
  assert.equal(scriveningsHeadingClass(6), "cm-scrivenings-heading-h6");
});

test("buildScriveningsMarkdownPlan : le contenu d'un titre reçoit une portée de style `heading-N`, le `#` + l'espace sont masqués hors curseur", () => {
  const text = "Avant.\n# Titre\nAprès.";
  const outside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 0, to: 0 }],
  });
  assert.deepEqual(outside.styleRanges, [{ from: 9, to: 14, type: "heading-1" }], "« Titre » stylé, jamais le `#`");
  assert.deepEqual(outside.hiddenMarkRanges, [{ from: 7, to: 9 }], "le `#` ET l'espace syntaxique masqués hors curseur");

  const inside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 12, to: 12 }], // dans « Titre »
  });
  assert.deepEqual(inside.hiddenMarkRanges, [], "le `#` réapparaît quand le curseur touche le titre");
  assert.deepEqual(inside.styleRanges, [{ from: 9, to: 14, type: "heading-1" }], "le style reste appliqué, seul le masquage change");
});

test("buildScriveningsMarkdownPlan : `## foo ##` masque le marqueur ouvrant, son espace ET le marqueur fermant (tout ou rien, comme une emphase)", () => {
  const text = "## foo ##";
  // `selections: []` (aucune sélection) : le titre est inactif — le titre
  // occupe ici tout le document, un curseur à 0 toucherait déjà son marqueur.
  const outside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.deepEqual(outside.styleRanges, [{ from: 3, to: 7, type: "heading-2" }]);
  assert.deepEqual(outside.hiddenMarkRanges, [
    { from: 0, to: 3 }, // `##` + espace
    { from: 7, to: 9 }, // `##` fermant
  ]);

  const inside = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [{ from: 5, to: 5 }],
  });
  assert.deepEqual(inside.hiddenMarkRanges, [], "tous les marqueurs du titre réapparaissent ensemble");
});

test("buildScriveningsMarkdownPlan : `# **gras** ici` combine titre + emphase — deux portées de style et les marqueurs des deux masqués", () => {
  const text = "# **gras** ici";
  const plan = buildScriveningsMarkdownPlan({
    docLength: text.length,
    sliceText: (from, to) => text.slice(from, to),
    boundaries: [],
    visibleRanges: [{ from: 0, to: text.length }],
    selections: [],
  });
  assert.deepEqual(plan.styleRanges, [
    { from: 2, to: 14, type: "heading-1" },
    { from: 4, to: 8, type: "strong" },
  ]);
  assert.deepEqual(plan.hiddenMarkRanges, [
    { from: 0, to: 2 }, // `#` + espace du titre
    { from: 2, to: 4 }, // `**` ouvrant
    { from: 8, to: 10 }, // `**` fermant
  ]);
});

test("buildScriveningsMarkdownPlan : un titre de CHAQUE feuillet reste dans SON segment — jamais de titre traversant la frontière", () => {
  const segA = "# Titre A";
  const segB = "## Titre B";
  const composite = `${segA}\n${segB}`;
  const boundary = segA.length;

  const plan = buildScriveningsMarkdownPlan({
    docLength: composite.length,
    sliceText: (from, to) => composite.slice(from, to),
    boundaries: [boundary],
    visibleRanges: [{ from: 0, to: composite.length }],
    selections: [],
  });

  assert.deepEqual(plan.styleRanges, [
    { from: 2, to: 9, type: "heading-1" },
    { from: 13, to: 20, type: "heading-2" },
  ]);
  assert.deepEqual(plan.hiddenMarkRanges, [
    { from: 0, to: 2 },
    { from: 10, to: 13 },
  ]);
  for (const span of [...plan.styleRanges, ...plan.hiddenMarkRanges]) {
    assert.ok(span.to <= boundary || span.from > boundary, "aucune plage ne doit chevaucher la jonction");
  }
});

test("compositeScriveningsFormatting : les offsets des titres sont traduits en offsets composites (segment.from ajouté), comme les emphases", () => {
  const segment = { from: 100, to: 122 };
  const { headings } = compositeScriveningsFormatting(segment, "# Titre");
  assert.equal(headings.length, 1);
  const [heading] = headings;
  assert.deepEqual([heading.from, heading.to], [100, 107]);
  assert.deepEqual([heading.contentFrom, heading.contentTo], [102, 107]);
  assert.deepEqual(heading.marks, [{ from: 100, to: 101 }]);
});

/* ==================== Non-régression : compositeScriveningsFormatting ==================== */

test("compositeScriveningsFormatting : traduit les offsets locaux du segment en offsets composites (segment.from ajouté)", () => {
  const segment = { from: 100, to: 122 };
  const { nodes, groups } = compositeScriveningsFormatting(segment, "Le *muezzin* appelle.");
  assert.deepEqual([nodes[0].from, nodes[0].to], [103, 112]);
  assert.deepEqual([nodes[0].contentFrom, nodes[0].contentTo], [104, 111]);
  assert.deepEqual([groups[0].from, groups[0].to], [103, 112]);
});
