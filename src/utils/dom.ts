import { setIcon } from "obsidian";
import type { App, TFile, WorkspaceLeaf } from "obsidian";

type ObsidianElement = HTMLElement & {
  createDiv(options: { cls: string }): ObsidianElement;
  createSpan(options: { cls: string }): ObsidianElement;
  createEl(tag: string, options: { cls: string }): ObsidianElement;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  addEventListener(type: string, callback: (event: MouseEvent) => void | Promise<void>): void;
  querySelectorAll(selector: string): NodeListOf<ObsidianElement>;
  removeClass(name: string): void;
  addClass(name: string): void;
  scrollIntoView(options: ScrollIntoViewOptions): void;
};

type CollapsibleSettings = { collapsed: Record<string, boolean> };

/** Construit l'en-tête d'une section repliable (div section + head + chevron
 * + titre + icône/bouton optionnels + clic qui bascule l'état replié) et la
 * retourne pour que l'appelant y ajoute son propre contenu. `collapsed` et la
 * logique de calcul du repli restent à la charge de l'appelant (ex. la vue
 * Recherche force l'ouverture des sections pendant une recherche active). */
export function renderCollapsibleHead(container: ObsidianElement, {
  classes,
  title,
  icon,
  collapsed,
  collapseKey,
  settings,
  onToggle,
  onCreate,
}: {
  classes: { section: string; head: string; icon: string; title: string };
  title: string;
  icon?: string;
  collapsed: boolean;
  collapseKey: string;
  settings: CollapsibleSettings;
  onToggle: () => void | Promise<void>;
  onCreate?: () => void;
}) {
  const section = container.createDiv({ cls: classes.section });
  const head = section.createDiv({ cls: classes.head });

  if (icon) {
    const iconSpan = head.createSpan({ cls: classes.icon });
    setIcon(iconSpan, icon);
  }

  head.createSpan({ cls: classes.title }).setText(title);

  if (onCreate) {
    const addBtn = head.createEl("button", { cls: "clickable-icon" });
    setIcon(addBtn, "plus");
    addBtn.setAttr("aria-label", `Créer une fiche ${title.toLowerCase()}`);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onCreate();
    });
  }

  head.addEventListener("click", async () => {
    if (collapsed) delete settings.collapsed[collapseKey];
    else settings.collapsed[collapseKey] = true;
    await onToggle();
  });

  return { section, head };
}

export function iconBtn(parent: ObsidianElement, icon: string, tooltip: string, onClick?: (event: MouseEvent) => void) {
  const btn = parent.createEl("button", { cls: "clickable-icon" });
  setIcon(btn, icon);
  btn.setAttr("aria-label", tooltip);
  btn.setAttr("title", tooltip);
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

export function highlightActive(rootEl: ObsidianElement | null, activePath: string | null | undefined) {
  if (!rootEl) return;
  rootEl
    .querySelectorAll(".is-active, .feuillets-dragover, .feuillets-dragging")
    .forEach((el) => {
      el.removeClass("is-active");
      el.removeClass("feuillets-dragover");
      el.removeClass("feuillets-dragging");
    });
  if (!activePath) return;
  rootEl
    .querySelectorAll(`[data-path="${CSS.escape(activePath)}"]`)
    .forEach((el) => {
      el.addClass("is-active");
      /* Révèle la scène active dans le Binder quand on y arrive par un
         lien interne, la palette de commandes ou "Feuillet suivant/
         précédent" — pas seulement par un clic direct dans la liste,
         qui la montre déjà forcément. "nearest" : ne bouge rien si déjà
         visible, pas de scroll parasite à chaque changement de fichier. */
      el.scrollIntoView({ block: "nearest" });
    });
}

export function isEditing(rootEl: ObsidianElement) {
  const a = document.activeElement;
  return a && rootEl.contains(a) && ["TEXTAREA", "INPUT"].includes(a.tagName);
}

/** Ouvre un fichier dans `leaf` en la rendant explicitement active pour
 * Obsidian. `leaf.openFile()` seul ne suffit pas : sans activation
 * explicite, l'événement "file-open" — dont dépendent les panneaux Notes
 * et Progression ainsi que le panneau Propriétés natif d'Obsidian — ne se
 * déclenche pas pour une feuille simplement révélée mais pas "active". */
export function openFileActivating(app: App, leaf: WorkspaceLeaf, file: TFile) {
  leaf.openFile(file, { active: true });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

export function getActiveFileSafe(app: App) {
  // 1. Tenter via le fichier actif du workspace (très fiable si un onglet d'écriture est actif)
  const active = app.workspace.getActiveFile();
  if (active) return active;

  /* 2. Tenter via la feuille la plus récemment active (très utile quand le
     focus est dans la barre latérale) — remplace l'ancien recours à
     `workspace.activeLeaf`, déprécié par l'API Obsidian ; getMostRecentLeaf
     couvre le même besoin sans dépendre d'une propriété retirée. */
  const recentLeaf = app.workspace.getMostRecentLeaf();
  const recentFile = recentLeaf && (recentLeaf.view as { file?: TFile }).file;
  if (recentFile) {
    return recentFile;
  }

  // 3. Repli sur le premier onglet Markdown disponible
  const leaves = app.workspace.getLeavesOfType("markdown");
  for (const leaf of leaves) {
    const leafFile = (leaf.view as { file?: TFile }).file;
    if (leafFile) {
      return leafFile;
    }
  }
  return null;
}
