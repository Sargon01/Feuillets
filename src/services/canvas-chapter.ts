import { normalizePath, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { CanvasData, CanvasNode } from "./canvas-board.js";
import {
  sortNodesSpatially,
  safeFileName,
  convertTextNodeToFileNode,
  resolveOrCreateSheetFile,
  freshCanvasNodeId,
} from "./canvas-bridge.js";
import { getOrderedChildren, flattenFiles, getProjectFolder } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import type { MinimalRuntimeCanvas } from "./canvas-runtime.js";
import { replaceTextNodeWithFileNode } from "./canvas-runtime.js";

/* Carnet → chapitre du manuscrit (Lot 2). Toute la logique de DÉTECTION et
 * de PLANIFICATION est pure (aucun accès App/vault) — testable sans
 * Obsidian, réutilisée à l'identique par le fallback (aucune extension) et
 * par node-menu/selection-menu (integrations/advanced-canvas.ts), qui ne
 * contient elle-même AUCUNE logique métier de création de chapitre (voir
 * cahier des charges, section 23).
 *
 * Invariant central : la création est une action PONCTUELLE. Aucun champ
 * n'est jamais posé pour relier le chapitre créé au groupe d'origine —
 * après création, le Carnet et le Binder évoluent indépendamment (voir
 * section 19-20 du cahier des charges).
 *
 * RÈGLE FONDAMENTALE (simplification Carnet) : une arête du Carnet n'a
 * AUCUN effet métier automatique. Une fiche Recherche présente dans un
 * groupe ou reliée par une flèche à une scène n'est jamais déplacée, jamais
 * rattachée au chapitre créé, jamais écrite dans `researchFolderLinks` —
 * `admissibleChapterNodes`/`isAdmissibleChapterNode` l'excluent
 * structurellement (chemin hors manuscrit actif), ce module ne connaît donc
 * même pas la notion de "fiche Recherche liée". Le mécanisme général
 * `researchFolderLinks` (association manuelle Binder↔Recherche, voir
 * main.ts) reste utilisable ailleurs dans Feuillets, seulement plus jamais
 * déclenché automatiquement depuis le Carnet. */

type ProjectNode = TFile | TFolder;

// ---------------------------------------------------------------------------
// 1. Admissibilité
// ---------------------------------------------------------------------------

/** Un text node (nouvelle scène possible) ou un file node .md déjà présent
 * dans le manuscrit actif sont seuls admissibles à composer un chapitre.
 * Toute fiche Recherche, fichier de Ressources, image, PDF, fichier
 * externe, link node ou group node est exclu — jamais déplacé, jamais
 * proposé comme scène cochable (voir section 5/6). */
export function isAdmissibleChapterNode(
  node: CanvasNode,
  isManuscriptMarkdownPath: (path: string) => boolean
): boolean {
  if (node.type === "text" && typeof node.text === "string") return true;
  if (node.type === "file" && typeof node.file === "string" && node.file.toLowerCase().endsWith(".md")) {
    return isManuscriptMarkdownPath(node.file);
  }
  return false;
}

export function admissibleChapterNodes(
  nodes: CanvasNode[],
  isManuscriptMarkdownPath: (path: string) => boolean
): CanvasNode[] {
  return nodes.filter((n) => isAdmissibleChapterNode(n, isManuscriptMarkdownPath));
}

/** Prédicat réel (App-aware) : un chemin .md appartient au manuscrit actif
 * s'il est sous la racine du projet ET que le fichier existe encore
 * réellement dans le coffre (un file node orphelin — fichier supprimé
 * depuis — n'est jamais admissible). */
export function makeManuscriptPathChecker(app: App, settings: FeuilletsSettings): (path: string) => boolean {
  const root = getProjectFolder(app, settings);
  return (path: string) => {
    if (!root) return false;
    if (root.path !== "" && !path.startsWith(root.path + "/") && path !== root.path) return false;
    return app.vault.getAbstractFileByPath(path) instanceof TFile;
  };
}

// ---------------------------------------------------------------------------
// 2. Détection géométrique (groupe → contenu)
// ---------------------------------------------------------------------------

type BBox = { x: number; y: number; w: number; h: number };

function bboxOf(n: CanvasNode): BBox {
  return { x: n.x || 0, y: n.y || 0, w: n.width || 0, h: n.height || 0 };
}

function fullyContains(outer: BBox, inner: BBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Nodes géométriquement contenus dans `group` (bornes du node entièrement
 * à l'intérieur des bornes du groupe) — le groupe lui-même n'apparaît
 * jamais dans le résultat. Fonction PURE, uniquement basée sur les
 * coordonnées JSON du Canvas : ni `canvas.getContainingNodes()` ni aucune
 * autre méthode Advanced Canvas n'est nécessaire ici, pour que le fallback
 * (sans extension) et node-menu partagent EXACTEMENT le même calcul (voir
 * section 4 du cahier des charges : "la logique pure de détection doit
 * vivre hors de l'intégration Advanced Canvas"). */
export function nodesContainedInGroup(canvas: CanvasData, group: CanvasNode): CanvasNode[] {
  const outer = bboxOf(group);
  return (canvas.nodes || []).filter((n) => n.id !== group.id && fullyContains(outer, bboxOf(n)));
}

/** Tous les group nodes présents sur le tableau — sert à peupler le
 * sélecteur de groupe de la commande palette (fallback sans Advanced
 * Canvas, voir section 4). */
export function groupNodesOf(canvas: CanvasData): CanvasNode[] {
  return (canvas.nodes || []).filter((n) => n.type === "group");
}

// ---------------------------------------------------------------------------
// 3. Nom par défaut
// ---------------------------------------------------------------------------

/** Nom de chapitre proposé pour un groupe : son `label` s'il en a un,
 * chaîne vide sinon (saisie alors obligatoire — jamais de nom neutre
 * inventé pour un groupe, contrairement à une sélection libre). */
export function defaultChapterNameForGroup(group: CanvasNode): string {
  const label = group.label;
  return typeof label === "string" ? label.trim() : "";
}

// ---------------------------------------------------------------------------
// 4. Ordre par défaut
// ---------------------------------------------------------------------------

/** Ordre par défaut proposé pour composer un chapitre : uniquement l'ordre
 * spatial déterministe du Carnet (haut→bas, puis gauche→droite). Les edges
 * et l'ordre Binder ne portent aucune intention narrative ici. */
export function defaultChapterOrder(items: CanvasNode[], _binderIndexOf: (path: string) => number): CanvasNode[] {
  return sortNodesSpatially(items);
}

/** Fabrique un `binderIndexOf` réel à partir du manuscrit actif — position
 * dans l'ordre à plat déjà utilisé partout ailleurs dans Feuillets
 * (flattenFiles, même règle que la compilation/le Plan). Un chemin absent
 * (jamais vu dans le manuscrit) est repoussé en toute fin, jamais une
 * erreur. */
export function makeBinderIndex(app: App, settings: FeuilletsSettings, root: TFolder): (path: string) => number {
  const flat = flattenFiles(app, settings, root);
  const index = new Map(flat.map((f, i) => [f.path, i]));
  return (path: string) => (index.has(path) ? (index.get(path) as number) : Number.MAX_SAFE_INTEGER);
}

// ---------------------------------------------------------------------------
// 5. Plan (pur, validé AVANT toute mutation)
// ---------------------------------------------------------------------------

export type ChapterPlanItem =
  | { kind: "text"; node: CanvasNode }
  | { kind: "existing-file"; node: CanvasNode; sourcePath: string };

export type ChapterPlan = {
  chapterName: string;
  chapterPath: string;
  destParentPath: string;
  items: ChapterPlanItem[];
};

export type ChapterPlanError =
  | { code: "empty-name" }
  | { code: "no-items" }
  | { code: "collision"; path: string };

export function isChapterPlanError(x: ChapterPlan | ChapterPlanError): x is ChapterPlanError {
  return "code" in x;
}

/** Calcule le plan complet AVANT toute mutation — nom, chemin du dossier,
 * collision, éléments dans l'ordre validé. `exists` est injectable (pur,
 * testable) ; en usage réel c'est `app.vault.getAbstractFileByPath`. Ne
 * fusionne, n'écrase et ne renomme jamais un dossier existant : une
 * collision est une erreur bloquante, jamais une mise à jour implicite
 * (voir section 9 — hors périmètre). */
export function buildChapterPlan(
  rawName: string,
  destParentPath: string,
  orderedNodes: CanvasNode[],
  exists: (path: string) => boolean
): ChapterPlan | ChapterPlanError {
  const name = rawName.trim();
  if (!name) return { code: "empty-name" };
  if (orderedNodes.length === 0) return { code: "no-items" };
  const chapterPath = normalizePath(`${destParentPath}/${safeFileName(name)}`);
  if (exists(chapterPath)) return { code: "collision", path: chapterPath };
  const items: ChapterPlanItem[] = orderedNodes.map((node) =>
    node.type === "file"
      ? { kind: "existing-file", node, sourcePath: String(node.file) }
      : { kind: "text", node }
  );
  return { chapterName: name, chapterPath, destParentPath, items };
}

// ---------------------------------------------------------------------------
// 6. Exécution transactionnelle + rollback
// ---------------------------------------------------------------------------

export type ChapterExecutionResult =
  | { ok: true; chapterFolder: TFolder; created: number; moved: number }
  | { ok: false; error: string };

/** Réécrit l'ordre de fratrie d'un dossier — même mécanisme que
 * `FeuilletsPlugin.writeOrder` (main.ts) : `settings.orders` pour l'ordre
 * global, `folderPositions` pour les sous-dossiers, `order` frontmatter
 * pour les fichiers. Reproduit ici en fonction pure (App/settings passés
 * en paramètres, pas `this`) car `writeOrder` est une méthode d'instance
 * du plugin — la dupliquer entièrement serait dépendre de tout
 * FeuilletsPlugin depuis un service testable indépendamment ; cette
 * version fait EXACTEMENT la même chose, rien de plus. Ne persiste pas
 * `settings` elle-même : c'est à l'appelant (comme partout ailleurs dans
 * Feuillets) d'appeler `saveSettings()` une fois l'opération terminée. */
async function writeSiblingOrder(app: App, settings: FeuilletsSettings, parent: TFolder, orderedChildren: ProjectNode[]): Promise<void> {
  settings.orders[parent.path] = orderedChildren.map((c) => c.name);
  for (let i = 0; i < orderedChildren.length; i++) {
    const child = orderedChildren[i];
    if (child instanceof TFile) {
      const current = parseInt(String(fmOf(app, child).order), 10);
      if (current !== i + 1) {
        await app.fileManager.processFrontMatter(child, (fm: SceneFrontmatter) => {
          fm.order = i + 1;
        });
      }
    } else {
      settings.folderPositions[child.path] = i + 1;
    }
  }
}

/** Exécute un plan déjà validé : crée le dossier chapitre, déplace les
 * fichiers existants (jamais de copie — `fileManager.renameFile`, qui
 * respecte les liens du coffre, comme partout ailleurs dans Feuillets),
 * crée les nouveaux feuillets pour les text nodes retenus, met à jour
 * l'ordre Binder (nouveau chapitre + anciens parents nettoyés), puis
 * transforme les nodes Canvas concernés en file nodes — en mémoire
 * seulement (`canvas.nodes` muté en place), jamais persisté ici : selon
 * l'appelant, `canvas.setData()+requestSave()` (Advanced Canvas) ou
 * `vault.modify()` (repli), exactement comme le pont du Lot 1.
 *
 * Sécurité : toute mutation de fichiers/dossiers/ordres se fait dans un
 * seul bloc protégé — au premier échec, tout ce qui a déjà été fait est
 * défait (rollback best-effort) avant de renvoyer l'erreur. `canvas.nodes`
 * n'est modifié qu'à la toute dernière étape, une fois tout le reste
 * confirmé : le texte original d'un text node n'est donc jamais perdu tant
 * que l'opération n'a pas entièrement réussi. */
export async function executeChapterPlan(
  app: App,
  settings: FeuilletsSettings,
  canvas: CanvasData,
  plan: ChapterPlan,
  runtimeCanvas?: MinimalRuntimeCanvas
): Promise<ChapterExecutionResult> {
  // --- validations juste avant mutation (section 21) ---
  if (app.vault.getAbstractFileByPath(plan.chapterPath)) {
    return { ok: false, error: `collision:${plan.chapterPath}` };
  }
  const destParent = app.vault.getAbstractFileByPath(plan.destParentPath);
  if (!(destParent instanceof TFolder)) {
    return { ok: false, error: `invalid-destination:${plan.destParentPath}` };
  }
  for (const item of plan.items) {
    if (item.kind === "existing-file" && !(app.vault.getAbstractFileByPath(item.sourcePath) instanceof TFile)) {
      return { ok: false, error: `missing-source:${item.sourcePath}` };
    }
  }
  const canvasNodeIds = new Set(canvas.nodes.map((n) => n.id));
  for (const item of plan.items) {
    if (!canvasNodeIds.has(item.node.id)) return { ok: false, error: `missing-node:${item.node.id}` };
  }

  // --- capture AVANT mutation : nécessaire au calcul de position (section 16) ---
  // Chemins seulement (jamais les objets TFile/TFolder eux-mêmes) : ceux-ci
  // sont mutés EN PLACE par fileManager.renameFile — comparer contre un
  // objet capturé "avant" comparerait en réalité contre son état "après".
  const destSiblingsBeforePaths = getOrderedChildren(app, settings, destParent).map((c) => c.path);
  const originalSourceParentOf = new Map<string, string>(); // sourcePath -> chemin du parent d'origine

  // --- état de rollback ---
  const createdFiles: TFile[] = [];
  let createdFolder: TFolder | null = null;
  const movedFiles: { file: TFile; from: string }[] = [];
  const previousOrders = new Map<string, string[] | undefined>();
  const touchOrder = (path: string) => {
    if (!previousOrders.has(path)) {
      previousOrders.set(path, settings.orders[path] ? [...settings.orders[path]] : undefined);
    }
  };

  const rollback = async (): Promise<void> => {
    for (const { file, from } of [...movedFiles].reverse()) {
      try {
        await app.fileManager.renameFile(file, from);
      } catch {
        /* best effort : sécurité des fichiers > automatisation, on continue */
      }
    }
    for (const f of createdFiles) {
      try {
        await app.vault.delete(f);
      } catch {
        /* best effort */
      }
    }
    if (createdFolder) {
      const stillThere = app.vault.getAbstractFileByPath(createdFolder.path);
      if (stillThere instanceof TFolder && stillThere.children.length === 0) {
        try {
          await app.vault.delete(stillThere);
        } catch {
          /* best effort */
        }
      }
    }
    for (const [path, names] of previousOrders) {
      if (names === undefined) delete settings.orders[path];
      else settings.orders[path] = names;
    }
  };

  try {
    // 2. création du dossier chapitre
    createdFolder = await app.vault.createFolder(plan.chapterPath);
    const chapterFolder = createdFolder;

    // 3/4. déplacement des fichiers existants + création des nouveaux
    //      feuillets, DANS l'ordre validé du plan.
    const newNodesById = new Map<string, CanvasNode>();
    const chapterChildrenInOrder: TFile[] = [];
    const textConversions: { sourceId: string; file: TFile; fallbackId: string }[] = [];

    for (const item of plan.items) {
      if (item.kind === "existing-file") {
        const file = app.vault.getAbstractFileByPath(item.sourcePath);
        if (!(file instanceof TFile)) continue;
        const srcParentPath = file.parent ? file.parent.path : "";
        originalSourceParentOf.set(item.sourcePath, srcParentPath);
        touchOrder(srcParentPath);
        const destPath = normalizePath(`${chapterFolder.path}/${file.name}`);
        await app.fileManager.renameFile(file, destPath);
        movedFiles.push({ file, from: item.sourcePath });
        const moved = app.vault.getAbstractFileByPath(destPath);
        if (moved instanceof TFile) {
          chapterChildrenInOrder.push(moved);
          newNodesById.set(item.node.id, { ...item.node, file: moved.path });
        }
      } else {
        // Réutilise un fichier déjà créé par une tentative antérieure
        // interrompue avant le remplacement runtime (jamais un doublon) —
        // voir resolveOrCreateSheetFile, canvas-bridge.ts.
        const { file, wasCreated } = await resolveOrCreateSheetFile(app, item.node, chapterFolder, "manuscript");
        if (wasCreated) createdFiles.push(file);
        chapterChildrenInOrder.push(file);
        // Remplacement runtime RÉEL du text node par un vrai file node
        // (jamais une simple mise à jour JSON — voir canvas-runtime.ts) :
        // même helper que Lot 1, réutilisé ici pour ne jamais dupliquer la
        // logique. Sans `runtimeCanvas` (repli disque), seul le JSON est
        // mis à jour, comme avant ce correctif.
        const effectiveId = freshCanvasNodeId(canvas);
        newNodesById.set(item.node.id, { ...convertTextNodeToFileNode(item.node, file.path, "manuscript"), id: effectiveId });
        textConversions.push({ sourceId: item.node.id, file, fallbackId: effectiveId });
        // Même règle atomique que Lot 1 : changement de type = nouvel id,
        // puis remappage JSON de toutes les arêtes. La reconstruction live
        // est laissée à importData au moment de la persistance finale.
        for (const edge of canvas.edges || []) {
          if (edge.fromNode === item.node.id) edge.fromNode = effectiveId;
          if (edge.toNode === item.node.id) edge.toNode = effectiveId;
        }
      }
    }

    // 6a. ordre du nouveau chapitre : exactement l'ordre validé.
    touchOrder(chapterFolder.path);
    await writeSiblingOrder(app, settings, chapterFolder, chapterChildrenInOrder);

    // 6b. anciens parents nettoyés : plus aucun nom déplacé qui ne s'y
    //     trouve plus (section 15) — jamais les frères non concernés
    //     réordonnés, on réécrit juste leur liste ACTUELLE (déjà triée).
    const sourceParentPaths = new Set(originalSourceParentOf.values());
    for (const parentPath of sourceParentPaths) {
      if (parentPath === plan.destParentPath) continue; // traité séparément ci-dessous
      const folder = app.vault.getAbstractFileByPath(parentPath);
      if (folder instanceof TFolder) {
        touchOrder(parentPath);
        await writeSiblingOrder(app, settings, folder, getOrderedChildren(app, settings, folder));
      }
    }

    // 6c. position du nouveau chapitre dans son dossier de destination
    //     (section 16) : seulement si TOUS les fichiers déplacés
    //     proviennent de ce même dossier — position du PREMIER déplacé ;
    //     sinon comportement normal de création (rien à imposer).
    const existingFileItems = plan.items.filter((i): i is Extract<ChapterPlanItem, { kind: "existing-file" }> => i.kind === "existing-file");
    const originParents = new Set(existingFileItems.map((i) => originalSourceParentOf.get(i.sourcePath)));
    const samePlaceAsDestination = existingFileItems.length > 0 && originParents.size === 1 && [...originParents][0] === plan.destParentPath;

    if (samePlaceAsDestination || sourceParentPaths.has(plan.destParentPath)) {
      touchOrder(plan.destParentPath);
      const currentDestChildren = getOrderedChildren(app, settings, destParent).filter((c) => c.path !== chapterFolder.path);
      if (samePlaceAsDestination) {
        const firstSourcePath = existingFileItems[0].sourcePath;
        const idx = destSiblingsBeforePaths.indexOf(firstSourcePath);
        const at = idx === -1 ? currentDestChildren.length : Math.min(idx, currentDestChildren.length);
        currentDestChildren.splice(at, 0, chapterFolder);
      } else {
        currentDestChildren.push(chapterFolder);
      }
      await writeSiblingOrder(app, settings, destParent, currentDestChildren);
    }

    // 6d. Aucune contextualisation Recherche ici (simplification Carnet) :
    //     une fiche Recherche géométriquement dans le groupe ou reliée par
    //     une flèche à une scène retenue reste où elle est, telle quelle —
    //     l'edge n'a jamais d'effet métier automatique.

    // 7. Une fois toutes les écritures de fichiers confirmées, matérialiser
    // les vrais FileNodes sur le Canvas ouvert. Le repli JSON reste intact
    // si le contrat runtime n'est pas disponible.
    for (const conversion of textConversions) {
      const replacement = runtimeCanvas
        ? replaceTextNodeWithFileNode(runtimeCanvas, conversion.sourceId, conversion.file, "manuscript")
        : null;
      if (!replacement) continue;
      const converted = newNodesById.get(conversion.sourceId);
      if (converted) newNodesById.set(conversion.sourceId, { ...converted, id: replacement.newId });
      for (const edge of canvas.edges || []) {
        if (edge.fromNode === conversion.fallbackId) edge.fromNode = replacement.newId;
        if (edge.toNode === conversion.fallbackId) edge.toNode = replacement.newId;
      }
    }

    // 8. CanvasData en mémoire uniquement — jamais persisté ici (voir
    //    doc de tête). Dernière étape : aucun contenu original n'est donc
    //    perdu tant que tout ce qui précède n'a pas réussi.
    for (const [id, node] of newNodesById) {
      const idx = canvas.nodes.findIndex((n) => n.id === id);
      if (idx !== -1) canvas.nodes[idx] = node;
    }

    return { ok: true, chapterFolder, created: createdFiles.length, moved: movedFiles.length };
  } catch (e) {
    await rollback();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
