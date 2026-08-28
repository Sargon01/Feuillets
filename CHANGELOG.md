# Changelog

Toutes les évolutions notables du plugin sont consignées ici.

## 2.7.0

### Carnets, Plan du Binder et mindmaps

- Les dossiers du manuscrit peuvent désormais disposer de leur **propre Carnet Canvas**, en plus du Carnet global du projet.
- Un Carnet de dossier conserve une identité stable lors des renommages et déplacements ; un dossier Recherche explicitement associé peut partager le même Carnet logique que son dossier du Classeur.
- Ajout du **Plan du Binder** dans le Carnet : la structure peut être préparée visuellement puis appliquée explicitement au Classeur après validation complète.
- Le Plan permet de créer et réorganiser feuillets et dossiers, d’indenter ou désindenter la structure et de modifier le titre court des feuillets existants sans renommer leur fichier Markdown.
- Les modifications du Plan restent un brouillon tant que **Appliquer au Binder** n’est pas utilisé ; aucun élément existant n’est supprimé silencieusement.
- Ajout des **mindmaps** natives au Canvas : enfants, frères, reparentage, repli des branches, orientations horizontale/verticale et réorganisation explicite.
- Le fonctionnement principal du Carnet, du Plan et des mindmaps reste disponible sans dépendre d’Advanced Canvas.

### Publication sémantique

- Ajout de **rôles sémantiques facultatifs** permettant d’identifier certaines parties du texte sans transformer le Markdown en format propriétaire.
- Ajout des **variantes**, **extractions** et **collections**, intégrées à la compilation et aux exports : le manuscrit source reste unique.

### Présentation

- Le même Markdown peut désormais alimenter une **Présentation 16:9** sans créer une seconde source.
- Ajout d’un moteur de rendu dédié, de thèmes, de mises en page, d’ajustements locaux et de la planification automatique des diapositives.
- Les notes de présentation restent séparées du contenu projeté ; les présentations peuvent être contrôlées dans un aperçu dédié et exportées en PDF.

### Projets transportables

- Ajout du format **`.feuil`** pour exporter un projet Feuillets dans une archive transportable.
- Un projet exporté peut être réimporté avec sa structure et les réglages pris en charge, sans format propriétaire pour les fichiers Markdown.

### Écriture, mise en page et export

- Correction de l’espacement des paragraphes dans l’éditeur Markdown et dans **Continu**.
- Ajout de primitives de mise en page documentaire et actualisation du modèle de document moderne.
- Les évolutions de publication restent intégrées au flux **Composition → Mise en page → Exporter**.

### Qualité et documentation

- Nettoyage des avertissements et erreurs ESLint/Obsidian et suppression de code devenu inutile.
- Documentation française et anglaise étendue pour les Carnets de dossier, le Plan du Binder, les mindmaps, la publication sémantique et la Présentation.
- Les instantanés et le comparateur sont davantage présentés comme un flux de réécriture non destructif : **instantané → réécriture → comparaison → restauration éventuelle d’un passage**.

### Publication sémantique et variantes

- Variantes, extractions et collections sont intégrées à la compilation et aux exports sans dupliquer la source Markdown.

## 2.6.0

### Écriture et réorganisation

- Ajout de **Réorganiser le texte** dans l’éditeur Markdown et dans **Continu** : les paragraphes peuvent être déplacés par glisser-déposer et une sélection contenue dans un même paragraphe peut être déplacée comme fragment.
- Les déplacements conservent le Markdown exact et constituent chacun une seule étape d’annulation.
- Dans Continu, la réorganisation reste limitée au feuillet source : un passage ne peut pas être déplacé accidentellement à travers une frontière de fichier.
- Les actions d’écriture sont regroupées dans les menus contextuels adaptés à chaque éditeur, sans barre d’écriture supplémentaire.

### Continu

- **Continu** prend désormais en charge les titres Markdown H1 à H6 avec un rendu cohérent avec l’éditeur.
- Son menu contextuel réunit Couper/Copier/Coller, notes de bas de page, **Annotation…**, capture d’idée et **Réorganiser le texte**.
- Les annotations de travail sont pleinement utilisables dans Continu tout en restant rattachées au vrai fichier Markdown source et hors du manuscrit.
- Undo/Redo reste propre au document Continu et les séparations entre feuillets demeurent protégées.
- Avant un export, les modifications encore en attente dans Continu sont enregistrées dans leurs fichiers sources ; l’export est interrompu si cette étape ne peut pas être sécurisée.

### Aperçu et performances

- L’**Aperçu** des grandes portées devient progressif : une première portion peut apparaître rapidement pendant que le document complet termine sa pagination.
- La pagination complète de l’Aperçu cède régulièrement la main à l’interface afin d’éviter les blocages sur les manuscrits volumineux.
- Les petites et moyennes portées conservent leur rendu direct.
- L’export reste toujours fondé sur la portée complète demandée et ne nécessite pas d’ouvrir l’Aperçu.

### Annotations et menus d’écriture

- Le flux des annotations est unifié autour de **Annotation…** dans Markdown et Continu.
- Une annotation existante peut être retrouvée depuis son passage ; les annotations imbriquées restent possibles lorsqu’une nouvelle sélection le justifie.
- Les annotations restent entièrement hors du Markdown et ne sont jamais exportées.
- Les notes de bas de page restent accessibles même lorsque l’environnement Obsidian ne fournit pas de sous-menu natif.

### Qualité, distribution et documentation

- Le bundle de production est désormais minifié afin de réduire sensiblement la taille distribuée, sans obfuscation ni changement du code source.
- Le workflow de release exécute désormais les deux lints avant les tests et le build.
- Suppression des éléments résiduels de l’ancienne barre d’écriture abandonnée.
- Documentation FR/EN mise à jour et nouvelle page **Découvrir Feuillets**, organisée autour des besoins réels de l’auteur et des fonctions faciles à manquer.

