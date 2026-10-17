# Références croisées : finition des éditeurs et exports

Recette du 17 octobre 2026 sur `feat/3.7-cross-references`, commencée dans un dépôt propre au commit attendu `9f17487f90a1d37bfaeb63b7895beb0dae27d73a`. Elle complète l’[audit précédent](cross-reference-final-audit.md) sans reprendre le développement du moteur.

**Verdict : les corrections de ce périmètre sont prêtes à fusionner.** Les pertes de tableaux DOCX et d’images/tableaux ODT sont corrigées ; les références restent cohérentes dans les six formats. La mise en page dans Word ou Pages n’a pas été validée visuellement : les permissions macOS nécessaires sont indisponibles. Cette limite de vérification complémentaire est distincte des contrôles structurels réussis. Deux modifications concurrentes hors périmètre dans les fichiers de dépendances restent exclues de la livraison et de ce verdict.

## Défauts reproduits et intégration

### Identification dans les éditeurs

Une référence résolue était indiscernable du texte courant. Le widget existant reçoit un soulignement pointillé de 1 px, avec `var(--text-faint)`, sans fond, encadré, icône, action de clic ni changement des métriques du texte. À la sélection, le remplacement cède sa place à une décoration de plage : le texte humain original reste éditable et conserve le même soulignement discret. Les occurrences non résolues ne portent aucune marque de validité.

L’infobulle affiche le type et le numéro contextuel, le titre ou la légende courante, puis le nom du fichier sans extension. Ces informations proviennent de la résolution déjà calculée pour les décorations ; aucun second résolveur ni compteur n’est ajouté. Le mécanisme d’infobulle CSL existant assure le positionnement, la transition vers le panneau et le nettoyage. Les classes éditoriales ne sont produites ni dans l’Aperçu paginé ni dans les exports.

Un défaut du mécanisme partagé a été reproduit dans une fenêtre Obsidian détachée : lors de l’adoption d’un widget déjà créé, son infobulle s’ouvrait dans le document principal. Le mécanisme relit maintenant `ownerDocument` à l’ouverture et libère les ressources de l’ancienne fenêtre avant de se rattacher à la nouvelle. Le compagnon CSL n’est pas modifié. Un test dédié contrôle aussi le déplacement d’une infobulle de citation et le retrait des écouteurs.

### Tableaux DOCX

La conversion existante ignorait les blocs HTML `table` ; le document Word perdait donc les tableaux. Le convertisseur utilise désormais `Table`, `TableRow` et `TableCell` de la bibliothèque `docx` déjà installée. Le type de bloc est limité à `Paragraph | Table` ; les sections et pages liminaires acceptent ce type sans nouvelle chaîne de conversion.

Les cellules réutilisent le convertisseur inline : gras, italique, Unicode, références résolues et appels de notes gardent leur traitement existant. Les en-têtes sont de vraies lignes d’en-tête Word. Les alignements simples et les cellules vides sont préservés ; chaque cellule contient un paragraphe. Les paragraphes avant et après le tableau conservent leur ordre. Les notes restent compatibles avec le type de paragraphes requis par l’API `docx`.

### Images et tableaux ODT

Le convertisseur ODT ne traitait pas les images et aplatissait les tableaux en texte. Il utilise maintenant les octets et dimensions déjà fournis par `export-render`, sans second lecteur des ressources du coffre.

Les images locales PNG, JPEG, GIF et SVG prises en charge sont écrites sous `Pictures/`, déclarées avec leur MIME dans le manifeste et référencées par `draw:frame` / `draw:image`. Les dimensions conservent les proportions et sont limitées à l’espace de la page ou de la colonne. Les légendes suivent les images. Les formats non pris en charge, dont WebP dans cet exporteur, déclenchent une notification traduite ; les avertissements partagés sur les images manquantes restent actifs, sans doublon pour la même ressource.

Les tableaux deviennent des structures `table:table`, colonnes, lignes, cellules et groupes d’en-têtes. Les cellules réutilisent le traitement inline ODT, avec paragraphes et styles limités aux alignements, à l’en-tête et aux bordures simples. La construction ODF existante conserve les métadonnées, pages liminaires, styles de gabarit, notes, bibliographies et sauts de page.

La recette a également démontré un défaut commun de préparation des médias : un manuscrit composé de plusieurs fichiers était rendu avec un seul chemin source. Deux images homonymes pouvaient donc être résolues depuis le mauvais chapitre, voire depuis un autre projet. Dans le cas reproduit, les exports incorporaient un ancien PNG de 68 octets au lieu des deux cartes distinctes attendues.

