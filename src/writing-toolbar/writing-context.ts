import type { MarkdownView } from "obsidian";

/** Type de surface d'écriture. `scrivenings` est déclaré dès maintenant pour
 *  figer le contrat (Lot 3 étendra ce module) mais seule la résolution
 *  Markdown est implémentée ici. */
export type WritingContextKind = "markdown" | "scrivenings";

/** Contexte d'écriture consommé par le registre d'actions : la surface sur
 *  laquelle la Barre est montée et à laquelle les handlers s'appliquent. */
export interface WritingContext {
  kind: WritingContextKind;
  hostEl: HTMLElement;
}

/** Résolution Markdown : le contexte n'existe que pour une vue en mode
 *  source/édition. En lecture (`getMode() !== "source"`), aucun contexte —
 *  la Barre n'a rien à accrocher à un aperçu rendu. */
export function resolveMarkdownWritingContext(view: MarkdownView): WritingContext | null {
  if (view.getMode() !== "source") return null;
  return { kind: "markdown", hostEl: view.contentEl };
}
