import { Notice, TFolder, TFile, normalizePath } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { NewSheetModal, NewFolderModal } from "../ui/basic-modals.js";
import {
  getProjectFolder,
  getProjectRoot,
  getOrderedChildren,
  getResourcesRoot,
  resourcesSubfolderPath,
  editionFolderPath,
  getEditionRoot,
  getFeuilletsFolderNames,
  feuilletsAuxiliaryPath,
  feuilletsAuxiliaryRootPath,
  FEUILLETS_AUXILIARY_FOLDERS,
  FEUILLETS_RESOURCE_SUBFOLDERS,
  MANUSCRIPT_FOLDER_NAME,
  FRONT_FOLDER_NAME,
} from "./folder-structure.js";
import { getResearchRoot } from "./research.js";
import { getProjectMode } from "./project-mode.js";
import { getLocale } from "../i18n/index.js";
import { openFileActivating } from "../utils/dom.js";
import { applyModeDefaults, resolveType, PROJECT_MODES, projectBoardDefaults, researchFolderNames } from "../utils/project-modes.js";

export async function ensureFolder(app: App, path: string): Promise<TAbstractFile> {
  const p = normalizePath(path);
  let f = app.vault.getAbstractFileByPath(p);
  if (!f) {
    f = await app.vault.createFolder(p);
  }
  return f;
}

/** Crée l'espace auxiliaire V2 complet autour d'un dossier déjà utilisé
 * comme projet, sans jamais toucher à son contenu. Une Recherche legacy
 * reconnue est conservée ; les autres catégories suivent la source de
 * vérité FEUILLETS_AUXILIARY_FOLDERS. */
export async function ensureFeuilletsAuxiliaryFolders(
  app: App,
  root: TFolder,
  existingResearchPath?: string | null
): Promise<void> {
  for (const kind of Object.keys(FEUILLETS_AUXILIARY_FOLDERS) as Array<keyof typeof FEUILLETS_AUXILIARY_FOLDERS>) {
    const path = kind === "research" && existingResearchPath
      ? existingResearchPath
      : feuilletsAuxiliaryPath(root, kind);
    await ensureFolder(app, path);
  }
}

/** Base canonique des snapshots : le parent de Manuscrit pour un projet
 * structuré, le dossier actif lui-même dans tous les autres cas. */
function snapshotWriteBase(root: TFolder): TFolder {
  const parent = root.parent;
  return root.name === MANUSCRIPT_FOLDER_NAME
    && parent instanceof TFolder
    && parent.path !== ""
    && parent.path !== "/"
    ? parent
    : root;
}

