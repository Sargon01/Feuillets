import { TFile, TFolder, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { feuilletsAuxiliaryPath, getProjectFolder } from "./folder-structure.js";
import { dateKey } from "../utils/journal-stats.js";
import { buildCarnet } from "../utils/journal-carnet.js";

/** Nom de fichier d'une note quotidienne, avec ou sans suffixe configurable
 * (chantier « suffixe des fichiers du journal ») : groupe 1 = date logique
 * AAAA-MM-JJ, groupe 2 = suffixe (sans le "-" séparateur) ou undefined. */
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:-(.+))?\.md$/;
/** Caractères interdits dans un nom de fichier (Windows étant le plus
 * restrictif) — neutralisés par normalizeJournalSuffix. Les caractères de
 * contrôle (0x00-0x1F) sont neutralisés séparément par stripControlChars,
 * pour éviter une classe de regex contenant des caractères de contrôle. */
const FORBIDDEN_FILENAME_CHARS_RE = /[<>:"/\\|?*]/g;

/** Retire les caractères de contrôle (0x00-0x1F), non portables dans un nom
 * de fichier — écrit sans classe de regex pour rester lisible par les
 * analyseurs statiques (no-control-regex). */
function stripControlChars(value: string): string {
  let result = "";
  for (const ch of value) {
    if ((ch.codePointAt(0) ?? 0) >= 0x20) result += ch;
  }
  return result;
}
/** Nom du carnet compilé — fixe, indépendant du nom du dossier
 * (configurable, peut être "Journal" ou autre chose). */
const CARNET_NAME = "Journal d'écriture";

/** Normalise un suffixe de fichier journal avant son enregistrement dans les
 * réglages : espaces de bord supprimés, caractères interdits/non portables
 * neutralisés, tirets répétés fusionnés, aucun point/espace/tiret en
 * bordure. Le "-" séparateur n'est jamais stocké ici — il est ajouté à la
 * construction du nom de fichier (voir dayFileName). Idempotente : peut être
 * réappliquée sans effet à une valeur déjà normalisée. */
export function normalizeJournalSuffix(raw: string): string {
  if (typeof raw !== "string") return "";
  let value = stripControlChars(raw).trim().replace(FORBIDDEN_FILENAME_CHARS_RE, "");
  value = value.replace(/-{2,}/g, "-");
  value = value.replace(/^[-.\s]+/, "").replace(/[-.\s]+$/, "");
  return value;
}

/** Nom de fichier pour une date et un suffixe donnés (déjà normalisé ou
 * non — dayFileName normalise défensivement). Suffixe vide = comportement
 * historique inchangé, "AAAA-MM-JJ.md". */
function dayFileName(dateStr: string, suffix: string): string {
  const normalized = normalizeJournalSuffix(suffix || "");
  return normalized ? `${dateStr}-${normalized}.md` : `${dateStr}.md`;
}

/** Date logique et suffixe (ou `null`) d'un nom de fichier de note
 * quotidienne, ou `null` si ce nom ne correspond pas au format attendu. */
export function parseDayFileName(name: string): { date: string; suffix: string | null } | null {
  const match = DAY_FILE_RE.exec(name);
  if (!match) return null;
  return { date: match[1], suffix: match[2] ?? null };
}

/** Toutes les notes quotidiennes existantes pour UNE date logique, triées
 * par nom de fichier (ordre arbitraire mais déterministe entre variantes). */
function dayEntryCandidates(folder: TFolder, dateStr: string): TFile[] {
  return folder.children
    .filter((f): f is TFile => f instanceof TFile && parseDayFileName(f.name)?.date === dateStr)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parmi plusieurs variantes existantes pour une même date, celle à exposer
 * dans le Journal (jamais deux entrées pour un même jour) — ordre de
 * préférence : suffixe actuellement configuré, puis ancien fichier sans
 * suffixe, puis n'importe quel autre fichier suffixé. */
function preferredDayEntry(candidates: TFile[], suffix: string): TFile | null {
  if (candidates.length === 0) return null;
  if (suffix) {
    const configured = candidates.find((f) => parseDayFileName(f.name)?.suffix === suffix);
    if (configured) return configured;
  }
  const bare = candidates.find((f) => parseDayFileName(f.name)?.suffix === null);
  if (bare) return bare;
  return candidates[0];
}

/** Dossier du journal : le chemin configuré, résolu comme frère du dossier
 * projet en priorité (même convention que Recherche/Snapshots), sinon
 * comme enfant s'il existe déjà là — jamais une convention nouvelle. */
export function getJournalRoot(app: App, settings: FeuilletsSettings): TFolder | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "journal"));
  if (canonical instanceof TFolder) return canonical;
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
export async function ensureJournalFolder(app: App, settings: FeuilletsSettings): Promise<TFolder | null> {
  const existing = getJournalRoot(app, settings);
  if (existing) return existing;
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const folderPath = feuilletsAuxiliaryPath(root, "journal");
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

/** Chemin de la note quotidienne d'une date : celui d'une variante déjà
 * existante (n'importe quel suffixe, jamais renommée ni dupliquée — règles
 * 6/7 du chantier suffixe) si une note existe déjà pour ce jour, sinon le
 * chemin à utiliser pour EN créer une avec le suffixe actuellement
 * configuré. */
export function dayEntryPath(app: App, settings: FeuilletsSettings, date: Date): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const key = dateKey(date);
  const existingFolder = getJournalRoot(app, settings);
  if (existingFolder) {
    const preferred = preferredDayEntry(
      dayEntryCandidates(existingFolder, key),
      normalizeJournalSuffix(settings.journalFileSuffix || "")
    );
    if (preferred) return preferred.path;
  }
  const base = existingFolder ? existingFolder.path : feuilletsAuxiliaryPath(root, "journal");
  return normalizePath(`${base}/${dayFileName(key, settings.journalFileSuffix || "")}`);
}

