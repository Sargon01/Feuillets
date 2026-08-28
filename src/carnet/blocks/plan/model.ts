/** Modèle PUR du Plan (Prompt 3/5) — brouillon hiérarchique du Binder.
 *
 * INVARIANT CENTRAL : l'identité d'une ligne est son `id` (UUID stable),
 * JAMAIS son `path`. Un item peut changer de chemin (renommage, déplacement)
 * sans perdre son identité — c'est ce qui permet de préserver repli,
 * sélection et correspondance après un Actualiser ou un Appliquer. Le
 * prototype précédent utilisait `path` comme id, ce qui rendait toute
 * reconstruction destructrice.
 *
 * Aucune E/S, aucune connaissance du vault ni du Canvas : ce module ne
 * manipule que des structures en mémoire. Toutes les opérations sont
 * IMMUTABLES (retournent un nouvel arbre) et retournent l'arbre d'origine
 * inchangé — par identité de référence — quand l'opération est refusée, ce
 * qui donne à l'appelant un test « a-t-il changé ? » gratuit. */

export type PlanItemKind = "folder" | "file" | "draft-folder" | "draft-file";

export type PlanItem = {
  id: string;
  kind: PlanItemKind;
  title: string;
  /** Chemin vault réel — présent SI ET SEULEMENT SI l'item existe déjà sur
   * le disque. Un brouillon n'en a jamais (§3). */
  path?: string;
  collapsed: boolean;
  children: PlanItem[];
};

export type PlanDrop = "before" | "after" | "inside";

/** Genre EXPLICITE (§2) : la nature d'un brouillon est choisie à sa
 * création, jamais déduite de la présence d'enfants. Un `draft-folder`
 * vide reste un dossier ; un `draft-file` n'accueille jamais d'enfant, pas
 * plus qu'un `file` existant. */
export function canAcceptChildren(item: PlanItem): boolean {
  return item.kind === "folder" || item.kind === "draft-folder";
}

export function isPlanDraft(item: PlanItem): boolean {
  return item.kind === "draft-folder" || item.kind === "draft-file";
}

/** Ce qu'un brouillon créera à l'Apply — lecture directe de son genre,
 * plus aucune conversion implicite. */
export function draftCreates(item: PlanItem): "folder" | "file" | null {
  if (item.kind === "draft-folder") return "folder";
  if (item.kind === "draft-file") return "file";
  return null;
}

export function createDraft(kind: "draft-folder" | "draft-file" = "draft-file", title = "", id: string = crypto.randomUUID()): PlanItem {
  return { id, kind, title, collapsed: false, children: [] };
}

export function findPlanItem(items: PlanItem[], id: string): PlanItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const found = findPlanItem(item.children, id);
    if (found) return found;
  }
  return null;
}

/** Parent d'un item, ou `null` s'il est à la racine (ou introuvable). */
export function findPlanParent(items: PlanItem[], id: string): PlanItem | null {
  for (const item of items) {
    if (item.children.some((child) => child.id === id)) return item;
    const found = findPlanParent(item.children, id);
    if (found) return found;
  }
  return null;
}

/** `true` si `candidateId` est `ancestorId` lui-même ou l'un de ses
 * descendants — LA garde anti-cycle du module (§3). */
export function isPlanDescendant(items: PlanItem[], ancestorId: string, candidateId: string): boolean {
  const ancestor = findPlanItem(items, ancestorId);
  if (!ancestor) return false;
  const walk = (item: PlanItem): boolean =>
    item.id === candidateId || item.children.some(walk);
  return walk(ancestor);
}

/** Tous les items en pré-ordre — utile pour les parcours de validation. */
export function flattenPlan(items: PlanItem[]): PlanItem[] {
  return items.flatMap((item) => [item, ...flattenPlan(item.children)]);
}

/** Applique `mutate` à l'item `id` partout où il se trouve, en recopiant
 * uniquement la branche traversée. Retourne l'arbre d'origine (même
 * référence) si `id` est introuvable. */
