import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { PreviewView } from "../src/views/preview-view.js";
import { createSelectionScope, createFolderScope, createFileScope, createProjectScope } from "../src/services/compile-scope.js";
import { progressWithinSection, scrollTopWithinSection, scrollableAmount } from "../src/views/preview-scroll-sync.js";

/* LOT 3, §12/§14/§15/§16/§18/§19/§20/§23 — pont de défilement Continu ↔
 * Preview. Frontière testée délibérément : `sectionForPath` et
 * `visibleFeuilletPathAtViewport` (lecture DOM `data-source-path`) sont
 * STUBBÉES ici — leur correction est déjà couverte, intacte, par la
 * baseline protégée (preview-source-map.test.js, preview-view.test.js).
 * Ce fichier vérifie exclusivement la logique AJOUTÉE par le lot :
 * linkedContinuView(), previewAnchorAtViewport(), scrollPreviewToAnchor(),
 * et les nouvelles branches "continu" de bindSourcePane/applySourceToPreview/
 * applyPreviewToSource — jamais un second calcul de section ou de ratio.
 *
 * Les positions attendues sont calculées avec les MÊMES fonctions pures que
 * le code testé (progressWithinSection/scrollTopWithinSection/
 * scrollableAmount, preview-scroll-sync.js) plutôt qu'en arithmétique
 * recopiée à la main — un changement de constante interne ne peut donc
 * jamais désynchroniser silencieusement le test de l'implémentation. */

globalThis.window ??= {
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

const PROJECT_ROOT = "Roman/Manuscrit";
const SCOPE = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md"]);

/** Élément de scroll minimal, fidèle à la surface réellement lue/écrite par
 * le module (scrollTop, scrollHeight, clientHeight, addEventListener). */
function fakeViewport({ scrollTop = 0, scrollHeight = 1000, clientHeight = 400 } = {}) {
  return { scrollTop, scrollHeight, clientHeight, addEventListener() {}, removeEventListener() {} };
}

/** ContinuSourceView minimal — jamais une vraie ScriveningsView : PreviewView
 * ne dépend QUE de cette surface structurelle (voir §7 du lot), donc la
 * tester contre elle est la forme la plus fidèle du contrat. */
function fakeContinu({ compileScope = SCOPE, scrollAnchor = null, memberPaths = ["A.md", "B.md", "C.md"], scrollElement = null } = {}) {
  const scrollToAnchorCalls = [];
  const openSingleMemberCalls = [];
  return {
    compileScope,
    getMemberPaths: () => memberPaths,
    getLiveBody: () => null,
    getScrollElement: () => scrollElement,
    getScrollAnchor: () => scrollAnchor,
    scrollToAnchor: (path, progress) => { scrollToAnchorCalls.push({ path, progress }); },
    openSingleMember: async (path) => { openSingleMemberCalls.push(path); return true; },
    scrollToAnchorCalls,
    openSingleMemberCalls,
  };
}

/** Instance minimale de PreviewView — même patron que le reste du lot
 * (Object.create(PreviewView.prototype)) : jamais de vrai DOM/iframe, la
 * pagination et le rendu ne sont d'ailleurs jamais impliqués ici.
 * `sections` et `visiblePath` remplacent le DOM `data-source-path` réel.
 * `syncScrollEnabled`/`isLongFormPreview` sont des ACCESSEURS en lecture
 * seule sur PreviewView : posés ici via `Object.defineProperty`, jamais une
 * simple affectation (qui lèverait — aucun setter n'existe sur la classe). */
function fakePreview({
  compileScope = SCOPE,
  continu = null,
  sections = {},
  visiblePath = null,
  viewport = fakeViewport(),
  syncScrollEnabled = true,
  isLongFormPreview = false,
} = {}) {
  const view = Object.create(PreviewView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true, configurable: true });
  Object.defineProperty(view, "syncScrollEnabled", { value: syncScrollEnabled, configurable: true });
  Object.defineProperty(view, "isLongFormPreview", { value: isLongFormPreview, configurable: true });
  view.plugin = { getCentralContinuView: () => continu, settings: { previewMode: "scene" } };
  view.previewViewport = viewport;
  view.sectionForPath = (path) => sections[path] ?? null;
  view.visibleFeuilletPathAtViewport = () => visiblePath;
  view.closed = false;
  view.releaseHandles = [];
  view.visibleFeuilletPath = null;
  view.updateUiCalls = 0;
  view.updateUI = () => { view.updateUiCalls++; };
  view.syncScroller = null;
  view.syncKind = null;
  view.syncSourcePath = null;
  view.syncScrollerCleanup = null;
  view.synchronizedFeuilletPath = null;
  view.followedEl = null;
  view.lastPreviewScrollAt = 0;
  view.lastSourceScrollAt = 0;
  view.syncingFromEditor = false;
  view.syncingFromPreview = false;
  const realUpdateVisibleFeuillet = view.updateVisibleFeuillet;
  view.updateVisibleFeuilletCalls = 0;
  view.updateVisibleFeuillet = function (...args) {
    view.updateVisibleFeuilletCalls++;
    return realUpdateVisibleFeuillet.apply(this, args);
  };
  return view;
}

