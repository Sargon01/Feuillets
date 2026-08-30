import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveHyphenation, pageContentGeometry } from "../src/services/export-pdf.js";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import {
  CONTINUATION_STYLE,
  CONTINUES_JUSTIFY_STYLE,
  DOCUMENT_MEDIA_MIN_SCALE,
  FRAGMENT_CONTINUATION_CLASS,
  FRAGMENT_CONTINUES_CLASS,
  FRAGMENT_START_CLASS,
  applyFragmentPresentation,
  documentMediaGroupAfter,
  largestFittingDocumentMediaScale,
  paginateDom,
  paginateDomCooperatively,
  wordBoundaries,
  wordPrefixEnds,
} from "../src/services/pagination-engine.js";

function block(tagName, classes = []) {
  return { tagName: tagName.toUpperCase(), classList: { contains: (name) => classes.includes(name) } };
}

test("pagination-engine : heading + média documentaire reste un groupe direct", () => {
  const heading = block("h3");
  const media = block("div", ["feuillets-doc-media-block"]);
  assert.deepEqual(documentMediaGroupAfter(heading, [media]), [heading, media]);
});

test("pagination-engine : heading + paragraphe introductif + média forme le groupe réel", () => {
  const heading = block("h3");
  const intro = block("p");
  const media = block("div", ["feuillets-doc-media-block"]);
  const group = documentMediaGroupAfter(heading, [intro, media]);
  assert.deepEqual(group, [heading, intro, media]);
  assert.equal(group?.map((node) => node.tagName).join(","), "H3,P,DIV");
});

test("pagination-engine : deux paragraphes ou une liste n'élargissent pas le groupe média", () => {
  const heading = block("h3");
  const paragraph = block("p");
  const media = block("div", ["feuillets-doc-media-block"]);
  assert.equal(documentMediaGroupAfter(heading, [paragraph, block("p"), media]), null);
  assert.equal(documentMediaGroupAfter(heading, [block("ul"), media]), null);
});

test("pagination-engine : une page Front ne devient jamais un groupe média", () => {
  const front = block("div", ["feuillets-frontpage"]);
  const media = block("div", ["feuillets-doc-media-block"]);
  assert.equal(documentMediaGroupAfter(front, [media]), null);
});

test("pagination-engine : l'échelle documentaire reste à 1 si le média tient", () => {
  assert.equal(largestFittingDocumentMediaScale(() => true), 1);
});

test("pagination-engine : la recherche choisit la plus grande réduction nécessaire, pas directement 80 %", () => {
  const scale = largestFittingDocumentMediaScale((value) => value <= 0.93);
  assert.ok(scale > 0.9);
  assert.ok(scale < 1);
  assert.ok(scale <= 0.93);
});

test("pagination-engine : la borne de réduction documentaire ne descend jamais sous 80 %", () => {
  const scale = largestFittingDocumentMediaScale((value) => value <= DOCUMENT_MEDIA_MIN_SCALE);
  assert.equal(scale, DOCUMENT_MEDIA_MIN_SCALE);
  assert.equal(largestFittingDocumentMediaScale((value) => value < DOCUMENT_MEDIA_MIN_SCALE), null);
});

const readSourceFile = () => readFileSync(resolve(process.cwd(), "src/services/pagination-engine.ts"), "utf8");

function wordFragments(text, capacity) {
  const result = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.slice(start);
    if (remaining.length <= capacity) {
      result.push(remaining);
      break;
    }
    const boundary = wordPrefixEnds(remaining).filter((value) => value <= capacity).at(-1);
    assert.ok(boundary, "le cas de test doit contenir au moins un mot entier");
    const end = start + boundary;
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}

test("pagination-engine : texte court sur un seul fragment", () => {
  assert.deepEqual(wordFragments("Texte court.", 100), ["Texte court."]);
});

test("pagination-engine : une coupure conserve strictement tous les caractères", () => {
  const text = "Les nôtres ont été noyées dans la suite du paragraphe, sans aucune disparition.";
  const parts = wordFragments(text, 32);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
});

