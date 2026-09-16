import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dateKey } from "../src/utils/journal-stats.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

/* main.ts est un fichier volumineux à nombreuses dépendances transitives :
 * on importe le JS compilé (jamais la source TS), avec la même indirection
 * que test/binder-refresh-scope.test.js, pour que ce test fonctionne aussi
 * bien via `npm test` (compilé, `.test-dist/`) que `npm run test:direct`. */
const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledPath = (path) => new URL(`../${path}`, import.meta.url).href;
const { default: FeuilletsPlugin } = await import(compiledPath(isCompiledTest ? "src/main.js" : ".test-dist/src/main.js"));
const { VIEW_JOURNAL, VIEW_SIDEBAR_FEUILLETS } = await import(compiledPath(isCompiledTest ? "src/constants.js" : ".test-dist/src/constants.js"));
const { TFolder } = await import(compiledPath(isCompiledTest ? "node_modules/obsidian/index.js" : ".test-dist/node_modules/obsidian/index.js"));

function bareProjectPlugin(root) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: root.path, projectMeta: {}, stats: {} };
  plugin.getProjectFolder = () => root;
  /* Aucune référence au Board nulle part dans ce harnais (ni BoardView, ni
   * VIEW_BOARD dans app.workspace) — la preuve que l'actualisation ne
   * dépend en rien du Board (§4/§9 du chantier « stats par projet »). */
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  plugin.saveSettings = async () => {};
  plugin.updateStatusBar = async () => {};
  plugin.refreshJournalViews = () => {};
  return plugin;
}

/** Remplace plugin.wordCountOfFolder par un mock entièrement piloté par le
 * test : chaque appel pousse un contrôleur `{resolve}` dans `calls` au lieu
 * de se résoudre tout seul, et `maxConcurrent` prouve qu'aucun second appel
 * n'a jamais été lancé avant la résolution du précédent. */
function trackedWordCount(plugin) {
  const calls = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  plugin.wordCountOfFolder = () => {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    return new Promise((resolve) => {
      calls.push({ resolve: (total) => { inFlight -= 1; resolve(total); } });
    });
  };
  return { calls, get maxConcurrent() { return maxConcurrent; } };
}

/** Remplace plugin.saveSettings par un mock qui détecte tout chevauchement
 * entre deux appels (jamais deux sauvegardes de ce mécanisme en vol). */
function trackedSaveSettings(plugin) {
  let inFlight = 0;
  let overlapDetected = false;
  let calls = 0;
  plugin.saveSettings = async () => {
    calls += 1;
    if (inFlight > 0) overlapDetected = true;
    inFlight += 1;
    await Promise.resolve();
    await Promise.resolve();
    inFlight -= 1;
  };
  return { get calls() { return calls; }, get overlapDetected() { return overlapDetected; } };
}

/** Laisse s'écouler tous les microtasks en attente (contrairement à
 * `await Promise.resolve()`, dont le nombre de tours nécessaires dépend du
 * nombre d'`await` internes) — un macrotask garantit que toute la chaîne
 * (wordCountOfFolder résolu -> suite du passage -> boucle single-flight ->
 * passage suivant démarré) a eu le temps de s'exécuter. Sert seulement à
 * OBSERVER l'état entre deux étapes pilotées par le test : le mécanisme
 * testé, lui, n'utilise aucun délai artificiel. */
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---- Migration de l'historique legacy (§2, §11-13, Correctif « legacy invalide ») ----

test("migrateLegacyJournalStats migre l'historique legacy vers le seul projet actif, une fois", () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.settings.stats = {
    "2026-01-01": { start: 100, latest: 200 },
    "2026-01-02": { start: 50, latest: 80 },
  };

  const migrated = plugin.migrateLegacyJournalStats();

  assert.equal(migrated, true);
  assert.deepEqual(plugin.settings.projectMeta[root.path].journalStats, {
    "2026-01-01": { start: 100, latest: 200 },
    "2026-01-02": { start: 50, latest: 80 },
  });
  assert.deepEqual(plugin.settings.stats, {});

  // Un second appel est un no-op : settings.stats est déjà vide, jamais
  // recopié une seconde fois vers un autre projet.
  const again = plugin.migrateLegacyJournalStats();
  assert.equal(again, false);
});

test("migrateLegacyJournalStats priorise journalStats déjà présent sur l'historique legacy", () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.settings.stats = { "2026-01-01": { start: 999, latest: 999 } };
  plugin.settings.projectMeta[root.path] = { journalStats: { "2026-01-01": { start: 100, latest: 150 } } };

  plugin.migrateLegacyJournalStats();

  assert.deepEqual(plugin.settings.projectMeta[root.path].journalStats["2026-01-01"], { start: 100, latest: 150 });
});

