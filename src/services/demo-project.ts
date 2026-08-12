import { Notice, normalizePath, TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot, getChronoFolder, researchFolderPath } from "./research.js";
import { ensureFolder, initProjectStructure } from "./project-files.js";
import { applyModeDefaults, researchFolderNames } from "../utils/project-modes.js";
import { getProjectMode } from "./project-mode.js";
import { CANDIDE_CHAPTER_BODIES, CANDIDE_FRONT_FILES, CANDIDE_RESEARCH } from "./candide-content.js";

const CANDIDE_VOLUME_NAME = "Candide, ou l'Optimisme — Exemple";

type DemoPlugin = {
  saveSettings(): Promise<void>;
  renderAllViews(force?: boolean): void | Promise<void>;
};

type CandideChapter = {
  ordre: number;
  titre: string;
  titreBinder: string;
  sousTitre: string;
  label: string;
  fil: string;
  personnages: string[];
};

type CandidePart = {
  nom: string;
  chapitres: CandideChapter[];
};

type FictionResearchFolders = {
  personnages: { label: string };
  lieux: { label: string };
  codex: { label: string };
  bibliographie: { label: string };
  glossaire: { label: string };
};

function isFictionResearchFolders(folders: object): folders is FictionResearchFolders {
  return ["personnages", "lieux", "codex", "bibliographie", "glossaire"].every(
    (key) => key in folders
  );
}

async function writeSheet(app: App, folder: TAbstractFile, name: string, lines: string[]): Promise<TFile> {
  const path = normalizePath(`${folder.path}/${name}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return app.vault.create(path, lines.join("\n"));
}

/** Résout le dossier physique d'une catégorie de Recherche (`key` : "personnages",
 * "lieux", "codex"…) sous son nom CANONIQUE (researchFolderNames — voir
 * project-modes.js), jamais sous `researchFolders[key].label` qui reste le
 * nom interne anglais ("Characters", "Places"…). Réutilise un dossier déjà
 * créé sous une variante reconnue (nom canonique en premier, posé par
 * initProjectStructure juste avant) plutôt que d'en créer un second, pour ne
 * jamais produire de doublon Personnages/Characters ou Lieux/Places. */
async function resolveResearchCategoryFolder(
  app: App,
  researchRoot: TAbstractFile,
  researchFolders: Record<string, { label: string }>,
  key: string
): Promise<TAbstractFile> {
  const names = researchFolderNames(researchFolders, key);
  for (const name of names) {
    const existing = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/${name}`));
    if (existing instanceof TFolder) return existing;
  }
  const targetName = names[0] || key;
  return ensureFolder(app, `${researchRoot.path}/${targetName}`);
}

