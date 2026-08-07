import { test } from "node:test";
import assert from "node:assert/strict";
import { walkTags } from "../src/utils/xml.js";
import { bookmarkIdFor } from "../src/utils/docx-bookmarks.js";
import { parseFootnotes } from "../src/utils/footnotes.js";
import {
  parseCommentsXml,
  parseCommentsExtended,
  parseDocumentXml,
  parseDocxReview,
  parseFootnotesXml,
  resolveScenesToPaths,
  resolveOrphans,
  mergeGlobalMovePairs,
  mergeImplicitCutPastePairs,
  absorbMoveOwnedFootnoteRevisions,
  planApplyInterFile,
  searchTextForChange,
  planApply,
  findTolerant,
  findCommentAnchor,
  parseHeadingStyleIds,
  evaluateSingleFileConfidence,
  evaluateInterFileConfidence,
} from "../src/services/docx-review-import.js";

test("walkTags", async (t) => {
  await t.test("distingue ouverture/fermeture/auto-fermant, dans l'ordre", () => {
    const tags = walkTags('<w:p><w:r><w:t>x</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>');
    assert.deepEqual(
      tags.map((x) => [x.name, x.isClose, x.selfClosing]),
      [
        ["w:p", false, false],
        ["w:r", false, false],
        ["w:t", false, false],
        ["w:t", true, false],
        ["w:r", true, false],
        ["w:bookmarkEnd", false, true],
        ["w:p", true, false],
      ]
    );
  });
});

test("parseCommentsXml", async (t) => {
  await t.test("extrait auteur/date/texte d'un commentaire simple", () => {
    const xml =
      '<w:comments><w:comment w:id="0" w:author="Jean Dupont" w:date="2026-01-01T10:00:00Z">' +
      "<w:p><w:r><w:t>Cette source est mal citée.</w:t></w:r></w:p>" +
      "</w:comment></w:comments>";
    const byId = parseCommentsXml(xml);
    assert.deepEqual(byId["0"], {
      author: "Jean Dupont",
      date: "2026-01-01T10:00:00Z",
      text: "Cette source est mal citée.",
      commentId: "0",
    });
  });

  await t.test("commentaire sur plusieurs paragraphes, texte vide sans planter", () => {
    const xml =
      '<w:comments><w:comment w:id="1" w:author="A" w:date="D">' +
      "<w:p><w:r><w:t>Ligne 1.</w:t></w:r></w:p><w:p><w:r><w:t>Ligne 2.</w:t></w:r></w:p>" +
      "</w:comment></w:comments>";
    assert.equal(parseCommentsXml(xml)["1"].text, "Ligne 1.\nLigne 2.");
    assert.deepEqual(parseCommentsXml(""), {});
  });
});

function wrapBody(inner) {
  return `<w:document><w:body>${inner}</w:body></w:document>`;
}

test("parseDocumentXml — signets de feuillet", async (t) => {
  await t.test("classe une modification par le signet en cours", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/><w:r><w:t>Début. </w:t></w:r>' +
        '<w:ins w:id="2" w:author="Dir" w:date="D1"><w:r><w:t>ajout</w:t></w:r></w:ins>' +
        "</w:p>" +
        '<w:bookmarkEnd w:id="1"/>'
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    assert.equal(unclassified.changes.length, 0);
    assert.equal(scenes.fsScene1.changes.length, 1);
    assert.deepEqual(scenes.fsScene1.changes[0], {
      type: "insertion",
      text: "ajout",
      author: "Dir",
      date: "D1",
      contextBefore: "Début. ",
      moved: false,
      moveName: null,
      revisionRefs: [{ part: "word/document.xml", id: "2", kind: "ins" }],
      // Rien ne suit "ajout" dans ce XML (fin de document) : traité comme
      // "un saut de paragraphe suit" (rien à coller à la suite), voir
      // parseDocumentXml (résolution de pendingAfterCapture en fin de
      // boucle).
      followedByParagraphBreak: true,
      toContextAfter: "",
    });
  });

  await t.test("le texte AVANT l'insertion, dans le même paragraphe, n'est pas inclus dans le texte inséré", () => {
    // régression : pendingText scopé au paragraphe entier confondait tout
    // le paragraphe avec le texte réellement ajouté par w:ins
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Deuxième phrase </w:t></w:r>' +
        '<w:ins w:id="2" w:author="Dir" w:date="D"><w:r><w:t>ajoutée</w:t></w:r></w:ins>' +
        '<w:r><w:t> ici.</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes[0].text, "ajoutée");
  });

  await t.test("une modification hors de tout signet tombe dans unclassified", () => {
    const xml = wrapBody(
      '<w:p><w:del w:id="1" w:author="Dir" w:date="D"><w:r><w:delText>retiré</w:delText></w:r></w:del></w:p>'
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    assert.deepEqual(scenes, {});
    assert.equal(unclassified.changes.length, 1);
    assert.equal(unclassified.changes[0].type, "deletion");
    assert.equal(unclassified.changes[0].text, "retiré");
  });

  await t.test("un saut de paragraphe entre deux <w:p> se retrouve dans contextBefore, jamais baké dans .text (régression : le texte inséré portait un \\n\\n fantôme en tête, en double avec contextBefore — cassait la recherche fromContexte+fromText d'un déplacement de paragraphe entier, voir planApplyMove)", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/><w:r><w:t>Fin du premier paragraphe.</w:t></w:r></w:p>' +
        '<w:p><w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>Début du second.</w:t></w:r></w:ins></w:p>'
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes[0].text, "Début du second.");
    assert.equal(scenes.fsScene1.changes[0].contextBefore, "Fin du premier paragraphe.\n\n");
  });

  await t.test("plusieurs <w:p> vides consécutifs (repères de feuillet) ne produisent qu'un seul \\n\\n, jamais plusieurs", () => {
    // simule un repère de feuillet : un <w:p> ne contenant qu'un signet,
    // sans aucun texte — ne doit pas compter comme un vrai paragraphe
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/><w:r><w:t>Avant.</w:t></w:r></w:p>' +
        '<w:p></w:p>' + // paragraphe vide (repère), aucun texte
        '<w:p><w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>Après.</w:t></w:r></w:ins></w:p>'
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes[0].text, "Après.");
    // contextBefore, lui, porte bien le saut de paragraphe — un SEUL, même
    // si plusieurs <w:p> vides se sont succédé avant ce texte.
    assert.equal(scenes.fsScene1.changes[0].contextBefore, "Avant.\n\n");
  });

  await t.test("le texte supprimé (pas encore appliqué) entre bien dans le contexte des changements suivants, puisqu'il est encore dans la source", () => {
    // "supprimé " n'a pas encore été retiré de la source tant qu'on n'a
    // pas cliqué Appliquer dessus — le contexte d'un changement plus loin
    // doit donc en tenir compte, sous peine de chercher une suite de
    // caractères qui n'existe nulle part dans le fichier réel (régression
    // trouvée sur un vrai retour : voir appendText)
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:del w:id="2" w:author="Dir" w:date="D"><w:r><w:delText>supprimé </w:delText></w:r></w:del>' +
        '<w:r><w:t>gardé </w:t></w:r>' +
        '<w:ins w:id="3" w:author="Dir" w:date="D"><w:r><w:t>ajout</w:t></w:r></w:ins>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    const insertion = scenes.fsScene1.changes.find((c) => c.type === "insertion");
    assert.equal(insertion.contextBefore, "supprimé gardé ");
  });

  await t.test("un signet se referme correctement (texte après = hors classification)", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/><w:r><w:t>dans la scène</w:t></w:r></w:p>' +
        '<w:bookmarkEnd w:id="1"/>' +
        '<w:p><w:ins w:id="2" w:author="Dir" w:date="D"><w:r><w:t>après le signet</w:t></w:r></w:ins></w:p>'
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    // rien n'a été poussé pour fsScene1 (seulement du texte inchangé) :
    // bucketFor ne le crée donc jamais, plutôt qu'une entrée vide inutile
    assert.equal(scenes.fsScene1, undefined);
    assert.equal(unclassified.changes.length, 1);
    assert.equal(unclassified.changes[0].text, "après le signet");
    // le saut de paragraphe réel entre eux reste visible — dans
    // contextBefore, jamais baké dans .text (voir plus haut).
    assert.equal(unclassified.changes[0].contextBefore, "dans la scène\n\n");
  });
});

test("parseDocumentXml — commentaires", async (t) => {
  await t.test("associe un commentaire à son texte d'ancrage et au bon feuillet", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:commentRangeStart w:id="0"/>' +
        '<w:r><w:t>passage commenté</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        "</w:p>"
    );
    const commentsById = { "0": { author: "Jean Dupont", date: "D", text: "À retravailler." } };
    const { scenes } = parseDocumentXml(xml, commentsById);
    assert.equal(scenes.fsScene1.comments.length, 1);
    assert.deepEqual(scenes.fsScene1.comments[0], {
      anchorText: "passage commenté",
      text: "À retravailler.",
      author: "Jean Dupont",
      date: "D",
      commentId: "0",
    });
  });

  await t.test("une mise en forme ajoutée (w:rPrChange, ex. barré) devient un commentaire informatif", () => {
    // structure exacte trouvée dans un vrai retour Word ("barrer un mot"
    // sans le supprimer ni le remplacer — invisible avant ce correctif)
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t xml:space="preserve">avant </w:t></w:r>' +
        '<w:r><w:rPr><w:strike/><w:rPrChange w:id="3" w:author="Dir" w:date="D"><w:rPr/></w:rPrChange></w:rPr><w:t>pourtant</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> après.</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.comments.length, 1);
    assert.deepEqual(scenes.fsScene1.comments[0], {
      anchorText: "pourtant",
      text: "Mise en forme modifiée : barré",
      author: "Dir",
      date: "D",
      isFormatting: true,
      markers: ["w:strike"],
    });
  });

  await t.test("plusieurs marques de mise en forme (ex. gras + souligné) sont listées ensemble", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:rPr><w:b/><w:u w:val="single"/><w:rPrChange w:id="1" w:author="A" w:date="D"><w:rPr/></w:rPrChange></w:rPr><w:t>important</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.comments[0].text, "Mise en forme modifiée : gras, souligné");
  });

  await t.test("un w:rPr sans marque de mise en forme reconnue (ex. juste une couleur) ne produit rien", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:rPr><w:color w:val="FF0000"/><w:rPrChange w:id="1" w:author="A" w:date="D"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1, undefined);
  });

  await t.test("une plage de commentaire sans entrée correspondante dans comments.xml est ignorée sans planter", () => {
    const xml = wrapBody(
      '<w:commentRangeStart w:id="9"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="9"/>'
    );
    assert.doesNotThrow(() => parseDocumentXml(xml, {}));
    const { scenes, unclassified } = parseDocumentXml(xml, {});
    assert.equal(unclassified.comments.length, 0);
    assert.deepEqual(scenes, {});
  });

  // Mission item 2 : structure OOXML conforme à la spec Word (comment posé
  // SANS sélectionner de texte — un point, pas une plage) — PAS reproduite
  // depuis un vrai retour (Manuscrit.docx "(2)" ne porte aucun commentaire
  // du tout, voir le rapport de mission), mais un cas réel de la spec
  // OOXML : Word n'émet alors qu'un <w:commentReference> seul, jamais de
  // w:commentRangeStart/End — jusqu'ici silencieusement perdu (aucune
  // branche ne le traitait).
  await t.test("un commentaire posé SANS sélection de texte (w:commentReference isolé, sans commentRangeStart/End) n'est plus perdu", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Du texte normal, sans aucune plage de commentaire. </w:t></w:r>' +
        '<w:r><w:commentReference w:id="7"/></w:r>' +
        "</w:p>"
    );
    const commentsById = { "7": { author: "Dir", date: "D", text: "Vérifier cette date." } };
    const { scenes } = parseDocumentXml(xml, commentsById);
    assert.equal(scenes.fsScene1.comments.length, 1);
    assert.deepEqual(scenes.fsScene1.comments[0], {
      anchorText: "",
      text: "Vérifier cette date.",
      author: "Dir",
      date: "D",
      commentId: "7",
    });
  });

  await t.test("un commentaire NORMALEMENT ancré (commentRangeStart/End + commentReference) n'est jamais compté deux fois", () => {
    // Garde-fou pour le correctif ci-dessus : le w:commentReference qui
    // suit un commentRangeEnd résolu ne doit JAMAIS créer une seconde
    // fiche pour le MÊME commentaire (voir resolvedCommentIds).
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:commentRangeStart w:id="3"/>' +
        '<w:r><w:t>passage ancré</w:t></w:r>' +
        '<w:commentRangeEnd w:id="3"/>' +
        '<w:r><w:commentReference w:id="3"/></w:r>' +
        "</w:p>"
    );
    const commentsById = { "3": { author: "Dir", date: "D", text: "Remarque normale." } };
    const { scenes } = parseDocumentXml(xml, commentsById);
    assert.equal(scenes.fsScene1.comments.length, 1);
    assert.equal(scenes.fsScene1.comments[0].anchorText, "passage ancré");
  });

  await t.test("un commentaire sans sélection, dans une note de bas de page, n'est pas perdu non plus", () => {
    const footnotesXml =
      '<w:footnotes><w:footnote w:id="1">' +
      '<w:p><w:r><w:t xml:space="preserve"> Texte de la note. </w:t></w:r>' +
      '<w:r><w:commentReference w:id="4"/></w:r></w:p>' +
      "</w:footnote></w:footnotes>";
    const commentsById = { "4": { author: "Dir", date: "D", text: "À sourcer." } };
    const buckets = parseFootnotesXml(footnotesXml, commentsById);
    assert.equal(buckets["1"].comments.length, 1);
    assert.equal(buckets["1"].comments[0].anchorText, "");
    assert.equal(buckets["1"].comments[0].text, "À sourcer.");
  });
});

test("parseDocumentXml — orphelins de frontière (prevScene/nextScene)", async (t) => {
  await t.test("un commentaire posé exactement entre deux signets porte les deux scènes candidates", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsSceneA"/><w:r><w:t>Contenu A.</w:t></w:r></w:p>' +
        '<w:bookmarkEnd w:id="1"/>' +
        '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>passage orphelin</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
        '<w:p><w:bookmarkStart w:id="2" w:name="fsSceneB"/><w:r><w:t>Contenu B.</w:t></w:r></w:p>' +
        '<w:bookmarkEnd w:id="2"/>'
    );
    const commentsById = { "0": { author: "Dir", date: "D", text: "Remarque." } };
    const { scenes, unclassified } = parseDocumentXml(xml, commentsById);
    assert.deepEqual(scenes, {}); // ni A ni B n'ont reçu de retour propre — normal ici
    assert.equal(unclassified.comments.length, 1);
    assert.equal(unclassified.comments[0].anchorText, "passage orphelin");
    assert.equal(unclassified.comments[0].prevScene, "fsSceneA");
    assert.equal(unclassified.comments[0].nextScene, "fsSceneB");
  });

  await t.test("un orphelin en tout début de document n'a pas de prevScene (rien avant)", () => {
    const xml = wrapBody(
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>' +
        '<w:p><w:bookmarkStart w:id="1" w:name="fsSceneA"/><w:r><w:t>y</w:t></w:r></w:p>'
    );
    const { unclassified } = parseDocumentXml(xml, { "0": { author: "A", date: "D", text: "t" } });
    assert.equal(unclassified.comments[0].prevScene, null);
    assert.equal(unclassified.comments[0].nextScene, "fsSceneA");
  });
});

test("resolveOrphans", async (t) => {
  await t.test("reclasse un orphelin trouvé dans UN SEUL des deux feuillets candidats", async () => {
    const unclassified = {
      changes: [],
      comments: [{ anchorText: "passage orphelin", text: "Remarque.", author: "A", date: "D", prevScene: "fsA", nextScene: "fsB" }],
    };
    const idToPath = new Map([["fsA", "Chapitre A.md"], ["fsB", "Chapitre B.md"]]);
    const contents = { "Chapitre A.md": "rien ici.", "Chapitre B.md": "avant le passage orphelin après." };
    const relocated = await resolveOrphans(unclassified, idToPath, async (p) => contents[p] ?? null);
    assert.deepEqual(Object.keys(relocated), ["Chapitre B.md"]);
    assert.equal(relocated["Chapitre B.md"].comments.length, 1);
    assert.equal(unclassified.comments.length, 0); // reclassé, retiré des orphelins
  });

  await t.test("trouvé dans les DEUX candidats (ambigu) : reste orphelin, avec les deux comme nearFiles", async () => {
    const unclassified = {
      changes: [],
      comments: [{ anchorText: "passage orphelin", text: "R.", author: "A", date: "D", prevScene: "fsA", nextScene: "fsB" }],
    };
    const idToPath = new Map([["fsA", "A.md"], ["fsB", "B.md"]]);
    const contents = { "A.md": "passage orphelin ici aussi.", "B.md": "passage orphelin ici aussi." };
    const relocated = await resolveOrphans(unclassified, idToPath, async (p) => contents[p]);
    assert.deepEqual(relocated, {});
    assert.equal(unclassified.comments.length, 1);
    assert.deepEqual(unclassified.comments[0].nearFiles, ["A.md", "B.md"]);
  });

  await t.test("trouvé dans AUCUN candidat : reste orphelin avec les candidats en nearFiles", async () => {
    const unclassified = {
      changes: [{ type: "insertion", text: "x", contextBefore: "introuvable nulle part", prevScene: "fsA", nextScene: "fsB" }],
      comments: [],
    };
    const idToPath = new Map([["fsA", "A.md"], ["fsB", "B.md"]]);
    const contents = { "A.md": "rien à voir.", "B.md": "rien non plus." };
    const relocated = await resolveOrphans(unclassified, idToPath, async (p) => contents[p]);
    assert.deepEqual(relocated, {});
    assert.equal(unclassified.changes.length, 1);
    assert.deepEqual(unclassified.changes[0].nearFiles, ["A.md", "B.md"]);
  });

  await t.test("aucune scène candidate résolue en chemin actuel (feuillets renommés depuis) : reste orphelin, nearFiles vide", async () => {
    const unclassified = { changes: [], comments: [{ anchorText: "x", text: "R.", prevScene: "fsInconnu", nextScene: null }] };
    const relocated = await resolveOrphans(unclassified, new Map(), async () => "peu importe");
    assert.deepEqual(relocated, {});
    assert.equal(unclassified.comments.length, 1);
    assert.deepEqual(unclassified.comments[0].nearFiles, []);
  });
});

test("searchTextForChange", async (t) => {
  await t.test("construit le même texte de recherche que planApply pour chaque type", () => {
    assert.equal(searchTextForChange({ type: "insertion", contextBefore: "ctx" }), "ctx");
    assert.equal(searchTextForChange({ type: "deletion", contextBefore: "ctx", text: "txt" }), "ctxtxt");
    assert.equal(searchTextForChange({ type: "replacement", contextBefore: "ctx", oldText: "old" }), "ctxold");
    assert.equal(searchTextForChange({ type: "move", toContext: "dest" }), "dest");
  });
});

