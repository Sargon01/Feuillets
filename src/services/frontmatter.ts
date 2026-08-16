import type { App, TFile, TFolder } from "obsidian";

/** Lecture du frontmatter des feuillets. Vérifié par `tsc` (voir types.d.ts) :
 * ce module est la porte d'entrée de toutes les données YAML du plugin, donc
 * l'endroit où une faute de frappe sur un nom de clé coûte le plus cher. */

/** Traduction progressive du vocabulaire frontmatter (français → anglais,
 * voir CHANGELOG) : nouvelle clé → ancienne(s) clé(s) lue(s) en repli si la
 * nouvelle est absente. Écriture en dur uniquement — aucune fiche existante
 * n'est réécrite ; une fiche déjà écrite avec l'ancienne clé continue de se
 * lire normalement via ce mécanisme, pour toujours. Tout code qui ÉCRIT du
 * frontmatter doit désormais utiliser la clé de droite (nouvelle) partout ;
 * seule la lecture (fmOf) connaît encore l'ancienne. */
const LEGACY_FIELD_ALIASES: Record<string, string[]> = {
  title: ["titre"],
  short_title: ["titre_binder", "titre_court"],
  summary: ["resume"],
  order: ["ordre"],
  status: ["statut"],
  thread: ["fil"],
  characters: ["personnages", "persos"],
  goal: ["objectif"],
  last_name: ["nom"],
  first_name: ["prénom"],
  author: ["auteur"],
  pace: ["rythme"],
  publisher: ["editeur", "edition"],
  subtitle: ["sous_titre"],
  arc_secondary: ["arc_secondaire"],
  role: ["fonction"],
  end_date: ["date_fin"],
  birth: ["naissance"],
  death: ["mort"],
  compile: ["compiler"],
};

/**
 * Retire le frontmatter YAML en TÊTE d'un contenu de feuillet — et lui seul.
 *
 * Seule définition de ce découpage dans le plugin : la compilation
 * (`readBody`, compile-export.ts) et l'aperçu (PreviewView) l'utilisent
 * toutes deux, faute de quoi l'aperçu montrerait un YAML que l'export ne
 * contient pas (c'était exactement le défaut constaté).
 *
 * Le YAML est une MÉTADONNÉE : jamais du corps de manuscrit. Rendu tel quel
 * en Markdown, `---\ntitle: X\n---` ne produit d'ailleurs pas « du texte
 * bizarre » mais un `<hr>` suivi d'un TITRE setext `<h2>` — donc, dans
 * l'aperçu paginé, un saut de page avant le premier mot du feuillet.
 *
 * Règles :
 * - le bloc doit commencer à la PREMIÈRE ligne (un `---` en cours de texte
 *   est un séparateur horizontal Markdown parfaitement légitime, jamais
 *   touché) ;
 * - fins de ligne LF comme CRLF (feuillets importés de Windows) ;
 * - frontmatter VIDE (`---` suivi immédiatement de `---`) également retiré —
 *   cas que l'ancienne expression régulière de la compilation laissait
 *   passer, faisant fuiter deux `---` dans le texte compilé ;
 * - jamais d'écriture : le fichier source n'est pas modifié.
 */
const FRONTMATTER_BLOCK_RE = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function stripFrontmatter(content: string): string {
  if (typeof content !== "string" || !content) return "";
  // \uFEFF : BOM d'un fichier importé — sinon le `---` n'est plus en tête.
  return content.replace(FRONTMATTER_BLOCK_RE, "");
}

