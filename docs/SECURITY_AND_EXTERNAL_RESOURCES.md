# Sécurité, fichiers externes et échanges — Feuillets 2.5

> Document de maintenance complémentaire à [`../SECURITY.md`](../SECURITY.md) et [`../PRIVACY.md`](../PRIVACY.md).

## Principe

Le cœur de Feuillets travaille localement avec des fichiers du coffre Obsidian. Les accès à des fichiers externes correspondent à des actions explicites de l’utilisateur, pas à une exploration en arrière-plan du système de fichiers.

## Écritures ordinaires dans le coffre

Création, modification, renommage et suppression de contenu de projet passent par les API Obsidian (`vault`, `fileManager`, `processFrontMatter`) autant que possible.

La double vue du Classeur peut parcourir le **Coffre**, mais cette navigation n’accorde aucune action d’administration supplémentaire : elle sert à ouvrir des fichiers, pas à gérer le vault à la place du File Explorer.

## Dossiers Recherche externes associés

Un chemin de dossier existant peut être mémorisé dans `researchFolderLinks` pour relier la documentation à un feuillet/dossier du manuscrit.

L’association :

- ne copie pas le dossier ;
- ne le déplace pas ;
- ne le renomme pas ;
- ne l’ajoute pas à la compilation ;
- peut pointer hors du projet actif mais reste dans le vault Obsidian.

Le panneau Recherche affiche ces dossiers externes en navigation seule. Ouvrir un fichier dans un nouvel onglet ou côte à côte n’en change pas la propriété ni la portée.

## Import Scrivener

L’import `.scriv` nécessite un accès au système de fichiers sur desktop parce qu’un projet Scrivener est un paquet/répertoire externe au vault. Cette opération est explicitement déclenchée par l’utilisateur et limitée à la source choisie.

La documentation de sécurité ne doit donc pas affirmer que Feuillets « n’accède jamais au filesystem ». La formulation correcte est : les opérations normales de projet utilisent les API du vault ; certains imports desktop lisent explicitement une source externe choisie par l’utilisateur.

## Révision DOCX

L’import d’un DOCX relu est également une action explicite. Le document choisi est analysé localement afin de rattacher les commentaires/modifications suivies au manuscrit.

## Relecture collaborative `.feuillets`

Les paquets `.feuillets` sont des fichiers d’échange volontairement créés et transmis par l’utilisateur.

Feuillets ne possède pas de serveur de relecture collaborative et n’envoie pas automatiquement ces paquets sur le réseau. Le transfert éventuel passe par le canal choisi par l’auteur/relecteur (mail, cloud, messagerie, etc.), soumis à la politique de ce service externe.

Le paquet doit rester limité à la portée de relecture nécessaire et à ses métadonnées de session ; il n’a pas à contenir le reste du coffre.

## Export

DOCX, EPUB et ODT sont générés localement. PDF utilise le flux d’impression système sur desktop. Aucun Pandoc, shell ou convertisseur téléchargé n’est requis par le pipeline natif actuel.

## Fournisseurs linguistiques

Le noyau expose un contrat pour qu’un plugin compagnon puisse fournir une analyse de texte. Le compagnon est un logiciel séparé : son comportement réseau/confidentialité ne doit pas être attribué au noyau Feuillets.

## Points de revue avant release

- aucune nouvelle dépendance réseau inutile ;
- aucune utilisation de `child_process`/shell pour les exports ;
- aucun scan de chemins externes non demandé ;
- scopes de sauvegarde/Sortie limités au projet réel ;
- dossiers Recherche externes non administrables depuis leur projection ;
- paquets collaboratifs limités à leur portée ;
- `npm run lint:obsidian` propre.