### Stabilisation de l’interface

- Avec Feuillets 2.6, l’architecture générale de l’interface est considérée comme **stabilisée**.
- Les prochaines évolutions privilégieront les corrections, l’ergonomie locale, les performances, la lisibilité et la découvrabilité plutôt que de nouvelles réorganisations globales.
- Un déplacement majeur de fonction ou une refonte de la géographie générale de Feuillets devra désormais répondre à un problème utilisateur démontré.

## 2.5.2

### Plan, Cartes et Couloirs

- Finalisation de **Plan** et **Cartes** comme surfaces d’organisation directement éditables.
- Édition en ligne améliorée des informations de structure, notamment dates, personnages et fils narratifs.
- Finalisation de la vue **Couloirs** pour suivre les fils du manuscrit avec une grammaire cohérente avec les autres vues d’organisation.
- Suppression de l’ancienne sous-vue narrative devenue redondante.

### Classeur et inspecteur

- Restauration de **Recherche** et **Versions** dans la double vue du Classeur.
- Restauration et amélioration des **statistiques** dans l’inspecteur, avec réglage d’affichage correspondant.
- Simplification de l’espace **Relecture** et meilleur alignement avec la grammaire visuelle de l’inspecteur.

### Compatibilité et maintenance

- Préservation des alias existants lors de l’écriture des propriétés YAML afin d’éviter leur normalisation destructive.
- Ajustement des statistiques de langage GitHub pour refléter le code applicatif TypeScript sans compter les tests JavaScript.

## 2.5.0

### Écriture et navigation

- Ajout du **mode Continu** : plusieurs feuillets deviennent un seul document réellement éditable, sans fichier composite ni multiplication d'onglets, avec sauvegarde dans les fichiers Markdown sources.
- Synchronisation de portée, navigation et corps de texte entre **Continu** et **Aperçu**.
- Simplification du **Classeur**, des **Cartes** et du **Plan** ; isolation d'un dossier, retour au projet, tri naturel de repli et retour à la ligne optionnel des colonnes longues du Plan.
- Restauration de la **double vue** historique du Classeur : structure des dossiers du Manuscrit à gauche, Classeur 2.5 inchangé à droite, avec un accès documentaire léger et non destructif au Coffre.

### Projet, propriétés et Recherche

- Réglages **propres au projet** pour objectifs, statuts, labels et tags favoris, avec repli compatible sur les réglages historiques.
- **Remappage des propriétés YAML** existantes pour synopsis, résumé, statut, POV, label, objectif, fil narratif, personnages et date, sans migration destructive.
- Les dossiers Recherche existants peuvent être associés à des feuillets/dossiers du Classeur et sont désormais visibles directement dans le panneau Recherche, y compris hors du projet ; leurs fichiers peuvent être ouverts dans un nouvel onglet ou côte à côte sans rendre ces dossiers administrables par Feuillets.
- Rationalisation de la structure des projets, de Recherche, Sources/Bibliographie, Ressources et chemins legacy.

### Annotations, relecture et versions

- Ajout des **annotations de travail** externes au Markdown : surlignage, édition, suppression et liste centralisée.
- Ajout de la **relecture collaborative native** par paquets `.feuillets` : portée feuillet/dossier/projet, copie de travail côté relecteur, notes ancrées, retours, analyse à trois états, décisions auteur, fils et plusieurs tours.
- Nouveau **comparateur** avec ajouts/suppressions/remplacements, détection de déplacements, repères `[…]`, restauration de passage, double-clic de recentrage, navigation précédent/suivant, modes **Changements / Versions** et défilement synchronisé optionnel.
- Révision DOCX déplacée sous **Relecture** et alignée avec la nouvelle grammaire de comparaison.

### Édition, mise en page et export

- Nouvel espace central **Édition** avec deux modes : **Composition** et **Mise en page** ; l'export devient une action de la barre et non un troisième onglet.
- Composition réorganisée autour du contenu du manuscrit, de la **Première page** unique, des pages liminaires, éléments générés, bibliographie, annexes et structure.
- Mise en page simplifiée en **Page / Corps de texte / Titres / Citation**.
- Nouveau modèle de **gabarits V2** partagé entre Aperçu et exports, avec gabarits personnalisés, import Ulysses et import de modèles Word.
- Pagination Preview/PDF fiabilisée, prise en charge des colonnes PDF et meilleure fidélité des styles.
- Export renforcé : résolution unique du nom de sortie, remplacement sûr des fichiers existants malgré les différences de casse sur macOS, gestion d'erreur couvrant la compilation.

### Import et compatibilité

- L'import Scrivener et l'import de plans conservent explicitement **l'ordre de la source** au lieu de dépendre du tri du coffre.
- Import Scrivener réaligné sur la structure canonique des projets Feuillets.
- Compatibilité conservée avec les projets et réglages historiques sans migration destructive automatique.

### Interface et qualité

- Panneau droit rationalisé en **Feuillet / Recherche / Journal / Projet / Relecture**.
- Documents éditoriaux et Édition intégrés comme surfaces centrales plutôt que vues imbriquées.
- Passe i18n FR/EN sur Mise en page, Première page et menus contextuels.
- Plus de 3 400 tests automatisés au moment du gel fonctionnel, avec build, lint et règles de revue Obsidian validés.

## 2.0.5

### Maintenance

- Suppression du dernier avertissement signalé par la Community Review Obsidian.

## 2.0.4

### Maintenance et conformité

