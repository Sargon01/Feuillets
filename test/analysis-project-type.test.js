import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = fs.existsSync(path.join(testDir, "../src/views/analysis-view.ts"))
  ? path.join(testDir, "../src/views/analysis-view.ts")
  : path.join(testDir, "../../src/views/analysis-view.ts");
const source = fs.readFileSync(sourcePath, "utf8");

test("analysis tools are independent of ProjectType", () => {
  assert.doesNotMatch(source, /const isFiction/);
  assert.doesNotMatch(source, /\.type\s*[!=]==?\s*["'](?:fiction|nonfiction|free)["']/);
  assert.match(source, /this\.tool\(container, "rythme"/);
  assert.match(source, /this\.tool\(gb, "curve"/);
  assert.doesNotMatch(source, /if\s*\([^)]*isFiction[^)]*\)\s*this\.tool/);
});
