# Feuillets — le parcours d'un auteur, du premier mot à l'export

Pas un audit, pas de notes sur 10 : ce document suit un auteur qui démarre un projet dans Feuillets et le mène jusqu'à l'export final, dans l'ordre où les choses se présentent réellement. Pour la liste exhaustive des réglages, voir `FONCTIONNALITES.md` — ici, l'objectif est de savoir **quoi faire, dans quel panneau, et pourquoi**.

---

## 0. Créer le projet

Depuis l'écran d'accueil du Binder (aucun projet actif) ou "Gérer les
projets…", trois voies existent :

- **"Créer un projet"** — nom du projet, auteur (facultatif), dossier
  parent (facultatif), type. Un seul clic crée `Nom du projet/` avec :
  `Manuscrit/Front/Page de titre.md` (préremplie avec le titre et
  l'auteur), un premier chapitre déjà prêt à écrire, `Recherche/` et
  `Ressources/` — puis ouvre directement ce premier feuillet, curseur en
  position d'écrire. `Snapshots` et `Journal` ne sont pas créés tout de
  suite : ils apparaissent tout seuls dès leur premier usage réel (premier
  instantané, premier jour de journal).
- **"Ouvrir un dossier existant"** — pour reprendre un manuscrit déjà
  commencé ailleurs (avec ou sans frontmatter) : rien n'y est déplacé,
  renommé ni modifié, seule la référence du projet actif change.
- **"Découvrir avec un projet de démonstration"** — un projet d'exemple
  déjà rempli, pour explorer les fonctions sans écrire une ligne.

Deux **types de projet** existent, choisis une fois à la création :

- **Fiction** — vocabulaire "scène/partie/chapitre", bible narrative
  "Personnages/Lieux/Lore", mode Cartes par défaut. Le premier chapitre est
  créé directement sous `Manuscrit/` (`Chapitre 1/Scène 1.md`).
- **Non-fiction** — vocabulaire "section/chapitre", bible narrative
  "Acteurs/Géographie/Concepts/Sources", mode Plan par défaut. Le premier
  chapitre est un fichier à l'intérieur d'une partie
  (`Partie 1/Chapitre 1.md`).

Le type ne change ni les dossiers ni les champs frontmatter lus — seulement
l'habillage affiché et les réglages de départ. Il ne se réapplique jamais
tout seul ensuite : les réglages ajustés par l'auteur ne sont jamais écrasés.

**Racine du projet et racine du manuscrit.** `Nom du projet/` est la racine
réelle — elle contient `Manuscrit/`, `Recherche/` et `Ressources/` en
frères. Le Binder, les Cartes, le Plan et la compilation, eux, ne
travaillent que dans `Manuscrit/` : Recherche, Ressources, Journal et
Snapshots n'apparaissent jamais mêlés à la structure narrative, seulement
via leurs propres sections ou commandes.

**"Initialiser la structure du projet"** (commande) complète à tout moment
un projet déjà créé avec le reste : sous-dossiers de `Recherche` selon le
type, `Snapshots`, `Ressources/Template` rempli de gabarits de fiches à
dupliquer, `Journal`.

**Rien de tout cela n'est obligatoire.** Un dossier Markdown ordinaire,
avec ou sans frontmatter, fonctionne dans Feuillets — les métadonnées YAML
et les dossiers conventionnels (`Recherche`, `Ressources`…) sont des
compléments qui enrichissent le Binder, la recherche de contexte, les
snapshots et la compilation, jamais des conditions pour écrire.

### Importer un plan ou un projet déjà commencé ailleurs

Si l'auteur a déjà un plan en tête (dans un carnet, un fichier texte, une
autre appli), il n'a pas besoin de créer chaque dossier/scène à la main :
le binder propose **"Importer un plan…"**, qui colle du Markdown structuré et
le transforme directement en arborescence :

```
# Partie 1
## Chapitre 1
- Scène 1
- Scène 2
## Chapitre 2
- Scène 3
# Partie 2
- Chapitre 3
```

Chaque `#`/`##` devient un dossier (au niveau de titre correspondant), chaque tiret devient un fichier `.md` de scène. Toute une structure de roman peut être posée en un seul copier-coller, avant même d'avoir écrit un mot de texte.

Si l'auteur vient de **Scrivener**, la commande "Importer un projet
Scrivener…" convertit directement un fichier `.scriv` en arborescence
Feuillets (bureau uniquement — l'import nécessite un accès au système de
fichiers, indisponible sur mobile).

---

## 1. Construire l'arborescence : le binder

Le binder (barre latérale gauche) est la colonne vertébrale du manuscrit —
c'est là que vit la hiérarchie Partie → Chapitre → Scène.