/**
 * Comme `stripFrontmatter`, mais rend AUSSI le bloc YAML retiré (délimiteurs
 * `---` compris), pour l'appelant qui doit le reposer tel quel ensuite
 * (Scrivenings : chaque segment garde son frontmatter d'origine pour la
 * sauvegarde — voir services/scrivenings-document.ts). Mêmes règles que
 * `stripFrontmatter` (BOM, CRLF, YAML vide) : un seul découpage, jamais une
 * seconde expression régulière qui pourrait diverger.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (typeof content !== "string" || !content) return { frontmatter: "", body: "" };
  const match = content.match(FRONTMATTER_BLOCK_RE);
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/** Frontmatter RAW d'un feuillet : exactement ce qui est physiquement dans
 * le fichier — aucune projection, aucun alias, aucun mapping de projet.
 * Copie superficielle systématique (jamais l'objet vivant de MetadataCache)
 * : un inspecteur générique des propriétés (ProjectPropertiesModal…) qui
 * modifierait le résultat par erreur ne doit jamais pouvoir corrompre le
 * cache d'Obsidian. À réserver aux vues qui affichent volontairement la clé
 * PHYSIQUE d'un fichier (ex. « Synopsis: » doit s'afficher « Synopsis », pas
 * « Synopsis » + « synopsis ») — tout le reste continue d'utiliser fmOf(). */
export function rawFrontmatterOf(app: App, file: TFile | null | undefined): Record<string, unknown> {
  if (!file || !file.path) return {};
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache && cache.frontmatter;
  return fm ? { ...(fm as Record<string, unknown>) } : {};
}

/** Chemin du dossier racine du projet actif, tel que stocké tel quel dans
 * les réglages — même repli que labelColor() ci-dessous (aucune résolution
 * Vault ici : services/folder-structure.ts importe déjà ce module, une
 * dépendance dans l'autre sens créerait un cycle). */
function activeProjectRootPath(settings: FeuilletsSettings | null | undefined): string {
  return settings && typeof settings.projectFolder === "string" ? settings.projectFolder : "";
}

function activeMetaFor(settings: FeuilletsSettings | null | undefined): ProjectMeta | null {
  const rootPath = activeProjectRootPath(settings).trim();
  if (!rootPath || !settings || !settings.projectMeta) return null;
  return settings.projectMeta[rootPath] || null;
}

/** Garde-fou §12/§14 du chantier « mapping YAML » : un `propertyMap` de
 * projet ne doit JAMAIS s'appliquer à un fichier d'un AUTRE projet (ex. un
 * fichier de recherche resté ouvert après un changement de projet). Simple
 * comparaison de préfixe de chemin — volontairement pas de scan Vault. */
function fileInActiveProjectScope(settings: FeuilletsSettings | null | undefined, file: TFile): boolean {
  const root = activeProjectRootPath(settings).trim();
  if (!root) return false;
  return file.path === root || file.path.startsWith(root + "/");
}

export const MAPPABLE_FIELDS: MappableFrontmatterField[] = [
  "synopsis", "summary", "status", "pov", "label", "goal", "thread", "characters", "date",
];

/** Garde de type : `key` est-elle l'une des 9 clés logiques mappables ? Sert
 * à router BaseFeuilletsView.setFm() (§18) vers writeLogicalFrontmatterField
 * pour ces clés-là uniquement — tout le reste (tags, colonnes calculées…)
 * continue d'écrire la clé RAW exacte, comme avant ce chantier. */
export function isMappableField(key: string): key is MappableFrontmatterField {
  return (MAPPABLE_FIELDS as string[]).includes(key);
}

/** Première clé de `raw` qui diffère de `key` uniquement par la casse, ou
 * `undefined` — jamais de comparaison approximative (§15 : « Uniquement
 * case-insensitive. Pas de fuzzy matching. »). */
function findCaseInsensitiveKey(raw: Record<string, unknown>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const k of Object.keys(raw)) {
    if (k !== key && k.toLowerCase() === lower) return k;
  }
  return undefined;
}

/** Résolution d'UN champ mappable pour la LECTURE, dans l'ordre exact du
 * §16 du chantier : 1. mapping explicite (si sa cible a une valeur dans CE
 * fichier — sinon on continue, un mapping configuré ne doit pas faire
 * disparaître une valeur simplement absente sous cette clé ICI) ; 2. clé
 * canonique exacte ; 3. variante de casse unique de la clé canonique ;
 * 4. alias hérité exact ; 5. variante de casse d'un alias hérité. */
