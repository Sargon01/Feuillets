# Découvrir Feuillets

## Qu'est-ce que Feuillets ?

Feuillets transforme Obsidian en studio d'écriture longue : un manuscrit
n'y est plus un simple dossier de fichiers Markdown dispersés, mais une
structure vivante — organiser, rédiger, réviser et compiler, sans quitter
Obsidian et sans jamais changer le format de vos fichiers.

## À qui s'adresse Feuillets ?

À qui écrit un texte long dans Obsidian et veut plus qu'un dossier plat de
notes : romancières et romanciers (parties, chapitres, scènes, fiches
personnages/lieux), autrices et auteurs de non-fiction (sections,
chapitres, sources, bibliographie), et plus largement quiconque doit
organiser, réviser et exporter un document structuré de plusieurs dizaines
de milliers de mots.

## Les fonctions principales, en un coup d'œil

- **Binder** — la navigation du manuscrit : parties, chapitres, scènes,
  glisser-déposer pour réorganiser, recherche et filtres.
- **Cartes / Plan** — vue d'ensemble du manuscrit en cartes (par label,
  personnage ou fil narratif) ou en plan linéaire, selon ce qui convient au
  texte du moment.
- **Recherche** — la bible narrative du projet : personnages, lieux, lore,
  bibliographie, glossaire, avec insertion directe dans le texte.
- **Notes, Propriétés, Journal, Statistiques** — un panneau par besoin :
  notes de travail, métadonnées, calendrier d'écriture, progression.
- **Snapshots et versions** — sauvegardes automatiques et duplication
  complète du manuscrit avant une réécriture importante, comparables entre
  elles à tout moment.
- **Compilation et export** — assemblage du manuscrit dans l'ordre du
  Binder, puis export en .docx, .epub ou .pdf, sans dépendance externe.

*(Emplacement réservé pour une capture d'écran du Binder en double volet —
à ajouter une fois disponible. Aucune capture fictive n'est incluse ici.)*

## Qu'est-ce qu'un "projet" dans Feuillets ?

Un projet, c'est un dossier de votre coffre Obsidian, structuré ainsi :

```
Nom du projet/
├── Manuscrit/      ← le texte : parties, chapitres, scènes
├── Recherche/      ← bible narrative (personnages, lieux…)
└── Ressources/     ← images, modèles de mise en page, exports
```

**La distinction importante : racine du projet vs `Manuscrit`.**
`Nom du projet/` est la racine réelle — tout y vit, y compris `Recherche`
et `Ressources`, en frères de `Manuscrit`. Mais le **Binder**, les vues
**Cartes**/**Plan** et la **compilation**, eux, ne travaillent que dans
`Manuscrit/` : c'est la racine éditoriale, celle qui ne contient que le
texte du manuscrit lui-même — jamais mêlée à la recherche, aux images ou
aux sauvegardes.

## Le rôle du Binder

Le Binder (barre latérale) est la colonne vertébrale du manuscrit : il
affiche l'arborescence Parties → Chapitres → Scènes, permet de glisser-
déposer pour réorganiser, et donne accès aux fonctions dédiées de
Recherche, Journal et Snapshots sans jamais les mélanger à cette
arborescence narrative.

## Le rôle des vues Cartes et Plan

Deux façons de voir le même manuscrit, au choix selon la tâche : les
**Cartes** donnent une vue d'ensemble façon tableau de liège (utile pour
visualiser des fils narratifs ou des labels sur toute l'intrigue), le
**Plan** donne une vue linéaire façon sommaire (utile pour suivre l'ordre
et la progression). Les deux se limitent toujours au contenu de
`Manuscrit/`.

## Feuillets fonctionne avec du Markdown, point.

Aucun format propriétaire : vos feuillets restent des fichiers `.md`
ordinaires, lisibles et modifiables avec n'importe quel éditeur de texte,
avec ou sans Feuillets. Un dossier Markdown déjà existant, avec ou sans
métadonnées, s'ouvre directement dans Feuillets via "Ouvrir un dossier
existant" — rien n'y est déplacé, renommé ni modifié.

## Les métadonnées YAML et les dossiers conventionnels sont facultatifs

`Recherche`, `Ressources`, les champs YAML comme `statut` ou `label` : rien
de tout cela n'est obligatoire pour écrire. Ce sont des compléments qui
activent des fonctions en plus — Binder enrichi (statuts, labels,
progression), recherche de contexte automatique, historique de versions,
compilation avec préréglages — jamais des conditions préalables.

## Comment démarrer

Trois façons, depuis l'écran d'accueil du Binder :

1. **Créer un projet** — nom, auteur facultatif, type ; la structure
   minimale et un premier chapitre prêt à écrire se créent en un clic.
2. **Ouvrir un dossier existant** — reprendre un manuscrit déjà commencé.
3. **Découvrir avec un projet de démonstration** — un exemple déjà rempli,
   pour explorer sans écrire une ligne, avec un parcours guidé en 4 étapes
   inclus dans son `Lisez-moi.md`.

## Aller plus loin

- **`PARCOURS-AUTEUR.md`** — le tutoriel complet, environ 15 minutes, du
  premier mot à l'export.
- **`FONCTIONNALITES.md`** — le manuel de référence, fonction par fonction.