test("pagination-engine : régression Kitmir — aucune portion intermédiaire ne disparaît", () => {
  const text = "Kitmir reprend son trot léger. Il dodeline de la tête, il la porte haut. Il remue la queue. Ses petits pas calés sur ceux des soldats. Parfait petit soldat. Je ne peux m’empêcher de rire. Il se moque du sergent...";
  const parts = wordFragments(text, 34);
  assert.ok(parts.length > 2);
  assert.equal(parts.join(""), text);
  assert.match(parts.join(""), /Ses petits pas calés sur ceux des soldats/);
});

test("pagination-engine : les frontières de pagination sont des mots entiers", () => {
  const text = "des sacrifices nécessaires";
  const words = wordBoundaries(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(words, ["des", "sacrifices", "nécessaires"]);
  assert.equal(words.includes("sacrifi"), false);
  assert.equal(words.join(" "), text);
});

test("pagination-engine : les préfixes légaux conservent les mots et séparateurs exacts", () => {
  const text = "des sacrifices nécessaires";
  const prefixes = wordPrefixEnds(text).map((end) => text.slice(0, end));
  assert.deepEqual(prefixes, ["des ", "des sacrifices "]);
  assert.equal(prefixes.some((prefix) => prefix.endsWith("sacrifi")), false);
});

test("pagination-engine : la pagination réelle ne décide pas avec getClientRects", () => {
  const implementation = paginateDom.toString();
  assert.doesNotMatch(implementation, /getClientRects|firstOverflowWordStart/);
  assert.match(implementation, /overflows/);
});

test("pagination-engine : le flux portrait + citation ne fractionne plus le blockquote", () => {
  const implementation = readSourceFile();
  assert.doesNotMatch(implementation, /splitPortraitContent|feuillets-doc-quote-split-(?:start|continuation)/);
  assert.match(implementation, /function canSplit\(/);
  assert.doesNotMatch(implementation, /canSplit[\s\S]{0,160}blockquote/);
});

test("pagination-engine : la mesure multicolonne compose à hauteur de page et détecte le débordement horizontal", () => {
  const implementation = readSourceFile();
  assert.match(implementation, /"column-count"/);
  assert.match(implementation, /"column-gap"/);
  assert.match(implementation, /"column-fill"/);
  assert.match(implementation, /scrollWidth > content\.clientWidth/);
});

test("pagination-engine : la zone A4 à marges 2,5 cm garde ses pixels fractionnaires", () => {
  const geometry = pageContentGeometry(210, 297, 2.5, 2.5, 2.5, 2.5);
  assert.equal(geometry.widthPx, 604.72);
  assert.equal(geometry.heightPx, 933.5365);
});

test("pagination-engine : A5, Letter, paysage et marges asymétriques sont dérivés des mm finaux", () => {
  assert.deepEqual(pageContentGeometry(148, 210, 2, 3, 1, 4), {
    widthPx: 98 * 3.7795,
    heightPx: 160 * 3.7795,
  });
  assert.deepEqual(pageContentGeometry(279, 216, 1.5, 2, 2, 3), {
    widthPx: 229 * 3.7795,
    heightPx: 181 * 3.7795,
  });
  assert.deepEqual(pageContentGeometry(297, 210, 2.5, 2.5, 1, 4), {
    widthPx: 247 * 3.7795,
    heightPx: 160 * 3.7795,
  });
});

test("pagination-engine : les marges miroir conservent la même largeur utile", () => {
  const odd = pageContentGeometry(210, 297, 2.5, 2.5, 1, 3);
  const even = pageContentGeometry(210, 297, 2.5, 2.5, 3, 1);
  assert.equal(odd.widthPx, even.widthPx);
  assert.equal(odd.heightPx, even.heightPx);
});

test("pagination-engine : la surcharge de césure est explicite et le gabarit reste le repli", () => {
  const template = { hyphenation: true };
  assert.equal(effectiveHyphenation(template), true);
  assert.equal(effectiveHyphenation(template, { hyphenationOverride: false }), false);
  assert.equal(effectiveHyphenation(template, { hyphenationOverride: true }), true);
});

test("pagination-engine : Classique conserve ses réglages de composition", () => {
  const classique = EXPORT_TEMPLATES.classique;
  assert.equal(classique.hyphenation, true);
  assert.equal(classique.lineHeight, 2);
  assert.equal(classique.align, "justify");
});

test("pagination-engine : seul le fragment continué perd l'alinéa et la marge haute", () => {
  const styles = [];
  const fragment = {
    classList: { classes: [], add(name) { this.classes.push(name); } },
    setCssProps(props) { styles.push(props); },
  };
  applyFragmentPresentation(fragment, false, true, "justify");
  assert.deepEqual(fragment.classList.classes, [FRAGMENT_START_CLASS, FRAGMENT_CONTINUES_CLASS]);
  assert.deepEqual(styles, [CONTINUES_JUSTIFY_STYLE]);

  applyFragmentPresentation(fragment, true, true, "justify");
  assert.deepEqual(fragment.classList.classes, [
    FRAGMENT_START_CLASS,
    FRAGMENT_CONTINUES_CLASS,
    FRAGMENT_CONTINUATION_CLASS,
    FRAGMENT_CONTINUES_CLASS,
  ]);
  assert.deepEqual(styles, [CONTINUES_JUSTIFY_STYLE, CONTINUATION_STYLE, CONTINUES_JUSTIFY_STYLE]);
});

test("pagination-engine : le dernier fragment ne force pas sa dernière ligne", () => {
  const styles = [];
  const fragment = {
    classList: { add() {} },
    setCssProps(props) { styles.push(props); },
  };
  applyFragmentPresentation(fragment, true, false, "justify");
  assert.deepEqual(styles, [CONTINUATION_STYLE]);
});

test("pagination-engine : un long paragraphe progresse sur plusieurs pages sans répétition", () => {
  const text = "un deux trois quatre cinq six sept huit neuf dix ".repeat(20);
  const parts = wordFragments(text, 25);
  assert.ok(parts.length > 3);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((part) => part.length > 0));
});

// === INVARIANT LOCKS: SINGLE SYNC/COOPERATIVE ENGINE ===

test("pagination-engine : paginateDom() crée les étapes avec paginateDomSteps", () => {
  const implementation = paginateDom.toString();
  // Verify that paginateDom creates its steps using paginateDomSteps
  assert.match(implementation, /paginateDomSteps\s*\(/);
  // Verify it drains the steps generator
  assert.match(implementation, /steps\.next\(\)/);
});

test("pagination-engine : paginateDomCooperatively() crée aussi les étapes avec paginateDomSteps", async () => {
  const implementation = paginateDomCooperatively.toString();
  // Verify that paginateDomCooperatively creates its steps using paginateDomSteps
  assert.match(implementation, /paginateDomSteps\s*\(/);
  // Verify it loops through steps
  assert.match(implementation, /steps\.next\(\)/);
});

test("pagination-engine : seul paginateDomSteps existe comme générateur de pagination", () => {
  const sourceFile = readSourceFile();
  // Count occurrences of "paginateDomSteps" - should be significant
  const matches = sourceFile.match(/paginateDomSteps/g) || [];
  assert.ok(matches.length >= 3, "paginateDomSteps must be defined and used multiple times");
  // Ensure no secondary pagination algorithm exists
  assert.doesNotMatch(sourceFile, /function\s+\*\s*paginate\w+(?!Steps)/);
});

test("pagination-engine : paginateDom et paginateDomCooperatively n'implémentent pas leur propre algorithme", () => {
  const sourceFile = readSourceFile();
  // Extract paginateDom implementation
  const paginateDomMatch = sourceFile.match(/export function paginateDom[\s\S]{0,500}/);
  assert.ok(paginateDomMatch);
  assert.match(paginateDomMatch[0], /paginateDomSteps/);

  // Extract paginateDomCooperatively implementation
  const cooperativeMatch = sourceFile.match(/export async function paginateDomCooperatively[\s\S]{0,500}/);
  assert.ok(cooperativeMatch);
  assert.match(cooperativeMatch[0], /paginateDomSteps/);
});

// === INVARIANT LOCKS: FRAGMENT CLONING ===

test("pagination-engine : cloneTextFragment passe par rangeForTextOffsets", () => {
  const sourceFile = readSourceFile();
  const cloneMatch = sourceFile.match(/export function cloneTextFragment[\s\S]{0,300}/);
  assert.ok(cloneMatch);
  // Must call rangeForTextOffsets
  assert.match(cloneMatch[0], /rangeForTextOffsets/);
  // Must use Range.cloneContents()
  assert.match(cloneMatch[0], /cloneContents/);
});

test("pagination-engine : rangeForTextOffsets construit le range avec setStart et setEnd", () => {
  const sourceFile = readSourceFile();
  const rangeMatch = sourceFile.match(/function rangeForTextOffsets[\s\S]{0,800}/);
  assert.ok(rangeMatch);
  // Must use Range.setStart
  assert.match(rangeMatch[0], /setStart/);
  // Must use Range.setEnd
  assert.match(rangeMatch[0], /setEnd/);
  // Must not reconstruct from plain text
  assert.doesNotMatch(rangeMatch[0], /split\(\s*['"]/);
});

// === INVARIANT LOCKS: WORD BOUNDARIES ===

test("pagination-engine : wordBoundaries utilise regex word \S+ pour identifier les mots", () => {
  // Test that wordBoundaries finds complete words only
  const text = "un deux trois";
  const boundaries = wordBoundaries(text);
  assert.equal(boundaries.length, 3);
  assert.deepEqual(boundaries.map((b) => text.slice(b.start, b.end)), ["un", "deux", "trois"]);
  // Verify no partial word is returned
  assert.ok(boundaries.every((b) => text.slice(b.start, b.end).match(/^\S+$/)));
});

test("pagination-engine : wordPrefixEnds retourne uniquement les débuts de mots suivants", () => {
  const text = "un deux trois";
  const ends = wordPrefixEnds(text);
  // Must return positions that correspond to word boundaries
  const words = wordBoundaries(text);
  assert.equal(ends.length, words.length - 1);
  // Each end should be at the start of the next word
  for (let i = 0; i < ends.length; i++) {
    assert.equal(ends[i], words[i + 1].start);
  }
});

test("pagination-engine : les débuts de mots sont les seules frontières légales de coupure", () => {
  const sourceFile = readSourceFile();
  // Find where wordPrefixEnds is used in the main loop
  const mainLoopMatch = sourceFile.match(/const prefixEnds = wordPrefixEnds[\s\S]{0,600}/);
  assert.ok(mainLoopMatch);
  // Verify loop uses these as the only candidates
  assert.match(mainLoopMatch[0], /for\s*\(/);
  assert.match(mainLoopMatch[0], /prefixEnds/);
  // Verify no arbitrary split happens
  assert.doesNotMatch(mainLoopMatch[0], /split\(/);
});

// === INVARIANT LOCKS: OVERFLOW MEASUREMENT ===

test("pagination-engine : overflows() utilise scrollHeight et clientHeight", () => {
  const sourceFile = readSourceFile();
  const overflowsMatch = sourceFile.match(/function overflows[\s\S]{0,250}/);
  assert.ok(overflowsMatch);
  // Must check scrollHeight > clientHeight
  assert.match(overflowsMatch[0], /scrollHeight.*clientHeight/);
});

test("pagination-engine : overflows() détecte aussi le débordement horizontal", () => {
  const sourceFile = readSourceFile();
  const overflowsMatch = sourceFile.match(/function overflows[\s\S]{0,250}/);
  assert.ok(overflowsMatch);
  // Must check scrollWidth > clientWidth for multi-column detection
  assert.match(overflowsMatch[0], /scrollWidth.*clientWidth/);
});

test("pagination-engine : overflows() ne recourt jamais à getClientRects", () => {
  const sourceFile = readSourceFile();
  const overflowsMatch = sourceFile.match(/function overflows[\s\S]{0,200}/);
  assert.ok(overflowsMatch);
  // Must not use getClientRects (which is approximative)
  assert.doesNotMatch(overflowsMatch[0], /getClientRects/);
  // Must not use any fuzzy measurement
  assert.doesNotMatch(overflowsMatch[0], /getBoundingClientRect/);
});

// === INVARIANT LOCKS: TYPOGRAPHIC COMPOSITION ===

test("pagination-engine : styleComposition() applique la largeur depuis geometry.widthPx", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.widthPx/);
  assert.match(styleMatch[0], /width.*px/);
});

test("pagination-engine : styleComposition() applique la hauteur depuis geometry.heightPx", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.heightPx/);
  assert.match(styleMatch[0], /height.*px/);
});

test("pagination-engine : styleComposition() applique la police depuis geometry.fontFamily", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.fontFamily/);
  assert.match(styleMatch[0], /font-family/);
});

test("pagination-engine : styleComposition() applique la taille depuis geometry.fontSizePt", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.fontSizePt/);
  assert.match(styleMatch[0], /font-size.*pt/);
});

