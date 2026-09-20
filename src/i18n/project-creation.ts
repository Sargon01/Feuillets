import { translate, type Locale } from "./index.js";

/**
 * Locale-aware catalogue of the names future project-creation lots will
 * need. Pure: no Obsidian import, no Vault access, no settings access, no
 * mutable global state — every value is resolved through `translate(locale,
 * key)`, an explicit-locale lookup that never reads the active global
 * locale. This file is a catalogue only: it is not connected to
 * folder-structure.ts, project-files.ts, research.ts, defaults, or any
 * creation path in this batch.
 */
export type ProjectCreationNames = {
  /** Top-level project folders. */
  manuscript: string;
  frontMatter: string;
  research: string;
  resources: string;
  /** The plugin's own auxiliary root folder (e.g. "_Feuillets"). */
  feuilletsRoot: string;
  /** Folders created under the auxiliary root. */
  auxiliary: {
    research: string;
    resources: string;
    edition: string;
    journal: string;
    snapshots: string;
    backups: string;
    output: string;
    versions: string;
    drafts: string;
  };
  /** Subfolders created under the resources folder. */
  resourceSubfolders: {
    images: string;
    templates: string;
    layouts: string;
    exports: string;
    assets: string;
  };
  /** Standard Research sections. */
  researchSections: {
    bibliography: string;
    glossary: string;
    events: string;
    characters: string;
    places: string;
    lore: string;
    notes: string;
    sources: string;
  };
  /** Notebook folder name. */
  notebook: string;
  /** Basename stem for a new, untitled draft. */
  draftStem: string;
};

/** Returns the full set of project-creation names for `locale`, resolved
 * through the locale-explicit translation helper — never a hardcoded
 * French or English string. */
export function projectCreationNames(locale: Locale): ProjectCreationNames {
  return {
    manuscript: translate(locale, "projectCreation.manuscript"),
    frontMatter: translate(locale, "projectCreation.frontMatter"),
    research: translate(locale, "projectCreation.research"),
    resources: translate(locale, "projectCreation.resources"),
    feuilletsRoot: translate(locale, "projectCreation.feuilletsRoot"),
    auxiliary: {
      research: translate(locale, "projectCreation.auxiliaryResearch"),
      resources: translate(locale, "projectCreation.auxiliaryResources"),
      edition: translate(locale, "projectCreation.auxiliaryEdition"),
      journal: translate(locale, "projectCreation.auxiliaryJournal"),
      snapshots: translate(locale, "projectCreation.auxiliarySnapshots"),
      backups: translate(locale, "projectCreation.auxiliaryBackups"),
      output: translate(locale, "projectCreation.auxiliaryOutput"),
      versions: translate(locale, "projectCreation.auxiliaryVersions"),
      drafts: translate(locale, "projectCreation.auxiliaryDrafts"),
    },
    resourceSubfolders: {
      images: translate(locale, "projectCreation.resourceImages"),
      templates: translate(locale, "projectCreation.resourceTemplates"),
      layouts: translate(locale, "projectCreation.resourceLayouts"),
      exports: translate(locale, "projectCreation.resourceExports"),
      assets: translate(locale, "projectCreation.resourceAssets"),
    },
    researchSections: {
      bibliography: translate(locale, "projectCreation.sectionBibliography"),
      glossary: translate(locale, "projectCreation.sectionGlossary"),
      events: translate(locale, "projectCreation.sectionEvents"),
      characters: translate(locale, "projectCreation.sectionCharacters"),
      places: translate(locale, "projectCreation.sectionPlaces"),
      lore: translate(locale, "projectCreation.sectionLore"),
      notes: translate(locale, "projectCreation.sectionNotes"),
      sources: translate(locale, "projectCreation.sectionSources"),
    },
    notebook: translate(locale, "projectCreation.notebook"),
    draftStem: translate(locale, "projectCreation.draftStem"),
  };
}
