# How-to — Utiliser le contexte intelligent de Feuillets

Le panneau **Contexte** affiche automatiquement les informations utiles pendant l’écriture d’un feuillet.

Il peut retrouver :

- les personnages, lieux, événements ou notions cités dans le passage courant ;
- des fiches Recherche liées au feuillet ou au chapitre ;
- des informations chronologiques correspondant à la date du feuillet ;
- des incohérences, comme un personnage déjà mort ou un objet anachronique ;
- des documents dont le contenu partage plusieurs termes avec le passage ;
- des références que vous choisissez de conserver grâce à l’épinglage.

Tout reste local dans le coffre Obsidian. Aucune intelligence artificielle ni aucun service en ligne ne sont utilisés.

---

## 1. Préparer les fiches Recherche

Créez vos fiches dans le panneau **Recherche**.

Selon le projet, elles peuvent concerner :

- des personnages ;
- des lieux ;
- des événements ;
- des concepts ;
- des éléments d’univers ;
- des sources ;
- une bibliographie ;
- un glossaire.

Une fiche peut être retrouvée grâce à son titre, ses alias, ses tags ou son contenu.

### Exemple

```markdown
---
aliases:
  - commerce des caravanes
tags:
  - hedjaz
  - commerce
---

# Commerce caravanier

Les caravanes transportent des épices et des tissus précieux entre les villes.
```

---

## 2. Associer la Recherche au manuscrit

Feuillets peut utiliser plusieurs niveaux de documentation :

- la Recherche associée directement au feuillet ;
- la Recherche associée à son chapitre ;
- la Recherche générale du projet.

Les résultats les plus proches du texte sont prioritaires.

La recherche dans le **contenu intégral des fiches** reste volontairement limitée aux dossiers associés au feuillet ou au chapitre. Elle ne parcourt pas toute la Recherche générale du projet.

Cette limite évite que des dizaines de fiches éloignées du passage apparaissent sans raison.

---

## 3. Écrire normalement

Aucune commande spéciale n’est nécessaire.

Feuillets examine le passage dans lequel se trouve le curseur :

- généralement le paragraphe courant ;
- avec un peu de contexte voisin lorsque le paragraphe est très court.

Le feuillet entier n’est pas analysé en permanence. Les résultats suivent donc le passage réellement travaillé.

### Exemple

Dans le feuillet :

> Les marchands déchargèrent leurs tissus et leurs épices avant la tombée de la nuit.

Dans une fiche Recherche associée :

> Les caravanes transportent des épices et des tissus précieux entre les villes.

Même si le titre **Commerce caravanier** n’est pas cité, la fiche peut apparaître dans **Documents associés**, car plusieurs termes significatifs sont communs aux deux textes.

---

# Les sections du panneau Contexte

## Épinglées

Cette section contient les fiches que vous avez décidé de conserver pour le feuillet actif.

Une fiche épinglée :

- reste visible lorsque vous changez de paragraphe ;
- reste attachée uniquement à ce feuillet ;
- ne se répète pas dans les autres sections ;
- peut être ouverte ou prévisualisée normalement.

L’épinglage est utile pour une information importante qui doit rester sous les yeux pendant toute la rédaction d’une scène.

### Exemple

Vous écrivez une scène située en Arabie et souhaitez conserver la fiche **Arabie** visible, même lorsque le passage courant parle d’un personnage ou d’un objet.

Cliquez sur l’icône d’épingle de la fiche.

Pour la retirer, cliquez de nouveau sur l’épingle.

---

## Références du passage

Cette section contient les éléments reconnus avec une forte fiabilité.

Une fiche peut apparaître parce que le passage contient :

- son titre ;
- un alias ;
- son nom ;
- un tag pertinent ;
- une référence explicite.

### Exemple

Fiche :

```markdown
---
aliases:
  - Hedjaz
---
# Arabie occidentale
```

Passage :

> La caravane atteignit enfin le Hedjaz.