test("parseDocumentXml — réécriture (fusion suppression+ajout adjacents)", async (t) => {
  await t.test("un w:del suivi d'un w:ins avec le même contexte devient un seul changement 'replacement'", () => {
    // exactement ce que produit Word pour "sélectionner un mot, taper autre
    // chose" avec le suivi des modifications actif
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Le vent soufflait </w:t></w:r>' +
        '<w:del w:id="2" w:author="Dir" w:date="D"><w:r><w:delText>fort</w:delText></w:r></w:del>' +
        '<w:ins w:id="3" w:author="Dir" w:date="D"><w:r><w:t>doucement</w:t></w:r></w:ins>' +
        '<w:r><w:t> ce soir-là.</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes.length, 1);
    assert.deepEqual(scenes.fsScene1.changes[0], {
      type: "replacement",
      oldText: "fort",
      newText: "doucement",
      author: "Dir",
      date: "D",
      contextBefore: "Le vent soufflait ",
      moved: false,
      revisionRefs: [
        { part: "word/document.xml", id: "2", kind: "del" },
        { part: "word/document.xml", id: "3", kind: "ins" },
      ],
    });
  });

  await t.test("fusionne même quand le contexte avant le mot dépasse 40 caractères (cas réel en pleine prose, pas juste en début de paragraphe)", () => {
    // bug réel signalé : en vraie prose le texte avant le mot remplacé
    // dépasse 40 caractères, les deux contextes tronqués ne coïncidaient
    // plus (égalité stricte), la fusion échouait → deux retours, et
    // appliquer la suppression rendait l'autre inapplicable.
    const longPrefix = "Il marchait depuis longtemps sur cette route poussiéreuse et ";
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        `<w:r><w:t>${longPrefix}</w:t></w:r>` +
        '<w:del w:id="2" w:author="Dir" w:date="D"><w:r><w:delText>chat</w:delText></w:r></w:del>' +
        '<w:ins w:id="3" w:author="Dir" w:date="D"><w:r><w:t>chien</w:t></w:r></w:ins>' +
        '<w:r><w:t> le suivait.</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes.length, 1);
    assert.equal(scenes.fsScene1.changes[0].type, "replacement");
    assert.equal(scenes.fsScene1.changes[0].oldText, "chat");
    assert.equal(scenes.fsScene1.changes[0].newText, "chien");
  });

  await t.test("un w:ins suivi d'un w:del (ordre inverse) fusionne aussi", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Contexte </w:t></w:r>' +
        '<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>neuf</w:t></w:r></w:ins>' +
        '<w:del w:id="3" w:author="A" w:date="D"><w:r><w:delText>ancien</w:delText></w:r></w:del>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes.length, 1);
    assert.equal(scenes.fsScene1.changes[0].type, "replacement");
    assert.equal(scenes.fsScene1.changes[0].oldText, "ancien");
    assert.equal(scenes.fsScene1.changes[0].newText, "neuf");
  });

  await t.test("del(espace)+ins(\" montagnes\")+del(\"steppes\") — structure réelle : toute la chaîne est fusionnée en un seul replacement atomique", () => {
    // trouvé sur un vrai retour : "les steppes" -> "les montagnes" en trois
    // temps (Word ne fusionne pas toujours proprement un remplacement en
    // un seul del+ins). La chaîne del(" ") + ins(" montagnes") + del("steppes")
    // fusionne en un seul replacement (" steppes" -> " montagnes"), appliqué
    // en une seule opération atomique (voir mergeAdjacentReplacements).
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Les pluies d’été sur les</w:t></w:r>' +
        '<w:del w:id="14" w:author="A" w:date="D"><w:r><w:delText xml:space="preserve"> </w:delText></w:r></w:del>' +
        '<w:ins w:id="15" w:author="A" w:date="D"><w:r><w:t xml:space="preserve"> montagnes</w:t></w:r></w:ins>' +
        '<w:del w:id="16" w:author="A" w:date="D"><w:r><w:delText>steppes</w:delText></w:r></w:del>' +
        '<w:r><w:t xml:space="preserve">. </w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    const changes = scenes.fsScene1.changes;
    assert.equal(changes.length, 1);
    const replacement = changes[0];
    assert.equal(replacement.type, "replacement");
    assert.equal(replacement.oldText, " steppes");
    assert.equal(replacement.newText, " montagnes");

    const content = "Les pluies d’été sur les steppes. ";
    const res = planApply(content, replacement);
    assert.equal(res.ok, true);
    assert.equal(res.newContent, "Les pluies d’été sur les montagnes. ");
  });

  await t.test("un ajout et une suppression NON adjacents (contextes différents) restent séparés", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>ajout</w:t></w:r></w:ins>' +
        '<w:r><w:t> texte inchangé entre les deux </w:t></w:r>' +
        '<w:del w:id="3" w:author="A" w:date="D"><w:r><w:delText>retiré</w:delText></w:r></w:del>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes.length, 2);
    assert.equal(scenes.fsScene1.changes[0].type, "insertion");
    assert.equal(scenes.fsScene1.changes[1].type, "deletion");
  });
});

test("parseDocumentXml — déplacement (w:moveFrom/w:moveTo)", async (t) => {
  await t.test("un passage déplacé apparaît à la fois à l'origine (suppression) et à la destination (ajout), marqué 'moved'", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Avant. </w:t></w:r>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>passage déplacé</w:delText></w:r></w:moveFrom>' +
        '<w:r><w:t> Milieu. </w:t></w:r>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>passage déplacé</w:t></w:r></w:moveTo>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    const changes = scenes.fsScene1.changes;
    assert.equal(changes.length, 2);
    const del = changes.find((c) => c.type === "deletion");
    const ins = changes.find((c) => c.type === "insertion");
    assert.equal(del.moved, true);
    assert.equal(ins.moved, true);
    assert.equal(del.text, "passage déplacé");
    assert.equal(ins.text, "passage déplacé");
  });

  await t.test("les deux moitiés reliées par le même w:name (structure réelle) fusionnent en un seul retour 'move'", () => {
    // structure exacte trouvée dans un vrai retour : moveFromRangeStart/
    // moveToRangeStart partagent le même w:name ("move235390922")
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Avant. </w:t></w:r>' +
        '<w:moveFromRangeStart w:id="16" w:author="A" w:date="D" w:name="move235390922"/>' +
        '<w:moveFrom w:id="17" w:author="A" w:date="D"><w:r><w:t>passage déplacé</w:t></w:r></w:moveFrom>' +
        '</w:p><w:moveFromRangeEnd w:id="16"/>' +
        '<w:p><w:r><w:t>Milieu. </w:t></w:r></w:p>' +
        '<w:p><w:moveToRangeStart w:id="13" w:author="A" w:date="D" w:name="move235390922"/>' +
        '<w:moveTo w:id="14" w:author="A" w:date="D"><w:r><w:t>passage déplacé</w:t></w:r></w:moveTo>' +
        "</w:p><w:moveToRangeEnd w:id=\"13\"/>"
    );
    const { scenes } = parseDocumentXml(xml);
    const changes = scenes.fsScene1.changes;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, "move");
    // .text/.fromText restent le passage NU, jamais un \n\n baké en tête
    // (régression confirmée sur un vrai déplacement de paragraphe entier :
    // ce \n\n fantôme, en double avec toContext qui le porte déjà, cassait
    // la recherche fromContexte+fromText — voir planApplyMove). La
    // destination est dans son PROPRE <w:p> (un vrai saut de paragraphe est
    // traversé pour l'atteindre) : ça se lit maintenant dans toContext (qui
    // se termine par "\n\n") et dans destinationBoundary, jamais dans .text.
    assert.equal(changes[0].text, "passage déplacé");
    assert.equal(changes[0].fromText, "passage déplacé");
    assert.equal(changes[0].fromContext, "Avant. ");
    assert.ok(changes[0].toContext.includes("Milieu."));
    assert.ok(changes[0].toContext.endsWith("\n\n"));
    assert.equal(changes[0].destinationBoundary, "between-paragraphs");
  });

  await t.test("des w:name différents (deux déplacements distincts) ne fusionnent jamais entre eux", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:moveFromRangeStart w:id="1" w:name="moveA"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:t>x</w:t></w:r></w:moveFrom>' +
        '</w:p><w:moveFromRangeEnd w:id="1"/>' +
        '<w:p><w:moveToRangeStart w:id="3" w:name="moveB"/>' +
        '<w:moveTo w:id="4" w:author="A" w:date="D"><w:r><w:t>y</w:t></w:r></w:moveTo>' +
        "</w:p><w:moveToRangeEnd w:id=\"3\"/>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes.length, 2);
    assert.ok(scenes.fsScene1.changes.every((c) => c.type !== "move"));
  });
});

test("findTolerant", async (t) => {
  await t.test("trouve la position réelle dans content, tolérante à la typographie", () => {
    const content = "Attends, j'arrive bientôt.";
    const result = findTolerant(content, "j’arrive bientôt");
    assert.ok(result);
    assert.equal(content.slice(result.index, result.index + result.length), "j'arrive bientôt");
  });

  await t.test("introuvable ou ambigu -> null", () => {
    assert.equal(findTolerant("peu importe", "absent"), null);
    assert.equal(findTolerant("répété répété", "répété"), null);
  });
});

test("parseDocxReview — entrée complète", async (t) => {
  await t.test("assemble document.xml et comments.xml", () => {
    const documentXml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:commentRangeStart w:id="0"/><w:r><w:t>texte</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        "</w:p>"
    );
    const commentsXml =
      '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p><w:r><w:t>Remarque.</w:t></w:r></w:p></w:comment></w:comments>';
    const { scenes } = parseDocxReview({ "word/document.xml": documentXml, "word/comments.xml": commentsXml });
    assert.equal(scenes.fsScene1.comments[0].text, "Remarque.");
  });

  await t.test("comments.xml absent (aucun commentaire dans le docx) : pas de plantage", () => {
    const documentXml = wrapBody('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    assert.doesNotThrow(() => parseDocxReview({ "word/document.xml": documentXml }));
  });
});

test("resolveScenesToPaths", async (t) => {
  await t.test("retrouve le feuillet actuel en recalculant le même identifiant", () => {
    const path = "Essai/Manuscrit/Chapitre 1.md";
    const scenes = { [bookmarkIdFor(path)]: { changes: [{ type: "insertion", text: "x" }], comments: [] } };
    const { byPath, unmatched } = resolveScenesToPaths(scenes, [path, "Essai/Manuscrit/Chapitre 2.md"]);
    assert.ok(byPath[path]);
    assert.equal(byPath[path].changes[0].text, "x");
    assert.deepEqual(unmatched, {});
  });

  await t.test("un signet sans feuillet actuel correspondant (renommé/supprimé) part dans unmatched", () => {
    const scenes = { fs_orphelin: { changes: [], comments: [{ text: "remarque" }] } };
    const { byPath, unmatched } = resolveScenesToPaths(scenes, ["Essai/Manuscrit/Chapitre 1.md"]);
    assert.deepEqual(byPath, {});
    assert.equal(unmatched.fs_orphelin.comments[0].text, "remarque");
  });
});

