type ProjectStatus = { name?: string; color: string };
type SettingsWithStatuses = { statuses?: unknown };

export const VIEW_SIDEBAR = "feuillets-view";
export const VIEW_BOARD = "feuillets-board";
export const VIEW_NOTES = "feuillets-notes";
export const VIEW_PROPERTIES = "feuillets-properties";
export const VIEW_RESEARCH = "feuillets-research";
export const VIEW_JOURNAL = "feuillets-journal";
export const VIEW_PROJECT = "feuillets-project";
export const VIEW_DOCX_REVIEW = "feuillets-docx-review";
export const VIEW_SIDEBAR_FEUILLETS = "feuillets-sidebar-view";
export const VIEW_PREVIEW = "feuillets-manuscript-preview";
/** LOT 1 — cœur technique uniquement (voir views/scrivenings-view.ts) : pas
 * encore d'entrée Binder/commande, la vue s'ouvre pour l'instant par
 * `setViewState({ type: VIEW_SCRIVENINGS, ... })`. */
export const VIEW_SCRIVENINGS = "feuillets-scrivenings";

/** Statuts : entièrement personnalisables (nom + couleur), comme les
 * labels — plus de liste figée ni de couleur déterminée par la position.
 * `settings.statuses` est un tableau de `{name, color}` ; "" (sans statut)
 * reste implicite, toujours en tête, jamais stocké comme entrée.
 * @param {FeuilletsSettings} settings 
 * @returns {string[]}
 */
export function getProjectStatuses(settings: SettingsWithStatuses | null | undefined): string[] {
  const statuses: ProjectStatus[] = (settings && Array.isArray(settings.statuses)) ? settings.statuses as ProjectStatus[] : [];
  const names = statuses
    .map((s) => (s && typeof s.name === "string" ? s.name.trim() : ""))
    .filter(Boolean);
  return ["", ...names];
}

/**
 * @param {FeuilletsSettings} settings 
 * @param {string} name 
 * @returns {string|null}
 */
export function getStatusColor(settings: SettingsWithStatuses | null | undefined, name: string): string | null {
  const statuses: ProjectStatus[] = (settings && Array.isArray(settings.statuses)) ? settings.statuses as ProjectStatus[] : [];
  const found = statuses.find((s) => s.name === name);
  return found ? found.color : null;
}

/** Modes du panneau Cartes, dans l'ordre d'affichage — clé + libellé par
 * défaut (le mode "arcs" a un libellé recalculé dynamiquement ailleurs
 * selon le mode du projet, celui-ci n'est qu'un repli). */
export const BOARD_MODES = [
  ["board", "Cartes"],
  ["outline", "Plan"],
  ["arcs", "Chemin de fer"],
  ["timeline", "Chronologie"],
];

/** Panneaux latéraux qu'on peut masquer entièrement (icône du ruban et
 * commande d'ouverture retirées). Le binder et le panneau Cartes restent
 * toujours visibles : ce sont les surfaces de navigation principales. */
export const HIDEABLE_PANELS = [
  { key: "research", label: "Recherche", view: VIEW_RESEARCH },
  { key: "notes", label: "Notes", view: VIEW_NOTES },
  { key: "journal", label: "Journal & statistiques", view: VIEW_JOURNAL },
  { key: "project", label: "Projet", view: VIEW_PROJECT },
  { key: "docxReview", label: "Édition (révisions .docx + documents)", view: VIEW_DOCX_REVIEW },
];
