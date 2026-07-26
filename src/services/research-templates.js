import { TFile, normalizePath } from "obsidian";
import { getProjectFolder, getResourcesRoot } from "./folder-structure.js";

export async function getResearchTemplate(app, settings, mode, sectionKey, defaultName) {
  const root = getProjectFolder(app, settings);
  if (root) {
    const resourcesRoot = getResourcesRoot(app, root);
    const resPath = resourcesRoot ? resourcesRoot.path : normalizePath(`${root.parent ? root.parent.path : root.path}/Resources`);

    const isFiction = mode.yamlPreset === "roman" || mode.yamlPreset === "nouvelle";

    /* Nom (anglais) du fichier modèle, avec repli sur l'ancien nom français
       si l'utilisateur a personnalisé ce fichier avant ce renommage — voir
       le même principe pour les champs frontmatter (LEGACY_FIELD_ALIASES). */
    const fileNames = {
      sources: ["Sources.md"],
      bibliographie: ["Bibliography.md", "Bibliographie.md"],
      personnages: isFiction ? ["Characters.md", "Personnages.md"] : ["Acteurs.md"],
      lieux: isFiction ? ["Places.md", "Lieux.md"] : ["Geographie.md"],
      codex: isFiction ? ["Lore.md"] : ["Concepts.md"],
      glossaire: ["Glossary.md", "Glossaire.md"],
      evenements: ["Events.md", "Evenements.md"],
    };

    const fileName = (fileNames[sectionKey] || []).find((name) =>
      app.vault.getAbstractFileByPath(normalizePath(`${resPath}/Templates/${name}`))
    );
    if (fileName) {
      const templatePath = normalizePath(`${resPath}/Templates/${fileName}`);
      const file = app.vault.getAbstractFileByPath(templatePath);
      if (file instanceof TFile) {
        try {
          let content = await app.vault.read(file);
          // Remplacement dynamique du titre générique si présent
          if (content.includes(`title: "Nouveau`) || content.includes("title: Nouvelle") || content.includes("title: Nouvel")) {
            content = content.replace(/title:\s*["']?Nouvel[le]?\s+\w+["']?/g, `title: "${defaultName}"`);
          }
          return content;
        } catch (err) {
          console.error("Feuillets: Failed to read user template:", err);
        }
      }
    }
  }

  // Templates par défaut (en secours)
  if (sectionKey === "sources") {
    return [
      "---",
      `title: "${defaultName}"`,
      "author: ",
      "date: ",
      "publisher: ",
      "pages: ",
      "url: ",
      "synopsis: ",
      "tags:",
      "  - source",
      "---",
      ""
    ].join("\n");
  }
  if (sectionKey === "bibliographie") {
    return [
      "---",
      `title: "${defaultName}"`,
      "author: ",
      "date: ",
      "publisher: ",
      "synopsis: ",
      "tags:",
      "  - bibliographie",
      "---",
      ""
    ].join("\n");
  }
  if (sectionKey === "personnages") {
    if (mode.yamlPreset === "roman" || mode.yamlPreset === "nouvelle") {
      return [
        "---",
        "last_name: ",
        "first_name: ",
        "birth: ",
        "death: ",
        "synopsis: ",
        "tags:",
        "  - personnage",
        "---",
        ""
      ].join("\n");
    } else {
      return [
        "---",
        "last_name: ",
        "first_name: ",
        "role: ",
        "synopsis: ",
        "tags:",
        "  - personnage",
        "---",
        ""
      ].join("\n");
    }
  }
  if (sectionKey === "lieux") {
    return [
      "---",
      `title: "${defaultName}"`,
      "description: ",
      "tags:",
      "  - lieu",
      "---",
      ""
    ].join("\n");
  }
  if (sectionKey === "codex") {
    return [
      "---",
      `title: "${defaultName}"`,
      "description: ",
      "tags:",
      "  - codex",
      "---",
      ""
    ].join("\n");
  }
  if (sectionKey === "glossaire") {
    return [
      "---",
      `title: "${defaultName}"`,
      "definition: ",
      "synopsis: ",
      "tags:",
      "  - glossaire",
      "---",
      ""
    ].join("\n");
  }
  if (sectionKey === "evenements") {
    return [
      "---",
      `title: "${defaultName}"`,
      "date: ",
      "end_date: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n");
  }
  return "";
}
