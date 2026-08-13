import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewAuthor, NativeReviewAuthorError } from "../src/services/native-review-author.js";
import { readNativeReviewPackage } from "../src/services/native-review-package.js";

function fixture(order = {}) {
  const project = new TFolder("Roman"); const manuscript = new TFolder("Roman/Manuscrit");
  const chapter = new TFolder("Roman/Manuscrit/Chapitre"); const research = new TFolder("Roman/Recherche");
  const first = new TFile("Roman/Manuscrit/Chapitre/Un.md", "---\ntitle: Premier\nprivate: secret\n---\nTexte un.");
  const second = new TFile("Roman/Manuscrit/Chapitre/Deux.md", "Texte deux.");
  const image = new TFile("Roman/Manuscrit/image.png", "png"); const outside = new TFile("Roman/Recherche/Note.md", "Interdit");
  project.children = [manuscript, research]; manuscript.parent = project; research.parent = project; chapter.parent = manuscript; manuscript.children = [chapter, image];
  chapter.children = [first, second]; first.parent = chapter; second.parent = chapter; image.parent = manuscript; outside.parent = research; research.children = [outside];
  const { vault } = createFakeVault([project, manuscript, research, chapter, first, second, image, outside]);
  return { app: { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: file === first ? { title: "Premier" } : {} }) } }, vault, manuscript, chapter, first, second, image, outside,
    settings: { projectFolder: manuscript.path, orders: order, folderPositions: {}, compileFileName: "Manuscrit.md" } };
}
const input = (scope) => ({ scope, authorName: "Alice", reviewerName: "Bob", createdByVersion: "2.0.5" });
async function rejects(action) { await assert.rejects(action, NativeReviewAuthorError); }

test("crée le premier envoi auteur, archive les octets exacts et conserve les sources", async () => {
  const { app, vault, first } = fixture(); const before = await vault.read(first);
  const result = await createNativeReviewAuthor(app, fixture().settings, input({ type: "file", path: first.path }));
  assert.deepEqual(result.files, [first]); assert.match(result.session.reviewId, /^review-[a-f0-9]{32}$/); assert.match(result.session.rounds[0].sent.packageId, /^package-[a-f0-9]{32}$/);
  assert.equal(result.session.documents[0].originalPath, "Chapitre/Un.md"); assert.equal(result.session.documents[0].localSourcePath, first.path);
  const archive = vault.getAbstractFileByPath(result.localPackagePath); assert.ok(archive instanceof TFile);
  const archived = await vault.readBinary(archive); assert.deepEqual(new Uint8Array(archived), result.packageData);
  const parsed = await readNativeReviewPackage(archived); assert.equal(parsed.manifest.reviewId, result.session.reviewId); assert.equal(parsed.manifest.packageId, result.session.rounds[0].sent.packageId);
  assert.equal(parsed.manifest.documents[0].title, "Premier"); assert.equal(parsed.documents[0].baseMarkdown, parsed.documents[0].workingMarkdown); assert.equal(parsed.documents[0].baseMarkdown.includes("private:"), false);
  assert.equal(JSON.stringify(parsed).includes(first.path), false); assert.equal(await vault.read(first), before);
  assert.ok(vault.getAbstractFileByPath(`_Feuillets/Relectures/${result.session.reviewId}/working`));
  assert.equal(vault.getAbstractFileByPath(`_Feuillets/Relectures/${result.session.reviewId}/working`).children.length, 0);
});

test("résout dossier, sélection et projet dans l’ordre Binder", async () => {
  const { app, settings, chapter, first, second, manuscript } = fixture({ "Roman/Manuscrit/Chapitre": ["Deux.md", "Un.md"] });
  const folder = await createNativeReviewAuthor(app, settings, input({ type: "folder", path: chapter.path })); assert.deepEqual(folder.files, [second, first]);
  const selection = await createNativeReviewAuthor(app, settings, input({ type: "selection", paths: [first.path, second.path] })); assert.deepEqual(selection.files, [second, first]);
  const project = await createNativeReviewAuthor(app, settings, input({ type: "project" })); assert.deepEqual(project.files, [second, first]); assert.equal(project.files.every((file) => file.path.startsWith(`${manuscript.path}/`)), true);
});

test("refuse les portées hors Manuscrit, vides et non Markdown avant toute session", async () => {
  for (const makeScope of [
    ({ outside }) => ({ type: "file", path: outside.path }), ({ outside }) => ({ type: "folder", path: "Roman/Recherche" }),
    ({ first, outside }) => ({ type: "selection", paths: [first.path, outside.path] }), () => ({ type: "selection", paths: [] }),
    ({ image }) => ({ type: "file", path: image.path }),
  ]) {
    const value = fixture(); await rejects(() => createNativeReviewAuthor(value.app, value.settings, input(makeScope(value))));
    assert.equal(value.vault.getAbstractFileByPath("_Feuillets/Relectures"), null);
  }
});

test("refuse une collision d’archive sans écrasement", async () => {
  const { app, settings, first } = fixture();
  const originalCreateBinary = app.vault.createBinary.bind(app.vault); let once = true;
  app.vault.createBinary = async (path, data) => { if (once) { once = false; await originalCreateBinary(path, "ancien"); throw new Error("collision"); } return originalCreateBinary(path, data); };
  await rejects(() => createNativeReviewAuthor(app, settings, input({ type: "file", path: first.path })));
});
