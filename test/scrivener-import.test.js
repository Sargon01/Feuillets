import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTag,
  extractAllTags,
  checkScrivenerFormat,
  parseScrivx,
  classifyResearchFolder,
  researchTargetLabel,
  mapScrivenerStatus,
  countImportPreview,
  rtfToMarkdown,
  rtfPathCandidates,
  buildSceneFrontmatter,
  extractHeadingTitle,
  extractChapterTitleMarker,
  parseScrivenerComments,
  sanitizeScrivenerTitle,
  allocateImportPath,
  buildScrivenerImportPlan,
} from "../src/services/scrivener-import.js";

const SCRIVX_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ProjectTitle>Mon Roman</ProjectTitle>
  <LabelSettings>
    <Labels>
      <ListItem ID="1" Name="Rouge"/>
    </Labels>
  </LabelSettings>
  <StatusSettings>
    <StatusItems>
      <ListItem ID="10" Name="First Draft"/>
    </StatusItems>
  </StatusSettings>
  <Binder>
    <BinderItem UUID="root-draft" Type="DraftFolder">
      <Title>Mon Manuscrit Renommé</Title>
      <Children>
        <BinderItem UUID="p1" Type="Folder">
          <Title>Partie 1</Title>
          <Children>
            <BinderItem UUID="s1" Type="Text">
              <Title>Scène 1</Title>
              <MetaData>
                <Synopsis>Une scène.</Synopsis>
                <StatusID>10</StatusID>
              </MetaData>
            </BinderItem>
          </Children>
        </BinderItem>
        <BinderItem UUID="p2" Type="Folder">
          <Title>Partie 2</Title>
        </BinderItem>
        <BinderItem UUID="p3" Type="Folder">
          <Title>Partie 3</Title>
        </BinderItem>
        <BinderItem UUID="p4" Type="Folder">
          <Title>Partie 4</Title>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="root-research" Type="ResearchFolder">
      <Title>Research</Title>
      <Children>
        <BinderItem UUID="characters-folder" Type="Folder">
          <Title>Characters</Title>
          <Children>
            <BinderItem UUID="char1" Type="Text">
              <Title>Alice</Title>
            </BinderItem>
          </Children>
        </BinderItem>
        <BinderItem UUID="misc1" Type="Text">
          <Title>Note diverse</Title>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="root-trash" Type="TrashFolder">
      <Title>Trash</Title>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

test("extractTag / extractAllTags — profondeur suivie", async (t) => {
  await t.test("extrait le contenu d'un tag unique", () => {
    assert.equal(extractTag("<a><b>x</b></a>", "b"), "x");
  });

  await t.test("ne s'arrête pas à la première fermeture d'un tag imbriqué en lui-même", () => {
    const xml = "<Item><Item>enfant</Item></Item>";
    // le PREMIER <Item> englobe le second : son contenu doit inclure
    // l'enfant entier, pas s'arrêter à la première </Item> rencontrée
    assert.equal(extractTag(xml, "Item"), "<Item>enfant</Item>");
  });

  await t.test("extractAllTags ne remonte que les tags de premier niveau", () => {
    const xml = "<Item>a<Item>b</Item></Item><Item>c</Item>";
    const items = extractAllTags(xml, "Item");
    assert.equal(items.length, 2);
    assert.equal(items[0].body, "a<Item>b</Item>");
    assert.equal(items[1].body, "c");
  });

  await t.test("ne confond pas un tag avec un autre dont il est le préfixe", () => {
    const xml = "<Item>x</Item><ItemGroup>y</ItemGroup>";
    const items = extractAllTags(xml, "Item");
    assert.equal(items.length, 1);
    assert.equal(items[0].body, "x");
  });

  await t.test("tag absent renvoie une chaîne vide", () => {
    assert.equal(extractTag("<a></a>", "b"), "");
  });
});

test("checkScrivenerFormat", async (t) => {
  await t.test("accepte un dossier .scriv moderne", () => {
    const r = checkScrivenerFormat(["Mon Projet.scrivx", "Files", "Settings.plist"]);
    assert.equal(r.ok, true);
    assert.equal(r.scrivxName, "Mon Projet.scrivx");
  });

  await t.test("rejette l'ancien format Scrivener 1.x (Mac)", () => {
    const r = checkScrivenerFormat(["binder.scrivproj", "Files"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /Scrivener 1\.x/);
  });

  await t.test("signale l'absence de .scrivx", () => {
    const r = checkScrivenerFormat(["Files", "Settings.plist"]);
    assert.equal(r.ok, false);
  });
});

test("parseScrivx — classification par Type XML, pas par titre", async (t) => {
  const parsed = parseScrivx(SCRIVX_FIXTURE);

  await t.test("reconnaît le dossier Draft même renommé par l'utilisateur", () => {
    assert.ok(parsed.draft);
    assert.equal(parsed.draft.title, "Mon Manuscrit Renommé");
  });

  await t.test("importe les 4 parties, quel que soit leur nom — le bug StoryLine à ne pas reproduire", () => {
    assert.equal(parsed.draft.children.length, 4);
    assert.deepEqual(
      parsed.draft.children.map((c) => c.title),
      ["Partie 1", "Partie 2", "Partie 3", "Partie 4"]
    );
  });

  await t.test("descend récursivement dans les scènes avec leurs métadonnées", () => {
    const scene = parsed.draft.children[0].children[0];
    assert.equal(scene.title, "Scène 1");
    assert.equal(scene.synopsis, "Une scène.");
    assert.equal(scene.statusTitle, "First Draft");
  });

  await t.test("reconnaît Research et Trash par Type, pas par titre", () => {
    assert.ok(parsed.research);
    assert.ok(parsed.trash);
    assert.equal(parsed.others.length, 0);
  });

  await t.test("aucun élément racine perdu même sans correspondance", () => {
    // aucun des 3 dossiers racines fixes ne devrait finir dans "others"
    // ici — vérifié pour la régression inverse (rien de connu mal classé)
    assert.equal(parsed.others.length, 0);
  });

  await t.test("extrait les mots-clés Scrivener depuis KeywordSettings et les associe aux tags du binder", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <KeywordSettings>
    <Keywords>
      <Keyword ID="100">
        <Title>Polar</Title>
      </Keyword>
      <Keyword ID="101">
        <Title>Enquête</Title>
      </Keyword>
    </Keywords>
  </KeywordSettings>
  <Binder>
    <BinderItem UUID="root-draft" Type="DraftFolder">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="s1" Type="Text">
          <Title>Scène 1</Title>
          <MetaData>
            <Keywords>
              <KeywordID>100</KeywordID>
              <KeywordID>101</KeywordID>
            </Keywords>
          </MetaData>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;
    const res = parseScrivx(xml);
    const scene = res.draft.children[0];
    assert.deepEqual(scene.keywords, ["Polar", "Enquête"]);
  });
});

test("classifyResearchFolder / researchTargetLabel", async (t) => {
  await t.test("reconnaît Characters", () => {
    assert.equal(classifyResearchFolder("Characters"), "personnages");
    assert.equal(classifyResearchFolder("Character Sketches"), "personnages");
  });

  await t.test("reconnaît Places/Locations/Settings", () => {
    assert.equal(classifyResearchFolder("Places"), "lieux");
    assert.equal(classifyResearchFolder("Locations"), "lieux");
    assert.equal(classifyResearchFolder("Settings"), "lieux");
  });

  await t.test("panier de repli explicite pour le reste, pas de fausse correspondance", () => {
    assert.equal(classifyResearchFolder("Recherches diverses"), null);
    assert.equal(classifyResearchFolder(""), null);
  });

  await t.test("nom de dossier cible selon le mode du projet", () => {
    assert.equal(researchTargetLabel("Characters", "fiction"), "Characters");
    assert.equal(researchTargetLabel("Places", "fiction"), "Places");
    /* La non-fiction ne force plus de rubriques Personnages/Lieux (voir
       utils/project-modes.js) — Characters/Places Scrivener y tombent donc
       dans le panier de repli "non classé" plutôt que dans un dossier
       renommé Acteurs/Géographie qui n'existe plus. */
    assert.equal(researchTargetLabel("Characters", "nonfiction"), null);
    assert.equal(researchTargetLabel("Places", "nonfiction"), null);
    assert.equal(researchTargetLabel("Recherches diverses", "fiction"), null);
  });
});

