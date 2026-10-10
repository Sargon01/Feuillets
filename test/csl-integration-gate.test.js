import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const runner = resolve("scripts/run-csl-integration.mjs");
const integration = resolve("test/csl-companion-integration.test.js");
const execute = (args, env = {}) => {
  const environment = { ...process.env, FEUILLETS_CSL_SOURCE: "", FEUILLETS_CSL_REQUIRED: "0", ...env };
  // Run a standalone CLI, without the parent test runner's child IPC context.
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, {
    env: environment, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
};
function temporary(t) {
  const directory = mkdtempSync(resolve(tmpdir(), "feuillets-csl-gate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("required integration fails when no companion is configured, even if optional mode is requested", () => {
  const result = execute([runner]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FEUILLETS_CSL_SOURCE is required/);
  assert.match(result.stdout, /# skipped 0/);
});

test("required integration fails when the configured companion source does not exist", (t) => {
  const result = execute([runner], { FEUILLETS_CSL_SOURCE: temporary(t) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /required Feuillets CSL source is missing/);
});

test("required integration fails explicitly when Chromium is missing", (t) => {
  const directory = temporary(t);
  writeFileSync(resolve(directory, "main.ts"), "export default {};\n");
  const result = execute([runner], { FEUILLETS_CSL_SOURCE: directory, PLAYWRIGHT_BROWSERS_PATH: resolve(directory, "missing-browsers") });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Chromium is required/);
});

test("local integration can remain optional when no companion is configured", () => {
  const result = execute(["--test", "--test-reporter=tap", integration]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# skipped 1/);
});

for (const [label, content] of [
  ["empty file", ""],
  ["skipped named test", 'import test from "node:test"; test("real Feuillets CSL: skipped", {skip: true}, () => {});\n'],
]) {
  test(`required integration rejects a successful Node invocation without execution: ${label}`, (t) => {
    const directory = temporary(t);
    mkdirSync(resolve(directory, "scripts"));
    mkdirSync(resolve(directory, "test"));
    writeFileSync(resolve(directory, "package.json"), '{"type":"module"}\n');
    copyFileSync(runner, resolve(directory, "scripts/run-csl-integration.mjs"));
    writeFileSync(resolve(directory, "test/csl-companion-integration.test.js"), content);
    const result = execute([resolve(directory, "scripts/run-csl-integration.mjs")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /required CSL integration test did not execute successfully without skips/);
  });
}
