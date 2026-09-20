/* Shared test-only locale bootstrap — NOT production code.
 *
 * src/i18n/index.ts's own in-memory default is English (the deterministic
 * technical fallback, see src/i18n/index.ts and test/i18n-locale.test.js).
 * A large, pre-existing part of the test suite was written against the
 * OLD default (French) and asserts French UI strings without ever calling
 * setLocale("fr") itself. Rather than touch every one of those files, this
 * one shared bootstrap sets the active locale to French once, before each
 * compiled test file runs (loaded via `node --import`, see package.json's
 * "test:compiled" script) — restoring the test suite's long-standing
 * default without changing production code's own initial value at all.
 *
 * New i18n-foundation tests (test/i18n-locale.test.js,
 * test/project-creation.test.js) must never rely on this bootstrap: they
 * set whatever locale they need explicitly, and restore the previous
 * value afterward.
 */
import { setLocale } from "../src/i18n/index.js";

setLocale("fr");
