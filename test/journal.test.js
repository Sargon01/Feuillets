import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Notice, normalizePath } from "obsidian";
import {
  getDayEntry,
  getLastEntry,
  journalEntryKeys,
  listDayEntries,
  ensureDayEntry,
  compileJournal,
  parseDayFileName,
  normalizeJournalSuffix,
} from "../src/services/journal.js";
import { setLocale, getLocale } from "../src/i18n/index.js";

/** Vault minimal : les fichiers/dossiers passés sont enregistrés tels
 * quels par chemin ; `create()` pousse le nouveau fichier dans les
 * `children` de son dossier parent (déjà enregistré) pour que les
 * fonctions du Journal, qui lisent `folder.children`, le voient. */
function createFakeVault(seed = []) {
  const files = new Map();
  for (const item of seed) files.set(item.path, item);
  return {
    getAbstractFileByPath: (path) => files.get(path) || null,
    createFolder: async (path) => {
      const p = normalizePath(path);
      const tf = new TFolder(p);
      files.set(p, tf);
      return tf;
    },
    create: async (path, content = "") => {
      const p = normalizePath(path);
      const tf = new TFile(p, content);
      const parentPath = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      const parent = files.get(parentPath);
      if (parent) {
        tf.parent = parent;
        parent.children.push(tf);
      }
      files.set(p, tf);
      return tf;
    },
    read: async (file) => file.content ?? "",
    modify: async (file, content) => { file.content = content; },
  };
}

/** Projet + dossier Journal (déjà créé, vide ou avec des entrées) — même
 * convention que le reste du plugin : Journal est un frère de Manuscrit. */
function makeProject(entries = []) {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const journal = new TFolder("Projet/Journal", entries);
  for (const file of entries) file.parent = journal;
  const app = { vault: createFakeVault([root, journal, ...entries]) };
  return { app, root, journal };
}

function makeSettings(overrides = {}) {
  return { projectFolder: "Projet/Manuscrit", journalFolder: "Journal", journalFileSuffix: "", ...overrides };
}

/** Capture les notifications émises via `new Notice(...)` — l'appelant DOIT
 * restaurer `Notice.onCreate` dans un `finally` (voir chaque test ci-dessous)
 * pour ne jamais polluer les tests suivants. */
function captureNotices() {
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  return notices;
}

test("journal : liste et lit les notes quotidiennes", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const journal = new TFolder("Projet/Journal", [
    new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nTroisième."),
    new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nPremier."),
    new TFile("Projet/Journal/Notes.md", "hors journal"),
  ]);
  const files = new Map([[root.path, root], [journal.path, journal], ...journal.children.map((file) => [file.path, file])]);
  const app = { vault: { getAbstractFileByPath: (path) => files.get(path) || null, read: async (file) => file.content } };
  const settings = { projectFolder: root.path, journalFolder: "Journal" };
  assert.deepEqual(listDayEntries(app, settings).map((file) => file.basename), ["2026-01-01", "2026-01-03"]);
  assert.deepEqual([...journalEntryKeys(app, settings)], ["2026-01-01", "2026-01-03"]);
  assert.deepEqual(await getDayEntry(app, settings, new Date(2026, 0, 3)), { file: journal.children[0], key: "2026-01-03", body: "Troisième." });
});

test("journal : réglage absent → comportement historique inchangé (pas de suffixe)", async () => {
  const entry = new TFile("Projet/Journal/2026-04-02.md", "---\ndate: 2026-04-02\n---\nSans réglage.");
  const { app } = makeProject([entry]);
  const settings = { projectFolder: "Projet/Manuscrit", journalFolder: "Journal" };
  const result = await getDayEntry(app, settings, new Date(2026, 3, 2));
  assert.deepEqual(result, { file: entry, key: "2026-04-02", body: "Sans réglage." });
});

test("journal : crée AAAA-MM-JJ.md quand le suffixe est vide", async () => {
  const { app } = makeProject();
  const settings = makeSettings();
  const file = await ensureDayEntry(app, settings, new Date(2026, 8, 15));
  assert.equal(file.path, "Projet/Journal/2026-09-15.md");
});

test("journal : crée AAAA-MM-JJ-suffixe.md quand le suffixe est configuré", async () => {
  const { app } = makeProject();
  const settings = makeSettings({ journalFileSuffix: "log" });
  const file = await ensureDayEntry(app, settings, new Date(2026, 8, 15));
  assert.equal(file.path, "Projet/Journal/2026-09-15-log.md");
});

