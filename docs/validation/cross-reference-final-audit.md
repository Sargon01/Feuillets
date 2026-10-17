# Références croisées : audit final et recette de fusion

Audit du 17 octobre 2026 sur `feat/3.7-cross-references`. **Verdict : non prêt à fusionner selon le critère de conformité complète des exports demandé.** Les trois défauts de références croisées reproduits sont corrigés et validés. Le contrôle final révèle toutefois des pertes de contenu préexistantes dans les exporteurs DOCX et ODT, détaillées ci-dessous ; elles empêchent de déclarer toute la chaîne éditoriale conforme. Les exporteurs n’ont pas été étendus dans cet audit.

## État initial et réconciliation

Le dépôt était propre, sur la branche attendue, au commit `b5f0238ca740e4361564d5ac6cfc0a8828998ef6`. Les développements précédents sont présents : `b59612b` (modèle), `453f1dd` (insertion), `228f3be` (périmètres), les corrections jusqu’à `c98f0b1`, puis `b5f0238` (composition).

La base commune initiale est `660a1b0e18225db59c2f0bec41736932b38d391d`. La réconciliation `a913f0e347d30bde00019c9ea7ecfc9223684a8b` conserve comme parents `e7ed075d5b0349d5334e1e14da3e227938a75257` (le `main` local) et `b75f427`. `main` est bien un ancêtre de la branche auditée. Le delta fonctionnel par rapport à ce `main` comporte 36 fichiers avant les présentes corrections, sans suppression de fichier.

L’examen du delta depuis la base initiale et du delta `main...b5f0238` n’a révélé aucune fonctionnalité supprimée par la réconciliation. Les sources de Carnet, les exporteurs natifs, le compagnon CSL, les dépendances et la version ne sont pas modifiés par la fonctionnalité. Les changements partagés concernent notamment le test de chevauchement des sélections, les helpers d’annexes et la portée des ressources d’un espace de travail ; leur comportement existant est couvert par la suite complète.

Le [rapport de composition précédent](cross-reference-composition.md) correspond aux points d’intégration du code. Il était incomplet sur les références couvrant plusieurs paragraphes, formulait incorrectement l’indisponibilité de Word et comptait le dossier ZIP des médias DOCX comme un média supplémentaire. Il est désormais annoté et relié à cette recette. Son contrôle positif des références ne vaut pas validation de la fidélité générale des exporteurs.

## Architecture et qualité

L’architecture existante est conservée :

| Responsabilité | Composants examinés | Conclusion |
| --- | --- | --- |
| Modèle, identités et ancres | `cross-reference-model`, `source-anchor`, détection et résolution | Identités indépendantes des numéros ; rattachement conservateur, sans choix silencieux d’une autre cible. |
| Stockage | `cross-reference-store` | File d’opérations par application et fichier JSON, contrôle des écritures concurrentes externes ; vérification de chevauchement ajoutée à cette file. |
| Périmètre et numérotation | `cross-reference-context`, `cross-reference-format` | Un seul contexte et les compteurs existants, dans l’ordre éditorial effectif. |
| Insertion et rendu | Contrôleur, modales, `cm-cross-references`, lecteurs natifs et Continu | Préservation du texte humain ; décorations séparées du stockage. |
| Composition | `cross-reference-composition`, segments, compilation, transformations et notes | Résolution sur les instantanés réellement utilisés ; substitutions par offsets de chaque source, avant transformation. |
| Aperçu | `preview-view`, `preview-source-map` | Contextes partagé et locaux réutilisés, positions source transportées ; correction du regroupement des blocs uniquement. |
| Exports et CSL | Compilation, renderers et services natifs, paquet Pandoc | Les formats consomment la composition ; aucun résolveur ou compteur propre à un format. CSL reste indépendant. |

Aucune duplication de moteur, abstraction superflue ou dépendance circulaire problématique démontrée dans la fonctionnalité Références croisées. L’analyse des imports d’exécution des 360 modules source ne trouve aucun cycle impliquant les modules de références croisées. Les abonnements, délais et générations asynchrones des décorations sont libérés ou invalidés à la destruction. Aucun état ou service n’a été supprimé sans défaut démontré.

