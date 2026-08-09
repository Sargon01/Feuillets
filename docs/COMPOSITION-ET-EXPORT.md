# Composition et export

> **Français** · [English](COMPOSITION-AND-EXPORT.md) · [Index](README.md)

## Écrire n’est pas mettre en page

Feuillets sépare :

- l’apparence confortable de l’éditeur ;
- la composition du document destiné à être lu, imprimé ou envoyé.

![Écriture et composition](feuillets-concentration-apercu.png)

La police ou la largeur choisie pour écrire ne doit pas vous enfermer dans la mise en page finale.

## La portée de composition

Une composition peut viser :

- **un fichier** ;
- **un dossier** et tous ses descendants Markdown ;
- **une sélection** de fichiers et dossiers ;
- **le projet entier**.

Si un dossier et l’un de ses descendants sont sélectionnés en même temps, le descendant n’est inclus qu’une fois.

L’ordre final suit l’ordre du Classeur.

## Ce qui n’entre pas automatiquement dans le manuscrit

Les dossiers techniques sont exclus du parcours de composition. Les fichiers explicitement marqués comme exclus de la compilation restent également hors du document final.

Les espaces Recherche, Ressources, Édition, Sauvegardes et autres dossiers techniques ne doivent pas devenir des chapitres par accident.

## Aperçu

![Aperçu paginé](feuillets-apercu.png)

L’Aperçu sert à vérifier la composition avant l’export :

- titres ;
- séparateurs ;
- pages Front ;
- modèle ;
- ordre ;
- portée ;
- pagination.

La scène active peut être actualisée rapidement. Les portées plus longues évitent une recompilation agressive à chaque frappe.

## Pages Front

Le dossier `Front` du manuscrit peut contenir les pages liminaires. La page de titre peut utiliser des rôles spécifiques pour le titre, le sous-titre, l’auteur, une mention supplémentaire ou une image.

L’Aperçu et les exports lisent les mêmes documents Front plutôt que de conserver une seconde page de titre dans un réglage caché.

## Modèles

Feuillets fournit des modèles intégrés et accepte des modèles personnalisés dans les Ressources du projet.

Un modèle peut définir notamment :

- police ;
- taille ;
- interligne ;
- alignement ;
- retrait ;
- espacement ;
- styles de titres ;
- séparateur de scène ;
- orientation ;
- marges et autres paramètres pris en charge.

Les réglages de géométrie PDF restent spécifiques au PDF lorsqu’ils dépendent réellement de la page imprimée.

## Dossier de sortie

Les exports et compilations sont écrits dans `_Sortie`.

### Projet structuré

```text
Mon projet/
├── Manuscrit/
├── _Recherche/
├── _Ressources/
└── _Sortie/
```

### Dossier utilisé tel quel

```text
Mon dossier/
├── Chapitre A.md
├── Sous-dossier/
└── _Sortie/
```

Feuillets ne remonte pas au dossier parent dans ce second cas.

## Formats natifs

### DOCX

- vrai document Word ;
- styles de titres nommés ;
- images et structures prises en charge par le moteur d’export ;
- document adapté à l’échange avec éditeurs/relecteurs.

### EPUB

- EPUB pour liseuse ;
- texte reflowable ;
- la notion de page physique fixe n’est pas applicable.

### ODT

- format OpenDocument ;
- utile pour LibreOffice et logiciels compatibles.

### PDF

- **desktop uniquement** ;
- Feuillets construit la pagination puis ouvre la boîte d’impression du système ;
- choisissez **Enregistrer au format PDF** dans cette boîte ;
- A4, A5 ou Letter et orientation selon les réglages ;
- en-têtes, pieds et pagination selon les options disponibles.

### Markdown compilé

- texte assemblé en Markdown ;
- utile pour archivage, contrôle ou chaîne éditoriale externe.

## Notes de bas de page

Avant l’export, Feuillets renumérote/namespace les notes lorsque nécessaire afin que deux feuillets contenant localement le même identifiant ne se confondent pas dans le document compilé.

Les formats n’ont pas tous la même représentation des notes : vérifiez le fichier final dans son lecteur cible.

## Typographie

L’option de typographie française à l’export peut normaliser plusieurs signes dans la composition même si le texte a été collé depuis une source externe.

## Contrôle conseillé

Avant un envoi important, vérifiez au minimum :

1. page de titre ;
2. début de chaque partie ou chapitre ;
3. séparateurs de scènes ;
4. images ;
5. notes de bas de page ;
6. caractères accentués et Unicode ;
7. en-têtes/pieds si utilisés ;
8. fichier final dans Word, LibreOffice, une liseuse ou un lecteur PDF selon le format.

## Une seule règle à retenir

> **L’Aperçu sert à juger le livre avant que le format d’export ne devienne le dernier endroit où l’on découvre un problème.**