- Suppression des derniers avertissements de la Community Review Obsidian.
- Remplacement des créations DOM signalées dans les services d’export.
- Suppression d’une assertion TypeScript redondante.
- Réduction des accès globaux au coffre sans limiter l’association de dossiers de Recherche externes au projet.
- Aucun changement fonctionnel des exports, de la revue DOCX ou du flux d’écriture.

## 2.0.3

### Maintenance et conformité

- Réduction des avertissements CSS de la Community Review Obsidian.
- Suppression des usages de `:has()`, `text-indent` et `!important`.
- Conservation du rendu typographique et des comportements existants.
- Retrait du réglage accessoire de masquage du sélecteur de coffre.

## 2.0.2

### Maintenance et conformité

- Suppression d’un accès au presse-papiers système devenu inutile.
- Suppression du code dynamique historique `new Function` provenant des polyfills embarqués par JSZip/docx.
- Aucune modification du comportement des exports EPUB/DOCX.

## 2.0.1

### Corrigé

- Description du plugin ajustée pour respecter les règles du répertoire communautaire.
- Corrections mineures de conformité à l’API Obsidian, sans changement du fonctionnement attendu.

## 2.0.0

### Écrire d’abord

- **Positionnement élargi** : Feuillets accompagne désormais aussi bien un article, une nouvelle ou un essai qu’un recueil, un projet non-fiction ou un roman.
- **Trois points de départ** : Fiction, Non-fiction et Libre. Le mode Libre démarre avec un seul texte, sans hiérarchie éditoriale imposée.
- **Dossiers existants** : un dossier Obsidian peut devenir un projet Feuillets sans déplacer, renommer ni restructurer son contenu personnel.

### Atelier et organisation

- **Inspecteur unifié** en cinq espaces : Feuillet, Recherche, Journal, Édition et Relecture.
- **Relecture native** : détection des répétitions rapprochées même sans module compagnon ; les fournisseurs linguistiques peuvent ajouter leurs propres signalements.
- **Cartes et Plan adaptés au type de projet** au premier démarrage, tout en laissant ensuite les choix de l’auteur prioritaires.
- **Classeur et compilation** fiabilisés pour les fichiers, dossiers, sélections et déplacements vers la racine.
- **Édition** regroupe les documents éditoriaux, la révision DOCX et l’intégration facultative avec Courrier.

### Structure Feuillets 2

- **Nouvel espace auxiliaire canonique `_Feuillets`** pour Recherche, Ressources, Edition, Journal, Snapshots, Backups et Sortie.
- **Compatibilité conservée avec les anciens projets** : les anciens chemins restent reconnus lorsqu’ils existent, sans migration, déplacement ou renommage automatique.
- **Recherche et Chronologie** utilisent désormais les résolveurs V2 et ne recréent plus de nouveaux chemins legacy.
- **Sauvegardes et instantanés** respectent la racine réelle du projet et excluent leurs propres destinations.

### Composition, export et qualité

- **Exports natifs** Markdown compilé, DOCX, EPUB, ODT et PDF, sans Pandoc.
- **Flux éditorial DOCX** renforcé, y compris la préparation facultative d’une soumission vers Courrier.
- **Documentation FR/EN** réalignée sur l’architecture et l’interface Feuillets 2.
- **Validation de release** : plus de 2 000 tests automatisés, typecheck, build, lint général et lint Obsidian.

## 1.7.2

### Maintenance

- **Publication indépendante de Feuillets-Grammalecte** : le compagnon est désormais maintenu dans son propre dépôt, sans modification du runtime ni de l'API de Feuillets.
- **Validation de release** : typecheck, lint, revue Obsidian, tests et build vérifiés avant publication.

## 1.7.1

### Refonte de sécurité et conformité Obsidian

- **Suppression de l'intégration Pandoc** : Retrait complet du moteur Pandoc et de ses dépendances systèmes (`child_process`, détection de binaires sur disque). Les exports natifs (DOCX, PDF, ODT, EPUB, Markdown) fonctionnent en totale autonomie.
- **Suppression des accès privilèges sur disque (`fs`)** : Conversion de l'ensemble des lectures de fichiers externes vers des API Web standard (`File`, `FileList`, `JSZip`, `webkitGetAsEntry`).
- **Import DOCX via API Web File** : Sélection et lecture binaire en mémoire du fichier `.docx` sans écriture intermédiaire ni dépendance Node.js.
- **Import Scrivener hybride (ZIP & Glisser-déposer)** : Prise en charge des projets Scrivener sous forme d'archives `.zip` et par glisser-déposer direct du paquet `.scriv` via l'API Web `webkitGetAsEntry()`.
- **Corrections de conformité Obsidian** : Suppression de `localStorage`, remplacement des accès `window` par les API Obsidian dédiées, et éradication des risques d'exécution de code privilégié.

## 1.7.0

### Ajouté et amélioré

- **Modernisation des réglages** : Nouvelle interface de paramètres structurée par catégories et onglets pour une navigation plus fluide et intuitive.
- **Amélioration de la vue Aperçu (PreviewView) et synchronisation** : Expérience de relecture enrichie, suivi et synchronisation du défilement optimisés entre l'éditeur et l'aperçu.
- **Stabilisation des exports natifs** : Prise en charge fiabilisée et harmonisée des exports manuscrits en formats DOCX, PDF, ODT, EPUB et Markdown.
- **Amélioration de la compatibilité desktop/mobile** : Isolation stricte et chargement paresseux des modules Node (`vm`, `zlib`) pour une exécution sans erreur sur les appareils mobiles.
- **Mise à jour du compagnon Feuillets-Grammalecte** : Améliorations de l'adaptateur Grammalecte 2.2.0 et des garde-fous de plateforme.
- **Corrections et couverture de tests** : Ajout de nombreuses suites de tests automatisées (export EPUB, onglets de réglages, synchronisation) et corrections d'incompatibilités d'API.

## 1.6.0

