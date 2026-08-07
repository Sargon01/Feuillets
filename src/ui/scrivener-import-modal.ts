import { App, Modal, Notice, Platform, normalizePath, TAbstractFile, TFolder } from "obsidian";
import JSZip from "jszip";

import { PROJECT_MODES, applyModeDefaults } from "../utils/project-modes.js";
import {
  checkScrivenerFormat,
  parseScrivx,
  countImportPreview,
  rtfToMarkdown,
  rtfPathCandidates,
  mapScrivenerStatus,
  classifyResearchFolder,
  buildSceneFrontmatter,
  buildEntityFrontmatter,
  extractHeadingTitle,
  parseScrivenerComments,
  buildScrivenerImportPlan,
  type ScrivenerImportTarget,
} from "../services/scrivener-import.js";
import { getResearchRoot } from "../services/research.js";
import { getFeuilletsFolderNames, resourcesFolderPath, resourcesSubfolderPath } from "../services/folder-structure.js";
import { t } from "../i18n/index.js";

type ScrivxItem = NonNullable<ReturnType<typeof parseScrivx>["draft"]>;

type ScrivenerImportPlugin = {
  settings: FeuilletsSettings;
  ensureFolder(path: string): Promise<TAbstractFile>;
  saveSettings(): Promise<void>;
  initProjectStructure(): Promise<void>;
  writeOrder(parent: TAbstractFile, orderedChildren: TAbstractFile[]): Promise<void>;
  renderAllViews(force?: boolean): void;
  updateStatusBar(): void;
};

export type FileSystemEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type FileSystemFileEntry = FileSystemEntry & {
  isFile: true;
  isDirectory: false;
  file(successCallback: (file: File) => void, errorCallback?: (error: unknown) => void): void;
};

export type FileSystemDirectoryReader = {
  readEntries(
    successCallback: (entries: FileSystemEntry[]) => void,
    errorCallback?: (error: unknown) => void
  ): void;
};

export type FileSystemDirectoryEntry = FileSystemEntry & {
  isFile: false;
  isDirectory: true;
  createReader(): FileSystemDirectoryReader;
};

export async function readAllEntriesFromDirectory(dirEntry: FileSystemDirectoryEntry): Promise<{ relativePath: string; file: File }[]> {
  const results: { relativePath: string; file: File }[] = [];

  async function readDir(directory: FileSystemDirectoryEntry, currentPath: string): Promise<void> {
    const reader = directory.createReader();
    let entriesBatch: FileSystemEntry[] = [];
    do {
      entriesBatch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, (err) => reject(err instanceof Error ? err : new Error(String(err))));
      });
      for (const entry of entriesBatch) {
        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          const file = await new Promise<File>((resolve, reject) => {
            fileEntry.file(resolve, (err) => reject(err instanceof Error ? err : new Error(String(err))));
          });
          results.push({ relativePath: entryPath, file });
        } else if (entry.isDirectory) {
          const subDirEntry = entry as FileSystemDirectoryEntry;
          await readDir(subDirEntry, entryPath);
        }
      }
    } while (entriesBatch.length > 0);
  }

  await readDir(dirEntry, "");
  return results;
}

type FileMapItem = {
  rawPath: string;
} & (
  | { kind: "file"; file: File }
  | { kind: "zip"; zipObject: JSZip.JSZipObject }
);

export class ScrivenerFileMap {
  private map = new Map<string, FileMapItem>();
  private prefix = "";
  topLevelEntries: string[] = [];
  scrivxName: string | null = null;