Les quatre fichiers de production corrigés utilisent les API et helpers existants. Aucun `any`, contournement TypeScript, désactivation ESLint, `!important`, nouvelle dépendance, nouveau moteur ou changement de version. Les deux nouveaux commentaires techniques expliquent des contraintes non évidentes, en anglais. Aucun nettoyage esthétique ou changement de pagination. Les notifications existantes et leurs traductions sont réutilisées.

## Défauts reproduits et corrections

### Insertions concurrentes superposées

Deux commandes lancées sur le même passage passent chacune le contrôle du contrôleur avant la première écriture. À l’état initial, le test automatisé et Obsidian réel enregistrent **deux occurrences superposées**, sur une seule cible. Le problème existe entre deux éditeurs natifs et entre un éditeur natif et Continu.

La vérification est répétée **dans l’opération de stockage déjà sérialisée**, après lecture du dernier JSON. Elle utilise le résolveur d’occurrences et le helper de chevauchement existants. Une erreur typée permet au contrôleur d’afficher la notification de chevauchement sans consigner une erreur inattendue. Aucun verrou global.

Résultat après correction et nouvelle répétition sur le build final : **une occurrence, une cible, aucun chevauchement**, dans les deux scénarios. Le Markdown est inchangé. Les tests vérifient les sélections conservées ; la sauvegarde puis la réouverture natives et Continu affichent la référence résolue. Aucun message d’erreur de console capturé.

Les tests existants de sérialisation et de conflit d’écriture utilisaient aussi deux plages identiques, sans tester le chevauchement. Leurs entrées deviennent disjointes pour continuer à atteindre leurs propriétés respectives : réutilisation atomique d’une cible et détection du changement externe du JSON. Leurs assertions sont conservées, avec deux nouveaux tests dédiés au chevauchement.

### Navigation après une référence couvrant deux paragraphes

Une sélection peut couvrir le séparateur de deux paragraphes. Son remplacement fusionne les deux blocs rendus, alors que la provenance avançait encore de deux blocs source. Dans Obsidian, le paragraphe suivant situé **ligne 12** était marqué ligne 10 ; la navigation native allait donc ligne 10.

`buildBlocksByPath` regroupe désormais les sections source dont le séparateur entier est couvert par un remplacement. Le groupe conserve le texte original complet, ses limites et ses remplacements relatifs. Le mapper existant retrouve ainsi les caractères du second paragraphe et les blocs suivants. Le moteur de pagination reste inchangé : **14 pages avant et après correction** dans le manuscrit de reproduction.

Résultat natif : le bloc fusionné couvre les lignes 8 à 10 ; le paragraphe suivant est marqué ligne 12 et le curseur natif arrive ligne 12. Des clics physiques, via Playwright sur l’iframe réelle, après trois références retrouvent dans Continu les positions source **4:48**, **6:11** et **10:24**, respectivement après un remplacement plus court, plus long et couvrant deux paragraphes. Aucun remplacement de l’API de hit-testing n’est utilisé pour ces trois clics.

### Ancien tampon d’une vue Lecture après modification externe

Obsidian conserve un éditeur derrière certaines vues Lecture. Après modification externe d’un source, le fichier était à jour, mais `readCrossReferenceContent` retournait cet ancien tampon. Continu conservait alors ses décorations sur son ancien document.

Le lecteur utilise désormais les tampons natifs uniquement en mode `source`, pour les vues actives et inactives. Les segments modifiés de Continu gardent leur priorité existante ; sinon le lecteur utilise le fichier courant. Deux nouveaux tests couvrent les vues Lecture actives et inactives et vérifient encore la priorité du tampon en mode source.

Dans Obsidian réel, les décorations périmées disparaissent après la modification externe ; le document Continu n’est pas rebasé silencieusement. Une recomposition charge le nouveau source et rétablit les références. Aucun changement de stockage ni de CSL.

## Recette dans Obsidian réel

