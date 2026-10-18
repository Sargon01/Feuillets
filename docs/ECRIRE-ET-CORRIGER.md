# Écrire, mettre en forme et corriger

> **Français** · [English](WRITING-AND-CORRECTION.md) · [Index](README.md)

Commencez dans un feuillet Markdown du Classeur. Pour travailler sur plusieurs feuillets comme sur un seul texte, utilisez [Continu](MODE-CONTINU.md). La présentation d’écriture, les exceptions de mise en page et les modifications du texte sont trois choses différentes.

## Choisir une surface confortable

Dans les réglages Feuillets, adaptez la police, la largeur, l’interligne et les alinéas de l’écriture. Les [espaces de travail](ESPACES-DE-TRAVAIL.md) proposent les exceptions locales prises en charge. Les couleurs d’écriture peuvent avoir une paire fond/texte distincte pour chaque thème clair ou sombre ; elles ne recolorent pas tout Obsidian. Le mode **Concentration** réduit temporairement les éléments autour du texte.

Ces préférences ne remplacent pas le gabarit de publication. Voir [Interface d’écriture](SETUP-INTERFACE.md).

## Typographie française et paragraphes

Les aides de typographie française de l’éditeur et l’option de typographie française à l’export ont des rôles distincts : vérifiez les deux réglages selon que vous souhaitez modifier la saisie ou le document produit. Le Markdown reste la source ; les transformations de composition ne doivent pas être confondues avec une réécriture générale des fichiers.

Pour une exception locale de publication, utilisez **Disposition** sur un paragraphe ordinaire : alignement, alinéa et espacement avant/après. Chaque propriété peut revenir à la valeur du gabarit sans supprimer les autres exceptions. Ces réglages sont conservés hors du texte Markdown, avec un ancrage au passage. Ils ne constituent pas un traitement arbitraire de tous les blocs : code, tableaux et autres structures gardent leurs règles propres.

Contrôlez le résultat dans l’Aperçu et dans le format de destination. Les capacités d’un EPUB reflowable et d’un PDF paginé ne sont pas identiques. Voir [Composition et export](COMPOSITION-ET-EXPORT.md).

## Rechercher un nom dans plusieurs feuillets

La recherche du Classeur sert à retrouver des fichiers. La barre **Rechercher** de l’éditeur sert à parcourir les occurrences dans le texte et à les remplacer.

1. Ouvrez un feuillet dans l’éditeur Markdown, en mode édition, puis la recherche Feuillets.
2. Saisissez le texte et choisissez **Portée** : **Feuillet actif**, **Dossier actif**, **Sélection du Binder**, **Manuscrit / ouvrage actif** ou **Projet entier** selon le contexte.
3. Choisissez les options utiles : casse, accents, **Contient**, **Commence par**, **Mot entier**. Les caractères spéciaux proposés comprennent tabulation, paragraphe et saut de ligne.
4. Parcourez les résultats avec **Entrée** et **Maj+Entrée**, ou les boutons occurrence suivante/précédente. **Échap** ferme la barre.

L’inclusion du YAML est explicite. **Protéger la syntaxe Markdown** permet de préserver les contextes syntaxiques reconnus par le moteur ; l’option n’est pas une garantie sémantique universelle sur tout Markdown ou toute extension. Vérifiez son état avant un remplacement : la recherche peut repérer des occurrences que les protections empêchent ensuite de remplacer.

## Remplacer avec contrôle

**Exemple :** vous renommez « Valmont » en « Valbrume » dans trois chapitres, sans modifier une fiche Recherche homonyme.

1. Sélectionnez les chapitres dans le Classeur et choisissez **Sélection du Binder**.
2. Activez **Remplacer**, renseignez le nouveau nom et vérifiez la casse ainsi que **Mot entier** si nécessaire.
3. Utilisez un remplacement ciblé pour examiner un premier résultat, ou **Tout remplacer…**.
4. Pour plusieurs fichiers, examinez la prévisualisation **Avant / Après**, le nombre d’occurrences, les éléments ignorés et le nombre de feuillets.
5. Confirmez le remplacement dans le nombre de feuillets annoncé. Annuler la prévisualisation n’écrit rien.

