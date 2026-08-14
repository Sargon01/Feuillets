import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  FakeWorkspace, allElements, barButtons, barOf, classesOf, clickDecoration, columns,
  decorationsOf, doubleClickDecoration, hasScrollListener, marksOf, pressEscape, readOnlyOf,
  revealOf, settle, until, viewFor, widgetsOf, wireVaultEvents,
} from "./helpers/comparison-harness.js";
import { ComparisonSession, openFeuilletsComparison } from "../src/views/comparison-view.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { receiveNativeReviewReturnForAuthor } from "../src/services/native-review-author-return.js";
import { reviewerReviewSessionsRootPath, reviewSessionPaths, nativeReviewLocationFromRoot } from "../src/services/native-review-storage.js";

/**
 * La comparaison ne rend JAMAIS le texte : Obsidian rend les deux côtés dans
 * de vraies vues Markdown. Ces tests n'observent donc jamais du HTML
 * reconstruit — ils observent les décorations posées sur les deux éditeurs, et
 * vérifient que les fichiers, eux, ne bougent pas.
 *
 * Grammaire UNIVERSELLE, strictement la même en Snapshot et en Relecture :
 *     GAUCHE = AVANT   DROITE = APRÈS
 *     rouge barré + « […] » = parti/supprimé   « [+] » + vert = arrivé/ajouté
 *     rouge → vert = remplacé
 *     ligne pointillée + « Déplacé N ↑/↓ » = couper/coller
 * `workspace.leaves` reflète l'ordre visuel : [0] est la colonne gauche.
 */

const gone = (cm) => marksOf(cm).filter((range) => range.class.includes("cm-comparison-gone"));
const arrived = (cm) => marksOf(cm).filter((range) => range.class.includes("cm-comparison-arrived"));
const placeholdersOf = (cm) => widgetsOf(cm).filter((range) => range.widget.className?.includes("cm-comparison-placeholder"));
const moveDashesOf = (cm) => widgetsOf(cm).filter((range) => range.widget.className?.includes("cm-comparison-move-dashes"));
const movedLabelsOf = (cm) => widgetsOf(cm).filter((range) => range.widget.className?.startsWith("cm-comparison-move-label"));
const actionsOf = (cm) => widgetsOf(cm).find((range) => range.widget.spec?.type === "actions");
const modeButtons = (bar) => allElements(bar).filter((el) => el.classes.has("feuillets-comparison-mode-button"));
const modeButton = (bar, label) => modeButtons(bar).find((el) => el.text === label);
const stepButton = (bar, ariaLabel) => allElements(bar).find((el) => el.tag === "button" && el.getAttribute("aria-label") === ariaLabel);
const linkedScrollButton = (bar) => allElements(bar).find((el) => el.classes.has("feuillets-comparison-scroll-link"));
const click = (el) => el.events.get("click")({ stopPropagation() {} });

/** Espion posé sur le plugin factice : capture les titres d'onglet demandés
 * pour la colonne comparée, sans jamais toucher au vrai nom du fichier. */
function titleSpy() {
  const titles = new Map();
  const calls = [];
  return { titles, calls, setComparisonDisplayTitle: (path, title) => { calls.push([path, title]); if (title) titles.set(path, title); else titles.delete(path); } };
}

/* ---- Snapshots -------------------------------------------------------- */

async function openSnapshot({ current, snapshot, allowRestore = true, settings = {}, snapshotName = "2026-01-01 10h00m00s" }) {
  const root = new TFolder("Projet");
  const file = new TFile("Projet/scene.md", current);
  const snapshotFolder = new TFolder("Projet/Snapshots/scene");
  const snapshotFile = new TFile(`Projet/Snapshots/scene/${snapshotName}.md`, snapshot);
  snapshotFolder.children = [snapshotFile]; snapshotFile.parent = snapshotFolder;
  root.children = [file, new TFolder("Projet/Snapshots")]; file.parent = root;
  const { vault } = createFakeVault([root, file, snapshotFolder, snapshotFile]);
  wireVaultEvents(vault);
  const workspace = new FakeWorkspace();
  const app = { vault, workspace, fileManager: { trashFile: async () => {} } };
  const spy = titleSpy();
  const plugin = { app, settings, getProjectFolder: () => root, ...spy };
  const session = await openFeuilletsComparison(app, plugin, { kind: "snapshot", sourcePath: file.path, snapshotPath: snapshotFile.path, allowRestore });
  await settle();
  // Snapshot : le snapshot est l'AVANT (gauche), le vrai fichier l'APRÈS.
  const [beforeView, afterView] = columns(workspace);
  return { session, app, vault, workspace, file, snapshotFile, before: beforeView.cm, after: afterView.cm, beforeView, afterView, titles: spy.titles, titleCalls: spy.calls };
}

test("comparaison : les DEUX côtés sont de vraies vues Markdown d'Obsidian, jamais un rendu Feuillets", async () => {
  const { workspace, file, snapshotFile, session } = await openSnapshot({ current: "Le chat dort sur le tapis rouge.", snapshot: "Le chien dort sur le tapis rouge." });
  const views = columns(workspace);
  assert.equal(views.length, 2, "deux feuilles, pas une colonne maison");
  for (const view of views) assert.ok(view instanceof MarkdownView, "chaque côté est rendu par Obsidian lui-même");
  // Le sens de lecture prime sur la place du fichier : pour un snapshot, le
  // vrai fichier passe à DROITE parce qu'il est l'état « après ».
  assert.deepEqual(views.map((view) => view.file.path), [snapshotFile.path, file.path]);
  assert.equal(session.sourcePath, file.path, "le vrai feuillet reste le vrai feuillet");
  assert.equal(session.comparedPath, snapshotFile.path, "un snapshot est déjà un vrai fichier : aucune copie");
  await session.close();
});

test("comparaison : le document comparé est verrouillé en lecture seule, le vrai feuillet jamais", async () => {
  const { before, after, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  assert.equal(readOnlyOf(before), true, "le snapshot se regarde, ne s'écrit pas");
  assert.equal(readOnlyOf(after), undefined, "le vrai fichier reste éditable, même à droite");
  await session.close();
  assert.equal(readOnlyOf(before), false, "le verrou ne survit jamais à la comparaison");
});

test("comparaison : le diff n'écrit rien — les deux textes restent exactement ce qu'ils étaient", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { vault, file, snapshotFile, before, after, session } = await openSnapshot({ current, snapshot });
  assert.ok(decorationsOf(before).length > 0 && decorationsOf(after).length > 0, "les deux côtés portent bien des décorations");
  assert.equal(await vault.read(file), current);
  assert.equal(await vault.read(snapshotFile), snapshot);
  await session.close();
});

