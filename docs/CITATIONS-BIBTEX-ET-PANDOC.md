# Citations BibTeX et paquet Pandoc

> [English](BIBTEX-CITATIONS-AND-PANDOC.md) · Français · [Index](README.md)

Feuillets conserve les citations universitaires dans du Markdown ordinaire. Il aide à retrouver les références pendant l’écriture, mais n’intègre ni n’exécute Zotero, Better BibTeX, Pandoc ou un moteur CSL.

## Préparer un espace de travail

1. Associez un dossier Recherche à l’espace ou au feuillet qui doit posséder ses propres références.
2. Placez dans ce dossier Recherche une exportation Better BibTeX, par exemple `references.bib`.
3. Vous pouvez y placer également un unique style CSL.
4. Ouvrez les réglages de l’espace de ce dossier et choisissez ses ressources bibliographiques et CSL dans **Citations et bibliographie**.

Le feuillet actif résout d’abord son association directe, puis les dossiers associés sur son chemin physique vers le projet. Une autre branche du Classeur n’est jamais parcourue.

## Citer pendant l’écriture

Tapez `[@` dans un feuillet Markdown pour ouvrir le sélecteur. Recherchez par citekey, auteur, titre ou année ; choisissez une ou plusieurs références et ajoutez au besoin un localisateur de page. Feuillets écrit la syntaxe Pandoc ordinaire :

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
```

Les citekeys restent dans le Markdown source. Une clé inconnue n’est jamais supprimée silencieusement.

## Aperçu, bibliographie et exports natifs

L’Aperçu peut afficher les citations résolues en auteur-date tout en préservant le source. Le panneau Recherche liste les entrées BibTeX citées et signale les clés inconnues. Feuillets peut générer une bibliographie Markdown simple à partir des citations de la portée choisie.

Les exports Markdown, DOCX, EPUB, ODT et PDF natifs conservent les citekeys brutes. Ils conviennent lorsque l’établissement n’impose pas un style de citation particulier.

## Utiliser un paquet Pandoc pour un style CSL final

Choisissez **Paquet Pandoc (.zip)** dans l’export Édition lorsque le document final doit respecter le style CSL d’une université, d’un éditeur ou d’une revue.

L’archive contient :

- `manuscript.md`, compilé depuis la portée Feuillets choisie ;
- `pandoc.yaml`, fichier de réglages Pandoc portable ;
- les seuls fichiers `.bib` nécessaires aux citekeys de cette portée ;
- le CSL applicable, lorsqu’il est configuré ;
- les images locales copiées sous `media/` ;
- `citation-report.json` uniquement si Feuillets rencontre des clés inconnues ou des médias manquants.

Feuillets n’installe, ne recherche et ne lance jamais Pandoc. Décompressez le paquet puis traitez-le avec votre propre flux Pandoc. Lorsque la bibliographie est activée dans Composition, le manuscrit contient le marqueur Pandoc `{#refs}`. Lorsqu’elle est désactivée, `pandoc.yaml` demande explicitement la suppression de la bibliographie.

Des citekeys identiques définies dans plusieurs `.bib` inclus bloquent la création du paquet. Corrigez ce doublon dans les bibliographies avant de recommencer l’export.
