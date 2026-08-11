import type { App } from "obsidian";
import { createCustomTemplateFromFields } from "./export-templates-custom.js";

/** Import d'un style Ulysses (.ulstyle/.ulss) en gabarit Feuillets
 * personnalisé (Phase 11) — même dossier Layouts, même format Markdown/
 * frontmatter que les autres modèles (voir services/export-templates-
 * custom.ts, createCustomTemplateFromFields) : aucun second système.
 *
 * Le fichier ULSS brut est un YAML léger — sections de premier niveau
 * (document-settings, paragraph, heading-1/2/3, paragraph-divider…),
 * chacune une liste plate de `clé: valeur` en kebab-case. Un analyseur
 * dédié plutôt que `parseYaml` d'Obsidian : ce module reste pur (aucune
 * dépendance à Obsidian ni à l'environnement plugin), testable directement
 * sous Node, comme utils/export-templates.ts.
 *
 * Seules les propriétés listées dans la mission sont lues ; tout le reste
 * (couleurs, citations, listes, liens, styles de code…) est ignoré
 * SILENCIEUSEMENT — ni erreur ni avertissement, Feuillets ne sait
 * simplement pas les représenter aujourd'hui. */

const HEADING_SECTIONS = ["heading-1", "heading-2", "heading-3"] as const;
const HEADING_KEYS: Record<(typeof HEADING_SECTIONS)[number], "h1" | "h2" | "h3"> = {
  "heading-1": "h1",
  "heading-2": "h2",
  "heading-3": "h3",
};

/** Analyse minimale d'un fichier ULSS en sections { "clé-kebab": valeur
 * brute (string) }. Ignore les lignes vides/commentées ; une valeur
 * peut être entre guillemets (retirés). Ne comprend PAS les listes/
 * imbrications YAML au-delà de deux niveaux — le format ULSS réellement
 * mappé ici (voir mission) n'en a jamais besoin. */
function parseUlyssesSections(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = (rawLine.match(/^\s*/) || [""])[0].length;
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (indent === 0) {
      current = key;
      if (!sections[current]) sections[current] = {};
    } else if (current) {
      sections[current][key] = value;
    }
  }
  return sections;
}

type Unit = "pt" | "mm" | "cm";
const PT_PER_MM = 2.83465;
const PT_PER_CM = 28.3465;

/** Un nombre, éventuellement suivi d'une unité (pt/mm/cm) — bare number
 * traité comme des points, unité par défaut de ce format. */
function parseLength(raw: string | undefined): { value: number; unit: Unit } | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(pt|mm|cm)?$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (m[2]?.toLowerCase() as Unit) || "pt" };
}

/** Convertit proprement pt/mm/cm → points, arrondis à l'entier (mêmes
 * unités que fontSizePt/indentPt/paragraphSpacingPt/marginTopPt/
 * marginBottomPt/gutterPt — voir utils/export-templates.ts). */
function toPt(raw: string | undefined): number | null {
  const p = parseLength(raw);
  if (!p) return null;
  if (p.unit === "pt") return Math.round(p.value);
  if (p.unit === "mm") return Math.round(p.value * PT_PER_MM);
  return Math.round(p.value * PT_PER_CM);
}

/** Convertit proprement pt/mm/cm → centimètres, arrondis à 0,01cm (mêmes
 * unités que marginsCm — voir utils/export-templates.ts). */
function toCm(raw: string | undefined): number | null {
  const p = parseLength(raw);
  if (!p) return null;
  const cm = p.unit === "cm" ? p.value : p.unit === "mm" ? p.value / 10 : p.value / PT_PER_CM;
  return Math.round(cm * 100) / 100;
}

function parseBoolean(raw: string | undefined): boolean | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (["true", "yes", "1"].includes(v)) return true;
  if (["false", "no", "0"].includes(v)) return false;
  return null;
}

/** "justified" (Ulysses) -> "justify" (Feuillets) ; sinon la valeur telle
 * quelle si c'est un alignement reconnu, sinon ignorée. */
function parseAlign(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "justified") return "justify";
  if (["left", "right", "center", "justify"].includes(v)) return v;
  return undefined;
}

/** "bold"/valeur numérique ≥600 -> gras ; sinon non gras (jamais `undefined`
 * : un poids explicitement réglé, quel qu'il soit, tranche la question). */
function parseBold(raw: string | undefined): boolean | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "bold") return true;
  if (v === "regular" || v === "normal") return false;
  const n = parseFloat(v);
  if (Number.isFinite(n)) return n >= 600;
  return undefined;
}

function parseHeadingSection(fields: Record<string, string>): HeadingStyle {
  const style: HeadingStyle = {};
  const fontSizePt = toPt(fields["font-size"]);
  if (fontSizePt != null) style.fontSizePt = fontSizePt;
  const align = parseAlign(fields["text-alignment"]);
  if (align) style.align = align;
  const bold = parseBold(fields["font-weight"]);
  if (bold != null) style.bold = bold;
  if (typeof fields["font-style"] === "string") style.italic = fields["font-style"].trim().toLowerCase() === "italic";
  const marginTopPt = toPt(fields["margin-top"]);
  if (marginTopPt != null) style.marginTopPt = marginTopPt;
  const marginBottomPt = toPt(fields["margin-bottom"]);
  if (marginBottomPt != null) style.marginBottomPt = marginBottomPt;
  /* "page-break: before" (ULSS) est la seule valeur qui déclenche un saut
     de page — toute autre valeur (ex. "auto", "avoid") ou l'absence de la
     clé signifient "pas de saut". */
  if (typeof fields["page-break"] === "string") {
    style.pageBreakBefore = fields["page-break"].trim().toLowerCase() === "before";
  }
  return style;
}

