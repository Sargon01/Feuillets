# How-to — Réviser un manuscrit Word avec Feuillets

> **Français** · [English](HOW-TO-DOCX-REVISION.md) · [Index](README.md)

La section **Révision DOCX** de l’onglet **Édition** permet de récupérer dans Feuillets les corrections et commentaires faits dans Microsoft Word sur un manuscrit exporté en DOCX.

Le principe est simple :

> **Écrire dans Feuillets → exporter en DOCX → faire réviser le document dans Word → récupérer les retours dans les feuillets Markdown → générer un DOCX révisé pour l’éditeur.**

Le Markdown reste toujours la source du manuscrit.

---

## 1. Exporter le manuscrit depuis Feuillets

Compilez le manuscrit, le dossier ou la sélection que vous souhaitez envoyer à votre relecteur ou éditeur.

Exportez ensuite en **DOCX** depuis Feuillets.

Il est préférable de partir du DOCX produit par Feuillets : il contient des repères qui permettent de retrouver précisément les feuillets d’origine lors du retour du document.

Envoyez ce DOCX à votre relecteur ou éditeur.

---

## 2. Faire les corrections dans Word

Dans Word, le relecteur peut utiliser normalement :

- le suivi des modifications ;
- les commentaires ;
- les réponses aux commentaires ;
- les suppressions ;
- les ajouts ;
- les remplacements ;
- le couper-coller de passages ;
- les corrections dans les notes de bas de page.

Il peut également utiliser des modifications de mise en forme comme le barré, le souligné ou le surlignage.

Enregistrez ensuite le document révisé au format `.docx`.

---

## 3. Ouvrir Révision DOCX

Dans le panneau latéral **Feuillets — Inspecteur**, ouvrez l’onglet **Édition**.

La section **Révision DOCX** se trouve dans cet espace.

Vous pouvez également utiliser la commande Obsidian de Feuillets pour ouvrir la révision DOCX.

---

## 4. Choisir le DOCX reçu

Feuillets propose d’abord les fichiers `.docx` présents dans le dossier **Sortie** du projet.

Vous pouvez aussi choisir un fichier provenant d’un autre emplacement.

Sur ordinateur, il est également possible de déposer le fichier dans la zone prévue.

Cliquez sur :

**Analyser ce fichier**

Feuillets lit alors les modifications suivies et les commentaires du document.

---

## 5. Comprendre la file de révision

Les retours sont réunis dans une file unique.

Vous pouvez les filtrer avec :

- **Tous** ;
- **Modifications** ;
- **Déplacements** ;
- **Commentaires** ;
- **À vérifier**.

Les boutons précédent et suivant permettent de parcourir les retours sans quitter le panneau.

---

# Les types de retours

## Ajout

Word propose d’ajouter du texte.

Vous pouvez accepter ou refuser cet ajout.

## Suppression

Word propose de supprimer un passage.

Vous pouvez :

- l’accepter : le texte est retiré du Markdown ;
- la refuser : le texte reste dans le Markdown.

## Remplacement

Word remplace un texte par un autre.

Feuillets traite les deux opérations comme une seule proposition.

## Déplacement

Un passage a été coupé puis collé ailleurs.

Feuillets peut reconnaître :

- un déplacement déclaré comme tel par Word ;
- un couper-coller enregistré comme suppression + insertion ;
- un déplacement dans le même feuillet ;
- un déplacement vers un autre feuillet.

La carte indique l’origine et la destination.

## Commentaire

Un commentaire Word ne modifie pas directement le Markdown.

Vous pouvez :

- **Voir le passage** ;
- **Marquer comme traité** ;
- **Rétablir** le commentaire dans la pile.

## Mise en forme

Feuillets peut signaler :

- barré ;
- souligné ;
- surligné ;
- gras ;
- italique.

Ces cartes sont informatives.

Feuillets ne transforme pas automatiquement une mise en forme Word en décision sur le texte Markdown.

---

# Les niveaux de confiance

## Sûr

Feuillets a retrouvé un emplacement unique et suffisamment précis.

Vous pouvez généralement utiliser directement :

- **Voir** ;
- **Accepter** ;
- **Refuser**.

## À vérifier

La correspondance est plausible mais demande votre confirmation.

Utilisez **Examiner** avant de décider.

## Ambigu

Feuillets ne peut pas déterminer un emplacement unique sans risque.

Il ne force pas l’application automatique.

Examinez le retour puis effectuez la correction manuellement si nécessaire.

---

# Examiner un déplacement

Les cartes de déplacement proposent :

## Voir l’origine

Ouvre le feuillet dans lequel se trouvait le passage.

## Voir la destination

Ouvre le feuillet dans lequel Word a placé le passage.

## Passages complets

Affiche le contexte complet de l’origine et de la destination.

## Aperçu du résultat

Montre le résultat calculé avant toute écriture.

---

# Accepter une modification

Cliquez sur **Accepter**.

Feuillets applique la modification au fichier Markdown correspondant.

Pour un déplacement entre deux feuillets, l’ensemble de l’opération est préparé avant toute écriture.

---

# Refuser une modification

Cliquez sur **Refuser**.

Le Markdown n’est pas modifié.

La décision est enregistrée afin que Feuillets sache également comment traiter cette révision lors de la génération du DOCX révisé.

Vous pouvez ensuite utiliser **Rétablir**.

---

# Attention à « Tout marquer résolu »

La commande **Tout marquer résolu** ne sert pas seulement à masquer visuellement la liste.

Pour les modifications encore en attente, elle les enregistre comme refusées.

