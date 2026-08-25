# Découvrir Feuillets

> **Français** · [English](DISCOVER.md) · [Index](README.md)

Feuillets est un atelier d’écriture construit **dans** Obsidian. Le manuscrit reste en Markdown ; les outils apparaissent autour de lui seulement lorsqu’ils deviennent utiles.

Vous n’avez pas besoin d’apprendre tout Feuillets avant de commencer. Partez simplement de ce que vous voulez faire.

> **Classeur → feuillet/Continu → Aperçu → Édition → export**

## Que voulez-vous faire ?

- **J’ai déjà un dossier de textes.** Utilisez-le directement comme projet Feuillets : vos fichiers n’ont pas besoin d’être déplacés, renommés ou convertis. Voir [Classeur et navigation](CLASSEUR-ET-NAVIGATION.md).

- **Je veux écrire plusieurs scènes ou chapitres ensemble.** Ouvrez un dossier ou une sélection en **Continu**. Feuillets les présente dans un seul éditeur réellement modifiable tout en conservant chaque feuillet dans son fichier Markdown d’origine ; ce n’est pas un simple aperçu. Voir [Mode Continu](MODE-CONTINU.md).

- **Je veux travailler seulement sur une partie du manuscrit.** Feuillets sait travailler à l’échelle d’un **feuillet**, d’un **dossier**, d’une **sélection** ou du **projet entier**. Cette portée peut être utilisée selon l’action dans Continu, l’Aperçu et l’export, sans créer de copie du projet.

- **Je veux produire plusieurs documents depuis la même source.** Ajoutez seulement les rôles sémantiques qui vous sont utiles, puis créez une **variante**, une **extraction** ou une **collection**. Le texte ordinaire reste inclus par défaut et le manuscrit source n’est pas dupliqué. Voir [Rôles sémantiques](ROLES-SEMANTIQUES.md) et [Variantes, extractions et collections](VARIANTES-EXTRACTIONS-COLLECTIONS.md).

- **Je veux déplacer un paragraphe ou un passage.** Dans l’éditeur Markdown ou dans Continu, utilisez **clic droit → Réorganiser le texte**, puis faites glisser le paragraphe ou, lorsqu’il reste dans un même paragraphe, le fragment sélectionné vers sa nouvelle position. Appuyez sur **Échap** pour quitter le mode.

- **Je veux me laisser une remarque sur une phrase.** Sélectionnez le passage puis choisissez **Annotation…**. L’annotation reste attachée au texte, fonctionne aussi dans Continu et n’est jamais écrite dans le Markdown ; pour une remarque concernant le feuillet entier, utilisez plutôt une note de travail. Voir [Annotations de travail](ANNOTATIONS-DE-TRAVAIL.md).

- **Ma documentation existe déjà ailleurs dans le coffre.** Ne la déplacez pas : un dossier existant peut être **associé comme Recherche** tout en restant physiquement à son emplacement. Voir [Recherche et dossiers associés](RECHERCHE-ET-DOSSIERS-ASSOCIES.md).

- **J’utilise déjà mes propres propriétés YAML.** Dans **Projet**, Feuillets peut mapper ses champs logiques vers les propriétés déjà utilisées dans votre coffre. Vous n’avez pas besoin de renommer vos propriétés ni de migrer vos fichiers. Voir [Projet et propriétés YAML](PROJET-ET-PROPRIETES-YAML.md).

- **Je veux relire ou faire relire mon texte.** Pour une remarque personnelle, utilisez une **Annotation** ; pour comparer deux états, utilisez **Comparer une version**, par exemple avec un instantané ; pour un relecteur utilisant Feuillets, utilisez la **Relecture collaborative** `.feuillets` ; pour un éditeur ou correcteur travaillant dans Word, utilisez **Révision DOCX**. Voir [Réécriture, sauvegardes et versions](VERSIONNAGE-ET-SECURITE.md), [Relecture collaborative](RELECTURE-COLLABORATIVE.md) et [Révision DOCX](HOW-TO-REVISION-DOCX.md).

