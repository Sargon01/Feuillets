import { TFile, TFolder, Notice, normalizePath } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { dateKey } from "../utils/journal-stats.js";
import { buildCarnet } from "../utils/journal-carnet.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
/** Nom du carnet compilé — fixe, indépendant du nom du dossier
 * (configurable, peut être "Journal" ou autre chose). */
const CARNET_NAME = "Journal d'écriture";

/** Dossier du journal : le chemin configuré, résolu comme frère du dossier
 * projet en priorité (même convention que Recherche/Snapshots), sinon
 * comme enfant s'il existe déjà là — jamais une convention nouvelle. */
export function getJournalRoot(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const rel = settings.journalFolder || "Journal";
  const bases = [root.parent ? root.parent.path : null, root.path].filter(Boolean);
  for (const base of bases) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/${rel}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Base à utiliser pour CRÉER le dossier du journal s'il n'existe pas
 * encore : frère du dossier projet, comme Recherche/Snapshots/Sortie. */
function journalBase(root) {
  return root.parent ? root.parent.path : root.path;
}

export async function ensureJournalFolder(app, settings) {
  const existing = getJournalRoot(app, settings);
  if (existing) return existing;
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const rel = settings.journalFolder || "Journal";
  const folderPath = normalizePath(`${journalBase(root)}/${rel}`);
  const check = app.vault.getAbstractFileByPath(folderPath);
  if (check instanceof TFolder) return check;
  try {
    return await app.vault.createFolder(folderPath);
  } catch (e) {
    const retry = app.vault.getAbstractFileByPath(folderPath);
    if (retry instanceof TFolder) return retry;
    throw e;
  }
}

export function dayEntryPath(app, settings, date) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const existing = getJournalRoot(app, settings);
  const rel = settings.journalFolder || "Journal";
  const base = existing ? existing.path : normalizePath(`${journalBase(root)}/${rel}`);
  return normalizePath(`${base}/${dateKey(date)}.md`);
}

export async function ensureDayEntry(app, settings, date) {
  const path = dayEntryPath(app, settings, date);
  if (!path) return null;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  await ensureJournalFolder(app, settings);
  const lines = ["---", `date: ${dateKey(date)}`, "notes: ", "---", "", ""];
  return await app.vault.create(path, lines.join("\n"));
}

/** Fichiers de notes quotidiennes du dossier journal, triés par date — le
 * nom de fichier AAAA-MM-JJ.md trie déjà correctement en ordre chronologique. */
export function listDayEntries(app, settings) {
  const folder = getJournalRoot(app, settings);
  if (!folder) return [];
  return folder.children
    .filter((f) => f instanceof TFile && DAY_RE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** Note quotidienne la plus récente, prête à afficher (ou `null` si aucune
 * note n'a encore été créée). */
export async function getLastEntry(app, settings) {
  const entries = listDayEntries(app, settings);
  if (entries.length === 0) return null;
  const file = entries[entries.length - 1];
  const content = await app.vault.read(file);
  return { file, key: file.basename, body: stripFrontmatter(content) };
}

/** Note d'un jour précis, prête à afficher (ou `null` si ce jour n'a pas
 * encore de note). */
export async function getDayEntry(app, settings, date) {
  const path = dayEntryPath(app, settings, date);
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const content = await app.vault.read(file);
  return { file, key: dateKey(date), body: stripFrontmatter(content) };
}

/** Clés AAAA-MM-JJ des jours qui ont déjà une note — pour les indicateurs
 * du calendrier. */
export function journalEntryKeys(app, settings) {
  return new Set(listDayEntries(app, settings).map((f) => f.basename));
}

/** Régénère entièrement le carnet compilé à partir des notes quotidiennes
 * — jamais retouché à la main, reconstruit à chaque appel, même logique
 * que la compilation du manuscrit (services/compile-export.js). */
export async function compileJournal(app, settings) {
  const entries = listDayEntries(app, settings);
  if (entries.length === 0) {
    new Notice("Aucune note de journal à compiler.");
    return 0;
  }
  const sections = [];
  for (const file of entries) {
    const content = await app.vault.read(file);
    sections.push({ key: file.basename, body: stripFrontmatter(content) });
  }
  const carnet = buildCarnet(sections);
  const folder = (await ensureJournalFolder(app, settings)) || getJournalRoot(app, settings);
  const path = normalizePath(`${folder.path}/${CARNET_NAME}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, carnet);
  } else {
    await app.vault.create(path, carnet);
  }
  new Notice(`Carnet compilé : ${entries.length} jour(s) → ${CARNET_NAME}.md`);
  return entries.length;
}
