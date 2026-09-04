import { TFolder } from "obsidian";

export type BoardFolderScope = Readonly<{
  manuscriptRoot: TFolder;
  currentFolder: TFolder;
  hasFocusedFolder: boolean;
}>;

export function resolveBoardFolderScope(manuscriptRoot: TFolder, focusedFolder: TFolder | null): BoardFolderScope {
  if (focusedFolder && focusedFolder.path.startsWith(manuscriptRoot.path)) {
    return { manuscriptRoot, currentFolder: focusedFolder, hasFocusedFolder: true };
  }
  return { manuscriptRoot, currentFolder: manuscriptRoot, hasFocusedFolder: false };
}
