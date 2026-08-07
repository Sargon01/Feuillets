import { AbstractInputSuggest, TFolder } from "obsidian";
import type { App } from "obsidian";

/** Autocomplétion de dossiers du coffre pour un champ texte — utilisée par
 * OpenExistingFolderModal ("Ouvrir un dossier existant") et
 * LinkResearchFolderModal pour choisir un dossier sans avoir à en taper le
 * chemin complet de mémoire. Filtre insensible à la casse sur le chemin
 * entier (pas seulement le nom), tri alphabétique.
 *
 * CORRECTIF : le comportement par défaut hérité de `AbstractInputSuggest`
 * pour `selectSuggestion` ne sait reporter dans le champ qu'une valeur déjà
 * textuelle — pour un `TFolder` (objet, pas une chaîne), il ne remplit pas
 * le champ de façon fiable au clic, ce qui obligeait à taper le chemin
 * exact à la main. `selectSuggestion` est donc explicitement redéfini ici
 * pour poser nous-mêmes `folder.path` dans le champ, fermer le popover, et
 * prévenir l'appelant — `onSelect` est redéfini en miroir pour mémoriser ce
 * callback nous-mêmes plutôt que de dépendre du mécanisme interne (non
 * documenté) de la classe de base. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private selectCallback: ((folder: TFolder, evt: MouseEvent | KeyboardEvent) => void) | null = null;

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

  /** Appelé par Obsidian au clic (ou à la validation clavier) d'une
   * suggestion : impose nous-mêmes le report dans le champ, jamais laissé
   * au comportement par défaut pour un type non-textuel. */
  selectSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent): void {
    this.setValue(folder.path);
    this.close();
    this.selectCallback?.(folder, evt);
  }

  onSelect(callback: (folder: TFolder, evt: MouseEvent | KeyboardEvent) => void): this {
    this.selectCallback = callback;
    return this;
  }
}
