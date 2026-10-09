import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FeuilletsSearchEngine } from "../src/services/feuillets-search-engine.js";

describe("FeuilletsSearchEngine — buildRegex", () => {
  it("construit une regex valide avec options par défaut", () => {
    const regex = FeuilletsSearchEngine.buildRegex("Kemal", { ignoreCase: true });
    assert.ok(regex instanceof RegExp);
    assert.equal(regex.flags, "giu");
  });

  it("gère l'insensibilité aux diacritiques (accents)", () => {
    const regex = FeuilletsSearchEngine.buildRegex("heros", { ignoreDiacritics: true });
    regex.lastIndex = 0;
    assert.ok(regex.test("Héros"));
    regex.lastIndex = 0;
    assert.ok(regex.test("heros"));
  });

  it("gère le mode de correspondance mot entier (wholeWord)", () => {
    const regex = FeuilletsSearchEngine.buildRegex("Kemal", { matchMode: "wholeWord" });
    regex.lastIndex = 0;
    assert.ok(regex.test("Le héros Kemal s'avança"));
    regex.lastIndex = 0;
    assert.equal(regex.test("Kemalite"), false);
  });
});

describe("FeuilletsSearchEngine — searchInVault, marquage des notes de bas de page", () => {
  it("distingue une occurrence dans le corps d'une occurrence dans une définition de note", async () => {
    const file = { path: "Scene1.md", extension: "md" };
    const content = "Un fait notable[^1].\n\n[^1]: Voir la source citée ici.";
    const app = { vault: { read: async () => content } };
    const plugin = { getManuscriptFiles: () => [file] };
    const { occurrences } = await FeuilletsSearchEngine.searchInVault(app, plugin, "source citée", { scope: "manuscript" });
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].kind, "footnote");
  });

  it("un mot dans le texte principal reste marqué 'body'", async () => {
    const file = { path: "Scene1.md", extension: "md" };
    const content = "Un fait notable[^1].\n\n[^1]: Une note sans rapport.";
    const app = { vault: { read: async () => content } };
    const plugin = { getManuscriptFiles: () => [file] };
    const { occurrences } = await FeuilletsSearchEngine.searchInVault(app, plugin, "fait notable", { scope: "manuscript" });
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].kind, "body");
  });

  it("la recherche générale trouve le contenu des notes sans les exclure", async () => {
    const file = { path: "Scene1.md", extension: "md" };
    const content = "Texte principal sans le mot cherché.\n\n[^1]: Un indice rarissime.";
    const app = { vault: { read: async () => content } };
    const plugin = { getManuscriptFiles: () => [file] };
    const { totalCount } = await FeuilletsSearchEngine.searchInVault(app, plugin, "rarissime", { scope: "manuscript" });
    assert.equal(totalCount, 1);
  });
});

describe("FeuilletsSearchEngine — getScopedFiles", () => {
  it("filtre strictement le document actif si scope = document", () => {
    const activeFile = { path: "Scene1.md", extension: "md" };
    const files = FeuilletsSearchEngine.getScopedFiles({}, {}, "document", activeFile);
    assert.deepEqual(files, [activeFile]);
  });

  it("filtre le dossier parent du document actif si scope = manuscript", () => {
    const file1 = { path: "Folder/Scene1.md", extension: "md" };
    const file2 = { path: "Folder/Scene2.md", extension: "md" };
    const notMd = { path: "Folder/snapshot.png", extension: "png" };
    const parentFolder = { children: [file1, file2, notMd] };
    file1.parent = parentFolder;

    const files = FeuilletsSearchEngine.getScopedFiles({}, {}, "manuscript", file1);
    assert.deepEqual(files, [file1, file2]);
  });
});

// These tests apply the actual replacement engine through Editor.transaction().
const { createSearchEditor } = await import("./search-editor-helper.js");

