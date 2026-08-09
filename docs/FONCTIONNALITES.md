# Feuillets — fonctionnalités par usage

> **Français** · [English](FEATURES.md) · [Index](README.md)

Cette page est la référence fonctionnelle de la documentation utilisateur. Elle décrit le comportement visible et évite les noms de variables internes.

![Vue d’ensemble](feuillets-ecriture-apercu.png)

## Projets

- Création de projets **Fiction**, **Non-fiction** et **Libre**.
- Projet de démonstration.
- Gestion de plusieurs projets.
- Utilisation d’un dossier existant tel quel, sans déplacement ni renommage.
- Initialisation d’un dossier existant comme projet Feuillets.
- Nom d’affichage du projet distinct du chemin du dossier.
- Métadonnées de projet.
- Compatibilité avec les anciens noms de dossiers français ou anglais.

## Classeur

- Navigation hiérarchique.
- Double volet dossiers/fichiers.
- Modes dossiers seuls ou fichiers seuls.
- Densité d’affichage.
- Création de dossiers et feuillets.
- Renommage des dossiers et fichiers.
- Glisser-déposer.
- Déplacement vers la racine du manuscrit.
- Annulation du dernier déplacement lorsque disponible.
- Sélection multiple.
- Ordre personnalisé persistant.
- Recherche dans le titre seul ou dans le titre et le contenu.
- Filtres par statut, label et progression.
- Liserés de labels, tags, statut, progression et nombre de mots affichables.
- Aperçu de fiche configurable : extrait, synopsis, résumé, notes ou tags.
- Import d’un plan.
- Compilation contextuelle d’un fichier, d’un dossier ou d’une sélection.
- Ouverture d’une portée dans l’Aperçu.

## Écriture

- Utilisation de l’éditeur Markdown natif d’Obsidian.
- Présentation littéraire appliquée au manuscrit.
- Police, taille, interligne et largeur configurables.
- Alinéas.
- Espacement de paragraphes configurable.
- Syntaxe Markdown rendue discrète.
- Apostrophes, guillemets, tirets et espaces typographiques.
- Correction typographique d’une sélection ou d’un feuillet.
- Recherche et remplacement dans le manuscrit.
- Insertion de séparateurs de scène.
- Nettoyage de certains artefacts d’import.
- Navigation feuillet suivant/précédent depuis le Classeur.

## Mode Concentration

- Masquage des zones périphériques.
- Largeur spécifique.
- Défilement machine à écrire.
- Estompage par ligne ou paragraphe.
- Compteur de mots flottant.
- Retour sans modification du texte.

![Mode Concentration](feuillets-concentration.png)

## Notes et propriétés

L’onglet **Notes** de l’Inspecteur peut regrouper :

- synopsis ;
- résumé ;
- notes de travail ;
- sources du feuillet ;
- notes de bas de page ;
- propriétés YAML ;
- notes de dossier ;
- plan du feuillet ;
- entités et contexte.

Les propriétés restent facultatives. Un fichier Markdown sans frontmatter reste utilisable.

## Contexte local

- Fenêtre de texte autour du curseur.
- Références explicites.
- Fiches épinglées par feuillet.
- Recherche dans des dossiers associés.
- Contexte de chapitre.
- Contexte Recherche du projet.
- Détection de correspondances lexicales dans le contenu.
- États datés d’entités.
- Alertes : personnage pas encore né, déjà mort, état incompatible, objet ou technique anachronique lorsque les données nécessaires existent.
- Résultats limités puis dépliables.
- Aucun service distant ni IA requise.

## Recherche

