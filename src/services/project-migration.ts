/**
 * Services de migration et d'inventaire des structures de projet Feuillets.
 *
 * Principes et règles de la politique de migration définitive (Phase 1E) :
 * -------------------------------------------------------------------------
 * 1. Migration explicite : la migration d'un projet legacy vers la structure
 *    canonique sera toujours déclenchée à l'initiative de l'utilisateur
 *    (jamais de façon silencieuse ou automatique à l'ouverture).
 * 2. Non-écrasement : si la destination canonique existe déjà, aucun fichier
 *    ou dossier legacy ne doit venir l'écraser.
 * 3. Gestion des conflits : en cas de présence simultanée de la structure
 *    canonique et d'une variante legacy pour un même rôle, la situation est
 *    déclarée en conflit (conflicts non vide, canonical = false). Aucune
 *    fusion automatique n'est tentée.
 * 4. Préservation du contenu : aucun contenu utilisateur ne doit être supprimé.
 * 5. Respect de l'identité : Manuscrit et les dossiers adoptés ne sont jamais
 *    renommés ni convertis automatiquement.
 * 6. Exclusivité canonique post-migration : après migration réussie, seule la
 *    structure canonique sous _Feuillets/ sera utilisée par le runtime.
 */

import { normalizePath, type App } from "obsidian";
import {
  getManuscriptRoot,
  getProjectRoot,
  isStructuredManuscriptRoot,
  FEUILLETS_AUXILIARY_FOLDER_NAME,
  FEUILLETS_AUXILIARY_FOLDERS,
  FEUILLETS_RESOURCE_FOLDERS,
} from "./folder-structure.js";

export type LegacyConflict = {
  role: string;
  canonicalPath: string;
  legacyPath: string;
  reason: string;
};

export type LegacyDetectionResult = {
  canonical: boolean;
  legacyPaths: string[];
  conflicts: LegacyConflict[];
};

export type LegacyRoleSpec = {
  role: string;
  canonicalRelativePath: (isStructured: boolean) => string;
  legacyRelativePaths: (isStructured: boolean) => string[];
};

export const LEGACY_PROJECT_INVENTORY: LegacyRoleSpec[] = [
  // --- Dossiers auxiliaires principaux (canonique sous _Feuillets/) ---
  {
    role: "research",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}`,
    legacyRelativePaths: () => [
      "_Recherche",
      "_Research",
      "Recherche",
      "Research",
    ],
  },
  {
    role: "resources",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}`,
    legacyRelativePaths: () => [
      "_Ressources",
      "_Resources",
      "Ressources",
      "Resources",
    ],
  },
  {
    role: "edition",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.edition}`,
    legacyRelativePaths: () => [
      "_Edition",
      "Edition",
    ],
  },
  {
    role: "journal",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.journal}`,
    legacyRelativePaths: () => [
      "_Journal",
      "Journal",
    ],
  },
  {
    role: "snapshots",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.snapshots}`,
    legacyRelativePaths: () => [
      "_Snapshots",
      "Snapshots",
    ],
  },
  {
    role: "backups",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.backups}`,
    legacyRelativePaths: () => [
      "_Backups",
      "Backups",
    ],
  },
  {
    role: "versions",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.versions}`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/_Versions`,
      "_Versions",
      "Versions",
    ],
  },
  {
    role: "output",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.output}`,
    legacyRelativePaths: () => [
      "_Sortie",
      "Sortie",
    ],
  },

  // --- Sous-dossiers Ressources ---
  {
    role: "templates",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/${FEUILLETS_RESOURCE_FOLDERS.templates}`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Templates`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Template`,
      "Resources/Templates",
      "Resources/Template",
      "_Resources/Templates",
      "_Resources/Template",
      "Ressources/Templates",
      "Ressources/Template",
      "_Ressources/Templates",
      "_Ressources/Template",
    ],
  },
  {
    role: "layouts",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/${FEUILLETS_RESOURCE_FOLDERS.layouts}`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Layouts`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Layout`,
      "Resources/Layouts",
      "Resources/Layout",
      "_Resources/Layouts",
      "_Resources/Layout",
      "Ressources/Layouts",
      "Ressources/Layout",
      "_Ressources/Layouts",
      "_Ressources/Layout",
    ],
  },
  {
    role: "exports",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/${FEUILLETS_RESOURCE_FOLDERS.exports}`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Export`,
      "Resources/Export",
      "_Resources/Export",
      "Ressources/Export",
      "_Ressources/Export",
    ],
  },
  {
    role: "assets",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/${FEUILLETS_RESOURCE_FOLDERS.assets}`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Assets`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Visuels`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.resources}/Internal resources`,
      "Resources/Assets",
      "Resources/Visuels",
      "Resources/Internal resources",
      "_Resources/Assets",
      "_Resources/Visuels",
      "_Resources/Internal resources",
      "Ressources/Assets",
      "Ressources/Visuels",
      "Ressources/Internal resources",
      "_Ressources/Assets",
      "_Ressources/Visuels",
      "_Ressources/Internal resources",
    ],
  },

  // --- Sous-dossiers Recherche ---
  {
    role: "characters",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Personnages`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Characters`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/_Personnages`,
      "Research/Characters",
      "Research/_Personnages",
      "_Research/Characters",
      "_Research/_Personnages",
      "Recherche/Characters",
      "Recherche/_Personnages",
      "_Recherche/Characters",
      "_Recherche/_Personnages",
    ],
  },
  {
    role: "places",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Lieux`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Places`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Locations`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/_Lieux`,
      "Research/Places",
      "Research/Locations",
      "Research/_Lieux",
      "_Research/Places",
      "_Research/Locations",
      "_Research/_Lieux",
      "Recherche/Places",
      "Recherche/Locations",
      "Recherche/_Lieux",
      "_Recherche/Places",
      "_Recherche/Locations",
      "_Recherche/_Lieux",
    ],
  },
  {
    role: "events",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Événements`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Events`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Timeline`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Chronology`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Chronologie`,
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/_Chronologie`,
      "Research/Events",
      "Research/Timeline",
      "Research/Chronology",
      "Research/Chronologie",
      "Research/_Chronologie",
      "_Research/Events",
      "_Research/Timeline",
      "_Research/Chronology",
      "_Research/Chronologie",
      "_Research/_Chronologie",
      "Recherche/Events",
      "Recherche/Timeline",
      "Recherche/Chronology",
      "Recherche/Chronologie",
      "Recherche/_Chronologie",
      "_Recherche/Events",
      "_Recherche/Timeline",
      "_Recherche/Chronology",
      "_Recherche/Chronologie",
      "_Recherche/_Chronologie",
    ],
  },
  {
    role: "glossary",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Glossaire`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Glossary`,
      "Research/Glossary",
      "_Research/Glossary",
      "Recherche/Glossary",
      "_Recherche/Glossary",
    ],
  },
  {
    role: "bibliography",
    canonicalRelativePath: () => `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Bibliographie`,
    legacyRelativePaths: () => [
      `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${FEUILLETS_AUXILIARY_FOLDERS.research}/Bibliography`,
      "Research/Bibliography",
      "_Research/Bibliography",
      "Recherche/Bibliography",
      "_Recherche/Bibliography",
    ],
  },

  // --- Page de titre canonique ---
  {
    role: "titlePage",
    canonicalRelativePath: (isStructured) => isStructured ? "Manuscrit/Front/Page de titre.md" : "Front/Page de titre.md",
    legacyRelativePaths: (isStructured) => [
      isStructured ? "Manuscrit/Front/Title Page.md" : "Front/Title Page.md",
    ],
  },
];