test("planApply", async (t) => {
  await t.test("insertion : trouve le contexte et insère le texte juste après", () => {
    const content = "Le vent soufflait fort sur la lande déserte.";
    const change = { type: "insertion", contextBefore: "soufflait fort", text: " et froid" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Le vent soufflait fort et froid sur la lande déserte.");
  });

  await t.test("suppression : retire le texte trouvé juste après son contexte", () => {
    const content = "Le vent soufflait fort et froid sur la lande déserte.";
    const change = { type: "deletion", contextBefore: "soufflait fort", text: " et froid" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Le vent soufflait fort sur la lande déserte.");
  });

  await t.test("contexte introuvable (texte compilé différent de la source) : échec explicite, rien n'est écrit", () => {
    const content = "Un tout autre texte, jamais compilé de cette façon.";
    const result = planApply(content, { type: "insertion", contextBefore: "soufflait fort", text: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-found");
  });

  await t.test("contexte ambigu (apparaît plusieurs fois) : échec explicite plutôt qu'une correspondance au hasard", () => {
    const content = "Il répéta : soufflait fort. Puis encore : soufflait fort.";
    const result = planApply(content, { type: "insertion", contextBefore: "soufflait fort", text: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ambiguous");
  });

  await t.test("pas de contexte du tout : échec explicite", () => {
    assert.equal(planApply("peu importe", { type: "insertion", contextBefore: "", text: "x" }).ok, false);
  });

  await t.test("tolère l'apostrophe droite (source) vs courbe (frenchTypography, cas le plus fréquent)", () => {
    const content = "Attends, j'arrive bientôt.";
    const change = { type: "insertion", contextBefore: "j’arrive bientôt", text: " enfin" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Attends, j'arrive bientôt enfin.");
  });

  await t.test("tolère ... (source) vs … (frenchTypography)", () => {
    const content = "Attends... j'arrive.";
    const change = { type: "insertion", contextBefore: "Attends…", text: " voilà" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Attends... voilà j'arrive.");
  });

  await t.test("tolère un espace normal (source) vs insécable (frenchTypography, avant ;:!?»)", () => {
    const content = "Vraiment ? Oui.";
    const change = { type: "insertion", contextBefore: "Vraiment ?", text: " !" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Vraiment ? ! Oui.");
  });

  await t.test("suppression avec tolérance de l'apostrophe : ne conserve que le contexte tel qu'il existe dans la source", () => {
    const content = "Il dit qu'il reviendra vite demain.";
    const change = { type: "deletion", contextBefore: "dit qu’il reviendra", text: " vite" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Il dit qu'il reviendra demain.");
  });

  await t.test("un contexte qui recouvre un wikilien déplié reste hors de portée (pas de faux positif)", () => {
    const content = "Elle vit [[Personnages/Jean|Jean]] au loin.";
    // le docx compilé aurait "vit Jean au loin" (wikilien déplié) — pas de
    // correspondance tolérante possible, uniquement typographique
    const result = planApply(content, { type: "insertion", contextBefore: "vit Jean", text: " enfin" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-found");
  });

  await t.test("replacement : remplace ancien texte par nouveau en une seule opération atomique", () => {
    // le cas qui échouait avant la fusion : appliquer l'ajout seul aurait
    // laissé "soufflait doucementfort", puis la suppression n'aurait plus
    // rien trouvé à retirer (le nouveau texte ayant cassé l'adjacence)
    const content = "Le vent soufflait fort ce soir-là.";
    const change = {
      type: "replacement",
      contextBefore: "Le vent soufflait ",
      oldText: "fort",
      newText: "doucement",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Le vent soufflait doucement ce soir-là.");
  });

  await t.test("replacement introuvable : échec explicite, rien n'est écrit", () => {
    const result = planApply("un texte sans rapport", {
      type: "replacement",
      contextBefore: "Le vent soufflait ",
      oldText: "fort",
      newText: "doucement",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-found");
  });

  await t.test("move : destination AVANT origine dans le texte", () => {
    const content = "DEST_CTX puis plus loin ORIG_CTX texte_deplace fin.";
    const change = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ORIG_CTX ",
      fromText: "texte_deplace",
      toContext: "DEST_CTX ",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "DEST_CTX texte_deplacepuis plus loin ORIG_CTX  fin.");
  });

  await t.test("move : origine avant destination dans le texte (cas le plus courant)", () => {
    const content = "Début ORIGINE_CONTEXTE texte_a_deplacer suite. DESTINATION_CONTEXTE fin.";
    const change = {
      type: "move",
      text: "texte_a_deplacer",
      fromContext: "Début ORIGINE_CONTEXTE ",
      fromText: "texte_a_deplacer",
      toContext: "DESTINATION_CONTEXTE ",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Début ORIGINE_CONTEXTE  suite. DESTINATION_CONTEXTE texte_a_deplacerfin.");
  });

  await t.test("move : découpe bien l'origine même si le contexte d'origine a été modifié par un autre edit", () => {
    const content = "Kemal marcha modif_autre_edit texte_a_deplacer suite. DESTINATION_CONTEXTE fin.";
    const change = {
      type: "move",
      text: "texte_a_deplacer",
      fromContext: "Kemal marcha ANCIEN_CONTEXTE ",
      fromText: "texte_a_deplacer",
      toContext: "DESTINATION_CONTEXTE ",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Kemal marcha modif_autre_edit  suite. DESTINATION_CONTEXTE texte_a_deplacerfin.");
  });

  await t.test("move : découpe bien l'origine d'un texte contenant du formattage Markdown (*tekke*) et le déplace à la fin", () => {
    const content = "Les portes du *tekke* claquent déjà. Tu les entends. Le bois qui cède sous la hache. Nos frères courent. Certains vers la cour, d’autres grimpent sur les toits voisins. Le *mürşid* crie une dernière fois.";
    const change = {
      type: "move",
      text: "Les portes du tekke claquent déjà. ",
      fromContext: "",
      fromText: "Les portes du tekke claquent déjà. ",
      toContext: "crie une dernière fois.",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(
      result.newContent,
      "Tu les entends. Le bois qui cède sous la hache. Nos frères courent. Certains vers la cour, d’autres grimpent sur les toits voisins. Le *mürşid* crie une dernière fois.Les portes du *tekke* claquent déjà. "
    );
  });

  await t.test("move : contexte de destination introuvable -> échec explicite", () => {
    const result = planApply("texte sans rapport", {
      type: "move",
      text: "x",
      fromContext: "a",
      fromText: "b",
      toContext: "c",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-found");
  });
});

test("mergeGlobalMovePairs", async (t) => {
  await t.test("fusionne un moveFrom dans Feuillet 1 et un moveTo dans Feuillet 2 en un seul move inter-feuillets", () => {
    const byPath = {
      "Feuillet1.md": {
        changes: [{ type: "deletion", moved: true, moveName: "move123", text: "texte_deplace", contextBefore: "ContextA " }],
        comments: [],
      },
      "Feuillet2.md": {
        changes: [{ type: "insertion", moved: true, moveName: "move123", text: "texte_deplace", contextBefore: "ContextB " }],
        comments: [],
      },
    };
    const unclassified = { changes: [], comments: [] };

    mergeGlobalMovePairs(byPath, {}, unclassified);

    assert.equal(byPath["Feuillet1.md"].changes.length, 0);
    assert.equal(byPath["Feuillet2.md"].changes.length, 1);

    const merged = byPath["Feuillet2.md"].changes[0];
    assert.equal(merged.type, "move");
    assert.equal(merged.fromPath, "Feuillet1.md");
    assert.equal(merged.toPath, "Feuillet2.md");
    assert.equal(merged.text, "texte_deplace");
    assert.equal(merged.fromText, "texte_deplace");
  });
});

test("planApplyInterFile", async (t) => {
  await t.test("supprime le texte de fromFile et l'insère dans toFile", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Début ContextB fin.",
    };
    const modified = {};
    const mockVault = {
      read: async (f) => files[f.path],
      modify: async (f, newContent) => {
        files[f.path] = newContent;
        modified[f.path] = newContent;
      },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };

    const res = await planApplyInterFile(mockVault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.equal(modified["F1.md"], "Début ContextA  suite.");
    assert.equal(modified["F2.md"], "Début ContextB texte_deplacefin.");
  });

  await t.test("lit les deux feuillets, écrit puis RELIT chacun pour vérification (Lot 3 — écriture transactionnelle), origine avant destination", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Début ContextB fin.",
    };
    const order = [];
    const vault = {
      async read(file) {
        order.push(`read:${file.path}`);
        return files[file.path];
      },
      async modify(file, content) {
        order.push(`modify:${file.path}`);
        files[file.path] = content;
      },
    };

    const result = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    });

    assert.equal(result.ok, true);
    // Chaque écriture est immédiatement relue et comparée au contenu
    // attendu, avant de passer au feuillet suivant (voir
    // planApplyInterFile) : origine écrite+vérifiée, PUIS destination
    // écrite+vérifiée — jamais les deux écritures groupées sans relecture.
    assert.deepEqual(order, [
      "read:F1.md",
      "read:F2.md",
      "modify:F1.md",
      "read:F1.md",
      "modify:F2.md",
      "read:F2.md",
    ]);
  });

  await t.test("n'écrit aucun feuillet si l'insertion à destination échoue", async () => {
    const order = [];
    const vault = {
      async read(file) {
        order.push(`read:${file.path}`);
        return file.path === "F1.md" ? "ContextA texte_deplace" : "ContextB puis ContextB";
      },
      async modify(file) {
        order.push(`modify:${file.path}`);
      },
    };

    const result = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB",
    });

    assert.deepEqual(result, { ok: false, step: "to", reason: "ambiguous" });
    assert.deepEqual(order, ["read:F1.md", "read:F2.md"]);
  });
});

/* =========================================================================
 * LOT 3 — sécurité transactionnelle des applications DOCX multi-feuillets.
 * Un déplacement inter-feuillets touche DEUX fichiers : soit les deux
 * finissent modifiés (et vérifiés), soit AUCUN des deux ne l'est — jamais
 * fromFile vidé sans que toFile ait reçu le texte, ni l'inverse, ni un
 * fichier "à moitié" écrit après une erreur. Voir planApplyInterFile.
 * ========================================================================= */
test("planApplyInterFile — sécurité transactionnelle (LOT 3)", async (t) => {
  await t.test("2. origine valide mais destination devenue invalide (contexte de destination introuvable) : aucun fichier modifié", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Contenu qui ne contient plus du tout le contexte attendu.",
    };
    const originalF1 = files["F1.md"];
    const originalF2 = files["F2.md"];
    let modifyCalled = false;
    const vault = {
      read: async (f) => files[f.path],
      modify: async () => { modifyCalled = true; },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContexteDisparu ",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(res.step, "to");
    assert.equal(modifyCalled, false, "aucune écriture, même partielle, quand la destination n'est plus retrouvable");
    assert.equal(files["F1.md"], originalF1);
    assert.equal(files["F2.md"], originalF2);
  });

  await t.test("3. destination valide mais origine ambiguë (sans note) : aucun fichier modifié", async () => {
    const files = {
      // "texte_deplace" apparaît deux fois à l'identique : localisation ambiguë côté origine.
      "F1.md": "ContextA texte_deplace. Puis ContextA texte_deplace. encore.",
      "F2.md": "Début ContextB fin.",
    };
    const originalF1 = files["F1.md"];
    const originalF2 = files["F2.md"];
    let modifyCalled = false;
    const vault = {
      read: async (f) => files[f.path],
      modify: async () => { modifyCalled = true; },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(res.step, "from");
    assert.equal(modifyCalled, false, "aucune écriture, même partielle, quand l'origine est ambiguë");
    assert.equal(files["F1.md"], originalF1);
    assert.equal(files["F2.md"], originalF2);
  });

  await t.test("5. erreur simulée lors de l'écriture du DEUXIÈME fichier (destination) : le premier fichier (origine), déjà écrit, est restauré à l'identique", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Début ContextB fin.",
    };
    const originalF1 = files["F1.md"];
    const originalF2 = files["F2.md"];
    const calls = [];
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => {
        calls.push(f.path);
        if (f.path === "F2.md" && calls.filter((p) => p === "F2.md").length === 1) {
          // Écriture simulée en échec (ex. permission refusée, coffre en
          // lecture seule) — F1 a DÉJÀ été écrit à ce stade.
          throw new Error("écriture simulée en échec (F2)");
        }
        files[f.path] = c;
      },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(res.step, "to");
    // La restauration de F1 a réussi : "write-failed" (jamais
    // "rollback-failed", réservé au cas où la restauration échoue aussi).
    assert.equal(res.reason, "write-failed");
    // Jamais un état intermédiaire : F1 restauré, F2 jamais touché.
    assert.equal(files["F1.md"], originalF1, "F1 doit être restauré à son contenu d'origine après l'échec d'écriture de F2");
    assert.equal(files["F2.md"], originalF2, "F2 n'a jamais reçu le texte : il reste inchangé");
    // F1 écrit, PUIS F2 tenté (échec), PUIS F1 restauré.
    assert.deepEqual(calls, ["F1.md", "F2.md", "F1.md"]);
  });

  await t.test("6. échec de la VÉRIFICATION après écriture (le contenu relu ne correspond pas à ce qui vient d'être écrit) : restauration complète des DEUX fichiers", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Début ContextB fin.",
    };
    const originalF1 = files["F1.md"];
    const originalF2 = files["F2.md"];
    let toWriteCount = 0;
    const vault = {
      read: async (f) => {
        // Simule un coffre qui rapporte une écriture réussie (modify ne
        // lève rien) mais dont la relecture immédiate de F2 renvoie un
        // contenu DIFFÉRENT de ce qui a été demandé (ex. un conflit de
        // synchronisation résolu silencieusement) — seulement pour la
        // toute première relecture, juste après la première écriture.
        if (f.path === "F2.md" && toWriteCount === 1) return "CONTENU DIFFÉRENT — jamais ce qui a été écrit";
        return files[f.path];
      },
      modify: async (f, c) => {
        if (f.path === "F2.md") toWriteCount++;
        files[f.path] = c;
      },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(res.step, "to");
    // F1 (déjà écrit ET vérifié) ET F2 (écrit mais relu différent) sont
    // TOUS LES DEUX restaurés à l'identique — jamais l'un sans l'autre.
    assert.equal(files["F1.md"], originalF1);
    assert.equal(files["F2.md"], originalF2);
  });

  await t.test("8. frontmatter YAML strictement identique avant/après — succès, PUIS après restauration suite à un échec simulé", async () => {
    const fmF1 = '---\ntitle: "Un"\nstatus: draft\n---\n\n';
    const fmF2 = '---\ntitle: "Deux"\nstatus: draft\n---\n\n';
    const bodyF1 = "Début ContextA texte_deplace suite.";
    const bodyF2 = "Début ContextB fin.";
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };

    // Cas succès : le frontmatter des DEUX fichiers ressort identique.
    const files = { "F1.md": fmF1 + bodyF1, "F2.md": fmF2 + bodyF2 };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(modified["F1.md"].startsWith(fmF1), "frontmatter de F1 inchangé après un déplacement réussi");
    assert.ok(modified["F2.md"].startsWith(fmF2), "frontmatter de F2 inchangé après un déplacement réussi");

    // Cas échec (écriture de F2 simulée en échec) : le frontmatter de F1,
    // déjà réécrit puis restauré, ressort EXACTEMENT identique — jamais
    // déplacé, dupliqué ni inséré dans le corps.
    const files2 = { "F1.md": fmF1 + bodyF1, "F2.md": fmF2 + bodyF2 };
    const vault2 = {
      read: async (f) => files2[f.path],
      modify: async (f, c) => {
        if (f.path === "F2.md") throw new Error("échec simulé");
        files2[f.path] = c;
      },
    };
    const res2 = await planApplyInterFile(vault2, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res2.ok, false);
    assert.equal(files2["F1.md"], fmF1 + bodyF1, "frontmatter + corps de F1 restaurés à l'identique, au caractère près");
    assert.equal(files2["F2.md"], fmF2 + bodyF2, "F2 jamais touché");
  });

  await t.test("9. la restauration elle-même échoue après l'échec d'écriture du DEUXIÈME fichier : reason distinct \"rollback-failed\", jamais confondu avec un simple échec d'écriture", async () => {
    const files = {
      "F1.md": "Début ContextA texte_deplace suite.",
      "F2.md": "Début ContextB fin.",
    };
    const calls = [];
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => {
        calls.push(f.path);
        if (f.path === "F2.md") {
          // Écriture de la destination en échec (comme le test 5)...
          throw new Error("écriture simulée en échec (F2)");
        }
        if (f.path === "F1.md" && calls.filter((p) => p === "F1.md").length === 2) {
          // ...ET la tentative de RESTAURATION de F1 (2ᵉ appel modify sur
          // F1 : la 1ʳᵉ écriture, réussie, puis cette tentative de retour
          // en arrière) échoue elle aussi — ex. coffre devenu inaccessible
          // entre-temps. L'état initial n'est alors PLUS garanti retrouvé.
          throw new Error("restauration simulée en échec (F1)");
        }
        files[f.path] = c;
      },
    };
    const moveChange = {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(res.step, "to");
    // Jamais "write-failed" ici : la restauration elle-même a échoué, la
    // fonction ne doit surtout pas laisser croire que F1 est bien revenu à
    // son état initial.
    assert.equal(res.reason, "rollback-failed");
    assert.deepEqual(calls, ["F1.md", "F2.md", "F1.md"], "écriture F1, tentative F2 (échec), tentative de restauration F1 (échec elle aussi)");
  });
});

/* =========================================================================
 * LOT 4 — statuts de confiance ("safe"/"review"/"ambiguous"), calculés
 * UNIQUEMENT à partir de preuves déjà produites par le moteur existant
 * (planApply/planApplyMove/planApplyInterFile) — jamais un score, jamais
 * une heuristique arbitraire. Voir evaluateSingleFileConfidence/
 * evaluateInterFileConfidence.
 * ========================================================================= */
test("evaluateSingleFileConfidence / evaluateInterFileConfidence — LOT 4 (statuts de confiance)", async (t) => {
  await t.test("1. insertion unique avec contexte fort -> safe", () => {
    const content = "Chapitre un. Il faisait beau ce matin-là.";
    const res = evaluateSingleFileConfidence(content, {
      type: "insertion",
      contextBefore: "Il faisait beau ",
      text: "vraiment ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "safe", confidenceReasons: ["exact-match"] });
  });

  await t.test("2. suppression unique -> safe", () => {
    const content = "Début. Texte à couper entièrement. Fin.";
    const res = evaluateSingleFileConfidence(content, {
      type: "deletion",
      contextBefore: "Début. ",
      text: "Texte à couper entièrement. ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "safe", confidenceReasons: ["exact-match"] });
  });

  await t.test("3. remplacement unique -> safe", () => {
    const content = "Le chat noir dort sur le tapis.";
    const res = evaluateSingleFileConfidence(content, {
      type: "replacement",
      contextBefore: "Le ",
      oldText: "chat noir",
      newText: "chien blanc",
      text: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "safe", confidenceReasons: ["exact-match"] });
  });

  await t.test("4. déplacement Word NATIF (moveName renseigné), même feuillet, complet et vérifiable -> safe", () => {
    const content = "Début ContextA texte_deplace suite. ContextB fin.";
    const res = evaluateSingleFileConfidence(content, {
      type: "move",
      moveName: "moveId-1",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
      contextBefore: "", oldText: "", newText: "",
    });
    assert.deepEqual(res, { confidence: "safe", confidenceReasons: ["exact-match"] });
  });

  await t.test("4bis. déplacement Word NATIF inter-feuillets, complet et vérifiable -> safe", () => {
    const fromContent = "Début ContextA texte_deplace suite.";
    const toContent = "Début ContextB fin.";
    const res = evaluateInterFileConfidence(fromContent, toContent, {
      type: "move",
      moveName: "moveId-2",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    });
    assert.deepEqual(res, { confidence: "safe", confidenceReasons: ["exact-match"] });
  });

  await t.test("5. déplacement IMPLICITE (aucun moveName), appariement pourtant unique -> review (jamais safe)", () => {
    const content = "Début ContextA texte_deplace suite. ContextB fin.";
    const res = evaluateSingleFileConfidence(content, {
      type: "move",
      // moveName absent : couper-coller déduit d'un w:del + w:ins, jamais déclaré par Word.
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
      contextBefore: "", oldText: "", newText: "",
    });
    assert.deepEqual(res, { confidence: "review", confidenceReasons: ["implicit-move"] });
  });

  await t.test("5bis. déplacement implicite inter-feuillets, appariement unique -> review", () => {
    const fromContent = "Début ContextA texte_deplace suite.";
    const toContent = "Début ContextB fin.";
    const res = evaluateInterFileConfidence(fromContent, toContent, {
      type: "move",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    });
    assert.deepEqual(res, { confidence: "review", confidenceReasons: ["implicit-move"] });
  });

  await t.test("6. correspondance obtenue seulement après dégradation SIGNIFICATIVE du contexte -> review", () => {
    // Le contexte fourni ne correspond PAS tel quel (préfixe fabriqué,
    // absent du fichier) : seul un candidat tronqué (repli de dégradation
    // progressive, voir getContextCandidates) retrouve une correspondance
    // UNIQUE — jamais candidates[0], donc jamais "exact".
    const content = "Chapitre deux. Il pleuvait sur la ville endormie hier soir.";
    const fabricatedContext = "X".repeat(40) + " la ville endormie";
    const res = evaluateSingleFileConfidence(content, {
      type: "insertion",
      contextBefore: fabricatedContext,
      text: "NOUVEAU ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "review", confidenceReasons: ["context-degraded"] });
  });

  await t.test("7. retour d'abord ORPHELIN, relocalisé de façon unique (relocatedOrphan) -> review, même avec une correspondance par ailleurs exacte", () => {
    const content = "Chapitre un. Il faisait beau ce matin-là.";
    const res = evaluateSingleFileConfidence(content, {
      type: "insertion",
      contextBefore: "Il faisait beau ",
      text: "vraiment ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
      relocatedOrphan: true,
    });
    assert.equal(res.confidence, "review");
    assert.ok(res.confidenceReasons.includes("relocated-orphan"));
  });

  await t.test("8. plusieurs occurrences possibles -> ambiguous (multiple-matches)", () => {
    const content = "Contexte. Passage identique. Puis Contexte. Passage identique. encore.";
    const res = evaluateSingleFileConfidence(content, {
      type: "insertion",
      contextBefore: "Contexte. ",
      text: "AJOUT ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "ambiguous", confidenceReasons: ["multiple-matches"] });
  });

  await t.test("9. passage/contexte introuvable -> ambiguous (missing-source)", () => {
    const content = "Un contenu qui ne contient rien de ce qui est cherché.";
    const res = evaluateSingleFileConfidence(content, {
      type: "insertion",
      contextBefore: "Ce contexte n'existe nulle part ici ",
      text: "AJOUT ",
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
    });
    assert.deepEqual(res, { confidence: "ambiguous", confidenceReasons: ["missing-source"] });
  });

  await t.test("10. destination de déplacement inter-feuillets NON vérifiable (toContext introuvable dans toContent) -> ambiguous (missing-source)", () => {
    const fromContent = "Début ContextA texte_deplace suite.";
    const toContent = "Contenu totalement différent, sans le contexte attendu.";
    const res = evaluateInterFileConfidence(fromContent, toContent, {
      type: "move",
      moveName: "moveId-3",
      text: "texte_deplace",
      fromContext: "ContextA ",
      fromText: "texte_deplace",
      toContext: "ContexteAbsent ",
    });
    assert.deepEqual(res, { confidence: "ambiguous", confidenceReasons: ["missing-source"] });
  });

  await t.test("10bis. origine de déplacement AMBIGUË (fromText apparaît deux fois) -> ambiguous (multiple-matches)", () => {
    const fromContent = "texte_deplace ici. Puis texte_deplace ici. encore.";
    const toContent = "Début ContextB fin.";
    const res = evaluateInterFileConfidence(fromContent, toContent, {
      type: "move",
      moveName: "moveId-4",
      text: "texte_deplace",
      fromContext: "",
      fromText: "texte_deplace",
      toContext: "ContextB ",
    });
    assert.deepEqual(res, { confidence: "ambiguous", confidenceReasons: ["multiple-matches"] });
  });

  await t.test("note impossible à associer avec certitude (passage d'origine ambigu, note portée) -> ambiguous (footnote-unverifiable)", () => {
    const fromContent = "Il partit[^1] à l'aube. Puis Il partit[^1] à l'aube. encore.\n\n[^1]: Vers l'inconnu.";
    const toContent = "Destination.";
    const res = evaluateInterFileConfidence(fromContent, toContent, {
      type: "move",
      moveName: "moveId-5",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "",
      toContext: "Destination.",
      footnoteRefs: ["1"],
    });
    assert.deepEqual(res, { confidence: "ambiguous", confidenceReasons: ["footnote-unverifiable"] });
  });
});

test("parseDocxReview — commentaire étendu et note rattachés au même feuillet", () => {
  const documentXml = wrapBody(
    '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
      '<w:commentRangeStart w:id="0"/><w:r><w:t>ancre</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>'
  );
  const commentsXml =
    '<w:comments><w:comment w:id="0" w:author="A" w:date="D"><w:p w14:paraId="P1"><w:r><w:t>Remarque.</w:t></w:r></w:p></w:comment></w:comments>';
  const commentsExtendedXml = '<w15:commentsEx><w15:commentEx w15:paraId="P1" w15:done="1"/></w15:commentsEx>';
  const footnotesXml =
    '<w:footnotes><w:footnote w:id="1"><w:p><w:ins w:author="A" w:date="D"><w:r><w:t>note ajoutée</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>';

  const { scenes } = parseDocxReview({
    "word/document.xml": documentXml,
    "word/comments.xml": commentsXml,
    "word/commentsExtended.xml": commentsExtendedXml,
    "word/footnotes.xml": footnotesXml,
  });

  assert.equal(scenes.S.comments[0].resolvedInWord, true);
  assert.equal(scenes.S.changes[0].text, "note ajoutée");
  assert.equal(scenes.S.changes[0].inFootnote, true);
});

test("resolveOrphans conserve un orphelin sans texte retrouvé", async () => {
  const unclassified = {
    changes: [{ type: "insertion", contextBefore: "texte absent", text: " ajout", prevScene: "A", nextScene: "B" }],
    comments: [],
  };
  const relocated = await resolveOrphans(
    unclassified,
    new Map([["A", "Projet/A.md"], ["B", "Projet/B.md"]]),
    async () => "contenu sans correspondance"
  );

  assert.deepEqual(relocated, {});
  assert.equal(unclassified.changes.length, 1);
  assert.deepEqual(unclassified.changes[0].nearFiles, ["Projet/A.md", "Projet/B.md"]);
});

test("planApply — tolérance CRLF (coffres Windows)", async (t) => {
  await t.test("un contexte enjambant une fin de paragraphe s'applique même si le feuillet est en CRLF", () => {
    // contenu du feuillet en CRLF (Windows) ; le contexte reconstruit du
    // .docx, lui, n'a que des LF — sans tolérance \r?\n, échec systématique.
    const content = "Premier paragraphe.\r\n\r\nSecond paragraphe ici.";
    const change = { type: "insertion", contextBefore: "Premier paragraphe.\n\nSecond paragraphe", text: " précis" };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.equal(result.newContent, "Premier paragraphe.\r\n\r\nSecond paragraphe précis ici.");
  });

  await t.test("findTolerant retrouve un texte multi-paragraphes dans un contenu CRLF", () => {
    const content = "aaa\r\nbbb ccc";
    const m = findTolerant(content, "aaa\nbbb");
    assert.notEqual(m, null);
    assert.equal(content.slice(m.index, m.index + m.length), "aaa\r\nbbb");
  });
});

test("parseDocumentXml — ordinal de départage (getItemKey)", async (t) => {
  await t.test("deux changements identiques reçoivent des ord distincts", () => {
    // même contexte + même texte inséré, à deux endroits — sans ord, une clé
    // de mémorisation unique les confondrait (résoudre l'un masque l'autre).
    const xml =
      '<w:body>' +
      '<w:bookmarkStart w:id="1" w:name="S"/>' +
      '<w:p><w:r><w:t>le mot juste </w:t></w:r>' +
      '<w:ins w:author="A"><w:r><w:t>vraiment</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:r><w:t>le mot juste </w:t></w:r>' +
      '<w:ins w:author="A"><w:r><w:t>vraiment</w:t></w:r></w:ins></w:p>' +
      '<w:bookmarkEnd w:id="1"/>' +
      '</w:body>';
    const { scenes } = parseDocumentXml(xml, {});
    const changes = scenes["S"].changes;
    assert.equal(changes.length, 2);
    assert.notEqual(changes[0].ord, changes[1].ord);
  });
});

test("parseFootnotesXml — corrections dans une note de bas de page", async (t) => {
  const SEP =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

  await t.test("un ajout suivi dans le texte d'une note devient un changement, note technique ignorée", () => {
    const xml =
      "<w:footnotes>" + SEP +
      '<w:footnote w:id="1"><w:p>' +
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' +
      '<w:r><w:t>Voir Beachler, </w:t></w:r>' +
      '<w:ins w:author="Dir" w:date="D"><w:r><w:t>2011</w:t></w:r></w:ins>' +
      "</w:p></w:footnote>" +
      "</w:footnotes>";
    const byId = parseFootnotesXml(xml, {});
    assert.deepEqual(Object.keys(byId), ["1"]);
    assert.equal(byId["1"].changes.length, 1);
    assert.equal(byId["1"].changes[0].type, "insertion");
    assert.equal(byId["1"].changes[0].text, "2011");
    assert.equal(byId["1"].changes[0].contextBefore, "Voir Beachler, ");
    assert.equal(byId["1"].changes[0].inFootnote, true);
  });

  await t.test("une note sans aucune modification suivie ne produit aucune entrée", () => {
    const xml =
      "<w:footnotes>" + SEP +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Note inchangée.</w:t></w:r></w:p></w:footnote>' +
      "</w:footnotes>";
    assert.deepEqual(parseFootnotesXml(xml, {}), {});
  });
});

test("parseDocxReview — rattachement des retours de note au bon feuillet", async (t) => {
  await t.test("un ajout dans une note est classé sous le feuillet contenant l'appel de note", () => {
    const documentXml =
      "<w:body>" +
      '<w:bookmarkStart w:id="1" w:name="fsScene7"/>' +
      "<w:p><w:r><w:t>Le texte principal </w:t></w:r>" +
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
      "<w:r><w:t> continue.</w:t></w:r></w:p>" +
      '<w:bookmarkEnd w:id="1"/>' +
      "</w:body>";
    const footnotesXml =
      "<w:footnotes>" +
      '<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>' +
      '<w:footnote w:id="1"><w:p>' +
      '<w:r><w:footnoteRef/></w:r>' +
      '<w:r><w:t>Source, page </w:t></w:r>' +
      '<w:ins w:author="Dir"><w:r><w:t>42</w:t></w:r></w:ins>' +
      "</w:p></w:footnote>" +
      "</w:footnotes>";
    const { scenes, unclassified } = parseDocxReview({
      "word/document.xml": documentXml,
      "word/footnotes.xml": footnotesXml,
    });
    assert.equal(unclassified.changes.length, 0);
    assert.ok(scenes.fsScene7);
    assert.equal(scenes.fsScene7.changes.length, 1);
    assert.equal(scenes.fsScene7.changes[0].text, "42");
    assert.equal(scenes.fsScene7.changes[0].inFootnote, true);
  });

  await t.test("un appel de note hors de tout signet -> le retour de note tombe dans unclassified", () => {
    const documentXml =
      "<w:body><w:p><w:r><w:t>Sans signet </w:t></w:r>" +
      '<w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body>';
    const footnotesXml =
      '<w:footnotes><w:footnote w:id="1"><w:p>' +
      '<w:del w:author="Dir"><w:delText>à retirer</w:delText></w:del>' +
      "</w:p></w:footnote></w:footnotes>";
    const { unclassified } = parseDocxReview({
      "word/document.xml": documentXml,
      "word/footnotes.xml": footnotesXml,
    });
    assert.equal(unclassified.changes.length, 1);
    assert.equal(unclassified.changes[0].type, "deletion");
    assert.equal(unclassified.changes[0].text, "à retirer");
  });
});

test("parseCommentsExtended + parseCommentsXml (résolu / réponses)", async (t) => {
  await t.test("parseCommentsExtended lit done et paraIdParent", () => {
    const xml =
      '<w15:commentsEx>' +
      '<w15:commentEx w15:paraId="AA" w15:done="1"/>' +
      '<w15:commentEx w15:paraId="BB" w15:paraIdParent="AA" w15:done="0"/>' +
      '</w15:commentsEx>';
    const ext = parseCommentsExtended(xml);
    assert.equal(ext["AA"].done, true);
    assert.equal(ext["AA"].paraIdParent, null);
    assert.equal(ext["BB"].done, false);
    assert.equal(ext["BB"].paraIdParent, "AA");
  });

  await t.test("un commentaire marqué done dans Word reçoit done:true", () => {
    const commentsXml =
      '<w:comments><w:comment w:id="0" w:author="Dir" w:date="D">' +
      '<w:p w14:paraId="AA"><w:r><w:t>À revoir.</w:t></w:r></w:p>' +
      '</w:comment></w:comments>';
    const ext = { AA: { done: true, paraIdParent: null } };
    const byId = parseCommentsXml(commentsXml, ext);
    assert.equal(byId["0"].done, true);
    assert.equal(byId["0"].text, "À revoir.");
  });

  await t.test("une réponse reçoit parentId = l'id du commentaire parent", () => {
    const commentsXml =
      '<w:comments>' +
      '<w:comment w:id="0" w:author="Dir"><w:p w14:paraId="AA"><w:r><w:t>Point initial.</w:t></w:r></w:p></w:comment>' +
      '<w:comment w:id="1" w:author="Auteur"><w:p w14:paraId="BB"><w:r><w:t>Ma réponse.</w:t></w:r></w:p></w:comment>' +
      '</w:comments>';
    const ext = { BB: { done: false, paraIdParent: "AA" } };
    const byId = parseCommentsXml(commentsXml, ext);
    assert.equal(byId["1"].parentId, "0");
    assert.equal(byId["0"].parentId, undefined);
  });

  await t.test("sans commentsExtended, un commentaire garde sa forme exacte (pas de done/parentId parasites)", () => {
    const commentsXml =
      '<w:comments><w:comment w:id="0" w:author="A" w:date="D">' +
      '<w:p w14:paraId="AA"><w:r><w:t>Simple.</w:t></w:r></w:p>' +
      '</w:comment></w:comments>';
    assert.deepEqual(parseCommentsXml(commentsXml), { "0": { author: "A", date: "D", text: "Simple.", commentId: "0", commentExtendedParaId: "AA" } });
  });

  await t.test("resolvedInWord se propage jusqu'à l'entrée de commentaire du feuillet", () => {
    const commentsXml =
      '<w:comments><w:comment w:id="0" w:author="Dir" w:date="D">' +
      '<w:p w14:paraId="AA"><w:r><w:t>Déjà traité.</w:t></w:r></w:p>' +
      '</w:comment></w:comments>';
    const documentXml =
      '<w:body><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>le passage</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      '<w:bookmarkEnd w:id="1"/></w:body>';
    const commentsExtendedXml = '<w15:commentsEx><w15:commentEx w15:paraId="AA" w15:done="1"/></w15:commentsEx>';
    const { scenes } = parseDocxReview({
      "word/document.xml": documentXml,
      "word/comments.xml": commentsXml,
      "word/commentsExtended.xml": commentsExtendedXml,
    });
    assert.equal(scenes.fsScene1.comments.length, 1);
    assert.equal(scenes.fsScene1.comments[0].resolvedInWord, true);
  });
});

test("parseDocumentXml — conservation du gras/italique dans une insertion (w:ins)", async (t) => {
  const scene = (insXml) =>
    '<w:body><w:bookmarkStart w:id="1" w:name="S"/><w:p>' +
    '<w:r><w:t>Le </w:t></w:r>' + insXml +
    '</w:p><w:bookmarkEnd w:id="1"/></w:body>';
  const run = (rpr, txt) => `<w:r>${rpr}<w:t>${txt}</w:t></w:r>`;

  await t.test("un mot inséré en gras devient **mot**", () => {
    const xml = scene('<w:ins w:author="X">' + run("<w:rPr><w:b/></w:rPr>", "mot") + "</w:ins>");
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "**mot**");
  });

  await t.test("un mot inséré en italique devient *mot*", () => {
    const xml = scene('<w:ins w:author="X">' + run("<w:rPr><w:i/></w:rPr>", "mot") + "</w:ins>");
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "*mot*");
  });

  await t.test("gras + italique -> ***mot***", () => {
    const xml = scene('<w:ins w:author="X">' + run("<w:rPr><w:b/><w:i/></w:rPr>", "mot") + "</w:ins>");
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "***mot***");
  });

  await t.test("insertion sans mise en forme reste du texte brut", () => {
    const xml = scene('<w:ins w:author="X">' + run("", "mot") + "</w:ins>");
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "mot");
  });

  await t.test("format mixte (un mot gras + un mot normal) -> texte brut, sans marqueur bancal", () => {
    const xml = scene(
      '<w:ins w:author="X">' + run("<w:rPr><w:b/></w:rPr>", "gras") + run("", " normal") + "</w:ins>"
    );
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "gras normal");
  });

  await t.test("w:b w:val=\"0\" (gras désactivé sur le run) n'ajoute pas de marqueur", () => {
    const xml = scene('<w:ins w:author="X">' + run('<w:rPr><w:b w:val="0"/></w:rPr>', "mot") + "</w:ins>");
    assert.equal(parseDocumentXml(xml, {}).scenes.S.changes[0].text, "mot");
  });
});

/* =========================================================================
 * mergeImplicitCutPastePairs — couper-coller Word enregistré comme un w:del
 * ET un w:ins séparés (aucun w:name partagé), y compris quand le passage
 * porte un appel de note de bas de page. Appelée APRÈS mergeGlobalMovePairs
 * dans le pipeline réel (voir docx-review-view.ts) : les vrais déplacements
 * natifs restent prioritaires, jamais reconsidérés ici.
 * ========================================================================= */

test("mergeImplicitCutPastePairs", async (t) => {
  await t.test("1. couper-coller implicite dans le même feuillet", () => {
    const path = "Feuillet1.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        "<w:r><w:t>Avant. </w:t></w:r>" +
        '<w:del w:id="2" w:author="A" w:date="D"><w:r><w:delText>passage coupé</w:delText></w:r></w:del>' +
        "<w:r><w:t> Milieu. </w:t></w:r>" +
        '<w:ins w:id="3" w:author="A" w:date="D"><w:r><w:t>passage coupé</w:t></w:r></w:ins>' +
        "</w:p>"
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    const { byPath, unmatched } = resolveScenesToPaths(scenes, [path]);

    // Sans fusion, deux retours séparés (jamais un w:name commun : pas natif).
    assert.equal(byPath[path].changes.length, 2);

    mergeGlobalMovePairs(byPath, unmatched, unclassified); // ne fait rien ici (aucun moveName)
    mergeImplicitCutPastePairs(byPath, unmatched, unclassified);

    assert.equal(byPath[path].changes.length, 1);
    const merged = byPath[path].changes[0];
    assert.equal(merged.type, "move");
    assert.equal(merged.moved, true);
    assert.equal(merged.text, "passage coupé");
    assert.equal(merged.fromText, "passage coupé");
    assert.equal(merged.fromPath, path);
    assert.equal(merged.toPath, path);
    assert.equal(merged.moveName, undefined, "jamais un faux moveName prétendument venu de Word");
  });

  await t.test("2. couper-coller implicite entre deux feuillets", () => {
    const byPath = {
      "Feuillet1.md": {
        changes: [{ type: "deletion", author: "A", date: "D", text: "passage coupé", contextBefore: "ContexteA " }],
        comments: [],
      },
      "Feuillet2.md": {
        changes: [{ type: "insertion", author: "A", date: "D", text: "passage coupé", contextBefore: "ContexteB " }],
        comments: [],
      },
    };
    const unclassified = { changes: [], comments: [] };

    mergeImplicitCutPastePairs(byPath, {}, unclassified);

    assert.equal(byPath["Feuillet1.md"].changes.length, 0);
    assert.equal(byPath["Feuillet2.md"].changes.length, 1);
    const merged = byPath["Feuillet2.md"].changes[0];
    assert.equal(merged.type, "move");
    assert.equal(merged.fromPath, "Feuillet1.md");
    assert.equal(merged.toPath, "Feuillet2.md");
    assert.equal(merged.text, "passage coupé");
    assert.equal(merged.fromText, "passage coupé");
  });

  await t.test("3. différences d'espaces Word uniquement (CRLF, insécable, suites d'espaces) : fusion malgré tout", () => {
    const byPath = {
      "F1.md": {
        changes: [{
          type: "deletion", author: "A", date: "D",
          text: "Le grand\r\nvoyage  commence.",
          contextBefore: "X ",
        }],
        comments: [],
      },
      "F2.md": {
        changes: [{
          type: "insertion", author: "A", date: "D",
          text: "Le grand\nvoyage  commence.",
          contextBefore: "Y ",
        }],
        comments: [],
      },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 0);
    assert.equal(byPath["F2.md"].changes.length, 1);
    assert.equal(byPath["F2.md"].changes[0].type, "move");
  });

  await t.test("4. auteurs différents : aucune fusion", () => {
    const byPath = {
      "F1.md": { changes: [{ type: "deletion", author: "Alice", date: "D", text: "un passage", contextBefore: "X" }], comments: [] },
      "F2.md": { changes: [{ type: "insertion", author: "Bob", date: "D", text: "un passage", contextBefore: "Y" }], comments: [] },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 1);
    assert.equal(byPath["F2.md"].changes.length, 1);
    assert.ok(byPath["F1.md"].changes.every((c) => c.type !== "move"));
  });

  await t.test("5. textes différents : aucune fusion", () => {
    const byPath = {
      "F1.md": { changes: [{ type: "deletion", author: "A", date: "D", text: "un passage", contextBefore: "X" }], comments: [] },
      "F2.md": { changes: [{ type: "insertion", author: "A", date: "D", text: "un autre passage", contextBefore: "Y" }], comments: [] },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 1);
    assert.equal(byPath["F2.md"].changes.length, 1);
  });

  await t.test("6. deux insertions candidates identiques : aucune fusion (ambiguïté)", () => {
    const byPath = {
      "F1.md": { changes: [{ type: "deletion", author: "A", date: "D", text: "un passage", contextBefore: "X" }], comments: [] },
      "F2.md": {
        changes: [
          { type: "insertion", author: "A", date: "D", text: "un passage", contextBefore: "Y" },
          { type: "insertion", author: "A", date: "D", text: "un passage", contextBefore: "Z" },
        ],
        comments: [],
      },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 1, "la suppression reste seule, aucun candidat unique en face");
    assert.equal(byPath["F2.md"].changes.length, 2, "les deux insertions candidates restent telles quelles");
    assert.ok(byPath["F1.md"].changes.every((c) => c.type !== "move"));
    assert.ok(byPath["F2.md"].changes.every((c) => c.type !== "move"));
  });

  await t.test("7. deux suppressions candidates identiques : aucune fusion (ambiguïté)", () => {
    const byPath = {
      "F1.md": {
        changes: [
          { type: "deletion", author: "A", date: "D", text: "un passage", contextBefore: "X" },
          { type: "deletion", author: "A", date: "D", text: "un passage", contextBefore: "W" },
        ],
        comments: [],
      },
      "F2.md": { changes: [{ type: "insertion", author: "A", date: "D", text: "un passage", contextBefore: "Y" }], comments: [] },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 2);
    assert.equal(byPath["F2.md"].changes.length, 1);
    assert.ok(byPath["F2.md"].changes.every((c) => c.type !== "move"));
  });

  await t.test("8. un vrai w:moveFrom/w:moveTo natif (moveFromRangeStart/moveToRangeStart, w:name partagé) n'est jamais reconsidéré par la détection implicite", () => {
    const path = "Feuillet1.md";
    const id = bookmarkIdFor(path);
    // Structure réelle (voir "parseDocumentXml — déplacement") : les deux
    // moitiés sont reliées par le MÊME w:name — sans lui, mergeMovePairs ne
    // les fusionnerait pas non plus (cas déjà couvert par le test 1er du
    // bloc "déplacement (w:moveFrom/w:moveTo)").
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        "<w:r><w:t>Avant. </w:t></w:r>" +
        '<w:moveFromRangeStart w:id="16" w:author="A" w:date="D" w:name="move1"/>' +
        '<w:moveFrom w:id="17" w:author="A" w:date="D"><w:r><w:t>passage déplacé</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="16"/>' +
        "<w:r><w:t> Milieu. </w:t></w:r>" +
        '<w:moveToRangeStart w:id="13" w:author="A" w:date="D" w:name="move1"/>' +
        '<w:moveTo w:id="14" w:author="A" w:date="D"><w:r><w:t>passage déplacé</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="13"/>' +
        "</w:p>"
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    const { byPath, unmatched } = resolveScenesToPaths(scenes, [path]);

    // mergeMovePairs (interne à parseDocumentXml, même feuillet) a déjà tout
    // fusionné en un seul retour "move" — mergeGlobalMovePairs et
    // mergeImplicitCutPastePairs ne doivent RIEN y changer.
    assert.equal(byPath[path].changes.length, 1);
    assert.equal(byPath[path].changes[0].type, "move");
    const before = { ...byPath[path].changes[0] };

    mergeGlobalMovePairs(byPath, unmatched, unclassified);
    mergeImplicitCutPastePairs(byPath, unmatched, unclassified);

    assert.equal(byPath[path].changes.length, 1);
    assert.deepEqual(byPath[path].changes[0], before);
  });

  await t.test("9. un remplacement adjacent (del+ins voisins) reste un 'replacement', jamais transformé en move", () => {
    const path = "Feuillet1.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        "<w:r><w:t>Le chat dort sur les </w:t></w:r>" +
        '<w:del w:id="2" w:author="A" w:date="D"><w:r><w:delText>steppes</w:delText></w:r></w:del>' +
        '<w:ins w:id="3" w:author="A" w:date="D"><w:r><w:t>montagnes</w:t></w:r></w:ins>' +
        "</w:p>"
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    const { byPath, unmatched } = resolveScenesToPaths(scenes, [path]);

    assert.equal(byPath[path].changes.length, 1);
    assert.equal(byPath[path].changes[0].type, "replacement");

    mergeGlobalMovePairs(byPath, unmatched, unclassified);
    mergeImplicitCutPastePairs(byPath, unmatched, unclassified);

    assert.equal(byPath[path].changes.length, 1);
    assert.equal(byPath[path].changes[0].type, "replacement");
    assert.equal(byPath[path].changes[0].oldText, "steppes");
    assert.equal(byPath[path].changes[0].newText, "montagnes");
  });

  await t.test("10. déplacement implicite dans le même feuillet avec un appel de note", () => {
    const path = "Feuillet1.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        "<w:r><w:t>Avant. </w:t></w:r>" +
        '<w:del w:id="2" w:author="A" w:date="D"><w:r><w:delText>Il partit</w:delText></w:r>' +
        '<w:r><w:footnoteReference w:id="1"/></w:r>' +
        '<w:r><w:delText> à l\'aube.</w:delText></w:r></w:del>' +
        "<w:r><w:t> Milieu. </w:t></w:r>" +
        '<w:ins w:id="3" w:author="A" w:date="D"><w:r><w:t>Il partit</w:t></w:r>' +
        '<w:r><w:footnoteReference w:id="1"/></w:r>' +
        "<w:r><w:t> à l'aube.</w:t></w:r></w:ins>" +
        "</w:p>"
    );
    const { scenes, unclassified } = parseDocumentXml(xml);
    const { byPath, unmatched } = resolveScenesToPaths(scenes, [path]);

    mergeGlobalMovePairs(byPath, unmatched, unclassified);
    mergeImplicitCutPastePairs(byPath, unmatched, unclassified);

    assert.equal(byPath[path].changes.length, 1);
    const merged = byPath[path].changes[0];
    assert.equal(merged.type, "move");
    assert.equal(merged.text, "Il partit[^1] à l'aube.");
    assert.equal(merged.fromText, "Il partit[^1] à l'aube.");
    assert.deepEqual(merged.footnoteRefs, ["1"]);
  });

  await t.test("16. une différence dans les appels de notes (identifiants Word différents) : aucune fusion", () => {
    const byPath = {
      "F1.md": {
        changes: [{
          type: "deletion", author: "A", date: "D",
          text: "Il partit[^1] à l'aube.", contextBefore: "X",
          footnoteRefs: ["1"],
        }],
        comments: [],
      },
      "F2.md": {
        changes: [{
          type: "insertion", author: "A", date: "D",
          text: "Il partit à l'aube.", contextBefore: "Y",
          // aucun appel de note ici : compte différent -> pas d'égalité
        }],
        comments: [],
      },
    };
    mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
    assert.equal(byPath["F1.md"].changes.length, 1);
    assert.equal(byPath["F2.md"].changes.length, 1);
    assert.ok(byPath["F1.md"].changes.every((c) => c.type !== "move"));
  });
});

/* =========================================================================
 * Application d'un déplacement (même feuillet ou inter-fichiers) portant un
 * appel de note — planApplyMove (via planApply) pour le même feuillet,
 * planApplyInterFile pour deux feuillets distincts.
 * ========================================================================= */

test("planApply (move) — appel de note dans un déplacement même feuillet", async (t) => {
  await t.test("11. l'appel de note est préservé après application (le VRAI label du fichier, pas l'id Word)", () => {
    // Le fichier réel utilise [^3] (numérotation propre au feuillet),
    // jamais l'identifiant interne Word ([^1] ici) reconstruit depuis le
    // docx — voir toleranceGroup (joker) et le README de planApplyMove.
    const content =
      "Début. Il partit[^3] à l'aube. Milieu. Fin.\n\n[^3]: Vers l'inconnu.";
    const change = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Fin.",
      footnoteRefs: ["1"],
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    assert.ok(result.newContent.includes("Fin.Il partit[^3] à l'aube."));
    assert.ok(!result.newContent.includes("Début. Il partit[^3] à l'aube. Milieu."));
  });

  await t.test("12. la définition de note n'est jamais dupliquée par un déplacement même feuillet", () => {
    const content =
      "Début. Il partit[^3] à l'aube. Milieu. Fin.\n\n[^3]: Vers l'inconnu.";
    const change = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Fin.",
      footnoteRefs: ["1"],
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    const defCount = (result.newContent.match(/\[\^3\]:/g) || []).length;
    assert.equal(defCount, 1, "une seule définition [^3]: doit subsister");
  });
});

test("planApplyInterFile — transfert de note entre feuillets", async (t) => {
  await t.test("13. déplacement entre deux feuillets avec transfert de la définition", async () => {
    const files = {
      "F1.md": "Début. Il partit[^2] à l'aube. Fin.\n\n[^2]: Vers l'inconnu.",
      "F2.md": "Autre feuillet. Rien ici.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Autre feuillet. Rien ici.",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(modified["F2.md"].includes("Il partit[^2] à l'aube."));
    assert.ok(modified["F2.md"].includes("[^2]: Vers l'inconnu."));
    assert.equal(modified["F1.md"].includes("Il partit"), false);
    // Plus aucun autre appel dans F1 : la définition d'origine est retirée.
    assert.equal((modified["F1.md"].match(/\[\^2\]:/g) || []).length, 0);
  });

  // LOT 6 (docx-review-view.js — traçabilité) : planApplyInterFile remonte
  // désormais { count, renamedCount } — jamais recalculé côté vue, voir
  // computeInterFileMovePlan/resolveFootnoteTransfer.
  await t.test("13bis. LOT 6 — res.footnotes remonte le compteur de notes transférées (sans renommage)", async () => {
    const files2 = {
      "F1.md": "Début. Il partit[^2] à l'aube. Fin.\n\n[^2]: Vers l'inconnu.",
      "F2.md": "Autre feuillet. Rien ici.",
    };
    const vault2 = {
      read: async (f) => files2[f.path],
      modify: async (f, c) => { files2[f.path] = c; },
    };
    const moveChange2 = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Autre feuillet. Rien ici.",
      footnoteRefs: ["1"],
    };
    const res2 = await planApplyInterFile(vault2, { path: "F1.md" }, { path: "F2.md" }, moveChange2);
    assert.equal(res2.ok, true);
    assert.deepEqual(res2.footnotes, { count: 1, renamedCount: 0 });
  });

  await t.test("14. conflit d'identifiant à destination : renumérotation propre", async () => {
    const files = {
      "F1.md": "Début. Il partit[^1] à l'aube. Fin.\n\n[^1]: Vers l'inconnu.",
      // F2 a DÉJÀ une note [^1] — mais avec un contenu DIFFÉRENT : conflit.
      "F2.md": "Texte existant[^1] ici. Autre feuillet.\n\n[^1]: Une note déjà là.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Autre feuillet.",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    // La note déjà présente à destination n'est jamais touchée.
    assert.ok(modified["F2.md"].includes("[^1]: Une note déjà là."));
    // La note transférée porte un NOUVEL identifiant (jamais [^1], déjà pris).
    assert.equal(/Il partit\[\^1\] à l'aube/.test(modified["F2.md"]), false);
    assert.ok(/Il partit\[\^(\d+)\] à l'aube/.test(modified["F2.md"]));
    const newId = modified["F2.md"].match(/Il partit\[\^(\d+)\] à l'aube/)[1];
    assert.notEqual(newId, "1");
    assert.ok(modified["F2.md"].includes(`[^${newId}]: Vers l'inconnu.`));
    // LOT 6 — collision -> renamedCount remonté (jamais recalculé côté vue).
    assert.deepEqual(res.footnotes, { count: 1, renamedCount: 1 });
  });

  await t.test("15. une définition encore utilisée ailleurs dans l'origine n'est jamais supprimée", async () => {
    const files = {
      "F1.md":
        "Début. Il partit[^1] à l'aube. " +
        "Plus loin, un autre rappel[^1] de la même note. Fin.\n\n[^1]: Vers l'inconnu.",
      "F2.md": "Autre feuillet.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "Début. ",
      toContext: "Autre feuillet.",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    // La définition doit rester dans F1 : l'autre appel en a encore besoin.
    assert.ok(modified["F1.md"].includes("[^1]: Vers l'inconnu."));
    assert.ok(modified["F1.md"].includes("un autre rappel[^1] de la même note."));
  });

  await t.test("18. échec ambigu (passage d'origine introuvable de façon sûre) : aucune écriture, ni partielle ni totale", async () => {
    const files = {
      // "Il partit[^1] à l'aube." apparaît DEUX FOIS À L'IDENTIQUE : localisation ambiguë.
      "F1.md": "Il partit[^1] à l'aube. Puis Il partit[^1] à l'aube. encore.",
      "F2.md": "Destination.",
    };
    let modifyCalled = false;
    const vault = {
      read: async (f) => files[f.path],
      modify: async () => { modifyCalled = true; },
    };
    const moveChange = {
      type: "move",
      text: "Il partit[^1] à l'aube.",
      fromText: "Il partit[^1] à l'aube.",
      fromContext: "",
      toContext: "Destination.",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, false);
    assert.equal(modifyCalled, false, "aucune écriture, même partielle, en cas d'échec ambigu");
  });

  await t.test("19. application inter-fichiers : aucune perte ni duplication de texte (avec note)", async () => {
    const files = {
      "F1.md": "Début du feuillet un. Il partit[^1] à l'aube, seul. Fin du feuillet un.\n\n[^1]: Vers l'inconnu.",
      "F2.md": "Début du feuillet deux. Fin du feuillet deux.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Il partit[^1] à l'aube, seul.",
      fromText: "Il partit[^1] à l'aube, seul.",
      fromContext: "Début du feuillet un. ",
      toContext: "Début du feuillet deux. ",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);

    // Le texte déplacé n'apparaît plus dans F1...
    assert.equal(modified["F1.md"].includes("Il partit"), false);
    assert.ok(modified["F1.md"].includes("Début du feuillet un."));
    assert.ok(modified["F1.md"].includes("Fin du feuillet un."));

    // ... et apparaît UNE SEULE FOIS dans F2, au bon endroit.
    const occurrences = (modified["F2.md"].match(/Il partit\[\^\d+\] à l'aube, seul\./g) || []).length;
    assert.equal(occurrences, 1);
    assert.ok(modified["F2.md"].startsWith("Début du feuillet deux. Il partit"));
    assert.ok(modified["F2.md"].includes("Fin du feuillet deux."));

    // La définition existe UNE SEULE FOIS au total, dans F2 (transférée, plus utilisée dans F1).
    const totalDefCount =
      (modified["F1.md"].match(/\[\^\d+\]:/g) || []).length +
      (modified["F2.md"].match(/\[\^\d+\]:/g) || []).length;
    assert.equal(totalDefCount, 1);
  });
});

test("planApplyInterFile — collision de label de note et respect des appels orphelins", async (t) => {
  await t.test("1. label déjà appelé ET défini (contenu différent) → collision évitée, nouveau label attribué", async () => {
    const files = {
      "F1.md": "Début F1. Déplacement[^1] du passage. Fin F1.\n\n[^1]: Note d'origine.",
      "F2.md": "Début F2. Cible[^1] déjà présente. Fin F2.\n\n[^1]: Note différente à destination.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Déplacement[^1] du passage.",
      fromText: "Déplacement[^1] du passage.",
      fromContext: "Début F1. ",
      toContext: "Début F2. ",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(modified["F2.md"].includes("[^1]: Note différente à destination."));
    assert.ok(modified["F2.md"].includes("[^2]: Note d'origine."));
    assert.ok(modified["F2.md"].includes("Déplacement[^2] du passage."));
  });

  await t.test("2. label déjà appelé mais NON défini (appel orphelin) → collision évitée, l'appel orphelin reste intact et la note transférée reçoit un nouveau label", async () => {
    const files = {
      "F1.md": "Début F1. Déplacement[^scene1-2] du passage. Fin F1.\n\n[^scene1-2]: Note de la scène d'origine.",
      "F2.md": "Début F2. Texte cible avec un appel orphelin [^scene1-2] sans définition. Fin F2.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Déplacement[^scene1-2] du passage.",
      fromText: "Déplacement[^scene1-2] du passage.",
      fromContext: "Début F1. ",
      toContext: "Début F2. ",
      footnoteRefs: ["scene1-2"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    // L'appel orphelin préexistant reste inchangé
    assert.ok(modified["F2.md"].includes("orphelin [^scene1-2] sans définition."));
    // La note transférée et sa définition reçoivent le premier label libre (ex: [^1])
    assert.ok(modified["F2.md"].includes("Déplacement[^1] du passage."));
    assert.ok(modified["F2.md"].includes("[^1]: Note de la scène d'origine."));
    assert.equal(modified["F2.md"].includes("[^scene1-2]:"), false);
  });

  await t.test("3. plusieurs labels occupés (définis ou orphelins) → le prochain label réellement libre est sélectionné", async () => {
    const files = {
      "F1.md": "Début F1. Déplacement[^1] du passage. Fin F1.\n\n[^1]: Note transférée.",
      "F2.md": "Début F2. Appel [^1] orphelin. Appel [^2] orphelin. Et [^3] défini. Fin F2.\n\n[^3]: Définition trois.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Déplacement[^1] du passage.",
      fromText: "Déplacement[^1] du passage.",
      fromContext: "Début F1. ",
      toContext: "Début F2. ",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    // 1, 2 et 3 sont occupés à destination => 4 doit être choisi
    assert.ok(modified["F2.md"].includes("Déplacement[^4] du passage."));
    assert.ok(modified["F2.md"].includes("[^4]: Note transférée."));
    assert.equal(modified["F2.md"].includes("[^1]:"), false);
    assert.equal(modified["F2.md"].includes("[^2]:"), false);
  });

  await t.test("4. aucun conflit → comportement existant inchangé (réutilisation du label d'origine)", async () => {
    const files = {
      "F1.md": "Début F1. Passage[^note1] à déplacer. Fin F1.\n\n[^note1]: Contenu note.",
      "F2.md": "Début F2. Feuillet cible sans notes. Fin F2.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "Passage[^note1] à déplacer.",
      fromText: "Passage[^note1] à déplacer.",
      fromContext: "Début F1. ",
      toContext: "Début F2. ",
      footnoteRefs: ["note1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(modified["F2.md"].includes("Passage[^note1] à déplacer."));
    assert.ok(modified["F2.md"].includes("[^note1]: Contenu note."));
  });
});

/* =========================================================================
 * Les corrections faites DANS une note (word/footnotes.xml) restent gérées
 * par le système existant (parseFootnotesXml/parseDocxReview), totalement
 * indépendant du déplacement du passage qui APPELLE cette note — ce
 * chantier ne les mélange jamais.
 * ========================================================================= */

test("17. une correction dans footnotes.xml reste reconnue séparément d'un déplacement de l'appel", () => {
  const path = "Feuillet1.md";
  const id = bookmarkIdFor(path);
  const documentXml = wrapBody(
    `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
      '<w:r><w:t>Texte. </w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>' +
      "</w:p>"
  );
  const footnotesXml =
    '<w:footnotes><w:footnote w:id="1"><w:p>' +
    '<w:ins w:author="Dir" w:date="D"><w:r><w:t>note corrigée</w:t></w:r></w:ins>' +
    "</w:p></w:footnote></w:footnotes>";

  const result = parseDocxReview({
    "word/document.xml": documentXml,
    "word/footnotes.xml": footnotesXml,
  });

  const { byPath } = resolveScenesToPaths(result.scenes, [path]);
  const inFootnoteChanges = byPath[path].changes.filter((c) => c.inFootnote);
  assert.equal(inFootnoteChanges.length, 1);
  assert.equal(inFootnoteChanges[0].text, "note corrigée");
  assert.equal(inFootnoteChanges[0].type, "insertion");
  // Ce retour n'est ni une suppression ni une insertion candidate pour
  // mergeImplicitCutPastePairs (aucun w:del correspondant, aucune fusion
  // possible) : reste un retour de correction de note à part entière.
  const before = byPath[path].changes.map((c) => ({ type: c.type, text: c.text, inFootnote: !!c.inFootnote }));
  mergeImplicitCutPastePairs(byPath, {}, { changes: [], comments: [] });
  const after = byPath[path].changes.map((c) => ({ type: c.type, text: c.text, inFootnote: !!c.inFootnote }));
  assert.deepEqual(after, before);
});

/* =========================================================================
 * Lot 1 — respect des limites de paragraphes Word à l'application d'un
 * déplacement (même feuillet ou inter-fichiers). destinationBoundary est
 * calculé une fois à la fusion (mergeMovePairs/mergeGlobalMovePairs/
 * mergeImplicitCutPastePairs) à partir de toContext (corrigé, voir
 * currentContextBefore) et de followedByParagraphBreak (voir
 * pendingAfterCapture) — jamais deviné à l'application.
 * ========================================================================= */

test("destinationBoundary — classement du point d'insertion", async (t) => {
  await t.test("1. collage en ligne dans un paragraphe (inline)", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        '<w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>ORIGINE</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/>' +
        "<w:r><w:t>Début de phrase, </w:t></w:r>" +
        '<w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>ORIGINE</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/>' +
        "<w:r><w:t> milieu de phrase.</w:t></w:r>" +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes.length, 1);
    assert.equal(scenes[id].changes[0].type, "move");
    assert.equal(scenes[id].changes[0].destinationBoundary, "inline");
  });

  await t.test("2. collage au début d'un paragraphe (paragraph-start)", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        '<w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>ORIGINE</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/>' +
        "<w:r><w:t>Premier paragraphe.</w:t></w:r></w:p>" +
        "<w:p>" +
        '<w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>ORIGINE</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/>' +
        "<w:r><w:t> reste du second paragraphe.</w:t></w:r></w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes[0].destinationBoundary, "paragraph-start");
  });

  await t.test("3. collage à la fin d'un paragraphe (paragraph-end)", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        '<w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>ORIGINE</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/>' +
        "<w:r><w:t>Début du paragraphe, </w:t></w:r>" +
        '<w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>ORIGINE</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/>' +
        "</w:p><w:p><w:r><w:t>Paragraphe suivant.</w:t></w:r></w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes[0].destinationBoundary, "paragraph-end");
  });

  await t.test("4. collage entre deux paragraphes (between-paragraphs)", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        '<w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>ORIGINE</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/>' +
        "<w:r><w:t>Premier paragraphe.</w:t></w:r></w:p>" +
        '<w:p><w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>ORIGINE</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/></w:p>' +
        "<w:p><w:r><w:t>Troisième paragraphe.</w:t></w:r></w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes[0].destinationBoundary, "between-paragraphs");
  });

  await t.test("5. collage comme paragraphe autonome (standalone-paragraph)", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    // Destination = tout premier contenu de la scène (rien avant, toContext
    // === "") ET rien d'autre ne suit dans son propre paragraphe (un
    // nouveau <w:p> s'ouvre juste après) : ni un "début" ni une "fin" de
    // paragraphe existant, un paragraphe entièrement à lui.
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/>` +
        '<w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>Passage isolé.</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/>' +
        "</w:p>" +
        "<w:p>" +
        '<w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>Passage isolé.</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes.length, 1);
    assert.equal(scenes[id].changes[0].destinationBoundary, "standalone-paragraph");
  });

  await t.test("6. déplacement de plusieurs paragraphes : fragments réunis en un seul move avec le \\n\\n interne préservé", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    // Word fragmente un déplacement multi-paragraphe en plusieurs
    // <w:moveFrom>/<w:moveTo> consécutifs, tous porteurs du MÊME w:name
    // (une limite de w:p ne peut jamais être traversée par un seul
    // w:moveFrom/w:moveTo) — voir collapseSameTypeFragments.
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/><w:r><w:t>Avant.</w:t></w:r></w:p>` +
        '<w:p><w:moveFromRangeStart w:id="10" w:name="moveMulti"/>' +
        '<w:moveFrom w:id="11" w:author="A" w:date="D"><w:r><w:t>Paragraphe un déplacé.</w:t></w:r></w:moveFrom>' +
        "</w:p>" +
        '<w:p><w:moveFrom w:id="12" w:author="A" w:date="D"><w:r><w:t>Paragraphe deux déplacé.</w:t></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="10"/></w:p>' +
        '<w:p><w:r><w:t>Milieu.</w:t></w:r></w:p>' +
        '<w:p><w:moveToRangeStart w:id="20" w:name="moveMulti"/>' +
        '<w:moveTo w:id="21" w:author="A" w:date="D"><w:r><w:t>Paragraphe un déplacé.</w:t></w:r></w:moveTo>' +
        "</w:p>" +
        '<w:p><w:moveTo w:id="22" w:author="A" w:date="D"><w:r><w:t>Paragraphe deux déplacé.</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="20"/></w:p>'
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes.length, 1, "un seul retour 'move', pas un fragment par paragraphe");
    const move = scenes[id].changes[0];
    assert.equal(move.type, "move");
    // Jamais de "\n\n" fantôme en tête (voir "les deux moitiés reliées par
    // le même w:name..." — même convention) : le saut de paragraphe entre
    // "Avant." et le premier fragment se lit dans toContext/destinationBoundary,
    // pas dans .text. Le \n\n INTERNE, entre les deux paragraphes déplacés,
    // est ce que ce test vérifie réellement : préservé par la concaténation
    // EXPLICITE en ordre de collapseSameTypeFragments (Word ne peut jamais
    // faire traverser un <w:p> à un seul w:moveFrom/w:moveTo — deux
    // fragments consécutifs sont donc TOUJOURS séparés par un <w:p> réel).
    assert.equal(move.text, "Paragraphe un déplacé.\n\nParagraphe deux déplacé.");
    assert.equal(move.fromText, "Paragraphe un déplacé.\n\nParagraphe deux déplacé.");
    assert.equal(move.destinationBoundary, "between-paragraphs");
  });
});

test("planApply/planApplyMove — le passage ne colle jamais au paragraphe précédent (Lot 1)", async (t) => {
  await t.test("11. un collage dans un nouveau paragraphe Word reste sur SON PROPRE paragraphe, jamais à la suite du précédent", () => {
    const content = "Premier paragraphe complet, assez long pour servir de contexte réel.\n\nDeuxième paragraphe, cible du collage.";
    const change = {
      type: "move",
      text: "Passage déplacé",
      fromText: "Passage déplacé",
      fromContext: "",
      toContext: "réel.\n\n",
      toContextAfter: "Deuxième",
      // toContext se termine par "\n\n" (avant=vrai) MAIS toContextAfter
      // n'est pas vide (après=faux, du texte suit tout de suite, pas de
      // nouveau saut) : c'est exactement "paragraph-start" (voir
      // computeDestinationBoundary) — le passage déplacé DEVIENT le début
      // du paragraphe qui suit, jamais son propre paragraphe autonome.
      destinationBoundary: "paragraph-start",
    };
    const result = planApply(content + " Passage déplacé ailleurs à couper.", {
      ...change,
      fromContext: "couper.",
    });
    // Reconstruit un scénario réaliste : le texte source contient déjà le
    // passage à déplacer ET la cible ; vérifie qu'après application, le
    // passage apparaît en DÉBUT du second paragraphe, jamais accolé à la
    // fin du premier (pas de "réel.Passage déplacé").
    assert.equal(result.ok, true);
    assert.equal(result.newContent.includes("réel.Passage déplacé"), false);
    assert.ok(result.newContent.includes("réel.\n\nPassage déplacéDeuxième"));
  });

  await t.test("12. aucun triple saut de ligne n'est jamais produit", () => {
    const content = "Paragraphe A.\n\nParagraphe B.";
    const change = {
      type: "move",
      text: "Inséré",
      fromText: "Inséré",
      fromContext: "",
      toContext: "Paragraphe A.\n\n",
    };
    const result = planApply(content + " Inséré à couper.", { ...change, fromContext: "à couper." });
    assert.equal(result.ok, true);
    assert.equal(/\n{3,}/.test(result.newContent), false);
  });

  await t.test("7. déplacement avec note de bas de page dans un nouveau paragraphe", () => {
    const path = "F.md";
    const id = bookmarkIdFor(path);
    const xml = wrapBody(
      `<w:p><w:bookmarkStart w:id="1" w:name="${id}"/><w:r><w:t>Avant.</w:t></w:r></w:p>` +
        '<w:p><w:moveFromRangeStart w:id="8" w:name="moveX"/>' +
        '<w:moveFrom w:id="2" w:author="A" w:date="D"><w:r><w:delText>Il partit</w:delText></w:r>' +
        '<w:r><w:footnoteReference w:id="1"/></w:r>' +
        '<w:r><w:delText> à l\'aube.</w:delText></w:r></w:moveFrom>' +
        '<w:moveFromRangeEnd w:id="8"/></w:p>' +
        '<w:p><w:r><w:t>Milieu.</w:t></w:r></w:p>' +
        '<w:p><w:moveToRangeStart w:id="9" w:name="moveX"/>' +
        '<w:moveTo w:id="3" w:author="A" w:date="D"><w:r><w:t>Il partit</w:t></w:r>' +
        '<w:r><w:footnoteReference w:id="1"/></w:r>' +
        '<w:r><w:t> à l\'aube.</w:t></w:r></w:moveTo>' +
        '<w:moveToRangeEnd w:id="9"/></w:p>'
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes[id].changes.length, 1);
    const move = scenes[id].changes[0];
    assert.equal(move.type, "move");
    assert.equal(move.destinationBoundary, "between-paragraphs");
    assert.equal(move.text, "Il partit[^1] à l'aube.");
    assert.deepEqual(move.footnoteRefs, ["1"]);
  });

  await t.test("8. déplacement avec liste Markdown", () => {
    const content = "Avant.\n\nRéférence.";
    const listText = "- item un\n- item deux";
    const change = {
      type: "move",
      text: listText,
      fromText: listText,
      fromContext: "",
      toContext: "Référence.",
    };
    const result = planApply(`${content} ${listText} à couper.`, { ...change, fromContext: "à couper." });
    assert.equal(result.ok, true);
    assert.ok(result.newContent.includes("Référence.- item un\n- item deux"));
  });

  await t.test("9. déplacement avec citation", () => {
    const content = "Avant.\n\nRéférence.";
    const quote = "> Une citation entière.";
    const change = {
      type: "move",
      text: quote,
      fromText: quote,
      fromContext: "",
      toContext: "Référence.",
    };
    const result = planApply(`${content} ${quote} à couper.`, { ...change, fromContext: "à couper." });
    assert.equal(result.ok, true);
    assert.ok(result.newContent.includes("Référence.> Une citation entière."));
  });

  await t.test("10. déplacement proche du frontmatter : le frontmatter reste intact", () => {
    const content = "---\ntitle: Essai\n---\nCorps du feuillet. Cible.";
    const change = {
      type: "move",
      text: "Passage",
      fromText: "Passage",
      fromContext: "",
      toContext: "Cible.",
    };
    const result = planApply(`${content} Passage à couper.`, { ...change, fromContext: "à couper." });
    assert.equal(result.ok, true);
    assert.ok(result.newContent.startsWith("---\ntitle: Essai\n---\n"));
  });
});

/* =========================================================================
 * insertedRange — la plage EXACTE du texte collé (voir ApplyResult), posée
 * pour que docx-review-view.js#revealRangeInFile sélectionne le passage
 * directement après écriture, sans refaire une recherche textuelle
 * approximative sur un Markdown qui peut différer légèrement du texte porté
 * par la carte (voir notice "n'a pas pu être retrouvé").
 * ========================================================================= */
test("insertedRange — plage exacte du texte collé après un déplacement", async (t) => {
  await t.test("planApplyMove (même feuillet) : range pointe pile sur le passage collé, rien d'autre", () => {
    const content = "Premier paragraphe complet, assez long pour servir de contexte réel.\n\nDeuxième paragraphe, cible du collage.";
    const change = {
      type: "move",
      text: "Passage déplacé",
      fromText: "Passage déplacé",
      fromContext: "couper.",
      toContext: "réel.\n\n",
    };
    const result = planApply(content + " Passage déplacé ailleurs à couper.", change);
    assert.equal(result.ok, true);
    assert.ok(result.insertedRange, "insertedRange doit être posé");
    const { start, end } = result.insertedRange;
    assert.equal(result.newContent.slice(start, end), "Passage déplacé");
  });

  await t.test("planApplyMove : passage MULTI-PARAGRAPHE — range couvre tout, y compris le \\n\\n interne", () => {
    const content = "Avant.\n\nCible du collage.";
    const moved = "Premier paragraphe déplacé.\n\nSecond paragraphe déplacé.";
    const change = {
      type: "move",
      text: moved,
      fromText: moved,
      fromContext: "à couper.",
      toContext: "Cible du collage.",
    };
    const result = planApply(`${content} ${moved} à couper.`, change);
    assert.equal(result.ok, true);
    const { start, end } = result.insertedRange;
    assert.equal(result.newContent.slice(start, end), moved);
  });

  await t.test("planApplyMove : repli sans fromText localisable — range couvre change.text au bon endroit", () => {
    // fromText déjà coupé par un edit préalable (change.text sans note) :
    // planApplyMove insère directement change.text à insertAt.
    const content = "Avant.\n\nCible.";
    const change = {
      type: "move",
      text: "Texte réinséré",
      fromText: "Introuvable nulle part",
      fromContext: "",
      toContext: "Cible.",
    };
    const result = planApply(content, change);
    assert.equal(result.ok, true);
    const { start, end } = result.insertedRange;
    assert.equal(result.newContent.slice(start, end), "Texte réinséré");
  });

  await t.test("planApply(type: insertion) : range pointe sur le texte inséré", () => {
    const content = "Le vent soufflait fort ce soir-là.";
    const result = planApply(content, { type: "insertion", contextBefore: "soufflait fort", text: " vraiment" });
    assert.equal(result.ok, true);
    const { start, end } = result.insertedRange;
    assert.equal(result.newContent.slice(start, end), " vraiment");
  });

  await t.test("planApplyInterFile : insertedRange porte les offsets dans le fichier de DESTINATION écrit", async () => {
    const stores = {
      "F1.md": "Avant.\n\nÀ couper.",
      "F2.md": "Cible du collage.",
    };
    const vault = {
      read: async (f) => stores[f.path],
      modify: async (f, c) => { stores[f.path] = c; },
    };
    const moveChange = {
      type: "move",
      text: "À couper.",
      fromText: "À couper.",
      fromContext: "",
      toContext: "Cible du collage.",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(res.insertedRange, "insertedRange doit être posé pour un déplacement inter-feuillets");
    const { start, end } = res.insertedRange;
    assert.equal(stores["F2.md"].slice(start, end), "À couper.");
  });
});

/* =========================================================================
 * Lot 5 — fusion des runs adjacents d'une seule opération de mise en forme
 * (w:rPrChange) en une seule carte.
 * ========================================================================= */

test("Lot 5 — fusion des cartes de mise en forme adjacentes", async (t) => {
  const rPrChange = (marker) =>
    `<w:rPr>${marker}<w:rPrChange w:author="Dir" w:date="D"><w:rPr/></w:rPrChange></w:rPr>`;
  const run = (marker, text) => `<w:r>${rPrChange(marker)}<w:t>${text}</w:t></w:r>`;

  await t.test("24. un paragraphe barré découpé en plusieurs runs -> une seule carte", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:strike/>", "Tout ce paragraphe ") +
        run("<w:strike/>", "est barré.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 1);
    assert.equal(scenes.S.comments[0].anchorText, "Tout ce paragraphe est barré.");
    assert.deepEqual(scenes.S.comments[0].markers, ["w:strike"]);
  });

  await t.test("25. un passage surligné découpé en plusieurs runs -> une seule carte", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:highlight/>", "Passage ") +
        run("<w:highlight/>", "entièrement ") +
        run("<w:highlight/>", "surligné.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 1);
    assert.equal(scenes.S.comments[0].anchorText, "Passage entièrement surligné.");
  });

  await t.test("26. deux segments séparés par du texte normal -> deux cartes distinctes", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:strike/>", "Premier segment.") +
        "<w:r><w:t> Texte normal, non concerné. </w:t></w:r>" +
        run("<w:strike/>", "Second segment.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 2);
    assert.equal(scenes.S.comments[0].anchorText, "Premier segment.");
    assert.equal(scenes.S.comments[1].anchorText, "Second segment.");
  });

  await t.test("27. deux paragraphes différents -> deux cartes distinctes, jamais fusionnées à travers un saut de paragraphe", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:strike/>", "Paragraphe un barré.") +
        "</w:p>" +
        '<w:p>' +
        run("<w:strike/>", "Paragraphe deux barré.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 2);
  });

  await t.test("28. auteurs différents -> deux cartes distinctes", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        '<w:r><w:rPr><w:strike/><w:rPrChange w:author="Alice" w:date="D"><w:rPr/></w:rPrChange></w:rPr><w:t>Un.</w:t></w:r>' +
        '<w:r><w:rPr><w:strike/><w:rPrChange w:author="Bob" w:date="D"><w:rPr/></w:rPrChange></w:rPr><w:t>Deux.</w:t></w:r>' +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 2);
    assert.equal(scenes.S.comments[0].author, "Alice");
    assert.equal(scenes.S.comments[1].author, "Bob");
  });

  await t.test("29. marqueurs différents -> deux cartes distinctes", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:strike/>", "Barré.") +
        run("<w:u/>", "Souligné.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 2);
    assert.deepEqual(scenes.S.comments[0].markers, ["w:strike"]);
    assert.deepEqual(scenes.S.comments[1].markers, ["w:u"]);
  });

  await t.test("30. combinaison identique de marqueurs (gras + barré) -> fusion correcte", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="S"/>' +
        run("<w:strike/><w:b/>", "Gras et barré, ") +
        run("<w:strike/><w:b/>", "sur deux runs.") +
        "</w:p>"
    );
    const { scenes } = parseDocumentXml(xml, {});
    assert.equal(scenes.S.comments.length, 1);
    assert.equal(scenes.S.comments[0].anchorText, "Gras et barré, sur deux runs.");
    assert.deepEqual(scenes.S.comments[0].markers.sort(), ["w:b", "w:strike"]);
  });
});

test("TESTS RÉELS — Manuscrit(1).docx (fixture OOXML réelle, deux w:moveFrom/w:moveTo natifs de Word)", async (t) => {
  // Fragment EXTRAIT TEL QUEL de word/document.xml d'un vrai .docx corrigé
  // dans Word (couper-coller natif, suivi des modifications actif) — voir
  // Manuscrit.docx dans le dossier de travail. Contient DEUX déplacements
  // réels :
  //  1. "Deux hommes habillés de bleu..." — origine EN LIGNE dans un
  //     paragraphe existant, destination dans un paragraphe NEUF (le
  //     marqueur de paragraphe lui-même porte w:moveTo en pPr/rPr).
  //  2. "— Oh ! très-volontiers..." — un paragraphe ENTIER déplacé (marqueur
  //     de paragraphe portant w:moveFrom à l'origine, w:moveTo à la
  //     destination), inséré en scindant un paragraphe qui, dans le
  //     Markdown source, ne formait qu'UN SEUL paragraphe avec ce qui suit.
  //
  // Toutes les chaînes de comparaison ci-dessous sont dérivées
  // PROGRAMMATIQUEMENT du docx/Markdown réels (JSON.stringify d'un extrait
  // exact) — jamais retapées à la main : le texte français porte de vraies
  // espaces insécables/fines (ex. avant " : ", U+202F) qu'une retranscription
  // manuelle introduit ou perd silencieusement, ce qui a déjà produit un faux
  // échec de test lors de la rédaction de cette fixture.
  const realFragment = "<w:p w14:paraId=\"5B808C65\" w14:textId=\"7559A5CF\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>Candide, chassé du paradis</w:t></w:r><w:del w:id=\"1\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:15:00Z\" w16du:dateUtc=\"2026-08-06T20:15:00Z\"><w:r w:rsidDel=\"0074679E\"><w:delText xml:space=\"preserve\"> terrestre</w:delText></w:r></w:del><w:r><w:t>, marcha longtemps sans savoir où, pleurant, levant les yeux au ciel, les tournant souvent vers le plus beau des châteaux qui renfermait la plus belle des baronnettes ; il se coucha sans souper au milieu des champs entre deux sillons ; la neige tombait à gros flocons. Candide, tout transi, se traîna le lendemain vers la ville voisine, qui s’appelle Valdberghoff-trarbk-</w:t></w:r><w:proofErr w:type=\"spellStart\"/><w:r><w:t>dikdorff</w:t></w:r><w:proofErr w:type=\"spellEnd\"/><w:r><w:t xml:space=\"preserve\">, n’ayant point d’argent, mourant de faim et de lassitude. Il s’arrêta tristement à la porte d’un cabaret. </w:t></w:r><w:moveFromRangeStart w:id=\"2\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w:name=\"move236947001\"/><w:moveFrom w:id=\"3\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"><w:r w:rsidDel=\"0074679E\"><w:t>Deux hommes habillés de bleu</w:t></w:r><w:r w:rsidDel=\"0074679E\"><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"1\"/></w:r><w:r w:rsidDel=\"0074679E\"><w:t xml:space=\"preserve\"> le remarquèrent : « Camarade, dit l’un, voilà un jeune homme très-bien fait, et qui a la taille requise ; ils s’avancèrent vers Candide, et le prièrent à dîner très-civilement.</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id=\"2\"/></w:p><w:p w14:paraId=\"6D96E9C3\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:ins w:id=\"6\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"/></w:rPr></w:pPr><w:r><w:t>— Messieurs, leur dit Candide avec une modestie charmante, vous me faites beaucoup d’honneur, mais je n’ai pas de quoi payer mon écot.</w:t></w:r></w:p><w:p w14:paraId=\"2461EF1E\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidDel=\"0074679E\" w:rsidRDefault=\"0074679E\" w:rsidP=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:del w:id=\"7\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"/><w:moveTo w:id=\"8\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"/></w:rPr></w:pPr><w:moveToRangeStart w:id=\"9\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w:name=\"move236947001\"/><w:moveTo w:id=\"10\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"><w:r><w:t>Deux hommes habillés de bleu</w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"2\"/></w:r><w:r><w:t xml:space=\"preserve\"> le remarquèrent : « Camarade, dit l’un, voilà un jeune homme très-bien fait, et qui a la taille requise ; ils s’avancèrent vers Candide, et le prièrent à dîner très-civilement.</w:t></w:r></w:moveTo></w:p><w:moveToRangeEnd w:id=\"9\"/><w:p w14:paraId=\"57A48F15\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"0074679E\" w:rsidP=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:ins w:id=\"13\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"/></w:rPr></w:pPr></w:p><w:p w14:paraId=\"2208B9FB\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr></w:p><w:p w14:paraId=\"5192CD55\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Ah ! monsieur, lui dit un des bleus, les personnes de votre figure et de votre mérite ne paient jamais rien : n’avez-vous pas cinq pieds cinq pouces de haut ?</w:t></w:r></w:p><w:p w14:paraId=\"07DC1A83\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRPr=\"0074679E\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:strike/><w:rPrChange w:id=\"14\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"><w:rPr/></w:rPrChange></w:rPr></w:pPr><w:r w:rsidRPr=\"0074679E\"><w:rPr><w:strike/><w:rPrChange w:id=\"15\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:16:00Z\" w16du:dateUtc=\"2026-08-06T20:16:00Z\"><w:rPr/></w:rPrChange></w:rPr><w:t>— Oui, messieurs, c’est ma taille, dit-il en faisant la révérence.</w:t></w:r></w:p><w:p w14:paraId=\"21F1C4E5\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Ah ! monsieur, mettez-vous à table ; non-seulement nous vous défrayerons, mais nous ne souffrirons jamais qu’un homme comme vous manque d’argent ; les hommes ne sont faits que pour se secourir les uns les autres.</w:t></w:r></w:p><w:p w14:paraId=\"531B4C99\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:lastRenderedPageBreak/><w:t xml:space=\"preserve\">— Vous avez raison, dit Candide ; c’est ce que M. Pangloss m’a toujours dit, et je vois bien que tout est au mieux. » On le </w:t></w:r><w:proofErr w:type=\"spellStart\"/><w:r><w:t>prie</w:t></w:r><w:proofErr w:type=\"spellEnd\"/><w:r><w:t xml:space=\"preserve\"> d’accepter quelques écus, il les prend et veut faire son billet ; on n’en veut point, on se met à table. « N’aimez-vous pas tendrement</w:t></w:r><w:proofErr w:type=\"gramStart\"/><w:r><w:t> ?…</w:t></w:r><w:proofErr w:type=\"gramEnd\"/></w:p><w:p w14:paraId=\"59566764\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Oh ! oui, répond-il, j’aime tendrement Mlle Cunégonde.</w:t></w:r></w:p><w:p w14:paraId=\"62C9510D\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Non, dit l’un de ces messieurs, nous vous demandons si vous n’aimez pas tendrement le roi des Bulgares ?</w:t></w:r></w:p><w:p w14:paraId=\"603744E0\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Point du tout, dit-il, car je ne l’ai jamais vu.</w:t></w:r></w:p><w:p w14:paraId=\"435A2775\" w14:textId=\"77777777\" w:rsidR=\"00A86AED\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/></w:pPr><w:r><w:t>— Comment ! c’est le plus charmant des rois, et il faut boire à sa santé.</w:t></w:r></w:p><w:p w14:paraId=\"74A8846C\" w14:textId=\"683D56B9\" w:rsidR=\"00A86AED\" w:rsidDel=\"0074679E\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:moveFrom w:id=\"16\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"/></w:rPr></w:pPr><w:moveFromRangeStart w:id=\"17\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w:name=\"move236947038\"/><w:moveFrom w:id=\"18\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"><w:r w:rsidDel=\"0074679E\"><w:t>— Oh ! très-volontiers, messieurs. » Et il boit. « C’en est assez, lui dit-on, vous voilà l’appui, le soutien, le défenseur, le héros des Bulgares</w:t></w:r><w:r w:rsidDel=\"0074679E\"><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"3\"/></w:r><w:r w:rsidDel=\"0074679E\"><w:t> ; votre fortune est faite, et votre gloire est assurée. On lui met sur-le-champ les fers aux pieds, et on le mène au régiment. On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette, coucher en joue, tirer, doubler le pas, et on lui donne trente coups de bâton</w:t></w:r><w:r w:rsidDel=\"0074679E\"><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"4\"/></w:r><w:r w:rsidDel=\"0074679E\"><w:t> ; le lendemain, il fait l’exercice un peu moins mal, et il ne reçoit que vingt coups ; le surlendemain, on ne lui en donne que dix, et il est regardé par ses camarades comme un prodige.</w:t></w:r></w:moveFrom></w:p><w:moveFromRangeEnd w:id=\"17\"/><w:p w14:paraId=\"5A14B9D9\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:ins w:id=\"23\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"/></w:rPr></w:pPr><w:r><w:t xml:space=\"preserve\">Candide, tout stupéfait, ne démêlait pas encore trop bien comment il était un héros. Il s’avisa un beau jour de printemps de s’aller promener, marchant tout droit devant lui, croyant que c’était un privilège de l’espèce humaine, comme de l’espèce animale, de se servir de ses jambes à son plaisir. Il n’eut pas fait deux lieues que voilà quatre autres héros de six pieds qui l’atteignent, qui le lient, qui le mènent dans un cachot. On lui demanda juridiquement ce qu’il aimait le mieux d’être fustigé trente-six fois par tout le régiment, ou de recevoir à la fois douze balles de plomb dans la cervelle. </w:t></w:r></w:p><w:p w14:paraId=\"43E80B96\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"0074679E\" w:rsidP=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:moveTo w:id=\"24\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"/></w:rPr></w:pPr><w:moveToRangeStart w:id=\"25\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w:name=\"move236947038\"/><w:moveTo w:id=\"26\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"><w:r><w:t>— Oh ! très-volontiers, messieurs. » Et il boit. « C’en est assez, lui dit-on, vous voilà l’appui, le soutien, le défenseur, le héros des Bulgares</w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"5\"/></w:r><w:r><w:t> ; votre fortune est faite, et votre gloire est assurée. On lui met sur-le-champ les fers aux pieds, et on le mène au régiment. On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette, coucher en joue, tirer, doubler le pas, et on lui donne trente coups de bâton</w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"6\"/></w:r><w:r><w:t xml:space=\"preserve\"> ; le lendemain, il fait l’exercice un peu moins </w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>mal, et il ne reçoit que vingt coups ; le surlendemain, on ne lui en donne que dix, et il est regardé par ses camarades comme un prodige.</w:t></w:r></w:moveTo></w:p><w:moveToRangeEnd w:id=\"25\"/><w:p w14:paraId=\"792FC8DB\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:ins w:id=\"31\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"/></w:rPr></w:pPr></w:p><w:p w14:paraId=\"6B5792B9\" w14:textId=\"77777777\" w:rsidR=\"0074679E\" w:rsidRDefault=\"0074679E\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:ins w:id=\"32\" w:author=\"halim yalcin\" w:date=\"2026-08-06T22:17:00Z\" w16du:dateUtc=\"2026-08-06T20:17:00Z\"/></w:rPr></w:pPr></w:p>";
  const xml = `<w:document><w:body><w:p><w:bookmarkStart w:id="0" w:name="fsReal"/></w:p>${realFragment}<w:bookmarkEnd w:id="0"/></w:body></w:document>`;

  await t.test("les deux déplacements réels deviennent deux retours 'move', avec la structure OOXML exacte (jamais un \\n\\n baké dans .text/.fromText)", () => {
    const { scenes } = parseDocumentXml(xml);
    const moves = scenes.fsReal.changes.filter((c) => c.type === "move");
    assert.equal(moves.length, 2, "les deux w:moveFrom/w:moveTo natifs, chacun avec son propre w:name, fusionnent chacun en un seul move");

    const [m1, m2] = moves;
    assert.ok(m1.text.startsWith("Deux hommes habillés de bleu[^2]"));
    assert.ok(m1.text.endsWith("très-civilement."));
    assert.ok(m1.fromText.startsWith("Deux hommes habillés de bleu[^1]"));
    assert.ok(m1.fromText.endsWith("très-civilement."));
    assert.equal(m1.text.length, m1.fromText.length, "même passage, seul l'id de note interne Word diffère (1 -> 2)");
    assert.equal(m1.destinationBoundary, "between-paragraphs");
    assert.deepEqual(m1.footnoteRefs, ["2"]);

    assert.equal(m2.destinationBoundary, "between-paragraphs");
    assert.ok(m2.text.startsWith("— Oh"));
    assert.ok(m2.text.includes("volontiers"));
    assert.ok(m2.text.endsWith("comme un prodige."));
    assert.deepEqual(m2.footnoteRefs, ["5", "6"]);
    // IDs Word internes DIFFÉRENTS entre origine (moveFrom, [^3]/[^4]) et
    // destination (moveTo, [^5]/[^6]) pour la MÊME note logique — jamais
    // une supposition d'égalité (voir "Constat réel" / mission).
    assert.ok(m2.fromText.includes("[^3]"));
    assert.ok(m2.fromText.includes("[^4]"));
    assert.ok(m2.text.includes("[^5]"));
    assert.ok(m2.text.includes("[^6]"));
  });

  await t.test("le paragraphe barré du DOCX réel (w:rPrChange sur le marqueur DE PARAGRAPHE + sur le run) ne produit qu'UNE seule carte de mise en forme", () => {
    const { scenes } = parseDocumentXml(xml);
    const strikeComments = scenes.fsReal.comments.filter((c) => c.isFormatting && c.markers.includes("w:strike"));
    assert.equal(strikeComments.length, 1, "jamais deux cartes pour un seul paragraphe visuellement barré une fois dans Word");
    assert.ok(strikeComments[0].anchorText.startsWith("— Oui, messieurs"));
    assert.ok(strikeComments[0].anchorText.endsWith("la révérence."));
  });

  await t.test("réappliqués au Markdown source réel, les deux déplacements produisent EXACTEMENT la structure corrigée par Word — jamais de paragraphes collés", () => {
    const md = "Candide, chassé du paradis terrestre, marcha longtemps sans savoir où, pleurant, levant les yeux au ciel, les tournant souvent vers le plus beau des châteaux qui renfermait la plus belle des baronnettes ; il se coucha sans souper au milieu des champs entre deux sillons ; la neige tombait à gros flocons. Candide, tout transi, se traîna le lendemain vers la ville voisine, qui s’appelle Valdberghoff-trarbk-dikdorff, n’ayant point d’argent, mourant de faim et de lassitude. Il s’arrêta tristement à la porte d’un cabaret. Deux hommes habillés de bleu[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-1] le remarquèrent : « Camarade, dit l’un, voilà un jeune homme très-bien fait, et qui a la taille requise ; ils s’avancèrent vers Candide, et le prièrent à dîner très-civilement.\n\n— Messieurs, leur dit Candide avec une modestie charmante, vous me faites beaucoup d’honneur, mais je n’ai pas de quoi payer mon écot.\n\n— Ah ! monsieur, lui dit un des bleus, les personnes de votre figure et de votre mérite ne paient jamais rien : n’avez-vous pas cinq pieds cinq pouces de haut ?\n\n— Oui, messieurs, c’est ma taille, dit-il en faisant la révérence.\n\n— Ah ! monsieur, mettez-vous à table ; non-seulement nous vous défrayerons, mais nous ne souffrirons jamais qu’un homme comme vous manque d’argent ; les hommes ne sont faits que pour se secourir les uns les autres.\n\n— Vous avez raison, dit Candide ; c’est ce que M. Pangloss m’a toujours dit, et je vois bien que tout est au mieux. » On le prie d’accepter quelques écus, il les prend et veut faire son billet ; on n’en veut point, on se met à table. « N’aimez-vous pas tendrement ?…\n\n— Oh ! oui, répond-il, j’aime tendrement Mlle Cunégonde.\n\n— Non, dit l’un de ces messieurs, nous vous demandons si vous n’aimez pas tendrement le roi des Bulgares ?\n\n— Point du tout, dit-il, car je ne l’ai jamais vu.\n\n— Comment ! c’est le plus charmant des rois, et il faut boire à sa santé.\n\n— Oh ! très-volontiers, messieurs. » Et il boit. « C’en est assez, lui dit-on, vous voilà l’appui, le soutien, le défenseur, le héros des Bulgares[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-2] ; votre fortune est faite, et votre gloire est assurée. On lui met sur-le-champ les fers aux pieds, et on le mène au régiment. On le fait tourner à droite, à gauche, hausser la baguette, remettre la baguette, coucher en joue, tirer, doubler le pas, et on lui donne trente coups de bâton[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-3] ; le lendemain, il fait l’exercice un peu moins mal, et il ne reçoit que vingt coups ; le surlendemain, on ne lui en donne que dix, et il est regardé par ses camarades comme un prodige.\n\nCandide, tout stupéfait, ne démêlait pas encore trop bien comment il était un héros. Il s’avisa un beau jour de printemps de s’aller promener, marchant tout droit devant lui, croyant que c’était un privilège de l’espèce humaine, comme de l’espèce animale, de se servir de ses jambes à son plaisir. Il n’eut pas fait deux lieues que voilà quatre autres héros de six pieds qui l’atteignent, qui le lient, qui le mènent dans un cachot. On lui demanda juridiquement ce qu’il aimait le mieux d’être fustigé trente-six fois par tout le régiment, ou de recevoir à la fois douze balles de plomb dans la cervelle. Il eut beau dire que les volontés sont libres, et qu’il ne voulait ni l’un ni l’autre, il fallut faire un choix : il se détermina, en vertu du don de Dieu qu’on nomme liberté, à passer trente-six fois par les baguettes ; il essuya deux promenades. Le régiment était composé de deux mille hommes ; cela lui composa quatre mille coups de baguette, qui, depuis la nuque du cou jusqu’au cul, lui découvrirent les muscles et les nerfs. Comme on allait procéder à la troisième course, Candide, n’en pouvant plus, demanda en grâce qu’on voulût bien avoir la bonté de lui casser la tête ; il obtint cette faveur ; on lui bande les yeux ; on le fait mettre à genoux. Le roi des Bulgares passe dans ce moment, s’informe du crime du patient ; et comme ce roi[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-4] avait un grand génie, il comprit, par tout ce qu’il apprit de Candide, que c’était un jeune métaphysicien fort ignorant des choses de ce monde, et il lui accorda sa grâce avec une clémence qui sera louée dans tous les journaux et dans tous les siècles. Un brave chirurgien guérit Candide en trois semaines avec les émollients enseignés par Dioscoride. Il avait déjà un peu de peau, et pouvait marcher, quand le roi des Bulgares livra bataille au roi des Abares[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-5].\n\n‌\n\n[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-1]: Recruteurs prussiens.\\\n[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-2]: Les Bulgares sont les Prussiens.\\\n[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-3]: Dans l’armée prussienne on n’emprisonnait pas le soldat ; on lui donnait la schlague, comme étant une peine moins nuisible à sa santé, et même moins démoralisante ! (G. A.)\\\n[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-4]: Frédéric II.\\\n[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-5]: Les Abares figurent les Français ; Voltaire écrivit Candide pendant la guerre de Sept ans.";
    const { scenes } = parseDocumentXml(xml);
    const moves = scenes.fsReal.changes.filter((c) => c.type === "move");

    let content = md;
    for (const move of moves) {
      const result = planApply(content, {
        type: "move",
        text: move.text,
        oldText: "",
        newText: "",
        contextBefore: "",
        fromContext: move.fromContext,
        fromText: move.fromText,
        toContext: move.toContext,
        footnoteRefs: move.footnoteRefs,
        destinationBoundary: move.destinationBoundary,
      });
      assert.equal(result.ok, true, "application du déplacement réel");
      content = result.newContent;
    }

    // NON-RÉGRESSION — le bug exact rapporté : jamais de paragraphe collé.
    assert.equal(content.includes("écot.Deux hommes"), false);
    assert.equal(content.includes("dîner très-civilement.— Ah"), false);
    assert.equal(content.includes("boire à sa santé.— Oh"), false);
    assert.equal(content.includes("cervelle. Il eut beau"), false); // Word a scindé ce paragraphe en deux pour faire de la place
    assert.equal(/\n{3,}/.test(content), false, "jamais de triple saut de ligne");

    // Structure EXACTE attendue (celle réellement produite par Word) — les
    // quatre extraits ci-dessous sont des fenêtres RÉELLES autour de repères
    // ASCII sûrs, jamais retapées à la main (voir en tête de ce test).
    assert.ok(content.includes("payer mon écot.\n\nDeux hommes habillés de bleu[^Candide-"), "le passage déplacé forme son propre paragraphe après '— Messieurs...'");
    assert.ok(content.includes("très-civilement.\n\n— Ah ! monsieur, lui dit un "), "le paragraphe suivant ('— Ah ! monsieur...') n'est jamais collé au passage déplacé");
    assert.ok(content.includes("dans la cervelle. \n\n— Oh ! très-volontiers, mess"), "le paragraphe complet déplacé s'intercale, dans son propre paragraphe, après 'Candide, tout stupéfait...cervelle.'");
    assert.ok(content.includes("comme un prodige.\n\nIl eut beau dire que les volontés sont"), "la suite ('Il eut beau dire...') forme bien son propre paragraphe après le passage déplacé, jamais collée à lui");

    // Le VRAI label Markdown source de la note déplacée est conservé —
    // jamais un label fantôme reconstruit depuis le w:id interne de Word.
    assert.ok(content.includes("[^Candide-ou-l-Optimisme-Exemple-Manuscrit-Partie-1-L-Ancien-Monde-02-Chapitre-2-Enr-lement-chez-les-Bulgares-1]"));
    // La définition de note n'est jamais dupliquée par ce déplacement même
    // feuillet : toujours exactement 5 définitions (aucune n'est créée).
    const defCount = (content.match(/^\[\^Candide-ou-l-Optimisme[^\]]*\]:/gm) || []).length;
    assert.equal(defCount, 5);
  });
});

test("Absorption des révisions de note portées par un déplacement de passage (mission item 1)", async (t) => {
  // Fragments EXTRAITS TELS QUELS de Manuscrit.docx (référence "(2)") — un
  // paragraphe entier déplacé (marqueur de paragraphe w:moveFrom/w:moveTo)
  // portant un appel de note, dont le corps (word/footnotes.xml) est
  // ENTIÈREMENT dupliqué par Word en w:del (ancien id)/w:ins (nouvel id) —
  // structure OOXML réelle confirmée, jamais du XML inventé.
  const realOriginFragment = "<w:p w14:paraId=\"09952DB8\" w14:textId=\"6BD8FE85\" w:rsidR=\"00523862\" w:rsidDel=\"002A5854\" w:rsidRDefault=\"00000000\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:moveFrom w:id=\"1\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"/></w:rPr></w:pPr><w:moveFromRangeStart w:id=\"2\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w:name=\"move236989226\"/><w:moveFrom w:id=\"3\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"><w:r w:rsidDel=\"002A5854\"><w:t>Il y avait en Vestphalie, dans le château de M. le baron de Thunder-ten-tronckh, un jeune garçon à qui la nature avait donné les mœurs les plus douces. Sa physionomie annonçait son âme. Il avait le jugement assez droit, avec l’esprit le plus simple ; c’est, je crois, pour cette raison qu’on le nommait Candide. Les anciens domestiques de la maison soupçonnaient qu’il était fils de la sœur de monsieur le baron et d’un bon et honnête gentilhomme du voisinage, que cette demoiselle ne voulut jamais épouser parce qu’il n’avait pu prouver que soixante et onze quartiers</w:t></w:r><w:r w:rsidDel=\"002A5854\"><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"1\"/></w:r><w:r w:rsidDel=\"002A5854\"><w:t>, et que le reste de son arbre généalogique avait été perdu par l’injure du temps.</w:t></w:r></w:moveFrom></w:p><w:moveFromRangeEnd w:id=\"2\"/>";
  const realDestFragment = "<w:p w14:paraId=\"3E06AAA7\" w14:textId=\"77777777\" w:rsidR=\"002A5854\" w:rsidRDefault=\"002A5854\" w:rsidP=\"002A5854\"><w:pPr><w:ind w:firstLine=\"708\"/><w:jc w:val=\"both\"/><w:rPr><w:moveTo w:id=\"12\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"/></w:rPr></w:pPr><w:moveToRangeStart w:id=\"13\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w:name=\"move236989226\"/><w:moveTo w:id=\"14\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"><w:r><w:t xml:space=\"preserve\">Il y avait en </w:t></w:r><w:proofErr w:type=\"spellStart\"/><w:r><w:t>Vestphalie</w:t></w:r><w:proofErr w:type=\"spellEnd\"/><w:r><w:t>, dans le château de M. le baron de Thunder-</w:t></w:r><w:proofErr w:type=\"spellStart\"/><w:r><w:t>ten</w:t></w:r><w:proofErr w:type=\"spellEnd\"/><w:r><w:t>-</w:t></w:r><w:proofErr w:type=\"spellStart\"/><w:r><w:t>tronckh</w:t></w:r><w:proofErr w:type=\"spellEnd\"/><w:r><w:t>, un jeune garçon à qui la nature avait donné les mœurs les plus douces. Sa physionomie annonçait son âme. Il avait le jugement assez droit, avec l’esprit le plus simple ; c’est, je crois, pour cette raison qu’on le nommait Candide. Les anciens domestiques de la maison soupçonnaient qu’il était fils de la sœur de monsieur le baron et d’un bon et honnête gentilhomme du voisinage, que cette demoiselle ne voulut jamais épouser parce qu’il n’avait pu prouver que soixante et onze quartiers</w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteReference w:id=\"5\"/></w:r><w:r><w:t>, et que le reste de son arbre généalogique avait été perdu par l’injure du temps.</w:t></w:r></w:moveTo></w:p><w:moveToRangeEnd w:id=\"13\"/><w:p w14:paraId=\"468A2A13\" w14:textId=\"77777777\" w:rsidR=\"002A5854\" w:rsidRDefault=\"002A5854\">";
  const realFootnoteDel = "<w:footnote w:id=\"1\"><w:p w14:paraId=\"4B82CD52\" w14:textId=\"77777777\" w:rsidR=\"00523862\" w:rsidDel=\"002A5854\" w:rsidRDefault=\"00000000\"><w:pPr><w:rPr><w:del w:id=\"4\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"/></w:rPr></w:pPr><w:del w:id=\"5\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"><w:r w:rsidDel=\"002A5854\"><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteRef/></w:r><w:r w:rsidDel=\"002A5854\"><w:delText xml:space=\"preserve\"> Quartier signifie chaque degré d’ordre et de succession des descendants. En France, un homme était réputé de bonne noblesse quand il prouvait quatre quartiers du côté du père et autant du côté de la mère. En Allemagne, il fallait faire preuve de seize quartiers, tant du côté paternel que du côté maternel, c’est-à-dire avoir cinq cents ans de noblesse environ. Aussi les nobles allemands prenaient-ils bien garde de se mésallier. (G. A.)</w:delText></w:r></w:del></w:p></w:footnote>";
  const realFootnoteIns = "<w:footnote w:id=\"5\"><w:p w14:paraId=\"20CDA7FB\" w14:textId=\"77777777\" w:rsidR=\"002A5854\" w:rsidRDefault=\"002A5854\" w:rsidP=\"002A5854\"><w:pPr><w:rPr><w:ins w:id=\"15\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"/></w:rPr></w:pPr><w:ins w:id=\"16\" w:author=\"halim yalcin\" w:date=\"2026-08-07T10:00:00Z\" w16du:dateUtc=\"2026-08-07T08:00:00Z\"><w:r><w:rPr><w:rStyle w:val=\"Appelnotedebasdep\"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space=\"preserve\"> Quartier signifie chaque degré d’ordre et de succession des descendants. En France, un homme était réputé de bonne noblesse quand il prouvait quatre quartiers du côté du père et autant du côté de la mère. En Allemagne, il fallait faire preuve de seize quartiers, tant du côté paternel que du côté maternel, c’est-à-dire avoir cinq cents ans de noblesse environ. Aussi les nobles allemands prenaient-ils bien garde de se mésallier. (G. A.)</w:t></w:r></w:ins></w:p></w:footnote>";

  function buildDocXml(originFragment, destFragment) {
    return "<w:document><w:body>" +
      '<w:p><w:bookmarkStart w:id="0" w:name="fsOrigin"/></w:p>' +
      originFragment +
      '<w:bookmarkEnd w:id="0"/>' +
      '<w:p><w:bookmarkStart w:id="1" w:name="fsDest"/></w:p>' +
      destFragment +
      '<w:bookmarkEnd w:id="1"/>' +
      "</w:body></w:document>";
  }

  function buildFootnotesXml(...footnotes) {
    return `<w:footnotes>${footnotes.join("")}</w:footnotes>`;
  }

  await t.test("1. déplacement de paragraphe avec UNE note (structure réelle) => une seule opération de déplacement, jamais une fiche note séparée", () => {
    const docXml = buildDocXml(realOriginFragment, realDestFragment);
    const footnotesXml = buildFootnotesXml(realFootnoteDel, realFootnoteIns);
    const { scenes, unclassified } = parseDocxReview({ "word/document.xml": docXml, "word/footnotes.xml": footnotesXml });

    const byPath = {};
    for (const [id, bucket] of Object.entries(scenes)) byPath[id] = bucket;
    mergeGlobalMovePairs(byPath, {}, unclassified);
    absorbMoveOwnedFootnoteRevisions(byPath, {}, unclassified);
    mergeImplicitCutPastePairs(byPath, {}, unclassified);

    const allChanges = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes];
    assert.equal(allChanges.length, 1, "aucune fiche note séparée, seulement le déplacement du passage");
    assert.equal(allChanges[0].type, "move");
    assert.ok(allChanges[0].fromText.includes("[^1]"), "le VRAI label Markdown [^1] voyage avec le passage");
    assert.ok(!allChanges[0].fromText.includes("[^5]"), "jamais l'id Word interne de destination dans fromText");
  });

  await t.test("2. la note absorbée n'insère JAMAIS de définition en double, et son label reste [^1] (jamais [^5])", () => {
    const docXml = buildDocXml(realOriginFragment, realDestFragment);
    const footnotesXml = buildFootnotesXml(realFootnoteDel, realFootnoteIns);
    const { scenes, unclassified } = parseDocxReview({ "word/document.xml": docXml, "word/footnotes.xml": footnotesXml });
    const byPath = {};
    for (const [id, bucket] of Object.entries(scenes)) byPath[id] = bucket;
    mergeGlobalMovePairs(byPath, {}, unclassified);
    absorbMoveOwnedFootnoteRevisions(byPath, {}, unclassified);
    mergeImplicitCutPastePairs(byPath, {}, unclassified);

    const move = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes][0];
    assert.equal(move.type, "move");
    assert.deepEqual(move.footnoteRefs, ["5"]);
    assert.deepEqual(move.originFootnoteIds, ["1"]);
    assert.deepEqual(move.destFootnoteIds, ["5"]);
  });

  await t.test("3. déplacement avec DEUX notes (même structure réelle, dupliquée) => toujours une seule opération de déplacement", () => {
    // Étend fidèlement la structure RÉELLE ci-dessus (mêmes tags, mêmes
    // conventions w:del/w:ins/w:moveFrom/w:moveTo) à un second appel de
    // note dans le MÊME paragraphe déplacé — Manuscrit.docx ne porte pas ce
    // cas précis (une seule note sur ce passage), donc étendu fidèlement
    // plutôt que laissé sans couverture (jamais un XML inventé de toutes
    // pièces : même structure, juste un second appel).
    const originWithTwoNotes = realOriginFragment
      .replace('<w:footnoteReference w:id="1"/>', '<w:footnoteReference w:id="1"/></w:r><w:r w:rsidDel="002A5854"><w:footnoteReference w:id="2"/>');
    const destWithTwoNotes = realDestFragment
      .replace('<w:footnoteReference w:id="5"/>', '<w:footnoteReference w:id="5"/></w:r><w:r><w:footnoteReference w:id="6"/>');
    const secondFootnoteDel = realFootnoteDel.replace(/w:id="1"/g, 'w:id="2"').replace(/w:id="4"/, 'w:id="40"').replace(/w:id="5"/, 'w:id="50"');
    const secondFootnoteIns = realFootnoteIns.replace(/w:id="5"/g, 'w:id="6"').replace(/w:id="15"/, 'w:id="150"').replace(/w:id="16"/, 'w:id="160"');

    const docXml = buildDocXml(originWithTwoNotes, destWithTwoNotes);
    const footnotesXml = buildFootnotesXml(realFootnoteDel, realFootnoteIns, secondFootnoteDel, secondFootnoteIns);
    const { scenes, unclassified } = parseDocxReview({ "word/document.xml": docXml, "word/footnotes.xml": footnotesXml });
    const byPath = {};
    for (const [id, bucket] of Object.entries(scenes)) byPath[id] = bucket;
    mergeGlobalMovePairs(byPath, {}, unclassified);
    absorbMoveOwnedFootnoteRevisions(byPath, {}, unclassified);
    mergeImplicitCutPastePairs(byPath, {}, unclassified);

    const allChanges = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes];
    assert.equal(allChanges.length, 1, "toujours un seul move, malgré les deux notes absorbées");
    assert.equal(allChanges[0].type, "move");
    assert.deepEqual(allChanges[0].originFootnoteIds, ["1", "2"]);
    assert.deepEqual(allChanges[0].destFootnoteIds, ["5", "6"]);
  });

  await t.test("4. le CONTENU de la note a été réellement corrigé (texte différent entre l'ancien et le nouveau corps) => reste visible, jamais absorbé", () => {
    // Même structure réelle, mais le texte du corps diffère entre origine
    // et destination (une vraie correction du correcteur, pas juste un
    // déplacement) : absorbMoveOwnedFootnoteRevisions doit refuser de
    // l'absorber (comparaison stricte du texte, jamais floue).
    const editedFootnoteIns = realFootnoteIns.replace(
      "Quartier signifie chaque degré d’ordre et de succession des descendants.",
      "Quartier signifie chaque degré d’ordre et de succession des descendants — CORRIGÉ."
    );
    const docXml = buildDocXml(realOriginFragment, realDestFragment);
    const footnotesXml = buildFootnotesXml(realFootnoteDel, editedFootnoteIns);
    const { scenes, unclassified } = parseDocxReview({ "word/document.xml": docXml, "word/footnotes.xml": footnotesXml });
    const byPath = {};
    for (const [id, bucket] of Object.entries(scenes)) byPath[id] = bucket;
    mergeGlobalMovePairs(byPath, {}, unclassified);
    absorbMoveOwnedFootnoteRevisions(byPath, {}, unclassified);

    // Le move du passage principal est présent...
    const moves = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes].filter((c) => c.type === "move");
    assert.equal(moves.length, 1);
    // ...ET la correction du corps de note reste visible séparément (jamais absorbée).
    const remaining = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes].filter((c) => c.type !== "move");
    assert.equal(remaining.length, 2, "suppression + insertion du corps de note, toujours visibles (correction réelle)");
    assert.ok(remaining.some((c) => c.type === "deletion" && c.inFootnote));
    assert.ok(remaining.some((c) => c.type === "insertion" && c.inFootnote && c.text.includes("CORRIGÉ")));
  });

  await t.test("5. même feuillet (mergeMovePairs interne à parseDocumentXml) : absorption identique", () => {
    // Origine et destination dans le MÊME signet (déplacement interne à un
    // feuillet) — mergeMovePairs (dans parseDocumentXml) fusionne déjà le
    // move avant que parseDocxReview ne rattache les notes : vérifie que
    // l'absorption fonctionne aussi dans ce cas, pas seulement cross-feuillet.
    const docXml = "<w:document><w:body><w:p><w:bookmarkStart w:id=\"0\" w:name=\"fsSame\"/></w:p>" +
      realOriginFragment + realDestFragment + "<w:bookmarkEnd w:id=\"0\"/></w:body></w:document>";
    const footnotesXml = buildFootnotesXml(realFootnoteDel, realFootnoteIns);
    const { scenes, unclassified } = parseDocxReview({ "word/document.xml": docXml, "word/footnotes.xml": footnotesXml });
    const byPath = {};
    for (const [id, bucket] of Object.entries(scenes)) byPath[id] = bucket;
    mergeGlobalMovePairs(byPath, {}, unclassified);
    absorbMoveOwnedFootnoteRevisions(byPath, {}, unclassified);
    mergeImplicitCutPastePairs(byPath, {}, unclassified);

    const allChanges = [...Object.values(byPath).flatMap((b) => b.changes), ...unclassified.changes];
    assert.equal(allChanges.length, 1);
    assert.equal(allChanges[0].type, "move");
  });
});

/* =========================================================================
 * parseHeadingStyleIds / titre-sous-titre injectés — reproduction du cas
 * réel (avant.docx/avant.md/apres.docx/apres.md, mission "4 problèmes
 * réels") : un déplacement dont la destination est le tout début d'un
 * chapitre atterrissait "trop bas" parce que le texte du titre/sous-titre
 * (jamais dans le markdown source, injecté par compile-export.ts au moment
 * de la fusion) polluait toContext.
 * ========================================================================= */
const stylesXmlHeadings = `<w:styles>
  <w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Titre3"><w:name w:val="heading 3"/></w:style>
  <w:style w:type="character" w:styleId="Titre2Car"><w:name w:val="heading 2 Char"/></w:style>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

test("parseHeadingStyleIds", async (t) => {
  await t.test("reconnaît heading 1..9 quel que soit le styleId localisé, ignore les styles non-paragraphe", () => {
    const ids = parseHeadingStyleIds(stylesXmlHeadings);
    assert.deepEqual([...ids].sort(), ["Titre2", "Titre3"]);
  });

  await t.test("styleId ANGLAIS (export Feuillets natif, avant tout passage par Word) reconnu tout autant", () => {
    const xml = `<w:styles><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
    assert.deepEqual([...parseHeadingStyleIds(xml)], ["Heading2"]);
  });

  await t.test("fichier absent/vide : ensemble vide, jamais une erreur", () => {
    assert.deepEqual(parseHeadingStyleIds(""), new Set());
  });
});

test("parseDocumentXml + planApplyInterFile — destination juste après un titre/sous-titre de feuillet injecté (Problème 1 réel)", async (t) => {
  const path1 = "ch1.md";
  const path2 = "ch2.md";
  const id1 = bookmarkIdFor(path1);
  const id2 = bookmarkIdFor(path2);

  // Reproduit EXACTEMENT la structure trouvée dans avant.docx : bookmarkEnd
  // du chapitre 1, un <w:p> vide, bookmarkStart du chapitre 2, PUIS deux
  // paragraphes de titre/sous-titre (pStyle Titre2/Titre3 — jamais dans le
  // markdown source), PUIS le moveTo lui-même.
  const xml = wrapBody(
    `<w:p><w:bookmarkStart w:id="1" w:name="${id1}"/></w:p>` +
    '<w:p><w:moveFromRangeStart w:id="2" w:name="moveX"/>' +
    '<w:moveFrom w:id="3" w:author="A" w:date="D"><w:r><w:delText>Monsieur le baron était puissant.</w:delText></w:r></w:moveFrom>' +
    '<w:moveFromRangeEnd w:id="2"/></w:p>' +
    `<w:bookmarkEnd w:id="1"/>` +
    '<w:p/>' +
    `<w:p><w:bookmarkStart w:id="4" w:name="${id2}"/></w:p>` +
    '<w:p><w:pPr><w:pStyle w:val="Titre2"/></w:pPr><w:r><w:t>Chapitre 2 — Titre injecté</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Titre3"/></w:pPr><w:r><w:t>Sous-titre injecté, jamais dans le markdown</w:t></w:r></w:p>' +
    '<w:p><w:moveToRangeStart w:id="5" w:name="moveX"/>' +
    '<w:moveTo w:id="6" w:author="A" w:date="D"><w:r><w:t>Monsieur le baron était puissant.</w:t></w:r></w:moveTo>' +
    '<w:moveToRangeEnd w:id="5"/></w:p>' +
    '<w:p><w:r><w:t>Paragraphe suivant, déjà dans le fichier.</w:t></w:r></w:p>' +
    `<w:bookmarkEnd w:id="4"/>`
  );

  const moveInPath2 = (scenes, unclassified) => {
    const byPath = { [path1]: scenes[id1], [path2]: scenes[id2] };
    mergeGlobalMovePairs(byPath, {}, unclassified);
    return byPath[path2].changes.find((c) => c.type === "move");
  };

  await t.test("sans headingStyleIds (styles.xml absent) : toContext encore pollué par le titre/sous-titre", () => {
    const { scenes, unclassified } = parseDocumentXml(xml);
    const move = moveInPath2(scenes, unclassified);
    assert.ok(move.toContext.includes("markdown"), "régression attendue sans styles.xml — sert de repère, pas un objectif");
  });

  await t.test("avec headingStyleIds (styles.xml fourni) : toContext redevient \"\", le vrai début du feuillet", () => {
    const headingIds = parseHeadingStyleIds(stylesXmlHeadings);
    const { scenes, unclassified } = parseDocumentXml(xml, {}, headingIds);
    const move = moveInPath2(scenes, unclassified);
    assert.equal(move.toContext, "");
  });

  await t.test("bout en bout (parseDocxReview + planApplyInterFile) : le passage atterrit en TÊTE du feuillet 2, ligne vide propre des deux côtés, jamais accolé au frontmatter ni au paragraphe suivant", async () => {
    const { scenes, unclassified } = parseDocxReview({
      "word/document.xml": xml,
      "word/styles.xml": stylesXmlHeadings,
    });
    const byPath = { [path1]: scenes[id1], [path2]: scenes[id2] };
    const unmatched = {};
    mergeGlobalMovePairs(byPath, unmatched, unclassified);
    const move = byPath[path2].changes.find((c) => c.type === "move");
    assert.ok(move, "le move doit être présent dans le feuillet 2");

    const store = {
      [path1]: "---\ntitle: \"Un\"\n---\n\nMonsieur le baron était puissant. Reste du chapitre 1.",
      [path2]: "---\ntitle: \"Deux\"\n---\n\nParagraphe suivant, déjà dans le fichier.",
    };
    const vault = { read: async (f) => store[f.path], modify: async (f, c) => { store[f.path] = c; } };
    const res = await planApplyInterFile(vault, { path: move.fromPath }, { path: move.toPath }, move);
    assert.equal(res.ok, true);
    assert.equal(
      store[path2],
      "---\ntitle: \"Deux\"\n---\n\nMonsieur le baron était puissant.\n\nParagraphe suivant, déjà dans le fichier."
    );
    assert.equal(/\n{3,}/.test(store[path2]), false, "jamais de ligne vide en double");
    const { start, end } = res.insertedRange;
    assert.equal(store[path2].slice(start, end), "Monsieur le baron était puissant.", "insertedRange pointe pile sur le passage collé (Problème 4)");
  });

  await t.test("frontmatter SANS ligne vide après (cas non standard) : une ligne vide est ajoutée, jamais collé au \"---\"", async () => {
    const { scenes, unclassified } = parseDocumentXml(xml, {}, parseHeadingStyleIds(stylesXmlHeadings));
    const move = moveInPath2(scenes, unclassified);
    const content = "---\ntitle: \"Deux\"\n---\nParagraphe suivant, déjà dans le fichier.";
    const result = planApply(content, {
      type: "insertion",
      contextBefore: move.toContext,
      text: move.text,
      oldText: "", newText: "", fromContext: "", fromText: "", toContext: "",
      destinationBoundary: move.destinationBoundary,
    });
    assert.equal(result.ok, true);
    assert.ok(result.newContent.startsWith("---\ntitle: \"Deux\"\n---\n\nMonsieur le baron était puissant.\n\nParagraphe"));
    assert.equal(/\n{3,}/.test(result.newContent), false);
  });
});

/* =========================================================================
 * findCommentAnchor — Problème 3 réel : commentaire "Vérifier" ancré sur
 * "anciens" (avant.docx), un mot qui peut très bien réapparaître ailleurs
 * dans un manuscrit plus long — jamais une raison de ne plus le retrouver.
 * ========================================================================= */
test("findCommentAnchor", async (t) => {
  await t.test("anchorText déjà unique : trouvé directement, sans avoir besoin du contexte", () => {
    const content = "Les anciens domestiques soupçonnaient la vérité.";
    const m = findCommentAnchor(content, { anchorText: "anciens" });
    assert.deepEqual(m, { index: 4, length: 7 });
  });

  await t.test("anchorText ambigu, contextBefore ET contextAfter réels : désambiguïse sur la BONNE occurrence", () => {
    const content = "Les anciens usages voulaient que Candide. Les anciens domestiques soupçonnaient la vérité.";
    const m = findCommentAnchor(content, {
      anchorText: "anciens",
      contextBefore: "Candide. Les ",
      contextAfter: " domestiques",
    });
    const expectedIndex = content.indexOf("anciens domestiques");
    assert.deepEqual(m, { index: expectedIndex, length: 7 });
  });

  await t.test("anchorText ambigu, contextBefore SEUL disponible : suffit à désambiguïser", () => {
    const content = "Les anciens usages. Puis les anciens domestiques.";
    const m = findCommentAnchor(content, { anchorText: "anciens", contextBefore: "Puis les " });
    assert.deepEqual(m, { index: content.indexOf("anciens domestiques"), length: 7 });
  });

  await t.test("anchorText ambigu, contextAfter SEUL disponible : suffit à désambiguïser", () => {
    const content = "Les anciens domestiques. Puis les anciens usages.";
    const m = findCommentAnchor(content, { anchorText: "anciens", contextAfter: " usages" });
    assert.deepEqual(m, { index: content.indexOf("anciens usages"), length: 7 });
  });

  await t.test("anchorText ambigu, aucun contexte disponible : jamais une correspondance au hasard (repli findTolerant, échoue proprement)", () => {
    const content = "Les anciens usages. Puis les anciens domestiques.";
    const m = findCommentAnchor(content, { anchorText: "anciens" });
    assert.equal(m, null);
  });

  await t.test("ne dégrade jamais vers une correspondance PARTIELLE quand le contexte suffit — jamais une exigence de correspondance littérale avec tout le texte compilé", () => {
    // contextBefore légèrement différent de la source (ex. ponctuation typographique
    // Word vs Markdown) : toleranceGroup absorbe la différence, comme pour tout le
    // reste du moteur — jamais bloquant.
    const content = "Les anciens usages. Puis les «anciens» domestiques.";
    const m = findCommentAnchor(content, { anchorText: "anciens", contextBefore: "Puis les \"" });
    assert.deepEqual(m, { index: content.indexOf("anciens» domestiques"), length: 7 });
  });

  await t.test("anchorText vide : jamais de correspondance", () => {
    assert.equal(findCommentAnchor("peu importe", { anchorText: "" }), null);
  });
});

test("parseDocumentXml — un commentaire capture contextBefore/contextAfter (voir findCommentAnchor)", async (t) => {
  await t.test("cas réel : commentaire ancré sur un mot courant, contexte réel des deux côtés capturé", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t xml:space="preserve">On le nommait Candide. Les </w:t></w:r>' +
        '<w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">anciens </w:t></w:r><w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        '<w:r><w:t>domestiques soupçonnaient.</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/></w:p>'
    );
    const commentsById = { "0": { text: "Vérifier", author: "A", date: "D" } };
    const { scenes } = parseDocumentXml(xml, commentsById);
    const comment = scenes.fsScene1.comments[0];
    assert.equal(comment.anchorText, "anciens");
    assert.equal(comment.contextBefore, "On le nommait Candide. Les ");
    assert.equal(comment.contextAfter, "domestiques soupçonnaient.");
  });

  await t.test("un commentaire posé sans sélection (w:commentReference isolé) ne porte aucun contexte — rien à désambiguïser, anchorText déjà vide", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/>' +
        '<w:r><w:t>Texte.</w:t></w:r>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        '<w:bookmarkEnd w:id="1"/></w:p>'
    );
    const commentsById = { "0": { text: "Note", author: "A", date: "D" } };
    const { scenes } = parseDocumentXml(xml, commentsById);
    const comment = scenes.fsScene1.comments[0];
    assert.equal(comment.anchorText, "");
    assert.equal(comment.contextBefore, undefined);
    assert.equal(comment.contextAfter, undefined);
  });
});

/* =========================================================================
 * Nettoyage d'une note déplacée (mission dédiée, teste2_* réels) : la note
 * transportée avec son paragraphe est correctement ajoutée à destination
 * (déjà validé), mais sa DÉFINITION D'ORIGINE était mal retirée — un "\"
 * parasite restait attaché au paragraphe précédent, et la séparation avec
 * les définitions restantes disparaissait (voir removeFootnoteDefinition).
 * Bloc de définitions réel : chaque ligne se termine par "\" SAUF la
 * dernière du bloc (voir export-docx.ts) — une seule ligne vide sépare le
 * bloc entier du paragraphe qui précède.
 * ========================================================================= */
test("Nettoyage de la définition d'origine après un déplacement de note (Problème réel teste2)", async (t) => {
  const blockOf4 =
    "[^1]: Définition un.\\\n[^2]: Définition deux.\\\n[^3]: Définition trois.\\\n[^4]: Définition quatre.";

  const makeFiles = () => ({
    "F1.md":
      "Premier paragraphe, à déplacer[^1] entier.\n\n" +
      "Second paragraphe reste ici[^2], et là[^3], et encore là[^4].\n\n" +
      blockOf4,
    "F2.md": "Autre feuillet, cible.",
  });

  const apply = async (fromText, footnoteRef) => {
    const files = makeFiles();
    const modified = {};
    const vault = { read: async (f) => files[f.path], modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; } };
    const moveChange = {
      type: "move",
      text: fromText,
      fromText,
      fromContext: "",
      toContext: "Autre feuillet, cible.",
      footnoteRefs: [footnoteRef],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true, `déplacement de la note ${footnoteRef} doit réussir`);
    return modified["F1.md"];
  };

  await t.test("note déplacée = PREMIÈRE définition du bloc, d'autres restent : ligne vide préservée, aucun \\ parasite", async () => {
    const result = await apply("Premier paragraphe, à déplacer[^1] entier.", "1");
    assert.ok(
      result.includes(
        "Second paragraphe reste ici[^2], et là[^3], et encore là[^4].\n\n[^2]: Définition deux.\\\n[^3]: Définition trois.\\\n[^4]: Définition quatre."
      ),
      "la ligne vide devant le bloc restant doit être intacte, sans \\ collé au paragraphe : " + JSON.stringify(result)
    );
    assert.equal(/\\\n\n|\n\n\\/.test(result), false);
    assert.equal(result.includes("[^1]:"), false);
  });

  await t.test("définition INTERMÉDIAIRE (ni première ni dernière) : voisines préservées EXACTEMENT", async () => {
    const files = makeFiles();
    files["F1.md"] =
      "Second paragraphe déplace[^2] une note du milieu.\n\n" +
      "Premier paragraphe reste ici[^1], et là[^3], et encore là[^4].\n\n" +
      blockOf4;
    const modified = {};
    const vault = { read: async (f) => files[f.path], modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; } };
    const moveChange = {
      type: "move",
      text: "Second paragraphe déplace[^2] une note du milieu.",
      fromText: "Second paragraphe déplace[^2] une note du milieu.",
      fromContext: "",
      toContext: "Autre feuillet, cible.",
      footnoteRefs: ["2"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(
      modified["F1.md"].includes("[^1]: Définition un.\\\n[^3]: Définition trois.\\\n[^4]: Définition quatre."),
      "les définitions 1, 3 et 4 doivent rester EXACTEMENT telles quelles : " + JSON.stringify(modified["F1.md"])
    );
    assert.equal(modified["F1.md"].includes("[^2]:"), false);
  });

  await t.test("note déplacée = DERNIÈRE définition du bloc : le \\ de continuation orphelin de la définition précédente est retiré, lui seul", async () => {
    const files = makeFiles();
    files["F1.md"] =
      "Reste ici[^1], et là[^2], et encore là[^3].\n\n" +
      "Paragraphe à déplacer[^4] entier.\n\n" +
      blockOf4;
    const modified = {};
    const vault = { read: async (f) => files[f.path], modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; } };
    const moveChange = {
      type: "move",
      text: "Paragraphe à déplacer[^4] entier.",
      fromText: "Paragraphe à déplacer[^4] entier.",
      fromContext: "",
      toContext: "Autre feuillet, cible.",
      footnoteRefs: ["4"],
      // Un paragraphe entier des deux côtés — même réglage qu'un vrai
      // déplacement natif Word (voir needsTrailingParagraphBreak) : sans
      // lui, la suppression ordinaire (hors du champ de cette mission,
      // moteur déjà validé) laisse deux lignes vides adjacentes se
      // téléscoper en \n{3,}, jamais un souci propre à cette mission.
      destinationBoundary: "standalone-paragraph",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(
      modified["F1.md"].includes("[^1]: Définition un.\\\n[^2]: Définition deux.\\\n[^3]: Définition trois.\n"),
      "la définition 3, désormais dernière, ne doit plus porter de \\ orphelin : " + JSON.stringify(modified["F1.md"])
    );
    assert.equal(modified["F1.md"].includes("[^4]:"), false);
    assert.equal(modified["F1.md"].includes("trois.\\"), false, "aucun \\ parasite en fin de bloc");
  });

  await t.test("les définitions restantes restent reconnues/exportables (re-parsées correctement après coup)", async () => {
    const result = await apply("Premier paragraphe, à déplacer[^1] entier.", "1");
    const { definitions, references } = parseFootnotes(result);
    assert.deepEqual(definitions.map((d) => d.id), ["2", "3", "4"]);
    assert.deepEqual(references.map((r) => r.id).sort(), ["2", "3", "4"]);
    // "\" de continuation intact pour 2 et 3 (encore suivies d'une autre
    // définition, voir parseFootnotes/isContinuationLine — comportement du
    // moteur des notes, pas de cette mission) ; 4, désormais dernière du
    // bloc, n'en porte plus.
    assert.equal(definitions[0].content, "Définition deux.\\");
    assert.equal(definitions[1].content, "Définition trois.\\");
    assert.equal(definitions[2].content, "Définition quatre.");
  });

  await t.test("note SEULE du bloc (première ET dernière à la fois) : bloc entier retiré proprement", async () => {
    const files = { "F1.md": "Seul paragraphe[^1] du feuillet.\n\n[^1]: Unique définition.", "F2.md": "Cible." };
    const modified = {};
    const vault = { read: async (f) => files[f.path], modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; } };
    const moveChange = {
      type: "move",
      text: "Seul paragraphe[^1] du feuillet.",
      fromText: "Seul paragraphe[^1] du feuillet.",
      fromContext: "",
      toContext: "Cible.",
      footnoteRefs: ["1"],
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.equal(modified["F1.md"].includes("[^1]"), false);
    assert.equal(/\\/.test(modified["F1.md"]), false);
  });
});

test("LOT 7 Validation — Corpus de régression et trous de couverture", async (t) => {
  await t.test("Trou 1 : Déplacement multi-paragraphe inter-feuillets", async () => {
    const files = {
      "F1.md": "Avant origine.\n\nPremier paragraphe déplacé.\n\nDeuxième paragraphe déplacé.\n\nAprès origine.",
      "F2.md": "Avant destination.\n\nAprès destination.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; }
    };
    const moveChange = {
      type: "move",
      moveName: "MoveMulti",
      fromText: "Premier paragraphe déplacé.\n\nDeuxième paragraphe déplacé.",
      text: "Premier paragraphe déplacé.\n\nDeuxième paragraphe déplacé.",
      fromContext: "Avant origine.\n\n",
      toContext: "Avant destination.\n\n",
      destinationBoundary: "standalone-paragraph",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.equal(modified["F1.md"], "Avant origine.\n\nAprès origine.");
    assert.equal(modified["F2.md"], "Avant destination.\n\nPremier paragraphe déplacé.\n\nDeuxième paragraphe déplacé.\n\nAprès destination.");
  });

  await t.test("Trou 2A : Passage déplacé inter-feuillets avec 2 notes Markdown (exclusives)", async () => {
    const files = {
      "F1.md": "Avant.\n\nPassage[^1] contenant aussi une seconde note[^2].\n\nAprès.\n\n[^1]: Première définition.\\\n[^2]: Seconde définition.",
      "F2.md": "Destination.\n\n",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; }
    };
    const moveChange = {
      type: "move",
      fromText: "Passage[^1] contenant aussi une seconde note[^2].",
      text: "Passage[^1] contenant aussi une seconde note[^2].",
      fromContext: "Avant.\n\n",
      toContext: "Destination.\n\n",
      footnoteRefs: ["1", "2"],
      destinationBoundary: "standalone-paragraph",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.equal(modified["F1.md"].includes("[^1]"), false);
    assert.equal(modified["F1.md"].includes("[^2]"), false);
    assert.ok(modified["F2.md"].includes("Première définition."));
    assert.ok(modified["F2.md"].includes("Seconde définition."));
  });

  await t.test("Trou 2B : Passage déplacé avec 2 notes Markdown dont une encore utilisée à l'origine", async () => {
    const files = {
      "F1.md": "Contexte avec note un[^1].\n\nPassage[^1] contenant aussi une seconde note[^2].\n\nAprès.\n\n[^1]: Première définition.\\\n[^2]: Seconde définition.",
      "F2.md": "Destination.\n\n",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; }
    };
    const moveChange = {
      type: "move",
      fromText: "Passage[^1] contenant aussi une seconde note[^2].",
      text: "Passage[^1] contenant aussi une seconde note[^2].",
      fromContext: "Contexte avec note un[^1].\n\n",
      toContext: "Destination.\n\n",
      footnoteRefs: ["1", "2"],
      destinationBoundary: "standalone-paragraph",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.ok(modified["F1.md"].includes("[^1]: Première définition."));
    assert.equal(modified["F1.md"].includes("[^2]"), false);
    assert.ok(modified["F2.md"].includes("Première définition."));
    assert.ok(modified["F2.md"].includes("Seconde définition."));
  });

  await t.test("Trou 3 : Passage déplacé puis modifié par l'éditeur (sécurité de confiance)", async () => {
    const fromContent = "Avant. Texte original à déplacer. Après.";
    const toContent = "Avant destination. Après destination.";
    const moveChange = {
      type: "move",
      moveName: "Move1",
      fromText: "Texte original à déplacer.",
      text: "Texte original MODIFIÉ PAR L'ÉDITEUR.",
      fromContext: "Avant.",
      toContext: "Avant destination.",
    };

    const evalRes = evaluateInterFileConfidence(fromContent, toContent, moveChange);
    assert.notEqual(evalRes.confidence, "safe", "un passage modifié après déplacement ne doit jamais être safe");
    assert.ok(
      evalRes.confidence === "review" || evalRes.confidence === "ambiguous",
      "le statut doit être révision ou ambigu"
    );
  });

  await t.test("Trou 4 : Blockquote Markdown (> Un passage cité)", async () => {
    const files = {
      "F1.md": "Avant origine.\n\n> Un passage cité à déplacer.\n\nAprès origine.",
      "F2.md": "Avant destination.\n\nAprès destination.",
    };
    const modified = {};
    const vault = {
      read: async (f) => files[f.path],
      modify: async (f, c) => { files[f.path] = c; modified[f.path] = c; }
    };
    const moveChange = {
      type: "move",
      moveName: "MoveQuote",
      fromText: "> Un passage cité à déplacer.",
      text: "> Un passage cité à déplacer.",
      fromContext: "Avant origine.\n\n",
      toContext: "Avant destination.\n\n",
      destinationBoundary: "standalone-paragraph",
    };
    const res = await planApplyInterFile(vault, { path: "F1.md" }, { path: "F2.md" }, moveChange);
    assert.equal(res.ok, true);
    assert.equal(modified["F1.md"], "Avant origine.\n\nAprès origine.");
    assert.equal(modified["F2.md"], "Avant destination.\n\n> Un passage cité à déplacer.\n\nAprès destination.");
    assert.ok(modified["F2.md"].includes("> Un passage cité à déplacer."));
  });
});
