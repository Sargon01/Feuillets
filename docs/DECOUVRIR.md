# Découvrir Feuillets

> **Français** · [English](DISCOVER.md) · [Index de la documentation](README.md)

## Un atelier d’écriture construit dans Obsidian

Feuillets part d’une idée simple : l’auteur doit pouvoir travailler dans Obsidian sans avoir l’impression de gérer une collection de notes isolées.

Le manuscrit reste en Markdown, mais Feuillets lui donne une structure, des vues de travail, un espace de recherche, des outils de réécriture et une chaîne de composition.

![Feuillets — vue d’ensemble](feuillets-ecriture-apercu.png)

Le parcours minimal est volontairement court :

> **Classeur → feuillet → Concentration → Aperçu → export**

Tout le reste peut rester fermé jusqu’au moment où le projet en a besoin.

## Le feuillet

Le **feuillet** est une unité de travail indépendante. Selon le projet, il peut être :

- une scène ;
- une section ;
- un chapitre court ;
- un fragment ;
- une page liminaire ;
- n’importe quel texte que vous souhaitez déplacer, comparer ou exclure séparément.

Un feuillet est un fichier Markdown ordinaire. Feuillets ajoute du contexte et des actions autour de lui ; il ne le transforme pas en document propriétaire.

## Trois types de projet

### Fiction

La fiction privilégie le vocabulaire des scènes et propose des catégories de Recherche adaptées : personnages, lieux, événements, lore, glossaire et bibliographie.

### Non-fiction

La non-fiction privilégie les sections et crée un socle plus neutre : Sources, Bibliographie et Notes. Les rubriques propres au sujet sont laissées à l’auteur.

### Libre

Le mode Libre n’impose aucune rubrique métier. Il convient aux recueils, dossiers d’articles, essais composites ou projets dont la structure ne correspond pas aux deux autres modes.

Le type de projet règle surtout le vocabulaire et les valeurs de départ. Il ne verrouille pas la hiérarchie.

## Trois façons de commencer

### Créer un projet Feuillets

Feuillets prépare un dossier `Manuscrit`, une page de titre et un premier contenu prêt à écrire. Les espaces Recherche et Ressources sont placés à côté du manuscrit.

![Créer un premier projet](creer-premier-projet.gif)

### Utiliser un dossier existant tel quel

Choisissez un dossier déjà présent dans le coffre. Feuillets l’utilise comme manuscrit **sans déplacer, renommer ou créer de fichier à l’ouverture**.

Cette option convient particulièrement aux auteurs qui possèdent déjà une arborescence Markdown.

### Initialiser un dossier existant

L’action **Initialiser comme projet Feuillets…** associe un type au dossier et prépare les rubriques de Recherche utiles. Le manuscrit existant reste à sa place.

## Le Classeur

Le Classeur est la représentation structurelle du manuscrit.

![Classeur](feuillets-classeur.png)

Il permet notamment de :

- parcourir dossiers et feuillets ;
- basculer entre double volet, dossiers seuls et fichiers seuls ;
- créer et renommer les éléments ;
- déplacer les éléments et revenir à la racine ;
- sélectionner plusieurs feuillets ou dossiers ;
- rechercher dans le titre ou le contenu ;
- filtrer par statut, label ou progression ;
- afficher synopsis, résumé, extrait, notes, tags ou compteurs ;
- ouvrir une portée dans l’Aperçu ;
- compiler un fichier, un dossier ou une sélection.

Le même ordre structurel est réutilisé par l’Aperçu et la composition.

## La vue Écriture

Feuillets enrichit l’éditeur Markdown d’Obsidian au lieu d’en créer un autre.

Vous pouvez régler :

- la largeur ;
- la police ;
- la taille ;
- l’interligne ;
- les alinéas et l’espacement des paragraphes ;
- les aides typographiques ;
- la visibilité de certains éléments de l’interface.

Les fichiers hors manuscrit conservent une apparence plus documentaire.

## Concentration

Le mode Concentration agit sur l’environnement, pas sur le contenu.

![Concentration](feuillets-concentration.png)

Il peut :

- réduire ou masquer les panneaux ;
- centrer la zone d’écriture ;
- utiliser un défilement machine à écrire ;
- estomper ce qui n’est pas la ligne ou le paragraphe actif ;
- afficher un compteur discret.

