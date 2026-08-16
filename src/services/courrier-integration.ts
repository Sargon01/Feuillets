/* Intégration avec le plugin compagnon Courrier (Lot 14B) — aucune
 * dépendance obligatoire : Feuillets fonctionne à l'identique sans lui,
 * et ce fichier ne copie ni n'importe jamais rien de son code. La
 * communication passe uniquement par la surface publique que Courrier
 * expose lui-même sur son instance de plugin (`app.plugins.plugins
 * ["courrier"].api`), exactement la même convention que Feuillets utilise
 * pour ses propres compagnons (voir `api/text-analysis.ts` :
 * `app.plugins.plugins["feuillets"].api`).
 *
 * Ce module ne fait que : (1) lire les métadonnées du projet actif —
 * jamais le manuscrit lui-même, jamais d'écriture ; (2) vérifier que
 * Courrier est installé, activé, et expose la méthode attendue ;
 * (3) transmettre les données et laisser Courrier ouvrir sa propre
 * modale. Rien n'est envoyé, aucun contact ni destinataire n'est choisi
 * ici — Feuillets ne sait rien de ces notions. */

import { Notice, TFile, TFolder, type App } from "obsidian";
import { getManuscriptRoot, getProjectRoot, getEditionRoot, editionFolderPath } from "./folder-structure.js";
import { t } from "../i18n/index.js";
import { SubmissionAttachmentsModal, type SubmissionAttachmentCandidate } from "../ui/submission-attachments-modal.js";
import { exportDocxToFolder, exportEditorialDocumentDocxToFolder } from "./compile-export.js";
import { EDITION_DOCUMENTS, editionDocumentNames } from "./project-files.js";

/** Les documents éditoriaux conventionnels viennent de project-files :
 * création et détection partagent exactement les mêmes noms et variantes. */
/** Contrat attendu de `app.plugins.plugins["courrier"].api` — duck-typé
 * (aucun type partagé au moment de la compilation, chaque plugin est
 * bundlé séparément). Doit rester le sous-ensemble MINIMAL réellement
 * utilisé ici : n'importe quel objet portant au moins cette méthode est
 * accepté, qu'il vienne réellement de Courrier ou d'un autre greffon qui
 * choisirait d'implémenter la même surface. */
export interface CourrierCompanionApi {
  createSubmissionDraft(data: SubmissionDraftData): { success: boolean; message?: string };
  exportSubmissionDocx?(filePath: string): Promise<{ success: boolean; message?: string }>;
  markSubmissionAsSent?(
    filePath: string,
    dates?: { dateEnvoi?: string; dateRelance?: string }
  ): Promise<{ success: boolean; message?: string }>;
}

export interface SubmissionDraftData {
  titre: string;
  auteur?: string;
  genre?: string;
  nombreMots?: number;
  synopsis?: string;
  manuscritPath?: string;
  documentExportePath?: string;
  /** Chemins vault choisis explicitement par l'utilisatrice dans
   * `SubmissionAttachmentsModal` (Lot 14C) — jamais rien de plus que ce
   * qu'elle a coché. Absent (pas un tableau vide) si aucun document
   * éditorial n'a été détecté du tout. */
  pieceJointes?: string[];
  /** Chemin RÉEL du dossier Édition du projet (Lot 14D) — résolu par
   * `getEditionRoot`/`editionFolderPath` (mêmes fonctions que
   * `detectEditorialDocuments` et `ui/edition-docs-content.ts`, jamais une
   * reconstruction indépendante du chemin côté Courrier). S'il existe déjà
   * sur le disque, c'est exactement ce nom-là qui est transmis — jamais un
   * chemin recalculé qui risquerait de créer un second dossier concurrent
   * (voir le bug constaté en test réel : Courrier calculait auparavant son
   * propre "Édition" accentué, différent de "Edition"). */
  editionFolderPath?: string;
  exportManuscritDocx?: (destinationFolderPath: string, suggestedBaseName: string) => Promise<string | undefined>;
  exportEditorialDocumentDocx?: (sourceFilePath: string, destinationFolderPath: string, suggestedBaseName: string) => Promise<string | undefined>;
}

/** Sous-ensemble minimal du plugin Feuillets dont ce module a besoin —
 * testable sans instancier `FeuilletsPlugin` en entier, même pattern que
 * les hôtes minimaux du côté Courrier. */
export interface SubmissionHost {
  app: App;
  settings: FeuilletsSettings;
  wordCountOfFolder(folder: TFolder | null | undefined): Promise<number>;
  projectDisplayName(path: string): string;
}

