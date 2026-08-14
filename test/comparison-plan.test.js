import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonBeforeRole, comparisonChangeLabel, comparisonPlacements, comparisonPlan,
  resolveComparisonVisualKind, shiftComparisonDecorations,
} from "../src/services/comparison-plan.js";

/**
 * Traduction d'un diff en décorations : c'est TOUT ce que Feuillets ajoute aux
 * deux vraies vues Markdown. Grammaire UNIVERSELLE, strictement la même en
 * Snapshot et en Relecture :
 *
 *     GAUCHE = AVANT (`before`)             DROITE = APRÈS (`after`)
 *     rouge barré + […] = parti/supprimé    [+] + vert = arrivé/ajouté
 *     rouge → vert = remplacé
 *     ligne pointillée + DÉPLACÉ ↑/↓ = couper/coller — jamais présenté comme
 *     une suppression d'un côté et un ajout de l'autre.
 *
 * Une différence n'est jamais réduite à un vide : le côté qui n'a rien de
 * réel porte un repère cliquable ([…] ou [+]), jamais un fantôme du texte de
 * l'autre côté, jamais une cale.
 */

const change = (overrides = {}) => ({
  index: 0, kind: "replacement", leftStart: 3, leftEnd: 7, rightStart: 3, rightEnd: 8,
  oldText: "chat", newText: "chien", applicable: true, handled: false, changeIndexes: [0], ...overrides,
});
const review = (changes, overrides = {}) => comparisonPlan({ mode: "native-review", changes, notes: [], activeIndex: null, ...overrides });
const snapshot = (changes, overrides = {}) => comparisonPlan({ mode: "snapshot", changes, notes: [], activeIndex: null, ...overrides });
const shape = (list) => list.map((item) => `${item.type}:${(item.class ?? "").split(" ")[0]}`);
const marks = (list) => list.filter((item) => item.type === "mark");
const labels = (list) => list.filter((item) => item.type === "label");

test("convention : le vrai fichier est l'AVANT en relecture, l'APRÈS en snapshot", () => {
  assert.equal(comparisonBeforeRole("native-review"), "source");
  assert.equal(comparisonBeforeRole("snapshot"), "compared");
  // Les coordonnées suivent : le moteur base toujours son diff sur le vrai
  // fichier (leftStart/oldText), mais ce n'est pas toujours la colonne gauche.
  const placement = comparisonPlacements(change(), "snapshot");
  assert.deepEqual([placement.before.start, placement.before.text], [3, "chien"], "le snapshot est l'avant");
  assert.deepEqual([placement.after.start, placement.after.text], [3, "chat"], "le fichier actuel est l'après");
});

test("plan : aucune décoration hors mark / label / actions — ni fantôme ni cale", () => {
  const both = [...review([change()], { activeIndex: 0 }).before, ...review([change()], { activeIndex: 0 }).after];
  for (const decoration of both) assert.ok(["mark", "label", "actions"].includes(decoration.type), `type inattendu : ${decoration.type}`);
});

/* ---- Union discriminée du type visuel — item 10 : addition / deletion /
   replacement / move+direction, calculée une fois, jamais devinée deux fois. */

test("visuel : addition/deletion/replacement suivent le sens de lecture, jamais le moteur brut", () => {
  assert.deepEqual(resolveComparisonVisualKind({ kind: "addition" }, "native-review"), { kind: "addition" });
  assert.deepEqual(resolveComparisonVisualKind({ kind: "deletion" }, "native-review"), { kind: "deletion" });
  assert.deepEqual(resolveComparisonVisualKind({ kind: "replacement" }, "native-review"), { kind: "replacement" });
  // Snapshot inverse addition/deletion (le moteur part du fichier actuel) —
  // jamais le remplacement, qui n'a pas de sens à inverser.
  assert.deepEqual(resolveComparisonVisualKind({ kind: "addition" }, "snapshot"), { kind: "deletion" });
  assert.deepEqual(resolveComparisonVisualKind({ kind: "deletion" }, "snapshot"), { kind: "addition" });
  assert.deepEqual(resolveComparisonVisualKind({ kind: "replacement" }, "snapshot"), { kind: "replacement" });
});

