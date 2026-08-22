import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_TEMPLATES,
  templateFor,
  cmToPt,
  templateToCss,
  templatePrintCss,
  BUILTIN_TEMPLATE_CATALOG,
  marginsFor,
  normalizeHeadings,
  titleRoleCss,
} from "../src/utils/export-templates.js";

test("templateFor", async (t) => {
  await t.test("retourne le modèle demandé", () => {
    assert.equal(templateFor("moderne"), EXPORT_TEMPLATES.moderne);
  });

  await t.test("se replie sur classique si la clé est inconnue/absente", () => {
    assert.equal(templateFor("inexistant"), EXPORT_TEMPLATES.classique);
    assert.equal(templateFor(undefined), EXPORT_TEMPLATES.classique);
  });
});

test("cmToPt", () => {
  assert.equal(cmToPt(2.5), 71);
  assert.equal(cmToPt(0), 0);
});

test("gabarits intégrés de référence : classique, APA et thèse", () => {
  const classique = EXPORT_TEMPLATES.classique;
  assert.deepEqual(
    {
      fontFamily: classique.fontFamily,
      fontSizePt: classique.fontSizePt,
      lineHeight: classique.lineHeight,
      align: classique.align,
      indent: classique.indent,
      hyphenation: classique.hyphenation,
    },
    {
      fontFamily: "'Times New Roman', Times, serif",
      fontSizePt: 12,
      lineHeight: 2,
      align: "justify",
      indent: true,
      hyphenation: true,
    }
  );

  const apa = EXPORT_TEMPLATES.apa;
  assert.deepEqual(
    {
      fontFamily: apa.fontFamily,
      fontSizePt: apa.fontSizePt,
      lineHeight: apa.lineHeight,
      align: apa.align,
      marginCm: apa.marginCm,
      headings: apa.headings,
    },
    {
      fontFamily: "'Times New Roman', Times, serif",
      fontSizePt: 12,
      lineHeight: 2,
      align: "left",
      marginCm: 2.54,
      headings: {
        h1: { fontSizePt: 12, align: "center", bold: true, marginTopPt: 12, marginBottomPt: 12, pageBreakBefore: false },
        h2: { fontSizePt: 12, align: "left", bold: true, marginTopPt: 12, marginBottomPt: 6, pageBreakBefore: false },
        h3: { fontSizePt: 12, align: "left", bold: true, italic: true, marginTopPt: 12, marginBottomPt: 6, pageBreakBefore: false },
      },
    }
  );

  const these = EXPORT_TEMPLATES.these;
  assert.deepEqual(
    {
      fontFamily: these.fontFamily,
      fontSizePt: these.fontSizePt,
      lineHeight: these.lineHeight,
      marginsCm: these.marginsCm,
      headings: these.headings,
    },
    {
      fontFamily: "'Times New Roman', Times, serif",
      fontSizePt: 12,
      lineHeight: 1.5,
      marginsCm: { top: 2.5, bottom: 2.5, left: 3.5, right: 2.5 },
      headings: {
        h1: { fontSizePt: 20, align: "left", bold: true, marginTopPt: 0, marginBottomPt: 36, pageBreakBefore: true },
        h2: { fontSizePt: 16, align: "left", bold: true, marginTopPt: 24, marginBottomPt: 12, pageBreakBefore: false },
        h3: { fontSizePt: 13, align: "left", bold: true, italic: true, marginTopPt: 18, marginBottomPt: 6, pageBreakBefore: false },
      },
    }
  );
});

test("catalogue intégré : cinq gabarits proposés dans l'ordre et avec les libellés attendus", () => {
  assert.deepEqual(BUILTIN_TEMPLATE_CATALOG, ["classique", "romanSimple", "moderne", "apa", "these"]);
  assert.deepEqual(BUILTIN_TEMPLATE_CATALOG.map((key) => EXPORT_TEMPLATES[key].label), ["Manuscrit éditeur", "Roman", "Document moderne", "APA 7 — base", "Thèse — base"]);
  assert.ok(EXPORT_TEMPLATES.tapuscrit);
  assert.ok(EXPORT_TEMPLATES.romanFrancais);
});

