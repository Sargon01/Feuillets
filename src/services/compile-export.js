const { Notice, TFolder, TFile, normalizePath, Platform } = require("obsidian");
import { embedHardBreaks } from "../utils/core.js";
import { footnotePrefixFor, applyCompileTransforms } from "../utils/compile-text.js";
import { fmOf, compiledTitleFor, compiledSubtitleFor } from "./frontmatter.js";
import {
  getProjectFolder,
  getOrderedChildren,
  roleOfFolder,
  roleOfFile,
  flattenFiles,
  isFrontMatter,
  FRONT_PAGE_TYPES,
} from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { preserveBlankLinesForFrontPage } from "./export-render.js";
import { parseTitleRoles, hasTitleRoleLines, TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { exportEpub } from "./export-epub.js";
import { exportDocx } from "./export-docx.js";
import { exportPdf } from "./export-pdf.js";
import { exportOdt } from "./export-odt.js";

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

  const readBody = async (file, frontType = null) => {
    const isFrontPage = !!frontType;
    let content = await app.vault.cachedRead(file);
    content = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    /* Page Front : on ne rogne PAS les lignes vides de tête/queue comme pour
       une scène normale — sur une page de titre en composition libre, ces
       lignes-là sont la mise en page elle-même (voir
       preserveBlankLinesForFrontPage plus bas). Un seul saut de ligne final
       (fin de fichier standard) est retiré, sinon il compterait comme une
       ligne vide supplémentaire non voulue. */
    content = isFrontPage ? content.replace(/\n$/, "") : content.trim();

    /* Transformations communes à tout texte compilé, extraites pour pouvoir
       s'appliquer aussi bloc par bloc sur une page de titre à rôles (voir
       plus bas), pas seulement sur le corps entier d'un coup :
       - renumérotation des notes de bas de page : chaque fichier numérote
         ses notes à partir de 1 sans savoir que la compilation les
         concatène ; sans ce préfixe, deux [^1] pointeraient sur la même note.
       - retrait des wikiliens ([[…]]) : outil d'organisation du coffre, pas
         du texte de roman ; l'alias ou la cible est conservé comme texte, et
         un EMBED ![[image.png]] (?<!!) est laissé intact pour rester une image.
       - typographie française : guillemets/apostrophe/points de suspension/
         espaces insécables garantis même sans la frappe typographique
         (texte collé d'un traitement externe…). Réglable (Réglages → Export). */
    const footnotePrefix = footnotePrefixFor(file.path);
    const applyTextTransforms = (str) =>
      applyCompileTransforms(str, footnotePrefix, settings.exportFrenchTypography);

    /* Page de titre à rôles : chaque ligne `:::rôle: contenu` devient un
       paragraphe-marqueur `FEUILLETS-FPROLE:rôle` suivi de son contenu, que
       chaque export stylera d'après `titlePage.styles.<rôle>` du modèle. Ici
       l'espacement vient des marges du modèle, donc pas de préservation de
       lignes vides : elles sont simplement ignorées (voir parseTitleRoles).
       Repli sur le chemin WYSIWYG plus bas si la page ne contient aucun rôle
       (composition libre). */
    if (frontType === "titre" && hasTitleRoleLines(content)) {
      const md = parseTitleRoles(content)
        .map((b) => {
          /* Dans un bloc de rôle, « / » (entouré ou non d'espaces) est un
             saut de ligne À L'INTÉRIEUR du bloc (interligne simple), pas un
             séparateur de paragraphe : `:::mots: 71 800 mots / 427 000 signes`
             s'affiche sur deux lignes. Converti en saut de ligne simple ici ;
             embedHardBreaks le transforme ensuite en saut forcé (<br>). */
          const c = applyTextTransforms(b.content.split(/\s*\/\s*/).join("\n"));
          return b.role ? `${TITLE_ROLE_MARKER}${b.role}\n\n${c}` : c;
        })
        .join("\n\n");
      return embedHardBreaks(md);
    }

    content = applyTextTransforms(content);

    /* On ne SUPPRIME jamais les lignes vides : en Markdown, la ligne vide
       SÉPARE deux paragraphes. Sur une page Front en composition libre
       (dédicace/épigraphe, ou page de titre sans rôles), chaque ligne vide
       tapée doit rester une ligne blanche réelle à l'export — voir
       preserveBlankLinesForFrontPage. Le corps de roman normal, lui, garde
       ses paragraphes séparés, leur apparence étant décidée par le style
       (interligne, alinéa) et non par des lignes vides. */
    if (isFrontPage) content = preserveBlankLinesForFrontPage(content);
    return embedHardBreaks(content);
  };

  /* En parallèle de `parts` (texte plat, inchangé — utilisé par Pandoc/EPUB
     et par le fichier Manuscrit.md écrit dans le coffre) : `segments` garde
     la même succession de blocs mais avec le chemin du feuillet d'origine
     (null pour un titre de partie/chapitre, sans fiche propre) et son
     éventuel `frontType` (page Front spéciale : "titre"/"dedicace"/
     "epigraphe", voir folder-structure.js). Sert aux exports natifs (voir
     chaque export-*.js) pour poser un signet par feuillet et distinguer les
     pages Front — jamais écrit tel quel dans un fichier, jamais transmis à
     Pandoc : aucun risque de faire fuiter un marqueur dans du texte visible
     (contrairement à l'erreur des commentaires HTML pour les citations,
     plus tôt). */
  const segments = [];
  const push = (text, path, frontType) => {
    parts.push(text);
    segments.push({ path: path || null, text, frontType: frontType || null });
  };

  const pushFile = async (file, role, depth) => {
    const fm = fmOf(app, file);
    if (fm.compile === false) return;

    /* Page Front spéciale (titre/dédicace/épigraphe) : jamais de titre de
       chapitre ni de numérotation — juste le corps, avec sa propre mise en
       forme dédiée appliquée par chaque export-*.js à partir de frontType. */
    const normalizedFrontType = typeof fm.type === "string" ? fm.type.trim().toLowerCase() : "";
    const isFront = isFrontMatter(app, settings, file) && FRONT_PAGE_TYPES.includes(normalizedFrontType);
    const body = await readBody(file, isFront ? normalizedFrontType : null);

    if (isFront) {
      push(body, file.path, normalizedFrontType);
      count++;
      return;
    }

    const wantTitle = role === "scene" ? P.sceneTitles : P.chapterTitles;
    const t = compiledTitleFor(app, file);
    if (wantTitle && t) {
      const level = "#".repeat(Math.min(depth + 1, 6));
      /* titre sur deux lignes (ex. import Scrivener, "Titre chapitre" +
         sous-titre) : la seconde ligne devient un titre un niveau en
         dessous — pas juste un second paragraphe — pour que le modèle
         d'export puisse le styler distinctement (voir "classique" dans
         utils/export-templates.js : même taille que le titre, mais en
         italique et sans saut de page). */
      const subtitle = compiledSubtitleFor(app, file);
      const subtitleLine = subtitle
        ? `\n\n${"#".repeat(Math.min(depth + 2, 6))} ${subtitle}`
        : "";
      push(`${level} ${t}${subtitleLine}\n\n${body}`, file.path);
    } else {
      push(body, file.path);
    }
    count++;
  };

  const walk = async (f, depth) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        /* Le dossier Front lui-même n'est jamais un titre de partie/chapitre
           à afficher — ses pages (titre/dédicace/épigraphe) précèdent le
           roman, elles n'en font pas narrativement partie. */
        const isFrontFolder = isFrontMatter(app, settings, child);
        const role = roleOfFolder(app, settings, child);
        const level = "#".repeat(Math.min(depth + 1, 6));
        if (role === "partie") {
          if (P.folderTitles && !isFrontFolder) push(`${level} ${child.name}`, null);
          await walk(child, depth + 1);
        } else {
          if (P.chapterTitles && !isFrontFolder) push(`${level} ${child.name}`, null);
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
  return { outPath, manuscript, segments };
}

export function projectMetaFor(settings, folder) {
  if (!folder) return {};
  return settings.projectMeta[folder.path] || {};
}

/** Liste, sans lire ni construire de texte, les chemins de tous les
 * feuillets qu'une compilation inclurait (mêmes règles que compile() :
 * même parcours, même exclusion `compiler: false`/`compile: false`) — sert
 * à reconstruire la correspondance signet -> feuillet à la lecture d'un
 * .docx annoté renvoyé par un directeur/éditeur (voir utils/docx-bookmarks.js
 * et services/docx-review-import.js) : le lecteur recalcule l'identifiant de
 * signet pour chaque chemin ACTUEL ici et retrouve ainsi de quel feuillet
 * vient chaque signet rencontré dans le docx, sans avoir à recompiler. */
export function listCompiledFilePaths(app, settings) {
  const folder = getProjectFolder(app, settings);
  if (!folder) return [];
  const paths = [];
  const visit = (f) => {
    for (const child of getOrderedChildren(app, settings, f)) {
      if (child instanceof TFolder) {
        const role = roleOfFolder(app, settings, child);
        if (role === "partie") {
          visit(child);
        } else {
          for (const sc of flattenFiles(app, settings, child)) {
            const fm = fmOf(app, sc);
            if (fm.compile === false) continue;
            paths.push(sc.path);
          }
        }
      } else {
        const fm = fmOf(app, child);
        if (fm.compile === false) continue;
        paths.push(child.path);
      }
    }
  };
  visit(folder);
  return paths;
}

/** Point d'entrée de l'export : route vers le moteur natif (par défaut,
 * zéro dépendance, fonctionne partout dont mobile) ou vers Pandoc (option
 * avancée, réglage `exportEngine`, pour qui l'a déjà configuré). */
export async function exportFile(app, settings, format = "docx") {
  /* Le PDF n'a jamais été un format Pandoc de ce plugin (ça demanderait
     LaTeX, hors périmètre) — il passe toujours par le moteur natif
     (impression), quel que soit exportEngine. */
  if (settings.exportEngine === "pandoc" && format !== "pdf") {
    return exportViaPandoc(app, settings, format);
  }
  return exportViaNative(app, settings, format);
}

/** Compile puis rend via le moteur natif (MarkdownRenderer d'Obsidian +
 * bibliothèques JS pures `docx`/`jszip`) — aucune dépendance externe,
 * fonctionne desktop et mobile (sauf PDF, desktop uniquement — voir
 * export-pdf.js). Réutilise `compile()` tel quel : seule la conversion
 * finale change de moteur. */
async function exportViaNative(app, settings, format) {
  const folder = getProjectFolder(app, settings);
  if (!folder) {
    new Notice("Dossier projet introuvable. Vérifie les réglages.");
    return;
  }
  const result = await compile(app, settings);
  if (!result) return;

  const meta = projectMetaFor(settings, folder);
  let title = settings.manuscriptTitle || folder.name;
  const author = settings.manuscriptAuthor || meta.author || "";
  /* Le titre affiché en en-tête (et dans les métadonnées du fichier) doit
     rester celui réellement composé sur la page de titre — une seule
     source de vérité — plutôt que le nom du dossier projet ou un titre
     réglé séparément dans les paramètres, qu'on oublierait facilement de
     synchroniser. Repli sur le titre des paramètres si la page de titre
     n'a pas encore de champ `titre` renseigné. */
  const titrePageSeg = result.segments.find((s) => s.frontType === "titre" && s.path);
  if (titrePageSeg) {
    const titreFile = app.vault.getAbstractFileByPath(titrePageSeg.path);
    const titreFm = titreFile ? fmOf(app, titreFile) : {};
    if (typeof titreFm.title === "string" && titreFm.title.trim()) {
      title = titreFm.title.trim();
    }
  }
  /* Le fichier compilé réel (result.outPath) plutôt que le dossier projet :
     la résolution des embeds (![[image.png]]) par Obsidian a besoin d'un
     chemin de FICHIER pour son contexte de répertoire — un chemin de
     dossier peut fausser la résolution des liens relatifs. */
  const sourcePath = result.outPath;
  const outputFolder = await getOutputFolder(app, settings);
  const outBase = outputFolder ? outputFolder.path : folder.path;
  const P = activePresetConfig(settings);
  const baseName = (P.fileName || "Manuscrit.md").replace(/\.md$/i, "");
  const ctx = { markdown: result.manuscript, title, author, sourcePath, segments: result.segments };

  try {
    if (format === "epub") {
      const data = await exportEpub(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.epub`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "docx") {
      const data = await exportDocx(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.docx`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "odt") {
      const data = await exportOdt(app, settings, ctx);
      const outPath = normalizePath(`${outBase}/${baseName}.odt`);
      await writeBinaryFile(app, outPath, data);
      new Notice(`Export réussi : ${outPath}`);
    } else if (format === "pdf") {
      await exportPdf(app, settings, ctx);
    } else {
      new Notice(`Format d'export inconnu : ${format}`);
    }
  } catch (e) {
    console.error("Feuillets: export natif", e);
    new Notice(`Échec de l'export ${format} : ${(e.message || String(e)).slice(0, 200)}`);
  }
}

async function writeBinaryFile(app, path, data) {
  let buf = data;
  if (typeof Blob !== "undefined" && buf instanceof Blob) buf = await buf.arrayBuffer();
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
  } else {
    await app.vault.createBinary(path, buf);
  }
}

/** Compile puis convertit via Pandoc vers .docx ou .epub, avec page de
 * titre. Le .docx utilise le document de référence (Times 12, interligne
 * double, marges 2,5 cm, numéros de page, saut de page par chapitre).
 * Pour un PDF : exporter en .docx puis imprimer/exporter depuis Word.
 * Réglage avancé — le moteur natif (exportViaNative) est le chemin par
 * défaut, celui qui ne nécessite rien d'installé. */
async function exportViaPandoc(app, settings, format = "docx") {
  /* Pandoc passe par child_process : indisponible sur mobile. On le dit
     clairement plutôt que d'échouer en silence sur une promesse non tenue. */
  if (Platform.isMobile) {
    new Notice(
      "L'export via Pandoc n'est pas disponible sur mobile — passe au moteur natif dans les réglages (Export)."
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
