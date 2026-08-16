# Feuillets

**English version: [README.md](README.md)**

## Écrivez d’abord. Organisez quand le texte en a besoin.

**Feuillets transforme Obsidian en atelier d’écriture et d’édition pour les textes qui peuvent rester un feuillet ou devenir un livre.**

Vos textes restent de simples fichiers Markdown et vos dossiers restent de vrais dossiers. Feuillets ajoute autour d’eux un Classeur, des vues de structure, un mode Continu, la Recherche, la relecture, la composition et l’export — sans format propriétaire.

> **Le texte avant le système.**

![Feuillets — écriture et aperçu](docs/feuillets-ecriture-apercu.png)

## Du feuillet au manuscrit

Un feuillet peut rester un article, une nouvelle, une chronique ou un chapitre autonome. Plusieurs feuillets peuvent devenir un recueil. Un projet long peut ajouter progressivement :

- un **Classeur** hiérarchique ;
- des **Cartes**, un **Plan**, un **Chemin de fer** et une **Chronologie** ;
- un **Carnet** d’idées ;
- un espace **Recherche** ;
- des **annotations de travail** ;
- le mode **Continu**, pour écrire plusieurs feuillets comme un seul manuscrit ;
- des instantanés, versions, sauvegardes et comparaisons ;
- une **relecture collaborative** native ;
- la révision des retours **DOCX** ;
- un espace **Édition** pour la Composition et la Mise en page ;
- des exports Markdown, DOCX, EPUB, ODT et PDF.

## Commencer avec un dossier existant

N’importe quel dossier déjà présent dans le coffre peut devenir un projet Feuillets **sans déplacer, renommer ni convertir ses fichiers personnels**.

Feuillets peut également créer un projet **Fiction**, **Non-fiction** ou **Libre**. Les espaces auxiliaires sont regroupés sous `_Feuillets` lorsqu’ils sont nécessaires : Recherche, Ressources, Edition, Journal, Snapshots, Backups et Sortie. Les chemins historiques restent reconnus sans migration destructive.

![Créer un projet Feuillets](docs/creer-premier-projet.gif)

## Écrire

Le feuillet reste ouvert dans l’éditeur Markdown natif d’Obsidian. Feuillets peut ajouter largeur de texte, typographie, alinéas, interligne, aides typographiques, recherche/remplacement, notes de bas de page, citations, défilement machine à écrire et mode **Concentration**.

![Écrire avec typographie contrôlée et Mode Concentration](docs/feuillets-concentration.png)

## Organiser avec le Classeur

Le **Classeur** sert d’abord à trouver et déplacer les textes. Il permet notamment de :

- créer, renommer et déplacer dossiers et feuillets ;
- sélectionner plusieurs éléments ;
- rechercher et filtrer ;
- isoler un dossier puis revenir au projet complet ;
- ouvrir un fichier, un dossier ou une sélection dans l’**Aperçu** ;
- ouvrir un dossier ou une portée en **Continu** ;
- associer un dossier Recherche existant, même ailleurs dans le coffre ;
- basculer entre le **Classeur simple** et la **double vue**.

En double vue, un volet gauche ajoute deux accès sans modifier le Classeur de droite : **Manuscrit** affiche uniquement l’arborescence des dossiers pour lire la structure d’un coup d’œil ; **Coffre** permet de parcourir et d’ouvrir des documents du vault en lecture/navigation seule. Le volet droit conserve exactement les mêmes lignes, menus, sélections et interactions qu’en vue simple.

![Le Classeur avec organisation du manuscrit](docs/feuillets-classeur.png)

Voir [Classeur et navigation](docs/CLASSEUR-ET-NAVIGATION.md).

## Continu : plusieurs fichiers, un seul manuscrit éditable

Le mode **Continu** assemble un fichier, un dossier, une sélection ou un projet dans **un seul éditeur continu**. Les séparations entre feuillets restent visibles et protégées ; chaque modification est redistribuée dans le fichier Markdown source correspondant.

Aucun manuscrit composite n’est créé sur disque et aucun lot d’onglets Obsidian n’est ouvert. Continu et Aperçu peuvent rester synchronisés sur la même portée.

