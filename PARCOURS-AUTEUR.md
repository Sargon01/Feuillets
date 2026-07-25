# Feuillets — le parcours d'un auteur, du premier mot à l'export

Pas un audit, pas de notes sur 10 : ce document suit un auteur qui démarre un projet dans Feuillets et le mène jusqu'à l'export final, dans l'ordre où les choses se présentent réellement. Pour la liste exhaustive des réglages, voir `FONCTIONNALITES.md` — ici, l'objectif est de savoir **quoi faire, dans quel panneau, et pourquoi**.

---

## 0. Avant d'écrire une ligne : choisir un dossier et un mode

Dans Réglages → Feuillets, l'auteur pointe un dossier du coffre comme
"Dossier du projet". Ce dossier peut déjà exister (un manuscrit en cours) ou être vide (nouveau projet).

Deux **modes de projet** existent, choisis une fois :

- **Fiction** — vocabulaire "scène/partie/chapitre", bible narrative
  "Personnages/Lieux/Lore", mode Cartes par défaut.
- **Non-fiction** — vocabulaire "section/chapitre", bible narrative
  "Acteurs/Géographie/Concepts/Sources", mode Plan par défaut.

Le mode ne change ni les dossiers ni les champs frontmatter lus — seulement
l'habillage affiché et les réglages de départ. Il ne se réapplique jamais
tout seul ensuite : les réglages ajustés par l'auteur ne sont jamais écrasés.

**"Initialiser la structure du projet"** (commande, ou automatique à la
première ouverture) crée alors : `Recherche` (avec ses sous-dossiers selon
le mode), `Snapshots`, `Ressources` (Templates, Export, Visuels, Modèles),
`Journal`, et des gabarits de fiches prêts à dupliquer dans
`Ressources/Templates`.

### Importer un plan déjà écrit ailleurs

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
  `--`/`---` → – / — avec espaces insécables, apostrophe → ', tout
  automatique et désactivable au besoin.
- **Alinéas automatiques** en début de paragraphe.
- **Mode concentration** (icône focus, binder ou ruban) : plein écran
  d'écriture, colonne de largeur réglable, estompage du texte hors focus
  (ligne ou paragraphe), compteur de mots flottant, ligne du curseur
  maintenue centrée. Échap pour sortir.

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
depuis `Ressources/Templates`.

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

## 8. Plusieurs manuscrits en parallèle : le panneau Projet & export

Un auteur qui mène plusieurs projets (plusieurs romans, un roman + ses
notes de recherche séparées…) les enregistre tous, et bascule de l'un à
l'autre depuis ce panneau — un clic change le projet actif partout dans le
plugin (binder, Tableau, Notes, Recherche…). C'est aussi ici que vit tout
ce qui suit :

---

## 9. Compiler et exporter

Le moment où le manuscrit doit sortir d'Obsidian.

1. **Compiler** — assemble tous les feuillets du projet en un seul texte,
   dans l'ordre du binder. Un **preset** (nommé, réutilisable) contrôle le séparateur entre scènes et si les titres de parties/chapitres/scènes
   sont insérés. Possibilité de choisir manuellement les feuillets à
   inclure plutôt que tout le projet.
2. **Choisir un modèle de mise en page** — 7 modèles intégrés (Classique,
   Moderne, Machine à écrire, Roman simple, Roman français paysage 2
   colonnes, APA, Thèse), ou un modèle personnalisé de l'auteur (fichier
   `.md` avec frontmatter dans `Ressources/Modèles`, dupliqué depuis un modèle intégré exporté comme point de départ).
3. **Exporter** — .docx (Word, avec vraies notes de bas de page, images légendées, tableaux), .epub (EPUB3 valide), ou .pdf (via l'impression, bureau uniquement). Tout ça fonctionne **sans rien installer**, y compris sur mobile. La typographie française (guillemets, espaces insécables) est appliquée automatiquement au texte compilé, même si l'auteur n'a pas tapé avec la typographie assistée activée.
4. **Pandoc en option avancée** — pour l'auteur qui a déjà Pandoc installé et veut sa propre qualité typographique poussée (bureau uniquement).

---

## 10. Régler l'interface à son goût

Une fois le workflow pris en main, l'auteur peut :

- masquer les modes du Tableau ou les panneaux latéraux qu'il n'utilise
  jamais (icône de ruban et commande retirées, réactivable à tout moment) ;
- choisir quels panneaux s'ouvrent automatiquement au démarrage d'Obsidian ;
- ajuster taille de police, échelle de l'interface, largeurs de colonnes ;
- personnaliser les labels de couleur (6 par défaut, renommables,
  recolorables, par projet).

---

*Pour le détail de chaque réglage cité ici, voir `FONCTIONNALITES.md`.*
