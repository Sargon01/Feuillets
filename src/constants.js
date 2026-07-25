export const VIEW_SIDEBAR = "feuillets-view";
export const VIEW_BOARD = "feuillets-board";
export const VIEW_NOTES = "feuillets-notes";
export const VIEW_PROPERTIES = "feuillets-properties";
export const VIEW_RESEARCH = "feuillets-research";
export const VIEW_JOURNAL = "feuillets-journal";
export const VIEW_PROJECT = "feuillets-project";
export const VIEW_DOCX_REVIEW = "feuillets-docx-review";
export const VIEW_SIDEBAR_FEUILLETS = "feuillets-sidebar-view";
export const VIEW_GRAMMAR = "feuillets-grammar";

export const STATUSES = ["", "Idée", "Brouillon", "En cours", "Révisé", "Terminé"];

/** Modes du panneau Cartes, dans l'ordre d'affichage — clé + libellé par
 * défaut (le mode "arcs" a un libellé recalculé dynamiquement ailleurs
 * selon le mode du projet, celui-ci n'est qu'un repli). */
export const BOARD_MODES = [
  ["board", "Cartes"],
  ["outline", "Plan"],
  ["arcs", "Chemin de fer"],
  ["timeline", "Chronologie"],
  ["read", "Lecture"],
];

/** Panneaux latéraux qu'on peut masquer entièrement (icône du ruban et
 * commande d'ouverture retirées). Le binder et le panneau Cartes restent
 * toujours visibles : ce sont les surfaces de navigation principales. */
export const HIDEABLE_PANELS = [
  { key: "research", label: "Recherche", view: VIEW_RESEARCH },
  { key: "notes", label: "Notes", view: VIEW_NOTES },
  { key: "journal", label: "Journal & statistiques", view: VIEW_JOURNAL },
  { key: "project", label: "Projet & export", view: VIEW_PROJECT },
  { key: "docxReview", label: "Révision (retours .docx)", view: VIEW_DOCX_REVIEW },
];
