import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { getResearchRoot } from "./research.js";
import { getProjectFolder, feuilletsAuxiliaryPath } from "./folder-structure.js";
import { resolveWorkspaceResearchFolder } from "./workspace-research.js";
import { toValue } from "../utils/scene-fields.js";

/** Génération de la Bibliographie (Phase 7).
 *
 * Même principe que Sommaire/TDM (services/contents-generator.ts) et Table
 * des illustrations (services/tables-generator.ts) : élément "generated" du
 * modèle commun de composition (services/book-composition.ts), calculé à la
 * compilation, jamais stocké dans un fichier propre.
 *
 * Source des fiches — contrat final Phase 7, jamais de fusion des deux :
 * - `Recherche → Sources` (bibliothèque canonique éditable) si ce dossier
 *   existe : seules les fiches avec `cite_count > 0` (citées via « Insérer
 *   une citation », services/citations.ts) entrent dans la bibliographie.
 * - sinon `Recherche → Bibliographie/Bibliography` (legacy) par repli :
 *   comportement historique conservé — une fiche exploitable y compte même
 *   sans `cite_count`.
 * Aucun second système, aucune migration physique automatique des fichiers
 * utilisateur ici : voir `resolveBibliographySource`.
 */

/** Champs d'une fiche Bibliographie réellement utilisés — le frontmatter
 * existant (services/research-templates.ts), rien d'autre : synopsis, tags
 * et corps de note sont ignorés. */
export type BibliographyEntry = {
  author?: string;
  title?: string;
  publisher?: string;
  date?: string;
  url?: string;
  journal?: string;
  booktitle?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  citekey?: string;
  bibliographyFilePath?: string;
};

/** Nom canonique, fixe quelle que soit la langue de l'interface (voir
 * utils/project-modes.ts : RESEARCH_FOLDER_VARIANTS.sources = ["Sources"]). */
const SOURCES_FOLDER_NAME = "Sources";

/** Les deux noms de dossier legacy reconnus, quelle que soit la langue
 * active du projet (voir getFeuilletsFolderNames, services/folder-
 * structure.ts) — la lecture reconnaît toujours les deux, contrairement à
 * la création qui ne pose que celui de la langue courante. */
const BIBLIOGRAPHY_FOLDER_NAMES = ["Bibliographie", "Bibliography"];