test("visuel : la direction d'un déplacement se lit dans le sens avant → après, inversée en snapshot", () => {
  const down = { kind: "move", leftStart: 0, rightStart: 10 }; // rightStart >= leftStart : brut "down"
  const up = { kind: "move", leftStart: 10, rightStart: 0 }; // brut "up"
  assert.deepEqual(resolveComparisonVisualKind(down, "native-review"), { kind: "move", direction: "down" });
  assert.deepEqual(resolveComparisonVisualKind(up, "native-review"), { kind: "move", direction: "up" });
  // Snapshot : avant=comparé, donc le sens brut (gauche→droite du moteur)
  // s'inverse pour rester fidèle au sens affiché (snapshot → version actuelle).
  assert.deepEqual(resolveComparisonVisualKind(down, "snapshot"), { kind: "move", direction: "up" });
  assert.deepEqual(resolveComparisonVisualKind(up, "snapshot"), { kind: "move", direction: "down" });
});

/* ---- Une différence, un seul endroit — jamais un vide ------------------ */

test("suppression : rouge barré à gauche, « […] » rouge à droite — jamais un vide", () => {
  const { before, after } = review([change({ kind: "deletion", rightEnd: 3, oldText: "chat", newText: "" })]);
  assert.deepEqual(shape(before), ["mark:cm-comparison-gone"]);
  assert.deepEqual(shape(after), ["label:cm-comparison-placeholder"]);
  assert.equal(after[0].text, "[…]");
  assert.ok(after[0].class.includes("cm-comparison-tone-gone"));
});

test("ajout : « [+] » vert à gauche, vert à droite — jamais un vide", () => {
  const { before, after } = review([change({ kind: "addition", leftEnd: 3, oldText: "", newText: "petit " })]);
  assert.deepEqual(shape(after), ["mark:cm-comparison-arrived"]);
  assert.deepEqual(shape(before), ["label:cm-comparison-placeholder"]);
  assert.equal(before[0].text, "[+]");
  assert.ok(before[0].class.includes("cm-comparison-tone-arrived"));
});

test("remplacement : ancien rouge à gauche, nouveau vert à droite — jamais de placeholder en plus", () => {
  const { before, after } = review([change()]);
  assert.deepEqual(shape(before), ["mark:cm-comparison-gone"]);
  assert.deepEqual(shape(after), ["mark:cm-comparison-arrived"]);
  assert.deepEqual([before[0].from, before[0].to], [3, 7], "la portion concernée seulement");
  assert.deepEqual([after[0].from, after[0].to], [3, 8]);
});

/* ---- Déplacement : jamais une suppression + un ajout -------------------- */

test("déplacement : le texte reste normal (accent, jamais rouge ni vert), ligne pointillée + DÉPLACÉ N, même numéro", () => {
  const { before, after } = review([change({ kind: "move", oldText: "Alpha", newText: "Alpha", rightEnd: 8 })]);
  const originMark = marks(before)[0]; const destMark = marks(after)[0];
  assert.ok(originMark.class.includes("cm-comparison-move-origin"));
  assert.equal(originMark.class.includes("cm-comparison-gone"), false, "jamais peint comme une suppression");
  assert.ok(destMark.class.includes("cm-comparison-move-destination"));
  assert.equal(destMark.class.includes("cm-comparison-arrived"), false, "jamais peint comme un ajout");
  const originLabel = labels(before)[0]; const destLabel = labels(after)[0];
  assert.equal(originLabel.class, "cm-comparison-move-dashes");
  assert.equal(originLabel.text, "- - - - - - - - - - ↓", "ligne pointillée orientée, pas de fantôme du texte");
  assert.equal(originLabel.at, 7, "posée après l'ancien emplacement");
  assert.equal(destLabel.class, "cm-comparison-move-label");
  assert.equal(destLabel.text, "Déplacé 1 ↓");
  assert.equal(destLabel.at, 3, "posée avant le nouvel emplacement");
  assert.equal(originLabel.index, destLabel.index, "un seul changement, donc une seule décision");
});

test("déplacement vers le haut : ligne pointillée ↑ à l'origine, DÉPLACÉ ↑ à la destination", () => {
  const { before, after } = review([change({ kind: "move", oldText: "Alpha", newText: "Alpha", leftStart: 10, leftEnd: 15, rightStart: 0, rightEnd: 5 })]);
  assert.equal(labels(before)[0].text, "↑ - - - - - - - - - -");
  assert.equal(labels(after)[0].text, "Déplacé 1 ↑");
});