const CANDIDE_PARTIES: CandidePart[] = [
  { nom: "Partie 1 - L'Ancien Monde", chapitres: [
    { ordre: 1, titre: "Éducation de Candide", titreBinder: "Éducation de Candide", sousTitre: "Comment Candide fut élevé dans un beau château, et comment il fut chassé d’icelui.", label: "Westphalie", fil: "L'Optimisme", personnages: ["Candide", "Pangloss", "Cunégonde", "M. le Baron", "Mme la Baronne"] },
    { ordre: 2, titre: "Enrôlement chez les Bulgares", titreBinder: "Enrôlement chez les Bulgares", sousTitre: "Ce que devint Candide parmi les Bulgares.", label: "Bulgarie", fil: "La Guerre", personnages: ["Candide", "Recruteurs bulgares"] },
    { ordre: 3, titre: "La boucherie héroïque", titreBinder: "La boucherie héroïque", sousTitre: "Comment Candide s’échappa d’entre les Bulgares, et ce qu’il devint.", label: "Hollande", fil: "La Guerre", personnages: ["Candide", "Jacques l'Anabaptiste", "Orateur protestant"] },
    { ordre: 4, titre: "Retrouvailles avec Pangloss", titreBinder: "Retrouvailles avec Pangloss", sousTitre: "Comment Candide rencontra son ancien maître de philosophie, le docteur Pangloss, et ce qui en advint.", label: "Hollande", fil: "L'Optimisme", personnages: ["Candide", "Pangloss", "Jacques l'Anabaptiste"] },
    { ordre: 5, titre: "Tempête et séisme", titreBinder: "Tempête et séisme", sousTitre: "Tempête, naufrage, tremblement de terre, et ce qui advint du docteur Pangloss, de Candide, et de l’anabaptiste Jacques.", label: "Lisbonne", fil: "Les Catastrophes", personnages: ["Candide", "Pangloss", "Jacques l'Anabaptiste", "Le Matelot brutal"] },
    { ordre: 6, titre: "L'Auto-da-fé de Lisbonne", titreBinder: "L'Auto-da-fé de Lisbonne", sousTitre: "Comment on fit un bel auto-da-fé pour empêcher les tremblements de terre, et comment Candide fut fessé.", label: "Lisbonne", fil: "L'Inquisition", personnages: ["Candide", "Pangloss", "Le Grand Inquisiteur"] },
    { ordre: 7, titre: "Soins de la vieille", titreBinder: "Soins de la vieille", sousTitre: "Comment une vieille prit soin de Candide, et comment il retrouva ce qu’il aimait.", label: "Lisbonne", fil: "La Quête de Cunégonde", personnages: ["Candide", "La Vieille", "Cunégonde"] },
    { ordre: 8, titre: "Récit de Cunégonde", titreBinder: "Récit de Cunégonde", sousTitre: "Histoire de Cunégonde.", label: "Lisbonne", fil: "La Quête de Cunégonde", personnages: ["Cunégonde", "Candide", "La Vieille", "Don Issachar", "Le Grand Inquisiteur"] },
    { ordre: 9, titre: "Fuite de Lisbonne", titreBinder: "Fuite de Lisbonne", sousTitre: "Ce qui advint de Cunégonde, de Candide, du grand Inquisiteur, et d’un Israélite.", label: "Lisbonne", fil: "La Quête de Cunégonde", personnages: ["Candide", "Cunégonde", "La Vieille", "Don Issachar", "Le Grand Inquisiteur"] },
    { ordre: 10, titre: "Départ pour le Nouveau Monde", titreBinder: "Départ pour le Nouveau Monde", sousTitre: "Dans quel dénuement Candide, Cunégonde et la vieille arrivent à Cadix, et de leur embarquement.", label: "Cadix", fil: "L'Exil", personnages: ["Candide", "Cunégonde", "La Vieille"] },
  ] },
  { nom: "Partie 2 - Le Nouveau Monde et l'Eldorado", chapitres: [
    { ordre: 11, titre: "Récit de la vieille I", titreBinder: "Récit de la vieille I", sousTitre: "Histoire de la vieille.", label: "En mer", fil: "La Misère humaine", personnages: ["La Vieille", "Fille du pape Urbain X", "Cunégonde", "Candide"] },
    { ordre: 12, titre: "Récit de la vieille II", titreBinder: "Récit de la vieille II", sousTitre: "Suite des malheurs de la vieille.", label: "En mer", fil: "La Misère humaine", personnages: ["La Vieille", "Eunuque noir", "Cunégonde", "Candide"] },
    { ordre: 13, titre: "Séparation à Buenos Aires", titreBinder: "Séparation à Buenos Aires", sousTitre: "Comment Candide fut obligé de se séparer de la belle Cunégonde et de la vieille.", label: "Buenos Aires", fil: "La Quête de Cunégonde", personnages: ["Candide", "Cunégonde", "La Vieille", "Don Fernando d'Ibaraa", "Cacambo"] },
    { ordre: 14, titre: "Chez les Jésuites du Paraguay", titreBinder: "Chez les Jésuites du Paraguay", sousTitre: "Comment Candide et Cacambo furent reçus chez les Jésuites du Paraguay.", label: "Paraguay", fil: "L'Inquisition", personnages: ["Candide", "Cacambo", "Le Commandant (Frère de Cunégonde)"] },
    { ordre: 15, titre: "Duel avec le frère", titreBinder: "Duel avec le frère", sousTitre: "Comment Candide tua le frère de sa chère Cunégonde.", label: "Paraguay", fil: "L'Orgueil aristocratique", personnages: ["Candide", "Le Commandant", "Cacambo"] },
    { ordre: 16, titre: "Chez les Oreillons", titreBinder: "Chez les Oreillons", sousTitre: "Ce qui advint aux deux voyageurs avec deux filles, deux singes, et les sauvages nommés Oreillons.", label: "Nouveau Monde", fil: "L'État de nature", personnages: ["Candide", "Cacambo", "Deux filles et deux singes", "Sauvages Oreillons"] },
    { ordre: 17, titre: "Arrivée en Eldorado", titreBinder: "Arrivée en Eldorado", sousTitre: "Arrivée de Candide et de son valet au pays d’Eldorado, et ce qu’ils y virent.", label: "Eldorado", fil: "L'Utopie", personnages: ["Candide", "Cacambo", "Enfants d'Eldorado", "Hôte du village"] },
    { ordre: 18, titre: "Sagesse de l'Eldorado", titreBinder: "Sagesse de l'Eldorado", sousTitre: "Ce qu’ils virent dans le pays d’Eldorado.", label: "Eldorado", fil: "L'Utopie", personnages: ["Candide", "Cacambo", "Le Sage Vieillard", "Le Roi d'Eldorado"] },
    { ordre: 19, titre: "L'esclave et Martin", titreBinder: "L'esclave et Martin", sousTitre: "Ce qui leur arriva à Surinam, et comment Candide fit connaissance avec Martin.", label: "Surinam", fil: "L'Esclavage", personnages: ["Candide", "Cacambo", "Le Nègre de Surinam", "Vanderdendur", "Martin"] },
    { ordre: 20, titre: "Traversée de l'Atlantique", titreBinder: "Traversée de l'Atlantique", sousTitre: "Ce qui arriva sur mer à Candide et à Martin.", label: "En mer", fil: "", personnages: ["Candide", "Martin"] },
  ] },
  { nom: "Partie 3 - Le retour et la métairie", chapitres: [
    { ordre: 21, titre: "Approche de la France", titreBinder: "Approche de la France", sousTitre: "Candide et Martin approchent des côtes de France et raisonnent.", label: "France", fil: "Le Pessimisme", personnages: ["Candide", "Martin"] },
    { ordre: 22, titre: "Les déboires à Paris", titreBinder: "Les déboires à Paris", sousTitre: "Ce qui arriva en France à Candide et à Martin.", label: "Paris", fil: "La Corruption", personnages: ["Candide", "Martin", "L'Abbé de Périgord", "Marquise de Parolignac", "Le Critique Fréron"] },
    { ordre: 23, titre: "Sur les côtes d'Angleterre", titreBinder: "Sur les côtes d'Angleterre", sousTitre: "Candide et Martin vont sur les côtes d’Angleterre ; ce qu’ils y voient.", label: "Angleterre", fil: "La Guerre", personnages: ["Candide", "Martin", "L'Amiral Byng"] },
    { ordre: 24, titre: "Paquette et Frère Giroflée", titreBinder: "Paquette et Frère Giroflée", sousTitre: "De Paquette et de frère Giroflée.", label: "Venise", fil: "La Misère humaine", personnages: ["Candide", "Martin", "Paquette", "Frère Giroflée"] },
    { ordre: 25, titre: "Chez le seigneur Pococurante", titreBinder: "Chez le seigneur Pococurante", sousTitre: "Visite chez le seigneur Pococurante, noble vénitien.", label: "Venise", fil: "L'Ennui", personnages: ["Candide", "Martin", "Seigneur Pococurante"] },
    { ordre: 26, titre: "Souper avec les six rois", titreBinder: "Souper avec les six rois", sousTitre: "D’un soupé que Candide et Martin firent avec six étrangers, et qui ils étaient.", label: "Venise", fil: "La Vanité du pouvoir", personnages: ["Candide", "Martin", "Cacambo", "Les Six Rois détrônés"] },
    { ordre: 27, titre: "Voyage vers Constantinople", titreBinder: "Voyage vers Constantinople", sousTitre: "Voyage de Candide à Constantinople.", label: "Constantinople", fil: "La Quête de Cunégonde", personnages: ["Candide", "Martin", "Cacambo", "Pangloss", "Le Baron Jésuite"] },
    { ordre: 28, titre: "Récit de Pangloss et du Baron", titreBinder: "Récit de Pangloss et du Baron", sousTitre: "Ce qui arriva à Candide, à Cunégonde, à Pangloss, à Martin, etc.", label: "Constantinople", fil: "L'Optimisme", personnages: ["Candide", "Pangloss", "Le Baron Jésuite"] },
    { ordre: 29, titre: "Retrouvailles avec Cunégonde", titreBinder: "Retrouvailles avec Cunégonde", sousTitre: "Comment Candide retrouva Cunégonde et la vieille.", label: "Constantinople", fil: "La Quête de Cunégonde", personnages: ["Candide", "Cunégonde", "La Vieille", "Pangloss", "Martin", "Cacambo", "Le Baron Jésuite"] },
    { ordre: 30, titre: "Il faut cultiver notre jardin", titreBinder: "Il faut cultiver notre jardin", sousTitre: "Conclusion.", label: "Métairie", fil: "", personnages: ["Candide", "Cunégonde", "Pangloss", "Martin", "Cacambo", "La Vieille", "Paquette", "Frère Giroflée", "Le Derviche", "Le Bon Vieillard", "La Corruption"] },
  ] },
];

