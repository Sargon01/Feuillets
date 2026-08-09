import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import JSZip from "jszip";
import { ensureFolder } from "./project-files.js";
import { feuilletsAuxiliaryPath, MANUSCRIPT_FOLDER_NAME } from "./folder-structure.js";

/** Dossier des sauvegardes .zip automatiques d'un projet — même convention
 * que _Recherche/_Versions/_Snapshots (voisin du dossier manuscrit s'il y
 * en a un, sinon enfant du dossier projet). */
type BackupSettings = { backupKeepCount?: number };

/** Racine couverte par une sauvegarde. Seul le dossier Manuscrit d'un
 * projet Feuillets structuré remonte à son parent ; un dossier choisi tel
 * quel reste toujours sa propre racine. La racine du coffre est exclue. */
function getBackupSourceRoot(root: TFolder): TFolder {
  const parent = root.parent;
  return root.name === MANUSCRIPT_FOLDER_NAME
    && parent instanceof TFolder
    && parent.path !== ""
    && parent.path !== "/"
    ? parent
    : root;
}

export function getBackupsRoot(app: App, root: TFolder | null | undefined): TFolder | null {
  if (!root) return null;
  const canonical = app.vault.getAbstractFileByPath(feuilletsAuxiliaryPath(root, "backups"));
  if (canonical instanceof TFolder) return canonical;
  const base = getBackupSourceRoot(root).path;
  const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/_Backups`));
  return f instanceof TFolder ? f : null;
}

async function addFolderToZip(app: App, zip: JSZip, folder: TFolder, skipPath: string): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const child of folder.children) {
    if (child.path === skipPath) continue;
    if (child instanceof TFolder) {
      jobs.push(addFolderToZip(app, zip, child, skipPath));
    } else if (child instanceof TFile) {
      jobs.push(app.vault.readBinary(child).then((buf) => { zip.file(child.path, buf); }));
    }
  }
  await Promise.all(jobs);
}

/** Copie .zip de tout le projet actif (manuscrit + recherche + versions +
 * snapshots — tout ce qui vit sous le dossier de base du projet), en
 * complément des _Versions manuelles : un filet de sécurité automatique
 * si l'auteur oublie de dupliquer avant une grosse réécriture, comme la
 * sauvegarde de projet de Scrivener à la fermeture. Fait tourner la
 * rotation (settings.backupKeepCount) après écriture. Retourne le chemin
 * du .zip créé. */
export async function createProjectBackup(app: App, root: TFolder, settings: BackupSettings): Promise<string> {
  const base = getBackupSourceRoot(root);
  const existing = getBackupsRoot(app, root);
  const backupsPath = existing?.path ?? feuilletsAuxiliaryPath(root, "backups");
  await ensureFolder(app, backupsPath);

  const zip = new JSZip();
  await addFolderToZip(app, zip, base, backupsPath);
  const data = await zip.generateAsync({ type: "uint8array" });

  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
  const destPath = normalizePath(`${backupsPath}/${base.name} ${stamp}.zip`);
  await app.vault.createBinary(destPath, data as unknown as ArrayBuffer);

  await rotateBackups(app, backupsPath, settings.backupKeepCount);
  return destPath;
}

async function rotateBackups(app: App, backupsPath: string, keepCount: number | undefined): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(backupsPath);
  if (!(folder instanceof TFolder)) return;
  const keep = Math.max(1, keepCount || 1);
  const zips = folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === "zip")
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  for (const old of zips.slice(keep)) {
    await app.fileManager.trashFile(old);
  }
}