test("templateToCss", async (t) => {
  await t.test("reflète la police et l'alignement du modèle", () => {
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("Times New Roman"));
    assert.ok(css.includes("text-align: justify"));
    assert.ok(css.includes("text-indent: 1.5em"));
  });

  await t.test("désactive le retrait de première ligne si indent est faux", () => {
    const css = templateToCss(EXPORT_TEMPLATES.moderne);
    assert.ok(css.includes("text-indent: 0"));
  });

  await t.test("classique : h1 (partie) sans style forcé, toujours en saut de page", () => {
    // h1 ne règle que pageBreakBefore (voir EXPORT_TEMPLATES) — pas de
    // gras/taille/alignement forcé qui écraserait le style par défaut du
    // navigateur/lecteur EPUB pour ce niveau (bug réel : `font-weight:
    // normal;` apparaissait alors qu'il n'était pas demandé)
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: always; }"));
  });

  await t.test("classique : h2 (titre de chapitre) et h3 (son sous-titre) même taille/alignement/gras, seul h3 en italique, seul h2 en saut de page", () => {
    // titre + sous-titre (ex. import Scrivener d'un titre sur deux
    // lignes, voir compile-export.js) : visuellement de même poids, mais
    // l'italique distingue le sous-titre — et il reste collé à son titre
    // au lieu de démarrer sa propre page. marginBottomPt sur h3 seulement :
    // l'espace avant le corps vient après le sous-titre, pas un gros
    // blanc entre le titre et lui.
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("h2 { font-family: 'Times New Roman', Times, serif; page-break-before: always; font-size: 14pt; text-align: center; font-weight: bold; }"));
    assert.ok(css.includes("h3 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 14pt; text-align: center; font-weight: bold; font-style: italic; margin-bottom: 36pt; }"));
  });

  await t.test("romanSimple : titre de chapitre, séparateur de scène, pas de césure", () => {
    const css = templateToCss(EXPORT_TEMPLATES.romanSimple);
    assert.ok(css.includes("Baskerville"));
    assert.ok(css.includes("hyphens: none"));
    assert.ok(css.includes("font-size: 52pt"));
    assert.ok(css.includes("page-break-before: always"));
    assert.ok(css.includes('content: "* * *"'));
  });

  await t.test("romanFrancais : police de titre distincte de la police du corps", () => {
    const css = templateToCss(EXPORT_TEMPLATES.romanFrancais);
    assert.ok(css.includes("font-family: Garamond"));
    assert.ok(css.includes("h1 { font-family: 'Helvetica Neue'"));
    assert.ok(css.includes("hyphens: auto"));
    assert.ok(css.includes('content: "***"'));
  });

  await t.test("chaque niveau de titre utilise sa police propre puis retombe sur celle du corps", () => {
    const css = templateToCss({
      ...EXPORT_TEMPLATES.classique,
      fontFamily: "Cochin",
      headings: { h1: { fontFamily: "Futura", fontSizePt: 33 }, h2: { fontFamily: "Futura", fontSizePt: 22 } },
    });
    assert.ok(css.includes("h1 { font-family: Futura; page-break-before: avoid; font-size: 33pt; }"));
    assert.ok(css.includes("h2 { font-family: Futura; page-break-before: avoid; font-size: 22pt; }"));
    assert.ok(css.includes("h3 { font-family: Cochin; page-break-before: always; }"));
  });

  await t.test("couleur du corps : colorHex explicite ajoute `color`, absent n'ajoute rien", () => {
    const css = templateToCss({ ...EXPORT_TEMPLATES.classique, colorHex: "#223344" });
    assert.match(css, /body \{[^}]*color: #223344;/);
    const cssSansColor = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(!EXPORT_TEMPLATES.classique.colorHex, "classique ne doit pas définir colorHex (prérequis du test)");
    assert.doesNotMatch(cssSansColor, /body \{[^}]*color:/);
  });

  await t.test("couleur et soulignement des titres : H1 et H6 indépendants, absent n'ajoute rien", () => {
    const css = templateToCss({
      ...EXPORT_TEMPLATES.classique,
      headings: {
        h1: { colorHex: "#AA1122", underline: true },
        h6: { colorHex: "#334455", underline: false },
      },
    });
    assert.match(css, /h1 \{[^}]*color: #AA1122;[^}]*text-decoration: underline;/);
    assert.match(css, /h6 \{[^}]*color: #334455;[^}]*text-decoration: none;/);
    // H2-H5 n'ont reçu ni colorHex ni underline : aucune de ces déclarations.
    for (const level of ["h2", "h3", "h4", "h5"]) {
      const rule = new RegExp(`${level} \\{[^}]*\\}`).exec(css)[0];
      assert.doesNotMatch(rule, /color:/);
      assert.doesNotMatch(rule, /text-decoration:/);
    }
  });

  await t.test("citation : les surcharges locales sont traduites sans changer le repli historique", () => {
    const css = templateToCss({ ...EXPORT_TEMPLATES.classique, blockquote: { fontFamily: "Futura", fontSizePt: 13, lineHeight: 1.2, align: "center", firstLineIndentPt: 9, marginTopPt: 10, marginBottomPt: 11, marginLeftPt: 12, marginRightPt: 13, italic: false, colorHex: "#123456" } });
    for (const rule of ["font-family: Futura;", "font-size: 13pt;", "line-height: 1.2;", "text-align: center;", "margin-top: 10pt;", "margin-bottom: 11pt;", "margin-left: 12pt;", "margin-right: 13pt;", "font-style: normal;", "color: #123456;", "blockquote p { text-indent: 9pt; }"]) assert.ok(css.includes(rule), rule);
    assert.equal(templateToCss({ ...EXPORT_TEMPLATES.classique, blockquote: {} }).includes("blockquote { font-style: normal; color: inherit; }"), true);
  });

  await t.test("apa : pas de saut de page systématique, 3 niveaux de titres distincts", () => {
    const css = templateToCss(EXPORT_TEMPLATES.apa);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid;"));
    assert.ok(css.includes("text-align: center"));
    assert.ok(css.includes("h3 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 12pt; text-align: left; font-weight: bold; font-style: italic;"));
  });

  await t.test("these : chapitres (h1) en saut de page, sous-sections (h2) sans", () => {
    const css = templateToCss(EXPORT_TEMPLATES.these);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: always; font-size: 20pt"));
    assert.ok(css.includes("h2 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 16pt"));
  });

  /* Chantier « Compilation professionnelle — Lot 2 » : avant ce lot, un
   * modèle sans `sceneDivider` (classique/moderne/tapuscrit/apa/these)
   * n'émettait AUCUNE règle `hr::before` — un séparateur de scène
   * s'affichait alors comme un `<hr>` nu, sans le texte "* * *" que DOCX,
   * lui, insère toujours en repli (voir docx-blocks.ts). Vérifie que PDF/
   * EPUB (les deux consommateurs de templateToCss) ont désormais le même
   * repli visuel que DOCX. */
  await t.test("classique (sans sceneDivider défini) : repli \"* * *\" comme DOCX, pas un <hr> nu", () => {
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(!EXPORT_TEMPLATES.classique.sceneDivider, "classique ne doit pas définir sceneDivider (prérequis du test)");
    assert.ok(css.includes('hr::before { content: "* * *"; }'));
  });
});

/* ===== LOT 3B §46 — CSS des compositions explicites `%% colonnes: … %%` ===== */
test("templateToCss : compositions explicites en colonnes — grid-template-columns effectifs, aucun float/absolute", () => {
  const css = templateToCss(EXPORT_TEMPLATES.classique);
  assert.ok(css.includes(".feuillets-columns { display: grid; width: 100%; gap: 14pt; align-items: start;"));
  assert.ok(css.includes(".feuillets-columns-40-60 { grid-template-columns: 40fr 60fr; }"));
  assert.ok(css.includes(".feuillets-columns-50-50 { grid-template-columns: 1fr 1fr; }"));
  assert.ok(css.includes(".feuillets-columns-60-40 { grid-template-columns: 60fr 40fr; }"));
  // Une image de colonne remplit sa colonne (ratio naturel, jamais étirée) —
  // spécificité (0,1,1) qui l'emporte sur les classes ponctuelles du LOT 3A
  // si la même image en portait déjà (§16 du lot) : voir export-templates.ts.
  assert.ok(css.includes(".feuillets-column-media img { display: block; width: 100%; max-width: 100%; height: auto; margin: 0; }"));
  // Interdictions absolues (§14/§46) — scopées aux règles réellement
  // introduites par ce lot : le reste du CSS partagé (ex. les gabarits
  // `.feuillets-doc-media-portrait`/`.feuillets-sheet-panel` en pt/mm/px)
  // est hors périmètre et volontairement inchangé.
  const columnsRules = css.split("\n").filter((line) => /\.feuillets-columns|\.feuillets-column\b|\.feuillets-column-/.test(line)).join("\n");
  assert.notEqual(columnsRules, "");
  for (const forbidden of [/float\s*:/, /position\s*:\s*absolute/, /position\s*:\s*fixed/, /shape-outside/, /transform\s*:/, /width\s*:\s*\d+px/, /!important/]) {
    assert.doesNotMatch(columnsRules, forbidden, String(forbidden));
  }
});

test("templateToCss : la composition colonnes est transversale — aucune dépendance au profil ou au mode structured", () => {
  // Contrairement au pairing média+rôle automatique (gated `profile ===
  // "document"`), les règles `.feuillets-columns` doivent apparaître dans
  // TOUS les profils — la composition est une capacité générale du document.
  for (const key of ["classique", "romanSimple", "moderne", "apa", "these"]) {
    const css = templateToCss(EXPORT_TEMPLATES[key]);
    assert.ok(css.includes(".feuillets-columns-50-50 { grid-template-columns: 1fr 1fr; }"), key);
  }
});

test("templatePrintCss", async (t) => {
  await t.test("vide quand le modèle n'a pas de colonnes", () => {
    assert.equal(templatePrintCss(EXPORT_TEMPLATES.classique), "");
  });

  await t.test("colonnes du modèle romanFrancais", () => {
    const css = templatePrintCss(EXPORT_TEMPLATES.romanFrancais);
    assert.ok(css.includes("column-count: 2"));
    assert.ok(css.includes("column-gap: 45pt"));
  });
});

test("profil Document pédagogique A4 : CSS des rôles, respiration, questions et titres", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.moderne, profile: "document", label: "Modèle Feuillets – Document pédagogique A4" });
  assert.match(css, /h1 \{[^}]*color: #B42318/);
  assert.match(css, /h2 \{[^}]*color: #B42318/);
  assert.match(css, /h3 \{[^}]*color: #2E7D32/);
  assert.match(css, /\.pdf-page-content h1, \.feuillets-preview-pages h1 \{ color: #B42318; \}/);
  assert.match(css, /feuillets-role-questions[^}]*color: #111111/);
  assert.doesNotMatch(css, /text-decoration-line: underline/);
  assert.match(css, /feuillets-role-questions \.callout-content > ol > li::after/);
  assert.match(css, /content: ""/);
  assert.match(css, /height: 1\.55em/);
  assert.match(css, /border-bottom: 1px dotted/);
  assert.match(css, /margin-bottom: 0\.70em/);
  assert.match(css, /margin: 10pt 0/);
  assert.match(css, /feuillets-role-introduction[^}]*callout-title[^}]*display: none/);
  assert.match(css, /feuillets-role-retenir[^}]*color: #B42318/);
  assert.match(css, /feuillets-role-exemple[^}]*font-style: italic/);
  assert.match(css, /blockquote \{[^}]*border: 0\.75pt solid/);
  assert.match(css, /feuillets-document-media-role-pair-side[^}]*display: grid/);
  assert.match(css, /feuillets-document-media-role-pair-stacked[^}]*display: block/);
});