test("journal : normalizeJournalSuffix nettoie le suffixe avant enregistrement", () => {
  assert.equal(normalizeJournalSuffix("  log  "), "log");
  assert.equal(normalizeJournalSuffix("mon//projet"), "monprojet");
  assert.equal(normalizeJournalSuffix("mon---projet"), "mon-projet");
  assert.equal(normalizeJournalSuffix("-.- log -.-"), "log");
  assert.equal(normalizeJournalSuffix("a<b>c:d\"e/f\\g|h?i*j"), "abcdefghij");
  assert.equal(normalizeJournalSuffix("   "), "");
  assert.equal(normalizeJournalSuffix(""), "");
});

test("journal : getDayEntry lit un ancien fichier non suffixé", async () => {
  const entry = new TFile("Projet/Journal/2026-01-05.md", "---\ndate: 2026-01-05\n---\nAncien.");
  const { app } = makeProject([entry]);
  const settings = makeSettings({ journalFileSuffix: "" });
  assert.deepEqual(await getDayEntry(app, settings, new Date(2026, 0, 5)), { file: entry, key: "2026-01-05", body: "Ancien." });
});

test("journal : getDayEntry lit un fichier suffixé", async () => {
  const entry = new TFile("Projet/Journal/2026-01-05-log.md", "---\ndate: 2026-01-05\n---\nSuffixé.");
  const { app } = makeProject([entry]);
  const settings = makeSettings({ journalFileSuffix: "log" });
  assert.deepEqual(await getDayEntry(app, settings, new Date(2026, 0, 5)), { file: entry, key: "2026-01-05", body: "Suffixé." });
});

test("journal : parseDayFileName extrait la date logique indépendamment du suffixe", () => {
  assert.deepEqual(parseDayFileName("2026-01-05.md"), { date: "2026-01-05", suffix: null });
  assert.deepEqual(parseDayFileName("2026-01-05-log.md"), { date: "2026-01-05", suffix: "log" });
  assert.deepEqual(parseDayFileName("2026-01-05-mon-projet.md"), { date: "2026-01-05", suffix: "mon-projet" });
  assert.equal(parseDayFileName("Notes.md"), null);
  assert.equal(parseDayFileName("2026-1-5.md"), null);
});

test("journal : changer le suffixe ne duplique pas l'entrée du jour", async () => {
  const { app, journal } = makeProject();
  const settings = makeSettings({ journalFileSuffix: "" });
  const date = new Date(2026, 2, 1);

  const first = await ensureDayEntry(app, settings, date);
  assert.equal(first.path, "Projet/Journal/2026-03-01.md");

  settings.journalFileSuffix = "log";
  const second = await ensureDayEntry(app, settings, date);

  assert.equal(second, first);
  assert.equal(journal.children.length, 1);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Journal/2026-03-01-log.md"), null);
});

test("journal : une seule entrée exposée par date, priorité au suffixe configuré", async () => {
  const bare = new TFile("Projet/Journal/2026-02-10.md", "Bare.");
  const log = new TFile("Projet/Journal/2026-02-10-log.md", "Log.");
  const brouillon = new TFile("Projet/Journal/2026-02-10-brouillon.md", "Brouillon.");
  const { app } = makeProject([bare, log, brouillon]);

  const withLog = makeSettings({ journalFileSuffix: "log" });
  assert.deepEqual(listDayEntries(app, withLog), [log]);
  assert.equal((await getDayEntry(app, withLog, new Date(2026, 1, 10))).file, log);

  const withUnknownSuffix = makeSettings({ journalFileSuffix: "inconnu" });
  assert.deepEqual(listDayEntries(app, withUnknownSuffix), [bare]);

  const withoutSuffix = makeSettings({ journalFileSuffix: "" });
  assert.deepEqual(listDayEntries(app, withoutSuffix), [bare]);
});

test("journal : repli sur une variante suffixée quelconque quand aucun fichier non suffixé n'existe", async () => {
  const log = new TFile("Projet/Journal/2026-02-11-log.md", "Log.");
  const brouillon = new TFile("Projet/Journal/2026-02-11-brouillon.md", "Brouillon.");
  const { app } = makeProject([brouillon, log]);
  const settings = makeSettings({ journalFileSuffix: "autre" });
  const entries = listDayEntries(app, settings);
  assert.equal(entries.length, 1);
  assert.ok(entries[0] === log || entries[0] === brouillon);
});

test("journal : journalEntryKeys et getLastEntry utilisent la date logique", async () => {
  const older = new TFile("Projet/Journal/2026-01-01-log.md", "---\ndate: 2026-01-01\n---\nAncienne.");
  const latest = new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nDernière.");
  const { app } = makeProject([older, latest]);
  const settings = makeSettings({ journalFileSuffix: "log" });

  assert.deepEqual([...journalEntryKeys(app, settings)], ["2026-01-01", "2026-01-03"]);

  const last = await getLastEntry(app, settings);
  assert.equal(last.key, "2026-01-03");
  assert.equal(last.file, latest);
  assert.equal(last.body, "Dernière.");
});