Pour les commentaires, elle les enregistre comme traités.

Elle agit sur toute la file de révision et pas seulement sur le filtre affiché.

Pour un travail éditorial normal, il est préférable de décider retour par retour.

---

# Les snapshots et le retour en arrière

Feuillets tente de créer un snapshot d’un feuillet avant sa première modification pendant une session de révision.

Ce point de retour correspond à l’état du feuillet **avant la session de révision**, et non avant chaque correction individuelle.

Selon l’opération, vous pouvez ensuite :

- voir le résultat ;
- comparer avant/après ;
- comparer l’origine et la destination d’un déplacement.

Un déplacement entre deux feuillets exige que les snapshots des deux fichiers aient réussi avant que Feuillets écrive quoi que ce soit.

---

# Les notes de bas de page

Feuillets sait analyser les corrections faites directement dans une note de bas de page Word.

Il sait également transférer une note lorsqu’un passage est déplacé vers un autre feuillet.

Si un label Markdown existe déjà dans le feuillet de destination, Feuillets peut le renommer pour éviter une collision.

---

# Un retour déjà présent dans le manuscrit

Feuillets peut constater qu’une modification Word est déjà présente dans le Markdown.

La carte peut alors indiquer :

**Déjà présent dans le manuscrit**

Aucune fausse décision utilisateur n’est créée.

---

# Générer le DOCX révisé

Une fois vos décisions prises, cliquez sur :

**Générer le DOCX révisé**

Feuillets repart du **DOCX original reçu de l’éditeur**.

Il ne reconstruit pas le fichier Word depuis le Markdown.

Le DOCX généré reflète uniquement les décisions explicites enregistrées.

## Modification acceptée

Elle est intégrée au document et n’apparaît plus comme révision en attente dans Word.

## Modification refusée

Elle est rejetée dans le document Word.

## Modification sans décision

Elle reste dans le DOCX avec son suivi de modification.

## Commentaire non traité

Il reste présent.

## Commentaire traité

Il est marqué comme résolu lorsque le DOCX fournit les informations nécessaires pour le faire de façon sûre.

Feuillets ne supprime pas les commentaires.

## Carte de mise en forme traitée

Elle ne provoque aucune modification automatique dans le DOCX révisé.

La modification Word originale reste intacte.

---

# Où est enregistré le DOCX révisé ?

Le nom utilisé est :

```text
<nom-original>-révisé.docx
```

Exemple :

```text
Manuscrit.docx
→ Manuscrit-révisé.docx
```

Le fichier est normalement écrit dans le dossier **Sortie** du projet.

Si aucun dossier Sortie n’est disponible, Feuillets utilise le dossier du projet.

Le DOCX original n’est pas écrasé.

### Attention aux versions précédentes

Si un fichier portant déjà exactement le nom `Manuscrit-révisé.docx` existe au même emplacement, Feuillets le remplace.

Si vous souhaitez conserver plusieurs étapes du dialogue éditorial, renommez ou archivez la version précédente.

---

# Cas particulier : déplacement avec note de bas de page

Feuillets sait appliquer dans le **Markdown** un déplacement contenant une note de bas de page.

En revanche, si cette décision doit être reportée dans le DOCX révisé, Feuillets refuse actuellement la génération plutôt que de produire un fichier Word incertain.

Le Markdown déjà révisé n’est pas perdu.

---

# Pourquoi un retour est-il « non rattaché » ?

Feuillets retrouve normalement les feuillets grâce aux repères intégrés au DOCX exporté.

Un retour peut devenir non rattaché si :

- le feuillet a été fortement renommé ou déplacé ;
- les repères Word ont été supprimés ;
- un passage a été entièrement retapé en dehors des limites d’un feuillet ;
- le document n’est pas issu de l’export Feuillets.

Dans le doute, Feuillets préfère demander une vérification plutôt que modifier le mauvais fichier.

---

# Que faire si Feuillets refuse une application ?

## « Ce passage apparaît plusieurs fois »

Le texte existe à plusieurs endroits.

Feuillets refuse de choisir à votre place.

## « Passage introuvable »

Le DOCX et le Markdown ont trop divergé.

Vérifiez le passage manuellement.

## « Impossible de créer un point de retour »

Pour un déplacement entre plusieurs feuillets, Feuillets exige les snapshots avant écriture.

Vérifiez l’accès au dossier Snapshots puis recommencez.

## « Impossible de générer ce DOCX en toute sécurité »

Feuillets a rencontré une structure qu’il préfère ne pas modifier automatiquement.

Le DOCX original reste intact.

---

# Workflow recommandé

1. écrire et réviser le manuscrit dans Feuillets ;
2. exporter le manuscrit en DOCX ;
3. envoyer ce DOCX au relecteur ou à l’éditeur ;
4. recevoir le DOCX avec suivi des modifications et commentaires ;
5. ouvrir **Édition → Révision DOCX** ;
6. analyser le fichier reçu ;
7. traiter les retours un par un ;
8. utiliser **Examiner** pour les éléments à vérifier ;
9. contrôler les déplacements avant de les accepter ;
10. laisser volontairement en attente ce qui doit encore être discuté ;
11. générer le **DOCX révisé** ;
12. rouvrir ce fichier dans Word si vous souhaitez vérifier l’état éditorial avant de le renvoyer.

---

# Principe de sécurité

Feuillets privilégie toujours une règle simple :

> **En cas de doute, ne pas modifier automatiquement le manuscrit.**

Le DOCX est un support d’échange avec l’éditeur.

Le Markdown reste le manuscrit source.
