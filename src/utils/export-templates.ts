import { SEMANTIC_PALETTE, SEMANTIC_ROLES, SEMANTIC_ROLE_FAMILY } from "./semantic-roles.js";

/** Modèles de mise en page pour l'export natif (EPUB/DOCX/PDF), façon
 * Ulysses/iA Writer — une seule source de vérité pour "à quoi ressemble
 * chaque modèle", consommée par les trois formats. Pur (pas de dépendance
 * à Obsidian) : testable directement sous Node.
 *
 * Champs de base (tous les modèles) : fontFamily, fontSizePt, lineHeight
 * (multiplicateur), align, indent, marginCm (marge unique) ou marginsCm
 * ({top,bottom,left,right}, prioritaire si présent), paragraphSpacing,
 * pageNumbers, pageNumberPosition ("footer-right" par défaut, ou
 * "header-right" — DOCX uniquement, voir export-docx.js), hyphenation.
 * Champs optionnels (repli sensé si absents — voir marginsFor) :
 * sceneDivider (texte affiché à la place d'un <hr>, ex. "* * *"),
 * headings ({h1?, h2?, h3?, h4?, h5?, h6?}, chacun {fontSizePt, align, bold, italic,
 * marginTopPt, marginBottomPt, pageBreakBefore} — style par niveau de
 * titre, distinct du corps de texte ; niveau absent = repli historique
 * "saut de page systématique, police héritée" — voir normalizeHeadings).
 * `chapterTitle` (ancien champ, H1 uniquement) reste accepté pour les
 * modèles existants — normalizeHeadings le traduit en headings.h1. */

/** Page de titre par défaut d'un modèle (voir titleRoleCss/export-docx.js) :
 * les rôles habituels d'un manuscrit (titre/sous-titre/mots/auteur/adresse/
 * coordonnées), centrés, avec le même rythme d'espacement vertical que le
 * modèle Word de référence (marges en points, indépendantes de la police).
 * Le titre est mis à l'échelle du corps (×1,5) pour rester proportionné d'un
 * modèle à l'autre ; le reste suit la taille du corps. Rôles libres : chacun
 * peut être surchargé/complété en éditant le .md du modèle.
 * @param {number} bodyPt taille du corps de texte du modèle, en points.
 * @returns {{ styles: Record<string, TitlePageStyle> }}
 */
const titlePageFor = (bodyPt: number): { styles: Record<string, TitlePageStyle> } => ({
  styles: {
    titre: { fontSizePt: Math.round(bodyPt * 1.5), align: "center", marginTopPt: 126, marginBottomPt: 24 },
    "sous-titre": { fontSizePt: bodyPt, align: "center", marginBottomPt: 120 },
    mots: { fontSizePt: bodyPt, align: "center", marginBottomPt: 132 },
    auteur: { fontSizePt: bodyPt, align: "center" },
    adresse: { fontSizePt: bodyPt, align: "center", marginBottomPt: 36 },
    "coordonnées": { fontSizePt: bodyPt, align: "center" },
  },
});

/** Modèles intégrés, indexés par clé. L'annotation fait vérifier chaque
 * littéral ci-dessous contre ExportTemplate (src/types.d.ts) : un champ mal
 * typé dans un modèle est signalé ici, pas à l'export.
 * @type {Record<string, ExportTemplate>} */
