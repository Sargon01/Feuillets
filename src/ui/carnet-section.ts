import { setIcon } from "obsidian";

/** Use the sidebar's existing section grammar without remounting its contents. */
export function createCarnetSection(parent: HTMLElement, settings: () => FeuilletsSettings, save: () => Promise<void>, name: string, title: string, icon: string, initiallyCollapsed: boolean, subgroup = false): HTMLElement {
  const section = parent.createDiv({ cls: `feuillets-notes-section feuillets-carnets-section${subgroup ? " feuillets-carnets-default-group" : ""}`, attr: { "data-carnet-section": name } });
  const id = `carnet-section-${crypto.randomUUID()}`;
  const head = section.createEl("button", { cls: "feuillets-notes-section-head feuillets-carnets-section-head", attr: { type: "button", "aria-controls": id } });
  const symbol = head.createSpan({ cls: "feuillets-notes-section-icon", attr: { "aria-hidden": "true" } });
  setIcon(symbol, icon);
  head.createSpan({ cls: "feuillets-notes-section-title", text: title });
  const chevron = head.createSpan({ cls: "feuillets-notes-section-icon", attr: { "aria-hidden": "true" } });
  const body = section.createDiv({ cls: "feuillets-carnets-section-body", attr: { id } });
  const key = `carnets.${name}`;
  const update = (): void => {
    body.hidden = settings().collapsed?.[key] ?? initiallyCollapsed;
    head.setAttribute("aria-expanded", String(!body.hidden));
    setIcon(chevron, body.hidden ? "chevron-right" : "chevron-down");
  };
  head.addEventListener("mousedown", (event) => event.preventDefault());
  head.addEventListener("click", () => {
    const current = settings();
    current.collapsed ??= {};
    current.collapsed[key] = !body.hidden;
    update();
    void save();
  });
  update();
  return body;
}
