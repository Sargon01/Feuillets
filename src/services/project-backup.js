const { TFile, TFolder, normalizePath } = require("obsidian");
import JSZip from "jszip";
import { ensureFolder } from "./project-files.js";

/** Dossier des sauvegardes .zip automatiques d'un projet — même convention
 * que _Recherche/_Versions/_Snapshots (voisin du dossier manuscrit s'il y
 * en a un, sinon enfant du dossier projet). */
export function getBackupsRoot(app, root) {
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  const f = app.vault.getAbstractFileByPath(normalizePath(`${base}/_Backups`));
  return f instanceof TFolder ? f : null;
}

async function addFolderToZip(app, zip, folder, skipPath) {
  const jobs = [];
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
export async function createProjectBackup(app, root, settings) {
  const base = root.parent || root;
  const backupsPath = normalizePath(`${base.path}/_Backups`);
  await ensureFolder(app, backupsPath);

  const zip = new JSZip();
  await addFolderToZip(app, zip, base, backupsPath);
  const data = await zip.generateAsync({ type: "uint8array" });

  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
  const destPath = normalizePath(`${backupsPath}/${base.name} ${stamp}.zip`);
  await app.vault.createBinary(destPath, data);

  await rotateBackups(app, backupsPath, settings.backupKeepCount);
  return destPath;
}

async function rotateBackups(app, backupsPath, keepCount) {
  const folder = app.vault.getAbstractFileByPath(backupsPath);
  if (!(folder instanceof TFolder)) return;
  const keep = Math.max(1, keepCount || 1);
  const zips = folder.children
    .filter((c) => c instanceof TFile && c.extension === "zip")
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  for (const old of zips.slice(keep)) {
    await app.vault.delete(old);
  }
}
