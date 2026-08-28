import { Menu, setIcon } from "obsidian";
import { t } from "../i18n/index.js";
import {
  appendPlanChild,
  canAcceptChildren,
  createDraft,
  isPlanDraft,
  findPlanItem,
  indentPlanItem,
  insertPlanSiblingAfter,
  movePlanBranch,
  movePlanItemWithinSiblings,
  outdentPlanItem,
  removePlanDraft,
  setPlanItemTitle,
  togglePlanItemCollapsed,
  type PlanDrop,
  type PlanItem,
} from "../carnet/blocks/plan/model.js";

/** Renderer du Plan (Prompt 3/5, §5) — DOM pur.
 *
 * Il ne connaît ni le vault, ni le Canvas, ni le Binder : il reçoit un
 * `PlanItem[]` et rend `onChange` à chaque édition (§7 : le renderer ne
 * touche jamais au vault). Toute la logique d'arbre vient du modèle pur —
 * ce fichier ne réimplémente aucune règle de structure. */

export type PlanRendererContext = {
  host: HTMLElement;
  items: PlanItem[];
  dirty: boolean;
  /** Ligne dont le titre doit entrer en édition au prochain rendu — one-shot. */
  activeRowId?: string;
  editRowId?: string;
  /** Le Plan est-il éditable ? Faux pour un Carnet hors périmètre (§2). */
  editable: boolean;
  onChange: (items: PlanItem[], editRowId?: string) => void;
  onUiStateChange?: (activeRowId: string | undefined, editRowId: string | undefined) => void;
  onRefresh: () => void;
  onApply: () => void;
};

const stop = (event: Event) => event.stopPropagation();
const isInputTarget = (target: EventTarget | null): boolean =>
  !!target && typeof target === "object" && "tagName" in target
  && (target as { tagName?: string }).tagName === "INPUT";
const ROW_INDENT = 19;