Par défaut, il s'affiche en **double volet façon Ulysses** : dossiers à
gauche, feuillets du dossier sélectionné à droite. Un seul bouton fait
cycler 4 façons de le voir : double volet complet → dossiers seuls →
fichiers seuls → vue arbre classique (tout empilé) → retour au double volet.
Chaque volet a son propre "+" contextuel : celui de gauche crée un
sous-dossier, celui de droite crée un feuillet dans le dossier sélectionné.

L'auteur glisse-dépose feuillets et dossiers pour réorganiser à la volée
(un "annuler le dernier déplacement" existe en filet de sécurité). Les
numéros de chapitres se renumérotent tout seuls à chaque déplacement.

Pour retrouver un feuillet précis : recherche par titre ou par contenu du
texte, filtres combinés par statut/label/progression, et un menu d'options d'affichage (pastilles de tags/statut, anneaux de progression, aperçu du contenu sous chaque titre — extrait, synopsis, résumé, notes ou tags, au choix).

---

## 2. Écrire

L'auteur ouvre un feuillet, l'éditeur Obsidian classique s'affiche —
Feuillets n'invente pas un nouvel éditeur, il l'enrichit :

- **Typographie française à la frappe** : guillemets droits → « », tirets
  `--`/`---` → – / — avec espaces insécables, apostrophe → ’, tout
  automatique et désactivable au besoin.
- **Alinéas automatiques** en début de paragraphe.
- **Mode concentration** (icône focus, binder ou ruban) : plein écran
  d'écriture, colonne de largeur réglable, estompage du texte hors focus
  (ligne ou paragraphe), compteur de mots flottant, ligne du curseur
  maintenue centrée. Échap pour sortir.
- **Chercher/remplacer** dans tout le manuscrit — une barre dédiée,
  distincte de la recherche native d'Obsidian, avec surlignage des
  correspondances directement dans l'éditeur.
- **Notes de bas de page et citations** — insertion en un raccourci
  (numérotation automatique, renumérotation d'un coup si l'ordre change),
  et insertion d'une citation formatée à partir d'une fiche Bibliographie
  du panneau Recherche.
- **Outils de nettoyage ponctuels** — réparer des séparateurs de scène
  échappés (copiés depuis un autre éditeur), compacter des lignes vides en
  sauts simples, ou éclater un document de chronologie en fiches
  individuelles datées.

Chaque feuillet porte un frontmatter avec titre, titre court, statut,
label, objectif de mots, synopsis/résumé, tags — posé automatiquement à la création via "Nouveau feuillet".

---

## 3. Documenter à côté du texte : le panneau Notes

Pendant qu'il écrit une scène, l'auteur garde le panneau Notes ouvert à
droite — tout ce qui ne sera **jamais compilé ni compté** dans le manuscrit final vit ici :