export const EXPORT_TEMPLATES: Record<string, ResolvedExportTemplate> = {
  classique: {
    key: "classique",
    label: "Manuscrit éditeur",
    titlePage: titlePageFor(12),
    fontFamily: "'Times New Roman', Times, serif",
    fontSizePt: 12,
    lineHeight: 2,
    align: "justify",
    indent: true,
    marginCm: 2.5,
    paragraphSpacing: false,
    pageNumbers: true,
    hyphenation: true,
    /* Partie (H1) ET chapitre (H2, dès qu'il y a un niveau Partie
       au-dessus) démarrent chacun sur une nouvelle page — convention
       normale d'un manuscrit. Sans ce réglage explicite, le repli
       historique (voir blockToParagraphs, export-docx.js) ne couvrait que
       le H1 : un chapitre niché dans une partie s'enchaînait à la suite
       du précédent sans saut de page. Ni `fontSizePt`/`bold`/`align` pour
       h1 : garde le style Word par défaut, seul le saut de page est réglé.
       h2 (titre de chapitre) et h3 (son sous-titre éventuel, ex. un titre
       Scrivener sur deux lignes — voir compile-export.js) partagent la
       MÊME taille et sont tous deux centrés/gras, mais SEUL h3 est en
       italique (le distingue visuellement du titre principal sans le
       diminuer) — et seul h2 démarre une nouvelle page : un sous-titre
       reste collé à son titre, jamais sur sa propre page. marginBottomPt
       sur h3 seulement : l'espace généreux avant le corps du chapitre
       vient APRÈS le sous-titre (ou après le titre s'il n'y en a pas,
       puisque h3 ne s'affiche alors simplement pas) — pas un gros blanc
       entre le titre et son sous-titre, qui doivent rester visuellement
       proches l'un de l'autre. */
    headings: {
      h1: { pageBreakBefore: true },
      h2: { pageBreakBefore: true, fontSizePt: 14, align: "center", bold: true },
      h3: {
        pageBreakBefore: false,
        fontSizePt: 14,
        align: "center",
        bold: true,
        italic: true,
        marginBottomPt: 36,
      },
    },
  },
  moderne: {
    key: "moderne",
    label: "Document moderne",
    titlePage: titlePageFor(11),
    fontFamily: "Inter, Helvetica, Arial, sans-serif",
    fontSizePt: 11,
    lineHeight: 1.4,
    align: "left",
    indent: false,
    marginCm: 2,
    paragraphSpacing: true,
    pageNumbers: true,
    hyphenation: true,
  },
  tapuscrit: {
    key: "tapuscrit",
    label: "Machine à écrire",
    titlePage: titlePageFor(12),
    fontFamily: "'Courier New', Courier, monospace",
    fontSizePt: 12,
    lineHeight: 1.5,
    align: "left",
    indent: true,
    marginCm: 2.5,
    paragraphSpacing: false,
    pageNumbers: true,
    hyphenation: true,
  },
  /* Adapté du style Ulysses "Simple Novel" (Katja Rupp, styles.ulysses.app)
     à partir du fichier .ulstyle partagé — mêmes valeurs (Baskerville
     14pt/24pt d'interligne, marges asymétriques 25/25/30/35mm, pas de
     césure, titres de chapitre à 52pt centrés, séparateur de scène
     "* * *"), traduites dans le système de modèles de Feuillets. */
  romanSimple: {
    key: "romanSimple",
    label: "Roman",
    titlePage: titlePageFor(14),
    fontFamily: "Baskerville, Georgia, serif",
    fontSizePt: 14,
    lineHeight: 24 / 14,
    align: "justify",
    indent: true,
    indentPt: 22,
    marginsCm: { top: 2.5, bottom: 2.5, left: 3, right: 3.5 },
    paragraphSpacing: false,
    paragraphSpacingPt: 12,
    pageNumbers: true,
    hyphenation: false,
    sceneDivider: "* * *",
    chapterTitle: { fontSizePt: 52, align: "center", marginTopPt: 72, marginBottomPt: 72 },
    blockquote: { italic: true, colorHex: "#333333" },
  },
  /* Adapté du style Ulysses "French Novel" (loïc martin, styles.ulysses.app)
     à partir du fichier .ulstyle partagé : Garamond 11pt/14pt d'interligne,
     césure activée, A4 PAYSAGE en 2 colonnes, titres de chapitre 34pt en
     Helvetica Neue alignés à gauche, séparateur de scène "***". La mise en
     page paysage/2 colonnes n'a de sens qu'en PDF (une page physique) —
     l'EPUB, par nature reflowable, ignore ces deux réglages et reste en
     continu une colonne, ce qui est l'usage normal d'un ebook. */
  romanFrancais: {
    key: "romanFrancais",
    label: "Roman français (paysage 2 colonnes)",
    titlePage: titlePageFor(11),
    fontFamily: "Garamond, Georgia, serif",
    headingFontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSizePt: 11,
    lineHeight: 14 / 11,
    align: "justify",
    indent: true,
    indentPt: 10,
    marginsCm: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
    paragraphSpacing: false,
    pageNumbers: true,
    hyphenation: true,
    sceneDivider: "***",
    pageOrientation: "landscape",
    columns: { count: 2, gutterPt: 45 },
    chapterTitle: { fontSizePt: 34, align: "left", marginTopPt: 56, marginBottomPt: 50 },
    blockquote: { italic: true },
  },
  /* APA 7e édition (papier étudiant) : Times 12pt interligne double, marges
     2,54cm (1 pouce), retrait de 1re ligne de 0,5 pouce, alignement à
     GAUCHE (pas justifié — l'APA ne le demande pas), numéro de page dans
     l'en-tête en haut à droite (DOCX uniquement — voir pageNumberPosition),
     et les 3 premiers niveaux de titres normalisés (centré gras / gauche
     gras / gauche gras italique), sans saut de page automatique — l'APA ne
     l'exige pas au niveau des sous-titres. */
  apa: {
    key: "apa",
    label: "APA 7 — base",
    titlePage: titlePageFor(12),
    fontFamily: "'Times New Roman', Times, serif",
    fontSizePt: 12,
    lineHeight: 2,
    align: "left",
    indent: true,
    indentPt: 36,
    marginCm: 2.54,
    paragraphSpacing: false,
    pageNumbers: true,
    pageNumberPosition: "header-right",
    hyphenation: false,
    headings: {
      h1: { fontSizePt: 12, align: "center", bold: true, marginTopPt: 12, marginBottomPt: 12, pageBreakBefore: false },
      h2: { fontSizePt: 12, align: "left", bold: true, marginTopPt: 12, marginBottomPt: 6, pageBreakBefore: false },
      h3: { fontSizePt: 12, align: "left", bold: true, italic: true, marginTopPt: 12, marginBottomPt: 6, pageBreakBefore: false },
    },
  },
  /* Thèse (convention académique française générique — pas un standard
     universel, à ajuster si ton institution impose d'autres valeurs) :
     Times 12pt interligne 1,5, justifié, césure activée, marge de reliure
     à gauche (3,5cm) plus large que les autres (2,5cm), numéro de page en
     pied de page. Les chapitres (H1) démarrent sur une nouvelle page —
     convention normale d'une thèse — mais pas les sous-sections. */
  these: {
    key: "these",
    label: "Thèse — base",
    titlePage: titlePageFor(12),
    fontFamily: "'Times New Roman', Times, serif",
    fontSizePt: 12,
    lineHeight: 1.5,
    align: "justify",
    indent: true,
    marginsCm: { top: 2.5, bottom: 2.5, left: 3.5, right: 2.5 },
    paragraphSpacing: false,
    pageNumbers: true,
    hyphenation: true,
    headings: {
      h1: { fontSizePt: 20, align: "left", bold: true, marginTopPt: 0, marginBottomPt: 36, pageBreakBefore: true },
      h2: { fontSizePt: 16, align: "left", bold: true, marginTopPt: 24, marginBottomPt: 12, pageBreakBefore: false },
      h3: { fontSizePt: 13, align: "left", bold: true, italic: true, marginTopPt: 18, marginBottomPt: 6, pageBreakBefore: false },
    },
  },
};

