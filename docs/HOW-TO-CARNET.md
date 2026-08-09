# Feuillets — Le Carnet

> **Français** · [English](HOW-TO-NOTEBOOK.md) · [Index](README.md)

Le **Carnet** est l’espace de brainstorming visuel de Feuillets. Il repose sur un Canvas Obsidian ordinaire et permet de faire circuler les éléments entre trois étapes du travail :

**idée libre → organisation visuelle → manuscrit ou recherche**

Le Carnet n’est pas une copie automatique du Classeur. Vous choisissez ce qui y entre et ce qui en sort. Vous pouvez donc y réfléchir librement sans modifier la structure réelle du manuscrit.

Pour profiter des menus directement sur les cartes et de l’Arbre d’idées, **Advanced Canvas est recommandé**. Les fonctions essentielles restent accessibles par la palette de commandes même sans cette extension.

---

## 1. Ouvrir le Carnet

Dans la palette de commandes d’Obsidian, lancez :

**Feuillets : Ouvrir le Carnet**

Feuillets crée le Carnet s’il n’existe pas encore puis ouvre le Canvas du projet actif.

Le fichier est conservé dans les Ressources du projet sous le nom :

`Tableau brainstorming.canvas`

Feuillets ne régénère pas ce fichier à chaque ouverture et ne remplace pas son contenu. Le Carnet reste un espace de travail libre.

---

## 2. Noter une idée sans quitter ce que vous écrivez

Lancez :

**Carnet : noter une idée**

Saisissez votre idée puis appuyez sur `Entrée`.

Une nouvelle carte texte libre est ajoutée au Carnet, même si celui-ci n’est pas ouvert. Le feuillet courant, l’onglet actif et votre espace de travail ne changent pas.

Cette commande est adaptée aux idées rapides :

- une scène à écrire ;
- une question ;
- une piste narrative ;
- une image ;
- un dialogue ;
- un détail à vérifier plus tard.

Deux idées identiques sont autorisées. Une idée libre n’est associée automatiquement ni au feuillet courant ni à une fiche Recherche.

---

## 3. Ajouter un feuillet existant au Carnet

Depuis le feuillet courant, utilisez :

**Carnet : ajouter le feuillet courant**

Vous pouvez aussi faire un clic droit sur un feuillet dans le Classeur et choisir :

**Ajouter au Carnet**

Pour plusieurs feuillets, sélectionnez-les dans le Classeur puis choisissez :

**Ajouter la sélection au Carnet**

Les feuillets sont ajoutés dans leur ordre réel dans le manuscrit.

Ajouter un feuillet au Carnet ne le déplace pas dans le Classeur. Le Carnet reçoit simplement une carte qui pointe vers le fichier Markdown existant.

Si un feuillet est déjà présent dans le Carnet, Feuillets ne le duplique pas.

---

## 4. Transformer une idée en feuillet

Avec Advanced Canvas, faites un clic droit sur une carte texte puis choisissez :

**Transformer en feuillet**

Feuillets vous demande où créer le feuillet dans le manuscrit. Le titre proposé vient de la première ligne significative de l’idée et peut être modifié avant validation.

Après transformation :

- un vrai fichier Markdown est créé ;
- le texte de l’idée est conservé ;
- la carte texte devient une carte fichier ;
- sa position et son apparence sont conservées autant que possible.

Pour transformer plusieurs idées à la fois, sélectionnez-les puis choisissez :

**Passer les idées au manuscrit…**

Vous pouvez choisir les idées à utiliser, leur ordre et leur dossier de destination.

---

## 5. Transformer une idée en fiche Recherche

Faites un clic droit sur une idée puis choisissez :

**Transformer en fiche Recherche**

La fiche est créée dans la rubrique Carnet de la Recherche du projet.

La carte devient une carte fichier. Feuillets lui attribue une distinction visuelle si aucune couleur n’avait déjà été choisie manuellement.

Une flèche entre une fiche Recherche et une scène reste une relation visuelle. Elle ne crée pas automatiquement d’association métier entre Recherche et manuscrit.

---

## 6. Construire un Arbre d’idées

L’Arbre d’idées permet de structurer un raisonnement, une scène, un chapitre ou une partie avant de créer les fichiers réels.

Faites un clic droit sur une carte puis choisissez :

**Développer en arbre…**

Saisissez une idée par ligne. Chaque ligne devient une branche enfant.

Vous pouvez ensuite utiliser :

