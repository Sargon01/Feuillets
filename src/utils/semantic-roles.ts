import { setIcon } from "obsidian";

export type SemanticRole =
  | "introduction" | "question-directrice" | "objectifs" | "competences" | "instructions"
  | "questions" | "solution" | "argument" | "hypothese" | "preuve"
  | "source" | "citation" | "explication" | "definition" | "methode"
  | "synthese" | "point-cle" | "recommandation";

export const SEMANTIC_ROLES: readonly SemanticRole[] = [
  "introduction", "question-directrice", "objectifs", "competences", "instructions",
  "questions", "solution", "argument", "hypothese", "preuve",
  "source", "citation", "explication", "definition", "methode",
  "synthese", "point-cle", "recommandation",
];

/** Registre des alias normalisés vers les rôles canoniques. Aucun alias anglais —
 * la détection du callout se fait exclusivement en fonction du data-callout HTML
 * (normalisation : minuscules, espaces conservés). */
export const SEMANTIC_ROLE_ALIASES: Readonly<Record<string, SemanticRole>> = {
  introduction: "introduction",
  "question-directrice": "question-directrice",
  objectifs: "objectifs",
  competences: "competences",
  instructions: "instructions",
  questions: "questions",
  solution: "solution",
  argument: "argument",
  hypothese: "hypothese",
  preuve: "preuve",
  source: "source",
  citation: "citation",
  explication: "explication",
  definition: "definition",
  methode: "methode",
  synthese: "synthese",
  "point-cle": "point-cle",
  recommandation: "recommandation",
};

export const SEMANTIC_PALETTE = {
  red: "#B42318",
  green: "#2E7D32",
  blue: "#1F5EA8",
  purple: "#6E56CF",
  orange: "#B65C00",
  black: "#111111",
} as const;

/** Famille de couleur par rôle canonique — regroupement logique pour le
 * rendu visuel en Live Preview et export (styles.css et export-templates.ts).
 * Source de vérité unique : ne pas dupliquer cette table ailleurs. */
export const SEMANTIC_ROLE_FAMILY: Readonly<Record<SemanticRole, keyof typeof SEMANTIC_PALETTE>> = {
  introduction: "green",
  "question-directrice": "green",
  objectifs: "blue",
  competences: "blue",
  instructions: "orange",
  questions: "blue",
  solution: "green",
  argument: "purple",
  hypothese: "purple",
  preuve: "purple",
  source: "blue",
  citation: "purple",
  explication: "purple",
  definition: "purple",
  methode: "green",
  synthese: "blue",
  "point-cle": "red",
  recommandation: "orange",
};

/** Icône Lucide par rôle canonique (identifiants "lucide-…" — convention
 * identique à `--callout-icon` en Live Preview, styles.css). Source de
 * vérité unique : ne pas dupliquer cette table ailleurs. */
export const SEMANTIC_ROLE_ICON: Readonly<Record<SemanticRole, string>> = {
  introduction: "lucide-align-left",
  "question-directrice": "lucide-circle-help",
  objectifs: "lucide-target",
  competences: "lucide-badge-check",
  instructions: "lucide-clipboard-list",
  questions: "lucide-circle-help",
  solution: "lucide-check-check",
  argument: "lucide-message-square-text",
  hypothese: "lucide-lightbulb",
  preuve: "lucide-check-circle",
  source: "lucide-file-text",
  citation: "lucide-quote",
  explication: "lucide-message-square-text",
  definition: "lucide-book-open",
  methode: "lucide-route",
  synthese: "lucide-notebook-pen",
  "point-cle": "lucide-bookmark",
  recommandation: "lucide-flag",
};

/** Identifiant Lucide attendu par `setIcon` d'Obsidian — sans le préfixe
 * "lucide-" utilisé par SEMANTIC_ROLE_ICON pour la variable CSS
 * `--callout-icon` du Live Preview (styles.css). Même source de vérité,
 * seule la forme change selon le consommateur. */
