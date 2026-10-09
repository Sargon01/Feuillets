import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/csl-companion-integration.test.js"], {
  cwd: root,
  env: { ...process.env, FEUILLETS_CSL_REQUIRED: "1" },
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

// Require the named integration test and at least its synthetic child to pass.
// A skipped test, an empty file or a filtered run cannot satisfy this gate.
const output = result.stdout;
const passed = Number(/^# pass (\d+)$/m.exec(output)?.[1] ?? 0);
const skipped = Number(/^# skipped (\d+)$/m.exec(output)?.[1] ?? -1);
if (!/^# Subtest: real Feuillets CSL:/m.test(output) || passed < 2 || skipped !== 0) {
  console.error("The required CSL integration test did not execute successfully without skips.");
  process.exit(1);
}