test("comparaison : aucune cale d'alignement, nulle part", async () => {
  const current = "Alpha.\n\nUn paragraphe entier ajouté depuis, plutôt long.\n\nOmega.";
  const snapshot = "Alpha.\n\nOmega.";
  const { before, after, session } = await openSnapshot({ current, snapshot });
  for (const cm of [before, after]) {
    assert.equal(decorationsOf(cm).some((range) => range.block || range.widget?.height !== undefined), false, "les deux textes se déroulent naturellement");
  }
  await session.close();
});

/* ---- Grammaire visuelle universelle : suppression / ajout / remplacement */

test("suppression : rouge barré à gauche, « […] » rouge à droite — jamais un vide", async () => {
  const removed = "Un paragraphe entier, assez long pour qu il compte vraiment dans la lecture du diff. ";
  const current = "Debut. Fin.";
  const snapshot = `Debut. ${removed}Fin.`;
  const { before, after, session } = await openSnapshot({ current, snapshot });
  assert.equal(snapshot.slice(gone(before)[0].from, gone(before)[0].to), removed, "le passage disparu se lit en entier, rouge barré");
  const placeholder = placeholdersOf(after)[0];
  assert.equal(placeholder.widget.text, "[…]", "un repère cliquable remplace le vide, jamais un fantôme du texte");
  assert.ok(placeholder.widget.className.includes("cm-comparison-tone-gone"));
  await session.close();
});

test("ajout : « [+] » vert à gauche, vert à droite — jamais un vide", async () => {
  const current = "Le petit chat dort."; const snapshot = "Le chat dort.";
  const { before, after, session } = await openSnapshot({ current, snapshot });
  assert.equal(current.slice(arrived(after)[0].from, arrived(after)[0].to), "petit ", "ajouté depuis ce snapshot");
  const placeholder = placeholdersOf(before)[0];
  assert.equal(placeholder.widget.text, "[+]");
  assert.ok(placeholder.widget.className.includes("cm-comparison-tone-arrived"));
  await session.close();
});

test("remplacement : ancien rouge à gauche, nouveau vert à droite — jamais de placeholder en plus", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { before, after, session } = await openSnapshot({ current, snapshot });
  assert.equal(snapshot.slice(gone(before)[0].from, gone(before)[0].to), "chien");
  assert.equal(arrived(before).length, 0, "jamais l'ancien ET le nouveau du même côté");
  assert.equal(current.slice(arrived(after)[0].from, arrived(after)[0].to), "chat");
  assert.equal(gone(after).length, 0);
  assert.deepEqual([...placeholdersOf(before), ...placeholdersOf(after)], []);
  await session.close();
});

/* Fixture validée empiriquement : un déplacement propre nécessite un texte
   déplacé et un contenu inchangé qui reste son même voisin des deux côtés. */
const MOVE_LEFT = "Alpha reste ici tranquille. Il prit son manteau et sortit de la piece rapidement. Beta arrive ensuite doucement.";
const MOVE_RIGHT = "Il prit son manteau et sortit de la piece rapidement. Alpha reste ici tranquille. Beta arrive ensuite doucement.";
const MOVED_TEXT = "Alpha reste ici tranquille. ";

test("déplacement : jamais présenté comme une suppression + un ajout — texte accentué, ligne pointillée + Déplacé N", async () => {
  const { before, after, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
  const origin = marksOf(before).find((range) => range.class.includes("move-origin"));
  assert.equal(MOVE_RIGHT.slice(origin.from, origin.to), MOVED_TEXT, "le texte déplacé reste entièrement visible à sa source");
  assert.equal(origin.class.includes("cm-comparison-gone"), false, "jamais peint comme une suppression");
  const destination = marksOf(after).find((range) => range.class.includes("move-destination"));
  assert.equal(MOVE_LEFT.slice(destination.from, destination.to), MOVED_TEXT, "et entièrement visible à sa destination");
  assert.equal(destination.class.includes("cm-comparison-arrived"), false, "jamais peint comme un ajout");
  assert.deepEqual(moveDashesOf(before).map((range) => range.widget.text), ["↑ - - - - - - - - - -"], "snapshot : le sens brut s'inverse — le passage est remonté depuis le snapshot");
  assert.deepEqual(movedLabelsOf(after).map((range) => range.widget.text), ["Déplacé 1 ↑"]);
  assert.equal(origin.attributes["data-comparison-change"], destination.attributes["data-comparison-change"], "un seul changement, une seule décision");
  await session.close();
});

test("déplacements multiples : deux couples distincts, numérotés de façon stable", async () => {
  const A1 = "Alpha reste ici tranquille. ";
  const B1 = "Il prit son manteau et sortit de la piece rapidement. ";
  const MID = "Beta arrive ensuite doucement. Gamma referme la fenetre sans bruit. ";
  const A2 = "Delta hesite un long moment. ";
  const B2 = "Epsilon descendit lentement les marches usees du perron. ";
  const current = `${A1}${B1}${MID}${A2}${B2}Zeta conclut la scene tranquillement.`;
  const snapshot = `${B1}${A1}${MID}${B2}${A2}Zeta conclut la scene tranquillement.`;
  const { before, after, session } = await openSnapshot({ current, snapshot });
  const origins = marksOf(before).filter((range) => range.class.includes("move-origin"));
  const destinations = marksOf(after).filter((range) => range.class.includes("move-destination"));
  assert.equal(origins.length, 2); assert.equal(destinations.length, 2);
  assert.deepEqual(origins.map((range) => snapshot.slice(range.from, range.to)).sort(), [A1, A2].sort());
  assert.deepEqual(destinations.map((range) => current.slice(range.from, range.to)).sort(), [A1, A2].sort());
  assert.deepEqual(origins.map((range) => range.attributes["data-comparison-change"]).sort(), destinations.map((range) => range.attributes["data-comparison-change"]).sort());
  assert.deepEqual(movedLabelsOf(after).map((range) => range.widget.text).sort(), ["Déplacé 1 ↑", "Déplacé 2 ↑"]);
  await session.close();
});

test("déplacement : cliquer un côté met les deux en évidence et propose l'unique décision — jamais Ajout ni Suppression", async () => {
  const { before, after, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
  const handled = clickDecoration(after, { "data-comparison-change": "0" });
  assert.equal(handled, false, "un clic sur une marque reste un clic normal dans l'éditeur");
  await settle(4);
  assert.ok(marksOf(before).some((range) => range.class.includes("move-origin") && range.class.includes("is-active")), "l'ancien emplacement s'allume");
  assert.ok(marksOf(after).some((range) => range.class.includes("move-destination") && range.class.includes("is-active")), "le nouveau aussi");
  const actions = actionsOf(after);
  assert.ok(actions, "l'action vit à l'endroit exact du changement, toujours à l'après");
  assert.deepEqual(actions.widget.spec.buttons.map((button) => button.text), ["Restaurer ce passage"]);
  assert.equal(actions.widget.spec.label, "Déplacé 1 ↑", "jamais « Ajout » ni « Suppression » pour un déplacement");
  await session.close();
});

/* ---- Correction du bug : Restaurer vit toujours dans le vrai fichier ---- */

test("BUG CORRIGÉ — snapshot, suppression visuelle : Restaurer vit dans le vrai fichier, jamais dans le snapshot verrouillé", async () => {
  // Avant la correction, le cartouche d'une suppression visuelle (texte
  // retiré depuis le snapshot) se posait côté AVANT — ici le snapshot,
  // lecture seule — parce que c'est ce côté qui porte le texte réel. La
  // règle est maintenant : le cartouche vit TOUJOURS à l'après, quel que
  // soit le côté qui porte le texte.
  const removed = "Un paragraphe entier retiré depuis le snapshot, assez long pour compter. ";
  const current = "Debut. Fin.";
  const snapshot = `Debut. ${removed}Fin.`;
  const { vault, file, snapshotFile, before, after, session } = await openSnapshot({ current, snapshot });
  assert.equal(snapshot.slice(gone(before)[0].from, gone(before)[0].to), removed);
  assert.equal(placeholdersOf(after)[0].widget.text, "[…]");

  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after), "le cartouche vit dans le vrai fichier, éditable");
  assert.equal(actionsOf(before), undefined, "jamais posé dans le document en lecture seule");
  assert.deepEqual(actionsOf(after).widget.spec.buttons.map((button) => button.text), ["Restaurer ce passage"]);

  assert.equal(clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "restore" }), true);
  assert.ok(await until(() => file.content === snapshot), "1. Restaurer écrit dans le vrai fichier, à droite");
  assert.equal(await vault.read(snapshotFile), snapshot, "2. le snapshot, à gauche, reste inchangé");
  assert.equal(marksOf(before).length, 0, "3. le diff est recalculé : le changement restauré disparaît");
  await session.close();
});

