const { setIcon } = require("obsidian");

/** Construit l'en-tête d'une section repliable (div section + head + chevron
 * + titre + icône/bouton optionnels + clic qui bascule l'état replié) et la
 * retourne pour que l'appelant y ajoute son propre contenu. `collapsed` et la
 * logique de calcul du repli restent à la charge de l'appelant (ex. la vue
 * Recherche force l'ouverture des sections pendant une recherche active). */
export function renderCollapsibleHead(container, {
  classes,
  title,
  icon,
  collapsed,
  collapseKey,
  settings,
  onToggle,
  onCreate,
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

export function iconBtn(parent, icon, tooltip, onClick) {
  const btn = parent.createEl("button", { cls: "clickable-icon" });
  setIcon(btn, icon);
  btn.setAttr("aria-label", tooltip);
  btn.setAttr("title", tooltip);
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

export function highlightActive(rootEl, activePath) {
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
    .forEach((el) => el.addClass("is-active"));
}

export function isEditing(rootEl) {
  const a = document.activeElement;
  return a && rootEl.contains(a) && ["TEXTAREA", "INPUT"].includes(a.tagName);
}

export function getActiveFileSafe(app) {
  // 1. Tenter via le fichier actif du workspace (très fiable si un onglet d'écriture est actif)
  const active = app.workspace.getActiveFile();
  if (active) return active;

  // 2. Tenter via la feuille active globale
  const activeLeaf = app.workspace.activeLeaf;
  if (activeLeaf && activeLeaf.view && activeLeaf.view.file) {
    return activeLeaf.view.file;
  }

  // 3. Tenter via la feuille la plus récemment active (très utile quand le focus est dans la barre latérale)
  const recentLeaf = app.workspace.getMostRecentLeaf();
  if (recentLeaf && recentLeaf.view && recentLeaf.view.file) {
    return recentLeaf.view.file;
  }

  // 4. Repli sur le premier onglet Markdown disponible
  const leaves = app.workspace.getLeavesOfType("markdown");
  for (const leaf of leaves) {
    if (leaf.view && leaf.view.file) {
      return leaf.view.file;
    }
  }
  return null;
}
