import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath, FEUILLETS_RESOURCE_FOLDERS } from "./folder-structure.js";

export function getResearchTemplate(
  app: App,
  settings: FeuilletsSettings,
  sectionKey: string,
  defaultName: string,
): Promise<string>;
/** Compatibility overload for callers from the pre-G5 test/runtime surface. */
export function getResearchTemplate(
  app: App,
  settings: FeuilletsSettings,
  _legacyPreset: unknown,
  sectionKey: string,
  defaultName: string,
): Promise<string>;
export async function getResearchTemplate(
  app: App,
  settings: FeuilletsSettings,
  sectionKeyOrLegacy: unknown,
  defaultNameOrSectionKey: string,
  legacyDefaultName?: string,
): Promise<string> {
  const sectionKey = typeof sectionKeyOrLegacy === "string" ? sectionKeyOrLegacy : defaultNameOrSectionKey;
  const defaultName = typeof sectionKeyOrLegacy === "string" ? defaultNameOrSectionKey : legacyDefaultName || "";
  const root = getProjectFolder(app, settings);
  if (root) {
    const resPath = resourcesFolderPath(app, root);
    if (resPath) {
      const templatesPath = resourcesSubfolderPath(
        app,
        resPath,
        FEUILLETS_RESOURCE_FOLDERS.templates,
        "Templates",
        "Template"
      );

      /* Nom (anglais) du fichier modèle, avec repli sur l'ancien nom français
         si l'utilisateur a personnalisé ce fichier avant ce renommage — voir
         le même principe pour les champs frontmatter (LEGACY_FIELD_ALIASES). */
      const fileNames: Record<string, string[]> = {
        sources: ["Sources.md"],
        bibliographie: ["Bibliography.md", "Bibliographie.md"],
        personnages: ["Characters.md", "Personnages.md", "Acteurs.md"],
        lieux: ["Places.md", "Lieux.md", "Geographie.md"],
        codex: ["Lore.md", "Concepts.md"],
        glossaire: ["Glossary.md", "Glossaire.md"],
        evenements: ["Events.md", "Evenements.md"],
      };

      const candidates = fileNames[sectionKey] || [];
      for (const name of candidates) {
        const templatePath = normalizePath(`${templatesPath}/${name}`);
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
    return [
      "---",
      "last_name: ",
      "first_name: ",
      "birth: ",
      "death: ",
      "role: ",
      "synopsis: ",
      "tags:",
      "  - personnage",
      "---",
      ""
    ].join("\n");
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