- Rubriques adaptées au type de projet.
- Fiction : Characters/Personnages, Places/Lieux, Events/Événements, Lore, Glossary/Glossaire, Bibliography/Bibliographie.
- Non-fiction : Sources, Bibliography/Bibliographie, Notes.
- Projet Libre : aucune rubrique métier imposée.
- Rubriques personnalisées.
- Recherche texte.
- Filtres par tags.
- Dossiers de recherche sauvegardés.
- Création et renommage de fiches.
- Duplication et corbeille.
- Ouverture en onglet ou côte à côte.
- Association d’un dossier de Recherche à un dossier **ou à un feuillet** du Classeur.
- Association possible avec un dossier situé ailleurs dans le coffre.
- Insertion de liens, extraits et extraits sourcés.
- Insertion d’images et de liens PDF.
- Recherche des apparitions d’une fiche dans le manuscrit.
- Bibliographie fondée sur les sources citées.
- Catégories historiques FR/EN reconnues sans duplication.

## Notes de bas de page et citations

- Insertion de note.
- Navigation entre appel et définition.
- Vérification des appels sans définition, définitions inutilisées, doublons, définitions vides et appels mal formés.
- Renumérotation.
- Identifiants nommés conservés.
- Gestion des collisions entre feuillets lors de la compilation.
- Citation depuis une fiche Source.
- Génération de bibliographie.

## Cartes

- Une représentation par feuillet.
- Réorganisation visuelle.
- Travail sur un dossier ou une portée plus large.
- Synopsis, extrait ou données affichables.
- Labels et progression.
- Réglages de taille et de colonnes.

## Plan

- Tableau hiérarchique.
- Colonnes configurables.
- Largeurs réglables.
- Données telles que synopsis, résumé, notes, tags, label, statut, date, compilation, mots, objectif et progression.

## Chemin de fer

- Représentation des fils narratifs.
- Cartes colorées.
- Vue de la distribution des fils à travers le manuscrit.
- Intégration avec Canvas.

## Chronologie

- Dates de scènes.
- Jalons/événements de Recherche.
- Ordre narratif et ordre chronologique.
- Échelles temporelles.
- Filtres.
- Événements parallèles.
- Noms historiques reconnus : Événements, Events, Chronologie, Timeline, Chronology, `_Chronologie`.

## Carnet

- Canvas natif du projet.
- Nœuds texte et fichiers.
- Capture d’idées.
- Groupes.
- Passage volontaire d’idées vers le manuscrit ou la Recherche.
- Création de chapitre à partir d’un ensemble d’éléments.
- Import d’un plan depuis l’arbre d’idées.
- Intégration facultative avec Advanced Canvas.

## Analyse

Onglet intégré, distinct de la correction grammaticale :

- nombre de mots ;
- métriques de prose ;
- part de dialogue ;
- répétitions ;
- comparaison de longueur des chapitres ;
- signalement d’écarts importants ;
- richesse lexicale de surface ;
- courbes ou informations de rythme lorsque `rythme` est renseigné ;
- tableau de bord ;
- analyse linguistique complémentaire si le fournisseur compagnon la propose.

## Relecture

- API publique de fournisseur d’analyse de texte.
- Analyse du document ou de la sélection.
- Signalements avec message, catégorie, sévérité et suggestions.
- Navigation vers la plage concernée.
- Menu contextuel de correction.
- Possibilité pour un compagnon de proposer l’ignorance d’une occurrence ou l’apprentissage d’un mot.
- Aucun moteur grammatical dans le noyau.

## Journal et statistiques

- Journal quotidien.
- Objectifs.
- Calendrier/activité.
- Compilation du Journal.
- Compteurs de mots et statistiques de texte.
- Historique récent.

## Scission, fusion et duplication

- Scission du feuillet actif.
- Duplication.
- Déplacement.
- Fusion de plusieurs scènes.
- Ordre de fusion choisi.
- Modes de séparation.
- Règles de conservation/agrégation des propriétés YAML.
- Protection des propriétés importantes.
- Sélection multiple.

## Aperçu

