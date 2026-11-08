# Feuillets — correctifs pédagogiques du 8 novembre 2026

Les trois défauts prioritaires sont corrigés et couverts par des tests reproductibles. Le cours, ses trois médias et le coffre isolé de l’audit du 7 novembre ont été réutilisés. Aucun nouveau cours, aucune fiche Recherche et aucune illustration de remplacement n’ont été créés.

Preuves et supports : `/private/tmp/feuillets-pedagogy-fixes-2026-11-08/`. Les tests indépendants du coffre produisent aussi `/private/tmp/feuillets-pedagogy-validation/`.

## Résultats et limites

| Contrôle précis | Statut | Preuve |
|---|---|---|
| Notes privées absentes de la planification et du rendu direct | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | Tests, dix captures, plein écran réel |
| Notes conservées dans le Markdown | VALIDÉ AUTOMATIQUEMENT SEULEMENT | Empreintes SHA-256 des deux sources avant/après chaque intégration |
| Aperçu Présentation, navigation sur dix diapositives, entrée en plein écran et navigation clavier | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | `obsidian-ui.json`, `ui.log`, `ui-preview-01.png` à `10.png`, `ui-fullscreen.png` |
| DOCX Élève : 18 lignes après les questions, sept solutions absentes | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | OOXML, vrai rendu Quick Look et ses trois pages dérivées examinées |
| Questions 1–6, puis liste indépendante 1–3 | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | OOXML et rendu Quick Look |
| Trois images et leurs légendes | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | Médias OOXML, décodage, rendu des documents et diapositives |
| Départs non unitaires, valeurs discontinues, listes imbriquées, espaces personnalisés en mm/lh | VALIDÉ AUTOMATIQUEMENT SEULEMENT | Tests unitaires et DOM réel sous Chromium |
| Rôles sémantiques, variantes et notes du plan par annotations | VALIDÉ AUTOMATIQUEMENT SEULEMENT | Suites existantes réexécutées ; mécanisme d’annotations inchangé |
| Titres avec leurs documents et URLs complètes dans le PDF complémentaire corrigé | VALIDÉ AUTOMATIQUEMENT ET VISUELLEMENT | Cinq pages A4 examinées individuellement, zéro notice débordante |
| Construction FLOW/STACK, supports et plan imprimable | VALIDÉ AUTOMATIQUEMENT SEULEMENT | Suites existantes du renderer et de composition ; le cours réel utilise SPLIT |
| Coupures de pages dans Word/LibreOffice | NON TESTÉ | Aucun de ces moteurs n’a été piloté ; Quick Look fournit un HTML continu |
| Sauvegarde par le dialogue PDF natif macOS | NON TESTÉ | Aucun fichier présenté comme issu de ce dialogue |
| Fichiers PDF réels de Présentation 16:9/A4, supports 2/4 et plan annoté | NON TESTÉ | Les tests DOM correspondants passent, aucun nouveau fichier de ces sorties n’a été produit |

La validation des lignes DOCX dépasse l’inspection XML : Quick Look a ouvert le vrai fichier et rendu les 18 bordures pointillées. L’impression de son HTML par Chromium donne un complément de trois pages où ces 18 lignes restent visibles. Ce complément ne certifie pas la pagination Word. Il présente encore un titre Document 2 en bas de page et une question 2 répartie sur deux pages : **ÉCHEC pour une affirmation « ce dérivé Quick Look est prêt à imprimer sans réserve »**, et non preuve d’un défaut de pagination Word.

## Reproduction, causes et corrections

### A. Notes du présentateur

Les captures et `71-projection-ui-slides.json` de l’audit montraient trois callouts privés projetés. Le nouveau test de planification échouait avant correction : le contenu privé atteignait la sonde de débordement. Aucun traitement de cette syntaxe n’existait dans la chaîne de Présentation.

Un filtre de blocs Markdown fondé sur Lezer retire uniquement les callouts `speaker-notes` de la copie destinée aux diapositives. Il est appliqué après la découpe logique originale et avant la planification ; le renderer partagé l’applique également à ses entrées directes. Les retours à la ligne sont conservés pour les coordonnées source. Les blocs privés seuls ne créent aucune diapositive vide ; les exemples littéraux en code et les autres callouts restent intacts. Aucun masquage CSS n’est utilisé.

Les dix diapositives obtenues ne contiennent plus les notes ; les onze états de l’audit comprenaient une subdivision due au contenu privé. Les annotations « Note de présentation » utilisées par le plan suivent toujours leur mécanisme existant.

