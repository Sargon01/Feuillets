import assert from "node:assert/strict";
import test from "node:test";
import { collectSemanticRoleBlocks, extractSectionsByRoles } from "../src/services/content-section-extraction.js";

const extract = (markdown, roles = ["questions"]) => extractSectionsByRoles(markdown, roles);

test("H3 contenant questions : extrait seulement la section H3", () => {
  const markdown = "# Parent\n\nTexte parent.\n\n## Partie\n\n### Questions\n\n> [!questions]\n> À traiter.\n\n### Autre\n\nFin.";
  assert.deepEqual(extract(markdown), [{ markdown: "### Questions\n\n> [!questions]\n> À traiter.\n\n", heading: "Questions", level: 3 }]);
});

test("deux activités H3 : deux sections dans l'ordre source", () => {
  const markdown = "## Activités\n\n### Première\n\n> [!questions]\n> A\n\n### Deuxième\n\n> [!questions]\n> B\n\n## Suite";
  assert.deepEqual(extract(markdown), [
    { markdown: "### Première\n\n> [!questions]\n> A\n\n", heading: "Première", level: 3 },
    { markdown: "### Deuxième\n\n> [!questions]\n> B\n\n", heading: "Deuxième", level: 3 },
  ]);
});

test("questions et source dans la même section : un seul extrait", () => {
  const markdown = "## Fiche\n\n> [!questions]\n> Question\n\n> [!source]\n> Référence\n\n## Fin";
  assert.deepEqual(extract(markdown, ["questions", "source"]), [{ markdown: "## Fiche\n\n> [!questions]\n> Question\n\n> [!source]\n> Référence\n\n", heading: "Fiche", level: 2 }]);
});

test("rôle avant le premier heading", () => {
  const markdown = "> [!questions]\n> Avant.\n\n# Premier\n\nTexte.";
  assert.deepEqual(extract(markdown), [{ markdown: "> [!questions]\n> Avant.\n\n", heading: null, level: null }]);
});

test("document sans heading", () => {
  const markdown = "Avant\n\n> [!questions]\n> Corps\n";
  assert.deepEqual(extract(markdown), [{ markdown, heading: null, level: null }]);
});

test("rôle dans fenced code ignoré", () => {
  const markdown = "```md\n# Faux\n> [!questions]\n> Faux\n```\n\n# Vrai\n\nTexte.";
  assert.deepEqual(extract(markdown), []);
});

test("[!questions] sans > ne déclenche rien", () => {
  assert.deepEqual(extract("# A\n\n[!questions]\nContenu"), []);
});

test("> [!questions]+ est reconnu", () => {
  assert.equal(extract("> [!questions]+\n> Contenu").length, 1);
});

test("> [!questions]- Titre est reconnu", () => {
  assert.equal(extract("> [!questions]- Titre\n> Contenu").length, 1);
});

test("> [!Questions] est reconnu sans changer le rôle déclencheur", () => {
  assert.equal(extract("> [!Questions]\n> Contenu").length, 1);
});

test("> ### Faux titre dans un blockquote n'est pas une frontière", () => {
  const markdown = "# Vrai\n\n> ### Faux titre\n\n> [!questions]\n> Contenu\n\n## Fin";
  assert.deepEqual(extract(markdown), [{ markdown, heading: "Vrai", level: 1 }]);
});

test("une pseudo-fermeture de fence contenant du texte ne sort pas du code", () => {
  const markdown = "```md\n``` texte\n> [!questions]\n```\n";
  assert.deepEqual(extract(markdown), []);
});

test("solution non demandée ne déclenche rien", () => {
  assert.deepEqual(extract("# A\n\n> [!solution]\n> Réponse"), []);
});

test("les callouts note, question, correction et lesson sont ignorés", () => {
  const markdown = ["> [!note]", "> [!question]", "> [!correction]", "> [!lesson]"].join("\n");
  assert.deepEqual(extract(markdown), []);
});

test("rôle invalide passé à l'API : erreur", () => {
  assert.throws(() => extract("", ["role-invalide"]), /Invalid semantic role/);
});

