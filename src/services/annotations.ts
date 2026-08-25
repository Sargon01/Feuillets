import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import {
  getProjectFolder,
  internalResourcesFolderPath,
} from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { resolveSourceAnchor } from "./source-anchor.js";

/** Annotations de relecture (surlignages + commentaires) sur le texte du
 * Manuscrit — stockage seul, aucune UI. Un fichier JSON unique par projet,
 * rangé dans le même sous-dossier "Ressources internes" que les autres
 * ressources internes (reconnaît Assets/Visuels/Internal resources comme
 * les autres sous-dossiers de Ressources, voir folder-structure.ts) :
 * _Feuillets/Ressources/Ressources internes/annotations.json */

export type AnnotationColor = "yellow" | "green" | "blue" | "pink";
export type AnnotationStyle = "highlight" | "underline" | "strikethrough";

export interface Annotation {
  id: string;
  /** Chemin du fichier annoté, relatif à la racine du Manuscrit
   * (getProjectFolder) — jamais un chemin absolu du coffre, pour rester
   * stable si le projet est déplacé/renommé. */
  file: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  text: string;
  color: AnnotationColor;
  /** Absent dans les anciens fichiers : équivaut à "highlight". */
  style?: AnnotationStyle;
}

export interface AnnotationsStore {
  version: 1;
  annotations: Annotation[];
}

/** Position résolue d'une annotation dans le texte actuel — ou `null` si
 * elle n'a pas pu être retrouvée avec certitude (voir resolveAnnotation). */
export interface ResolvedRange {
  start: number;
  end: number;
}

const ANNOTATIONS_FILE_NAME = "annotations.json";

function emptyStore(): AnnotationsStore {
  return { version: 1, annotations: [] };
}

/** Erreur contrôlée levée quand annotations.json existe mais n'est pas un
 * JSON valide ou n'a pas la forme attendue — ne doit JAMAIS entraîner une
 * réécriture silencieuse du fichier : l'appelant doit pouvoir avertir
 * l'utilisateur et laisser le fichier tel quel. */
export class AnnotationsFileCorruptedError extends Error {
  readonly originalError?: unknown;
  constructor(path: string, originalError?: unknown) {
    super(`Fichier d'annotations JSON invalide : ${path}`);
    this.name = "AnnotationsFileCorruptedError";
    this.originalError = originalError;
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // repli si crypto.randomUUID indisponible (anciens moteurs mobiles)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Chemin du sous-dossier "Ressources internes" (reconnaît les anciens
 * noms déjà supportés par ailleurs) — jamais recalculé indépendamment,
 * toujours via resourcesSubfolderPath comme les autres sous-dossiers de
 * Ressources. */
/** Chemin du fichier annotations.json pour le projet actif, ou `null` s'il
 * n'y a pas de projet Feuillets actif. Une simple résolution de chemin :
 * ne crée rien, n'implique pas que le fichier existe déjà sur le disque. */
export function annotationsFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  return normalizePath(`${internalResourcesFolderPath(app, root)}/${ANNOTATIONS_FILE_NAME}`);
}

/** Chemin d'un TFile du Manuscrit relatif à la racine du projet (celle que
 * pointe settings.projectFolder) — c'est ce chemin relatif qui est stocké
 * dans `Annotation.file`. */
export function toManuscriptRelativePath(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  file: TFile
): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  if (file.path === root.path) return "";
  if (!file.path.startsWith(`${root.path}/`)) return null;
  return file.path.slice(root.path.length + 1);
}

/** Lit annotations.json. Aucun fichier => magasin vide, SANS créer quoi
 * que ce soit sur le disque. JSON corrompu ou de forme inattendue => lève
 * AnnotationsFileCorruptedError, sans jamais toucher au fichier. */
export async function loadAnnotations(
  app: App,
  settings: FeuilletsSettings | null | undefined
): Promise<AnnotationsStore> {
  const path = annotationsFilePath(app, settings);
  if (!path) return emptyStore();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyStore();
  const raw = await app.vault.read(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new AnnotationsFileCorruptedError(path, e);
  }
  if (!isValidStore(parsed)) {
    throw new AnnotationsFileCorruptedError(path);
  }
  return parsed;
}

function isValidStore(value: unknown): value is AnnotationsStore {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.annotations)) return false;
  return v.annotations.every((a) => isValidAnnotation(a));
}

const VALID_COLORS: AnnotationColor[] = ["yellow", "green", "blue", "pink"];
const VALID_STYLES: AnnotationStyle[] = ["highlight", "underline", "strikethrough"];

function isValidAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.file === "string" &&
    typeof a.start === "number" &&
    typeof a.end === "number" &&
    typeof a.quote === "string" &&
    typeof a.prefix === "string" &&
    typeof a.suffix === "string" &&
    typeof a.text === "string" &&
    typeof a.color === "string" &&
    VALID_COLORS.includes(a.color as AnnotationColor) &&
    (a.style === undefined || (typeof a.style === "string" && VALID_STYLES.includes(a.style as AnnotationStyle)))
  );
}

