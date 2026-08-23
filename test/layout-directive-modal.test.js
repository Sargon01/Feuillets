import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutDirectiveModal } from "../src/ui/layout-directive-modal.js";
import { resolveLayoutDirectiveContext } from "../src/utils/editor-layout-directives.js";

/* Même FakeElement minimal que test/canvas-chapter-integration.test.js —
 * suffisamment riche pour exercer le VRAI Setting natif du stub Obsidian
 * (container.createDiv/createEl), jamais un DOM du navigateur. */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const n of String(names).split(" ")) if (n) this.classes.add(n); }
  setText(text) { this.text = String(text); return this; }
  addEventListener(type, cb) { this.events.set(type, cb); }
  trigger(type, event = {}) { return this.events.get(type)?.(event); }
  empty() { this.children = []; }
}

function openModal(context, onApply = () => {}) {
  const modal = new LayoutDirectiveModal({}, context, onApply);
  modal.contentEl = new FakeElement();
  modal.onOpen();
  return modal;
}

function settingsOf(modal) {
  return modal.contentEl._settings || [];
}

function findButton(modal, text) {
  const found = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (child.tag === "button" && child.text === text) found.push(child);
      walk(child);
    }
  };
  walk(modal.contentEl);
  return found[0];
}

test("§44 — aucune mutation lors de l'ouverture", () => {
  let applied = 0;
  const ctx = resolveLayoutDirectiveContext("![[image.png]]", 0);
  openModal(ctx, () => { applied++; });
  assert.equal(applied, 0);
});

test("§44 — Annuler : aucune mutation, la modale se ferme", () => {
  let applied = 0;
  let closed = 0;
  const ctx = resolveLayoutDirectiveContext("![[image.png]]", 0);
  const modal = openModal(ctx, () => { applied++; });
  modal.close = () => { closed++; };
  findButton(modal, "Annuler").trigger("click");
  assert.equal(applied, 0);
  assert.equal(closed, 1);
});

test("§44 — Escape (fermeture sans clic Appliquer) : aucune mutation", () => {
  let applied = 0;
  const ctx = resolveLayoutDirectiveContext("![[image.png]]", 0);
  const modal = openModal(ctx, () => { applied++; });
  modal.onClose(); // Obsidian appelle onClose() sur Escape comme sur tout close()
  assert.equal(applied, 0);
});

test("§44 — Appliquer : callback appelé une seule fois avec les valeurs choisies", () => {
  const calls = [];
  const ctx = resolveLayoutDirectiveContext("![[image.png]]", 0);
  const modal = openModal(ctx, (result) => calls.push(result));
  const [placementSetting, widthSetting] = settingsOf(modal);
  placementSetting.controls[0].select("droite");
  widthSetting.controls[0].select("60");

  findButton(modal, "Appliquer").trigger("click");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { image: { placement: "droite", width: 60 } });
});

test("§44 — image seule : contrôles 3A présents (Disposition + Largeur)", () => {
  const ctx = resolveLayoutDirectiveContext("![[image.png]]", 0);
  const modal = openModal(ctx);
  const settings = settingsOf(modal);
  assert.equal(settings.length, 2);
  assert.equal(settings[0].name, "Disposition");
  assert.equal(settings[1].name, "Largeur");
});

test("§44 — aucune section image quand le premier bloc n'est pas une image (texte-image)", () => {
  const ctx = resolveLayoutDirectiveContext("Texte.\n\n![[image.png]]", 0);
  const modal = openModal(ctx);
  assert.equal(ctx.image, null);
  const settings = settingsOf(modal);
  // Seule la section pairing est présente (relation + ratio), jamais Disposition/Largeur.
  assert.ok(!settings.some((s) => s.name === "Disposition" && s.controls[0]?.options?.some((o) => o.value === "gauche")));
});

test("§44 — composition existante : ratio actuel préempli", () => {
  const text = "%% colonnes: image-texte 40/60 %%\n\n![[image.png]]\n\nTexte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  const modal = openModal(ctx);
  const settings = settingsOf(modal);
  const ratioSetting = settings.find((s) => s.name === "Ratio");
  assert.ok(ratioSetting);
  assert.equal(ratioSetting.controls[0].value, "40/60");
  // Bouton "Retirer la disposition" disponible pour une composition déjà écrite.
  assert.ok(findButton(modal, "Retirer la disposition"));
});

test("§44 — Dessous absent pour un callout natif Obsidian", () => {
  const text = "![[image.png]]\n\n> [!note] Remarque\n> Texte.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  const modal = openModal(ctx);
  const settings = settingsOf(modal);
  const relationSetting = settings.find((s) => s.controls[0]?.options?.some((o) => o.value === "colonnes"));
  assert.ok(relationSetting);
  assert.equal(relationSetting.controls[0].options.some((o) => o.value === "dessous"), false);
});

test("§44 — Dessous présent pour un rôle sémantique admissible", () => {
  const text = "![[image.png]]\n\n> [!solution] Titre\n> Contenu.";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  const modal = openModal(ctx);
  const settings = settingsOf(modal);
  const relationSetting = settings.find((s) => s.controls[0]?.options?.some((o) => o.value === "colonnes"));
  assert.equal(relationSetting.controls[0].options.some((o) => o.value === "dessous"), true);
});

test("§44 — Retirer la disposition : callback avec relation auto, ferme la modale", () => {
  const calls = [];
  const text = "%% colonnes: image-image 50/50 %%\n\n![[a.png]]\n\n![[b.png]]";
  const ctx = resolveLayoutDirectiveContext(text, 0);
  const modal = openModal(ctx, (result) => calls.push(result));
  let closed = 0;
  modal.close = () => { closed++; };
  findButton(modal, "Retirer la disposition").trigger("click");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].pairing, { relation: "auto" });
  assert.equal(closed, 1);
});
