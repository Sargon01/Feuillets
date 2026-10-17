# Références croisées : composition, Aperçu et exports

Validation du 17 octobre 2026 sur `feat/3.7-cross-references`, à partir de `c98f0b13bc1a5827936142af1f1489014ddd6a4f`. Version du plugin inchangée. Aucun push, merge ou travail de release.

## Audit préalable et défauts reproduits

L’audit a suivi les dix points de la chaîne éditoriale avant l’intégration :

1. Détection des structures par `cross-reference-detection`, rattachement strict des identités et occurrences par `cross-reference-resolution` et `cross-reference-store`.
2. Numérotation par `createCrossReferenceContext`, en fonction du périmètre et de l’ordre des sources ; formatage des trois modes par `formatCrossReference`.
3. Sélection des fichiers par `resolveCompileScopeFiles`, parcours du Binder par `compile`, assemblage séparé des annexes et exclusion effective des fichiers non composés.
4. Lecture des sources, extraction/collection éventuelle, retrait du YAML, notes, wikiliens, typographie et sauts de ligne dans `readBody`.
5. Titres de fichiers/dossiers et contenus générés, ajoutés aux segments sans créer de nouvelles identités persistantes.
6. Préfixage des notes par fichier, puis renumérotation du document dans les deux variantes `text` et `renderText`.
7. Citations Pandoc conservées en Markdown ; rendu CSL statique existant après filtrage du contenu et avant extraction des notes/bibliographies pour les formats natifs.
8. Aperçu : compilation en mémoire pour les portées explicites et le manuscrit ; assemblage distinct pour Feuillet, Chapitre et Partie ; marqueurs de provenance ajoutés avant rendu et convertis en attributs après rendu.
9. PDF, DOCX, ODT et EPUB consomment les segments compilés via les services natifs existants et le renderer Obsidian partagé.
10. Le ZIP Pandoc compile en mémoire, réécrit les chemins des médias par segment et embarque Markdown, bibliographie, CSL et ressources. Il ne lance aucun exécutable Pandoc.

Défauts constatés :

- La compilation et les assemblages locaux de l’Aperçu n’appelaient pas le résolveur de références. Un titre ou une légende renommés et une inversion du Binder laissaient les libellés humains initiaux dans le résultat. Reproduction automatisée avant correction.
- Les substitutions changent les longueurs : utiliser des offsets source sur le texte déjà transformé ne convient pas. Les ancres de mise en page doivent aussi être résolues sur l’original lorsqu’une référence se trouve dans le même paragraphe.
- Dans Obsidian réel, deux fichiers d’un chapitre utilisant chacun `[^1]` produisaient une seule note dans l’Aperçu local : la seconde définition masquait la première et sa référence croisée. Après correction, deux notes indépendantes sont présentes. Ce défaut antérieur bloquait la conservation des références dans les notes ; sa correction réutilise exclusivement les helpers de notes existants.

## Intégration retenue

`cross-reference-composition.ts` constitue le point d’intégration partagé. Il reçoit la portée, les instantanés Markdown utilisés et l’ordre des fichiers retenus, ainsi que les plages source conservées pour les extractions/collections. Il charge les identités en lecture seule et délègue détection, rattachement, numérotation et formatage aux services existants. Il ne contient aucun nouveau compteur ni moteur de résolution.

La compilation conserve ses lectures et son parcours actuels. Après sélection effective des segments, elle résout une seule fois les références, puis réapplique les transformations existantes aux seules sources concernées. Les remplacements utilisent des offsets du fichier original, en ordre décroissant. Ils précèdent les transformations Markdown et la renumérotation finale des notes ; aucun remplacement n’est effectué dans le manuscrit concaténé.

`text` reste le Markdown éditorial ; `renderText` conserve les marqueurs de mise en page. L’injection de ces marqueurs et les substitutions partagent les coordonnées originales pour préserver les ancres. Les contenus générés sont calculés après résolution.

Les modes locaux de l’Aperçu utilisent le même point d’intégration avec les instantanés ayant servi à leur assemblage. Les segments transportent les sources originales et les plages substituées pour la provenance. La correspondance des caractères avant, dans et après une substitution est conservée dans les deux sens, avec la vérification typographique existante. La pagination et les gabarits n’ont pas été modifiés.

