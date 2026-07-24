/**
 * Moteur de Recherche et Remplacement Multi-Fichiers pour Feuillets.
 * - Ne dépend PAS de CodeMirror pour la recherche globale.
 * - Lit le Vault/Projet directement avec app.vault.read() / app.vault.process().
 * - Scope : "document" (document actif) ou "manuscript" (dossier parent du document actif).
 * - Regex avec diacritiques, casse, matchMode ("contains", "startsWith", "wholeWord").
 * - Calcule les positions de ligne/colonne pour la navigation inter-fichiers.
 */

import { splitFrontmatter, preserveCase } from "./manuscript-search-replace.js";

export class FeuilletsSearchEngine {
  /**
   * Construit la Regex selon la requête et les options de recherche.
   * @param {string} query
   * @param {{ ignoreCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean }} options
   * @returns {RegExp|null}
   */
  static buildRegex(query, options = {}) {
    if (!query || typeof query !== "string") return null;

    const useRegex = !!options.useRegex;
    const ignoreCase = options.ignoreCase !== false;
    const ignoreDiacritics = !!options.ignoreDiacritics;
    const matchMode = options.matchMode || "contains"; // "contains", "startsWith", "wholeWord"

    const flags = `g${ignoreCase ? "i" : ""}`;

    try {
      if (useRegex) {
        return new RegExp(query, flags);
      }

      // Remplacement des jetons invisibles
      let pattern = query
        .replace(/\\\[TAB\\\]/g, "\\t")
        .replace(/\\\[PARAGRAPHE\\\]/g, "(?:\\r?\\n){2,}")
        .replace(/\\\[LIGNE\\\]/g, "\\r?\\n");

      if (ignoreDiacritics) {
        pattern = pattern
          .replace(/[aàáâãäåAÀÁÃÄÅ]/g, "[aàáâãäåAÀÁÃÄÅ]")
          .replace(/[eèéêëEÈÉÊË]/g, "[eèéêëEÈÉÊË]")
          .replace(/[iìíîïIÌÍÎÏ]/g, "[iìíîïIÌÍÎÏ]")
          .replace(/[oòóôõöOÒÓÔÕÖ]/g, "[oòóôõöOÒÓÔÕÖ]")
          .replace(/[uùúûüUÙÚÛÜ]/g, "[uùúûüUÙÚÛÜ]")
          .replace(/[cçCÇ]/g, "[cçCÇ]")
          .replace(/[nñNÑ]/g, "[nñNÑ]");
      } else {
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      if (matchMode === "startsWith") {
        pattern = `\\b${pattern}`;
      } else if (matchMode === "wholeWord") {
        pattern = `\\b${pattern}\\b`;
      }

      return new RegExp(pattern, flags);
    } catch (e) {
      return null;
    }
  }

  /**
   * Récupère la liste des fichiers selon la portée choisie.
   * @param {object} app
   * @param {object} plugin
   * @param {string} scopeOption - "document" | "manuscript"
   * @param {object} activeFile
   * @returns {Array<object>}
   */
  static getScopedFiles(app, plugin, scopeOption = "manuscript", activeFile = null) {
    const currentFile = activeFile || (app.workspace ? app.workspace.getActiveFile() : null);

    if (scopeOption === "document") {
      return currentFile ? [currentFile] : [];
    }

    // Scope "manuscript" : uniquement les fichiers .md situés dans le même dossier parent que le document actif
    if (currentFile && currentFile.parent && currentFile.parent.children) {
      return currentFile.parent.children.filter((file) => file && file.extension === "md");
    }

    return plugin.getManuscriptFiles ? plugin.getManuscriptFiles() : [];
  }

  /**
   * Recherche toutes les occurrences dans le périmètre demandé.
   * @param {object} app
   * @param {object} plugin
   * @param {string} query
   * @param {{ scope?: string, ignoreCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean, includeYaml?: boolean, activeFile?: object }} options
   * @returns {Promise<{ occurrences: Array<object>, totalCount: number, filesCount: number }>}
   */
  static async searchInVault(app, plugin, query, options = {}) {
    if (!query || typeof query !== "string") {
      return { occurrences: [], totalCount: 0, filesCount: 0 };
    }

    const regex = this.buildRegex(query, options);
    if (!regex) return { occurrences: [], totalCount: 0, filesCount: 0 };

    const files = this.getScopedFiles(app, plugin, options.scope, options.activeFile);
    const occurrences = [];
    let filesCount = 0;

    for (const file of files) {
      if (!file || !file.path || !file.path.endsWith(".md")) continue;

      let content = "";
      try {
        content = await app.vault.read(file);
      } catch (e) {
        continue;
      }

      if (typeof content !== "string") continue;

      const includeYaml = !!options.includeYaml;
      const frontmatterLength = includeYaml ? 0 : splitFrontmatter(content).frontmatter.length;
      const textToSearch = content.slice(frontmatterLength);

      regex.lastIndex = 0;
      const matches = [...textToSearch.matchAll(regex)];

      if (matches.length > 0) {
        filesCount++;
        for (const match of matches) {
          const absIndex = frontmatterLength + match.index;
          const matchText = match[0];

          // Calcul de la ligne et de la colonne dans le document
          const textBefore = content.slice(0, absIndex);
          const lines = textBefore.split("\n");
          const line = lines.length - 1;
          const ch = lines[lines.length - 1].length;

          // Extrait de contexte
          const startContext = Math.max(0, absIndex - 30);
          const endContext = Math.min(content.length, absIndex + matchText.length + 30);
          const contextSnippet = content.slice(startContext, endContext).replace(/\n/g, " ");

          occurrences.push({
            file,
            index: absIndex,
            length: matchText.length,
            line,
            ch,
            matchText,
            contextSnippet,
          });
        }
      }
    }

    return { occurrences, totalCount: occurrences.length, filesCount };
  }

  /**
   * Effectue le remplacement atomique sur les fichiers ciblés via app.vault.process().
   * @param {object} app
   * @param {object} plugin
   * @param {string} query
   * @param {string} replaceQuery
   * @param {{ scope?: string, ignoreCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean, includeYaml?: boolean, activeFile?: object }} options
   * @returns {Promise<{ totalReplacements: number, filesCount: number }>}
   */
  static async replaceInVault(app, plugin, query, replaceQuery, options = {}) {
    if (!query || typeof query !== "string") {
      return { totalReplacements: 0, filesCount: 0 };
    }

    const regex = this.buildRegex(query, options);
    if (!regex) return { totalReplacements: 0, filesCount: 0 };

    const files = this.getScopedFiles(app, plugin, options.scope, options.activeFile);
    const replaceStr = replaceQuery ?? "";
    const shouldPreserveCase = options.ignoreCase !== false && !options.useRegex;
    const includeYaml = !!options.includeYaml;

    let totalReplacements = 0;
    let filesCount = 0;

    for (const file of files) {
      if (!file || !file.path || !file.path.endsWith(".md")) continue;

      let fileReplaced = 0;

      await app.vault.process(file, (content) => {
        const processBlock = (text) => {
          let count = 0;
          regex.lastIndex = 0;
          const newText = text.replace(regex, (...args) => {
            count++;
            const matchText = args[0];
            if (options.useRegex) {
              const captures = args.slice(1, -2);
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
          if (count > 0) {
            fileReplaced = count;
            return newText;
          }
          return content;
        }

        const { frontmatter, body } = splitFrontmatter(content);
        const { newText: newBody, count } = processBlock(body);
        if (count > 0) {
          fileReplaced = count;
          return frontmatter + newBody;
        }
        return content;
      });

      if (fileReplaced > 0) {
        totalReplacements += fileReplaced;
        filesCount++;
      }
    }

    return { totalReplacements, filesCount };
  }
}