- **Ajouter une branche** pour créer un enfant ;
- `Tab` pour créer un enfant lorsqu’une seule carte de l’arbre est sélectionnée ;
- `Entrée` pour créer un frère lorsqu’une carte possède déjà un parent dans l’arbre ;
- **Réorganiser l’arbre** pour remettre proprement en page l’arbre concerné.

La nouvelle carte créée par `Tab` ou `Entrée` n’est pas automatiquement placée en édition. Sélectionnez-la ou ouvrez-la pour saisir son texte.

### Important

Feuillets distingue les liens libres du Canvas des liens structurants de l’Arbre d’idées.

Une flèche dessinée manuellement dans le Canvas reste une simple flèche. Pour qu’une branche soit reconnue comme structure par Feuillets, elle doit être créée avec les fonctions de l’Arbre d’idées.

---

## 7. Transformer une branche en plan de manuscrit

C’est le workflow le plus souple du Carnet.

Imaginez cet arbre :

```text
Partie 1
    Chapitre 1
        Kemal arrive à Suvasa
        Il entre dans le café
        Le muhtar veut acheter sa maison
    Chapitre 2
        Il découvre la maison
        Il est déçu
```

Faites un clic droit sur **Partie 1**, puis choisissez :

**Transformer cette branche en plan…**

Feuillets convertit la structure visuelle en plan Markdown avant de toucher au manuscrit.

La règle est simple :

- une carte qui possède des enfants devient un **dossier** ;
- une carte sans enfant devient un **feuillet**.

La branche d’origine reste intacte dans le Carnet.

Vous pouvez vérifier ou modifier le plan proposé dans la fenêtre avant de lancer la création.

---

## 8. Réimporter un plan déjà matérialisé

Le mode issu de l’Arbre d’idées fonctionne de manière **additive et idempotente**.

Cela signifie que vous pouvez :

1. transformer une branche en plan ;
2. continuer à enrichir cette branche dans le Carnet ;
3. relancer **Transformer cette branche en plan…**.

Feuillets tente alors de réutiliser ce qui existe déjà.

Pour un dossier existant :

- son ordre actuel est conservé ;
- les feuillets existants sont conservés ;
- les nouveaux dossiers et feuillets sont ajoutés ;
- aucun élément existant n’est déplacé automatiquement.

Un second import strictement identique ne recrée donc pas de nouveaux fichiers.

---

## 9. Comment Feuillets reconnaît un feuillet existant

Feuillets rapproche un élément du plan avec un feuillet déjà présent uniquement lorsque :

- il se trouve dans le même dossier ;
- son titre affiché correspond exactement ;
- la casse correspond.

Feuillets ne fait pas de rapprochement approximatif.

Par exemple, si le plan contient :

`Kemal arrive à Suvasa`

et que le feuillet existant a été renommé :

`Arrivée de Kemal à Suvasa`

Feuillets ne suppose pas qu’il s’agit du même élément.

Cette règle évite les fusions arbitraires.

---

## 10. Que se passe-t-il en cas d’ambiguïté ?

Feuillets préfère arrêter l’opération plutôt que deviner.

L’import est bloqué si :

- le plan contient deux fois le même titre de feuillet dans le même dossier ;
- plusieurs feuillets existants du même dossier portent exactement le même titre.

Dans ce cas :

- aucune partie du plan n’est créée ;
- aucun fichier existant n’est modifié ;
- la fenêtre reste ouverte ;
- vous pouvez corriger les titres puis relancer l’import.

---

## 11. Le plan vivant n’est pas une synchronisation automatique

Le Carnet et le Classeur sont liés, mais ils ne sont pas des miroirs permanents.

Après création du plan :

- déplacer une carte dans le Carnet ne déplace pas automatiquement le feuillet dans le Classeur ;
- réordonner un arbre ne réordonne pas automatiquement les chapitres déjà existants ;
- supprimer une carte du Carnet ne supprime pas le fichier Markdown correspondant ;
- modifier le Classeur ne redessine pas automatiquement l’Arbre d’idées.

Le principe est volontaire :

**le Carnet aide à penser ; le Classeur reste la structure réelle du livre.**

---

## 12. Créer directement un chapitre depuis le Carnet

Une autre méthode consiste à matérialiser immédiatement plusieurs cartes dans un seul chapitre.

Vous pouvez utiliser :

**Créer un chapitre avec la sélection…**

ou, depuis un Arbre d’idées :

**Créer un chapitre avec cette branche…**

La fenêtre permet de :

