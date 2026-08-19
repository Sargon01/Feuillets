import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { createDefaultWritingActionRegistry } from "../src/writing-toolbar/writing-action-registry.js";
import { WritingToolbar } from "../src/writing-toolbar/writing-toolbar.js";
import { WritingToolbarController } from "../src/writing-toolbar/writing-toolbar-controller.js";

/* DOM factice, même convention que les autres tests du dépôt (comparison-
   harness, preview-view.test.js) : pas de jsdom, des FakeElement construits
   à la main. La largeur réelle de la barre est lue via clientWidth/scrollWidth ;
   ici scrollWidth est calculé depuis le modèle de largeurs par action pour
   simuler fidèlement le navigateur sans constante arbitraire côté TS. */

const PRESET = [
  "history-back",
  "history-forward",
  "writing-settings",
  "footnote",
  "annotation",
  "preview",
  "focus",
  "reorganize",
];

const WIDTHS = {
  "history-back": 40,
  "history-forward": 40,
  "writing-settings": 30,
  "footnote": 50,
  "annotation": 60,
  "preview": 50,
  "focus": 50,
  "reorganize": 60,
  "more": 25,
  "sep": 10,
  fallback: 40,
};

/* Somme pleine largeur : 8 actions (380) + 5 séparateurs (50) + « … » (25). */
const FULL_WIDTH = PRESET.reduce((sum, id) => sum + WIDTHS[id], 0) + 5 * WIDTHS.sep + WIDTHS.more;

class FakeEl {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.attrs = { ...(options.attr ?? {}) };
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
      removeProperty(name) {
        delete this[name];
      },
    };
    this.events = new Map();
    this.text = options.text ?? "";
    this.parent = null;
    this.disabled = false;
    this._clientWidth = 0;
    this.widthModel = null;
    if (typeof options.cls === "string") this.addClass(options.cls);
  }
  get clientWidth() { return this._clientWidth; }
  set clientWidth(value) { this._clientWidth = value; }
  get scrollWidth() {
    let total = 0;
    for (const child of this.children) {
      if (child.tag === "div" && child.classes.has("feuillets-writing-toolbar-separator")) {
        total += WIDTHS.sep;
      } else {
        const id = child.attrs["data-action-id"] ?? child.attrs["data-more"];
        total += WIDTHS[id] ?? WIDTHS.fallback;
      }
    }
    return total;
  }
  createEl(tag, options = {}) {
    const child = new FakeEl(tag, options);
    child.parent = this;
    child.widthModel = this.widthModel;
    child._clientWidth = this._clientWidth;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of String(names).split(" ")) if (name) this.classes.add(name); }
  removeClass(names) { for (const name of String(names).split(" ")) this.classes.delete(name); }
  toggleClass(name, on) { (on ? this.addClass.bind(this) : this.removeClass.bind(this))(name); }
  hasClass(name) { return this.classes.has(name); }
  setText(text) { this.text = String(text); return this; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  removeEventListener(type, callback) { if (this.events.get(type) === callback) this.events.delete(type); }
  empty() { this.children = []; }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches(selector)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    const attr = selector.match(/^\[([a-z-]+)(?:='([^']*)')?\]$/);
    if (attr) {
      const name = attr[1];
      if (attr[2] !== undefined) return this.attrs[name] === attr[2];
      return name in this.attrs;
    }
    return this.tag === selector;
  }
  getBoundingClientRect() {
    return this.rect ?? { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 };
  }
}

function makeContext(kind = "markdown") {
  const hostEl = new FakeEl("div", { cls: "view-content" });
  hostEl.widthModel = {};
  hostEl.clientWidth = 1000;
  return { kind, hostEl };
}

function barOf(context) {
  return context.hostEl.querySelector(".feuillets-writing-toolbar");
}

function buttonsOf(context) {
  const bar = barOf(context);
  return bar ? bar.querySelectorAll(".feuillets-writing-toolbar-item") : [];
}