### Ajouté et amélioré

- **Nouvelle API publique de greffons d'analyse** : Feuillets expose une interface générique (`TextAnalysisRegistry`, accessible via `app.plugins.plugins["feuillets"].api`) permettant aux plugins compagnons tiers d'enregistrer leurs moteurs d'analyse linguistique de façon modulaire.
- **Compatibilité complète avec Feuillets Grammalecte** : Prise en charge du compagnon local `Feuillets Grammalecte 1.0.0` pour la correction orthographique, grammaticale et l'analyse linguistique avancée.
- **Amélioration de la vue Relecture** :
  - Épuration des cartes de signalement (catégorie, règle, extrait, masquage du chemin pour le feuillet courant et affichage discret pour le roman).
  - Soulignements dans l'éditeur Markdown (rouge pour l'orthographe, bleu pour la grammaire).
  - Menu contextuel unifié (clic droit sur carte ou dans l'éditeur) proposant les suggestions de remplacement, l'ignorance d'occurrence (session) et l'apprentissage de mots (orthographe).
- **Analyse automatique temporisée (Debounce)** :
  - Relance automatique de l'analyse du feuillet courant 1 seconde après l'arrêt de la frappe lorsque l'onglet Relecture est ouvert.
  - Conservation automatique du focus éditeur et exclusion de l'analyse automatique sur le roman complet pour préserver les performances.
- **Corrections d'offsets, de remplacement et de focus** :
  - Remplacement exact des mots fautifs sans concaténation avec l'ancien mot.
  - Repositionnement automatique du curseur après le mot corrigé.
  - Conversion stricte des offsets avec compensation du frontmatter et des sélections.
- **Améliorations du masquage Markdown** :
  - Masquage des titres, puces, marqueurs d'emphase, code, LaTeX et liens à longueur strictement constante.
  - Préservation intégrale des apostrophes, tirets de mots composés et caractères accentués.

## 1.5.0

### Retiré

- **Correction grammaticale.** Feuillets n'intègre plus de correcteur et n'en télécharge aucun. Les moteurs Grammalecte et Harper (jusqu'à 26 Mo téléchargés puis exécutés après installation) et LanguageTool (qui envoyait le texte du manuscrit à un service distant) sont supprimés, ainsi que l'onglet Grammaire, le soulignement des fautes, les mots appris et les commandes de vérification. Pour l'orthographe et la grammaire, installe un greffon dédié depuis la galerie communautaire d'Obsidian.
- **Rubriques « Vocabulaire » du panneau Analyse** (lemmes favoris, richesse lexicale, voix passive, adverbes en -ment). Elles reposaient sur un moteur morphologique exclusivement français ; Feuillets ne dépend plus d'aucune langue en particulier.

### Sécurité

- **Plus aucune exécution de code dynamique** : ni `eval`, ni `new Function`, ni `vm`, ni WebAssembly.
- **Plus aucun code téléchargé puis exécuté.** Tout ce que Feuillets exécute est contenu dans la release et déterminé au moment du build.
- **Plus aucune requête réseau.** Le greffon ne contacte plus aucun serveur.
- Suppression du téléchargeur d'archives, qui ne vérifiait pas l'intégrité de ce qu'il extrayait et n'était pas protégé contre le zip-slip.
- Plus aucun code tiers n'est redistribué dans la release en dehors des bibliothèques npm.

### Conservé

- Le panneau Analyse garde tous les outils indépendants de la langue : répétitions, équilibre des chapitres, ratio de dialogue, courbe narrative, tableau de bord. Ils fonctionnent sur toute langue en écriture latine.
- `main.js` passe de 2,4 à 2,1 Mo.

### Migration

- Les réglages de correction devenus inutiles sont retirés de `data.json` au premier démarrage, et les moteurs téléchargés par les versions antérieures sont supprimés du dossier du greffon. Les mots appris ne sont pas effacés.

## 1.4.4

### Corrigé et amélioré

- Nettoyage et modernisation progressive pour la revue Obsidian.
- Réduction des avertissements de typage et d'API.
- Compatibilité maintenue avec Obsidian 1.7.2.
- Amélioration des tests automatisés.
- Restauration et stabilisation de l'export PDF.
- Nettoyage CSS prudent.
- Aucun changement volontaire du format des projets existants.

## 1.4.3

### Modifié & Corrigé

- **Qualité du code & Revue Obsidian** :
  - Réduction importante des alertes de typage Obsidian.
  - Amélioration des types CodeMirror et des données externes.
  - Corrections sûres autour des sauvegardes, du frontmatter, des citations, du XML, du DOCX et de la recherche.
  - Remplacement de plusieurs API ou usages dépréciés simples.
  - Aucun changement fonctionnel intentionnel.

## 1.4.2

### Corrigé

- **Qualité du code** : reformulation d'un commentaire d'exception dans le correcteur Harper, qui était accidentellement interprété comme une directive ESLint mal formée (règle `eslint-comments/require-description`).

## 1.3.6

### Modifié

- **Qualité du code** : ajout de contrats JSDoc aux frontières du plugin, aux services de structure et de frontmatter, ainsi qu'aux utilitaires de texte et de notes. Les règles `no-unsafe-*` sont désormais ciblées sur ces modules déjà typés, tout en étant neutralisées dans les couches UI Obsidian dynamiques où elles ne produisaient pas de signal exploitable.

## 1.3.5

### Corrigé

- **Réglages** : remplacement de l'affectation directe de style par l'API Obsidian `setCssProps`, afin de respecter la règle de revue `obsidianmd/no-static-styles-assignment`.

## 1.3.4

### Corrigé

- **Réglages** : Réécriture de la méthode d'organisation des panneaux. L'approche précédente (déplacement de nœuds DOM actifs + toggleVisibility) causait des panneaux vides sur certaines versions d'Obsidian. La nouvelle approche classe d'abord les nœuds, vide le conteneur, puis reconstruit proprement — garantissant que tous les onglets affichent bien leur contenu.

## 1.3.3

### Corrigé

- **Réglages** : Toutes les sous-sections des panneaux de réglages (Numérotation, Statuts & Labels, Objectifs, Historique, Apparence, Typographie, Mode concentration, Interface sobre, Fusion de scènes, Panneau Cartes, Panneaux au démarrage, Vues actives, Binder, Panneau Notes, Correcteur grammatical, Compilation, Préréglages de compilation, Export) s'affichaient vides car elles étaient repliées par défaut. Elles sont désormais toutes ouvertes à l'ouverture du panneau de réglages.

## 1.3.2

### Modifié & Corrigé

- **Revue Obsidian** : Correction finale des faux-positifs de linting (no-undef pour require, no-misleading-character-class).
- **Typage** : Initialisation du typage JSDoc sur `constants.js` et `main.js` pour éliminer les alertes TypeScript sous-jacentes.

## 1.3.1

### Modifié & Corrigé

- **Hygiène du code & revue Obsidian** : Harmonisation et documentation explicite de tous les blocs `catch` du projet. Nettoyage des variables inutilisées et suppression des avertissements de linter. Passage à 0 erreur au test de revue officiel `eslint-plugin-obsidianmd`.
- **Correcteur LanguageTool** : Passage au transport `requestUrl` natif d'Obsidian afin de contourner les politiques CORS sur les serveurs LanguageTool locaux (`http://localhost:8081`).

## 1.3.0

### Modifié

- **Le bundle publié n'est plus minifié.** `main.js` passe de 1,5 à 2,4 Mo,
  mais devient lisible et vérifiable ligne à ligne — ce que la revue
  d'Obsidian valorise explicitement (son contrôle « Code obfuscation »
  avait déjà signalé le plugin). Effet mesuré sur l'analyse automatique du
  fichier publié : **3 184 → 1 241 remarques, soit −61 %**, la minification
  produisant à elle seule des milliers de motifs que les règles signalent
  légitimement. Aucun impact sur les performances à l'exécution : c'est un
  téléchargement unique.

### Corrigé

- **Fenêtres détachées** : 37 appels à `setTimeout` / `clearTimeout` /
  `requestAnimationFrame` passent par `window.…`. Sans ça, une vue ouverte
  dans une fenêtre séparée s'appuyait sur les minuteries de la fenêtre
  principale — source de comportements erratiques (rendus différés qui ne
  partent jamais, anti-rebond qui ne se réarme pas).
- Ajout d'un guide de contribution (`CONTRIBUTING.md`), qui consigne les
  conventions imposées par la revue d'Obsidian : pas de style en ligne,
  pas d'`innerHTML`, pas d'élément `<style>`, minuteries via `window`,
  modules Node derrière un garde `Platform`.

### Non modifié, volontairement

- Les 4 avertissements « `@codemirror/state` should be listed in the
  project's dependencies » restent en l'état. Ces paquets sont marqués
  `external` dans la configuration esbuild : ils sont **fournis par
  Obsidian à l'exécution**, jamais embarqués dans le bundle — les déclarer
  en dépendance serait donc faux. Les ajouter casse d'ailleurs
  l'installation : `obsidian` les épingle en version exacte comme
  `peerDependencies`, et `eslint-plugin-obsidianmd` embarque une autre
  version d'`obsidian` qui en épingle une autre, ce qui rend `npm ci`
  insoluble.
- Les 21 avertissements « Do not import Node.js built-in module » restent
  en l'état : ces `require("fs")` / `require("path")` sont déjà protégés,
  soit par `Platform.isMobile` (les correcteurs grammaticaux ne sont même
  pas instanciés sur mobile), soit par un `try/catch` qui affiche un
  message à l'utilisateur. La règle ne peut pas voir ces gardes ; il n'y a
  rien à corriger, seulement un compteur à ne pas faire baisser
  artificiellement.

## 1.2.10

### Corrigé

- Dernière écriture `innerHTML` retirée (section des notes de bas de page
  de l'export PDF). Le contenu d'une note est du HTML issu du rendu
  Markdown d'Obsidian : il est désormais analysé dans un document inerte
  (`DOMParser`, qui n'exécute ni script ni gestionnaire d'événement et ne
  touche pas au document courant), puis ses nœuds sont déplacés dans le
  `<li>`. La liste elle-même est construite avec l'API DOM. L'export EPUB
  continue d'utiliser la chaîne HTML, ce qui est légitime : il écrit un
  fichier, il ne manipule pas le DOM de l'application.

## 1.2.9

### Modifié

- **Les 106 styles posés en ligne (`element.style.x = "…"`) passent dans
  `styles.css`.** Ils sont désormais surchargeables par un thème, ne sont
  plus dupliqués d'un fichier à l'autre, et le rendu ne change pas : les
  valeurs sont reprises à l'identique. Les bascules d'affichage utilisent
  l'API officielle (`show()` / `hide()` / `toggleVisibility()`) plutôt que
  d'écrire `display` à la main.
- Deux cas méritaient mieux qu'un simple déplacement :
  - Les pastilles de dossier du panneau Notes recevaient un
    `style.cssText` entièrement en `!important`, qui écrasait les règles
    `.feuillets-notes-folder-links` / `.feuillets-notes-folder-link`
    existantes — celles-ci n'étaient donc jamais appliquées. Les valeurs
    réellement rendues ont été reportées dans ces règles (le fond gris et
    la couleur du texte restent codés en dur : ils gagneraient à passer
    sur les variables de thème, c'est noté pour plus tard).
  - L'accueil du Binder (aucun projet ouvert) construisait ses cartes
    entièrement en styles en ligne alors que les éléments portaient déjà
    les classes `feuillets-project-hub` / `feuillets-hub-card` : ces
    classes ont simplement récupéré leurs propriétés.
- Les zones de texte qui s'ajustent à leur contenu retirent maintenant
  l'override en ligne (`style.removeProperty("height")`) avant de mesurer,
  la hauteur `auto` vivant dans la classe `.feuillets-autosize` — même
  résultat, sans style statique en JavaScript.

## 1.2.8

### Corrigé

- **Le CSS des modèles d'export ne repeint plus toute l'interface.** Les
  aperçus de mise en page injectaient le CSS du modèle dans un `<style>`
  ajouté au DOM d'Obsidian ; ses règles `body { … }` (police, taille,
  interlignage, marges) s'appliquaient donc au `<body>` de l'application
  elle-même tant que la modale restait ouverte. L'aperçu vit désormais
  dans une iframe `sandbox` isolée : le rendu ne déborde plus, et il est
  au passage plus fidèle au fichier exporté puisqu'il n'hérite plus du
  thème d'Obsidian.
- Les 21 « titres » de sections des réglages n'en étaient pas : ces `h3`
  servaient uniquement de marqueurs, lus puis retirés du DOM par
  `organizeSections()`, leur texte devenant le résumé d'un repli. Ils
  deviennent des `div` porteurs d'une classe — sémantiquement juste, et
  conforme à l'ESLint officiel d'Obsidian qui réserve les titres à
  `new Setting().setHeading()`. Le titre « Feuillets » de l'en-tête passe
  lui aussi en `div` : son apparence est entièrement définie par
  `.feuillets-settings-title`, rien n'y dépendait des styles par défaut
  d'un `h2`.
- Contenus de démonstration des aperçus construits avec l'API DOM au lieu
  d'`innerHTML`.

### Connu

- Une écriture `innerHTML` subsiste (`services/export-pdf.js`, section des
  notes de bas de page) : le HTML des notes est nettoyé par expressions
  régulières sur la chaîne sérialisée. S'en passer demande de faire
  circuler des nœuds DOM dans toute la chaîne de rendu — un changement
  plus profond, à faire délibérément.

## 1.2.7

### Corrigé

- 140 des erreurs « Uses Obsidian APIs newer than the declared
  `minAppVersion` » du tableau de bord tenaient toutes à une seule chose :
  Obsidian 1.13.0 a documenté `Plugin.settings?: unknown` dans son API, et
  l'analyseur résolvait chaque `this.settings` du plugin vers ce membre
  marqué `@since 1.13.0`. Aucune incompatibilité réelle — c'est une
  déclaration de type, sans effet à l'exécution, et y affecter les réglages
  est précisément l'usage documenté (une simple propriété d'instance sur
  les versions antérieures). `FeuilletsPlugin` déclare désormais
  explicitement sa propriété `settings` typée, comme le demande la doc
  d'Obsidian. `minAppVersion` reste donc à 1.7.2 : rien ne justifiait
  d'exclure les utilisateurs des versions 1.7.2 à 1.12.x.

## 1.2.6

### Corrigé

- **Vraie cause, enfin identifiée, des échecs à répétition du contrôle
  « Source code » du tableau de bord d'Obsidian** — reproduite localement
  en installant leur propre outil (`eslint-plugin-obsidianmd`) : leur
  règle `obsidianmd/no-sample-code` plante avec un `TypeError` sur
  `window.setInterval(() => f(), …)`. Elle lit
  `callback.body.callee?.property.type` sans `?.` sur `property`, qui vaut
  `undefined` dès que la fonction fléchée appelle un identifiant simple.
  Ce plantage interrompait toute l'analyse — d'où le message d'erreur
  générique, sans jamais aucun fichier ni ligne cité. `registerAutoBackup`
  passe désormais `tick` par référence (strictement équivalent, et forme
  plus idiomatique) au lieu de l'envelopper dans une fonction fléchée.
- Retiré `.eslintignore` (format hérité, désormais redondant avec
  `ignores` dans `eslint.config.mjs` — il déclenchait un avertissement de
  dépréciation à chaque analyse) et `.eslintrc.json` (ajouté en 1.2.3 sur
  l'hypothèse, désormais réfutée, d'un scanner sous ESLint 8 ; le support
  d'eslintrc a de toute façon été supprimé dans ESLint 10). La
  configuration flat `eslint.config.mjs` est la seule source de vérité.

## 1.2.5

### Corrigé

- Cause probable, enfin trouvée, des échecs répétés du contrôle « Source
  code » du scanner d'Obsidian : `eslint.config.mjs` importait le paquet
  npm `globals`. Si le scanner clone le dépôt et lance ESLint sans lancer
  `npm install` au préalable, cet `import` échoue au chargement même de la
  configuration (`ERR_MODULE_NOT_FOUND`) — avant d'avoir ouvert le moindre
  fichier source, ce qui correspond exactement à l'erreur générique et
  sans fichier/ligne observée à chaque fois. Remplacé par une liste de
  globals écrite à la main (aucune dépendance externe dans la config
  ESLint désormais) ; `no-undef` passé de `error` à `warn` puisque cette
  liste manuelle est nécessairement moins exhaustive que celle du paquet.
  Dépendance `globals` retirée de `package.json`.

## 1.2.4

### Corrigé

- Retiré `/Candide - Voltaire/` du suivi git (reste sur le disque local,
  mais ne doit jamais avoir été commité) — un vault de test/démo, pas du
  code du plugin.
- Réconcilié la configuration ESLint : `eslint.config.mjs` (paquet
  `globals`, couvre aussi `scripts/`/`test/`/`esbuild.config.mjs`) est
  désormais la seule config flat active — `eslint.config.js` supprimé pour
  éviter que les deux coexistent silencieusement. `.eslintrc.json` a
  retrouvé son `root: true`. Le script `lint` lance maintenant vraiment
  ESLint (il ne relançait que la vérification de types).

## 1.2.3

### Corrigé

- Ajout de `.eslintrc.json` en plus de `eslint.config.js` : le scanner
  d'analyse statique d'Obsidian semble utiliser une version d'ESLint
  antérieure à la 9 (qui ne cherche que `.eslintrc.*`, pas le format flat
  config `eslint.config.js` introduit en v9) — vérifié localement avec
  ESLint 8 et 10, les deux trouvent maintenant une configuration valide.

## 1.2.2

### Corrigé

- Retiré une branche de code morte (jamais atteinte dans Electron) présente
  dans `docx` et `jszip` : un vieux polyfill IE6-8 créait un élément
  `<script>` vide uniquement pour exploiter son événement
  `onreadystatechange` comme astuce de minuterie — jamais de `src` assigné,
  aucun chargement de code externe. Patché via un script `postinstall`
  (`scripts/patch-script-polyfills.mjs`) pour ne plus déclencher les
  scanners de sécurité qui détectent la création dynamique de `<script>`
  sans distinguer ce cas mort du vrai risque.
- CI/CD : ajout de workflows GitHub Actions (build + tests sur chaque push,
  build + tests + attestations de provenance + release automatique sur
  chaque tag).

## 1.2.1

### Corrigé

- `minAppVersion` relevé de 1.4.0 à 1.7.2 : plusieurs propriétés CSS déjà
  utilisées (`scrollbar-width`, `:has()`, `text-decoration-color`) sont
  plus récentes que le Chromium embarqué dans Obsidian 1.4.x — le déclarer
  correctement évite un rendu dégradé chez qui serait resté sur une
  version aussi ancienne, plutôt que de réécrire ces règles.
- Ajout de `eslint.config.js` (ESLint 9+ refuse de tourner sans fichier de
  configuration présent).

## 1.2.0

### Ajouté

- **Correction grammaticale anglaise, via [Harper](https://writewithharper.com).**
  S'ajoute à Grammalecte (français) : les deux moteurs tournent 100% en
  local, choisis automatiquement selon la langue active, sans dépendance à
  un service tiers.
- **Téléchargement à la demande des moteurs locaux.** Les dictionnaires/
  binaires de Grammalecte et Harper (~9 Mo / ~17 Mo) ne sont plus embarqués
  dans le plugin — un bouton dédié par langue dans les réglages les
  télécharge une seule fois depuis les releases publiques de
  [`Sargon01/feuillets-assets`](https://github.com/Sargon01/feuillets-assets),
  mis en cache sur disque ensuite. Chaque langue se télécharge
  indépendamment.
- **Gestion des mots appris / fautes ignorées** via une modale dédiée
  (filtre de recherche, suppression individuelle, tout effacer), à la place
  d'une liste illimitée directement dans les réglages. Ces données sont
  stockées à part (`resources/grammar-user-data.json`), plus dans
  `data.json`.
- **Nouvel onglet de réglages « Interface »** — regroupe Apparence (langue
  de l'interface, taille de police, échelle, hauteur de ligne, largeur de
  texte, police, couleur d'accent), Mode concentration, et une nouvelle
  section **Interface épurée** : masquer les propriétés (YAML)/le titre du
  feuillet/la barre d'onglet/le ruban entier/le sélecteur de coffre, fonds
  transparents (panneaux latéraux et bande d'onglets), estomper les icônes
  d'action des onglets et les onglets latéraux non actifs. Un bouton
  « Valeurs suggérées » pré-remplit ces réglages sans rien masquer ni
  verrouiller. La plupart de ce qui nécessitait un thème/des plugins tiers
  (voir [`SETUP-INTERFACE.md`](./SETUP-INTERFACE.md)) est donc désormais
  natif.
- Onglets de réglages réorganisés : Numérotation en position 2 dans Projet
  (juste après Dossier & Gestion des projets), Tags favoris déplacés vers
  Projet (avec Statuts & Labels), Correction grammaticale et
  Tableau/Panneaux latéraux fusionnés/renommés en onglets propres
  (« Correcteur », « Panneaux »).
- En-tête des réglages : titre agrandi, slogan, liens GitHub/README/
  Fonctionnalités.

### Corrigé

- Le texte n'était jamais vérifié dans la langue réellement active : le
  code lisait un réglage inexistant (`settings.locale`) au lieu de la
  langue d'interface effective.
- L'en-tête des réglages (titre/slogan/liens) et la langue d'interface
  étaient aspirés dans l'onglet « Projet » au lieu de rester fixes
  au-dessus de la barre d'onglets.
- Trois interrupteurs « révélé(e) au survol » (bande d'onglets, ruban,
  binder) ont été essayés puis retirés : trop instables (chevauchement
  avec les boutons de fenêtre macOS, survol peu fiable) et redondants avec
  les gestes tactiles déjà en place pour le binder.

## 1.1.0

### Ajouté

- **Statuts entièrement personnalisables** (nom + couleur), au même titre
  que les labels — plus de liste figée ni de couleur déterminée par la
  position dans la liste. Migration automatique des anciens statuts
  personnalisés.
- **Première étape d'internationalisation : vocabulaire frontmatter en
  anglais.** Les clés YAML des fiches (scènes, personnages, lieux,
  sources…) passent en anglais — `title`, `short_title`, `subtitle`,
  `order`, `status`, `goal`, `summary`, `thread`, `characters`, `author`,
  `publisher`, `pace`, `role`, `end_date`, `birth`, `death`, `compile`.
  Les anciennes clés françaises (`titre`, `statut`, `ordre`, `resume`,
  `objectif`, `fil`, `personnages`, `auteur`, `rythme`, `editeur`/`edition`,
  `sous_titre`, `arc_secondaire`, `fonction`, `date_fin`, `naissance`,
  `mort`, `nom`, `prénom`, `compiler`) restent lues indéfiniment en repli
  sur toute fiche déjà écrite — **aucun fichier existant n'est réécrit de
  force.** Seules les nouvelles fiches et les nouvelles écritures (via
  l'éditeur, les menus, les imports Scrivener/plan) utilisent les clés
  anglaises. Concerne aussi les colonnes du Plan et le contenu affiché sur
  les tuiles (`resume`→`summary`, `compiler`→`compile` dans les réglages,
  migrés automatiquement).
- **Interface entièrement bilingue (français/anglais).** Nouveau mécanisme
  `src/i18n/` (dictionnaire plat `t(clé, paramètres)`, détection automatique
  de la langue d'Obsidian, réglage de substitution `language` —
  Automatique/Français/English). Traduction complète : tous les panneaux
  (Binder, Cartes/Plan, Notes, Propriétés, Recherche, Projet & export,
  Journal, Analyse, Révision .docx, Correcteur grammatical, Chercher et
  remplacer), l'intégralité de l'onglet Réglages, toutes les commandes et
  notifications de `main.js`, et toutes les modales (import Scrivener,
  mise en page/export, gestion de projets, comparaison de snapshots, etc.).
  Les identifiants internes (clés frontmatter, valeurs de réglages stockées,
  rôles de la page de titre) ne sont jamais traduits — seul le texte affiché
  à l'écran change avec la langue.
- **Deuxième étape d'internationalisation : noms de dossiers en anglais.**
  Les nouveaux projets créent désormais `Research` (Recherche), `Resources`
  (Ressources) et ses sous-dossiers `Assets`/`Layouts` (Visuels/Modèles), et
  les catégories de recherche `Characters`/`Places`/`Glossary`/`Events`/
  `Bibliography` (Personnages/Lieux/Glossaire/Événements/Bibliographie).
  Comme pour le frontmatter : **aucun dossier existant n'est renommé de
  force** — l'ancien nom français reste détecté indéfiniment (voir
  `getResourcesRoot`/`getResearchRoot` dans `services/folder-structure.js`
  et `services/research.js`, `LEGACY_RESEARCH_LABELS` dans
  `utils/project-modes.js`). `Front`, `Snapshots`, `Journal` (déjà
  configurable) et le sous-dossier `Templates` n'ont pas changé — déjà
  anglais ou déjà neutres.

### Corrigé

- `workspace.activeLeaf` (API dépréciée par Obsidian) retiré de
  `getActiveFileSafe` — remplacé par `getMostRecentLeaf()`.
- Description du manifeste en anglais (texte affiché dans le catalogue
  Community Plugins quelle que soit la langue de l'interface).
- Un statut personnalisé au-delà des 5 par défaut n'avait aucune couleur
  définie.

## 1.0.1

### Corrigé

- **Glisser-déposer vers un dossier vide** (ex. `Front`) : aucune cible de
  dépôt n'existait pour un dossier sans le moindre feuillet — ajout d'une
  zone de dépôt de secours sur le message "Aucun feuillet…".
- **Glisser-déposer entre enfants directs du même dossier** : déposer un
  feuillet sur un dossier frère (même parent, ex. tous deux à la racine du
  projet) ne faisait que réordonner les frères au lieu de déplacer le
  feuillet dedans.
- **Réorganisation de dossiers entre eux** (Cartes, Plan) : la correction
  précédente avait involontairement cassé le réordonnancement de deux
  dossiers frères (interprété comme un emboîtement) — limité désormais aux
  fichiers déposés sur un dossier.
- **Vue Plan (outline)** : les dossiers n'avaient ni repli/dépli, ni aucun
  écouteur de glisser-déposer.
- **Vue Cartes, mode "Tout le manuscrit"** : les en-têtes de dossier
  n'étaient pas repliables de façon fiable (pas de retour visuel) et pas
  du tout déplaçables.
- **Navigation clavier (flèches ↑/↓) dans le Binder** : ne fonctionnait pas
  après un simple clic sur une fiche (le focus quittait le Binder vers
  l'éditeur) ; ne faisait pas suivre le dossier sélectionné quand la fiche
  voisine appartenait à un autre dossier ; pouvait être intercepté par des
  plugins tiers basés sur React (ex. Notebook Navigator) qui posent leurs
  propres écouteurs en phase de capture.
- **Gestes de balayage trackpad** : le réglage annonçait "trackpad /
  tactile" mais seul le tactile (écran tactile) était réellement câblé —
  un trackpad n'envoie jamais d'événements tactiles. Ajout du support
  `wheel` pour trackpad, avec les mêmes soucis de priorité face aux
  plugins React que la navigation clavier, plus un bug de capture figée de
  `leftSplit`/`rightSplit` avant que la mise en page d'Obsidian soit prête
  (rendait le geste inopérant même une fois câblé).
- **Volet droit** : aucun geste ne l'ouvrait/fermait — seul le volet gauche
  (Binder) était géré. Ajout d'une bascule ouvert/fermé symétrique.
- **Dossier "vide" en apparence** : déplacer un feuillet dans un dossier
  qui finit par porter exactement le même nom que ce feuillet le
  transforme silencieusement en note de dossier (convention volontaire,
  voir `folder-notes.js`) — le feuillet n'apparaissait plus nulle part sans
  explication. Une notification prévient désormais explicitement.

### Modifié

- Seuil de déclenchement du geste trackpad abaissé pour une réaction plus
  rapide (moins de distance de glissement nécessaire).
