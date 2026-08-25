import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";
import type { ContentVariant } from "./content-variants.js";

function excludedRoleElements(root: HTMLElement, excludedRoles: ReadonlySet<SemanticRole>): Element[] {
  const elements: Element[] = [];
  for (const role of SEMANTIC_ROLES) {
    if (!excludedRoles.has(role)) continue;
    elements.push(...Array.from(root.querySelectorAll(`.feuillets-semantic-role.feuillets-role-${role}`)));
  }
  return elements;
}

function removeOrphanedFootnotes(root: HTMLElement): void {
  const section = root.querySelector("section.footnotes, .footnotes");
  if (!section) return;
  section.querySelectorAll("li[id]").forEach((item) => {
    const id = item.getAttribute("id");
    if (!id) return;
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const hasReference = root.querySelector(`a[href="#${escapedId}"], [data-footnote-id="${id}"]`);
    if (!hasReference) item.remove();
  });
  if (!section.querySelector("li[id]")) section.remove();
}

function removeAnswerSpaces(root: HTMLElement): void {
  root.querySelectorAll(".feuillets-semantic-role.feuillets-role-questions .feuillets-answer-line, .feuillets-semantic-role.feuillets-role-questions .feuillets-answer-space")
    .forEach((element) => element.remove());
}

/** Applique une variante uniquement au DOM déjà rendu.
 *
 * Le Markdown n'est jamais inspecté ici : seuls les rôles canoniques reconnus
 * par semantic-roles.ts peuvent être filtrés. Le texte ordinaire et les
 * callouts Obsidian non canoniques restent donc inchangés. */
export function applyContentVariant(root: HTMLElement, variant: ContentVariant | null): void {
  if (!variant) return;
  if (variant.excludedRoles.length === 0 && variant.questionAnswerSpace === "keep") return;
  const excludedRoles = new Set<SemanticRole>(variant.excludedRoles);
  const removedRoles = excludedRoleElements(root, excludedRoles);
  removedRoles.forEach((roleElement) => roleElement.remove());
  if (variant.questionAnswerSpace === "hide") removeAnswerSpaces(root);
  if (removedRoles.length > 0) removeOrphanedFootnotes(root);
}
