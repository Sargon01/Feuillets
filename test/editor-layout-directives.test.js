import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLayoutDirectiveContext,
  computeLayoutDirectiveEdit,
} from "../src/utils/editor-layout-directives.js";

function lineOf(text, needle) {
  const idx = text.split("\n").findIndex((l) => l.includes(needle));
  if (idx === -1) throw new Error(`ligne introuvable : ${needle}`);
  return idx;
}

/* ===== §32 — détection PURE des blocs ===== */

test("§32.A — curseur sur un embed Obsidian seul => type image", () => {
  const text = "Texte avant.\n\n![[image.png]]\n\nSuite.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  assert.ok(ctx);
  assert.equal(ctx.block.kind, "image");
});

test("§32.B — image Markdown seule => type image", () => {
  const text = "![Carte](carte.png)\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.ok(ctx);
  assert.equal(ctx.block.kind, "image");
});

test("§32.C — image puis paragraphe => composition image-texte", () => {
  const text = "![[image.png]]\n\nUn paragraphe.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.composition, "image-texte");
});

test("§32.D — paragraphe puis image => composition texte-image", () => {
  const text = "Un paragraphe.\n\n![[image.png]]";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.composition, "texte-image");
});

test("§32.E — image puis image => composition image-image", () => {
  const text = "![[a.png]]\n\n![[b.png]]";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.composition, "image-image");
});

test("§32.F — texte puis texte => aucune composition 3B, aucun contexte", () => {
  const text = "Premier paragraphe.\n\nSecond paragraphe.";
  assert.equal(resolveLayoutDirectiveContext(text, 0), null);
});

test("§32.G — un titre n'est pas un bloc admissible", () => {
  const text = "# Titre\n\nTexte.";
  assert.equal(resolveLayoutDirectiveContext(text, 0), null);
});

test("§32.H — un embed dans un bloc de code n'est jamais détecté comme image", () => {
  const text = "```\n![[image.png]]\n```\n\n![[vraie.png]]\n\nTexte.";
  assert.equal(resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]")), null);
  const real = resolveLayoutDirectiveContext(text, lineOf(text, "![[vraie.png]]"));
  assert.equal(real.block.kind, "image");
});

test("§32.I — une liste est un slot texte (détection image-texte depuis l'image)", () => {
  const text = "![[image.png]]\n\n- Un\n- Deux";
  const fromImage = resolveLayoutDirectiveContext(text, 0);
  assert.equal(fromImage.pairing.composition, "image-texte");

  // Depuis la liste elle-même, avec une composition déjà écrite : reconnue
  // comme second bloc, classée "text" (§36 même principe appliqué à une liste).
  const withDirective = "%% colonnes: image-texte 50/50 %%\n\n![[image.png]]\n\n- Un\n- Deux";
  const fromList = resolveLayoutDirectiveContext(withDirective, lineOf(withDirective, "- Un"));
  assert.equal(fromList.block.kind, "text");
  assert.equal(fromList.pairing.composition, "image-texte");
});

test("§32.J — un callout est un slot texte (détection image-texte depuis l'image)", () => {
  // Callout Obsidian ordinaire (natif, non sémantique) : prouve que cette
  // détection est générique — indépendante des rôles sémantiques Feuillets.
  const text = "![[image.png]]\n\n> [!example] Titre\n> Contenu.";
  const fromImage = resolveLayoutDirectiveContext(text, 0);
  assert.equal(fromImage.pairing.composition, "image-texte");

  const withDirective = "%% colonnes: image-texte 50/50 %%\n\n![[image.png]]\n\n> [!example] Titre\n> Contenu.";
  const fromCallout = resolveLayoutDirectiveContext(withDirective, lineOf(withDirective, "[!example]"));
  assert.equal(fromCallout.block.kind, "text");
  assert.equal(fromCallout.pairing.composition, "image-texte");
});

/* ===== §33/§34 — contexte et sérialisation 3A ===== */

test("§33 — contexte 3A existant reconnu, puis remplacé par droite/60", () => {
  const text = "%% image: centre 40% %%\n\n![[image.png]]";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  assert.deepEqual(ctx.image, { placement: "centre", width: 40 });

  const edit = computeLayoutDirectiveEdit(text, ctx, { image: { placement: "droite", width: 60 } });
  const after = text.slice(0, 0) + text.split("\n").slice(0, edit.fromLine).join("\n") +
    (edit.fromLine > 0 ? "\n" : "") + edit.text + text.split("\n").slice(edit.toLine).join("\n");
  assert.match(after, /%% image: droite 60% %%/);
  assert.equal((after.match(/%% image:/g) || []).length, 1);
});

