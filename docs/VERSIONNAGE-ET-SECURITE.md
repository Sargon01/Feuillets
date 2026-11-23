# Réécriture, sauvegardes et versions

> **Français** · [English](REWRITING-BACKUPS-AND-VERSIONS.md) · [Index](README.md)

Feuillets sépare plusieurs mécanismes parce qu’ils répondent à des besoins différents.

## Historique des réécritures et caractères invisibles

Dans **Réglages → Interface → Apparence**, activez **Historique automatique** (désactivé par défaut), puis écrivez normalement dans Markdown ou Continu. Les changements de chaque feuillet sont regroupés en interventions selon le délai d’inactivité réglable (10 minutes par défaut) ; les états avant et après sont conservés localement. La variation du nombre de mots ne résume pas une reformulation.

Dans **Journal**, ouvrez les groupes repliables classés dans l’ordre du Classeur et affichez les interventions précédentes par pages. Dans **Feuillet**, ouvrez directement l’historique du document courant ; en Continu, il suit le feuillet sous le curseur. Cliquez sur une intervention pour comparer son avant/après, ou sur **Comparer à l’actuel** pour comparer sa fin au texte courant. Les comparaisons sont en lecture seule : vous pouvez sélectionner et copier un passage. Le tampon Markdown non enregistré est utilisé lorsqu’il est disponible ; depuis Continu, la comparaison utilise le dernier état enregistré. Les actualisations préservent la navigation, le focus et le défilement. Désactiver l’option conserve l’historique existant, exclu des exports `.feuil`.

L’historique permet de consulter les étapes successives, sans garantir une sauvegarde ni une restauration automatique. Les **snapshots manuels** créent des points de référence et permettent de restaurer des passages ; les **versions du manuscrit** servent à explorer une autre direction ; les **sauvegardes ZIP** protègent contre la perte de fichiers. Voir le [guide de l’historique](REWRITE-HISTORY.md) pour les limites de récupération.

Dans **Interface → Apparence**, **Afficher les caractères invisibles**, ou la commande **Afficher/masquer les caractères invisibles**, affiche les espaces, tabulations et marques de fin de paragraphe dans Markdown et Continu. Cette option facultative ne modifie ni le texte Markdown ni l’aperçu.

## Sauvegardes

Les sauvegardes ZIP protègent les fichiers du projet. Un dossier utilisé tel quel est sauvegardé dans son propre périmètre ; un projet structuré autour de `Manuscrit` peut couvrir le dossier projet qui contient ce manuscrit. Le dossier de sauvegarde est exclu de sa propre archive.

## Instantanés

Un instantané marque un état précis d’un feuillet ou du projet avant une réécriture risquée. Il sert de point de comparaison et de restauration.

Le flux recommandé pour une réécriture importante est simple : **prendre un instantané → réécrire normalement → Comparer une version → restaurer seulement les passages nécessaires**. L’instantané n’empêche pas l’écriture et ne remplace pas le fichier courant : il fournit un état de référence auquel revenir localement si la nouvelle direction ne convient pas.

## Comparateur 2.5

Le comparateur est désormais une vraie surface à deux vues Markdown.

### Mode Changements

Il affiche :

- ajouts ;
- suppressions ;
- remplacements ;
- **déplacements** reconnus, y compris certains couper/coller représentés initialement comme suppression + insertion.

Les suppressions et ajouts sans texte visible sur l’autre côté sont matérialisés par un repère `[…]`. Les déplacements utilisent une numérotation stable et des indications de direction.

Vous pouvez :

- aller au changement précédent/suivant ;
- double-cliquer un passage différentiel pour recentrer les deux vues ;
- restaurer un passage depuis un instantané ;
- fermer la petite carte d’action ;
- activer ou désactiver le **défilement synchronisé**.

### Mode Versions

Le mode **Versions** retire les décorations de différences afin de lire les deux états comme deux textes ordinaires. Le changement de mode ne modifie aucun fichier.

## Nouvelle version du manuscrit

**Dupliquer comme nouvelle version** crée une copie du manuscrit sous l’espace de versions et conserve l’ordre structurel. La Recherche reste partagée afin de ne pas dupliquer inutilement la bible du projet.

## Annotations de travail

Les annotations ne sont pas des versions. Elles servent à signaler localement un passage à reprendre et restent hors du Markdown.

Voir [Annotations de travail](ANNOTATIONS-DE-TRAVAIL.md).

## Relecture collaborative

Les retours d’un relecteur natif utilisent le même langage visuel de comparaison, mais restent liés à une session collaborative et à ses notes.

Voir [Relecture collaborative](RELECTURE-COLLABORATIVE.md).

## Révision DOCX

Les retours Word constituent encore un autre flux : Feuillets analyse les modifications suivies/commentaires du DOCX et les rattache aux fichiers Markdown lorsqu’il peut le faire avec suffisamment de confiance.

Voir [Réviser un manuscrit Word](HOW-TO-REVISION-DOCX.md).

## Quel outil choisir ?

| Besoin | Outil |
|---|---|
| Protection régulière | Sauvegarde ZIP |
| Marquer un état précis | Instantané |
| Comprendre les changements | Comparaison |
| Explorer une direction alternative | Nouvelle version |
| Laisser une remarque personnelle | Annotation de travail |
| Échanger nativement avec un relecteur Feuillets | Relecture collaborative |
| Réintégrer des retours Word | Révision DOCX |