/** Variante de fakePreview qui NE stubbe PAS `syncScrollEnabled` : le vrai
 * accesseur de PreviewView.prototype reste en place, pour tester le getter
 * de production lui-même (micro-correctif « scroll Continu ↔ Aperçu pour
 * Dossier/Projet ») plutôt qu'une valeur imposée par le test. */
function fakePreviewRealSync({
  compileScope = SCOPE,
  continu = null,
  synchronizedFeuilletPath = null,
  viewport = fakeViewport(),
} = {}) {
  const view = Object.create(PreviewView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true, configurable: true });
  view.plugin = { getCentralContinuView: () => continu, settings: { previewMode: "scene" } };
  view.previewViewport = viewport;
  view.sectionForPath = () => null;
  view.visibleFeuilletPathAtViewport = () => null;
  view.closed = false;
  view.releaseHandles = [];
  view.visibleFeuilletPath = null;
  view.syncScroller = null;
  view.syncKind = null;
  view.syncSourcePath = null;
  view.syncScrollerCleanup = null;
  view.synchronizedFeuilletPath = synchronizedFeuilletPath;
  view.explicitContinuSource = null;
  view.followedEl = null;
  view.lastPreviewScrollAt = 0;
  view.lastSourceScrollAt = 0;
  view.syncingFromEditor = false;
  view.syncingFromPreview = false;
  return view;
}

/* ===================== linkedContinuView() ===================== */

test("linkedContinuView : lié quand les deux CompileScope sont structurellement égaux", () => {
  const continu = fakeContinu({ compileScope: SCOPE });
  const view = fakePreview({ compileScope: SCOPE, continu });
  assert.equal(view.linkedContinuView(), continu);
});

