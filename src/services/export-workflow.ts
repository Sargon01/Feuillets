import { Notice, type App, type TFolder } from "obsidian";
import { createProjectScope, type CompileScope } from "./compile-scope.js";
import { activePresetConfig, exportWithScope, type ExportFormat } from "./compile-export.js";
import {
  ContentExtractionsFileCorruptedError,
  loadContentExtractions,
  type ContentExtraction,
} from "./content-extractions.js";
import { t } from "../i18n/index.js";

/**
 * Service commun d'orchestration de l'export (Phase 1).
 *
 * Il ne contient AUCUN moteur d'export : il délègue exclusivement à
 * `exportWithScope()` (services/compile-export.ts), le point d'écriture
 * unique déjà utilisé par le Binder. Ce fichier existe pour que Binder,
 * Aperçu (PreviewView) et Édition (EditionExportView) partagent exactement
 * le même chemin — mémorisation de portée comprise — sans que l'un dépende
 * d'une instance des autres.
 */

/** Sous-ensemble structurel du plugin réellement utilisé ici. Volontairement
 * minimal : ni PreviewView ni ExportPanel n'ont besoin d'importer le type du
 * plugin principal pour utiliser ce service. */
export type ExportWorkflowPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  /** Portée de session, volontairement non persistée (voir main.ts) :
   * perdue au redémarrage, ce qui est normal. */
  activeExportScope?: CompileScope | null;
  activeExportExtraction?: { projectRoot: string; extractionId: string } | null;
  /** Hook OPTIONNEL : vide les écritures Continu en attente du projet exporté
   * avant de lancer la compilation. Fourni par `FeuilletsPlugin`
   * (flushContinuWritesForProject) — un plugin qui ne l'expose pas (tests,
   * plugin tiers) conserve exactement le comportement actuel. Retourne
   * `false` si un fichier reste dirty : l'export doit alors être abandonné. */
  flushContinuWritesForProject?: (projectRoot: string) => Promise<boolean>;
};

export function rememberExportExtraction(plugin: ExportWorkflowPlugin, extractionId: string | null): void {
  const root = plugin.getProjectFolder();
  plugin.activeExportExtraction = root && extractionId ? { projectRoot: root.path, extractionId } : null;
}

export function currentExportExtractionId(plugin: ExportWorkflowPlugin): string | null {
  const root = plugin.getProjectFolder();
  const active = plugin.activeExportExtraction;
  if (!root || !active || active.projectRoot !== root.path) {
    plugin.activeExportExtraction = null;
    return null;
  }
  return active.extractionId;
}

async function resolveExportExtraction(app: App, plugin: ExportWorkflowPlugin): Promise<ContentExtraction | null> {
  const extractionId = currentExportExtractionId(plugin);
  if (!extractionId) return null;
  const store = await loadContentExtractions(app, plugin.settings);
  const extraction = store.extractions.find((item) => item.id === extractionId);
  if (!extraction) plugin.activeExportExtraction = null;
  return extraction ?? null;
}

/** Mémorise la portée d'export pour la durée de la session — aucune
 * sauvegarde settings, aucun état persistant. */
export function rememberExportScope(plugin: ExportWorkflowPlugin, scope: CompileScope): void {
  plugin.activeExportScope = scope;
}

/**
 * Portée d'export courante :
 *  - aucun projet actif → null ;
 *  - une portée de session existe déjà et appartient au projet actif → elle
 *    est réutilisée telle quelle ;
 *  - sinon (aucune portée de session, ou portée d'un ANCIEN projet) → repli
 *    sur la portée Projet entier du projet actif, mémorisée à son tour.
 *
 * Une portée héritée d'un projet précédent n'est donc jamais réutilisée
 * après un changement de projet.
 */
export function currentExportScope(plugin: ExportWorkflowPlugin): CompileScope | null {
  const root = plugin.getProjectFolder();
  if (!root) return null;
  const existing = plugin.activeExportScope;
  if (existing && existing.projectRoot === root.path) return existing;
  const scope = createProjectScope(root.path);
  rememberExportScope(plugin, scope);
  return scope;
}

/** Nom de base (sans extension) de l'export, dérivé du preset actif — même
 * source que l'ancien `PreviewView.exportFileName()` / `ExportPanel`, jamais
 * une seconde logique de nom. */
export function exportBaseName(settings: FeuilletsSettings): string {
  const fileName = activePresetConfig(settings).fileName || "Manuscrit.md";
  return fileName.replace(/\.md$/i, "");
}

/**
 * Point d'entrée commun de session pour lancer un export :
 *  - portée : argument explicite, sinon `currentExportScope(plugin)` ;
 *  - format : argument explicite, sinon `settings.exportFormat`, repli
 *    `"docx"` ;
 *  - nom : argument explicite, sinon `exportBaseName(settings)`.
 *
 * La portée réellement utilisée est mémorisée avant l'appel à
 * `exportWithScope()`, qui reste l'unique moteur d'écriture — aucune
 * compilation n'est réimplémentée ici.
 *
 * Flush avant export : si le plugin expose le hook optionnel
 * `flushContinuWritesForProject`, il est appelé sur `resolvedScope.projectRoot`
 * AVANT `exportWithScope()` — des frappes encore en attente dans une session
 * Continu doivent être écrites avant que l'export ne compile le document.
 * Un retour `false` (fichier resté dirty après flush) ABANDONNE l'export :
 * aucun fichier de sortie n'est écrit, aucun texte local n'est compilé.
 */
export async function runExportWorkflow(
  app: App,
  plugin: ExportWorkflowPlugin,
  scope?: CompileScope | null,
  format?: string,
  baseName?: string
): Promise<string | undefined> {
  const resolvedScope = scope ?? currentExportScope(plugin);
  if (!resolvedScope) {
    new Notice(t("main.notice.projectFolderNotFound"));
    return undefined;
  }
  rememberExportScope(plugin, resolvedScope);

  if (typeof plugin.flushContinuWritesForProject === "function") {
    const clean = await plugin.flushContinuWritesForProject(resolvedScope.projectRoot);
    if (!clean) return undefined;
  }

  const settings = plugin.settings;
  const resolvedFormat = (format || settings.exportFormat || "docx") as ExportFormat;
  const resolvedBaseName = baseName || exportBaseName(settings);
  let contentExtraction: ContentExtraction | null = null;
  if (currentExportExtractionId(plugin)) {
    try {
      contentExtraction = await resolveExportExtraction(app, plugin);
    } catch (error) {
      if (error instanceof ContentExtractionsFileCorruptedError) {
        new Notice(t("contentExtractions.notice.exportFileCorrupted"));
        return undefined;
      }
      throw error;
    }
  }
  return exportWithScope(app, settings, resolvedScope, resolvedFormat, resolvedBaseName, contentExtraction);
}
