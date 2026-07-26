# Changelog

Toutes les évolutions notables du plugin sont consignées ici.

## Non publié

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
