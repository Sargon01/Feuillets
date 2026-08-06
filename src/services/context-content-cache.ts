/** Cache de contenu pour le Lot 5 (recherche dans le contenu des documents
 * associés, panneau Contexte) — SÉPARÉ de `_searchCache`
 * (base-feuillets-view.ts, utils/search-index.ts) qui appartient à la
 * Recherche générale du projet (tout le binder) : le Lot 5 ne doit jamais
 * en dépendre ni y contribuer.
 *
 * Même patron que `utils/search-index.ts` (refreshSearchIndex) — relire
 * uniquement les fichiers dont la `mtime` a changé, évincer ceux qui
 * disparaissent de la liste `files` — mais avec une entrée plus riche par
 * fichier (titre, source, priorité) puisque le Lot 5 doit aussi trier par
 * source (feuillet avant chapitre) et exclure toute fiche déjà remontée par
 * le moteur fiable (Lot 3), ce que le cache générique de recherche plein
 * texte n'a pas besoin de connaître.
 *
 * La lecture est injectée (`readRaw`) : ce module ne connaît ni le coffre ni
 * Obsidian, et se teste avec un lecteur factice qui compte ses appels.
 */

export type ContentSourceKind = "feuillet" | "chapter";

export interface ContentCacheableFile {
  path: string;
  basename: string;
  title: string;
  sourceKind: ContentSourceKind;
  sourcePriority: number;
  stat: { mtime: number };
}

export interface ContentCacheEntry {
  path: string;
  mtime: number;
  basename: string;
  title: string;
  /** Corps Markdown nettoyé (YAML/code/embeds retirés, liens ramenés à leur
   * texte lisible, marqueurs Markdown neutralisés) — voir cleanMarkdownBody.
   * Jamais le Markdown brut : ni le matcher ni l'extrait n'ont besoin de
   * revoir la syntaxe. */
  cleanedBody: string;
  sourceKind: ContentSourceKind;
  sourcePriority: number;
}

/**
 * Retire le frontmatter YAML, les blocs de code (clôturés ou en ligne), les
 * embeds (`![[...]]`) et les destinations techniques des liens (URL de
 * `[texte](url)`, ancre/bloc-référence de `[[cible#ancre|alias]]`), tout en
 * conservant le texte lisible (alias ou cible d'un lien wiki, libellé d'un
 * lien Markdown). Neutralise ensuite les marqueurs de mise en forme
 * (titres, citation, listes, emphase, règles horizontales) sans toucher au
 * texte qu'ils entourent. Fonction pure, déterministe, sans dépendance à
 * Obsidian — testable isolément.
 */
export function cleanMarkdownBody(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // 1. Frontmatter YAML en tête de fichier.
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");

  // 2. Blocs de code clôturés (```lang\n...\n```), y compris leur contenu.
  text = text.replace(/```[\s\S]*?```/g, " ");

  // 3. Code en ligne (`...`).
  text = text.replace(/`[^`\n]*`/g, " ");

  // 4. Embeds (image, fichier, bloc/section) — entièrement techniques.
  text = text.replace(/!\[\[[^\]]*\]\]/g, " ");

  // 5. Liens wiki [[cible#ancre|alias]] -> texte lisible seul (alias si
  //    présent, sinon le dernier segment de la cible ; ancre/bloc-référence
  //    toujours retirés).
  text = text.replace(
    /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_m: string, target: string, alias?: string) => {
      if (alias && alias.trim()) return alias.trim();
      const segments = (target || "").split("/");
      return (segments[segments.length - 1] || "").trim();
    }
  );

  // 6. Liens Markdown [texte](url) / images ![texte](url) -> texte seul.
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, (_m: string, label: string) => label || "");

  // 7. Autoliens / URL brutes.
  text = text.replace(/<https?:\/\/[^>]+>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, " ");

  // 8. Neutralisation des marqueurs Markdown restants (titres, citation,
  //    listes, règles horizontales, emphase, barré) — le texte encadré est
  //    conservé, seul le marqueur disparaît.
  text = text
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}>+\s?/gm, "")
    .replace(/^ {0,3}[-*+]\s+/gm, "")
    .replace(/^ {0,3}\d+[.)]\s+/gm, "")
    .replace(/^ {0,3}([-*_])(?: *\1){2,}\s*$/gm, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}])_([^_]+)_(?![\p{L}\p{N}])/gu, "$1")
    .replace(/~~([^~]+)~~/g, "$1");

  // Espaces/lignes excédentaires laissés par les retraits ci-dessus.
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Met à jour `cache` pour exactement l'ensemble `files`, puis renvoie les
 * entrées correspondantes DANS L'ORDRE de `files` (ordre stable : c'est
 * l'appelant — collecte feuillet puis chapitre — qui fixe cet ordre, jamais
 * recalculé ici).
 *
 * - Un fichier absent du cache ou dont la `mtime` a changé est relu via
 *   `readRaw` et son corps renettoyé (cleanMarkdownBody) ; c'est la SEULE
 *   opération coûteuse.
 * - Un fichier déjà en cache avec la même `mtime` garde son corps nettoyé
 *   tel quel, mais `title`/`basename`/`sourceKind`/`sourcePriority` sont
 *   toujours rafraîchis (champs bon marché, déjà en mémoire côté appelant) :
 *   un changement d'association Binder ↔ Recherche change le `sourceKind`
 *   d'un fichier sans toucher à sa `mtime`, et doit rester visible sans
 *   relecture disque.
 * - Toute entrée du cache dont le chemin n'est plus dans `files` (fiche
 *   supprimée, déplacée, ou sortie du périmètre associé) est évincée.
 */
export async function refreshContentCache(
  cache: Map<string, ContentCacheEntry>,
  files: ContentCacheableFile[],
  readRaw: (file: ContentCacheableFile) => Promise<string>
): Promise<ContentCacheEntry[]> {
  let misses: ContentCacheableFile[] | null = null;
  for (const f of files) {
    const hit = cache.get(f.path);
    if (!hit || hit.mtime !== f.stat.mtime) (misses || (misses = [])).push(f);
  }

  if (misses) {
    await Promise.all(
      misses.map(async (f) => {
        // mtime capturée AVANT la lecture — voir utils/search-index.ts pour
        // la justification (même règle, même risque de course évité).
        const mtime = f.stat.mtime;
        const raw = await readRaw(f);
        const cleanedBody = cleanMarkdownBody(raw);
        cache.set(f.path, {
          path: f.path,
          mtime,
          basename: f.basename,
          title: f.title,
          cleanedBody,
          sourceKind: f.sourceKind,
          sourcePriority: f.sourcePriority,
        });
      })
    );
  }

  // Métadonnées bon marché rafraîchies même sur un hit de cache (pas de
  // relecture disque, seulement les champs déjà connus de l'appelant).
  for (const f of files) {
    const entry = cache.get(f.path);
    if (entry && entry.mtime === f.stat.mtime) {
      entry.basename = f.basename;
      entry.title = f.title;
      entry.sourceKind = f.sourceKind;
      entry.sourcePriority = f.sourcePriority;
    }
  }

  // Éviction : fiches supprimées, déplacées (nouveau path = nouvelle clé,
  // l'ancienne n'est plus dans `files`), ou sorties du périmètre associé.
  if (cache.size > files.length) {
    const alive = new Set(files.map((f) => f.path));
    for (const key of cache.keys()) {
      if (!alive.has(key)) cache.delete(key);
    }
  }

  return files
    .map((f) => cache.get(f.path))
    .filter((e): e is ContentCacheEntry => !!e);
}