function mapPlanItem(items: PlanItem[], id: string, mutate: (item: PlanItem) => PlanItem): PlanItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.id === id) { changed = true; return mutate(item); }
    const children = mapPlanItem(item.children, id, mutate);
    if (children !== item.children) { changed = true; return { ...item, children }; }
    return item;
  });
  return changed ? next : items;
}

export function setPlanItemTitle(items: PlanItem[], id: string, title: string): PlanItem[] {
  return mapPlanItem(items, id, (item) => (item.title === title ? item : { ...item, title }));
}

export function togglePlanItemCollapsed(items: PlanItem[], id: string): PlanItem[] {
  return mapPlanItem(items, id, (item) => ({ ...item, collapsed: !item.collapsed }));
}

export function setPlanItemCollapsed(items: PlanItem[], id: string, collapsed: boolean): PlanItem[] {
  return mapPlanItem(items, id, (item) => (item.collapsed === collapsed ? item : { ...item, collapsed }));
}

/** Retire un item et le retourne. `removed: null` si introuvable. */
export function removePlanItem(items: PlanItem[], id: string): { items: PlanItem[]; removed: PlanItem | null } {
  let removed: PlanItem | null = null;
  const walk = (list: PlanItem[]): PlanItem[] =>
    list.flatMap((item) => {
      if (item.id === id) { removed = item; return []; }
      const children = walk(item.children);
      return children === item.children ? [item] : [{ ...item, children }];
    });
  const next = walk(items);
  return removed ? { items: next, removed } : { items, removed: null };
}

/** Suppression AUTORISÉE uniquement pour un draft (§5/§11) : le Plan V1 ne
 * supprime jamais un fichier ou un dossier réel. Un draft porteur d'enfants
 * réels ne peut pas non plus disparaître — il emporterait ces items hors du
 * Plan, ce que le preflight interpréterait comme une suppression implicite. */
export function removePlanDraft(items: PlanItem[], id: string): PlanItem[] {
  const item = findPlanItem(items, id);
  if (!item || !isPlanDraft(item)) return items;
  if (flattenPlan(item.children).some((child) => !isPlanDraft(child))) return items;
  return removePlanItem(items, id).items;
}

/** Insère `newItem` juste après `afterId`, dans la même fratrie (Entrée). */
export function insertPlanSiblingAfter(items: PlanItem[], afterId: string, newItem: PlanItem): PlanItem[] {
  let inserted = false;
  const walk = (list: PlanItem[]): PlanItem[] => {
    const index = list.findIndex((item) => item.id === afterId);
    if (index >= 0) {
      inserted = true;
      return [...list.slice(0, index + 1), newItem, ...list.slice(index + 1)];
    }
    let changed = false;
    const next = list.map((item) => {
      const children = walk(item.children);
      if (children !== item.children) { changed = true; return { ...item, children }; }
      return item;
    });
    return changed ? next : list;
  };
  const next = walk(items);
  return inserted ? next : items;
}

/** Ajoute `newItem` comme dernier enfant de `parentId` — refusé si le
 * parent ne peut pas accueillir d'enfants (fichier existant). */
export function appendPlanChild(items: PlanItem[], parentId: string, newItem: PlanItem): PlanItem[] {
  const parent = findPlanItem(items, parentId);
  if (!parent || !canAcceptChildren(parent)) return items;
  return mapPlanItem(items, parentId, (item) => ({ ...item, collapsed: false, children: [...item.children, newItem] }));
}

/** Tab : indente sous le frère PRÉCÉDENT immédiat, si celui-ci peut
 * accueillir des enfants. Refus (arbre inchangé) sinon — notamment en tête
 * de fratrie ou sous un fichier existant. */