Application **Obsidian 1.13.7**, pilotée par CDP/Electron sur le port 9244. Coffre exclusivement jetable `/private/tmp/feuillets-xref-integrity/vault`, profil séparé `/private/tmp/feuillets-xref-integrity/profile`. Aucun accès en écriture au coffre personnel.

Le projet `FinalMergeRecipe` est créé par la vraie boîte de création Feuillets. Il contient deux chapitres, plusieurs sections, deux figures légendées, deux tableaux, une annexe, des notes, du YAML, des titres et pages générés, deux références bibliographiques réelles et des styles CSL Chicago à notes et auteur-date. Les vues utilisent le build de production ; un plugin temporaire compile les services de production pour invoquer les exports et lire les preuves. Les API Obsidian ne sont pas simulées.

Les **30 contrôles nommés** du scénario principal, les deux scénarios de concurrence et la reproduction des offsets couvrent :

- Insertion native sur sélection, insertion au curseur et liaison de sélection dans Continu ; édition et sauvegarde du bon segment.
- Section et légende renommées ; actualisation d’un Aperçu déjà ouvert ; réorganisation du Binder, recompilation et changements Feuillet/Chapitre/Manuscrit.
- Cibles supprimées, ambiguës et hors périmètre : texte humain conservé dans le corps et les notes.
- Référence dans une annexe ; annexe incluse puis exclue ; références voisines de citations groupées, narratives et de citations dans une note.
- Deux fichiers portant `[^1]` dans l’Aperçu Chapitre : **deux notes indépendantes**, avec référence et citation conservées.
- Déplacement du fichier cible dans un sous-dossier et renommage du fichier contenant les occurrences : **15 identités préexistantes inchangées** ; affichages courants conservés.
- Navigation Aperçu → éditeur natif et Aperçu → Continu ; clics physiques après substitutions courtes, longues et couvrant deux paragraphes.
- Fermeture/réouverture des vues et rechargement complet du renderer Obsidian : **9 fichiers Markdown/JSON identiques**, provider CSL réenregistré et références affichées.
- Ouverture effective des pages Édition Composition, Mise en page et Dossier éditorial ; création puis réouverture d’un Carnet de dossier vide. Il s’agit d’un contrôle rapide ; les interactions détaillées de Carnet restent couvertes par les tests existants.
- **18 exports réels** sur le code final : six formats pour chacun des trois cas CSL à notes, auteur-date, et annexe exclue.

Aucune erreur de console capturée pendant les scénarios réussis. Les sources et le JSON sont comparés octet pour octet, puis par SHA‑256 : **9/9 identiques** après les rendus, compilations et exports. Les modifications intentionnelles des scénarios sont restaurées avant comparaison.

Les délais du harnais et ses assertions ont été ajustés à la virtualisation de Continu, au rechargement de son plugin temporaire et aux chemins d’images réécrits par le renommage Obsidian. Ces adaptations ne constituent pas des correctifs du produit ni des vérifications de lecteur externe.

## Matrice des six exports

Chaque format a été généré et inspecté dans les trois compositions. Après inversion des chapitres : `Section: Updated destination. Image: image 1. Table: 1. Appendix: appendix 1.` ; dans la note : `Caption: Current caption.`. L’exclusion de l’annexe conserve `Appendix: appendix fallback.` dans les six formats.

