import { normalizePath, type TFolder, type View } from "obsidian";
import { ouvrageRelativePath } from "./editorial-roots.js";
import { toValue } from "../utils/scene-fields.js";
import { activePresetConfig, projectMetaFor } from "./compile-export.js";
import type { CompileScope } from "./compile-scope.js";
import { SUMMARY, TABLES, TOC, BIBLIOGRAPHY, ANNEXES, readGeneratedIncluded, writeGeneratedIncluded } from "./book-composition.js";

/** LOT 5A/5B — composition propre à chaque ouvrage : SOURCE UNIQUE.
 *
 * `effectiveComposition()` est LE seul résolveur des 16 champs de
 * OuvrageCompositionConfig — compile-export.ts et toute l'UI (Édition →
 * Composition et ses six panneaux) l'importent d'ici, jamais une seconde
 * copie. Les fonctions de stockage pur (resolveOuvrageComposition,
 * materializeOuvrageComposition, updateOuvrageComposition,
 * clearOuvrageComposition) lisent et écrivent EXCLUSIVEMENT
 * `folderWorkspaces[relatif].ouvrage.composition` (voir services/
 * editorial-roots.ts pour le statut d'ouvrage lui-même).
 * `createCompositionBinding()` est le point d'entrée
 * unique de l'UI : un seul objet, construit une fois par rendu depuis la
 * portée réellement affichée, transmis tel quel aux six panneaux. */

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

/** Vrai si `editorialRoot` porte une composition LOCALE (indépendante de
 * WARPI) — jamais vrai pour la racine globale elle-même. Sert à calculer
 * `isInherited` du binding UI (voir createCompositionBinding) : un ouvrage
 * SANS composition locale est un ouvrage hérité. */