/** Installe minuteurs/frames contrôlés à la main, ResizeObserver factice et
 *  un host prêt à recevoir une barre — même patron que preview-view.test.js. */
function createHarness() {
  const timers = new Map();
  let nextTimer = 1;
  const win = {
    setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); },
  };
  globalThis.window = win;
  const roInstances = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.observed = []; roInstances.push(this); }
    observe(el) { this.observed.push(el); }
    disconnect() { this.observed = []; }
    trigger() { this.callback(); }
  };
  /* Fausse status bar native, régie par le test : présence (hideStatusBar)
     et géométrie (rect/computedStyle) pilotent syncStatusBarGeometry. Une
     rect par défaut HORS du host (left 2000 > host right 1000) : la largeur
     responsive disponible reste la largeur réelle de la barre. */
  const statusBarEl = new FakeEl("div", { cls: "status-bar" });
  statusBarEl.computedStyle = { display: "flex", visibility: "visible" };
  statusBarEl.rect = { top: 300, bottom: 328, left: 2000, right: 2100, width: 100, height: 28 };
  let statusBarPresent = true;
  globalThis.document = {
    querySelector: (selector) => {
      if (selector === ".status-bar") return statusBarPresent ? statusBarEl : null;
      return null;
    },
  };
  globalThis.getComputedStyle = (el) => el.computedStyle ?? {};
  const context = makeContext();
  context.hostEl.rect = { top: 0, bottom: 300, left: 0, right: 1000, width: 1000, height: 300 };
  return {
    roInstances,
    context,
    statusBar: statusBarEl,
    hideStatusBar() { statusBarPresent = false; },
    /** Joue les frames en attente (fin du debounce ResizeObserver → rAF). */
    runFrames() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    pending() { return timers.size; },
    /** Redimensionne la barre puis laisse le relayout différé s'exécuter. */
    resizeTo(width) {
      barOf(context).clientWidth = width;
      for (const ro of roInstances) ro.trigger();
      this.runFrames();
    },
  };
}

test("socle — DEFAULT_SETTINGS : mode « always », position « bottom »", () => {
  assert.equal(DEFAULT_SETTINGS.writingToolbarMode, "always");
  assert.equal(DEFAULT_SETTINGS.writingToolbarPosition, "bottom");
});

test("registre — preset Auteur : ordre, groupes, priorités et split exacts", () => {
  const definitions = createDefaultWritingActionRegistry().definitions();
  assert.deepEqual(
    definitions.map((def) => def.id),
    PRESET
  );
  assert.deepEqual(
    definitions.map((def) => def.group),
    ["navigation", "navigation", "writing", "notes", "notes", "view", "view", "structure"]
  );
  assert.deepEqual(
    definitions.map((def) => def.priority),
    [100, 100, 90, 80, 80, 70, 70, 60]
  );
  assert.equal(definitions.find((def) => def.id === "annotation")?.split, true);
  assert.equal(definitions.find((def) => def.id === "history-back")?.split, undefined);
});

test("registre — sans handler : canRun false, run() no-op sûr", () => {
  const registry = createDefaultWritingActionRegistry();
  const context = makeContext();
  for (const id of PRESET) {
    assert.equal(registry.canRun(id, context), false, `${id} ne peut pas tourner`);
    assert.doesNotThrow(() => registry.run(id, context), `${id} doit rester un no-op sûr`);
  }
});

test("registre — avec handler factice : canRun true, run reçoit EXACTEMENT le WritingContext", () => {
  const registry = createDefaultWritingActionRegistry();
  const received = [];
  registry.registerHandler(PRESET[0], (context) => { received.push(context); });
  registry.registerHandler(PRESET[6], async (context) => { await Promise.resolve(); received.push(context); });
  const context = makeContext();

  assert.equal(registry.canRun(PRESET[0], context), true);
  assert.equal(registry.canRun(PRESET[6], context), true);
  assert.equal(registry.canRun(PRESET[1], context), false);

  registry.run(PRESET[0], context);
  return registry.run(PRESET[6], context).then(() => {
    assert.equal(received.length, 2, "le handler async doit s'exécuter lui aussi");
    assert.equal(received[0], context, "même référence d'objet WritingContext");
    assert.equal(received[1], context);
  });
});

