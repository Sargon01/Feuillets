import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

test("Binder preview is suppressed only while the file heading outline is visible", () => {
  assert.match(
    source,
    /const headingOutlineVisible = this\._visibleHeadingOutlinePaths\.has\(file\.path\)[\s\S]*?headingOutlineForFile\(this\.app, file\)\.length > 0;[\s\S]*?const previewExpanded = previewTitleEmphasized && !headingOutlineVisible;/
  );
});

test("Binder preview mode still controls whether a preview may be rendered", () => {
  assert.match(
    source,
    /const previewTitleEmphasized =[\s\S]*?opts\.showPreview === true[\s\S]*?&& effectiveField !== "none"/
  );
});

test("Binder title emphasis is independent from whether its preview is rendered", () => {
  assert.match(
    source,
    /const previewTitleEmphasized =[\s\S]*?&& effectiveField !== "none";[\s\S]*?const previewExpanded =[\s\S]*?previewTitleEmphasized[\s\S]*?&& !headingOutlineVisible[\s\S]*?item\.toggleClass\("feuillets-item-preview-title", previewTitleEmphasized\);/
  );
  assert.match(
    styles,
    /\.feuillets-item\.feuillets-item-has-preview \.feuillets-item-name,\s*\.feuillets-item\.feuillets-item-preview-title \.feuillets-item-name\s*\{\s*font-weight: var\(--font-semibold, 600\);/
  );
});