/** Copie datée du feuillet dans _Snapshots/<nom>/<horodatage>.md. */
export async function snapshotFile(app: App, file: TFile, root: TFolder): Promise<string> {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
    d.getDate()
  )} ${p(d.getHours())}h${p(d.getMinutes())}${p(d.getSeconds())}`;
  const snapshotsPath = feuilletsAuxiliaryPath(root, "snapshots");
  const dir = normalizePath(`${snapshotsPath}/${file.basename}`);
  await ensureFolder(app, snapshotsPath);
  await ensureFolder(app, dir);
  const dest = normalizePath(`${dir}/${stamp}.md`);
  const content = await app.vault.read(file);
  await app.vault.create(dest, content);
  return stamp;
}

/** Récupère la liste des fichiers snapshots (.md) pour un feuillet, triés du plus récent au plus ancien. */
export function listSnapshotFiles(app: App, file: TFile | null | undefined, root: TFolder | null | undefined): TFile[] {
  if (!file || !root) return [];
  const canonicalBase = snapshotWriteBase(root);
  /* Lecture : le chemin canonique, puis l'ancien _Snapshots sous Manuscrit
     pour un projet structuré. Un dossier utilisé tel quel ne sort jamais de
     sa propre racine. */
  const candidates = canonicalBase === root ? [root.path] : [canonicalBase.path, root.path];
  const snapshotFolderNames = ["Snapshots", "_Snapshots"];
  const found: TFile[] = [];

  const canonicalPath = feuilletsAuxiliaryPath(root, "snapshots");
  const canonicalFolder = app.vault.getAbstractFileByPath(normalizePath(`${canonicalPath}/${file.basename}`));
  if (canonicalFolder instanceof TFolder) {
    for (const child of canonicalFolder.children) {
      if (child instanceof TFile) found.push(child);
    }
  }

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
async function copyFolderContents(app: App, folder: TFolder, destPath: string): Promise<void> {
  await ensureFolder(app, destPath);
  for (const child of folder.children) {
    const target = normalizePath(`${destPath}/${child.name}`);
    if (child instanceof TFolder) {
      await copyFolderContents(app, child, target);
    } else if (child instanceof TFile && !app.vault.getAbstractFileByPath(target)) {
      /* Vault.copy() exige Obsidian 1.8.7 ; minAppVersion reste 1.7.2 —
         lecture/écriture binaire reproduit la même copie octet pour octet,
         texte comme binaire (images, PDF de Recherche…). */
      const data = await app.vault.readBinary(child);
      await app.vault.createBinary(target, data);
    }
  }
}

/** Reporte l'ordre du binder (settings.orders, settings.folderPositions)
 * de l'arbre original vers sa copie, sans quoi une version dupliquée
 * retombe sur l'ordre alphabétique — orders est déjà une liste de NOMS
 * (identiques des deux côtés, copiable telle quelle), seul folderPositions
 * est indexé par chemin complet et doit être remappé. */
function copyOrderSettings(settings: FeuilletsSettings, origFolder: TFolder, destPath: string): void {
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

/** Dossier des versions archivées d'un projet — rangé sous l'espace
 * auxiliaire commun (`_Feuillets/Versions`, même convention que
 * Recherche/Ressources/Edition, voir FEUILLETS_AUXILIARY_FOLDERS), caché de
 * l'arborescence normale (préfixe "_") mais accessible via sa propre
 * section dans le volet dossiers du binder.
 *
 * Résolveur pur : ne crée ni ne déplace jamais rien. Trois emplacements
 * possibles, dans cet ordre, pour qu'aucun projet déjà créé ne perde
 * l'accès à ses versions après cette migration :
 *   1. le chemin canonique `_Feuillets/Versions` ;
 *   2. la variante `_Feuillets/_Versions` (nom historique avec préfixe,
 *      déplacé manuellement sous `_Feuillets` sans être renommé) ;
 *   3. l'ancien dossier frère `_Versions` (avant migration vers
 *      `_Feuillets`) — jamais déplacé automatiquement à l'ouverture du
 *      projet, voir duplicateProjectFolder pour ce qui change réellement
 *      sur le disque. */
export function getVersionsRoot(app: App, root: TFolder | null | undefined): TFolder | null {
  if (!root) return null;

  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "versions"));
  if (canonical instanceof TFolder) return canonical;

  const prefixedInAuxiliary = app.vault.getAbstractFileByPath(
    normalizePath(`${feuilletsAuxiliaryRootPath(root)}/_Versions`)
  );
  if (prefixedInAuxiliary instanceof TFolder) return prefixedInAuxiliary;

  /* Même base que l'ancien duplicateProjectFolder : le voisin (racine du
     projet réel) quand il existe et n'est pas la racine du coffre, sinon
     le dossier projet lui-même — jamais la racine du coffre. */
  const legacyBase =
    root.parent instanceof TFolder && root.parent.path !== "" && root.parent.path !== "/"
      ? root.parent.path
      : root.path;
  const legacy = app.vault.getAbstractFileByPath(normalizePath(`${legacyBase}/_Versions`));
  return legacy instanceof TFolder ? legacy : null;
}

/** Documents conventionnels du dossier Edition — créés vides (un simple
 * titre H1) à la création du dossier, jamais recréés s'ils existent déjà
 * (writeTemplate plus bas suit la même règle d'idempotence). L'autrice
 * reste libre de les renommer, supprimer ou d'en ajouter d'autres : cette
 * liste ne sert qu'à amorcer un dossier tout neuf. */
export const EDITION_DOCUMENTS = [
  { id: "synopsis", file: "Synopsis.md", variants: [] },
  { id: "note-intention", file: "Note d’intention.md", variants: ["Note d'intention.md"] },
  { id: "biographie", file: "Biographie.md", variants: [] },
  { id: "lettre-accompagnement", file: "Lettre d’accompagnement.md", variants: ["Lettre d'accompagnement.md"] },
] as const;

export type EditionDocument = typeof EDITION_DOCUMENTS[number];

/** Variantes lues pour un document éditorial : le nom canonique est créé,
 * les formes historiques avec apostrophe droite sont seulement reconnues. */
export function editionDocumentNames(document: EditionDocument): readonly string[] {
  return [document.file, ...document.variants];
}

/** Document conventionnel correspondant à un nom de fichier existant. */
export function editionDocumentForName(name: string): EditionDocument | undefined {
  return EDITION_DOCUMENTS.find((document) => editionDocumentNames(document).includes(name));
}

/** Sous-dossiers conventionnels du dossier Edition — suivi des envois aux
 * éditeurs/agents (Soumissions) et archivage de chaque version transmise
 * (Versions envoyées), créés vides en même temps que le dossier. */
export const EDITION_SUBFOLDERS = ["Soumissions", "Versions envoyées"];

/** Crée le dossier d'édition (racine du projet actif, nom "_Edition" de la
 * source centrale, voir editionFolderPath) avec ses sous-dossiers et
 * documents conventionnels — à la demande seulement, jamais à la création
 * d'un projet ni à l'ouverture d'un projet existant (même principe que
 * ensureJournalFolder : un projet ancien sans dossier d'édition n'en a
 * jamais un imposé). Idempotent : réutilise un dossier d'édition déjà
 * présent sur le disque — "_Edition" comme "Edition" (variante historique
 * sans préfixe) — et ne recrée ni n'écrase rien de déjà présent. Si
 * "Edition" existe déjà, "_Edition" n'est pas créé. */
export async function ensureEditionFolder(app: App, root: TFolder): Promise<TFolder> {
  /* getEditionRoot reconnaît "_Edition" puis "Edition" (variante
     historique) : tout dossier déjà présent est réutilisé tel quel. */
  const existing = getEditionRoot(app, root);
  const path = existing ? existing.path : editionFolderPath(app, root);
  await ensureFolder(app, path);
  for (const sub of EDITION_SUBFOLDERS) {
    await ensureFolder(app, normalizePath(`${path}/${sub}`));
  }
  for (const doc of EDITION_DOCUMENTS) {
    const docPath = normalizePath(`${path}/${doc.file}`);
    if (!app.vault.getAbstractFileByPath(docPath)) {
      const title = doc.file.replace(/\.md$/, "");
      await app.vault.create(docPath, `# ${title}\n\n`);
    }
  }
  const folder = getEditionRoot(app, root);
  if (!folder) throw new Error(`« ${path} » n'a pas pu être créé.`);
  return folder;
}

