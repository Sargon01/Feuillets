const { Notice, TFolder, TFile, normalizePath } = require("obsidian");
import { NewSheetModal, NewFolderModal } from "../ui/basic-modals.js";
import { getProjectFolder, getOrderedChildren } from "./folder-structure.js";
import { getResearchRoot } from "./research.js";
import { ensureJournalFolder } from "./journal.js";
import { getProjectMode } from "./project-mode.js";
import { openFileActivating } from "../utils/dom.js";

export async function ensureFolder(app, path) {
  const p = normalizePath(path);
  let f = app.vault.getAbstractFileByPath(p);
  if (!f) {
    f = await app.vault.createFolder(p);
  }
  return f;
}

/** Copie datée du feuillet dans _Snapshots/<nom>/<horodatage>.md. Comme
 * _Recherche, ce dossier peut être un enfant du dossier projet (ancienne
 * convention) ou son voisin (quand "Dossier projet" pointe directement
 * sur le sous-dossier des parties/chapitres) — les deux emplacements
 * existants sont respectés ; à défaut, créé en voisin. */
export async function snapshotFile(app, file, root) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
    d.getDate()
  )} ${p(d.getHours())}h${p(d.getMinutes())}${p(d.getSeconds())}`;
  const candidates = [root.path, root.parent ? root.parent.path : null].filter(
    Boolean
  );
  /* "Snapshots" sans underscore : reconnu UNIQUEMENT voisin du dossier
     projet, jamais dedans — même restriction que "Recherche", pour ne
     jamais apparaître comme une fausse Partie dans le binder. */
  let base = root.parent && app.vault.getAbstractFileByPath(
    normalizePath(`${root.parent.path}/Snapshots`)
  ) instanceof TFolder
    ? root.parent.path
    : null;
  let folderName = "Snapshots";
  if (!base) {
    /* legacy : anciens projets créés avant l'abandon du préfixe _,
       où _Snapshots pouvait être voisin ou enfant du dossier projet */
    const legacyBase = candidates.find((b) =>
      app.vault.getAbstractFileByPath(normalizePath(`${b}/_Snapshots`))
    );
    if (legacyBase) {
      base = legacyBase;
      folderName = "_Snapshots";
    }
  }
  if (!base) base = root.parent ? root.parent.path : root.path;
  const dir = normalizePath(`${base}/${folderName}/${file.basename}`);
  await ensureFolder(app, normalizePath(`${base}/${folderName}`));
  await ensureFolder(app, dir);
  const dest = normalizePath(`${dir}/${stamp}.md`);
  const content = await app.vault.read(file);
  await app.vault.create(dest, content);
  return stamp;
}

/** Récupère la liste des fichiers snapshots (.md) pour un feuillet, triés du plus récent au plus ancien. */
export function listSnapshotFiles(app, file, root) {
  if (!file || !root) return [];
  const candidates = [root.path, root.parent ? root.parent.path : null].filter(Boolean);
  const snapshotFolderNames = ["Snapshots", "_Snapshots"];
  const found = [];

  for (const base of candidates) {
    for (const folderName of snapshotFolderNames) {
      // 1. Recherche dans le sous-dossier Snapshots/<file.basename>/
      const subFolderPath = normalizePath(`${base}/${folderName}/${file.basename}`);
      const subFolder = app.vault.getAbstractFileByPath(subFolderPath);
      if (subFolder instanceof TFolder && Array.isArray(subFolder.children)) {
        for (const child of subFolder.children) {
          if (child instanceof TFile && !found.some((f) => f.path === child.path)) {
            found.push(child);
          }
        }
      }

      // 2. Recherche directe dans Snapshots/ (pour compatibilité)
      const mainFolderPath = normalizePath(`${base}/${folderName}`);
      const mainFolder = app.vault.getAbstractFileByPath(mainFolderPath);
      if (mainFolder instanceof TFolder && Array.isArray(mainFolder.children)) {
        const targetName = file.basename.toLowerCase();
        for (const child of mainFolder.children) {
          if (child instanceof TFile && child.name && child.name.toLowerCase().includes(targetName)) {
            if (!found.some((f) => f.path === child.path)) {
              found.push(child);
            }
          }
        }
      }
    }
  }

  return found.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** Copie récursive du contenu d'un dossier (fichiers + sous-dossiers) vers
 * destPath, qui est créé s'il n'existe pas encore. */
async function copyFolderContents(app, folder, destPath) {
  await ensureFolder(app, destPath);
  for (const child of folder.children) {
    const target = normalizePath(`${destPath}/${child.name}`);
    if (child instanceof TFolder) {
      await copyFolderContents(app, child, target);
    } else if (child instanceof TFile && !app.vault.getAbstractFileByPath(target)) {
      await app.vault.copy(child, target);
    }
  }
}

/** Reporte l'ordre du binder (settings.orders, settings.folderPositions)
 * de l'arbre original vers sa copie, sans quoi une version dupliquée
 * retombe sur l'ordre alphabétique — orders est déjà une liste de NOMS
 * (identiques des deux côtés, copiable telle quelle), seul folderPositions
 * est indexé par chemin complet et doit être remappé. */
function copyOrderSettings(settings, origFolder, destPath) {
  if (settings.orders[origFolder.path]) {
    settings.orders[destPath] = [...settings.orders[origFolder.path]];
  }
  for (const child of origFolder.children) {
    if (!(child instanceof TFolder)) continue;
    const childDest = normalizePath(`${destPath}/${child.name}`);
    if (typeof settings.folderPositions[child.path] === "number") {
      settings.folderPositions[childDest] = settings.folderPositions[child.path];
    }
    copyOrderSettings(settings, child, childDest);
  }
}

/** Dossier des versions archivées d'un projet — même convention que
 * _Recherche/_Snapshots (voisin du dossier manuscrit s'il y en a un, sinon
 * enfant du dossier projet), caché de l'arborescence normale (préfixe "_")
 * mais accessible via sa propre section dans le volet dossiers du binder. */
export function getVersionsRoot(app, root) {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/_Versions`));
  return f instanceof TFolder ? f : null;
}

