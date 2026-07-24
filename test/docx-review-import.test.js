import { test } from "node:test";
import assert from "node:assert/strict";
import { walkTags } from "../src/utils/xml.js";
import { bookmarkIdFor } from "../src/utils/docx-bookmarks.js";
import {
  parseCommentsXml,
  parseCommentsExtended,
  parseDocumentXml,
  parseDocxReview,
  parseFootnotesXml,
  resolveScenesToPaths,
  resolveOrphans,
  mergeGlobalMovePairs,
  planApplyInterFile,
  searchTextForChange,
  planApply,
  findTolerant,
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

  await t.test("un saut de paragraphe entre deux <w:p> devient \\n\\n (régression : contexte+texte collés sans séparateur ne se retrouvaient pas dans la source, qui en a un)", () => {
    const xml = wrapBody(
      '<w:p><w:bookmarkStart w:id="1" w:name="fsScene1"/><w:r><w:t>Fin du premier paragraphe.</w:t></w:r></w:p>' +
        '<w:p><w:ins w:id="2" w:author="A" w:date="D"><w:r><w:t>Début du second.</w:t></w:r></w:ins></w:p>'
    );
    const { scenes } = parseDocumentXml(xml);
    assert.equal(scenes.fsScene1.changes[0].text, "\n\nDébut du second.");
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
    assert.equal(scenes.fsScene1.changes[0].text, "\n\nAprès.");
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
    // "\n\n" : un vrai second <w:p> sépare bien les deux dans le docx —
    // reflète maintenant le saut de paragraphe réel entre eux
    assert.equal(unclassified.changes[0].text, "\n\naprès le signet");
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
    // "\n\n" en tête : la destination est dans son PROPRE <w:p>, donc un
    // vrai saut de paragraphe est traversé pour l'atteindre (cas réel
    // confirmé sur "Soif de l'eau...", voir services/export-docx.js)
    assert.equal(changes[0].text, "\n\npassage déplacé");
    assert.equal(changes[0].fromText, "passage déplacé");
    assert.equal(changes[0].fromContext, "Avant. ");
    assert.ok(changes[0].toContext.includes("Milieu."));
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
    assert.deepEqual(parseCommentsXml(commentsXml), { "0": { author: "A", date: "D", text: "Simple." } });
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