test("linkedContinuView : non lié si les scopes divergent (§22 — clic manuel dans le fil d'Ariane Preview)", () => {
  const continu = fakeContinu({ compileScope: createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Autre`) });
  const view = fakePreview({ compileScope: SCOPE, continu });
  assert.equal(view.linkedContinuView(), null);
});

test("linkedContinuView : null si aucun Continu central, ou aucun scope des deux côtés", () => {
  assert.equal(fakePreview({ compileScope: SCOPE, continu: null }).linkedContinuView(), null);
  assert.equal(fakePreview({ compileScope: null, continu: fakeContinu({ compileScope: SCOPE }) }).linkedContinuView(), null);
  assert.equal(fakePreview({ compileScope: SCOPE, continu: fakeContinu({ compileScope: null }) }).linkedContinuView(), null);
});

/* ===================== Q/R — Continu ↔ Preview, ancre exacte ===================== */

test("Q. Continu → Preview : la section de C reçoit ~50 % de progression, jamais un ratio global", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "C.md", progress: 0.5 } });
  const viewport = fakeViewport({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  const section = { top: 600, height: 800 };
  const view = fakePreview({ continu, viewport, sections: { "C.md": section } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applySourceToPreview();

  const raw = scrollTopWithinSection(section, viewport.clientHeight, 0.5);
  const expected = Math.max(0, Math.min(raw, scrollableAmount(viewport)));
  assert.equal(viewport.scrollTop, expected);
});

test("R. Preview → Continu : scroll sur D transmet EXACTEMENT l'ancre lue dans le DOM (previewAnchorAtViewport)", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "A.md", progress: 0 } });
  const viewport = fakeViewport({ scrollTop: 340, scrollHeight: 1000, clientHeight: 400 });
  const section = { top: 100, height: 500 };
  const view = fakePreview({ continu, viewport, visiblePath: "D.md", sections: { "D.md": section } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applyPreviewToSource();

  assert.equal(continu.scrollToAnchorCalls.length, 1);
  assert.equal(continu.scrollToAnchorCalls[0].path, "D.md");
  assert.equal(continu.scrollToAnchorCalls[0].progress, progressWithinSection(340, section, viewport.clientHeight));
});

/* ===================== S/T — anti-boucle ===================== */

test("S. Continu → Preview programmatique ne relance pas Preview → Continu (garde-fou syncingFromEditor)", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "C.md", progress: 0.5 } });
  const viewport = fakeViewport({ scrollTop: 0 });
  const view = fakePreview({ continu, viewport, sections: { "C.md": { top: 0, height: 800 } } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applySourceToPreview();

  assert.equal(view.syncingFromEditor, true, "le garde-fou reste posé jusqu'à la frame suivante (releaseAfterFrame)");
});

test("T. Preview → Continu programmatique ne relance pas Continu → Preview (garde-fou syncingFromPreview)", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: null });
  const viewport = fakeViewport({ scrollTop: 300 });
  const view = fakePreview({ continu, viewport, visiblePath: "B.md", sections: { "B.md": { top: 100, height: 500 } } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applyPreviewToSource();

  assert.equal(view.syncingFromPreview, true);
});

/* ===================== U/V — seuils, aucune écriture inutile ===================== */

test("U. Preview → Continu : même path et delta de progression < 0.01 → aucun déplacement", () => {
  const viewport = fakeViewport({ scrollTop: 300 });
  const section = { top: 100, height: 500 };
  const currentProgress = progressWithinSection(300, section, viewport.clientHeight);
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "B.md", progress: currentProgress } });
  const view = fakePreview({ continu, viewport, visiblePath: "B.md", sections: { "B.md": section } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applyPreviewToSource();

  assert.deepEqual(continu.scrollToAnchorCalls, [], "même path, delta < 0.01 : aucun appel");
});

test("V. Continu → Preview : cible à moins d'1 px du scrollTop actuel → aucune écriture", () => {
  const section = { top: 600, height: 800 };
  const viewportProbe = fakeViewport({ scrollHeight: 1000, clientHeight: 400 });
  const raw = scrollTopWithinSection(section, viewportProbe.clientHeight, 0.5);
  const target = Math.max(0, Math.min(raw, scrollableAmount(viewportProbe)));
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "C.md", progress: 0.5 } });
  const viewport = fakeViewport({ scrollTop: target, scrollHeight: 1000, clientHeight: 400 });
  const view = fakePreview({ continu, viewport, sections: { "C.md": section } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applySourceToPreview();

  assert.equal(viewport.scrollTop, target, "déjà à la cible : scrollTop non réécrit");
});

test("W. aucun ratio scrollTop global utilisé pour Continu (progression toujours dérivée de sectionForPath)", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollAnchor: { path: "A.md", progress: 0.25 } });
  // scrollHeight très différent de la hauteur de section : un ratio global
  // donnerait un résultat totalement différent de scrollTopWithinSection.
  const viewport = fakeViewport({ scrollTop: 0, scrollHeight: 50000, clientHeight: 400 });
  const section = { top: 0, height: 1200 };
  const view = fakePreview({ continu, viewport, sections: { "A.md": section } });
  view.syncScroller = fakeViewport();
  view.syncKind = "continu";

  view.applySourceToPreview();

  const expected = Math.max(0, Math.min(scrollTopWithinSection(section, viewport.clientHeight, 0.25), scrollableAmount(viewport)));
  assert.equal(viewport.scrollTop, expected);
  // Un ratio global (progress * scrollableAmount(viewport)) donnerait
  // 0.25*49600=12400, très différent du résultat attendu par section.
  assert.notEqual(viewport.scrollTop, 0.25 * scrollableAmount(viewport));
});

/* ===================== X/Y — recomposition ===================== */

test("X. C survit à 50 % après ajout de E : scrollPreviewToAnchor reçoit la MÊME ancre C/0.5, aucun recalcul", () => {
  const viewport = fakeViewport({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  const section = { top: 500, height: 800 };
  const view = fakePreview({ viewport, sections: { "C.md": section } });

  view.scrollPreviewToAnchor({ path: "C.md", progress: 0.5 });

  const expected = Math.max(0, Math.min(scrollTopWithinSection(section, viewport.clientHeight, 0.5), scrollableAmount(viewport)));
  assert.equal(viewport.scrollTop, expected);
});

test("Y. C supprimé, D prochain survivant : Preview reçoit EXACTEMENT l'ancre D/0 fournie par Continu, aucun fallback Preview parallèle", () => {
  const viewport = fakeViewport({ scrollTop: 0, scrollHeight: 1500, clientHeight: 400 });
  const section = { top: 900, height: 300 };
  const view = fakePreview({ viewport, sections: { "D.md": section } });

  view.scrollPreviewToAnchor({ path: "D.md", progress: 0 });

  const expected = Math.max(0, Math.min(scrollTopWithinSection(section, viewport.clientHeight, 0), scrollableAmount(viewport)));
  assert.equal(viewport.scrollTop, expected);
  assert.equal(expected, 900, "aucun recalcul next/previous côté Preview : l'ancre fournie est appliquée telle quelle");
});

/* ===================== Z/AA/AB — navigation ===================== */

test("Z. Scroll Preview lié à Continu : scheduleAutoOpenVisibleFeuillet() ne programme rien (aucun openFile, Continu reste ouvert)", () => {
  const continu = fakeContinu({ compileScope: SCOPE });
  const view = fakePreview({ continu });
  let timeoutScheduled = false;
  const fakeWin = { setTimeout: () => { timeoutScheduled = true; return 0; }, clearTimeout: () => {} };
  const realWindow = globalThis.window;
  globalThis.window = fakeWin;
  try {
    view.scheduleAutoOpenVisibleFeuillet();
    assert.equal(timeoutScheduled, false, "Continu lié : return immédiat, aucun minuteur d'auto-ouverture programmé");
  } finally {
    globalThis.window = realWindow;
  }
});

test("AA. « Ouvrir ce feuillet » (action explicite) avec Continu lié : délègue à continu.openSingleMember, jamais leaf.openFile direct", async () => {
  const continu = fakeContinu({ compileScope: SCOPE });
  const view = fakePreview({ continu, visiblePath: "C.md", isLongFormPreview: true });
  view.app = { vault: { getAbstractFileByPath: () => { throw new Error("ne doit jamais être atteint : Continu gère l'ouverture"); } } };

  await view.openVisibleFeuillet({ origin: "explicit" });

  assert.deepEqual(continu.openSingleMemberCalls, ["C.md"]);
});

test("AB. Preview NON lié à Continu : « Ouvrir ce feuillet » explicite garde son chemin historique (vrai openFile)", async () => {
  const view = fakePreview({ continu: null, visiblePath: "C.md", isLongFormPreview: true });
  let openFileCalled = false;
  const file = new TFile("C.md", "");
  view.app = {
    vault: { getAbstractFileByPath: () => file },
    workspace: { setActiveLeaf: () => {} },
  };
  view.plugin.getLeafForOpeningFile = () => ({ openFile: async () => { openFileCalled = true; } });
  view.plugin.settings.binderSelectedPath = null;
  view.plugin.saveSettings = async () => {};
  view.bindSourcePane = () => {};
  view.applySourceToPreview = () => {};
  view.openVisibleRequestId = 0;
  view.preservingPreviewScrollRequestId = null;

  await view.openVisibleFeuillet({ origin: "explicit" });

  assert.equal(openFileCalled, true, "hors Continu, le comportement historique (vrai openFile) est inchangé");
});

/* ===================== AC/AD — breadcrumb (mécanisme existant réutilisé) === */

test("scrollPreviewToAnchor réutilise updateVisibleFeuillet (mécanisme existant, aucun breadcrumb propre à Continu)", () => {
  const viewport = fakeViewport({ scrollTop: 0 });
  const view = fakePreview({ viewport, sections: { "B.md": { top: 200, height: 800 } } });

  view.scrollPreviewToAnchor({ path: "B.md", progress: 0.25 });

  assert.equal(view.updateVisibleFeuilletCalls, 1, "le mécanisme EXISTANT de mise à jour du feuillet visible est appelé après déplacement");
});

/* ===================== bindSourcePane — priorité Continu (§14) ===================== */

test("bindSourcePane : Continu lié → syncKind=continu, syncScroller=continu.getScrollElement(), jamais de MarkdownView choisi à sa place", () => {
  const scrollEl = fakeViewport();
  const continu = fakeContinu({ compileScope: SCOPE, scrollElement: scrollEl, scrollAnchor: { path: "B.md", progress: 0.2 } });
  const view = fakePreview({ continu });
  view.app = { workspace: {} };

  // Un clic Binder fournit un MarkdownView explicite : la priorité Continu
  // doit primer malgré tout (§14 : "un clic dans Binder ne doit pas
  // déconnecter Continu").
  view.bindSourcePane({ file: { path: "Autre.md" }, contentEl: {} });

  assert.equal(view.syncKind, "continu");
  assert.equal(view.syncScroller, scrollEl);
  assert.equal(view.syncSourcePath, "B.md");
});

/* ================ Micro-correctif « lien Continu ↔ Preview » (§1-6) ==============
 * Le Lot 3 ne résolvait le Continu lié QUE via `plugin.getCentralContinuView()`
 * (résolution GLOBALE, dépendante de la dernière leaf active du workspace) :
 * la Preview explicitement ouverte à côté d'une leaf Continu précise n'avait
 * aucun moyen de se rebrancher IMMÉDIATEMENT sur CETTE instance — d'où le
 * scroll resté débranché malgré un scope identique des deux côtés (bug
 * manuel constaté). `explicitContinuSource` + `setContinuSource()` couvrent
 * ce lien ; ces tests vérifient PUREMENT la résolution et le branchement,
 * jamais la géométrie de scroll (déjà couverte plus haut, réutilisée telle
 * quelle). */

test("linkedContinuView : le lien EXPLICITE (posé par setContinuSource) est retenu quand les scopes sont égaux", () => {
  const continu = fakeContinu({ compileScope: SCOPE });
  const view = fakePreview({ compileScope: SCOPE, continu: null }); // aucun Continu central
  view.explicitContinuSource = continu;

  assert.equal(view.linkedContinuView(), continu, "le lien explicite suffit, sans Continu central");
});

test("linkedContinuView : le lien explicite est IGNORÉ si les scopes divergent — jamais un simple test de présence", () => {
  const explicit = fakeContinu({ compileScope: createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Autre`) });
  const view = fakePreview({ compileScope: SCOPE, continu: null });
  view.explicitContinuSource = explicit;

  assert.equal(view.linkedContinuView(), null, "une navigation manuelle du fil d'Ariane détache donc naturellement le lien");
});