function candideSceneLines({ ordre, titre, titreBinder, sousTitre, label, fil, personnages }: CandideChapter): string[] {
  const lines = [
    "---",
    `title: "Chapitre ${ordre} — ${titre}"`,
    `short_title: ${JSON.stringify(titreBinder)}`,
    `order: ${ordre}`,
    `subtitle: ${JSON.stringify(sousTitre)}`,
    `synopsis: ${JSON.stringify(sousTitre)}`,
    `label: ${JSON.stringify(label)}`,
  ];
  if (fil) lines.push(`thread: ${JSON.stringify(fil)}`);
  if (personnages.length > 0) {
    lines.push("characters:");
    for (const p of personnages) lines.push(`  - ${p}`);
  }
  lines.push("compile: true", "---", "");
  return lines;
}

async function generateCandide(app: App, S: FeuilletsSettings, plugin: DemoPlugin, manuscritPath: string): Promise<void> {
  S.projectFolder = manuscritPath;
  if (!S.projectMeta) S.projectMeta = {};
  S.projectMeta[manuscritPath] = {
    type: "fiction",
    author: "Voltaire",
    description:
      "Candide, ou l'Optimisme (1759) — domaine public — projet d'exemple pour explorer le panneau Chemin de fer (labels, fils, personnages) sur un vrai texte plutôt qu'un squelette minimal.",
  };
  applyModeDefaults(S, "fiction");
  await plugin.saveSettings();

  await initProjectStructure(app, S);

  const root = getProjectFolder(app, S);
  if (!root) {
    throw new Error(
      `Dossier projet introuvable juste après sa création (${manuscritPath}) — abandon de la génération.`
    );
  }
  const mode = getProjectMode(app, S);
  if (!mode) {
    throw new Error(
      "Mode de projet introuvable (getProjectMode a renvoyé undefined) — abandon de la génération."
    );
  }
  const researchFolders = mode.researchFolders;
  if (!isFictionResearchFolders(researchFolders)) {
    throw new Error("Dossiers de recherche Fiction introuvables.");
  }
  const rf = researchFolders;

  /* ---------- Front ---------- */

  const front = await ensureFolder(app, `${root.path}/Front`);
  for (const [name, content] of Object.entries(CANDIDE_FRONT_FILES)) {
    await writeSheet(app, front, name, [content]);
  }

  /* ---------- Manuscrit : texte réel des 30 chapitres ---------- */

  for (const partie of CANDIDE_PARTIES) {
    const partieFolder = await ensureFolder(app, `${root.path}/${partie.nom}`);
    for (const ch of partie.chapitres) {
      const lines = candideSceneLines(ch);
      const body = CANDIDE_CHAPTER_BODIES[ch.ordre] || ch.sousTitre;
      const name = `${String(ch.ordre).padStart(2, "0")}. Chapitre ${ch.ordre} — ${ch.titre}`;
      await writeSheet(app, partieFolder, name, [...lines, body, ""]);
    }
  }

  /* ---------- Recherche : fiches réelles (Personnages, Lieux, Lore, Chronologie) ---------- */

  const researchPath = researchFolderPath(app, S, root);
  if (!researchPath) throw new Error("Dossier Recherche introuvable.");
  const researchRoot = getResearchRoot(app, S) || (await ensureFolder(app, researchPath));

  const personnages = await resolveResearchCategoryFolder(app, researchRoot, rf, "personnages");
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Personnages)) {
    await writeSheet(app, personnages, name, [content]);
  }

  const lieux = await resolveResearchCategoryFolder(app, researchRoot, rf, "lieux");
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Lieux)) {
    await writeSheet(app, lieux, name, [content]);
  }

  const codex = await resolveResearchCategoryFolder(app, researchRoot, rf, "codex");
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Lore)) {
    await writeSheet(app, codex, name, [content]);
  }

  const chrono = getChronoFolder(app, S) || (await ensureFolder(app, `${researchRoot.path}/Chronologie`));
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Chronologie)) {
    await writeSheet(app, chrono, name, [content]);
  }

  /* ---------- Lisez-moi ---------- */

  await writeSheet(app, root.parent!, "Lisez-moi", [
    "---",
    "compile: false",
    "---",
    "",
    `# ${CANDIDE_VOLUME_NAME}`,
    "",
    "Candide, ou l'Optimisme (Voltaire, 1759, domaine public) importé comme projet d'exemple : texte intégral des 30 chapitres, déjà balisés en `label:` (lieu), `fil:` (intrigue) et `personnages:`, plus les fiches de Recherche (Personnages, Lieux, Lore, Chronologie) — pour explorer le plugin sur un vrai manuscrit plutôt qu'un squelette minimal.",
    "",
    "**Où écrire.** Le manuscrit est dans le **Binder** (barre latérale gauche) : chaque Partie contient ses chapitres, chaque chapitre son texte. Clique un chapitre pour l'ouvrir et écrire directement dedans. La **Recherche** (fiches Personnages, Lieux, Lore, Chronologie) est accessible depuis son propre panneau.",
    "",
    "**Ce qui est facultatif.** Comme sur tout projet Feuillets : les métadonnées YAML, les dossiers `Recherche`/`Ressources` et les snapshots enrichissent le Binder et la compilation, mais rien de tout cela n'est obligatoire — un simple dossier Markdown fonctionne aussi.",
    "",
    "**Aperçu, édition et export.** Le mode Lecture (panneau Cartes) donne un aperçu continu du texte ; « Compiler le manuscrit » assemble tous les chapitres dans l'ordre du binder, puis « Exporter » produit un .docx/.epub/.pdf depuis le panneau Projet & export.",
    "",
    "## Où regarder",
    "",
    "- **Panneau Cartes → mode Chemin de fer** — trois boutons en haut du panneau : **Label** (lieux, à gauche, en rond), **Personnage** (au centre), **Fil** (intrigues, à droite, en carré).",
    "- Choisis « La Quête de Cunégonde » dans le bouton Fil pour voir la ligne courir sur plusieurs chapitres non consécutifs.",
    "- Survole un rond ou un carré pour voir le nom du lieu ou du fil auquel il correspond.",
    "- Le chapitre 30 réunit presque tous les personnages du roman — bon point de départ pour le filtre Personnage.",
    "- **Recherche/** — fiches Personnages, Lieux, Lore et Chronologie déjà remplies.",
    "",
  ]);
}

