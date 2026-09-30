import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");

test("horizontal heading drag uses a 24px threshold and one-level shift modes", () => {
  assert.match(source, /const HEADING_HORIZONTAL_DRAG_THRESHOLD = 24;/);
  assert.match(source, /deltaX <= -HEADING_HORIZONTAL_DRAG_THRESHOLD/);
  assert.match(source, /deltaX >= HEADING_HORIZONTAL_DRAG_THRESHOLD/);
  assert.match(source, /source\.level === 1 \? "invalid" : "promote"/);
  assert.match(source, /source\.containsLevelSix \? "invalid" : "demote"/);
});

test("horizontal drops reuse the 6B shift path and bypass vertical movement", () => {
  assert.match(source, /if \(source\.horizontalMode !== "move"\) \{[\s\S]*?shiftHeadingSubtreeInFile\(file, source\.sourceStartOffset, source\.level, source\.text, source\.horizontalMode\)/);
  assert.match(source, /if \(!this\.isValidHeadingDropTarget\(source, file, node\)\) return;/);
});
