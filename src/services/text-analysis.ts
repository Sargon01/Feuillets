/* Exécution d'une analyse : lit le fichier, prépare le texte, appelle le
 * fournisseur enregistré, reconvertit les offsets. Isolé des vues pour que
 * les commandes et le panneau partagent exactement le même chemin de code,
 * et pour rester testable sans instancier de vue Obsidian.
 *
 * Ne modifie JAMAIS le fichier : lecture seule (`cachedRead`). Appliquer une
 * correction est une action séparée, déclenchée explicitement par
 * l'utilisatrice depuis le panneau. */

import type { App, TFile } from "obsidian";
import {
  sanitizeIssues,
  type ResolvedAnalysisIssue,
  type TextAnalysisProvider,
  type TextAnalysisRegistry,
} from "../api/text-analysis.js";
import { analysisRangeFor, buildAnalysisSlice } from "../utils/analysis-text.js";

export type AnalysisScope = "document" | "selection";

/** Résultat d'une analyse, conservé par le greffon pour l'afficher. */
export type AnalysisRun = {
  providerId: string;
  providerName: string;
  filePath: string;
  fileTitle: string;
  scope: AnalysisScope;
  issues: ResolvedAnalysisIssue[];
  /** Contenu du fichier au moment de l'analyse — sert uniquement à afficher
   *  l'extrait concerné par un signalement sans relire le disque, et à le
   *  faire à partir du texte RÉEL (le texte transmis au fournisseur, lui, a
   *  le Markdown masqué). */
  sourceText: string;
  /** mtime du fichier au moment de l'analyse : sert à signaler au panneau
   *  que les résultats affichés datent d'avant les dernières modifications. */
  mtime: number;
};

export type AnalysisSelection = { start: number; end: number } | null | undefined;

/** Lance l'analyse d'un fichier (ou d'une sélection dans ce fichier).
 *  Lève si aucun fournisseur n'est enregistré, ou si le fournisseur échoue :
 *  l'appelant décide comment le dire à l'utilisatrice. */
export async function runAnalysis(
  app: App,
  registry: TextAnalysisRegistry,
  file: TFile,
  options?: { selection?: AnalysisSelection; providerId?: string; fileTitle?: string }
): Promise<AnalysisRun> {
  const provider = registry.get(options?.providerId);
  if (!provider) throw new Error("NO_PROVIDER");

  const content = await app.vault.cachedRead(file);
  const slice = buildAnalysisSlice(content, options?.selection);

  const raw = await callProvider(provider, {
    text: slice.text,
    filePath: file.path,
    selectionStart: slice.selectionStart,
    selectionEnd: slice.selectionEnd,
  });

  const issues = sanitizeIssues(raw, slice.text.length).map((issue): ResolvedAnalysisIssue => {
    const range = analysisRangeFor(issue, slice, content.length);
    return { ...issue, ...range, filePath: file.path };
  });

  return {
    providerId: provider.id,
    providerName: provider.name,
    filePath: file.path,
    fileTitle: options?.fileTitle ?? file.basename,
    scope: slice.selectionStart === undefined ? "document" : "selection",
    issues,
    sourceText: content,
    mtime: file.stat.mtime,
  };
}

/* Un fournisseur est du code tiers : il peut rendre autre chose qu'une
   promesse, ou rejeter avec une valeur nue. On normalise ici pour que le
   reste de Feuillets n'ait affaire qu'à des Error. */
async function callProvider(
  provider: TextAnalysisProvider,
  input: Parameters<TextAnalysisProvider["analyze"]>[0]
): Promise<unknown> {
  try {
    return await Promise.resolve(provider.analyze(input));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
