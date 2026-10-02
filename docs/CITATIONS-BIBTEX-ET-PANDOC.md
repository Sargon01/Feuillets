# Citations BibTeX et paquet Pandoc

> [English](BIBTEX-CITATIONS-AND-PANDOC.md) · Français · [Index](README.md)

Feuillets conserve les citations universitaires dans du Markdown ordinaire. Il propose trois modes de rendu des citations, dont le CSL natif via le module compagnon facultatif **Feuillets CSL**. Feuillets reste pleinement utilisable sans ce compagnon et n’installe ni n’exécute Zotero, Better BibTeX ou Pandoc.

## Deux systèmes de citation

Feuillets propose actuellement deux chemins de citation distincts. Ils ne se recouvrent pas et ne partagent pas le même format de stockage.

### Fiches Source

Le système historique des fiches Source, accessible depuis **Recherche → Références → Insérer une citation**, écrit directement une citation textuelle Feuillets dans le texte, selon le style configuré pour le projet :

- footnote
- parenthetical

Ce chemin ne produit pas de citekey Pandoc et reste distinct du CSL natif. Les fiches Source peuvent fournir `author`, `title`, `publisher`, `date` et `url`.

Pour compatibilité, Feuillets lit également quelques propriétés courantes des fiches Source créées avec ZotFlow — `creator`, `creators`, `publication`, `year` — sans jamais modifier les fichiers utilisateur. Il s’agit d’une lecture de compatibilité, pas d’une intégration complète de Zotero ou de ZotFlow.

### BibTeX / Pandoc

Le second système utilise une bibliographie `.bib` et des citekeys Pandoc sémantiques. Un fichier `.csl` fournit le style de citation et de bibliographie pour le CSL natif ou un flux Pandoc/citeproc externe. Tapez `[@` dans un feuillet pour ouvrir le sélecteur de citekeys. Ce chemin prend en charge le rendu auteur-date simplifié, le CSL natif et le paquet Pandoc.

## Préparer un espace de travail

1. Associez un dossier Recherche à l’espace ou au feuillet qui doit posséder ses propres références.
2. Placez dans ce dossier Recherche une exportation Better BibTeX, par exemple `references.bib`.
3. Placez-y un style `.csl` pour utiliser le CSL natif, ou facultativement pour le paquet Pandoc.
4. Ouvrez les réglages du projet ou de l’espace concerné et choisissez les ressources bibliographiques et CSL dans **Citations et bibliographie**.
5. Choisissez le mode d’aperçu des citations :

```text
Clés brutes
Auteur-date
CSL natif
```

- **Clés brutes** laisse la syntaxe Pandoc visible.
- **Auteur-date** utilise le moteur BibTeX historique et léger de Feuillets. Il nécessite une bibliographie `.bib` applicable, ne nécessite pas Feuillets CSL et n’applique pas un style CSL complet.
- **CSL natif** nécessite Feuillets CSL installé et activé, une bibliographie `.bib` applicable, un style `.csl` et des ressources d’exécution CSL prises en charge. Si le traitement est indisponible ou échoue, la syntaxe brute reste visible ; Feuillets ne lui substitue jamais silencieusement un résultat inventé.

Le choix des ressources et le choix du mode d’aperçu sont des réglages distincts.

Le feuillet actif résout d’abord son association directe, puis les dossiers associés sur son chemin physique vers le projet. Une autre branche du Classeur n’est jamais parcourue.

Les documents composés peuvent utiliser plusieurs bibliographies résolues depuis le contexte propre à leurs feuillets citants. Chaque feuillet citant doit résoudre des ressources bibliographiques et CSL valides, et le document doit résoudre un seul style CSL cohérent. Des ressources manquantes ou des styles contradictoires empêchent le rendu CSL natif de ce document.

## Module compagnon CSL natif

