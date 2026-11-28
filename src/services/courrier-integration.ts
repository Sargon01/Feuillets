/* Feuillets prépare la composition et délègue à l’API de Courrier le formulaire,
 * le suivi et le rendu de ses lettres. Les deux plugins sont compilés séparément. */

import { Notice, TFile, TFolder, type App } from "obsidian";
import { getManuscriptRoot, getProjectRoot, getEditionRoot, editionFolderPath } from "./folder-structure.js";
import { t } from "../i18n/index.js";
import { SubmissionAttachmentsModal, type SubmissionAttachmentCandidate } from "../ui/submission-attachments-modal.js";
import { exportEditorialDocumentDocxToFolder } from "./compile-export.js";
import { editionDocumentForName } from "./project-files.js";
import { editorialPacketSources, packetExpectedFiles, preparePacketOutputs, readPacketLetter, type EditorialPacket, type PacketLetter } from "./editorial-packet.js";
import { EditorialPacketModal } from "../ui/editorial-packet-modal.js";
import { stripFrontmatter } from "./frontmatter.js";
import type { CslCitationHost } from "./csl-citation-host.js";

/** Les documents éditoriaux conventionnels viennent de project-files :
 * création et détection partagent exactement les mêmes noms et variantes. */

/** Résumé d'une soumission projet retourné par l'API Courrier.
 * Duck-typé local — aucun import depuis Courrier. Les deux plugins
 * restent compilés séparément ; ce type représente seulement le contrat
 * public attendu. */
export interface ProjectSubmissionSummary {
  letterPath?: string;
  recordPath?: string;
  folderPath?: string;
  archivePath?: string;
  recipient: string;
  status: string;
  sentDate?: string;
  reminderDate?: string;
  manuscriptDocxReady: boolean;
  letterDocxReady: boolean;
  missingFiles?: string[];
  dossierReady?: boolean;
}

/** Contrat local de l’API Courrier. Les méthodes facultatives permettent
 * d’utiliser les anciens parcours quand une version ancienne est active. */
export interface CourrierCompanionApi {
  createSubmissionDraft(data: SubmissionDraftData): { success: boolean; message?: string };
  getPacketLetter?(filePath: string): PacketLetter | undefined;
  prepareSubmissionFromLetter?(data: {
    filePath: string; titre: string; editionFolderPath: string; editorialSubmission: EditorialSubmissionData;
    onCreated?: (path: string) => void;
  }): Promise<{ success: true; path?: string } | { success: false; message: string }>;
  openSubmissionPacket?(filePath: string): Promise<{ success: boolean; message?: string }>;
  duplicateSubmission?(filePath: string): Promise<{ success: boolean; message?: string }>;
  exportSubmissionDocx?(filePath: string): Promise<{ success: boolean; message?: string }>;
  markSubmissionAsSent?(
    filePath: string,
    dates?: { dateEnvoi?: string; dateRelance?: string }
  ): Promise<{ success: boolean; message?: string }>;
  listProjectSubmissions?(editionFolderPath: string): Promise<ProjectSubmissionSummary[]>;
}

interface EditorialSubmissionData { plan: EditorialPacket; expected: string[]; withoutLetter?: true }

