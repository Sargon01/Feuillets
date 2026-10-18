# Audit documentaire pour Feuillets 3.7.0

Audit du 18 octobre 2026. Référence fonctionnelle : `main` au commit `4e641512847c20ae0dd898b77547e959853eae32`. Dernière version publiée : 3.6.1. Cette préparation ne publie pas la 3.7.0 et ne change aucun fichier de version.

## Périmètre et méthode

- Dépôt principal initialement propre, sur `main`, sans divergence avec `origin/main` après fetch. Le correctif Obsidian Review est déjà isolé dans `4e64151` ; aucune modification de code, test ou CSS n’entre dans les commits documentaires.
- Historique lu depuis `df82836` : **140 commits** jusqu’à la référence ci-dessus, avec liste chronologique et datée, tags et comparaison effective `3.6.1..HEAD` pour les notes futures.
- Consultation des implémentations actuelles, des tests associés et des deux dictionnaires i18n. Les fonctionnalités ne sont pas déduites de la seule présence d’anciens fichiers ou libellés.
- Inventaire des Markdown du dépôt, examen par domaines et paires linguistiques. Les notes de version anciennes, analyses Canvas historiques et rapports de validation datés sont conservés comme archives ; leurs verdicts ne sont pas réécrits.
- Site : `Sargon01/feuillets-site`, base `fb7c9907e35aa74b5efbe1e5eddd7a65b0614acc`, pages `index.html` et `fr/index.html`. CSS, médias et identité graphique conservés.

## Principaux écarts et corrections

| Domaine | Écart constaté | Correction |
|---|---|---|
| Carnet | Guide centré sur l’ancien plan, absence de l’atelier libre | Deux guides détaillent notes, cartes de fichiers, geste simple/multiple, habillages, dimensions, typographie, relations, Map, inspecteur et styles futurs |
| Agencement | Empilement peu ou pas expliqué | Distinction placement ponctuel / relation dynamique, réajustement, sortie d’un membre et dissociation ; conditions d’admissibilité |
| Plan Binder | Point d’entrée présenté comme disponible localement | Commande actuelle explicitement globale, manuscrit complet dans le Carnet global ; ancien modèle de dossier distingué du point d’entrée |
| Références croisées | Guide surtout descriptif, anglais absent | Parcours au curseur et sur sélection, cibles, compteurs, portée, source/rendu, erreurs, composition et matrice des sorties ; guide anglais complet |
| Écriture | Recherche/remplacement et disposition locale insuffisamment expliqués | Guide bilingue avec prévisualisation, protections, refus des tampons concurrents, annulation globale, exceptions de paragraphes et correction facultative |
| Citations | Insertion BibTeX décrite comme toujours parenthétique ; ressources de projet minimisées | Notes atomiques selon le mode choisi, comportement dans Continu et accès aux réglages de projet/espace |
| Interface | Six onglets, ancien Projet, contradiction Révision DOCX | Sept onglets dont Carnets ; Gérer les projets ; Relecture → Révision DOCX confirmé dans le code |
| Langues | Exemples absents des variantes, rôles et présentations anglais | Exemples complets, tutoriel de publication et explications manquantes ajoutés, identifiants Markdown canoniques préservés |
| Publication | Limites et progrès récents peu visibles | Tables DOCX/ODT natives, images ODT, provenance des médias, renvois contextuels, différences entre formats et imports de styles |
| README et site | Carnet accessoire, renvois peu visibles, confusion Courrier | Présentation de l’atelier visuel, références internes distinctes de CSL, liens actuels ; statut préparatoire explicite |
| Archives | Anciennes notes en tête du parcours actuel | Archives accessibles dans une rubrique dédiée ; guides et parcours actuels au premier plan |

Les domaines déjà correctement décrits (annotations, sauvegardes, comparaison, collaboration, portée des imports Scrivener, YAML, transport `.feuil`, Contexte et chronologie) gardent leurs explications et exemples utiles. Les compléments sont ciblés : pas de réécriture systématique des archives ni de duplication du guide Carnet dans tous les documents.

## Repères historiques consultés

- Avant la borne 3.0 : `f5afbad`, finalisation Carnets de dossier / Plan / mindmap ; distinction entre les anciens essais Relations/Généalogie et les points d’entrée réellement conservés.
- Journal et documentation : `65bc8d3`, `25d64cf`, `6909bcc`, `5714aa5` ; localisation et conservation des chemins : `df9da1a`, `fd245d0`, `29434d0`.
- Contexte documentaire, images et Binder : `36a8672`, `1406b0c`, `741a084`, `b740968`, `d20732c`, `2a3ec18`, `0662a62`, `83b45cd`, `464d001`.
- CSL, correction et ressources : `06e94b5`, `c65ca40`, `1a831f3`, `a95705a`, `bf8f157`, `fc19fc8`, `85a8aef`.
- Espaces, recherche/remplacement et paragraphes : `242d5e4`, `18b6923`, `2873f5c`, `0622275`, `269182c`, `dc6ce7d`.
- Atelier Carnet : `0a8cd47`, `f8097dc`, `8c96700`, `756c3f6`, `f4dee14`, `502e464`, `f131d3c` ; confrontation aux fichiers `src/carnet/`, aux deux composants du panneau et aux tests de styles, ancrages, piles et contexte.
- Références/export : `b59612b`, `453f1dd`, `228f3be`, `23a58fd`, `9c403bf`, `c98f0b1`, `b5f0238`, `9f17487`, `92feab2`, `ad2dd57`, `bb8a854` ; rapports de validation conservés et utilisés avec leurs limites.
- Édition/Aperçu et compatibilité : `affc079`, `51dd878`, `19536dd`, `4e64151`.

