const { Notice, normalizePath } = require("obsidian");
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot, getChronoFolder } from "./research.js";
import { ensureFolder, initProjectStructure } from "./project-files.js";
import { ensureDayEntry } from "./journal.js";
import { dateKey } from "../utils/journal-stats.js";
import { applyModeDefaults } from "../utils/project-modes.js";
import { getProjectMode } from "./project-mode.js";

const VOLUME_NAME = "Feuillets — Exemple";

async function writeSheet(app, folder, name, lines) {
  const path = normalizePath(`${folder.path}/${name}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) return existing;
  return app.vault.create(path, lines.join("\n"));
}

const sceneLines = ({ titre, titreCourt, ordre, synopsis, statut, label, tags, date, notes, compiler, body }) => [
  "---",
  `titre: ${titre}`,
  `titre_court: ${titreCourt || ""}`,
  `ordre: ${ordre}`,
  `synopsis: ${synopsis || ""}`,
  `statut: ${statut || ""}`,
  `label: ${label || ""}`,
  "objectif: 800",
  `tags: ${tags || ""}`,
  `date: ${date || ""}`,
  `notes: ${notes || ""}`,
  `compiler: ${compiler === false ? "false" : "true"}`,
  "---",
  "",
  body,
  "",
];

/** Fait tout le travail de génération — isolée dans sa propre fonction pour
 * que `createDemoProject` puisse l'entourer d'un try/catch/finally propre
 * (restauration garantie des réglages même en cas d'échec à mi-chemin). */
async function generate(app, S, plugin, manuscritPath) {
  S.projectFolder = manuscritPath;
  if (!S.projectMeta) S.projectMeta = {};
  S.projectMeta[manuscritPath] = {
    type: "fiction",
    author: "Auteur d'exemple",
    description:
      "Projet généré automatiquement pour explorer toutes les fonctionnalités de Feuillets.",
  };
  applyModeDefaults(S, "fiction");
  if (!S.wordGoal) S.wordGoal = 800;
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
  const rf = mode.researchFolders;

  /* ---------- Manuscrit ---------- */

  const front = await ensureFolder(app, `${root.path}/Front`);
  await writeSheet(app, front, "Dédicace", [
    "---",
    "titre: Dédicace",
    "compiler: true",
    "---",
    "",
    "Le dossier « Front » (ici, dossier parent de ce feuillet) n'apparaît jamais dans le mode Chemin de fer, la Chronologie ou le mode Lecture narratif — ce n'est pas du texte de roman, juste ce qui vient avant (dédicace, épigraphe, page de titre...). Il reste néanmoins un dossier normal du binder, que tu peux réorganiser comme les autres.",
    "",
  ]);

  const partie1 = await ensureFolder(app, `${root.path}/Partie 1 - Les commencements`);
  const chap1 = await ensureFolder(app, `${partie1.path}/Chapitre 1 - Le départ`);
  await writeSheet(app, chap1, "1. Ouverture", sceneLines({
    titre: "Ouverture",
    titreCourt: "Ouverture",
    ordre: 1,
    synopsis: "Elira découvre la lettre qui bouleversera son existence.",
    statut: "Terminé",
    label: "Rouge",
    tags: "exemple, demo/premier-niveau",
    notes: "Ce champ « Notes » n'est jamais compilé ni compté dans le nombre de mots — utilise-le pour tes pense-bêtes.",
    body: 'Ceci est un exemple de scène. Le champ `titre_court` ("Ouverture") est ce qui s\'affiche dans le binder et l\'onglet Obsidian, à la place du nom de fichier. Le `label: Rouge` te permet de suivre ce fil dans le panneau Cartes → mode Chemin de fer : choisis « Rouge » dans le sélecteur « Label / Fil » pour voir la ligne continue courir à travers les scènes qui le portent, même à travers des chapitres différents. Le tag `demo/premier-niveau` est un tag imbriqué — regarde le panneau Tags pour voir comment il apparaît dans l\'arborescence.',
  }));
  await writeSheet(app, chap1, "2. La rencontre", sceneLines({
    titre: "La rencontre",
    ordre: 2,
    synopsis: "Elira croise la route de Tomas Grey pour la première fois.",
    statut: "En cours",
    label: "Rouge, Bleu",
    date: "1421-03-12",
    body: "Cette scène porte deux labels à la fois (`label: Rouge, Bleu`) — une scène peut appartenir à plusieurs fils en même temps, chacun avec sa propre couleur et sa propre ligne dans le Chemin de fer. Elle porte aussi une `date: 1421-03-12`, qui correspond à un jalon de la Chronologie (« Fondation de la Citadelle », dans Recherche/Chronologie) : garde ce feuillet actif et regarde le panneau Notes, tu verras le rapprochement automatique avec ce jalon historique.",
  }));

  const chap2 = await ensureFolder(app, `${partie1.path}/Chapitre 2 - Le voyage`);
  await writeSheet(app, chap2, "1. La route", sceneLines({
    titre: "La route",
    ordre: 1,
    synopsis: "Le voyage vers la Citadelle Grise commence.",
    statut: "Brouillon",
    body: "Une scène tout à fait ordinaire, sans label ni fil particulier — pour montrer qu'aucun champ n'est obligatoire en dehors de la structure elle-même (dossier projet → parties → chapitres → scènes).",
  }));

  const partie2 = await ensureFolder(app, `${root.path}/Partie 2 - Les complications`);
  const chap3 = await ensureFolder(app, `${partie2.path}/Chapitre 3 - Le noeud`);
  const plantScene = await writeSheet(app, chap3, "1. La révélation", sceneLines({
    titre: "La révélation",
    ordre: 1,
    synopsis: "Tomas comprend enfin le secret de l'Ordre du Silence.",
    label: "Rouge",
    body: "Cette scène plante un fil narratif : juste après la génération de ce projet, `fil: secret-de-l-ordre` est ajouté ici, puis recopié automatiquement sur le tout dernier feuillet du manuscrit (la scène « Le silence », plus bas) comme marqueur « en attente de résolution ». Ouvre le mode Chemin de fer et choisis « secret-de-l-ordre » dans le sélecteur pour voir la ligne courir jusqu'au bout du manuscrit. Le jour où tu écris `fil: secret-de-l-ordre` ailleurs, ce marqueur disparaît tout seul du dernier feuillet — c'est la résolution.",
  }));
  await writeSheet(app, chap3, "2. Le silence", sceneLines({
    titre: "Le silence",
    ordre: 2,
    synopsis: "Le silence retombe — dernier feuillet du manuscrit.",
    compiler: false,
    body: "Ceci est le DERNIER feuillet du manuscrit dans l'ordre du projet — c'est lui qui reçoit automatiquement le marqueur du fil « secret-de-l-ordre » planté dans « La révélation ». Regarde son frontmatter après avoir ouvert ce projet : un champ `fil: secret-de-l-ordre` devrait y être apparu tout seul. Ce feuillet a aussi `compiler: false` : il n'apparaîtra jamais dans le manuscrit compilé (commande « Compiler le manuscrit »), contrairement aux autres scènes.",
  }));

  /* ---------- Recherche ---------- */

  const researchRoot = getResearchRoot(app, S) || (await ensureFolder(app, `${root.parent.path}/Recherche`));

  const personnages = await ensureFolder(app, `${researchRoot.path}/${rf.personnages.label}`);
  await writeSheet(app, personnages, "Elira Voskan", [
    "---",
    "nom: Voskan",
    "prénom: Elira",
    "naissance: 1398",
    "mort: ",
    "synopsis: Héroïne de ce projet d'exemple.",
    "tags:",
    "  - personnage",
    "---",
    "",
    'Fiche de personnage : les champs `nom`/`prénom`/`naissance`/`mort` sont libres, à adapter à tes besoins. Ouvre le bouton "Voir ses apparitions" en haut de cette fiche (dans le panneau Recherche) pour lister toutes les scènes qui la citent par tag ou par nom. Le tag `personnage` est un tag "structurel" — il reste invisible dans le filtre de tags du panneau Recherche et dans le panneau Tags, il sert seulement à ranger cette fiche dans le bon dossier.',
    "",
  ]);
  await writeSheet(app, personnages, "Tomas Grey", [
    "---",
    "nom: Grey",
    "prénom: Tomas",
    "naissance: 1395",
    "mort: ",
    "synopsis: Second personnage principal — voir « La rencontre » et « La révélation ».",
    "tags:",
    "  - personnage",
    "---",
    "",
  ]);

  const lieux = await ensureFolder(app, `${researchRoot.path}/${rf.lieux.label}`);
  await writeSheet(app, lieux, "La Citadelle Grise", [
    "---",
    'titre: "La Citadelle Grise"',
    "synopsis: Forteresse assiégée où se déroule l'essentiel de l'intrigue.",
    "tags:",
    "  - lieu",
    "---",
    "",
    "Fiche de lieu : même principe que les fiches personnage, avec `titre` à la place de `nom`/`prénom`.",
    "",
  ]);

  const codex = await ensureFolder(app, `${researchRoot.path}/${rf.codex.label}`);
  await writeSheet(app, codex, "L'Ordre du Silence", [
    "---",
    'titre: "L\'Ordre du Silence"',
    "description: Confrérie secrète au cœur de l'intrigue.",
    "tags:",
    "  - codex",
    "---",
    "",
    `En mode Fiction, ce dossier s'appelle « ${rf.codex.label} » — en mode Non-fiction, le même mécanisme (mêmes champs, même tag \`codex\`) s'appelle « Concepts ». Seul le nom affiché change selon le type de projet choisi à la création.`,
    "",
  ]);

  const biblio = await ensureFolder(app, `${researchRoot.path}/${rf.bibliographie.label}`);
  await writeSheet(app, biblio, "Sources d'inspiration", [
    "---",
    'titre: "Sources d\'inspiration"',
    "auteur: ",
    "annee: ",
    "edition: ",
    "synopsis: Disponible même en mode Fiction, pour noter tes sources d'inspiration ou de recherche documentaire.",
    "tags:",
    "  - bibliographie",
    "---",
    "",
  ]);

  const glossaire = await ensureFolder(app, `${researchRoot.path}/${rf.glossaire.label}`);
  await writeSheet(app, glossaire, "Vocable", [
    "---",
    'titre: "Vocable"',
    "definition: Terme inventé pour cet univers — exemple de fiche de glossaire.",
    "synopsis: ",
    "tags:",
    "  - glossaire",
    "---",
    "",
  ]);

  const chrono = getChronoFolder(app, S) || (await ensureFolder(app, `${researchRoot.path}/Chronologie`));
  await writeSheet(app, chrono, "Fondation de la Citadelle", [
    "---",
    'titre: "Fondation de la Citadelle"',
    "date: 1421-03-12",
    "date_fin: ",
    "synopsis: Jalon historique — sa date correspond à celle de la scène « La rencontre ».",
    "tags:",
    "  - evenement",
    "---",
    "",
  ]);
  await writeSheet(app, chrono, "La Grande Rupture", [
    "---",
    'titre: "La Grande Rupture"',
    "date: 1418-11-02",
    "date_fin: ",
    "synopsis: Second jalon d'exemple, sans scène qui y fasse référence pour l'instant.",
    "tags:",
    "  - evenement",
    "---",
    "",
  ]);

  /* ---------- Journal ---------- */

  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const todayFile = await ensureDayEntry(app, S, today);
  await app.vault.modify(
    todayFile,
    ["---", `date: ${dateKey(today)}`, "notes: ", "---", "", "Exemple d'entrée de journal — un feuillet par jour, jamais compilé avec le manuscrit. Le bouton « Compiler le carnet » (icône en haut du panneau Journal) rassemble toutes ces entrées dans un seul fichier « Journal d'écriture.md », régénéré à chaque fois.", ""].join("\n")
  );
  const yesterdayFile = await ensureDayEntry(app, S, yesterday);
  await app.vault.modify(
    yesterdayFile,
    ["---", `date: ${dateKey(yesterday)}`, "notes: ", "---", "", "Deuxième entrée d'exemple — ouvre le panneau Journal pour voir ces deux jours marqués d'un point dans le calendrier.", ""].join("\n")
  );

  /* ---------- Lisez-moi ---------- */

  await writeSheet(app, root.parent, "Lisez-moi", [
    "---",
    "compiler: false",
    "---",
    "",
    `# ${VOLUME_NAME}`,
    "",
    "Projet généré automatiquement pour explorer toutes les fonctionnalités de Feuillets — chaque feuillet explique, dans son propre texte, ce qu'il illustre. Active ce projet depuis « Gestion des projets » (commande ou bouton) pour l'explorer.",
    "",
    "## Où regarder",
    "",
    "- **Manuscrit/** — structure Partie → Chapitre → Scène. Ouvre « 1. Ouverture » pour le tour des champs de base (titre_court, label, tags imbriqués). « 2. La rencontre » montre le rapprochement automatique avec un jalon de la Chronologie via le champ `date`.",
    "- **Panneau Cartes → mode Chemin de fer** — sélecteur « Label / Fil » : choisis « Rouge » pour voir un même label courir sur plusieurs chapitres ; choisis « secret-de-l-ordre » pour voir l'automatisation des fils narratifs (plantation dans « La révélation », marqueur automatique sur le dernier feuillet « Le silence »).",
    "- **Front/** — ne s'affiche jamais dans les vues narratives (Chemin de fer, Chronologie, Lecture).",
    "- **Recherche/** — une fiche par type de dossier (Personnages, Lieux, Lore, Bibliographie, Glossaire, Chronologie/Événements).",
    "- **Journal/** — deux entrées de jours ; bouton « Compiler le carnet » en haut du panneau.",
    "- **Panneau Tags** — regarde le tag imbriqué `demo/premier-niveau` sur « 1. Ouverture ».",
    "- **Panneau Statistiques** — se remplit tout seul à partir du nombre de mots de chaque feuillet, rien à configurer.",
    "- **Snapshots/** — vide au départ : clique-droit sur un feuillet → « Snapshot » pour voir une copie datée apparaître ici.",
    "- **Ressources/Templates/** — gabarits YAML utilisés à la création d'une nouvelle fiche Recherche ; modifiables librement pour personnaliser les nouvelles fiches.",
    "- **Export / Compilation** — commande « Compiler le manuscrit » (fichier `.md` unique dans Sortie/), ou « Exporter en .docx/.epub » (nécessite Pandoc installé, bureau uniquement).",
    "",
    "## Fiction vs Non-fiction",
    "",
    "Ce projet est en mode **Fiction**. En mode **Non-fiction** (réglable par projet dans les réglages du plugin, section « Dossier du projet »), le fonctionnement est rigoureusement identique — seuls les noms des dossiers Recherche changent : Personnages → Acteurs, Lieux → Géographie, Lore → Concepts. Bibliographie, Glossaire et Chronologie/Événements gardent le même nom dans les deux modes.",
    "",
  ]);

  /* ---------- Fil narratif : déclenche l'automatisation réelle ---------- */

  /* Fait maintenant, une fois tout le manuscrit en place, pour que
     getLastProjectFile() (services/narrative-threads.js) résolve bien
     « Le silence » comme dernier feuillet — pas un chapitre encore
     inexistant. Le vrai gestionnaire est appelé directement (pas seulement
     via l'événement natif metadataCache "changed") pour que le marqueur
     soit posé de façon déterministe avant qu'on restaure S.projectFolder. */
  await app.fileManager.processFrontMatter(plantScene, (fm) => {
    fm.fil = "secret-de-l-ordre";
  });
  if (plugin.handleFilChanged) {
    await plugin.handleFilChanged(plantScene);
  }
}

