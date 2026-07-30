import test from "node:test";
import assert from "node:assert/strict";
import { noticeMessageEl, setButtonDestructive } from "../src/utils/obsidian-compat.js";

/* Ces ponts choisissent une API selon la version d'Obsidian hôte. On ne peut
   pas exécuter plusieurs versions d'Obsidian ici : on reproduit la forme que
   chacune expose, ce qui est exactement ce que la détection observe. */

test("noticeMessageEl : Obsidian 1.8.7+ → messageEl", () => {
  const messageEl = { tag: "message" };
  const notice = { messageEl, noticeEl: { tag: "notice" } };
  assert.equal(noticeMessageEl(notice), messageEl);
});

test("noticeMessageEl : Obsidian 1.7.2 (pas de messageEl) → noticeEl", () => {
  const noticeEl = { tag: "notice" };
  assert.equal(noticeMessageEl({ noticeEl }), noticeEl);
});

test("setButtonDestructive : Obsidian 1.13.0+ → setDestructive, jamais setWarning", () => {
  const calls = [];
  const button = {
    setDestructive() { calls.push("setDestructive"); return this; },
    setWarning() { calls.push("setWarning"); return this; },
  };
  assert.equal(setButtonDestructive(button), button);
  assert.deepEqual(calls, ["setDestructive"]);
});

test("setButtonDestructive : Obsidian < 1.13.0 → repli sur setWarning", () => {
  const calls = [];
  const button = { setWarning() { calls.push("setWarning"); return this; } };
  assert.equal(setButtonDestructive(button), button);
  assert.deepEqual(calls, ["setWarning"]);
});

test("setButtonDestructive : aucune des deux → bouton rendu tel quel, sans lever", () => {
  const button = { setButtonText() { return this; } };
  assert.equal(setButtonDestructive(button), button);
});

test("setButtonDestructive : le `this` du bouton est préservé", () => {
  /* L'appel passe par une variable intermédiaire typée : si le liage était
     perdu, `this` ne serait plus le bouton et le chaînage casserait. */
  let receiver = null;
  const button = { setDestructive() { receiver = this; return this; } };
  setButtonDestructive(button);
  assert.equal(receiver, button);
});
