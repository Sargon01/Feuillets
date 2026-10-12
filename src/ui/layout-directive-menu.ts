import type { Menu, MenuItem } from "obsidian";
import { t } from "../i18n/index.js";
import type { ParagraphLayoutProperties } from "../services/layout-store.js";

type SubmenuItem = MenuItem & { setSubmenu?: () => Menu };
export interface LayoutMenuState { pagination: boolean; paragraph?: ParagraphLayoutProperties; }
interface LayoutMenuAction {
  title: string;
  checked?: (state: LayoutMenuState) => boolean;
  run: () => Promise<void> | void;
}
interface LayoutMenuGroup { title: string; icon?: string; children: LayoutMenuEntry[]; }
type LayoutMenuEntry = LayoutMenuAction | LayoutMenuGroup;

/** Electron copies item states when Obsidian shows a native menu. Prepare
 * this menu instance before that copy, retaining the host's native display,
 * position, document and synchronous return value. */
export function waitForLayoutMenuState(menu: Menu, ready: Promise<void>): void {
  const showAtPosition = menu.showAtPosition.bind(menu);
  menu.showAtPosition = (position, doc) => {
    void ready.then(() => {
      menu.showAtPosition = showAtPosition;
      showAtPosition(position, doc);
    });
    return menu;
  };
}

function flatActions(entries: LayoutMenuEntry[], prefix: string): LayoutMenuAction[] {
  return entries.flatMap((entry) => {
    const title = `${prefix} : ${entry.title}`;
    return "children" in entry ? flatActions(entry.children, title) : [{ ...entry, title }];
  });
}

function configureAction(item: MenuItem, entry: LayoutMenuAction, checks: Array<{ item: MenuItem; checked: (state: LayoutMenuState) => boolean }>): void {
  item.setTitle(entry.title).setDisabled(true).onClick(entry.run);
  checks.push({ item, checked: entry.checked ?? (() => false) });
}

/** Use the same optional native submenu API as the footnote menu. Older
 * Obsidian versions receive fully labelled, immediately usable actions. */
function addEntries(menu: Menu, entries: LayoutMenuEntry[], checks: Array<{ item: MenuItem; checked: (state: LayoutMenuState) => boolean }>, prefix = ""): void {
  for (const entry of entries) {
    const title = prefix ? `${prefix} : ${entry.title}` : entry.title;
    if ("children" in entry) {
      let supported = false;
      const fallback = flatActions(entry.children, title);
      menu.addItem((item) => {
        if (entry.icon) item.setIcon(entry.icon);
        const submenuItem = item as SubmenuItem;
        if (typeof submenuItem.setSubmenu === "function") {
          supported = true;
          item.setTitle(title);
          addEntries(submenuItem.setSubmenu(), entry.children, checks);
        } else {
          configureAction(item, fallback[0], checks);
        }
      });
      if (!supported) addEntries(menu, fallback.slice(1), checks);
    } else {
      menu.addItem((item) => {
        configureAction(item, { ...entry, title }, checks);
      });
    }
  }
}

export function buildLayoutDirectiveMenu(menu: Menu, answer: boolean, actions: { pageBreak: () => Promise<void>; answer: () => void; property?: (patch: ParagraphLayoutProperties) => Promise<void> }, paragraph = false): (state: LayoutMenuState) => void {
  const entries: LayoutMenuEntry[] = [];
  if (paragraph) entries.push({ title: t("editorMenu.layout.alignment"), children: ([undefined, "left", "center", "right", "justify"] as const).map((alignment) => ({
    title: t(alignment ? `editorMenu.layout.${alignment}` : "editorMenu.layout.default"),
    checked: (state: LayoutMenuState) => state.paragraph?.alignment === alignment,
    run: () => actions.property?.({ alignment }),
  })) });
  const amounts = (key: "firstLineIndentPt" | "spacingBeforePt" | "spacingAfterPt", values: readonly (number | undefined)[]): LayoutMenuEntry[] => values.map((value) => ({
    title: value === undefined ? t("editorMenu.layout.default") : value === 0 ? t("editorMenu.layout.none") : t(key === "firstLineIndentPt" ? "editorMenu.layout.indentPt" : "editorMenu.layout.points", { value: String(value) }),
    checked: (state) => state.paragraph?.[key] === value,
    run: () => actions.property?.({ [key]: value }),
  }));
  if (paragraph) entries.push(
    { title: t("editorMenu.layout.indent"), children: amounts("firstLineIndentPt", [undefined, 0, 12, 18]) },
    { title: t("editorMenu.layout.spacing"), children: [
      { title: t("editorMenu.layout.before"), children: amounts("spacingBeforePt", [undefined, 0, 6, 12]) },
      { title: t("editorMenu.layout.after"), children: amounts("spacingAfterPt", [undefined, 0, 6, 12]) },
    ] },
  );
  entries.push({ title: t("modal.layoutDirective.pageBreakBefore"), checked: (state) => state.pagination, run: actions.pageBreak });
  if (answer) entries.push({ title: t("editorMenu.layout.answerArea"), run: actions.answer });
  const checks: Array<{ item: MenuItem; checked: (state: LayoutMenuState) => boolean }> = [];
  addEntries(menu, [{ title: t("editorMenu.layoutDirective"), icon: "layout-panel-left", children: entries }], checks);
  return (state) => checks.forEach(({ item, checked }) => item.setChecked(checked(state)).setDisabled(false));
}