test("linkedContinuView : le lien explicite a priorité sur le Continu central, mais le repli central fonctionne toujours sans lui", () => {
  const explicit = fakeContinu({ compileScope: SCOPE });
  const central = fakeContinu({ compileScope: SCOPE });
  const view = fakePreview({ compileScope: SCOPE, continu: central });
  view.explicitContinuSource = explicit;

  assert.equal(view.linkedContinuView(), explicit, "priorité au lien explicite");

  view.explicitContinuSource = null;
  assert.equal(view.linkedContinuView(), central, "repli EXACT sur le Continu central en l'absence de lien explicite");
});

/* ===================== setContinuSource() (§3-4) ===================== */

test("setContinuSource : Preview déjà rendue sur le MÊME scope — rebranche immédiatement le scroll (bindSourcePane + applySourceToPreview), sans rerendu", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollElement: fakeViewport(), scrollAnchor: { path: "B.md", progress: 0.3 } });
  const view = fakePreview({ compileScope: SCOPE, continu: null }); // pas encore lié
  view.app = { workspace: {} };
  view.frameLoaded = true;
  view.closed = false;
  let applySourceToPreviewCalls = 0;
  const realApply = view.applySourceToPreview;
  view.applySourceToPreview = function (...args) {
    applySourceToPreviewCalls++;
    return realApply.apply(this, args);
  };
  view.refreshPreviewCalls = 0;
  view.refreshPreview = async () => { view.refreshPreviewCalls++; };

  view.setContinuSource(continu);

  assert.equal(view.explicitContinuSource, continu);
  assert.equal(view.syncKind, "continu", "bindSourcePane a immédiatement reconnu le lien tout juste posé");
  assert.equal(applySourceToPreviewCalls, 1, "branché ET synchronisé immédiatement, sans attendre un événement fortuit");
  assert.equal(view.refreshPreviewCalls, 0, "aucun rerendu");
});

