import test from "node:test";
import assert from "node:assert/strict";
import { AlignmentType } from "docx";
import {
  FRONT_PAGE_LINE_SPACING,
  FRONT_TITLE_FONT_SIZE,
  alignmentFor,
  wordLocale,
  sectionPageMargin,
  titleRoleOf,
  frontRoleStyle,
  frontInlineMarks,
  frontSpacing,
  frontAlignment,
} from "../src/services/export-docx-style.js";
import { TITLE_ROLE_MARKER } from "../src/utils/title-roles.js";

test("alignmentFor : « justify » produit un alignement réel, pas undefined", () => {
  const a = alignmentFor({ align: "justify" });
  // régression : AlignmentType.JUSTIFY n'existe pas dans docx et valait
  // undefined — le paragraphe sortait alors au fer à gauche.
  assert.notEqual(a, undefined);
  assert.equal(a, AlignmentType.JUSTIFIED);
});

test("alignmentFor : les autres valeurs, et le repli à gauche", () => {
  assert.equal(alignmentFor({ align: "center" }), AlignmentType.CENTER);
  assert.equal(alignmentFor({ align: "right" }), AlignmentType.RIGHT);
  assert.equal(alignmentFor({ align: "left" }), AlignmentType.LEFT);
  assert.equal(alignmentFor({}), AlignmentType.LEFT);
  assert.equal(alignmentFor({ align: "n'importe quoi" }), AlignmentType.LEFT);
});

test("alignmentFor : aucune valeur reconnue ne renvoie undefined", () => {
  for (const align of ["justify", "center", "right", "left", undefined, ""]) {
    assert.notEqual(alignmentFor({ align }), undefined, `align=${align}`);
  }
});

test("wordLocale : langues reconnues et repli français", () => {
  assert.equal(wordLocale("fr"), "fr-FR");
  assert.equal(wordLocale("en"), "en-US");
  assert.equal(wordLocale("en-GB"), "en-US");
  assert.equal(wordLocale("DE"), "de-DE");
  assert.equal(wordLocale("es-MX"), "es-ES");
  assert.equal(wordLocale("it"), "it-IT");
  assert.equal(wordLocale("klingon"), "fr-FR");
  assert.equal(wordLocale(null), "fr-FR");
  assert.equal(wordLocale(""), "fr-FR");
});

test("sectionPageMargin : marge uniforme d'un modèle", () => {
  assert.deepEqual(sectionPageMargin({ key: "k", label: "l", marginCm: 2.5 }), {
    top: "2.5cm", bottom: "2.5cm", left: "2.5cm", right: "2.5cm",
  });
});

test("sectionPageMargin : marges asymétriques prioritaires", () => {
  const tpl = {
    key: "k", label: "l", marginCm: 2.5,
    marginsCm: { top: 3, bottom: 2, left: 4, right: 1.5 },
  };
  assert.deepEqual(sectionPageMargin(tpl), {
    top: "3cm", bottom: "2cm", left: "4cm", right: "1.5cm",
  });
});

test("sectionPageMargin : repli 2.5cm si le modèle ne dit rien", () => {
  assert.deepEqual(sectionPageMargin({ key: "k", label: "l" }), {
    top: "2.5cm", bottom: "2.5cm", left: "2.5cm", right: "2.5cm",
  });
});

test("titleRoleOf : lit le rôle, en minuscules", () => {
  assert.equal(titleRoleOf({ textContent: `${TITLE_ROLE_MARKER}Sous-Titre` }), "sous-titre");
  assert.equal(titleRoleOf({ textContent: `  ${TITLE_ROLE_MARKER} auteur  ` }), "auteur");
});

test("titleRoleOf : null sur du contenu ordinaire", () => {
  assert.equal(titleRoleOf({ textContent: "Chapitre premier" }), null);
  assert.equal(titleRoleOf({ textContent: "" }), null);
  assert.equal(titleRoleOf(null), null);
});

test("frontRoleStyle : style du rôle, ou null", () => {
  const tpl = { key: "k", label: "l", titlePage: { styles: { titre: { fontSizePt: 18 } } } };
  assert.deepEqual(frontRoleStyle(tpl, "titre"), { fontSizePt: 18 });
  assert.equal(frontRoleStyle(tpl, "auteur"), null);
  assert.equal(frontRoleStyle(tpl, null), null);
  assert.equal(frontRoleStyle({ key: "k", label: "l" }, "titre"), null);
  assert.equal(frontRoleStyle(null, "titre"), null);
});

test("frontInlineMarks : taille convertie en demi-points", () => {
  assert.deepEqual(frontInlineMarks({ style: { fontSizePt: 18, bold: true, italic: false } }), {
    size: 36, bold: true, italics: false,
  });
});

test("frontInlineMarks : sans style, seule la ligne de titre est agrandie", () => {
  assert.deepEqual(frontInlineMarks({ isTitleLine: true }), { size: FRONT_TITLE_FONT_SIZE });
  assert.deepEqual(frontInlineMarks({ isTitleLine: false }), {});
  assert.deepEqual(frontInlineMarks(null), {});
});

test("frontInlineMarks : un style sans taille laisse la taille indéfinie", () => {
  assert.deepEqual(frontInlineMarks({ style: { bold: true } }), {
    size: undefined, bold: true, italics: undefined,
  });
});

test("frontSpacing : marges du rôle converties en twips", () => {
  assert.deepEqual(frontSpacing({ style: { marginTopPt: 126, marginBottomPt: 24 } }), {
    ...FRONT_PAGE_LINE_SPACING, before: 2520, after: 480,
  });
});

test("frontSpacing : interligne simple seul quand le rôle n'impose rien", () => {
  assert.deepEqual(frontSpacing(null), FRONT_PAGE_LINE_SPACING);
  assert.deepEqual(frontSpacing({ isTitleLine: true }), FRONT_PAGE_LINE_SPACING);
  assert.deepEqual(frontSpacing({ style: {} }), FRONT_PAGE_LINE_SPACING);
});

test("frontSpacing : une marge à 0 est appliquée, pas ignorée", () => {
  assert.deepEqual(frontSpacing({ style: { marginTopPt: 0 } }), {
    ...FRONT_PAGE_LINE_SPACING, before: 0,
  });
});

test("frontAlignment : centrage par défaut, alignement du rôle sinon", () => {
  assert.equal(frontAlignment(null), AlignmentType.CENTER);
  assert.equal(frontAlignment({ style: {} }), AlignmentType.CENTER);
  assert.equal(frontAlignment({ style: { align: "right" } }), AlignmentType.RIGHT);
  assert.equal(frontAlignment({ style: { align: "justify" } }), AlignmentType.JUSTIFIED);
});