La préparation native réutilise maintenant `transformSegmentMedia`, déjà utilisé par le paquet Pandoc, pour qualifier les chemins avec le fichier d’origine de chaque segment. Ce mode ne collecte ni ne lit les ressources ; le lecteur partagé existant reste responsable des octets. Les deux variantes `text` et `renderText` sont préparées dans une copie locale destinée à l’export. Les blocs de code, titres d’images, alias de dimensions et ressources indisponibles restent préservés. Un wikilien sans alias devient une image Markdown sans légende, ce qui évite de transformer son chemin qualifié en légende artificielle dans le renderer Obsidian réel.

Cette correction partagée explique le changement de `compile-export.ts` : aucun moteur PDF ou EPUB n’est modifié. Le Markdown compilé et le paquet Pandoc conservent leurs traitements existants. Aucun changement du stockage, des identifiants, de la numérotation ou de la pagination.

## Recette dans Obsidian réel

Application locale **Obsidian 1.14.4**, pilotée par CDP/Electron, avec profil `/private/tmp/feuillets-xref-integrity/profile` et coffre jetable `/private/tmp/feuillets-xref-integrity/vault`. Le build de production est installé uniquement dans ce coffre. Le compagnon Feuillets CSL réel est chargé. Aucun accès en écriture au coffre personnel.

Le projet `FinishExportsRecipe` est créé par la boîte de dialogue Feuillets. Il contient deux chapitres, plusieurs sections, deux PNG distincts avec légendes, deux tableaux, une annexe, une page liminaire, des titres et listes générés, du YAML, des notes et des citations bibliographiques. Sept occurrences persistantes sur quatre cibles sont insérées par la vraie commande native, dont une dans une note et deux dans des cellules de tableau. Les images ont les dimensions 640 × 480 et 720 × 400 ; leurs contenus sont volontairement différents.

Les **31 contrôles nommés distincts**, dont les 18 générations d’exports regroupées en trois scénarios, couvrent :

- Soulignement et infobulle réels en Live Preview et Continu, dans les thèmes clair et sombre ; inspection des captures, couleur neutre et métriques du texte conservées.
- Transition physique du pointeur vers l’infobulle sans fermeture, puis fermeture en quittant le panneau.
- Sélection native et sélection dans Continu : texte `figure fallback` révélé, marque discrète conservée, positions, texte et focus inchangés.
- Déplacement d’un éditeur existant vers une fenêtre détachée : l’infobulle appartient au document de cette fenêtre, sans panneau dans la fenêtre principale.
- Changement réel de fichier alors qu’une infobulle est visible : retrait du panneau et des anciennes décorations.
- Renommage de section et de légende : actualisation dans les deux éditeurs, l’infobulle et un Aperçu déjà ouvert. La légende « Carte des secteurs étudiés » devient « Carte des zones étudiées » dans la composition et les exports.
- Réorganisation des chapitres : figure et tableau passent au numéro 1 ; recompilation et Aperçu sont cohérents. Les références en cellules sont aussi résolues dans les documents exportés.
- Modes Feuillet, Chapitre et Manuscrit ; annexe incluse/exclue ; cible supprimée ou ambiguë : conservation du texte humain, sans marque de validité ni destination inventée.
- Notes avec référence et citation dans la même note ; citations groupées, narratives et non résolues ; bibliographies CSL à notes et auteur-date.
- Deux fichiers portant `[^1]` : deux notes indépendantes dans l’Aperçu Chapitre.
- Marqueurs et navigation Aperçu → éditeur : la position réelle est conservée après des références de longueurs différentes ; le paragraphe contrôlé ramène le curseur à la ligne source 8.
- Rechargement complet du renderer Obsidian, réenregistrement du provider CSL et conservation de la composition.
- Comparaison octet pour octet puis SHA-256 de **7 fichiers Markdown/JSON** après rendus, compilations et exports : **7/7 identiques**. Les modifications intentionnelles des scénarios sont restaurées avant comparaison.

Aucune erreur de console capturée dans les scénarios réussis. Les adaptations du harnais concernent le document DOM des fenêtres détachées, les vues masquées et la recomposition de Continu après modification externe. Elles ne constituent pas des modifications du produit. Le texte visible des widgets est contrôlé séparément des métadonnées cachées de leur infobulle.

Ces essais utilisent les API et vues réelles d’Obsidian. Les tests automatisés Chromium avec APIs Obsidian simulées sont exécutés séparément et ne sont pas présentés comme des essais de l’application réelle.

## Matrice des six exports

Chaque format a été réellement généré dans trois compositions : CSL à notes, CSL auteur-date et annexe exclue, soit **18 documents**. Valeurs communes attendues après réorganisation : `Section: Updated destination. Image: image 1. Table: 1.` ; légende courante `Carte des zones étudiées`. L’annexe exclue conserve `appendix fallback`.

