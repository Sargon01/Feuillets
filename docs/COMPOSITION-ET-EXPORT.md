# Composition et export

> **Français** · [English](COMPOSITION-AND-EXPORT.md) · [Index](README.md)

## Écrire n’est pas mettre en page

Feuillets sépare l’apparence confortable de l’éditeur de la composition du document destiné à être lu, imprimé ou envoyé.

## L’espace central Édition

En 2.5, **Édition** n’est plus un onglet du panneau droit. C’est une surface centrale qui travaille à côté du vrai **Aperçu**.

Deux modes seulement :

- **Composition** ;
- **Mise en page**.

L’export n’est plus un troisième onglet. La barre d’Édition regroupe : **Portée**, **Contenu**, **Format**, **Exporter** et **Actualiser l’Aperçu**.

## Composition

La page d’accueil de Composition résume le document :

### Manuscrit

- **Contenu du manuscrit** — ouvre la sélection/inclusion des feuillets ;
- **Variantes de contenu** — garde le document mais peut masquer certains rôles ;
- **Extractions de contenu** — conserve des sections entières contenant les rôles choisis ;
- **Collections de contenu** — rassemble les blocs portant les rôles choisis avec leur contexte de titres ;
- **Première page** — contenu et présentation ;
- **Pages liminaires**.

### Éléments générés

- sommaire ;
- table des matières ;
- tables.

### Fin d’ouvrage

- bibliographie ;
- annexes.

### Structure

- structure du manuscrit ;
- réglages liés aux notes de bas de page.

Les sous-pages reviennent à Composition sans ouvrir de nouvelle vue Obsidian.

## Rôles, variantes, extractions et collections

Les **rôles sémantiques** sont des annotations Markdown facultatives qui indiquent la fonction d’un passage — par exemple `definition`, `questions`, `solution`, `preuve`, `source`, `synthese` ou `recommandation`.

Ils ne remplacent ni les titres Markdown ni le texte ordinaire. Un projet peut ne jamais les utiliser.

Lorsqu’ils sont utiles, Composition peut créer :

- une **variante** : même document, certains rôles masqués ;
- une **extraction** : sections structurelles entières contenant certains rôles ;
- une **collection** : blocs portant certains rôles, avec leur contexte de titres.

Une variante peut se combiner avec une extraction ou une collection. Une extraction et une collection sont deux dérivations alternatives : on choisit l’une ou l’autre.

Voir [Rôles sémantiques](ROLES-SEMANTIQUES.md) et [Variantes, extractions et collections](VARIANTES-EXTRACTIONS-COLLECTIONS.md).

## Première page

Il n’existe qu’une seule entrée **Première page** dans Édition : **Composition → Première page**.

Elle réunit le contenu/inclusion et les exceptions de présentation propres à cette page. Elle utilise le même modèle de gabarit et la même miniature que le reste de la chaîne de mise en page.

## Mise en page

Les catégories sont :

- **Page** — format, orientation, marges, marges miroir, colonnes, gouttière, en-tête et pied ;
- **Corps de texte** — police, taille, interligne, alignement, retraits, espacements, césure, profil et typographie française à l’export ;
- **Titres** — styles des niveaux de titre, espacements et sauts de page ;
- **Citation** — citations, retraits, marges, couleur, italique et séparateur de scène.

Les contrôles qui n’ont pas de sens restent masqués : par exemple la gouttière avec une seule colonne ou les détails d’en-tête lorsque l’en-tête est désactivé.

## Gabarits V2

L’Aperçu et les exports partagent le même modèle de gabarit. Vous pouvez :

- utiliser les gabarits intégrés ;
- créer ou dupliquer un gabarit ;
- renommer/supprimer un gabarit personnalisé ;
- importer un style Ulysses ;
- importer un modèle Word `.docx` ou `.dotx` pour les propriétés représentables.

## Portée

Une composition peut viser :

- un feuillet ;
- un dossier et ses descendants ;
- une sélection de fichiers/dossiers ;
- le projet entier.

Le moteur évite les doublons lorsqu’un dossier et l’un de ses descendants sont tous deux sélectionnés.

## Export

La barre rapide suit quatre commandes : **Portée → Contenu → Format → Exporter**.

- **Portée** détermine les fichiers concernés : feuillet, dossier, sélection ou projet selon le contexte.
- **Contenu** choisit le document complet, une extraction ou une collection.
- **Format** choisit le format de sortie.
- **Exporter** lance l’opération avec les choix courants.