La fiche peut être reconnue grâce à l’alias **Hedjaz**.

Les références sont recalculées lorsque vous déplacez le curseur vers un autre passage.

---

## Documents associés

Cette section complète les références explicites.

Feuillets cherche dans le contenu des fiches appartenant aux dossiers Recherche associés au feuillet ou au chapitre.

Pour qu’une fiche apparaisse, il faut généralement :

- au moins deux termes significatifs communs ;
- ou une expression distinctive de plusieurs mots.

Un seul mot générique comme `ville`, `route`, `maison` ou `commerce` ne suffit pas.

### Exemple positif

Passage :

> Les marchands déchargèrent leurs tissus et leurs épices.

Fiche :

> Les caravanes transportent des épices et des tissus précieux.

Les mots `tissus` et `épices` permettent la correspondance.

### Exemple sans résultat

Passage :

> Les marchands apportèrent des étoffes et des épices.

Fiche :

> Les caravanes transportent des tissus et des épices.

Le seul terme exact commun est `épices`.

Feuillets ne considère pas automatiquement `étoffes` et `tissus` comme synonymes. La recherche reste lexicale et prévisible.

---

# Le contexte chronologique

Lorsqu’un feuillet possède une date, Feuillets peut utiliser cette date pour afficher des informations historiques pertinentes.

La date apparaît en haut des références du passage.

### Exemple

```yaml
---
date: 14 mars 762
---
```

Le panneau peut alors afficher un événement correspondant à cette période :

```text
14 mars 762

Élimination du corps des janissaires
Le sultan Mahmud II supprime par la force ce corps militaire…
```

Les événements historiques pertinents sont placés avant les références ordinaires.

---

## Âge et état des personnages

Une fiche Personnage peut contenir des informations de naissance, de mort ou une évolution datée.

Feuillets peut alors déterminer l’état du personnage à la date du feuillet.

### Exemple

```yaml
---
naissance: 1770
mort: 1815
---
```

Feuillet :

```yaml
---
date: 1826-06-15
---
```

Si le personnage est cité dans le passage, Feuillets peut afficher :

```text
Deli
Mort depuis 11 ans — en 1815
```

Un âge ou un état compatible reste une information secondaire.

Une incohérence importante reçoit une alerte visible.

---

# Les alertes chronologiques

Feuillets peut signaler plusieurs types d’incohérences :

- personnage déjà mort ;
- personnage pas encore né ;
- âge impossible ;
- état historique incompatible ;
- objet ou technique postérieur à la date du feuillet.

### Exemples

```text
⚠ Deli
Mort depuis 11 ans — en 1815
```

```text
⚠ Montre-bracelet
Objet anachronique pour cette date.
```

```text
⚠ Photographie
Technique postérieure à la scène.
```

Ces alertes ne corrigent pas le manuscrit automatiquement. Elles attirent seulement l’attention de l’auteur.

Le choix final reste toujours le vôtre : une incohérence peut être volontaire, liée à un souvenir, à un rêve ou à un narrateur peu fiable.

---

# Prévisualiser et ouvrir une fiche

Chaque résultat propose des actions discrètes.

Selon la ligne, vous pouvez :

- ouvrir la fiche ;
- afficher son aperçu ;
- l’épingler ;
- la désépingler.

L’aperçu permet de vérifier rapidement une information sans quitter le feuillet en cours.

---

# Afficher davantage

Pour éviter de surcharger le panneau, Feuillets limite le nombre de résultats visibles.

Lorsqu’une section contient plus de résultats, une commande permet d’afficher les suivants :

```text
Afficher 5 autres
```

Puis de revenir à la liste réduite :

```text
Afficher moins
```

L’affichage supplémentaire utilise les résultats déjà calculés. Il ne relance pas toute la recherche.

---

# Pourquoi une fiche n’apparaît-elle pas ?

## Le curseur n’est pas dans le bon passage

Le contexte dépend du paragraphe courant.

