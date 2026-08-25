# Tutoriel — publier plusieurs documents depuis une seule source

> **Français** · [English](SEMANTIC-PUBLISHING-TUTORIAL.md) · [Index](README.md)

Ce tutoriel présente les rôles, les variantes, les extractions, les collections et la Présentation à partir d’un seul fichier Markdown.

Durée : environ 15 minutes.

## 1. Créer le document

Créez un feuillet et copiez :

```markdown
# Eau et territoire

Ce paragraphe est du texte ordinaire.

> [!introduction]
> Cette courte séquence montre comment le même Markdown peut alimenter plusieurs publications.

> [!question-directrice]
> Comment arbitrer entre plusieurs usages d’une ressource limitée ?

## Notions

> [!definition]
> **Conflit d’usage** : situation dans laquelle plusieurs acteurs souhaitent utiliser une même ressource de manière incompatible.

> [!definition]
> **Arbitrage** : décision visant à départager plusieurs intérêts concurrents.

## Activité

Un texte ordinaire introduit l’activité.

> [!source]
> Dans une commune fictive, la consommation d’eau augmente en été tandis que le débit de la rivière diminue.

> [!questions]
> 1. Quel est le problème principal ?
> 2. Quels acteurs peuvent être concernés ?

> [!solution]
> La demande augmente au moment où la ressource disponible diminue.

> [!preuve]
> Les relevés montrent un pic de consommation pendant les semaines de forte fréquentation.

> [!recommandation]
> Définir à l’avance des seuils de restriction et des usages prioritaires.

---

# Présenter le problème

> [!point-cle]
> Une même source Markdown peut produire un document, plusieurs versions et une présentation.

> [!speaker-notes]
> Montrer ici la différence entre une variante, une extraction et une collection.
```

## 2. Comprendre ce que vous venez d’écrire

Le fichier contient :

- du texte ordinaire ;
- des titres Markdown ;
- plusieurs rôles sémantiques ;
- `---`, qui sépare deux diapositives en Présentation ;
- des notes de présentateur.

Rien n’oblige à utiliser tous ces mécanismes dans un projet normal.

## 3. Créer une variante « Élève »

Ouvrez :

**Édition → Composition → Le manuscrit → Variantes de contenu**

Créez :

- **Nom** : `Élève`
- exclure : `solution`

Résultat attendu :

- le document garde ses titres ;
- le texte ordinaire reste ;
- les questions restent ;
- la solution disparaît.

Vous avez créé une autre publication sans copier le manuscrit.

## 4. Créer une extraction « Activités »

Ouvrez :

**Édition → Composition → Le manuscrit → Extractions de contenu**

Créez :

- **Nom** : `Activités`
- rôle déclencheur : `questions`

Dans le menu **Contenu** de la barre d’export, choisissez `Activités`.

Résultat attendu :

la section contenant les questions est conservée **avec son contexte complet** : texte ordinaire, source, questions, solution, preuve et recommandation appartenant à la section.

## 5. Créer une collection « Glossaire »

Ouvrez :

**Édition → Composition → Le manuscrit → Collections de contenu**

Créez :

- **Nom** : `Glossaire`
- rôle : `definition`

Dans le menu **Contenu**, choisissez `Glossaire`.

Résultat attendu :

- les définitions sont conservées ;
- les titres nécessaires restent ;
- le texte ordinaire extérieur aux définitions disparaît.

## 6. Créer un dossier documentaire

Créez une collection :

- **Nom** : `Sources et preuves`
- rôles : `preuve`, `source`, `citation`

Cette logique devient particulièrement utile sur un projet contenant de nombreux fichiers.

## 7. Combiner collection et variante

Créez une collection :

- `definition`
- `source`

Puis utilisez une variante qui exclut `source`.

Résultat :

- les définitions restent ;
- les sources disparaissent.

La collection choisit d’abord les blocs utiles ; la variante peut ensuite masquer certains rôles.

## 8. Choisir la portée

Dans la barre d’Édition, ouvrez **Portée**.

Selon le contexte, vous pouvez exporter :

- le projet ;
- un dossier ;
- un fichier ;
- une sélection disponible.

La portée répond à la question **où ?**

## 9. Choisir le contenu

Ouvrez **Contenu**.

Choisissez :

- **Tout le document**
- une extraction
- une collection

Le contenu répond à la question **quoi ?**

## 10. Choisir le format

Ouvrez **Format**.

Testez :

- PDF ;
- DOCX ;
- ODT ;
- EPUB.

Les formats documentaires utilisent le même manuscrit dérivé.

L’export Markdown reste un export de la source.

## 11. Ouvrir la Présentation

Passez au rendu Présentation.

Le `---` du fichier sépare les diapositives.

Feuillets compose automatiquement le contenu en 16:9.

La note :

```markdown
> [!speaker-notes]
> Montrer ici la différence entre une variante, une extraction et une collection.
```

n’est pas projetée.

## 12. Le modèle mental final

Vous avez utilisé une seule source pour produire :

- le document complet ;
- une version sans solution ;
- une extraction d’activité ;
- un glossaire ;
- un dossier de sources et preuves ;
- plusieurs formats ;
- une présentation.

Le principe central de Feuillets est donc :

> **Écrire une fois, publier de plusieurs façons.**

Pour les détails, voir [Rôles sémantiques](ROLES-SEMANTIQUES.md), [Variantes, extractions et collections](VARIANTES-EXTRACTIONS-COLLECTIONS.md) et [Présentation](PRESENTATION.md).
