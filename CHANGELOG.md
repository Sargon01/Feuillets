# Changelog

Toutes les évolutions notables du plugin sont consignées ici.

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