test("snapshot : Restaurer ce passage n'écrit que ce passage, dans le vrai fichier — même à droite", async () => {
  const { vault, file, snapshotFile, before, after, session } = await openSnapshot({ current: "Le chat dort sur le tapis rouge.", snapshot: "Le chien dort sur le tapis rouge." });
  clickDecoration(before, { "data-comparison-change": "0" });
  await settle(4);
  assert.equal(clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "restore" }), true);
  assert.ok(await until(() => file.content === "Le chien dort sur le tapis rouge."));
  assert.equal(await vault.read(snapshotFile), "Le chien dort sur le tapis rouge.", "le snapshot n'est jamais réécrit");
  assert.equal(marksOf(before).length, 0, "la différence traitée disparaît");
  await session.close();
});

test("snapshot : allowRestore=false laisse lire et naviguer, jamais restaurer", async () => {
  const { file, before, after, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort.", allowRestore: false });
  clickDecoration(before, { "data-comparison-change": "0" });
  await settle(4);
  const actions = actionsOf(after);
  assert.ok(actions, "la différence reste lisible et sélectionnable");
  assert.deepEqual(actions.widget.spec.buttons, [], "mais aucune décision n'est proposée");
  clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "restore" });
  await settle(4);
  assert.equal(file.content, "Le chat dort.", "rien n'est écrit");
  await session.close();
});

