/**
 * Service de Recherche & Remplacement Ulysses pour Feuillets.
 * Supporte :
 * - Portée : Manuscrit uniquement ou Tout le projet (Manuscrit + Fiches + Bible + Notes)
 * - Remplacement intelligent avec préservation de la casse (KEMAL -> ALTAN, Kemal -> Altan, kemal -> altan)
 * - Diacritiques / Accents facultatifs
 * - Modes de correspondance : Contient, Commence par (\bquery), Mot entier (\bquery\b)
 * - Sécurité Frontmatter avec option d'inclusion du YAML
 */

type SearchReplaceOptions = {
  scope?: string;
  caseSensitive?: boolean;
  preserveCase?: boolean;
  ignoreDiacritics?: boolean;
  matchMode?: string;
  useRegex?: boolean;
  includeYaml?: boolean;
  targetFile?: SearchReplaceFile;
};

type SearchReplaceFile = {
  path: string;
  parent?: { path: string } | null;
};

type SearchReplaceApp = {
  vault: {
    getMarkdownFiles?: () => SearchReplaceFile[];
    process: (file: SearchReplaceFile, callback: (content: string) => string) => Promise<void>;
  };
};

type SearchReplacePlugin = {
  getManuscriptFiles?: () => SearchReplaceFile[];
  getProjectFolder?: () => SearchReplaceFile | null;
};

/**
 * Sépare le bloc frontmatter (--- ... ---) du corps du document Markdown.
 * @param {string} content - Le contenu complet du fichier
 * @returns {{ frontmatter: string, body: string }}
 */
export function splitFrontmatter(content: unknown): { frontmatter: string; body: string } {
  if (typeof content !== "string") return { frontmatter: "", body: "" };
  const match = content.match(/^---[\s\S]*?\n---\n?/);
  if (!match) {
    return { frontmatter: "", body: content };
  }
  const frontmatter = match[0];
  const body = content.slice(frontmatter.length);
  return { frontmatter, body };
}

/**
 * Préserve la casse du texte original pour la chaîne de remplacement.
 * Ex: "KEMAL" + "Altan" -> "ALTAN", "Kemal" + "Altan" -> "Altan", "kemal" + "Altan" -> "altan"
 * @param {string} matchText
 * @param {string} replacementText
 * @returns {string}
 */
export function preserveCase(matchText: string, replacementText: string) {
  if (!matchText || !replacementText) return replacementText;

  // TOUT EN MAJUSCULES (ex: "KEMAL")
  if (matchText === matchText.toUpperCase() && matchText !== matchText.toLowerCase()) {
    return replacementText.toUpperCase();
  }

  // Capitalisé / TitleCase (ex: "Kemal")
  if (matchText[0] === matchText[0].toUpperCase() && matchText[0] !== matchText[0].toLowerCase()) {
    const rest = matchText.slice(1);
    if (rest === rest.toLowerCase()) {
      return replacementText.charAt(0).toUpperCase() + replacementText.slice(1).toLowerCase();
    }
  }

  // Tout en minuscules (ex: "kemal")
  if (matchText === matchText.toLowerCase() && matchText !== matchText.toUpperCase()) {
    return replacementText.toLowerCase();
  }

  return replacementText;
}

/**
 * Construit un motif d'expression régulière insensible aux accents.
 * @param {string} str
 * @returns {string}
 */
export function buildDiacriticsPattern(str: string): string {
  const diacriticsMap: Record<string, string> = {
    a: "[aàâäAÀÂÄ]",
    e: "[eéèêëEÉÈÊË]",
    i: "[iîïIÎÏ]",
    o: "[oôöOÔÖ]",
    u: "[uùûüUÙÛÜ]",
    c: "[cçCÇ]",
    n: "[nñNÑ]",
  };
  return str
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      if (diacriticsMap[lower]) {
        return diacriticsMap[lower];
      }
      return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
}

/**
 * Construit l'expression régulière adaptée selon les options choisies.
 * @param {string} searchQuery
 * @param {{ caseSensitive?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean }} options
 * @returns {RegExp|null}
 */
