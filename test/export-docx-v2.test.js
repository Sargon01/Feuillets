import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("export DOCX : consomme le profil et les champs V2 sans toucher au contrat Révision", async () => {
  const source = await readFile(new URL("../src/services/export-docx.js", import.meta.url), "utf8");

  assert.match(source, /resolveExportTemplateV2\(/);
  assert.match(source, /template\.profile === "manuscript"/);
  for (const field of ["template.body", "template.page", "template.headings", "template.header", "template.footer", "template.firstPage"]) {
    assert.ok(source.includes(field), `${field} doit alimenter DOCX`);
  }
  assert.doesNotMatch(source, /exportTemplate === "classique"/);
  assert.match(source, /bookmarkMarkerInfoOf/);
  assert.match(source, /bookmarkIdFor/);
});