function sourcesFolder(app: App, researchRoot: TFolder): TFolder | null {
  if (researchRoot.name === SOURCES_FOLDER_NAME) return researchRoot;
  const f = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${SOURCES_FOLDER_NAME}`));
  return f instanceof TFolder ? f : null;
}

function bibliographyFolder(app: App, researchRoot: TFolder): TFolder | null {
  if (BIBLIOGRAPHY_FOLDER_NAMES.includes(researchRoot.name)) return researchRoot;
  for (const name of BIBLIOGRAPHY_FOLDER_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Résout la bibliothèque d'une seule racine Recherche. Sources canonique
 * prioritaire, Bibliographie/Bibliography comme repli legacy. */
export function resolveBibliographySourceInResearchRoot(
  app: App,
  researchRoot: TFolder
): { folder: TFolder; canonical: boolean } | null {
  const sources = sourcesFolder(app, researchRoot);
  if (sources) return { folder: sources, canonical: true };
  const legacy = bibliographyFolder(app, researchRoot);
  if (legacy) return { folder: legacy, canonical: false };
  return null;
}

/** Résout LA bibliothèque de fiches à utiliser — jamais les deux à la fois,
 * jamais de fusion : Sources (canonique) l'emporte dès qu'elle existe, la
 * Bibliographie/Bibliography legacy ne sert que de repli quand Sources est
 * absent. Utilisé par `bibliographyEntries` ici et par la commande
 * « Insérer une citation » (main.ts, getCitationFolders). */
export function resolveBibliographySource(
  app: App,
  settings: FeuilletsSettings
): { folder: TFolder; canonical: boolean } | null {
  const researchRoot = getResearchRoot(app, settings);
  if (!researchRoot) return null;
  return resolveBibliographySourceInResearchRoot(app, researchRoot);
}

function fieldOf(fm: Record<string, unknown>, key: string): string | undefined {
  const value = toValue(fm[key]).trim();
  return value || undefined;
}

function bibliographyEntryForFile(app: App, file: TFile): BibliographyEntry {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
  return {
    author: fieldOf(fm, "author"),
    title: fieldOf(fm, "title"),
    publisher: fieldOf(fm, "publisher"),
    date: fieldOf(fm, "date"),
    url: fieldOf(fm, "url"),
  };
}

/** Convertit une liste explicite de fiches Source avec le même mapping que
 * la bibliographie historique, sans appliquer cite_count. */
export function bibliographyEntriesForFiles(app: App, files: TFile[]): BibliographyEntry[] {
  return files
    .filter((file) => file instanceof TFile && file.extension === "md")
    .map((file) => bibliographyEntryForFile(app, file));
}

function filterBibliographyFilesFromFolder(app: App, resolved: { folder: TFolder; canonical: boolean }): BibliographyEntry[] {
  const files = (resolved.folder.children || []).filter(
    (child): child is TFile => child instanceof TFile
      && child.extension === "md"
      && (!resolved.canonical || Number(app.metadataCache.getFileCache(child)?.frontmatter?.cite_count) > 0)
  );
  return bibliographyEntriesForFiles(app, files);
}

/** Fiches de la bibliothèque résolue (`resolveBibliographySource`), dans
 * l'ordre où le dossier les liste — le TRI RÉEL de la bibliographie générée
 * (par auteur, puis par titre) est décidé par `generateBibliography`, pas
 * ici. Dans Sources canonique, seules les fiches avec `cite_count > 0`
 * sont retenues ; dans le repli Bibliographie/Bibliography legacy, toute
 * fiche exploitable compte, `cite_count` ou non (comportement historique). */
export function bibliographyEntries(app: App, settings: FeuilletsSettings): BibliographyEntry[] {
  const resolved = resolveBibliographySource(app, settings);
  if (!resolved) return [];
  return filterBibliographyFilesFromFolder(app, resolved);
}

/** Résout la bibliothèque de fiches d'une racine éditoriale donnée.
 * Pour la racine globale (ou si editorialRoot est omis / égal à la racine globale) :
 * - comportement historique inchangé (appelle bibliographyEntries(app, settings)).
 * Pour un ouvrage (editorialRoot !== globalRoot) :
 * - cherche uniquement dans la zone Recherche appartenant à cet ouvrage :
 *   1. sources directement sous editorialRoot (resolveBibliographySourceInResearchRoot) ;
 *   2. dossier de recherche auxiliaire canonique de l'ouvrage (feuilletsAuxiliaryPath(editorialRoot, "research")) ;
 *   3. dossier de recherche lié dans les métadonnées pour cet ouvrage (resolveWorkspaceResearchFolder) ;
 *   4. sous-dossier de recherche enfant d'editorialRoot ;
 * - si aucune source n'appartient à cet ouvrage : retourne [] (AUCUN repli vers WARPI).
 */
export function bibliographyEntriesForEditorialRoot(
  app: App,
  settings: FeuilletsSettings,
  editorialRoot?: TFolder | null
): BibliographyEntry[] {
  const globalRoot = getProjectFolder(app, settings);
  if (!editorialRoot || !globalRoot || editorialRoot.path === globalRoot.path) {
    return bibliographyEntries(app, settings);
  }

  // 1. Directement sous editorialRoot
  const direct = resolveBibliographySourceInResearchRoot(app, editorialRoot);
  if (direct) return filterBibliographyFilesFromFolder(app, direct);

  // 2. Dossier de recherche auxiliaire canonique de l'ouvrage
  const canonicalAux = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(editorialRoot, "research"));
  if (canonicalAux instanceof TFolder) {
    const fromAux = resolveBibliographySourceInResearchRoot(app, canonicalAux);
    if (fromAux) return filterBibliographyFilesFromFolder(app, fromAux);
  }

  // 3. Dossier de recherche lié dans les métadonnées pour cet ouvrage
  const linked = resolveWorkspaceResearchFolder(app, settings, editorialRoot);
  if (linked.folder && (linked.sourceKind === "exact" || linked.sourceKind === "ancestor")) {
    const fromLinked = resolveBibliographySourceInResearchRoot(app, linked.folder);
    if (fromLinked) return filterBibliographyFilesFromFolder(app, fromLinked);
  }

  // 4. Sous-dossier de recherche enfant d'editorialRoot
  for (const child of editorialRoot.children || []) {
    if (child instanceof TFolder) {
      const fromChild = resolveBibliographySourceInResearchRoot(app, child);
      if (fromChild) return filterBibliographyFilesFromFolder(app, fromChild);
    }
  }

  return [];
}

/** Une référence formatée : `Auteur. *Titre*. Éditeur, Date.` — chaque
 * segment n'apparaît que si le champ correspondant existe, sans jamais
 * laisser une ponctuation orpheline (point en tête, virgule flottante…).
 * L'URL, si présente, suit en dernier, hors de la phrase. */
function formatEntry(entry: BibliographyEntry): string {
  const segments: string[] = [];
  if (entry.author) segments.push(`${entry.author}.`);
  if (entry.title) segments.push(`*${entry.title}*.`);

  const venueParts: string[] = [];
  const container = entry.journal || entry.booktitle || entry.publisher;
  if (container) venueParts.push(container);
  if (entry.volume) {
    let vol = `vol. ${entry.volume}`;
    if (entry.number) vol += `, no. ${entry.number}`;
    venueParts.push(vol);
  } else if (entry.number) {
    venueParts.push(`no. ${entry.number}`);
  }
  if (entry.pages) {
    const p = entry.pages.includes("-") || entry.pages.includes("–") ? `pp. ${entry.pages}` : `p. ${entry.pages}`;
    venueParts.push(p);
  }
  const date = entry.date;
  if (date) venueParts.push(date);

  const venueText = venueParts.join(", ");
  if (venueText) segments.push(`${venueText}.`);

  const links: string[] = [];
  if (entry.doi) {
    const doiUrl = entry.doi.startsWith("http") ? entry.doi : `https://doi.org/${entry.doi}`;
    links.push(doiUrl);
  }
  const url = (entry.url || "").trim();
  if (url && (!entry.doi || !url.includes(entry.doi))) {
    links.push(url);
  }

  const text = segments.join(" ");
  const linkText = links.join(" ");
  if (!linkText) return text;
  return text ? `${text} ${linkText}` : linkText;
}

