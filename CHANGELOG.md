# Changelog

Toutes les évolutions notables du plugin sont consignées ici.

## Non publié

### Ajouté

- **Correction grammaticale anglaise, via [Harper](https://writewithharper.com).**
  S'ajoute à Grammalecte (français) : les deux moteurs tournent 100% en
  local, choisis automatiquement selon la langue active, sans dépendance à
  un service tiers.
- **Téléchargement à la demande des moteurs locaux.** Les dictionnaires/
  binaires de Grammalecte et Harper (~9 Mo / ~17 Mo) ne sont plus embarqués
  dans le plugin — un bouton dédié par langue dans les réglages les
  télécharge une seule fois depuis les releases publiques de
  [`Sargon01/feuillets-assets`](https://github.com/Sargon01/feuillets-assets),
  mis en cache sur disque ensuite. Chaque langue se télécharge
  indépendamment.
- **Gestion des mots appris / fautes ignorées** via une modale dédiée
  (filtre de recherche, suppression individuelle, tout effacer), à la place
  d'une liste illimitée directement dans les réglages. Ces données sont
  stockées à part (`resources/grammar-user-data.json`), plus dans
  `data.json`.

### Corrigé

- Le texte n'était jamais vérifié dans la langue réellement active : le
  code lisait un réglage inexistant (`settings.locale`) au lieu de la
  langue d'interface effective.

## 1.1.0

### Ajouté

- **Statuts entièrement personnalisables** (nom + couleur), au même titre
  que les labels — plus de liste figée ni de couleur déterminée par la
  position dans la liste. Migration automatique des anciens statuts
  personnalisés.
- **Première étape d'internationalisation : vocabulaire frontmatter en
  anglais.** Les clés YAML des fiches (scènes, personnages, lieux,
  sources…) passent en anglais — `title`, `short_title`, `subtitle`,
  `order`, `status`, `goal`, `summary`, `thread`, `characters`, `author`,
  `publisher`, `pace`, `role`, `end_date`, `birth`, `death`, `compile`.
  Les anciennes clés françaises (`titre`, `statut`, `ordre`, `resume`,
  `objectif`, `fil`, `personnages`, `auteur`, `rythme`, `editeur`/`edition`,
  `sous_titre`, `arc_secondaire`, `fonction`, `date_fin`, `naissance`,
  `mort`, `nom`, `prénom`, `compiler`) restent lues indéfiniment en repli
  sur toute fiche déjà écrite — **aucun fichier existant n'est réécrit de
  force.** Seules les nouvelles fiches et les nouvelles écritures (via
  l'éditeur, les menus, les imports Scrivener/plan) utilisent les clés
  anglaises. Concerne aussi les colonnes du Plan et le contenu affiché sur
  les tuiles (`resume`→`summary`, `compiler`→`compile` dans les réglages,
  migrés automatiquement).
- **Interface entièrement bilingue (français/anglais).** Nouveau mécanisme
  `src/i18n/` (dictionnaire plat `t(clé, paramètres)`, détection automatique
  de la langue d'Obsidian, réglage de substitution `language` —
  Automatique/Français/English). Traduction complète : tous les panneaux
  (Binder, Cartes/Plan, Notes, Propriétés, Recherche, Projet & export,
  Journal, Analyse, Révision .docx, Correcteur grammatical, Chercher et
  remplacer), l'intégralité de l'onglet Réglages, toutes les commandes et
  notifications de `main.js`, et toutes les modales (import Scrivener,
  mise en page/export, gestion de projets, comparaison de snapshots, etc.).
  Les identifiants internes (clés frontmatter, valeurs de réglages stockées,
  rôles de la page de titre) ne sont jamais traduits — seul le texte affiché
  à l'écran change avec la langue.
- **Deuxième étape d'internationalisation : noms de dossiers en anglais.**
  Les nouveaux projets créent désormais `Research` (Recherche), `Resources`
  (Ressources) et ses sous-dossiers `Assets`/`Layouts` (Visuels/Modèles), et
  les catégories de recherche `Characters`/`Places`/`Glossary`/`Events`/
  `Bibliography` (Personnages/Lieux/Glossaire/Événements/Bibliographie).
  Comme pour le frontmatter : **aucun dossier existant n'est renommé de
  force** — l'ancien nom français reste détecté indéfiniment (voir
  `getResourcesRoot`/`getResearchRoot` dans `services/folder-structure.js`
  et `services/research.js`, `LEGACY_RESEARCH_LABELS` dans
  `utils/project-modes.js`). `Front`, `Snapshots`, `Journal` (déjà
  configurable) et le sous-dossier `Templates` n'ont pas changé — déjà
  anglais ou déjà neutres.

### Corrigé

- `workspace.activeLeaf` (API dépréciée par Obsidian) retiré de
  `getActiveFileSafe` — remplacé par `getMostRecentLeaf()`.
- Description du manifeste en anglais (texte affiché dans le catalogue
  Community Plugins quelle que soit la langue de l'interface).
- Un statut personnalisé au-delà des 5 par défaut n'avait aucune couleur
  définie.

## 1.0.1

### Corrigé

- **Glisser-déposer vers un dossier vide** (ex. `Front`) : aucune cible de
  dépôt n'existait pour un dossier sans le moindre feuillet — ajout d'une
  zone de dépôt de secours sur le message "Aucun feuillet…".
- **Glisser-déposer entre enfants directs du même dossier** : déposer un
  feuillet sur un dossier frère (même parent, ex. tous deux à la racine du
  projet) ne faisait que réordonner les frères au lieu de déplacer le
  feuillet dedans.
- **Réorganisation de dossiers entre eux** (Cartes, Plan) : la correction
  précédente avait involontairement cassé le réordonnancement de deux
  dossiers frères (interprété comme un emboîtement) — limité désormais aux
  fichiers déposés sur un dossier.
- **Vue Plan (outline)** : les dossiers n'avaient ni repli/dépli, ni aucun
  écouteur de glisser-déposer.
- **Vue Cartes, mode "Tout le manuscrit"** : les en-têtes de dossier
  n'étaient pas repliables de façon fiable (pas de retour visuel) et pas
  du tout déplaçables.
- **Navigation clavier (flèches ↑/↓) dans le Binder** : ne fonctionnait pas
  après un simple clic sur une fiche (le focus quittait le Binder vers
  l'éditeur) ; ne faisait pas suivre le dossier sélectionné quand la fiche
  voisine appartenait à un autre dossier ; pouvait être intercepté par des
  plugins tiers basés sur React (ex. Notebook Navigator) qui posent leurs
  propres écouteurs en phase de capture.
- **Gestes de balayage trackpad** : le réglage annonçait "trackpad /
  tactile" mais seul le tactile (écran tactile) était réellement câblé —
  un trackpad n'envoie jamais d'événements tactiles. Ajout du support
  `wheel` pour trackpad, avec les mêmes soucis de priorité face aux
  plugins React que la navigation clavier, plus un bug de capture figée de
  `leftSplit`/`rightSplit` avant que la mise en page d'Obsidian soit prête
  (rendait le geste inopérant même une fois câblé).
- **Volet droit** : aucun geste ne l'ouvrait/fermait — seul le volet gauche
  (Binder) était géré. Ajout d'une bascule ouvert/fermé symétrique.
- **Dossier "vide" en apparence** : déplacer un feuillet dans un dossier
  qui finit par porter exactement le même nom que ce feuillet le
  transforme silencieusement en note de dossier (convention volontaire,
  voir `folder-notes.js`) — le feuillet n'apparaissait plus nulle part sans
  explication. Une notification prévient désormais explicitement.

### Modifié

- Seuil de déclenchement du geste trackpad abaissé pour une réaction plus
  rapide (moins de distance de glissement nécessaire).
