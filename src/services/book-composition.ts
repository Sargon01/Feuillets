/** Modèle commun de composition de l'ouvrage (Phase 4).
 *
 * Pose la structure de données partagée AVANT d'ajouter pages liminaires,
 * sommaire, tables, bibliographie, annexes et index (leurs phases
 * respectives) : ce module ne génère encore aucun contenu, ne modifie
 * aucun moteur d'export et n'introduit aucune UI. Première page continue
 * d'être gérée par FirstPagePanel (ui/first-page-panel.ts) exactement comme
 * aujourd'hui — "first-page" n'est ici qu'un identifiant réservé, au même
 * titre que les sept autres, pour que le futur modèle commun d'ordre et
 * d'inclusion (Phase 4 du chantier Édition) puisse un jour la représenter
 * sans double implémentation.
 *
 * Trois natures de contenu, jamais mélangées :
 * - "written" : contenu réellement écrit dans un fichier Markdown propre à
 *   l'élément (ex. première page, pages liminaires, bibliographie) ;
 * - "integrated" : contenu existant du manuscrit RÉFÉRENCÉ, jamais copié
 *   (ex. annexes constituées de feuillets déjà présents dans le Binder) ;
 * - "generated" : contenu calculé automatiquement à la compilation, sans
 *   fichier Markdown propre (ex. sommaire, table des matières, index).
 *
 * Aucun contenu Markdown n'est dupliqué par ce modèle : "written" et
 * "integrated" pointent tous deux vers une source déjà unique — c'est
 * justement pour éviter la duplication que ces deux natures sont
 * distinguées de "generated".
 */

export type CompositionKind = "written" | "integrated" | "generated";

export type CompositionItem = {
  id: string;
  kind: CompositionKind;
  included: boolean;
  order: number;
};

/** Identifiants des éléments de composition, dans leur ordre de lecture par
 * défaut. `manuscript` représente le corps du roman lui-même (chapitres et
 * scènes déjà organisés dans le Binder) — un élément "integrated" comme un
 * autre : référencé, jamais copié. `summary`/`toc` (Phase 6), `tables`
 * (Phase 7, Table des illustrations — services/tables-generator.ts) et
 * `bibliography` (Phase 8, services/bibliography-generator.ts) sont les
 * éléments "generated" réellement câblés à la compilation. `annexes`
 * (Phase 9) est câblé lui aussi, mais reste "integrated" : de vrais
 * fichiers Markdown de Manuscrit/Annexes ou Manuscrit/Appendices,
 * éditables normalement dans le Binder — voir services/compile-export.ts
 * (annexesFolder/annexesFiles). Seul `index` reste réservé pour sa propre
 * phase. */
export const FIRST_PAGE = "first-page";
export const FRONT_MATTER = "front-matter";
export const SUMMARY = "summary";
export const TOC = "toc";
export const MANUSCRIPT = "manuscript";
export const TABLES = "tables";
export const BIBLIOGRAPHY = "bibliography";
export const ANNEXES = "annexes";
export const INDEX = "index";

/** Nature de chaque identifiant — fixe, indépendante de l'ordre ou de
 * l'inclusion (voir defaultComposition ci-dessous). */
const DEFAULT_KINDS: Record<string, CompositionKind> = {
  [FIRST_PAGE]: "written",
  [FRONT_MATTER]: "written",
  [SUMMARY]: "generated",
  [TOC]: "generated",
  [MANUSCRIPT]: "integrated",
  [TABLES]: "generated",
  /* Phase 8 : la bibliographie FINALE (celle du modèle commun de
     composition) est calculée depuis les fiches de Recherche →
     Bibliographie/Bibliography (services/bibliography-generator.ts) — les
     fiches elles-mêmes restent "written" individuellement, mais l'élément
     de composition qui les assemble est "generated", comme summary/toc/
     tables. */
  [BIBLIOGRAPHY]: "generated",
  [ANNEXES]: "integrated",
  [INDEX]: "generated",
};