test("mapScrivenerStatus", async (t) => {
  await t.test("mappe les statuts par défaut de Scrivener", () => {
    assert.equal(mapScrivenerStatus("First Draft"), "Brouillon");
    assert.equal(mapScrivenerStatus("Final Draft"), "Terminé");
    assert.equal(mapScrivenerStatus("To Do"), "Idée");
  });

  await t.test("statut inconnu ou absent ne casse rien et préserve le statut personnalisé", () => {
    assert.equal(mapScrivenerStatus(""), "");
    assert.equal(mapScrivenerStatus("Statut Personnalisé"), "Statut Personnalisé");
  });
});

test("countImportPreview", async (t) => {
  await t.test("compte dossiers/scènes du manuscrit et fiches de recherche", () => {
    const parsed = parseScrivx(SCRIVX_FIXTURE);
    const counts = countImportPreview(parsed);
    assert.deepEqual(counts, {
      folders: 4,
      scenes: 1,
      researchEntries: 2,
      unclassifiedRoots: 0,
    });
  });
});

test("rtfToMarkdown", async (t) => {
  await t.test("texte brut sans RTF passe tel quel", () => {
    assert.deepEqual(rtfToMarkdown("Juste du texte."), {
      text: "Juste du texte.",
      footnotes: [],
    });
  });

  await t.test("gras et italique", () => {
    const rtf = "{\\rtf1\\ansi Hello \\b bold\\b0  and \\i italic\\i0  text.\\par Second paragraph.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Hello **bold** and *italic* text.\n\nSecond paragraph.");
  });

  await t.test("italique avec espace de fin capturé avant \\i0 ne déborde pas sur la suite", () => {
    // RTF mal formé (fréquent chez Scrivener) : l'espace après le mot
    // italique est inclus dans la portée \i avant que \i0 ne la referme.
    // Sans correction, ça produit "*ney *" — invalide en Markdown, ce qui
    // faisait basculer TOUT le texte suivant en italique (le "*" perdu
    // s'appariait avec le prochain "*" du document).
    const rtf = "{\\rtf1 \\i ney \\i0 continues in normal text.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*ney* continues in normal text.");
  });

  await t.test("gras avec le même défaut d'espace de fin", () => {
    const rtf = "{\\rtf1 \\b strong \\b0 rest.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "**strong** rest.");
  });

  await t.test("\\line (retour à la ligne) referme puis rouvre l'italique en cours, et laisse une vraie ligne blanche", () => {
    // une citation italique sur 2 lignes (Maj+Entrée dans Scrivener) reste
    // en italique pour le lecteur, mais chaque ligne a désormais sa
    // PROPRE paire de "*" (Markdown ne représente pas une emphase qui
    // traverse une ligne blanche, voir breakParagraph) — et \line doit
    // produire une ligne blanche, pas un simple \n invisible une fois
    // rendu en Markdown
    const rtf = "{\\rtf1\\i line one\\line line two\\i0  after.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*line one*\n\n*line two* after.");
  });

  await t.test("un \\line capturé dans la portée avant le \\i0 réel ne laisse pas le marqueur seul sur sa ligne", () => {
    // symptôme observé : quand Scrivener inclut un retour à la ligne DANS
    // la sélection italique (juste avant de la refermer), le marqueur de
    // fermeture atterrissait seul sur la ligne suivante au lieu de coller
    // au dernier mot réel
    const rtf = "{\\rtf1\\i line one\\line line two\\line\\i0\\par Next.}";
    const { text } = rtfToMarkdown(rtf);
    // le \line absorbé dans la fermeture + le \par juste après totalisent
    // 4 sauts consécutifs, désormais lus comme une ligne blanche voulue
    // (voir le test dédié plus bas) — le marqueur reste correctement collé
    // à "two", ce que ce test vérifie avant tout
    assert.equal(text, "*line one*\n\n*line two*\n\u00A0\n\nNext.");
  });

  await t.test("guillemets et tirets typographiques", () => {
    const rtf = "{\\rtf1 \\lquote a\\rquote  \\emdash  \\ldblquote b\\rdblquote }";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "‘a’ — “b”");
  });

  await t.test("une tabulation devient un retrait (EM SPACE Unicode), jamais un bloc de code Markdown", () => {
    // une vraie tabulation en tête de ligne est lue par CommonMark comme
    // un bloc de code indenté -- jamais l'intention pour un simple
    // retrait de vers (ex. la traduction indentée d'un poème en
    // épigraphe). &emsp; (HTML) a été essayé puis abandonné : Obsidian ne
    // l'interprète pas en dehors d'un contexte HTML explicite, il
    // ressortait tel quel en texte visible. U+2003 (EM SPACE) est un vrai
    // caractère Unicode, hors de la catégorie que CommonMark compte pour
    // la règle des 4 espaces, et non fusionné par le rendu HTML.
    const rtf = "{\\rtf1 Premier vers.\\par \\tab Traduction indentée.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Premier vers.\n\n  Traduction indentée.");
  });

  await t.test("un retour à la ligne RTF dans une portée italique ne produit pas deux espaces après le marqueur", () => {
    // cas réel (NEFES.scriv) : "...du \n\i tekke\n\i0  ?" — le \n dans
    // l'italique ajoute un espace à "tekke", repoussé après le "*" à la
    // fermeture, et le littéral " ?" apporte le sien → "*tekke*  ?".
    const rtf = "{\\rtf1 du \n\\i tekke\n\\i0  ? Ils approchent.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "du *tekke* ? Ils approchent.");
  });

  await t.test("l'espace parasite avant la ponctuation après un italique fermant est retiré (mais pas avant ?)", () => {
    // cas réels (NEFES.scriv) : "\i Allahu Ekber\n\i0 . Le" -> "* ." parasite.
    assert.equal(rtfToMarkdown("{\\rtf1 le \\i Rahman\n\\i0 . Non.}").text, "le *Rahman*. Non.");
    // le point-virgule/point d'interrogation gardent leur espace (insécable à l'export)
    assert.equal(rtfToMarkdown("{\\rtf1 le \\i mot\n\\i0  ? Oui.}").text, "le *mot* ? Oui.");
    // un mot ordinaire après l'italique garde bien son espace
    assert.equal(rtfToMarkdown("{\\rtf1 Le \\i mot\\i0  vaut mieux.}").text, "Le *mot* vaut mieux.");
  });

  await t.test("l'espace parasite après une apostrophe d'élision avant un italique ouvrant est retiré", () => {
    // cas réel : "L\'92\n\i ezan" -> "L’ *ezan*" ; l'élision colle au mot
    const rtf = "{\\rtf1 L\\'92\n\\i ezan\n\\i0  du matin.}";
    assert.equal(rtfToMarkdown(rtf).text, "L’*ezan* du matin.");
  });

  await t.test("un octet de tabulation brut (0x09) dans le flux, pas le mot de contrôle \\tab, est traité pareil", () => {
    // cas réel observé dans le projet de l'utilisateur : Scrivener n'émet
    // pas toujours \tab, parfois un octet 0x09 littéral est directement
    // dans le texte RTF — sans ce cas, il atterrissait tel quel dans le
    // Markdown (retrait de bloc de code CommonMark garanti)
    const rtf = "{\\rtf1 Premier vers.\\par \tTraduction indentée.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Premier vers.\n\n  Traduction indentée.");
  });

  await t.test("un saut de ligne encodé en \\u8232 (U+2028 LINE SEPARATOR) plutôt qu'en \\line est traité pareil", () => {
    // cas réel observé dans un poème du projet : Word/Scrivener encodent
    // parfois un simple retour à la ligne via l'échappement Unicode
    // U+2028 au lieu du mot de contrôle \line — sans ce cas, le caractère
    // brut atterrissait tel quel dans le Markdown, et ressortait comme une
    // barre oblique parasite à l'export Word.
    const rtf = "{\\rtf1 Premier vers.\\u8232 ?Second vers.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Premier vers.\n\nSecond vers.");
  });

  await t.test("un \\u65279 (U+FEFF, artefact Word invisible) est abandonné, pas émis", () => {
    // observé collé juste avant un \i0 fermant dans un vrai fichier : un
    // caractère invisible sans signification de prose, jamais voulu dans
    // le texte final
    const rtf = "{\\rtf1 \\i Un vers.\\u65279 ?\\i0  Suite.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*Un vers.* Suite.");
  });

  await t.test("retire un octet de contrôle brut corrompu — cas réel qui cassait l'export docx (illégal en XML)", () => {
    // trouvé tel quel (pas via un code RTF) dans un vrai fichier .rtf du
    // projet — un artefact de corruption (accroc de synchronisation),
    // jamais du texte voulu. Word refusait d'ouvrir le .docx compilé tant
    // que ce caractère traversait la conversion sans filtre.
    const rtf = "{\\rtf1 Avant\x05après.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Avantaprès.");
  });

  await t.test("caractère accentué via échappement hexadécimal Windows-1252 (128-159)", () => {
    // 0x92 = apostrophe typographique dans la plage spéciale CP1252,
    // PAS un octet Latin-1 direct — le cas que la table CP1252_HIGH corrige
    const rtf = "{\\rtf1 It\\'92s here.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "It’s here.");
  });

  await t.test("note de bas de page conservée, pas supprimée comme chez StoryLine", () => {
    const rtf = "{\\rtf1 Some text with a note{\\footnote\\pard\\plain footnote body here.} continues.}";
    const { text, footnotes } = rtfToMarkdown(rtf);
    assert.equal(text, "Some text with a note[^1] continues.");
    assert.deepEqual(footnotes, ["footnote body here."]);
  });

  await t.test("plusieurs notes de bas de page numérotées dans l'ordre", () => {
    const rtf = "{\\rtf1 A{\\footnote un.} B{\\footnote deux.}}";
    const { text, footnotes } = rtfToMarkdown(rtf);
    assert.equal(text, "A[^1] B[^2]");
    assert.deepEqual(footnotes, ["un.", "deux."]);
  });

  await t.test("une note de bas de page passe par le même nettoyage final que le texte principal", () => {
    // bug réel : un "*" littéral dans une note s'en tirait avec le
    // caractère de repli non remplacé, jamais échappé en "\*" comme le
    // reste du texte — les notes sautaient le nettoyage final
    const rtf = "{\\rtf1 A{\\footnote une note avec un * dedans.}}";
    const { footnotes } = rtfToMarkdown(rtf);
    assert.deepEqual(footnotes, ["une note avec un \\* dedans."]);
  });

  await t.test("commentaire Scrivener (scrivcmt://) marqué Footnote : le mot annoté est conservé et la note importée", () => {
    // cas réel découvert dans le projet de l'utilisateur : Scrivener ne
    // stocke PAS ses notes de bas de page via \footnote dans le fichier de
    // travail, mais via un champ Word {\field{\*\fldinst{HYPERLINK
    // "scrivcmt://<UUID>"}}{\fldrslt <mot>}} — le texte de la note vit dans
    // un fichier séparé (content.comments). Sans ce cas, tout le groupe
    // (mot annoté inclus) tombait dans le nettoyage générique des
    // destinations \field, effaçant le mot du texte.
    const rtf =
      '{\\rtf1 La {\\field{\\*\\fldinst{HYPERLINK "scrivcmt://AAAAAAAA-0000-0000-0000-000000000001"}}{\\fldrslt boue}} ocre.}';
    const comments = {
      "AAAAAAAA-0000-0000-0000-000000000001": { rtf: "{\\rtf1 Ceci est une note.}", isFootnote: true },
    };
    const { text, footnotes } = rtfToMarkdown(rtf, comments);
    assert.equal(text, "La boue[^1] ocre.");
    assert.deepEqual(footnotes, ["Ceci est une note."]);
  });

  await t.test("commentaire Scrivener SANS Footnote : le mot est conservé et le commentaire est importé au format Obsidian", () => {
    const rtf = "{\\rtf1 La {\\field{\\*\\fldinst{HYPERLINK \"scrivcmt://BBBBBBBB-0000-0000-0000-000000000002\"}}{\\fldrslt boue}} ocre.}";
    const comments = {
      "BBBBBBBB-0000-0000-0000-000000000002": { rtf: "{\\rtf1 Remarque interne.}", isFootnote: false },
    };
    const res = rtfToMarkdown(rtf, comments);
    assert.equal(res.text, "La boue ocre.");
    assert.equal(res.footnotes.length, 0);
    assert.equal(res.extractedComments[0].word, "boue");
    assert.equal(res.extractedComments[0].text, "Remarque interne.");
  });

  await t.test("champ scrivcmt:// sans correspondance dans `comments` (ou `comments` omis) : mot conservé, pas d'erreur", () => {
    const rtf =
      '{\\rtf1 La {\\field{\\*\\fldinst{HYPERLINK "scrivcmt://FFFFFFFF-0000-0000-0000-000000000099"}}{\\fldrslt boue}} ocre.}';
    const { text, footnotes } = rtfToMarkdown(rtf);
    assert.equal(text, "La boue ocre.");
    assert.deepEqual(footnotes, []);
  });

  await t.test("tableau basique rendu en Markdown, pas de cellules concaténées", () => {
    const rtf = "{\\rtf1\\trowd A1\\cell B1\\cell\\row\\trowd A2\\cell B2\\cell\\row}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "| A1 | B1 |\n| --- | --- |\n| A2 | B2 |");
  });

  await t.test("retire les marqueurs internes Scrivener (texte littéral, pas des mots de contrôle RTF)", () => {
    // le marqueur n'est pas en tête de document ici (un paragraphe le
    // précède) : c'est le cas générique de nettoyage, pas l'extraction du
    // titre de chapitre (voir le test dédié ci-dessous pour ce dernier cas)
    const rtf =
      "{\\rtf1 Avant.\\par <$ScrKeepWithNext><$Scr_Ps::1>Du texte normal.<!$Scr_Ps::1>}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Avant.\n\nDu texte normal.");
  });

  await t.test("le contenu Scr_Ps en tête de document est le titre du chapitre (pas un artefact à jeter)", () => {
    // un "4" isolé au tout début du corps, entre les tout premiers marqueurs
    // Scr_Ps du document, N'EST PAS un numéro de scène auto-généré redondant
    // — c'est le style "Titre chapitre" de Scrivener, qui peut être un simple
    // nombre selon la convention de titrage du roman. Il est retourné dans
    // `chapterTitle` (-> frontmatter à l'import) ET matérialisé en tête de
    // corps au format "Body Title" attendu par Feuillets (## Titre), pour que
    // le titre reste visible dans le manuscrit rendu.
    const rtf = "{\\rtf1 <$Scr_Ps::0>4\\par <!$Scr_Ps::0><$Scr_Ps::1>Kemal resta seul.<!$Scr_Ps::1>}";
    const { text, chapterTitle } = rtfToMarkdown(rtf);
    assert.equal(chapterTitle, "4");
    assert.equal(text, "## 4\n\nKemal resta seul.");
  });

  await t.test("insère un espace de secours si le retrait du marqueur fusionnerait deux mots", () => {
    const rtf = "{\\rtf1 mot1<$Scr_Ps::9>mot2}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "mot1 mot2");
  });

  await t.test("un retour à la ligne réel précédé d'un antislash équivaut à \\par (Scrivener n'utilise jamais \\par littéralement)", () => {
    const rtf = "{\\rtf1 Para one.\\\nPara two.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Para one.\n\nPara two.");
  });

  await t.test("cas réel observé : citation italique refermée par un antislash+retour à la ligne, pas \\par", () => {
    // reproduit exactement le RTF trouvé dans Bozlak.scriv : le marqueur
    // de fermeture atterrissait collé au début du paragraphe suivant
    const rtf = "{\\rtf1\\i Quels secrets, mon oncle ?\\\n\\i0 Ceux de l'oncle.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*Quels secrets, mon oncle ?*\n\nCeux de l'oncle.");
  });

  await t.test("un saut de paragraphe referme puis rouvre le gras/l'italique en cours — chaque paragraphe reste valide en Markdown", () => {
    // cas réel observé dans Bozlak.scriv : un poème de plusieurs vers,
    // un seul \i ouvrant au début et un seul \i0 fermant à la toute fin,
    // les vers séparés par des sauts de paragraphe (antislash+retour à la
    // ligne). Markdown ne sait PAS représenter une emphase qui traverse
    // une ligne blanche ("*vers un\n\nvers deux*" n'est valide qu'à
    // l'intérieur d'un même paragraphe) — sans le refermer/rouvrir à
    // chaque saut, les "*" ressortaient littéralement à l'export Word au
    // lieu de produire de l'italique. Chaque paragraphe a donc sa PROPRE
    // paire de marqueurs, mais le lecteur voit un seul passage continu.
    const rtf = "{\\rtf1\\i Line one\\\nLine two\\\nLine three\\i0\\par Plain after.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*Line one*\n\n*Line two*\n\n*Line three*\n\nPlain after.");
  });

  await t.test("dégage une emphase qui n'entoure que de la ponctuation (changement de police RTF sur un point final)", () => {
    // cas réel : "...glacial" + changement de police + \i sur juste "."
    // — un artefact d'export, jamais une intention stylistique
    const rtf = "{\\rtf1 Le silence glacial\\i .\\i0\\par Suite.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Le silence glacial.\n\nSuite.");
  });

  await t.test("dégage aussi le cas gras", () => {
    const rtf = "{\\rtf1 Mot\\b ,\\b0  suite.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Mot, suite.");
  });

  await t.test("ne dégage pas une emphase qui contient un vrai mot", () => {
    const rtf = "{\\rtf1 Le \\i ney\\i0  est cassé.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Le *ney* est cassé.");
  });

  await t.test("le nettoyage \"ponctuation seule\" ne fusionne pas deux emphases sans rapport séparées par un blanc de paragraphe", () => {
    // bug réel observé sur Bozlak.scriv : la fermeture d'une citation
    // ("...hériter.*") et l'ouverture d'une épigraphe bien plus loin
    // ("*Yar selam...") ont été effacées ensemble — la regex traitait tout
    // le blanc entre les deux (guillemet, sauts de paragraphe, "***") comme
    // une seule "emphase de ponctuation" à dégager, alors que ce sont deux
    // portées italiques distinctes et correctement fermées chacune de leur
    // côté, avec juste du texte littéral entre les deux.
    const rtf = "{\\rtf1\\i Fin de citation.\\i0 » \\par ***\\par \\i Début\\i0}";
    const { text } = rtfToMarkdown(rtf);
    // "***" est du texte littéral tapé par l'auteur (séparateur de scène),
    // échappé en "\*\*\*" — voir le test dédié plus bas. Pas d'espace après
    // "»" : chaque ligne est passée en trimEnd() (nettoyage intentionnel des
    // espaces traînants RTF, voir rtfToMarkdown), donc l'espace avant le
    // \par est retiré — ça n'a rien à voir avec le bug que ce test vérifie
    // (les deux emphases ne doivent pas fusionner).
    assert.equal(text, "*Fin de citation.*»\n\n\\*\\*\\*\n\n*Début*");
  });

  await t.test("échappe un séparateur \"***\" littéral pour qu'il ne soit jamais rendu comme une syntaxe Markdown", () => {
    const rtf = "{\\rtf1 Avant.\\par ***\\par Après.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Avant.\n\n\\*\\*\\*\n\nAprès.");
  });

  await t.test("échappe un \"*\" littéral isolé sans le confondre avec une emphase", () => {
    const rtf = "{\\rtf1 Avant * après.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Avant \\* après.");
  });

  await t.test("un \"*\" littéral n'interfère pas avec une vraie emphase juste à côté", () => {
    const rtf = "{\\rtf1 \\i mot\\i0  * fin.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "*mot* \\* fin.");
  });

  await t.test("deux sauts de ligne consécutifs (Maj+Entrée x2 dans Scrivener) produisent la ligne blanche visible façon Feuillets", () => {
    // convention Feuillets (voir liveDoubleEnter, main.js) : une ligne
    // blanche VOULUE n'est pas juste "\n\n" (indiscernable d'un saut de
    // paragraphe normal, et donc effacée par un simple aplatissement des
    // sauts de ligne) — c'est une ligne à espace insécable encadrée de
    // deux sauts de paragraphe normaux.
    const rtf = "{\\rtf1 Para one.\\line\\line Para two.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Para one.\n \n\nPara two.");
  });

  await t.test("un seul saut de ligne reste un saut de paragraphe normal", () => {
    const rtf = "{\\rtf1 Para one.\\line Para two.}";
    const { text } = rtfToMarkdown(rtf);
    assert.equal(text, "Para one.\n\nPara two.");
  });
});