Le test réel a aussi reproduit une scène d’aperçu de hauteur nulle : les éléments absolus de la diapositive ne dimensionnaient pas leur parent et les règles structurelles attendues n’existaient pas dans `styles.css`. Le conteneur, la barre et la scène reçoivent maintenant un dimensionnement explicite. Les captures d’aperçu et de plein écran ont été faites après cette correction.

### B. Espaces de réponse DOCX

Les lignes existent dans le DOM comme des `span.feuillets-answer-line` vides insérés dans les éléments de liste. Le convertisseur inline ne produisait aucun run visible pour ces éléments ; sa conversion de liste ne créait qu’un paragraphe par question. Le test initial trouvait zéro bordure au lieu de deux.

Ces éléments deviennent désormais des paragraphes Word distincts : espace insécable, hauteur minimale et bordures pointillées. Une bordure entre paragraphes empêche Word de fusionner visuellement les réglures identiques. Au corps 12 pt, la hauteur minimale de 18,6 pt et l’espace après de 8,4 pt donnent un pas nominal de 27 pt, soit environ 9,5 mm dans le modèle Word. Les espaces libres personnalisés sont convertis depuis mm ou lh. La question reste liée à sa première ligne.

Le filtre Élève agit toujours avant la conversion. Les sept solutions du vrai cours sont absentes du document ; les 18 lignes et les trois médias sont conservés.

### C. Numérotation

Le convertisseur fabriquait chaque préfixe depuis l’index local `i + 1`, sans lire `ol[start]` ni `li[value]`, et aplatissait les listes imbriquées. Le test initial reproduisait à la fois le départ perdu et l’aplatissement.

Le convertisseur respecte maintenant ces attributs et produit séparément les niveaux imbriqués. Un adaptateur limité au DOCX récupère aussi les marqueurs explicites que le HTML ordinaire ne conserve pas après le premier élément. Il intervient avant le filtrage des variantes ; si les listes source et DOM ne correspondent plus, il s’abstient de poser des numéros sur des éléments potentiellement étrangers. Le départ HTML reste alors le repli.

La représentation existante par préfixes Word est conservée ; aucune numérotation globale n’est imposée. Le cours produit **1, 2, 3, 4, 5, 6**, puis **1, 2, 3** pour sa vérification indépendante.

### Pagination PDF ciblée

Le HTML original capturé dans l’audit a été réimprimé inchangé : huit pages, deux notices débordantes et le titre Document 3 isolé. Avec la source actuelle et le gabarit Arial 12 / interligne 1,25 déjà conservés, le moteur de composition reproduisait neuf pages, trois notices débordantes et des titres de documents seuls.

Deux causes sont établies : le regroupement ne reconnaissait ni les titres constitués d’un paragraphe entièrement en gras ni le wrapper image/source composé ; les longues références ne pouvaient pas se couper dans la colonne. Correction : reconnaissance de ces deux formes, regroupement d’un titre avec son premier callout sémantique s’ils tiennent sur une page, retour à la ligne des références limité aux sources des blocs image/source.

Après correction : cinq pages, titres Document 1/2/3 avec leurs médias, titre Activité avec ses instructions, Vérification rapide avec ses questions, zéro débordement horizontal des trois sources. Les cinq pages ont été rasterisées et ouvertes individuellement. La pagination conserve le choix d’images et le gabarit de l’audit ; aucun changement global de format ou de CSS n’a servi à masquer le résultat.

Le PDF complémentaire final provient du DOM composé et paginé dans Obsidian puis imprimé par Chromium séparé, avec un petit habillage de page pour sa sérialisation. Il n’est pas assimilé au dialogue PDF natif. Aucune panne de ce dialogue n’est conclue.

## Fichiers modifiés et tests

Production :

- `src/services/presentation-private-notes.ts` : filtre des blocs privés.
- `src/services/presentation.ts` et `presentation-slide-renderer.ts` : intégration avant planification et rendu.
- `src/views/presentation-preview-view.ts` : dimensionnement mesurable de la scène.
- `src/services/docx-blocks.ts` : réglures, espaces libres, départs et niveaux de liste.
- `src/services/docx-list-numbering.ts` et `export-docx.ts` : marqueurs source appliqués avant variante.
- `src/services/pagination-engine.ts` et `src/utils/export-templates.ts` : regroupements et références des seuls cas reproduits.

Tests et commandes :

- `test/presentation-private-notes.test.js`, `presentation-slide-planner.test.js`, `presentation-slide-renderer.test.js` : confidentialité, code littéral, pliage, coordonnées, segment privé seul, entrée directe du renderer.
- `test/docx-blocks.test.js` : vraies bordures OOXML, espaces mm/lh, placement, départs, valeurs explicites, imbrication et redémarrage indépendant ; conservation du texte de liste dans les cellules de tableau.
- `test/pagination-engine.test.js` : titres en gras avec wrapper média/source.
- `test/fixtures/pedagogy-browser-entry.ts` et `pedagogy-obsidian-entry.ts` : accès étroit aux fonctions de production pour les deux environnements distincts.
- `scripts/run-pedagogy.mjs`, `pedagogy-obsidian.mjs`, `pedagogy-render-artifacts.mjs`, `package.json` : tests ciblés, intégration dans le coffre isolé et contrôle des documents produits.