function sortCompare(a: BibliographyEntry, b: BibliographyEntry): number {
  const authorA = (a.author || a.title || "").trim();
  const authorB = (b.author || b.title || "").trim();
  const authorCmp = authorA.localeCompare(authorB, "fr", { sensitivity: "base" });
  if (authorCmp !== 0) return authorCmp;

  const yearA = (a.date || "").trim();
  const yearB = (b.date || "").trim();
  const yearCmp = yearA.localeCompare(yearB, "fr", { numeric: true });
  if (yearCmp !== 0) return yearCmp;

  const titleA = (a.title || "").trim();
  const titleB = (b.title || "").trim();
  return titleA.localeCompare(titleB, "fr", { sensitivity: "base" });
}

function dedupedEntries(entries: BibliographyEntry[]): Array<{ text: string; entry: BibliographyEntry }> {
  const seenBibtex = new Set<string>();
  const seenSourceTexts = new Set<string>();
  const out: Array<{ text: string; entry: BibliographyEntry }> = [];

  for (const entry of entries) {
    const text = formatEntry(entry);
    if (!text) continue;

    if (entry.bibliographyFilePath && entry.citekey) {
      const key = `${entry.bibliographyFilePath}::${entry.citekey}`;
      if (seenBibtex.has(key)) continue;
      seenBibtex.add(key);
      out.push({ text, entry });
    } else {
      if (seenSourceTexts.has(text)) continue;
      seenSourceTexts.add(text);
      out.push({ text, entry });
    }
  }

  return out;
}

export function bibliographyReferenceCount(entries: BibliographyEntry[]): number {
  return dedupedEntries(entries).length;
}

export function generateBibliography(entries: BibliographyEntry[]): string | null {
  const deduped = dedupedEntries(entries);
  if (!deduped.length) return null;
  const sorted = [...deduped].sort((a, b) => sortCompare(a.entry, b.entry));
  return `# Bibliographie\n\n${sorted.map((d) => d.text).join("\n\n")}\n`;
}
