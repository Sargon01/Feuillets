/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : fs/path pour lire un dossier .scriv sur disque, desktop uniquement */
import { Modal, Notice, Platform, normalizePath } from "obsidian";

import { PROJECT_MODES, applyModeDefaults } from "../utils/project-modes.js";
import {
  checkScrivenerFormat,
  parseScrivx,
  countImportPreview,
  rtfToMarkdown,
  rtfPathCandidates,
  findAttachedDataImages,
  mapScrivenerStatus,
  classifyResearchFolder,
  buildSceneFrontmatter,
  buildEntityFrontmatter,
  extractHeadingTitle,
  parseScrivenerComments,
  buildUuidTitleMap,
} from "../services/scrivener-import.js";
import { t } from "../i18n/index.js";

function sanitizeName(title) {
  const cleaned = (title || "").replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || t("modal.scrivenerImport.untitled");
}

function unusedPath(app, basePath) {
  if (!app.vault.getAbstractFileByPath(basePath)) return basePath;
  const dot = basePath.lastIndexOf(".");
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath;
  const ext = dot > 0 ? basePath.slice(dot) : "";
  let i = 2;
  let candidate;
  do {
    candidate = `${stem}-${i}${ext}`;
    i++;
  } while (app.vault.getAbstractFileByPath(candidate));
  return candidate;
}

/** Recherche récursive d'un fichier image ou pièce jointe par son nom dans le dossier .scriv */
function findScrivenerFile(dirPath, targetName, fs, pathMod) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = pathMod.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const found = findScrivenerFile(fullPath, targetName, fs, pathMod);
        if (found) return found;
      } else if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
        return fullPath;
      }
    }
  } catch { /* dossier illisible pendant le parcours disque : traite comme fichier non trouve */ }

  const uuidMatch =
    /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/i.exec(targetName) ||
    /[0-9A-Fa-f]{8}/i.exec(targetName);
  if (uuidMatch) {
    const uuid = uuidMatch[0];
    const dataDir = pathMod.join(dirPath, "Files/Data", uuid);
    try {
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        const imgExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"];
        for (const f of files) {
          if (imgExts.includes(pathMod.extname(f).toLowerCase())) {
            return pathMod.join(dataDir, f);
          }
        }
      }
    } catch { /* idem : pas de visuel trouve dans ce dossier de donnees */ }
  }
  return null;
}