test("snapshot : le bandeau énonce SNAPSHOT → VERSION ACTUELLE, jamais une flèche ambiguë", async () => {
  const { workspace, snapshotFile, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  const bar = barOf(workspace, snapshotFile.path);
  assert.ok(bar, "le bandeau vit sur la feuille du document comparé, jamais sur celle qu'on édite");
  const labels = bar.children[0].children.map((child) => child.text);
  assert.ok(labels[0].startsWith("Snapshot — "));
  assert.equal(labels[1], "Lecture seule");
  assert.equal(labels[2], "→", "jamais « ↔ », jamais de flèche inversée");
  assert.equal(labels[3], "Version actuelle");
  assert.equal(labels.includes("Original"), false);
  await session.close();
});

test("comparaison : à la fermeture, plus une seule décoration, plus un seul verrou, plus une seule classe, plus aucun écouteur", async () => {
  const { before, after, workspace, file, snapshotFile, beforeView, afterView, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
  const host = viewFor(workspace, snapshotFile.path).containerEl;
  assert.ok(host.classes.has("feuillets-comparison-host"));
  await session.close();
  assert.deepEqual(decorationsOf(before), []);
  assert.deepEqual(decorationsOf(after), [], "le feuillet redevient exactement ce qu'il était");
  assert.equal(readOnlyOf(before), false);
  assert.equal(host.classes.has("feuillets-comparison-host"), false);
  assert.equal(host.children.length, 0, "le bandeau part avec la comparaison");
  assert.equal(hasScrollListener(beforeView), false, "aucun écouteur de défilement résiduel");
  assert.equal(hasScrollListener(afterView), false);
  assert.equal(file.content, MOVE_LEFT, "le Markdown n'a jamais été touché");
  assert.equal(ComparisonSession.current, null);
});

/* ---- Titres nettoyés ---------------------------------------------------- */

test("snapshot : le titre d'onglet remplace l'horodatage technique par une date lisible, jamais un renommage du fichier", async () => {
  const { vault, snapshotFile, titles, titleCalls, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort.", snapshotName: "2026-08-14 11h01m09s" });
  assert.equal(titles.get(snapshotFile.path), "Snapshot — 14 août 2026 à 11 h 01");
  assert.equal(snapshotFile.path.includes("2026-08-14 11h01m09s"), true, "le fichier réel garde son vrai nom, jamais renommé");
  await session.close();
  assert.deepEqual(titleCalls.at(-1), [snapshotFile.path, null], "le titre est effacé à la fermeture");
  assert.equal(await vault.read(snapshotFile), "Le chien dort.", "et le contenu n'a évidemment pas bougé non plus");
});

/* ---- Relecture : même convention, l'auteur est l'AVANT ---------------- */

const at = "2026-08-14T10:00:00.000Z";
const people = [{ id: "a", name: "HY", role: "author" }, { id: "b", name: "Pierre", role: "reviewer" }];
const BASE = "Un deux trois quatre cinq six sept huit neuf dix.";
const RETURNED = "UN deux trois quatre cinq six sept huit neuf DIX.";

async function openReview({ current, returned, base, threads = [], settings = {} }) {
  const root = new TFolder("Roman/Manuscrit");
  const file = new TFile("Roman/Manuscrit/Un.md", current);
  root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file]);
  wireVaultEvents(vault);
  const workspace = new FakeWorkspace();
  const app = { vault, workspace, fileManager: { trashFile: async () => {} } };
  const doc = { documentId: "one", originalPath: "Un.md", title: "Un", baseMarkdown: base };
  const make = async (senderRole, packageId, workingMarkdown) => createNativeReviewPackage({ packageId, createdAt: at, createdByVersion: "2", reviewId: "r", round: 1, senderRole, participants: people }, [{ ...doc, workingMarkdown }], senderRole === "reviewer" ? threads : []);
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "author", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath: "Un.md", title: "Un", localSourcePath: file.path }], rounds: [{ round: 1, createdAt: at, sent: { packageId: "sent", at } }] });
  await vault.createBinary(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`, (await make("author", "sent", base)).buffer);
  await receiveNativeReviewReturnForAuthor(app, "r", await make("reviewer", "returned", returned));

  const sessionsRootPath = reviewerReviewSessionsRootPath();
  const spy = titleSpy();
  const plugin = { app, settings: { projectFolder: root.path, ...settings }, getProjectFolder: () => root, ...spy };
  const session = await openFeuilletsComparison(app, plugin, { kind: "native-review", sourcePath: file.path, reviewId: "r", sessionsRootPath, documentId: "one" });
  await settle();
  const comparedPath = `${reviewSessionPaths(nativeReviewLocationFromRoot(sessionsRootPath), "r").comparisonRoot}/one.md`;
  // Relecture : le texte de l'auteur est l'AVANT (gauche), la proposition l'APRÈS.
  const [beforeView, afterView] = columns(workspace);
  return { session, app, vault, workspace, file, comparedPath, before: beforeView.cm, after: afterView.cm, beforeView, afterView, titles: spy.titles, titleCalls: spy.calls };
}

test("relecture : gauche = votre texte, droite = la proposition du relecteur", async () => {
  const { workspace, file, comparedPath, vault, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  assert.deepEqual(columns(workspace).map((view) => view.file.path), [file.path, comparedPath], "l'auteur est l'avant, la proposition l'après");
  const document = vault.getAbstractFileByPath(comparedPath);
  assert.ok(document instanceof TFile, "Obsidian a besoin d'un vrai fichier pour son vrai éditeur");
  assert.equal(document.path, "_Feuillets/Relectures/r/comparison/one.md");
  assert.equal(document.path.startsWith("Roman/Manuscrit"), false, "il n'appartient pas au Manuscrit");
  assert.equal(await vault.read(document), RETURNED, "exactement la version reçue, aucun marqueur technique ajouté");
  assert.equal(readOnlyOf(after), true);
  await session.close();
});

test("relecture : le titre d'onglet du document comparé est déjà propre — « Version de Pierre »", async () => {
  const { comparedPath, titles, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  assert.equal(titles.get(comparedPath), "Version de Pierre");
  await session.close();
});

test("relecture : rouge barré à gauche = ce que le relecteur retire, vert à droite = ce qu'il propose", async () => {
  const middle = "Anna traverse la piece et ouvre la fenetre en grand pour aerer. ";
  const removed = "Une phrase entiere que le relecteur propose de retirer. ";
  const current = `Le chat dort. ${middle}${removed}Fin de la scene.`;
  const returned = `Le chien dort. ${middle}Fin de la scene.`;
  const { before, after, session } = await openReview({ current, returned, base: current });
  const texts = gone(before).map((range) => current.slice(range.from, range.to));
  assert.ok(texts.some((text) => text.startsWith("chat")), "proposé au retrait : rouge barré chez l'auteur");
  assert.ok(texts.includes(removed), "une suppression proposée reste lisible en entier");
  assert.ok(arrived(after).some((range) => returned.slice(range.from, range.to).startsWith("chien")), "proposé : vert dans la version du relecteur");
  assert.equal(arrived(before).length, 0, "rien de vert du côté avant");
  assert.equal(gone(after).length, 0, "rien de rouge du côté après");
  assert.equal(placeholdersOf(after).some((range) => range.widget.text === "[…]"), true, "la suppression proposée porte son repère, jamais un vide");
  await session.close();
});

test("relecture : un déplacement proposé est accentué (jamais rouge/vert), même identifiant", async () => {
  const { before, after, session } = await openReview({ current: MOVE_LEFT, returned: MOVE_RIGHT, base: MOVE_LEFT });
  const origin = marksOf(before).find((range) => range.class.includes("move-origin"));
  const destination = marksOf(after).find((range) => range.class.includes("move-destination"));
  assert.equal(MOVE_LEFT.slice(origin.from, origin.to), MOVED_TEXT);
  assert.equal(MOVE_RIGHT.slice(destination.from, destination.to), MOVED_TEXT);
  assert.equal(origin.class.includes("cm-comparison-gone"), false);
  assert.equal(destination.class.includes("cm-comparison-arrived"), false);
  assert.deepEqual(moveDashesOf(before).map((range) => range.widget.text), ["- - - - - - - - - - ↓"]);
  assert.deepEqual(movedLabelsOf(after).map((range) => range.widget.text), ["Déplacé 1 ↓"]);
  clickDecoration(after, { "data-comparison-change": String(destination.attributes["data-comparison-change"]) });
  await settle(4);
  const actions = actionsOf(after);
  assert.deepEqual(actions.widget.spec.buttons.map((button) => button.text), ["Appliquer", "Ignorer"]);
  assert.equal(actions.widget.spec.label, "Déplacé 1 ↓", "jamais « Ajout » ni « Suppression », sans workflow séparé");
  await session.close();
});

test("relecture : cliquer un changement propose Appliquer et Ignorer sur place", async () => {
  const { before, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  assert.equal(marksOf(after).length, 2, "les deux propositions sont situées à droite");
  assert.equal(actionsOf(after), undefined, "aucune action tant qu'aucun changement n'est choisi");
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.deepEqual(actionsOf(after).widget.spec.buttons.map((button) => button.text), ["Appliquer", "Ignorer"]);
  assert.ok(classesOf(before).some((name) => name.includes("is-active")), "le passage correspondant s'allume chez l'auteur");
  await session.close();
});

test("relecture : Appliquer n'écrit que le manuscrit et enchaîne sur le changement suivant", async () => {
  const { vault, file, comparedPath, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.equal(clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "apply" }), true);
  assert.ok(await until(() => classesOf(after).some((name) => name.includes("is-handled"))), "le changement traité reste visible, marqué");
  assert.equal(file.content, "UN deux trois quatre cinq six sept huit neuf dix.");
  assert.equal(await vault.read(vault.getAbstractFileByPath(comparedPath)), RETURNED, "le document comparé n'est jamais réécrit par une décision");
  assert.ok(classesOf(after).some((name) => name.includes("is-active") && !name.includes("is-handled")), "le suivant est sélectionné automatiquement");
  await session.close();
});

test("relecture : Ignorer ne touche jamais le manuscrit", async () => {
  const { file, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "ignore" });
  assert.ok(await until(() => classesOf(after).some((name) => name.includes("is-handled"))));
  assert.equal(file.content, BASE);
  await session.close();
});

test("relecture : une note s'ouvre en petit menu, texte puis Traité, sans fil de discussion", async () => {
  const note = {
    threadId: `thread-${"a".repeat(32)}`, documentId: "one", anchor: { start: 8, end: 13, quote: "trois", prefix: "UN deux ", suffix: " quatre" },
    createdByParticipantId: "b", createdAt: at, status: "open",
    messages: [{ messageId: `message-${"a".repeat(32)}`, participantId: "b", text: "À revoir", createdAt: at }],
  };
  const { after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE, threads: [note] });
  const marker = marksOf(after).find((range) => range.class.includes("cm-comparison-note"));
  assert.ok(marker, "la note est visible sur son passage, dans le vrai éditeur");
  clickDecoration(after, { "data-comparison-note": String(marker.attributes["data-comparison-note"]) });
  const titles = Menu.lastShown.items.filter((item) => !item.separator).map((item) => item.title);
  assert.deepEqual(titles, ["Pierre : À revoir", "Traité"]);
  assert.equal(titles.some((title) => /Répondre|Rouvrir/.test(title)), false);
  await session.close();
});

test("relecture : le bandeau énonce VOTRE TEXTE → VERSION DE PIERRE, et reste secondaire", async () => {
  const { workspace, comparedPath, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  const bar = barOf(workspace, comparedPath);
  const labels = barButtons(bar).map((button) => button.text);
  assert.deepEqual(labels, ["Changements", "Versions", "Terminer la relecture"]);
  assert.equal(labels.includes("Appliquer"), false, "on agit en cliquant la différence, pas dans une barre");
  const titles = bar.children[0].children.map((child) => child.text);
  assert.deepEqual(titles.slice(0, 4), ["Votre texte", "→", "Version de Pierre", "Lecture seule"]);
  await session.close();
});

test("comparaison : ouvrir une seconde comparaison referme proprement la première", async () => {
  const first = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  const second = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  assert.deepEqual(decorationsOf(first.before), [], "aucune décoration ne survit à la comparaison précédente");
  assert.deepEqual(decorationsOf(first.after), []);
  assert.equal(readOnlyOf(first.before), false, "et plus aucun verrou");
  assert.equal(ComparisonSession.current, second.session);
  await second.session.close();
});

test("comparaison : si une des deux feuilles part ailleurs, la comparaison se referme d'elle-même", async () => {
  const { workspace, before, after, snapshotFile, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  workspace.leaves.find((leaf) => leaf.view?.file?.path === snapshotFile.path).view = null;
  workspace.emit("layout-change");
  assert.ok(await until(() => ComparisonSession.current === null));
  assert.deepEqual(decorationsOf(before), []);
  assert.deepEqual(decorationsOf(after), []);
  assert.equal(session.comparedPath, snapshotFile.path);
});

/* ---- Simple clic vs double-clic ----------------------------------------
   Simple clic : sélectionne, ouvre le cartouche — jamais de recentrage
   forcé. Double-clic : recentre explicitement, indépendamment des deux
   côtés — le chemin direct annoncé en plus de Précédent/Suivant. */

test("simple clic : sélectionne et ouvre le cartouche, ne recentre JAMAIS", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { before, after, beforeView, afterView, session } = await openSnapshot({ current, snapshot });
  assert.equal(revealOf(beforeView), null); assert.equal(revealOf(afterView), null);
  clickDecoration(before, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(gone(before)[0].class.includes("is-active"), "le changement est sélectionné");
  assert.ok(actionsOf(after), "le cartouche s'ouvre, toujours à l'après");
  assert.equal(revealOf(beforeView), null, "aucun recentrage déclenché par le simple clic");
  assert.equal(revealOf(afterView), null);
  await session.close();
});

test("double-clic : recentre les deux vues indépendamment, pour ajout, suppression, remplacement et déplacement", async () => {
  // Ajout.
  {
    const { beforeView, afterView, after, session } = await openSnapshot({ current: "Le petit chat dort.", snapshot: "Le chat dort." });
    doubleClickDecoration(after, { "data-comparison-change": "0" });
    await settle(4);
    const onSnapshot = revealOf(beforeView); const onCurrent = revealOf(afterView);
    assert.ok(onSnapshot, "le côté snapshot se recentre aussi, là où l'ajout n'existe pas");
    assert.equal(onSnapshot.from.offset, onSnapshot.to.offset, "rien à sélectionner : seulement un point de repère");
    assert.equal(onSnapshot.center, true, "centré dans SON propre viewport");
    assert.ok(onCurrent.to.offset > onCurrent.from.offset, "la plage réelle du texte ajouté");
    await session.close();
  }
  // Suppression.
  {
    const removed = "Un paragraphe entier, assez long pour compter vraiment dans la lecture du diff. ";
    const current = "Debut. Fin."; const snapshot = `Debut. ${removed}Fin.`;
    const { beforeView, afterView, before, session } = await openSnapshot({ current, snapshot });
    doubleClickDecoration(before, { "data-comparison-change": "0" });
    await settle(4);
    const onSnapshot = revealOf(beforeView); const onCurrent = revealOf(afterView);
    assert.ok(onSnapshot.to.offset > onSnapshot.from.offset, "le texte supprimé, réellement sélectionné côté snapshot");
    assert.equal(onCurrent.from.offset, onCurrent.to.offset, "côté version actuelle : seulement la position où il a disparu");
    await session.close();
  }
  // Remplacement.
  {
    const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
    const { beforeView, afterView, before, session } = await openSnapshot({ current, snapshot });
    doubleClickDecoration(before, { "data-comparison-change": "0" });
    await settle(4);
    const onSnapshot = revealOf(beforeView); const onCurrent = revealOf(afterView);
    assert.equal(snapshot.slice(onSnapshot.from.offset, onSnapshot.to.offset), "chien");
    assert.equal(current.slice(onCurrent.from.offset, onCurrent.to.offset), "chat");
    await session.close();
  }
  // Déplacement.
  {
    const { beforeView, afterView, before, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
    doubleClickDecoration(before, { "data-comparison-change": "0" });
    await settle(4);
    const onBefore = revealOf(beforeView); const onAfter = revealOf(afterView);
    assert.equal(MOVE_RIGHT.slice(onBefore.from.offset, onBefore.to.offset), MOVED_TEXT);
    assert.equal(MOVE_LEFT.slice(onAfter.from.offset, onAfter.to.offset), MOVED_TEXT);
    await session.close();
  }
});

test("gros déplacement éloigné (plusieurs milliers de caractères) : double-clic sur une extrémité révèle les DEUX", async () => {
  // Même fixture validée que MOVE_LEFT/MOVE_RIGHT, avec un long passage
  // identique inséré entre les deux — jamais touché par le diff, il n'écarte
  // que la distance entre l'ancien et le nouvel emplacement.
  const filler = "Phrase de remplissage tout a fait neutre entre les deux emplacements du deplacement etudie ici. ".repeat(40);
  const farLeft = `${MOVED_TEXT}Il prit son manteau et sortit de la piece rapidement. ${filler}Beta arrive ensuite doucement.`;
  const farRight = `Il prit son manteau et sortit de la piece rapidement. ${filler}${MOVED_TEXT}Beta arrive ensuite doucement.`;
  const { before, beforeView, afterView, session } = await openSnapshot({ current: farLeft, snapshot: farRight });
  const origin = marksOf(before).find((range) => range.class.includes("move-origin"));
  assert.ok(origin.from > 1000, "l'ancien emplacement est loin dans le document — pas un cas dégénéré");
  doubleClickDecoration(before, { "data-comparison-change": String(origin.attributes["data-comparison-change"]) });
  await settle(4);
  const onBefore = revealOf(beforeView); const onAfter = revealOf(afterView);
  assert.equal(farRight.slice(onBefore.from.offset, onBefore.to.offset), MOVED_TEXT, "gauche : l'ancien emplacement, malgré la distance");
  assert.equal(farLeft.slice(onAfter.from.offset, onAfter.to.offset), MOVED_TEXT, "droite : le nouvel emplacement, à SA propre position");
  assert.notEqual(onBefore.from.offset, onAfter.from.offset, "jamais la position de l'un calquée sur celle de l'autre");
  await session.close();
});

test("deux déplacements distincts : double-cliquer chaque libellé numéroté recentre sur SA PROPRE paire, jamais l'autre", async () => {
  const A1 = "Alpha reste ici tranquille. ";
  const B1 = "Il prit son manteau et sortit de la piece rapidement. ";
  const MID = "Beta arrive ensuite doucement. Gamma referme la fenetre sans bruit. ";
  const A2 = "Delta hesite un long moment. ";
  const B2 = "Epsilon descendit lentement les marches usees du perron. ";
  const current = `${A1}${B1}${MID}${A2}${B2}Zeta conclut la scene tranquillement.`;
  const snapshot = `${B1}${A1}${MID}${B2}${A2}Zeta conclut la scene tranquillement.`;
  const { before, afterView, session } = await openSnapshot({ current, snapshot });
  const dashes = moveDashesOf(before);
  assert.equal(dashes.length, 2, "les deux lignes pointillées numérotées implicitement (identifiant partagé)");
  const [first, second] = dashes;

  doubleClickDecoration(before, { "data-comparison-change": String(first.widget.index) });
  await settle(4);
  const onFirst = revealOf(afterView);
  const firstText = current.slice(onFirst.from.offset, onFirst.to.offset);
  assert.ok(firstText === A1 || firstText === A2);

  doubleClickDecoration(before, { "data-comparison-change": String(second.widget.index) });
  await settle(4);
  const onSecond = revealOf(afterView);
  const secondText = current.slice(onSecond.from.offset, onSecond.to.offset);
  assert.ok(secondText === A1 || secondText === A2);
  assert.notEqual(firstText, secondText, "jamais confondue avec l'autre");
  await session.close();
});

test("Précédent / Suivant recentre les deux vues sur le hunk actif", async () => {
  const { workspace, comparedPath, beforeView, afterView, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  const bar = barOf(workspace, comparedPath);
  const next = stepButton(bar, "Suivant ›");
  assert.ok(next, "le chevron Suivant est présent tant qu'il reste des changements, en mode Changements");
  click(next);
  await settle(4);
  assert.ok(revealOf(beforeView), "le côté auteur se recentre");
  assert.ok(revealOf(afterView), "le côté relecteur se recentre");
  await session.close();
});

/* ---- Cartouche fermable : ×, Échap, clic extérieur ---------------------
   Fermer ne décide rien, n'écrit rien, ne marque rien comme traité —
   conserve la comparaison ouverte, un clic ultérieur peut la rouvrir. */

test("cartouche : le bouton × ferme sans décider, sans écrire — la comparaison reste ouverte", async () => {
  const { file, before, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after));
  assert.equal(clickDecoration(after, { "data-comparison-close": "0" }), true, "un vrai contrôle, comme un bouton de décision");
  await settle(4);
  assert.equal(actionsOf(after), undefined, "le cartouche a disparu");
  assert.equal(classesOf(before).some((name) => name.includes("is-active")), false, "plus rien de sélectionné");
  assert.equal(file.content, BASE, "aucune décision, aucune écriture");
  assert.equal(ComparisonSession.current, session, "la comparaison reste ouverte");
  await session.close();
});

test("cartouche : Échap ferme sans décider — un clic ultérieur peut le rouvrir", async () => {
  const { file, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after));
  pressEscape(after);
  await settle(4);
  assert.equal(actionsOf(after), undefined);
  assert.equal(file.content, BASE);
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after), "un clic ultérieur rouvre le cartouche");
  await session.close();
});

test("cartouche : un clic hors de toute décoration ferme sans décider — mais ne fait rien s'il n'y avait rien à fermer", async () => {
  const { file, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  // Rien d'ouvert : un clic dans le vide ne doit rien casser.
  clickDecoration(after, {});
  await settle(4);
  assert.equal(actionsOf(after), undefined);
  // Un cartouche ouvert, puis un clic hors de toute décoration : il se ferme.
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after));
  clickDecoration(after, {});
  await settle(4);
  assert.equal(actionsOf(after), undefined);
  assert.equal(file.content, BASE, "aucune décision, aucune écriture");
  await session.close();
});

test("déplacement : le cartouche affiche « Déplacé ↑/↓ », jamais Ajout ni Suppression, et se ferme comme les autres", async () => {
  const { after, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.equal(actionsOf(after).widget.spec.label, "Déplacé 1 ↑");
  assert.equal(clickDecoration(after, { "data-comparison-close": "0" }), true);
  await settle(4);
  assert.equal(actionsOf(after), undefined);
  await session.close();
});

/* ---- Modes Changements / Versions, et recentrage par hunk -------------
   Changements = comprendre ce qui a changé (décorations, navigation par
   changement). Versions = lire l'avant et l'après, deux documents normaux,
   chacun libre. La bascule ne modifie jamais le Markdown, ne réouvre jamais
   les feuilles, et conserve le changement actif d'un mode à l'autre. */

test("comparaison : le mode Changements est actif par défaut, décorations visibles dès l'ouverture", async () => {
  const { before, after, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  assert.equal(session.viewMode, "changes");
  assert.ok(decorationsOf(before).length > 0 && decorationsOf(after).length > 0);
  await session.close();
});

test("comparaison : bascule Changements → Versions → Changements, sans jamais réécrire le Markdown", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { vault, file, snapshotFile, before, after, session } = await openSnapshot({ current, snapshot });
  assert.ok(decorationsOf(before).length > 0);

  session.setViewMode("versions");
  assert.equal(session.viewMode, "versions");
  assert.deepEqual(decorationsOf(before), [], "plus une seule décoration en mode Versions");
  assert.deepEqual(decorationsOf(after), []);
  assert.equal(await vault.read(file), current, "le Markdown n'a jamais bougé");
  assert.equal(await vault.read(snapshotFile), snapshot);

  session.setViewMode("changes");
  assert.equal(session.viewMode, "changes");
  assert.ok(decorationsOf(before).length > 0, "les décorations reviennent, sans réouverture des feuilles");
  assert.equal(await vault.read(file), current);
  await session.close();
});

test("mode Versions : rouge, vert, placeholders, lignes pointillées, cartouche et notes disparaissent tous ensemble", async () => {
  const note = {
    threadId: `thread-${"a".repeat(32)}`, documentId: "one", anchor: { start: 8, end: 13, quote: "trois", prefix: "UN deux ", suffix: " quatre" },
    createdByParticipantId: "b", createdAt: at, status: "open",
    messages: [{ messageId: `message-${"a".repeat(32)}`, participantId: "b", text: "À revoir", createdAt: at }],
  };
  const { before, after, session } = await openReview({ current: MOVE_LEFT, returned: MOVE_RIGHT, base: MOVE_LEFT, threads: [note] });
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(actionsOf(after), "le cartouche existe bien en mode Changements, une fois un changement choisi");
  assert.ok(moveDashesOf(before).length > 0 && movedLabelsOf(after).length > 0);

  session.setViewMode("versions");
  assert.deepEqual(decorationsOf(before), []);
  assert.deepEqual(decorationsOf(after), []);
  await session.close();
});

test("comparaison : aucune synchronisation continue du défilement par défaut, ni en Changements ni en Versions", async () => {
  const { beforeView, afterView, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  assert.equal(hasScrollListener(beforeView), false, "mode Changements : défilement lié désactivé par défaut");
  assert.equal(hasScrollListener(afterView), false);
  session.setViewMode("versions");
  assert.equal(hasScrollListener(beforeView), true, "mode Versions : défilement lié activé par défaut");
  assert.equal(hasScrollListener(afterView), true);
  await session.close();
});

test("snapshot : le bouton Versions du bandeau masque le diff sans fermer la comparaison, Changements le restaure", async () => {
  const { workspace, snapshotFile, before, session } = await openSnapshot({ current: MOVE_LEFT, snapshot: MOVE_RIGHT });
  let bar = barOf(workspace, snapshotFile.path);
  assert.equal(modeButton(bar, "Changements").classes.has("is-active"), true);
  assert.equal(modeButton(bar, "Versions").classes.has("is-active"), false);
  assert.ok(stepButton(bar, "Suivant ›"), "Précédent/Suivant visibles en Changements");

  click(modeButton(bar, "Versions"));
  bar = barOf(workspace, snapshotFile.path);
  assert.deepEqual(decorationsOf(before), []);
  assert.equal(modeButton(bar, "Versions").classes.has("is-active"), true);
  assert.equal(stepButton(bar, "Suivant ›"), undefined, "Précédent/Suivant n'ont plus de sens sans décoration à parcourir");
  // Les titres SNAPSHOT → VERSION ACTUELLE restent affichés, à l'identique.
  const titles = bar.children[0].children.map((child) => child.text);
  assert.ok(titles[0].startsWith("Snapshot — "));
  assert.equal(titles[3], "Version actuelle");

  click(modeButton(bar, "Changements"));
  assert.ok(decorationsOf(before).length > 0, "retour en Changements : décorations restaurées, sans réouverture");
  await session.close();
});

test("relecture : basculer en Versions masque le diff mais garde Terminer la relecture — une action globale", async () => {
  const { workspace, comparedPath, before, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  const bar = barOf(workspace, comparedPath);
  click(modeButton(bar, "Versions"));
  assert.deepEqual(decorationsOf(before), []);
  const barAfter = barOf(workspace, comparedPath);
  assert.deepEqual(barButtons(barAfter).map((button) => button.text), ["Changements", "Versions", "Terminer la relecture"]);
  assert.equal(stepButton(barAfter, "Suivant ›"), undefined);
  await session.close();
});

test("Versions n'auto-recentre jamais ; revenir en Changements conserve le changement actif et le recentre", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { before, beforeView, session } = await openSnapshot({ current, snapshot });
  doubleClickDecoration(before, { "data-comparison-change": "0" });
  await settle(4);
  const revealBeforeToggle = revealOf(beforeView);
  assert.ok(revealBeforeToggle);

  session.setViewMode("versions");
  assert.equal(revealOf(beforeView), revealBeforeToggle, "entrer en Versions ne déclenche aucun recentrage");

  session.setViewMode("changes");
  assert.ok(gone(before)[0].class.includes("is-active"), "le changement actif n'a jamais été perdu en mode Versions");
  assert.notEqual(revealOf(beforeView), revealBeforeToggle, "et revenir en Changements recentre à nouveau dessus");
  await session.close();
});

test("comparaison : fermer pendant le mode Versions ne laisse ni verrou ni classe ni écouteur, comme en Changements", async () => {
  const { before, beforeView, afterView, workspace, snapshotFile, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  session.setViewMode("versions");
  const host = viewFor(workspace, snapshotFile.path).containerEl;
  await session.close();
  assert.equal(readOnlyOf(before), false);
  assert.equal(host.classes.has("feuillets-comparison-host"), false);
  assert.equal(host.children.length, 0);
  assert.equal(hasScrollListener(beforeView), false, "le lien de défilement d'un mode Versions actif se retire aussi");
  assert.equal(hasScrollListener(afterView), false);
  assert.equal(ComparisonSession.current, null);
});

test("relecture : Appliquer fonctionne normalement après un aller-retour Changements → Versions → Changements", async () => {
  const { vault, file, after, session } = await openReview({ current: BASE, returned: RETURNED, base: BASE });
  session.setViewMode("versions");
  session.setViewMode("changes");
  clickDecoration(after, { "data-comparison-change": "0" });
  await settle(4);
  assert.equal(clickDecoration(after, { "data-comparison-change": "0", "data-comparison-action": "apply" }), true);
  assert.ok(await until(() => file.content === "UN deux trois quatre cinq six sept huit neuf dix."));
  await vault.read(file);
  await session.close();
});

/* ---- Défilement lié — option indépendante, jamais un troisième mode ---- */

function fireScroll(view, scrollTop) {
  view.scroller.scrollTop = scrollTop;
  view.scroller.events.get("scroll")?.();
}

test("défilement lié : désactivé, les deux vues défilent librement, sans se répercuter l'une sur l'autre", async () => {
  const { beforeView, afterView, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  assert.equal(session.linkedScroll, false, "Changements : désactivé par défaut");
  fireScroll(beforeView, 1000);
  assert.equal(afterView.scroller.scrollTop, 0, "aucune répercussion tant que le lien est désactivé");
  await session.close();
});

test("défilement lié : activé, le défilement d'une vue entraîne l'autre proportionnellement, sans boucle", async () => {
  const { beforeView, afterView, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  session.setLinkedScroll(true);
  assert.equal(session.linkedScroll, true);
  // scrollableAmount = scrollHeight - clientHeight = 4000 - 400 = 3600 des deux côtés.
  fireScroll(beforeView, 1800); // 50 %
  assert.equal(afterView.scroller.scrollTop, 1800, "l'autre vue suit, proportionnellement");
  // Le round-trip naturel (l'assignation ci-dessus aurait, dans un vrai
  // navigateur, aussi déclenché le 'scroll' de la cible) ne doit jamais
  // relancer un aller-retour : la protection anti-boucle absorbe l'écho.
  fireScroll(afterView, 1800);
  assert.equal(beforeView.scroller.scrollTop, 1800, "pas de dérive : l'écho n'a rien modifié d'autre");
  await session.close();
});

test("défilement lié : le recentrage par hunk fonctionne même quand le lien est actif", async () => {
  const current = "Le chat dort sur le tapis rouge."; const snapshot = "Le chien dort sur le tapis rouge.";
  const { before, beforeView, afterView, session } = await openSnapshot({ current, snapshot });
  session.setLinkedScroll(true);
  doubleClickDecoration(before, { "data-comparison-change": "0" });
  await settle(4);
  assert.ok(revealOf(beforeView), "le recentrage reste prioritaire, même défilement lié actif");
  assert.ok(revealOf(afterView));
  await session.close();
});

test("défilement lié : état mémorisé séparément par mode, pour la durée de la comparaison", async () => {
  const { session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  assert.equal(session.linkedScroll, false, "Changements : désactivé par défaut");
  session.setLinkedScroll(true); // change explicitement l'état en Changements.

  session.setViewMode("versions");
  assert.equal(session.linkedScroll, true, "Versions : activé par défaut — inchangé par la bascule");
  session.setLinkedScroll(false); // change explicitement l'état en Versions.

  session.setViewMode("changes");
  assert.equal(session.linkedScroll, true, "le choix fait en Changements est resté");
  session.setViewMode("versions");
  assert.equal(session.linkedScroll, false, "le choix fait en Versions, séparément, est resté aussi");
  await session.close();
});

test("défilement lié : le bouton du bandeau reflète et bascule l'état", async () => {
  const { workspace, snapshotFile, beforeView, afterView, session } = await openSnapshot({ current: "Le chat dort.", snapshot: "Le chien dort." });
  const bar = barOf(workspace, snapshotFile.path);
  const toggle = linkedScrollButton(bar);
  assert.ok(toggle, "un contrôle discret, dans le bandeau existant");
  assert.equal(toggle.classes.has("is-active"), false);
  click(toggle);
  assert.equal(hasScrollListener(beforeView), true);
  assert.equal(hasScrollListener(afterView), true);
  const barAfter = barOf(workspace, snapshotFile.path);
  assert.equal(linkedScrollButton(barAfter).classes.has("is-active"), true);
  await session.close();
});
