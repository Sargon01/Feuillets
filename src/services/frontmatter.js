export function fmOf(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  return (cache && cache.frontmatter) || {};
}

export function titleFor(app, file) {
  const fm = fmOf(app, file);
  const t = fm.titre !== undefined ? fm.titre : fm.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  /* repli sur `nom` (+ `prénom` s'il existe) : les fiches personnage
     créées via le panneau Recherche utilisent ces clés plutôt que `titre` */
  const nom = typeof fm.nom === "string" ? fm.nom.trim() : "";
  const prenom = typeof fm["prénom"] === "string" ? fm["prénom"].trim() : "";
  if (prenom && nom) return `${prenom} ${nom}`;
  if (nom) return nom;
  return file.basename;
}

/** Titre court pour les vues denses (plan, binder) : clé `titre_binder`
 * si renseignée, sinon le titre normal. Jamais utilisé à la compilation.
 * Repli sur `titre_court` (ancienne clé, renommée) pour les fiches déjà
 * écrites avant le renommage — ne pas leur faire perdre leur titre court. */
export function shortTitleFor(app, file) {
  const fm = fmOf(app, file);
  const t = fm.titre_binder !== undefined ? fm.titre_binder : fm.titre_court;
  return typeof t === "string" && t.trim() ? t.trim() : titleFor(app, file);
}

/** Titre pour la COMPILATION : clé `titre` uniquement, jamais le nom du fichier. */
export function compiledTitleFor(app, file) {
  const fm = fmOf(app, file);
  const t = fm.titre !== undefined ? fm.titre : fm.title;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/** Sous-titre pour la COMPILATION : clé `sous_titre`, compilé un niveau de
 * titre en dessous de `titre` (ex. titre en H2, sous-titre en H3) — voir
 * compile(), services/compile-export.js. Cas typique : un chapitre
 * Scrivener dont le titre tient sur deux lignes (titre + sous-titre). */
export function compiledSubtitleFor(app, file) {
  const fm = fmOf(app, file);
  const t = fm.sous_titre;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export function tagsOf(app, file) {
  const fm = fmOf(app, file);
  let tags = fm.tags;
  if (typeof tags === "string") tags = tags.split(/[,\s]+/);
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).replace(/^#/, "").trim())
    .filter(Boolean);
}

export function labelOf(app, file) {
  const l = fmOf(app, file).label;
  return typeof l === "string" && l.trim() ? l.trim() : "";
}

export function labelsOf(app, file) {
  const fm = fmOf(app, file);
  let l = fm.label;
  if (Array.isArray(l)) return l.filter(Boolean).map(String);
  if (typeof l === "string" && l.trim()) {
    return l.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  }
  return l ? [String(l).trim()] : [];
}

export function labelColor(settings, name) {
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

export function folderGoal(settings, folder) {
  const g = settings.folderGoals[folder.path];
  return typeof g === "number" && g > 0 ? g : 0;
}
