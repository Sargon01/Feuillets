# Composition et export

> **Français** · [English](COMPOSITION-AND-EXPORT.md) · [Index](README.md)

## Écrire n’est pas mettre en page

Feuillets sépare l’apparence confortable de l’éditeur de la composition du document destiné à être lu, imprimé ou envoyé.

## L’espace central Édition

En 2.5, **Édition** n’est plus un onglet du panneau droit. C’est une surface centrale qui travaille à côté du vrai **Aperçu**.

Deux modes seulement :

- **Composition** ;
- **Mise en page**.

L’export n’est plus un troisième onglet. La barre d’Édition conserve en permanence : **portée**, **format**, **Exporter** et **Actualiser l’Aperçu**.

## Composition

La page d’accueil de Composition résume le document :

### Manuscrit

- **Contenu du manuscrit** — ouvre la sélection/inclusion des feuillets ;
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

L’export se lance depuis la barre persistante d’Édition ou depuis les commandes d’export. La portée utilise le même modèle `CompileScope` que le reste de la chaîne : feuillet, dossier, sélection ou projet.

Avant de lancer un export, Feuillets enregistre les modifications encore en attente de Continu, puis exporte depuis les vrais fichiers sources. Si ces écritures ne peuvent pas être sécurisées, l’export ne démarre pas. Il n’est pas nécessaire d’ouvrir l’Aperçu avant d’exporter.

## Nom du fichier de sortie

Le nom du manuscrit n’est plus un champ normal de l’interface Édition. Feuillets résout un nom à partir du contexte/preset et conserve les anciennes valeurs `compileFileName` pour compatibilité.

L’écriture de sortie gère également les collisions de casse sur macOS : un `Manuscrit.md` existant peut être mis à jour même si une ancienne préférence demande `manuscrit.md`.

## Aperçu

L’Aperçu est la référence visuelle avant export. Il utilise la même logique de composition, de gabarit et de pagination que le PDF lorsque ces notions sont applicables.

Il accepte une portée feuillet, dossier, sélection ou projet. Pour une grande portée, Feuillets peut afficher rapidement une première portion, puis finaliser le document complet ; le rendu définitif remplace alors l’aperçu provisoire. L’export reste toujours fondé sur la portée complète demandée, et l’Aperçu n’est jamais obligatoire pour exporter.

## Formats

- **Markdown compilé** — assemblage Markdown local ;
- **DOCX** — styles Word éditables ;
- **EPUB** — texte reflowable ;
- **ODT** — OpenDocument ;
- **PDF** — desktop, via le document paginé puis la boîte d’impression système.

Le Markdown source n’est jamais remplacé par l’artefact exporté.
