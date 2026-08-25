import {
  SEMANTIC_PALETTE,
  SEMANTIC_ROLE_FAMILY,
  SEMANTIC_ROLES,
  type SemanticRole,
} from "../utils/semantic-roles.js";

export const PRESENTATION_THEME_IDS = ["classic", "course", "ivory", "slate", "dark"] as const;
export type PresentationThemeId = (typeof PRESENTATION_THEME_IDS)[number];
export type PresentationThemeColors = {
  background: string;
  text: string;
  muted: string;
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  strong: string;
};
export type PresentationCalloutColors = { accent: string; body: string };
export type PresentationThemeCustomization = {
  name?: string;
  colors?: Partial<PresentationThemeColors>;
  callouts?: Partial<Record<SemanticRole, Partial<PresentationCalloutColors>>>;
};
export type PresentationThemeCustomizations = Partial<Record<PresentationThemeId, PresentationThemeCustomization>>;
export type ResolvedPresentationTheme = {
  id: PresentationThemeId;
  name: string;
  colors: PresentationThemeColors;
  callouts: Record<SemanticRole, PresentationCalloutColors>;
  neutralCallout: { background: string; border: string; borderLeft: string };
};

const names: Record<PresentationThemeId, { fr: string; en: string }> = {
  classic: { fr: "Classique", en: "Classic" }, course: { fr: "Cours", en: "Course" },
  ivory: { fr: "Ivoire", en: "Ivory" }, slate: { fr: "Ardoise", en: "Slate" }, dark: { fr: "Sombre", en: "Dark" },
};
const common = { background: "#FFFFFF", text: "#1F1F1F", muted: "#5C5C5C", h1: "#1F1F1F", h2: "#1F1F1F", h3: "#1F1F1F", h4: "#1F1F1F", strong: "#1F1F1F" };
const builtins: Record<PresentationThemeId, PresentationThemeColors> = {
  classic: { ...common },
  course: { ...common, h1: "#B42318", h2: "#B42318", h3: "#2E7D32", h4: "#1F5EA8", strong: "#B42318" },
  ivory: { background: "#FBF7EF", text: "#2A2520", muted: "#6D6258", h1: "#7C3E32", h2: "#7C3E32", h3: "#4F6B45", h4: "#52697A", strong: "#7C3E32" },
  slate: { background: "#F3F5F7", text: "#202A33", muted: "#5C6873", h1: "#334E68", h2: "#334E68", h3: "#3F6B5B", h4: "#5A5F80", strong: "#A23B33" },
  dark: { background: "#171A1F", text: "#F2F4F7", muted: "#B8C0CC", h1: "#FF7B72", h2: "#FF7B72", h3: "#7EE787", h4: "#79C0FF", strong: "#FF7B72" },
};
const darkPalette = { red: "#FF7B72", green: "#7EE787", blue: "#79C0FF", purple: "#D2A8FF", orange: "#FFA657", black: "#E6EDF3" } as const;

export function isPresentationThemeId(value: unknown): value is PresentationThemeId {
  return typeof value === "string" && (PRESENTATION_THEME_IDS as readonly string[]).includes(value);
}
export function isPresentationColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}
export function defaultPresentationThemeName(id: PresentationThemeId, locale = "fr"): string {
  return names[id][locale.toLowerCase().startsWith("en") ? "en" : "fr"];
}
function familyAccent(role: SemanticRole, palette: typeof SEMANTIC_PALETTE | typeof darkPalette): string { return palette[SEMANTIC_ROLE_FAMILY[role]]; }

export function resolvePresentationTheme(id: unknown, customizations: PresentationThemeCustomizations = {}, locale = "fr"): ResolvedPresentationTheme {
  const validId: PresentationThemeId = isPresentationThemeId(id) ? id : "classic";
  const customization = customizations[validId];
  const colors = { ...builtins[validId] };
  const palette = validId === "dark" ? darkPalette : SEMANTIC_PALETTE;
  if (customization?.colors) {
    for (const key of Object.keys(colors) as (keyof PresentationThemeColors)[]) {
      const value = customization.colors[key];
      if (isPresentationColor(value)) colors[key] = value.toUpperCase();
    }
  }
  const callouts = {} as Record<SemanticRole, PresentationCalloutColors>;
  for (const role of SEMANTIC_ROLES) {
    const override = customization?.callouts?.[role];
    callouts[role] = {
      accent: isPresentationColor(override?.accent) ? override.accent.toUpperCase() : familyAccent(role, palette),
      body: isPresentationColor(override?.body) ? override.body.toUpperCase() : colors.text,
    };
  }
  if (validId === "course" && !customization?.callouts?.synthese?.accent) callouts.synthese.accent = "#B42318";
  if (validId === "course" && !customization?.callouts?.synthese?.body) callouts.synthese.body = "#1F5EA8";
  if (validId === "dark" && !customization?.callouts?.synthese?.accent) callouts.synthese.accent = "#FF7B72";
  if (validId === "dark" && !customization?.callouts?.synthese?.body) callouts.synthese.body = "#79C0FF";
  const candidateName = customization?.name?.trim();
  const neutralCallout = validId === "dark"
    ? { background: "#20252D", border: "#3A424E", borderLeft: "#3A424E" }
    : { background: "#f5f5f7", border: "#d8d8dc", borderLeft: "#8a8a8a" };
  return { id: validId, name: candidateName || defaultPresentationThemeName(validId, locale), colors, callouts, neutralCallout };
}

export function validatePresentationThemeName(value: unknown, id: PresentationThemeId, customizations: PresentationThemeCustomizations, locale = "fr"): string | null {
  if (typeof value !== "string") return "Nom invalide";
  const name = value.trim();
  if (!name || name.length > 64) return "Nom invalide";
  const folded = name.toLocaleLowerCase();
  for (const other of PRESENTATION_THEME_IDS) {
    if (other !== id && resolvePresentationTheme(other, customizations, locale).name.trim().toLocaleLowerCase() === folded) return "Nom déjà utilisé";
  }
  return null;
}

export function resetPresentationThemeCustomization(customizations: PresentationThemeCustomizations, id: PresentationThemeId): PresentationThemeCustomizations {
  const next = { ...customizations };
  delete next[id];
  return next;
}

export function presentationThemeForFile(settings: { presentationTheme?: unknown; presentationThemes?: PresentationThemeCustomizations; projectMeta?: Record<string, ProjectMeta>; projectFolder?: string }, filePath: string, locale = "fr"): ResolvedPresentationTheme {
  let id: unknown = settings.presentationTheme;
  const project = settings.projectFolder;
  if (project && (filePath === project || filePath.startsWith(`${project}/`))) {
    const projectId = settings.projectMeta?.[project]?.presentationTheme;
    if (isPresentationThemeId(projectId)) id = projectId;
  }
  return resolvePresentationTheme(id, settings.presentationThemes ?? {}, locale);
}