La portée utilise le même modèle `CompileScope` que le reste de la chaîne. Les menus rapides sont compacts et n’imposent pas de dupliquer les réglages dans le manuscrit.

Avant de lancer un export, Feuillets enregistre les modifications encore en attente de Continu, puis exporte depuis les vrais fichiers sources. Si ces écritures ne peuvent pas être sécurisées, l’export ne démarre pas. Il n’est pas nécessaire d’ouvrir l’Aperçu avant d’exporter.

## Nom du fichier de sortie

Le nom du manuscrit n’est plus un champ normal de l’interface Édition. Feuillets résout un nom à partir du contexte/preset et conserve les anciennes valeurs `compileFileName` pour compatibilité.

L’écriture de sortie gère également les collisions de casse sur macOS : un `Manuscrit.md` existant peut être mis à jour même si une ancienne préférence demande `manuscrit.md`.

## Aperçu

L’Aperçu est la référence visuelle avant export. Il utilise la même logique de composition, de gabarit et de pagination que le PDF lorsque ces notions sont applicables.

Il accepte une portée feuillet, dossier, sélection ou projet. Pour une grande portée, Feuillets peut afficher rapidement une première portion, puis finaliser le document complet ; le rendu définitif remplace alors l’aperçu provisoire. L’export reste toujours fondé sur la portée complète demandée, et l’Aperçu n’est jamais obligatoire pour exporter.

### Notes de bas de page paginées

Dans l’Aperçu paginé et le PDF, Feuillets rattache chaque définition de note à la page du **premier appel** correspondant. La hauteur des notes est mesurée et réservée pendant la pagination : le corps de texte dispose donc de moins de hauteur lorsque des notes sont présentes sur la page.

Les appels répétés restent visibles dans le texte mais ne réservent pas une seconde définition. Dans une composition multicolonne, le corps conserve ses colonnes tandis que la zone de notes occupe toute la largeur au-dessous. Le Markdown source et ses marqueurs `[^1]` ne sont pas réécrits.

Une note individuelle dont la hauteur dépasse à elle seule la hauteur utile d’une page n’est pas encore fragmentée sur plusieurs pages. Cette limite ne concerne pas les notes ordinaires ou multiparagraphes qui tiennent dans la zone disponible d’une page.

### Aperçu des citations Pandoc / Zotero

Les réglages du projet proposent un **Aperçu des citations Pandoc / Zotero** indépendant du système de citations interne de Feuillets. Deux modes sont disponibles :

- **Clés brutes** — aucun lissage ;
- **Auteur-date** — résolution à partir d’un fichier `.bib` dont le chemin est indiqué relativement à la racine du coffre.

Le mode auteur-date prend en charge les groupes simples commençant par une citekey, les localisateurs et plusieurs références séparées par un point-virgule. Par exemple :

- `[@smith2024]` → `(Smith, 2024)` ;
- `[@smith2024, p. 42]` → `(Smith, 2024, p. 42)` ;
- `[@smith2024; @doe2023]` → `(Smith, 2024; Doe & Brown, 2023)`.

Une citation inconnue ou un groupe qui ne peut pas être entièrement résolu reste brut. Les citations narratives non encadrées, les syntaxes de suppression d’auteur, les préfixes complexes, le code et les liens ne sont pas réécrits par cet aperçu.

Le lissage est appliqué uniquement au DOM de l’Aperçu, y compris aux citations présentes dans les notes de bas de page. Le Markdown source et les exports natifs Feuillets conservent toujours les citekeys originales. Il ne s’agit pas d’un moteur CSL complet : un flux Pandoc externe reste libre d’appliquer son propre style final. Le fichier `.bib` est relu lorsque sa date de modification change.

## Formats

- **Markdown compilé** — assemblage Markdown local ;
- **DOCX** — styles Word éditables ;
- **EPUB** — texte reflowable ;
- **ODT** — OpenDocument ;
- **PDF** — desktop, via le document paginé puis la boîte d’impression système.

Le Markdown source n’est jamais remplacé par l’artefact exporté. Lorsqu’une extraction ou une collection est sélectionnée, l’export Markdown reste volontairement un export de la source ; les dérivations s’appliquent aux formats documentaires.

Pour un parcours guidé, voir [Tutoriel — publier plusieurs documents depuis une seule source](TUTORIEL-PUBLICATION-SEMANTIQUE.md).
