import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  createFeuilletsPackage,
  FEUILLETS_PACKAGE_LIMITS,
  FeuilletsPackageError,
  readFeuilletsPackage,
  validateFeuilletsManifest,
} from "../src/services/feuillets-package.js";

const manifest = (extra = {}) => ({
  format: "feuillets",
  version: 1,
  kind: "review",
  packageId: "pkg-123",
  createdAt: "2026-08-13T10:00:00.000Z",
  createdByVersion: "2.0.5",
  ...extra,
});

async function zipWith(entries) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array" });
}

async function rejectsPackage(promise) {
  await assert.rejects(promise, FeuilletsPackageError);
}

test(".feuillets : round-trip texte et conservation du manifest", async () => {
  const sourceManifest = manifest({ futureField: { enabled: true } });
  const archive = await createFeuilletsPackage(sourceManifest, { "notes/texte.md": "Bonjour" });
  const result = await readFeuilletsPackage(archive);

  assert.deepEqual(result.manifest, sourceManifest);
  assert.deepEqual(result.entries.map((entry) => entry.path), ["notes/texte.md"]);
  assert.equal(new TextDecoder().decode(result.entries[0].data), "Bonjour");
});

test(".feuillets : round-trip binaire et sous-dossiers", async () => {
  const binary = new Uint8Array([0, 1, 255, 42]);
  const archive = await createFeuilletsPackage(manifest(), {
    "sources/a.md": "A",
    "sources/assets/image.bin": binary,
    "meta/info.txt": "Info",
  });
  const result = await readFeuilletsPackage(archive);

  assert.deepEqual(result.entries.map((entry) => entry.path), ["sources/a.md", "sources/assets/image.bin", "meta/info.txt"]);
  assert.deepEqual(result.entries[1].data, binary);
});

test(".feuillets : refuse manifest absent, JSON corrompu et manifest invalide", async () => {
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "file.txt": "x" })));
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "manifest.json": "{" })));
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "manifest.json": JSON.stringify(manifest({ format: "other" })) })));
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "manifest.json": JSON.stringify(manifest({ version: 2 })) })));
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "manifest.json": JSON.stringify(manifest({ kind: "other" })) })));
});

test(".feuillets : refuse les chemins dangereux", async () => {
  for (const path of ["../evil.md", "/evil.md", "C:\\evil.md"]) {
    await rejectsPackage(createFeuilletsPackage(manifest(), { [path]: "x" }));
  }
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest()));
  zip.file("../evil.md", "x");
  await rejectsPackage(readFeuilletsPackage(await zip.generateAsync({ type: "uint8array" })));
});

test(".feuillets : refuse ZIP corrompu et les limites de sécurité", async () => {
  await rejectsPackage(readFeuilletsPackage(new Uint8Array([1, 2, 3, 4])));
  const tooMany = Object.fromEntries(Array.from({ length: FEUILLETS_PACKAGE_LIMITS.maxEntries }, (_, index) => [`f/${index}.txt`, "x"]));
  await rejectsPackage(createFeuilletsPackage(manifest(), tooMany));
  await rejectsPackage(readFeuilletsPackage(await zipWith({ "manifest.json": JSON.stringify(manifest()), ...tooMany })));
  await rejectsPackage(createFeuilletsPackage(manifest(), { "large.bin": new Uint8Array(FEUILLETS_PACKAGE_LIMITS.maxDecompressedBytes) }));
});

test(".feuillets : validation ne touche jamais au Vault", () => {
  assert.deepEqual(validateFeuilletsManifest(manifest()), manifest());
});