Les deux guides nouveaux d’écriture couvrent aussi les fonctions déjà publiées en 3.6.0. Elles ne sont pas annoncées à nouveau comme nouveautés 3.7.0 : la nouvelle section du changelog ne décrit que le delta réellement intégré après la 3.6.1.

## Validation

- **83 documents Markdown** inventoriés ; **32 paires linguistiques** vérifiées. Les guides Carnet, références, écriture, variantes, rôles, Présentation et tutoriel ont été comparés sur le contenu et les exemples, pas seulement sur leur longueur.
- Liens Markdown internes, ancres et destinations GitHub du site contrôlés par un script temporaire hors dépôt ; aucune dépendance ni outil de validation permanent ajouté. Les exemples de syntaxe à l’intérieur des blocs de code ne sont pas traités comme des fichiers à publier.
- Les huit archives suivies (quatre notes 3.0.x, validation DOCX et trois rapports de références croisées) sont identiques à la référence initiale. La totalité du changelog à partir de la section 3.6.1 est conservée octet pour octet.
- `npm run lint:obsidian` : succès, aucun avertissement ; `npm run lint` : succès avec 30 avertissements préexistants hors de ce chantier ; `npm run build` : succès ; `git diff --check` : succès dans les deux dépôts.
- Le site est réellement rendu dans Chromium en français et en anglais à 375, 768 et 1 440 px : six contrôles réussis, médias locaux chargés, ancres présentes, aucun doublon d’identifiant, aucun débordement horizontal ni erreur JavaScript. Les captures des nouvelles sections ont été examinées sur ordinateur et mobile.
- Aucun test fonctionnel Obsidian supplémentaire n’est présenté comme exécuté ici : le chantier ne change que Markdown et HTML. Les tests existants ont servi à vérifier les comportements documentés ; les contrôles de compilation/lint portent sur le code actuel.
- Nouvelle vérification des deux `origin/main` avant commit : pas de divergence. Publication par commits documentaires distincts, sans push forcé, tag, release ou changement de version.

## Inventaire des fichiers

Dépôt principal : **43 fichiers**, dont les quatre créations ci-dessous. Les autres modifications complètent les guides existants.

- Racine : `CHANGELOG.md`, `CONTRIBUTING.md`, `README-fr.md`, `README.md`.
- `docs/` : `ARCHITECTURE.md`, `AUTHOR-WORKFLOW.md`, `BIBTEX-CITATIONS-AND-PANDOC.md`, `BINDER-AND-NAVIGATION.md`, `CITATIONS-BIBTEX-ET-PANDOC.md`, `CLASSEUR-ET-NAVIGATION.md`, `COMPOSITION-AND-EXPORT.md`, `COMPOSITION-ET-EXPORT.md`, `CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md`, `CONTINUOUS-MODE.md`, `CROSS-REFERENCES-EN.md` (créé), `CROSS-REFERENCES.md`, `DECOUVRIR.md`, `DISCOVER.md`, `ECRIRE-ET-CORRIGER.md` (créé), `ESPACES-DE-TRAVAIL.md`, `FEATURES.md`, `FONCTIONNALITES.md`, `HOW-TO-CARNET.md`, `HOW-TO-NOTEBOOK.md`, `MODE-CONTINU.md`, `NOTE-DE-MAINTENANCE.md`, `PARCOURS-AUTEUR.md`, `PLAN-CAPTURES.md`, `PRESENTATION-EN.md`, `README.md`, `REPLACE-AEON-TIMELINE-WITH-FEUILLETS.md`, `REPLACE-SCRIVENER-WITH-FEUILLETS.md`, `REPLACE-ULYSSES-WITH-FEUILLETS.md`, `SECURITY_AND_EXTERNAL_RESOURCES.md`, `SEMANTIC-PUBLISHING-TUTORIAL.md`, `SEMANTIC-ROLES.md`, `SETUP-INTERFACE.md`, `VARIANTES-EXTRACTIONS-COLLECTIONS.md`, `WORKING-ANNOTATIONS.md`, `WORKSPACES.md`, `WRITING-AND-CORRECTION.md` (créé), `WRITING-INTERFACE.md`.
- `docs/validation/` : `documentation-3.7-audit.md` (créé).

Site : `index.html` et `fr/index.html` ; aucun autre fichier modifié.

## Vérifications visuelles restant nécessaires

- Aucune nouvelle recette de l’interface Obsidian ou des lecteurs Word/Pages/LibreOffice n’est revendiquée par ce chantier documentaire. Les rapports antérieurs restent datés et ne constituent pas une certification visuelle de ces pages.
- Les GIF/PNG produit existants ne sont pas remplacés par des images artificielles. Les scènes Carnet, références, remplacement et Édition à recapturer sont recensées dans [PLAN-CAPTURES.md](../PLAN-CAPTURES.md).
- Les fonctionnalités de 3.7.0 restent présentées comme préparatoires tant qu’aucune release n’est publiée.