test("pagination-engine : styleComposition() applique line-height depuis geometry.lineHeight", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.lineHeight/);
  assert.match(styleMatch[0], /line-height/);
});

test("pagination-engine : styleComposition() applique text-align depuis geometry.textAlign", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.textAlign/);
  assert.match(styleMatch[0], /text-align/);
});

test("pagination-engine : styleComposition() applique hyphens auto/none selon geometry.hyphens", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,600}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /geometry\.hyphens/);
  assert.match(styleMatch[0], /hyphens/);
  assert.match(styleMatch[0], /auto.*none|none.*auto/);
});

test("pagination-engine : styleComposition() applique column-count pour le multicolonne", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,800}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /column-count/);
  assert.match(styleMatch[0], /columnCount/);
});

test("pagination-engine : styleComposition() applique column-gap pour le multicolonne", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,800}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /column-gap/);
  assert.match(styleMatch[0], /columnGapPt/);
});

test("pagination-engine : styleComposition() applique column-fill: auto pour le multicolonne", () => {
  const sourceFile = readSourceFile();
  const styleMatch = sourceFile.match(/function styleComposition[\s\S]{0,800}/);
  assert.ok(styleMatch);
  assert.match(styleMatch[0], /column-fill/);
  assert.match(styleMatch[0], /auto/);
});