export class ScrivenerImportModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    if (Platform.isMobile) {
      const { contentEl } = this;
      contentEl.createEl("h3", { text: t("modal.scrivenerImport.title") });
      contentEl
        .createEl("p", { cls: "setting-item-description" })
        .setText(
          t("modal.scrivenerImport.desktopOnly")
        );
      return;
    }
    this.showForm();
  }

  onClose() {
    this.contentEl.empty();
  }

  showForm() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.scrivenerImport.title") });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.scrivenerImport.desc")
    );

    contentEl.createEl("label", { text: t("modal.scrivenerImport.scrivFolderLabel") });
    const scrivInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "/Users/toi/Documents/Mon Roman.scriv" },
    });
    scrivInput.addClass("feuillets-input-full");
    scrivInput.addClass("feuillets-field-spacer");

    contentEl.createEl("label", { text: t("modal.newProject.parentFolderLabel") });
    const parentInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.newProject.parentFolderPlaceholder") },
    });
    parentInput.addClass("feuillets-input-full");
    parentInput.addClass("feuillets-field-spacer");

    contentEl.createEl("label", { text: t("modal.newProject.nameLabel") });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Mon Roman" },
    });
    nameInput.addClass("feuillets-input-full");
    nameInput.addClass("feuillets-field-spacer");

    contentEl.createEl("label", { text: t("modal.newProject.typeLabel") });
    const typeSelect = contentEl.createEl("select");
    typeSelect.addClass("feuillets-input-full");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const analyze = async () => {
      const scrivPath = scrivInput.value.trim().replace(/[/\\]+$/, "");
      if (!scrivPath) {
        new Notice(t("modal.scrivenerImport.enterScrivPath"));
        return;
      }
      const name = nameInput.value.trim();
      if (!name) {
        new Notice(t("modal.newProject.giveAName"));
        return;
      }

      let fs, pathMod;
      try {
        fs = require("fs");
        pathMod = require("path");
      } catch {
        new Notice(t("modal.scrivenerImport.importUnavailable"));
        return;
      }

      let entries;
      try {
        entries = fs.readdirSync(scrivPath);
      } catch {
        new Notice(t("modal.scrivenerImport.folderNotFound", { path: scrivPath }));
        return;
      }
      const check = checkScrivenerFormat(entries);
      if (!check.ok) {
        new Notice(check.error);
        return;
      }

      let xmlContent;
      try {
        xmlContent = fs.readFileSync(pathMod.join(scrivPath, check.scrivxName), "utf-8");
      } catch {
        new Notice(t("modal.scrivenerImport.cannotReadScrivx"));
        return;
      }

      const parsed = parseScrivx(xmlContent);
      if (!parsed.draft) {
        new Notice(t("modal.scrivenerImport.noDraftFound"));
        return;
      }

      this.showPreview({
        scrivPath,
        parsed,
        parentPath: parentInput.value.trim().replace(/\/+$/, ""),
        name,
        mode: typeSelect.value,
        fs,
        pathMod,
      });
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.scrivenerImport.analyzeBtn"), cls: "mod-cta" })
      .addEventListener("click", analyze);
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  showPreview(ctx) {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.scrivenerImport.importTitle", { name: ctx.parsed.projectTitle }) });

    const counts = countImportPreview(ctx.parsed);
    const list = contentEl.createEl("ul");
    list.createEl("li", { text: t("modal.scrivenerImport.countFolders", { count: counts.folders }) });
    list.createEl("li", { text: t("modal.scrivenerImport.countScenes", { count: counts.scenes }) });
    list.createEl("li", { text: t("modal.scrivenerImport.countResearch", { count: counts.researchEntries }) });
    if (counts.unclassifiedRoots > 0) {
      list.createEl("li", {
        text: t("modal.scrivenerImport.countUnclassified", { count: counts.unclassifiedRoots }),
      });
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.scrivenerImport.confirmBtn"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.setText(t("modal.scrivenerImport.importing"));
      try {
        await this.runImport(ctx);
        this.close();
      } catch (e) {
        new Notice(t("modal.scrivenerImport.importFailed", { error: e.message || e }));
        confirmBtn.disabled = false;
        confirmBtn.setText(t("modal.scrivenerImport.confirmBtn"));
      }
    });
    btnRow.createEl("button", { text: t("modal.back") }).addEventListener("click", () => this.showForm());
  }

  async runImport({ scrivPath, parsed, parentPath, name, mode, fs, pathMod }) {
    const app = this.app;
    const plugin = this.plugin;
    const S = plugin.settings;
    const isFiction = mode === "fiction";

    const volumePath = normalizePath(parentPath ? `${parentPath}/${name}` : name);
    if (app.vault.getAbstractFileByPath(volumePath)) {
      throw new Error(t("modal.newProject.alreadyExists", { path: volumePath }));
    }

    await plugin.ensureFolder(volumePath);
    const manuscritPath = normalizePath(`${volumePath}/Manuscrit`);
    await plugin.ensureFolder(manuscritPath);

    // Dossier d'images du projet (Resources/Assets)
    const visuelsFolderPath = normalizePath(`${volumePath}/Resources/Assets`);
    await plugin.ensureFolder(visuelsFolderPath);

    if (S.projectFolder && !S.projects.includes(S.projectFolder)) {
      S.projects.push(S.projectFolder);
    }
    S.projectFolder = manuscritPath;
    if (!S.projectMeta[manuscritPath]) S.projectMeta[manuscritPath] = {};
    S.projectMeta[manuscritPath].type = mode;
    applyModeDefaults(S, mode);
    await plugin.saveSettings();

    await plugin.initProjectStructure();

    const binderItemMap = buildUuidTitleMap(parsed);
    let unreadableCount = 0;

    const readRtf = (uuid) => {
      for (const candidate of rtfPathCandidates(uuid)) {
        try {
          return fs.readFileSync(pathMod.join(scrivPath, candidate), "utf-8");
        } catch { /* on essaie plusieurs emplacements de RTF : l'absence est le cas NORMAL, on passe au candidat suivant */ }
      }
      unreadableCount++;
      return "";
    };

    const readComments = (uuid) => {
      try {
        const xml = fs.readFileSync(
          pathMod.join(scrivPath, `Files/Data/${uuid}/content.comments`),
          "utf-8"
        );
        return parseScrivenerComments(xml);
      } catch {
        return {};
      }
    };

    const readNotes = (uuid) => {
      for (const candidate of [
        `Files/Data/${uuid}/notes.rtf`,
        `Files/Docs/${uuid}_notes.rtf`,
      ]) {
        try {
          const rtf = fs.readFileSync(pathMod.join(scrivPath, candidate), "utf-8");
          const { text } = rtfToMarkdown(rtf, {}, binderItemMap);
          if (text) return text.trim();
        } catch { /* idem pour notes.rtf : candidat absent, on tente le suivant */ }
      }
      return "";
    };

    const readSynopsis = (uuid) => {
      for (const candidate of [
        `Files/Data/${uuid}/synopsis.txt`,
        `Files/Docs/${uuid}_synopsis.txt`,
      ]) {
        try {
          const txt = fs.readFileSync(pathMod.join(scrivPath, candidate), "utf-8");
          if (txt) return txt.trim();
        } catch { /* idem pour synopsis.txt */ }
      }
      return "";
    };

    const toArrayBuffer = (buf) => {
      if (!buf) return new ArrayBuffer(0);
      if (buf.buffer instanceof ArrayBuffer) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      return buf;
    };

    // Sauvegarde les images intégrées RTF (\pict) dans Resources/Assets/
    const saveExtractedImages = async (extractedImages) => {
      for (const img of extractedImages) {
        const imgPath = normalizePath(`${visuelsFolderPath}/${img.name}`);
        if (!app.vault.getAbstractFileByPath(imgPath)) {
          try {
            await app.vault.createBinary(imgPath, toArrayBuffer(img.bytes));
          } catch { /* une image integree qui resiste ne doit pas faire echouer l'import de tout le manuscrit */ }
        }
      }
    };

    // Recherche et copie les images Scrivener 3 ($PROJECT://...) trouvées dans le dossier .scriv
    const processImageLinks = async (imageLinks) => {
      if (!imageLinks || imageLinks.length === 0) return;
      for (const link of imageLinks) {
        const targetPath = normalizePath(`${visuelsFolderPath}/${link.fileName}`);
        if (!app.vault.getAbstractFileByPath(targetPath)) {
          const diskPath = findScrivenerFile(scrivPath, link.fileName, fs, pathMod);
          if (diskPath) {
            try {
              const bytes = fs.readFileSync(diskPath);
              await app.vault.createBinary(targetPath, toArrayBuffer(bytes));
            } catch { /* idem : image liee introuvable ou illisible sur disque */ }
          }
        }
      }
    };

    // Inspecte le dossier Files/Data/<UUID>/ pour copier toute image d'arrière-plan/jointe
    const processDataDirImages = async (itemTitle, uuid, currentBody, hasExtractedRtf = false) => {
      const dataImages = findAttachedDataImages(scrivPath, uuid, fs, pathMod);
      let updatedBody = currentBody || "";
      if (!dataImages || dataImages.length === 0) return updatedBody;

      for (const img of dataImages) {
        const ext = pathMod.extname(img.fileName);
        const base = pathMod.basename(img.fileName, ext);
        const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
          ? `${uuid}${ext}`
          : img.fileName;
        const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);

        if (!app.vault.getAbstractFileByPath(targetPath)) {
          try {
            const bytes = fs.readFileSync(img.fullPath);
            await app.vault.createBinary(targetPath, toArrayBuffer(bytes));
          } catch { /* idem */ }
        }

        const hasImageEmbed = /!\[\[[^\]]+\]\]/.test(updatedBody);
        if (
          !hasImageEmbed &&
          !hasExtractedRtf &&
          !updatedBody.includes(uniqueFileName) &&
          !updatedBody.toLowerCase().includes(uniqueFileName.toLowerCase()) &&
          !updatedBody.toLowerCase().includes(uuid.toLowerCase())
        ) {
          updatedBody += `\n\n![[${uniqueFileName}]]\n\n`;
        }
      }
      return updatedBody;
    };

    const encounteredLabels = new Set();

    // ============================== Manuscrit ==============================

    const writeSceneFile = async (item, destFolder, baseName) => {
      const path = unusedPath(app, normalizePath(`${destFolder.path}/${baseName}.md`));
      
      let text = "";
      let footnotes = [];
      let chapterTitle = "";
      let sousTitre = "";
      let hasExtractedRtf = false;

      let rtfRes = null;
      if (item.isImage) {
        const dataImages = findAttachedDataImages(scrivPath, item.uuid, fs, pathMod);
        if (dataImages.length > 0) {
          const img = dataImages[0];
          const ext = pathMod.extname(img.fileName);
          const base = pathMod.basename(img.fileName, ext);
          const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
            ? `${item.uuid}${ext}`
            : img.fileName;
          const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);
          if (!app.vault.getAbstractFileByPath(targetPath)) {
            try {
              const bytes = fs.readFileSync(img.fullPath);
              await app.vault.createBinary(targetPath, toArrayBuffer(bytes));
            } catch { /* idem */ }
          }
          text = `![[${uniqueFileName}]]`;
        }
      } else {
        const rtfContent = readRtf(item.uuid);
        rtfRes = rtfToMarkdown(rtfContent, readComments(item.uuid), binderItemMap, { uuid: item.uuid });
        text = rtfRes.text;
        footnotes = rtfRes.footnotes || [];
        chapterTitle = rtfRes.chapterTitle;
        sousTitre = rtfRes.sousTitre;

        if (rtfRes.extractedImages && rtfRes.extractedImages.length > 0) {
          hasExtractedRtf = true;
          await saveExtractedImages(rtfRes.extractedImages);
        }
        if (rtfRes.imageLinks && rtfRes.imageLinks.length > 0) {
          await processImageLinks(rtfRes.imageLinks);
        }
      }

      text = await processDataDirImages(item.title, item.uuid, text, hasExtractedRtf);

      let body = text;
      if (footnotes.length > 0) {
        body += "\n\n" + footnotes.map((f, idx) => `[^${idx + 1}]: ${f}`).join("\n");
      }
      if (item.labelTitle) encounteredLabels.add(item.labelTitle);

      let docNotes = readNotes(item.uuid);
      if (rtfRes && rtfRes.extractedComments && rtfRes.extractedComments.length > 0) {
        const commentLines = rtfRes.extractedComments.map((c) =>
          c.word ? t("modal.scrivenerImport.commentOn", { word: c.word, text: c.text }) : c.text
        );
        docNotes = docNotes ? `${docNotes.trim()}\n\n${commentLines.join("\n")}` : commentLines.join("\n");
      }
      const docSynopsis = item.synopsis || readSynopsis(item.uuid);

      const actualFileName = path.slice(path.lastIndexOf("/") + 1, -".md".length);
      const fm = buildSceneFrontmatter({
        titre: chapterTitle || extractHeadingTitle(text) || item.title,
        titreCourt: sousTitre || actualFileName,
        sousTitre,
        order: 0,
        isFiction,
        synopsis: docSynopsis,
        statut: mapScrivenerStatus(item.statusTitle),
        label: item.labelTitle,
        tags: item.keywords,
        notes: docNotes,
        includeInCompile: item.includeInCompile,
        wordGoal: item.wordGoal || S.wordGoal,
      });
      return app.vault.create(path, fm + body);
    };

    const writeManuscriptNode = async (item, destFolder) => {
      const safeTitle = sanitizeName(item.title);
      if (item.isFolder) {
        const folder = await plugin.ensureFolder(
          unusedPath(app, normalizePath(`${destFolder.path}/${safeTitle}`))
        );

        const folderRtf = readRtf(item.uuid);
        let docNotes = readNotes(item.uuid);
        const docSynopsis = item.synopsis || readSynopsis(item.uuid);

        const { text, footnotes, extractedImages, imageLinks, extractedComments, chapterTitle, sousTitre } = rtfToMarkdown(
          folderRtf,
          readComments(item.uuid),
          binderItemMap,
          { uuid: item.uuid }
        );

        if (extractedComments && extractedComments.length > 0) {
          const commentLines = extractedComments.map((c) =>
            c.word ? t("modal.scrivenerImport.commentOn", { word: c.word, text: c.text }) : c.text
          );
          docNotes = docNotes ? `${docNotes.trim()}\n\n${commentLines.join("\n")}` : commentLines.join("\n");
        }

        let folderBody = text;
        const hasExtractedRtf = extractedImages && extractedImages.length > 0;
        folderBody = await processDataDirImages(item.title, item.uuid, folderBody, hasExtractedRtf);

        if (folderBody || docSynopsis || item.labelTitle || item.statusTitle || docNotes || (item.keywords && item.keywords.length > 0)) {
          if (extractedImages && extractedImages.length > 0) {
            await saveExtractedImages(extractedImages);
          }
          if (imageLinks && imageLinks.length > 0) {
            await processImageLinks(imageLinks);
          }
          const folderNotePath = normalizePath(`${folder.path}/${folder.name}.md`);
          if (!app.vault.getAbstractFileByPath(folderNotePath)) {
            let body = folderBody;
            if (footnotes.length > 0) {
              body += "\n\n" + footnotes.map((f, idx) => `[^${idx + 1}]: ${f}`).join("\n");
            }
            if (item.labelTitle) encounteredLabels.add(item.labelTitle);
            const fm = buildSceneFrontmatter({
              titre: chapterTitle || item.title,
              titreCourt: folder.name,
              sousTitre,
              order: 0,
              isFiction,
              synopsis: docSynopsis,
              statut: mapScrivenerStatus(item.statusTitle),
              label: item.labelTitle,
              tags: item.keywords,
              notes: docNotes,
              includeInCompile: item.includeInCompile,
              wordGoal: item.wordGoal || S.wordGoal,
            });
            await app.vault.create(folderNotePath, fm + body);
          }
        }

        await writeManuscriptChildren(item.children, folder);
        return folder;
      }

      if (item.children.length > 0) {
        const folder = await plugin.ensureFolder(
          unusedPath(app, normalizePath(`${destFolder.path}/${safeTitle}`))
        );
        await writeSceneFile(item, folder, "00-" + safeTitle);
        await writeManuscriptChildren(item.children, folder);
        return folder;
      }
      return writeSceneFile(item, destFolder, safeTitle);
    };

    const writeManuscriptChildren = async (children, destFolder) => {
      const created = [];
      for (const child of children) {
        const node = await writeManuscriptNode(child, destFolder);
        if (node) created.push(node);
      }
      if (created.length > 0) await plugin.writeOrder(destFolder, created);
    };

    const manuscritFolder = app.vault.getAbstractFileByPath(manuscritPath);
    await writeManuscriptChildren(parsed.draft.children, manuscritFolder);

    // ============================== Recherche ===============================

    const writeResearchNode = async (item, destFolder, structuralTag) => {
      const safeTitle = sanitizeName(item.title);
      if (item.isFolder) {
        const folder = await plugin.ensureFolder(
          unusedPath(app, normalizePath(`${destFolder.path}/${safeTitle}`))
        );
        for (const child of item.children) {
          await writeResearchNode(child, folder, structuralTag);
        }
        return;
      }
      const path = unusedPath(app, normalizePath(`${destFolder.path}/${safeTitle}.md`));
      
      let text = "";
      let hasExtractedRtf = false;
      let rtfRes = null;
      if (item.isImage) {
        const dataImages = findAttachedDataImages(scrivPath, item.uuid, fs, pathMod);
        if (dataImages.length > 0) {
          const img = dataImages[0];
          const ext = pathMod.extname(img.fileName);
          const base = pathMod.basename(img.fileName, ext);
          const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
            ? `${item.uuid}${ext}`
            : img.fileName;
          const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);
          if (!app.vault.getAbstractFileByPath(targetPath)) {
            try {
              const bytes = fs.readFileSync(img.fullPath);
              await app.vault.createBinary(targetPath, toArrayBuffer(bytes));
            } catch { /* idem */ }
          }
          text = `![[${uniqueFileName}]]`;
        }
      } else {
        rtfRes = rtfToMarkdown(readRtf(item.uuid), readComments(item.uuid), binderItemMap, { uuid: item.uuid });
        text = rtfRes.text;
        if (rtfRes.extractedImages && rtfRes.extractedImages.length > 0) {
          hasExtractedRtf = true;
          await saveExtractedImages(rtfRes.extractedImages);
        }
        if (rtfRes.imageLinks && rtfRes.imageLinks.length > 0) {
          await processImageLinks(rtfRes.imageLinks);
        }
      }

      text = await processDataDirImages(item.title, item.uuid, text, hasExtractedRtf);

      let docNotes = readNotes(item.uuid);
      if (rtfRes && rtfRes.extractedComments && rtfRes.extractedComments.length > 0) {
        const commentLines = rtfRes.extractedComments.map((c) =>
          c.word ? t("modal.scrivenerImport.commentOn", { word: c.word, text: c.text }) : c.text
        );
        docNotes = docNotes ? `${docNotes.trim()}\n\n${commentLines.join("\n")}` : commentLines.join("\n");
      }

      const tags = [...item.keywords];
      if (structuralTag) tags.push(structuralTag);
      const fm = buildEntityFrontmatter({
        title: item.title,
        synopsis: item.synopsis || readSynopsis(item.uuid),
        tags,
        notes: docNotes,
      });
      await app.vault.create(path, fm + text);
    };

    if (parsed.research) {
      const researchRoot = app.vault.getAbstractFileByPath(normalizePath(`${volumePath}/Research`));
      if (researchRoot) {
        for (const child of parsed.research.children) {
          const key = child.isFolder ? classifyResearchFolder(child.title) : null;
          const folderDef = key ? PROJECT_MODES[mode].researchFolders[key] : null;
          if (folderDef) {
            const targetFolder = await plugin.ensureFolder(
              normalizePath(`${researchRoot.path}/${folderDef.label}`)
            );
            for (const grandchild of child.children) {
              await writeResearchNode(grandchild, targetFolder, folderDef.tag);
            }
          } else {
            const fallback = await plugin.ensureFolder(
              normalizePath(`${researchRoot.path}/${t("modal.scrivenerImport.unclassifiedFolder")}`)
            );
            await writeResearchNode(child, fallback, null);
          }
        }
      }
    }

    // ============================== Autres éléments racines ==================
    if (parsed.others && parsed.others.length > 0) {
      const researchRoot = app.vault.getAbstractFileByPath(normalizePath(`${volumePath}/Research`));
      if (researchRoot) {
        const fallback = await plugin.ensureFolder(
          normalizePath(`${researchRoot.path}/${t("modal.scrivenerImport.unclassifiedFolder")}`)
        );
        for (const otherItem of parsed.others) {
          await writeResearchNode(otherItem, fallback, null);
        }
      }
    }

    // ============================== Labels ==================================

    if (encounteredLabels.size > 0) {
      if (!S.projectMeta) S.projectMeta = {};
      if (!S.projectMeta[manuscritPath]) S.projectMeta[manuscritPath] = {};
      const currentMeta = S.projectMeta[manuscritPath];
      const palette = ["#e0524f", "#e08f4f", "#d9c04a", "#5aa564", "#5a8fd9", "#9a6dd7"];
      const existing = (currentMeta.labels || S.labels || []).map((l) => (typeof l === "string" ? l : l.name));
      const toAdd = [...encounteredLabels].filter((n) => !existing.includes(n));
      if (toAdd.length > 0) {
        const merged = [...(currentMeta.labels || S.labels || [])];
        toAdd.forEach((n, idx) => merged.push({ name: n, color: palette[(existing.length + idx) % palette.length] }));
        currentMeta.labels = merged;
      }
    }

    await plugin.saveSettings();
    plugin.renderAllViews(true);
    plugin.updateStatusBar();
    const warning = unreadableCount > 0
      ? ` ${t("modal.scrivenerImport.unreadableWarning", { count: unreadableCount })}`
      : "";
    new Notice(t("modal.scrivenerImport.importSuccess", { path: volumePath }) + warning, warning ? 10000 : 4000);
  }
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