La portée globale reste éditoriale : les dossiers techniques, sorties et documents extérieurs ne deviennent pas des cibles parce qu’ils sont dans le même coffre. Les contenus et la portée sont revérifiés avant application. Si un feuillet a changé depuis la prévisualisation, recalculez-la au lieu de forcer l’ancien plan.

Fermez une vue Continu contenant un feuillet concerné avant un remplacement global ou sa restauration. Attendez aussi la fin d’un chargement/recomposition. Si un fichier est ouvert dans plusieurs vues d’édition natives, conservez une seule vue pour l’opération. Ces refus protègent contre les tampons concurrents ; la barre de remplacement n’est pas un remplacement interfeuillets directement dans le document Continu.

### Annuler : deux mécanismes

- **Feuillet actif** : le remplacement utilise une transaction de l’éditeur ; son annulation reste celle de l’éditeur.
- **Remplacement global** : utilisez **Annuler le dernier remplacement global**, ou **Annuler** dans le résumé de l’opération. Un enregistrement durable des originaux est conservé dans l’espace de sauvegarde du projet, sous `SearchReplace`.

L’annulation globale vérifie que les fichiers correspondent encore au résultat attendu. Elle peut refuser si vous les avez modifiés depuis ; elle n’écrase pas ces changements. Une erreur peut nécessiter une vérification manuelle des chemins et de l’emplacement des originaux indiqués dans la notification. Ce mécanisme ne remplace pas une [sauvegarde du coffre ou un instantané](VERSIONNAGE-ET-SECURITE.md).

## Corriger la langue dans le texte

Le compagnon facultatif [Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte) peut fournir des diagnostics français directement dans l’éditeur et Continu. Les signalements d’orthographe et de grammaire ont des formes distinctes ; cliquez à gauche sur un signalement pour ouvrir les propositions disponibles. Les suggestions orthographiques peuvent être chargées à la demande. Ignorer une occurrence et ajouter un mot au dictionnaire dépendent des capacités du fournisseur.

Dans Continu, la correction en direct se concentre sur les feuillets réellement visibles, avec temporisation et limites de charge. Elle n’équivaut pas à une analyse exhaustive instantanée du manuscrit entier. **Relecture → Analyse de texte** reste le point d’entrée pour une relecture plus large. Aucun fournisseur linguistique n’est obligatoire pour écrire ou exporter ; les intégrations et ressources externes gardent leurs propres conditions de fonctionnement.

## Références, citations et images

- Pour « voir image 2 » ou le titre d’une section, utilisez [Référence croisée…](CROSS-REFERENCES.md).
- Pour une source bibliographique, utilisez `[@`, ou **Recherche → Références → Citer** : voir [Citations BibTeX et CSL](CITATIONS-BIBTEX-ET-PANDOC.md).
- Pour une image légendée, utilisez les actions d’image dans l’éditeur. La forme portable est `![Légende](chemin/image.png)`, avec le chemin entre chevrons lorsqu’il contient des espaces. Une image collée peut être rangée dans les ressources du projet ; les chemins doivent rester vérifiés après transport.
- Les notes de bas de page restent des notes Markdown. Leur inspection, leur insertion et leur numérotation sont distinctes de la numérotation des renvois internes.

Pour réviser avec des retours externes, poursuivez avec [Révision DOCX](HOW-TO-REVISION-DOCX.md) ou [Relecture collaborative](RELECTURE-COLLABORATIVE.md).

## Journal et suivi de l’écriture

L’onglet **Journal** permet de retrouver les journées d’écriture et le suivi associé au projet. Les statistiques quotidiennes sont séparées par projet : changer de manuscrit ne doit pas attribuer la même production aux deux projets. Dans les réglages, **Suffixe des fichiers du journal** peut produire par exemple `2026-09-15-log.md` ; les entrées existantes ne sont pas renommées. Le carnet compilé du journal suit la langue lors de sa création, sans imposer de renommer les fichiers historiques.
