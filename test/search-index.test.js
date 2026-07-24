import test from "node:test";
import assert from "node:assert/strict";
import { refreshSearchIndex } from "../src/utils/search-index.js";

const f = (path, mtime) => ({ path, stat: { mtime } });

/** Lecteur factice qui garde la trace des fiches réellement relues. */
function reader(bodies = {}) {
  const lus = [];
  const read = async (file) => {
    lus.push(file.path);
    return bodies[file.path] ?? `corps de ${file.path}`;
  };
  return { read, lus };
}

test("refreshSearchIndex : indexe toutes les fiches au premier passage", async () => {
  const { read, lus } = reader();
  const cache = await refreshSearchIndex(new Map(), [f("a.md", 1), f("b.md", 1)], read);

  assert.deepEqual(lus.sort(), ["a.md", "b.md"]);
  assert.equal(cache.get("a.md").text, "corps de a.md");
  assert.equal(cache.get("a.md").mtime, 1);
});

test("refreshSearchIndex : ne relit rien quand rien n'a changé", async () => {
  const files = [f("a.md", 1), f("b.md", 1)];
  const cache = await refreshSearchIndex(new Map(), files, reader().read);

  const { read, lus } = reader();
  await refreshSearchIndex(cache, files, read);

  assert.deepEqual(lus, []);
});

test("refreshSearchIndex : ne relit que la fiche dont la mtime a bougé", async () => {
  const cache = await refreshSearchIndex(new Map(), [f("a.md", 1), f("b.md", 1)], reader().read);

  const { read, lus } = reader({ "b.md": "nouveau corps" });
  await refreshSearchIndex(cache, [f("a.md", 1), f("b.md", 2)], read);

  assert.deepEqual(lus, ["b.md"]);
  assert.equal(cache.get("b.md").text, "nouveau corps");
  assert.equal(cache.get("b.md").mtime, 2);
});

test("refreshSearchIndex : évince les fiches disparues", async () => {
  const cache = await refreshSearchIndex(new Map(), [f("a.md", 1), f("b.md", 1)], reader().read);
  assert.equal(cache.size, 2);

  await refreshSearchIndex(cache, [f("a.md", 1)], reader().read);

  assert.equal(cache.size, 1);
  assert.equal(cache.has("b.md"), false);
});

test("refreshSearchIndex : une fiche renommée remplace l'ancienne entrée", async () => {
  const cache = await refreshSearchIndex(new Map(), [f("ancien.md", 1)], reader().read);

  const { read, lus } = reader();
  await refreshSearchIndex(cache, [f("nouveau.md", 1)], read);

  assert.deepEqual(lus, ["nouveau.md"]);
  assert.equal(cache.size, 1);
  assert.equal(cache.has("ancien.md"), false);
});

test("refreshSearchIndex : une modification pendant la lecture est rattrapée au passage suivant", async () => {
  const cache = new Map();
  const fiche = f("a.md", 1);

  // la fiche est modifiée pendant que son corps est lu
  await refreshSearchIndex(cache, [fiche], async () => {
    fiche.stat.mtime = 2;
    return "corps lu avant la modification";
  });

  // la mtime mémorisée est l'ancienne : l'écart reste visible
  assert.equal(cache.get("a.md").mtime, 1);

  const { read, lus } = reader({ "a.md": "corps à jour" });
  await refreshSearchIndex(cache, [fiche], read);

  assert.deepEqual(lus, ["a.md"]);
  assert.equal(cache.get("a.md").text, "corps à jour");
});

test("refreshSearchIndex : le cache reçu est modifié sur place et renvoyé", async () => {
  const cache = new Map();
  const retour = await refreshSearchIndex(cache, [f("a.md", 1)], reader().read);
  assert.equal(retour, cache);
});