Dans les assemblages locaux de plusieurs fichiers, les notes utilisent désormais le préfixage existant et, si la composition le demande, la renumérotation existante. Les formats d’export ne recalculent pas les références. Les cibles absentes, ambiguës ou exclues conservent le texte humain. Aucun calcul n’écrit dans le Markdown source ou dans `cross-references.json`.

## Fichiers modifiés

| Fichier | Intervention |
| --- | --- |
| `src/services/cross-reference-composition.ts` | Intégration partagée en lecture seule et substitutions par offsets source. |
| `src/services/compile-export.ts` | Instantanés, résolution après sélection des fichiers, synchronisation des deux variantes de segment. |
| `src/services/content-section-extraction.ts` | Exposition des coordonnées originales des contenus retenus, sans changement du résultat existant. |
| `src/services/content-collection-render.ts` | Signalement des blocs et titres effectivement émis. |
| `src/services/document-layout.ts` | Application des marqueurs et substitutions dans les coordonnées originales. |
| `src/views/preview-view.ts` | Intégration des chemins locaux, provenance et séparation des notes homonymes. |
| `src/views/preview-source-map.ts` | Correspondance source/rendu des textes substitués. |
| `test/compile-cross-references.test.js` | Neuf tests de composition, périmètre, déplacements, instantanés, Aperçu et notes. |
| `test/preview-source-offset.test.js` | Test des offsets avant, dans et après plusieurs substitutions et la typographie. |
| `docs/validation/cross-reference-composition.md` | Audit et compte rendu de validation. |

Aucune modification du stockage, des identifiants persistants, des types de références, des services CSL, du compagnon CSL, des dépendances ou de la version.

## Validations du code final

| Commande | Résultat |
| --- | --- |
| `npm run lint` | Réussite : 0 erreur, 30 avertissements préexistants dans des fichiers non modifiés ; aucun nouvel avertissement. TypeScript valide. |
| `npm run lint:obsidian` | Réussite : **0 erreur, 0 avertissement**. |
| `npm test` avec `FEUILLETS_CSL_SOURCE` | **8 594 tests : 8 576 réussis, 0 échec, 18 déjà désactivés**, 4 suites ; environ 68 s. Les dix nouveaux tests sont exécutés, sans désactivation. |
| `npm run test:csl-integration` avec `FEUILLETS_CSL_SOURCE` | **2 tests réussis, 0 échec, 0 désactivé**, compagnon réel. |
| `npm run build` | Build de production réussi. |
| `git diff --check` | Réussite. |

Le compagnon utilisé est `/Users/halimyalcin/Programme/Feuillets-CSL`. Les tests Chromium ont réellement tourné avec Playwright. Leur premier lancement sous sandbox échouait au démarrage du navigateur sur macOS ; l’exécution autorisée hors sandbox a ensuite réussi. Les 18 tests désactivés sont les anciens tests Notes/Annotations déjà désactivés dans le dépôt, sans modification.

La couverture ajoutée vérifie les titres/légendes courants, les déplacements de figures et tableaux à l’intérieur d’un fichier, la réorganisation du Binder, l’annexe incluse/exclue, les cibles absentes/ambiguës/hors portée, les références dans les notes et à côté de citekeys, le YAML, les titres générés, plusieurs séparateurs, les extractions/collections, les instantanés utilisés, la cohérence Aperçu/compilation, l’intégrité des sources et les offsets après substitution/typographie.

## Obsidian réel

- **Obsidian 1.13.7**, application Electron pilotée par CDP sur le port 9244.
- Profil : `/private/tmp/feuillets-xref-integrity/profile` ; coffre exclusivement jetable : `/private/tmp/feuillets-xref-integrity/vault`.
- Manuscrit final : `CompositionAuditVerified/Manuscript`, avec deux chapitres, plusieurs sections, deux images légendées, deux tableaux, une annexe, du YAML, une page de titre à rôles, des contenus générés, des notes et des citations réelles.
- Cinq occurrences persistantes insérées par la commande native dans l’éditeur, sur quatre cibles ; les trois modes d’affichage sont utilisés. Une référence se trouve dans une note et plusieurs côtoient des citations groupées/narratives.
- **21 contrôles réussis**, aucune erreur de console capturée. Affichage natif, Continu et Aperçu vérifiés ; clics Aperçu → éditeur natif et Aperçu → Continu vérifiés sur les lignes Markdown réelles.
- Renommage de section/légende dans un Aperçu déjà ouvert, réorganisation du Binder, nouvelle compilation, changement de portée, exclusion d’annexe et cibles supprimées/ambiguës vérifiés.
- Collision des notes reproduite puis corrigée dans le vrai mode Chapitre : deux fichiers portant `[^1]` donnent deux notes distinctes ; la première référence et les citations sont conservées.
- **18 exports effectivement générés** : les six formats avec Chicago à notes, les six avec auteur-date, puis les six avec l’annexe exclue pour contrôler le texte humain de repli.
- Les cinq Markdown sources et le JSON ont été comparés octet pour octet, puis par SHA-256 : **6/6 identiques** après compilation, rendu, navigation et exports. Les modifications intentionnelles de scénario ont été restaurées avant cette comparaison.

