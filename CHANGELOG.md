# Changelog

Toutes les évolutions notables du plugin sont consignées ici.

## 1.2.7

### Corrigé

- 140 des erreurs « Uses Obsidian APIs newer than the declared
  `minAppVersion` » du tableau de bord tenaient toutes à une seule chose :
  Obsidian 1.13.0 a documenté `Plugin.settings?: unknown` dans son API, et
  l'analyseur résolvait chaque `this.settings` du plugin vers ce membre
  marqué `@since 1.13.0`. Aucune incompatibilité réelle — c'est une
  déclaration de type, sans effet à l'exécution, et y affecter les réglages
  est précisément l'usage documenté (une simple propriété d'instance sur
  les versions antérieures). `FeuilletsPlugin` déclare désormais
  explicitement sa propriété `settings` typée, comme le demande la doc
  d'Obsidian. `minAppVersion` reste donc à 1.7.2 : rien ne justifiait
  d'exclure les utilisateurs des versions 1.7.2 à 1.12.x.

## 1.2.6

### Corrigé

- **Vraie cause, enfin identifiée, des échecs à répétition du contrôle
  « Source code » du tableau de bord d'Obsidian** — reproduite localement
  en installant leur propre outil (`eslint-plugin-obsidianmd`) : leur
  règle `obsidianmd/no-sample-code` plante avec un `TypeError` sur
  `window.setInterval(() => f(), …)`. Elle lit
  `callback.body.callee?.property.type` sans `?.` sur `property`, qui vaut
  `undefined` dès que la fonction fléchée appelle un identifiant simple.
  Ce plantage interrompait toute l'analyse — d'où le message d'erreur
  générique, sans jamais aucun fichier ni ligne cité. `registerAutoBackup`
  passe désormais `tick` par référence (strictement équivalent, et forme
  plus idiomatique) au lieu de l'envelopper dans une fonction fléchée.
- Retiré `.eslintignore` (format hérité, désormais redondant avec
  `ignores` dans `eslint.config.mjs` — il déclenchait un avertissement de
  dépréciation à chaque analyse) et `.eslintrc.json` (ajouté en 1.2.3 sur
  l'hypothèse, désormais réfutée, d'un scanner sous ESLint 8 ; le support
  d'eslintrc a de toute façon été supprimé dans ESLint 10). La
  configuration flat `eslint.config.mjs` est la seule source de vérité.

## 1.2.5

### Corrigé

- Cause probable, enfin trouvée, des échecs répétés du contrôle « Source
  code » du scanner d'Obsidian : `eslint.config.mjs` importait le paquet
  npm `globals`. Si le scanner clone le dépôt et lance ESLint sans lancer
  `npm install` au préalable, cet `import` échoue au chargement même de la
  configuration (`ERR_MODULE_NOT_FOUND`) — avant d'avoir ouvert le moindre
  fichier source, ce qui correspond exactement à l'erreur générique et
  sans fichier/ligne observée à chaque fois. Remplacé par une liste de
  globals écrite à la main (aucune dépendance externe dans la config
  ESLint désormais) ; `no-undef` passé de `error` à `warn` puisque cette
  liste manuelle est nécessairement moins exhaustive que celle du paquet.
  Dépendance `globals` retirée de `package.json`.

## 1.2.4

### Corrigé

- Retiré `/Candide - Voltaire/` du suivi git (reste sur le disque local,
  mais ne doit jamais avoir été commité) — un vault de test/démo, pas du
  code du plugin.
- Réconcilié la configuration ESLint : `eslint.config.mjs` (paquet
  `globals`, couvre aussi `scripts/`/`test/`/`esbuild.config.mjs`) est
  désormais la seule config flat active — `eslint.config.js` supprimé pour
  éviter que les deux coexistent silencieusement. `.eslintrc.json` a
  retrouvé son `root: true`. Le script `lint` lance maintenant vraiment
  ESLint (il ne relançait que la vérification de types).

## 1.2.3

### Corrigé

- Ajout de `.eslintrc.json` en plus de `eslint.config.js` : le scanner
  d'analyse statique d'Obsidian semble utiliser une version d'ESLint
  antérieure à la 9 (qui ne cherche que `.eslintrc.*`, pas le format flat
  config `eslint.config.js` introduit en v9) — vérifié localement avec
  ESLint 8 et 10, les deux trouvent maintenant une configuration valide.

## 1.2.2

### Corrigé

- Retiré une branche de code morte (jamais atteinte dans Electron) présente
  dans `docx` et `jszip` : un vieux polyfill IE6-8 créait un élément
  `<script>` vide uniquement pour exploiter son événement
  `onreadystatechange` comme astuce de minuterie — jamais de `src` assigné,
  aucun chargement de code externe. Patché via un script `postinstall`
  (`scripts/patch-script-polyfills.mjs`) pour ne plus déclencher les
  scanners de sécurité qui détectent la création dynamique de `<script>`
  sans distinguer ce cas mort du vrai risque.
- CI/CD : ajout de workflows GitHub Actions (build + tests sur chaque push,
  build + tests + attestations de provenance + release automatique sur
  chaque tag).

## 1.2.1

### Corrigé

- `minAppVersion` relevé de 1.4.0 à 1.7.2 : plusieurs propriétés CSS déjà
  utilisées (`scrollbar-width`, `:has()`, `text-decoration-color`) sont
  plus récentes que le Chromium embarqué dans Obsidian 1.4.x — le déclarer
  correctement évite un rendu dégradé chez qui serait resté sur une
  version aussi ancienne, plutôt que de réécrire ces règles.
- Ajout de `eslint.config.js` (ESLint 9+ refuse de tourner sans fichier de
  configuration présent).

## 1.2.0

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
- **Nouvel onglet de réglages « Interface »** — regroupe Apparence (langue
  de l'interface, taille de police, échelle, hauteur de ligne, largeur de
  texte, police, couleur d'accent), Mode concentration, et une nouvelle
  section **Interface épurée** : masquer les propriétés (YAML)/le titre du
  feuillet/la barre d'onglet/le ruban entier/le sélecteur de coffre, fonds
  transparents (panneaux latéraux et bande d'onglets), estomper les icônes
  d'action des onglets et les onglets latéraux non actifs. Un bouton
  « Valeurs suggérées » pré-remplit ces réglages sans rien masquer ni
  verrouiller. La plupart de ce qui nécessitait un thème/des plugins tiers
  (voir [`SETUP-INTERFACE.md`](./SETUP-INTERFACE.md)) est donc désormais
  natif.
- Onglets de réglages réorganisés : Numérotation en position 2 dans Projet
  (juste après Dossier & Gestion des projets), Tags favoris déplacés vers
  Projet (avec Statuts & Labels), Correction grammaticale et
  Tableau/Panneaux latéraux fusionnés/renommés en onglets propres
  (« Correcteur », « Panneaux »).
- En-tête des réglages : titre agrandi, slogan, liens GitHub/README/
  Fonctionnalités.

### Corrigé

- Le texte n'était jamais vérifié dans la langue réellement active : le
  code lisait un réglage inexistant (`settings.locale`) au lieu de la
  langue d'interface effective.
- L'en-tête des réglages (titre/slogan/liens) et la langue d'interface
  étaient aspirés dans l'onglet « Projet » au lieu de rester fixes
  au-dessus de la barre d'onglets.
- Trois interrupteurs « révélé(e) au survol » (bande d'onglets, ruban,
  binder) ont été essayés puis retirés : trop instables (chevauchement
  avec les boutons de fenêtre macOS, survol peu fiable) et redondants avec
  les gestes tactiles déjà en place pour le binder.

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
