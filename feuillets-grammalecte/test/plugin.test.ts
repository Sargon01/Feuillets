/* Cycle de vie du compagnon : détection de Feuillets, enregistrement,
   déchargement, chargement paresseux du moteur. Feuillets est représenté par
   un faux registre — on ne charge ni le vrai greffon ni le vrai Grammalecte. */

import assert from "node:assert/strict";
import test from "node:test";
import type { App, PluginManifest } from "obsidian";
import { notices } from "./obsidian-stub.mjs";
import FeuilletsGrammalectePlugin from "../main.ts";
import { getFeuilletsApi, isFeuilletsPresentWithoutApi } from "../src/feuillets-api.ts";
import { GrammalecteProvider, PROVIDER_ID } from "../src/grammalecte-provider.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.ts";
import type { GrammalecteEngine, GrammalecteError } from "../src/grammalecte-adapter.ts";
import type { TextAnalysisProvider } from "../src/feuillets-api.ts";

/* ---------------------- faux Feuillets minimal ---------------------- */

function fakeFeuillets() {
  const providers = new Map<string, TextAnalysisProvider>();
  return {
    providers,
    plugin: {
      api: {
        apiVersion: 1,
        registerAnalysisProvider: (p: TextAnalysisProvider) => { providers.set(p.id, p); },
        unregisterAnalysisProvider: (id: string) => { providers.delete(id); },
        getAnalysisProvider: (id?: string) =>
          (id ? providers.get(id) : providers.values().next().value) ?? null,
      },
    },
  };
}

type LayoutCallback = () => void;

function fakeApp(plugins: Record<string, unknown>): App & { runLayoutReady: () => void } {
  const callbacks: LayoutCallback[] = [];
  const app = {
    plugins: { plugins },
    workspace: {
      onLayoutReady: (cb: LayoutCallback) => callbacks.push(cb),
    },
    runLayoutReady: () => { for (const cb of callbacks.splice(0)) cb(); },
  };
  return app as unknown as App & { runLayoutReady: () => void };
}

const MANIFEST = { id: "feuillets-grammalecte", dir: ".obsidian/plugins/feuillets-grammalecte" } as PluginManifest;

/* `commands` vient du stub de Plugin (test/obsidian-stub.mjs), pas de l'API
   réelle : on l'expose explicitement plutôt que de caster à l'usage. */
type TestablePlugin = FeuilletsGrammalectePlugin & {
  commands: Array<{ id: string; name: string; callback?: () => void }>;
};

function makePlugin(app: App): TestablePlugin {
  return new FeuilletsGrammalectePlugin(app, MANIFEST) as TestablePlugin;
}

/* --------------------------- détection ------------------------------ */

test("détection : l'API de Feuillets est trouvée quand le greffon est actif", () => {
  const feuillets = fakeFeuillets();
  const app = fakeApp({ feuillets: feuillets.plugin });
  assert.equal(getFeuilletsApi(app), feuillets.plugin.api);
  assert.equal(isFeuilletsPresentWithoutApi(app), false);
});

test("détection : Feuillets absent — null, sans exception", () => {
  assert.equal(getFeuilletsApi(fakeApp({})), null);
  assert.equal(getFeuilletsApi(fakeApp({ "autre-greffon": {} })), null);
  // Un app sans registre de greffons du tout ne doit pas non plus lever.
  assert.equal(getFeuilletsApi({} as App), null);
});

test("détection : Feuillets présent mais trop ancien (pas d'API d'analyse)", () => {
  const app = fakeApp({ feuillets: { version: "1.4.5" } });
  assert.equal(getFeuilletsApi(app), null);
  assert.equal(isFeuilletsPresentWithoutApi(app), true);

  // Une API partielle est refusée aussi : mieux vaut un message clair qu'un
  // TypeError à la première analyse.
  const partial = fakeApp({ feuillets: { api: { registerAnalysisProvider: () => {} } } });
  assert.equal(getFeuilletsApi(partial), null);
});

/* ------------------------- cycle de vie ----------------------------- */