/**
 * Détecteur pur/read-only de la structure de projet.
 * Analyse le coffre sans effectuer AUCUNE modification sur le disque.
 */
export function detectLegacyProjectStructure(
  app: App,
  settings: FeuilletsSettings
): LegacyDetectionResult {
  const manuscriptRoot = getManuscriptRoot(app, settings);
  const projectRoot = getProjectRoot(app, settings);

  if (!manuscriptRoot || !projectRoot) {
    return { canonical: true, legacyPaths: [], conflicts: [] };
  }

  const isStructured = isStructuredManuscriptRoot(manuscriptRoot);
  const legacyPathsSet = new Set<string>();
  const conflicts: LegacyConflict[] = [];

  for (const spec of LEGACY_PROJECT_INVENTORY) {
    const canonicalRel = spec.canonicalRelativePath(isStructured);
    const canonicalPath = normalizePath(`${projectRoot.path}/${canonicalRel}`);
    const canonicalEntry = app.vault.getAbstractFileByPath(canonicalPath);
    const canonicalExists = !!canonicalEntry;

    const legacyRels = spec.legacyRelativePaths(isStructured);
    const foundLegacyForRole: string[] = [];

    for (const legRel of legacyRels) {
      const legPath = normalizePath(`${projectRoot.path}/${legRel}`);
      if (legPath === canonicalPath) continue;
      const legEntry = app.vault.getAbstractFileByPath(legPath);
      if (legEntry) {
        foundLegacyForRole.push(legPath);
        legacyPathsSet.add(legPath);
      }
    }

    if (canonicalExists && foundLegacyForRole.length > 0) {
      for (const legPath of foundLegacyForRole) {
        conflicts.push({
          role: spec.role,
          canonicalPath,
          legacyPath: legPath,
          reason: `Conflit : l'emplacement canonique (${canonicalPath}) et un emplacement legacy (${legPath}) existent tous deux pour le rôle ${spec.role}.`,
        });
      }
    }
  }

  const legacyPaths = [...legacyPathsSet];
  const canonical = legacyPaths.length === 0 && conflicts.length === 0;

  return {
    canonical,
    legacyPaths,
    conflicts,
  };
}
