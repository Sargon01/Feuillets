// @ts-check
import { getLanguage } from "obsidian";
import { fr } from "./fr.js";
import { en } from "./en.js";

/** Flat key -> text dictionary for one locale. */
type LocaleDict = Record<string, string>;

/** Supported locale codes. */
export type Locale = "fr" | "en";

/** Dictionaries per locale. */
const LOCALES: Record<Locale, LocaleDict> = { fr, en };

/** English is the deterministic technical fallback locale: the initial
 * in-memory locale, the fallback for an unsupported code passed to
 * `setLocale`, the fallback for an unavailable/unsupported Obsidian
 * language in `detectLocale`, and the fallback for a key missing from the
 * selected locale's dictionary. The absolute last resort stays the key
 * itself — never a French string. */
export const FALLBACK_LOCALE: Locale = "en";

function isSupportedLocale(value: string): value is Locale {
  return value === "fr" || value === "en";
}

let currentLocale: Locale = FALLBACK_LOCALE;

/** Changes the active locale — falls back to English for an unrecognized code. */
export function setLocale(locale: string): void {
  currentLocale = isSupportedLocale(locale) ? locale : FALLBACK_LOCALE;
}

/** Returns the active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Detects the locale to use: an explicit, non-"auto" setting first (kept
 * as-is when it names a supported locale), then Obsidian's own language if
 * it is one of the supported locales, then English. */
export function detectLocale(settings?: { language?: string }): Locale {
  const forced = settings?.language;
  if (forced && forced !== "auto" && isSupportedLocale(forced)) {
    return forced;
  }
  try {
    const obsidianLang = getLanguage();
    if (obsidianLang && isSupportedLocale(obsidianLang)) {
      return obsidianLang;
    }
  } catch {
    /* getLanguage unavailable (test context): silent fallback below. */
  }
  return FALLBACK_LOCALE;
}

/**
 * Translates `key` for an EXPLICIT `locale`, without reading or depending on
 * the active global locale — the helper pure services (e.g.
 * project-creation.ts) use instead of `t()`, so they never touch shared
 * mutable state. Falls back to English when `key` is missing from
 * `locale`'s dictionary, and finally to `key` itself (never a French
 * string, never a blank result). `params`: `{name}` substitution -> value,
 * for parameterized strings.
 */
export function translate(locale: Locale, key: string, params?: Record<string, string>): string {
  const dict = LOCALES[locale] || LOCALES[FALLBACK_LOCALE];
  let str = dict[key] ?? LOCALES[FALLBACK_LOCALE][key] ?? key;
  if (params) {
    for (const name in params) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), params[name]);
    }
  }
  return str;
}

/**
 * Translates `key` in the currently active locale — see `translate` for the
 * fallback rules and `params`.
 */
export function t(key: string, params?: Record<string, string>): string {
  return translate(currentLocale, key, params);
}