test("setContinuSource : Preview PAS ENCORE chargée (frameLoaded=false) — branche bindSourcePane, mais n'applique aucun scroll tant que le rendu n'est pas prêt", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollElement: fakeViewport(), scrollAnchor: { path: "B.md", progress: 0.3 } });
  const view = fakePreview({ compileScope: SCOPE, continu: null });
  view.app = { workspace: {} };
  view.frameLoaded = false;
  let applySourceToPreviewCalls = 0;
  view.applySourceToPreview = () => { applySourceToPreviewCalls++; };

  view.setContinuSource(continu);

  assert.equal(view.syncKind, "continu", "le branchement reste immédiat");
  assert.equal(applySourceToPreviewCalls, 0, "pas de scroll programmatique avant que l'iframe existe");
});

test("setContinuSource(null) : détache proprement via le mécanisme EXISTANT (bindSourcePane), sans second cleanup", () => {
  // `isConnected: false` simule une leaf Continu réellement disparue —
  // c'est la seule condition sous laquelle bindSourcePane() (mécanisme
  // EXISTANT, voir son commentaire « Aucun candidat trouvé... ») abandonne
  // le dernier scroller suivi plutôt que de le garder tant qu'il existe
  // encore (comportement délibéré, pas une régression de ce test).
  const scrollEl = fakeViewport();
  scrollEl.isConnected = false;
  const continu = fakeContinu({ compileScope: SCOPE, scrollElement: scrollEl, scrollAnchor: { path: "B.md", progress: 0.3 } });
  const view = fakePreview({ compileScope: SCOPE, continu: null });
  view.app = { workspace: {} };
  view.frameLoaded = true;
  view.setContinuSource(continu);
  assert.equal(view.syncKind, "continu");

  view.setContinuSource(null);

  assert.equal(view.explicitContinuSource, null);
  assert.equal(view.syncKind, null, "plus aucune source Continu : bindSourcePane retombe sur son repli habituel (aucun Markdown actif ici)");
});