test("profil Document pédagogique A4 : une colorHex explicite sur H1/H2/H3 prime sur le rouge/rouge/vert historique", () => {
  const base = { ...EXPORT_TEMPLATES.moderne, profile: "document", label: "Modèle Feuillets – Document pédagogique A4" };
  // Sans surcharge : rouge/rouge/vert historique inchangé (non-régression).
  const cssHistorique = templateToCss(base);
  assert.match(cssHistorique, /h1 \{[^}]*color: #B42318/);
  assert.match(cssHistorique, /h2 \{[^}]*color: #B42318/);
  assert.match(cssHistorique, /h3 \{[^}]*color: #2E7D32/);
  assert.match(cssHistorique, /\.pdf-page-content h1, \.feuillets-preview-pages h1 \{ color: #B42318; \}/);
  assert.match(cssHistorique, /\.pdf-page-content h2, \.feuillets-preview-pages h2 \{ color: #B42318; \}/);
  assert.match(cssHistorique, /\.pdf-page-content h3, \.feuillets-preview-pages h3 \{ color: #2E7D32; \}/);

  // Avec surcharge explicite : les trois couleurs du gabarit gagnent PARTOUT
  // (règle de titre ET règle .pdf-page-content/.feuillets-preview-pages),
  // sans !important.
  const css = templateToCss({
    ...base,
    headings: { h1: { colorHex: "#123456" }, h2: { colorHex: "#654321" }, h3: { colorHex: "#345678" } },
  });
  assert.match(css, /h1 \{[^}]*color: #123456;/);
  assert.match(css, /h2 \{[^}]*color: #654321;/);
  assert.match(css, /h3 \{[^}]*color: #345678;/);
  assert.match(css, /\.pdf-page-content h1, \.feuillets-preview-pages h1 \{ color: #123456; \}/);
  assert.match(css, /\.pdf-page-content h2, \.feuillets-preview-pages h2 \{ color: #654321; \}/);
  assert.match(css, /\.pdf-page-content h3, \.feuillets-preview-pages h3 \{ color: #345678; \}/);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /h1 \{[^}]*#B42318/);
  assert.doesNotMatch(css, /h2 \{[^}]*#B42318/);
  assert.doesNotMatch(css, /h3 \{[^}]*#2E7D32/);
});

test("couleur du corps : n'écrase jamais les repères sémantiques (document reste bleu, retenir reste rouge)", () => {
  const base = { ...EXPORT_TEMPLATES.moderne, profile: "document", colorHex: "#555555", semanticRoleMarkers: "show" };
  const css = templateToCss(base);
  assert.match(css, /body \{[^}]*color: #555555;/);
  assert.match(css, /\.feuillets-role-document[^{]*\{[^}]*color: #1F5EA8/);
  const legacy = templateToCss({ ...EXPORT_TEMPLATES.moderne, profile: "document", colorHex: "#555555" });
  assert.match(legacy, /body \{[^}]*color: #555555;/);
  assert.match(legacy, /\.feuillets-role-retenir \{ color: #B42318; \}/);
});

// ---------- semanticRoleMarkers : legacy / show / hide ----------

test("semanticRoleMarkers absent === \"legacy\" : rendu historique inchangé", () => {
  const base = { ...EXPORT_TEMPLATES.moderne, profile: "document", label: "Modèle Feuillets – Document pédagogique A4" };
  const withoutField = templateToCss(base);
  const withLegacy = templateToCss({ ...base, semanticRoleMarkers: "legacy" });
  assert.equal(withoutField, withLegacy);
});

test("semanticRoleMarkers legacy : les 15 rôles historiques ne changent pas de CSS", () => {
  const tpl = { ...EXPORT_TEMPLATES.moderne, profile: "document", label: "Modèle Feuillets – Document pédagogique A4" };
  const cssBefore = templateToCss({ ...tpl });
  const cssLegacy = templateToCss({ ...tpl, semanticRoleMarkers: "legacy" });
  assert.equal(cssBefore, cssLegacy);
  assert.match(cssLegacy, /feuillets-role-introduction[^}]*callout-title[^}]*display: none/);
  assert.match(cssLegacy, /feuillets-role-retenir[^}]*color: #B42318/);
});

test("semanticRoleMarkers show : repère compact visible pour un rôle simple", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "show" });
  // A. [!problematique] => repère visible compact (icône + titre, pas de gros encadré).
  assert.match(css, /\.feuillets-pedagogical-role \{[^}]*background: transparent/);
  // Le slot d'icône Feuillets (vrai SVG Lucide injecté par setIcon — voir
  // pedagogical-roles.ts) devient visible ; le slot NATIF Obsidian
  // (.callout-icon, jamais fiable hors Live Preview) reste masqué.
  assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.feuillets-role-marker-icon \{[^}]*display: inline-flex/);
  assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.callout-icon \{ display: none; \}/);
});

test("semanticRoleMarkers show : [!questions] a un repère visible, sans toucher au questionnaire", () => {
  const tpl = { ...EXPORT_TEMPLATES.moderne, profile: "document", semanticRoleMarkers: "show" };
  const css = templateToCss(tpl);
  assert.match(css, /\.feuillets-role-questions/);
  // Le questionnaire (lignes de réponse) reste généré normalement.
  assert.match(css, /feuillets-role-questions \.callout-content > ol > li::after/);
  assert.match(css, /border-bottom: 1px dotted/);
});

test("semanticRoleMarkers show : [!document] Doc 2 : Carte => classe document, icône file-text, bleu, titre conservé", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "show" });
  assert.match(css, /\.feuillets-role-document[^{]*\{[^}]*color: #1F5EA8/);
  // Le titre lui-même n'est jamais réécrit par le CSS — voir pedagogical-roles.js
  // (feuillets-role-title-explicit) : la classe show ne fait qu'afficher ce que
  // le rendu Obsidian a déjà posé dans .callout-title-inner. L'icône réelle
  // (SVG Lucide file-text) est injectée dans .feuillets-role-marker-icon par
  // applyPedagogicalSemantics (via setIcon) — voir test/export-render.test.js.
  assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.feuillets-role-marker-icon \{[^}]*display: inline-flex/);
});

test("semanticRoleMarkers show : [!doc] Figure 3 — Prototype normalisé document, même rendu CSS", () => {
  const cssDoc = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "show" });
  // La classe CSS générée cible .feuillets-role-document pour les deux
  // syntaxes : la normalisation alias -> canonique se fait en amont
  // (applyPedagogicalSemantics), jamais dans ce CSS.
  assert.match(cssDoc, /\.feuillets-role-document/);
  assert.doesNotMatch(cssDoc, /\.feuillets-role-doc[^u]/);
});

test("semanticRoleMarkers show : un callout natif ([!warning]) n'est jamais transformé", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "show" });
  assert.doesNotMatch(css, /data-callout="warning"/);
  assert.doesNotMatch(css, /\.feuillets-role-warning/);
});

test("semanticRoleMarkers hide : chrome retiré (icône/couleur/label auto), contenu conservé", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "hide" });
  // Le slot d'icône (natif Obsidian et repère Feuillets) reste masqué par
  // la règle TOUJOURS émise (§ correctif icônes Lucide) — plus besoin d'une
  // règle spécifique au mode hide pour ça.
  assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.feuillets-role-marker-icon \{ display: none; \}/);
  assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.callout-icon \{ display: none; \}/);
  assert.match(css, /\.feuillets-pedagogical-role \.collapse-indicator \{ display: none; \}/);
  assert.match(css, /\.feuillets-pedagogical-role\.feuillets-role-title-auto \.callout-title \{ display: none; \}/);
  assert.match(css, /\.feuillets-pedagogical-role \.callout-content \{ padding: 3pt 0 0; color: inherit; \}/);
});

test("semanticRoleMarkers hide : aucune règle de couleur par famille (contrairement à show)", () => {
  const cssHide = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "hide" });
  const cssShow = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "show" });
  assert.doesNotMatch(cssHide, /\.feuillets-role-document[^{]*\{[^}]*color: #1F5EA8/);
  assert.match(cssShow, /\.feuillets-role-document[^{]*\{[^}]*color: #1F5EA8/);
});

test("semanticRoleMarkers hide : le questionnaire (liste + lignes de réponse) reste présent", () => {
  const tpl = { ...EXPORT_TEMPLATES.moderne, profile: "document", semanticRoleMarkers: "hide" };
  const css = templateToCss(tpl);
  assert.match(css, /feuillets-role-questions \.callout-content > ol > li::after/);
  assert.match(css, /border-bottom: 1px dotted/);
});

test("semanticRoleMarkers hide : un callout natif ([!warning]) reste intact", () => {
  const css = templateToCss({ ...EXPORT_TEMPLATES.classique, semanticRoleMarkers: "hide" });
  assert.doesNotMatch(css, /\.feuillets-role-warning/);
});

test("marginsFor", async (t) => {
  await t.test("repli symétrique sur marginCm quand marginsCm est absent", () => {
    assert.deepEqual(marginsFor(EXPORT_TEMPLATES.classique), {
      top: 2.5,
      bottom: 2.5,
      left: 2.5,
      right: 2.5,
    });
  });

  await t.test("marges asymétriques quand marginsCm est présent (romanSimple)", () => {
    assert.deepEqual(marginsFor(EXPORT_TEMPLATES.romanSimple), {
      top: 2.5,
      bottom: 2.5,
      left: 3,
      right: 3.5,
    });
  });
});

test("normalizeHeadings", () => {
  assert.deepEqual(normalizeHeadings({ headings: { h2: { bold: true } } }), { h2: { bold: true } });
  assert.deepEqual(normalizeHeadings({ chapterTitle: { fontSizePt: 24 } }), {
    h1: { fontSizePt: 24, bold: false, pageBreakBefore: true },
  });
  assert.deepEqual(normalizeHeadings({}), {});
});

test("titleRoleCss", () => {
  const css = titleRoleCss({
    titlePage: { styles: { titre: { fontSizePt: 24, bold: true, marginBottomPt: 18 } } },
  });
  assert.match(css, /font-size: 24pt/);
  assert.match(css, /font-weight: 700/);
  assert.match(css, /margin-bottom: 18pt/);
  assert.equal(titleRoleCss({ titlePage: { styles: { titre: {} } } }), "");
});
