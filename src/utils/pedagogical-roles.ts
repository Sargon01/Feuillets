import { setIcon } from "obsidian";

export type PedagogicalRole =
  | "problematique" | "introduction" | "objectifs" | "competences" | "consignes"
  | "questions" | "correction" | "trace" | "exemple" | "explication"
  | "retenir" | "definition" | "lexique" | "methodologie" | "tache" | "document";

export const PEDAGOGICAL_ROLES: readonly PedagogicalRole[] = [
  "problematique", "introduction", "objectifs", "competences", "consignes",
  "questions", "correction", "trace", "exemple", "explication", "retenir",
  "definition", "lexique", "methodologie", "tache", "document",
];

export const PEDAGOGICAL_ROLE_ALIASES: Readonly<Record<string, PedagogicalRole>> = {
  problematique: "problematique", introduction: "introduction", objectifs: "objectifs", competences: "competences", consignes: "consignes",
  trace: "trace", exemple: "exemple", explication: "explication", retenir: "retenir", lexique: "lexique", methodologie: "methodologie", tache: "tache",
  problematic: "problematique", objectives: "objectifs",
  competencies: "competences", instructions: "consignes", questions: "questions",
  correction: "correction", lesson: "trace", example: "exemple", explanation: "explication",
  keypoint: "retenir", definition: "definition", glossary: "lexique", methodology: "methodologie", task: "tache",
  document: "document", doc: "document",
};

export const PEDAGOGICAL_PALETTE = {
  red: "#B42318",
  green: "#2E7D32",
  blue: "#1F5EA8",
  purple: "#6E56CF",
  orange: "#B65C00",
  black: "#111111",
} as const;

/** Famille de couleur par rôle canonique — même regroupement que les
 * familles Live Preview (styles.css). Source de vérité unique, réutilisée
 * par le CSS des repères d'export (utils/export-templates.ts) : ne pas
 * dupliquer cette table ailleurs. */
export const PEDAGOGICAL_ROLE_FAMILY: Readonly<Record<PedagogicalRole, keyof typeof PEDAGOGICAL_PALETTE>> = {
  problematique: "green", introduction: "green", correction: "green", methodologie: "green",
  objectifs: "blue", competences: "blue", questions: "blue", trace: "blue", document: "blue",
  definition: "purple", lexique: "purple", explication: "purple",
  consignes: "orange", exemple: "orange", tache: "orange",
  retenir: "red",
};

/** Icône Lucide par rôle canonique (identifiants "lucide-…" — même
 * convention que `--callout-icon` en Live Preview, styles.css). Source de
 * vérité unique : ne pas dupliquer cette table ailleurs. */
export const PEDAGOGICAL_ROLE_ICON: Readonly<Record<PedagogicalRole, string>> = {
  problematique: "lucide-circle-help",
  questions: "lucide-circle-help",
  introduction: "lucide-align-left",
  correction: "lucide-check-check",
  methodologie: "lucide-route",
  objectifs: "lucide-target",
  competences: "lucide-badge-check",
  trace: "lucide-notebook-pen",
  definition: "lucide-book-open",
  lexique: "lucide-languages",
  explication: "lucide-message-square-text",
  consignes: "lucide-clipboard-list",
  exemple: "lucide-lightbulb",
  tache: "lucide-list-checks",
  retenir: "lucide-bookmark",
  document: "lucide-file-text",
};

/** Identifiant Lucide attendu par `setIcon` d'Obsidian — sans le préfixe
 * "lucide-" utilisé par PEDAGOGICAL_ROLE_ICON pour la variable CSS
 * `--callout-icon` du Live Preview (styles.css). Même source de vérité,
 * seule la forme change selon le consommateur. */
function lucideIconId(role: PedagogicalRole): string {
  return PEDAGOGICAL_ROLE_ICON[role].replace(/^lucide-/, "");
}

/** Slot d'icône du repère sémantique — réutilisé s'il existe déjà (jamais
 * dupliqué, voir §8/§19 du lot « icônes Lucide en Preview/PDF »), sinon créé
 * en premier enfant de `.callout-title` via `createSpan` (helper Obsidian
 * déjà utilisé partout ailleurs dans le plugin — jamais `document.
 * createElement` brut). Retourne null si le contexte DOM ne permet pas de
 * créer d'élément (fixtures de test minimalistes qui ne testent pas
 * l'icône) — jamais une exception. */
function ensureRoleMarkerIcon(titleEl: Element): Element | null {
  const existing = titleEl.querySelector?.(".feuillets-role-marker-icon");
  if (existing) return existing;
  if (typeof titleEl.createSpan !== "function") return null;
  return titleEl.createSpan({ cls: "feuillets-role-marker-icon", attr: { "aria-hidden": "true" }, prepend: true });
}

/** Injecte un vrai `<svg>` Lucide (via `setIcon`, mécanisme natif
 * d'Obsidian — jamais de SVG codé en dur) dans le repère sémantique d'un
 * rôle déjà classé par `applyPedagogicalSemantics`. Appelée pour les 16
 * rôles sans distinction : la visibilité du repère (legacy/show/hide) reste
 * entièrement pilotée par le CSS déjà généré dans
 * utils/export-templates.ts (`.feuillets-role-marker-icon` masqué par
 * défaut, visible seulement en mode "show") — cette fonction ne modifie
 * jamais le rendu visuel Live Preview ni PDF en dehors du mode "show".
 * Idempotente : ré-appliquer ne recrée ni ne duplique l'icône. */
function applyRoleMarkerIcon(el: Element, role: PedagogicalRole): void {
  const titleEl = el.querySelector?.(".callout-title");
  if (!titleEl) return;
  const marker = ensureRoleMarkerIcon(titleEl);
  if (!marker) return;
  marker.textContent = "";
  setIcon(marker as unknown as HTMLElement, lucideIconId(role));
}

export function pedagogicalRoleForElement(el: Element): PedagogicalRole | null {
  const callout = el.getAttribute("data-callout")?.trim().toLowerCase();
  return callout ? PEDAGOGICAL_ROLE_ALIASES[callout] || null : null;
}

export function isPedagogicalPageBreak(el: Element): boolean {
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
 * callout tel qu'écrit (`data-callout`, alias compris) ou au rôle canonique
 * — c'est la seule comparaison autorisée (§14 du lot) : jamais de recherche
 * de mots-clés dans un titre éditorial libre. */
function isAutoCalloutTitle(titleText: string, dataCallout: string, role: PedagogicalRole): boolean {
  const normalized = titleText.trim().toLowerCase();
  return normalized === dataCallout.trim().toLowerCase() || normalized === role;
}

export function applyPedagogicalSemantics(root: HTMLElement): { roles: number; pageBreaks: number } {
  let roles = 0;
  let pageBreaks = 0;
  root.querySelectorAll("[data-callout]").forEach((el) => {
    const role = pedagogicalRoleForElement(el);
    if (role) {
      el.classList.add("feuillets-pedagogical-role", `feuillets-role-${role}`);
      const dataCallout = el.getAttribute("data-callout")?.trim().toLowerCase() || "";
      const titleText = calloutTitleText(el);
      if (titleText !== null) {
        el.classList.add(isAutoCalloutTitle(titleText, dataCallout, role) ? "feuillets-role-title-auto" : "feuillets-role-title-explicit");
      }
      applyRoleMarkerIcon(el, role);
      roles++;
    } else if (isPedagogicalPageBreak(el)) {
      el.classList.add("feuillets-pagebreak");
      pageBreaks++;
    }
  });
  return { roles, pageBreaks };
}