Feuillets n’embarque pas citeproc lui-même. Le mode CSL natif utilise le module compagnon facultatif [Feuillets CSL](https://github.com/Sargon01/Feuillets-CSL) via l’API publique de moteur de citations v2 de Feuillets. Il s’exécute localement dans Obsidian. Cette séparation garde le plugin principal Feuillets indépendant du moteur de citations.

Feuillets assure l’analyse Markdown/Pandoc, la résolution contextuelle des ressources du projet ou de l’espace, la sélection `.bib` et `.csl`, la construction des documents et sessions, le rendu dans Obsidian et les exports, la conservation de la syntaxe brute en cas d’échec et la génération du paquet Pandoc. Feuillets CSL adapte BibTeX/BibLaTeX aux données CSL, évalue le CSL via citeproc, traite les citations avec l’état du document et fournit une sortie sémantique sûre pour les citations et bibliographies.

## Citer pendant l’écriture

Tapez `[@` dans un feuillet Markdown pour ouvrir le sélecteur. Recherchez par citekey, auteur, titre ou année ; choisissez une ou plusieurs références et ajoutez au besoin un localisateur de page. Feuillets écrit la syntaxe Pandoc ordinaire :

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
@smith2024
```

Ces exemples montrent une citation simple, un localisateur de page, un groupe de citations avec localisateurs et une citation narrative. Le Markdown source reste toujours une syntaxe Pandoc sémantique : le rendu ne réécrit jamais les marqueurs de citation du manuscrit. Une clé inconnue n’est jamais supprimée silencieusement.

## Surfaces interactives

### Mode Auteur-date

Avec une bibliographie applicable, **Auteur-date** affiche les citations sous une forme lisible dans Live Preview, le mode Lecture et Continu, ainsi que dans l’Aperçu paginé, PDF, DOCX, EPUB et ODT. Par exemple, `[@smith2024, p. 42]` peut apparaître comme `(Smith, 2024, p. 42)`.

Les vues interactives auteur-date proposent les informations bibliographiques associées dans des infobulles de citation lorsque celles-ci sont disponibles. Ce moteur léger ne garantit pas la conformité à un style CSL.

### Mode CSL natif

**CSL natif** utilise le moteur compagnon pour rendre les citations selon le style CSL choisi dans :

- Live Preview pendant l’écriture ;
- le mode Lecture ;
- Continu ;
- l’Aperçu paginé ;
- les exports natifs PDF, DOCX, EPUB et ODT.

Les deux modes laissent le Markdown du manuscrit inchangé. Les exports statiques contiennent la présentation mise en forme ; ils ne proposent pas les infobulles de citation de l’éditeur.

## Styles CSL à notes

Le CSL natif prend en charge les styles à notes, comme Chicago Notes & Bibliography. Les citations placées dans les notes de bas de page Markdown participent à l’ordre des citations du document. Feuillets transmet la position et le contexte de la note au moteur, ce qui permet aux styles avec état de distinguer les premières citations des suivantes selon la sémantique de citeproc/CSL.

Les citations rendues, y compris leur mise en forme riche, restent associées à leur note d’origine. Ce comportement tenant compte des notes est pris en charge en mode Lecture, Continu, Aperçu paginé, PDF, DOCX, EPUB et ODT. Live Preview fournit le rendu CSL natif des citations pendant l’écriture. Feuillets reste responsable de la pagination des notes dans l’Aperçu et le PDF.

## Comportement de la bibliographie

### Bibliographie simple de Feuillets

Le panneau Recherche liste les entrées BibTeX citées et signale les clés inconnues. Feuillets peut toujours générer sa bibliographie Markdown simple à partir des citations de la portée choisie, lorsque c’est applicable. Ce chemin historique n’applique pas un style CSL complet et inclut les entrées citées plutôt que l’intégralité d’un fichier `.bib`.

### Bibliographie CSL native

Lorsque **CSL natif** est actif et que l’inclusion de la bibliographie est activée dans Composition, le moteur peut générer une bibliographie conforme au style dans l’Aperçu paginé, PDF, DOCX, EPUB et ODT. Ces sorties préservent la disposition CSL structurée fournie par le moteur, notamment les retraits suspendus et l’alignement du second champ lorsqu’ils sont pris en charge. La génération de la bibliographie suit la sémantique du style choisi.

Cette bibliographie de présentation ne transforme pas le Markdown compilé en texte mis en forme selon CSL.

## Export Markdown

**Le Markdown compilé conserve la syntaxe de citation Pandoc**, comme `[@smith2024]`, quel que soit le mode de rendu. Le CSL natif est un rendu de présentation et d’export, pas un remplacement destructif du Markdown du manuscrit. Les autres sorties natives peuvent contenir des citations et bibliographies rendues selon CSL.

## Locales CSL et limites

Feuillets CSL embarque actuellement les ressources de locale d’exécution CSL **`en-US`** et **`fr-FR`**. Une locale d’exécution non prise en charge conserve la syntaxe brute ; aucune substitution automatique de locale n’est effectuée. Cela concerne les ressources de locale nécessaires à l’évaluation CSL, pas une restriction aux styles CSL anglais ou français.

## Dépannage

**Lorsque le CSL natif ne peut pas produire un résultat sûr, Feuillets conserve la syntaxe brute des citations visible.** Vérifiez :

- que Feuillets CSL est installé et activé ;
- que la bibliographie `.bib` applicable existe et est valide ;
- que le style `.csl` existe et est sélectionné ;
- que chaque citekey figure dans la bibliographie résolue ;
- que la locale d’exécution requise par le style est prise en charge.

Un compagnon absent ou désactivé, une bibliographie ou un style manquant, une clé inconnue, une bibliographie invalide, une locale non prise en charge ou un échec de traitement du moteur déclenche cette conservation de la syntaxe brute. Corrigez le problème de ressource ou de moteur pour rétablir le rendu.

## Accents BibTeX

Feuillets décode les séquences LaTeX courantes utilisées pour les caractères accentués dans les métadonnées BibTeX. Il ne s’agit pas d’un interpréteur TeX général.

## Utiliser un paquet Pandoc

Vous pouvez utiliser le CSL natif via Feuillets CSL directement dans Feuillets et ses sorties natives, ou choisir **Paquet Pandoc (.zip)** dans l’export Édition pour un flux Pandoc/citeproc externe indépendant. Le paquet reste disponible avec le CSL natif et peut transporter un style d’université, d’éditeur ou de revue.

L’archive contient :

- `manuscript.md`, compilé depuis la portée Feuillets choisie ;
- `pandoc.yaml`, fichier de réglages Pandoc portable ;
- les seuls fichiers `.bib` nécessaires aux citekeys de cette portée ;
- le CSL applicable, lorsqu’il est configuré ;
- les images locales copiées sous `media/` ;
- `citation-report.json` uniquement si Feuillets rencontre des clés inconnues ou des médias manquants.

Feuillets n’installe, ne recherche et ne lance jamais Pandoc. Décompressez le paquet puis traitez-le avec votre propre flux Pandoc. Lorsque la bibliographie est activée dans Composition, le manuscrit contient le marqueur Pandoc `{#refs}`. Lorsqu’elle est désactivée, `pandoc.yaml` demande explicitement la suppression de la bibliographie.

Des citekeys identiques définies dans plusieurs `.bib` inclus bloquent la création du paquet. Corrigez ce doublon dans les bibliographies avant de recommencer l’export.