test("§34 — Auto supprime la directive image, le fichier redevient identique", () => {
  const text = "%% image: centre 40% %%\n\n![[image.png]]\n\nSuite.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const edit = computeLayoutDirectiveEdit(text, ctx, { image: { placement: "auto", width: null } });
  assert.ok(edit);
  const lines = text.split("\n");
  const after = [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n");
  assert.equal(after, "\n![[image.png]]\n\nSuite.");
});

test("§34 — `%% image: auto %%` est reconnu comme Auto et supprimé à l'application", () => {
  const text = "%% image: auto %%\n\n![[image.png]]";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  assert.deepEqual(ctx.image, { placement: "auto", width: null });
  const edit = computeLayoutDirectiveEdit(text, ctx, { image: { placement: "auto", width: null } });
  assert.ok(edit);
  assert.doesNotMatch(edit.text, /image/);
});

/* ===== §35 — neuf combinaisons colonnes ===== */

const COMBINATIONS = [
  { text: "![[image.png]]\n\nTexte.", composition: "image-texte" },
  { text: "Texte.\n\n![[image.png]]", composition: "texte-image" },
  { text: "![[a.png]]\n\n![[b.png]]", composition: "image-image" },
];
const RATIOS = ["40/60", "50/50", "60/40"];

for (const { text, composition } of COMBINATIONS) {
  for (const ratio of RATIOS) {
    test(`§35 — ${composition} ${ratio} sérialise correctement`, () => {
      const ctx = resolveLayoutDirectiveContext(text, 0);
      assert.equal(ctx.pairing.composition, composition);
      const edit = computeLayoutDirectiveEdit(text, ctx, { pairing: { relation: "colonnes", ratio } });
      assert.match(edit.text, new RegExp(`%% colonnes: ${composition} ${ratio.replace("/", "\\/")} %%`));
    });
  }
}

/* ===== §36 — reconnaissance depuis les deux blocs ===== */

test("§36 — composition existante reconnue depuis l'image ET depuis le texte", () => {
  const text = "%% colonnes: image-texte 40/60 %%\n\n![[image.png]]\n\nTexte.";
  const fromImage = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const fromText = resolveLayoutDirectiveContext(text, lineOf(text, "Texte."));
  assert.equal(fromImage.pairing.relation, "colonnes");
  assert.equal(fromImage.pairing.ratio, "40/60");
  assert.equal(fromText.pairing.relation, "colonnes");
  assert.equal(fromText.pairing.ratio, "40/60");
  assert.deepEqual(fromImage.firstBlock, fromText.firstBlock);
});

/* ===== §37 — remplacement de ratio ===== */

test("§37 — 40/60 -> 60/40 : une seule directive, blocs et ordre inchangés", () => {
  const text = "%% colonnes: image-texte 40/60 %%\n\n![[image.png]]\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "Texte."));
  const edit = computeLayoutDirectiveEdit(text, ctx, { pairing: { relation: "colonnes", ratio: "60/40" } });
  const lines = text.split("\n");
  const after = [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n");
  assert.equal((after.match(/%% colonnes:/g) || []).length, 1);
  assert.match(after, /%% colonnes: image-texte 60\/40 %%/);
  assert.match(after, /!\[\[image\.png\]\]/);
  assert.match(after, /Texte\./);
  assert.ok(after.indexOf("![[image.png]]") < after.indexOf("Texte."));
});

/* ===== §38 — retirer une composition 3B ===== */

test("§38 — retirer la disposition : colonnes disparaît, blocs et contenu intacts", () => {
  const text = "%% colonnes: image-image 50/50 %%\n\n![[a.png]]\n\n![[b.png]]";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  const edit = computeLayoutDirectiveEdit(text, ctx, { pairing: { relation: "auto" } });
  const lines = text.split("\n");
  const after = [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n");
  assert.doesNotMatch(after, /colonnes/);
  assert.match(after, /!\[\[a\.png\]\]/);
  assert.match(after, /!\[\[b\.png\]\]/);
});

/* ===== §39 — 3A survit à 3B ===== */

test("§39 — retirer les colonnes laisse `image:` intact ; le remettre restaure l'ordre canonique", () => {
  const text = "%% colonnes: image-texte 50/50 %%\n%% image: centre 40% %%\n\n![[image.png]]\n\nTexte.";
  const ctx1 = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const edit1 = computeLayoutDirectiveEdit(text, ctx1, { pairing: { relation: "auto" } });
  const lines1 = text.split("\n");
  const afterRemove = [...lines1.slice(0, edit1.fromLine), ...edit1.text.split("\n").slice(0, -1), ...lines1.slice(edit1.toLine)].join("\n");
  assert.doesNotMatch(afterRemove, /colonnes/);
  assert.match(afterRemove, /%% image: centre 40% %%/);

  const ctx2 = resolveLayoutDirectiveContext(afterRemove, lineOf(afterRemove, "![[image.png]]"));
  const edit2 = computeLayoutDirectiveEdit(afterRemove, ctx2, { pairing: { relation: "colonnes", ratio: "50/50" } });
  const lines2 = afterRemove.split("\n");
  const restored = [...lines2.slice(0, edit2.fromLine), ...edit2.text.split("\n").slice(0, -1), ...lines2.slice(edit2.toLine)].join("\n");
  const orderIndex = (needle) => restored.split("\n").findIndex((l) => l.includes(needle));
  assert.ok(orderIndex("%% colonnes:") < orderIndex("%% image:"));
  assert.ok(orderIndex("%% image:") < orderIndex("![[image.png]]"));
});

/* ===== §40 — dessous ===== */

test("§40 — image + rôle admissible : dessous, puis côte à côte, puis automatique", () => {
  const text = "![[image.png]]\n\n> [!explication] Titre\n> Contenu.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.dessousAvailable, true);

  const edit1 = computeLayoutDirectiveEdit(text, ctx, { pairing: { relation: "dessous" } });
  const lines = text.split("\n");
  const afterDessous = [...lines.slice(0, edit1.fromLine), ...edit1.text.split("\n").slice(0, -1), ...lines.slice(edit1.toLine)].join("\n");
  assert.match(afterDessous, /%% dessous %%/);

  const ctx2 = resolveLayoutDirectiveContext(afterDessous, 0);
  const edit2 = computeLayoutDirectiveEdit(afterDessous, ctx2, { pairing: { relation: "colonnes", ratio: "50/50" } });
  const lines2 = afterDessous.split("\n");
  const afterColonnes = [...lines2.slice(0, edit2.fromLine), ...edit2.text.split("\n").slice(0, -1), ...lines2.slice(edit2.toLine)].join("\n");
  assert.doesNotMatch(afterColonnes, /dessous/);
  assert.match(afterColonnes, /%% colonnes: image-texte 50\/50 %%/);

  const ctx3 = resolveLayoutDirectiveContext(afterColonnes, 0);
  const edit3 = computeLayoutDirectiveEdit(afterColonnes, ctx3, { pairing: { relation: "auto" } });
  const lines3 = afterColonnes.split("\n");
  const afterAuto = [...lines3.slice(0, edit3.fromLine), ...edit3.text.split("\n").slice(0, -1), ...lines3.slice(edit3.toLine)].join("\n");
  assert.doesNotMatch(afterAuto, /dessous/);
  assert.doesNotMatch(afterAuto, /colonnes/);
});

/* ===== §41 — document/doc exclu du pairing automatique ===== */

test("§41 — image + [!document] : composition explicite possible, Dessous absent", () => {
  const text = "![[image.png]]\n\n> [!document] Carte\n> Texte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.composition, "image-texte");
  assert.equal(ctx.pairing.dessousAvailable, false);
});

test("§41 — alias [!doc] également exclu de Dessous", () => {
  const text = "![[image.png]]\n\n> [!doc] Carte\n> Texte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.dessousAvailable, false);
});

test("§41 — image + [!source] : composition explicite possible, Dessous absent (rôle sémantique remplaçant document)", () => {
  const text = "![[image.png]]\n\n> [!source] Source\n> Texte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.equal(ctx.pairing.composition, "image-texte");
  assert.equal(ctx.pairing.dessousAvailable, false, "source doit être exclu du pairing Dessous automatique, comme l'était document");
});

/* ===== §42 — directives invalides préservées ===== */

test("§42 — une directive image invalide voisine reste inchangée lors d'une action sur colonnes", () => {
  const text = "%% image: milieu 38% %%\n\n![[image.png]]\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const edit = computeLayoutDirectiveEdit(text, ctx, { pairing: { relation: "colonnes", ratio: "50/50" } });
  const lines = text.split("\n");
  const after = [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n");
  assert.match(after, /%% image: milieu 38% %%/);
});

test("§42 — une directive colonnes invalide n'est jamais retirée par une action sur l'image", () => {
  const text = "%% colonnes: image-image 30/70 %%\n\n![[image.png]]\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const edit = computeLayoutDirectiveEdit(text, ctx, { image: { placement: "centre", width: 40 } });
  const lines = text.split("\n");
  const after = edit
    ? [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n")
    : text;
  assert.match(after, /%% colonnes: image-image 30\/70 %%/);
});

/* ===== §43 — directives non-layout jamais touchées ===== */

test("§43 — `%% ligne %%` / `%% espace %%` / `[!saut-page]` restent hors de portée", () => {
  const text = "%% ligne: 4 %%\n\n%% espace: 55 mm %%\n\n![[image.png]]\n\n> [!saut-page]\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, lineOf(text, "![[image.png]]"));
  const edit = computeLayoutDirectiveEdit(text, ctx, { image: { placement: "centre", width: 40 } });
  const lines = text.split("\n");
  const after = [...lines.slice(0, edit.fromLine), ...edit.text.split("\n").slice(0, -1), ...lines.slice(edit.toLine)].join("\n");
  assert.match(after, /%% ligne: 4 %%/);
  assert.match(after, /%% espace: 55 mm %%/);
  assert.match(after, /\[!saut-page\]/);
});

/* ===== Cas sans composition possible (§26) et fermeture sans mutation ===== */

test("§26 — image sans bloc suivant compatible : contexte présent, sans section pairing", () => {
  const text = "![[image.png]]";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  assert.ok(ctx.image);
  assert.equal(ctx.pairing, null);
});

test("§26 — texte sans image suivante : aucun contexte (pas de menu)", () => {
  const text = "Un paragraphe seul.";
  assert.equal(resolveLayoutDirectiveContext(text, 0), null);
});