export async function ensureDayEntry(app: App, settings: FeuilletsSettings, date: Date): Promise<TFile | null> {
  const path = dayEntryPath(app, settings, date);
  if (!path) return null;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  await ensureJournalFolder(app, settings);
  const lines = ["---", `date: ${dateKey(date)}`, "notes: ", "---", "", ""];
  return await app.vault.create(path, lines.join("\n"));
}

/** Fichiers de notes quotidiennes du dossier journal, triés par date logique
 * — une seule entrée par jour même si plusieurs variantes de suffixe
 * coexistent sur le disque (règle 8 du chantier suffixe), la clé AAAA-MM-JJ
 * triant déjà correctement en ordre chronologique. */
export function listDayEntries(app: App, settings: FeuilletsSettings): TFile[] {
  const folder = getJournalRoot(app, settings);
  if (!folder) return [];
  const suffix = normalizeJournalSuffix(settings.journalFileSuffix || "");
  const byDate = new Map<string, TFile[]>();
  for (const f of folder.children) {
    if (!(f instanceof TFile)) continue;
    const parsed = parseDayFileName(f.name);
    if (!parsed) continue;
    const list = byDate.get(parsed.date);
    if (list) list.push(f);
    else byDate.set(parsed.date, [f]);
  }
  const result: TFile[] = [];
  for (const key of [...byDate.keys()].sort()) {
    const preferred = preferredDayEntry(byDate.get(key)!.sort((a, b) => a.name.localeCompare(b.name)), suffix);
    if (preferred) result.push(preferred);
  }
  return result;
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** Note quotidienne la plus récente, prête à afficher (ou `null` si aucune
 * note n'a encore été créée). */
export async function getLastEntry(app: App, settings: FeuilletsSettings) {
  const entries = listDayEntries(app, settings);
  if (entries.length === 0) return null;
  const file = entries[entries.length - 1];
  const content = await app.vault.read(file);
  const key = parseDayFileName(file.name)?.date ?? file.basename;
  return { file, key, body: stripFrontmatter(content) };
}

/** Note d'un jour précis, prête à afficher (ou `null` si ce jour n'a pas
 * encore de note). */
export async function getDayEntry(app: App, settings: FeuilletsSettings, date: Date) {
  const path = dayEntryPath(app, settings, date);
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const content = await app.vault.read(file);
  return { file, key: dateKey(date), body: stripFrontmatter(content) };
}

/** Clés AAAA-MM-JJ des jours qui ont déjà une note — pour les indicateurs
 * du calendrier. */
export function journalEntryKeys(app: App, settings: FeuilletsSettings) {
  return new Set(listDayEntries(app, settings).map((f) => parseDayFileName(f.name)?.date ?? f.basename));
}

/** Régénère entièrement le carnet compilé à partir des notes quotidiennes
 * — jamais retouché à la main, reconstruit à chaque appel, même logique
 * que la compilation du manuscrit (services/compile-export.js). */
export async function compileJournal(app: App, settings: FeuilletsSettings) {
  const entries = listDayEntries(app, settings);
  if (entries.length === 0) {
    new Notice("Aucune note de journal à compiler.");
    return 0;
  }
  const sections: Array<{ key: string; body: string }> = [];
  for (const file of entries) {
    const content = await app.vault.read(file);
    const key = parseDayFileName(file.name)?.date ?? file.basename;
    sections.push({ key, body: stripFrontmatter(content) });
  }
  const carnet = buildCarnet(sections);
  const folder = (await ensureJournalFolder(app, settings)) || getJournalRoot(app, settings);
  const path = normalizePath(`${folder!.path}/${CARNET_NAME}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, carnet);
  } else {
    await app.vault.create(path, carnet);
  }
  new Notice(`Carnet compilé : ${entries.length} jour(s) → ${CARNET_NAME}.md`);
  return entries.length;
}