- **Je veux exporter seulement quelques chapitres.** Sélectionnez les feuillets ou dossiers voulus et utilisez cette sélection comme portée. Il n’est pas nécessaire de créer un projet séparé ni une copie du manuscrit.

- **Je veux exporter sans ouvrir l’Aperçu.** Vous pouvez le faire. L’Aperçu sert à contrôler visuellement le document composé, mais il n’est pas requis pour exporter ; si Continu contient encore des modifications en attente, Feuillets les enregistre d’abord dans les fichiers sources.

- **Je veux transformer le même Markdown en présentation.** Séparez les diapositives avec `---`. Feuillets compose le contenu en 16:9, peut exploiter les rôles sémantiques sans les rendre obligatoires et garde les notes `[!speaker-notes]` hors projection. Voir [Présentation](PRESENTATION.md).

## Des fonctions faciles à manquer

- Un dossier Obsidian existant peut devenir un projet Feuillets sans être restructuré.
- La même logique de portée permet de travailler sur un feuillet, un dossier, une sélection ou le projet entier.
- **Réorganiser le texte** déplace des paragraphes ou des fragments sans passer par couper-coller.
- Les **annotations** fonctionnent aussi dans Continu tout en restant hors du Markdown.
- Un dossier documentaire existant peut être **associé comme Recherche** sans être déplacé.
- Le **remappage YAML** permet à Feuillets de s’adapter aux propriétés déjà présentes dans le coffre.
- L’**Aperçu est facultatif pour exporter** : il sert à vérifier la composition, pas à autoriser l’export.
- Les **rôles sémantiques sont facultatifs** mais permettent de produire variantes, extractions et collections depuis une source unique.
- Le même Markdown peut aussi alimenter une **Présentation 16:9**.

## Comprendre l’espace de travail Feuillets

### Le Classeur

Le **Classeur** est la structure de travail du manuscrit. Il sert à naviguer, rechercher, filtrer, déplacer, sélectionner et isoler une partie du projet. La **double vue** peut ajouter à gauche l’arborescence du Manuscrit et un accès léger au Coffre, tandis que le Classeur de droite reste la surface de travail.

### Continu

**Continu** permet d’écrire plusieurs feuillets dans un seul éditeur sans les fusionner. Les frontières entre fichiers restent protégées et les modifications repartent vers les fichiers Markdown correspondants.

### Les vues de structure

**Cartes**, **Plan**, **Chemin de fer** et **Chronologie** montrent les mêmes fichiers sous des angles différents : organisation visuelle, métadonnées, fils narratifs ou ordre des événements. Le **Carnet** reste l’espace d’exploration libre sur Canvas.

### Le panneau droit

Cinq onglets accompagnent le texte sans remplacer le manuscrit :

- **Feuillet** — synopsis, résumé, notes, propriétés, annotations, notes de bas de page et Contexte ;
- **Recherche** — documentation, personnages, lieux, événements, sources, bibliographie et dossiers associés ;
- **Journal** — journal d’écriture et suivi ;
- **Projet** — objectifs, statuts, labels, tags et adaptation des propriétés YAML ;
- **Relecture** — analyse de texte, relecture collaborative, Révision DOCX et comparaison.

### Édition

**Édition** est une surface centrale distincte du panneau droit. **Composition** décide ce qui entre dans le document et peut définir variantes, extractions et collections ; **Mise en page** règle sa présentation. La barre rapide organise **Portée → Contenu → Format → Exporter**. L’**Aperçu** permet de vérifier le résultat et l’export reste accessible sans devoir l’ouvrir.

## Philosophie

Feuillets doit s’adapter au coffre existant plutôt que demander à l’auteur de reconstruire son organisation pour le plugin : fichiers Markdown ordinaires, dossiers réels, ordre du manuscrit, propriétés YAML et Recherche existante restent sous le contrôle de l’utilisateur.

Pour suivre l’ensemble du travail dans son ordre naturel, voir [Le parcours d’un auteur](PARCOURS-AUTEUR.md).
