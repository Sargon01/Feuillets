import { App, TFile, TFolder } from "obsidian";
import { getOrderedChildren } from "./folder-structure.js";

export type CompileScope =
  | { type: "project"; projectRoot: string }
  | { type: "file"; projectRoot: string; path: string }
  | { type: "folder"; projectRoot: string; path: string }
  | { type: "selection"; projectRoot: string; paths: string[] };

/**
 * Résout une portée de compilation en liste de fichiers Markdown à compiler.
 *
 * Règles:
 * - file: uniquement ce fichier Markdown
 * - folder: uniquement ses descendants Markdown
 * - selection: fichiers sélectionnés + descendants des dossiers sélectionnés
 * - project: tous les fichiers du projet
 * - Aucun doublon
 * - Si dossier + descendant sélectionnés, inclure une seule fois
 * - Respect de l'ordre du Binder
 * - Exclusion de tous les dossiers techniques (_Recherche, _Ressources, _Edition, _Sortie, etc.)
 */
export function resolveCompileScopeFiles(
  app: App,
  settings: FeuilletsSettings,
  scope: CompileScope
): TFile[] {
  const projectRoot = app.vault.getAbstractFileByPath(scope.projectRoot);
  if (!(projectRoot instanceof TFolder)) {
    return [];
  }

  // Dossiers techniques à exclure
  const technicalFolders = new Set(["_Feuillets", "_Recherche", "_Ressources", "_Edition", "_Sortie", "_Snapshots", "_Backups"]);

  // Utilitaire: récursif pour collecter tous les fichiers Markdown d'un dossier
  const getAllMarkdownFiles = (folder: TFolder, visited = new Set<string>()): TFile[] => {
    const files: TFile[] = [];
    const visited2 = new Set(visited);
    visited2.add(folder.path);

    for (const child of getOrderedChildren(app, settings, folder, false)) {
      if (child instanceof TFile && child.extension === "md") {
        files.push(child);
      } else if (child instanceof TFolder && !technicalFolders.has(child.name) && !visited2.has(child.path)) {
        files.push(...getAllMarkdownFiles(child, visited2));
      }
    }
    return files;
  };

  switch (scope.type) {
    case "file": {
      const file = app.vault.getAbstractFileByPath(scope.path);
      return file instanceof TFile && file.extension === "md" ? [file] : [];
    }

    case "folder": {
      const folder = app.vault.getAbstractFileByPath(scope.path);
      if (!(folder instanceof TFolder)) return [];
      return getAllMarkdownFiles(folder);
    }

    case "selection": {
      const allFiles = new Map<string, TFile>();

      // Développer les dossiers sélectionnés : la Map élimine naturellement
      // les doublons lorsqu'un de leurs descendants est aussi sélectionné.
      for (const path of scope.paths) {
        const node = app.vault.getAbstractFileByPath(path);

        if (node instanceof TFile && node.extension === "md") {
          allFiles.set(node.path, node);
        } else if (node instanceof TFolder && !technicalFolders.has(node.name)) {
          for (const file of getAllMarkdownFiles(node)) {
            allFiles.set(file.path, file);
          }
        }
      }

      // Respecter strictement l'ordre du Binder.
      const result: TFile[] = [];
      const collectInOrder = (folder: TFolder) => {
        for (const child of getOrderedChildren(app, settings, folder, false)) {
          if (child instanceof TFile && allFiles.has(child.path)) {
            result.push(child);
            allFiles.delete(child.path);
          } else if (child instanceof TFolder && !technicalFolders.has(child.name)) {
            collectInOrder(child);
          }
        }
      };
      collectInOrder(projectRoot);

      for (const file of allFiles.values()) {
        result.push(file);
      }

      return result;
    }

    case "project": {
      return getAllMarkdownFiles(projectRoot);
    }

    default:
      return [];
  }
}

/**
 * Crée une portée projet par défaut pour la compilation standard
 */
export function createProjectScope(projectRoot: string): CompileScope {
  return { type: "project", projectRoot };
}

/**
 * Crée une portée fichier
 */
export function createFileScope(projectRoot: string, filePath: string): CompileScope {
  return { type: "file", projectRoot, path: filePath };
}

/**
 * Crée une portée dossier
 */
export function createFolderScope(projectRoot: string, folderPath: string): CompileScope {
  return { type: "folder", projectRoot, path: folderPath };
}

/**
 * Crée une portée sélection
 */
export function createSelectionScope(projectRoot: string, paths: string[]): CompileScope {
  return { type: "selection", projectRoot, paths };
}
