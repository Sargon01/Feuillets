import type { App, TFile } from "obsidian";
import { splitFrontmatter } from "./frontmatter.js";

/**
 * Modèle composite de Scrivenings (LOT 1) : un seul document éditable en
 * mémoire qui juxtapose le CORPS Markdown de plusieurs vrais fichiers, sans
 * jamais créer de fichier composite sur disque ni faire du frontmatter YAML
 * une donnée éditable ici.
 *
 * Chaque fichier reste l'unique source de vérité — ce module ne fait que
 * décrire, en mémoire, comment ses morceaux de corps s'assemblent en un
 * texte composite et comment on retrouve, pour n'importe quelle position de
 * ce texte, à quel fichier (et quel offset local) elle appartient.
 *
 * JONCTION — entre deux segments, le composite porte exactement UN caractère
 * `\n` structurel (« la jonction ») qui n'appartient à AUCUN des deux
 * fichiers : jamais lu depuis leur contenu, jamais réécrit dessus. Sa
 * longueur fixe (1) est ce qui rend les frontières NON AMBIGUËS : toute
 * position composite appartient sans ambiguïté à exactement un segment (voir
 * `segmentAt`), et toute édition qui toucherait la jonction elle-même est
 * détectable avec une seule comparaison d'intervalles (voir
 * `changeCrossesBoundary`). C'est cette jonction, et seulement elle, que
 * l'éditeur CodeMirror doit rendre non supprimable (utils/cm-scrivenings.ts).
 */

/** Longueur, en caractères, de la jonction structurelle entre deux segments. */
export const SCRIVENINGS_JOINT = "\n";
export const SCRIVENINGS_JOINT_LENGTH = SCRIVENINGS_JOINT.length;

export interface ScriveningsSegment {
  /** Fichier réel dont ce segment est le corps. */
  readonly file: TFile;
  /** Raccourci — toujours `file.path`. */
  readonly path: string;
  /** Bloc YAML brut (délimiteurs `---` compris), ou "" si absent. Jamais
   * présent dans le texte composite : conservé ici pour être reposé tel
   * quel à la sauvegarde d'un segment qui n'a pas changé de frontmatter. */
  readonly frontmatter: string;
  /** Corps Markdown de ce segment tel qu'il figure ACTUELLEMENT dans le
   * texte composite (peut différer du corps disque si l'utilisateur a
   * édité depuis le chargement). */
  readonly body: string;
  /** Offset composite (inclusif) du premier caractère du corps. */
  readonly from: number;
  /** Offset composite (inclusif) suivant le dernier caractère du corps —
   * autrement dit `from + body.length`. Une position de caret égale à `to`
   * est valide : elle permet d'ajouter du texte en fin de ce segment. */
  readonly to: number;
}

export interface ScriveningsDocument {
  readonly segments: readonly ScriveningsSegment[];
  /** Concaténation des corps, séparés par `SCRIVENINGS_JOINT` — c'est le
   * texte que porte l'unique EditorView de Scrivenings. */
  readonly text: string;
}

/** Entrée brute nécessaire à la construction d'un document — un fichier et
 * son contenu disque intégral (frontmatter compris), déjà lu. Séparé du
 * chargement (I/O) pour que la construction reste une fonction pure,
 * testable sans Vault ni App. */
export interface ScriveningsFileEntry {
  file: TFile;
  content: string;
}

/**
 * Construit le document composite à partir d'entrées déjà lues. Pure :
 * aucune I/O, aucune dépendance à l'App — c'est ce qui rend l'étape 1
 * testable en isolation totale de CodeMirror et du Vault.
 */
export function buildScriveningsDocument(entries: readonly ScriveningsFileEntry[]): ScriveningsDocument {
  const segments: ScriveningsSegment[] = [];
  let cursor = 0;
  let text = "";

  entries.forEach((entry, index) => {
    const { frontmatter, body } = splitFrontmatter(entry.content ?? "");
    const from = cursor;
    const to = from + body.length;
    segments.push({ file: entry.file, path: entry.file.path, frontmatter, body, from, to });
    text += body;
    cursor = to;
    if (index < entries.length - 1) {
      text += SCRIVENINGS_JOINT;
      cursor += SCRIVENINGS_JOINT_LENGTH;
    }
  });

  return { segments, text };
}

/**
 * Lit chaque fichier du scope (dans l'ordre fourni — c'est l'appelant, via
 * `resolveCompileScopeFiles`, qui décide de l'ordre du Binder) et construit
 * le document composite. Seule fonction du module à toucher le Vault.
 */
export async function loadScriveningsDocument(app: App, files: readonly TFile[]): Promise<ScriveningsDocument> {
  const entries: ScriveningsFileEntry[] = [];
  for (const file of files) {
    const content = await app.vault.read(file);
    entries.push({ file, content });
  }
  return buildScriveningsDocument(entries);
}

/** Segment contenant la position composite `offset`, ou `null` si le
 * document est vide ou l'offset hors bornes. Les intervalles `[from, to]`
 * des segments sont fermés et jamais chevauchants (voir la note sur la
 * jonction en tête de fichier) : chaque offset entier appartient donc à
 * exactement un segment, sans traitement spécial pour les frontières. */
export function segmentAt(doc: ScriveningsDocument, offset: number): ScriveningsSegment | null {
  for (const segment of doc.segments) {
    if (offset >= segment.from && offset <= segment.to) return segment;
  }
  return null;
}

export interface ScriveningsLocation {
  segment: ScriveningsSegment;
  /** Offset dans `segment.body`, 0..body.length. */
  offset: number;
}