test("buildSceneFrontmatter", async (t) => {
  await t.test("titre_binder = nom de fichier, titre = ce qu'on lui passe explicitement (un heading, ou vide)", () => {
    const fm = buildSceneFrontmatter({
      titre: "",
      titreCourt: "05-le-vent-hurle",
      order: 5,
      isFiction: true,
      synopsis: "",
      statut: "",
      label: "",
      tags: [],
      includeInCompile: true,
      wordGoal: 700,
    });
    assert.match(fm, /^title: $/m);
    assert.match(fm, /^short_title: 05-le-vent-hurle$/m);
  });

  await t.test("titre peut porter un vrai titre extrait d'un heading", () => {
    const fm = buildSceneFrontmatter({
      titre: "Le vent hurle",
      titreCourt: "05-le-vent-hurle",
      order: 5,
      isFiction: true,
      synopsis: "",
      statut: "",
      label: "",
      tags: [],
      includeInCompile: true,
      wordGoal: 700,
    });
    assert.match(fm, /^title: Le vent hurle$/m);
  });

  await t.test("un titre purement numérique est mis entre guillemets — sinon YAML le lit comme un nombre et le titre disparaît de l'export Word", () => {
    // bug réel : compiledTitleFor (services/frontmatter.js) exige une
    // chaîne (`typeof t === "string"`) — un `titre: 4` sans guillemets est
    // parsé comme le NOMBRE 4 par Obsidian, pas la chaîne "4", et le
    // chapitre perdait silencieusement son titre à la compilation
    const fm = buildSceneFrontmatter({
      titre: "4",
      titreCourt: "04",
      order: 4,
      isFiction: true,
      synopsis: "",
      statut: "",
      label: "",
      tags: [],
      includeInCompile: true,
      wordGoal: 700,
    });
    assert.match(fm, /^title: "4"$/m);
  });
});

