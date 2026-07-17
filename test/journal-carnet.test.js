import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCarnet } from "../src/utils/journal-carnet.js";

test("buildCarnet", async (t) => {
  await t.test("retourne une chaîne vide sans entrées", () => {
    assert.equal(buildCarnet([]), "");
  });

  await t.test("assemble une seule entrée en section ##", () => {
    assert.equal(
      buildCarnet([{ key: "2026-07-16", body: "Aujourd'hui, ça avance bien." }]),
      "## 2026-07-16\n\nAujourd'hui, ça avance bien."
    );
  });

  await t.test("assemble plusieurs entrées séparées par une ligne vide", () => {
    const entries = [
      { key: "2026-07-14", body: "Hier." },
      { key: "2026-07-16", body: "Aujourd'hui." },
    ];
    assert.equal(
      buildCarnet(entries),
      "## 2026-07-14\n\nHier.\n\n## 2026-07-16\n\nAujourd'hui."
    );
  });
});
