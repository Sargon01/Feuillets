import test from "node:test";
import assert from "node:assert/strict";
import { refreshContentCache, cleanMarkdownBody } from "../src/services/context-content-cache.js";

const f = (path, mtime, extra = {}) => ({
  path,
  basename: path.replace(/\.md$/, ""),
  title: extra.title ?? path.replace(/\.md$/, ""),
  sourceKind: extra.sourceKind ?? "feuillet",
  sourcePriority: extra.sourcePriority ?? 0,
  stat: { mtime },
});

function reader(bodies = {}) {
  const lus = [];
  const read = async (file) => {
    lus.push(file.path);
    return bodies[file.path] ?? `corps de ${file.path}`;
  };
  return { read, lus };
}

test("refreshContentCache : lit toutes les fiches au premier passage, dans l'ordre de `files`", async () => {
  const { read, lus } = reader();
  const entries = await refreshContentCache(new Map(), [f("a.md", 1), f("b.md", 1)], read);

  assert.deepEqual(lus.sort(), ["a.md", "b.md"]);
  assert.deepEqual(entries.map((e) => e.path), ["a.md", "b.md"]);
  assert.equal(entries[0].cleanedBody, "corps de a.md");
});

test("refreshContentCache : ne relit rien quand la mtime n'a pas changé", async () => {
  const files = [f("a.md", 1), f("b.md", 1)];
  const cache = new Map();
  await refreshContentCache(cache, files, reader().read);

  const { read, lus } = reader();
  await refreshContentCache(cache, files, read);

  assert.deepEqual(lus, []);
});

test("refreshContentCache : ne relit que la fiche dont la mtime a changé", async () => {
  const cache = new Map();
  await refreshContentCache(cache, [f("a.md", 1), f("b.md", 1)], reader().read);

  const { read, lus } = reader({ "b.md": "nouveau corps" });
  await refreshContentCache(cache, [f("a.md", 1), f("b.md", 2)], read);

  assert.deepEqual(lus, ["b.md"]);
  assert.equal(cache.get("b.md").cleanedBody, "nouveau corps");
  assert.equal(cache.get("b.md").mtime, 2);
});

test("refreshContentCache : rafraîchit la source/priorité sans relire le disque si la mtime n'a pas bougé", async () => {
  const cache = new Map();
  await refreshContentCache(cache, [f("a.md", 1, { sourceKind: "feuillet", sourcePriority: 0 })], reader().read);

  const { read, lus } = reader();
  const entries = await refreshContentCache(
    cache,
    [f("a.md", 1, { sourceKind: "chapter", sourcePriority: 10 })],
    read
  );

  assert.deepEqual(lus, []); // aucune relecture disque
  assert.equal(entries[0].sourceKind, "chapter");
  assert.equal(entries[0].sourcePriority, 10);
});

test("refreshContentCache : évince les fiches supprimées, déplacées ou sorties du périmètre", async () => {
  const cache = new Map();
  await refreshContentCache(cache, [f("a.md", 1), f("b.md", 1)], reader().read);
  assert.equal(cache.size, 2);

  await refreshContentCache(cache, [f("a.md", 1)], reader().read);

  assert.equal(cache.size, 1);
  assert.equal(cache.has("b.md"), false);
});

test("refreshContentCache : une fiche renommée/déplacée relit sous le nouveau chemin", async () => {
  const cache = new Map();
  await refreshContentCache(cache, [f("ancien.md", 1)], reader().read);

  const { read, lus } = reader();
  await refreshContentCache(cache, [f("nouveau.md", 1)], read);

  assert.deepEqual(lus, ["nouveau.md"]);
  assert.equal(cache.size, 1);
  assert.equal(cache.has("ancien.md"), false);
});

test("cleanMarkdownBody : retire le frontmatter YAML", () => {
  const raw = "---\ntitle: Fiche\ntags: [a, b]\n---\nTexte réel.";
  assert.equal(cleanMarkdownBody(raw), "Texte réel.");
});

test("cleanMarkdownBody : retire les blocs de code et le code en ligne", () => {
  const raw = "Avant.\n```js\nconst x = 1;\n```\nAprès `inline()` fin.";
  const cleaned = cleanMarkdownBody(raw);
  assert.equal(cleaned.includes("const x"), false);
  assert.equal(cleaned.includes("inline()"), false);
  assert.ok(cleaned.includes("Avant."));
  assert.ok(cleaned.includes("Après"));
  assert.ok(cleaned.includes("fin."));
});

test("cleanMarkdownBody : retire les embeds et conserve le texte lisible des liens", () => {
  const raw = "Voir ![[carte.png]] et [[Personnage/Jean Dupont|Jean]] ainsi que [[Lieu/Paris]] et [le port](https://example.com/port).";
  const cleaned = cleanMarkdownBody(raw);
  assert.equal(cleaned.includes("carte.png"), false);
  assert.equal(cleaned.includes("https://example.com"), false);
  assert.ok(cleaned.includes("Jean"));
  assert.ok(cleaned.includes("Paris"));
  assert.ok(cleaned.includes("le port"));
});

test("cleanMarkdownBody : neutralise les marqueurs Markdown sans perdre le texte", () => {
  const raw = "# Titre\n\n> Une citation\n\n- item un\n- item deux\n\n**gras** et *italique* et ~~barré~~.";
  const cleaned = cleanMarkdownBody(raw);
  assert.equal(cleaned.includes("#"), false);
  assert.equal(cleaned.includes("**"), false);
  assert.ok(cleaned.includes("Titre"));
  assert.ok(cleaned.includes("Une citation"));
  assert.ok(cleaned.includes("item un"));
  assert.ok(cleaned.includes("gras"));
  assert.ok(cleaned.includes("italique"));
  assert.ok(cleaned.includes("barré"));
});

test("cleanMarkdownBody : fiche vide ou uniquement YAML → chaîne vide", () => {
  assert.equal(cleanMarkdownBody(""), "");
  assert.equal(cleanMarkdownBody("---\ntitle: X\n---\n"), "");
});
