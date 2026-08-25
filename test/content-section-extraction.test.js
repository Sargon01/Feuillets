import assert from "node:assert/strict";
import test from "node:test";
import { extractSectionsByRoles } from "../src/services/content-section-extraction.js";

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
