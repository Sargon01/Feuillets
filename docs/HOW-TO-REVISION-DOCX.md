# How-to — Réviser un manuscrit Word avec Feuillets

> **Français** · [English](HOW-TO-DOCX-REVISION.md) · [Index](README.md)

La **Révision DOCX** se trouve désormais dans **Relecture → Révision DOCX**.

Principe : **écrire dans Feuillets → exporter en DOCX → faire réviser dans Word → traiter le retour dans Relecture → continuer en Markdown**.

## 1. Exporter

Exportez le feuillet, dossier, sélection ou projet en DOCX depuis la barre d’Édition ou la commande d’export correspondante. Utiliser le DOCX produit par Feuillets améliore la capacité à rattacher les retours aux feuillets sources.

## 2. Réviser dans Word

Le relecteur peut utiliser suivi des modifications, commentaires, réponses, ajouts, suppressions, remplacements, couper-coller et corrections dans les notes de bas de page.

## 3. Ouvrir Révision DOCX

Ouvrez **Relecture**, puis **Révision DOCX**. La commande Obsidian dédiée conduit au même endroit.

## 4. Analyser le retour

Choisissez le `.docx` reçu et lancez l’analyse. Feuillets rassemble modifications, déplacements, commentaires et cas à vérifier.

## 5. Décider

Pour une modification suffisamment sûre, vous pouvez accepter ou refuser. Un commentaire peut être consulté puis marqué traité. Un déplacement permet d’examiner origine et destination.

Les correspondances incertaines restent à vérifier au lieu d’être appliquées de force.

## 6. Couper/coller et déplacements

Feuillets peut reconnaître un déplacement Word explicite ou certains couper/coller représentés comme suppression + insertion, y compris entre deux feuillets.

## 7. Snapshots

Avant la première modification d’un feuillet pendant une session de révision, Feuillets tente de conserver un point de retour. Pour un déplacement entre deux fichiers, les protections nécessaires sont préparées avant l’écriture.

## 8. Notes de bas de page

Les corrections dans les notes de bas de page sont analysées et les collisions de labels Markdown sont évitées lorsque des notes doivent changer de feuillet.

## DOCX Review ou Relecture collaborative ?

- **Révision DOCX** : votre interlocuteur travaille dans Word.
- **Relecture collaborative** : les deux personnes utilisent Feuillets et échangent des paquets `.feuillets`.