  static async fromZip(buffer: ArrayBuffer): Promise<ScrivenerFileMap> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new Error("InvalidZip");
    }

    const instance = new ScrivenerFileMap();
    for (const [p, file] of Object.entries(zip.files)) {
      if (!file.dir) {
        const normPath = p.replace(/\\/g, "/").replace(/^\//, "");
        instance.map.set(normPath.toLowerCase(), { rawPath: normPath, kind: "zip", zipObject: file });
      }
    }
    instance.initStructure();
    return instance;
  }

  static fromEntries(entries: { relativePath: string; file: File }[]): ScrivenerFileMap {
    const instance = new ScrivenerFileMap();
    for (const item of entries) {
      const normPath = item.relativePath.replace(/\\/g, "/").replace(/^\//, "");
      instance.map.set(normPath.toLowerCase(), { rawPath: normPath, kind: "file", file: item.file });
    }
    instance.initStructure();
    return instance;
  }

  private initStructure(): void {
    const items = Array.from(this.map.values());
    const scrivxItem = items.find((it) => it.rawPath.toLowerCase().endsWith(".scrivx"));

    if (!scrivxItem) {
      this.topLevelEntries = [];
      return;
    }

    const normScrivx = scrivxItem.rawPath.replace(/\\/g, "/").replace(/^\//, "");
    const parts = normScrivx.split("/");
    if (parts.length > 1) {
      this.prefix = parts.slice(0, parts.length - 1).join("/") + "/";
      this.scrivxName = parts[parts.length - 1];
    } else {
      this.prefix = "";
      this.scrivxName = normScrivx;
    }

    const prefixLower = this.prefix.toLowerCase();
    const topSet = new Set<string>();
    for (const it of items) {
      const norm = it.rawPath.replace(/\\/g, "/").replace(/^\//, "");
      if (prefixLower && !norm.toLowerCase().startsWith(prefixLower)) continue;
      const rel = prefixLower ? norm.slice(prefixLower.length) : norm;
      const relParts = rel.split("/").filter(Boolean);
      if (relParts.length > 0) {
        topSet.add(relParts[0]);
      }
    }
    this.topLevelEntries = Array.from(topSet);
  }

  getItem(relativePath: string): FileMapItem | undefined {
    const norm = relativePath.replace(/\\/g, "/").replace(/^\//, "");
    const targetKey = (this.prefix + norm).toLowerCase();
    return this.map.get(targetKey);
  }

  async readText(relativePath: string): Promise<string | null> {
    const item = this.getItem(relativePath);
    if (!item) return null;
    try {
      if (item.kind === "file") {
        return await item.file.text();
      } else {
        return await item.zipObject.async("string");
      }
    } catch {
      return null;
    }
  }

  async readArrayBuffer(relativePath: string): Promise<ArrayBuffer | null> {
    const item = this.getItem(relativePath);
    if (!item) return null;
    try {
      if (item.kind === "file") {
        return await item.file.arrayBuffer();
      } else {
        return await item.zipObject.async("arraybuffer");
      }
    } catch {
      return null;
    }
  }

  findAttachedDataImages(uuid: string): { fileName: string; readArrayBuffer(): Promise<ArrayBuffer | null> }[] {
    const uuidLower = uuid.toLowerCase();
    const targetPrefix = (this.prefix + `files/data/${uuidLower}/`).toLowerCase();
    const imgExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"];
    const results: { fileName: string; readArrayBuffer(): Promise<ArrayBuffer | null> }[] = [];

    for (const [p, item] of this.map.entries()) {
      if (p.startsWith(targetPrefix)) {
        const extIndex = p.lastIndexOf(".");
        const ext = extIndex >= 0 ? p.slice(extIndex) : "";
        if (imgExts.includes(ext)) {
          const fileName = p.split("/").pop() || "";
          results.push({
            fileName,
            readArrayBuffer: async () => {
              try {
                return item.kind === "file" ? await item.file.arrayBuffer() : await item.zipObject.async("arraybuffer");
              } catch {
                return null;
              }
            },
          });
        }
      }
    }
    return results;
  }

  findScrivenerFile(targetName: string): { fileName: string; readArrayBuffer(): Promise<ArrayBuffer | null> } | null {
    const targetLower = targetName.toLowerCase();
    for (const [p, item] of this.map.entries()) {
      const baseName = p.split("/").pop() || "";
      if (baseName.toLowerCase() === targetLower) {
        return {
          fileName: baseName,
          readArrayBuffer: async () => {
            try {
              return item.kind === "file" ? await item.file.arrayBuffer() : await item.zipObject.async("arraybuffer");
            } catch {
              return null;
            }
          },
        };
      }
    }
    return null;
  }
}

export type ImportContext = {
  fileMap: ScrivenerFileMap;
  parsed: ReturnType<typeof parseScrivx>;
  parentPath: string;
  name: string;
  mode: string;
};

/** Le chemin de chaque fichier/dossier a déjà été résolu une fois pour
 * toutes par buildScrivenerImportPlan (voir services/scrivener-import.ts)
 * — jamais recalculé ni réassigné silencieusement ici. Si le coffre a
 * changé depuis la planification (autre onglet, sync…) et qu'un chemin
 * prévu est désormais occupé, on arrête proprement plutôt que de choisir
 * un autre nom qui rendrait les liens internes déjà résolus faux
 * (voir §7 du chantier S1). */
function requireFreePath(app: App, path: string): void {
  if (app.vault.getAbstractFileByPath(path)) {
    throw new Error(t("modal.scrivenerImport.pathTaken", { path }));
  }
}

/** Consomme le plan dans l'ORDRE EXACT où il a été construit (parcours en
 * profondeur du binder, voir buildScrivenerImportPlan) : l'écriture ne
 * recherche jamais un nœud par titre ni ne recalcule son chemin — un seul
 * moteur pour les deux (§6 du chantier S1). L'assertion sur l'UUID est un
 * garde-fou de développement : elle ne sert pas à retrouver le nœud (la
 * correspondance vient de l'ordre), seulement à détecter immédiatement
 * toute désynchronisation entre le plan et l'écriture. */
class ScrivenerPlanCursor {
  private index = 0;
  constructor(private readonly targets: ScrivenerImportTarget[]) {}

  next(item: { uuid: string; title: string }): ScrivenerImportTarget {
    const target = this.targets[this.index++];
    if (!target || target.uuid !== item.uuid) {
      throw new Error(
        `Plan d'import Scrivener désynchronisé pour « ${item.title} » — import interrompu avant toute écriture incohérente.`
      );
    }
    return target;
  }
}

export class ScrivenerImportModal extends Modal {
  plugin: ScrivenerImportPlugin;

  constructor(app: App, plugin: ScrivenerImportPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    if (Platform.isMobile) {
      const { contentEl } = this;
      contentEl.createEl("h3", { text: t("modal.scrivenerImport.title") });
      contentEl
        .createEl("p", { cls: "setting-item-description" })
        .setText(t("modal.scrivenerImport.desktopOnly"));
      return;
    }
    this.showForm();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  showForm(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.scrivenerImport.title") });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.scrivenerImport.desc")
    );

    let droppedFileMap: ScrivenerFileMap | null = null;

    contentEl.createEl("label", { text: t("modal.scrivenerImport.scrivFolderLabel") });
    const dropArea = contentEl.createDiv({ cls: "feuillets-drop-target feuillets-field-spacer" });
    dropArea.setText("Glissez-déposez votre dossier .scriv ou sélectionnez une archive ZIP ci-dessous.");

    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.addClass("is-active");
    });
    dropArea.addEventListener("dragleave", () => {
      dropArea.removeClass("is-active");
    });
    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.removeClass("is-active");

      void (async () => {
        const items = e.dataTransfer?.items;
        if (items && items.length > 0) {
          const rawItem = items[0] as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null };
          const entry: FileSystemEntry | null = typeof rawItem.webkitGetAsEntry === "function" ? rawItem.webkitGetAsEntry() : null;

          if (entry && entry.isDirectory) {
            try {
              const dirEntry = entry as FileSystemDirectoryEntry;
              const fileEntries = await readAllEntriesFromDirectory(dirEntry);
              const map = ScrivenerFileMap.fromEntries(fileEntries);
              if (!map.scrivxName) {
                new Notice(t("modal.scrivenerImport.noScrivxFound"));
                return;
              }
              droppedFileMap = map;
              const entryName = dirEntry.name;
              const folderName = entryName.replace(/\.scriv$/i, "");
              if (folderName && !nameInput.value) {
                nameInput.value = folderName;
              }
              dropArea.setText(`Projet prêt : ${entryName}`);
              new Notice(`Projet .scriv prêt à l'analyse : ${entryName}`);
              return;
            } catch {
              new Notice(t("modal.scrivenerImport.cannotReadScrivx"));
              return;
            }
          }
        }

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.name.toLowerCase().endsWith(".zip")) {
            try {
              const buf = await file.arrayBuffer();
              droppedFileMap = await ScrivenerFileMap.fromZip(buf);
              const baseName = file.name.replace(/\.scriv\.zip$/i, "").replace(/\.zip$/i, "");
              if (baseName && !nameInput.value) {
                nameInput.value = baseName;
              }
              dropArea.setText(`Archive prête : ${file.name}`);
              new Notice(`Archive ZIP prête à l'analyse : ${file.name}`);
            } catch {
              new Notice(t("modal.scrivenerImport.cannotReadScrivx"));
            }
          } else {
            new Notice("Veuillez glisser-déposer un dossier .scriv ou sélectionner une archive .zip.");
          }
        }
      })();
    });

    const zipInput = contentEl.createEl("input", {
      type: "file",
      attr: { accept: ".zip,.scriv.zip" },
    });
    zipInput.addClass("feuillets-input-full");
    zipInput.addClass("feuillets-field-spacer");

    contentEl.createDiv({ cls: "feuillets-notes-sub feuillets-field-spacer" }).setText(
      "Sur macOS : vous pouvez glisser-déposer directement votre projet .scriv ci-dessus, ou le compresser en .zip pour le sélectionner."
    );

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

    zipInput.addEventListener("change", () => {
      if (zipInput.files && zipInput.files.length > 0) {
        droppedFileMap = null;
        const file = zipInput.files[0];
        const baseName = file.name.replace(/\.scriv\.zip$/i, "").replace(/\.zip$/i, "");
        if (baseName && !nameInput.value) {
          nameInput.value = baseName;
        }
      }
    });

    contentEl.createEl("label", { text: t("modal.newProject.typeLabel") });
    const typeSelect = contentEl.createEl("select");
    typeSelect.addClass("feuillets-input-full");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const analyze = async () => {
      let fileMap: ScrivenerFileMap | null = droppedFileMap;

      if (!fileMap) {
        const files = zipInput.files;
        if (!files || files.length === 0) {
          new Notice(t("modal.scrivenerImport.enterScrivPath"));
          return;
        }
        const file = files[0];
        try {
          const buf = await file.arrayBuffer();
          fileMap = await ScrivenerFileMap.fromZip(buf);
        } catch {
          new Notice(t("modal.scrivenerImport.cannotReadScrivx"));
          return;
        }
      }

      const name = nameInput.value.trim();
      if (!name) {
        new Notice(t("modal.newProject.giveAName"));
        return;
      }

      const check = checkScrivenerFormat(fileMap.topLevelEntries);
      if (!check.ok) {
        new Notice(check.error as string);
        return;
      }

      const scrivxName = check.scrivxName || fileMap.scrivxName;
      if (!scrivxName) {
        new Notice(t("modal.scrivenerImport.noScrivxFound"));
        return;
      }

      const xmlContent = await fileMap.readText(scrivxName);
      if (!xmlContent) {
        new Notice(t("modal.scrivenerImport.cannotReadScrivx"));
        return;
      }

      const parsed = parseScrivx(xmlContent);
      if (!parsed.draft) {
        new Notice(t("modal.scrivenerImport.noDraftFound"));
        return;
      }

      this.showPreview({
        fileMap,
        parsed,
        parentPath: parentInput.value.trim().replace(/\/+$/, ""),
        name,
        mode: typeSelect.value,
      });
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.scrivenerImport.analyzeBtn"), cls: "mod-cta" })
      .addEventListener("click", () => { void analyze(); });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  showPreview(ctx: ImportContext): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.scrivenerImport.importTitle", { name: ctx.parsed.projectTitle }) });

    const counts = countImportPreview(ctx.parsed);
    const list = contentEl.createEl("ul");
    list.createEl("li", { text: t("modal.scrivenerImport.countFolders", { count: String(counts.folders) }) });
    list.createEl("li", { text: t("modal.scrivenerImport.countScenes", { count: String(counts.scenes) }) });
    list.createEl("li", { text: t("modal.scrivenerImport.countResearch", { count: String(counts.researchEntries) }) });
    if (counts.unclassifiedRoots > 0) {
      list.createEl("li", {
        text: t("modal.scrivenerImport.countUnclassified", { count: String(counts.unclassifiedRoots) }),
      });
    }

    /* §17 du chantier S2 : la Corbeille n'est jamais importée, mais elle
       n'est plus ignorée en silence — annoncée avant le bouton de
       confirmation, seulement si elle n'est pas vide. */
    if (counts.trashEntries > 0) {
      contentEl.createDiv({ cls: "feuillets-notes-sub feuillets-field-spacer" }).setText(
        t("modal.scrivenerImport.trashNotImported", { count: String(counts.trashEntries) })
      );
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.scrivenerImport.confirmBtn"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      void (async () => {
        confirmBtn.disabled = true;
        confirmBtn.setText(t("modal.scrivenerImport.importing"));
        try {
          await this.runImport(ctx);
          this.close();
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          new Notice(t("modal.scrivenerImport.importFailed", { error: errMsg }));
          confirmBtn.disabled = false;
          confirmBtn.setText(t("modal.scrivenerImport.confirmBtn"));
        }
      })();
    });
    btnRow.createEl("button", { text: t("modal.back") }).addEventListener("click", () => this.showForm());
  }

  async runImport({ fileMap, parsed, parentPath, name, mode }: ImportContext): Promise<void> {
    const app = this.app;
    const plugin = this.plugin;
    const S = plugin.settings;
    const isFiction = mode === "fiction";
    const modeKey = mode as keyof typeof PROJECT_MODES;

    const volumePath = normalizePath(parentPath ? `${parentPath}/${name}` : name);
    if (app.vault.getAbstractFileByPath(volumePath)) {
      throw new Error(t("modal.newProject.alreadyExists", { path: volumePath }));
    }

    await plugin.ensureFolder(volumePath);
    const manuscritPath = normalizePath(`${volumePath}/Manuscrit`);
    await plugin.ensureFolder(manuscritPath);

    if (S.projectFolder && !S.projects.includes(S.projectFolder)) {
      S.projects.push(S.projectFolder);
    }
    S.projectFolder = manuscritPath;
    if (!S.projectMeta[manuscritPath]) S.projectMeta[manuscritPath] = {};
    S.projectMeta[manuscritPath].type = mode;
    applyModeDefaults(S, mode);
    await plugin.saveSettings();

    /* Structure conventionnelle Feuillets — jamais de chemin "Research"/
       "Resources" recalculé ici (voir §2.A du chantier S1) : les vrais
       dossiers Recherche/Ressources sont ceux retrouvés (ou créés) par
       initProjectStructure, via les mêmes helpers centraux que le reste de
       Feuillets (services/research.ts, services/folder-structure.ts) —
       fonctionne en FR, en EN, et avec les variantes historiques déjà
       reconnues (_Recherche, Research, _Resources, Ressources…). */
    await plugin.initProjectStructure();

    const manuscritFolder = app.vault.getAbstractFileByPath(manuscritPath);
    if (!(manuscritFolder instanceof TFolder)) {
      throw new Error(t("modal.newProject.alreadyExists", { path: manuscritPath }));
    }

    const researchRoot = getResearchRoot(app, S);
    const resourcesPath = resourcesFolderPath(app, manuscritFolder);
    const folderNames = getFeuilletsFolderNames();
    // Index 4 = sous-dossier "Ressources internes"/"Assets" (voir
    // getFeuilletsFolderNames, services/folder-structure.ts) — même
    // convention d'accès positionnel que templateFolderPath/layoutsPath
    // dans initProjectStructure (project-files.ts).
    const assetsSub = folderNames.resourcesSubs[4];
    const visuelsFolderPath = resourcesSubfolderPath(app, resourcesPath, assetsSub.name, ...assetsSub.variants);
    await plugin.ensureFolder(visuelsFolderPath);

    let unreadableCount = 0;

    const readRtf = async (uuid: string): Promise<string> => {
      for (const candidate of rtfPathCandidates(uuid)) {
        const content = await fileMap.readText(candidate);
        if (content !== null) return content;
      }
      unreadableCount++;
      return "";
    };

    const readComments = async (uuid: string) => {
      const xml = await fileMap.readText(`Files/Data/${uuid}/content.comments`);
      return xml ? parseScrivenerComments(xml) : {};
    };

    /* Choisit le RTF de notes gagnant (Files/Data/<uuid>/notes.rtf, sinon
       Files/Docs/<uuid>_notes.rtf) SANS convertir pour l'usage final — le
       texte brut est mis en cache (voir folderMaterials plus bas) pour être
       reconverti une seule fois, avec la carte de liens définitive, au
       moment de l'écriture. La conversion ici (carte null) ne sert qu'à
       décider quel candidat "gagne" (même règle que l'ancien readNotes :
       un candidat dont le texte converti est vide cède la place au
       suivant) — ce choix ne dépend jamais de la carte de liens (un lien
       résolu ou non produit toujours du texte non vide). */
    const pickNotesRaw = async (uuid: string): Promise<string | null> => {
      for (const candidate of [
        `Files/Data/${uuid}/notes.rtf`,
        `Files/Docs/${uuid}_notes.rtf`,
      ]) {
        const rtf = await fileMap.readText(candidate);
        if (rtf !== null) {
          const { text } = rtfToMarkdown(rtf, {}, null);
          if (text) return rtf;
        }
      }
      return null;
    };

    const readSynopsis = async (uuid: string): Promise<string> => {
      for (const candidate of [
        `Files/Data/${uuid}/synopsis.txt`,
        `Files/Docs/${uuid}_synopsis.txt`,
      ]) {
        const txt = await fileMap.readText(candidate);
        if (txt !== null) return txt.trim();
      }
      return "";
    };

    /* --- Pré-analyse en LECTURE SEULE des dossiers du manuscrit ---------
       Corrige le bug confirmé : buildScrivenerImportPlan planifiait un
       markdownPath pour TOUT Folder du manuscrit, alors que l'écriture ne
       crée réellement la note que si le dossier a du contenu. On détermine
       donc ICI, une fois, quels UUID auront réellement une note — avant
       toute écriture — et on transmet cet ensemble au plan (qui reste pur :
       il ne lit toujours aucun fichier lui-même).

       Le contenu lu (RTF, commentaires, notes, synopsis) est mis en cache
       par UUID pour que l'écriture ne relise jamais les mêmes fichiers ni
       ne recompte les RTF illisibles deux fois — seule la conversion finale
       (avec la vraie carte de liens scrivlink://UUID, connue seulement une
       fois le plan construit) est refaite à l'écriture, via la même
       fonction deriveFolderNoteContent. */
    /* Généralisation S2 (§8 du chantier) de la notion FolderMaterials S1 :
       même forme, mais désormais utilisée pour TOUT nœud Folder de l'arbre
       (dossiers Manuscrit, racine Draft, racine Research, dossiers Research
       classifiés/imbriqués, racines "other") — plus seulement les dossiers
       du manuscrit. Une seule fonction de décision, un seul Set de UUID,
       partagés par le plan et par l'écriture (voir plus bas). */
    type NodeMaterials = {
      rtfContent: string;
      comments: Awaited<ReturnType<typeof readComments>>;
      notesRtfRaw: string | null;
      synopsisText: string;
      hasAttachedImages: boolean;
    };
    const nodeMaterialsMap = new Map<string, NodeMaterials>();

    const readNodeMaterials = async (item: ScrivxItem): Promise<NodeMaterials> => {
      const rtfContent = await readRtf(item.uuid);
      const comments = await readComments(item.uuid);
      const notesRtfRaw = await pickNotesRaw(item.uuid);
      const synopsisText = item.synopsis || (await readSynopsis(item.uuid));
      const hasAttachedImages = fileMap.findAttachedDataImages(item.uuid).length > 0;
      return { rtfContent, comments, notesRtfRaw, synopsisText, hasAttachedImages };
    };

    const deriveNodeNoteContent = (materials: NodeMaterials, uuid: string, linkMap: Map<string, string> | null) => {
      const { text, footnotes, extractedImages, imageLinks, extractedComments, chapterTitle, sousTitre } = rtfToMarkdown(
        materials.rtfContent,
        materials.comments,
        linkMap,
        { uuid }
      );
      let docNotes = "";
      if (materials.notesRtfRaw) {
        const notesConverted = rtfToMarkdown(materials.notesRtfRaw, {}, linkMap).text;
        if (notesConverted) docNotes = notesConverted.trim();
      }
      if (extractedComments && extractedComments.length > 0) {
        const commentLines = extractedComments.map((c) =>
          c.word ? t("modal.scrivenerImport.commentOn", { word: c.word, text: c.text }) : c.text
        );
        docNotes = docNotes ? `${docNotes.trim()}\n\n${commentLines.join("\n")}` : commentLines.join("\n");
      }
      return { text, footnotes, extractedImages, imageLinks, chapterTitle, sousTitre, docNotes, docSynopsis: materials.synopsisText };
    };

    /* Même condition, au mot près, que l'ancien folderHasContent S1 — avec
       une addition S2 (§8) : une customMetadata non vide suffit à elle
       seule à justifier une note ("Folder sans texte, customMetadata =
       POV: Alice -> une note DOIT être créée"). */
    const nodeHasContent = (
      item: ScrivxItem,
      materials: NodeMaterials,
      derived: ReturnType<typeof deriveNodeNoteContent>
    ): boolean => {
      const bodyNonEmpty = !!derived.text || materials.hasAttachedImages;
      return !!(
        bodyNonEmpty ||
        derived.docSynopsis ||
        item.labelTitle ||
        item.statusTitle ||
        derived.docNotes ||
        (item.keywords && item.keywords.length > 0) ||
        (item.customMetadata && item.customMetadata.length > 0)
      );
    };

    /* Pré-analyse en LECTURE SEULE, généralisée à toute la hiérarchie
       (§8/§9/§11/§12/§13/§14 du chantier S2) : un seul parcours récursif,
       une seule décision par nœud Folder — racine Draft et racine Research
       comprises (toutes deux `isFolder: true`, voir parseScrivx), qu'on
       visite ici en plus de leurs enfants directs. La Corbeille n'est
       jamais visitée (§18 : "la Corbeille n'est pas importée"). */
    const folderNoteUuids = new Set<string>();
    const analyzeNode = async (item: ScrivxItem): Promise<void> => {
      if (item.isFolder) {
        const materials = await readNodeMaterials(item);
        nodeMaterialsMap.set(item.uuid, materials);
        const derived = deriveNodeNoteContent(materials, item.uuid, null);
        if (nodeHasContent(item, materials, derived)) {
          folderNoteUuids.add(item.uuid);
        }
      }
      for (const child of item.children) {
        await analyzeNode(child);
      }
    };
    if (parsed.draft) await analyzeNode(parsed.draft);
    if (parsed.research) await analyzeNode(parsed.research);
    for (const other of parsed.others) await analyzeNode(other);

    /* Plan de destination COMPLET, calculé AVANT la moindre écriture —
       une seule source de vérité pour les chemins finaux, réutilisée à la
       fois pour l'écriture des fichiers et pour la résolution des liens
       scrivlink://UUID (voir §3 à §6 du chantier S1, généralisé en §15 du
       chantier S2). `folderNoteUuids` est le MÊME ensemble que celui
       utilisé plus bas par l'écriture pour décider d'écrire ou non la note
       d'un nœud : aucune divergence possible entre le plan et l'écriture
       (voir le correctif S1 « plan et note de dossier manuscrit », désormais
       valable pour toute la hiérarchie). Le champ d'options s'appelle
       toujours `manuscriptFolderNoteUuids` côté buildScrivenerImportPlan
       (voir son commentaire) pour ne pas casser les tests S1 existants. */
    const unclassifiedFolderLabel = t("modal.scrivenerImport.unclassifiedFolder");
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath,
      researchRootPath: researchRoot ? researchRoot.path : null,
      mode: modeKey,
      unclassifiedFolderLabel,
      manuscriptFolderNoteUuids: folderNoteUuids,
    });
    const cursor = new ScrivenerPlanCursor(plan.targets);
    const binderItemMap = plan.uuidToPath;

    // Notes des scènes/fiches ordinaires (pas les dossiers, déjà couverts
    // par folderMaterials/deriveFolderNoteContent ci-dessus) : reconverties
    // avec la carte de liens définitive, à partir du même sélecteur de
    // candidat que la pré-analyse (pickNotesRaw), sans jamais relire deux
    // fois le même fichier gagnant... sauf ici, où il s'agit d'un nœud qui
    // n'est PAS un dossier et n'a donc pas été mis en cache par la
    // pré-analyse (celle-ci ne visite que les Folder du manuscrit).
    const readNotes = async (uuid: string): Promise<string> => {
      const raw = await pickNotesRaw(uuid);
      if (!raw) return "";
      const converted = rtfToMarkdown(raw, {}, binderItemMap).text;
      return converted ? converted.trim() : "";
    };

    const saveExtractedImages = async (extractedImages: { name: string; bytes: Uint8Array }[]) => {
      for (const img of extractedImages) {
        const imgPath = normalizePath(`${visuelsFolderPath}/${img.name}`);
        if (!app.vault.getAbstractFileByPath(imgPath)) {
          try {
            const buf = img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.byteLength) as ArrayBuffer;
            await app.vault.createBinary(imgPath, buf);
          } catch { /* ignore */ }
        }
      }
    };

    const processImageLinks = async (imageLinks: { fileName: string }[] | undefined) => {
      if (!imageLinks || imageLinks.length === 0) return;
      for (const link of imageLinks) {
        const targetPath = normalizePath(`${visuelsFolderPath}/${link.fileName}`);
        if (!app.vault.getAbstractFileByPath(targetPath)) {
          const found = fileMap.findScrivenerFile(link.fileName);
          if (found) {
            try {
              const bytes = await found.readArrayBuffer();
              if (bytes) await app.vault.createBinary(targetPath, bytes);
            } catch { /* ignore */ }
          }
        }
      }
    };

    const processDataDirImages = async (itemTitle: string, uuid: string, currentBody: string, hasExtractedRtf = false): Promise<string> => {
      const dataImages = fileMap.findAttachedDataImages(uuid);
      let updatedBody = currentBody || "";
      if (!dataImages || dataImages.length === 0) return updatedBody;

      for (const img of dataImages) {
        const extIndex = img.fileName.lastIndexOf(".");
        const ext = extIndex >= 0 ? img.fileName.slice(extIndex) : "";
        const base = extIndex >= 0 ? img.fileName.slice(0, extIndex) : img.fileName;
        const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
          ? `${uuid}${ext}`
          : img.fileName;
        const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);

        if (!app.vault.getAbstractFileByPath(targetPath)) {
          try {
            const bytes = await img.readArrayBuffer();
            if (bytes) await app.vault.createBinary(targetPath, bytes);
          } catch { /* ignore */ }
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

    const encounteredLabels = new Set<string>();

    const writeSceneFile = async (item: ScrivxItem, target: ScrivenerImportTarget) => {
      const path = target.markdownPath;
      if (!path) {
        throw new Error(`Plan d'import Scrivener incomplet pour « ${item.title} » (aucun fichier prévu).`);
      }

      let text = "";
      let footnotes: string[] = [];
      let chapterTitle = "";
      let sousTitre = "";
      let hasExtractedRtf = false;

      let rtfRes: ReturnType<typeof rtfToMarkdown> | null = null;
      if (item.isImage) {
        const dataImages = fileMap.findAttachedDataImages(item.uuid);
        if (dataImages.length > 0) {
          const img = dataImages[0];
          const extIndex = img.fileName.lastIndexOf(".");
          const ext = extIndex >= 0 ? img.fileName.slice(extIndex) : "";
          const base = extIndex >= 0 ? img.fileName.slice(0, extIndex) : img.fileName;
          const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
            ? `${item.uuid}${ext}`
            : img.fileName;
          const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);
          if (!app.vault.getAbstractFileByPath(targetPath)) {
            try {
              const bytes = await img.readArrayBuffer();
              if (bytes) await app.vault.createBinary(targetPath, bytes);
            } catch { /* ignore */ }
          }
          text = `![[${uniqueFileName}]]`;
        }
      } else {
        const rtfContent = await readRtf(item.uuid);
        const comments = await readComments(item.uuid);
        rtfRes = rtfToMarkdown(rtfContent, comments, binderItemMap, { uuid: item.uuid });
        text = rtfRes.text;
        footnotes = rtfRes.footnotes || [];
        chapterTitle = rtfRes.chapterTitle || "";
        sousTitre = rtfRes.sousTitre || "";

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

      let docNotes = await readNotes(item.uuid);
      if (rtfRes && rtfRes.extractedComments && rtfRes.extractedComments.length > 0) {
        const commentLines = rtfRes.extractedComments.map((c) =>
          c.word ? t("modal.scrivenerImport.commentOn", { word: c.word, text: c.text }) : c.text
        );
        docNotes = docNotes ? `${docNotes.trim()}\n\n${commentLines.join("\n")}` : commentLines.join("\n");
      }
      const docSynopsis = item.synopsis || (await readSynopsis(item.uuid));

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
        customMetadata: item.customMetadata,
      });
      requireFreePath(app, path);
      return app.vault.create(path, fm + body);
    };

    /* Écrit la note "scène" d'un nœud Folder-like (dossier du manuscrit ou
       racine Draft elle-même, §9 du chantier S2) à partir de son
       NodeMaterials déjà mis en cache par la pré-analyse — jamais de
       relecture des mêmes fichiers, jamais de recalcul de la décision
       « a-t-il une note ? » (voir folderNoteUuids, seule source de vérité,
       partagée avec le plan). */
    const writeManuscriptFolderStyleNote = async (
      item: ScrivxItem,
      target: ScrivenerImportTarget,
      materials: NodeMaterials,
      titreCourtFallback: string
    ): Promise<void> => {
      if (!target.markdownPath) {
        throw new Error(`Plan d'import Scrivener désynchronisé pour « ${item.title} » (note prévue par la pré-analyse mais absente du plan).`);
      }
      const { text, footnotes, extractedImages, imageLinks, chapterTitle, sousTitre, docNotes, docSynopsis } =
        deriveNodeNoteContent(materials, item.uuid, binderItemMap);

      let body = text;
      const hasExtractedRtf = !!(extractedImages && extractedImages.length > 0);
      body = await processDataDirImages(item.title, item.uuid, body, hasExtractedRtf);
      if (extractedImages && extractedImages.length > 0) {
        await saveExtractedImages(extractedImages);
      }
      if (imageLinks && imageLinks.length > 0) {
        await processImageLinks(imageLinks);
      }
      if (footnotes.length > 0) {
        body += "\n\n" + footnotes.map((f, idx) => `[^${idx + 1}]: ${f}`).join("\n");
      }
      if (item.labelTitle) encounteredLabels.add(item.labelTitle);
      const fm = buildSceneFrontmatter({
        titre: chapterTitle || item.title,
        titreCourt: titreCourtFallback,
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
        customMetadata: item.customMetadata,
      });
      requireFreePath(app, target.markdownPath);
      await app.vault.create(target.markdownPath, fm + body);
    };

    const writeManuscriptNode = async (item: ScrivxItem, destFolder: TAbstractFile): Promise<TAbstractFile | undefined> => {
      const target = cursor.next(item);
      if (item.isFolder) {
        if (!target.folderPath) {
          throw new Error(`Plan d'import Scrivener incomplet pour le dossier « ${item.title} ».`);
        }
        const folder = await plugin.ensureFolder(target.folderPath);

        /* La pré-analyse (analyzeNode, avant la construction du plan) a
           déjà lu ce dossier une fois — on réutilise ce contenu en cache
           plutôt que de relire les mêmes fichiers, et on ne recalcule PAS
           la décision « ce dossier a-t-il une note ? » : elle utilise le
           MÊME ensemble `folderNoteUuids` que celui déjà transmis au plan,
           donc jamais de divergence entre chemin planifié et fichier
           réellement écrit. */
        const materials = nodeMaterialsMap.get(item.uuid);
        if (!materials) {
          throw new Error(`Pré-analyse Scrivener incomplète pour le dossier « ${item.title} ».`);
        }
        const willHaveNote = folderNoteUuids.has(item.uuid);

        // Copie des images jointes : toujours effectuée, que la note soit
        // écrite ou non — comportement historique inchangé (voir
        // nodeHasContent : si des images sont jointes, le dossier a
        // forcément du contenu et willHaveNote est déjà vrai).
        if (!willHaveNote) {
          const { text, extractedImages } = deriveNodeNoteContent(materials, item.uuid, binderItemMap);
          const hasExtractedRtf = !!(extractedImages && extractedImages.length > 0);
          await processDataDirImages(item.title, item.uuid, text, hasExtractedRtf);
        } else {
          await writeManuscriptFolderStyleNote(item, target, materials, folder.name);
        }

        await writeManuscriptChildren(item.children, folder);
        return folder;
      }

      if (item.children.length > 0) {
        if (!target.folderPath) {
          throw new Error(`Plan d'import Scrivener incomplet pour « ${item.title} » (aucun dossier prévu).`);
        }
        const folder = await plugin.ensureFolder(target.folderPath);
        await writeSceneFile(item, target);
        await writeManuscriptChildren(item.children, folder);
        return folder;
      }
      return writeSceneFile(item, target);
    };

    const writeManuscriptChildren = async (children: ScrivxItem[], destFolder: TAbstractFile) => {
      const created: TAbstractFile[] = [];
      for (const child of children) {
        const node = await writeManuscriptNode(child, destFolder);
        if (node) created.push(node);
      }
      if (created.length > 0) await plugin.writeOrder(destFolder, created);
    };

    /* §9 du chantier S2 : note de la racine Draft elle-même, écrite AVANT
       ses enfants (même ordre que le plan — voir buildScrivenerImportPlan)
       et directement dans Manuscrit/, jamais dans un sous-dossier. */
    if (parsed.draft && folderNoteUuids.has(parsed.draft.uuid)) {
      const target = cursor.next({ uuid: parsed.draft.uuid, title: parsed.draft.title });
      const materials = nodeMaterialsMap.get(parsed.draft.uuid);
      if (!materials) {
        throw new Error("Pré-analyse Scrivener incomplète pour la racine du Manuscrit.");
      }
      const actualFileName = (target.markdownPath || "").slice(
        (target.markdownPath || "").lastIndexOf("/") + 1,
        -".md".length
      );
      await writeManuscriptFolderStyleNote(parsed.draft, target, materials, actualFileName);
    }

    await writeManuscriptChildren(parsed.draft!.children, manuscritFolder);

    /* Écrit la note "entité" (buildEntityFrontmatter) d'un nœud Folder-like
       Research — racine Research elle-même (§11), dossier classifié
       Characters/Places (§12), dossier imbriqué/non classifié (§13), ou
       racine "other" (§14). JAMAIS de tag structurel personnage/lieu sur la
       note d'un dossier — seuls ses enfants directs en reçoivent un (voir
       writeResearchNode ci-dessous). */
    const writeResearchFolderSelfNote = async (
      item: ScrivxItem,
      target: ScrivenerImportTarget,
      materials: NodeMaterials
    ): Promise<void> => {
      if (!target.markdownPath) {
        throw new Error(`Plan d'import Scrivener désynchronisé pour le dossier de recherche « ${item.title} » (note prévue par la pré-analyse mais absente du plan).`);
      }
      const { text, footnotes, extractedImages, imageLinks, docNotes, docSynopsis } =
        deriveNodeNoteContent(materials, item.uuid, binderItemMap);
      let body = text;
      const hasExtractedRtf = !!(extractedImages && extractedImages.length > 0);
      body = await processDataDirImages(item.title, item.uuid, body, hasExtractedRtf);
      if (extractedImages && extractedImages.length > 0) {
        await saveExtractedImages(extractedImages);
      }
      if (imageLinks && imageLinks.length > 0) {
        await processImageLinks(imageLinks);
      }
      if (footnotes.length > 0) {
        body += "\n\n" + footnotes.map((f, idx) => `[^${idx + 1}]: ${f}`).join("\n");
      }
      const fm = buildEntityFrontmatter({
        title: item.title,
        synopsis: docSynopsis,
        tags: item.keywords,
        notes: docNotes,
        customMetadata: item.customMetadata,
      });
      requireFreePath(app, target.markdownPath);
      await app.vault.create(target.markdownPath, fm + body);
    };

    const writeResearchNode = async (item: ScrivxItem, destFolder: TAbstractFile, structuralTag: string | null): Promise<void> => {
      const target = cursor.next(item);
      if (item.isFolder) {
        if (!target.folderPath) {
          throw new Error(`Plan d'import Scrivener incomplet pour le dossier de recherche « ${item.title} ».`);
        }
        const folder = await plugin.ensureFolder(target.folderPath);
        if (folderNoteUuids.has(item.uuid)) {
          const materials = nodeMaterialsMap.get(item.uuid);
          if (!materials) {
            throw new Error(`Pré-analyse Scrivener incomplète pour le dossier de recherche « ${item.title} ».`);
          }
          await writeResearchFolderSelfNote(item, target, materials);
        }
        for (const child of item.children) {
          await writeResearchNode(child, folder, structuralTag);
        }
        return;
      }
      const path = target.markdownPath;
      if (!path) {
        throw new Error(`Plan d'import Scrivener incomplet pour « ${item.title} » (aucun fichier prévu).`);
      }

      let text = "";
      let hasExtractedRtf = false;
      let rtfRes: ReturnType<typeof rtfToMarkdown> | null = null;
      if (item.isImage) {
        const dataImages = fileMap.findAttachedDataImages(item.uuid);
        if (dataImages.length > 0) {
          const img = dataImages[0];
          const extIndex = img.fileName.lastIndexOf(".");
          const ext = extIndex >= 0 ? img.fileName.slice(extIndex) : "";
          const base = extIndex >= 0 ? img.fileName.slice(0, extIndex) : img.fileName;
          const uniqueFileName = (base.toLowerCase() === "content" || base.toLowerCase() === "notes")
            ? `${item.uuid}${ext}`
            : img.fileName;
          const targetPath = normalizePath(`${visuelsFolderPath}/${uniqueFileName}`);
          if (!app.vault.getAbstractFileByPath(targetPath)) {
            try {
              const bytes = await img.readArrayBuffer();
              if (bytes) await app.vault.createBinary(targetPath, bytes);
            } catch { /* ignore */ }
          }
          text = `![[${uniqueFileName}]]`;
        }
      } else {
        const rtfContent = await readRtf(item.uuid);
        const comments = await readComments(item.uuid);
        rtfRes = rtfToMarkdown(rtfContent, comments, binderItemMap, { uuid: item.uuid });
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

      let docNotes = await readNotes(item.uuid);
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
        synopsis: item.synopsis || (await readSynopsis(item.uuid)),
        tags,
        notes: docNotes,
        customMetadata: item.customMetadata,
      });
      requireFreePath(app, path);
      await app.vault.create(path, fm + text);
    };

    /* Même découpage que buildScrivenerImportPlan (classification des
       dossiers Characters/Places, panier "non classé") : la SEULE logique
       de calcul de chemin qui reste dupliquée entre plan et écriture, par
       nécessité (le plan est pur et ne peut pas retourner de TFolder réel
       pour plugin.ensureFolder) — classifyResearchFolder/researchFolders
       restent l'unique source de vérité pour la classification elle-même,
       jamais recalculée différemment ici (voir §6 du chantier S1). */
    if (parsed.research && researchRoot) {
      /* §11 du chantier S2 : note de la racine Research elle-même, écrite
         AVANT ses enfants (même ordre que le plan) — directement dans la
         racine Recherche, jamais dans un sous-dossier Research/Research/…
         Aucun tag structurel personnage/lieu ne lui est jamais associé. */
      if (folderNoteUuids.has(parsed.research.uuid)) {
        const target = cursor.next({ uuid: parsed.research.uuid, title: parsed.research.title });
        const materials = nodeMaterialsMap.get(parsed.research.uuid);
        if (!materials) {
          throw new Error("Pré-analyse Scrivener incomplète pour la racine Recherche.");
        }
        await writeResearchFolderSelfNote(parsed.research, target, materials);
      }

      const researchFolders = PROJECT_MODES[modeKey].researchFolders as Record<string, { label: string; tag: string }>;
      for (const child of parsed.research.children) {
        const key = child.isFolder ? classifyResearchFolder(child.title) : null;
        const folderDef = key ? researchFolders[key] : null;
        if (folderDef) {
          const targetFolder = await plugin.ensureFolder(
            normalizePath(`${researchRoot.path}/${folderDef.label}`)
          );
          /* §12 : le dossier classifié lui-même (Characters, Places…) a
             une entrée dans le plan UNIQUEMENT s'il a du contenu propre —
             on ne consomme le curseur pour lui QUE dans ce cas, exactement
             comme buildScrivenerImportPlan ne l'a poussé que dans ce cas
             (sinon désynchronisation détectée par ScrivenerPlanCursor). */
          if (folderNoteUuids.has(child.uuid)) {
            const target = cursor.next(child);
            const materials = nodeMaterialsMap.get(child.uuid);
            if (!materials) {
              throw new Error(`Pré-analyse Scrivener incomplète pour le dossier de recherche « ${child.title} ».`);
            }
            await writeResearchFolderSelfNote(child, target, materials);
          }
          for (const grandchild of child.children) {
            await writeResearchNode(grandchild, targetFolder, folderDef.tag);
          }
        } else {
          const fallback = await plugin.ensureFolder(
            normalizePath(`${researchRoot.path}/${unclassifiedFolderLabel}`)
          );
          await writeResearchNode(child, fallback, null);
        }
      }
    }

    if (parsed.others && parsed.others.length > 0 && researchRoot) {
      const fallback = await plugin.ensureFolder(
        normalizePath(`${researchRoot.path}/${unclassifiedFolderLabel}`)
      );
      for (const otherItem of parsed.others) {
        await writeResearchNode(otherItem, fallback, null);
      }
    }

    if (encounteredLabels.size > 0) {
      if (!S.projectMeta) S.projectMeta = {};
      if (!S.projectMeta[manuscritPath]) S.projectMeta[manuscritPath] = {};
      const currentMeta = S.projectMeta[manuscritPath];
      const palette = ["#e0524f", "#e08f4f", "#d9c04a", "#5aa564", "#5a8fd9", "#9a6dd7"];
      const currentLabels = (currentMeta.labels || S.labels || []) as (string | { name: string; color: string })[];
      const existing = currentLabels.map((l) => (typeof l === "string" ? l : l.name));
      const toAdd = [...encounteredLabels].filter((n) => !existing.includes(n));
      if (toAdd.length > 0) {
        const merged = [...currentLabels];
        toAdd.forEach((n, idx) => merged.push({ name: n, color: palette[(existing.length + idx) % palette.length] }));
        currentMeta.labels = merged as FeuilletsSettings["labels"];
      }
    }

    await plugin.saveSettings();
    plugin.renderAllViews(true);
    plugin.updateStatusBar();
    const warning = unreadableCount > 0
      ? ` ${t("modal.scrivenerImport.unreadableWarning", { count: String(unreadableCount) })}`
      : "";
    new Notice(t("modal.scrivenerImport.importSuccess", { path: volumePath }) + warning, warning ? 10000 : 4000);
  }
}