test("rendu — une seule barre, ordre du preset, séparateurs de groupes, « … » toujours présente", () => {
  const harness = createHarness();
  const registry = createDefaultWritingActionRegistry();
  const toolbar = new WritingToolbar({ context: harness.context, registry, position: "bottom", mode: "always" });

  const bar = barOf(harness.context);
  assert.ok(bar, "une barre doit être montée");
  assert.equal(buttonsOf(harness.context).length, PRESET.length + 1, "8 actions + « … »");

  const ids = bar.querySelectorAll("[data-action-id]").map((button) => button.getAttribute("data-action-id"));
  assert.deepEqual(ids, PRESET, "les actions sont rendues dans l'ordre du preset");

  const separators = bar.querySelectorAll(".feuillets-writing-toolbar-separator");
  assert.equal(separators.length, 5, "un séparateur entre chaque groupe visible + un avant « … »");

  const more = bar.querySelector("[data-more]");
  assert.ok(more, "le bouton « … » est toujours rendu");
  assert.equal(more.text, "\u2026");

  assert.equal(harness.pending(), 0, "aucune frame en attente : layout initial stable");
  toolbar.destroy();
});

test("sélection — mousedown sur un bouton appelle preventDefault()", () => {
  const harness = createHarness();
  const registry = createDefaultWritingActionRegistry();
  const toolbar = new WritingToolbar({ context: harness.context, registry, position: "bottom", mode: "always" });

  const button = barOf(harness.context).querySelector("[data-action-id='history-back']");
  let prevented = false;
  button.events.get("mousedown")({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, "cliquer dans la Barre ne doit pas faire perdre la sélection CodeMirror");

  toolbar.destroy();
});

test("position — bottom et top produisent les classes attendues et basculent", () => {
  const harness = createHarness();
  const registry = createDefaultWritingActionRegistry();
  const toolbar = new WritingToolbar({ context: harness.context, registry, position: "bottom", mode: "always" });

  const bar = barOf(harness.context);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-bottom"), true);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-top"), false);

  toolbar.setPosition("top");
  assert.equal(bar.hasClass("feuillets-writing-toolbar-top"), true);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-bottom"), false);

  toolbar.destroy();
});

test("always — visible sans override, aucun état masquant", () => {
  const harness = createHarness();
  const registry = createDefaultWritingActionRegistry();
  const toolbar = new WritingToolbar({ context: harness.context, registry, position: "bottom", mode: "always" });

  const bar = barOf(harness.context);
  assert.equal(bar.hasClass("is-override-show"), false);
  assert.equal(bar.hasClass("is-override-hide"), false);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-hover"), false);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-shortcut"), false);

  toolbar.destroy();
});

test("shortcut — masquée au départ, toggleSessionVisibility → visible, second toggle → masquée", () => {
  const harness = createHarness();
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());
  controller.sync(harness.context, "shortcut", "bottom");

  const bar = barOf(harness.context);
  assert.ok(bar, "une barre est montée en mode shortcut");
  assert.equal(bar.hasClass("feuillets-writing-toolbar-shortcut"), true);
  assert.equal(bar.hasClass("is-override-show"), false, "masquée au départ");

  controller.toggleSessionVisibility();
  assert.equal(bar.hasClass("is-override-show"), true, "premier toggle → visible");

  controller.toggleSessionVisibility();
  assert.equal(bar.hasClass("is-override-hide"), true, "second toggle → masquée");
  assert.equal(bar.hasClass("is-override-show"), false);

  controller.destroy();
});

