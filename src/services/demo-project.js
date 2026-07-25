const { Notice, normalizePath } = require("obsidian");
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot, getChronoFolder } from "./research.js";
import { ensureFolder, initProjectStructure } from "./project-files.js";
import { ensureDayEntry } from "./journal.js";
import { dateKey } from "../utils/journal-stats.js";
import { applyModeDefaults } from "../utils/project-modes.js";
import { getProjectMode } from "./project-mode.js";
import { CANDIDE_CHAPTER_BODIES, CANDIDE_FRONT_FILES, CANDIDE_RESEARCH } from "./candide-content.js";

const VOLUME_NAME = "Feuillets — Exemple";
const CANDIDE_VOLUME_NAME = "Candide, ou l'Optimisme — Exemple";

async function writeSheet(app, folder, name, lines) {
  const path = normalizePath(`${folder.path}/${name}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) return existing;
  return app.vault.create(path, lines.join("\n"));
}

const sceneLines = ({ titre, titreCourt, ordre, synopsis, statut, label, fil, personnages, rythme, tags, date, notes, compiler, body }) => {
  const lines = [
    "---",
    `titre: ${titre}`,
    `titre_binder: ${titreCourt || ""}`,
    `ordre: ${ordre}`,
    `synopsis: ${synopsis || ""}`,
    `statut: ${statut || ""}`,
    `label: ${label || ""}`,
  ];
  if (fil) lines.push(`fil: ${fil}`);
  if (personnages && personnages.length > 0) {
    lines.push("personnages:");
    for (const p of personnages) lines.push(`  - ${p}`);
  }
  if (rythme) {
    lines.push("rythme:");
    for (const dim of ["action", "dialogue", "description", "introspection"]) {
      lines.push(`  ${dim}: ${rythme[dim] ?? 0}`);
    }
  }
  lines.push(
    "objectif: 800",
    `tags: ${tags || ""}`,
    `date: ${date || ""}`,
    `notes: ${notes || ""}`,
    `compiler: ${compiler === false ? "false" : "true"}`,
    "---",
    "",
    body,
    ""
  );
  return lines;
};

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
    fil: "Éveil",
    personnages: ["Elira Voskan"],
    rythme: { action: 1, dialogue: 0, description: 3, introspection: 4 },
    tags: "exemple, demo/premier-niveau",
    notes: "Ce champ « Notes » n'est jamais compilé ni compté dans le nombre de mots — utilise-le pour tes pense-bêtes.",
    body: 'Ceci est un exemple de scène. Le champ `titre_binder` ("Ouverture") est ce qui s\'affiche dans le binder et l\'onglet Obsidian, à la place du nom de fichier. Ouvre le panneau Cartes → mode Chemin de fer : trois boutons en haut — **Label** (`label: Rouge`, à gauche, en rond), **Personnage** (`personnages: Elira Voskan`, au centre) et **Fil** (`fil: Éveil`, à droite, en carré) — choisis-en un pour voir la ligne continue courir à travers les scènes qui le portent, même à travers des chapitres différents. Survole un point pour voir son nom. Le tag `demo/premier-niveau` est un tag imbriqué — regarde le panneau Tags pour voir comment il apparaît dans l\'arborescence.\n\nCette phrase porte une note de bas de page[^1] et une citation insérée depuis la fiche « Sources d\'inspiration » du panneau Recherche (sélectionne un passage dans une fiche Bibliographie, puis clique « Insérer comme citation »).\n\n> « Rien ne se perd, rien ne se crée, tout se transforme. » (Sources d\'inspiration)\n\n[^1]: Exemple de note de bas de page — commande « Insérer une note de bas de page », ou « Renuméroter les notes de bas de page » si l\'ordre change.',
  }));
  await writeSheet(app, chap1, "2. La rencontre", sceneLines({
    titre: "La rencontre",
    ordre: 2,
    synopsis: "Elira croise la route de Tomas Grey pour la première fois.",
    statut: "En cours",
    label: "Rouge, Bleu",
    fil: "Éveil",
    personnages: ["Elira Voskan", "Tomas Grey"],
    rythme: { action: 2, dialogue: 4, description: 1, introspection: 1 },
    date: "1421-03-12",
    body: "Cette scène porte deux labels à la fois (`label: Rouge, Bleu`) — une scène peut appartenir à plusieurs fils en même temps, chacun avec sa propre couleur et sa propre ligne dans le Chemin de fer. Elle porte aussi une `date: 1421-03-12`, qui correspond à un jalon de la Chronologie (« Fondation de la Citadelle », dans Recherche/Chronologie) : garde ce feuillet actif et regarde le panneau Notes, tu verras le rapprochement automatique avec ce jalon historique. Elle cite aussi Elira et Tomas par leur nom — ouvre le panneau Notes et regarde la section « Contexte » : leurs fiches Recherche y apparaissent automatiquement, avec leur âge à la date de la scène.",
  }));

  const chap2 = await ensureFolder(app, `${partie1.path}/Chapitre 2 - Le voyage`);
  await writeSheet(app, chap2, "1. La route", sceneLines({
    titre: "La route",
    ordre: 1,
    synopsis: "Le voyage vers la Citadelle Grise commence.",
    statut: "Brouillon",
    body: "Une scène tout à fait ordinaire, sans label ni fil particulier — pour montrer qu'aucun champ n'est obligatoire en dehors de la structure elle-même (dossier projet → parties → chapitres → scènes).\n\nEssaie ici le mode concentration (icône focus dans le binder ou le ruban) : plein écran d'écriture, texte hors focus estompé, compteur de mots flottant, Échap pour sortir. Ou ouvre la barre « Chercher et remplacer dans le manuscrit… » (commande dédiée, distincte de la recherche native d'Obsidian) pour chercher un mot dans tout le projet.",
  }));

  /* Scène volontairement imparfaite : fautes réelles pour Grammalecte,
     répétitions/verbes passe-partout/voix passive pour le panneau Analyse,
     et un champ `rythme` par dimension pour la courbe narrative. Les deux
     outils sont distincts (correction grammaticale vs style), d'où les
     deux types de défauts assemblés dans le même texte. */
  await writeSheet(app, chap2, "2. Brouillon à corriger", [
    "---",
    "titre: Brouillon à corriger",
    "titre_binder: Brouillon à corriger",
    "ordre: 2",
    "synopsis: Scène délibérément imparfaite, pour tester la correction grammaticale et le panneau Analyse.",
    "statut: Brouillon",
    "objectif: 800",
    "rythme:",
    "  action: 4",
    "  dialogue: 1",
    "  description: 4",
    "  introspection: 1",
    "compiler: true",
    "---",
    "",
    "Les chevals étaient fatigués. Elira était fatiguée aussi. Elle était inquiète, elle était certaine que quelque chose était différent depuis la lettre — elle était sûre de l'avoir déjà lu quelque part, cette phrase, cette même phrase, cette phrase qui revenait sans cesse.",
    "",
    "La décision fut prise par Elira. La route fut prise sans un mot. Le silence fut à peine rompu par le vent.",
    "",
    "Cette scène contient volontairement : une faute d'accord (« Les chevals », « lu » au lieu de « lue ») pour la **correction grammaticale** (commande « vérifier le feuillet actif », panneau latéral Feuillets ouvert au préalable) ; une répétition serrée (« cette phrase » × 3) et un abus du verbe passe-partout « être » pour le **panneau Analyse** (icône dédiée, à côté de Notes/Recherche/Propriétés) ; trois phrases à la voix passive (« fut prise », « fut prise », « fut rompu ») que ce même panneau signale aussi. Le champ `rythme:` (action/dialogue/description/introspection, 0 à 5) alimente sa courbe narrative — répète-le sur d'autres scènes pour voir la courbe se dessiner sur tout le manuscrit.",
    "",
  ]);

  const partie2 = await ensureFolder(app, `${root.path}/Partie 2 - Les complications`);
  const chap3 = await ensureFolder(app, `${partie2.path}/Chapitre 3 - Le noeud`);
  const plantScene = await writeSheet(app, chap3, "1. La révélation", sceneLines({
    titre: "La révélation",
    ordre: 1,
    synopsis: "Tomas comprend enfin le secret de l'Ordre du Silence.",
    label: "Rouge",
    personnages: ["Tomas Grey"],
    body: "Cette scène plante un fil narratif : juste après la génération de ce projet, `fil: secret-de-l-ordre` est ajouté ici, puis recopié automatiquement sur le tout dernier feuillet du manuscrit (la scène « Le silence », plus bas) comme marqueur « en attente de résolution ». Ouvre le mode Chemin de fer, bouton **Fil**, et choisis « secret-de-l-ordre » pour voir la ligne courir jusqu'au bout du manuscrit. Le jour où tu écris `fil: secret-de-l-ordre` ailleurs, ce marqueur disparaît tout seul du dernier feuillet — c'est la résolution.",
  }));
  await writeSheet(app, chap3, "2. Le silence", sceneLines({
    titre: "Le silence",
    ordre: 2,
    synopsis: "Le silence retombe — dernier feuillet du manuscrit.",
    compiler: false,
    body: "Ceci est le DERNIER feuillet du manuscrit dans l'ordre du projet — c'est lui qui reçoit automatiquement le marqueur du fil « secret-de-l-ordre » planté dans « La révélation ». Regarde son frontmatter après avoir ouvert ce projet : un champ `fil: secret-de-l-ordre` devrait y être apparu tout seul. Ce feuillet a aussi `compiler: false` : il n'apparaîtra jamais dans le manuscrit compilé (commande « Compiler le manuscrit »), contrairement aux autres scènes.\n\nEssaie aussi de fusionner « La révélation » et « Le silence » en les sélectionnant toutes les deux (mode sélection multiple du Tableau) puis « Fusionner » : un preset (Roman/Nouvelle/Scénario/Minimal) décide champ par champ s'il garde, additionne ou ignore chaque propriété. « Scinder » une scène (depuis le curseur ou une sélection de texte) fait l'inverse.",
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
    `Ce dossier n'existe qu'en mode Fiction — en Non-fiction, les rubriques comme celle-ci se créent à la demande via le bouton "Nouvelle rubrique" du panneau Recherche, plutôt que d'être imposées d'avance.`,
    "",
  ]);

  const biblio = await ensureFolder(app, `${researchRoot.path}/${rf.bibliographie.label}`);
  await writeSheet(app, biblio, "Sources d'inspiration", [
    "---",
    'titre: "Sources d\'inspiration"',
    "auteur: Lavoisier",
    "annee: 1789",
    "edition: Traité élémentaire de chimie",
    "synopsis: Disponible même en mode Fiction, pour noter tes sources d'inspiration ou de recherche documentaire.",
    "tags:",
    "  - bibliographie",
    "---",
    "",
    "Sélectionne la citation ci-dessous, puis utilise le bouton d'insertion du panneau Recherche (extrait cité avec sa source) pour la faire apparaître formatée dans une scène — c'est exactement ce que fait la citation qu'on trouve dans « 1. Ouverture ».",
    "",
    "> Rien ne se perd, rien ne se crée, tout se transforme.",
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
    "Projet généré automatiquement pour explorer les fonctionnalités de Feuillets — chaque feuillet explique, dans son propre texte, ce qu'il illustre. Suit à peu près l'ordre de `PARCOURS-AUTEUR.md` : le chemin d'un auteur, du premier mot à l'export. Active ce projet depuis « Gestion des projets » (commande ou bouton) pour l'explorer ; un second exemple, « Candide, ou l'Optimisme », existe en parallèle (texte intégral de Voltaire, domaine public) — bascule de l'un à l'autre avec la commande « Changer de projet… » pour voir le multi-projets en action.",
    "",
    "## Écrire au quotidien",
    "",
    "En tapant dans n'importe quel feuillet du projet (pas dans les fiches Recherche) :",
    "",
    "- **Typographie française à la frappe** — guillemets droits `\"` → « », tirets `--`/`---` → – / — avec espace insécable, apostrophe `'` → ’, double Entrée = saut de paragraphe visible. Tout désactivable individuellement dans les réglages. La commande « Typographie française (sélection ou document) » applique la même chose *a posteriori* sur du texte déjà tapé ailleurs (le code, lui, n'est jamais touché).",
    "- **Alinéas automatiques** en début de paragraphe, **césure française** en mode lecture, **justification** en Live Preview.",
    "- **Outils de nettoyage ponctuels** (commandes) — réparer des séparateurs de scène échappés `\\*\\*\\*` (copiés depuis un autre éditeur) en vrais `***`, compacter des lignes vides multiples, insérer un séparateur de scène, ou extraire/éclater un document de chronologie en fiches datées individuelles.",
    "- **Gestes de balayage** (mobile/tablette, ou trackpad/souris horizontale type Magic Mouse) — balayage dans le tiers gauche/droit de l'écran pour ouvrir/fermer les barres latérales sans clic.",
    "",
    "## Le manuscrit",
    "",
    "- **Front/** — dédicace, page de titre… n'apparaît jamais dans le Chemin de fer, la Chronologie ou le mode Lecture.",
    "- **« 1. Ouverture »** — tour des champs de base : `titre_binder` (affiché dans le binder/l'onglet à la place du nom de fichier), `label`/`fil`/`personnages` (voir plus bas), tag imbriqué `demo/premier-niveau`, une note de bas de page et une citation insérée depuis une fiche Bibliographie.",
    "- **« 2. La rencontre »** — deux labels à la fois (`label: Rouge, Bleu`), une `date` alignée sur un jalon de la Chronologie (regarde le panneau Notes), et deux personnages cités par leur nom (section « Contexte » du panneau Notes, avec âge calculé à la date de la scène).",
    "- **« La route »** — scène sans aucun champ optionnel, pour rappeler que rien n'est obligatoire en dehors de la structure Partie/Chapitre/Scène. Bon endroit pour essayer le **mode concentration** (icône focus) ou la barre **Chercher et remplacer**.",
    "- **« Brouillon à corriger »** — scène volontairement imparfaite (fautes réelles, répétitions, verbes ternes, voix passive) : voir « Correction et style » plus bas.",
    "- **« La révélation » / « Le silence »** — un **fil narratif** planté puis résolu automatiquement (`fil: secret-de-l-ordre`), et une suggestion de **fusion** de ces deux scènes (sélection multiple du Tableau → Fusionner) pour voir les presets de fusion à l'œuvre.",
    "",
    "## Créer ou importer un projet",
    "",
    "Ce projet a été généré par la commande « Créer un projet d'exemple » — mais un vrai projet démarre plus souvent d'un dossier vide ou d'un plan déjà en tête. Sur un **nouveau projet vide** (pas celui-ci), essaie :",
    "",
    "- **« Nouveau projet… »** — crée le dossier projet et initialise sa structure (Recherche, Snapshots, Ressources, Journal) en une fois.",
    "- **« Importer un plan… »** — colle un plan Markdown dans la boîte de dialogue, chaque `#`/`##` devient un dossier, chaque tiret une scène. Exemple à copier-coller tel quel :",
    "",
    "```",
    "# Partie 1",
    "## Chapitre 1",
    "- Scène 1",
    "- Scène 2",
    "## Chapitre 2",
    "- Scène 3",
    "# Partie 2",
    "- Chapitre 3",
    "```",
    "",
    "- **« Importer un projet Scrivener… »** — convertit directement un fichier `.scriv` en arborescence Feuillets (bureau uniquement, accès au système de fichiers requis).",
    "",
    "## Panneau Cartes → mode Chemin de fer",
    "",
    "Trois boutons en haut du panneau : **Label** (lieux/couleurs, à gauche, en rond), **Personnage** (au centre) et **Fil** (intrigues, à droite, en carré) — chacun filtre indépendamment et affiche une ligne de continuité entre les scènes qui le portent. Survole un point pour voir son nom. Choisis « Rouge » en Label, « Elira Voskan » en Personnage, ou « secret-de-l-ordre » en Fil pour voir chacun à l'œuvre.",
    "",
    "Le Tableau a 4 autres modes : **Plan** (colonnes configurables façon tableur), **Chronologie** (scènes datées + jalons historiques), **Lecture** (flux continu), et bien sûr **Cartes** (tuiles). Tous partagent les mêmes filtres statut/label/progression et le mode sélection multiple.",
    "",
    "## Recherche, Notes, Propriétés",
    "",
    "- **Recherche/** — une fiche par catégorie (Personnages, Lieux, Lore, Bibliographie, Glossaire, Chronologie/Événements). Sélectionne un passage dans une fiche puis insère-le dans une scène (lien simple, citation, ou citation sourcée).",
    "- **Panneau Notes** (feuillet ouvert) — section Contexte (personnages/lieux détectés automatiquement), notes de dossier, Synopsis/Résumé/Notes de travail/Sources repliables et réordonnables, Plan du feuillet.",
    "- **Panneau Propriétés** — édite le frontmatter du feuillet ouvert (case à cocher, sélecteur de date, éditeur à jetons pour les listes), ou parcourt toutes les propriétés/tags utilisés dans **ce projet** (pas tout le coffre), avec ajout/suppression en masse.",
    "",
    "## Suivi",
    "",
    "- **Journal/** — deux entrées de jours ; bouton « Compiler le carnet » en haut du panneau.",
    "- **Panneau Statistiques** — objectifs de mots, compteurs détaillés, historique 14 jours ; se remplit tout seul.",
    "",
    "## Correction et style",
    "",
    "Ouvre **« Brouillon à corriger »** (Partie 1 → Chapitre 2) pour tester les deux outils suivants sur un texte volontairement fautif :",
    "",
    "- **Correction grammaticale (Grammalecte)** — commande « Correction grammaticale : vérifier le feuillet actif » (le panneau latéral Feuillets doit être ouvert au préalable, n'importe quel onglet). Fautes soulignées directement dans l'éditeur, commandes « faute suivante »/« faute précédente ». Bureau uniquement.",
    "- **Panneau Analyse** (icône dédiée, à côté de Notes/Recherche/Propriétés) — sur cette même scène : répétition de « cette phrase » signalée, verbe passe-partout « être » repéré, trois tournures à la voix passive détectées. Le champ `rythme:` (action/dialogue/description/introspection, posé aussi sur « Ouverture » et « La rencontre ») alimente la courbe narrative du panneau sur l'ensemble du manuscrit.",
    "- **Panneau Révision** — pour intégrer les retours d'un directeur/correcteur reçus en `.docx` annoté ; importe n'importe quel `.docx` avec des commentaires Word pour l'essayer (panneau vide au départ, aucun fichier d'exemple généré ici).",
    "",
    "## Sauvegarde",
    "",
    "- **Snapshots/** — vide au départ : clic-droit sur un feuillet → « Snapshot » pour voir une copie datée apparaître ici. « Sauvegarder les réglages du plugin » exporte toute la config en `.json`.",
    "",
    "## Compiler et exporter",
    "",
    "1. **Compiler le manuscrit** — assemble tous les feuillets du projet dans l'ordre du binder, selon le **preset de compilation** actif (séparateur entre scènes, titres de parties/chapitres/scènes insérés ou non) ; possibilité de choisir les feuillets manuellement plutôt que tout le projet.",
    "2. **Choisir un modèle de mise en page** — 7 modèles intégrés (Classique, Moderne, Machine à écrire, Roman simple, Roman français paysage 2 colonnes, APA, Thèse) dans le panneau Projet & export, ou un modèle personnalisé dans `Ressources/Modèles/` (bouton « Exporter les modèles intégrés » pour partir d'un modèle existant à personnaliser). À ne pas confondre avec `Ressources/Templates/`, les gabarits YAML utilisés à la création d'une nouvelle fiche Recherche.",
    "3. **Exporter** — .docx/.epub/.pdf, moteur natif par défaut (zéro dépendance, fonctionne sur mobile, sauf .pdf qui passe par l'impression système donc bureau uniquement) ; typographie française appliquée automatiquement au texte compilé. Pandoc reste disponible en option avancée pour qui l'a déjà installé (bureau uniquement) — un choix, pas un prérequis.",
    "",
    "## Le binder (barre latérale gauche)",
    "",
    "Toujours visible, colonne vertébrale du manuscrit — un seul bouton fait cycler **4 façons de l'afficher** : double volet façon Ulysses (dossiers | feuillets) → dossiers seuls → fichiers seuls → vue arbre classique → retour au double volet. Glisser-déposer pour réorganiser (numéros de chapitres renumérotés tout seuls), commande « Annuler le dernier déplacement » en filet de sécurité. Recherche par titre ou par contenu, filtres combinés statut/label/progression, et un menu d'options d'affichage (liserés de labels, pastilles de tags/statut, barres de progression, aperçu du contenu sous chaque titre).",
    "",
    "## Statuts et labels de couleur",
    "",
    "Chaque feuillet a un **statut** (Idée/Brouillon/En cours/Révisé/Terminé — les scènes de ce projet en couvrent trois) et jusqu'à un **label de couleur** par lieu/thème (6 par défaut — Rouge/Orange/Jaune/Vert/Bleu/Violet —, renommables et recolorables dans les réglages, redéfinissables par projet). Les deux sont filtrables partout où une liste de scènes s'affiche (binder, Tableau, Chemin de fer).",
    "",
    "## Réglages d'interface",
    "",
    "Une fois le workflow pris en main : masquer les modes du Tableau ou les panneaux latéraux inutilisés (y compris Révision, réactivable à tout moment), choisir quels panneaux s'ouvrent automatiquement au démarrage d'Obsidian, ajuster taille de police et échelle de l'interface — tout ça dans Réglages → Feuillets, section « Réglages avancés » pour les options les moins courantes (Apparence, Labels, Presets de compilation, Historique, Projets).",
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

const CANDIDE_PARTIES = [
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

function candideSceneLines({ ordre, titre, titreBinder, sousTitre, label, fil, personnages }) {
  const lines = [
    "---",
    `titre: "Chapitre ${ordre} — ${titre}"`,
    `titre_binder: ${JSON.stringify(titreBinder)}`,
    `ordre: ${ordre}`,
    `sous_titre: ${JSON.stringify(sousTitre)}`,
    `synopsis: ${JSON.stringify(sousTitre)}`,
    `label: ${JSON.stringify(label)}`,
  ];
  if (fil) lines.push(`fil: ${JSON.stringify(fil)}`);
  if (personnages.length > 0) {
    lines.push("personnages:");
    for (const p of personnages) lines.push(`  - ${p}`);
  }
  lines.push("compiler: true", "---", "");
  return lines;
}

async function generateCandide(app, S, plugin, manuscritPath) {
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
  const rf = mode.researchFolders;

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

  const researchRoot = getResearchRoot(app, S) || (await ensureFolder(app, `${root.parent.path}/Recherche`));

  const personnages = await ensureFolder(app, `${researchRoot.path}/${rf.personnages.label}`);
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Personnages)) {
    await writeSheet(app, personnages, name, [content]);
  }

  const lieux = await ensureFolder(app, `${researchRoot.path}/${rf.lieux.label}`);
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Lieux)) {
    await writeSheet(app, lieux, name, [content]);
  }

  const codex = await ensureFolder(app, `${researchRoot.path}/${rf.codex.label}`);
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Lore)) {
    await writeSheet(app, codex, name, [content]);
  }

  const chrono = getChronoFolder(app, S) || (await ensureFolder(app, `${researchRoot.path}/Chronologie`));
  for (const [name, content] of Object.entries(CANDIDE_RESEARCH.Chronologie)) {
    await writeSheet(app, chrono, name, [content]);
  }

  /* ---------- Lisez-moi ---------- */

  await writeSheet(app, root.parent, "Lisez-moi", [
    "---",
    "compiler: false",
    "---",
    "",
    `# ${CANDIDE_VOLUME_NAME}`,
    "",
    "Candide, ou l'Optimisme (Voltaire, 1759, domaine public) importé comme projet d'exemple : texte intégral des 30 chapitres, déjà balisés en `label:` (lieu), `fil:` (intrigue) et `personnages:`, plus les fiches de Recherche (Personnages, Lieux, Lore, Chronologie) — pour explorer le plugin sur un vrai manuscrit plutôt qu'un squelette minimal.",
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

/** Génère un projet Feuillets complet et déjà rempli, pour explorer toutes
 * les fonctionnalités du plugin sans partir d'une page blanche — le
 * contenu généré explique lui-même, dans son propre corps de texte, à quoi
 * sert chaque champ ou panneau qu'il illustre. Mode Fiction uniquement
 * (le plus riche des deux modes) ; une note dans "Lisez-moi.md" explique
 * la différence avec le mode Non-fiction sans dupliquer tout le contenu. */
/** `kind` : "elira" (roman générique, squelette qui explique chaque champ
 * dans son propre texte) ou "candide" (Candide, ou l'Optimisme — Voltaire,
 * domaine public — 30 chapitres déjà balisés label/fil/personnages, pour
 * explorer le Chemin de fer sur un vrai texte). */
export async function createDemoProject(app, settings, plugin, kind = "elira") {
  const S = settings;
  const volumeName = kind === "candide" ? CANDIDE_VOLUME_NAME : VOLUME_NAME;
  const generator = kind === "candide" ? generateCandide : generate;
  const volumePath = normalizePath(volumeName);
  if (app.vault.getAbstractFileByPath(volumePath)) {
    new Notice(
      `« ${volumeName} » existe déjà — supprime-le manuellement pour le régénérer.`
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
    await generator(app, S, plugin, manuscritPath);
    succeeded = true;
  } catch (err) {
    console.error("Feuillets: échec de la génération du projet d'exemple :", err);
    new Notice(
      `Échec de la génération du projet d'exemple : ${err && err.message ? err.message : err}. Ouvre la console (Ctrl/Cmd+Maj+I) pour le détail, supprime « ${volumeName} » avant de réessayer.`,
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
      `Projet d'exemple créé : ${volumeName}. Active-le depuis « Gestion des projets » pour l'explorer.`
    );
  }
}