// === INVARIANT LOCKS: HISTORICAL FRAGMENTATION ===

test("pagination-engine : canSplit() reste limité aux paragraphes p", () => {
  const sourceFile = readSourceFile();
  // Verify canSplit function exists and handles paragraphs
  assert.match(sourceFile, /function canSplit\(/);
  assert.match(sourceFile, /tagName.*toLowerCase.*p/);
  assert.match(sourceFile, /textLength/);
  // Must not split blockquotes or other elements
  const hasBlockquoteInCanSplit = sourceFile.match(/function canSplit[\s\S]{0,200}blockquote/);
  assert.equal(hasBlockquoteInCanSplit, null, "canSplit should not split blockquotes");
});

test("pagination-engine : le paragraphe complet est d'abord testé comme candidat entier", () => {
  const sourceFile = readSourceFile();
  // Find the main fragmentation loop
  const loopMatch = sourceFile.match(/const candidate = cloneTextFragment[\s\S]{0,400}/);
  assert.ok(loopMatch);
  // The complete remaining paragraph should be tested first
  assert.match(loopMatch[0], /start\s*,\s*total/);
  // Before trying to find word breaks
  const breakSearchMatch = sourceFile.match(/const prefixEnds = wordPrefixEnds[\s\S]{0,50}/);
  assert.ok(breakSearchMatch);
});

test("pagination-engine : en cas de débordement, les candidats de coupure viennent de wordPrefixEnds", () => {
  const sourceFile = readSourceFile();
  // Find the word prefix search section
  const searchMatch = sourceFile.match(/const prefixEnds = wordPrefixEnds[\s\S]{0,500}/);
  assert.ok(searchMatch);
  // Must loop through prefixEnds
  assert.match(searchMatch[0], /for[\s\S]{0,50}prefixEnds/);
  // Must use the ends to create fragments (they appear in sequence)
  assert.match(searchMatch[0], /prefixEnds[\s\S]{0,100}cloneTextFragment/);
});

test("pagination-engine : aucun mot n'est jamais coupé arbitrairement dans la fragmentation", () => {
  const sourceFile = readSourceFile();
  // Ensure no arbitrary character-based split in the main loop
  const loopSection = sourceFile.match(/while\s*\(\s*start\s*<\s*total[\s\S]{0,2000}/);
  assert.ok(loopSection);
  // Must use wordPrefixEnds for all splits
  assert.match(loopSection[0], /wordPrefixEnds/);
  // Must not split by character count alone
  assert.doesNotMatch(loopSection[0], /start\s*\+\s*\d+(?!\s*\+\s*prefixEnds)/);
});

test("pagination-engine : le paragraphe qui débordera d'une page vide est marqué data-pagination-oversized", () => {
  const sourceFile = readSourceFile();
  // Find where oversized is set
  assert.match(sourceFile, /data-pagination-oversized/);
  // Verify it's set when even a complete fragment won't fit on empty page
  const oversizedMatch = sourceFile.match(/data-pagination-oversized[\s\S]{0,200}/);
  assert.ok(oversizedMatch);
});

test("pagination-engine : la mesure exact de débordement est effectuée avant chaque yield", () => {
  const sourceFile = readSourceFile();
  // Find yield statements
  const yieldMatches = sourceFile.match(/yield/g) || [];
  assert.ok(yieldMatches.length >= 6, "Should have multiple yields after measurements");

  // Verify yields follow overflow checks (historic or with reserved area)
  // Check for either pattern: overflow measurement before yield
  const hasOverflowBeforeYield = sourceFile.match(/const.*Overflows = (overflows|overflowsWithReservedBottomArea)[\s\S]{0,150}yield/);
  assert.ok(hasOverflowBeforeYield, "Overflow measurements should be called before yield");
});

// === LOT 4: TRANSACTIONAL GUARDS ===

test("Lot 4 : height restoration — previousHeight sauvegardée puis restaurée", () => {
  const sourceFile = readSourceFile();
  // Verify the pattern: save height, modify, restore in finally
  const heightPattern = sourceFile.match(/const previousHeight = content\.style\.height[\s\S]{0,200}content\.style\.height = [\s\S]{0,100}finally[\s\S]{0,50}content\.style\.height = previousHeight/);
  assert.ok(heightPattern, "Height must be saved, modified, and restored in finally");
});

test("Lot 4 : geometry.heightPx — jamais assignée", () => {
  const sourceFile = readSourceFile();
  // Verify no direct assignment to geometry.heightPx
  assert.doesNotMatch(sourceFile, /geometry\.heightPx\s*=/);
  // But Math.max calculation is allowed
  assert.match(sourceFile, /Math\.max\(0, geometry\.heightPx - reservedHeight\)/);
});

test("Lot 4 : overflows() — signature et corps inchangés", () => {
  const sourceFile = readSourceFile();
  // Verify overflows function signature and body
  assert.match(sourceFile, /function overflows\(content: HTMLElement\): boolean/);
  assert.match(sourceFile, /return content\.scrollHeight > content\.clientHeight \|\| content\.scrollWidth > content\.clientWidth/);
});

test("Lot 4 : root — typé HTMLElement | ShadowRoot, sans cast", () => {
  const sourceFile = readSourceFile();
  // Verify root type signature
  assert.match(sourceFile, /root: HTMLElement \| ShadowRoot/);
  // Verify no casts
  assert.doesNotMatch(sourceFile, /root as HTMLElement/);
});

test("Lot 4 : aucun état de notes dans le moteur", () => {
  const sourceFile = readSourceFile();
  // Verify no footnote-related state variables in pagination-engine
  assert.doesNotMatch(sourceFile, /currentFootnotes|pendingFootnotes|committedFootnotes/);
});

test("Lot 4 : provider absent = chemin historique", () => {
  const sourceFile = readSourceFile();
  // Verify early guard for missing provider
  const guardPattern = sourceFile.match(/if \(!geometry\.reservedBottomAreaProvider\)\s*\{\s*return overflows\(content\)/);
  assert.ok(guardPattern, "Must guard against missing provider and return directly");
});

// === LOT 1: PAGE STRUCTURE ===

test("Lot 1 : PaginationPage contient bodyNodes et footnoteNodes", () => {
  const sourceFile = readSourceFile();
  // Verify the type definition includes bodyNodes and footnoteNodes
  assert.match(sourceFile, /export type PaginationPage/);
  assert.match(sourceFile, /bodyNodes:\s*Element\[\]/);
  assert.match(sourceFile, /footnoteNodes:\s*Element\[\]/);
});

test("Lot 1 : la conversion finale crée { bodyNodes, footnoteNodes: [] }", () => {
  const sourceFile = readSourceFile();
  // Verify the final return statement creates the new structure
  assert.match(sourceFile, /bodyNodes:\s*item\.nodes/);
  assert.match(sourceFile, /footnoteNodes:\s*\[\]/);
});

test("Lot 1 : CompositionPage.nodes n'est pas modifié", () => {
  const sourceFile = readSourceFile();
  // Verify CompositionPage still has nodes (internal structure unchanged)
  assert.match(sourceFile, /type CompositionPage = \{/);
  assert.match(sourceFile, /nodes:\s*Element\[\]/);
  // Verify no footnoteNodes in CompositionPage
  const compositionMatch = sourceFile.match(/type CompositionPage = \{[\s\S]{0,200}\}/);
  assert.ok(compositionMatch);
  assert.doesNotMatch(compositionMatch[0], /footnoteNodes/);
});

test("Lot 1 : paginateDom utilise toujours paginateDomSteps", () => {
  const sourceFile = readSourceFile();
  // Verify paginateDom function uses paginateDomSteps
  const paginateDomMatch = sourceFile.match(/export function paginateDom[\s\S]{0,400}/);
  assert.ok(paginateDomMatch);
  assert.match(paginateDomMatch[0], /paginateDomSteps/);
  assert.match(paginateDomMatch[0], /steps/);
});

test("Lot 1 : paginateDomCooperatively utilise toujours paginateDomSteps", () => {
  const sourceFile = readSourceFile();
  // Verify paginateDomCooperatively function uses paginateDomSteps
  const cooperativeMatch = sourceFile.match(/export async function paginateDomCooperatively[\s\S]{0,600}/);
  assert.ok(cooperativeMatch);
  assert.match(cooperativeMatch[0], /paginateDomSteps/);
  assert.match(cooperativeMatch[0], /steps/);
});

test("Lot 1 : les deux consommateurs partagent le même moteur paginateDomSteps", () => {
  const sourceFile = readSourceFile();
  // Both consumers should call paginateDomSteps - verify they use the same function name
  const paginateDomUsage = sourceFile.match(/paginateDomSteps/g) || [];
  assert.ok(paginateDomUsage.length >= 3, "paginateDomSteps should be defined and used by both consumers");
  // Verify there's no secondary algorithm
  assert.doesNotMatch(sourceFile, /function\s+\*\s*paginate\w+(?!Steps)/);
});

test("Lot 1 : footnoteNodes est toujours [] en sortie de paginateDomSteps", () => {
  const sourceFile = readSourceFile();
  // Find where footnoteNodes is set in the return
  assert.match(sourceFile, /footnoteNodes:\s*\[\]/);
  // Verify it's in the final return of paginateDomSteps
  const returnMatch = sourceFile.match(/return pages\.filter[\s\S]{0,150}footnoteNodes/);
  assert.ok(returnMatch, "footnoteNodes should be empty in the final return");
});