## L’Inspecteur

Le panneau droit rassemble six onglets :

- **Notes** — informations du feuillet, propriétés, notes de bas de page et contexte ;
- **Recherche** — bible du projet ;
- **Journal** — suivi du travail ;
- **Édition** — documents éditoriaux et révisions DOCX ;
- **Analyse** — métriques et lecture structurelle du texte ;
- **Relecture** — signalements provenant d’un module compagnon.

Les onglets peuvent être masqués. Feuillets empêche de rendre l’Inspecteur vide : au moins un onglet visible reste disponible.

## Le Carnet

Le Carnet est la zone d’exploration libre.

Il s’appuie sur Canvas pour déposer des idées, les déplacer, les grouper et les relier. Une idée peut ensuite devenir volontairement un feuillet du manuscrit ou un document de Recherche.

Advanced Canvas est facultatif. Feuillets fonctionne avec le Canvas natif, puis profite de capacités supplémentaires lorsque le module est présent.

## Plusieurs lectures du même manuscrit

![Mosaïque narrative](feuillets-mosaique-narrative.png)

- **Cartes** : réorganiser et équilibrer les scènes.
- **Plan** : lire les informations du manuscrit sous forme tabulaire.
- **Chemin de fer** : suivre les fils narratifs.
- **Chronologie** : comparer ordre narratif et ordre des événements.
- **Aperçu** : lire le texte composé.

Aucune de ces vues ne crée une copie séparée du manuscrit : elles représentent les mêmes fichiers.

## Recherche

Les fiches de Recherche restent elles aussi en Markdown.

Vous pouvez :

- créer des rubriques standard ou personnalisées ;
- associer un dossier de Recherche à un feuillet ou un dossier du Classeur ;
- rechercher par titre, contenu ou tags ;
- insérer un lien, un extrait ou un extrait sourcé ;
- retrouver les apparitions d’une fiche dans le manuscrit ;
- exploiter les dates et états d’entités pour le contexte.

Les variantes historiques françaises et anglaises des dossiers sont reconnues sans renommage automatique.

## Notes et contexte

L’onglet Notes garde à proximité du texte ce qui ne doit pas entrer directement dans le manuscrit :

- synopsis ;
- résumé ;
- notes de travail ;
- propriétés ;
- notes de bas de page ;
- documents liés ;
- références du passage ;
- alertes chronologiques.

Le contexte est calculé localement à partir du passage entourant le curseur, des liens et des documents associés.

## Analyse et Relecture

**Analyse** appartient au noyau Feuillets. Il peut mesurer notamment le nombre de mots, la part de dialogue, des répétitions, l’équilibre entre chapitres et des informations de rythme renseignées par l’auteur.

**Relecture** est une surface d’accueil pour un fournisseur externe. Feuillets n’embarque aucun correcteur grammatical. Un module compagnon peut enregistrer un fournisseur d’analyse ; sans compagnon, l’onglet reste simplement informatif.

## Aperçu

![Aperçu](feuillets-apercu.png)

L’Aperçu sert à vérifier le texte dans son mouvement réel. Il peut représenter un feuillet, un dossier, une sélection ou le projet complet. La scène active peut suivre l’écriture, tandis que les portées longues privilégient une lecture stable.

L’Aperçu utilise les mêmes principes de composition que les exports : titres, séparateurs, pages liminaires et modèle.

## Réécriture et sécurité

![Comparaison](feuillets-comparaison.png)

Feuillets distingue :

- instantané ;
- comparaison ;
- version ;
- sauvegarde ZIP.

Un dossier utilisé tel quel est sauvegardé dans son propre périmètre uniquement. Un projet structuré autour de `Manuscrit` peut sauvegarder le volume complet, avec Recherche et espaces associés.

## Export

Le moteur natif prend en charge :

- DOCX ;
- EPUB ;
- ODT ;
- PDF sur desktop via la boîte d’impression ;
- Markdown compilé.

La portée peut être un fichier, un dossier, une sélection ou le projet.

## Continuer

- [Le parcours complet d’un auteur](PARCOURS-AUTEUR.md)
- [Fonctionnalités par usage](FONCTIONNALITES.md)
- [Composition et export](COMPOSITION-ET-EXPORT.md)
- [Réécriture, sauvegardes et versions](VERSIONNAGE-ET-SECURITE.md)
