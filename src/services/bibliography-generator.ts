import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { getResearchRoot } from "./research.js";
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
  const f = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${SOURCES_FOLDER_NAME}`));
  return f instanceof TFolder ? f : null;
}

function bibliographyFolder(app: App, researchRoot: TFolder): TFolder | null {
  for (const name of BIBLIOGRAPHY_FOLDER_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
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
  const sources = sourcesFolder(app, researchRoot);
  if (sources) return { folder: sources, canonical: true };
  const legacy = bibliographyFolder(app, researchRoot);
  if (legacy) return { folder: legacy, canonical: false };
  return null;
}

function fieldOf(fm: Record<string, unknown>, key: string): string | undefined {
  const value = toValue(fm[key]).trim();
  return value || undefined;
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
  const out: BibliographyEntry[] = [];
  for (const child of resolved.folder.children || []) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const fm = app.metadataCache.getFileCache(child)?.frontmatter || {};
    if (resolved.canonical && !(Number(fm.cite_count) > 0)) continue;
    out.push({
      author: fieldOf(fm, "author"),
      title: fieldOf(fm, "title"),
      publisher: fieldOf(fm, "publisher"),
      date: fieldOf(fm, "date"),
      url: fieldOf(fm, "url"),
    });
  }
  return out;
}

/** Une référence formatée : `Auteur. *Titre*. Éditeur, Date.` — chaque
 * segment n'apparaît que si le champ correspondant existe, sans jamais
 * laisser une ponctuation orpheline (point en tête, virgule flottante…).
 * L'URL, si présente, suit en dernier, hors de la phrase. */
function formatEntry(entry: BibliographyEntry): string {
  const segments: string[] = [];
  if (entry.author) segments.push(`${entry.author}.`);
  if (entry.title) segments.push(`*${entry.title}*.`);
  const publisherDate = [entry.publisher, entry.date].filter(Boolean).join(", ");
  if (publisherDate) segments.push(`${publisherDate}.`);
  const text = segments.join(" ");
  const url = (entry.url || "").trim();
  if (!url) return text;
  return text ? `${text} ${url}` : url;
}

/** Clé de tri : l'auteur, ou le titre si l'auteur est absent — exactement
 * la règle demandée, comparée insensible à la casse. */
function sortKey(entry: BibliographyEntry): string {
  return (entry.author || entry.title || "").trim().toLocaleLowerCase("fr");
}

/** Références formatées et dédupliquées (texte final EXACTEMENT identique
 * — une fiche vide, sans aucun champ utilisable, ne produit aucune entrée),
 * dans l'ordre d'arrivée : la première occurrence d'un texte l'emporte. */
function dedupedEntries(entries: BibliographyEntry[]): Array<{ text: string; entry: BibliographyEntry }> {
  const seen = new Set<string>();
  const out: Array<{ text: string; entry: BibliographyEntry }> = [];
  for (const entry of entries) {
    const text = formatEntry(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, entry });
  }
  return out;
}

/** Nombre de références réellement incluses (après déduplication) — sert à
 * l'UI (ui/bibliography-panel.ts) pour afficher « N références » sans
 * recalculer le texte généré. */
export function bibliographyReferenceCount(entries: BibliographyEntry[]): number {
  return dedupedEntries(entries).length;
}

/** Bibliographie : titre `# Bibliographie` suivi d'une référence par
 * paragraphe, triées par auteur puis par titre. `null` s'il n'existe aucune
 * référence exploitable — jamais de page générée vide (même règle que la
 * Table des illustrations, Phase 7). */
export function generateBibliography(entries: BibliographyEntry[]): string | null {
  const deduped = dedupedEntries(entries);
  if (!deduped.length) return null;
  const sorted = [...deduped].sort((a, b) => sortKey(a.entry).localeCompare(sortKey(b.entry), "fr"));
  return `# Bibliographie\n\n${sorted.map((d) => d.text).join("\n\n")}\n`;
}