function lucideIconId(role: SemanticRole): string {
  return SEMANTIC_ROLE_ICON[role].replace(/^lucide-/, "");
}

/** Slot d'icône du repère sémantique — réutilisé s'il existe déjà (jamais
 * dupliqué), sinon créé en premier enfant de `.callout-title` via `createSpan`
 * (helper Obsidian déjà utilisé ailleurs). Retourne null si le contexte DOM ne
 * permet pas de créer d'élément (fixtures de test minimalistes) — jamais une
 * exception. */
function ensureRoleMarkerIcon(titleEl: Element): Element | null {
  const existing = titleEl.querySelector?.(".feuillets-role-marker-icon");
  if (existing) return existing;
  if (typeof titleEl.createSpan !== "function") return null;
  return titleEl.createSpan({ cls: "feuillets-role-marker-icon", attr: { "aria-hidden": "true" }, prepend: true });
}

/** Injecte un vrai `<svg>` Lucide (via `setIcon`, mécanisme natif Obsidian) dans
 * le repère sémantique d'un rôle déjà classé par `applySemanticRoles`. La visibilité
 * du repère (legacy/show/hide) reste entièrement pilotée par le CSS généré dans
 * utils/export-templates.ts — cette fonction ne modifie jamais le rendu visuel.
 * Idempotente : ré-appliquer ne recrée ni ne duplique l'icône. */
function applyRoleMarkerIcon(el: Element, role: SemanticRole): void {
  const titleEl = el.querySelector?.(".callout-title");
  if (!titleEl) return;
  const marker = ensureRoleMarkerIcon(titleEl);
  if (!marker) return;
  marker.textContent = "";
  setIcon(marker as unknown as HTMLElement, lucideIconId(role));
}

export function semanticRoleForElement(el: Element): SemanticRole | null {
  const callout = el.getAttribute("data-callout")?.trim().toLowerCase();
  return callout ? SEMANTIC_ROLE_ALIASES[callout] || null : null;
}

export function isSemanticPageBreak(el: Element): boolean {
  const callout = el.getAttribute("data-callout")?.trim().toLowerCase();
  return callout === "saut-page" || callout === "pagebreak";
}

/** Texte du titre déjà rendu par Obsidian (`.callout-title-inner`), ou null
 * si le callout n'a pas de titre — jamais recalculé, uniquement lu. */
function calloutTitleText(el: Element): string | null {
  const inner = el.querySelector?.(".callout-title-inner");
  if (!inner) return null;
  const text = (inner.textContent || "").trim();
  return text || null;
}

/** Un titre est "automatique" quand il correspond exactement au type de
 * callout tel qu'écrit (`data-callout`) ou au rôle canonique — c'est la seule
 * comparaison autorisée : jamais de recherche de mots-clés dans un titre libre. */
function isAutoCalloutTitle(titleText: string, dataCallout: string, role: SemanticRole): boolean {
  const normalized = titleText.trim().toLowerCase();
  return normalized === dataCallout.trim().toLowerCase() || normalized === role;
}

export function applySemanticRoles(root: HTMLElement): { roles: number; pageBreaks: number } {
  let roles = 0;
  let pageBreaks = 0;
  root.querySelectorAll("[data-callout]").forEach((el) => {
    const role = semanticRoleForElement(el);
    if (role) {
      el.classList.add("feuillets-semantic-role", `feuillets-role-${role}`);
      const dataCallout = el.getAttribute("data-callout")?.trim().toLowerCase() || "";
      const titleText = calloutTitleText(el);
      if (titleText !== null) {
        el.classList.add(isAutoCalloutTitle(titleText, dataCallout, role) ? "feuillets-role-title-auto" : "feuillets-role-title-explicit");
      }
      applyRoleMarkerIcon(el, role);
      roles++;
    } else if (isSemanticPageBreak(el)) {
      el.classList.add("feuillets-pagebreak");
      pageBreaks++;
    }
  });
  return { roles, pageBreaks };
}
