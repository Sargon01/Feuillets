# Feuillets

**English version: [README.md](README.md)**

## Écrivez un livre, pas une collection de notes

**Feuillets transforme Obsidian en atelier d’écriture longue, libre, local et gratuit.**

Le principe est simple : le **Classeur** garde le manuscrit visible, le **feuillet** reste le lieu où l’on écrit, le mode **Concentration** efface le bruit, l’**Aperçu** permet de lire le texte comme un livre, puis Feuillets compose et exporte le résultat.

> **Aussi simple qu’une page. Aussi riche qu’un projet de livre.**

![Feuillets — Classeur, écriture et aperçu](docs/feuillets-ecriture-apercu.png)

*Écrivez dans le feuillet. Relisez le livre.*

## Ce que Feuillets ajoute à Obsidian

Obsidian fournit le coffre, les fichiers Markdown, les liens et l’écosystème. Feuillets ajoute l’atelier spécialisé de l’auteur :

- un **Classeur** hiérarchique pour parties, chapitres, scènes, sections et feuillets ;
- **Cartes**, **Plan**, **Chemin de fer** et **Chronologie** pour examiner le même manuscrit sous plusieurs angles ;
- un **Carnet** fondé sur Canvas pour explorer librement des idées avant de les transformer en texte ;
- un **Inspecteur** à onglets : Notes, Recherche, Journal, Édition, Analyse et Relecture ;
- un mode **Concentration** et une présentation d’écriture littéraire ;
- un **Aperçu paginé** de la scène, du chapitre, de la partie ou du manuscrit ;
- des outils de **scission, fusion, déplacement, duplication et sélection multiple** ;
- des **objectifs, statistiques et journal d’écriture** ;
- des **instantanés, comparaisons, versions et sauvegardes ZIP** ;
- la **composition** d’un fichier, d’un dossier, d’une sélection ou du projet entier ;
- des exports **DOCX, EPUB, ODT, PDF et Markdown compilé** ;
- l’import d’un **plan Markdown** et l’import d’un projet **Scrivener**.

Feuillets ne remplace pas l’éditeur d’Obsidian : il l’organise autour du travail d’écriture longue.

## Commencer

### Créer un projet

Depuis l’accueil du Classeur, choisissez **Créer un projet** puis le type :

- **Fiction** ;
- **Non-fiction** ;
- **Libre**.

Un projet créé par Feuillets utilise une structure claire :

```text
Mon projet/
├── Manuscrit/
├── _Recherche/ ou _Research/
├── _Ressources/ ou _Resources/
└── Front/ se trouve dans Manuscrit/
```

Les autres espaces techniques (`_Backups`, `_Snapshots`, `_Journal`, `_Edition`, `_Sortie`, `_Versions`) ne sont créés que lorsqu’ils sont nécessaires.

![Créer un premier projet](docs/creer-premier-projet.gif)

### Utiliser un dossier existant tel quel

Vous pouvez aussi choisir n’importe quel dossier déjà présent dans le coffre et l’utiliser comme manuscrit **sans déplacer, renommer ni convertir ses fichiers**.

C’est la voie la plus simple pour un ensemble de notes Markdown déjà existant.

### Initialiser un dossier comme projet Feuillets

Depuis l’Explorateur de fichiers d’Obsidian, l’action **Initialiser comme projet Feuillets…** permet d’associer un type de projet à un dossier existant et de préparer les catégories de Recherche correspondantes, sans restructurer le manuscrit.

## Le Classeur

Le Classeur est la colonne vertébrale du projet. Il permet de :

- naviguer dans la hiérarchie ;
- créer et renommer dossiers et feuillets ;
- déplacer des éléments par glisser-déposer, y compris vers la racine du manuscrit ;
- sélectionner plusieurs éléments ;
- chercher dans les titres ou le contenu ;
- filtrer par statut, label ou progression ;
- afficher au choix extrait, synopsis, résumé, notes, tags, statut, progression ou nombre de mots ;
- ouvrir un fichier, un dossier ou une sélection directement dans l’Aperçu ;
- compiler un fichier, un dossier ou une sélection.

