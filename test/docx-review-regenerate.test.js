import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  parseDocumentXml,
  parseCommentsXml,
  parseDocxReview,
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

test("LOT 9A — Moteur pur de régénération DOCX (suite complète avec correctifs)", async (t) => {
  // --- BASE TRANSFORMATIONS ---

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

  await t.test("6. Replacement refusé (ins supprimé, del déballé et delText converti en w:t)", () => {
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
      '<w:p><w:ins w:id="1"><w:r><w:t>Ins1</w:t></w:r></w:ins>' +
        '<w:ins w:id="2"><w:r><w:t>Ins2</w:t></w:r></w:ins></w:p>'
    );
    const change1 = {
      type: "insertion",
      text: "Ins1",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "1", kind: "ins" }],
    };
    const change2 = {
      type: "insertion",
      text: "Ins2",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "2", kind: "ins" }],
    };
    const key1 = getItemKey(change1);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change1, change2],
      savedStates: { [key1]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml('<w:p><w:r><w:t>Ins1</w:t></w:r><w:ins w:id="2"><w:r><w:t>Ins2</w:t></w:r></w:ins></w:p>'));
  });

  await t.test("8. Move natif refusé (moveFrom déballé delText->w:t, moveTo et contenu supprimés, range markers supprimés)", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="m1" w:name="move1"/>' +
        '<w:moveFrom w:id="10"><w:r><w:delText>Déplacé</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="m1"/>' +
        '<w:moveToRangeStart w:id="m1_d" w:name="move1"/>' +
        '<w:moveTo w:id="11"><w:r><w:t>Déplacé</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="m1_d"/></w:p>'
    );
    const change = {
      type: "move",
      text: "Déplacé",
      fromText: "Déplacé",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "move1",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "moveFrom" },
        { part: "word/document.xml", id: "11", kind: "moveTo" },
      ],
      moveRangeRefs: [
        { part: "word/document.xml", kind: "moveFromRange", id: "m1", name: "move1" },
        { part: "word/document.xml", kind: "moveToRange", id: "m1_d", name: "move1" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p><w:r><w:t>Déplacé</w:t></w:r></w:p>"));
  });

  await t.test("9. Move implicite accepté (del à l'origine supprimé, ins à la destination déballé)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="10"><w:r><w:delText>Cut</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:ins w:id="11"><w:r><w:t>Cut</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "move",
      text: "Cut",
      fromText: "Cut",
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
    assert.equal(res.parts["word/document.xml"], makeDocXml("<w:p></w:p><w:p><w:r><w:t>Cut</w:t></w:r></w:p>"));
  });

  await t.test("10. Move implicite refusé (del déballé, ins et son contenu supprimés)", () => {
    const xml = makeDocXml(
      '<w:p><w:del w:id="10"><w:r><w:delText>Cut</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:ins w:id="11"><w:r><w:t>Cut</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "move",
      text: "Cut",
      fromText: "Cut",
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
    assert.equal(res.parts["word/document.xml"], makeDocXml('<w:p><w:r><w:t>Cut</w:t></w:r></w:p><w:p></w:p>'));
  });

  // --- MOVES NATIFS DEUX DISTINCTION ET RANGE IDS ---

  await t.test("11. Correctif Section 1 : Deux déplacements natifs distincts A et B — accepter A laisse B strictly inchangé", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="mA" w:name="moveA"/>' +
        '<w:moveFrom w:id="10"><w:r><w:t>Passage A</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="mA"/>' +
        '<w:moveToRangeStart w:id="mA_dest" w:name="moveA"/>' +
        '<w:moveTo w:id="11"><w:r><w:t>Passage A</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="mA_dest"/></w:p>' +
        '<w:p><w:moveFromRangeStart w:id="mB" w:name="moveB"/>' +
        '<w:moveFrom w:id="20"><w:r><w:t>Passage B</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="mB"/>' +
        '<w:moveToRangeStart w:id="mB_dest" w:name="moveB"/>' +
        '<w:moveTo w:id="21"><w:r><w:t>Passage B</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="mB_dest"/></w:p>'
    );
    const changeA = {
      type: "move",
      text: "Passage A",
      fromText: "Passage A",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "moveA",
      revisionRefs: [
        { part: "word/document.xml", id: "10", kind: "moveFrom" },
        { part: "word/document.xml", id: "11", kind: "moveTo" },
      ],
      moveRangeRefs: [
        { part: "word/document.xml", kind: "moveFromRange", id: "mA", name: "moveA" },
        { part: "word/document.xml", kind: "moveToRange", id: "mA_dest", name: "moveA" },
      ],
    };
    const changeB = {
      type: "move",
      text: "Passage B",
      fromText: "Passage B",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "moveB",
      revisionRefs: [
        { part: "word/document.xml", id: "20", kind: "moveFrom" },
        { part: "word/document.xml", id: "21", kind: "moveTo" },
      ],
      moveRangeRefs: [
        { part: "word/document.xml", kind: "moveFromRange", id: "mB", name: "moveB" },
        { part: "word/document.xml", kind: "moveToRange", id: "mB_dest", name: "moveB" },
      ],
    };
    const keyA = getItemKey(changeA);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [changeA, changeB],
      savedStates: { [keyA]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(
      res.parts["word/document.xml"],
      makeDocXml(
        "<w:p><w:r><w:t>Passage A</w:t></w:r></w:p>" +
          '<w:p><w:moveFromRangeStart w:id="mB" w:name="moveB"/>' +
          '<w:moveFrom w:id="20"><w:r><w:t>Passage B</w:t></w:r></w:moveFrom>' +
          '<w:moveFromRangeEnd w:id="mB"/>' +
          '<w:moveToRangeStart w:id="mB_dest" w:name="moveB"/>' +
          '<w:moveTo w:id="21"><w:r><w:t>Passage B</w:t></w:r></w:moveTo>' +
          '<w:moveToRangeEnd w:id="mB_dest"/></w:p>'
      )
    );
  });

  await t.test("12. Correctif Section 2 : IDs de range origine/destination DISTINCTS (w:id=16 vs w:id=13)", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFromRangeStart w:id="16" w:name="moveXYZ"/>' +
        '<w:moveFrom w:id="17"><w:r><w:t>Passage</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="16"/>' +
        '<w:moveToRangeStart w:id="13" w:name="moveXYZ"/>' +
        '<w:moveTo w:id="18"><w:r><w:t>Passage</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="13"/></w:p>'
    );
    const change = {
      type: "move",
      text: "Passage",
      fromText: "Passage",
      author: "A",
      date: "D",
      contextBefore: "",
      moveName: "moveXYZ",
      revisionRefs: [
        { part: "word/document.xml", id: "17", kind: "moveFrom" },
        { part: "word/document.xml", id: "18", kind: "moveTo" },
      ],
      moveRangeRefs: [
        { part: "word/document.xml", kind: "moveFromRange", id: "16", name: "moveXYZ" },
        { part: "word/document.xml", kind: "moveToRange", id: "13", name: "moveXYZ" },
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

  // --- COMMENTAIRES ---

  await t.test("13. Correctif Section 3 : Deux commentaires — traiter le second modifie uniquement son commentEx (paraId exact)", () => {
    const extXml =
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<w15:commentEx w15:paraId="P1" w15:done="0"/>' +
      '<w15:commentEx w15:paraId="P2" w15:paraIdParent="P1" w15:done="0"/>' +
      "</w15:commentsEx>";
    const comment1 = {
      anchorText: "mot1",
      text: "Com 1",
      author: "A",
      date: "D",
      commentId: "0",
      commentExtendedParaId: "P1",
    };
    const comment2 = {
      anchorText: "mot2",
      text: "Com 2",
      author: "A",
      date: "D",
      commentId: "1",
      commentExtendedParaId: "P2",
    };
    const key2 = getItemKey(comment2);
    const res = regenerateDocxParts({
      parts: { "word/commentsExtended.xml": extXml },
      changes: [],
      comments: [comment1, comment2],
      savedStates: { [key2]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(
      res.parts["word/commentsExtended.xml"],
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
        '<w15:commentEx w15:paraId="P1" w15:done="0"/>' +
        '<w15:commentEx w15:paraId="P2" w15:paraIdParent="P1" w15:done="1"/>' +
        "</w15:commentsEx>"
    );
  });

  await t.test("14. Correctif Point 1 EXPLICITE : parseCommentsXml utilise le DERNIER paraId d'un commentaire multi-paragraphe", () => {
    const commentsXml =
      '<w:comments><w:comment w:id="0" w:author="A" w:date="D">' +
      '<w:p w14:paraId="P1"><w:r><w:t>Paragraphe 1</w:t></w:r></w:p>' +
      '<w:p w14:paraId="P2"><w:r><w:t>Paragraphe 2</w:t></w:r></w:p>' +
      '</w:comment></w:comments>';
    const commentsExtendedXml =
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<w15:commentEx w15:paraId="P2" w15:done="0"/>' +
      '</w15:commentsEx>';

    const parsed = parseCommentsXml(commentsXml);
    assert.equal(parsed["0"].commentExtendedParaId, "P2"); // Doit pointer sur le DERNIER (P2) !

    const commentObj = {
      anchorText: "ancre",
      text: "Paragraphe 1\nParagraphe 2",
      author: "A",
      date: "D",
      commentId: "0",
      commentExtendedParaId: parsed["0"].commentExtendedParaId,
    };
    const key = getItemKey(commentObj);
    const res = regenerateDocxParts({
      parts: { "word/commentsExtended.xml": commentsExtendedXml },
      changes: [],
      comments: [commentObj],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(
      res.parts["word/commentsExtended.xml"],
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
        '<w15:commentEx w15:paraId="P2" w15:done="1"/>' +
        '</w15:commentsEx>'
    );
  });

  await t.test("15. Correctif Section 3 : sans commentExtendedParaId sûr -> échec comment-resolution-unsupported", () => {
    const extXml = '<w15:commentsEx><w15:commentEx w15:paraId="P1" w15:done="0"/></w15:commentsEx>';
    const comment = {
      anchorText: "mot",
      text: "Sans paraId",
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
    assert.equal(res.ok, false);
    assert.equal(res.reason, "comment-resolution-unsupported");
  });

  await t.test("16. CommentsExtended absent laisse le commentaire intact sans erreur", () => {
    const comment = {
      anchorText: "mot",
      text: "Sans file ext",
      author: "A",
      date: "D",
      commentId: "0",
      commentExtendedParaId: "P1",
    };
    const key = getItemKey(comment);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": "<w:document/>" },
      changes: [],
      comments: [comment],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/document.xml"], "<w:document/>");
  });

  // --- FOOTNOTES & REPRÉCISION MOVES ---

  await t.test("17. Correctif Section 4 : Move portant une note -> échec unsupported-footnote-move-regeneration sans modifier le XML", () => {
    const xml = makeDocXml(
      '<w:p><w:moveFrom w:id="1"><w:r><w:t>Passage[^1]</w:t></w:r></w:moveFrom>' +
        '<w:moveTo w:id="2"><w:r><w:t>Passage[^1]</w:t></w:r></w:moveTo></w:p>'
    );
    const change = {
      type: "move",
      text: "Passage[^1]",
      fromText: "Passage[^1]",
      author: "A",
      date: "D",
      contextBefore: "",
      footnoteRefs: ["1"],
      revisionRefs: [
        { part: "word/document.xml", id: "1", kind: "moveFrom" },
        { part: "word/document.xml", id: "2", kind: "moveTo" },
      ],
    };
    const key = getItemKey(change);
    const parts = { "word/document.xml": xml };
    const res = regenerateDocxParts({
      parts,
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "unsupported-footnote-move-regeneration");
    assert.equal(parts["word/document.xml"], xml);
  });

  await t.test("18. Footnote insertion acceptée dans word/footnotes.xml", () => {
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

  await t.test("19. Footnote insertion refusée dans word/footnotes.xml", () => {
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

  await t.test("20. Footnote suppression acceptée dans word/footnotes.xml", () => {
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

  await t.test("21. Footnote suppression refusée dans word/footnotes.xml", () => {
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

  await t.test("22. Footnote replacement accepté dans word/footnotes.xml", () => {
    const fnXml = makeFnXml(
      '<w:footnote w:id="1"><w:p><w:del w:id="21"><w:r><w:delText>Ancien</w:delText></w:r></w:del>' +
        '<w:ins w:id="22"><w:r><w:t>Nouveau</w:t></w:r></w:ins></w:p></w:footnote>'
    );
    const change = {
      type: "replacement",
      oldText: "Ancien",
      newText: "Nouveau",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/footnotes.xml", id: "21", kind: "del" },
        { part: "word/footnotes.xml", id: "22", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>Nouveau</w:t></w:r></w:p></w:footnote>'));
  });

  await t.test("23. Footnote replacement refusé dans word/footnotes.xml", () => {
    const fnXml = makeFnXml(
      '<w:footnote w:id="1"><w:p><w:del w:id="21"><w:r><w:delText>Ancien</w:delText></w:r></w:del>' +
        '<w:ins w:id="22"><w:r><w:t>Nouveau</w:t></w:r></w:ins></w:p></w:footnote>'
    );
    const change = {
      type: "replacement",
      oldText: "Ancien",
      newText: "Nouveau",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [
        { part: "word/footnotes.xml", id: "21", kind: "del" },
        { part: "word/footnotes.xml", id: "22", kind: "ins" },
      ],
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/footnotes.xml": fnXml },
      changes: [change],
      savedStates: { [key]: { applied: false, dismissed: true } },
    });
    assert.equal(res.ok, true);
    assert.equal(res.parts["word/footnotes.xml"], makeFnXml('<w:footnote w:id="1"><w:p><w:r><w:t>Ancien</w:t></w:r></w:p></w:footnote>'));
  });

  // --- PPR REVISION REF & PARAGRAPH MARK ---

  await t.test("24. Correctif Point 2 EXPLICITE : lastPPrRevisionRef est remis à null à chaque ouverture de <w:p> (pas de fuite entre A et B)", () => {
    const xml = makeDocXml(
      '<w:p w14:paraId="A">' +
        '<w:pPr><w:rPr><w:moveFrom w:id="1" w:author="A" w:date="D"/></w:rPr></w:pPr>' +
        '<w:moveFromRangeStart w:id="2" w:author="A" w:date="D" w:name="moveA"/>' +
        '<w:moveFrom w:id="3" w:author="A" w:date="D"><w:r><w:t>Texte A</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="2"/></w:p>' +
        '<w:p w14:paraId="B">' +
        // pas de pPr !
        '<w:ins w:id="4"><w:r><w:t>Texte B</w:t></w:r></w:ins></w:p>'
    );

    const { unclassified } = parseDocumentXml(xml);
    assert.equal(unclassified.changes.length, 2);

    const changeB = unclassified.changes.find((c) => c.type === "insertion" && c.text === "Texte B");
    assert.ok(changeB);
    assert.equal(changeB.revisionRefs.length, 1); // Ne doit contenir QUE l'ins id=4, PAS le moveFrom id=1 du paragraphe A !
    assert.equal(changeB.revisionRefs[0].id, "4");
  });

  await t.test("25. Correctif Section 6 : Structure réelle Word paragraph-mark (w:moveFrom/w:moveTo dans w:pPr)", () => {
    const xml = makeDocXml(
      '<w:p w14:paraId="09952DB8">' +
        '<w:pPr><w:rPr><w:moveFrom w:id="1" w:author="A" w:date="D"/></w:rPr></w:pPr>' +
        '<w:moveFromRangeStart w:id="2" w:author="A" w:date="D" w:name="moveP"/>' +
        '<w:moveFrom w:id="3" w:author="A" w:date="D"><w:r><w:t>Paragraphe entier</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="2"/></w:p>' +
        '<w:p w14:paraId="43E80B96">' +
        '<w:pPr><w:rPr><w:moveTo w:id="8" w:author="A" w:date="D"/></w:rPr></w:pPr>' +
        '<w:moveToRangeStart w:id="9" w:author="A" w:date="D" w:name="moveP"/>' +
        '<w:moveTo w:id="10" w:author="A" w:date="D"><w:r><w:t>Paragraphe entier</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/></w:p>'
    );

    const { unclassified } = parseDocxReview({ "word/document.xml": xml });
    assert.equal(unclassified.changes.length, 1);
    const moveChange = unclassified.changes[0];
    assert.equal(moveChange.type, "move");

    const key = getItemKey(moveChange);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [moveChange],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, true);
    assert.equal(
      res.parts["word/document.xml"],
      makeDocXml(
        '<w:p w14:paraId="09952DB8"><w:pPr><w:rPr></w:rPr></w:pPr></w:p>' +
          '<w:p w14:paraId="43E80B96"><w:pPr><w:rPr></w:rPr></w:pPr><w:r><w:t>Paragraphe entier</w:t></w:r></w:p>'
      )
    );
  });

  // --- ERREURS ATOMIQUES & CAS LIMITES ---

  await t.test("26. Revision ID absent -> échec atomique revision-not-found", () => {
    const xml = makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Texte</w:t></w:r></w:ins></w:p>');
    const change = {
      type: "insertion",
      text: "Autre",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "999", kind: "ins" }],
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

  await t.test("27. Revision ID dupliqué -> échec atomique revision-duplicate", () => {
    const xml = makeDocXml(
      '<w:p><w:ins w:id="1"><w:r><w:t>A</w:t></w:r></w:ins>' +
        '<w:ins w:id="1"><w:r><w:t>B</w:t></w:r></w:ins></w:p>'
    );
    const change = {
      type: "insertion",
      text: "A",
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

  await t.test("28. Replacement incomplet atomique -> échec replacement-incomplete", () => {
    const xml = makeDocXml('<w:p><w:del w:id="10"><w:r><w:delText>A</w:delText></w:r></w:del></w:p>');
    const change = {
      type: "replacement",
      oldText: "A",
      newText: "B",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "10", kind: "del" }], // manquant ins !
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "replacement-incomplete");
  });

  await t.test("29. Move incomplet atomique -> échec move-incomplete", () => {
    const xml = makeDocXml('<w:p><w:moveFrom w:id="10"><w:r><w:t>A</w:t></w:r></w:moveFrom></w:p>');
    const change = {
      type: "move",
      text: "A",
      fromText: "A",
      author: "A",
      date: "D",
      contextBefore: "",
      revisionRefs: [{ part: "word/document.xml", id: "10", kind: "moveFrom" }], // manquant moveTo !
    };
    const key = getItemKey(change);
    const res = regenerateDocxParts({
      parts: { "word/document.xml": xml },
      changes: [change],
      savedStates: { [key]: { applied: true, dismissed: false } },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "move-incomplete");
  });

  await t.test("30. État sans saved state inchangé (aucune décision)", () => {
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

  await t.test("31. Correctif Section 7 : regenerateDocxZip sans parsedChanges/parsedComments -> missing-parsed-changes", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", makeDocXml('<w:p><w:ins w:id="1"><w:r><w:t>Ins</w:t></w:r></w:ins></w:p>'));
    const origBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const res = await regenerateDocxZip(origBuffer, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing-parsed-changes");
  });

  await t.test("32. Fichiers ZIP non concernés strictly préservés dans regenerateDocxZip", async () => {
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

  await t.test("33. Correctif isFormatting : une carte de mise en forme (rPrChange) traitée ne touche jamais commentsExtended.xml", async () => {
    const extXml =
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<w15:commentEx w15:paraId="P1" w15:done="0"/>' +
      "</w15:commentsEx>";
    const zip = new JSZip();
    zip.file("word/document.xml", makeDocXml("<w:p><w:r><w:t>Texte</w:t></w:r></w:p>"));
    zip.file("word/commentsExtended.xml", extXml);
    const origBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const formattingComment = {
      anchorText: "Texte",
      text: "Gras appliqué",
      author: "A",
      date: "D",
      isFormatting: true,
      // Pas de commentExtendedParaId : ce n'est pas un vrai commentaire Word.
    };
    const key = getItemKey(formattingComment);

    const res = await regenerateDocxZip(
      origBuffer,
      { [key]: { applied: false, dismissed: true } },
      [],
      [formattingComment]
    );
    assert.equal(res.ok, true);

    const newZip = await JSZip.loadAsync(res.docxBuffer);
    const newExtXml = await newZip.file("word/commentsExtended.xml").async("string");
    assert.equal(newExtXml, extXml);
  });

  await t.test("34. Correctif isFormatting combiné : un vrai commentaire résolu ET une carte de mise en forme traitée en même temps", async () => {
    const extXml =
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<w15:commentEx w15:paraId="P1" w15:done="0"/>' +
      "</w15:commentsEx>";
    const zip = new JSZip();
    zip.file("word/document.xml", makeDocXml("<w:p><w:r><w:t>Texte</w:t></w:r></w:p>"));
    zip.file("word/commentsExtended.xml", extXml);
    const origBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const realComment = {
      anchorText: "Texte",
      text: "Vrai commentaire",
      author: "A",
      date: "D",
      commentId: "0",
      commentExtendedParaId: "P1",
    };
    const formattingComment = {
      anchorText: "Texte",
      text: "Gras appliqué",
      author: "A",
      date: "D",
      isFormatting: true,
    };
    const keyReal = getItemKey(realComment);
    const keyFormatting = getItemKey(formattingComment);

    const res = await regenerateDocxZip(
      origBuffer,
      {
        [keyReal]: { applied: false, dismissed: true },
        [keyFormatting]: { applied: false, dismissed: true },
      },
      [],
      [realComment, formattingComment]
    );
    assert.equal(res.ok, true);

    const newZip = await JSZip.loadAsync(res.docxBuffer);
    const newExtXml = await newZip.file("word/commentsExtended.xml").async("string");
    assert.equal(
      newExtXml,
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
        '<w15:commentEx w15:paraId="P1" w15:done="1"/>' +
        "</w15:commentsEx>"
    );
  });
});
