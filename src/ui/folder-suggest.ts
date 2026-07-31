import { AbstractInputSuggest, TFolder } from "obsidian";
import type { App } from "obsidian";

/** Autocomplétion de dossiers du coffre pour un champ texte — utilisée par
 * OpenExistingFolderModal ("Ouvrir un dossier existant") pour choisir un
 * dossier sans avoir à en taper le chemin complet de mémoire. Filtre
 * insensible à la casse sur le chemin entier (pas seulement le nom), tri
 * alphabétique. `AbstractInputSuggest` gère elle-même le report de la
 * sélection dans le champ (setValue) : rien à faire de plus ici. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.limit = 50;
  }

  getSuggestions(query: string): TFolder[] {
    const q = query.trim().toLowerCase();
    const folders: TFolder[] = [];
    const collect = (folder: TFolder) => {
      if (folder.path !== "/" && (!q || folder.path.toLowerCase().includes(q))) folders.push(folder);
      for (const child of folder.children) {
        if (child instanceof TFolder) collect(child);
      }
    };
    collect(this.app.vault.getRoot());
    return folders.sort((a, b) => a.path.localeCompare(b.path));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }
}