Placez le curseur dans le passage contenant les termes ou les personnages concernés.

---

## Un seul mot est commun

La recherche de contenu exige plusieurs indices.

Exemple insuffisant :

- passage : `épices` ;
- fiche : `épices`.

Ajoutez un second terme réellement présent dans les deux textes pour vérifier la correspondance.

---

## Les mots sont seulement synonymes

Feuillets ne relie pas automatiquement :

- `étoffe` et `tissu` ;
- `bateau` et `navire` ;
- `marchand` et `négociant`.

Cette limitation évite les rapprochements imprécis.

Utilisez dans la fiche quelques variantes naturelles du vocabulaire important, des alias ou des tags pertinents.

---

## La fiche n’est pas dans un dossier associé

La recherche dans le corps des documents ne parcourt que les dossiers Recherche associés au feuillet ou au chapitre.

Une fiche située uniquement dans la Recherche générale peut apparaître comme référence explicite, mais pas comme simple correspondance de contenu.

---

## La date n’est pas reconnue

Vérifiez que le feuillet contient une date exploitable.

Exemples :

```yaml
date: 1826-06-15
```

```yaml
date: 15 juin 1826
```

Les informations chronologiques des fiches doivent également utiliser un format pris en charge par Feuillets.

---

## La fiche est déjà épinglée

Une fiche épinglée est retirée des autres sections pour éviter les doublons.

Cherchez-la dans **Épinglées**.

---

# Conseils pour de meilleurs résultats

## Donner des titres précis

Préférez :

```text
Commerce caravanier dans le Hedjaz
```

à :

```text
Commerce
```

Un titre précis améliore la détection et réduit les ambiguïtés.

## Utiliser des alias utiles

```yaml
aliases:
  - routes des caravanes
  - commerce caravanier
```

Les alias permettent de reconnaître les formulations réellement utilisées dans le manuscrit.

## Ajouter quelques tags pertinents

```yaml
tags:
  - hedjaz
  - caravane
  - commerce
```

Les tags doivent décrire le contenu, pas seulement son emplacement dans le projet.

## Écrire les informations importantes dans le corps

Le moteur de documents associés lit le contenu réel de la fiche.

Une fiche uniquement composée d’un titre et de propriétés très générales offrira peu de correspondances.

## Éviter les listes artificielles de mots-clés

Il n’est pas nécessaire d’accumuler des dizaines de synonymes.

Une fiche bien rédigée, avec des phrases naturelles et quelques alias pertinents, suffit généralement.

---

# Exemple complet

## Fiche Recherche

```markdown
---
aliases:
  - commerce des caravanes
tags:
  - hedjaz
  - épices
---

# Commerce caravanier

Les caravanes transportent des épices, des tissus précieux et des objets manufacturés entre les villes du Hedjaz.
```

## Feuillet

```markdown
---
date: 14 mars 762
---

Les marchands déchargèrent leurs tissus et leurs épices avant la tombée de la nuit.
```

## Résultat possible

```text
RÉFÉRENCES DU PASSAGE

14 mars 762

DOCUMENTS ASSOCIÉS

Commerce caravanier
Les caravanes transportent des épices, des tissus précieux…
```

En écrivant ensuite explicitement :

> Le commerce des caravanes enrichissait la ville.

la fiche peut passer dans **Références du passage**, car son alias est désormais cité. Elle ne sera pas répétée dans **Documents associés**.

---

# Ce que fait réellement Feuillets

Le panneau Contexte ne remplace pas la Recherche et ne décide pas à la place de l’auteur.

Il sert à faire revenir les informations utiles au moment où elles peuvent aider :

- une ancienne fiche oubliée ;
- l’état d’un personnage ;
- un événement historique ;
- une incohérence de date ;
- un document associé au chapitre ;
- une référence que l’auteur souhaite conserver sous les yeux.

Le principe est simple :

> **Écrire dans le feuillet, laisser le passage appeler sa documentation, puis garder uniquement ce qui aide réellement.**
