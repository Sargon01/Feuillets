import { TFile } from "obsidian";
import type { App, TFolder } from "obsidian";
import { getProjectFolder, flattenFiles, isFrontMatter, roleOfFile } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import { filsOf } from "../utils/arc-fields.js";

type NarrativeThreadsPlugin = NarrativeThreadsPluginState & {
  _filQueues?: Map<string, Promise<void>>;
};

/** Dernier feuillet du projet, dans l'ordre du manuscrit — celui qui reçoit
 * automatiquement le marqueur d'un fil narratif fraîchement planté. Fixé au
 * moment de la plantation : si de nouveaux chapitres sont ajoutés après
 * coup, le marqueur ne "saute" pas tout seul vers le nouveau dernier
 * feuillet (ça demanderait de déplacer du contenu généré automatiquement
 * sans prévenir, plus surprenant qu'utile). */
export function getLastProjectFile(app: App, settings: FeuilletsSettings): TFile | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const scenes = flattenFiles(app, settings, root).filter(
    (f) =>
      f instanceof TFile &&
      f.extension === "md" &&
      !isFrontMatter(app, settings, f) &&
      ["scene", "chapitre"].includes(roleOfFile(app, settings, f))
  );
  return scenes.length > 0 ? scenes[scenes.length - 1] : null;
}

async function setFilList(app: App, file: TFile, fils: string[]): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (fils.length === 0) delete fm.thread;
    else fm.thread = fils;
    delete fm.fil;
  });
}

function existsElsewhere(app: App, settings: FeuilletsSettings, root: TFolder, value: string, excludePath: string): boolean {
  const scenes = flattenFiles(app, settings, root).filter(
    (f) => f instanceof TFile && f.extension === "md" && !isFrontMatter(app, settings, f)
  );
  for (const f of scenes) {
    if (f.path === excludePath) continue;
    if (filsOf(fmOf(app, f)).includes(value)) return true;
  }
  return false;
}

/** Cœur de l'automatisation du suivi de fils narratifs, appelé à chaque
 * modification de frontmatter d'un feuillet du projet.
 *
 * - Un fil vu pour la première fois nulle part ailleurs dans le projet est
 *   recopié automatiquement dans le dernier feuillet du projet — un
 *   marqueur "en attente de résolution".
 * - Si ce même fil apparaît ensuite dans un AUTRE feuillet que celui qui
 *   porte ce marqueur, c'est la résolution : le marqueur est retiré
 *   automatiquement du dernier feuillet.
 * - Une fois résolu, un fil n'est plus jamais retouché automatiquement —
 *   il ne peut avoir que deux occurrences au total via ce mécanisme.
 *
 * `plugin._filSuppressed` (Set en mémoire, jamais persisté) sert à ignorer
 * l'événement "changed" que déclenche notre propre écriture, sans quoi
 * chaque marqueur automatique se reléverait pour une resolution fictive. */
export async function handleFilChanged(app: App, settings: FeuilletsSettings, plugin: NarrativeThreadsPlugin, file: TFile): Promise<void> {
  if (plugin._filSuppressed && plugin._filSuppressed.has(file.path)) {
    plugin._filSuppressed.delete(file.path);
    return;
  }
  const root = getProjectFolder(app, settings);
  if (!root || !file.path.startsWith(root.path + "/")) return;
  if (isFrontMatter(app, settings, file)) return;

  const fils = filsOf(fmOf(app, file));
  if (fils.length === 0) return;

  /* handleFilChanged est déclenché par metadataCache "changed", jamais
     awaité par Obsidian — deux feuillets modifiés à quelques centaines de
     ms d'écart peuvent donc s'exécuter en parallèle et se marcher dessus
     en lisant/écrivant filPlaceholders/filOrigins/filResolved en mémoire.
     Cette file d'attente sérialise les passages pour ce projet, feuillet
     par feuillet, sans bloquer les autres événements du plugin. */
  const queueKey = root.path;
  if (!plugin._filQueues) plugin._filQueues = new Map();
  const previous = plugin._filQueues.get(queueKey) || Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(() => handleFilChangedLocked(app, settings, plugin, file, root, fils));
  plugin._filQueues.set(queueKey, run);
  return run;
}

async function handleFilChangedLocked(app: App, settings: FeuilletsSettings, plugin: NarrativeThreadsPlugin, file: TFile, root: TFolder, fils: string[]): Promise<void> {
  if (!settings.filPlaceholders) settings.filPlaceholders = {};
  if (!settings.filOrigins) settings.filOrigins = {};
  if (!settings.filResolved) settings.filResolved = [];
  const resolvedSet = new Set(settings.filResolved);

  const suppress = (path: string): void => {
    if (!plugin._filSuppressed) plugin._filSuppressed = new Set();
    plugin._filSuppressed.add(path);
    /* filet de sécurité : si "changed" ne se redéclenche jamais pour cette
       écriture (cas rare), on ne veut pas rester bloqué à ignorer pour de
       bon la prochaine modification légitime de ce fichier. */
    window.setTimeout(() => plugin._filSuppressed && plugin._filSuppressed.delete(path), 5000);
  };

  for (const value of fils) {
    if (resolvedSet.has(value)) continue;

    const placeholderPath = settings.filPlaceholders[value];

    if (placeholderPath) {
      if (placeholderPath === file.path) continue; // c'est le marqueur lui-même
      if (settings.filOrigins[value] === file.path) continue; // réédition du feuillet d'origine : pas une nouvelle apparition
      const placeholderFile = app.vault.getAbstractFileByPath(placeholderPath);
      if (placeholderFile instanceof TFile) {
        const next = filsOf(fmOf(app, placeholderFile)).filter((v) => v !== value);
        suppress(placeholderFile.path);
        await setFilList(app, placeholderFile, next);
      }
      delete settings.filPlaceholders[value];
      delete settings.filOrigins[value];
      settings.filResolved.push(value);
      await plugin.saveSettings();
      continue;
    }

    if (existsElsewhere(app, settings, root, value, file.path)) continue; // donnée pré-existante, pas gérée rétroactivement

    const lastFile = getLastProjectFile(app, settings);
    if (!lastFile || lastFile.path === file.path) continue;

    const lastFils = filsOf(fmOf(app, lastFile));
    if (lastFils.includes(value)) continue;

    suppress(lastFile.path);
    await setFilList(app, lastFile, [...lastFils, value]);
    settings.filPlaceholders[value] = lastFile.path;
    settings.filOrigins[value] = file.path;
    await plugin.saveSettings();
  }
}
