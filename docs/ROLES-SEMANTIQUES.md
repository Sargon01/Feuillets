# Rôles sémantiques

> **Français** · [English](SEMANTIC-ROLES.md) · [Index](README.md)

## Le principe

Un rôle sémantique décrit **la fonction d’un passage**, pas sa mise en page.

```markdown
> [!definition]
> Un conflit d’usage apparaît lorsque plusieurs acteurs souhaitent utiliser une même ressource de manière incompatible.
```

Ici, `definition` signifie simplement : « ce passage est une définition ».

Feuillets peut ensuite utiliser cette information pour :

- produire une variante du document ;
- sélectionner des sections ;
- constituer une collection de blocs ;
- enrichir le rendu Document ;
- aider la mise en page automatique d’une Présentation.

## Les rôles sont facultatifs

Le texte ordinaire reste la forme normale du manuscrit.

Vous n’avez **pas** à attribuer un rôle à chaque paragraphe. Un roman, un essai, un article ou un manuscrit continu peut être écrit, prévisualisé et exporté sans aucun rôle sémantique.

Ajoutez un rôle seulement lorsqu’il apporte une information utile.

Une bonne question à se poser :

> **Est-ce que je pourrais vouloir retrouver, masquer ou publier séparément ce type de passage ?**

Si la réponse est non, laissez le texte ordinaire.

## Syntaxe

```markdown
> [!role]
> Contenu
```

Les variantes de callouts Obsidian avec état replié/déplié restent reconnues :

```markdown
> [!questions]+
> Questions.
```

```markdown
> [!solution]-
> Solution.
```

## Les 18 rôles canoniques

| Rôle | Usage conseillé |
|---|---|
| `introduction` | Présenter un sujet, une partie ou une démarche |
| `question-directrice` | Formuler la question centrale |
| `objectifs` | Indiquer ce qui doit être atteint |
| `competences` | Compétences mobilisées ou évaluées |
| `instructions` | Consignes, procédure à suivre |
| `questions` | Questions posées au lecteur ou à l’élève |
| `solution` | Réponse, corrigé, résolution |
| `argument` | Proposition défendue dans un raisonnement |
| `hypothese` | Hypothèse à examiner |
| `preuve` | Élément qui étaye une affirmation |
| `source` | Référence documentaire ou source d’information |
| `citation` | Citation mise en évidence |
| `explication` | Développement explicatif |
| `definition` | Définition d’un terme ou d’un concept |
| `methode` | Méthode, démarche, protocole |
| `synthese` | Résumé structuré d’une partie |
| `point-cle` | Élément essentiel à retenir |
| `recommandation` | Proposition d’action ou recommandation |

## Exemples

### Question et solution

```markdown
> [!questions]
> Pourquoi le débit de la rivière diminue-t-il en été ?

> [!solution]
> La réponse dépend des précipitations, des prélèvements et des conditions saisonnières.
```

### Argument, preuve et source

```markdown
> [!argument]
> Les restrictions saisonnières sont plus adaptées qu’une règle identique toute l’année.

> [!preuve]
> Les relevés montrent que la consommation maximale se concentre sur quelques semaines.

> [!source]
> Observatoire local de l’eau, série statistique 2026.
```

### Hypothèse et méthode

```markdown
> [!hypothese]
> La hausse de consommation vient principalement de la fréquentation estivale.

> [!methode]
> 1. Formuler l’hypothèse.
> 2. Identifier les données disponibles.
> 3. Chercher ce qui la confirme ou la contredit.
> 4. Conclure avec prudence.
```

## Callouts Obsidian ordinaires

Tous les callouts Obsidian ne sont pas des rôles Feuillets.

Par exemple :

```markdown
> [!note]
> Une note ordinaire.
```

```markdown
> [!example]
> Un exemple ordinaire.
```

restent des callouts Obsidian normaux.

Attention à la différence entre :

- `question` — callout Obsidian ordinaire ;
- `questions` — rôle sémantique Feuillets.

## Rôle, structure et publication

Ces trois notions sont différentes :

1. **Structure** — dossiers, fichiers et titres Markdown.
2. **Sémantique** — rôles facultatifs.
3. **Publication** — portée, variante, extraction ou collection, mise en page et format.

Un rôle ne remplace donc jamais un titre Markdown et ne transforme pas un paragraphe en « bloc propriétaire ».

## Pour aller plus loin

- [Variantes, extractions et collections](VARIANTES-EXTRACTIONS-COLLECTIONS.md)
- [Composition et export](COMPOSITION-ET-EXPORT.md)
- [Présentation](PRESENTATION.md)
- [Tutoriel — publier plusieurs documents depuis une seule source](TUTORIEL-PUBLICATION-SEMANTIQUE.md)