/** Catalogue intégré proposé dans l'interface, distinct du registre complet
 * afin que les anciennes clés restent résolubles sans encombrer un nouveau
 * projet. L'ordre est contractuel pour les sélecteurs de gabarits. */
export const BUILTIN_TEMPLATE_CATALOG = ["classique", "romanSimple", "moderne", "apa", "these"] as const;

/** Traduit un modèle vers une carte {h1?,h2?,h3?,h4?,h5?,h6?} uniforme : priorité au
 * champ `headings` (nouveau, plusieurs niveaux) ; à défaut, traduit
 * l'ancien `chapterTitle` (H1 seul, saut de page implicite) pour ne rien
 * casser sur les modèles existants ; à défaut des deux, carte vide — la
 * consommatrice applique alors son repli historique (saut de page
 * systématique, police héritée, pas de taille/graisse imposée).
 * @param {ExportTemplate} tpl
 * @returns {{ h1?: HeadingStyle, h2?: HeadingStyle, h3?: HeadingStyle, h4?: HeadingStyle, h5?: HeadingStyle, h6?: HeadingStyle }}
 */
export function normalizeHeadings(tpl: ExportTemplate): { h1?: HeadingStyle; h2?: HeadingStyle; h3?: HeadingStyle; h4?: HeadingStyle; h5?: HeadingStyle; h6?: HeadingStyle } {
  if (tpl.headings) return tpl.headings;
  if (tpl.chapterTitle) {
    return { h1: { ...tpl.chapterTitle, bold: false, pageBreakBefore: true } };
  }
  return {};
}

/** Modèle intégré par clé, repli sur « classique ». Pure et synchrone :
 * réservée aux tests — le code d'export passe par resolveExportTemplate()
 * (services/export-templates-custom.js), qui tient compte des modèles
 * personnalisés du coffre.
 * @param {string} key
 * @returns {ExportTemplate}
 */
export function templateFor(key: string | null | undefined): ExportTemplate {
  return (key && EXPORT_TEMPLATES[key]) || EXPORT_TEMPLATES.classique;
}

/** 1 cm ≈ 28.3465 points (unité utilisée par CSS/print et par docx).
 * @param {number} cm
 * @returns {number} points, arrondis à l'entier.
 */
export function cmToPt(cm: number) {
  return Math.round(cm * 28.3465);
}

/** Marges effectives d'un modèle, toujours sous forme {top,bottom,left,right}
 * — priorité à marginsCm (asymétrique) si présent, repli sur marginCm
 * (uniforme) sinon.
 * @param {ExportTemplate} tpl
 * @returns {Margins} en centimètres.
 */
export function marginsFor(tpl: ExportTemplate): Margins {
  if (tpl.marginsCm) return tpl.marginsCm;
  const m = tpl.marginCm || 2.5;
  return { top: m, bottom: m, left: m, right: m };
}

export function isPedagogicalA4Template(tpl: ExportTemplate): boolean {
  if (tpl.profile !== "document") return false;
  const identity = `${tpl.key} ${tpl.label}`.toLowerCase();
  return identity.includes("a4") && (identity.includes("pédagogique") || identity.includes("pedagogique"));
}