test("always — override null au départ, premier toggle → hide, second → show", () => {
  const harness = createHarness();
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());
  controller.sync(harness.context, "always", "bottom");

  const bar = barOf(harness.context);
  assert.ok(bar, "une barre est montée en mode always");
  assert.equal(controller.override, null, "aucun override au départ");

  controller.toggleSessionVisibility();
  assert.equal(controller.override, "hide", "always : null → hide");
  assert.equal(bar.hasClass("is-override-hide"), true, "la barre est masquée");

  controller.toggleSessionVisibility();
  assert.equal(controller.override, "show", "always : hide → show");
  assert.equal(bar.hasClass("is-override-show"), true, "la barre est révélée");

  controller.destroy();
});

test("disabled — aucune barre montée, le toggle n'en crée pas", () => {
  const harness = createHarness();
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());
  controller.sync(harness.context, "disabled", "bottom");

  assert.equal(controller.toolbar, null);
  assert.equal(barOf(harness.context), null, "rien n'est monté en mode désactivé");

  controller.toggleSessionVisibility();
  assert.equal(controller.override, null, "le toggle sur disabled reste un no-op strict");
  controller.refresh("disabled", "bottom");
  assert.equal(controller.toolbar, null, "le toggle ne force jamais l'apparition en mode désactivé");
  assert.equal(barOf(harness.context), null);
  assert.equal(controller.override, null, "override toujours null après le refresh");
  controller.destroy();
});

test("hover — classes d'état de révélation posées, aucun déplacement DOM", () => {
  const harness = createHarness();
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());
  controller.sync(harness.context, "hover", "bottom");

  const bar = barOf(harness.context);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-hover"), true);
  assert.equal(bar.hasClass("feuillets-writing-toolbar-bottom"), true, "position inchangée");
  assert.equal(harness.context.hostEl.hasClass("feuillets-writing-toolbar-host"), true);
  assert.equal(bar.hasClass("is-override-show"), false, "repli sur le hover hors survol");

  controller.destroy();
});

test("override — conservé quand on remplace le contexte Markdown par un autre contexte", () => {
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());

  const first = makeContext();
  const second = makeContext();
  controller.sync(first, "always", "bottom");
  controller.toggleSessionVisibility(); // null → hide
  controller.toggleSessionVisibility(); // hide → show
  assert.equal(controller.override, "show");
  assert.equal(barOf(first).hasClass("is-override-show"), true);

  controller.sync(second, "always", "bottom"); // même mode, host différent
  assert.equal(controller.override, "show", "l'override survit au changement de contexte");
  assert.equal(barOf(first), null, "l'ancienne barre a été démontée");
  assert.ok(barOf(second), "une nouvelle barre est montée sur le nouveau contexte");
  assert.equal(barOf(second).hasClass("is-override-show"), true, "l'override est réappliqué");

  controller.destroy();
  assert.equal(barOf(second), null);
});

