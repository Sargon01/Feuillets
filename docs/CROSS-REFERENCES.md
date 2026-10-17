# Références croisées

Une référence relie un passage humain à une section, une figure légendée, un tableau ou une annexe. La commande **Référence croisée** permet de l’insérer au curseur ou de lier une sélection existante, dans l’éditeur Markdown en mode source et dans Continu. Les trois affichages sont le numéro, le type avec le numéro, et le titre ou la légende courante.

Les relations sont conservées dans `cross-references.json`, dans les ressources internes du projet ou de l’espace de travail. Le Markdown conserve le texte humain. Les identités persistantes ne sont pas des numéros : la numérotation dépend des fichiers effectivement inclus, de leur ordre dans le Binder et du périmètre affiché ou compilé.

## Affichage et périmètre

Dans l’aperçu en direct de l’éditeur Markdown et dans Continu, les décorations affichent les valeurs résolues. Un soulignement pointillé discret identifie les références valides. Leur infobulle présente le type, le numéro contextuel, le titre ou la légende actuelle et le nom du fichier cible, sans action de navigation. Une sélection ou le curseur dans une référence révèle son texte source pour permettre l’édition ; le soulignement reste sur la plage source tant qu’elle est rattachée. Les références non résolues ne reçoivent pas cette marque de validité. Le mode source sans aperçu en direct et le mode Lecture affichent le texte humain ; le mode Lecture ne propose pas l’insertion de références.

L’Aperçu paginé et les exports utilisent le contexte de leur composition. Une cible extérieure au feuillet ou au chapitre composé conserve donc son texte humain, même si elle est résolue dans le manuscrit complet. Les pages annexes participent au contexte seulement lorsqu’elles sont incluses.

Une cible supprimée, ambiguë ou hors périmètre, ainsi qu’une occurrence qui ne peut plus être rattachée de manière sûre, conserve son texte humain. Feuillets ne choisit pas silencieusement une autre destination. Un renommage ou déplacement de fichier maintient les identités ; un changement de titre ou de légende est affiché lorsque le rattachement reste certain.

## Modifications et enregistrement

Les tampons des éditeurs natifs en mode source et les segments modifiés de Continu peuvent fournir leur contenu courant avant enregistrement. Une vue Lecture ne fournit pas son ancien tampon d’édition à la résolution.

Après une modification externe d’un source non modifié dans Continu, les décorations périmées sont retirées. Le texte déjà composé dans Continu reste affiché jusqu’à sa recomposition ; rouvrir son périmètre charge le nouveau contenu. Ce comportement évite d’appliquer les offsets du nouveau fichier à l’ancien document affiché.

Si l’enregistrement d’une relation échoue, le texte humain inséré est conservé et une notification signale l’échec. Une sélection déjà présente n’est pas remplacée. La relation n’est utilisable qu’après un enregistrement réussi ; il est possible de relancer la commande sur le passage. Une insertion concurrente qui chevauche une relation déjà enregistrée est refusée avec la notification de chevauchement.

## Compilation et exports

Markdown, PDF, DOCX, ODT, EPUB et ZIP Pandoc emploient les valeurs de la composition au moment de l’export. Ces valeurs sont du texte exporté ; elles ne constituent pas des champs recalculables dans Word ou une liseuse. La compilation ne modifie ni le Markdown source ni le JSON des relations.

Markdown et le manuscrit du ZIP Pandoc conservent les citekeys. Les formats natifs utilisent le rendu CSL configuré. Le ZIP embarque les bibliographies, styles et ressources nécessaires sans lancer Pandoc. Une citation CSL non résolue conserve sa notation existante.

Les exporteurs existants ont des limites : le DOCX omet les tableaux ; l’ODT omet les images et aplatit le texte des tableaux. Une référence numérotée ne garantit donc pas la présence de son objet dans ces deux formats. La portée des vérifications et les limites propres aux lecteurs sont détaillées dans le [rapport de recette final](validation/cross-reference-final-audit.md).