| Format | Références, titre courant et repli | Notes et CSL | Structure et ressources inspectées | Niveau de vérification |
| --- | --- | --- | --- | --- |
| Markdown | Conforme | Référence de note résolue, citekeys groupées/narratives et inconnue conservées | Manuscrit et structures Markdown | Texte produit relu. |
| PDF | Conforme | Note réelle, CSL et bibliographie, citation inconnue conservée | Pagination et pages générées, figures/légendes, tableaux | PDFKit : texte, rasterisation des **14 / 14 / 12 pages**, planches et page de références inspectées visuellement. |
| DOCX | Conforme | Référence dans `footnotes.xml`, CSL aplati et inconnue conservée | OOXML, notes, tableaux, **2 occurrences d’image partageant 1 PNG**, lecture texte native macOS ; **tableaux absents, y compris leur contenu** | Références conformes ; document non conforme pour les tableaux. Rendu Word non validé. |
| ODT | Conforme | Vrais éléments de note, CSL et inconnue conservée | `content.xml` et type MIME ; texte des tableaux conservé sans structure, **images absentes** | Références conformes ; document non conforme pour les images et la structure des tableaux. Rendu Word non validé. |
| EPUB | Conforme | Référence dans la note, CSL et inconnue conservée | XHTML, navigation, type MIME, **2 tableaux et 2 images incorporées en data URI** | Paquet inspecté ; aucune liseuse graphique déclarée validée. |
| ZIP Pandoc | Conforme | Citekeys originales conservées | `manuscript.md`, **1 `.bib`, 1 `.csl`, 2 PNG** | ZIP extrait et contenu inspecté ; aucun appel à Pandoc. |

### Pertes de contenu des exporteurs existants

L’inspection structurelle renforcée après le contrôle du texte des références révèle :

- DOCX : **0 tableau OOXML**, et absence des en-têtes/cellules `First | Value`, `A | 1`, `Second | Value`, `B | 2`. Les deux images sont présentes par deux éléments `w:drawing`, avec un seul fichier PNG partagé car les fixtures sont identiques. Compter `word/media/` comme un média était une erreur du précédent script.
- ODT : **0 élément de tableau**, bien que le texte des cellules soit conservé ; **0 élément d’image et aucune ressource d’image**. Les légendes restent présentes.
- EPUB : les **2 tableaux et 2 images data URI** sont conservés. Markdown et ZIP Pandoc conservent les deux structures de tableaux et les deux liens d’image ; le ZIP embarque les deux PNG.

Ces comportements proviennent des convertisseurs existants : `blockToParagraphs` ne convertit pas les tables DOCX et le convertisseur ODT ne sérialise pas les images ni les tableaux. `docx-blocks.ts`, `export-docx.ts`, `export-odt.ts` et `export-epub.ts` sont identiques à `main` ; les références croisées ne les ont pas régressés. Ajouter leur prise en charge dépasse les corrections de la fonctionnalité demandée et constituerait un développement d’exporteur. Aucun test n’est ajouté pour entériner ces pertes comme un comportement souhaitable.

Les figures du manuscrit de test utilisent les petites images de fixture existantes ; la présence des références et légendes ne suffit donc pas à valider la présence des objets exportés. Ces pertes sont des réserves bloquantes pour annoncer la conformité complète des six documents, même si les valeurs des références croisées elles-mêmes sont correctes.

Le PDF est produit par le renderer natif paginé. Le harnais intercepte seulement son ultime action d’impression et sauvegarde ce document avec Electron `printToPDF` ; la boîte système d’impression n’est pas pilotée.

## Commandes sur le code final

| Commande | Résultat |
| --- | --- |
| `npm run lint` | Réussite, TypeScript valide, **0 erreur / 30 avertissements préexistants**, aucun nouveau. Tous ces avertissements sont dans des fichiers inchangés par les corrections. |
| `npm run lint:obsidian` | **0 erreur / 0 avertissement**, aucune règle désactivée. |
| `npm test` avec `FEUILLETS_CSL_SOURCE` | **8 599 tests, 8 581 réussis, 0 échec, 18 déjà désactivés**, 4 suites ; environ 65 s. Cinq nouveaux tests exécutés. |
| `npm run test:csl-integration` avec `FEUILLETS_CSL_SOURCE` | **2 réussis, 0 échec, 0 désactivé**, vrai compagnon `/Users/halimyalcin/Programme/Feuillets-CSL`. |
| `npm run build` | TypeScript et build de production réussis. |
| `git diff --check` | Réussite sur le diff de travail puis les changements committés depuis `b5f0238` et depuis `main`. |