describe("FeuilletsSearchEngine — active editor transactions", () => {
  it("replaces straight apostrophes literally in body and footnotes, preserving YAML", () => {
    const original = "---\ntitle: 'ney'\n---\nL'ami dit 'ney'.[^1]\n\n[^1]: D'autres 'mots'.";
    const editor = createSearchEditor(original);
    const result = FeuilletsSearchEngine.replaceInEditor(editor, "'", "’");
    assert.equal(editor.getValue(), "---\ntitle: 'ney'\n---\nL’ami dit ’ney’.[^1]\n\n[^1]: D’autres ’mots’." );
    assert.deepEqual(result, { totalReplacements: 6, filesCount: 1 });
    assert.equal(editor.transactions.length, 1);
    assert.equal(editor.undo(), true);
    assert.equal(editor.getValue(), original);
  });

  it("protects full emphasis and code ranges and is idempotent", () => {
    const original = [
      "ney *ney* **ney** _ney_ __ney__ ***ney***",
      "*before ney after* **before ney after** _before ney after_",
      "**before *nested ney* after** and *before\nney after*",
      "`ney` ``before ` ney after``",
      "```md\nney *ney*\n```",
      "~~~\nney\n~~~",
      "\n    ney\n",
      "[^1]: ney and *formatted ney*.",
    ].join("\n\n");
    const editor = createSearchEditor(original);
    const options = { protectMarkdown: true };
    const file = { path: "active.md" };
    const matches = FeuilletsSearchEngine.searchInText(original, file, "ney", { ...options, replacementQuery: "*ney*" });
    assert.equal(matches.length, 2);
    assert.equal(matches[1].kind, "footnote");
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, matches.length);
    assert.equal(editor.getValue(), original.replace(/^ney/, "*ney*").replace("[^1]: ney", "[^1]: *ney*"));
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, 0);
    assert.equal(editor.transactions.length, 1);
    assert.equal(FeuilletsSearchEngine.searchInText(editor.getValue(), file, "ney", { ...options, replacementQuery: "*ney*" }).length, 0);
  });

  it("keeps literal replacement available inside emphasis and code", () => {
    const editor = createSearchEditor("ney *ney* **ney** `ney`");
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*").totalReplacements, 4);
    assert.equal(editor.getValue(), "*ney* **ney** ***ney*** `*ney*`");
  });

  it("uses the exact replacement case unless preservation is explicitly requested", () => {
    const editor = createSearchEditor("NEY Ney ney money neyland");
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", { matchMode: "wholeWord", protectMarkdown: true }).totalReplacements, 3);
    assert.equal(editor.getValue(), "*ney* *ney* *ney* money neyland");
    const sensitive = createSearchEditor("NEY Ney ney");
    assert.equal(FeuilletsSearchEngine.replaceInEditor(sensitive, "ney", "x", { ignoreCase: false }).totalReplacements, 1);
    assert.equal(sensitive.getValue(), "NEY Ney x");
    const explicit = createSearchEditor("NEY Ney ney");
    FeuilletsSearchEngine.replaceInEditor(explicit, "ney", "Altan", { preserveCase: true });
    assert.equal(explicit.getValue(), "ALTAN Altan altan");
  });

  it("supports empty replacements and maps multiple directional selections", () => {
    const editor = createSearchEditor("ney hello ney end", [{ anchor: 4, head: 9 }, { anchor: 13, head: 10 }, { anchor: 17, head: 17 }]);
    const beforeSelections = editor.listSelections();
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "").totalReplacements, 2);
    assert.equal(editor.getValue(), " hello  end");
    assert.deepEqual(editor.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })), [
      { anchor: 1, head: 6 }, { anchor: 7, head: 7 }, { anchor: 11, head: 11 },
    ]);
    assert.equal(editor.undo(), true);
    assert.equal(editor.getValue(), "ney hello ney end");
    assert.deepEqual(editor.listSelections(), beforeSelections);
  });

  it("replaces hundreds of occurrences in one transaction with full undo and redo", () => {
    const original = Array.from({ length: 700 }, (_, index) => `Line ${index}: ney ney.`).join("\n");
    const editor = createSearchEditor(original, [{ anchor: original.length, head: original.length }]);
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", { protectMarkdown: true }).totalReplacements, 1400);
    const expected = original.replaceAll("ney", "*ney*");
    assert.equal(editor.getValue(), expected);
    assert.equal(editor.transactions.length, 1);
    assert.equal(editor.state.selection.main.head, expected.length);
    assert.equal(editor.undo(), true);
    assert.equal(editor.getValue(), original);
    assert.equal(editor.undo(), false);
    assert.equal(editor.redo(), true);
    assert.equal(editor.getValue(), expected);
  });

  it("searches unsaved editor text and undoes replacement separately from prior typing", async () => {
    const file = { path: "Scene.md" };
    const other = { path: "Other.md" };
    const editor = createSearchEditor("saved ney");
    editor.edit(editor.getValue().length, editor.getValue().length, " and unsaved ney");
    const unsaved = editor.getValue();
    const app = { workspace: { getActiveFile: () => file }, vault: {
      read: async () => { assert.fail("Active document must use editor text"); },
      process: async () => { assert.fail("Active document must not write vault files"); },
    } };
    const plugin = { getManuscriptFiles: () => [file, other] };
    const search = await FeuilletsSearchEngine.searchInVault(app, plugin, "ney", { activeFile: file, activeEditor: editor });
    assert.equal(search.totalCount, 2);
    assert.equal(search.filesCount, 1);
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "altan").totalReplacements, 2);
    assert.equal(editor.getValue(), "saved altan and unsaved altan");
    assert.equal(editor.undo(), true);
    assert.equal(editor.getValue(), unsaved);
    assert.equal(editor.undo(), true);
    assert.equal(editor.getValue(), "saved ney");
  });

  it("does not create transactions for no matches, invalid regex or unchanged text", () => {
    const editor = createSearchEditor("ney");
    for (const [query, replacement, options] of [["absent", "x", {}], ["[", "x", { useRegex: true }], ["ney", "ney", {}]]) {
      assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, query, replacement, options).totalReplacements, 0);
    }
    assert.equal(editor.transactions.length, 0);
    assert.equal(editor.undo(), false);
  });

  it("reports a transaction failure to the caller", () => {
    const editor = createSearchEditor("ney");
    editor.transaction = () => { throw new Error("Editor is read-only"); };
    assert.throws(() => FeuilletsSearchEngine.replaceInEditor(editor, "ney", "x"), /read-only/);
    assert.equal(editor.getValue(), "ney");
  });
});