/** Résout l'API Courrier si le plugin est installé, activé, ET expose
 * réellement la méthode attendue — les trois conditions distinctement
 * vérifiées plutôt qu'un simple `?.`, pour pouvoir donner un message
 * différent à chaque cas si besoin plus tard (aujourd'hui, un seul
 * message générique suffit, voir `prepareSubmission`). `app.plugins` est
 * absent en environnement de test (pas de vrai gestionnaire de greffons) :
 * traité comme "Courrier absent", jamais une exception. */
export function getCourrierApi(app: App): CourrierCompanionApi | null {
  const manager = (app as unknown as { plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> } }).plugins;
  if (!manager?.enabledPlugins?.has("courrier")) return null;
  const plugin = manager.plugins?.["courrier"] as { api?: unknown } | undefined;
  const api = plugin?.api;
  if (!api || typeof (api as CourrierCompanionApi).createSubmissionDraft !== "function") return null;
  return api as CourrierCompanionApi;
}

/** Recherche le dernier manuscrit DOCX exporté (Sortie/) pour le projet
 * actif — best-effort, jamais créateur du dossier (contrairement à
 * `getOutputFolder`, utilisé normalement pour ÉCRIRE un export) : une
 * simple lecture ne doit jamais faire apparaître un dossier "Sortie" vide
 * dans un projet qui n'a encore rien exporté. `undefined` si rien n'est
 * trouvé — c'est le sens de "si déjà généré" dans la demande. Restreint au
 * `.docx` (Lot 14C, "dernier manuscrit DOCX exporté" explicitement — les
 * autres formats d'export ne sont pas des candidats de soumission). */
async function findLatestExportedDocx(app: App, root: TFolder): Promise<string | undefined> {
  const base = root.parent ? root.parent.path : root.path;
  const outputPath = `${base}/Sortie`;
  const outputFolder = app.vault.getAbstractFileByPath(outputPath);
  if (!(outputFolder instanceof TFolder)) return undefined;

  let latest: { path: string; mtime: number } | null = null;
  for (const child of outputFolder.children) {
    if (!(child instanceof TFile) || child.extension !== "docx") continue;
    const mtime = child.stat?.mtime ?? 0;
    if (!latest || mtime > latest.mtime) latest = { path: child.path, mtime };
  }
  return latest?.path;
}

/** Chemin réel du dossier Édition à transmettre à Courrier (Lot 14D) —
 * réutilise exactement le nom déjà présent sur le disque s'il existe
 * (`getEditionRoot`), jamais une reconstruction indépendante du chemin.
 * S'il n'existe pas encore, `editionFolderPath` calcule le chemin
 * canonique où il sera créé à la demande — jamais créé ICI : la création
 * reste déclenchée par le premier écrivain réel (Courrier, en y plaçant
 * son brouillon), pour ne jamais faire apparaître un dossier Édition vide
 * juste parce que l'utilisatrice a ouvert la modale de soumission. */
function resolveRealEditionPath(app: App, root: TFolder): string {
  return getEditionRoot(app, root)?.path ?? editionFolderPath(app, root);
}

/** Détecte les documents éditoriaux conventionnels et le dernier DOCX
 * exporté, prêts à être proposés comme pièces jointes d'une soumission
 * (Lot 14C) — lecture seule. Manuscrit et Synopsis sont cochés par défaut
 * s'ils existent (contrainte explicite) ; les autres documents détectés
 * restent décochés — l'utilisatrice choisit. */
export async function detectEditorialDocuments(app: App, settings: FeuilletsSettings, root: TFolder): Promise<SubmissionAttachmentCandidate[]> {
  const candidates: SubmissionAttachmentCandidate[] = [];

  const exportedDocx = await findLatestExportedDocx(app, root);
  if (exportedDocx) {
    candidates.push({ id: "manuscrit", label: t("courrier.attachments.manuscrit"), path: exportedDocx, checkedByDefault: true });
  }

  const editionRoot = getEditionRoot(app, root);
  if (editionRoot) {
    for (const doc of EDITION_DOCUMENTS) {
      for (const name of editionDocumentNames(doc)) {
        const file = app.vault.getAbstractFileByPath(`${editionRoot.path}/${name}`);
        if (file instanceof TFile) {
          candidates.push({ id: doc.id, label: file.basename, path: file.path, checkedByDefault: doc.id === "synopsis" });
          break;
        }
      }
    }
  }

  return candidates;
}

/** Rassemble les données du projet actif à transmettre à Courrier — lecture
 * seule, aucune écriture. Chaque champ facultatif de `SubmissionDraftData`
 * est omis (pas de chaîne vide, pas de 0) s'il n'est pas disponible :
 * Courrier sait déjà gérer leur absence (voir `api.ts` côté Courrier). */
