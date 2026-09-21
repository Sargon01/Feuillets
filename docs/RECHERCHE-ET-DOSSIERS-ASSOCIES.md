# Recherche et dossiers associés

> **Français** · [English](RESEARCH-AND-LINKED-FOLDERS.md) · [Index](README.md)

L’espace **Recherche** rassemble la documentation utile au manuscrit sans imposer une structure encyclopédique. Il peut utiliser les dossiers Feuillets habituels, les anciens emplacements reconnus pour compatibilité, et des dossiers existants situés ailleurs dans le coffre.

## Racine Recherche

Lorsqu’une racine Recherche doit être créée, les nouveaux projets utilisent le nom correspondant à la langue active de l’interface : `_Feuillets/Recherche` en français ou `_Feuillets/Research` en anglais. Les formes existantes et les dossiers historiques restent reconnus tels quels ; basculer la langue de l’interface ne renomme jamais de dossier sur disque.

## Associer un dossier existant

Depuis le Classeur, un dossier ou un feuillet peut être associé à **n’importe quel dossier existant du coffre**. Le dossier associé :

- reste à son emplacement d’origine ;
- n’est ni copié ni renommé ;
- peut être situé hors du projet actif ;
- apparaît dans le panneau Recherche sous les dossiers liés.

Un même dossier lié à plusieurs nœuds du Classeur n’a pas besoin d’être dupliqué dans l’interface.

## Dossiers liés externes : lecture et navigation

Un dossier lié situé hors de l’espace Recherche du projet est traité comme une source documentaire externe. Feuillets peut afficher son arborescence et ses fichiers, mais n’en prend pas l’administration.

Pour un fichier Markdown lié, les actions de navigation permettent notamment :

- **Ouvrir dans un nouvel onglet** ;
- **Ouvrir côte à côte**.

Les actions d’écriture structurelle restent absentes depuis ce point d’entrée : pas de renommage, duplication, suppression ou glisser-déposer par Feuillets.

## Dossiers Recherche internes

Les dossiers réellement gérés dans l’espace Recherche du projet conservent leurs outils habituels : création, organisation, renommage, duplication, corbeille et déplacement lorsque l’opération est autorisée.

Cette distinction évite qu’une simple association transforme un dossier documentaire existant en dossier administré par Feuillets.

## Pièces jointes et import de fichiers

L’espace Recherche ne se limite pas aux notes Markdown. Il prend en charge un large éventail de pièces jointes documentaires et visuelles :

- **Documents** : PDF, Word (`.doc`, `.docx`), OpenDocument (`.odt`), texte enrichi (`.rtf`) ;
- **Feuilles de calcul** : Excel (`.xls`, `.xlsx`), OpenDocument (`.ods`), données tabulaires (`.csv`, `.tsv`) ;
- **Présentations et livres numériques** : PowerPoint (`.ppt`, `.pptx`), OpenDocument (`.odp`), EPUB ;
- **Visuels et schémas** : images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`) et dessins Excalidraw.

Le menu d’ajout rapide (`+`) et les actions de ligne permettent d’importer directement des fichiers externes dans un dossier de Recherche ou d’y créer des sous-dossiers. Vous pouvez également réorganiser manuellement les éléments et dossiers de Recherche pour structurer vos sources selon vos besoins.

## Projet et Espace

Sans espace isolé, la Recherche conserve son comportement de **Projet** : elle montre la documentation commune du projet.

Lorsqu’un dossier est isolé, la portée **Espace** peut être consultée séparément de la portée Projet. Elle utilise la Recherche effective du dossier actif :

- association directe au dossier ;
- sinon association héritée d’un ancêtre ;
- si aucun dossier Recherche local ou hérité valide n’existe, la Recherche du projet sert de repli à la vue Espace.

Une Recherche de dossier frère n’est jamais fournie à l’espace courant. L’héritage suit les ancêtres et ne traverse pas les branches. Projet et Espace restent des couches distinctes : deux catégories portant le même nom ne sont pas fusionnées physiquement.

Voir [Un projet, plusieurs espaces de travail](ESPACES-DE-TRAVAIL.md).

## Espaces dans la double vue

Dans la double vue du Classeur, **Recherche** représente la couche commune du projet et **Espaces** regroupe les racines Recherche explicitement associées à des dossiers du Binder.

**Espaces** est un groupe virtuel de navigation. Il ne crée pas de dossier physique, ne déplace ni ne copie les dossiers Recherche et ne fusionne pas leur contenu avec la Recherche du projet. Un dossier associé peut donc rester physiquement sous la racine Recherche tout en apparaissant dans ce groupe.

## Recherche associée et Contexte

L’association sert aussi au **Contexte** du panneau Feuillet. Les dossiers proches du feuillet ou de son chapitre peuvent fournir des références explicites et des correspondances de contenu sans obliger à déplacer la documentation vers `_Feuillets/Recherche`.

Voir [Contexte](How-to-Contexte-Feuillets.md).

## Recherche et Coffre dans la double vue

La double vue du Classeur propose également un accès léger **Coffre**. Les deux mécanismes ne jouent pas le même rôle :

- **Recherche associée** = documentation explicitement reliée au manuscrit et exploitable par les outils de contexte ;
- **Coffre** = navigation libre pour consulter n’importe quel autre document du vault.

Parcourir le Coffre ne crée aucune association Recherche automatiquement.
