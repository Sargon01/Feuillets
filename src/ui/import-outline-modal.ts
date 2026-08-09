import { Modal, Notice, TFile, TFolder, normalizePath, type App, type TAbstractFile } from "obsidian";
import { t } from "../i18n/index.js";
import { titleFor } from "../services/frontmatter.js";

type ProjectNode = TFile | TFolder;

type ImportOutlineSettings = {
  wordGoal: number;
};

type ImportOutlinePlugin = {
  settings: ImportOutlineSettings;
  getProjectFolder(): TFolder | null;
  ensureFolder(path: string): Promise<TAbstractFile>;
  writeOrder(parent: TAbstractFile, children: TAbstractFile[]): Promise<void>;
  renderAllViews(force: boolean): void;
  /** Correctif Lot 9 — mode `idea-tree` uniquement (fusion additive) :
   * ORDRE CANONIQUE réel du dossier, jamais `folder.children` brut. Déjà
   * public sur le plugin principal (voir main.ts, `getOrderedChildren`) —
   * réutilisé ici, jamais une deuxième logique d'ordre. */
  getOrderedChildren(folder: TFolder): ProjectNode[];
};

/** Correctif Lot 9 — `source: "idea-tree"` distingue l'import déclenché
 * depuis « Transformer cette branche en plan… » (fusion additive, voir
 * `importOutlineIdeaTree`) de la commande historique « Importer un plan… »
 * (comportement `importOutline` strictement inchangé). Absent ou `{}` →
 * comportement historique, comme avant ce correctif. */
export type ImportOutlineOptions = {
  source?: "idea-tree";
};

/** Une feuille du plan (puce ou ligne brute) une fois la branche Markdown
 * découpée en arbre — `match` n'est renseigné (mode idea-tree seulement)
 * qu'après `validateIdeaTreeTree` : le TFile existant à réutiliser, ou
 * `null` si aucun feuillet existant ne porte ce titre dans ce dossier. */
type ResolvedFileNode = {
  kind: "file";
  title: string;
  match?: TFile | null;
};

/** Un titre Markdown une fois résolu contre le vault (mode idea-tree
 * seulement — jamais utilisé par l'import historique) : `path` est le
 * chemin déterministe (mêmes règles que `safeFolderName` en mode
 * historique) ; `existing` le TFolder déjà présent à cette adresse, ou
 * `null` s'il reste à créer. */
type ResolvedFolderNode = {
  kind: "folder";
  title: string;
  path: string;
  existing: TFolder | null;
  children: ResolvedNode[];
};

type ResolvedNode = ResolvedFolderNode | ResolvedFileNode;

/** Erreur de fusion additive (mode idea-tree) — toujours détectée AVANT
 * toute mutation (voir `validateIdeaTreeTree`), jamais après coup. */
type IdeaTreeMergeError =
  | { code: "duplicate-in-plan"; title: string; folder: string }
  | { code: "ambiguous-existing"; title: string; folder: string };

export class ImportOutlineModal extends Modal {
  plugin: ImportOutlinePlugin;
  initialText: string;
  options: ImportOutlineOptions;