- Portée feuillet.
- Portée dossier.
- Portée sélection.
- Portée projet.
- Lecture d’un chapitre ou d’une partie.
- Pagination.
- Zoom : largeur, page, manuel.
- Synchronisation de défilement avec l’éditeur dans les cas pris en charge.
- Navigation vers le feuillet visible.
- Fil d’Ariane.
- Panneau Export intégré.
- Première page liée aux documents Front.
- Même moteur de styles que les exports.

![Aperçu paginé](feuillets-apercu.png)

## Composition

- Portée fichier.
- Portée dossier et descendants.
- Portée sélection de fichiers et dossiers.
- Portée projet.
- Déduplication lorsqu’un dossier et un descendant sont tous deux sélectionnés.
- Respect de l’ordre du Classeur.
- Exclusion des dossiers techniques.
- Exclusion individuelle de feuillets via leurs propriétés.
- Titres de dossiers, chapitres et scènes selon les réglages.
- Séparateurs.
- Pages Front.
- Modèles intégrés et personnalisés.
- Styles de titre.
- Typographie française optionnelle à l’export.

## Export

Formats natifs réellement implémentés :

- **DOCX** ;
- **EPUB** ;
- **ODT** ;
- **PDF** sur desktop via la boîte d’impression ;
- **Markdown compilé**.

Le dossier de sortie est `_Sortie`.

## Mise en page

Selon le format et le modèle :

- police ;
- taille ;
- interligne ;
- alignement ;
- retrait ;
- espacement ;
- marges ;
- orientation ;
- colonnes ;
- styles de titres ;
- séparateurs ;
- en-têtes et pieds ;
- pagination ;
- marges miroir ;
- première page différente.

## Révision DOCX

Dans l’onglet Édition :

- import d’un DOCX révisé ;
- lecture des insertions, suppressions, remplacements et commentaires pris en charge ;
- localisation vers les feuillets sources ;
- états à appliquer, à vérifier ou ambigus ;
- décision explicite de l’auteur ;
- protections avant écriture ;
- comparaison avant/après.

Voir [Validation du flux de révision DOCX](DOCX-REVIEW-VALIDATION.md).

## Documents éditoriaux

Création à la demande de `_Edition` avec un socle documentaire :

- `Synopsis.md` ;
- `Note d’intention.md` ;
- `Biographie.md` ;
- `Lettre d’accompagnement.md` ;
- `Soumissions/` ;
- `Versions envoyées/`.

Les documents restent modifiables, renommables ou supprimables comme des fichiers ordinaires.

## Sauvegardes, instantanés et versions

- Sauvegardes ZIP automatiques.
- Sauvegarde manuelle.
- Rotation du nombre de sauvegardes conservées.
- Périmètre sécurisé pour les dossiers utilisés tel quel.
- Instantanés de feuillets.
- Comparaison avec un instantané.
- Duplications du manuscrit dans `_Versions`.
- Ordre du Classeur recopié avec une version.

## Import

- Plan structuré Markdown.
- Projet Scrivener `.scriv`/archive compatible.
- Textes RTF convertis en Markdown lorsque pris en charge.
- Structure du Binder.
- Statuts compatibles.
- Commentaires et données compatibles.
- Images/PDF associés lorsque disponibles.
- Rapport d’import.

## Interface

- Français / anglais.
- Détection de langue et choix explicite.
- Inspecteur à onglets.
- Onglets d’Inspecteur masquables.
- Classeur indépendant de l’Inspecteur.
- Transparence et simplification de plusieurs éléments d’interface.
- Couleur d’accent.
- Gestes de panneau.
- Export/import des réglages.

## Écosystème

- **Feuillets-Grammalecte** : fournisseur d’analyse linguistique.
- **Courrier** : contacts, soumissions et suivi éditorial.
- **Advanced Canvas** : intégration facultative du Carnet.

## Principes de données

- Markdown comme source.
- YAML facultatif.
- Noms historiques reconnus.
- Pas de renommage automatique destructif.
- Pas de télémétrie.
- Pas d’envoi du manuscrit.
