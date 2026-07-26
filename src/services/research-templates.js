const { TFile, normalizePath } = require("obsidian");
import { getProjectFolder } from "./folder-structure.js";

export async function getResearchTemplate(app, settings, mode, sectionKey, defaultName) {
  const root = getProjectFolder(app, settings);
  if (root) {
    const resPath = root.parent ? `${root.parent.path}/Ressources` : `${root.path}/Ressources`;

    const isFiction = mode.yamlPreset === "roman" || mode.yamlPreset === "nouvelle";

    const fileNames = {
      sources: "Sources.md",
      bibliographie: "Bibliographie.md",
      personnages: isFiction ? "Personnages.md" : "Acteurs.md",
      lieux: isFiction ? "Lieux.md" : "Geographie.md",
      codex: isFiction ? "Lore.md" : "Concepts.md",
      glossaire: "Glossaire.md",
      evenements: "Evenements.md",
    };

    const fileName = fileNames[sectionKey];
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
