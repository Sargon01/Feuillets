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
          if (content.includes(`titre: "Nouveau`) || content.includes("titre: Nouvelle") || content.includes("titre: Nouvel")) {
            content = content.replace(/titre:\s*["']?Nouvel[le]?\s+\w+["']?/g, `titre: "${defaultName}"`);
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
      `titre: "${defaultName}"`,
      "auteur: ",
      "date: ",
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
      `titre: "${defaultName}"`,
      "auteur: ",
      "annee: ",
      "edition: ",
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
        "nom: ",
        "prénom: ",
        "naissance: ",
        "mort: ",
        "synopsis: ",
        "tags:",
        "  - personnage",
        "---",
        ""
      ].join("\n");
    } else {
      return [
        "---",
        "nom: ",
        "prénom: ",
        "fonction: ",
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
      `titre: "${defaultName}"`,
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
      `titre: "${defaultName}"`,
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
      `titre: "${defaultName}"`,
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
      `titre: "${defaultName}"`,
      "date: ",
      "date_fin: ",
      "synopsis: ",
      "tags:",
      "  - evenement",
      "---",
      ""
    ].join("\n");
  }
  return "";
}