test("déplacements multiples : numérotation stable dans l'ordre du document, un remplacement au milieu ne consomme pas de numéro", () => {
  const changes = [
    change({ index: 0, kind: "move", oldText: "A", newText: "A", leftStart: 0, leftEnd: 1, rightStart: 10, rightEnd: 11 }),
    change({ index: 1, kind: "replacement" }),
    change({ index: 2, kind: "move", oldText: "B", newText: "B", leftStart: 20, leftEnd: 21, rightStart: 30, rightEnd: 31 }),
  ];
  const { before, after } = review(changes);
  assert.deepEqual(labels(before).map((item) => item.text), ["- - - - - - - - - - ↓", "- - - - - - - - - - ↓"]);
  assert.deepEqual(labels(after).map((item) => item.text), ["Déplacé 1 ↓", "Déplacé 2 ↓"]);
  assert.equal(marks(before).length, 3);
});

/* ---- Snapshot : même grammaire, colonnes inversées ---------------------- */

test("snapshot : supprimé depuis le snapshot → rouge barré à gauche, « […] » rouge à droite", () => {
  // Le moteur part du fichier actuel : ce passage lui apparaît comme un
  // « ajout » côté snapshot. Pour le lecteur, il a disparu depuis.
  const { before, after } = snapshot([change({ kind: "addition", leftEnd: 3, oldText: "", newText: "un passage retiré " })]);
  assert.deepEqual(shape(before), ["mark:cm-comparison-gone"]);
  assert.equal(after[0].text, "[…]");
});

test("snapshot : ajouté depuis le snapshot → « [+] » vert à gauche, vert à droite", () => {
  const { before, after } = snapshot([change({ kind: "deletion", rightEnd: 3, oldText: "écrit depuis", newText: "" })]);
  assert.deepEqual(shape(after), ["mark:cm-comparison-arrived"]);
  assert.equal(before[0].text, "[+]");
});

test("snapshot : l'étiquette générique suit ce que le lecteur voit, jamais la mécanique du diff", () => {
  assert.equal(comparisonChangeLabel({ kind: "addition" }, "snapshot"), "Suppression");
  assert.equal(comparisonChangeLabel({ kind: "deletion" }, "snapshot"), "Ajout");
  assert.deepEqual(["addition", "deletion", "replacement", "move"].map((kind) => comparisonChangeLabel({ kind })), ["Ajout", "Suppression", "Remplacement", "Déplacement"]);
  assert.deepEqual(["replacement", "move"].map((kind) => comparisonChangeLabel({ kind }, "snapshot")), ["Remplacement", "Déplacement"]);
});

test("snapshot : un déplacement garde la même grammaire — accent (jamais rouge/vert), même numéro", () => {
  const { before, after } = snapshot([change({ kind: "move", oldText: "Alpha", newText: "Alpha", rightEnd: 8 })]);
  assert.ok(marks(before)[0].class.includes("cm-comparison-move-origin"));
  assert.ok(marks(after)[0].class.includes("cm-comparison-move-destination"));
  assert.equal(marks(before)[0].class.includes("cm-comparison-gone"), false);
  assert.equal(marks(after)[0].class.includes("cm-comparison-arrived"), false);
  // leftStart(3) === rightStart(3) → brut "down", inversé en snapshot → "up".
  assert.equal(labels(after)[0].text, "Déplacé 1 ↑");
});

/* ---- Décision : toujours à l'APRÈS ------------------------------------- */

test("plan : la décision n'apparaît que sur le changement sélectionné, TOUJOURS à l'après", () => {
  assert.equal([...review([change()]).before, ...review([change()]).after].some((item) => item.type === "actions"), false);
  const added = review([change({ kind: "addition", leftEnd: 3, oldText: "", newText: "petit " })], { activeIndex: 0 });
  assert.equal(added.after.find((item) => item.type === "actions").at, 8);
  assert.equal(added.before.some((item) => item.type === "actions"), false);
  // Suppression : le texte réel est à l'avant, mais l'action reste à l'après,
  // juste après le placeholder « […] » — jamais posée dans un document en
  // lecture seule (c'est exactement le bug corrigé pour Snapshot).
  const removed = review([change({ kind: "deletion", rightEnd: 3, oldText: "chat", newText: "" })], { activeIndex: 0 });
  assert.equal(removed.before.some((item) => item.type === "actions"), false);
  assert.equal(removed.after.find((item) => item.type === "actions").at, 3);
});

