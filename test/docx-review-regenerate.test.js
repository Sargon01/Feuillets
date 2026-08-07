import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  parseDocumentXml,
  parseCommentsXml,
  parseDocxReview,
  mergeImplicitCutPastePairs,
} from "../src/services/docx-review-import.js";

import {
  regenerateDocxParts,
  regenerateDocxZip,
  getItemKey,
} from "../src/services/docx-review-regenerate.js";

function makeDocXml(inner) {
  return `<w:document><w:body>${inner}</w:body></w:document>`;
}

function makeFnXml(inner) {
  return `<w:footnotes>${inner}</w:footnotes>`;
}

test("LOT 9A — Moteur pur de régénération DOCX révisé", async (t) => {
  await t.test("1. Insertion acceptée (w:ins déballé)", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Texte inséré</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Texte inséré",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Texte inséré</w:t></w:r></w:p>"));
  });

  await t.test("2. Insertion refusée (w:ins et contenu supprimés)", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Texte inséré</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Texte inséré",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p></w:p>"));
  });

  await t.test("3. Suppression acceptée (w:del et contenu supprimés)", () => {
    const xml = makeDocXml('<w:p><w:del w:id="1"><w:r><w:delText>Texte supprimé</w:delText></w:r></w:del></w:p>');
    const change = {
      type: "deletion",
      text: "Texte supprimé",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "del" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p></w:p>"));
  });

  await t.test("4. Suppression refusée (w:del déballé, w:delText converti en w:t)", () => {
    const xml = makeDocXml('<w:p><w:del w:id="1"><w:r><w:delText xml:space="preserve">Texte supprimé</w:delText></w:r></w:del></w:p>');
    const change = {
      type: "deletion",
      text: "Texte supprimé",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "del" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml('<w:p><w:r><w:t xml:space="preserve">Texte supprimé</w:t></w:r></w:p>'));
  });

  await t.test("5. Replacement accepté (del supprimé, ins déballé)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="10"><w:r><w:delText>Ancien</w:delText></w:r></w:del>' +
        '<w:ins w:id="11"><w:r><w:t>Nouveau</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "replacement",
      oldText: "Ancien",
      newText: "Nouveau",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "del" },
        { part: "word/document.xml", id: "11", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Nouveau</w:t></w:r></w:p>"));
  });

  await t.test("6. Replacement refusé (del restauré, ins supprimé)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="10"><w:r><w:delText>Ancien</w:delText></w:r></w:del>' +
        '<w:ins w:id="11"><w:r><w:t>Nouveau</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "replacement",
      oldText: "Ancien",
      newText: "Nouveau",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "del" },
        { part: "word/document.xml", id: "11", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Ancien</w:t></w:r></w:p>"));
  });

  await t.test("7. Révision voisine non ciblée intacte", () => {
    const xml = makeDocXml(
      '<w:p><w:ins w:id="1"><w:r><w:t>Ciblé</w:t></w:r></w:ins>' +
        '<w:ins w:id="2"><w:r><w:t>Non ciblé</w:t></w:r></w:ins></w:p>'
    );
    const change1 = {
      type: "insertion",
      text: "Ciblé",
      author: "A",
      date: "D",
      contextBefore: "",
      ord: 0,
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const change2 = {
      type: "insertion",
      text: "Non ciblé",
      author: "A",
      date: "D",
      contextBefore: "Ciblé",
      ord: 1,
      revisionRefs: [{ part: "word/document.xml", id: "2", kind: "ins" }],
    };
    const key1 = getItemKey(change1);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change1, change2],
      savedStates: { [key1]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(
      res.parts["word/document.xml"],
      makeDocXml('<w:p><w:r><w:t>Ciblé</w:t></w:r><w:ins w:id="2"><w:r><w:t>Non ciblé</w:t></w:r></w:ins></w:p>')
    );
  });

  await t.test("8. Move natif accepté (moveFrom supprimé, moveTo déballé, markers nettoyés)", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="m1" name="move1"/>' +
        '<w:moveFrom w:id="10"><w:r><w:t>Passage</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="m1"/>' +
        '<w:moveToRangeStart w:id="m1" name="move1"/>' +
        '<w:moveTo w:id="11"><w:r><w:t>Passage</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="m1"/></w:p>'
    );
    const change = {
      type: "move",
      text: "Passage",
      fromText: "Passage",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "move1",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "moveFrom" },
        { part: "word/document.xml", id: "11", kind: "moveTo" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Passage</w:t></w:r></w:p>"));
  });

  await t.test("9. Move natif refusé (moveFrom déballé, moveTo supprimé, markers nettoyés)", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="m1" name="move1"/>' +
        '<w:moveFrom w:id="10"><w:r><w:t>Passage</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="m1"/>' +
        '<w:moveToRangeStart w:id="m1" name="move1"/>' +
        '<w:moveTo w:id="11"><w:r><w:t>Passage</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="m1"/></w:p>'
    );
    const change = {
      type: "move",
      text: "Passage",
      fromText: "Passage",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "move1",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "moveFrom" },
        { part: "word/document.xml", id: "11", kind: "moveTo" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Passage</w:t></w:r></w:p>"));
  });

  await t.test("10. Move implicite accepté (del orig supprimé, ins dest déballé)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="5"><w:r><w:delText>Coupé</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:ins w:id="6"><w:r><w:t>Coupé</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "move",
      text: "Coupé",
      fromText: "Coupé",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/document.xml", id: "5", kind: "del" },
        { part: "word/document.xml", id: "6", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p></w:p><w:p><w:r><w:t>Coupé</w:t></w:r></w:p>"));
  });

  await t.test("11. Move implicite refusé (del orig restauré, ins dest supprimé)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="5"><w:r><w:delText>Coupé</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:ins w:id="6"><w:r><w:t>Coupé</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "move",
      text: "Coupé",
      fromText: "Coupé",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/document.xml", id: "5", kind: "del" },
        { part: "word/document.xml", id: "6", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Coupé</w:t></w:r></w:p><w:p></w:p>"));
  });

  await t.test("12. Insertion footnote acceptée dans word/footnotes.xml", () => {
    const fnXml = makeFnXml('<w:footnote w:id="1"><w:p><w:ins w:id="20"><w:r><w:t>Note ajoutée</w:t></w:r></w:ins></w:p></w:footnote>');
    const change = {
      type: "insertion",
      text: "Note ajoutée",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/footnotes.xml", id: "20", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>Note ajoutée</w:t></w:r></w:p></w:footnote>'));
  });

  await t.test("13. Insertion footnote refusée dans word/footnotes.xml", () => {
    const fnXml = makeFnXml('<w:footnote w:id="1"><w:p><w:ins w:id="20"><w:r><w:t>Note ajoutée</w:t></w:r></w:ins></w:p></w:footnote>');
    const change = {
      type: "insertion",
      text: "Note ajoutée",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/footnotes.xml", id: "20", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p></w:p></w:footnote>'));
  });

  await t.test("14. Suppression footnote acceptée dans word/footnotes.xml", () => {
    const fnXml = makeFnXml('<w:footnote w:id="1"><w:p><w:del w:id="21"><w:r><w:delText>Note retirée</w:delText></w:r></w:del></w:p></w:footnote>');
    const change = {
      type: "deletion",
      text: "Note retirée",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/footnotes.xml", id: "21", kind: "del" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p></w:p></w:footnote>'));
  });

  await t.test("15. Suppression footnote refusée dans word/footnotes.xml", () => {
    const fnXml = makeFnXml('<w:footnote w:id="1"><w:p><w:del w:id="21"><w:r><w:delText>Note retirée</w:delText></w:r></w:del></w:p></w:footnote>');
    const change = {
      type: "deletion",
      text: "Note retirée",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/footnotes.xml", id: "21", kind: "del" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>Note retirée</w:t></w:r></w:p></w:footnote>'));
  });

  await t.test("16. Replacement footnote accepté", () => {
    const fnXml = makeFnXml(
      '<w:footnote w:id="1"><w:p><w:del w:id="30"><w:r><w:delText>A</w:delText></w:r></w:del>' +
        '<w:ins w:id="31"><w:r><w:t>B</w:t></w:r></w:ins></w:p></w:footnote>'
    );
    const change = {
      type: "replacement",
      oldText: "A",
      newText: "B",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/footnotes.xml", id: "30", kind: "del" },
        { part: "word/footnotes.xml", id: "31", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>B</w:t></w:r></w:p></w:footnote>'));
  });

  await t.test("17. Replacement footnote refusé", () => {
    const fnXml = makeFnXml(
      '<w:footnote w:id="1"><w:p><w:del w:id="30"><w:r><w:delText>A</w:delText></w:r></w:del>' +
        '<w:ins w:id="31"><w:r><w:t>B</w:t></w:r></w:ins></w:p></w:footnote>'
    );
    const change = {
      type: "replacement",
      oldText: "A",
      newText: "B",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/footnotes.xml", id: "30", kind: "del" },
        { part: "word/footnotes.xml", id: "31", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>A</w:t></w:r></w:p></w:footnote>'));
  });

  await t.test("18. Aucune décision = XML strictement inchangé", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Inchangé</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Inchangé",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], xml);
  });

  await t.test("19. État auto-détecté sans saved state = inchangé", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Déjà là dans MD</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Déjà là dans MD",
      author: "A",
      date: "D",
      contextBefore: "",
      applied: true, // auto-détecté par le parser
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: {}, // aucune décision utilisateur sauvegardée
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], xml);
  });

  await t.test("20. ID absent = échec sans modification", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Present</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Manquant",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "99", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "revision-not-found");
  });

  await t.test("21. ID dupliqué = échec", () => {
    const xml = makeDocXml(
      '<w:p><w:ins w:id="1"><w:r><w:t>Dup1</w:t></w:r></w:ins>' +
        '<w:ins w:id="1"><w:r><w:t>Dup2</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "insertion",
      text: "Dup1",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "revision-duplicate");
  });

  await t.test("22. Moitié replacement absente = échec atomique", () => {
    const xml = makeDocXml('<w:p><w:del w:id="10"><w:r><w:delText>Ancien</w:delText></w:r></w:del></w:p>');
    const change = {
      type: "replacement",
      oldText: "Ancien",
      newText: "Nouveau",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "del" },
        { part: "word/document.xml", id: "99", kind: "ins" }, // 99 manque !
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "revision-not-found");
  });

  await t.test("23. Moitié move absente = échec atomique", () => {
    const xml = makeDocXml('<w:p><w:moveFrom w:id="10"><w:r><w:t>Passage</w:t></w:r></w:moveFrom></w:p>');
    const change = {
      type: "move",
      text: "Passage",
      fromText: "Passage",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "move1",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "moveFrom" },
        { part: "word/document.xml", id: "99", kind: "moveTo" }, // 99 manque !
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "revision-not-found");
  });

  await t.test("24. Parser conserve revisionRefs insertion", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="42" w:author="Author" w:date="D"><w:r><w:t>Texte</w:t></w:r></w:ins></w:p>');
    const { unclassified } = parseDocumentXml(xml);
    assert.equal(unclassified.changes.length, 1);
    assert.deepEqual(unclassified.changes[0].revisionRefs, [{ part: "word/document.xml", id: "42", kind: "ins" }]);
  });

  await t.test("25. Parser conserve revisionRefs suppression", () => {
    const xml = makeDocXml('<w:p><w:del w:id="43" w:author="Author" w:date="D"><w:r><w:delText>Texte</w:delText></w:r></w:del></w:p>');
    const { unclassified } = parseDocumentXml(xml);
    assert.equal(unclassified.changes.length, 1);
    assert.deepEqual(unclassified.changes[0].revisionRefs, [{ part: "word/document.xml", id: "43", kind: "del" }]);
  });

  await t.test("26. Fusion replacement conserve les deux refs", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="100" w:author="A" w:date="D"><w:r><w:delText>A</w:delText></w:r></w:del>' +
        '<w:ins w:id="101" w:author="A" w:date="D"><w:r><w:t>B</w:t></w:r></w:ins></w:p>'
    );
    const { unclassified } = parseDocumentXml(xml);
    assert.equal(unclassified.changes.length, 1);
    assert.equal(unclassified.changes[0].type, "replacement");
    assert.deepEqual(unclassified.changes[0].revisionRefs, [
      { part: "word/document.xml", id: "100", kind: "del" },
      { part: "word/document.xml", id: "101", kind: "ins" },
    ]);
  });

  await t.test("27. Fusion move natif conserve origine/destination refs", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="m1" w:name="move1"/>' +
        '<w:moveFrom w:id="200" w:author="A" w:date="D"><w:r><w:t>Passage</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="m1"/>' +
        '<w:moveToRangeStart w:id="m1" w:name="move1"/>' +
        '<w:moveTo w:id="201" w:author="A" w:date="D"><w:r><w:t>Passage</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="m1"/></w:p>'
    );
    const { unclassified } = parseDocxReview({ "word/document.xml": xml });
    assert.equal(unclassified.changes.length, 1);
    assert.equal(unclassified.changes[0].type, "move");
    assert.deepEqual(unclassified.changes[0].revisionRefs, [
      { part: "word/document.xml", id: "200", kind: "moveFrom" },
      { part: "word/document.xml", id: "201", kind: "moveTo" },
    ]);
  });

  await t.test("28. Move implicite conserve del/ins refs", () => {
    const byPath = {
      "F1.md": {
        changes: [
          {
            type: "deletion",
            text: "Bloc unique déplacé",
            author: "A",
            date: "D",
            contextBefore: "",
            moved: false,
            revisionRefs: [{ part: "word/document.xml", id: "300", kind: "del" }],
          },
        ],
        comments: [],
      },
      "F2.md": {
        changes: [
          {
            type: "insertion",
            text: "Bloc unique déplacé",
            author: "A",
            date: "D",
            contextBefore: "",
            moved: false,
            revisionRefs: [{ part: "word/document.xml", id: "301", kind: "ins" }],
          },
        ],
        comments: [],
      },
    };
    mergeImplicitCutPastePairs(byPath);
    assert.equal(byPath["F2.md"].changes.length, 1);
    assert.equal(byPath["F2.md"].changes[0].type, "move");
    assert.deepEqual(byPath["F2.md"].changes[0].revisionRefs, [
      { part: "word/document.xml", id: "300", kind: "del" },
      { part: "word/document.xml", id: "301", kind: "ins" },
    ]);
  });

  await t.test("29. commentId correctement remonté", () => {
    const commentsXml =
      '<w:comments><w:comment w:id="42" w:author="Author" w:date="D">' +
      '<w:p w14:paraId="P1"><w:r><w:t>Texte du commentaire</w:t></w:r></w:p>' +
      "</w:comment></w:comments>";
    const parsed = parseCommentsXml(commentsXml);
    assert.equal(parsed["42"].commentId, "42");
  });

  await t.test("30. Commentaire traité avec commentsExtended existant (w15:done='1')", () => {
    const extXml =
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<w15:commentEx w15:paraId="P1" w15:paraIdParent="0" w15:done="0"/>' +
      "</w15:commentsEx>";
    const comment = {
      anchorText: "mot",
      text: "Un commentaire",
      author: "A",
      date: "D",
      commentId: "0",
    };
    const key = getItemKey(comment);
    const res = regenerateDocxParts({
      parts: { "word/commentsExtended.xml": extXml },
      changes: [],
      comments: [comment],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.ok(res.parts["word/commentsExtended.xml"].includes('w15:done="1"'));
  });

  await t.test("31. commentsExtended absent = commentaire inchangé", () => {
    const comment = {
      anchorText: "mot",
      text: "Un commentaire",
      author: "A",
      date: "D",
      commentId: "0",
    };
    const key = getItemKey(comment);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": makeDocXml("<w:p/>") },
      changes: [],
      comments: [comment],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/commentsExtended.xml"], undefined);
  });

  await t.test("32. Fichiers ZIP non concernés strictly préservés", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Ins</w:t></w:r></w:ins></w:p>'));
    zip.file("word/styles.xml", "<w:styles><w:style/></w:styles>");
    zip.file("word/header1.xml", "<w:hdr><w:p/></w:hdr>");
    zip.file("docProps/core.xml", "<cp:coreProperties/>");
    zip.file("word/media/image1.png", Uint8Array.from([1, 2, 3, 4, 5]));

    const origBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const change = {
      type: "insertion",
      text: "Ins",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const key = getItemKey(change);

    const res = await regenerateDocxZip(origBuffer, { [key]: { applied: true, dismissed: false } }, [change], []);
    assert.equal(res.ok, true);

    const newZip = await JSZip.loadAsync(res.docxBuffer);
    assert.equal(await newZip.file("word/styles.xml").async("string"), "<w:styles><w:style/></w:styles>");
    assert.equal(await newZip.file("word/header1.xml").async("string"), "<w:hdr><w:p/></w:hdr>");
    assert.equal(await newZip.file("docProps/core.xml").async("string"), "<cp:coreProperties/>");
    const imgData = await newZip.file("word/media/image1.png").async("uint8array");
    assert.deepEqual(Array.from(imgData), [1, 2, 3, 4, 5]);
  });
});