test("chargement : le fournisseur est enregistré auprès de Feuillets", async () => {
  const feuillets = fakeFeuillets();
  const plugin = makePlugin(fakeApp({ feuillets: feuillets.plugin }));

  await plugin.onload();

  assert.equal(plugin.isConnected, true);
  const provider = feuillets.providers.get(PROVIDER_ID);
  assert.ok(provider);
  assert.equal(provider.id, "grammalecte");
  assert.equal(provider.name, "Grammalecte");
  assert.equal(typeof provider.analyze, "function");
});

test("déchargement : le fournisseur est retiré, Feuillets reste intact", async () => {
  const feuillets = fakeFeuillets();
  const plugin = makePlugin(fakeApp({ feuillets: feuillets.plugin }));

  await plugin.onload();
  plugin.onunload();

  assert.equal(feuillets.providers.size, 0);
  assert.equal(feuillets.plugin.api.getAnalysisProvider(), null);
  assert.equal(plugin.isConnected, false);
});

test("déchargement : sans Feuillets, onunload() ne lève pas", async () => {
  const plugin = makePlugin(fakeApp({}));
  await plugin.onload();
  assert.doesNotThrow(() => plugin.onunload());
});

test("chargement : Feuillets arrivé après nous est rattrapé à la disposition prête", async () => {
  const plugins: Record<string, unknown> = {};
  const app = fakeApp(plugins);
  const plugin = makePlugin(app);

  await plugin.onload();
  assert.equal(plugin.isConnected, false, "rien à quoi se raccrocher au chargement");

  const feuillets = fakeFeuillets();
  plugins.feuillets = feuillets.plugin;
  app.runLayoutReady();

  assert.equal(plugin.isConnected, true);
  assert.equal(feuillets.providers.size, 1);
});

test("chargement : Feuillets absent — un message clair, aucun plantage", async () => {
  notices.length = 0;
  const app = fakeApp({});
  const plugin = makePlugin(app);

  await plugin.onload();
  app.runLayoutReady();

  assert.equal(plugin.isConnected, false);
  assert.match(notices.join("\n"), /Feuillets doit être installé et activé/);
});

test("rechargement de Feuillets : la commande de reconnexion ré-enregistre", async () => {
  const feuillets = fakeFeuillets();
  const plugin = makePlugin(fakeApp({ feuillets: feuillets.plugin }));
  await plugin.onload();

  // Feuillets rechargé : son registre repart vide.
  feuillets.providers.clear();

  const reconnect = plugin.commands.find((c) => c.id === "reconnect");
  assert.ok(reconnect);
  reconnect.callback?.();
  assert.equal(feuillets.providers.size, 1);
});

/* ---------------------- chargement paresseux ------------------------ */

function fakeEngine(errors: GrammalecteError[] = []): GrammalecteEngine {
  return {
    paragraphs: (text) => text.split("\n"),
    setOption: () => {},
    parse: () => errors,
    spell: () => [],
    suggest: () => [],
  };
}

test("paresse : le moteur n'est pas chargé avant la première analyse", async () => {
  let loads = 0;
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () => { loads += 1; return fakeEngine(); });

  assert.equal(loads, 0, "aucun chargement à la construction");
  assert.equal(provider.isEngineLoaded, false);

  await provider.analyze({ text: "Un texte." });
  assert.equal(loads, 1);
  assert.equal(provider.isEngineLoaded, true);

  await provider.analyze({ text: "Un autre texte." });
  assert.equal(loads, 1, "le moteur n'est chargé qu'une fois");
});

test("paresse : deux analyses simultanées ne chargent le moteur qu'une fois", async () => {
  let loads = 0;
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () => { loads += 1; return fakeEngine(); });

  await Promise.all([provider.analyze({ text: "A." }), provider.analyze({ text: "B." })]);
  assert.equal(loads, 1);
});

test("paresse : un texte vide n'entraîne aucun chargement", async () => {
  let loads = 0;
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () => { loads += 1; return fakeEngine(); });

  assert.deepEqual(await provider.analyze({ text: "   \n  " }), []);
  assert.equal(loads, 0);
});