test("journal : compileJournal produit des titres sans suffixe", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01-log.md", "---\ndate: 2026-01-01\n---\nUn.");
  const day2 = new TFile("Projet/Journal/2026-01-02.md", "---\ndate: 2026-01-02\n---\nDeux.");
  const { app } = makeProject([day1, day2]);
  const settings = makeSettings({ journalFileSuffix: "log" });

  const count = await compileJournal(app, settings);
  assert.equal(count, 2);

  const carnet = app.vault.getAbstractFileByPath("Projet/Journal/Journal d'écriture.md");
  assert.ok(carnet instanceof TFile);
  assert.equal(carnet.content, "## 2026-01-01\n\nUn.\n\n## 2026-01-02\n\nDeux.");
});

// ================= Internationalisation et compatibilité du carnet =================

test("compileJournal (FR, aucun carnet existant) : crée Journal d'écriture.md, contenu inchangé, notification française, pluriel", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn.");
  const day2 = new TFile("Projet/Journal/2026-01-02.md", "---\ndate: 2026-01-02\n---\nDeux.");
  const { app } = makeProject([day1, day2]);
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    setLocale("fr");
    const notices = captureNotices();
    const count = await compileJournal(app, makeSettings());

    assert.equal(count, 2);
    const carnet = app.vault.getAbstractFileByPath("Projet/Journal/Journal d'écriture.md");
    assert.ok(carnet instanceof TFile);
    assert.equal(carnet.content, "## 2026-01-01\n\nUn.\n\n## 2026-01-02\n\nDeux.");
    assert.deepEqual(notices, ["Carnet compilé : 2 jours → Journal d'écriture.md"]);
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal (EN, aucun carnet existant) : crée Writing journal.md, aucun fichier français créé, notification anglaise", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nOne.");
  const { app } = makeProject([day1]);
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    setLocale("en");
    const notices = captureNotices();
    const count = await compileJournal(app, makeSettings());

    assert.equal(count, 1);
    const carnet = app.vault.getAbstractFileByPath("Projet/Journal/Writing journal.md");
    assert.ok(carnet instanceof TFile);
    assert.equal(app.vault.getAbstractFileByPath("Projet/Journal/Journal d'écriture.md"), null, "aucun fichier français créé");
    assert.deepEqual(notices, ["Journal compiled: 1 day → Writing journal.md"]);
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : une seule entrée → « 1 jour »/« 1 day », jamais le pluriel", async () => {
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    {
      const day = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn.");
      const { app } = makeProject([day]);
      setLocale("fr");
      const notices = captureNotices();
      await compileJournal(app, makeSettings());
      assert.match(notices[0], /\b1 jour\b/);
      assert.doesNotMatch(notices[0], /1 jours\b/);
    }
    {
      const day = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nOne.");
      const { app } = makeProject([day]);
      setLocale("en");
      const notices = captureNotices();
      await compileJournal(app, makeSettings());
      assert.match(notices[0], /\b1 day\b/);
      assert.doesNotMatch(notices[0], /1 days\b/);
    }
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : plusieurs entrées → « jours »/« days »", async () => {
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    {
      const entries = [
        new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn."),
        new TFile("Projet/Journal/2026-01-02.md", "---\ndate: 2026-01-02\n---\nDeux."),
        new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nTrois."),
      ];
      const { app } = makeProject(entries);
      setLocale("fr");
      const notices = captureNotices();
      await compileJournal(app, makeSettings());
      assert.match(notices[0], /\b3 jours\b/);
    }
    {
      const entries = [
        new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nOne."),
        new TFile("Projet/Journal/2026-01-02.md", "---\ndate: 2026-01-02\n---\nTwo."),
      ];
      const { app } = makeProject(entries);
      setLocale("en");
      const notices = captureNotices();
      await compileJournal(app, makeSettings());
      assert.match(notices[0], /\b2 days\b/);
    }
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : changement FR → EN après une première compilation française met à jour le fichier français existant", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn.");
  const { app } = makeProject([day1]);
  const settings = makeSettings();
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    setLocale("fr");
    Notice.onCreate = null;
    await compileJournal(app, settings);
    const frenchPath = "Projet/Journal/Journal d'écriture.md";
    const frenchCarnet = app.vault.getAbstractFileByPath(frenchPath);
    assert.ok(frenchCarnet instanceof TFile);

    setLocale("en");
    const notices = captureNotices();
    const count = await compileJournal(app, settings);

    assert.equal(count, 1);
    assert.equal(app.vault.getAbstractFileByPath(frenchPath), frenchCarnet, "le fichier français existant est réutilisé, jamais renommé");
    assert.equal(app.vault.getAbstractFileByPath("Projet/Journal/Writing journal.md"), null, "aucun fichier anglais créé");
    assert.deepEqual(notices, ["Journal compiled: 1 day → Journal d'écriture.md"], "notification anglaise citant le nom français réel");
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : changement EN → FR après une première compilation anglaise met à jour le fichier anglais existant", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nOne.");
  const { app } = makeProject([day1]);
  const settings = makeSettings();
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    setLocale("en");
    Notice.onCreate = null;
    await compileJournal(app, settings);
    const englishPath = "Projet/Journal/Writing journal.md";
    const englishCarnet = app.vault.getAbstractFileByPath(englishPath);
    assert.ok(englishCarnet instanceof TFile);

    setLocale("fr");
    const notices = captureNotices();
    const count = await compileJournal(app, settings);

    assert.equal(count, 1);
    assert.equal(app.vault.getAbstractFileByPath(englishPath), englishCarnet, "le fichier anglais existant est réutilisé, jamais renommé");
    assert.equal(app.vault.getAbstractFileByPath("Projet/Journal/Journal d'écriture.md"), null, "aucun fichier français créé");
    assert.deepEqual(notices, ["Carnet compilé : 1 jour → Writing journal.md"], "notification française citant le nom anglais réel");
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : quand les deux carnets historiques existent, seul celui de la langue courante est modifié", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn.");
  const frenchCarnet = new TFile("Projet/Journal/Journal d'écriture.md", "ancien contenu fr");
  const englishCarnet = new TFile("Projet/Journal/Writing journal.md", "ancien contenu en");
  const { app, journal } = makeProject([day1, frenchCarnet, englishCarnet]);
  const settings = makeSettings();
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = null;
  try {
    setLocale("fr");
    await compileJournal(app, settings);
    assert.notEqual(frenchCarnet.content, "ancien contenu fr", "le carnet français est régénéré");
    assert.equal(englishCarnet.content, "ancien contenu en", "le carnet anglais n'est jamais touché en FR");
    assert.equal(journal.children.length, 3, "aucun troisième fichier créé");

    const englishBefore = englishCarnet.content;
    setLocale("en");
    await compileJournal(app, settings);
    assert.notEqual(englishCarnet.content, englishBefore, "le carnet anglais est régénéré");
    assert.equal(journal.children.length, 3, "toujours aucun troisième fichier créé");
    assert.ok([...journal.children].includes(frenchCarnet), "le carnet français n'a pas été supprimé");
    assert.ok([...journal.children].includes(englishCarnet), "le carnet anglais n'a pas été supprimé");
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : aucune entrée quotidienne → retourne 0, notification traduite, aucun carnet ni dossier créé", async () => {
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  try {
    const makeEmptyProject = () => {
      const root = new TFolder("Projet/Manuscrit");
      root.parent = new TFolder("Projet");
      return { app: { vault: createFakeVault([root]) } };
    };

    {
      const { app } = makeEmptyProject();
      setLocale("fr");
      const notices = captureNotices();
      const count = await compileJournal(app, makeSettings());
      assert.equal(count, 0);
      assert.deepEqual(notices, ["Aucune note de journal à compiler."]);
      assert.equal(app.vault.getAbstractFileByPath("Projet/Journal"), null, "aucun dossier créé");
    }
    {
      const { app } = makeEmptyProject();
      setLocale("en");
      const notices = captureNotices();
      const count = await compileJournal(app, makeSettings());
      assert.equal(count, 0);
      assert.deepEqual(notices, ["No journal entry to compile."]);
      assert.equal(app.vault.getAbstractFileByPath("Projet/Journal"), null, "aucun dossier créé");
    }
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});