/** Absent = "legacy" (compatibilité absolue — même repli que
 * normalizedSemanticRoleMarkers côté services/export-template-v2.ts, dupliqué
 * ici pour garder ce module pur/sans dépendance Obsidian). */
function semanticRoleMarkersMode(tpl: ExportTemplate): "legacy" | "show" | "hide" {
  return tpl.semanticRoleMarkers === "show" || tpl.semanticRoleMarkers === "hide" ? tpl.semanticRoleMarkers : "legacy";
}

/** Repères sémantiques Feuillets (Preview paginé + PDF) pour les modes
 * "show"/"hide" — indépendants de `tpl.profile`. Construits à partir
 * de la même source de vérité que le Live Preview (SEMANTIC_ROLE_FAMILY),
 * jamais d'une liste dupliquée. N'affecte jamais les callouts natifs
 * Obsidian (non listés dans SEMANTIC_ROLES) ni le questionnaire
 * `[!questions]` (lignes de réponse générées ailleurs, inchangées). */
function semanticRoleMarkerCss(mode: "show" | "hide"): string {
  const base = [
    ".feuillets-semantic-role { background: transparent; border: 0; box-shadow: none; padding: 0; margin: 8pt 0; color: inherit; }",
    ".feuillets-semantic-role .callout-content { padding: 3pt 0 0; color: inherit; }",
  ];
  if (mode === "show") {
    const families = new Map<string, string[]>();
    for (const role of SEMANTIC_ROLES) {
      const family = SEMANTIC_ROLE_FAMILY[role];
      const selectors = families.get(family) || [];
      selectors.push(`.feuillets-role-${role}`);
      families.set(family, selectors);
    }
    const colorRules = Array.from(families.entries()).map(
      ([family, selectors]) => `${selectors.join(", ")} { color: ${SEMANTIC_PALETTE[family as keyof typeof SEMANTIC_PALETTE]}; }`
    );
    return [
      ...base,
      ".feuillets-semantic-role .callout-title { background: transparent; border: 0; box-shadow: none; padding: 0; display: flex; align-items: center; gap: 4pt; font-weight: 600; }",
      ".feuillets-semantic-role .callout-title .feuillets-role-marker-icon { display: inline-flex; width: 12pt; height: 12pt; color: inherit; }",
      ".feuillets-semantic-role .callout-title .feuillets-role-marker-icon svg { width: 100%; height: 100%; color: inherit; }",
      ".feuillets-semantic-role .callout-title .collapse-indicator { display: none; }",
      ...colorRules,
    ].join("\n");
  }
  // hide : chrome (icône/couleur/label auto) retiré, contenu ET titre
  // éditorial explicite conservés — voir feuillets-role-title-auto,
  // posée par applySemanticRoles (utils/semantic-roles.ts).
  return [
    ...base,
    ".feuillets-semantic-role .collapse-indicator { display: none; }",
    ".feuillets-semantic-role .callout-title { background: transparent; border: 0; box-shadow: none; padding: 0; font-weight: normal; color: inherit; }",
    ".feuillets-semantic-role.feuillets-role-title-auto .callout-title { display: none; }",
  ].join("\n");
}

/** Feuille de style CSS dérivée d'un modèle — utilisée telle quelle par
 * l'export EPUB (balise <style> dans le XHTML) et par l'export PDF
 * (fenêtre d'impression).
 * @param {ExportTemplate} tpl
 * @returns {string}
 */