test("paresse : un échec de chargement remonte et reste réessayable", async () => {
  let attempts = 0;
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Moteur Grammalecte introuvable");
    return fakeEngine();
  });

  await assert.rejects(() => provider.analyze({ text: "Un texte." }), /introuvable/);
  assert.equal(provider.isEngineLoaded, false, "rien de cassé n'est mis en cache");

  // Ressources déposées entre-temps : la tentative suivante réussit.
  assert.deepEqual(await provider.analyze({ text: "Un texte." }), []);
  assert.equal(provider.isEngineLoaded, true);
});

test("nettoyage : dispose() libère le moteur", async () => {
  let loads = 0;
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () => { loads += 1; return fakeEngine(); });

  await provider.analyze({ text: "Un texte." });
  provider.dispose();
  assert.equal(provider.isEngineLoaded, false);

  await provider.analyze({ text: "Un texte." });
  assert.equal(loads, 2, "après libération, le moteur est rechargé à la demande");
});

/* ------------------------ analyse de bout en bout -------------------- */

test("analyse : le fournisseur rend des signalements aux offsets du texte reçu", async () => {
  const text = "Le chat dorment.";
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () =>
    fakeEngine([
      {
        nStart: 3,
        nEnd: 16,
        sRuleId: "conf",
        sMessage: "Accord.",
        aSuggestions: ["chat dort."],
        sUnderlined: "chat dorment.",
      },
    ])
  );

  const issues = await provider.analyze({ text, filePath: "Roman/ch1.md" });

  assert.equal(issues.length, 1);
  assert.equal(text.slice(issues[0].start, issues[0].end), "chat dorment.");
  assert.equal(issues[0].ruleId, "conf");
});

test("analyse : le fournisseur ignore la sélection — Feuillets lui a déjà découpé le texte", async () => {
  const provider = new GrammalecteProvider(() => DEFAULT_SETTINGS, () =>
    fakeEngine([
      { nStart: 0, nEnd: 4, sRuleId: "r", sMessage: "m", aSuggestions: [], sUnderlined: "chat" },
    ])
  );

  // selectionStart/End sont purement informatifs : les offsets rendus restent
  // ceux du `text` transmis, c'est Feuillets qui les reconvertit.
  const issues = await provider.analyze({ text: "chat dorment", selectionStart: 120, selectionEnd: 132 });
  assert.equal(issues[0].start, 0);
  assert.equal(issues[0].end, 4);
});

/* ----------------------------- réglages ----------------------------- */

test("réglages : valeurs par défaut prudentes", () => {
  assert.deepEqual(DEFAULT_SETTINGS, { checkSpelling: true, detectRepetitions: false, maxSuggestions: 5 });
});

test("réglages : un data.json abîmé retombe sur des valeurs valides", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("bidon"), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ maxSuggestions: -4 }).maxSuggestions, 0);
  assert.equal(normalizeSettings({ maxSuggestions: 999 }).maxSuggestions, 20);
  assert.equal(normalizeSettings({ maxSuggestions: 3.7 }).maxSuggestions, 4);
  assert.equal(normalizeSettings({ checkSpelling: "oui" }).checkSpelling, true);
  assert.equal(normalizeSettings({ checkSpelling: false }).checkSpelling, false);
});

test("réglages : les réglages sont relus à chaque analyse, pas figés au chargement", async () => {
  const settings = { ...DEFAULT_SETTINGS, maxSuggestions: 1 };
  const provider = new GrammalecteProvider(() => settings, () =>
    fakeEngine([
      { nStart: 0, nEnd: 4, sRuleId: "r", sMessage: "m", aSuggestions: ["a", "b", "c"], sUnderlined: "chat" },
    ])
  );

  assert.deepEqual((await provider.analyze({ text: "chat" }))[0].suggestions, ["a"]);
  settings.maxSuggestions = 3;
  assert.deepEqual((await provider.analyze({ text: "chat" }))[0].suggestions, ["a", "b", "c"]);
});