Ces contrôles utilisent l’application et les API Obsidian réelles, le build de production pour les vues et un module de test temporaire compilant les services de production pour leur invocation. Ils sont distincts des tests Chromium qui substituent l’API Obsidian.

## Matrice des exports inspectés

Chaque ligne a été générée et inspectée dans les trois compositions : Chicago à notes, auteur-date et annexe exclue.

| Format | Titres et numéros contextuels | Référence dans la note | Repli humain hors portée | Citations et ressources | Inspection |
| --- | --- | --- | --- | --- | --- |
| Markdown | Conforme | Conforme | Conforme | Citekeys simples, groupées, narratives et inconnues conservées | Lecture du Markdown produit. |
| PDF | Conforme | Conforme | Conforme | CSL et bibliographie présents ; citation inconnue conservée | Fichiers PDF réels, extraction PDFKit et rasterisation : 13, 13 et 11 pages. |
| DOCX | Conforme | Conforme | Conforme | CSL présent, citation inconnue conservée, deux médias | OOXML `word/document.xml`, `word/footnotes.xml`, médias et lecture par le convertisseur natif macOS. |
| ODT | Conforme | Conforme | Conforme | CSL présent, citation inconnue conservée | `content.xml`, vrais éléments de notes et type MIME ODT. |
| EPUB | Conforme | Conforme | Conforme | CSL présent, citation inconnue conservée | XHTML, navigation et type MIME EPUB dans le paquet réel. |
| ZIP Pandoc | Conforme | Conforme | Conforme | Citekeys conservées, un `.bib`, un `.csl`, deux PNG | `manuscript.md` et ressources extraits du ZIP. |

Après inversion des chapitres, le passage inspecté contient `Section: Updated destination. Image: image 1. Table: 1. Appendix: appendix 1.` ; la note contient `Caption: Current caption.`. Lorsque l’annexe est exclue, `Appendix: appendix fallback.` est conservé dans chacun des six formats.

## Limites de la vérification et preuves

Le PDF natif produit normalement une iframe d’impression et ouvre la boîte système. Pour automatiser sa sauvegarde, le test capture uniquement cette dernière action et imprime le document natif déjà paginé avec Electron `printToPDF`. Le PDF final a été relu et rasterisé ; la boîte d’impression système n’a pas été pilotée.

LibreOffice/Word ne sont pas disponibles dans cet environnement. Les DOCX et ODT ont été inspectés structurellement et textuellement ; leur mise en page dans ces applications n’est donc pas déclarée vérifiée. L’EPUB a été inspecté dans son paquet, sans ouverture dans une liseuse. Aucun exécutable Pandoc n’a été appelé ou ajouté.

Preuves temporaires conservées dans `/private/tmp/feuillets-xref-composition` : `result.json` (contrôles, chemins d’export, SHA-256 avant/après), `inspection.json` (contenus des archives), les scripts de scénario, les PDF et leurs textes/images de contrôle. Les autres exports sont dans `/private/tmp/feuillets-xref-integrity/vault/CompositionAuditVerified/_Feuillets/Output`.

Les journaux de lint, lint Obsidian, tests complets, intégration CSL et build sont respectivement `/private/tmp/xref-lint-final.log`, `/private/tmp/xref-lint-obsidian-final.log`, `/private/tmp/xref-full-test-final.log`, `/private/tmp/xref-csl-final.log` et `/private/tmp/xref-build.log`. Le SHA du commit et l’état Git final sont fournis dans la livraison, afin de ne pas inscrire une référence circulaire dans ce document.
