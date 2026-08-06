import { ContextCandidate } from "./context-matcher.js";

export type ContextSourceKind =
  | "project-research"
  | "chapter"
  | "shared"
  | "manual";

export interface ContextSource {
  path: string;
  kind: ContextSourceKind;
  priority?: number;
}

export interface ContextDocument {
  path: string;
  basename: string;
  title?: string;
  tags?: string[];
}

export interface ContextIndexedCandidate extends ContextCandidate {
  sourcePath: string;
  sourceKind: ContextSourceKind;
}

export interface BuildContextIndexOptions {
  includeNested?: boolean;
}

const DEFAULT_SOURCE_PRIORITIES: Record<ContextSourceKind, number> = {
  "project-research": 0,
  "chapter": 10,
  "shared": 20,
  "manual": 30
};

/**
 * Normalise un chemin de fichier ou dossier :
 * - remplace les antislashs par des slashs
 * - réduit les slashs consécutifs
 * - supprime les slashs initiaux et finaux
 */
export function normalizePath(pathStr: string): string {
  if (!pathStr) return "";
  const normalized = pathStr
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  return normalized.replace(/^\/|\/$/g, "");
}

/**
 * Extrait le dossier parent normalisé d'un chemin normalisé.
 */
function getParentDir(normPath: string): string {
  const lastSlash = normPath.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return normPath.slice(0, lastSlash);
}

/**
 * Nettoie et déduplique les tags d'un document de manière insensible à la casse,
 * tout en conservant la première graphie rencontrée.
 */
function cleanTags(tags?: string[]): string[] {
  if (!tags || tags.length === 0) return [];
  const result: string[] = [];
  const seenLower = new Set<string>();

  for (const rawTag of tags) {
    if (!rawTag) continue;
    const trimmed = rawTag.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Construit un index de fiches candidats pour matchContext à partir
 * de documents et de sources autorisées.
 */
export function buildContextIndex(
  documents: ContextDocument[],
  sources: ContextSource[],
  options?: BuildContextIndexOptions
): ContextIndexedCandidate[] {
  if (!documents || documents.length === 0 || !sources || sources.length === 0) {
    return [];
  }

  const includeNested = options?.includeNested ?? true;

  // Normaliser les sources et déterminer leur priorité effective et leur index initial
  const normalizedSources = sources.map((s, index) => ({
    source: s,
    normPath: normalizePath(s.path),
    kind: s.kind,
    priority: s.priority ?? DEFAULT_SOURCE_PRIORITIES[s.kind] ?? 100,
    sourceIndex: index
  }));

  // Mapper chaque chemin de document normalisé vers son meilleur candidat
  const candidateMap = new Map<
    string,
    {
      candidate: ContextIndexedCandidate;
      winningPriority: number;
      winningSourceIndex: number;
      originalDocIndex: number;
    }
  >();

  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const doc = documents[docIdx];
    if (!doc || !doc.path) continue;

    const normDocPath = normalizePath(doc.path);
    if (!normDocPath) continue;

    const parentDir = getParentDir(normDocPath);

    // Rechercher les sources qui incluent ce document
    let bestMatch: {
      sourcePath: string;
      sourceKind: ContextSourceKind;
      priority: number;
      sourceIndex: number;
    } | null = null;

    for (const ns of normalizedSources) {
      if (!ns.normPath) continue;

      let matches = false;
      if (includeNested) {
        matches = normDocPath.startsWith(ns.normPath + "/");
      } else {
        matches = parentDir === ns.normPath;
      }

      if (matches) {
        if (
          !bestMatch ||
          ns.priority < bestMatch.priority ||
          (ns.priority === bestMatch.priority && ns.sourceIndex < bestMatch.sourceIndex)
        ) {
          bestMatch = {
            sourcePath: ns.normPath,
            sourceKind: ns.kind,
            priority: ns.priority,
            sourceIndex: ns.sourceIndex
          };
        }
      }
    }

    if (!bestMatch) continue; // Le document n'appartient à aucune source autorisée

    const title = doc.title && doc.title.trim().length > 0 ? doc.title.trim() : doc.basename;
    const tags = cleanTags(doc.tags);

    const newCandidate: ContextIndexedCandidate = {
      id: normDocPath,
      path: normDocPath,
      title,
      basename: doc.basename,
      tags,
      sourcePriority: bestMatch.priority,
      sourcePath: bestMatch.sourcePath,
      sourceKind: bestMatch.sourceKind
    };

    const existing = candidateMap.get(normDocPath);
    if (!existing) {
      candidateMap.set(normDocPath, {
        candidate: newCandidate,
        winningPriority: bestMatch.priority,
        winningSourceIndex: bestMatch.sourceIndex,
        originalDocIndex: docIdx
      });
    } else {
      // Déduplication par chemin de document entre plusieurs entrées identiques
      if (
        bestMatch.priority < existing.winningPriority ||
        (bestMatch.priority === existing.winningPriority &&
          bestMatch.sourceIndex < existing.winningSourceIndex)
      ) {
        candidateMap.set(normDocPath, {
          candidate: newCandidate,
          winningPriority: bestMatch.priority,
          winningSourceIndex: bestMatch.sourceIndex,
          originalDocIndex: docIdx
        });
      }
    }
  }

  const result = Array.from(candidateMap.values());

  // Ordre de sortie :
  // 1. sourcePriority croissant
  // 2. sourcePath dans l'ordre initial des sources (winningSourceIndex)
  // 3. ordre initial des documents (originalDocIndex)
  result.sort((a, b) => {
    if (a.winningPriority !== b.winningPriority) {
      return a.winningPriority - b.winningPriority;
    }
    if (a.winningSourceIndex !== b.winningSourceIndex) {
      return a.winningSourceIndex - b.winningSourceIndex;
    }
    return a.originalDocIndex - b.originalDocIndex;
  });

  return result.map(r => r.candidate);
}
