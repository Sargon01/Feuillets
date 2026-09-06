# Le parcours d’un auteur, du premier mot à l’export

> **Français** · [English](AUTHOR-WORKFLOW.md) · [Index](README.md)

Ce guide suit un projet dans son ordre naturel. Chaque étape reste facultative : Feuillets propose un environnement autour des mêmes fichiers Markdown, pas une méthode obligatoire.

## Penser

Avant d’écrire, un auteur peut garder les idées à l’échelle du projet ou d’un dossier avec le **Carnet**. Le Canvas reste libre ; il peut accueillir un **Plan du Binder**, des fichiers, des liens ou des **mindmaps**. Une idée peut ensuite devenir un feuillet ou une note Recherche lorsque cela est utile.

Un Carnet global convient à la vue d’ensemble ; un Carnet attaché à un dossier concentre la réflexion sur une partie du manuscrit. Un dossier Recherche associé peut partager le même Carnet logique. Voir [Le Carnet — des idées au manuscrit](HOW-TO-CARNET.md).

## Organiser

Le **Classeur** donne une structure de travail au manuscrit : créer, renommer, déplacer, rechercher, filtrer et sélectionner les feuillets. Un dossier peut être isolé pour travailler localement, puis l’auteur peut revenir au parent ou au projet complet ; cela ne déplace ni ne copie les fichiers.

Le **Tableau** relit cette même structure selon plusieurs modes : **Cartes**, **Plan**, **Chemin de fer** et **Chronologie**. Le Chemin de fer peut suivre des fils narratifs, des personnages ou POV, des arcs, des statuts et des labels selon les propriétés prises en charge. Un fil peut relier plusieurs feuillets pour suivre un objet, une promesse, un conflit ou un motif sans créer un système documentaire séparé. Sa première et sa dernière occurrence peuvent naturellement servir d’ouverture et de résolution, tandis que les occurrences intermédiaires en montrent le développement ; Feuillets n’attribue pas automatiquement ces rôles.

Dans **Projet**, les objectifs, statuts, labels, tags favoris et le remappage des propriétés YAML peuvent être adaptés au coffre existant. La double vue ajoute une navigation à gauche sans remplacer le Classeur de travail.

## Documenter

La **Recherche** accepte des notes Markdown libres : personnage, lieu, événement, objet, institution, notion, source ou toute autre documentation utile. Les propriétés structurées sont facultatives. Un dossier existant peut être associé depuis le Classeur sans être déplacé.

Le **Contexte** examine le passage autour du curseur et rapproche les fiches Recherche pertinentes à partir d’indices locaux, lexicaux et déterministes : titres, alias, tags, contenu documentaire et informations chronologiques reconnues. Il ne se limite pas aux personnages. Une fiche Personnage peut par exemple contenir des événements datés ; dans un passage daté qui le mentionne, sa chronologie peut aider à vérifier une présence, un décès ou un événement déjà survenu.

Les espaces de travail permettent de conserver cette documentation à l’échelle pertinente d’une partie du projet sans créer de sous-projet. Voir [Un projet, plusieurs espaces de travail](ESPACES-DE-TRAVAIL.md).

Les **citations** relient les sources Recherche au manuscrit. Selon la configuration, l’Aperçu Pandoc/Zotero peut afficher les citekeys ou une forme auteur-date, et la bibliographie reprend les sources utiles. Lors d’une compilation, Feuillets peut limiter la bibliographie aux sources réellement citées dans la portée compilée.

## Écrire

Écrivez dans l’éditeur Markdown natif : les fichiers restent de vrais fichiers Markdown. La largeur de texte, la typographie, l’interligne, les alinéas, la Concentration, la recherche/remplacement, les notes de bas de page et les citations adaptent la surface de travail sans retirer la souplesse du format.

**Réorganiser le texte** permet de déplacer par glisser-déposer un paragraphe, ou une sélection contenue dans un seul paragraphe. Le point d’insertion est visible, **Échap** quitte ce mode local et chaque déplacement reste une étape Annuler qui conserve le Markdown exact.

Lorsque le découpage en fichiers devient gênant pour l’écriture, ouvrez un fichier, un dossier ou une sélection en **Continu**. Les feuillets restent séparés, leurs frontières sont protégées et les modifications repartent vers les fichiers correspondants : aucun fichier composite permanent n’est créé sur disque. Voir [Mode Continu](MODE-CONTINU.md).

## Relire

L’**Aperçu** lit une portée — feuillet, dossier, sélection ou projet — comme un document composé et paginé. Il permet de contrôler les titres, images, tableaux, typographie, modèles et notes de bas de page placées dans la composition. L’éditeur sert à travailler le texte, Continu à travailler plusieurs feuillets comme un texte, et l’Aperçu à lire le résultat ; aucune de ces étapes ne remplace les fichiers sources.

Le **Carnet**, le panneau **Feuillet** et le panneau **Recherche** restent disponibles autour du texte lorsque l’auteur doit revenir à ses notes, propriétés, annotations ou sources.

## Réviser

La révision peut suivre plusieurs niveaux :

1. annoter un passage ou garder une note de travail ;
2. prendre un **instantané** avant une réécriture importante ;
3. utiliser **Comparer une version** pour distinguer ajouts, suppressions, remplacements et déplacements ;
4. recevoir des retours avec la **Relecture collaborative** ;
5. traiter un document Word avec **Révision DOCX** et ses commentaires ou modifications suivies ;
6. décider, puis restaurer un passage précis ou appliquer les changements.

Les annotations de travail restent hors du Markdown. Ces outils ont des formats et des usages distincts, même s’ils participent au même travail de révision. Voir [Réécriture, sauvegardes et versions](VERSIONNAGE-ET-SECURITE.md).

**Comparer une version** possède les modes **Changements** et **Versions** : les ajouts, suppressions, remplacements et déplacements sont distingués, le défilement synchronisé est optionnel et un passage précis peut être restauré sans restaurer tout le fichier.

**Relecture** comprend également l’**Analyse de texte**. La **Relecture collaborative** compare le texte envoyé, le retour du relecteur et le manuscrit actuel avant décision ; **Révision DOCX** permet de traiter les commentaires et modifications suivies de Word tout en gardant Markdown comme source.

## Mettre en forme

Dans **Édition**, **Composition** choisit le contenu, la Première page, les pages liminaires, les éléments générés, la bibliographie, les annexes et la structure. **Mise en page** règle Page, Corps de texte, Titres et Citation. Les rôles sémantiques facultatifs peuvent produire variantes, extractions et collections sans dupliquer le manuscrit.

L’Édition travaille à côté du vrai Aperçu et partage ses gabarits avec les exports. La **Présentation 16:9** peut également réutiliser le même Markdown lorsque ce format est pertinent.

## Publier

L’export produit les formats pris en charge — Markdown compilé, DOCX, EPUB, ODT et PDF desktop — depuis la portée choisie. L’Aperçu aide à contrôler le document mais n’est pas obligatoire pour exporter.

Un projet peut commencer par un dossier existant, un nouveau projet Fiction, Non-fiction ou Libre, ou un import Scrivener. Il reste un ensemble de fichiers Markdown et de dossiers ordinaires ; les sauvegardes ZIP, instantanés, comparaison et versions se complètent sans remplacer une sauvegarde globale du coffre.

Un projet peut aussi être exporté ou importé comme archive portable `.feuil` sans convertir le manuscrit hors Markdown.