/** Ordre de lecture par défaut d'un ouvrage : avant le manuscrit (première
 * page, pages liminaires, sommaire, table des matières), le manuscrit
 * lui-même, puis après lui (tables, bibliographie, annexes, index). */
const DEFAULT_ORDER: string[] = [
  FIRST_PAGE,
  FRONT_MATTER,
  SUMMARY,
  MANUSCRIPT,
  TABLES,
  BIBLIOGRAPHY,
  ANNEXES,
  INDEX,
  TOC,
];

/** Première page et le manuscrit lui-même sont aujourd'hui réellement
 * fonctionnels : le manuscrit est déjà compilé dans tous les cas (Phase 6
 * ne fait qu'inscrire sa place dans le modèle commun, pas une bascule
 * réelle — voir compile-export.ts, qui ne lit jamais cet indicateur pour le
 * corps du roman). Les autres restent réservés mais pas encore implémentés,
 * donc exclus par défaut — l'inclusion reste toujours explicite, jamais
 * devinée. */
const DEFAULT_INCLUDED: ReadonlySet<string> = new Set([FIRST_PAGE, MANUSCRIPT]);

/** Composition par défaut de l'ouvrage : une nouvelle liste à chaque appel
 * (jamais une référence partagée) pour qu'aucun appelant ne puisse muter
 * l'état d'un autre en modifiant le tableau qu'il a reçu. */
export function defaultComposition(): CompositionItem[] {
  return DEFAULT_ORDER.map((id, index) => ({
    id,
    kind: DEFAULT_KINDS[id],
    included: DEFAULT_INCLUDED.has(id),
    order: index,
  }));
}

/** Tri déterministe par `order` croissant — stable (deux éléments de même
 * `order`, cas qui ne devrait pas se produire mais que rien n'empêche
 * mécaniquement, conservent leur ordre relatif d'origine). Ne mute jamais
 * le tableau reçu. */
export function orderedComposition(items: CompositionItem[]): CompositionItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** Sous-ensemble réellement inclus, dans l'ordre déterministe ci-dessus —
 * jamais dans l'ordre d'arrivée du tableau reçu, pour rester cohérent
 * quelle que soit la provenance de `items`. */
export function includedComposition(items: CompositionItem[]): CompositionItem[] {
  return orderedComposition(items).filter((item) => item.included);
}

/* ===================== Inclusion des éléments générés (Phase 6) ==========
 * Seuls les éléments "generated" (aujourd'hui : summary, toc) ont besoin
 * d'un état inclus/exclu persistant — les autres natures se règlent déjà
 * ailleurs (compile sur le fichier Front pour "written"/"integrated", voir
 * FirstPagePanel/FrontMatterPanel). Pas de nouveau système de réglages :
 * l'état vit dans `ProjectMeta`, le même objet par-projet que tout le
 * reste (voir project-modals.ts) — sous une seule clé dédiée, pour ne
 * jamais entrer en collision avec un futur champ ProjectMeta. */
const COMPOSITION_META_KEY = "composition";

type CompositionMeta = Record<string, boolean>;

function compositionMetaOf(meta: ProjectMeta): CompositionMeta {
  const raw = meta[COMPOSITION_META_KEY];
  return raw && typeof raw === "object" ? (raw as CompositionMeta) : {};
}

/** État inclus/exclu persisté d'un élément généré — `undefined` si jamais
 * réglé, auquel cas l'appelant retombe sur le défaut de
 * `defaultComposition()` (voir compile-export.ts). */
export function readGeneratedIncluded(meta: ProjectMeta, id: string): boolean | undefined {
  const value = compositionMetaOf(meta)[id];
  return typeof value === "boolean" ? value : undefined;
}

/** Écrit l'état inclus/exclu d'un élément généré — mute `meta` en place
 * (comme le reste de `settings.projectMeta`, écrit champ par champ ailleurs
 * dans le plugin) sans jamais remplacer les autres clés qu'il porte déjà. */
export function writeGeneratedIncluded(meta: ProjectMeta, id: string, included: boolean): void {
  meta[COMPOSITION_META_KEY] = { ...compositionMetaOf(meta), [id]: included };
}