| Format | Références, notes et CSL | Tableaux et images | Niveau de validation |
| --- | --- | --- | --- |
| Markdown | Valeurs courantes et repli humain ; citekeys préservées | Tables Markdown et liens d’images conservés | Inspection du texte des trois compositions |
| PDF | Valeurs courantes, notes et bibliographies rendues ; citation inconnue conservée | Deux tableaux et deux cartes visibles avec leurs légendes | PDF natif paginé réellement produit, extraction PDFKit et inspection visuelle des planches et pages ; 17 / 17 / 15 pages |
| DOCX | Références dans le corps, les notes et les cellules ; CSL rendu | Deux vrais `w:tbl`, 7 `w:tr`, 17 `w:tc`, deux lignes d’en-tête actives ; deux images incorporées | XML, relations, ZIP et octets des images contrôlés ; rendu Word/Pages non vérifié |
| ODT | Références dans le corps, les notes et les cellules ; CSL rendu | Deux vrais tableaux ODF, 7 lignes, 17 cellules, en-têtes ; deux fichiers PNG sous `Pictures/` | XML bien formés, manifeste, liens internes, dimensions et octets des images contrôlés ; rendu Word/Pages non vérifié |
| EPUB | Valeurs courantes et repli humain ; notes et bibliographies rendues | Deux tables XHTML et deux images incorporées correspondant aux sources | Inspection ZIP/XHTML et octets des images ; ouverture dans une liseuse non effectuée |
| ZIP Pandoc | Markdown résolu, citekeys conservées | Deux images exactes, bibliographie et style CSL embarqués | Inspection de l’archive et de son manuscrit ; aucun appel de Pandoc |

Les contrôles DOCX/ODT vérifient aussi l’ordre des blocs et des cellules, le gras, l’italique, les alignements, les caractères Unicode et les paragraphes vides nécessaires. Les empreintes des images extraites correspondent exactement aux **deux PNG source distincts** : 24 765 et 24 938 octets. La réduction DOCX conserve l’arrondi existant au pixel ; celle de l’ODT conserve le rapport d’aspect dans les limites de page. Aucun chemin `app://`, URL temporaire ou URI de données ne remplace les références internes ODT.

Le `mimetype` ODT reste le premier membre ZIP, non compressé. Les quatre XML ODT sont analysés, ainsi que les XML des autres archives. Aucun paragraphe ODT directement imbriqué dans un autre n’est produit par les nouveaux traitements. Les marques et textes d’infobulle des éditeurs sont absents des documents finaux.

### Ouverture et validation visuelle externe

Word et Pages sont installés. Des copies en lecture seule des DOCX/ODT ont été confiées aux applications par LaunchServices, sans automatisation AppleEvent. Les commandes ont été acceptées ; cela ne prouve ni l’ouverture effective du document ni son rendu correct.

L’observation native a échoué avec `screen-recording-denied`, puis `accessibility-denied` pour l’essai sans capture. Aucune permission n’a été modifiée et aucune dépendance n’a été installée pour contourner cette limite. **Aucune validation visuelle DOCX/ODT n’est annoncée.** La session d’inspection native est fermée. Les PDF sont, eux, rendus en PNG avec PDFKit et examinés visuellement.

## Tests et qualité

| Commande finale | Résultat |
| --- | --- |
| `npm run lint` | Réussite ; TypeScript valide, 0 erreur et 30 avertissements préexistants, aucun nouveau |
| `npm run lint:obsidian` | Réussite ; **0 erreur, 0 avertissement** |
| `npm test` | **8 604 tests : 8 586 réussis, 0 échec, 18 ignorés préexistants**, 4 suites ; Chromium réellement lancé |
| `npm run test:csl-integration` | **2 réussis, 0 échec, 0 ignoré**, compagnon CSL réel |
| `npm run build` | Réussite ; build de production et TypeScript valides |
| `git diff --check` | Réussite sur le travail final et sur les modifications commitées |

Pour les deux commandes de tests, `FEUILLETS_CSL_SOURCE=/Users/halimyalcin/Programme/Feuillets-CSL` est renseigné explicitement. Un premier lancement sans cette variable a laissé le test compagnon optionnel ignoré et fait échouer le contrôle CSL obligatoire ; les deux commandes ont ensuite été réexécutées avec le compagnon réel, avec les résultats ci-dessus. Aucun test n’est désactivé pour satisfaire la recette.