/** Offset composite → { segment, offset local }. */
export function compositeOffsetToLocation(doc: ScriveningsDocument, offset: number): ScriveningsLocation | null {
  const segment = segmentAt(doc, offset);
  if (!segment) return null;
  return { segment, offset: offset - segment.from };
}

/** { fichier, offset local } → offset composite. `null` si le fichier n'est
 * pas dans ce document ou si l'offset local dépasse la longueur du corps. */
export function locationToCompositeOffset(doc: ScriveningsDocument, path: string, localOffset: number): number | null {
  const segment = doc.segments.find((s) => s.path === path);
  if (!segment) return null;
  if (localOffset < 0 || localOffset > segment.body.length) return null;
  return segment.from + localOffset;
}

/** Offsets composites des caractères de jonction — les seules positions du
 * texte composite qu'aucune édition ne doit jamais consommer. */
export function boundaryOffsets(doc: ScriveningsDocument): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < doc.segments.length - 1; i++) {
    offsets.push(doc.segments[i].to);
  }
  return offsets;
}

/**
 * Vrai si le remplacement du texte composite `[from, to)` par du texte
 * quelconque toucherait au moins une jonction — c'est-à-dire franchirait la
 * frontière entre deux fichiers. Une édition purement interne à un segment
 * (y compris une insertion au tout début ou à la toute fin de son corps) ne
 * la franchit jamais.
 */
export function changeCrossesBoundary(doc: ScriveningsDocument, from: number, to: number): boolean {
  return boundaryOffsets(doc).some((joint) => from <= joint && joint < to);
}

export interface ScriveningsChange {
  /** Offset composite de début, dans les coordonnées du document AVANT
   * cette édition. */
  from: number;
  /** Offset composite de fin (exclusif), avant édition. */
  to: number;
  insert: string;
}

export interface ScriveningsEditResult {
  document: ScriveningsDocument;
  /** Chemins des fichiers dont le corps a effectivement changé — jamais
   * ceux d'un segment simplement traversé par un caret sans modification. */
  touchedPaths: string[];
}

/**
 * Applique un lot de changements (coordonnées composites, avant édition) au
 * document. Rejette (retourne `null`) tout changement qui franchirait une
 * frontière entre fichiers — aucune fusion implicite n'est jamais produite,
 * même partiellement : soit tout le lot s'applique, soit rien.
 *
 * Pure : ne touche ni Vault ni CodeMirror. C'est la même fonction que
 * l'extension CodeMirror (utils/cm-scrivenings.ts) invoque après qu'une
 * transaction a été acceptée, pour faire évoluer le modèle qui pilote la
 * sauvegarde différée par fichier.
 */
export function applyCompositeChanges(doc: ScriveningsDocument, changes: readonly ScriveningsChange[]): ScriveningsEditResult | null {
  if (changes.length === 0) return { document: doc, touchedPaths: [] };
  if (doc.segments.length === 0) return null;

  for (const change of changes) {
    if (changeCrossesBoundary(doc, change.from, change.to)) return null;
  }

  // Reconstruit le texte en partant de la fin, pour que les offsets des
  // changements restants restent valides pendant la boucle.
  let text = doc.text;
  const byLatestFirst = [...changes].sort((a, b) => b.from - a.from);
  for (const change of byLatestFirst) {
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  }

  // Chaque changement, n'ayant pas franchi de frontière, appartient à
  // exactement un segment (voir segmentAt) : on peut donc répartir les
  // deltas de longueur segment par segment puis reconstruire les bornes.
  // `touched` est décidé séparément de `deltas` : un remplacement de MÊME
  // longueur (ex. corriger une lettre) a un delta nul mais change bel et
  // bien le corps — il doit être sauvegardé comme n'importe quel autre.
  const deltas = doc.segments.map(() => 0);
  const touched = doc.segments.map(() => false);
  for (const change of changes) {
    const index = doc.segments.findIndex((s) => change.from >= s.from && change.to <= s.to);
    if (index === -1) return null;
    deltas[index] += change.insert.length - (change.to - change.from);
    if (change.insert.length > 0 || change.to > change.from) touched[index] = true;
  }

  const touchedPaths: string[] = [];
  const segments: ScriveningsSegment[] = [];
  let cursor = 0;
  doc.segments.forEach((segment, index) => {
    const bodyLength = segment.to - segment.from + deltas[index];
    const from = cursor;
    const to = from + bodyLength;
    const body = text.slice(from, to);
    if (touched[index]) touchedPaths.push(segment.path);
    segments.push({ ...segment, body, from, to });
    cursor = to;
    if (index < doc.segments.length - 1) cursor += SCRIVENINGS_JOINT_LENGTH;
  });

  return { document: { segments, text }, touchedPaths };
}

export type ScriveningsWriteResult =
  | { conflict: false; content: string }
  | { conflict: true; content: null };

/**
 * Calcule le contenu à écrire pour UN segment, à partir du contenu ACTUEL du
 * fichier sur disque (relu au moment de sauvegarder, jamais mis en cache) :
 * - si le corps actuellement sur disque diffère de `knownBody` (dernier
 *   corps que Scrivenings sait avoir écrit ou lu), une modification externe
 *   a eu lieu depuis — on refuse d'écraser, `conflict: true`, RIEN n'est
 *   modifié ;
 * - sinon, seul le corps change ; le frontmatter actuellement sur disque
 *   (pas une copie mémorisée) est reposé tel quel.
 *
 * Utilisée comme callback de `Vault.process()` par ScriveningsView.
 */
export function resolveScriveningsWrite(currentContent: string, knownBody: string, newBody: string): ScriveningsWriteResult {
  const { frontmatter, body } = splitFrontmatter(currentContent ?? "");
  if (body !== knownBody) return { conflict: true, content: null };
  return { conflict: false, content: frontmatter + newBody };
}
