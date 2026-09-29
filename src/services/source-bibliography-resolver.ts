import type { App, TFile } from "obsidian";
import { rawFrontmatterOf } from "./frontmatter.js";

/** Normalized bibliography metadata from a Source card.
 *  Used to ensure consistent reading across different UI paths
 *  (citation modal, insertCitationFor, bibliography generator). */
export interface ResolvedSourceBibliography {
  author?: string;
  title?: string;
  publisher?: string;
  date?: string;
  url?: string;
}

/** Pure resolution: extracts bibliography metadata from frontmatter object.
 *  This is the core logic, independent of file I/O.
 *  Prioritizes native Feuillets fields over ZotFlow/Zotero fallbacks.
 *  Handles:
 *  - author: author → auteur → creator → creators (string or array)
 *  - title: title → titre
 *  - publisher: publisher → editeur → edition → publication
 *  - date: date → year → annee
 *  - url: url */
export function resolveBibliographyMetadataFromFrontmatter(
  frontmatter: Record<string, unknown>,
): ResolvedSourceBibliography {
  return {
    author: resolveAuthor(frontmatter),
    title: resolveTitle(frontmatter),
    publisher: resolvePublisher(frontmatter),
    date: resolveDate(frontmatter),
    url: resolveUrl(frontmatter),
  };
}

/** Resolves bibliography metadata from a Source file's raw frontmatter.
 *  Uses rawFrontmatterOf to read physical frontmatter directly.
 *  Suitable for bibliography-generator which historically used raw frontmatter. */
export function resolveBibliographyMetadata(
  app: App,
  file: TFile | null | undefined,
): ResolvedSourceBibliography {
  if (!file) return {};

  const raw = rawFrontmatterOf(app, file);
  return resolveBibliographyMetadataFromFrontmatter(raw);
}

function resolveAuthor(fm: Record<string, unknown>): string | undefined {
  // Priority: author → auteur → creator → creators
  // Support both string and array values
  const author = asStringOrArray(fm.author);
  if (author) return author;

  const auteur = asStringOrArray(fm.auteur);
  if (auteur) return auteur;

  const creator = asStringOrArray(fm.creator);
  if (creator) return creator;

  const creators = asStringOrArray(fm.creators);
  if (creators) return creators;

  return undefined;
}

function resolveTitle(fm: Record<string, unknown>): string | undefined {
  const title = asString(fm.title);
  if (title) return title;

  const titre = asString(fm.titre);
  if (titre) return titre;

  return undefined;
}

function resolvePublisher(fm: Record<string, unknown>): string | undefined {
  // Priority: publisher → editeur → edition → publication
  const publisher = asString(fm.publisher);
  if (publisher) return publisher;

  const editeur = asString(fm.editeur);
  if (editeur) return editeur;

  const edition = asString(fm.edition);
  if (edition) return edition;

  const publication = asString(fm.publication);
  if (publication) return publication;

  return undefined;
}

function resolveDate(fm: Record<string, unknown>): string | undefined {
  // Priority: date → year → annee
  const date = asString(fm.date);
  if (date) return date;

  const year = fm.year;
  if (typeof year === "number") return year.toString();
  const yearStr = asString(year);
  if (yearStr) return yearStr;

  const annee = fm.annee;
  if (typeof annee === "number") return annee.toString();
  const anneeStr = asString(annee);
  if (anneeStr) return anneeStr;

  return undefined;
}

function resolveUrl(fm: Record<string, unknown>): string | undefined {
  return asString(fm.url);
}

/** Safely converts value to string, handling both strings and arrays.
 *  Arrays are joined with ", " after filtering nulls/objects.
 *  Returns undefined for null, empty string, or empty array. */
function asStringOrArray(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item));
    if (items.length > 0) {
      return items.join(", ");
    }
    return undefined;
  }

  // Reject single objects, numbers converted to strings, etc.
  return undefined;
}

/** Safely converts a value to a string.
 *  Returns undefined for null, empty string, or unsupported types.
 *  Prevents "[object Object]" output. */
function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  // Reject objects, arrays, etc.
  return undefined;
}