test("responsive — Réorganiser part d'abord, puis par priorité, retour automatique, « … » jamais perdue", () => {
  const harness = createHarness();
  const registry = createDefaultWritingActionRegistry();
  const toolbar = new WritingToolbar({ context: harness.context, registry, position: "bottom", mode: "always" });
  assert.equal(FULL_WIDTH, 455, "largeur de référence de la ligne complète");
  assert.deepEqual(toolbar.overflowed, [], "largeur par défaut : tout tient");

  /* Réorganiser (priorité 60) est la seule perdue quand il manque 55px. */
  harness.resizeTo(400);
  assert.deepEqual(toolbar.overflowed, ["reorganize"], "priorité la plus faible → overflow en premier");
  let ids = barOf(harness.context).querySelectorAll("[data-action-id]").map((b) => b.getAttribute("data-action-id"));
  assert.deepEqual(ids, ["history-back", "history-forward", "writing-settings", "footnote", "annotation", "preview", "focus"]);

  /* Réduction supplémentaire : les priorités montent dans l'ordre (égalité →
     la plus à droite d'abord : focus avant preview, annotation avant footnote).
     `overflowed` est exprimé dans l'ordre du preset — on compare des ensembles
     triés pour prouver le gradient de retrait étape par étape. */
  const sorted = (ids) => [...ids].sort();
  harness.resizeTo(350);
  assert.deepEqual(sorted(toolbar.overflowed), ["focus", "reorganize"], "puis focus (droite des deux 70)");
  harness.resizeTo(300);
  assert.deepEqual(sorted(toolbar.overflowed), ["focus", "preview", "reorganize"], "puis preview");
  harness.resizeTo(240);
  assert.deepEqual(sorted(toolbar.overflowed), ["annotation", "focus", "preview", "reorganize"], "puis annotation (droite des deux 80)");
  harness.resizeTo(200);
  assert.deepEqual(sorted(toolbar.overflowed), ["annotation", "focus", "footnote", "preview", "reorganize"], "puis footnote");

  /* Pire cas : tout passe en overflow, la barre ne garde que « … » (le
     dernier retrait retire aussi le séparateur de groupe libéré). */
  harness.resizeTo(60);
  assert.deepEqual(toolbar.overflowed, PRESET);
  assert.ok(barOf(harness.context).querySelector("[data-more]"), "« … » reste visible même totalement seul");

  /* La largeur revient : les actions reprennent leur place, dans l'ordre
     d'origine, sans perte. */
  harness.resizeTo(900);
  assert.deepEqual(toolbar.overflowed, []);
  ids = barOf(harness.context).querySelectorAll("[data-action-id]").map((b) => b.getAttribute("data-action-id"));
  assert.deepEqual(ids, PRESET, "retour dans l'ordre du preset");
  assert.ok(barOf(harness.context).querySelector("[data-more]"), "« … » jamais disparue");

  toolbar.destroy();
});

test("CSS — position basse : bottom: 0, aucun offset vertical résiduel", () => {
  const css = readFileSync("styles.css", "utf8");
  const block = css.match(/\.feuillets-writing-toolbar-bottom\s*\{[^{}]*\}/);
  assert.ok(block, "la règle .feuillets-writing-toolbar-bottom doit exister");
  assert.equal(block[0].includes("bottom: 0"), true, "collée au bord inférieur de la vue");
  assert.equal(block[0].includes("bottom: var(--size-4-2)"), false, "aucun offset vertical résiduel");
});

test("CSS — hauteur pilotée par la status bar, padding vertical nul, grammaire status bar", () => {
  const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.match(/\.feuillets-writing-toolbar\s*\{[^{}]*\}/);
  assert.ok(block, "le bloc principal .feuillets-writing-toolbar doit exister");
  assert.equal(
    block[0].includes("height: var(--feuillets-writing-toolbar-status-height, auto)"),
    true,
    "hauteur = variable status bar, fallback auto"
  );
  assert.equal(block[0].includes("box-sizing: border-box"), true);
  assert.equal(block[0].includes("padding: 0 var(--size-4-2)"), true, "padding vertical nul");
  assert.equal(block[0].includes("padding: var(--size-2-2) var(--size-4-2)"), false);
  assert.equal(block[0].includes("box-shadow: none"), true, "plus de carte flottante");
  assert.equal(block[0].includes("var(--status-bar-background"), true);
  assert.equal(block[0].includes("var(--status-bar-text-color"), true);
  assert.equal(block[0].includes("var(--status-bar-font-size"), true);
  assert.equal(block[0].includes("var(--status-bar-radius"), true);
});

test("CSS — compacte : right auto, width max-content, max-width, plus de right: var(--size-4-4)", () => {
  const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.match(/\.feuillets-writing-toolbar\s*\{[^{}]*\}/);
  assert.ok(block, "le bloc principal .feuillets-writing-toolbar doit exister");
  assert.equal(block[0].includes("right: auto"), true, "right: auto → la barre s'arrête au contenu");
  assert.equal(block[0].includes("width: max-content"), true, "width: max-content");
  assert.equal(block[0].includes("max-width:"), true, "max-width présent (plafond responsive)");
  assert.equal(block[0].includes("right: var(--size-4-4)"), false, "plus aucun right: var(--size-4-4)");
  assert.equal(block[0].includes("box-sizing: border-box"), true, "box-sizing conservé");
  assert.equal(block[0].includes("overflow: hidden"), true, "overflow: hidden conservé");
  assert.equal(block[0].includes("white-space: nowrap"), true, "white-space: nowrap conservé");
  assert.equal(block[0].includes("flex-wrap: nowrap"), true, "flex-wrap: nowrap conservé");
});