  /** `initialText` (Lot 9) : préremplit la textarea, par exemple avec le
   * Markdown produit par `ideaTreeBranchToOutlineMarkdown` (Arbre d'idées →
   * plan). `options.source === "idea-tree"` (correctif Lot 9) : bascule sur
   * la fusion additive/idempotente (`importOutlineIdeaTree`) au lieu de
   * l'import historique. Comportement historique STRICTEMENT inchangé
   * quand les deux sont omis — les anciens appels à deux arguments restent
   * compatibles tels quels. */
  constructor(app: App, plugin: ImportOutlinePlugin, initialText = "", options: ImportOutlineOptions = {}) {
    super(app);
    this.plugin = plugin;
    this.initialText = initialText;
    this.options = options;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.importOutline.title"),
    });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.importOutline.desc")
    );
    const ta = contentEl.createEl("textarea", {
      attr: {
        rows: 14,
        placeholder: t("modal.importOutline.placeholder"),
      },
    });
    ta.addClass("feuillets-input-full");
    ta.addClass("feuillets-mono");
    if (this.initialText) ta.value = this.initialText;
    ta.focus();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.importOutline.createBtn"), cls: "mod-cta" })
      .addEventListener("click", () => {
        void (async () => {
          const text = ta.value;
          if (!text.trim()) {
            new Notice(t("modal.importOutline.pasteFirst"));
            return;
          }
          if (this.options.source === "idea-tree") {
            // Correctif Lot 9 — une erreur de fusion (ambiguïté, doublon)
            // n'est jamais fermée automatiquement : l'auteur peut corriger
            // le texte collé et réessayer sans tout perdre.
            const ok = await this.importOutlineIdeaTree(text);
            if (!ok) return;
          } else {
            await this.importOutline(text);
          }
          this.close();
        })();
      });
    btnRow
      .createEl("button", { text: t("modal.cancel") })
      .addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }

  safeFolderName(title: string, index: number): string {
    const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
    return cleaned || t("modal.importOutline.untitled", { index: String(index) });
  }

  /** Comportement HISTORIQUE de « Importer un plan… » — STRICTEMENT
   * inchangé par le correctif Lot 9 (voir section 1 du correctif) : chaque
   * ligne du plan crée systématiquement un nouveau `scene-NNN.md`, jamais
   * de réutilisation par titre. Utilisé quand `options.source` n'est PAS
   * `"idea-tree"`. */
  async importOutline(text: string): Promise<void> {
    const plugin = this.plugin;
    const root = plugin.getProjectFolder();
    if (!root) {
      new Notice(t("modal.importOutline.noProjectFolder"));
      return;
    }
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    const activeFolders: Array<TAbstractFile | null> = [root];
    let createdFoldersCount = 0;
    let createdFilesCount = 0;
    const orderMap = new Map<string, TAbstractFile[]>();

    const record = (parent: TAbstractFile, child: TAbstractFile): void => {
      const arr = orderMap.get(parent.path) || [];
      arr.push(child);
      orderMap.set(parent.path, arr);
    };

    let fileIdx = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const headerMatch = raw.match(/^\s*(#+)\s+(.+)$/);
      const bulletMatch = raw.match(/^\s*[-*+]\s+(.+)$/);

      if (headerMatch) {
        const hashes = headerMatch[1].length; // niveau 1 à 6
        const title = headerMatch[2].trim();
        if (!title) continue;

        let parent: TAbstractFile = root;
        for (let i = hashes - 1; i >= 0; i--) {
          const activeFolder = activeFolders[i];
          if (activeFolder) {
            parent = activeFolder;
            break;
          }
        }

        const folderName = this.safeFolderName(title, createdFoldersCount + 1);
        const folder = await plugin.ensureFolder(`${parent.path}/${folderName}`);

        activeFolders[hashes] = folder;
        // Efface les dossiers actifs de niveau supérieur
        for (let i = hashes + 1; i < activeFolders.length; i++) {
          activeFolders[i] = null;
        }

        record(parent, folder);
        createdFoldersCount++;
      } else {
        let title = "";
        if (bulletMatch) {
          title = bulletMatch[1].trim();
        } else {
          title = line;
        }
        if (!title) continue;

        let parent: TAbstractFile = root;
        for (let i = activeFolders.length - 1; i >= 0; i--) {
          const activeFolder = activeFolders[i];
          if (activeFolder) {
            parent = activeFolder;
            break;
          }
        }

        // Une collision (fichier `scene-NNN.md` déjà présent, par exemple un
        // import précédent dans le même dossier) ne doit jamais faire perdre
        // silencieusement cette ligne du plan : on avance au prochain nom
        // technique disponible plutôt que d'écraser ou d'ignorer.
        let path: string;
        do {
          fileIdx++;
          const fileName = `scene-${String(fileIdx).padStart(3, "0")}.md`;
          path = normalizePath(`${parent.path}/${fileName}`);
        } while (this.app.vault.getAbstractFileByPath(path));

        const fileLines = [
          "---",
          `title: ${JSON.stringify(title)}`,
          "short_title: ",
          `order: ${fileIdx}`,
          "synopsis: ",
          "summary: ",
          "status: ",
          "label: ",
          `goal: ${plugin.settings.wordGoal}`,
          "tags: ",
          "date: ",
          "notes: ",
          "compile: true",
          "---",
          "",
          "",
        ];
        const file = await this.app.vault.create(path, fileLines.join("\n"));
        record(parent, file);
        createdFilesCount++;
      }
    }

    for (const [parentPath, children] of orderMap) {
      const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
      if (parentFolder) await plugin.writeOrder(parentFolder, children);
    }

    plugin.renderAllViews(true);
    new Notice(t("modal.importOutline.importDone", { folders: String(createdFoldersCount), files: String(createdFilesCount) }));
  }

  // ------------------------------------------------------------------
  // Correctif Lot 9 — mode idea-tree : fusion additive et idempotente.
  // ------------------------------------------------------------------

  /** Découpe `text` en arbre résolu contre le vault RÉEL (lecture seule,
   * aucune mutation) : mêmes règles de niveaux/parenté que l'import
   * historique (même stack `activeFolders`, mêmes regex, même repli sur le
   * plus proche ancêtre actif), mais chaque titre de dossier est résolu en
   * chemin déterministe et confronté au vault pour savoir s'il existe déjà.
   * Le parcours pré-ordre de l'arbre produit reproduit exactement l'ordre
   * du document, comme la boucle linéaire historique. */
  private buildResolvedTree(text: string, root: TFolder): ResolvedFolderNode {
    const rootNode: ResolvedFolderNode = { kind: "folder", title: root.name, path: root.path, existing: root, children: [] };
    const activeFolders: Array<ResolvedFolderNode | null> = [rootNode];
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    let folderCounter = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const headerMatch = raw.match(/^\s*(#+)\s+(.+)$/);
      const bulletMatch = raw.match(/^\s*[-*+]\s+(.+)$/);

      if (headerMatch) {
        const hashes = headerMatch[1].length;
        const title = headerMatch[2].trim();
        if (!title) continue;

        let parent: ResolvedFolderNode = rootNode;
        for (let i = hashes - 1; i >= 0; i--) {
          const active = activeFolders[i];
          if (active) {
            parent = active;
            break;
          }
        }

        folderCounter++;
        const folderName = this.safeFolderName(title, folderCounter);
        const path = normalizePath(`${parent.path}/${folderName}`);
        const existingAbstract = this.app.vault.getAbstractFileByPath(path);
        const existing = existingAbstract instanceof TFolder ? existingAbstract : null;
        const node: ResolvedFolderNode = { kind: "folder", title, path, existing, children: [] };
        parent.children.push(node);

        activeFolders[hashes] = node;
        for (let i = hashes + 1; i < activeFolders.length; i++) activeFolders[i] = null;
      } else {
        const title = bulletMatch ? bulletMatch[1].trim() : line;
        if (!title) continue;

        let parent: ResolvedFolderNode = rootNode;
        for (let i = activeFolders.length - 1; i >= 0; i--) {
          const active = activeFolders[i];
          if (active) {
            parent = active;
            break;
          }
        }
        parent.children.push({ kind: "file", title });
      }
    }

    return rootNode;
  }

  /** Valide l'arbre ENTIER avant toute mutation (section 5/6 du correctif) :
   * deux puces du même titre dans le même dossier (existant ou non) →
   * `duplicate-in-plan` ; un titre de puce qui correspond à PLUSIEURS
   * TFile déjà présents dans un dossier existant → `ambiguous-existing`.
   * Effet de bord volontaire et sans danger : renseigne `match` sur chaque
   * `ResolvedFileNode` (le TFile à réutiliser, ou `null` pour créer) —
   * jamais de mutation du vault ici. */
  private validateIdeaTreeTree(node: ResolvedFolderNode): IdeaTreeMergeError | null {
    const fileChildren = node.children.filter((c): c is ResolvedFileNode => c.kind === "file");
    const byTitle = new Map<string, ResolvedFileNode[]>();
    for (const file of fileChildren) {
      const group = byTitle.get(file.title) || [];
      group.push(file);
      byTitle.set(file.title, group);
    }
    const folderLabel = node.existing?.name ?? node.title;

    for (const [title, group] of byTitle) {
      if (group.length > 1) return { code: "duplicate-in-plan", title, folder: folderLabel };
    }

    if (node.existing) {
      const existingFiles = this.plugin
        .getOrderedChildren(node.existing)
        .filter((c): c is TFile => c instanceof TFile);
      for (const [title, group] of byTitle) {
        const matches = existingFiles.filter((file) => titleFor(this.app, file).trim() === title.trim());
        if (matches.length > 1) return { code: "ambiguous-existing", title, folder: folderLabel };
        group[0].match = matches.length === 1 ? matches[0] : null;
      }
    } else {
      for (const file of fileChildren) file.match = null;
    }

    for (const child of node.children) {
      if (child.kind === "folder") {
        const error = this.validateIdeaTreeTree(child);
        if (error) return error;
      }
    }
    return null;
  }

  /** Fusionne `node` (déjà validé) dans `real` — TOUJOURS additif : capture
   * l'ordre canonique existant (`getOrderedChildren`, jamais
   * `folder.children` brut) AVANT toute mutation, le conserve intégralement,
   * puis n'ajoute QUE les enfants du plan absents de cet ordre, dans l'ordre
   * du plan (section 7/8 du correctif). Un enfant déjà réutilisé (dossier
   * de même nom, feuillet déjà `match`é) n'est ni déplacé ni réécrit. */
  private async mergeFolder(node: ResolvedFolderNode, real: TFolder, counts: { folders: number; files: number }): Promise<void> {
    const snapshot = this.plugin.getOrderedChildren(real);
    const finalOrder: ProjectNode[] = [...snapshot];
    const present = new Set(snapshot.map((c) => c.name));
    let fileIdx = 0;

    for (const child of node.children) {
      if (child.kind === "folder") {
        let childReal: TFolder;
        if (child.existing) {
          childReal = child.existing;
        } else {
          const created = await this.plugin.ensureFolder(child.path);
          if (!(created instanceof TFolder)) continue;
          childReal = created;
          counts.folders++;
        }
        if (!present.has(childReal.name)) {
          finalOrder.push(childReal);
          present.add(childReal.name);
        }
        await this.mergeFolder(child, childReal, counts);
      } else {
        if (child.match) continue; // réutilisé tel quel : aucune mutation.

        let path: string;
        do {
          fileIdx++;
          const fileName = `scene-${String(fileIdx).padStart(3, "0")}.md`;
          path = normalizePath(`${real.path}/${fileName}`);
        } while (this.app.vault.getAbstractFileByPath(path));

        const fileLines = [
          "---",
          `title: ${JSON.stringify(child.title)}`,
          "short_title: ",
          `order: ${fileIdx}`,
          "synopsis: ",
          "summary: ",
          "status: ",
          "label: ",
          `goal: ${this.plugin.settings.wordGoal}`,
          "tags: ",
          "date: ",
          "notes: ",
          "compile: true",
          "---",
          "",
          "",
        ];
        const file = await this.app.vault.create(path, fileLines.join("\n"));
        finalOrder.push(file);
        present.add(file.name);
        counts.files++;
      }
    }

    if (node.children.length > 0) await this.plugin.writeOrder(real, finalOrder);
  }

  /** Import idempotent/additif depuis « Transformer cette branche en
   * plan… » (correctif Lot 9). Retourne `false` sans AUCUNE mutation si le
   * dossier projet est absent ou si `validateIdeaTreeTree` détecte une
   * ambiguïté/un doublon — l'appelant (voir `onOpen`) garde alors la modale
   * ouverte pour permettre une correction immédiate. */
  async importOutlineIdeaTree(text: string): Promise<boolean> {
    const plugin = this.plugin;
    const root = plugin.getProjectFolder();
    if (!root) {
      new Notice(t("modal.importOutline.noProjectFolder"));
      return false;
    }

    const tree = this.buildResolvedTree(text, root);
    const error = this.validateIdeaTreeTree(tree);
    if (error) {
      const key = error.code === "duplicate-in-plan"
        ? "modal.importOutline.duplicateInPlan"
        : "modal.importOutline.ambiguousExisting";
      new Notice(t(key, { title: error.title, folder: error.folder }));
      return false;
    }

    const counts = { folders: 0, files: 0 };
    await this.mergeFolder(tree, root, counts);

    plugin.renderAllViews(true);
    new Notice(t("modal.importOutline.importDone", { folders: String(counts.folders), files: String(counts.files) }));
    return true;
  }
}
