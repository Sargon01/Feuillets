const { TFile, normalizePath } = require("obsidian");

/** Note de dossier (Partie ou Chapitre) : convention « même nom que le
 * dossier, à l'intérieur » (ex. « Partie I/Partie I.md »), reconnaissable
 * sans dépendre du frontmatter — et donc jamais confondue avec une scène
 * (voir l'exclusion dans services/folder-structure.js: getOrderedChildren). */
export function folderNoteFor(app, folder) {
  const path = normalizePath(`${folder.path}/${folder.name}.md`);
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

export async function getOrCreateFolderNote(app, folder) {
  const existing = folderNoteFor(app, folder);
  if (existing) return existing;
  const path = normalizePath(`${folder.path}/${folder.name}.md`);
  const lines = [
    "---",
    `titre: ${folder.name}`,
    "synopsis: ",
    "notes: ",
    "---",
    "",
    "",
  ];
  return await app.vault.create(path, lines.join("\n"));
}