/** Écrit annotations.json (création du dossier "Ressources internes" et de
 * ses parents si nécessaire, jamais avant cet appel). */
export async function saveAnnotations(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  store: AnnotationsStore
): Promise<void> {
  const root = getProjectFolder(app, settings);
  if (!root) throw new Error("Aucun projet Feuillets actif.");
  const folderPath = internalResourcesFolderPath(app, root);
  await ensureFolder(app, folderPath);
  const path = normalizePath(`${folderPath}/${ANNOTATIONS_FILE_NAME}`);
  const json = JSON.stringify(store, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, json);
  } else {
    await app.vault.create(path, json);
  }
}

/** Annotations d'un fichier du Manuscrit donné, dans l'ordre de stockage. */
export function annotationsForFile(store: AnnotationsStore, relativePath: string): Annotation[] {
  return store.annotations.filter((a) => a.file === relativePath);
}

export type NewAnnotationInput = Omit<Annotation, "id">;

/** Ajoute une annotation et persiste immédiatement. */
export async function addAnnotation(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  input: NewAnnotationInput
): Promise<Annotation> {
  const store = await loadAnnotations(app, settings);
  const annotation: Annotation = { ...input, id: uuid() };
  store.annotations.push(annotation);
  await saveAnnotations(app, settings, store);
  return annotation;
}

/** Modifie une annotation existante (fusion partielle) et persiste.
 * Retourne `null` si l'id est introuvable — ne crée jamais d'annotation. */
export async function updateAnnotation(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  id: string,
  patch: Partial<Omit<Annotation, "id">>
): Promise<Annotation | null> {
  const store = await loadAnnotations(app, settings);
  const index = store.annotations.findIndex((a) => a.id === id);
  if (index === -1) return null;
  const updated: Annotation = { ...store.annotations[index], ...patch, id };
  store.annotations[index] = updated;
  await saveAnnotations(app, settings, store);
  return updated;
}

/** Supprime une annotation et persiste. Retourne `false` si l'id était
 * déjà absent (rien à écrire). */
export async function deleteAnnotation(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  id: string
): Promise<boolean> {
  const store = await loadAnnotations(app, settings);
  const before = store.annotations.length;
  store.annotations = store.annotations.filter((a) => a.id !== id);
  if (store.annotations.length === before) return false;
  await saveAnnotations(app, settings, store);
  return true;
}

/**
 * Fait suivre les ancres personnelles après un renommage Obsidian.  Les
 * chemins stockés sont relatifs au Manuscrit : un renommage de dossier est
 * donc simplement un changement de préfixe.  `loadAnnotations` est appelé
 * avant toute écriture afin qu'un JSON corrompu ne soit jamais écrasé.
 */
export async function remapAnnotationsAfterRename(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  oldVaultPath: string,
  newVaultPath: string
): Promise<boolean> {
  const root = getProjectFolder(app, settings);
  if (!root || !oldVaultPath || !newVaultPath) return false;
  const oldPrefix = oldVaultPath === root.path ? "" : oldVaultPath.startsWith(`${root.path}/`) ? oldVaultPath.slice(root.path.length + 1) : null;
  const newPrefix = newVaultPath === root.path ? "" : newVaultPath.startsWith(`${root.path}/`) ? newVaultPath.slice(root.path.length + 1) : null;
  if (oldPrefix === null || newPrefix === null || oldPrefix === newPrefix) return false;
  const store = await loadAnnotations(app, settings);
  let changed = false;
  for (const annotation of store.annotations) {
    if (annotation.file !== oldPrefix && !annotation.file.startsWith(`${oldPrefix}/`)) continue;
    annotation.file = `${newPrefix}${annotation.file.slice(oldPrefix.length)}`;
    changed = true;
  }
  if (changed) await saveAnnotations(app, settings, store);
  return changed;
}

/** Retrouve la position actuelle d'une annotation dans le texte courant du
 * fichier annoté (contenu déjà lu par l'appelant — cette fonction ne touche
 * pas au disque). Retourne `null` ("unresolved") plutôt que de deviner dès
 * que la position ne peut pas être établie avec certitude :
 *
 * 1. start/end encore valides et correspondant à `quote` => utilisés tels quels.
 * 2. sinon, `quote` retrouvé une seule fois dans le texte => cette occurrence.
 * 3. plusieurs occurrences de `quote` => départagées par prefix/suffix ;
 *    ambiguïté persistante => unresolved.
 * 4. `quote` introuvable tel quel (légère modification du passage) =>
 *    tentative via une paire prefix/suffix retrouvée de façon unique,
 *    la plage retenue est celle comprise entre les deux.
 * 5. rien de tout cela ne lève l'ambiguïté, ou le passage a disparu =>
 *    unresolved.
 */
export function resolveAnnotation(annotation: Annotation, content: string): ResolvedRange | null {
  return resolveSourceAnchor(annotation, content);
}