test("snapshot : la décision reste à l'après — le vrai fichier, jamais le snapshot en lecture seule", () => {
  // Suppression visuelle (ajout côté moteur) : le texte réel (gone) est à
  // l'AVANT (snapshot), mais l'action doit rester à l'APRÈS (fichier réel).
  const removed = snapshot([change({ kind: "addition", leftEnd: 3, oldText: "", newText: "un passage retiré " })], { activeIndex: 0 });
  assert.equal(removed.before.some((item) => item.type === "actions"), false, "jamais dans le document en lecture seule");
  assert.ok(removed.after.find((item) => item.type === "actions"), "toujours dans le vrai fichier, éditable");
});

test("plan : pour un déplacement, le cartouche affiche « Déplacé ↑/↓ », jamais Ajout ni Suppression", () => {
  const actions = review([change({ kind: "move", oldText: "Alpha", newText: "Alpha", rightEnd: 8 })], { activeIndex: 0 }).after.find((item) => item.type === "actions");
  assert.equal(actions.label, "Déplacé 1 ↓");
});

test("plan : Relecture propose Appliquer/Ignorer, Snapshot propose Restaurer, jamais les deux", () => {
  assert.deepEqual(review([change()], { activeIndex: 0 }).after.find((item) => item.type === "actions").buttons.map((button) => button.text), ["Appliquer", "Ignorer"]);
  const manual = review([change({ applicable: false })], { activeIndex: 0 }).after.find((item) => item.type === "actions");
  assert.deepEqual(manual.buttons.map((button) => button.action), ["ignore"]);
  assert.ok(manual.hint, "un changement non applicable l'explique plutôt que de proposer un bouton qui mentirait");
  assert.deepEqual(review([change({ handled: true })], { activeIndex: 0 }).after.find((item) => item.type === "actions").buttons, []);
  assert.deepEqual(snapshot([change()], { activeIndex: 0 }).after.find((item) => item.type === "actions").buttons.map((button) => button.action), ["restore"]);
  assert.deepEqual(snapshot([change()], { activeIndex: 0, allowRestore: false }).after.find((item) => item.type === "actions").buttons, []);
});

test("plan : une note suit la colonne du document comparé", () => {
  assert.deepEqual(review([], { notes: [{ index: 2, start: 1, end: 5 }] }).after.map((item) => [item.role, item.index]), [["note", 2]]);
  assert.deepEqual(snapshot([], { notes: [{ index: 2, start: 1, end: 5 }] }).before.map((item) => item.role), ["note"]);
  assert.deepEqual(review([], { notes: [{ index: 3, start: 4, end: 4 }] }).after, [], "une ancre vide n'invente rien");
});

test("plan : un changement traité et un changement actif se distinguent visuellement", () => {
  const [handled] = review([change({ handled: true })]).before;
  assert.ok(handled.class.includes("is-handled") && !handled.class.includes("is-active"));
  const [active] = review([change()], { activeIndex: 0 }).before;
  assert.ok(active.class.includes("is-active"));
});

test("plan : un passage remanié par l'auteur n'est marqué que là où il est situé", () => {
  // Relecture : sans coordonnées côté auteur, rien n'est peint à gauche —
  // jamais une position devinée, jamais un placeholder inventé sans point d'ancrage.
  const { before, after } = review([change({ leftStart: undefined, leftEnd: undefined })], { activeIndex: 0 });
  assert.deepEqual(before, []);
  assert.deepEqual(shape(after), ["mark:cm-comparison-arrived", "actions:"]);
});

test("plan : le frontmatter décale les positions sans jamais en inventer hors texte", () => {
  const decorations = [{ type: "mark", from: 0, to: 4, class: "x", role: "change", index: 0 }, { type: "label", at: 10, side: 1, class: "l", text: "z", index: 1 }];
  assert.deepEqual(shiftComparisonDecorations(decorations, 6, 20).map((item) => item.from ?? item.at), [6, 16]);
  assert.deepEqual(shiftComparisonDecorations(decorations, 6, 12), [{ type: "mark", from: 6, to: 10, class: "x", role: "change", index: 0 }]);
  assert.deepEqual(shiftComparisonDecorations([{ type: "mark", from: 4, to: 4, class: "x", role: "change", index: 0 }], 0, 20), []);
});