export function indentPlanItem(items: PlanItem[], id: string): PlanItem[] {
  const walk = (list: PlanItem[]): PlanItem[] => {
    const index = list.findIndex((item) => item.id === id);
    if (index > 0) {
      const previous = list[index - 1];
      if (!canAcceptChildren(previous)) return list;
      const moved = list[index];
      return [
        ...list.slice(0, index - 1),
        { ...previous, collapsed: false, children: [...previous.children, moved] },
        ...list.slice(index + 1),
      ];
    }
    if (index === 0) return list; // premier de sa fratrie : rien à indenter sous.
    let changed = false;
    const next = list.map((item) => {
      const children = walk(item.children);
      if (children !== item.children) { changed = true; return { ...item, children }; }
      return item;
    });
    return changed ? next : list;
  };
  return walk(items);
}

/** Shift+Tab : remonte l'item d'un niveau, juste après son ancien parent.
 * Refus (arbre inchangé) si l'item est déjà à la racine. */
export function outdentPlanItem(items: PlanItem[], id: string): PlanItem[] {
  const walk = (list: PlanItem[]): PlanItem[] => {
    for (let index = 0; index < list.length; index += 1) {
      const parent = list[index];
      const childIndex = parent.children.findIndex((child) => child.id === id);
      if (childIndex >= 0) {
        const moved = parent.children[childIndex];
        const trimmed = { ...parent, children: parent.children.filter((child) => child.id !== id) };
        return [...list.slice(0, index), trimmed, moved, ...list.slice(index + 1)];
      }
      const children = walk(parent.children);
      if (children !== parent.children) {
        return list.map((item, itemIndex) => (itemIndex === index ? { ...parent, children } : item));
      }
    }
    return list;
  };
  return walk(items);
}

/** Option/Alt + ↑/↓ : déplace l'item (et toute sa branche) dans sa PROPRE
 * fratrie uniquement — jamais de changement de parent, qui reste réservé à
 * Tab/Shift+Tab et au drag. Refus aux extrémités. */
export function movePlanItemWithinSiblings(items: PlanItem[], id: string, direction: -1 | 1): PlanItem[] {
  const walk = (list: PlanItem[]): PlanItem[] => {
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) {
      const target = index + direction;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    }
    let changed = false;
    const next = list.map((item) => {
      const children = walk(item.children);
      if (children !== item.children) { changed = true; return { ...item, children }; }
      return item;
    });
    return changed ? next : list;
  };
  return walk(items);
}

/** Drag : un déplacement est valide si source et cible existent, sont
 * distinctes, si la cible n'est pas un descendant de la source (anti-cycle)
 * et si un dépôt `inside` vise un item capable d'accueillir des enfants. */
export function canMovePlanBranch(items: PlanItem[], sourceId: string, targetId: string, drop: PlanDrop): boolean {
  if (sourceId === targetId) return false;
  const source = findPlanItem(items, sourceId);
  const target = findPlanItem(items, targetId);
  if (!source || !target) return false;
  if (isPlanDescendant(items, sourceId, targetId)) return false;
  if (drop === "inside") return canAcceptChildren(target);
  /* `before`/`after` déposent dans la fratrie de la cible : ce parent-là
     doit lui aussi pouvoir accueillir un enfant. À la racine, aucun parent
     à contrôler. */
  const parent = findPlanParent(items, targetId);
  return !parent || canAcceptChildren(parent);
}

/** Déplace la branche ENTIÈRE (l'item et tous ses descendants suivent, ils
 * ne sont jamais dissociés). Retourne l'arbre inchangé si le déplacement
 * est refusé par `canMovePlanBranch`. */
export function movePlanBranch(items: PlanItem[], sourceId: string, targetId: string, drop: PlanDrop): PlanItem[] {
  if (!canMovePlanBranch(items, sourceId, targetId, drop)) return items;
  const { items: without, removed } = removePlanItem(items, sourceId);
  if (!removed) return items;
  const branch = removed;
  const insert = (list: PlanItem[]): PlanItem[] =>
    list.flatMap((item) => {
      if (item.id === targetId) {
        if (drop === "inside") return [{ ...item, collapsed: false, children: [...item.children, branch] }];
        return drop === "before" ? [branch, item] : [item, branch];
      }
      const children = insert(item.children);
      return children === item.children ? [item] : [{ ...item, children }];
    });
  return insert(without);
}