/** Duplique le dossier manuscrit d'un projet (chapitres/parties/scènes,
 * PAS la Recherche — les fiches personnages/lieux restent partagées entre
 * versions, comme le "Duplicate Manuscript" de Scrivener) dans
 * _Versions/<nom> (<étiquette>) — visible et consultable depuis le volet
 * dossiers du binder (section "Versions"), mais jamais mêlé au manuscrit
 * actif (compilation, numérotation, statistiques, Tableau). Sert à figer
 * une version (premier jet, etc.) avant de continuer à écrire sur
 * l'original. Retourne le chemin du dossier créé, ou lève une erreur si le
 * nom est déjà pris. */
export async function duplicateProjectFolder(app, root, label, settings) {
  const base = root.parent ? root.parent.path : root.path;
  const safeLabel = String(label || "").trim().replace(/[\\/:*?"<>|]/g, "-");
  const destName = `${root.name} (${safeLabel || "copie"})`;
  const destPath = normalizePath(`${base}/_Versions/${destName}`);
  if (app.vault.getAbstractFileByPath(destPath)) {
    throw new Error(`« ${destName} » existe déjà.`);
  }
  await copyFolderContents(app, root, destPath);
  if (settings) copyOrderSettings(settings, root, destPath);
  return destPath;
}

/** Crée les dossiers _ et les fichiers Bases (personnages, lieux). */
export async function initProjectStructure(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  /* base de la recherche : reprend l'emplacement existant s'il y en a
     déjà un (voisin ou enfant du dossier projet), sinon la crée à côté
     du dossier projet plutôt qu'à l'intérieur — c'est la convention
     correcte quand "Dossier projet" pointe directement sur le
     sous-dossier des parties/chapitres (Manuscrit), avec _Recherche et
     _Snapshots comme voisins, pas comme enfants. */
  const existingResearch = getResearchRoot(app, settings);
  const base = existingResearch
    ? existingResearch.parent
      ? existingResearch.parent.path
      : root.path
    : root.parent
    ? root.parent.path
    : root.path;
  const rf = getProjectMode(app, settings).researchFolders;
  const foldersToCreate = ["Recherche"];
  for (const key of ["sources", "bibliographie", "personnages", "lieux", "codex", "glossaire"]) {
    if (rf[key]) {
      foldersToCreate.push(`Recherche/${rf[key].label}`);
    }
  }
  foldersToCreate.push("Recherche/Chronologie");
  foldersToCreate.push("Snapshots");

  for (const d of foldersToCreate) {
    await ensureFolder(app, `${base}/${d}`);
  }

  // Initialisation du dossier Ressources au niveau frère (sibling) de root (Manuscrit)
  const resPath = root.parent ? `${root.parent.path}/Ressources` : `${root.path}/Ressources`;
  await ensureFolder(app, resPath);
  await ensureFolder(app, `${resPath}/Templates`);
  await ensureFolder(app, `${resPath}/Export`);
  await ensureFolder(app, `${resPath}/Visuels`);
  await ensureFolder(app, `${resPath}/Modèles`);

  const writeTemplate = async (path, content) => {
    const norm = normalizePath(path);
    if (!app.vault.getAbstractFileByPath(norm)) {
      await app.vault.create(norm, content).catch(() => {});
    }
  };

  /* Exemple de modèle d'export personnalisé — un point de départ concret
     à dupliquer plutôt qu'une page blanche. Même format que les modèles
     intégrés (src/utils/export-templates.js), lu via le frontmatter
     (voir services/export-templates-custom.js), pas de format à part. */
  await writeTemplate(`${resPath}/Modèles/Exemple.md`, [
    "---",
    "label: Mon modèle",
    "fontFamily: Georgia, serif",
    "fontSizePt: 12",
    "lineHeight: 1.5",
    "align: justify",
    "indent: true",
    "marginCm: 2.5",
    "paragraphSpacing: false",
    "pageNumbers: true",
    "hyphenation: true",
    'sceneDivider: "* * *"',
    "---",
    "",
    "Ce fichier est un modèle d'export personnalisé — il apparaît dans le",
    "menu « Compiler et exporter » sous le nom « Mon modèle ». Modifie les",
    "champs ci-dessus (dans le panneau Propriétés ou en texte) pour créer",
    "ton propre style, et duplique ce fichier pour en créer d'autres.",
    "",
    "Champs avancés possibles (voir src/utils/export-templates.js pour la",
    "liste complète) : headings (styles par niveau de titre), marginsCm",
    "(marges asymétriques), pageOrientation, columns, blockquote...",
    ""
  ].join("\n"));

  const isFiction = getProjectMode(app, settings).yamlPreset === "roman" || getProjectMode(app, settings).yamlPreset === "nouvelle";

  if (isFiction) {
    // Templates de fiction
    await writeTemplate(`${resPath}/Templates/Personnages.md`, [
      "---",
      "nom: ",
      "prénom: ",
      "naissance: ",
      "mort: ",
      "synopsis: ",
      "tags:",
      "  - personnage",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Lieux.md`, [
      "---",
      'titre: "Nouveau lieu"',
      "description: ",
      "tags:",
      "  - lieu",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Lore.md`, [
      "---",
      'titre: "Nouvelle entrée"',
      "description: ",
      "tags:",
      "  - codex",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Bibliographie.md`, [
      "---",
      'titre: "Nouvelle référence"',
      "auteur: ",
      "annee: ",
      "edition: ",
      "synopsis: ",
      "tags:",
      "  - bibliographie",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Glossaire.md`, [
      "---",
      'titre: "Nouveau terme"',
      "definition: ",
      "synopsis: ",
      "tags:",
      "  - glossaire",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Evenements.md`, [
      "---",
      'titre: "Nouvel événement"',
      "date: ",
      "date_fin: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n"));
  } else {
    // Templates de non-fiction
    await writeTemplate(`${resPath}/Templates/Sources.md`, [
      "---",
      'titre: "Nouvelle source"',
      "auteur: ",
      "date: ",
      "editeur: ",
      "pages: ",
      "url: ",
      "synopsis: ",
      "tags:",
      "  - source",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Acteurs.md`, [
      "---",
      "nom: ",
      "prénom: ",
      "fonction: ",
      "synopsis: ",
      "tags:",
      "  - personnage",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Geographie.md`, [
      "---",
      'titre: "Nouvelle entrée"',
      "description: ",
      "tags:",
      "  - lieu",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Concepts.md`, [
      "---",
      'titre: "Nouveau concept"',
      "description: ",
      "tags:",
      "  - codex",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Bibliographie.md`, [
      "---",
      'titre: "Nouvelle référence"',
      "auteur: ",
      "annee: ",
      "edition: ",
      "synopsis: ",
      "tags:",
      "  - bibliographie",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Glossaire.md`, [
      "---",
      'titre: "Nouveau terme"',
      "definition: ",
      "synopsis: ",
      "tags:",
      "  - glossaire",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${resPath}/Templates/Evenements.md`, [
      "---",
      'titre: "Nouvel événement"',
      "date: ",
      "date_fin: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n"));
  }

  await ensureJournalFolder(app, settings);
  /* Front, lui, est un enfant direct du dossier projet — pas un voisin
     comme Recherche/Snapshots — puisqu'il doit apparaître dans le
     binder au même niveau que les Parties, juste avant elles. */
  await ensureFolder(app, `${root.path}/Front`);

  /* Page de titre pré-remplie : structure à rôles (:::titre:, :::sous-titre:…
     — voir utils/title-roles.js) prête à compléter, seul le titre étant
     rempli d'emblée avec le nom du projet (même source que le titre du
     manuscrit, settings.manuscriptTitle sinon le nom du dossier). Écrite via
     writeTemplate : idempotent, ne réécrit jamais une page de titre déjà
     composée. */
  const projectTitle = settings.manuscriptTitle || root.name;
  await writeTemplate(`${root.path}/Front/Page de titre.md`, [
    "---",
    `titre: ${projectTitle}`,
    "titre_binder: ",
    "ordre: 1",
    "synopsis: ",
    "statut: ",
    "label: ",
    "tags: ",
    "date: ",
    "notes: ",
    "compiler: true",
    "type: titre",
    "---",
    `:::titre: ${projectTitle}`,
    ":::sous-titre: ",
    ":::mots: ",
    ":::auteur: ",
    ":::adresse: ",
    ":::coordonnées: ",
    "",
  ].join("\n"));

  const listParts = [`Front`, `Recherche`, `Snapshots`, `Ressources`, `Journal`].join(", ");
  new Notice(
    `Structure initialisée : ${listParts}.`
  );
}

/** `onDone` : appelé après création réussie (le plugin y branche son
 * propre rafraîchissement des vues, ce module ne connaît pas les vues). */
export function newFolder(app, parent, onDone) {
  new NewFolderModal(app, parent.name, async (name) => {
    const path = normalizePath(`${parent.path}/${name}`);
    if (app.vault.getAbstractFileByPath(path)) {
      new Notice("Un dossier portant ce nom existe déjà.");
      return;
    }
    await app.vault.createFolder(path);
    if (onDone) onDone();
  }).open();
}

export function newSheet(app, settings, folder) {
  new NewSheetModal(app, folder.name, async (fileName, chapTitle) => {
    const path = normalizePath(`${folder.path}/${fileName}.md`);
    if (app.vault.getAbstractFileByPath(path)) {
      new Notice("Un feuillet portant ce nom existe déjà.");
      return;
    }
    const position = getOrderedChildren(app, settings, folder).length + 1;
    const isFiction = getProjectMode(app, settings).yamlPreset === "roman" || getProjectMode(app, settings).yamlPreset === "nouvelle";
    const lines = [
      "---",
      `titre: ${chapTitle || ""}`,
      "titre_binder: ",
      `ordre: ${position}`,
      ...(isFiction ? ["synopsis: "] : ["resume: "]),
      "statut: ",
      "label: ",
      `objectif: ${settings.wordGoal}`,
      "tags: ",
      "date: ",
      "notes: ",
      ...(!isFiction ? ["sources: "] : []),
      "compiler: true",
      "---",
      "",
      "",
    ];
    const file = await app.vault.create(path, lines.join("\n"));
    openFileActivating(app, app.workspace.getLeaf(false), file);
  }).open();
}
