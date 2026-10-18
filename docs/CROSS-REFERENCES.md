# Références croisées internes

> **Français** · [English](CROSS-REFERENCES-EN.md) · [Index](README.md)

Une référence croisée relie un passage à une **section, une image légendée, un tableau ou une annexe du manuscrit**. Elle peut afficher un numéro, un type avec son numéro ou le titre/la légende courante. Après réorganisation, le rendu utilise le nouvel ordre de la portée consultée ou composée.

Ce ne sont **pas des citations bibliographiques CSL**. « Voir image 2 » renvoie à un élément interne du manuscrit ; `[@dupont2024, p. 18]` renvoie à une source bibliographique. Les deux peuvent coexister, y compris dans une même note de bas de page, mais leurs identités et leurs réglages restent distincts. Le compagnon Feuillets CSL n’est pas nécessaire aux références croisées. Voir [Citations BibTeX et Pandoc](CITATIONS-BIBTEX-ET-PANDOC.md).

## Un premier renvoi en quelques étapes

Supposons qu’un feuillet contienne :

```markdown
## Organisation du terrain

![Carte des secteurs](carte.png)

| Secteur | Surface |
| --- | ---: |
| Nord | 24 |
```

Dans un autre feuillet du même contexte :

1. Écrivez `Voir ` et laissez le curseur à la suite, dans l’éditeur Markdown ou Continu.
2. Lancez **Référence croisée…** depuis la palette de commandes Feuillets.
3. Cherchez la cible. La liste indique le type, le numéro, le titre ou la légende et le chemin du fichier pour distinguer les homonymes.
4. Choisissez **Type et numéro**, **Numéro** ou **Titre ou légende**.
5. Validez : Feuillets insère le texte humain et enregistre sa relation à la cible.

Pour **lier un passage déjà écrit**, sélectionnez par exemple `la carte ci-dessus`, puis lancez la même commande. Le Markdown sélectionné n’est pas remplacé. En Live Preview ou dans Continu, le rendu peut afficher `image 1` ou `Carte des secteurs` selon votre choix ; placer le curseur dans ce passage révèle `la carte ci-dessus` pour l’éditer.

Annuler un sélecteur ne crée aucune relation. Si vous changez le texte, la sélection ou le document pendant le choix, relancez la commande à partir du nouvel emplacement. Une référence ne peut pas chevaucher une relation déjà enregistrée.

## Quelles cibles sont proposées ?

| Type | Cible reconnue | À vérifier si elle manque |
|---|---|---|
| Section | Un vrai titre Markdown H1–H6, ATX ou Setext | Un faux titre dans du code ou un commentaire n’est pas une section |
| Image | Une image Markdown légendée, seule sur sa ligne : `![Légende](image.png)` | Une image sans légende ou un simple wikilien d’image n’est pas automatiquement une figure légendée |
| Tableau | Un tableau Markdown avec sa ligne d’en-tête | La cible est le tableau, pas une cellule ni un tableau HTML arbitraire |
| Annexe | Un document reconnu comme annexe par la composition | Nommer un dossier « Annexe » ne remplace pas son inclusion éditoriale |

Les cibles proviennent du manuscrit et des annexes reconnues dans son contexte, pas d’un catalogue de toutes les notes du coffre ou des fiches Recherche. Les blocs de code, le YAML et les commentaires ne fournissent pas de fausses cibles. Une référence peut, elle, être placée dans le texte, une cellule ou une note lorsque sa plage peut être rattachée.

## Pourquoi le numéro peut changer

Chaque type possède son propre compteur : sections, images, tableaux et annexes. L’ordre des fichiers retenus suit le Binder ; l’ordre interne suit les positions des éléments. Ce numéro de renvoi n’est pas un numéro de page ni nécessairement la numérotation hiérarchique d’un titre à l’export.

La commande respecte les frontières du projet, de l’ouvrage indépendant, de l’espace de travail déclaré et de l’isolation applicable. Une Recherche partagée ne fusionne pas les identités de deux espaces de travail. Dans Continu, le numéro correspond à la portée affichée ; dans l’Aperçu et l’export, à la composition réellement retenue.

**Exemple :** une carte est l’image 3 dans le livre complet, mais l’image 1 dans un chapitre exporté seul. Si le chapitre ne contient pas la cible, le passage conserve son texte humain. Une variante, extraction ou collection qui exclut la cible ne doit pas la compter comme si elle était publiée.

## Texte source et stockage

Les relations sont conservées dans `cross-references.json`, dans les ressources internes du contexte concerné. Le Markdown conserve le texte humain ; il ne reçoit ni identifiant technique ni champ de renvoi Word. Les identités persistantes ne sont pas les numéros affichés.

Gardez les ressources internes avec le projet lorsque vous le sauvegardez ou le transportez. Copier seulement une phrase vers un autre coffre ne transporte pas automatiquement sa relation. Le fichier de relations n’est pas un document à renuméroter manuellement.

## Affichage et périmètre