function resolveMappableField(
  raw: Record<string, unknown>,
  field: MappableFrontmatterField,
  propertyMap: Partial<Record<MappableFrontmatterField, string>> | undefined,
): unknown {
  const mapped = propertyMap && propertyMap[field];
  if (mapped && raw[mapped] !== undefined) return raw[mapped];
  if (raw[field] !== undefined) return raw[field];
  const caseVariant = findCaseInsensitiveKey(raw, field);
  if (caseVariant !== undefined) return raw[caseVariant];
  const aliases = LEGACY_FIELD_ALIASES[field] || [];
  for (const alias of aliases) {
    if (raw[alias] !== undefined) return raw[alias];
  }
  for (const alias of aliases) {
    const aliasCaseVariant = findCaseInsensitiveKey(raw, alias);
    if (aliasCaseVariant !== undefined) return raw[aliasCaseVariant];
  }
  return undefined;
}

/** Frontmatter LOGIQUE consommé par Feuillets partout dans l'app : alias
 * hérités (voir withLegacyFieldAliases) toujours actifs, et — quand
 * `settings` est fourni ET que le fichier appartient au projet actif —
 * mapping de projet + tolérance de casse pour les 9 champs mappables
 * (§12-16 du chantier « mapping YAML »). `settings` omis (ou fichier hors
 * du projet actif) : comportement strictement identique à avant ce
 * chantier, pour tous les appelants qui n'ont pas besoin du mapping. */
export function fmOf(app: App, file: TFile | null | undefined, settings?: FeuilletsSettings | null): SceneFrontmatter {
  if (!file || !file.path) return {};
  const cache = app.metadataCache.getFileCache(file);
  const raw = (cache && cache.frontmatter) as SceneFrontmatter || {};
  const aliased = withLegacyFieldAliases(raw);
  if (!settings || !fileInActiveProjectScope(settings, file)) return aliased;

  const propertyMap = activeMetaFor(settings)?.propertyMap;
  let out = aliased;
  for (const field of MAPPABLE_FIELDS) {
    const resolved = resolveMappableField(raw, field, propertyMap);
    if (resolved !== undefined && resolved !== out[field]) {
      if (out === aliased) out = { ...aliased };
      (out as Record<string, unknown>)[field] = resolved;
    }
  }
  return out;
}

/** Écriture LOGIQUE d'UN champ mappable (§17) : jamais un accès disque
 * direct, toujours `app.fileManager.processFrontMatter`. Détermine la clé
 * YAML RÉELLE à écrire : A) mapping configuré → cette clé, quelle qu'elle
 * soit ; B) sinon, clé canonique déjà présente exactement → inchangée ;
 * C) sinon, variante de casse déjà présente → cette variante (ne JAMAIS
 * créer une seconde clé en minuscules à côté d'une existante) ; D) sinon,
 * la clé canonique Feuillets (nouvelle propriété). Valeur vide/nulle/
 * indéfinie/tableau vide : supprime uniquement la clé cible résolue. */
export async function writeLogicalFrontmatterField(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  file: TFile,
  field: MappableFrontmatterField,
  value: unknown,
): Promise<void> {
  const raw = rawFrontmatterOf(app, file);
  const inScope = fileInActiveProjectScope(settings, file);
  const mapped = inScope ? activeMetaFor(settings)?.propertyMap?.[field] : undefined;

  let targetKey: string;
  if (mapped) {
    targetKey = mapped;
  } else if (Object.prototype.hasOwnProperty.call(raw, field)) {
    targetKey = field;
  } else {
    targetKey = findCaseInsensitiveKey(raw, field) || field;
  }

  const isEmpty =
    value === "" || value === null || value === undefined ||
    (Array.isArray(value) && value.length === 0);
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (isEmpty) delete fm[targetKey];
    else fm[targetKey] = value;
  });
}

/** N'alloue une copie que si au moins un alias hérité s'applique réellement
 * — une fiche déjà en clés anglaises traverse cette fonction sans coût. */
function withLegacyFieldAliases(fm: SceneFrontmatter): SceneFrontmatter {
  let out = fm;
  for (const newKey in LEGACY_FIELD_ALIASES) {
    if (fm[newKey] !== undefined) continue;
    for (const oldKey of LEGACY_FIELD_ALIASES[newKey]) {
      if (fm[oldKey] !== undefined) {
        if (out === fm) out = { ...fm };
        out[newKey] = fm[oldKey];
        break;
      }
    }
  }
  return out;
}