test("CSS — hover : le host n'est jamais le trigger, révélation hover/focus de la barre", () => {
  const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    css.includes(".feuillets-writing-toolbar-host:hover .feuillets-writing-toolbar-hover"),
    false,
    "le host complet ne doit jamais être le trigger"
  );
  assert.equal(css.includes(".feuillets-writing-toolbar-hover:hover"), true, "révélation au survol de la barre");
  assert.equal(css.includes(".feuillets-writing-toolbar-hover:focus-within"), true, "révélation au focus dans la barre");
  const base = css.match(/\.feuillets-writing-toolbar-hover\s*\{[^{}]*\}/);
  assert.ok(base, "la règle de base .feuillets-writing-toolbar-hover doit exister");
  assert.equal(base[0].includes("opacity: 0"), true);
  assert.equal(base[0].includes("visibility: visible"), true);
  assert.equal(base[0].includes("pointer-events: auto"), true);
  assert.equal(base[0].includes("transition"), true, "la transition est conservée");
});

test("CSS — aucune hauteur de status bar codée en dur dans le code produit", () => {
  const source = readFileSync("src/writing-toolbar/writing-toolbar.ts", "utf8");
  assert.equal(source.includes("28px"), false, "writing-toolbar.ts ne fait référence qu'à la géométrie mesurée");
});

test("status bar — visible : barEl reçoit --feuillets-writing-toolbar-status-height en px", () => {
  const harness = createHarness();
  harness.statusBar.rect = { top: 0, bottom: 28, left: 0, right: 100, width: 100, height: 28 };
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], "28px");
  toolbar.destroy();
});

test("status bar — absente : aucun crash, aucune hauteur forcée", () => {
  const harness = createHarness();
  harness.hideStatusBar();
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], undefined);
  toolbar.destroy();
});

test("status bar — masquée : la propriété CSS de hauteur est supprimée", () => {
  const harness = createHarness();
  harness.statusBar.rect = { top: 0, bottom: 0, left: 0, right: 100, width: 100, height: 0 };
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], undefined, "height 0 → retirée");
  toolbar.destroy();
});

test("status bar — masquée par display:none : propriété retirée elle aussi", () => {
  const harness = createHarness();
  harness.statusBar.computedStyle = { display: "none", visibility: "visible" };
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], undefined, "display:none → retirée");
  toolbar.destroy();
});

test("position — la hauteur status bar n'est posée qu'en position basse", () => {
  const harness = createHarness();
  harness.statusBar.rect = { top: 300, bottom: 328, left: 0, right: 100, width: 100, height: 28 };
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], "28px", "bottom : hauteur status bar posée");

  toolbar.setPosition("top");
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], undefined, "top : propriété retirée immédiatement");

  toolbar.setPosition("bottom");
  assert.equal(bar.style["--feuillets-writing-toolbar-status-height"], "28px", "bottom : hauteur restaurée immédiatement");

  toolbar.destroy();
});