export function templateToCss(tpl: ExportTemplate) {
  const m = marginsFor(tpl);
  const headings = normalizeHeadings(tpl);

  const headingRules = (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((level) => {
    const h = headings[level];
    // repli historique : toujours un saut de page, police héritée, ni
    // taille ni graisse imposées — comportement des modèles qui ne
    // définissent aucun style de titre particulier (classique/moderne/
    // tapuscrit).
    const pageBreak = h ? !!h.pageBreakBefore : true;
    const headingFont = h?.fontFamily || tpl.headingFontFamily || tpl.fontFamily;
    const rules = [`font-family: ${headingFont};`, `page-break-before: ${pageBreak ? "always" : "avoid"};`];
    const headingColor = h?.colorHex || (isPedagogicalA4Template(tpl)
      ? (level === "h3" ? SEMANTIC_PALETTE.green : (level === "h1" || level === "h2" ? SEMANTIC_PALETTE.red : null))
      : null);
    if (headingColor) rules.push(`color: ${headingColor};`);
    if (h) {
      if (h.fontSizePt) rules.push(`font-size: ${h.fontSizePt}pt;`);
      if (h.align) rules.push(`text-align: ${h.align};`);
      /* seulement si le modèle règle explicitement la graisse : un niveau
         qui ne définit QUE pageBreakBefore (ex. "Classique (manuscrit)")
         ne doit pas se retrouver forcé en graisse normale, écrasant le
         gras par défaut du navigateur/lecteur EPUB pour un <h1>/<h2>. */
      if (h.bold !== undefined) rules.push(`font-weight: ${h.bold ? "bold" : "normal"};`);
      if (h.italic) rules.push(`font-style: italic;`);
      if (h.marginTopPt != null) rules.push(`margin-top: ${h.marginTopPt}pt;`);
      if (h.marginBottomPt != null) rules.push(`margin-bottom: ${h.marginBottomPt}pt;`);
      /* Absent = aucune déclaration (repli historique) : un ancien gabarit
         qui ne définit jamais `underline` ne doit jamais devenir souligné. */
      if (h.underline !== undefined) rules.push(`text-decoration: ${h.underline ? "underline" : "none"};`);
    }
    return `${level} { ${rules.join(" ")} }`;
  });

  return [
    "body {",
    `  font-family: ${tpl.fontFamily};`,
    `  font-size: ${tpl.fontSizePt}pt;`,
    `  line-height: ${tpl.lineHeight};`,
    `  text-align: ${tpl.align};`,
    `  margin: ${cmToPt(m.top)}pt ${cmToPt(m.right)}pt ${cmToPt(m.bottom)}pt ${cmToPt(m.left)}pt;`,
    `  hyphens: ${tpl.hyphenation ? "auto" : "none"};`,
    /* Absent = aucune déclaration `color` (repli historique) — ne prime
       jamais sur les repères sémantiques/callouts/citations/liens, tous
       posés par des sélecteurs plus spécifiques que `body`. */
    ...(tpl.colorHex ? [`  color: ${tpl.colorHex};`] : []),
    "}",
    "p {",
    `  margin: ${tpl.paragraphSpacing ? "0 0 1em 0" : (tpl.paragraphSpacingPt ? `${tpl.paragraphSpacingPt}pt 0 0 0` : "0")};`,
    `  text-indent: ${tpl.indent ? (tpl.indentPt ? `${tpl.indentPt}pt` : "1.5em") : "0"};`,
    "}",
    ...headingRules,
    (tpl.blockquote || tpl.profile === "document")
      ? (() => {
        const quote = tpl.blockquote || {};
        const rules = [`font-style: ${quote.italic ? "italic" : "normal"};`, `color: ${quote.colorHex || "inherit"};`];
        if (tpl.profile === "document") {
          rules.push("border: 0.75pt solid #A0A0A0;", "padding: 8pt 10pt;", "margin: 8pt 0;", "box-sizing: border-box;", "max-width: 100%;");
        }
        if (quote.fontFamily) rules.push(`font-family: ${quote.fontFamily};`);
        if (quote.fontSizePt != null) rules.push(`font-size: ${quote.fontSizePt}pt;`);
        if (quote.lineHeight != null) rules.push(`line-height: ${quote.lineHeight};`);
        if (quote.align) rules.push(`text-align: ${quote.align};`);
        if (quote.marginTopPt != null) rules.push(`margin-top: ${quote.marginTopPt}pt;`);
        if (quote.marginBottomPt != null) rules.push(`margin-bottom: ${quote.marginBottomPt}pt;`);
        if (quote.marginLeftPt != null) rules.push(`margin-left: ${quote.marginLeftPt}pt;`);
        if (quote.marginRightPt != null) rules.push(`margin-right: ${quote.marginRightPt}pt;`);
        const firstLineIndent = quote.firstLineIndentPt ?? (tpl.profile === "document" ? 18 : undefined);
        const indent = firstLineIndent != null ? `\nblockquote p { text-indent: ${firstLineIndent}pt; }` : "";
        return `blockquote { ${rules.join(" ")} }${indent}`;
      })()
      : "",
    `hr { border: none; text-align: center; margin: 2em 0; } hr::before { content: "${tpl.sceneDivider || "* * *"}"; }`,
    "figure { margin: 1em auto; text-align: center; max-width: 100%; }",
    "figure img { max-width: 100%; }",
    "figcaption { font-size: 0.85em; font-style: italic; color: #666; margin-top: 0.4em; }",
    ...(tpl.profile === "document" ? [
      "table { border-collapse: collapse; width: 100%; }",
      "table th, table td { border: 0.5pt solid #A0A0A0; padding: 5pt 7pt; }",
    ] : []),
    ".feuillets-doc-media-block { max-width: 100%; break-inside: avoid; page-break-inside: avoid; margin: 1em 0; }",
    ".feuillets-doc-media-figure { max-width: 100%; }",
    ".feuillets-doc-media-landscape .feuillets-doc-media-figure img { display: block; width: 100%; max-width: 100%; height: auto; margin: 0 auto; }",
    ".feuillets-doc-media-landscape-context { display: grid; grid-template-columns: minmax(0, 28fr) minmax(0, 72fr); gap: 18px; align-items: start; }",
    ".feuillets-doc-media-landscape-context .feuillets-doc-media-content > :first-child { margin-top: 0; }",
    ".feuillets-doc-media-landscape-context .feuillets-doc-media-figure img { display: block; width: calc(100% * var(--feuillets-doc-media-scale, 1)); max-width: 100%; height: auto; margin: 0 auto; }",
    ".feuillets-doc-media-portrait { display: grid; grid-template-columns: minmax(280px, 300px) minmax(0, 1fr); gap: 18pt; align-items: start; }",
    ".feuillets-doc-media-portrait .feuillets-doc-media-figure img { display: block; width: 300px; max-width: 100%; height: auto; }",
    ".feuillets-doc-media-content > :first-child { margin-top: 0; }",
    ".feuillets-doc-media-portrait.feuillets-doc-media-stacked { display: block; }",
    ".feuillets-doc-media-portrait.feuillets-doc-media-stacked .feuillets-doc-media-figure { margin-bottom: 1em; }",
    ...(tpl.profile === "document" ? [
      ".feuillets-doc-media-portrait-flow { display: block; float: left; width: 300px; max-width: 100%; margin: 0 18pt 1em 0; }",
      ".feuillets-doc-media-portrait-flow .feuillets-doc-media-figure img { display: block; width: 300px; max-width: 100%; height: auto; }",
      ".feuillets-doc-media-portrait-flow-clear { clear: both; }",
    ] : []),
    ".feuillets-doc-media-landscape-context.feuillets-doc-media-stacked { display: block; }",
    ".feuillets-doc-media-landscape-context.feuillets-doc-media-stacked .feuillets-doc-media-figure { margin-bottom: 1em; }",
    /* Surcharge locale `%% image: … %%` (LOT 3A) : alignement de BLOC — jamais
       de float/position absolue — et largeur explicite en % du content box.
       `feuillets-image-width-*` (posée après les alignements ci-dessous dans
       la feuille de styles) l'emporte sur le `width: fit-content` par défaut
       quand une largeur est précisée ; sinon le bloc se contente de la taille
       naturelle de l'image, seulement déplacé par les marges. */
    ".feuillets-image-placement-left, .feuillets-image-placement-center, .feuillets-image-placement-right { width: fit-content; max-width: 100%; }",
    ".feuillets-image-placement-left { margin-left: 0; margin-right: auto; }",
    ".feuillets-image-placement-center { margin-left: auto; margin-right: auto; }",
    ".feuillets-image-placement-right { margin-left: auto; margin-right: 0; }",
    ".feuillets-image-placement-full { width: 100%; margin-left: 0; margin-right: 0; }",
    ".feuillets-image-placement-left .feuillets-doc-media-figure img, .feuillets-image-placement-center .feuillets-doc-media-figure img, .feuillets-image-placement-right .feuillets-doc-media-figure img, .feuillets-image-placement-full .feuillets-doc-media-figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; }",
    ".feuillets-image-width-25 { width: 25%; } .feuillets-image-width-33 { width: 33%; } .feuillets-image-width-40 { width: 40%; } .feuillets-image-width-50 { width: 50%; } .feuillets-image-width-60 { width: 60%; } .feuillets-image-width-67 { width: 67%; } .feuillets-image-width-75 { width: 75%; } .feuillets-image-width-100 { width: 100%; }",
    ".feuillets-image-width-25 .feuillets-doc-media-figure img, .feuillets-image-width-33 .feuillets-doc-media-figure img, .feuillets-image-width-40 .feuillets-doc-media-figure img, .feuillets-image-width-50 .feuillets-doc-media-figure img, .feuillets-image-width-60 .feuillets-doc-media-figure img, .feuillets-image-width-67 .feuillets-doc-media-figure img, .feuillets-image-width-75 .feuillets-doc-media-figure img, .feuillets-image-width-100 .feuillets-doc-media-figure img { width: 100%; }",
    /* Compositions explicites `%% colonnes: … %%` (LOT 3B) — transversal à
       tous les profils/modes (aucun gate profile/mode ici, contrairement au
       pairing média+rôle automatique plus bas) : Grid, jamais de float ni
       de position absolue, largeurs en fr (jamais en px). Le gap/align-
       items reprend tel quel la valeur déjà centralisée du pairing média+
       rôle (.feuillets-document-media-role-pair, plus bas) plutôt que
       d'inventer une nouvelle échelle. */
    ".feuillets-columns { display: grid; width: 100%; gap: 14pt; align-items: start; break-inside: avoid; page-break-inside: avoid; margin: 10pt 0; }",
    ".feuillets-columns-40-60 { grid-template-columns: 40fr 60fr; }",
    ".feuillets-columns-50-50 { grid-template-columns: 1fr 1fr; }",
    ".feuillets-columns-60-40 { grid-template-columns: 60fr 40fr; }",
    ".feuillets-column { min-width: 0; }",
    /* Une image de colonne occupe toute la largeur de SA colonne, ratio
       naturel préservé (jamais d'étirement vertical), top-alignée (héritée
       de `align-items: start` ci-dessus) — spécificité (0,1,1) qui l'emporte
       volontairement sur les classes ponctuelles `feuillets-image-placement-*`/
       `feuillets-image-width-*` du LOT 3A (spécificité (0,1,0)) si la même
       image en portait déjà : 3B décide seul de la largeur dans ce cas,
       jamais de double réduction (§16 du lot) — sans !important. */
    ".feuillets-column-media img { display: block; width: 100%; max-width: 100%; height: auto; margin: 0; }",
    ".feuillets-sheet { display: grid; grid-template-columns: 148mm 148mm; width: 297mm; height: 210mm; box-sizing: border-box; page-break-after: always; break-after: page; }",
    ".feuillets-sheet-panel { width: 148mm; height: 210mm; min-width: 0; min-height: 0; box-sizing: border-box; }",
    ".feuillets-sheet-panel .pdf-page { page-break-after: auto; break-after: auto; }",
    /* Rendu legacy (mode "legacy", repli par défaut) : rôles sémantiques avec
       couleurs et styles minimalistes, générés à partir de la source canonique
       (SEMANTIC_ROLE_FAMILY) plutôt que codés en dur — garantit qu'aucun ancien
       rôle n'est référencé et que tous les nouveaux rôles reçoivent leurs
       propriétés. Les modes "show"/"hide" ne réinterprètent jamais ces règles ;
       ils ajoutent leur propre bloc plus bas, indépendant du profil
       (semanticRoleMarkerCss). */
    ...(tpl.profile === "document" && semanticRoleMarkersMode(tpl) === "legacy" ? (() => {
      const legacyBase = [
        ".feuillets-semantic-role { background: transparent; border: 0; box-shadow: none; padding: 0; margin: 10pt 0; color: inherit; }",
        ".feuillets-semantic-role .callout-title { background: transparent; border: 0; box-shadow: none; padding: 0; color: inherit; }",
        ".feuillets-semantic-role .callout-title .callout-icon, .feuillets-semantic-role .callout-title .collapse-indicator { display: none; }",
        ".feuillets-semantic-role .callout-content { padding: 4pt 0 0; color: inherit; }",
      ];
      const families = new Map<string, string[]>();
      const rolesWithAutoTitle: string[] = [];
      for (const [role, family] of Object.entries(SEMANTIC_ROLE_FAMILY)) {
        const selectors = families.get(family) || [];
        selectors.push(`.feuillets-role-${role}`);
        families.set(family, selectors);
        // Rôles avec titre auto masqué : introduction, questions, explication, definition
        if (["introduction", "questions", "explication", "definition"].includes(role)) {
          rolesWithAutoTitle.push(`.feuillets-role-${role}.feuillets-role-title-auto .callout-title`);
        }
      }
      const colorRules = Array.from(families.entries()).map(
        ([family, selectors]) => `${selectors.join(", ")} { color: ${SEMANTIC_PALETTE[family as keyof typeof SEMANTIC_PALETTE]}; }`
      );
      const autoTitleRules = rolesWithAutoTitle.length > 0 ? [`${rolesWithAutoTitle.join(", ")} { display: none; }`] : [];
      return [...legacyBase, ...colorRules, ...autoTitleRules];
    })() : []),
    /* Contrat Questions / médias : entièrement indépendant du choix
       "legacy"/"show"/"hide" — jamais touché par ce lot (§16-§17). */
    ...(tpl.profile === "document" ? [
      ".feuillets-role-questions .callout-content > ol > li::after { content: \"\"; display: block; height: 1.55em; border-bottom: 1px dotted; width: 100%; margin-top: 0.25em; margin-bottom: 0.70em; }",
      ".feuillets-role-questions .callout-content > ol > li.feuillets-answer-custom::after { content: none; display: none; }",
      ".feuillets-answer-line { display: block; height: 1.55em; border-bottom: 1px dotted; width: 100%; margin-top: 0.25em; margin-bottom: 0.70em; }",
      ".feuillets-answer-space { display: block; width: 100%; }",
      ".feuillets-document-media-role-pair { min-width: 0; gap: 14pt; align-items: start; margin: 10pt 0; }",
      ".feuillets-document-media-role-pair-side { display: grid; grid-template-columns: minmax(0, 55fr) minmax(0, 45fr); }",
      ".feuillets-document-media-role-pair-stacked { display: block; }",
      ".feuillets-document-media-role-pair > * { min-width: 0; }",
      ".feuillets-document-media-role-pair-stacked > :first-child { margin-bottom: 10pt; }",
      ".feuillets-directive, .feuillets-pagebreak { display: none; }",
    ] : []),
    /* Repli rouge/rouge/vert du profil Document pédagogique A4 — une
       `colorHex` explicite sur le niveau (headings.h1/h2/h3) prime : même
       valeur posée ici que dans headingRules ci-dessus, sans !important. */
    ...(isPedagogicalA4Template(tpl) ? [
      `.pdf-page-content h1, .feuillets-preview-pages h1 { color: ${headings.h1?.colorHex || SEMANTIC_PALETTE.red}; }`,
      `.pdf-page-content h2, .feuillets-preview-pages h2 { color: ${headings.h2?.colorHex || SEMANTIC_PALETTE.red}; }`,
      `.pdf-page-content h3, .feuillets-preview-pages h3 { color: ${headings.h3?.colorHex || SEMANTIC_PALETTE.green}; }`,
    ] : []),
    /* Slot d'icône des repères sémantiques (`.feuillets-role-marker-icon`,
       un vrai <svg> Lucide injecté par applySemanticRoles via
       setIcon — voir utils/semantic-roles.ts) : TOUJOURS émis, quel que
       soit le profil ou le mode — masqué par défaut. Seul le mode "show"
       (bloc semanticRoleMarkerCss ci-dessous) le rend visible ; "legacy" et
       "hide" restent donc identiques au rendu d'avant l'injection de
       l'icône, y compris pour un gabarit hors profil "document" où le
       chrome sémantique n'est de toute façon jamais stylé. Le slot NATIF
       d'Obsidian (`.callout-icon`) reste lui aussi toujours masqué ici :
       dans ce contexte de rendu détaché (Preview/PDF), il ne contient
       jamais le bon glyphe. */
    ".feuillets-semantic-role .callout-title .feuillets-role-marker-icon { display: none; }",
    ".feuillets-semantic-role .callout-title .callout-icon { display: none; }",
    /* Repères sémantiques Feuillets (16 rôles, tous profils) — Preview
       paginé + PDF uniquement (partagent ce même générateur), jamais
       l'éditeur ni le DOCX. Absent/"legacy" = rien de plus ici. */
    ...(semanticRoleMarkersMode(tpl) !== "legacy" ? [semanticRoleMarkerCss(semanticRoleMarkersMode(tpl) as "show" | "hide")] : []),
  ]
    .filter(Boolean)
    .join("\n");
}

/** CSS des rôles de la page de titre (PDF/HTML) : pour chaque rôle défini dans
 * `titlePage.styles` du modèle, une règle ciblant l'attribut `data-fp-role`
 * posé par export-render.js. Taille, graisse, italique, alignement et marges
 * (haut/bas) sont traduits tels quels ; un champ absent n'émet rien (le rôle
 * garde alors la mise en forme de base de la page Front). Retourne "" si le
 * modèle ne définit aucun style de page de titre. Fonction pure — testée sans
 * navigateur.
 * @param {ExportTemplate} tpl
 * @returns {string} "" si le modèle ne style aucun rôle.
 */
export function titleRoleCss(tpl: ExportTemplate) {
  const styles = tpl && tpl.titlePage && tpl.titlePage.styles;
  if (!styles) return "";
  return Object.entries(styles)
    .map(([role, st]) => {
      if (!st) return "";
      const decl: string[] = [];
      if (st.fontSizePt != null) decl.push(`font-size: ${st.fontSizePt}pt`);
      if (st.bold != null) decl.push(`font-weight: ${st.bold ? 700 : 400}`);
      if (st.italic != null) decl.push(`font-style: ${st.italic ? "italic" : "normal"}`);
      if (st.align) decl.push(`text-align: ${st.align}`);
      if (st.marginTopPt != null) decl.push(`margin-top: ${st.marginTopPt}pt`);
      if (st.marginBottomPt != null) decl.push(`margin-bottom: ${st.marginBottomPt}pt`);
      if (st.marginLeftPt != null) decl.push(`margin-left: ${st.marginLeftPt}pt`);
      if (st.marginRightPt != null) decl.push(`margin-right: ${st.marginRightPt}pt`);
      if (!decl.length) return "";
      return `.feuillets-frontpage [data-fp-role="${role}"] { ${decl.join("; ")}; }`;
    })
    .filter(Boolean)
    .join("\n");
}

/** Colonnes de la page imprimée — n'a de sens que pour un support paginé
 * réel : uniquement consommé par l'export PDF (l'orientation, elle, est
 * posée directement dans la règle @page par l'appelant, pour ne jamais
 * dupliquer/entrer en conflit avec la marge qui y vit aussi). L'EPUB,
 * reflowable par nature, ignore volontairement pageOrientation/columns et
 * reste en continu une colonne (comportement normal d'un ebook).
 * @param {ExportTemplate} tpl
 * @returns {string} "" si le modèle n'est pas en colonnes.
 */
export function templatePrintCss(tpl: ExportTemplate) {
  if (!tpl.columns) return "";
  return `body { column-count: ${tpl.columns.count}; column-gap: ${tpl.columns.gutterPt}pt; }`;
}
