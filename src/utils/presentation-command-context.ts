/**
 * Contexte de commande PARTAGÉ par les trois commandes Présentation
 * (« Présentation : ouvrir », « Présentation : ouvrir l'aperçu »,
 * « Présentation : exporter en PDF »). Résolution déterministe et unique du
 * fichier Markdown actif et, quand elle existe, de sa leaf Markdown — jamais
 * une seconde implémentation par commande, jamais d'API Workspace privée.
 */
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";

export interface PresentationMarkdownContext {
  file: TFile;
  workLeaf: WorkspaceLeaf | null;
}

/**
 * Résolution déterministe :
 *  1. si une MarkdownView active possède un `.md` : son fichier + sa leaf ;
 *  2. sinon, `workspace.getActiveFile()` si c'est un `.md` ;
 *  3. dans ce second cas, cherche une leaf Markdown déjà ouverte sur CE
 *     fichier avec `workspace.getLeavesOfType("markdown")` ;
 *  4. si aucune leaf correspondante : retourne quand même le fichier, avec
 *     `workLeaf = null`.
 * `null` si aucun fichier Markdown actif n'est trouvé par aucune des deux voies.
 */
export function resolvePresentationMarkdownContext(app: App): PresentationMarkdownContext | null {
  const activeView = app.workspace.getActiveViewOfType(MarkdownView);
  if (activeView?.file instanceof TFile && activeView.file.extension === "md") {
    return { file: activeView.file, workLeaf: activeView.leaf };
  }

  const activeFile = app.workspace.getActiveFile();
  if (!(activeFile instanceof TFile) || activeFile.extension !== "md") return null;

  const markdownLeaves = app.workspace.getLeavesOfType("markdown");
  const matchingLeaf = markdownLeaves.find((leaf) => {
    const view = leaf.view as unknown as { file?: unknown };
    return view?.file instanceof TFile && view.file.path === activeFile.path;
  });

  return { file: activeFile, workLeaf: matchingLeaf ?? null };
}

/**
 * Garantit une vraie leaf Markdown publique pour `context.file` : réutilise
 * `context.workLeaf` si elle existe déjà, sinon ouvre le fichier dans un
 * nouvel onglet via l'API publique (`workspace.getLeaf("tab")` +
 * `leaf.openFile`) — jamais d'API Workspace privée.
 */
export async function ensurePresentationMarkdownLeaf(app: App, context: PresentationMarkdownContext): Promise<WorkspaceLeaf> {
  if (context.workLeaf) return context.workLeaf;
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(context.file);
  return leaf;
}