it("shares literal escaping, accent and Unicode word matching between display and replacement", () => {
  for (const query of ["é.[x]*(n)+?$^{}|\\", "(Été)", "a+b", "[x]", "\\", "$", ".", "é?"]) {
    const content = `${query} ${query.toUpperCase()} unrelated`;
    const options = { ignoreDiacritics: true };
    const editor = createSearchEditor(content);
    const matches = FeuilletsSearchEngine.searchInText(content, { path: "Scene.md" }, query, options);
    assert.equal(matches.length, 2, query);
    assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, query, "X", options).totalReplacements, matches.length, query);
    assert.equal(editor.getValue(), "X X unrelated", query);
  }
  const editor = createSearchEditor("été Été ETE e\u0301te\u0301 étéx xété préété");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ete", "x", { ignoreDiacritics: true, matchMode: "wholeWord" }).totalReplacements, 4);
  assert.equal(editor.getValue(), "x x x x étéx xété préété");
  const sensitive = createSearchEditor("été Été ETE ete");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(sensitive, "ete", "x", { ignoreCase: false, ignoreDiacritics: true }).totalReplacements, 2);
  assert.equal(sensitive.getValue(), "x Été ETE x");
});

it("counts only formatting that Markdown can apply safely inside words", () => {
  const content = "ney neyland money *ney*";
  const editor = createSearchEditor(content);
  const options = { protectMarkdown: true };
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, 3);
  assert.equal(editor.getValue(), "*ney* *ney*land mo*ney* *ney*");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, 0);
  const underscores = createSearchEditor(content);
  const matches = FeuilletsSearchEngine.searchInText(content, { path: "active.md" }, "ney", { ...options, replacementQuery: "_ney_" });
  assert.equal(matches.length, 1);
  assert.equal(FeuilletsSearchEngine.replaceInEditor(underscores, "ney", "_ney_", options).totalReplacements, matches.length);
  assert.equal(underscores.getValue(), "_ney_ neyland money *ney*");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(underscores, "ney", "_ney_", options).totalReplacements, 0);
});

