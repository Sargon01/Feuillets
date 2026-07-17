const { Notice, TFolder, TFile, normalizePath, Platform } = require("obsidian");
import { embedHardBreaks } from "../utils/core.js";
import { renamespaceFootnotes } from "../utils/footnotes.js";
import { fmOf, compiledTitleFor } from "./frontmatter.js";
import {
  getProjectFolder,
  getOrderedChildren,
  roleOfFolder,
  roleOfFile,
  flattenFiles,
} from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";

export function activePresetConfig(settings) {
  const S = settings;
  const base = {
    name: "Réglages par défaut",
    fileName: S.compileFileName,
    folderTitles: S.insertFolderTitles,
    chapterTitles: S.insertTitles,
    sceneTitles: S.insertSceneTitles,
    separator: S.separator,
  };
  const idx = S.activePreset;
  if (idx >= 0 && S.compilePresets[idx]) {
    return Object.assign({}, base, S.compilePresets[idx]);
  }
  return base;
}

/** Dossier de sortie de la compilation et des exports — à côté du dossier
 * projet (comme _Recherche et _Snapshots), jamais dedans : le manuscrit
 * compilé ne doit jamais apparaître comme un feuillet de plus dans tes
 * propres vues. Créé automatiquement s'il n'existe pas. */
export async function getOutputFolder(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const base = root.parent ? root.parent.path : root.path;
  return await ensureFolder(app, `${base}/Sortie`);
}

export async function compile(app, settings) {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return null;
  }
  const P = activePresetConfig(settings);
  const parts = [];
  let count = 0;

  const readBody = async (file) => {
    let content = await app.vault.cachedRead(file);
    content = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

    /* chaque fichier source numérote ses notes de bas de page à partir de
       1 sans savoir que la compilation les concatène tous ensuite — sans
       ce renommage, deux fichiers utilisant tous les deux [^1] finiraient
       par pointer sur la même note dans le document compilé. */
    const footnotePrefix = file.path
      .replace(/\.md$/i, "")
      .replace(/[^a-zA-Z0-9]+/g, "-");
    content = renamespaceFootnotes(content, footnotePrefix);

    /* Wikiliens retirés : un manuscrit compilé est destiné à être LU
       (ou passé à Pandoc pour un .docx / .epub). Les [[crochets]] sont
       un outil d'organisation interne au coffre, pas du texte de roman —
       Pandoc les reproduirait tels quels dans le Word.
       [[Zemfira]]        -> Zemfira
       [[fiche|Zemfira]]  -> Zemfira   (l'alias est ce qu'on voulait lire)
       [[fiche#section]]  -> fiche     (l'ancre n'est pas du texte) */
    content = content.replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_, target, alias) => (alias !== undefined ? alias : target).trim()
    );

    /* On ne SUPPRIME plus les lignes vides ici. C'était une erreur de ma
       part : en Markdown, la ligne vide est ce qui SÉPARE deux
       paragraphes. La retirer les colle en un seul bloc — et pour éviter
       cette fusion, embedHardBreaks devait alors terminer chaque ligne
       par une barre oblique (le saut de ligne forcé de Pandoc), d'où les
       « \ » en fin de chaque paragraphe.
       Masquer les lignes vides est un réglage d'AFFICHAGE (Live Preview,
       mode lecture) : le fichier compilé, lui, doit rester du Markdown
       valide, sinon Pandoc ne peut plus reconnaître les paragraphes. Le
       .docx produit garde donc bien ses paragraphes séparés — c'est le
       style Word (espacement, alinéa) qui décide de leur apparence, pas
       des lignes vides dans la source. */
    return embedHardBreaks(content);
  };

  const pushFile = async (file, role, depth) => {
    const fm = fmOf(app, file);
    if (fm.compiler === false || fm.compile === false) return;
    const body = await readBody(file);
    const wantTitle = role === "scene" ? P.sceneTitles : P.chapterTitles;
    const t = compiledTitleFor(app, file);
    if (wantTitle && t) {
      const level = "#".repeat(Math.min(depth + 1, 6));
      parts.push(`${level} ${t}\n\n${body}`);
    } else {
      parts.push(body);
    }
    count++;
  };

  const walk = async (f, depth) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        const role = roleOfFolder(app, settings, child);
        const level = "#".repeat(Math.min(depth + 1, 6));
        if (role === "partie") {
          if (P.folderTitles) parts.push(`${level} ${child.name}`);
          await walk(child, depth + 1);
        } else {
          if (P.chapterTitles) parts.push(`${level} ${child.name}`);
          for (const sc of flattenFiles(app, settings, child)) {
            await pushFile(sc, "scene", depth + 1);
          }
        }
      } else {
        await pushFile(child, roleOfFile(app, settings, child), depth);
      }
    }
  };
  await walk(folder, 0);

  if (count === 0) {
    new Notice("Aucun feuillet à compiler.");
    return null;
  }
  const manuscript = parts.join(P.separator || "\n\n");
  const outputFolder = await getOutputFolder(app, settings);
  const outBase = outputFolder ? outputFolder.path : folder.path;
  const outPath = normalizePath(`${outBase}/${P.fileName || "Manuscrit.md"}`);
  const existing = app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, manuscript);
  } else {
    await app.vault.create(outPath, manuscript);
  }
  new Notice(
    `Manuscrit compilé (${P.name}) : ${count} feuillets → ${P.fileName || "Manuscrit.md"}`
  );
  return { outPath, manuscript };
}