/** Titre d'affichage : `title`, sinon `first_name`/`last_name` pour les
 * fiches personnage, sinon le nom du fichier — jamais vide. */
export function titleFor(app: App, file: TFile): string {
  if (!file) return "";
  const fm = fmOf(app, file);
  if (fm.type === "titre") {
    return file.basename || "Page de titre";
  }
  const t = fm.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  /* repli sur `last_name` (+ `first_name` s'il existe) : les fiches
     personnage créées via le panneau Recherche utilisent ces clés plutôt
     que `title` */
  const lastName = typeof fm.last_name === "string" ? fm.last_name.trim() : "";
  const firstName = typeof fm.first_name === "string" ? fm.first_name.trim() : "";
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (lastName) return lastName;
  return file.basename || "";
}

/** Titre court pour les vues denses (plan, binder) : clé `short_title` si
 * renseignée, sinon le titre normal. Jamais utilisé à la compilation. */
export function shortTitleFor(app: App, file: TFile): string {
  if (!file) return "";
  const fm = fmOf(app, file);
  const t = fm.short_title;
  return typeof t === "string" && t.trim() ? t.trim() : titleFor(app, file);
}

/** Titre pour la COMPILATION : clé `title` uniquement, jamais le nom du fichier. */
export function compiledTitleFor(app: App, file: TFile): string | null {
  const fm = fmOf(app, file);
  const t = fm.title;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/** Sous-titre pour la COMPILATION : clé `subtitle`, compilé un niveau de
 * titre en dessous de `title` (ex. titre en H2, sous-titre en H3) — voir
 * compile(), services/compile-export.js. Cas typique : un chapitre
 * Scrivener dont le titre tient sur deux lignes (titre + sous-titre). */
export function compiledSubtitleFor(app: App, file: TFile): string | null {
  const fm = fmOf(app, file);
  const t = fm.subtitle;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/** Tags normalisés (sans `#`, sans vides). Accepte une liste YAML comme une
 * chaîne séparée par virgules/espaces. */
export function tagsOf(app: App, file: TFile): string[] {
  const fm = fmOf(app, file);
  let tags = fm.tags;
  if (typeof tags === "string") tags = tags.split(/[,\s]+/);
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).replace(/^#/, "").trim())
    .filter(Boolean);
}

/** Premier label sous forme de chaîne simple, `""` si aucun. */
export function labelOf(app: App, file: TFile): string {
  return labelsOf(app, file)[0] || "";
}

/** Tous les labels d'un feuillet (un feuillet peut en porter plusieurs). */
export function labelsOf(app: App, file: TFile): string[] {
  const fm = fmOf(app, file);
  const l = fm.label !== undefined ? fm.label : fm.labels;
  if (Array.isArray(l)) return l.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  if (typeof l === "string" && l.trim()) {
    return l.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  }
  return l ? [String(l).trim()] : [];
}

/** Couleur d'un label : celle définie dans la palette du projet (ou globale),
 * sinon une couleur stable dérivée du nom, piochée dans cette même palette —
 * pour qu'un arc jamais déclaré ait quand même toujours la même couleur. */
export function labelColor(settings: FeuilletsSettings, name: string): string | null {
  const rootPath = settings.projectFolder;
  const meta = rootPath && settings.projectMeta ? settings.projectMeta[rootPath] : null;
  const labels = (meta && meta.labels) ? meta.labels : (settings.labels || []);

  const found = labels.find((l) => l.name === name);
  if (found) return found.color;
  if (name) {
    // Génère une couleur stable issue de la palette de l'utilisateur pour cet arc
    const palette = labels.map((l) => l.color).filter(Boolean);
    if (palette.length === 0) return "#5a8fd9";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % palette.length;
    return palette[idx];
  }
  return null;
}

/** Objectif de mots d'un dossier, `0` si non défini ou invalide. */
export function folderGoal(settings: FeuilletsSettings, folder: TFolder): number {
  const g = settings.folderGoals[folder.path];
  return typeof g === "number" && g > 0 ? g : 0;
}
