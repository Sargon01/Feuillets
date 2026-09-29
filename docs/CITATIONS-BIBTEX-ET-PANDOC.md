# Citations BibTeX et paquet Pandoc

> [English](BIBTEX-CITATIONS-AND-PANDOC.md) · Français · [Index](README.md)

Feuillets conserve les citations universitaires dans du Markdown ordinaire. Il aide à retrouver les références pendant l’écriture, mais n’intègre ni n’exécute Zotero, Better BibTeX, Pandoc ou un moteur CSL.

## Deux systèmes de citation

Feuillets propose actuellement deux chemins de citation distincts. Ils ne se recouvrent pas et ne partagent pas le même format de stockage.

### Fiches Source

Le système historique des fiches Source, accessible depuis **Recherche → Références → Insérer une citation**, écrit directement une citation textuelle Feuillets dans le texte, selon le style configuré pour le projet :

- footnote
- parenthetical

Ce chemin ne produit pas de citekey Pandoc et n’utilise pas CSL. Les fiches Source peuvent fournir `author`, `title`, `publisher`, `date` et `url`.

Pour compatibilité, Feuillets lit également quelques propriétés courantes des fiches Source créées avec ZotFlow — `creator`, `creators`, `publication`, `year` — sans jamais modifier les fichiers utilisateur. Il s’agit d’une lecture de compatibilité, pas d’une intégration complète de Zotero ou de ZotFlow.

### BibTeX / Pandoc

Le second système repose sur un fichier `.bib` et la syntaxe `[@citekey]`, ouverte en tapant `[@` dans un feuillet. Il conserve dans le Markdown source une syntaxe Pandoc sémantique. C’est ce chemin qui permet ensuite l’aperçu auteur-date simplifié dans Feuillets, le paquet Pandoc, et le traitement CSL externe.

## Préparer un espace de travail

1. Associez un dossier Recherche à l’espace ou au feuillet qui doit posséder ses propres références.
2. Placez dans ce dossier Recherche une exportation Better BibTeX, par exemple `references.bib`.
3. Vous pouvez y placer également un unique style CSL.
4. Ouvrez les réglages de l’espace de ce dossier et choisissez ses ressources bibliographiques et CSL dans **Citations et bibliographie**.

Sélectionner un fichier `.bib` ne suffit pas à lui seul pour afficher les citations en auteur-date. Trois réglages sont distincts : le choix de la bibliographie `.bib`, le choix éventuel d’un style `.csl`, et le choix du mode d’aperçu des citations. Ce mode peut être **désactivé** ou **auteur-date**.

Le feuillet actif résout d’abord son association directe, puis les dossiers associés sur son chemin physique vers le projet. Une autre branche du Classeur n’est jamais parcourue.

## Citer pendant l’écriture

Tapez `[@` dans un feuillet Markdown pour ouvrir le sélecteur. Recherchez par citekey, auteur, titre ou année ; choisissez une ou plusieurs références et ajoutez au besoin un localisateur de page. Feuillets écrit la syntaxe Pandoc ordinaire :

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
```

Les citekeys restent dans le Markdown source. Une clé inconnue n’est jamais supprimée silencieusement.

## Surfaces interactives

Lorsque le mode d’aperçu auteur-date est activé et qu’une bibliographie applicable est disponible, Live Preview, le mode Lecture et Continu affichent les citations résolues sous une forme lisible, tout en laissant le Markdown sous-jacent inchangé. Par exemple :

```
[@smith2024, p. 42]
```

s’affiche comme :

```
(Smith, 2024, p. 42)
```

Ces surfaces peuvent également faire apparaître les informations bibliographiques associées lorsque l’interface le prévoit. Il ne s’agit pas d’un rendu CSL complet, mais d’un affichage auteur-date simplifié propre à Feuillets. Voir la limitation ci-dessous.

## Aperçu, bibliographie et exports natifs

**L’export Markdown** conserve toujours la syntaxe Pandoc brute, par exemple `[@smith2024]`.

**Aperçu paginé, DOCX, EPUB, ODT et PDF** : lorsque le mode d’aperçu auteur-date est activé et qu’une bibliographie applicable est disponible, `[@smith2024]` peut être rendu comme `(Smith, 2024)` dans ces sorties. Lorsque le mode est désactivé, ou lorsqu’une citation ne peut pas être résolue, la syntaxe brute reste visible. Le fichier `.csl` configuré n’est pas appliqué ici — voir [rôle du CSL](#rôle-du-csl) ci-dessous.

Le panneau Recherche liste les entrées BibTeX citées et signale les clés inconnues. Feuillets peut générer une bibliographie Markdown simple à partir des citations de la portée choisie ; cette bibliographie native n’est pas une bibliographie CSL complète, et elle n’ajoute pas automatiquement l’intégralité d’un fichier `.bib` — seulement les citations réellement trouvées dans la portée.

### Limitation : rendu auteur-date simplifié uniquement

Le rendu auteur-date natif utilisé par Feuillets n’est pas un moteur CSL. Il ne garantit pas le respect intégral de Chicago, APA, MLA, ISO 690, des styles d’université, des styles de revue, ou de tout autre style CSL. Pour une bibliographie conforme à un vrai style CSL, utilisez le paquet Pandoc avec un flux Pandoc/citeproc externe.

## Rôle du CSL

Un fichier `.csl` configuré dans Feuillets est associé au projet ou à l’espace concerné et est inclus dans le paquet Pandoc lorsque c’est pertinent. Il n’est pas interprété par Feuillets lui-même et ne transforme pas les citations des exports natifs ni des aperçus. Feuillets n’intègre pas actuellement de moteur CSL natif.

## Accents BibTeX

Feuillets décode les séquences LaTeX courantes utilisées pour les caractères accentués dans les métadonnées BibTeX. Il ne s’agit pas d’un interpréteur TeX général.

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