test("frontmatter absent du résultat et Markdown conservé à l'identique", () => {
  const markdown = "---\ntitle: Secret\n---\n## Fiche  ##\r\n\r\n> [!questions]\r\n> Texte  \r\n";
  const result = extract(markdown);
  assert.deepEqual(result, [{ markdown: "## Fiche  ##\r\n\r\n> [!questions]\r\n> Texte  \r\n", heading: "Fiche", level: 2 }]);
  assert.equal(markdown, "---\ntitle: Secret\n---\n## Fiche  ##\r\n\r\n> [!questions]\r\n> Texte  \r\n");
});

const collect = (markdown, roles = ["preuve"]) => collectSemanticRoleBlocks(markdown, roles);

test("définition seule : collecte le bloc exact", () => {
  const markdown = "> [!definition]\n> Un terme.\n";
  assert.deepEqual(collect(markdown, ["definition"]), [{ role: "definition", markdown: markdown.trimEnd(), headingPath: [] }]);
});

test("plusieurs preuves : conserve l'ordre source", () => {
  const markdown = "> [!preuve]\n> A\n\n> [!preuve]\n> B";
  assert.deepEqual(collect(markdown).map((item) => item.markdown), ["> [!preuve]\n> A", "> [!preuve]\n> B"]);
});

test("preuve et source sont toutes deux collectées", () => {
  const markdown = "> [!preuve]\n> A\n\n> [!source]\n> B";
  assert.deepEqual(collect(markdown, ["preuve", "source"]).map((item) => item.role), ["preuve", "source"]);
});

test("headingPath suit la hiérarchie H1/H2/H3", () => {
  const markdown = "# H1\n\n## H2\n\n### H3\n\n> [!preuve]\n> A";
  assert.deepEqual(collect(markdown)[0].headingPath, [
    { level: 1, markdown: "# H1" },
    { level: 2, markdown: "## H2" },
    { level: 3, markdown: "### H3" },
  ]);
});

test("un changement de H2 retire l'ancien H3", () => {
  const markdown = "# H1\n\n## H2\n\n### H3\n\n## Nouveau\n\n> [!preuve]\n> A";
  assert.deepEqual(collect(markdown)[0].headingPath, [{ level: 1, markdown: "# H1" }, { level: 2, markdown: "## Nouveau" }]);
});

test("heading et callout plus bas dans un blockquote ordinaire sont ignorés", () => {
  const markdown = "# H1\n\n> ### Faux\n> [!preuve]\n> A";
  assert.deepEqual(collect(markdown), []);
});

test("un callout plus bas dans une citation ordinaire est ignoré", () => {
  const markdown = "> Citation ordinaire.\n>\n> [!preuve]\n> Texte";
  assert.deepEqual(collect(markdown), []);
});

test("callout dans une fence ignoré", () => {
  assert.deepEqual(collect("```md\n> [!preuve]\n> Faux\n```"), []);
});

test("note, correction et lesson sont ignorés", () => {
  assert.deepEqual(collect("> [!note]\n> A\n\n> [!correction]\n> B\n\n> [!lesson]\n> C"), []);
});

test("casse et syntaxes [!role]+ / [!role]- reconnues", () => {
  const markdown = "> [!Preuve]+\n> A\n\n> [!PREUVE]- Titre\n> B";
  assert.equal(collect(markdown).length, 2);
});

test("seul l'enfant sélectionné est collecté", () => {
  const markdown = "> [!note]\n> Parent\n> > [!preuve]\n> > Enfant";
  assert.deepEqual(collect(markdown).map((item) => item.markdown), ["> [!preuve]\n> Enfant"]);
});

test("l'imbrication interne de l'enfant est conservée", () => {
  const markdown = "> [!note]\n> Parent\n> > [!preuve]\n> > Enfant\n> > > Citation interne";
  assert.deepEqual(collect(markdown).map((item) => item.markdown), ["> [!preuve]\n> Enfant\n> > Citation interne"]);
});

test("parent et enfant sélectionnés : seul le parent est collecté", () => {
  const markdown = "> [!preuve]\n> Parent\n> > [!source]\n> > Enfant";
  assert.deepEqual(collect(markdown, ["preuve", "source"]).map((item) => item.markdown), [markdown.trimEnd()]);
});

test("Markdown retourné strictement identique au source", () => {
  const markdown = "> [!preuve]+  Titre  \r\n> Texte  \r\n";
  assert.equal(collect(markdown)[0].markdown, markdown.slice(0, -1));
});

test("rôle invalide passé à l'API : erreur", () => {
  assert.throws(() => collect("", ["invalide"]), /Invalid semantic role/);
});
