/** CSS reflowable propre à l'EPUB, dérivé du modèle V2. Ce module ne partage
 * aucune implémentation avec templateToCss(), utilisé par Preview/PDF. */
function cssDeclaration(property: string, value: string | number | boolean | undefined): string {
  return value === undefined ? "" : `${property}: ${value};`;
}

export function templateV2ToEpubCss(template: ExportTemplateV2): string {
  const headingCss = (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((level) => {
    const heading = template.headings[level];
    return `${level} { ${[
      cssDeclaration("font-size", heading.fontSizePt != null ? `${heading.fontSizePt}pt` : undefined),
      cssDeclaration("text-align", heading.align),
      cssDeclaration("font-weight", heading.bold === undefined ? undefined : heading.bold ? "bold" : "normal"),
      cssDeclaration("font-style", heading.italic ? "italic" : undefined),
      cssDeclaration("color", heading.colorHex),
      cssDeclaration("margin-top", heading.marginTopPt != null ? `${heading.marginTopPt}pt` : undefined),
      cssDeclaration("margin-bottom", heading.marginBottomPt != null ? `${heading.marginBottomPt}pt` : undefined),
      cssDeclaration("break-before", heading.pageBreakBefore ? "page" : undefined),
    ].filter(Boolean).join(" ")} }`;
  });
  const titleRoles = Object.entries(template.titlePage.styles).map(([role, style]) =>
    `[data-fp-role="${role}"] { ${[
      cssDeclaration("font-size", style.fontSizePt != null ? `${style.fontSizePt}pt` : undefined),
      cssDeclaration("text-align", style.align),
      cssDeclaration("font-weight", style.bold === undefined ? undefined : style.bold ? "bold" : "normal"),
      cssDeclaration("font-style", style.italic ? "italic" : undefined),
      cssDeclaration("margin-top", style.marginTopPt != null ? `${style.marginTopPt}pt` : undefined),
      cssDeclaration("margin-bottom", style.marginBottomPt != null ? `${style.marginBottomPt}pt` : undefined),
      cssDeclaration("margin-left", style.marginLeftPt != null ? `${style.marginLeftPt}pt` : undefined),
      cssDeclaration("margin-right", style.marginRightPt != null ? `${style.marginRightPt}pt` : undefined),
    ].filter(Boolean).join(" ")} }`
  );
  return [
    `body { font-family: ${template.body.fontFamily}; font-size: ${template.body.fontSizePt}pt; line-height: ${template.body.lineHeight}; text-align: ${template.body.align}; hyphens: ${template.body.hyphenation ? "auto" : "none"}; }`,
    `p { text-indent: ${template.body.firstLineIndentPt}pt; margin: ${template.body.paragraphSpacingBeforePt}pt 0 ${template.body.paragraphSpacingAfterPt}pt; }`,
    ...headingCss,
    `blockquote { font-style: ${template.blockquote.italic ? "italic" : "normal"}; color: ${template.blockquote.colorHex || "inherit"}; }`,
    `hr { border: none; text-align: center; margin: 2em 0; } hr::before { content: "${template.sceneDivider || "* * *"}"; }`,
    "figure { margin: 1em auto; text-align: center; max-width: 100%; }",
    "figure img { max-width: 100%; }",
    "figcaption { font-size: 0.85em; font-style: italic; color: #666; margin-top: 0.4em; }",
    ...titleRoles,
  ].join("\n");
}
