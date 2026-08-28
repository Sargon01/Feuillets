import { normalizePath, TFile, TFolder } from "obsidian";
import { canAcceptChildren, draftCreates, flattenPlan, isPlanDraft, type PlanItem } from "../blocks/plan/model.js";
import { remapPath } from "../core/path-reference-maintenance.js";

/** PONT Plan → Binder (Prompt 3/5, §7) — SEULE couche autorisée à modifier
 * la structure réelle du Binder depuis le Plan. Le renderer ne touche
 * jamais au vault : il produit un `PlanItem[]`, ce module le confronte au
 * Binder réel (`buildBinderMutationPlan`, preflight PUR) puis, seulement si
 * tout est valide, exécute le lot (`applyBinderMutationPlan`).
 *
 * Ce module ne connaît ni Canvas ni DOM. Il reçoit ses primitives d'écriture
 * (writeOrder/moveNode/renameFile/création) par injection — ce sont
 * exactement celles que le plugin utilise déjà partout ailleurs, jamais des
 * réimplémentations (§7). */

export type BinderSnapshotItem = {
  kind: "folder" | "file";
  /** Nom de dossier, ou titre court du feuillet (§4). */
  title: string;
  /** Valeur YAML brute, distincte du titre de repli affiché. */
  shortTitle: string | undefined;
  path: string;
  children: BinderSnapshotItem[];
};

export type BinderSnapshot = { rootPath: string; title: string; children: BinderSnapshotItem[] };

/** Accès en LECTURE au Binder, dans l'ordre canonique Feuillets — jamais
 * `folder.children` brut (§4). */
export type BinderReader = {
  getOrderedChildren: (folder: TFolder) => Array<TFile | TFolder>;
  shortTitleFor: (file: TFile) => string;
  shortTitleRawFor?: (file: TFile) => string | undefined;
};

/** Lit le sous-arbre Binder de `root` dans l'ordre canonique (§4). Ne
 * scanne QUE ce sous-arbre — jamais le vault entier. */
export function readBinderSnapshot(reader: BinderReader, root: TFolder): BinderSnapshot {
  const walk = (folder: TFolder): BinderSnapshotItem[] =>
    reader.getOrderedChildren(folder).flatMap((child): BinderSnapshotItem[] => {
      if (child instanceof TFolder) {
        return [{ kind: "folder", title: child.name, shortTitle: undefined, path: child.path, children: walk(child) }];
      }
      if (child instanceof TFile && child.extension === "md") {
        return [{ kind: "file", title: reader.shortTitleFor(child), shortTitle: reader.shortTitleRawFor?.(child), path: child.path, children: [] }];
      }
      return [];
    });
  return { rootPath: root.path, title: root.name, children: walk(root) };
}

/** Empreinte du Binder tel que le Plan peut le modifier : chemins, ordre,
 * genre et titres affichés. Un conflit conservateur vaut mieux qu'écraser
 * silencieusement un `short_title` retouché hors du Plan. */
export function binderFingerprint(snapshot: BinderSnapshot): string {
  const walk = (items: BinderSnapshotItem[]): unknown =>
    items.map((item) => [item.kind, item.path, item.title, item.shortTitle, walk(item.children)]);
  return JSON.stringify([snapshot.rootPath, walk(snapshot.children)]);
}

/* ================================================================
 * REFRESH — Binder → Plan, en préservant les UUID (§4/§8)
 * ================================================================ */

/** Reconstruit le Plan depuis le Binder en RÉUTILISANT l'UUID et l'état
 * replié de tout item déjà connu au même `path` (§4). Un item réel disparu
 * du Binder disparaît du Plan ; les drafts locaux ne survivent pas à un
 * Refresh (c'est le sens même de « repartir du Binder ») — d'où la
 * confirmation exigée quand le Plan est sale (§8, gérée par l'appelant). */
export function planFromBinderSnapshot(snapshot: BinderSnapshot, previous: PlanItem[] = []): PlanItem[] {
  const known = new Map<string, { id: string; collapsed: boolean }>();
  for (const item of flattenPlan(previous)) {
    if (item.path) known.set(item.path, { id: item.id, collapsed: item.collapsed });
  }
  const build = (items: BinderSnapshotItem[]): PlanItem[] =>
    items.map((item) => {
      const seen = known.get(item.path);
      return {
        id: seen?.id ?? crypto.randomUUID(),
        kind: item.kind,
        title: item.title,
        path: item.path,
        collapsed: seen?.collapsed ?? false,
        children: build(item.children),
      };
    });
  return build(snapshot.children);
}

