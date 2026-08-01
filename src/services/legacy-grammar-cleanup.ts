/* Nettoyage des vestiges de la correction grammaticale, retirée en 1.4.5.
 *
 * Feuillets embarquait deux moteurs téléchargés après installation
 * (Grammalecte, Harper) et un correcteur distant (LanguageTool). Tout cela a
 * été supprimé : la correction est désormais l'affaire de greffons dédiés de
 * la galerie communautaire. Voir README, « Correction grammaticale ».
 *
 * Deux vestiges possibles chez les utilisateurs existants :
 *   1. des clés devenues inutiles dans data.json ;
 *   2. jusqu'à 26 Mo de moteurs téléchargés dans le dossier du greffon.
 *
 * Les mots appris et les signalements ignorés (grammar-user-data.json) sont
 * du contenu produit par l'utilisateur : ils ne sont PAS supprimés. Ils
 * deviennent simplement inertes, et restent récupérables.
 */

/** Clés de réglages abandonnées avec la correction grammaticale. */
export const LEGACY_GRAMMAR_SETTING_KEYS = [
  "grammarEngine",
  "languageToolUrl",
  "languageToolLanguage",
  "grammalecteDetectRepetitions",
  "grammalecteKnownWords",
  "grammalecteIgnoredRules",
] as const;

/** Retire les clés obsolètes d'un objet de réglages chargé. Rend true si au
 * moins une a été retirée — l'appelant sait alors qu'il doit sauvegarder.
 * Ne touche à aucune autre clé : un réglage inconnu de Feuillets (ajouté par
 * une version plus récente, par exemple) est conservé tel quel. */
export function stripLegacyGrammarSettings(settings: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of LEGACY_GRAMMAR_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      delete settings[key];
      changed = true;
    }
  }
  return changed;
}

import { Platform } from "obsidian";
import { pluginAbsoluteDir } from "../utils/plugin-dir.js";

/** Dossiers et marqueurs écrits par l'ancien téléchargeur de moteurs. */
export const LEGACY_ENGINE_PATHS = [
  "grammalecte",
  "harper",
  ".grammalecte-version.json",
  ".harper-version.json",
] as const;

type FsLike = {
  existsSync(path: string): boolean;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};

/** Supprime les moteurs téléchargés par les versions antérieures. Ce sont des
 * caches que Feuillets avait lui-même écrits, pas des données utilisateur.
 * Silencieux et idempotent : une erreur de suppression ne doit jamais empêcher
 * le greffon de démarrer. Rend la liste de ce qui a été retiré. */
export function removeLegacyEngines(fs: FsLike, join: (...parts: string[]) => string, resourcesDir: string): string[] {
  const removed: string[] = [];
  for (const name of LEGACY_ENGINE_PATHS) {
    const target = join(resourcesDir, name);
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* Disque en lecture seule, permissions, fichier verrouillé : sans
         conséquence, le vestige est inerte. On n'alerte pas l'utilisateur. */
    }
  }
  return removed;
}

type NodeModuleLoader = (id: string) => unknown;
type PathModule = { join(...parts: string[]): string };

/** Point d'entrée depuis le greffon : localise le dossier de ressources et y
 * supprime les moteurs hérités. Sans effet hors bureau (fs/path sont des
 * modules Node) et sans effet si rien ne traîne. */
export function cleanupLegacyEnginesOnDisk(app: unknown, manifest: unknown): string[] {
  if (!Platform.isDesktop) return [];
  /* `window`, pas `activeWindow` : ce nettoyage se lance une seule fois au
     démarrage du greffon (onload), avant qu'aucune fenêtre détachée existe,
     et ne cherche que le chargeur Node (`require`) — jamais un document ou
     une minuterie propres à la fenêtre affichée. `activeWindow` viserait la
     fenêtre qui a le focus, ce qui n'a aucun rapport ici et pourrait même
     pointer sur une fenêtre détachée par erreur si l'utilisatrice en a une
     au premier plan au redémarrage. */
  const loader = (window as unknown as { require?: NodeModuleLoader }).require;
  if (typeof loader !== "function") return [];
  try {
    const fs = loader("fs") as FsLike;
    const path = loader("path") as PathModule;
    return removeLegacyEngines(fs, (...parts) => path.join(...parts), path.join(pluginAbsoluteDir(app, manifest), "resources"));
  } catch {
    /* Chemin du greffon introuvable : rien à nettoyer, rien à signaler. */
    return [];
  }
}