Voir [Mode Continu](docs/MODE-CONTINU.md).

## Plusieurs vues des mêmes fichiers

| Besoin | Vue |
|---|---|
| Naviguer | Classeur |
| Réorganiser visuellement | Cartes |
| Contrôler les informations | Plan |
| Suivre les fils narratifs | Chemin de fer |
| Vérifier l’ordre des événements | Chronologie |
| Écrire plusieurs feuillets ensemble | Continu |
| Lire le document composé | Aperçu |
| Explorer librement | Carnet |

Ces vues ne créent pas de base parallèle : elles montrent les mêmes fichiers sous des angles différents.

![Plusieurs vues : Chemin de fer, Plan, Chronologie et Cartes](docs/feuillets-mosaique-narrative.png)

## Le panneau droit

Le panneau Feuillets réunit désormais cinq espaces :

| Onglet | Rôle |
|---|---|
| **Feuillet** | Synopsis, résumé, notes de travail, propriétés, annotations, notes de bas de page et Contexte |
| **Recherche** | Documentation, personnages, lieux, événements, sources, bibliographie et dossiers associés |
| **Journal** | Journal d’écriture et suivi |
| **Projet** | Informations, objectifs, statuts, labels, tags et remappage YAML propres au projet |
| **Relecture** | Analyse de texte, relecture collaborative, Révision DOCX et comparaison avec un instantané |

**Édition** n’est plus un onglet de l’Inspecteur : c’est un espace central dédié à la Composition et à la Mise en page.

## Recherche adaptée au coffre existant

Feuillets reconnaît ses racines Recherche habituelles, mais vous pouvez aussi **associer n’importe quel dossier existant du coffre** à un dossier ou un feuillet du Classeur. Ces dossiers liés apparaissent dans le panneau Recherche sans être déplacés, copiés ou renommés. Leurs fichiers restent navigables : ils peuvent être ouverts dans un nouvel onglet ou côte à côte, tandis que les opérations d’administration restent désactivées depuis ce point d’entrée.

Voir [Recherche et dossiers associés](docs/RECHERCHE-ET-DOSSIERS-ASSOCIES.md).

## Propriétés YAML adaptées au projet

Dans **Projet → Propriétés YAML**, Feuillets peut mapper ses champs logiques vers des propriétés déjà présentes dans votre coffre : synopsis, résumé, statut, POV, label, objectif, fil narratif, personnages et date.

Le mapping n’effectue aucune migration destructive. Feuillets s’adapte aux propriétés existantes plutôt que d’exiger leur renommage.

Voir [Projet et propriétés YAML](docs/PROJET-ET-PROPRIETES-YAML.md).

## Annotations de travail

Une sélection du manuscrit peut recevoir une annotation libre. Le passage est surligné dans l’éditeur, l’annotation peut être relue, modifiée ou supprimée, et une liste permet de retrouver les annotations du projet.

Les annotations restent **hors du Markdown** et ne sont pas exportées.

Voir [Annotations de travail](docs/ANNOTATIONS-DE-TRAVAIL.md).

## Relecture et comparaison

La relecture distingue plusieurs besoins :

- **Analyse de texte** et fournisseurs linguistiques facultatifs ;
- **Relecture collaborative** native par paquets `.feuillets` ;
- **Révision DOCX** pour les commentaires et modifications suivies provenant de Word ;
- **Comparaison** avec un instantané ou une autre version.

Le comparateur distingue ajouts, suppressions, remplacements et déplacements. Les couper/coller peuvent être reconnus comme déplacements. Les modes **Changements** et **Versions** permettent soit de traiter les différences, soit de lire les deux états sans décorations. Le défilement synchronisé est optionnel.

![Vue de comparaison avec détection des changements](docs/feuillets-comparaison.png)

Voir [Réécriture, sauvegardes et versions](docs/VERSIONNAGE-ET-SECURITE.md).

## Relecture collaborative

Feuillets peut créer un paquet `.feuillets` pour un feuillet, un dossier ou le projet. Le relecteur l’importe dans Feuillets, travaille sur une copie locale, ajoute des notes et renvoie son retour. L’auteur importe ce retour, compare les changements avec le texte envoyé **et** avec son manuscrit actuel, puis applique, ignore ou traite manuellement chaque proposition.