/** Duplique le dossier manuscrit d'un projet (chapitres/parties/scènes,
 * PAS la Recherche — les fiches personnages/lieux restent partagées entre
 * versions, comme le "Duplicate Manuscript" de Scrivener) dans
 * _Feuillets/Versions/<nom> (<étiquette>) — visible et consultable depuis
 * le volet dossiers du binder (section "Versions"), mais jamais mêlé au
 * manuscrit actif (compilation, numérotation, statistiques, Tableau). Sert
 * à figer une version (premier jet, etc.) avant de continuer à écrire sur
 * l'original. Retourne le chemin du dossier créé, ou lève une erreur si le
 * nom est déjà pris.
 *
 * N'écrit plus jamais dans l'ancien dossier frère `_Versions` : seul le
 * chemin canonique (feuilletsAuxiliaryPath(root, "versions"), même
 * convention que Recherche/Ressources/Edition) reçoit les NOUVELLES
 * versions. Les versions déjà présentes dans `_Versions` (ou
 * `_Feuillets/_Versions`) restent lisibles via getVersionsRoot — voir cette
 * fonction pour l'ordre de résolution — mais ne sont jamais déplacées
 * automatiquement ici. */
export async function duplicateProjectFolder(app: App, root: TFolder, label: string, settings?: FeuilletsSettings | null): Promise<string> {
  const safeLabel = String(label || "").trim().replace(/[\\/:*?"<>|]/g, "-");
  const destName = `${root.name} (${safeLabel || "copie"})`;
  const destPath = normalizePath(`${feuilletsAuxiliaryPath(root, "versions")}/${destName}`);
  if (app.vault.getAbstractFileByPath(destPath)) {
    throw new Error(`« ${destName} » existe déjà.`);
  }
  await copyFolderContents(app, root, destPath);
  if (settings) copyOrderSettings(settings, root, destPath);
  return destPath;
}

/** Erreur de validation levée par createMinimalProject — jamais un message
 * traduit directement (ce module ne connaît pas la langue d'affichage) :
 * `code` permet à l'appelant (NewProjectModal) de choisir le texte via
 * t(...), `path` porte le chemin déjà calculé pour l'interpoler. */
/** Base commune à tout nouveau projet, quelle que soit sa provenance
 * (createMinimalProject ci-dessous, ou le projet de démonstration —
 * demo-project.ts) : `Recherche` et `Ressources/{Images,Template,Layout,
 * Export,Assets}` à la racine réelle (`volumePath`, frères de Manuscrit),
 * et, pour les projets structurés, le dossier `Front` à l'intérieur de
 * Manuscrit. Une seule fonction pour
 * ne pas dupliquer cette liste de dossiers à deux endroits. Idempotent :
 * ensureFolder ne recrée jamais un dossier déjà présent.
 *
 * Les noms de Recherche et Ressources sont déterminés par la locale active
 * via getFeuilletsFolderNames — seuls les trois dossiers de base sont créés
 * ici, jamais les sous-dossiers de Recherche (Personnages, Lieux…) : c'est
 * le rôle d'initProjectStructure (commande « Initialiser la structure »). */
export async function ensureProjectBaseFolders(
  app: App,
  volumePath: string,
  manuscritPath: string,
  withFront = true
): Promise<{ frontPath: string | null }> {
  await ensureFolder(app, volumePath);
  await ensureFolder(app, manuscritPath);
  const virtualRoot = app.vault.getAbstractFileByPath(manuscritPath);
  if (!(virtualRoot instanceof TFolder)) throw new Error("Manuscrit introuvable après création.");
  await ensureFolder(app, feuilletsAuxiliaryPath(virtualRoot, "research"));
  const resourcesPath = feuilletsAuxiliaryPath(virtualRoot, "resources");
  await ensureFolder(app, resourcesPath);
  for (const { name, variants } of FEUILLETS_RESOURCE_SUBFOLDERS) {
    await ensureFolder(app, resourcesSubfolderPath(app, resourcesPath, name, ...variants));
  }
  const frontPath = withFront ? normalizePath(`${manuscritPath}/${FRONT_FOLDER_NAME}`) : null;
  if (frontPath) await ensureFolder(app, frontPath);
  return { frontPath };
}

export class CreateProjectError extends Error {
  code: "empty-name" | "already-exists";
  path?: string;
  constructor(code: "empty-name" | "already-exists", path?: string) {
    super(code);
    this.code = code;
    this.path = path;
  }
}

/** Contenu minimal d'une page de titre — mêmes rôles `:::` que le reste de
 * Feuillets (voir title-roles.js), avec en plus un vrai titre H1 et le nom
 * d'autrice/auteur en Markdown ordinaire tout de suite après : lisible et
 * complet même pour qui n'exporte jamais et n'a jamais entendu parler du
 * frontmatter. Le YAML reste un simple ajout de métadonnées, jamais une
 * condition : un Markdown sans aucun frontmatter continue de fonctionner
 * partout ailleurs dans Feuillets (compilation, Binder, Cartes, Plan). */
export function titlePageContent(projectTitle: string, author: string): string {
  const lines = [
    "---",
    `title: ${projectTitle}`,
    `author: ${author}`,
    "short_title: ",
    "order: 1",
    "synopsis: ",
    "status: ",
    "label: ",
    "tags: ",
    "date: ",
    "notes: ",
    "compile: true",
    "type: titre",
    "---",
    `:::titre: ${projectTitle}`,
    ":::sous-titre: ",
    ":::mots: ",
    `:::auteur: ${author}`,
    ":::adresse: ",
    ":::coordonnées: ",
    "",
  ];
  return lines.join("\n");
}

/** Frontmatter d'un feuillet de manuscrit fraîchement créé (chapitre ou
 * scène) — mêmes champs que newSheet() (voir plus bas), pour qu'un feuillet
 * posé par createMinimalProject soit en tout point identique à un feuillet
 * créé ensuite à la main par l'autrice. */
function manuscriptFileContent(title: string, order: number, isFiction: boolean, wordGoal: number): string {
  const lines = [
    "---",
    `title: ${title}`,
    "short_title: ",
    `order: ${order}`,
    ...(isFiction ? ["synopsis: "] : ["summary: "]),
    "status: ",
    "label: ",
    `goal: ${wordGoal}`,
    "tags: ",
    "date: ",
    "notes: ",
    ...(!isFiction ? ["sources: "] : []),
    "compile: true",
    "---",
    "",
    "",
  ];
  return lines.join("\n");
}

/** Crée la structure minimale d'un nouveau projet, à sa VRAIE racine :
 *
 *   Nom du projet/                      (racine réelle — voir getProjectRoot)
 *   ├── Manuscrit/                      (racine éditoriale — voir getManuscriptRoot)
 *   │   ├── Front/Page de titre.md
 *   │   └── Chapitre 1/Scène 1.md       (fiction) ou Partie 1/Chapitre 1.md (non-fiction)
 *   ├── Recherche/
 *   └── Ressources/{Images,Template,Layout,Export,Assets}/
 *
 * `Recherche` et `Ressources` sont frères de `Manuscrit`, jamais dedans, et
 * jamais préfixés (`_Recherche`) : c'est la RECONNAISSANCE d'un dossier
 * existant qui tolère l'ancien préfixe et les variantes anglaises
 * (getResearchRoot, getResourcesRoot), pas la CRÉATION d'un nouveau projet.
 *
 * Snapshots et Journal restent volontairement absents : ils se créent tout
 * seuls au premier usage réel (snapshotFile() au premier instantané,
 * ensureJournalFolder() à l'ouverture de l'onglet Journal). Qui veut les
 * poser dès la création peut lancer la commande "Initialiser la structure
 * du projet" (voir main.js, initProjectStructure) sur le projet actif une
 * fois créé.
 *
 * level1Role est fixé explicitement selon la forme réelle créée plutôt que
 * de reprendre tel quel le défaut du mode (voir applyModeDefaults) : pour
 * que roleOfFolder/roleOfFile (folder-structure.js) classent correctement
 * le premier feuillet, un dossier de premier niveau doit avoir le rôle qui
 * correspond à CE qu'il contient réellement ici — "Chapitre 1" est un
 * chapitre en fiction (rôle "chapitres" : le dossier de 1er niveau EST le
 * chapitre, les fichiers dedans sont des scènes), alors que "Partie 1" est
 * une partie en non-fiction (rôle "parties" : le fichier posé directement
 * dedans, "Chapitre 1.md", est alors classé "chapitre" et non "scène"). */
export async function createMinimalProject(
  app: App,
  settings: FeuilletsSettings,
  { name, parentFolder, type, author }: { name: string; parentFolder?: string; type: string; author?: string }
): Promise<{ volumePath: string; manuscritPath: string; firstFolderPath: string; firstFile: TFile }> {
  const trimmedName = (name || "").trim();
  if (!trimmedName) throw new CreateProjectError("empty-name");

  const parent = (parentFolder || "").trim().replace(/\/+$/, "");
  const volumePath = normalizePath(parent ? `${parent}/${trimmedName}` : trimmedName);
  if (app.vault.getAbstractFileByPath(volumePath)) {
    throw new CreateProjectError("already-exists", volumePath);
  }
  const trimmedAuthor = (author || "").trim();
  const projectType = resolveType(type);

  // --- Racine réelle : Manuscrit, Recherche, Ressources en frères ---
  const manuscritPath = normalizePath(`${volumePath}/${MANUSCRIPT_FOLDER_NAME}`);
  const { frontPath } = await ensureProjectBaseFolders(app, volumePath, manuscritPath, projectType !== "free");

  if (frontPath) {
    // --- Page de titre ---
    await app.vault.create(
      normalizePath(`${frontPath}/Page de titre.md`),
      titlePageContent(trimmedName, trimmedAuthor)
    );
  }

  // --- Corps du manuscrit, selon le type ---
  const isFiction = projectType === "fiction";
  let firstFolderPath: string;
  let firstFile: TFile;
  if (isFiction) {
    firstFolderPath = normalizePath(`${manuscritPath}/Chapitre 1`);
    await ensureFolder(app, firstFolderPath);
    firstFile = await app.vault.create(
      normalizePath(`${firstFolderPath}/Scène 1.md`),
      manuscriptFileContent("Scène 1", 1, true, settings.wordGoal)
    );
  } else if (projectType === "nonfiction") {
    firstFolderPath = normalizePath(`${manuscritPath}/Partie 1`);
    await ensureFolder(app, firstFolderPath);
    firstFile = await app.vault.create(
      normalizePath(`${firstFolderPath}/Chapitre 1.md`),
      manuscriptFileContent("Chapitre 1", 1, false, settings.wordGoal)
    );
  } else {
    firstFolderPath = manuscritPath;
    firstFile = await app.vault.create(
      normalizePath(`${manuscritPath}/Nouveau texte.md`),
      "# Nouveau texte\n\n"
    );
  }

  // --- Activation ---
  if (settings.projectFolder && !settings.projects.includes(settings.projectFolder)) {
    settings.projects.push(settings.projectFolder);
  }
  settings.projectFolder = manuscritPath;
  if (!settings.projectMeta[manuscritPath]) settings.projectMeta[manuscritPath] = {};
  settings.projectMeta[manuscritPath].type = projectType;
  /* Un projet créé ici est nécessairement neuf : ses préférences Board
     partent donc du type choisi, sans jamais hériter des réglages globaux
     legacy. Les projets existants restent initialisés paresseusement par
     BoardView, avec leur compatibilité dédiée. */
  const boardDefaults = projectBoardDefaults(projectType);
  settings.projectMeta[manuscritPath].hiddenBoardModes = boardDefaults.hiddenBoardModes;
  settings.projectMeta[manuscritPath].outlineCols = boardDefaults.outlineCols;
  if (trimmedAuthor) settings.projectMeta[manuscritPath].author = trimmedAuthor;
  applyModeDefaults(settings, type);
  /* Voir le commentaire de tête : correspond à la forme réelle créée
     ci-dessus, pas au défaut générique du mode. */
  settings.level1Role = isFiction ? "chapitres" : "parties";

  // --- Sous-dossiers de Recherche selon le mode ---
  const manuscriptFolder = app.vault.getAbstractFileByPath(manuscritPath);
  const researchPath = manuscriptFolder instanceof TFolder
    ? feuilletsAuxiliaryPath(manuscriptFolder, "research")
    : normalizePath(`${volumePath}/_Feuillets/Recherche`);
  await initResearchSubfolders(app, researchPath, type);

  return { volumePath, manuscritPath, firstFolderPath, firstFile };
}

/** Crée les dossiers _ et les fichiers Bases (personnages, lieux). */
/** Crée les sous-dossiers Recherche par défaut selon le mode du projet :
 * - Fiction : crée Personnages, Lieux, Événements, Lore, Glossaire
 * - Non-fiction : crée Notes, Sources
 * - Libre : ne crée aucune rubrique par défaut
 *
 * Bibliographie est une rubrique de compatibilité historique : elle reste reconnue
 * en lecture mais n'est jamais créée par défaut.
 *
 * Cette fonction ne crée JAMAIS les dossiers existants — elle reconnaît les variantes
 * canoniques et historiques et les réutilise, sans jamais les renommer ni les dupliquer. */
export async function initResearchSubfolders(
  app: App,
  researchPath: string,
  mode: string | null | undefined
): Promise<void> {
  const resolvedMode = resolveType(mode);
  const projectMode = PROJECT_MODES[resolvedMode];
  if (!projectMode) return;

  const defaultKeys = projectMode.defaultResearchFolders ?? [];

  for (const key of defaultKeys) {
    const names = researchFolderNames(projectMode.researchFolders, key);

    let exists = false;
    for (const name of names) {
      const path = normalizePath(`${researchPath}/${name}`);
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFolder) {
        exists = true;
        break;
      }
    }

    if (!exists && names.length > 0) {
      const newFolderPath = normalizePath(`${researchPath}/${names[0]}`);
      await ensureFolder(app, newFolderPath);
    }
  }
}

export async function initProjectStructure(
  app: App,
  settings: FeuilletsSettings,
  identity?: { title?: string; author?: string }
): Promise<void> {
  /* Racine réelle = dossier qui contient Manuscrit (ex. Projets/Mon recueil).
     getProjectRoot exclut la racine du coffre (path vide) : les dossiers ne
     sont jamais créés à la racine du coffre, toujours sous le projet actif. */
  const projectRoot = getProjectRoot(app, settings);
  if (!projectRoot) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  const base = projectRoot.path;
  const names = getFeuilletsFolderNames(getLocale());
  const manuscritRoot = getProjectFolder(app, settings);

  /* === Recherche ===
     getResearchRoot reconnaît _Recherche, Recherche, Research ; on vérifie
     aussi _Research (EN avec préfixe) non couvert par getResearchRoot. */
  let existingResearch = getResearchRoot(app, settings);
  if (!existingResearch) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/_Research`));
    if (f instanceof TFolder) existingResearch = f;
  }
  const researchPath = existingResearch
    ? existingResearch.path
    : manuscritRoot
      ? feuilletsAuxiliaryPath(manuscritRoot, "research")
      : normalizePath(`${base}/_Feuillets/Recherche`);
  await ensureFolder(app, researchPath);

  /* Sous-dossiers de Recherche selon le mode du projet — variantes historiques
     reconnues avant toute création pour éviter les doublons. */
  const projectMode = manuscritRoot ? settings.projectMeta[manuscritRoot.path]?.type : null;
  await initResearchSubfolders(app, researchPath, projectMode);

  /* === Snapshots, Backups, Journal ===
     Chacun est créé sous la racine réelle avec son préfixe `_`.
     Si une variante sans préfixe existe déjà (projet legacy), elle est
     reconnue et réutilisée — jamais renommée, jamais dupliquée. */
  const pickOrCreate = (preferred: string, ...legacyNames: string[]): string => {
    for (const v of legacyNames) {
      const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/${v}`));
      if (f instanceof TFolder) return f.path;
    }
    return preferred;
  };
  const auxiliaryRoot = manuscritRoot ? feuilletsAuxiliaryRootPath(manuscritRoot) : normalizePath(`${base}/_Feuillets`);
  await ensureFolder(app, pickOrCreate(normalizePath(`${auxiliaryRoot}/Snapshots`), "Snapshots", "_Snapshots"));
  await ensureFolder(app, pickOrCreate(normalizePath(`${auxiliaryRoot}/Backups`), "Backups", "_Backups"));
  await ensureFolder(app, pickOrCreate(normalizePath(`${auxiliaryRoot}/Journal`), "Journal", "_Journal"));

  /* === Ressources ===
     getResourcesRoot reconnaît _Ressources, _Resources, Ressources, Resources.
     Sous-dossiers créés avec les nouveaux noms FR/EN, variantes historiques
     reconnues pour éviter les doublons (Templates→Modèles, Layout→Mises en
     page, Assets→Ressources internes…). */
  const existingRes = manuscritRoot ? getResourcesRoot(app, manuscritRoot) : null;
  const resPath = existingRes
    ? existingRes.path
    : manuscritRoot
      ? feuilletsAuxiliaryPath(manuscritRoot, "resources")
      : normalizePath(`${base}/_Feuillets/Ressources`);
  await ensureFolder(app, resPath);
  for (const { name, variants } of FEUILLETS_RESOURCE_SUBFOLDERS) {
    await ensureFolder(app, resourcesSubfolderPath(app, resPath, name, ...variants));
  }
  /* Paths stables pour les writeTemplate ci-dessous. */
  const templateSub = FEUILLETS_RESOURCE_SUBFOLDERS.find((s) => s.key === "templates")!;
  const layoutSub = FEUILLETS_RESOURCE_SUBFOLDERS.find((s) => s.key === "layouts")!;
  const templateFolderPath = resourcesSubfolderPath(
    app, resPath, templateSub.name, ...templateSub.variants
  );
  const layoutsPath = resourcesSubfolderPath(
    app, resPath, layoutSub.name, ...layoutSub.variants
  );

  const writeTemplate = async (path: string, content: string): Promise<void> => {
    const norm = normalizePath(path);
    if (!app.vault.getAbstractFileByPath(norm)) {
      await app.vault.create(norm, content).catch(() => {});
    }
  };

  /* Exemple de modèle d'export personnalisé — un point de départ concret
     à dupliquer plutôt qu'une page blanche. Même format que les modèles
     intégrés (src/utils/export-templates.js), lu via le frontmatter
     (voir services/export-templates-custom.js), pas de format à part. */
  await writeTemplate(`${layoutsPath}/Exemple.md`, [
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

  const initializedProjectType = resolveType(projectMode);

  if (initializedProjectType === "fiction") {
    // Templates de fiction
    await writeTemplate(`${templateFolderPath}/Characters.md`, [
      "---",
      "last_name: ",
      "first_name: ",
      "birth: ",
      "death: ",
      "synopsis: ",
      "tags:",
      "  - personnage",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Places.md`, [
      "---",
      'title: "Nouveau lieu"',
      "description: ",
      "tags:",
      "  - lieu",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Lore.md`, [
      "---",
      'title: "Nouvelle entrée"',
      "description: ",
      "tags:",
      "  - codex",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Bibliography.md`, [
      "---",
      'title: "Nouvelle référence"',
      "author: ",
      "date: ",
      "publisher: ",
      "synopsis: ",
      "tags:",
      "  - bibliographie",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Glossary.md`, [
      "---",
      'title: "Nouveau terme"',
      "definition: ",
      "synopsis: ",
      "tags:",
      "  - glossaire",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Events.md`, [
      "---",
      'title: "Nouvel événement"',
      "date: ",
      "end_date: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n"));
  } else if (initializedProjectType === "nonfiction") {
    // Templates de non-fiction
    await writeTemplate(`${templateFolderPath}/Sources.md`, [
      "---",
      'title: "Nouvelle source"',
      "author: ",
      "date: ",
      "publisher: ",
      "pages: ",
      "url: ",
      "synopsis: ",
      "tags:",
      "  - source",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Acteurs.md`, [
      "---",
      "last_name: ",
      "first_name: ",
      "role: ",
      "synopsis: ",
      "tags:",
      "  - personnage",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Geographie.md`, [
      "---",
      'title: "Nouvelle entrée"',
      "description: ",
      "tags:",
      "  - lieu",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Concepts.md`, [
      "---",
      'title: "Nouveau concept"',
      "description: ",
      "tags:",
      "  - codex",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Bibliography.md`, [
      "---",
      'title: "Nouvelle référence"',
      "author: ",
      "date: ",
      "publisher: ",
      "synopsis: ",
      "tags:",
      "  - bibliographie",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Glossary.md`, [
      "---",
      'title: "Nouveau terme"',
      "definition: ",
      "synopsis: ",
      "tags:",
      "  - glossaire",
      "---",
      ""
    ].join("\n"));

    await writeTemplate(`${templateFolderPath}/Events.md`, [
      "---",
      'title: "Nouvel événement"',
      "date: ",
      "end_date: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n"));
  }

  if (initializedProjectType !== "free") {
    /* Front — enfant direct de Manuscrit (pas un voisin), paraît dans le
       Binder au même niveau que les Parties, juste avant elles. */
    const manuscritForFront = getProjectFolder(app, settings)!;
    const frontFolderPath = normalizePath(`${manuscritForFront.path}/Front`);
    await ensureFolder(app, frontFolderPath);

    /* Page de titre pré-remplie : générée via le seul générateur titlePageContent()
       sans jamais utiliser settings.manuscriptTitle.
       Sans identité explicite, le titre est le nom de la racine réelle du projet,
       et l'auteur est issu de projectMeta si présent.
       Jamais réécrite si une page de titre existe déjà. */
    const realRoot = getProjectRoot(app, settings);
    const realRootName = realRoot ? realRoot.name : manuscritForFront.name;
    const projectTitle = identity?.title?.trim() || realRootName;
    const projectAuthor = identity?.author?.trim() || settings.projectMeta[manuscritForFront.path]?.author || "";

    const titlePagePath = normalizePath(`${frontFolderPath}/Page de titre.md`);
    const titlePageEnPath = normalizePath(`${frontFolderPath}/Title Page.md`);

    if (!app.vault.getAbstractFileByPath(titlePagePath) && !app.vault.getAbstractFileByPath(titlePageEnPath)) {
      await writeTemplate(titlePagePath, titlePageContent(projectTitle, projectAuthor));
    }
  }

  const listParts = [
    ...(initializedProjectType === "free" ? [] : ["Front"]),
    researchPath.split("/").pop(),
    names.snapshots,
    names.backups,
    names.journal,
    resPath.split("/").pop(),
  ].join(", ");
  new Notice(`Structure initialisée : ${listParts}.`);
}

/** `onDone` : appelé après création réussie (le plugin y branche son
 * propre rafraîchissement des vues, ce module ne connaît pas les vues). */
export function newFolder(app: App, parent: TFolder, onDone?: () => void): void {
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

export function newSheet(app: App, settings: FeuilletsSettings, folder: TFolder): void {
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
      `title: ${chapTitle || ""}`,
      "short_title: ",
      `order: ${position}`,
      ...(isFiction ? ["synopsis: "] : ["summary: "]),
      "status: ",
      "label: ",
      `goal: ${settings.wordGoal}`,
      "tags: ",
      "date: ",
      "notes: ",
      ...(!isFiction ? ["sources: "] : []),
      "compile: true",
      "---",
      "",
      "",
    ];
    const file = await app.vault.create(path, lines.join("\n"));
    openFileActivating(app, app.workspace.getLeaf(false), file);
  }).open();
}
