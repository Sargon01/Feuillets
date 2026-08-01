import { Notice, normalizePath, TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot, getChronoFolder, researchFolderPath } from "./research.js";
import { ensureFolder, initProjectStructure } from "./project-files.js";
import { ensureDayEntry } from "./journal.js";
import { dateKey } from "../utils/journal-stats.js";
import { applyModeDefaults } from "../utils/project-modes.js";
import { getProjectMode } from "./project-mode.js";
import { CANDIDE_CHAPTER_BODIES, CANDIDE_FRONT_FILES, CANDIDE_RESEARCH } from "./candide-content.js";

const VOLUME_NAME = "Feuillets — Exemple";
const CANDIDE_VOLUME_NAME = "Candide, ou l'Optimisme — Exemple";

type DemoKind = "elira" | "candide";

type DemoPlugin = {
  saveSettings(): Promise<void>;
  renderAllViews(force?: boolean): void | Promise<void>;
};

type SceneInput = {
  titre: string;
  titreCourt?: string;
  ordre: number;
  synopsis?: string;
  statut?: string;
  label?: string;
  fil?: string;
  personnages?: string[];
  rythme?: Partial<Record<"action" | "dialogue" | "description" | "introspection", number>>;
  tags?: string;
  date?: string;
  notes?: string;
  compiler?: boolean;
  body: string;
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

type DemoFrontmatter = Record<string, unknown>;

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

const sceneLines = ({ titre, titreCourt, ordre, synopsis, statut, label, fil, personnages, rythme, tags, date, notes, compiler, body }: SceneInput): string[] => {
  const lines = [
    "---",
    `title: ${titre}`,
    `short_title: ${titreCourt || ""}`,
    `order: ${ordre}`,
    `synopsis: ${synopsis || ""}`,
    `status: ${statut || ""}`,
    `label: ${label || ""}`,
  ];
  if (fil) lines.push(`thread: ${fil}`);
  if (personnages && personnages.length > 0) {
    lines.push("characters:");
    for (const p of personnages) lines.push(`  - ${p}`);
  }
  if (rythme) {
    lines.push("pace:");
    for (const dim of ["action", "dialogue", "description", "introspection"]) {
      lines.push(`  ${dim}: ${rythme[dim] ?? 0}`);
    }
  }
  lines.push(
    "goal: 800",
    `tags: ${tags || ""}`,
    `date: ${date || ""}`,
    `notes: ${notes || ""}`,
    `compile: ${compiler === false ? "false" : "true"}`,
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
async function generate(app: App, S: FeuilletsSettings, plugin: DemoPlugin, manuscritPath: string): Promise<void> {
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
  const researchFolders = mode.researchFolders;
  if (!isFictionResearchFolders(researchFolders)) {
    throw new Error("Dossiers de recherche Fiction introuvables.");
  }
  const rf = researchFolders;

  /* ---------- Manuscrit ---------- */

  const front = await ensureFolder(app, `${root.path}/Front`);
  await writeSheet(app, front, "Dédicace", [
    "---",
    "title: Dédicace",
    "compile: true",
    "---",
    "",
    "Le dossier « Front » (ici, dossier parent de ce feuillet) n'apparaît jamais dans le mode Chemin de fer, la Chronologie ou le mode Lecture narratif — ce n'est pas du texte de roman, juste ce qui vient avant (dédicace, épigraphe, page de titre...). Il reste néanmoins un dossier normal du binder, que tu peux réorganiser comme les autres.",
    "",
    "Regarde la barre latérale gauche (le **binder**) qui affiche ce feuillet : par défaut en double volet façon Ulysses (dossiers à gauche, feuillets du dossier sélectionné à droite). Un seul bouton en haut du binder fait cycler 4 façons de le voir — essaie-le. Glisse-dépose un feuillet ou un dossier pour le réorganiser (les numéros de chapitres se renumérotent tout seuls) ; une commande « Annuler le dernier déplacement » existe en filet de sécurité si tu te trompes. En haut du binder : recherche (titres ou titres + contenu), filtres combinés (statut/label/progression), et un menu d'options d'affichage.",
    "",
    "Ce projet a été généré par la commande/l'icône « Créer un projet d'exemple » — accessible aussi bien depuis le gestionnaire de projets (icône ✨) que depuis les réglages du plugin. Un second exemple, « Candide, ou l'Optimisme » (texte intégral de Voltaire, domaine public), existe en parallèle : commande « Changer de projet… » pour voir plusieurs manuscrits gérés côte à côte. Réglages → Feuillets pour choisir quels panneaux s'ouvrent au démarrage d'Obsidian, ajuster taille de police et échelle de l'interface, ou dérouler « Réglages avancés » pour les options moins courantes (Apparence, Labels, Presets de compilation, Historique, Projets).",
    "",
  ]);

  /* Page de titre : générée vide (juste :::titre:) par initProjectStructure
     — on la complète ici pour un vrai exemple travaillé, et pour expliquer
     le système de rôles (chaque ligne `:::rôle:` reçoit sa mise en forme —
     taille, gras, alignement, marges — depuis titlePage.styles du modèle
     d'export choisi, pas de composition à la main). */
  const titlePagePath = normalizePath(`${front.path}/Page de titre.md`);
  const titlePageFile = app.vault.getAbstractFileByPath(titlePagePath);
  if (titlePageFile instanceof TFile) {
    await app.vault.modify(titlePageFile, [
      "---",
      "title: La Citadelle Grise",
      "short_title: ",
      "order: 1",
      "synopsis: ",
      "status: ",
      "label: ",
      "tags: ",
      "date: ",
      "notes: ",
      "compile: true",
      "type: titre",
      "---",
      ":::titre: **La Citadelle Grise**",
      ":::sous-titre: *roman*",
      ":::mots: Un jeu de mots optionnel, sous le titre",
      ":::auteur: Auteur d'exemple",
      ":::adresse: ",
      ":::coordonnées: ",
      "",
      "Chaque ligne `:::rôle: contenu` ci-dessus devient un bloc typé à l'export — `:::titre:`, `:::sous-titre:`, `:::mots:`, `:::auteur:`, `:::adresse:`, `:::coordonnées:` sont les rôles reconnus par les 7 modèles intégrés, mais le rôle est libre : n'importe quel nom que le modèle définit fonctionne, un rôle absent retombe simplement sur la mise en forme de base. Pour changer la **taille, le gras, l'alignement ou les marges** d'un rôle, ce n'est pas ici que ça se règle : ouvre le modèle de mise en page actif (panneau Projet & export, ou exporte les modèles intégrés dans `Ressources/Layout/` pour en personnaliser un) et modifie sa section `titlePage.styles.<rôle>`. Une ligne sans `:::` (rare) reste stylée comme le corps de page Front normal.",
      "",
    ].join("\n"));
  }

  await writeSheet(app, front, "Comment démarrer un vrai projet", [
    "---",
    "title: Comment démarrer un vrai projet",
    "compile: false",
    "---",
    "",
    "Ce projet-ci a été généré tout fait, mais un vrai projet démarre le plus souvent d'un dossier vide ou d'un plan déjà en tête. Trois façons de commencer, sur un **nouveau projet vide** (pas celui-ci) :",
    "",
    "**1. À la main** — « Nouveau projet… » crée le dossier, Manuscrit avec sa page de titre et un premier chapitre, Recherche et Ressources en une fois — Snapshots et Journal se créent tout seuls dès leur premier usage réel. Il ne reste qu'à créer les Parties/Chapitres/Scènes suivantes depuis le binder.",
    "",
    "**2. Importer un plan** — si la structure existe déjà dans un fichier texte, un carnet ou une autre appli, colle-la telle quelle dans « Importer un plan… » : chaque `#`/`##` devient un dossier (Partie/Chapitre), chaque tiret une scène. Exemple à copier-coller :",
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
    "Toute une arborescence de roman posée en un seul copier-coller, avant même d'avoir écrit un mot de texte.",
    "",
    "**3. Importer depuis Scrivener** — commande « Importer un projet Scrivener… » : sélectionne le fichier `.scriv` de ton projet, il est converti directement en arborescence Feuillets (dossiers Partie/Chapitre, feuillets de scène, synopsis repris s'il existe). Bureau uniquement — l'import nécessite un accès direct au système de fichiers, indisponible sur mobile.",
    "",
  ]);

  const partie1 = await ensureFolder(app, `${root.path}/Partie 1 - Les commencements`);
  const chap1 = await ensureFolder(app, `${partie1.path}/Chapitre 1 - Le départ`);

  /* Notes de dossier (Partie/Chapitre) : convention "même nom que le
     dossier, à l'intérieur" (services/folder-notes.js) — pré-remplies ici
     avec un vrai contenu, plutôt que la coquille vide que produirait un
     clic sur la pastille depuis le panneau Notes, pour que la fonction
     soit immédiatement visible plutôt que juste un bouton qui marche. */
  await writeSheet(app, partie1, "Partie 1 - Les commencements", [
    "---",
    "title: Partie 1 - Les commencements",
    "synopsis: Elira quitte son ancienne vie ; les prémices de l'intrigue se mettent en place.",
    "notes: Ceci est une note de DOSSIER (une par Partie/Chapitre), pas une scène — elle sert aux intentions générales de toute une partie du roman. Accessible en cliquant la pastille correspondante en haut du panneau Notes quand un feuillet de cette partie est ouvert, ou directement ici depuis le binder.",
    "---",
    "",
  ]);
  await writeSheet(app, chap1, "Chapitre 1 - Le départ", [
    "---",
    "title: Chapitre 1 - Le départ",
    "synopsis: La lettre, puis la première rencontre avec Tomas Grey.",
    "notes: Note de dossier de niveau Chapitre — plus précise que celle de la Partie englobante, mais toujours hors manuscrit compilé et hors comptage de mots.",
    "---",
    "",
  ]);

  const ouvertureFile = await writeSheet(app, chap1, "1. Ouverture", sceneLines({
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
    body: 'Ceci est un exemple de scène. Le champ `titre_binder` ("Ouverture") est ce qui s\'affiche dans le binder et l\'onglet Obsidian, à la place du nom de fichier. Ouvre le panneau Cartes → mode Chemin de fer : trois boutons en haut — **Label** (`label: Rouge`, à gauche, en rond), **Personnage** (`personnages: Elira Voskan`, au centre) et **Fil** (`fil: Éveil`, à droite, en carré) — choisis-en un pour voir la ligne continue courir à travers les scènes qui le portent, même à travers des chapitres différents. Survole un point pour voir son nom. Le tag `demo/premier-niveau` est un tag imbriqué — regarde le panneau Tags pour voir comment il apparaît dans l\'arborescence.\n\nCette phrase porte une note de bas de page[^1] et une citation insérée depuis la fiche « Sources d\'inspiration » du panneau Recherche (sélectionne un passage dans une fiche Bibliographie, puis clique « Insérer comme citation »).\n\n> « Rien ne se perd, rien ne se crée, tout se transforme. » (Sources d\'inspiration)\n\n[^1]: Exemple de note de bas de page — commande « Insérer une note de bas de page », ou « Renuméroter les notes de bas de page » si l\'ordre change.\n\nCette scène porte aussi un **statut** (`statut: Terminé` — les autres valeurs possibles sont Idée, Brouillon, En cours, Révisé) et un **label de couleur** (`label: Rouge`, l\'un des 6 par défaut — Rouge/Orange/Jaune/Vert/Bleu/Violet —, renommables et recolorables dans les réglages du plugin, redéfinissables par projet). Les deux sont filtrables dans le binder et le Tableau.\n\nFais un clic-droit sur ce feuillet dans le binder : tu trouveras **« Snapshot »** (copie datée immédiate) et **« Restaurer un snapshot »**. Ce dernier propose déjà une version : cette scène existait il y a trois jours avec un statut Brouillon et un texte plus court, sans note de bas de page ni citation — le menu affiche un **comparateur de différences** entre cette ancienne version et celle-ci, ligne à ligne. C\'est indépendant de tout historique Git ou de la synchronisation du coffre : une sauvegarde locale, gérée entièrement par le plugin.',
  }));

  /* Snapshot réel (pas "vide au départ") : une version antérieure d'Ouverture,
     dans la même arborescence que snapshotFile() (services/project-files.js)
     — Snapshots/<basename>/<horodatage>.md — pour que « Restaurer un
     snapshot » et le comparateur de différences aient tout de suite un vrai
     avant/après à montrer, sans attendre que l'utilisateur en crée un. */
  {
    const snapshotsBase = normalizePath(`${root.parent!.path}/Snapshots`);
    const snapshotDir = normalizePath(`${snapshotsBase}/${ouvertureFile.basename}`);
    await ensureFolder(app, snapshotsBase);
    await ensureFolder(app, snapshotDir);
    const d = new Date(Date.now() - 3 * 86400000);
    const p2 = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const oldBody = sceneLines({
      titre: "Ouverture",
      titreCourt: "Ouverture",
      ordre: 1,
      synopsis: "Elira découvre la lettre qui bouleversera son existence.",
      statut: "Brouillon",
      label: "Rouge",
      body: "Version de brouillon, avant relecture — c'est ce que « Restaurer un snapshot » (menu des 15 versions les plus récentes) ou le comparateur de différences donnent à voir en face de la version actuelle. Le champ `statut` était encore à Brouillon ; le texte lui-même était plus court, sans note de bas de page ni citation.",
    }).join("\n");
    const snapshotPath = normalizePath(`${snapshotDir}/${stamp}.md`);
    if (!app.vault.getAbstractFileByPath(snapshotPath)) {
      await app.vault.create(snapshotPath, oldBody);
    }
  }

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
    body: "Cette scène porte deux labels à la fois (`label: Rouge, Bleu`) — une scène peut appartenir à plusieurs fils en même temps, chacun avec sa propre couleur et sa propre ligne dans le Chemin de fer. Elle porte aussi une `date: 1421-03-12`, qui correspond à un jalon de la Chronologie (« Fondation de la Citadelle », dans Recherche/Chronologie) : garde ce feuillet actif et regarde le panneau Notes, tu verras le rapprochement automatique avec ce jalon historique. Elle cite aussi Elira et Tomas par leur nom — ouvre le panneau Notes et regarde la section « Contexte » : leurs fiches Recherche y apparaissent automatiquement, avec leur âge à la date de la scène, ET l'état le plus récent de leur section `## Évolution` (fiche « Elira Voskan », Recherche/Personnages) antérieur ou égal au 12 mars 1421 — pas leur synopsis générique. Ouvre cette fiche pour voir la section, et son bouton « Voir ses apparitions » (compteur de scènes qui la citent, avec extrait, dans l'ordre du manuscrit).",
  }));

  const chap2 = await ensureFolder(app, `${partie1.path}/Chapitre 2 - Le voyage`);
  await writeSheet(app, chap2, "1. La route", sceneLines({
    titre: "La route",
    ordre: 1,
    synopsis: "Le voyage vers la Citadelle Grise commence.",
    statut: "Brouillon",
    body: "Une scène tout à fait ordinaire, sans label ni fil particulier — pour montrer qu'aucun champ n'est obligatoire en dehors de la structure elle-même (dossier projet → parties → chapitres → scènes).\n\nEssaie ici le mode concentration (icône focus dans le binder ou le ruban) : plein écran d'écriture, texte hors focus estompé, compteur de mots flottant, Échap pour sortir. Ou ouvre la barre « Chercher et remplacer dans le manuscrit… » (commande dédiée, distincte de la recherche native d'Obsidian) pour chercher un mot dans tout le projet.\n\nEssaie aussi de taper directement ici : guillemets droits `\"` → « », tirets `--`/`---` → – / — avec espace insécable, apostrophe `'` → ’, tout automatique (désactivable dans les réglages). La commande « Typographie française (sélection ou document) » applique la même chose *a posteriori* sur du texte déjà tapé ailleurs. Alinéas automatiques en début de paragraphe, césure française en mode lecture, justification en Live Preview — tout ça sans rien configurer.\n\nD'autres commandes ponctuelles existent pour le nettoyage : réparer des séparateurs de scène échappés `\\*\\*\\*` (copiés depuis un autre éditeur) en vrais `***`, compacter des lignes vides multiples, insérer un séparateur de scène, ou extraire/éclater un document de chronologie en fiches datées individuelles. Et sur mobile/tablette (ou trackpad/souris horizontale type Magic Mouse) : balaie le tiers gauche/droit de l'écran pour ouvrir/fermer les barres latérales sans toucher un bouton.",
  }));

  /* Scène volontairement imparfaite : répétitions, verbes passe-partout et
     voix passive pour le panneau Analyse, plus un champ `rythme` par
     dimension pour la courbe narrative. Feuillets ne corrige plus
     l'orthographe (voir README) : les défauts assemblés ici sont ceux que
     l'analyse de style sait montrer. */
  await writeSheet(app, chap2, "2. Brouillon à corriger", [
    "---",
    "title: Brouillon à corriger",
    "short_title: Brouillon à corriger",
    "order: 2",
    "synopsis: Scène délibérément imparfaite, pour découvrir le panneau Analyse.",
    "status: Brouillon",
    "goal: 800",
    "pace:",
    "  action: 4",
    "  dialogue: 1",
    "  description: 4",
    "  introspection: 1",
    "compile: true",
    "---",
    "",
    "Les chevals étaient fatigués. Elira était fatiguée aussi. Elle était inquiète, elle était certaine que quelque chose était différent depuis la lettre — elle était sûre de l'avoir déjà lu quelque part, cette phrase, cette même phrase, cette phrase qui revenait sans cesse.",
    "",
    "La décision fut prise par Elira. La route fut prise sans un mot. Le silence fut à peine rompu par le vent.",
    "",
    "Cette scène contient volontairement : une répétition serrée (« cette phrase » × 3) et un abus du verbe passe-partout « être » pour le **panneau Analyse** (icône dédiée, à côté de Notes/Recherche/Propriétés) ; trois phrases à la voix passive (« fut prise », « fut prise », « fut rompu ») que ce même panneau signale aussi. Le champ `rythme:` (action/dialogue/description/introspection, 0 à 5) alimente sa courbe narrative — répète-le sur d'autres scènes pour voir la courbe se dessiner sur tout le manuscrit.\n\nSi un jour un directeur littéraire ou un correcteur externe renvoie ses remarques sur CE genre de scène sous forme de fichier `.docx` annoté (suivi des modifications Word, commentaires en marge), c'est le **panneau Révision** (un outil distinct du panneau Analyse) qui les intègre sans quitter Obsidian : importe le `.docx` reçu, parcours les commentaires un par un, applique ou ignore chaque suggestion directement dans l'éditeur. Ce projet d'exemple ne fournit pas de `.docx` annoté tout fait (il faudrait un vrai fichier Word avec des pistes de révision, pas juste du Markdown) — mais le panneau accepte n'importe quel `.docx` de ce type, y compris un que tu créerais toi-même dans Word en ajoutant un commentaire sur un paragraphe puis en l'exportant.",
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
  const silenceFile = await writeSheet(app, chap3, "2. Le silence", sceneLines({
    titre: "Le silence",
    ordre: 2,
    synopsis: "Le silence retombe — dernier feuillet du manuscrit.",
    compiler: false,
    body: "Ceci est le DERNIER feuillet du manuscrit dans l'ordre du projet — c'est lui qui reçoit automatiquement le marqueur du fil « secret-de-l-ordre » planté dans « La révélation ». Regarde son frontmatter après avoir ouvert ce projet : un champ `fil: secret-de-l-ordre` devrait y être apparu tout seul. Ce feuillet a aussi `compiler: false` : il n'apparaîtra jamais dans le manuscrit compilé (commande « Compiler le manuscrit »), contrairement aux autres scènes.\n\nEssaie aussi de fusionner « La révélation » et « Le silence » en les sélectionnant toutes les deux (mode sélection multiple du Tableau) puis « Fusionner » : un preset (Roman/Nouvelle/Scénario/Minimal) décide champ par champ s'il garde, additionne ou ignore chaque propriété. « Scinder » une scène (depuis le curseur ou une sélection de texte) fait l'inverse.\n\nC'est aussi la fin du manuscrit — le moment où, dans un vrai projet, tu compilerais et exporterais. Trois étapes : 1) **« Compiler le manuscrit »**, qui assemble tous les feuillets dans l'ordre du binder selon le preset de compilation actif (séparateur entre scènes, titres insérés ou non) ; 2) choisir un **modèle de mise en page** parmi les 7 intégrés (Classique, Moderne, Machine à écrire, Roman simple, Roman français, APA, Thèse) dans le panneau Projet & export, ou un modèle personnalisé dans `Ressources/Layout/` ; 3) **exporter** en .docx/.epub/.pdf — moteur natif 100% autonome, zéro dépendance, fonctionne sur mobile (sauf .pdf, impression système, bureau uniquement), typographie française appliquée automatiquement au texte compilé.",
  }));

  /* ---------- Recherche ---------- */

  const researchPath = researchFolderPath(app, S, root);
  if (!researchPath) throw new Error("Dossier Recherche introuvable.");
  const researchRoot = getResearchRoot(app, S) || (await ensureFolder(app, researchPath));

  const personnages = await ensureFolder(app, `${researchRoot.path}/${rf.personnages.label}`);
  await writeSheet(app, personnages, "Elira Voskan", [
    "---",
    "last_name: Voskan",
    "first_name: Elira",
    "birth: 1398",
    "death: ",
    "synopsis: Héroïne de ce projet d'exemple.",
    "tags:",
    "  - personnage",
    "---",
    "",
    'Fiche de personnage : les champs `nom`/`prénom`/`naissance`/`mort` sont libres, à adapter à tes besoins. Ouvre le bouton "Voir ses apparitions" en haut de cette fiche (dans le panneau Recherche) : il ouvre une fenêtre listant **chaque scène qui la cite** (par tag, par lien `[[...]]`, ou simplement par son nom dans le texte), avec un compteur (« N scène(s), dans l\'ordre du manuscrit ») et un court extrait autour de la citation dans chaque scène — pratique pour vérifier qu\'un personnage n\'est pas oublié pendant 10 chapitres d\'affilée. Le tag `personnage` est un tag "structurel" — il reste invisible dans le filtre de tags du panneau Recherche et dans le panneau Tags, il sert seulement à ranger cette fiche dans le bon dossier.',
    "",
    "## Évolution",
    "",
    "- 1398 : naissance à Bakhtar, dans une famille de tisserands.",
    "- 1415 : quitte le village natal après la Grande Rupture.",
    "- 1421 : scribe pour l'Ordre du Silence, sans en connaître encore les secrets.",
    "",
    "Ces lignes datées (`année : état`, avec ou sans puce, l'année en gras ou non — le tiret, le deux-points pleine chasse et le tiret cadratin sont aussi acceptés comme séparateur) sont ce que le panneau Notes lit pour remplir sa section **Contexte** : ouvre « 2. La rencontre » (datée du 12 mars 1421) et regarde cette section — au lieu du synopsis générique de cette fiche, c'est la ligne « scribe pour l'Ordre du Silence... » qui s'affiche, parce que c'est le dernier état connu à cette date ou avant. Le titre `## Évolution` est une convention de lisibilité, pas une syntaxe obligatoire : seules les lignes `année : texte` elles-mêmes sont reconnues, où qu'elles soient dans la fiche.",
    "",
  ]);
  await writeSheet(app, personnages, "Tomas Grey", [
    "---",
    "last_name: Grey",
    "first_name: Tomas",
    "birth: 1395",
    "death: ",
    "synopsis: Second personnage principal — voir « La rencontre » et « La révélation ».",
    "tags:",
    "  - personnage",
    "---",
    "",
  ]);

  const lieux = await ensureFolder(app, `${researchRoot.path}/${rf.lieux.label}`);
  await writeSheet(app, lieux, "La Citadelle Grise", [
    "---",
    'title: "La Citadelle Grise"',
    "synopsis: Forteresse assiégée où se déroule l'essentiel de l'intrigue.",
    "tags:",
    "  - lieu",
    "---",
    "",
    "Fiche de lieu : même principe que les fiches personnage, avec `titre` à la place de `nom`/`prénom`. Un lieu peut porter la même section `## Évolution` qu'un personnage — pas seulement un âge, un ÉTAT.",
    "",
    "## Évolution",
    "",
    "- 1390 : simple fort de garnison, quasiment abandonné.",
    "- 1421 : place forte assiégée par l'Ordre du Silence.",
    "",
  ]);

  const codex = await ensureFolder(app, `${researchRoot.path}/${rf.codex.label}`);
  await writeSheet(app, codex, "L'Ordre du Silence", [
    "---",
    'title: "L\'Ordre du Silence"',
    "description: Confrérie secrète au cœur de l'intrigue.",
    "tags:",
    "  - codex",
    "---",
    "",
    'Ce dossier (Lore) fait partie des 6 catégories créées automatiquement en mode Fiction : Personnages, Lieux, Lore, Glossaire, Événements, Bibliographie. Elles sont nées pour la fiction et ne généralisent à rien d\'autre — une thèse de droit n\'a pas besoin d\'"Acteurs", un essai de diplomatie a besoin de "Traités" plutôt que de "Géographie". Aussi, en Non-fiction, SEULES Sources et Bibliographie sont créées d\'office ; tout le reste se crée à la demande, adapté au VRAI sujet du projet, via le bouton "Nouvelle rubrique" (icône dédiée) du panneau Recherche — pas de gabarit générique imposé d\'avance.',
    "",
  ]);

  const biblio = await ensureFolder(app, `${researchRoot.path}/${rf.bibliographie.label}`);
  await writeSheet(app, biblio, "Sources d'inspiration", [
    "---",
    'title: "Sources d\'inspiration"',
    "author: Lavoisier",
    "date: 1789",
    "publisher: Traité élémentaire de chimie",
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
    'title: "Vocable"',
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
    'title: "Fondation de la Citadelle"',
    "date: 1421-03-12",
    "end_date: ",
    "synopsis: Jalon historique — sa date correspond à celle de la scène « La rencontre ».",
    "tags:",
    "  - evenement",
    "---",
    "",
  ]);
  await writeSheet(app, chrono, "La Grande Rupture", [
    "---",
    'title: "La Grande Rupture"',
    "date: 1418-11-02",
    "end_date: ",
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
  if (!todayFile) throw new Error("Entrée de journal introuvable.");
  await app.vault.modify(
    todayFile,
    ["---", `date: ${dateKey(today)}`, "notes: ", "---", "", "Exemple d'entrée de journal — un feuillet par jour, jamais compilé avec le manuscrit. Le bouton « Compiler le carnet » (icône en haut du panneau Journal) rassemble toutes ces entrées dans un seul fichier « Journal d'écriture.md », régénéré à chaque fois.", ""].join("\n")
  );
  const yesterdayFile = await ensureDayEntry(app, S, yesterday);
  if (!yesterdayFile) throw new Error("Entrée de journal introuvable.");
  await app.vault.modify(
    yesterdayFile,
    ["---", `date: ${dateKey(yesterday)}`, "notes: ", "---", "", "Deuxième entrée d'exemple — ouvre le panneau Journal pour voir ces deux jours marqués d'un point dans le calendrier.", ""].join("\n")
  );

  /* ---------- Lisez-moi ---------- */

  await writeSheet(app, root.parent!, "Lisez-moi", [
    "---",
    "compile: false",
    "---",
    "",
    `# ${VOLUME_NAME}`,
    "",
    "Projet généré automatiquement pour explorer les fonctionnalités de Feuillets — chaque feuillet explique, dans son propre texte, ce qu'il illustre. Suit à peu près l'ordre de `PARCOURS-AUTEUR.md` : le chemin d'un auteur, du premier mot à l'export. Active ce projet depuis « Gestion des projets » (commande ou bouton) pour l'explorer ; un second exemple, « Candide, ou l'Optimisme », existe en parallèle (texte intégral de Voltaire, domaine public) — bascule de l'un à l'autre avec la commande « Changer de projet… » pour voir le multi-projets en action.",
    "",
    "## Parcours guidé en 4 étapes",
    "",
    "Pressé·e ? Ces quatre gestes suffisent à voir l'essentiel, sur ce projet ou sur un nouveau :",
    "",
    "1. **Créer une scène** — survole un dossier de chapitre dans le binder (volet dossiers) puis clique le « + » qui apparaît, ou clic droit → « Nouveau feuillet ici ». Donne-lui un titre, elle apparaît aussitôt dans la liste.",
    "2. **La déplacer dans le Binder** — glisse-dépose le feuillet ou le dossier vers son nouvel emplacement ; les numéros de chapitres se renumérotent tout seuls. Une commande « Annuler le dernier déplacement » existe si tu te trompes.",
    "3. **Écrire quelques lignes** — ouvre-la et tape directement : guillemets et tirets se transforment automatiquement en typographie française, aucun réglage requis.",
    "4. **Compiler le manuscrit** — commande « Compiler le manuscrit » : tous les feuillets s'assemblent dans l'ordre du binder en un seul document, prêt à exporter en .docx/.epub/.pdf.",
    "",
    "Une fois à l'aise avec ces quatre gestes, la commande/le clic droit « Dupliquer comme nouvelle version… » (sur la racine du manuscrit dans le binder, dans « Gérer les projets », ou palette de commandes) fige une copie du manuscrit sous un nouveau nom — pratique avant une réécriture importante : la copie s'ouvre et se compare à l'original (clic droit sur un feuillet → « Comparer avec un autre feuillet… ») sans jamais modifier ce dernier.",
    "",
    "**Ce qui est facultatif.** Rien de tout cela n'est obligatoire : Feuillets fonctionne avec de simples dossiers Markdown, sans aucun frontmatter. Les métadonnées YAML (`statut`, `label`, `synopsis`…), les dossiers `Recherche`/`Ressources`, et les snapshots (sauvegardes automatiques d'un feuillet) sont des compléments qui enrichissent le Binder, la recherche de contexte et la compilation — jamais des conditions pour écrire. Un dossier Markdown déjà existant, avec ou sans frontmatter, s'ouvre tel quel via « Ouvrir un dossier existant » : rien n'y est déplacé, renommé ni modifié.",
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
    "- **Front/** — dédicace, page de titre à rôles déjà composée (`:::titre:`/`:::sous-titre:`/`:::auteur:`…), et « Comment démarrer un vrai projet » (Nouveau projet, import de plan, import Scrivener) ; n'apparaît jamais dans le Chemin de fer, la Chronologie ou le mode Lecture.",
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
    "- **« Nouveau projet… »** — crée le dossier projet, Manuscrit (avec sa page de titre et un premier chapitre), Recherche et Ressources en une fois. Snapshots et Journal se créent tout seuls dès leur premier usage.",
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
    "- **Panneau Notes** (feuillet ouvert) — section Contexte (personnages/lieux détectés automatiquement), **notes de dossier** (fil d'Ariane en haut du panneau, sur « 1. Ouverture » ou « 2. La rencontre » : clique « Partie 1 - Les commencements » ou « Chapitre 1 - Le départ » — ces deux notes sont déjà rédigées, pas vides), Synopsis/Résumé/Notes de travail/Sources repliables et réordonnables, Plan du feuillet.",
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
    "- **Analyse de style** — panneau Analyse (icône dédiée) : répétitions, équilibre des chapitres, ratio de dialogue, courbe narrative. Feuillets ne corrige pas l'orthographe : pour cela, installe un greffon dédié depuis la galerie communautaire d'Obsidian.",
    "- **Panneau Analyse** (icône dédiée, à côté de Notes/Recherche/Propriétés) — sur cette même scène : répétition de « cette phrase » signalée, verbe passe-partout « être » repéré, trois tournures à la voix passive détectées. Le champ `rythme:` (action/dialogue/description/introspection, posé aussi sur « Ouverture » et « La rencontre ») alimente la courbe narrative du panneau sur l'ensemble du manuscrit.",
    "- **Panneau Révision** — pour intégrer les retours d'un directeur/correcteur reçus en `.docx` annoté ; importe n'importe quel `.docx` avec des commentaires Word pour l'essayer (panneau vide au départ, aucun fichier d'exemple généré ici).",
    "",
    "## Sauvegarde",
    "",
    "- **Snapshots/** — « 1. Ouverture » a déjà une version antérieure de trois jours : clic-droit sur ce feuillet → « Restaurer un snapshot » pour voir le comparateur de différences avec un vrai avant/après. « Sauvegarder les réglages du plugin » exporte toute la config en `.json`.",
    "",
    "## Compiler et exporter",
    "",
    "1. **Compiler le manuscrit** — assemble tous les feuillets du projet dans l'ordre du binder, selon le **preset de compilation** actif (séparateur entre scènes, titres de parties/chapitres/scènes insérés ou non) ; possibilité de choisir les feuillets manuellement plutôt que tout le projet.",
    "2. **Choisir un modèle de mise en page** — 7 modèles intégrés (Classique, Moderne, Machine à écrire, Roman simple, Roman français paysage 2 colonnes, APA, Thèse) dans le panneau Projet & export, ou un modèle personnalisé dans `Ressources/Layout/` (bouton « Exporter les modèles intégrés » pour partir d'un modèle existant à personnaliser). À ne pas confondre avec `Ressources/Template/`, les gabarits YAML utilisés à la création d'une nouvelle fiche Recherche.",
    "3. **Exporter** — .docx/.epub/.pdf, moteur natif (zéro dépendance, fonctionne sur mobile, sauf .pdf qui passe par l'impression système donc bureau uniquement) ; typographie française appliquée automatiquement au texte compilé.",
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
    "Ce projet est en mode **Fiction** — la structure du manuscrit (parties/chapitres/scènes) et les champs frontmatter lus sont rigoureusement identiques dans les deux modes, réglable par projet dans les réglages du plugin (section « Dossier du projet »). Ce qui change vraiment :",
    "",
    "- **Vocabulaire** : « scène » devient « section », le mode Cartes par défaut devient le mode Plan (`hasSources: true` active aussi un champ Sources dans le panneau Notes).",
    "- **Recherche créée automatiquement** — en Fiction, 6 catégories d'un coup : Personnages, Lieux, Lore, Glossaire, Événements, Bibliographie (voir la fiche « L'Ordre du Silence » dans Recherche/Lore pour le détail). En **Non-fiction, seules Sources et Bibliographie** sont créées d'office — pas d'« Acteurs » ni de « Géographie » automatiques, parce que ces catégories nées pour la fiction ne généralisent à aucun autre sujet (une thèse de droit n'en a pas besoin). Tout le reste se crée à la demande via « Nouvelle rubrique », adapté au vrai sujet du projet.",
    "- **Sources vs Bibliographie** : les deux existent dans les deux modes et servent la même fonction — noter une référence (auteur/année/édition) puis l'insérer comme **citation formatée** dans une scène (sélectionne un passage dans la fiche, clique « Insérer comme citation », avec ou sans la source rattachée). Aucun champ n'est réservé à un mode : la seule vraie différence Non-fiction est que Sources se crée automatiquement dès le départ, alors qu'en Fiction ce même besoin passe par Bibliographie ou une rubrique personnalisée.",
    "",
  ]);

  /* ---------- Fil narratif : plante le marqueur des deux côtés directement ---------- */

  /* handleFilChanged() (services/narrative-threads.js) relit fmOf(app, file)
     via app.metadataCache juste après processFrontMatter — dans un vrai
     usage interactif, l'événement metadataCache "changed" qui le déclenche
     ne se déclenche justement QU'UNE FOIS le cache à jour, donc pas de
     souci. Ici, en génération par lot, appeler handleFilChanged juste après
     avoir attendu processFrontMatter ne garantit pas que le cache ait déjà
     absorbé l'écriture — le marqueur automatique n'apparaissait jamais sur
     « Le silence » en pratique. Plus fiable : poser nous-mêmes les deux
     côtés (origine + marqueur), et enregistrer l'état exactement comme le
     ferait l'automatisation, pour qu'une résolution manuelle ultérieure
     par l'utilisateur continue de fonctionner normalement ensuite. */
  await app.fileManager.processFrontMatter(plantScene, (fm: DemoFrontmatter) => {
    fm.thread = "secret-de-l-ordre";
  });
  await app.fileManager.processFrontMatter(silenceFile, (fm: DemoFrontmatter) => {
    fm.thread = "secret-de-l-ordre";
  });
  if (!S.filPlaceholders) S.filPlaceholders = {};
  if (!S.filOrigins) S.filOrigins = {};
  S.filPlaceholders["secret-de-l-ordre"] = silenceFile.path;
  S.filOrigins["secret-de-l-ordre"] = plantScene.path;
  await plugin.saveSettings();
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

  await writeSheet(app, root.parent!, "Lisez-moi", [
    "---",
    "compile: false",
    "---",
    "",
    `# ${CANDIDE_VOLUME_NAME}`,
    "",
    "Candide, ou l'Optimisme (Voltaire, 1759, domaine public) importé comme projet d'exemple : texte intégral des 30 chapitres, déjà balisés en `label:` (lieu), `fil:` (intrigue) et `personnages:`, plus les fiches de Recherche (Personnages, Lieux, Lore, Chronologie) — pour explorer le plugin sur un vrai manuscrit plutôt qu'un squelette minimal. Pour un parcours guidé en 4 étapes (créer une scène, la déplacer, écrire, compiler), voir le `Lisez-moi.md` du projet « Feuillets — Exemple ».",
    "",
    "**Ce qui est facultatif.** Comme sur tout projet Feuillets : les métadonnées YAML, les dossiers `Recherche`/`Ressources` et les snapshots enrichissent le Binder et la compilation, mais rien de tout cela n'est obligatoire — un simple dossier Markdown fonctionne aussi.",
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
export async function createDemoProject(
  app: App,
  settings: FeuilletsSettings,
  plugin: DemoPlugin,
  kind: DemoKind = "elira"
): Promise<void> {
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
