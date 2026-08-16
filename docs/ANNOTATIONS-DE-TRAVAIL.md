# Annotations de travail

> **Français** · [English](WORKING-ANNOTATIONS.md) · [Index](README.md)

Les **annotations de travail** servent à laisser une remarque sur un passage du manuscrit **sans écrire cette remarque dans le Markdown**.

Elles sont pensées pour les questions temporaires de l’auteur : passage à reprendre, détail à vérifier, intention à renforcer, transition à revoir ou décision encore ouverte.

## Ajouter une annotation

1. sélectionnez un passage dans un feuillet ;
2. lancez l’action **Ajouter une annotation** ;
3. saisissez votre remarque.

Le passage reçoit un repère visuel dans l’éditeur. Un clic sur le passage annoté permet de retrouver la remarque et de la modifier.

## Le Markdown reste propre

Une annotation :

- n’ajoute aucun HTML inline ;
- n’ajoute aucun marqueur Markdown ;
- ne modifie pas le texte sélectionné pour y stocker son identifiant ;
- n’est pas exportée avec le manuscrit ;
- peut être supprimée lorsqu’elle est traitée.

Les données d’annotation et leur ancrage sont conservés séparément du fichier source.

## Résister aux petites réécritures

L’ancrage ne dépend pas uniquement d’une position numérique figée. Feuillets conserve suffisamment de contexte pour tenter de retrouver le passage après de petites modifications autour de lui.

Si le texte a été trop profondément transformé pour que l’ancrage reste sûr, l’annotation ne doit pas être déplacée arbitrairement vers un passage qui n’est plus le bon.

## Retrouver les annotations

Dans **Feuillet**, la page **Notes et annotations** regroupe les remarques de travail et permet d’accéder aux annotations.

La liste peut être parcourue selon trois portées :

- **Feuillet** : annotations du texte actif ;
- **Dossier** : annotations des feuillets du dossier ;
- **Projet** : annotations du manuscrit actif.

L’ordre suit autant que possible l’ordre réel du Classeur afin que la liste reste cohérente avec la progression du manuscrit.

## Modifier ou supprimer

Une annotation peut être :

- ouverte depuis son passage ;
- ouverte depuis la liste ;
- modifiée ;
- supprimée lorsqu’elle n’est plus utile.

Supprimer une annotation ne supprime jamais le passage auquel elle était attachée.

## Annotation ou note de travail ?

Une **note de travail** accompagne généralement le feuillet dans son ensemble.

Une **annotation** répond à un passage précis.

Utilisez une annotation lorsque la remarque n’a de sens qu’en regard d’une phrase ou d’un paragraphe déterminé.

## Annotation ou commentaire de relecture ?

Une annotation de travail est personnelle et locale à votre projet.

Une note de **relecture collaborative** appartient à une session avec un relecteur et voyage dans le paquet `.feuillets` correspondant.

Un commentaire de **Révision DOCX** vient, lui, d’un document Word importé.

Ces trois mécanismes restent distincts afin qu’une remarque personnelle ne soit jamais confondue avec un retour extérieur.

## En résumé

> **Sélectionner → annoter → retrouver → traiter → supprimer, sans polluer le Markdown.**