/** Champs de gabarit Feuillets réellement dérivables d'un fichier ULSS —
 * pure, sans dépendance à Obsidian, testable directement. Ne mappe QUE les
 * propriétés listées dans la mission (voir commentaire d'en-tête) ; tout le
 * reste du fichier ULSS est silencieusement ignoré. */
export function parseUlyssesStyle(content: string): Partial<ExportTemplate> {
  const sections = parseUlyssesSections(content);
  const fields: Partial<ExportTemplate> = {};

  const doc = sections["document-settings"];
  if (doc) {
    const top = toCm(doc["page-inset-top"]);
    const bottom = toCm(doc["page-inset-bottom"]);
    const inner = toCm(doc["page-inset-inner"]);
    const outer = toCm(doc["page-inset-outer"]);
    /* Les quatre côtés doivent être compris pour émettre des marges
       cohérentes — jamais de valeur devinée pour un côté manquant.
       "inner"/"outer" (reliure) sont mappés sur gauche/droite : Feuillets
       n'a pas de notion de pages recto/verso miroir. */
    if (top != null && bottom != null && inner != null && outer != null) {
      fields.marginsCm = { top, bottom, left: inner, right: outer };
    }
    if (typeof doc["page-orientation"] === "string") {
      const orientation = doc["page-orientation"].trim().toLowerCase();
      if (orientation === "landscape" || orientation === "portrait") fields.pageOrientation = orientation;
    }
    const count = doc["column-count"] ? parseInt(doc["column-count"], 10) : NaN;
    if (Number.isFinite(count) && count >= 1) {
      const gutterPt = toPt(doc["column-spacing-width"]) ?? 0;
      fields.columns = { count, gutterPt };
    }
  }

  const paragraph = sections["paragraph"];
  if (paragraph) {
    if (isNonEmptyString(paragraph["font-family"])) fields.fontFamily = paragraph["font-family"].trim();
    const fontSizePt = toPt(paragraph["font-size"]);
    if (fontSizePt != null) fields.fontSizePt = fontSizePt;
    if (typeof paragraph["line-height"] === "string") {
      const lh = parseFloat(paragraph["line-height"]);
      if (Number.isFinite(lh) && lh > 0) fields.lineHeight = lh;
    }
    const align = parseAlign(paragraph["text-alignment"]);
    if (align) fields.align = align;
    const indentPt = toPt(paragraph["first-line-indent"]);
    if (indentPt != null) {
      fields.indent = indentPt > 0;
      if (indentPt > 0) fields.indentPt = indentPt;
    }
    const marginBottomPt = toPt(paragraph["margin-bottom"]);
    if (marginBottomPt != null) {
      fields.paragraphSpacing = marginBottomPt > 0;
      if (marginBottomPt > 0) fields.paragraphSpacingPt = marginBottomPt;
    }
    const hyphenation = parseBoolean(paragraph["hyphenation"]);
    if (hyphenation != null) fields.hyphenation = hyphenation;
  }

  const headings: { h1?: HeadingStyle; h2?: HeadingStyle; h3?: HeadingStyle } = {};
  for (const section of HEADING_SECTIONS) {
    const raw = sections[section];
    if (!raw) continue;
    const style = parseHeadingSection(raw);
    if (Object.keys(style).length) headings[HEADING_KEYS[section]] = style;
  }
  if (Object.keys(headings).length) fields.headings = headings;

  const divider = sections["paragraph-divider"];
  if (divider && isNonEmptyString(divider["content"])) {
    fields.sceneDivider = divider["content"].trim();
  }

  return fields;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Nom de fichier ULSS -> clé de gabarit sûre : minuscules, alphanumérique
 * et tirets seulement, jamais vide. */
function slugifyKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "ulysses";
}

/** Importe un fichier .ulstyle/.ulss : crée un gabarit Feuillets
 * personnalisé dans Resources/Layouts à partir des propriétés supportées,
 * et le rend immédiatement actif — même mécanisme que
 * `duplicateExportTemplate` (services/export-templates-custom.ts), aucun
 * second système. Ne modifie aucun réglage global hors de ce nouveau
 * gabarit (createCustomTemplateFromFields ne touche que
 * `settings.exportTemplate`).
 * @param app
 * @param settings
 * @param fileName nom du fichier .ulstyle/.ulss choisi (sert de base au
 *   libellé et à la clé — jamais le chemin complet, jamais son contenu).
 * @param content contenu texte brut du fichier.
 * @returns `null` si aucun dossier projet.
 */
export async function importUlyssesStyle(
  app: App,
  settings: FeuilletsSettings,
  fileName: string,
  content: string
): Promise<{ key: string; label: string } | null> {
  return importUlyssesStyleText(app, settings, content, fileName);
}

/** Variante destinée à l'interface navigateur : le fichier déposé est lu
 * par la modale HTML5, tandis que ce service conserve le parsing et la
 * création du gabarit. */
export async function importUlyssesStyleText(
  app: App,
  settings: FeuilletsSettings,
  content: string,
  originalFileName: string
): Promise<{ key: string; label: string } | null> {
  if (!content.trim()) throw new Error("Le fichier est vide.");
  const fields = parseUlyssesStyle(content);
  if (!Object.keys(fields).length) throw new Error("Ce style ne contient aucune propriété exploitable.");
  const label = originalFileName.replace(/\.(ulstyle|ulss)$/i, "").trim() || "Ulysses";
  const baseKey = slugifyKey(label);
  return createCustomTemplateFromFields(app, settings, baseKey, label, fields as Record<string, unknown>);
}