test("setContinuSource(null) : tant que l'ancien scroller Continu existe encore, bindSourcePane le CONSERVE (mécanisme EXISTANT inchangé, pas une fuite)", () => {
  const continu = fakeContinu({ compileScope: SCOPE, scrollElement: fakeViewport(), scrollAnchor: { path: "B.md", progress: 0.3 } });
  const view = fakePreview({ compileScope: SCOPE, continu: null });
  view.app = { workspace: {} };
  view.frameLoaded = true;
  view.setContinuSource(continu);
  assert.equal(view.syncKind, "continu");

  view.setContinuSource(null);

  assert.equal(view.explicitContinuSource, null, "le lien explicite est bien retiré");
  // Comportement historique de bindSourcePane, VOLONTAIREMENT inchangé par
  // ce micro-correctif : sans candidat de remplacement, le dernier panneau
  // suivi reste suivi tant qu'il est encore attaché au DOM.
  assert.equal(view.syncKind, "continu");
});

/* ================ Micro-correctif « scroll Continu ↔ Aperçu, Dossier/Projet »
 * (getter syncScrollEnabled) ================
 * `syncScrollEnabled` exigeait jusqu'ici `synchronizedFeuilletPath !== null`
 * pour folder/project — règle héritée de l'ancien suivi Markdown, qui
 * bloquait le scroll une fois un Continu lié sur ces portées. Ces tests
 * exercent le VRAI accesseur de production (fakePreviewRealSync, aucun
 * stub) — jamais une valeur imposée. */