- choisir le nom du chapitre ;
- choisir son emplacement ;
- sélectionner les éléments à intégrer ;
- régler leur ordre.

Les idées texte deviennent de nouveaux feuillets.

Si un feuillet du manuscrit est déjà présent dans la sélection, il est **déplacé** dans le nouveau chapitre : il n’est pas copié.

Les fiches Recherche, images, liens et autres éléments non destinés au manuscrit ne sont pas intégrés comme scènes.

### Différence avec « Transformer cette branche en plan… »

**Créer un chapitre avec cette branche…**

- crée un seul chapitre ;
- matérialise immédiatement les éléments de la branche ;
- peut déplacer des feuillets existants dans ce chapitre.

**Transformer cette branche en plan…**

- peut créer plusieurs niveaux de dossiers ;
- réutilise les éléments déjà présents ;
- enrichit une structure existante sans la réordonner ;
- convient mieux à un plan de livre évolutif.

---

## 13. Créer un chapitre depuis un groupe Canvas

Vous pouvez aussi utiliser un groupe visuel du Canvas.

Placez plusieurs éléments dans un groupe puis utilisez :

**Créer un chapitre dans le manuscrit…**

Feuillets retient uniquement les éléments admissibles au manuscrit :

- idées texte ;
- feuillets Markdown déjà présents dans le manuscrit actif.

Les fiches Recherche et autres ressources restent dans le Carnet.

---

## 14. Scinder une idée

Sur une carte texte, choisissez :

**Scinder…**

Feuillets propose une coupure du texte en deux parties. Vous pouvez modifier librement les deux contenus avant de confirmer.

Après validation :

- la première carte conserve la première partie ;
- une nouvelle carte est créée à côté avec la deuxième partie ;
- aucune relation supplémentaire n’est créée automatiquement.

---

## 15. Fusionner plusieurs idées

Sélectionnez plusieurs idées texte puis choisissez :

**Fusionner…**

Vous pouvez définir :

- l’ordre des contenus ;
- la carte qui doit rester comme cible.

Feuillets rassemble les textes dans la cible puis supprime les autres cartes après réussite de l’opération.

La fusion ne réécrit pas le texte et ne le résume pas : les contenus sont concaténés dans l’ordre choisi.

---

## 16. Utiliser le Carnet sans Advanced Canvas

Advanced Canvas est recommandé pour l’expérience complète, mais le Carnet ne dépend pas de lui pour exister.

Sans Advanced Canvas, la palette de commandes permet notamment :

- d’ouvrir le Carnet ;
- de noter une idée ;
- d’ajouter le feuillet courant ;
- de passer des idées au manuscrit ;
- de transformer des idées en fiches Recherche ;
- de créer un chapitre depuis le Carnet.

Advanced Canvas ajoute surtout une manipulation directe depuis les cartes :

- menus contextuels ;
- sélection multiple ;
- Arbre d’idées ;
- raccourcis `Tab` et `Entrée` ;
- transformation directe d’une branche.

---

## 17. Workflow conseillé

Un workflow simple peut être :

1. Capturez vos idées au fil de l’écriture avec **Carnet : noter une idée**.
2. Ouvrez le Carnet lorsque vous voulez prendre du recul.
3. Rassemblez les idées liées.
4. Développez les plus importantes en Arbres d’idées.
5. Réorganisez librement jusqu’à ce que la structure devienne claire.
6. Utilisez **Transformer cette branche en plan…** pour matérialiser progressivement cette structure dans le Classeur.
7. Continuez à enrichir le Carnet.
8. Réimportez la branche lorsqu’apparaissent de nouvelles scènes ou de nouveaux chapitres.
9. Transformez les idées isolées directement en feuillets ou en fiches Recherche.
10. Revenez au Classeur pour l’écriture et l’organisation définitive.

---

## 18. En résumé

Le Carnet peut servir à :

- capturer une idée sans interrompre l’écriture ;
- réfléchir librement avec des cartes ;
- afficher des feuillets existants ;
- transformer une idée en vrai feuillet ;
- transformer une idée en fiche Recherche ;
- construire des Arbres d’idées ;
- créer un chapitre à partir d’une sélection, d’un groupe ou d’une branche ;
- transformer une branche en plan Feuillets ;
- enrichir ce plan progressivement sans recréer l’existant ;
- scinder ou fusionner des idées.

Le Carnet n’impose aucune méthode de travail. Il sert de passage entre la pensée visuelle et le manuscrit réel.

**De l’idée au manuscrit, sans changer d’espace de travail.**