test("extractHeadingTitle", async (t) => {
  await t.test("extrait un H1", () => {
    assert.equal(extractHeadingTitle("# Le vent hurle\n\nSuite du texte."), "Le vent hurle");
  });

  await t.test("extrait un H2", () => {
    assert.equal(extractHeadingTitle("## Chapitre cinq\n\nSuite du texte."), "Chapitre cinq");
  });

  await t.test("ignore un H3 ou plus profond", () => {
    assert.equal(extractHeadingTitle("### Pas un titre de scène\n\nSuite."), "");
  });

  await t.test("vide si aucun heading", () => {
    assert.equal(extractHeadingTitle("Juste de la prose, sans titre."), "");
    assert.equal(extractHeadingTitle(""), "");
  });

  await t.test("prend le premier heading, pas un suivant", () => {
    assert.equal(extractHeadingTitle("Texte avant.\n\n# Premier\n\n# Second"), "Premier");
  });
});

test("extractChapterTitleMarker", async (t) => {
  await t.test("extrait un titre numérique (convention de titrage de ce roman)", () => {
    const { title, rest } = extractChapterTitleMarker(
      "<$Scr_Ps::0>4<!$Scr_Ps::0><$Scr_Ps::1>Kemal resta seul.<!$Scr_Ps::1>"
    );
    assert.equal(title, "4");
    assert.equal(rest, "<$Scr_Ps::1>Kemal resta seul.<!$Scr_Ps::1>");
  });

  await t.test("extrait un titre en texte libre", () => {
    const { title, rest } = extractChapterTitleMarker(
      "<$Scr_Ps::0>La maison abandonnée<!$Scr_Ps::0>Kemal resta seul."
    );
    assert.equal(title, "La maison abandonnée");
    assert.equal(rest, "Kemal resta seul.");
  });

  await t.test("aucun marqueur en tête : titre vide, texte inchangé", () => {
    const { title, rest } = extractChapterTitleMarker("Kemal resta seul.");
    assert.equal(title, "");
    assert.equal(rest, "Kemal resta seul.");
  });

  await t.test("gère le préfixe <$ScrKeepWithNext>", () => {
    const { title, rest } = extractChapterTitleMarker(
      "<$ScrKeepWithNext><$Scr_Ps::0>5<!$Scr_Ps::0>Suite."
    );
    assert.equal(title, "5");
    assert.equal(rest, "Suite.");
  });

  await t.test("ne se déclenche que sur l'occurrence de tête, pas sur une plus tardive", () => {
    const { title, rest } = extractChapterTitleMarker(
      "Prose d'abord. <$Scr_Ps::1>puis un style plus loin<!$Scr_Ps::1>"
    );
    assert.equal(title, "");
    assert.equal(rest, "Prose d'abord. <$Scr_Ps::1>puis un style plus loin<!$Scr_Ps::1>");
  });

  await t.test("le titre extrait est débarrassé des espaces superflus", () => {
    const { title } = extractChapterTitleMarker("<$Scr_Ps::0>  Chapitre cinq  <!$Scr_Ps::0>Suite.");
    assert.equal(title, "Chapitre cinq");
  });

  await t.test("un titre/sous-titre en gras ou italique perd ses \"*\" — jamais voulu dans le frontmatter YAML", () => {
    // cas réel : la page de titre du manuscrit porte "**BOZLAK**" (gras) —
    // un "*" force yamlScalar à mettre la valeur entre guillemets, et la
    // mise en forme ne s'affiche de toute façon pas dans un champ YAML
    const { title, sousTitre } = extractChapterTitleMarker(
      "<$Scr_Ps::0>**BOZLAK**\n\n*Roman*<!$Scr_Ps::0>Suite."
    );
    assert.equal(title, "BOZLAK");
    assert.equal(sousTitre, "Roman");
  });

  await t.test("un saut de paragraphe SANS contenu après (artefact de transition RTF) n'invalide pas un titre légitime", () => {
    // cas réel observé dans Bozlak.scriv : le span capturé pour un titre
    // numérique se termine par "4\n\n" (la RTF transitionne vers la mise
    // en forme du paragraphe suivant avant la fermeture du marqueur) —
    // rien de réel après ce saut, donc "4" reste un titre valide
    const { title, rest } = extractChapterTitleMarker(
      "<$ScrKeepWithNext><$Scr_Ps::0>4\n\n<!$Scr_Ps::0>\n\n<$Scr_Ps::1>Kemal resta seul.<!$Scr_Ps::1>"
    );
    assert.equal(title, "4");
    assert.equal(rest, "\n\n<$Scr_Ps::1>Kemal resta seul.<!$Scr_Ps::1>");
  });

  await t.test("un titre sur deux lignes (titre + sous-titre) : la seconde ligne devient sous_titre, pas rejetée", () => {
    // convention réelle : un chapitre Scrivener dont le titre tient sur
    // deux paragraphes courts (ex. "Titre principal" + "Sous-titre") —
    // compilé ensuite en H2/H3 (voir compile-export.js)
    const { title, sousTitre, rest } = extractChapterTitleMarker(
      "<$Scr_Ps::0>Titre principal\n\nSous-titre<!$Scr_Ps::0>Suite."
    );
    assert.equal(title, "Titre principal");
    assert.equal(sousTitre, "Sous-titre");
    assert.equal(rest, "Suite.");
  });

  await t.test("un document SANS style \"Titre chapitre\" dédié : l'index 0 tombe sur le corps de texte entier, rien n'est extrait", () => {
    // bug réel et sérieux, découvert après coup : quand aucun style dédié
    // n'est utilisé, l'index 0 de Scrivener tombe sur le style du CORPS
    // DE TEXTE ORDINAIRE, et sa portée peut courir jusqu'à la toute fin du
    // document — toute une scène de plusieurs milliers de caractères,
    // dans PLUSIEURS paragraphes, capturée comme "titre", le corps vidé.
    // Distinct du titre+sous-titre légitime (2 paragraphes courts,
    // ci-dessus) : ici, plus de 2 paragraphes trahit le cas bogué — mieux
    // vaut ne rien extraire que d'avaler toute la scène.
    const rtf =
      "<$Scr_Ps::0>Kemal resta seul devant la maison.\n\nEn guise d'héritage, il se trouvait devant une vieille maison.\n\nUne vague de colère froide le submergea.<!$Scr_Ps::0>";
    const { title, rest } = extractChapterTitleMarker(rtf);
    assert.equal(title, "");
    assert.equal(rest, rtf);
  });

  await t.test("un titre légitime mais anormalement long (> 200 caractères) est rejeté par prudence", () => {
    const longTitle = "Un titre bien trop long ".repeat(10);
    const rtf = `<$Scr_Ps::0>${longTitle}<!$Scr_Ps::0>Suite.`;
    const { title, rest } = extractChapterTitleMarker(rtf);
    assert.equal(title, "");
    assert.equal(rest, rtf);
  });
});