export function projectMetaFor(settings, folder) {
  if (!folder) return {};
  return settings.projectMeta[folder.path] || {};
}

/** Compile puis convertit via Pandoc vers .docx ou .epub, avec page de
 * titre. Le .docx utilise le document de référence (Times 12, interligne
 * double, marges 2,5 cm, numéros de page, saut de page par chapitre).
 * Pour un PDF : exporter en .docx puis imprimer/exporter depuis Word. */
export async function exportFile(app, settings, format = "docx") {
  /* Pandoc passe par child_process : indisponible sur mobile. On le dit
     clairement plutôt que d'échouer en silence sur une promesse non tenue. */
  if (Platform.isMobile) {
    new Notice(
      "L'export (Word, EPUB) nécessite Pandoc et n'est pas disponible sur mobile. La compilation en .md fonctionne, elle."
    );
    return;
  }
  const S = settings;
  const folder = getProjectFolder(app, settings);
  const result = await compile(app, settings);
  if (!result) return;

  let execFile, pathMod, fs, basePath;
  try {
    ({ execFile } = require("child_process"));
    pathMod = require("path");
    fs = require("fs");
    basePath = app.vault.adapter.getBasePath
      ? app.vault.adapter.getBasePath()
      : app.vault.adapter.basePath;
  } catch (e) {
    new Notice("Export indisponible sur cette plateforme (mobile ?).");
    return;
  }
  if (!basePath) {
    new Notice("Impossible de localiser le coffre sur le disque.");
    return;
  }

  const meta = projectMetaFor(settings, folder);
  const title = S.manuscriptTitle || (folder ? folder.name : "Manuscrit");
  const author = S.manuscriptAuthor || meta.author || "";
  const pageBreak =
    '```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```';
  const parts = [`::: {custom-style="Title"}\n${title}\n:::`];
  if (author) parts.push(`::: {custom-style="Subtitle"}\n${author}\n:::`);
  if (format === "docx") parts.push(pageBreak);
  parts.push(result.manuscript);
  const exportMd = parts.join("\n\n");

  const outputFolder = await getOutputFolder(app, settings);
  const outBase = outputFolder ? outputFolder.path : folder.path;

  const exportRel = normalizePath(`${outBase}/.feuillets-export.md`);
  await app.vault.adapter.write(exportRel, exportMd);
  const absMd = pathMod.join(basePath, exportRel);

  const P = activePresetConfig(settings);
  const baseOut = pathMod.join(
    basePath,
    normalizePath(`${outBase}/${P.fileName || "Manuscrit.md"}`)
  );
  const absOut = baseOut.replace(/\.md$/i, `.${format}`);

  const args = [absMd, "-o", absOut, "--from", "markdown+raw_attribute+hard_line_breaks"];

  if (format === "docx") {
    args.push("--to", "docx");
    const refRel = S.pandocReference || "reference-feuillets.docx";
    const projBase = folder.parent ? folder.parent.path : folder.path;
    const cand1 = normalizePath(`${projBase}/Ressources/Export/${refRel}`);
    const cand2 = normalizePath(`${projBase}/Ressources/Export/reference-feuillets.docx`);
    const cand3 = normalizePath(refRel);

    let resolvedRel = "";
    if (app.vault.getAbstractFileByPath(cand1)) {
      resolvedRel = cand1;
    } else if (app.vault.getAbstractFileByPath(cand2)) {
      resolvedRel = cand2;
    } else if (app.vault.getAbstractFileByPath(cand3)) {
      resolvedRel = cand3;
    }

    if (resolvedRel) {
      const absRef = pathMod.resolve(pathMod.join(basePath, resolvedRel));
      const absBase = pathMod.resolve(basePath);
      if (!absRef.startsWith(absBase + pathMod.sep) && absRef !== absBase) {
        new Notice(
          `Document de référence refusé : chemin hors du coffre (${resolvedRel}). Export avec le style Pandoc par défaut.`
        );
      } else if (fs.existsSync(absRef)) {
        args.push("--reference-doc", absRef);
      } else {
        new Notice(
          `Document de référence introuvable (${resolvedRel}) : export avec le style Pandoc par défaut.`
        );
      }
    }
  } else if (format === "epub") {
    args.push(
      "--to", "epub",
      "--metadata", `title=${title}`,
      "--metadata", `lang=${S.epubLanguage || "fr"}`
    );
    if (author) args.push("--metadata", `author=${author}`);
  }

  new Notice(`Conversion Pandoc (${format}) en cours…`);
  execFile(S.pandocPath || "pandoc", args, async (err, stdout, stderr) => {
    try {
      await app.vault.adapter.remove(exportRel);
    } catch (e) {}
    if (err) {
      new Notice(
        `Échec Pandoc (${format}) : vérifie l'installation et le chemin dans les réglages. ${
          (err.message || "").slice(0, 200)
        }`
      );
    } else {
      new Notice(`Export réussi : ${absOut}`);
    }
  });
}