export function buildSearchRegExp(searchQuery: string, options: SearchReplaceOptions = {}): RegExp | null {
  if (!searchQuery) return null;

  const caseSensitive = !!options.caseSensitive;
  const useRegex = !!options.useRegex;
  const ignoreDiacritics = !!options.ignoreDiacritics;
  const matchMode = options.matchMode || "contains"; // "contains", "startsWith", "exactWord"

  const flags = caseSensitive ? "g" : "gi";

  try {
    if (useRegex) {
      return new RegExp(searchQuery, flags);
    }

    let pattern = "";
    if (ignoreDiacritics) {
      pattern = buildDiacriticsPattern(searchQuery);
    } else {
      pattern = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    if (matchMode === "startsWith") {
      pattern = `\\b${pattern}`;
    } else if (matchMode === "exactWord") {
      pattern = `\\b${pattern}\\b`;
    }

    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Effectue la recherche et le remplacement dans un texte complet ou dans son corps hors YAML.
 * @param {string} content - Le texte brut
 * @param {string} searchQuery - Terme ou regex
 * @param {string} replaceQuery - Terme de remplacement
 * @param {{ caseSensitive?: boolean, preserveCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean, includeYaml?: boolean }} options
 * @returns {{ newContent: string, count: number }}
 */
export function replaceInText(content: string | null | undefined, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): { newContent: string; count: number } {
  if (typeof content !== "string" || !searchQuery) {
    return { newContent: content || "", count: 0 };
  }

  const regex = buildSearchRegExp(searchQuery, options);
  if (!regex) return { newContent: content, count: 0 };

  const replaceStr = replaceQuery ?? "";
  const shouldPreserveCase = options.preserveCase !== false && !options.caseSensitive && !options.useRegex;
  const includeYaml = !!options.includeYaml;

  const processBlock = (text: string): { newText: string; count: number } => {
    let count = 0;
    const newText = text.replace(regex, (...args: unknown[]) => {
      count++;
      const matchText = args[0] as string;
      if (options.useRegex) {
        const captures = args.slice(1, -2) as (string | undefined)[];
        let result = replaceStr;
        captures.forEach((cap, idx) => {
          if (cap !== undefined) {
            result = result.replace(new RegExp(`\\$${idx + 1}`, "g"), cap);
          }
        });
        return result;
      }
      if (shouldPreserveCase) {
        return preserveCase(matchText, replaceStr);
      }
      return replaceStr;
    });
    return { newText, count };
  };

  if (includeYaml) {
    const { newText, count } = processBlock(content);
    return { newContent: newText, count };
  }

  const { frontmatter, body } = splitFrontmatter(content);
  const { newText: newBody, count } = processBlock(body);
  return { newContent: frontmatter + newBody, count };
}

/**
 * Récupère tous les fichiers Markdown pertinents selon la portée demandée.
 * @param {object} app
 * @param {object} plugin
 * @param {string} scope - "manuscript" | "project"
 * @returns {Array<object>}
 */
export function getSearchReplaceFiles(app: SearchReplaceApp, plugin: SearchReplacePlugin, scope = "manuscript"): SearchReplaceFile[] {
  if (scope === "manuscript") {
    return plugin.getManuscriptFiles ? plugin.getManuscriptFiles() : [];
  }

  const root = plugin.getProjectFolder ? plugin.getProjectFolder() : null;
  if (!root) return [];

  const baseFolder = root.parent || root;
  const result: SearchReplaceFile[] = [];

  const isMdFile = (item: unknown): boolean => {
    if (!item || typeof (item as { path?: string }).path !== "string") return false;
    const ext = (item as { extension?: string }).extension;
    if (typeof ext === "string") return ext === "md";
    return (item as { path: string }).path.endsWith(".md");
  };

  const collect = (folder: unknown) => {
    if (!folder || !Array.isArray((folder as { children?: unknown[] }).children)) return;
    for (const child of (folder as { children: unknown[] }).children) {
      if (child && Array.isArray((child as { children?: unknown[] }).children)) {
        collect(child);
      } else if (isMdFile(child)) {
        result.push(child as SearchReplaceFile);
      }
    }
  };

  collect(baseFolder);
  return result;
}

/**
 * Applique la recherche/remplacement atomique sur les fichiers ciblés.
 * @param {object} app
 * @param {object} plugin
 * @param {string} searchQuery
 * @param {string} replaceQuery
 * @param {{ scope?: string, caseSensitive?: boolean, preserveCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean, includeYaml?: boolean, targetFile?: object }} options
 * @returns {Promise<{ totalReplacements: number, filesCount: number }>}
 */
export function replaceInManuscriptBody(app: SearchReplaceApp, plugin: SearchReplacePlugin, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): Promise<{ totalReplacements: number; filesCount: number }> {
  return replaceInManuscriptScope(app, plugin, searchQuery, replaceQuery, options);
}

export async function replaceInManuscriptScope(app: SearchReplaceApp, plugin: SearchReplacePlugin, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): Promise<{ totalReplacements: number; filesCount: number }> {
  if (!searchQuery || typeof searchQuery !== "string") {
    return { totalReplacements: 0, filesCount: 0 };
  }

  const scope = options.scope || "manuscript";
  const files = options.targetFile
    ? [options.targetFile]
    : getSearchReplaceFiles(app, plugin, scope);

  let totalReplacements = 0;
  let filesCount = 0;

  for (const file of files) {
    if (!file || !file.path || !file.path.endsWith(".md")) continue;

    let fileReplacedCount = 0;

    await app.vault.process(file, (content) => {
      const { newContent, count } = replaceInText(content, searchQuery, replaceQuery, options);
      if (count > 0) {
        fileReplacedCount = count;
        return newContent;
      }
      return content;
    });

    if (fileReplacedCount > 0) {
      totalReplacements += fileReplacedCount;
      filesCount++;
    }
  }

  return { totalReplacements, filesCount };
}