Aucune dépendance ajoutée. Aucun commit, push, publication ou release. Le bundle final sans instrumentation a été recopié dans le coffre temporaire et son instance Obsidian a été fermée. Les deux rapports de performance non suivis déjà présents avant la mission sont inchangés.

## Compilation et contrôles finaux

| Commande | Résultat |
|---|---|
| `npm run build` | Réussite |
| `npm run lint` | Réussite ; zéro erreur, 30 avertissements préexistants |
| `npm test` | 8 830 tests : 8 811 réussis, 19 ignorés, zéro échec |
| `npm run test:pedagogy` | 383 tests ciblés réussis, plus contrôles DOM Chromium, OOXML, image, variantes, références et pagination |
| `node scripts/pedagogy-obsidian.mjs` | Intégration réelle réussie : 18 lignes, sept solutions exclues, trois images, dix slides sans débordement ni notes ; sources inchangées |
| `node scripts/pedagogy-obsidian.mjs --ui` | Réussite : dix diapositives, plein écran réel, navigation clavier |
| Quick Look + `node scripts/pedagogy-render-artifacts.mjs` | 18 lignes rendues, médias décodés, références sans débordement dans le complément PDF corrigé |

Les journaux initiaux d’échec sont conservés dans `reproduction.log`. Les essais de navigateur refusés par le bac à sable ont été relancés avec les autorisations imposées par l’environnement. Les journaux finaux sont `build.log`, `lint.log`, `tests.log`, `pedagogy.log`, `obsidian-final.log` et `ui.log`.

## Supports et captures à consulter

- [DOCX Élève corrigé](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/Fiche-eleve-corrected.docx).
- [PDF complémentaire de la fiche corrigée — cinq pages](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/student-pagination-after-chromium.pdf).
- [Complément visuel Quick Look — pagination Chromium, trois pages](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/docx-quicklook-chromium.pdf).
- [Projection réelle en plein écran](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/ui-fullscreen.png).
- [DOCX : questions et réglures rendues](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/final-inspection/02-docx-quicklook-chromium/page-003.png).
- [PDF corrigé : documents et références](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/final-inspection/03-student-pagination-after-chromium/page-003.png).
- [PDF corrigé : questions 1–5 et lignes](/private/tmp/feuillets-pedagogy-fixes-2026-11-08/final-inspection/03-student-pagination-after-chromium/page-004.png).
- `obsidian-integration.json` : DOM natif, sources privées absentes, géométries, sept solutions comparées et empreintes source.
- `obsidian-ui.json` : textes et compteurs des dix états de la vraie interface.
- `final-inspection/manifest.json` et ses sous-dossiers : empreintes, OOXML, médias, texte PDF, dimensions et captures page par page.

## Relancer la validation sans audit général

Depuis le dépôt :

```sh
npm run test:pedagogy
```

Cette commande est autonome et indépendante des fichiers de l’audit. Elle utilise le compilateur, le runner Node, Playwright/Chromium et `docx` déjà présents. Sa fixture DOM est déclarée comme telle, sans prétendre être Obsidian. Une permission d’exécution du navigateur peut être exigée par le bac à sable macOS.

Pour compléter avec le coffre réel conservé, l’instance temporaire doit être disponible sur `http://127.0.0.1:9257` :

```sh
npm run build
node scripts/pedagogy-obsidian.mjs --install
node scripts/pedagogy-obsidian.mjs --ui
# Ou après installation :
npm run test:pedagogy -- --obsidian
```

Le script vérifie le chemin exact du coffre avant toute action. Il refuse un autre coffre et n’utilise aucun CDP distant. Il instrumente uniquement la copie temporaire du plugin afin d’accéder aux vrais modules Obsidian ; le bundle de production du dépôt n’intègre pas ces accès de test. Chaque invocation est bornée à deux minutes et vérifie que les deux sources n’ont pas été modifiées.

Pour le contrôle des documents : produire le Quick Look du DOCX final avec `qlmanage -p -o` dans le répertoire de validation, puis lancer `node scripts/pedagogy-render-artifacts.mjs`. Le moteur de rendu Word/LibreOffice reste une validation complémentaire à effectuer lorsqu’un contrôle automatisable de ces applications sera disponible.