test("syncScrollEnabled : Continu lié + folderScope → true", () => {
  const folderScope = createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Dossier`);
  const continu = fakeContinu({ compileScope: folderScope });
  const view = fakePreviewRealSync({ compileScope: folderScope, continu, synchronizedFeuilletPath: null });

  assert.equal(view.syncScrollEnabled, true);
});

test("syncScrollEnabled : Continu lié + projectScope → true", () => {
  const projectScope = createProjectScope(PROJECT_ROOT);
  const continu = fakeContinu({ compileScope: projectScope });
  const view = fakePreviewRealSync({ compileScope: projectScope, continu, synchronizedFeuilletPath: null });

  assert.equal(view.syncScrollEnabled, true);
});

test("syncScrollEnabled : Continu lié + selectionScope → true", () => {
  const continu = fakeContinu({ compileScope: SCOPE });
  const view = fakePreviewRealSync({ compileScope: SCOPE, continu, synchronizedFeuilletPath: null });

  assert.equal(view.syncScrollEnabled, true);
});

test("syncScrollEnabled : folderScope SANS Continu lié, synchronizedFeuilletPath null → false (comportement historique inchangé)", () => {
  const folderScope = createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Dossier`);
  const view = fakePreviewRealSync({ compileScope: folderScope, continu: null, synchronizedFeuilletPath: null });

  assert.equal(view.syncScrollEnabled, false);
});

test("syncScrollEnabled : projectScope SANS Continu lié, synchronizedFeuilletPath null → false (comportement historique inchangé)", () => {
  const projectScope = createProjectScope(PROJECT_ROOT);
  const view = fakePreviewRealSync({ compileScope: projectScope, continu: null, synchronizedFeuilletPath: null });

  assert.equal(view.syncScrollEnabled, false);
});

test("bindSourcePane : folderScope lié à Continu → syncKind === \"continu\" (via le vrai syncScrollEnabled)", () => {
  const folderScope = createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Dossier`);
  const continu = fakeContinu({ compileScope: folderScope, scrollElement: fakeViewport(), scrollAnchor: { path: "B.md", progress: 0.2 } });
  const view = fakePreviewRealSync({ compileScope: folderScope, continu, synchronizedFeuilletPath: null });
  view.app = { workspace: {} };

  view.bindSourcePane();

  assert.equal(view.syncKind, "continu");
});

test("bindSourcePane : projectScope lié à Continu → syncKind === \"continu\" (via le vrai syncScrollEnabled)", () => {
  const projectScope = createProjectScope(PROJECT_ROOT);
  const continu = fakeContinu({ compileScope: projectScope, scrollElement: fakeViewport(), scrollAnchor: { path: "B.md", progress: 0.2 } });
  const view = fakePreviewRealSync({ compileScope: projectScope, continu, synchronizedFeuilletPath: null });
  view.app = { workspace: {} };

  view.bindSourcePane();

  assert.equal(view.syncKind, "continu");
});

test("setContinuSource : mono-fichier — source null protège intégralement le parcours Markdown historique, jamais affecté", () => {
  const view = fakePreview({ compileScope: createFileScope(PROJECT_ROOT, "A.md"), continu: null });
  view.app = { workspace: {} };
  const markdown = { file: { path: "A.md" }, contentEl: {} };
  view.activeMarkdownView = () => markdown;
  view.isPreviewableFile = () => true;

  view.setContinuSource(null);
  view.bindSourcePane();

  assert.equal(view.explicitContinuSource, null);
  assert.equal(view.syncKind, "markdown", "hors Continu, la résolution Markdown historique reste seule maîtresse");
});