export function hasOuvrageComposition(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder
): boolean {
  return !!ouvrageConfigFor(settings, globalRoot, editorialRoot)?.composition;
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

/** Repli défensif pour un champ à choix fermé lu depuis `settings`, qui n'a
 * pas de déclaration ambiante dans FeuilletsSettings (types.d.ts) — accès
 * via la signature d'index (`unknown`), même style que `S.activePreset`/
 * `S.compileFileName` déjà pratiqué par activePresetConfig(). `fallback`
 * est TOUJOURS l'une des valeurs autorisées : la valeur par défaut de
 * DEFAULT_SETTINGS. */
function toEnumSetting<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Composition EFFECTIVE d'une racine éditoriale — objet normalisé UNIQUE
 * (OuvrageCompositionConfig, types.d.ts), SOURCE UNIQUE pour compile-export.ts
 * ET pour toute l'UI (Édition → Composition et ses six panneaux) : rôle du
 * premier niveau, numérotation (chapitres/sections, renumérotation des
 * titres, préfixe), titres, séparateur, notes, sommaire/tables/table des
 * matières/bibliographie/annexes. Calcule d'abord la composition GLOBALE
 * (repli historique, inchangé : activePresetConfig() + le même repli
 * projectMeta[globalRoot]→settings déjà pratiqué par roleOfFolder() pour
 * `level1Role`, + réglages generated-items du projet global) puis la
 * résout pour `editorialRoot` — un ouvrage sans composition locale hérite
 * intégralement de cette composition globale, jamais une seconde
 * résolution divergente ailleurs. Mise en page, dossier de sortie,
 * métadonnées générales et catalogue de presets n'en font JAMAIS partie —
 * toujours globaux. */
export function effectiveComposition(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  editorialRoot: TFolder
): OuvrageCompositionConfig {
  const P = activePresetConfig(settings);
  const globalMeta = projectMetaFor(settings, globalRoot);
  /* Même repli que roleOfFolder() (folder-structure.ts) pour la racine
     globale : projectMeta[globalRoot].level1Role d'abord, sinon le réglage
     global historique — comportement PRÉEXISTANT, inchangé ici. */
  const globalLevel1Role = toEnumSetting(globalMeta.level1Role, ["parties", "chapitres"] as const, toEnumSetting(settings.level1Role, ["parties", "chapitres"] as const, "parties"));
  const globalComposition: OuvrageCompositionConfig = {
    fileName: P.fileName,
    folderTitles: P.folderTitles,
    chapterTitles: P.chapterTitles,
    sceneTitles: P.sceneTitles,
    separator: P.separator,
    footnoteRenumberOnCompile: settings.footnoteRenumberOnCompile !== false,
    summary: readGeneratedIncluded(globalMeta, SUMMARY) ?? false,
    tables: readGeneratedIncluded(globalMeta, TABLES) ?? false,
    toc: readGeneratedIncluded(globalMeta, TOC) ?? false,
    bibliography: readGeneratedIncluded(globalMeta, BIBLIOGRAPHY) ?? false,
    annexes: readGeneratedIncluded(globalMeta, ANNEXES) ?? false,
    level1Role: globalLevel1Role,
    chapterNumbering: toEnumSetting(settings.chapterNumbering, ["continu", "parPartie", "aucune"] as const, "continu"),
    sceneNumbering: toEnumSetting(settings.sceneNumbering, ["hier", "continue", "aucune"] as const, "hier"),
    autoRename: settings.autoRename !== false,
    renamePrefix: toValue(settings.renamePrefix) || "chapitre",
  };
  return resolveOuvrageComposition(settings, globalRoot, editorialRoot, globalComposition);
}

/** Écrit un champ de la composition GLOBALE (WARPI) à son emplacement
 * HISTORIQUE exact — jamais via folderWorkspaces/ouvrage, qui n'existe que
 * pour un ouvrage. Un seul point d'écriture, réutilisé par
 * createCompositionBinding() ci-dessous pour que WARPI conserve
 * rigoureusement les mêmes emplacements et effets qu'avant l'introduction
 * du binding (édition-composition-content.ts avant LOT 5B). Les cinq champs
 * partagés avec PresetConfig (fileName/folderTitles/chapterTitles/
 * sceneTitles/separator) restent écrits dans les réglages DE BASE — jamais
 * dans le preset actif, exactement comme la Structure historique : le
 * catalogue de presets se modifie UNIQUEMENT via ses propres lignes
 * dédiées (une par preset, y compris l'actif), inchangées par LOT 5B. */
function applyGlobalCompositionPatch(
  settings: FeuilletsSettings,
  globalRoot: TFolder,
  patch: Partial<OuvrageCompositionConfig>
): void {
  if (patch.fileName !== undefined) settings.compileFileName = patch.fileName;
  if (patch.folderTitles !== undefined) settings.insertFolderTitles = patch.folderTitles;
  if (patch.chapterTitles !== undefined) settings.insertTitles = patch.chapterTitles;
  if (patch.sceneTitles !== undefined) settings.insertSceneTitles = patch.sceneTitles;
  if (patch.separator !== undefined) settings.separator = patch.separator;
  if (patch.footnoteRenumberOnCompile !== undefined) settings.footnoteRenumberOnCompile = patch.footnoteRenumberOnCompile;
  if (patch.level1Role !== undefined) settings.level1Role = patch.level1Role;
  if (patch.chapterNumbering !== undefined) settings.chapterNumbering = patch.chapterNumbering;
  if (patch.sceneNumbering !== undefined) settings.sceneNumbering = patch.sceneNumbering;
  if (patch.autoRename !== undefined) settings.autoRename = patch.autoRename;
  if (patch.renamePrefix !== undefined) settings.renamePrefix = patch.renamePrefix.trim() || "chapitre";

  const generated: Array<[keyof OuvrageCompositionConfig, string]> = [
    ["summary", SUMMARY],
    ["tables", TABLES],
    ["toc", TOC],
    ["bibliography", BIBLIOGRAPHY],
    ["annexes", ANNEXES],
  ];
  const needsMeta = generated.some(([field]) => patch[field] !== undefined);
  if (needsMeta) {
    if (!settings.projectMeta) settings.projectMeta = {};
    const meta = settings.projectMeta[globalRoot.path] || {};
    settings.projectMeta[globalRoot.path] = meta;
    for (const [field, id] of generated) {
      const value = patch[field];
      if (typeof value === "boolean") writeGeneratedIncluded(meta, id, value);
    }
  }
}

/** Binding UI unique transmis aux six panneaux de Composition — construit
 * UNE SEULE FOIS par rendu, depuis la portée réellement affichée
 * (`editorialRoot`). Aucun panneau ne doit recalculer les 16 champs : tous
 * lisent `value` et écrivent via `update()`/`resetToProject()`. */
export type OuvrageCompositionBinding = {
  /** Composition effective de la portée affichée — WARPI (globale) ou
   *  NEFES (locale si `!isInherited`, héritée sinon). */
  value: OuvrageCompositionConfig;
  /** Vrai quand la portée affichée est un ouvrage (pas la racine globale). */
  isOuvrage: boolean;
  /** Vrai quand `isOuvrage` et qu'aucune composition locale n'existe
   *  encore — `value` est alors une copie de la composition de WARPI,
   *  jamais stockée sous NEFES tant qu'aucun champ n'a été modifié. */
  isInherited: boolean;
  /** Applique `patch` à la portée affichée : WARPI écrit directement dans
   *  les réglages globaux (emplacements historiques) ; un ouvrage
   *  matérialise sa composition locale à la première modification, puis la
   *  met à jour — jamais WARPI ni le preset global ne sont touchés. Une
   *  seule sauvegarde et un seul rafraîchissement des vues Binder par
   *  appel ; l'appelant (chaque panneau) reste responsable de son propre
   *  rafraîchissement de l'Aperçu (`onPresentationChanged`), inchangé. */
  update(patch: Partial<OuvrageCompositionConfig>): Promise<void>;
  /** Ouvrage uniquement : supprime la composition locale (retour immédiat
   *  à l'héritage de WARPI). Sans effet sur WARPI (jamais `isOuvrage`). */
  resetToProject(): Promise<void>;
};

export type CentralPreviewRefresher = Partial<View> & {
  compileScope: CompileScope | null;
  refreshPreview(): Promise<void>;
};

/** Hôte minimal requis pour construire un binding — un sous-ensemble du
 * plugin, pour que les tests puissent le fabriquer sans instancier
 * FeuilletsPlugin. */
export type CompositionBindingHost = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  /** Rafraîchit UNIQUEMENT les vues Binder — jamais la surface Composition
   *  elle-même (voir main.ts refreshBinderViews) : cohérent avec le
   *  comportement historique du seul champ qui rafraîchissait déjà le
   *  Binder (`level1Role`), désormais étendu à tous les champs. */
  refreshBinderViews(): void;
  /** Aperçu central éventuellement ouvert pour rafraîchir le rendu lors
   *  d'un changement de composition, en conservant strictement la portée. */
  getCentralPreviewView?(): CentralPreviewRefresher | null;
};