test("migrateLegacyJournalStats diffère la migration si aucun projet actif valide", () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: "", projectMeta: {}, stats: { "2026-01-01": { start: 1, latest: 2 } } };
  plugin.getProjectFolder = () => null;

  const migrated = plugin.migrateLegacyJournalStats();

  assert.equal(migrated, false);
  assert.deepEqual(plugin.settings.stats, { "2026-01-01": { start: 1, latest: 2 } });
});

test("migrateLegacyJournalStats : un legacy uniquement invalide est vidé et compte comme une modification", () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.settings.stats = {
    "2026-01-01": { start: "cent", latest: 200 },
    "2026-01-02": "pas un objet",
  };

  const migrated = plugin.migrateLegacyJournalStats();

  assert.equal(migrated, true, "la purge d'un legacy uniquement invalide compte comme une modification à sauvegarder");
  assert.deepEqual(plugin.settings.stats, {});
  assert.equal(plugin.settings.projectMeta[root.path]?.journalStats, undefined, "rien de valide à fusionner");
});

test("migrateLegacyJournalStats : un mélange valide/invalide ne migre que les entrées valides, puis vide entièrement le legacy", () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.settings.stats = {
    "2026-01-01": { start: 100, latest: 200 },
    "2026-01-02": { start: "cent", latest: 200 },
    "2026-01-03": { start: 5 },
  };

  const migrated = plugin.migrateLegacyJournalStats();

  assert.equal(migrated, true);
  assert.deepEqual(plugin.settings.projectMeta[root.path].journalStats, { "2026-01-01": { start: 100, latest: 200 } });
  assert.deepEqual(plugin.settings.stats, {});
});

test("updateJournalStatsForActiveProject : un legacy uniquement invalide est sauvegardé une seule fois, même si le total du jour est inchangé", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const key = dateKey(new Date());
  plugin.settings.stats = { "2026-01-01": { start: "cent", latest: 200 } };
  // Le total du jour est déjà exactement celui que retournera wordCountOfFolder :
  // sans la purge du legacy invalide, recordDailyTotal seul ne sauvegarderait rien.
  plugin.settings.projectMeta[root.path] = { journalStats: { [key]: { start: 1000, latest: 1000 } } };
  plugin.wordCountOfFolder = async () => 1000;
  const calls = { saveSettings: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };

  await plugin.updateJournalStatsForActiveProject();

  assert.equal(calls.saveSettings, 1, "la purge du legacy invalide déclenche la seule sauvegarde");
  assert.deepEqual(plugin.settings.stats, {});
});

// ---- Calcul protégé du total quotidien (§1-4, §6, §7, §9, §15) ----

test("updateJournalStatsForActiveProject : première observation, sauvegarde et rafraîchissement ciblé", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.wordCountOfFolder = async () => 1200;
  const calls = { saveSettings: 0, updateStatusBar: 0, refreshJournalViews: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };
  plugin.updateStatusBar = async () => { calls.updateStatusBar += 1; };
  plugin.refreshJournalViews = () => { calls.refreshJournalViews += 1; };

  await plugin.updateJournalStatsForActiveProject();

  assert.deepEqual(plugin.settings.projectMeta[root.path].journalStats[dateKey(new Date())], { start: 1200, latest: 1200 });
  assert.equal(calls.saveSettings, 1);
  assert.equal(calls.updateStatusBar, 1);
  assert.equal(calls.refreshJournalViews, 1);
});

test("updateJournalStatsForActiveProject : aucune sauvegarde ni rafraîchissement si le total est inchangé", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.wordCountOfFolder = async () => 1000;
  const calls = { saveSettings: 0, updateStatusBar: 0, refreshJournalViews: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };
  plugin.updateStatusBar = async () => { calls.updateStatusBar += 1; };
  plugin.refreshJournalViews = () => { calls.refreshJournalViews += 1; };

  await plugin.updateJournalStatsForActiveProject(); // baseline : écrit
  await plugin.updateJournalStatsForActiveProject(); // total identique : rien

  assert.equal(calls.saveSettings, 1);
  assert.equal(calls.updateStatusBar, 1);
  assert.equal(calls.refreshJournalViews, 1);
});

