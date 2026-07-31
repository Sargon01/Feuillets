import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { FolderSuggest } from "../src/ui/folder-suggest.js";

function vaultTree() {
  const root = new TFolder("/");
  const romans = new TFolder("Romans");
  const roman1 = new TFolder("Romans/Roman1");
  const manuscrit = new TFolder("Romans/Roman1/Manuscrit");
  const recherche = new TFolder("Recherche");
  root.children = [romans, recherche];
  romans.children = [roman1];
  roman1.children = [manuscrit];
  return { root, romans, roman1, manuscrit, recherche };
}

function suggestFor(root) {
  const app = { vault: { getRoot: () => root } };
  const inputEl = { value: "" };
  return new FolderSuggest(app, inputEl);
}

test("FolderSuggest : liste tous les dossiers du coffre, triés, racine exclue", () => {
  const { root } = vaultTree();
  const suggest = suggestFor(root);

  const paths = suggest.getSuggestions("").map((f) => f.path);

  assert.deepEqual(paths, ["Recherche", "Romans", "Romans/Roman1", "Romans/Roman1/Manuscrit"]);
});

test("FolderSuggest : filtre insensible à la casse sur le chemin complet", () => {
  const { root } = vaultTree();
  const suggest = suggestFor(root);

  const paths = suggest.getSuggestions("roman1").map((f) => f.path);

  assert.deepEqual(paths, ["Romans/Roman1", "Romans/Roman1/Manuscrit"]);
});

test("FolderSuggest : aucune correspondance renvoie une liste vide", () => {
  const { root } = vaultTree();
  const suggest = suggestFor(root);

  assert.deepEqual(suggest.getSuggestions("inexistant"), []);
});

test("FolderSuggest : renderSuggestion affiche le chemin complet", () => {
  const { root, manuscrit } = vaultTree();
  const suggest = suggestFor(root);
  const el = { text: "", setText(t) { this.text = t; } };

  suggest.renderSuggestion(manuscrit, el);

  assert.equal(el.text, "Romans/Roman1/Manuscrit");
});