/* ================================================================
 * PREFLIGHT — §9 : tout est validé AVANT la moindre écriture
 * ================================================================ */

export type BinderOperation =
  | { op: "create-folder"; itemId: string; parentPath: string; name: string; path: string }
  | { op: "create-file"; itemId: string; parentPath: string; fileName: string; title: string; path: string }
  | { op: "rename-folder"; itemId: string; from: string; to: string }
  | { op: "move"; itemId: string; from: string; toParentPath: string }
  | { op: "set-short-title"; itemId: string; path: string; title: string; previousTitle: string | undefined }
  | { op: "order"; parentPath: string; names: string[]; previousNames?: string[] };

export type BinderMutationPlan = { operations: BinderOperation[] };

export type PreflightIssue =
  | { code: "binder-changed" }
  | { code: "missing-item"; path: string }
  | { code: "implicit-delete"; path: string }
  | { code: "collision"; path: string }
  | { code: "invalid-name"; title: string }
  | { code: "file-with-children"; title: string }
  | { code: "out-of-scope"; path: string }
  | { code: "empty-title" };

export type PreflightResult =
  | { ok: true; plan: BinderMutationPlan }
  | { ok: false; issues: PreflightIssue[] };

const INVALID_NAME = /[\\/:*?"<>|]/;
/* Variante GLOBALE pour le nettoyage : `String.replace` avec un motif non
   global ne retire que la PREMIÈRE occurrence — « a/b/c » serait resté
   invalide. Deux constantes distinctes à dessein : un regex global est
   `lastIndex`-dépendant et ne doit jamais servir à `.test()`. */
const INVALID_NAME_GLOBAL = /[\\/:*?"<>|]/g;

/** Nom de fichier sûr dérivé d'un titre (§6) — jamais le titre brut, qui
 * peut contenir des caractères interdits par le système de fichiers. */
export function safeBinderFileName(title: string): string {
  return title.trim().replace(INVALID_NAME_GLOBAL, "").replace(/\s+/g, " ").trim();
}

/** Id du parent d'un item dans le Plan, `null` s'il est à la racine. */
function findPlanParentId(items: PlanItem[], id: string): string | null {
  for (const item of items) {
    if (item.children.some((child) => child.id === id)) return item.id;
    const found = findPlanParentId(item.children, id);
    if (found) return found;
  }
  return null;
}

function isInsideScope(path: string, rootPath: string): boolean {
  const scoped = normalizePath(path);
  const root = normalizePath(rootPath);
  return scoped === root || scoped.startsWith(`${root}/`);
}

/** Construit le lot de mutations SANS rien écrire (§9). Valide la totalité
 * du lot ; au moindre problème, retourne les motifs et AUCUNE opération —
 * l'appelant ne doit alors rien exécuter. */
export function buildBinderMutationPlan(
  items: PlanItem[],
  snapshot: BinderSnapshot,
  baseFingerprint: string
): PreflightResult {
  const issues: PreflightIssue[] = [];

  // §9 — le Binder a-t-il bougé depuis le dernier Actualiser ?
  if (binderFingerprint(snapshot) !== baseFingerprint) {
    return { ok: false, issues: [{ code: "binder-changed" }] };
  }

  const snapshotByPath = new Map<string, BinderSnapshotItem>();
  const collectSnapshot = (list: BinderSnapshotItem[]) => {
    for (const item of list) { snapshotByPath.set(item.path, item); collectSnapshot(item.children); }
  };
  collectSnapshot(snapshot.children);

  const planItems = flattenPlan(items);

  // §11 — aucun item réel du snapshot ne doit avoir disparu du Plan.
  const planPaths = new Set(planItems.map((item) => item.path).filter((path): path is string => !!path));
  for (const path of snapshotByPath.keys()) {
    if (!planPaths.has(path)) issues.push({ code: "implicit-delete", path });
  }

  // Chaque item réel du Plan doit encore exister, et rester dans le scope.
  for (const item of planItems) {
    if (!item.path) continue;
    if (!snapshotByPath.has(item.path)) issues.push({ code: "missing-item", path: item.path });
    if (!isInsideScope(item.path, snapshot.rootPath)) issues.push({ code: "out-of-scope", path: item.path });
  }

  // Titres et structure.
  for (const item of planItems) {
    const title = item.title.trim();
    if (!title) { issues.push({ code: "empty-title" }); continue; }
    if (item.kind !== "file" && INVALID_NAME.test(title)) issues.push({ code: "invalid-name", title });
    if (!canAcceptChildren(item) && item.children.length > 0) issues.push({ code: "file-with-children", title });
  }

  if (issues.length > 0) return { ok: false, issues };

  /* Deux projections distinctes, et c'est essentiel :
     - `finalPath` : où l'item atterrira UNE FOIS tout le lot appliqué.
       Sert aux collisions et aux noms d'ordre.
     - `stagedPath` : où l'item se trouve AU MOMENT où son opération
       s'exécute, compte tenu de l'ordre imposé par §10. Les créations ont
       lieu AVANT les renommages : un brouillon logé dans un dossier qui
       sera renommé plus tard doit donc être créé sous le nom ACTUEL de ce
       dossier. Émettre les créations avec le chemin final produisait un
       « Folder not found » — c'est la cause du `Item not found` observé.
       Le rebase pendant l'Apply (voir applyBinderMutationPlan) reporte
       ensuite chaque renommage sur les opérations restantes. */
  const finalPath = new Map<string, string>();
  const stagedPath = new Map<string, string>();
  const claimed = new Map<string, string>();
  const operations: BinderOperation[] = [];

  const physicalName = (item: PlanItem, title: string): string | null => {
    if (item.kind === "file" && item.path) {
      // §8 : le nom sur disque d'un feuillet existant ne change JAMAIS.
      return item.path.slice(item.path.lastIndexOf("/") + 1);
    }
    if (item.kind === "folder" && item.path) return title;
    const creates = draftCreates(item);
    if (creates === "file") {
      const safe = safeBinderFileName(title);
      if (!safe) return null;
      return `${safe}.md`;
    }
    return title;
  };

  const project = (list: PlanItem[], finalParent: string, stagedParent: string): void => {
    for (const item of list) {
      const title = item.title.trim();
      const name = physicalName(item, title);
      if (name === null) { issues.push({ code: "invalid-name", title }); continue; }
      const final = normalizePath(`${finalParent}/${name}`);
      if (claimed.has(final)) { issues.push({ code: "collision", path: final }); continue; }
      claimed.set(final, item.id);
      finalPath.set(item.id, final);
      /* Chemin stagé : un item EXISTANT garde son nom actuel (son
         renommage éventuel viendra plus tard) ; un brouillon prend son nom
         définitif, puisqu'il naît déjà nommé. */
      const stagedName = item.path ? item.path.slice(item.path.lastIndexOf("/") + 1) : name;
      const staged = normalizePath(`${stagedParent}/${stagedName}`);
      stagedPath.set(item.id, staged);
      project(item.children, final, staged);
    }
  };
  project(items, snapshot.rootPath, snapshot.rootPath);

  if (issues.length > 0) return { ok: false, issues };

  /* Collision avec un élément RÉEL du vault qui n'appartient pas au lot :
     un chemin projeté déjà occupé par un item du snapshot qui n'est pas
     celui qui le revendique. */
  for (const [path, itemId] of claimed) {
    const existing = snapshotByPath.get(path);
    if (!existing) continue;
    const owner = planItems.find((item) => item.id === itemId);
    if (owner?.path !== path) issues.push({ code: "collision", path });
  }

  if (issues.length > 0) return { ok: false, issues };

  /* ---- Émission des opérations, dans l'ordre imposé par §10 ----
     Toutes les opérations sont émises avec des chemins valides AU MOMENT
     DE LEUR EXÉCUTION ; `applyBinderMutationPlan` rebase ensuite les
     opérations restantes après chaque renommage/déplacement. */
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const drafts = planItems.filter(isPlanDraft);

  // 1. dossiers brouillons (pré-ordre : un parent précède ses descendants)
  for (const item of drafts) {
    if (draftCreates(item) !== "folder") continue;
    const path = stagedPath.get(item.id) as string;
    operations.push({ op: "create-folder", itemId: item.id, parentPath: parentOf(path), name: item.title.trim(), path });
  }
  // 2. feuillets brouillons
  for (const item of drafts) {
    if (draftCreates(item) !== "file") continue;
    const path = stagedPath.get(item.id) as string;
    operations.push({
      op: "create-file", itemId: item.id,
      parentPath: parentOf(path),
      fileName: safeBinderFileName(item.title), title: item.title.trim(), path,
    });
  }
  // 3. renommages de dossiers existants (§8 : le titre EST le nom physique)
  for (const item of planItems) {
    if (item.kind !== "folder" || !item.path) continue;
    const currentName = item.path.slice(item.path.lastIndexOf("/") + 1);
    if (currentName === item.title.trim()) continue;
    const staged = stagedPath.get(item.id) as string;
    operations.push({ op: "rename-folder", itemId: item.id, from: staged, to: normalizePath(`${parentOf(staged)}/${item.title.trim()}`) });
  }
  // 4. déplacements des items existants dont le parent change
  for (const item of planItems) {
    if (!item.path) continue;
    const staged = stagedPath.get(item.id) as string;
    const final = finalPath.get(item.id) as string;
    if (parentOf(item.path) === parentOf(final)) continue;
    const destination = findPlanParentId(items, item.id);
    const toParent = destination ? (stagedPath.get(destination) as string) : snapshot.rootPath;
    operations.push({ op: "move", itemId: item.id, from: staged, toParentPath: toParent });
  }
  // 5. `short_title` des feuillets existants dont le titre a changé (§8 :
  //    JAMAIS un renommage du Markdown)
  for (const item of planItems) {
    if (item.kind !== "file" || !item.path) continue;
    const existing = snapshotByPath.get(item.path);
    if (existing && existing.title !== item.title.trim()) {
      operations.push({
        op: "set-short-title", itemId: item.id, path: stagedPath.get(item.id) as string,
        title: item.title.trim(), previousTitle: existing.shortTitle,
      });
    }
  }
  // 6. ordres canoniques — noms FINAUX (à ce stade tout est renommé)
  const snapshotNames = (parentPath: string): string[] | undefined => {
    if (parentPath === snapshot.rootPath) return snapshot.children.map((item) => item.path.slice(item.path.lastIndexOf("/") + 1));
    const parent = snapshotByPath.get(parentPath);
    return parent?.children.map((item) => item.path.slice(item.path.lastIndexOf("/") + 1));
  };
  const emitOrders = (list: PlanItem[], stagedParent: string) => {
    if (list.length > 0) {
      operations.push({
        op: "order",
        parentPath: stagedParent,
        names: list.map((item) => {
          const path = finalPath.get(item.id) as string;
          return path.slice(path.lastIndexOf("/") + 1);
        }),
        previousNames: snapshotNames(stagedParent),
      });
    }
    for (const item of list) emitOrders(item.children, stagedPath.get(item.id) as string);
  };
  emitOrders(items, snapshot.rootPath);

  return { ok: true, plan: { operations } };
}

/* ================================================================
 * APPLY — §10 : exécution du lot, rollback best-effort
 * ================================================================ */

/** Primitives d'écriture injectées — TOUTES déjà existantes dans le plugin
 * (writeOrder/moveNode/renameFile/createFolder/createSheetFile) : ce module
 * ne réimplémente jamais une mutation Binder (§7). */
export type BinderWriter = {
  createFolder: (path: string) => Promise<void>;
  createSheet: (parentPath: string, fileName: string, title: string, position: number) => Promise<string>;
  renameFolder: (from: string, to: string) => Promise<void>;
  move: (fromPath: string, toParentPath: string) => Promise<void>;
  setShortTitle: (path: string, title: string) => Promise<void>;
  restoreShortTitle: (path: string, previousTitle: string | undefined) => Promise<void>;
  writeOrder: (parentPath: string, names: string[]) => Promise<void>;
  /** Suppression réservée AU SEUL rollback d'un élément que CE lot vient de
   * créer — jamais une suppression demandée par le Plan (§11). */
  deleteCreated: (path: string) => Promise<void>;
};

export type ApplyOutcome =
  | { ok: true; log: string[]; createdPaths: Map<string, string> }
  | { ok: false; failedAt: BinderOperation; error: string; log: string[]; rolledBack: boolean };

/** Exécute le lot déjà validé. En cas d'échec, annule en sens inverse au
 * mieux (§10) : seules les CRÉATIONS de ce lot sont défaites — jamais un
 * élément préexistant. `rolledBack: false` signale à l'appelant qu'il doit
 * prévenir l'autrice d'un état partiel. */
/** Reporte un renommage/déplacement sur les champs de chemin d'une
 * opération. Préfixe-sûr via `remapPath` (déjà éprouvé côté maintenance des
 * références) : chemin exact ou descendant `oldPath/…` uniquement — jamais
 * un voisin comme `oldPath-truc`. */
function rebaseOperation(operation: BinderOperation, oldPath: string, newPath: string): BinderOperation {
  const p = (value: string) => remapPath(value, oldPath, newPath);
  switch (operation.op) {
    case "create-folder":
      return { ...operation, parentPath: p(operation.parentPath), path: p(operation.path) };
    case "create-file":
      return { ...operation, parentPath: p(operation.parentPath), path: p(operation.path) };
    case "rename-folder":
      return { ...operation, from: p(operation.from), to: p(operation.to) };
    case "move":
      return { ...operation, from: p(operation.from), toParentPath: p(operation.toParentPath) };
    case "set-short-title":
      return { ...operation, path: p(operation.path) };
    case "order":
      return { ...operation, parentPath: p(operation.parentPath) };
  }
}

/** Exécute le lot déjà validé. En cas d'échec, annule en sens inverse au
 * mieux (§10) : seules les CRÉATIONS de ce lot sont défaites — jamais un
 * élément préexistant. `rolledBack: false` signale à l'appelant qu'il doit
 * prévenir l'autrice d'un état partiel.
 *
 * REBASE (§1) : dès qu'un dossier est renommé ou déplacé, TOUTES les
 * opérations encore en attente qui le désignaient — lui ou l'un de ses
 * descendants — sont réécrites sur son nouveau chemin. Sans cela, renommer
 * un dossier peuplé faisait échouer les opérations suivantes sur ses
 * enfants (« Item not found »), puisqu'elles pointaient encore l'ancien
 * chemin. */
export async function applyBinderMutationPlan(plan: BinderMutationPlan, writer: BinderWriter): Promise<ApplyOutcome> {
  const log: string[] = [];
  const createdPaths = new Map<string, string>();
  const undo: Array<() => Promise<void>> = [];
  const orderUndo: Array<() => Promise<void>> = [];
  const pending = [...plan.operations];

  const rebasePending = (from: number, oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    for (let index = from; index < pending.length; index += 1) {
      pending[index] = rebaseOperation(pending[index], oldPath, newPath);
    }
    log.push(`rebase ${oldPath} -> ${newPath}`);
  };

  for (let index = 0; index < pending.length; index += 1) {
    const operation = pending[index];
    try {
      switch (operation.op) {
        case "create-folder":
          await writer.createFolder(operation.path);
          createdPaths.set(operation.itemId, operation.path);
          undo.push(() => writer.deleteCreated(operation.path));
          log.push(`create-folder ${operation.path}`);
          break;
        case "create-file": {
          const created = await writer.createSheet(operation.parentPath, operation.fileName, operation.title, 1);
          createdPaths.set(operation.itemId, created);
          undo.push(() => writer.deleteCreated(created));
          log.push(`create-file ${created}`);
          break;
        }
        case "rename-folder":
          await writer.renameFolder(operation.from, operation.to);
          undo.push(() => writer.renameFolder(operation.to, operation.from));
          log.push(`rename-folder ${operation.from} -> ${operation.to}`);
          rebasePending(index + 1, operation.from, operation.to);
          break;
        case "move": {
          const previousParent = operation.from.slice(0, operation.from.lastIndexOf("/"));
          const name = operation.from.slice(operation.from.lastIndexOf("/") + 1);
          const destination = normalizePath(`${operation.toParentPath}/${name}`);
          await writer.move(operation.from, operation.toParentPath);
          undo.push(() => writer.move(destination, previousParent));
          log.push(`move ${operation.from} -> ${operation.toParentPath}`);
          rebasePending(index + 1, operation.from, destination);
          break;
        }
        case "set-short-title":
          await writer.setShortTitle(operation.path, operation.title);
          undo.push(() => writer.restoreShortTitle(operation.path, operation.previousTitle));
          log.push(`short-title ${operation.path}`);
          break;
        case "order":
          await writer.writeOrder(operation.parentPath, operation.names);
          if (operation.previousNames) {
            const previousNames = operation.previousNames;
            orderUndo.push(() => writer.writeOrder(operation.parentPath, previousNames));
          }
          log.push(`order ${operation.parentPath}`);
          break;
      }
    } catch (error) {
      let rolledBack = true;
      for (const step of [...undo].reverse()) {
        try { await step(); } catch { rolledBack = false; }
      }
      for (const step of [...orderUndo].reverse()) {
        try { await step(); } catch { rolledBack = false; }
      }
      return { ok: false, failedAt: operation, error: error instanceof Error ? error.message : String(error), log, rolledBack };
    }
  }
  return { ok: true, log, createdPaths };
}