test("updateJournalStatsForActiveProject : migration et écriture du total sont sauvegardées ensemble, une seule fois", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  plugin.settings.stats = { "2025-12-01": { start: 10, latest: 20 } };
  plugin.wordCountOfFolder = async () => 1000;
  const calls = { saveSettings: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };

  await plugin.updateJournalStatsForActiveProject();

  assert.equal(calls.saveSettings, 1);
  assert.deepEqual(plugin.settings.stats, {});
  assert.ok(plugin.settings.projectMeta[root.path].journalStats["2025-12-01"]);
  assert.ok(plugin.settings.projectMeta[root.path].journalStats[dateKey(new Date())]);
});

test("updateJournalStatsForActiveProject : isolation complète entre deux projets, sans mélange de baselines au changement de projet", async () => {
  const rootA = new TFolder("Projet A/Manuscrit");
  const rootB = new TFolder("Projet B/Manuscrit");
  const roots = { [rootA.path]: rootA, [rootB.path]: rootB };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: rootA.path, projectMeta: {}, stats: {} };
  plugin.getProjectFolder = () => roots[plugin.settings.projectFolder] || null;
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  plugin.saveSettings = async () => {};
  plugin.updateStatusBar = async () => {};
  plugin.refreshJournalViews = () => {};

  plugin.wordCountOfFolder = async () => 1000;
  await plugin.updateJournalStatsForActiveProject();

  plugin.settings.projectFolder = rootB.path;
  plugin.wordCountOfFolder = async () => 5000;
  await plugin.updateJournalStatsForActiveProject();

  const key = dateKey(new Date());
  assert.deepEqual(plugin.settings.projectMeta[rootA.path].journalStats[key], { start: 1000, latest: 1000 });
  assert.deepEqual(plugin.settings.projectMeta[rootB.path].journalStats[key], { start: 5000, latest: 5000 });
});

test("updateJournalStatsForActiveProject : un résultat asynchrone périmé n'écrit rien après un changement de projet", async () => {
  const rootA = new TFolder("Projet A/Manuscrit");
  const rootB = new TFolder("Projet B/Manuscrit");
  const roots = { [rootA.path]: rootA, [rootB.path]: rootB };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: rootA.path, projectMeta: {}, stats: {} };
  plugin.getProjectFolder = () => roots[plugin.settings.projectFolder] || null;
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  const calls = { saveSettings: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };
  plugin.updateStatusBar = async () => {};
  plugin.refreshJournalViews = () => {};

  let resolveWordCount;
  plugin.wordCountOfFolder = () => new Promise((resolve) => { resolveWordCount = resolve; });

  const pending = plugin.updateJournalStatsForActiveProject();
  // Le projet actif change PENDANT le calcul asynchrone du total de A.
  plugin.settings.projectFolder = rootB.path;
  resolveWordCount(4200);
  await pending;

  assert.equal(plugin.settings.projectMeta[rootA.path], undefined, "rien écrit pour le projet périmé A");
  assert.equal(calls.saveSettings, 0, "aucune sauvegarde pour un résultat périmé");
});

// ---- Correctif « concurrence » : file « single flight » ----

test("single flight : jamais deux wordCountOfFolder() en cours simultanément", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject();
  const p2 = plugin.updateJournalStatsForActiveProject();
  assert.equal(tracker.calls.length, 1, "un seul wordCountOfFolder() lancé pour deux demandes concurrentes");

  tracker.calls[0].resolve(1000);
  await flushMicrotasks();
  if (tracker.calls.length > 1) tracker.calls[1].resolve(1000);
  await p1;
  await p2;

  assert.equal(tracker.maxConcurrent, 1, "jamais deux wordCountOfFolder() en vol, y compris pendant le passage supplémentaire");
});

test("single flight : une demande reçue pendant le calcul provoque exactement un passage supplémentaire", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject(); // demande reçue PENDANT le calcul du premier passage

  tracker.calls[0].resolve(1000);
  await flushMicrotasks();
  assert.equal(tracker.calls.length, 2, "exactement un passage supplémentaire a démarré");

  tracker.calls[1].resolve(1000);
  await flushMicrotasks();
  assert.equal(tracker.calls.length, 2, "aucun passage de plus une fois le passage supplémentaire terminé");
  await p1;
});

test("single flight : trois demandes pendant le même calcul restent groupées en un seul passage supplémentaire", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject();

  tracker.calls[0].resolve(1000);
  await flushMicrotasks();
  assert.equal(tracker.calls.length, 2, "un seul passage supplémentaire, quel que soit le nombre de demandes rapprochées");

  tracker.calls[1].resolve(1000);
  await flushMicrotasks();
  assert.equal(tracker.calls.length, 2);
  await p1;
});