Dans l’aperçu en direct de l’éditeur Markdown et dans Continu, les décorations affichent les valeurs résolues. Un soulignement pointillé discret identifie les références valides. Leur infobulle présente le type, le numéro contextuel, le titre ou la légende actuelle et le nom du fichier cible, sans action de navigation. Une sélection ou le curseur dans une référence révèle son texte source pour permettre l’édition ; le soulignement reste sur la plage source tant qu’elle est rattachée. Les références non résolues ne reçoivent pas cette marque de validité. Le mode source sans aperçu en direct et le mode Lecture affichent le texte humain ; le mode Lecture ne propose pas l’insertion de références.

L’Aperçu paginé et les exports utilisent le contexte de leur composition. Une cible extérieure au feuillet ou au chapitre composé conserve donc son texte humain, même si elle est résolue dans le manuscrit complet. Les pages annexes participent au contexte seulement lorsqu’elles sont incluses.

Une cible supprimée, ambiguë ou hors périmètre, ainsi qu’une occurrence qui ne peut plus être rattachée de manière sûre, conserve son texte humain. Feuillets ne choisit pas silencieusement une autre destination. Un renommage ou déplacement de fichier maintient les identités ; un changement de titre ou de légende est affiché lorsque le rattachement reste certain.

## Modifications et enregistrement

Les tampons des éditeurs natifs en mode source et les segments modifiés de Continu peuvent fournir leur contenu courant avant enregistrement. Une vue Lecture ne fournit pas son ancien tampon d’édition à la résolution.

Après une modification externe d’un source non modifié dans Continu, les décorations périmées sont retirées. Le texte déjà composé dans Continu reste affiché jusqu’à sa recomposition ; rouvrir son périmètre charge le nouveau contenu. Ce comportement évite d’appliquer les offsets du nouveau fichier à l’ancien document affiché.

Si l’enregistrement d’une relation échoue, le texte humain inséré est conservé et une notification signale l’échec. Une sélection déjà présente n’est pas remplacée. La relation n’est utilisable qu’après un enregistrement réussi ; il est possible de relancer la commande sur le passage. Une insertion concurrente qui chevauche une relation déjà enregistrée est refusée avec la notification de chevauchement.

## Aperçu, composition et exports

| Surface | Résultat |
|---|---|
| Markdown Live Preview | Valeur résolue et marque discrète ; texte humain révélé à l’édition |
| Continu | Même principe, dans le contexte des feuillets assemblés |
| Mode source et Lecture | Texte humain, sans remplacement dynamique des références |
| Aperçu paginé | Valeur résolue dans la composition ; aucun soulignement ni infobulle d’édition |
| Markdown compilé et paquet Pandoc | Valeurs des renvois internes résolues ; citekeys bibliographiques conservées |
| DOCX, ODT, EPUB et PDF | Valeurs composées exportées comme texte, sans champs de renvoi recalculables |



Markdown, PDF, DOCX, ODT, EPUB et ZIP Pandoc emploient les valeurs de la composition au moment de l’export. Ces valeurs sont du texte exporté ; elles ne constituent pas des champs recalculables dans Word ou une liseuse. La compilation ne modifie ni le Markdown source ni le JSON des relations.

Markdown et le manuscrit du ZIP Pandoc conservent les citekeys. Les formats natifs utilisent le rendu CSL configuré. Le ZIP embarque les bibliographies, styles et ressources nécessaires sans lancer Pandoc. Une citation CSL non résolue conserve sa notation existante.

Le DOCX et l’ODT conservent les tableaux dans leur structure native. L’ODT incorpore les images locales PNG, JPEG, GIF et SVG résolues, avec leurs légendes et des dimensions adaptées à la page. Une image manquante ou non prise en charge est signalée ; elle n’est pas remplacée par une ressource inventée. La portée des vérifications et les limites propres aux lecteurs sont détaillées dans le [rapport de finition des éditeurs et exports](validation/cross-reference-export-finish.md).

## Si un renvoi ne s’actualise plus

1. Vérifiez que la cible existe toujours et appartient à la portée affichée ou exportée.
2. Vérifiez son type : une image doit avoir une légende reconnue, une annexe doit être incluse.
3. Après une modification externe, recomposez ou rouvrez Continu si ses anciens segments sont encore affichés.
4. Si plusieurs passages concurrents empêchent un rattachement sûr, clarifiez le contexte puis relancez la commande sur le passage voulu. Feuillets ne devine pas une destination.
5. Si une notification indique un échec d’enregistrement, le texte conservé n’est pas la preuve qu’une relation a été sauvegardée. Relancez la commande et vérifiez le résultat.

Les renvois ne sont pas des liens de navigation cliquables, ne calculent pas de numéro de page et ne deviennent pas des champs Word actualisables. Les anciens rapports de validation décrivent les versions testées à leur date ; ils ne certifient pas tous les lecteurs DOCX/ODT ni tous les thèmes Obsidian.

Voir aussi [Interface d’écriture](SETUP-INTERFACE.md), [Continu](MODE-CONTINU.md), [Composition et export](COMPOSITION-ET-EXPORT.md) et [Variantes, extractions et collections](VARIANTES-EXTRACTIONS-COLLECTIONS.md).
