import { Menu, MenuItem, Notice, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";
import { uniqueFileName } from "./canvas-bridge.js";

/* Créations Canvas/Base/Excalidraw depuis le bouton « + » d'une surface
 * Recherche (racine, sous-dossier, dossier associé) — jamais le Binder, la
 * compilation, ni les Ressources, qui ne consultent aucune fonction de ce
 * module. */

/** Canvas JSON vide valide — même forme minimale que
 * generateCanvasBoard (services/canvas-board.ts), jamais réimportée : ce
 * module ne connaît rien du Carnet (chemin fixe, résolution de projet), il
 * ne fait que déposer un fichier .canvas nommé et vide dans le dossier
 * ciblé. */
export async function createResearchCanvas(app: App, folder: TFolder, baseName = "Canvas"): Promise<TFile> {
  const path = uniqueFileName((p) => !!app.vault.getAbstractFileByPath(p), folder.path, baseName, "canvas");
  return app.vault.create(path, JSON.stringify({ nodes: [], edges: [] }, null, "\t"));
}

/** YAML minimal d'une Base filtrée sur `folderPath` : un seul filtre global
 * (`file.inFolder`, inclut les sous-dossiers — comportement natif
 * d'Obsidian, pas un choix de ce module) et une unique vue table triée sur
 * le nom de fichier. Les guillemets déjà présents dans un chemin de dossier
 * (rare) sont échappés pour rester un littéral YAML/expression valide. */
export function minimalBaseFileContent(folderPath: string): string {
  const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${escaped}")`,
    "views:",
    "  - type: table",
    "    name: Table",
    "    order:",
    "      - file.name",
    "",
  ].join("\n");
}

export async function createResearchBase(app: App, folder: TFolder, baseName = "Base"): Promise<TFile> {
  const path = uniqueFileName((p) => !!app.vault.getAbstractFileByPath(p), folder.path, baseName, "base");
  return app.vault.create(path, minimalBaseFileContent(folder.path));
}

export const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";

type CommunityPluginsRegistry = { enabledPlugins?: Set<string> };

/** Installé ET activé — jamais seulement présent sur le disque (un greffon
 * désactivé ne doit jamais faire apparaître l'entrée, voir
 * delegateNewExcalidrawDrawing). `app.plugins` n'est pas dans l'API
 * publique d'Obsidian (obsidian.d.ts) mais reste la convention universelle
 * de détection d'un autre greffon communautaire — absent proprement (accès
 * optionnel) plutôt que de planter si l'API interne change de forme. */
export function isExcalidrawActive(app: App): boolean {
  const plugins = (app as unknown as { plugins?: CommunityPluginsRegistry }).plugins;
  return !!plugins?.enabledPlugins?.has(EXCALIDRAW_PLUGIN_ID);
}

/** Titre EXACT de l'item qu'Excalidraw ajoute à un menu de dossier (chaîne
 * anglaise `CREATE_NEW` de son fichier de langue, jamais traduite selon la
 * langue d'Obsidian — vérifié sur l'installation réelle du greffon). */
const EXCALIDRAW_NEW_DRAWING_TITLE = "New drawing";

type CapturedMenuItem = {
  title: string;
  callback: ((evt: MouseEvent | KeyboardEvent) => unknown) | null;
};

/** Délègue la création d'un nouveau dessin Excalidraw dans `folder` au
 * greffon Excalidraw lui-même, via SON intégration native File Explorer —
 * l'événement public `workspace.on("file-menu", …)`, exactement ce qu'un
 * vrai clic droit sur ce dossier déclenche dans l'explorateur natif
 * d'Obsidian (Excalidraw y ajoute son item « New drawing », ciblé sur le
 * dossier reçu, capturé par SA propre fermeture — jamais reconstruit ici).
 * Jamais un identifiant de commande codé en dur (les commandes globales
 * d'Excalidraw ignorent le dossier ciblé et créent dans SON dossier par
 * défaut réglé dans ses propres paramètres — inutilisable ici), jamais un
 * contenu de fichier fabriqué par ce plugin, jamais un réglage Excalidraw
 * modifié.
 *
 * Le menu temporaire n'est JAMAIS affiché (aucun `showAtMouseEvent`/
 * `showAtPosition`, donc aucun DOM jamais attaché au document — pas
 * d'effet visuel) : on intercepte seulement `Menu.addItem`/`MenuItem.
 * setTitle`/`MenuItem.onClick` — trois méthodes PUBLIQUES documentées,
 * jamais un champ interne non documenté (`menu.items`, `item.dom`…) — le
 * temps du seul appel synchrone à `trigger`, pour retrouver l'item dont le
 * titre est EXACTEMENT `EXCALIDRAW_NEW_DRAWING_TITLE` et exécuter
 * directement son callback. Si Excalidraw (ou un autre greffon) ajoute
 * plusieurs entrées à ce menu de dossier, seule celle dont le titre
 * correspond est retenue ; si aucune ne correspond (greffon absent malgré
 * la vérification `isExcalidrawActive`, ou libellé changé d'une version à
 * l'autre), une Notice le signale et rien n'est créé. */
export function delegateNewExcalidrawDrawing(app: App, folder: TFolder, evt: MouseEvent): void {
  const menu = new Menu();
  const captured: CapturedMenuItem[] = [];

  /* Interception temporaire de trois méthodes PUBLIQUES (Menu.addItem,
     MenuItem.setTitle, MenuItem.onClick) : leur type déclaré (`this`
     polymorphe, retour `this`) échappe structurellement à ce que le
     vérificateur de types peut garantir statiquement une fois la méthode
     extraite de son objet pour être ré-enveloppée — exactement le
     compromis que les autres greffons Obsidian font pour ce même besoin
     d'observation d'un menu construit par un tiers (voir la documentation
     de la fonction). La sûreté vient ici des tests (research-create.
     test.js) et de la restauration immédiate dans le `finally` ci-dessous,
     jamais du typage. */
  /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return -- interception volontaire d'une méthode `this`-polymorphe (Menu.addItem/MenuItem.setTitle/onClick), sûreté garantie par les tests et la restauration immédiate ci-dessous, jamais par le typage */
  const originalAddItem = Menu.prototype.addItem;
  Menu.prototype.addItem = function (this: Menu, cb: (item: MenuItem) => unknown): Menu {
    if (this !== menu) return originalAddItem.call(this, cb);
    return originalAddItem.call(this, (item: MenuItem) => {
      const entry: CapturedMenuItem = { title: "", callback: null };
      const originalSetTitle = item.setTitle;
      item.setTitle = (title: string | DocumentFragment) => {
        entry.title = typeof title === "string" ? title : "";
        return originalSetTitle.call(item, title);
      };
      const originalOnClick = item.onClick;
      item.onClick = (callback: (evt: MouseEvent | KeyboardEvent) => unknown) => {
        entry.callback = callback;
        return originalOnClick.call(item, callback);
      };
      cb(item);
      captured.push(entry);
    });
  };
  try {
    app.workspace.trigger("file-menu", menu, folder, "file-explorer-context-menu");
  } finally {
    Menu.prototype.addItem = originalAddItem;
  }
  /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return -- fin de l'interception temporaire */

  const match = captured.find((entry) => entry.title === EXCALIDRAW_NEW_DRAWING_TITLE);
  if (!match || !match.callback) {
    new Notice(t("main.notice.excalidrawDrawingUnavailable"));
    return;
  }
  match.callback(evt);
}
