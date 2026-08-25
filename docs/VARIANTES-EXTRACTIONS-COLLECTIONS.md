# Variantes, extractions et collections

> **Français** · [English](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md) · [Index](README.md)

Feuillets peut produire plusieurs documents depuis le même manuscrit sans dupliquer le Markdown source.

Les trois mécanismes ont des fonctions différentes.

| Fonction | Ce qui est conservé | Exemple |
|---|---|---|
| **Variante** | Le document, moins certains rôles | Version élève sans solutions |
| **Extraction** | Des sections entières contenant certains rôles | Toutes les activités avec questions |
| **Collection** | Les blocs portant certains rôles, avec leur contexte de titres | Glossaire ou dossier de preuves |

Les rôles sont facultatifs : si vous n’utilisez aucune de ces fonctions, le manuscrit se comporte comme un document Markdown normal.

## Variante de contenu

Une variante garde la structure et le texte ordinaire, mais peut exclure certains rôles.

Source :

```markdown
## Activité

Texte d’introduction.

> [!questions]
> Quel est le problème principal ?

> [!solution]
> La ressource diminue au moment où la demande augmente.
```

Variante « Élève » :

- exclure `solution`.

Résultat :

- le titre reste ;
- le texte ordinaire reste ;
- les questions restent ;
- la solution disparaît.

Une variante peut également conserver ou masquer les espaces de réponse associés aux questions.

### Quand utiliser une variante ?

Lorsque vous voulez **le même document**, mais avec certains types de contenu masqués.

Exemples :

- version élève / version corrigée ;
- rapport public / rapport interne ;
- support sans recommandations ;
- document sans réponses.

## Extraction de contenu

Une extraction conserve des **sections structurelles entières** lorsqu’elles contiennent au moins un rôle déclencheur.

La structure vient des titres Markdown.

Source :

```markdown
## Activité A

Texte ordinaire.

> [!source]
> Document A.

> [!questions]
> Analysez le document.

> [!solution]
> Réponse attendue.
```

Extraction déclenchée par `questions` :

Feuillets conserve toute la section `Activité A` :

- le titre ;
- le texte ordinaire ;
- la source ;
- les questions ;
- la solution ;
- les autres éléments appartenant à cette section.

### Quand utiliser une extraction ?

Lorsque le rôle sert à **repérer une section**, mais que vous avez besoin de conserver son contexte complet.

Exemples :

- toutes les activités contenant des questions ;
- toutes les sections comprenant une méthode ;
- toutes les parties contenant une recommandation.

## Collection de contenu

Une collection rassemble uniquement les blocs portant certains rôles et ajoute les titres nécessaires pour conserver leur contexte.

Source :

```markdown
# Chapitre 1

## Notions

Texte ordinaire.

> [!definition]
> Arbitrage : décision visant à départager plusieurs intérêts.

Autre texte.
```

Collection `definition` :

```markdown
# Chapitre 1

## Notions

> [!definition]
> Arbitrage : décision visant à départager plusieurs intérêts.
```

Le texte ordinaire extérieur à la collection disparaît.

### Quand utiliser une collection ?

Lorsque vous voulez constituer un nouveau document **à partir des blocs eux-mêmes**.

Exemples :

- glossaire : `definition` ;
- dossier documentaire : `preuve + source + citation` ;
- fiche de synthèse : `synthese + point-cle` ;
- recueil de recommandations : `recommandation`.

## Variante + extraction ou collection

Une variante reste indépendante de la dérivation de contenu.

Exemple :

1. Collection : `definition + source`
2. Variante : exclure `source`

Résultat :

- `definition` reste ;
- `source` disparaît ;
- le texte ordinaire extérieur à la collection n’apparaît pas.

Une extraction et une collection, en revanche, sont deux modes alternatifs : on choisit l’une **ou** l’autre.

## Où les régler ?

Dans **Édition → Composition → Le manuscrit** :

- **Variantes de contenu**
- **Extractions de contenu**
- **Collections de contenu**

Les noms sont libres. Feuillets n’impose pas de profils « élève », « enseignant », « audit », etc.

## Les sélectionner à l’export

La barre rapide d’Édition utilise quatre commandes :

**Portée → Contenu → Format → Exporter**

### Portée

Détermine les fichiers concernés : projet, dossier, fichier ou autre portée disponible.

### Contenu

Choisissez :

- **Tout le document**
- une extraction
- une collection

### Format

Choisissez le format de sortie.

### Exporter

Lance l’export avec les choix courants.

## Export Markdown

L’export Markdown reste un export de la source.

Une extraction ou une collection active ne transforme donc pas le `.md` exporté. Les dérivations sont appliquées aux formats documentaires du pipeline de publication.

## À retenir

- **Variante** = même document, certains rôles masqués.
- **Extraction** = sections entières repérées par des rôles.
- **Collection** = rôles eux-mêmes, avec contexte de titres.

Voir aussi [Rôles sémantiques](ROLES-SEMANTIQUES.md) et [Tutoriel](TUTORIEL-PUBLICATION-SEMANTIQUE.md).
