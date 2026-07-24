// @ts-check
/** Index de recherche plein texte du binder : le corps de chaque feuillet,
 * sans frontmatter et sans accents, conservé d'un appel à l'autre et
 * réactualisé au coup par coup (voir binderSearchContent, feuillets-view.js).
 *
 * Le cache est la raison d'être du module : une recherche dans le corps des
 * feuillets relit sinon tout le manuscrit à chaque frappe. Seules les fiches
 * dont la `mtime` a bougé sont relues, et les fiches disparues sont évincées
 * pour que le cache ne grossisse pas indéfiniment au fil des suppressions.
 *
 * La lecture est injectée (`readBody`) : le module ne connaît ni le coffre ni
 * Obsidian, et se teste avec un lecteur factice qui compte ses appels.
 *
 * @typedef {{ path: string, stat: { mtime: number } }} IndexableFile
 * @typedef {{ mtime: number, text: string }} IndexEntry
 */

/**
 * Met le cache à jour pour exactement l'ensemble `files`, puis le renvoie.
 *
 * @param {Map<string, IndexEntry>} cache modifié sur place, et renvoyé.
 * @param {IndexableFile[]} files fiches devant figurer dans l'index.
 * @param {(file: IndexableFile) => Promise<string>} readBody corps déjà
 *   débarrassé du frontmatter et normalisé (voir buildSearchIndex).
 * @returns {Promise<Map<string, IndexEntry>>} le `cache` reçu, à jour.
 */
export async function refreshSearchIndex(cache, files, readBody) {
  /** @type {IndexableFile[]|null} */
  let misses = null;
  for (const f of files) {
    const hit = cache.get(f.path);
    if (!hit || hit.mtime !== f.stat.mtime) (misses || (misses = [])).push(f);
  }
  if (misses) {
    await Promise.all(
      misses.map(async (f) => {
        /* mtime capturée AVANT la lecture. Si la fiche change pendant celle-ci,
           on mémorise l'ancienne mtime, et la passe suivante voit l'écart et
           relit. Lire `f.stat.mtime` après l'await ferait l'inverse : la
           nouvelle mtime enregistrée avec l'ancien texte, un index périmé que
           plus rien ne vient corriger. */
        const mtime = f.stat.mtime;
        const text = await readBody(f);
        cache.set(f.path, { mtime, text });
      })
    );
  }
  /* Éviction : seulement quand le cache a plus d'entrées que de fiches
     attendues, pour ne pas reconstruire un Set à chaque frappe. */
  if (cache.size > files.length) {
    const alive = new Set(files.map((f) => f.path));
    for (const key of cache.keys()) {
      if (!alive.has(key)) cache.delete(key);
    }
  }
  return cache;
}