export async function buildSubmissionData(host: SubmissionHost, root: TFolder): Promise<SubmissionDraftData> {
  const meta = host.settings.projectMeta?.[root.path] ?? {};
  const wordCount = await host.wordCountOfFolder(root);

  const data: SubmissionDraftData = { titre: host.projectDisplayName(root.path) };
  if (meta.author && meta.author.trim()) data.auteur = meta.author.trim();
  // `type` (fiction/nonfiction — voir utils/project-modes.ts) est le plus
  // proche de "genre" que Feuillets connaisse réellement ; aucun champ
  // "genre littéraire" dédié n'existe dans les métadonnées de projet.
  if (meta.type && meta.type.trim()) data.genre = meta.type.trim();
  if (wordCount > 0) data.nombreMots = wordCount;
  // Aucun synopsis de PROJET dédié dans les métadonnées (le champ
  // `synopsis` existe par scène, pas par projet) — `description` (fiche
  // projet) sert de repli honnête, jamais renommé en "synopsis" dans les
  // réglages eux-mêmes.
  if (meta.description && meta.description.trim()) data.synopsis = meta.description.trim();
  data.manuscritPath = root.path;
  data.editionFolderPath = resolveRealEditionPath(host.app, root);
  data.exportManuscritDocx = (destinationFolderPath, suggestedBaseName) =>
    exportDocxToFolder(host.app, host.settings, destinationFolderPath, suggestedBaseName);
  data.exportEditorialDocumentDocx = (sourceFilePath, destinationFolderPath, suggestedBaseName) =>
    exportEditorialDocumentDocxToFolder(host.app, host.settings, sourceFilePath, destinationFolderPath, suggestedBaseName);

  const exported = await findLatestExportedDocx(host.app, root);
  if (exported) data.documentExportePath = exported;

  return data;
}

/** Applique le choix de pièces jointes confirmé dans la modale — extrait de
 * `prepareSubmission` pour rester appelable directement depuis les tests
 * (`SubmissionAttachmentsModal.onConfirm` ne peut plus être attendu une
 * fois branché sur un clic réel, même convention que le reste du plugin
 * compagnon Courrier). N'ajoute `pieceJointes` que si au moins un chemin a
 * été coché — jamais un tableau vide transmis pour "rien coché". */
export function applySubmissionChoice(api: CourrierCompanionApi, data: SubmissionDraftData, selectedPaths: string[]): void {
  // Si l'export direct est disponible, le DOCX historique de Sortie sert
  // uniquement de candidat visuel dans la modale : Courrier demandera un
  // export frais directement dans le paquet. Ne pas copier les deux.
  const pathsToCopy = data.exportManuscritDocx && data.documentExportePath
    ? selectedPaths.filter((path) => path !== data.documentExportePath)
    : selectedPaths;
  const result = api.createSubmissionDraft(pathsToCopy.length > 0 ? { ...data, pieceJointes: pathsToCopy } : data);
  if (!result.success) {
    new Notice(result.message || t("courrier.notice.failed"));
  }
}

/** Orchestration complète de la commande « Préparer une soumission » —
 * lecture des données du projet actif, résolution de l'API Courrier,
 * détection des documents éditoriaux, puis (Lot 14C) sélection explicite
 * des pièces jointes avant transmission : `SubmissionAttachmentsModal`
 * s'interpose toujours entre la détection et l'appel à Courrier, même
 * quand aucun document n'est détecté (l'utilisatrice voit alors clairement
 * qu'aucune pièce jointe n'est prévue, plutôt qu'un envoi silencieux sans
 * rien). Ne modifie jamais le manuscrit, n'ajoute aucun suivi éditorial
 * côté Feuillets — une fois l'appel à Courrier fait, Feuillets n'a plus
 * aucun rôle. */
export async function prepareSubmission(host: SubmissionHost): Promise<void> {
  const root = getManuscriptRoot(host.app, host.settings) ?? getProjectRoot(host.app, host.settings);
  if (!root) {
    new Notice(t("courrier.notice.noProject"));
    return;
  }

  const api = getCourrierApi(host.app);
  if (!api) {
    new Notice(t("courrier.notice.missingPlugin"));
    return;
  }

  const data = await buildSubmissionData(host, root);
  const candidates = await detectEditorialDocuments(host.app, host.settings, root);

  new SubmissionAttachmentsModal(host.app, candidates, (selectedPaths) => applySubmissionChoice(api, data, selectedPaths)).open();
}