/** Construit le binding pour `editorialRoot`, une seule fois par rendu —
 * voir OuvrageCompositionBinding. `globalRoot` reste la racine Feuillets
 * (`getProjectFolder()`), jamais recalculée ici. */
export function createCompositionBinding(
  host: CompositionBindingHost,
  globalRoot: TFolder,
  editorialRoot: TFolder
): OuvrageCompositionBinding {
  const settings = host.settings;
  const isOuvrage = ouvrageRelativePath(globalRoot.path, editorialRoot.path) !== null;
  const value = effectiveComposition(settings, globalRoot, editorialRoot);
  const isInherited = isOuvrage && !hasOuvrageComposition(settings, globalRoot, editorialRoot);

  return {
    value,
    isOuvrage,
    isInherited,
    async update(patch: Partial<OuvrageCompositionConfig>): Promise<void> {
      if (isOuvrage) {
        const changed = updateOuvrageComposition(settings, globalRoot, editorialRoot, value, patch);
        if (!changed) return;
      } else {
        applyGlobalCompositionPatch(settings, globalRoot, patch);
      }
      await host.saveSettings();
      host.refreshBinderViews();
      const preview = host.getCentralPreviewView?.();
      if (preview) await preview.refreshPreview();
    },
    async resetToProject(): Promise<void> {
      if (!isOuvrage) return;
      const changed = clearOuvrageComposition(settings, globalRoot, editorialRoot);
      if (!changed) return;
      await host.saveSettings();
      host.refreshBinderViews();
      const preview = host.getCentralPreviewView?.();
      if (preview) await preview.refreshPreview();
    },
  };
}
