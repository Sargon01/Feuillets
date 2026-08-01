/** Barre d'onglets de catégorie, isolée du panneau de réglages : aucune
 * dépendance à Obsidian au-delà des méthodes DOM qu'il ajoute à
 * `HTMLElement` (`empty`, `addClass`, `createEl`) — donc testable avec un
 * simple élément, réel ou reconstitué en test, sans instancier ni
 * `PluginSettingTab` ni le modal de réglages.
 *
 * Réutilisée par `feuillets-setting-tab.ts` comme premier item de
 * `getSettingDefinitions()`, à l'intérieur d'un `render()` : c'est ce
 * point d'appel qui reste couplé à Obsidian (le `Setting` fourni par le
 * framework), pas cette fonction. */

export type CategoryTabBarOptions = {
  /** Catégories dans l'ordre d'affichage. */
  categories: string[];
  /** Libellé affiché par catégorie ; repli sur le nom brut si absent. */
  labels: Record<string, string>;
  /** Catégorie actuellement sélectionnée. */
  active: string;
  /** Appelé au clic sur un bouton, avec le nom de la catégorie visée. */
  onSelect: (name: string) => void;
};

/** Reconstruit la barre dans `container` (vidé au préalable) : un bouton
 * par catégorie, classe `is-active` sur celui qui correspond à `active`.
 * Mêmes classes CSS que l'ancienne barre construite par
 * `organizeSections()` (`feuillets-settings-tabs`, `feuillets-settings-tab-btn`,
 * `is-active`) — `styles.css` n'a rien à changer. */
export function renderCategoryTabBar(container: HTMLElement, opts: CategoryTabBarOptions): void {
  container.empty();
  container.addClass("feuillets-settings-tabs");
  for (const name of opts.categories) {
    const btn = container.createEl("button", {
      cls: "feuillets-settings-tab-btn",
      text: opts.labels[name] || name,
    });
    if (name === opts.active) btn.addClass("is-active");
    btn.addEventListener("click", () => opts.onSelect(name));
  }
}
