# Mode Continu

> **Français** · [English](CONTINUOUS-MODE.md) · [Index](README.md)

Le mode **Continu** permet d’écrire plusieurs feuillets comme un seul manuscrit sans fusionner les fichiers.

## Principe

Vous ouvrez un fichier, un dossier, une sélection ou une portée depuis le Classeur. Feuillets construit un document continu dans **un seul éditeur CodeMirror**.

Chaque feuillet reste pourtant un vrai fichier Markdown séparé. Les séparations sont visibles mais protégées ; Feuillets redistribue les modifications dans leurs fichiers source.

## Ce que Continu évite

- aucun fichier composite technique dans le coffre ;
- aucune duplication du manuscrit ;
- aucun lot de dizaines d’onglets Obsidian ;
- aucune conversion vers un format propriétaire.

## Ouvrir Continu

Depuis le Classeur :

- cliquez sur un dossier ou utilisez **Ouvrir en continu** selon le contexte ;
- une sélection peut former une portée commune ;
- l’isolation d’un dossier permet de concentrer ensuite les autres actions sur ce sous-ensemble.

## Éditer

Le texte est réellement éditable de bout en bout. Les frontières entre feuillets ne peuvent pas être supprimées ou déplacées comme du texte ordinaire. Une modification à l’intérieur d’un segment est enregistrée dans le fichier source correspondant.

Les titres Markdown de H1 à H6 sont rendus dans Continu. Le menu contextuel propre à Continu propose Couper, Copier, Coller, les notes de bas de page, **Annotation…**, **Noter une idée** et **Réorganiser le texte**.

### Réorganiser le texte

**Réorganiser le texte** active un mode local à l’éditeur. Survolez un paragraphe pour le déplacer par glisser-déposer, ou déplacez une sélection contenue dans un seul paragraphe comme fragment. Le point d’insertion est indiqué visuellement ; **Échap** quitte le mode et chaque déplacement forme une seule étape Annuler.

Le Markdown exact est conservé. Dans Continu, un paragraphe ou un fragment reste dans son feuillet source : aucun déplacement ne traverse une frontière de feuillet. Annuler/Rétablir restent ceux du document Continu.

## Continu et Aperçu

Continu peut travailler à côté de l’**Aperçu** sur la même portée. Les corps modifiés sont reflétés dans l’Aperçu et la navigation/correction de portée reste synchronisée sans créer un nouvel Aperçu à chaque changement.

## Quand l’utiliser

Continu est utile pour :

- relire un chapitre entier en gardant la possibilité de corriger ;
- écrire à travers plusieurs scènes sans changer de fichier ;
- vérifier les transitions ;
- travailler sur un recueil ou une sélection ;
- conserver la structure du Classeur tout en retrouvant la sensation d’un long document.