export function renderBinderPlanOutliner(context: PlanRendererContext): void {
  const { host, items, dirty, editable, activeRowId: initialActiveRowId, editRowId } = context;
  let activeRowId = initialActiveRowId;
  let currentEditRowId = editRowId;
  host.empty();
  const root = host.createDiv({ cls: "feuillets-plan-outliner" });

  /* ---- En-tête : titre, pastille « modifié », actions ---- */
  /* L'en-tête est la POIGNÉE de déplacement de la carte : il laisse
     délibérément passer pointerdown/mousedown jusqu'au Canvas, qui s'en
     sert pour déplacer le node. Seul le double-clic est retenu, sinon le
     Canvas basculerait le TextNode en édition de son texte brut. */
  const header = root.createDiv({ cls: "feuillets-plan-header" });
  header.addEventListener("dblclick", stop);
  header.createSpan({ cls: "feuillets-plan-title-label", text: t("plan.title") });
  if (dirty) header.createSpan({ cls: "feuillets-plan-dirty", attr: { "aria-label": t("plan.dirty") }, text: "•" });
  const actions = header.createDiv({ cls: "feuillets-plan-actions" });

  /* §2 — le FOND du header reste la poignée Canvas (voir plus bas), mais
     chaque bouton doit rester utilisable : pointerdown/mousedown/click/
     dblclick sont tous stoppés pour ne jamais atteindre le header (qui les
     laisse filer exprès), sans jamais `preventDefault()` — le focus et le
     clic natifs du `<button>` doivent continuer de fonctionner tels quels. */
  const iconButton = (icon: string, label: string, action: (event: MouseEvent) => void, disabled = false) => {
    const button = actions.createEl("button", { attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("pointerdown", stop);
    button.addEventListener("mousedown", stop);
    button.addEventListener("dblclick", stop);
    button.addEventListener("click", (event: MouseEvent) => { stop(event); if (!button.disabled) action(event); });
    return button;
  };
  /* §4 — création EXPLICITE : plus aucune ambiguïté sur ce qu'on ajoute. */
  const addDraft = (kind: "draft-folder" | "draft-file", anchorId?: string, asChild = false) => {
    const draft = createDraft(kind);
    const next = anchorId
      ? (asChild ? appendPlanChild(items, anchorId, draft) : insertPlanSiblingAfter(items, anchorId, draft))
      : [...items, draft];
    if (next !== items) context.onChange(next, draft.id);
  };
  iconButton("plus", t("plan.action.add"), (event) => {
    const menu = new Menu();
    menu.addItem((entry) => entry.setTitle(t("plan.action.newSheet")).setIcon("file-plus").onClick(() => addDraft("draft-file")));
    menu.addItem((entry) => entry.setTitle(t("plan.action.newFolder")).setIcon("folder-plus").onClick(() => addDraft("draft-folder")));
    /* Le VRAI événement de clic, jamais un `new MouseEvent` fabriqué : le
       menu s'ouvre ainsi sous le curseur et non en (0,0). */
    menu.showAtMouseEvent(event);
  }, !editable);
  iconButton("refresh-cw", t("plan.action.refresh"), () => context.onRefresh(), !editable);
  iconButton("check", t("plan.action.apply"), () => context.onApply(), !editable || !dirty);

  const tree = root.createDiv({ cls: "feuillets-plan-tree-scroll" });
  if (!editable) {
    tree.createDiv({ cls: "feuillets-plan-empty", text: t("plan.unavailable") });
    return;
  }
  if (items.length === 0) tree.createDiv({ cls: "feuillets-plan-empty", text: t("plan.empty") });

  /* ---- Drag : toute la ligne est saisissable (§5), jamais une poignée ---- */
  let drag: { id: string; startX: number; startY: number; active: boolean; target?: string; drop?: PlanDrop } | null = null;
  const clearDropMarks = () => {
    tree.querySelectorAll(".is-dragging,.drop-before,.drop-after,.drop-inside").forEach((element) => {
      element.removeClass("is-dragging"); element.removeClass("drop-before");
      element.removeClass("drop-after"); element.removeClass("drop-inside");
    });
  };

  const updateDropTarget = (event: PointerEvent) => {
    if (!drag) return;
    const rows = Array.from(tree.querySelectorAll<HTMLElement>(".feuillets-plan-row"));
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const id = row.dataset.planId || "";
      if (id === drag.id) continue;
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - event.clientY);
      if (distance < bestDistance) { bestDistance = distance; best = row; }
    }
    if (!best) return;
    const target = findPlanItem(items, best.dataset.planId || "");
    if (!target) return;
    const rect = best.getBoundingClientRect();
    const upper = event.clientY < rect.top + rect.height * 0.3;
    const lower = event.clientY > rect.bottom - rect.height * 0.3;
    /* Centre d'un dossier/draft = dépôt DEDANS (§5) ; un fichier existant
       n'accepte jamais d'enfant, on retombe alors sur avant/après. */
    const drop: PlanDrop = !upper && !lower && canAcceptChildren(target) ? "inside" : upper ? "before" : "after";
    clearDropMarks();
    best.addClass(`drop-${drop}`);
    drag.target = target.id;
    drag.drop = drop;
    // Auto-scroll aux bords (§5).
    const bounds = tree.getBoundingClientRect();
    if (event.clientY < bounds.top + 32) tree.scrollTop -= 12;
    if (event.clientY > bounds.bottom - 32) tree.scrollTop += 12;
  };

  const drawRows = (list: PlanItem[], depth: number) => {
    for (const item of list) {
      const row = tree.createDiv({ cls: `feuillets-plan-row is-${item.kind}` });
      row.dataset.planId = item.id;
      row.tabIndex = 0;
      row.style.setProperty("--feuillets-plan-depth", String(depth));
      row.style.paddingLeft = `${depth * ROW_INDENT}px`;

      /* Chevron : présent SEULEMENT si la ligne a des enfants (§5). Sinon
         une cale de même largeur garde les colonnes alignées. */
      if (item.children.length > 0) {
        const toggle = row.createEl("button", {
          cls: "feuillets-plan-toggle",
          attr: { "aria-label": t(item.collapsed ? "plan.expand" : "plan.collapse") },
        });
        setIcon(toggle, item.collapsed ? "chevron-right" : "chevron-down");
        toggle.addEventListener("pointerdown", stop);
        toggle.addEventListener("click", (event) => {
          stop(event);
          context.onChange(togglePlanItemCollapsed(items, item.id));
        });
      } else {
        row.createSpan({ cls: "feuillets-plan-toggle-space" });
      }

      const icon = row.createSpan({ cls: "feuillets-plan-kind" });
      setIcon(icon, canAcceptChildren(item) ? "folder" : "file-text");

      /* §3 — VRAI OUTLINER : au repos, le titre est un simple texte, sans
         bordure ni fond ; l'`<input>` n'apparaît qu'à l'édition. La version
         précédente affichait en permanence un champ encadré, d'où
         l'impression d'un formulaire plutôt que d'un plan. */
      const title = row.createSpan({ cls: "feuillets-plan-title", text: item.title || t("plan.untitled") });
      if (!item.title) title.addClass("is-placeholder");
      const activateRow = () => {
        tree.querySelectorAll(".feuillets-plan-row.is-active").forEach((active) => active.removeClass("is-active"));
        row.addClass("is-active");
        activeRowId = item.id;
        context.onUiStateChange?.(activeRowId, currentEditRowId);
        row.focus();
      };

      if (activeRowId === item.id) row.addClass("is-active");

      /* §5/§6 — édition inline. `closed` garde l'invariant central : une
         session d'édition ne se termine qu'UNE fois. Retirer un `<input>`
         focalisé peut faire remonter un `blur` ; sans ce verrou, Échap
         validait le texte qu'il devait justement annuler, et Entrée/Tab
         créaient un second changement à partir d'items périmés. */
      const beginEdit = () => {
        if (row.querySelector("input")) return;
        title.hide();
        const input = row.createEl("input", {
          cls: "feuillets-plan-title-input",
          attr: { type: "text", "aria-label": t("plan.titleField") },
        });
        input.value = item.title;
        input.addEventListener("pointerdown", stop);
        input.addEventListener("click", stop);
        let closed = false;
        /* Ferme le champ et rend la main à la LIGNE, qui reste active :
           `editRowId` retombe à `undefined` (one-shot, §6) tandis que
           `activeRowId` survit au rerendu. */
        const closeEdit = (): boolean => {
          if (closed) return false;
          closed = true;
          input.remove();
          title.show();
          currentEditRowId = undefined;
          context.onUiStateChange?.(item.id, undefined);
          activateRow();
          return true;
        };
        /* Blur = validation (§5) : le titre saisi est conservé, l'input se
           ferme, et rien ne le rouvre. */
        const commit = () => {
          const value = input.value;
          const changed = value !== item.title;
          if (!closeEdit()) return;
          if (changed) context.onChange(setPlanItemTitle(items, item.id, value));
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (event: KeyboardEvent) => {
          stop(event);
          const commitTitle = (next: PlanItem[]): PlanItem[] =>
            input.value !== item.title ? setPlanItemTitle(next, item.id, input.value) : next;

          /* Échap : annulation. Le titre précédent est restauré (aucun
             commit), le champ se ferme AUSSITÔT, la ligne reste active —
             une seule frappe suffit, le `blur` induit ne rejouant rien. */
          if (event.key === "Escape") {
            event.preventDefault();
            closeEdit();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            /* Contrat FILE/FOLDER : sur un FICHIER, Entrée crée un FRÈRE
               (feuillet, ou dossier avec Cmd/Ctrl) — la ligne reste seule.
               Sur un DOSSIER, la même touche crée un ENFANT : c'est la
               seule façon de peupler un dossier au clavier, jamais un
               frère qui laisserait le dossier vide. Aucun conflit avec
               Obsidian : l'événement ne quitte jamais le champ. */
            const kind: "draft-folder" | "draft-file" = event.metaKey || event.ctrlKey ? "draft-folder" : "draft-file";
            const draft = createDraft(kind);
            const withTitle = commitTitle(items);
            const next = canAcceptChildren(item)
              ? appendPlanChild(withTitle, item.id, draft)
              : insertPlanSiblingAfter(withTitle, item.id, draft);
            closed = true;
            activeRowId = draft.id;
            currentEditRowId = draft.id;
            context.onUiStateChange?.(draft.id, draft.id);
            context.onChange(next, draft.id);
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            const withTitle = commitTitle(items);
            closed = true;
            context.onUiStateChange?.(item.id, undefined);
            context.onChange(event.shiftKey ? outdentPlanItem(withTitle, item.id) : indentPlanItem(withTitle, item.id));
            return;
          }
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            const withTitle = commitTitle(items);
            closed = true;
            context.onUiStateChange?.(item.id, undefined);
            context.onChange(movePlanItemWithinSiblings(withTitle, item.id, event.key === "ArrowUp" ? -1 : 1));
            return;
          }
          if ((event.key === "Backspace" || event.key === "Delete") && isPlanDraft(item) && input.value === "") {
            event.preventDefault();
            closed = true;
            context.onChange(removePlanDraft(items, item.id));
          }
        });
        input.focus();
        input.select();
      };
      title.addEventListener("click", (event) => { stop(event); activateRow(); currentEditRowId = item.id; context.onUiStateChange?.(item.id, item.id); beginEdit(); });
      if (editRowId === item.id) window.setTimeout(beginEdit, 0);
      else if (activeRowId === item.id) window.setTimeout(() => row.focus(), 0);

      row.addEventListener("keydown", (event: KeyboardEvent) => {
        const isEnter = event.key === "Enter";
        const isTab = event.key === "Tab";
        const isAltMove = event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
        if (!isEnter && !isTab && !isAltMove) return;
        event.preventDefault();
        stop(event);
        if (isEnter) {
          /* Même contrat FILE/FOLDER que dans l'édition (ci-dessus) : un
             dossier reçoit un enfant, un feuillet reçoit un frère. */
          const kind: "draft-folder" | "draft-file" = event.metaKey || event.ctrlKey ? "draft-folder" : "draft-file";
          const draft = createDraft(kind);
          const next = canAcceptChildren(item)
            ? appendPlanChild(items, item.id, draft)
            : insertPlanSiblingAfter(items, item.id, draft);
          activeRowId = draft.id;
          context.onUiStateChange?.(draft.id, draft.id);
          context.onChange(next, draft.id);
          return;
        }
        context.onUiStateChange?.(item.id, undefined);
        const next = isTab
          ? event.shiftKey ? outdentPlanItem(items, item.id) : indentPlanItem(items, item.id)
          : movePlanItemWithinSiblings(items, item.id, event.key === "ArrowUp" ? -1 : 1);
        context.onChange(next);
      });

      /* Correctif clic droit (2/3) : `event.button === 0` uniquement peut
         activer la ligne. Pour un bouton secondaire : `stopPropagation()`
         (jamais `preventDefault()`, sinon le `contextmenu` natif qui suit
         perdrait sa position réelle), aucun focus ni activation. */
      row.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.button !== 0) { stop(event); return; }
        if (isInputTarget(event.target)) return;
        activateRow();
      }, { capture: true });

      /* §4 — menu contextuel : créer avant/après ou en enfant. « Enfant »
         n'est proposé que si la ligne peut réellement en accueillir.
         Le clic droit ne doit JAMAIS laisser une intention de drag armée
         par le pointerdown secondaire qui le précède toujours (bouton
         droit) : on l'annule explicitement ici, avant d'ouvrir le menu. */
      row.addEventListener("contextmenu", (event: MouseEvent) => {
        event.preventDefault();
        stop(event);
        drag = null;
        clearDropMarks();
        const menu = new Menu();
        menu.addItem((entry) => entry.setTitle(t("plan.action.newSheetAfter")).setIcon("file-plus").onClick(() => addDraft("draft-file", item.id)));
        menu.addItem((entry) => entry.setTitle(t("plan.action.newFolderAfter")).setIcon("folder-plus").onClick(() => addDraft("draft-folder", item.id)));
        if (canAcceptChildren(item)) {
          menu.addSeparator();
          menu.addItem((entry) => entry.setTitle(t("plan.action.newSheetInside")).setIcon("file-plus").onClick(() => addDraft("draft-file", item.id, true)));
          menu.addItem((entry) => entry.setTitle(t("plan.action.newFolderInside")).setIcon("folder-plus").onClick(() => addDraft("draft-folder", item.id, true)));
        }
        if (isPlanDraft(item)) {
          menu.addSeparator();
          menu.addItem((entry) => entry.setTitle(t("plan.action.removeDraft")).setIcon("trash").onClick(() => context.onChange(removePlanDraft(items, item.id))));
        }
        menu.showAtMouseEvent(event);
      });

      /* Toute la ligne est draggable (§5) — le drag ne démarre qu'après un
         seuil, pour ne jamais voler un simple clic dans le champ titre.
         Bouton PRINCIPAL uniquement (`button === 0`) : un clic droit ou
         milieu ne doit jamais armer de drag — sinon un clic droit suivi
         d'un léger tremblement de la souris (courant avant l'ouverture
         d'un menu contextuel) déplacerait la branche au lieu d'ouvrir le
         menu.
         Correctif clic droit (1/3) : un bouton secondaire stoppe malgré
         tout la propagation de CE `pointerdown` — `stopPropagation()`
         n'affecte jamais le `contextmenu`, un événement entièrement
         séparé, émis indépendamment au relâchement du bouton droit. Ne
         plus stopper ici laissait le pointerdown secondaire remonter vers
         Canvas, qui pouvait alors amorcer un déplacement du node entier. */
      row.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.button !== 0) { stop(event); return; }
        if (isInputTarget(event.target)) return;
        stop(event);
        drag = { id: item.id, startX: event.clientX, startY: event.clientY, active: false };
      });

      if (!item.collapsed) drawRows(item.children, depth + 1);
    }
  };

  /* CORRECTIF ERGONOMIE — on ne bloque PLUS pointerdown/mousedown/click au
     niveau de l'arbre. Le prototype les stoppait tous, ce qui rendait la
     carte impossible à déplacer sur le Canvas : plus aucun pointerdown ne
     lui parvenait. Seules les LIGNES stoppent l'événement (elles ont leur
     propre drag de réorganisation) ; le fond de l'arbre et l'en-tête le
     laissent filer, si bien qu'on saisit la carte n'importe où sauf sur une
     ligne. Restent retenus : le double-clic (sinon le Canvas passe le
     TextNode en édition brute) et la molette (sinon la liste zoome le
     Canvas au lieu de défiler). */
  tree.addEventListener("pointerdown", stop);
  tree.addEventListener("mousedown", stop);
  tree.addEventListener("click", stop);
  tree.addEventListener("dblclick", stop);
  /* Correctif clic droit (3/3) — EN PLUS du stop bubble ci-dessus (qui
     couvre déjà le bouton principal une fois l'événement redescendu
     jusqu'aux lignes) : deux écouteurs CAPTURE sur `tree` arrêtent tout
     pointerdown/mousedown SECONDAIRE avant même qu'il atteigne une ligne.
     Nécessaire si le déplacement natif du node Canvas écoute plus haut
     dans l'arbre DOM en phase de capture — dans ce cas, seul un stop posé
     AU MOINS AUSSI HAUT QUE `tree`, en capture, peut l'intercepter avant
     lui. Jamais de `preventDefault()` : le `contextmenu` séparé qui suit
     continue d'être émis normalement. */
  const stopSecondaryButton = (event: MouseEvent) => { if (event.button !== 0) event.stopPropagation(); };
  tree.addEventListener("pointerdown", stopSecondaryButton, { capture: true });
  tree.addEventListener("mousedown", stopSecondaryButton, { capture: true });
  tree.addEventListener("wheel", (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) stop(event); });
  tree.addEventListener("pointermove", (event: PointerEvent) => {
    if (!drag) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.active = true;
      tree.setPointerCapture(event.pointerId);
      tree.querySelector<HTMLElement>(`.feuillets-plan-row[data-plan-id="${drag.id}"]`)?.addClass("is-dragging");
    }
    if (drag.active) updateDropTarget(event);
  });
  tree.addEventListener("pointerup", (event: PointerEvent) => {
    if (!drag) return;
    stop(event);
    const activeDrag = drag;
    const bounds = tree.getBoundingClientRect();
    const isInsideTree = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    clearDropMarks();
    drag = null;
    if (activeDrag.active && isInsideTree && activeDrag.target && activeDrag.drop) {
      const next = movePlanBranch(items, activeDrag.id, activeDrag.target, activeDrag.drop);
      if (next !== items) context.onChange(next, activeDrag.id);
    }
  });
  tree.addEventListener("pointercancel", (event: PointerEvent) => {
    if (!drag) return;
    stop(event);
    clearDropMarks();
    drag = null;
  });
  drawRows(items, 0);
}