Le flux peut se poursuivre sur plusieurs tours sans exposer le reste du coffre.

Voir [Relecture collaborative](docs/RELECTURE-COLLABORATIVE.md).

## Édition : Composition et Mise en page

L’espace central **Édition** contient deux modes :

- **Composition** : contenu du manuscrit, Première page, pages liminaires, sommaire/table des matières, tables, bibliographie, annexes et structure ;
- **Mise en page** : Page, Corps de texte, Titres et Citation.

La **Première page** n’existe qu’à un seul endroit : Composition. Sa présentation réutilise le même gabarit que l’Aperçu et les exports.

La barre d’Édition conserve en permanence la portée, le format, le bouton **Exporter** et l’actualisation de l’Aperçu. Le nom de fichier n’est plus un réglage visible : Feuillets gère le nom de sortie et conserve les valeurs historiques pour compatibilité.

Voir [Composition et export](docs/COMPOSITION-ET-EXPORT.md).

## Aperçu et export

L’**Aperçu** est le vrai document paginé utilisé pour juger la composition. Il peut représenter un feuillet, un dossier, une sélection ou le projet complet.

Formats natifs :

- **Markdown compilé** ;
- **DOCX** ;
- **EPUB** ;
- **ODT** ;
- **PDF** via la boîte d’impression système sur ordinateur.

Les gabarits V2 sont partagés entre Aperçu et exports. Ils peuvent être créés, dupliqués, renommés ou importés depuis des styles Ulysses ou des modèles Word lorsque les propriétés sont représentables.

![Aperçu avec pagination et formatage](docs/feuillets-apercu.png)

## Importer depuis Scrivener

Sur ordinateur, Feuillets peut importer un projet Scrivener et récupérer la structure compatible du Binder, les textes, métadonnées utiles, Recherche et ressources. **L’ordre du Binder Scrivener est désormais conservé explicitement**, indépendamment du tri alphabétique du coffre.

![Importer Scrivener avec préservation complète de la structure](docs/feuillets-import-scrivener.png)

Voir [Importer un projet Scrivener](docs/IMPORT-SCRIVENER.md).

## Liberté, confidentialité et sécurité

- Markdown et dossiers ordinaires ;
- fonctionnement local ;
- aucune télémétrie ;
- aucun envoi du manuscrit vers un service Feuillets ;
- aucun Pandoc ni exécutable externe pour les exports ;
- relecture collaborative transportée par fichiers `.feuillets` explicitement échangés par l’utilisateur ;
- import Scrivener déclenché explicitement sur ordinateur ;
- code GPL-3.0.

Voir [PRIVACY.md](PRIVACY.md) et [SECURITY.md](SECURITY.md).

## Installation

### Galerie des plugins communautaires

1. Ouvrez **Paramètres → Plugins communautaires**.
2. Recherchez **Feuillets**.
3. Cliquez sur **Installer**, puis **Activer**.

Feuillets nécessite Obsidian 1.13.0 ou plus récent.

### Installation manuelle

Téléchargez `main.js`, `manifest.json` et `styles.css` depuis la [dernière version sur GitHub](https://github.com/Sargon01/Feuillets/releases/latest) et placez-les dans :

```
<votre coffre>/.obsidian/plugins/feuillets/
```

Puis activez le plugin dans **Paramètres → Plugins communautaires → Plugins installés**.

## Écosystème

Feuillets fonctionne de manière indépendante et s'associe bien avec :

- **[Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte)** — Vérification grammaticale française et anglaise intégrée au panneau Relecture.
- **[Courrier](https://github.com/Sargon01/Courrier)** — Import/export Word et support de la Révision DOCX.
- **[Advanced Canvas](https://github.com/Sargon01/Advanced-Canvas)** — Fonctionnalités Canvas améliorées pour le Carnet et la visualisation de recherche.

![Écosystème Feuillets](docs/feuillets-ecosysteme.png)

## Documentation

La documentation complète est indexée dans [docs/README.md](docs/README.md).

> **Feuillets — écrivez d’abord, construisez ensuite.**
