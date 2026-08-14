import test from "node:test";
import assert from "node:assert/strict";
import { createFeuilletsPackage, readFeuilletsPackage } from "../src/services/feuillets-package.js";
import {
  NativeReviewPackageError, createNativeReviewPackage, hashReviewText, readNativeReviewPackage,
  reviewBaseEntryPath, reviewWorkingEntryPath, validateNativeReviewManifest,
} from "../src/services/native-review-package.js";

const at = "2026-08-13T10:00:00.000Z";
const participants = [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }];
const input = (senderRole = "author") => ({ packageId: "package-1", createdAt: at, createdByVersion: "2.0.5", reviewId: "review-1", round: 1, senderRole, participants });
const source = (overrides = {}) => ({ documentId: "chapter-1", originalPath: "Roman/Chapitre 1.md", title: "Chapitre 1", baseMarkdown: "Texte base.", ...overrides });
async function rejects(action) { await assert.rejects(action, NativeReviewPackageError); }
async function manifestOf(data) { return (await readFeuilletsPackage(data)).manifest; }

test("round-trip auteur : base et working sont identiques", async () => {
  const data = await createNativeReviewPackage(input(), [source()]); const parsed = await readNativeReviewPackage(data);
  assert.equal(parsed.manifest.senderRole, "author"); assert.equal(parsed.documents[0].baseMarkdown, "Texte base.");
  assert.equal(parsed.documents[0].workingMarkdown, "Texte base."); assert.equal(parsed.manifest.documents[0].title, "Chapitre 1");
  assert.equal("localSourcePath" in parsed.manifest.documents[0], false);
});

test("round-trip relecteur : working modifié ou identique est accepté", async () => {
  const changed = await readNativeReviewPackage(await createNativeReviewPackage(input("reviewer"), [source({ workingMarkdown: "Texte annoté." })]));
  assert.equal(changed.documents[0].workingMarkdown, "Texte annoté.");
  const same = await readNativeReviewPackage(await createNativeReviewPackage(input("reviewer"), [source()]));
  assert.equal(same.documents[0].workingMarkdown, same.documents[0].baseMarkdown);
});

test("plusieurs documents et les chemins ZIP canoniques", async () => {
  const data = await createNativeReviewPackage(input(), [source(), source({ documentId: "chapter-2", originalPath: "Roman/Chapitre 2.md", title: "Chapitre 2" })]);
  const raw = await readFeuilletsPackage(data); assert.deepEqual(raw.entries.map((entry) => entry.path).sort(), [
    reviewBaseEntryPath("chapter-1"), reviewBaseEntryPath("chapter-2"), reviewWorkingEntryPath("chapter-1"), reviewWorkingEntryPath("chapter-2"),
  ].sort());
  assert.equal((await readNativeReviewPackage(data)).documents.length, 2);
});

test("supprime intégralement le frontmatter sans toucher au corps Markdown", async () => {
  const privateSource = "\uFEFF---\r\ntitle: Secret interne\r\nnotes: note personnelle\r\nsummary: synopsis privé\r\nstatus: brouillon\r\ncharacters: [Alice]\r\ncustom_private: ne-pas-envoyer\r\n---\r\nTexte du manuscrit.\r\n\r\n---\r\n\r\nNote[^1].\r\n[^1]: Conservée.";
  const parsed = await readNativeReviewPackage(await createNativeReviewPackage(input(), [source({ baseMarkdown: privateSource })]));
  const body = parsed.documents[0].baseMarkdown;
  assert.match(body, /Texte du manuscrit\./); assert.match(body, /\r?\n---\r?\n/); assert.match(body, /\[\^1\]: Conservée\./);
  for (const privateValue of ["title:", "Secret interne", "notes:", "note personnelle", "custom_private", "ne-pas-envoyer"]) assert.equal(body.includes(privateValue), false);
  assert.equal(parsed.documents[0].workingMarkdown, body);
});

