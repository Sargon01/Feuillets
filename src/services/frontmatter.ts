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
export function stripFrontmatter(content: string): string {
  if (typeof content !== "string" || !content) return "";
  // \uFEFF : BOM d'un fichier importé — sinon le `---` n'est plus en tête.
  return content.replace(/^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/, "");
}

export function fmOf(app: App, file: TFile | null | undefined): SceneFrontmatter {
  if (!file || !file.path) return {};
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) as SceneFrontmatter || {};
  return withLegacyFieldAliases(fm);
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