![Le Classeur](docs/feuillets-classeur.png)

*Le livre reste visible pendant que vous écrivez.*

## Écrire et se concentrer

Le manuscrit reste constitué de fichiers Markdown ordinaires. Feuillets améliore leur présentation sans créer de format propriétaire :

- largeur de texte maîtrisée ;
- typographie et interligne réglables ;
- alinéas et paragraphes adaptés à la prose ;
- syntaxe Markdown rendue discrète ;
- aides typographiques françaises ;
- recherche/remplacement à l’échelle du manuscrit ;
- notes de bas de page et citations.

Le mode **Concentration** peut masquer les panneaux, centrer le texte, conserver la ligne active dans une zone confortable, estomper le reste et afficher un compteur discret.

![Mode Concentration](docs/feuillets-concentration.png)

## L’Inspecteur

Le panneau droit réunit les outils qui accompagnent l’écriture. Chaque onglet peut être affiché ou masqué dans les réglages.

| Onglet | Rôle |
|---|---|
| **Notes** | Synopsis, résumé, notes de travail, propriétés, notes de bas de page et contexte du passage |
| **Recherche** | Bible du projet, sources, bibliographie, personnages, lieux, événements et rubriques personnalisées |
| **Journal** | Journal d’écriture et suivi |
| **Édition** | Documents éditoriaux et réintégration des révisions DOCX |
| **Analyse** | Métriques de prose, répétitions, équilibre des chapitres, rythme et tableau de bord |
| **Relecture** | Résultats fournis par un module compagnon d’analyse linguistique |

Feuillets ne contient pas lui-même de moteur grammatical. Le contrat public d’analyse permet à un module compagnon, comme **Feuillets-Grammalecte**, de fournir les signalements tandis que Feuillets gère l’affichage, la navigation et les corrections.

## Recherche et contexte

La Recherche sert de bible du projet. Les rubriques proposées dépendent du type de projet :

- **Fiction** : personnages, lieux, événements, lore, glossaire, bibliographie ;
- **Non-fiction** : sources, bibliographie, notes ;
- **Libre** : aucune rubrique métier imposée.

Vous pouvez ajouter vos propres rubriques. Les anciens noms français et anglais restent reconnus afin de ne pas dupliquer les dossiers d’un projet existant.

Dans **Notes**, la section **Contexte** peut rapprocher le passage courant de fiches de Recherche, d’associations explicites et d’informations chronologiques. Le rapprochement est local et déterministe : aucune IA distante n’analyse le manuscrit.

## Cartes, Plan, Chemin de fer et Chronologie

![Cartes, Plan, Chemin de fer et Chronologie](docs/feuillets-mosaique-narrative.png)

*Un même manuscrit, plusieurs angles de lecture.*

| Question | Vue |
|---|---|
| Où se trouve ce texte ? | Classeur |
| Comment réordonner les scènes visuellement ? | Cartes |
| Quelles informations manquent ou déséquilibrent le manuscrit ? | Plan |
| Où passent les fils narratifs ? | Chemin de fer |
| Dans quel ordre les événements se produisent-ils ? | Chronologie |
| Comment le texte se lit-il une fois composé ? | Aperçu |
| Où jeter, relier et faire mûrir des idées ? | Carnet |

Le **Carnet** repose sur Canvas natif. **Advanced Canvas** reste facultatif ; s’il est installé, Feuillets peut profiter de ses interactions enrichies sans en faire une dépendance.

## Aperçu, composition et export

L’Aperçu peut travailler sur :

- un feuillet ;
- un dossier ;
- une sélection ;
- le projet complet.

La scène active se met à jour rapidement ; les portées longues privilégient la stabilité de lecture. L’Aperçu et les exports utilisent la même logique de titres, séparateurs, pages liminaires et modèles.

![Aperçu paginé](docs/feuillets-apercu.png)

Les formats actuellement pris en charge par le moteur natif sont :