test("single flight : le résultat final correspond au total du passage le plus récent", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject();

  tracker.calls[0].resolve(1000);
  await flushMicrotasks();
  tracker.calls[1].resolve(9999);
  await p1;

  assert.deepEqual(plugin.settings.projectMeta[root.path].journalStats[dateKey(new Date())], { start: 1000, latest: 9999 });
});

test("single flight : les sauvegardes de ce mécanisme ne sont jamais concurrentes", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);
  const saveTracker = trackedSaveSettings(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject();
  plugin.updateJournalStatsForActiveProject();

  tracker.calls[0].resolve(1000);
  await flushMicrotasks();
  tracker.calls[1].resolve(2000);
  await p1;

  assert.equal(saveTracker.overlapDetected, false, "aucune sauvegarde concurrente issue de ce mécanisme");
  assert.equal(saveTracker.calls, 2, "une sauvegarde par passage effectif");
});

test("single flight : une demande pour le nouveau projet en attente s'exécute après l'abandon du résultat périmé", async () => {
  const rootA = new TFolder("Projet A/Manuscrit");
  const rootB = new TFolder("Projet B/Manuscrit");
  const roots = { [rootA.path]: rootA, [rootB.path]: rootB };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: rootA.path, projectMeta: {}, stats: {} };
  plugin.getProjectFolder = () => roots[plugin.settings.projectFolder] || null;
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  plugin.saveSettings = async () => {};
  plugin.updateStatusBar = async () => {};
  plugin.refreshJournalViews = () => {};
  const tracker = trackedWordCount(plugin);

  const p1 = plugin.updateJournalStatsForActiveProject(); // démarre pour A, total en attente
  const p2 = plugin.updateJournalStatsForActiveProject(); // demande reçue pendant le calcul de A
  plugin.settings.projectFolder = rootB.path; // le projet actif change pendant ce même calcul

  assert.equal(tracker.calls.length, 1);
  tracker.calls[0].resolve(1000); // résultat périmé pour A
  await flushMicrotasks();
  assert.equal(tracker.calls.length, 2, "le passage supplémentaire (pour B, désormais actif) a démarré");
  tracker.calls[1].resolve(7000);
  await p1;
  await p2;

  const key = dateKey(new Date());
  assert.equal(plugin.settings.projectMeta[rootA.path], undefined, "rien écrit pour A : résultat périmé abandonné");
  assert.deepEqual(plugin.settings.projectMeta[rootB.path].journalStats[key], { start: 7000, latest: 7000 });
});

// ---- Rafraîchissement ciblé (§7, §16) ----

test("refreshJournalViews rafraîchit seulement VIEW_JOURNAL et le panneau latéral dont l'onglet actif est Journal", () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const calls = [];
  const journalLeafView = { render(force) { calls.push(["journal-leaf", force]); } };
  const sidebarJournalView = { activeTab: "journal", render(force) { calls.push(["sidebar-journal", force]); } };
  const sidebarOtherView = { activeTab: "notes", render(force) { calls.push(["sidebar-notes", force]); } };
  plugin.app = {
    workspace: {
      getLeavesOfType(type) {
        if (type === VIEW_JOURNAL) return [{ view: journalLeafView }];
        if (type === VIEW_SIDEBAR_FEUILLETS) return [{ view: sidebarJournalView }, { view: sidebarOtherView }];
        return [];
      },
    },
  };

  plugin.refreshJournalViews();

  assert.deepEqual(calls, [["journal-leaf", true], ["sidebar-journal", undefined]]);
});

// ---- Debounce dédié (§5) ----

test("scheduleJournalStatsUpdate pose un timer dédié, indépendant de _refreshTimer", () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.updateJournalStatsForActiveProject = async () => {};
  plugin._refreshTimer = 12345;

  plugin.scheduleJournalStatsUpdate(1000);

  assert.notEqual(plugin._journalStatsTimer, undefined);
  assert.equal(plugin._refreshTimer, 12345);
  window.clearTimeout(plugin._journalStatsTimer);
});

test("scheduleJournalStatsUpdate : les appels rapprochés se regroupent en un seul calcul", async () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  let runs = 0;
  plugin.updateJournalStatsForActiveProject = async () => { runs += 1; };

  plugin.scheduleJournalStatsUpdate(20);
  plugin.scheduleJournalStatsUpdate(20);
  plugin.scheduleJournalStatsUpdate(20);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(runs, 1);
});