export interface SubmissionDraftData {
  titre: string;
  editorialSubmission?: EditorialSubmissionData;
  onCreated?(path: string): void;
  initialBody?: string;
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
  saveSettings?(): Promise<void>;
  cslCitationHost?: CslCitationHost | null;
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

/** Liste les résumés de soumissions pour un dossier Édition donné, en
 * consultant l'API Courrier si disponible — aucune lecture locale
 * n'intervient ici, la responsabilité de lire le suivi revient entièrement
 * à Courrier. Retourne null si Courrier absent, si listProjectSubmissions
 * n'existe pas, ou si l'appel échoue ; jamais une exception. */
export async function listCourrierProjectSubmissions(
  app: App,
  editionFolderPath: string
): Promise<ProjectSubmissionSummary[] | null> {
  const api = getCourrierApi(app);
  if (!api) return null;

  if (typeof api.listProjectSubmissions !== "function") return null;

  try {
    const result = await api.listProjectSubmissions(editionFolderPath);
    return result;
  } catch (error) {
    console.error(
      `[Feuillets] listCourrierProjectSubmissions failed for ${editionFolderPath}:`,
      error
    );
    return null;
  }
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

/** Pièces jointes Markdown proposées par le formulaire de compatibilité.
 * Les lettres Courrier nécessitent leur moteur de rendu. */
export async function detectEditorialDocuments(app: App, _settings: FeuilletsSettings, root: TFolder): Promise<SubmissionAttachmentCandidate[]> {
  const editionRoot = getEditionRoot(app, root);
  if (!editionRoot) return [];
  const api = getCourrierApi(app);
  return editorialPacketSources(editionRoot).filter(file => file.extension === "md" && !resolveCourrierPacketLetter(app, file.path, api)).map(file => {
    const conventional = editionDocumentForName(file.name);
    return { id: conventional?.id || file.path, label: file.basename, path: file.path, checkedByDefault: conventional?.id === "synopsis" };
  });
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
  if (wordCount > 0) data.nombreMots = wordCount;
  const edition = getEditionRoot(host.app, root);
  const synopsis = edition?.children.find(file => file instanceof TFile && editionDocumentForName(file.name)?.id === "synopsis");
  if (synopsis instanceof TFile) {
    const body = stripFrontmatter(await host.app.vault.read(synopsis)).trim();
    if (body) data.synopsis = body;
  }
  data.manuscritPath = root.path;
  data.editionFolderPath = resolveRealEditionPath(host.app, root);
  data.exportEditorialDocumentDocx = (sourceFilePath, destinationFolderPath, suggestedBaseName) =>
    exportEditorialDocumentDocxToFolder(host.app, host.settings, sourceFilePath, destinationFolderPath, suggestedBaseName);

  const exported = await findLatestExportedDocx(host.app, root);
  if (exported) data.documentExportePath = exported;

  return data;
}

/** Transmet la sélection confirmée par le formulaire de compatibilité. */
export function applySubmissionChoice(api: CourrierCompanionApi, data: SubmissionDraftData, selectedPaths: string[]): void {
  const result = api.createSubmissionDraft(selectedPaths.length > 0 ? { ...data, pieceJointes: selectedPaths } : data);
  if (!result.success) {
    new Notice(result.message || t("courrier.notice.failed"));
  }
}

export function resolveCourrierPacketLetter(app: App, path: string, api = getCourrierApi(app)): PacketLetter | undefined {
  const letter = api?.getPacketLetter?.(path);
  if (letter) return letter;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== "md") return undefined;
  const fm = app.metadataCache?.getFileCache(file)?.frontmatter;
  if (!fm || fm.sans_lettre === true) return undefined;
  const { id, modele } = fm;
  // Historical letters could have a Courrier template without a generated id.
  return (typeof id === "string" && id.startsWith("crr-"))
    || (typeof modele === "string" && ["administratif", "commercial", "particulier", "note"].includes(modele)) ? {} : undefined;
}

export function openEditorialPacketComposer(host: SubmissionHost, onSubmission?: (path: string) => void): void {
  const root = getManuscriptRoot(host.app, host.settings) ?? getProjectRoot(host.app, host.settings);
  const edition = root ? getEditionRoot(host.app, root) : null;
  if (!root || !edition || !host.saveSettings) {
    new Notice(t("packet.noEdition"));
    return;
  }
  const api = getCourrierApi(host.app);
  const letterFor = (path: string) => resolveCourrierPacketLetter(host.app, path, api);
  const submit = api?.openSubmissionPacket ? async (plan: EditorialPacket, onCreated: (path: string) => void) => {
    const letters = plan.sources.filter(path => letterFor(path));
    if (letters.length > 1) throw new Error(t("packet.oneSubmissionLetter"));
    const [filePath] = letters;
    const sourceIndex = filePath ? plan.sources.indexOf(filePath) : 0;
    const composition = filePath
      ? { ...plan, sources: plan.sources.filter(path => path !== filePath), letterSource: undefined, letterIndex: sourceIndex }
      : plan;
    const withLetter = !!filePath || !!plan.letterSource;
    const expected = packetExpectedFiles(composition, withLetter);
    const titre = host.projectDisplayName(root.path);
    if (!filePath || !letterFor(filePath)?.tracked) {
      if (!expected.length) throw new Error(t("packet.emptySubmission"));
      preparePacketOutputs(host.app, host.settings, composition, withLetter ? {} : undefined, host.cslCitationHost);
    }
    if (filePath) {
      if (!api.prepareSubmissionFromLetter) throw new Error(t("packet.existingLetterUnavailable"));
      const result = await api.prepareSubmissionFromLetter({
        filePath, titre, editionFolderPath: edition.path, editorialSubmission: { plan: composition, expected },
        onCreated,
      });
      if (!result.success) throw new Error(result.message);
      return result.path;
    }
    const result = api.createSubmissionDraft({
      titre,
      editionFolderPath: edition.path,
      initialBody: await readPacketLetter(host.app, host.settings, plan, letterFor),
      editorialSubmission: { plan, expected, ...(withLetter ? {} : { withoutLetter: true }) },
      onCreated,
    });
    if (!result.success) throw new Error(result.message || t("courrier.notice.failed"));
  } : undefined;
  new EditorialPacketModal(host.app, { app: host.app, settings: host.settings,
    saveSettings: async () => { await host.saveSettings?.(); },
    cslCitationHost: host.cslCitationHost }, root, edition, submit, letterFor, onSubmission ?? (path => {
      const file = host.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) void host.app.workspace.getLeaf(false).openFile(file);
    })).open();
}

/** Older companion builds still understand the individual attachment picker. */
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

  if (api.openSubmissionPacket) {
    openEditorialPacketComposer(host);
    return;
  }
  const data = await buildSubmissionData(host, root);
  const candidates = await detectEditorialDocuments(host.app, host.settings, root);

  new SubmissionAttachmentsModal(host.app, candidates, (selectedPaths) => applySubmissionChoice(api, data, selectedPaths)).open();
}