Les tests Chromium sont réellement exécutés avec Playwright, hors sandbox macOS avec autorisation. Ils restent distincts de la recette dans l’application réelle. Les 18 tests déjà désactivés sont inchangés. Les tests existants d’Édition, Continu, Carnet, CSL, Aperçu et exports passent. Les tests de refus d’enregistrement vérifient la conservation du texte, des sélections et de la position utilisateur ; cette panne n’a pas été provoquée dans l’application réelle.

## Fichiers corrigés

| Fichier | Modification |
| --- | --- |
| `src/services/cross-reference-store.ts` | Refus des occurrences superposées dans l’opération sérialisée. |
| `src/services/cross-reference-editor-controller.ts` | Notification du refus concurrent attendu. |
| `src/views/preview-view.ts` | Regroupement de provenance des paragraphes fusionnés par une substitution. |
| `src/main.ts` | Lecture des tampons natifs limitée au mode source. |
| `test/cross-reference-editing.test.js` | Deux tests concurrents, deux tests de vue Lecture ; plages concurrentes disjointes dans le test de réutilisation atomique. |
| `test/cross-references.test.js` | Plages disjointes dans les tests existants de sérialisation et de conflit externe. |
| `test/compile-cross-references.test.js` | Régression de provenance et offsets d’une référence couvrant deux paragraphes. |
| `docs/CROSS-REFERENCES.md` | Documentation des comportements et limites intentionnelles. |
| `docs/validation/cross-reference-composition.md` | Annotation historique et correction de la limite de vérification Word. |
| `docs/validation/cross-reference-final-audit.md` | Présent rapport. |

## Limites résiduelles et preuves

| Limite | Gravité / conséquence |
| --- | --- |
| Perte des tableaux DOCX | **Élevée, bloquante pour la conformité complète demandée** : contenu absent malgré une référence de tableau correctement numérotée. Préexistant dans `main`, non corrigé dans cet audit de fonctionnalité. |
| Perte des images et structure des tableaux ODT | **Élevée, bloquante pour la conformité complète demandée** : références résolues mais objets absents ou aplatis. Préexistant dans `main`. |
| Mise en page DOCX/ODT dans Word | Limite de recette non bloquante : Word est installé, mais les tentatives de rendu DOCX et d’ouverture ODT en lecture seule expirent avec **AppleEvent `-1712`**. Aucun rendu visuel Word réussi n’est annoncé. Aucune dépendance ajoutée pour contourner cet essai. |
| EPUB dans une liseuse ; boîte d’impression système | Vérification complémentaire non effectuée ; contenus EPUB et PDF natif paginé contrôlés comme indiqué. |
| Lecture conserve le texte humain | Comportement intentionnel documenté, sans résolution décorative. |
| Continu après modification externe | Recomposition nécessaire pour afficher le nouveau source ; décorations périmées retirées. Comportement intentionnel. |
| Cibles non rattachables ou hors portée | Texte humain conservé ; aucune réaffectation ni numéro inventé. Comportement intentionnel. |
| Échec d’enregistrement | Texte humain conservé et notification ; vérification automatisée, sans injection de panne dans Obsidian réel. |

Preuves temporaires : `/private/tmp/feuillets-xref-final-audit` contient `result.json` (30 contrôles uniques et empreintes), les reproductions `concurrency-before*.json` et `concurrency-after-final*.json`, `offsets-before.json`, `offsets-after.json`, `pointer-navigation.json`, `reload-snapshot.json`, `inspection.json`, `structures.json`, les scripts, PDF et images de contrôle. Les exports natifs sont sous `FinalMergeRecipe/_Feuillets/Output` dans le coffre jetable.

Journaux finaux : `/private/tmp/xref-audit-lint.log`, `xref-audit-lint-obsidian.log`, `xref-audit-tests.log`, `xref-audit-csl.log`, `xref-audit-build.log`. Les tentatives Word sont décrites ci-dessus ; le journal ODT est `word-odt.log` dans le dossier de preuves.

Le commit de correction reste sur `feat/3.7-cross-references`. Son SHA et l’état Git sont fournis dans la livraison. Aucun push, fusion, changement de version ou publication.
