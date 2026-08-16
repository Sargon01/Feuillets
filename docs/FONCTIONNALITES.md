# Feuillets — fonctionnalités par usage

> **Français** · [English](FEATURES.md) · [Index](README.md)

## Projets et compatibilité avec les coffres existants

- projets Fiction, Non-fiction et Libre ;
- dossier existant utilisé tel quel ou initialisé ;
- espace auxiliaire `_Feuillets` avec compatibilité legacy non destructive ;
- réglages propres au projet : objectifs, statuts, labels, tags favoris ;
- remappage YAML de synopsis, résumé, statut, POV, label, objectif, fil narratif, personnages et date ;
- plusieurs projets dans le même coffre.

## Classeur

- création/renommage/déplacement ;
- glisser-déposer vers la racine ;
- sélection multiple ;
- recherche titre/contenu ;
- filtres statut/label/progression ;
- aperçu configurable des feuillets ;
- isolation d’un dossier et navigation vers le parent/projet ;
- ouverture dans Aperçu ou Continu ;
- association d’un dossier Recherche existant ;
- vue simple ou **double vue** : arborescence Manuscrit + accès documentaire léger au Coffre à gauche, Classeur 2.5 inchangé à droite.

## Continu

- un seul éditeur continu pour plusieurs feuillets ;
- fichiers sources Markdown conservés séparément ;
- frontières protégées ;
- sauvegarde redistribuée par fichier ;
- portée fichier/dossier/sélection/projet ;
- synchronisation avec Aperçu ;
- aucun fichier composite sur disque.

## Carnet

- Canvas Obsidian ordinaire ;
- capture d’idées ;
- conversion idée → feuillet ou Recherche ;
- Arbre d’idées ;
- branche → plan ;
- réimport idempotent ;
- préservation de l’ordre source lors de l’import de plan.

## Cartes, Plan, Chemin de fer, Chronologie

- Cartes et Plan simplifiés autour de leur rôle ;
- Plan hiérarchique avec colonnes configurables et retour à la ligne optionnel des textes longs ;
- tri naturel comme repli lorsqu’aucun ordre explicite n’est enregistré ;
- Chemin de fer pour les fils narratifs ;
- Chronologie narrative/chronologique.

## Feuillet, notes et annotations

- synopsis/résumé adaptés au type de projet ;
- notes de travail dans le panneau Feuillet ;
- propriétés ;
- notes de bas de page ;
- Contexte local ;
- annotations de travail externes au Markdown, surlignées, éditables et supprimables.

## Recherche

- catégories Fiction/Non-fiction adaptées ;
- Sources et Bibliographie rationalisées ;
- dossiers historiques reconnus ;
- association de n’importe quel dossier existant du coffre à un nœud Binder ;
- dossiers liés externes visibles dans le panneau Recherche ;
- fichiers liés ouvrables dans un nouvel onglet ou côte à côte ;
- aucune copie/renommage/déplacement automatique de ces dossiers depuis Recherche.

## Relecture

Le panneau Relecture regroupe :

- **Analyse de texte** : répétitions et fournisseurs linguistiques optionnels ;
- **Relecture collaborative** : paquets `.feuillets`, notes, plusieurs feuillets, plusieurs tours ;
- **Révision DOCX** : modifications suivies/commentaires Word ;
- **Comparer une version** : instantané vs texte actuel.

## Comparateur

- ajouts, suppressions, remplacements ;
- détection de déplacements/couper-coller ;
- repères `[…]` pour les absences ;
- restauration de passage ;
- double-clic pour recentrer ;
- précédent/suivant ;
- modes Changements / Versions ;
- défilement synchronisé optionnel.

## Relecture collaborative

- portée feuillet/dossier/projet ;
- paquet portable `.feuillets` ;
- copie locale côté relecteur ;
- notes ancrées aux passages ;
- retour vers l’auteur ;
- analyse 3-way avec le manuscrit actuel ;
- appliquer/ignorer/traiter manuellement ;
- fils et tours suivants ;
- archivage local.

## Édition et composition

- espace central, pas onglet latéral ;
- modes Composition et Mise en page ;
- Première page unique dans Composition ;
- pages liminaires ;
- sommaire/table des matières/tables ;
- bibliographie et annexes ;
- structure du manuscrit ;
- gabarits V2 partagés avec Aperçu/export ;
- création/duplication/renommage de gabarits ;
- import Ulysses et Word.

## Mise en page

- Page : format, orientation, marges, miroir, colonnes, gouttière, en-tête/pied ;
- Corps : police, taille, interligne, retrait, espacement, césure, profil ;
- Titres : styles et sauts de page ;
- Citation : marges, couleur, italique, séparateur de scène.

## Export

- Markdown compilé ;
- DOCX ;
- EPUB ;
- ODT ;
- PDF desktop via impression système ;
- barre d’export persistante dans Édition ;
- nom de sortie résolu automatiquement avec compatibilité legacy ;
- collisions de casse macOS gérées lors du remplacement des sorties existantes.

## Import Scrivener

- structure Binder/Draft ;
- textes RTF convertis en Markdown ;
- métadonnées compatibles ;
- Recherche et ressources prises en charge ;
- **ordre Scrivener persistant**, même lorsque le coffre trierait autrement.

## Sécurité et confidentialité

- pas de télémétrie ;
- pas de service distant requis ;
- imports explicitement déclenchés ;
- relecture collaborative par fichier local explicite ;
- APIs Obsidian pour les écritures de coffre ;
- aucun Pandoc ou exécutable de conversion.