La base validée comptait 8 599 tests, 8 581 réussis et les mêmes 18 ignorés. Les cinq nouveaux tests couvrent l’adoption DOM d’une infobulle, les structures Word, l’incorporation/structure ODT, les avertissements ODT et les chemins de médias par segment. Les tests existants de décorations et le scénario Chromium sont renforcés pour le soulignement, le texte visible, la sélection, le renommage, la coexistence CSL et le nettoyage. Les tests ciblés des convertisseurs et de la préparation des exports réussissent aussi : 162 tests, aucun échec ni test ignoré.

Les identifiants et nouveaux commentaires techniques sont en anglais ; les libellés passent par `en.ts` / `fr.ts`. Aucun `any`, contournement TypeScript, règle désactivée, `!important`, dépendance ajoutée, service de navigation, changement de version ou nouveau moteur. Les exceptions de sélection préservent l’intégrité CodeMirror ; aucun traitement CSL n’est remplacé. Les validations existantes Édition, Continu, Carnet, CSL, Aperçu et exports restent vertes.

## Fichiers modifiés et livraison

| Ensemble | Fichiers |
| --- | --- |
| Éditeurs | `src/utils/cm-cross-references.ts`, `src/services/pandoc-citation-preview.ts`, `styles.css`, `src/i18n/en.ts`, `src/i18n/fr.ts` |
| DOCX | `src/services/docx-blocks.ts`, `src/services/export-docx.ts` |
| ODT et ressources | `src/services/export-odt.ts`, `src/services/export-render.ts`, `src/services/compile-export.ts` ; traductions ci-dessus |
| Tests | `test/cross-reference-browser.test.js`, `test/cross-reference-editing.test.js`, `test/pandoc-citation-tooltip.test.js`, `test/docx-blocks.test.js`, `test/export-odt.test.js`, `test/compile-export.test.js` |
| Documentation | `docs/CROSS-REFERENCES.md`, le présent rapport, annotations historiques dans `cross-reference-composition.md` et `cross-reference-final-audit.md` |

Trois commits fonctionnels séparent l’ergonomie, les tableaux DOCX et les images/tableaux ODT. Leurs SHA finaux et l’état Git sont fournis dans la livraison. L’ajout concurrent de Tauri dans `package.json` et `package-lock.json` est conservé hors commits ; il n’est ni requis par ces corrections ni validé comme évolution du produit. La version Feuillets reste **3.6.1**. Aucun push, merge, changement de version ou publication.

## Limites et preuves

| Limite restante | Gravité / conséquence |
| --- | --- |
| Rendu Word/Pages DOCX/ODT non observé | Limite de recette complémentaire ; structure et contenu vérifiés, fidélité visuelle dans ces lecteurs non annoncée |
| WebP non incorporé en ODT | Limite explicite avec notification ; PNG/JPEG/GIF/SVG acceptés, aucune conversion externe ajoutée |
| Mode Lecture et source sans Live Preview | Texte humain conservé ; comportement intentionnel inchangé |
| Continu après modification externe | Recomposition nécessaire pour charger le nouveau texte ; décorations périmées retirées, comportement intentionnel inchangé |
| Chevauchement avec des widgets d’édition Markdown complexes | La priorité reste à l’édition CodeMirror ; aucun surlignage artificiel n’est ajouté sur les widgets de tableau |
| Cibles supprimées, ambiguës ou hors périmètre | Texte humain conservé ; aucune destination inventée |
| Ressource manquante ou format ODT non pris en charge | Notification et texte de repli ; pas de substitution silencieuse |
| Échec d’enregistrement d’une relation | Comportement antérieur conservé et testé : texte humain maintenu, notification ; pas de nouvelle injection de panne dans Obsidian |
| EPUB dans une liseuse, dialogue système d’impression PDF | Vérifications complémentaires non effectuées ; les contenus EPUB et le PDF paginé réel sont contrôlés comme indiqué |

Preuves temporaires : `/private/tmp/feuillets-xref-finish` contient `result.json` (31 contrôles uniques et empreintes), `inspection.json` (15 inspections texte/archives), `reader-validation.json`, `pdf-inspection.log`, les scripts, captures des éditeurs et fenêtres détachées, PDF et planches PNG. Les 15 autres documents exportés sont dans `FinishExportsRecipe/_Feuillets/Output` du coffre jetable. Les contrôles structurels n’utilisent pas l’existence seule des fichiers comme critère de réussite.

Journaux : `/private/tmp/xref-finish-lint.log`, `xref-finish-lint-obsidian.log`, `xref-finish-tests.log`, `xref-finish-csl.log`, `xref-finish-build.log` et `xref-finish-targeted.log`. Les rapports antérieurs restent des validations historiques ; le présent rapport remplace leurs limites sur les tableaux DOCX et les images/tableaux ODT.
