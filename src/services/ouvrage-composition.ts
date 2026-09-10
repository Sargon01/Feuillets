import { normalizePath, type TFolder } from "obsidian";
import { ouvrageRelativePath } from "./editorial-roots.js";

/** LOT 5A — fondations de la composition propre à chaque ouvrage.
 *
 * Fonctions PURES (aucun accès au vault, aucune Notice, aucune écriture
 * autre que dans l'objet `settings` reçu) qui lisent et écrivent
 * EXCLUSIVEMENT `folderWorkspaces[relatif].ouvrage.composition` (voir
 * services/editorial-roots.ts pour le statut d'ouvrage lui-même). La
 * composition EFFECTIVE d'une racine globale (avant tout héritage/override
 * d'ouvrage) reste calculée par
 * l'appelant — voir services/compile-export.ts effectiveComposition() — et
 * transmise ici en paramètre : ce module ignore délibérément
 * activePresetConfig()/book-composition.ts, pour rester sans dépendance
 * vers le reste de la compilation. */

/** Même défense que isOuvrageRoot/registerOuvrage (services/editorial-
 * roots.ts) : la clé réelle de `settings.projectMeta` peut différer de
 * `globalRoot.path` à la marge (espaces, barre oblique finale) dans des
 * fixtures construites à la main — jamais en usage réel, où les deux
 * coïncident toujours. */
function rootKeyFor(settings: FeuilletsSettings, globalRoot: TFolder): string {
  if (settings.projectMeta?.[globalRoot.path]) return globalRoot.path;
  return normalizePath(globalRoot.path.trim()).replace(/\/+$/, "");
}

/** Configuration d'ouvrage exacte de `editorialRoot`, sans repli ni
 * création — `null` si le dossier n'est pas un descendant strict de
 * `globalRoot` ou ne porte aucune entrée `folderWorkspaces`. */
function ouvrageConfigFor(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder
): OuvrageConfig | null {
  const rel = ouvrageRelativePath(globalRoot.path, editorialRoot.path);
  if (!rel) return null;
  const rootKey = rootKeyFor(settings, globalRoot);
  return settings.projectMeta?.[rootKey]?.folderWorkspaces?.[rel]?.ouvrage || null;
}

/** Composition effective de `editorialRoot` : sa composition locale si elle
 * existe, sinon `globalComposition` telle quelle (héritage intégral, sans
 * jamais la muter ni la faire passer par une copie partielle). Une SIMPLE
 * LECTURE ne crée et ne modifie jamais `settings` — le résultat est toujours
 * une copie neuve, jamais une référence vers l'objet stocké. */
export function resolveOuvrageComposition(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder,
  globalComposition: OuvrageCompositionConfig
): OuvrageCompositionConfig {
  const config = ouvrageConfigFor(settings, globalRoot, editorialRoot);
  /* Toujours une copie NEUVE, dans les deux branches : muter le résultat
     (appelant distrait) ne doit jamais atteindre ni la composition stockée
     ni `globalComposition` transmise par l'appelant. */
  return { ...(config?.composition ?? globalComposition) };
}

/** Copie complète et indépendante d'une composition effective — le point de
 * départ obligé de toute PREMIÈRE modification locale (voir
 * updateOuvrageComposition) : jamais un delta partiel qui laisserait
 * certains champs indéfinis. */
export function materializeOuvrageComposition(globalComposition: OuvrageCompositionConfig): OuvrageCompositionConfig {
  return { ...globalComposition };
}

/** Applique `patch` à la composition locale de `editorialRoot`, en la
 * matérialisant d'abord (copie complète de `globalComposition`) si elle
 * n'existe pas encore — après quoi cet ouvrage est indépendant : plus
 * aucune modification globale ultérieure ne l'affecte. Ne crée JAMAIS le
 * statut d'ouvrage lui-même (`ouvrage`) : renvoie `false` sans rien écrire
 * si `editorialRoot` n'est pas déjà enregistré comme ouvrage (voir
 * registerOuvrage, services/editorial-roots.ts) — même défense que
 * unregisterOuvrage. */
export function updateOuvrageComposition(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder,
  globalComposition: OuvrageCompositionConfig,
  patch: Partial<OuvrageCompositionConfig>
): boolean {
  const rel = ouvrageRelativePath(globalRoot.path, editorialRoot.path);
  if (!rel) return false;
  const rootKey = rootKeyFor(settings, globalRoot);
  const config = settings.projectMeta?.[rootKey]?.folderWorkspaces?.[rel];
  if (!config?.ouvrage) return false;

  const base = config.ouvrage.composition || materializeOuvrageComposition(globalComposition);
  config.ouvrage.composition = { ...base, ...patch };
  return true;
}

/** Retire uniquement la composition locale de `editorialRoot` — retour
 * immédiat à l'héritage de la composition globale. Ne touche jamais au
 * reste de `ouvrage` (son `version`) ni à aucun autre réglage de l'espace
 * de travail : seul le champ `composition` disparaît. */
export function clearOuvrageComposition(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder
): boolean {
  const rel = ouvrageRelativePath(globalRoot.path, editorialRoot.path);
  if (!rel) return false;
  const rootKey = rootKeyFor(settings, globalRoot);
  const config = settings.projectMeta?.[rootKey]?.folderWorkspaces?.[rel];
  if (!config?.ouvrage?.composition) return false;

  delete config.ouvrage.composition;
  return true;
}