- **Synopsis / Résumé / Notes de travail / Sources** — champs éditables en un clic (clique sur le texte, une zone d'édition apparaît), repliables et réordonnables selon la préférence de l'auteur.
- **Contexte** — dès qu'un personnage ou un lieu de la fiche Recherche est cité dans le texte (par lien `[[...]]` ou simplement par son nom), il apparaît ici automatiquement, avec son âge à la date de la scène si elle est connue. Mieux : si la fiche du personnage ou du lieu contient elle-même une petite chronologie sous forme de lignes datées (`1990 : marié à Clara`, `2005 : blessé à la guerre`…), Feuillets retrouve la ligne la plus récente antérieure à la date de la scène et l'affiche comme état actuel — aucune fiche "à jour" à maintenir à la main, la chronologie écrite une fois dans la fiche suffit pour toutes les scènes qui la citent.
- **Notes de dossier** — pastilles cliquables vers les notes de la Partie
  et du Chapitre englobant la scène (une note par dossier, pour les
  intentions générales d'un chapitre entier).
- **Plan** — tous les titres `#` à `######` du feuillet ouvert, cliquables
  pour sauter directement au bon endroit dans l'éditeur (remplace le
  panneau natif "Plan" d'Obsidian, en restant scopé au même fichier).

---

## 4. Nourrir la bible narrative : le panneau Recherche

Avant, pendant ou après avoir écrit une scène, l'auteur crée des fiches
dans le panneau Recherche : Personnages, Lieux, Lore, Bibliographie,
Glossaire, Événements (vocabulaire adapté si le projet est en mode
non-fiction). Chaque fiche a son propre gabarit de frontmatter, dupliquable
depuis `Ressources/Template`.

Une recherche texte et un filtre par tag permettent de retrouver une fiche
précise sans quitter le panneau. C'est ce panneau qui alimente ensuite la
section "Contexte" du panneau Notes (§3), sans travail supplémentaire.

En consultant une fiche (biographie d'un personnage, description d'un lieu,
entrée de bibliographie…), l'auteur peut sélectionner un passage puis
l'insérer directement dans la scène en cours d'écriture d'un clic, sans
copier-coller manuel : en lien `[[...]]` simple, en extrait cité (guillemets
+ mise en forme), ou en extrait cité avec sa source rattachée (pratique
pour ne jamais perdre la référence d'une citation de recherche prise dans
une fiche Bibliographie).

Si le projet regroupe de la recherche accumulée avant l'arrivée de Feuillets
(anciens dossiers `_Personnages`, `_Lieux`, `_Chronologie`), la commande
"Regrouper la recherche dans _Recherche" migre tout ça en un coup, liens mis
à jour automatiquement.

---

## 5. Visualiser et organiser l'intrigue : le Tableau / plan

Le panneau central est où l'auteur prend du recul sur la structure entière,
avec 5 façons de la regarder (masquables si inutilisées) :

- **Cartes** — tuiles visuelles, une par scène, en grille.
- **Plan** — tableau à colonnes configurables (synopsis, statut, tags,
  mots, objectif, progression…), pour une vue dense façon tableur.
- **Chemin de fer** — un vrai tableau Canvas natif Obsidian, cartes
  colorées par label, colonnes par **fil narratif** (`fil:` dans le
  frontmatter — un fil planté dans une scène et refermé plus tard est
  suivi automatiquement, sans ressaisie).
- **Chronologie** — les scènes datées (et les jalons historiques de
  Recherche/Chronologie), en ordre chronologique ou dans l'ordre du
  manuscrit (pour repérer les retours en arrière), filtrable par tag.
- **Lecture** — flux continu de lecture, sur tout le manuscrit, un dossier, ou une sélection de scènes choisies à la main.

Les mêmes filtres (statut/label/progression) et la sélection multiple
(fusionner/dupliquer/déplacer plusieurs scènes d'un coup) sont disponibles dans tous les modes qui listent des scènes.

**Fusionner** plusieurs scènes ne se contente pas de recoller les textes :
un preset de fusion (Roman/Nouvelle/Scénario/Minimal, ou personnalisé)
décide, champ de frontmatter par champ, s'il garde la valeur de la scène
cible, additionne les valeurs (tags, notes), ne prend que la première
rencontrée (statut, objectif…), ou ignore le champ (synopsis, résumé) —
aucune propriété n'est perdue en silence, et rien à ressaisir après coup.
**Scinder** une scène (à partir du curseur ou d'une sélection de texte)
fait l'inverse : la nouvelle scène hérite de tout le frontmatter de
l'originale (personnages liés, date, tags…), seuls le titre et l'ordre
changeant automatiquement — remise à vide du synopsis/résumé/notes et
transfert du statut de compilation étant chacun réglables si l'auteur
préfère un autre comportement par défaut.

---

## 6. Garder le contrôle des métadonnées : le panneau Propriétés

À tout moment, l'auteur peut ouvrir le panneau Propriétés pour :

- **éditer les propriétés du feuillet ouvert** directement (texte, case à
  cocher, sélecteur de date, éditeur à jetons pour les listes) — utile
  surtout si le bloc propriétés natif d'Obsidian est masqué dans la note ;
- **voir toutes les propriétés utilisées dans le projet** (pas tout le
  coffre) — clé → valeurs distinctes → fichiers concernés, avec un "+"
  pour ajouter une propriété existante au fichier ouvert, ou une
  suppression en masse (avec confirmation) si une propriété doit
  disparaître de tout le projet ;
- **parcourir les tags du projet** de la même façon, avec un champ de
  recherche.

---

## 7. Suivre sa progression

Deux panneaux complémentaires, pour deux échelles de temps différentes :

- **Statistiques** — objectif de mots (scène active et projet entier),
  compteurs détaillés (caractères, phrases, mots/phrase, paragraphes,
  pages, temps de lecture), et un petit historique des 14 derniers jours
  écrits.
- **Journal d'écriture** — un calendrier mensuel, un point sur chaque jour où l'auteur a écrit, une entrée de journal par jour (créée à la volée), et une commande pour compiler tout le journal en un seul document.

---

## 8. Relire et corriger avant l'export

Avant de figer un manuscrit, deux outils aident à la relecture :

- **Correction grammaticale (Grammalecte)** — l'auteur lance la vérification
  sur le feuillet actif (le panneau latéral Feuillets doit être ouvert, sur
  n'importe quel onglet), les fautes détectées sont soulignées directement
  dans l'éditeur, et deux commandes permettent de sauter d'une faute à la
  suivante ou à la précédente sans quitter le clavier. Fonctionne
  entièrement en local, aucune donnée n'est envoyée où que ce soit — mais
  uniquement sur ordinateur, la vérification n'est pas disponible sur
  mobile.
- **Panneau Révision** — si un directeur littéraire ou un correcteur externe
  a renvoyé ses remarques dans un fichier `.docx` annoté, ce panneau dédié
  permet de les parcourir et de les intégrer sans quitter Obsidian.

---

## 9. Plusieurs manuscrits en parallèle : le panneau Projet & export

Un auteur qui mène plusieurs projets (plusieurs romans, un roman + ses
notes de recherche séparées…) les enregistre tous, et bascule de l'un à
l'autre depuis ce panneau — un clic change le projet actif partout dans le
plugin (binder, Tableau, Notes, Recherche…). C'est aussi ici que vit tout
ce qui suit :

---

## 10. Compiler et exporter

Le moment où le manuscrit doit sortir d'Obsidian.

1. **Compiler** — assemble tous les feuillets du projet en un seul texte,
   dans l'ordre du binder. Un **preset** (nommé, réutilisable) contrôle le séparateur entre scènes et si les titres de parties/chapitres/scènes
   sont insérés. Possibilité de choisir manuellement les feuillets à
   inclure (compilation partielle) plutôt que tout le projet. Pour exclure
   un feuillet précis en permanence (une note personnelle, un brouillon mis
   de côté), le champ `compile: false` dans son frontmatter le retire de
   toute compilation, sans le sortir du Binder ni du décompte de mots.
2. **Choisir un modèle de mise en page** — 7 modèles intégrés (Classique,
   Moderne, Machine à écrire, Roman simple, Roman français paysage 2
   colonnes, APA, Thèse), ou un modèle personnalisé de l'auteur (fichier
   `.md` avec frontmatter dans `Ressources/Layout`, dupliqué depuis un modèle intégré exporté comme point de départ).
3. **Exporter** — .docx (Word, avec vraies notes de bas de page, images légendées, tableaux), .epub (EPUB3 valide), ou .pdf (via l'impression, bureau uniquement). Tout ça fonctionne **sans rien installer**, y compris sur mobile. La typographie française (guillemets, espaces insécables) est appliquée automatiquement au texte compilé, même si l'auteur n'a pas tapé avec la typographie assistée activée.
4. **Pandoc en option avancée** — pour l'auteur qui a déjà Pandoc installé et veut sa propre qualité typographique poussée (bureau uniquement).

---

## 11. Se protéger contre les accidents

Avant une modification importante, ou simplement par prudence régulière :

- **Snapshot du feuillet actif** ou **snapshot du projet complet** (copie
  datée de tous les feuillets en une seule commande) — l'auteur restaure
  ensuite n'importe quel snapshot depuis un menu listant les 15 versions
  les plus récentes d'un feuillet.
- **Sauvegarder les réglages du plugin** — exporte toute la configuration
  Feuillets dans un fichier `.json` horodaté, restaurable plus tard (utile
  en changeant d'ordinateur, ou avant d'expérimenter avec les réglages
  avancés).
- **Dupliquer comme nouvelle version** — avant une réécriture importante
  (changer une fin, retravailler tout un arc), plutôt qu'un snapshot par
  scène : clic droit sur la racine du manuscrit dans le Binder (ou icône
  dédiée dans "Gérer les projets", ou palette de commandes) → "Dupliquer
  comme nouvelle version…". Une copie complète du manuscrit (Recherche
  reste partagée entre les deux) se fige sous un nom clair — v1, "avant
  réécriture"… L'original continue d'être modifié normalement ; la copie
  reste consultable et comparable à tout moment via "Comparer avec un autre
  feuillet…" sur un feuillet donné.

---

## 12. Régler l'interface à son goût

Une fois le workflow pris en main, l'auteur peut :

- masquer les modes du Tableau ou les panneaux latéraux qu'il n'utilise
  jamais, y compris le panneau Révision (icône de ruban et commande
  retirées, réactivable à tout moment) ;
- choisir quels panneaux s'ouvrent automatiquement au démarrage d'Obsidian ;
- ajuster taille de police, échelle de l'interface, largeurs de colonnes ;
- personnaliser les labels de couleur (6 par défaut, renommables,
  recolorables, par projet).

---

*Pour le détail de chaque réglage cité ici, voir `FONCTIONNALITES.md`.*