test("collision — status bar dans le host : largeur responsive plafonnée, hors host : retour", () => {
  const harness = createHarness();
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const bar = barOf(harness.context);

  /* Géométrie factice : barre de 500px à partir de x=100, status bar visible
     à partir de x=400, host se terminant bien au-delà (x=1000). Sans la
     status bar, 500px suffiraient pour 455px de contenu. */
  bar.clientWidth = 500;
  harness.context.hostEl.rect = { top: 0, bottom: 300, left: 0, right: 1000, width: 1000, height: 300 };
  bar.rect = { top: 280, bottom: 300, left: 100, right: 600, width: 500, height: 20 };
  harness.statusBar.rect = { top: 300, bottom: 328, left: 400, right: 600, width: 200, height: 28 };
  harness.resizeTo(500);

  assert.deepEqual(
    [...toolbar.overflowed].sort(),
    ["focus", "preview", "reorganize"],
    "plafond à 300px (400 − 100) : les actions de faible priorité passent en overflow"
  );

  /* La status bar sort du host → aucune limitation horizontale. */
  harness.statusBar.rect = { top: 300, bottom: 328, left: 1100, right: 1300, width: 200, height: 28 };
  harness.resizeTo(500);
  assert.deepEqual(
    toolbar.overflowed,
    [],
    "hors du host : la largeur réelle de la barre fait foi, toutes les actions reviennent"
  );

  toolbar.destroy();
});

test("observer — le MÊME ResizeObserver observe host + status bar, jamais la barre", () => {
  const harness = createHarness();
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  assert.equal(harness.roInstances.length, 1, "un seul ResizeObserver");
  const ro = harness.roInstances[0];
  assert.ok(ro.observed.includes(harness.context.hostEl), "hôte Markdown observé");
  assert.ok(ro.observed.includes(harness.statusBar), "status bar observée");
  assert.equal(ro.observed.includes(barOf(harness.context)), false, "jamais la barre elle-même");
  toolbar.destroy();
});

test("observer — status bar absente : seul le hôte est observé", () => {
  const harness = createHarness();
  harness.hideStatusBar();
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const ro = harness.roInstances[0];
  assert.deepEqual(ro.observed, [harness.context.hostEl], "uniquement le hôte Markdown");
  toolbar.destroy();
});

test("destruction — l'observer est toujours déconnecté", () => {
  const harness = createHarness();
  const toolbar = new WritingToolbar({
    context: harness.context,
    registry: createDefaultWritingActionRegistry(),
    position: "bottom",
    mode: "always",
  });
  const ro = harness.roInstances[0];
  toolbar.destroy();
  assert.equal(ro.observed.length, 0, "disconnect() appelé sur le seul ResizeObserver");
});

test("destruction — contrôleur : toolbar absente, classe host retirée, observer déconnecté", () => {
  const harness = createHarness();
  const controller = new WritingToolbarController(createDefaultWritingActionRegistry());
  controller.sync(harness.context, "always", "bottom");

  const bar = barOf(harness.context);
  assert.ok(bar, "une barre est montée");
  const ro = harness.roInstances[0];

  controller.destroy();
  assert.equal(controller.toolbar, null);
  assert.equal(barOf(harness.context), null, "la barre est retirée du DOM");
  assert.equal(harness.context.hostEl.hasClass("feuillets-writing-toolbar-host"), false, "classe host retirée");
  assert.equal(ro.observed.length, 0, "ResizeObserver déconnecté");
});

test("Focus — styles.css pose .feuillets-concentration .feuillets-writing-toolbar sans !important", () => {
  const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.match(/\.feuillets-concentration\s+\.feuillets-writing-toolbar\s*\{[^{}]*\}/);
  assert.ok(block, "la règle Focus de la Barre doit exister");
  assert.equal(block[0].includes("display: none"), true, "display: none pendant le Focus");
  assert.equal(block[0].includes("!important"), false, "aucun !important");
});

test("non-régression — le registre par défaut ne branche AUCUNE action métier", () => {
  const source = readFileSync("src/writing-toolbar/writing-action-registry.ts", "utf8");
  /* Scope REPRÉSENTANT la fonction preset (registrations réelles) : exclut la
     déclaration d'interface `registerHandler(...)` qui, elle, est légitime. */
  const fromPreset = source.slice(source.indexOf("createDefaultWritingActionRegistry"));
  assert.equal(fromPreset.includes("registerHandler("), false, "aucun handler enregistré dans le preset");
  assert.equal(fromPreset.includes(".registerHandler("), false);
});