# Note de maintenance documentaire

## Objectif

La documentation doit expliquer le **produit actuel**, pas conserver l’archéologie de chaque ancienne interface.

Les anciens comportements restent dans Git et le changelog. Les guides utilisateur décrivent la version courante.

## Hiérarchie documentaire

### Entrée du dépôt

- `README-fr.md` — vitrine française.
- `README.md` — vitrine anglaise.
- `docs/README.md` — index complet.

### Découverte

- `DECOUVRIR.md` / `DISCOVER.md`
- `PARCOURS-AUTEUR.md` / `AUTHOR-WORKFLOW.md`
- `FONCTIONNALITES.md` / `FEATURES.md`

### Guides spécialisés

- `SETUP-INTERFACE.md` / `WRITING-INTERFACE.md`
- `COMPOSITION-ET-EXPORT.md` / `COMPOSITION-AND-EXPORT.md`
- `VERSIONNAGE-ET-SECURITE.md` / `REWRITING-BACKUPS-AND-VERSIONS.md`
- `IMPORT-SCRIVENER.md` / `IMPORT-SCRIVENER-EN.md`
- `HOW-TO-CARNET.md` / `HOW-TO-NOTEBOOK.md`
- `How-to-Contexte-Feuillets.md` / `HOW-TO-CONTEXT.md`
- `HOW-TO-REVISION-DOCX.md` / `HOW-TO-DOCX-REVISION.md`

### Principes et migration

- `PHILOSOPHIE.md` / `PHILOSOPHY.md`
- `Remplacer-Scrivener-par-Feuillets.md` / `REPLACE-SCRIVENER-WITH-FEUILLETS.md`
- `Remplacer-Ulysses-par-Feuillets.md` / `REPLACE-ULYSSES-WITH-FEUILLETS.md`
- `Remplacer-Aeon-Timeline-par-Feuillets.md` / `REPLACE-AEON-TIMELINE-WITH-FEUILLETS.md`

### Maintenance / revue

- `ARCHITECTURE.md`
- `DOCX-REVIEW-VALIDATION.md` — recette/validation technique ; ne pas le confondre avec `HOW-TO-REVISION-DOCX.md`, guide utilisateur.
- `SECURITY_AND_EXTERNAL_RESOURCES.md`
- `PLAN-CAPTURES.md`
- `../CONTRIBUTING.md`
- `../PRIVACY.md`
- `../SECURITY.md`
- `../THIRD_PARTY_NOTICES.md`

## Vocabulaire public français

| Terme interne/anglais | Terme public |
|---|---|
| Binder | Classeur |
| Preview | Aperçu |
| sheet/file | feuillet, scène, section ou document selon le contexte |
| folder | dossier, partie, chapitre ou section |
| right sidebar | Inspecteur |
| snapshot | instantané |
| backup | sauvegarde |
| diff | comparaison |
| template | modèle |
| metadata | propriétés / informations |
| workflow | parcours |
| Notebook | Carnet |
| Storyline | Chemin de fer |
| Proofreading | Relecture |
| Analysis | Analyse |

Les noms réels du code restent acceptés dans `ARCHITECTURE.md`.

## État actuel à ne pas réintroduire comme ancien modèle

L’Inspecteur actuel contient :

- Notes ;
- Recherche ;
- Journal ;
- Édition ;
- Analyse ;
- Relecture.

Ne pas présenter Notes, Recherche, Journal, Projet ou Révision DOCX comme six panneaux droits indépendants dans la documentation utilisateur.

**Contexte** est une section de Notes, pas un panneau autonome.

## Règles fonctionnelles à garder cohérentes

### Projet existant utilisé tel quel

Toujours rappeler lorsque c’est pertinent :

- aucun déplacement/renommage à l’ouverture ;
- `_Sortie` reste dans ce dossier ;
- `_Backups` reste dans ce dossier ;
- aucune remontée implicite vers les dossiers frères.

### Recherche

Les variantes FR/EN historiques peuvent être reconnues sans renommage destructif.

### Labels

Un feuillet peut avoir plusieurs labels ; le premier sert de label principal lorsqu’une représentation a besoin d’une seule couleur.

### Analyse

Ne pas écrire « Feuillets contient un correcteur grammatical ».

Le noyau contient :

- Analyse de prose ;
- une interface/API de Relecture.

Le moteur linguistique appartient au compagnon installé.

### Export

Maintenir une seule liste vérifiée :

```text
DOCX
EPUB
ODT
PDF desktop via impression système
Markdown compilé
```

Ne pas réintroduire Pandoc dans la documentation sans réimplémentation réelle dans le code.

## Images

Toutes les images documentaires vivent directement dans `docs/`.

Ne pas les copier dans `assets/`, `images/` ou plusieurs langues.

Une même capture doit être réutilisée par les guides FR/EN avec le même chemin.

Voir `PLAN-CAPTURES.md`.

## Quand modifier quelle documentation ?

### Changement visible mineur

Mettre à jour le guide concerné et `FONCTIONNALITES.md`/`FEATURES.md` si la référence change.

### Nouveau parcours utilisateur

Mettre à jour `README`, `DECOUVRIR` et `PARCOURS-AUTEUR`.

### Changement d’architecture interne

Mettre à jour `ARCHITECTURE.md`, pas les guides utilisateur sauf si le comportement change.

### Changement de données / réseau / dépendances

Mettre à jour ensemble :

- `PRIVACY.md`
- `SECURITY.md`
- `SECURITY_AND_EXTERNAL_RESOURCES.md`
- `THIRD_PARTY_NOTICES.md` si nécessaire.

### Changement d’interface important

Remplacer la capture existante **en conservant son nom** lorsque son rôle documentaire ne change pas. Cela évite de modifier tous les liens Markdown.

## Priorité de maintenance

La documentation suit la même priorité que le produit :

1. exactitude ;
2. stabilité ;
3. cohérence ;
4. clarté ;
5. exhaustivité utile.

Ne pas transformer une mise à jour documentaire en refonte de produit.

## Avant un commit documentaire

Vérifier :

- liens internes ;
- chemins d’images ;
- correspondance FR/EN ;
- version minimale d’Obsidian ;
- formats d’export ;
- rôle actuel de l’Inspecteur ;
- absence d’anciennes fonctions présentées comme actuelles ;
- absence de compte de tests figé dans les pages de présentation ;
- absence de données personnelles dans les captures.

Le nombre exact de tests appartient aux rapports de validation et aux notes de version, pas à une page qui vieillira dès le prochain test ajouté.
