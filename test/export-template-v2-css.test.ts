import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyTemplate } from "../src/services/export-template-v2.js";
import { templateV2ToEpubCss } from "../src/services/export-template-v2-css.js";

test("templateV2ToEpubCss : espacement après de 6 pt devient marge basse", () => {
  const template = normalizeLegacyTemplate({ key: "document", label: "Document", paragraphSpacingAfterPt: 6 });
  assert.match(templateV2ToEpubCss(template), /margin: 0pt 0 6pt;/);
});

test("templateV2ToEpubCss : la couleur explicite d'un h1 est exportée", () => {
  const template = normalizeLegacyTemplate({ key: "document", label: "Document", headings: { h1: { colorHex: "#365F91" } } });
  assert.match(templateV2ToEpubCss(template), /h1 \{[^}]*color: #365F91;/);
});

test("templateV2ToEpubCss : un titre sans couleur n'en reçoit aucune", () => {
  const template = normalizeLegacyTemplate({ key: "document", label: "Document", headings: { h1: { fontSizePt: 18 } } });
  assert.doesNotMatch(templateV2ToEpubCss(template), /h1 \{[^}]*color:/);
});