it("rejects silently refused transactions without reporting replacements", () => {
  const editor = createSearchEditor("ney");
  editor.transaction = () => {};
  assert.throws(() => FeuilletsSearchEngine.replaceInEditor(editor, "ney", "altan"), /rejected/);
  assert.equal(editor.getValue(), "ney");
});

it("formats single-word and continued footnotes using their Markdown content", () => {
  const content = "ney[^1]\n\n[^1]: ney\n\n    ney and *ney* and **ney**\n\n    ```\n    ney\n    ```\n\n        ney\n\n[^2]: *ney*";
  const editor = createSearchEditor(content);
  const options = { protectMarkdown: true };
  const matches = FeuilletsSearchEngine.searchInText(content, { path: "active.md" }, "ney", { ...options, replacementQuery: "*ney*" });
  assert.equal(matches.length, 3);
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, 3);
  assert.equal(editor.getValue(), "*ney*[^1]\n\n[^1]: *ney*\n\n    *ney* and *ney* and **ney**\n\n    ```\n    ney\n    ```\n\n        ney\n\n[^2]: *ney*");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "ney", "*ney*", options).totalReplacements, 0);
});

it("protects wrapping with explicit case changes while respecting case-sensitive search", () => {
  const editor = createSearchEditor("NEY Ney ney *NEY* **NEY**");
  const options = { protectMarkdown: true, ignoreCase: false };
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "NEY", "*ney*", options).totalReplacements, 1);
  assert.equal(editor.getValue(), "*ney* Ney ney *NEY* **NEY**");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(editor, "NEY", "*ney*", options).totalReplacements, 0);
  const insensitive = createSearchEditor("NEY Ney ney *Ney*");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(insensitive, "NEY", "*ney*", { protectMarkdown: true }).totalReplacements, 3);
  assert.equal(insensitive.getValue(), "*ney* *ney* *ney* *Ney*");
  assert.equal(FeuilletsSearchEngine.replaceInEditor(insensitive, "NEY", "*ney*", { protectMarkdown: true }).totalReplacements, 0);
});

it("retains explicit vault scope replacement using shared literal and YAML rules", async () => {
  const files = [{ path: "first.md", extension: "md" }, { path: "second.md", extension: "md" }];
  const contents = new Map([[files[0].path, "---\ntitle: Ney\n---\nNEY ney"], [files[1].path, "No match"]]);
  const app = { vault: { process: async (file, callback) => contents.set(file.path, callback(contents.get(file.path))) } };
  const plugin = { getManuscriptFiles: () => files };
  assert.deepEqual(await FeuilletsSearchEngine.replaceInVault(app, plugin, "ney", "X", { scope: "manuscript" }), { totalReplacements: 2, filesCount: 1 });
  assert.equal(contents.get(files[0].path), "---\ntitle: Ney\n---\nX X");
  assert.equal(contents.get(files[1].path), "No match");
  assert.deepEqual(await FeuilletsSearchEngine.replaceInVault(app, plugin, "X", "", { activeFile: files[0] }), { totalReplacements: 2, filesCount: 1 });
  assert.equal(contents.get(files[0].path), "---\ntitle: Ney\n---\n ");
});