/** Génère un projet Feuillets complet et déjà rempli, pour explorer toutes
 * les fonctionnalités du plugin sans partir d'une page blanche — le
 * contenu généré explique lui-même, dans son propre corps de texte, à quoi
 * sert chaque champ ou panneau qu'il illustre. Mode Fiction uniquement
 * (le plus riche des deux modes) ; une note dans "Lisez-moi.md" explique
 * la différence avec le mode Non-fiction sans dupliquer tout le contenu. */
export async function createDemoProject(app, settings, plugin) {
  const S = settings;
  const volumePath = normalizePath(VOLUME_NAME);
  if (app.vault.getAbstractFileByPath(volumePath)) {
    new Notice(
      `« ${VOLUME_NAME} » existe déjà — supprime-le manuellement pour le régénérer.`
    );
    return;
  }

  const previousProjectFolder = S.projectFolder;
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

  const manuscritPath = normalizePath(`${volumePath}/Manuscrit`);
  let succeeded = false;

  try {
    await ensureFolder(app, volumePath);
    await ensureFolder(app, manuscritPath);
    await generate(app, S, plugin, manuscritPath);
    succeeded = true;
  } catch (err) {
    console.error("Feuillets: échec de la génération du projet d'exemple :", err);
    new Notice(
      `Échec de la génération du projet d'exemple : ${err && err.message ? err.message : err}. Ouvre la console (Ctrl/Cmd+Maj+I) pour le détail, supprime « ${VOLUME_NAME} » avant de réessayer.`,
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
    }
    await plugin.saveSettings();
    plugin.renderAllViews(true);
  }

  if (succeeded) {
    new Notice(
      `Projet d'exemple créé : ${VOLUME_NAME}. Active-le depuis « Gestion des projets » pour l'explorer.`
    );
  }
}
