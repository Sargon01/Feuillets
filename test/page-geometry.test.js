import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePageGeometry } from "../src/services/page-geometry.js";
import { normalizeV2Template } from "../src/services/export-template-v2.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/* §23-§25 du chantier « espace central » : source de vérité UNIQUE de la
 * géométrie de page. Le bug Paysage venait de `settings.pdfOrientation ||
 * tpl.pageOrientation` — `DEFAULT_SETTINGS.pdfOrientation` valant toujours
 * "portrait", le gabarit ne pouvait jamais gagner. */

const LEGACY_PORTRAIT = { pdfPageSize: "A4", pdfOrientation: "portrait" };

test("page-geometry : DEFAULT_SETTINGS.pdfOrientation vaut bien portrait — le piège d'origine existe toujours dans les réglages", () => {
  assert.equal(DEFAULT_SETTINGS.pdfOrientation, "portrait");
});

test("page-geometry : A4 portrait — largeur < hauteur", () => {
  const geometry = resolvePageGeometry({ pageSize: "A4", pageOrientation: "portrait" }, LEGACY_PORTRAIT);
  assert.equal(geometry.widthMm, 210);
  assert.equal(geometry.heightMm, 297);
  assert.ok(geometry.widthMm < geometry.heightMm);
});

test("page-geometry : A4 paysage — largeur > hauteur", () => {
  const geometry = resolvePageGeometry({ pageSize: "A4", pageOrientation: "landscape" }, LEGACY_PORTRAIT);
  assert.equal(geometry.widthMm, 297);
  assert.equal(geometry.heightMm, 210);
  assert.ok(geometry.widthMm > geometry.heightMm);
});

test("page-geometry : le gabarit V2 « landscape » prime sur un réglage legacy « portrait » (cause du bug)", () => {
  const geometry = resolvePageGeometry({ pageOrientation: "landscape" }, { pdfOrientation: "portrait" });
  assert.equal(geometry.orientation, "landscape");
  assert.ok(geometry.widthMm > geometry.heightMm);
});

test("page-geometry : le gabarit V2 « portrait » prime sur un ancien réglage « landscape »", () => {
  const geometry = resolvePageGeometry({ pageOrientation: "portrait" }, { pdfOrientation: "landscape" });
  assert.equal(geometry.orientation, "portrait");
  assert.ok(geometry.widthMm < geometry.heightMm);
});

test("page-geometry : le format du gabarit prime aussi — A5 gagne sur un legacy A4", () => {
  const geometry = resolvePageGeometry({ pageSize: "A5" }, { pdfPageSize: "A4" });
  assert.equal(geometry.widthMm, 148);
  assert.equal(geometry.heightMm, 210);
});

test("page-geometry : repli legacy quand le gabarit n'exprime rien (gabarit intégré)", () => {
  const geometry = resolvePageGeometry({}, { pdfPageSize: "A5", pdfOrientation: "landscape" });
  assert.equal(geometry.size, "A5");
  assert.equal(geometry.orientation, "landscape");
  assert.equal(geometry.widthMm, 210);
  assert.equal(geometry.heightMm, 148);
});

test("page-geometry : sans gabarit ni réglages — A4 portrait", () => {
  const geometry = resolvePageGeometry(null, null);
  assert.equal(geometry.size, "A4");
  assert.equal(geometry.orientation, "portrait");
  assert.equal(geometry.widthMm, 210);
  assert.equal(geometry.heightMm, 297);
});

test("page-geometry : Letter et letter désignent le même format", () => {
  const upper = resolvePageGeometry({ pageSize: "Letter" }, null);
  const lower = resolvePageGeometry({ pageSize: "letter" }, null);
  assert.equal(upper.widthMm, 216);
  assert.equal(upper.heightMm, 279);
  assert.deepEqual({ w: upper.widthMm, h: upper.heightMm }, { w: lower.widthMm, h: lower.heightMm });
});

test("page-geometry : Letter paysage inverse bien les côtés", () => {
  const geometry = resolvePageGeometry({ pageSize: "Letter", pageOrientation: "landscape" }, null);
  assert.equal(geometry.widthMm, 279);
  assert.equal(geometry.heightMm, 216);
});

test("page-geometry : un format inconnu retombe sur A4 sans lever", () => {
  const geometry = resolvePageGeometry({ pageSize: "poche" }, null);
  assert.equal(geometry.widthMm, 210);
  assert.equal(geometry.heightMm, 297);
  assert.equal(geometry.size, "poche", "la valeur brute est conservée pour la règle @page");
});

test("page-geometry : une orientation inconnue est traitée comme portrait", () => {
  assert.equal(resolvePageGeometry({ pageOrientation: "diagonale" }, null).orientation, "portrait");
});

test("page-geometry : Portrait → Paysage → Portrait n'a aucune mémoire (fonction pure)", () => {
  const portrait = resolvePageGeometry({ pageSize: "A4", pageOrientation: "portrait" }, LEGACY_PORTRAIT);
  const landscape = resolvePageGeometry({ pageSize: "A4", pageOrientation: "landscape" }, LEGACY_PORTRAIT);
  const back = resolvePageGeometry({ pageSize: "A4", pageOrientation: "portrait" }, LEGACY_PORTRAIT);
  assert.deepEqual(back, portrait, "aucune valeur portrait/paysage n'est mise en cache");
  assert.notDeepEqual(landscape, portrait);
});

test("page-geometry : un gabarit V2 normalisé fournit directement page.size/page.orientation exploitables", () => {
  const v2 = normalizeV2Template({
    version: 2,
    page: { size: "A5", orientation: "landscape" },
    body: {},
  });
  const geometry = resolvePageGeometry(
    { pageSize: v2.page.size, pageOrientation: v2.page.orientation },
    LEGACY_PORTRAIT
  );
  assert.equal(geometry.orientation, "landscape");
  assert.equal(geometry.widthMm, 210);
  assert.equal(geometry.heightMm, 148);
});