- **DOCX** ;
- **EPUB** ;
- **ODT** ;
- **PDF** — via la boîte d’impression du système, sur ordinateur ;
- **Markdown compilé**.

Les sorties sont placées dans `_Sortie`. Pour un projet structuré autour de `Manuscrit`, `_Sortie` est créé à côté de `Manuscrit`. Pour un dossier utilisé tel quel, `_Sortie` reste à l’intérieur de ce dossier : Feuillets ne remonte pas arbitrairement dans le coffre.

## Réécrire sans perdre

Feuillets distingue plusieurs niveaux de protection :

- **instantané** d’un feuillet pour marquer un état précis ;
- **comparaison** entre états ;
- **version** du manuscrit pour explorer une autre direction ;
- **sauvegarde ZIP** automatique ou manuelle du projet actif.

![Comparer deux états](docs/feuillets-comparaison.png)

Une sauvegarde d’un projet structuré couvre le dossier qui contient `Manuscrit` et ses espaces associés. Un dossier utilisé tel quel est sauvegardé **strictement dans son propre périmètre** ; Feuillets ne sauvegarde pas ses dossiers frères ni la racine entière du coffre.

## Importer depuis Scrivener

L’import Scrivener récupère la structure du Binder, les textes et les éléments compatibles, puis les transforme en fichiers et dossiers du coffre.

![Import Scrivener](docs/feuillets-import-scrivener.png)

*Changez d’atelier, pas de manuscrit.*

Le guide détaillé se trouve dans [Importer un projet Scrivener](docs/IMPORT-SCRIVENER.md).

## Écosystème

Feuillets garde son noyau centré sur l’écriture et délègue les domaines spécialisés à des modules compagnons :

- **[Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte)** — analyse linguistique française ;
- **[Courrier](https://github.com/Sargon01/Courrier)** — contacts, soumissions, réponses, relances et suivi éditorial.

![Écosystème Feuillets](docs/feuillets-ecosysteme.png)

## Liberté, confidentialité et sécurité

- fichiers source en **Markdown** ;
- fonctionnement local ;
- **aucune télémétrie** ;
- **aucun envoi du manuscrit vers un service distant** ;
- aucun moteur grammatical téléchargé ou exécuté par Feuillets ;
- aucune dépendance à Pandoc ;
- code source sous **GNU GPL-3.0** ;
- build non minifié et vérifiable ;
- tests, TypeScript, ESLint et revue Obsidian dans l’intégration continue.

Feuillets requiert **Obsidian 1.13.0 ou plus récent**. Le plugin n’est pas déclaré desktop-only ; l’export PDF reste toutefois une fonction desktop, car il passe par la boîte d’impression.

Voir [PRIVACY.md](PRIVACY.md) et [SECURITY.md](SECURITY.md).

## Installation

### Modules communautaires d’Obsidian

1. Ouvrez **Réglages → Modules communautaires**.
2. Recherchez **Feuillets**.
3. Installez puis activez le module.

### Installation manuelle

Téléchargez `main.js`, `manifest.json` et `styles.css` depuis la dernière release puis placez-les dans :

```text
<votre coffre>/.obsidian/plugins/feuillets/
```

Rechargez Obsidian et activez Feuillets.

## Documentation

La documentation complète est indexée dans **[docs/README.md](docs/README.md)**.

Pour commencer :

- [Découvrir Feuillets](docs/DECOUVRIR.md)
- [Le parcours d’un auteur](docs/PARCOURS-AUTEUR.md)
- [Fonctionnalités](docs/FONCTIONNALITES.md)
- [Interface d’écriture](docs/SETUP-INTERFACE.md)
- [Composition et export](docs/COMPOSITION-ET-EXPORT.md)
- [Réécriture, sauvegardes et versions](docs/VERSIONNAGE-ET-SECURITE.md)
- [Contexte intelligent local](docs/How-to-Contexte-Feuillets.md)
- [Importer depuis Scrivener](docs/IMPORT-SCRIVENER.md)

> **Feuillets — l’atelier libre du manuscrit.**