/** Génère le projet d'exemple Feuillets — Candide, ou l'Optimisme (Voltaire,
 * 1759, domaine public), déjà rempli : 30 chapitres balisés label/fil/
 * personnages, Front et Recherche complets — pour explorer le plugin sur un
 * vrai manuscrit plutôt qu'une page blanche. Mode Fiction uniquement (le
 * plus riche des deux modes) ; une note dans "Lisez-moi.md" explique la
 * différence avec le mode Non-fiction sans dupliquer tout le contenu. */
export async function createDemoProject(
  app: App,
  settings: FeuilletsSettings,
  plugin: DemoPlugin
): Promise<void> {
  const S = settings;
  const volumeName = CANDIDE_VOLUME_NAME;
  const generator = generateCandide;
  const volumePath = normalizePath(volumeName);
  if (app.vault.getAbstractFileByPath(volumePath)) {
    new Notice(
      `« ${volumeName} » existe déjà — supprime-le manuellement pour le régénérer.`
    );
    return;
  }

  const manuscritPath = normalizePath(`${volumePath}/Manuscrit`);
  const previousProjectFolder = S.projectFolder;
  const hadProjectMeta = "projectMeta" in S && S.projectMeta !== undefined;
  const previousProjectMeta = S.projectMeta;
  const hadProjectMetaEntry = previousProjectMeta != null
    && typeof previousProjectMeta === "object"
    && manuscritPath in previousProjectMeta;
  const previousProjectMetaEntry = hadProjectMetaEntry && previousProjectMeta
    ? previousProjectMeta[manuscritPath]
    : undefined;
  /* applyModeDefaults() touche des réglages GLOBAUX au plugin (boardMode,
     numérotation, level1Role, mergeYamlPreset...), pas propres à un projet
     — générer le projet d'exemple ne doit jamais modifier discrètement ces
     réglages pour le vrai projet actif de l'utilisateur. Restaurés dans le
     `finally` ci-dessous, que la génération réussisse ou échoue. */
  const previousGlobals = {
    level1Role: S.level1Role,
    chapterNumbering: S.chapterNumbering,
    sceneNumbering: S.sceneNumbering,
    boardMode: S.boardMode,
    cardContent: S.cardContent,
    mergeYamlPreset: S.mergeYamlPreset,
  };

  let succeeded = false;

  try {
    await ensureFolder(app, volumePath);
    await ensureFolder(app, manuscritPath);
    await generator(app, S, plugin, manuscritPath);
    succeeded = true;
  } catch (err) {
    console.error("Feuillets: échec de la génération du projet d'exemple :", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    new Notice(
      `Échec de la génération du projet d'exemple : ${errMsg}. Ouvre la console (Ctrl/Cmd+Maj+I) pour le détail, supprime « ${volumeName} » avant de réessayer.`,
      12000
    );
  } finally {
    /* le projet d'exemple n'est jamais laissé actif automatiquement — même
       restauration inconditionnelle des réglages globaux et du projet actif
       que si rien ne s'était passé, qu'il y ait eu un projet actif avant ou
       non, et que la génération ait réussi ou échoué à mi-chemin. */
    S.projectFolder = previousProjectFolder;
    Object.assign(S, previousGlobals);
    if (succeeded) {
      if (!S.projects) S.projects = [];
      if (!S.projects.includes(manuscritPath)) S.projects.push(manuscritPath);
    } else if (!hadProjectMeta) {
      delete (S as Record<string, unknown>).projectMeta;
    } else if (previousProjectMeta == null || typeof previousProjectMeta !== "object") {
      (S as Record<string, unknown>).projectMeta = previousProjectMeta;
    } else if (hadProjectMetaEntry && previousProjectMetaEntry) {
      if (!S.projectMeta) (S as Record<string, unknown>).projectMeta = {};
      (S.projectMeta as Record<string, unknown>)[manuscritPath] = previousProjectMetaEntry;
    } else {
      if (S.projectMeta) delete (S.projectMeta as Record<string, unknown>)[manuscritPath];
    }
    await plugin.saveSettings();
    void plugin.renderAllViews(true);
  }

  if (succeeded) {
    new Notice(
      `Projet d'exemple créé : ${volumeName}. Active-le depuis « Gestion des projets » pour l'explorer.`
    );
  }
}