test("compileJournal : le carnet compilé reste exclu de listDayEntries et journalEntryKeys, quelle que soit la locale", async () => {
  const day1 = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nUn.");
  const frenchCarnet = new TFile("Projet/Journal/Journal d'écriture.md", "ancien contenu fr");
  const englishCarnet = new TFile("Projet/Journal/Writing journal.md", "ancien contenu en");
  const { app } = makeProject([day1, frenchCarnet, englishCarnet]);
  const settings = makeSettings();
  const previousLocale = getLocale();
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = null;
  try {
    // Les deux carnets historiques préexistent déjà (comme dans un vault
    // réel) : ni l'un ni l'autre ne doit jamais être lu comme une entrée
    // quotidienne, avant ou après compilation, dans aucune des deux langues.
    setLocale("fr");
    await compileJournal(app, settings);
    assert.deepEqual(listDayEntries(app, settings).map((f) => f.path), [day1.path]);
    assert.deepEqual([...journalEntryKeys(app, settings)], ["2026-01-01"]);

    setLocale("en");
    await compileJournal(app, settings);
    assert.deepEqual(listDayEntries(app, settings).map((f) => f.path), [day1.path]);
    assert.deepEqual([...journalEntryKeys(app, settings)], ["2026-01-01"]);
  } finally {
    setLocale(previousLocale);
    Notice.onCreate = previousOnCreate;
  }
});