test("hash SHA-256 est stable et la base est vérifiée", async () => {
  assert.equal(await hashReviewText("abc"), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const data = await createNativeReviewPackage(input(), [source()]); const manifest = await manifestOf(data);
  const tampered = await createFeuilletsPackage(manifest, { [reviewBaseEntryPath("chapter-1")]: "Base falsifiée.", [reviewWorkingEntryPath("chapter-1")]: "Base falsifiée." });
  await rejects(() => readNativeReviewPackage(tampered));
});

test("refuse les bases/workings absents, entrées étrangères et UTF-8 invalide", async () => {
  const manifest = await manifestOf(await createNativeReviewPackage(input(), [source()]));
  await rejects(async () => readNativeReviewPackage(await createFeuilletsPackage(manifest, { [reviewWorkingEntryPath("chapter-1")]: "Texte base." })));
  await rejects(async () => readNativeReviewPackage(await createFeuilletsPackage(manifest, { [reviewBaseEntryPath("chapter-1")]: "Texte base." })));
  await rejects(async () => readNativeReviewPackage(await createFeuilletsPackage(manifest, { [reviewBaseEntryPath("chapter-1")]: "Texte base.", [reviewWorkingEntryPath("chapter-1")]: "Texte base.", "other.json": "{}" })));
  await rejects(async () => readNativeReviewPackage(await createFeuilletsPackage(manifest, { [reviewBaseEntryPath("chapter-1")]: new Uint8Array([0xff]), [reviewWorkingEntryPath("chapter-1")]: new Uint8Array([0xff]) })));
});

test("validation manifeste : kind, roles, round, participants, documents et IDs", () => {
  const valid = { format: "feuillets", version: 1, kind: "review", ...input(), documents: [{ documentId: "chapter-1", originalPath: "Roman/Chapitre.md", title: "Chapitre", baseHash: "sha256:" + "a".repeat(64) }] };
  validateNativeReviewManifest(valid);
  for (const mutate of [
    (value) => { value.kind = "project"; }, (value) => { value.senderRole = "other"; }, (value) => { value.round = 0; },
    (value) => { value.participants = [participants[0], participants[0]]; },
    (value) => { value.documents.push({ ...value.documents[0] }); },
    (value) => { value.documents.push({ ...value.documents[0], documentId: "chapter-2" }); },
    (value) => { value.packageId = "../bad"; }, (value) => { value.reviewId = "a".repeat(129); },
  ]) {
    const copy = JSON.parse(JSON.stringify(valid)); mutate(copy); assert.throws(() => validateNativeReviewManifest(copy), NativeReviewPackageError);
  }
});

test("création refuse les IDs dangereux/longs et un auteur avec working différent", async () => {
  await rejects(() => createNativeReviewPackage(input(), [source({ documentId: "bad/path" })]));
  await rejects(() => createNativeReviewPackage(input(), [source({ documentId: "a".repeat(129) })]));
  await rejects(() => createNativeReviewPackage(input(), [source({ workingMarkdown: "Modification interdite." })]));
});

test("la création locale sérialise uniquement la whitelist de confidentialité", async () => {
  const privateInput = {
    ...input(), notes: "notes privées", annotations: "annotations privées", settings: "réglages privés", localSourcePath: "local/source.md", secret: "secret global",
    participants: [
      { ...participants[0], email: "alice@example.test", privateNote: "note Alice", token: "token Alice" },
      { ...participants[1], email: "bob@example.test", privateNote: "note Bob", token: "token Bob" },
    ],
  };
  const privateDocument = source({ localSourcePath: "Roman/local.md", privateMetadata: "métadonnée privée", annotations: "annotations document" });
  const rawManifest = (await readFeuilletsPackage(await createNativeReviewPackage(privateInput, [privateDocument]))).manifest;
  const serialized = JSON.stringify(rawManifest);
  for (const forbidden of ["notes", "notes privées", "annotations", "annotations privées", "settings", "réglages privés", "localSourcePath", "local/source.md", "secret", "secret global", "email", "alice@example.test", "privateNote", "note Alice", "token", "token Alice", "privateMetadata", "métadonnée privée", "annotations document"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} ne doit pas être sérialisé`);
  }
  assert.equal(rawManifest.packageId, "package-1"); assert.equal(rawManifest.participants[0].name, "Alice");
  assert.equal(rawManifest.documents[0].title, "Chapitre 1"); assert.ok(rawManifest.documents[0].baseHash.startsWith("sha256:"));
});