test("parseScrivenerComments", async (t) => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Comments>
    <Comment ID="ID-1" Author="Halim Yalcin" Footnote="Yes" Color="0.9 0.9 0.9"><![CDATA[{\\rtf1 Ceci est une note}]]></Comment>
    <Comment ID="ID-2" Author="Halim Yalcin" Footnote="No" Color="0.9 0.9 0.9"><![CDATA[{\\rtf1 Remarque interne}]]></Comment>
</Comments>`;

  await t.test("extrait les commentaires par ID avec leur statut Footnote", () => {
    const comments = parseScrivenerComments(XML);
    assert.equal(comments["ID-1"].isFootnote, true);
    assert.equal(comments["ID-1"].rtf, "{\\rtf1 Ceci est une note}");
    assert.equal(comments["ID-2"].isFootnote, false);
  });

  await t.test("XML vide ou absent renvoie une table vide, sans erreur", () => {
    assert.deepEqual(parseScrivenerComments(""), {});
    assert.deepEqual(parseScrivenerComments(null), {});
  });
});

test("rtfPathCandidates", async (t) => {
  await t.test("Scrivener 3 (Files/Data/<uuid>/content.rtf) en premier, repli 2.x ensuite", () => {
    assert.deepEqual(rtfPathCandidates("abc-123"), [
      "Files/Data/abc-123/content.rtf",
      "Files/Docs/abc-123.rtf",
    ]);
  });
});

test("parseScrImageLinks & {$SCRImageLink...}", async (t) => {
  await t.test("convertit {$SCRImageLink...} en Wikilien d'image ![[filename.jpg]]", () => {
    const rtf = "{\\rtf1 Texte avant {\\$SCRImageLink[w:1026;h:734]=\\$PROJECT://84645B6E-79E7-4927-9F04-4095F9E84C16.jpg} Texte après.}";
    const res = rtfToMarkdown(rtf);
    assert.ok(res.text.includes("![[84645B6E-79E7-4927-9F04-4095F9E84C16.jpg]]"));
    assert.equal(res.imageLinks[0].fileName, "84645B6E-79E7-4927-9F04-4095F9E84C16.jpg");
  });

  await t.test("nettoie les balises <$Scr_H::2> et extrait l'image $PROJECT://", () => {
    const rtf = "{\\rtf1 Texte avant <$Scr_H::2>\\$PROJECT://ma_photo.png<!$Scr_H::2> Texte après.}";
    const res = rtfToMarkdown(rtf);
    assert.ok(res.text.includes("![[ma_photo.png]]"));
    assert.ok(!res.text.includes("Scr_H"));
    assert.equal(res.imageLinks[0].fileName, "ma_photo.png");
  });

  await t.test("génère des noms d'images uniques par document avec options.uuid", () => {
    const rtf = "{\\rtf1 Image: {\\pict\\pngblip 0123456789012345678901234567890123456789}}";
    const res = rtfToMarkdown(rtf, {}, null, { uuid: "12345678-ABCD-EF00-1122-334455667788" });
    assert.ok(res.text.includes("![[img-12345678-1.png]]"));
    assert.equal(res.extractedImages[0].name, "img-12345678-1.png");
  });

  await t.test("convertit les champs RTF HYPERLINK web en liens Markdown [texte](url)", () => {
    const rtf = "{\\rtf1 Citation : {\\field{\\*\\fldinst{HYPERLINK \"https://books.google.com/books?id=MDoFR3UJOSgC\"}}{\\fldrslt Death and Exile}}.}";
    const res = rtfToMarkdown(rtf);
    assert.equal(res.text, "Citation : [Death and Exile](https://books.google.com/books?id=MDoFR3UJOSgC).");
  });

  await t.test("extrait les images RTF insérées par glisser/déposer dans le texte (groupe {\\*\\shppict{\\pict...}})", () => {
    const rtf = "{\\rtf1 Texte avec image : {\\*\\shppict{\\pict\\jpegblip 0123456789012345678901234567890123456789}}.}";
    const res = rtfToMarkdown(rtf, {}, null, { uuid: "F8685284-B62B-4358-A275-858C58B2C1C6" });
    assert.ok(res.text.includes("![[img-F8685284-1.jpg]]"));
    assert.equal(res.extractedImages[0].name, "img-F8685284-1.jpg");
  });

  await t.test("extrait les annotations RTF dans extractedComments pour le panneau notes", () => {
    const rtf = "{\\rtf1 Texte {\\Scrv_annot \\color={\\R=1.0\\G=0.0\\B=0.0} \\text=\\n keep skin\\n\\end_Scrv_annot} fin.}";
    const res = rtfToMarkdown(rtf);
    assert.equal(res.extractedComments[0].text, "[Annotation]: keep skin");
  });

  await t.test("extrait les commentaires sur un mot (non-footnote) dans extractedComments pour le panneau notes", () => {
    const rtf = "{\\rtf1 Les massacres et les {\\field{\\*\\fldinst{HYPERLINK \"scrivcmt://1FD571EA-A4AC-4D83-9715-EB4E893623C3\"}}{\\fldrslt expulsions}} continuent.}";
    const comments = {
      "1FD571EA-A4AC-4D83-9715-EB4E893623C3": { rtf: "{\\rtf1 Ceci est un commentaire}", isFootnote: false }
    };
    const res = rtfToMarkdown(rtf, comments);
    assert.equal(res.text, "Les massacres et les expulsions continuent.");
    assert.equal(res.extractedComments[0].word, "expulsions");
    assert.equal(res.extractedComments[0].text, "Ceci est un commentaire");
  });
});

// ============================ Lot S1 : plan d'import ========================
// Fiabilise la structure et les liens internes — voir docs du chantier.

test("sanitizeScrivenerTitle", async (t) => {
  await t.test("retire les caractères interdits par le système de fichiers", () => {
    assert.equal(sanitizeScrivenerTitle('Chapitre: "spécial"/test?'), "Chapitre spécialtest");
  });

  await t.test("titre vide ou uniquement fait de caractères interdits -> repli", () => {
    assert.equal(sanitizeScrivenerTitle(""), "Sans-titre");
    assert.equal(sanitizeScrivenerTitle("///"), "Sans-titre");
    assert.equal(sanitizeScrivenerTitle(null), "Sans-titre");
  });

  await t.test("espaces de tête/fin retirés, espaces internes conservés", () => {
    assert.equal(sanitizeScrivenerTitle("  Le vent hurle  "), "Le vent hurle");
  });
});

test("allocateImportPath", async (t) => {
  await t.test("un chemin encore libre est renvoyé tel quel", () => {
    const used = new Set();
    assert.equal(allocateImportPath(used, "A/B.md"), "A/B.md");
    assert.ok(used.has("A/B.md"));
  });

  await t.test("collision : suffixe -2, -3… avant l'extension", () => {
    const used = new Set(["A/B.md"]);
    assert.equal(allocateImportPath(used, "A/B.md"), "A/B-2.md");
    const used2 = new Set(["A/B.md", "A/B-2.md"]);
    assert.equal(allocateImportPath(used2, "A/B.md"), "A/B-3.md");
  });

  await t.test("un dossier (pas d'extension) est dédoublonné pareil, par simple suffixe", () => {
    const used = new Set(["A/Partie 1"]);
    assert.equal(allocateImportPath(used, "A/Partie 1"), "A/Partie 1-2");
  });

  await t.test("réserve le chemin choisi pour la prochaine résolution", () => {
    const used = new Set();
    allocateImportPath(used, "A/B.md");
    allocateImportPath(used, "A/B.md");
    assert.equal(allocateImportPath(used, "A/B.md"), "A/B-3.md");
  });
});

test("buildScrivenerImportPlan — structure", async (t) => {
  const MANUSCRIT = "Mon Roman/Manuscrit";

  await t.test("1. structure Draft simple : une scène à la racine", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="s1" Type="Text"><Title>Scène 1</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.targets.length, 1);
    assert.deepEqual(plan.targets[0], {
      uuid: "s1", sourceTitle: "Scène 1", kind: "manuscriptScene",
      markdownPath: `${MANUSCRIT}/Scène 1.md`,
    });
  });

  await t.test("2. dossiers imbriqués : Partie 1 > Chapitre 1 > Scène", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="p1" Type="Folder"><Title>Partie 1</Title>
            <Children>
              <BinderItem UUID="c1" Type="Folder"><Title>Chapitre 1</Title>
                <Children>
                  <BinderItem UUID="s1" Type="Text"><Title>Scène</Title></BinderItem>
                </Children>
              </BinderItem>
            </Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.p1.folderPath, `${MANUSCRIT}/Partie 1`);
    assert.equal(byUuid.p1.markdownPath, `${MANUSCRIT}/Partie 1/Partie 1.md`);
    assert.equal(byUuid.c1.folderPath, `${MANUSCRIT}/Partie 1/Chapitre 1`);
    assert.equal(byUuid.c1.markdownPath, `${MANUSCRIT}/Partie 1/Chapitre 1/Chapitre 1.md`);
    assert.equal(byUuid.s1.markdownPath, `${MANUSCRIT}/Partie 1/Chapitre 1/Scène.md`);
  });

  await t.test("3. Text avec enfants : dossier + fichier propre 00-<titre>.md", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="c1" Type="Text"><Title>Chapitre A</Title>
            <Children>
              <BinderItem UUID="s1" Type="Text"><Title>Scène A1</Title></BinderItem>
            </Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.c1.kind, "manuscriptContainer");
    assert.equal(byUuid.c1.folderPath, `${MANUSCRIT}/Chapitre A`);
    assert.equal(byUuid.c1.markdownPath, `${MANUSCRIT}/Chapitre A/00-Chapitre A.md`);
    assert.equal(byUuid.s1.markdownPath, `${MANUSCRIT}/Chapitre A/Scène A1.md`);
  });

  await t.test("4. Folder avec contenu propre : la note vit dans <Dossier>/<Dossier>.md", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="p1" Type="Folder"><Title>Partie 1</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.targets[0].kind, "manuscriptFolder");
    assert.equal(plan.targets[0].folderPath, `${MANUSCRIT}/Partie 1`);
    assert.equal(plan.targets[0].markdownPath, `${MANUSCRIT}/Partie 1/Partie 1.md`);
  });

  await t.test("5. titres avec caractères interdits par le système de fichiers", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="s1" Type="Text"><Title>Chapitre: "spécial"?</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.targets[0].markdownPath, `${MANUSCRIT}/Chapitre spécial.md`);
  });

  await t.test("6. deux fichiers de même titre dans le même dossier -> collision -2", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="s1" Type="Text"><Title>Scène</Title></BinderItem>
          <BinderItem UUID="s2" Type="Text"><Title>Scène</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.s1.markdownPath, `${MANUSCRIT}/Scène.md`);
    assert.equal(byUuid.s2.markdownPath, `${MANUSCRIT}/Scène-2.md`);
  });

  await t.test("7. mêmes titres dans deux dossiers différents -> pas de collision", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="p1" Type="Folder"><Title>Partie 1</Title>
            <Children><BinderItem UUID="s1" Type="Text"><Title>Scène</Title></BinderItem></Children>
          </BinderItem>
          <BinderItem UUID="p2" Type="Folder"><Title>Partie 2</Title>
            <Children><BinderItem UUID="s2" Type="Text"><Title>Scène</Title></BinderItem></Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.s1.markdownPath, `${MANUSCRIT}/Partie 1/Scène.md`);
    assert.equal(byUuid.s2.markdownPath, `${MANUSCRIT}/Partie 2/Scène.md`);
  });

  await t.test("8. UUID -> chemin final correct dans uuidToPath", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="p1" Type="Folder"><Title>Partie 1</Title>
            <Children><BinderItem UUID="s1" Type="Text"><Title>Scène</Title></BinderItem></Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.uuidToPath.get("s1"), `${MANUSCRIT}/Partie 1/Scène.md`);
    assert.equal(plan.uuidToPath.get("p1"), `${MANUSCRIT}/Partie 1/Partie 1.md`);
  });

  const COMPLEX_FIXTURE = `<ScrivenerProject><Binder>
    <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
      <Children>
        <BinderItem UUID="p1" Type="Folder"><Title>Partie</Title>
          <Children>
            <BinderItem UUID="s1" Type="Text"><Title>Scène</Title></BinderItem>
          </Children>
        </BinderItem>
        <BinderItem UUID="p2" Type="Folder"><Title>Partie</Title>
          <Children>
            <BinderItem UUID="s2" Type="Text"><Title>Scène</Title></BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="root-research" Type="ResearchFolder"><Title>Research</Title>
      <Children>
        <BinderItem UUID="chars" Type="Folder"><Title>Characters</Title>
          <Children><BinderItem UUID="alice" Type="Text"><Title>Alice</Title></BinderItem></Children>
        </BinderItem>
        <BinderItem UUID="misc1" Type="Text"><Title>Note diverse</Title></BinderItem>
      </Children>
    </BinderItem>
  </Binder></ScrivenerProject>`;

  await t.test("9. le plan est stable/déterministe (mêmes entrées -> même résultat)", () => {
    const parsed1 = parseScrivx(COMPLEX_FIXTURE);
    const parsed2 = parseScrivx(COMPLEX_FIXTURE);
    const opts = { manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé" };
    const plan1 = buildScrivenerImportPlan(parsed1, opts);
    const plan2 = buildScrivenerImportPlan(parsed2, opts);
    assert.deepEqual(plan1.targets, plan2.targets);
    assert.deepEqual([...plan1.uuidToPath.entries()], [...plan2.uuidToPath.entries()]);
  });

  await t.test("10. aucun chemin final dupliqué, même avec des collisions imbriquées + recherche", () => {
    const parsed = parseScrivx(COMPLEX_FIXTURE);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const allPaths = plan.targets.flatMap((tg) => [tg.markdownPath, tg.folderPath].filter(Boolean));
    assert.equal(new Set(allPaths).size, allPaths.length);
  });

  await t.test("Personnages/Lieux : la même rubrique classifiée est réutilisée, jamais dédoublonnée", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title></BinderItem>
      <BinderItem UUID="root-research" Type="ResearchFolder"><Title>Research</Title>
        <Children>
          <BinderItem UUID="chars" Type="Folder"><Title>Characters</Title>
            <Children><BinderItem UUID="alice" Type="Text"><Title>Alice</Title></BinderItem></Children>
          </BinderItem>
          <BinderItem UUID="sketches" Type="Folder"><Title>Character Sketches</Title>
            <Children><BinderItem UUID="bob" Type="Text"><Title>Bob</Title></BinderItem></Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.alice.markdownPath, "Mon Roman/_Recherche/Characters/Alice.md");
    assert.equal(byUuid.bob.markdownPath, "Mon Roman/_Recherche/Characters/Bob.md");
  });

  await t.test("recherche non classée : dossier de repli partagé entre plusieurs entrées", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title></BinderItem>
      <BinderItem UUID="root-research" Type="ResearchFolder"><Title>Research</Title>
        <Children>
          <BinderItem UUID="misc1" Type="Text"><Title>Note 1</Title></BinderItem>
          <BinderItem UUID="misc2" Type="Text"><Title>Note 2</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const byUuid = Object.fromEntries(plan.targets.map((tg) => [tg.uuid, tg]));
    assert.equal(byUuid.misc1.markdownPath, "Mon Roman/_Recherche/Non classé/Note 1.md");
    assert.equal(byUuid.misc2.markdownPath, "Mon Roman/_Recherche/Non classé/Note 2.md");
  });

  // Correctif S1 : uuidToPath ne doit jamais retomber sur un simple
  // folderPath — un dossier de recherche (sous-dossier imbriqué sous
  // Research) n'a jamais de note propre (voir §12, hors périmètre S1) et
  // ne doit donc produire AUCUNE entrée résoluble.
  await t.test("dossier de recherche imbriqué (kind researchFolder) : aucune entrée dans uuidToPath", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title></BinderItem>
      <BinderItem UUID="root-research" Type="ResearchFolder"><Title>Research</Title>
        <Children>
          <BinderItem UUID="sub-folder" Type="Folder"><Title>Sous-dossier</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const subFolderTarget = plan.targets.find((tg) => tg.uuid === "sub-folder");
    assert.equal(subFolderTarget.kind, "researchFolder");
    assert.ok(subFolderTarget.folderPath, "le dossier est bien planifié");
    assert.equal(subFolderTarget.markdownPath, undefined, "un dossier de recherche n'a jamais de note propre");
    assert.equal(plan.uuidToPath.has("sub-folder"), false);
  });

  await t.test("aucune valeur de uuidToPath ne pointe vers un simple folderPath (toutes sont des .md prévus)", () => {
    const parsed = parseScrivx(COMPLEX_FIXTURE);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: MANUSCRIT, researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const folderOnlyPaths = new Set(
      plan.targets.filter((tg) => !tg.markdownPath && tg.folderPath).map((tg) => tg.folderPath)
    );
    for (const path of plan.uuidToPath.values()) {
      assert.ok(path.endsWith(".md"), `${path} devrait être une note .md`);
      assert.ok(!folderOnlyPaths.has(path), `${path} ne doit jamais être un simple folderPath`);
    }
  });
});

test("rtfToMarkdown — liens internes scrivlink://UUID résolus via le plan d'import", async (t) => {
  // Le préfixe scrivlink:// n'accepte que des caractères hexadécimaux (comme
  // les vrais UUID Scrivener) — voir le regex dans rtfToMarkdown. On utilise
  // ici des UUID hexadécimaux factices mais lisibles plutôt que "s1"/"p1".
  const S1 = "00000000-0000-0000-0000-000000000001";
  const S2 = "00000000-0000-0000-0000-000000000002";
  const C1 = "00000000-0000-0000-0000-0000000000c1";
  const P1 = "00000000-0000-0000-0000-0000000000a1";
  const ALICE1 = "00000000-0000-0000-0000-00000000a001";
  const ALICE2 = "00000000-0000-0000-0000-00000000a002";
  const TRASHED = "00000000-0000-0000-0000-0000000dead0";

  const scrivLink = (uuid, visibleText) =>
    `{\\rtf1 Voir {\\field{\\*\\fldinst{HYPERLINK "scrivlink://${uuid}"}}{\\fldrslt ${visibleText}}} plus loin.}`;

  await t.test("11. lien UUID simple : résolu vers le chemin Markdown final planifié", () => {
    const map = new Map([[S1, "Mon Roman/Manuscrit/Partie 1/Scène.md"]]);
    const { text } = rtfToMarkdown(scrivLink(S1, "Scène"), {}, map);
    assert.equal(text, "Voir [[Mon Roman/Manuscrit/Partie 1/Scène|Scène]] plus loin.");
  });

  await t.test("12. lien UUID avec texte affiché différent du titre réel (alias préservé)", () => {
    const map = new Map([[S1, "Mon Roman/Manuscrit/Partie 1/Scène.md"]]);
    const { text } = rtfToMarkdown(scrivLink(S1, "le premier chapitre"), {}, map);
    assert.equal(text, "Voir [[Mon Roman/Manuscrit/Partie 1/Scène|le premier chapitre]] plus loin.");
  });

  await t.test("13. la cible a été sanitizée (caractère interdit retiré du titre d'origine)", () => {
    const map = new Map([[S1, "Mon Roman/Manuscrit/Chapitre spécial.md"]]);
    const { text } = rtfToMarkdown(scrivLink(S1, "Chapitre spécial"), {}, map);
    assert.ok(text.includes("[[Mon Roman/Manuscrit/Chapitre spécial|Chapitre spécial]]"));
    assert.ok(!text.includes(".md"), "l'extension .md ne doit pas apparaître dans un wikilien");
  });

  await t.test("14. la cible a subi une collision de titre (-2) : le lien pointe vers le bon suffixe", () => {
    const map = new Map([
      [S1, "Mon Roman/Manuscrit/Scène.md"],
      [S2, "Mon Roman/Manuscrit/Scène-2.md"],
    ]);
    const { text } = rtfToMarkdown(scrivLink(S2, "Scène"), {}, map);
    assert.ok(text.includes("[[Mon Roman/Manuscrit/Scène-2|Scène]]"));
    assert.ok(!text.includes("Scène-2.md"), "l'extension .md ne doit pas apparaître dans un wikilien");
  });

  await t.test("15. lien vers un Text avec enfants : pointe vers son fichier 00-…, pas vers son dossier", () => {
    const map = new Map([[C1, "Mon Roman/Manuscrit/Chapitre A/00-Chapitre A.md"]]);
    const { text } = rtfToMarkdown(scrivLink(C1, "Chapitre A"), {}, map);
    assert.ok(text.includes("[[Mon Roman/Manuscrit/Chapitre A/00-Chapitre A|Chapitre A]]"));
  });

  await t.test("16. lien vers un dossier ayant sa propre note : pointe vers <Dossier>/<Dossier>.md", () => {
    const map = new Map([[P1, "Mon Roman/Manuscrit/Partie 1/Partie 1.md"]]);
    const { text } = rtfToMarkdown(scrivLink(P1, "Partie 1"), {}, map);
    assert.ok(text.includes("[[Mon Roman/Manuscrit/Partie 1/Partie 1|Partie 1]]"));
  });

  // Correctif S1 : la map ne doit plus jamais retomber sur un simple
  // folderPath — un dossier sans note propre est un UUID non résolu.
  await t.test("correctif : lien vers un dossier manuscrit AVEC note -> wikilien vers la note planifiée", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="${P1}" Type="Folder"><Title>Partie 1</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: "Mon Roman/Manuscrit", researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.uuidToPath.get(P1), "Mon Roman/Manuscrit/Partie 1/Partie 1.md");
    const { text } = rtfToMarkdown(scrivLink(P1, "Partie 1"), {}, plan.uuidToPath);
    assert.ok(text.includes("[[Mon Roman/Manuscrit/Partie 1/Partie 1|Partie 1]]"));
  });

  await t.test("correctif : lien vers un dossier manuscrit SANS note -> texte simple, jamais [[dossier]], unresolved +1", () => {
    // simule le cas réel où le dossier n'a finalement aucune note propre
    // (contenu vide) : son UUID n'a donc aucune entrée résoluble dans la
    // map utilisée pour les liens.
    const mapSansNote = new Map();
    const res = rtfToMarkdown(scrivLink(P1, "Partie 1"), {}, mapSansNote);
    assert.equal(res.text, "Voir Partie 1 plus loin.");
    assert.ok(!res.text.includes("[["), "jamais de wikilien vers un dossier sans note");
    assert.equal(res.unresolvedLinkCount, 1);
  });

  await t.test("correctif : lien vers un dossier Research SANS note -> texte simple, unresolved +1", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title></BinderItem>
      <BinderItem UUID="root-research" Type="ResearchFolder"><Title>Research</Title>
        <Children>
          <BinderItem UUID="${P1}" Type="Folder"><Title>Sous-dossier</Title></BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: "Mon Roman/Manuscrit", researchRootPath: "Mon Roman/_Recherche", mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    assert.equal(plan.uuidToPath.has(P1), false, "un dossier de recherche sans note n'a aucune entrée résoluble");
    const res = rtfToMarkdown(scrivLink(P1, "Sous-dossier"), {}, plan.uuidToPath);
    assert.equal(res.text, "Voir Sous-dossier plus loin.");
    assert.ok(!res.text.includes("[["));
    assert.equal(res.unresolvedLinkCount, 1);
  });

  await t.test("17. deux documents du même titre : l'UUID choisit le bon, jamais le mauvais homonyme (CRITIQUE)", () => {
    const parsed = parseScrivx(`<ScrivenerProject><Binder>
      <BinderItem UUID="root" Type="DraftFolder"><Title>Draft</Title>
        <Children>
          <BinderItem UUID="p1" Type="Folder"><Title>Partie 1</Title>
            <Children><BinderItem UUID="${ALICE1}" Type="Text"><Title>Alice</Title></BinderItem></Children>
          </BinderItem>
          <BinderItem UUID="p2" Type="Folder"><Title>Partie 2</Title>
            <Children><BinderItem UUID="${ALICE2}" Type="Text"><Title>Alice</Title></BinderItem></Children>
          </BinderItem>
        </Children>
      </BinderItem>
    </Binder></ScrivenerProject>`);
    const plan = buildScrivenerImportPlan(parsed, {
      manuscritPath: "Mon Roman/Manuscrit", researchRootPath: null, mode: "fiction", unclassifiedFolderLabel: "Non classé",
    });
    const { text: text1 } = rtfToMarkdown(scrivLink(ALICE1, "Alice"), {}, plan.uuidToPath);
    const { text: text2 } = rtfToMarkdown(scrivLink(ALICE2, "Alice"), {}, plan.uuidToPath);
    assert.ok(text1.includes("[[Mon Roman/Manuscrit/Partie 1/Alice|Alice]]"));
    assert.ok(text2.includes("[[Mon Roman/Manuscrit/Partie 2/Alice|Alice]]"));
    assert.notEqual(text1, text2);
  });

  await t.test("18. UUID inconnu du plan (Corbeille, référence orpheline) : jamais un faux lien inventé", () => {
    const map = new Map([[S1, "Mon Roman/Manuscrit/Scène.md"]]);
    const res = rtfToMarkdown(scrivLink(TRASHED, "Passage supprimé"), {}, map);
    assert.equal(res.text, "Voir Passage supprimé plus loin.");
    assert.ok(!res.text.includes("[["), "aucun wikilien ne doit être inventé pour un UUID absent du plan");
    assert.equal(res.unresolvedLinkCount, 1);
  });

  await t.test("aucune carte de liens fournie (import hors contexte, comme avant) : texte affiché conservé", () => {
    const { text } = rtfToMarkdown(scrivLink(S1, "Scène"), {}, null);
    assert.equal(text, "Voir Scène plus loin.");
  });
});