// ---- Rétention par projet (§8, §14) ----

test("trimStats applique statsRetention séparément à chaque projet, et nettoie l'historique legacy restant", () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = {
    statsRetention: 2,
    stats: {
      "2026-01-01": { start: 1, latest: 1 },
      "2026-01-02": { start: 2, latest: 2 },
      "2026-01-03": { start: 3, latest: 3 },
    },
    projectMeta: {
      "Projet A": {
        journalStats: {
          "2026-01-01": { start: 1, latest: 1 },
          "2026-01-02": { start: 2, latest: 2 },
          "2026-01-03": { start: 3, latest: 3 },
        },
      },
      "Projet B": { journalStats: { "2026-02-01": { start: 9, latest: 9 } } },
    },
  };

  plugin.trimStats();

  assert.deepEqual(Object.keys(plugin.settings.projectMeta["Projet A"].journalStats), ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(Object.keys(plugin.settings.projectMeta["Projet B"].journalStats), ["2026-02-01"]);
  assert.deepEqual(Object.keys(plugin.settings.stats), ["2026-01-02", "2026-01-03"]);
});

// ---- Série de jours consécutifs, par projet (§1) ----

test("currentStreak lit uniquement journalStats du projet actif", () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  plugin.getProjectFolder = () => root;
  plugin.settings = {
    projectMeta: {
      [root.path]: {
        journalStats: {
          [dateKey(today)]: { start: 100, latest: 150 },
          [dateKey(yesterday)]: { start: 50, latest: 90 },
        },
      },
      "Autre/Manuscrit": { journalStats: { [dateKey(today)]: { start: 1, latest: 999 } } },
    },
  };

  assert.equal(plugin.currentStreak(), 2);

  plugin.getProjectFolder = () => null;
  assert.equal(plugin.currentStreak(), 0);
});

// ---- Correctif « delta jamais négatif » : updateStatusBar (§13) ----

test("updateStatusBar utilise dailyWordDelta et ne conserve aucun calcul de delta non borné", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.doesNotMatch(source, /total - st\.start/, "l'ancien calcul direct non borné a bien été retiré");
  assert.match(source, /dailyWordDelta\(st\.start, total\)/, "updateStatusBar utilise la règle commune bornée");
});

// ---- Déchargement (§10, §18, Correctif « déchargement ») ----

test("onunload délègue l'arrêt des statistiques du Journal à stopJournalStatsForUnload", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.match(source, /window\.clearTimeout\(this\._concTimer\);\s*\n\s*this\.stopJournalStatsForUnload\(\);/);
});

test("stopJournalStatsForUnload : un calcul déjà en cours n'écrit, ne sauvegarde ni ne rafraîchit rien après le déchargement", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const calls = { saveSettings: 0, updateStatusBar: 0, refreshJournalViews: 0 };
  plugin.saveSettings = async () => { calls.saveSettings += 1; };
  plugin.updateStatusBar = async () => { calls.updateStatusBar += 1; };
  plugin.refreshJournalViews = () => { calls.refreshJournalViews += 1; };
  let resolveWordCount;
  plugin.wordCountOfFolder = () => new Promise((resolve) => { resolveWordCount = resolve; });

  const pending = plugin.updateJournalStatsForActiveProject();
  plugin.stopJournalStatsForUnload(); // déchargement PENDANT le calcul
  // La Promise de lecture n'est jamais annulée : elle se résout normalement,
  // mais son résultat doit être ignoré.
  resolveWordCount(5000);
  await pending;

  assert.equal(calls.saveSettings, 0);
  assert.equal(calls.updateStatusBar, 0);
  assert.equal(calls.refreshJournalViews, 0);
  assert.equal(plugin.settings.projectMeta[root.path]?.journalStats, undefined);
});

test("stopJournalStatsForUnload : empêche tout nouveau passage d'être lancé", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const plugin = bareProjectPlugin(root);
  const tracker = trackedWordCount(plugin);

  plugin.stopJournalStatsForUnload();
  await plugin.updateJournalStatsForActiveProject();

  assert.equal(tracker.calls.length, 0, "aucun passage lancé après déchargement");
});

test("stopJournalStatsForUnload : empêche scheduleJournalStatsUpdate de programmer un nouveau passage", async () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  let runs = 0;
  plugin.updateJournalStatsForActiveProject = async () => { runs += 1; };

  plugin.stopJournalStatsForUnload();
  plugin.scheduleJournalStatsUpdate(10);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(runs, 0);
});
